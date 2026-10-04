/*
 * engine.js — the caddie decision engine (spec §3). Two priced options at every ball.
 *
 * recommend(ctx, hole, P) → the §3.9 output contract. Everything is a pure function of its
 * arguments; there is no cache and no clock. The ghost, the match state and the differential are
 * not inputs and cannot become inputs without changing this signature (rule 4, T7).
 *
 * Pipeline: context → plays-like → candidates (§3.4, §3.7) → simulation over Brett's dispersion
 * (§3.5) → SAFE through the course-management rules (strategy.js, D76), ranked by the chance of
 * par or better (D78) / AGGRESSIVE / same-shot (§3.6, loosened v22.17) → reason strings from
 * profile fields (§3.10). Every option carries expScore, parProb, birdieProb, doubleProb and
 * troubleRate; routeReadout() lays them out per route for the dev readout.
 */

import { DEFAULT_CONFIG } from "./config.js";
import { makeSamples } from "./random.js";
import { classify, greenDistances, pinPoint, fatSide, corridorAt, waterEntry, pointAlong, dist, ydsToFt } from "./course.js";
import { candidateEntries, E, Eputt, B, makePct, threePuttPct } from "./profile.js";
import { reasonFor } from "./reasons.js";
import { pickSafe, situationOf } from "./strategy.js";

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
    tempF: Number.isFinite(ctx.tempF) ? ctx.tempF : null,   // §3.3 — no adjustment when unknown
    elevFt: Number.isFinite(ctx.elevFt) ? ctx.elevFt : null, // ball altitude (ft); null → no altitude term
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

const WIND_DEFAULT = DEFAULT_CONFIG.WIND;

/**
 * §3.3 wind (integration item 3): along-shot yards (positive = plays longer) and crosswind aim
 * offset (positive = the ball is pushed right). `fromDeg` is where the wind blows FROM in the hole
 * frame. `family` (long / mid / short / wedge) picks the loft multiplier; unknown → 1.
 *   head loss % = (headPctPerMph + headCurve·h)·h·loftMult, ≤ headCap   (h = head component, mph)
 *   tail gain % = (tailPctPerMph + tailCurve·t)·t·loftMult, ≤ tailCap   (t = tail component, mph)
 *   cross yds   = crossPctPerMph·c·shotYds (× crossLongMult for the long family)
 */
export function windEffect(wind, shotBearingDeg, shotYds, cfg, family) {
  if (!wind) return { alongYds: 0, crossYds: 0, relative: "calm" };
  const W = cfg?.WIND || WIND_DEFAULT;
  const rel = (wind.fromDeg - shotBearingDeg) * DEG;
  const head = wind.speedMph * Math.cos(rel);        // > 0 into the face
  const fromRight = wind.speedMph * Math.sin(rel);   // > 0 blowing from the right → pushes left
  const loft = Number.isFinite(W.loftMult?.[family]) ? W.loftMult[family] : 1;
  let alongPct;
  if (head > 0) alongPct = Math.min(W.headCap ?? 0.5, Math.max(0, (W.headPctPerMph + W.headCurve * head) * head * loft));
  else {
    const t = -head;
    alongPct = -Math.min(W.tailCap ?? 0.2, Math.max(0, (W.tailPctPerMph + W.tailCurve * t) * t * loft));
  }
  const alongYds = shotYds * alongPct;
  const crossYds = -fromRight * W.crossPctPerMph * shotYds * (family === "long" ? (W.crossLongMult ?? 0.8) : 1);
  const eps = wind.speedMph * 0.05;
  const side = fromRight > eps ? "right" : fromRight < -eps ? "left" : "";
  const relative = Math.abs(head) < wind.speedMph * 0.38
    ? `cross-from-${side || "right"}`
    : head > 0 ? (side ? `into-${side}` : "into") : (side ? `down-${side}` : "down");
  return { alongYds, crossYds, relative };
}

/**
 * §3.3 temperature: cold plays longer (positive), hot plays shorter (negative), 0 at the
 * temperature the profile's distances were hit in, and whenever tempF is unknown (never a default
 * pretending to be a reading). D79: that reference is PROFILE_TEMP_F (Brett's numbers are summer
 * numbers, ~85°F), not the textbook 70°F; TEMP_REF_F is the fallback when PROFILE_TEMP_F is unset.
 */
export function profileTempF(cfg) {
  return Number.isFinite(cfg?.PROFILE_TEMP_F) ? cfg.PROFILE_TEMP_F : cfg?.TEMP_REF_F ?? 70;
}
function tempEffect(rawYds, tempF, cfg) {
  return Number.isFinite(tempF) ? rawYds * cfg.TEMP_PCT_PER_10F * (profileTempF(cfg) - tempF) / 10 : 0;
}

/**
 * Altitude (integration item 5): thinner air above REF_ELEV_FT carries farther, so the shot plays
 * SHORTER (negative); below it plays longer. 0 when the ball's elevation is unknown.
 */
function altEffect(rawYds, elevFt, cfg) {
  if (!Number.isFinite(elevFt)) return 0;
  return -rawYds * (cfg.ALT_PCT_PER_1000FT ?? 0) * (elevFt - (cfg.REF_ELEV_FT ?? 0)) / 1000 || 0;   // no −0
}

/**
 * Plays-like for a shot of `rawYds` in direction `bearingDeg` (§3.3, minus lie which lives in the
 * entry). `family` scales the wind by loft; omitted (the headline number) → loft multiplier 1.
 */
export function playsLike(rawYds, bearingDeg, ctx, cfg, family) {
  const w = windEffect(ctx.wind, bearingDeg, rawYds, cfg, family);
  const tempYds = tempEffect(rawYds, ctx.tempF, cfg);
  const altYds = altEffect(rawYds, ctx.elevFt, cfg);
  return { yds: rawYds + (ctx.elevationDeltaYds || 0) * cfg.ELEV_FACTOR + w.alongYds + tempYds + altYds, wind: w, tempYds, altYds };
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
  const pl = playsLike(raw, b, ctx, cfg, entry.family);
  const q = cfg.LIE_QUALITY[ctx.lieQuality] || cfg.LIE_QUALITY.standard;
  const nudgeDist = ctx.adjust?.distYds?.[entry.family] || 0;
  const mean = entry.carry + entry.biasDist + q.distYds - (pl.yds - raw) - nudgeDist;
  const roll = entry.roll;                               // ground conditions already applied (ROLL_COND_MULT)
  const dir = { x: Math.sin(b * DEG), y: Math.cos(b * DEG) };
  const perp = { x: dir.y, y: -dir.x };                // +x when heading up the hole → right
  // mean = carry (what a green-bound shot is judged on); total = where a fairway-bound shot stops.
  return { mean, total: mean + roll, roll, dir, perp, bearing: b, wind: pl.wind, sdMult: q.sdMult };
}

/**
 * The hole's playing line from the ball: the ball, the golf=hole centreline's bend points still
 * ahead of it, the green center. Null when no bend point is ahead (a straight hole, or the ball is
 * past the corner): then the straight-line candidates below are unchanged.
 */
export function doglegPath(hole, ball) {
  const line = hole.line || [];
  const ahead = line.slice(1, -1).filter((v) => v.y > ball.y + 10 && v.y < hole.green.center.y);
  return ahead.length ? [ball, ...ahead, hole.green.center] : null;
}

/** The point on `path` (from its start) whose straight distance from path[0] is `d`; the end if none. */
export function pointAtReach(path, d) {
  const o = path[0];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (dist(o, b) < d) continue;
    let lo = 0, hi = dist(a, b);
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (dist(o, pointAlong(a, b, m)) < d) lo = m; else hi = m; }
    return pointAlong(a, b, lo);
  }
  return { ...path[path.length - 1] };
}

/** The point `L` yards back along `path` from its end (the green center). */
export function pointBackFromEnd(path, L) {
  let left = L;
  for (let i = path.length - 1; i > 0; i--) {
    const a = path[i], b = path[i - 1], len = dist(a, b);
    if (left <= len) return pointAlong(a, b, left);
    left -= len;
  }
  return { ...path[0] };
}

export function generateCandidates(ctx, hole, P) {
  const cfg = P.config;
  const entries = candidateEntries(P, ctx.lieType, { conditions: ctx.conditions });
  const center = hole.green.center;
  const g = greenDistances(hole, ctx.ball, ctx.pinPos);
  const pin = pinPoint(hole, ctx.ball, ctx.pinPos);
  const fat = fatSide(hole);
  const bend = doglegPath(hole, ctx.ball);
  const out = [];
  const push = (c) => {
    const aim = ctx.adjust?.aimYds?.[c.entry.family] || 0;
    if (aim) c.target = { x: c.target.x + aim, y: c.target.y };
    const dup = out.find((o) => o.club === c.club && o.swing === c.swing && (sameTarget(o.target, c.target) || (o.kind === "layup" && c.kind === "layup")));
    if (dup) {
      // One target can be the pin, the center and the fat side at once; keep every name (strategy.js).
      if (dup.aims && c.aims) for (const a of c.aims) if (!dup.aims.includes(a)) dup.aims.push(a);
      return;
    }
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
      { p: pin, aim: "pin", label: `green, ${ctx.pinPos === "middle" ? "center" : typeof ctx.pinPos === "string" ? ctx.pinPos + " pin" : "custom pin"}` },
      { p: center, aim: "center", label: "green, center" },
      { p: fat, aim: "fat", label: "green, fat side" },
    ];
    for (const t of targets) push({ club: e.club, swing: e.swing, entry: e, kind: "approach", target: t.p, label: t.label, aims: [t.aim] });
  }

  // §3.7 layups: leave-distance candidates on the centerline, the nearest club for each.
  const nonReaching = entries.filter((e) => reach.get(e) === "short");
  const dPin = dist(ctx.ball, pin);
  const layups = new Map();                            // one layup candidate per club × swing: its best-fit leave
  for (let L = cfg.LAYUP_MIN_YDS; L <= cfg.LAYUP_MAX_YDS; L += cfg.LAYUP_STEP_YDS) {
    if (dPin - L < 20) break;
    const q = bend ? pointBackFromEnd(bend, L) : pointAlong(center, ctx.ball, L); // L short of the green center, on the line
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
    // On a dogleg the center is the hole's line at this club's reach, not the tee→green chord.
    const on = bend ? pointAtReach(bend, lm.total) : null;
    const yLand = on ? on.y : ctx.ball.y + lm.total;
    const cx = on ? Math.round(on.x) : 0;
    const corr = e.family === "long" ? corridorAt(hole, yLand) : null;
    const xs = [cx];
    if (corr) for (let x = Math.ceil(corr[0]); x <= corr[1]; x += cfg.CORRIDOR_STEP_YDS) xs.push(x);
    for (const x of xs) {
      const t = { x, y: yLand };
      const leave = Math.round(dist(t, pin));
      const off = x - cx;
      const side = off === 0 ? "center" : off < 0 ? `${Math.abs(off)} left of center` : `${off} right of center`;
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

/* ---------- score distribution (D78) ----------
 *
 * expScore needs only the mean strokes to hole out; SAFE = "most likely to make par" (D78) needs
 * the distribution. Every landing is priced as: this shot + any penalty stroke (deterministic) + X,
 * where X = strokes still needed to hole out from the landing state.
 *   On the green  X is Brett's own putting: P(1) = make%, P(3) = three-putt%, P(2) = the rest —
 *                 exactly the distribution whose mean is Eputt().
 *   Elsewhere     X = max(1, round(Y)), Y a split (two-piece) normal whose MEAN is E(d, lie), the
 *                 expected strokes the baseline already gives, with a narrow left side (you rarely
 *                 hole out early) and a wide right side (blow-ups): σL = a + b·(m−1), σR = c + e·(m−1)
 *                 (SCORE_DIST in config). Mode μ = m − √(2/π)(σR − σL), so the mean stays m; the
 *                 rounding moves it by a few hundredths at most.
 *   Calibration: from a par-4 tee at Brett's 4.62 average (Shot Pattern report, Jun 27–Sep 20) this
 *   gives par-or-better ≈ 49% and double-or-worse ≈ 13%; his ten rounds read 52.8% and 13.3% across
 *   all holes. The constants are otherwise uncalibrated.
 * Per sample: parProb = P(this + pen + X ≤ par), doubleProb = P(… ≥ par + 2); averaged per candidate.
 */

const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function phi(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * P(X ≤ j) for X = strokes to hole out from an off-green state whose expected strokes is `m`
 * (D78: rounded split normal, at least 1). 0 for j < 1.
 */
export function holeOutCdf(m, j, cfg = DEFAULT_CONFIG) {
  if (j < 1) return 0;
  const D = cfg?.SCORE_DIST || DEFAULT_CONFIG.SCORE_DIST;
  const ex = Math.max(0, m - 1);
  const s1 = Math.max(0.05, D.sdLeft[0] + D.sdLeft[1] * ex);
  const s2 = Math.max(0.05, D.sdRight[0] + D.sdRight[1] * ex);
  const mu = m - SQRT_2_OVER_PI * (s2 - s1);
  const x = j + 0.5, w = s1 + s2;
  return x <= mu ? (2 * s1 / w) * phi((x - mu) / s1) : s1 / w + (2 * s2 / w) * (phi((x - mu) / s2) - 0.5);
}

/** P(putts ≤ j) from `ft` with Brett's make% and three-putt% (a three-putt counts as exactly 3). */
export function puttCdf(P, ft, j) {
  if (j < 1) return 0;
  if (j === 1) return makePct(P, ft);
  if (j === 2) return 1 - threePuttPct(P, ft);
  return 1;
}

/** { par, double }: P(finish ≤ par) and P(finish ≥ par + 2) for one priced landing `r`. */
function finishProbs(P, r, ctx, cfg) {
  const kPar = ctx.par - ctx.shotNo - r.pen;          // strokes left for par after this one
  const kDbl = ctx.par + 2 - ctx.shotNo - r.pen;      // this many more makes it a double
  const cdf = r.ft != null ? (j) => puttCdf(P, Math.round(r.ft), j) : (j) => holeOutCdf(r.m, j, cfg);
  return { par: cdf(kPar), double: 1 - cdf(kDbl - 1) };
}

/**
 * One landing priced. strokes = this shot + penalty + expected strokes to hole out; `pen` = penalty
 * strokes; `m` = expected strokes to hole out off the green, or `ft` = putt length on it (D78).
 */
function priceLanding(hole, P, ctx, from, landing, lie, k, pin) {
  switch (lie) {
    case "green": {
      const ft = ydsToFt(dist(landing, pin));
      return { strokes: 1 + Eputt(P, ft), birdie: B(P, { lie: "green", ft }, k), trouble: false, pen: 0, ft };
    }
    case "water": {
      const drop = waterEntry(hole, from, landing, P.config.WATER_DROP_STEP_YDS);
      const d = dist(drop, pin);
      const m = E(P, d, "rough");
      return { strokes: 2 + m, birdie: B(P, { lie: "rough", d }, k - 1), trouble: true, pen: 1, m };
    }
    case "ob": {
      const d = dist(from, pin);
      const m = E(P, d, ctx.lieType);
      return { strokes: 2 + m, birdie: B(P, { lie: ctx.lieType, d }, k - 1), trouble: true, pen: 1, m };
    }
    case "trees": {
      const d = dist(landing, pin);
      const m = E(P, d, "recovery");
      return { strokes: 1 + m, birdie: B(P, { lie: "recovery", d }, k), trouble: true, pen: 0, m };
    }
    case "sand": {
      const d = dist(landing, pin);
      const m = E(P, d, "sand");
      return { strokes: 1 + m, birdie: B(P, { lie: "sand", d }, k), trouble: true, pen: 0, m };
    }
    default: {                                   // fairway, rough, tee
      const l = lie === "tee" ? "fairway" : lie;
      const d = dist(landing, pin);
      const m = E(P, d, l);
      return { strokes: 1 + m, birdie: B(P, { lie: l, d }, k), trouble: false, pen: 0, m };
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
  let sumStrokes = 0, sumBirdie = 0, sumPar = 0, sumDouble = 0, trouble = 0;
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
      // Roll along the line of flight in short steps; the ball stops in the first bunker, water
      // or trees it runs into (it never rolls through a hazard onto the green).
      const step = 2;
      let rolled = 0;
      while (rolled < roll) {
        const d = Math.min(step, roll - rolled);
        const q = { x: p.x + lm.dir.x * d, y: p.y + lm.dir.y * d };
        const ql = classify(hole, q);
        p = q; lie = ql; rolled += d;
        if (ql === "sand" || ql === "water" || ql === "trees") break;
      }
    }
    const r = priceLanding(hole, P, ctx, ctx.ball, p, lie, k, pin);
    sumStrokes += r.strokes;
    sumBirdie += r.birdie;
    const f = finishProbs(P, r, ctx, cfg);
    sumPar += f.par;
    sumDouble += f.double;
    if (r.trouble) trouble++;
  }
  return {
    expScore: ctx.shotNo - 1 + sumStrokes / n,
    birdieProb: sumBirdie / n,
    parProb: sumPar / n,
    doubleProb: sumDouble / n,
    troubleRate: trouble / n,
    meanYds: cand.kind === "approach" ? lm.mean : lm.total,
    distToTarget: dist(ctx.ball, cand.target),
    aimOffsetYds: -lm.wind.crossYds,
  };
}

/* ---------- selection (§3.6) ---------- */

/** Higher birdie chance, ties to the lower expected score (AGGRESSIVE's order, locked rule 2). */
const moreBirdie = (b, a) =>
  b.birdieProb > a.birdieProb + 1e-12 || (Math.abs(b.birdieProb - a.birdieProb) <= 1e-12 && b.expScore < a.expScore);

/**
 * SAFE through the course-management rules (strategy.js, D76, D78); AGGRESSIVE = the best birdie
 * chance. v22.17 (Brett, Oct 4: on a tee SAFE and AGGRESSIVE read "identical", 2-iron 230 leaving
 * 170):
 *   - on a par-4/5 tee, when the best birdie chance is SAFE's own club and line, AGGRESSIVE is the
 *     best birdie chance among the shots that differ from SAFE (another club, or the same club to a
 *     target more than SAME_SHOT_TARGET_YDS longer) and beat its birdie odds, however marginally;
 *   - same shot only when the two are the same club + swing within SAME_SHOT_TARGET_YDS, or the
 *     birdie gain is under SAME_SHOT_BIRDIE_GAIN (0.005) AND the targets are within twice that.
 */
export function pickOptions(scored, cfg, sit) {
  const { safe, rules } = pickSafe(scored, sit, cfg);
  const tgt = cfg.SAME_SHOT_TARGET_YDS;
  const sameLine = (a, b) => a.club === b.club && a.swing === b.swing && dist(a.target, b.target) <= tgt;
  let aggressive = scored.reduce((a, b) => (moreBirdie(b, a) ? b : a));
  if (sit.teeShot && sameLine(aggressive, safe)) {
    const alts = scored.filter((c) => (c.club !== safe.club || c.swing !== safe.swing || c.distToTarget > safe.distToTarget + tgt) &&
      c.birdieProb > safe.birdieProb + 1e-12);
    if (alts.length) aggressive = alts.reduce((a, b) => (moreBirdie(b, a) ? b : a));
  }
  const gain = aggressive.birdieProb - safe.birdieProb;
  const sameShot = aggressive === safe || sameLine(aggressive, safe) ||
    (gain < cfg.SAME_SHOT_BIRDIE_GAIN && dist(aggressive.target, safe.target) <= 2 * tgt);
  return { safe, aggressive, sameShot, rules };
}

function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }

/** `geo` = { ball, pin } in the hole frame: adds toTargetYds (ball → target) and leaveYds (target → pin). */
function formatOption(c, P, safeExp, geo) {
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
    parProb: r3(c.parProb),
    doubleProb: r3(c.doubleProb),
    troubleRate: r3(c.troubleRate),
    reason: text,
    reasonFields: fields,
  };
  if (geo?.ball) o.toTargetYds = Math.round(dist(geo.ball, c.target));
  if (geo?.pin) o.leaveYds = Math.round(dist(c.target, geo.pin));
  if (safeExp != null) o.deltaExp = r2(c.expScore - safeExp);
  return o;
}

/* ---------- entry point ---------- */

/**
 * recommend(ctx, hole, P) — spec §3.9.
 * ctx: { hole?, par?, shotNo, ball:{x,y}, lieType?, lieQuality?, conditions?, pinPos?, wind?, elevationDeltaYds?, tempF?, elevFt? }
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
    tempF: ctx.tempF, tempYds: r2(headline.tempYds),
    elevFt: ctx.elevFt, altYds: r2(headline.altYds),
  };
  if (!cands.length) {
    return { context, sameShot: true, safe: null, aggressive: null, message: "No club in the profile reaches a useful target from here.", nudges: [], flags: [], strategy: [], candidates: 0 };
  }
  const samples = makeSamples(cfg.SAMPLES, cfg.SEED);
  const scored = cands.map((c) => ({ ...c, ...simulateCandidate(c, ctx, hole, P, samples) }));
  const { safe, aggressive, sameShot, rules } = pickOptions(scored, cfg, situationOf(ctx, hole, g));
  const geo = { ball: ctx.ball, pin: pinPoint(hole, ctx.ball, ctx.pinPos) };
  const out = {
    context,
    sameShot,
    safe: formatOption(safe, P, null, geo),
    aggressive: sameShot ? null : formatOption(aggressive, P, safe.expScore, geo),
    message: sameShot ? "Same shot both ways." : null,
    nudges: ctx.nudges,   // §5.5 — computed by learning.js, passed in on ctx, echoed here
    flags: ctx.flags,
    strategy: rules,      // course-management rules that moved SAFE off the plain lowest score (D76)
    candidates: scored.length,
  };
  return out;
}

/* ---------- §3.10 display strings ---------- */

/**
 * Brett's own target (v22.16.5): the club whose average shot best fits the distance to `target` —
 * carry when the target is on the green, carry + roll anywhere else — simulated like any candidate,
 * so the club, its dispersion and its numbers follow the marker. Not an option of recommend(): the
 * SAFE / AGGRESSIVE pair is still what the caddie said; this is what Brett chose to aim at.
 * opts.samples (v22.17): how many draws to price with — the UI uses ~80 while the marker is being
 * dragged and the full cfg.SAMPLES (500) on drop. Same seed either way, so the first `n` draws are
 * shared. The result carries toTargetYds (ball → target) and leaveYds (target → pin).
 */
export function priceTarget(rawCtx, hole, P, target, opts = {}) {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const cfg = P.config || DEFAULT_CONFIG;
  const ctx = normalizeContext(rawCtx, hole);
  const need = dist(ctx.ball, target);
  const toGreen = classify(hole, target) === "green";
  let best = null;
  for (const e of candidateEntries(P, ctx.lieType, { conditions: ctx.conditions })) {
    const lm = landingModel(e, ctx.ball, target, ctx, cfg);
    const err = Math.abs((toGreen ? lm.mean : lm.total) - need);
    if (!best || err < best.err) best = { e, err };
  }
  if (!best) return null;
  const pin = pinPoint(hole, ctx.ball, ctx.pinPos);
  const leave = Math.round(dist(target, pin));
  const cand = { club: best.e.club, swing: best.e.swing, entry: best.e, kind: toGreen ? "approach" : "layup", target: { x: target.x, y: target.y },
    label: toGreen ? "own target" : `leave ${leave}, own target` };
  const n = Number.isFinite(opts?.samples) && opts.samples >= 1 ? Math.round(opts.samples) : cfg.SAMPLES;
  const sim = simulateCandidate(cand, ctx, hole, P, makeSamples(n, cfg.SEED));
  return formatOption({ ...cand, ...sim }, P, null, { ball: ctx.ball, pin });
}

/**
 * Dev readout (v22.17): one row per route the screen is showing — SAFE, AGGRESSIVE (unless same
 * shot) and, when passed, Brett's own target (priceTarget's result) as "Custom". Each row:
 * { route, label, club, targetYds (ball → target), leaveYds (target → pin), expScore, parProb,
 * birdieProb, doubleProb, troubleRate }. Distances come from the option's own toTargetYds /
 * leaveYds; an option without them (an older snapshot) falls back to res.context (ball → target;
 * leave = null). Pure; [] for a null recommendation.
 */
export function routeReadout(res, own = null) {
  const rows = [];
  const ball = res?.context?.ball;
  const row = (route, label, o) => {
    if (!o) return;
    const targetYds = Number.isFinite(o.toTargetYds) ? o.toTargetYds
      : ball && o.target && Number.isFinite(o.target.x) ? Math.round(dist(ball, o.target)) : null;
    rows.push({
      route, label, club: o.club ?? null,
      targetYds,
      leaveYds: Number.isFinite(o.leaveYds) ? o.leaveYds : null,
      expScore: o.expScore ?? null, parProb: o.parProb ?? null, birdieProb: o.birdieProb ?? null,
      doubleProb: o.doubleProb ?? null, troubleRate: o.troubleRate ?? null,
    });
  };
  if (res?.safe) row("safe", res.sameShot ? "Safe · same shot" : "Safe", res.safe);
  if (res?.safe && !res.sameShot) row("aggressive", "Aggressive", res.aggressive);
  row("custom", "Custom", own);
  return rows;
}

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
