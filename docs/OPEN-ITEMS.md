# Loop — open items (merged Oct 4, 2026)

The one list of everything still unresolved. It merges the eleven Loop chats open on Oct 4: seven
spec sheets and four answers given in chat, plus Brett's notes from a short test round on the
morning of Oct 4 (C17–C19 and an addition to C3). Duplicates are merged and anything already shipped is
dropped. State: **v22.17.4** (C16, D90) on the working branch, 336 tests, decisions D1–D90; the next
decision is **D91**.

Read `CLAUDE.md` and `docs/HANDOFF-NEXT.md` first. When an item closes, delete it here in the same
commit. Not covered: claude.ai chats outside Claude Code (e.g. the Golf project chat).

IDs: **Q** a question only Brett can answer · **R** a recommendation waiting on Brett's OK ·
**F** a check on the course · **S** something Brett sends · **C** a code build · **H** housekeeping ·
**P** parked.

---

## Start here

1. **Brett:** answer **Q1**, then say **"go with the leans"** or change any **R**.
2. **Next code chat:** **C1 → C17 → C2 → C3 → C4**, then **C19**.
3. **Next round:** the **F** list.

---

## Brett

### Questions only you can answer
- **Q1.** In Shot Pattern, do you move the approach target, or leave it where the app puts it (green
  centre)? → decides C8.
- **Q2.** Two card totals disagree with GHIN. Beachwood 9/2: 84 (card) or 86 (GHIN)? Chicopee
  Mill/School 7/17: 80 or 81? → C14.
- **Q3.** Woodmont: which holes have OB, and on which side? → C13.

### Recommendations ("go with the leans" accepts all of them)

| # | Decision | Lean | Other options |
|---|---|---|---|
| R2 | Course shapes on the satellite map (C2) | **Muted** paper tints, plus a Shapes toggle | Bold, Tangent-style |
| R3 | Aim-off for your pattern includes wind (C3) | **Yes** | Pattern only |
| R4 | Chicopee imagery (C11) | **A:** leaf-off (Wayback 49059), fewest shadows | B: leaf-on (64001), live now |
| R5 | Rough distances (C7) | **Measured** where n ≥ 5, shrunk toward the model. Only the 5-iron moves much: 199 → ~192 | Keep the model · use every club |
| R6 | 3-putts from 41+ ft: 70% on only 10 putts (C7) | **Shrink** toward the 25–40 ft rate → ~52% | Keep 70% · cap it |
| R7 | Retry when OSM had no holes for a club (C6) | **Yes** | Leave it |
| R8 | Upload the Woodmont trace to OSM (C15) | **Later**, after C13 | Now |
| R9 | Native app for a gap-free GPS trail (P1) | **Not now**; live with the gaps | Capacitor wrapper: $99/yr Apple Developer, plus a Mac or a macOS build runner |

### On the next round (F)
- **F1.** Fully close and reopen Loop. Setup's build tag reads **v22.17.4 · Oct 5** (once merged).
- **F2.** The putting flow, start to finish. It has never been used on a course.
- **F3.** Log a hole you skipped: Place shot 1 → Place shot 2 → … → Done.
- **F4.** The GPS trail on a real walk. It records only while the screen is on.
- **F5.** The full-screen map: nothing sits under the notch or the home bar; the target drag, Line,
  and the club changing as you drag all work; panning and dragging don't stutter.
- **F6.** Mark where each shot ends, live or with F3 afterward. The heads-up (C4) and the learning
  loop run on shot ends, and on Oct 3 most shots had none.
- **F7.** When SAFE feels wrong, tap **Note** and dictate: hole, yards, pin, lie, what SAFE said,
  what you'd have hit. Watch for:
  - SAFE playing to the middle of the green on a front or back pin.
  - Punch-outs from the trees. SAFE needs a shot that stays clean 9 times in 10.
  - Driver on close calls off the tee.
  - AGGRESSIVE showing a lower Avg than SAFE (`−0.n`). Sensible, or a bug?
  - 2-hybrid, 4-hybrid or 5-iron off many par-4 tees. Too cautious? Drag the target where you'd aim
    (it shows Custom).
  - Par-5 second shots: 310 out → 6-iron lay-up, 290 → 2-hybrid lay-up, 270 → 2-hybrid at the green.
  - ~175 yds from the rough priced almost the same as from the fairway. Too kind?
- **F8.** After the round, report Summary's **Tee shots: Safe · Aggressive · Custom**. More Custom
  than either of the others means the calls aren't landing. Then export the shot log from History
  for a code chat.
- **F9.** At **Woodmont:** stand on the middle of three greens and read the distance to the middle
  (it should be 0–3 yds). Export the shot log afterward. → C13.
- **F10.** At **Ironwood:** report the exact text of Setup's `Satellite check` line.

### Things to send (S)
- **S1.** Shot Pattern screen recordings of five rounds: Sugar Creek 7/26, Chicopee Mill/School 7/17,
  Woodmont 6/27, Riverpines 6/21, Woodmont 6/17. → C14.
- **S2.** GHIN rounds from before May 16: at least two, hole-by-hole or just the differentials. → C14.
- **S3.** GHIN's hole-by-hole for Bear Slide 6/10 and Cider Ridge 6/6. → C14, after S2.
- **S4.** 18 Shot Pattern hole screenshots in the plain 2D view: Chicopee Village 1–9 and Mill 1–9.
  The Village 1–8 screenshots sent Oct 3 never reached the repo. Green slope maps are optional. → C12.
- **S5.** Shot Pattern's tee-shot dispersion screens for Driver, 2-iron and 4-hybrid (or just more
  4-hybrid shots), plus the Driving tab's landing zones (Casual · Last 10). → a profile rebuild.
- **S6.** A launch-monitor range session: carry for every club, the 2-iron partial, and wedge ½ and
  ¾ swings. → a profile rebuild.
- **S7.** Your wedge lofts. → a profile rebuild.
- **S8.** Optional: fix two Shot Pattern mis-tags at the source. Lake Arrowhead 9/12 hole 8 reads
  "9i · 287 yds"; Hampton 9/20 hole 6 reads "Unknown Club · 86 yds".

Profile rebuilds follow the refresh workflow in `docs/HANDOFF-NEXT.md`.

---

## Code (C), in order

| # | Build | Waits on | Model |
|---|---|---|---|
| C1 | The "why" line on the map | nothing (R1 answered: Full) | Opus |
| C2 | Course shapes on the satellite map | R2 | Sonnet |
| C3 | Aim for the pattern, and the Line drawn on its own | R3 | Opus |
| C4 | Heads-up + aim warning | C3 | Opus |
| C5 | Ironwood test-mode dead end | nothing | Sonnet |
| C6 | Retry an empty OSM answer | R7 | Opus |
| C7 | Profile: rough distances + the 41-ft putt step | R5, R6 | Sonnet |
| C8 | Short / long miss model | Q1 | Opus |
| C9 | Fairway bunkers as "no hero" lies | nothing | Sonnet |
| C10 | Re-tune the `STRATEGY` thresholds | a round of F7 notes | Opus |
| C11 | Chicopee imagery switch | R4 | rides with C2 |
| C12 | Chicopee hand-trace, Village + Mill | S4 | Opus |
| C13 | Woodmont calibration | F9, Q3 | Sonnet |
| C14 | History data | S1–S3, Q2 | Sonnet |
| C15 | Woodmont trace → OSM | C13, R8 | Sonnet |
| C17 | Smaller rings: 80% + best 30%, good shots only | nothing (R11 answered: split) | Opus |
| C18 | Pinch to zoom on the caddie map | nothing | Opus |
| C19 | Remove `Enter yards` | nothing (R10 answered: remove) | Sonnet |

Details for each are under **Build details** below.

## Parked (P): don't start without Brett
- **P1.** Native wrapper or keep-screen-on toggle for the trail (declined, D84). Revisit only if
  the gaps hurt on a real walk (R9).
- **P2.** Talking through a hole to fill in the shots. Wait until Notes have been used for a couple
  of rounds.
- **P3.** The app reading Notes. Today the Golf project chat reads them from the shot-log export.
- **P4.** An ArcGIS developer key for the Esri imagery. It works without one today.
- **P5.** Google Map Tiles: needs a Cloud key and billing, and Google's terms forbid offline prefetch.
- **P6.** Deep rough as a lie type. An engine change; the rough data is stored but unread (D85).
- **P7.** "Leave it below the hole" approach notes from StrackaLine slope maps. Unscoped.
- **P8.** Rough dispersion patterns. Stills are in `data/raw/2026-10-04/rec-*`, but
  `scripts/fit-ell80.py` fits fairway only.
- **P9.** Spec Loop's map from another golf app's screen recording. Needs the video as a file (the
  cloud blocks YouTube). D81 already rebuilt the map from Shot Pattern recordings, so confirm it is
  still wanted.

## Never closed from `HANDOFF-NEXT.md` (low priority)
Broadie baseline checked against the book (D1–D2) · Overpass / Open-Meteo field names and CORS ·
MapTiler offline-caching terms (D19) · iOS PWA geolocation on first run · D31 target clamp (`Plays`
doesn't move on a distance nudge) · finesse carries for GW / SW / LW · Ironwood OSM tracing (prompt
handed to Brett Sep 29). Pencil-filter performance on the phone is now checked in F5.

**Presumed closed:** the wrong fonts Brett saw around Sep 28. v21.4 fixed the known cause (the
service worker answered font requests with `index.html`); reopen only if it comes back.

---

## Build details

### C1. The "why" line on the map (R1: Full, Brett Oct 4)
- **What exists:** every recommendation carries `strategy`, the rules that moved SAFE (`par`,
  `no-hero`, `driver`, `pin-front`, `pin-middle`, `pin-back`). The shot log stores it; no screen
  shows it. Details shows one stat line per club from `reasons.js` ("7i: 4.2° spread, 22% short
  (n 18)"), which describes the club, not the decision. `withinRound()` (`learning.js`) writes
  today's adjustments ("Short 2× with irons (4, 7) → club up"), shown only in Details.
- **Build:** one printed line under the club card on the map, always visible; full detail stays in
  Details. Built only from resolved fields in the `reasons.js` style, never free text. C4's heads-up
  later becomes this line's last clause, not a second line.
- **Drafts to react to:** "7-iron to the middle: back pin, and you finish short 1 in 3." ·
  "Driver: the 2-hybrid finds trouble just as often and leaves 30 yds more." · "Punch out: from
  the trees, nothing reaches the green 9 times in 10." · "Clubbed up: short with irons on 4 and 7
  today."
- UI change: `src/theme.jsx` only; `docs/HANDOFF-design-NEXT.md` if a design thread is wanted.
  Bump BUILD and CACHE.
- **Done when:** every SAFE with a non-empty `strategy` shows its line, and tests in `src/caddie/`
  pin the wording per rule.

### C2. Course shapes on the satellite map (R2; about a day)
- Every hole's fairway, green, tee, bunker, water, rough and tree outlines are already loaded. Only
  the no-tiles paper map draws them. Draw them as tinted layers over the satellite in
  `src/caddie/mapLayer.jsx` and `overlay.js`.
- **Muted style:** fairway light green at ~35% with a crisp edge · green brighter, more opaque, white
  edge · bunkers sand, mostly opaque · water blue with a darker edge · tees tinted by the tee played,
  where OSM tags them · tree lines a dark band along the wood edge (no cartoon tree dots) · rough no
  fill, since the photo shows it and a fill hides the lie. One short fade when a hole opens; nothing
  keeps moving. A **Shapes** toggle on the map.
- The shapes are only as good as the geometry: Ironwood has none, and Chicopee and Woodmont improve
  with C12 and C13.
- No engine or scoring change. Bump BUILD and CACHE.

### C3. Aim for the pattern (D77 item 1; R3)
- The engine aims approaches and lay-ups at the target and lets the pattern's lateral offset carry
  the ball off it. Oct 4 fairway offsets (`ell80.dxYds`, + = right): **8i 10.3 L · 5i 5.6 R ·
  PW 5.2 R · 6i 4.1 L · 9i 2.2 R**.
- **Build:**
  1. `generateCandidates` (`src/caddie/engine.js`): shift approach and lay-up aim points by −dx
     when |dx| ≥ `PATTERN_AIM_MIN_YDS` (2). The label stays on the finish target ("green, center").
     Corridor candidates already sweep the fairway; leave them.
  2. Store `aimOffsetYds` on the shot record. `deriveResult`, `withinRound`, `applyShotLog` and
     `tendencies` measure misses against the finish target (aim + offset). Otherwise an on-pattern
     shot reads as a miss and the loop teaches the bias away (D61, D77).
  3. `overlay.js`: centre the ellipse on the finish target and draw the aim point separately.
  4. Wind (R3): the simulation pushes the ball by the crosswind and the engine outputs
     `aimOffsetYds = −crossYds`, but no screen reads it and the drawn ellipse leaves wind out. With
     wind in, the overlay needs the cross drift too.
  5. **The Line on its own** (Brett, Oct 4: "a way for the target line to automatically appear at
     the suggested target line based on my data and stats"). The map already draws ball → target
     and target → pin. The `Line` tool (the start-line ray, D60) only appears when he taps it. With
     a recommendation showing, draw the start line from the ball through the aim point (pattern +
     wind offset from steps 1 and 4), lighter than a line he sets. Tapping `Line` still moves it.
     An untouched auto line is NOT logged as his intent (`startLine` stays null), so the learning
     loop never reads the caddie's line as his.
- **Tests:** an 8-iron to a centre target aims ~10 yds right and its mean landing sits within 2 yds
  of centre; an on-pattern shot logs a ~0 lateral miss; the ellipse is centred on the finish target;
  the auto line runs through the aim point and an untouched one logs `startLine: null`.

### C4. Heads-up + aim warning (after C3)
Write a one-page spec first (when each one fires, the wording, the shot counts) and get Brett's
reaction before any code.
- **Heads-up:** for SAFE's club, one clause on the C1 line when a pattern is strong: "Driver: 3 of 4
  left today, aim right-center" · "From 100: you finish short 34% of the time". Silent otherwise.
  Today's pattern speaks only after 2–3 shots agree; otherwise the 10-round history does, and only
  with ≥ 10 shots for that club. It never contradicts SAFE: "aim right" means the map aims right (C3).
- **Aim warning** (queued since v22.16; D68, D77): when Brett's own target or line differs from the
  recommendation, re-run the dispersion simulation at his target and line. Warn when expected trouble
  is 10+ points worse, or when his club's bias from `tendencies()` (`learning.js`) carries the ellipse
  centre off the green. Only with n ≥ 10 for that club. One line in the `reasons.js` style;
  dismissable; never blocks logging.
- Both read logged shot ends, never assumed ones (D87). F6 is what feeds them.
- **Tests:** replay the Oct 3 Chicopee round and check each heads-up against what happened. Bump
  BUILD and CACHE.

### C5. Ironwood test-mode dead end (needs nothing from Brett)
- **Symptom:** at Ironwood, test mode shows blank paper and a tap does nothing. Setup reads
  `Satellite: no course location to test`.
- **Cause:** `courseAnchor(course)` (`src/app.jsx`) takes `course.lat/lon` from the golfcourseapi
  entry's `location`. Ironwood's routing entries (`sd1vw3ps` Lakes/Ridge, `r36gcyc6`, `cb45aras`, …)
  have `latitude: null`; only the club entry `c2qw5c2h` has one: **39.9465811, −85.9787805**.
  Ironwood has no OSM holes either, so nothing turns a tap into a fix.
- **Do:** give Ironwood's entry in `src/localCards.js` a `location` and make `courseAnchor` fall back
  to it. For any course still without an anchor, replace the dead tap with one line: `No course
  location — use Enter yards, or test on a mapped course`. Add tests for the fallback. Bump BUILD and
  CACHE.
- **Done when:** at Ironwood the first test-mode tap becomes the ball, and the Setup line no longer
  says "no course location".

### C6. Retry an empty OSM answer (R7)
- `useCourseMap` (`src/app.jsx`, ~L217–292) caches a `no-holes` answer with no expiry, and
  `no-holes` has no retry (D73). A club mapped in OSM later stays blank on phones that already
  opened it. This applies to every club, Ironwood included.
- **Do:** don't cache an empty answer (or expire it), and put a Retry on the `no-holes` line. A club
  with nothing in OSM still lands in marked-green mode. Add a test. Opus, because it changes
  `useCourseMap`'s state flow.

### C7. Profile: rough distances + the 41-ft putt step (R5, R6)
- **Rough:** today a rough lie plays the fairway median × `LIE_DIST_ADJ_FAMILY`
  (`src/caddie/config.js:96`: wedge/short +2%, mid −4%, long −8%). The measured medians sit unread in
  `src/profile.json` at `clubs[].entries.full.rough.extra.shotDistances`:

  | Club | Fairway | Model (≈) | Rough measured | n |
  |---|---|---|---|---|
  | 4Hy | 227 | 209 | 205 | 6 |
  | 5i | 207 | 199 | **186** | 6 |
  | 7i | 182 | 175 | 181 | 3 |
  | 8i | 169 | 172 | **179** | 4 |
  | 9i | 152 | 155 | 151 | 4 |
  | PW | 134 | 137 | 135 | 9 |
  | GW | 119 | 121 | **131** | 3 |

  R5's lean: use the measured median where n ≥ 5 (4Hy, 5i, PW), shrunk toward the model with
  `SHRINK_K` 5, the same rule D85 applies to the approach buckets.
- **Putting:** 16–24 ft 10% (4/40) · 25–40 ft 15.2% (5/33) · **41+ ft 70% (7/10)**. The 41+ step
  drives par-5 lay-up pricing. R6's lean: (10 × 0.70 + 5 × 0.152) / 15 ≈ 52%. Revisit if Tangent's
  longer history gives counts.
- `src/profile.json` is generated: change `scripts/build-profile.mjs` (or the engine, for rough; pick
  one and record the D-number), run `npm run build:profile`, then `--check`.

### C8. Short / long miss model (D77 item 3; Q1)
- Shot Pattern measures approach proximity and leave zones against **its target, not the hole**:
  130 of 159 approaches across 8 rounds finish a different distance from each (Oct 3 hole 14: 7 ft
  from the target, 42 ft from the hole). D77 assumed the pin, which is wrong.
- **Leave zones**, short / long share of misses (`data/extracted/2026-10-04-screens.json` →
  `approach.leaveZones`): 9i 75/25 · PW 83/17 · GW 80/20 · SW 78/22 · LW 64/36 (short irons and
  wedges miss short); 6i 27/73 · 7i 33/67 · 8i 30/70 (mid irons miss long); 5i 58/41; 2Hy and 4Hy
  have too few shots.
- **`shortPct`** (finishing > 10% short): 2Hy 50% · 4Hy 33% · PW 29% · GW 19% · 5i–6i 8–9% ·
  7i–9i 0%. The engine's symmetric normal (5–6% of carry) gives ~2–5%. D85 zeroed `dy` because the
  centre's shortfall is already in the travelled-yards median, so the centre is handled; the tail
  may not be.
- **If Q1 = "I put the target where I aim":** per club, compare the model's P(> 10% short) with the
  observed rate. Where the gap holds (likely PW, GW, 2Hy), add a short/long tail in
  `simulateCandidate` (`src/caddie/engine.js:389`): probability = observed − modelled, depth 10–20% of
  carry, both config values marked uncalibrated. Then see whether the pin rule's ½-stroke guard can
  tighten.
- **If Q1 = "the app places it":** the split is contaminated. Park C8.

### C9. Fairway bunkers as "no hero" lies (D77 item 2)
- Today the 9-in-10 rule covers trees and bad or buried rough. Add sand, **fairway bunkers only**:
  define one as more than ~40 yds from the green, or not touching the green's surround. Pick one
  definition and record it.
- The punch-out fallback must never aim away from the green.
- **Tests:** a fairway bunker with water ahead triggers the rule; a greenside bunker doesn't.

### C10. Re-tune the `STRATEGY` thresholds (after a round of F7 notes)
Every rule is uncalibrated (D76, D78). The knobs, in `STRATEGY` (`src/caddie/config.js`):

| Knob | Now | What it sets |
|---|---|---|
| `maxCostStrokes` | 0.5 | How much a guide rule may cost, by the engine's price, before Brett's numbers overrule it |
| `maxExtraTrouble` | 0.05 | How much extra trouble the pin rule may add |
| `clubUpShortWeight` | 2 | How much worse a short finish counts than a long one |
| `attackClubs` | PW GW SW LW | The only clubs that may aim at a middle flag |
| `noHeroMaxTrouble` | 0.10 | The guide's own "9 in 10"; keep unless Brett says otherwise |

- Re-run the coverage sweep on Woodmont, Chicopee and the Hampton fixture: `recommend()` at 90 / 120
  / 150 / 175 yds, three pins, fairway / rough / trees, rules on vs all off. Report how often each rule
  fires, its median cost and the change in trouble (Oct 3: the rules moved SAFE half the time, at a
  0.12-stroke median, with trouble down). Keep it as `scripts/strategy-sweep.mjs` only if Brett wants.
- Check the D76 × D78 interaction: does the pin rule still change SAFE as often now that SAFE is
  par-ranked?
- Each change gets a decision row.

### C11. Chicopee imagery (R4)
`imagery.url` in `src/localGeometry/chicopee.json` (the Wayback release number is in the path; A is
49059), plus a `version` bump. Ride along with C2.

### C12. Chicopee hand-trace, Village + Mill (S4)
- The current trace is automatic segmentation (D74 v2): rough and cart paths show as trees inside the
  ellipse.
- **Method learned Oct 3:**
  - Georeference each screenshot by hand, using control points: the OSM greens, bunkers and tee boxes
    already in `chicopee.json` line up with the imagery. Automatic matching against Esri (SIFT / ECC)
    failed, because Apple and Esri imagery look too different. Use 3+ features per hole and check the
    residual; a 2-point tee + pin fit was ~9% off in scale.
  - Scale cue: the white tee → target → pin line carries yardages (e.g. 287 yd + 80 yd); about
    5 px/yd at the native 1206-px width.
  - Mask the UI (top bar, tool columns, bottom pill, target button, labels, numbered circles). Never
    trace under it.
  - Per hole: fairway outline, playable-turf edge (where the trees start), bunkers, water, OB where
    visible, green edge. Everything outside the turf edge near the hole is trees.
  - Write into `chicopee.json` and bump `version` so the phone's cache refreshes once. Keep the 27 hole
    ways' OSM `id`s so hole keys and the saved nine map don't change. The School nine stays as is.
  - Check with a node script: build all 18 holes (`buildHole`) and run `recommend` from each tee; SAFE
    should land on fairway. Render an overlay sheet per hole for Brett to check before shipping.
- Pilot Village 1 and show Brett the overlay before doing the rest.
- **Done when:** Brett confirms on the phone that the red hatching inside the ellipse is only real
  trees and hazards on every Village and Mill hole.

### C13. Woodmont calibration (F9, Q3)
- **State:** `src/localGeometry/woodmont.json` (v22.16.3, D73) holds 18 holes, 18 greens, 58 tee boxes
  (40 are estimated ovals, `q: est`), 17 fairways, 44 bunkers, 2 lakes and 9 creek stretches; no OB,
  no trees. It was traced from Esri imagery (stated accuracy 8.47 m) and has never been checked on a
  phone; since v22.17.3 the app shows it over that same Esri photo (D88). `shiftM` [east, north]
  metres moves the whole trace; bump `version` to replace the
  phones' cache entry (stamped `local: "tnw4ghn5@1"`).
1. **Offset:** from the round's shot-log export, compare the fixes logged on each green (and tee) with
   the polygons. Take the median east/north offset over the 18 holes, put it in `shiftM`, set
   `version` 2. Check whether History's export includes the trail (`bogeyman-matches:trail:v1:{roundId}`).
   If GPS says the trace is right and the tiles disagree, that's the tile provider's offset: tell Brett
   before shifting for it.
2. **Tees:** 8, 15 and 18 are the least certain. After the shift, refit the ovals from the first-shot
   fixes, or retrace from a summer Wayback capture.
3. **OB and trees:** OB comes only from a `leisure=golf_course` boundary, and OSM's cuts through holes
   4 and 7. `src/localGeometry.test.js` expects the "no boundary — OB off" warning, so adding a
   boundary updates that test. Get Q3 answered before tracing.
- **The tracing pipeline** is saved in `scripts/woodmont-trace/`; its README gives the order, and
  `register_wayback.py` is the leaf-on step. A retrace starts there.

### C14. History data (S1–S3, Q2)
- **Q2, card totals:** if a card is wrong, fix `scores` / `cardTotal` in `src/seedRounds.js` (for
  Beachwood also `data/extracted/rounds/2026-09-02-beachwood/shots.json`, then `npm run import:shots`).
  Re-run the `seedMatch` test and report any W/L/T change. `gross` (GHIN's adjusted) stays. Woodmont
  6/27 (85 vs 84) and 6/17 (81 vs 80) need nothing: GHIN's hole caps explain them.
- **S2, older GHIN rounds:** add them to `data/extracted/2026-09-30-ghin-scores.json`
  (`beforeJune: true`). The test `SEED_ROUNDS: ghostDiff is the last-5 …` (`src/seedRounds.test.js`)
  derives `ghostDiff`; today 6/17 is 10.5 (W 4.5–3.5, ghost 84) and 6/21 is 9.5 (W 7.5–0.5, ghost 82).
  Update the `seedMatch` table and tell Brett if either result flips.
- **S3, two new cards:** Bear Slide 6/10 (Blue, 72.3 / 134, posted 84, diff 9.0, `gross` 83) and Cider
  Ridge 6/6 (II, 71.7 / 130, posted 82, diff 8.1, `gross` 81) as `SEED_ROUNDS` entries in the existing
  shape. Take `strokeIndex` from golfcourseapi after checking the pars hole by hole, as D72 did.
  Tests: `SEED_ROUNDS.length` 12 → 14, the GHIN-per-date map, the `seedMatch` table, the 6–4–2 tally.
  The ghost must not move, since only the five newest seeds reach the last-5.
- **S1, shot lists:** the routine and conventions are in `docs/HANDOFF-NEXT.md` ("Routine for each").
  Reconcile every hole to the card in `src/seedRounds.js` (7/17 to 80 unless Q2 changes it). Check a
  recording isn't a repeat first: two of Oct 1's five were the 8/15 round again. Two parallel
  subagents, one round each, worked well; the check is `holesShort: []` plus strokes-gained sums that
  match the Summary tab. Data-only commits don't bump the build tag.

### C15. Woodmont trace → OSM (C13, R8)
The trace converts to OSM ways (`golf=hole`, `green`, `tee`, `fairway`, `bunker`). Check OSM's terms
for tracing from Esri imagery and its import and automated-edit guidelines, and review each feature by
hand. The app keeps using the bundled file until Woodmont leaves `LOCAL_GEOMETRY`.

### C17. Smaller rings: 80% + best 30%, good shots only (Brett, Oct 4; R11: split, Brett Oct 5)
- **Brett, Oct 4:** "The dispersion circles are just too crazy. Too big & oddly shaped." Two rings:
  the 80% ring, and an inner ring for his best 30%. "The caddy [should] automatically ignore any
  shots that are not within 20 yards of the iron's target distance," and the distance should be
  "based on accurate data, but slightly skewed toward above average."
- **Today:** the 7-iron's 80% ellipse is 64 × 35 yds, tilted 34° (Shot Pattern's fit, n 10);
  the others tilt 58–151°. The driver has no fitted ellipse; its 6.3° spread gives an 80% ring
  ~114 yds wide. The tilts are what make the rings look odd.
- **Build** (R11, Brett Oct 5: split them out, not ignore them):
  1. Per club, split the shots: **good** = within 20 yds of the club's distance; the rest are
     mishits. The Shot Pattern stills show each shot as a dot, so `scripts/fit-ell80.py` can read
     the dots, drop the mishits, and refit the ring on the good shots. Loop's own logged shots add
     to it later.
  2. The club's distance = the median of the good shots. Mishits pull today's median down, so this
     lands slightly above it, which is Brett's "skewed toward above average".
  3. The engine draws from the good-shot pattern, plus a mishit at its measured rate (a new
     `mishitRate` per club, built by `scripts/build-profile.mjs`), so a topped 7-iron still costs
     what it costs.
  4. Draw two rings: 80% (outer) and 30% (inner, √(−2 ln 0.7)σ ≈ 0.47× the 80% ring), from the
     good-shot fit.
- Profile rebuild: `npm run build:profile`, `--check`. Engine change: a D-number. Bump BUILD and
  CACHE.
- **Check first:** whether the stills' dots can be read reliably at the batch's resolution. If
  not, S5/S6-style data (per-shot carries) is the fallback.

### C18. Pinch to zoom on the caddie map (Brett, Oct 4)
- Gestures are off on purpose (`interactive: false`, `src/caddie/mapLayer.jsx`; addendum §4.1),
  so one finger drags the target and the pin without moving the map. Only marked-green mode turns
  them on.
- **Build:** two-finger pinch zooms (rotation and one-finger pan stay off); a double-tap or a `Fit`
  button returns to the hole view; the overlay re-projects on every move; a new ball resets the
  camera as today (T36). Test that the target drag, Line taps and pin drag still work at any zoom.
  Bump BUILD and CACHE.

### C19. Remove `Enter yards` (R10: Brett, Oct 5, "remove it entirely")
- `Enter yards` lets Brett type the distance when GPS is off or wrong; the caddie then picks a club
  from the profile alone, with no map (club-brain mode, the `yards` view, §8). Brett: remove it
  everywhere.
- **Do:** drop the rail's `Enter yards` (`rail.action` in `caddieView`, `src/caddie/caddieState.js`),
  the `nofix` / `locationoff` bar's secondary, the yards sheet in `src/app.jsx`, and the `yards`
  view. Keep any saved round in the `yards` phase loading (it falls back to pre-tee). Update the
  tests that expect it.
- **What he gives up:** with no GPS fix, or GPS off, the caddie has no club call at all; `Retry`
  is the only action. Marked-green mode (no map, GPS working) is unaffected.
- Bump BUILD and CACHE.

---

## Environment notes (cloud sessions)
- `unpkg.com`, which `./build.sh` uses for React, is blocked. Run `npm pack react@18.3.1
  react-dom@18.3.1` and copy each `package/umd/*.production.min.js` to `build/react.min.js` /
  `build/react-dom.min.js`.
- `api.golfcourseapi.com` is allowed. `overpass-api.de` was blocked on Oct 1. YouTube is blocked, so
  attach videos as files.
- Brett tests in the home-screen app, not Safari. Safari keeps separate storage.

## Rules (from CLAUDE.md)
- Never touch `computeGhost` / `evalMatch`; run the byte-identical check before every commit.
- Never rename the `bogeyman-matches:*` keys. `index.html`, `src/profile.json` and
  `src/shotpattern.json` are generated.
- A user-facing change bumps `BUILD` (`src/app.jsx`) and `CACHE` (`sw.js`) together.
- Show a diff and wait for Brett's "go" before committing or pushing. Merging is a separate "merge".
- One code chat at a time on `src/app.jsx`. Decisions continue at D91.
- Brett's style: one or two short steps at a time, recommendation first.

## Paste into the next chat
> Open Loop-Golf. Run `git status`, `git log --oneline -3`, and `npm install && npm test` (329 pass).
> Read `CLAUDE.md`, `docs/HANDOFF-NEXT.md`, then `docs/OPEN-ITEMS.md`. Start with C1, the "why" line;
> if R1 is still open, ask me first. Show me the plan before any code. Delete each item from
> `docs/OPEN-ITEMS.md` in the commit that closes it.
