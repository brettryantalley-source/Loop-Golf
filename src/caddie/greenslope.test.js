/*
 * greenslope.test.js — v22.60 (R10, D131): green reading from USGS lidar (greenslope.js) and the bundled
 * 2 m grids over every green of the five mapped clubs (scripts/fetch-green-slopes.mjs).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { gridForGreen, slopeArrows, puttRead, readText } from "./greenslope.js";
import { holeFrame, buildHole, frameOf } from "./geo.js";
import { ellipse } from "./course.js";
import { greenGrids, localGeometryFor } from "../localGeometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const M_PER_DEG = 111320;

/**
 * A synthetic green: a 2 m grid round a hole frame's point (0, 100), the ground a plane falling `pct`% toward
 * compass bearing `fallDeg`, plus optional noise. The frame runs due north, so frame +y is north.
 */
function plane({ pct = 2, fallDeg = 90, noiseM = 0, seed = 7 } = {}) {
  const F = holeFrame({ origin: { lat: 34.2, lon: -84.4 }, bearingDeg: 0 });
  const c = F.toLatLng({ x: 0, y: 100 });
  const mLon = M_PER_DEG * Math.cos((c.lat * Math.PI) / 180);
  const fall = { e: Math.sin((fallDeg * Math.PI) / 180), n: Math.cos((fallDeg * Math.PI) / 180) };
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const cells = [];
  for (let j = 0; j < 21; j++) for (let i = 0; i < 21; i++) {
    const e = (i - 10) * 2, n = (j - 10) * 2;
    cells.push({ i, j, lat: c.lat + n / M_PER_DEG, lon: c.lon + e / mLon, z: 30 - (pct / 100) * (e * fall.e + n * fall.n) + noiseM * rnd() });
  }
  const hole = { green: { center: { x: 0, y: 100 }, ring: ellipse(0, 100, 15, 15, 32) } };
  return { F, hole, grid: { c: [c.lat, c.lon], stepM: 2, cells } };
}

test("R10: the arrows point downhill at the green's own slope, in the hole's frame", () => {
  const east = plane({ pct: 2, fallDeg: 90 });
  const a = slopeArrows(east.grid, east.hole, east.F);
  assert.ok(a.length > 10, `${a.length} arrows`);
  for (const r of a) {
    assert.ok(Math.abs(r.pct - 2) < 0.15, `pct ${r.pct}`);
    assert.ok(Math.abs(r.dirDeg - 90) <= 2, `falls to the right of the hole: ${r.dirDeg}`);
  }
  const south = slopeArrows(plane({ pct: 3, fallDeg: 180 }).grid, east.hole, east.F);
  assert.ok(south.every((r) => Math.abs(r.dirDeg - 180) <= 2), "falls back toward the tee");
  assert.equal(slopeArrows(plane({ pct: 0.2 }).grid, east.hole, east.F).length, 0, "under 0.5%: no arrows");
  // inside the ring only, one every 2 cells
  assert.ok(a.every((r) => Math.hypot(r.x, r.y - 100) <= 15.5));
});

test("R10: the plane is fitted over 8 m, so lidar's few centimetres of noise don't turn into a slope", () => {
  const noisy = plane({ pct: 1.5, fallDeg: 45, noiseM: 0.06 });
  const a = slopeArrows(noisy.grid, noisy.hole, noisy.F);
  const pcts = a.map((r) => r.pct);
  assert.ok(Math.max(...pcts) - Math.min(...pcts) < 1, `range ${Math.min(...pcts)}–${Math.max(...pcts)}`);
  assert.ok(a.every((r) => Math.abs(r.dirDeg - 45) < 25), "and the direction holds");
});

test("R10: the putt read — uphill or downhill toward the hole, and which way it breaks", () => {
  const { F, grid } = plane({ pct: 2, fallDeg: 90 });     // falls to the right as you look up the hole
  const ball = { x: 0, y: 92 }, pin = { x: 0, y: 106 };   // putting up the hole
  const r = puttRead(grid, F, ball, pin);
  assert.ok(Math.abs(r.alongPct) < 0.3, `level along the line: ${r.alongPct}`);
  assert.ok(r.acrossPct < -1.8, "the ground falls to the right");
  assert.equal(r.text, "Level · breaks left to right 2.0%");
  const up = puttRead(plane({ pct: 1.5, fallDeg: 180 }).grid, F, ball, pin);
  assert.equal(up.text, "Uphill 1.5% · straight");
  const down = puttRead(plane({ pct: 1.5, fallDeg: 180 }).grid, F, pin, ball);
  assert.equal(down.text, "Downhill 1.5% · straight");
  const rl = puttRead(plane({ pct: 1, fallDeg: 270 }).grid, F, ball, pin);
  assert.match(rl.text, /breaks right to left 1\.0%/);
  assert.equal(puttRead(grid, F, ball, ball), null, "no line, no read");
  assert.equal(readText(0.1, -0.2), "Level · straight");
});

test("R10: every green on the five mapped clubs has a lidar grid, and every hole finds its own", () => {
  for (const club of ["woodmont", "chicopee", "riverpines", "hampton", "bradshaw", "creekside"]) {
    const data = JSON.parse(readFileSync(join(here, "../localGeometry", `${club}.json`), "utf8"));
    const grids = greenGrids(data);
    const greens = data.ways.filter((w) => w.tags?.golf === "green").length;
    assert.equal(grids.length, greens, `${club}: a grid per green`);
    assert.ok(grids.every((g) => g.cells.length >= 40), `${club}: no empty grid`);
    const geo = localGeometryFor([data], data.apiId).geometry;
    let found = 0, holes = 0;
    for (const k of Object.keys(geo.holes)) {
      const h = buildHole(geo, k, { par: Number(geo.holes[k].par) || 4 });
      if (!h) continue;
      holes++;
      const g = gridForGreen(grids, h, frameOf(h));
      if (g) found++;
    }
    assert.equal(found, holes, `${club}: ${found} of ${holes} holes`);
  }
});

test("R10: a real green (Bradshaw Red 2, tiered) reads like a green — most arrows under 5%, a tier's face under 10%, a read of the putt", () => {
  const data = JSON.parse(readFileSync(join(here, "../localGeometry/bradshaw.json"), "utf8"));
  const geo = localGeometryFor([data], data.apiId).geometry;
  const h = buildHole(geo, "2", { par: 5 });
  const F = frameOf(h);
  const g = gridForGreen(greenGrids(data), h, F);
  const a = slopeArrows(g, h, F);
  assert.ok(a.length >= 8, `${a.length} arrows`);
  const sorted = a.map((r) => r.pct).sort((x, y) => x - y);
  assert.ok(sorted[0] >= 0.5 && sorted[sorted.length - 1] < 10, sorted.join(" "));
  assert.ok(sorted[Math.floor(sorted.length / 2)] < 5, `median ${sorted[Math.floor(sorted.length / 2)]}`);
  const c = h.green.center;
  const r = puttRead(g, F, { x: c.x - 6, y: c.y - 6 }, { x: c.x + 3, y: c.y + 3 }, h.green.ring);
  assert.ok(r && /^(Level|Uphill|Downhill)/.test(r.text), r?.text);
});
