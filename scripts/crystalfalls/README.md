# Crystal Falls (Dawsonville, GA): how the bundled map was made (v22.73, D148)

Offline tools for `src/localGeometry/crystalfalls.json`; nothing here is bundled or run by `npm test`.

1. One OSM pull (Oct 30 2026): `api.openstreetmap.org/api/0.6/map?bbox=-84.258,34.358,-84.218,34.388`.
2. `python3 convert.py <map.osm> --esri=43291 --esriNote="…"` — the 18 hole ways (pars and handicaps checked against
   golfcourseapi `mman7dns`), the 18 greens, tee boxes, bunkers, fairways (ways and multipolygons), ponds and the marked
   lateral hazards within 100 m of a line, the streams buffered 3.5 m (`q: osm+buffer`), OSM's woods clipped to 120 m, the
   club outline as the boundary. Writes the repo file at `version` 1.
3. The usual bake: `node scripts/fetch-3dep.mjs crystalfalls` (version 2), `node scripts/fetch-green-slopes.mjs crystalfalls`,
   then from a scratch directory `scripts/lidar-trees/` `raster.py crystalfalls` → `trees.py crystalfalls` →
   `node …/apply.mjs crystalfalls` (version 3; GA_Statewide_B3_2018: 690 tiles, 30 M points, 319 pieces of trees).
4. `node scripts/gameplan.mjs crystalfalls --card=data/cards/crystalfalls-mman7dns.json --tee=Blue --carry=-5
   --out=docs/GAMEPLAN-crystalfalls.md`.

Photo: Esri Wayback 43291 (the Oct 29 2026 release). A contact sheet of twelve releases over the clubhouse: every release
from Apr 2026 (49059) on is the same sharp leaf-on capture; 2023–2025 are a hazier dormant one. Dawson County publishes no
reachable ArcGIS imagery service, so there is no county photo (D140's pattern does not apply).

Known gaps: one OSM wood relation (143854) is cut by the box and left out (the lidar woods cover it); two bunkers sit
over 100 m from any line (the range) and are left out. Not field-checked.
