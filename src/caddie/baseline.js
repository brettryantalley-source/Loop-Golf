/*
 * baseline.js — the published expected-strokes baseline the engine subtracts Brett's strokes
 * gained from (spec §3.5: "The scratch baseline table must come from a published strokes-gained
 * baseline; cite the source in a code comment. Do not invent baseline values.").
 *
 * SOURCE (off the green)
 *   Broadie, M. (2012). Assessing Golfer Performance on the PGA TOUR. Interfaces 42(2):146–165,
 *   Appendix A Table 9 (DOI 10.1287/inte.1120.0626; table values from the author's April 8, 2011
 *   preprint, estimated from over 8 million ShotLink shots, 2003–2010). Transcribed verbatim,
 *   rows 10–600 yds, five lies; tee is null below 100 yds. Tee distance is measured along the
 *   dogleg. Values between rows are linearly interpolated. Research write-up and grading:
 *   docs/research/caddie-brain-2026-09-29.md §1.2; integration decision: docs/CADDIE-BRAIN-
 *   INTEGRATION.md item 1. (Replaces the Every Shot Counts transcription used through v22.10.)
 *
 *   Known quirks (Broadie chose not to smooth them; thin data and hole design): tee 120 (2.99) >
 *   tee 140 (2.97), and sand dips between 90 and 140 yds. Left raw, an optimiser would "prefer"
 *   a 140-yd tee shot to a 120-yd one. So the tee and sand columns are isotonically smoothed
 *   (pool-adjacent-violators, non-decreasing in distance) ONCE at module load; every other
 *   column is used exactly as published. Note the recovery column also dips 70→120 (3.84 →
 *   3.78) and sand passes recovery beyond ~420 yds; both are left as published (integration
 *   item 1 smooths tee and sand only).
 *
 * POPULATION — READ THIS
 *   This is the PGA TOUR baseline, not a scratch table. Shot Pattern scores Brett's strokes gained
 *   against ITS scratch benchmark ("Target: Scratch", report §08), which it compiles from Arccos,
 *   Broadie, Stagner, Shot Scope and Tour data and does not publish as a table. A scratch table is
 *   roughly 0.2–0.3 strokes above Tour at 100–200 yds (Stagner/Arccos: scratch from 100 yds
 *   fairway ≈ 3.04 vs Tour 2.80). The engine compares candidates against each other, so a
 *   near-uniform offset does not change the ranking; it does shift the displayed "Avg" down.
 *   Where Brett has no strokes-gained bucket, profile.js E() adds the handicap prior (config
 *   HCP_BLEND × the gap between Broadie's tour and 90-golfer tee lines); config
 *   `BASELINE_SCRATCH_OFFSET` (default 0) still adds a flat correction on top if wanted.
 *
 * Pure data + interpolation. No DOM, no storage, no network.
 */

/* Broadie (2012) Appendix A Table 9, verbatim. Distance (yds) → PGA TOUR expected strokes to hole out. */
const ROWS_RAW = Object.freeze([
  //  yds   tee   fairway rough  sand   recovery
  [   10,  null,  2.18,  2.34,  2.43,  3.45 ],
  [   20,  null,  2.40,  2.59,  2.53,  3.51 ],
  [   30,  null,  2.52,  2.70,  2.66,  3.57 ],
  [   40,  null,  2.60,  2.78,  2.82,  3.71 ],
  [   50,  null,  2.66,  2.87,  2.92,  3.79 ],
  [   60,  null,  2.70,  2.91,  3.15,  3.83 ],
  [   70,  null,  2.72,  2.93,  3.21,  3.84 ],
  [   80,  null,  2.75,  2.96,  3.24,  3.84 ],
  [   90,  null,  2.77,  2.99,  3.24,  3.82 ],
  [  100,  2.92,  2.80,  3.02,  3.23,  3.80 ],
  [  120,  2.99,  2.85,  3.08,  3.21,  3.78 ],
  [  140,  2.97,  2.91,  3.15,  3.22,  3.80 ],
  [  160,  2.99,  2.98,  3.23,  3.28,  3.81 ],
  [  180,  3.05,  3.08,  3.31,  3.40,  3.82 ],
  [  200,  3.12,  3.19,  3.42,  3.55,  3.87 ],
  [  220,  3.17,  3.32,  3.53,  3.70,  3.92 ],
  [  240,  3.25,  3.45,  3.64,  3.84,  3.97 ],
  [  260,  3.45,  3.58,  3.74,  3.93,  4.03 ],
  [  280,  3.65,  3.69,  3.83,  4.00,  4.10 ],
  [  300,  3.71,  3.78,  3.90,  4.04,  4.20 ],
  [  320,  3.79,  3.84,  3.95,  4.12,  4.31 ],
  [  340,  3.86,  3.88,  4.02,  4.26,  4.44 ],
  [  360,  3.92,  3.95,  4.11,  4.41,  4.56 ],
  [  380,  3.96,  4.03,  4.21,  4.55,  4.66 ],
  [  400,  3.99,  4.11,  4.30,  4.69,  4.75 ],
  [  420,  4.02,  4.19,  4.40,  4.83,  4.84 ],
  [  440,  4.08,  4.27,  4.49,  4.97,  4.94 ],
  [  460,  4.17,  4.34,  4.58,  5.11,  5.03 ],
  [  480,  4.28,  4.42,  4.68,  5.25,  5.13 ],
  [  500,  4.41,  4.50,  4.77,  5.40,  5.22 ],
  [  520,  4.54,  4.58,  4.87,  5.54,  5.32 ],
  [  540,  4.65,  4.66,  4.96,  5.68,  5.41 ],
  [  560,  4.74,  4.74,  5.06,  5.82,  5.51 ],
  [  580,  4.79,  4.82,  5.15,  5.96,  5.60 ],
  [  600,  4.82,  4.89,  5.25,  6.10,  5.70 ],
].map((r) => Object.freeze(r)));
const COL = { tee: 1, fairway: 2, rough: 3, sand: 4, recovery: 5 };
/** The columns smoothed at load (integration item 1). */
export const SMOOTHED_LIES = Object.freeze(["tee", "sand"]);

/**
 * Isotonic regression (pool-adjacent-violators), non-decreasing, equal weights. `column` is an
 * array of numbers or nulls; nulls are skipped and stay null. Returns a new array.
 */
export function isotonic(column) {
  const idx = [], blocks = [];                  // blocks: { sum, n }
  column.forEach((v, i) => { if (v != null && Number.isFinite(v)) idx.push(i); });
  for (const i of idx) {
    blocks.push({ sum: column[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  const out = column.map((v) => (v != null && Number.isFinite(v) ? v : null));
  let k = 0;
  for (const b of blocks) {
    const m = Math.round((b.sum / b.n) * 1e6) / 1e6;  // keep the pooled mean free of float dust
    for (let j = 0; j < b.n; j++) out[idx[k++]] = m;
  }
  return out;
}

/* The table the engine prices from: Table 9 with the tee and sand columns smoothed. */
const ROWS = (() => {
  const rows = ROWS_RAW.map((r) => [...r]);
  for (const lie of SMOOTHED_LIES) {
    const c = COL[lie];
    const s = isotonic(rows.map((r) => r[c]));
    rows.forEach((r, i) => { r[c] = s[i]; });
  }
  return Object.freeze(rows.map((r) => Object.freeze(r)));
})();

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
  return interpPts(pts.map((r) => [r[xIdx], r[yIdx]]), x);
}

function interpPts(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return last[1];
}

/* Per-lie [yds, strokes] points with the nulls dropped, built once. */
const PTS = Object.fromEntries(Object.entries(COL).map(([lie, c]) => [lie, ROWS.filter((r) => r[c] != null).map((r) => [r[0], r[c]])]));

/**
 * Baseline expected strokes to hole out from `yds` on a `lie`.
 * Tee rows start at 100 yds; a shorter tee shot (par-3 tee inside 100) prices as fairway.
 */
export function baselineE(yds, lie) {
  const l = lie === "trees" ? "recovery" : lie;
  if (!(l in COL)) throw new Error(`baselineE: unknown lie ${lie}`);
  if (l === "tee" && yds < 100) return interpPts(PTS.fairway, yds);
  return interpPts(PTS[l], yds);
}

/** Baseline expected putts from `ft` on the green. */
export function baselinePutts(ft) {
  return interpRows(PUTTS, 0, 1, Math.max(0, ft));
}

/** Exposed for tests and for the sanity check in profile.test.js. RAW = Table 9 as published;
 *  BASELINE_ROWS = what the engine prices from (tee and sand smoothed). */
export const BASELINE_ROWS_RAW = ROWS_RAW;
export const BASELINE_ROWS = ROWS;
export const BASELINE_PUTTS = PUTTS;
