#!/usr/bin/env python3
"""
convert.py — Crystal Falls Golf Club (Dawsonville, GA) from an OpenStreetMap snapshot to a bundled club file
(v22.73, D148). Offline: not in the build, not run by `npm test`. Python 3 + shapely.

    python3 convert.py <map.osm> [--out=<file>] [--esri=<wayback release>] [--esriNote=<text>]

<map.osm> is an API 0.6 map call over the club (bbox -84.258,34.358,-84.218,34.388, Oct 30 2026).

OSM has the whole course: 18 hole ways (pars and handicaps agree with golfcourseapi's card on all 18), 18 greens,
76 tee boxes, 63 bunkers, fairways (7 ways + 11 multipolygons), two marked lateral water hazards, ponds, and the
club outline. Kept: everything golf within 100 m of a hole line, the streams (Yellow Creek and its feeders: OSM
waterway centrelines buffered 3.5 m each side, `q: osm+buffer`, the Creekside method), OSM's woods clipped to 120 m
(the lidar replaces them in the bake), and the club outline as the boundary when every hole line sits inside it.
"""
import json, math, sys, os
import xml.etree.ElementTree as ET
from shapely.geometry import LineString, Polygon, MultiPolygon, Point
from shapely.ops import polygonize, unary_union, linemerge

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {a.split("=")[0][2:]: a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
if len(args) < 1:
    print(__doc__); sys.exit(1)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = opts.get("out", os.path.join(HERE, "..", "..", "src", "localGeometry", "crystalfalls.json"))

HOLES = [str(908537651 + i) for i in range(18)]      # OSM way ids, holes 1-18 in order
PAR = [4, 4, 3, 5, 4, 3, 4, 5, 4, 5, 3, 4, 4, 4, 4, 4, 3, 5]      # golfcourseapi mman7dns (every tee)
SI = [7, 9, 15, 5, 1, 17, 3, 13, 11, 14, 18, 16, 4, 6, 8, 2, 12, 10]
OUTLINE = "1484399660"                               # leisure=golf_course "Crystal Falls Golf Club"
NEAR_M, WOOD_M, CREEK_HALF_M, RIVER_HALF_M = 100, 120, 3.5, 8

def load(path):
    t = ET.parse(path).getroot()
    nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon"))) for n in t.findall("node")}
    ways, rels = {}, {}
    for w in t.findall("way"):
        tags = {x.get("k"): x.get("v") for x in w.findall("tag")}
        pts = [nodes[nd.get("ref")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        ways[w.get("id")] = (tags, pts)
    for r in t.findall("relation"):
        tags = {x.get("k"): x.get("v") for x in r.findall("tag")}
        rels[r.get("id")] = (tags, [(m.get("role"), m.get("type"), m.get("ref")) for m in r.findall("member")])
    return ways, rels

ways, rels = load(args[0])

LAT0 = sum(p[0] for i in HOLES for p in ways[i][1]) / sum(len(ways[i][1]) for i in HOLES)
LON0 = sum(p[1] for i in HOLES for p in ways[i][1]) / sum(len(ways[i][1]) for i in HOLES)
K = math.cos(math.radians(LAT0)) * 111320.0
def xy(p): return ((p[1] - LON0) * K, (p[0] - LAT0) * 111320.0)
def ll(q): return [round(LAT0 + q[1] / 111320.0, 6), round(LON0 + q[0] / K, 6)]
def ring_ll(coords):
    c = list(coords)
    if len(c) > 1 and c[0] == c[-1]: c = c[:-1]
    return [ll(q) for q in c]

lines = [LineString([xy(p) for p in ways[i][1]]) for i in HOLES]
near = unary_union([l.buffer(NEAR_M) for l in lines])
nearWood = unary_union([l.buffer(WOOD_M) for l in lines])
def dist_to_lines(geom): return min(l.distance(geom) for l in lines)

out, counts = [], {}
def count(k): counts[k] = counts.get(k, 0) + 1

# 1. the hole lines
for n, i in enumerate(HOLES, 1):
    tags, pts = ways[i]
    assert tags.get("ref") == str(n) and int(tags.get("par")) == PAR[n - 1] and int(tags.get("handicap")) == SI[n - 1], (n, tags)
    out.append({"tags": {"golf": "hole", "ref": str(n), "par": str(PAR[n - 1]), "handicap": str(SI[n - 1])}, "q": "osm", "pts": [[round(p[0], 6), round(p[1], 6)] for p in pts], "id": int(i)})

# 2. greens: the ones the lines end in
greens = {}
for i, (tags, pts) in ways.items():
    if tags.get("golf") != "green" or len(pts) < 4: continue
    poly = Polygon([xy(p) for p in pts])
    ends = [n for n, l in enumerate(lines, 1) if poly.contains(Point(l.coords[-1]))]
    if ends: greens[i] = ends
assert len(greens) == 18 and sorted(e for v in greens.values() for e in v) == list(range(1, 19)), greens
for i in greens:
    tags, pts = ways[i]
    P = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    if pts[0] == pts[-1]: P = P[:-1]
    out.append({"tags": {"golf": "green", "landuse": "grass"}, "q": "osm", "pts": P, "id": int(i)}); count("green")

# 3. tees, bunkers, rough, water, fairway ways — within 100 m
def keep_way(i, tags, pts, newtags, q="osm"):
    poly = Polygon([xy(p) for p in pts])
    if dist_to_lines(poly) > NEAR_M: return False
    P = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    if pts[0] == pts[-1]: P = P[:-1]
    out.append({"tags": newtags, "q": q, "pts": P, "id": int(i)})
    count(newtags.get("golf") or newtags.get("natural"))
    return True
relMembers = {ref for _, (t, mem) in rels.items() if t.get("golf") == "fairway" for _, _, ref in mem}
for i, (tags, pts) in ways.items():
    if len(pts) < 4 or pts[0] != pts[-1]: continue
    g, nat = tags.get("golf"), tags.get("natural")
    if g == "tee": keep_way(i, tags, pts, {"golf": "tee"})
    elif g == "bunker": keep_way(i, tags, pts, {"golf": "bunker", "natural": "sand"})
    elif g == "rough": keep_way(i, tags, pts, {"golf": "rough"})
    elif g in ("water_hazard", "lateral_water_hazard"): keep_way(i, tags, pts, {"golf": "water_hazard", "natural": "water"})
    elif nat == "water" and tags.get("water") not in ("river",): keep_way(i, tags, pts, {"natural": "water", **({"name": tags["name"]} if tags.get("name") else {})})
    elif g == "fairway" and i not in relMembers: keep_way(i, tags, pts, {"golf": "fairway"})
    elif g == "fairway" and i in relMembers:
        roles = {role for _, (t, mem) in rels.items() if t.get("golf") == "fairway" for role, _, ref in mem if ref == i}
        if "inner" in roles: keep_way(i, tags, pts, {"golf": "fairway"})

# 4. multipolygons (fairways and woods): outer rings assembled, inner rings cut out
def assemble(members):
    segs = [LineString([xy(p) for p in ways[ref][1]]) for role, typ, ref in members if typ == "way" and ref in ways and len(ways[ref][1]) > 1]
    if not segs: return []
    merged = linemerge(segs) if len(segs) > 1 else segs[0]
    geoms = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    return [Polygon(g.coords) for g in geoms if g.is_ring or (len(g.coords) > 3 and g.coords[0] == g.coords[-1])]
for i, (tags, mem) in rels.items():
    kind = "fairway" if tags.get("golf") == "fairway" else ("wood" if tags.get("natural") == "wood" else None)
    if not kind: continue
    outers = assemble([m for m in mem if m[0] == "outer"])
    inners = assemble([m for m in mem if m[0] == "inner"])
    if not outers: print("relation", i, kind, "no closed outer ring (cut by the box?)", len(mem), "members"); continue
    for o in outers:
        if kind == "fairway":
            if dist_to_lines(o) > NEAR_M: continue
            ins = [r for r in inners if o.contains(r.representative_point())]
            out.append({"tags": {"golf": "fairway"}, "q": "osm", "outer": [ring_ll(o.exterior.coords)], "inner": [ring_ll(r.exterior.coords) for r in ins], "id": -int(i)})
            count("fairway(mp)")
        else:
            poly = o.buffer(0)
            for r in inners:
                if o.contains(r.representative_point()): poly = poly.difference(r.buffer(0))
            clipped = poly.intersection(nearWood)
            if clipped.is_empty: continue
            polys = list(clipped.geoms) if isinstance(clipped, MultiPolygon) else [clipped]
            for p in polys:
                if not isinstance(p, Polygon) or p.area < 4: continue
                p = p.simplify(0.3)
                out.append({"tags": {"natural": "wood"}, "q": "osm", "outer": [ring_ll(p.exterior.coords)], "inner": [ring_ll(r.coords) for r in p.interiors], "id": -int(i)})
                count("wood(mp)")

# 5. the creeks: centrelines buffered, clipped to 100 m of a line; the Etowah as a river
def emit_polys(geom, tags, q):
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else ([geom] if isinstance(geom, Polygon) else [])
    for p in polys:
        if p.area < 4: continue
        p = p.simplify(0.3)
        out.append({"tags": tags, "q": q, "pts": ring_ll(p.exterior.coords)})
        count(tags.get("name") or tags.get("natural") or "water")
for i, (tags, pts) in ways.items():
    ww = tags.get("waterway")
    if ww not in ("stream", "river") or tags.get("tunnel") or len(pts) < 2: continue
    l = LineString([xy(p) for p in pts])
    if l.distance(near) > 0: continue
    half = RIVER_HALF_M if ww == "river" else CREEK_HALF_M
    emit_polys(l.buffer(half, cap_style=2).intersection(near), {"golf": "water_hazard", "natural": "water", **({"name": tags["name"]} if tags.get("name") else {})}, "osm+buffer")

# 6. woods (ways) clipped to 120 m
for i, (tags, pts) in ways.items():
    if tags.get("natural") != "wood" or len(pts) < 4 or pts[0] != pts[-1]: continue
    poly = Polygon([xy(p) for p in pts]).buffer(0)
    clipped = poly.intersection(nearWood)
    if clipped.is_empty: continue
    emit_polys(clipped, {"natural": "wood"}, "osm")

# 7. the boundary: bundled when every hole-line point sits inside it
otags, opts_ = ways[OUTLINE]
outline = Polygon([xy(p) for p in opts_])
outside = [(n, k, round(outline.exterior.distance(Point(xy(p))), 1)) for n, i in enumerate(HOLES, 1) for k, p in enumerate(ways[i][1]) if not outline.contains(Point(xy(p)))]
greensOut = [i for i in greens if not outline.contains(Polygon([xy(p) for p in ways[i][1]]))]
print("outline: hole-line points outside it (hole, node, m):", outside, "greens outside:", greensOut)
if not outside and not greensOut:
    P = [[round(p[0], 6), round(p[1], 6)] for p in opts_]
    if opts_[0] == opts_[-1]: P = P[:-1]
    out.append({"tags": {"leisure": "golf_course", "name": otags.get("name", "Crystal Falls Golf Club")}, "q": "osm", "pts": P, "id": int(OUTLINE)}); count("golf_course")

print(counts)
esri = opts.get("esri", "43291")
data = {
    "version": 1,
    "apiId": "mman7dns",
    "name": "Crystal Falls Golf Club",
    "city": "Dawsonville, GA",
    "traced": "2026-10-30",
    "shiftM": [0, 0],
    "source": {
        "method": "OpenStreetMap as drawn (API 0.6 map call, Oct 30 2026), filtered to the club: the 18 hole ways (pars and handicaps agree with golfcourseapi's card on all 18), the 18 greens the lines end in, tee boxes, bunkers, fairways (OSM's multipolygons with their bunkers and islands cut out), rough, ponds and the marked lateral hazards within 100 m of a hole line, woods within 120 m, the club outline as the boundary. Made by scripts/crystalfalls/convert.py.",
        "osm": "© OpenStreetMap contributors, ODbL",
        "caveat": "Not traced by hand: as accurate as OSM. Yellow Creek and its feeders are OSM waterway centrelines buffered 3.5 m each side (q osm+buffer, as at Creekside), so a ball read as water is a ball within ~4 m of the mapped centreline; a wider pool reads rough. Not field-checked.",
    },
    "imagery": {
        "url": f"https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{esri}/{{z}}/{{y}}/{{x}}",
        "tileSize": 256, "maxzoom": 19, "zooms": [17, 18, 19], "probeZoom": 18,
        "credit": "© Esri, Maxar, Earthstar Geographics",
        "release": opts.get("esriNote", "World Imagery Wayback release " + esri),
    },
    "ways": out,
}
json.dump(data, open(OUT, "w"), separators=(",", ":"))
print("wrote", OUT, len(out), "ways", os.path.getsize(OUT) // 1024, "KB")
