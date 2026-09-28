/*
 * engine.js — the caddie decision engine (spec §3). Two priced options at every ball.
 *
 * recommend(ctx, hole, P) → the §3.9 output contract. Everything is a pure function of its
 * arguments; there is no cache and no clock. The ghost, the match state and the differential are
 * not inputs and cannot become inputs without changing this signature (rule 4, T7).
 *
 * Pipeline: context → plays-like → candidates (§3.4, §3.7) → simulation over Brett's dispersion
 * (§3.5) → SAFE / AGGRESSIVE / same-shot (§3.6) → reason strings from profile fields (§3.10).
 */

import { DEFAULT_CONFIG } from "./config.js";
import { makeSamples } from "./random.js";
import { classify, greenDistances, pinPoint, fatSide, corridorAt, waterEntry, pointAlong, dist, ydsToFt } from "./course.js";
import { candidateEntries, E, Eputt, B } from "./profile.js";
import { reasonFor } from "./reasons.js";

const DEG = Math.PI / 180;

/* ---------- context ---------- */

/** Fill the §3.1 defaults for anything the caller left out. */
export function normalizeContext(ctx, hole) {
  const ball = ctx.ball;
  const lieType = ctx.lieType || (classify(hole, ball) === "ob" ? "rough" : classify(hole, ball));
  return {
    hole: ctx.hole ?? hole.id,
    par: ctx.par ?? hole.par,
    shotNo: ctx.shotNo ?? 1,
    ball,
    lieType: lieType === "trees" ? "recovery" : lieType,
    lieQuality: ctx.lieQuality || "standard",
    lieConfidence: ctx.lieConfidence || "high",
    conditions: ctx.conditions || "normal",
    pinPos: ctx.pinPos || "middle",
    wind: ctx.wind && ctx.wind.speedMph ? { speedMph: ctx.wind.speedMph, fromDeg: ctx.wind.fromDeg ?? 0 } : null,
    elevationDeltaYds: ctx.elevationDeltaYds ?? 0,
    // §5.5 within-round corrections, produced by learning.js (S5) and applied here, never stored:
    //   { distYds: { [family]: +n }   → plays-like shift (positive = the shot plays longer),
    //     aimYds:  { [family]: +n } } → lateral shift of every target (positive = right)
    adjust: ctx.adjust || null,
    nudges: Array.isArray(ctx.nudges) ? ctx.nudges : [],
    flags: Array.isArray(ctx.flags) ? ctx.flags : [],
  };
}

/** Bearing of a → b in the hole frame: 0 = up the hole (+y), 90 = right (+x). */
function bearing(a, b) {
  return Math.atan2(b.x - a.x, b.y - a.y) / DEG;
}

/**
 * §3.3 wind: along-shot yards (positive = plays longer) and crosswind aim offset (positive = the
 * ball is pushed right). `fromDeg` is where the wind blows FROM in the hole frame.
 */
export function windEffect(wind, shotBearingDeg, shotYds, cfg) {
  if (!wind) return { alongYds: 0, crossYds: 0, relative: "calm" };
  const rel = (wind.fromDeg - shotBearingDeg) * DEG;
  const head = wind.speedMph * Math.cos(rel);        // > 0 into the face
  const fromRight = wind.speedMph * Math.sin(rel);   // > 0 blowing from the right → pushes left
  const alongYds = shotYds * (head > 0 ? cfg.HEAD_PCT * head : cfg.TAIL_PCT * head);
  const crossYds = -fromRight * cfg.CROSS_YDS_PER_MPH_PER_100 * (shotYds / 100);
  const eps = wind.speedMph * 0.05;
  const side = fromRight > eps ? "right" : fromRight < -eps ? "left" : "";
  const relative = Math.abs(head) < wind.speedMph * 0.38
    ? `cross-from-${side || "right"}`
    : head > 0 ? (side ? `into-${side}` : "into") : (side ? `down-${side}` : "down");
  return { alongYds, crossYds, relative };
}

/** Plays-like for a shot of `rawYds` in direction `bearingDeg` (§3.3, minus lie which lives in the entry). */
export function playsLike(rawYds, bearingDeg, ctx, cfg) {
  const w = windEffect(ctx.wind, bearingDeg, rawYds, cfg);
  return { yds: rawYds + ctx.elevationDeltaYds * cfg.ELEV_FACTOR + w.alongYds, wind: w };
}

/* ---------- candidates (§3.4, §3.7) ---------- */

function sameTarget(a, b, tol = 3) { return dist(a, b) <= tol; }

/**
 * Where this club would land on average if aimed at `target`: its carry, shortened by the plays-
 * like effects along that line. Returns { mean, dir, perp, bearing, wind }.
 */
function landingModel(entry, ball, target, ctx, cfg) {
  const b = bearing(ball, target);
  const raw = dist(ball, target);
  const pl = playsLike(raw, b, ctx, cfg);
  const q = cfg.LIE_QUALITY[ctx.lieQuality] || cfg.LIE_QUALITY.standard;
  const nudgeDist = ctx.adjust?.distYds?.[entry.family] || 0;
  const mean = entry.carry + entry.biasDist + q.distYds - (pl.yds - raw) - nudgeDist;
  const roll = ctx.conditions === "wet" ? 0 : entry.roll;
  const dir = { x: Math.sin(b * DEG), y: Math.cos(b * DEG) };
  const perp = { x: dir.y, y: -dir.x };                // +x when heading up the hole → right
  // mean = carry (what a green-bound shot is judged on); total = where a fairway-bound shot stops.
  return { mean, total: mean + roll, roll, dir, perp, bearing: b, wind: pl.wind, sdMult: q.sdMult };
}

export function generateCandidates(ctx, hole, P) {
  const cfg = P.config;
  const wet = ctx.conditions === "wet";
  const entries = candidateEntries(P, ctx.lieType, { wet });
  const center = hole.green.center;
  const g = greenDistances(hole, ctx.ball, ctx.pinPos);
  const pin = pinPoint(hole, ctx.ball, ctx.pinPos);
  const fat = fatSide(hole);
  const out = [];
  const push = (c) => {
    const aim = ctx.adjust?.aimYds?.[c.entry.family] || 0;
    if (aim) c.target = { x: c.target.x + aim, y: c.target.y };
    if (out.some((o) => o.club === c.club && o.swing === c.swing && (sameTarget(o.target, c.target) || (o.kind === "layup" && c.kind === "layup")))) return;
    out.push(c);
  };

  const reach = new Map();
  for (const e of entries) {
    const lm = landingModel(e, ctx.ball, center, ctx, cfg);
    reach.set(e, lm.mean >= g.front - cfg.REACH_SHORT_TOLERANCE_YDS && lm.mean <= g.back + cfg.FLY_TOLERANCE_YDS
      ? "reaches" : lm.mean > g.back + cfg.FLY_TOLERANCE_YDS ? "flies" : "short");
  }

  // Green-reachable approach: pin, center, fat side (§3.4).
  for (const e of entries) {
    if (reach.get(e) !== "reaches") continue;
    const targets = [
      { p: pin, label: `green, ${ctx.pinPos === "middle" ? "center" : typeof ctx.pinPos === "string" ? ctx.pinPos + " pin" : "custom pin"}` },
      { p: center, label: "green, center" },
      { p: fat, label: "green, fat side" },
    ];
    for (const t of targets) push({ club: e.club, swing: e.swing, entry: e, kind: "approach", target: t.p, label: t.label });
  }

  // §3.7 layups: leave-distance candidates on the centerline, the nearest club for each.
  const nonReaching = entries.filter((e) => reach.get(e) === "short");
  const dPin = dist(ctx.ball, pin);
  const layups = new Map();                            // one layup candidate per club × swing: its best-fit leave
  for (let L = cfg.LAYUP_MIN_YDS; L <= cfg.LAYUP_MAX_YDS; L += cfg.LAYUP_STEP_YDS) {
    if (dPin - L < 20) break;
    const q = pointAlong(center, ctx.ball, L);          // L short of the green center, on the line
    const need = dist(ctx.ball, q);
    let best = null;
    for (const e of nonReaching) {
      const lm = landingModel(e, ctx.ball, q, ctx, cfg);
      const err = Math.abs(lm.total - need);
      if (lm.total > need + cfg.LAYUP_STEP_YDS) continue;
      if (!best || err < best.err) best = { e, err, total: lm.total };
    }
    if (!best) continue;
    const leave = Math.round(dPin - best.total);
    const key = `${best.e.club}/${best.e.swing}`;
    const prev = layups.get(key);
    if (!prev || best.err < prev.err) layups.set(key, { err: best.err, cand: { club: best.e.club, swing: best.e.swing, entry: best.e, kind: "layup", target: q, label: `leave ${leave}, fairway center` } });
  }
  for (const { cand } of layups.values()) push(cand);

  // Fairway-bound shots (§3.4): aim points across the corridor at the club's distance, plus the
  // centerline. Spread across the corridor only for the long family — a short iron off the tee is
  // a layup and already has its centerline candidate above.
  for (const e of nonReaching) {
    const lm = landingModel(e, ctx.ball, center, ctx, cfg);
    const yLand = ctx.ball.y + lm.total;
    const corr = e.family === "long" ? corridorAt(hole, yLand) : null;
    const xs = [0];
    if (corr) for (let x = Math.ceil(corr[0]); x <= corr[1]; x += cfg.CORRIDOR_STEP_YDS) xs.push(x);
    for (const x of xs) {
      const t = { x, y: yLand };
      const leave = Math.round(dist(t, pin));
      const side = x === 0 ? "center" : x < 0 ? `${Math.abs(x)} left of center` : `${x} right of center`;
      push({ club: e.club, swing: e.swing, entry: e, kind: "corridor", target: t, label: `leave ${leave}, ${side}` });
    }
  }
  return out;
}

/* ---------- simulation (§3.5) ---------- */

/** 80% contour of a 2-D normal sits at √(−2 ln 0.2) σ = 1.794 σ (UI addendum §5.2). */
export const ELL80_K = Math.sqrt(-2 * Math.log(0.2));

/**
 * Sampler for an ell80 entry. Shot Pattern's frame is +x right, +y SHORT, tilt clockwise from +x.
 * Returns { lat, alongMiss } in the engine frame (alongMiss > 0 = long) for two standard normals.
 * Bad / buried lies scale both axes by `qualityMult` (addendum §5.2); their −5 yds is applied
 * once, in landingModel, together with the lie multiplier carried on ell.sdMult.
 */
export function ellipseSampler(ell, qualityMult = 1) {
  const scale = (ell.sdMult || 1) * qualityMult;
  const sw = (ell.wYds / 2 / ELL80_K) * scale, sh = (ell.hYds / 2 / ELL80_K) * scale;
  const t = ell.tiltDeg * DEG, ct = Math.cos(t), st = Math.sin(t);
  const dy = ell.dyYds;
  return (z1, z2) => {
    const a = sw * z1, b = sh * z2;
    const x = ell.dxYds + a * ct - b * st;
    const y = dy + a * st + b * ct;            // + = short
    return { lat: x, alongMiss: -y };
  };
}

function priceLanding(hole, P, ctx, from, landing, lie, k, pin) {
  switch (lie) {
    case "green": {
      const ft = ydsToFt(dist(landing, pin));
      return { strokes: 1 + Eputt(P, ft), birdie: B(P, { lie: "green", ft }, k), trouble: false };
    }
    case "water": {
      const drop = waterEntry(hole, from, landing, P.config.WATER_DROP_STEP_YDS);
      const d = dist(drop, pin);
      return { strokes: 2 + E(P, d, "rough"), birdie: B(P, { lie: "rough", d }, k - 1), trouble: true };
    }
    case "ob": {
      const d = dist(from, pin);
      return { strokes: 2 + E(P, d, ctx.lieType), birdie: B(P, { lie: ctx.lieType, d }, k - 1), trouble: true };
    }
    case "trees": {
      const d = dist(landing, pin);
      return { strokes: 1 + E(P, d, "recovery"), birdie: B(P, { lie: "recovery", d }, k), trouble: true };
    }
    case "sand": {
      const d = dist(landing, pin);
      return { strokes: 1 + E(P, d, "sand"), birdie: B(P, { lie: "sand", d }, k), trouble: true };
    }
    default: {                                   // fairway, rough, tee
      const l = lie === "tee" ? "fairway" : lie;
      const d = dist(landing, pin);
      return { strokes: 1 + E(P, d, l), birdie: B(P, { lie: l, d }, k), trouble: false };
    }
  }
}

export function simulateCandidate(cand, ctx, hole, P, samples) {
  const cfg = P.config;
  const e = cand.entry;
  const pin = pinPoint(hole, ctx.ball, ctx.pinPos);
  const lm = landingModel(e, ctx.ball, cand.target, ctx, cfg);
  const roll = lm.roll;
  // Dispersion core: the ell80 ellipse when measured (UI addendum §5.2), else σ-distance × σ-lateral.
  const ell = e.ell80 ? ellipseSampler(e.ell80, lm.sdMult) : null;
  const sigmaLat = e.lateralSd * lm.sdMult;             // lie-widened in resolveEntry, quality-widened here
  const sigmaD = e.distSd * lm.sdMult;
  const k = ctx.par - 1 - ctx.shotNo;                     // birdie needs this many more after this shot
  let sumStrokes = 0, sumBirdie = 0, trouble = 0;
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    let along, lat;
    if (ell) {
      const d = ell(s.z1, s.z2);
      along = lm.mean - e.biasDist + d.alongMiss;      // ell80 carries its own distance bias (dy)
      lat = lm.wind.crossYds + d.lat;
    } else {
      along = lm.mean + sigmaD * s.z1;
      lat = e.biasLat + lm.wind.crossYds + sigmaLat * s.z2;
    }
    const tailLat = Math.abs(sigmaLat * s.z2) * 0.5;
    if (s.u < e.bigMiss.left) lat = -e.bigMiss.latYds - tailLat;
    else if (s.u < e.bigMiss.left + e.bigMiss.right) lat = e.bigMiss.latYds + tailLat;
    let p = { x: ctx.ball.x + lm.dir.x * along + lm.perp.x * lat, y: ctx.ball.y + lm.dir.y * along + lm.perp.y * lat };
    let lie = classify(hole, p);
    if (lie !== "green" && roll > 0) {
      const q = { x: p.x + lm.dir.x * roll, y: p.y + lm.dir.y * roll };
      const ql = classify(hole, q);
      if (ql !== "water") { p = q; lie = ql; }                     // a ball rolling into water is priced as water anyway
      else { p = q; lie = ql; }
    }
    const r = priceLanding(hole, P, ctx, ctx.ball, p, lie, k, pin);
    sumStrokes += r.strokes;
    sumBirdie += r.birdie;
    if (r.trouble) trouble++;
  }
  return {
    expScore: ctx.shotNo - 1 + sumStrokes / n,
    birdieProb: sumBirdie / n,
    troubleRate: trouble / n,
    meanYds: cand.kind === "approach" ? lm.mean : lm.total,
    distToTarget: dist(ctx.ball, cand.target),
    aimOffsetYds: -lm.wind.crossYds,
  };
}

/* ---------- selection (§3.6) ---------- */

/** Distance between where the club lands on average and where it was aimed — "plays the number". */
const fit = (c) => Math.abs(c.meanYds - c.distToTarget);

function pickOptions(scored, cfg) {
  const tol = cfg.EXP_TIE_TOLERANCE ?? 0;
  const minExp = Math.min(...scored.map((c) => c.expScore));
  const safe = scored.filter((c) => c.expScore <= minExp + tol).reduce((a, b) => (fit(b) < fit(a) ? b : a));
  const aggressive = scored.reduce((a, b) =>
    b.birdieProb > a.birdieProb + 1e-12 || (Math.abs(b.birdieProb - a.birdieProb) <= 1e-12 && b.expScore < a.expScore) ? b : a);
  const sameShot =
    aggressive.birdieProb - safe.birdieProb < cfg.SAME_SHOT_BIRDIE_GAIN ||
    (aggressive.club === safe.club && aggressive.swing === safe.swing && dist(aggressive.target, safe.target) <= cfg.SAME_SHOT_TARGET_YDS);
  return { safe, aggressive, sameShot };
}

function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }

function formatOption(c, P, safeExp) {
  const { text, fields } = reasonFor(c.entry, P);
  const o = {
    club: c.club,
    label: c.entry.label,
    swingType: c.swing,
    target: { x: r2(c.target.x), y: r2(c.target.y), label: c.label },
    kind: c.kind,
    carryYds: Math.round(c.entry.carry),
    meanYds: Math.round(c.meanYds),
    aimOffsetYds: Math.round(c.aimOffsetYds),
    expScore: r2(c.expScore),
    birdieProb: r3(c.birdieProb),
    troubleRate: r3(c.troubleRate),
    reason: text,
    reasonFields: fields,
  };
  if (safeExp != null) o.deltaExp = r2(c.expScore - safeExp);
  return o;
}

/* ---------- entry point ---------- */

/**
 * recommend(ctx, hole, P) — spec §3.9.
 * ctx: { hole?, par?, shotNo, ball:{x,y}, lieType?, lieQuality?, conditions?, pinPos?, wind?, elevationDeltaYds? }
 * hole: a course.js Hole. P: a loaded profile (profile.js). Returns null when the ball is on the green.
 */
export function recommend(rawCtx, hole, P) {
  const cfg = P.config || DEFAULT_CONFIG;
  const ctx = normalizeContext(rawCtx, hole);
  if (classify(hole, ctx.ball) === "green") return null;
  const g = greenDistances(hole, ctx.ball, ctx.pinPos);
  const headline = playsLike(g.pin, bearing(ctx.ball, hole.green.center), ctx, cfg);
  const cands = generateCandidates(ctx, hole, P);
  const context = {
    hole: ctx.hole, par: ctx.par, shotNo: ctx.shotNo,
    ball: { x: r2(ctx.ball.x), y: r2(ctx.ball.y) },
    distances: { front: Math.round(g.front), center: Math.round(g.center), back: Math.round(g.back), pin: Math.round(g.pin) },
    playsLike: Math.round(headline.yds),
    lieType: ctx.lieType, lieQuality: ctx.lieQuality, lieConfidence: ctx.lieConfidence,
    conditions: ctx.conditions, pinPos: typeof ctx.pinPos === "string" ? ctx.pinPos : "custom",
    wind: ctx.wind ? { speedMph: ctx.wind.speedMph, relative: headline.wind.relative } : null,
    elevationDeltaYds: ctx.elevationDeltaYds,
  };
  if (!cands.length) {
    return { context, sameShot: true, safe: null, aggressive: null, message: "No club in the profile reaches a useful target from here.", nudges: [], flags: [], candidates: 0 };
  }
  const samples = makeSamples(cfg.SAMPLES, cfg.SEED);
  const scored = cands.map((c) => ({ ...c, ...simulateCandidate(c, ctx, hole, P, samples) }));
  const { safe, aggressive, sameShot } = pickOptions(scored, cfg);
  const out = {
    context,
    sameShot,
    safe: formatOption(safe, P, null),
    aggressive: sameShot ? null : formatOption(aggressive, P, safe.expScore),
    message: sameShot ? "Same shot both ways." : null,
    nudges: ctx.nudges,   // §5.5 — computed by learning.js, passed in on ctx, echoed here
    flags: ctx.flags,
    candidates: scored.length,
  };
  return out;
}

/* ---------- §3.10 display strings ---------- */

function pct(x) { return `${Math.round(x * 100)}%`; }

export function displayLines(res, cfg = DEFAULT_CONFIG) {
  if (!res || !res.safe) return [res?.message || ""];
  const s = res.safe;
  const line = (tag, o, extra) => `${tag.padEnd(11)} ${o.label} · ${o.target.label}  Avg ${o.expScore.toFixed(1)}${extra} · Birdie ${pct(o.birdieProb)} · Trouble ${pct(o.troubleRate)}`;
  if (res.sameShot) return [`${line("BOTH", s, "")} — ${res.message}`, `  ${s.reason}`];
  const a = res.aggressive;
  const delta = Math.abs(a.deltaExp) < cfg.SAME_AVG_DELTA ? " (≈ same avg.)" : ` (${a.deltaExp >= 0 ? "+" : ""}${a.deltaExp.toFixed(1)})`;
  return [line("SAFE", s, ""), `  ${s.reason}`, line("AGGRESSIVE", a, delta), `  ${a.reason}`];
}
