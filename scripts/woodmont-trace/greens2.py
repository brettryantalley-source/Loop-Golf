"""greens2.py — watershed greens. Writes greens2.json {hole: {poly_z18:[[x,y]], area_m2, method}} and contact sheets of every green for review.
   python3 greens2.py            (all 18)        python3 greens2.py 3 7    (only those)"""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from trace import HOLES, z19, IM, MPP, PX_PER_M, OFFX, smooth_poly
import numpy as np, cv2
from skimage.segmentation import watershed
from skimage.filters import sobel, gaussian
from shapely.geometry import Polygon

R_WIN_M = 34          # half window
R_OUT_M = 26          # outer marker radius
R_IN_M = 3.0          # inner marker radius
OVR = json.load(open(f"{S}/overrides.json")) if os.path.exists(f"{S}/overrides.json") else {}

def z19_to_z18(p): return ((p[0] - OFFX) / 2.0, p[1] / 2.0)

def green_ws(n):
    cx, cy = z19(HOLES[n]["green"])
    R = int(R_WIN_M * PX_PER_M)
    x0, y0 = int(cx - R), int(cy - R)
    crop = IM[y0:y0 + 2 * R, x0:x0 + 2 * R]
    lab = cv2.cvtColor(cv2.GaussianBlur(crop, (0, 0), 1.2), cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    grad = 0.6 * sobel(L) + 1.0 * sobel(A) + 1.0 * sobel(B)
    h, w = L.shape
    yy, xx = np.mgrid[:h, :w]
    d = np.hypot(xx - R, yy - R)
    markers = np.zeros((h, w), np.int32)
    markers[d <= R_IN_M * PX_PER_M] = 1
    markers[d >= R_OUT_M * PX_PER_M] = 2
    # bright sand and very dark pixels cannot be green
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    sand = (hsv[..., 2] > 215) & (hsv[..., 1] < 80)
    markers[sand & (markers == 0)] = 2
    ws = watershed(grad, markers)
    reg = (ws == 1).astype(np.uint8) * 255
    k_open = int(2 * 3.2 * PX_PER_M) | 1
    reg = cv2.morphologyEx(reg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_open, k_open)))
    nlab, lab_, st_, ce_ = cv2.connectedComponentsWithStats(reg, 8)
    if nlab > 1:
        pick = lab_[R, R] if lab_[R, R] > 0 else 1 + int(np.argmin([(c[0] - R) ** 2 + (c[1] - R) ** 2 for c in ce_[1:]]))
        reg = ((lab_ == pick).astype(np.uint8)) * 255
    k_close = int(2 * 1.0 * PX_PER_M) | 1
    reg = cv2.morphologyEx(reg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_close, k_close)))
    cn, _ = cv2.findContours(reg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cn: return None
    c = max(cn, key=cv2.contourArea)
    poly = smooth_poly(c[:, 0, :].astype(float), 0.7, 0.3)
    if poly is None: return None
    p = Polygon(poly)
    return dict(poly19=(poly + np.array([x0, y0])).tolist(), area=p.area * MPP * MPP, crop=(x0, y0, 2 * R, 2 * R))

def contact(holes, polys, out, cols=3, cell=520):
    from PIL import Image, ImageDraw, ImageFont
    f = ImageFont.load_default(size=22)
    rows = math.ceil(len(holes) / cols)
    sheet = Image.new("RGB", (cols * cell, rows * cell), (25, 25, 25))
    for i, n in enumerate(holes):
        cx, cy = z19(HOLES[n]["green"]); R = int(40 * PX_PER_M)
        x0, y0 = int(cx - R), int(cy - R)
        crop = cv2.cvtColor(IM[y0:y0 + 2 * R, x0:x0 + 2 * R], cv2.COLOR_BGR2RGB)
        im = Image.fromarray(crop).resize((cell, cell), Image.LANCZOS)
        d = ImageDraw.Draw(im, "RGBA"); k = cell / (2 * R)
        pg = polys.get(n)
        if pg:
            pts = [((x - x0) * k, (y - y0) * k) for x, y in pg["poly19"]]
            d.line(pts + [pts[0]], fill=(255, 0, 255, 255), width=3)
            d.text((8, cell - 30), f"{pg['area']:.0f} m²  {pg.get('method','ws')}", fill=(255, 255, 0, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0, 255))
        d.ellipse([cell / 2 - 4, cell / 2 - 4, cell / 2 + 4, cell / 2 + 4], outline=(0, 255, 255, 255), width=2)
        d.text((8, 6), f"H{n}", fill=(255, 255, 0, 255), font=ImageFont.load_default(size=30), stroke_width=3, stroke_fill=(0, 0, 0, 255))
        # 10 m scale bar
        sb = 10 * PX_PER_M * k
        d.line([(cell - 20 - sb, cell - 16), (cell - 20, cell - 16)], fill=(255, 255, 255, 255), width=4)
        d.text((cell - 20 - sb, cell - 40), "10 m", fill=(255, 255, 255, 255), font=f, stroke_width=2, stroke_fill=(0, 0, 0, 255))
        sheet.paste(im, ((i % cols) * cell, (i // cols) * cell))
    sheet.save(out); print("wrote", out, sheet.size)

if __name__ == "__main__":
    which = [int(a) for a in sys.argv[1:]] or list(range(1, 19))
    res = {}
    for n in which:
        g = green_ws(n); method = "ws"
        if str(n) in OVR.get("green", {}):                        # hand override, z18 polygon
            pts18 = OVR["green"][str(n)]
            pts19 = [(2 * x + OFFX, 2 * y) for x, y in pts18]
            g = dict(poly19=pts19, area=Polygon(pts19).area * MPP * MPP); method = "hand"
        if g is None: print("hole", n, "no region"); continue
        g["method"] = method
        res[n] = g
        print(f"hole {n}: {g['area']:.0f} m² ({method})")
    prev = json.load(open(f"{S}/greens2.json")) if os.path.exists(f"{S}/greens2.json") else {}
    prev.update({str(k): dict(poly18=[list(z19_to_z18(p)) for p in v["poly19"]], area=v["area"], method=v["method"]) for k, v in res.items()})
    json.dump(prev, open(f"{S}/greens2.json", "w"))
    for i in range(0, len(which), 6):
        contact(which[i:i + 6], res, f"{S}/greens-sheet-{i // 6 + 1}.png")
