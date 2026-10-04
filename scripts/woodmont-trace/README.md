# scripts/woodmont-trace — how Woodmont's hole map was made

Reference only. Nothing here is bundled, built or run by `npm test`. The app reads one file, `src/localGeometry/woodmont.json` (D73, v22.16.3). This folder is how that file was made on Oct 2 2026 and how to redo it from other imagery. What is still open for Woodmont: C13 and C15 in `docs/OPEN-ITEMS.md`.

**Set up.** Every script reads and writes `/tmp/woodmont-trace` (the constant `S` in `geo.py`): `mkdir -p` it and copy `overrides.json` in. Python 3 with `numpy opencv-python-headless shapely scikit-image pillow`; Node 18+ for the `.mjs` files; `pw/*.mjs` also need `playwright-core` (`npm i --no-save playwright-core`) and Chromium. `build_data.py`, `woodmont-check.mjs` and the `pw` scripts reach into the repo by absolute path, so it has to sit at `/home/user/Loop-Golf`. Requests send a descriptive `User-Agent`; Overpass answers 406 to a generic client.

## Order

1. **Imagery** (Esri World Imagery). The hole table is measured in this tile grid, so reuse it:
   - `node fetch-tiles.mjs 18 34.22145 -84.36195 34.23508 -84.34135 /tmp/woodmont-trace/t18` (x from 69641, y from 104511, 16 × 13 tiles)
   - `node fetch-tiles.mjs 19 34.22174 -84.36161 34.23536 -84.34170 /tmp/woodmont-trace/t19` (x from 139283, y from 209022, 30 × 25)
   - `python3 stitch.py 18` and `python3 stitch.py 19` give `mosaic18.png` and `mosaic19.png`, the January 2026 capture as it was served on Oct 2.
   - Leaf-on: `node fetch-wb.mjs 64001 19 139283 209022 30 25 /tmp/woodmont-trace/t19b` (Wayback release 64001, the 2025-10-10 capture), then `python3 register_wayback.py` gives `mosaic19w.png`. If the served imagery has changed, `--estimate` re-measures the shift.
2. **Hole table.** `solve.py` and `solve2.py` pair tees and greens to hole numbers from the card and the cart-path routing; `render_overview.py` draws the numbered overview. The result is the `HOLES` table at the top of `trace.py` (z18 px; the tees on 8 and 18 are Brett's arrows, 15's pads were moved after his correction).
3. **Greens.** `python3 greens2.py` writes `greens2.json` (watershed). `overrides.json` holds hand polygons for greens 7, 13 and 18, where shade beat the segmenter.
4. **Everything else.** `python3 trace3.py [holes]` writes `trace3/holeN.json` and `trace3/global.json`: hole lines, fairways (January or October mosaic, per hole), tee pads or ellipses, bunkers, water. `trace.py` and `trace2.py` (the earlier tracers) are imported for helpers. About 10 s a hole. It is not deterministic: re-running a hole gives slightly different polygons. The pool deck behind the 11th tee is dropped from the bunkers by position (z18 px), so a new grid needs that coordinate redone.
5. **Review.** `render3.py [holes]`, `render_all.py`, `view.py`, `crop.py` and `greens-show.py` draw the traces on the imagery.
6. **Output.** `python3 build_data.py` turns `trace3/*.json` into `src/localGeometry/woodmont.json` and overwrites that file.
7. **Check.** `npm test` (`src/localGeometry.test.js`), then `pw/smoke.mjs` and `pw/caddie-shot.mjs` for the built app in headless Chromium.

## Side tools

`detect_pads.py` (tee-pad and bunker candidates), `fuse.py` (fairway mask from the two seasons), `osm-overlay.py` (what OSM already had), `tiles.mjs` (overview mosaic with the OSM outline and the API anchor), `fetch-carts.mjs` and `fetch-water.mjs` (OSM cart paths for the routing and the creek), `imagery-meta.mjs`, `wayback.mjs` and `wayback2.mjs` (which captures exist and how recent), `woodmont-check.mjs` (what OSM holds for the club and what Setup would say, using the app's own `overpassQuery`, `parseOverpass` and `coverageCheck`).

## What was checked after the move

Paths were rewritten mechanically and the contact string in the User-Agent was replaced. All 29 scripts parse. `register_wayback.py` reproduces `mosaic19b.png` and `mosaic19w.png` hash for hash. `build_data.py` reproduces the committed `woodmont.json` byte for byte from the Oct 2 traces. `trace3.py 1` and `render3.py 1` run. Nothing else was re-run. The Oct 2 `trace3/*.json` (240 KB) are not kept, so the committed JSON is the record of that run.
