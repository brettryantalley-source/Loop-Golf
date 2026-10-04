/*
 * profile.js — loads profile v2 (docs/PROFILE-v2.md) and answers the engine's questions about
 * Brett's numbers: which club entry applies here, what it carries, how it scatters, and the three
 * expected-value functions of spec §3.5 — E(), Eputt(), B().
 *
 * Fallback order (spec §5.4) whenever a field is null:
 *   same entry → same club, adjacent lie → adjacent club, same lie → scratch baseline / config.
 * Every resolved field carries provenance so a reason string can only ever cite a real number.
 *
 * Pure functions. No DOM, no storage, no network. Nothing here writes to the profile (T32).
 */

import { DEFAULT_CONFIG, CLUB_FAMILY, lieDistAdj } from "./config.js";
import { baselineE, baselinePutts } from "./baseline.js";

const ENTRY_LIES = ["tee", "fairway", "rough"];
/** Which stored lie a context lie reads first, then the adjacent lies in order. */
const LIE_CHAIN = Object.freeze({
  tee: ["tee", "fairway", "rough"],
  fairway: ["fairway", "tee", "rough"],
  rough: ["rough", "fairway", "tee"],
  sand: ["rough", "fairway", "tee"],
  recovery: ["rough", "fairway", "tee"],
});
/** Fields a resolved entry exposes (and that reason templates may cite). */
const ENTRY_FIELDS = [
  "n", "totalMedianYds", "carryMedianYds", "distSdYds", "lateralSdDeg", "biasDistYds", "biasLatYds",
  "leftPct", "rightPct", "shortPct", "bigMissPct", "mishitPct", "penaltyPct", "recoveryPct", "penaltyCount",
  "girPct", "medianProximityFt", "sgPerShot", "blended",
];

/* ---------- loading ---------- */

/**
 * `opts.overlays` (optional, S5): learning.js `applyShotLog` output, { [club|swing|lie]: overlay }.
 * Stored on `P.overlays` and merged over the matching Shot Pattern entry inside `resolveEntry`
 * (see `entryAt`). `P.raw` stays Shot Pattern only and is never written (§5.2, T32).
 */
export function loadProfile(json, config = DEFAULT_CONFIG, opts = {}) {
  if (!json || json.version !== 2) throw new Error("profile: expected version 2");
  const clubs = new Map();
  for (const c of json.clubs) {
    if (clubs.has(c.id)) throw new Error(`profile: duplicate club ${c.id}`);
    clubs.set(c.id, c);
  }
  for (const id of json.clubOrder) if (!clubs.has(id)) throw new Error(`profile: clubOrder names unknown club ${id}`);
  const buckets = {};
  for (const b of json.approachBuckets) (buckets[b.lie] ||= []).push(b);
  for (const lie of Object.keys(buckets)) buckets[lie].sort((a, b) => a.fromYds - b.fromYds);
  const putting = [...json.putting].sort((a, b) => a.fromFt - b.fromFt);
  const shortGame = {};
  for (const b of json.shortGame?.bands || []) (shortGame[b.lie] ||= []).push(b);
  const P = {
    raw: json,
    config,
    clubs,
    clubOrder: [...json.clubOrder],
    buckets,
    putting,
    shortGame,
    puttDeficitPerHole: config.PUTT_DEFICIT_IN_E && typeof json.puttingSgPer18 === "number" ? -json.puttingSgPer18 / 18 : 0,
    scratchLateralSdDeg: json.benchmarks?.scratch?.driving?.lateralSdDeg ?? null,
    overlays: opts?.overlays && Object.keys(opts.overlays).length ? opts.overlays : null,
    _ov: new Map(),
    _b3: new Map(),
    _E: new Map(),
    _Ep: new Map(),
    _B2: new Map(),
  };
  return P;
}

/** Club family for an id (config table first, then the profile's own label). */
export function familyOf(P, clubId) {
  return CLUB_FAMILY[clubId] || P.clubs.get(clubId)?.family || "mid";
}

/** Fairway roll-out for a club: the per-club table first, then its family (spec §3.3, Brett's numbers).
 *  Tee entries of tee clubs use total (roll 0). */
export function rollYds(clubId, swing, family, lie, config) {
  if (lie === "tee" && family === "long") return config.ROLL_YDS.tee;
  const perClub = swing === "full" ? config.ROLL_YDS.club?.[clubId] : null;
  return perClub ?? config.ROLL_YDS[swing]?.[family] ?? 0;
}

/**
 * carry = total − roll (spec §3.3). Carry is carry: ground conditions change the roll, not the
 * carry (integration item 6), so `_wet` is accepted for old callers and ignored.
 */
export function carryFromTotal(total, swing, family, lie, config, _wet = false, clubId = null) {
  if (total == null) return null;
  return total - rollYds(clubId, swing, family, lie, config);
}

/** Ground-conditions roll multiplier for a family (config ROLL_COND_MULT; unknown → 1). */
export function rollCondMult(config, conditions, family) {
  const m = config?.ROLL_COND_MULT?.[conditions]?.[family];
  return Number.isFinite(m) ? m : 1;
}

/** opts.conditions ("wet" | "firm" | "normal"); the pre-v22.11 `{ wet: true }` still means wet. */
function conditionsOf(opts) {
  if (opts?.conditions) return opts.conditions;
  return opts?.wet ? "wet" : "normal";
}

/* ---------- entry resolution (§5.4) ---------- */

function rawEntry(club, swing, lie) {
  const s = club.entries?.[swing];
  if (!s) return null;
  return s[lie] || null;
}

/* ---------- S5 learning overlays (§5.2–§5.4) ---------- */

/** Overlay numbers merged over the Shot Pattern entry (same list as learning.js OVERLAY_FIELDS). */
const OVERLAY_FIELDS = ["totalMedianYds", "carryMedianYds", "distSdYds", "lateralSdDeg", "biasDistYds", "biasLatYds"];
/** Display-safe rounding: distances to the yard (Shot Pattern's own resolution), σ / bias to 0.01. */
const OVERLAY_ROUND = { totalMedianYds: 1, carryMedianYds: 1, distSdYds: 100, lateralSdDeg: 100, biasDistYds: 100, biasLatYds: 100 };
const roundTo = (v, k) => Math.round(v * k) / k;

/**
 * One entry with its learning overlay merged in — the same rules as learning.js
 * `entryWithOverlay`: below takeover the shrunk numbers replace Shot Pattern's (a measured carry
 * is kept) and Shot Pattern's ell80 stays; at takeover Loop's numbers and ell80 (source "loop",
 * carrying Loop's shot count as ell80.n) replace them for THIS entry only. One deliberate
 * difference from entryWithOverlay: `n` is not replaced (see below). A NEW object; `base` is not touched. `learning` says
 * which fields came from Loop, for provenance.
 */
export function mergeOverlay(base, ov) {
  if (!ov) return base;
  const out = base ? { ...base } : {};
  const keepMeasuredCarry = !ov.takeover && out.carrySource === "measured";
  const fromLoop = [];
  for (const f of OVERLAY_FIELDS) {
    if (f === "carryMedianYds" && keepMeasuredCarry) continue;
    if (ov[f] != null && Number.isFinite(ov[f])) { out[f] = roundTo(ov[f], OVERLAY_ROUND[f]); fromLoop.push(f); }
  }
  if (ov.carryMedianYds != null && !keepMeasuredCarry) out.carrySource = "derived";
  if (ov.takeover) {
    // `n` stays Shot Pattern's: the reason templates pair it with Shot Pattern-only stats (GIR,
    // proximity, penalties), so Loop's count lives on `learning.n` and the ellipse (ell80.n).
    out.ell80 = ov.ell80 ? { ...ov.ell80 } : null;
    if (out.ell80) fromLoop.push("ell80");
  }
  out.learning = { n: ov.n, nEff: ov.nEff, takeover: !!ov.takeover, source: ov.takeover ? "loop" : "blend", fields: fromLoop };
  return out;
}

/** The entry resolveEntry reads for club × swing × lie: Shot Pattern's, with P.overlays merged (memoised per P). */
function entryAt(P, club, swing, lie) {
  const base = rawEntry(club, swing, lie);
  const ov = P.overlays ? P.overlays[`${club.id}|${swing}|${lie}`] : null;
  if (!ov) return base;
  const k = `${club.id}|${swing}|${lie}`;
  if (!P._ov) P._ov = new Map();
  if (!P._ov.has(k)) P._ov.set(k, mergeOverlay(base, ov));
  return P._ov.get(k);
}

function hasOverlayFor(P, clubId, swing) {
  if (!P.overlays) return false;
  const pre = `${clubId}|${swing}|`;
  return Object.keys(P.overlays).some((k) => k.startsWith(pre));
}

/** Provenance for a field read from `entry` on `lie`: marks Loop's numbers with source "loop" and n. */
function provFor(entry, f, clubId, swing, lie) {
  const p = { club: clubId, swing, lie };
  const L = entry?.learning;
  if (L && L.fields.includes(f)) { p.source = "loop"; p.n = L.n; p.takeover = L.takeover; }
  return p;
}

function firstNonNull(chain, field) {
  for (const { entry, lie } of chain) {
    if (entry && entry[field] != null) return { value: entry[field], lie };
  }
  return null;
}

/**
 * The numbers the simulation uses for `clubId` × `swing` from `lie`, with fallbacks applied.
 * Returns null when the club has no usable distance for this swing type at all (not a candidate).
 * opts.conditions ("wet" | "firm" | "normal", default normal) scales the roll by ROLL_COND_MULT.
 */
export function resolveEntry(P, clubId, swing, lie, opts = {}) {
  const cfg = P.config;
  const club = P.clubs.get(clubId);
  if (!club || !(club.entries?.[swing] || hasOverlayFor(P, clubId, swing))) return null;
  const chainLies = LIE_CHAIN[lie] || LIE_CHAIN.fairway;
  const chain = chainLies.map((l) => ({ entry: entryAt(P, club, swing, l), lie: l }));
  if (!chain.some((c) => c.entry)) return null;

  const fields = {};
  const provenance = {};
  for (const f of ENTRY_FIELDS) {
    const hit = firstNonNull(chain, f);
    fields[f] = hit ? hit.value : null;
    if (hit) provenance[f] = provFor(chain.find((c) => c.lie === hit.lie).entry, f, clubId, swing, hit.lie);
  }
  if (fields.totalMedianYds == null) return null;

  const family = familyOf(P, clubId);
  const srcLie = provenance.totalMedianYds.lie;
  // Carry: derive from total unless a measured carry exists on the same lie the total came from.
  const measured = firstNonNull(chain, "carryMedianYds");
  let carry = measured && measured.lie === srcLie && entryAt(P, club, swing, srcLie)?.carrySource === "measured"
    ? measured.value
    : carryFromTotal(fields.totalMedianYds, swing, family, srcLie, cfg, false, clubId);
  // Lie adjustment when the distance came from a different lie than the one we are on
  // (per family for rough: integration item 7).
  const adjReq = lieDistAdj(cfg, lie, family), adjSrc = lieDistAdj(cfg, srcLie, family);
  const lieFactor = (1 + adjReq) / (1 + adjSrc);
  carry = carry * lieFactor;
  const sdReq = cfg.LIE_SD_MULT[lie] ?? 1, sdSrc = cfg.LIE_SD_MULT[srcLie] ?? 1;
  const sdMult = sdReq / sdSrc;

  // Lateral σ: same club chain → adjacent clubs same swing/lie → scratch benchmark.
  let lateralSdDeg = fields.lateralSdDeg;
  if (lateralSdDeg == null) {
    const nb = neighbours(P, clubId);
    for (const id of nb) {
      const e = P.clubs.get(id);
      const hit = firstNonNull(chainLies.map((l) => ({ entry: entryAt(P, e, swing, l) || entryAt(P, e, "full", l), lie: l })), "lateralSdDeg");
      if (hit) { lateralSdDeg = hit.value; provenance.lateralSdDeg = { club: id, swing, lie: hit.lie }; break; }
    }
    if (lateralSdDeg == null && P.scratchLateralSdDeg != null) {
      lateralSdDeg = P.scratchLateralSdDeg;
      provenance.lateralSdDeg = { benchmark: "scratch" };
    }
    if (lateralSdDeg == null) return null;
    fields.lateralSdDeg = lateralSdDeg;
  }

  const distSd = fields.distSdYds != null ? fields.distSdYds * (carry / fields.totalMedianYds) : cfg.DIST_SD_PCT[family] * carry;
  if (fields.distSdYds == null) provenance.distSdYds = { config: "DIST_SD_PCT" };
  const bmRaw = firstNonNull(chain, "bigMiss");
  const bigMiss = {
    left: bmRaw?.value?.left ?? 0,
    right: bmRaw?.value?.right ?? 0,
    latYds: bmRaw?.value?.latYds ?? cfg.BIG_MISS_LAT_YDS_DEFAULT,
  };

  // Roll after landing: the fairway roll-out (total − carry before the lie adjustment) times the
  // lie multiplier — out of the rough the ball comes in with less spin and runs about three times
  // as far (Brett, Sep 29; D33) — times the ground-conditions multiplier (item 6). 0 off a tee
  // for tee clubs.
  const conditions = conditionsOf(opts);
  const roll = Math.max(0, fields.totalMedianYds - carry / lieFactor) * (cfg.ROLL_LIE_MULT?.[lie] ?? 1) * rollCondMult(cfg, conditions, family);
  // §5 UI addendum: Shot Pattern's 80% ellipse is the dispersion core where it exists.
  const ellHit = firstNonNull(chain, "ell80");
  const ell80 = ellHit ? { ...ellHit.value, sdMult } : null;
  if (ell80) provenance.ell80 = provFor(chain.find((c) => c.lie === ellHit.lie).entry, "ell80", clubId, swing, ellHit.lie);

  return {
    club: clubId,
    label: club.label,
    family,
    swing,
    lie,
    sourceLie: srcLie,
    conditions,
    carry,
    total: fields.totalMedianYds,
    roll,
    distSd: distSd * sdMult,
    lateralSd: carry * Math.tan((lateralSdDeg * Math.PI) / 180) * sdMult,   // yards, lie-widened like distSd
    lieSdMult: sdMult,
    lateralSdDeg,
    biasDist: fields.biasDistYds ?? 0,
    biasLat: fields.biasLatYds ?? 0,
    bigMiss,
    ell80,
    fields,
    provenance,
  };
}

/** Clubs adjacent to `clubId` in clubOrder, nearest first. */
function neighbours(P, clubId) {
  const i = P.clubOrder.indexOf(clubId);
  const out = [];
  for (let k = 1; k < P.clubOrder.length; k++) {
    if (i - k >= 0) out.push(P.clubOrder[i - k]);
    if (i + k < P.clubOrder.length) out.push(P.clubOrder[i + k]);
  }
  return out;
}

/** Every (club, swing) pair that resolves from this lie. */
export function candidateEntries(P, lie, opts = {}) {
  const out = [];
  const teeOnlyFull = P.config?.TEE_ONLY_FULL || [];
  for (const id of P.clubOrder) {
    for (const swing of ["full", "finesse"]) {
      if (swing === "full" && lie !== "tee" && teeOnlyFull.includes(id)) continue;   // D79: no full Dr / 2i off the deck
      const e = resolveEntry(P, id, swing, lie, opts);
      if (e) out.push(e);
    }
  }
  return out;
}

/* ---------- personal strokes gained lookups ---------- */

const BUCKET_LIE = { tee: "fairway", fairway: "fairway", rough: "rough", sand: null, recovery: null, trees: null };
const SHORT_LIE = { tee: "fairway", fairway: "fairway", rough: "rough", sand: "bunker", recovery: "rough", trees: "rough" };

export function bucketFor(P, d, lie) {
  const bl = BUCKET_LIE[lie];
  if (!bl) return null;
  const list = P.buckets[bl] || [];
  for (const b of list) if (d >= b.fromYds && d < b.toYds) return b;
  return null;
}

export function shortBandFor(P, d, lie) {
  const list = P.shortGame[SHORT_LIE[lie]] || [];
  for (const b of list) if (d >= b.fromYds && d < b.toYds) return b;
  return null;
}

/**
 * Brett's strokes gained per shot from `d` on `lie`, or null where he has no data (no bucket, or a
 * bucket without a measured sgPerShot). A measured 0 stays 0. E() puts the handicap prior in
 * where this is null.
 */
export function personalSg(P, d, lie) {
  const b = d < 50 ? shortBandFor(P, d, lie) : bucketFor(P, d, lie);
  return b && Number.isFinite(b.sgPerShot) ? b.sgPerShot : null;
}

/**
 * The handicap prior (integration item 2): HCP_BLEND × (J_90(d) − J_tour(d)) with both tee lines
 * J = a + b·d from config HCP_LINE (Broadie 2012 / 2008). = 0.42 × (0.41 + 0.0025·d) by default.
 */
export function handicapPrior(cfg, d) {
  const blend = cfg?.HCP_BLEND ?? 0;
  const t = cfg?.HCP_LINE?.tour, n = cfg?.HCP_LINE?.ninety;
  if (!blend || !t || !n) return 0;
  return blend * ((n[0] - t[0]) + (n[1] - t[1]) * d);
}

/* ---------- §3.5 expected-value functions ---------- */

/**
 * Brett's putting gap at the distance a shot from (d, lie) typically leaves: Eputt(prox) minus the
 * baseline's expected putts from there. The baseline assumes a Tour putter after the shot; this
 * swaps in Brett's, at his own median proximity for that bucket. Falls back to his flat per-hole
 * putting deficit when the bucket has no proximity.
 */
export function puttingGapAt(P, d, lie) {
  if (!P.config.PUTT_DEFICIT_IN_E) return 0;
  const b = d < 50 ? shortBandFor(P, d, lie) : bucketFor(P, d, lie) || (lie === "sand" || lie === "recovery" || lie === "trees" ? bucketFor(P, d, "rough") : null);
  const prox = b?.medianProximityFt;
  if (prox == null) return P.puttDeficitPerHole;
  return Math.max(0, Eputt(P, prox) - baselinePutts(prox));
}

/**
 * E(d, lie): baseline − Brett's SG per shot for the bucket + his putting gap at the typical leave.
 * No bucket → baseline + the handicap prior instead of the SG term. BASELINE_SCRATCH_OFFSET after.
 */
export function E(P, d, lie) {
  const l = lie === "trees" ? "recovery" : lie === "green" ? "fairway" : lie;
  const dr = Math.round(d);                       // 1-yd resolution is finer than any input; the
  const key = `${l}|${dr}`;                       // memo key and the value must use the same d
  const hit = P._E.get(key);
  if (hit !== undefined) return hit;
  const sg = personalSg(P, dr, l);
  const personal = sg == null ? handicapPrior(P.config, dr) : -sg;
  const base = baselineE(dr, l) + personal + (P.config.BASELINE_SCRATCH_OFFSET || 0);
  const v = base + puttingGapAt(P, dr, l);
  P._E.set(key, v);
  return v;
}

export function puttBucket(P, ft) {
  for (const b of P.putting) if (ft >= b.fromFt && (b.toFt == null || ft < b.toFt + 1)) return b;
  return P.putting[P.putting.length - 1];
}

export function makePct(P, ft) { return puttBucket(P, ft)?.makePct ?? 0; }
export function threePuttPct(P, ft) { return puttBucket(P, ft)?.threePuttPct ?? 0; }

/** Eputt(ft) = 1 + (1 − make) + threePutt, from Brett's putting table. */
export function Eputt(P, ft) {
  const key = Math.round(ft);
  const hit = P._Ep.get(key);
  if (hit !== undefined) return hit;
  const v = 1 + (1 - makePct(P, key)) + threePuttPct(P, key);
  P._Ep.set(key, v);
  return v;
}

/** Probability of holing the next shot + one putt from `d` on `lie`: GIR% × make(median proximity). */
export function B2(P, d, lie) {
  const dr = Math.round(d);
  const key = `${lie}|${dr}`;
  const hit = P._B2.get(key);
  if (hit !== undefined) return hit;
  const v = B2raw(P, dr, lie);
  P._B2.set(key, v);
  return v;
}

function B2raw(P, d, lie) {
  if (d < 50) {
    const band = shortBandFor(P, d, lie);
    return band?.upDownPct ?? 0;
  }
  let b = bucketFor(P, d, lie);
  if (!b && (lie === "sand" || lie === "recovery" || lie === "trees")) b = bucketFor(P, d, "rough");
  if (!b) {
    const list = P.buckets[BUCKET_LIE[lie] || "rough"] || [];
    b = list.length ? list[list.length - 1] : null;     // beyond the last bucket → the last one
  }
  if (!b || b.girPct == null || b.medianProximityFt == null) return 0;
  return b.girPct * makePct(P, b.medianProximityFt);
}

/** Best k=2 state reachable with one more (fairway) shot — the §3.5 approximation for k ≥ 3. */
export function B3(P, d) {
  const key = Math.round(d);
  if (P._b3.has(key)) return P._b3.get(key);
  let best = 0;
  for (const e of candidateEntries(P, "fairway")) {
    const leave = key - e.carry;
    if (leave < 0) continue;
    best = Math.max(best, B2(P, leave, "fairway"));
  }
  P._b3.set(key, best);
  return best;
}

/**
 * B(state, k): probability of holing out in ≤ k more strokes.
 * state = { lie: 'green', ft } | { lie, d }
 */
export function B(P, state, k) {
  if (k <= 0) return 0;
  if (state.lie === "green") {
    if (k === 1) return makePct(P, state.ft);
    if (k === 2) return 1 - threePuttPct(P, state.ft);
    return 1;
  }
  if (k === 1) return 0;
  if (k === 2) return B2(P, state.d, state.lie);
  return B3(P, state.d);
}

export const _internal = { LIE_CHAIN, ENTRY_FIELDS, neighbours };
