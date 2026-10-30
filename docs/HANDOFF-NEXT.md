# Loop — start-here for the next thread

**Where to work:** a Claude Code cloud session on `brettryantalley-source/Loop-Golf`. There is no
local copy (Brett, Oct 4).

**Open items:** everything unresolved lives in `docs/OPEN-ITEMS.md` (merged Oct 4). It supersedes
"Queued builds" and "Open follow-ups" below.

## First three commands
```bash
git status                 # must be clean
git log --oneline -6
npm install && npm test    # 489 tests (v22.74); must be green
node scripts/smoke-caddie.mjs   # after ./build.sh: the caddie screen renders with no page errors
```

## v22.74 (Oct 30)

Brett's rule for the Carry chip (D149): only a shot longer than 100 yds plays short (`CARRY_CHIP_MIN_YDS`); a part swing
inside that keeps its full carry. A step at 100, his words. The plan regenerated at −10% (Blue: expected 78.1). 489 tests.

## v22.73 (Oct 30)

Crystal Falls Golf Club (Dawsonville) mapped for Brett's round there today, and the **Carry chip** (D148). **The map:** OSM has
the whole club (18 holes, pars and handicaps the card's on all 18, 76 tee boxes, 61 bunkers, 18 fairways), so the bundle's
worth is what Overpass cannot give — Yellow Creek and its feeders as water (`osm+buffer`), the club outline as the OB line,
the 3DEP grid, 18 green grids, 319 lidar woods (GA_Statewide_B3_2018), the plan offline. Esri Wayback 43291 (the current
leaf-on capture; no county photo for Dawson). `scripts/crystalfalls/convert.py`. **The chip:** a seventh chip, round-level,
`Full` or −5 / −10 / −15 % — every club that much short today; `formEffect` in `playsLike` beside temperature and
altitude, so every candidate and reach check lands on the day's carry. A shot logged while it is set is saved
`teach: false` (the round reads `Ignored` on History; one tap there teaches it) — a sore day never reaches the profile.
`scripts/gameplan.mjs --carry=-5`, and two tees sharing a box share its name (Blue = Players on 11 holes here).
`docs/GAMEPLAN-crystalfalls.md` (Blue, −5%: expected 76.9). 489 tests; smoke test green. **Watch:** the tee-box tint
names a shared box after the first tee on the card.

## v22.72 (Oct 26)

Bobby Jones's tee pads, tried and not shipped (D147). The lidar shelf finder (`scripts/bobbyjones/tees.py`) returned mounds
and bunker lips; the leaf-on photo shows the Longleaf tees mown into open fairway-height turf, so there is no pad to find
or trace, and card-derived boxes along a centreline that cuts the doglegs would be wrong by tens of yards. What it exposed
is fixed: a hole with no tee polygons measured hole detection from its line's START, so `I'm on the tee` from Tee 6 or 7
(50–95 yds up hole 1's line) would never have advanced 9 → 10. `teeStretch` (geo.js) makes the leading 60% of the line,
kept 100 m short of the green, the tee for such a hole; every other club has tee polygons, so nothing changes there.
479 tests; smoke test green.

## v22.71 (Oct 26)

Bobby Jones (Atlanta), the **Azalea** routing, for Brett's round there Oct 26 (D146). Two firsts. **A course the API does not
have:** golfcourseapi's only "Bobby Jones" is in Sarasota, so `src/localCourses.js` bundles the GolfPass card in the API's
shape — Setup's search lists it for "bobby" / "azalea" (first, and alone when the API is down) and `loadFullCourse` returns
it offline; 8 Longleaf tees, each 18 holes = the nine twice, rating = 2 × the 9-hole rating (Tee 6: 69.0 / 121), handicap
1–9 twice → odd/even. Not checked against the printed card (F50). **A nine played twice on the map:** `bobbyjones.json`
writes the Azalea lines as refs 1–9 and 10–18 (`loop: 9`) sharing nine double greens; `mirrorLoop` gives the second loop
the first's fairways, rough and hazards (parseOverpass hands each to one hole), `buildHole` keeps a hole's own green off
its neighbour list; no tee boxes (OSM has none), the line's start stands for the tee. Creeks: Tanyard's
centrelines buffered (`osm+buffer`), Peachtree Creek's OSM water area clipped (`osm+clip`). No boundary: OSM's outline
predates the 2018 rebuild (the 9th green sits outside it), OB off. Fulton County's photo + Esri 41468. 3DEP, 9 green
grids, 77 lidar woods (GA_Statewide_B2_2018). `scripts/bobbyjones/convert.py` is committed; Magnolia is a sibling run.
`docs/GAMEPLAN-bobbyjones.md` from Tee 6 (expected 75.2; from the line's start, no tee boxes). 478 tests; smoke test green.
**Watch:** two bundled files at one club would both key the club id (D141 covers only "no file for the club id") — a
Magnolia file needs that rule extended first.

## v22.70 (Oct 24)

Brett's answers to R13 and Q4 (D145). **Aggressive:** under half a point of birdie over Safe (`SAME_SHOT_BIRDIE_GAIN`)
it shows only when its target is 20+ yds longer — the Driver alternative of Oct 4 stays (28 tees), a noise-level
shorter or sideways club goes (Creekside 1's 2-iron: "Same shot both ways"). **Creekside 3:** the fairway widened to
~30 yds from 214 to 352 yds out on his word (both photos agree with OSM's 7–19), 5 yds off the lidar trees;
`q: "osm+field"`, `version` 5. 471 tests; smoke test green.

## v22.69 (Oct 24)

Brett's notes from six holes at Creekside (a PDF of screenshots). **Screens (D144):** the Shots list reads club · yards ·
the miss in words (`21 yds left`), not `GPS default on · 21 L`; the putt card's `Missed · next putt` is a full pill and
`Skip` a small word; the putt's read is its own card (`PUTT 2.6% uphill · BREAK 3.3% left to right`, 22 px numbers); on
the green with no call `cameraForShot` frames ball → pin, the pin a quarter down the visible map, up to 48 px/yd; the
options table's `Trbl` is `Trouble` (he read it as triple bogey) with a key line. **Engine (D142):** an approach that
stops short of its target (a club "reaches" at the green's front − 8) is aimed where it stops, `green, front` or `leave
N, short of the green` — Creekside 5's 8-iron aimed at the center 35 yds past its ring; on 2,460 approaches SAFE's
target moves on 17%, its club on 22. **Creekside (D143):** hole 5's back tees are the lidar's two raised pads (the
Oct 22 rectangle sat off one, the other was missing); hole 4's green is its putting surface (OSM's took in the bank, so
the arrows fanned out). Hole 3's fairway (Q4) and Aggressive's rule (R13) went to Brett; v22.70.
Answered in the reply: chip / pitch / wedge, what `GPS` / `default` / `on · 21 L` meant, the putt's pre-filled length
(ball → pin for putt 1; 3 ft after a miss). 470 tests; smoke test green.

## v22.66 (Oct 22)

Golf Club of Georgia's **Creekside** is mapped (D139), for Brett's round there Saturday Oct 24. `src/localGeometry/creekside.json`
(apiId `yx7d5vnk`; Lakeside, `mse9vsm1`, is not bundled): all 18 holes are in OSM, but the app's Overpass box (±0.02° lon
round the API point) stops at the 8th green and holes 9–13 lie west of it, so Setup would have read 13 holes. Two API 0.6
map boxes, filtered to the course (the two courses share the bbox and their hole numbers collide; told apart by par and
length against the two cards — every one matched), greens / tees / bunkers / fairways within 150 m of a Creekside line,
woods and water within 100 m; OSM's fairway multipolygons kept with their bunkers cut out. New in a bundle: the creeks
(Big Creek, Camp Creek, feeders) are OSM waterway centrelines buffered 3.5 m each side as water hazards (Woodmont's
precedent), and the club outline (relation 143014) is bundled as the boundary since every Creekside shape sits inside it —
OB is on for the first time at a bundled club. Hole 5's OSM line started 338 yds from the green of a 515-yd par 5: a mown
22 × 10 m pad with its own cart path across the creek ~100 m behind it on the back-extension is traced in as the back tee
(`q: traced`) and the line starts there (426 yds straight; not field-checked, F46). Photo: Wayback 41468 (the Sep 24 2023
leaf-on capture Bradshaw flies; Aug 2024 is dormant, Mar 2026 dormant, Apr 2026 has snow). 3DEP grid (299–345 m; the
course drops 46 m), 18 green grids, 374 lidar woods from GA_Statewide_B3_2018 (Overpass itself refused this sandbox's
connections; everything else answered). `src/creekside.test.js` (8 tests) + Creekside in the elevation and green-grid club
lists. `scripts/gameplan.mjs` writes a hole-by-hole plan from the engine (`docs/GAMEPLAN-creekside.md`, Blue tees: expected
78.7, the trouble holes 17, 18, 10, 8). Known soft spot: OSM's fairways here are short (17's covers the bottom half), so a
tee shot's landing area can read rough — C12-shaped, not fixed. 466 tests; smoke test green.

## v22.65 (Oct 12)

R12 (Brett: "r12lean", D138): the pin rule's pick also yields when it costs more than 0.15 strokes and saves under 2
points of trouble (`pinFreeStrokes`, `pinMinTroubleSaved`). The sweep: the pin rule now moves 1,026 approaches
(was 1,132), at a median 0.00 strokes. 458 tests.

## C10's sweep (Oct 12, no build)

`scripts/strategy-sweep.mjs` priced 3,529 calls on the five maps with the strategy rules on and off (D137). The rules move
SAFE on 45%; no-hero does what the guide asks (trouble −19 points from the trees at 0.06 strokes); the pin rule moves a
third of approaches and, on ~320, gives up 9–16 points of par chance for a middle target that saves no trouble. Nothing
broken, no knob moved; that trade is R12 in OPEN-ITEMS, Brett's call.

## v22.64 (Oct 12)

The short-game bands learn from his chips (C33, D136). A logged chip, pitch or bunker shot with its putts logged says
up and down or not, and the leave (putt 1's length); a hole with no putt logged after the chip, a shot missing, or a card
score that isn't the strokes logged says nothing. Per band, shrunk toward Shot Pattern's with SHRINK_K, finished rounds
only; the up-and-down from inside 50 and the short-game line read it. Silent until he logs chips. 457 tests.

## v22.63 (Oct 12)

Bradshaw's fairways where OSM drew them narrow (C40, D135). The draft re-run with the lidar trees kept out, on the
winter photo (Wayback 63116, dormant rough), since on the Sep 2023 one fairway and rough barely separate; only clear
pieces ship (`ship.py`: d′ ≥ 2.8, log-likelihood ≥ 6, ≥ 150 m², touching OSM's fairway), unioned into the OSM way.
Seven fairways (Blue 3, 4, 6, 8, 9, White 1), +6.5%; no tee call moves. `version` 6. 454 tests.

## v22.62 (Oct 12)

Lidar trees at the other four clubs (D134): Woodmont (had none), Bradshaw (all 27; D126's photo trace replaced),
Riverpines and Hampton (OSM's three pieces each kept). SAFE's tee club changes on 4 / 2 / 3 / 5 holes; par chances
drop where trees line a fairway. +557 KB of map, tee calls ~15–30% slower in node at three clubs. 453 tests.

## v22.61 (Oct 12)

Chicopee's trees from USGS lidar (C12's trees, D133). `scripts/lidar-trees/` grids Georgia's 2018 point cloud at 1 m
and keeps anything over 3 m tall within 75 m of a hole line, off the mapped turf: 344 pieces replace D74's 303
photo-segmented ones, `version` 5. Village 1's line no longer reads trees (9 of 12 points did); SAFE's tee club changes
on 3 of 27. The punch-out case in `why.test.js` moved from Village 1 to Village 8. Chicopee's fairways are still D74's
(C12 stays open for them). 452 tests.

## C13 closed by lidar (Oct 12, no build)

Brett, Oct 12: what he'd send isn't coming soon and must not hold up the builds; his GO to merge and go on with the
recommended answers. C13 without F9 (D132): `scripts/lidar-offset.py` slides each bundled map's bunkers over a 1 m USGS
lidar raster; all five clubs sit within a metre of the ground (Woodmont 0.0 m over 44 bunkers), so `shiftM` stays
[0, 0] and F9 is dropped. Woodmont's tee ovals stay (lidar can't place a tee). C15 → P11 (it publishes under his OSM
account). The Code table now runs C12 → C40 → C33 → C10 with nothing from Brett; C14 is parked until he sends S1–S3.

## v22.60 (Oct 12)

Reading the green from USGS lidar (R10, D131). `scripts/fetch-green-slopes.mjs` baked a 2 m 3DEP grid over every green
of the five bundled maps (`greenGrids`, 111 greens); `src/caddie/greenslope.js` fits a plane over the green's cells in an
8 m window (lidar noise, and no bank in the fit) and gives downhill arrows (white < 1.5%, yellow 1.5–3%, red 3%+) and the
putt's read ("Putt: uphill 1.5% · breaks left to right 3.0%"). Shown in the pin view, with the ball on the green and on
Catch up's putts. Q2 and Q3 answered (both cards stay; no OB at Woodmont). 451 tests; the smoke test checks the arrows.

## v22.59 (Oct 12)

The caddie prices from the Oct 11 club sheets (R11, D130; Brett's four answers: his real shots, Rough sheets alone, the
Driver's big misses not added again, the map's ring lined up with the aim). Every club and lie with an Oct 11 sheet draws
from his shots on it (`ell80.shots`, `shotsSampler`; the worst 20% still dropped, D117); SW and LW keep their Oct 4 rings.
Effect on 3,763 calls: SAFE's club changes on 15%, par chance −1.9 points (−8 to −11 from 175–200 on the fairway, +4 to
+6 from 120–150 in the rough), Driver off 193 of 246 par-4/5 tees (161). The map's ring and dots sit where his shots land
from the aim. `node scripts/build-profile.mjs --model=off --out=<file>` builds the profile as before R11 for a comparison.
446 tests.

## v22.58 (Oct 11)

Catch up (C47, D129): a hole logged after the fact as one chain. A past hole on a mapped course opens on `Catch up`; the
card shows `Log shots` for a hole with nothing logged (the live one too). Each shot opens on the caddie's full call from
where that ball was (Brett, after the first build: he still wants the rings, the target and the Line while logging) —
shot 1 on the tee box the card's yardage matches (`Move tee` if it's wrong); a tap is where it finished, `✓ Finished
here`, the club sheet (the call's club, the lie read off the map), `Save shot`. On the green: feet, a tap where each putt
stopped, `In the hole`; then the count and `Score hole N` / the next hole. `Undo` goes back one step, across a Save too.
The records are the ones the course would write (recommendation + his target), placed and closed at both ends, so the
brain and the Score pre-fill read them. The caddie's bar buttons are compact pills now (Brett: "never this big"), on the
live caddie too. Pure model in `src/caddie/catchup.js`. 443 tests; the smoke test plays one hole through the chain.

## v22.57 (Oct 11)

Place by hand, hold anywhere, delete mid-hole, a round the brain ignores (C46, D128; Brett's notes after the Bradshaw
round). On the map a hold of 300 ms anywhere drags the pin (pin view) or the target marker, offset from the finger so it
stays in view. A pin icon beside `I'm on the tee` / `I'm at my ball` arms the map in a live round: a tap places the ball,
or a hold lifts a ring above the finger and letting go places it; the notice names the shot (`Shot 3 · …`); `Cancel` backs
out. The Shots list deletes a stroke mid-hole in two taps and the caddie's count follows. History rows with shots carry a
`Teaches` / `Ignored` switch: Ignored keeps the records but every learning gate skips them (`teach: false`,
`teaches()`). Brett flips Oct 11 Bradshaw to Ignored himself. 434 tests; the smoke test covers the hold-and-drag
placement and the mid-hole delete.

## v22.56 (Oct 11)

Shot Pattern's own rings and his real shots on the map (C45, D127). The map draws Shot Pattern's 70% ring as printed
(size, shape, tilt), solid, and its 100% ring faint and dotted; the 40 dots are his real shots (filled from the 70%
ring when he has fewer than 40), green on the fairway, yellow in the rough, red in trouble. Read off his Oct 11 club
sheets by `scripts/read-pattern.py`: tee shots, approaches from the tee and fairway, and the rough, each lie its own;
SW and LW draw no rings. Display only: the caddie still prices from the Oct 4 / Oct 10 rings. 429 tests.

## v22.55 (Oct 11)

Trees around Bradshaw's Red and White nines (D126): 53 woods traced automatically from the Sep 2023 photo
(`scripts/bradshaw-trees/`), cut back 20 m from every Red and White tee. The Blue nine still has OSM's two pieces.
425 tests.

## v22.54 (Oct 11)

Bradshaw flies a green photo (D125): Esri Wayback release 41468, a Sep 23 2023 leaf-on capture with short shadows,
in place of the Nov 2025 winter photo. Brett picked it from the nine captures Esri holds. The shapes line up on it; all 27 greens
checked, and White 4's re-traced (it missed its back-right lobe); two bunkers with no sand removed (Red 9, Blue 7).
424 tests.

## v22.53 (Oct 11)

The climb to the target (C44, D124): under To target the rail shows `7 yds down` / `4 yds up` / `level` for the
option drawn, the rise Plays already counts (`riseToTarget`, `riseText`). 424 tests.

## v22.52 (Oct 11)

Score hole pre-fills the logged strokes (C43, D123): the card opens with shots + putts from the log crossed in,
one tap writes it; leaving the hole without a tap does not. The smoke test covers it. 423 tests.

## v22.51 (Oct 11)

The Review map zooms (C42, D122): the Shots list / Review sheet's drawn map opens on the open shot, pinches,
moves with one finger, and `Fit` goes back. The smoke test exercises it. 423 tests.

## v22.50 (Oct 11)

Tee boxes in their tee's colour (C41, D121). Setup stores every tee's yardages on the course (`teeCard`); the
caddie measures each tee box to the green along the hole's line and tints it the nearest card tee within 20 yds
(`src/caddie/teeboxes.js`). On Bradshaw every box on the tee end matched within a few yards. 423 tests.

## v22.49 (Oct 11)

One tile level finer (C39, D120). The satellite source is declared at half its tile size (`TILE_DETAIL_SHIFT`),
so MapLibre draws level 19 on tee and approach views that drew 18 (level 19 was already prefetched). Esri has
nothing past 19 at the five clubs; no free sharper photo (Georgia's 6-inch is licensed; P10). 419 tests.

## v22.48 (Oct 11)

Ball at the bottom centre, target up (C38, D119; picked while Brett slept). With a ball, the map turns so ball →
SAFE's target points up (no call: ball → pin, so on the green the hole is at the top), the ball 10% above the
bottom of the visible region, zoomed as far in as the framed points allow (`cameraForShot`, `upBearing`;
`linearProjector` takes `rotDeg`). Pre-tee, the pin view and the mark view are as before. 419 tests.

## v22.47 (Oct 11)

One finger pans the map (C37, D118; Brett: one finger). On a hole on satellite, a press that moves before the
target's 300 ms hold pans with the finger; hold the target to drag it, Line mode still draws, two fingers pinch.
`Fit` moved top-left under the To Pin box: since v22.28 it sat under the hole pill and could not be seen. The
smoke test now pans and taps `Fit`. 414 tests.

## v22.46 (Oct 11)

The caddie and the map leave out the worst shots (C36, D117; Brett's answers). Every candidate's draws are
simulated as before, then the 20% that finish farthest from the median draw are dropped (`DROP_WORST_PCT`,
`keptDraws`) and only the rest are priced; the dots are 40 of the kept draws. The ring is his rule: 20 yds deep
(±10 of the average finish) and as wide as his best 65% side to side, square to the line (`goodRingFromEntry`;
the width `ringWYds` measured from Shot Pattern's dots by `scripts/fit-ell80.py`). PW 16 × 20 (was Shot
Pattern's 36 × 51 ring), 4-hybrid 48 × 20 (was 88 × 38), Driver 47 × 20 (92 × 35). Effect on 1,719 calls:
SAFE's club changes on 7% (21% of par-4/5 tees, 23% from 230), par chance shown +5.8 points, punch-outs 15 → 8
of 492 tree spots. 414 tests.

## v22.45 (Oct 11)

Each shot gets its own slope, the five mapped clubs carry USGS lidar, and the caddie uses two-thirds of the
forecast wind (C34, D116; Brett's three answers). Red 2's tee shot no longer pays the green's 19-yd climb;
Red 3's 5-iron to 235 stays (a 17 m drop, downhill at full value). `scripts/fetch-3dep.mjs` bakes a 20 m
3DEP grid into a bundled map (re-run it for a new one); the grid rides the geometry in memory, never
localStorage. The Plays badge shows the scaled wind (12 reads 8); the Wind chip counts in full. 407 tests.

## v22.44 (Oct 11)

The ring sits on the target (C35, D115). A fairway shot was sized with the whole hole's wind and slope, so
on Bradshaw Red 2 the 6-iron's target sat at 117 while it finishes ~159 (the ring); now each shot is sized
over its own length. A lay-up spot takes only a club that gets within 10 yds of it (Red 2's Aggressive was a
Driver aimed 344 out). Into 10 mph the SAFE ring–target gap goes from a 14-yd median to 0; the club changes
on 0–4% of calls. 402 tests.

## v22.43 (Oct 10)

Bradshaw Farm is mapped (D114): a bundled map (`src/localGeometry/bradshaw.json`) names all 27 holes for their
nine (Red / White / Blue), so the `Course holes` screen no longer asks; White 4 and White 3's green were
traced in. A local card gives the printed yardages and any two nines in either order. A name-read nine map
now wins over one saved by hand. 398 tests.

## v22.42 (Oct 10)

Tee rings from good shots (C22, D113): the Oct 10 Driving stills fitted by D92's method into
`data/extracted/2026-10-10-ell80.json`; the driver gets a fitted ring, the hybrids' rings go from
~100 yds deep to ~35. The fitting scripts take per-still bar rows and coverage. 394 tests.

## v22.41 (Oct 10)

In-round nudges are said, not applied (C32, D112): the why line names the pattern, the club, target
and start line stay put (`NUDGES_MOVE_CALL: false`). 394 tests.

## v22.40 (Oct 10)

The short-game card: off the green within 100 yds the log card's row is Chip · Pitch · Bunker · Wedge;
with no call off the green the why line gives Brett's own up-and-down and leave (C29, D111). Band
learning from chips is C33. 394 tests.

## v22.39 (Oct 10)

The heads-up (one clause for SAFE's club: 3 of 4 the same way today, or 3 in 10 short in history)
and the aim warning on Brett's own target or Line; his Line is now priced (C4, D110). The replay
found same-day streaks don't predict the next shot; the nudges are C32. 390 tests.

## v22.38 (Oct 10)

A course's map shows before its elevation arrives (D109); the smoke test holds Open-Meteo 30 s to
keep it that way. 384 tests.

## v22.37 (Oct 10)

The start line follows the shot shape: Brett's usual shape and curve per club (driver a 15-yd fade,
5–8 iron a 7-yd draw …); the dashed line starts the curve's width to the other side, the ring stays
(C24, D108). 384 tests.

## v22.36 (Oct 10)

The simulation comes up short as often as Brett does: a short tail per club from Shot Pattern's
`shortPct`, shrunk by n (C8, D107). 382 tests.

## v22.35 (Oct 10)

History's `Misses by club`: per club, yards from the target from Loop's own shots, the start-line
pattern, and Shot Pattern's directions (C25, D106). 379 tests.

## v22.34 (Oct 10)

A fairway bunker (sand more than 40 yds from the green's front) is a "no hero" lie; a punch-out
never aims away from the green (C9, D105). 377 tests.

## v22.33 (Oct 10)

A rough lie scales the total and the extra roll comes out of the carry (the 5-iron finished 219 from
the rough; now 192); 4Hy, 5i, PW read Shot Pattern's rough medians shrunk toward the model; the 41+ ft
three-putt rate is shrunk from 70% to 51.7% (C7, R5, R6, D104). 374 tests.

## v22.32 (Oct 10)

An empty OSM answer expires after a week and the `no-holes` line retries on a tap (C6, D103).
372 tests.

## v22.31 (Oct 10)

Ironwood has a course location (its local card), so test mode and the weather work there (C5);
`scripts/smoke-caddie.mjs` renders the caddie screen in headless Chromium and fails on page errors
(D102). 371 tests.

## v22.30 (Oct 10)

`Enter yards` removed everywhere (C19, R10, D101): no-GPS states offer `Try again` alone; a round
saved in yards mode reopens before the ball. 371 tests.

## v22.29 (Oct 10)

Dots inside the ring: 40 of the simulation's own finishes for the shot on screen (C21), and the rings
moved along the line to where the club's average shot finishes (D100). 370 tests.

## v22.28 (Oct 10)

Course shapes over the satellite, muted, with a `Shapes` toggle (C2), and Chicopee on Esri Wayback
49059, leaf-off (C11, `version` 3); D99. 369 tests.

## v22.27 (Oct 10)

The map frames the ball and the suggested shot, not the whole hole (C20), and pinches to zoom on
satellite with a `Fit` pill to put it back (C18); one finger still drags (D98). 368 tests.

## v22.26 (Oct 10)

A moved target shows its own par chance in the strip, live while dragging (C30, D97). 368 tests.

## v22.25 (Oct 10)

The logging flow moves on by itself (C26–C28, D96): `Missed · next putt` opens the next putt, the
first putt's length comes from the ball → pin, a notice after Log shot says to tap `I'm at my ball`,
and in test mode the map arms for the next tap after every logged shot. 367 tests.

## v22.24 (Oct 10)

Shot 1 within 15 yds of a tee box is a tee lie whatever the trigger (C31, D95): a ball placed with
`I'm at my ball` just off the box read rough and lost the driver. 365 tests.

## v22.23 (Oct 10)

Every shot finishes at its total, approaches included (C23, D94; Brett: "treat my club numbers as
total"). A ball that lands on the green now rolls its roll-out (`GREEN_ROLL_SHARE` 1); before, it
stopped at the derived carry and the caddie called a club long (195 → 5-iron, 207 → 4-hybrid; now
6-iron and 5-iron). Brett's Oct 10 test notes are C20–C31 in `docs/OPEN-ITEMS.md`. 363 tests.

## v22.22 (Oct 10)

Aim for the pattern, and the Line drawn on its own (C3, D93; R3: the aim-off includes wind). Every
target is where the ball finishes on average; the shot is aimed off it by the good-shot ring's
lateral offset (D92) plus the crosswind, once that reaches 2 yds (`aimFor` in `engine.js`, every shot,
tee shots included). Both rings centre on the target. A dashed printed line runs ball → aim point
whenever a call shows; Brett's own `Line` replaces it, and an untouched one is not logged as his
(`intent.startLineDeg` null). The intent stores `aimOffsetYds` / `windYds`; `applyShotLog` and
`tendencies` read misses from the line the shot started on (`patternLatYds`), `withinRound` and the
read-back from the target. 360 tests. In a crosswind SAFE gets bolder (aimed into it): see D93.

## v22.21 (Oct 10)

Two rings, good shots only (C17, D92): the map draws the 80% ring of the good shots plus an inner
dashed ring for the best 30%; the engine draws a mishit from Shot Pattern's printed ring at the club's
`mishitRate`. Built by `scripts/read-carries.py` (Shot Distances bar) and `scripts/fit-ell80.py`
(plot dots) from the Oct 4 stills. Driver ring capped at 70 yds (display only). 2Hy and PW keep one
ring (under 5 good dots). 354 tests. Smaller rings lower trouble everywhere, so SAFE attempts more
(see D92); C10 re-tunes.

## v22.18 (Oct 5)

A printed "why" line sits above the action button on every call (C1, D91; R1 "Full"): the rule that
decided SAFE (no hero, pin, driver, par chance) or the best par chance, plus today's adjustment for
that club ("· clubbed up: short with mid irons on 4 and 7 today"). Aggressive shows its birdie
chance; Custom shows nothing (C4's aim warning will). Built in `reasons.js` `whyLine` from
`recommend().why` (engine.js `whyFacts`) and the nudges' new fields (learning.js). 349 tests.

## v22.17.4 (Oct 5)

Lay-ups and the corridor's "center" aim at the middle of the hole's own fairway, not the hole line
(D90, C16): on Chicopee Village 1 the line runs along the tree edge, and the caddie had called Driver
into the trees beside it. 336 tests.

## v22.17 (Oct 4) — read first

Brett's Oct 3 field test → v22.17: the caddie is a full-screen map (D81, built from his Shot Pattern
screen recordings), the bottom pill moves between holes and a past hole logs by tapping (D80), a
notebook button takes dictated notes (D82), the target drag is smooth and shows ball → target and
target → pin on the map, and Custom when he leaves both routes (D83), Safe is the most-likely-par
route with Par+/Dbl+ in Details (D78), the profile is treated as an 85°F profile (D79), and the
breadcrumb trail records while the screen is on (D84). 324 tests. **Untested on a course**: the
putting flow (never reached in the Oct 3 round), the trail on a real walk, the new layout on the
phone's safe areas. Summary and History show `Tee shots: Safe · Aggressive · Custom` — more Custom
than either means the caddie's calls are not landing.

## Where things stand (Oct 1, after PR #11 merged)

Live at https://brettryantalley-source.github.io/Loop-Golf/ — **`main` is v22.16** (PR #11 merged Oct 1:
v22.14 pencil-only score marks D58, v22.15 shot log v2 `docs/SPEC-shotlog-v2.md` D59–D65, v22.16 Shot
Pattern importer + history card fix D66–D71; before it PR #10 sliders, PR #9 Ironwood fixes, PR #8
marked-green mode, PR #7 v22.6–v22.10, PR #6 v22.3–v22.5, PR #5 the caddie). The working branch
`claude/bold-pascal-2s136s` is restarted from `main` after each merge; nothing is unmerged.

**Stats refresh, Oct 4 (v22.17.1, D85).** `src/profile.json` now builds only from the Oct 4 batch: the Stats
Report PDF (Casual · Last 10, Jul 26 – Oct 3) + 12 screen recordings transcribed into
`data/extracted/2026-10-04-screens.json` (stills in `data/raw/2026-10-04/`) + fairway ellipses fitted by
`scripts/fit-ell80.py`. Fairway distances changed for 2Hy 236 (+12), PW 134 (−6), LW 78 (−7); every approach
club has a measured pattern except 4Hy. Rough distances and every club's leave zones are stored, **not used** —
Brett's call. Per-distance buckets are shrunk toward the lie average (SHRINK_K) because raw 6-shot bands sent
the caddie to an 8-iron off par-4 tees. Full driver and full 2-iron are tee-only (D86, Brett: 2-hybrid is his fairway club); par-5 second
shots: 310 out 6-iron lay-up, 290 2-hybrid lay-up, 270 2-hybrid at the green. Open: the 41-ft step in
his three-putt table (70% from 41+ ft on 10 putts) still drives lay-up pricing — Tangent's longer history may fill it.

**Shot Pattern rounds imported: nine of thirteen** (Aug 3 Chicopee Village/Mill added Oct 4, 714 records) — Ironwood 9/28, Hampton 9/20, Lake Arrowhead 9/12,
Beachwood 9/2, Canongate 8/23, Chicopee Woods Village/School 8/15, Riverpines 8/9: 558 records in
`src/shotpattern.json` (v22.16.1, Oct 1). Shot Pattern's round history runs back to Jun 17; still to
transcribe: Sugar Creek 7/26, Chicopee Mill/School 7/17, Woodmont 6/27,
Riverpines 6/21, Woodmont 6/17 — their cards are already in History (below), only the shot lists are missing.
**History since June (v22.16.1):** `src/seedRounds.js` holds 12 imported cards, Jun 17 → Sep 20, every
one reproducing GHIN's differential (GHIN's list: `data/extracted/2026-09-30-ghin-scores.json`). Only the
five newest reach the last-5, so the ghost stays at 7.4. Bear Slide 6/10 and Cider Ridge 6/6 are in GHIN
but predate Shot Pattern — no card, not in History, until Brett sends GHIN's hole-by-hole. Play dates are
Shot Pattern's (Brett, Oct 1): Beachwood 9/2 and Ironwood 9/28, though GHIN shows 9/5 and 9/30.
**Cards vs. the ghost (v22.16.2, D72):** every card is played against the ghost Loop would have built that
day (`ghostDiff`, `strokeIndex` from golfcourseapi) and counts toward the record: the cards alone are
**6–4–2**. June 17 and 21's ghosts average only 3 and 4 prior GHIN rounds — send GHIN rounds older than
May 16 to fill them. A new card needs both fields or it stays unscored (History shows it without a result).
**Routine for each** (a code thread does all of it; no middle step): Brett screen-
records Shot Pattern's round page — scorecard, Summary, then the four Shot List tabs (Driving, Approach,
Short Game, Putting) scrolled slowly top to bottom — and drops the recording in the chat. The thread
extracts frames (`ffmpeg -vf "fps=2,scale=460:-1"`, dedupe near-identical frames, 4-up contact sheets),
reads them, writes `data/extracted/rounds/{date}-{course}/shots.json` (schema 1; the five existing files
are the contract), reconciles every hole — drives + approaches + short game + putts + penalty strokes
must equal the card score — then `npm run import:shots`, `npm test` (all green), the frozen check, `./build.sh`,
commit, push, PR, merge on Brett's "merge". Conventions learned: Shot Pattern's "(+2)" on a tee shot to a
penalty is one penalty stroke plus the re-tee (store `penalty: 1`, note it); "Unknown Club" → `null`;
clubs Dr, 2i, 2Hy, 4Hy, 5i–9i, PW, GW, SW, LW, putter; lies tee / fairway / rough / bunker / recovery /
penalty / green. Data-only commits do not bump the build tag.
Cloud containers block unpkg.com, which `./build.sh` uses for React: `npm pack react@18.3.1 react-dom@18.3.1`
and copy each `package/umd/*.production.min.js` to `build/react.min.js` / `build/react-dom.min.js` (byte-identical).

Queued builds live in `docs/OPEN-ITEMS.md` (the aim warning is C4; the breadcrumb trail shipped in
v22.17, D84). Brett merges a PR from his phone (GitHub app or "merge" in the Claude app);
Pages redeploys in about a minute; he fully closes and reopens Loop and reads the build tag top-right
of Setup.

Engine as of v22.10 follows `docs/CADDIE-BRAIN-INTEGRATION.md` (D43–D46; known gaps in D46). **v22.16.9
adds part 2 of that file: Michael Leonard's *How to Play Wicked Smart Golf*** (notes in
`docs/research/wicked-smart-golf-2026-10-03.md`; Brett: where it disagrees with the Sep 29 research, the
guide wins). `src/caddie/strategy.js` chooses SAFE from the priced candidates — front / back pin → the
club whose average finishes mid-green, middle pin → wedges may attack, a short finish counts double;
from trees or a bad rough lie only a 9-in-10 shot, else punch out; driver on tee ties (D76). Left out on
purpose: aim-for-the-pattern (fold into v22.17), sand as a no-hero lie, a short-miss tail in the
simulation (D77). On the course: SAFE now often plays to the middle of the green and AGGRESSIVE can show
a lower average (`−0.n`) — that is the guide overruling the price, by design.
`npm test` is 299 tests (v22.16.9). Decisions run D1–D86 in `docs/DECISIONS-caddie.md`.

**Ironwood (Fishers, IN) is not traced in OpenStreetMap.** v22.11's marked-green mode is the
bridge (satellite on GPS, tap the green, distance-only pricing). First round there (Sep 29, v22.11):
the satellite never loaded and the app could not say why — v22.12 adds the Setup `Satellite check`
line; read it before the next round and report the exact text. The permanent fix is tracing the
course in the OSM iD editor; a prompt for a web-enabled chat to check OSM coverage was handed to
Brett on Sep 29.

**Woodmont (Canton, GA) has a hole map as of v22.16.3 (D73).** OSM has the club outline only (Overpass,
Oct 2: no holes, greens, tees, fairways or bunkers — the app was right to say `No course map`).
`src/localGeometry/woodmont.json` is a hand trace from aerial imagery: 18 hole lines, 18 greens, 58 tee
boxes, 17 fairways, 44 bunkers, the two lakes and the creek. `useCourseMap` reads it before the cache or
Overpass, so the Setup line reads `Course map ready` and the caddie draws every hole. It is NOT surveyed.
First round there: stand on the middle of three greens with the caddie open and read the distance to
the middle (should be 0–3 yds); report the offset by hole, and `shiftM` in the file moves everything at
once. Tee boxes marked `q: est` are ellipses on the pad centre, not outlines (8, 15 and 18 are the least
certain). No trees and no OB. The permanent fix is the same ways in OSM; the trace converts directly.
Open items for Woodmont: C13 and C15 in `docs/OPEN-ITEMS.md`. How the trace was made: `scripts/woodmont-trace/`.

## What each screen does now

- **Setup.** Picking a course now also fetches its OSM geometry (cached
  `bogeyman-matches:geo:v1:{apiId}`, schema 2) and prefetches satellite tiles into
  `bogeyman-tiles-v1` — status lines `Course map ready` / `Course map · loading n of 18` /
  `Course map unavailable · caddie will use yards`.
- **Start round** opens the **caddie screen** directly, hole 1 pre-tee (D22) — not the scorecard.
- **CaddieScreen** (`src/app.jsx`, driven by `src/caddie/caddieState.js`): collapsed/expanded rail,
  Safe/Aggressive toggle, six chips (Lie, Quality, Wind, Elevation, Pin, Conditions — printed vs.
  pencil per §7.2), pin by chip tap or a tap on the map, `Log shot` → `LongCardSheet` (Good shot ✓
  quick path or a full Detail log), every §8 state (pre-tee/locating/ready/same-shot/low-accuracy/
  on-the-green/no-GPS-fix/location-off/yards-entered/no-course-map/no-satellite/no-profile).
- The map (`src/caddie/mapLayer.jsx` + `overlay.js`) is MapLibre over MapTiler satellite when tiles
  are cached, or a flat drawn map from OSM polygons (§4.3) when they aren't; both draw the same
  dispersion-ellipse overlay.
- `‹ Card` returns to the scorecard, which gained a `Caddie` control in the hole-nav row; caddie
  state persists under `bogeyman-matches:v1.caddie` and restores exactly on reload/relaunch.
- **Summary and History** now show an `AggressionLines` line (Safe vs. Aggressive clubs played),
  per round on Summary and as a season roll-up on History.

## Requirements for the caddie to work fully

- **GPS.** Permission prompt fires on the first `I'm on the tee`. No fix / no permission both fall
  back to `Enter yards` (club-brain mode: profile only, no map).
- **Course geometry.** Fetched from OSM on Setup when the course is chosen, cached per `apiId`.
  Missing or incomplete geometry for a hole → `No course map`, `Enter yards` only.
- **Satellite tiles.** Prefetched into `bogeyman-tiles-v1` on Setup. Missing tiles → the map draws
  from course data on paper (§4.3), not a hard failure.
- Enter yards / club-brain mode is the fallback whenever there's no course map OR no GPS fix.

## Storage keys added by this build

- Shots: `bogeyman-matches:shots:v1`. Lie overrides: `bogeyman-matches:lieOverrides:v1`.
- Per-course 27-hole nine mapping: `bogeyman-matches:nineMap:v1:{courseId}`.
- Config overrides: `bogeyman-matches:config:v1` (merged over `DEFAULT_CONFIG`).
- Caddie round state: inside `bogeyman-matches:v1` under the `caddie` key.
- Shot log export/import lives on the History screen.
- All still in the `bogeyman-matches:*` namespace — no `loop.*` keys were introduced.

## On-device verification

Do the on-course walkthrough in **`docs/FIELD-TEST-v22.md`** before or right after merging — GPS,
geometry, tiles and Open-Meteo can only really be checked live. It covers: before-leaving-the-house
checks, first tee (permission prompt, states, pin, details, Aggressive toggle, Enter yards
fallback), mid-round (ball position, previous-shot prompt, Good shot ✓, Detail log, lie
corrections), hole-out, after-the-round (Summary/History aggression lines, shot-log export, Shot
Pattern export), and what to report back.

## Open follow-ups

Unverified in this build container (no internet access):
1. **Broadie baseline transcription** (D1–D2) — `src/caddie/baseline.js` cites the published PGA
   Tour expected-strokes table but was never checked live against the book.
2. **Overpass / Open-Meteo field names + CORS** — built against documented shapes only.
3. **Ironwood 27-hole OSM coverage** — S2 verified against the Hampton fixture only.
4. **MapTiler caching terms** (D19) — tile prefetch is ON behind `TILE_PREFETCH_ENABLED`; flip it
   off in `src/caddie/mapLayer.jsx` if the terms turn out to forbid offline caching.
5. **iOS PWA geolocation permission behavior** — first-run prompt inside an installed PWA, unverified.
6. **Real safe-area insets** on-device.
7. **Pencil-filter performance** on the phone (map + overlay redraw under `filter: url(#pencil)`).

Also open (from `docs/DECISIONS-caddie.md`):
- **D31** — the engine applies `aimYds` but doesn't clamp the shifted target to the fairway/green
  polygon; the displayed `Plays` number doesn't move when a distance nudge fires.
- Wedge lofts (`loftDeg` null for every wedge), finesse carries for GW/SW/LW (placeholders, `n: null`),
  remaining `ell80` clubs (Dr, 2i, 5i, 6i, 7i, 8i, GW, SW, LW, finesse — see the file's `pending`
  list in `data/extracted/2026-09-19-ell80.json`).

## Refresh workflow (spec §5.8)

After a round: on History, **Export shot log** → hand the export (or a **Shot Pattern export** for
the round) to the Golf project chat → it lands under `data/extracted/` → run
`npm run build:profile` (or `node scripts/build-profile.mjs --check` to verify without writing) to
regenerate `src/profile.json`. Never hand-edit `src/profile.json` directly.

## Decisions to review

`docs/DECISIONS-caddie.md` (D1–D31) — calls made during the build to keep it moving. Nothing there
is load-bearing beyond the line it names; read it before touching `src/caddie/`, don't copy it
elsewhere.

## Non-negotiable

- `computeGhost` and `evalMatch` are frozen. Verify byte-identical before every commit.
- Never rename the `bogeyman-matches:*` localStorage keys or the Firebase project `ghost-match-cd04d`.
- `.nojekyll` stays — Pages fails without it.
- Every user-facing deploy bumps `BUILD` in `src/app.jsx` AND `CACHE` in `sw.js`, together.
- `./build.sh` after every `src/` edit. `index.html` is generated; never hand-edit it.
- Show a diff and wait for Brett's explicit go before committing or pushing. The caddie branch's
  own "go" is separate: it's the PR #5 merge.
- Offline-first. Nothing fetched at runtime that the app needs to render.
- `src/profile.json` is generated, not hand-edited. Edit `data/extracted/` or
  `scripts/build-profile.mjs`, then `npm run build:profile`.
- **Never run two code threads on `src/app.jsx` at once** — one working copy, one code thread at a
  time (docs-only threads may overlap; a second parallel code thread needs its own git worktree).

## Parked on disk, not in the UI

`src/holeMap.jsx` — superseded by `src/caddie/mapLayer.jsx`, still unimported, its tests still run.
`vendor/maplibre-gl.*` and the satellite tile cache (`bogeyman-tiles-v1`) are **live again** — the
caddie lazy-loads MapLibre from `vendor/` on first open and both files are back in the `sw.js`
shell. The parked v1 caddie (`src/caddie.js`, `src/caddie.test.js`) is gone (D9); `src/caddie/`
replaces it.

---

## The feature

Caddie engine, shot log and learning profile: **`docs/SPEC-caddie.md`** (locked Sep 27) and
**`docs/SPEC-caddie-UI.md`** (UI addendum v1, §8 states / §13 flags). `docs/DECISIONS-caddie.md`
overrides the spec where they disagree. Build order was spec §9 — S1 through S5 are all done; this
thread's job is on-device verification and, once Brett merges PR #5, moving on to the next feature.
