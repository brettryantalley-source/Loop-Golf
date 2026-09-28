/*
 * greens.js — "marked green" mode (v22.11): the caddie on a hole with no OpenStreetMap geometry.
 *
 * Satellite tiles work anywhere; what an unmapped hole lacks is a frame. Brett taps the green on
 * the satellite once, the tap is stored per course + hole, and from then on every ball position
 * gets a synthetic hole for the engine: the club-brain idea (caddieState.js `syntheticHole`: a
 * 40-yd fairway corridor, a 28 deep × 24 wide green, no hazards, no OB) laid down on the line
 * ball → marked green and anchored in lat/lon so the map, the ellipses and the camera project over
 * the satellite exactly as they do on a mapped hole.
 *
 * FRAMES
 *   synthetic hole frame — geo.js holeFrame with origin = the ball and bearing = ball → green, so
 *     +y runs ball → green (what the engine's corridor / layup candidates assume) and the camera
 *     is hole-up. Rebuilt for every ball position.
 *   anchor frame — north-up, origin = a fixed point for the course rounded to 0.01°. The caddie
 *     reducer stores `ballXY` and the previous-shot lines in whatever frame the caller hands it;
 *     the synthetic frame moves with the ball, so on an unmapped hole those go in this one, and
 *     are carried into the synthetic frame for drawing (`toSyntheticFrame`).
 *
 * Storage (`bogeyman-matches:greens:v1`, reserved in CLAUDE.md "Persistence" as "marked greens"):
 *   { [courseId]: { [holeKey]: { lat, lon, t } } }
 * Injected like shotlog.js (anything with getItem / setItem); every read and write degrades to
 * empty / no-op rather than throwing. The rest of this module is pure: no DOM, no network.
 */

import { rect, ellipse, dist, classify } from "./course.js";
import { holeFrame, ll } from "./geo.js";
import { haversineM, bearingDeg, YARDS_PER_METER } from "../geometry.js";
import { assembleShotContext } from "./context.js";

export const GREENS_KEY = "bogeyman-matches:greens:v1";
/** Pin presets on a marked green sit this far along ball → green from its centre (front −, back +). */
export const MARKED_PIN_PRESET_YDS = 10;
/** The synthetic green: 28 yds deep (along the line) × 24 wide, as club-brain's. */
export const MARKED_GREEN_DEPTH = 28, MARKED_GREEN_WIDTH = 24;
export const MARKED_FAIRWAY_HALF = 20;
/** A long-press within this many yards of the marked green re-opens the mark view. */
export const REMARK_RADIUS_YDS = 15;

export const NOTE_NO_HAZARDS = "No hazards on this map — the caddie prices distance only.";

/* ---------- the store ---------- */

function readAll(storage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GREENS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

const validGreen = (g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon) && Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180;

/** Every marked green, validated: { [courseId]: { [holeKey]: { lat, lon, t } } }. */
export function loadGreens(storage) {
  const all = readAll(storage), out = {};
  for (const [c, holes] of Object.entries(all)) {
    if (!holes || typeof holes !== "object") continue;
    for (const [h, g] of Object.entries(holes)) {
      if (!validGreen(g)) continue;
      (out[c] ||= {})[h] = { lat: g.lat, lon: g.lon, t: Number.isFinite(g.t) ? g.t : null };
    }
  }
  return out;
}

/** The marked green for one course + hole, or null. `greens` = loadGreens(...) output. */
export function greenFor(greens, courseId, holeKey) {
  if (courseId == null || holeKey == null) return null;
  const g = greens?.[String(courseId)]?.[String(holeKey)];
  return validGreen(g) ? g : null;
}

/** Store (or replace) one green. point = { lat, lon | lng }. Returns the updated map (also on a write failure). */
export function saveGreen(storage, courseId, holeKey, point, now = Date.now()) {
  const q = ll(point);
  const all = loadGreens(storage);
  if (!q || courseId == null || holeKey == null) return all;
  const c = String(courseId);
  all[c] = { ...(all[c] || {}), [String(holeKey)]: { lat: q.lat, lon: q.lon, t: Number.isFinite(now) ? now : null } };
  try { if (storage) storage.setItem(GREENS_KEY, JSON.stringify(all)); } catch (e) { /* quota / private mode: this session still has it */ }
  return all;
}

/**
 * Which course id and hole key a scorecard hole's green is filed under. A physical green, not a
 * routing's hole number: on a club whose nines are known (course.nines.play, v22.7) it is
 * "{nine}.{hole in nine}" under the club id, so "White 3" is the same green in every routing that
 * plays it; otherwise the routing's own course id and the scorecard hole number.
 * course = { apiId, clubApiId?, nines?: { play: [a, b] } }; n = 1–18.
 */
export function greenSlot(course, n, { apiId = course?.apiId ?? null, clubId = course?.clubApiId ?? apiId } = {}) {
  const play = course?.nines?.play;
  if (Array.isArray(play) && play.length === 2 && play[0] != null && play[1] != null) {
    return { courseId: clubId != null ? String(clubId) : null, holeKey: `${play[n <= 9 ? 0 : 1]}.${((n - 1) % 9) + 1}` };
  }
  return { courseId: apiId != null ? String(apiId) : null, holeKey: String(n) };
}

/* ---------- frames ---------- */

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The north-up anchor frame for an unmapped hole. `anchor` = a fixed point for the course (the
 * golfcourseapi location); it is rounded to 0.01° so that nearby fallbacks (the ball, when the
 * course has no location) land on the same origin. null without a point.
 */
export function anchorFrame(anchor) {
  const q = ll(anchor);
  return q ? holeFrame({ origin: { lat: round2(q.lat), lon: round2(q.lon) }, bearingDeg: 0 }) : null;
}

/** Hole-frame points from one frame into another (both geo.js holeFrame). */
export function reframe(p, from, to) {
  if (!p || !from || !to) return null;
  const g = from.toLatLng(p);
  return to.toFrame(g);
}

/** Previous-shot lines stored in the anchor frame → the synthetic hole's frame, for drawing. */
export function toSyntheticFrame(shots, anchorF, synF) {
  if (!anchorF || !synF) return [];
  return (shots || []).map((s) => ({ from: reframe(s.from, anchorF, synF), to: reframe(s.to, anchorF, synF) })).filter((s) => s.from && s.to);
}

/* ---------- the synthetic hole ---------- */

/**
 * A course.js Hole from the ball to a marked green, in a lat/lon-anchored frame:
 * origin = the ball, +y = ball → green (so the green centre is (0, d)), d = yards between them.
 * 40-yd fairway corridor from 30 yds (or a quarter of the way) to the front of the green when the
 * shot is over 60 yds; a 28 × 24 green centred on the mark; no hazards; no boundary. Carries
 * origin + bearingDeg (geo.js frameOf works on it), `synthetic: true`, `pinPresetYds` and a `key`
 * that changes with the ball or the green, so the camera refits on either (overlay.js cameraKey).
 * ball, green = { lat, lon | lng }. null when either is missing.
 */
export function markedGreenHole({ ball, green, holeNo = null, par = 4 } = {}) {
  const b = ll(ball), g = ll(green);
  if (!b || !g) return null;
  const d = haversineM(b, g) * YARDS_PER_METER;
  // on top of the mark (d ≈ 0) there is no line; any bearing will do — keep north
  const brg = d > 0.5 ? bearingDeg(b, g) : 0;
  const F = holeFrame({ origin: b, bearingDeg: brg });
  const c = F.toFrame(g);                           // ≈ (0, d)
  const cy = Math.hypot(c.x, c.y);
  const green0 = { ring: ellipse(0, cy, MARKED_GREEN_WIDTH / 2, MARKED_GREEN_DEPTH / 2, 32), center: { x: 0, y: cy } };
  const fwStart = Math.min(30, cy / 4), fwEnd = cy - MARKED_GREEN_DEPTH / 2;
  const f6 = (x) => x.toFixed(6);
  return {
    id: holeNo ?? "marked", key: `marked|${holeNo ?? ""}|${f6(b.lat)},${f6(b.lon)}|${f6(g.lat)},${f6(g.lon)}`,
    par, yards: Math.round(cy),
    tee: { x: 0, y: 0 },
    green: green0,
    fairways: cy > 60 && fwEnd > fwStart ? [rect(-MARKED_FAIRWAY_HALF, fwStart, MARKED_FAIRWAY_HALF, fwEnd)] : [],
    tees: [], hazards: [], boundary: null, roughs: [], nearby: { fairways: [], greens: [] },
    origin: F.origin, bearingDeg: F.bearingDeg, line: [{ x: 0, y: 0 }, { x: 0, y: cy }],
    synthetic: true, pinPresetYds: MARKED_PIN_PRESET_YDS,
  };
}

/** Is the frame point inside, or within `yds` of, the synthetic green's ring? */
export function nearMarkedGreen(hole, p, yds = REMARK_RADIUS_YDS) {
  if (!hole?.green || !p) return false;
  return dist(p, hole.green.center) <= Math.max(MARKED_GREEN_DEPTH, MARKED_GREEN_WIDTH) / 2 + yds;
}

/**
 * The pin for a setting on a marked green, as a frame point: presets are ±10 yds along
 * ball → green from the centre (the frame's +y, so front = (0, d − 10), back = (0, d + 10));
 * a custom {x,y} or {lat,lng} pin is returned in the frame. null without a hole.
 */
export function markedPinPoint(hole, setting = "middle", from = hole?.tee) {
  if (!hole?.green) return null;
  const c = hole.green.center;
  if (setting && typeof setting === "object") {
    if (Number.isFinite(setting.x)) return { x: setting.x, y: setting.y };
    const q = ll(setting);
    if (!q || !hole.origin) return null;
    return holeFrame({ origin: hole.origin, bearingDeg: hole.bearingDeg }).toFrame(q);
  }
  const k = setting === "front" ? -1 : setting === "back" ? 1 : 0;
  const o = from || { x: 0, y: 0 };
  const L = dist(o, c);
  if (!k || L < 1e-6) return { x: c.x, y: c.y };
  const s = (hole.pinPresetYds ?? MARKED_PIN_PRESET_YDS) * k;
  return { x: c.x + ((c.x - o.x) / L) * s, y: c.y + ((c.y - o.y) / L) * s };
}

/**
 * The engine ctx on a marked green: context.js assembleShotContext on the synthetic hole (weather
 * turned into its frame, plays-like, temperature, chips), with two differences —
 *   · the pin: a preset is handed over as its ±10-yd point, so the engine prices the same pin the
 *     map draws (a custom pin passes through, clamped inside the green as always);
 *   · the lie is never inferred (there are no polygons): shot 1 off the tee reads Tee, every other
 *     shot reads Fairway at low confidence (the chip's `?`) until Brett corrects it with the Lie chip.
 * inputs: assembleShotContext's, with `hole` = markedGreenHole(...) and round.pins[hole] the setting.
 */
export function markedGreenContext(inputs = {}) {
  const { hole, round = {}, chips = {} } = inputs;
  const n = round.hole ?? hole?.id;
  const setting = chips.pin ?? round.pins?.[n] ?? "middle";
  const pinPt = markedPinPoint(hole, setting, hole?.tee);
  const ctx = assembleShotContext({ ...inputs, geometry: null, elevation: inputs.elevation ?? null, round: { ...round, pins: { ...(round.pins || {}), [n]: pinPt || "middle" } }, chips: { ...chips, pin: undefined } });
  if (ctx.meta.sources.lie !== "chip" && ctx.meta.sources.lie !== "tee") {
    return { ...ctx, lieType: "fairway", lieConfidence: "low", meta: { ...ctx.meta, lie: null, penalty: null, sources: { ...ctx.meta.sources, lie: "default" } } };
  }
  return ctx;
}

/** The lie at a frame point on a synthetic hole, for a shot's closeout: `green` on the mark, else unknown. */
export const markedEndLie = (hole, p) => (hole && p && classify(hole, p) === "green" ? "green" : null);
