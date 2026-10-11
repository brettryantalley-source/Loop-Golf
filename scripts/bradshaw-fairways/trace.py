# C40 (Oct 11, DRAFT — not shipped): Bradshaw fairways traced from the Esri photo (z18), grown from OSM's fairways.
# Per hole: learn fairway (ExG, texture) from the hole's OSM fairway, rough from the turf around it,
# classify the hole's own corridor (nearest hole line, within 45 m), clean up, keep what touches the
# hole line or OSM's fairway, union with OSM. Writes a fairway mask + polygons (lat/lon) as JSON.
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

S = os.environ.get('WORK', '/tmp/bradshaw-fairways'); os.makedirs(S, exist_ok=True)
z = 18
meta = json.load(open(f'{S}/bradshaw-z{z}.json'))
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', 'bradshaw.json')))
img = np.asarray(Image.open(f'{S}/bradshaw-z{z}.jpg').convert('RGB')).astype(float)
H, W, _ = img.shape
lat0 = 34.159
M_PER_PX = 156543.03392 * math.cos(math.radians(lat0)) / 2 ** z

def px(lat, lon):
    n = 2 ** z
    x = (lon + 180) / 360 * n; y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return ((x - meta['X0']) * 256, (y - meta['Y0']) * 256)

def ll(xp, yp):
    n = 2 ** z
    x = xp / 256 + meta['X0']; y = yp / 256 + meta['Y0']
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return [round(lat, 7), round(lon, 7)]

def poly_mask(rings):
    m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
    for r in rings:
        if len(r) >= 3: dr.polygon([px(*p) for p in r], fill=255)
    return np.asarray(m) > 0

def rings_of(w):
    return [w['pts']] if w.get('pts') else (w.get('outer') or [])

by = {}
holes = []
for w in d['ways']:
    t = w.get('tags') or {}; g = t.get('golf')
    if g == 'hole': holes.append(w); continue
    by.setdefault(g, []).extend(rings_of(w))
fw_osm = poly_mask(by.get('fairway', []))
excl = poly_mask(by.get('green', []) + by.get('tee', []) + by.get('bunker', []) + by.get('water_hazard', []) + by.get('water', []))
np.save(f'{S}/fw_mask.npy', fw_osm)                                        # show.py draws OSM's fairway from it
greens = poly_mask(by.get('green', []))
excl |= ndimage.binary_dilation(greens, iterations=int(3 / M_PER_PX))     # the collar is not fairway

R, G, B = img[..., 0], img[..., 1], img[..., 2]
lum = (R + G + B) / 3
tex = np.sqrt(np.maximum(ndimage.uniform_filter(lum ** 2, 5) - ndimage.uniform_filter(lum, 5) ** 2, 0))
k = 11
exs = ndimage.uniform_filter(2 * G - R - B, k); txs = ndimage.uniform_filter(tex, k); lms = ndimage.uniform_filter(lum, k)
trees = (lms < 95) | (txs > 11)

# each pixel belongs to its nearest hole line
near = np.zeros((H, W), np.int16); dmin = np.full((H, W), np.inf, np.float32)
for i, w in enumerate(holes):
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).line([px(*p) for p in w['pts']], fill=255, width=3)
    dd = ndimage.distance_transform_edt(~(np.asarray(m) > 0)).astype(np.float32)
    closer = dd < dmin
    near[closer] = i; dmin[closer] = dd[closer]
    del dd, closer
CORR = 45 / M_PER_PX
out = fw_osm.copy()
report = []
LR = float(os.environ.get('LR', '0'))      # log-likelihood ratio threshold; the Oct 11 draft used 0 (1 : 1)
X = lambda m: np.stack([exs[m], txs[m]], 1)
allin = ndimage.binary_erosion(fw_osm, iterations=3)
pooledA = X(allin)
pooled = (pooledA.mean(0), np.cov(pooledA.T) + np.eye(2))
for i, w in enumerate(holes):
    name = (w.get('tags') or {}).get('name')
    corr = (near == i) & (dmin <= CORR)
    osm_here = fw_osm & corr
    inner = ndimage.binary_erosion(osm_here, iterations=3)
    cand = corr & ~excl & ~trees & ~fw_osm
    rough = cand & ~ndimage.binary_dilation(fw_osm, iterations=8)
    if rough.sum() < 400:
        report.append((name, 'skipped: no turf to classify', int(rough.sum()))); continue
    Bq = X(rough)
    if inner.sum() >= 400:
        A = X(inner); ma, ca = A.mean(0), np.cov(A.T) + np.eye(2) * 1.0
    else:                                   # no OSM fairway here (White 4): the course's fairway look
        ma, ca = pooled
    # rough: robust (median / MAD) — the ring holds some fairway OSM missed
    mb = np.median(Bq, 0); sb = 1.4826 * np.median(np.abs(Bq - mb), 0) + 1.0
    cb = np.diag(sb ** 2)
    def ll2(Xv, m, c):
        ci = np.linalg.inv(c); dv = Xv - m
        return -0.5 * np.einsum('ij,jk,ik->i', dv, ci, dv) - 0.5 * np.log(np.linalg.det(c))
    Xc = X(cand)
    lr = ll2(Xc, ma, ca) - ll2(Xc, mb, cb)
    fwmask = np.zeros_like(cand); fwmask[cand] = lr > LR
    fwmask = ndimage.binary_closing(fwmask, structure=np.ones((5, 5)), iterations=2)
    fwmask = ndimage.binary_opening(fwmask, structure=np.ones((5, 5)), iterations=2)
    fwmask = ndimage.binary_fill_holes(fwmask | osm_here) & corr & ~excl
    # keep pieces that touch the hole line (within 12 m) or OSM's fairway
    lab, n = ndimage.label(fwmask)
    if n:
        touch_line = np.unique(lab[(dmin <= 12 / M_PER_PX) & (near == i) & fwmask])
        touch_osm = np.unique(lab[ndimage.binary_dilation(osm_here, iterations=2) & fwmask])
        keep = set(touch_line.tolist()) | set(touch_osm.tolist()); keep.discard(0)
        sizes = ndimage.sum(np.ones_like(lab), lab, index=range(1, n + 1))
        keep = {j for j in keep if sizes[j - 1] * M_PER_PX ** 2 >= 300}
        fwmask = np.isin(lab, list(keep))
    added = (fwmask & ~fw_osm).sum() * M_PER_PX ** 2
    out |= fwmask
    report.append((name, f'osm {osm_here.sum() * M_PER_PX ** 2:7.0f} m²  +{added:6.0f} m²  ({added / max(1, osm_here.sum() * M_PER_PX ** 2) * 100:3.0f}%)', ''))

np.save(f'{S}/fw_traced.npy', out)
# polygons
polys = []
for c in measure.find_contours(np.pad(out, 1).astype(float), 0.5):
    pts = [(p[1] - 1, p[0] - 1) for p in c]
    if len(pts) < 4: continue
    pg = Polygon(pts).buffer(0)
    if pg.is_empty: continue
    polys.append(pg)
# find_contours gives outer and inner boundaries; build exteriors only, largest-first, drop those inside others
polys.sort(key=lambda p: -p.area)
final = []
for p in polys:
    if any(q.contains(p) for q in final): continue
    final.append(p)
geo = []
for p in final:
    p = p.simplify(2.0)
    if p.area * M_PER_PX ** 2 < 200: continue
    for g in (p.geoms if isinstance(p, MultiPolygon) else [p]):
        geo.append([ll(x, y) for x, y in list(g.exterior.coords)[:-1]])
json.dump({'fairways': geo}, open(f'{S}/fairways-traced.json', 'w'))
for r in report: print(f'{r[0]:9} {r[1]} {r[2]}')
print('polygons', len(geo), 'total fairway m²', int(out.sum() * M_PER_PX ** 2), 'OSM m²', int(fw_osm.sum() * M_PER_PX ** 2))
