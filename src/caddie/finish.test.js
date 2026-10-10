/*
 * finish.test.js — v22.23 (C23, D94): Brett's club numbers are TOTALS, so a shot finishes on average
 * at its total, approaches included. A ball that lands on the green rolls its roll-out
 * (GREEN_ROLL_SHARE); before v22.23 it stopped where it landed, and the caddie called a club long.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { mergeConfig } from "./config.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { recommend, priceTarget } from "./engine.js";
import { noWaterPar4 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const Pstop = loadProfile(RAW, mergeConfig({ GREEN_ROLL_SHARE: 0 }));   // before v22.23: the ball stops on landing
const from = (yds, o = {}) => ({ shotNo: 2, ball: { x: 0, y: noWaterPar4.green.center.y - yds }, lieType: "fairway", par: 4, tempF: 85, ...o });
const total = (club) => Math.round(resolveEntry(P, club, "full", "fairway").carry + resolveEntry(P, club, "full", "fairway").roll);

test("C23: from 195 in the fairway on a hot day, middle pin → 6-iron, finishing at its total", () => {
  const r = recommend(from(195), noWaterPar4, P);
  assert.equal(r.safe.club, "6i", `${r.safe.club} ${r.safe.meanYds}`);
  assert.equal(r.safe.meanYds, total("6i"), "the average shot finishes at the 6-iron's total");
  const before = recommend(from(195), noWaterPar4, Pstop);
  assert.equal(before.safe.club, "5i", "before v22.23 the 6-iron stopped at its carry, so the call was a club longer");
});

test("C23: 207 → 5-iron, not the 4-hybrid; cooler air plays longer and clubs up", () => {
  assert.equal(recommend(from(207), noWaterPar4, P).safe.club, "5i");
  assert.equal(recommend(from(207), noWaterPar4, Pstop).safe.club, "4Hy", "the call Brett saw on Oct 10");
  assert.equal(recommend(from(195, { tempF: 59 }), noWaterPar4, P).safe.club, "5i", "59°F: the 195 plays longer");
});

test("C23: Brett's own target on the green picks the club by its total", () => {
  const o = priceTarget(from(195), noWaterPar4, P, { x: 0, y: noWaterPar4.green.center.y });
  assert.equal(o.club, "6i");
  assert.equal(o.meanYds, total("6i"));
});
