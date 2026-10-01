/*
 * historyFix.test.js — v22.16: a finished round re-read from a verified local card.
 * Run: node --test src/historyFix.test.js
 *
 * The engine under test is the REAL one: computeGhost / evalMatch (frozen) and recordDifferential
 * are lifted out of src/app.jsx's source text and evaluated here, so these tests score the round
 * exactly as the app does — nothing is re-implemented.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { fixHistoryFromLocalCards, matchResult, recordNines, cardFixTag } from "./historyFix.js";
import { LOCAL_CLUBS } from "./localCards.js";

const APP = fs.readFileSync(new URL("./app.jsx", import.meta.url), "utf8");
const slice = (from, to) => { const i = APP.indexOf(from), j = APP.indexOf(to, i); assert.ok(i >= 0 && j > i, `app.jsx: ${from}`); return APP.slice(i, j); };
const ENGINE = new Function(`${slice("function computeGhost(", "\nconst scoreName")}\n${slice("function strokesByHole(", "/* Brett's official last-5")}
  return { computeGhost, evalMatch, recordDifferential };`)();
const { computeGhost, evalMatch, recordDifferential } = ENGINE;

const IRONWOOD = LOCAL_CLUBS.find((c) => c.key === "ironwood-fishers");
const [VALLEY, LAKES, RIDGE] = IRONWOOD.nines;

/* The 2026-09-28 round as Loop stored it before D54–D55: the API's "Lakes / Ridge" routing, whose
   back nine carried another nine's pars and yards, both nines handicapped 1–9 (every index twice).
   Synthetic stand-in — the real record lives only on Brett's phone. */
const API_PARS = [...LAKES.pars, ...VALLEY.pars];
const API_SI = [...LAKES.si, ...VALLEY.si];
const SCORES = [4, 4, 4, 4, 4, 7, 4, 6, 4, 5, 4, 4, 5, 4, 5, 4, 5, 4];     // 81, Shot Pattern's card
const RATING = 72.9, SLOPE = 138, DIFF = 8.4;

function storedRecord() {
  // built the way buildRecord does, on the API's card
  const course = { rating: RATING, slope: SLOPE, par: API_PARS.reduce((a, b) => a + b, 0), holes: API_PARS.map((p, i) => ({ par: p, si: API_SI[i] })) };
  const ghost = computeGhost(course, DIFF);
  const m = evalMatch(SCORES, ghost.holes);
  const rec = {
    version: 3, id: "rIron", date: "2026-09-28T21:40:00.000Z", updatedAt: 1759095600000,
    course: "Ironwood Golf Club", tee: "Blue", ratingSlope: `${RATING}/${SLOPE}`, rating: RATING, slope: SLOPE, par: course.par,
    pars: API_PARS, strokeIndex: API_SI, differentialUsed: DIFF,
    holeScores: SCORES, ghostHoleScores: ghost.holes, yardages: [...LAKES.yards.Blue, ...VALLEY.yards.Blue],
    yourOut: 41, yourIn: 40, yourTotal: m.total.yourTot, ghostTotal: ghost.gross,
    yourPoints: m.you, ghostPoints: m.opp, result: matchResult(m.you), routing: "Lakes / Ridge",
  };
  rec.differential = recordDifferential(rec);
  return rec;
}
const OTHER = { id: "rH", date: "2026-09-20T20:00:00.000Z", course: "Hampton Golf Village", pars: Array(18).fill(4), strokeIndex: Array(18).fill(1), holeScores: Array(18).fill(4), updatedAt: 5 };
const run = (h, now = 1759300000000) => fixHistoryFromLocalCards(h, LOCAL_CLUBS, { computeGhost, evalMatch, recordDifferential, now });

test("card fix: pars, par, yards and the odd/even index come off the card; the ghost and the match are recomputed", () => {
  const before = storedRecord();
  const dupes = before.strokeIndex.filter((v, i, a) => a.indexOf(v) !== i);
  assert.equal(dupes.length, 9, "the synthetic record carries the API's duplicated 1–9 indexes");
  const { history, changed, skipped } = run([OTHER, before]);
  assert.equal(changed.length, 1); assert.deepEqual(skipped, []);
  const r = history[1];
  assert.deepEqual(r.pars, [...LAKES.pars, ...RIDGE.pars]);
  assert.deepEqual([...r.strokeIndex].sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.deepEqual(r.strokeIndex.slice(0, 9), LAKES.si.map((s) => 2 * s - 1));
  assert.deepEqual(r.strokeIndex.slice(9), RIDGE.si.map((s) => 2 * s));
  assert.equal(r.par, 72);
  assert.deepEqual(r.yardages, [...LAKES.yards.Blue, ...RIDGE.yards.Blue]);

  // exactly what a live round on the card would have stored
  const course = { rating: RATING, slope: SLOPE, par: 72, holes: r.pars.map((p, i) => ({ par: p, si: r.strokeIndex[i] })) };
  const ghost = computeGhost(course, DIFF);
  const m = evalMatch(SCORES, ghost.holes);
  assert.deepEqual(r.ghostHoleScores, ghost.holes);
  assert.equal(r.ghostTotal, ghost.gross);
  assert.equal(r.yourPoints, m.you); assert.equal(r.ghostPoints, m.opp);
  assert.equal(r.yourPoints + r.ghostPoints, 8);
  assert.equal(r.result, matchResult(m.you));
  assert.equal(r.differential, recordDifferential(r));

  // the API card's doubled indexes handed the ghost 18 strokes where 9 were owed; the card changes its holes
  assert.notDeepEqual(r.ghostHoleScores, before.ghostHoleScores);
  assert.deepEqual(changed[0].before, { result: before.result, yourPoints: before.yourPoints, ghostPoints: before.ghostPoints, ghostTotal: before.ghostTotal, differential: before.differential });
  assert.deepEqual(changed[0].nines, ["Lakes", "Ridge"]);

  // nothing else moved; updatedAt forward; the marker and the audit trail are set
  for (const k of ["id", "date", "course", "tee", "rating", "slope", "ratingSlope", "differentialUsed", "holeScores", "yourOut", "yourIn", "yourTotal", "routing", "version"]) {
    assert.deepEqual(r[k], before[k], k);
  }
  assert.ok(r.updatedAt > before.updatedAt);
  assert.equal(r.cardFix, "ironwood-fishers@1"); assert.equal(cardFixTag(IRONWOOD), "ironwood-fishers@1");
  assert.deepEqual(r.cardFixPrev.pars, API_PARS); assert.deepEqual(r.cardFixPrev.strokeIndex, API_SI);
  assert.equal(r.cardFixPrev.result, before.result);
  assert.equal(history[0], OTHER, "another club's round is the same object");
  assert.ok(!JSON.stringify(r).includes("undefined"));
});

test("card fix: the second run is a no-op (same array back, nothing bumped)", () => {
  const once = run([OTHER, storedRecord()]).history;
  const twice = run(once, 1759400000000);
  assert.equal(twice.history, once);
  assert.equal(twice.changed.length, 0);
  assert.deepEqual(twice.skipped, [{ id: "rIron", reason: "already fixed" }]);
});

test("card fix: a round already on the card, and rounds whose nines or numbers are missing, are left alone and reported", () => {
  const fixed = run([storedRecord()]).history[0];
  const clean = { ...fixed }; delete clean.cardFix; delete clean.cardFixPrev;           // a v22.12+ round played on the card
  let res = run([clean]);
  assert.equal(res.history[0], clean); assert.deepEqual(res.skipped, [{ id: "rIron", reason: "matches the card" }]);

  const noNines = { ...storedRecord() }; delete noNines.routing;
  res = run([noNines]);
  assert.equal(res.history[0], noNines); assert.deepEqual(res.skipped, [{ id: "rIron", reason: "nines unknown" }]);

  const oddNines = { ...storedRecord(), routing: "Front / Back" };
  assert.deepEqual(run([oddNines]).skipped, [{ id: "rIron", reason: "nines unknown" }]);

  const noDiff = { ...storedRecord() }; delete noDiff.differentialUsed;
  assert.deepEqual(run([noDiff]).skipped, [{ id: "rIron", reason: "cannot re-score" }]);

  // nines read from a `nines` field too, in the order played; a tee the card lacks keeps its yards
  const viaNines = { ...storedRecord(), routing: undefined, nines: { play: ["Ridge", "Lakes"] }, tee: "Tips" };
  const f = run([viaNines]).history[0];
  assert.deepEqual(f.pars, [...RIDGE.pars, ...LAKES.pars]);
  assert.deepEqual(f.strokeIndex.slice(0, 9), RIDGE.si.map((s) => 2 * s - 1));
  assert.deepEqual(f.yardages, viaNines.yardages);
  assert.deepEqual(recordNines({ routing: "lakes/ridge" }, IRONWOOD), [1, 2]);
  assert.throws(() => fixHistoryFromLocalCards([], LOCAL_CLUBS, {}), /computeGhost and evalMatch/);
});

test("matchResult: the 8-point split, a tie at exactly 4", () => {
  assert.equal(matchResult(4.5), "W"); assert.equal(matchResult(4), "T"); assert.equal(matchResult(3.75), "L");
});
