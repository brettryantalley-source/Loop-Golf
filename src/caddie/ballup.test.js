/*
 * ballup.test.js — v22.48 (C38, D119): the ball at the bottom centre, the target up, always.
 * Brett, Oct 11 (Bradshaw Red 1, putting from above the hole: the hole sat below the ball): "his
 * position always at the bottom centre with the target up". Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { linearProjector, upBearing, cameraForShot, cameraFor, cameraPoints, fitBounds } from "./overlay.js";

const vp = { width: 390, height: 844 }, insets = { top: 72, right: 92, bottom: 166, left: 64 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const ring = (cx, cy, r) => Array.from({ length: 12 }, (_, i) => ({ x: cx + r * Math.cos(i * Math.PI / 6), y: cy + r * Math.sin(i * Math.PI / 6) }));
// a dogleg right: the green sits 120 yds right of the tee line
const hole = { key: "dogleg", tee: { x: 0, y: 0 }, line: [{ x: 0, y: 0 }, { x: 0, y: 260 }, { x: 120, y: 400 }],
  green: { center: { x: 120, y: 400 }, ring: ring(120, 400, 14) } };
const opt = (target, extra = {}) => ({ target, kind: "corridor", ell: { w: 40, h: 20, tiltDeg: 0, dx: 0, dy: 0, innerFrac: 0.47 }, ...extra });
const region = { L: insets.left + 16, R: vp.width - insets.right - 16, T: insets.top + 16, B: vp.height - insets.bottom - 16 };

test("C38: the projector turns by rotDeg; 0 is the old hole-up projection", () => {
  const p = { x: 33, y: -12 };
  const flat = linearProjector({ center: { x: 10, y: 20 }, pxPerYd: 2 }, vp);
  assert.deepEqual(flat.project(p), { x: vp.width / 2 + (33 - 10) * 2, y: vp.height / 2 - (-12 - 20) * 2 });
  const L = linearProjector({ center: { x: 10, y: 20 }, pxPerYd: 2, rotDeg: 37 }, vp);
  const q = L.unproject(L.project(p));
  near(q.x, p.x, 1e-9, "x round trip"); near(q.y, p.y, 1e-9, "y round trip");
  // a point 50 yds along bearing 37 from the centre sits straight above it
  const up = L.project({ x: 10 + 50 * Math.sin(37 * Math.PI / 180), y: 20 + 50 * Math.cos(37 * Math.PI / 180) });
  near(up.x, vp.width / 2, 1e-9, "same x"); near(up.y, vp.height / 2 - 100, 1e-9, "100 px up");
});

test("C38: up is ball → SAFE's target, else the pin, else the green; none before the tee", () => {
  const ball = { x: 0, y: 0 };
  near(upBearing({ hole, ball, options: { safe: opt({ x: 0, y: 250 }) } }), 0, 1e-9, "straight down the tee line");
  near(upBearing({ hole, ball: { x: 0, y: 260 }, pin: { x: 120, y: 400 }, options: null }), Math.atan2(120, 140) * 180 / Math.PI, 1e-9, "no call: the pin");
  near(upBearing({ hole, ball: { x: 0, y: 260 }, options: null }), Math.atan2(120, 140) * 180 / Math.PI, 1e-9, "no pin: the green");
  assert.equal(upBearing({ hole, ball: null, options: null }), 0, "pre-tee: hole-up");
  // on the target itself, it faces the next thing instead
  near(upBearing({ hole, ball: { x: 0, y: 250 }, pin: { x: 120, y: 400 }, options: { safe: opt({ x: 0, y: 251 }) } }), Math.atan2(120, 150) * 180 / Math.PI, 1e-9, "ball on the target");
});

test("C38: with a ball, it sits at the bottom centre and SAFE's target straight above it; everything framed fits", () => {
  const ball = { x: 0, y: 260 }, target = { x: 110, y: 395 };
  const options = { safe: opt(target, { kind: "approach" }), aggressive: opt({ x: 125, y: 405 }, { kind: "approach" }) };
  const cam = cameraForShot({ hole, ball, pin: { x: 120, y: 400 }, options }, vp, insets);
  const { project } = linearProjector(cam, vp);
  const b = project(ball), t = project(target);
  near(b.x, (region.L + region.R) / 2, 1e-6, "ball at the region's centre");
  near(b.y, region.B - 0.1 * (region.B - region.T), 1e-6, "ball 10% above the bottom");
  near(t.x, b.x, 1e-6, "target straight above"); assert.ok(t.y < b.y - 100, "and well above");
  for (const p of cameraPoints({ hole, ball, pin: { x: 120, y: 400 }, options })) {
    const q = project(p);
    assert.ok(q.x >= region.L - 1e-6 && q.x <= region.R + 1e-6 && q.y >= region.T - 1e-6 && q.y <= region.B + 1e-6, `${JSON.stringify(p)} → ${JSON.stringify(q)}`);
  }
  // the toggle never turns or moves the map (T36): only SAFE sets the direction
  const other = cameraForShot({ hole, ball, pin: { x: 120, y: 400 }, options: { ...options, aggressive: opt({ x: 125, y: 405 }, { kind: "approach" }) } }, vp, insets);
  assert.deepEqual(other, cam);
});

test("C38: putting from above the hole, the hole is at the top", () => {
  const pin = { x: 120, y: 400 }, ball = { x: 126, y: 409 };   // past the hole, on the green, no call
  const cam = cameraForShot({ hole, ball, pin, options: null }, vp, insets);
  const { project } = linearProjector(cam, vp);
  const b = project(ball), h = project(pin);
  near(h.x, b.x, 1e-6, "the hole straight above the ball");
  assert.ok(h.y < b.y, `hole ${h.y} above ball ${b.y}`);
});

test("Creekside Oct 24: on the green the pin sits a quarter down the map, the ball at the bottom", () => {
  const pin = { x: 120, y: 400 }, ball = { x: 116, y: 390 };   // on the green, no call, ~11 yds
  const holeA = { ...hole, green: { ...hole.green, ring: hole.green.ring.map((q) => [q.x, q.y]) } };   // course.js rings are [x, y]
  const cam = cameraForShot({ hole: holeA, ball, pin, options: null }, vp, insets);
  const { project } = linearProjector(cam, vp);
  const b = project(ball), h = project(pin);
  const Tp = insets.top + 16, Bt = vp.height - insets.bottom - 16, rh = Bt - Tp;
  near(h.y, Tp + 0.25 * rh, 1e-6, "the pin a quarter down the visible region");
  near(b.y, Bt - 0.1 * rh, 1e-6, "the ball at the bottom");
  near(h.x, b.x, 1e-6, "the pin straight above the ball");
  assert.ok(cam.pxPerYd > 12, `closer than a shot's cap (${cam.pxPerYd.toFixed(1)} px/yd)`);
  // a tap-in stops at the cap rather than filling the screen with one yard
  const tap = cameraForShot({ hole: holeA, ball: { x: 120, y: 398.5 }, pin, options: null }, vp, insets);
  assert.equal(tap.pxPerYd, 48);
});

test("C38: before the tee shot it is the hole-up fit, as before", () => {
  const cam = cameraForShot({ hole, ball: null, pin: null, options: null }, vp, insets);
  assert.deepEqual(cam, { ...cameraFor(fitBounds(cameraPoints({ hole, ball: null, pin: null, options: null })), vp, insets), rotDeg: 0 });
});
