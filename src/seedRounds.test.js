/*
 * seedRounds.test.js — Brett's imported scorecards (v22.8; June 17 → Aug 9 added Oct 1): every
 * card is a real 18, the differential each one reproduces matches GHIN, the five NEWEST cards
 * average to what Setup should show, and historyRows() merges rounds + seeds without letting a
 * seed carry points.
 * Run: node --test src/seedRounds.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEED_ROUNDS, historyRows } from "./seedRounds.js";

/* Same one-line formula as scoreDifferential in app.jsx (duplicated here on purpose — app.jsx
 * is JSX and isn't importable by the plain node test runner). Rounded to 0.1, no PCC. */
const scoreDifferential = (gross, rating, slope) => Math.round((gross - rating) * 113 / slope * 10) / 10;

test("SEED_ROUNDS: every card is 18 holes, pars/yards/scores all present", () => {
  assert.equal(SEED_ROUNDS.length, 12);
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

test("SEED_ROUNDS: every card reproduces GHIN's differential for its date (data/extracted/2026-09-30-ghin-scores.json)", () => {
  const ghin = {
    "2026-09-20": 6.8, "2026-09-12": 4.8, "2026-09-02": 12.8, "2026-08-23": 6.5, "2026-08-15": 6.1,
    "2026-08-09": 7.6, "2026-08-03": 4.5, "2026-07-26": 9.9, "2026-07-17": 6.9,
    "2026-06-27": 10.6, "2026-06-21": 1.6, "2026-06-17": 6.4,
  };
  assert.deepEqual(SEED_ROUNDS.map((r) => r.date).sort(), Object.keys(ghin).sort(), "one card per date");
  for (const r of SEED_ROUNDS) assert.equal(scoreDifferential(r.gross, r.rating, r.slope), ghin[r.date], `${r.date} ${r.course}`);
});

test("SEED_ROUNDS: the five newest cards average 7.4 — the older cards never reach the last-5 window", () => {
  const newest = [...SEED_ROUNDS].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  assert.deepEqual(newest.map((r) => r.date), ["2026-09-20", "2026-09-12", "2026-09-02", "2026-08-23", "2026-08-15"]);
  const avg = Math.round((newest.reduce((a, r) => a + scoreDifferential(r.gross, r.rating, r.slope), 0) / newest.length) * 10) / 10;
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

test("historyRows: empty history still returns every seed card", () => {
  const rows = historyRows(undefined, SEED_ROUNDS);
  assert.equal(rows.length, SEED_ROUNDS.length);
  assert.ok(rows.every((r) => r.kind === "card"));
});

test("historyRows: a round and a seed on the same date both appear (History shows the ledger as-is; dedupe is the differential's job, not the ledger's)", () => {
  const rows = historyRows([round("2026-09-20", "r-same-day")], SEED_ROUNDS);
  assert.equal(rows.length, SEED_ROUNDS.length + 1);
});
