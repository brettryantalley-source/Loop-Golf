/*
 * tee.test.js — v22.24 (C31, D95): shot 1 a few yards off the mapped tee box is a tee shot. Brett's
 * Oct 10 test: a ball placed with "I'm at my ball" just off the box read rough, rough takes the full
 * driver and 2-iron away (D86), and SAFE was a 2-hybrid finishing 163 out on a 422-yd par 4.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadProfile } from "./profile.js";
import { recommend } from "./engine.js";
import { assembleShotContext, nearTee } from "./context.js";
import { classify, ringDistance } from "./course.js";
import { buildHole } from "./geo.js";
import { toOverpass } from "../localGeometry.js";
import { parseOverpass } from "../geometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));
const geo = parseOverpass(toOverpass(JSON.parse(readFileSync(join(here, "../localGeometry/woodmont.json"), "utf8"))));

/** The first par 4 or 5 with a mapped tee box, and a rough point `off` yds beside that box. */
function setup(off = 8) {
  for (const k of Object.keys(geo.holes)) {
    const par = Number(geo.holes[k].par) || 4;
    if (par < 4) continue;
    const hole = buildHole(geo, k, { par });
    if (!hole?.tees?.length) continue;
    for (const ring of hole.tees) {
      const c = ring.reduce((a, [x, y]) => ({ x: a.x + x / ring.length, y: a.y + y / ring.length }), { x: 0, y: 0 });
      for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
        for (let d = 1; d < 80; d += 0.5) {
          const p = { x: c.x + dir.x * d, y: c.y + dir.y * d };
          const gap = ringDistance(p, ring);
          if (gap < off) continue;
          if (gap > off + 1) break;
          if (classify(hole, p) === "rough" && hole.tees.every((r) => ringDistance(p, r) >= off - 0.01)) return { hole, par, ball: p };
          break;
        }
      }
    }
  }
  return null;
}

test("C31: shot 1 placed 8 yds off the tee box is a tee lie, and the driver is back", () => {
  const s = setup(8);
  assert.ok(s, "a Woodmont par 4/5 with a rough point 8 yds off a tee box");
  const round = { hole: s.hole.id, par: s.par, shotNo: 1, trigger: "ball", ball: s.ball };
  const ctx = assembleShotContext({ round, hole: s.hole, geometry: geo });
  assert.equal(ctx.lieType, "tee");
  assert.equal(ctx.meta.sources.lie, "tee-near");
  const clubs = (lie) => recommend({ ...ctx, lieType: lie }, s.hole, P);
  assert.ok([clubs("tee").safe.club, clubs("tee").aggressive?.club].includes("Dr"), "the driver is a call again");
  // shot 2 from the same spot is a rough shot; the Lie chip still wins on shot 1
  assert.equal(assembleShotContext({ round: { ...round, shotNo: 2 }, hole: s.hole, geometry: geo }).lieType, "rough");
  assert.equal(assembleShotContext({ round, hole: s.hole, geometry: geo, chips: { lie: "rough" } }).lieType, "rough");
});

test("C31: more than 15 yds off the box stays the lie it reads; no tee boxes mapped → the tee point", () => {
  const s = setup(20);
  assert.ok(s);
  const ctx = assembleShotContext({ round: { hole: s.hole.id, par: s.par, shotNo: 1, trigger: "ball", ball: s.ball }, hole: s.hole, geometry: geo });
  assert.equal(ctx.lieType, "rough");
  assert.equal(nearTee({ tee: { x: 0, y: 0 }, tees: [] }, { x: 9, y: 9 }, 15), true);
  assert.equal(nearTee({ tee: { x: 0, y: 0 }, tees: [] }, { x: 12, y: 12 }, 15), false);
});
