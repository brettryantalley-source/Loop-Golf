"""solve.py — assign (tee complex, green) pairs to holes 1..18 using the card (par, Champ, Medal) + green->next-tee adjacency."""
import sys, math, itertools, json
sys.path.insert(0, "/tmp/woodmont-trace")
from geo import mpp

M = mpp(34.2315, 18)           # metres per z18 px
YD = 1.0936133
def yd(a, b): return math.hypot(a[0]-b[0], a[1]-b[1]) * M * YD
def m(a, b):  return math.hypot(a[0]-b[0], a[1]-b[1]) * M

par   = [5,3,4,4,4,3,4,4,5, 5,3,4,3,4,3,5,4,5]
champ = [520,193,405,455,416,138,393,473,537, 524,116,385,182,400,199,570,365,503]
medal = [506,166,392,432,397,120,363,442,518, 506,106,373,142,391,179,543,360,485]

G = {  # greens (z18 px)
 "G22":(1469,1010), "G13":(2349,818), "G23":(2442,1052), "G24":(2657,1052), "G40":(2478,1884),
 "G42":(1660,1992), "G44":(1392,2065), "G45":(2150,2072), "G54":(1555,2297), "G66":(1570,2570),
 "G35":(1140,1567), "G36":(1045,1712), "G26":(505,1086), "G52":(2762,2237), "G63":(3124,2553),
 "G64":(3514,2573), "GNW":(1480,527),
}
T = {  # tee complexes: pads (z18 px); ~ = estimated / tan pads
 "T1":  [(1777,1053),(1768,1133),(1763,1213)],
 "TA":  [(1772,2017),(1737,2050),(1710,2092),(1677,2147)],
 "TB":  [(2295,2160),(2255,2172),(2212,2195),(2177,2220),(2137,2262)],
 "TC":  [(1675,2327),(1620,2375),(1557,2425)],
 "TSW": [(1395,2686),(1399,2735),(1419,2784),(1459,2796),(1442,2830)],
 "TW":  [(1117,1955),(1120,1870),(1117,1932)],
 "TF1": [(859,1535),(905,1596),(949,1657)],
 "TF2~":[(740,1020),(790,1040),(859,1050)],
 "T9":  [(1334,1769),(1342,1924),(1325,1962),(1322,1998)],
 "TNW": [(1485,378),(1665,422)],
 "TN":  [(2650,855),(2575,880),(2660,912),(2515,895),(2495,985)],
 "TE":  [(2557,1195),(2552,1270),(2532,1340),(2538,1400)],
 "TLS": [(2395,1670),(2365,1685)],
 "TLX~":[(2305,1820),(2350,1900)],
 "TSEa":[(2570,2030),(2600,2050),(2640,2090)],
 "TSEb":[(2897,2171)],
 "TSEc":[(3530,2508)],
 "TEAST~":[(2384,870),(2450,900)],
}
FACT = 1.015  # played length vs straight line

def pair_cost(k, t, g):
    pads = T[t]; ds = sorted(yd(p, G[g]) * FACT for p in pads)   # ascending: front..back
    if par[k] == 3 and ds[-1] > 235: return 1e9
    if par[k] == 4 and (ds[-1] < 330 or ds[0] > 470): return 1e9
    if par[k] == 5 and (ds[-1] < 470): return 1e9
    # Champ: best pad; Medal: best other pad (if only one pad, Medal is allowed to equal it)
    ec = [abs(d - champ[k]) for d in ds]
    ic = min(range(len(ds)), key=lambda i: ec[i])
    others = [abs(d - medal[k]) for i, d in enumerate(ds) if i != ic] or [abs(ds[ic] - medal[k])]
    c = ec[ic] + 0.6 * min(others)
    # champ should be the longest tee: penalise if a pad is much longer than Champ (unused longer pads are fine up to +25)
    over = max(0, ds[-1] - champ[k] - 25)
    pen = 0.5 * over + (6 if "~" in t else 0)
    return c + pen

def adj_cost(g, t):
    d = min(m(p, G[g]) for p in T[t])
    return max(0, d - 160) / 12.0 + (0 if d < 160 else 2)

cands = []
for k in range(18):
    cs = []
    for t in T:
        for g in G:
            c = pair_cost(k, t, g)
            if c < 40: cs.append((c, t, g))
    cs.sort()
    cands.append(cs)
    print(f"H{k+1:2d} par {par[k]} champ {champ[k]} medal {medal[k]}: ", ", ".join(f"{t}->{g} {c:.0f}" for c, t, g in cs[:7]))

best = [1e9, None]
import functools
SUF = None
def dfs(k, used_t, used_g, total, seq):
    if total + SUF[k] >= best[0]: return
    if k == 18:
        total += adj_cost(seq[17][2], seq[0][1])        # 18 -> 1
        if total < best[0]: best[0], best[1] = total, list(seq)
        return
    for c, t, g in cands[k]:
        if t in used_t or g in used_g: continue
        a = adj_cost(seq[-1][2], t) if seq else 0
        dfs(k + 1, used_t | {t}, used_g | {g}, total + c + a, seq + [(k + 1, t, g, c)])

# allow at most one hole to have no candidate-free fallback: 17 greens vs 18 holes -> let one hole take the dummy "G20"
G["G20"] = (1739, 962)
cands = []
for k in range(18):
    cs = []
    for t in T:
        for g in G:
            c = pair_cost(k, t, g)
            if c < 26: cs.append((c, t, g))
    cs.sort(); cands.append(cs)
SUF = [0.0]*19
for k in range(17, -1, -1): SUF[k] = SUF[k+1] + (cands[k][0][0] if cands[k] else 99)
print('candidate counts', [len(c) for c in cands], flush=True)
sys.setrecursionlimit(10000)
dfs(0, frozenset(), frozenset(), 0.0, [])
print("\nBEST total cost", round(best[0], 1))
for k, t, g, c in best[1]:
    print(f"H{k:2d} par {par[k-1]}  {t:6s} -> {g:4s}  pair cost {c:5.1f}  (champ {champ[k-1]} medal {medal[k-1]})")
