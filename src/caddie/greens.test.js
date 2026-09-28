// greens.js — v22.11 marked-green mode: the store, the synthetic hole, its pin presets, the
// engine ctx on it, and the anchor frame the previous-shot lines live in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  GREENS_KEY, loadGreens, saveGreen, greenFor, greenSlot, markedGreenHole, markedPinPoint, markedGreenContext,
  anchorFrame, reframe, toSyntheticFrame, nearMarkedGreen, markedEndLie, MARKED_PIN_PRESET_YDS, NOTE_NO_HAZARDS,
} from "./greens.js";
import { holeFrame, frameOf } from "./geo.js";
import { haversineM, destination, YARDS_PER_METER } from "../geometry.js";
import { pointInRing } from "./course.js";
import { recommend } from "./engine.js";
import { loadProfile } from "./profile.js";
import { pinPointFor } from "./caddieState.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

function memStorage(init = {}) {
  const map = new Map(Object.entries(init));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

// Ironwood, Fishers IN, roughly: a ball on a tee and a green 150 yds away bearing 60°.
const BALL = { lat: 39.9502, lon: -85.9817 };
const yd = (y) => y / YARDS_PER_METER;
const GREEN = destination(BALL, 60, yd(150));

/* ---------- the store ---------- */

test("greens store: save → load round-trips { [courseId]: { [holeKey]: { lat, lon, t } } } through injected storage", () => {
  const st = memStorage();
  assert.deepEqual(loadGreens(st), {}, "empty storage → no greens");
  const a = saveGreen(st, "ironwood", "7", { lat: 39.95, lng: -85.98 }, 1000);
  assert.deepEqual(a, { ironwood: { 7: { lat: 39.95, lon: -85.98, t: 1000 } } }, "lng accepted, stored as lon");
  saveGreen(st, "ironwood", "8", GREEN, 2000);
  saveGreen(st, 12345, 1, { lat: 1, lon: 2 }, 3000);
  const back = loadGreens(st);
  assert.deepEqual(Object.keys(back).sort(), ["12345", "ironwood"]);
  assert.deepEqual(greenFor(back, "ironwood", 8), { lat: GREEN.lat, lon: GREEN.lon, t: 2000 });
  assert.deepEqual(greenFor(back, 12345, "1"), { lat: 1, lon: 2, t: 3000 }, "ids and hole keys are strings either way");
  assert.equal(greenFor(back, "ironwood", 9), null);
  assert.equal(greenFor(back, "other", 7), null);
  // re-marking replaces that one hole, keeps the rest
  saveGreen(st, "ironwood", "7", { lat: 39.951, lon: -85.981 }, 4000);
  const again = loadGreens(st);
  assert.equal(again.ironwood["7"].lat, 39.951); assert.equal(again.ironwood["8"].t, 2000);
  // the raw key is the reserved one
  assert.ok(st.map.has(GREENS_KEY)); assert.equal(GREENS_KEY, "bogeyman-matches:greens:v1");
});

test("greens store: junk, bad points and throwing storage degrade to empty / no-op", () => {
  const st = memStorage({ [GREENS_KEY]: JSON.stringify({ a: { 1: { lat: "x", lon: 2 }, 2: { lat: 91, lon: 0 }, 3: { lat: 10, lon: 20 } }, b: 5 }) });
  assert.deepEqual(loadGreens(st), { a: { 3: { lat: 10, lon: 20, t: null } } });
  assert.deepEqual(loadGreens(memStorage({ [GREENS_KEY]: "{not json" })), {});
  assert.deepEqual(loadGreens(null), {});
  const broken = { getItem: () => { throw new Error("boom"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(saveGreen(broken, "c", "1", { lat: 1, lon: 1 }, 5), { c: { 1: { lat: 1, lon: 1, t: 5 } } }, "a failed write still returns the map for this session");
  assert.deepEqual(saveGreen(memStorage(), "c", "1", null), {}, "no point → nothing stored");
});

test("greenSlot: 18 holes → routing id + hole number; known nines → club id + nine.hole, shared across routings", () => {
  assert.deepEqual(greenSlot({ apiId: 77 }, 7), { courseId: "77", holeKey: "7" });
  const rw = { apiId: 501, clubApiId: 500, nines: { play: ["Red", "White"] } };
  const wb = { apiId: 502, clubApiId: 500, nines: { play: ["White", "Blue"] } };
  assert.deepEqual(greenSlot(rw, 3), { courseId: "500", holeKey: "Red.3" });
  assert.deepEqual(greenSlot(rw, 12), { courseId: "500", holeKey: "White.3" });
  assert.deepEqual(greenSlot(wb, 3), { courseId: "500", holeKey: "White.3" }, "White 3 is the same green in both routings");
  // a club whose nines are unknown keeps each routing's own hole numbers apart
  assert.deepEqual(greenSlot({ apiId: 503, clubApiId: 500 }, 3), { courseId: "503", holeKey: "3" });
  assert.deepEqual(greenSlot({ apiId: 1 }, 5, { apiId: "9", clubId: "8" }), { courseId: "9", holeKey: "5" }, "the caller's ids win");
});

/* ---------- the synthetic hole ---------- */

test("markedGreenHole: +y runs ball → green, the green 28 × 24 at the GPS distance, anchored in lat/lon, no hazards", () => {
  const hole = markedGreenHole({ ball: BALL, green: GREEN, holeNo: 7, par: 4 });
  const d = haversineM(BALL, GREEN) * YARDS_PER_METER;
  near(d, 150, 0.2, "fixture distance");
  near(hole.green.center.y, d, 0.3, "green centre y = GPS yards ball → green");
  assert.equal(hole.green.center.x, 0, "on the line");
  assert.deepEqual(hole.tee, { x: 0, y: 0 });
  near(hole.bearingDeg, 60, 0.05, "frame bearing = ball → green");
  assert.equal(hole.hazards.length, 0); assert.equal(hole.boundary, null); assert.equal(hole.synthetic, true);
  // the green's extent: 24 wide (x) × 28 deep (y)
  const xs = hole.green.ring.map((p) => p[0]), ys = hole.green.ring.map((p) => p[1]);
  near(Math.max(...xs) - Math.min(...xs), 24, 0.01, "green width");
  near(Math.max(...ys) - Math.min(...ys), 28, 0.01, "green depth");
  // a 40-yd corridor to the front of the green
  assert.equal(hole.fairways.length, 1);
  const fx = hole.fairways[0].map((p) => p[0]);
  assert.equal(Math.max(...fx) - Math.min(...fx), 40);
  // lat/lon anchoring: frameOf works, and the frame's green centre is the marked point
  const F = frameOf(hole);
  const g = F.toLatLng(hole.green.center);
  assert.ok(haversineM(g, GREEN) < 0.3, `green centre → lat/lon lands on the mark (${haversineM(g, GREEN).toFixed(2)} m)`);
  const b = F.toLatLng({ x: 0, y: 0 });
  assert.ok(haversineM(b, BALL) < 0.01, "origin = the ball");
  // a point 10 yds right of the line is right of the ball → green bearing (60 + 90 = 150°)
  const r = F.toLatLng({ x: 10, y: 0 }), r2 = destination(BALL, 150, yd(10));
  assert.ok(haversineM(r, r2) < 0.1, "+x = right of the line");
  // the key moves with the ball and with the green (camera refit), not otherwise
  assert.equal(markedGreenHole({ ball: BALL, green: GREEN, holeNo: 7 }).key, hole.key);
  assert.notEqual(markedGreenHole({ ball: destination(BALL, 60, 50), green: GREEN, holeNo: 7 }).key, hole.key);
  assert.notEqual(markedGreenHole({ ball: BALL, green: destination(GREEN, 0, 5), holeNo: 7 }).key, hole.key);
  // short shots: no corridor; nothing without both points
  assert.equal(markedGreenHole({ ball: BALL, green: destination(BALL, 60, yd(45)) }).fairways.length, 0);
  assert.equal(markedGreenHole({ ball: BALL, green: null }), null);
  assert.equal(markedGreenHole({ ball: null, green: GREEN }), null);
});

test("marked pin presets: front / back are ±10 yds along ball → green, middle the centre; a custom pin passes through", () => {
  const hole = markedGreenHole({ ball: BALL, green: GREEN, holeNo: 7 });
  const c = hole.green.center;
  assert.equal(MARKED_PIN_PRESET_YDS, 10);
  assert.deepEqual(markedPinPoint(hole, "middle"), c);
  near(markedPinPoint(hole, "front").y, c.y - 10, 1e-9, "front"); near(markedPinPoint(hole, "front").x, 0, 1e-9, "front x");
  near(markedPinPoint(hole, "back").y, c.y + 10, 1e-9, "back");
  // pinPointFor (what the map draws) agrees for the synthetic hole, and both presets are on the green
  for (const s of ["front", "middle", "back"]) {
    const q = pinPointFor(hole, hole.tee, s);
    assert.deepEqual(q, markedPinPoint(hole, s), s);
    assert.ok(pointInRing(q, hole.green.ring), `${s} on the green`);
  }
  // seen from off the line, "along ball → green" follows that line
  const off = { x: 30, y: c.y - 40 };
  const f = markedPinPoint(hole, "front", off);
  near(Math.hypot(c.x - off.x, c.y - off.y) - Math.hypot(f.x - off.x, f.y - off.y), 10, 1e-9, "10 yds nearer the ball");
  // custom: lat/lng → frame; pinPointFor clamps it inside the green
  const ll = frameOf(hole).toLatLng({ x: 5, y: c.y + 4 });
  const cu = markedPinPoint(hole, { lat: ll.lat, lng: ll.lon });
  near(cu.x, 5, 0.01, "custom x"); near(cu.y, c.y + 4, 0.01, "custom y");
  const far = frameOf(hole).toLatLng({ x: 40, y: c.y });
  assert.ok(pointInRing(pinPointFor(hole, hole.tee, { lat: far.lat, lng: far.lon }), hole.green.ring), "a custom pin off the green is clamped on");
});

test("markedGreenContext: the real engine on the synthetic hole — distance from GPS, presets priced, lie tee / fairway ?", () => {
  const hole = markedGreenHole({ ball: BALL, green: GREEN, holeNo: 7, par: 4 });
  const fix = { lat: BALL.lat, lng: BALL.lon, accuracyM: 4 };
  const round = (o = {}) => ({ hole: 7, par: 4, shotNo: 1, trigger: "tee", pins: {}, ...o });
  const tee = markedGreenContext({ hole, fix, round: round() });
  assert.equal(tee.lieType, "tee"); assert.equal(tee.lieConfidence, "high");
  const res = recommend(tee, hole, P);
  assert.ok(res && res.safe, "a recommendation comes back");
  near(res.context.distances.pin, 150, 1, "distance = GPS ball → marked green");
  assert.equal(res.safe.troubleRate, 0, "no hazards, no OB: nothing to price but distance");
  // a later shot: fairway at low confidence (the chip's ?), never inferred from the fake corridor
  const later = markedGreenContext({ hole, fix, round: round({ shotNo: 2, trigger: "ball" }) });
  assert.equal(later.lieType, "fairway"); assert.equal(later.lieConfidence, "low"); assert.equal(later.meta.sources.lie, "default");
  const rough = markedGreenContext({ hole, fix, round: round({ shotNo: 2, trigger: "ball" }), chips: { lie: "rough" } });
  assert.equal(rough.lieType, "rough"); assert.equal(rough.lieConfidence, "high");
  // presets: the engine prices the ±10-yd pin the map draws
  const back = markedGreenContext({ hole, fix, round: round({ pins: { 7: "back" } }) });
  near(recommend(back, hole, P).context.distances.pin, 160, 1, "back pin +10");
  const front = markedGreenContext({ hole, fix, round: round({ pins: { 7: "front" } }) });
  near(recommend(front, hole, P).context.distances.pin, 140, 1, "front pin −10");
  // weather wind turns into the synthetic frame (bearing 60°): a wind from the north is from the left-front
  const wx = { speedMph: 10, dirDeg: 0, asOf: "2026-09-29T15:00:00Z" };
  const w = markedGreenContext({ hole, fix, round: round(), weather: wx });
  near(w.wind.fromDeg, 300, 1e-6, "north wind on a 60° line → fromDeg 300");
});

test("anchor frame: previous-shot lines survive the synthetic frame moving with the ball", () => {
  const A = anchorFrame({ lat: 39.9534, lon: -85.9791 });
  assert.equal(A.origin.lat, 39.95); assert.equal(A.origin.lon, -85.98); assert.equal(A.bearingDeg, 0);
  assert.deepEqual(anchorFrame({ lat: 39.9549, lon: -85.9751 }).origin, A.origin, "nearby fallbacks share an origin");
  assert.equal(anchorFrame(null), null);
  const ball2 = destination(BALL, 60, yd(120));                      // the tee shot went 120 yds up the line
  const shot = { from: A.toFrame(BALL), to: A.toFrame(ball2) };
  const syn = frameOf(markedGreenHole({ ball: ball2, green: GREEN }));
  const [s] = toSyntheticFrame([shot], A, syn);
  near(s.to.x, 0, 0.05, "ends at the current ball (x)"); near(s.to.y, 0, 0.05, "ends at the current ball (y)");
  near(s.from.y, -120, 0.2, "started 120 yds back down the line"); near(s.from.x, 0, 0.2, "on the line");
  assert.deepEqual(toSyntheticFrame([shot], null, syn), []);
  const p = reframe({ x: 3, y: 4 }, syn, syn); near(p.x, 3, 1e-9, "identity"); near(p.y, 4, 1e-9, "identity");
});

test("re-mark reach and closeout lie on a marked green", () => {
  const hole = markedGreenHole({ ball: BALL, green: GREEN });
  const c = hole.green.center;
  assert.ok(nearMarkedGreen(hole, c));
  assert.ok(nearMarkedGreen(hole, { x: 0, y: c.y + 28 }), "within 15 yds of the green's edge");
  assert.ok(!nearMarkedGreen(hole, { x: 0, y: c.y - 40 }));
  assert.equal(markedEndLie(hole, c), "green");
  assert.equal(markedEndLie(hole, { x: 0, y: 50 }), null, "off the green the lie is unknown, not the fake fairway");
  assert.ok(NOTE_NO_HAZARDS.includes("prices distance only"));
  assert.ok(!NOTE_NO_HAZARDS.includes("!"));
});
