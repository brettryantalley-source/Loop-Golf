/*
 * strategy.test.js — the course-management rules that choose SAFE (strategy.js, D76; Wicked Smart
 * Golf tips 3–6). T44–T49. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile } from "./profile.js";
import { recommend, generateCandidates, simulateCandidate, normalizeContext } from "./engine.js";
import { makeSamples } from "./random.js";
import { ellipse, rect, greenDistances, dist } from "./course.js";
import { pickSafe, pinDepthClass, situationOf } from "./strategy.js";
import { openPar5, waterLeftPar4, waterRightPar4, noWaterPar4, bunkeredPar3 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
// v22.17: "rules off" also turns off the par ranking (D78) — the plain lowest expected score.
const OFF = { SAFE_RANKING: "exp", STRATEGY: { driverDefault: false, pinRule: false, noHero: false } };
const Poff = loadProfile(RAW, mergeConfig(OFF));

/** A 40-yd-deep green at 540 on the open par 5, a bunker across its front. */
const deepGreen = { ...openPar5, id: "deep-green", green: { ring: ellipse(0, 540, 13, 20, 32), center: { x: 0, y: 540 } },
  hazards: [{ type: "sand", ring: rect(-14, 512, 14, 519) }] };
/** Trees down the left from 180 to 330, water short-left of the green. */
const treesLeft = { ...waterLeftPar4, id: "trees-left", hazards: [
  { type: "trees", ring: rect(-80, 180, -27, 330) },
  { type: "water", ring: rect(-40, 360, -6, 392) },
] };

/** A scored candidate for the pure pickSafe tests. */
const cand = (club, o) => ({ club, swing: "full", kind: "approach", aims: ["center"], target: { x: 0, y: 0 }, label: "green, center",
  expScore: 4, birdieProb: 0.1, troubleRate: 0, meanYds: 150, distToTarget: 150, ...o });
const approachSit = (o = {}) => ({ teeShot: false, recovery: false, pin: "middle", depthTargetYds: 150, ...o });

test("pinDepthClass: presets as given; a custom pin falls in a third of the green's depth along the line, lateral offset ignored", () => {
  const ball = { x: 0, y: 390 };
  const g = greenDistances(deepGreen, ball, "middle");
  for (const p of ["front", "middle", "back"]) assert.equal(pinDepthClass(p, g, ball, deepGreen.green.center), p);
  assert.equal(pinDepthClass(undefined, g, ball, deepGreen.green.center), "middle");
  const at = (x, yds) => pinDepthClass({ x, y: ball.y + yds }, g, ball, deepGreen.green.center);
  assert.equal(at(0, g.front + 3), "front");
  assert.equal(at(8, g.front + 3), "front", "a pin left or right keeps its depth");
  assert.equal(at(-6, g.center), "middle");
  assert.equal(at(0, g.back - 3), "back");
});

test("T44 front pin → club up to the middle of the green, aimed at the center or fat side, never the flag", () => {
  const raw = { shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", pinPos: "front" };
  const r = recommend(raw, bunkeredPar3, P), off = recommend(raw, bunkeredPar3, Poff);
  const g = greenDistances(bunkeredPar3, raw.ball, "front");
  assert.deepEqual(r.strategy, ["pin-front"]);
  assert.notEqual(r.safe.target.label, "green, front pin", "SAFE does not aim at a front flag");
  assert.ok(r.safe.meanYds > off.safe.meanYds, `club up: ${r.safe.club} ${r.safe.meanYds} vs ${off.safe.club} ${off.safe.meanYds}`);
  assert.ok(Math.abs(r.safe.meanYds - g.center) < Math.abs(off.safe.meanYds - g.center), "the average shot finishes nearer the middle");
  assert.ok(r.safe.troubleRate <= off.safe.troubleRate + DEFAULT_CONFIG.STRATEGY.maxExtraTrouble);
  assert.deepEqual(off.strategy, [], "with the rules off nothing is named");
});

test("T45 back pin → take less than the pin yardage; the average shot finishes in the middle", () => {
  // 137 yds to the middle of a 40-yd-deep green (Oct 4 profile + par ranking, D85/D78: from 390 the
  // plain pick no longer flew the pin; from 404 the par ranking alone already played the middle).
  // v22.22 (C3, D93): with the aim-off on, the PW's 5 yds right is aimed out and the par ranking alone
  // plays it to the middle here, so the rule itself is checked with the aim-off off.
  const raw = { shotNo: 2, ball: { x: 0, y: 403 }, lieType: "fairway", pinPos: "back" };
  const noAim = { PATTERN_AIM_MIN_YDS: Infinity };
  const r = recommend(raw, deepGreen, loadProfile(RAW, mergeConfig(noAim))), off = recommend(raw, deepGreen, loadProfile(RAW, mergeConfig({ ...OFF, ...noAim })));
  const g = greenDistances(deepGreen, raw.ball, "back");
  assert.ok(off.safe.meanYds > g.pin, `the plain pick flies the back pin (${off.safe.club} ${off.safe.meanYds} vs ${g.pin})`);
  assert.deepEqual(r.strategy, ["pin-back"]);
  assert.ok(r.safe.meanYds < g.pin, `${r.safe.club} ${r.safe.meanYds} is less than the pin yardage ${g.pin}`);
  assert.ok(Math.abs(r.safe.meanYds - g.center) <= 5, `${r.safe.meanYds} vs center ${g.center}`);
  // and as shipped: SAFE still finishes in the middle, short of the back pin
  const c3 = recommend(raw, deepGreen, P);
  assert.ok(c3.safe.meanYds < g.pin && Math.abs(c3.safe.meanYds - g.center) <= 5, `${c3.safe.club} ${c3.safe.meanYds} (${c3.safe.target.label})`);
  assert.equal(c3.safe.target.label, "green, center");
});

test("T46 middle pin: only the wedges aim at the flag; front pin: nobody does", () => {
  const flagWedge = cand("GW", { aims: ["pin"], label: "green, custom pin", expScore: 3.9 });
  const centerWedge = cand("GW", { expScore: 3.95 });
  const flag7 = cand("7i", { aims: ["pin"], label: "green, custom pin", expScore: 3.9 });
  const center7 = cand("7i", { expScore: 3.95 });
  assert.equal(pickSafe([flagWedge, centerWedge], approachSit()).safe, flagWedge, "middle pin, wedge → may attack");
  assert.equal(pickSafe([flag7, center7], approachSit()).safe, center7, "middle pin, 7-iron → center");
  assert.equal(pickSafe([flagWedge, centerWedge], approachSit({ pin: "front" })).safe, centerWedge, "front pin, wedge → center");
  // and on a hole: a middle pin 7 yds left of center from 170 yds is never the 7-iron's SAFE target
  const pin = { x: -7, y: 540 };
  const r = recommend({ shotNo: 2, ball: { x: 0, y: 370 }, lieType: "fairway", pinPos: pin }, deepGreen, P);
  assert.equal(r.safe.kind, "approach");
  assert.ok(!DEFAULT_CONFIG.STRATEGY.attackClubs.includes(r.safe.club), r.safe.club);
  assert.ok(dist(r.safe.target, pin) > 3, `${r.safe.club} aims at ${r.safe.target.label}`);
  assert.deepEqual(r.strategy, ["pin-middle"]);
});

test("T47 club up: a club finishing short of the depth target counts double", () => {
  const nine = (mean, expScore) => cand("9i", { meanYds: mean, expScore });
  const eight = (mean, expScore) => cand("8i", { meanYds: mean, expScore });
  assert.equal(pickSafe([nine(145, 4.0), eight(156, 4.1)], approachSit()).safe.club, "8i", "5 short (×2 = 10) loses to 6 long");
  assert.equal(pickSafe([nine(148, 4.2), eight(157, 4.1)], approachSit()).safe.club, "9i", "2 short (×2 = 4) beats 7 long, inside the guards");
  // within 2 yds of each other on that scale, the better price decides
  const seven = cand("7i", { meanYds: 157, expScore: 4.05 });
  assert.equal(pickSafe([nine(145, 4.0), eight(156, 4.1), seven], approachSit()).safe.club, "7i");
});

test("T48 Brett's numbers overrule the pin rule only on more trouble or a big cost; a layup is never forced at the green", () => {
  const S = DEFAULT_CONFIG.STRATEGY;
  const best = cand("PW", { meanYds: 139, expScore: 4.0, troubleRate: 0.02 });   // 11 short → key 22
  const nineT = cand("9i", { meanYds: 148, expScore: 4.1, troubleRate: 0.02 + S.maxExtraTrouble + 0.03 });
  const nineC = cand("9i", { meanYds: 148, expScore: 4.0 + S.maxCostStrokes + 0.05 });
  const nineOk = cand("9i", { meanYds: 148, expScore: 4.3 });
  assert.equal(pickSafe([best, nineOk], approachSit()).safe, nineOk, "the rule's club within both guards");
  assert.equal(pickSafe([best, nineT], approachSit()).safe, best, "more trouble → the next club in line");
  assert.equal(pickSafe([best, nineC], approachSit()).safe, best, "more than half a stroke → the next club in line");
  const layup = cand("SW", { kind: "layup", aims: undefined, meanYds: 90, distToTarget: 90, expScore: 3.9, label: "leave 60, fairway center" });
  const r = pickSafe([layup, nineOk, best], approachSit());
  assert.equal(r.safe, layup, "the best-priced shot is a layup, so no approach rule applies");
  assert.deepEqual(r.rules, []);
});

test("T49 no hero golf: from the trees SAFE stays out of trouble 9 times in 10; the hero shot is still shown as AGGRESSIVE", () => {
  // just inside the tree line (Oct 4 profile, D85: from −35, 260 the plain pick was no longer a hero shot)
  const raw = { shotNo: 2, ball: { x: -32, y: 250 }, lieType: "recovery" };
  const r = recommend(raw, treesLeft, P), off = recommend(raw, treesLeft, Poff);
  assert.ok(off.safe.troubleRate > DEFAULT_CONFIG.STRATEGY.noHeroMaxTrouble, `the plain pick is a hero shot (${off.safe.troubleRate})`);
  assert.ok(r.strategy.includes("no-hero"), JSON.stringify(r.strategy));
  assert.ok(r.safe.troubleRate <= DEFAULT_CONFIG.STRATEGY.noHeroMaxTrouble, `${r.safe.club} ${r.safe.target.label} trouble ${r.safe.troubleRate}`);
  assert.equal(r.sameShot, false);
  assert.ok(r.aggressive.troubleRate > r.safe.troubleRate, "AGGRESSIVE keeps its price (locked rule 2)");
  // a standard rough lie is not a recovery shot
  assert.ok(!recommend({ ...raw, lieType: "rough" }, treesLeft, P).strategy.includes("no-hero"));
  // nothing clean enough → the least trouble: punch out
  const hero = cand("6i", { expScore: 4.6, troubleRate: 0.3 }), punch = cand("SW", { kind: "layup", expScore: 5.1, troubleRate: 0.14 });
  const p = pickSafe([hero, punch], approachSit({ recovery: true }));
  assert.equal(p.safe, punch);
  assert.deepEqual(p.rules, ["no-hero"]);
});

test("T50 driver default: a tie on a par-4/5 tee goes to the driver, never a par 3 or a second shot", () => {
  const corr = (club, o) => cand(club, { kind: "corridor", aims: undefined, meanYds: 250, distToTarget: 250, ...o });
  const dr = corr("Dr", { expScore: 4.12, meanYds: 289, distToTarget: 291 });
  const hy = corr("2Hy", { expScore: 4.10 });
  const tee = { teeShot: true, recovery: false, pin: "middle", depthTargetYds: 0 };
  assert.deepEqual(pickSafe([hy, dr], tee), { safe: dr, rules: ["driver"] });
  assert.equal(pickSafe([hy, dr], { ...tee, teeShot: false }).safe, hy, "not a par-4/5 tee shot → plays the number");
  assert.equal(pickSafe([hy, { ...dr, expScore: 4.2 }], tee).safe, hy, "outside the tie the price decides (T43)");
  const sit = (hole) => situationOf(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, hole), hole, greenDistances(hole, { x: 0, y: 0 }));
  assert.equal(sit(noWaterPar4).teeShot, true);
  assert.equal(sit(bunkeredPar3).teeShot, false);
});

test("rules off: SAFE is the plain lowest expected score again (locked rule 1), and the output names no rule", () => {
  const samples = makeSamples(DEFAULT_CONFIG.SAMPLES, DEFAULT_CONFIG.SEED);
  const cases = [
    [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", pinPos: "front" }, bunkeredPar3],
    [{ shotNo: 2, ball: { x: 0, y: 390 }, lieType: "fairway", pinPos: "back" }, deepGreen],
    [{ shotNo: 2, ball: { x: -35, y: 260 }, lieType: "recovery" }, treesLeft],
    [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterRightPar4],
  ];
  for (const [raw, hole] of cases) {
    const r = recommend(raw, hole, Poff);
    const ctx = normalizeContext(raw, hole);
    const minExp = Math.min(...generateCandidates(ctx, hole, Poff).map((c) => simulateCandidate(c, ctx, hole, Poff, samples).expScore));
    assert.deepEqual(r.strategy, []);
    assert.ok(r.safe.expScore <= minExp + DEFAULT_CONFIG.EXP_TIE_TOLERANCE + 0.006, `${hole.id}: ${r.safe.expScore} vs ${minExp}`);
  }
});
