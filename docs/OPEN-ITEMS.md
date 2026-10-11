# Loop — open items (merged Oct 4, 2026)

The one list of everything still unresolved. It merges the eleven Loop chats open on Oct 4: seven
spec sheets and four answers given in chat, plus Brett's notes from a short test round on the
morning of Oct 4 (C17–C19, of which C17 shipped in v22.21, and an addition to C3, which shipped in v22.22),
Brett's test notes of Oct 10 (C20–C29), and his notes from the first Bradshaw Farm round, Oct 11 (C34–C44; screenshots in `data/raw/2026-10-11/`). Duplicates are merged and anything already shipped is
dropped. State: **v22.55** (C45, D126; v22.54 = D125; v22.53 = C44, D124; v22.52 = C43, D123; v22.51 = C42, D122; v22.50 = C41, D121; v22.49 = C39, D120; v22.48 = C38, D119; v22.47 = C37, D118; v22.46 = C36, D117; v22.45 = C34, D116; v22.44 = C35, D115; v22.33–v22.43 = D104–D114; v22.32 = C6, D103; v22.31 = C5, D102; v22.30 = C19, D101; v22.29 = C21, D100; v22.28 = C2 + C11, D99; v22.27 = C18 + C20, D98; v22.26 = C30, D97; v22.25 = C26–C28, D96; v22.24 = C31, D95; v22.23 = C23, D94; v22.22 = C3, D93; v22.21 = C17, D92; v22.18 = C1, D91; v22.17.4 = C16, D90), 427 tests, decisions D1–D126; the next
decision is **D127**.

Read `CLAUDE.md` and `docs/HANDOFF-NEXT.md` first. When an item closes, delete it here in the same
commit. Not covered: claude.ai chats outside Claude Code (e.g. the Golf project chat).

IDs: **Q** a question only Brett can answer · **R** a recommendation waiting on Brett's OK ·
**F** a check on the course · **S** something Brett sends · **C** a code build · **H** housekeeping ·
**P** parked.

---

## Start here

1. **Next code chat:** the Oct 11 notes, in order (C34–C39 and C41–C44 shipped in v22.44–v22.53); C40 has a draft and waits on S10. Older items wait on Brett (S10 → C40, F7 notes → C10, S4 → C12,
   F9 + Q3 → C13, S1–S3 + Q2 → C14; C33 once chips are logged).
2. **Next round:** the **F** list.

---

## Brett

### Questions only you can answer
- **Q2.** Two card totals disagree with GHIN. Beachwood 9/2: 84 (card) or 86 (GHIN)? Chicopee
  Mill/School 7/17: 80 or 81? → C14.
- **Q3.** Woodmont: which holes have OB, and on which side? → C13.

### Recommendations: all accepted Oct 10 ("go with the leans")
R2 muted course shapes plus a Shapes toggle (C2) · R4 leaf-off Chicopee imagery, Wayback 49059 (C11)
· R5 measured rough distances where n ≥ 5, shrunk toward the model (C7) · R6 the 41+ ft three-putt
rate shrunk to ~52% (C7) · R7 retry an empty OSM answer (C6) · R8 the Woodmont upload to OSM later,
after C13 (C15) · R9 no native app for now (P1). Q1 answered the same day (C8).
- **R10.** (Oct 11, waiting on Brett) Green slopes from free USGS 3DEP lidar: Loop draws its own
  green-reading arrows. The elevation half shipped in v22.45 (D116): the five mapped clubs carry a 20 m
  3DEP grid (`scripts/fetch-3dep.mjs`; 1 m lidar covers all five). Arrows need a finer grid on each
  green (~2 m). A large build; would become its own C item.
- **R11.** (Oct 11, waiting on Brett) Teach the caddie the Oct 11 screenshots too. Since v22.55 (D126) the map
  draws them, but the caddie still prices the Driver, 2-iron, 2-hybrid and 4-hybrid from the Oct 10 view
  (Driver 35 drives against the 117 now shown; 2-hybrid 7 against 12). Refitting moves club picks and par
  chances; measure the change first, as D117 did.

### On the next round (F)
- **F1.** Fully close and reopen Loop. Setup's build tag reads **v22.53 · Oct 11** (once merged).
- **F36.** The climb to the target (v22.53, D124): under To target the rail reads "7 yds down", "4 yds up" or
  "level" — the rise Plays already counts for that shot (USGS lidar on the five mapped clubs). Say if it disagrees
  with what you see.
- **F35.** Scoring from the caddie (v22.52, D123): on the green, `Score hole` opens the card with your logged shots and
  putts already crossed in ("Logged: 3 shots + 2 putts · tap 5 to keep"). One tap on it writes it; tap another number
  to change it. Leaving the hole without a tap doesn't write it. Log your putts first, or the count comes up short.
- **F34.** The Shots / Review map (v22.51, D122): it opens on the shot you open (its ball, end and target), pinch to
  zoom, one finger moves it, `Fit` (top-right) puts it back. Place and the target drag still work.
- **F33.** Tee boxes in their colours (v22.50, D121): with Shapes on, each tee box is tinted the tee whose card yardage
  its distance to the green matches (within 20 yds): gold, blue, white, red. A box with no match keeps the plain green.
  Only rounds started on v22.50 or later (the round keeps every tee's yardages from Setup). Say where a box has the
  wrong colour, with the hole.
- **F32.** Sharper photo (v22.49, D120): tee shots and approaches out to ~150 yds now draw Esri's finest photo (level
  19), which was already saved on the phone; before, those views drew level 18. Close-ups look the same: Esri has
  nothing finer at your clubs. Say whether the tee and fairway views look clearer.
- **F31.** Ball at the bottom, target up (v22.48, D119): once you're past the tee, the map turns so your ball sits at
  the bottom centre and the caddie's target is straight up; on the green the hole is straight up. Before the tee
  shot it's still tee at the bottom, green at the top. Say if a turn ever makes a hole hard to read (a dogleg, a
  ball behind the green).
- **F30.** The map (v22.47, D118; replaces F15): drag one finger anywhere off the yellow target and the map moves with
  it; pinch to zoom. `Fit` now shows top-left, under the To Pin box, and puts the shot back (a new ball does too).
  Press and hold the target to drag it, as before; a quick swipe that starts on it moves the map instead. Say
  whether panning ever grabs the map when you meant to move the target, or the other way round.
- **F29.** Rings and your worst 20% (v22.46, D117): the ring is 20 yds deep (10 either side of the club's average) and
  as wide as your best 65% side to side — PW ~16 wide, 4-hybrid ~48, Driver ~47. The outer ring is dashed now, the inner solid. The dots are every shot the caddie still
  counts; it now ignores the worst 20% of its simulated shots, so par chances read ~6 points higher and Safe is bolder
  (fewer punch-outs; off the tee 2-iron ↔ Driver swaps on ~1 in 5 holes; from ~230 the 4-hybrid over the 2-hybrid).
  Say whether the rings look like your good shots, and note any call that now feels too bold, with the hole.
- **F28.** Wind and slope (v22.45, D116): the wind on the Plays badge is now two-thirds of the forecast
  (a 12 mph forecast reads 8). Set the Wind chip when it feels different; the chip counts in full. Each shot
  now gets its own climb or drop: off Red 2's tee the green's 19-yd climb no longer shortens the drive, and
  on the five mapped clubs the slope comes from USGS lidar. Note any call that still feels a club off, with
  the hole and the wind you felt.
- **F27.** The ring sits on the target (v22.44, D115): into or with the wind, the caddie's yellow target and
  its rings should sit together on every call off the tee and from the fairway. An approach can still show a
  ring short of the pin when no club gets there (from 230 into the wind), and so can a Custom target past the
  club's reach. Off a long par-5 tee, Aggressive is a real shot (no Driver aimed 340 out).
- **F18.** From the rough (v22.33, D104): the caddie now plays your rough totals, not the fairway
  ones plus extra roll. A 5-iron finishes ~192, the 4-hybrid ~207, a 7-iron ~175, a PW ~136. Note any
  rough call that feels a club off.
- **F19.** From a fairway bunker (v22.34, D105; sand more than 40 yds from the green's front): the
  caddie now stays out of trouble 9 times in 10, so expect more lay-ups. Say if one feels too timid.
- **F26.** Bradshaw Farm (v22.43, D114): pick the club, then the two nines the starter gives you (any order).
  The caddie should open on hole 1 with no `Course holes` screen. On White 3 and White 4 (traced from the photo,
  not OSM), check the green's front / back numbers against a sprinkler head or the pin sheet.
- **F24.** In-round nudges (v22.41, D112): the why line still says "short with mid irons on 3 and 6
  today", but the club, target and line no longer move for it. Say if you miss the old club-ups.
- **F23.** The short-game card (v22.40, D111): just off a green the why line shows your up-and-down
  and leave for the lie; log the shot as Chip, Pitch, Bunker or Wedge, and log the putts after it
  (C33 needs them).
- **F22.** The heads-up and the aim warning (v22.39, D110): when a club misses the same way 3 of its
  last 4 today, the why line says so; move the target or draw a Line toward trouble and it says how
  often ("water 1 in 4 (Loop's call: 1 in 12)"). Tap the line to hide that for the shot. Say
  whether either one changed what you did.
- **F21.** The start line (v22.37, D108): the shape chips open on your usual shape (driver Fade, 5–8
  iron Draw …) and the dashed line starts the curve's width to the other side (driver 15 yds left).
  Say whether each club's line looks like where you'd start it.
- **F20.** History → `Misses by club` (v22.35, D106): after a round with marked ends, check each
  club's "2 short · 3 R · off by 7" against how the round felt.
- **F14.** Approach clubs (v22.23, D94): every shot now finishes at its total. From 195 on a warm day
  the call should be a 6-iron; from 207 a 5-iron. Note any call that still feels a club off.
- **F13.** The caddie's line (v22.22): a dashed line from the ball through where to aim; the yellow
  ring and both rings are where the ball should finish. Start the ball on the dashed line, or tap
  `Line` and draw your own; Loop learns from whichever you used. Report whether the 8-iron (aims
  ~7 R) and PW (~5 L) finish where the ring says, and whether the crosswind aim (~12 yds into a
  10 mph wind at 150) looks right. SAFE gets bolder in wind (D93).
- **F11.** Read the new line above the action button on every call. When it says something that
  doesn't match what you'd do, dictate a Note (F7) with the line's exact words.
- **F2.** The putting flow, start to finish (v22.25, D96: `Missed · next putt`; the first putt's
  length from your ball to the pin). It has never been used on a course.
- **F3.** Log a hole you skipped: Place shot 1 → Place shot 2 → … → Done.
- **F4.** The GPS trail on a real walk. It records only while the screen is on.
- **F17.** The dots in the ring (v22.29, D100): where 40 of the caddie's simulated shots finish.
  The rings now sit where the club's average shot finishes, which can be a few yards past or short
  of the yellow target. Say whether the dots match where your shots go.
- **F16.** Course shapes (v22.28, D99): muted tints over the photo; `Shapes` turns them off. Where a
  tint disagrees with the photo (trees over a fairway, a bunker in the wrong place), that is what the
  caddie believes: note the hole. Chicopee is on its leaf-off photo now.
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
- **S5.** The Driving tab's landing zones (Casual · Last 10). The tee dispersion screens arrived
  Oct 10 (S9). → a profile rebuild.
- **S6.** A launch-monitor range session: carry for every club, the 2-iron partial, and wedge ½ and
  ¾ swings. → a profile rebuild.
- **S7.** Your wedge lofts. → a profile rebuild.
- **S10.** Bradshaw's missing fairway (C40): a screenshot with the spots circled, or a yes / no per hole on the
  review sheets in `data/raw/2026-10-11/c40-review/` (cyan = what the draft would add).
- **S8.** Optional: fix two Shot Pattern mis-tags at the source. Lake Arrowhead 9/12 hole 8 reads
  "9i · 287 yds"; Hampton 9/20 hole 6 reads "Unknown Club · 86 yds".

Profile rebuilds follow the refresh workflow in `docs/HANDOFF-NEXT.md`.

---

## Code (C), in order

| # | Build | Waits on | Model |
|---|---|---|---|
| C40 | Bradshaw fairways from the photo (draft in `scripts/bradshaw-fairways/`) | S10 | Opus |
| C10 | Re-tune the `STRATEGY` thresholds | a round of F7 notes | Opus |
| C12 | Chicopee hand-trace, Village + Mill | S4 | Opus |
| C13 | Woodmont calibration | F9, Q3 | Sonnet |
| C14 | History data | S1–S3, Q2 | Sonnet |
| C15 | Woodmont trace → OSM | C13 (R8: later) | Sonnet |
| C33 | Short-game bands learn from Loop's chips | a few rounds of chips + putts logged | Sonnet |

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
- **P10.** A sharper photo than Esri's (D120): Georgia's 6-inch statewide imagery is licensed to government only;
  county orthos (Cherokee's own 6-inch is from 2006) would need each county's terms; NAIP is ~1 m, worse. Revisit if a
  free source turns up.

## Never closed from `HANDOFF-NEXT.md` (low priority)
Broadie baseline checked against the book (D1–D2) · Overpass / Open-Meteo field names and CORS ·
MapTiler offline-caching terms (D19) · iOS PWA geolocation on first run · finesse carries for GW / SW / LW · Ironwood OSM tracing (prompt
handed to Brett Sep 29). Pencil-filter performance on the phone is now checked in F5.

**Closed Oct 11:** D31's target clamp (a distance nudge moving the target without moving `Plays`) — since
v22.41 (D112) in-round nudges no longer move the club, target or line (`NUDGES_MOVE_CALL: false`); reopen only if
that flag is turned back on.

**Presumed closed:** the wrong fonts Brett saw around Sep 28. v21.4 fixed the known cause (the
service worker answered font requests with `index.html`); reopen only if it comes back.

---

## Build details

### C40. Brett's first Bradshaw round (Oct 11, v22.43; screenshots in `data/raw/2026-10-11/`)
- **C40.** "Clear places the fairway exists from the satellite image that are not included." Bradshaw's
  fairways are OSM's; trace them from the photo (as Chicopee's were, D74).
  **Oct 11 overnight: a draft, not shipped.** `scripts/bradshaw-fairways/` grows OSM's fairways from the
  winter photo; the review sheets (`data/raw/2026-10-11/c40-review/`, OSM yellow, additions cyan) show
  real edges OSM drew narrow (Blue 4, 8, 9) mixed with greenish rough (White 8, left of Red 2), and on most
  holes OSM already follows the greener band. Needs Brett (**S10**): which holes, and where — a screenshot
  with the missing fairway circled, or a yes / no per hole on the sheets.
  **v22.54:** Bradshaw now flies the green Sep 2023 photo (D125); the draft and its sheets are from the winter one.

Answered in chat Oct 11: Chip / Pitch / Wedge (inside ~30 yds, Chip rolls more than it flies, Pitch flies
more than it rolls; Wedge is 30+ yds to a number and teaches that club's distance); the yellow `?` on the
Review sheet (a shot Loop logged that he hasn't confirmed); free green-reading maps (none known; R10).

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
- Since v22.46 (D117) every rule reads the best 80% of the draws (the worst 20% are dropped), so
  "9 in 10" is 9 in 10 of those: punch-outs fell from 15 to 8 of 492 tree spots. Re-run the sweep on that basis.
- Each change gets a decision row.

### C12. Chicopee hand-trace, Village + Mill (S4)
- **Village 1's 6% par** (Brett, Oct 10; D94): points on its line 150 and 200 yds out classify as
  trees, so SAFE punches out at a 10% par chance. Re-run that check after the trace.
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

### C33. Short-game bands learn from Loop's chips (C29, D111)
- Since v22.40 chips, pitches and bunker shots are logged as `shotType: "shortGame"` with a
  `shortKind`, and never teach a club's distances. Nothing learns the bands from them yet (the
  profile's 0–25 / 25–50 bands are Shot Pattern's).
- **Do:** once a few rounds of chips are logged with their putts, overlay the bands the way D85
  shrinks the approach buckets: leave (the end's feet to the hole) and up-and-down (holed in two from
  the chip, from the putt records that follow it), shrunk toward the band with `SHRINK_K`. Check
  first how often the putts after a chip are actually logged; a missing putt must not read as an
  up-and-down.


---

## Environment notes (cloud sessions)
- `unpkg.com`, which `./build.sh` uses for React, is blocked. Run `npm pack react@18.3.1
  react-dom@18.3.1` and copy each `package/umd/*.production.min.js` to `build/react.min.js` /
  `build/react-dom.min.js`.
- `api.golfcourseapi.com` is allowed. `overpass-api.de` was blocked on Oct 1. YouTube is blocked, so
  attach videos as files.
- Brett tests in the home-screen app, not Safari. Safari keeps separate storage.

## Rules (from CLAUDE.md)
- Before pushing an app change, run `node scripts/smoke-caddie.mjs` (headless Chromium; D102).
- Never touch `computeGhost` / `evalMatch`; run the byte-identical check before every commit.
- Never rename the `bogeyman-matches:*` keys. `index.html`, `src/profile.json` and
  `src/shotpattern.json` are generated.
- A user-facing change bumps `BUILD` (`src/app.jsx`) and `CACHE` (`sw.js`) together.
- Show a diff and wait for Brett's "go" before committing or pushing. Merging is a separate "merge".
- One code chat at a time on `src/app.jsx`. Decisions continue at D127.
- Brett's style: one or two short steps at a time, recommendation first.

## Paste into the next chat
> Open Loop-Golf. Run `git status`, `git log --oneline -3`, and `npm install && npm test` (424 pass).
> Read `CLAUDE.md`, `docs/HANDOFF-NEXT.md`, then `docs/OPEN-ITEMS.md`. Start with whichever item
> I've sent what it waits on (OPEN-ITEMS, the Waits on column). Show me the plan before any code, and ask me questions as multiple-choice boxes. Delete each
> item from `docs/OPEN-ITEMS.md` in the commit that closes it.
