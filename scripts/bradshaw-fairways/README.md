# Bradshaw fairways from the photo (C40; draft Oct 11, shipped v22.63, D135)

Brett, Oct 11: "clear places the fairway exists from the satellite image that are not included."
This tool grows Bradshaw's OSM fairways from an Esri photo. Offline only (numpy, scipy, pillow, scikit-image,
shapely; Node 18+ for `apply.mjs`); nothing here is bundled or run by `npm test`.

Any bundled club (Oct 23): `CLUB=creekside` (the file under `src/localGeometry/`, default `bradshaw`) runs steps 1–4 on
that club; holes are read by `name`, else `ref`. `apply.mjs` still writes Bradshaw only. Creekside's run on its Mar 2026
dormant capture (`RELEASE=22869`) found nothing worth shipping (OPEN-ITEMS F46).

Order (tiles and masks go to `$WORK`, default `/tmp/$CLUB-fairways`):

1. `RELEASE=63116 python3 scripts/bradshaw-fairways/fetch.py 18` — the club's z18 tiles from the winter capture
   (dormant tan rough, green fairway), stitched (442 tiles). Without `RELEASE` it fetches the file's own photo
   (41468, the green Sep 2023 capture the app flies).
2. `python3 scripts/bradshaw-fairways/trace.py` — per hole: learn fairway (excess-green, smoothed texture) from the
   hole's OSM fairway and rough from the turf around it (median / MAD), classify the hole's own corridor (nearest hole
   line, within 45 m; the file's lidar woods, dark or textured pixels, greens + 3 m, tees, bunkers and water out),
   clean up, keep pieces that touch the hole line or OSM's fairway. `LR` (env) is the log-likelihood threshold (0).
   Writes `fw_traced.npy`, `fairways-traced.json` and `additions.json` (each addition with its hole's d′, its mean
   log-likelihood, its area, whether it touches OSM's fairway, its ring).
3. `python3 scripts/bradshaw-fairways/show.py ["Red 2" …]` — per-hole sheets: OSM fairway yellow, additions cyan.
4. `python3 scripts/bradshaw-fairways/ship.py` — the clear pieces only: d′ ≥ 2.8, log-likelihood ≥ 6, ≥ 150 m²,
   touching the hole's OSM fairway; each grown 0.6 m and unioned into that OSM way (id and bunker holes kept) →
   `fairways-ship.json`.
5. `node scripts/bradshaw-fairways/apply.mjs [--out=<file>]` — writes them into `src/localGeometry/bradshaw.json`
   (`q: "osm+photo"`, `source.fairways`, `version` + 1).

## What shipped and why only that

On the Sep 2023 photo the fairway barely separates from the rough (d′ often under 2), and its additions agreed with the
winter photo's on only 5,800 of 42,000 m². On the winter photo the Blue nine separates plainly (d′ 2.8–4.8). v22.63
shipped seven grown fairways — Blue 3, 4 (two), 6, 8, 9 and White 1, +7,956 m² over OSM's 122,000 — and left out
everything less certain: White 8's upper strip (log-likelihood 5.0, which the Oct 11 review read as greenish rough),
the Red nine's slivers, any piece not touching OSM's fairway. The Oct 11 review sheets are in
`data/raw/2026-10-11/c40-review/`, the Oct 11 draft rings in `data/extracted/2026-10-11-bradshaw-fairways-draft.json`.
