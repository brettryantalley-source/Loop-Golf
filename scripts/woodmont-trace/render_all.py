"""render_all.py [--ids] — the whole property with everything traced, hole numbers on the greens.  -> woodmont-traced.png
   --ids labels every bunker with its index (to find false positives)."""
import sys, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon

IDS = "--ids" in sys.argv
X0, Y0, X1, Y1 = 440, 230, 3700, 2900
SC = 0.6
im = Image.open(f"{S}/mosaic18.png").convert("RGB")                       # January, z18 (the file the overview used)
O = Image.open(f"{S}/mosaic19w.png").convert("RGB")                       # October, z19 — resample to z18 for a leaf-on backdrop
m19, m18 = meta(19), meta(18); OFFX = m18["x0"] * 512 - m19["x0"] * 256
bx0, by0 = 2 * X0 + OFFX, 2 * Y0
base = O.crop((bx0, by0, bx0 + 2 * (X1 - X0), by0 + 2 * (Y1 - Y0))).resize((int((X1 - X0) * SC), int((Y1 - Y0) * SC)), Image.LANCZOS)
W, H = base.size
d = ImageDraw.Draw(base, "RGBA")
P = lambda p: ((p[0] - X0) * SC, (p[1] - Y0) * SC)
f = ImageFont.load_default(size=22); fs = ImageFont.load_default(size=14)
def ring(poly, col, wd, fill=None):
    q = [P(p) for p in poly]
    if fill: d.polygon(q, fill=fill + (60,))
    d.line(q + [q[0]], fill=col + (255,), width=wd)

G = json.load(open(f"{S}/trace3/global.json"))
for w in G["water"]: ring(w["poly"], (60, 130, 255), 1, (60, 130, 255))
for n in range(1, 19):
    h = json.load(open(f"{S}/trace3/hole{n}.json"))
    for fw in h["fairways"]: ring(fw, (0, 235, 255), 2)
for i, b in enumerate(G["bunkers"]):
    ring(b, (255, 235, 0), 2, (255, 235, 0))
    if IDS:
        c = Polygon(b).centroid; x, y = P((c.x, c.y)); d.text((x + 6, y - 8), str(i), fill=(255, 255, 255, 255), font=fs, stroke_width=2, stroke_fill=(0, 0, 0, 255))
for n in range(1, 19):
    h = json.load(open(f"{S}/trace3/hole{n}.json"))
    for t in h["tees"]: ring(t["poly"], (255, 140, 30), 2, (255, 140, 30))
    ln = [P(p) for p in h["line"]]; d.line(ln, fill=(255, 255, 255, 235), width=2)
    ring(h["green"], (255, 60, 255), 3, (255, 60, 255))
    gx, gy = ln[-1]; tx, ty = ln[0]
    tw = d.textlength(str(n), font=f)
    d.ellipse([gx - 17, gy - 17, gx + 17, gy + 17], fill=(255, 60, 255, 235), outline=(255, 255, 255, 255), width=2)
    d.text((gx - tw / 2, gy - 12), str(n), fill=(255, 255, 255, 255), font=f, stroke_width=1, stroke_fill=(60, 0, 60, 255))
    d.rectangle([tx - 12, ty - 12, tx + 12, ty + 12], fill=(255, 140, 30, 235), outline=(255, 255, 255, 255), width=2)
    tw = d.textlength(str(n), font=ImageFont.load_default(size=18))
    d.text((tx - tw / 2, ty - 10), str(n), fill=(255, 255, 255, 255), font=ImageFont.load_default(size=18), stroke_width=1, stroke_fill=(90, 40, 0, 255))
d.rectangle([0, H - 26, W, H], fill=(0, 0, 0, 160))
d.text((8, H - 22), "Square = tee, circle = green, cyan = fairway, yellow = bunker, blue = lake/creek. Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community.", fill=(235, 235, 235, 255), font=fs)
out = f"{S}/woodmont-traced{'-ids' if IDS else ''}.png"
base.save(out); print(out, base.size)
