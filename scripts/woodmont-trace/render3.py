"""render3.py [holes…] — review overlays from trace3/*.json + trace3/global.json on the leaf-on imagery.
   -> qa3/holeN.png (one hole, long edge ≈ 1100 px) and, with --sheet a b c, qa3/sheet-a-b-c.png"""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon, LineString

OCT = Image.open(f"{S}/mosaic19w.png").convert("RGB")
M19, M18 = meta(19), meta(18); OFFX = M18["x0"] * 512 - M19["x0"] * 256
MPP = mpp(34.2315, 19)
G = json.load(open(f"{S}/trace3/global.json"))
GREEN_RGB, FAIR_RGB, BUNK_RGB, TEE_RGB, LINE_RGB, WATER_RGB = (255, 60, 255), (0, 235, 255), (255, 235, 0), (255, 140, 30), (255, 255, 255), (60, 130, 255)
to19 = lambda p: (2 * p[0] + OFFX, 2 * p[1])

def render(n, longedge=1100):
    h = json.load(open(f"{S}/trace3/hole{n}.json"))
    pts = [to19(p) for p in h["line"]] + [to19(p) for p in h["green"]] + [to19(q) for t in h["tees"] for q in t["poly"]]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; m = 38 / MPP
    x0, y0, x1, y1 = int(min(xs) - m), int(min(ys) - m), int(max(xs) + m), int(max(ys) + m)
    crop = OCT.crop((x0, y0, x1, y1)); w, hh = crop.size; k = longedge / max(w, hh)
    crop = crop.resize((int(w * k), int(hh * k)), Image.LANCZOS); d = ImageDraw.Draw(crop, "RGBA")
    P = lambda p: ((to19(p)[0] - x0) * k, (to19(p)[1] - y0) * k)
    f = ImageFont.load_default(size=26); fs = ImageFont.load_default(size=16)
    def ring(poly, col, wd, fill=None):
        q = [P(p) for p in poly]
        if fill: d.polygon(q, fill=fill + (45,))
        d.line(q + [q[0]], fill=col + (255,), width=wd)
    for wt in G["water"]:
        if any(x0 - 50 < to19(p)[0] < x1 + 50 and y0 - 50 < to19(p)[1] < y1 + 50 for p in wt["poly"]): ring(wt["poly"], WATER_RGB, 2, WATER_RGB)
    for fw in h["fairways"]: ring(fw, FAIR_RGB, 2)
    for b in G["bunkers"]:
        c = Polygon(b).centroid; cx, cy = to19((c.x, c.y))
        if x0 - 10 < cx < x1 + 10 and y0 - 10 < cy < y1 + 10: ring(b, BUNK_RGB, 2, BUNK_RGB)
    for t in h["tees"]: ring(t["poly"], TEE_RGB, 3, TEE_RGB)
    ring(h["green"], GREEN_RGB, 3, GREEN_RGB)
    ln = [P(p) for p in h["line"]]; d.line(ln, fill=LINE_RGB + (255,), width=3)
    for p in ln[:: max(1, len(ln) // 14)]: d.ellipse([p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3], fill=LINE_RGB + (255,))
    tx, ty = ln[0]; gx, gy = ln[-1]
    d.text((tx + 10, ty - 30), f"H{n} tee", fill=(255, 255, 255, 255), font=f, stroke_width=3, stroke_fill=(0, 0, 0, 255))
    d.text((gx + 12, gy - 12), "green", fill=(255, 255, 255, 255), font=f, stroke_width=3, stroke_fill=(0, 0, 0, 255))
    L = LineString([to19(p) for p in h["line"]]).length * MPP * 1.0936
    cap = f"Hole {n} · par {h['par']} · line {L:.0f} yd"
    d.rectangle([0, 0, 330, 34], fill=(0, 0, 0, 170)); d.text((8, 4), cap, fill=(255, 255, 0, 255), font=ImageFont.load_default(size=22))
    sb = 20 / MPP * k; d.line([(14, crop.height - 20), (14 + sb, crop.height - 20)], fill=(255, 255, 255, 255), width=5)
    d.text((14, crop.height - 44), "20 m", fill=(255, 255, 255, 255), font=fs, stroke_width=2, stroke_fill=(0, 0, 0, 255))
    out = f"{S}/qa3/hole{n}.png"; crop.save(out); return out, crop.size

def legend(path):
    im = Image.new("RGB", (900, 70), (22, 22, 22)); d = ImageDraw.Draw(im); f = ImageFont.load_default(size=18); x = 12
    for lab, col in (("green", GREEN_RGB), ("fairway", FAIR_RGB), ("bunker", BUNK_RGB), ("tee box", TEE_RGB), ("water", WATER_RGB), ("hole line", LINE_RGB)):
        d.rectangle([x, 24, x + 24, 44], fill=col); d.text((x + 32, 24), lab, fill=(230, 230, 230), font=f); x += 140
    im.save(path)

if __name__ == "__main__":
    holes = [int(a) for a in sys.argv[1:] if a.isdigit()]
    for n in holes: print(render(n))
