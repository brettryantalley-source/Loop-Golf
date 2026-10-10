/*
 * tail.test.js — v22.36 (C8, D107): the short tail. Shot Pattern's shortPct (finishing more than 10%
 * short of where Brett meant to finish) is higher than the ellipse gives for most clubs; the gap,
 * shrunk by n, is drawn as extra shots 10–20% short. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { generateCandidates, simulateCandidate, normalizeContext, shortTailPct } from "./engine.js";
import { makeSamples } from "./random.js";
import { noWaterPar4, openPar5 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const Poff = loadProfile(RAW, mergeConfig({ SHORT_TAIL: { ...DEFAULT_CONFIG.SHORT_TAIL, on: false } }));
const S = makeSamples(4000, 11);

/** Finishes of one candidate: the share more than 10% short of the club's total. */
function shortShare(Pp, ctxRaw, hole, club, kind = "approach") {
  const ctx = normalizeContext(ctxRaw, hole);
  const c = generateCandidates(ctx, hole, Pp).find((x) => x.club === club && x.kind === kind);
  assert.ok(c, `${club} ${kind} candidate`);
  const trace = [];
  simulateCandidate(c, ctx, hole, Pp, S, trace);
  const total = c.entry.carry + c.entry.roll;
  const d = (p) => Math.hypot(p.x - ctx.ball.x, p.y - ctx.ball.y);
  return { share: trace.filter((p) => d(p) < 0.9 * total).length / trace.length, trace };
}

test("C8: the tail is the shrunk observed short rate less the model's; none where he never comes up short", () => {
  const tail = (c, sw = "full") => shortTailPct(resolveEntry(P, c, sw, "fairway"), P.config);
  for (const c of ["7i", "8i", "9i"]) assert.equal(tail(c), 0, `${c}: shortPct 0`);
  for (const [c, lo, hi] of [["GW", 0.08, 0.12], ["PW", 0.06, 0.10], ["5i", 0.03, 0.07]]) assert.ok(tail(c) > lo && tail(c) < hi, `${c} ${tail(c)}`);
  assert.ok(tail("SW", "finesse") > 0.1, "SW finesse: 2 of 9 short");
  // n shrinks it: the 2-hybrid's 2 of 4 is not taken at face value
  const e2 = resolveEntry(P, "2Hy", "full", "fairway");
  assert.equal(e2.shortN, 4);
  assert.ok(tail("2Hy") < 0.5 * e2.fields.shortPct);
  assert.equal(shortTailPct(resolveEntry(Poff, "GW", "full", "fairway"), Poff.config), 0, "off");
});

test("C8: with the tail, the GW's simulated finishes come up 10%+ short about as often as the shrunk observation", () => {
  const ctx = { shotNo: 2, ball: { x: 0, y: 410 - 119 }, lieType: "fairway", par: 4 };
  const on = shortShare(P, ctx, noWaterPar4, "GW").share, off = shortShare(Poff, ctx, noWaterPar4, "GW").share;
  const e = resolveEntry(P, "GW", "full", "fairway"), n = e.shortN, K = DEFAULT_CONFIG.SHRINK_K;
  const want = (n * e.fields.shortPct + K * off) / (n + K);
  assert.ok(on > off + 0.05, `on ${on} off ${off}`);
  assert.ok(Math.abs(on - want) < 0.03, `on ${on.toFixed(3)} want ${want.toFixed(3)}`);
});

test("C8: not on a par-4/5 tee shot (shortPct is an approach measure); a par-3 tee shot is an approach", () => {
  const tee4 = { shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 4 };
  const a = shortShare(P, tee4, openPar5, "2Hy", "corridor").trace, b = shortShare(Poff, tee4, openPar5, "2Hy", "corridor").trace;
  assert.deepEqual(a, b, "a par-4 tee shot is unchanged");
  const tee3 = { shotNo: 1, ball: { x: 0, y: 410 - 120 }, lieType: "tee", par: 3 };
  assert.ok(shortShare(P, tee3, noWaterPar4, "GW").share > shortShare(Poff, tee3, noWaterPar4, "GW").share + 0.05);
});
