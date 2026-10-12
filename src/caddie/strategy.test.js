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
  // v22.23 (D94: a shot finishes at its total). R11 (D130): from 4 yds back the plain 7-iron already plays to the
  // middle on his Oct 11 shots, so from 16 back, 191 to the middle: the plain 7-iron goes at the flag
  const raw = { shotNo: 1, ball: { x: 0, y: -16 }, lieType: "tee", pinPos: "front" };
  const r = recommend(raw, bunkeredPar3, P), off = recommend(raw, bunkeredPar3, Poff);
  const g = greenDistances(bunkeredPar3, raw.ball, "front");
  assert.deepEqual(r.strategy, ["pin-front"]);
  assert.notEqual(r.safe.target.label, "green, front pin", "SAFE does not aim at a front flag");
  assert.ok(r.safe.meanYds > off.safe.meanYds, `club up: ${r.safe.club} ${r.safe.meanYds} vs ${off.safe.club} ${off.safe.meanYds}`);
  assert.ok(Math.abs(r.safe.meanYds - g.center) < Math.abs(off.safe.meanYds - g.center), "the average shot finishes nearer the middle");
  assert.ok(r.safe.troubleRate <= off.safe.troubleRate + DEFAULT_CONFIG.STRATEGY.maxExtraTrouble);
  assert.deepEqual(off.strategy, [], "with the rules off nothing is named");
});

test("T45 back pin → never at the flag; the average shot finishes in the middle, short of the pin", () => {
  // 130 yds to the middle of a 40-yd-deep green, 137 to a back pin. v22.23 (D94): every club now
  // finishes at its total, so the plain pick no longer flies the pin on this green; it aims the PW
  // at the flag, and the rule moves the same club to the middle (before D94 the rule changed the club).
  const raw = { shotNo: 2, ball: { x: 0, y: 410 }, lieType: "fairway", pinPos: "back" };
  const r = recommend(raw, deepGreen, P), off = recommend(raw, deepGreen, Poff);
  const g = greenDistances(deepGreen, raw.ball, "back");
  assert.equal(off.safe.target.label, "green, back pin", `the plain pick goes at the flag (${off.safe.club})`);
  assert.deepEqual(r.strategy, ["pin-back"]);
  assert.notEqual(r.safe.target.label, "green, back pin");
  assert.ok(r.safe.meanYds < g.pin, `${r.safe.club} ${r.safe.meanYds} is less than the pin yardage ${g.pin}`);
  assert.ok(Math.abs(r.safe.meanYds - g.center) <= 5, `${r.safe.meanYds} vs center ${g.center}`);
});

test("T46 middle pin: only the wedges aim at the flag; front pin: nobody does", () => {
  const flagWedge = cand("GW", { aims: ["pin"], label: "green, custom pin", expScore: 3.9 });
  const centerWedge = cand("GW", { expScore: 3.95 });
  const flag7 = cand("7i", { aims: ["pin"], label: "green, custom pin", expScore: 3.9 });
  const center7 = cand("7i", { expScore: 3.95 });
  assert.equal(pickSafe([flagWedge, centerWedge], approachSit()).safe, flagWedge, "middle pin, wedge → may attack");
  assert.equal(pickSafe([flag7, center7], approachSit()).safe, center7, "middle pin, 7-iron → center");
  assert.equal(pickSafe([flagWedge, centerWedge], approachSit({ pin: "front" })).safe, centerWedge, "front pin, wedge → center");
  // and on a hole: a middle pin 7 yds left of center from 175 yds is never the 7-iron's SAFE target
  // (175, not 170, since v22.23: D94 plays the 7-iron to its 182 total)
  const pin = { x: -7, y: 540 };
  const r = recommend({ shotNo: 2, ball: { x: 0, y: 365 }, lieType: "fairway", pinPos: pin }, deepGreen, P);
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

test("R12 (D138): past 0.15 strokes the pin rule must save 2 points of trouble, or the best-priced shot stands", () => {
  const S = DEFAULT_CONFIG.STRATEGY;
  assert.equal(S.pinFreeStrokes, 0.15); assert.equal(S.pinMinTroubleSaved, 0.02);
  const best = cand("PW", { meanYds: 139, expScore: 4.0, troubleRate: 0.06 });     // 11 short of the middle
  const free = cand("9i", { meanYds: 148, expScore: 4.1, troubleRate: 0.06 });     // 0.1 dearer, same trouble: the guide's price
  const empty = cand("9i", { meanYds: 148, expScore: 4.2, troubleRate: 0.06 });    // 0.2 dearer for nothing
  const buys = cand("9i", { meanYds: 148, expScore: 4.2, troubleRate: 0.03 });     // 0.2 dearer, 3 points less trouble
  assert.equal(pickSafe([best, free], approachSit()).safe, free, "up to 0.15: the middle of the green, as before");
  const r = pickSafe([best, empty], approachSit());
  assert.equal(r.safe, best, "0.2 for no less trouble: the best-priced shot");
  assert.deepEqual(r.rules, [], "and no pin rule named");
  assert.equal(pickSafe([best, buys], approachSit()).safe, buys, "0.2 that keeps it out of trouble: the guide wins");
  const before = mergeConfig({ STRATEGY: { pinFreeStrokes: null } });
  assert.equal(pickSafe([best, empty], approachSit(), before).safe, empty, "without the guard (v22.64): the middle at any price under ½ stroke");
});

test("T49 no hero golf: from the trees SAFE stays out of trouble 9 times in 10; the hero shot is still shown as AGGRESSIVE", () => {
  // just inside the tree line (Oct 4 profile, D85: from −35, 260 the plain pick was no longer a hero shot;
  // v22.23, D94: from −32, 250 the plain pick is a clean wedge, so 30 yds farther back; v22.33, D104:
  // the extra roll off a bad lie comes out of the carry, and from −32, 280 the plain pick is clean too.
  // R11, D130: on his Oct 11 shots −35, 300 is clean as well, so 18 yds inside the tree line, 120 from the
  // green: the plain 8-iron finds trouble 1 in 5 and SAFE punches out)
  const raw = { shotNo: 2, ball: { x: -45, y: 290 }, lieType: "recovery" };
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

/* ---------- C9 (v22.34, D105): fairway bunkers are "no hero" lies ---------- */

/** The open par 5 with a fairway bunker 140–170 yds short of the green and water across its front. */
const fwBunker = { ...openPar5, id: "fairway-bunker", hazards: [
  { type: "sand", ring: rect(-12, 370, 12, 400) },
  { type: "water", ring: rect(-40, 490, 40, 524) },
] };
/** A long bunker across the front of the green, water behind it. */
const greenside = { ...openPar5, id: "greenside-bunker", hazards: [
  { type: "sand", ring: rect(-30, 465, 30, 522) },
  { type: "water", ring: rect(-40, 556, 40, 580) },
] };

test("C9: a fairway bunker with water ahead → no hero: SAFE stays clean 9 times in 10, the long club is still priced", async () => {
  const { whyLine } = await import("./reasons.js");
  // R11 (D130): from 345 the plain pick is already a clean lay-up on his Oct 11 shots; from 355, 169 to the
  // front, the 4-hybrid at the green finds the water 1 in 5
  const raw = { shotNo: 3, ball: { x: 0, y: 355 }, lieType: "sand", par: 5 };
  const r = recommend(raw, fwBunker, P);
  assert.ok(r.context.distances.front > DEFAULT_CONFIG.STRATEGY.fairwayBunkerMinYds);
  assert.ok(r.strategy.includes("no-hero"), JSON.stringify(r.strategy));
  assert.ok(r.safe.troubleRate <= DEFAULT_CONFIG.STRATEGY.noHeroMaxTrouble, `${r.safe.club} trouble ${r.safe.troubleRate}`);
  assert.ok(r.why.alt && r.why.alt.troubleRate > DEFAULT_CONFIG.STRATEGY.noHeroMaxTrouble, `without the rule: ${r.why.alt?.club}`);
  assert.ok(r.safe.target.y > raw.ball.y, "the lay-up moves toward the green");
  assert.match(whyLine(r, {}).text, /from the fairway bunker, it stays clean 9 times in 10/);
  // the rule switched off: the same spot plays the long club
  const off = recommend(raw, fwBunker, loadProfile(RAW, mergeConfig({ STRATEGY: { noHero: false } })));
  assert.equal(off.safe.club, r.why.alt.club);
});

test("C9: a greenside bunker is not a no-hero lie (D77 item 2), even when most shots find trouble", () => {
  const r = recommend({ shotNo: 3, ball: { x: 0, y: 490 }, lieType: "sand", par: 5 }, greenside, P);
  assert.ok(r.context.distances.front <= DEFAULT_CONFIG.STRATEGY.fairwayBunkerMinYds, `${r.context.distances.front} to the front`);
  assert.ok(r.safe.troubleRate > DEFAULT_CONFIG.STRATEGY.noHeroMaxTrouble, "the rule would have fired on trouble alone");
  assert.ok(!r.strategy.includes("no-hero"), JSON.stringify(r.strategy));
});

test("C9: the punch-out never aims away from the green: the least trouble among shots that move toward it", () => {
  const sit = approachSit({ recovery: true, ball: { x: 0, y: 300 }, green: { x: 0, y: 400 } });
  const back = cand("SW", { kind: "layup", target: { x: 0, y: 260 }, troubleRate: 0.12, expScore: 5.4 });
  const fwd = cand("9i", { kind: "layup", target: { x: 5, y: 350 }, troubleRate: 0.2, expScore: 5.0 });
  const hero = cand("6i", { target: { x: 0, y: 400 }, troubleRate: 0.45, expScore: 4.8 });
  assert.equal(pickSafe([back, fwd, hero], sit).safe, fwd);
  assert.equal(pickSafe([back, hero], sit).safe, hero, "only one shot moves toward the green: that is the punch-out");
  assert.equal(pickSafe([back], sit).safe, back, "nothing moves toward it: the least trouble, as before");
});
