"""register_wayback.py — the leaf-on (October 2025) mosaic, registered onto the January 2026 one.
   python3 register_wayback.py              stitch t19b/ -> mosaic19b.png, shift it +6.0, +0.9 z19 px (x right, y down) -> mosaic19w.png, print a residual check
   python3 register_wayback.py DX DY        the same with your own shift (z19 px)
   python3 register_wayback.py --estimate   stitch if needed, then print the shift that phase correlation and a SIFT affine fit give for b onto a
Inputs:  t19b/       Wayback release 64001 tiles, the same grid as t19/  (node fetch-wb.mjs 64001 19 <x0> <y0> <cols> <rows> /tmp/woodmont-trace/t19b)
         mosaic19.png  Esri World Imagery as served now, the January 2026 capture  (python3 stitch.py 19)
Written down afterwards from the commands that ran on Oct 2: the stitch, the estimate and the warp ran as separate commands; this file joins them."""
import sys, os
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image
import numpy as np, cv2

SHIFT = (6.0, 0.9)          # z19 px that moves the Oct 2025 mosaic onto the Jan 2026 one (about 1.5 m and 0.2 m)


def stitch_b():
    m = meta(19)
    im = Image.new("RGB", (m["cols"] * 256, m["rows"] * 256))
    miss = 0
    for r in range(m["rows"]):
        for c in range(m["cols"]):
            f = f"{S}/t19b/{m['x0'] + c}_{m['y0'] + r}.jpg"
            if os.path.exists(f):
                im.paste(Image.open(f).convert("RGB"), (c * 256, r * 256))
            else:
                miss += 1
    im.save(f"{S}/mosaic19b.png")
    print("mosaic19b", im.size, "missing", miss)


def estimate():
    A = cv2.imread(f"{S}/mosaic19.png"); B = cv2.imread(f"{S}/mosaic19b.png")
    ga = cv2.cvtColor(A, cv2.COLOR_BGR2GRAY).astype(np.float32); gb = cv2.cvtColor(B, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # overall phase correlation on a half-size copy
    sa = cv2.resize(ga, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA); sb = cv2.resize(gb, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    win = cv2.createHanningWindow((sa.shape[1], sa.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(sa, sb, win)
    print("global phase-corr shift (z19 px, b relative to a): dx %.2f dy %.2f resp %.3f -> %.2f m, %.2f m" % (dx * 2, dy * 2, resp, dx * 2 * mpp(34.2315, 19), dy * 2 * mpp(34.2315, 19)))
    # affine check with SIFT
    sift = cv2.SIFT_create(12000)
    ka, da = sift.detectAndCompute(ga.astype(np.uint8), None); kb, db = sift.detectAndCompute(gb.astype(np.uint8), None)
    mt = cv2.BFMatcher().knnMatch(db, da, k=2)
    good = [a for a, b in mt if a.distance < 0.7 * b.distance]
    src = np.float32([kb[g.queryIdx].pt for g in good]); dst = np.float32([ka[g.trainIdx].pt for g in good])
    M, inl = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    print("SIFT matches", len(good), "inliers", int(inl.sum()))
    print("affine b->a:\n", np.round(M, 5))
    ok = inl.ravel() > 0
    res = np.hypot(*(dst[ok] - (src[ok] @ M[:, :2].T + M[:, 2])).T)
    print("inlier residual median %.2f px (%.2f m), 90pct %.2f px" % (np.median(res), np.median(res) * mpp(34.2315, 19), np.percentile(res, 90)))


def apply(dx, dy):
    A = cv2.imread(f"{S}/mosaic19.png"); B = cv2.imread(f"{S}/mosaic19b.png")
    M = np.float32([[1, 0, dx], [0, 1, dy]])
    W = cv2.warpAffine(B, M, (A.shape[1], A.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    cv2.imwrite(f"{S}/mosaic19w.png", W)
    print("mosaic19w written, shift", dx, dy)

    def edges(img):
        g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.5)
        return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    EA, EW = edges(A), edges(W)
    win = cv2.createHanningWindow((768, 768), cv2.CV_32F)
    for (x, y) in [(3072, 768), (2304, 2304), (2304, 4608), (3072, 3840), (1536, 3072), (2304, 1536), (4608, 3840), (0, 3072)]:
        (ddx, ddy), r = cv2.phaseCorrelate(EA[y:y + 768, x:x + 768], EW[y:y + 768, x:x + 768], win)
        print(f"  residual win@({x},{y}): dx {ddx:+.2f} dy {ddy:+.2f} px  resp {r:.3f}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--estimate"]:
        if not os.path.exists(f"{S}/mosaic19b.png"):
            stitch_b()
        estimate()
    else:
        stitch_b()
        dx, dy = (float(args[0]), float(args[1])) if len(args) >= 2 else SHIFT
        apply(dx, dy)
