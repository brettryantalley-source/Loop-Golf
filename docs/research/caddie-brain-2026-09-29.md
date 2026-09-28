# Loop "Caddie Brain" Knowledge Base: Evidence-Graded Course Management for a ~8 Handicap in Georgia

The strokes-gained baseline the engine needs is public for the PGA Tour but not for scratch golfers. Use Broadie's PGA Tour table (Interfaces 2012, Table 9) as the base layer and treat any per-handicap offset as a calibration the app learns, because no published scratch table exists. The largest condition effects for Brett's summer Georgia rounds are, in order: wind (asymmetric, 10–25% of carry), fairway firmness (roll only, up to ~10 yards on driver), summer heat (driver carry change "caps out at about two yards per 10 degrees" in Andrew Rice's TrackMan study), and the spin lost on wet wedges (~15–20%). Humidity, "greens speed up as dew burns off," and "always club up from wet rough" are either tiny effects or wrong.

## TL;DR
- **Baseline:** Use Broadie's PGA Tour expected-strokes table (Interfaces 42(2):146–165, 2012; DOI 10.1287/inte.1120.0626, reproduced below). There is no published scratch table. Broadie's own guidance is that amateur levels interpolate smoothly between tour and 90-golfer curves (tee: 2.38 + 0.0041d tour vs 2.79 + 0.0066d for 90-golfers). Build handicap offsets from Brett's own shots, not from secondary blog tables.
- **Strategy:** The data support driver as the default club (Arccos: 3-wood hits 46.4% of fairways vs 45.5% for driver and finishes within 30 yd of centerline only 3.1 points more often, 81.2% vs 78%, while giving up 12 yards, 214 vs 226 median). They support center-of-green targets from 100+ yards (Broadie), shorter lay-ups over "favorite numbers" (Broadie), and aiming so that penalty areas sit outside ~2σ of Brett's dispersion. Driver loses only where out-of-bounds or water sits on Brett's 15% right-miss side and a shorter club cuts that miss rate by more than ~5–8 points.
- **Conditions:** Model carry and roll separately. Temperature, air density and wind change carry. Dew, rain and firmness change roll and spin. Wet-face spin loss is real on wedges (Rice: 6,603 → 5,291–5,463 rpm) and negligible on 7-iron and driver (Practical Golf). Dew dries 3–5 hours after sunrise (MDPI *Water* 2022, four shrubs in Changchun, China: "completely depleted approximately 4 h after sunrise"), and greens get slightly slower, not faster, through the day (USGA).

---

## A. One-Page Summary: The 10 Adjustments That Matter Most for Brett

| # | Adjustment | Size | Applies to | Carry or roll | Confidence |
|---|---|---|---|---|---|
| 1 | Headwind hurts more than tailwind helps | Tour 7-iron (166 carry): 10 mph head −17 yd, tail +13 yd; 30 mph head −64, tail +25. Headwind loss "can be almost 50 percent more than the tailwind's potential positive effect" (Golf Digest/Foresight GCQ 2019). Everyday-golfer rule for 80–95 mph driver speed: head +1 yd per mph, tail −0.5 yd per mph (Andrew Rice with Mark Broadie, Golf Digest) | All full shots; high-lofted clubs lose the most % | Carry | Strong (simulation on TrackMan launch data) |
| 2 | Summer heat | Driver carry change "caps out at about two yards per 10 degrees"; pitching wedge ~1.3 yd per 10°F (Andrew Rice TrackMan study at 155-mph ball speed, 2018 Coach Camp, Golf.com). Alternative: 1.33–1.66 yd per 10°F by club (TrackMan via Golf News Net 2025)\[1\] | All clubs | Carry | Strong (measured), sources differ by ~0.5 yd |
| 3 | Soft/wet fairways shorten drives | vs firm: medium −4.5 yd, soft −9.8 yd tee-shot distance (USGA/R&A 2023, ShotLink);\[2\] rain days ~4 yd shorter (USGA/R&A Distance Insights 2020) | Driver, fairway woods off tee | Roll | Strong (tour data; amateur landing angles differ) |\[3\]
| 4 | Wet ball/face on wedges | Spin 6,603 rpm dry → 5,463 (wet club) / 5,291 (wet ball), 50-yd wedge (Andrew Rice, TrackMan);\[4\] ~20% spin drop at 50 yd (Practical Golf, SkyTrak)\[5\] | Wedges/finesse shots ≤~100 yd | Carry up slightly, more release | Moderate-strong (small-n tests) |
| 5 | Flyer direction depends on club | 8-iron and shorter: higher launch, lower spin, flies longer. 6-iron and longer: spin drops with little launch change, can fall short (Andrew Rice, Golf.com)\[6\] | Rough/wet lies | Carry + roll | Moderate (expert, TrackMan-informed) |
| 6 | Driver is the default off the tee | Arccos: driver median 226 vs 3W 214 yd. Fairways 45.5% vs 46.4%. Within 30 yd of centerline 78.0% vs 81.2%; within 40 yd 89.3% vs 91.6% | Par 4/5 tee shots | Total | Strong (large-sample tracking) |
| 7 | Aim at the middle of the green from 100+ yd | Broadie (2014): "for most amateurs from 100 yards and out, aiming at the middle of the green makes sense."\[7\] DECADE target: 70% of approaches on the fat side (golf.com)\[8\] | Approaches ≥100 yd | Target/line | Moderate-strong |
| 8 | Lay up shorter, not to a "favorite number" | Tour fairway expected strokes rise monotonically 10→100 yd (2.18→2.80, Broadie 2012).\[9\] Broadie: most golfers score worse from 80 yd than 30 yd even if every 30-yd lay-up lands in rough\[10\] | Par-5 lay-ups, forced lay-ups | Target distance | Strong at tour level; direction holds for amateurs per Broadie |
| 9 | Rough costs a mid-handicap little at long range | 10-handicap: 160 yd fairway = 140 yd rough in scoring average (Stagner/Arccos via Golf Digest).\[11\] Tour rough penalty 0.20–0.23 strokes at 50–150 yd (Broadie 2012) | Tee-shot club choice | — | Strong (large-sample) |\[9\]
| 10 | Greens slow slightly through the day; dew dries 3–5 h after sunrise | Ball roll −9.5 in morning→afternoon over 8 days at the 2013 U.S. Junior Amateur, Martis Camp (Brian Whitlark, USGA "Championship Green Speed" 2013); −6 in average (Oregon State study cited by USGA agronomist Whitlark).\[12\] Dew "completely depleted approximately 4 h after sunrise" on shrubs in Changchun, China (MDPI *Water* 14:2428, 2022) | Putts, chips | Roll | Moderate (greens), moderate (dew timing, non-turf ecosystem) |

---

## B. Sections 1–5

### 1. Strokes-Gained Baseline

#### 1.1 Primary source and citation
- **Citation:** Broadie, M. (2012). "Assessing Golfer Performance on the PGA TOUR." *Interfaces* 42(2):146–165. DOI 10.1287/inte.1120.0626.\[13\] Table values come from Appendix A, Table 9 of the author's preprint (April 8, 2011), estimated from over 8 million ShotLink shots, 2003–2010.\[9\] Grade: **strong**.
- **Method:** piecewise-polynomial fits. The putting curve is a physical one-putt model combined with a logistic three-putt model. Recovery shots are identified automatically: the shot travels <40% of the distance to the hole or deviates >15° from the ball-hole line, and it starts ≥30 yd from the hole (Broadie 2012).\[9\]

#### 1.2 PGA Tour expected strokes to hole out, off the green (yards)

| Distance (yd) | Tee | Fairway | Rough | Sand | Recovery |
|---|---|---|---|---|---|
| 10 | — | 2.18 | 2.34 | 2.43 | 3.45 |
| 20 | — | 2.40 | 2.59 | 2.53 | 3.51 |
| 30 | — | 2.52 | 2.70 | 2.66 | 3.57 |
| 40 | — | 2.60 | 2.78 | 2.82 | 3.71 |
| 50 | — | 2.66 | 2.87 | 2.92 | 3.79 |
| 60 | — | 2.70 | 2.91 | 3.15 | 3.83 |
| 70 | — | 2.72 | 2.93 | 3.21 | 3.84 |
| 80 | — | 2.75 | 2.96 | 3.24 | 3.84 |
| 90 | — | 2.77 | 2.99 | 3.24 | 3.82 |
| 100 | 2.92 | 2.80 | 3.02 | 3.23 | 3.80 |
| 120 | 2.99 | 2.85 | 3.08 | 3.21 | 3.78 |
| 140 | 2.97 | 2.91 | 3.15 | 3.22 | 3.80 |
| 160 | 2.99 | 2.98 | 3.23 | 3.28 | 3.81 |
| 180 | 3.05 | 3.08 | 3.31 | 3.40 | 3.82 |
| 200 | 3.12 | 3.19 | 3.42 | 3.55 | 3.87 |
| 220 | 3.17 | 3.32 | 3.53 | 3.70 | 3.92 |
| 240 | 3.25 | 3.45 | 3.64 | 3.84 | 3.97 |
| 260 | 3.45 | 3.58 | 3.74 | 3.93 | 4.03 |
| 280 | 3.65 | 3.69 | 3.83 | 4.00 | 4.10 |
| 300 | 3.71 | 3.78 | 3.90 | 4.04 | 4.20 |
| 320 | 3.79 | 3.84 | 3.95 | 4.12 | 4.31 |
| 340 | 3.86 | 3.88 | 4.02 | 4.26 | 4.44 |
| 360 | 3.92 | 3.95 | 4.11 | 4.41 | 4.56 |
| 380 | 3.96 | 4.03 | 4.21 | 4.55 | 4.66 |
| 400 | 3.99 | 4.11 | 4.30 | 4.69 | 4.75 |
| 420 | 4.02 | 4.19 | 4.40 | 4.83 | 4.84 |
| 440 | 4.08 | 4.27 | 4.49 | 4.97 | 4.94 |
| 460 | 4.17 | 4.34 | 4.58 | 5.11 | 5.03 |
| 480 | 4.28 | 4.42 | 4.68 | 5.25 | 5.13 |
| 500 | 4.41 | 4.50 | 4.77 | 5.40 | 5.22 |
| 520 | 4.54 | 4.58 | 4.87 | 5.54 | 5.32 |
| 540 | 4.65 | 4.66 | 4.96 | 5.68 | 5.41 |
| 560 | 4.74 | 4.74 | 5.06 | 5.82 | 5.51 |
| 580 | 4.79 | 4.82 | 5.15 | 5.96 | 5.60 |
| 600 | 4.82 | 4.89 | 5.25 | 6.10 | 5.70 |

Source: Broadie (2012), Table 9. Tee distance is measured along the dogleg, not as the crow flies.\[9\] Values between rows should be linearly interpolated.

**Known quirks the engine must handle:**
- Tee 120 (2.99) > tee 140 (2.97), and sand is non-monotonic between 90 and 140 yd. Broadie attributes both to thin data and hole design and chose not to smooth them (Broadie, everyshotcounts.com reply, April 2014).\[7\] Recommendation: apply isotonic smoothing to the sand and tee columns before using them in optimization, or the engine will "prefer" 140 over 120.
- Sand beats rough only from 15 to 34 yd (Broadie 2012).\[9\]

#### 1.3 Book vs paper discrepancy (show both; do not average)

| Distance | Paper 2012: Fwy / Rough / Sand | Every Shot Counts 2014 (as reproduced by The DIY Golfer): Fwy / Rough / Sand |
|---|---|---|
| 10 yd | 2.18 / 2.34 / 2.43 | 2.17 / 2.34 / 2.47 |
| 20 yd | 2.40 / 2.59 / 2.53 | 2.37 / 2.57 / 2.53 |
| 30 yd | 2.52 / 2.70 / 2.66 | 2.50 / 2.69 / 2.65 |\[14\]

Grade: paper **strong**; book values via a secondary site **moderate**. Recommendation: use the paper, because it is primary and fully published.

#### 1.4 Tee-shot linear models

| Population | Formula (d = hole yards) | Source | Grade |
|---|---|---|---|
| PGA Tour 2003–10 | J = 2.38 + 0.0041d (R² > 98%) | Broadie 2012 | Strong |
| 90-golfer (18-hole avg 90) | J = 2.79 + 0.0066d\[9\] | Broadie 2008 (Golfmetrics, Science and Golf V), cited in Broadie 2012\[9\] | Strong |
| 1964 British pros | J = 2.35 + 0.0044d | Cochran & Stobbs 1968, cited in Broadie 2012 | Moderate (small sample) |\[9\]

#### 1.5 Putting (feet)

The model parameters are published in Broadie 2012. One-putt uses σα = 1.46, σd = 0.057, t = 0.5 yd, h = 0.667 yd. Three-putt is p3 = 1/(1+e^(a0 + a1·d + a2·d²)) + a3, with a0 = −0.106, a1 = 5.49, a2 = 0.000563, a3 = −0.00398.\[9\] Tabulated tour values:

| Putt (ft) | PGA Tour expected putts | Source | Grade |
|---|---|---|---|
| 1 | 1.001\[15\] | PGA Tour 2010-season putting baseline, reproduced on TheSandTrap forum\[15\] | Moderate (secondary) |
| 2 | 1.009 | same | Moderate |
| 3 | 1.053 (a later revision shows 1.046)\[15\] | same | Moderate |
| 4 | 1.147 | same | Moderate |
| 5 | 1.256 (revision: 1.245)\[15\] | same | Moderate |
| 6 | 1.357 | same | Moderate |
| 7 | 1.443 | same | Moderate |
| 8 | 1.515 (50% one-putt point ≈ 7 ft 10 in)\[15\] | same; Broadie 2012 confirms 50% at 8 ft\[16\] | Strong for the 8-ft point |
| 16 | ~1.8 | Broadie 2012 worked example | Strong |\[9\]
| 20 | 1.87 | Every Shot Counts, via WhyGolf | Moderate |\[17\]
| 30 | 1.98 (Pinpoint) vs 2.00 (ScoringZone) | secondary sites disagree | Weak |\[18\]\[19\]
| 33 | 2.00 (tour two-putt average point) | Broadie 2012 | Strong |\[9\]

Amateur putting anchors (Broadie 2012):
- 90-golfers one-putt 50% of the time from 5 ft.\[9\]\[16\]
- They average 2 putts from 19 ft (tour: 33 ft).\[9\]
- They three-putt ~2.3 times per round (tour: 0.55).\[9\]
- The tour three-putt rate exceeds 10% only beyond 40 ft.\[9\]

#### 1.6 Other published anchors the engine can use

| Datapoint | Value | Source | Grade |
|---|---|---|---|
| Tour rough penalty, 120 yd | 2.85 fwy vs 3.08 rough = 0.23 | Broadie 2012 | Strong |
| Tour rough penalty, 50–150 yd avg | 0.20 (2009 and 2010, SE 0.004) | Broadie 2012 | Strong |
| Recovery vs fairway / vs rough, 150–300 yd | +0.6 / +0.4 strokes | Broadie 2012 | Strong |
| Up-and-down at 15 yd | 51% rough or sand, 69% fairway | Broadie 2012 | Strong |
| Up-and-down at 25 yd | 42% sand, 35% rough, 54% fairway | Broadie 2012 | Strong |\[9\]
| OB tee shot | SG = −2 exactly\[7\] | Broadie, everyshotcounts.com reply 2014\[7\] | Strong (definitional) |

#### 1.7 Scratch/handicap adjustment: what exists and what doesn't

| Source | What's published | Numbers | Grade | Use in engine |
|---|---|---|---|---|
| Broadie (Every Shot Counts 2014; site reply May 2014) | No amateur tables in the book (Table 5.2 is tour only). "The average score for an 80-golfer lies pretty much in the middle of the average scores for 70-golfers and 90-golfers at each distance and condition"\[7\] | Tee lines only (1.4) | Strong for the interpolation principle | Interpolate between tour and 90-golfer tee lines; for other lies, learn offsets from Brett's data |
| Pinpoint Golf (undated) | 15-handicap vs tour | 400 tee: 5.32 vs 3.99. 160 fwy: 3.92 vs 2.98. 20 yd bunker: 3.05 vs 2.53. 30 ft: 2.24 vs 1.98. 5 ft: 1.59 vs 1.26 | Weak-moderate (proprietary, undocumented) | Sanity check only |\[18\]
| Lou Stagner / Arccos | Proximity and scoring by index, not a full expected-strokes table | Scratch median proximity from 150 fwy ≈ 37 ft.\[20\] From 100 fwy, >75 ft: scratch 4%, 10-index 11%, 20-index >20%.\[21\] Scratch from 80 yd, middle pin: 30% finish outside 30 ft\[20\] | Strong (very large sample) but partial | Validate Brett's proximity curves |
| Stagner/Arccos fairway–rough equivalences | Distances of equal scoring average | Scratch: 90 yd fwy = 67 yd rough. 10-index: 160 yd fwy = 140 yd rough (Golf Digest)\[11\] | Strong | Rough-penalty calibration |
| Stagner newsletter #2 (2022) | Rough penalty by index | 5-index at 80–89 yd: +0.11 strokes. About half of table cells ≤ 0.10\[22\] | Strong | Rough penalty for Brett ≈ 0.1 at wedge range |
| Golfity "benchmarks based on Broadie" | SG per round vs tour by handicap | Scratch −3.2, 5-hcp −6.2\[23\] | Weak (secondary, no method) | Do not use |\[23\]
| SwingU / course-rating comparison | Tour vs scratch gap | 2.25 strokes | Weak | Do not use |\[24\]

**Recommendation:** Keep Broadie's tour table as the reference J_tour(d, lie). Model Brett as J_Brett(d, lie) = J_tour(d, lie) + Δ(d, lie), with Δ estimated from his Shot Pattern data. Where data are thin, fall back to a prior that interpolates Δ between 0 (tour) and the 90-golfer tee-line gap. Assign ~8 handicap ≈ 40–45% of the way from tour to 90-golfer; this weight is an engine assumption, not published. Do not import the Pinpoint or Golfity tables as truth.

---

### 2. Strategy That Holds Up

#### 2.1 Aiming from dispersion (ellipse targeting)

| Rule | Value | Basis | Grade |
|---|---|---|---|
| Aim point = target minus Brett's mean lateral bias | e.g. mean +5 yd right → aim 5 yd left\[25\] | Standard dispersion practice (Quantified Golf; Shot Pattern)\[26\] | Moderate |
| Hazard clearance | Put penalty-area edge ≥ 2σ lateral from the pattern center → ~2.3% one-sided risk; 1.5σ → 6.7%; 1σ → 15.9% | Normal-distribution math | Strong (math); real patterns have fatter tails |
| Use empirical miss rates, not σ, for the driver | Brett's big-miss rates: 12% left, 15% right | User data | — |
| Penalty-cost comparison | OB = −2 strokes per event (Broadie). Losing 20 yd of approach ≈ 0.10 strokes at tour slope (160→180 fwy: 2.98→3.08), ≈0.16 at 90-golfer slope (0.0066 vs 0.0041 ×) | Derived from Broadie 2012 | Strong inputs, derived output |
| **Driver flip threshold (derived)** | A shorter club is worth it off the tee only if it reduces OB/water probability by more than ~5–8 percentage points (0.10–0.16 ÷ 2) | Derived | Moderate |
| DECADE margin heuristic | "Aim 12 m from trouble (long club), 9 m (mid), 6 m (short)"\[27\] | Pure Golf Substack summary of DECADE | Weak (secondary; replace with Brett's σ) |

Broadie's hazard-type finding: if out-of-bounds is replaced by a lateral hazard, "it is optimal for golfers to take more risk" (Broadie, everyshotcounts.com, 2014).\[7\] The engine should therefore price OB at stroke and distance, and red penalty areas at about 1 stroke plus the lie and distance of the drop. Grade: strong.

#### 2.2 When driver is wrong off the tee

| Evidence | Numbers | Grade |
|---|---|---|
| Broadie worked example, 350-yd par 4 | Driver 250 yd, 50% fairway → 0.5·2.80 + 0.5·3.02 = **2.91**. 3W 230 yd, 65% fairway → 0.65·2.85 + 0.35·3.08 = **2.93**.\[7\] Driver wins by 0.02 even with 15 points less accuracy | Strong (Broadie 2014 reply) |
| Arccos, all golfers | Driver median 226 vs 3W 214 (12 yd). Fairways 45.5% vs 46.4%. Within 30 yd of centerline 78.0% vs 81.2%; within 40 yd 89.3% vs 91.6% | Strong |
| Shot Scope, via Golf Monthly | Driver vs fairway wood: 0-hcp 285 vs 267; 5-hcp 261 vs 245; 20-hcp 225 vs 219. Fairway wood more accurate in 4 of 6 handicap bands, by small margins\[28\] | Strong (large-sample) |
| Shot Scope blog | Driver ~28 yd longer on average; driver and 3-wood fairway accuracy both average 47% | Strong |
| Shot Scope, 80M swings (via LaunchPoint Golf, 2026) | 0.8-point accuracy gap; 225 vs 203 yd\[29\] | Moderate (secondary) |
| Stagner newsletter (via MyGolfSpy forum) | 3W only competitive if its median is within ~12 yd of driver AND its dispersion is 20+ yd narrower\[30\] | Weak (forum paraphrase) |
| Stagner #30 | 10-index, 325-yd hole: needs 174 yd (fairway) vs 196 yd (rough) to break even (22-yd gap). 500-yd hole: 210 vs 211. For 5+ index on holes ≥450 yd, fairway vs rough "essentially no difference"\[31\] | Strong |
| DECADE (Fawcett) | DeChambeau "won't put the long driver in play unless he can gain 25–30 yards"\[8\] | Moderate (anecdote from system author) |

**Engine rule:** default to driver. Flip to a shorter club only when the expected-strokes calculation, including Brett's 12%/15% big-miss rates mapped onto that hole's penalty geometry, favors it. Per the derived threshold, that means the shorter club cuts penalty probability by more than ~5–8 points per 20 yd lost.

#### 2.3 Lay-ups: favorite number vs proximity

| Finding | Numbers | Grade |
|---|---|---|
| Tour fairway expected strokes rise monotonically inside 100 yd | 30 yd 2.52 → 50 yd 2.66 → 80 yd 2.75 → 100 yd 2.80 (Broadie 2012) | Strong |\[9\]
| Amateurs | "Most golfers will score worse from 80 yards from the hole than from 30, even if every layup to 30 yards lands in the rough, and every layup to 80 yards lands in the fairway" (Every Shot Counts 2014, as quoted in a Goodreads review)\[10\] | Strong source, secondary quote |
| Proximity scaling | Scratch: from 150 yd median ~37 ft.\[20\] From 100 yd, only 3% of shots finish inside 3 ft and 43% outside 15 ft (Stagner via golf.com)\[8\] | Strong |

**Verdict:** The published data do **not** support "favorite number" lay-ups for full-swing distances. Brett's case is special because he switches to finesse wedges inside ~120 yd. The engine should compare his own SG curve at, for example, 40, 60, 80 and 100 yd rather than assume a sweet spot. Treat any sweet spot as real only if it appears in his data with enough shots (see D).

#### 2.4 Flag vs center of green

| Rule | Value | Grade |
|---|---|---|
| Broadie | From 100+ yd, most amateurs should aim at the middle of the green; "the smaller the shot pattern, the closer the target should be to the hole" (2014)\[7\] | Moderate-strong |
| DECADE | Target 70% of approaches on the fat side; Tiger ~72% in his best seasons (golf.com)\[8\] | Moderate |
| Stagner | Scratch from 80 yd to a middle pin (≥10 yd from every edge): 30% finish outside 30 ft\[20\] | Strong |
| Edge-distance pin threshold ("flag within X yd of edge is off-limits") | **Not found** in primary DECADE or Broadie material | — |

**Engine rule:** Choose the target that minimizes E[J_Brett] over Brett's 2-D pattern with hole geometry. Don't use a fixed edge rule. The AGGRESSIVE option aims at the flag and reports its cost as E[strokes]_flag − E[strokes]_optimal.

---

### 3. Conditions

#### 3.1 Wet ground: dew vs rain (separately)

| Effect | Dew (surface water, firm soil) | Rain (surface and soil moisture) | Clubs | Carry/roll | Grade |
|---|---|---|---|---|---|
| Wet face or ball on wedge spin | 50-yd wedge: dry/clean 6,603 rpm; wet club 5,463 (−17%); wet ball 5,291 (−20%) (Andrew Rice, TrackMan)\[4\] | Same mechanism | Wedges | Launch up, spin down → more release | Moderate-strong |
| Wet face on 7-iron/driver | "No noticeable change" for 7-iron; "no difference" for driver (Practical Golf, SkyTrak)\[5\] | Same | 7-iron, driver | None | Moderate |
| Conflicting Rice result | In another test Rice wrote that "a wet clubface actually makes very little difference"\[32\] | — | Wedges | — | Conflict: show both |
| Fairway flyers | Rice: "I have seen fliers occur from the fairway, but that is most often due to the playing surface being wet"\[6\] | More likely | Irons from fairway | Carry | Weak-moderate (observational) |
| Driver roll-out | Moisture is one of the three most significant controllable bounce-and-roll factors (USGA/R&A DIR 2020) |\[3\] Medium vs firm −4.5 yd; soft −9.8 yd (USGA/R&A 2023, tour tee shots).\[2\] Rain days ~4 yd shorter (DIR 2020) | Driver, 3W | Roll only | Strong (tour data) |\[3\]
| USGA mowing/moisture field test | 624 bounce-and-roll measurements; average reduction 5–10 yd (USGA 2018 test, reported in USGA/R&A 2023) | — | Driver | Roll | Strong |\[2\]
| Greens holding approaches | No quantified dew study found | No quantified rain study found | Irons/wedges | Roll | Gap |
| Green speed | Dew-specific Stimp loss not measured in sources found. Claim of "1–3 ft slower" (BirdieBall) is unsourced\[33\] | USGA agronomist: "possible to have wet, fast greens and firm, slow greens"\[12\] | Putts | Roll | Weak for magnitude |

**Engine decomposition:** Brett's distances are totals. Dew and rain should modify the roll component only, except for the wedge spin effect. Use the USGA Course Rating baseline of 20 yd roll per full shot as the default roll assumption until Brett measures his own carry (USGA Handicap Manual 2016). Firm/non-irrigated fairways roll more than 20 yd; soft/irrigated fairways roll less.\[34\]

#### 3.2 Wind

| Quantity | Value | Source | Grade |
|---|---|---|---|
| Tour 7-iron, 166 yd carry | 10 mph: tail +13, head −17. 30 mph: tail +25, head −64.\[35\] Headwind loss "can be almost 50 percent more than the tailwind's potential positive effect" | Golf Digest 2019 (Foresight GCQ with TrackMan tour launch data)\[35\] | Strong (simulated) |
| Loft scaling | 7-iron/PW lose 30–48% of carry into 30 mph; driver/4-iron ~20%\[35\] | Golf Digest 2019 | Strong |
| Tailwind returns diminish | Headwind loss quadruples from 10→30 mph; tailwind gain for irons "barely doubles"\[35\] | Golf Digest 2019 | Strong |
| 20 mph asymmetry | "A headwind hurts almost twice as much as a tailwind helps" | TrackMan normalization blog 2014 | Strong |\[36\]
| Everyday-golfer rule A | Head: +1 yd per mph. Tail: −0.5 yd per mph\[37\] (for "average" golfers with 80–95 mph driver speed) | Andrew Rice with Mark Broadie (Golf Digest) | Moderate |
| Everyday-golfer rule B | Head: +mph yards per 100 yd of shot (e.g., 20 mph, 140 yd → +28)\[37\] | Andrew Rice | Moderate |\[38\]
| Everyday-golfer rule C | Head: mph% of distance + 5 yd\[39\] | Andrew Rice | Moderate (conflicts with A/B; show all) |\[40\]
| % rule | HW 10 mph −10%, HW 20 −22%, TW 10 +7%, TW 20 +12%\[41\] | GolfWRX author, TrackMan-based | Moderate |
| Crosswind drift | TrackMan standard amateur 6-iron (80 mph, 153 yd carry): 20 mph crosswind → 27 yd (81 ft) sideways ≈ 1.35 yd per mph | Philippe Bonfanti blog reproducing TrackMan data | Moderate (secondary) |\[42\]
| Crosswind, driver and 7-iron | No primary per-mph figure found. Informal claims of 1–2 yd per mph (driver) are unverified | — | Weak |\[43\]
| Trajectory | Higher apex and higher spin increase wind effect. A 7-iron into wind carries ~5% farther if launched "a couple degrees lower"\[35\]\[37\] | Golf Digest 2019; Rice | Strong direction |\[35\]

**Engine note:** Apply wind to carry only. Use the along-target component (cos θ) and cross component (sin θ).\[44\] Increase 10-m wind speed for exposed holes, and decrease it for tree-sheltered holes; the correction factor is uncalibrated (see D).

#### 3.3 Temperature, humidity, altitude, air density

| Effect | Value | Source | Grade |
|---|---|---|---|
| Temperature (Rice study) | Driver carry change "caps out at about two yards per 10 degrees"; PW ~1.3 yd per 10°F. Driver 250 at 70°F → "about 254 yards in 90-degree conditions," 246 at 50°F | Andrew Rice TrackMan study (155-mph ball speed, 2018 Coach Camp), Golf.com 2018 | Strong |
| Temperature (TrackMan) | 1.33–1.66 yd per 10°F depending on club\[1\] | TrackMan via Golf News Net 2025 | Strong (conflicts slightly) |
| Temperature (TrackMan data, Practical Golf) | 40→100°F: 6-iron +8 yd, driver +9 yd\[45\] (~1.3–1.5 yd per 10°F) | Practical Golf | Moderate |\[46\]
| Humidity | 10%→90% RH: < 1 yd on a 6-iron (TrackMan, via Practical Golf).\[45\]\[47\] "Almost no effect on carry" (Rice).\[48\] Humid air is less dense → slightly longer | Practical Golf; Rice | Strong: negligible |
| Altitude (Titleist) | % gain = elevation(ft) × 0.00116 → 5,280 ft ≈ +6% (250 → 265)\[49\] | Titleist, via Golf Ball Planet | Moderate (secondary) |
| Altitude (Rice) | Driver +2.5 yd per 1,000 ft; optimal driver spin 2,250 rpm at sea level → ~3,000 rpm at 10,000 ft\[48\] | Golf.com 2018 | Strong |
| Altitude ("2% per 1,000 ft") | 2% | GolfWeatherIndex app | Weak (conflicts with Titleist 1.16%) |

**Air-density formula (standard thermodynamics):** ρ = p_d/(R_d·T) + p_v/(R_v·T), with R_d = 287.05 and R_v = 461.5 J/(kg·K), T in kelvin, p_v = RH × saturation vapor pressure(T), p_d = p − p_v.
- Derived calibration, not published: a 10°F change at ~70°F changes ρ by ~1.9%. Rice's driver +2 yd/250 = +0.8%, which implies carry elasticity ≈ 0.4 (%carry per −%ρ).
- Standard atmosphere density falls ~3% per 1,000 ft, and Titleist's +1.16% per 1,000 ft also implies elasticity ≈ 0.4. The two independent sources agree.
- Engine: Δcarry% ≈ 0.4 × (ρ_ref − ρ)/ρ_ref × 100, applied to carry only.
- Humidity check: 90°F, 10%→90% RH lowers ρ by ~1.4% → ~0.6% carry (~1.4 yd on a 250-yd drive, <1 yd on a 6-iron), consistent with the TrackMan finding.

For Georgia (elevation ~1,000 ft in the Atlanta area), altitude vs a sea-level reference is worth ~+1.2% (Titleist formula). Brett's totals were presumably gathered at home altitude, so set ρ_ref to his home-course typical conditions, not sea level.

#### 3.4 Firm vs soft fairways and greens

| Effect | Value | Source | Grade |
|---|---|---|---|
| Tour tee shots, fairway firmness | Medium −4.49 yd (SE 0.076); soft −9.80 yd (SE 0.091) vs firm | USGA/R&A "Golf Course Effects on Hitting Distance" 2023 (ShotLink) | Strong |\[2\]
| Soft conditions, median driving | −4.4 yd | MyGolfSpy summary of DIR 2020 | Moderate (secondary) |\[50\]
| Course-rating roll assumption | 20 yd roll per full shot; more if firm/non-irrigated, less if soft/irrigated | USGA Handicap Manual 2016 | Strong (definitional) |\[34\]
| Driver roll vs landing angle | Optimal ~40°; each degree flatter → +1.5–2 yd roll | Scott Sackett (TrackMan-based) 2016 | Moderate |\[51\]
| Consistency check | Draw 28.8° vs fade 42.9° landing → draw rolls ~20 yd more (~1.4 yd per degree) | TrackMan blog (Stickney) | Strong |\[52\]
| Optimal driver landing angle for total distance | ~37° | TrackMan blog "The Chip Shot Code" | Strong |\[53\]
| Approach stopping | Landing angle > 45° recommended for approach stopping power. Tour target 45–50°; below 45° the ball "skip[s] forward too far" | TrackMan Support; Titleist Learning Lab | Strong (qualitative) |\[54\]\[55\]
| Approach roll vs green firmness (yards per club) | **Not found** (no TruFirm-to-roll data) | — | Gap |
| Links-firm iron roll | Low "stinger" iron: twice the roll of driver; 40–50 yd roll on tarmac-firm links\[35\] | Golf Digest 2019 | Strong (simulated) |\[35\]

#### 3.5 Rough length and type (Bermuda)

| Effect | Value | Source | Grade |
|---|---|---|---|
| Bermuda fairway lies | Ball "perches"; cleaner contact, more spin than bent/other types\[56\] | Greg Norman (shark.com) | Weak-anecdotal |
| Bermuda rough | Wiry, dense; "grabs the hosel," closes face; flyer with "almost no spin"\[57\] | LINKS Magazine | Weak-anecdotal |
| Grain around greens | Into-grain chips "snag" clubs\[58\]\[59\] | Golf.com (Westacott; LPGA pros) | Weak-anecdotal |
| Rough height 2" vs 4" distance loss | **Not found** | — | Gap |
| Flyer probability by height | **Not found**. Rice: flyers most common from "shortish rough"\[6\] | Rice (Golf.com) | Weak |
| SG rough penalty, tour | 0.20–0.23 (50–150 yd) | Broadie 2012 | Strong |\[9\]
| SG rough penalty, 5-index | +0.11 at 80–89 yd; ≤0.10 in ~half of cells; "numbers will change slightly in different grass types"\[22\] | Stagner #2 2022 | Strong |
| Flyer distance claims | "PW +20–25 yd, 7-iron +20–30 yd"\[60\] | Golf Sensei (training site) | Weak (unverified) |

#### 3.6 Time of day

| Effect | Value | Source | Grade |
|---|---|---|---|
| Dew evaporation window | "From only 30 min before sunrise to 3–5 h after sunrise"; "completely depleted approximately 4 h after sunrise" | MDPI *Water* 14:2428, 2022 (four shrubs, Changchun, China) | Moderate (not turf, not Georgia) |
| Dew in a semi-arid setting | Formation continues to ~7:00; evaporated by ~10:00\[61\] | Madagascar dewfall study (ResearchGate figure) | Moderate |
| Sunrise for wetness modeling | Solar radiation > 8 W/m²\[62\] | Plant-disease warning model (science.gov summary) | Moderate |
| Greens morning → afternoon | −9.5 in average over 8 days at Martis Camp (target 11'8"–12'5"); firmest/low-thatch greens ~−3 in, least-firm/higher-thatch greens −13 in (Brian Whitlark, USGA "Championship Green Speed," Aug 2013). Oregon State: −6 in average. 13-ft greens lose >6 in; 9–10-ft greens lose 3–6 in\[12\] | USGA 2013; Whitlark\[12\]\[63\] (USGA agronomist) | Moderate-strong |
| Perception | 6-in Stimp differences not reliably detected by golfers; 12-in differences detected more often\[64\] | GCSAA green-speed perception study | Moderate |
| Afternoon heat | +2 yd driver carry per 10°F\[48\] (e.g., 70→95°F ≈ +5 yd) | Rice 2018 | Strong |
| Afternoon wind build | Not researched with a primary source here. Use the hourly Open-Meteo forecast, not a rule | — | — |

---

### 4. Detecting Conditions Without Asking

#### 4.1 Open-Meteo variables (Forecast API `/v1/forecast`)

| Variable (exact name) | Valid time | Unit | Use |
|---|---|---|---|
| `temperature_2m` | Instant | °C/°F (`temperature_unit=fahrenheit`) | Air density, heat |
| `relative_humidity_2m` | Instant | % | Air density, dew |
| `dew_point_2m` | Instant | °C/°F | Dew rule |
| `surface_pressure` | Instant | hPa | Air density (use this, not `pressure_msl`) |
| `precipitation`, `rain`, `showers` | Preceding-hour sum | mm/inch | Rain wetness |
| `cloud_cover`, `cloud_cover_low` | Instant | % | Radiative cooling (dew), dry-down |
| `wind_speed_10m`, `wind_direction_10m` | Instant | km/h default; set `wind_speed_unit=mph` | Wind; dew formation |
| `wind_gusts_10m` | Preceding-hour max | same | Gust variance |
| `shortwave_radiation` | Preceding-hour mean | W/m² | Sunrise/dry-down energy |
| `soil_temperature_0cm` | Instant | °C/°F | Surface-cooling proxy |
| `soil_moisture_0_to_1cm`, `soil_moisture_1_to_3cm`, `soil_moisture_3_to_9cm` | Instant | volumetric | Rain wetness, firmness |
| `et0_fao_evapotranspiration`, `evapotranspiration` | Preceding-hour sum | mm | Dry-down since rain |
| `vapour_pressure_deficit` | Instant | kPa | Drying power (>1.6 high, <0.4 low per Open-Meteo docs)\[65\] |
| `is_day` | Instant | 0/1 | Sunrise gate |
| Daily: `sunrise`, `precipitation_sum`, `leaf_wetness_probability_mean` | Daily | — | Dew timing; leaf wetness |

**Limits:**
- `past_days` can be 0–92 and `forecast_days` 0–16; `past_hours`/`forecast_hours` are also supported (Open-Meteo docs).\[65\]
- Precipitation and radiation are preceding-hour aggregates,\[65\] so shift them by one hour.
- Soil-moisture layers depend on the model. 0–1 and 1–3 cm appear in the default Forecast API and the DWD ICON API.\[65\]\[66\] GFS/HRRR provide 0–10 cm, and the Historical (ERA5) API provides 0–7 cm.\[67\]\[68\] The engine must check which layer returned non-null values.
- Free use is non-commercial; commercial use needs an API key (Open-Meteo pricing).\[65\]
- NWS (api.weather.gov) and OpenWeatherMap were **not verified** in this research. Treat them as fallbacks and check them before use.

#### 4.2 Detection rules (engine defaults: uncalibrated thresholds, marked as such)

| State | Rule | Basis | Confidence |
|---|---|---|---|
| **Dew likely present** | (min overnight `temperature_2m` − `dew_point_2m`) ≤ **3°F** AND mean overnight `cloud_cover` ≤ **40%** AND mean overnight `wind_speed_10m` ≤ **5 mph** AND local time < sunrise + **3 h** (extend to +5 h if `cloud_cover` > 70% or morning `shortwave_radiation` stays < 200 W/m²) | Dew forms when the surface temperature is ≤ the dew point, and clear, calm nights drive radiative cooling of the grass below air temperature (physics). Evaporation takes 3–5 h after sunrise (MDPI 2022).\[69\] Thresholds are engine defaults | Moderate for timing; thresholds uncalibrated |
| Dew clock start | First hour with `shortwave_radiation` > 8 W/m²\[62\] | Disease-model sunrise definition | Moderate |
| Dew corroboration | `leaf_wetness_probability_mean` high (daily); RH ≥ 90% at dawn | Open-Meteo variable | Low-moderate (daily resolution) |
| **Wet from rain** | Σ`precipitation` last 12 h ≥ **5 mm** OR last 24 h ≥ **10 mm**, OR `soil_moisture_0_to_1cm` in the top quartile of the course's own trailing 30-day distribution | Engine defaults. Lawn-care guidance puts light rain (<5 mm) at a 2–4 h dry time and >20 mm at next day (Dreame yard-care guide, weak)\[70\] | Low-moderate |
| **Firm and fast** | No day with ≥ 2.5 mm in last **3–5 days** AND Σ`et0_fao_evapotranspiration` over that period > Σprecip AND max `temperature_2m` ≥ 85°F AND soil moisture in the bottom quartile of its 30-day distribution | Engine defaults. Moisture drives bounce-and-roll (USGA/R&A DIR 2020) | Low |\[3\]
| Use relative, not absolute, soil moisture | Percentile vs course history | Model soil moisture is not calibrated to sand-based greens or irrigated fairways | — |

**Failure modes:**
- Irrigation: Southeast courses water overnight in summer, so fairways can be wet with 0 mm rain. Default to "morning moist" before ~10:00 in June–September regardless of rain.
- Shade and north slopes dry 2–3 h later (Greensoul, weak).\[71\]
- Drainage and soil type: sand-capped greens dry fast, clay fairways slowly.
- Grid-cell mismatch: 2–25 km model cells.
- Forecast vs observed precipitation: use `past_hours` from the Forecast API, which blends recent runs, and accept the error.

---

### 5. Where Recommendations Should Flip

#### 5.1 Evidence-supported flips

| Condition | Flip | Why | Grade |
|---|---|---|---|
| Rough/wet lie, 8-iron or shorter | Plan for longer carry and more release: take less club or aim shorter of the flag | Higher launch, lower spin (Rice)\[6\] | Moderate |
| Rough/wet lie, 6-iron or longer | Do not take less club; the ball can come up short | Spin drops, launch barely changes (Rice)\[6\] | Moderate |
| Wet ball/face, wedge ≤100 yd | Expect ~15–20% less spin and more release: favor landing short of the flag or the fat side | Rice; Practical Golf | Moderate-strong |
| Soft/wet fairways | Lower driver total by 4.5–9.8 yd (roll only); this raises the value of carrying fairway bunkers and forced carries | USGA/R&A 2023 | Strong |\[2\]
| Firm/fast | Add roll; low-landing-angle shots roll ~1.5–2 yd more per degree flatter | Sackett; TrackMan | Moderate |\[51\]
| Into the wind | Add club per wind rule. Favor lower-launch/lower-spin clubs (a longer club) over a high-lofted club | Golf Digest 2019 (lofted clubs lose 30–48% at 30 mph vs ~20% for driver/4-iron)\[35\] | Strong |\[35\]
| Downwind | Take less club, but only about half the headwind adjustment | TrackMan; Golf Digest | Strong |\[36\]
| Heat (90°F+ vs 70°F) | Driver +~4 yd carry;\[48\] wedges ~+2–3 yd | Rice 2018 | Strong |
| OB/water on Brett's right-miss side | Shorter club only if it cuts penalty rate by >5–8 points per 20 yd lost | Derived from Broadie | Moderate |
| Lay-up choice | Go closer unless Brett's own data show a sweet spot | Broadie | Strong |
| Approach ≥100 yd | Center/fat side as the SAFE default | Broadie; DECADE | Moderate-strong |

#### 5.2 Folklore or unsupported

| Claim | Verdict | Evidence |
|---|---|---|
| "The ball goes shorter in humidity" | **False** (direction wrong, size tiny) | Humid air is less dense; 10→90% RH < 1 yd (TrackMan via Practical Golf)\[45\] |\[47\]
| "Always club up from wet rough" | **Wrong for short irons**, possibly right for long irons | Rice (flyer direction depends on club)\[6\] |
| "Greens speed up as the dew burns off" | **Unsupported**. Measured greens slow 3–13 in from morning to afternoon (9.5 in average) | USGA 2013 (Whitlark, Martis Camp); Whitlark |
| "Dew slows greens 1–3 ft" | **Unverified magnitude** | BirdieBall (no data)\[33\] |
| "Hit 3-wood for accuracy" | **Mostly false** for amateurs | Arccos; Shot Scope\[72\]\[73\] |
| "Favorite yardage lay-up" | **Not supported** by aggregate data | Broadie |
| "Swing easy in the wind" | **Not quantified**. The measured lever is launch/spin (−2° launch ≈ +5% carry into wind for a 7-iron)\[35\] | Golf Digest 2019 |\[35\]
| "Wet greens: fire at pins because the ball holds" | **Plausible but unquantified**. The wedge-spin loss partially offsets greens holding better | Gap |
| "Flyers add 20–30 yards" | **Weak**; no controlled amateur data | Golf Sensei (marketing)\[60\] |

---

## C. Engine Constants

| Effect | Trigger | Adjustment | Range | Clubs | Confidence | Source |
|---|---|---|---|---|---|---|
| Baseline | Always | J_tour(d, lie) from Table 9; putts from 1.5 | — | All | Strong | Broadie 2012 |
| Handicap offset | Always | J_Brett = J_tour + Δ(d, lie), Δ learned; prior = interpolation to 90-golfer tee line (2.79 + 0.0066d) | ~8 hcp ≈ 40–45% toward 90-golfer (assumption) | All | Low (prior) | Broadie 2008/2014 |
| Rough penalty prior | Lie = rough | +0.11 strokes at 80–89 yd (5-index); tour 0.20–0.23 | 0.05–0.23 | Approaches | Strong | Stagner 2022; Broadie 2012 |
| Recovery penalty | Obstructed | +0.6 vs fairway, +0.4 vs rough (150–300 yd, tour) | — | All | Strong | Broadie 2012 |\[9\]
| OB cost | OB | SG = −2 | — | Tee | Strong | Broadie 2014 |
| Headwind | Along-wind component > 0 | Carry −1 yd per mph (Rice/Broadie rule A, 80–95 mph driver speed) OR −1%/mph at 10 mph, −1.1%/mph at 20 mph | Tour 7-iron: −17 yd at 10 mph, −64 at 30 | All; % loss larger for lofted clubs | Strong/Moderate | Golf Digest 2019; Rice; GolfWRX |
| Tailwind | Along-wind component < 0 | Carry +0.5 yd per mph (Rice) OR +0.7%/mph at 10 mph, +0.6%/mph at 20 | Tour 7-iron: +13 at 10, +25 at 30 | All | Strong/Moderate | same |\[35\]\[37\]
| Crosswind | Cross component | Lateral ≈ 1.35 yd per mph (6-iron, 153 carry) | Driver/7-iron: unknown | Irons | Moderate | Bonfanti/TrackMan |\[42\]
| Temperature | ΔT vs reference | Driver +2 yd/10°F; PW ~+1.3 yd/10°F (Rice) OR 1.33–1.66 yd/10°F (TrackMan) | 1.3–2 yd/10°F | All | Strong | Rice 2018; TrackMan |
| Air density (general) | Any T, p, RH | Δcarry% ≈ 0.4 × (ρ_ref − ρ)/ρ_ref × 100 | Elasticity 0.35–0.45 (derived) | All | Moderate (derived) | Rice; Titleist; physics |
| Altitude | Elevation ≠ reference | +1.16% per 1,000 ft (Titleist) OR driver +2.5 yd per 1,000 ft (Rice) | 1–2%/1,000 ft | All | Moderate | Titleist; Rice |
| Humidity | RH change | Via ρ; ≤ ~1 yd | 0–1.4 yd | All | Strong (negligible) | TrackMan via Practical Golf |\[47\]
| Fairway firmness | Soil/rain rules | Driver total: medium −4.5, soft −9.8 yd vs firm | 4–10 yd | Driver, 3W | Strong | USGA/R&A 2023 |\[2\]
| Rain day | ≥ rain threshold | Driver −4 yd | — | Driver | Strong | DIR 2020 |\[3\]
| Default roll | No carry data | Roll = 20 yd per full shot (Course Rating) | ± firmness | Full shots | Moderate | USGA 2016 |\[34\]
| Landing angle → roll | Known descent angle | ±1.5–2 yd roll per degree around 37–40° | — | Driver | Moderate | Sackett; TrackMan |\[51\]\[53\]
| Wet wedge spin | Dew/rain AND wedge | Spin −17% to −20%; add release | ~−20% | Wedges | Moderate-strong | Rice; Practical Golf |
| Wet face, long clubs | Dew/rain | 0 | — | 7-iron, driver | Moderate | Practical Golf |
| Flyer, short irons | Rough (esp. short) or wet lie | Carry + (unknown). Direction: longer | Unquantified | ≤ 8-iron | Moderate (direction) | Rice |
| Flyer, long irons | same | Carry may drop. Direction: shorter | Unquantified | ≥ 6-iron | Moderate (direction) | Rice |
| Dew state | Rule 4.2 | Enables wet-wedge and fairway-flyer flags | Sunrise + 3–5 h | — | Moderate | MDPI 2022 |
| Green-speed drift | Tee time vs morning | −3 to −13 in Stimp by afternoon (9.5 in average) | — | Putts | Moderate | USGA 2013 (Whitlark) |
| Driver default | Par 4/5 | Driver unless penalty math flips it | 5–8 pt threshold | Tee | Moderate (derived) | Broadie; Arccos; Shot Scope |
| Approach target | ≥100 yd | Minimize E[J] over Brett's pattern; SAFE = center/fat side | — | Approaches | Moderate-strong | Broadie; DECADE |

---

## D. Open Questions Brett Must Measure

1. **Carry vs roll split per club.** His numbers are totals. Measure carry on a launch monitor at home-course temperature, or the engine must rely on the generic 20-yd Course Rating roll.
2. **His rough penalty on Georgia Bermuda** by distance and rough height. No published 2" vs 4" or Bermuda-specific data exist.
3. **Flyer magnitude by club** from Bermuda rough and from dewy fairways. Only the direction is known (Rice).
4. **Crosswind drift for his driver and 7-iron.** No primary per-mph figure was found.
5. **Wedge sweet spot inside 120 yd.** Is there a lay-up distance where his finesse-wedge SG beats a shorter one? Aggregate data say no.
6. **Dew burn-off time on his courses** vs the 3–5 h literature (non-turf) value; log first-dry-fairway time for 10+ rounds.
7. **Detection thresholds** (3°F spread, 5 mph wind, 5/10 mm rain, soil-moisture percentiles) are uncalibrated engine defaults. Tag rounds as dew/wet/firm and fit the thresholds.
8. **Approach roll-out on soft vs firm greens by club.** No TruFirm-to-roll data were found.
9. **Handicap offset weight** (~40–45% toward the 90-golfer curve) is an assumption. Replace it with his own Δ(d, lie) once ≥ ~30 shots per bin exist.
10. **Wind exposure factor** from 10-m model wind to on-course wind at ball height, for tree-lined vs open holes.

## Sources

1. [How do temperature, humidity, elevation affect how far the golf ball flies?](https://thegolfnewsnet.com/ryan_ballengee/2025/04/25/how-much-temperature-humidity-elevation-affect-how-far-golf-ball-flies-103715/)
2. [Page 1 of 19 Golf Course Effects on Hitting Distance](https://www.usga.org/content/dam/usga/pdf/2023/Golf-Course-Distance-Effects-Final.pdf)
3. [Distance Insights Report Page 1 of 102](https://www.usga.org/content/dam/usga/pdf/2020/distance-insights/DIPR-FINAL-2020-usga.pdf)
4. [wedges — Golf Blogs](https://www.andrewricegolf.com/andrew-rice-golf/tag/wedges)
5. [How Does Dirt and Water Affect Spin Rate? \[Test Results\] · Practical-Golf.com](https://practical-golf.com/water-dirt-spin-rate-wedges)
6. [What is a 'flier'? How to spot (and master) one of the trickiest shots in golf](https://golf.com/instruction/what-is-flier-lie-golf/)
7. [Every Shot Counts by Mark Broadie - Every Shot Counts](http://everyshotcounts.com/248-2/)
8. [This data-first approach to course strategy is changing how pros play, including at the Masters](https://golf.com/news/decade-stats-course-strategy-changing-how-pros-play/)
9. [Assessing Golfer Performance on the PGA TOUR Mark Broadie](https://columbia.edu/~mnb2/broadie/Assets/strokes_gained_pga_broadie_20110408.pdf)
10. [Jump to ratings and reviews](https://www.goodreads.com/book/show/17674971)
11. [Does swinging all out come at too great a cost? What our test reveals](https://www.golfdigest.com/story/how-hard-should-you-swing-test-explains-fairway-vs-rough-tradeoff-stats-golf-digest-mythbusters)
12. [An Agronomist's View on How to Read Greens](https://gsrpdf.lib.msu.edu/?file=%2Farticle%2Fwhitlark-agronomists-11-14-14.pdf)
13. [Assessing Golfer Performance on the PGA TOUR](https://pubsonline.informs.org/doi/10.1287/inte.1120.0626)
14. [What is Strokes Gained Around the Green? Explained.](https://www.thediygolfer.com/blog/strokes-gained-around-the-green)
15. [PGA Tour Putts Gained/Make Percentage Stats - Instruction and Playing Tips - The Sand Trap .com](https://thesandtrap.com/forums/topic/51757-pga-tour-putts-gainedmake-percentage-stats/)
16. [Putting Stats](https://bryanpategolf.com/2019/04/29/putting-stats/)
17. [Strokes Gained Putting: What It Means and How to Read Yours](https://whygolf.com/blogs/whysguyscorner/strokes-gained-putting)
18. [How Strokes Gained Works](https://www.pinpoint.golf/blog/how-strokes-gained-works.html)
19. [Strokes Gained Explained: The Stat That Matters Most](https://www.scoringzone.net/blog/golf-strokes-gained-explained.html)
20. [Scratch golfer stats that will shock you](https://www.compleatgolfer.com/golf/scratch-golfer-stats-that-will-shock-you/)
21. [Data Reveals the Cold Hard Truth About Golf Shots From Within 100 Yards - Yahoo Sports](https://sports.yahoo.com/articles/data-reveals-cold-hard-truth-210656667.html)
22. [Why fairways are overrated for amateur players.](https://newsletter.loustagnergolf.com/p/newsletter-2-why-fairways-are-overrated-for-amateur-players)
23. [Strokes Gained Benchmarks for Every Handicap Level - Golf Tracking & Strokes Gained](https://golfity.com/blog/strokes-gained-benchmarks-for-every-handicap/)
24. [The Statistical Differences Between A Scratch Golfer And PGA Tour Player - SwingU Clubhouse](https://clubhouse.swingu.com/statistics/the-statistical-differences-between-a-scratch-golfer-and-pga-tour-player/)
25. [How to Use Shot Dispersion Data to Pick Smarter Targets on the Golf Course](https://t5golf.com/shot-dispersion-course-management/)
26. [Quantified Golf](https://quantifiedgolf.com/blog/understand-your-dispersion)
27. [decade for beginners and name that](https://puregolf.substack.com/p/decade-for-beginners-and-name-that)
28. [Are You More Likely To Hit The Fairway With A Driver Or 3-Wood? Here's What The Data Says...](https://www.golfmonthly.com/features/why-hitting-a-3-wood-off-the-tee-isnt-worth-it)
29. [Driver vs 3-Wood Off the Tee: When to Use Each](https://launchpointgolf.com/articles/driver-vs-3-wood-off-tee/)
30. [Driver Vs. 3 Wood off the tee - Length vs. accuracy - What does Stagner (Arccos) say? - The 19th Hole - MyGolfSpy Forum](https://forum.mygolfspy.com/topic/75350-driver-vs-3-wood-off-the-tee-length-vs-accuracy-what-does-stagner-arccos-say)
31. [Lou Stagner's Newsletter #30](https://newsletter.loustagnergolf.com/p/how-far-is-a-good-drive)
32. [spin rate — Golf Blogs](https://www.andrewricegolf.com/andrew-rice-golf/tag/spin+rate)
33. [What Green Speed Rating Actually Means (And Why It Matters) - BirdieBall](https://www.birdieball.com/blogs/news/green-speed-rating)
34. [USGA](https://www.usga.org/etc/designs/usga/content/rule-book/handicap-manual-2016/rule-14395.html)
35. [We've taken the guesswork out of playing in the wind with this powerful new tool](https://www.golfdigest.com/story/weve-taken-the-guesswork-out-of-playing-in-the-wind-with-this-powerful-new-tool)
36. [Understanding Trackman's Golf Normalization Feature](https://www.trackman.com/blog/golf/normalization-feature-explained)
37. [wind formula — Golf Blogs](https://www.andrewricegolf.com/andrew-rice-golf/tag/wind+formula)
38. [How to Deal with a Headwind](https://www.andrewricegolf.com/andrew-rice-golf/2017/5/hitting-approach-shots-into-a-headwind)
39. [playing in the wind — Golf Blogs](https://www.andrewricegolf.com/andrew-rice-golf/tag/playing+in+the+wind)
40. [Playing and Practicing in the Wind](https://www.andrewricegolf.com/andrew-rice-golf/2019/7/playing-and-practicing-in-the-wind)
41. [How the wind affects your golf ball](https://golfwrx.com/318416/how-the-wind-affects-your-golf-ball/)
42. <http://www.philippebonfantigolf.co.uk/En/blog_files/wind-golf.html>
43. [How Wind Affects a Golf Ball (Distance, Direction, and Ball Flight Explained)](https://www.freegolfsimulator.com/guides/how-wind-affects-golf-ball)
44. [Crosswind](https://en.wikipedia.org/wiki/Crosswind)
45. [How Weather Affects Your Golf Ball - Dispelling the Myths · Practical-Golf.com](https://practical-golf.com/weather-affects-golf-ball-dispelling-myths/)
46. [TrackMan University - Dan Bubany](https://danbubanygolf.com/trackman-university/)
47. [How Does Weather Affect Golf Balls Flight And Distance?](https://medium.com/golfs-hub/how-does-weather-affect-golf-balls-flight-and-distance-de8f85a90b90)
48. [How heat and altitude affect the distance your golf ball travels](https://golf.com/instruction/heat-altitude-affect-golf-ball-distance/)
49. [How Weather Conditions Affect Your Golf Ball Performance](https://www.golfballplanet.com/blog/how-weather-conditions-affect-golf-ball-performance/)
50. [8 Intriguing Charts from the Distance Insights Report](https://mygolfspy.com/news-opinion/8-intriguing-charts-from-the-distance-insights-report/)
51. [Landing Angle](https://www.scottsackett.com/wp-content/uploads/2016/02/The-Forgotten-Number-in-Driving-Fitting.pdf)
52. [Draw or Fade to Maximize Distance in Golf](https://www.trackman.com/blog/golf/draw-or-fade-to-maximize-distance)
53. [The Chip Shot Code: Mastering Short Game Precision](https://www.trackman.com/blog/golf/the-chip-shot-code)
54. [What is golf ball angle of descent?](https://www.titleist.co.uk/learning-lab/performance/golf-ball-angle-of-descent)
55. [Parameters](https://support.trackmangolf.com/hc/en-us/articles/39727190664859-Parameters-Landing-Angle-Tee-to-Green)
56. [Golf Tip - Grass Knowledge - Greg Norman & The ...](https://shark.com/golf-tips/grass-knowledge/)
57. [5 Grasses Every Golfer Should Know - LINKS Magazine](https://linksmagazine.com/5-grasses-every-golfer-should-know/)
58. [6 grass types every golfer should know, and how each affects your game](https://golf.com/lifestyle/grass-types-every-golfer-should-know/)
59. [The biggest difference between Bermuda and Bentgrass, according to pros](https://golf.com/instruction/putting/difference-bermuda-bentgrass-lpga-pros/)
60. [How Golf Lies Affect Distance: Complete Course Management Guide](https://www.golfsenseitraining.com/blog/how-different-golf-lies-affect-distance-complete-guide)
61. [Dew accumulation and evaporation during the night and morning hours (n...](https://www.researchgate.net/figure/Dew-accumulation-and-evaporation-during-the-night-and-morning-hours-n-14-140-in-the_fig3_277559814)
62. [leaf wetness sensors: Topics by Science.gov](https://www.science.gov/topicpages/l/leaf+wetness+sensors)
63. [Championship Green Speed](https://www.usga.org/course-care/2013/08/championship-green-speed-21474858773.html)
64. [-- ..:.\~ Over typical Stimpmeter distances, golfers are only guessing when](https://www.gcmonline.com/docs/librariesprovider2/document-library/golfers-perceptions-greens-speeds.pdf)
65. [🌦️ Docs | Open-Meteo.com](https://open-meteo.com/en/docs)
66. [DWD ICON API](https://open-meteo.com/en/docs/dwd-api)
67. [🏛️ Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api)
68. [GFS & HRRR API](https://open-meteo.com/en/docs/gfs-api)
69. [Dew Evaporation Amount and Its Influencing Factors in an Urban Ecosystem in Northeastern China](https://www.mdpi.com/2073-4441/14/15/2428)
70. [Can You Mow Wet Grass? The Honest Answer](https://yardcare.dreametech.com/blogs/lawn-garden/cutting-wet-grass)
71. [What Time Does Dew Dry Off Grass? \[The Morning Timeline\] - Greensoul.blog](https://www.greensoul.blog/what-time-does-dew-dry-off-grass)
72. [Driver vs 3 Wood: Which should I use off the tee?](https://ca.arccosgolf.com/blogs/community/3-wood-vs-driver-is-the-accuracy-worth-the-sacrificed-distance)
73. [Driver or 3 Wood off the tee, what should you use and why? - Shot Scope - Blog](https://shotscope.com/blog/practice-green/stats-and-data/driver-versus-3-wood/)
