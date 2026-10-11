import os, json, math
import numpy as np
from skimage import measure
from shapely.geometry import Polygon, MultiPolygon
from shapely.validation import make_valid
m = np.load('trees.npy'); M = json.load(open('mosaic.json')); z, X0, Y0 = M['z'], M['X0'], M['Y0']
mpp = 0.494; tol = 2.0 / mpp
def ll(x, y):
    n = 2 ** z; X = X0 + x / 256; Y = Y0 + y / 256
    lon = X / n * 360 - 180; lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n)))); return [round(lat, 6), round(lon, 6)]
lab = measure.label(m); out = []; npts = 0
for r in measure.regionprops(lab):
    y0, x0, y1, x1 = r.bbox
    sub = np.pad(lab[y0:y1, x0:x1] == r.label, 1)
    cs = measure.find_contours(sub.astype(float), 0.5)
    polys = [Polygon([(p[1] + x0 - 1, p[0] + y0 - 1) for p in c]) for c in cs if len(c) >= 4]
    polys.sort(key=lambda p: -p.area)
    outer = polys[0]; holes = [p for p in polys[1:] if outer.contains(p.representative_point())]
    P = Polygon(outer.exterior.coords, [h.exterior.coords for h in holes])
    P = make_valid(P).simplify(tol, preserve_topology=True)
    geoms = list(P.geoms) if hasattr(P, 'geoms') else [P]
    for G in geoms:
        if G.geom_type != 'Polygon' or G.area * mpp * mpp < 250: continue
        o = [ll(x, y) for x, y in list(G.exterior.coords)[:-1]]
        inn = [[ll(x, y) for x, y in list(i.coords)[:-1]] for i in G.interiors if Polygon(i).area * mpp * mpp >= 100]
        w = {'tags': {'natural': 'wood'}, 'q': 'auto'}
        if inn: w['outer'] = [o]; w['inner'] = inn
        else: w['pts'] = o
        npts += len(o) + sum(len(i) for i in inn); out.append(w)
json.dump(out, open('woods.json', 'w'), separators=(',', ':'))
print('ways', len(out), 'with holes', sum(1 for w in out if 'outer' in w), 'points', npts, 'bytes', len(json.dumps(out, separators=(',', ':'))))
