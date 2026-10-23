# Per-hole sheet: photo, OSM fairway (yellow), traced additions (cyan fill), hole line.
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
CLUB = os.environ.get('CLUB', 'bradshaw')  # the club file under src/localGeometry/
S = os.environ.get('WORK', '/tmp/' + CLUB + '-fairways'); os.makedirs(S, exist_ok=True)
meta = json.load(open(f'{S}/{CLUB}-z18.json'))
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', CLUB + '.json')))
tr = np.load(f'{S}/fw_traced.npy')
osm = np.load(f'{S}/fw_mask.npy')
def px(lat, lon):
    n = 2 ** 18; x = (lon + 180) / 360 * n; y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return ((x - meta['X0']) * 256, (y - meta['Y0']) * 256)
base = Image.open(f'{S}/{CLUB}-z18.jpg').convert('RGBA')
add = (tr & ~osm)
over = np.zeros((*add.shape, 4), np.uint8); over[add] = (0, 230, 255, 110)
img = Image.alpha_composite(base, Image.fromarray(over, 'RGBA')).convert('RGB')
dr = ImageDraw.Draw(img)
for w in d['ways']:
    t = w.get('tags') or {}; g = t.get('golf')
    rings = [w['pts']] if w.get('pts') else (w.get('outer') or [])
    for r in rings:
        P = [px(*p) for p in r]
        if g == 'fairway': dr.line(P + [P[0]], fill=(255, 255, 0), width=2)
        elif g == 'hole': dr.line(P, fill=(255, 255, 255), width=1)
os.makedirs(f'{S}/sheets', exist_ok=True)
names = sys.argv[1:]
for w in d['ways']:
    t = w.get('tags') or {}
    if t.get('golf') != 'hole' or (names and (t.get('name') or t.get('ref')) not in names): continue
    P = [px(*p) for p in w['pts']]; xs = [p[0] for p in P]; ys = [p[1] for p in P]
    box = (int(min(xs) - 110), int(min(ys) - 110), int(max(xs) + 110), int(max(ys) + 110))
    c = img.crop(box); sc = 1000 / max(c.size); c = c.resize((int(c.width * sc), int(c.height * sc)))
    c.save(f'{S}/sheets/{(t.get('name') or t['ref']).replace(' ', '_')}.jpg', quality=85)
