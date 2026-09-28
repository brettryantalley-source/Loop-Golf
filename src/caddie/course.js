/*
 * course.js — a hole in a local frame, in yards, and everything the engine asks of it
 * (spec §6.2 classification priority, §6.3 distances, §3.4 fat side and corridor).
 *
 * FRAME. x is lateral (+ right of the hole's centerline), y runs from the tee toward the green.
 * Everything is in yards. S2 projects OSM lat/lng into this frame around the tee; S1 uses
 * synthetic holes drawn directly in it (src/fixtures/synthetic-holes.js). The engine never
 * touches lat/lng, which keeps every rule testable in Node.
 *
 * A Hole is:
 *   { id, par, yards,
 *     tee: {x, y},
 *     green: { ring: [[x,y],…], center: {x, y} },
 *     fairways: [ring, …],                 // may be empty
 *     tees: [ring, …],                     // optional
 *     hazards: [{ type: 'water'|'sand'|'trees', ring }, …],
 *     boundary: ring | null }              // outside = OB; null = no OB anywhere
 *
 * Pure functions. No DOM, no storage, no network.
 */

export const LIE_PRIORITY = Object.freeze(["green", "sand", "water", "tee", "fairway", "trees", "rough", "ob"]);

/* Bounding boxes, computed once per ring. The simulation classifies ~40k points per recompute
   and most of them miss most rings, so the box test does the bulk of the work. */
const BBOX = new WeakMap();
function bboxOf(ring) {
  let b = BBOX.get(ring);
  if (b) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0], y = ring[i][1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  b = { x0, y0, x1, y1 };
  BBOX.set(ring, b);
  return b;
}

export function pointInRing(p, ring) {
  if (!ring || ring.length < 3) return false;
  const b = bboxOf(ring);
  if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) return false;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i], c = ring[j];
    const ay = a[1], cy = c[1];
    if ((ay > p.y) !== (cy > p.y) && p.x < ((c[0] - a[0]) * (p.y - ay)) / (cy - ay) + a[0]) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon with the §6.2 priority: green → sand → water → tee → fairway → trees → rough → OB. */
/** Inside the hazard's outer ring and not inside one of its inner rings (a clearing in a wood). */
function inHazard(p, h) {
  if (!pointInRing(p, h.ring)) return false;
  for (const r of h.inner || []) if (pointInRing(p, r)) return false;
  return true;
}

export function classify(hole, p) {
  if (pointInRing(p, hole.green.ring)) return "green";
  for (const h of hole.hazards || []) if (h.type === "sand" && inHazard(p, h)) return "sand";
  for (const h of hole.hazards || []) if (h.type === "water" && inHazard(p, h)) return "water";
  for (const r of hole.tees || []) if (pointInRing(p, r)) return "tee";
  for (const r of hole.fairways || []) if (pointInRing(p, r)) return "fairway";
  // A neighbouring hole's fairway or green is a fairway lie, not rough (geo.js buildHole fills `nearby`).
  for (const r of hole.nearby?.fairways || []) if (pointInRing(p, r)) return "fairway";
  for (const r of hole.nearby?.greens || []) if (pointInRing(p, r)) return "fairway";
  for (const h of hole.hazards || []) if (h.type === "trees" && inHazard(p, h)) return "trees";
  if (hole.boundary && !pointInRing(p, hole.boundary)) return "ob";
  return "rough";
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distances along the ray a → b where it crosses the ring's edges. */
function rayRingHits(a, b, ring) {
  const len = dist(a, b);
  if (len === 0) return [];
  const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
  const hits = [];
  for (let i = 0; i < ring.length; i++) {
    const [px, py] = ring[i], [qx, qy] = ring[(i + 1) % ring.length];
    const ex = qx - px, ey = qy - py;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const rx = px - a.x, ry = py - a.y;
    const t = (rx * ey - ry * ex) / den;
    const u = (rx * dy - ry * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1) hits.push(t);
  }
  return hits.sort((p, q) => p - q);
}

/**
 * §6.3 — front / center / back along the ball → green-center line, plus the pin for a pinPos.
 * pin: 'front' = one third of the way from front to back, 'middle' = center, 'back' = two thirds.
 */
export function greenDistances(hole, ball, pinPos = "middle") {
  const c = hole.green.center;
  const center = dist(ball, c);
  const hits = rayRingHits(ball, c, hole.green.ring);
  const front = hits.length ? hits[0] : Math.max(0, center - 12);
  const back = hits.length ? hits[hits.length - 1] : center + 12;
  // pinPos: 'front' | 'middle' | 'back' (thirds along the ball → center line) or a custom {x, y} point (UI addendum §6).
  const pin = isPoint(pinPos) ? dist(ball, pinPos)
    : pinPos === "front" ? front + (back - front) / 3 : pinPos === "back" ? front + (2 * (back - front)) / 3 : center;
  return { front: round1(front), center: round1(center), back: round1(back), pin: round1(pin), depth: round1(back - front) };
}

/** The point at `d` yards from `from` toward `to`. */
export function pointAlong(from, to, d) {
  const len = dist(from, to);
  if (len === 0) return { ...from };
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
}

const isPoint = (v) => v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number";

/** Pin position as a point, for a pinPos. A custom {x, y} pin is returned as given. */
export function pinPoint(hole, ball, pinPos = "middle") {
  if (isPoint(pinPos)) return { x: pinPos.x, y: pinPos.y };
  const g = greenDistances(hole, ball, pinPos);
  return pointAlong(ball, hole.green.center, g.pin);
}

function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = p.x - a[0], wy = p.y - a[1];
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2));
  return Math.hypot(p.x - (a[0] + t * vx), p.y - (a[1] + t * vy));
}

/** Distance from a point to the nearest edge of a ring (0 when inside). */
export function ringDistance(p, ring) {
  if (pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

export function ringBbox(ring) {
  return { ...bboxOf(ring) };
}

/**
 * §3.4 fat side: the point on the green farthest from the nearest hazard (water, sand, trees;
 * OB boundary counts too). Ties go to the point nearer the center. No hazards → the center.
 */
export function fatSide(hole, step = 2) {
  const hz = (hole.hazards || []).map((h) => h.ring);
  if (!hz.length && !hole.boundary) return { ...hole.green.center };
  const { x0, y0, x1, y1 } = ringBbox(hole.green.ring);
  let best = null;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const p = { x, y };
      if (!pointInRing(p, hole.green.ring)) continue;
      let d = Infinity;
      for (const r of hz) d = Math.min(d, ringDistance(p, r));
      if (hole.boundary) d = Math.min(d, boundaryDistance(p, hole.boundary));
      const dc = dist(p, hole.green.center);
      if (!best || d > best.d + 1e-9 || (Math.abs(d - best.d) <= 1e-9 && dc < best.dc)) best = { p, d, dc };
    }
  }
  return best ? best.p : { ...hole.green.center };
}

function boundaryDistance(p, ring) {
  // distance to the boundary edge from inside (outside → 0)
  if (!pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, segDist(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

/**
 * §3.4 corridor: the fairway's left and right edges on the line y = `y`, as [xLeft, xRight].
 * Unions every fairway ring; returns null when no fairway crosses that line.
 */
export function corridorAt(hole, y) {
  let xl = Infinity, xr = -Infinity;
  for (const ring of hole.fairways || []) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      if ((ay > y) !== (by > y)) {
        const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
        xl = Math.min(xl, x); xr = Math.max(xr, x);
      }
    }
  }
  return xl <= xr ? [xl, xr] : null;
}

/**
 * §3.5 water drop point: walk back from the landing point toward the ball until the point is no
 * longer water. Approximates the edge where the ball crossed into the hazard.
 */
export function waterEntry(hole, from, landing, step = 2) {
  const len = dist(from, landing);
  for (let d = step; d <= len; d += step) {
    const p = pointAlong(landing, from, d);
    if (classify(hole, p) !== "water") return p;
  }
  return { ...from };
}

/** Yards → feet, rounded. */
export const ydsToFt = (y) => y * 3;

function round1(x) { return Math.round(x * 10) / 10; }

/** Convenience: an axis-aligned rectangle ring. */
export function rect(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Convenience: an ellipse ring centred at (cx, cy) with semi-axes rx, ry. */
export function ellipse(cx, cy, rx, ry, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return out;
}
