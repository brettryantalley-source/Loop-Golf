"""crop.py <out.png> <x> <y> <w> <h> [scale=1] [grid=100] [z=18] [overlay.json]
Crop a window of the z mosaic (mosaic pixel coords), draw a labelled grid (labels are mosaic coords), optional overlay.
overlay.json: {"points":[{"px":..,"py":..,"label":"..","color":"#ff0"}], "lines":[{"pts":[[px,py],..],"color":"#f00"}], "rings":[{"pts":[[px,py],..],"color":"#0ff"}]}"""
import sys, json
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
x, y, w, h = map(int, sys.argv[2:6])
scale = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
grid = int(sys.argv[7]) if len(sys.argv) > 7 else 100
z = int(sys.argv[8]) if len(sys.argv) > 8 else 18
ovf = sys.argv[9] if len(sys.argv) > 9 else None

im = Image.open(f"{S}/mosaic{z}.png").convert("RGB")
w = min(w, im.width - x); h = min(h, im.height - y)
c = im.crop((x, y, x + w, y + h))
if scale != 1.0:
    c = c.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
d = ImageDraw.Draw(c, "RGBA")
f = ImageFont.load_default(size=max(11, int(12 * min(scale, 1.5))))
fb = ImageFont.load_default(size=max(13, int(15 * min(scale, 1.5))))
P = lambda px, py: ((px - x) * scale, (py - y) * scale)

if grid:
    gx = (x // grid + 1) * grid
    while gx < x + w:
        X = (gx - x) * scale
        d.line([(X, 0), (X, c.height)], fill=(255, 255, 255, 70), width=1)
        d.text((X + 2, 2), str(gx), fill=(255, 255, 0, 255), font=f, stroke_width=1, stroke_fill=(0, 0, 0, 255))
        gx += grid
    gy = (y // grid + 1) * grid
    while gy < y + h:
        Y = (gy - y) * scale
        d.line([(0, Y), (c.width, Y)], fill=(255, 255, 255, 70), width=1)
        d.text((2, Y + 2), str(gy), fill=(255, 255, 0, 255), font=f, stroke_width=1, stroke_fill=(0, 0, 0, 255))
        gy += grid

if ovf:
    ov = json.load(open(ovf))
    for r in ov.get("rings", []):
        pts = [P(*p) for p in r["pts"]]
        d.line(pts + [pts[0]], fill=r.get("color", "#00ffff"), width=r.get("width", 2))
    for l in ov.get("lines", []):
        pts = [P(*p) for p in l["pts"]]
        d.line(pts, fill=l.get("color", "#ff3030"), width=l.get("width", 2))
    for p in ov.get("points", []):
        X, Y = P(p["px"], p["py"])
        r = p.get("r", 7)
        d.ellipse([X - r, Y - r, X + r, Y + r], outline=p.get("color", "#ffff00"), width=2)
        if p.get("label"):
            d.text((X + r + 2, Y - r), p["label"], fill=p.get("color", "#ffff00"), font=fb, stroke_width=2, stroke_fill=(0, 0, 0, 255))
c.save(out)
print(out, c.size)
