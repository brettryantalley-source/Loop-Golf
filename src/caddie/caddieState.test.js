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
  withinRoundCtx, todayLines, ellipsesFor, roundIndexFromHistory, learningOverlays, aggressionView, aggressionModel, pinFromDrag,
} from "./caddieState.js";
import { markedGreenHole } from "./greens.js";
import { frameOf } from "./geo.js";
import { destination, YARDS_PER_METER } from "../geometry.js";
import { greenDistances, pointInRing, ringDistance } from "./course.js";
import { recommend } from "./engine.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { withEllipses, overlayModel, linearProjector } from "./overlay.js";
import { bunkeredPar3, openPar5, waterLeftPar4 } from "../fixtures/synthetic-holes.js";
import { routeShot, quickLog, detailLog, skipShot, closeOutShot, missCauseSample, newShotRecord, newPuttRecord, quickMade } from "./shotlog.js";
import { applyShotLog } from "./learning.js";
import { DEFAULT_CONFIG } from "./config.js";

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
    green:       ["On the green", ["Score hole 7", "Log putt", false], null],
    nofix:       ["No GPS fix", ["Try again", "Enter yards", false], "No GPS fix. Step into the open and tap Try again."],
    locationoff: ["Location off", ["Try again", "Enter yards", false], "Location is off for Loop. Turn it on in Settings, then tap Try again."],
    yards:       ["Club only", ["I'm at my ball", "Log shot", false], null],
    nomap:       ["No course map", ["I'm on the tee", "Log shot", false], "No course map for hole 7. Enter yards for a club."],
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
  // temperature rides along on the Wind chip's inferred text (§3.3) — no chip of its own
  assert.equal(windText({ speedMph: 8.2, relative: "into-left" }, 58.2), "8 into-left · 58°");
  assert.equal(windText(undefined, 58), "— · 58°", "no wind data but a temperature exists");
  assert.equal(windText(null, 58), "Calm · 58°");
  assert.equal(windText(undefined), "—", "neither wind nor temperature: nothing appended");
  assert.equal(windText(undefined, null), "—");
  for (const t of [windText({ speedMph: 8.2, relative: "into-left" }, 58.2), windText(undefined, 58)]) {
    assert.ok(!t.includes("!") && !/ghost/i.test(t), `no exclamation points or ghost words: ${t}`);
  }
  const infWithTemp = { lieType: "fairway", lieConfidence: "low", wind: { speedMph: 8.2, relative: "into-left" }, elevation: 4.4, conditions: "normal", tempF: 58.2 };
  const cTemp = Object.fromEntries(chipList({ inferred: infWithTemp }).map((x) => [x.key, x]));
  assert.equal(cTemp.wind.value, "8 into-left · 58°");
  assert.equal(cTemp.wind.inferredValue, "8 into-left · 58°");
  const infNoWindWithTemp = { lieType: "fairway", lieConfidence: "low", wind: undefined, elevation: 4.4, conditions: "normal", tempF: 58 };
  assert.equal(Object.fromEntries(chipList({ inferred: infNoWindWithTemp }).map((x) => [x.key, x])).wind.value, "— · 58°");
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
  assert.equal(ctx.tempF, null, "club-brain has no temperature reading unless the caller passes one");
  const res = recommend(ctx, syn, P);
  assert.ok(res.safe, "a club comes back");
  assert.equal(res.context.distances.pin, 150);
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 1 }).lieType, "tee");
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 3, chips: { lie: "sand" } }).lieType, "sand");
  // temperature applies to club-brain plays-like too (§3.3), the same as GPS mode
  const cold = clubBrainContext({ holeNo: 5, par: 4, shotNo: 1, tempF: 50 });
  assert.equal(cold.tempF, 50);
  const coldRes = recommend(cold, syn, P);
  assert.equal(coldRes.context.tempYds, 2.55, "150 pin yds × 0.85%/10°F × 20°F = +2.55");
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

/* ---------- putt capture (Sep 28 spec) ---------- */

test("On the green shows Score hole N + Log putt and nothing else", () => {
  const ready = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const v = caddieView({ state: ready, par: 5, res: null, onGreen: true, ballXY: { x: 0, y: 170 } });
  assert.equal(v.view, "green");
  assert.equal(v.bar.primary.label, "Score hole 7");
  assert.equal(v.bar.secondary.label, "Log putt");
  assert.equal(v.bar.secondary.action, "logputt");
  assert.equal(Object.keys(v.bar).length, 2, "primary and secondary, nothing else");
});

test("puttOpen / puttSave / puttDismiss: a per-hole putt count and the last distance used this hole", () => {
  let s = initialCaddie(5);
  s = caddieReducer(s, { type: "puttOpen" });
  assert.equal(s.logCard, "putt");

  const rec1 = newPuttRecord({ roundId: "r1", hole: 5, shotNo: 1, distanceFt: 18, made: false, speed: 1, breakRead: 0, line: -1 });
  s = caddieReducer(s, { type: "puttSave", record: rec1 });
  assert.equal(s.logCard, null, "the card closes once saved");
  assert.equal(s.putts[5], 1);
  assert.equal(s.lastPuttFt, 18);

  // a second putt on the same hole: the card reopens, shotNo is the caller's job (putts[hole]+1)
  s = caddieReducer(s, { type: "puttOpen" });
  assert.equal(s.logCard, "putt");
  const rec2 = quickMade({ roundId: "r1", hole: 5, shotNo: 2, distanceFt: 3 });
  s = caddieReducer(s, { type: "puttSave", record: rec2 });
  assert.equal(s.putts[5], 2);
  assert.equal(s.lastPuttFt, 3, "quickMade's distance updates the stepper's next default too");

  // a new hole resets "the last value used this hole", but the finished hole's count is not lost
  s = caddieReducer(s, { type: "hole", hole: 6 });
  assert.equal(s.lastPuttFt, null);
  assert.equal(s.putts[5], 2);

  // puttDismiss (Skip, or the scrim) closes the card and writes nothing
  s = caddieReducer(s, { type: "puttOpen" });
  s = caddieReducer(s, { type: "puttDismiss" });
  assert.equal(s.logCard, null);
  assert.equal(s.putts[6] ?? 0, 0, "Skip never counts as a putt");
  assert.equal(s.lastPuttFt, null, "Skip never moves the stepper's default either");
});

test("puttSave with no record is a no-op; puttDismiss on a different open card is a no-op", () => {
  let s = caddieReducer(initialCaddie(1), { type: "puttSave" });
  assert.equal(s.logCard, null); assert.deepEqual(s.putts, {});
  const withLogSheet = caddieReducer(initialCaddie(1), { type: "logOpen" });
  assert.equal(caddieReducer(withLogSheet, { type: "puttDismiss" }).logCard, "log", "puttDismiss only closes the putt card");
});

test("persist / restore round-trips the per-hole putt count and the last distance used", () => {
  let s = caddieReducer(initialCaddie(3), {
    type: "puttSave",
    record: newPuttRecord({ hole: 3, shotNo: 1, distanceFt: 22, made: false, speed: 0, breakRead: 1, line: 0 }),
  });
  const back = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(s))));
  assert.equal(back.putts[3], 1);
  assert.equal(back.lastPuttFt, 22);

  // a card left open also survives a reload
  const mid = caddieReducer(s, { type: "puttOpen" });
  const backMid = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(mid))));
  assert.equal(backMid.logCard, "putt");

  // garbage in storage never crashes the restore
  const junk = restoreCaddie({ v: 1, hole: 1, shotNo: 1, phase: "pretee", putts: { 1: "nope", 2: -3, 3: 2 }, lastPuttFt: "wat" });
  assert.deepEqual(junk.putts, { 3: 2 });
  assert.equal(junk.lastPuttFt, null);
});

test("putt capture copy has no exclamation points and no ghost/match words", () => {
  assert.ok(!COPY.logPutt.includes("!"));
  assert.ok(!/ghost|match|segment/i.test(COPY.logPutt));
});

/* ---------- S5: the learning loop on the caddie screen (spec §5.2–§5.7, addendum §3.3 item 6, §5.6) ---------- */

/** A closed-out long shot, the record shape shotlog.js saves (newShotRecord → closeOutShot). */
let s5seq = 0;
function closedShot({ round = "today", club = "7i", hole, intended = 170, dist = 0, lat = 0, lie = "fairway", contact = 0, line = "safe", rec = null, shotNo = 2, logged = "quick" }) {
  s5seq++;
  const r = newShotRecord({
    id: `s5-${s5seq}`, roundId: round, courseId: "c1", hole, shotNo, ts: new Date(Date.UTC(2026, 8, 29, 14, 0, s5seq)).toISOString(),
    start: { lat: null, lng: null, accuracyM: 4, distanceToPinYds: intended, playsLikeYds: intended, frame: { x: 0, y: 0 } },
    target: { frame: { x: 0, y: intended }, label: "green, center" },
    lie: { inferred: lie, confidence: "high", confirmed: lie, quality: "standard" },
    club, linePlayed: line, contact, logged, recommendation: rec,
  });
  return closeOutShot(r, { endFrame: { x: lat, y: intended + dist }, endLie: "fairway" });
}

function readyAt(ball) {
  return run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: ball }, { type: "exp", exp: true });
}

test("S5 nudge line: two short mid-iron misses this round → one `Today` line, on the engine ctx and in the rail", () => {
  const shots = [closedShot({ club: "7i", hole: 3, dist: -12 }), closedShot({ club: "6i", hole: 6, intended: 180, dist: -10 })];
  const base = { hole: 7, par: 4, shotNo: 2, ball: { x: 0, y: 230 }, lieType: "fairway" };
  const ctx = withinRoundCtx(base, shots, P);
  assert.ok(ctx.adjust.distYds.mid > 0, "short misses → the mid family plays longer");
  assert.equal(ctx.nudges.length, 1);
  assert.equal(base.adjust, undefined, "the caller's ctx is not mutated");
  const res = recommend(ctx, waterLeftPar4, P);
  assert.deepEqual(res.nudges, ctx.nudges, "the engine echoes the nudge");
  const v = caddieView({ state: readyAt({ x: 0, y: 230 }), par: 4, res, ballXY: { x: 0, y: 230 }, green: waterLeftPar4.green });
  assert.equal(v.details.today.length, 1);
  assert.match(v.details.today[0], /^Short twice with mid irons \(H3, H6\) → \+(½|1) club/);
});

test("S5 nudge line: nothing without evidence; one miss, skipped shots and other families do not fire; flags get their own line", () => {
  const base = { hole: 7, par: 4, shotNo: 2, ball: { x: 0, y: 230 }, lieType: "fairway" };
  const view = (shots) => {
    const res = recommend(withinRoundCtx(base, shots, P), waterLeftPar4, P);
    return caddieView({ state: readyAt({ x: 0, y: 230 }), par: 4, res, ballXY: { x: 0, y: 230 }, green: waterLeftPar4.green }).details.today;
  };
  assert.deepEqual(view([]), []);
  assert.deepEqual(view([closedShot({ hole: 3, dist: -12 })]), [], "one miss is not evidence");
  assert.deepEqual(view([closedShot({ hole: 3, dist: -12 }), closedShot({ hole: 4, dist: -11, logged: "skipped" })]), [], "a skipped shot is not evidence (D18)");
  // two families, one lie → the lie group (§5.5 "OR from the same lie type") fires instead
  assert.deepEqual(view([closedShot({ hole: 3, dist: -12 }), closedShot({ club: "PW", hole: 4, intended: 135, dist: -11 })]), ["Short twice from the fairway (H3, H4) → +½ club"]);
  assert.deepEqual(view([closedShot({ hole: 3, dist: -12 }), closedShot({ club: "PW", hole: 4, intended: 135, dist: -11, lie: "rough" })]), [], "different family and different lie → no evidence");
  const fat = view([closedShot({ club: "GW", hole: 3, intended: 110, contact: -1 }), closedShot({ club: "SW", hole: 6, intended: 90, contact: -1 })]);
  assert.deepEqual(fat, ["2 fat wedges today (H3, H6)"]);
  assert.deepEqual(todayLines({ nudges: [{ text: "a" }], flags: [{ text: "b" }] }), ["a", "b"], "nudges first, then flags");
  assert.deepEqual(todayLines(null), []);
  // no recommendation on screen → no Today line even with a nudge in hand
  const pre = caddieView({ state: initialCaddie(7), par: 4, res: { ...fakeRes(), nudges: [{ text: "x" }] } });
  assert.deepEqual(pre.details.today, []);
});

test("S5 dispersion line: Shot Pattern's source before takeover, `Loop · 80% · {n} shots` after", () => {
  const N = DEFAULT_CONFIG.TAKEOVER_N;
  const pwShots = (n) => Array.from({ length: n }, (_, i) => closedShot({ round: `r${1 + (i % 3)}`, club: "PW", hole: 1 + (i % 18), intended: 140, dist: ((i * 7) % 11) - 6, lat: ((i * 5) % 9) - 3 }));
  const history = [{ id: "r1", date: "2026-09-20T12:00:00Z" }, { id: "r2", date: "2026-09-22T12:00:00Z" }, { id: "r3", date: "2026-09-25T12:00:00Z" }];
  const line = (shots) => {
    const Pl = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")), P.config, { overlays: learningOverlays(P, shots, history, Date.parse("2026-09-29T00:00:00Z")) });
    const resolve = (c, sw) => resolveEntry(Pl, c, sw, "fairway");
    const opts = ellipsesFor({ safe: { club: "PW", swingType: "full", label: "Pitching wedge" }, sameShot: true }, resolve);
    return dispersionLine(opts.safe);
  };
  assert.equal(line(pwShots(N - 1)).source, "Shot Pattern · 80% · Sep 19", "below takeover Shot Pattern's ellipse and date stay");
  const after = line(pwShots(N + 2));
  assert.equal(after.source, `Loop · 80% · ${N + 2} shots`);
  assert.ok(after.w > 0 && after.d > 0);
  // the plain σ ellipse keeps its wording
  assert.equal(dispersionLine({ club: "7i", label: "7-iron", ell: { w: 20, h: 10, tiltDeg: 90, dx: 0, dy: 0, source: "profile" } }).source, "Profile spread · 80%");
  assert.equal(dispersionLine({ club: "7i", ell: { w: 20, h: 10, tiltDeg: 0, dx: 0, dy: 0, source: "loop", n: 31, scaled: true } }).source, "Loop · 80% · 31 shots · +15% bad lie");
});

test("S5 overlays: finished rounds only, newest = 1; the round in progress and deleted rounds weigh 0", () => {
  const history = [{ id: "a", date: "2026-09-01T12:00:00Z" }, { id: "c", date: "2026-09-20T12:00:00Z" }, { id: "b", date: "2026-09-10T12:00:00Z" }];
  assert.deepEqual(roundIndexFromHistory(history), { c: 1, b: 2, a: 3 });
  assert.deepEqual(roundIndexFromHistory([]), {});
  const shots = [closedShot({ round: "c", hole: 1, dist: 20, intended: 180 }), closedShot({ round: "today", hole: 2, dist: 40, intended: 180 }), closedShot({ round: "gone", hole: 3, dist: 30, intended: 180 })];
  const ovs = learningOverlays(P, shots, history, Date.parse("2026-09-29T00:00:00Z"));
  const ov = ovs["7i|full|fairway"];
  assert.equal(ov.n, 1, "only round c's shot counts");
  assert.deepEqual(ov.shotIds, [shots[0].id]);
  assert.equal(learningOverlays(P, [], history, 0), null, "nothing logged → no overlays");
});

test("S5 aggression scorecard model: per round and season counts, paid / cost text, nothing without shots", () => {
  const rec = (safe, aggr) => ({ safe: { club: "7i", expScore: safe }, aggressive: aggr != null ? { club: "5i", expScore: aggr } : null });
  // Round A: hole 1 aggressive from shot 2 priced 3.0 to hole out; scored 4 → 3 strokes from shot 2 → 2 to hole out... (4 − 1) − 3.0 = 0 → paid +0.0
  const shots = [
    closedShot({ round: "A", hole: 1, shotNo: 2, club: "5i", line: "aggressive", rec: rec(3.2, 3.0) }),
    closedShot({ round: "A", hole: 2, shotNo: 2, club: "7i", line: "safe", rec: rec(2.9, 3.1) }),
    closedShot({ round: "A", hole: 3, shotNo: 2, club: "8i", line: "own", rec: rec(3.0, null) }),
    closedShot({ round: "B", hole: 1, shotNo: 1, club: "5i", line: "aggressive", rec: rec(4.1, 4.2) }),
    closedShot({ round: "B", hole: 2, shotNo: 1, club: "5i", line: "aggressive", rec: rec(4.1, 4.2), logged: "skipped" }),
    closedShot({ round: "gone", hole: 1, shotNo: 1, club: "5i", line: "aggressive", rec: rec(4.1, 4.2) }),
  ];
  const history = [
    { id: "A", date: "2026-09-20T12:00:00Z", holeScores: [3, 4, 4, ...Array(15).fill(4)] },
    { id: "B", date: "2026-09-22T12:00:00Z", holeScores: [6, 5, ...Array(16).fill(4)] },
    { id: "N", date: "2026-09-23T12:00:00Z", holeScores: Array(18).fill(4) },
  ];
  const m = aggressionModel(shots, history);
  // A hole 1: (3 − 1) − 3.0 = −1.0 → aggression paid +1.0; B hole 1: 6 − 0 − 4.2 = +1.8 → cost −1.8
  assert.equal(m.rounds.A.text, "Aggression paid +1.0");
  assert.deepEqual([m.rounds.A.word, m.rounds.A.amount], ["Aggression paid", "+1.0"]);
  assert.deepEqual(m.rounds.A.counts.map((c) => [c.label, c.n]), [["Safe", 1], ["Aggressive", 1], ["Own call", 1]]);
  assert.equal(m.rounds.B.text, "Aggression cost −1.8");
  assert.deepEqual(m.rounds.B.counts.map((c) => c.n), [0, 1, 0], "the skipped shot's line was never confirmed");
  assert.equal(m.rounds.N, undefined, "a round with no logged shots shows nothing");
  assert.equal(m.rounds.gone, undefined, "a deleted round's shots are not counted");
  assert.equal(m.season.text, "Aggression cost −0.8");
  assert.deepEqual(m.season.counts.map((c) => c.n), [1, 2, 1]);
  // Summary: live scores for a round not yet in history
  const live = aggressionModel(shots.filter((s) => s.roundId === "A"), [], { A: [2, 4, 4] });
  assert.equal(live.rounds.A.text, "Aggression paid +2.0", "an edited hole re-prices the round");
  assert.equal(aggressionModel([], history).season, null);
  assert.equal(aggressionView({ safe: { n: 2 }, aggressive: { n: 0 }, own: { n: 0 }, text: null }).text, null, "counts without a priced aggressive shot → counts only");
  assert.equal(aggressionView({ safe: { n: 0 }, aggressive: { n: 0 }, own: { n: 0 }, text: null }), null);
});

/* ---------- v22.11: marked-green mode and the draggable pin ---------- */

test("marked-green views: pre-tee offers the tee and yards; a fix with no green asks for the tap; GPS errors keep their own views", () => {
  const S = initialCaddie(7);
  const bar = (v) => [v.bar.primary.label, v.bar.secondary?.label ?? null];
  const pre = caddieView({ state: S, par: 4, mapOk: false, markable: true });
  assert.equal(pre.view, "pretee"); assert.deepEqual(bar(pre), ["I'm on the tee", "Log shot"]);
  assert.equal(pre.notice, "No course map for hole 7. Tap I'm on the tee for satellite.");
  assert.equal(caddieView({ state: S, par: 4, mapOk: false, markable: true, greenMarked: true }).notice, "Hole 7: green marked. Tap I'm on the tee for satellite.");
  const fixed = run(S, { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const mark = caddieView({ state: fixed, par: 4, mapOk: false, markable: true });
  assert.equal(mark.view, "markgreen"); assert.equal(mark.rail.aim, "Tap the green"); assert.equal(mark.rail.club, "—"); assert.equal(mark.rail.toggle, null);
  assert.deepEqual(bar(mark), ["I'm at my ball", "Log shot"]);
  assert.equal(mark.notice, "No course map. Satellite on GPS — tap the green to mark it.");
  const nofix = caddieView({ state: run(S, { type: "tee" }, { type: "fixError", code: 3 }), par: 4, mapOk: false, markable: true });
  assert.equal(nofix.view, "nofix"); assert.deepEqual(bar(nofix), ["Try again", "Enter yards"]);
  // not markable (no satellite for the fix): exactly the old No course map state
  const old = caddieView({ state: fixed, par: 4, mapOk: false, markable: false });
  assert.equal(old.view, "nomap"); assert.deepEqual(bar(old), ["I'm at my ball", "Log shot"]); assert.equal(old.notice, "No course map for hole 7. Enter yards for a club.");
  // Enter yards on an unmapped hole: club-brain as today; the bar can go back to GPS
  const yv = caddieView({ state: run(S, { type: "yards", yards: 150 }), par: 4, mapOk: false, markable: true, res: fakeRes() });
  assert.equal(yv.view, "yards"); assert.deepEqual(bar(yv), ["I'm at my ball", "Log shot"]);
  assert.equal(caddieView({ state: run(S, { type: "yards", yards: 150 }), par: 4, mapOk: false, res: fakeRes() }).bar.primary.label, "I'm at my ball", "v22.12: markable or not");
  // once marked the synthetic hole makes it an ordinary Ready screen, with the no-hazards line in details
  const ready = caddieView({ state: fixed, par: 4, mapOk: true, markable: true, synthetic: true, res: fakeRes(), ballXY: { x: 0, y: 0 } });
  assert.equal(ready.view, "ready"); assert.equal(ready.notice, null);
  assert.equal(ready.details.mapNote, "No hazards on this map — the caddie prices distance only.");
  assert.equal(caddieView({ state: fixed, par: 4, res: fakeRes(), ballXY: { x: 0, y: 0 } }).details.mapNote, null, "mapped holes say nothing");
  for (const v of [pre, mark, nofix, ready]) for (const t of [v.notice, v.rail.aim, v.details.mapNote].filter(Boolean)) assert.ok(!t.includes("!"), t);
});

test("marked-green reducer: remark re-opens the mark view, greenMarked closes it and drops a custom pin; neither persists", () => {
  let s = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "pin", value: { lat: 39.95, lng: -85.98 } });
  s = caddieReducer(s, { type: "remark", on: true });
  assert.equal(s.remark, true);
  s = caddieReducer(s, { type: "greenMarked" });
  assert.equal(s.remark, false); assert.equal(pinSetting(s), "middle", "the old custom pin belonged to the old mark");
  const back = caddieReducer(caddieReducer(s, { type: "pin", value: "back" }), { type: "greenMarked" });
  assert.equal(pinSetting(back), "back", "a preset survives a re-mark");
  const r = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie({ ...s, remark: true, pinView: true }))));
  assert.equal(r.remark, false); assert.equal(r.pinView, false);
  // a new ball clears it
  const moved = run({ ...s, remark: true }, { type: "ball" }, { type: "fix", fix: fix(), point: { x: 0, y: 50 } });
  assert.equal(moved.remark, false);
});

test("pin view: flag button toggles it, the rail collapses, a new ball / hole / locate leaves it", () => {
  let s = run(initialCaddie(3), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } }, { type: "exp", exp: true });
  s = caddieReducer(s, { type: "pinView", on: true });
  assert.equal(s.pinView, true); assert.equal(s.exp, false, "rail collapses");
  assert.equal(caddieReducer(s, { type: "pinView", on: false }).pinView, false);
  assert.equal(caddieReducer(s, { type: "ball" }).pinView, false, "locating leaves the pin view");
  assert.equal(caddieReducer(s, { type: "hole", hole: 4 }).pinView, false);
  const off = caddieReducer(initialCaddie(3), { type: "pinView", on: false });
  assert.deepEqual(off, initialCaddie(3), "closing a closed pin view is a no-op");
  // the notice reads the yards to the pin, live
  const v = caddieView({ state: s, par: 4, res: fakeRes(), ballXY: { x: 0, y: 0 }, pinYds: 143.4 });
  assert.equal(v.notice, "143 yds to the pin");
  assert.equal(caddieView({ state: { ...s, pinView: false }, par: 4, res: fakeRes(), ballXY: { x: 0, y: 0 }, pinYds: 143 }).notice, null);
});

test("drag → custom pin: released anywhere, clamped inside the green, stored as lat/lng, held for the hole", () => {
  const hole = bunkeredPar3;
  const inside = { x: hole.green.center.x + 2, y: hole.green.center.y + 3 };
  assert.deepEqual(pinFromDrag(hole, inside), { x: inside.x, y: inside.y }, "a frameless hole stores the frame point");
  const q = pinFromDrag(hole, { x: hole.green.center.x + 60, y: hole.green.center.y });
  assert.ok(pointInRing(q, hole.green.ring), "a release off the green is clamped onto it — no 3-yd gate");
  assert.equal(pinFromDrag(hole, null), null);
  // on a marked green (lat/lon-anchored), the value is {lat,lng} and comes back through pinPointFor
  const B = { lat: 39.9502, lon: -85.9817 };
  const mh = markedGreenHole({ ball: B, green: destination(B, 60, 150 / YARDS_PER_METER), holeNo: 7 });
  const c = mh.green.center;
  const v = pinFromDrag(mh, { x: 40, y: c.y + 20 });
  assert.ok(Number.isFinite(v.lat) && Number.isFinite(v.lng));
  let s = run(initialCaddie(7), { type: "tee" }, { type: "fix", fix: fix(B.lat, B.lon), point: { x: 0, y: 0 } }, { type: "pinView", on: true }, { type: "pin", value: v });
  assert.equal(chipList({ pin: pinSetting(s) }).find((k) => k.key === "pin").value, "Custom");
  const drawn = pinPointFor(mh, mh.tee, pinSetting(s));
  assert.ok(pointInRing(drawn, mh.green.ring), "the drawn pin is on the green");
  const back = frameOf(mh).toFrame({ lat: v.lat, lon: v.lng });
  assert.ok(Math.hypot(back.x - drawn.x, back.y - drawn.y) < 0.05, "lat/lng round-trips");
  // the pin holds across the next ball on the hole, and a preset from the chip replaces it
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(), point: { x: 0, y: 80 } });
  assert.deepEqual(pinSetting(s), { lat: v.lat, lng: v.lng });
  assert.equal(pinSetting(caddieReducer(s, { type: "chip", key: "pin", value: "front" })), "front");
});

/* ---------- v22.12: Log shot and I'm at my ball with no map ---------- */

test("v22.12 bar: every no-map state keeps I'm at my ball / the tee + Log shot, Enter yards moves to the rail", () => {
  const S = initialCaddie(4);
  const fixed = run(S, { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const bar = (v) => [v.view, v.bar.primary.label, v.bar.primary.action, v.bar.secondary?.label ?? null, v.bar.secondary?.action ?? null, v.rail.action?.label ?? null];
  const cases = [
    // no map, a fix, no satellite (not markable)
    [caddieView({ state: fixed, par: 4, mapOk: false, markable: false }), ["nomap", "I'm at my ball", "ball", "Log shot", "logshot", "Enter yards"]],
    // Enter yards not used yet vs used — with a recommendation the bar is the Ready bar, the rail keeps Enter yards
    [caddieView({ state: run(fixed, { type: "yards", yards: 160, same: true }), par: 4, mapOk: false, res: fakeRes() }), ["yards", "I'm at my ball", "ball", "Log shot", "logshot", "Enter yards"]],
    // the satellite works, no green marked yet
    [caddieView({ state: fixed, par: 4, mapOk: false, markable: true }), ["markgreen", "I'm at my ball", "ball", "Log shot", "logshot", "Enter yards"]],
    // pre-tee with the marked-green bridge on
    [caddieView({ state: S, par: 4, mapOk: false, markable: true }), ["pretee", "I'm on the tee", "tee", "Log shot", "logshot", "Enter yards"]],
    // a marked green on the drawn map (no satellite): the synthetic hole is a map, so the ordinary Ready bar
    [caddieView({ state: fixed, par: 4, mapOk: true, markable: true, synthetic: true, res: fakeRes(), ballXY: { x: 0, y: 0 } }), ["ready", "I'm at my ball", "ball", "Log shot", "logshot", null]],
    // …and Ready with no recommendation (the engine returned nothing) still offers Log shot
    [caddieView({ state: fixed, par: 4, mapOk: true, res: null, ballXY: { x: 0, y: 0 } }), ["ready", "I'm at my ball", "ball", "Log shot", "logshot", null]],
  ];
  for (const [v, want] of cases) {
    assert.deepEqual(bar(v), want, want[0]);
    assert.ok(!v.bar.primary.disabled);
  }
  // mapped holes: no rail button, the §8 bars unchanged
  assert.equal(caddieView({ state: S, par: 4 }).rail.action, null);
  assert.equal(caddieView({ state: run(S, { type: "yards", yards: 150 }), par: 4, res: fakeRes() }).rail.action, null);
  // a GPS error on an unmapped hole shows the GPS state (Try again), not No course map
  const err = caddieView({ state: run(fixed, { type: "ball" }, { type: "fixError", code: 3 }), par: 4, mapOk: false, markable: false });
  assert.equal(err.view, "nofix"); assert.equal(err.bar.primary.label, "Try again"); assert.equal(err.bar.secondary.label, "Enter yards");
  // at most two pills, always
  for (const [v] of cases) assert.ok([v.bar.primary, v.bar.secondary].filter(Boolean).length <= 2);
});

test("v22.12 notice: no map + no satellite names the part that failed", () => {
  const fixed = run(initialCaddie(5), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 0, y: 0 } });
  const v = caddieView({ state: fixed, par: 4, mapOk: false, markable: false, satFailure: "tiles blocked (HTTP 403)" });
  assert.equal(v.notice, "Satellite: tiles blocked (HTTP 403). Enter yards for a club.");
  assert.equal(caddieView({ state: fixed, par: 4, mapOk: false, satFailure: "map library failed to load" }).notice, "Satellite: map library failed to load. Enter yards for a club.");
  assert.equal(caddieView({ state: fixed, par: 4, mapOk: false }).notice, "No course map for hole 5. Enter yards for a club.", "no reason known: the old line");
  assert.equal(caddieView({ state: initialCaddie(5), par: 4, mapOk: false, satFailure: "tiles unreachable (timeout)" }).notice, "No course map for hole 5. Enter yards for a club.", "no fix: nothing was probed here");
  assert.ok(!v.notice.includes("!"));
  assert.equal(COPY.markHere, "Mark green here");
});

test("v22.12 yards for the same ball: the rail's Enter yards keeps the shot number, the fix and the chips", () => {
  const fixed = run(initialCaddie(4), { type: "tee" }, { type: "fix", fix: fix(), point: { x: 1, y: 2 } }, { type: "ball" }, { type: "fix", fix: fix(39.9, -85.9), point: { x: 3, y: 150 } }, { type: "chip", key: "lie", value: "rough" });
  assert.equal(fixed.shotNo, 2);
  let s = run(fixed, { type: "yards", yards: 142, same: true });
  assert.equal(s.phase, "yards"); assert.equal(s.shotNo, 2, "same ball"); assert.equal(s.yards, 142);
  assert.deepEqual(s.ball, fixed.ball); assert.deepEqual(s.ballXY, { x: 3, y: 150 }); assert.equal(s.chips.lie, "rough");
  s = run(s, { type: "yards", yards: 138, same: true });
  assert.equal(s.shotNo, 2, "a corrected distance is still the same ball"); assert.equal(s.yards, 138);
  // I'm at my ball from there advances as on a mapped hole, and the previous-shot line starts at the kept fix
  s = run(s, { type: "ball" }, { type: "fix", fix: fix(39.91, -85.9), point: { x: 4, y: 290 } });
  assert.equal(s.shotNo, 3); assert.equal(s.phase, "ready"); assert.equal(s.yards, null);
  assert.deepEqual(s.shots[4].at(-1), { from: { x: 3, y: 150 }, to: { x: 4, y: 290 } });
  // without `same` (the GPS-error bar's Enter yards) the old rule stands: a new ball
  assert.equal(run(fixed, { type: "yards", yards: 120 }).shotNo, 3);
  // `same` from pre-tee is shot 1 as always
  assert.equal(run(initialCaddie(4), { type: "yards", yards: 380, same: true }).shotNo, 1);
});
