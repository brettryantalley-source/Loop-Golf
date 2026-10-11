/*
 * teeboxes.test.js — v22.50 (C41, D121): each tee box in the colour of the tee it most likely is.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ringCentroid, yardsAlongHole, teeBoxYards, cardForHole, assignTeeBoxes } from "./teeboxes.js";
import { teeFill, satShapesModel, fallbackMapModel } from "./overlay.js";
import { buildHole } from "./geo.js";
import { localGeometryFor } from "../localGeometry.js";
import { LOCAL_CLUBS } from "../localCards.js";

const here = dirname(fileURLToPath(import.meta.url));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("C41: a box is measured as a card is — along the hole's line to the green's centre", () => {
  const c = ringCentroid([[0, 0], [10, 0], [10, 10], [0, 10]]);
  near(c.x, 5, 1e-9, "x"); near(c.y, 5, 1e-9, "y");
  // a dogleg: 200 up, then 150 right; the green's centre 10 past the line's end
  const hole = { line: [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 150, y: 200 }], green: { center: { x: 160, y: 200 } } };
  near(yardsAlongHole(hole, { x: 0, y: 0 }), 360, 1e-9, "the back of the line");
  near(yardsAlongHole(hole, { x: 4, y: 50 }), 310, 1e-9, "a forward box beside the line");
  near(yardsAlongHole({ green: { center: { x: 30, y: 40 } } }, { x: 0, y: 0 }), 50, 1e-9, "no line: straight");
});

test("C41: the card for a hole — one per name, no combos, no blanks, longest first", () => {
  const card = cardForHole([
    { name: "White", yards: [361, 425] }, { name: "Gold", yards: [435, 498] }, { name: "Blue/White", yards: [380, 440] },
    { name: "Red", yards: [295, 342] }, { name: "red", yards: [300, 340] }, { name: "Family", yards: [0, 250] },
  ], 0);
  assert.deepEqual(card, [{ name: "Gold", yards: 435 }, { name: "White", yards: 361 }, { name: "Red", yards: 295 }]);
  assert.deepEqual(cardForHole(null, 0), []);
});

test("C41: Bradshaw Red 2's boxes take Gold, Blue, White and Red; the next hole's box by the green takes none", () => {
  const data = JSON.parse(readFileSync(join(here, "../localGeometry/bradshaw.json"), "utf8"));
  const geo = localGeometryFor([data], data.apiId).geometry;
  const club = LOCAL_CLUBS.find((c) => c.key === "bradshaw-woodstock");
  const red = club.nines.find((n) => n.label === "Red");
  const hole = buildHole(geo, "2", { par: red.pars[1] });
  const teeCard = club.tees.map((t) => ({ name: t, yards: [red.yards[t][0], red.yards[t][1]] }));
  const names = assignTeeBoxes(hole, cardForHole(teeCard, 1));
  assert.equal(names.length, hole.tees.length);
  for (const t of ["Gold", "Blue", "White", "Red"]) assert.ok(names.includes(t), `${t}: ${names}`);
  const ys = teeBoxYards(hole);
  names.forEach((n, i) => {
    if (n) near(ys[i], red.yards[n][1], 20, `${n} box`);
    else assert.ok(ys[i] < 300, `an unmatched box is another hole's (${ys[i]})`);
  });
});

test("C41: a matched box is filled in its tee's colour on both maps; the rest keep the plain tint", () => {
  assert.equal(teeFill("#4F6E8F", 0.7), "rgba(79,110,143,0.7)");
  assert.equal(teeFill("PAPER", 0.5), "rgba(244,240,228,0.5)");
  assert.equal(teeFill(null, 0.5), null);
  const sq = (x) => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]];
  const hole = { tees: [sq(0), sq(20)], fairways: [], hazards: [], green: { ring: sq(0).map(([x, y]) => [x, y + 300]), center: { x: 5, y: 305 } } };
  const project = (p) => ({ x: p.x, y: -p.y });
  const sat = satShapesModel({ hole, project, teeColors: ["#4F6E8F", null] }).filter((n) => n.attrs["data-part"] === "shape-tee");
  assert.equal(sat[0].attrs.fill, "rgba(79,110,143,0.7)");
  assert.notEqual(sat[1].attrs.fill, sat[0].attrs.fill);
  const paper = fallbackMapModel({ hole, project, teeColors: ["PAPER", null] });
  assert.ok(paper.some((n) => n.attrs.fill === "rgba(244,240,228,0.85)"));
});
