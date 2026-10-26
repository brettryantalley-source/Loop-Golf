#!/usr/bin/env python3
"""
tees.py — Bobby Jones's tee pads from USGS lidar (v22.72, D147). Offline: not in the build, not run by `npm test`.
numpy, scipy, shapely, pillow.

    python3 tees.py <club-pc.npz> [--review] [--apply]

OSM has no tee boxes at Bobby Jones, and the Longleaf system puts up to eight pads a hole. The bare-earth raster
baked for the trees (scripts/lidar-trees/raster.py, 3DEP 1 m) shows a tee pad as a flat shelf standing above the
ground around it: a cell is pad when the slope is under 2.5% and the ground stands 0.2 m or more over its
morphological opening (35 m window — anything a pad's size or smaller is lifted off). Pieces of 50–900 m² inside a
hole's tee corridor (120 m behind the line's start to the shortest tee's yardage ahead, 45 m either side), off the
mapped greens, bunkers and water. Each pad is measured to the green the way a card is (along the hole line) and
named for the card tee within 20 yds (teeboxes.js's rule).

--review writes review/<hole>.jpg: Fulton County's 2022 photo over the corridor with the pads (cyan), the line (red)
and each pad's yardage. --apply writes the pads into src/localGeometry/bobbyjones.json as `golf=tee` ways
(`q: "lidar+photo"`), the line of each hole re-started on its back pad, `source.tees`, and bumps `version`.
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from scipy import ndimage as ndi
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "..", "..", "src", "localGeometry", "bobbyjones.json")
R = 6378137.0
SLOPE_MAX, STEP_MIN, OPEN_M, AREA = 0.025, 0.20, 35, (50, 900)
BACK_M, SIDE_M = 120, 45
CARD = {  # GolfPass, the Azalea Nine: yards a hole, Tee 8 … Tee 1
    "Tee 8": [616, 223, 441, 329, 505, 402, 195, 486, 452], "Tee 7": [557, 200, 415, 315, 490, 377, 171, 465, 411],
    "Tee 6": [521, 179, 404, 300, 424, 360, 164, 425, 363], "Tee 5": [461, 162, 366, 270, 409, 314, 144, 378, 333],
    "Tee 4": [406, 145, 352, 241, 356, 282, 129, 338, 275], "Tee 3": [368, 131, 293, 215, 325, 244, 116, 308, 232],
    "Tee 2": [316, 112, 219, 177, 278, 212, 100, 265, 212], "Tee 1": [265, 95, 185, 155, 219, 176, 82, 220, 185],
}
YD = 1.09361

args = [a for a in sys.argv[1:] if not a.startswith("--")]
npz = args[0]
d = np.load(npz); x0, y0, x1, y1, cell = d["box"]
geo = json.load(open(FILE))
merc = lambda la, lo: (math.radians(lo) * R, R * math.log(math.tan(math.pi / 4 + math.radians(la) / 2)))
unmerc = lambda x, y: (math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R))
k = float(cell)                                               # mercator metres per ground metre

# --- the pad mask ---
g = d["ground"].astype(np.float64)
g = np.where(np.isnan(g), np.nanmedian(g), g)
gs = ndi.median_filter(g, size=3)
gy, gx = np.gradient(gs)                                      # per cell = per ground metre
slope = np.hypot(gx, gy)
opened = ndi.grey_opening(gs, size=(OPEN_M, OPEN_M))
step = gs - opened
canopy = np.where(d["cnt"] > 0, d["zmax"] - d["ground"], 0) > 3
pad = (slope < SLOPE_MAX) & (step > STEP_MIN) & ~canopy
pad = ndi.binary_opening(pad, iterations=1)
lab, n = ndi.label(pad)
print(f"{n} flat raised pieces on the raster")

def ring_m(pts): return [merc(*p) for p in pts]
holes = sorted([w for w in geo["ways"] if w["tags"].get("golf") == "hole" and int(w["tags"]["ref"]) <= 9], key=lambda w: int(w["tags"]["ref"]))
greens = [Polygon(ring_m(w["pts"])) for w in geo["ways"] if w["tags"].get("golf") == "green"]
off = unary_union([Polygon(ring_m(w["pts"])).buffer(0) for w in geo["ways"] if w.get("pts") and len(w["pts"]) > 2
                   and (w["tags"].get("golf") in ("green", "bunker", "water_hazard") or w["tags"].get("natural") == "water")])

def along_yards(line, green_c, p):
    """Card-style yards from p to the green centre: to the nearest point of the line (its first segment extended
    back), then along the line to its end, then to the green centre. Mercator metres / k = ground metres."""
    L = len(line.coords); best = None; acc = 0
    for i in range(L - 1):
        a, b = np.array(line.coords[i]), np.array(line.coords[i + 1]); v = b - a; ll = v @ v
        t = ((np.array(p) - a) @ v) / ll if ll else 0
        if i > 0: t = max(0, t)
        t = min(1, t)
        q = a + t * v; dd = np.hypot(*(np.array(p) - q))
        if best is None or dd < best[0]: best = (dd, acc + t * math.sqrt(ll))
        acc += math.sqrt(ll)
    return (acc - best[1] + math.hypot(*(np.array(line.coords[-1]) - np.array(green_c)))) / k * YD, best[0] / k

found = {}
for w in holes:
    n_ = int(w["tags"]["ref"]); line = LineString(ring_m(w["pts"]))
    gc = next((gp.centroid for gp in greens if gp.contains(Point(line.coords[-1]))), Point(line.coords[-1]))
    span = (CARD["Tee 8"][n_ - 1] - CARD["Tee 1"][n_ - 1]) / YD * k + 40 * k
    a, b = np.array(line.coords[0]), np.array(line.coords[1]); u = (b - a) / np.hypot(*(b - a))
    back = a - u * BACK_M * k
    # the corridor: the back extension plus the line out to the shortest tee, buffered sideways
    fwd = line.interpolate(min(span, line.length))
    corridor = LineString([tuple(back), tuple(a)] + [c for c in line.coords[1:] if LineString([a, c]).length <= span] + [(fwd.x, fwd.y)]).buffer(SIDE_M * k)
    pads = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        area = len(xs) / (k * k)
        if not (AREA[0] <= area <= AREA[1]): continue
        cx, cy = x0 + (xs.mean() + 0.5) * cell, y1 - (ys.mean() + 0.5) * cell
        if not corridor.contains(Point(cx, cy)): continue
        # the piece as a polygon: its cells' union, simplified
        cells = unary_union([Polygon([(x0 + x * cell, y1 - y * cell), (x0 + (x + 1) * cell, y1 - y * cell), (x0 + (x + 1) * cell, y1 - (y + 1) * cell), (x0 + x * cell, y1 - (y + 1) * cell)]) for x, y in zip(xs, ys)])
        poly = cells.simplify(1.0 * k).buffer(0.5 * k).simplify(0.8 * k)
        if isinstance(poly, MultiPolygon): poly = max(poly.geoms, key=lambda p: p.area)
        if off.intersects(poly) and off.intersection(poly).area > 0.3 * poly.area: continue
        yards, lateral = along_yards(line, (gc.x, gc.y), (cx, cy))
        hgt = float(np.median(step[ys, xs]))
        name = min(CARD, key=lambda t: abs(CARD[t][n_ - 1] - yards))
        if abs(CARD[name][n_ - 1] - yards) > 20: name = None
        pads.append({"poly": poly, "area": round(area), "step": round(hgt, 2), "yards": round(yards), "lateral": round(lateral / k), "tee": name, "c": (cx, cy)})
    pads.sort(key=lambda p: -p["yards"])
    found[n_] = {"line": line, "green": gc, "corridor": corridor, "pads": pads}
    print(f"hole {n_}: " + "; ".join(f"{p['yards']} yds {p['tee'] or '—'} ({p['area']} m², +{p['step']} m, {p['lateral']} m off the line)" for p in pads))

if "--review" in sys.argv:
    os.makedirs("review", exist_ok=True)
    for n_, h in found.items():
        minx, miny, maxx, maxy = h["corridor"].bounds
        W = int(min(2048, (maxx - minx) / k / 0.2)); H = int(W * (maxy - miny) / (maxx - minx))
        url = f"https://gismaps.fultoncountyga.gov/arcgispub/rest/services/Imagery/Pictometry2022_NAIP/MapServer/export?bbox={minx},{miny},{maxx},{maxy}&bboxSR=3857&imageSR=3857&size={W},{H}&format=jpg&f=image"
        img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Loop-Golf (offline tool)"}), timeout=120).read())).convert("RGBA")
        P = lambda x, y: ((x - minx) / (maxx - minx) * W, (maxy - y) / (maxy - miny) * H)
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
        dr.line([P(*c) for c in h["line"].coords], fill=(255, 40, 40, 255), width=3)
        for p in h["pads"]:
            dr.polygon([P(*c) for c in p["poly"].exterior.coords], fill=(0, 220, 255, 70), outline=(0, 220, 255, 255), width=2)
            tx, ty = P(*p["c"]); dr.rectangle([tx + 8, ty - 9, tx + 150, ty + 9], fill=(0, 0, 0, 160))
            dr.text((tx + 10, ty - 7), f"{p['yards']} yd {p['tee'] or '?'} +{p['step']}m", fill=(255, 255, 255, 255))
        for t, ys in CARD.items():                            # the card's distance marks along the line
            q = h["line"].interpolate(max(0, h["line"].length + h["green"].distance(Point(h["line"].coords[-1])) - ys[n_ - 1] / YD * k))
            x, y = P(q.x, q.y); dr.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 255, 0, 255), width=2)
        Image.alpha_composite(img, ov).convert("RGB").save(f"review/{n_}.jpg", quality=85)
    print("review/*.jpg written")

if "--apply" in sys.argv:
    ways = [w for w in geo["ways"] if not (w["tags"].get("golf") == "tee" and w.get("q") == "lidar+photo")]
    total = 0
    for n_, h in found.items():
        for p in h["pads"]:
            ring = [[round(v, 6) for v in unmerc(x, y)] for x, y in list(p["poly"].exterior.coords)[:-1]]
            ways.append({"tags": {"golf": "tee"}, "q": "lidar+photo", "pts": ring, "yards": p["yards"], "tee": p["tee"], "hole": n_})
            total += 1
    geo["ways"] = ways
    geo["version"] = int(geo.get("version", 1)) + 1
    geo["source"]["tees"] = ("Tee pads from USGS 3DEP lidar (GA_Statewide 2018, the raster baked for the trees): a flat shelf (slope under 2.5%) "
        "standing 0.2 m or more over its surroundings (35 m opening), 50-900 m2, in each hole's tee corridor, off the greens, bunkers and water; "
        "checked on Fulton County's 2022 photo (scripts/bobbyjones/tees.py, Oct 26 2026). q lidar+photo. A pad at grade with the fairway is not found this way.")
    json.dump(geo, open(FILE, "w"), separators=(",", ":"))
    print(f"wrote {total} tee pads, version {geo['version']}")
