"""trace3.py — final tracer. Reads: HOLES (trace.py), greens2.json, mosaic19w.png (Oct 2025, leaf-on) + mosaic19.png (Jan 2026).
   python3 trace3.py            -> all 18 holes
   python3 trace3.py 1 3 10     -> only those (needs feat_global.json from a previous full run for bunkers/water)
   Output (z18 mosaic px): trace3/holeN.json, trace3/global.json, qa3/holeN.png"""
import sys, os, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
os.environ.setdefault("MOSAIC", "mosaic19w.png")
from geo import *
from trace import HOLES, z19, MPP, PX_PER_M, OFFX, smooth_poly, feats, grow, contour_polys
from trace2 import chaikin, resample, to18, to19
import numpy as np, cv2
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

OCT = cv2.imread(f"{S}/mosaic19w.png"); JAN = cv2.imread(f"{S}/mosaic19.png")
OUT_T, OUT_Q = f"{S}/trace3", f"{S}/qa3"
os.makedirs(OUT_T, exist_ok=True); os.makedirs(OUT_Q, exist_ok=True)
GREENS = json.load(open(f"{S}/greens2.json"))
ENV = json.load(open(f"{S}/envelopes.json")) if os.path.exists(f"{S}/envelopes.json") else {}     # hand-drawn fairway limits, z18 polys

# tee fixes from Brett's arrows (v3): estimated pads, see notes
TEE_FIX = {
    8:  [(632, 995), (610, 972), (586, 950)],        # arrow at (635,998); back pads from card length (Medal 442 / Champ 473)
    18: [(2328, 918), (2300, 913), (2272, 908)],     # arrow at (2255,900); golfers standing at (2300,915); 491 yd straight line
}
for k, v in TEE_FIX.items(): HOLES[k]["tee"] = v
HOLES[15]["tee"] = [(3416, 2578), (3440, 2578), (3462, 2577)]   # west of 14's green; the old third pad sat on that green
FAIRWAY_SRC = {1: "jan"}                              # overseeded fairway: January green is the cleaner signal
K = lambda m: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, int(m * PX_PER_M) | 1),) * 2)

def inputs(n):
    h = HOLES[n]
    tees = [z19(p) for p in h["tee"]]
    tref = tees[len(tees) // 2] if n in TEE_FIX else min(tees, key=lambda p: np.hypot(p[0] - np.mean([q[0] for q in tees]), p[1] - np.mean([q[1] for q in tees])))
    gp = [to19(p) for p in GREENS[str(n)]["poly18"]]
    _P = Polygon(gp); _c = _P.centroid
    gc = (_c.x, _c.y) if _P.contains(_c) else tuple(_P.representative_point().coords[0])
    vias = [z19(p) for p in h["via"]]
    return h, tees, tref, vias, gp, gc

def seed_chain(n):
    h, tees, tref, vias, gp, gc = inputs(n)
    return resample(chaikin([tref] + vias + [gc], 2), 10 * PX_PER_M)

def crop_box(pts, margin_m):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; m = margin_m * PX_PER_M
    return int(max(0, min(xs) - m)), int(max(0, min(ys) - m)), int(min(OCT.shape[1], max(xs) + m)), int(min(OCT.shape[0], max(ys) + m))

def dist_map(chain, box):
    x0, y0, x1, y1 = box; img = np.full((y1 - y0, x1 - x0), 255, np.uint8)
    pts = np.array([(p[0] - x0, p[1] - y0) for p in chain], np.int32)
    cv2.polylines(img, [pts], False, 0, 1)
    return cv2.distanceTransform(img, cv2.DIST_L2, 3) * MPP          # metres

# ---------------------------------------------------------------- global features
def detect_sand(box):
    x0, y0, x1, y1 = box; c = OCT[y0:y1, x0:x1]
    sm = cv2.GaussianBlur(c, (0, 0), 1.0); hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
    H = hsv[..., 0].astype(np.float32) * 2; Sx = hsv[..., 1] / 255.0; V = hsv[..., 2] / 255.0
    sand = ((V > 0.70) & (Sx >= 0.05) & (Sx <= 0.30) & (H > 30) & (H < 75)).astype(np.uint8) * 255
    sand = cv2.morphologyEx(sand, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    sand = cv2.morphologyEx(sand, cv2.MORPH_CLOSE, K(1.4))
    turf = ((H >= 55) & (H <= 140) & (Sx >= 0.18) & (V >= 0.18) & (V <= 0.80)).astype(np.uint8)
    out = []
    cn, _ = cv2.findContours(sand, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    for cc in cn:
        a = cv2.contourArea(cc) * MPP * MPP
        if a < 10 or a > 800: continue
        blob = np.zeros(sand.shape, np.uint8); cv2.drawContours(blob, [cc], -1, 255, -1)
        ring = cv2.subtract(cv2.dilate(blob, K(6.0)), cv2.dilate(blob, K(1.6)))
        if (turf[ring > 0].mean() if (ring > 0).any() else 0) < 0.45: continue
        ring_v = float(V[cv2.subtract(cv2.dilate(blob, K(3.0)), cv2.dilate(blob, K(1.2))) > 0].mean())
        if float(V[blob > 0].mean()) - ring_v < 0.15: continue                    # sand is clearly brighter than what surrounds it
        hull = cv2.convexHull(cc); sol = cv2.contourArea(cc) / max(1.0, cv2.contourArea(hull))
        dt = cv2.distanceTransform(blob, cv2.DIST_L2, 3)
        width_m = 2.0 * float(dt.max()) * MPP                                    # widest inscribed circle: a cart path is <= 3 m, a bunker more
        if sol < 0.38 or width_m < 2.0: continue
        p = smooth_poly(cc[:, 0, :].astype(float), 0.5, 0.3)
        if p is not None: out.append([list(to18((q[0] + x0, q[1] + y0))) for q in p])
    return out

def dedupe(polys18, tol=3.0):
    keep = []
    for p in polys18:
        c = Polygon(p).centroid
        if any(math.hypot(c.x - k[1].x, c.y - k[1].y) * MPP * 2 < tol for k in keep): continue
        keep.append((p, c))
    return [k[0] for k in keep]

def build_global():
    chains = {n: seed_chain(n) for n in HOLES}
    allp = [p for ch in chains.values() for p in ch]
    bunkers = []
    for n in HOLES:
        _, tees, tref, vias, gp, gc = inputs(n)
        box = crop_box(chains[n] + tees + gp, 52)
        bunkers += detect_sand(box)
    bunkers = dedupe(bunkers)
    FALSE_SAND = [(2612, 816)]                                   # found by eye: the pool deck behind the 11th tee (z18 px)
    bunkers = [b for b in bunkers if all(Polygon(b).centroid.distance(Point(*fp)) > 12 for fp in FALSE_SAND)]
    line18 = unary_union([LineString([to18(p) for p in ch]) for ch in chains.values()])
    green18 = unary_union([Polygon(GREENS[str(n)]["poly18"]) for n in HOLES])
    tee_pts = [Point(to18(chains[n][0])) for n in HOLES]
    r_tee = 30.0 / (MPP * 2)                                   # nothing within 30 m of a tee reference is a bunker (pool decks, driveways behind the tee)
    r_line, r_green = 36.0 / (MPP * 2), 30.0 / (MPP * 2)           # a fairway bunker sits within ~36 m of the line; a pool deck two lots over does not
    bunkers = [b for b in bunkers if (Polygon(b).distance(line18) <= r_line or Polygon(b).distance(green18) <= r_green) and Polygon(b).centroid.distance(green18) > 1.0 and min(Polygon(b).centroid.distance(t) for t in tee_pts) > r_tee]
    # OSM water inside the play area; streams buffered into narrow polygons
    A = json.load(open(f"{S}/woodmont-A.json")); W = json.load(open(f"{S}/waterways.json"))
    line_union = unary_union([LineString([to18(p) for p in ch]) for ch in chains.values()])
    green_union = unary_union([Polygon(GREENS[str(n)]["poly18"]) for n in HOLES])
    play = unary_union([line_union.buffer(60 * PX_PER_M / 2), green_union.buffer(60 * PX_PER_M / 2)])      # z18 px (1 px = 2 z19 px)
    water, seen = [], set()
    for src in (A, W):
        for e in src["elements"]:
            t = e.get("tags", {})
            if e["id"] in seen or e["type"] != "way": continue
            pts = [list(to_px(q["lat"], q["lon"], 18)) for q in e.get("geometry", [])]
            if len(pts) < 2: continue
            if t.get("natural") == "water" and len(pts) >= 4:
                poly = Polygon(pts)
                if poly.is_valid and poly.intersects(play) and poly.area * (MPP * 2) ** 2 > 150:
                    water.append(dict(kind="water_hazard", osm=e["id"], name=t.get("name", ""), poly=[list(q) for q in poly.exterior.coords]))
                    seen.add(e["id"])
            elif t.get("waterway") == "stream":
                ls = LineString(pts)
                if ls.intersects(play):
                    buf = ls.intersection(play.buffer(10)).buffer(3.5 / (MPP * 2), cap_style=2)   # ±2 m, clipped to the play area
                    geoms = list(buf.geoms) if hasattr(buf, "geoms") else [buf]
                    for g in geoms:
                        if g.area * (MPP * 2) ** 2 > 20: water.append(dict(kind="lateral_water_hazard", osm=e["id"], name=t.get("name", ""), poly=[list(q) for q in g.exterior.coords]))
                    seen.add(e["id"])
    json.dump(dict(bunkers=bunkers, water=water), open(f"{OUT_T}/global.json", "w"))
    print(f"global: {len(bunkers)} bunkers, {len(water)} water polygons")

# ---------------------------------------------------------------- per hole
def mown_oct(c):
    sm = cv2.GaussianBlur(c, (0, 0), 1.0); hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV)
    H = hsv[..., 0].astype(np.float32) * 2; Sx = hsv[..., 1] / 255.0; V = hsv[..., 2] / 255.0
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY).astype(np.float32); mu = cv2.blur(g, (11, 11)); tex = np.sqrt(np.maximum(cv2.blur(g * g, (11, 11)) - mu * mu, 0))
    return ((H >= 78) & (H <= 114) & (Sx >= 0.28) & (Sx <= 0.52) & (V >= 0.42) & (V <= 0.66) & (tex < 7)).astype(np.uint8) * 255

def green_jan(c):
    sm = cv2.GaussianBlur(c, (0, 0), 1.2); hsv = cv2.cvtColor(sm, cv2.COLOR_BGR2HSV); lab = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB).astype(np.float32)
    H = hsv[..., 0].astype(np.float32) * 2; Sx = hsv[..., 1] / 255.0; V = hsv[..., 2] / 255.0; A = lab[..., 1] - 128
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY).astype(np.float32); mu = cv2.blur(g, (11, 11)); tex = np.sqrt(np.maximum(cv2.blur(g * g, (11, 11)) - mu * mu, 0))
    return ((H >= 54) & (H <= 112) & (A < 1.5) & (Sx >= 0.16) & (V >= 0.36) & (tex < 9)).astype(np.uint8) * 255

def tee_polygons(n, box, chain_c, greens_c=()):
    h, tees, tref, vias, gp, gc = inputs(n); x0, y0, x1, y1 = box
    F = feats(OCT[y0:y1, x0:x1]); out = []
    for t in tees:
        tc = (t[0] - x0, t[1] - y0); poly, note = None, "ellipse"
        res = None if n in TEE_FIX else grow(F, tc, 16, [4, 5, 6, 8, 10], (60, 200), 0.85)
        if res:
            cn, _ = cv2.findContours(res[0], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            pp = smooth_poly(max(cn, key=cv2.contourArea)[:, 0, :].astype(float), 0.8, 0.3)
            if pp is not None:
                PP = Polygon(pp)
                if not any(PP.intersects(Polygon(g)) for g in greens_c if len(g) >= 3): poly, note = pp, "auto"
        if poly is None:
            nxt = np.array(chain_c[min(3, len(chain_c) - 1)]); d = nxt - np.array(tc); ang = math.atan2(d[1], d[0])
            a_, b_ = 6.0 * PX_PER_M, 3.4 * PX_PER_M
            poly = np.array([(tc[0] + a_ * math.cos(s) * math.cos(ang) - b_ * math.sin(s) * math.sin(ang), tc[1] + a_ * math.cos(s) * math.sin(ang) + b_ * math.sin(s) * math.cos(ang)) for s in np.linspace(0, 2 * math.pi, 21)])
        out.append((poly, note))
    return out

def fairway_polys(n, box, chain, own_max_m, bunk_c, water_c, green_c, tee_c, chains_all):
    h = HOLES[n]
    if h["par"] == 3: return []
    x0, y0, x1, y1 = box; hh, ww = y1 - y0, x1 - x0
    src = FAIRWAY_SRC.get(n, "oct")
    mask = mown_oct(OCT[y0:y1, x0:x1]) if src == "oct" else green_jan(JAN[y0:y1, x0:x1])
    # ownership: this hole's centreline must be the nearest of all lines, and within own_max_m
    own_d = dist_map([(q[0] + x0, q[1] + y0) for q in chain], box); owner_ok = np.ones((hh, ww), bool)
    for k, ch in chains_all.items():
        if k == n: continue
        if not any(x0 - 80 < p[0] < x1 + 80 and y0 - 80 < p[1] < y1 + 80 for p in ch[::4]): continue
        dk = dist_map(ch, box); owner_ok &= (dk >= own_d - 0.5)
    mask[~(owner_ok & (own_d <= own_max_m))] = 0
    cut = np.zeros((hh, ww), np.uint8)
    for poly in green_c + bunk_c + water_c + tee_c: cv2.fillPoly(cut, [np.round(np.asarray(poly)).astype(np.int32)], 255)
    mask[cv2.dilate(cut, K(1.2)) > 0] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, K(3.0)); mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, K(5.0))
    band = np.zeros((hh, ww), np.uint8); cv2.polylines(band, [np.array(chain, np.int32)], False, 255, int(2 * 3.5 * PX_PER_M))
    nn, lb, st, ce = cv2.connectedComponentsWithStats(mask, 8); keep = np.zeros_like(mask)
    for i in range(1, nn):
        if st[i][4] * MPP * MPP < 250: continue
        if (lb == i)[band > 0].any(): keep[lb == i] = 255
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, K(6.0))
    if str(n) in ENV:                                                  # hand-drawn limit: fairway cannot leave this envelope
        env = np.zeros((hh, ww), np.uint8); cv2.fillPoly(env, [np.array([((to19(p)[0] - x0), (to19(p)[1] - y0)) for p in ENV[str(n)]], np.int32)], 255)
        keep = cv2.bitwise_and(keep, env)
    tee_zone = np.zeros((hh, ww), np.uint8)
    for tp in tee_c: cv2.fillPoly(tee_zone, [np.round(np.asarray(tp)).astype(np.int32)], 255)
    keep[cv2.dilate(tee_zone, K(30.0)) > 0] = 0
    t0 = np.array(chain[0], float); cut_r = 35 * PX_PER_M
    keep_d = cv2.distanceTransform(255 - cv2.circle(np.zeros((hh, ww), np.uint8), (int(t0[0]), int(t0[1])), 1, 255), cv2.DIST_L2, 3)
    keep[keep_d < cut_r] = 0
    keep = cv2.morphologyEx(keep, cv2.MORPH_OPEN, K(3.0))
    cn, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); out = []
    for cc in cn:
        if cv2.contourArea(cc) * MPP * MPP < 250: continue
        P = Polygon(cc[:, 0, :].astype(float)).buffer(0)
        if P.is_empty: continue
        P = P.buffer(2.0 * PX_PER_M).buffer(-4.0 * PX_PER_M).buffer(2.0 * PX_PER_M).simplify(0.9 * PX_PER_M)
        for g in (P.geoms if isinstance(P, MultiPolygon) else [P]):
            if g.area * MPP * MPP >= 450: out.append(np.array(g.exterior.coords))
    return out

def recentre(chain, fairways, ends):
    if not fairways: return chain
    U = unary_union([Polygon(f).buffer(0) for f in fairways]); pts = resample(chain, 12 * PX_PER_M); out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b = np.array(pts[i - 1]), np.array(pts[i + 1]); t = b - a; nr = np.linalg.norm(t)
        if nr < 1e-6: out.append(pts[i]); continue
        t /= nr; nv = np.array([-t[1], t[0]]); c = np.array(pts[i])
        seg = LineString([tuple(c - nv * 24 * PX_PER_M), tuple(c + nv * 24 * PX_PER_M)]); inter = U.intersection(seg)
        gs = [g for g in (inter.geoms if hasattr(inter, "geoms") else [inter]) if g.geom_type == "LineString"] if not inter.is_empty else []
        if not gs: out.append(pts[i]); continue
        g = min(gs, key=lambda g: g.distance(Point(*c)))
        if g.length < 6 * PX_PER_M or g.distance(Point(*c)) > 4 * PX_PER_M: out.append(pts[i]); continue
        mid = g.interpolate(0.5, normalized=True).coords[0]; out.append((0.4 * c[0] + 0.6 * mid[0], 0.4 * c[1] + 0.6 * mid[1]))
    out.append(pts[-1]); sm = chaikin(out, 2)
    res = resample(LineString(sm).simplify(1.5 * PX_PER_M).coords, 8 * PX_PER_M); res[0], res[-1] = ends
    return res

def trace_hole(n, G, chains_all, refined):
    h, tees, tref, vias, gp, gc = inputs(n)
    chain0 = chains_all[n]
    box = crop_box(chain0 + tees + gp, 62); x0, y0, x1, y1 = box
    sh = lambda p: (p[0] - x0, p[1] - y0)
    in_box = lambda poly: any(x0 <= to19(q)[0] <= x1 and y0 <= to19(q)[1] <= y1 for q in poly)
    c_of = lambda polys18: [np.array([sh(to19(q)) for q in p]) for p in polys18 if in_box(p)]
    bunk_c, water_c = c_of(G["bunkers"]), c_of([w["poly"] for w in G["water"]])
    green_c = [np.array([sh(p) for p in gp])]
    # other holes' greens and all tee pads are not fairway
    for k in HOLES:
        if k != n:
            gk = [to19(q) for q in GREENS[str(k)]["poly18"]]
            if any(x0 - 50 < q[0] < x1 + 50 and y0 - 50 < q[1] < y1 + 50 for q in gk): green_c.append(np.array([sh(q) for q in gk]))
    chain_c = [sh(p) for p in chain0]
    tee_p = tee_polygons(n, box, chain_c, green_c)
    tee_c = [p for p, _ in tee_p]
    for k in HOLES:
        if k != n:
            for t in HOLES[k]["tee"]:
                tt = z19(t)
                if x0 - 30 < tt[0] < x1 + 30 and y0 - 30 < tt[1] < y1 + 30:
                    tc = sh(tt); tee_c.append(np.array([(tc[0] + 6 * PX_PER_M * math.cos(s), tc[1] + 3.4 * PX_PER_M * math.sin(s)) for s in np.linspace(0, 2 * math.pi, 13)]))
    ch_all = {k: v for k, v in chains_all.items()}
    fw = fairway_polys(n, box, chain_c, 31, bunk_c, water_c, green_c, tee_c, ch_all)
    line = recentre(chain_c, fw, (chain_c[0], sh(gc)))
    if fw:                                                               # second pass around the refined line
        ch_all2 = dict(ch_all); ch_all2[n] = [(p[0] + x0, p[1] + y0) for p in line]
        fw = fairway_polys(n, box, line, 29, bunk_c, water_c, green_c, tee_c, ch_all2) or fw
        line = recentre(line, fw, (chain_c[0], sh(gc)))
    refined[n] = [(p[0] + x0, p[1] + y0) for p in line]
    to18c = lambda arr: [list(to18((p[0] + x0, p[1] + y0))) for p in arr]
    res = dict(hole=n, par=h["par"], line=to18c(line), green=GREENS[str(n)]["poly18"], fairways=[to18c(f) for f in fw],
               tees=[dict(poly=to18c(p), note=nt) for p, nt in tee_p], tee_ref=list(to18(tref)), fairway_src=FAIRWAY_SRC.get(n, "oct"))
    json.dump(res, open(f"{OUT_T}/hole{n}.json", "w"))
    ln = LineString(line).length * MPP * 1.0936
    print(f"hole {n} par {h['par']}: line {ln:.0f} yd | fairway {len(fw)} poly {sum(Polygon(f).area for f in fw) * MPP * MPP:.0f} m² ({FAIRWAY_SRC.get(n, 'oct')}) | tees {[nt for _, nt in tee_p]}", flush=True)

if __name__ == "__main__":
    args = [int(a) for a in sys.argv[1:]] or list(range(1, 19))
    if not os.path.exists(f"{OUT_T}/global.json") or len(sys.argv) == 1: build_global()
    G = json.load(open(f"{OUT_T}/global.json"))
    chains_all = {n: seed_chain(n) for n in HOLES}
    for k in list(chains_all):                                          # use previously refined lines for other holes when available
        p = f"{OUT_T}/hole{k}.json"
        if os.path.exists(p): chains_all[k] = [to19(q) for q in json.load(open(p))["line"]]
    refined = {}
    for n in args: trace_hole(n, G, chains_all, refined)
