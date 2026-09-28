/*
 * caddieState.test.js — UI addendum §12: T35 (pin), T38 (same shot), T41 (ghost isolation),
 * T42 (resume), plus the §10.2 aim short form, the §8 state → labels table, the caddie reducer's
 * shot / hole / chip lifetimes (§9), club-brain mode and the 27-hole default mapping.
 * T40 (no scrolling at three sizes) is a browser check: see the S3b report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  COPY, NOTICES, initialCaddie, caddieReducer, caddieHoleFor, serializeCaddie, restoreCaddie, pinSetting, pinPointFor, pinFromMapTap,
  greenPosition, aimShort, clubShort, chipList, pickerModel, windText, windChipText, elevText, dispersionLine, syntheticHole, clubBrainContext,
  overlayPair, mapInput, caddieView, defaultNineMap, geometryKeyFor, scorecardOrder, detectedHoleNo, hasUnloggedShot,
} from "./caddieState.js";
import { greenDistances, pointInRing, ringDistance } from "./course.js";
import { recommend } from "./engine.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { withEllipses, overlayModel, linearProjector } from "./overlay.js";
import { bunkeredPar3, openPar5, waterLeftPar4 } from "../fixtures/synthetic-holes.js";
import { routeShot, quickLog, detailLog, skipShot, closeOutShot, missCauseSample } from "./shotlog.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const run = (s, ...actions) => actions.reduce((st, a) => caddieReducer(st, a), s);
const fix = (lat = 34.3, lng = -84.06, accuracyM = 4) => ({ lat, lng, accuracyM });

/** A minimal recommend()-shaped result for view tests. */
function fakeRes({ sameShot = false, safe = {}, aggressive = {} } = {}) {
  const base = { club: "PW", label: "Pitching wedge", swingType: "full", kind: "approach", target: { x: 0, y: 175, label: "green, center" },
    expScore: 3.1, birdieProb: 0.081, troubleRate: 0.04, meanYds: 134, reason: "Pitching wedge: 4.8° spread, 0 penalties in last 5" };
  const s = { ...base, ...safe };
  const a = sameShot ? null : { ...base, club: "9i", label: "9-iron", expScore: 3.4, birdieProb: 0.12, troubleRate: 0.19, deltaExp: 0.3, reason: "9-iron: 5.1° spread, 152 median", ...aggressive };
  return { context: { distances: { front: 161, center: 175, back: 189, pin: 175 }, playsLike: 179, wind: null }, sameShot, safe: s, aggressive: a, nudges: [], flags: [] };
}

/* ---------- T35 pin ---------- */

test("T35: pin presets land in the front / middle / back thirds along ball → green", () => {
  for (const hole of [bunkeredPar3, openPar5, waterLeftPar4]) {
    for (const ball of [hole.tee, { x: 8, y: hole.yards * 0.55 }]) {
      const g = greenDistances(hole, ball, "middle");
      const d = (set) => Math.hypot(pinPointFor(hole, ball, set).x - ball.x, pinPointFor(hole, ball, set).y - ball.y);
      const third = g.depth / 3, eps = 0.15;
      assert.ok(d("front") >= g.front - eps && d("front") <= g.front + third + eps, `${hole.id} front ${d("front")} in [${g.front}, ${g.front + third}]`);
      assert.ok(d("middle") >= g.front + third - eps && d("middle") <= g.front + 2 * third + eps, `${hole.id} middle ${d("middle")}`);
      assert.ok(d("back") >= g.front + 2 * third - eps && d("back") <= g.back + eps, `${hole.id} back ${d("back")}`);
      for (const set of ["front", "middle", "back"]) assert.ok(pointInRing(pinPointFor(hole, ball, set), hole.green.ring), `${hole.id} ${set} on the green`);
    }
  }
});

test("T35: a tap within 3 yds of the green clamps inside it; farther out is not a pin", () => {
  const hole = bunkeredPar3;                         // green: centre (0,175), semi-axes 13 × 14 → back edge y 189
  const near = pinFromMapTap(hole, { x: 0, y: 191 });
  assert.ok(near, "2 yds past the back edge sets a pin");
  assert.ok(pointInRing(near, hole.green.ring), "clamped inside the green");
  assert.ok(ringDistance({ x: 0, y: 191 }, hole.green.ring) <= 3);
  assert.equal(pinFromMapTap(hole, { x: 0, y: 195 }), null, "6 yds out is an ordinary map tap");
  const inside = pinFromMapTap(hole, { x: 4, y: 170 });
  assert.deepEqual(inside, { x: 4, y: 170 }, "a tap on the green is the pin itself");
  // the chip reads Custom, in pencil
  const chip = chipList({ pin: inside }).find((c) => c.key === "pin");
  assert.equal(chip.value, "Custom"); assert.equal(chip.edited, true);
});

test("T35: the pin holds for every shot on the hole and resets to Middle on a new hole", () => {
  let s = run(initialCaddie(3), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  s = run(s, { type: "chip", key: "pin", value: "back" });
  assert.equal(pinSetting(s), "back");
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(34.301), point: { x: 3, y: 240 } }, { type: "ball" }, { type: "fix", fix: fix(34.302), point: { x: 1, y: 380 } });
  assert.equal(s.shotNo, 3);
  assert.equal(pinSetting(s), "back", "held across shots");
  s = run(s, { type: "pin", value: { x: 2, y: 410 } });
  assert.deepEqual(pinSetting(s), { x: 2, y: 410 }, "a map tap replaces the preset");
  s = run(s, { type: "chip", key: "pin", value: "front" });
  assert.equal(pinSetting(s), "front", "choosing a preset clears the custom pin");
  const scores = Array(18).fill(null); scores[0] = 4; scores[1] = 3; scores[2] = 5;
  s = run(s, { type: "scores", scores });
  assert.equal(s.hole, 4);
  assert.equal(pinSetting(s), "middle", "new hole starts at Middle");
  assert.equal(pinSetting(s, 3), "front", "stored per hole in round state");
});

/* ---------- reducer: shots, holes, chip lifetimes (§2, §9) ---------- */

test("shotNo: tee = 1, each I'm at my ball +1, previous shots kept per hole; a new hole resets", () => {
  let s = run(initialCaddie(1), { type: "tee" });
  assert.equal(s.phase, "locating"); assert.equal(s.prevPhase, "pretee");
  s = run(s, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(s.phase, "ready"); assert.equal(s.shotNo, 1); assert.deepEqual(s.shots[1], []);
  s = run(s, { type: "exp", exp: true }, { type: "opt", opt: "aggressive" }, { type: "chip", key: "lie", value: "rough" }, { type: "chip", key: "quality", value: "bad" },
    { type: "chip", key: "elevation", value: 5 }, { type: "chip", key: "wind", value: { direction: "into", speed: 10 } }, { type: "chip", key: "conditions", value: "wet" });
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(34.301), point: { x: 4, y: 250 } });
  assert.equal(s.shotNo, 2);
  assert.deepEqual(s.shots[1], [{ from: { x: 0, y: 0 }, to: { x: 4, y: 250 } }]);
  assert.equal(s.opt, "safe", "SAFE on every new ball"); assert.equal(s.exp, false, "rail collapses on every new ball");
  assert.deepEqual(s.chips, {}, "lie, quality, elevation reset each ball");
  assert.deepEqual(s.windOverride, { direction: "into", speed: 10 }, "wind holds for the round");
  assert.equal(s.conditionsOverride, "wet", "conditions hold for the round");
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(34.302), point: { x: 1, y: 380 } });
  assert.equal(s.shots[1].length, 2);
  s = run(s, { type: "hole", hole: 2 });
  assert.equal(s.hole, 2); assert.equal(s.shotNo, 1); assert.equal(s.phase, "pretee"); assert.deepEqual(s.shots[2], []);
  assert.equal(s.shots[1].length, 2, "the finished hole keeps its shots");
  assert.equal(s.windOverride.speed, 10);
});

test("§2 caddie hole rule: scoring the caddie hole moves it to the lowest unscored hole; editing an earlier one does not", () => {
  const sc = Array(18).fill(null);
  let s = initialCaddie(7);
  sc[0] = 4; sc[1] = 3; sc[2] = 4; sc[3] = 5; sc[4] = 5; sc[5] = 4;
  s = run(s, { type: "scores", scores: sc });
  assert.equal(s.hole, 7, "hole 7 still open");
  const sc2 = [...sc]; sc2[6] = 6;
  s = run(s, { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "scores", scores: sc2 });
  assert.equal(s.hole, 8); assert.equal(s.phase, "pretee");
  const sc3 = [...sc2]; sc3[2] = 5;                  // Brett fixes hole 3
  const s2 = run(s, { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "scores", scores: sc3 });
  assert.equal(s2.hole, 8); assert.equal(s2.phase, "ready");
  assert.equal(caddieHoleFor(sc3), 8);
  assert.equal(caddieHoleFor(Array(18).fill(4)), null);
});

test("a detected hole on I'm on the tee starts that hole at shot 1", () => {
  let s = run(initialCaddie(4), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(), point: { x: 2, y: 200 } }, { type: "chip", key: "pin", value: "back" });
  s = run(s, { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0.5, y: 1 }, hole: 5 });
  assert.equal(s.hole, 5); assert.equal(s.shotNo, 1); assert.equal(s.phase, "ready"); assert.equal(pinSetting(s), "middle");
  assert.deepEqual(s.ballXY, { x: 0.5, y: 1 });
});

test("GPS errors: permission denied → Location off, anything else → No GPS fix; Try again keeps the trigger", () => {
  let s = run(initialCaddie(1), { type: "tee" }, { type: "fixError", code: 1 });
  assert.equal(s.phase, "locationoff");
  s = run(s, { type: "retry" });
  assert.equal(s.phase, "locating"); assert.equal(s.trigger, "tee");
  s = run(s, { type: "fixError", code: 3 });
  assert.equal(s.phase, "nofix");
  s = run(s, { type: "retry" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(s.phase, "ready"); assert.equal(s.shotNo, 1);
});

test("Enter yards: shot numbering and per-ball resets", () => {
  let s = run(initialCaddie(1), { type: "tee" }, { type: "fixError", code: 3 }, { type: "yards", yards: 150 });
  assert.equal(s.phase, "yards"); assert.equal(s.shotNo, 1); assert.equal(s.yards, 150);
  s = run(s, { type: "chip", key: "lie", value: "rough" }, { type: "yards", yards: 90 });
  assert.equal(s.shotNo, 2); assert.deepEqual(s.chips, {});
  const t = run(initialCaddie(2), { type: "yards", yards: 140 });
  assert.equal(t.shotNo, 1, "No course map: the first Enter yards on a hole is shot 1");
  assert.equal(run(t, { type: "yards", yards: 0 }), t, "no yards, no change");
});

/* ---------- T42 resume ---------- */

test("T42: persist → restore round-trips hole, shotNo, toggle, chips, pin, expanded", () => {
  let s = run(initialCaddie(6), { type: "tee" }, { type: "fix", fix: fix(34.3, -84.06, 12), point: { x: 0, y: 0 } },
    { type: "ball" }, { type: "fix", fix: fix(34.301, -84.061, 5), point: { x: -6, y: 231 } },
    { type: "opt", opt: "aggressive" }, { type: "exp", exp: true },
    { type: "chip", key: "lie", value: "rough" }, { type: "chip", key: "quality", value: "bad" }, { type: "chip", key: "elevation", value: -5 },
    { type: "chip", key: "wind", value: { direction: "from left", speed: 15 } }, { type: "chip", key: "conditions", value: "firm" },
    { type: "pin", value: { lat: 34.3021, lng: -84.0612 } });
  const stored = JSON.parse(JSON.stringify({ screen: "caddie", caddie: serializeCaddie(s, { hole: 6, shotNo: 2, lieType: "rough" }) }));
  const back = restoreCaddie(stored.caddie);
  for (const k of ["hole", "shotNo", "phase", "opt", "exp", "trigger", "yards"]) assert.deepEqual(back[k], s[k], k);
  assert.deepEqual(back.chips, { lie: "rough", quality: "bad", elevation: -5 });
  assert.deepEqual(back.pins, { 6: { lat: 34.3021, lng: -84.0612 } });
  assert.deepEqual(back.windOverride, { direction: "from left", speed: 15 });
  assert.equal(back.conditionsOverride, "firm");
  assert.deepEqual(back.ball, s.ball); assert.deepEqual(back.ballXY, s.ballXY);
  assert.deepEqual(back.shots, s.shots);
  assert.equal(back.context.lieType, "rough", "the context snapshot rides along");
  // the view rebuilt from the restored state is the same view
  const view = (st) => caddieView({ state: st, par: 5, res: fakeRes(), inferred: { lieType: "fairway" }, ballXY: st.ballXY, green: bunkeredPar3.green });
  assert.deepEqual(view(back), view(s));
});

test("T42: a reload mid-Locating comes back to the state before the tap (no automatic re-fix)", () => {
  const ready = run(initialCaddie(2), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(restoreCaddie(serializeCaddie(run(ready, { type: "ball" }))).phase, "ready");
  assert.equal(restoreCaddie(serializeCaddie(run(initialCaddie(2), { type: "tee" }))).phase, "pretee");
  assert.equal(restoreCaddie(null), null);
  assert.equal(restoreCaddie({ v: 99 }), null);
  const junk = restoreCaddie({ v: 1, hole: 40, shotNo: -2, opt: "wild", pins: { 3: "sideways" }, phase: "ready" });
  assert.equal(junk.hole, 1); assert.equal(junk.shotNo, 1); assert.equal(junk.opt, "safe"); assert.deepEqual(junk.pins, {});
  assert.equal(junk.phase, "pretee", "ready with no fix restores as pre-tee");
});

/* ---------- §10.2 aim short form ---------- */

test("aim short form: layup → Leave n, corridor → Left-center / Center / Right-center", () => {
  assert.equal(aimShort({ kind: "layup", target: { x: 0, y: 290, label: "leave 126, fairway center" } }), "Leave 126");
  assert.equal(aimShort({ kind: "corridor", target: { x: 0, y: 289, label: "leave 255, center" } }), "Center");
  assert.equal(aimShort({ kind: "corridor", target: { x: -15, y: 280, label: "leave 260, 15 left of center" } }), "Left-center");
  assert.equal(aimShort({ kind: "corridor", target: { x: 10, y: 280, label: "leave 262, 10 right of center" } }), "Right-center");
  assert.equal(aimShort(null), "—");
});

test("aim short form: green targets → the nine positions, relative to the green centre as seen from the ball", () => {
  const green = bunkeredPar3.green;                  // centre (0,175), 26 wide × 28 deep
  const ball = { x: 0, y: 0 };
  const at = (x, y) => aimShort({ kind: "approach", target: { x, y, label: "green, front pin" } }, { ball, green });
  assert.equal(at(0, 175), "Center");
  assert.equal(at(0, 166), "Front"); assert.equal(at(0, 184), "Back");
  assert.equal(at(-8, 175), "Left side"); assert.equal(at(8, 175), "Right side");
  assert.equal(at(-8, 166), "Front-left"); assert.equal(at(8, 166), "Front-right");
  assert.equal(at(-8, 184), "Back-left"); assert.equal(at(8, 184), "Back-right");
  // seen from the right of the green, "front" turns with the line of play
  assert.deepEqual(greenPosition(green, { x: 200, y: 175 }, { x: 191, y: 175 }), { v: "front", h: "" });
});

/* ---------- §8 state → labels ---------- */

test("§8: every state's rail aim, bar labels and notice", () => {
  const ready = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "ball" }, { type: "fix", fix: fix(), point: { x: 0, y: 40 } });
  const yards = run(initialCaddie(7), { type: "yards", yards: 150 });
  const S = {
    pretee: caddieView({ state: initialCaddie(7), par: 5 }),
    locating: caddieView({ state: run(initialCaddie(7), { type: "tee" }), par: 5 }),
    ready: caddieView({ state: ready, par: 5, res: fakeRes(), ballXY: { x: 0, y: 40 }, green: bunkeredPar3.green }),
    sameshot: caddieView({ state: ready, par: 5, res: fakeRes({ sameShot: true }), ballXY: { x: 0, y: 40 }, green: bunkeredPar3.green }),
    green: caddieView({ state: ready, par: 5, res: null, onGreen: true, ballXY: { x: 0, y: 170 } }),
    nofix: caddieView({ state: run(initialCaddie(7), { type: "tee" }, { type: "fixError", code: 3 }), par: 5 }),
    locationoff: caddieView({ state: run(initialCaddie(7), { type: "tee" }, { type: "fixError", code: 1 }), par: 5 }),
    yards: caddieView({ state: yards, par: 5, res: fakeRes() }),
    nomap: caddieView({ state: initialCaddie(7), par: 5, mapOk: false }),
    noprofile: caddieView({ state: initialCaddie(7), par: 5, profileOk: false }),
  };
  const bar = (v) => [v.bar.primary.label, v.bar.secondary?.label ?? null, !!v.bar.primary.disabled];
  const table = {
    pretee:      ["Tap I'm on the tee", ["I'm on the tee", null, false], null],
    locating:    ["Locating", ["Locating", null, true], null],
    ready:       ["Center", ["I'm at my ball", "Log shot", false], null],
    sameshot:    ["Center", ["I'm at my ball", "Log shot", false], null],
    green:       ["On the green", ["Score hole 7", null, false], null],
    nofix:       ["No GPS fix", ["Try again", "Enter yards", false], "No GPS fix. Step into the open and tap Try again."],
    locationoff: ["Location off", ["Try again", "Enter yards", false], "Location is off for Loop. Turn it on in Settings, then tap Try again."],
    yards:       ["Club only", ["I'm at my ball", "Log shot", false], null],
    nomap:       ["No course map", ["Enter yards", null, false], "No course map for hole 7. Enter yards for a club."],
    noprofile:   ["No profile", ["Try again", null, false], "Profile didn't load. Reconnect and tap Try again."],
  };
  for (const [name, [aim, b, notice]] of Object.entries(table)) {
    const v = S[name];
    assert.equal(v.view, name, name);
    assert.equal(v.rail.aim, aim, `${name} aim`);
    assert.deepEqual(bar(v), b, `${name} bar`);
    assert.equal(v.notice, notice, `${name} notice`);
    for (const t of [v.rail.aim, v.bar.primary.label, v.bar.secondary?.label, v.notice].filter(Boolean)) assert.ok(!t.includes("!"), `no exclamation points: ${t}`);
  }
  // values dash out and the toggle hides wherever there is no recommendation
  for (const name of ["pretee", "locating", "nofix", "locationoff", "nomap", "noprofile"]) {
    assert.equal(S[name].rail.club, "—", name); assert.equal(S[name].rail.toTarget, "—", name); assert.equal(S[name].rail.toggle, null, name);
    assert.equal(S[name].rail.shot, "1");
  }
  assert.equal(S.pretee.rail.par, "5");
  assert.equal(S.ready.rail.toggle, "pills"); assert.equal(S.ready.rail.club, "PW"); assert.equal(S.ready.rail.toTarget, "135");
  assert.equal(S.ready.rail.shot, "2");
  assert.equal(S.green.rail.showClub, false); assert.equal(S.green.rail.toggle, null);
  assert.equal(S.yards.rail.toTargetPencil, true); assert.equal(S.yards.rail.toTarget, "175");
  assert.equal(S.ready.rail.toTargetPencil, false);
  assert.equal(S.ready.rail.details, "‹ Details");
  assert.equal(caddieView({ state: { ...ready, exp: true }, res: fakeRes(), ballXY: { x: 0, y: 40 } }).rail.details, "Close ›");
  // the §10.1 copy table
  assert.equal(COPY.score(7), "Score hole 7"); assert.equal(COPY.use(150), "Use 150"); assert.equal(COPY.useInferred("Fairway"), "Use inferred · Fairway");
  assert.equal(NOTICES.nomap(3), "No course map for hole 3. Enter yards for a club.");
});

test("details: options table, Aggressive delta / ≈ same, finesse line, dispersion line", () => {
  const ready = run(initialCaddie(2), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const v = caddieView({ state: ready, par: 3, res: fakeRes(), ballXY: { x: 0, y: 0 }, green: bunkeredPar3.green });
  assert.deepEqual(v.details.rows.map((r) => [r.label, r.club, r.avg, r.delta, r.birdie, r.trouble, r.selected]),
    [["Safe", "PW", "3.1", null, "8%", "4%", true], ["Aggressive", "9-iron", "3.4", "+0.3", "12%", "19%", false]]);
  assert.deepEqual(v.details.distances, [{ k: "Front", v: "161" }, { k: "Pin", v: "175" }, { k: "Back", v: "189" }, { k: "Plays", v: "179" }]);
  assert.equal(v.details.reasons.length, 2);
  const same = caddieView({ state: ready, res: fakeRes({ aggressive: { deltaExp: 0.03 } }), ballXY: { x: 0, y: 0 } });
  assert.equal(same.details.rows[1].delta, "≈ same");
  const neg = caddieView({ state: { ...ready, opt: "aggressive" }, res: fakeRes({ aggressive: { deltaExp: -0.21 } }), ballXY: { x: 0, y: 0 } });
  assert.equal(neg.details.rows[1].delta, "−0.2"); assert.equal(neg.details.rows[1].selected, true); assert.equal(neg.rail.club, "9-iron");
  const fin = caddieView({ state: ready, res: fakeRes({ safe: { club: "LW", label: "Lob wedge", swingType: "finesse" } }), ballXY: { x: 0, y: 0 } });
  assert.equal(fin.rail.finesse, true); assert.equal(fin.rail.club, "LW");
  // dispersion from a real Shot Pattern entry
  const e = resolveEntry(P, "PW", "full", "fairway");
  const opts = withEllipses({ safe: { club: "PW", swingType: "full" }, sameShot: true }, () => e);
  assert.deepEqual(dispersionLine({ ...opts.safe, label: "Pitching wedge" }), { club: "PW", w: 20, d: 21, source: "Shot Pattern · 80% · Sep 19" });
  const bad = withEllipses({ safe: { club: "PW", swingType: "full" }, sameShot: true }, () => e, { lieQuality: "bad" });
  assert.match(dispersionLine(bad.safe).source, / · \+15% bad lie$/);
  assert.equal(clubShort("2Hy"), "2-hybrid"); assert.equal(clubShort("Dr"), "Driver");
});

test("chips: printed when inferred, pencil when Brett changed it, ? on a low-confidence lie; pickers", () => {
  const inferred = { lieType: "fairway", lieConfidence: "low", wind: { speedMph: 8.2, relative: "into-left" }, elevation: 4.4, conditions: "normal" };
  const c = Object.fromEntries(chipList({ inferred }).map((x) => [x.key, x]));
  assert.deepEqual([c.lie.value, c.lie.edited, c.lie.unsure], ["Fairway", false, true]);
  assert.equal(c.wind.value, "8 into-left"); assert.equal(c.elevation.value, "+4 yds"); assert.equal(c.pin.value, "Middle"); assert.equal(c.conditions.value, "Normal");
  assert.ok(Object.values(c).every((x) => !x.edited));
  const e = Object.fromEntries(chipList({ inferred, chips: { lie: "rough", quality: "buried", elevation: -10 }, pin: "back", windOverride: { direction: "helping", speed: 20 }, conditionsOverride: "wet" }).map((x) => [x.key, x]));
  assert.ok(Object.values(e).every((x) => x.edited), "every changed chip is pencil");
  assert.deepEqual([e.lie.value, e.lie.unsure], ["Rough", false]);
  assert.equal(e.wind.value, "20+ helping"); assert.equal(e.elevation.value, "−10 yds"); assert.equal(e.quality.value, "Buried"); assert.equal(e.conditions.value, "Wet");
  assert.equal(windChipText({ direction: "from left", speed: 15 }), "15 from L");
  assert.equal(windText({ speedMph: 12, relative: "cross-from-right" }), "12 from right"); assert.equal(windText({ speedMph: 6, relative: "down-left" }), "6 help-left");
  assert.equal(windText(undefined), "—"); assert.equal(windText(null), "Calm"); assert.equal(windChipText({ direction: "calm", speed: 0 }), "Calm"); assert.equal(elevText(0), "0 yds");
  // pickers
  const lie = pickerModel("lie", { chip: e.lie, current: "rough" });
  assert.deepEqual(lie.options.map((o) => o.label), ["Tee", "Fairway", "Rough", "Sand", "Recovery"]);
  assert.equal(lie.options.find((o) => o.current).value, "rough");
  assert.equal(lie.inferredLabel, "Use inferred · Fairway");
  assert.equal(pickerModel("lie", { chip: c.lie, current: "fairway" }).inferredLabel, null, "no Use inferred until Brett changes it");
  assert.deepEqual(pickerModel("quality", {}).options.map((o) => o.label), ["Good", "Standard", "Bad", "Buried"]);
  const w = pickerModel("wind", { chip: e.wind, current: { direction: "helping", speed: 20 } });
  assert.deepEqual(w.options.map((o) => o.label), ["Into", "Helping", "From left", "From right", "Calm"]);
  assert.deepEqual(w.speeds.map((o) => o.label), ["0", "5", "10", "15", "20+"]);
  assert.equal(w.speeds.find((o) => o.current).value, 20);
  assert.deepEqual(pickerModel("elevation", { current: 5 }).options.map((o) => [o.label, o.current]), [["−10", false], ["−5", false], ["0", false], ["+5", true], ["+10", false]]);
  const pin = pickerModel("pin", { chip: e.pin, current: "back" });
  assert.deepEqual(pin.options.map((o) => o.label), ["Front", "Middle", "Back"]); assert.equal(pin.note, "Or tap the green on the map.");
  assert.equal(pin.inferredLabel, "Use inferred · Middle");
  assert.deepEqual(pickerModel("conditions", {}).options.map((o) => [o.label, o.current]), [["Firm", false], ["Normal", true], ["Wet", false]]);
});

/* ---------- T38 same shot ---------- */

test("T38: same shot → one option, the toggle replaced, no ghost line in the MapLayer input", () => {
  // a real same-shot case from the engine
  const hole = bunkeredPar3;
  const ctx = { hole: 2, par: 3, shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee" };
  let res = recommend(ctx, hole, P);
  if (!res.sameShot) res = { ...res, sameShot: true, aggressive: null };
  const options = withEllipses(res, (c, s) => resolveEntry(P, c, s, "tee"));
  const state = run(initialCaddie(2), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "opt", opt: "aggressive" });
  const v = caddieView({ state, par: 3, res, options, ballXY: { x: 0, y: 0 }, green: hole.green });
  assert.equal(v.view, "sameshot"); assert.equal(v.rail.toggle, "same");
  assert.deepEqual(v.details.rows.map((r) => r.label), ["Both"]);
  assert.equal(v.details.reasons.length, 1);
  assert.equal(v.rail.club, clubShort(res.safe.club), "the one option shows even with Aggressive left on the toggle");
  const mi = mapInput({ state, view: v.view, ballXY: { x: 0, y: 0 }, options, sameShot: v.sameShot, pin: hole.green.center });
  assert.equal(mi.sameShot, true); assert.equal(mi.options.aggressive, null);
  const pair = overlayPair(mi.options, mi.active, mi.sameShot);
  assert.equal(pair.other, null); assert.ok(pair.active);
  const project = linearProjector({ center: { x: 0, y: 90 }, pxPerYd: 2 }, { width: 375, height: 812 }).project;
  const model = overlayModel({ project, hole, ball: mi.ball, pin: mi.pin, active: pair.active, other: pair.other, previousShots: [] });
  const parts = [];
  const walk = (ns) => { for (const n of ns || []) { if (n?.attrs?.["data-part"]) parts.push(n.attrs["data-part"]); walk(n?.children); } };
  walk(model);
  assert.ok(!parts.includes("other"), "no ghosted second option");
  assert.ok(parts.includes("ellipse") && parts.includes("target"), "the one option is drawn");
  // and with two options the ghost line is there
  const two = overlayPair({ safe: pair.active, aggressive: { ...pair.active, target: { x: 5, y: 170 } } }, "safe", false);
  assert.ok(two.other);
});

test("mapInput: no ball or overlay outside Ready; On the green = pin + ball; last camera kept for No GPS fix", () => {
  const s = initialCaddie(1);
  const opts = { safe: { target: { x: 0, y: 100 } }, aggressive: { target: { x: 3, y: 120 } } };
  const pre = mapInput({ state: s, view: "pretee", ballXY: null, options: opts });
  assert.equal(pre.ball, null); assert.equal(pre.options, null);
  const nofix = mapInput({ state: s, view: "nofix", ballXY: { x: 1, y: 200 }, options: opts });
  assert.equal(nofix.ball, null); assert.equal(nofix.options, null); assert.deepEqual(nofix.fitBall, { x: 1, y: 200 });
  const green = mapInput({ state: s, view: "green", ballXY: { x: 1, y: 400 }, options: opts });
  assert.deepEqual(green.ball, { x: 1, y: 400 }); assert.equal(green.options, null);
  const ready = mapInput({ state: s, view: "ready", ballXY: { x: 1, y: 200 }, accuracyM: 12, options: opts });
  assert.equal(ready.options, opts); assert.equal(ready.accuracyM, 12);
  assert.equal(mapInput({ state: s, view: "yards", ballXY: null, options: opts }).options, null, "Yards entered: no overlay");
});

/* ---------- T41 ghost isolation ---------- */

test("T41: the caddie render model carries no ghost score, match score or segment state", () => {
  const ready = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  // everything the round knows, including the ghost and the match, offered to the view
  const leak = { ghost: { holes: Array(18).fill(97), hcp: 93, gross: 979 }, match: { you: 3.5, opp: 2.5, segs: [{ res: "win" }] }, scores: [4, 5, 3], diff: 7.9, segment: 3 };
  const views = [
    caddieView({ ...leak, state: ready, par: 5, res: fakeRes(), ballXY: { x: 0, y: 0 }, green: bunkeredPar3.green, inferred: { lieType: "tee" } }),
    caddieView({ ...leak, state: ready, par: 5, res: fakeRes({ sameShot: true }), ballXY: { x: 0, y: 0 } }),
    caddieView({ ...leak, state: initialCaddie(7), par: 5 }),
    caddieView({ ...leak, state: run(initialCaddie(7), { type: "yards", yards: 150 }), par: 5, res: fakeRes() }),
  ];
  for (const v of views) {
    const text = JSON.stringify(v);
    assert.ok(!/ghost|segment|all square|\bmatch\b|\bwon\b|\blost\b|\bhalved\b|\bpts?\b|\bS[1-6]\b|\bup\b/i.test(text), text);
    for (const n of ["97", "93", "979", "3.5", "2.5", "7.9"]) assert.ok(!text.includes(`"${n}"`) && !text.includes(` ${n} `), `${n} leaked`);
  }
  // and the screen component itself is never handed any of it
  const src = readFileSync(join(here, "..", "app.jsx"), "utf8");
  const start = src.indexOf("function CaddieScreen(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(start > 0 && body.length > 1000);
  for (const w of ["ghost", "evalMatch", "computeGhost", "scores", "segs", "fmtPts"]) assert.ok(!body.includes(w), `CaddieScreen mentions ${w}`);
  const call = src.slice(src.indexOf("<Caddie course="), src.indexOf("/>", src.indexOf("<Caddie course=")));
  assert.ok(!/ghost|scores|diff=/.test(call), "App passes the caddie no ghost, scores or differential");
});

/* ---------- club-brain mode (§8 Yards entered) ---------- */

test("club-brain: a straight synthetic hole of the entered length, no hazards, profile only", () => {
  const syn = syntheticHole(150, 4);
  assert.equal(syn.hazards.length, 0); assert.equal(syn.boundary, null);
  assert.deepEqual(syn.green.center, { x: 0, y: 150 });
  const ctx = clubBrainContext({ holeNo: 5, par: 4, shotNo: 2, chips: { elevation: 5 }, windOverride: { direction: "into", speed: 10 } });
  assert.equal(ctx.lieType, "fairway"); assert.equal(ctx.lieConfidence, "low"); assert.equal(ctx.elevationDeltaYds, 5);
  assert.deepEqual(ctx.wind, { speedMph: 10, fromDeg: 0 });
  const res = recommend(ctx, syn, P);
  assert.ok(res.safe, "a club comes back");
  assert.equal(res.context.distances.pin, 150);
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 1 }).lieType, "tee");
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 3, chips: { lie: "sand" } }).lieType, "sand");
});

/* ---------- 27-hole courses (engine §6.4) ---------- */

test("27 holes: a default mapping from refs, then scorecard hole → geometry key through the chosen nines", () => {
  const c27 = Array.from({ length: 27 }, (_, i) => ({ key: String(i + 1), ref: i + 1 }));
  const m27 = defaultNineMap(c27);
  assert.deepEqual(m27["1"], { nine: "1", hole: 1 }); assert.deepEqual(m27["10"], { nine: "2", hole: 1 }); assert.deepEqual(m27["27"], { nine: "3", hole: 9 });
  const rep = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((r) => [{ key: `${r}@a`, ref: r }, { key: `${r}@b`, ref: r }, { key: `${r}@c`, ref: r }]);
  const mr = defaultNineMap(rep);
  assert.deepEqual(new Set(Object.values(mr).map((v) => v.nine)), new Set(["1", "2", "3"]));
  assert.equal(Object.values(mr).filter((v) => v.hole === 4).length, 3);
  const geometry = { holes: Object.fromEntries(c27.map((c) => [c.key, { key: c.key, ref: c.ref }])) };
  const map = { ...m27, _play: ["3", "1"] };                 // play the third nine out, the first in
  assert.equal(geometryKeyFor(geometry, map, 1), "19");
  assert.equal(geometryKeyFor(geometry, map, 10), "1");
  assert.equal(geometryKeyFor(geometry, map, 18), "9");
  const order = scorecardOrder(geometry, map);
  assert.equal(order.length, 18); assert.equal(order[0], "19"); assert.equal(order[9], "1");
  assert.equal(detectedHoleNo(order, "20", 1), 2);
  assert.equal(detectedHoleNo(order, "19", 18), null, "never wraps 18 → 1");
  // 18-hole course: key n
  const g18 = { holes: { 1: {}, 2: {} } };
  assert.equal(geometryKeyFor(g18, null, 2), "2"); assert.equal(geometryKeyFor(g18, null, 3), null);
});

/* ---------- S4: shot log capture flow (SPEC-caddie §4, UI addendum §3.4/§9.4-9.5) ---------- */

/** A minimal ShotRecord builder standing in for `buildDraftShot` in app.jsx: uses shotlog.js's
 *  own `quickLog`/`detailLog`/`skipShot` against a fakeRes()-shaped recommendation, hole/shotNo
 *  taken from the caddie state so `hasUnloggedShot` can match it up. */
function draftFor(s, { hole = s.hole, shotNo = s.shotNo, res = fakeRes(), startFrame = { x: 0, y: 0 }, targetFrame } = {}) {
  return {
    roundId: "r1", courseId: "c1", hole, shotNo,
    start: { lat: 1, lng: 2, accuracyM: 4, distanceToPinYds: res.context.distances.pin, playsLikeYds: res.context.playsLike, frame: startFrame },
    recommendation: res,
    ...(targetFrame ? { target: { frame: targetFrame, label: "green, center" } } : {}),
  };
}

test("T16 (UI-level): routeShot classifies the ball the caddie is standing over; hasUnloggedShot only fires for a long, unlogged one", () => {
  const s = run(initialCaddie(5), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(routeShot({ distanceToPinYds: 238, lieType: "fairway" }), "long");
  assert.equal(routeShot({ distanceToPinYds: 40, lieType: "rough" }), "shortGame");
  assert.equal(routeShot({ distanceToPinYds: 12, lieType: "green" }), "putt");
  // long and nothing logged yet for this (hole, shotNo) → the "I'm at my ball" tap must prompt
  assert.equal(hasUnloggedShot(s, "long"), true);
  // shortGame / putt never gate the tap, logged or not
  assert.equal(hasUnloggedShot(s, "shortGame"), false);
  assert.equal(hasUnloggedShot(s, "putt"), false);
  assert.equal(hasUnloggedShot(s, null), false, "no live recommendation to log against");
});

test("T17 (quick path via the reducer): Good shot writes the §4.3 defaults and the caddie tracks it as openShot", () => {
  let s = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(hasUnloggedShot(s, "long"), true);
  s = caddieReducer(s, { type: "logOpen" });
  assert.equal(s.logCard, "log");
  const record = quickLog(draftFor(s));
  s = caddieReducer(s, { type: "logSave", record });
  assert.equal(s.logCard, null, "the sheet closes once saved");
  assert.equal(s.openShot.logged, "quick");
  assert.equal(s.openShot.contact, 0); assert.equal(s.openShot.strike, "center"); assert.equal(s.openShot.startLine, "on");
  assert.equal(s.openShot.curve, 0, "matches the default (straight) intended shape");
  assert.equal(s.openShot.club, "PW", "the toggled (SAFE) option's club");
  // logged for this exact (hole, shotNo) → the prompt would not fire again
  assert.equal(hasUnloggedShot(s, "long"), false);
});

test("previous-shot prompt: appears while a long shot sits unlogged, clears on Good shot / Detail+Save / Skip", () => {
  const base = run(initialCaddie(4), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  assert.equal(hasUnloggedShot(base, "long"), true);

  // Good shot ✓ from the collapsed prompt
  let s = caddieReducer(base, { type: "logOpen", card: "prev" });
  assert.equal(s.logCard, "prev");
  s = caddieReducer(s, { type: "logSave", record: quickLog(draftFor(s)) });
  assert.equal(s.logCard, null); assert.equal(hasUnloggedShot(s, "long"), false);

  // Detail → Save from the collapsed prompt: still resolves through logSave
  let s2 = caddieReducer(base, { type: "logOpen", card: "prev" });
  const detailed = detailLog(draftFor(s2), { contact: -1, strike: "toe" });
  s2 = caddieReducer(s2, { type: "logSave", record: detailed });
  assert.equal(s2.openShot.logged, "full"); assert.equal(s2.openShot.contact, -1);
  assert.equal(hasUnloggedShot(s2, "long"), false);

  // Skip
  let s3 = caddieReducer(base, { type: "logOpen", card: "prev" });
  s3 = caddieReducer(s3, { type: "logSkip", record: skipShot(draftFor(s3)) });
  assert.equal(s3.openShot.logged, "skipped"); assert.equal(hasUnloggedShot(s3, "long"), false);

  // logDismiss only closes the optional (non-blocking) Log-shot sheet, never the prompt's data
  const opened = caddieReducer(base, { type: "logOpen" });
  assert.equal(caddieReducer(opened, { type: "logDismiss" }).logCard, null);
  assert.equal(caddieReducer(opened, { type: "logDismiss" }).openShot, null, "dismissing without saving leaves nothing logged");
});

test("T18: the record closed out by the next fix carries end + derived (§4.5)", () => {
  let s = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const record = quickLog(draftFor(s, { targetFrame: { x: 0, y: 238 } }));
  s = caddieReducer(s, { type: "logSave", record });
  assert.equal(s.openShot.id, record.id);

  // the next "I'm at my ball" fix is what app.jsx uses to closeOutShot() the pending openShot
  s = caddieReducer(s, { type: "ball" }, );
  s = caddieReducer(s, { type: "fix", fix: fix(34.301, -84.061, 5), point: { x: 3, y: 232 } });
  const closed = closeOutShot(s.openShot ?? record, { endGps: { lat: 34.301, lng: -84.061 }, endLie: "fairway", endAccuracyM: 5, endFrame: { x: 3, y: 232 } });
  assert.equal(closed.derived.distanceMissYds, -6); assert.equal(closed.derived.lateralMissYds, 3); assert.equal(closed.derived.onTarget, true);
  s = caddieReducer(s, { type: "logClosed" });
  assert.equal(s.openShot, null, "the slot frees up once the caller has saved the closed-out record");
});

test("T19: a skipped shot still gets closed out with its GPS result, and missCauseSample excludes it", () => {
  let s = run(initialCaddie(9), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const skipped = skipShot(draftFor(s, { targetFrame: { x: 0, y: 200 } }));
  s = caddieReducer(s, { type: "logSkip", record: skipped });
  assert.equal(s.openShot.logged, "skipped");
  const closed = closeOutShot(s.openShot, { endGps: { lat: 9, lng: 9 }, endLie: "rough", endFrame: { x: 5, y: 190 } });
  assert.equal(closed.end.lat, 9, "GPS result retained even though skipped");
  const quick = quickLog(draftFor(s, { shotNo: s.shotNo + 1 }));
  assert.deepEqual(missCauseSample([closed, quick]).map((r) => r.id), [quick.id]);
});

test("persist / restore round-trips the pending Log-shot sheet and the openShot awaiting closeout", () => {
  let s = run(initialCaddie(11), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const record = quickLog(draftFor(s));
  s = caddieReducer(s, { type: "logOpen", card: "prev" });
  s = caddieReducer(s, { type: "logSave", record });
  const back = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(s))));
  assert.equal(back.logCard, null, "the sheet itself was already resolved before saving");
  assert.deepEqual(back.openShot, record);

  // a sheet left open (never resolved) also survives a reload
  const mid = caddieReducer(s, { type: "logOpen" });
  const backMid = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(mid))));
  assert.equal(backMid.logCard, "log");

  // garbage in storage never crashes the restore
  const junk = restoreCaddie({ v: 1, hole: 1, shotNo: 1, phase: "pretee", logCard: "nonsense", openShot: { no: "id" } });
  assert.equal(junk.logCard, null); assert.equal(junk.openShot, null);
});
