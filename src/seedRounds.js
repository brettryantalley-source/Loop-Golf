/*
 * seedRounds.js — Brett's last five rounds, transcribed from his Shot Pattern scorecards
 * (Sep 29, 2026). Two jobs:
 *
 *   1. The last-5 differential floor (`computeAutoDiff` in app.jsx). `gross` is the ADJUSTED
 *      gross the official differential was computed from — GHIN's posted score, which caps holes
 *      at net double bogey — so the app reproduces the official number. Where GHIN has no posting
 *      (Canongate) the card total is used.
 *   2. Round history. `scores`, `pars` and `yards` are the card as played, hole 1 → 18, so History
 *      can show these rounds. They carry no ghost match and never count toward the W-L-T record.
 *
 * Rating / slope follow GHIN where posted (they can differ from Shot Pattern's tee data by a
 * tenth or two); Canongate's are the card's. Stroke indexes are not on the cards, so `strokeIndex`
 * is null and the app must not try to cap these itself.
 */

export const SEED_ROUNDS = [
  {
    date: "2026-09-20", course: "Hampton Golf Village", tee: "Championship", rating: 72.7, slope: 137,
    gross: 81, cardTotal: 83,                        // GHIN posted 82 → differential 6.8 ⇒ adjusted 81
    pars:   [4, 3, 4, 4, 5, 4, 4, 3, 4,  4, 3, 4, 5, 3, 5, 4, 3, 5],
    yards:  [433, 172, 387, 410, 560, 325, 615, 188, 430,  394, 210, 427, 567, 207, 565, 372, 201, 440],
    scores: [4, 4, 5, 4, 5, 5, 4, 3, 4,  4, 4, 4, 5, 5, 5, 5, 6, 7],
    strokeIndex: null, source: "shotpattern-card + ghin",
  },
  {
    date: "2026-09-12", course: "Lake Arrowhead Yacht & CC", tee: "Blue Fox", rating: 73.3, slope: 133,
    gross: 79, cardTotal: 82,                        // GHIN 79 → 4.8
    pars:   [5, 3, 4, 4, 5, 4, 3, 4, 4,  5, 4, 4, 3, 4, 4, 4, 3, 5],
    yards:  [484, 139, 316, 355, 548, 406, 213, 435, 401,  474, 331, 442, 204, 372, 411, 312, 145, 522],
    scores: [3, 2, 4, 6, 6, 5, 4, 4, 7,  6, 4, 4, 3, 4, 5, 5, 3, 7],
    strokeIndex: null, source: "shotpattern-card + ghin",
  },
  {
    date: "2026-09-05", course: "Beachwood Golf Club", tee: "Blue", rating: 71.6, slope: 127,
    gross: 86, cardTotal: 84,                        // GHIN 86 → 12.8; the card adds to 84 — flagged for Brett
    pars:   [5, 4, 4, 3, 4, 4, 4, 3, 5,  4, 4, 4, 4, 5, 3, 4, 5, 3],
    yards:  [527, 366, 396, 172, 391, 402, 343, 187, 546,  328, 404, 360, 397, 575, 199, 386, 488, 224],
    scores: [6, 5, 4, 4, 4, 5, 5, 4, 5,  6, 6, 4, 4, 5, 3, 4, 6, 4],
    strokeIndex: null, source: "shotpattern-card + ghin",
  },
  {
    date: "2026-08-23", course: "Canongate at Olde Atlanta", tee: "73.0 / 140", rating: 73.0, slope: 140,
    gross: 81, cardTotal: 81,                        // not in the GHIN list; card total → 6.5
    pars:   [4, 4, 3, 4, 5, 4, 4, 3, 4,  4, 4, 5, 3, 4, 4, 3, 4, 5],
    yards:  [436, 410, 198, 370, 489, 384, 370, 163, 450,  407, 381, 511, 173, 370, 418, 199, 351, 525],
    scores: [5, 4, 4, 5, 6, 6, 4, 4, 5,  4, 5, 5, 4, 5, 5, 2, 3, 5],
    strokeIndex: null, source: "shotpattern-card",
  },
  {
    date: "2026-08-15", course: "Chicopee Woods · Village/School", tee: "Gold", rating: 73.6, slope: 137,
    gross: 81, cardTotal: 83,                        // GHIN 81 → 6.1
    pars:   [4, 5, 4, 3, 4, 4, 3, 4, 5,  4, 4, 4, 3, 5, 4, 4, 3, 5],
    yards:  [369, 548, 423, 230, 402, 430, 196, 404, 559,  414, 401, 374, 159, 520, 432, 407, 206, 566],
    scores: [4, 5, 6, 4, 4, 4, 3, 6, 7,  4, 5, 5, 4, 5, 5, 4, 3, 5],
    strokeIndex: null, source: "shotpattern-card + ghin",
  },
];

/* Pure merge for History (v22.8): played rounds + seed scorecards, newest first, each row
 * tagged with what it is. Seeds never carry points — a "card" row is display-only, so History
 * can show it without pretending it's part of the W-L-T record. No DOM, no storage; app.jsx's
 * History component reads this and renders each row. */
export function historyRows(history, seeds) {
  const rows = [];
  (history || []).forEach((r) => { if (r && typeof r === "object") rows.push({ kind: "round", date: r.date, round: r }); });
  (seeds || []).forEach((s) => { if (s && typeof s === "object") rows.push({ kind: "card", date: s.date, seed: s }); });
  rows.sort((a, b) => {
    const da = new Date(a.date).getTime(), db = new Date(b.date).getTime();
    return (isNaN(db) ? 0 : db) - (isNaN(da) ? 0 : da);   // newest first
  });
  return rows;
}

/* Sanity: every card adds to its cardTotal, every array is 18 long. Throws at import if not. */
for (const r of SEED_ROUNDS) {
  for (const k of ["pars", "yards", "scores"]) if (r[k].length !== 18) throw new Error(`seedRounds: ${r.course} ${k} has ${r[k].length} holes`);
  const sum = r.scores.reduce((a, b) => a + b, 0);
  if (sum !== r.cardTotal) throw new Error(`seedRounds: ${r.course} scores add to ${sum}, card says ${r.cardTotal}`);
}
