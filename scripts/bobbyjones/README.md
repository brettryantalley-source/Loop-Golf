# Bobby Jones (Atlanta): how the bundled map was made (v22.71–v22.72, D146–D147)

Offline tools for `src/localGeometry/bobbyjones.json`; nothing here is bundled or run by `npm test`.

1. Two OSM pulls (Oct 26 2026): `api.openstreetmap.org/api/0.6/map?bbox=-84.4095,33.8120,-84.3960,33.8215` (the club) and
   `/api/0.6/relation/113167/full` (Peachtree Creek as a water area, since the map call cuts its member ways at the box).
2. `python3 convert.py <map.osm> <peachtree.osm> --esri=41468 --esriNote="…"` — the Azalea routing's nine hole ways written
   twice (refs 1–9 and 10–18, `loop: 9`), the nine double greens, bunkers, fairways, rough, ponds, the creeks (Tanyard's
   centrelines buffered 3.5 m, Peachtree's area clipped to 100 m of a line), OSM's woods clipped to 120 m; no boundary (OSM's
   outline predates the 2018 rebuild). Writes the repo file at `version` 1.
3. The usual bake: `node scripts/fetch-3dep.mjs bobbyjones` (version 2), `node scripts/fetch-green-slopes.mjs bobbyjones`,
   then `scripts/lidar-trees/` `raster.py` → `trees.py` → `apply.mjs bobbyjones` (version 3; GA_Statewide_B2_2018, flown
   Jan–Apr 2019, after the Nov 2018 opening).
4. `python3 tees.py <bobbyjones-pc.npz> --review` — **tried and not shipped** (D147): flat raised shelves on the lidar bare
   earth inside each hole's tee corridor. It found 651 pieces, most of them mounds, bunker lips and bumps in the rough, and
   the leaf-on photo shows why: the Longleaf tees here are mown into continuous fairway-height turf, with no pad to find or
   trace. Kept as the record of the attempt; `--apply` is there but was never run on the repo file.

Magnolia is the other nine (white flags, clockwise); the snapshot holds its nine ways (OSM ids 1210830252–1210830260), so a
Magnolia file is a sibling run of `convert.py` with its ids and card — but two bundled files at one club first need the
map-key rule of D141 extended (both courses would key the club id).
