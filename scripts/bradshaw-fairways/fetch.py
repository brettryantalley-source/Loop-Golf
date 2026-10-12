# Fetch Esri Wayback tiles covering Bradshaw Farm at one zoom; stitch into one image + its georef.
import json, math, os, subprocess, sys
from PIL import Image
S = os.environ.get('WORK', '/tmp/bradshaw-fairways'); os.makedirs(S, exist_ok=True)
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', 'bradshaw.json')))
url = d['imagery']['url']
if os.environ.get('RELEASE'):                       # another Wayback capture, e.g. RELEASE=63116 (the winter one)
    import re; url = re.sub(r'/tile/\d+/', f"/tile/{os.environ['RELEASE']}/", url)
z = int(sys.argv[1]) if len(sys.argv) > 1 else 18
lats = [p[0] for w in d['ways'] if w.get('pts') for p in w['pts']]
lons = [p[1] for w in d['ways'] if w.get('pts') for p in w['pts']]
for w in d['ways']:
    for ring in (w.get('outer') or []) + (w.get('inner') or []):
        lats += [p[0] for p in ring]; lons += [p[1] for p in ring]
def tf(lat, lon):
    n = 2 ** z; return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = tf(max(lats), min(lons)); x1, y1 = tf(min(lats), max(lons))
X0, Y0, X1, Y1 = int(x0) - 1, int(y0) - 1, int(x1) + 1, int(y1) + 1
os.makedirs(f'{S}/t{z}', exist_ok=True)
W, H = (X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256
img = Image.new('RGB', (W, H))
miss = 0
for tx in range(X0, X1 + 1):
    for ty in range(Y0, Y1 + 1):
        fn = f'{S}/t{z}/{tx}_{ty}.jpg'
        if not os.path.exists(fn) or os.path.getsize(fn) < 1000:
            u = url.replace('{z}', str(z)).replace('{x}', str(tx)).replace('{y}', str(ty))
            subprocess.run(['curl', '-sL', '-o', fn, u], timeout=60)
        try: img.paste(Image.open(fn).convert('RGB'), ((tx - X0) * 256, (ty - Y0) * 256))
        except Exception: miss += 1
img.save(f'{S}/bradshaw-z{z}.jpg', quality=92)
json.dump({'z': z, 'X0': X0, 'Y0': Y0, 'W': W, 'H': H}, open(f'{S}/bradshaw-z{z}.json', 'w'))
print('tiles', (X1 - X0 + 1) * (Y1 - Y0 + 1), 'missing', miss, 'size', W, H)
