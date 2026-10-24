/*
 * creekside.test.js — Golf Club of Georgia, Creekside (src/localGeometry/creekside.json, v22.66, D139): the OSM
 * snapshot filtered to the course as the app reads it — 18 of 18 covered, every hole built off the card, the creeks
 * and the club outline read as trouble, hole 5's two back tees off the lidar (v22.69), hole 4's green as its putting
 * surface (v22.69), the tee call on every par 4 and 5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { localGeometryFor, elevationSamples, greenGrids, bundledMapId } from "./localGeometry.js";
import { yardsBetween, haversineM, pointInRing } from "./geometry.js";
import { coverageCheck, buildHole, detectHole, frameOf } from "./caddie/geo.js";
import { classify } from "./caddie/course.js";
import { gridForGreen, slopeArrows } from "./caddie/greenslope.js";
import { teeBoxYards } from "./caddie/teeboxes.js";
import { loadProfile } from "./caddie/profile.js";
import { recommend } from "./caddie/engine.js";
import { DEFAULT_CONFIG } from "./caddie/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "localGeometry", "creekside.json"), "utf8"));
const lg = localGeometryFor([data], "yx7d5vnk");
const geo = lg.geometry;

/* The printed card (golfcourseapi yx7d5vnk): pars, Gold and Blue yardages. */
const PAR = [5, 4, 4, 3, 5, 4, 3, 4, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4];
const GOLD = [514, 454, 410, 180, 515, 378, 162, 446, 328, 434, 207, 533, 372, 408, 539, 218, 435, 442];
const BLUE = [486, 421, 379, 158, 492, 348, 146, 429, 307, 407, 181, 522, 338, 374, 516, 191, 425, 406];
const ring2m2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2 / 1.19599; };

test("D139: the file is found by the course's API id, parses with no warning, and carries the club outline as the boundary", () => {
  assert.equal(lg.version, "yx7d5vnk@5");
  assert.equal(localGeometryFor([data], "mse9vsm1"), null, "Lakeside is not this file");
  assert.deepEqual(geo.warnings, []);
  assert.ok(geo.boundary && geo.boundary.ring.length > 200, "OSM's club outline holds every Creekside shape, so it is the OB line");
  assert.ok(data.imagery.url.startsWith("https://gismaps.fultoncountyga.gov/"), "Fulton County's photo (D140)");
  assert.equal(data.imageryEsri.url.split("/tile/")[1].split("/")[0], "41468", "the Sep 2023 leaf-on Esri capture, kept to go back to");
});

test("D139: coverage 18 of 18, pars the card's, every line ends in its green, every hole builds with tees, a fairway on par 4s and 5s", () => {
  const c = coverageCheck(geo, { expected: [...Array(18)].map((_, i) => i + 1) });
  assert.equal(c.complete, true);
  assert.deepEqual(c.missing, []);
  assert.equal(c.orphanGreens, 0);
  for (let n = 1; n <= 18; n++) {
    const h = geo.holes[n];
    assert.ok(h, `hole ${n}`);
    assert.equal(h.par, PAR[n - 1], `hole ${n} par`);
    assert.ok(pointInRing(h.greenEnd, h.green.ring), `hole ${n}: the line ends inside its green`);
    const straight = yardsBetween(h.line[0], h.green.center);
    assert.ok(straight > 0.7 * BLUE[n - 1] && straight < 1.1 * GOLD[n - 1], `hole ${n}: ${Math.round(straight)} yd tee-to-green vs card ${GOLD[n - 1]}/${BLUE[n - 1]}`);
    const b = buildHole(geo, n, { par: PAR[n - 1], yards: GOLD[n - 1] });
    assert.ok(b, `hole ${n} builds`);
    const area = ring2m2(b.green.ring);
    assert.ok(area > 300 && area < 1100, `hole ${n} green ${Math.round(area)} m²`);
    assert.ok(b.tees.length >= 2, `hole ${n} has tee boxes`);
    if (PAR[n - 1] >= 4) assert.ok(b.fairways.length >= 1, `hole ${n} has a fairway`);
    assert.equal(classify(b, b.green.center), "green", `hole ${n} green centre`);
    assert.equal(classify(b, { x: 0, y: 0 }), "tee", `hole ${n} tee origin`);
  }
});

test("v22.69: hole 5's two back tees are the lidar's raised pads across the creek, and the line starts on the upper one", () => {
  // Brett, Oct 24 on the 5th tee: "the tee boxes on hole 5 are definitely off" — the Oct 22 rectangle sat 8 m off the
  // lower pad and the upper pad was not drawn; lidar shows both flat tops (304.5 m and 311.0 m, 21 m apart)
  assert.equal(data.ways.filter((w) => w.q === "traced" && w.tags.golf === "tee").length, 0, "the Oct 22 traced rectangle is gone");
  const pads = data.ways.filter((w) => w.q === "lidar+photo");
  assert.equal(pads.length, 2);
  assert.ok(pads.every((w) => w.tags.golf === "tee"));
  const line = data.ways.find((w) => w.tags.golf === "hole" && w.tags.ref === "5");
  assert.equal(line.q, "osm+lidar");
  assert.deepEqual(line.pts[0], [34.096182, -84.226872], "the line starts on the upper pad's centre");
  const h = geo.holes[5];
  const straight = yardsBetween(h.line[0], h.green.center);
  assert.ok(straight > 430 && straight < 445, `${Math.round(straight)} yds straight from the upper pad`);
  const b = buildHole(geo, 5, { par: 5, yards: 515 });
  assert.equal(classify(b, { x: 0, y: 0 }), "tee", "the line starts on a pad");
  const ys = teeBoxYards(b).map(Math.round).sort((p, q) => q - p);
  assert.ok(ys[0] > 485 && ys[0] < 505, `upper pad ${ys[0]} yds along the line (card 515 / 492)`);
  assert.ok(ys[1] > 462 && ys[1] < 485, `lower pad ${ys[1]} yds`);
  assert.ok(ys.some((y) => y > 370 && y < 395), "OSM's platform west of the creek is kept");
});

test("v22.69: hole 4's green is its putting surface, not OSM's outline with the collar and front bank", () => {
  // Brett, Oct 24: "this green map is pretty terrible" — every arrow red; OSM's 991 m² took in the bank the lidar climbs
  const green = data.ways.find((w) => w.tags.golf === "green" && w.q === "traced");
  assert.ok(green, "hole 4's green is traced");
  const b = buildHole(geo, 4, { par: 3, yards: 180 });
  const area = ring2m2(b.green.ring);
  assert.ok(area > 500 && area < 620, `${Math.round(area)} m² putting surface`);
  assert.ok(pointInRing(geo.holes[4].greenEnd, geo.holes[4].green.ring), "the line still ends on the green");
  const F = frameOf(b);
  const grid = gridForGreen(greenGrids(data), b, F);
  assert.ok(grid, "its lidar grid is still found");
  const arrows = slopeArrows(grid, b, F);
  const red = arrows.filter((a) => a.pct >= 3).length / arrows.length;
  assert.ok(arrows.length >= 25 && red < 0.85, `${arrows.length} arrows, ${Math.round(100 * red)}% red (91% on OSM's outline)`);
});

test("D139: the creeks are water — buffered OSM centrelines — and the lidar woods line the holes", () => {
  const creeks = data.ways.filter((w) => w.q === "osm+buffer");
  assert.ok(creeks.length >= 6, `${creeks.length} creek pieces`);
  assert.ok(creeks.every((w) => w.tags.golf === "water_hazard"));
  const withWater = [...Array(18)].map((_, i) => buildHole(geo, i + 1, { par: PAR[i] })).filter((h) => h.hazards.some((x) => x.type === "water"));
  assert.ok(withWater.length >= 12, `${withWater.length} holes carry water`);
  const woods = data.ways.filter((w) => w.tags.natural === "wood" && w.q === "lidar");
  assert.ok(woods.length > 300, `${woods.length} lidar woods`);
  assert.match(data.source.woods, /GA_Statewide_B3_2018/);
});

test("D139: the 3DEP grid and the green grids ride the file — the course drops 46 m tee to creek", () => {
  const s = elevationSamples(data);
  assert.ok(s && s.length > 2500, `${s?.length} elevation samples`);
  const zs = s.map((p) => p.elevM);
  assert.ok(Math.min(...zs) > 295 && Math.max(...zs) < 350, "metres above sea level, north Georgia");
  const grids = greenGrids(data);
  assert.equal(grids.length, 18, "a lidar grid per green");
});

test("D139: the caddie advances hole to hole off the tee boxes", () => {
  for (let n = 1; n <= 18; n++) {
    const r = detectHole(geo, geo.holes[n].line[0], n === 1 ? 18 : n - 1);
    assert.equal(r.advanced, true, `hole ${n} advances`);
    assert.equal(r.hole, n);
  }
});

test("D139: a tee call on every par 4 and 5, from the profile, priced on the hole's own trouble", () => {
  const P = loadProfile(JSON.parse(readFileSync(join(here, "profile.json"), "utf8")), DEFAULT_CONFIG);
  for (let n = 1; n <= 18; n++) {
    if (PAR[n - 1] < 4) continue;
    const h = buildHole(geo, n, { par: PAR[n - 1], yards: GOLD[n - 1] });
    const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: PAR[n - 1], pinPos: "middle" }, h, P);
    assert.ok(r.safe && r.safe.club, `hole ${n} has a SAFE call`);
    assert.ok(r.safe.parProb > 0.05 && r.safe.parProb < 0.95, `hole ${n}: par chance ${r.safe.parProb}`);
  }
});

test("D139: nothing wanders — every point within 3 km of the first tee (the course runs 2.4 km east to west), every ring closed", () => {
  const a = geo.holes[1].line[0];
  const rings = (w) => (w.outer ? [...w.outer, ...(w.inner || [])] : [w.pts]);
  for (const w of data.ways) for (const r of rings(w)) for (const [lat, lon] of r) {
    assert.ok(Number.isFinite(lat) && Number.isFinite(lon));
    assert.ok(haversineM({ lat, lon }, a) < 3000, `${w.tags.golf || w.tags.natural || w.tags.leisure} point ${lat},${lon}`);
  }
  for (const w of data.ways) if (w.tags.golf !== "hole") for (const r of rings(w)) assert.deepEqual(r[0], r[r.length - 1], `${w.tags.golf || w.tags.natural} ring is closed`);
});

test("v22.68: picked through Setup's club row (Creekside + Lakeside folded, keyed by Lakeside's id), Creekside still finds its map", () => {
  const reg = [data];
  assert.equal(bundledMapId(reg, "yx7d5vnk", "mse9vsm1"), "yx7d5vnk", "Creekside under the club's id");
  assert.equal(bundledMapId(reg, "mse9vsm1", "mse9vsm1"), "mse9vsm1", "Lakeside keeps the club id (no file)");
  assert.equal(bundledMapId(reg, "yx7d5vnk", undefined), "yx7d5vnk", "no club id: its own");
  const bradshaw = { apiId: "0d614xe6", apiIds: ["0d614xe6", "pr605r02", "xs7ypdb7"] };
  assert.equal(bundledMapId([bradshaw], "pr605r02", "0d614xe6"), "0d614xe6", "a 27-hole club keeps one key across routings");
});

test("v22.70: hole 3's fairway is about 30 yds wide through the driver's landing area (Brett, on the course)", () => {
  // Brett, Oct 24: "there is no way that the fairway is this narrow" — OSM had 16 / 12 / 10 / 9 yds at 240–300 out;
  // both photos agree with OSM, but his eye wins (Q4, D145); kept 5 yds off the lidar trees
  const w = data.ways.find((x) => x.tags.golf === "fairway" && x.q === "osm+field");
  assert.ok(w, "hole 3's fairway is the field-widened one");
  const b = buildHole(geo, 3, { par: 4, yards: 410 });
  for (const y of [240, 260, 280, 300]) {
    let n = 0;
    for (let x = -80; x <= 80; x += 0.5) if (classify(b, { x, y }) === "fairway") n++;
    assert.ok(n * 0.5 >= 25, `${n * 0.5} yds of fairway ${y} out`);
  }
});
