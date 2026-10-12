/*
 * greenslope.js — v22.60 (R10, D131): reading a green from USGS lidar. Each bundled map carries a 2 m grid
 * over every green (scripts/fetch-green-slopes.mjs, `greenGrids`); this turns the one under a hole's green
 * into downhill arrows for the map and a one-line read of the putt (uphill / downhill, which way it breaks).
 *
 * Lidar is noisy at a few centimetres, which over 4 m is a percent of slope — as much as a green has. So the
 * slope at a spot is a plane fitted by least squares to the cells within 2 cells (an 8 m window), in the
 * hole's own frame (x right, y up the hole, yards), which also gives the direction without any compass
 * maths. Only cells on the green (its ring, plus a yard for the trace) go into a fit: near the edge an 8 m
 * window otherwise reaches onto the bank, and the bank is not what a putt rolls on (all five clubs: the
 * median arrow 6+ yds inside a green reads 1.7–2.7%, at the edge with the bank in it 1.9–3.6%).
 * Pure: no DOM, no storage, no network.
 */

import { pointInRing } from "./course.js";

const YD_M = 0.9144;
const WIN = 2;                 // the plane's half-window, cells (8 m across at 2 m)
const MIN_CELLS = 9;
const ON_GREEN_YDS = 1;        // a cell this close outside the green's ring still counts as green (the trace)

/**
 * The bundled grid under a hole's green: the one whose centroid sits nearest the green's centre, within
 * `maxYds`. grids = expanded greenGrids (localGeometry.js), F = the hole's frame. null when none is near.
 */
export function gridForGreen(grids, hole, F, maxYds = 25) {
  const c = hole?.green?.center;
  if (!Array.isArray(grids) || !grids.length || !c || !F) return null;
  let best = null;
  for (const g of grids) {
    const p = F.toFrame({ lat: g.c[0], lon: g.c[1] });
    const d = p ? Math.hypot(p.x - c.x, p.y - c.y) : Infinity;
    if (d <= maxYds && (!best || d < best.d)) best = { g, d };
  }
  return best ? best.g : null;
}

/** The grid's cells in the hole frame: Map "i,j" → { i, j, x, y, z (metres) }. Memoised per grid and frame. */
const SURF = new WeakMap();
export function surfaceOf(grid, F) {
  if (!grid || !F) return null;
  let byF = SURF.get(grid);
  if (!byF) { byF = new WeakMap(); SURF.set(grid, byF); }
  if (byF.has(F)) return byF.get(F);
  const cells = new Map();
  for (const c of grid.cells || []) {
    const p = F.toFrame({ lat: c.lat, lon: c.lon });
    if (p) cells.set(`${c.i},${c.j}`, { i: c.i, j: c.j, x: p.x, y: p.y, z: c.z });
  }
  const s = { cells, step: grid.stepM / YD_M };
  byF.set(F, s);
  return s;
}

/** Distance (yards) from p to a ring's edge. */
function edgeDist(p, ring) {
  let m = Infinity;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    const dx = xb - xa, dy = yb - ya, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - xa) * dx + (p.y - ya) * dy) / L));
    m = Math.min(m, Math.hypot(p.x - (xa + t * dx), p.y - (ya + t * dy)));
  }
  return m;
}

/** The cells that count as green for a ring: inside it, or within ON_GREEN_YDS of its edge. → Set of "i,j". */
function onGreen(S, ring) {
  const out = new Set();
  for (const [k, q] of S.cells) if (pointInRing(q, ring) || edgeDist(q, ring) <= ON_GREEN_YDS) out.add(k);
  return out;
}

/**
 * The plane under cell (i, j): z = a + b·x + c·y over the green's cells within WIN, frame yards. → { b, c }
 * (metres of rise per yard along x and y) or null with under MIN_CELLS around it.
 */
function planeAt(S, i, j, green) {
  const pts = [];
  for (let dj = -WIN; dj <= WIN; dj++) for (let di = -WIN; di <= WIN; di++) {
    const k = `${i + di},${j + dj}`;
    const q = S.cells.get(k);
    if (q && (!green || green.has(k))) pts.push(q);
  }
  if (pts.length < MIN_CELLS) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n, mz = pts.reduce((s, p) => s + p.z, 0) / n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of pts) {
    const x = p.x - mx, y = p.y - my, z = p.z - mz;
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < 1e-9) return null;
  return { b: (sxz * syy - syz * sxy) / det, c: (syz * sxx - sxz * sxy) / det };
}

/** Rise per yard (metres) → percent slope. */
const pctOf = (b, c) => (Math.hypot(b, c) / YD_M) * 100;
/** The downhill direction of a plane, a hole-frame bearing (degrees clockwise from +y). */
const downhillDeg = (b, c) => ((Math.atan2(-b, -c) * 180) / Math.PI + 360) % 360;

/**
 * Downhill arrows over the green: one every `every` cells, inside the green's ring, where the slope is at
 * least `minPct`. → [{ x, y, dirDeg, pct }] hole frame.
 */
export function slopeArrows(grid, hole, F, { every = 2, minPct = 0.5 } = {}) {
  const S = surfaceOf(grid, F);
  const ring = hole?.green?.ring;
  if (!S || !ring) return [];
  const green = onGreen(S, ring);
  const out = [];
  for (const q of S.cells.values()) {
    if (q.i % every || q.j % every) continue;
    if (!pointInRing(q, ring)) continue;
    const pl = planeAt(S, q.i, q.j, green);
    if (!pl) continue;
    const pct = pctOf(pl.b, pl.c);
    if (pct < minPct) continue;
    out.push({ x: q.x, y: q.y, dirDeg: Math.round(downhillDeg(pl.b, pl.c)), pct: Math.round(pct * 10) / 10 });
  }
  return out;
}

/** The plane at the cell nearest frame point p (within 2 cells), or null. */
function planeNear(S, p, green) {
  let best = null;
  for (const q of S.cells.values()) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { q, d };
  }
  return best && best.d <= 2 * S.step ? planeAt(S, best.q.i, best.q.j, green) : null;
}

/**
 * The putt from `ball` to `pin` (hole frame): the slope averaged along the line, split into along (+ up toward
 * the hole) and across (+ the ground rises to the right, so the ball breaks right to left). `ring` = the
 * green's ring (the fit keeps to the green; without one, every cell). → { alongPct, acrossPct, text } or null
 * without lidar under the line.
 */
export function puttRead(grid, F, ball, pin, ring = null) {
  const S = surfaceOf(grid, F);
  if (!S || !ball || !pin) return null;
  const green = ring ? onGreen(S, ring) : null;
  const L = Math.hypot(pin.x - ball.x, pin.y - ball.y);
  if (L < 0.5) return null;
  const u = { x: (pin.x - ball.x) / L, y: (pin.y - ball.y) / L }, right = { x: u.y, y: -u.x };
  const n = Math.max(2, Math.ceil(L));
  let sb = 0, sc = 0, k = 0;
  for (let t = 0; t <= n; t++) {
    const pl = planeNear(S, { x: ball.x + (u.x * L * t) / n, y: ball.y + (u.y * L * t) / n }, green);
    if (pl) { sb += pl.b; sc += pl.c; k++; }
  }
  if (k < 2) return null;
  const b = sb / k, c = sc / k;
  const alongPct = Math.round(((b * u.x + c * u.y) / YD_M) * 1000) / 10;
  const acrossPct = Math.round(((b * right.x + c * right.y) / YD_M) * 1000) / 10;
  return { alongPct, acrossPct, text: readText(alongPct, acrossPct) };
}

/** "Uphill 1.4% · breaks left to right 0.9%" — under 0.3% reads level / straight. */
export function readText(alongPct, acrossPct) {
  const a = Math.abs(alongPct), x = Math.abs(acrossPct);
  const along = a < 0.3 ? "Level" : `${alongPct > 0 ? "Uphill" : "Downhill"} ${a.toFixed(1)}%`;
  const across = x < 0.3 ? "straight" : `breaks ${acrossPct > 0 ? "right to left" : "left to right"} ${x.toFixed(1)}%`;
  return `${along} · ${across}`;
}
