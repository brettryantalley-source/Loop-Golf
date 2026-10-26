#!/usr/bin/env python3
"""
convert.py — Bobby Jones Golf Course (Atlanta), the Azalea routing, from an OpenStreetMap snapshot to a bundled
club file (v22.71, D146). Offline: not in the build, not run by `npm test`. Python 3 + shapely.

    python3 convert.py <map.osm> <peachtree.osm> [--out=<file>]

<map.osm> is an API 0.6 map call over the club (bbox -84.4095,33.8120,-84.3960,33.8215, Oct 26 2026);
<peachtree.osm> is relation 113167 (Peachtree Creek as a water area) fetched with /full, since the map call cuts
its member ways at the box.

The course is a reversible nine (Bob Cupp, 2018): the Azalea routing runs counter-clockwise to the red flags, the
Magnolia routing clockwise to the white ones, on nine double greens. OSM has both routings' hole ways, each nine
numbered 1–9. An 18 at Loop is the Azalea nine played twice, so the nine hole lines are written twice, as refs 1–9
and 10–18, sharing their greens, fairways and hazards; Magnolia's lines are left out (the snapshot holds them, so a
Magnolia file is one run of a sibling converter away).

Kept: the 9 Azalea hole ways (pars the card's; OSM's agree), the 9 greens their lines end in (the Cupp Links short
course's greens, 50–270 m off, are not), bunkers, fairways (multipolygons with their bunkers, greens and rough
islands cut out), rough and ponds within 100 m of an Azalea line, the creeks (Tanyard Creek and its feeders:
OSM waterway centrelines buffered 3.5 m each side, `q: osm+buffer`, the Creekside method; Peachtree Creek: OSM's
water area clipped to 100 m of a line, `q: osm+clip`), OSM's woods clipped to 120 m, and the club outline as the
outline left out (it predates the rebuild; OB off). No tee boxes: OSM has none here.
"""
import json, math, sys, os
import xml.etree.ElementTree as ET
from shapely.geometry import LineString, Polygon, MultiPolygon, Point
from shapely.ops import polygonize, unary_union, linemerge

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {a.split("=")[0][2:]: a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--") and "=" in a}
if len(args) < 2:
    print(__doc__); sys.exit(1)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = opts.get("out", os.path.join(HERE, "..", "..", "src", "localGeometry", "bobbyjones.json"))

AZALEA = ["1210830261", "1210830262", "1210830263", "1210830264", "1210830265", "1210830266", "1210830267", "1210830268", "1210830269"]
PAR = [5, 3, 4, 4, 5, 4, 3, 4, 4]                   # the card (GolfPass, Tee 8 … Tee 1 all share it)
OUTLINE = "29354026"                                 # leisure=golf_course "Bobby Jones Golf Club"
NEAR_M, WOOD_M, CREEK_HALF_M = 100, 120, 3.5

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
pways, prels = load(args[1])

# a local flat frame in metres (x east, y north) around the course, so shapely's buffers are metres
LAT0 = sum(p[0] for i in AZALEA for p in ways[i][1]) / sum(len(ways[i][1]) for i in AZALEA)
LON0 = sum(p[1] for i in AZALEA for p in ways[i][1]) / sum(len(ways[i][1]) for i in AZALEA)
K = math.cos(math.radians(LAT0)) * 111320.0
def xy(p): return ((p[1] - LON0) * K, (p[0] - LAT0) * 111320.0)
def ll(q): return [round(LAT0 + q[1] / 111320.0, 6), round(LON0 + q[0] / K, 6)]
def ring_ll(coords):
    c = list(coords)
    if len(c) > 1 and c[0] == c[-1]: c = c[:-1]
    return [ll(q) for q in c]

lines = [LineString([xy(p) for p in ways[i][1]]) for i in AZALEA]
near = unary_union([l.buffer(NEAR_M) for l in lines])
nearWood = unary_union([l.buffer(WOOD_M) for l in lines])
def dist_to_lines(geom): return min(l.distance(geom) for l in lines)

out = []
# 1. the hole lines, twice
for n, i in enumerate(AZALEA, 1):
    tags, pts = ways[i]
    assert int(tags.get("par")) == PAR[n - 1], (n, tags)
    P = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    out.append({"tags": {"golf": "hole", "ref": str(n), "par": str(PAR[n - 1])}, "q": "osm", "pts": P, "id": int(i)})
for n, i in enumerate(AZALEA, 1):
    tags, pts = ways[i]
    P = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    out.append({"tags": {"golf": "hole", "ref": str(n + 9), "par": str(PAR[n - 1])}, "q": "osm", "pts": P})

# 2. greens: the ones the lines end in
greens = {}
for i, (tags, pts) in ways.items():
    if tags.get("golf") != "green" or len(pts) < 4: continue
    poly = Polygon([xy(p) for p in pts])
    ends = [n for n, l in enumerate(lines, 1) if poly.contains(Point(l.coords[-1]))]
    if ends: greens[i] = ends
assert len(greens) == 9, greens
for i, ends in greens.items():
    tags, pts = ways[i]
    out.append({"tags": {"golf": "green", "landuse": "grass"}, "q": "osm", "pts": [[round(p[0], 6), round(p[1], 6)] for p in pts if True][:-1] if pts[0] == pts[-1] else [[round(p[0], 6), round(p[1], 6)] for p in pts], "id": int(i)})

# 3. bunkers, rough, ponds, the marked water hazard, fairway ways — within 100 m
counts = {}
def keep_way(i, tags, pts, newtags, q="osm"):
    poly = Polygon([xy(p) for p in pts])
    if dist_to_lines(poly) > NEAR_M: return False
    P = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    if pts[0] == pts[-1]: P = P[:-1]
    out.append({"tags": newtags, "q": q, "pts": P, "id": int(i)})
    k = newtags.get("golf") or newtags.get("natural"); counts[k] = counts.get(k, 0) + 1
    return True
relMembers = {ref for _, (t, mem) in rels.items() if t.get("golf") == "fairway" for _, _, ref in mem}
for i, (tags, pts) in ways.items():
    if len(pts) < 4 or pts[0] != pts[-1]: continue
    g, nat = tags.get("golf"), tags.get("natural")
    if g == "bunker": keep_way(i, tags, pts, {"golf": "bunker", "natural": "sand"})
    elif g == "rough": keep_way(i, tags, pts, {"golf": "rough"})
    elif g == "water_hazard": keep_way(i, tags, pts, {"golf": "water_hazard", "natural": "water"})
    elif nat == "water" and tags.get("water") in ("pond", "lake", "reservoir"): keep_way(i, tags, pts, {"natural": "water"})
    elif g == "fairway" and i not in relMembers: keep_way(i, tags, pts, {"golf": "fairway"})
    elif g == "fairway" and i in relMembers:
        # a fairway way that is also a relation member: an outer stands with the relation, an inner is a fairway on its own
        roles = {role for _, (t, mem) in rels.items() if t.get("golf") == "fairway" for role, _, ref in mem if ref == i}
        if "inner" in roles: keep_way(i, tags, pts, {"golf": "fairway"})

# 4. fairway multipolygons: outer rings assembled, inner rings cut out
def assemble(members):
    segs = [LineString([xy(p) for p in ways[ref][1]]) for role, typ, ref in members if typ == "way" and ref in ways and len(ways[ref][1]) > 1]
    merged = linemerge(segs) if len(segs) > 1 else (segs[0] if segs else None)
    if merged is None: return []
    geoms = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    return [Polygon(g.coords) for g in geoms if g.is_ring or (len(g.coords) > 3 and g.coords[0] == g.coords[-1])]
for i, (tags, mem) in rels.items():
    if tags.get("golf") != "fairway": continue
    outers = assemble([m for m in mem if m[0] == "outer"])
    inners = assemble([m for m in mem if m[0] == "inner"])
    if not outers: print("relation", i, "no closed outer ring", [m[2] for m in mem]); continue
    for o in outers:
        if dist_to_lines(o) > NEAR_M: continue
        ins = [r for r in inners if o.contains(r.representative_point())]
        out.append({"tags": {"golf": "fairway"}, "q": "osm", "outer": [ring_ll(o.exterior.coords)], "inner": [ring_ll(r.exterior.coords) for r in ins], "id": -int(i)})
        counts["fairway(mp)"] = counts.get("fairway(mp)", 0) + 1

# 5. the creeks: centrelines buffered, clipped; Peachtree Creek's water area clipped
def emit_polys(geom, tags, q):
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else ([geom] if isinstance(geom, Polygon) else [])
    for p in polys:
        if p.area < 4: continue
        p = p.simplify(0.3)
        out.append({"tags": tags, "q": q, "pts": ring_ll(p.exterior.coords)})
        counts[tags.get("name") or tags.get("natural") or "water"] = counts.get(tags.get("name") or tags.get("natural") or "water", 0) + 1
pc_polys = list(polygonize(unary_union([LineString([xy(p) for p in pts]) for _, pts in pways.values() if len(pts) > 1])))
peachtree = unary_union(pc_polys) if pc_polys else None
if peachtree is not None and not peachtree.is_empty:
    emit_polys(peachtree.intersection(near), {"natural": "water", "name": "Peachtree Creek"}, "osm+clip")
pc_ids = set(pways.keys())
for i, (tags, pts) in ways.items():
    if tags.get("waterway") != "stream" or tags.get("tunnel") or len(pts) < 2: continue
    if tags.get("name") == "Peachtree Creek" and peachtree is not None and not peachtree.is_empty: continue
    l = LineString([xy(p) for p in pts])
    if l.distance(near) > 0: continue
    emit_polys(l.buffer(CREEK_HALF_M, cap_style=2).intersection(near), {"golf": "water_hazard", "natural": "water", **({"name": tags["name"]} if tags.get("name") else {})}, "osm+buffer")

# 6. woods clipped to 120 m
for i, (tags, pts) in ways.items():
    if tags.get("natural") != "wood" or len(pts) < 4: continue
    poly = Polygon([xy(p) for p in pts]).buffer(0)
    clipped = poly.intersection(nearWood)
    if clipped.is_empty: continue
    emit_polys(clipped, {"natural": "wood"}, "osm")

# 7. the boundary: OSM's club outline predates the 2018 rebuild (it is tagged "closed for renovation"): the 9th green
# (904 m2) and the 1st tee (40 m) lie outside it, so it is not bundled and OB is off, as at Woodmont (D88).
otags, opts_ = ways[OUTLINE]
outline = Polygon([xy(p) for p in opts_])
outside = [(n, k, round(outline.exterior.distance(Point(xy(p))), 1)) for n, i in enumerate(AZALEA, 1) for k, p in enumerate(ways[i][1]) if not outline.contains(Point(xy(p)))]
print("outline: line points outside it (hole, node, m):", outside, "— not bundled, OB off")

print(counts)
data = {
    "version": 1,
    "apiId": "bobbyjones-azalea",
    "name": "Bobby Jones Golf Course — Azalea",
    "city": "Atlanta, GA",
    "traced": "2026-10-26",
    "shiftM": [0, 0],
    "loop": 9,
    "source": {
        "method": "OpenStreetMap as drawn (API 0.6 map call, Oct 26 2026), filtered to the Azalea routing of a reversible nine: its 9 hole ways written twice (refs 1-9 and 10-18: an 18 here is the nine played twice; Magnolia's 9 ways left out), the 9 double greens the lines end in, bunkers, fairways (OSM's multipolygons with greens, bunkers and rough islands cut out), rough and ponds within 100 m of a hole line, woods within 120 m. Pars are the card's (GolfPass scorecard); OSM's agree on all 9. Made by scripts/bobbyjones/convert.py.",
        "osm": "© OpenStreetMap contributors, ODbL",
        "caveat": "Not traced by hand: as accurate as OSM. No tee boxes: OSM has none here, so the hole line starts at one tee and the Longleaf tees (8 a hole) are not drawn. The Cupp Links short course's greens and bunkers (50-270 m off the Azalea lines) are left out. Tanyard Creek and its feeders are OSM waterway centrelines buffered 3.5 m each side (q osm+buffer, as at Creekside), so a ball read as water is a ball within ~4 m of the mapped centreline; Peachtree Creek is OSM's water area clipped to 100 m of a hole line (q osm+clip). No boundary: OSM's club outline (way 29354026, tagged closed for renovation) predates the 2018 rebuild and leaves the 9th green and the 1st tee outside it, so OB is off, as at Woodmont.",
    },
    "imagery": {
        "url": "https://gismaps.fultoncountyga.gov/arcgispub/rest/services/Imagery/Pictometry2022_NAIP/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image",
        "tileSize": 256, "maxzoom": 19, "zooms": [17, 18, 19], "probeZoom": 18,
        "credit": "© Fulton County GIS, EagleView",
        "release": "Fulton County's Pictometry 2022 orthophoto (winter: dormant turf, bare trees), Fulton County GIS's public map service, one 512-px export per 256-px tile (~0.12 m on screen at level 19). No licence stated (P10, D140).",
    },
    "imageryEsri": {
        "url": f"https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{opts.get('esri', '41468')}/{{z}}/{{y}}/{{x}}",
        "tileSize": 256, "maxzoom": 19, "zooms": [17, 18, 19], "probeZoom": 18,
        "credit": "© Esri, Maxar, Earthstar Geographics",
        "release": opts.get("esriNote", "World Imagery Wayback release " + opts.get("esri", "41468")),
    },
    "ways": out,
}
json.dump(data, open(OUT, "w"), separators=(",", ":"))
print("wrote", OUT, len(out), "ways", os.path.getsize(OUT) // 1024, "KB")
