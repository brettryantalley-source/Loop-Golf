/*
 * engine.test.js — spec §10 acceptance tests T1–T10 plus unit tests for the engine core.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig, lieDistAdj } from "./config.js";
import { baselineE, baselinePutts, isotonic, BASELINE_ROWS, BASELINE_ROWS_RAW, SMOOTHED_LIES } from "./baseline.js";
import { makeSamples } from "./random.js";
import { classify, greenDistances, pinPoint, fatSide, corridorAt, waterEntry, ringDistance, rect, ellipse } from "./course.js";
import { loadProfile, resolveEntry, E, Eputt, B, B2, bucketFor, candidateEntries, personalSg, puttingGapAt, handicapPrior, _internal } from "./profile.js";
import { recommend, priceTarget, generateCandidates, simulateCandidate, normalizeContext, displayLines, windEffect, playsLike, ellipseSampler, ELL80_K } from "./engine.js";
import { TEMPLATES } from "./reasons.js";
import { openPar5, waterLeftPar4, waterRightPar4, noWaterPar4, bunkeredPar3, par5With } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);

/** A profile copy with one bucket's sgPerShot (or any field) changed. */
function withBucket(raw, lie, fromYds, patch) {
  const copy = JSON.parse(JSON.stringify(raw));
  const b = copy.approachBuckets.find((x) => x.lie === lie && x.fromYds === fromYds);
  assert.ok(b, `bucket ${lie} ${fromYds}`);
  Object.assign(b, patch);
  return copy;
}
function withClub(raw, id, fn) {
  const copy = JSON.parse(JSON.stringify(raw));
  fn(copy.clubs.find((c) => c.id === id));
  return copy;
}
const strip = (o) => JSON.stringify(o);

/* ---------- baseline ---------- */

test("baseline: monotone in distance for every lie, rough > fairway, recovery > sand > rough", () => {
  // Broadie 2012 Table 9: fairway and rough are monotone as published; tee and sand after the
  // isotonic smoothing. Recovery dips 70→120 as published (3.84 → 3.78) and is left raw
  // (integration item 1 smooths tee and sand only), so it is checked from 120 on.
  for (const [lie, from] of [["fairway", 10], ["rough", 10], ["sand", 10], ["tee", 100], ["recovery", 120]]) {
    let prev = 0;
    for (let d = from; d <= 600; d += 5) { const v = baselineE(d, lie); assert.ok(v >= prev - 1e-9, `${lie} ${d}`); prev = v; }
  }
  assert.ok(baselineE(200, "sand") > baselineE(100, "sand"));
  // Table 9: sand passes recovery beyond ~420 yds (4.97 vs 4.94 at 440), so rec > sand is checked below that.
  for (let d = 40; d <= 500; d += 20) {
    assert.ok(baselineE(d, "rough") > baselineE(d, "fairway"), `rough>fw ${d}`);
    assert.ok(baselineE(d, "recovery") > baselineE(d, "sand") || d >= 440, `rec>sand ${d}`);
  }
  assert.equal(baselineE(10, "fairway"), 2.18, "Table 9 starts at 10 yds");
  assert.equal(baselineE(30, "sand"), 2.66);
  assert.equal(baselineE(100, "fairway"), 2.8);
  assert.equal(baselineE(400, "tee"), 3.99);
  assert.ok(Math.abs(baselinePutts(8) - 1.515) < 1e-9);
  assert.ok(baselinePutts(30) < baselinePutts(40));
  assert.equal(baselineE(50, "tee"), baselineE(50, "fairway"), "short tee shots price as fairway");
});

test("baseline: Table 9 verbatim, tee and sand isotonically smoothed at load, every other column untouched", () => {
  assert.equal(BASELINE_ROWS_RAW.length, 35);
  assert.deepEqual(BASELINE_ROWS_RAW.map((r) => r[0]), [10, 20, 30, 40, 50, 60, 70, 80, 90, ...Array.from({ length: 26 }, (_, i) => 100 + 20 * i)]);
  assert.ok(BASELINE_ROWS_RAW.every((r) => (r[0] < 100) === (r[1] == null)), "tee is null below 100, present from 100");
  const raw = (yds, c) => BASELINE_ROWS_RAW.find((r) => r[0] === yds)[c];
  assert.equal(raw(120, 1), 2.99); assert.equal(raw(140, 1), 2.97, "the published tee quirk is kept in RAW");
  assert.ok(baselineE(120, "tee") <= baselineE(140, "tee"), `smoothed tee 120 ${baselineE(120, "tee")} ≤ 140 ${baselineE(140, "tee")}`);
  assert.equal(baselineE(120, "tee"), 2.98, "PAV pools 2.99 / 2.97 to 2.98");
  assert.ok(baselineE(100, "sand") <= baselineE(120, "sand") && baselineE(120, "sand") <= baselineE(140, "sand"));
  assert.equal(SMOOTHED_LIES.join(","), "tee,sand");
  for (let i = 0; i < BASELINE_ROWS.length; i++) {
    for (const c of [0, 2, 3, 5]) assert.equal(BASELINE_ROWS[i][c], BASELINE_ROWS_RAW[i][c], `row ${BASELINE_ROWS_RAW[i][0]} col ${c} untouched`);
  }
  // smoothing leaves already-monotone stretches alone
  assert.equal(baselineE(400, "tee"), 3.99);
  assert.equal(baselineE(300, "sand"), 4.04);
});

test("isotonic: pool-adjacent-violators, non-decreasing, nulls skipped", () => {
  assert.deepEqual(isotonic([1, 3, 2, 4]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(isotonic([3, 2, 1]), [2, 2, 2]);
  assert.deepEqual(isotonic([null, 2.92, 2.99, 2.97, 2.99]), [null, 2.92, 2.98, 2.98, 2.99]);
  assert.deepEqual(isotonic([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(isotonic([]), []);
});

/* ---------- random ---------- */

test("random: seeded samples are reproducible and roughly standard normal", () => {
  const a = makeSamples(500, 7), b = makeSamples(500, 7);
  assert.deepEqual(a, b);
  const mean = a.reduce((s, x) => s + x.z1, 0) / a.length;
  const v = a.reduce((s, x) => s + x.z1 * x.z1, 0) / a.length;
  assert.ok(Math.abs(mean) < 0.15 && Math.abs(v - 1) < 0.2);
});

/* ---------- course ---------- */

test("course: classification priority and OB", () => {
  const h = { ...bunkeredPar3, boundary: rect(-100, -20, 100, 260) };
  assert.equal(classify(h, { x: 0, y: 175 }), "green");
  assert.equal(classify(h, { x: 10, y: 158 }), "sand");
  assert.equal(classify(h, { x: -30, y: 200 }), "water");
  assert.equal(classify(h, { x: 0, y: 0 }), "tee");
  assert.equal(classify(h, { x: 40, y: 100 }), "rough");
  assert.equal(classify(h, { x: 150, y: 100 }), "ob");
  assert.equal(classify(openPar5, { x: 0, y: 300 }), "fairway");
  assert.equal(classify(openPar5, { x: 500, y: 300 }), "rough", "no boundary → never OB");
});

test("course: a custom {x,y} pin is honoured by greenDistances, pinPoint and the engine's label", () => {
  const pin = { x: 5, y: 180 };
  const g = greenDistances(bunkeredPar3, { x: 0, y: 0 }, pin);
  assert.ok(Math.abs(g.pin - Math.hypot(5, 180)) < 0.1);
  assert.deepEqual(pinPoint(bunkeredPar3, { x: 0, y: 0 }, pin), pin);
  const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", pinPos: pin }, bunkeredPar3, P);
  assert.equal(r.context.pinPos, "custom");
  assert.doesNotMatch(strip(r), /object Object/);
  const c = { ...bunkeredPar3, hazards: [{ type: "trees", ring: rect(-60, 60, -20, 120), inner: [rect(-50, 80, -30, 100)] }] };
  assert.equal(classify(c, { x: -55, y: 70 }), "trees");
  assert.equal(classify(c, { x: -40, y: 90 }), "rough", "a clearing inside the wood is not trees");
  const n = { ...openPar5, nearby: { fairways: [rect(40, 200, 80, 300)], greens: [] } };
  assert.equal(classify(n, { x: 60, y: 250 }), "fairway", "the next hole's fairway is a fairway lie");
});

test("course: green distances front < center < back, pin thirds, fat side away from the bunker", () => {
  const g = greenDistances(bunkeredPar3, { x: 0, y: 0 }, "middle");
  assert.ok(g.front < g.center && g.center < g.back);
  assert.equal(g.pin, g.center);
  const f = greenDistances(bunkeredPar3, { x: 0, y: 0 }, "front"), b = greenDistances(bunkeredPar3, { x: 0, y: 0 }, "back");
  assert.ok(f.pin < g.center && b.pin > g.center);
  const fat = fatSide(bunkeredPar3);
  const bunker = bunkeredPar3.hazards[0].ring, water = bunkeredPar3.hazards[1].ring;
  const nearest = (p) => Math.min(ringDistance(p, bunker), ringDistance(p, water));
  assert.ok(nearest(fat) > nearest(bunkeredPar3.green.center), `fat side ${JSON.stringify(fat)} is farther from trouble than the center`);
  assert.deepEqual(corridorAt(openPar5, 300).map(Math.round), [-30, 30]);
  assert.equal(corridorAt(openPar5, 10), null);
  const drop = waterEntry(waterLeftPar4, { x: 0, y: 0 }, { x: -60, y: 260 });
  assert.notEqual(classify(waterLeftPar4, drop), "water");
  assert.ok(drop.x > -60);
});

/* ---------- profile ---------- */

test("profile: loads v2, every club in clubOrder resolves a usable full or finesse entry from the fairway", () => {
  assert.equal(RAW.version, 2);
  const ids = candidateEntries(P, "fairway").map((e) => `${e.club}/${e.swing}`);
  assert.ok(ids.includes("7i/full") && ids.includes("SW/finesse"), ids.join(","));
  assert.ok(!ids.includes("SW/full"), "SW full is a placeholder with no median");
  // D79: full driver and full 2-iron are tee clubs only — never offered from the fairway, always off the tee
  assert.ok(!ids.includes("Dr/full") && !ids.includes("2i/full"), "no full driver or 2-iron off the deck");
  assert.ok(ids.includes("2Hy/full"), "the 2-hybrid is the fairway long club");
  const tee = candidateEntries(P, "tee").map((e) => `${e.club}/${e.swing}`);
  assert.ok(tee.includes("Dr/full") && tee.includes("2i/full"), "both off the tee");
});

test("profile: fallback chain — rough entry with no median uses the fairway median scaled by LIE_DIST_ADJ", () => {
  const fw = resolveEntry(P, "7i", "full", "fairway");
  const ro = resolveEntry(P, "7i", "full", "rough");
  assert.equal(fw.sourceLie, "fairway");
  // item 7: the rough adjustment is per family (7-iron = mid, −4%)
  assert.equal(lieDistAdj(DEFAULT_CONFIG, "rough", "mid"), -0.04);
  assert.ok(Math.abs(ro.carry - fw.carry * (1 + lieDistAdj(DEFAULT_CONFIG, "rough", "mid"))) < 1e-9);
  assert.ok(ro.distSd > fw.distSd, "rough widens σ");
  assert.equal(ro.fields.girPct, P.clubs.get("7i").entries.full.rough.girPct, "rough GIR is the rough entry's own");
  const tee = resolveEntry(P, "7i", "full", "tee");
  assert.equal(tee.carry, fw.carry, "irons off a tee use the fairway entry");
  const dr = resolveEntry(P, "Dr", "full", "tee");
  assert.equal(dr.carry, dr.total, "driver: total is used directly");
  assert.ok(dr.fields.penaltyCount >= 1 && dr.bigMiss.right > dr.bigMiss.left, "Sep 28 decision 3: driver misses right more than left");
});

test("profile: E, Eputt, B behave and the S1 sanity check holds (green buckets beat red on SG)", () => {
  assert.ok(E(P, 150, "rough") > E(P, 150, "fairway"));
  assert.ok(Eputt(P, 5) < Eputt(P, 30));
  assert.ok(B(P, { lie: "green", ft: 5 }, 1) > B(P, { lie: "green", ft: 30 }, 1));
  assert.equal(B(P, { lie: "green", ft: 5 }, 3), 1);
  assert.equal(B(P, { lie: "fairway", d: 140 }, 1), 0);
  assert.ok(B(P, { lie: "fairway", d: 140 }, 2) > 0);
  assert.ok(B(P, { lie: "fairway", d: 400 }, 3) >= B(P, { lie: "fairway", d: 400 }, 2));
  // Appendix A sanity: 130–150 and 180–190 are green; 120–130, 160–180, 190–225 are red.
  const rel = (d) => E(P, d, "fairway") - baselineE(d, "fairway");
  for (const g of [135, 145, 185]) for (const r of [125, 165, 175, 195, 210]) assert.ok(rel(g) < rel(r), `E rank ${g} vs ${r}`);
});

test("profile: nothing in the engine writes to the loaded profile (T32 groundwork)", () => {
  const before = strip(RAW);
  recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, openPar5, P);
  recommend({ shotNo: 2, ball: { x: 0, y: 300 } }, waterLeftPar4, P);
  assert.equal(strip(P.raw), before);
});

/* ---------- ellipse ---------- */

test("ell80: 80% of samples fall inside the ellipse (T34 groundwork), frame maps +y short → short", () => {
  const ell = { wYds: 25.1, hYds: 45.3, tiltDeg: 113, dxYds: 4.1, dyYds: -0.1 };
  const f = ellipseSampler(ell);
  const s = makeSamples(10000, 3);
  let inside = 0;
  const t = (ell.tiltDeg * Math.PI) / 180;
  for (const x of s) {
    const d = f(x.z1, x.z2);
    const px = d.lat - ell.dxYds, py = -d.alongMiss - ell.dyYds;   // back to SP frame
    const a = px * Math.cos(t) + py * Math.sin(t), b = -px * Math.sin(t) + py * Math.cos(t);
    if ((a / (ell.wYds / 2)) ** 2 + (b / (ell.hYds / 2)) ** 2 <= 1) inside++;
  }
  const frac = inside / s.length;
  assert.ok(Math.abs(frac - 0.8) < 0.015, `inside ${frac}`);
  assert.ok(Math.abs(ELL80_K - 1.794) < 0.001);
  const g = ellipseSampler({ wYds: 10, hYds: 10, tiltDeg: 0, dxYds: 0, dyYds: 3 });
  assert.ok(Math.abs(g(0, 0).alongMiss + 3) < 1e-9, "dy = +3 (short) → alongMiss −3");
});

test("wind: head adds, tail subtracts less, crosswind from the right pushes left", () => {
  // item 3 values, mid family (loft ×1): head (0.010 + 0.00005·10)·10 = 10.5% of 150 = 15.75;
  // tail (0.007 − 0.00005·10)·10 = 6.5% = 9.75; cross 0.009·10·150 = 13.5 yds.
  const cfg = DEFAULT_CONFIG;
  const head = windEffect({ speedMph: 10, fromDeg: 0 }, 0, 150, cfg, "mid");
  const tail = windEffect({ speedMph: 10, fromDeg: 180 }, 0, 150, cfg, "mid");
  const cross = windEffect({ speedMph: 10, fromDeg: 90 }, 0, 150, cfg, "mid");
  assert.ok(Math.abs(head.alongYds - 15.75) < 1e-9 && head.relative === "into", `head ${head.alongYds}`);
  assert.ok(Math.abs(tail.alongYds + 9.75) < 1e-9 && tail.relative === "down", `tail ${tail.alongYds}`);
  assert.ok(Math.abs(cross.crossYds + 13.5) < 1e-9 && Math.abs(cross.alongYds) < 1e-9 && cross.relative === "cross-from-right");
  // no family (the headline plays-like number) = loft ×1
  assert.equal(windEffect({ speedMph: 10, fromDeg: 0 }, 0, 150, cfg).alongYds, head.alongYds);
});

test("wind: lofted clubs lose more %, tailwind returns diminish, crosswind ≈ 27 yds on a 153-yd iron at 20 mph", () => {
  const cfg = DEFAULT_CONFIG;
  const into = (fam, mph, yds = 150) => windEffect({ speedMph: mph, fromDeg: 0 }, 0, yds, cfg, fam).alongYds / yds;
  const down = (fam, mph, yds = 150) => -windEffect({ speedMph: mph, fromDeg: 180 }, 0, yds, cfg, fam).alongYds / yds;
  // PW (short, ×1.2) into 10 mph loses more of its distance than a driver (long, ×0.75)
  assert.ok(into("short", 10) > into("long", 10), `PW ${into("short", 10)} vs Dr ${into("long", 10)}`);
  assert.ok(Math.abs(into("short", 10) - 0.126) < 1e-9 && Math.abs(into("long", 10) - 0.07875) < 1e-9);
  assert.ok(into("wedge", 10) > into("short", 10));
  // 20 mph: head −22%, tail +12% (the GolfWRX/TrackMan % rule). The research's "a headwind hurts
  // almost twice as much as a tailwind helps" — so the tail gain is a bit MORE than half the head
  // loss (0.545), not less; and tail returns diminish (20 mph gains < 2 × 10 mph) while head grows.
  const h20 = into("mid", 20), t20 = down("mid", 20);
  assert.ok(Math.abs(h20 - 0.22) < 1e-9 && Math.abs(t20 - 0.12) < 1e-9, `h20 ${h20} t20 ${t20}`);
  assert.ok(t20 / h20 > 0.5 && t20 / h20 < 0.6, `tail/head at 20 mph ${t20 / h20}`);
  assert.ok(t20 < 2 * down("mid", 10) && h20 > 2 * into("mid", 10));
  // caps: head loss ≤ 50%, tail gain ≤ 20%
  assert.equal(into("wedge", 60), 0.5);
  assert.equal(down("wedge", 40), 0.2);
  // crosswind: 0.9%/mph × 20 × 153 = 27.5 yds for an iron (TrackMan 6-iron: 27 yds); long ×0.8
  const x6 = windEffect({ speedMph: 20, fromDeg: 270 }, 0, 153, cfg, "mid").crossYds;
  assert.ok(Math.abs(x6 - 27.54) < 1e-9, `6i cross ${x6}`);
  assert.ok(Math.abs(x6 - 27) < 1, "≈ 27 yds");
  const xDr = windEffect({ speedMph: 20, fromDeg: 270 }, 0, 153, cfg, "long").crossYds;
  assert.ok(Math.abs(xDr - 0.8 * x6) < 1e-9);
});

test("temperature plays-like: cold plays longer, hot plays shorter, 70°F or unknown is neutral", () => {
  const cfg = DEFAULT_CONFIG;
  const noWind = { wind: null, elevationDeltaYds: 0 };
  const cold = playsLike(150, 0, { ...noWind, tempF: 50 }, cfg);
  const hot = playsLike(150, 0, { ...noWind, tempF: 90 }, cfg);
  const ref = playsLike(150, 0, { ...noWind, tempF: 70 }, cfg);
  const unknown = playsLike(150, 0, { ...noWind, tempF: null }, cfg);
  // item 4: 0.85% per 10°F → 150 × 0.0085 × 2 = 2.55
  assert.equal(DEFAULT_CONFIG.TEMP_PCT_PER_10F, 0.0085);
  assert.ok(Math.abs(cold.tempYds - 2.55) < 1e-9, `cold tempYds ${cold.tempYds}`);
  assert.ok(Math.abs(cold.yds - 152.55) < 1e-9);
  assert.ok(Math.abs(hot.tempYds + 2.55) < 1e-9, `hot tempYds ${hot.tempYds}`);
  assert.ok(Math.abs(hot.yds - 147.45) < 1e-9);
  assert.equal(ref.tempYds, 0);
  assert.equal(ref.yds, 150);
  assert.equal(unknown.tempYds, 0);
  assert.equal(unknown.yds, 150);
});

test("normalizeContext: tempF defaults to null (no reading → no adjustment) and passes a finite value through", () => {
  assert.equal(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4).tempF, null);
  assert.equal(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", tempF: 58 }, waterLeftPar4).tempF, 58);
  assert.equal(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4).elevFt, null);
  assert.equal(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", elevFt: 1200 }, waterLeftPar4).elevFt, 1200);
});

test("altitude plays-like (item 5): 1.16%/1,000 ft above the 1,000-ft reference plays shorter; unknown → 0", () => {
  const cfg = DEFAULT_CONFIG;
  const noWind = { wind: null, elevationDeltaYds: 0, tempF: null };
  const denver = playsLike(150, 0, { ...noWind, elevFt: 5280 }, cfg);
  // (5280 − 1000) / 1000 × 1.16% = 4.9648% of 150 = 7.447 yds shorter
  assert.ok(Math.abs(denver.altYds / 150 + 0.049648) < 1e-9, `alt ${denver.altYds}`);
  assert.ok(Math.abs(denver.yds - (150 - 150 * 0.049648)) < 1e-9);
  assert.equal(playsLike(150, 0, { ...noWind, elevFt: null }, cfg).altYds, 0);
  assert.equal(playsLike(150, 0, { ...noWind, elevFt: null }, cfg).yds, 150);
  assert.equal(playsLike(150, 0, { ...noWind, elevFt: 1000 }, cfg).altYds, 0, "home altitude is neutral");
  assert.ok(playsLike(150, 0, { ...noWind, elevFt: 0 }, cfg).altYds > 0, "sea level plays longer than home");
  // it reaches the output context
  const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", elevFt: 5280 }, bunkeredPar3, P);
  assert.equal(r.context.elevFt, 5280);
  assert.ok(r.context.altYds < 0);
  assert.equal(recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, bunkeredPar3, P).context.altYds, 0);
});

test("roll by conditions (item 6): carry is carry; wet kills long-club roll, wet wedges release more, firm adds roll", () => {
  const M = DEFAULT_CONFIG.ROLL_COND_MULT;
  for (const [club, lie] of [["Dr", "tee"], ["2Hy", "fairway"], ["5i", "fairway"], ["GW", "fairway"], ["7i", "rough"]]) {
    const n = resolveEntry(P, club, "full", lie);
    const w = resolveEntry(P, club, "full", lie, { conditions: "wet" });
    const f = resolveEntry(P, club, "full", lie, { conditions: "firm" });
    assert.equal(w.carry, n.carry, `${club} wet carry unchanged`);
    assert.equal(f.carry, n.carry, `${club} firm carry unchanged`);
    assert.ok(Math.abs(w.roll - n.roll * M.wet[n.family]) < 1e-9, `${club} wet roll`);
    assert.ok(Math.abs(f.roll - n.roll * M.firm[n.family]) < 1e-9, `${club} firm roll`);
    assert.deepEqual(resolveEntry(P, club, "full", lie, { wet: true }), w, "the old { wet: true } still means wet");
  }
  // wet driver total = carry + 0.35 × roll. NB the driver off a tee has roll 0 (ROLL_YDS.tee: its
  // Shot Pattern total IS the carry the engine uses), so the long-family rule is shown on the 2-hybrid.
  const dr = resolveEntry(P, "Dr", "full", "tee", { conditions: "wet" }), drN = resolveEntry(P, "Dr", "full", "tee");
  assert.equal(dr.carry + dr.roll, drN.carry + 0.35 * drN.roll);
  const hy = resolveEntry(P, "2Hy", "full", "fairway"), hyW = resolveEntry(P, "2Hy", "full", "fairway", { conditions: "wet" });
  assert.equal(hy.roll, 12);
  assert.ok(Math.abs(hyW.carry + hyW.roll - (hy.carry + 0.35 * 12)) < 1e-9);
  // a wet wedge rolls more than a dry one; a firm 5-iron rolls 1.3×
  assert.ok(resolveEntry(P, "GW", "full", "fairway", { conditions: "wet" }).roll > resolveEntry(P, "GW", "full", "fairway").roll);
  assert.ok(Math.abs(resolveEntry(P, "5i", "full", "fairway", { conditions: "firm" }).roll - 1.3 * 10) < 1e-9);
  // the engine passes ctx.conditions through: a wet corridor candidate stops shorter than a dry one
  const ctxN = normalizeContext({ shotNo: 2, ball: { x: 0, y: 150 }, lieType: "fairway" }, openPar5);
  const ctxW = normalizeContext({ shotNo: 2, ball: { x: 0, y: 150 }, lieType: "fairway", conditions: "wet" }, openPar5);
  const hyN = generateCandidates(ctxN, openPar5, P).find((c) => c.club === "2Hy");
  const hyWet = generateCandidates(ctxW, openPar5, P).find((c) => c.club === "2Hy");
  assert.equal(hyWet.entry.conditions, "wet");
  assert.ok(Math.abs(hyN.entry.roll - hyWet.entry.roll - 12 * 0.65) < 1e-9);
});

test("rough carry by family (item 7): wedges and short irons fly a touch longer, mid and long come up short", () => {
  const cfg = DEFAULT_CONFIG;
  assert.deepEqual([["wedge"], ["short"], ["mid"], ["long"]].map(([f]) => lieDistAdj(cfg, "rough", f)), [0.02, 0.02, -0.04, -0.08]);
  assert.equal(lieDistAdj(cfg, "sand", "wedge"), -0.12, "sand stays a number");
  assert.equal(lieDistAdj(cfg, "recovery", "long"), -0.30);
  assert.equal(lieDistAdj(cfg, "fairway", "mid"), 0);
  // a per-family object inside LIE_DIST_ADJ itself is read too
  assert.equal(lieDistAdj(mergeConfig({ LIE_DIST_ADJ_FAMILY: { rough: null }, LIE_DIST_ADJ: { rough: { mid: -0.05 } } }), "rough", "mid"), -0.05);
  for (const [club, fam] of [["GW", "wedge"], ["PW", "short"], ["7i", "mid"], ["2Hy", "long"]]) {
    const fw = resolveEntry(P, club, "full", "fairway"), ro = resolveEntry(P, club, "full", "rough");
    assert.equal(ro.family, fam);
    assert.ok(Math.abs(ro.carry - fw.carry * (1 + lieDistAdj(cfg, "rough", fam))) < 1e-9, `${club} rough carry`);
  }
  assert.ok(resolveEntry(P, "PW", "full", "rough").carry > resolveEntry(P, "PW", "full", "fairway").carry, "flyer: PW from rough goes longer");
  assert.ok(resolveEntry(P, "5i", "full", "rough").carry < resolveEntry(P, "5i", "full", "fairway").carry, "5i from rough comes up short");
});

test("handicap prior (item 2): no bucket → baseline + 0.42 × (0.41 + 0.0025 d); a bucketed distance is unchanged", () => {
  const cfg = DEFAULT_CONFIG;
  assert.equal(cfg.HCP_BLEND, 0.42);
  assert.ok(Math.abs(handicapPrior(cfg, 400) - 0.42 * (0.41 + 0.0025 * 400)) < 1e-12, "gap from the two tee lines = 0.41 + 0.0025 d");
  assert.equal(personalSg(P, 400, "tee"), null, "no tee bucket at 400");
  const Pf = loadProfile(RAW);
  const e400 = E(Pf, 400, "tee"), b400 = baselineE(400, "tee");
  assert.ok(e400 > b400);
  assert.ok(Math.abs(e400 - b400 - puttingGapAt(Pf, 400, "tee") - 0.42 * (0.41 + 0.0025 * 400)) < 1e-9, `E(400 tee) ${e400}`);
  // a bucketed distance prices from its bucket, not the prior. Pinned to the Oct 4 profile (D78:
  // buckets shrunk toward the lie average): 150 fairway, 165 rough, and the personal part at 30.
  assert.ok(Math.abs(E(Pf, 150, "fairway") - 3.7585) < 1e-9, `E(150 fw) ${E(Pf, 150, "fairway")}`);
  assert.ok(Math.abs(E(Pf, 165, "rough") - 3.8161666666666667) < 1e-9, `E(165 rough) ${E(Pf, 165, "rough")}`);
  assert.ok(Math.abs(E(Pf, 30, "fairway") - baselineE(30, "fairway") - 0.237) < 1e-9, `E(30 fw) ${E(Pf, 30, "fairway")}`);
  // a measured 0 is data, not "no data"
  const P0 = loadProfile(withBucket(RAW, "fairway", 150, { sgPerShot: 0 }));
  assert.equal(personalSg(P0, 155, "fairway"), 0);
  assert.ok(Math.abs(E(P0, 155, "fairway") - baselineE(155, "fairway") - puttingGapAt(P0, 155, "fairway")) < 1e-9);
  // a bucket with no sgPerShot takes the prior
  const Pn = loadProfile(withBucket(RAW, "fairway", 150, { sgPerShot: null }));
  assert.equal(personalSg(Pn, 155, "fairway"), null);
  assert.ok(Math.abs(E(Pn, 155, "fairway") - baselineE(155, "fairway") - puttingGapAt(Pn, 155, "fairway") - handicapPrior(cfg, 155)) < 1e-9);
  // BASELINE_SCRATCH_OFFSET still adds on top, default 0
  const Po = loadProfile(RAW, mergeConfig({ BASELINE_SCRATCH_OFFSET: 0.2 }));
  assert.ok(Math.abs(E(Po, 400, "tee") - e400 - 0.2) < 1e-9);
});

/* ---------- §10 acceptance ---------- */

const tee = (hole, extra = {}) => recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", ...extra }, hole, P);

test("T1 same shot: wide-open par 5 → sameShot, single option = driver, 'Same shot both ways.'", () => {
  const r = tee(openPar5);
  assert.equal(r.sameShot, true);
  assert.equal(r.aggressive, null);
  assert.equal(r.safe.club, "Dr");
  assert.equal(r.message, "Same shot both ways.");
  assert.match(displayLines(r)[0], /^BOTH {7} Driver · .*Same shot both ways\.$/);
});

test("T2 aggressive always priced: whenever sameShot is false both options carry expScore, birdieProb, troubleRate and a delta", () => {
  const cases = [
    () => recommend({ shotNo: 2, ball: { x: 0, y: 300 } }, par5With([{ type: "water", ring: rect(-12, 480, 40, 522) }]), P),
    () => tee(bunkeredPar3),
    () => tee(waterLeftPar4),
    () => recommend({ shotNo: 2, ball: { x: 0, y: 236 } }, waterLeftPar4, P),
  ];
  let seen = 0;
  for (const c of cases) {
    const r = c();
    if (r.sameShot) continue;
    seen++;
    for (const o of [r.safe, r.aggressive]) {
      for (const k of ["expScore", "birdieProb", "troubleRate"]) assert.equal(typeof o[k], "number", k);
    }
    assert.equal(typeof r.aggressive.deltaExp, "number");
    assert.ok(r.aggressive.birdieProb >= r.safe.birdieProb);
    // Locked rule 1 as restated by D76: SAFE is the lowest expected score unless a course-management
    // rule (strategy.js) moved it — and then the output names the rule.
    assert.ok(r.aggressive.expScore >= r.safe.expScore - 1e-9 || r.strategy.length > 0);
  }
  assert.ok(seen >= 1, "at least one fixture produced two options");
});

test("T3 lie changes the club: 174 from the fairway → 7-iron; from the rough the pick changes and never runs through the front bunker", () => {
  // A bunker across the front of the green. From the fairway the club that plays the number wins.
  // From the rough Brett's roll-out triples (D33), so the same club is no longer the answer: the
  // engine must pick a different club, and no roll path may end in the bunker on the mean line.
  const hole = { ...openPar5, id: "guarded-approach", green: { ring: ellipse(0, 540, 12, 12, 32), center: { x: 0, y: 540 } },
    hazards: [{ type: "sand", ring: rect(-14, 520, 14, 527) }] };
  const ball = { x: 0, y: openPar5.yards - 174 };
  const fw = recommend({ shotNo: 2, ball, lieType: "fairway" }, hole, P);
  const ro = recommend({ shotNo: 2, ball, lieType: "rough" }, hole, P);
  assert.equal(fw.context.distances.pin, 174);
  assert.equal(fw.safe.club, "7i", `fairway → ${fw.safe.club}`);
  assert.notEqual(ro.safe.club, fw.safe.club, `rough → ${ro.safe.club} should differ from the fairway club`);
  const e = resolveEntry(P, ro.safe.club, ro.safe.swingType, "rough");
  assert.ok(e.roll > resolveEntry(P, ro.safe.club, ro.safe.swingType, "fairway").roll, "rough roll-out is larger");
  // the rough pick's mean carry does not land in the bunker
  const yCarry = ball.y + e.carry;
  assert.ok(yCarry < 520 || yCarry > 527, `mean carry ${yCarry.toFixed(0)} lands in the bunker`);
  assert.ok(ro.safe.troubleRate < 0.5, `trouble ${ro.safe.troubleRate}`);
});

test("T4 finesse preference: 100 yds from the fairway → a finesse wedge entry, never a full-swing wedge carry", () => {
  const hole = { ...openPar5, hazards: [] };
  const r = recommend({ shotNo: 3, ball: { x: 0, y: openPar5.yards - 100 } }, hole, P);
  assert.equal(r.safe.swingType, "finesse", `${r.safe.club} ${r.safe.swingType}`);
  assert.ok(["SW", "LW", "GW"].includes(r.safe.club), r.safe.club);
  const e = resolveEntry(P, r.safe.club, "finesse", "fairway");
  assert.equal(r.safe.carryYds, Math.round(e.carry));
});

test("T5 layup by proximity: 265 out on a par 5 with E(100) < E(75) → leave ~100, not ~75", () => {
  // Make 100 clearly better than 75 in Brett's own numbers, and remove any club that reaches 240.
  let raw = withBucket(RAW, "fairway", 100, { sgPerShot: 0.4 });
  raw = withBucket(raw, "fairway", 110, { sgPerShot: 0.4 });
  raw = withBucket(raw, "fairway", 75, { sgPerShot: -0.5 });
  raw = withBucket(raw, "fairway", 50, { sgPerShot: -0.5 });
  const Pq = loadProfile(raw);
  const hole = { ...openPar5, green: { ...openPar5.green }, hazards: [{ type: "water", ring: rect(-40, 500, 40, 522) }] };
  // 265 out: nothing in the bag reaches (the 4-hybrid's tee median would reach from 240), so it is a layup decision.
  const r = recommend({ shotNo: 2, ball: { x: 0, y: openPar5.yards - 265 }, lieType: "fairway" }, hole, Pq);
  assert.ok(E(Pq, 100, "fairway") < E(Pq, 75, "fairway"), `E100 ${E(Pq, 100, "fairway")} E75 ${E(Pq, 75, "fairway")}`);
  const leave = 265 - r.safe.meanYds;
  assert.equal(r.safe.kind, "layup", r.safe.target.label);
  assert.ok(leave >= 90 && leave <= 115, `leave ${leave} (${r.safe.label} ${r.safe.target.label})`);
});

test("T6 layup landing safety: a bunker in the shorter layup's landing zone pushes the pick to the club that clears it", () => {
  const ball = { x: 0, y: openPar5.yards - 265 };
  const clean = par5With([{ type: "water", ring: rect(-40, 500, 40, 522) }]);
  const r0 = recommend({ shotNo: 2, ball, lieType: "fairway" }, clean, P);
  assert.equal(r0.safe.kind, "layup");
  // Put sand exactly where the clean pick lands: ±12 yds around its mean, full fairway width.
  const yLand = ball.y + r0.safe.meanYds;
  const trapped = par5With([...clean.hazards, { type: "sand", ring: rect(-30, yLand - 12, 30, yLand + 12) }]);
  const r1 = recommend({ shotNo: 2, ball, lieType: "fairway" }, trapped, P);
  assert.notEqual(`${r1.safe.club}/${r1.safe.swingType}`, `${r0.safe.club}/${r0.safe.swingType}`, "the optimizer moved off the trapped landing zone");
  assert.ok(r1.safe.troubleRate < 0.5, `trouble ${r1.safe.troubleRate}`);
});

test("T7 ghost isolation: ghost differential, match score and segment state never change the output", () => {
  const base = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4, P);
  for (const noise of [
    { ghost: 5, ghostDiff: 8.2 },
    { match: { you: 2, ghost: 3.5 }, segment: { won: 1, lost: 2 } },
    { differential: 12.8, ghostHoleScores: [5, 4, 5] },
  ]) {
    const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", ...noise }, waterLeftPar4, P);
    assert.equal(strip(r), strip(base));
  }
});

test("T8 recompute: a new ball position produces a new recommendation, and the same one again", () => {
  const a = recommend({ shotNo: 2, ball: { x: 0, y: 250 } }, waterLeftPar4, P);
  const b = recommend({ shotNo: 2, ball: { x: 0, y: 290 } }, waterLeftPar4, P);
  const a2 = recommend({ shotNo: 2, ball: { x: 0, y: 250 } }, waterLeftPar4, P);
  assert.notEqual(strip(a.context), strip(b.context));
  assert.notEqual(a.context.distances.pin, b.context.distances.pin);
  assert.equal(strip(a), strip(a2));
});

test("T9 big-miss pricing: water left + driver bigMiss.left > right → SAFE driver target moves right and trouble drops vs no water", () => {
  const raw = withClub(RAW, "Dr", (c) => { c.entries.full.tee.bigMiss.left = 0.2; c.entries.full.tee.bigMiss.right = 0.05; });
  const Pl = loadProfile(raw);
  const ctx = normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4);
  const samples = makeSamples(DEFAULT_CONFIG.SAMPLES, DEFAULT_CONFIG.SEED);
  const bestDriver = (hole) => {
    const cands = generateCandidates(ctx, hole, Pl).filter((c) => c.club === "Dr");
    assert.ok(cands.length > 3, "driver corridor candidates exist");
    return cands.map((c) => ({ ...c, ...simulateCandidate(c, ctx, hole, Pl, samples) })).reduce((a, b) => (b.expScore < a.expScore ? b : a));
  };
  const water = bestDriver(waterLeftPar4), dry = bestDriver(noWaterPar4);
  assert.ok(water.target.x > dry.target.x, `water target x ${water.target.x} vs dry ${dry.target.x}`);
  // the driver aimed at the dry target, on the water hole, finds more trouble than the shifted target
  const dryAimOnWater = generateCandidates(ctx, waterLeftPar4, Pl).filter((c) => c.club === "Dr" && Math.abs(c.target.x - dry.target.x) < 1e-9)[0];
  assert.ok(dryAimOnWater, "the dry target exists on the water hole");
  const priced = simulateCandidate(dryAimOnWater, ctx, waterLeftPar4, Pl, samples);
  assert.ok(water.troubleRate < priced.troubleRate, `trouble ${water.troubleRate} vs ${priced.troubleRate}`);
  // and the whole recommendation still prices two options or says same shot
  const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4, Pl);
  assert.ok(r.safe && (r.sameShot || r.aggressive));
});

test("T43 driver default / flip threshold: driver is SAFE on open holes; with water on the right-miss side a shorter club wins only when it cuts trouble by > ~6 points", () => {
  // Research §2.2 / §5.1 (integration item 9): no new rule — the simulation prices it from Brett's
  // big-miss rates and the hole polygons. Brett's big miss is right (Sep 28 decision 3: Dr bigMiss.right > left).
  assert.equal(tee(openPar5).safe.club, "Dr", "wide-open par 5");
  assert.equal(tee(noWaterPar4).safe.club, "Dr", "par 4, no trouble");
  const drBm = RAW.clubs.find((c) => c.id === "Dr").entries.full.tee.bigMiss;
  assert.ok(drBm.right > drBm.left, "Brett misses right");

  const samples = makeSamples(DEFAULT_CONFIG.SAMPLES, DEFAULT_CONFIG.SEED);
  const ctx = normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterRightPar4);
  const THRESH = 0.06;
  const picks = [];
  for (const right of [0, 0.02, 0.05, 0.1, drBm.right, 0.2, 0.3]) {
    const Pr = loadProfile(withClub(RAW, "Dr", (c) => { c.entries.full.tee.bigMiss.right = right; }));
    const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterRightPar4, Pr);
    const scored = generateCandidates(ctx, waterRightPar4, Pr).map((c) => ({ ...c, ...simulateCandidate(c, ctx, waterRightPar4, Pr, samples) }));
    const bestOf = (id) => scored.filter((c) => c.club === id).reduce((a, b) => (b.expScore < a.expScore ? b : a));
    const dr = bestOf("Dr");
    const shorterMinTrouble = Math.min(...[...new Set(scored.filter((c) => c.club !== "Dr").map((c) => c.club))].map((id) => bestOf(id).troubleRate));
    if (r.safe.club !== "Dr") {
      // a shorter club only wins when the driver's trouble is > ~6 points worse than the pick's
      assert.ok(dr.troubleRate - r.safe.troubleRate > THRESH, `right ${right}: ${r.safe.club} wins with a trouble drop of only ${(dr.troubleRate - r.safe.troubleRate).toFixed(3)}`);
    }
    if (dr.troubleRate - shorterMinTrouble <= THRESH) {
      // and when no shorter club saves more than ~6 points, driver stays
      assert.equal(r.safe.club, "Dr", `right ${right}: driver trouble only ${(dr.troubleRate - shorterMinTrouble).toFixed(3)} above the best shorter club, yet ${r.safe.club}`);
    }
    picks.push(r.safe.club === "Dr");
  }
  // not vacuous: the sweep starts on driver and flips to a shorter club, once, as the right miss grows
  assert.equal(picks[0], true, "no right miss → driver");
  assert.equal(picks[picks.length - 1], false, "a 30% right miss into water → a shorter club");
  assert.equal(picks.findIndex((x) => !x), picks.lastIndexOf(true) + 1, `one flip: ${picks.join(",")}`);
});

test("T10 output hygiene: reasons resolve only profile fields; no shape word anywhere in the output", () => {
  const allowed = new Set([..._internal.ENTRY_FIELDS, "label", "sourceLie", "lateralSdDeg"]);
  const results = [tee(openPar5), tee(waterLeftPar4), tee(bunkeredPar3), recommend({ shotNo: 3, ball: { x: 0, y: 440 } }, openPar5, P)];
  for (const r of results) {
    for (const o of [r.safe, r.aggressive].filter(Boolean)) {
      assert.ok(o.reason.length > 0);
      for (const [k, v] of Object.entries(o.reasonFields)) {
        assert.ok(allowed.has(k), `token ${k}`);
        const e = resolveEntry(P, o.club, o.swingType, r.context.lieType);
        if (k === "label") assert.ok(v.startsWith(e.label));
        else if (k === "sourceLie") assert.ok(["tee", "fairway", "rough"].includes(v));
        else if (k === "lateralSdDeg") assert.equal(v, e.lateralSdDeg);
        else assert.equal(v, e.fields[k], `${k} must be the profile's value`);
      }
      // the reason text is the template with tokens filled — nothing else
      const tpl = TEMPLATES.find((t) => t.tokens.every((tok) => tok in o.reasonFields) && Object.keys(o.reasonFields).every((tok) => t.tokens.includes(tok)));
      assert.ok(tpl, "reason came from a template");
    }
    assert.doesNotMatch(strip(r), /draw|fade|shape|cut|hook|slice/i);
  }
});

/* ---------- §3.10 display ---------- */

test("display lines: SAFE / AGGRESSIVE format with delta, ≈ same avg. under 0.05", () => {
  const r = recommend({ shotNo: 2, ball: { x: 0, y: 236 } }, waterLeftPar4, P);
  if (!r.sameShot) {
    const lines = displayLines(r);
    assert.match(lines[0], /^SAFE {8}.* · .*Avg \d\.\d · Birdie \d+% · Trouble \d+%$/);
    assert.match(lines[2], /^AGGRESSIVE .*Avg \d\.\d \((\+|-)?\d\.\d\)|≈ same avg\./);
  }
  const fake = { sameShot: false, safe: { label: "5-iron", target: { label: "leave 100, center" }, expScore: 4.84, birdieProb: 0.06, troubleRate: 0.04, reason: "r" },
    aggressive: { label: "2-hybrid", target: { label: "green, fat side" }, expScore: 4.86, birdieProb: 0.13, troubleRate: 0.19, deltaExp: 0.02, reason: "r" } };
  assert.match(displayLines(fake)[2], /≈ same avg\./);
});

/* ---------- performance ---------- */

test("performance: a full recompute on the busiest fixture stays well inside the 500 ms budget in Node", () => {
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, waterLeftPar4, P);
  const ms = (performance.now() - t0) / 3;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test("config: mergeConfig deep-merges objects and replaces arrays", () => {
  const c = mergeConfig({ ROLL_YDS: { full: { mid: 8 } }, RECENCY_TIERS: [[1, 1]] });
  assert.equal(c.ROLL_YDS.full.mid, 8);
  assert.equal(c.ROLL_YDS.full.long, DEFAULT_CONFIG.ROLL_YDS.full.long);
  assert.deepEqual(c.RECENCY_TIERS, [[1, 1]]);
});

test("bucketFor / B2 use half-open buckets and the rough table for rough", () => {
  assert.equal(bucketFor(P, 140, "fairway").fromYds, 140);
  assert.equal(bucketFor(P, 139.9, "fairway").fromYds, 130);
  assert.equal(bucketFor(P, 140, "rough").lie, "rough");
  assert.ok(B2(P, 140, "fairway") > 0);
});

/* ---------- doglegs: aim follows the golf=hole centreline, not the tee→green chord ---------- */

// Chicopee Woods Village 1 as OSM draws it (way 858334864): 364 yds, the line bends 31 yds left
// at 275 out. No fairway outline is mapped, so the centreline is the only shape the engine has.
const village1 = {
  id: "village-1", par: 4, yards: 364, tee: { x: 0, y: 0 },
  green: { ring: ellipse(0, 364, 14, 14, 32), center: { x: 0, y: 364 } },
  fairways: [], tees: [], hazards: [], boundary: null,
  line: [{ x: 0, y: 0 }, { x: -31, y: 275 }, { x: 0, y: 364 }],
};

test("dogleg: tee-shot candidates sit on the bent centreline, not the chord", () => {
  const ctx = normalizeContext({ ball: { x: 0, y: 0 }, lieType: "tee", par: 4, shotNo: 1 }, village1);
  const cands = generateCandidates(ctx, village1, P).filter((c) => c.kind !== "approach");
  assert.ok(cands.length > 0);
  for (const c of cands) {
    const y = c.target.y, lineX = y <= 275 ? (-31 * y) / 275 : -31 + (31 * (y - 275)) / 89;
    assert.ok(Math.abs(c.target.x - lineX) <= 2, `${c.club} ${c.label} at x=${c.target.x}, line x=${lineX.toFixed(1)}`);
  }
  const res = recommend({ ball: { x: 0, y: 0 }, lieType: "tee", par: 4, shotNo: 1 }, village1, P);
  assert.ok(res.safe.target.x < -10, `SAFE aims ${res.safe.target.x} — should follow the bend left`);
});

test("dogleg: past the corner the line is ball → green, as on a straight hole", () => {
  const ctx = normalizeContext({ ball: { x: -30, y: 280 }, lieType: "fairway", par: 4, shotNo: 2 }, village1);
  const withLine = generateCandidates(ctx, village1, P);
  const without = generateCandidates(ctx, { ...village1, line: undefined }, P);
  assert.deepEqual(withLine.map((c) => [c.club, c.target]), without.map((c) => [c.club, c.target]));
});

/* ---------- own target (v22.16.5): the club and its numbers follow the marker ---------- */

test("priceTarget: the club fits the marker's distance and moves with it", () => {
  const ctx = { ball: { x: 0, y: 0 }, lieType: "fairway", par: 4, shotNo: 2 };
  const hole = { ...village1, line: undefined };
  const near = priceTarget(ctx, hole, P, { x: 0, y: 120 });
  const far = priceTarget(ctx, hole, P, { x: 0, y: 200 });
  assert.ok(near && far);
  assert.ok(far.carryYds > near.carryYds, `${far.club} should be longer than ${near.club}`);
  assert.ok(Math.abs(near.meanYds - 120) <= 15 && Math.abs(far.meanYds - 200) <= 20, `${near.meanYds} / ${far.meanYds}`);
  assert.equal(near.target.x, 0); assert.equal(near.target.y, 120);
  assert.match(near.target.label, /^leave \d+, own target$/);
  const onGreen = priceTarget(ctx, hole, P, { x: 0, y: 364 });
  assert.equal(onGreen.kind, "approach");
  assert.equal(priceTarget(ctx, hole, P, null), null);
});
