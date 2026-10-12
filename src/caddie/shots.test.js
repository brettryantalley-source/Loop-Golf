/*
 * shots.test.js — v22.59 (R11, D130): the caddie prices from Brett's Oct 11 club sheets — his real shots,
 * resampled (engine.js shotsSampler), the worst 20% still dropped (D117); a Rough sheet read alone; the
 * Driver's big misses already in his drives; the map's ring where his shots land from the caddie's aim.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadProfile, resolveEntry } from "./profile.js";
import { shotsSampler, keptDraws, simulateCandidate, normalizeContext } from "./engine.js";
import { makeSamples } from "./random.js";
import { DEFAULT_CONFIG } from "./config.js";
import { openPar5 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const PAT = JSON.parse(readFileSync(join(here, "../../data/extracted/2026-10-11-pattern.json"), "utf8"));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

test("R11: the draws keep his shots' own average and spread, and a lie widens them round the average", () => {
  const shots = resolveEntry(P, "7i", "full", "fairway").ell80.shots;
  const S = makeSamples(20000, 3);
  const draw = (k) => { const f = shotsSampler({ shots, sdMult: k }); return S.map((s) => f(s.z1, s.z2, s.v)); };
  const d1 = draw(1), d2 = draw(1.2);
  const xs = shots.map((s) => s[0]), ys = shots.map((s) => -s[1]);       // SP +y = short; alongMiss + = long
  assert.ok(Math.abs(mean(d1.map((d) => d.lat)) - mean(xs)) < 0.6, "across: the shots' average");
  assert.ok(Math.abs(mean(d1.map((d) => d.alongMiss)) - mean(ys)) < 0.6, "along: the shots' average");
  assert.ok(Math.abs(sd(d1.map((d) => d.lat)) / sd(xs) - 1) < 0.06, "across: the shots' spread");
  assert.ok(Math.abs(sd(d1.map((d) => d.alongMiss)) / sd(ys) - 1) < 0.06, "along: the shots' spread");
  assert.ok(Math.abs(mean(d2.map((d) => d.lat)) - mean(xs)) < 0.6, "the rough widens round the same average");
  assert.ok(Math.abs(sd(d2.map((d) => d.lat)) / sd(d1.map((d) => d.lat)) - 1.2) < 0.03, "by the lie's multiplier");
});

test("R11: every club and lie with an Oct 11 sheet prices from it — a Rough sheet alone, no sheet keeps the ring", () => {
  for (const p of PAT.entries) {
    const e = resolveEntry(P, p.club, "full", p.lie);
    if (p.club === "2Hy" && p.lie === "fairway") { assert.equal(e.provenance.ell80.lie, "tee", "D113: the 2-hybrid's 7-shot fairway sheet gives way to its tee sheet"); continue; }
    assert.equal(e.provenance.ell80.lie, p.lie, `${p.club} ${p.lie}`);
    assert.equal(e.ell80.capturedAt, "2026-10-11");
    assert.equal(e.ell80.shots.length, p.dots.length, `${p.club} ${p.lie}: every shot on the sheet`);
    assert.equal(e.ell80.sdMult, 1, `${p.club} ${p.lie}: measured on this lie, not widened`);
  }
  // the 6-iron has no Rough sheet: from the rough its fairway shots, widened by the rough
  const six = resolveEntry(P, "6i", "full", "rough");
  assert.equal(six.provenance.ell80.lie, "fairway");
  assert.equal(six.ell80.sdMult, DEFAULT_CONFIG.LIE_SD_MULT.rough / DEFAULT_CONFIG.LIE_SD_MULT.fairway);
  // no Oct 11 sheet for the wedges he doesn't hit full: their Oct 4 rings stay
  assert.equal(resolveEntry(P, "SW", "finesse", "fairway").ell80?.shots, undefined);
  // the Driver's big misses are in his 107 drives: the PDF's rates ride along, none are added
  const dr = RAW.clubs.find((c) => c.id === "Dr").entries.full.tee.bigMiss;
  assert.deepEqual([dr.left, dr.right], [0, 0]);
  assert.ok(dr.pdf.left > 0 && dr.pdf.right > dr.pdf.left);
});

test("R11: aimed off by its pattern, the shots the caddie keeps finish on the target (the 9-iron is lopsided)", () => {
  const e = resolveEntry(P, "9i", "full", "fairway");
  const all = mean(e.ell80.shots.map((s) => s[0]));
  assert.ok(Math.abs(all - e.ell80.dxYds) > 1, `every shot averages ${all.toFixed(1)}, the kept ones ${e.ell80.dxYds}`);
  const ball = { x: 0, y: 540 - Math.round(e.carry + e.roll) };
  const ctx = normalizeContext({ shotNo: 2, ball, lieType: "fairway" }, openPar5);
  const cand = { club: "9i", swing: "full", entry: e, kind: "approach", target: { x: 0, y: 540 }, label: "green, center" };
  const sim = simulateCandidate(cand, ctx, openPar5, P, makeSamples(P.config.SAMPLES, P.config.SEED));
  assert.ok(Math.abs(sim.aimOffsetYds + e.ell80.dxYds) < 1e-9, "aimed off by the kept shots' average");
  assert.ok(Math.abs(sim.meanLatYds) <= 1.5, `the kept shots finish ${sim.meanLatYds.toFixed(1)} from the target`);
  // and the engine's own kept draws are what the build measured
  const S = makeSamples(DEFAULT_CONFIG.SAMPLES, DEFAULT_CONFIG.SEED), f = shotsSampler({ shots: e.ell80.shots, sdMult: 1 });
  const along = new Float64Array(S.length), lat = new Float64Array(S.length);
  S.forEach((s, i) => { const d = f(s.z1, s.z2, s.v); along[i] = d.alongMiss; lat[i] = d.lat; });
  const kept = keptDraws(along, lat, DEFAULT_CONFIG.DROP_WORST_PCT);
  assert.ok(Math.abs(mean(kept.map((i) => lat[i])) - e.ell80.dxYds) < 0.06);
});
