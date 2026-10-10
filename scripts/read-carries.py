#!/usr/bin/env python3
"""
read-carries.py — reads per-shot carries off Shot Pattern's "Shot Distances" bar (C17, D92).

Offline measurement tool, not part of the build (numpy, scipy, pillow). For each club in
data/extracted/<batch>-ell80.json it reads the bar under the same still: the green box's printed
end labels (each entry's `barLabels`, typed from the stills) calibrate pixels -> yards, and the black tick is
the median (checked against the printed median to ~1 yd). Dots that sit on the grey track outside
the box are read directly; dots inside the box merge with it and with each other, so they are not
counted: the box is the 25th-75th percentile, so its dots are known by rank instead.

A shot is a MISHIT when it carries more than the club's window from its median (20 yds; wedges 10%). Only the
outside dots can be mishits for every club but 2Hy and LW (whose boxes are wider than the window).
Reports per club: n, mishitRate, and the median of the good shots (the club's new distance).

Usage:  python3 scripts/read-carries.py data/extracted/2026-10-04-ell80.json
"""
import os, sys, json, numpy as np
from PIL import Image
from scipy import ndimage, signal

GOOD_WINDOW = 20.0          # yds, hybrids and irons
WEDGE_WINDOW_PCT = 0.10     # wedges: 10% of the median, so a deliberate partial swing is not a mishit
WEDGES = ('PW', 'GW', 'SW', 'LW')
BAR_ROWS = (1236, 1246)

def read_bar(path, lo, hi):
    im = np.array(Image.open(path).convert('RGB')).astype(float)
    rows = im[BAR_ROWS[0]:BAR_ROWS[1]]
    lum = rows.mean(axis=(0, 2))
    green = ((abs(rows[..., 0] - 60) < 30) & (abs(rows[..., 1] - 180) < 30)).mean(axis=0) > 0.8
    xs = np.where(green)[0]
    xl, xr = xs.min(), xs.max()
    f = lambda x: lo + (x - xl) / (xr - xl) * (hi - lo)
    dark = lum < 25
    tick = np.where(dark)[0]
    tick = tick[(tick > xl + 3) & (tick < xr - 3)]
    diff = lum - ndimage.median_filter(lum, size=31)
    diff[dark] = 0
    pk, _ = signal.find_peaks(ndimage.gaussian_filter1d(diff, 1.2), height=6, distance=3)
    outer = [f(p) for p in pk if 50 < p < 540 and (p < xl - 4 or p > xr + 4)]
    return dict(p25=lo, p75=hi, median=f(tick.mean()), outer=sorted(outer))

def window_for(club, median):
    return max(8.0, WEDGE_WINDOW_PCT * median) if club in WEDGES else GOOD_WINDOW

def club_stats(n, bar, club):
    lo, hi, med, outer = bar['p25'], bar['p75'], bar['median'], bar['outer']
    low = [x for x in outer if x < lo]; high = [x for x in outer if x > hi]
    nb = max(0, n - len(low) - len(high))
    # rank -> yards: outside dots, then the box's quantiles interpolated across its ranks
    ranks = [i for i in range(len(low))] + [len(low) + i for i in range(nb)] + [len(low) + nb + i for i in range(len(high))]
    anchors_r = [0.25 * (n - 1), 0.5 * (n - 1), 0.75 * (n - 1)]
    anchors_y = [lo, med, hi]
    inbox = np.interp(range(len(low), len(low) + nb), anchors_r, anchors_y) if nb else []
    shots = np.array(low + list(inbox) + high)
    win = window_for(club, med)
    good = shots[abs(shots - med) <= win]
    return dict(n=n, windowYds=round(win, 1), mishits=int(len(shots) - len(good)), mishitRate=round((len(shots) - len(good)) / n, 3),
                median=round(med, 1), goodMedian=round(float(np.median(good)), 1), goodN=int(len(good)),
                low=[round(x) for x in low], high=[round(x) for x in high])

def entry_stats(e, root='.'):
    lo, hi = e['barLabels']
    return club_stats(e['n'], read_bar(os.path.join(root, e['frame']), lo, hi), e['club'])

if __name__ == '__main__':
    doc = json.load(open(sys.argv[1]))
    for e in doc['entries']:
        print(e['club'], json.dumps(entry_stats(e)))
