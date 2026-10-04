/*
 * lines.test.js — v22.17 line played: Safe / Aggressive / Custom (shotlog.js linePlayedFor, the
 * legacy "own" read as "custom" everywhere), and the tee-shot grade (learning.js teeShotGrade).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { linePlayedFor, isCustomLine, normLine, newShotRecord, quickLog, CUSTOM_LINE } from "./shotlog.js";
import { aggressionScorecard, teeShotGrade } from "./learning.js";
import { aggressionView, aggressionModel, lineLabel } from "./caddieState.js";

/** SAFE 2-iron to 230 up the middle, AGGRESSIVE driver to 280, ball on the tee at the origin. */
const rec = (o = {}) => ({
  context: { ball: { x: 0, y: 0 } },
  sameShot: false,
  safe: { club: "2i", target: { x: 0, y: 230 }, expScore: 4.6 },
  aggressive: { club: "Dr", target: { x: 0, y: 280 }, expScore: 4.7 },
  ...o,
});
const set = (x, y) => ({ target: { x, y }, source: "set" });

test("custom line: another club than both options is custom, wherever it was aimed", () => {
  assert.equal(linePlayedFor(set(0, 230), rec(), "4Hy"), "custom");
  assert.equal(linePlayedFor(set(0, 230), rec(), "2i"), "safe");
  assert.equal(linePlayedFor(set(0, 280), rec(), "Dr"), "aggressive");
  // a same-shot recommendation: only SAFE's club counts
  assert.equal(linePlayedFor(set(0, 230), rec({ sameShot: true, aggressive: null }), "Dr"), "custom");
});

test("custom line: an aim beyond max(15 yds, 10% of the shot) from both targets is custom; else the nearer (SAFE on a tie)", () => {
  // 230-yd shot → 10% = 23 yds beats the 15-yd floor
  assert.equal(linePlayedFor(set(20, 225), rec(), "2i"), "safe", "~21 yds off SAFE, inside 23");
  assert.equal(linePlayedFor(set(26, 230), rec(), "2i"), "custom", "26 yds off SAFE, 57 off AGGRESSIVE");
  assert.equal(linePlayedFor(set(0, 262), rec(), "Dr"), "aggressive", "nearer AGGRESSIVE");
  assert.equal(linePlayedFor(set(0, 255), rec(), "Dr"), "safe", "exactly between → SAFE");
  // a short shot: the 15-yd floor
  const wedge = rec({ safe: { club: "PW", target: { x: 0, y: 100 } }, aggressive: { club: "PW", target: { x: 6, y: 112 } } });
  assert.equal(linePlayedFor(set(10, 108), wedge, "PW"), "aggressive", "12.8 off SAFE, 5.7 off AGGRESSIVE: nearer wins");
  assert.equal(linePlayedFor(set(-16, 100), wedge, "PW"), "custom", "16 off SAFE on a 100-yd shot: beyond 15");
  // the ball can come from the record's start when the snapshot has none
  const noBall = rec({ context: {} });
  assert.equal(linePlayedFor(set(20, 225), noBall, "2i"), "custom", "no ball known → the 15-yd floor alone");
  assert.equal(linePlayedFor(set(20, 225), noBall, "2i", { ball: { x: 0, y: 0 } }), "safe");
  // tunable
  assert.equal(linePlayedFor(set(20, 225), rec(), "2i", { cfg: mergeConfig({ CUSTOM_LINE: { pct: 0.05 } }) }), "custom");
  assert.deepEqual(DEFAULT_CONFIG.CUSTOM_LINE, { minYds: 15, pct: 0.10 });
});

test("custom line: an untouched intent keeps the club rule; no recommendation → custom; records write custom", () => {
  assert.equal(linePlayedFor({ target: { x: 0, y: 230 }, source: "default" }, rec(), "Dr"), "aggressive", "the driver alone says aggressive");
  assert.equal(linePlayedFor(set(0, 230), null, "2i"), "custom");
  assert.equal(CUSTOM_LINE, "custom");
  const r = newShotRecord({ recommendation: rec(), club: "5i", start: { frame: { x: 0, y: 0 } } });
  assert.equal(r.linePlayed, "custom");
  const withIntent = newShotRecord({ recommendation: rec({ context: {} }), club: "2i", start: { frame: { x: 0, y: 0 } }, intent: set(20, 225) });
  assert.equal(withIntent.linePlayed, "safe", "the record's start frame supplies the ball");
  assert.equal(quickLog({ recommendation: null, club: "7i" }).linePlayed, "custom");
});

test("own = custom for every reader: isCustomLine, normLine, the scorecard, the labels", () => {
  assert.equal(isCustomLine("own"), true); assert.equal(isCustomLine("custom"), true); assert.equal(isCustomLine("safe"), false);
  assert.equal(normLine("own"), "custom"); assert.equal(normLine("aggressive"), "aggressive"); assert.equal(normLine(null), null);
  const shot = (id, line, hole) => ({ id, roundId: "r1", hole, shotNo: 1, club: "7i", shotType: "full", linePlayed: line,
    recommendation: { safe: { expScore: 4.0 }, aggressive: { expScore: 4.1 } } });
  const shots = [shot("a", "own", 1), shot("b", "custom", 2), shot("c", "safe", 3)];
  const sc = aggressionScorecard(shots, { r1: { 1: 4, 2: 5, 3: 4 } });
  assert.equal(sc.own.n, 2, "an old 'own' and a new 'custom' are one line");
  assert.equal(sc.custom, sc.own, "mirrored as custom");
  assert.ok(Math.abs(sc.own.delta - ((4 - 4.0) + (5 - 4.0))) < 1e-9, "custom is measured against SAFE's price");
  const v = aggressionView(sc);
  assert.deepEqual(v.counts.map((c) => [c.key, c.label, c.n]), [["safe", "Safe", 1], ["aggressive", "Aggressive", 0], ["own", "Custom", 2]]);
  assert.equal(aggressionView({ safe: { n: 0 }, aggressive: { n: 0 }, custom: { n: 3 }, text: null }).counts[2].n, 3, "a tally with only `custom` reads too");
  assert.equal(aggressionModel(shots, [{ id: "r1", holeScores: [4, 5, 4] }]).season.counts[2].label, "Custom");
  assert.deepEqual(["safe", "aggressive", "own", "custom", "x"].map(lineLabel), ["Safe", "Aggressive", "Custom", "Custom", null]);
});

test("teeShotGrade: tee shots by line, one round or many; putts, later shots, skipped and imported records left out", () => {
  const r = (roundId, shotNo, linePlayed, o = {}) => ({ roundId, hole: 1, shotNo, club: "Dr", shotType: "full", linePlayed, logged: "quick", ...o });
  const recs = [
    r("A", 1, "safe"), r("A", 1, "safe"), r("A", 1, "aggressive"), r("A", 1, "custom"), r("A", 1, "own"),
    r("A", 2, "safe"),                                   // not a tee shot
    r("A", 1, null),                                     // no line
    r("A", 1, "safe", { logged: "skipped" }),            // never confirmed
    r("A", 1, "safe", { shotType: "putt" }),             // a putt from the tee box? never counted
    r("B", 1, "aggressive"), r("B", 1, "safe"),
    r("SP", 1, "safe", { source: "shotpattern" }),       // imports never know the line
  ];
  assert.deepEqual(teeShotGrade(recs), { safe: 3, aggressive: 2, custom: 2, total: 7 });
  assert.deepEqual(teeShotGrade(recs.filter((x) => x.roundId === "A")), { safe: 2, aggressive: 1, custom: 2, total: 5 });
  assert.deepEqual(teeShotGrade([]), { safe: 0, aggressive: 0, custom: 0, total: 0 });
  assert.deepEqual(teeShotGrade(null), { safe: 0, aggressive: 0, custom: 0, total: 0 });
});
