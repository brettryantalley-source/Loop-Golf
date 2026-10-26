/*
 * elevation.test.js — v22.45 (C34, D116): each shot's own rise, the bundled USGS 3DEP grid, and a
 * share of the forecast wind.
 * Brett, Bradshaw Oct 11: "the distances still seem really off". Every shot paid the ball → pin
 * rise (Red 2's 19 yds, all of it in the last 200, charged to the tee shot); Open-Meteo's ~90 m
 * elevation read up to 6 m off the lidar; the forecast wind is open-field wind 10 m up.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile } from "./profile.js";
import { recommend, playsLike, normalizeContext, elevAt, generateCandidates, riseToTarget } from "./engine.js";
import { riseText } from "./caddieState.js";
import { assembleShotContext } from "./context.js";
import { interpolateElevation } from "./sensors.js";
import { buildHole, frameOf } from "./geo.js";
import { localGeometryFor, elevationSamples } from "../localGeometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const read = (n) => JSON.parse(readFileSync(join(here, "../localGeometry", `${n}.json`), "utf8"));
const bradshaw = read("bradshaw");
const L = localGeometryFor([bradshaw], "xs7ypdb7");
const red2 = buildHole(L.geometry, 2, { par: 5 });

/** Red 2 from `ball` (hole frame), the way the app assembles it: the bundled grid as the samples. */
function red2Ctx(ball, o = {}) {
  const F = frameOf(red2), q = F.toLatLng(ball);
  return assembleShotContext({ round: { hole: 2, par: 5, shotNo: 1, trigger: "tee" }, hole: red2, geometry: L.geometry,
    fix: { lat: q.lat, lng: q.lon, accuracyM: 3 }, elevation: L.elevation, ...o });
}
const along = (yds) => {
  const T = red2.tee, G = red2.green.center, D = Math.hypot(G.x - T.x, G.y - T.y);
  return { x: T.x + (G.x - T.x) * yds / D, y: T.y + (G.y - T.y) * yds / D };
};

test("C34: the five bundled maps carry a 3DEP grid; Bradshaw's reads the lidar at Red 2's tee and green", () => {
  for (const n of ["woodmont", "chicopee", "riverpines", "hampton", "bradshaw", "creekside", "bobbyjones"]) {
    const s = elevationSamples(read(n));
    assert.ok(s && s.length > (n === "bobbyjones" ? 900 : 1500), `${n}: ${s?.length} samples`);   // Bobby Jones: a nine, 1,097 cells
    assert.ok(s.every((p) => Number.isFinite(p.elevM) && p.elevM > 200 && p.elevM < 500), `${n}: metres above sea level, north Georgia`);
  }
  assert.equal(L.elevation, elevationSamples(bradshaw), "expanded once, then reused");
  // USGS 3DEP point queries, Oct 11: Red 2's back tee 275.9 m, its green 293.2 m
  assert.ok(Math.abs(interpolateElevation(L.elevation, { lat: 34.1593, lon: -84.44707 }) - 275.9) < 1);
  assert.ok(Math.abs(interpolateElevation(L.elevation, { lat: 34.15995, lon: -84.44233 }) - 293.2) < 1);
  assert.equal(elevationSamples({ ways: [] }), null);
});

test("C34: each shot rises to its own landing spot — Red 2's 19 yds is the green's, not the tee shot's", () => {
  const ctx = red2Ctx(red2.tee);
  assert.ok(ctx.elevPts && ctx.elevPts.length > 100, "the samples near the hole, in its frame");
  assert.ok(ctx.elevationDeltaYds > 16 && ctx.elevationDeltaYds < 22, `the pin is ${ctx.elevationDeltaYds} yds up`);
  const n = normalizeContext(ctx, red2);
  const rise = (yds) => playsLike(yds, 0, n, DEFAULT_CONFIG, "long", along(yds)).riseYds;
  assert.ok(Math.abs(rise(250)) < 3, `the driver's landing spot is level with the tee (${rise(250).toFixed(1)})`);
  assert.ok(Math.abs(playsLike(483, 0, n, DEFAULT_CONFIG, undefined, red2.green.center).riseYds - ctx.elevationDeltaYds) < 1.5, "the green's rise matches context.js");
  assert.equal(playsLike(250, 0, n, DEFAULT_CONFIG).riseYds, ctx.elevationDeltaYds, "no target → the pin's, as before");
  // the driver's fairway target is no longer pulled ~19 yds short by the green's climb
  const drive = (c) => {
    const k = normalizeContext(c, red2);
    const d = generateCandidates(k, red2, P).find((x) => x.club === "Dr" && x.kind === "corridor" && /, center$/.test(x.label));
    return Math.hypot(d.target.x - k.ball.x, d.target.y - k.ball.y);
  };
  const now = drive(ctx), before = drive({ ...ctx, elevPts: null });
  assert.ok(now > before + 12, `the driver's target ${before.toFixed(0)} → ${now.toFixed(0)}`);
  assert.ok(recommend(ctx, red2, P).safe, "still a call");
});

test("C34: Brett's Elevation chip is the rise for every shot (no samples handed on)", () => {
  const ctx = red2Ctx(red2.tee, { chips: { elevation: 5 } });
  assert.equal(ctx.elevPts, null);
  assert.equal(ctx.elevationDeltaYds, 5);
  const n = normalizeContext(ctx, red2);
  assert.equal(playsLike(200, 0, n, DEFAULT_CONFIG, "mid", along(200)).riseYds, 5);
});

test("C34: elevAt — inverse distance over the four nearest, exact on a sample", () => {
  const pts = [{ x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 20 }, { x: 0, y: 10, z: 30 }, { x: 10, y: 10, z: 40 }, { x: 100, y: 100, z: 999 }];
  assert.equal(elevAt(pts, { x: 0, y: 0 }), 10);
  assert.ok(Math.abs(elevAt(pts, { x: 5, y: 5 }) - 25) < 1e-9, "the middle of four equal-distance samples is their mean");
  assert.equal(elevAt([], { x: 0, y: 0 }), null);
});

test("C34: two-thirds of the forecast wind; Brett's Wind chip counts in full", () => {
  const weather = { speedMph: 12, dirDeg: red2.bearingDeg, tempF: 64, rainMm24h: 0, asOf: Date.now(), stale: false };
  assert.equal(DEFAULT_CONFIG.FORECAST_WIND_SHARE, 0.67);
  const ctx = red2Ctx(red2.tee, { weather });
  assert.equal(ctx.wind.speedMph, 8, "12 mph forecast → 8");
  assert.ok(Math.abs(ctx.wind.fromDeg) < 1e-6 || Math.abs(ctx.wind.fromDeg - 360) < 1e-6, "still straight into the face");
  const full = red2Ctx(red2.tee, { weather, config: mergeConfig({ FORECAST_WIND_SHARE: 1 }) });
  assert.equal(full.wind.speedMph, 12, "the knob");
  const chip = red2Ctx(red2.tee, { weather, chips: { wind: { direction: "Into", speed: 12 } } });
  assert.equal(chip.wind.speedMph, 12, "his own reading is not scaled");
});

/* ---------- v22.53 (C44, D124): the climb to the target, shown ---------- */

test("C44: the screen's rise is the one Plays counts for that shot; worded up / down / level", () => {
  const hole = { id: "flat", par: 4, tee: { x: 0, y: 0 }, green: { center: { x: 0, y: 400 }, ring: [{ x: -10, y: 390 }, { x: 10, y: 390 }, { x: 10, y: 410 }, { x: -10, y: 410 }] }, hazards: [], fairways: [] };
  // samples: the ground climbs 1 yd every 20 yds up the hole
  const elevPts = [];
  for (let y = -40; y <= 440; y += 20) for (const x of [-40, 0, 40]) elevPts.push({ x, y, z: y / 20 });
  const ctx = { shotNo: 2, par: 4, ball: { x: 0, y: 100 }, lieType: "fairway", elevPts };
  const r = riseToTarget(ctx, hole, { x: 0, y: 260 });
  assert.ok(Math.abs(r - 8) < 0.5, `rise ${r}`);
  assert.equal(riseToTarget(ctx, hole, null), null);
  assert.equal(riseText(8.2), "8 yds up");
  assert.equal(riseText(-4.6), "5 yds down");
  assert.equal(riseText(0.4), "level");
  assert.equal(riseText(null), null);
});
