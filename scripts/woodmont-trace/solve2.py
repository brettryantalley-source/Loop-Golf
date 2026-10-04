"""solve2.py — fix the high-confidence holes, search the rest exhaustively; print the best few complete assignments."""
import sys, math, heapq
sys.path.insert(0, "/tmp/woodmont-trace")
exec(open("/tmp/woodmont-trace/solve.py").read().split("cands = []")[0])   # reuse data + pair_cost/adj_cost
G["G20"] = (1739, 962)

FIXED = {2:("TA","G54"), 4:("TB","G66"), 5:("TSW","G44"), 6:("TW","G36"), 7:("TF1","G26"), 9:("T9","G22"), 10:("TNW","G13"), 11:("TN","G24"), 12:("TE","G40")}
free_h = [h for h in range(1, 19) if h not in FIXED]
used_t = {t for t, g in FIXED.values()}; used_g = {g for t, g in FIXED.values()}
free_t = [t for t in T if t not in used_t]; free_g = [g for g in G if g not in used_g]
print("free holes", free_h, "\nfree tees", free_t, "\nfree greens", free_g, flush=True)

cand = {h: sorted((pair_cost(h - 1, t, g), t, g) for t in free_t for g in free_g if pair_cost(h - 1, t, g) < 60) for h in free_h}
for h in free_h:
    print(f"H{h} par {par[h-1]} ({champ[h-1]}/{medal[h-1]}):", ", ".join(f"{t}->{g} {c:.0f}" for c, t, g in cand[h][:8]), flush=True)

sols = []
def rec(i, ut, ug, assign, cost):
    if i == len(free_h):
        full = dict((h, (t, g)) for h, (t, g) in FIXED.items()); full.update({h: (t, g) for h, t, g in assign})
        adj = sum(adj_cost(full[h][1], full[h % 18 + 1][0]) for h in range(1, 19))
        sols.append((cost + adj, cost, adj, dict(full))); return
    h = free_h[i]
    for c, t, g in cand[h]:
        if t in ut or g in ug: continue
        rec(i + 1, ut | {t}, ug | {g}, assign + [(h, t, g)], cost + c)
rec(0, frozenset(), frozenset(), [], 0.0)
sols.sort(key=lambda s: s[0])
print("\nsolutions:", len(sols), flush=True)
for tot, c, a, full in sols[:6]:
    print(f"\n total {tot:.1f} (pair {c:.1f} + adjacency {a:.1f})")
    print("  " + "  ".join(f"H{h}:{full[h][0]}>{full[h][1]}" for h in range(1, 19)))
