/*
 * baseline.js — the published expected-strokes baseline the engine subtracts Brett's strokes
 * gained from (spec §3.5: "The scratch baseline table must come from a published strokes-gained
 * baseline; cite the source in a code comment. Do not invent baseline values.").
 *
 * SOURCE
 *   Mark Broadie, "Every Shot Counts" (Gotham Books, 2014) — the PGA TOUR average-strokes-to-
 *   hole-out tables by distance and lie (tee, fairway, rough, sand, recovery) and by putt length,
 *   built from ShotLink 2004–2012. The same benchmark function J(d, c) is defined in Broadie,
 *   "Assessing Golfer Performance on the PGA TOUR", Interfaces 42(2), 2012.
 *
 * POPULATION — READ THIS
 *   This is the PGA TOUR baseline, not a scratch table. Shot Pattern scores Brett's strokes gained
 *   against ITS scratch benchmark ("Target: Scratch", report §08), which it compiles from Arccos,
 *   Broadie, Stagner, Shot Scope and Tour data and does not publish as a table. A scratch table is
 *   roughly 0.2–0.3 strokes above Tour at 100–200 yds (Stagner/Arccos: scratch from 100 yds
 *   fairway ≈ 3.04 vs Tour 2.80). The engine compares candidates against each other, so a
 *   near-uniform offset does not change the ranking; it does shift the displayed "Avg" down.
 *   Config `BASELINE_SCRATCH_OFFSET` (default 0) adds a flat correction if Brett wants the
 *   absolute number closer to scratch. Replace this table with a published scratch table when one
 *   is available — the shape of the module is the only thing the engine depends on.
 *
 *   Transcribed in a session with no network access to golf-stats sites; verify against the book
 *   before the caddie ships on course (S3). Values are the widely reproduced Tour figures
 *   (e.g. fairway 100 → 2.80, 160 → 2.98, 200 → 3.19; tee 400 → 3.99; 8-ft putt → 1.50).
 *
 * Pure data + interpolation. No DOM, no storage, no network.
 */

/* Distance (yds) → strokes, by lie. Linear interpolation between rows, clamped at both ends. */
const ROWS = [
  //  yds   tee   fairway rough  sand   recovery
  [   20,  null,  2.40,  2.59,  2.53,  3.45 ],
  [   40,  null,  2.60,  2.78,  2.82,  3.51 ],
  [   60,  null,  2.70,  2.91,  3.15,  3.57 ],
  [   80,  null,  2.75,  2.96,  3.24,  3.65 ],
  [  100,  2.92,  2.80,  3.02,  3.23,  3.71 ],
  [  120,  2.99,  2.85,  3.08,  3.21,  3.79 ],
  [  140,  2.97,  2.91,  3.15,  3.22,  3.83 ],
  [  160,  2.99,  2.98,  3.23,  3.28,  3.87 ],
  [  180,  3.05,  3.08,  3.31,  3.40,  3.92 ],
  [  200,  3.12,  3.19,  3.42,  3.55,  3.98 ],
  [  220,  3.17,  3.32,  3.53,  3.70,  4.05 ],
  [  240,  3.25,  3.45,  3.64,  3.84,  4.12 ],
  [  260,  3.45,  3.58,  3.74,  3.93,  4.17 ],
  [  280,  3.65,  3.69,  3.83,  4.00,  4.23 ],
  [  300,  3.71,  3.78,  3.90,  4.04,  4.26 ],
  [  320,  3.79,  3.84,  3.95,  4.08,  4.28 ],
  [  340,  3.86,  3.88,  3.99,  4.12,  4.30 ],
  [  360,  3.92,  3.95,  4.02,  4.16,  4.34 ],
  [  380,  3.96,  4.00,  4.08,  4.20,  4.37 ],
  [  400,  3.99,  4.08,  4.16,  4.25,  4.41 ],
  [  420,  4.02,  4.15,  4.22,  4.30,  4.45 ],
  [  440,  4.08,  4.20,  4.29,  4.36,  4.50 ],
  [  460,  4.17,  4.26,  4.36,  4.42,  4.55 ],
  [  480,  4.28,  4.34,  4.43,  4.48,  4.60 ],
  [  500,  4.41,  4.43,  4.50,  4.54,  4.65 ],
  [  520,  4.54,  4.52,  4.58,  4.62,  4.71 ],
  [  540,  4.65,  4.62,  4.66,  4.70,  4.77 ],
  [  560,  4.74,  4.71,  4.74,  4.80,  4.84 ],
  [  580,  4.79,  4.79,  4.82,  4.88,  4.92 ],
  [  600,  4.82,  4.84,  4.88,  4.94,  4.98 ],
];
const COL = { tee: 1, fairway: 2, rough: 3, sand: 4, recovery: 5 };

/* Putt length (ft) → expected putts, PGA TOUR. */
const PUTTS = [
  [  1, 1.001 ], [  2, 1.009 ], [  3, 1.053 ], [  4, 1.147 ], [  5, 1.256 ], [  6, 1.357 ],
  [  7, 1.443 ], [  8, 1.515 ], [  9, 1.575 ], [ 10, 1.626 ], [ 15, 1.784 ], [ 20, 1.874 ],
  [ 30, 1.984 ], [ 40, 2.058 ], [ 50, 2.135 ], [ 60, 2.213 ], [ 90, 2.398 ],
];

/** Which lie labels the baseline knows. `trees` is priced as `recovery`; `tee` for irons ≈ fairway. */
export const BASELINE_LIES = Object.freeze(["tee", "fairway", "rough", "sand", "recovery"]);

function interpRows(rows, xIdx, yIdx, x) {
  const pts = rows.filter((r) => r[yIdx] != null);
  if (x <= pts[0][xIdx]) return pts[0][yIdx];
  const last = pts[pts.length - 1];
  if (x >= last[xIdx]) return last[yIdx];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[xIdx]) return a[yIdx] + ((x - a[xIdx]) / (b[xIdx] - a[xIdx])) * (b[yIdx] - a[yIdx]);
  }
  return last[yIdx];
}

/**
 * Baseline expected strokes to hole out from `yds` on a `lie`.
 * Tee rows start at 100 yds; a shorter tee shot (par-3 tee inside 100) prices as fairway.
 */
export function baselineE(yds, lie) {
  const l = lie === "trees" ? "recovery" : lie;
  if (!(l in COL)) throw new Error(`baselineE: unknown lie ${lie}`);
  if (l === "tee" && yds < 100) return interpRows(ROWS, 0, COL.fairway, yds);
  return interpRows(ROWS, 0, COL[l], yds);
}

/** Baseline expected putts from `ft` on the green. */
export function baselinePutts(ft) {
  return interpRows(PUTTS, 0, 1, Math.max(0, ft));
}

/** Exposed for tests and for the sanity check in profile.test.js. */
export const BASELINE_ROWS = ROWS;
export const BASELINE_PUTTS = PUTTS;
