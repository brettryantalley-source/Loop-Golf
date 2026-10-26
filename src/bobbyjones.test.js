/*
 * bobbyjones.test.js — Bobby Jones Golf Course (Atlanta), the Azalea routing (src/localGeometry/bobbyjones.json +
 * src/localCourses.js, v22.71, D146): a reversible nine played twice, bundled as 18 holes sharing nine double greens,
 * with a card the course API does not have. The file as the app reads it — 18 of 18 covered, every hole built off the
 * card, the second loop as furnished as the first (mirrorLoop), the creeks as water, no boundary (OSM's outline
 * predates the rebuild), the lidar grids and woods, the tee call on every hole — and the bundled card as Setup sees it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { localGeometryFor, elevationSamples, greenGrids, imageryFor, bundledMapId, mirrorLoop } from "./localGeometry.js";
import { yardsBetween, pointInRing, parseOverpass, haversineM, distToPolylineM, destination } from "./geometry.js";
import { coverageCheck, buildHole, detectHole, frameOf, teeStretch, TEE_DETECT_M } from "./caddie/geo.js";
import { classify } from "./caddie/course.js";
import { gridForGreen, slopeArrows } from "./caddie/greenslope.js";
import { assembleShotContext } from "./caddie/context.js";
import { loadProfile } from "./caddie/profile.js";
import { recommend } from "./caddie/engine.js";
import { DEFAULT_CONFIG } from "./caddie/config.js";
import { LOCAL_COURSES, localCourseSearch, localFullCourse } from "./localCourses.js";
import { normalizeStrokeIndex } from "./routing.js";
import { toOverpass } from "./localGeometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "localGeometry", "bobbyjones.json"), "utf8"));
const ID = "bobbyjones-azalea";
const lg = localGeometryFor([data], ID);
const geo = lg.geometry;

/* The published card (GolfPass, the Azalea Nine): pars, Tee 8 and Tee 6 yardages. */
const PAR = [5, 3, 4, 4, 5, 4, 3, 4, 4];
const T8 = [616, 223, 441, 329, 505, 402, 195, 486, 452];
const T6 = [521, 179, 404, 300, 424, 360, 164, 425, 363];
const nine = (n) => (n - 1) % 9;
const ring2m2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2 / 1.19599; };

test("D146: the file is found by the bundled course's id, the nine is written twice, and OB is off", () => {
  assert.equal(lg.version, `${ID}@${data.version}`);
  assert.equal(data.loop, 9);
  assert.equal(bundledMapId([data], ID, ID), ID);
  assert.equal(data.ways.filter((w) => w.tags.golf === "hole").length, 18);
  assert.equal(data.ways.filter((w) => w.tags.golf === "green").length, 9, "nine double greens, each once");
  assert.equal(data.ways.filter((w) => w.tags.golf === "tee").length, 0, "OSM has no tee boxes here");
  assert.ok(!data.ways.some((w) => w.tags.leisure === "golf_course"), "OSM's outline predates the 2018 rebuild (the 9th green sits outside it): not bundled");
  assert.equal(geo.boundary, null);
  assert.deepEqual(geo.warnings, ["no leisure=golf_course boundary — OB off"]);
  assert.ok(imageryFor([data], ID).url.startsWith("https://gismaps.fultoncountyga.gov/"), "Fulton County's photo (D140)");
  assert.equal(data.imageryEsri.url.split("/tile/")[1].split("/")[0], "41468", "the Sep 2023 leaf-on Esri capture, kept to go back to");
  for (let n = 1; n <= 9; n++) {
    assert.deepEqual(geo.holes[n].line, geo.holes[n + 9].line, `hole ${n + 9} is hole ${n}'s line`);
    assert.equal(geo.holes[n].green.ring, geo.holes[n + 9].green.ring, `hole ${n + 9} shares hole ${n}'s green`);
  }
});

test("D146: coverage 18 of 18, pars the card's, every line ends in its green, every hole builds with a fairway on par 4s and 5s", () => {
  const c = coverageCheck(geo, { expected: [...Array(18)].map((_, i) => i + 1) });
  assert.equal(c.complete, true);
  assert.deepEqual(c.missing, []);
  assert.equal(c.orphanGreens, 0, "the Cupp Links short course's greens are left out");
  for (let n = 1; n <= 18; n++) {
    const h = geo.holes[n], i = nine(n);
    assert.ok(h, `hole ${n}`);
    assert.equal(h.par, PAR[i], `hole ${n} par`);
    assert.ok(pointInRing(h.greenEnd, h.green.ring), `hole ${n}: the line ends inside its green`);
    const straight = yardsBetween(h.line[0], h.green.center);
    assert.ok(straight > 0.7 * T6[i] && straight < 1.1 * T8[i], `hole ${n}: ${Math.round(straight)} yd tee-to-green vs card ${T8[i]}/${T6[i]}`);
    const b = buildHole(geo, n, { par: PAR[i], yards: T8[i] });
    assert.ok(b, `hole ${n} builds`);
    const area = ring2m2(b.green.ring);
    assert.ok(area > 600 && area < 1400, `hole ${n} double green ${Math.round(area)} m²`);
    if (PAR[i] >= 4) assert.ok(b.fairways.length >= 1, `hole ${n} has a fairway`);
    assert.ok(b.hazards.some((x) => x.type === "sand"), `hole ${n} has a bunker`);
    assert.equal(classify(b, b.green.center), "green", `hole ${n} green centre`);
    assert.ok(!b.nearby.greens.some((r) => r === b.green.ring), `hole ${n}: its own green is not a neighbour's`);
  }
});

test("D146: mirrorLoop — the second loop carries the first loop's fairways, rough, bunkers and water; the detected hole runs 9 → 10 → 1", () => {
  for (let n = 1; n <= 9; n++) {
    const a = buildHole(geo, n, { par: PAR[n - 1] }), b = buildHole(geo, n + 9, { par: PAR[n - 1] });
    assert.equal(b.fairways.length, a.fairways.length, `hole ${n + 9} fairways`);
    assert.equal(b.roughs.length, a.roughs.length, `hole ${n + 9} rough`);
    assert.equal(b.hazards.length, a.hazards.length, `hole ${n + 9} hazards`);
  }
  // without the mirror, parseOverpass hands each fairway to one hole: the second loop's par 4s came up bare
  const bare = parseOverpass(toOverpass(data));
  assert.ok(buildHole(bare, 13, { par: 4 }).fairways.length < buildHole(geo, 13, { par: 4 }).fairways.length, "hole 13 had no fairway before the mirror");
  assert.equal(mirrorLoop(null, 9), null);
  const tee10 = geo.holes[1].line[0];                 // {lat, lon}: with no tee boxes drawn, the line's start stands for the tee
  assert.equal(detectHole(geo, tee10, 9).hole, 10, "after the 9th, the 1st tee is the 10th");
  assert.equal(detectHole(geo, tee10, 18).hole, 1);
  assert.equal(detectHole(geo, geo.holes[2].line[0], 10).hole, 11);
});

test("D147: with no tee box drawn, the line's leading stretch is the tee — a forward tee still advances the hole, a tee tap on the previous hole never does", () => {
  // Brett plays Tee 6 or 7: on hole 1 that is 50–95 yds up the line from OSM's start (the card's Tee 1 is 351 yds up)
  const line = geo.holes[1].line;
  const stretch = teeStretch(line);
  const total = line.slice(1).reduce((s, p, i) => s + haversineM(line[i], p), 0);
  const kept = stretch.slice(1).reduce((s, p, i) => s + haversineM(stretch[i], p), 0);
  assert.ok(Math.abs(kept - 0.6 * total) < 1, `${Math.round(kept)} of ${Math.round(total)} m`);
  const tee6 = destination(line[0], bearingTo(line[0], line[1]), 90 / 1.09361);
  assert.equal(detectHole(geo, tee6, 9).hole, 10, "90 yds up hole 1's line from the 9th: the 10th");
  assert.equal(detectHole(geo, line[line.length - 1], 9).hole, 9, "the green end of hole 1's line is not a tee");
  assert.equal(detectHole(geo, destination(line[0], bearingTo(line[0], line[1]), 250 / 1.09361), 9).hole, 10, "250 yds up the line is still tee ground here: the card's Tee 1 sits 351 yds up");
  // a par 3's stretch stops 100 m short of its green
  const l2 = geo.holes[2].line, s2 = teeStretch(l2);
  assert.ok(haversineM(s2[s2.length - 1], l2[l2.length - 1]) >= 99, "hole 2's stretch keeps 100 m off the green end");
  // standing on hole n's tee and tapping "I'm on the tee" never reads as hole n + 1: every start is well off the next line's stretch
  for (let n = 1; n <= 18; n++) {
    const next = geo.holes[(n % 18) + 1];
    const d = distToPolylineM(geo.holes[n].line[0], teeStretch(next.line));
    assert.ok(d > 2 * TEE_DETECT_M, `hole ${n}'s start is ${Math.round(d)} m from hole ${(n % 18) + 1}'s tee stretch`);
  }
});
function bearingTo(a, b) { const dLon = (b.lon - a.lon) * Math.PI / 180, la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180; return (Math.atan2(Math.sin(dLon) * Math.cos(lb), Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon)) * 180 / Math.PI + 360) % 360; }

test("D146: the creeks are water — Peachtree Creek's OSM area clipped, Tanyard Creek's centreline buffered — and the lidar woods line the holes", () => {
  const clipped = data.ways.filter((w) => w.q === "osm+clip");
  assert.equal(clipped.length, 1);
  assert.equal(clipped[0].tags.name, "Peachtree Creek");
  const buffered = data.ways.filter((w) => w.q === "osm+buffer");
  assert.ok(buffered.length >= 2, `${buffered.length} buffered creek pieces`);
  assert.ok(buffered.every((w) => w.tags.golf === "water_hazard"));
  const withWater = [...Array(18)].map((_, i) => buildHole(geo, i + 1, { par: PAR[nine(i + 1)] })).filter((h) => h.hazards.some((x) => x.type === "water"));
  assert.equal(withWater.length, 18, "every hole carries water");
  const woods = data.ways.filter((w) => w.tags.natural === "wood" && w.q === "lidar");
  assert.ok(woods.length > 50, `${woods.length} lidar woods`);
  assert.match(data.source.woods, /GA_Statewide_B2_2018/);
});

test("D146: the 3DEP grid and the nine green grids ride the file", () => {
  const s = elevationSamples(data);
  assert.ok(s && s.length > 900, `${s?.length} elevation samples`);
  const zs = s.map((p) => p.elevM);
  assert.ok(Math.min(...zs) > 225 && Math.max(...zs) < 270, "metres above sea level, Peachtree Creek's valley");
  const grids = greenGrids(data);
  assert.equal(grids.length, 9, "a lidar grid per double green");
  for (let n = 1; n <= 18; n++) {
    const b = buildHole(geo, n, { par: PAR[nine(n)] }), F = frameOf(b);
    const g = gridForGreen(grids, b, F);
    assert.ok(g, `hole ${n} finds its grid`);
    assert.ok(slopeArrows(g, b, F).length >= 30, `hole ${n} arrows`);
  }
});

test("D146: the tee call on every hole from the line's start, priced as a tee shot", () => {
  const P = loadProfile(JSON.parse(readFileSync(join(here, "profile.json"), "utf8")), DEFAULT_CONFIG);
  const elevation = elevationSamples(data);
  for (let n = 1; n <= 18; n++) {
    const i = nine(n);
    const h = buildHole(geo, n, { par: PAR[i], yards: T6[i] });
    const ctx = assembleShotContext({ hole: h, round: { shotNo: 1, trigger: "tee", ball: { x: 0, y: 0 }, par: PAR[i], hole: n }, geometry: geo, elevation, config: DEFAULT_CONFIG });
    assert.equal(ctx.lieType, "tee", `hole ${n}: the first shot is from the tee even with no tee box drawn`);
    const r = recommend(ctx, h, P);
    assert.ok(r?.safe?.club, `hole ${n} has a SAFE call`);
    assert.ok(r.safe.parProb > 0.3, `hole ${n} par ${r.safe.parProb}`);
  }
});

test("D146: the bundled card — Setup finds it, 18 holes are the nine twice, the rating is the 9-hole rating doubled, the stroke index spreads to 1–18", () => {
  assert.equal(LOCAL_COURSES.length, 1);
  assert.deepEqual(localCourseSearch("bobby").map((c) => c.id), [ID]);
  assert.deepEqual(localCourseSearch("Azalea").map((c) => c.id), [ID]);
  assert.deepEqual(localCourseSearch("Bobby Jones Golf Course").map((c) => c.id), [ID]);
  assert.deepEqual(localCourseSearch("creekside"), []);
  assert.deepEqual(localCourseSearch("b"), [], "two letters or more, like the API search");
  assert.equal(localFullCourse("yx7d5vnk"), null);
  const full = localFullCourse(ID);
  assert.equal(full.club_name, "Bobby Jones Golf Course");
  assert.equal(full.course_name, "Azalea");
  assert.equal(full.location.state, "GA");
  assert.ok(!("aliases" in full) && !("source" in full), "the API shape only");
  assert.equal(full.tees.male.length, 8);
  assert.equal(full.tees.female.length, 8);
  const t6 = full.tees.male.find((t) => t.tee_name === "Tee 6");
  assert.equal(t6.holes.length, 18);
  assert.equal(t6.par_total, 72);
  assert.equal(t6.total_yards, 6280);
  assert.equal(t6.course_rating, 69.0, "2 × 34.5");
  assert.equal(t6.slope_rating, 121);
  assert.deepEqual(t6.holes.map((h) => h.par), [...PAR, ...PAR]);
  assert.deepEqual(t6.holes.map((h) => h.yardage), [...T6, ...T6]);
  assert.deepEqual(t6.holes.map((h) => h.handicap), [2, 9, 3, 7, 6, 4, 8, 5, 1, 2, 9, 3, 7, 6, 4, 8, 5, 1]);
  const si = normalizeStrokeIndex(t6.holes).map((h) => h.handicap);
  assert.deepEqual([...si].sort((a, b) => a - b), [...Array(18)].map((_, i) => i + 1), "odd/even: no index twice");
  assert.equal(si[8], 1, "the 9th is the hardest");
  assert.equal(si[17], 2);
  const t8 = full.tees.male.find((t) => t.tee_name === "Tee 8");
  assert.equal(t8.total_yards, 7298);
  assert.equal(t8.course_rating, 73.8);
  const w6 = full.tees.female.find((t) => t.tee_name === "Tee 6");
  assert.equal(w6.course_rating, 75.2);
  assert.equal(w6.slope_rating, 131);
});
