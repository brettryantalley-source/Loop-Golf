/*
 * carry.test.js — the Carry chip (v22.73, D148): a round-level percentage off every club for a day the body is
 * not right. The engine's term, the context's plumbing, the chip, its picker and the round state's save/restore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formEffect, playsLike, recommend } from "./engine.js";
import { DEFAULT_CONFIG } from "./config.js";
import { assembleShotContext } from "./context.js";
import { initialCaddie, caddieReducer, serializeCaddie, restoreCaddie, chipList, pickerModel, carryText, CARRY_STEPS, clubBrainContext, syntheticHole } from "./caddieState.js";
import { loadProfile } from "./profile.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "..", "profile.json"), "utf8")), DEFAULT_CONFIG);

test("formEffect: 5% short needs a club 5.3% longer; 0, positive and absurd values are no term; nothing inside 100 yds (D149)", () => {
  assert.ok(Math.abs(formEffect(150, -5) - 150 * (100 / 95 - 1)) < 1e-9);
  assert.equal(formEffect(100, -10), 0, "100 yds is a full-carry shot");
  assert.equal(formEffect(60, -15), 0);
  assert.ok(formEffect(101, -10) > 11, "just over 100 plays the full term");
  assert.equal(DEFAULT_CONFIG.CARRY_CHIP_MIN_YDS, 100);
  assert.ok(formEffect(80, -10, 0) > 8, "the threshold is the config's");
  assert.ok(Math.abs(formEffect(200, -10) - 200 / 9) < 1e-9);
  assert.equal(formEffect(150, 0), 0);
  assert.equal(formEffect(150, 5), 0);
  assert.equal(formEffect(150, -100), 0);
  assert.equal(formEffect(150, null), 0);
});

test("playsLike carries the term and reports it; the headline context shows carryPct and formYds", () => {
  const ctx = { ball: { x: 0, y: 0 }, wind: null, tempF: null, elevFt: null, elevationDeltaYds: 0, carryPct: -10 };
  const pl = playsLike(150, 0, ctx, DEFAULT_CONFIG);
  assert.ok(Math.abs(pl.formYds - 150 / 9) < 1e-9);
  assert.ok(Math.abs(pl.yds - (150 + 150 / 9)) < 1e-9);
  const h = syntheticHole(380, 4);
  const full = recommend({ shotNo: 2, ball: { x: 0, y: 230 }, lieType: "fairway", par: 4, pinPos: "middle" }, h, P);
  const short = recommend({ shotNo: 2, ball: { x: 0, y: 230 }, lieType: "fairway", par: 4, pinPos: "middle", carryPct: -10 }, h, P);
  assert.equal(full.context.carryPct, 0);
  assert.equal(full.context.formYds, 0);
  assert.equal(short.context.carryPct, -10);
  assert.ok(short.context.formYds > 15 && short.context.formYds < 18, `${short.context.formYds} yds longer at 150`);
  assert.equal(short.context.playsLike - full.context.playsLike, Math.round(short.context.formYds));
});

test("context.js: the round's carryOverride is the ctx's carryPct; absent or positive → 0", () => {
  const h = syntheticHole(400, 4);
  const base = { hole: h, round: { shotNo: 1, trigger: "tee", ball: { x: 0, y: 0 }, par: 4, hole: 1 } };
  assert.equal(assembleShotContext(base).carryPct, 0);
  assert.equal(assembleShotContext({ ...base, round: { ...base.round, carryOverride: -5 } }).carryPct, -5);
  assert.equal(assembleShotContext({ ...base, round: { ...base.round, carryOverride: 5 } }).carryPct, 0);
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 1, carryOverride: -15 }).carryPct, -15);
  assert.equal(clubBrainContext({ holeNo: 1, par: 4, shotNo: 1 }).carryPct, 0);
});

test("the chip: Full by default, written when set, a 4-way picker, round-level and saved with the round", () => {
  let s = initialCaddie(1);
  assert.equal(s.carryOverride, null);
  const chips0 = chipList({ carryOverride: null });
  assert.equal(chips0.length, 7);
  const c0 = chips0.find((c) => c.key === "carry");
  assert.deepEqual({ label: c0.label, edited: c0.edited, value: c0.value }, { label: "Carry", edited: false, value: "Full" });
  s = caddieReducer(s, { type: "chip", key: "carry", value: -5 });
  assert.equal(s.carryOverride, -5);
  assert.equal(chipList({ carryOverride: s.carryOverride }).find((c) => c.key === "carry").value, "−5%");
  const pm = pickerModel("carry", { chip: c0, current: -5 });
  assert.deepEqual(pm.options.map((o) => o.label), ["Full", "−5%", "−10%", "−15%"]);
  assert.deepEqual(pm.options.map((o) => o.current), [false, true, false, false]);
  assert.match(pm.note, /longer than 100 yds/);
  assert.match(pm.note, /Ignored on History/);
  assert.deepEqual(CARRY_STEPS, [-5, -10, -15]);
  assert.equal(carryText(null), "Full");
  // a new ball keeps it (round-level, like Wind); the next hole keeps it
  s = caddieReducer(s, { type: "hole", hole: 2 });
  assert.equal(s.carryOverride, -5);
  const back = restoreCaddie(JSON.parse(JSON.stringify(serializeCaddie(s))));
  assert.equal(back.carryOverride, -5);
  assert.equal(restoreCaddie({ ...serializeCaddie(s), carryOverride: -7 }).carryOverride, null, "only the steps survive a restore");
  s = caddieReducer(s, { type: "chip", key: "carry", value: null });
  assert.equal(s.carryOverride, null);
  s = caddieReducer(s, { type: "chip", key: "carry", value: 5 });
  assert.equal(s.carryOverride, null, "a positive value is Full");
});
