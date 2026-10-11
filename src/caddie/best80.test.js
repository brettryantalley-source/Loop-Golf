/*
 * best80.test.js — v22.46 (C36, D117): the caddie and the map leave out Brett's worst shots.
 * Brett, Oct 11 (Bradshaw; the PW and 4-hybrid rings "too wide"): the ring shows where he might really
 * hit it — within 10 yds of the club's average and his best 65% side to side — and "my worst 20% of
 * shots should be completely ignored by the caddy" and left off the map. The dots show every draw the
 * caddie keeps. Run: npm test
 * C45 (v22.55, D126): the map no longer draws the good-shot ring; its tests went with it (the drawn
 * rings and dots are pattern.test.js's). The caddie still drops its worst 20%.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile } from "./profile.js";
import { generateCandidates, simulateCandidate, normalizeContext, keptDraws, landingDots, recommend } from "./engine.js";
import { makeSamples } from "./random.js";
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

