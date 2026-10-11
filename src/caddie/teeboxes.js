/*
 * teeboxes.js — v22.50 (C41, D121): which tee each tee box most likely is.
 *
 * Brett, Oct 11: "shade each tee box the colour of the tee it most likely is (Gold / Blue / White /
 * Red), from its distance to the green against the card". OSM's tee polygons carry no tee name, so
 * each box is measured the way a card is — from the box to the green's centre along the hole's line —
 * and takes the card tee whose yardage is nearest, within `tolYds`. Pure; no DOM, no storage.
 */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const asXY = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p);

/** Centroid of a ring (area-weighted; the vertex mean for a degenerate one). */
export function ringCentroid(ring) {
  const pts = (ring || []).map(asXY).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], k = p.x * q.y - q.x * p.y;
    a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
  }
  if (Math.abs(a) < 1e-9) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Yards from a point to the green's centre the way a card measures it: to its nearest point on the
 * hole's line (hole frame), then along the line to its end, then to the green's centre. A hole with
 * no line gives the straight distance.
 */
export function yardsAlongHole(hole, p) {
  const G = hole?.green?.center;
  if (!p || !G) return null;
  const line = (hole.line || []).map(asXY);
  if (line.length < 2) return dist(p, G);
  let best = null, along = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], L = dist(a, b);
    const t = L > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (L * L))) : 0;
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const d = dist(p, q);
    if (!best || d < best.d) best = { d, s: along + t * L };
    along += L;
  }
  return along - best.s + dist(line[line.length - 1], G);
}

/** Each tee box's card-style yardage (null where it can't be measured), aligned with hole.tees. */
export function teeBoxYards(hole) {
  return (hole?.tees || []).map((r) => { const c = ringCentroid(r); return c ? yardsAlongHole(hole, c) : null; });
}

/** Combination tees ("Blue/White", "Combo") are not boxes on the ground, so they are not candidates. */
const COMBO = /\/|combo|hybrid|mixed/i;

/**
 * The card's tees for one hole: teeCard = [{ name, yards: [18] }] (Setup stores it on the course,
 * v22.50) → [{ name, yards }] for hole index `i` (0-based), longest first; no combos, no blanks, one
 * per name (the men's and women's lists repeat a tee).
 */
export function cardForHole(teeCard, i) {
  const seen = new Set(), out = [];
  for (const t of teeCard || []) {
    const name = String(t?.name || "").trim(), y = t?.yards?.[i];
    if (!name || COMBO.test(name) || !(y > 0) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, yards: y });
  }
  return out.sort((a, b) => b.yards - a.yards);
}

/**
 * The tee each box most likely is, aligned with hole.tees: the card tee whose yardage is nearest the
 * box's, within `tolYds` (else null). Two boxes may share a tee (a tee split in two); ties go to the
 * longer tee. → [name | null].
 */
export function assignTeeBoxes(hole, card, { tolYds = 20 } = {}) {
  const ys = teeBoxYards(hole);
  return ys.map((y) => {
    if (!Number.isFinite(y) || !card?.length) return null;
    let best = null;
    for (const t of card) {
      const d = Math.abs(t.yards - y);
      if (d <= tolYds && (!best || d < best.d - 1e-9)) best = { d, name: t.name };
    }
    return best ? best.name : null;
  });
}
