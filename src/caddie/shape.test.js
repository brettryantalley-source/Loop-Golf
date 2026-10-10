/*
 * shape.test.js — v22.37 (C24, D108): the start line follows the shot shape. Shot Pattern measures the
 * finish against Brett's target, which already allows for his curve, so the caddie's dashed line
 * starts the curve's width to the other side of the finish (a driver fade: 15 yds left) and the
 * finish — the yellow ring — stays where it was. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, usualShape, curveYds } from "./config.js";
import { aimPointFor, aimLineDeg } from "./overlay.js";
import { shotIntent, normIntent, defaultIntendedShape } from "./shotlog.js";

test("C24: his usual shape and curve per club, as he gave them on Oct 10", () => {
  const usual = Object.fromEntries(["Dr", "2Hy", "4Hy", "5i", "8i", "9i", "PW", "GW", "SW", "LW", "2i"].map((c) => [c, [usualShape(c), curveYds(c, usualShape(c))]]));
  assert.deepEqual(usual, {
    Dr: ["fade", 15], "2Hy": ["fade", 10], "4Hy": ["fade", 10], "5i": ["draw", -7], "8i": ["draw", -7],
    "9i": ["draw", -5], PW: ["draw", -5], GW: ["draw", -3], SW: ["straight", 0], LW: ["straight", 0], "2i": ["straight", 0],
  });
  // the other shape curves the same amount the other way; a straight club picked to curve uses the default
  assert.equal(curveYds("7i", "fade"), 7);
  assert.equal(curveYds("Dr", "draw"), -15);
  assert.equal(curveYds("SW", "fade"), DEFAULT_CONFIG.CURVE_DEFAULT_YDS);
  assert.equal(curveYds("Dr", "straight"), 0);
  assert.equal(defaultIntendedShape("Dr", [{ club: "Dr", intendedShape: "draw" }]), "fade", "his word over the history");
});

test("C24: the dashed line starts the curve's width to the other side; the target is unchanged", () => {
  const ball = { x: 0, y: 0 };
  const dr = { club: "Dr", target: { x: 0, y: 280 }, aimOffsetYds: 0 };
  const it = shotIntent({ option: dr, ball });
  assert.equal(it.shape, "fade"); assert.equal(it.curveYds, 15);
  const A = aimPointFor({ ...dr, curveYds: it.curveYds }, ball);
  assert.ok(Math.abs(A.x + 15) < 1e-9 && Math.abs(A.y - 280) < 1e-9, `driver fade starts 15 left: ${JSON.stringify(A)}`);
  assert.ok(aimLineDeg({ ...dr, curveYds: 15 }, ball) < 0, "the line points left of the target");
  // the pattern + wind aim-off and the curve add: an 8-iron aims 7.1 R for its pattern, draws 7 L → starts 14.1 R
  const i8 = { club: "8i", target: { x: 0, y: 160 }, aimOffsetYds: 7.1 };
  assert.ok(Math.abs(aimPointFor({ ...i8, curveYds: shotIntent({ option: i8, ball }).curveYds }, ball).x - 14.1) < 1e-9);
  // he picks Straight: the line is the pattern aim alone
  const st = shotIntent({ option: i8, ball, set: { shape: "straight" } });
  assert.equal(st.curveYds, undefined);
  assert.ok(Math.abs(aimPointFor(i8, ball).x - 7.1) < 1e-9);
  // the curve survives storage
  assert.equal(normIntent(JSON.parse(JSON.stringify(it))).curveYds, 15);
});
