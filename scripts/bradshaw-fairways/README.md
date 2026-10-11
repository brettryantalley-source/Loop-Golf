# Bradshaw fairways from the photo — DRAFT (C40, Oct 11; not shipped)

Brett, Oct 11: "clear places the fairway exists from the satellite image that are not included."
This tool grows Bradshaw's OSM fairways from the Esri photo in `bradshaw.json`'s `imagery.url`. The draft below was
made on Wayback 63116 (a winter capture: dormant rough, greener fairways); since v22.54 the file flies 41468, the
green Sep 2023 capture (D125), so a re-run uses that photo. Offline only (numpy, scipy, pillow, scikit-image, shapely);
nothing here is bundled or run by `npm test`.

Order (tiles and masks go to `$WORK`, default `/tmp/bradshaw-fairways`):

1. `python3 scripts/bradshaw-fairways/fetch.py 18` — the club's z18 tiles, stitched (442 tiles).
2. `python3 scripts/bradshaw-fairways/trace.py` — per hole: learn fairway (excess-green, smoothed
   texture) from the hole's OSM fairway and rough from the turf around it (median / MAD), classify the
   hole's own corridor (nearest hole line, within 45 m; trees, greens + 3 m, tees, bunkers, water out),
   clean up, keep pieces that touch the hole line or OSM's fairway, union with OSM. `LR` (env) is the
   log-likelihood threshold (0 for the draft). Writes `fairways-traced.json` (lat/lon rings).
3. `python3 scripts/bradshaw-fairways/show.py ["Red 2" …]` — per-hole sheets: OSM fairway yellow,
   additions cyan.

## Why it is not in the app

The fairway is only weakly separable from the rough in this photo (per hole d′ 0.6–4 on excess-green;
about 1 overall), so the additions mix real fairway edges OSM drew narrow (Blue 4, Blue 8, Blue 9)
with greenish rough (White 8's upper edge, a patch left of Red 2's fairway). On most holes OSM's
outline already follows the greener band. Adding wrong fairway changes lies and lay-up centres
(D90), so it waits for Brett: the review sheets are in `data/raw/2026-10-11/c40-review/`, the draft
rings in `data/extracted/2026-10-11-bradshaw-fairways-draft.json` (+25,100 m² over OSM's 122,000).

Draft additions over OSM by hole (m², LR 0): Red 1 702 · Red 2 573 · Red 3 201 · Red 4 1082 · Red 6 340
· Red 7 676 · Red 9 726 · White 1 698 · White 2 296 · White 3 263 · White 5 856 · White 7 2884 · White 8
1964 · White 9 237 · Blue 1 810 · Blue 2 1461 · Blue 3 2359 · Blue 4 2509 · Blue 6 1445 · Blue 8 3203 ·
Blue 9 1807; none on Red 5, Red 8, White 4, White 6, Blue 5, Blue 7.

To ship a hole: replace that hole's `golf=fairway` ways in `src/localGeometry/bradshaw.json` with the
draft's rings that sit on it, bump the file's `version`, run `npm test` and the smoke test.
