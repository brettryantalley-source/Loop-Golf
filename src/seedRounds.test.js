/*
 * seedRounds.test.js — Brett's last five scorecards (v22.8): every card is a real 18, the
 * differential each one reproduces matches GHIN, the five-round average is what Setup should
 * show, and historyRows() merges rounds + seeds without letting a seed carry points.
 * Run: node --test src/seedRounds.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_ROUNDS, historyRows } from "./seedRounds.js";

/* Same one-line formula as scoreDifferential in app.jsx (duplicated here on purpose — app.jsx
 * is JSX and isn't importable by the plain node test runner). Rounded to 0.1, no PCC. */
const scoreDifferential = (gross, rating, slope) => Math.round((gross - rating) * 113 / slope * 10) / 10;

test("SEED_ROUNDS: every card is 18 holes, pars/yards/scores all present", () => {
  assert.equal(SEED_ROUNDS.length, 5);
  for (const r of SEED_ROUNDS) {
    for (const k of ["pars", "yards", "scores"]) {
      assert.equal(r[k].length, 18, `${r.course} ${k} should be 18 holes`);
      assert.ok(r[k].every((v) => typeof v === "number" && v > 0), `${r.course} ${k} should be all positive numbers`);
    }
    assert.equal(r.strokeIndex, null, `${r.course} strokeIndex should be null (not on the cards)`);
  }
});

test("SEED_ROUNDS: each card's scores add up to its cardTotal", () => {
  for (const r of SEED_ROUNDS) {
    const sum = r.scores.reduce((a, b) => a + b, 0);
    assert.equal(sum, r.cardTotal, `${r.course} scores should add to ${r.cardTotal}`);
  }
});

test("SEED_ROUNDS: each card reproduces its official differential from the adjusted gross", () => {
  const byName = Object.fromEntries(SEED_ROUNDS.map((r) => [r.course, r]));
  const expected = {
    "Hampton Golf Village": 6.8,
    "Lake Arrowhead Yacht & CC": 4.8,
    "Beachwood Golf Club": 12.8,
    "Canongate at Olde Atlanta": 6.5,
    "Chicopee Woods · Village/School": 6.1,
  };
  for (const [course, want] of Object.entries(expected)) {
    const r = byName[course];
    assert.ok(r, `expected a seed round for ${course}`);
    assert.equal(scoreDifferential(r.gross, r.rating, r.slope), want, `${course} differential`);
  }
});

test("SEED_ROUNDS: the five-round average differential is 7.4", () => {
  const avg = Math.round((SEED_ROUNDS.reduce((a, r) => a + scoreDifferential(r.gross, r.rating, r.slope), 0) / SEED_ROUNDS.length) * 10) / 10;
  assert.equal(avg, 7.4);
});

/* ---------- historyRows ---------- */

const round = (date, id) => ({ id, date, course: "Played Course", yourPoints: 5, ghostPoints: 3, result: "W" });

test("historyRows: merges rounds and seeds, newest first by date", () => {
  const history = [round("2026-09-01", "r1"), round("2026-09-25", "r2")];
  const rows = historyRows(history, SEED_ROUNDS);
  assert.equal(rows.length, history.length + SEED_ROUNDS.length);
  const dates = rows.map((r) => r.date);
  const sorted = [...dates].sort((a, b) => new Date(b) - new Date(a));
  assert.deepEqual(dates, sorted, "rows should be newest first");
  // the two played rounds should land in their correct spots relative to the seeds
  assert.equal(rows[0].kind, "round");
  assert.equal(rows[0].round.id, "r2");                    // 2026-09-25 is the newest of all
});

test("historyRows: seed rows never carry points — no yourPoints/ghostPoints/result on a card row", () => {
  const rows = historyRows([], SEED_ROUNDS);
  assert.equal(rows.length, SEED_ROUNDS.length);
  for (const row of rows) {
    assert.equal(row.kind, "card");
    assert.equal(row.seed.yourPoints, undefined);
    assert.equal(row.seed.ghostPoints, undefined);
    assert.equal(row.seed.result, undefined);
  }
});

test("historyRows: empty history still returns all five seed cards", () => {
  const rows = historyRows(undefined, SEED_ROUNDS);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.kind === "card"));
});

test("historyRows: a round and a seed on the same date both appear (History shows the ledger as-is; dedupe is the differential's job, not the ledger's)", () => {
  const rows = historyRows([round("2026-09-20", "r-same-day")], SEED_ROUNDS);
  assert.equal(rows.length, 6);
});
