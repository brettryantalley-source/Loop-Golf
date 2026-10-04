"""detect_pads.py — candidate tee pads (small, crisp, slightly greener than the fairway) + bunkers (bright sand)."""
import sys, json
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
import numpy as np, cv2

Z = 18
im = cv2.cvtColor(cv2.imread(f"{S}/mosaic{Z}.png"), cv2.COLOR_BGR2RGB)
Hh, Ww = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_RGB2HSV)
h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)

# region of interest: outline grown 120 m (same as detect.py)
A = json.load(open(f"{S}/woodmont-A.json"))
ring = next(e for e in A["elements"] if e.get("tags", {}).get("leisure") == "golf_course")["geometry"]
poly = np.array([to_px(p["lat"], p["lon"], Z) for p in ring], dtype=np.int32)
roi = np.zeros((Hh, Ww), np.uint8); cv2.fillPoly(roi, [poly], 255)
g = int(120 / mpp(34.2315, Z)); roi = cv2.dilate(roi, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1)))

m2 = mpp(34.2315, Z) ** 2
k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)); k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

# tee pads: mid-green hue band that is NOT the tan fairway and NOT the saturated green of greens
pad = ((h >= 28) & (h <= 50) & (s >= 60) & (s <= 125) & (v >= 120) & (v <= 190)).astype(np.uint8) * 255
pad = cv2.bitwise_and(pad, roi)
pad = cv2.morphologyEx(pad, cv2.MORPH_OPEN, k5)
pad = cv2.morphologyEx(pad, cv2.MORPH_CLOSE, k5)
n, lab, st, ce = cv2.connectedComponentsWithStats(pad, 8)
pads = []
for i in range(1, n):
    x, y, bw, bh, a = st[i]
    am = a * m2
    if am < 35 or am > 420: continue
    comp = (lab == i).astype(np.uint8)
    cn, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cn, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    sol = cv2.contourArea(c) / max(1.0, cv2.contourArea(hull))
    if sol < 0.82: continue
    pads.append(dict(cx=float(ce[i][0]), cy=float(ce[i][1]), area_m2=round(am), bw=int(bw), bh=int(bh), sol=round(sol, 2), poly=cv2.approxPolyDP(c, 1.5, True)[:, 0, :].tolist()))
pads.sort(key=lambda p: (p["cy"], p["cx"]))
for k, p in enumerate(pads): p["id"] = k + 1

# bunkers: bright, low-saturation sand
sand = ((v >= 205) & (s <= 70) & (h >= 12) & (h <= 32)).astype(np.uint8) * 255
sand = cv2.bitwise_and(sand, roi)
sand = cv2.morphologyEx(sand, cv2.MORPH_OPEN, k3); sand = cv2.morphologyEx(sand, cv2.MORPH_CLOSE, k5)
n2, lab2, st2, ce2 = cv2.connectedComponentsWithStats(sand, 8)
bunkers = []
for i in range(1, n2):
    am = st2[i][4] * m2
    if am < 20 or am > 900: continue
    comp = (lab2 == i).astype(np.uint8)
    cn, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cn, key=cv2.contourArea)
    bunkers.append(dict(cx=float(ce2[i][0]), cy=float(ce2[i][1]), area_m2=round(am), poly=cv2.approxPolyDP(c, 1.5, True)[:, 0, :].tolist()))
json.dump(pads, open(f"{S}/pads.json", "w")); json.dump(bunkers, open(f"{S}/bunkers.json", "w"))
print("pads:", len(pads), "bunkers:", len(bunkers))
ov = dict(rings=[dict(pts=p["poly"], color="#00e5ff", width=2) for p in pads] + [dict(pts=b["poly"], color="#ff9ad5", width=1) for b in bunkers],
          points=[dict(px=p["cx"], py=p["cy"], label="t%d" % p["id"], color="#00e5ff", r=2) for p in pads])
json.dump(ov, open(f"{S}/ov-pads.json", "w"))
