/*
 * engine.test.js — spec §10 acceptance tests T1–T10 plus unit tests for the engine core.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { baselineE, baselinePutts } from "./baseline.js";
import { makeSamples } from "./random.js";
import { classify, greenDistances, fatSide, corridorAt, waterEntry, ringDistance, rect, ellipse } from "./course.js";
import { loadProfile, resolveEntry, E, Eputt, B, B2, bucketFor, candidateEntries, _internal } from "./profile.js";
import { recommend, generateCandidates, simulateCandidate, normalizeContext, displayLines, windEffect, ellipseSampler, ELL80_K } from "./engine.js";
import { TEMPLATES } from "./reasons.js";
import { openPar5, waterLeftPar4, noWaterPar4, bunkeredPar3, par5With } from "../fixtures/synthetic-holes.js";

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
  for (const lie of ["fairway", "rough", "recovery"]) {
    let prev = 0;
    for (let d = 20; d <= 600; d += 10) { const v = baselineE(d, lie); assert.ok(v >= prev - 1e-9, `${lie} ${d}`); prev = v; }
  }
  // sand dips slightly between 100 and 140 in the published table (a greenside bunker is easier than a 60-yd one)
  assert.ok(baselineE(200, "sand") > baselineE(100, "sand"));
  for (let d = 40; d <= 500; d += 20) {
    assert.ok(baselineE(d, "rough") > baselineE(d, "fairway"), `rough>fw ${d}`);
    assert.ok(baselineE(d, "recovery") > baselineE(d, "sand") || d >= 560, `rec>sand ${d}`);
  }
  assert.equal(baselineE(100, "fairway"), 2.8);
  assert.equal(baselineE(400, "tee"), 3.99);
  assert.ok(Math.abs(baselinePutts(8) - 1.515) < 1e-9);
  assert.ok(baselinePutts(30) < baselinePutts(40));
  assert.equal(baselineE(50, "tee"), baselineE(50, "fairway"), "short tee shots price as fairway");
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
  assert.ok(ids.includes("7i/full") && ids.includes("SW/finesse") && ids.includes("Dr/full"), ids.join(","));
  assert.ok(!ids.includes("SW/full"), "SW full is a placeholder with no median");
});

test("profile: fallback chain — rough entry with no median uses the fairway median scaled by LIE_DIST_ADJ", () => {
  const fw = resolveEntry(P, "7i", "full", "fairway");
  const ro = resolveEntry(P, "7i", "full", "rough");
  assert.equal(fw.sourceLie, "fairway");
  assert.ok(Math.abs(ro.carry - fw.carry * (1 + DEFAULT_CONFIG.LIE_DIST_ADJ.rough)) < 1e-9);
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
  const cfg = DEFAULT_CONFIG;
  const head = windEffect({ speedMph: 10, fromDeg: 0 }, 0, 150, cfg);
  const tail = windEffect({ speedMph: 10, fromDeg: 180 }, 0, 150, cfg);
  const cross = windEffect({ speedMph: 10, fromDeg: 90 }, 0, 150, cfg);
  assert.ok(Math.abs(head.alongYds - 15) < 1e-9 && head.relative === "into");
  assert.ok(Math.abs(tail.alongYds + 7.5) < 1e-9 && tail.relative === "down");
  assert.ok(cross.crossYds < 0 && Math.abs(cross.alongYds) < 1e-9 && cross.relative === "cross-from-right");
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
    assert.ok(r.aggressive.expScore >= r.safe.expScore - 1e-9);
  }
  assert.ok(seen >= 1, "at least one fixture produced two options");
});

test("T3 lie club-up: 174 plays-like from the fairway → 7-iron; from the rough → one more club", () => {
  // A bunker across the front of the green: coming up short costs, so the club that plays the number wins.
  const hole = { ...openPar5, id: "guarded-approach", green: { ring: ellipse(0, 540, 12, 12, 32), center: { x: 0, y: 540 } },
    hazards: [{ type: "sand", ring: rect(-14, 520, 14, 527) }] };
  const ball = { x: 0, y: openPar5.yards - 174 };
  const fw = recommend({ shotNo: 2, ball, lieType: "fairway" }, hole, P);
  const ro = recommend({ shotNo: 2, ball, lieType: "rough" }, hole, P);
  assert.equal(fw.context.distances.pin, 174);
  assert.equal(fw.safe.club, "7i", `fairway → ${fw.safe.club}`);
  assert.equal(ro.safe.club, "6i", `rough → ${ro.safe.club}`);
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
