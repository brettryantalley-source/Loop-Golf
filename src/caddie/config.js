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
  /* v22.45 (C34, D116; Brett, Oct 11: "Two-thirds"): the share of the FORECAST wind the engine uses.
     Open-Meteo's wind_speed_10m is open-field wind 10 m up (on Oct 11 it matched Cherokee County
     airport's 10–15 kt); Bradshaw's holes, like most of his, run through trees. A middle guess:
     trees cut it near the ground, a high shot climbs back into it. Uncalibrated. Brett's Wind chip
     is his own reading and is never scaled. */
  FORECAST_WIND_SHARE: 0.67,
  /* Temperature (D36; tuned by integration item 4): rawYds × TEMP_PCT_PER_10F × (TEMP_REF_F − tempF) / 10.
     Cold plays longer (positive), hot plays shorter (negative); 0 at the reference temperature.
     0.85%/10°F = midpoint of Rice (driver +2 yds/10°F on 250 = 0.8%; PW ~1.3/140 = 0.93%). */
  TEMP_REF_F: 70,
  TEMP_PCT_PER_10F: 0.0085,
  /* D79: the mean air temperature Brett's profile distances were hit in. The temperature term is
     rawYds × TEMP_PCT_PER_10F × (PROFILE_TEMP_F − tempF) / 10 — 0 at the profile's own temperature,
     not at the textbook 70°F (TEMP_REF_F, kept as the fallback when this is unset). 85 = Open-Meteo
     archive temperature_2m, 2–4 pm local, averaged over his 13 rounds Jun 17 – Sep 28 2026 at each
     course (84.8°F; the Shot Pattern report's own window Jun 27 – Sep 20 reads 86.4°F). */
  PROFILE_TEMP_F: 85,
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
  /* v22.23 (C23, D94): a ball that lands on the green rolls this share of its roll-out too. Brett's
     roll figures are roll-outs wherever the ball lands, and Shot Pattern's medians (totals) are where
     his approaches finish, so 1 makes an approach's average finish its median. Uncalibrated. */
  GREEN_ROLL_SHARE: 1,
  /* C8 (v22.36, D107): the short tail. Shot Pattern's shortPct is the share of a club's shots that
     finish more than `overPct` short of where Brett meant to finish (Q1, Oct 10: the target is where
     he wants the ball to end up); the simulation's ellipse gives fewer for most clubs. The gap,
     shrunk by the club's n with SHRINK_K, is drawn as extra shots that finish `depthMin`–`depthMax`
     of the distance short. Depths uncalibrated (C8: "10–20% of carry"); `on: false` → none. */
  SHORT_TAIL: { on: true, overPct: 0.10, depthMin: 0.10, depthMax: 0.20 },
  /* C24 (v22.37, D108): Brett's usual shape per club and how far it curves, yards (Oct 10: "the two
     and four hybrid are about a 10 yard fade. The 5-8 iron is about a 7 yard draw. Nine and pitching
     wedge a 5 yard draw. Gap wedge 3 yard draw. Sand wedge and lob wedge straight"; the driver a
     15-yd fade, never a draw). Shot Pattern measures the finish against his target, which already
     allows for the curve, so the start line sits the curve's width to the other side of the finish.
     A shape he picks that isn't his usual one curves `yds` the other way; a straight club (or one not
     listed, the 2-iron) curves CURVE_DEFAULT_YDS when he picks one. */
  SHOT_SHAPE: {
    Dr: { usual: "fade", yds: 15 }, "2Hy": { usual: "fade", yds: 10 }, "4Hy": { usual: "fade", yds: 10 },
    "5i": { usual: "draw", yds: 7 }, "6i": { usual: "draw", yds: 7 }, "7i": { usual: "draw", yds: 7 }, "8i": { usual: "draw", yds: 7 },
    "9i": { usual: "draw", yds: 5 }, PW: { usual: "draw", yds: 5 }, GW: { usual: "draw", yds: 3 },
    SW: { usual: "straight", yds: 0 }, LW: { usual: "straight", yds: 0 },
  },
  CURVE_DEFAULT_YDS: 5,
  /* C4 (v22.39, D110; docs/SPEC-C4-headsup.md, OK'd Oct 10). Heads-up, one clause for SAFE's club:
     today — the same miss on `todayHit` of its last `todayOf` shots (or 2 of 2); history — at least
     `histMinN` measured shots and `histShare` of them finish `overPct` or more short (or long).
     Aim warning, on his own target or Line: trouble `troubleGap` more often than SAFE, or his club's
     average miss (at least `minN` Loop-measured shots) carries the ring's centre off the green. */
  HEADS_UP: { todayOf: 4, todayHit: 3, histMinN: 10, histShare: 0.3, overPct: 0.10 },
  /* C32 (v22.41, D112; Brett Oct 10: "i don't want the targets or suggested start lines to shift,
     but i do want the caddie to mention it to me"). The within-round nudges (§5.5) still read the
     round and the why line names the pattern; with false they no longer move the club, the target
     or the start line. Replaying the nine imported rounds, the trigger fired 381 times and the next
     shot went the same way about half the time, no better than any shot. */
  NUDGES_MOVE_CALL: false,
  AIM_WARN: { troubleGap: 0.10, minN: 10 },
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
  /* C36 (v22.46, D117; Brett Oct 11: "my worst 20% of shots should be completely ignored by the caddy").
     Each candidate's draws are simulated in full (good ring, mishits, short tail, big misses), then
     this share — the draws that finish farthest from where the shot finishes on average (the median
     draw, which is the target on almost every call, D115) — is dropped before anything is priced.
     Club, target, par chance, trouble and the aim warning read the rest (the map's dots are his real
     shots since C45, D127). 0 = price them all. */
  DROP_WORST_PCT: 0.20,
  /* The inner ring (C17, D92): the share of the shots it held — √(−2 ln 0.7) / √(−2 ln 0.2) ≈ 0.471 of the
     80% ring, computed in overlay.js. C45 (v22.56, D127): no longer drawn; the map draws Shot Pattern's
     70% ring and its 100% ring (overlay.js patternRingFromEntry), which have no tunables — they are
     read off his screenshots (scripts/read-pattern.py). */
  RING_INNER_PCT: 0.30,
  /* A club with no fitted ring is drawn from its σs; its width is capped here so the ring stays
     readable. DISPLAY ONLY — the simulation still uses the uncapped σs. */
  RING_DRAW_CAP_YDS: 70,
  /* v22.29 (C21, D100): this many dots round the ring, fixed by the seed so they hold still until the
     shot moves. C45 (v22.56, D127; Brett Oct 11): his real Shot Pattern shots first, then draws from the
     70% ring up to this many (overlay.js patternDots); engine.js landingDots still gives the caddie's own. */
  RING_DOTS: 40,
  /* C45 (v22.56, D127; Brett Oct 11: "nor do I want the dispersion circles for [SW] or [LW] because I
     don't hit them full"): these clubs draw no rings, no dots and no corridor on the map — the target,
     the start line and the leave line stay. The engine prices them as before. */
  RING_HIDE_CLUBS: ["SW", "LW"],
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
  CORRIDOR_STEP_YDS: 5,         // targets across the fairway at the club's distance
  /* v22.22 (C3, D93): every target is where the ball finishes on average. The aim point sits off it
     by −(the good-shot ring's lateral offset + the crosswind drift) once that drift reaches this many
     yards; under it the shot is aimed straight at the target. */
  PATTERN_AIM_MIN_YDS: 2,
  /* v22.17.4 (D90): lay-ups and the corridor's "center" move from the hole line to the middle of
     the hole's own fairway, by at most this much. Uncalibrated. */
  FAIRWAY_SNAP_YDS: 40,
  LAYUP_MIN_YDS: 50,
  LAYUP_MAX_YDS: 150,
  LAYUP_STEP_YDS: 5,
  /* v22.44 (C35, D115): a lay-up spot takes only a club that finishes within this many yards short
     of it (it already had to stop within LAYUP_STEP_YDS past it). Before, the longest club stood in
     for any spot beyond its reach. */
  LAYUP_FIT_YDS: 10,
  /* v22.24 (C31, D95): on shot 1, a ball this close to one of the hole's tee boxes is a tee lie even
     when it was placed with "I'm at my ball" (a fix a few yards off the mapped box read rough, and
     rough takes the full driver and 2-iron away, D86). The Lie chip still wins. */
  TEE_SNAP_YDS: 15,
  REACH_SHORT_TOLERANCE_YDS: 8, // a club "reaches" if its finish (carry + green roll, D94) ≥ front − this
  FLY_TOLERANCE_YDS: 20,        // prune clubs that finish past the back edge by more than this (§3.4)

  /* ---- selection (§3.6) ---- */
  /* Same shot (v22.17, engine.js pickOptions): the same club + swing within SAME_SHOT_TARGET_YDS, or
     a birdie gain under SAME_SHOT_BIRDIE_GAIN with the targets within 2 × SAME_SHOT_TARGET_YDS.
     Was 0.01 on its own (any target), which hid real alternatives off the tee. */
  SAME_SHOT_BIRDIE_GAIN: 0.005,
  SAME_SHOT_TARGET_YDS: 10,
  /* SAFE ranking (D78): "par" = the most likely to make par or better among the shots the course-
     management rules allow, ties (PAR_TIE_TOLERANCE) to the lower expected score; "exp" = the
     lowest expected score, as before v22.17. */
  SAFE_RANKING: "par",
  PAR_TIE_TOLERANCE: 0.01,
  /* Strokes-to-hole-out distribution off the green (D78, engine.js holeOutCdf): a rounded split
     normal with mean E(d, lie); σ = [base, per stroke above 1] on each side. Uncalibrated, except
     that a par-4 tee at 4.62 gives par-or-better ≈ 49% / double+ ≈ 13% (Brett's report: 52.8 / 13.3). */
  SCORE_DIST: { sdLeft: [0.30, 0.03], sdRight: [0.60, 0.12] },
  SAME_AVG_DELTA: 0.05,         // |Δavg| under this displays as "≈ same avg."
  /* Two candidates whose expScore differ by less than this are a tie (500 samples put the standard
     error near 0.02, and model error is larger). Ties go to the club that plays the number: the
     one whose mean landing is nearest its target. */
  EXP_TIE_TOLERANCE: 0.03,

  /* Clubs whose FULL swing is only ever hit off a tee (D86, Brett Oct 4): driver never off the
     fairway; 2-iron "yes, but rarely full" — the 2-hybrid is his club from the fairway. From any other
     lie these clubs' full swing is not a candidate; a finesse entry still is (2i's is pending carries).
     Off the tee every club is a candidate. */
  TEE_ONLY_FULL: ["Dr", "2i"],

  /* ---- course management (strategy.js; docs/CADDIE-BRAIN-INTEGRATION.md part 2; D76) ----
     Michael Leonard, "How to Play Wicked Smart Golf" (tips 3–6). The guide's rules choose SAFE from
     the priced candidates; Brett's numbers overrule the pin rule only when its pick finds more than
     maxExtraTrouble more trouble, or costs more than maxCostStrokes, than the best-priced shot. Each
     rule switches off on its own (false → that part of SAFE is the plain lowest expected score).
     The guide gives rules, not numbers: every threshold below is an engine assumption, uncalibrated,
     except noHeroMaxTrouble, which is the guide's own "9 out of 10". */
  STRATEGY: {
    driverDefault: true,          // tip 3: a tie on a par-4/5 tee goes to the driver
    pinRule: true,                // tips 4–5: front / back pin → middle of the green; middle pin → at it
    attackClubs: ["PW", "GW", "SW", "LW"],   // tip 5: "especially with wedges" — the only clubs that aim at a middle flag
    clubUpShortWeight: 2,         // tip 4: finishing short of the depth target counts double (club up)
    maxExtraTrouble: 0.05,        // the pin rule yields when its pick finds > 5 points more trouble …
    maxCostStrokes: 0.5,          // … or costs > ½ stroke more than the best-priced shot
    noHero: true,                 // tip 6: from trees, a bad / buried rough lie or a fairway bunker, no hero shots
    noHeroMaxTrouble: 0.10,       // "9 out of 10"; nothing that clean → the least trouble (punch out)
    fairwayBunkerMinYds: 40,      // C9 (D105): sand this far from the front of the green is a fairway bunker → no hero
  },

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

  /* ---- shot log v2 (v22.15, docs/SPEC-shotlog-v2.md §3, §7) ----
     A closed shot's result is read off GPS against the intended target: |miss| < slightYds → 0,
     slightYds … bigYds → ±1, > bigYds → ±2, on both axes (curveAuto from the lateral miss,
     distClass from the distance miss). Either fix worse than LOW_ACC_M metres marks the result
     `derivedLowAcc` (still computed, flagged with the ? on the card). */
  MISS_BANDS: { slightYds: 8, bigYds: 20 },
  LOW_ACC_M: 12,
  /* Line played (v22.17, shotlog.js linePlayedFor): "custom" when the club differs from both
     options' clubs, or the aim is farther than max(minYds, pct × ball→target) from both targets;
     otherwise the nearer of SAFE / AGGRESSIVE. Replaces D61's flat 5 yds. */
  CUSTOM_LINE: { minYds: 15, pct: 0.10 },
  /* Breadcrumb trail (SPEC-shotlog-v2 §10, trail.js): points thinned to ≥ thinM apart or ≥ thinSec
     apart, at most maxPoints per hole; a stop = points within radiusM for ≥ minSec; a stop within
     matchYds of a recorded shot's start is that shot. */
  TRAIL_STOP: { radiusM: 6, minSec: 15, thinM: 3, thinSec: 10, maxPoints: 600, matchYds: 8 },
  /* Test mode (spec §1): `Fake my location` turns every GPS fix into a tap on the caddie map.
     Never on by default; toggled from the Setup build tag and kept in bogeyman-matches:config:v1. */
  testMode: { fakeGps: false },

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

/** C24 (D108): Brett's usual shape for a club ("straight" when not listed). */
export function usualShape(club, cfg = DEFAULT_CONFIG) {
  const s = (cfg?.SHOT_SHAPE || DEFAULT_CONFIG.SHOT_SHAPE)?.[club]?.usual;
  return s === "draw" || s === "fade" || s === "straight" ? s : "straight";
}

/**
 * C24 (D108): how far a shot of this shape curves in the air, yards, + = to the right (a fade for a
 * right-hander), − = to the left (a draw); 0 straight. The start line sits this far the other way.
 */
export function curveYds(club, shape, cfg = DEFAULT_CONFIG) {
  if (shape !== "draw" && shape !== "fade") return 0;
  const yds = (cfg?.SHOT_SHAPE || DEFAULT_CONFIG.SHOT_SHAPE)?.[club]?.yds;
  const amt = Number.isFinite(yds) && yds > 0 ? yds : (cfg?.CURVE_DEFAULT_YDS ?? DEFAULT_CONFIG.CURVE_DEFAULT_YDS);
  return shape === "fade" ? amt : -amt;
}

/** Club families (§5.5). Hybrids and the 2-iron are `long`. */
export const CLUB_FAMILY = Object.freeze({
  Dr: "long", "2Hy": "long", "4Hy": "long", "2i": "long",
  "5i": "mid", "6i": "mid", "7i": "mid",
  "8i": "short", "9i": "short", PW: "short",
  GW: "wedge", SW: "wedge", LW: "wedge",
});
