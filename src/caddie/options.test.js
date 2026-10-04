/*
 * options.test.js — v22.17 engine changes (Brett, Oct 4): SAFE = most likely to make par (D78),
 * parProb / doubleProb on every option, the looser same-shot rule and a distinct AGGRESSIVE off the
 * tee, the dev route readout, fast own-target pricing, and the summer profile temperature (D79).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile, makePct, threePuttPct } from "./profile.js";
import { recommend, priceTarget, routeReadout, pickOptions, holeOutCdf, puttCdf, phi, playsLike,
  generateCandidates, simulateCandidate, normalizeContext } from "./engine.js";
import { pickSafe } from "./strategy.js";
import { makeSamples } from "./random.js";
import { rect, ellipse } from "./course.js";
import { openPar5, waterLeftPar4, noWaterPar4, bunkeredPar3 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);

/** Brett's field complaint (Oct 4): a long, pinched par 4 where the 2-iron / hybrid and the driver both play. */
const longPar4 = {
  id: "long-par-4", par: 4, yards: 470, tee: { x: 0, y: 0 },
  green: { ring: ellipse(0, 470, 14, 16, 32), center: { x: 0, y: 470 } },
  fairways: [rect(-18, 60, 18, 452)], tees: [rect(-6, -6, 6, 6)],
  hazards: [{ type: "trees", ring: rect(-90, 255, -26, 330) }, { type: "trees", ring: rect(26, 255, 90, 330) }],
  boundary: null,
};

const scoredFor = (raw, hole, PP = P) => {
  const ctx = normalizeContext(raw, hole);
  const samples = makeSamples(PP.config.SAMPLES, PP.config.SEED);
  return generateCandidates(ctx, hole, PP).map((c) => ({ ...c, ...simulateCandidate(c, ctx, hole, PP, samples) }));
};

/* ---------- D78: the score distribution ---------- */

test("D78 phi: the normal CDF to 1e-6 at a few known points", () => {
  for (const [z, v] of [[0, 0.5], [1, 0.841345], [-1.96, 0.024998], [2.5, 0.99379]]) assert.ok(Math.abs(phi(z) - v) < 1e-5, `${z}: ${phi(z)}`);
});

test("D78 holeOutCdf: a distribution over whole strokes ≥ 1 whose mean is the expected strokes; right-skewed", () => {
  for (const m of [1.6, 2.2, 2.9, 3.4, 4.0, 4.62, 5.3]) {
    let mean = 0, prev = 0;
    for (let j = 0; j <= 20; j++) {
      const c = holeOutCdf(m, j);
      assert.ok(c >= prev - 1e-12 && c <= 1 + 1e-12, `monotone at m ${m} j ${j}`);
      mean += 1 - c;                 // E[X] = Σ_{j≥0} P(X > j)
      prev = c;
    }
    assert.equal(holeOutCdf(m, 0), 0, "never holed in 0");
    assert.ok(Math.abs(mean - m) < 0.08, `mean ${mean.toFixed(3)} vs ${m}`);
    // right skew: a positive third central moment (blow-ups run longer than hole-outs run short)
    let m3 = 0;
    for (let k = 1; k <= 20; k++) m3 += (holeOutCdf(m, k) - holeOutCdf(m, k - 1)) * (k - mean) ** 3;
    assert.ok(m3 > 0, `m ${m}: third moment ${m3}`);
  }
});

test("D78 calibration: a par-4 tee at Brett's 4.62 → par or better ≈ 49%, double or worse ≈ 13% (his report: 52.8 / 13.3)", () => {
  const par = holeOutCdf(4.62, 4), dbl = 1 - holeOutCdf(4.62, 5);
  assert.ok(par > 0.44 && par < 0.56, `par ${par}`);
  assert.ok(dbl > 0.10 && dbl < 0.16, `double ${dbl}`);
});

test("D78 puttCdf: one putt = make%, two or fewer = 1 − three-putt%, three = certain", () => {
  for (const ft of [4, 12, 30]) {
    assert.equal(puttCdf(P, ft, 0), 0);
    assert.equal(puttCdf(P, ft, 1), makePct(P, ft));
    assert.equal(puttCdf(P, ft, 2), 1 - threePuttPct(P, ft));
    assert.equal(puttCdf(P, ft, 3), 1);
  }
});

test("D78 every option carries parProb and doubleProb in [0, 1]; par + double ≤ 1; a penalty raises the double chance", () => {
  const cases = [
    recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4, P),
    recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, bunkeredPar3, P),
    recommend({ shotNo: 2, ball: { x: 0, y: 300 } }, openPar5, P),
  ];
  for (const r of cases) {
    for (const o of [r.safe, r.aggressive].filter(Boolean)) {
      for (const k of ["parProb", "doubleProb"]) assert.ok(typeof o[k] === "number" && o[k] >= 0 && o[k] <= 1, `${k} ${o[k]}`);
      assert.ok(o.parProb + o.doubleProb <= 1 + 1e-9);
      assert.ok(o.parProb >= o.birdieProb - 1e-9, "par or better includes birdie");
    }
  }
  // the same shot with and without the water: the penalty stroke shows up as doubles
  const tee = { shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" };
  const wetAll = scoredFor(tee, waterLeftPar4), dryAll = scoredFor(tee, noWaterPar4);
  const wet = wetAll.reduce((a, b) => (b.troubleRate > a.troubleRate ? b : a));
  const dry = dryAll.find((c) => c.club === wet.club && c.target.x === wet.target.x && c.target.y === wet.target.y);
  assert.ok(wet.troubleRate > 0.2 && dry, `${wet.club} ${wet.label}`);
  assert.ok(wet.doubleProb > dry.doubleProb + 0.05, `water ${wet.doubleProb} vs dry ${dry.doubleProb}`);
  assert.ok(wet.parProb < dry.parProb);
});

/* ---------- D78: SAFE = most likely to make par ---------- */

test("D78 SAFE ranks by par-or-better among the shots the rules allow, ties to the lower expected score", () => {
  const OFF = { STRATEGY: { driverDefault: false, pinRule: false, noHero: false } };
  const Ppar = loadProfile(RAW, mergeConfig(OFF));
  const tol = DEFAULT_CONFIG.PAR_TIE_TOLERANCE;
  for (const [raw, hole] of [
    [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, longPar4],
    [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4],
    [{ shotNo: 2, ball: { x: 0, y: 236 } }, waterLeftPar4],
    [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, bunkeredPar3],
  ]) {
    const r = recommend(raw, hole, Ppar);
    const scored = scoredFor(raw, hole, Ppar);
    const maxPar = Math.max(...scored.map((c) => c.parProb));
    assert.ok(r.safe.parProb >= maxPar - tol - 0.001, `${hole.id}: SAFE par ${r.safe.parProb} vs best ${maxPar}`);
    const tied = scored.filter((c) => c.parProb >= maxPar - tol - 1e-9);
    const minExp = Math.min(...tied.map((c) => c.expScore));
    assert.ok(r.safe.expScore <= minExp + DEFAULT_CONFIG.EXP_TIE_TOLERANCE + 0.006, `${hole.id}: ${r.safe.expScore} vs ${minExp}`);
  }
  assert.equal(DEFAULT_CONFIG.SAFE_RANKING, "par");
});

test("D78 pickSafe: a higher par chance beats a lower expected score; 'exp' restores the old order; the rule is named", () => {
  const c = (club, o) => ({ club, swing: "full", kind: "corridor", target: { x: 0, y: 0 }, label: "leave", meanYds: 200, distToTarget: 200, troubleRate: 0, birdieProb: 0.01, ...o });
  const steady = c("4Hy", { expScore: 4.55, parProb: 0.52 });
  const greedy = c("Dr", { expScore: 4.50, parProb: 0.47, meanYds: 280, distToTarget: 280 });
  const sit = { teeShot: false, recovery: false, pin: "middle", depthTargetYds: 0 };
  const r = pickSafe([greedy, steady], sit);
  assert.equal(r.safe, steady);
  assert.deepEqual(r.rules, ["par"]);
  assert.equal(pickSafe([greedy, steady], sit, mergeConfig({ SAFE_RANKING: "exp" })).safe, greedy);
  // inside PAR_TIE_TOLERANCE the expected score decides, and nothing is named
  const close = { ...steady, parProb: 0.475 };
  assert.deepEqual(pickSafe([greedy, close], sit), { safe: greedy, rules: [] });
  // candidates without parProb (older callers) keep the expected-score order
  const bare = (x) => { const { parProb, ...rest } = x; return rest; };
  assert.equal(pickSafe([bare(greedy), bare(steady)], sit).safe.club, "Dr");
});

/* ---------- v22.17 same shot and AGGRESSIVE off the tee ---------- */

test("same shot v22.17: same club + swing within 10 yds, or < 0.005 birdie gain within 20 yds; otherwise both", () => {
  const c = (club, x, y, birdieProb, o = {}) => ({ club, swing: "full", kind: "corridor", target: { x, y }, label: "t", meanYds: y, distToTarget: y,
    expScore: 4.6, parProb: 0.5, troubleRate: 0, birdieProb, ...o });
  const sit = { teeShot: false, recovery: false, pin: "middle", depthTargetYds: 0 };
  const cfg = DEFAULT_CONFIG;
  // same club, 6 yds apart, a real birdie gain → still the same shot
  let o = pickOptions([c("7i", 0, 150, 0.05, { parProb: 0.6 }), c("7i", 6, 150, 0.09)], cfg, sit);
  assert.equal(o.sameShot, true);
  // different clubs, 15 yds apart, gain 0.003 → same shot
  o = pickOptions([c("7i", 0, 150, 0.05, { parProb: 0.6 }), c("6i", 0, 165, 0.053)], cfg, sit);
  assert.equal(o.sameShot, true);
  // the same gain with the targets 30 yds apart → both (the old 0.01 rule merged these)
  o = pickOptions([c("7i", 0, 150, 0.05, { parProb: 0.6 }), c("5i", 0, 180, 0.053)], cfg, sit);
  assert.equal(o.sameShot, false);
  assert.equal(o.aggressive.club, "5i");
  // a gain ≥ 0.005 shows both even close by
  o = pickOptions([c("7i", 0, 150, 0.05, { parProb: 0.6 }), c("6i", 0, 162, 0.056)], cfg, sit);
  assert.equal(o.sameShot, false);
  assert.equal(cfg.SAME_SHOT_BIRDIE_GAIN, 0.005);
});

test("tee shot: when the best birdie chance is SAFE's own club and line, AGGRESSIVE is the best different shot that beats SAFE's birdie odds", () => {
  const c = (club, x, y, birdieProb, o = {}) => ({ club, swing: "full", kind: "corridor", target: { x, y }, label: "t", meanYds: y, distToTarget: y,
    expScore: 4.6, troubleRate: 0, birdieProb, ...o });
  const safe2i = c("2i", 0, 230, 0.010, { parProb: 0.50 });
  const twin = c("2i", 5, 232, 0.013, { parProb: 0.45, expScore: 4.65 });
  const dr = c("Dr", 0, 280, 0.011, { parProb: 0.44, expScore: 4.7, troubleRate: 0.2 });
  const short = c("4Hy", 0, 210, 0.004, { parProb: 0.40 });
  const tee = { teeShot: true, recovery: false, pin: "middle", depthTargetYds: 0 };
  const o = pickOptions([safe2i, twin, dr, short], DEFAULT_CONFIG, tee);
  assert.equal(o.safe, safe2i);
  assert.equal(o.aggressive, dr, "the driver: another club, longer, birdie 0.011 > 0.010");
  assert.equal(o.sameShot, false);
  // not a tee shot → the 2-iron twin is the best birdie chance and it is the same shot
  assert.equal(pickOptions([safe2i, twin, dr, short], DEFAULT_CONFIG, { ...tee, teeShot: false }).sameShot, true);
  // nothing different beats SAFE's birdie odds → same shot
  assert.equal(pickOptions([safe2i, twin, { ...dr, birdieProb: 0.009 }], DEFAULT_CONFIG, tee).sameShot, true);
});

test("field complaint (Oct 4): a long par 4 with the driver and the 2-iron both in play shows two distinct options", () => {
  const raw = { shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" };
  const scored = scoredFor(raw, longPar4);
  for (const club of ["Dr", "2i"]) assert.ok(scored.some((s) => s.club === club), `${club} is a candidate`);
  const r = recommend(raw, longPar4, P);
  assert.equal(r.sameShot, false, JSON.stringify(routeReadout(r)));
  assert.ok(r.aggressive, "AGGRESSIVE is shown");
  assert.notEqual(r.aggressive.club, r.safe.club);
  assert.equal(r.aggressive.club, "Dr");
  assert.ok(r.aggressive.toTargetYds > r.safe.toTargetYds + DEFAULT_CONFIG.SAME_SHOT_TARGET_YDS, "a longer target");
  assert.ok(r.aggressive.birdieProb > r.safe.birdieProb);
  assert.ok(r.aggressive.birdieProb - r.safe.birdieProb < 0.01, "the old 0.01 gain rule would have called this the same shot");
  assert.equal(typeof r.aggressive.doubleProb, "number");
  // the wide-open par 5 is still one shot (T1)
  assert.equal(recommend(raw, openPar5, P).sameShot, true);
});

/* ---------- route readout ---------- */

test("routeReadout: one row per route with yards to the target, yards left, and the five numbers", () => {
  const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, longPar4, P);
  const own = priceTarget({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 4 }, longPar4, P, { x: 0, y: 240 });
  const rows = routeReadout(r, own);
  assert.deepEqual(rows.map((x) => [x.route, x.label]), [["safe", "Safe"], ["aggressive", "Aggressive"], ["custom", "Custom"]]);
  for (const x of rows) {
    assert.deepEqual(Object.keys(x).sort(), ["birdieProb", "club", "doubleProb", "expScore", "label", "leaveYds", "parProb", "route", "targetYds", "troubleRate"].sort());
    for (const k of ["targetYds", "leaveYds", "expScore", "parProb", "birdieProb", "doubleProb", "troubleRate"]) assert.equal(typeof x[k], "number", `${x.route} ${k}`);
  }
  const s = rows[0];
  assert.equal(s.club, r.safe.club);
  assert.equal(s.targetYds, Math.round(Math.hypot(r.safe.target.x, r.safe.target.y)));
  assert.equal(s.leaveYds, Math.round(Math.hypot(r.safe.target.x, 470 - r.safe.target.y)), "target → pin (middle = green center)");
  assert.equal(rows[2].targetYds, 240); assert.equal(rows[2].leaveYds, 230);
  // same shot: one row; nothing: none; an old snapshot without the yards falls back to the context ball
  const same = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, openPar5, P);
  assert.deepEqual(routeReadout(same).map((x) => x.label), ["Safe · same shot"]);
  assert.deepEqual(routeReadout(null), []);
  const old = { context: { ball: { x: 0, y: 0 } }, sameShot: true, safe: { club: "7i", target: { x: 3, y: 4 }, expScore: 3 } };
  assert.deepEqual(routeReadout(old)[0], { route: "safe", label: "Safe · same shot", club: "7i", targetYds: 5, leaveYds: null,
    expScore: 3, parProb: null, birdieProb: null, doubleProb: null, troubleRate: null });
});

/* ---------- own target: fast pricing while dragging ---------- */

test("priceTarget opts.samples: 80 draws while dragging, 500 on drop; same club; yards to the target and left", () => {
  const ctx = { ball: { x: 0, y: 0 }, lieType: "fairway", par: 4, shotNo: 2 };
  const target = { x: 4, y: 150 };
  const fast = priceTarget(ctx, noWaterPar4, P, target, { samples: 80 });
  const full = priceTarget(ctx, noWaterPar4, P, target);
  assert.equal(fast.club, full.club);
  assert.deepEqual(full, priceTarget(ctx, noWaterPar4, P, target, { samples: DEFAULT_CONFIG.SAMPLES }), "default = cfg.SAMPLES");
  assert.ok(Math.abs(fast.expScore - full.expScore) < 0.15, `${fast.expScore} vs ${full.expScore}`);
  assert.ok(Math.abs(fast.parProb - full.parProb) < 0.1);
  assert.equal(full.toTargetYds, Math.round(Math.hypot(4, 150)));
  assert.equal(full.leaveYds, Math.round(Math.hypot(4, 410 - 150)));
  // and it is faster
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) priceTarget(ctx, noWaterPar4, P, { x: 4, y: 150 + i }, { samples: 80 });
  const tFast = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) priceTarget(ctx, noWaterPar4, P, { x: 4, y: 150 + i });
  assert.ok(tFast < performance.now() - t1, "80 samples price faster than 500");
});

/* ---------- D79: the profile's summer temperature ---------- */

test("D79 a 161-yd 9-iron at 50°F plays measurably longer than under the old 70°F reference", () => {
  const noWind = { wind: null, elevationDeltaYds: 0, tempF: 50, elevFt: null };
  const now = playsLike(161, 0, noWind, DEFAULT_CONFIG);
  const before = playsLike(161, 0, noWind, mergeConfig({ PROFILE_TEMP_F: 70 }));
  assert.ok(Math.abs(before.tempYds - 161 * 0.0085 * 2) < 1e-9, "old: 2.7 yds");
  assert.ok(Math.abs(now.tempYds - 161 * 0.0085 * 3.5) < 1e-9, "now: 4.8 yds");
  assert.ok(now.yds - before.yds > 2, `plays ${(now.yds - before.yds).toFixed(1)} yds longer than before`);
  // through the engine: on a cold day the 9-iron's own target is reached by less of a shot
  const ctx = { ball: { x: 0, y: 0 }, lieType: "fairway", par: 4, shotNo: 2, tempF: 50 };
  const cold = priceTarget(ctx, noWaterPar4, P, { x: 0, y: 161 });
  const coldOld = priceTarget(ctx, noWaterPar4, loadProfile(RAW, mergeConfig({ PROFILE_TEMP_F: 70 })), { x: 0, y: 161 });
  assert.ok(cold.carryYds >= coldOld.carryYds, `${cold.club} vs ${coldOld.club}: never less club in the cold`);
  // at the profile's own 85°F there is no adjustment
  assert.equal(playsLike(161, 0, { ...noWind, tempF: 85 }, DEFAULT_CONFIG).tempYds, 0);
});
