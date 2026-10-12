# Trees from USGS lidar (v22.61, D133)

How the `natural=wood` ways with `"q":"lidar"` in `src/localGeometry/*.json` are made. Offline only (numpy, scipy,
pillow, shapely, opencv-python-headless, laspy + lazrs; Node 18+ for `apply.mjs`); nothing here is bundled or run by
`npm test`. Run each step from one scratch directory: rasters, woods and sheets land in the current directory.

1. `python3 raster.py <club>` — the USGS 3DEP point cloud over the club's hole lines (+110 m), from the Entwine tiles
   on AWS (`s3://usgs-lidar-public`, the most recent survey over the club; Georgia's statewide 2018 collection for the
   clubs mapped so far), gridded at 1 m: the highest return, high-vegetation (class 5) and building (class 6) counts,
   plus the 3DEP bare-earth raster on the same grid → `<club>-pc.npz`. Chicopee: 740 tiles, 29 M points, ~80 s.
2. `python3 trees.py <club> [corridor_m=75]` — a cell is tree when its highest return is more than 3 m above the
   ground and it holds vegetation points (not more building than vegetation); closed and opened by a cell; within the
   corridor of a hole line; off every mapped green, tee, fairway, bunker and water; clearings under 100 m² filled,
   pieces under 60 m² dropped; simplified 1.5 m; cut on a 90 m grid (a piece with a clearing keeps it as
   `outer` / `inner`) → `<club>-woods.json`.
3. `node apply.mjs <club> [--out=<file>]` — replaces the photo-traced (`q: "auto"`, D74 / D126) and earlier lidar woods
   in the club file, keeps OSM's (`q: "osm"`), writes `source.woods` and bumps `version`. Without `--out` it writes
   the repo file.
4. `python3 sheets.py <club> <new.json> [nameRegex]` — a review sheet per hole on the club's own photo: new trees cyan,
   old woods red, fairways yellow, the hole line white (`OLD=<file>` compares against a saved copy).

Then check the calls (the tee call and the lies along each hole line, old file against new) and `npm test`.

Why lidar and not the photo: the photo's tree edge is a colour guess, and shade on rough and cart paths reads as trees
(Chicopee's Village 1, Oct 4, D74). A lidar return 3 m off the ground is a tree. The point cloud is from 2018–19, so a
tree cleared since still shows; the review sheets on the current photo are where that would show up.
