"""osm-overlay.py — OSM water / streams / woods on the z18 mosaic, to see what OSM already has right for Woodmont."""
import sys, json
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image, ImageDraw, ImageFont

A = json.load(open(f"{S}/woodmont-A.json"))
W = json.load(open(f"{S}/waterways.json"))
im = Image.open(f"{S}/mosaic18.png").convert("RGB")
d = ImageDraw.Draw(im, "RGBA")
f = ImageFont.load_default(size=22)
P = lambda p: to_px(p["lat"], p["lon"], 18)

n_w = n_s = n_wood = 0
seen = set()
for src, tag in ((A, "A"), (W, "W")):
    for e in src["elements"]:
        t = e.get("tags", {})
        key = (e["type"], e["id"])
        if key in seen: continue
        seen.add(key)
        geoms = []
        if e["type"] == "way" and e.get("geometry"): geoms = [e["geometry"]]
        elif e["type"] == "relation":
            geoms = [m["geometry"] for m in e.get("members", []) if m.get("geometry")]
        for g in geoms:
            pts = [P(p) for p in g if p]
            if len(pts) < 2: continue
            if t.get("natural") == "water":
                d.polygon(pts, fill=(0, 120, 255, 70), outline=(0, 200, 255, 255)); n_w += 1
                cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
                d.text((cx, cy), f"w{e['id']%10000}", fill=(0, 255, 255, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0, 255))
            elif t.get("waterway"):
                d.line(pts, fill=(255, 255, 0, 255), width=3); n_s += 1
            elif t.get("natural") == "wood" or t.get("landuse") == "forest":
                d.polygon(pts, fill=(0, 255, 0, 40), outline=(255, 80, 255, 255)); n_wood += 1
im.save(f"{S}/osm-overlay.png")
print("water polys", n_w, "stream ways", n_s, "wood polys", n_wood)
im.crop((300, 150, 3800, 2900)).resize((1750, 1375), Image.LANCZOS).save(f"{S}/osm-overlay-small.png")
