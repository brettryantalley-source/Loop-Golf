/*
 * fairway.test.js — v22.17.4 (D90): lay-ups and the corridor's "center" aim at the middle of the
 * hole's own fairway, not at the hole line. Brett, Oct 4 test round: Chicopee Village 1's driver
 * target sat on the far right of the fairway, because the hole line runs along the tree edge there.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DEFAULT_CONFIG } from "./config.js";
import { fairwayCenterOn, classify, pointInRing, rect } from "./course.js";
import { loadProfile } from "./profile.js";
import { recommend, generateCandidates, normalizeContext } from "./engine.js";
import { toOverpass } from "../localGeometry.js";
import { parseOverpass } from "../geometry.js";
import { buildHole } from "./geo.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const UP = { x: 0, y: 1 };
const hole = (...fairways) => ({ fairways });

test("fairwayCenterOn: the line point moves to the middle of the fairway piece it sits in", () => {
  const p = fairwayCenterOn(hole(rect(-40, 100, 20, 300)), { x: 15, y: 250 }, UP);
  assert.ok(Math.abs(p.x - -10) < 1e-6 && Math.abs(p.y - 250) < 1e-6, JSON.stringify(p));
});

test("fairwayCenterOn: off the fairway, the nearest piece within reach; nothing within reach leaves it alone", () => {
  const p = fairwayCenterOn(hole(rect(-50, 100, -10, 300)), { x: 0, y: 250 }, UP);
  assert.ok(Math.abs(p.x - -30) < 1e-6, "10 yds off a fairway spanning −50..−10 → its middle");
  const far = fairwayCenterOn(hole(rect(-100, 100, -60, 300)), { x: 0, y: 250 }, UP);
  assert.deepEqual(far, { x: 0, y: 250 }, "60 yds away is past FAIRWAY_SNAP_YDS (40)");
  assert.deepEqual(fairwayCenterOn(hole(), { x: 3, y: 250 }, UP), { x: 3, y: 250 }, "no fairway at all (a par 3, a marked green)");
});

test("fairwayCenterOn: the piece it sits in beats a wider one nearby; the move is capped and stays on the fairway", () => {
  const two = hole(rect(-12, 100, 8, 300), rect(20, 100, 120, 300));
  assert.ok(Math.abs(fairwayCenterOn(two, { x: 5, y: 250 }, UP).x - -2) < 1e-6, "its own piece's middle (−2), not the wide one's");
  const wide = fairwayCenterOn(hole(rect(-5, 100, 200, 300)), { x: 0, y: 250 }, UP, 40);
  assert.ok(Math.abs(wide.x - 40) < 1e-6, `middle is 97.5 yds over; capped at 40 (got ${wide.x})`);
});

test("fairwayCenterOn: the cut is square to the shot — a shot heading right crosses a fairway running across the frame", () => {
  const p = fairwayCenterOn(hole(rect(200, 255, 300, 285)), { x: 250, y: 250 }, { x: 1, y: 0 });
  assert.ok(Math.abs(p.x - 250) < 1e-6 && Math.abs(p.y - 270) < 1e-6, JSON.stringify(p));
});

test("engine: a lay-up and the corridor's center sit mid-fairway when the hole line runs along its edge", () => {
  // a straight par 5 whose fairway is offset 25 yds left of the hole line (x = 0)
  const h = {
    id: "edge", par: 5, yards: 520, tee: { x: 0, y: 0 },
    green: { ring: rect(-15, 505, 15, 535), center: { x: 0, y: 520 } },
    fairways: [rect(-45, 60, -5, 480)], tees: [], hazards: [], boundary: null, line: [{ x: 0, y: 0 }, { x: 0, y: 520 }],
  };
  const ctx = normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 5 }, h);
  const cands = generateCandidates(ctx, h, P);
  const lay = cands.filter((c) => c.kind === "layup");
  assert.ok(lay.length > 0, "lay-ups generated");
  for (const c of lay) assert.ok(c.target.x < -5 && c.target.x > -45, `${c.club} lay-up on the fairway (x ${c.target.x.toFixed(1)})`);
  const centers = cands.filter((c) => c.kind === "corridor" && /, center$/.test(c.label));
  assert.ok(centers.length > 0, "corridor centers generated");
  for (const c of centers) assert.equal(c.target.x, -25, `${c.club}: "center" is the fairway's middle`);
});

/* ---------- the bundled maps ---------- */

const CLUBS = ["chicopee", "woodmont", "riverpines", "hampton"].map((n) => ({
  n, geo: parseOverpass(toOverpass(JSON.parse(readFileSync(join(here, "../localGeometry", `${n}.json`), "utf8")))),
}));
const onOwnFairway = (h, p) => (h.fairways || []).some((r) => pointInRing(p, r));

test("bundled maps: every lay-up off the tee with a fairway piece within reach lands on that fairway", () => {
  const snap = DEFAULT_CONFIG.FAIRWAY_SNAP_YDS;
  for (const { n, geo } of CLUBS) {
    let checked = 0;
    for (const k of Object.keys(geo.holes)) {
      const par = Number(geo.holes[k].par) || 4;
      const h = buildHole(geo, k, { par });
      if (!h) continue;
      const ctx = normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par }, h);
      for (const c of generateCandidates(ctx, h, P)) {
        if (c.kind !== "layup") continue;
        // the same cut the engine makes; a piece within reach means the target must be on it
        const reachable = [-1, 1].some((sgn) => {
          for (let d = 0; d <= snap; d += 1) {
            const dir = { x: c.target.x, y: c.target.y }, L = Math.hypot(dir.x, dir.y);
            const q = { x: c.target.x + (sgn * d * dir.y) / L, y: c.target.y - (sgn * d * dir.x) / L };
            if (onOwnFairway(h, q)) return true;
          }
          return false;
        });
        if (!reachable) continue;
        checked++;
        assert.ok(onOwnFairway(h, c.target), `${n} ${geo.holes[k].name || k}: ${c.club} ${c.label} at (${c.target.x.toFixed(0)}, ${c.target.y.toFixed(0)}) is off its fairway`);
      }
    }
    assert.ok(checked > 10, `${n}: ${checked} lay-ups checked`);
  }
});

test("Chicopee Village 1 (Brett, Oct 4): no tee call aims into the trees beside the hole line", () => {
  const { geo } = CLUBS[0];
  const k = Object.keys(geo.holes).find((x) => geo.holes[x].name === "Village 1");
  const h = buildHole(geo, k, { par: 4 });
  const res = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 4 }, h, P);
  for (const o of [res.safe, res.aggressive].filter(Boolean)) {
    assert.equal(classify(h, o.target), "fairway", `${o.club} ${o.target.label}`);
    assert.ok(onOwnFairway(h, o.target), `${o.club} on Village 1's own fairway`);
  }
  // the driver lay-up the caddie used to call: on the hole line in the trees (x ≈ −23), now mid-fairway
  const dr = generateCandidates(normalizeContext({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 4 }, h), h, P)
    .find((c) => c.club === "Dr" && c.kind === "layup");
  assert.ok(dr && onOwnFairway(h, dr.target) && dr.target.x < -30, `driver lay-up at x ${dr?.target.x.toFixed(1)}`);
});
