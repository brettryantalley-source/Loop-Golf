#!/usr/bin/env python3
"""
read-pattern.py — reads Shot Pattern's two rings and every shot dot off a club-sheet still
(C45, v22.56, D127; Brett Oct 11: "the best 70% is the more prominent dispersion circle (and i'd want the
shape to be consistent with the shot pattern shape) with the full 100% being represented in a faint,
dotted line ... use actual shots and then fill in with simulated shots to get up to the 40").

Offline measurement tool, not part of the build (needs numpy, scipy, pillow). It reads
data/extracted/<batch>-pattern.json, measures every entry from its `frame` and its printed Width x Depth
labels, and rewrites the measured fields in place. The map draws what it measures (src/caddie/overlay.js
patternRingFromEntry, patternDots); the engine still prices from the ell80 batches (scripts/fit-ell80.py).

What a club sheet shows (Shot Pattern · Dispersion): a solid ring holding the Coverage slider's share of
the shots, a faint dashed ring that holds every shot, a dashed box round the solid ring (the printed
Width x Depth), the target "+", and one dot per shot. Measured here:
  ring     the solid ring at the printed coverage: the largest bright-green component, a direct
           least-squares conic (fit-ell80.py's), refitted on the pixels within 6% of the ellipse.
  ring70   the same ring at 70% coverage. Shot Pattern scales its ring by 2-D normal contours (radius
           sqrt(-2 ln(1 - c))): its 2-iron reads 88 x 90 at 80% and 76 x 78 at 70%, 0.864 against
           0.865. A still printed at 70% is ring70 as is.
  ring100  the dashed ring: the dim-green pixels outside the solid ring, off the box and off the dots,
           fitted the same way. Coverage does not move it. It is the solid ring's own shape grown to the
           farthest shot; where it lies on the solid ring and cannot be fitted, it is drawn that way.
  dots     every dot, yards from the "+", found as a green disc inside a white rim (two dots that
           overlap each keep most of their rim). A dot under a printed label cannot be seen: the entry
           names it in `addDotsPx` (placed by eye on what shows of its rim), and `dotsFound` counts the
           ones read. The Driver's 117 overlap so much that 103 are read (107 with the four under its labels); the
           app shows 40 of them.
Frame (as fit-ell80.py): +x right, +y SHORT (screen down), tilt clockwise from +x, wYds the full axis at
tiltDeg, hYds the perpendicular one, dx/dy = centre minus the "+". Pixels -> yards from the printed labels
(the solid ring's bounding box); `isotropyPct` is how far the two scales disagree.

Usage:  python3 scripts/read-pattern.py data/extracted/2026-10-11-pattern.json [--check] [--png DIR]
        --png writes each still with what was read drawn on it (magenta), for checking by eye.
"""
import os, sys, json, importlib.util, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("fit_ell80", os.path.join(ROOT, "scripts", "fit-ell80.py"))
F = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(F)   # fit_conic, conic_params, ell_dist

PEAK_WIN, MIN_SEP = 7, 4   # px on a 920-px still: a dot's peak wins this window; two dots this close are one

def contour(c):
    """Radius of the 2-D normal contour holding c of the shots, in sigma."""
    return np.sqrt(-2 * np.log(1 - c))

def fit_trimmed(x, y, tols):
    p = F.conic_params(F.fit_conic(x, y))
    for t in tols:
        keep = np.abs(F.ell_dist(p, x, y) - 1) < t
        if keep.sum() < 20: break
        p = F.conic_params(F.fit_conic(x[keep], y[keep]))
    return p

def ring_fields(p, cross, s):
    x0, y0, a, b, th = p
    return dict(wYds=round(float(2 * a * s), 1), hYds=round(float(2 * b * s), 1), tiltDeg=round(float(np.degrees(th) % 180), 1),
                dxYds=round(float((x0 - cross[0]) * s), 1), dyYds=round(float((y0 - cross[1]) * s), 1))

def read(e, png_dir=None):
    path = os.path.join(ROOT, e["frame"])
    im = Image.open(path).convert("RGB")
    k = im.size[0] / 920.0                      # kernels are sized on Brett's 920-px stills
    A = np.asarray(im).astype(int)
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    x0c, y0c, x1c, y1c = e["plotPx"]
    reg = np.zeros(R.shape, bool); reg[y0c:y1c, x0c:x1c] = True

    # 1. the solid ring
    bright = (G > 150) & (G - R > 70) & (G - B > 40) & reg
    lab, n = ndimage.label(bright)
    ring = lab == (np.argmax(ndimage.sum(bright, lab, range(1, n + 1))) + 1)
    ys, xs = np.nonzero(ring)
    p = fit_trimmed(xs.astype(float), ys.astype(float), [0.06] * 4)
    cx, cy, ea, eb, th = p

    # 2. the "+": the white plus glyph nearest the ring's centre — a bar across its middle row and its
    #    middle column, four empty corners, a thin fill (two touching dots' white rims are none of that);
    #    the grey hairlines' crossing when no glyph shows (a dot can wash it out)
    cross = None
    for thr, src in ((225, "plus glyph"), (190, "plus glyph (relaxed threshold)")):
        white = (R > thr) & (G > thr) & (B > thr) & reg
        wl, wn = ndimage.label(white)
        best = None
        for i in range(1, wn + 1):
            blob = wl == i
            yy, xx = np.nonzero(blob)
            h, w = yy.max() - yy.min() + 1, xx.max() - xx.min() + 1
            if not (12 * k <= h <= 34 * k and 12 * k <= w <= 34 * k and abs(h - w) <= 4 * k): continue
            box = blob[yy.min():yy.max() + 1, xx.min():xx.max() + 1]
            c = max(2, int(round(3 * k)))
            if box[:c, :c].any() or box[:c, -c:].any() or box[-c:, :c].any() or box[-c:, -c:].any(): continue
            mr, mc, b = h // 2, w // 2, max(1, int(round(1.5 * k)))
            if box[mr - b:mr + b + 1].any(axis=0).mean() < 0.8 or box[:, mc - b:mc + b + 1].any(axis=1).mean() < 0.8: continue
            if box.mean() > 0.45: continue
            gx, gy = float(xx.min() + xx.max()) / 2, float(yy.min() + yy.max()) / 2
            d = np.hypot(gx - cx, gy - cy)
            if best is None or d < best[0]: best = (d, gx, gy)
        if best is not None:
            cross, crossSrc = (best[1], best[2]), src
            break
    if cross is None:
        grey = (np.abs(R - G) < 10) & (np.abs(G - B) < 10) & (R > 45) & (R < 140) & reg
        cross, crossSrc = (int(np.argmax(grey.sum(axis=0))), int(np.argmax(grey.sum(axis=1)))), "axes"

    # 3. pixels -> yards from the printed box
    ct, st = np.cos(th), np.sin(th)
    hx = np.sqrt((ea * ct) ** 2 + (eb * st) ** 2)
    hy = np.sqrt((ea * st) ** 2 + (eb * ct) ** 2)
    sx, sy = e["bboxWYds"] / (2 * hx), e["bboxDYds"] / (2 * hy)
    s = (sx + sy) / 2

    # 4. the dots: a green disc (radius ~4.5 px) inside a white rim (~5.5-7 px)
    yy, xx = np.mgrid[-8:9, -8:9]; rr = np.hypot(xx, yy) / k
    disk = (rr <= 4.5).astype(float); disk /= disk.sum()
    rim_k = ((rr >= 5.5) & (rr <= 7.2)).astype(float); rim_k /= rim_k.sum()
    fill = ((G > 160) & (G - R > 70) & (B > 85) & (B < 175)).astype(float)
    rim = ((R > 140) & (G > 170) & (B > 140) & (G - R < 70)).astype(float)
    f = ndimage.convolve(fill, disk); r = ndimage.convolve(rim, rim_k)
    score = f * (0.4 + r)
    pk = (f >= 0.6) & (r >= 0.25) & reg
    peaks = pk & (score == ndimage.maximum_filter(np.where(pk, score, 0), size=max(3, int(round(PEAK_WIN * k)) | 1)))
    lab, n = ndimage.label(peaks)
    found = []
    for (py, px) in ndimage.center_of_mass(peaks, lab, range(1, n + 1)):
        if all(np.hypot(px - q[0], py - q[1]) > MIN_SEP * k for q in found): found.append((px, py))
    dots_px = found + [tuple(d) for d in e.get("addDotsPx", [])]

    # 5. the dashed 100% ring: dim green, outside the solid ring, off the box and off the dots
    dim = (G - R >= 14) & (G >= 40) & (G <= 145) & (G - B >= 6) & reg   # the recordings (Oct 4) run darker than the stills
    ry, rx = np.nonzero(dim)
    xf, yf = rx.astype(float), ry.astype(float)
    ok = F.ell_dist(p, xf, yf) > 1.08
    bx0, bx1, by0, by1 = cx - hx, cx + hx, cy - hy, cy + hy
    onBox = ((np.abs(xf - bx0) < 4 * k) | (np.abs(xf - bx1) < 4 * k)) & (yf > by0 - 4 * k) & (yf < by1 + 4 * k)
    onBox |= ((np.abs(yf - by0) < 4 * k) | (np.abs(yf - by1) < 4 * k)) & (xf > bx0 - 4 * k) & (xf < bx1 + 4 * k)
    ok &= ~onBox
    for (dx_, dy_) in dots_px:
        ok &= np.hypot(xf - dx_, yf - dy_) > 10 * k
    # Shot Pattern draws it as the solid ring's own shape, centre and tilt, grown to the farthest shot. When
    # it sits (almost) on the solid ring — few shots, all close, as on the 7-iron from the rough — there
    # are too few pixels to fit, or the fit wanders: then it is drawn that way, the solid ring grown to
    # the farthest dot (`ring100Src`: "farthest dot"; else "dashed ring").
    ring100Src = "dashed ring"
    try:
        p100 = fit_trimmed(xf[ok], yf[ok], [0.3, 0.15, 0.08, 0.05, 0.05]) if ok.sum() >= 40 else None
    except (np.linalg.LinAlgError, IndexError, ValueError):
        p100 = None
    if p100 is not None:
        g = np.sqrt(p100[2] * p100[3] / (ea * eb))                     # how much bigger, by area
        off = np.hypot(p100[0] - cx, p100[1] - cy) / np.sqrt(ea * eb)    # centre shift, in ring radii
        shape = abs(np.log((p100[2] / p100[3]) / (ea / eb))) if abs(np.sin(p100[4] - th)) < 0.5 else abs(np.log((p100[3] / p100[2]) / (ea / eb)))
        if not (g >= 1.0 and off < 0.12 and shape < 0.25): p100 = None
    if p100 is None:
        dd = F.ell_dist(p, np.array([d[0] for d in dots_px], float), np.array([d[1] for d in dots_px], float)) if dots_px else np.array([1.0])
        g = max(1.0, float(dd.max()))
        p100, ring100Src = (cx, cy, ea * g, eb * g, th), "farthest dot"

    cov = e.get("coverage", 0.7)
    out = dict(ring=ring_fields(p, cross, s), ring100=ring_fields(p100, cross, s), ring100Src=ring100Src)
    k70 = contour(0.7) / contour(cov)
    r70 = dict(out["ring"]); r70["wYds"] = round(r70["wYds"] * k70, 1); r70["hYds"] = round(r70["hYds"] * k70, 1)
    out["ring70"] = r70
    out["dots"] = [[round(float((px - cross[0]) * s), 1), round(float((py - cross[1]) * s), 1)] for (px, py) in dots_px]
    out["dotsFound"] = len(found)
    # every dot should sit inside the dashed ring: the share that does is the check on step 5
    d100 = F.ell_dist(p100, np.array([d[0] for d in dots_px], float), np.array([d[1] for d in dots_px], float)) if dots_px else np.array([])
    out["dotsInside100"] = round(float(np.mean(d100 <= 1.04)), 2) if len(d100) else None
    out["isotropyPct"] = round(float(100 * (sx / sy - 1)), 1)
    out["px"] = dict(cross=[round(float(cross[0]), 1), round(float(cross[1]), 1)], crossSrc=crossSrc,
                     ring=[round(float(v), 1) for v in (cx, cy, ea, eb)], ring100=[round(float(v), 1) for v in p100[:4]])
    if png_dir:
        d = ImageDraw.Draw(im)
        t = np.linspace(0, 2 * np.pi, 400)
        for (X0, Y0, a, b, T) in (p, p100):
            c, sn = np.cos(T), np.sin(T)
            d.line([(X0 + a * np.cos(u) * c - b * np.sin(u) * sn, Y0 + a * np.cos(u) * sn + b * np.sin(u) * c) for u in t], fill=(255, 0, 255), width=2)
        for (px, py) in dots_px:
            d.ellipse((px - 7 * k, py - 7 * k, px + 7 * k, py + 7 * k), outline=(255, 0, 255), width=2)
        d.line([(cross[0] - 14 * k, cross[1]), (cross[0] + 14 * k, cross[1])], fill=(255, 255, 0), width=2)
        d.line([(cross[0], cross[1] - 14 * k), (cross[0], cross[1] + 14 * k)], fill=(255, 255, 0), width=2)
        os.makedirs(png_dir, exist_ok=True)
        im.crop((x0c, y0c, x1c, y1c)).save(os.path.join(png_dir, f"{e['club']}-{e['lie']}.png"))
    return out

FIELDS = ("ring", "ring70", "ring100", "ring100Src", "dots", "dotsFound", "dotsInside100", "isotropyPct", "px")

if __name__ == "__main__":
    path = sys.argv[1]
    check = "--check" in sys.argv
    png_dir = sys.argv[sys.argv.index("--png") + 1] if "--png" in sys.argv else None
    doc = json.load(open(path))
    stale = []
    for e in doc["entries"]:
        r = read(e, png_dir)
        for f in FIELDS:
            if e.get(f) != r[f]: stale.append((e["club"], e["lie"], f))
            e[f] = r[f]
    if check:
        for s in stale: print("stale:", *s)
        sys.exit(1 if stale else 0)
    with open(path, "w") as fh:
        fh.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"read-pattern: read {len(doc['entries'])} entries into {path}")
