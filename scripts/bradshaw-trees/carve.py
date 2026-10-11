import os, json, math
from shapely.geometry import Polygon, Point
from shapely.validation import make_valid
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', 'bradshaw.json'))); woods = json.load(open('woods.json'))
lat0 = 34.154; k = 111320 * math.cos(math.radians(lat0)); K = 110540
def P(p): return (p[1] * k, p[0] * K)
def Q(x, y): return [round(y / K, 6), round(x / k, 6)]
tees = [Point(P(w['pts'][0])).buffer(20, 24) for w in d['ways'] if w.get('tags', {}).get('golf') == 'hole' and w['tags'].get('name', '').split(' ')[0] in ('Red', 'White')]
out = []
for w in woods:
    G = Polygon([P(p) for p in w['pts']]) if 'pts' in w else Polygon([P(p) for p in w['outer'][0]], [[P(p) for p in r] for r in w['inner']])
    G = make_valid(G)
    for t in tees: G = G.difference(t)
    parts = list(G.geoms) if hasattr(G, 'geoms') else [G]
    for g in parts:
        if g.geom_type != 'Polygon' or g.area < 250: continue
        g = g.simplify(0.5)
        o = [Q(*c) for c in list(g.exterior.coords)[:-1]]
        inn = [[Q(*c) for c in list(i.coords)[:-1]] for i in g.interiors if Polygon(i).area >= 100]
        nw = {'tags': {'natural': 'wood'}, 'q': 'auto'}
        if inn: nw['outer'] = [o]; nw['inner'] = inn
        else: nw['pts'] = o
        out.append(nw)
json.dump(out, open('woods-final.json', 'w'), separators=(',', ':'))
print('ways', len(out), 'bytes', len(json.dumps(out, separators=(',', ':'))))
