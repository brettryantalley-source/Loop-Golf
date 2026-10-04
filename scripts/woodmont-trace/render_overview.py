"""render_overview.py — the numbered Woodmont overview: tees + greens matched to the card, with a confidence-coded table."""
import sys, json, math
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import *
from PIL import Image, ImageDraw, ImageFont

exec(open(f"{S}/solve.py").read().split("FACT =")[0])      # G, T, par, champ, medal, yd(), m()
G["G20"] = (1739, 962)
# --- corrections from Brett (v2) ---
G["G16"] = (2303, 1817)                                   # the striped green left of the 17th tee
T["T15"] = [(3430, 2578), (3460, 2578), (3488, 2575)]    # cleared ground just west of 14's green
T["T16"] = [(2992, 2476), (3028, 2510), (3060, 2530)]    # the pads left of 15's green
T["T18"] = [(2392, 838)]                                  # strip beside 10's green, up-left of the old marker

# hole -> (tee complex, green, confidence)   conf: 3 = card + routing agree, 2 = plausible, 1 = guess
PLAN = {
 1: ("T1", "G42", 2), 2: ("TA", "G54", 3), 3: ("TC", "G45", 2), 4: ("TB", "G66", 3), 5: ("TSW", "G44", 3),
 6: ("TW", "G36", 3), 7: ("TF1", "G26", 3), 8: ("TF2~", "G35", 1), 9: ("T9", "G22", 3),
 10: ("TNW", "G13", 3), 11: ("TN", "G24", 3), 12: ("TE", "G40", 3), 13: ("TSEa", "G52", 2), 14: ("TSEb", "G64", 2),
 15: ("T15", "G63", 2), 16: ("T16", "G16", 3), 17: ("TLS", "G23", 2), 18: ("T18", "GNW", 2),
}
VIA = {16: [(2745, 2335), (2485, 2205), (2352, 1965)]}      # hole 16 bends: corridor -> creek bend -> pale oval -> green
COL = {3: (255, 214, 0), 2: (255, 150, 30), 1: (255, 70, 70), 0: (200, 200, 200)}

X0, Y0, X1, Y1 = 440, 230, 3700, 2900
SC = 0.6
im = Image.open(f"{S}/mosaic18.png").convert("RGB").crop((X0, Y0, X1, Y1))
W, H = int((X1 - X0) * SC), int((Y1 - Y0) * SC)
im = im.resize((W, H), Image.LANCZOS)
P = lambda p: ((p[0] - X0) * SC, (p[1] - Y0) * SC)

PANEL = 640
canvas = Image.new("RGB", (W + PANEL, H), (24, 24, 22))
canvas.paste(im, (0, 0))
d = ImageDraw.Draw(canvas, "RGBA")
f = lambda s: ImageFont.load_default(size=s)

# OSM outline (what OSM has today)
A = json.load(open(f"{S}/woodmont-A.json"))
ring = next(e for e in A["elements"] if e.get("tags", {}).get("leisure") == "golf_course")["geometry"]
pts = [P(to_px(p["lat"], p["lon"], 18)) for p in ring]
d.line(pts, fill=(255, 60, 60, 190), width=2)

def centroid(pads): return (sum(p[0] for p in pads) / len(pads), sum(p[1] for p in pads) / len(pads))

# practice green
gx, gy = P(G["G20"]); d.ellipse([gx - 13, gy - 13, gx + 13, gy + 13], outline=(120, 220, 255, 255), width=3)
d.text((gx + 16, gy - 10), "practice green?", fill=(150, 230, 255, 255), font=f(15), stroke_width=2, stroke_fill=(0, 0, 0, 255))

rows = []
for h in range(1, 19):
    t, g, conf = PLAN[h]
    if t is None:
        rows.append((h, None, None, conf)); continue
    pads = T[t]; gp = G[g]
    back = max(pads, key=lambda p: yd(p, gp))
    col = COL[conf] + (255,)
    via = VIA.get(h, [])
    route = [centroid(pads)] + via + [gp]
    rp = [P(q) for q in route]
    for i in range(len(rp) - 1):
        a, b = rp[i], rp[i + 1]
        n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 14))
        for k in range(n):
            if conf == 1 and k % 2: continue
            s0 = k / n; s1 = (k + 0.7) / n
            d.line([(a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0), (a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1)], fill=COL[conf] + (210,), width=3)
    a, b = rp[0], rp[-1]
    # tee marker (square) + number
    d.rectangle([a[0] - 9, a[1] - 9, a[0] + 9, a[1] + 9], outline=col, width=3, fill=(0, 0, 0, 120))
    d.text((a[0] + (-26 if h in (15, 18) else 12), a[1] - 24), str(h), fill=col, font=f(22), stroke_width=3, stroke_fill=(0, 0, 0, 255))
    # green marker (circle) + number
    d.ellipse([b[0] - 17, b[1] - 17, b[0] + 17, b[1] + 17], outline=col, width=4, fill=(0, 0, 0, 150))
    tw = d.textlength(str(h), font=f(24))
    d.text((b[0] - tw / 2, b[1] - 13), str(h), fill=col, font=f(24), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    rows.append((h, yd(back, gp), len(pads), conf))

# attribution + title
d.rectangle([0, H - 26, W, H], fill=(0, 0, 0, 150))
d.text((8, H - 22), "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community. Red line = the course outline OSM has today.", fill=(235, 235, 235, 255), font=f(14))

# right panel: legend + table
x = W + 18; y = 14
pd = ImageDraw.Draw(canvas)
pd.text((x, y), "Woodmont: hole numbers, v2", fill=(255, 255, 255), font=f(24)); y += 34
pd.text((x, y), "square = tee   circle = green   numbers = hole", fill=(200, 200, 200), font=f(15)); y += 22
for conf, lab in ((3, "gold: card + routing agree"), (2, "orange: plausible"), (1, "red dashed: guess / short fairway")):
    pd.rectangle([x, y + 3, x + 14, y + 17], fill=COL[conf]); pd.text((x + 22, y), lab, fill=(220, 220, 220), font=f(15)); y += 21
y += 8
cols = [x, x + 70, x + 130, x + 300, x + 400]
for cx, lab in zip(cols, ("Hole", "Par", "Card (back/Medal)", "Mine*", "Fit")):
    pd.text((cx, y), lab, fill=(160, 200, 255), font=f(16))
y += 26
for h, mine, npads, conf in rows:
    c = COL[conf]
    pd.text((cols[0] + 10, y), str(h), fill=c, font=f(18))
    pd.text((cols[1] + 8, y), str(par[h - 1]), fill=c, font=f(18))
    pd.text((cols[2], y), f"{champ[h-1]} / {medal[h-1]}", fill=c, font=f(18))
    if mine is None:
        pd.text((cols[3], y), "none found", fill=c, font=f(18))
    else:
        pd.text((cols[3] + 6, y), f"{mine:.0f}", fill=c, font=f(18))
        pd.text((cols[4], y), f"{mine - champ[h-1]:+.0f}", fill=c, font=f(18))
    y += 27
y += 6
for ln in ("*straight line from my farthest tee pad to green centre;",
           " real play runs ~1-3% longer. Fit = mine minus card Champ.",
           "v2: 15, 16, 18 moved per Brett (16 is drawn along its bend).",
           " Hole 8 is still the",
           " weakest: its tee is a guess (tan bermuda looks like",
           " rough in winter) and the fairway measures short."):
    pd.text((x, y), ln, fill=(185, 185, 185), font=f(13)); y += 17

canvas.save(f"{S}/woodmont-overview.png")
print("saved", canvas.size)
for h, mine, npads, conf in rows: print(h, None if mine is None else round(mine), npads, conf)
