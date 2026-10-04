"""fuse.py — fairway mask from TWO seasons.
   Jan (dormant bermuda): fairway = overseeded green vs tan rough; reliable where lit.
   Oct (leaf-on): mown-turf colour band; used where January is in shadow.
   python3 fuse.py 1 12 14   -> fuse/holeN.png (4 panels: Jan raw | Oct raw | Jan mask | fused)"""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
import numpy as np, cv2
os.makedirs(f"{S}/fuse", exist_ok=True)
JAN = cv2.imread(f"{S}/mosaic19.png"); OCT = cv2.imread(f"{S}/mosaic19w.png")
M19, M18 = meta(19), meta(18); OFFX = M18["x0"] * 512 - M19["x0"] * 256
MPP = mpp(34.2315, 19); PXM = 1.0 / MPP
K = lambda m: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(m * PXM) | 1,) * 2)

def hsv_parts(img):
    sm = cv2.GaussianBlur(img, (0, 0), 1.2)
    hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB).astype(np.float32)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mu = cv2.blur(g, (11, 11)); tex = np.sqrt(np.maximum(cv2.blur(g * g, (11, 11)) - mu * mu, 0))
    return hsv[..., 0].astype(np.float32) * 2, hsv[..., 1] / 255.0, hsv[..., 2] / 255.0, lab[..., 1] - 128, tex

def jan_masks(c):
    H, Sx, V, A, tex = hsv_parts(c)
    lit = (V >= 0.36) & (tex < 9)
    green = (H >= 54) & (H <= 112) & (A < 1.5) & (Sx >= 0.16)
    return lit & green, ~lit | (tex >= 9), (H, Sx, V, A, tex)

def oct_mask(c):
    H, Sx, V, A, tex = hsv_parts(c)
    return (H >= 78) & (H <= 114) & (Sx >= 0.28) & (Sx <= 0.52) & (V >= 0.42) & (V <= 0.66) & (tex < 7)

def fused(cj, co, line_px, near_m=24):
    jg, jshadow, _ = jan_masks(cj)
    om = oct_mask(co)
    h, w = jg.shape
    near = np.zeros((h, w), np.uint8); cv2.polylines(near, [np.array(line_px, np.int32)], False, 255, int(2 * near_m * PXM))
    fz = (jg | (jshadow & om & (near > 0))).astype(np.uint8) * 255
    return fz, jg.astype(np.uint8) * 255, om.astype(np.uint8) * 255

if __name__ == "__main__":
    from trace import HOLES, z19
    for a in sys.argv[1:]:
        n = int(a); h = HOLES[n]
        chain = [z19(p) for p in [h["tee"][len(h["tee"]) // 2]] + h["via"] + [h["green"]]]
        xs = [p[0] for p in chain]; ys = [p[1] for p in chain]; m = 70 * PXM
        x0, y0 = int(max(0, min(xs) - m)), int(max(0, min(ys) - m)); x1, y1 = int(min(JAN.shape[1], max(xs) + m)), int(min(JAN.shape[0], max(ys) + m))
        cj, co = JAN[y0:y1, x0:x1], OCT[y0:y1, x0:x1]
        lp = [(p[0] - x0, p[1] - y0) for p in chain]
        fz, jg, om = fused(cj, co, lp)
        fz = cv2.morphologyEx(fz, cv2.MORPH_OPEN, K(2.5)); fz = cv2.morphologyEx(fz, cv2.MORPH_CLOSE, K(5))
        def paint(base, mask):
            o = base.copy(); cn, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); cv2.drawContours(o, cn, -1, (0, 255, 255), 2); return o
        sc = 0.35 if max(cj.shape[:2]) > 1800 else 0.5
        panels = [cj, co, paint(cj, jg), paint(co, fz)]
        panels = [cv2.resize(p, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA) for p in panels]
        cv2.imwrite(f"{S}/fuse/hole{n}.png", np.hstack(panels)); print(n, np.hstack(panels).shape)
