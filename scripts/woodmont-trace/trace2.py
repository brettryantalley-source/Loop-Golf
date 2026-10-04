"""trace2.py — v2 tracer. Greens come from greens2.json (watershed + hand polygons). Everything else is built here.
   python3 trace2.py 10 12 17        -> trace2/holeN.json (z18 px coords) and qa2/holeN.png
Pipeline per hole: tee pads (grow/ellipse) -> bunkers (sand colour, near line/green) -> fairway (GrabCut seeded on the line)
-> centreline (waypoints, re-centred on the fairway, smoothed)."""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from trace import HOLES, z19, IM, MPP, PX_PER_M, OFFX, smooth_poly, feats, grow, contour_polys
import numpy as np, cv2
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

OUT_T, OUT_Q = f"{S}/trace2", f"{S}/qa2"
os.makedirs(OUT_T, exist_ok=True); os.makedirs(OUT_Q, exist_ok=True)
OVR = json.load(open(f"{S}/overrides.json")) if os.path.exists(f"{S}/overrides.json") else {}
GREENS = json.load(open(f"{S}/greens2.json"))

to18 = lambda p: ((p[0] - OFFX) / 2.0, p[1] / 2.0)
to19 = lambda p: (2.0 * p[0] + OFFX, 2.0 * p[1])

def chaikin(pts, n=2):
    pts = [tuple(p) for p in pts]
    for _ in range(n):
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        out.append(pts[-1]); pts = out
    return pts

def resample(pts, step):
    ls = LineString(pts); L = ls.length
    n = max(2, int(L / step) + 1)
    return [ls.interpolate(i * L / (n - 1)).coords[0] for i in range(n)]

def hole_inputs(n):
    h = HOLES[n]
    tees = [z19(p) for p in h["tee"]]
    tc = np.mean(tees, axis=0)
    tref = min(tees, key=lambda p: (p[0] - tc[0]) ** 2 + (p[1] - tc[1]) ** 2)
    g = GREENS[str(n)]
    gpoly = [to19(p) for p in g["poly18"]]
    gcen = tuple(np.mean(gpoly, axis=0))
    vias = [z19(p) for p in h["via"]]
    return h, tees, tref, vias, gpoly, gcen

def fairway_grabcut(crop, chain, gpoly, bunk_polys, water_polys, par):
    """GrabCut seeded on the waypoint line. Returns a list of polygons (crop px)."""
    h, w = crop.shape[:2]
    line = np.array(chain, np.int32)
    L = LineString(chain)
    def band(half_m):
        m = np.zeros((h, w), np.uint8); cv2.polylines(m, [line], False, 255, max(1, int(2 * half_m * PX_PER_M))); return m
    sure_band, prob_fg, prob_bg_zone = band(2.5), band(24), band(60)
    sm = cv2.bilateralFilter(crop, 9, 14, 5)
    lab = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB).astype(np.float32)
    # trim the tee and green ends of the seed band: seeds only from 12% to 88% of the line
    seed_line = [L.interpolate(t * L.length).coords[0] for t in np.linspace(0.12, 0.88, 40)]
    seed = np.zeros((h, w), np.uint8)
    cv2.polylines(seed, [np.array(seed_line, np.int32)], False, 255, max(1, int(2 * 2.5 * PX_PER_M)))
    pix = lab[seed > 0].reshape(-1, 3)
    if len(pix) < 200: return []
    med = np.median(pix, 0); mad = np.median(np.abs(pix - med), 0) * 1.4826 + 1.0
    # drop seed pixels that are shadow / tree / water (colour far from the band's typical turf)
    z = np.abs((lab - med) / (3.0 * mad)).max(2)
    sure_fg = ((seed > 0) & (z < 1.0)).astype(np.uint8) * 255
    if sure_fg.sum() < 255 * 150: return []
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[prob_bg_zone > 0] = cv2.GC_PR_BGD
    mask[prob_fg > 0] = cv2.GC_PR_FGD
    mask[sure_fg > 0] = cv2.GC_FGD
    # known non-fairway: greens, bunkers, water, very dark (trees / deep shade)
    def fillp(polys, val):
        for p in polys: cv2.fillPoly(mask, [np.array(p, np.int32)], val)
    fillp([gpoly], cv2.GC_BGD); fillp(bunk_polys, cv2.GC_BGD); fillp(water_polys, cv2.GC_BGD)
    v = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)[..., 2]
    mask[(v < 55) & (mask != cv2.GC_FGD)] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(sm, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    except cv2.error as e:
        print("   grabcut failed:", e); return []
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8) * 255
    fg = cv2.bitwise_and(fg, prob_bg_zone)
    k = lambda m: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(m * PX_PER_M) | 1,) * 2)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k(3.0))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k(5.0))
    # keep components touching the line of play, drop specks
    nn, lb, st, ce = cv2.connectedComponentsWithStats(fg, 8)
    line_m = band(1.5)
    keep = np.zeros_like(fg)
    for i in range(1, nn):
        comp = lb == i
        if st[i][4] * MPP * MPP < 200: continue
        if (comp & (line_m > 0)).any() or (comp & (sure_fg > 0)).any(): keep[comp] = 255
    cn, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    polys = []
    for c in cn:
        if cv2.contourArea(c) * MPP * MPP < 250: continue
        p = smooth_poly(c[:, 0, :].astype(float), 1.2, 0.8)
        if p is not None: polys.append(p)
    return polys


def fairway_mask(crop, chain, gpoly, bunk_polys, water_polys, par):
    """Mowed-turf mask (leaf-on imagery): hue/sat/value band + low texture, restricted to a corridor around the line of play."""
    h, w = crop.shape[:2]
    sm = cv2.GaussianBlur(crop, (0, 0), 1.0)
    hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
    H = hsv[..., 0].astype(np.float32) * 2; Sx = hsv[..., 1] / 255.0; V = hsv[..., 2] / 255.0
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    mu = cv2.blur(g, (11, 11)); tex = np.sqrt(np.maximum(cv2.blur(g * g, (11, 11)) - mu * mu, 0))
    mown = ((H >= 78) & (H <= 114) & (Sx >= 0.28) & (Sx <= 0.52) & (V >= 0.42) & (V <= 0.66) & (tex < 7)).astype(np.uint8) * 255
    line = np.array(chain, np.int32)
    corr = np.zeros((h, w), np.uint8); cv2.polylines(corr, [line], False, 255, int(2 * 55 * PX_PER_M))
    mown = cv2.bitwise_and(mown, corr)
    cut = np.zeros((h, w), np.uint8)
    cv2.fillPoly(cut, [np.array(gpoly, np.int32)], 255)
    for b in bunk_polys: cv2.fillPoly(cut, [np.array(b, np.int32)], 255)
    for wp in water_polys: cv2.fillPoly(cut, [np.array(wp, np.int32)], 255)
    cut = cv2.dilate(cut, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.2 * PX_PER_M) | 1,) * 2))
    mown[cut > 0] = 0
    k = lambda m: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(m * PX_PER_M) | 1,) * 2)
    mown = cv2.morphologyEx(mown, cv2.MORPH_OPEN, k(3.0))
    mown = cv2.morphologyEx(mown, cv2.MORPH_CLOSE, k(5.0))
    band = np.zeros((h, w), np.uint8); cv2.polylines(band, [line], False, 255, int(2 * 3.5 * PX_PER_M))
    nn, lb, st, ce = cv2.connectedComponentsWithStats(mown, 8)
    keep = np.zeros_like(mown)
    for i in range(1, nn):
        if st[i][4] * MPP * MPP < 250: continue
        if (lb == i)[band > 0].any(): keep[lb == i] = 255
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, k(6.0))
    cn, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    polys = []
    for c in cn:
        if cv2.contourArea(c) * MPP * MPP < 250: continue
        p = smooth_poly(c[:, 0, :].astype(float), 1.5, 0.9)
        if p is not None: polys.append(p)
    return polys

def sand_polys(crop, chain, gcen, gpoly):
    F = feats(crop); h, w = crop.shape[:2]
    sand = ((F["V"] > 0.78) & (F["S"] < 0.32) & (F["H"] > 18) & (F["H"] < 80)).astype(np.uint8) * 255
    zone = np.zeros((h, w), np.uint8)
    cv2.polylines(zone, [np.array(chain, np.int32)], False, 255, int(2 * 30 * PX_PER_M))
    cv2.circle(zone, (int(gcen[0]), int(gcen[1])), int(48 * PX_PER_M), 255, -1)
    sand = cv2.bitwise_and(sand, zone)
    sand = cv2.morphologyEx(sand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    sand = cv2.morphologyEx(sand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(1.4 * PX_PER_M) | 1,) * 2))
    out = []
    for c in contour_polys(sand, 12, 0.35, 520):
        p = smooth_poly(c, 0.5, 0.3)
        if p is None: continue
        P = Polygon(p)
        if P.area * MPP * MPP < 12: continue
        if P.area / max(1e-6, P.convex_hull.area) < 0.65: continue
        out.append(p)
    return out

def tee_polys(crop, tees_c, chain):
    F = feats(crop); out = []
    for t in tees_c:
        res = grow(F, t, 16, [4, 5, 6, 8, 10], (30, 380), 0.80)
        poly, note = None, "ellipse"
        if res:
            cn, _ = cv2.findContours(res[0], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            poly = smooth_poly(max(cn, key=cv2.contourArea)[:, 0, :].astype(float), 0.8, 0.3)
            if poly is not None: note = "auto"
        if poly is None:
            nxt = np.array(chain[1] if len(chain) > 1 else t); d = nxt - np.array(t); ang = math.atan2(d[1], d[0])
            a_, b_ = 7.5 * PX_PER_M, 4.0 * PX_PER_M
            poly = np.array([(t[0] + a_ * math.cos(s) * math.cos(ang) - b_ * math.sin(s) * math.sin(ang),
                              t[1] + a_ * math.cos(s) * math.sin(ang) + b_ * math.sin(s) * math.cos(ang)) for s in np.linspace(0, 2 * math.pi, 21)])
        out.append((poly, note))
    return out

def recentre(chain, fairways):
    """Pull intermediate waypoints to the middle of the fairway cross-section; smooth; keep both ends."""
    if not fairways: return chain
    U = unary_union([Polygon(f).buffer(0) for f in fairways])
    pts = resample(chain, 12 * PX_PER_M)
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b = np.array(pts[i - 1]), np.array(pts[i + 1]); t = b - a; nrm = np.linalg.norm(t)
        if nrm < 1e-6: out.append(pts[i]); continue
        t = t / nrm; nv = np.array([-t[1], t[0]])
        c = np.array(pts[i]); seg = LineString([tuple(c - nv * 26 * PX_PER_M), tuple(c + nv * 26 * PX_PER_M)])
        inter = U.intersection(seg)
        if inter.is_empty: out.append(pts[i]); continue
        geoms = [g for g in (inter.geoms if hasattr(inter, "geoms") else [inter]) if g.geom_type == "LineString"]
        if not geoms: out.append(pts[i]); continue
        g = min(geoms, key=lambda g: g.distance(Point(*c)))
        if g.length < 6 * PX_PER_M: out.append(pts[i]); continue
        mid = g.interpolate(0.5, normalized=True).coords[0]
        out.append((0.35 * c[0] + 0.65 * mid[0], 0.35 * c[1] + 0.65 * mid[1]))
    out.append(pts[-1])
    sm = chaikin(out, 2)
    return resample(LineString(sm).simplify(1.5 * PX_PER_M).coords, 8 * PX_PER_M)

def trace_hole(n, water18=None):
    h, tees, tref, vias, gpoly, gcen = hole_inputs(n)
    chain0 = [tref] + vias + [gcen]
    allp = chain0 + tees + gpoly
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    m = 75 * PX_PER_M
    x0, y0 = int(max(0, min(xs) - m)), int(max(0, min(ys) - m)); x1, y1 = int(min(IM.shape[1], max(xs) + m)), int(min(IM.shape[0], max(ys) + m))
    crop = IM[y0:y1, x0:x1]
    sh = lambda p: (p[0] - x0, p[1] - y0)
    chain_c = [sh(p) for p in chain0]; gpoly_c = [sh(p) for p in gpoly]; gcen_c = sh(gcen); tees_c = [sh(p) for p in tees]
    # a smoothed waypoint line is the seed line
    seed_chain = resample(chaikin(chain_c, 2), 10 * PX_PER_M)

    bunkers_c = sand_polys(crop, seed_chain, gcen_c, gpoly_c)
    water_c = []
    for wp in (water18 or []):
        pc = [sh(to19(q)) for q in wp]
        water_c.append(np.array(pc))
    fairways_c = []
    if h["par"] >= 4:
        fairways_c = fairway_mask(crop, seed_chain, gpoly_c, [b for b in bunkers_c], water_c, h["par"])
    chain_final = recentre(seed_chain, fairways_c) if fairways_c else seed_chain
    chain_final[0], chain_final[-1] = chain_c[0], gcen_c
    pads = tee_polys(crop, tees_c, chain_final)

    to18c = lambda arr: [list(to18((p[0] + x0, p[1] + y0))) for p in arr]
    res = dict(hole=n, par=h["par"], line=to18c(chain_final), green=[list(p) for p in GREENS[str(n)]["poly18"]],
               fairways=[to18c(f) for f in fairways_c], bunkers=[to18c(b) for b in bunkers_c],
               tees=[dict(poly=to18c(p), note=nt) for p, nt in pads], tee_ref=list(to18(tref)))
    json.dump(res, open(f"{OUT_T}/hole{n}.json", "w"))

    # QA picture
    ov = crop.copy()
    def draw(poly, col, th=2): cv2.polylines(ov, [np.asarray(poly, np.int32)], True, col, th)
    for f in fairways_c: draw(f, (255, 255, 0), 2)
    for b in bunkers_c: draw(b, (0, 255, 255), 2)
    for p, nt in pads: draw(p, (0, 140, 255) if nt == "auto" else (60, 60, 255), 2)
    for wp in water_c: draw(wp, (255, 120, 0), 2)
    draw(gpoly_c, (255, 0, 255), 3)
    cv2.polylines(ov, [np.asarray(chain_final, np.int32)], False, (255, 255, 255), 2)
    sc = 0.5 if max(crop.shape[:2]) > 1700 else 0.7
    cv2.imwrite(f"{OUT_Q}/hole{n}.png", cv2.resize(ov, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA))
    fA = sum(Polygon(f).area for f in fairways_c) * MPP * MPP if fairways_c else 0
    ln = LineString(chain_final).length * MPP * 1.0936
    print(f"hole {n} par {h['par']}: line {ln:.0f} yd | fairway {len(fairways_c)} poly {fA:.0f} m² | bunkers {len(bunkers_c)} | tees {[nt for _, nt in pads]}", flush=True)

if __name__ == "__main__":
    for a in sys.argv[1:]:
        trace_hole(int(a))
