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
  /* Wind (docs/CADDIE-BRAIN-INTEGRATION.md item 3; research §3.2). Asymmetric and loft-scaled:
       head loss  = (headPctPerMph + headCurve·mph)·mph·loftMult[family], capped at 50%
       tail gain  = (tailPctPerMph + tailCurve·mph)·mph·loftMult[family], capped at 20%
       cross drift = crossPctPerMph·mph·shotYds, long family × crossLongMult
     → head −10.5% at 10 mph / −22% at 20; tail +6.5% at 10 / +12% at 20 (GolfWRX/TrackMan % rule,
     Golf Digest 2019: headwind hurts ~2× a tailwind at 20 mph, tail returns diminish).
     Loft: 7-iron/PW lose 30–48% into 30 mph vs ~20% for driver/4-iron (Golf Digest 2019).
     Cross: TrackMan amateur 6-iron, 153 yds carry, 20 mph → 27 yds ≈ 0.9%/mph (Bonfanti). The
     driver/long-club cross figure is unpublished; ×0.8 is an engine assumption. Unknown family → 1. */
  WIND: {
    headPctPerMph: 0.010,
    headCurve: 0.00005,
    tailPctPerMph: 0.007,
    tailCurve: -0.00005,
    loftMult: { long: 0.75, mid: 1.0, short: 1.2, wedge: 1.35 },
    crossPctPerMph: 0.009,
    crossLongMult: 0.8,
    headCap: 0.5,
    tailCap: 0.2,
  },
  /* Temperature (D36; tuned by integration item 4): rawYds × TEMP_PCT_PER_10F × (TEMP_REF_F − tempF) / 10.
     Cold plays longer (positive), hot plays shorter (negative); 0 at the reference temperature.
     0.85%/10°F = midpoint of Rice (driver +2 yds/10°F on 250 = 0.8%; PW ~1.3/140 = 0.93%). */
  TEMP_REF_F: 70,
  TEMP_PCT_PER_10F: 0.0085,
  /* Altitude (integration item 5): +1.16% carry per 1,000 ft (Titleist; Rice's +2.5 yds/1,000 ft on
     a driver agrees). Reference = Brett's home courses (~1,000 ft, north Georgia), where his
     Shot Pattern numbers were gathered: higher than that plays shorter, lower plays longer.
     No humidity term (< 1 yd, research §3.3). */
  ALT_PCT_PER_1000FT: 0.0116,
  REF_ELEV_FT: 1000,

  /* Roll model: carry = total − roll (§3.3). Shot Pattern medians are TOTALS.
     Per-club yards of roll-out from the tee & fairway, in Brett's words (Sep 29): "my pitching
     wedge often has negligible roll-out, my 8 might roll out 6 yards, 5-iron 10 yards". Clubs not
     listed fall back to their family. Out of the rough those roughly triple (less spin):
     ROLL_LIE_MULT. Ground conditions scale roll, never carry: ROLL_COND_MULT. */
  ROLL_YDS: {
    club: { "2Hy": 12, "4Hy": 12, "5i": 10, "6i": 9, "7i": 8, "8i": 6, "9i": 4, PW: 1, GW: 1, SW: 0, LW: 0 },
    full:    { long: 12, mid: 9, short: 4, wedge: 1 },   // family fallback
    finesse: { long: 3,  mid: 3, short: 1, wedge: 0 },
    tee: 0,                                            // driver / tee shots use total directly
  },
  ROLL_LIE_MULT: { tee: 1, fairway: 1, rough: 3, sand: 1, recovery: 3 },
  /* Roll by ground conditions, by club family (integration item 6; research §3.1, §3.4). Replaces
     "wet → roll 0 everywhere". Wet ground kills a long club's release (tour driver −4.5 yds medium
     / −9.8 soft vs firm, USGA/R&A 2023) but a wet wedge loses 15–20% spin and releases MORE (Rice,
     TrackMan): wedge 1.4. Firm adds release. Carry is untouched. Magnitudes beyond the driver
     figure are engine assumptions — uncalibrated. */
  ROLL_COND_MULT: {
    wet:    { long: 0.35, mid: 0.5, short: 0.6, wedge: 1.4 },
    firm:   { long: 1.4,  mid: 1.3, short: 1.2, wedge: 1.1 },
    normal: { long: 1,    mid: 1,   short: 1,   wedge: 1 },
  },

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
     Fraction of carry lost (negative = short) and σ multiplier, by lie type. Provisional.
     A value may be a number or a per-family object { wedge, short, mid, long } (resolveEntry
     reads either through lieDistAdj below). */
  LIE_DIST_ADJ: { tee: 0, fairway: 0, rough: -0.08, sand: -0.12, recovery: -0.30 },
  /* Rough carry by family (integration item 7; research §5.1, Rice): 8-iron and shorter fly a
     touch LONGER from rough (flyer, less spin), 6-iron and longer come up short. Direction is
     published, magnitude is not — small, uncalibrated values. Supersedes D12's flat −8% for the
     wedge/short/mid families; long keeps −8%. Kept beside LIE_DIST_ADJ (not inside it) because
     learning.js D30 reads LIE_DIST_ADJ[lie] as a plain number; LIE_DIST_ADJ.rough stays the
     flat fallback for a club with no family. */
  LIE_DIST_ADJ_FAMILY: { rough: { wedge: 0.02, short: 0.02, mid: -0.04, long: -0.08 } },
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
  /* Handicap prior (integration item 2; research §1.4, §1.7). Where Brett has NO strokes-gained
     bucket for (d, lie), E() adds HCP_BLEND × the gap between Broadie's 90-golfer and tour tee
     lines, J = a + b·d: gap(d) = (2.79 − 2.38) + (0.0066 − 0.0041)·d = 0.41 + 0.0025·d.
     0.42 = "an ~8 handicap sits 40–45% of the way from tour to 90-golfer" — an engine
     assumption, not published. Buckets with personal SG are unchanged. */
  HCP_BLEND: 0.42,
  HCP_LINE: { tour: [2.38, 0.0041], ninety: [2.79, 0.0066] },
  /* Flat correction added to the baseline table on top of the prior (see baseline.js: the table
     is PGA TOUR, Shot Pattern's SG is measured against scratch). 0 until Brett wants it. */
  BASELINE_SCRATCH_OFFSET: 0,
  WATER_DROP_STEP_YDS: 2,       // walk back along the line of flight to find the entry point

  /* ---- learning (§5, used from S5) ---- */
  TAKEOVER_N: 30,
  SHRINK_K: 5,
  RECENCY_TIERS: [[3, 1.0], [8, 0.5], [20, 0.2]],  // [roundsAgo ≤ n, weight]; beyond → 0
  RECENCY_MAX_MONTHS: 12,
  ON_TARGET: { distPct: 0.05, latDeg: 1.5 },

  /* ---- conditions detection v2 (integration item 11; research §4.2) ----
     ALL THRESHOLDS UNCALIBRATED engine defaults. The Conditions chip always wins.
       wet (rain):  Σ precipitation last 12 h ≥ rainMm12h OR last 24 h ≥ rainMm24h
       wet (dew):   overnight (air − dew point) ≤ dewSpreadF AND cloud ≤ dewCloudPct AND wind ≤
                    dewWindMph AND local time < sunrise + dewHoursAfterSunrise h
       wet (irrigation, "morning moist"): month ∈ irrigationMonths AND local hour < irrigationBeforeHour
                    (Southeast courses water overnight in summer, rain or not)
       firm:        the last firmDryDays days each < firmDayMm AND the last 24 h < firmDayMm AND the
                    hottest of those days' max temperature ≥ firmTmaxF
       else normal. Replaces WET_RAIN_MM_24H (5 mm / 24 h). */
  CONDITIONS: {
    dewSpreadF: 3,              // uncalibrated
    dewCloudPct: 40,            // uncalibrated
    dewWindMph: 5,              // uncalibrated
    dewHoursAfterSunrise: 3,    // uncalibrated (MDPI 2022: dew gone 3–5 h after sunrise)
    rainMm12h: 5,               // uncalibrated
    rainMm24h: 10,              // uncalibrated
    firmDryDays: 3,             // uncalibrated
    firmDayMm: 2.5,             // uncalibrated
    firmTmaxF: 85,              // uncalibrated
    irrigationMonths: [6, 7, 8, 9],   // uncalibrated
    irrigationBeforeHour: 10,         // uncalibrated
  },
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

/**
 * Fraction of carry gained (+) or lost (−) on `lie` for a club of `family`: the per-family table
 * first, then LIE_DIST_ADJ[lie] as a number or a per-family object. 0 when unknown.
 */
export function lieDistAdj(cfg, lie, family) {
  const fam = cfg?.LIE_DIST_ADJ_FAMILY?.[lie];
  if (fam && typeof fam === "object" && Number.isFinite(fam[family])) return fam[family];
  const v = cfg?.LIE_DIST_ADJ?.[lie];
  if (v && typeof v === "object") return Number.isFinite(v[family]) ? v[family] : 0;
  return Number.isFinite(v) ? v : 0;
}

/** Club families (§5.5). Hybrids and the 2-iron are `long`. */
export const CLUB_FAMILY = Object.freeze({
  Dr: "long", "2Hy": "long", "4Hy": "long", "2i": "long",
  "5i": "mid", "6i": "mid", "7i": "mid",
  "8i": "short", "9i": "short", PW: "short",
  GW: "wedge", SW: "wedge", LW: "wedge",
});
