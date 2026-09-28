/*
 * synthetic-holes.js — the three fixture holes spec §10 asks for, drawn in the course.js frame
 * (yards; x lateral, +right; y from the tee toward the green). Plus a builder for variants.
 *
 *   openPar5      — 540 yds, 60-yd-wide fairway, deep green, no hazards, no OB.
 *   waterLeftPar4 — 410 yds, water down the entire left side from 200 to 340 yds off the tee.
 *   bunkeredPar3  — 175 yds, bunker guarding the front-right of the green, water long-left.
 */

import { rect, ellipse } from "../caddie/course.js";

function green(cx, cy, rx = 14, ry = 16) {
  return { ring: ellipse(cx, cy, rx, ry, 32), center: { x: cx, y: cy } };
}

export const openPar5 = {
  id: "open-par-5",
  par: 5,
  yards: 540,
  tee: { x: 0, y: 0 },
  green: green(0, 540),
  fairways: [rect(-30, 60, 30, 522)],
  tees: [rect(-6, -6, 6, 6)],
  hazards: [],
  boundary: null,
};

export const waterLeftPar4 = {
  id: "water-left-par-4",
  par: 4,
  yards: 410,
  tee: { x: 0, y: 0 },
  green: green(0, 410),
  fairways: [rect(-25, 60, 25, 392)],
  tees: [rect(-6, -6, 6, 6)],
  hazards: [{ type: "water", ring: rect(-90, 200, -28, 340) }],
  boundary: null,
};

/** Same hole with the water removed — the T9 control. */
export const noWaterPar4 = { ...waterLeftPar4, id: "no-water-par-4", hazards: [] };

export const bunkeredPar3 = {
  id: "bunkered-par-3",
  par: 3,
  yards: 175,
  tee: { x: 0, y: 0 },
  green: green(0, 175, 13, 14),
  fairways: [],
  tees: [rect(-6, -6, 6, 6)],
  hazards: [
    { type: "sand", ring: rect(2, 152, 24, 163) },
    { type: "water", ring: rect(-60, 186, -10, 230) },
  ],
  boundary: null,
};

/** A par 5 for the layup tests: same as openPar5 but with hazards passed in. */
export function par5With(hazards, extra = {}) {
  return { ...openPar5, id: "par-5-variant", hazards, ...extra };
}

export const ALL = [openPar5, waterLeftPar4, noWaterPar4, bunkeredPar3];
