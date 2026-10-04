"""view.py <out.png> <x> <y> <w> <h> [pxPerZ18=2] [grid=50] [overlay.json]
Window given in z18 mosaic coordinates; pixels come from the z19 mosaic (so 2 px per z18 px = native resolution).
Grid labels and overlay coordinates are z18 mosaic coordinates (convert lat/lon with geo.to_px(lat, lon, 18))."""
import sys, json
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
x, y, w, h = map(float, sys.argv[2:6])
k = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0       # output px per z18 px
grid = float(sys.argv[7]) if len(sys.argv) > 7 else 50
ovf = sys.argv[8] if len(sys.argv) > 8 else None

m19 = meta(19); m18 = meta(18)
offx = m18["x0"] * 256 * 2 - m19["x0"] * 256   # z19px = 2*z18px + offx
import os
im = Image.open(f"{S}/" + os.environ.get("MOSAIC", "mosaic19.png")).convert("RGB")
x19, y19, w19, h19 = 2 * x + offx, 2 * y, 2 * w, 2 * h
c = im.crop((int(x19), int(y19), int(x19 + w19), int(y19 + h19)))
W, H = int(w * k), int(h * k)
c = c.resize((W, H), Image.LANCZOS)
d = ImageDraw.Draw(c, "RGBA")
f = ImageFont.load_default(size=13); fb = ImageFont.load_default(size=16)
P = lambda px, py: ((px - x) * k, (py - y) * k)

g0 = int(x // grid + 1) * grid
gx = g0
while gx < x + w:
    X = (gx - x) * k
    d.line([(X, 0), (X, H)], fill=(255, 255, 255, 60), width=1)
    d.text((X + 2, 2), str(int(gx)), fill=(255, 255, 0, 255), font=f, stroke_width=1, stroke_fill=(0, 0, 0, 255))
    gx += grid
gy = int(y // grid + 1) * grid
while gy < y + h:
    Y = (gy - y) * k
    d.line([(0, Y), (W, Y)], fill=(255, 255, 255, 60), width=1)
    d.text((2, Y + 2), str(int(gy)), fill=(255, 255, 0, 255), font=f, stroke_width=1, stroke_fill=(0, 0, 0, 255))
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
        X, Y = P(p["px"], p["py"]); r = p.get("r", 7)
        d.ellipse([X - r, Y - r, X + r, Y + r], outline=p.get("color", "#ffff00"), width=2)
        if p.get("label"):
            d.text((X + r + 2, Y - r), p["label"], fill=p.get("color", "#ffff00"), font=fb, stroke_width=2, stroke_fill=(0, 0, 0, 255))
c.save(out)
print(out, c.size)
