"""trace.py — per-hole feature extraction from the z19 imagery.
   python3 trace.py 1 2 3    -> writes trace/holeN.json (z19 px) and qa/holeN.png
All inputs are z18 mosaic px (as in the overview); everything below works in z19 px (0.247 m/px)."""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
import numpy as np, cv2
from shapely.geometry import Polygon, LineString, Point, MultiPolygon, box
from shapely.ops import unary_union
from skimage.graph import route_through_array

OUT_T, OUT_Q = f"{S}/trace", f"{S}/qa"
os.makedirs(OUT_T, exist_ok=True); os.makedirs(OUT_Q, exist_ok=True)
M19, M18 = meta(19), meta(18)
OFFX = M18["x0"] * 256 * 2 - M19["x0"] * 256
MPP = mpp(34.2315, 19)                         # metres per z19 px
PX_PER_M = 1.0 / MPP
def z19(p): return (2 * p[0] + OFFX, 2 * p[1])
IM = cv2.imread(f"{S}/" + os.environ.get("MOSAIC", "mosaic19.png"))

# ---- the hole table (z18 px). tee = pads (back..front not required), green = centre, via = fairway waypoints ----
HOLES = {
 1:  dict(par=5, tee=[(1777,1053),(1768,1133),(1763,1213)], green=(1660,1992), via=[]),
 2:  dict(par=3, tee=[(1772,2017),(1737,2050),(1710,2092),(1677,2147)], green=(1555,2297), via=[]),
 3:  dict(par=4, tee=[(1675,2327),(1620,2375),(1557,2425)], green=(2196,2071), via=[(1850,2230)]),
 4:  dict(par=4, tee=[(2295,2160),(2255,2172),(2212,2195),(2177,2220),(2137,2262)], green=(1570,2570), via=[(1900,2400)]),
 5:  dict(par=4, tee=[(1395,2686),(1399,2735),(1419,2784),(1459,2796),(1442,2830)], green=(1392,2065), via=[(1420,2400)]),
 6:  dict(par=3, tee=[(1120,1870),(1117,1932)], green=(1045,1712), via=[]),
 7:  dict(par=4, tee=[(859,1535),(905,1596),(949,1657)], green=(505,1086), via=[(700,1380)]),
 8:  dict(par=4, tee=[(635,998)], green=(1140,1567), via=[(790,1075),(900,1250)]),   # tee = Brett's arrow
 9:  dict(par=5, tee=[(1334,1769),(1342,1924),(1325,1962),(1322,1998)], green=(1469,1010), via=[(1400,1400)]),
 10: dict(par=5, tee=[(1485,378),(1665,422)], green=(2349,818), via=[(1900,570),(2050,650)]),
 11: dict(par=3, tee=[(2650,855),(2575,880),(2660,912),(2515,895),(2495,985)], green=(2657,1052), via=[]),
 12: dict(par=4, tee=[(2557,1195),(2552,1270),(2532,1340),(2538,1400)], green=(2478,1884), via=[(2520,1600)]),
 13: dict(par=3, tee=[(2570,2030),(2600,2050),(2640,2090)], green=(2762,2237), via=[]),
 14: dict(par=4, tee=[(2897,2171)], green=(3514,2573), via=[(3200,2330)]),
 15: dict(par=3, tee=[(3430,2578),(3460,2578),(3488,2575)], green=(3124,2553), via=[]),
 16: dict(par=5, tee=[(2992,2476),(3028,2510),(3060,2530)], green=(2303,1817), via=[(2745,2335),(2485,2205),(2352,1965)]),
 17: dict(par=4, tee=[(2395,1670),(2365,1685)], green=(2442,1052), via=[(2330,1350)]),
 18: dict(par=5, tee=[(2255,900)], green=(1480,527), via=[(1900,700)]),
}

def line_z19(h):
    tees = [z19(p) for p in h["tee"]]
    g = z19(h["green"])
    # tee reference = the pad nearest the middle of the set (≈ Medal)
    c = np.mean(tees, axis=0)
    tref = min(tees, key=lambda p: (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2)
    return tref, [z19(p) for p in h["via"]], g, tees

def crop_for(poly_pts, margin_m=105):
    xs = [p[0] for p in poly_pts]; ys = [p[1] for p in poly_pts]
    m = margin_m * PX_PER_M
    x0, y0 = int(max(0, min(xs) - m)), int(max(0, min(ys) - m)); x1, y1 = int(min(IM.shape[1], max(xs) + m)), int(min(IM.shape[0], max(ys) + m))
    return x0, y0, x1, y1

def feats(crop):
    bgr = cv2.GaussianBlur(crop, (0, 0), 2.0)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    H = hsv[..., 0].astype(np.float32) * 2; S = hsv[..., 1].astype(np.float32) / 255; V = hsv[..., 2].astype(np.float32) / 255
    A = lab[..., 1] - 128
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mu = cv2.blur(g, (11, 11)); tex = np.sqrt(np.maximum(cv2.blur(g * g, (11, 11)) - mu * mu, 0))
    return dict(lab=lab, H=H, S=S, V=V, A=A, tex=tex)

def contour_polys(mask, min_m2, eps_m=0.5, max_m2=1e9):
    cn, hier = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cn:
        a = cv2.contourArea(c) * MPP * MPP
        if a < min_m2 or a > max_m2 or len(c) < 5: continue
        ap = cv2.approxPolyDP(c, eps_m * PX_PER_M, True)[:, 0, :]
        if len(ap) >= 4: out.append(ap.astype(float))
    return out

def grow(feat, seed, radius_m, tols, area_rng, sol_min=0.80):
    """colour-distance region growing from `seed` (crop px); returns (mask, tol, area_m2) or None."""
    lab = feat["lab"]; h, w = lab.shape[:2]
    sx, sy = int(seed[0]), int(seed[1])
    r = int(3 * PX_PER_M)
    patch = lab[max(0, sy - r):sy + r, max(0, sx - r):sx + r].reshape(-1, 3)
    ref = np.median(patch, axis=0)
    D = np.sqrt(((lab - ref) ** 2).sum(2))
    yy, xx = np.ogrid[:h, :w]
    disk = ((xx - sx) ** 2 + (yy - sy) ** 2) <= (radius_m * PX_PER_M) ** 2
    best = None
    for t in tols:
        m = ((D < t) & disk).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        n, lab_, st, ce = cv2.connectedComponentsWithStats(m, 8)
        if m[min(h - 1, sy), min(w - 1, sx)] == 0:
            # seed not inside: take the component nearest the seed
            if n <= 1: continue
            i = min(range(1, n), key=lambda i: (ce[i][0] - sx) ** 2 + (ce[i][1] - sy) ** 2)
        else:
            i = lab_[sy, sx]
        comp = (lab_ == i).astype(np.uint8) * 255
        # fill holes
        cn, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        filled = np.zeros_like(comp); cv2.drawContours(filled, cn, -1, 255, -1)
        a = (filled > 0).sum() * MPP * MPP
        c = max(cn, key=cv2.contourArea); sol = cv2.contourArea(c) / max(1.0, cv2.contourArea(cv2.convexHull(c)))
        touches_disk = (filled > 0)[~disk].any() if (~disk).any() else False
        if area_rng[0] <= a <= area_rng[1] and sol >= sol_min and not touches_disk:
            best = (filled, t, a)            # keep the LARGEST tolerance that is still compact & inside the disk
    return best

def smooth_poly(pts, buf_m=0.8, eps_m=0.35):
    p = Polygon(pts)
    if not p.is_valid: p = p.buffer(0)
    p = p.buffer(buf_m * PX_PER_M).buffer(-buf_m * PX_PER_M).simplify(eps_m * PX_PER_M)
    if p.is_empty: return None
    if isinstance(p, MultiPolygon): p = max(p.geoms, key=lambda g: g.area)
    return np.array(p.exterior.coords)

def trace_hole(n):
    h = HOLES[n]
    tref, via, g, tees = line_z19(h)
    chain = [tref] + via + [g]
    x0, y0, x1, y1 = crop_for(chain + tees)
    crop = IM[y0:y1, x0:x1]
    F = feats(crop)
    ch = [(p[0] - x0, p[1] - y0) for p in chain]
    teep = [(p[0] - x0, p[1] - y0) for p in tees]
    gp = ch[-1]
    Hh, Ww = crop.shape[:2]

    # corridor around the line of play
    corr = np.zeros((Hh, Ww), np.uint8)
    cv2.polylines(corr, [np.array(ch, np.int32)], False, 255, int(2 * 58 * PX_PER_M))
    cv2.circle(corr, (int(gp[0]), int(gp[1])), int(45 * PX_PER_M), 255, -1)
    for t in teep: cv2.circle(corr, (int(t[0]), int(t[1])), int(30 * PX_PER_M), 255, -1)

    # ---- green ----
    gres = grow(F, gp, 24, [6, 8, 10, 12, 14, 17, 20, 24], (230, 1500))
    green = None; gnote = "auto"
    if gres:
        cn, _ = cv2.findContours(gres[0], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cn, key=cv2.contourArea)
        green = smooth_poly(c[:, 0, :].astype(float), 0.8, 0.3)
    if green is None:
        r = 11 * PX_PER_M
        green = np.array([(gp[0] + r * math.cos(a), gp[1] + r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 25)])
        gnote = "fallback circle"

    # ---- fairway ----
    fair = ((F["H"] > 52) & (F["H"] < 100) & (F["A"] < 1.5) & (F["S"] > 0.16) & (F["tex"] < 10) & (F["V"] > 0.30)).astype(np.uint8) * 255
    fair = cv2.bitwise_and(fair, corr)
    fair = cv2.morphologyEx(fair, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(5 * PX_PER_M) | 1,) * 2))
    fair = cv2.morphologyEx(fair, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(7 * PX_PER_M) | 1,) * 2))
    # keep components that touch the line of play
    line_mask = np.zeros((Hh, Ww), np.uint8); cv2.polylines(line_mask, [np.array(ch, np.int32)], False, 255, int(14 * PX_PER_M))
    nn, lb, st, ce = cv2.connectedComponentsWithStats(fair, 8)
    keep = np.zeros_like(fair)
    for i in range(1, nn):
        comp = (lb == i)
        if st[i][4] * MPP * MPP < 250: continue
        if (comp & (line_mask > 0)).any(): keep[comp] = 255
    fair = keep
    fairways = [smooth_poly(c, 1.5, 0.9) for c in contour_polys(fair, 300, 0.9)]
    fairways = [f for f in fairways if f is not None]

    # ---- bunkers ----
    sand = ((F["V"] > 0.80) & (F["S"] < 0.30) & (F["H"] > 20) & (F["H"] < 75)).astype(np.uint8) * 255
    near = np.zeros((Hh, Ww), np.uint8)
    cv2.polylines(near, [np.array(ch, np.int32)], False, 255, int(2 * 45 * PX_PER_M)); cv2.circle(near, (int(gp[0]), int(gp[1])), int(55 * PX_PER_M), 255, -1)
    sand = cv2.bitwise_and(sand, near)
    sand = cv2.morphologyEx(sand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    sand = cv2.morphologyEx(sand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.6 * PX_PER_M) | 1,) * 2))
    bunkers = [smooth_poly(c, 0.5, 0.3) for c in contour_polys(sand, 9, 0.35, 900)]
    bunkers = [b for b in bunkers if b is not None]

    # ---- tee pads ----
    pads = []
    for t in teep:
        res = grow(F, t, 16, [4, 5, 6, 8, 10], (30, 380), 0.80)
        if res:
            cn, _ = cv2.findContours(res[0], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            poly = smooth_poly(max(cn, key=cv2.contourArea)[:, 0, :].astype(float), 0.8, 0.3); note = "auto"
        else:
            poly = None
        if poly is None:
            # ellipse 8 x 16 m, long axis along the line of play
            d = np.array(ch[1] if len(ch) > 1 else gp) - np.array(t); ang = math.atan2(d[1], d[0])
            a_, b_ = 8 * PX_PER_M, 4 * PX_PER_M
            poly = np.array([(t[0] + a_ * math.cos(s) * math.cos(ang) - b_ * math.sin(s) * math.sin(ang),
                              t[1] + a_ * math.cos(s) * math.sin(ang) + b_ * math.sin(s) * math.cos(ang)) for s in np.linspace(0, 2 * math.pi, 21)]); note = "ellipse"
        pads.append((poly, note))

    # ---- centreline: least-cost path through fairway/tee/green, waypoint by waypoint ----
    mask_ok = ((fair > 0) | (corr > 0) * 0).astype(np.uint8)
    cost = np.full((Hh, Ww), 25.0, np.float32)
    dist = cv2.distanceTransform((fair > 0).astype(np.uint8), cv2.DIST_L2, 5)
    cost[fair > 0] = 1.0 + 4.0 * np.exp(-dist[fair > 0] / (6 * PX_PER_M))
    cost = cv2.resize(cost, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    pts = []
    for a, b in zip(ch[:-1], ch[1:]):
        path, _ = route_through_array(cost, (int(a[1] * 0.25), int(a[0] * 0.25)), (int(b[1] * 0.25), int(b[0] * 0.25)), fully_connected=True, geometric=True)
        pts += [(c * 4.0, r * 4.0) for r, c in path]
    ls = LineString(pts).simplify(2.5 * PX_PER_M)
    # smooth lightly: Chaikin once
    cp = list(ls.coords)
    sm = [cp[0]]
    for a, b in zip(cp[:-1], cp[1:]):
        sm += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
    sm.append(cp[-1])
    sm[0], sm[-1] = ch[0], ch[-1]                                  # exact tee reference and green centre
    line = np.array(sm)

    # to mosaic px
    sh = lambda arr: (np.asarray(arr) + np.array([x0, y0])).tolist()
    res = dict(hole=n, par=h["par"], line=sh(line), green=sh(green), green_note=gnote,
               fairways=[sh(f) for f in fairways], bunkers=[sh(b) for b in bunkers],
               tees=[dict(poly=sh(p), note=nt) for p, nt in pads], tee_ref=list(tref))
    json.dump(res, open(f"{OUT_T}/hole{n}.json", "w"))

    # ---- QA overlay ----
    ov = crop.copy()
    def draw(poly, col, th=2): cv2.polylines(ov, [np.asarray(poly, np.int32)], True, col, th)
    for f in fairways: draw(f, (255, 255, 0), 2)
    for b in bunkers: draw(b, (0, 255, 255), 2)
    for p, nt in pads: draw(p, (0, 140, 255) if nt == "auto" else (0, 60, 255), 2)
    draw(green, (255, 0, 255), 3)
    cv2.polylines(ov, [np.asarray(line, np.int32)], False, (255, 255, 255), 2)
    sc = 0.5 if max(Hh, Ww) > 1700 else 0.7
    ov = cv2.resize(ov, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
    cv2.imwrite(f"{OUT_Q}/hole{n}.png", ov)
    gA = Polygon(green).area * MPP * MPP
    fA = sum(Polygon(f).area for f in fairways) * MPP * MPP
    print(f"hole {n}: green {gA:.0f} m² ({gnote})  fairway {len(fairways)} poly {fA:.0f} m²  bunkers {len(bunkers)}  tees {[nt for _, nt in pads]}  line {LineString(line).length*MPP*1.0936:.0f} yd  crop {Ww}x{Hh}")

if __name__ == "__main__":
    for a in sys.argv[1:]:
        trace_hole(int(a))
