#!/usr/bin/env python3
"""
raster.py — step 1 of the lidar trees (scripts/lidar-trees/README.md): the USGS 3DEP point cloud over a club's
holes, gridded at 1 m, plus the bare-earth ground under it.

    python3 raster.py <club> [survey]    # writes <club>-pc.npz in the current directory

The box is every `golf=hole` line in src/localGeometry/<club>.json plus 110 m. The survey is the most recent USGS
lidar collection (Entwine point tiles on AWS, s3://usgs-lidar-public) whose footprint holds the box's centre, or
the one named. Per cell (Web Mercator, ~1 m on the ground): the highest point and the counts of high-vegetation
(class 5) and building (class 6) points, noise left out. The ground is the 3DEP ImageServer's bare-earth raster on
the same grid. numpy, laspy + lazrs, pillow, shapely.
"""
import io, json, math, os, re, sys, urllib.request, concurrent.futures as cf
import numpy as np, laspy
from PIL import Image
from shapely.geometry import shape, Point

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "..", "src", "localGeometry")
INDEX = "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson"
EXPORT = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
R, PAD_M = 6378137.0, 110


def get(url):
    for a in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Loop-Golf lidar-trees (offline tool)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception:
            if a == 4: raise


def merc(lat, lon):
    return math.radians(lon) * R, R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


club = sys.argv[1]
geo = json.load(open(os.path.join(DIR, f"{club}.json")))
pts = [p for w in geo["ways"] if w.get("tags", {}).get("golf") == "hole" for p in w["pts"]]
lat0 = sum(p[0] for p in pts) / len(pts); lon0 = sum(p[1] for p in pts) / len(pts)
k = 1 / math.cos(math.radians(lat0))
xs, ys = zip(*(merc(*p) for p in pts))
x0, y0, x1, y1 = min(xs) - PAD_M * k, min(ys) - PAD_M * k, max(xs) + PAD_M * k, max(ys) + PAD_M * k
cell = k                                            # 1 m on the ground

if len(sys.argv) > 2:
    survey = sys.argv[2]
else:
    idx = json.loads(get(INDEX))
    hits = [f["properties"]["name"] for f in idx["features"] if shape(f["geometry"]).contains(Point(lon0, lat0))]
    year = lambda n: max([int(y) for y in re.findall(r"(20\d\d)", n)] or [0])
    survey = max(hits, key=year)
    print("surveys over the club:", ", ".join(hits), "→", survey)
base = f"https://s3-us-west-2.amazonaws.com/usgs-lidar-public/{survey}"

ept = json.loads(get(base + "/ept.json"))
assert ept["srs"].get("horizontal") == "3857", ept["srs"]
B = ept["bounds"]


def node_box(d, x, y):
    s = (B[3] - B[0]) / 2 ** d
    return B[0] + x * s, B[1] + y * s, B[0] + (x + 1) * s, B[1] + (y + 1) * s


nodes, hier = [], json.loads(get(f"{base}/ept-hierarchy/0-0-0-0.json"))


def walk(key):
    d, x, y, z = map(int, key.split("-"))
    b = node_box(d, x, y)
    if b[2] < x0 or b[0] > x1 or b[3] < y0 or b[1] > y1: return
    n = hier.get(key)
    if n is None: return
    if n == -1:
        hier.update(json.loads(get(f"{base}/ept-hierarchy/{key}.json"))); n = hier[key]
    if n > 0: nodes.append(key)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                walk(f"{d + 1}-{2 * x + dx}-{2 * y + dy}-{2 * z + dz}")


walk("0-0-0-0")
W, H = int(math.ceil((x1 - x0) / cell)), int(math.ceil((y1 - y0) / cell))
zmax = np.full((H, W), -1e9); cnt = np.zeros((H, W), np.int32)
c5 = np.zeros((H, W), np.int32); c6 = np.zeros((H, W), np.int32)


def load(key):
    las = laspy.read(io.BytesIO(get(f"{base}/ept-data/{key}.laz")))
    X, Y, Z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    cl = np.asarray(las.classification)
    k = (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1) & (cl != 7) & (cl != 18)
    return X[k], Y[k], Z[k], cl[k]


n = 0
with cf.ThreadPoolExecutor(8) as ex:
    for X, Y, Z, cl in ex.map(load, nodes):
        i = ((X - x0) / cell).astype(int); j = ((y1 - Y) / cell).astype(int)
        np.maximum.at(zmax, (j, i), Z); np.add.at(cnt, (j, i), 1)
        np.add.at(c5, (j, i), (cl == 5).astype(np.int32)); np.add.at(c6, (j, i), (cl == 6).astype(np.int32))
        n += len(X)
q = (f"bbox={x0:.2f},{y0:.2f},{x1:.2f},{y1:.2f}&bboxSR=3857&imageSR=3857&size={W},{H}&format=tiff"
     "&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image")
ground = np.array(Image.open(io.BytesIO(get(f"{EXPORT}?{q}")))).astype(np.float64)
ground[ground < -1000] = np.nan
np.savez_compressed(f"{club}-pc.npz", zmax=zmax, cnt=cnt, c5=c5, c6=c6, ground=ground,
                    box=np.array([x0, y0, x1, y1, cell]), survey=np.array(survey))
print(f"{club}: {len(nodes)} tiles, {n:,} points, {W}×{H} cells, high vegetation {c5.sum() / max(cnt.sum(), 1):.0%} of points")
