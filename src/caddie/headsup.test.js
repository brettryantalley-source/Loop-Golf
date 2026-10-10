/*
 * headsup.test.js — v22.39 (C4, D110; docs/SPEC-C4-headsup.md, OK'd Oct 10): the heads-up clause on
 * the why line for SAFE's club, and the aim warning on Brett's own target or Line. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { recommend, priceTarget, aimWarning } from "./engine.js";
import { headsUp } from "./learning.js";
import { headsUpClause, aimWarningText, whyLine } from "./reasons.js";
import { waterLeftPar4, noWaterPar4 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const SP = JSON.parse(readFileSync(join(here, "../shotpattern.json"), "utf8"));

let seq = 0;
/** A Loop shot that finished `lat` yds right (− left) and `dist` long (− short) of a 150-yd target. */
const rec = (club, lat, dist = 0, o = {}) => ({ id: `h${++seq}`, roundId: "r", club, shotType: "full", logged: "full", hole: seq, shotNo: 2,
  ts: new Date(Date.UTC(2026, 9, 10, 12, 0, seq)).toISOString(), end: { lat: 34, lng: -84, accuracyM: 4, lie: "fairway" },
  derived: { lateralMissYds: lat, distanceMissYds: dist, intendedYds: 150 }, ...o });

test("C4 heads-up, today: 3 of the club's last 4 the same way (or 2 of 2) fires; 2 of 4 doesn't; a shot on its target isn't a miss", () => {
  const today = [rec("7i", -12), rec("7i", 1), rec("7i", -9), rec("7i", -15)];
  const h = headsUp({ today, club: "7i" });
  assert.deepEqual({ kind: h.kind, axis: h.axis, dir: h.dir, k: h.k, n: h.n }, { kind: "today", axis: "lat", dir: "left", k: 3, n: 4 });
  assert.equal(headsUpClause(h), "3 of 4 left today");
  assert.equal(headsUpClause({ ...h, aimYds: 6 }), "3 of 4 left today, aiming right-center", "only when the map aims right");
  assert.equal(headsUpClause({ ...h, aimYds: -6 }), "3 of 4 left today");
  assert.equal(headsUp({ today: [rec("7i", -12), rec("7i", 10), rec("7i", -9), rec("7i", 2)], club: "7i" }), null, "2 of 4: silent");
  assert.equal(headsUp({ today: [rec("8i", 14), rec("8i", 11)], club: "8i" }).k, 2, "2 of 2");
  assert.equal(headsUp({ today: [rec("8i", 14)], club: "8i" }), null, "one shot is not a pattern");
  // a 3-yard miss at 150 is inside ON_TARGET (±3.9 yds): on target, not left
  assert.equal(headsUp({ today: [rec("9i", -3), rec("9i", -3), rec("9i", -3)], club: "9i" }), null);
  // skipped shots, assumed ends and other clubs never count; distance fires too
  const mixed = [rec("PW", 0, -12), { ...rec("PW", 0, -12), logged: "skipped" }, rec("PW", 0, -10), rec("GW", 0, -20),
    { ...rec("PW", 0, -15), end: { lat: 34, lng: -84, lie: "green", assumed: true } }, rec("PW", 0, -11)];
  const d = headsUp({ today: mixed, club: "PW" });
  assert.deepEqual({ axis: d.axis, dir: d.dir, k: d.k, n: d.n }, { axis: "dist", dir: "short", k: 3, n: 3 });
});

test("C4 heads-up, history: 10+ measured shots, 3 in 10 short (with the profile's shortPct) or long (Loop's)", () => {
  const short = Array.from({ length: 10 }, (_, i) => rec("GW", 0, i < 3 ? -20 : 0));
  const h = headsUp({ history: short, club: "GW" });
  assert.deepEqual({ kind: h.kind, dir: h.dir, share: h.share, n: h.n }, { kind: "history", dir: "short", share: 0.3, n: 10 });
  assert.equal(headsUpClause(h), "it finishes short 3 in 10: the call allows for it");
  // the profile's GW: 3 short of 16 on Shot Pattern; with 4 of these 10 Loop shots short → 7 of 26 = 27%: silent
  const e = resolveEntry(P, "GW", "full", "fairway");
  const four = Array.from({ length: 10 }, (_, i) => rec("GW", 0, i < 4 ? -20 : 0));
  assert.equal(headsUp({ history: four, club: "GW", entry: e }), null);
  assert.equal(headsUp({ history: four, club: "GW" }).share, 0.4, "Loop's alone: 4 in 10");
  const long = Array.from({ length: 10 }, (_, i) => rec("6i", 0, i < 3 ? 22 : 0));
  assert.equal(headsUpClause(headsUp({ history: long, club: "6i" })), "it finishes long 3 in 10");
  assert.equal(headsUp({ history: long.slice(1), club: "6i" }), null, "under 10 shots: silent");
  // today wins over history
  assert.equal(headsUp({ today: [rec("GW", 12), rec("GW", 14)], history: short, club: "GW" }).kind, "today");
});

test("C4 the why line: one clause; today's family nudge stays unless the club's own rests on more shots; not for AGGRESSIVE", () => {
  const res = recommend({ shotNo: 2, ball: { x: 0, y: 260 }, lieType: "fairway", par: 4 }, noWaterPar4, P);
  const club = res.safe.club;
  const hu = { kind: "today", club, swing: "full", axis: "lat", dir: "right", k: 3, n: 4, aimYds: null };
  const plain = whyLine(res).text;
  assert.equal(whyLine(res, { headsUp: hu }).text, `${plain.slice(0, -1)} · 3 of 4 right today.`);
  assert.equal(whyLine(res, { headsUp: { ...hu, club: "LW" } }).text, plain, "another club's heads-up is silent");
  const fam = (holes) => ({ ...res, nudges: [{ group: { kind: "lie", key: "fairway" }, dirn: "right", phrase: "from the fairway", holes, shiftYds: 0 }] });
  assert.match(whyLine(fam([3, 5]), { headsUp: hu }).text, /3 of 4 right today/, "3 shots beat a 2-hole nudge");
  assert.match(whyLine(fam([3, 5, 7, 9]), { headsUp: hu }).text, /from the fairway/, "the nudge on more shots stays");
  assert.match(whyLine(fam([3, 5]), { headsUp: { kind: "history", club, dir: "short", share: 0.3 } }).text, /from the fairway/, "history never displaces a nudge");
  if (!res.sameShot) assert.ok(!/today/.test(whyLine(res, { opt: "aggressive", headsUp: hu }).text), "AGGRESSIVE: no heads-up");
});

test("C4 replay, Oct 3 Chicopee: every heads-up states what the club's earlier shots did that day", () => {
  const round = SP.rounds.find((r) => r.key === "2026-10-03-chicopee-woods").records.filter((r) => r.shotType === "full" || r.shotType === "finesse");
  let fired = 0, sameNext = 0;
  round.forEach((r, i) => {
    const before = round.slice(0, i);
    const h = headsUp({ today: before, club: r.club, swing: r.shotType });
    if (!h || h.kind !== "today") return;
    fired++;
    const mine = before.filter((x) => x.club === r.club && x.shotType === r.shotType && x.logged !== "skipped");
    const key = h.axis === "lat" ? "missLatSign" : "missDistSign";
    const seen = mine.map((x) => x.derived?.[key]).filter((v) => v != null).slice(-4);
    const want = h.dir === "left" || h.dir === "short" ? -1 : 1;
    assert.equal(seen.length, h.n, `${r.club} hole ${r.hole}`);
    assert.equal(seen.filter((v) => Math.sign(v) === want).length, h.k, `${r.club} hole ${r.hole}`);
    if (Math.sign(r.derived?.[key]) === want) sameNext++;
  });
  assert.ok(fired >= 3, `heads-ups that day: ${fired}`);
  assert.ok(sameNext >= 1, `the next shot went the same way ${sameNext} of ${fired}`);
});

test("C4 aim warning: trouble 10+ points over SAFE names the hazard; the club's measured miss off the green", () => {
  const ctx = { shotNo: 2, ball: { x: 0, y: 410 - 150 }, lieType: "fairway", par: 4 };
  const res = recommend(ctx, waterLeftPar4, P);
  const safeT = res.safe;
  const wet = priceTarget(ctx, waterLeftPar4, P, { x: -24, y: 330 });   // the edge of the water, left
  const w = aimWarning(wet, safeT);
  assert.equal(w.kind, "trouble"); assert.equal(w.hazard, "water");
  assert.ok(wet.troubleRate >= safeT.troubleRate + DEFAULT_CONFIG.AIM_WARN.troubleGap);
  assert.match(aimWarningText(w), /^water (1|\d) in \d+ \(Loop's call: /);
  assert.equal(aimWarning(safeT, safeT), null, "his target = the call: nothing");
  // his club's average miss (10+ Loop shots) carries the ring off the green
  const center = priceTarget(ctx, noWaterPar4, P, { x: 0, y: 410 });
  const miss = (nYds, rightYds) => ({ club: center.club, swing: "full", nYds, rightYds, longYds: 0 });
  const off = aimWarning(center, { ...center, troubleRate: 1 }, { hole: noWaterPar4, ball: ctx.ball, miss: miss(10, 25) });
  assert.deepEqual(off, { kind: "miss", rightYds: 25, longYds: 0 });
  assert.equal(aimWarningText(off), "you finish 25 R on average: that's off the green");
  assert.equal(aimWarning(center, { ...center, troubleRate: 1 }, { hole: noWaterPar4, ball: ctx.ball, miss: miss(9, 25) }), null, "under 10 shots");
  assert.equal(aimWarning(center, { ...center, troubleRate: 1 }, { hole: noWaterPar4, ball: ctx.ball, miss: miss(10, 4) }), null, "still on the green");
});

test("C4 his own Line: priceTarget starts the shot on it, and curves it by his shape", () => {
  const ctx = { shotNo: 2, ball: { x: 0, y: 260 }, lieType: "fairway", par: 4 };
  const T = { x: 0, y: 410 };
  const at = priceTarget(ctx, noWaterPar4, P, T);
  const left = priceTarget(ctx, noWaterPar4, P, T, { lineDeg: -4 });   // 4° left of the target: ~10 yds at 150
  assert.equal(left.club, at.club);
  assert.ok(left.parProb < at.parProb, `a line off the target costs par chance: ${left.parProb} vs ${at.parProb}`);
  // a draw from a line right of the target comes back: line 7 R + a 7-yd draw ≈ the caddie's own aim
  const back = priceTarget(ctx, noWaterPar4, P, T, { lineDeg: Math.atan2(7, 150) / (Math.PI / 180), curveYds: -7 });
  assert.ok(Math.abs(back.parProb - at.parProb) < Math.abs(left.parProb - at.parProb));
});
