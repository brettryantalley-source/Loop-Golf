#!/usr/bin/env node
/*
 * strategy-sweep.mjs — how often each course-management rule (src/caddie/strategy.js, D76) moves SAFE, what it costs
 * by the engine's own price, and what it buys in trouble and par chance (C10, v22.65, D137). Offline: not in the
 * build, not run by `npm test`.
 *
 *   node scripts/strategy-sweep.mjs [club …] [--json=<file>]   # default: the five bundled maps
 *
 * Every hole of each map: the par-4/5 tee shot, and approaches from 90 / 120 / 150 / 175 yds back along the hole
 * line × front / middle / back pin × fairway / rough / trees, priced twice — the rules as configured, and every
 * rule off (driverDefault, pinRule, noHero false: SAFE is then the par-ranked pick, D78). Per rule: calls where it
 * fired, the median and mean extra expected strokes against rules-off SAFE, the change in trouble and par chance.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile } from "../src/caddie/profile.js";
import { recommend } from "../src/caddie/engine.js";
import { DEFAULT_CONFIG } from "../src/caddie/config.js";
import { toOverpass } from "../src/localGeometry.js";
import { parseOverpass } from "../src/geometry.js";
import { buildHole } from "../src/caddie/geo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = JSON.parse(readFileSync(join(root, "src/profile.json"), "utf8"));
const args = process.argv.slice(2);
const jsonOut = args.find((a) => a.startsWith("--json="))?.slice(7);
const clubs = args.filter((a) => !a.startsWith("--"));
const CLUBS = clubs.length ? clubs : ["woodmont", "chicopee", "riverpines", "hampton", "bradshaw"];
const ON = loadProfile(RAW, DEFAULT_CONFIG);
const OFF = loadProfile(RAW, { ...DEFAULT_CONFIG, STRATEGY: { ...DEFAULT_CONFIG.STRATEGY, driverDefault: false, pinRule: false, noHero: false } });

/** The point `s` yards back from the green along the hole line (the line runs tee → green). */
function along(h, s) {
  const L = h.line;
  for (let i = L.length - 1, t = 0; i > 0; i--) {
    const a = L[i], b = L[i - 1], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (s <= t + d) { const u = (s - t) / d; return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }; }
    t += d;
  }
  return null;
}

const rows = [];
for (const club of CLUBS) {
  const geo = parseOverpass(toOverpass(JSON.parse(readFileSync(join(root, "src/localGeometry", `${club}.json`), "utf8"))));
  for (const k of Object.keys(geo.holes)) {
    const par = Number(geo.holes[k].par) || 4;
    const h = buildHole(geo, k, { par });
    if (!h) continue;
    const ctxs = [];
    if (par >= 4) ctxs.push({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par, pinPos: "middle", spot: "tee" });
    for (const yds of [90, 120, 150, 175]) {
      // from the green's centre back along the line; a hole shorter than that has no such shot
      const ball = along(h, yds + Math.hypot(h.green.center.x - h.line[h.line.length - 1].x, h.green.center.y - h.line[h.line.length - 1].y));
      if (!ball || Math.hypot(ball.x, ball.y) < 30) continue;
      for (const pinPos of ["front", "middle", "back"]) for (const lieType of ["fairway", "rough", "recovery"])
        ctxs.push({ shotNo: 2, ball, lieType, par, pinPos, spot: `${yds}` });
    }
    for (const c of ctxs) {
      const { spot, ...ctx } = c;
      const on = recommend(ctx, h, ON), off = recommend(ctx, h, OFF);
      if (!on?.safe || !off?.safe) continue;
      rows.push({
        club, hole: geo.holes[k].name || k, spot, lie: ctx.lieType, pin: ctx.pinPos, rules: on.strategy || [],
        on: { club: on.safe.club, exp: on.safe.expScore, par: on.safe.parProb, trouble: on.safe.troubleRate },
        off: { club: off.safe.club, exp: off.safe.expScore, par: off.safe.parProb, trouble: off.safe.troubleRate },
        moved: on.safe.club !== off.safe.club || on.safe.target?.x !== off.safe.target?.x || on.safe.target?.y !== off.safe.target?.y,
      });
    }
  }
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f = (v, d = 3) => (v == null ? "—" : v.toFixed(d));
const moved = rows.filter((r) => r.moved);
console.log(`${rows.length} calls on ${CLUBS.join(", ")}; the rules move SAFE on ${moved.length} (${((100 * moved.length) / rows.length).toFixed(0)}%)`);
console.log("rule         fired  moved  cost med / mean   trouble Δ (pts)  par Δ (pts)");
for (const rule of ["no-hero", "driver", "pin-front", "pin-middle", "pin-back", "par"]) {
  const r = rows.filter((x) => x.rules.includes(rule));
  const m = r.filter((x) => x.moved && rule !== "par");
  const cost = m.map((x) => x.on.exp - x.off.exp), tr = m.map((x) => 100 * (x.on.trouble - x.off.trouble)), pp = m.map((x) => 100 * (x.on.par - x.off.par));
  console.log(`${rule.padEnd(12)} ${String(r.length).padStart(5)}  ${String(m.length).padStart(5)}  ${f(med(cost))} / ${f(mean(cost))}   ${f(mean(tr), 1).padStart(6)}          ${f(mean(pp), 1).padStart(6)}`);
}
const byLie = {};
for (const r of rows) {
  const k = `${r.spot === "tee" ? "tee" : r.lie}`;
  byLie[k] ||= { n: 0, moved: 0, cost: [] };
  byLie[k].n++;
  if (r.moved) { byLie[k].moved++; byLie[k].cost.push(r.on.exp - r.off.exp); }
}
console.log("\nby lie: calls · moved · median cost when moved");
for (const [k, v] of Object.entries(byLie)) console.log(`  ${k.padEnd(9)} ${String(v.n).padStart(5)} · ${String(v.moved).padStart(4)} (${((100 * v.moved) / v.n).toFixed(0)}%) · ${f(med(v.cost))}`);
const punch = rows.filter((r) => r.lie === "recovery" && r.rules.includes("no-hero"));
console.log(`\nfrom the trees: no-hero moved SAFE on ${punch.filter((r) => r.moved).length} of ${rows.filter((r) => r.lie === "recovery").length}`);
const costly = moved.filter((r) => r.on.exp - r.off.exp > 0.3).sort((a, b) => (b.on.exp - b.off.exp) - (a.on.exp - a.off.exp));
console.log(`moves costing over 0.3 strokes: ${costly.length}`);
for (const r of costly.slice(0, 12)) console.log(`  ${r.club} ${r.hole} ${r.spot} ${r.lie} ${r.pin}: ${r.rules.join("+")} ${r.off.club} → ${r.on.club}, +${(r.on.exp - r.off.exp).toFixed(2)}, trouble ${(100 * r.off.trouble).toFixed(0)} → ${(100 * r.on.trouble).toFixed(0)}%`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows));
