/*
 * callahan.test.js — Callahan Golf Links, Waleska GA (src/localGeometry/callahan.json, v22.75, D150):
 * the OSM snapshot filtered to the club as the app reads it — 18 of 18 covered, pars the card's (and its stroke index, which OSM lacks here), every
 * hole built with tee boxes, McCanless, Sardis and Byrd Creeks as water, the club outline as the OB line, the 3DEP grid, the
 * green grids and the lidar woods, the caddie advancing tee to tee, a tee call on every par 4 and 5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { localGeometryFor, elevationSamples, greenGrids, bundledMapId, imageryFor } from "./localGeometry.js";
import { yardsBetween, pointInRing } from "./geometry.js";
import { coverageCheck, buildHole, detectHole } from "./caddie/geo.js";
import { classify } from "./caddie/course.js";
import { loadProfile } from "./caddie/profile.js";
import { recommend } from "./caddie/engine.js";
import { DEFAULT_CONFIG } from "./caddie/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "localGeometry", "callahan.json"), "utf8"));
const ID = "ztss1ttq";
const lg = localGeometryFor([data], ID);
const geo = lg.geometry;

/* The card (golfcourseapi ztss1ttq): pars, stroke index, Black and Blue yardages. */
const PAR = [5, 4, 4, 5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 3, 4, 4, 3, 5];
const SI = [9, 5, 11, 7, 1, 17, 3, 15, 13, 8, 4, 10, 2, 18, 12, 16, 14, 6];
const BLACK = [495, 427, 325, 534, 429, 156, 403, 167, 398, 517, 386, 383, 415, 159, 366, 352, 197, 566];
const BLUE = [461, 414, 321, 512, 412, 134, 354, 170, 381, 476, 364, 353, 383, 146, 337, 331, 178, 544];
const ring2m2 = (ring) => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2 / 1.19599; };

test("D150: the file is found by the club's API id, parses with no warning, carries the club outline as the boundary and the county photo", () => {
  assert.equal(lg.version, `${ID}@${data.version}`);
  assert.equal(bundledMapId([data], ID, ID), ID);
  assert.deepEqual(geo.warnings, []);
  assert.ok(geo.boundary && geo.boundary.ring.length >= 20, "OSM's club outline holds every hole line and green, so it is the OB line");
  assert.ok(imageryFor([data], ID).url.includes("gis.cherokeecountyga.gov"), "Cherokee County's orthophoto, as at Woodmont and Bradshaw (D140)");
  assert.ok(data.imageryEsri.url.includes("/tile/43291/"), "the current leaf-on Esri capture (Wayback 43291) kept as imageryEsri");
  for (let n = 1; n <= 18; n++) {
    const w = data.ways.find((x) => x.tags.golf === "hole" && x.tags.ref === String(n));
    assert.equal(Number(w.tags.par), PAR[n - 1], `hole ${n} par`);
    assert.equal(Number(w.tags.handicap), SI[n - 1], `hole ${n} stroke index`);
    assert.equal(w.q, [4, 9, 13].includes(n) ? "osm+tee" : "osm", `hole ${n}: the line is OSM's, extended back to the Black box on 4, 9 and 13`);
  }
});

test("D150: coverage 18 of 18, every line ends in its green, every hole builds with tee boxes, a fairway on par 4s and 5s", () => {
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
    // Hole 6: OSM's line starts on a pad ~40 yds behind the card's Black tee (the Black box sits in front of it), left as drawn.
    assert.ok(straight > 0.7 * BLUE[n - 1] && straight < (n === 6 ? 1.3 : 1.1) * BLACK[n - 1], `hole ${n}: ${Math.round(straight)} yd tee-to-green vs card ${BLACK[n - 1]}/${BLUE[n - 1]}`);
    const b = buildHole(geo, n, { par: PAR[n - 1], yards: BLACK[n - 1] });
    assert.ok(b, `hole ${n} builds`);
    const area = ring2m2(b.green.ring);
    assert.ok(area > 300 && area < 1200, `hole ${n} green ${Math.round(area)} m²`);
    assert.ok(b.tees.length >= 2, `hole ${n} has tee boxes`);
    if (PAR[n - 1] >= 4) assert.ok(b.fairways.length >= 1, `hole ${n} has a fairway`);
    assert.ok(b.hazards.some((x) => x.type === "sand"), `hole ${n} has a bunker`);
    assert.equal(classify(b, b.green.center), "green", `hole ${n} green centre`);
    assert.equal(classify(b, { x: 0, y: 0 }), "tee", `hole ${n} tee origin`);
  }
});

test("D150: the creeks are water — buffered OSM centrelines — and the lidar woods line the holes", () => {
  const creeks = data.ways.filter((w) => w.q === "osm+buffer");
  assert.ok(creeks.length >= 4, `${creeks.length} creek pieces`);
  assert.ok(creeks.every((w) => w.tags.golf === "water_hazard"));
  const withWater = [...Array(18)].map((_, i) => buildHole(geo, i + 1, { par: PAR[i] })).filter((h) => h.hazards.some((x) => x.type === "water"));
  assert.ok(withWater.length >= 4, `${withWater.length} holes carry water`);
  const woods = data.ways.filter((w) => w.tags.natural === "wood" && w.q === "lidar");
  assert.ok(woods.length > 100, `${woods.length} lidar woods`);
  assert.match(data.source.woods, /GA_Statewide_B2_2018/);
  assert.equal(data.ways.filter((w) => w.tags.natural === "wood" && w.q === "osm").length, 0, "OSM's one wood relation is cut by the box and dropped; the lidar covers it");
});

test("D150: the 3DEP grid and the green grids ride the file", () => {
  const s = elevationSamples(data);
  assert.ok(s && s.length > 2000, `${s?.length} elevation samples`);
  const zs = s.map((p) => p.elevM);
  assert.ok(Math.min(...zs) > 300 && Math.max(...zs) < 400, "metres above sea level, the Etowah foothills");
  assert.equal(greenGrids(data).length, 18, "a lidar grid per green");
});

test("D150: the caddie advances hole to hole off the tee boxes", () => {
  for (let n = 1; n <= 18; n++) {
    const r = detectHole(geo, geo.holes[n].line[0], n === 1 ? 18 : n - 1);
    assert.equal(r.advanced, true, `hole ${n} advances`);
    assert.equal(r.hole, n);
  }
});

test("D150: a tee call on every par 4 and 5, and the Carry chip makes the same hole play longer", () => {
  const P = loadProfile(JSON.parse(readFileSync(join(here, "profile.json"), "utf8")), DEFAULT_CONFIG);
  for (let n = 1; n <= 18; n++) {
    if (PAR[n - 1] < 4) continue;
    const h = buildHole(geo, n, { par: PAR[n - 1], yards: BLACK[n - 1] });
    const r = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: PAR[n - 1], pinPos: "middle" }, h, P);
    assert.ok(r.safe && r.safe.club, `hole ${n} has a SAFE call`);
    assert.ok(r.safe.parProb > 0.05 && r.safe.parProb < 0.95, `hole ${n}: par chance ${r.safe.parProb}`);
    const short = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: PAR[n - 1], pinPos: "middle", carryPct: -10 }, h, P);
    assert.ok(short.context.playsLike > r.context.playsLike, `hole ${n}: plays longer 10% short`);
  }
});
