# Callahan Golf Links (Waleska, GA): how the bundled map was made (v22.75, D150)

Offline tools for `src/localGeometry/callahan.json`; nothing here is bundled or run by `npm test`.

1. One OSM pull (Nov 1 2026): `api.openstreetmap.org/api/0.6/map?bbox=-84.545,34.288,-84.500,34.318`.
2. `python3 convert.py <map.osm> --esri=43291 --esriNote="…"` — the 18 hole ways (pars checked against golfcourseapi
   `ztss1ttq`; OSM carries no handicap tags here, so the stroke index is the card's), the 18 greens the lines end in (OSM
   has 19: the practice green is left), 59 tee boxes, 25 bunkers, fairways (6 ways + 18 multipolygons; relation
   18880553 has only inner members and is skipped, its green and bunker ride as ways), the ponds and the 9 marked water
   hazards within 100 m of a line, the streams (McCanless, Sardis and Byrd Creeks and their feeders) buffered 3.5 m
   (`q: osm+buffer`), the club outline (a LandPro08 polygon that holds every line and green) as the boundary. Holes 4, 9
   and 13: OSM's line started at a forward tee with the Black box 50–117 yds behind it, so `LINE_START` extends the
   line back to that box's centre (`q: osm+tee`; 533, 401 and 436 yds to the green via the old start against the
   card's 534, 398 and 415); hole 6: OSM drew the line from hole 4's Black pad (one tee complex serves both holes), so
   `LINE_START` cuts it to 6's own Black box (157; the card and Tangent agree, D151). Writes the repo file at `version` 1.
3. The usual bake: `node scripts/fetch-3dep.mjs callahan` (version 2), `node scripts/fetch-green-slopes.mjs callahan`,
   then from a scratch directory `scripts/lidar-trees/` `raster.py callahan` → `trees.py callahan` →
   `node …/apply.mjs callahan` (version 3; GA_Statewide_B2_2018: 386 tiles, 16 M points).
4. `node scripts/gameplan.mjs callahan --card=data/cards/callahan-ztss1ttq.json --tee=Black
   --out=docs/GAMEPLAN-callahan.md`.

Photo: Cherokee County's 6-inch orthophoto as `imagery` (Waleska is Cherokee County: the same public image service
Woodmont and Bradshaw fly, D140; winter, bare trees, sharp), Esri Wayback 43291 as `imageryEsri` (the current leaf-on
capture — every release from Feb 2026 on is the same one, dormant fairways; the Oct 2025–Jan 2026 releases are a
greener, softer capture).

Known gaps: hole 1's Black tee has no box of its own (the back pad measures 470 against Black 495 / Blue 461,
so the two share it); boxes behind the Black on holes 11 and 16 (and hole 6's three behind hole 4's) match no card tee and take no name;
Tangent's Black marker on 13 sits on the Blue box (367 yds) where the card says 415, the box behind it, which the map keeps; one OSM wood relation (143841) is cut by the box
and dropped (the lidar woods cover it). Not field-checked.
