# Woodmont hole map — what is still open

Read CLAUDE.md, the Woodmont paragraph in `docs/HANDOFF-NEXT.md` and D73 in `docs/DECISIONS-caddie.md` first. Then work from this sheet, one item at a time, in order. CLAUDE.md's hard rules apply: never touch `computeGhost` / `evalMatch`; show a diff and wait for Brett's "go" before any commit or push. Ask which item he is ready for; item 1 needs a round at Woodmont.

## Where it stands (Oct 4 2026, `main` = v22.17.2)
- Woodmont Golf & Country Club (Canton GA, golfcourseapi `tnw4ghn5`, Medal tee) has had a real hole map in the caddie since v22.16.3 (PR #15, D73). OSM has the club outline only, so the trace ships inside the app.
- `src/localGeometry/woodmont.json` holds 18 hole lines, 18 greens (7, 13 and 18 drawn by hand), 58 tee boxes (40 are estimated ovals, `q: est`), 17 fairways, 44 bunkers, 2 lakes and 9 creek stretches (Mill Creek, buffered 3.5 m, lateral water hazard). No OB, no trees.
- Traced from Esri World Imagery (0.34 m; captured 2025-10-10 leaf-on, hole 1's fairway and cross-checks from 2026-01-04). The imagery's stated horizontal accuracy is 8.47 m. The trace is not surveyed, and it has not been seen on a phone or over the app's MapTiler tiles.
- Wiring: `src/localGeometry.js` (loader), `LOCAL_GEOMETRY` + `useCourseMap` in `src/app.jsx`, `saveGeometryCache` in `src/caddie/geo.js`, 11 tests in `src/localGeometry.test.js`. The bundled trace beats the cache and Overpass. Phones hold a cache entry stamped `local: "tnw4ghn5@1"`; bump `version` in the JSON to replace it. `shiftM` [east, north] metres moves the whole trace.
- How it was made: `scripts/woodmont-trace/` (reference only; its README gives the order).

## Closed (Brett, Oct 4; recorded in D73)
- 16 tee sits left of the 15th green (his note said 13th; he confirmed 15th).
- The creek costs a stroke, so the penalty-hazard treatment stays.
- Hole numbering, the 9→10 walk, and tees 8 and 18 where he pointed.
- The tracing scripts are saved in `scripts/woodmont-trace/`.

## Open, in order
| # | Item | Needs | Done when |
|---|---|---|---|
| 1 | Check the trace against GPS, then set `shiftM` | Brett plays Woodmont with the caddie open, then exports the shot log (History) | greens read within 0–3 yds of the polygon middle; `version` → 2 |
| 2 | Fix the tee boxes: 8, 15, 18 and the 40 ovals | the same round's tee fixes, or a growing-season retrace | each tee polygon holds its hole's first-shot fixes |
| 3 | OB and trees | Brett: which holes have OB, which side | recorded; traced, or left out on purpose |
| 4 | Retry an empty OSM answer | Brett's yes, then his go on the diff | a `no-holes` club is re-asked; test added |
| 5 | Upload the trace to OSM (option A) | item 1 done; an OSM account | features reviewed one by one, then uploaded |

### 1. Check against GPS, set `shiftM`
- Quick version (already in HANDOFF-NEXT): stand on the middle of three greens; the distance to the middle should read 0–3 yds. That gives the size of the miss, not its direction.
- Better: after a full round, export the shot log (History). Records carry `start.{lat,lng}` and the hole. Compare the fixes logged on each green (and each tee) with the polygons, take the median east/north offset over the 18 holes, and put it in `shiftM`. The v22.17 breadcrumb trail (`bogeyman-matches:trail:v1:{roundId}`, per hole `{t, lat, lng, acc}`) holds more fixes; check whether History's export includes it.
- Separate check by eye: polygons over the MapTiler tiles. If GPS says the trace is right and the tiles disagree, that is the tile provider's offset. Tell Brett before shifting for it.
- Ship: edit the JSON (`shiftM`, `version` 2), `./build.sh`, bump BUILD and `sw.js` CACHE together, `npm test`, show the diff, wait for "go".

### 2. Tees
- 8, 15 and 18 are the least certain. 15's pad was moved after Brett's correction; 8 and 18 sit at his arrows. The `q: est` ovals sit on the pad centre, not its outline.
- After item 1's shift, refit the ovals from the first-shot fixes at each tee. Or retrace from a summer capture (Esri Wayback); `scripts/woodmont-trace/` has the pipeline.

### 3. OB and trees
- Today: no OB (OSM's club outline cuts through holes 4 and 7, so using it draws wrong OB) and no tree layer (OSM woods are coarse tracts). Woods read as rough.
- OB comes only from a `leisure=golf_course` boundary; the parser warns "no leisure=golf_course boundary — OB off", and `src/localGeometry.test.js` expects that warning. Adding a boundary means updating that test.
- Ask Brett where the OB stakes are before tracing anything.

### 4. Retry an empty OSM answer
- Cause: `useCourseMap` (`src/app.jsx`, about L217–292 on main) caches a no-holes answer with no expiry, and `no-holes` has no retry. D73 records it. A club mapped in OSM later stays blank on phones that already opened it.
- Smallest fix: don't cache an empty answer (or expire it), and put a Retry on the `no-holes` line.
- Applies to every club (e.g. Ironwood), not only Woodmont. A club with nothing in OSM must still land in marked-green mode.

### 5. OSM upload
- The trace converts to OSM ways: `golf=hole`, `green`, `tee`, `fairway`, `bunker` (D73).
- Do it after item 1, so the shared map gets the calibrated version.
- Check before uploading: OSM's terms for tracing from Esri imagery, and its import / automated-edit guidelines (the trace is algorithm-assisted; reviewing each feature by hand is the safe route).
- Afterwards the app keeps using the bundled file until it leaves `LOCAL_GEOMETRY`.

## Out of scope
Shot Pattern shot lists for Woodmont 6/17 and 6/27 (HANDOFF-NEXT), Chicopee Woods (D74), caddie engine changes.
