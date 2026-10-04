"""build_data.py — trace3/*.json + global.json  ->  <repo>/src/localGeometry/woodmont.json (compact: ways with [lat,lon] arrays).
   Everything in the traces is z18 mosaic px; to_ll() turns it into lat/lon. Rounded to 6 decimals (~0.11 m)."""
import sys, json, os
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from shapely.geometry import Polygon, LineString
from shapely.geometry.polygon import orient

REPO = "/home/user/Loop-Golf"
OUT = f"{REPO}/src/localGeometry/woodmont.json"
MPP18 = mpp(34.2315, 18)                      # metres per z18 px
tol = lambda m: m / MPP18                     # metres -> z18 px
PARS = [5, 3, 4, 4, 4, 3, 4, 4, 5, 5, 3, 4, 3, 4, 3, 5, 4, 5]

def ll_pts(px_pts):
    out = []
    for x, y in px_pts:
        lat, lon = to_ll(x, y, 18)
        out.append([round(lat, 6), round(lon, 6)])
    return out

def poly_way(tags, px_ring, simplify_m, q):
    P = Polygon(px_ring)
    if not P.is_valid: P = P.buffer(0)
    if P.geom_type == "MultiPolygon": P = max(P.geoms, key=lambda g: g.area)
    P = orient(P.simplify(tol(simplify_m), preserve_topology=True), 1.0)
    ring = [tuple(p) for p in P.exterior.coords]
    if len(ring) < 5: return None
    pts = ll_pts(ring)
    pts[-1] = pts[0]                                       # closed
    return dict(tags=tags, q=q, pts=pts)

ways = []
holes = {n: json.load(open(f"{S}/trace3/hole{n}.json")) for n in range(1, 19)}
for n in range(1, 19):
    h = holes[n]
    line = LineString(h["line"]).simplify(tol(1.2))
    ways.append(dict(tags={"golf": "hole", "ref": str(n), "par": str(PARS[n - 1])}, q="traced", pts=ll_pts(list(line.coords))))
    w = poly_way({"golf": "green"}, h["green"], 0.25, "hand" if n in (7, 13, 18) else "traced")
    if w: ways.append(w)
    for t in h["tees"]:
        w = poly_way({"golf": "tee"}, t["poly"], 0.25, "est" if t["note"] == "ellipse" else "traced")
        if w: ways.append(w)
    for f in h["fairways"]:
        w = poly_way({"golf": "fairway"}, f, 0.8, "traced")
        if w: ways.append(w)
G = json.load(open(f"{S}/trace3/global.json"))
for b in G["bunkers"]:
    w = poly_way({"golf": "bunker"}, b, 0.25, "traced")
    if w: ways.append(w)
for wt in G["water"]:
    tags = {"golf": wt["kind"]}
    if wt.get("name"): tags["name"] = wt["name"]
    w = poly_way(tags, wt["poly"], 0.6, "osm" if wt["kind"] == "water_hazard" else "osm+buffer")
    if w: ways.append(w)

doc = dict(
    version=1, apiId="tnw4ghn5", name="Woodmont Golf & Country Club", city="Canton, GA",
    traced="2026-10-02",
    shiftM=[0, 0],
    source=dict(
        method="Hand-assisted trace from aerial imagery: greens, tee boxes, fairways and bunkers read off 0.25 m/px tiles (colour + shape) and checked by eye hole by hole; hole lines from the tee to the green centre; hole numbers set from the scorecard (pars, yardages) and confirmed by Brett.",
        imagery=["Esri World Imagery, captured 2025-10-10 (0.34 m, leaf-on): fairways, bunkers, tee boxes, greens", "Esri World Imagery, captured 2026-01-04 (0.34 m, leaf-off): hole 1 fairway, cross-checks"],
        osm="Lake polygons (natural=water) and creek centrelines (waterway=stream, buffered 3.5 m each side) from OpenStreetMap contributors, ODbL, read 2026-10-02.",
        hand=dict(greens=[7, 13, 18], teesFromBrett=[8, 18], teesEstimated="all `q: est` tee boxes are ellipses drawn on the pad centre, not traced outlines"),
        accuracy="Not field-surveyed. Aerial imagery registers to within a few metres of true position; `shiftM` ([east, north] metres) applies one global correction once the greens have been checked with GPS on the course.",
        attribution="Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community.",
    ),
    ways=ways,
)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
txt = json.dumps(doc, separators=(",", ":"), ensure_ascii=False)
open(OUT, "w").write(txt + "\n")
from collections import Counter
c = Counter((w["tags"]["golf"]) for w in ways)
print("wrote", OUT, f"{len(txt)/1024:.0f} KB", dict(c), "points:", sum(len(w["pts"]) for w in ways))
