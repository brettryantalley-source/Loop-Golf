/*
 * shotlog.test.js — spec §10 acceptance tests T16–T20, plus unit tests for routeShot boundaries,
 * migrateShot, importShots merge-by-id, and the lie-override store.
 * Run: node --test src/caddie/shotlog.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SHOT_SCHEMA, SHOTS_KEY, LIE_OVERRIDES_KEY,
  routeShot, newShotRecord, quickLog, detailLog, skipShot, closeOutShot,
  migrateShot, loadShots, saveShot, allShots, exportShots, importShots,
  missCauseSample, recordLieOverride, loadLieOverrides,
  PUTT_AXES, newPuttRecord, quickMade, bareShotRecord,
} from "./shotlog.js";

/** In-memory localStorage-shaped stub. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _dump: () => Object.fromEntries(map),
  };
}

/** A recommend()-shaped output (src/caddie/engine.js §3.9), enough to exercise the snapshot. */
function fakeRecommendation({ safeClub = "5i", aggClub = "2Hy", sameShot = false } = {}) {
  return {
    context: {
      hole: 7, par: 5, shotNo: 2, distances: { front: 226, center: 238, back: 251, pin: 238 },
      playsLike: 245, lieType: "fairway", lieQuality: "standard", lieConfidence: "high",
      conditions: "normal", pinPos: "middle", wind: { speedMph: 8, relative: "into-left" },
      elevationDeltaYds: 0,
    },
    sameShot,
    safe: { club: safeClub, swingType: "full", target: { x: 0, y: 238, label: "leave 100, fairway center" }, expScore: 4.84, birdieProb: 0.06, troubleRate: 0.04 },
    aggressive: sameShot ? null : { club: aggClub, swingType: "full", target: { x: 8, y: 250, label: "green, front-left" }, expScore: 5.02, birdieProb: 0.13, troubleRate: 0.19, deltaExp: 0.18 },
    message: sameShot ? "Same shot both ways." : null,
    nudges: [],
    flags: [],
    candidates: 4,
  };
}

/* ---------- T16 routing + boundaries ---------- */

test("T16 routing: >=75 long, <75 off-green shortGame, on-green putt", () => {
  assert.equal(routeShot({ distanceToPinYds: 238, lieType: "fairway" }), "long");
  assert.equal(routeShot({ distanceToPinYds: 74, lieType: "rough" }), "shortGame");
  assert.equal(routeShot({ distanceToPinYds: 12, lieType: "green" }), "putt");
});

test("routeShot boundary: 75 is long, 74.9 is shortGame", () => {
  assert.equal(routeShot({ distanceToPinYds: 75, lieType: "fairway" }), "long");
  assert.equal(routeShot({ distanceToPinYds: 74.9, lieType: "fairway" }), "shortGame");
});

test("routeShot: on the green routes to putt regardless of distance", () => {
  assert.equal(routeShot({ distanceToPinYds: 300, lieType: "green" }), "putt");
});

/* ---------- T17 quick path ---------- */

test("T17 quick path: Good shot writes all defaults", () => {
  const rec = quickLog({
    roundId: "r1", courseId: "c1", hole: 7, shotNo: 2,
    start: { lat: 1, lng: 2, accuracyM: 4, distanceToPinYds: 238, playsLikeYds: 245, frame: { x: 0, y: 0 } },
    recommendation: fakeRecommendation(),
  });
  assert.equal(rec.logged, "quick");
  assert.equal(rec.club, "5i");                // SAFE's club, the default
  assert.equal(rec.linePlayed, "safe");         // club matches SAFE
  assert.equal(rec.contact, 0);
  assert.equal(rec.strike, "center");
  assert.equal(rec.startLine, "on");
  assert.equal(rec.intendedShape, "straight");  // no history supplied
  assert.equal(rec.curve, 0);                   // matches intended shape
  assert.equal(rec.shotType, "full");           // 5i is not a wedge
  assert.ok(rec.id);
  assert.equal(rec.schema, SHOT_SCHEMA);
});

test("quick path defaults finesse for a wedge inside 120", () => {
  const rec = quickLog({
    start: { distanceToPinYds: 95, frame: { x: 0, y: 0 } },
    recommendation: fakeRecommendation({ safeClub: "SW" }),
  });
  assert.equal(rec.shotType, "finesse");
});

test("quick path prefers a club match from the aggressive option", () => {
  const rec = quickLog({
    club: "2Hy",
    start: { distanceToPinYds: 238, frame: { x: 0, y: 0 } },
    recommendation: fakeRecommendation(),
  });
  assert.equal(rec.linePlayed, "aggressive");
  assert.deepEqual(rec.target, { frame: { x: 8, y: 250 }, label: "green, front-left" });
});

test("sameShot: default club and line come from the single (safe) option", () => {
  const rec = quickLog({
    start: { distanceToPinYds: 150, frame: { x: 0, y: 0 } },
    recommendation: fakeRecommendation({ sameShot: true }),
  });
  assert.equal(rec.club, "5i");
  assert.equal(rec.linePlayed, "safe");
});

test("intendedShape defaults to the most common prior shape for that club", () => {
  const history = [
    { club: "5i", intendedShape: "fade" },
    { club: "5i", intendedShape: "fade" },
    { club: "5i", intendedShape: "draw" },
    { club: "7i", intendedShape: "draw" },
  ];
  const rec = newShotRecord({ club: "5i", start: { frame: { x: 0, y: 0 } }, history });
  assert.equal(rec.intendedShape, "fade");
  assert.equal(rec.curve, 1);
});

/* ---------- T18 auto-derive ---------- */

test("T18 auto-derive: closeOutShot fills end + derived (matches the §4.6 worked example)", () => {
  const prev = quickLog({
    roundId: "r1", hole: 7, shotNo: 2,
    start: { lat: 1, lng: 2, accuracyM: 4, distanceToPinYds: 238, playsLikeYds: 245, frame: { x: 0, y: 0 } },
    recommendation: fakeRecommendation({ safeClub: "5i" }),
  });
  // safe.target is {x:0,y:238} → intended distance 238 straight up the hole frame.
  const closed = closeOutShot(prev, {
    endGps: { lat: 1.001, lng: 2.001 },
    endLie: "fairway",
    endAccuracyM: 5,
    endFrame: { x: 3, y: 232 }, // 6 short, 3 right — the spec's own illustrative numbers
  });
  assert.equal(closed.end.lie, "fairway");
  assert.equal(closed.end.accuracyM, 5);
  assert.equal(closed.derived.distanceMissYds, -6);
  assert.equal(closed.derived.lateralMissYds, 3);
  assert.equal(closed.derived.onTarget, true);
  assert.equal(closed.derived.intendedYds, 238);   // start -> target
  assert.equal(closed.derived.actualYds, 232);     // intendedYds + distanceMissYds
  // closeOutShot must not mutate its input
  assert.equal(prev.end, null);
});

test("closeOutShot: a miss outside the tolerance ellipse is not onTarget", () => {
  const prev = quickLog({
    start: { frame: { x: 0, y: 0 }, distanceToPinYds: 150 },
    recommendation: fakeRecommendation({ safeClub: "5i" }),
  });
  const closed = closeOutShot(prev, { endGps: {}, endLie: "rough", endFrame: { x: 40, y: 238 } });
  assert.equal(closed.derived.onTarget, false);
});

test("closeOutShot: missing target frame (an own-call shot) leaves derived misses null", () => {
  const prev = quickLog({ club: "PW", start: { frame: { x: 0, y: 0 }, distanceToPinYds: 100 }, recommendation: null });
  assert.equal(prev.linePlayed, "own");
  const closed = closeOutShot(prev, { endGps: {}, endLie: "green", endFrame: { x: 2, y: 98 } });
  assert.equal(closed.derived.distanceMissYds, null);
  assert.equal(closed.derived.onTarget, null);
  assert.equal(closed.end.lie, "green");
});

/* ---------- T19 skip ---------- */

test("T19 skip: skipped shot keeps its GPS result and is excluded from miss-cause analysis", () => {
  const skipped = skipShot({
    roundId: "r1", hole: 9,
    start: { frame: { x: 0, y: 0 }, distanceToPinYds: 200 },
    recommendation: fakeRecommendation(),
  });
  assert.equal(skipped.logged, "skipped");
  const closed = closeOutShot(skipped, { endGps: { lat: 9, lng: 9 }, endLie: "rough", endFrame: { x: 5, y: 190 } });
  assert.equal(closed.end.lat, 9); // GPS result retained even though skipped

  const quick = quickLog({ start: { frame: { x: 0, y: 0 } } });
  const sample = missCauseSample([closed, quick]);
  assert.equal(sample.length, 1);
  assert.equal(sample[0].id, quick.id);
});

/* ---------- T20 export/import round trip ---------- */

test("T20 export/import round trip: export, clear storage, import restores identical records", () => {
  const storage = makeStorage();
  const a = saveShot(storage, quickLog({ roundId: "r1", hole: 1, start: { frame: { x: 0, y: 0 } } }));
  const b = saveShot(storage, quickLog({ roundId: "r1", hole: 2, start: { frame: { x: 0, y: 0 } } }));
  const c = saveShot(storage, quickLog({ roundId: "r2", hole: 1, start: { frame: { x: 0, y: 0 } } }));

  const json = exportShots(storage);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema, SHOT_SCHEMA);
  assert.ok(parsed.exportedAt);
  assert.equal(parsed.shots.length, 3);

  const fresh = makeStorage(); // simulates "clear storage"
  const result = importShots(fresh, json);
  assert.equal(result.added, 3);
  assert.equal(result.updated, 0);

  const restored = allShots(fresh).sort((x, y) => x.id.localeCompare(y.id));
  const original = [a, b, c].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(restored, original);
});

test("export filters to given roundIds", () => {
  const storage = makeStorage();
  saveShot(storage, quickLog({ roundId: "r1", start: { frame: { x: 0, y: 0 } } }));
  saveShot(storage, quickLog({ roundId: "r2", start: { frame: { x: 0, y: 0 } } }));
  const parsed = JSON.parse(exportShots(storage, ["r1"]));
  assert.equal(parsed.shots.length, 1);
  assert.equal(parsed.shots[0].roundId, "r1");
});

/* ---------- importShots merge-by-id ---------- */

test("importShots merges by id: never deletes, newer ts wins", () => {
  const storage = makeStorage();
  const original = saveShot(storage, quickLog({ roundId: "r1", ts: "2026-09-01T00:00:00.000Z", club: "5i", start: { frame: { x: 0, y: 0 } } }));

  // An older copy of the same shot must NOT overwrite the newer one already in storage.
  const staleCopy = { ...original, club: "PW", ts: "2026-08-01T00:00:00.000Z" };
  let result = importShots(storage, { schema: SHOT_SCHEMA, shots: [staleCopy] });
  assert.equal(result.unchanged, 1);
  assert.equal(loadShots(storage, "r1")[0].club, "5i");

  // A newer copy of the same shot DOES win.
  const newerCopy = { ...original, club: "6i", ts: "2026-09-15T00:00:00.000Z" };
  result = importShots(storage, { schema: SHOT_SCHEMA, shots: [newerCopy] });
  assert.equal(result.updated, 1);
  assert.equal(loadShots(storage, "r1")[0].club, "6i");

  // A record for a round not currently in storage is added, not lost.
  const other = quickLog({ roundId: "r9", start: { frame: { x: 0, y: 0 } } });
  result = importShots(storage, { schema: SHOT_SCHEMA, shots: [other] });
  assert.equal(result.added, 1);
  assert.equal(loadShots(storage, "r9").length, 1);

  // Nothing already in storage was deleted by any of the above (original r1 shot + the new r9 one).
  assert.equal(allShots(storage).length, 2);
});

/* ---------- migrateShot ---------- */

test("migrateShot: identity for schema 1", () => {
  const rec = { schema: 1, id: "x" };
  assert.equal(migrateShot(rec), rec);
});

test("migrateShot: missing schema is treated as 1 and stamped", () => {
  const rec = { id: "x" };
  const migrated = migrateShot(rec);
  assert.equal(migrated.schema, 1);
  assert.notEqual(migrated, rec); // stamped onto a copy, not mutated in place
  assert.equal(rec.schema, undefined);
});

test("migrateShot: throws on an unknown schema", () => {
  assert.throws(() => migrateShot({ schema: 2, id: "x" }));
});

/* ---------- lie-override store (§5.6) ---------- */

test("lie-override store: records and reloads corrections in order", () => {
  const storage = makeStorage();
  recordLieOverride(storage, { courseId: "c1", hole: 4, gps: { lat: 1, lng: 2 }, inferred: "rough", corrected: "fairway" });
  recordLieOverride(storage, { courseId: "c1", hole: 4, gps: { lat: 1.0001, lng: 2.0001 }, inferred: "rough", corrected: "fairway" });
  const overrides = loadLieOverrides(storage);
  assert.equal(overrides.length, 2);
  assert.equal(overrides[0].corrected, "fairway");
  assert.ok(overrides[0].ts);
  // Stored under its own key, independent of the shots map.
  assert.equal(storage.getItem(SHOTS_KEY), null);
  assert.ok(storage.getItem(LIE_OVERRIDES_KEY));
});

test("lie-override store: getItem/setItem failures degrade to empty rather than throwing", () => {
  const brokenStorage = { getItem: () => { throw new Error("boom"); }, setItem: () => {} };
  assert.deepEqual(loadLieOverrides(brokenStorage), []);
});

/* ---------- putt capture (Sep 28 spec) ---------- */

test("PUTT_AXES: three axes in order, five-cell copy exactly as Brett wrote it", () => {
  assert.deepEqual(PUTT_AXES.map((a) => a.key), ["speed", "breakRead", "line"]);
  assert.deepEqual(PUTT_AXES.find((a) => a.key === "speed").options, ["Very short", "Short", "Good", "Long", "Very long"]);
  assert.deepEqual(PUTT_AXES.find((a) => a.key === "breakRead").options, ["Big under-read", "Under-read", "Good", "Over-read", "Way over-read"]);
  assert.deepEqual(PUTT_AXES.find((a) => a.key === "line").options, ["Big pull", "Pull", "Good", "Push", "Big push"]);
});

test("newPuttRecord: shape — schema 1, shotType putt, the three axes on a graded miss", () => {
  const rec = newPuttRecord({ roundId: "r1", courseId: "c1", hole: 7, shotNo: 3, distanceFt: 12.4, made: false, speed: 1, breakRead: -1, line: 0 });
  assert.equal(rec.schema, SHOT_SCHEMA);
  assert.equal(rec.shotType, "putt");
  assert.equal(rec.logged, "full");
  assert.equal(rec.hole, 7);
  assert.equal(rec.shotNo, 3);
  assert.deepEqual(rec.putt, { distanceFt: 12, made: false, speed: 1, breakRead: -1, line: 0 });
  assert.ok(rec.id);
  assert.ok(rec.ts);
});

test("newPuttRecord: made forces all three axes to null regardless of input, and defaults logged to quick", () => {
  const rec = newPuttRecord({ hole: 1, shotNo: 1, distanceFt: 2, made: true, speed: 2, breakRead: -1, line: 1 });
  assert.deepEqual([rec.putt.speed, rec.putt.breakRead, rec.putt.line], [null, null, null]);
  assert.equal(rec.putt.made, true);
  assert.equal(rec.logged, "quick");
});

test("newPuttRecord: a missing axis defaults to 0 (Good), matching the card's pre-selected cell", () => {
  const rec = newPuttRecord({ hole: 1, shotNo: 1, distanceFt: 10, made: false });
  assert.deepEqual([rec.putt.speed, rec.putt.breakRead, rec.putt.line], [0, 0, 0]);
});

test("newPuttRecord: axis values are CLAMPED to -2..2, not thrown on (interpretation: clamp)", () => {
  const rec = newPuttRecord({ hole: 1, shotNo: 1, distanceFt: 10, made: false, speed: 9, breakRead: -9, line: 2.6 });
  assert.deepEqual([rec.putt.speed, rec.putt.breakRead, rec.putt.line], [2, -2, 2]);
  assert.doesNotThrow(() => newPuttRecord({ hole: 1, shotNo: 1, made: false, speed: NaN }));
});

test("quickMade: the Made ✓ path — made true, axes null, logged quick, distance kept", () => {
  const rec = quickMade({ roundId: "r1", hole: 4, shotNo: 2, distanceFt: 3 });
  assert.equal(rec.putt.made, true);
  assert.equal(rec.putt.distanceFt, 3);
  assert.deepEqual([rec.putt.speed, rec.putt.breakRead, rec.putt.line], [null, null, null]);
  assert.equal(rec.logged, "quick");
});

test("missCauseSample includes putt records — they are never logged as skipped (Skip writes nothing)", () => {
  const made = quickMade({ hole: 1, shotNo: 1, distanceFt: 3 });
  const missed = newPuttRecord({ hole: 1, shotNo: 2, distanceFt: 22, made: false, speed: 1, breakRead: 0, line: -1 });
  assert.deepEqual(missCauseSample([made, missed]).map((r) => r.id), [made.id, missed.id]);
});

test("putt records round-trip through saveShot / loadShots / export-import like any other shot", () => {
  const storage = makeStorage();
  const rec = saveShot(storage, newPuttRecord({ roundId: "r1", hole: 6, shotNo: 1, distanceFt: 18, made: false, speed: -1, breakRead: 1, line: 0 }));
  assert.deepEqual(loadShots(storage, "r1"), [rec]);
  const json = exportShots(storage);
  const fresh = makeStorage();
  importShots(fresh, json);
  assert.deepEqual(allShots(fresh), [rec]);
});

/* ---------- detailLog ---------- */

test("detailLog: only the given fields override the defaults; logged is full", () => {
  const rec = detailLog(
    { start: { frame: { x: 0, y: 0 }, distanceToPinYds: 150 }, recommendation: fakeRecommendation() },
    { contact: -1, strike: "toe" }
  );
  assert.equal(rec.logged, "full");
  assert.equal(rec.contact, -1);
  assert.equal(rec.strike, "toe");
  assert.equal(rec.startLine, "on"); // untouched field keeps its default
});

/* ---------- v22.12: a shot logged with no recommendation ---------- */

test("bareShotRecord: no recommendation, no target, nulls where nothing is known; saves and closes out cleanly", () => {
  const r = bareShotRecord({ roundId: "r9", courseId: "123", nine: "front", hole: 3, shotNo: 2, gps: { lat: 39.99, lng: -85.98, accuracyM: 4 }, club: "7i" });
  assert.equal(r.recommendation, null);
  assert.equal(r.target, null);
  assert.equal(r.club, "7i");
  assert.equal(r.linePlayed, "own", "nothing to match against");
  assert.deepEqual(r.start, { lat: 39.99, lng: -85.98, accuracyM: 4, distanceToPinYds: null, playsLikeYds: null, frame: null });
  assert.deepEqual(r.lie, { inferred: null, confidence: null, confirmed: null, quality: "standard" });
  assert.equal(r.shotType, "full"); assert.equal(r.conditions, "normal"); assert.equal(r.logged, "quick");
  // no fix, entered yards, a wedge inside 120 → finesse as §4.2 says
  const y = bareShotRecord({ hole: 5, shotNo: 3, gps: null, distanceToPinYds: 96.4, club: "SW", lie: "rough" });
  assert.deepEqual([y.start.lat, y.start.lng, y.start.distanceToPinYds], [null, null, 96]);
  assert.equal(y.shotType, "finesse"); assert.equal(y.lie.confirmed, "rough");
  // no club yet (the card has not been touched) is still a valid record
  const empty = bareShotRecord({ hole: 1, shotNo: 1, distanceToPinYds: NaN });
  assert.equal(empty.club, null); assert.equal(empty.start.distanceToPinYds, null);
  // quick / detail / skip keep it recommendation-less
  const q = quickLog(r), d = detailLog(r, { contact: -1, club: "6i" }), k = skipShot(r);
  assert.equal(q.recommendation, null); assert.equal(d.club, "6i"); assert.equal(d.logged, "full"); assert.equal(k.logged, "skipped");
  // closeout: with or without an end frame the miss math is null, never NaN
  for (const end of [{ endGps: { lat: 39.991, lng: -85.98 }, endLie: null, endAccuracyM: 5, endFrame: { x: 3, y: 140 } }, { endGps: { lat: 39.991, lng: -85.98 } }, {}]) {
    const c = closeOutShot(q, end);
    assert.deepEqual(c.derived, { distanceMissYds: null, lateralMissYds: null, onTarget: null, intendedYds: null, actualYds: null });
    assert.ok(!JSON.stringify(c).includes("NaN"));
  }
  assert.equal(closeOutShot(q, { endGps: { lat: 1, lng: 2 }, endAccuracyM: 5 }).end.lat, 1);
  // round-trips storage
  const st = makeStorage();
  saveShot(st, closeOutShot(q, {}));
  const back = loadShots(st, "r9");
  assert.equal(back.length, 1); assert.equal(back[0].id, r.id); assert.equal(back[0].recommendation, null); assert.equal(back[0].derived.intendedYds, null);
  assert.equal(JSON.parse(exportShots(st)).shots.length, 1);
});
