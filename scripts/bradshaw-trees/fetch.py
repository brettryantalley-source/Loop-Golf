import math, os, subprocess, json
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
z = 18; rel = '41468'
la0, la1, lo0, lo1 = 34.1440, 34.1645, -84.4565, -84.4360
def tf(lat, lon):
    n = 2 ** z; return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
x0, y0 = tf(la1, lo0); x1, y1 = tf(la0, lo1)
X0, Y0, X1, Y1 = int(x0), int(y0), int(x1), int(y1)
os.makedirs('t', exist_ok=True)
def get(j):
    tx, ty = j; fn = f't/{tx}_{ty}.jpg'
    for _ in range(3):
        if os.path.exists(fn) and os.path.getsize(fn) > 1000: return
        subprocess.run(['curl','-sL','-o',fn,f'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{rel}/{z}/{ty}/{tx}'],timeout=60)
js = [(tx, ty) for tx in range(X0, X1+1) for ty in range(Y0, Y1+1)]
with ThreadPoolExecutor(24) as ex: list(ex.map(get, js))
img = Image.new('RGB', ((X1-X0+1)*256, (Y1-Y0+1)*256))
for tx, ty in js: img.paste(Image.open(f't/{tx}_{ty}.jpg').convert('RGB'), ((tx-X0)*256, (ty-Y0)*256))
img.save('mosaic.png'); json.dump({'z': z, 'X0': X0, 'Y0': Y0}, open('mosaic.json','w'))
print(len(js), img.size)
