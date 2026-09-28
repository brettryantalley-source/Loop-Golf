/*
 * learning.js — the learning loop (spec §5.2–§5.7). Turns Loop's shot log into the numbers the
 * engine reads, without ever writing to the profile.
 *
 *   withinRound()        §5.5  → { adjust, nudges, flags, corrections } for the engine's ctx
 *   recencyWeight()      §5.3  between-round weights
 *   shrink(), priorFor() §5.4  small-sample shrinkage toward Shot Pattern
 *   applyShotLog()       §5.2  per-entry overlays (club|swing|lie), takeover at TAKEOVER_N
 *   entryWithOverlay()   §5.2  the merged entry numbers the engine would use
 *   lieOverrideAt()      §5.6  lie-chip corrections that stick
 *   aggressionScorecard()§5.7  safe / aggressive / own vs. the engine's expScore
 *
 * Source separation (§5.2, T32): `P.raw` is Shot Pattern only and is never written. Everything
 * here returns NEW objects; nothing mutates an argument.
 *
 * Pure functions. No DOM, no storage, no network, no clock (callers pass `now`).
 *
 * Shot records follow spec §4.6. Fields read: id, roundId, courseId, hole, shotNo, ts, club,
 * shotType, lie.{confirmed,inferred}, contact, linePlayed, logged, recommendation.{safe,aggressive}
 * .expScore, derived.{distanceMissYds, lateralMissYds, onTarget}. Optional, read when present:
 * derived.intendedYds (target distance along the line) or derived.actualYds — without one of
 * them Loop learns bias and spread but not an absolute distance median.
 */

import { DEFAULT_CONFIG, CLUB_FAMILY } from "./config.js";
import { carryFromTotal, _internal as profileInternal } from "./profile.js";

/* ---------- local constants (not yet in config.js) ---------- */
// TODO(config): move these into DEFAULT_CONFIG (config.js) when that file is next opened.
// Each is read as `config.NAME ?? LOCAL` so adding it to config needs no change here.
const WITHIN_ROUND_FRACTION = 0.5;   // §5.5: shift by 50% of the mean miss
const EVIDENCE_MIN = 2;              // §5.5: ≥ 2 same-direction misses
const CLEAR_AFTER_ON_TARGET = 2;     // §5.5: 2 consecutive on-target shots clear a correction
const DIST_CAP_CLUBS = 1;            // §5.5: distance correction capped at 1 club per family
const DEFAULT_GAP_YDS = 10;          // club gap when the profile cannot supply one for a family
const LIE_OVERRIDE_RADIUS_M = 15;    // §5.6
const LIE_OVERRIDE_MIN = 2;          // §5.6

/** 80% contour of a 2-D normal: √(−2 ln 0.2) = 1.794 σ (UI addendum §5.2). Same as engine ELL80_K. */
const ELL80_K = Math.sqrt(-2 * Math.log(0.2));
const DEG = Math.PI / 180;
const MONTH_MS = 30.436875 * 24 * 3600 * 1000;
const FAMILIES = Object.freeze([...new Set(Object.values(CLUB_FAMILY))]);
const SWINGS = new Set(["full", "finesse"]);
const MINUS = "−";

const cfgOf = (config) => config || DEFAULT_CONFIG;
const num = (v) => typeof v === "number" && Number.isFinite(v);

/* ---------- families ---------- */

/**
 * Club family (§5.5) for a club id (or `{ id }`): CLUB_FAMILY first, then the naming pattern for
 * clubs outside Brett's current bag. Wedges GW and below are "wedge" whatever the swing type.
 * Returns null for an id it cannot place.
 */
export function familyOf(club) {
  const id = typeof club === "string" ? club : club?.id;
  if (id && CLUB_FAMILY[id]) return CLUB_FAMILY[id];
  if (!id) return typeof club === "object" && club?.family ? club.family : null;
  const s = String(id).trim();
  if (/^(dr|d|driver|\d+w|\d+hy?|\d+-?wood|\d+-?hybrid)$/i.test(s)) return "long";
  const iron = /^(\d+)i$/i.exec(s);
  if (iron) {
    const k = Number(iron[1]);
    return k <= 4 ? "long" : k <= 7 ? "mid" : "short";
  }
  if (/^pw$/i.test(s)) return "short";
  if (/^(gw|aw|sw|lw|uw)$/i.test(s) || /^(4[8-9]|5\d|6\d)°?$/.test(s)) return "wedge";
  return typeof club === "object" && club?.family ? club.family : null;
}

/* ---------- small helpers ---------- */

function lieOf(s) {
  return s?.lie?.confirmed || s?.lie?.inferred || s?.lieType || (typeof s?.lie === "string" ? s.lie : null);
}

function swingOf(s) {
  return s?.shotType || s?.swingType || "full";
}

function isShortGameOrPutt(s) {
  const t = swingOf(s);
  return t === "shortGame" || t === "putt" || s?.kind === "shortGame" || s?.kind === "putt";
}

function hasMisses(s) {
  return num(s?.derived?.distanceMissYds) && num(s?.derived?.lateralMissYds);
}

function intendedYds(s) {
  const d = s?.derived || {};
  if (num(d.intendedYds)) return d.intendedYds;
  if (num(s?.intendedYds)) return s.intendedYds;
  if (num(d.actualYds) && num(d.distanceMissYds)) return d.actualYds - d.distanceMissYds;
  return null;
}

function actualYds(s) {
  const d = s?.derived || {};
  if (num(d.actualYds)) return d.actualYds;
  const i = intendedYds(s);
  return i != null && num(d.distanceMissYds) ? i + d.distanceMissYds : null;
}

/** Stored total for a club × swing from the profile (for tolerances when the shot has no intended distance). */
function profileTotal(P, club, swing, lie) {
  const c = P?.clubs?.get?.(club);
  if (!c) return null;
  for (const sw of [swing, "full", "finesse"]) {
    const s = c.entries?.[sw];
    if (!s) continue;
    for (const l of [lie, "fairway", "tee", "rough"]) {
      const e = s[l];
      if (e && num(e.totalMedianYds)) return e.totalMedianYds;
    }
  }
  return null;
}

function toleranceFor(s, P, cfg) {
  const ot = cfg.ON_TARGET || DEFAULT_CONFIG.ON_TARGET;
  const d = intendedYds(s) ?? profileTotal(P, s.club, swingOf(s), lieOf(s)) ?? s?.start?.playsLikeYds ?? s?.start?.distanceToPinYds ?? 150;
  return { dist: ot.distPct * d, lat: d * Math.tan(ot.latDeg * DEG) };
}

/** Per-axis reading of one shot: −1 / 0 / +1 on distance (short / on / long) and direction (left / on / right). */
function readShot(s, P, cfg) {
  const d = s.derived;
  const tol = toleranceFor(s, P, cfg);
  const onTarget = typeof d.onTarget === "boolean"
    ? d.onTarget
    : (d.distanceMissYds / tol.dist) ** 2 + (d.lateralMissYds / tol.lat) ** 2 <= 1;
  if (onTarget) return { onTarget: true, dist: 0, lat: 0 };
  return {
    onTarget: false,
    dist: Math.abs(d.distanceMissYds) > tol.dist ? Math.sign(d.distanceMissYds) : 0,
    lat: Math.abs(d.lateralMissYds) > tol.lat ? Math.sign(d.lateralMissYds) : 0,
  };
}

function chronological(shots) {
  const withIdx = shots.map((s, i) => ({ s, i, t: s?.ts ? Date.parse(s.ts) : NaN }));
  if (withIdx.every((x) => Number.isFinite(x.t))) withIdx.sort((a, b) => a.t - b.t || a.i - b.i);
  return withIdx.map((x) => x.s);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------- club gaps ---------- */

/**
 * One club's worth of yards per family, from the profile's full-swing carries (carryMedianYds, or
 * total − roll per §3.3). Mean gap between neighbouring clubs of the same family; a family with a
 * single club uses the gaps that touch it; nothing at all → DEFAULT_GAP_YDS. `overrides` wins.
 */
export function clubGapYds(P, overrides = null, config) {
  const cfg = cfgOf(config ?? P?.config);
  const fallback = cfg.DEFAULT_GAP_YDS ?? DEFAULT_GAP_YDS;
  const carries = [];
  for (const id of P?.clubOrder || []) {
    const club = P.clubs.get(id);
    const fam = familyOf(id) || club?.family;
    const full = club?.entries?.full;
    if (!full || !fam) continue;
    for (const lie of ["fairway", "tee", "rough"]) {
      const e = full[lie];
      if (!e || !num(e.totalMedianYds)) continue;
      const carry = num(e.carryMedianYds) ? e.carryMedianYds : carryFromTotal(e.totalMedianYds, "full", fam, lie, cfg);
      carries.push({ id, fam, carry });
      break;
    }
  }
  carries.sort((a, b) => b.carry - a.carry);
  const same = {}, touch = {};
  for (let i = 0; i + 1 < carries.length; i++) {
    const a = carries[i], b = carries[i + 1];
    const g = a.carry - b.carry;
    if (!(g > 0)) continue;
    if (a.fam === b.fam) (same[a.fam] ||= []).push(g);
    (touch[a.fam] ||= []).push(g);
    if (b.fam !== a.fam) (touch[b.fam] ||= []).push(g);
  }
  const out = {};
  for (const f of FAMILIES) {
    const list = same[f]?.length ? same[f] : touch[f];
    out[f] = list?.length ? mean(list) : fallback;
  }
  return { ...out, ...(overrides || {}) };
}

/* ---------- §5.5 within-round adaptation ---------- */

const FAMILY_NOUN = { long: "long clubs", mid: "mid irons", short: "short irons", wedge: "wedges" };
const LIE_PHRASE = { tee: "off the tee", fairway: "from the fairway", rough: "from rough", sand: "from sand", recovery: "from recovery lies" };

function groupPhrase(g) {
  return g.kind === "family" ? `with ${FAMILY_NOUN[g.key] || g.key}` : LIE_PHRASE[g.key] || `from ${g.key}`;
}
function timesWord(n) { return n === 2 ? "twice" : `${n} times`; }
function holeList(shots) {
  const hs = [];
  for (const s of shots) if (s.hole != null && !hs.includes(s.hole)) hs.push(s.hole);
  return hs.map((h) => `H${h}`).join(", ");
}

/** "+½ club", "+1 club", "−½ club", or "+4 yds" under a quarter club. */
function clubText(shiftYds, gap) {
  const sign = shiftYds >= 0 ? "+" : MINUS;
  const steps = Math.round((Math.abs(shiftYds) / gap) * 2) / 2;
  if (steps === 0) return `${sign}${Math.round(Math.abs(shiftYds))} yds`;
  const whole = Math.floor(steps), half = steps - whole ? "½" : "";
  return `${sign}${whole ? whole : ""}${half} club${steps > 1 ? "s" : ""}`;
}

/**
 * Walk one group's shots (chronological) and return the misses still in evidence, per axis, after
 * applying the clearing rule. Two consecutive on-target shots clear distance and direction evidence;
 * two consecutive clean strikes (contact 0) clear contact evidence.
 */
function evidenceFor(shots, P, cfg) {
  const clearAfter = cfg.CLEAR_AFTER_ON_TARGET ?? CLEAR_AFTER_ON_TARGET;
  let dist = [], lat = [], contact = [];
  let onStreak = 0, cleanStreak = 0;
  for (const s of shots) {
    const r = hasMisses(s) ? readShot(s, P, cfg) : null;   // not closed out yet → contact only
    if (!r) { /* no result yet: leaves the on-target streak alone */ }
    else if (r.onTarget) {
      onStreak++;
      if (onStreak >= clearAfter) { dist = []; lat = []; }
    } else {
      onStreak = 0;
      if (r.dist) dist.push({ s, dir: r.dist });
      if (r.lat) lat.push({ s, dir: r.lat });
    }
    if (num(s.contact)) {
      if (Math.abs(s.contact) >= 1) { cleanStreak = 0; contact.push({ s, dir: Math.sign(s.contact) }); }
      else { cleanStreak++; if (cleanStreak >= clearAfter) contact = []; }
    }
  }
  return { dist, lat, contact };
}

/** The winning direction on one axis: ≥ EVIDENCE_MIN misses one way and more than the other way. */
function dominant(list, cfg) {
  const min = cfg.EVIDENCE_MIN ?? EVIDENCE_MIN;
  const neg = list.filter((m) => m.dir < 0), pos = list.filter((m) => m.dir > 0);
  if (neg.length >= min && neg.length > pos.length) return { dir: -1, misses: neg };
  if (pos.length >= min && pos.length > neg.length) return { dir: 1, misses: pos };
  return null;
}

/**
 * §5.5. `shotsThisRound` = this round's shot records, in any order (sorted by `ts` when every
 * record has one, else taken as given). Opts:
 *   P       — the loaded profile; club gaps are derived from its carries (clubGapYds).
 *   gapYds  — { [family]: yds } overriding the derived gaps (either, both, or neither may be given).
 *   lie     — the lie of the shot about to be played. Lie-based corrections apply (and show) only
 *             when it matches; without it they are reported in `corrections` with applies: false.
 * Returns { adjust: { distYds, aimYds, clampTo? }, nudges: [{axis, text}], flags: [{type, text}],
 * corrections: [...] } — pass adjust / nudges / flags straight onto the engine ctx.
 */
export function withinRound(shotsThisRound, config, opts = {}) {
  const cfg = cfgOf(config ?? opts.P?.config);
  const P = opts.P || null;
  const gaps = clubGapYds(P, opts.gapYds, cfg);
  const frac = cfg.WITHIN_ROUND_FRACTION ?? WITHIN_ROUND_FRACTION;
  const capClubs = cfg.DIST_CAP_CLUBS ?? DIST_CAP_CLUBS;

  // Evidence: logged (not skipped), full-swing / finesse shots with derived misses. Short game,
  // putts and recovery shots never count (§4.1; a punch-out's "miss" says nothing about the club).
  const shots = chronological((shotsThisRound || []).filter((s) =>
    s && s.logged !== "skipped" && !isShortGameOrPutt(s) && swingOf(s) !== "recovery" && (hasMisses(s) || num(s.contact))));

  const groups = new Map();
  const add = (kind, key, s) => {
    if (!key) return;
    const k = `${kind}:${key}`;
    if (!groups.has(k)) groups.set(k, { kind, key, shots: [] });
    groups.get(k).shots.push(s);
  };
  for (const s of shots) { add("family", familyOf(s.club), s); add("lie", lieOf(s), s); }

  const corrections = [];
  const contactHits = [];
  for (const g of groups.values()) {
    const ev = evidenceFor(g.shots, P, cfg);
    const d = dominant(ev.dist, cfg);
    if (d) {
      const meanMiss = mean(d.misses.map((m) => m.s.derived.distanceMissYds));
      const raw = -frac * meanMiss;                    // short (negative miss) → plays longer
      const fams = g.kind === "family" ? [g.key] : FAMILIES;
      const perFamily = {};
      for (const f of fams) {
        const cap = capClubs * (gaps[f] ?? DEFAULT_GAP_YDS);
        perFamily[f] = Math.max(-cap, Math.min(cap, raw));
      }
      const refGap = g.kind === "family" ? gaps[g.key] ?? DEFAULT_GAP_YDS : null;
      corrections.push({
        group: { kind: g.kind, key: g.key }, axis: "distance", dir: d.dir < 0 ? "short" : "long",
        meanMissYds: r1(meanMiss), rawShiftYds: r1(raw), shiftYds: perFamily, capped: Object.values(perFamily).some((v) => Math.abs(v) < Math.abs(raw)),
        gapYds: refGap, shots: d.misses.map((m) => m.s),
      });
    }
    const l = dominant(ev.lat, cfg);
    if (l) {
      const meanMiss = mean(l.misses.map((m) => m.s.derived.lateralMissYds));
      const raw = -frac * meanMiss;                    // left (negative) → aim right (positive)
      const fams = g.kind === "family" ? [g.key] : FAMILIES;
      const perFamily = {};
      for (const f of fams) perFamily[f] = raw;
      corrections.push({
        group: { kind: g.kind, key: g.key }, axis: "direction", dir: l.dir < 0 ? "left" : "right",
        meanMissYds: r1(meanMiss), rawShiftYds: r1(raw), shiftYds: perFamily, capped: false,
        clampTo: ["fairway", "green"], shots: l.misses.map((m) => m.s),
      });
    }
    const c = dominant(ev.contact, cfg);
    if (c) contactHits.push({ group: { kind: g.kind, key: g.key }, dir: c.dir < 0 ? "fat" : "thin", shots: c.misses.map((m) => m.s) });
  }

  // A lie correction built from exactly the misses a family correction already explains is the same
  // evidence counted twice: drop it (same axis, same direction, evidence ⊆ the family's).
  const subsetOfFamily = (item, list, sameDir) => item.group.kind === "lie" && list.some((o) =>
    o.group.kind === "family" && sameDir(o, item) && item.shots.every((s) => o.shots.includes(s)));
  const kept = corrections.filter((c) => !subsetOfFamily(c, corrections, (o, x) => o.axis === x.axis && o.dir === x.dir));
  const keptContact = contactHits.filter((c) => !subsetOfFamily(c, contactHits, (o, x) => o.dir === x.dir));

  const applies = (grp) => grp.kind === "family" || (opts.lie != null && grp.key === opts.lie);

  // adjust: per family and axis, the applicable correction with the largest magnitude (a family
  // correction and a lie correction are two readings of overlapping shots — never summed).
  const adjust = { distYds: {}, aimYds: {} };
  for (const c of kept) {
    c.applies = applies(c.group);
    if (!c.applies) continue;
    const bucket = c.axis === "distance" ? adjust.distYds : adjust.aimYds;
    for (const [f, v] of Object.entries(c.shiftYds)) {
      if (bucket[f] == null || Math.abs(v) > Math.abs(bucket[f])) bucket[f] = r1(v);
    }
  }
  if (Object.keys(adjust.aimYds).length) adjust.clampTo = ["fairway", "green"];

  // Nudges: one line per group; distance and direction in the same group share the line (§5.5).
  const nudges = [];
  const byGroup = new Map();
  for (const c of kept) {
    if (!c.applies) continue;
    const k = `${c.group.kind}:${c.group.key}`;
    if (!byGroup.has(k)) byGroup.set(k, { group: c.group, dist: null, dirn: null });
    byGroup.get(k)[c.axis === "distance" ? "dist" : "dirn"] = c;
  }
  for (const { group, dist, dirn } of byGroup.values()) {
    const union = [];
    for (const s of [...(dist?.shots || []), ...(dirn?.shots || [])]) if (!union.includes(s)) union.push(s);
    const ordered = chronological(union);
    const word = [dist && (dist.dir === "short" ? "Short" : "Long"), dirn && (dirn.dir === "left" ? "left" : "right")]
      .filter(Boolean).join("-");
    const head = word.charAt(0).toUpperCase() + word.slice(1);
    const fixes = [];
    if (dist) {
      const f = group.kind === "family" ? group.key : null;
      const shift = f ? dist.shiftYds[f] : dist.rawShiftYds;
      const gap = f ? gaps[f] ?? DEFAULT_GAP_YDS : mean(FAMILIES.map((x) => gaps[x] ?? DEFAULT_GAP_YDS));
      fixes.push(clubText(Math.max(-gap * capClubs, Math.min(gap * capClubs, shift)), gap));
    }
    if (dirn) fixes.push(dirn.dir === "left" ? "aim right-center" : "aim left-center");
    nudges.push({
      axis: dist && dirn ? "distance+direction" : dist ? "distance" : "direction",
      text: `${head} ${timesWord(ordered.length)} ${groupPhrase(group)} (${holeList(ordered)}) → ${fixes.join(", ")}`,
    });
  }

  // Contact (§5.5): flag only, never a number.
  const flags = [];
  for (const c of keptContact) {
    c.applies = applies(c.group);
    if (!c.applies) continue;
    const ordered = chronological(c.shots);
    const what = c.group.kind === "family" ? FAMILY_NOUN[c.group.key] || c.group.key : `shots ${LIE_PHRASE[c.group.key] || `from ${c.group.key}`}`;
    flags.push({ type: "contact", text: `${ordered.length} ${c.dir} ${what} today (${holeList(ordered)})` });
  }

  const report = [...kept, ...keptContact.map((c) => ({ ...c, axis: "contact" }))].map((c) => ({
    group: c.group, axis: c.axis, dir: c.dir, applies: !!c.applies,
    meanMissYds: c.meanMissYds ?? null, rawShiftYds: c.rawShiftYds ?? null, shiftYds: c.shiftYds ?? null,
    capped: !!c.capped, clampTo: c.clampTo, holes: chronological(c.shots).map((s) => s.hole),
    shotIds: c.shots.map((s) => s.id ?? null),
  }));
  return { adjust, nudges, flags, corrections: report };
}

/* ---------- §5.3 recency ---------- */

/** Weight of a Loop-logged round `roundsAgo` rounds back (1 = most recent), `ageMonths` old. */
export function recencyWeight(roundsAgo, ageMonths, config) {
  const cfg = cfgOf(config);
  const maxMonths = cfg.RECENCY_MAX_MONTHS ?? DEFAULT_CONFIG.RECENCY_MAX_MONTHS;
  if (num(ageMonths) && ageMonths > maxMonths) return 0;
  const r = Math.max(1, Math.floor(roundsAgo ?? 1));
  for (const [upTo, w] of cfg.RECENCY_TIERS || DEFAULT_CONFIG.RECENCY_TIERS) if (r <= upTo) return w;
  return 0;
}

/* ---------- §5.4 shrinkage ---------- */

/** (nEff·personal + K·prior) / (nEff + K). A missing side returns the other. */
export function shrink(personal, prior, nEff, K = DEFAULT_CONFIG.SHRINK_K) {
  if (personal == null || !num(personal)) return prior ?? null;
  if (prior == null || !num(prior)) return personal;
  if (!(nEff > 0)) return prior;
  return (nEff * personal + K * prior) / (nEff + K);
}

/**
 * §5.4 prior for one field: Shot Pattern's value for the same entry → same club, adjacent lie →
 * adjacent club (nearest in clubOrder first), same lie. Null when none exists (caller falls back
 * to the scratch baseline). Returns { value, club, swing, lie, rank }.
 */
export function priorFor(P, club, swing, lie, field) {
  const { LIE_CHAIN, neighbours } = profileInternal;
  const get = (id, l) => {
    const e = P?.clubs?.get?.(id)?.entries?.[swing]?.[l];
    return e && e[field] != null ? e[field] : null;
  };
  const own = get(club, lie);
  if (own != null) return { value: own, club, swing, lie, rank: "entry" };
  for (const l of (LIE_CHAIN[lie] || LIE_CHAIN.fairway)) {
    if (l === lie) continue;
    const v = get(club, l);
    if (v != null) return { value: v, club, swing, lie: l, rank: "adjacentLie" };
  }
  if (P?.clubOrder?.includes(club)) {
    for (const id of neighbours(P, club)) {
      const v = get(id, lie);
      if (v != null) return { value: v, club: id, swing, lie, rank: "adjacentClub" };
    }
  }
  return null;
}

/* ---------- §5.2 overlays from the shot log ---------- */

export const entryKey = (club, swing, lie) => `${club}|${swing}|${lie}`;

function wSum(ws) { return ws.reduce((a, b) => a + b, 0); }
function wMean(xs, ws) { const W = wSum(ws); return W > 0 ? xs.reduce((a, x, i) => a + x * ws[i], 0) / W : null; }
/** Reliability-weighted variance; null with fewer than two effective points. */
function wVar(xs, ws, m = wMean(xs, ws)) {
  const W = wSum(ws), W2 = ws.reduce((a, w) => a + w * w, 0);
  const den = W - W2 / W;
  if (!(W > 0) || !(den > 1e-12)) return null;
  return xs.reduce((a, x, i) => a + ws[i] * (x - m) ** 2, 0) / den;
}
function wCov(xs, ys, ws) {
  const mx = wMean(xs, ws), my = wMean(ys, ws);
  const W = wSum(ws), W2 = ws.reduce((a, w) => a + w * w, 0);
  const den = W - W2 / W;
  if (!(den > 1e-12)) return null;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += ws[i] * dx * dx; syy += ws[i] * dy * dy; sxy += ws[i] * dx * dy;
  }
  return { mx, my, sxx: sxx / den, syy: syy / den, sxy: sxy / den };
}
function wMedian(xs, ws) {
  if (!xs.length) return null;
  const pts = xs.map((x, i) => ({ x, w: ws[i] })).sort((a, b) => a.x - b.x);
  const half = wSum(ws) / 2;
  let cum = 0;
  for (let i = 0; i < pts.length; i++) {
    cum += pts[i].w;
    if (Math.abs(cum - half) < 1e-9 && i + 1 < pts.length) return (pts[i].x + pts[i + 1].x) / 2;
    if (cum > half) return pts[i].x;
  }
  return pts[pts.length - 1].x;
}

/**
 * Loop's 80% ellipse from (lateral, distance-miss) pairs, in Shot Pattern's frame: +x right,
 * +y SHORT (so y = −distanceMiss). Principal axes of the 2×2 covariance; wYds / hYds are FULL
 * axes (2 × 1.794 σ); tiltDeg is the major axis, clockwise from +x in that frame, in [0, 180).
 */
export function fitEll80(lateralYds, distanceMissYds, weights = null, extra = {}) {
  const ws = weights || lateralYds.map(() => 1);
  const ys = distanceMissYds.map((d) => -d);
  const c = wCov(lateralYds, ys, ws);
  if (!c) return null;
  const half = (c.sxx + c.syy) / 2;
  const disc = Math.sqrt(Math.max(0, ((c.sxx - c.syy) / 2) ** 2 + c.sxy ** 2));
  const l1 = half + disc, l2 = Math.max(0, half - disc);
  const theta = 0.5 * Math.atan2(2 * c.sxy, c.sxx - c.syy);
  const tiltDeg = (((theta / DEG) % 180) + 180) % 180;
  return {
    wYds: 2 * ELL80_K * Math.sqrt(l1),
    hYds: 2 * ELL80_K * Math.sqrt(l2),
    tiltDeg,
    dxYds: c.mx,
    dyYds: c.my,
    source: "loop",
    ...extra,
  };
}

function roundIndexFrom(shots) {
  const last = new Map();
  shots.forEach((s, i) => {
    const t = s.ts ? Date.parse(s.ts) : NaN;
    const key = Number.isFinite(t) ? t : i;
    if (!last.has(s.roundId) || key > last.get(s.roundId)) last.set(s.roundId, key);
  });
  const order = [...last.entries()].sort((a, b) => b[1] - a[1]);
  const out = {};
  order.forEach(([id], i) => { out[id] = i + 1; });
  return out;
}

const OVERLAY_FIELDS = ["totalMedianYds", "carryMedianYds", "distSdYds", "lateralSdDeg", "biasDistYds", "biasLatYds"];

/**
 * §5.2 / §5.3 / §5.4. Builds per-entry overlays from Loop's shot log. Never touches `P`.
 *   allShots        — every Loop shot record on the device (any rounds).
 *   now             — Date | ISO | ms, for the 12-month cut-off (omitted → no age cut-off).
 *   roundIndexById  — { [roundId]: roundsAgo } (1 = most recent). Omitted → derived from the
 *                     records' timestamps. Given but missing a round → that round weighs 0.
 * Returns { [club|swing|lie]: overlay }. Below TAKEOVER_N each number is shrunk toward the Shot
 * Pattern prior; at or above it Loop's own numbers stand alone and an `ell80` (source "loop") is fitted.
 */
export function applyShotLog(P, allShots, { now, roundIndexById } = {}, config) {
  const cfg = cfgOf(config ?? P?.config);
  const K = cfg.SHRINK_K ?? DEFAULT_CONFIG.SHRINK_K;
  const N = cfg.TAKEOVER_N ?? DEFAULT_CONFIG.TAKEOVER_N;
  const nowMs = now == null ? null : now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);

  const eligible = (allShots || []).filter((s) =>
    s && s.logged !== "skipped" && !isShortGameOrPutt(s) && SWINGS.has(swingOf(s)) && s.club && lieOf(s) && hasMisses(s));
  const idx = roundIndexById || roundIndexFrom(eligible);
  const roundTime = new Map();
  for (const s of eligible) {
    const t = s.ts ? Date.parse(s.ts) : NaN;
    if (Number.isFinite(t) && (!roundTime.has(s.roundId) || t > roundTime.get(s.roundId))) roundTime.set(s.roundId, t);
  }
  const weightOf = (roundId) => {
    const ago = idx[roundId];
    if (ago == null) return 0;
    const t = roundTime.get(roundId);
    const age = nowMs != null && t != null ? (nowMs - t) / MONTH_MS : null;
    return recencyWeight(ago, age, cfg);
  };

  const buckets = new Map();
  for (const s of eligible) {
    const w = weightOf(s.roundId);
    if (!(w > 0)) continue;
    const key = entryKey(s.club, swingOf(s), lieOf(s));
    if (!buckets.has(key)) buckets.set(key, { club: s.club, swing: swingOf(s), lie: lieOf(s), shots: [], ws: [] });
    const b = buckets.get(key);
    b.shots.push(s); b.ws.push(w);
  }

  const out = {};
  for (const [key, b] of buckets) {
    const { club, swing, lie, shots, ws } = b;
    const fam = familyOf(club) || P?.clubs?.get?.(club)?.family || "mid";
    const n = shots.length;
    const nEff = wSum(ws);
    const dm = shots.map((s) => s.derived.distanceMissYds);
    const lm = shots.map((s) => s.derived.lateralMissYds);

    const act = [], actW = [];
    shots.forEach((s, i) => { const a = actualYds(s); if (a != null) { act.push(a); actW.push(ws[i]); } });

    const priors = {};
    for (const f of ["totalMedianYds", "distSdYds", "lateralSdDeg", "biasDistYds", "biasLatYds"]) priors[f] = priorFor(P, club, swing, lie, f);
    // Biases have a natural baseline of 0 when Shot Pattern has none.
    for (const f of ["biasDistYds", "biasLatYds"]) if (!priors[f]) priors[f] = { value: 0, rank: "zero" };

    // Lateral angle per shot needs a distance: actual → intended → the prior total.
    const ang = [], angW = [];
    shots.forEach((s, i) => {
      const d = actualYds(s) ?? intendedYds(s) ?? priors.totalMedianYds?.value ?? null;
      if (d && d > 0) { ang.push(Math.atan2(s.derived.lateralMissYds, d) / DEG); angW.push(ws[i]); }
    });

    const distVar = wVar(dm, ws), angVar = wVar(ang, angW);
    const personal = {
      totalMedianYds: act.length ? wMedian(act, actW) : null,
      distSdYds: distVar != null ? Math.sqrt(distVar) : null,
      lateralSdDeg: angVar != null ? Math.sqrt(angVar) : null,
      biasDistYds: wMean(dm, ws),
      biasLatYds: wMean(lm, ws),
    };
    const nEffOf = { totalMedianYds: wSum(actW), distSdYds: nEff, lateralSdDeg: wSum(angW), biasDistYds: nEff, biasLatYds: nEff };

    const takeover = n >= N;
    const est = {};
    for (const f of Object.keys(personal)) {
      const pv = priors[f]?.value ?? null;
      est[f] = takeover ? (personal[f] ?? pv) : shrink(personal[f], pv, nEffOf[f], K);
    }
    est.carryMedianYds = est.totalMedianYds != null ? carryFromTotal(est.totalMedianYds, swing, fam, lie, cfg) : null;

    const ov = {
      key, club, swing, lie, family: fam,
      n, nEff, takeover,
      ...Object.fromEntries(OVERLAY_FIELDS.map((f) => [f, est[f] ?? null])),
      personal,
      prior: Object.fromEntries(Object.entries(priors).map(([f, p]) => [f, p ? { ...p } : null])),
      ell80: null,
      shotIds: shots.map((s) => s.id ?? null),
    };
    if (takeover) {
      ov.ell80 = fitEll80(lm, dm, ws, {
        capturedAt: nowMs != null ? new Date(nowMs).toISOString().slice(0, 10) : null,
        lies: lie, n, confidence: "high",
      });
    }
    out[key] = ov;
  }
  return out;
}

/**
 * The entry numbers the engine would use for club × swing × lie: a deep copy of the Shot Pattern
 * entry with the overlay merged in. Below takeover, the shrunk numbers replace the Shot Pattern
 * ones and Shot Pattern's ell80 stays; at takeover Loop's numbers and Loop's ell80 replace them
 * for THIS entry only (§5.2.3, UI addendum §5.2). Null when neither exists.
 */
export function entryWithOverlay(P, overlays, club, swing, lie) {
  const base = P?.clubs?.get?.(club)?.entries?.[swing]?.[lie] || null;
  const ov = overlays?.[entryKey(club, swing, lie)] || null;
  if (!base && !ov) return null;
  const out = base ? JSON.parse(JSON.stringify(base)) : {};
  if (!ov) return { ...out, learning: null };
  const keepMeasuredCarry = !ov.takeover && out.carrySource === "measured";
  for (const f of OVERLAY_FIELDS) {
    if (f === "carryMedianYds" && keepMeasuredCarry) continue;
    if (ov[f] != null) out[f] = ov[f];
  }
  if (ov.carryMedianYds != null && !keepMeasuredCarry) out.carrySource = "derived";
  if (ov.takeover) {
    out.n = ov.n;
    out.ell80 = ov.ell80 ? { ...ov.ell80 } : null;
  }
  out.learning = { n: ov.n, nEff: ov.nEff, takeover: ov.takeover, source: ov.takeover ? "loop" : "blend" };
  return out;
}

/* ---------- §5.6 lie-override learning ---------- */

/** Metres between two { lat, lng } points (haversine). Local so this module needs no geometry import. */
function haversineM(a, b) {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function gpsOf(o) {
  const g = o?.gps || o?.point || o;
  return g && num(g.lat) && num(g.lng) ? g : null;
}

/**
 * §5.6. `overrides` = stored lie-chip corrections { courseId, hole, gps: {lat, lng}, inferred,
 * corrected, ts }. Returns the corrected value when ≥ 2 corrections to that value on this course
 * lie within `radiusM` of each other and the point is within `radiusM` of both; else null. Several
 * qualifying values → the one with the most corrections near the point, then the most recent.
 */
export function lieOverrideAt(overrides, point, courseId, { radiusM = LIE_OVERRIDE_RADIUS_M, minCount = LIE_OVERRIDE_MIN } = {}) {
  if (!point || !num(point.lat) || !num(point.lng)) return null;
  const near = (overrides || []).filter((o) => o && o.courseId === courseId && o.corrected && gpsOf(o) && haversineM(gpsOf(o), point) <= radiusM);
  const byValue = new Map();
  for (const o of near) {
    if (!byValue.has(o.corrected)) byValue.set(o.corrected, []);
    byValue.get(o.corrected).push(o);
  }
  let best = null;
  for (const [value, list] of byValue) {
    if (list.length < minCount) continue;
    // Members that have at least minCount − 1 others of the same value within radius.
    const clustered = list.filter((a) => list.filter((b) => b !== a && haversineM(gpsOf(a), gpsOf(b)) <= radiusM).length >= minCount - 1);
    if (clustered.length < minCount) continue;
    const latest = Math.max(...clustered.map((o) => (o.ts ? Date.parse(o.ts) : 0) || 0));
    if (!best || clustered.length > best.count || (clustered.length === best.count && latest > best.latest)) {
      best = { value, count: clustered.length, latest };
    }
  }
  return best ? best.value : null;
}

/* ---------- §5.7 aggression scorecard ---------- */

const LINES = ["safe", "aggressive", "own"];

function holeScore(holeScores, roundId, hole) {
  const r = holeScores?.[roundId];
  if (r == null) return null;
  const v = Array.isArray(r) ? r[hole - 1] : r[hole];
  return num(v) ? v : null;
}

/** Engine expScore at the time for the line played. Own call → the SAFE expScore (best from that spot). */
function expFor(s) {
  const rec = s.recommendation || {};
  const pick = s.linePlayed === "aggressive" ? rec.aggressive || rec.safe : rec.safe;
  const v = pick?.expScore ?? (s.linePlayed === "own" ? rec.own?.expScore : undefined) ?? s.expScore;
  return num(v) ? v : null;
}

function tally(shots, holeScores) {
  const out = {};
  for (const l of LINES) out[l] = { n: 0, scored: 0, delta: 0 };
  for (const s of shots) {
    const t = out[s.linePlayed];
    if (!t) continue;
    t.n++;
    const hs = holeScore(holeScores, s.roundId, s.hole);
    const exp = expFor(s);
    if (hs == null || exp == null || !num(s.shotNo)) continue;
    t.scored++;
    t.delta += hs - (s.shotNo - 1) - exp;          // actual strokes to hole out − expected
  }
  for (const l of LINES) out[l].delta = Math.round(out[l].delta * 1000) / 1000;
  const a = out.aggressive;
  if (a.scored) {
    const gain = -a.delta;                           // strokes saved vs. the engine's price
    out.text = gain >= 0 ? `Aggression paid +${gain.toFixed(1)}` : `Aggression cost ${MINUS}${Math.abs(gain).toFixed(1)}`;
  } else out.text = null;
  return out;
}

/**
 * §5.7. `shots` = shot records (any rounds) with `linePlayed`; `holeScores` = { [roundId]: { [hole]: strokes } }
 * (or an array, index hole − 1). delta per line = Σ(actual strokes-to-hole-out − expScore), where
 * actual = hole score − (shotNo − 1); negative = better than priced. `text` reads the aggressive
 * line: "Aggression paid +0.8" when it beat its price, "Aggression cost −1.4" when not; null with
 * no priced aggressive shots. Returns the season tally plus `rounds: { [roundId]: tally }`.
 * Display only — nothing here feeds a recommendation.
 */
export function aggressionScorecard(shots, holeScores) {
  const list = (shots || []).filter((s) => s && LINES.includes(s.linePlayed) && !isShortGameOrPutt(s));
  const season = tally(list, holeScores);
  const rounds = {};
  const ids = [...new Set(list.map((s) => s.roundId))];
  for (const id of ids) rounds[id] = tally(list.filter((s) => s.roundId === id), holeScores);
  return { ...season, rounds };
}

export const _internal = { readShot, evidenceFor, clubText, haversineM, wMedian, wVar, ELL80_K, FAMILIES };
