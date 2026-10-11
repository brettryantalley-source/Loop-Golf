/*
 * catchup.test.js — v22.58 (C47, D129): Catch up, the chained after-the-hole logging.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  catchupInit, catchupStart, cuPoint, cuMoveFrom, cuFromOk, cuEndOk, cuSet, cuSaved, cuPutted, cuUndo, cuArmed,
  teeStart, guessClub, catchupShotRecord, catchupPuttRecord, catchupView,
} from "./catchup.js";
import { caddieReducer, initialCaddie, serializeCaddie, restoreCaddie } from "./caddieState.js";
import { loadProfile } from "./profile.js";
import { buildHole, frameOf } from "./geo.js";
import { teeBoxYards } from "./teeboxes.js";
import { splitHole, holeReview } from "./review.js";
import { localGeometryFor } from "../localGeometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const A = { lat: 34.2400, lng: -84.4600 }, B = { lat: 34.2410, lng: -84.4590 }, C = { lat: 34.2420, lng: -84.4580 }, D = { lat: 34.24205, lng: -84.45795 };

test("C47: a hole with nothing logged starts on the tee with the call up; Move tee; where it finished → the club sheet", () => {
  let cu = catchupStart({ tee: A });
  assert.equal(cu.step, "end", "the call from the tee shows straight away"); assert.equal(cu.shotNo, 1); assert.deepEqual(cu.from, A); assert.equal(cu.fromLie, "tee");
  assert.equal(catchupStart({ tee: null }).step, "from", "no tee box: a tap places it first");
  cu = cuMoveFrom(cu);
  assert.equal(cu.step, "from");
  assert.ok(cuArmed(cu), "the map takes a tap on the tee step");
  cu = cuPoint(cu, { lat: 34.2401, lon: -84.4601 });            // a tap moves the tee ({lat, lon} from the map)
  assert.deepEqual(cu.from, { lat: 34.2401, lng: -84.4601 });
  cu = cuFromOk(cu);
  assert.equal(cu.step, "end"); assert.equal(cu.end, null);
  assert.equal(cuMoveFrom(cuPoint(cu, B)).step, "end", "no Move once the finish is placed");
  assert.equal(cuEndOk(cu, { club: "Dr" }), cu, "no ✓ before the finish is placed");
  cu = cuPoint(cu, B);
  cu = cuEndOk(cu, { club: "Dr", endLie: "fairway" });
  assert.equal(cu.step, "club"); assert.equal(cu.club, "Dr"); assert.equal(cu.endLie, "fairway");
  assert.ok(!cuArmed(cu), "the club sheet is not a map step");
  const before = cu.hist.length;
  cu = cuSet(cu, { club: "2i", endLie: "rough" });
  assert.equal(cu.club, "2i"); assert.equal(cu.endLie, "rough"); assert.equal(cu.hist.length, before, "a pick is not a step");
});

test("C47: Save starts the next shot where this one finished; a ball on the green goes to the putts", () => {
  let cu = cuEndOk(cuPoint(catchupStart({ tee: A }), B), { club: "Dr", endLie: "fairway" });
  cu = cuSaved(cu, "rec-1");
  assert.equal(cu.step, "end"); assert.equal(cu.shotNo, 2); assert.deepEqual(cu.from, B); assert.equal(cu.fromLie, "fairway");
  assert.deepEqual(cu.ids, { 1: "rec-1" }); assert.equal(cu.club, null);
  cu = cuSaved(cuEndOk(cuPoint(cu, C), { club: "8i", endLie: "green" }), "rec-2");
  assert.equal(cu.step, "putt"); assert.equal(cu.puttNo, 1); assert.deepEqual(cu.from, C);
  // putt 1 stops short; putt 2 holed
  assert.equal(cuPutted(cu, "p1", false), cu, "a missed putt needs where it stopped");
  cu = cuPutted(cuPoint(cu, D), "p1", false);
  assert.equal(cu.step, "putt"); assert.equal(cu.puttNo, 2); assert.deepEqual(cu.from, D); assert.equal(cu.end, null);
  cu = cuPutted(cu, "p2", true);
  assert.equal(cu.step, "done"); assert.deepEqual(cu.pids, { 1: "p1", 2: "p2" });
  // a chip-in: In the hole from the club sheet ends the hole with no putt
  const chip = cuSaved(cuSet(cuEndOk(cuPoint(catchupStart({ tee: A }), B), { club: "LW" }), { endLie: "holed" }), "rec-x");
  assert.equal(chip.step, "done");
});

test("C47: Undo goes back one step at a time; undoing a Save or a putt gives back the record it wrote", () => {
  let cu = cuFromOk(cuMoveFrom(catchupStart({ tee: A })));
  cu = cuPoint(cu, B);
  let u = cuUndo(cu);
  assert.equal(u.cu.step, "end"); assert.equal(u.cu.end, null, "the finish lifted"); assert.deepEqual(u.drop, []);
  u = cuUndo(u.cu);
  assert.equal(u.cu.step, "from", "back to moving the tee");
  assert.deepEqual(cuUndo(catchupStart({ tee: A })), { cu: catchupStart({ tee: A }), drop: [] }, "nothing to undo");
  cu = cuSaved(cuEndOk(cu, { club: "Dr", endLie: "fairway" }), "rec-1");
  u = cuUndo(cu);
  assert.equal(u.cu.step, "club"); assert.equal(u.cu.shotNo, 1); assert.equal(u.cu.club, "Dr");
  assert.deepEqual(u.drop, ["rec-1"], "the shot written is given back");
  const holed = cuPutted(cuSaved(cuEndOk(cuPoint(cu, C), { club: "8i", endLie: "green" }), "rec-2"), "p1", true);
  u = cuUndo(holed);
  assert.equal(u.cu.step, "putt"); assert.deepEqual(u.drop, ["p1"]);
});

test("C47: the chain picks up after what is already logged on the hole", () => {
  const shot = (n, end, lie) => ({ id: `s${n}`, hole: 4, shotNo: n, club: "7i", start: { ...A }, lie: { confirmed: n === 1 ? "tee" : "fairway" }, end: end ? { ...end, lie } : null });
  let cu = catchupStart({ shots: [shot(1, B, "fairway")], tee: A });
  assert.equal(cu.step, "end"); assert.equal(cu.shotNo, 2); assert.deepEqual(cu.from, B); assert.equal(cu.fromLie, "fairway");
  cu = catchupStart({ shots: [shot(1, B, "fairway"), shot(2, C, "green")], tee: A });
  assert.equal(cu.step, "putt"); assert.equal(cu.shotNo, 3); assert.deepEqual(cu.from, C);
  // the last shot was logged but never closed: its finish, its record and club kept
  cu = catchupStart({ shots: [shot(1, null)], tee: A });
  assert.equal(cu.step, "end"); assert.equal(cu.shotNo, 1); assert.deepEqual(cu.ids, { 1: "s1" }); assert.equal(cu.club, "7i");
  // a lie not on the record is read off the map
  cu = catchupStart({ shots: [{ ...shot(1, B), end: { ...B } }], lieAt: () => "green" });
  assert.equal(cu.step, "putt");
  // putts logged: the hole is done
  assert.equal(catchupStart({ shots: [shot(1, B, "fairway")], putts: [{ id: "p", shotType: "putt" }] }).step, "done");
});

test("C47: shot 1 starts on the tee box the card's yardage matches (Bradshaw Red 2)", () => {
  const data = JSON.parse(readFileSync(join(here, "../localGeometry/bradshaw.json"), "utf8"));
  const geo = localGeometryFor([data], data.apiId).geometry;
  const hole = buildHole(geo, "2", { par: 5 });
  const ys = teeBoxYards(hole);
  for (const card of [498, 460, 425, 342]) {
    const t = teeStart(hole, card);
    const box = hole.tees.findIndex((r) => { const xs = r.map((p) => p[0]), yv = r.map((p) => p[1]); return t.x >= Math.min(...xs) - 1 && t.x <= Math.max(...xs) + 1 && t.y >= Math.min(...yv) - 1 && t.y <= Math.max(...yv) + 1; });
    assert.ok(box >= 0, `${card}: the start sits in a box`);
    assert.ok(Math.abs(ys[box] - card) < 20, `${card}: the ${Math.round(ys[box])}-yd box`);
  }
  assert.deepEqual(teeStart({ tee: { x: 0, y: 0 }, tees: [] }, 400), { x: 0, y: 0 }, "no boxes: the hole line's start");
  assert.equal(teeStart(null, 400), null);
});

test("C47: Loop's club guess is the club whose average total from the lie is nearest the yards", () => {
  assert.equal(guessClub(P, 285, "tee"), "Dr");
  assert.equal(guessClub(P, 285, "fairway"), "2Hy", "no full driver off the deck (D86)");
  assert.equal(guessClub(P, 150, "fairway"), "9i");
  assert.equal(guessClub(P, 170, "rough"), "8i");
  assert.ok(["SW", "LW"].includes(guessClub(P, 40, "rough")), "a short one is a wedge");
  assert.equal(guessClub(P, 0, "tee"), null);
  assert.equal(guessClub(null, 150), null);
});

test("C47: a saved shot is a placed, logged, closed record the Score pre-fill and Review count", () => {
  const data = JSON.parse(readFileSync(join(here, "../localGeometry/woodmont.json"), "utf8"));
  const geo = localGeometryFor([data], data.apiId).geometry;
  const hole = buildHole(geo, "1", { par: 4 });
  const F = frameOf(hole);
  const at = (p) => { const q = F.toLatLng(p); return { lat: q.lat, lng: q.lon, x: p.x, y: p.y }; };
  const base = { roundId: "r1", courseId: "tnw4ghn5", nine: "front", hole: 1 };
  const tee = teeStart(hole, 400), end1 = { x: tee.x, y: tee.y + 250 }, g = hole.green.center;
  const r1 = catchupShotRecord({ id: "c1", base, shotNo: 1, from: at(tee), end: at(end1), startLie: "tee", endLie: "fairway", club: "Dr", pinYds: 400, cfg: P.config });
  assert.equal(r1.id, "c1"); assert.equal(r1.hole, 1); assert.equal(r1.shotNo, 1); assert.equal(r1.club, "Dr");
  assert.equal(r1.logged, "full"); assert.equal(r1.reviewed, true); assert.equal(r1.placed, true); assert.equal(r1.catchup, true);
  assert.equal(r1.lie.confirmed, "tee"); assert.equal(r1.start.accuracyM, null); assert.deepEqual(r1.start.frame, tee);
  assert.equal(r1.end.lie, "fairway"); assert.ok(!r1.end.assumed, "a placed end, never assumed (D87)");
  assert.ok(Math.abs(r1.end.lat - at(end1).lat) < 1e-9);
  assert.equal(r1.contact, null, "nobody graded the strike");
  const r2 = catchupShotRecord({ id: "c2", base, shotNo: 2, from: at(end1), end: at(g), startLie: "fairway", endLie: "green", club: "9i", pinYds: 150, cfg: P.config });
  const p1 = catchupPuttRecord({ id: "p1", base, puttNo: 1, from: at(g), distanceFt: 24, made: false });
  const p2 = catchupPuttRecord({ id: "p2", base, puttNo: 2, from: at(g), distanceFt: 3, made: true });
  assert.equal(p1.shotType, "putt"); assert.equal(p1.putt.distanceFt, 24); assert.equal(p1.putt.made, false);
  assert.equal(p1.putt.speed, null, "a miss nobody graded keeps its axes null"); assert.equal(p2.putt.made, true);
  const { shots, putts } = splitHole([r1, r2, p1, p2], 1);
  assert.equal(shots.length + putts.length, 4, "the Score hole pre-fill counts 4");
  const rv = holeReview(shots, putts, 4, 1);
  assert.equal(rv.needed, false, "the Review sheet has nothing to ask");
  const chip = catchupShotRecord({ base, shotNo: 3, from: at(g), end: at(g), startLie: "rough", endLie: "holed", club: "LW", cfg: P.config });
  assert.equal(chip.end.holed, true); assert.equal(chip.end.lie, "green");
  assert.equal(catchupShotRecord({ base, shotNo: 1, from: null, end: at(g) }), null);
});

test("C47: the bar, the notice and the pill line for each step", () => {
  let cu = catchupStart({ tee: A });
  let v = catchupView({ cu, holeNo: 5, liveHole: 8, yds: 412 });
  assert.equal(v.primary, null, "the step waits on a tap"); assert.equal(v.secondary, null, "nothing to undo yet");
  assert.equal(v.extra.label, "Move tee"); assert.equal(v.extra.action, "cuMove");
  assert.match(v.notice, /^Shot 1 · set the target if you like, then tap where it finished/); assert.equal(v.line, "shot 1");
  cu = cuMoveFrom(cu);
  v = catchupView({ cu, holeNo: 5 });
  assert.equal(v.primary.label, "✓ Tee here"); assert.equal(v.primary.action, "cuFromOk"); assert.equal(v.secondary.action, "cuUndo");
  assert.match(v.notice, /move the tee/);
  cu = cuFromOk(cu);
  cu = cuPoint(cu, B);
  v = catchupView({ cu, holeNo: 5, yds: 251.4 });
  assert.equal(v.primary.label, "✓ Finished here"); assert.match(v.notice, /Shot 1 · 251 yds/);
  cu = cuSaved(cuEndOk(cu, { club: "Dr", endLie: "green" }), "r1");
  v = catchupView({ cu, holeNo: 5, ft: 23.6 });
  assert.equal(v.primary.label, "In the hole"); assert.equal(v.primary.action, "cuIn"); assert.match(v.notice, /Putt 1 · 24 ft/); assert.equal(v.line, "putt 1");
  v = catchupView({ cu: cuPoint(cu, C), holeNo: 5, ft: 4 });
  assert.equal(v.primary.label, "✓ Next putt"); assert.match(v.notice, /4 ft left/);
  const done = cuPutted(cu, "p1", true);
  const counts = { shots: 1, putts: 1 };
  assert.equal(catchupView({ cu: done, holeNo: 5, liveHole: 8, scored: false, counts }).primary.label, "Score hole 5");
  assert.equal(catchupView({ cu: done, holeNo: 5, liveHole: 8, scored: true, counts }).primary.label, "Hole 6 ›");
  assert.equal(catchupView({ cu: done, holeNo: 5, liveHole: 8, scored: true, counts }).secondary.label, "Done · back to 8");
  assert.equal(catchupView({ cu: done, holeNo: 7, liveHole: 8, scored: true, counts }).primary.label, "Done · back to 8", "the next hole is the live one");
  assert.equal(catchupView({ cu: done, holeNo: 5, scored: true, counts }).notice, "Hole 5 · 1 shot + 1 putt = 2");
  assert.equal(catchupView({ cu: catchupInit(), holeNo: 5 }), null, "nothing until the chain starts");
});

test("C47: the chain rides the caddie state of a past hole, ends on a new hole, and is never persisted", () => {
  let s = { ...initialCaddie(5), catchup: catchupInit() };
  s = caddieReducer({ ...s, pinView: true }, { type: "catchup", catchup: catchupStart({ tee: A }) });
  assert.equal(s.catchup.step, "end"); assert.equal(s.pinView, false); assert.equal(s.phase, "pretee", "no ball given: the phase stays");
  // the shot's ball: Ready there, shot 2, its Lie chip the lie Brett gave the shot before
  s = caddieReducer({ ...s, opt: "aggressive" }, { type: "catchup", catchup: s.catchup, ball: B, point: { x: 1, y: 2 }, shotNo: 2, lie: "rough" });
  assert.equal(s.phase, "ready"); assert.equal(s.shotNo, 2); assert.equal(s.trigger, "ball"); assert.equal(s.ball.lat, B.lat);
  assert.deepEqual(s.ballXY, { x: 1, y: 2 }); assert.equal(s.opt, "safe", "a new ball starts on Safe"); assert.deepEqual(s.chips, { lie: "rough" });
  const kept = caddieReducer({ ...s, opt: "aggressive", lineMode: true }, { type: "catchup", catchup: s.catchup, ball: B, point: { x: 1, y: 2 }, shotNo: 2, lie: "rough" });
  assert.equal(kept.opt, "aggressive", "the same ball keeps the toggle"); assert.equal(kept.lineMode, true);
  assert.equal(caddieReducer(s, { type: "catchup", catchup: s.catchup, ball: A, shotNo: 1, lie: "tee" }).trigger, "tee");
  assert.deepEqual(caddieReducer(s, { type: "catchup", catchup: s.catchup, ball: A, shotNo: 1, lie: "tee" }).chips, {}, "the tee is inferred, not a chip");
  const off = caddieReducer(s, { type: "catchup", catchup: s.catchup, ball: null });
  assert.equal(off.phase, "pretee"); assert.equal(off.ball, null);
  assert.equal(caddieReducer(s, { type: "catchup", catchup: null }).catchup, null);
  assert.equal(caddieReducer(s, { type: "hole", hole: 6 }).catchup, null);
  const back = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(s))));
  assert.equal(back.catchup, null);
});
