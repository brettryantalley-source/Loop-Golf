# Caddie brain report → engine: what goes in, what does not (Sep 29, 2026)

Source: `docs/research/caddie-brain-2026-09-29.md` (evidence-graded course-management research,
Brett, Sep 29). This file is the integration decision per item. Constants land in
`src/caddie/config.js`; everything stays tunable and cited in code.

| # | Report finding | Decision | Where |
|---|---|---|---|
| 1 | Broadie 2012 Table 9 is the primary baseline (rows 10–600 yd, five lies); tee and sand columns are non-monotonic and should be isotonically smoothed. | **Replace** the transcribed table in `baseline.js` with Table 9 verbatim (adds the 10–90 yd rows), cite Interfaces 42(2). Apply isotonic (non-decreasing in distance) smoothing to the tee and sand columns at load. Keep the putting table. | `src/caddie/baseline.js` |
| 2 | No scratch table exists; model Brett as J_tour + Δ, Δ learned from his data, prior = ~40–45% of the way from the tour tee line (2.38 + 0.0041d) to the 90-golfer line (2.79 + 0.0066d). | **Adopt** as the fallback prior where Brett has no bucket: `HCP_BLEND = 0.42`, Δ(d) = 0.42 × (0.41 + 0.0025 d). Replaces the flat `BASELINE_SCRATCH_OFFSET` (kept, default 0). Buckets with personal SG are unchanged. | `E()` in `src/caddie/profile.js` |
| 3 | Wind is asymmetric and loft-scaled: head ≈ −1.0%/mph at 10 → −1.1%/mph at 20; tail ≈ +0.7%/mph at 10 → +0.6%/mph at 20; lofted clubs lose 30–48% into 30 mph vs ~20% for driver/4-iron; crosswind ≈ 1.35 yd/mph on a 153-yd 6-iron (0.9%/mph). | **Adopt**: `WIND = { headPctPerMph: 0.010, headCurve: 0.00005, tailPctPerMph: 0.007, tailCurve: -0.00005, loftMult: { long: 0.75, mid: 1.0, short: 1.2, wedge: 1.35 }, crossPctPerMph: 0.009 }`. Head loss % = (headPct + headCurve·mph)·mph·loftMult, capped at 50%; tail gain likewise, capped at 20%. Cross drift = crossPct·mph·distance, long clubs ×0.8. Replaces `HEAD_PCT` / `TAIL_PCT` / `CROSS_YDS_PER_MPH_PER_100`. | `windEffect` in `src/caddie/engine.js` |
| 4 | Temperature: driver +2 yd/10°F on 250 (0.8%); PW ~1.3 yd/10°F on 140 (0.93%); TrackMan 1.33–1.66 yd/10°F. | **Tune** `TEMP_PCT_PER_10F` 0.010 → 0.0085 (midpoint). Reference stays 70°F. | `src/caddie/config.js` |
| 5 | Altitude +1.16% carry per 1,000 ft (Titleist; Rice agrees); humidity < 1 yd (ignore). | **Adopt** altitude: `ALT_PCT_PER_1000FT = 0.0116`, `REF_ELEV_FT = 1000` (Brett's home courses, north Georgia). Ball elevation comes from the cached elevation samples (metres → feet). No humidity term. | `playsLike` in `src/caddie/engine.js`, `context.js` supplies `elevFt` |
| 6 | Wet ground changes roll and wedge spin, not carry: tour driver −4.5 (medium) / −9.8 yd (soft) of total; wedges lose 15–20% spin and release more; 7-iron and driver faces unaffected. | **Replace** "wet → roll 0 everywhere" with `ROLL_COND_MULT`: wet { long: 0.35, mid: 0.5, short: 0.6, wedge: 1.4 (more release) }, firm { long: 1.4, mid: 1.3, short: 1.2, wedge: 1.1 }, normal 1. Carry untouched. | `carryFromTotal` / `roll` in `src/caddie/profile.js`, `landingModel` |
| 7 | Flyer direction depends on club: 8-iron and shorter fly longer from rough/wet lies; 6-iron and longer can come up short (direction only, magnitude unquantified). | **Adopt, small**: `LIE_DIST_ADJ.rough` becomes per family: { wedge: +0.02, short: +0.02, mid: -0.04, long: -0.08 }; sand/recovery unchanged. Rough roll ×3 (D33) stays. | `src/caddie/config.js`, `resolveEntry` |
| 8 | Rough penalty for a 5–10 index is ~0.1 at wedge range vs 0.20–0.23 on tour. | **No change**: Brett's own rough buckets already price this; the tour rough column only applies where he has no data (then item 2's prior applies). | — |
| 9 | Driver is the default; a shorter club wins only if it cuts penalty probability by > 5–8 points per 20 yd lost. | **No new rule**: the simulation already prices this from his big-miss rates and the hole polygons. Add test T43: on a wide-open hole the driver is SAFE; with water on the right-miss side a shorter club wins only when its trouble rate drops by more than ~6 points. | `src/caddie/engine.test.js` |
| 10 | Center/fat side from 100+ yd; flag only for AGGRESSIVE; no fixed edge rule. Lay-ups: closer is better unless Brett's own data show a sweet spot. | **Already the design** (§3.4, §3.6, §3.7). No change. | — |
| 11 | Detecting conditions without asking: dew (temp − dew point ≤ 3°F, cloud ≤ 40%, wind ≤ 5 mph, before sunrise + 3 h), rain (≥ 5 mm / 12 h or ≥ 10 mm / 24 h), firm (no ≥ 2.5 mm day in 3–5 days, max temp ≥ 85°F). Southeast summer irrigation → "morning moist" before 10:00 Jun–Sep regardless. | **Adopt** as `conditionsFrom` v2 in `sensors.js` with the extra Open-Meteo fields (`dew_point_2m`, `cloud_cover`, hourly `precipitation` past 24 h, daily `precipitation_sum` past 5 days, `temperature_2m_max`, `sunrise`). Thresholds in config, marked uncalibrated. The Conditions chip override still wins. Field names unverifiable offline. | `src/caddie/sensors.js`, `src/caddie/config.js` |
| 12 | Green speed drifts slower through the day; dew burns off 3–5 h after sunrise. | **Not built**: putting is out of the engine (spec §12). Recorded for the putting spec. | — |
| 13 | Folklore list (humidity, "always club up from wet rough", "greens speed up as dew burns off", 3-wood for accuracy). | **Nothing to remove**: none of these are in the engine. | — |

Version: engine-only change, shipped as v22.10 (bundle rebuilt, no UI change) — the caddie's numbers move, the UI does not. Tests T1–T10
must stay green with at most fixture-level retuning; any test that flips is a decision to record.

---

# Part 2 — Wicked Smart Golf → engine (Oct 3, 2026)

Source: Michael Leonard, *How to Play Wicked Smart Golf* (notes: `docs/research/wicked-smart-golf-2026-10-03.md`).
Brett's rule: **where the guide and the Sep 29 research disagree, the guide wins.** The guide gives
rules, not numbers, so it lands as a rule layer, `src/caddie/strategy.js`, between the simulation and
SAFE: the simulation still prices every shot, the rules choose which priced shot is SAFE. AGGRESSIVE
is untouched. Constants live in `STRATEGY` in `src/caddie/config.js`; each rule switches off alone.
Decision record: D76 (D77 for what was left out).

| Tip | Guide | Decision | Where |
|---|---|---|---|
| 1 Track stats | Data over feel | **Already the design** (rule 8, shot log, Shot Pattern import). | — |
| 2 Warm-up | Routine before the round | **Not engine.** | — |
| 3a Driver | Don't reach for less club by feel; driver is often smarter | **Tie rule**: on a par-4/5 tee, a tie in expected score (D13's 0.03) goes to the driver. The research's flip threshold still decides real trade-offs (T43 unchanged): both sources agree a computed reason can beat driver. | `plainPick`, T50 |
| 3b Target off the tee | Identify trouble, pick a specific target | **Already the design**: corridor aim points priced against the hole's hazards. | — |
| 3c, 5 Stock shape | One shape, trust the pattern | **Already the design**: the engine never recommends shape (rule 6). "Aim accordingly" (aim off for the pattern's lateral bias) **deferred** — D77. | — |
| 4 Club up | Most trouble is short; choose on the average shot, not the perfect one | **Adopt** inside the pin rule: the club is chosen by where its average carry finishes against the depth target, and a short finish counts double (`clubUpShortWeight` 2). | `pinRulePick`, T47 |
| 5 Pin position | Front → more club; back → less than the pin yardage; middle → attack with wedges, longer clubs don't chase | **Adopt (overrides research §2.4).** When the best-priced shot goes at the green: front / back pin → depth target = green center and the aim is the center or fat side, never the flag; middle pin → depth target = the pin, and only `attackClubs` (PW, GW, SW, LW) may aim at the flag. Pin thirds along the line for a custom pin. Between equal prices with the chosen club, the center ("simple targets"). | `pinDepthClass`, `pinRulePick`, T44–T46 |
| 4–5 Guards | — (the guide assumes trouble is short) | Brett's numbers overrule the pin rule only where the hole contradicts it: the rule's pick finds > 5 points more trouble (`maxExtraTrouble`) or costs > ½ stroke (`maxCostStrokes`) than the best-priced shot → the next club in line, else the plain pick. A best-priced layup is never turned into a go at the green. | `pinRulePick`, T48 |
| 6 No hero golf | 9 out of 10 or punch out | **Adopt (overrides research's pure expected score).** From trees, or a bad / buried lie in the rough, SAFE must stay out of trouble (water, OB, sand, trees) at least 90% of the time; if nothing does, the shot with the least trouble. No cost guard: the guide says punch out. Sand lies are not included (D77). | `pickSafe`, T49 |
| 7 Routine | Commit to the target | **Not engine.** | — |

What it does on the three mapped courses (Woodmont, Chicopee, the Hampton fixture; 2,043 situations
at 90 / 120 / 150 / 175 yds, three pins, fairway / rough / trees): the rules move SAFE in about half
of them — pin-front 374, no-hero 300, pin-back 222, pin-middle 175, driver 3. Priced by the engine,
the median move costs 0.12 strokes (pin rules 0–0.16, no-hero 0.25) and lowers the trouble rate on
average (−1 to −2 points for the pin rules, −14 points for no-hero). The engine's price is the
research's model, which underrates Brett's short misses (research note, last section); the guide is
the call.

Version: v22.16.9, engine-only (no UI change). The output gains `strategy`: the rules that moved
SAFE (`pin-front` / `pin-middle` / `pin-back`, `no-hero`, `driver`), also stored with each shot
record's recommendation. AGGRESSIVE can now show a lower average than SAFE; the rail shows that delta
as `−0.n`.
