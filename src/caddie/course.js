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

export function pointInRing(p, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > p.y) !== (by > p.y) && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon with the §6.2 priority: green → sand → water → tee → fairway → trees → rough → OB. */
export function classify(hole, p) {
  if (pointInRing(p, hole.green.ring)) return "green";
  for (const h of hole.hazards || []) if (h.type === "sand" && pointInRing(p, h.ring)) return "sand";
  for (const h of hole.hazards || []) if (h.type === "water" && pointInRing(p, h.ring)) return "water";
  for (const r of hole.tees || []) if (pointInRing(p, r)) return "tee";
  for (const r of hole.fairways || []) if (pointInRing(p, r)) return "fairway";
  for (const h of hole.hazards || []) if (h.type === "trees" && pointInRing(p, h.ring)) return "trees";
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
  const pin = pinPos === "front" ? front + (back - front) / 3 : pinPos === "back" ? front + (2 * (back - front)) / 3 : center;
  return { front: round1(front), center: round1(center), back: round1(back), pin: round1(pin), depth: round1(back - front) };
}

/** The point at `d` yards from `from` toward `to`. */
export function pointAlong(from, to, d) {
  const len = dist(from, to);
  if (len === 0) return { ...from };
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
}

/** Pin position as a point, for a pinPos. */
export function pinPoint(hole, ball, pinPos = "middle") {
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
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
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
