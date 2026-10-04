#!/usr/bin/env python3
"""
fit-ell80.py — measures Shot Pattern's 80% dispersion ellipse from a club-sheet still.

Offline measurement tool, not part of the build (needs numpy, scipy, pillow). It reads
data/extracted/<batch>-ell80.json, refits every entry from its `frame` (a still under data/raw/)
and its printed `bboxWYds` x `bboxDYds` labels, and rewrites the fitted fields in place.

Method: the solid outline is the largest bright-green connected component inside the plot;
a direct least-squares conic (Fitzgibbon) is fitted to it, then refitted four times on the pixels
within 6% of the ellipse (drops shot dots that touch the outline). The target is Shot Pattern's
white "+" glyph. Pixels -> yards from the Width x Depth labels, which are the outline's bounding
box (horizontal and vertical extents of the fitted ellipse); `isotropyPct` is how far the two
scales disagree. Frame: +x right, +y SHORT (screen down), tilt clockwise from +x, wYds the full
axis at tiltDeg, hYds the perpendicular one, dx/dy = ellipse centre minus target (src/caddie/engine.js
ellipseSampler reads exactly these).

Usage:  python3 scripts/fit-ell80.py data/extracted/2026-10-04-ell80.json [--check]
"""
import sys, json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

def fit_conic(x, y):
    # Fitzgibbon direct least-squares ellipse fit.
    D1 = np.vstack([x * x, x * y, y * y]).T
    D2 = np.vstack([x, y, np.ones_like(x)]).T
    S1, S2, S3 = D1.T @ D1, D1.T @ D2, D2.T @ D2
    T = -np.linalg.inv(S3) @ S2.T
    M = S1 + S2 @ T
    C = np.array([[0, 0, 2], [0, -1, 0], [2, 0, 0]], float)
    M = np.linalg.inv(C) @ M
    w, v = np.linalg.eig(M)
    cond = 4 * v[0] * v[2] - v[1] ** 2
    a1 = v[:, np.where(cond > 0)[0][0]].real
    return np.concatenate([a1, T @ a1])

def conic_params(c):
    A, B, C, D, E, F = c
    den = B * B - 4 * A * C
    x0 = (2 * C * D - B * E) / den
    y0 = (2 * A * E - B * D) / den
    num = 2 * (A * E * E + C * D * D - B * D * E + den * F)
    s = np.sqrt((A - C) ** 2 + B * B)
    a = -np.sqrt(num * (A + C + s)) / den
    b = -np.sqrt(num * (A + C - s)) / den
    # angle of axis 'a' (the one using A+C+s) from +x, in image coords (y down => clockwise visually)
    if B == 0:
        th = 0.0 if A < C else np.pi / 2
    else:
        th = np.arctan2(C - A - s, B)
    return x0, y0, abs(a), abs(b), th

def ell_dist(params, x, y):
    x0, y0, a, b, th = params
    ct, st = np.cos(th), np.sin(th)
    u = (x - x0) * ct + (y - y0) * st
    v = -(x - x0) * st + (y - y0) * ct
    return np.sqrt((u / a) ** 2 + (v / b) ** 2)

def run(path, y0c, y1c, widthYd, depthYd, out_png=None):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    region = np.zeros(R.shape, bool); region[y0c:y1c, 30:560] = True
    green = (G > 150) & (G - R > 70) & (G - B > 40) & region
    lab, n = ndimage.label(green)
    sizes = ndimage.sum(green, lab, range(1, n + 1))
    ring = lab == (np.argmax(sizes) + 1)
    ys, xs = np.nonzero(ring)
    x, y = xs.astype(float), ys.astype(float)
    p = conic_params(fit_conic(x, y))
    for _ in range(4):  # drop dots fused to the ring
        d = ell_dist(p, x, y)
        keep = np.abs(d - 1) < 0.06
        p = conic_params(fit_conic(x[keep], y[keep]))
    x0, y0, ea, eb, th = p
    # target cross: white pixels near the axes intersection, found as the brightest small blob
    white = (R > 225) & (G > 225) & (B > 225) & region
    wl, wn = ndimage.label(white)
    best = None
    for i in range(1, wn + 1):
        yy, xx = np.nonzero(wl == i)
        h, w = yy.max() - yy.min() + 1, xx.max() - xx.min() + 1
        if 9 <= h <= 22 and 9 <= w <= 22 and abs(h - w) <= 3:
            # plus shape: centre row and column mostly filled, corners empty
            cy, cx = int(round(yy.mean())), int(round(xx.mean()))
            corner = white[yy.min():yy.min() + 3, xx.min():xx.min() + 3].sum()
            if corner == 0:
                cand = (abs(cx - x0) + abs(cy - y0), cx, cy, len(yy))
                if best is None or cand < best:
                    best = cand
    # axes intersection (grey hairlines) as the independent check / fallback
    grey = (np.abs(R - G) < 10) & (np.abs(G - B) < 10) & (R > 45) & (R < 140) & region
    colc = grey.sum(axis=0); rowc = grey.sum(axis=1)
    ax_x, ax_y = int(np.argmax(colc)), int(np.argmax(rowc))
    if best is None:  # a dot or the fill can wash the glyph out: relax the threshold
        white2 = (R > 190) & (G > 190) & (B > 190) & region
        wl2, wn2 = ndimage.label(white2)
        for i in range(1, wn2 + 1):
            yy, xx = np.nonzero(wl2 == i)
            h, w = yy.max() - yy.min() + 1, xx.max() - xx.min() + 1
            if 9 <= h <= 24 and 9 <= w <= 24:
                cand = (abs(xx.mean() - x0) + abs(yy.mean() - y0), int(round(xx.mean())), int(round(yy.mean())), len(yy))
                if best is None or cand < best: best = cand
        crossSrc = "plus glyph (relaxed threshold)"
    else:
        crossSrc = "plus glyph"
    _, cx, cy, _ = best
    ct, st = np.cos(th), np.sin(th)
    hx = np.sqrt((ea * ct) ** 2 + (eb * st) ** 2)
    hy = np.sqrt((ea * st) ** 2 + (eb * ct) ** 2)
    sx, sy = widthYd / (2 * hx), depthYd / (2 * hy)
    s = (sx + sy) / 2
    tilt = np.degrees(th) % 180
    res = dict(wYds=round(2 * ea * s, 1), hYds=round(2 * eb * s, 1), tiltDeg=round(float(tilt), 1),
               dxYds=round(float((x0 - cx) * s), 1), dyYds=round(float((y0 - cy) * s), 1),
               bboxWYds=widthYd, bboxDYds=depthYd, isotropyPct=round(float(100 * (sx / sy - 1)), 1),
               px=dict(cx=round(float(x0), 1), cy=round(float(y0), 1), a=round(float(ea), 1), b=round(float(eb), 1), cross=[cx, cy], axes=[ax_x, ax_y], crossSrc=crossSrc))
    if out_png is None:
        return res
    dimg = im.copy(); dr = ImageDraw.Draw(dimg)
    t = np.linspace(0, 2 * np.pi, 400)
    pts = [(x0 + ea * np.cos(u) * ct - eb * np.sin(u) * st, y0 + ea * np.cos(u) * st + eb * np.sin(u) * ct) for u in t]
    dr.line(pts, fill=(255, 0, 255), width=1)
    dr.line([(cx - 12, cy), (cx + 12, cy)], fill=(255, 255, 0)); dr.line([(cx, cy - 12), (cx, cy + 12)], fill=(255, 255, 0))
    dimg.crop((0, y0c - 40, 588, y1c + 10)).save(out_png)
    return res


FIELDS = ("wYds", "hYds", "tiltDeg", "dxYds", "dyYds", "isotropyPct")

if __name__ == "__main__":
    import os
    path = sys.argv[1]
    check = "--check" in sys.argv
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc = json.load(open(path))
    stale = []
    for e in doc["entries"]:
        y0, y1 = e["plotYpx"]
        r = run(os.path.join(root, e["frame"]), y0, y1, e["bboxWYds"], e["bboxDYds"])
        for k in FIELDS:
            if e.get(k) != r[k]:
                stale.append((e["club"], k, e.get(k), r[k]))
            e[k] = r[k]
        e["px"] = r["px"]
    if check:
        for s in stale:
            print("stale:", *s)
        sys.exit(1 if stale else 0)
    with open(path, "w") as fh:
        fh.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"fit-ell80: refit {len(doc['entries'])} entries in {path}")
