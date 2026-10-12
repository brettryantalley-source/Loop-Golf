#!/usr/bin/env python3
"""
sheets.py — step 4 of the lidar trees: a review sheet per hole, the club's own photo (its `imagery.url`, z18) with
the old woods (red outline), the new ones (cyan fill) and the mapped fairways (yellow).

    python3 sheets.py <club> <new.json> [nameRegex]   # writes sheets/<hole>.jpg in the current directory
"""
import io, json, math, os, re, sys, urllib.request
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
club, newf = sys.argv[1], sys.argv[2]; rx = re.compile(sys.argv[3] if len(sys.argv) > 3 else ".")
old = json.load(open(os.environ.get("OLD") or os.path.join(HERE, "..", "..", "src", "localGeometry", f"{club}.json"))); new = json.load(open(newf))
Z = 18; os.makedirs("sheets", exist_ok=True); os.makedirs("tiles", exist_ok=True)
def tile_xy(lat, lon):
    n = 2 ** Z; return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
def tile(x, y):
    p = f"tiles/{Z}-{x}-{y}.jpg"
    if not os.path.exists(p):
        url = new["imagery"]["url"].replace("{z}", str(Z)).replace("{x}", str(x)).replace("{y}", str(y))
        req = urllib.request.Request(url, headers={"User-Agent": "Loop-Golf lidar-trees (offline tool)"})
        open(p, "wb").write(urllib.request.urlopen(req, timeout=60).read())
    return Image.open(p).convert("RGB")
rings = lambda w: w["outer"] + w.get("inner", []) if w.get("outer") else [w["pts"]]
label = lambda w: w["tags"].get("name") or f'hole {w["tags"].get("ref", "")}'
for h in [w for w in new["ways"] if w.get("tags", {}).get("golf") == "hole" and rx.search(label(w))]:
    lats = [p[0] for p in h["pts"]]; lons = [p[1] for p in h["pts"]]
    m = 0.0009
    ax, ay = tile_xy(max(lats) + m, min(lons) - m * 1.2); bx, by = tile_xy(min(lats) - m, max(lons) + m * 1.2)
    tx0, ty0, tx1, ty1 = int(ax), int(ay), int(bx), int(by)
    img = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for x in range(tx0, tx1 + 1):
        for y in range(ty0, ty1 + 1):
            img.paste(tile(x, y), ((x - tx0) * 256, (y - ty0) * 256))
    P = lambda la, lo: ((tile_xy(la, lo)[0] - tx0) * 256, (tile_xy(la, lo)[1] - ty0) * 256)
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for w in new["ways"]:
        if w.get("tags", {}).get("natural") == "wood":
            for i, r in enumerate(rings(w)):
                d.polygon([P(*p) for p in r], fill=(0, 220, 255, 70) if i == 0 and w.get("q") == "lidar" else None, outline=(0, 220, 255, 255))
        if w.get("tags", {}).get("golf") == "fairway":
            for r in rings(w): d.line([P(*p) for p in r + [r[0]]], fill=(255, 230, 0, 255), width=2)
    for w in old["ways"]:
        if w.get("tags", {}).get("natural") == "wood":
            for r in rings(w): d.line([P(*p) for p in r + [r[0]]], fill=(255, 40, 40, 255), width=1)
    d.line([P(*p) for p in h["pts"]], fill=(255, 255, 255, 255), width=3)
    out = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
    a, b = P(max(lats) + m, min(lons) - m * 1.2), P(min(lats) - m, max(lons) + m * 1.2)
    out = out.crop((int(a[0]), int(a[1]), int(b[0]), int(b[1])))
    name = club + "-" + label(h).replace(" ", "").replace("#", "")
    out.save(f"sheets/{name}.jpg", quality=80)
    print(name, out.size)
