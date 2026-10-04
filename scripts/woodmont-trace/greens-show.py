"""greens-show.py — draw greens2.json polygons on the (env-chosen) mosaic, 6 per sheet. MOSAIC=mosaic19w.png for October."""
import sys, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from trace import HOLES, z19, IM, PX_PER_M, MPP, OFFX
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
G = json.load(open(f"{S}/greens2.json"))
tag = sys.argv[1] if len(sys.argv) > 1 else "oct"
cell, cols = 520, 3
def sheet(holes, out):
    f = ImageFont.load_default(size=22)
    rows = math.ceil(len(holes) / cols)
    sh = Image.new("RGB", (cols * cell, rows * cell), (25, 25, 25))
    for i, n in enumerate(holes):
        pts18 = G[str(n)]["poly18"]; c18 = np.mean(pts18, axis=0)
        cx, cy = 2 * c18[0] + OFFX, 2 * c18[1]; R = int(40 * PX_PER_M); x0, y0 = int(cx - R), int(cy - R)
        crop = cv2.cvtColor(IM[y0:y0 + 2 * R, x0:x0 + 2 * R], cv2.COLOR_BGR2RGB)
        im = Image.fromarray(crop).resize((cell, cell), Image.LANCZOS); d = ImageDraw.Draw(im, "RGBA"); k = cell / (2 * R)
        pg = [((2 * x + OFFX - x0) * k, (2 * y - y0) * k) for x, y in pts18]
        d.line(pg + [pg[0]], fill=(255, 0, 255, 255), width=3)
        d.text((8, 6), f"H{n}", fill=(255, 255, 0, 255), font=ImageFont.load_default(size=30), stroke_width=3, stroke_fill=(0, 0, 0, 255))
        d.text((8, cell - 30), f"{G[str(n)]['area']:.0f} m² {G[str(n)]['method']}", fill=(255, 255, 0, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0, 255))
        sb = 10 * PX_PER_M * k
        d.line([(cell - 20 - sb, cell - 16), (cell - 20, cell - 16)], fill=(255, 255, 255, 255), width=4)
        sh.paste(im, ((i % cols) * cell, (i // cols) * cell))
    sh.save(out); print("wrote", out)
for i in range(0, 18, 6): sheet(list(range(i + 1, i + 7)), f"{S}/greens-{tag}-{i // 6 + 1}.png")
