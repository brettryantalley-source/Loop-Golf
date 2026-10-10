/*
 * aim.test.js — v22.22 (C3, D93): aim for the pattern, and the Line drawn on its own. Every target
 * is where the ball finishes on average; the shot is aimed off it by the good-shot ring's lateral
 * offset (D92) plus the crosswind (R3). The rings centre on the target, the caddie's start line runs
 * ball → aim point, and the learning loop adds the aim-off back so it keeps seeing the pattern.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { mergeConfig } from "./config.js";
import { loadProfile, candidateEntries, resolveEntry } from "./profile.js";
import { aimFor, simulateCandidate, normalizeContext, recommend, priceTarget } from "./engine.js";
import { makeSamples } from "./random.js";
import { withEllipses, screenEllipseFor, linearProjector, overlayModel, aimPointFor, aimLineDeg } from "./overlay.js";
import { shotIntent, normIntent, newShotRecord, closeOutShot } from "./shotlog.js";
import { patternLatYds, applyShotLog, tendencies } from "./learning.js";
import { openPar5 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const Pna = loadProfile(RAW, mergeConfig({ PATTERN_AIM_MIN_YDS: Infinity }));   // the aim-off switched off (before v22.22)
const GREEN = { x: 0, y: 540 };
const LEFT_WIND = { speedMph: 10, fromDeg: 270 };   // from the left of the hole: pushes the ball right

/** One club's approach to the middle of the open par 5's green from its own carry, simulated. */
function approach(club, Pr = P, wind = null) {
  const e = candidateEntries(Pr, "fairway").find((x) => x.club === club && x.swing === "full");
  const ball = { x: 0, y: GREEN.y - Math.round(e.carry) };
  const ctx = normalizeContext({ shotNo: 2, ball, lieType: "fairway", wind }, openPar5);
  const cand = { club, swing: "full", entry: e, kind: "approach", target: { ...GREEN }, label: "green, center" };
  return { e, ball, sim: simulateCandidate(cand, ctx, openPar5, Pr, makeSamples(Pr.config.SAMPLES, Pr.config.SEED)) };
}

test("C3: an 8-iron to the middle aims ~7 yds right and its average shot finishes within 2 yds of the middle", () => {
  const { e, sim } = approach("8i");
  assert.equal(e.ell80.dxYds, -7.1, "the good-shot ring sits 7.1 yds left (D92)");
  assert.ok(Math.abs(sim.aimOffsetYds - 7.1) < 1e-9, `aims ${sim.aimOffsetYds} right`);
  assert.equal(sim.patternYds, -7.1);
  assert.ok(Math.abs(sim.meanLatYds) <= 2, `finishes ${sim.meanLatYds.toFixed(1)} from the middle`);
  // without the aim-off the same shot finishes left of the middle by about the pattern
  const before = approach("8i", Pna).sim;
  assert.equal(before.aimOffsetYds, 0);
  assert.ok(before.meanLatYds < -5, `before C3: ${before.meanLatYds.toFixed(1)}`);
  // the aim-off makes the middle an easier target, never a harder one
  assert.ok(sim.parProb >= before.parProb, `par ${sim.parProb.toFixed(3)} vs ${before.parProb.toFixed(3)}`);
});

test("C3 / R3: the aim-off includes the crosswind; a drift under 2 yds is aimed straight", () => {
  const w = approach("8i", P, LEFT_WIND).sim;
  assert.ok(w.windYds > 3, `a 10 mph wind from the left pushes it ${w.windYds.toFixed(1)} right`);
  assert.ok(Math.abs(w.aimOffsetYds + (w.patternYds + w.windYds)) < 1e-9, "aim = −(pattern + wind)");
  assert.ok(Math.abs(w.meanLatYds) <= 2, `with the wind: ${w.meanLatYds.toFixed(1)}`);
  const six = approach("6i").sim;                      // 6-iron ring: 1.2 yds left
  assert.equal(six.aimOffsetYds, 0, "under PATTERN_AIM_MIN_YDS: aimed at the target");
  assert.deepEqual(aimFor({ ell80: { dxYds: -1.2 } }, 0, P.config), { patternYds: -1.2, windYds: 0, aimOffsetYds: 0 });
  assert.deepEqual(aimFor({ ell80: { dxYds: -1.2 } }, -1, P.config), { patternYds: -1.2, windYds: -1, aimOffsetYds: 2.2 });
  assert.deepEqual(aimFor({ biasLat: null }, 0, P.config), { patternYds: 0, windYds: 0, aimOffsetYds: 0 }, "no ring, no bias: straight");
});

test("C3: every shot aims off — off the tee only the wind moves it; Brett's own target carries the aim-off for its club", () => {
  const calm = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" }, openPar5, P);
  assert.equal(calm.safe.aimOffsetYds, 0, "no tee club has a measured lateral pattern");
  const windy = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", wind: LEFT_WIND }, openPar5, P);
  assert.ok(windy.safe.windYds > 2, `tee shot drift ${windy.safe.windYds}`);
  assert.equal(windy.safe.aimOffsetYds, -windy.safe.windYds, `${windy.safe.club} ${windy.safe.kind}: aims into the wind`);
  const own = priceTarget({ shotNo: 2, ball: { x: 0, y: 540 - 165 }, lieType: "fairway" }, openPar5, P, { x: 3, y: 540 });
  const pat = resolveEntry(P, own.club, "full", "fairway").ell80?.dxYds ?? 0;
  assert.equal(own.aimOffsetYds, Math.abs(pat) >= 2 ? -pat : 0, `${own.club}: the marker is where it finishes`);
});

test("C3: both rings centre on the target; the drift shows only when it is under the floor", () => {
  const resolve = (c, s) => resolveEntry(P, c, s, "fairway");
  const ball = { x: 0, y: 375 };
  const opt = (club, o) => ({ club, swingType: "full", kind: "approach", target: { ...GREEN, label: "green, center" }, ...o });
  const on = withEllipses({ safe: opt("8i", { aimOffsetYds: 7.1, patternYds: -7.1, windYds: 0 }), sameShot: true }, resolve).safe;
  assert.equal(on.ell.dx, 0, "8-iron: aimed out, the ring sits on the target");
  const windy = withEllipses({ safe: opt("8i", { aimOffsetYds: 2.1, patternYds: -7.1, windYds: 5 }), sameShot: true }, resolve).safe;
  assert.equal(windy.ell.dx, 0, "with the wind in the aim too");
  const six = withEllipses({ safe: opt("6i", { aimOffsetYds: 0, patternYds: -1.2, windYds: 0 }), sameShot: true }, resolve).safe;
  assert.equal(six.ell.dx, -1.2, "6-iron: under the floor, the ring keeps its 1.2 yds left");
  const { project } = linearProjector({ center: { x: 0, y: 460 }, pxPerYd: 2 }, { width: 375, height: 812 });
  const se = screenEllipseFor(on, ball, project), T = project(GREEN);
  assert.ok(Math.hypot(se.e.cx - T.x, se.e.cy - T.y) < 0.01, "the drawn centre is the target");
  const m = overlayModel({ project, hole: openPar5, ball, pin: GREEN, active: on });
  const cur = m.find((n) => n.attrs?.["data-part"] === "cur").children;
  const outer = cur.find((n) => n.attrs["data-part"] === "ellipse"), inner = cur.find((n) => n.attrs["data-part"] === "ellipse-inner");
  for (const r of [outer, inner]) assert.deepEqual([r.attrs.cx, r.attrs.cy], [Math.round(T.x * 10) / 10, Math.round(T.y * 10) / 10]);
});

test("C3: the caddie's line runs from the ball through the aim point; Brett's own Line replaces it", () => {
  const ball = { x: 0, y: 375 };
  const active = { club: "8i", kind: "approach", target: { ...GREEN }, aimOffsetYds: 7.1, ell: { w: 30, h: 20, tiltDeg: 0, dx: 0, dy: 0, innerFrac: 0.47 } };
  const A = aimPointFor(active, ball);
  assert.ok(Math.abs(A.x - 7.1) < 1e-9 && Math.abs(A.y - 540) < 1e-9, "7.1 yds right of the target, square to the line");
  assert.ok(aimLineDeg(active, ball) > 2 && aimLineDeg(active, ball) < 3);
  const { project } = linearProjector({ center: { x: 0, y: 460 }, pxPerYd: 2 }, { width: 375, height: 812 });
  const partsOf = (m) => m.find((n) => n.attrs?.["data-part"] === "cur").children;
  const g = partsOf(overlayModel({ project, hole: openPar5, ball, pin: GREEN, active })).find((n) => n.attrs["data-part"] === "aim-line");
  assert.ok(g, "drawn with a call on screen");
  const ln = g.children[g.children.length - 1].attrs, Ap = project(A);
  const cross = (ln.x2 - ln.x1) * (Ap.y - ln.y1) - (ln.y2 - ln.y1) * (Ap.x - ln.x1);
  assert.ok(Math.abs(cross) / Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1) < 0.5, "the ray passes through the aim point");
  assert.ok(ln.strokeDasharray && !ln.filter, "dashed and printed, not pencil");
  const mine = overlayModel({ project, hole: openPar5, ball, pin: GREEN, active, intent: { lineDeg: 0 } });
  assert.ok(!partsOf(mine).some((n) => n.attrs["data-part"] === "aim-line"), "his line replaces it");
  assert.ok(JSON.stringify(mine).includes('"start-line"'));
});

test("C3: an untouched line is not logged as his; an on-pattern shot reads ~0 from the target, and learning still sees the pattern", () => {
  const ball = { x: 0, y: 375 }, F = { x: 0, y: 540 };
  const option = { club: "8i", swingType: "full", target: { ...F, label: "green, center" }, aimOffsetYds: 7.1, windYds: 0 };
  const it = shotIntent({ option, ball });
  assert.equal(it.startLineDeg, null, "startLine stays null");
  assert.equal(it.source, "default");
  assert.equal(it.aimOffsetYds, 7.1);
  assert.deepEqual(normIntent(JSON.parse(JSON.stringify(it))), it, "the aim-off survives storage");
  let n = 0;
  const shot = (end, intent) => closeOutShot(newShotRecord({ id: `s${++n}`, roundId: `r${n}`, ts: `2026-10-0${n}T15:00:00Z`, club: "8i", shotType: "full",
    lie: { confirmed: "fairway" }, start: { frame: ball, distanceToPinYds: 165 }, intent }),
    { endGps: { lat: 34, lng: -84 }, endLie: "green", endAccuracyM: 4, endFrame: end, intent });
  const onPattern = shot({ x: 0, y: 540 }, it);
  assert.equal(onPattern.derived.lateralMissYds, 0, "measured from the target: on target");
  assert.equal(onPattern.derived.latMissYds, 0);
  assert.equal(patternLatYds(onPattern), -7.1, "from the line it started on: the 8-iron's 7 yds left");
  // his own Line, straight at the target: the same 7 yds left is a miss from the target and the pattern from his line
  const own = shot({ x: -7.1, y: 540 }, shotIntent({ option, ball, set: { startLineDeg: 0 } }));
  assert.equal(own.derived.lateralMissYds, -7.1);
  assert.equal(patternLatYds(own), -7.1);
  // with the wind in the aim: the drift the caddie allowed for comes back out
  const windIt = shotIntent({ option: { ...option, aimOffsetYds: 2.1, windYds: 5 }, ball });
  assert.equal(patternLatYds(shot({ x: 0, y: 540 }, windIt)), -7.1);
  // a record from before v22.22 reads as it always did
  const legacy = { ...onPattern, intent: { ...onPattern.intent, aimOffsetYds: undefined } };
  delete legacy.intent.aimOffsetYds;
  assert.equal(patternLatYds(legacy), 0);
  // three on-pattern shots: the profile overlay keeps the bias, the tendencies keep the side
  const recs = [onPattern, shot({ x: 0.5, y: 540 }, it), shot({ x: -0.5, y: 540 }, it)];
  const ov = applyShotLog(P, recs, { now: "2026-10-10T00:00:00Z" })["8i|full|fairway"];
  assert.ok(Math.abs(ov.personal.biasLatYds + 7.1) < 0.2, `learned bias ${ov.personal.biasLatYds}`);
  assert.equal(tendencies(recs)["8i"].leftPct, 100, "it still misses left of where it is aimed");
});
