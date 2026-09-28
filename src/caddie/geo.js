/*
 * geo.js — OSM geometry → the engine's hole frame, plus lie inference, distances, hole detection,
 * the 27-hole nine mapping and the coverage check (caddie spec §6.1–§6.4, UI addendum §4.1, §6).
 *
 * FRAME (course.js): yards; origin = the tee end of the hole's golf=hole way; +y = the tee → green
 * bearing (first node → last node, UI addendum §4.1); +x = right of that line. Equirectangular
 * around the origin — at course scale (< 1 km) it agrees with haversine to well under a yard.
 *
 * Lat/lng in: { lat, lon } or { lat, lng } (geometry.js uses lon, the addendum uses lng).
 * Lat/lng out: { lat, lon }.
 *
 * Pure functions. Storage is injected (getItem / setItem); no DOM, no network.
 */

import {
  bearingDeg, haversineM, pointInRing as llPointInRing, distToRingM, YARDS_PER_METER,
  GEOMETRY_SCHEMA, compactGeometry,
} from "../geometry.js";
import { classify, greenDistances, pointInRing, pointAlong, dist, ringDistance } from "./course.js";

const R_EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const round1 = (x) => Math.round(x * 10) / 10;

/** Normalise {lat, lon|lng} → {lat, lon}. */
export function ll(p) {
  if (!p) return null;
  const lon = p.lon ?? p.lng;
  return Number.isFinite(p.lat) && Number.isFinite(lon) ? { lat: p.lat, lon } : null;
}
const isXY = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/* ---------- (a) the hole frame ---------- */

/**
 * holeFrame(centerline) or holeFrame({ origin, bearingDeg }) → { origin, bearingDeg, toFrame, toLatLng, ringToFrame }.
 * centerline = the golf=hole way's nodes, tee first (OSM convention, assumed — verify per course).
 */
export function holeFrame(src) {
  let origin, bearing;
  if (Array.isArray(src)) {
    if (src.length < 2) throw new Error("holeFrame: centerline needs ≥ 2 nodes");
    origin = ll(src[0]);
    bearing = bearingDeg(origin, ll(src[src.length - 1]));
  } else {
    origin = ll(src?.origin);
    bearing = src?.bearingDeg;
  }
  if (!origin || !Number.isFinite(bearing)) throw new Error("holeFrame: need an origin and a bearing");
  const k = Math.cos(rad(origin.lat));
  const s = Math.sin(rad(bearing)), c = Math.cos(rad(bearing));
  const yd = R_EARTH * YARDS_PER_METER;           // yards per radian
  const toFrame = (p) => {
    const q = ll(p);
    const e = rad(q.lon - origin.lon) * yd * k, n = rad(q.lat - origin.lat) * yd;
    return { x: e * c - n * s, y: e * s + n * c };
  };
  const toLatLng = ({ x, y }) => {
    const e = x * c + y * s, n = -x * s + y * c;
    return { lat: origin.lat + deg(n / yd), lon: origin.lon + deg(e / (yd * k)) };
  };
  const ringToFrame = (ring) => (ring || []).map((p) => { const q = toFrame(p); return [q.x, q.y]; });
  return { origin, bearingDeg: bearing, toFrame, toLatLng, ringToFrame };
}

/** The frame a built Hole was made in (buildHole stores origin + bearingDeg on it). */
export function frameOf(hole) {
  return hole && hole.origin && Number.isFinite(hole.bearingDeg) ? holeFrame({ origin: hole.origin, bearingDeg: hole.bearingDeg }) : null;
}

/** A point in the hole frame from either {x,y} or lat/lng. */
function toXY(hole, p, F = frameOf(hole)) {
  if (isXY(p)) return { x: p.x, y: p.y };
  const q = ll(p);
  return q && F ? F.toFrame(q) : null;
}

/** Area centroid of an [[x,y]] ring (vertex mean when degenerate). */
export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return { x: ring.reduce((s, p) => s + p[0], 0) / ring.length, y: ring.reduce((s, p) => s + p[1], 0) / ring.length };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/* ---------- (b) buildHole ---------- */

/** Features this far (yards) from the hole's line or green come along even when assigned elsewhere. */
export const NEAR_YDS = 100;
const HAZARD_TYPE = { bunker: "sand", water: "water", water_hazard: "water", lateral_water_hazard: "water" };

function lineSamplesXY(lineXY, step = 10) {
  const out = [];
  for (let i = 0; i < lineXY.length - 1; i++) {
    const a = lineXY[i], b = lineXY[i + 1], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push(pointAlong(a, b, (dist(a, b) * k) / n));
  }
  out.push(lineXY[lineXY.length - 1]);
  return out;
}
const nearSamples = (ring, samples) => samples.reduce((m, s) => (m === 0 ? 0 : Math.min(m, ringDistance(s, ring))), Infinity);

/**
 * A course.js Hole for one OSM hole (key = the geometry's hole key, normally the ref number).
 * Returns null when the hole has no centreline or no green (club-brain mode, spec §6.1).
 * par / yards come from golfcourseapi (authoritative); OSM par and the centreline length are fallbacks.
 * Extra fields course.js ignores: key, ref, origin, bearingDeg, line, roughs, nearby {fairways, greens},
 * and `inner` rings on hazards (a clearing inside a wood — see inferLie).
 */
export function buildHole(geometry, holeRef, { par, yards, nearYds = NEAR_YDS } = {}) {
  const h = geometry?.holes?.[holeRef];
  if (!h || !Array.isArray(h.line) || h.line.length < 2 || !h.green?.ring || h.green.ring.length < 3) return null;
  const key = h.key ?? h.ref ?? holeRef;
  const F = holeFrame(h.line);
  const line = h.line.map(F.toFrame);
  const greenRing = F.ringToFrame(h.green.ring);
  const green = { ring: greenRing, center: ringCentroid(greenRing) };
  const samples = [...lineSamplesXY(line), green.center];
  const own = (x) => (x.holeRefs || []).some((r) => String(r) === String(key));
  // cheap reject: a feature whose lat/lon box is farther than nearYds from the hole's box
  const hb = bboxOf([...h.line, ...h.green.ring].map(ll));
  const padDeg = (nearYds / YARDS_PER_METER / R_EARTH) * (180 / Math.PI);
  const far = (x) => !nearBbox(x, { lat: (hb.s + hb.n) / 2, lon: (hb.w + hb.e) / 2 }, padDeg + (hb.n - hb.s) / 2, (hb.e - hb.w) / 2);
  const keep = (x, ring) => own(x) || nearSamples(ring, samples) <= nearYds;

  const fairways = [], tees = [], roughs = [], hazards = [], nearbyFairways = [], nearbyGreens = [];
  for (const f of geometry.features || []) {
    if (!own(f) && far(f)) continue;
    const ring = F.ringToFrame(f.ring);
    if (f.kind === "fairway") {
      if (own(f)) fairways.push(ring);
      else if (nearSamples(ring, samples) <= nearYds) nearbyFairways.push(ring);
    } else if (!keep(f, ring)) continue;
    else if (f.kind === "tee") tees.push(ring);
    else if (f.kind === "rough") roughs.push(ring);
    else if (f.kind === "trees") hazards.push({ type: "trees", ring, ...(f.inner?.length ? { inner: f.inner.map(F.ringToFrame) } : {}) });
  }
  for (const t of geometry.trouble || []) {
    const type = HAZARD_TYPE[t.kind];
    if (!type) continue;                                            // golf=out_of_bounds lines: OB comes from the boundary
    if (!own(t) && far(t)) continue;
    const ring = F.ringToFrame(t.ring);
    if (keep(t, ring)) hazards.push({ type, ring });
  }
  // other holes' greens (and practice greens) near this one: a ball there is not "green" for this hole
  const otherGreens = [
    ...Object.values(geometry.holes).filter((o) => o !== h && o.green?.ring).map((o) => o.green.ring),
    ...(geometry.greens || []).filter((g) => !(g.holeRefs || []).length).map((g) => g.ring),
  ];
  for (const r of otherGreens) { const ring = F.ringToFrame(r); if (nearSamples(ring, samples) <= nearYds) nearbyGreens.push(ring); }

  let boundary = null;
  const b = geometry.boundary;
  if (b) {
    const rings = b.rings?.length ? b.rings : [b.ring];
    const pick = rings.find((r) => llPointInRing(h.line[0], r) || llPointInRing(h.green.center, r)) || b.ring;
    boundary = F.ringToFrame(pick);
  }
  let len = 0;
  for (let i = 0; i < line.length - 1; i++) len += dist(line[i], line[i + 1]);
  return {
    id: key, key, ref: h.ref ?? null,
    par: par ?? h.par ?? null,
    yards: yards ?? Math.round(len),
    tee: { x: 0, y: 0 },
    green, fairways, tees, hazards, boundary,
    roughs, nearby: { fairways: nearbyFairways, greens: nearbyGreens },
    origin: F.origin, bearingDeg: F.bearingDeg, line,
  };
}

/* ---------- (c) lie inference ---------- */

/** classify → the engine's lieType (tee | fairway | rough | sand | recovery | green). */
const LIE_TYPE = { green: "green", sand: "sand", tee: "tee", fairway: "fairway", rough: "rough", trees: "recovery", water: "rough", ob: "rough" };
const CHIP_LIES = new Set(["tee", "fairway", "rough", "sand", "recovery", "green"]);
export const OVERRIDE_RADIUS_M = 15;
export const OVERRIDE_MIN_COUNT = 2;
export const LOW_ACCURACY_M = 8;
export const EDGE_MIN_M = 5;

/**
 * §5.6 — the corrected lie that applies at `p`, or null. Needs ≥ 2 corrections to the same value
 * within 15 m of each other (and of p) on the same course. Most corrections wins, then the newest.
 */
export function overrideAt(overrides, p, courseId, { radiusM = OVERRIDE_RADIUS_M, minCount = OVERRIDE_MIN_COUNT } = {}) {
  const q = ll(p);
  if (!q || !Array.isArray(overrides)) return null;
  const groups = new Map();
  for (const o of overrides) {
    const g = ll(o?.gps);
    const v = typeof o?.corrected === "string" ? o.corrected.toLowerCase() : null;
    if (!g || !CHIP_LIES.has(v)) continue;
    if (courseId != null && o.courseId != null && String(o.courseId) !== String(courseId)) continue;
    if (haversineM(g, q) > radiusM) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push({ g, ts: String(o.ts ?? "") });
  }
  let best = null;
  for (const [value, list] of groups) {
    if (list.length < minCount) continue;
    let paired = false;
    for (let i = 0; i < list.length && !paired; i++) for (let j = i + 1; j < list.length; j++) if (haversineM(list[i].g, list[j].g) <= radiusM) { paired = true; break; }
    if (!paired) continue;
    const latest = list.reduce((m, x) => (x.ts > m ? x.ts : m), "");
    if (!best || list.length > best.count || (list.length === best.count && latest > best.latest)) best = { value, count: list.length, latest };
  }
  return best ? { value: best.value, count: best.count } : null;
}

/** classify with two refinements: a point in a hazard's inner ring (a clearing) is not in it; a mapped rough polygon is never OB. */
export function classifyLie(lh, p) {
  const hz = lh.hazards || [];
  const live = hz.filter((h) => !(h.inner && h.inner.some((r) => pointInRing(p, r))));
  let c = classify(live.length === hz.length ? lh : { ...lh, hazards: live }, p);
  if (c === "ob" && (lh.roughs || []).some((r) => pointInRing(p, r))) c = "rough";
  return c;
}

const bboxOf = (ring) => ring.reduce((b, p) => ({ s: Math.min(b.s, p.lat), n: Math.max(b.n, p.lat), w: Math.min(b.w, p.lon), e: Math.max(b.e, p.lon) }), { s: Infinity, n: -Infinity, w: Infinity, e: -Infinity });
const BBOX = new WeakMap();
/** Is q within padDeg (+ an extra lon half-extent) of feature f's box? Boxes are cached per feature. */
function nearBbox(f, q, padDeg, extraLonDeg = 0) {
  let b = BBOX.get(f);
  if (!b) { b = bboxOf(f.ring); BBOX.set(f, b); }
  const padLon = padDeg / Math.max(0.2, Math.cos(rad(q.lat))) + extraLonDeg;
  return q.lat >= b.s - padDeg && q.lat <= b.n + padDeg && q.lon >= b.w - padLon && q.lon <= b.e + padLon;
}

/** The hole plus everything a ball could be sitting in near p: nearby fairways / greens count as fairway. */
function lieHoleAt(hole, geometry, q, radiusYds) {
  const lh = {
    green: hole.green,
    fairways: [...(hole.fairways || []), ...(hole.nearby?.fairways || []), ...(hole.nearby?.greens || [])],
    tees: [...(hole.tees || [])],
    hazards: [...(hole.hazards || [])],
    roughs: [...(hole.roughs || [])],
    boundary: hole.boundary ?? null,
  };
  const F = frameOf(hole);
  if (geometry && F && q) {
    // the ball can be well off this hole's corridor (on another hole): pull in whatever is under it
    const pad = ((radiusYds + 5) / YARDS_PER_METER / R_EARTH) * (180 / Math.PI);
    for (const f of geometry.features || []) {
      if (!nearBbox(f, q, pad)) continue;
      const ring = F.ringToFrame(f.ring);
      if (f.kind === "fairway") lh.fairways.push(ring);
      else if (f.kind === "tee") lh.tees.push(ring);
      else if (f.kind === "rough") lh.roughs.push(ring);
      else if (f.kind === "trees") lh.hazards.push({ type: "trees", ring, ...(f.inner?.length ? { inner: f.inner.map(F.ringToFrame) } : {}) });
    }
    for (const t of geometry.trouble || []) {
      const type = HAZARD_TYPE[t.kind];
      if (type && nearBbox(t, q, pad)) lh.hazards.push({ type, ring: F.ringToFrame(t.ring) });
    }
    const own = hole.green;
    for (const o of Object.values(geometry.holes || {})) {
      if (!o.green?.ring || !nearBbox(o.green, q, pad)) continue;
      const ring = F.ringToFrame(o.green.ring);
      if (!own || Math.hypot(ringCentroid(ring).x - own.center.x, ringCentroid(ring).y - own.center.y) > 1) lh.fairways.push(ring);
    }
  }
  return lh;
}

/**
 * §6.2 lie at a point. point = {lat, lng|lon} (a GPS fix) or {x, y} in the hole frame.
 * opts: { accuracyM, overrides (shotlog.js entries), courseId }.
 * Returns { lie: classify's value (green|sand|water|tee|fairway|trees|rough|ob),
 *           lieType: the engine's value (trees → recovery; water / ob → rough, flagged in `penalty`),
 *           lieConfidence: "high" | "low", source: "override" | "polygon", penalty: null | "water" | "ob" }.
 */
export function inferLie(hole, geometry, point, { accuracyM = 0, overrides = [], courseId = null } = {}) {
  const F = frameOf(hole);
  const p = toXY(hole, point, F);
  if (!p) return { lie: null, lieType: null, lieConfidence: "low", source: "none", penalty: null };
  const q = isXY(point) ? (F ? F.toLatLng(point) : null) : ll(point);
  const acc = Number.isFinite(accuracyM) ? accuracyM : 0;
  const lowAcc = acc > LOW_ACCURACY_M;

  const o = q ? overrideAt(overrides, q, courseId) : null;
  if (o) {
    const lie = o.value === "recovery" ? "trees" : o.value;
    return { lie, lieType: o.value, lieConfidence: lowAcc ? "low" : "high", source: "override", penalty: null, overrideCount: o.count };
  }

  const rYds = Math.max(acc, EDGE_MIN_M) * YARDS_PER_METER;
  const lh = lieHoleAt(hole, geometry, q, rYds);
  const lie = classifyLie(lh, p);
  // an edge within r whose other side is a different lie: probe a ring of points at r and r/2
  let edge = false;
  for (const f of [1, 0.5]) {
    for (let i = 0; i < 16 && !edge; i++) {
      const a = (i * Math.PI) / 8;
      if (classifyLie(lh, { x: p.x + rYds * f * Math.cos(a), y: p.y + rYds * f * Math.sin(a) }) !== lie) edge = true;
    }
  }
  const penalty = lie === "water" || lie === "ob" ? lie : null;
  return { lie, lieType: LIE_TYPE[lie], lieConfidence: lowAcc || edge || penalty ? "low" : "high", source: "polygon", penalty };
}

/* ---------- (d) distances and the pin ---------- */

/** A point clamped inside the green ring: itself when inside, else just inside the nearest edge. */
export function clampToGreen(hole, p) {
  const ring = hole.green.ring, c = hole.green.center;
  if (pointInRing(p, ring)) return { x: p.x, y: p.y };
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.y - ay) * vy) / l2));
    const q = { x: ax + t * vx, y: ay + t * vy }, d = dist(p, q);
    if (!best || d < best.d) best = { q, d };
  }
  // step toward the centre until strictly inside (0.25 yd steps; the centre itself as a last resort)
  const span = dist(best.q, c);
  for (let s = 0.25; s < span; s += 0.25) {
    const r = pointAlong(best.q, c, s);
    if (pointInRing(r, ring)) return r;
  }
  return { x: c.x, y: c.y };
}

/** UI addendum §4.1 / §6: a map tap sets the pin when it is on the green or within 3 yds of it; else null. */
export function pinFromTap(hole, point, maxOutsideYds = 3) {
  const p = toXY(hole, point);
  if (!p) return null;
  return ringDistance(p, hole.green.ring) <= maxOutsideYds ? clampToGreen(hole, p) : null;
}

/**
 * §6.3 + addendum §6. pinPos = "front" | "middle" | "back" | {x,y} | {lat,lng}. A custom pin is
 * clamped inside the green. Returns { front, center, back, pin, depth, pinPoint: {x,y}, pinPos }.
 */
export function distances(hole, point, pinPos = "middle") {
  const ball = toXY(hole, point);
  if (!ball) return null;
  const custom = pinPos && typeof pinPos === "object" ? toXY(hole, pinPos) : null;
  if (custom) {
    const pinPoint = clampToGreen(hole, custom);
    const g = greenDistances(hole, ball, "middle");
    return { ...g, pin: round1(dist(ball, pinPoint)), pinPoint, pinPos: "custom" };
  }
  const preset = ["front", "middle", "back"].includes(pinPos) ? pinPos : "middle";
  const g = greenDistances(hole, ball, preset);
  return { ...g, pinPoint: pointAlong(ball, hole.green.center, g.pin), pinPos: preset };
}

/* ---------- (e) hole detection ---------- */

export const TEE_DETECT_M = 30;

function holeKeys(geometry) {
  return Object.values(geometry?.holes || {}).map((h) => h.key ?? h.ref)
    .sort((a, b) => (parseInt(a, 10) - parseInt(b, 10)) || String(a).localeCompare(String(b)));
}

/** Metres from p to hole `key`'s tee: its tee polygons, else (none mapped) the centreline's tee end. */
function teeDistanceM(geometry, key, q) {
  const tees = (geometry.features || []).filter((f) => f.kind === "tee" && (f.holeRefs || []).some((r) => String(r) === String(key)));
  if (tees.length) return Math.min(...tees.map((t) => distToRingM(q, t.ring)));
  const h = Object.values(geometry.holes || {}).find((x) => String(x.key ?? x.ref) === String(key));
  return h?.line?.length ? haversineM(q, h.line[0]) : Infinity;
}

/**
 * §6.4 — called on "I'm on the tee". Advances to the NEXT hole when the fix is inside or within
 * 30 m of that hole's tee; otherwise stays. `order` = hole keys in playing order (from the nine map
 * on 27-hole clubs); default ascending refs, wrapping 18 → 1. currentHole null (round start) → the
 * hole whose tee is nearest within 30 m, else null.
 * Returns { hole, advanced, distanceM }.
 */
export function detectHole(geometry, point, currentHole, { order = null, radiusM = TEE_DETECT_M } = {}) {
  const q = ll(point);
  const keys = (order && order.length ? order : holeKeys(geometry)).map(String);
  if (!q || !keys.length) return { hole: currentHole ?? null, advanced: false, distanceM: null };
  const back = (k) => { const n = Number(k); return Number.isInteger(n) && String(n) === k ? n : k; };
  if (currentHole == null) {
    let best = null;
    for (const k of keys) { const d = teeDistanceM(geometry, k, q); if (d <= radiusM && (!best || d < best.d)) best = { k, d }; }
    return best ? { hole: back(best.k), advanced: true, distanceM: round1(best.d) } : { hole: null, advanced: false, distanceM: null };
  }
  const i = keys.indexOf(String(currentHole));
  if (i < 0) return { hole: currentHole, advanced: false, distanceM: null };
  const next = keys[(i + 1) % keys.length];
  const d = teeDistanceM(geometry, next, q);
  return d <= radiusM
    ? { hole: back(next), advanced: true, distanceM: round1(d) }
    : { hole: currentHole, advanced: false, distanceM: Number.isFinite(d) ? round1(d) : null };
}

/* ---------- (f) 27-hole nine mapping ---------- */

export const nineMapKey = (courseId) => `bogeyman-matches:nineMap:v1:${courseId}`;

/** True when the OSM holes can't be read as one 18: more than 18 ways, a ref above 18, or a repeated ref. */
export function needsNineMap(geometry) {
  const hs = Object.values(geometry?.holes || {});
  return hs.length > 18 || hs.some((h) => h.ref > 18) || new Set(hs.map((h) => h.ref)).size < hs.length;
}

/** The OSM holes the mapping screen pairs with {nine, hole}. */
export function nineMapCandidates(geometry) {
  return Object.values(geometry?.holes || {}).map((h) => ({ key: h.key ?? h.ref, ref: h.ref, name: h.name ?? null, hasGreen: !!h.green }));
}

/** map: { [osmHoleKey]: { nine, hole } }. Returns true when written. */
export function saveNineMap(storage, courseId, map) {
  if (!storage || courseId == null || !map || typeof map !== "object") return false;
  try { storage.setItem(nineMapKey(courseId), JSON.stringify({ v: 1, map })); return true; } catch { return false; }
}

export function loadNineMap(storage, courseId) {
  if (!storage || courseId == null) return null;
  try {
    const raw = storage.getItem(nineMapKey(courseId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    const map = o && o.v === 1 ? o.map : null;
    return map && typeof map === "object" && Object.keys(map).length ? map : null;
  } catch { return null; }
}

/** T15: prompt only when the course needs a mapping AND none is saved for it. */
export function nineMapPromptNeeded(geometry, storage, courseId) {
  return needsNineMap(geometry) && !loadNineMap(storage, courseId);
}

/* ---------- (f2) the nine map from the chosen routing (v22.7) ----------
   Setup now knows which two nines are being played (the routing). A routing here is
   { play: [a, b], club: [a, b, c], ordered } — the two nines in play order, the club's nines, and
   whether `club` is in OSM-number order (true only for a 27-hole API tee cut into holes 1–9 /
   10–18 / 19–27). A string "Village / School" is read as { play: ["Village", "School"] }.
   Nines in a saved map are always labelled "1" / "2" / "3" (D24); the names travel as
   `_nines: { name: label }` beside `_play`, so a later round on another routing of the same club
   finds its own `_play` without asking again. */

function normRouting(routing) {
  if (typeof routing === "string") {
    const play = routing.split("/").map((s) => s.trim()).filter(Boolean);
    return play.length === 2 ? { play, club: play, ordered: false } : null;
  }
  const play = Array.isArray(routing?.play) ? routing.play.map((s) => String(s).trim()) : null;
  if (!play || play.length !== 2 || !play[0] || !play[1] || play[0] === play[1]) return null;
  const club = Array.isArray(routing.club) && routing.club.length ? routing.club.map((s) => String(s).trim()) : play;
  return { play, club: club.includes(play[0]) && club.includes(play[1]) ? club : play, ordered: !!routing.ordered };
}
const NINE_LABELS = ["1", "2", "3"];
const isLabel = (s) => NINE_LABELS.includes(String(s));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text, w) => new RegExp(`(^|[^\\p{L}])${escRe(w.toLowerCase())}($|[^\\p{L}])`, "u").test(String(text).toLowerCase());

/* Hole-within-nine for a candidate: from a ref 1–27, else the first 1–9 in its name. */
function holeInNine(c) {
  const r = Number(c.ref);
  if (Number.isInteger(r) && r >= 1 && r <= 27) return ((r - 1) % 9) + 1;
  const m = String(c.name || "").match(/(?:^|\D)([1-9])(?:\D|$)/);
  return m ? Number(m[1]) : null;
}

/* Every hole 1–9 of each nine in `labels` present exactly once. */
function ninesComplete(map, labels) {
  return labels.every((lab) => {
    const hs = Object.values(map).filter((v) => v && v.nine === lab).map((v) => v.hole);
    return hs.length === 9 && new Set(hs).size === 9 && hs.every((h) => h >= 1 && h <= 9);
  });
}

/**
 * The nine map for this geometry + routing, when it can be read off confidently; else null.
 * - Named: OSM hole names carrying the nine words ("Village 3", "School - 7") → those nines.
 * - Numbered: OSM refs 1–27, each once → nines 1 / 2 / 3; the played pair is known when the
 *   routing's nines are themselves "1"/"2"/"3", or `ordered` says which name is which number.
 * Anything else (refs 1–9 three times, word nines on a 1–27 map, gaps) → null: the screen asks.
 */
export function nineMapFromRouting(geometry, routing) {
  const r = normRouting(routing);
  const cands = nineMapCandidates(geometry);
  if (!r || !cands.length) return null;

  // (a) named nines — the words are in the OSM hole names
  const words = r.club.filter((w) => !isLabel(w));
  if (words.length >= 2) {
    const labelOf = Object.fromEntries(r.club.map((w, i) => [w, NINE_LABELS[i]]));
    const named = {};
    for (const c of cands) {
      if (!c.name) continue;
      const hits = r.club.filter((w) => !isLabel(w) && hasWord(c.name, w));
      const h = holeInNine(c);
      if (hits.length === 1 && h != null && labelOf[hits[0]]) named[c.key] = { nine: labelOf[hits[0]], hole: h };
    }
    const play = r.play.map((w) => labelOf[w]);
    if (play.every(Boolean) && ninesComplete(named, play)) return { ...named, _play: play, _nines: labelOf };
  }

  // (b) numbered 1–27, each ref once
  const refs = cands.map((c) => Number(c.ref));
  const unique = refs.every((n) => Number.isInteger(n) && n >= 1 && n <= 27) && new Set(refs).size === refs.length;
  if (!unique) return null;
  const numbered = {};
  for (const c of cands) { const n = Number(c.ref); numbered[c.key] = { nine: NINE_LABELS[Math.ceil(n / 9) - 1], hole: ((n - 1) % 9) + 1 }; }
  let play = null, names = null;
  if (r.play.every(isLabel)) play = r.play.map(String);
  else if (r.ordered && r.club.length === 3) {
    names = Object.fromEntries(r.club.map((w, i) => [w, NINE_LABELS[i]]));
    play = r.play.map((w) => names[w]);
  }
  if (!play || !play.every(Boolean) || !ninesComplete(numbered, play)) return null;
  return { ...numbered, _play: play, ...(names ? { _nines: names } : {}) };
}

/** `_play` for this routing from a saved map's `_nines` (or numeric nine names); null when unknown. */
export function playFromRouting(map, routing) {
  const r = normRouting(routing);
  if (!r || !map) return null;
  const names = map._nines && typeof map._nines === "object" ? map._nines : null;
  if (names && names[r.play[0]] && names[r.play[1]] && names[r.play[0]] !== names[r.play[1]]) return [names[r.play[0]], names[r.play[1]]];
  if (r.play.every(isLabel)) return r.play.map(String);
  return null;
}

/**
 * `_nines` from what Brett picked on the mapping screen: the routing's two nines are the two he
 * chose; with three club nines, the third gets the remaining label. null when it can't be said.
 */
export function ninesAssociation(play, routing) {
  const r = normRouting(routing);
  if (!r || !Array.isArray(play) || play.length !== 2 || play[0] === play[1] || r.play.every(isLabel)) return null;
  const out = { [r.play[0]]: String(play[0]), [r.play[1]]: String(play[1]) };
  const rest = r.club.filter((w) => !(w in out));
  const free = NINE_LABELS.filter((l) => !Object.values(out).includes(l));
  if (rest.length === 1 && free.length === 1) out[rest[0]] = free[0];
  return out;
}

/** A first guess for the mapping screen's front/back when nothing is confident. */
export function guessPlay(routing) {
  const r = normRouting(routing);
  if (!r) return ["1", "2"];
  if (r.play.every(isLabel)) return r.play.map(String);
  const i = r.club.indexOf(r.play[0]), j = r.club.indexOf(r.play[1]);
  return i >= 0 && j >= 0 && i < 3 && j < 3 && i !== j ? [NINE_LABELS[i], NINE_LABELS[j]] : ["1", "2"];
}

/** The OSM hole key for {nine, hole}, or null. */
export function holeKeyFor(map, nine, hole) {
  for (const [k, v] of Object.entries(map || {})) if (v && v.nine === nine && Number(v.hole) === Number(hole)) return k;
  return null;
}

/** OSM keys in playing order for the chosen nines, e.g. ["Ridge", "Valley"] — feed to detectHole's `order`. */
export function playingOrder(map, nines) {
  const out = [];
  for (const n of nines || []) for (let h = 1; h <= 9; h++) { const k = holeKeyFor(map, n, h); if (k != null) out.push(k); }
  return out;
}

/* ---------- (g) coverage ---------- */

/**
 * §6.1 — a hole is missing when it has no golf=hole way or no green polygon.
 * expected = the hole keys that should exist; default 1…max(18, highest ref).
 * Returns { complete, missing, reasons: { [key]: "no hole way" | "no green" }, orphanGreens, message }.
 */
export function coverageCheck(geometry, { expected } = {}) {
  const hs = geometry?.holes || {};
  const refs = Object.values(hs).map((h) => h.ref).filter(Number.isInteger);
  const n = Math.max(18, ...refs);
  const want = expected || [...Array.from({ length: n }, (_, i) => i + 1), ...Object.keys(hs).filter((k) => k.includes("@"))];
  const missing = [], reasons = {};
  for (const k of want) {
    const h = hs[k];
    if (!h || !Array.isArray(h.line) || h.line.length < 2) { missing.push(k); reasons[k] = "no hole way"; }
    else if (!h.green?.ring || h.green.ring.length < 3) { missing.push(k); reasons[k] = "no green"; }
  }
  const orphanGreens = (geometry?.greens || []).filter((g) => !(g.holeRefs || []).length).length;
  return { complete: missing.length === 0, missing, reasons, orphanGreens, message: missing.length ? `Geometry incomplete: holes ${missing.join(", ")}.` : null };
}

/* ---------- cache (bogeyman-matches:geo:v1:{apiId}, decision 1 Sep 28) ---------- */

export const geoCacheKey = (apiId) => `bogeyman-matches:geo:v1:${apiId}`;

/** Store the compact geometry (+ elevation samples, §6.5). Returns true when written. */
export function saveGeometryCache(storage, apiId, geometry, elevation = null) {
  if (!storage || apiId == null || !geometry) return false;
  try {
    storage.setItem(geoCacheKey(apiId), JSON.stringify({ ...compactGeometry(geometry), elevation }));
    return true;
  } catch { return false; }
}

/** The cached geometry, or null when absent, unreadable or from an older schema (re-fetch then). */
export function loadGeometryCache(storage, apiId) {
  if (!storage || apiId == null) return null;
  try {
    const raw = storage.getItem(geoCacheKey(apiId));
    const g = raw ? JSON.parse(raw) : null;
    return g && g.schema >= GEOMETRY_SCHEMA && g.holes ? g : null;
  } catch { return null; }
}

