/*
 * trail.test.js — the breadcrumb trail's pure model (docs/SPEC-shotlog-v2.md §10): thinning, stop
 * detection on a synthetic walk (T50 of §10 — not strategy.test.js's T50), matching against
 * recorded starts, candidates. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { appendPoint, stopsFrom, matchStops, candidates, candidateFor, distM } from "./trail.js";

const LAT0 = 34.25, LNG0 = -83.85;
const M_PER_DEG_LAT = 111320;
/** A fix `north` metres up and `east` metres across from the origin at time `sec`. */
const at = (sec, north, east = 0, acc = 4) => ({
  t: Date.UTC(2026, 9, 4, 14, 0, 0) + sec * 1000,
  lat: LAT0 + north / M_PER_DEG_LAT,
  lng: LNG0 + east / (M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180)),
  acc,
});

/** Walk north at 1.3 m/s with a GPS fix every second, pausing `pauses` = [[atMetre, seconds]]. */
function walk(totalM, pauses, jitter = 0.8) {
  const fixes = [];
  let sec = 0, m = 0, k = 0;
  const pending = [...pauses];
  while (m <= totalM) {
    const j = jitter * Math.sin(k++ * 1.7);
    fixes.push(at(sec, m + j, j / 2));
    if (pending.length && m >= pending[0][0]) {
      const [, wait] = pending.shift();
      for (let s = 1; s <= wait; s++) fixes.push(at(sec + s, m + jitter * Math.sin(k++ * 2.3), jitter * Math.cos(k * 1.1)));
      sec += wait;
    }
    sec += 1; m += 1.3;
  }
  return fixes;
}

test("trail thinning: a point is kept ≥ 3 m or ≥ 10 s after the last one; old or broken fixes are dropped; never mutates", () => {
  let pts = [];
  pts = appendPoint(pts, at(0, 0));
  assert.equal(pts.length, 1);
  const same = appendPoint(pts, at(4, 1));                // 1 m, 4 s → thinned
  assert.equal(same, pts, "unchanged reference when thinned");
  pts = appendPoint(pts, at(5, 3.2));                     // 3.2 m → kept
  assert.equal(pts.length, 2);
  pts = appendPoint(pts, at(15, 3.5));                    // 0.3 m but 10 s → kept
  assert.equal(pts.length, 3);
  assert.equal(appendPoint(pts, at(1, 50)), pts, "older than the last point");
  assert.equal(appendPoint(pts, { t: at(30, 0).t, lat: NaN, lng: 1 }), pts);
  assert.equal(appendPoint(pts, null), pts);
  // lon / accuracyM spellings are accepted
  const alt = appendPoint([], { t: 1, lat: 34, lon: -84, accuracyM: 6 });
  assert.deepEqual(alt, [{ t: 1, lat: 34, lng: -84, acc: 6 }]);
  // a 1 Hz walk keeps roughly every third second; standing still keeps one every 10 s
  let w = [];
  for (let s = 0; s < 60; s++) w = appendPoint(w, at(s, s * 1.3));
  assert.ok(w.length >= 20 && w.length <= 30, `${w.length} points for 78 m`);
  let still = [];
  for (let s = 0; s <= 60; s++) still = appendPoint(still, at(s, 0.5 * Math.sin(s)));
  assert.equal(still.length, 7, "0, 10, …, 60 s");
});

test("trail cap: at most 600 points per hole, the oldest dropped", () => {
  let pts = [];
  for (let i = 0; i < 700; i++) pts = appendPoint(pts, at(i * 10, i * 5));
  assert.equal(pts.length, DEFAULT_CONFIG.TRAIL_STOP.maxPoints);
  assert.equal(pts[0].t, at(1000, 0).t, "the first 100 went");
  const small = mergeConfig({ TRAIL_STOP: { maxPoints: 5 } });
  let s = [];
  for (let i = 0; i < 9; i++) s = appendPoint(s, at(i * 10, i * 5), small);
  assert.equal(s.length, 5);
});

test("T50 trail stops: a synthetic walk with two pauses gives two stops at the pauses", () => {
  let pts = [];
  for (const f of walk(300, [[60, 25], [190, 40]])) pts = appendPoint(pts, f);
  const stops = stopsFrom(pts);
  assert.equal(stops.length, 2, JSON.stringify(stops.map((s) => [s.n, (s.t1 - s.t0) / 1000])));
  const north = (s) => (s.lat - LAT0) * M_PER_DEG_LAT;
  assert.ok(Math.abs(north(stops[0]) - 60) < 5, `first stop at ${north(stops[0]).toFixed(1)} m`);
  assert.ok(Math.abs(north(stops[1]) - 190) < 5, `second stop at ${north(stops[1]).toFixed(1)} m`);
  for (const s of stops) {
    assert.ok((s.t1 - s.t0) / 1000 >= DEFAULT_CONFIG.TRAIL_STOP.minSec);
    assert.ok(s.n >= 2);
    assert.equal(s.acc, 4, "the best accuracy of the run");
    assert.deepEqual(Object.keys(s).sort(), ["acc", "lat", "lng", "n", "t0", "t1"]);
  }
  // a pause shorter than 15 s is not a stop; walking alone gives none
  let quick = [];
  for (const f of walk(200, [[100, 8]])) quick = appendPoint(quick, f);
  assert.equal(stopsFrom(quick).length, 0);
  assert.deepEqual(stopsFrom([]), []);
  // tunable
  assert.equal(stopsFrom(quick, mergeConfig({ TRAIL_STOP: { minSec: 5 } })).length, 1);
});

test("trail matching: a stop within 8 yds of a recorded shot's start is that shot; the rest are candidates", () => {
  let pts = [];
  for (const f of walk(300, [[0, 30], [60, 25], [190, 40]])) pts = appendPoint(pts, f);
  const stops = stopsFrom(pts);
  assert.equal(stops.length, 3);
  const tee = at(0, 1, 0.5), second = at(0, 64);       // the tee fix 1 m off; shot 2 logged 4 m up from the stop (≈ 4.4 yds)
  const shots = [
    { hole: 1, shotNo: 1, start: { lat: tee.lat, lng: tee.lng } },
    { hole: 1, shotNo: 2, start: { lat: second.lat, lng: second.lng } },
    { hole: 1, shotNo: 3, start: { lat: null, lng: null } },
  ];
  const m = matchStops(stops, shots);
  assert.deepEqual(m.map((s) => [s.matched, s.shotNo]), [[true, 1], [true, 2], [false, null]]);
  assert.ok(m[1].distYds <= 8);
  const c = candidates(stops, shots);
  assert.equal(c.length, 1);
  assert.ok(Math.abs((c[0].lat - LAT0) * M_PER_DEG_LAT - 190) < 5);
  // shot 3 has no start: the candidate would place shot 3
  assert.equal(candidateFor(c[0], shots).shotNo, 3);
  assert.equal(candidateFor(c[0], shots.slice(0, 2)).shotNo, 3, "every shot placed → the next one");
  assert.equal(candidateFor(c[0], []).shotNo, 1);
  assert.equal(candidateFor(c[0], [{ shotNo: 1, start: null, placed: true }, { shotNo: 2, start: null }]).shotNo, 2, "a hand-placed shot is not open");
  // 9 yds away is not a match; each shot claims one stop only
  const far = at(0, 60 + 9 * 0.9144 + 0.5);
  assert.equal(matchStops([stops[1]], [{ shotNo: 2, start: { lat: far.lat, lng: far.lng } }])[0].matched, false);
  const twin = matchStops([stops[1], { ...stops[1], t0: stops[1].t0 + 1 }], [shots[1]]);
  assert.deepEqual(twin.map((s) => s.matched), [true, false]);
  assert.ok(Math.abs(distM(at(0, 0), at(0, 100)) - 100) < 0.5);
});
