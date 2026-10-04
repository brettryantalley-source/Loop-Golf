"""Shared helpers: Web-Mercator world pixels <-> lat/lon, and the z18 mosaic frame."""
import json, math, os, sys
S = "/tmp/woodmont-trace"
sys.path.insert(0, S + "/pylib")

def world(lat, lon, z):
    n = 256 * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y

def unworld(x, y, z):
    n = 256 * 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon

def meta(z=18):
    return json.load(open(f"{S}/t{z}/meta.json"))

def to_px(lat, lon, z=18):
    """lat/lon -> pixel in the z mosaic."""
    m = meta(z)
    x, y = world(lat, lon, z)
    return x - m["x0"] * 256, y - m["y0"] * 256

def to_ll(px, py, z=18):
    m = meta(z)
    return unworld(px + m["x0"] * 256, py + m["y0"] * 256, z)

def mpp(lat, z):
    return 156543.03392 * math.cos(math.radians(lat)) / 2 ** z

R_EARTH = 6371008.8
def haversine_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1, math.sqrt(h)))
