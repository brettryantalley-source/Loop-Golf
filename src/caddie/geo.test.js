/*
 * geo.test.js — caddie spec §10 T11–T15 (S2: geometry + sensors) plus unit tests for geo.js,
 * sensors.js, context.js and the S2 extension of geometry.js parseOverpass.
 *
 * Fixtures: the real Hampton Golf Village Overpass payload (holes, greens, bunkers, water — no
 * tees / fairways / boundary in the trimmed file) plus synthetic OSM elements drawn in lat/lng
 * around Hampton's real hole 1 (a fairway, tee box, bunker, water hazard, a wood multipolygon with
 * a clearing, rough, and a leisure=golf_course boundary).
 * Run: node --test src/caddie/geo.test.js src/geometry.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseOverpass, overpassQuery, compactGeometry, destination, bearingDeg, haversineM, yardsBetween,
  GEOMETRY_SCHEMA, featuresForHole,
} from "../geometry.js";
import {
  holeFrame, frameOf, buildHole, inferLie, overrideAt, distances, clampToGreen, pinFromTap, detectHole,
  needsNineMap, saveNineMap, loadNineMap, nineMapPromptNeeded, nineMapKey, holeKeyFor, playingOrder,
  nineMapCandidates, coverageCheck, geoCacheKey, saveGeometryCache, loadGeometryCache,
  nineMapFromRouting, playFromRouting, ninesAssociation, guessPlay,
} from "./geo.js";
import {
  fetchWeather, parseWeather, weatherUrl, weatherRefreshDue, conditionsFrom, fetchElevationSamples,
  elevationUrl, interpolateElevation, elevationDeltaYds, elevationSamplePoints, WEATHER_REFRESH_MS, weatherTempF,
} from "./sensors.js";
import { assembleShotContext, windToHoleFrame, chipWind, parseLieChip, frameBearing } from "./context.js";
import { classify, pointInRing, dist } from "./course.js";
import { DEFAULT_CONFIG, mergeConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const hampton = JSON.parse(readFileSync(join(here, "..", "fixtures", "hampton-overpass.json"), "utf8"));
const near = (a, b, tol, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const YPM = 1.0936133;

/* ---------- fixtures ---------- */

const real = parseOverpass(hampton);
const h1 = real.holes[1];
const TEE = h1.line[0];
const BRG = bearingDeg(h1.line[0], h1.line[h1.line.length - 1]);
/** Hampton hole 1, in metres: `a` along the tee → green line, `c` to the right of it. */
const at = (a, c = 0) => destination(destination(TEE, BRG, a), (BRG + 90) % 360, c);
const box = (a0, a1, c0, c1) => [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)];
const closed = (r) => [...r, r[0]];
let nextId = 9000;
const way = (tags, ring) => ({ type: "way", id: nextId++, tags, geometry: closed(ring).map((p) => ({ lat: p.lat, lon: p.lon })) });
const g = (pts) => pts.map((p) => ({ lat: p.lat, lon: p.lon }));

// a wood as a multipolygon relation whose outer ring is split across two member ways, with a clearing
const woodOuter = box(150, 420, -140, -70);
const woodRel = {
  type: "relation", id: 8001, tags: { type: "multipolygon", natural: "wood" },
  members: [
    { type: "way", ref: 1, role: "outer", geometry: g([woodOuter[0], woodOuter[1], woodOuter[2]]) },
    { type: "way", ref: 2, role: "outer", geometry: g([woodOuter[0], woodOuter[3], woodOuter[2]]) },   // reversed on purpose
    { type: "way", ref: 3, role: "inner", geometry: g(closed(box(250, 300, -120, -90))) },
  ],
};
const synthetic = [
  way({ golf: "tee" }, box(-8, 8, -6, 6)),
  way({ golf: "fairway" }, box(180, 340, -18, 18)),
  way({ golf: "bunker" }, box(250, 262, 20, 30)),
  way({ golf: "water_hazard" }, box(100, 160, -60, -30)),
  way({ golf: "rough" }, box(340, 400, 40, 80)),                       // pokes 20 m past the boundary
  way({ leisure: "golf_course", name: "Synthetic GC" }, box(-60, 480, -160, 60)),
  way({ landuse: "forest" }, box(2000, 2100, 2000, 2100)),              // far away: course-level
  woodRel,
];
const synth = parseOverpass({ elements: [...hampton.elements, ...synthetic] });
const H1 = buildHole(synth, 1, { par: 4, yards: 415 });
const F1 = frameOf(H1);
const lieAt = (p, opts = {}) => inferLie(H1, synth, p, opts);

/* ---------- geometry.js S2 extension ---------- */

test("overpassQuery (S2): adds rough, woods, forest and the golf_course boundary; keeps the v18 selectors", () => {
  const q = overpassQuery(34.301726, -84.060013);
  assert.match(q, /golf"~"\^\(hole\|green\|bunker\|fairway\|tee\|water_hazard\|lateral_water_hazard\|out_of_bounds\)\$"/);
  for (const sel of [/way\["golf"="rough"\]/, /way\["natural"="wood"\]/, /way\["landuse"="forest"\]/, /way\["leisure"="golf_course"\]/, /relation\["leisure"="golf_course"\]/, /relation\["landuse"="forest"\]/]) assert.match(q, sel);
  assert.match(q, /out geom;$/);
});

test("parseOverpass (S2): features are assigned to holes; the boundary is picked; v18 fields unchanged", () => {
  assert.equal(synth.schema, GEOMETRY_SCHEMA);
  assert.equal(Object.keys(synth.holes).length, 18);
  assert.equal(synth.greens.length, 20);
  assert.equal(synth.trouble.length, 70, "68 real + the synthetic bunker and water hazard");
  const kinds = (k) => synth.features.filter((f) => f.kind === k);
  assert.deepEqual(kinds("tee")[0].holeRefs, [1], "tee box around the centreline's tee end");
  assert.deepEqual(kinds("fairway")[0].holeRefs, [1], "fairway contains hole 1's centreline");
  assert.deepEqual(kinds("rough")[0].holeRefs, [1], "rough within 40 m of the centreline");
  const trees = kinds("trees");
  assert.equal(trees.length, 2);
  const wood = trees.find((f) => f.osmId === 8001);
  assert.ok(wood.ring.length >= 4, "split outer ring stitched");
  assert.equal(wood.inner.length, 1, "clearing kept as an inner ring");
  assert.deepEqual(wood.holeRefs, [2, 18], "trees go to every hole within 40 m: real holes 2 and 18 run past it; hole 1 is 70 m off");
  assert.deepEqual(trees.find((f) => f.osmId !== 8001).holeRefs, [], "a far forest stays course-level");
  assert.ok(synth.trouble.find((t) => t.kind === "bunker" && t.osmId >= 9000 && t.osmId < 10000).holeRefs.includes(1));
  assert.equal(synth.boundary.name, "Synthetic GC");
  assert.equal(real.boundary, null);
  assert.ok(real.warnings.some((w) => /no leisure=golf_course boundary/.test(w)));
  assert.equal(real.holes[5].par, null, "OSM has no par on Hampton hole 5 (handoff §4.2)");
  assert.equal(real.holes[1].par, 4);
  const f1 = featuresForHole(synth, 1);
  assert.equal(f1.fairways.length, 1);
  assert.equal(f1.tees.length, 1);
  assert.equal(f1.trees.length, 0, "the wood is 70 m off hole 1 (assigned to 2 and 18); buildHole still pulls it in by proximity");
});

test("compactGeometry (S2): keeps features, boundary and holeRefs through a JSON round trip", () => {
  const c = JSON.parse(JSON.stringify(compactGeometry(synth)));
  assert.equal(c.schema, GEOMETRY_SCHEMA);
  assert.equal(c.features.length, synth.features.length);
  assert.equal(c.features[0].osmId, undefined);
  assert.ok(c.boundary.ring.length >= 4);
  assert.equal(c.greens.length, 20);
  const again = compactGeometry(c);
  assert.deepEqual(JSON.parse(JSON.stringify(again)), c, "idempotent");
  const b = buildHole(c, 1, { par: 4 });
  assert.equal(b.fairways.length, 1, "buildHole works from the cached form");
  assert.ok(b.boundary);
});

test("parseOverpass: a repeated ref (27-hole club numbered 1–9 per nine) is kept, not overwritten", () => {
  const els = [];
  for (let n = 0; n < 3; n++) for (let r = 1; r <= 9; r++) {
    const t = at(n * 1000 + r * 30, 500), e = destination(t, 0, 300);
    els.push({ type: "way", id: 100 * n + r, tags: { golf: "hole", ref: String(r) }, geometry: g([t, e]) });
  }
  const p = parseOverpass({ elements: els });
  assert.equal(Object.keys(p.holes).length, 27);
  assert.ok(p.holes["1@101"] && p.holes["1@201"]);
  assert.equal(p.holes[1].key, 1);
  assert.equal(p.warnings.filter((w) => /appears more than once/.test(w)).length, 18);
});

/* ---------- (a) frame ---------- */

test("holeFrame: toFrame → toLatLng round-trips within 0.5 yd; the green end sits on +y; distances match haversine", () => {
  const F = holeFrame(h1.line);
  near(F.bearingDeg, BRG, 1e-9);
  const o = F.toFrame(TEE);
  near(o.x, 0, 1e-9); near(o.y, 0, 1e-9);
  const end = F.toFrame(h1.line[1]);
  near(end.x, 0, 0.1, "green end x");
  near(end.y, yardsBetween(h1.line[0], h1.line[1]), 0.2, "green end y");
  const right = F.toFrame(destination(TEE, (BRG + 90) % 360, 50));
  near(right.x, 50 * YPM, 0.05); near(right.y, 0, 0.05);
  for (const [a, c] of [[0, 0], [100, -40], [350, 25], [550, -120], [-30, 80]]) {
    const p = at(a, c), xy = F.toFrame(p), back = F.toLatLng(xy);
    assert.ok(haversineM(p, back) * YPM < 0.5, `round trip at ${a},${c}`);
    near(Math.hypot(xy.x, xy.y), yardsBetween(TEE, p), 0.5, `range at ${a},${c}`);
  }
  // accepts {lat, lng} too, and a frame rebuilt from { origin, bearingDeg } is the same frame
  const q = at(200, 10);
  assert.deepEqual(F.toFrame({ lat: q.lat, lng: q.lon }), F.toFrame(q));
  const G = holeFrame({ origin: F.origin, bearingDeg: F.bearingDeg });
  assert.deepEqual(G.toFrame(q), F.toFrame(q));
  assert.throws(() => holeFrame([TEE]), /≥ 2 nodes/);
});

/* ---------- (b) buildHole ---------- */

test("buildHole on a real Hampton hole (17: par 3 over water): course.js shape, green centroid, typed hazards", () => {
  const h = buildHole(real, 17, { par: 3, yards: 174 });
  for (const k of ["id", "par", "yards", "tee", "green", "fairways", "tees", "hazards", "boundary"]) assert.ok(k in h, k);
  assert.equal(h.par, 3);
  assert.equal(h.yards, 174);
  assert.deepEqual(h.tee, { x: 0, y: 0 });
  assert.ok(pointInRing(h.green.center, h.green.ring), "centroid inside the green");
  near(h.green.center.x, 0, 12, "green on the tee → green line");
  assert.ok(h.green.center.y > 120 && h.green.center.y < 220, `green ${h.green.center.y} yds up the hole`);
  assert.ok(h.hazards.some((z) => z.type === "water"));
  assert.ok(h.hazards.some((z) => z.type === "sand"));
  assert.ok(h.hazards.every((z) => ["water", "sand", "trees"].includes(z.type)));
  assert.ok(h.hazards.every((z) => Array.isArray(z.ring[0]) && z.ring[0].length === 2), "rings are [[x,y]…]");
  assert.equal(h.boundary, null, "the trimmed fixture has no leisure=golf_course");
  assert.equal(buildHole(real, 17).par, real.holes[17].par, "OSM par is only a fallback");
  assert.equal(buildHole(real, 99), null, "no such hole → club-brain mode");
  // a real bunker's interior classifies as sand in the built frame
  const bunker = h.hazards.find((z) => z.type === "sand");
  const inside = interior(bunker.ring);
  assert.equal(classify(h, inside), "sand");
});

test("buildHole (synthetic around hole 1): own fairway + tee, typed hazards incl. trees with a clearing, boundary", () => {
  assert.equal(H1.fairways.length, 1);
  assert.equal(H1.tees.length, 1);
  assert.deepEqual(H1.hazards.map((z) => z.type).sort(), ["sand", "trees", "water"]);
  assert.equal(H1.hazards.find((z) => z.type === "trees").inner.length, 1);
  assert.ok(H1.boundary && H1.boundary.length >= 4);
  assert.equal(H1.roughs.length, 1);
  assert.equal(H1.par, 4);
});

/** A point well inside a [[x,y]] ring (grid scan, farthest from the edges). */
function interior(ring) {
  let best = null;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let x = x0; x <= x1; x += (x1 - x0) / 20) for (let y = y0; y <= y1; y += (y1 - y0) / 20) {
    const p = { x, y };
    if (!pointInRing(p, ring)) continue;
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
      d = Math.min(d, Math.hypot(x - ax - t * vx, y - ay - t * vy));
    }
    if (!best || d > best.d) best = { p, d };
  }
  return best.p;
}

/* ---------- T11–T13: lie inference ---------- */

test("T11 Lie inference: fairway / bunker / green / water polygons classify correctly; inside boundary, no feature → rough", () => {
  const cases = [
    [at(260, 0), "fairway", "fairway"],
    [at(256, 25), "sand", "sand"],
    [F1.toLatLng(H1.green.center), "green", "green"],
    [at(130, -45), "water", "rough"],
    [at(120, 20), "rough", "rough"],
    [at(0, 0), "tee", "tee"],
    [at(200, -100), "trees", "recovery"],
    [at(275, -105), "rough", "rough"],                        // the clearing inside the wood
  ];
  for (const [p, lie, lieType] of cases) {
    const r = lieAt(p, { accuracyM: 4 });
    assert.equal(r.lie, lie, `lie at ${JSON.stringify(p)}`);
    assert.equal(r.lieType, lieType);
    assert.equal(r.source, "polygon");
  }
  assert.equal(lieAt(at(130, -45)).penalty, "water");
  assert.equal(lieAt(at(260, 0), { accuracyM: 4 }).lieConfidence, "high");
  // a frame point works the same as a GPS point
  assert.equal(inferLie(H1, synth, F1.toFrame(at(260, 0)), { accuracyM: 4 }).lie, "fairway");
  // another hole's green counts as fairway (wrong-green relief), never as this hole's green
  const h2 = buildHole(synth, 2);
  assert.equal(inferLie(h2, synth, real.holes[1].green.center).lie, "fairway");
});

test("T12 Confidence: accuracyM = 12, or a point 3 m from a fairway/rough edge → low", () => {
  assert.equal(lieAt(at(260, 0), { accuracyM: 12 }).lieConfidence, "low");
  assert.equal(lieAt(at(260, 0), { accuracyM: 8 }).lieConfidence, "high", "8 m is not > 8");
  const edge = lieAt(at(260, 15), { accuracyM: 3 });             // fairway edge at c = 18 m
  assert.equal(edge.lie, "fairway");
  assert.equal(edge.lieConfidence, "low");
  assert.equal(lieAt(at(260, -15), { accuracyM: 2 }).lieConfidence, "low", "5 m floor on the radius");
  assert.equal(lieAt(at(260, 10), { accuracyM: 4 }).lieConfidence, "high", "8 m from the edge with 4 m accuracy");
  // the rough side of the same edge is low too
  assert.equal(lieAt(at(260, -21), { accuracyM: 3 }).lieConfidence, "low");
});

test("T13 OB: a point outside leisure=golf_course → ob, priced by the engine's stroke-and-distance branch", () => {
  const r = lieAt(at(200, 100), { accuracyM: 3 });
  assert.equal(r.lie, "ob");
  assert.equal(r.penalty, "ob");
  assert.equal(r.lieConfidence, "low");
  // the simulation keys stroke-and-distance off classify(hole, landing) === "ob" (engine.js priceLanding)
  assert.equal(classify(H1, F1.toFrame(at(200, 100))), "ob");
  assert.equal(classify(H1, F1.toFrame(at(200, 40))), "rough");
  // no boundary mapped → no OB anywhere
  assert.equal(classify(buildHole(real, 1), F1.toFrame(at(200, 100))), "rough");
  // a mapped golf=rough polygon beats a sloppy boundary edge
  assert.equal(lieAt(at(370, 70)).lie, "rough");
});

test("§5.6 overrides: ≥ 2 corrections to the same value within 15 m (same course) win; 1, or another course, does not", () => {
  const p = at(260, 0);
  const o = (dx, corrected, courseId = "hampton", ts = "2026-09-20T10:00:00Z") => ({ courseId, hole: 1, gps: { lat: at(260, dx).lat, lng: at(260, dx).lon }, inferred: "fairway", corrected, ts });
  assert.equal(lieAt(p, { overrides: [o(2, "Rough")], courseId: "hampton" }).lie, "fairway");
  const two = lieAt(p, { overrides: [o(2, "Rough"), o(-4, "rough")], courseId: "hampton", accuracyM: 3 });
  assert.equal(two.lie, "rough");
  assert.equal(two.source, "override");
  assert.equal(two.lieConfidence, "high");
  assert.equal(lieAt(p, { overrides: [o(2, "rough", "ironwood"), o(-4, "rough", "ironwood")], courseId: "hampton" }).source, "polygon");
  assert.equal(lieAt(p, { overrides: [o(12, "rough"), o(-12, "rough")], courseId: "hampton" }).source, "polygon", "24 m apart: not one cluster");
  assert.equal(lieAt(at(300, 0), { overrides: [o(2, "rough"), o(-4, "rough")], courseId: "hampton" }).source, "polygon", "40 m away");
  assert.equal(overrideAt([o(2, "rough"), o(-4, "rough"), o(1, "sand"), o(0, "sand", "hampton", "2026-09-21")], p, "hampton").value, "sand", "tie → newest");
  assert.equal(lieAt(p, { overrides: [o(2, "recovery"), o(-4, "recovery")], courseId: "hampton" }).lie, "trees");
});

/* ---------- T14 distances + pin ---------- */

test("T14 Distances: front < center < back for a ball in front of the green; pin shifts with pinPos", () => {
  const ball = at(200, 0);
  const d = { front: distances(H1, ball, "front"), middle: distances(H1, ball, "middle"), back: distances(H1, ball, "back") };
  assert.ok(d.middle.front < d.middle.center && d.middle.center < d.middle.back);
  assert.ok(d.front.pin < d.middle.pin && d.middle.pin < d.back.pin);
  near(d.middle.pin, d.middle.center, 1e-9);
  near(d.front.pin, d.middle.front + d.middle.depth / 3, 0.1);
  assert.equal(d.middle.pinPos, "middle");
  // center distance agrees with haversine to the green centroid
  near(d.middle.center, yardsBetween(ball, F1.toLatLng(H1.green.center)), 0.5);
  // a custom pin on the green is used as is; the pin distance is to it
  const pinXY = { x: H1.green.center.x + 4, y: H1.green.center.y + 6 };
  const c = distances(H1, ball, pinXY);
  assert.equal(c.pinPos, "custom");
  near(c.pin, dist(F1.toFrame(ball), pinXY), 0.1);
  const cl = distances(H1, ball, F1.toLatLng(pinXY));
  near(cl.pin, c.pin, 0.1, "{lat,lon} custom pin");
});

test("custom pin clamp (addendum §6): outside → just inside the ring; taps within 3 yds count, farther ones don't", () => {
  const c = H1.green.center;
  const far = { x: c.x + 60, y: c.y };
  const k = clampToGreen(H1, far);
  assert.ok(pointInRing(k, H1.green.ring));
  const d = distances(H1, at(200, 0), far);
  assert.ok(pointInRing(d.pinPoint, H1.green.ring), "distances() clamps a custom pin");
  const inside = { x: c.x + 1, y: c.y - 1 };
  assert.deepEqual(clampToGreen(H1, inside), inside);
  // walk out from the centre to just past the edge
  let edge = { ...c };
  while (pointInRing(edge, H1.green.ring)) edge = { x: edge.x + 0.25, y: edge.y };
  const tapNear = pinFromTap(H1, { x: edge.x + 2, y: edge.y });
  assert.ok(tapNear && pointInRing(tapNear, H1.green.ring), "2 yds off → clamped on");
  assert.equal(pinFromTap(H1, { x: edge.x + 8, y: edge.y }), null, "8 yds off → not a pin tap");
});

/* ---------- hole detection ---------- */

test("detectHole (§6.4): advance on the next hole's tee (≤ 30 m), else stay; wraps 18 → 1; round start picks the nearest tee", () => {
  const tee2 = real.holes[2].line[0];
  assert.deepEqual(detectHole(real, tee2, 1).hole, 2);
  assert.equal(detectHole(real, destination(tee2, 90, 25), 1).advanced, true);
  const stay = detectHole(real, destination(tee2, 90, 80), 1);
  assert.equal(stay.advanced, false);
  assert.equal(stay.hole, 1);
  assert.equal(detectHole(real, real.holes[1].line[0], 18).hole, 1, "18 → 1");
  assert.equal(detectHole(real, real.holes[3].line[0], 1).advanced, false, "only the NEXT hole's tee");
  assert.equal(detectHole(real, real.holes[10].line[0], null).hole, 10);
  // a mapped tee polygon is used instead of the tee end: synth has a tee box around hole 1's tee
  assert.equal(detectHole(synth, at(12, 0), 18).hole, 1, "4 m outside the tee box");
  // custom playing order (27-hole clubs): after 9 comes whatever the nine map says
  assert.equal(detectHole(real, real.holes[1].line[0], 9, { order: [8, 9, 1] }).hole, 1);
});

/* ---------- T15 nine mapping ---------- */

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
function ironwoodLike() {
  const els = [];
  for (let n = 0; n < 3; n++) for (let r = 1; r <= 9; r++) {
    const t = at(n * 1500 + r * 40, 900), e = destination(t, 0, 300);
    els.push({ type: "way", id: 100 * n + r, tags: { golf: "hole", ref: String(r) }, geometry: g([t, e]) });
    els.push(way({ golf: "green" }, [destination(e, 0, 12), destination(e, 90, 12), destination(e, 180, 12), destination(e, 270, 12)]));
  }
  return parseOverpass({ elements: els });
}

test("T15 Nine mapping: a mapping saved once is reused; no prompt on the second load of the same course", () => {
  const geo = ironwoodLike();
  const store = memStorage();
  assert.equal(needsNineMap(geo), true);
  assert.equal(needsNineMap(real), false, "Hampton: one 18, refs 1–18");
  assert.equal(nineMapPromptNeeded(geo, store, "ironwood"), true, "first use: prompt");
  const cands = nineMapCandidates(geo);
  assert.equal(cands.length, 27);
  const nines = ["Ridge", "Valley", "Lakes"];
  const map = {};
  for (const c of cands) map[c.key] = { nine: nines[String(c.key).includes("@2") ? 2 : String(c.key).includes("@1") ? 1 : 0], hole: c.ref };
  assert.equal(saveNineMap(store, "ironwood", map), true);
  assert.ok(store._m.has("bogeyman-matches:nineMap:v1:ironwood"));
  assert.equal(nineMapKey("ironwood"), "bogeyman-matches:nineMap:v1:ironwood");
  // "second load": a fresh read of the same storage
  assert.equal(nineMapPromptNeeded(ironwoodLike(), store, "ironwood"), false);
  assert.deepEqual(loadNineMap(store, "ironwood"), map);
  assert.equal(nineMapPromptNeeded(geo, store, "other-27"), true, "another course still prompts");
  assert.equal(holeKeyFor(map, "Valley", 1), "1@101");
  assert.equal(holeKeyFor(map, "Ridge", 3), "3");
  const order = playingOrder(map, ["Valley", "Lakes"]);
  assert.equal(order.length, 18);
  assert.equal(order[9], "1@201");
  // storage failures never throw
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  assert.equal(saveNineMap(broken, "x", map), false);
  assert.equal(loadNineMap(broken, "x"), null);
  store.setItem(nineMapKey("junk"), "{not json");
  assert.equal(loadNineMap(store, "junk"), null);
});

/* ---------- v22.7 nine map from the chosen routing ---------- */

/* 27 OSM holes: refs 1–27 (numbered), or refs 1–9 per nine with names like "Ridge 4" (named). */
function club27({ numbered = false, names = null } = {}) {
  const els = [];
  for (let n = 0; n < 3; n++) for (let r = 1; r <= 9; r++) {
    const t = at(n * 1500 + r * 40, 900), e = destination(t, 0, 300);
    const tags = { golf: "hole", ref: String(numbered ? n * 9 + r : r) };
    if (names) tags.name = `${names[n]} ${r}`;
    els.push({ type: "way", id: 100 * n + r, tags, geometry: g([t, e]) });
    els.push(way({ golf: "green" }, [destination(e, 0, 12), destination(e, 90, 12), destination(e, 180, 12), destination(e, 270, 12)]));
  }
  return parseOverpass({ elements: els });
}
const keyOfOsm = (geo, osmId) => Object.values(geo.holes).find((h) => h.osmId === osmId)?.key ?? Object.keys(geo.holes).find((k) => geo.holes[k].osmId === osmId);

test("nineMapFromRouting: OSM refs 1–27 → nines 1/2/3; a 27-hole-tee routing (1 / 3) plays nine 1 then nine 3", () => {
  const geo = club27({ numbered: true });
  assert.equal(needsNineMap(geo), true);
  const m = nineMapFromRouting(geo, { play: ["1", "3"], club: ["1", "2", "3"], ordered: true });
  assert.ok(m, "confident");
  assert.deepEqual(m._play, ["1", "3"]);
  assert.deepEqual(m["1"], { nine: "1", hole: 1 });
  assert.deepEqual(m["14"], { nine: "2", hole: 5 });
  assert.deepEqual(m["27"], { nine: "3", hole: 9 });
  const order = Array.from({ length: 18 }, (_, i) => holeKeyFor(m, m._play[i < 9 ? 0 : 1], (i % 9) + 1));
  assert.deepEqual(order, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "19", "20", "21", "22", "23", "24", "25", "26", "27"]);
  // the API named its nines and they are in OSM order → the names map to 1/2/3 by position
  const named = nineMapFromRouting(geo, { play: ["Lakes", "Ridge"], club: ["Ridge", "Valley", "Lakes"], ordered: true });
  assert.deepEqual(named._play, ["3", "1"]);
  assert.deepEqual(named._nines, { Ridge: "1", Valley: "2", Lakes: "3" });
  // word nines from course_name on a 1–27 map: which number is "Village"? Not confident.
  assert.equal(nineMapFromRouting(geo, { play: ["Village", "School"], club: ["Village", "School", "Mill"], ordered: false }), null);
  // a hole missing from a played nine → not confident
  const cut = compactGeometry(geo); delete cut.holes["22"];
  assert.equal(nineMapFromRouting(cut, { play: ["1", "3"], club: ["1", "2", "3"], ordered: true }), null);
  assert.ok(nineMapFromRouting(cut, { play: ["1", "2"], club: ["1", "2", "3"], ordered: true }), "the unplayed nine may have gaps");
});

test("nineMapFromRouting: OSM hole names carrying the nine words → those nines, labelled 1/2/3 with _nines", () => {
  const geo = club27({ names: ["Village", "School", "Mill"] });
  const routing = { play: ["Mill", "School"], club: ["Village", "School", "Mill"], ordered: false };
  const m = nineMapFromRouting(geo, routing);
  assert.ok(m, "confident");
  assert.deepEqual(m._nines, { Village: "1", School: "2", Mill: "3" });
  assert.deepEqual(m._play, ["3", "2"], "Mill first, then School");
  const mill4 = keyOfOsm(geo, 204), school9 = keyOfOsm(geo, 109);
  assert.deepEqual(m[mill4], { nine: "3", hole: 4 });
  assert.deepEqual(m[school9], { nine: "2", hole: 9 });
  assert.equal(holeKeyFor(m, m._play[0], 4), mill4, "scorecard hole 4 = Mill 4");
  assert.equal(holeKeyFor(m, m._play[1], 9), school9, "scorecard hole 18 = School 9");
  // a later round on another routing of the same club reads its own _play off _nines
  assert.deepEqual(playFromRouting(m, { play: ["Village", "Mill"], club: routing.club }), ["1", "3"]);
  assert.deepEqual(playFromRouting(m, "School / Village"), ["2", "1"], "a label string works too");
  // case-insensitive word match, not substring: "Millbrook 3" is not Mill
  const geo2 = club27({ names: ["village", "SCHOOL", "Millbrook"] });
  assert.equal(nineMapFromRouting(geo2, routing), null);
});

test("nineMapFromRouting: no match → null (the screen asks, pre-selected)", () => {
  const plain = club27();                                   // refs 1–9 three times, no names
  assert.equal(nineMapFromRouting(plain, { play: ["Village", "School"], club: ["Village", "School", "Mill"] }), null);
  assert.equal(nineMapFromRouting(plain, { play: ["1", "2"], club: ["1", "2", "3"], ordered: true }), null, "which ref-1 is nine 1? unknown");
  assert.equal(nineMapFromRouting(club27({ names: ["Ridge", "Valley", "Lakes"] }), { play: ["Village", "School"], club: ["Village", "School", "Mill"] }), null, "names that aren't this club's nines");
  assert.equal(nineMapFromRouting(plain, null), null);
  assert.equal(nineMapFromRouting(plain, { play: ["A", "A"] }), null);
  assert.equal(nineMapFromRouting({ holes: {} }, "1 / 2"), null);
  // what the screen is pre-set to instead
  assert.deepEqual(guessPlay({ play: ["Mill", "School"], club: ["Village", "School", "Mill"] }), ["3", "2"]);
  assert.deepEqual(guessPlay({ play: ["2", "3"], club: ["1", "2", "3"] }), ["2", "3"]);
  assert.deepEqual(guessPlay(null), ["1", "2"]);
  // …and what saving it records: the two nines chosen, the third by elimination
  assert.deepEqual(ninesAssociation(["2", "1"], { play: ["Village", "School"], club: ["Village", "School", "Mill"] }), { Village: "2", School: "1", Mill: "3" });
  assert.equal(ninesAssociation(["1", "2"], { play: ["1", "2"] }), null, "numbered nines need no names");
  assert.equal(playFromRouting({ _play: ["1", "2"] }, { play: ["Village", "School"] }), null, "an old map without names can't say");
});

/* ---------- coverage ---------- */

test("coverageCheck on the real Hampton fixture: complete (18/18 holes with way + green), 2 orphan practice greens", () => {
  const c = coverageCheck(real);
  assert.equal(c.complete, true);
  assert.deepEqual(c.missing, []);
  assert.equal(c.orphanGreens, 2, "20 greens for 18 holes");
  assert.equal(c.message, null);
  // knock out hole 5's way and hole 12's green → both reported, with the §6.1 message
  const cut = compactGeometry(real);
  delete cut.holes[5];
  cut.holes[12] = { ...cut.holes[12], green: null };
  const m = coverageCheck(cut);
  assert.equal(m.complete, false);
  assert.deepEqual(m.missing, [5, 12]);
  assert.deepEqual(m.reasons, { 5: "no hole way", 12: "no green" });
  assert.equal(m.message, "Geometry incomplete: holes 5, 12.");
  assert.equal(coverageCheck(ironwoodLike(), { expected: nineMapCandidates(ironwoodLike()).map((c) => String(c.key)) }).complete, true);
  assert.deepEqual(coverageCheck({ holes: {} }).missing.length, 18);
});

test("geometry cache: bogeyman-matches:geo:v1:{apiId}, compact + elevation; an older schema reads as a miss", () => {
  const store = memStorage();
  assert.equal(geoCacheKey(123), "bogeyman-matches:geo:v1:123");
  assert.equal(saveGeometryCache(store, 123, synth, { samples: [{ lat: 1, lon: 2, elevM: 300 }] }), true);
  const back = loadGeometryCache(store, 123);
  assert.equal(Object.keys(back.holes).length, 18);
  assert.equal(back.elevation.samples[0].elevM, 300);
  assert.equal(buildHole(back, 1).fairways.length, 1);
  store.setItem(geoCacheKey(7), JSON.stringify(compactGeometry(real)).replace(`"schema":${GEOMETRY_SCHEMA},`, ""));
  assert.equal(loadGeometryCache(store, 7), null, "v18 cache (no schema) → re-fetch");
  assert.equal(loadGeometryCache(store, 999), null);
});

/* ---------- sensors ---------- */

const NOW = Date.UTC(2026, 8, 28, 15, 0, 0);
function forecastFixture({ rainPerHour = 0.3, speed = 11.4, dir = 250, temp = 58.2 } = {}) {
  const cur = NOW / 1000;
  const time = [], precipitation = [];
  for (let t = cur - 39 * 3600; t <= cur + 8 * 3600; t += 3600) { time.push(t); precipitation.push(rainPerHour); }
  return {
    latitude: 34.3, longitude: -84.06, utc_offset_seconds: 0,
    current_units: { time: "unixtime", interval: "seconds", wind_speed_10m: "mph", wind_direction_10m: "°", precipitation: "mm", temperature_2m: "°F" },
    current: { time: cur, interval: 900, wind_speed_10m: speed, wind_direction_10m: dir, precipitation: 0, temperature_2m: temp },
    hourly_units: { time: "unixtime", precipitation: "mm" },
    hourly: { time, precipitation },
  };
}

test("fetchWeather: documented URL, parses wind + 24 h rain; a failure hands back the last value, stale, never throws", async () => {
  let seen = null;
  const ok = async (url) => { seen = url; return { ok: true, json: async () => forecastFixture() }; };
  const w = await fetchWeather(34.301726, -84.060013, ok, { now: NOW });
  assert.match(seen, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=34\.30173&longitude=-84\.06001/);
  for (const p of ["current=wind_speed_10m,wind_direction_10m,precipitation", "hourly=precipitation", "past_days=1", "wind_speed_unit=mph", "timeformat=unixtime"]) assert.ok(seen.includes(p), p);
  assert.equal(w.speedMph, 11.4);
  assert.equal(w.dirDeg, 250);
  near(w.rainMm24h, 24 * 0.3, 1e-9, "24 hourly totals ending at the current time");
  assert.equal(w.tempF, 58.2);
  assert.equal(w.asOf, NOW);
  assert.equal(w.stale, false);
  const down = await fetchWeather(34.3, -84.06, async () => ({ ok: false, status: 429 }), { last: w, now: NOW + 60000 });
  assert.equal(down.stale, true);
  assert.equal(down.speedMph, 11.4);
  assert.equal(down.tempF, 58.2, "a failed refresh keeps the last known temperature, marked stale");
  assert.equal(down.asOf, NOW, "keeps the as-of time of the value it is showing");
  assert.match(down.error, /429/);
  const none = await fetchWeather(34.3, -84.06, async () => { throw new TypeError("Failed to fetch"); });
  assert.equal(none.speedMph, null);
  assert.equal(none.tempF, null);
  assert.equal(none.stale, true);
  const junk = await fetchWeather(34.3, -84.06, async () => ({ ok: true, json: async () => ({ error: true, reason: "bad" }) }));
  assert.equal(junk.stale, true);
  // km/h in the units block is converted; ISO times (no timeformat) parse as GMT
  const kmh = forecastFixture({ speed: 20 });
  kmh.current_units.wind_speed_10m = "km/h";
  near(parseWeather(kmh, NOW).speedMph, 12.4, 0.05);
  const iso = forecastFixture();
  iso.current.time = new Date(NOW).toISOString().slice(0, 16);
  iso.hourly.time = iso.hourly.time.map((t) => new Date(t * 1000).toISOString().slice(0, 16));
  near(parseWeather(iso, NOW).rainMm24h, 7.2, 1e-9);
  assert.equal(weatherUrl(1, 2).includes("forecast_days=1"), true);
  assert.match(weatherUrl(1, 2), /temperature_2m/);
  assert.match(weatherUrl(1, 2), /temperature_unit=fahrenheit/);
  const noTemp = forecastFixture();
  delete noTemp.current.temperature_2m;
  assert.equal(parseWeather(noTemp, NOW).tempF, null, "absent temperature parses to null, never a default");
});

test("weatherTempF: only a fresh, finite reading prices the temperature term — never stale, never absent", () => {
  assert.equal(weatherTempF(null), null);
  assert.equal(weatherTempF({ tempF: 58.2, stale: false }), 58.2);
  assert.equal(weatherTempF({ tempF: 58.2, stale: true }), null, "stale weather never contributes a temperature term");
  assert.equal(weatherTempF({ tempF: null, stale: false }), null);
});

test("weatherRefreshDue: 15-minute rule (§6.5), on the tee tap", () => {
  assert.equal(weatherRefreshDue(null, NOW), true);
  assert.equal(weatherRefreshDue(NOW - 14 * 60000, NOW), false);
  assert.equal(weatherRefreshDue(NOW - WEATHER_REFRESH_MS, NOW), true);
  assert.equal(weatherRefreshDue({ fetchedAt: NOW - 20 * 60000 }, NOW), true);
  assert.equal(weatherRefreshDue(new Date(NOW - 60000).toISOString(), new Date(NOW)), false);
});

test("conditionsFrom: wet when 24 h rain ≥ config.WET_RAIN_MM_24H, else normal", () => {
  assert.equal(DEFAULT_CONFIG.WET_RAIN_MM_24H, 5);
  assert.equal(conditionsFrom({ rainMm24h: 5 }), "wet");
  assert.equal(conditionsFrom({ rainMm24h: 4.9 }), "normal");
  assert.equal(conditionsFrom(null), "normal");
  assert.equal(conditionsFrom({ rainMm24h: null, stale: true }), "normal");
  assert.equal(conditionsFrom({ rainMm24h: 3 }, mergeConfig({ WET_RAIN_MM_24H: 2 })), "wet");
});

test("elevation: ≤ 100 points per call, IDW interpolation, target − ball in yards; a failed batch never throws", async () => {
  const pts = elevationSamplePoints(real);
  assert.ok(pts.length > 100 && pts.length < 400, `${pts.length} sample points for Hampton`);
  const urls = [];
  const dem = (p) => 300 + (p.lat - 34.3) * 20000;             // a tilted plane: +2.2 m per 100 m north
  const fake = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const lats = u.searchParams.get("latitude").split(",").map(Number);
    return { ok: true, json: async () => ({ elevation: lats.map((lat) => dem({ lat })) }) };
  };
  const res = await fetchElevationSamples(pts, fake, { now: NOW });
  assert.equal(urls.length, Math.ceil(pts.length / 100));
  assert.ok(urls.every((u) => u.startsWith("https://api.open-meteo.com/v1/elevation?latitude=")));
  assert.equal(res.samples.length, pts.length);
  assert.equal(res.stale, false);
  assert.equal(res.asOf, NOW);
  // interpolation on a plane stays close to the plane
  const ball = at(150, 5), pin = F1.toLatLng(H1.green.center);
  near(interpolateElevation(res, ball), dem(ball), 1.0);
  const dy = elevationDeltaYds(res.samples, ball, pin);
  near(dy, (dem(pin) - dem(ball)) * YPM, 1.5);
  assert.equal(elevationDeltaYds([], ball, pin), null);
  // one failed batch → those points null, the rest kept, stale flagged
  let n = 0;
  const flaky = async (url) => (n++ === 1 ? { ok: false, status: 500 } : fake(url));
  const part = await fetchElevationSamples(pts, flaky, { now: NOW });
  assert.equal(part.stale, true);
  assert.ok(part.samples.some((s) => s.elevM == null) && part.samples.some((s) => s.elevM != null));
  const dead = await fetchElevationSamples(pts, async () => { throw new Error("offline"); }, { last: res });
  assert.equal(dead.stale, true);
  assert.equal(dead.samples.length, res.samples.length, "last value comes back");
  assert.match(elevationUrl([{ lat: 1, lng: 2 }, { lat: 3, lon: 4 }]), /latitude=1\.00000,3\.00000&longitude=2\.00000,4\.00000$/);
});

/* ---------- context ---------- */

test("wind direction: a wind FROM the tee → green bearing is fromDeg 0 (into the face); from the right is 90", () => {
  assert.equal(windToHoleFrame(BRG, BRG), 0);
  near(windToHoleFrame((BRG + 90) % 360, BRG), 90, 1e-9);
  near(windToHoleFrame((BRG + 180) % 360, BRG), 180, 1e-9);
  near(windToHoleFrame(10, 350), 20, 1e-9);
  const ctx = assembleShotContext({ round: { hole: 1, par: 4, shotNo: 1 }, hole: H1, fix: at(0, 0), weather: { speedMph: 12, dirDeg: BRG, rainMm24h: 0, asOf: NOW } });
  assert.deepEqual(ctx.wind, { speedMph: 12, fromDeg: 0 });
  const side = assembleShotContext({ round: { hole: 1, shotNo: 1 }, hole: H1, weather: { speedMph: 8, dirDeg: (BRG + 90) % 360 } });
  near(side.wind.fromDeg, 90, 1e-9);
  // wind chip, relative to the shot line
  near(chipWind({ direction: "Into", speed: 10 }, 30).fromDeg, 30, 1e-9);
  near(chipWind({ direction: "Helping", speed: 10 }, 30).fromDeg, 210, 1e-9);
  near(chipWind({ direction: "From right", speed: "20+" }, 0).fromDeg, 90, 1e-9);
  assert.equal(chipWind({ direction: "From right", speed: "20+" }, 0).speedMph, 20);
  assert.equal(chipWind({ direction: "Calm", speed: 0 }, 0), null);
  near(frameBearing({ x: 0, y: 0 }, { x: 10, y: 0 }), 90, 1e-9);
});

test("assembleShotContext: the §3.1 ctx the engine takes, from GPS + geometry + weather + elevation + chips", () => {
  const elev = { samples: elevationSamplePoints(synth).map((p) => ({ ...p, elevM: 300 + (p.lat - 34.3) * 20000 })) };
  const base = { round: { hole: 1, par: 4, shotNo: 2, courseId: "hampton", trigger: "ball" }, hole: H1, geometry: synth, weather: { speedMph: 9, dirDeg: (BRG + 180) % 360, rainMm24h: 6, asOf: NOW }, elevation: elev };
  const ctx = assembleShotContext({ ...base, fix: { ...at(260, 0), accuracyM: 4 } });
  for (const k of ["hole", "par", "shotNo", "ball", "lieType", "lieQuality", "lieConfidence", "conditions", "pinPos", "wind", "elevationDeltaYds"]) assert.ok(k in ctx, k);
  assert.equal(ctx.hole, 1); assert.equal(ctx.par, 4); assert.equal(ctx.shotNo, 2);
  near(ctx.ball.y, 260 * YPM, 0.5); near(ctx.ball.x, 0, 0.5);
  assert.equal(ctx.lieType, "fairway");
  assert.equal(ctx.lieConfidence, "high");
  assert.equal(ctx.lieQuality, "standard");
  assert.equal(ctx.conditions, "wet", "6 mm in 24 h");
  assert.equal(ctx.pinPos, "middle");
  near(ctx.wind.fromDeg, 180, 1e-9, "a tailwind up the hole");
  assert.ok(Number.isFinite(ctx.elevationDeltaYds) && ctx.elevationDeltaYds !== 0);
  assert.equal(ctx.meta.sources.elevation, "sampled");
  assert.ok(ctx.meta.distances.front < ctx.meta.distances.center);
  assert.deepEqual(Object.keys(ctx.meta.ballGps), ["lat", "lng", "accuracyM"]);

  // chips beat inference; "?" means low confidence; the lie chip is case-insensitive
  const chipped = assembleShotContext({ ...base, fix: { ...at(260, 0), accuracyM: 4 }, chips: { lie: "Rough ?", quality: "Buried", conditions: "Firm", pin: "back", wind: { direction: "Calm" }, elevation: -5 } });
  assert.equal(chipped.lieType, "rough");
  assert.equal(chipped.lieConfidence, "low");
  assert.equal(chipped.lieQuality, "buried");
  assert.equal(chipped.conditions, "firm");
  assert.equal(chipped.pinPos, "back");
  assert.equal(chipped.wind, null);
  assert.equal(chipped.elevationDeltaYds, -5);
  assert.deepEqual(parseLieChip("Sand"), { lieType: "sand", unsure: false });
  assert.equal(parseLieChip("Rough?").unsure, true);
  assert.equal(parseLieChip("Nonsense"), null);

  // inferred low confidence and penalties carry through; the tee tap is always a tee lie
  assert.equal(assembleShotContext({ ...base, fix: { ...at(260, 15), accuracyM: 3 } }).lieConfidence, "low");
  const wet = assembleShotContext({ ...base, fix: { ...at(130, -45), accuracyM: 3 } });
  assert.equal(wet.lieType, "rough");
  assert.equal(wet.meta.penalty, "water");
  const tee = assembleShotContext({ ...base, round: { ...base.round, shotNo: 1, trigger: "tee" }, fix: { ...at(30, 30), accuracyM: 3 } });
  assert.equal(tee.lieType, "tee");

  // a custom pin (addendum §6, {lat,lng}) held per hole in round state → frame point inside the green
  const pinLL = F1.toLatLng({ x: H1.green.center.x + 3, y: H1.green.center.y + 5 });
  const cp = assembleShotContext({ ...base, round: { ...base.round, pins: { 1: { lat: pinLL.lat, lng: pinLL.lon } } }, fix: { ...at(260, 0), accuracyM: 4 } });
  assert.ok(pointInRing(cp.pinPos, H1.green.ring));
  near(cp.pinPos.x, H1.green.center.x + 3, 0.1);
  assert.equal(cp.meta.distances.pinPos, "custom");

  // no fix on a later shot → no ball (the UI shows the no-GPS state); weather absent → calm, normal
  const nofix = assembleShotContext({ round: { hole: 1, shotNo: 3 }, hole: H1 });
  assert.equal(nofix.ball, null);
  assert.equal(nofix.wind, null);
  assert.equal(nofix.conditions, "normal");
  assert.equal(nofix.elevationDeltaYds, 0);
  assert.throws(() => assembleShotContext({}), /no hole/);
});
