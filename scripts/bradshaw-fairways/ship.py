#!/usr/bin/env python3
"""
ship.py — C40's last step (v22.63, D135): the clear additions from trace.py, merged into the OSM fairway each one
grows, written as `fairways-ship.json` for apply.mjs.

    WORK=<dir of the winter run> python3 ship.py

A piece ships when the hole's photo separates fairway from rough well (d′ ≥ 2.8 on excess-green + texture), the
piece itself reads strongly as fairway (mean log-likelihood ratio ≥ 6, about 400 : 1), it is at least 150 m², and
it touches the hole's OSM fairway. Run on the winter capture (Wayback 63116, RELEASE=63116 for fetch.py), where the
dormant rough is tan and the fairway green; on the green Sep 2023 photo the two barely separate. Each kept piece is
grown 0.6 m (the trace keeps 2 px off OSM's edge), unioned with the OSM fairway way it touches, simplified 0.3 m;
the way keeps its id and its inner rings (bunkers cut out); a sliver the union leaves inside is filled.
"""
import json, math, os
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import make_valid

HERE = os.path.dirname(os.path.abspath(__file__))
S = os.environ.get('WORK', '/tmp/bradshaw-fairways')
MIN_DPRIME, MIN_LR, MIN_AREA = 2.8, 6.0, 150
d = json.load(open(os.path.join(HERE, '..', '..', 'src', 'localGeometry', 'bradshaw.json')))
pieces = json.load(open(f'{S}/additions.json'))['pieces']
lat0 = 34.159; kx = 111320 * math.cos(math.radians(lat0)); ky = 111320
to_m = lambda r: [(lo * kx, la * ky) for la, lo in r]
to_ll = lambda cs: [[round(y / ky, 7), round(x / kx, 7)] for x, y in cs]

fair = [(i, w) for i, w in enumerate(d['ways']) if (w.get('tags') or {}).get('golf') == 'fairway']
def geom(w):
    if w.get('outer'):
        g = unary_union([make_valid(Polygon(to_m(o))) for o in w['outer']])
        for r in w.get('inner') or []: g = g.difference(make_valid(Polygon(to_m(r))))
        return g
    return make_valid(Polygon(to_m(w['pts'])))
fg = {i: geom(w) for i, w in fair}

keep = [p for p in pieces if p['dprime'] >= MIN_DPRIME and p['lr'] >= MIN_LR and p['area'] >= MIN_AREA and p['touchesOsm'] and len(p['ring']) >= 4]
grow = {}
for p in keep:
    pg = make_valid(Polygon(to_m(p['ring']))).buffer(0.6)
    i = min(fg, key=lambda j: fg[j].distance(pg))
    if fg[i].distance(pg) > 1.5: continue
    grow.setdefault(i, []).append(p)
out = []
for i, ps in grow.items():
    w = d['ways'][i]
    g = unary_union([fg[i]] + [make_valid(Polygon(to_m(p['ring']))).buffer(0.6) for p in ps])
    inner = [make_valid(Polygon(to_m(r))) for r in (w.get('inner') or [])]
    for r in inner: g = g.difference(r)                     # bunkers OSM cut out stay cut out
    g = g.simplify(0.3)
    polys = list(getattr(g, 'geoms', [g]))
    # a clearing the union left between a piece and OSM's edge is fairway too: keep only the bunkers' holes
    real = lambda r: any(Polygon(r).intersection(b).area > 0.5 * Polygon(r).area for b in inner)
    polys = [Polygon(q.exterior, [r for r in q.interiors if real(r)]) for q in polys if q.geom_type == 'Polygon' and q.area > 20]
    if len(polys) == 1 and not polys[0].interiors:
        nw = {'tags': w['tags'], 'q': 'osm+photo', 'pts': to_ll(polys[0].exterior.coords), 'id': w['id']}
    else:
        nw = {'tags': w['tags'], 'q': 'osm+photo', 'outer': [to_ll(q.exterior.coords) for q in polys],
              'inner': [to_ll(r.coords) for q in polys for r in q.interiors], 'id': w['id']}
    added = g.area - fg[i].area
    out.append({'index': i, 'id': w['id'], 'holes': sorted({p['hole'] for p in ps}), 'addedM2': round(added), 'way': nw})
json.dump({'criteria': {'dprime': MIN_DPRIME, 'lr': MIN_LR, 'areaM2': MIN_AREA}, 'replace': out}, open(f'{S}/fairways-ship.json', 'w'))
for o in sorted(out, key=lambda o: o['holes']): print(f"{', '.join(o['holes']):10} way {o['id']}: +{o['addedM2']} m²")
print('total +', sum(o['addedM2'] for o in out), 'm² over', len(out), 'fairways')
