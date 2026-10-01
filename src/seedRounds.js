/*
 * seedRounds.js — Brett's rounds before Loop, transcribed from his Shot Pattern scorecards: the
 * five most recent on Sep 29, 2026, and June 17 → Aug 9 on Oct 1 (with GHIN's scoring record,
 * data/extracted/2026-09-30-ghin-scores.json). Three jobs:
 *
 *   1. The last-5 differential floor (`computeAutoDiff` in app.jsx) — only the five newest rounds
 *      in the pool count, so the older cards here are history and never move the ghost. `gross`
 *      is the ADJUSTED gross the official differential was computed from — GHIN's posted score,
 *      which caps holes at net double bogey — so the app reproduces the official number. Where
 *      GHIN has no posting (Canongate) the card total is used.
 *   2. Round history. `scores`, `pars` and `yards` are the card as played, hole 1 → 18, so History
 *      can show these rounds.
 *   3. The record vs. the ghost (v22.16.2, Brett Oct 1 — before this, cards never counted). Each
 *      card is played against the ghost Loop would have built THAT day: `ghostDiff` is his last-5
 *      as of the date (GHIN's differentials before it, Canongate's card-total 6.5 included, the
 *      app's own rounding; June 17 and 21 have only 3 and 4 rounds on record before them), and
 *      `strokeIndex` is the tee's from golfcourseapi.com (id + tee on each line; every card's
 *      pars match the API's hole for hole). `seedMatch` scores it by CALLING the frozen
 *      computeGhost / evalMatch, injected from app.jsx — never copied, never edited.
 *
 * Rating / slope follow GHIN where posted (they can differ from Shot Pattern's tee data by a
 * tenth or two); Canongate's are the card's. The differential never re-caps these cards from
 * `strokeIndex`: `gross` stays GHIN's number.
 */

export const SEED_ROUNDS = [
  {
    date: "2026-09-20", course: "Hampton Golf Village", tee: "Championship", rating: 72.7, slope: 137,
    gross: 81, cardTotal: 83,                        // GHIN posted 82 → differential 6.8 ⇒ adjusted 81
    pars:   [4, 3, 4, 4, 5, 4, 4, 3, 4,  4, 3, 4, 5, 3, 5, 4, 3, 5],
    yards:  [433, 172, 387, 410, 560, 325, 615, 188, 430,  394, 210, 427, 567, 207, 565, 372, 201, 440],
    scores: [4, 4, 5, 4, 5, 5, 4, 3, 4,  4, 4, 4, 5, 5, 5, 5, 6, 7],
    strokeIndex: [9, 13, 11, 1, 3, 17, 5, 15, 7,  16, 12, 4, 6, 8, 10, 18, 14, 2],  // golfcourseapi xa17vk0a Championship
    ghostDiff: 7.6,                                  // last-5 as of 09-20
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-09-12", course: "Lake Arrowhead Yacht & CC", tee: "Blue Fox", rating: 73.3, slope: 133,
    gross: 79, cardTotal: 82,                        // GHIN 79 → 4.8
    pars:   [5, 3, 4, 4, 5, 4, 3, 4, 4,  5, 4, 4, 3, 4, 4, 4, 3, 5],
    yards:  [484, 139, 316, 355, 548, 406, 213, 435, 401,  474, 331, 442, 204, 372, 411, 312, 145, 522],
    scores: [3, 2, 4, 6, 6, 5, 4, 4, 7,  6, 4, 4, 3, 4, 5, 5, 3, 7],
    strokeIndex: [3, 17, 15, 11, 1, 7, 13, 5, 9,  8, 12, 2, 16, 10, 6, 14, 18, 4],  // golfcourseapi pqwg28cp Blue
    ghostDiff: 7.5,                                  // last-5 as of 09-12
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-09-02", course: "Beachwood Golf Club", tee: "Blue", rating: 71.6, slope: 127,
    gross: 86, cardTotal: 84,                        // GHIN 86 → 12.8 (GHIN dates it 9/5; Shot Pattern's 9/2 is the day played); the card adds to 84 — flagged for Brett
    pars:   [5, 4, 4, 3, 4, 4, 4, 3, 5,  4, 4, 4, 4, 5, 3, 4, 5, 3],
    yards:  [527, 366, 396, 172, 391, 402, 343, 187, 546,  328, 404, 360, 397, 575, 199, 386, 488, 224],
    scores: [6, 5, 4, 4, 4, 5, 5, 4, 5,  6, 6, 4, 4, 5, 3, 4, 6, 4],
    strokeIndex: [15, 11, 5, 9, 3, 1, 17, 7, 13,  18, 2, 16, 14, 4, 8, 12, 10, 6],  // golfcourseapi 7zt1gsp1 Blue
    ghostDiff: 6.9,                                  // last-5 as of 09-02
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-08-23", course: "Canongate at Olde Atlanta", tee: "73.0 / 140", rating: 73.0, slope: 140,
    gross: 81, cardTotal: 81,                        // not in the GHIN list; card total → 6.5
    pars:   [4, 4, 3, 4, 5, 4, 4, 3, 4,  4, 4, 5, 3, 4, 4, 3, 4, 5],
    yards:  [436, 410, 198, 370, 489, 384, 370, 163, 450,  407, 381, 511, 173, 370, 418, 199, 351, 525],
    scores: [5, 4, 4, 5, 6, 6, 4, 4, 5,  4, 5, 5, 4, 5, 5, 2, 3, 5],
    strokeIndex: [1, 15, 9, 7, 11, 3, 13, 17, 5,  6, 12, 8, 18, 10, 2, 16, 14, 4],  // golfcourseapi cf989q0k (Olde Atlanta GC) Black
    ghostDiff: 7.0,                                  // last-5 as of 08-23
    source: "shotpattern-card",
  },
  {
    date: "2026-08-15", course: "Chicopee Woods · Village/School", tee: "Gold", rating: 73.6, slope: 137,
    gross: 81, cardTotal: 83,                        // GHIN 81 → 6.1
    pars:   [4, 5, 4, 3, 4, 4, 3, 4, 5,  4, 4, 4, 3, 5, 4, 4, 3, 5],
    yards:  [369, 548, 423, 230, 402, 430, 196, 404, 559,  414, 401, 374, 159, 520, 432, 407, 206, 566],
    scores: [4, 5, 6, 4, 4, 4, 3, 6, 7,  4, 5, 5, 4, 5, 5, 4, 3, 5],
    strokeIndex: [9, 11, 1, 13, 7, 3, 17, 15, 5,  4, 16, 12, 18, 10, 2, 8, 14, 6],  // golfcourseapi ns1thsaa Gold
    ghostDiff: 7.9,                                  // last-5 as of 08-15
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-08-09", course: "Riverpines Golf Course", tee: "Black", rating: 71.1, slope: 132,
    gross: 80, cardTotal: 80,                        // GHIN 80 → 7.6 (Shot Pattern calls the tee Championship)
    pars:   [4, 4, 3, 4, 3, 4, 4, 5, 4,  4, 4, 4, 4, 3, 4, 3, 5, 4],
    yards:  [422, 418, 172, 447, 209, 436, 363, 540, 325,  374, 410, 383, 420, 174, 405, 184, 501, 419],
    scores: [4, 4, 3, 5, 3, 5, 4, 5, 4,  5, 6, 4, 4, 5, 4, 4, 6, 5],
    strokeIndex: [7, 9, 17, 1, 13, 5, 11, 3, 15,  12, 6, 14, 8, 18, 4, 16, 10, 2],  // golfcourseapi n5n1n2f7 Black
    ghostDiff: 6.7,                                  // last-5 as of 08-09
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-08-03", course: "Chicopee Woods · Village/Mill", tee: "Gold", rating: 72.7, slope: 133,
    gross: 78, cardTotal: 78,                        // GHIN 78 → 4.5
    pars:   [4, 5, 4, 3, 4, 4, 3, 4, 5,  5, 3, 4, 5, 3, 4, 4, 4, 4],
    yards:  [369, 548, 423, 230, 402, 430, 196, 404, 559,  525, 164, 357, 571, 251, 419, 334, 400, 426],
    scores: [4, 6, 4, 3, 4, 4, 3, 4, 5,  5, 3, 3, 6, 5, 4, 5, 5, 5],
    strokeIndex: [9, 11, 1, 13, 7, 3, 17, 15, 5,  18, 16, 12, 8, 4, 2, 14, 10, 6],  // golfcourseapi c3jm8n4d Gold
    ghostDiff: 7.1,                                  // last-5 as of 08-03
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-07-26", course: "Sugar Creek Golf Course", tee: "Blue", rating: 70.1, slope: 125,
    gross: 81, cardTotal: 81,                        // GHIN 81 → 9.9
    pars:   [4, 5, 4, 5, 4, 3, 4, 4, 3,  4, 3, 4, 4, 4, 4, 4, 3, 5],
    yards:  [389, 488, 425, 486, 415, 144, 336, 363, 197,  384, 165, 417, 410, 386, 324, 341, 164, 484],
    scores: [3, 5, 6, 6, 5, 3, 5, 4, 3,  5, 3, 6, 4, 5, 5, 5, 3, 5],
    strokeIndex: [8, 2, 4, 7, 6, 18, 16, 11, 12,  10, 15, 1, 5, 9, 14, 13, 17, 3],  // golfcourseapi 4w8kgg9d Blue
    ghostDiff: 6.9,                                  // last-5 as of 07-26
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-07-17", course: "Chicopee Woods · Mill/School", tee: "Gold", rating: 72.7, slope: 135,
    gross: 81, cardTotal: 80,                        // GHIN 81 → 6.9 (GHIN: School/Mill); the card adds to 80 — flagged for Brett
    pars:   [5, 3, 4, 5, 3, 4, 4, 4, 4,  4, 4, 4, 3, 5, 4, 4, 3, 5],
    yards:  [525, 164, 357, 571, 251, 419, 334, 400, 426,  414, 401, 374, 159, 520, 432, 407, 206, 566],
    scores: [4, 3, 4, 5, 4, 5, 4, 6, 4,  5, 5, 4, 3, 5, 5, 6, 4, 4],
    strokeIndex: [17, 15, 11, 7, 3, 1, 13, 9, 5,  4, 16, 12, 18, 10, 2, 8, 14, 6],  // golfcourseapi rp4r4x8z Gold
    ghostDiff: 7.1,                                  // last-5 as of 07-17
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-06-27", course: "Woodmont Golf & CC", tee: "Medal", rating: 71.3, slope: 135,
    gross: 84, cardTotal: 85,                        // GHIN posted 84 → 10.6 (hole caps)
    pars:   [5, 3, 4, 4, 4, 3, 4, 4, 5,  5, 3, 4, 3, 4, 3, 5, 4, 5],
    yards:  [506, 166, 392, 432, 397, 120, 363, 442, 518,  506, 106, 373, 142, 391, 179, 543, 360, 485],
    scores: [5, 5, 6, 4, 5, 3, 4, 4, 5,  5, 6, 5, 3, 6, 2, 7, 4, 6],
    strokeIndex: [15, 11, 9, 1, 5, 17, 7, 3, 13,  12, 18, 6, 14, 2, 10, 4, 8, 16],  // golfcourseapi tnw4ghn5 Medal
    ghostDiff: 7.9,                                  // last-5 as of 06-27
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-06-21", course: "Riverpines Golf Course", tee: "Black", rating: 71.1, slope: 132,
    gross: 73, cardTotal: 73,                        // GHIN 73 → 1.6 (eagle on 17)
    pars:   [4, 4, 3, 4, 3, 4, 4, 5, 4,  4, 4, 4, 4, 3, 4, 3, 5, 4],
    yards:  [422, 418, 172, 447, 209, 436, 363, 540, 325,  374, 410, 383, 420, 174, 405, 184, 501, 419],
    scores: [4, 5, 3, 4, 4, 4, 5, 4, 4,  5, 5, 4, 4, 3, 5, 3, 3, 4],
    strokeIndex: [7, 9, 17, 1, 13, 5, 11, 3, 15,  12, 6, 14, 8, 18, 4, 16, 10, 2],  // golfcourseapi n5n1n2f7 Black
    ghostDiff: 9.5,                                  // last-5 as of 06-21; only 4 GHIN rounds before it on record
    source: "shotpattern-card + ghin",
  },
  {
    date: "2026-06-17", course: "Woodmont Golf & CC", tee: "Medal", rating: 71.3, slope: 135,
    gross: 79, cardTotal: 81,                        // GHIN posted 80 → differential 6.4 ⇒ adjusted 79; attested
    pars:   [5, 3, 4, 4, 4, 3, 4, 4, 5,  5, 3, 4, 3, 4, 3, 5, 4, 5],
    yards:  [506, 166, 392, 432, 397, 120, 363, 442, 518,  506, 106, 373, 142, 391, 179, 543, 360, 485],
    scores: [5, 3, 3, 5, 5, 4, 5, 4, 4,  7, 3, 5, 3, 4, 2, 7, 7, 5],
    strokeIndex: [15, 11, 9, 1, 5, 17, 7, 3, 13,  12, 18, 6, 14, 2, 10, 4, 8, 16],  // golfcourseapi tnw4ghn5 Medal
    ghostDiff: 10.5,                                 // last-5 as of 06-17; only 3 GHIN rounds before it on record
    source: "shotpattern-card + ghin",
  },
];

/* A date-only "YYYY-MM-DD" is read as local noon (a bare date parses as UTC midnight, which is the
 * evening before in Georgia); anything else as given. */
export function dayTime(date) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? `${date}T12:00:00` : date);
  return d.getTime();
}

/* One card against its ghost → { ghostDiff, ghostHcp, ghostHoleScores, ghostTotal, yourPoints,
 * ghostPoints, result }, or null when the card has no stroke index or ghost differential.
 * `engine` = { computeGhost, evalMatch, matchResult } (app.jsx / historyFix.js). Pure. */
export function seedMatch(seed, engine) {
  if (!seed || !Array.isArray(seed.strokeIndex) || seed.strokeIndex.length !== 18 || typeof seed.ghostDiff !== "number") return null;
  const par = seed.pars.reduce((a, b) => a + b, 0);
  const course = { rating: seed.rating, slope: seed.slope, par, holes: seed.pars.map((p, i) => ({ par: p, si: seed.strokeIndex[i] })) };
  const ghost = engine.computeGhost(course, seed.ghostDiff);
  const m = engine.evalMatch(seed.scores, ghost.holes);
  return { ghostDiff: seed.ghostDiff, ghostHcp: ghost.hcp, ghostHoleScores: ghost.holes.slice(), ghostTotal: ghost.gross,
           yourPoints: m.you, ghostPoints: m.opp, result: engine.matchResult(m.you) };
}

/* Every card with its match attached under `match` (null when it can't be scored). */
export function scoreSeeds(seeds, engine) {
  return (seeds || []).map((s) => ({ ...s, match: seedMatch(s, engine) }));
}

/* What the record is read from: played rounds plus every scored card, OLDEST first (deriveStats
 * reads the streak off the end). Played records pass through untouched; a card becomes
 * { date, result, yourPoints, ghostPoints, seed: true }. */
export function recordLedger(history, scoredSeeds) {
  const rows = (history || []).filter((r) => r && typeof r === "object" && r.result);
  (scoredSeeds || []).forEach((s) => {
    if (s && s.match) rows.push({ date: s.date, result: s.match.result, yourPoints: s.match.yourPoints, ghostPoints: s.match.ghostPoints, seed: true });
  });
  return rows.sort((a, b) => (dayTime(a.date) || 0) - (dayTime(b.date) || 0));
}

/* Pure merge for History (v22.8): played rounds + seed scorecards, newest first, each row
 * tagged with what it is. A card row carries its result only under `seed.match` (scoreSeeds);
 * it has no delete and no top-level points. No DOM, no storage; app.jsx's History component
 * reads this and renders each row. */
export function historyRows(history, seeds) {
  const rows = [];
  (history || []).forEach((r) => { if (r && typeof r === "object") rows.push({ kind: "round", date: r.date, round: r }); });
  (seeds || []).forEach((s) => { if (s && typeof s === "object") rows.push({ kind: "card", date: s.date, seed: s }); });
  rows.sort((a, b) => {
    const da = dayTime(a.date), db = dayTime(b.date);
    return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);   // newest first
  });
  return rows;
}

/* Sanity: every card adds to its cardTotal, every array is 18 long. Throws at import if not. */
for (const r of SEED_ROUNDS) {
  for (const k of ["pars", "yards", "scores", "strokeIndex"]) if (r[k].length !== 18) throw new Error(`seedRounds: ${r.course} ${k} has ${r[k].length} holes`);
  const sum = r.scores.reduce((a, b) => a + b, 0);
  if (sum !== r.cardTotal) throw new Error(`seedRounds: ${r.course} scores add to ${sum}, card says ${r.cardTotal}`);
}
