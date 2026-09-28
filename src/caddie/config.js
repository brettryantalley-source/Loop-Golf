/*
 * config.js — every tunable the caddie engine reads, in one object (spec §3.3, §3.5, §3.6, §5).
 *
 * Nothing in here is measured. These are rules of thumb the spec asks to expose, so Brett can
 * tune them on the course without a rebuild. At runtime the app merges
 * `bogeyman-matches:config:v1` over DEFAULT_CONFIG (decision 1, Sep 28: no `loop.*` keys).
 *
 * Pure data. No DOM, no storage, no network.
 */

export const DEFAULT_CONFIG = Object.freeze({
  /* ---- plays-like (§3.3) ---- */
  ELEV_FACTOR: 1.0,            // yards of plays-like per yard of rise
  HEAD_PCT: 0.01,              // +1% of distance per mph of headwind
  TAIL_PCT: 0.005,             // −0.5% per mph of tailwind
  CROSS_YDS_PER_MPH_PER_100: 1.0, // crosswind aim offset: 1 yd per mph per 100 yds of shot

  /* Roll model: carry = total − roll (§3.3). Shot Pattern medians are TOTALS.
     Per-club yards of roll-out from the tee & fairway, in Brett's words (Sep 29): "my pitching
     wedge often has negligible roll-out, my 8 might roll out 6 yards, 5-iron 10 yards". Clubs not
     listed fall back to their family. Out of the rough those roughly triple (less spin):
     ROLL_LIE_MULT. Wet → 0 everywhere. */
  ROLL_YDS: {
    club: { "2Hy": 12, "4Hy": 12, "5i": 10, "6i": 9, "7i": 8, "8i": 6, "9i": 4, PW: 1, GW: 1, SW: 0, LW: 0 },
    full:    { long: 12, mid: 9, short: 4, wedge: 1 },   // family fallback
    finesse: { long: 3,  mid: 3, short: 1, wedge: 0 },
    tee: 0,                                            // driver / tee shots use total directly
    wet: 0,                                            // wet → no roll, every club
  },
  ROLL_LIE_MULT: { tee: 1, fairway: 1, rough: 3, sand: 1, recovery: 3 },

  /* ---- dispersion (§3.5) ---- */
  SAMPLES: 500,
  SEED: 20260928,               // fixed seed + common random numbers → deterministic output (T7, T8)
  /* Widening when the lie chip says bad / buried: +15% σ, −5 yds (spec default). */
  LIE_QUALITY: {
    good:     { sdMult: 1.0,  distYds: 0 },
    standard: { sdMult: 1.0,  distYds: 0 },
    bad:      { sdMult: 1.15, distYds: -5 },
    buried:   { sdMult: 1.15, distYds: -5 },
  },
  /* Fallbacks used ONLY when the profile entry for that lie has no measured value.
     Fraction of carry lost (negative = short) and σ multiplier, by lie type. Provisional. */
  LIE_DIST_ADJ: { tee: 0, fairway: 0, rough: -0.08, sand: -0.12, recovery: -0.30 },
  LIE_SD_MULT:  { tee: 1.0, fairway: 1.0, rough: 1.2, sand: 1.3, recovery: 1.8 },
  /* Longitudinal σ as a fraction of carry when the entry has no distSdYds (Shot Pattern gives an
     IQR for tee clubs only). By club family. Provisional. */
  DIST_SD_PCT: { long: 0.07, mid: 0.06, short: 0.05, wedge: 0.05 },
  /* Lateral magnitude of a big miss when the entry has none (Shot Pattern: big miss = > 35 yds offline). */
  BIG_MISS_LAT_YDS_DEFAULT: 45,

  /* ---- candidates (§3.4, §3.7) ---- */
  CORRIDOR_STEP_YDS: 5,         // aim points across the fairway at the club's distance
  LAYUP_MIN_YDS: 50,
  LAYUP_MAX_YDS: 150,
  LAYUP_STEP_YDS: 5,
  REACH_SHORT_TOLERANCE_YDS: 8, // a club "reaches" if carry ≥ front − this
  FLY_TOLERANCE_YDS: 20,        // prune clubs that fly the back edge by more than this (§3.4)

  /* ---- selection (§3.6) ---- */
  SAME_SHOT_BIRDIE_GAIN: 0.01,
  SAME_SHOT_TARGET_YDS: 10,
  SAME_AVG_DELTA: 0.05,         // |Δavg| under this displays as "≈ same avg."
  /* Two candidates whose expScore differ by less than this are a tie (500 samples put the standard
     error near 0.02, and model error is larger). Ties go to the club that plays the number: the
     one whose mean landing is nearest its target. */
  EXP_TIE_TOLERANCE: 0.03,

  /* ---- expected strokes (§3.5) ---- */
  /* E(d, lie) = baseline − Brett's approach SG for the bucket. Brett's putting deficit is a
     separate line in his profile (sg putting per 18); adding its per-hole share keeps off-green
     states priced with the same putter that prices on-green states (Eputt is personal). */
  PUTT_DEFICIT_IN_E: true,
  /* Flat correction added to the baseline table (see baseline.js: the table is PGA TOUR, Shot
     Pattern's SG is measured against scratch). 0 until Brett wants the absolute Avg nearer scratch. */
  BASELINE_SCRATCH_OFFSET: 0,
  WATER_DROP_STEP_YDS: 2,       // walk back along the line of flight to find the entry point

  /* ---- learning (§5, used from S5) ---- */
  TAKEOVER_N: 30,
  SHRINK_K: 5,
  RECENCY_TIERS: [[3, 1.0], [8, 0.5], [20, 0.2]],  // [roundsAgo ≤ n, weight]; beyond → 0
  RECENCY_MAX_MONTHS: 12,
  ON_TARGET: { distPct: 0.05, latDeg: 1.5 },
  WET_RAIN_MM_24H: 5,
});

/** Deep-merge `overrides` over the defaults. Arrays and primitives replace; objects merge. */
export function mergeConfig(overrides, base = DEFAULT_CONFIG) {
  if (!overrides || typeof overrides !== "object") return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    const b = base[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)
      ? mergeConfig(v, b)
      : v;
  }
  return out;
}

/** Club families (§5.5). Hybrids and the 2-iron are `long`. */
export const CLUB_FAMILY = Object.freeze({
  Dr: "long", "2Hy": "long", "4Hy": "long", "2i": "long",
  "5i": "mid", "6i": "mid", "7i": "mid",
  "8i": "short", "9i": "short", PW: "short",
  GW: "wedge", SW: "wedge", LW: "wedge",
});
