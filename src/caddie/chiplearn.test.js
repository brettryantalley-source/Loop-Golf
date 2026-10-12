/*
 * chiplearn.test.js — v22.64 (C33, D136): the short-game bands learn from Loop's own chips. Each logged chip, pitch
 * or bunker shot with its next stroke logged says whether he got up and down and how far it left him; per band the
 * two are shrunk toward Shot Pattern's with SHRINK_K, finished rounds only, recency-weighted. A chip whose putts
 * weren't logged says nothing. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadProfile, shortBandFor, B2 } from "./profile.js";
import { chipOutcome, shortGameOverlays, shrink } from "./learning.js";
import { shortGameLearning } from "./caddieState.js";
import { newShotRecord, newPuttRecord } from "./shotlog.js";
import { shortGameLine } from "./reasons.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const history = [{ id: "r1", date: "2026-10-20" }];
const NOW = Date.parse("2026-10-21T00:00:00Z");

/** A chip on `hole` from `yds` in the rough, then its putts: `putts` = [ft, made] pairs (none = not logged). */
function hole(n, { yds = 15, lie = "rough", putts = [], holed = false, roundId = "r1", teach, source } = {}) {
  const chip = newShotRecord({
    roundId, hole: n, shotNo: 3, ts: "2026-10-20T15:00:00Z", start: { distanceToPinYds: yds },
    lie: { inferred: lie, confirmed: lie }, club: "SW", shortKind: lie === "sand" ? "bunker" : "chip",
    end: holed ? { lie: "green", holed: true } : null,
  });
  // putts are numbered on their own, 1, 2 … (the putting flow and Catch up both write them so)
  const out = [chip, ...putts.map(([ft, made], i) => newPuttRecord({ roundId, hole: n, shotNo: 1 + i, distanceFt: ft, made }))];
  return out.map((r) => ({ ...r, ...(teach === false ? { teach: false } : {}), ...(source ? { source } : {}) }));
}

test("C33: what one chip says — holed, up and down, a miss, another chip, or nothing when the putts weren't logged", () => {
  const h1 = hole(1, { putts: [[4, true]] });
  assert.deepEqual(chipOutcome(h1[0], h1), { upDown: true, leaveFt: 4 });
  const h2 = hole(2, { putts: [[12, false], [2, true]] });
  assert.deepEqual(chipOutcome(h2[0], h2), { upDown: false, leaveFt: 12 });
  const h3 = hole(3, { holed: true });
  assert.deepEqual(chipOutcome(h3[0], h3), { upDown: true, leaveFt: 0 }, "a chip-in");
  const [c4] = hole(4);
  assert.equal(chipOutcome(c4, [c4]), null, "no putt logged: never an up-and-down");
  const shot = (no) => newShotRecord({ roundId: "r1", hole: 4, shotNo: no, start: { distanceToPinYds: 8 }, lie: { confirmed: "rough" }, club: "SW", shortKind: "chip" });
  assert.deepEqual(chipOutcome(c4, [c4, shot(4), newPuttRecord({ roundId: "r1", hole: 4, shotNo: 1, distanceFt: 3, made: true })]), { upDown: false, leaveFt: null }, "chipped again: not up and down");
  assert.equal(chipOutcome(c4, [c4, shot(5)]), null, "a shot missing in between: says nothing");
  assert.equal(chipOutcome(c4, [c4, newPuttRecord({ roundId: "r1", hole: 4, shotNo: 2, distanceFt: 3, made: true })]), null, "putt 1 missing: says nothing");
  // the card's score for the hole has to be the strokes logged: tee, approach, chip, putt = 4
  const full = [shot(1), shot(2), ...hole(5, { putts: [[5, true]] })].map((r) => ({ ...r, hole: 5 }));
  const chip = full.find((r) => r.shotNo === 3 && r.shotType !== "putt");
  assert.deepEqual(chipOutcome(chip, full, 4), { upDown: true, leaveFt: 5 });
  assert.equal(chipOutcome(chip, full, 5), null, "he wrote a 5: a stroke wasn't logged, so the chip says nothing");
});

test("C33: a band's up-and-down and leave are his chips shrunk toward Shot Pattern's (SHRINK_K), finished rounds only", () => {
  const shots = [
    ...hole(1, { putts: [[3, true]] }), ...hole(2, { putts: [[4, true]] }), ...hole(3, { putts: [[5, true]] }),
    ...hole(5, { putts: [[6, true]] }), ...hole(6, { putts: [[10, false], [1, true]] }), ...hole(7, { putts: [[8, false], [2, true]] }),
    ...hole(8), ...hole(9),                                          // putts never logged: left out
  ];
  const ov = shortGameOverlays(P, shots, { now: NOW, roundIndexById: { r1: 1 } });
  const band = P.shortGame.rough.find((b) => b.fromYds === 0);
  const o = ov["rough|0"];
  assert.equal(o.n, 6);
  assert.ok(Math.abs(o.personal.upDownPct - 4 / 6) < 1e-9);
  assert.equal(o.personal.leaveFt, 5.5);
  assert.ok(Math.abs(o.upDownPct - shrink(4 / 6, band.upDownPct, 6, P.config.SHRINK_K)) < 1e-3, `${o.upDownPct}`);
  assert.equal(o.medianProximityFt, Math.round(shrink(5.5, band.medianProximityFt, 6, P.config.SHRINK_K) * 10) / 10);
  assert.equal(Object.keys(ov).length, 1, "only the band he chipped in");
  // the round in progress (not in History), a round switched to Ignored (D128) and Shot Pattern's own records teach nothing
  assert.deepEqual(shortGameOverlays(P, shots, { now: NOW, roundIndexById: {} }), {});
  assert.deepEqual(shortGameOverlays(P, shots.map((s) => ({ ...s, teach: false })), { now: NOW, roundIndexById: { r1: 1 } }), {});
  assert.deepEqual(shortGameOverlays(P, shots.map((s) => ({ ...s, source: "shotpattern" })), { now: NOW, roundIndexById: { r1: 1 } }), {});
  assert.equal(shortGameLearning(P, [], history, NOW), null, "nothing logged → no overlay, the profile as it was");
  // History's card says hole 1 took more strokes than logged (shots 1–2 aren't): that hole drops out
  const scored = [{ id: "r1", date: "2026-10-20", holeScores: [9, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null] }];
  assert.equal(shortGameLearning(P, shots, scored, NOW)["rough|0"].n, 5);
});

test("C33: the caddie reads the learned band — the short-game line, the count and the up-and-down it prices with", () => {
  const shots = [1, 2, 3, 5, 6, 7].flatMap((n, i) => hole(n, { putts: i < 5 ? [[3, true]] : [[9, false], [1, true]] }));
  const ov = shortGameLearning(P, shots, history, NOW);
  const Pl = loadProfile(RAW, P.config, { shortGame: ov });
  const before = shortBandFor(P, 15, "rough"), after = shortBandFor(Pl, 15, "rough");
  assert.ok(after.upDownPct > before.upDownPct, `${before.upDownPct} → ${after.upDownPct}`);
  assert.equal(after.n, before.n + 6);
  assert.equal(after.learned.n, 6);
  assert.equal(B2(Pl, 15, "rough"), after.upDownPct, "the engine's up-and-down from inside 50");
  assert.equal(shortBandFor(Pl, 15, "sand"), shortBandFor(P, 15, "sand"), "a band he hasn't chipped in is Shot Pattern's");
  assert.match(shortGameLine(after, 15), new RegExp(`up and down ${Math.round(after.upDownPct * 100)}%`));
  assert.deepEqual(RAW.shortGame.bands.find((b) => b.lie === "rough" && b.fromYds === 0).upDownPct, before.upDownPct, "the bundled profile is untouched");
});
