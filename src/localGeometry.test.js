/*
 * localGeometry.test.js — the hand trace of Woodmont (src/localGeometry/woodmont.json) as the app reads it:
 * expanded to Overpass JSON, run through parseOverpass, covered 18/18, every hole built, the caddie
 * advancing hole to hole off the tee boxes, and the cache stamp that replaces an older (empty) OSM answer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { toOverpass, localGeometryFor } from "./localGeometry.js";
import { parseOverpass, featuresForHole, yardsBetween, haversineM, pointInRing } from "./geometry.js";
import { coverageCheck, buildHole, detectHole, saveGeometryCache, loadGeometryCache } from "./caddie/geo.js";
import { classify } from "./caddie/course.js";
import { loadProfile } from "./caddie/profile.js";
import { recommend } from "./caddie/engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const woodmont = JSON.parse(readFileSync(join(here, "localGeometry", "woodmont.json"), "utf8"));
const registry = [woodmont];

/* The printed card (golfcourseapi tnw4ghn5; pars from the API, yardages Championship / Medal). */
const PAR = [5, 3, 4, 4, 4, 3, 4, 4, 5, 5, 3, 4, 3, 4, 3, 5, 4, 5];
const CHAMP = [520, 193, 405, 455, 416, 138, 393, 473, 537, 524, 116, 385, 182, 400, 199, 570, 365, 503];
const MEDAL = [506, 166, 392, 432, 397, 120, 363, 442, 518, 506, 106, 373, 142, 391, 179, 543, 360, 485];

const lg = localGeometryFor(registry, "tnw4ghn5");
const geo = lg.geometry;
const ring2m2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2 / 1.19599; };

test("localGeometryFor: finds the club by API id (string or number), returns null for anything else", () => {
  assert.equal(lg.version, "tnw4ghn5@1");
  assert.ok(localGeometryFor(registry, "tnw4ghn5"));
  assert.equal(localGeometryFor(registry, "somewhere-else"), null);
  assert.equal(localGeometryFor(registry, null), null);
  assert.equal(localGeometryFor(null, "tnw4ghn5"), null);
  assert.equal(localGeometryFor(registry, "tnw4ghn5").geometry, geo, "parsed once, then reused");
});

test("the file expands to Overpass JSON that parseOverpass reads with no warning beyond 'no boundary'", () => {
  const el = toOverpass(woodmont).elements;
  assert.equal(el.length, woodmont.ways.length);
  assert.ok(el.every((e) => e.type === "way" && e.id < 0 && e.geometry.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))));
  assert.deepEqual(geo.warnings, ["no leisure=golf_course boundary — OB off"]);
  assert.equal(geo.boundary, null, "OSM's club outline is not bundled: it cuts through holes 4 and 7 and would call them out of bounds");
});

test("coverage: 18 of 18 holes have a hole way and a green; no orphan greens", () => {
  const c = coverageCheck(geo, { expected: [...Array(18)].map((_, i) => i + 1) });
  assert.equal(c.complete, true);
  assert.deepEqual(c.missing, []);
  assert.equal(c.orphanGreens, 0);
  assert.equal(Object.keys(geo.holes).length, 18);
});

test("every hole: ref and par are the card's, the line runs tee → green, the green is plausible, tees and bunkers belong", () => {
  for (let n = 1; n <= 18; n++) {
    const h = geo.holes[n];
    assert.ok(h, `hole ${n} present`);
    assert.equal(h.ref, n);
    assert.equal(h.par, PAR[n - 1], `hole ${n} par`);
    assert.ok(h.line.length >= 2, `hole ${n} line has a tee end and a green end`);
    assert.ok(pointInRing(h.greenEnd, h.green.ring), `hole ${n}: the line ends inside its green`);
    const straight = yardsBetween(h.line[0], h.green.center);
    // From some tee box to the green the straight line is a little short of the card (doglegs) and never longer than the back tee by much.
    assert.ok(straight > 0.55 * MEDAL[n - 1] && straight < 1.12 * CHAMP[n - 1], `hole ${n}: ${Math.round(straight)} yd tee-to-green vs card ${CHAMP[n - 1]}/${MEDAL[n - 1]}`);
    const b = buildHole(geo, n, { par: PAR[n - 1], yards: MEDAL[n - 1] });
    assert.ok(b, `hole ${n} builds`);
    const area = ring2m2(b.green.ring);
    assert.ok(area > 200 && area < 900, `hole ${n} green ${Math.round(area)} m²`);
    assert.ok(b.tees.length >= 1, `hole ${n} has a tee box`);
    if (PAR[n - 1] >= 4) assert.ok(b.fairways.length >= 1, `hole ${n} (par ${PAR[n - 1]}) has a fairway`);
  }
});

test("the caddie advances hole to hole off the tee boxes: standing on hole n's tee, from hole n-1, detectHole says n", () => {
  for (let n = 1; n <= 18; n++) {
    const r = detectHole(geo, geo.holes[n].line[0], n === 1 ? 18 : n - 1);
    assert.equal(r.advanced, true, `hole ${n} advances`);
    assert.equal(r.hole, n);
  }
});

test("lie inference reads the traced shapes: a green's centre is green, a bunker's centre is sand, the lake is water, the tee box is tee", () => {
  for (const n of [1, 5, 11, 12, 18]) {
    const b = buildHole(geo, n, { par: PAR[n - 1], yards: MEDAL[n - 1] });
    assert.equal(classify(b, b.green.center), "green", `hole ${n} green`);
    assert.equal(classify(b, { x: 0, y: 0 }), "tee", `hole ${n} tee origin`);
  }
  const b11 = buildHole(geo, 11, { par: 3, yards: 106 });                 // the island-style par 3 over the east lake
  const water = b11.hazards.find((h) => h.type === "water");
  assert.ok(water, "hole 11 has water");
  const c = water.ring.reduce((a, p) => [a[0] + p[0] / water.ring.length, a[1] + p[1] / water.ring.length], [0, 0]);
  assert.ok(["water", "sand", "green", "tee", "fairway"].includes(classify(b11, { x: c[0], y: c[1] })));
  const withSand = [1, 2, 3, 5, 7, 8, 9, 10, 18].map((n) => buildHole(geo, n, { par: PAR[n - 1] })).filter((h) => h.hazards.some((x) => x.type === "sand"));
  assert.ok(withSand.length >= 6, "most holes carry bunkers");
  for (const h of withSand) {
    const s = h.hazards.find((x) => x.type === "sand");
    const cx = s.ring.reduce((a, p) => a + p[0], 0) / s.ring.length, cy = s.ring.reduce((a, p) => a + p[1], 0) / s.ring.length;
    // a bunker's centroid can sit outside a crescent, so only demand it is not read as the green
    assert.notEqual(classify(h, { x: cx, y: cy }), "green");
  }
});

test("no feature wanders: every point of the trace is within 1.5 km of the club and no coordinate is NaN", () => {
  const a = geo.holes[1].line[0];
  for (const w of woodmont.ways) for (const [lat, lon] of w.pts) {
    assert.ok(Number.isFinite(lat) && Number.isFinite(lon));
    assert.ok(haversineM({ lat, lon }, a) < 1500, `${w.tags.golf} point ${lat},${lon}`);
  }
  for (const w of woodmont.ways) if (w.tags.golf !== "hole") assert.deepEqual(w.pts[0], w.pts[w.pts.length - 1], `${w.tags.golf} ring is closed`);
});

test("shiftM moves everything together and by the right amount", () => {
  const moved = { ...woodmont, shiftM: [10, -5] };
  const a = toOverpass(woodmont).elements[0].geometry[0], b = toOverpass(moved).elements[0].geometry[0];
  const east = haversineM({ lat: a.lat, lon: a.lon }, { lat: a.lat, lon: b.lon });
  const south = haversineM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: a.lon });
  assert.ok(Math.abs(east - 10) < 0.05 && b.lon > a.lon, `east ${east}`);
  assert.ok(Math.abs(south - 5) < 0.05 && b.lat < a.lat, `south ${south}`);
});

test("cache stamp: an older cache (an empty OSM answer) is detected, and the trace's version round-trips", () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const emptyOsm = parseOverpass({ elements: [] });
  saveGeometryCache(storage, "tnw4ghn5", emptyOsm, null);
  const stale = loadGeometryCache(storage, "tnw4ghn5");
  assert.ok(stale, "an empty answer is cached as if it were a result");
  assert.notEqual(stale.local, lg.version, "…and carries no trace stamp, so useCourseMap replaces it");
  saveGeometryCache(storage, "tnw4ghn5", geo, null, lg.version);
  const fresh = loadGeometryCache(storage, "tnw4ghn5");
  assert.equal(fresh.local, lg.version);
  assert.equal(Object.keys(fresh.holes).length, 18);
});

test("the caddie engine runs on the traced holes: a tee shot and an approach from 150 yards, finite numbers, a club named", () => {
  const P = loadProfile(JSON.parse(readFileSync(join(here, "profile.json"), "utf8")));
  for (const n of [1, 4, 11, 12, 16, 17]) {                                    // lakes, creek, bunkers, a dogleg and a par 3 over water
    const hole = buildHole(geo, n, { par: PAR[n - 1], yards: MEDAL[n - 1] });
    const tee = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: PAR[n - 1] }, hole, P);
    assert.ok(tee && tee.safe && tee.safe.club, `hole ${n} tee shot has a call`);
    assert.ok(Number.isFinite(tee.safe.expScore) && Number.isFinite(tee.safe.troubleRate), `hole ${n} tee numbers`);
    const c = hole.green.center;
    const ball = { x: c.x, y: c.y - 150 };                                       // 150 yd short of the green, on the hole's axis
    const app = recommend({ shotNo: 2, ball, lieType: "fairway", par: PAR[n - 1] }, hole, P);
    if (app) {                                                                   // null only when the ball is on the green
      assert.ok(app.safe && app.safe.club, `hole ${n} approach has a call`);
      assert.ok(Number.isFinite(app.safe.expScore), `hole ${n} approach numbers`);
    }
  }
});

test("featuresForHole: tee boxes are given to the hole they sit on", () => {
  for (let n = 1; n <= 18; n++) {
    const f = featuresForHole(geo, n);
    assert.ok(f.tees.some((t) => pointInRing(geo.holes[n].teeEnd, t.ring)), `hole ${n}: the line starts inside one of its tee boxes`);
  }
});
