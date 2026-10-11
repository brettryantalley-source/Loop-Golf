/*
 * best80.test.js — v22.46 (C36, D117): the caddie and the map leave out Brett's worst shots.
 * Brett, Oct 11 (Bradshaw; the PW and 4-hybrid rings "too wide"): the ring shows where he might really
 * hit it — within 10 yds of the club's average and his best 65% side to side — and "my worst 20% of
 * shots should be completely ignored by the caddy" and left off the map. The dots show every draw the
 * caddie keeps. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { generateCandidates, simulateCandidate, normalizeContext, keptDraws, landingDots, recommend } from "./engine.js";
import { makeSamples } from "./random.js";
import { goodRingFromEntry, ellipseFromEntry, withEllipses, bandZ } from "./overlay.js";
import { ellipseSampler } from "./engine.js";
import { waterRightPar4, openPar5 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const P0 = loadProfile(RAW, mergeConfig({ DROP_WORST_PCT: 0 }));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("C36: keptDraws drops the 20% farthest from the median draw and keeps draw order", () => {
  const along = [100, 101, 99, 140, 100, 60, 102, 98, 100, 101], lat = [0, 1, -1, 0, 30, 0, 2, -2, 0, 0];
  const kept = keptDraws(along, lat, 0.2);
  assert.equal(kept.length, 8, "10 draws, 2 dropped");
  assert.ok(!kept.includes(3) && !kept.includes(5), "the 40-long and 40-short draws go first");
  assert.ok(kept.includes(4), "30 across is closer than 40 along");
  assert.deepEqual(kept, [...kept].sort((a, b) => a - b), "draw order");
  assert.deepEqual(keptDraws(along, lat, 0), along.map((_, i) => i), "0 keeps them all");
  assert.equal(keptDraws(new Float64Array(500), new Float64Array(500), DEFAULT_CONFIG.DROP_WORST_PCT).length, 400);
  assert.equal(DEFAULT_CONFIG.DROP_WORST_PCT, 0.2, "Brett's 20%");
});

test("C36: the caddie prices exactly the draws it keeps, each as before", () => {
  // the Driver off a tee with water right: its mishits (43% from the printed ring) and big misses are in play
  const ctx = normalizeContext({ shotNo: 1, par: 4, ball: { x: 0, y: 0 }, lieType: "tee" }, waterRightPar4);
  const c = generateCandidates(ctx, waterRightPar4, P).find((x) => x.club === "Dr");
  assert.ok(c, "a driver candidate");
  const S = makeSamples(500, 7);
  const all = [], kept = [];
  simulateCandidate(c, ctx, waterRightPar4, P0, S, all);
  const cut = simulateCandidate(c, ctx, waterRightPar4, P, S, kept);
  assert.equal(all.length, 500); assert.equal(kept.length, 400);
  // the same 400 samples priced with nothing dropped give the same answer
  const idx = [];
  for (const p of kept) idx.push(all.findIndex((q) => q.x === p.x && q.y === p.y));
  assert.equal(new Set(idx).size, 400, "every kept finish is one of the full run's");
  const same = simulateCandidate(c, ctx, waterRightPar4, P0, idx.map((i) => S[i]));
  for (const k of ["expScore", "parProb", "birdieProb", "doubleProb", "troubleRate", "meanLatYds"]) near(cut[k], same[k], 1e-12, k);
  // and leaving out the worst 20% cuts the trouble
  const full = simulateCandidate(c, ctx, waterRightPar4, P0, S);
  assert.ok(cut.troubleRate < full.troubleRate, `trouble ${cut.troubleRate} < ${full.troubleRate}`);
  assert.ok(cut.parProb > full.parProb, `par ${cut.parProb} > ${full.parProb}`);
});

test("C36: the dropped draws are the ones farthest from where the shot finishes on average", () => {
  const ctx = normalizeContext({ shotNo: 2, par: 4, ball: { x: 0, y: 260 }, lieType: "fairway" }, waterRightPar4);
  const c = generateCandidates(ctx, waterRightPar4, P).find((x) => x.club === "GW" || x.club === "PW");
  const S = makeSamples(500, 3);
  const all = [], kept = [];
  simulateCandidate(c, ctx, waterRightPar4, P0, S, all);
  simulateCandidate(c, ctx, waterRightPar4, P, S, kept);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return (s[249] + s[250]) / 2; };
  const m = { x: med(all.map((p) => p.x)), y: med(all.map((p) => p.y)) };
  const d = (p) => Math.hypot(p.x - m.x, p.y - m.y);
  const keptSet = new Set(kept.map((p) => `${p.x},${p.y}`));
  const dropped = all.filter((p) => !keptSet.has(`${p.x},${p.y}`));
  assert.equal(dropped.length, 100);
  // measured on the flight, before roll; the finishes keep the order within a few yards of roll
  assert.ok(Math.min(...dropped.map(d)) >= Math.max(...kept.map(d)) - 8, "every dropped finish is about as far out as the farthest kept one, or farther");
});

test("C36: the dots are the draws the caddie keeps — still RING_DOTS of them", () => {
  const ctx = { shotNo: 2, par: 5, ball: { x: 0, y: 300 }, lieType: "fairway" };
  const r = recommend(ctx, openPar5, P);
  const dots = landingDots(ctx, openPar5, P, r.safe);
  assert.equal(dots.length, DEFAULT_CONFIG.RING_DOTS);
  assert.deepEqual(landingDots(ctx, openPar5, P, r.safe), dots, "same seed, same dots");
  assert.equal(landingDots(ctx, openPar5, P0, r.safe).length, DEFAULT_CONFIG.RING_DOTS, "with nothing dropped, 40 drawn and 40 shown");
});

test("C36: the drawn ring is 20 yds deep and as wide as his best 65% side to side, square to the line", () => {
  const pw = resolveEntry(P, "PW", "full", "fairway");
  const ring = goodRingFromEntry(pw);
  near(ring.w, pw.ell80.ringWYds, 1e-9, "PW width = the measured band");
  near(ring.w, 15.5, 0.05, "PW 15.5 across (was Shot Pattern's 59-yd tilted ring)");
  assert.equal(ring.h, 2 * DEFAULT_CONFIG.RING_GOOD_YDS); assert.equal(ring.h, 20);
  assert.equal(ring.tiltDeg, 0);
  const base = ellipseFromEntry(pw);
  assert.equal(ring.dx, base.dx); assert.equal(ring.dy, base.dy); assert.equal(ring.source, "shotPattern"); assert.equal(ring.innerFrac, base.innerFrac);
  // the 4-hybrid from the fairway reads its tee ring (D113): 48 across, not 91
  const hy = goodRingFromEntry(resolveEntry(P, "4Hy", "full", "fairway"));
  near(hy.w, 48, 0.05, "4Hy"); assert.equal(hy.h, 20);
  // a bad lie widens both and sits 5 short, as the draws do
  const bad = goodRingFromEntry(pw, { lieQuality: "bad" });
  near(bad.w, ring.w * 1.15, 1e-9, "bad w"); near(bad.h, 23, 1e-9, "bad h"); near(bad.dy - ring.dy, 5, 1e-9, "bad dy");
  // every club Shot Pattern measured carries a band
  for (const [club, lie] of [["Dr", "tee"], ["2i", "tee"], ["2Hy", "tee"], ["4Hy", "tee"], ["5i", "fairway"], ["6i", "fairway"], ["7i", "fairway"], ["8i", "fairway"], ["9i", "fairway"], ["GW", "fairway"]]) {
    const e = resolveEntry(P, club, "full", lie);
    assert.ok(e.ell80?.ringWYds > 0 && e.ell80.ringDots >= 5, `${club} ${lie} ring width`);
    assert.ok(goodRingFromEntry(e).w < Math.max(e.ell80.wYds, e.ell80.hYds), `${club}: narrower than the 80% ring's long axis`);
  }
});

test("C36: the map draws the good-shot ring", () => {
  const e = resolveEntry(P, "PW", "full", "fairway");
  const opts = withEllipses({ safe: { club: "PW", swingType: "full" }, sameShot: true }, () => e);
  assert.equal(opts.safe.ell.w, goodRingFromEntry(e).w);
  assert.equal(opts.safe.ell.h, 20);
});

test("C36: a ring with no measured band takes the 65% band of its own spread across the line", () => {
  near(bandZ(0.65), 0.9346, 1e-4, "Φ⁻¹(0.825)");
  near(bandZ(0.6827), 1, 1e-3, "±1σ holds 68.3%");
  // an ell80 with no ringWYds (Loop's own after takeover): 65% of its draws fall inside the band
  const ell80 = { wYds: 40, hYds: 20, tiltDeg: 30, dxYds: 0, dyYds: 0 };
  const ring = goodRingFromEntry({ ell80, carry: 150, lateralSdDeg: 3 });
  const sample = ellipseSampler(ell80, 1);
  let inside = 0;
  const S = makeSamples(20000, 5);
  for (const z of S) if (Math.abs(sample(z.z1, z.z2).lat) <= ring.w / 2) inside++;
  near(inside / S.length, 0.65, 0.01, "share inside the band");
  // no ell80: from σ_lat, capped
  const sig = { carry: 150, lateralSdDeg: 4, distSd: 8, biasLat: 0, biasDist: 0 };
  const s = goodRingFromEntry(sig, { config: { ...DEFAULT_CONFIG, RING_DRAW_CAP_YDS: Infinity } });
  near(s.w, 2 * bandZ(0.65) * 150 * Math.tan(4 * Math.PI / 180), 1e-9, "σ band"); assert.equal(s.h, 20); assert.equal(s.tiltDeg, 0);
  assert.equal(goodRingFromEntry({ ...sig, lateralSdDeg: 30 }).w, DEFAULT_CONFIG.RING_DRAW_CAP_YDS, "capped");
});
