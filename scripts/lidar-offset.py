#!/usr/bin/env python3
"""
lidar-offset.py — how far a bundled course map sits from the ground, measured against USGS 3DEP lidar
(v22.61, C13, D132). Offline tool: not in the build, not run by `npm test`. numpy, scipy, pillow, scikit-image.

    python3 scripts/lidar-offset.py [club …]      # default: woodmont chicopee riverpines hampton bradshaw

A bunker is a dip in the ground of a few tenths of a metre, which 1 m lidar sees plainly. For each club this
fetches a 1 m elevation raster over its bunkers (the 3DEP ImageServer's exportImage, Web Mercator, ~1 m px),
takes the local relief (the ground minus itself smoothed over ~7 m), and slides every traced bunker polygon
over it, ±16 m east and north: where the bunkers sit deepest is where the map belongs. It prints the mean
relief inside the bunkers as traced and at the best shift, the profile either side, and the median of each
bunker's own best shift. A shift worth applying goes into the file's `shiftM` ([east, north] metres) with a
`version` bump (src/localGeometry.js); then re-run scripts/fetch-green-slopes.mjs for that club, since the
green grids are sampled where the greens were.

Lidar's horizontal accuracy is about a metre and NAD83 sits about a metre from the phone's WGS84, so a best
shift under ~2 m is no shift.
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from skimage.draw import polygon as rpoly

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "src", "localGeometry")
EXPORT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
R = 6378137.0
PAD_M, SEARCH_M, SIGMA_PX, MAX_PX = 80, 16, 8, 8000


def merc(lat, lon):
    return math.radians(lon) * R, R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def fetch_dem(x0, y0, x1, y1):
    w, h = int(round(x1 - x0)), int(round(y1 - y0))
    if w > MAX_PX or h > MAX_PX:
        raise SystemExit(f"area {w}×{h} px is over the service's {MAX_PX}: split it")
    q = (f"bbox={x0:.2f},{y0:.2f},{x1:.2f},{y1:.2f}&bboxSR=3857&imageSR=3857&size={w},{h}&format=tiff"
         "&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image")
    req = urllib.request.Request(f"{EXPORT}?{q}", headers={"User-Agent": "Loop-Golf lidar-offset (offline tool)"})
    with urllib.request.urlopen(req, timeout=300) as r:
        a = np.array(Image.open(io.BytesIO(r.read()))).astype(np.float64)
    a[a < -1000] = np.nan
    return a


def run(club):
    geo = json.load(open(os.path.join(DIR, f"{club}.json")))
    sE, sN = geo.get("shiftM") or [0, 0]
    bunkers = [w["pts"] for w in geo["ways"] if w.get("tags", {}).get("golf") == "bunker" and len(w.get("pts") or []) >= 3]
    if not bunkers:
        print(f"{club}: no bunkers"); return
    lat0 = float(np.mean([p[0] for b in bunkers for p in b]))
    k = 1 / math.cos(math.radians(lat0))                 # Web Mercator metres per ground metre
    shifted = [[(la + sN / 111320, lo + sE / (111320 * math.cos(math.radians(la)))) for la, lo in b] for b in bunkers]
    xs, ys = zip(*(merc(la, lo) for b in shifted for la, lo in b))
    pad = PAD_M * k
    x0, y0, x1, y1 = min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad
    dem = fetch_dem(x0, y0, x1, y1)
    H, W = dem.shape
    fill = np.where(np.isnan(dem), np.nanmean(dem), dem)
    rel = fill - gaussian_filter(fill, SIGMA_PX)
    masks = []
    for b in shifted:
        cs = [merc(la, lo) for la, lo in b]
        cols = np.array([(x - x0) * W / (x1 - x0) for x, _ in cs]); rows = np.array([(y1 - y) * H / (y1 - y0) for _, y in cs])
        rr, cc = rpoly(rows, cols, (H, W))
        if len(rr) >= 6: masks.append((rr, cc))
    S = int(SEARCH_M * k)
    rng = range(-S, S + 1)

    def score(ms, di, dj):
        v = []
        for rr, cc in ms:
            r2, c2 = rr + dj, cc + di
            ok = (r2 >= 0) & (r2 < H) & (c2 >= 0) & (c2 < W)
            if ok.any(): v.append(rel[r2[ok], c2[ok]].mean())
        return float(np.mean(v)) if v else 0.0

    table = {(di, dj): score(masks, di, dj) for dj in rng for di in rng}
    (bi, bj), best = min(table.items(), key=lambda t: t[1])
    e, n = bi / k, -bj / k
    print(f"{club}: {len(masks)} bunkers · relief inside as traced {table[(0, 0)]:+.3f} m · deepest {best:+.3f} m at "
          f"east {e:+.1f} m, north {n:+.1f} m ({math.hypot(e, n):.1f} m)")
    prof = lambda f: " ".join(f"{d:+d}:{f(round(d * k)):+.2f}" for d in (-6, -3, -2, -1, 0, 1, 2, 3, 6))
    print(f"  east profile (m: relief)  {prof(lambda d: table.get((bi + d, bj), float('nan')))}")
    print(f"  north profile (m: relief) {prof(lambda d: table.get((bi, bj - d), float('nan')))}")
    own = []
    for m in masks:
        (oi, oj), s = min((((di, dj), score([m], di, dj)) for dj in rng for di in rng), key=lambda t: t[1])
        if s < -0.15: own.append((oi / k, -oj / k))
    if own:
        a = np.array(own)
        print(f"  each bunker's own deepest (n={len(a)}): median east {np.median(a[:, 0]):+.1f} m, north {np.median(a[:, 1]):+.1f} m")


for c in (sys.argv[1:] or ["woodmont", "chicopee", "riverpines", "hampton", "bradshaw"]):
    run(c)
