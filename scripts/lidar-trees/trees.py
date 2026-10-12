#!/usr/bin/env python3
"""
trees.py — step 2 of the lidar trees: <club>-pc.npz (raster.py) → <club>-woods.json, the woods as the club file
stores them.

    python3 trees.py <club> [corridor_m=75]

A cell is tree when its highest point stands more than 3 m above the ground and it holds high-vegetation points
(class 5) — and not more building points than vegetation (houses and the clubhouse stay out). Closed and opened
by a cell (canopy gaps filled, specks dropped). Kept within `corridor_m` of a hole line, off every mapped green,
tee, fairway, bunker and water; clearings under 100 m² filled, pieces under 60 m² dropped (a lone tree's crown is
more), simplified 1.5 m and cut on a 90 m grid so each piece stays small for the app's point-in-polygon. A piece
with a clearing in it is written as `outer` / `inner`. numpy, scipy, opencv, shapely.
"""
import json, math, os, sys
import numpy as np, cv2
from scipy import ndimage as ndi
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from shapely import affinity

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "..", "src", "localGeometry")
R = 6378137.0
TREE_M, MIN_PIECE, MIN_HOLE, SIMPLIFY_M, TILE_M = 3.0, 60, 100, 1.5, 90

club = sys.argv[1]; corridor = float(sys.argv[2]) if len(sys.argv) > 2 else 75
d = np.load(f"{club}-pc.npz"); x0, y0, x1, y1, cell = d["box"]
geo = json.load(open(os.path.join(DIR, f"{club}.json")))
k = cell                                                     # mercator metres per ground metre
merc = lambda la, lo: (math.radians(lo) * R, R * math.log(math.tan(math.pi / 4 + math.radians(la) / 2)))
unmerc = lambda x, y: (math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R))

h = np.where(d["cnt"] > 0, d["zmax"] - d["ground"], 0)
T = (h > TREE_M) & (d["c5"] > 0) & (d["c6"] <= d["c5"])
T = ndi.binary_opening(ndi.binary_closing(T, iterations=1), iterations=1)

# grid → mercator polygons (cv2 contours with their holes)
cs, hier = cv2.findContours(T.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
to_m = lambda c: [(x0 + (p[0][0] + 0.5) * cell, y1 - (p[0][1] + 0.5) * cell) for p in c]
polys = []
for i, c in enumerate(cs):
    if hier[0][i][3] != -1 or len(c) < 3: continue           # an outer ring
    holes, j = [], hier[0][i][2]
    while j != -1:
        if len(cs[j]) >= 3: holes.append(to_m(cs[j]))
        j = hier[0][j][0]
    p = Polygon(to_m(c), holes).buffer(0)
    if not p.is_empty: polys.append(p)
trees = unary_union(polys)

def ring_m(pts): return [merc(*p) for p in pts]
def way_poly(w):
    if w.get("outer"):
        return unary_union([Polygon(ring_m(o)) for o in w["outer"]]).difference(unary_union([Polygon(ring_m(r)) for r in w.get("inner", [])] or [Polygon()]))
    return Polygon(ring_m(w["pts"])) if len(w.get("pts") or []) >= 3 else Polygon()
lines = unary_union([LineString(ring_m(w["pts"])) for w in geo["ways"] if w.get("tags", {}).get("golf") == "hole"])
TURF = {"green", "tee", "fairway", "bunker", "water_hazard", "lateral_water_hazard"}
turf = unary_union([way_poly(w).buffer(0) for w in geo["ways"]
                    if w.get("tags", {}).get("golf") in TURF or w.get("tags", {}).get("natural") == "water"])
trees = trees.intersection(lines.buffer(corridor * k)).difference(turf)
trees = trees.simplify(SIMPLIFY_M * k)

def clean(p):
    keep = [r for r in p.interiors if Polygon(r).area >= MIN_HOLE * k * k]
    return Polygon(p.exterior, keep)
gx0, gy0, gx1, gy1 = trees.bounds; t = TILE_M * k
out, area = [], 0.0
for gx in np.arange(gx0, gx1, t):
    for gy in np.arange(gy0, gy1, t):
        piece = trees.intersection(box(gx, gy, gx + t, gy + t))
        for p in getattr(piece, "geoms", [piece]):
            if p.geom_type != "Polygon" or p.area < MIN_PIECE * k * k: continue
            p = clean(p); area += p.area / (k * k)
            ll = lambda r: [[round(a, 6) for a in unmerc(x, y)] for x, y in r.coords]
            if p.interiors:
                out.append({"tags": {"natural": "wood"}, "q": "lidar", "outer": [ll(p.exterior)], "inner": [ll(r) for r in p.interiors]})
            else:
                out.append({"tags": {"natural": "wood"}, "q": "lidar", "pts": ll(p.exterior)})
json.dump({"survey": str(d["survey"]), "woods": out}, open(f"{club}-woods.json", "w"))
print(f"{club}: {len(out)} pieces, {area / 1e4:.1f} ha of trees within {corridor:.0f} m of the hole lines "
      f"({sum(1 for w in out if 'outer' in w)} with a clearing)")
