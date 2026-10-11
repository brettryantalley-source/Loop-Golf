import json, math, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import morphology, measure
Image.MAX_IMAGE_PIXELS = None
thr = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
LR = np.load('LR.npy'); L = np.load('L.npy'); A = np.load('A.npy'); tex = np.load('tex.npy'); dist = np.load('dist.npy'); excl = np.load('excl.npy')
mpp = 0.494
m = (LR > thr) & (A < -4) & (L < 42) & (tex > 2.0)
m &= dist < 75
m &= ~excl
m = morphology.binary_opening(m, morphology.disk(2))
m = morphology.binary_closing(m, morphology.disk(3))
m = morphology.remove_small_holes(m, int(100 / mpp**2))
m = morphology.remove_small_objects(m, int(250 / mpp**2))
m &= ~excl; m &= dist < 75
m = morphology.binary_opening(m, morphology.disk(2))
m = morphology.remove_small_objects(m, int(250 / mpp**2))
np.save('trees.npy', m)
print('tree area m2', int(m.sum() * mpp * mpp), 'pieces', measure.label(m).max())
img = Image.open('mosaic.png').convert('RGB')
ov = np.asarray(img).copy()
ov[m] = (0.45 * ov[m] + 0.55 * np.array([255, 60, 200])).astype(np.uint8)
edge = m ^ ndi.binary_erosion(m, iterations=2); ov[edge] = [255, 0, 255]
ex = excl ^ ndi.binary_erosion(excl, iterations=1); ov[ex] = [255, 255, 0]
Image.fromarray(ov).save(f'ov-{thr}.png')
Image.fromarray(ov).resize((ov.shape[1] // 4, ov.shape[0] // 4), Image.LANCZOS).save(f'ov-{thr}-small.jpg', quality=85)
