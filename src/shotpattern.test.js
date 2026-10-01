/*
 * shotpattern.test.js — v22.16: the Shot Pattern shot-list importer (scripts/import-shotpattern.mjs)
 * and the load-time seeding into the shot log (shotlog.js seedShotPatternRecords).
 * Run: node --test src/shotpattern.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { roundFromShots, buildBundle, readRounds, mapClub, mapLie, missSigns } from "../scripts/import-shotpattern.mjs";
import { seedShotPatternRecords, matchHistoryRound, sameCourse, spRoundIdFor, loadShots, importShots, exportShots, SHOTS_KEY } from "./caddie/shotlog.js";

const IRONWOOD = JSON.parse(fs.readFileSync(new URL("../data/extracted/rounds/2026-09-28-ironwood/shots.json", import.meta.url), "utf8"));
const R = roundFromShots(IRONWOOD, "2026-09-28-ironwood");
const byId = (id) => R.records.find((r) => r.id === id);

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), writes: 0, _m: m };
}
function countingStorage() {
  const s = memStorage();
  const set = s.setItem;
  s.setItem = (k, v) => { s.writes++; set(k, v); };
  return s;
}

/* ---------- the mapper ---------- */

test("importer: every Ironwood row becomes one record; the round reconciles to 81 with the two penalties", () => {
  assert.equal(R.records.length, IRONWOOD.driving.length + IRONWOOD.approach.length + IRONWOOD.shortGame.length + IRONWOOD.putting.length);
  assert.equal(R.records.length, 79);
  assert.deepEqual(R.holesShort, [], "rows + penalties = the score on every hole");
  assert.equal(R.date, "2026-09-28"); assert.equal(R.course, "Ironwood Golf Club"); assert.deepEqual(R.nines, ["Lakes", "Ridge"]);
  assert.equal(R.score, 81); assert.equal(R.sg.putting, -4.2); assert.equal(R.complete, true);
  assert.ok(R.records.every((r) => r.source === "shotpattern" && r.schema === 1 && r.roundId === null && r.reviewed === true && r.logged === "imported"));
  // ids are deterministic and unique; shotNo runs 1..n within each hole
  assert.equal(new Set(R.records.map((r) => r.id)).size, R.records.length);
  for (let h = 1; h <= 18; h++) {
    const recs = R.records.filter((r) => r.hole === h);
    assert.deepEqual(recs.map((r) => r.shotNo), recs.map((_, i) => i + 1), `hole ${h}`);
    assert.ok(recs.every((r) => r.id === `sp:2026-09-28:${h}:${r.shotNo}`));
    assert.ok(recs.every((r) => r.nine === (h <= 9 ? "front" : "back")));
  }
  // order within a hole: drive, approaches, short game, putts (hole 8: 2i, 4Hy, PW, three putts)
  assert.deepEqual(R.records.filter((r) => r.hole === 8).map((r) => r.sp.category), ["driving", "approach", "approach", "putting", "putting", "putting"]);
  // ts is synthetic and strictly increasing in playing order
  const ts = R.records.map((r) => Date.parse(r.ts));
  assert.ok(ts.every((t, i) => i === 0 || t > ts[i - 1]));
});

test("importer: driving rows — lateral ± offline, no distance component, total yards", () => {
  const d1 = byId("sp:2026-09-28:1:1");                    // Dr 246, deep rough, 59 right
  assert.equal(d1.club, "Dr"); assert.equal(d1.shotType, "full"); assert.equal(d1.lie.confirmed, "tee");
  assert.equal(d1.start.distanceToPinYds, 438, "Shot Pattern's tee yardage for the hole");
  assert.equal(d1.end.lie, "rough"); assert.equal(d1.end.lieDetail, "deep");
  assert.deepEqual(
    { lat: d1.derived.lateralMissYds, dist: d1.derived.distanceMissYds, total: d1.derived.totalYds, src: d1.derived.source },
    { lat: 59, dist: null, total: 246, src: "shotpattern" });
  const d6 = byId("sp:2026-09-28:6:1");                    // 2i 264, penalty, 47 left
  assert.equal(d6.derived.lateralMissYds, -47); assert.equal(d6.end.lie, "penalty");
  assert.equal(byId("sp:2026-09-28:10:1").club, "2Hy");
  assert.equal(byId("sp:2026-09-28:10:1").end.lie, "recovery");
  const d18 = byId("sp:2026-09-28:18:1");                  // 0 offline stays 0 (never −0)
  assert.ok(Object.is(d18.derived.lateralMissYds, 0));
  assert.equal(d1.sp.sg, -0.58);
  assert.equal(d1.linePlayed, null); assert.equal(d1.contact, null); assert.equal(d1.curve, null); assert.equal(d1.intendedShape, null);
});

test("importer: approach rows — total miss and signs, components null; feet ÷ 3 or the y value", () => {
  const a1 = byId("sp:2026-09-28:1:2");                    // 5i from deep rough, 21' short left
  assert.equal(a1.club, "5i"); assert.equal(a1.lie.confirmed, "rough"); assert.equal(a1.lieDetail, "deep");
  assert.equal(a1.start.distanceToPinYds, 218);
  assert.deepEqual(
    { t: a1.derived.missTotalYds, d: a1.derived.missDistSign, l: a1.derived.missLatSign, dm: a1.derived.distanceMissYds, lm: a1.derived.lateralMissYds },
    { t: 7, d: -1, l: -1, dm: null, lm: null });
  assert.equal(a1.end.toHoleFt, 46); assert.equal(a1.end.lie, "fairway");
  assert.equal(a1.sp.missNote, "21' short left of target");
  const a5 = byId("sp:2026-09-28:5:2");                    // 6i 35' long left → 11.7 yds
  assert.equal(a5.derived.missTotalYds, 11.7); assert.equal(a5.derived.missDistSign, 1); assert.equal(a5.derived.missLatSign, -1);
  const lay = byId("sp:2026-09-28:8:2");                   // 4Hy layup: 39y short right, 145 yds to the hole
  assert.equal(lay.derived.missTotalYds, 39); assert.equal(lay.derived.missLatSign, 1);
  assert.equal(lay.end.toHoleYds, 145); assert.equal(lay.end.toHoleFt, 435);
  const par3 = byId("sp:2026-09-28:7:1");                  // a par-3 tee shot is an approach from the tee
  assert.equal(par3.lie.confirmed, "tee"); assert.equal(par3.shotType, "full"); assert.equal(par3.club, "8i");
  const unknown = byId("sp:2026-09-28:6:2");               // Unknown Club → null
  assert.equal(unknown.club, null); assert.equal(unknown.end.lie, "recovery");
  const rec = byId("sp:2026-09-28:10:2");                  // from recovery → shotType recovery
  assert.equal(rec.shotType, "recovery"); assert.equal(rec.lie.confirmed, "recovery");
  assert.equal(byId("sp:2026-09-28:16:1").end.lie, "penalty");
  assert.equal(byId("sp:2026-09-28:3:2").shotType, "full", "a 98-yd SW approach stays full (Shot Pattern's approach, not Loop's finesse default)");
});

test("importer: short game — finesse, recovery, the proximity as the miss, and a putter from off the green", () => {
  const sg2 = byId("sp:2026-09-28:2:3");                   // LW 11 yds from rough → 3'
  assert.equal(sg2.shotType, "finesse"); assert.equal(sg2.club, "LW");
  assert.equal(sg2.derived.missTotalYds, 1); assert.equal(sg2.derived.missDistSign, -1); assert.equal(sg2.derived.missLatSign, 1);
  assert.equal(sg2.derived.distanceMissYds, null); assert.equal(sg2.derived.lateralMissYds, null);
  assert.equal(sg2.end.toHoleFt, 3);
  const sg6 = byId("sp:2026-09-28:6:3");                   // LW from recovery
  assert.equal(sg6.shotType, "recovery"); assert.equal(sg6.derived.missTotalYds, 17.3);
  assert.equal(byId("sp:2026-09-28:14:2").club, null, "Unknown Club chip");
  const chipPutt = byId("sp:2026-09-28:1:3");              // putter from the fairway, 15 yds → 4'
  assert.equal(chipPutt.shotType, "putt"); assert.equal(chipPutt.sp.category, "shortGame");
  assert.deepEqual(chipPutt.putt, { distanceFt: 45, made: false, speed: -1, breakRead: null, line: 1 });
  assert.equal(chipPutt.lie.confirmed, "fairway"); assert.deepEqual(chipPutt.end, { lie: "green", toHoleFt: 4 });
});

test("importer: putting — ±1 / 0 only, breakRead null, feet kept to the hundredth", () => {
  const putts = R.records.filter((r) => r.sp.category === "putting");
  assert.equal(putts.length, 36);
  assert.ok(putts.every((p) => p.shotType === "putt" && p.putt.breakRead === null));
  assert.ok(putts.every((p) => [-1, 0, 1].includes(p.putt.speed) && [-1, 0, 1].includes(p.putt.line)));
  const made = byId("sp:2026-09-28:1:4");
  assert.deepEqual(made.putt, { distanceFt: 4.17, made: true, speed: 0, breakRead: null, line: 0 });
  const miss = byId("sp:2026-09-28:4:3");                  // 20' long left
  assert.deepEqual(miss.putt, { distanceFt: 20, made: false, speed: 1, breakRead: null, line: -1 });
  // every hole ends with a made putt
  for (let h = 1; h <= 18; h++) assert.equal(R.records.filter((r) => r.hole === h).at(-1).putt?.made, true, `hole ${h}`);
});

test("importer: vocabulary — unknown words fail loudly, known ones map", () => {
  assert.equal(mapClub("Unknown Club"), null); assert.equal(mapClub(null), null);
  assert.equal(mapClub("putter"), "Putter"); assert.equal(mapClub("4Hy"), "4Hy"); assert.equal(mapClub("PW"), "PW");
  assert.throws(() => mapClub("3w"), /unknown club/);
  assert.deepEqual(mapLie("deep rough"), { lie: "rough", detail: "deep" });
  assert.deepEqual(mapLie("recovery"), { lie: "recovery", detail: null });
  assert.throws(() => mapLie("cart path"), /unknown lie/);
  assert.deepEqual(missSigns("long right of hole"), { dist: 1, lat: 1 });
  assert.deepEqual(missSigns("21' short left of target"), { dist: -1, lat: -1 });
  assert.deepEqual(missSigns(""), { dist: null, lat: null });
  assert.throws(() => roundFromShots({ schema: 2 }, "x"), /schema 1/);
});

test("importer: src/shotpattern.json is the fresh build of data/extracted/rounds (the --check contract)", () => {
  const committed = JSON.parse(fs.readFileSync(new URL("./shotpattern.json", import.meta.url), "utf8"));
  const fresh = buildBundle(readRounds(), committed.generated);
  assert.deepEqual(committed, JSON.parse(JSON.stringify(fresh)));
  assert.equal(committed.version, 1);
  assert.deepEqual(committed.rounds.map((r) => r.key), readRounds().map((r) => r.key));   // every round folder, in order
  assert.ok(committed.rounds.some((r) => r.key === "2026-09-28-ironwood"));
});

/* ---------- seeding on the phone ---------- */

const BUNDLE = { version: 1, generated: "x", rounds: [R] };
const HIST = [
  { id: "rOther", date: "2026-09-28T15:00:00.000Z", course: "Hampton Golf Village", yourTotal: 81 },
  { id: "rIron", date: "2026-09-28T21:40:00.000Z", course: "Ironwood Golf Club", yourTotal: 81, routing: "Lakes / Ridge" },
];

test("seeding: records land under the Loop round that matches by day and course; idempotent; never overwrites", () => {
  assert.ok(sameCourse("Ironwood", "Ironwood Golf Club"));
  assert.ok(!sameCourse("Ironwood Golf Club", "Hampton Golf Village"));
  assert.ok(!sameCourse("Golf Club", "Ironwood Golf Club"), "no distinctive words → no match");
  assert.equal(matchHistoryRound(R, HIST).id, "rIron");
  assert.equal(matchHistoryRound({ ...R, date: "2026-09-27" }, HIST), null);

  const st = countingStorage();
  const first = seedShotPatternRecords(st, BUNDLE, HIST);
  assert.deepEqual(first, { added: 79, moved: 0, kept: 0 });
  assert.equal(st.writes, 1);
  const mine = loadShots(st, "rIron");
  assert.equal(mine.length, 79);
  assert.ok(mine.every((r) => r.roundId === "rIron" && r.source === "shotpattern"));

  // second run: nothing added, nothing written
  assert.deepEqual(seedShotPatternRecords(st, BUNDLE, HIST), { added: 0, moved: 0, kept: 79 });
  assert.equal(st.writes, 1);

  // a record Brett has edited since is never overwritten by the bundle
  const map = JSON.parse(st.getItem(SHOTS_KEY));
  map.rIron[0].club = "2i"; map.rIron[0].edited = true;
  st.setItem(SHOTS_KEY, JSON.stringify(map));
  seedShotPatternRecords(st, BUNDLE, HIST);
  assert.equal(loadShots(st, "rIron")[0].club, "2i");

  // Loop's own records on that round and elsewhere are untouched
  const s2 = memStorage({ [SHOTS_KEY]: JSON.stringify({ rIron: [{ id: "own1", roundId: "rIron", hole: 1, shotNo: 1, schema: 1 }], rX: [{ id: "x", roundId: "rX", schema: 1 }] }) });
  seedShotPatternRecords(s2, BUNDLE, HIST);
  assert.equal(loadShots(s2, "rIron").length, 80); assert.equal(loadShots(s2, "rX").length, 1);
});

test("seeding: no matching round → sp:{key}; the round arriving later (cloud) moves them, content unchanged", () => {
  const st = memStorage();
  assert.equal(spRoundIdFor(R, []), "sp:2026-09-28-ironwood");
  assert.deepEqual(seedShotPatternRecords(st, BUNDLE, []), { added: 79, moved: 0, kept: 0 });
  assert.equal(loadShots(st, "sp:2026-09-28-ironwood").length, 79);
  const before = loadShots(st, "sp:2026-09-28-ironwood")[5];
  assert.deepEqual(seedShotPatternRecords(st, BUNDLE, HIST), { added: 0, moved: 79, kept: 0 });
  assert.equal(loadShots(st, "sp:2026-09-28-ironwood").length, 0);
  assert.ok(!("sp:2026-09-28-ironwood" in JSON.parse(st.getItem(SHOTS_KEY))), "the empty fallback bucket goes");
  const after = loadShots(st, "rIron").find((r) => r.id === before.id);
  assert.deepEqual({ ...after, roundId: null }, { ...before, roundId: null });
  assert.deepEqual(seedShotPatternRecords(st, BUNDLE, HIST), { added: 0, moved: 0, kept: 79 });
  // null storage / bundle never throws
  assert.deepEqual(seedShotPatternRecords(null, BUNDLE, HIST), { added: 0, moved: 0, kept: 0 });
  assert.deepEqual(seedShotPatternRecords(st, null, HIST), { added: 0, moved: 0, kept: 0 });
});

test("seeding: the shot-log Export carries the imports and Import round-trips them without duplicates", () => {
  const st = memStorage();
  seedShotPatternRecords(st, BUNDLE, HIST);
  const out = JSON.parse(exportShots(st));
  assert.equal(out.shots.filter((s) => s.source === "shotpattern").length, 79);
  const other = memStorage();
  assert.equal(importShots(other, out).added, 79);
  assert.equal(importShots(other, out).added, 0);
  seedShotPatternRecords(other, BUNDLE, HIST);
  assert.equal(loadShots(other).length, 79);
});
