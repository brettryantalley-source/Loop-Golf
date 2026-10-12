# Bradshaw trees from the photo (v22.55, D126)

**Superseded in v22.62 (D134):** Bradshaw's woods are now USGS lidar (`scripts/lidar-trees/`). Kept as the record of D126.

How the 53 `natural=wood` ways with `"q":"auto"` in `src/localGeometry/bradshaw.json` were made, saved as
reference. Offline only (numpy, scipy, scikit-image, shapely, pillow); nothing here is bundled or run by `npm test`.
Run each step from one scratch directory (tiles, masks and JSON land in the current directory).

1. `python3 fetch.py` — Esri Wayback release 41468 (the Sep 2023 photo the file flies), z18 (~0.49 m/px), stitched
   over the Red and White nines into `mosaic.png` (304 tiles).
2. `python3 seg.py` — per pixel: smoothed Lab colour + local texture. One Gaussian fitted on the mapped fairways,
   greens and tees (eroded 3 m), one on the mapped woods; the log-likelihood ratio, the distance to the Red and
   White hole lines, and the mapped turf / bunkers / water (+1.5 m) are saved as `.npy`.
   **Re-running after v22.55:** the file's woods now include these auto pieces; train on the two OSM ones only
   (`w.get('q') == 'osm'`) or the trace learns from itself.
3. `python3 post.py 0` — trees = LR > 0, greenish (a < -4), dark (L < 42), textured (> 2), within 75 m of a Red or
   White hole line, off mapped turf; opened / closed, holes under 100 m² filled, pieces under 250 m² dropped.
4. `python3 poly.py` — mask → polygons (simplified 2 m) → `woods.json`.
5. `python3 carve.py` — cut every piece back 20 m from each Red and White tee (the hole line's first point;
   White 5 has no mapped tee pad and its tee sat on a tree edge) → `woods-final.json`, appended to the file's ways.
6. `python3 sheets.py` — per-hole review sheets, `trees-Red.jpg`, `trees-White.jpg`.

The Blue nine was not traced (Brett's Oct 11 round is Red → White); run 2–5 with Blue's hole lines to add it.
