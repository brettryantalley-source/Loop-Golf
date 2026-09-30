/*
 * review.test.js — SPEC-shotlog-v2 §4 / §9 T48: the hole's Review model, placing a shot and the
 * chain recompute, putt inference, count mismatch, a fully manual hole placed from scratch.
 * Run: node --test src/caddie/review.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { holeReview, reviewNeeded, splitHole, placeShot, recomputeChain, setShotIntent, lineFromTap, deleteStroke, renumber, inferredPutts, reviewAll } from "./review.js";
import { autoShotRecord, quickLog, newPuttRecord, quickMade, shotIntent, closeOutShot } from "./shotlog.js";
import { holeFrame } from "./geo.js";

const F = holeFrame({ origin: { lat: 34.3, lon: -84.06 }, bearingDeg: 20 });
const LL = (p) => { const q = F.toLatLng(p); return { lat: q.lat, lng: q.lon }; };
const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;

/** A closed long shot on hole 7: start → end in F, aimed at `target`. */
function shotRec(shotNo, start, end, target, { reviewed = true, id } = {}) {
  const intent = { ...shotIntent({ option: { club: "7i", target: { ...target, label: "fairway" } }, ball: start }), targetLL: LL(target) };
  const base = { id: id ?? `s${shotNo}`, roundId: "r1", courseId: "c1", hole: 7, shotNo, club: "7i",
    start: { ...LL(start), accuracyM: 4, frame: start, distanceToPinYds: 300 }, intent,
    recommendation: { safe: { club: "7i", target }, aggressive: null } };
  const rec = reviewed ? quickLog(base) : autoShotRecord(base);
  return closeOutShot(rec, { endGps: LL(end), endLie: "fairway", endAccuracyM: 4, endFrame: end });
}
const putt = (n, made = false) => (made ? quickMade : newPuttRecord)({ id: `p${n}`, roundId: "r1", hole: 7, shotNo: n, distanceFt: made ? 3 : 20, made });

test("T48 review: 5 strokes, 2 putt records, 2 shot records → one missing row; placing it recomputes both neighbours; Save all marks reviewed; count mismatch reported", () => {
  // shot 1 tee → (5, 240); shot 3 from (0, 380) → green. Shot 2 was never logged (no fix either).
  const s1 = shotRec(1, { x: 0, y: 0 }, { x: 5, y: 240 }, { x: 0, y: 250 }, { reviewed: false });
  const s3 = shotRec(3, { x: 0, y: 380 }, { x: 2, y: 452 }, { x: 0, y: 450 });
  const putts = [putt(1), putt(2, true)];
  let R = holeReview([s1, s3], putts, 5, 7);
  assert.deepEqual(R.header, { hole: 7, score: 5, shots: 3, putts: 2 });
  assert.deepEqual(R.rows.map((r) => [r.kind, r.n, r.missing ?? false, r.pos ?? null]), [
    ["shot", 1, false, "GPS"], ["shot", 2, true, "—"], ["shot", 3, false, "GPS"], ["putt", 1, false, null], ["putt", 2, false, null],
  ]);
  assert.equal(R.rows[0].intent, "default"); assert.equal(R.rows[0].result, "−1 short · 5 R"); assert.equal(R.rows[0].unreviewed, true);
  assert.equal(R.rows[3].result, "20 ft"); assert.equal(R.rows[4].result, "made");
  assert.deepEqual(R.problems.map((p) => p.type).sort(), ["missing", "unreviewed"]);
  assert.equal(R.needed, true);
  assert.equal(reviewNeeded([s1, s3, ...putts], 7, 5), true);

  // Place shot 2 at (−10, 250): shot 1's end moves there, shot 2 gets a record ending at shot 3's start
  let recs = placeShot([s1, s3, ...putts], 2, { x: -10, y: 250 }, { frame: F, hole: 7, base: { roundId: "r1", courseId: "c1" } });
  const { shots } = splitHole(recs, 7);
  assert.equal(shots.length, 3);
  const [a, b, c] = shots;
  assert.ok(near(a.derived.latMissYds, -10) && near(a.derived.distMissYds, 0), `shot 1 re-closed at the placed ball: ${JSON.stringify(a.derived)}`);
  assert.ok(near(a.end.lat, LL({ x: -10, y: 250 }).lat, 1e-7));
  assert.equal(b.placed, true); assert.equal(b.shotNo, 2); assert.equal(b.logged, "auto"); assert.equal(b.reviewed, false);
  assert.ok(near(b.end.lat, s3.start.lat, 1e-9), "shot 2 ends where shot 3 starts");
  assert.equal(b.derived.distMissYds, null, "no intent target yet → no result");
  assert.deepEqual(c.derived, s3.derived, "shot 3 is not a neighbour of the placement: untouched");
  // shot 2's intent on the mini map: a target → a result, and the line from a tap
  recs = setShotIntent(recs, b.id, { target: { x: 0, y: 380 }, shape: "fade" }, { frame: F });
  const b2 = splitHole(recs, 7).shots[1];
  assert.equal(b2.intent.source, "set"); assert.equal(b2.intendedShape, "fade");
  assert.ok(near(b2.derived.distMissYds, 0) && near(b2.derived.latMissYds, 0));
  assert.ok(near(lineFromTap(recs, b.id, { x: 0, y: 350 }, { frame: F }), 5.7, 0.2), "bearing from the placed ball");
  assert.equal(lineFromTap(recs, b.id, { x: -10, y: 251 }, { frame: F }), null, "a tap on the ball clears");

  R = holeReview(splitHole(recs, 7).shots, putts, 5, 7);
  assert.ok(!R.problems.some((p) => p.type === "missing"));
  assert.ok(R.problems.some((p) => p.type === "unreviewed"));
  // Save all
  recs = reviewAll(recs);
  R = holeReview(splitHole(recs, 7).shots, splitHole(recs, 7).putts, 5, 7);
  assert.equal(R.needed, false); assert.equal(R.story, 5);

  // count mismatch: the card says 4, the story has 5 — reported, nothing on the scorecard changes
  R = holeReview(splitHole(recs, 7).shots, putts, 4, 7);
  assert.deepEqual(R.problems.find((p) => p.type === "count"), { type: "count", story: 5, score: 4 });
  // Delete stroke renumbers the later shots; the story is back to 4
  const del = deleteStroke(recs, b.id);
  assert.deepEqual(splitHole(del, 7).shots.map((r) => [r.id, r.shotNo]), [["s1", 1], ["s3", 2]]);
  assert.equal(holeReview(splitHole(del, 7).shots, putts, 4, 7).problems.length, 0);
});

test("review: putt inference when the putt log is empty — stepper default = score − shots, records with distance null", () => {
  const s1 = shotRec(1, { x: 0, y: 0 }, { x: 0, y: 150 }, { x: 0, y: 160 });
  let R = holeReview([s1], [], 3, 7);
  assert.equal(R.puttsNeeded, true); assert.equal(R.puttsDefault, 2);
  assert.deepEqual(R.header, { hole: 7, score: 3, shots: 1, putts: 2 });
  assert.deepEqual(R.rows.map((r) => [r.kind, r.virtual ?? false]), [["shot", false], ["putt", true], ["putt", true]]);
  assert.ok(R.problems.some((p) => p.type === "putts"));
  // the stepper at 1 → the story is 2 against a 3: missing stroke + count mismatch? no — one more shot row expected
  R = holeReview([s1], [], 3, 7, { puttCount: 1 });
  assert.deepEqual(R.rows.map((r) => [r.kind, r.n, r.missing ?? false]), [["shot", 1, false], ["shot", 2, true], ["putt", 1, false]]);
  const made = inferredPutts(2, { roundId: "r1", hole: 7 });
  assert.deepEqual(made.map((p) => [p.shotNo, p.putt.made, p.putt.distanceFt, p.putt.speed]), [[1, false, null, null], [2, true, null, null]]);
  assert.ok(made.every((p) => p.shotType === "putt" && p.reviewed === true));
  R = holeReview([s1], made, 3, 7);
  assert.equal(R.needed, false);
  // a hole nobody logged anything on never asks (scorecard-only rounds)
  assert.equal(reviewNeeded([], 7, 4), false);
  // an old record (no `reviewed`) counts as reviewed
  const old = { ...s1 }; delete old.reviewed;
  assert.equal(holeReview([old], made, 3, 7).needed, false);
});

test("review: a fully manual hole (no fixes at all) placed from scratch", () => {
  // score 4, putts logged 2, no shot records: two missing rows
  const putts = [putt(1), putt(2, true)];
  let recs = [...putts];
  let R = holeReview([], putts, 4, 7);
  assert.deepEqual(R.rows.filter((r) => r.kind === "shot").map((r) => r.missing), [true, true]);
  recs = placeShot(recs, 1, { x: 0, y: 0 }, { frame: F, hole: 7, base: { roundId: "r1", courseId: "c1" } });
  recs = placeShot(recs, 2, { x: 4, y: 260 }, { frame: F, hole: 7, base: { roundId: "r1", courseId: "c1" } });
  const { shots } = splitHole(recs, 7);
  assert.deepEqual(shots.map((r) => [r.shotNo, r.placed, r.start.accuracyM]), [[1, true, null], [2, true, null]]);
  assert.ok(near(shots[0].end.lat, shots[1].start.lat, 1e-9), "shot 1 ends at placed shot 2");
  // an aim for the tee shot → its result, from placed points only (accuracy null is not low accuracy)
  recs = setShotIntent(recs, shots[0].id, { target: { x: 0, y: 250 } }, { frame: F });
  const t = splitHole(recs, 7).shots[0];
  assert.ok(near(t.derived.distMissYds, 10) && near(t.derived.latMissYds, 4));
  assert.equal(t.derived.curveAuto, 0); assert.equal(t.derived.distClass, 1); assert.equal(t.derived.derivedLowAcc, false);
  R = holeReview(splitHole(recs, 7).shots, putts, 4, 7);
  assert.ok(!R.problems.some((p) => p.type === "missing" || p.type === "count"));
  assert.equal(R.rows[0].pos, "placed"); assert.equal(R.rows[0].intent, "set");
  // without a frame nothing can be placed
  assert.equal(placeShot(putts, 1, { x: 0, y: 0 }, { hole: 7 }), putts);
});

test("review: renumber and recomputeChain leave untouched records alone", () => {
  const s1 = shotRec(1, { x: 0, y: 0 }, { x: 5, y: 240 }, { x: 0, y: 250 });
  const s2 = shotRec(2, { x: 5, y: 240 }, { x: 0, y: 400 }, { x: 0, y: 400 });
  const out = recomputeChain([s1, s2], { frame: F });
  assert.ok(near(out[0].derived.latMissYds, s1.derived.latMissYds) && near(out[1].derived.distMissYds, s2.derived.distMissYds));
  assert.equal(renumber([s1, s2]).every((r, i) => r.shotNo === i + 1), true);
});
