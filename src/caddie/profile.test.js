/*
 * profile.test.js — the S5 overlay hook on profile.js (spec §5.2–§5.4, T32 at the loader level).
 * Run: node --test src/caddie/profile.test.js
 *
 * loadProfile(json, config, { overlays }) keeps learning.js applyShotLog output on P.overlays;
 * resolveEntry merges it over the Shot Pattern entry BEFORE the fallback chain runs. The raw
 * profile is never written, and no overlay means today's numbers exactly (the snapshot below was
 * taken from the pre-S5 profile.js at HEAD b0957a4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, lieDistAdj } from "./config.js";
import { loadProfile, resolveEntry, mergeOverlay, candidateEntries, rollYds } from "./profile.js";
import { applyShotLog, entryWithOverlay, entryKey } from "./learning.js";
import { newShotRecord, closeOutShot } from "./shotlog.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW_TEXT = readFileSync(join(here, "../profile.json"), "utf8");
const freshJson = () => JSON.parse(RAW_TEXT);
const N = DEFAULT_CONFIG.TAKEOVER_N, K = DEFAULT_CONFIG.SHRINK_K;

/** A closed-out long shot exactly as shotlog.js writes it: aimed `intended` up the line, ended dist / lat off it. */
let seq = 0;
function loggedShot({ round = "r1", club = "7i", lie = "fairway", intended = 170, dist = 0, lat = 0, hole = 1 }) {
  seq++;
  const rec = newShotRecord({
    id: `t${seq}`, roundId: round, courseId: "c1", hole, shotNo: 2, ts: new Date(Date.UTC(2026, 8, 20, 12, 0, seq)).toISOString(),
    start: { lat: null, lng: null, accuracyM: 4, distanceToPinYds: intended, playsLikeYds: intended, frame: { x: 0, y: 0 } },
    target: { frame: { x: 0, y: intended }, label: "green, center" },
    lie: { inferred: lie, confidence: "high", confirmed: lie, quality: "standard" },
    club, linePlayed: "safe", logged: "quick",
  });
  return closeOutShot(rec, { endFrame: { x: lat, y: intended + dist }, endLie: "fairway" });
}

const pick = (e) => e && ({ carry: e.carry, total: e.total, roll: e.roll, distSd: e.distSd, lateralSd: e.lateralSd, lateralSdDeg: e.lateralSdDeg,
  biasDist: e.biasDist, biasLat: e.biasLat, sourceLie: e.sourceLie, ell80: e.ell80, provenance: e.provenance });

/* resolveEntry output of profile.js at v22.4 (per-club roll, D33) for the bundled profile, with two
   entries moved by the v22.11 caddie-brain integration (docs/CADDIE-BRAIN-INTEGRATION.md):
     7i|full|rough      item 7: rough carry for the mid family is −4% (was a flat −8%):
                        carry × 0.96; σ scale with carry.
     6i|full|rough|wet  item 6: wet no longer makes carry = total with roll 0; carry is carry
                        (194 − 9) × 0.96 = 177.6 and roll is 9 × 3 (rough, D33) × 0.5 (wet, mid) = 13.5.
   Re-pinned to the Oct 4 profile (D85; loader code unchanged): 7i 182 total → carry 174, rough
   174 × 0.96 = 167.04; PW now carries the Oct 4 fairway ellipse; Dr 288, σ from the 273–302 IQR.
   C17 (D92): ell80's w/h/tilt/dx are the good-shot ring (7i 52.6 × 24.3), the printed ring rides on all*
   with mishitRate and goodWindowYds; PW keeps one ring (4 good dots). */
const HEAD_SNAPSHOT = {"7i|full|fairway":{"carry":174,"total":182,"roll":8,"distSd":10.44,"lateralSd":14.488863906043113,"lateralSdDeg":4.76,"biasDist":0,"biasLat":0,"sourceLie":"fairway","ell80":{"wYds":52.6,"hYds":24.3,"tiltDeg":33.5,"dxYds":3.1,"allWYds":63.6,"allHYds":34.8,"allTiltDeg":34.4,"allDxYds":0.6,"mishitRate":0.1,"goodWindowYds":20,"goodDots":8,"dyYds":0,"dyMeasuredYds":1.3,"bboxWYds":56,"bboxDYds":46,"source":"shotPattern","capturedAt":"2026-10-04","lies":"Tee & Fairway","n":10,"confidence":"medium","sdMult":1},"provenance":{"n":{"club":"7i","swing":"full","lie":"fairway"},"totalMedianYds":{"club":"7i","swing":"full","lie":"fairway"},"carryMedianYds":{"club":"7i","swing":"full","lie":"fairway"},"lateralSdDeg":{"club":"7i","swing":"full","lie":"fairway"},"leftPct":{"club":"7i","swing":"full","lie":"fairway"},"rightPct":{"club":"7i","swing":"full","lie":"fairway"},"shortPct":{"club":"7i","swing":"full","lie":"fairway"},"bigMissPct":{"club":"7i","swing":"full","lie":"fairway"},"penaltyPct":{"club":"7i","swing":"full","lie":"fairway"},"recoveryPct":{"club":"7i","swing":"full","lie":"fairway"},"penaltyCount":{"club":"7i","swing":"full","lie":"fairway"},"girPct":{"club":"7i","swing":"full","lie":"fairway"},"medianProximityFt":{"club":"7i","swing":"full","lie":"fairway"},"sgPerShot":{"club":"7i","swing":"full","lie":"fairway"},"blended":{"club":"7i","swing":"full","lie":"fairway"},"distSdYds":{"config":"DIST_SD_PCT"},"ell80":{"club":"7i","swing":"full","lie":"fairway"}}},"7i|full|rough":{"carry":167.04,"total":182,"roll":24,"distSd":12.026879999999998,"lateralSd":16.691171219761664,"lateralSdDeg":4.76,"biasDist":0,"biasLat":0,"sourceLie":"fairway","ell80":{"wYds":52.6,"hYds":24.3,"tiltDeg":33.5,"dxYds":3.1,"allWYds":63.6,"allHYds":34.8,"allTiltDeg":34.4,"allDxYds":0.6,"mishitRate":0.1,"goodWindowYds":20,"goodDots":8,"dyYds":0,"dyMeasuredYds":1.3,"bboxWYds":56,"bboxDYds":46,"source":"shotPattern","capturedAt":"2026-10-04","lies":"Tee & Fairway","n":10,"confidence":"medium","sdMult":1.2},"provenance":{"n":{"club":"7i","swing":"full","lie":"rough"},"totalMedianYds":{"club":"7i","swing":"full","lie":"fairway"},"carryMedianYds":{"club":"7i","swing":"full","lie":"fairway"},"lateralSdDeg":{"club":"7i","swing":"full","lie":"fairway"},"leftPct":{"club":"7i","swing":"full","lie":"fairway"},"rightPct":{"club":"7i","swing":"full","lie":"fairway"},"shortPct":{"club":"7i","swing":"full","lie":"fairway"},"bigMissPct":{"club":"7i","swing":"full","lie":"rough"},"penaltyPct":{"club":"7i","swing":"full","lie":"rough"},"recoveryPct":{"club":"7i","swing":"full","lie":"rough"},"penaltyCount":{"club":"7i","swing":"full","lie":"rough"},"girPct":{"club":"7i","swing":"full","lie":"rough"},"medianProximityFt":{"club":"7i","swing":"full","lie":"rough"},"sgPerShot":{"club":"7i","swing":"full","lie":"rough"},"blended":{"club":"7i","swing":"full","lie":"rough"},"distSdYds":{"config":"DIST_SD_PCT"},"ell80":{"club":"7i","swing":"full","lie":"fairway"}}},"PW|full|fairway":{"carry":133,"total":134,"roll":1,"distSd":6.65,"lateralSd":9.230289390877392,"lateralSdDeg":3.97,"biasDist":0,"biasLat":0,"sourceLie":"fairway","ell80":{"wYds":58.7,"hYds":21.3,"tiltDeg":58.2,"dxYds":5.2,"allWYds":58.7,"allHYds":21.3,"allTiltDeg":58.2,"allDxYds":5.2,"mishitRate":0,"goodWindowYds":13.4,"goodDots":4,"dyYds":0,"dyMeasuredYds":8.3,"bboxWYds":36,"bboxDYds":51,"source":"shotPattern","capturedAt":"2026-10-04","lies":"Tee & Fairway","n":6,"confidence":"low","sdMult":1},"provenance":{"n":{"club":"PW","swing":"full","lie":"fairway"},"totalMedianYds":{"club":"PW","swing":"full","lie":"fairway"},"carryMedianYds":{"club":"PW","swing":"full","lie":"fairway"},"lateralSdDeg":{"club":"PW","swing":"full","lie":"fairway"},"leftPct":{"club":"PW","swing":"full","lie":"fairway"},"rightPct":{"club":"PW","swing":"full","lie":"fairway"},"shortPct":{"club":"PW","swing":"full","lie":"fairway"},"bigMissPct":{"club":"PW","swing":"full","lie":"fairway"},"penaltyPct":{"club":"PW","swing":"full","lie":"fairway"},"recoveryPct":{"club":"PW","swing":"full","lie":"fairway"},"penaltyCount":{"club":"PW","swing":"full","lie":"fairway"},"girPct":{"club":"PW","swing":"full","lie":"fairway"},"medianProximityFt":{"club":"PW","swing":"full","lie":"fairway"},"sgPerShot":{"club":"PW","swing":"full","lie":"fairway"},"blended":{"club":"PW","swing":"full","lie":"fairway"},"distSdYds":{"config":"DIST_SD_PCT"},"ell80":{"club":"PW","swing":"full","lie":"fairway"}}},"Dr|full|tee":{"carry":288,"total":288,"roll":0,"distSd":21.5,"lateralSd":31.79549601095585,"lateralSdDeg":6.3,"biasDist":0,"biasLat":0,"sourceLie":"tee","ell80":null,"provenance":{"n":{"club":"Dr","swing":"full","lie":"tee"},"totalMedianYds":{"club":"Dr","swing":"full","lie":"tee"},"carryMedianYds":{"club":"Dr","swing":"full","lie":"tee"},"distSdYds":{"club":"Dr","swing":"full","lie":"tee"},"lateralSdDeg":{"club":"Dr","swing":"full","lie":"tee"},"leftPct":{"club":"Dr","swing":"full","lie":"tee"},"rightPct":{"club":"Dr","swing":"full","lie":"tee"},"mishitPct":{"club":"Dr","swing":"full","lie":"tee"},"penaltyPct":{"club":"Dr","swing":"full","lie":"tee"},"recoveryPct":{"club":"Dr","swing":"full","lie":"tee"},"penaltyCount":{"club":"Dr","swing":"full","lie":"tee"},"sgPerShot":{"club":"Dr","swing":"full","lie":"tee"},"blended":{"club":"Dr","swing":"full","lie":"tee"}}},"GW|finesse|fairway":null,"6i|full|rough|wet":{"carry":177.6,"total":194,"roll":13.5,"distSd":12.787199999999999,"lateralSd":14.94018095670119,"lateralSdDeg":4.01,"biasDist":0,"biasLat":0,"sourceLie":"fairway","ell80":{"wYds":38.3,"hYds":17.1,"tiltDeg":6.5,"dxYds":-1.2,"allWYds":36.3,"allHYds":60.7,"allTiltDeg":131.9,"allDxYds":-4.1,"mishitRate":0,"goodWindowYds":20,"goodDots":7,"dyYds":0,"dyMeasuredYds":-3.6,"bboxWYds":51,"bboxDYds":49,"source":"shotPattern","capturedAt":"2026-10-04","lies":"Tee & Fairway","n":11,"confidence":"medium","sdMult":1.2},"provenance":{"n":{"club":"6i","swing":"full","lie":"fairway"},"totalMedianYds":{"club":"6i","swing":"full","lie":"fairway"},"carryMedianYds":{"club":"6i","swing":"full","lie":"fairway"},"lateralSdDeg":{"club":"6i","swing":"full","lie":"fairway"},"leftPct":{"club":"6i","swing":"full","lie":"fairway"},"rightPct":{"club":"6i","swing":"full","lie":"fairway"},"shortPct":{"club":"6i","swing":"full","lie":"fairway"},"bigMissPct":{"club":"6i","swing":"full","lie":"fairway"},"penaltyPct":{"club":"6i","swing":"full","lie":"fairway"},"recoveryPct":{"club":"6i","swing":"full","lie":"fairway"},"penaltyCount":{"club":"6i","swing":"full","lie":"fairway"},"girPct":{"club":"6i","swing":"full","lie":"fairway"},"medianProximityFt":{"club":"6i","swing":"full","lie":"fairway"},"sgPerShot":{"club":"6i","swing":"full","lie":"fairway"},"blended":{"club":"6i","swing":"full","lie":"fairway"},"distSdYds":{"config":"DIST_SD_PCT"},"ell80":{"club":"6i","swing":"full","lie":"fairway"}}}};

test("no overlay → resolveEntry is exactly today's (snapshot of the pre-S5 loader)", () => {
  const P = loadProfile(freshJson());
  for (const [k, want] of Object.entries(HEAD_SNAPSHOT)) {
    const [c, sw, lie, wet] = k.split("|");
    assert.deepEqual(JSON.parse(JSON.stringify(pick(resolveEntry(P, c, sw, lie, { wet: wet === "wet" })))), want, k);
  }
  assert.equal(P.overlays, null);
});

test("empty or absent overlays → every club × swing × lie resolves identically", () => {
  const a = loadProfile(freshJson());
  const b = loadProfile(freshJson(), DEFAULT_CONFIG, { overlays: {} });
  const c = loadProfile(freshJson(), DEFAULT_CONFIG, {});
  assert.equal(b.overlays, null, "{} is no overlay");
  for (const id of a.clubOrder) for (const sw of ["full", "finesse"]) for (const lie of ["tee", "fairway", "rough", "sand", "recovery"]) {
    assert.deepEqual(resolveEntry(b, id, sw, lie), resolveEntry(a, id, sw, lie), `${id} ${sw} ${lie}`);
    assert.deepEqual(resolveEntry(c, id, sw, lie), resolveEntry(a, id, sw, lie));
  }
});

test("below takeover: the shrunk numbers reach the engine, marked source loop with n", () => {
  const P0 = loadProfile(freshJson());
  const shots = [loggedShot({ intended: 180, dist: 24, lat: 6 })];   // flew 204 against a 180 prior
  const ovs = applyShotLog(P0, shots, {});
  const ov = ovs[entryKey("7i", "full", "fairway")];
  assert.equal(ov.takeover, false);
  const P = loadProfile(freshJson(), P0.config, { overlays: ovs });
  const e = resolveEntry(P, "7i", "full", "fairway");
  const prior = resolveEntry(P0, "7i", "full", "fairway").total;   // 182 (Oct 4)
  assert.equal(e.total, Math.round((1 * 204 + K * prior) / (1 + K)), "(204 + 5·prior)/6");
  assert.equal(e.carry, e.total - rollYds("7i", "full", "mid", "fairway", DEFAULT_CONFIG), "carry derived from the learned total");
  assert.ok(Math.abs(e.biasDist - 24 / (1 + K)) < 0.01);
  assert.ok(Math.abs(e.biasLat - 6 / (1 + K)) < 0.01);
  assert.deepEqual(e.provenance.totalMedianYds, { club: "7i", swing: "full", lie: "fairway", source: "loop", n: 1, takeover: false });
  assert.deepEqual(e.provenance.girPct, { club: "7i", swing: "full", lie: "fairway" }, "Shot Pattern-only fields keep plain provenance");
  assert.equal(e.fields.n, 9, "below takeover n stays Shot Pattern's");
  // the same merge learning.js describes (entryWithOverlay), to the rounding profile.js applies
  const ref = entryWithOverlay(P0, ovs, "7i", "full", "fairway");
  assert.equal(e.total, Math.round(ref.totalMedianYds));
  // other entries untouched
  assert.deepEqual(resolveEntry(P, "8i", "full", "fairway"), resolveEntry(P0, "8i", "full", "fairway"));
});

test("at takeover: Loop's numbers and Loop's ellipse replace Shot Pattern's for that entry only", () => {
  const P0 = loadProfile(freshJson());
  const shots = [];
  for (let i = 0; i < N; i++) shots.push(loggedShot({ round: `r${1 + (i % 3)}`, club: "PW", intended: 140, dist: ((i * 7) % 11) - 6, lat: ((i * 5) % 9) - 3, hole: 1 + (i % 18) }));
  const ovs = applyShotLog(P0, shots, { now: "2026-09-28T00:00:00Z" });
  const P = loadProfile(freshJson(), P0.config, { overlays: ovs });
  const before = resolveEntry(P0, "PW", "full", "fairway");
  const e = resolveEntry(P, "PW", "full", "fairway");
  assert.equal(before.ell80.source, "shotPattern");
  assert.equal(e.ell80.source, "loop");
  assert.equal(e.ell80.n, N);
  assert.equal(e.fields.n, before.fields.n, "n stays Shot Pattern's: reasons pair it with Shot Pattern's GIR / proximity");
  assert.deepEqual(e.provenance.ell80, { club: "PW", swing: "full", lie: "fairway", source: "loop", n: N, takeover: true });
  const ov = ovs[entryKey("PW", "full", "fairway")];
  assert.equal(e.total, Math.round(ov.personal.totalMedianYds), "unshrunk personal median");
  assert.ok(Math.abs(e.lateralSdDeg - ov.personal.lateralSdDeg) < 0.01);
  assert.ok(e.ell80.wYds > 0 && e.ell80.hYds > 0);
  // the engine's candidates pick the merged entry up
  const cand = candidateEntries(P, "fairway").find((x) => x.club === "PW" && x.swing === "full");
  assert.equal(cand.ell80.source, "loop");
  assert.deepEqual(resolveEntry(P, "9i", "full", "fairway"), resolveEntry(P0, "9i", "full", "fairway"));
});

test("T32 at the loader: P.raw is the Shot Pattern json, unchanged, after overlays are applied and read", () => {
  const json = freshJson();
  const P0 = loadProfile(json);
  const shots = [];
  for (let i = 0; i < N; i++) shots.push(loggedShot({ club: "7i", intended: 180, dist: -8 + (i % 5), lat: (i % 7) - 3 }));
  shots.push(loggedShot({ club: "7i", lie: "rough", intended: 160, dist: -10 }));
  shots.push(loggedShot({ club: "6i", lie: "tee", intended: 185, dist: 4 }));
  const ovs = applyShotLog(P0, shots, {});
  const P = loadProfile(json, P0.config, { overlays: ovs });
  for (const id of P.clubOrder) for (const sw of ["full", "finesse"]) for (const lie of ["tee", "fairway", "rough"]) resolveEntry(P, id, sw, lie);
  candidateEntries(P, "rough");
  assert.equal(P.raw, json);
  assert.equal(JSON.stringify(P.raw), JSON.stringify(JSON.parse(RAW_TEXT)), "raw profile unchanged");
  assert.equal(JSON.stringify(P0.raw), JSON.stringify(JSON.parse(RAW_TEXT)));
  // mergeOverlay returns a new object and leaves its base alone
  const base = json.clubs.find((c) => c.id === "7i").entries.full.fairway;
  const snap = JSON.stringify(base);
  const merged = mergeOverlay(base, ovs[entryKey("7i", "full", "fairway")]);
  assert.notEqual(merged, base);
  assert.equal(JSON.stringify(base), snap);
  assert.equal(merged.ell80.source, "loop");
});

test("an overlay on a lie Shot Pattern never measured keeps that lie's adjustment (rough ≈ fairway × 0.96 for a mid iron)", () => {
  // Rough carry is per family (caddie-brain item 7): −4% for a mid iron, and learning.js borrows
  // the adjacent-lie prior with the same per-family factor, so resolveEntry and the overlay agree.
  const adj = 1 + lieDistAdj(DEFAULT_CONFIG, "rough", "mid");
  const P0 = loadProfile(freshJson());
  const before = resolveEntry(P0, "7i", "full", "rough");           // borrowed from fairway: total, carry × 0.96
  const ovs = applyShotLog(P0, [loggedShot({ lie: "rough", intended: 160, dist: 0 })], {});
  const P = loadProfile(freshJson(), P0.config, { overlays: ovs });
  const e = resolveEntry(P, "7i", "full", "rough");
  assert.equal(e.sourceLie, "rough", "the learned total now sits on the rough entry");
  // prior = fairway total × 0.96 (182 × 0.96 = 174.7 on Oct 4); one 160-yd shot → (160 + 5·prior)/6
  const fwTotal = resolveEntry(P0, "7i", "full", "fairway").total;
  assert.equal(e.total, Math.round((160 + K * fwTotal * adj) / (1 + K)));
  assert.ok(Math.abs(e.carry - before.carry) < 6, `one rough shot moves the rough carry a little, not by the lie cut (${before.carry} → ${e.carry})`);
  assert.ok(e.lateralSd > resolveEntry(P0, "7i", "full", "fairway").lateralSd, "the rough σ widening survives");
});
