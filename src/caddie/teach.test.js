/*
 * teach.test.js — v22.57 (C46, D128): a round the caddie brain ignores (History's Teaches / Ignored
 * switch), Place by hand (the armed map in a live round, with Cancel), and a stroke deleted from the
 * mid-hole Shots list. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { saveShot, loadShots, allShots, teaches, setRoundTeaching, roundTeaches, defaultIntendedShape, importShots, exportShots, seedShotPatternRecords } from "./shotlog.js";
import { headsUp, tendencies, missSummary, teeShotGrade } from "./learning.js";
import { initialCaddie, caddieReducer, caddieView, serializeCaddie, COPY } from "./caddieState.js";

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
}
let seq = 0;
const rec = (roundId, club, lat, dist = 0, o = {}) => ({ id: `t${++seq}`, roundId, courseId: "c", club, shotType: "full", logged: "full", hole: (seq % 18) + 1, shotNo: 2,
  ts: new Date(Date.UTC(2026, 9, 11, 12, 0, seq)).toISOString(), end: { lat: 34, lng: -84, accuracyM: 4, lie: "fairway" }, intendedShape: "fade",
  derived: { lateralMissYds: lat, distanceMissYds: dist, intendedYds: 150 }, linePlayed: "safe", ...o });

test("C46 teach flag: History's switch marks every record of the round; the log and the Shots list keep them", () => {
  const st = makeStorage();
  const a = [rec("today", "7i", -12), rec("today", "7i", -9), rec("today", "7i", -15)];
  const b = [rec("older", "7i", 8), rec("older", "7i", 11)];
  [...a, ...b].forEach((r) => saveShot(st, r));
  assert.ok(a.every(teaches) && b.every(teaches));
  assert.equal(roundTeaches(st, "today"), true);
  assert.equal(setRoundTeaching(st, "today", false), 3);
  assert.equal(roundTeaches(st, "today"), false);
  assert.equal(roundTeaches(st, "older"), true);
  assert.equal(roundTeaches(st, "nothing-here"), true, "a round with no shots teaches by default");
  // still in the log, every one; the Shots list reads loadShots, not the gates
  assert.equal(loadShots(st, "today").length, 3);
  assert.ok(loadShots(st, "today").every((r) => r.teach === false));
  assert.equal(allShots(st).length, 5);
  // back on: the mark goes, the record is otherwise untouched
  assert.equal(setRoundTeaching(st, "today", true), 3);
  assert.equal(roundTeaches(st, "today"), true);
  assert.ok(loadShots(st, "today").every((r) => !("teach" in r)));
  assert.equal(setRoundTeaching(st, null, false), 0);
});

test("C46 teach flag: the brain skips an ignored round — heads-up, tendencies, misses, tee grade, the usual shape", () => {
  const today = [rec("today", "7i", -12), rec("today", "7i", -9), rec("today", "7i", -15)];
  assert.equal(headsUp({ today, club: "7i" }).k, 3, "teaching: 3 of 3 left fires");
  const off = today.map((r) => ({ ...r, teach: false }));
  assert.equal(headsUp({ today: off, club: "7i" }), null, "ignored: silent");
  assert.equal(headsUp({ today: [], history: off, club: "7i" }), null, "ignored history: silent");
  const t = tendencies([...off, rec("older", "7i", 8)]);
  assert.equal(t["7i"].n, 1, "one teaching record counts; the three ignored do not");
  const rows = missSummary([...off, rec("older", "7i", 8), rec("older", "7i", 9)]);
  const r7 = rows.find((x) => x.club === "7i");
  assert.ok(r7 && r7.n === 2, `misses by club: the ignored round is out (${JSON.stringify(r7)})`);
  const g = teeShotGrade([{ ...rec("today", "Dr", 0, 0, { shotNo: 1 }), teach: false }, rec("older", "Dr", 0, 0, { shotNo: 1 })]);
  assert.equal(g.total, 1);
  // a club with no configured usual shape reads it off the log — not off an ignored round
  const w3 = (list) => list.map((r) => ({ ...r, club: "3w" }));
  assert.equal(defaultIntendedShape("3w", w3(off)), "straight", "an ignored round does not set the usual shape");
  assert.equal(defaultIntendedShape("3w", w3(today)), "fade");
});

test("C46 teach flag: survives a re-import of the same export and Shot Pattern re-seeding", () => {
  const st = makeStorage();
  [rec("today", "7i", -12), rec("today", "7i", -9)].forEach((r) => saveShot(st, r));
  const before = exportShots(st);
  setRoundTeaching(st, "today", false);
  const res = importShots(st, before);
  assert.equal(res.updated, 0, "same ts: the stored record (with the mark) stays");
  assert.equal(roundTeaches(st, "today"), false);
  const sp = { id: "sp1", roundId: "sp:2026-10-11-x", courseId: "c", club: "8i", shotType: "full", logged: "full", hole: 1, shotNo: 2, ts: "2026-10-11T12:00:00Z", source: "shotpattern" };
  saveShot(st, sp);
  setRoundTeaching(st, "sp:2026-10-11-x", false);
  const seeded = seedShotPatternRecords(st, { rounds: [{ key: "2026-10-11-x", records: [sp] }] }, []);
  assert.equal(seeded.kept, 1);
  assert.equal(roundTeaches(st, "sp:2026-10-11-x"), false);
});

test("C46 Place by hand: arms the map in a live round, names the shot, offers Cancel; Cancel puts the phase back", () => {
  let s = caddieReducer(initialCaddie(1), { type: "tee", tap: true, byHand: true });
  assert.deepEqual(s.awaitingTap, { action: "tee", trigger: "tee", byHand: true });
  let v = caddieView({ state: s, par: 4 });
  assert.equal(v.bar.primary.label, COPY.tapMap); assert.equal(v.bar.primary.disabled, true);
  assert.deepEqual(v.bar.secondary, { label: "Cancel", action: "tapCancel" });
  assert.equal(v.notice, "Shot 1 · tap where your ball is, or hold anywhere and drag the marker");
  // Cancel from the tee: back to pre-tee, nothing placed
  s = caddieReducer(s, { type: "tapCancel" });
  assert.equal(s.phase, "pretee"); assert.equal(s.awaitingTap, null); assert.equal(s.shotNo, 1);
  // at the ball after shot 2 the next fix is shot 3's start
  s = caddieReducer(s, { type: "tee" });
  s = caddieReducer(s, { type: "fix", fix: { lat: 34, lng: -84, accuracyM: 4 }, point: { x: 0, y: 0 } });
  s = caddieReducer(s, { type: "ball" });
  s = caddieReducer(s, { type: "fix", fix: { lat: 34.001, lng: -84, accuracyM: 4 }, point: { x: 0, y: 200 } });
  assert.equal(s.shotNo, 2);
  s = caddieReducer(s, { type: "ball", tap: true, byHand: true });
  v = caddieView({ state: s, par: 4 });
  assert.equal(v.notice, "Shot 3 · tap where your ball is, or hold anywhere and drag the marker");
  const back = caddieReducer(s, { type: "tapCancel" });
  assert.equal(back.phase, "ready"); assert.equal(back.shotNo, 2); assert.deepEqual(back.ballXY, { x: 0, y: 200 });
  assert.equal(caddieReducer(back, { type: "tapCancel" }), back, "nothing armed: no change");
  // test mode's arm is unchanged: no byHand key, no Cancel, the test-mode words
  const tm = caddieReducer(back, { type: "ball", tap: true });
  assert.deepEqual(tm.awaitingTap, { action: "ball", trigger: "ball" });
  assert.equal(caddieView({ state: tm, par: 4 }).bar.secondary, null);
  assert.deepEqual(serializeCaddie(s).awaitingTap, { action: "ball", trigger: "ball", byHand: true });
});

test("C46 shotDeleted: an earlier shot moves the count down one, a putt lowers the putt count, the open shot goes if it was the one", () => {
  let s = caddieReducer(initialCaddie(5), { type: "tee" });
  s = caddieReducer(s, { type: "fix", fix: { lat: 34, lng: -84, accuracyM: 4 }, point: { x: 0, y: 0 } });
  s = caddieReducer(s, { type: "ball" });
  s = caddieReducer(s, { type: "fix", fix: { lat: 34.001, lng: -84, accuracyM: 4 }, point: { x: 0, y: 200 } });
  s = caddieReducer(s, { type: "ball" });
  s = caddieReducer(s, { type: "fix", fix: { lat: 34.002, lng: -84, accuracyM: 4 }, point: { x: 0, y: 330 } });
  assert.equal(s.shotNo, 3);
  const open = { id: "o1", hole: 5, shotNo: 3, club: "PW" };
  s = caddieReducer(s, { type: "logSave", record: open });
  // shot 1 deleted from the Shots list: now playing shot 2
  let t = caddieReducer(s, { type: "shotDeleted", id: "x1", hole: 5, shotNo: 1 });
  assert.equal(t.shotNo, 2); assert.equal(t.openShot, open);
  // the shot being played (3) deleted: the count stays, the open record goes
  t = caddieReducer(s, { type: "shotDeleted", id: "o1", hole: 5, shotNo: 3 });
  assert.equal(t.shotNo, 3); assert.equal(t.openShot, null);
  // another hole's shot: nothing here moves
  assert.equal(caddieReducer(s, { type: "shotDeleted", id: "x2", hole: 4, shotNo: 1 }).shotNo, 3);
  // putts
  let p = caddieReducer(s, { type: "puttSave", record: { hole: 5, shotNo: 1, putt: { distanceFt: 20 } } });
  p = caddieReducer(p, { type: "puttSave", record: { hole: 5, shotNo: 2, putt: { distanceFt: 4 } } });
  assert.equal(p.putts[5], 2);
  p = caddieReducer(p, { type: "shotDeleted", id: "p1", hole: 5, shotNo: 2, putt: true });
  assert.equal(p.putts[5], 1); assert.equal(p.shotNo, 3);
  assert.equal(caddieReducer(p, { type: "shotDeleted", id: "p0", hole: 5, shotNo: 1, putt: true }).putts[5], 0);
  assert.equal(caddieReducer({ ...p, putts: {} }, { type: "shotDeleted", id: "p0", hole: 5, shotNo: 1, putt: true }).putts[5], 0, "never below zero");
});
