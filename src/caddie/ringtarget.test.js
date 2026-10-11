/*
 * ringtarget.test.js — v22.44 (C35, D115): the ring sits on the target.
 * Brett, Bradshaw Red 2 (Oct 11): "the dispersion circle and the target are doing very weird things
 * by separating". A fairway-bound shot was sized with the plays-like effects taken over the
 * distance to the GREEN (a 6-iron from 329 into 14 mph was charged 72 yds, so its target sat at
 * 117), while the simulation sized it on its own line (finishing ~159, where the ring is drawn).
 * And a lay-up spot took the longest club even when it couldn't get there (a Driver "lay-up" to 344
 * that finishes ~245 — Red 2's Aggressive).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { recommend, generateCandidates, simulateCandidate, normalizeContext } from "./engine.js";
import { makeSamples } from "./random.js";
import { buildHole } from "./geo.js";
import { localGeometryFor } from "../localGeometry.js";
import { openPar5, noWaterPar4 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const bradshaw = JSON.parse(readFileSync(join(here, "../localGeometry/bradshaw.json"), "utf8"));
const geo = localGeometryFor([bradshaw], "xs7ypdb7").geometry;
const red2 = buildHole(geo, 2, { par: 5 });

/** A point on Red 2's tee → green chord `yds` from the green centre. */
function fromPin(hole, yds) {
  const T = hole.tee, G = hole.green.center, L = Math.hypot(G.x - T.x, G.y - T.y);
  return { x: G.x + (T.x - G.x) * yds / L, y: G.y + (T.y - G.y) * yds / L };
}
// Oct 11 on Red 2: 64°F, the wind 12–14 mph into, the green ~17 yds above the tee
const red2Ctx = (ball, o = {}) => ({ shotNo: 1, par: 5, ball, lieType: "tee", tempF: 64, elevFt: 1000, elevationDeltaYds: 17, ...o });
const offBy = (o) => Math.abs(o.meanYds - o.toTargetYds);

test("C35: off Red 2's tee into the wind, both calls finish on their targets — no Driver aimed at 340", () => {
  const r = recommend(red2Ctx(red2.tee, { wind: { speedMph: 12, fromDeg: 30 } }), red2, P);
  for (const o of [r.safe, r.aggressive].filter(Boolean)) {
    assert.ok(offBy(o) <= 3, `${o.club} ${o.kind} to ${o.toTargetYds} finishes ${o.meanYds}`);
  }
  assert.equal(r.safe.club, "Dr");
  assert.ok(r.safe.toTargetYds > 240, `the driver's target is where it finishes (${r.safe.toTargetYds}), not 219`);
});

test("C35: from 329 on Red 2 into 14 mph, every fairway-bound target is where its club finishes", () => {
  const ctx = normalizeContext(red2Ctx(fromPin(red2, 329), { wind: { speedMph: 14, fromDeg: 0 } }), red2);
  const samples = makeSamples(50, 1);
  const cands = generateCandidates(ctx, red2, P).filter((c) => c.kind === "corridor" && /, center$/.test(c.label));
  assert.ok(cands.length >= 5, `${cands.length} corridor centres`);
  for (const c of cands) {
    const s = simulateCandidate(c, ctx, red2, P, samples);
    assert.ok(Math.abs(s.meanYds - s.distToTarget) <= 2, `${c.club}: target ${s.distToTarget.toFixed(0)}, finishes ${s.meanYds.toFixed(0)}`);
  }
  const six = cands.find((c) => c.club === "6i");
  assert.ok(six && simulateCandidate(six, ctx, red2, P, samples).distToTarget > 145, "the 6-iron's target is not 117");
});

test("C35: no lay-up spot takes a club that finishes more than LAYUP_FIT_YDS short of it", () => {
  const fit = DEFAULT_CONFIG.LAYUP_FIT_YDS;
  const samples = makeSamples(50, 1);
  for (const [hole, ball, extra] of [
    [openPar5, { x: 0, y: 0 }, { lieType: "tee", shotNo: 1 }],
    [openPar5, { x: 0, y: 260 }, { lieType: "fairway", shotNo: 2 }],
    [red2, red2.tee, { lieType: "tee", shotNo: 1, wind: { speedMph: 12, fromDeg: 30 }, tempF: 64, elevationDeltaYds: 17 }],
  ]) {
    const ctx = normalizeContext({ par: hole.par, ball, ...extra }, hole);
    for (const c of generateCandidates(ctx, hole, P).filter((k) => k.kind === "layup")) {
      const s = simulateCandidate(c, ctx, hole, P, samples);
      assert.ok(s.distToTarget - s.meanYds <= fit + 0.5, `${hole.id} ${c.club} lay-up to ${s.distToTarget.toFixed(0)} finishes ${s.meanYds.toFixed(0)}`);
    }
  }
  const tee = normalizeContext({ par: 5, ball: { x: 0, y: 0 }, lieType: "tee", shotNo: 1 }, openPar5);
  assert.equal(generateCandidates(tee, openPar5, P).filter((c) => c.kind === "layup").length, 0, "540 yds out, no club reaches a lay-up spot");
});

test("C35: in still air at the profile's temperature a fairway center is the club's total away, from off the line too", () => {
  const ball = { x: 12, y: 0 };                                   // off-centre: the fairway's middle sits across the ball's line
  const ctx = normalizeContext({ par: 4, shotNo: 1, ball, lieType: "tee" }, noWaterPar4);
  const cands = generateCandidates(ctx, noWaterPar4, P).filter((c) => c.kind === "corridor");
  const total = (c) => { const e = resolveEntry(P, c.club, c.swing, "tee"); return e.carry + e.roll; };
  const d = (c) => Math.hypot(c.target.x - ball.x, c.target.y - ball.y);
  const centers = cands.filter((c) => /, center$/.test(c.label));
  assert.ok(centers.length >= 5 && centers.every((c) => Math.abs(c.target.x - ball.x) >= 10), "the centers sit across the line");
  for (const c of centers) assert.ok(Math.abs(d(c) - total(c)) < 0.5, `${c.club}: center ${d(c).toFixed(1)} vs total ${total(c).toFixed(1)}`);
  // the rest of the cut sits on the same depth: within a few yards of the finish
  for (const c of cands) assert.ok(Math.abs(d(c) - total(c)) < 3, `${c.club} ${c.label}: ${d(c).toFixed(1)} vs ${total(c).toFixed(1)}`);
});
