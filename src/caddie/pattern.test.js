/*
 * pattern.test.js — v22.55 (C45, D126): the map draws Shot Pattern's own rings and Brett's real shots.
 * Brett, Oct 11 (the Driver, 2-iron, 2-hybrid and 4-hybrid at 70% coverage): "the best 70% is the more
 * prominent dispersion circle (and i'd want the shape to be consistent with the shot pattern shape) with
 * the full 100% being represented in a faint, dotted line ... of the 40 shots we want represented, can we
 * color them green, yellow, and red based on where they land? ... use actual shots and then fill in with
 * simulated shots to get up to the 40". Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { patternRingFromEntry, ellipseFromEntry, withEllipses, patternDots, dotTone, bboxYds, K70, K80 } from "./overlay.js";
import { openPar5, waterRightPar4 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const ring = (club, lie, opts) => patternRingFromEntry(resolveEntry(P, club, club === "SW" || club === "LW" ? "finesse" : "full", lie), opts);
/** (x, y) inside the ellipse { w, h, tiltDeg } centred at (cx, cy), SP frame. */
const inside = (e, cx, cy, [x, y], slack = 1.02) => {
  const t = (e.tiltDeg * Math.PI) / 180, X = x - cx, Y = y - cy;
  const u = (X * Math.cos(t) + Y * Math.sin(t)) / (e.w / 2), v = (-X * Math.sin(t) + Y * Math.cos(t)) / (e.h / 2);
  return u * u + v * v <= slack * slack;
};

test("C45: the 70% ring is the one Shot Pattern printed — its Width × Depth from the Oct 11 screenshots", () => {
  for (const [club, w, d] of [["Dr", 91, 85], ["2i", 76, 78], ["2Hy", 69, 83], ["4Hy", 76, 60]]) {
    const r = ring(club, "tee");
    const b = bboxYds(r);
    near(b.w, w, 1.5, `${club} width`); near(b.d, d, 1.5, `${club} depth`);
    assert.equal(r.pattern, true); assert.equal(r.capturedAt, "2026-10-11");
  }
  // the rest come from their 80% stills, scaled to 70% as Shot Pattern's slider does (2-iron: 88 → 76)
  near(K70 / K80, 0.865, 0.001, "70% / 80% contour");
  const pw = bboxYds(ring("PW", "fairway"));
  near(pw.w, 36 * K70 / K80, 1.5, "PW width"); near(pw.d, 51 * K70 / K80, 1.5, "PW depth");
  // its tilt is Shot Pattern's, not square to the line
  assert.ok(Math.abs(ring("4Hy", "tee").tiltDeg - 112) < 2, "4-hybrid tilted as printed");
  // the 4-hybrid from the fairway reads its tee pattern (the lie chain, D113)
  assert.deepEqual(bboxYds(ring("4Hy", "fairway")), bboxYds(ring("4Hy", "tee")));
});

test("C45: the 100% ring holds every real shot, and the real shots are all of them", () => {
  for (const [club, lie, n] of [["Dr", "tee", 117], ["2i", "tee", 26], ["2Hy", "tee", 12], ["4Hy", "tee", 16], ["GW", "fairway", 15], ["PW", "fairway", 6]]) {
    const r = ring(club, lie);
    assert.ok(r.outer && r.outer.w > r.w && r.outer.h > r.h, `${club}: the 100% ring is bigger`);
    for (const d of r.dots) assert.ok(inside(r.outer, r.outer.dx, r.outer.dy, d, 1.05), `${club}: dot ${d} inside the 100% ring`);
    assert.equal(r.patternN, n, `${club}: Shot Pattern's shot count`);
    assert.ok(r.dots.length >= Math.min(n, 100) * 0.85, `${club}: ${r.dots.length} of ${n} shots read`);
  }
  const dr = ring("Dr", "tee");
  assert.ok(dr.outer.w > 2 * dr.w, "the Driver's worst drive is a long way out");
});

test("C45: a bad lie widens the rings and spreads the shots, as it does the draws", () => {
  const a = ring("7i", "fairway"), b = ring("7i", "fairway", { lieQuality: "bad" });
  near(b.w, a.w * 1.15, 1e-9, "w"); near(b.outer.h, a.outer.h * 1.15, 1e-9, "outer h");
  near(b.dots[0][0], a.dots[0][0] * 1.15, 1e-9, "dot x"); near(b.dy - a.dy, 5, 1e-9, "5 yds short");
  // the rough reads the fairway pattern widened by the lie multiplier
  const rough = resolveEntry(P, "7i", "full", "rough");
  near(patternRingFromEntry(rough).w, a.w * rough.ell80.sdMult, 1e-9, "rough");
});

test("C45: no pattern (Loop's own ring) → the 70% contour of that ring, no 100% ring, no real shots", () => {
  const e = resolveEntry(P, "PW", "full", "fairway");
  const loop = { ...e, ell80: { ...e.ell80, pattern: undefined, source: "loop" } };
  const r = patternRingFromEntry(loop), base = ellipseFromEntry(loop);
  near(r.w, base.w * K70 / K80, 1e-9, "w"); near(r.h, base.h * K70 / K80, 1e-9, "h");
  assert.equal(r.outer, null); assert.equal(r.dots, null); assert.equal(r.pattern, false);
});

test("C45: 40 dots — his real shots first, then draws from the 70% ring inside the 100% ring; fixed by the seed", () => {
  const ball = { x: 0, y: 0 };
  const opts = (club, lie) => withEllipses({ safe: { club, swingType: "full", target: { x: 0, y: 220 }, kind: "corridor" }, sameShot: true }, () => resolveEntry(P, club, "full", lie)).safe;
  const hy = opts("4Hy", "tee");
  const dots = patternDots(hy, ball, openPar5);
  assert.equal(dots.length, DEFAULT_CONFIG.RING_DOTS);
  assert.equal(dots.filter((d) => d.real).length, 16, "all 16 real 4-hybrids");
  assert.deepEqual(patternDots(hy, ball, openPar5), dots, "same seed, same dots");
  // every one sits inside the 100% ring round the ring's centre
  const T = hy.ell;
  for (const d of dots) {
    const sp = [d.x - 0 - T.dx, -(d.y - 220) - T.dy];        // shot straight up the hole: SP x = hole x, SP y = −(hole y − target y)
    assert.ok(inside(T.outer, T.outer.dx, T.outer.dy, sp, 1.03), `inside the 100% ring: ${sp}`);
  }
  // a real shot lands where Shot Pattern put it, from the ring's centre
  const first = dots.find((d) => d.real);
  near(first.x, T.dx + T.dots[0][0], 0.06, "real dot x"); near(first.y, 220 - (T.dy + T.dots[0][1]), 0.06, "real dot y (SP +y = short)");
  // the Driver has 105 read: 40 of them, all real
  const dr = patternDots(opts("Dr", "tee"), ball, openPar5);
  assert.equal(dr.length, 40); assert.ok(dr.every((d) => d.real), "Driver: 40 real drives");
  // fewer wanted, fewer drawn
  assert.equal(patternDots(hy, ball, openPar5, { n: 10 }).length, 10);
  // the picture turns with the shot: a target due east puts SP "short" to the west
  const east = { ...hy, target: { x: 220, y: 0 } };
  const e0 = patternDots(east, ball, null).find((d) => d.real);
  near(e0.x, 220 - (T.dy + T.dots[0][1]), 0.06, "east: short is −x"); near(e0.y, -(T.dx + T.dots[0][0]), 0.06, "east: right is −y");
});

test("C45: each dot is coloured by where it finishes — fairway green, rough yellow, trouble red", () => {
  assert.equal(dotTone("fairway"), "fairway"); assert.equal(dotTone("green"), "fairway"); assert.equal(dotTone("tee"), "fairway");
  assert.equal(dotTone("rough"), "rough");
  for (const l of ["water", "ob", "sand", "trees"]) assert.equal(dotTone(l), "trouble", l);
  assert.equal(dotTone(null), null);
  const ball = { x: 0, y: 0 };
  const dr = withEllipses({ safe: { club: "Dr", swingType: "full", target: { x: 0, y: 270 }, kind: "corridor" }, sameShot: true }, () => resolveEntry(P, "Dr", "full", "tee")).safe;
  // the open par 5: a 60-yd fairway (x −30…30), rough either side, nothing else
  const open = patternDots(dr, ball, openPar5);
  for (const d of open) assert.equal(d.tone, Math.abs(d.x) <= 30 && d.y >= 60 ? "fairway" : "rough", `${d.x},${d.y}`);
  assert.ok(open.some((d) => d.tone === "fairway") && open.some((d) => d.tone === "rough"), "both on the open hole");
  // water down the right from 200 to 340: the drives that finish in it go red
  const wet = patternDots({ ...dr, target: { x: 0, y: 260 } }, ball, waterRightPar4);
  assert.ok(wet.some((d) => d.tone === "trouble" && d.lie === "water"), "some in the water");
  for (const d of wet) if (d.x >= 28 && d.x <= 90 && d.y >= 200 && d.y <= 340) assert.equal(d.tone, "trouble");
  // no hole (marked-green mode): no lie, no colour
  assert.ok(patternDots(dr, ball, null).every((d) => d.lie === null && d.tone === null));
});
