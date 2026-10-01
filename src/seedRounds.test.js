/*
 * seedRounds.test.js — Brett's imported scorecards (v22.8; June 17 → Aug 9 added Oct 1): every
 * card is a real 18, the differential each one reproduces matches GHIN, the five NEWEST cards
 * average to what Setup should show, and historyRows() merges rounds + seeds without letting a
 * seed carry points.
 * Run: node --test src/seedRounds.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEED_ROUNDS, historyRows, seedMatch, scoreSeeds, recordLedger, dayTime } from "./seedRounds.js";
import { matchResult } from "./historyFix.js";

/* The engine under test is the REAL one, sliced out of app.jsx exactly as historyFix.test.js does —
 * computeGhost / evalMatch are frozen and never copied. */
const APP = fs.readFileSync(new URL("./app.jsx", import.meta.url), "utf8");
const slice = (from, to) => { const i = APP.indexOf(from), j = APP.indexOf(to, i); assert.ok(i >= 0 && j > i, `app.jsx: ${from}`); return APP.slice(i, j); };
const ENGINE = { ...new Function(`${slice("function computeGhost(", "\nconst scoreName")}\nreturn { computeGhost, evalMatch };`)(), matchResult };
const GHIN = JSON.parse(fs.readFileSync(new URL("../data/extracted/2026-09-30-ghin-scores.json", import.meta.url), "utf8"));

/* Same one-line formula as scoreDifferential in app.jsx (duplicated here on purpose — app.jsx
 * is JSX and isn't importable by the plain node test runner). Rounded to 0.1, no PCC. */
const scoreDifferential = (gross, rating, slope) => Math.round((gross - rating) * 113 / slope * 10) / 10;

test("SEED_ROUNDS: every card is 18 holes, pars/yards/scores/strokeIndex all present", () => {
  assert.equal(SEED_ROUNDS.length, 12);
  for (const r of SEED_ROUNDS) {
    for (const k of ["pars", "yards", "scores", "strokeIndex"]) {
      assert.equal(r[k].length, 18, `${r.course} ${k} should be 18 holes`);
      assert.ok(r[k].every((v) => typeof v === "number" && v > 0), `${r.course} ${k} should be all positive numbers`);
    }
    assert.deepEqual([...r.strokeIndex].sort((a, b) => a - b), [...Array(18)].map((_, i) => i + 1), `${r.course} strokeIndex should be 1–18 once each`);
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

/* ---------- the record vs. the ghost (v22.16.2) ---------- */

test("SEED_ROUNDS: ghostDiff is the last-5 Loop would have had that day (GHIN's differentials before it + Canongate's card)", () => {
  const pool = GHIN.rounds.map((r) => [r.date, r.diff]);
  pool.push(["2026-08-23", 6.5]);                                    // Canongate: a Loop seed, not in GHIN
  pool.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const s of SEED_ROUNDS) {
    const prior = pool.filter(([d]) => d < s.date).slice(-5);
    const want = Math.round((prior.reduce((a, [, v]) => a + v, 0) / prior.length) * 10) / 10;   // computeAutoDiff's rounding
    assert.equal(s.ghostDiff, want, `${s.date} ${s.course}: ${prior.length} prior rounds`);
  }
});

test("seedMatch: every card against its ghost, scored by the frozen engine", () => {
  const got = Object.fromEntries(SEED_ROUNDS.map((s) => { const m = seedMatch(s, ENGINE); return [s.date, `${m.result} ${m.yourPoints}-${m.ghostPoints} ghost ${m.ghostTotal} (gets ${m.ghostHcp})`]; }));
  assert.deepEqual(got, {
    "2026-06-17": "W 4.5-3.5 ghost 84 (gets 12)",
    "2026-06-21": "W 7.5-0.5 ghost 82 (gets 12)",
    "2026-06-27": "L 2.75-5.25 ghost 81 (gets 9)",
    "2026-07-17": "W 5-3 ghost 81 (gets 9)",
    "2026-07-26": "L 2.25-5.75 ghost 78 (gets 7)",
    "2026-08-03": "W 6-2 ghost 81 (gets 9)",
    "2026-08-09": "L 3.5-4.5 ghost 79 (gets 9)",
    "2026-08-15": "W 4.5-3.5 ghost 83 (gets 11)",
    "2026-08-23": "T 4-4 ghost 82 (gets 11)",
    "2026-09-02": "L 1.5-6.5 ghost 79 (gets 7)",
    "2026-09-12": "T 4-4 ghost 82 (gets 10)",
    "2026-09-20": "W 4.5-3.5 ghost 82 (gets 11)",
  });
});

test("seedMatch: a card without a stroke index or ghost differential is not scored", () => {
  const s = SEED_ROUNDS[0];
  assert.equal(seedMatch({ ...s, strokeIndex: null }, ENGINE), null);
  assert.equal(seedMatch({ ...s, ghostDiff: undefined }, ENGINE), null);
});

test("recordLedger: cards and played rounds, oldest first; the cards alone are 6–4–2", () => {
  const scored = scoreSeeds(SEED_ROUNDS, ENGINE);
  const cardsOnly = recordLedger([], scored);
  assert.equal(cardsOnly.length, 12);
  const tally = cardsOnly.reduce((a, r) => ({ ...a, [r.result]: (a[r.result] || 0) + 1 }), {});
  assert.deepEqual(tally, { W: 6, L: 4, T: 2 });
  assert.equal(cardsOnly[0].date, "2026-06-17");
  assert.equal(cardsOnly.at(-1).date, "2026-09-20");
  const played = { id: "rIron", date: "2026-09-29T21:10:00.000Z", result: "W", yourPoints: 5, ghostPoints: 3 };
  const both = recordLedger([played], scored);
  assert.equal(both.length, 13);
  assert.equal(both.at(-1), played, "the played round is newest and passes through untouched");
  assert.ok(both.every((r, i) => i === 0 || dayTime(both[i - 1].date) <= dayTime(r.date)));
});

test("dayTime: a bare date is that day at local noon, never the evening before", () => {
  const d = new Date(dayTime("2026-09-20"));
  assert.equal(d.getDate(), 20);
  assert.equal(d.getHours(), 12);
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

test("historyRows: a card row carries its result only under seed.match — never top-level points", () => {
  const rows = historyRows([], scoreSeeds(SEED_ROUNDS, ENGINE));
  assert.equal(rows.length, SEED_ROUNDS.length);
  for (const row of rows) {
    assert.equal(row.kind, "card");
    assert.equal(row.seed.yourPoints, undefined);
    assert.equal(row.seed.ghostPoints, undefined);
    assert.equal(row.seed.result, undefined);
    assert.ok(row.seed.match && ["W", "L", "T"].includes(row.seed.match.result));
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
