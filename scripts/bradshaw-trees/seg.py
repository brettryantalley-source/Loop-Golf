import os, json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, draw, morphology, measure
Image.MAX_IMAGE_PIXELS = None
d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'localGeometry', 'bradshaw.json')))
M = json.load(open('mosaic.json')); z, X0, Y0 = M['z'], M['X0'], M['Y0']
img = np.asarray(Image.open('mosaic.png').convert('RGB')).astype(np.float32) / 255
H, W = img.shape[:2]
def px(lat, lon):
    n = 2 ** z; x = (lon + 180) / 360 * n; y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (x - X0) * 256, (y - Y0) * 256
mpp = 156543.03 * math.cos(math.radians(34.154)) / 2**z
print('m/px', round(mpp, 3))
def rings(w):
    if w.get('pts'): return [w['pts']]
    return (w.get('outer') or [])
def mask_of(pred, buf_m=0.0):
    m = np.zeros((H, W), bool)
    for w in d['ways']:
        if pred(w.get('tags', {})):
            for r in rings(w):
                xy = [px(*p) for p in r]
                rr, cc = draw.polygon([p[1] for p in xy], [p[0] for p in xy], (H, W)); m[rr, cc] = True
    if buf_m > 0: m = ndi.binary_dilation(m, iterations=max(1, int(round(buf_m / mpp))))
    if buf_m < 0: m = ndi.binary_erosion(m, iterations=max(1, int(round(-buf_m / mpp))))
    return m
lab = color.rgb2lab(img)
L = ndi.gaussian_filter(lab[..., 0], 1.0); A = ndi.gaussian_filter(lab[..., 1], 1.0); B = ndi.gaussian_filter(lab[..., 2], 1.0)
g = lab[..., 0]; mu = ndi.uniform_filter(g, 7); tex = np.sqrt(np.maximum(ndi.uniform_filter(g * g, 7) - mu * mu, 0))
tex = ndi.gaussian_filter(tex, 1.5)
F = np.stack([L, A, B, tex], -1)
turf = mask_of(lambda t: t.get('golf') in ('fairway', 'green', 'tee'), -3)
wood = mask_of(lambda t: t.get('natural') == 'wood', -4)
print('turf px', turf.sum(), 'wood px', wood.sum())
def gauss(m):
    X = F[m]; mu = X.mean(0); cv = np.cov(X.T) + np.eye(4) * 0.5; return mu, np.linalg.inv(cv), np.linalg.slogdet(cv)[1]
def ll(p):
    mu, ic, ld = p; D = F - mu; return -0.5 * (np.einsum('...i,ij,...j->...', D, ic, D) + ld)
pt, pw = gauss(turf), gauss(wood)
print('turf mean', np.round(pt[0], 1), 'wood mean', np.round(pw[0], 1))
LR = ll(pw) - ll(pt)
np.save('LR.npy', LR.astype(np.float32)); np.save('tex.npy', tex.astype(np.float32)); np.save('L.npy', L.astype(np.float32)); np.save('A.npy', A.astype(np.float32))
# region: within 75 m of a Red/White hole line
lines = np.zeros((H, W), bool)
for w in d['ways']:
    t = w.get('tags', {})
    if t.get('golf') == 'hole' and t.get('name', '').split(' ')[0] in ('Red', 'White'):
        xy = [px(*p) for p in w['pts']]
        for (xa, ya), (xb, yb) in zip(xy, xy[1:]):
            rr, cc = draw.line(int(ya), int(xa), int(yb), int(xb)); ok = (rr >= 0) & (rr < H) & (cc >= 0) & (cc < W); lines[rr[ok], cc[ok]] = True
dist = ndi.distance_transform_edt(~lines) * mpp
np.save('dist.npy', dist.astype(np.float32))
excl = mask_of(lambda t: t.get('golf') in ('fairway', 'green', 'tee', 'bunker') or t.get('natural') == 'water' or t.get('golf') in ('water_hazard', 'lateral_water_hazard'), 1.5)
np.save('excl.npy', excl)
print('done')
