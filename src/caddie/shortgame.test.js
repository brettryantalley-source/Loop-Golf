/*
 * shortgame.test.js — v22.40 (C29, D111; docs/SPEC-C29-shortgame.md, OK'd Oct 10): the short-game
 * card. Off the green within 100 yds the log card's row is Chip · Pitch · Bunker · Wedge; chips,
 * pitches and bunker shots are shotType "shortGame" and never teach a club's distances; where the
 * caddie has no call (inside ~30 yds) the why line gives his own short-game numbers. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG } from "./config.js";
import { loadProfile, shortBandFor } from "./profile.js";
import { recommend } from "./engine.js";
import { defaultShortKind, newShotRecord, quickLog, bareShotRecord, SHORT_CARD_YDS, CHIP_YDS } from "./shotlog.js";
import { applyShotLog } from "./learning.js";
import { shortGameLine } from "./reasons.js";
import { caddieView, initialCaddie } from "./caddieState.js";
import { openPar5 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));

test("C29 routing: Wedge from 30 to 100 yds, Chip inside 30 (Bunker from sand); nothing past 100 or on the green", () => {
  assert.equal(CHIP_YDS, 30); assert.equal(SHORT_CARD_YDS, 100);
  assert.deepEqual([29, 30, 100, 101].map((d) => defaultShortKind(d, "rough")), ["chip", "wedge", "wedge", null]);
  assert.deepEqual(["fairway", "rough", "sand", "recovery", "green"].map((l) => defaultShortKind(18, l)), ["chip", "chip", "bunker", "chip", null]);
  assert.equal(defaultShortKind(60, "sand"), "wedge", "a fairway bunker at 60 is a wedge");
  assert.equal(defaultShortKind(null, "rough"), null);
});

test("C29 records: inside 30 a shot defaults to a chip (shortGame); a type he set is kept; Wedge is the finesse swing", () => {
  const at = (d, lie, o = {}) => newShotRecord({ club: "LW", start: { distanceToPinYds: d }, lie: { confirmed: lie }, ...o });
  assert.deepEqual([at(18, "rough").shotType, at(18, "rough").shortKind], ["shortGame", "chip"]);
  assert.equal(at(12, "sand").shortKind, "bunker");
  assert.deepEqual([at(60, "fairway").shotType, at(60, "fairway").shortKind], ["finesse", undefined]);
  assert.equal(at(18, "rough", { shotType: "finesse" }).shotType, "finesse", "Wedge picked on the card");
  assert.equal(at(18, "rough", { shotType: "shortGame", shortKind: "pitch" }).shortKind, "pitch");
  assert.equal(newShotRecord({ club: "LW", shotType: "shortGame" }).shotType, "shortGame", "a Shot Pattern short-game record with no kind stays one");
  // the quick path keeps the kind; a bare record (no call) takes the lie the map inferred
  assert.equal(quickLog(at(18, "rough")).shortKind, "chip");
  const bare = bareShotRecord({ club: "SW", distanceToPinYds: 14, lieInferred: "sand" });
  assert.deepEqual([bare.shotType, bare.shortKind, bare.lie.inferred, bare.lie.confirmed], ["shortGame", "bunker", "sand", null]);
});

let seq = 0;
const logged = (o) => ({ ...newShotRecord({ roundId: "r1", courseId: "c1", hole: ++seq, shotNo: 3, club: "LW", lie: { confirmed: "fairway" },
  start: { distanceToPinYds: o.d, frame: { x: 0, y: 0 } }, logged: "full", ...o }),
  end: { lat: 34, lng: -84, accuracyM: 4, lie: "green" }, derived: { distanceMissYds: o.dist, lateralMissYds: 0, intendedYds: o.d, actualYds: o.d + o.dist } });

test("C29 learning: a chip never reaches the club's overlays; a wedge does", () => {
  const chips = [1, 2, 3, 4, 5, 6].map(() => logged({ d: 20, dist: -8 }));
  assert.ok(chips.every((r) => r.shotType === "shortGame"));
  assert.deepEqual(applyShotLog(P, chips, { roundIndexById: { r1: 1 } }, DEFAULT_CONFIG), {}, "chips teach no club distance");
  const wedges = [1, 2, 3, 4, 5, 6].map(() => logged({ d: 70, dist: -8 }));
  assert.ok(wedges.every((r) => r.shotType === "finesse"));
  const ov = applyShotLog(P, wedges, { roundIndexById: { r1: 1 } }, DEFAULT_CONFIG);
  assert.ok(Object.keys(ov).some((k) => k.startsWith("LW|finesse|")), JSON.stringify(Object.keys(ov)));
});

test("C29 no call off the green: his numbers for the lie and distance; the distances still show", () => {
  assert.equal(shortGameLine(shortBandFor(P, 18, "rough"), 18), "Rough, 18 yds: up and down 43% · you leave it 7 ft");
  assert.equal(shortGameLine(shortBandFor(P, 12, "sand"), 12), "Bunker, 12 yds: up and down 0% (8 shots) · you leave it 8 ft");
  assert.match(shortGameLine(shortBandFor(P, 40, "rough"), 40), /^Rough, 40 yds: up and down 9% · you leave it 15 ft$/);
  assert.equal(shortGameLine(null, 18), null);
  // the engine has nothing to call from just off a green
  const res = recommend({ shotNo: 3, ball: { x: 0, y: 540 - 22 }, lieType: "rough", par: 5 }, openPar5, P);
  assert.equal(res.safe, null);
  const s = { ...initialCaddie(1), phase: "ready", ball: { lat: 34, lng: -84, accuracyM: 4 }, shotNo: 3 };
  const v = caddieView({ state: s, par: 5, res, ballXY: { x: 0, y: 518 } });
  assert.equal(v.details.distances.find((c) => c.k === "Pin").v, String(res.context.distances.pin));
});
