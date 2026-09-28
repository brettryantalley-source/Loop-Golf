/*
 * shotlog.js — Component B, the post-shot capture log (spec §4).
 *
 * Pure functions. No DOM, no network. Storage is INJECTED: every persisting function takes a
 * `storage` argument shaped like localStorage — `getItem(key)` / `setItem(key, value)` — so tests
 * (and any future caller) can pass an in-memory stub instead of the real `window.localStorage`.
 *
 * Storage keys stay in the `bogeyman-matches:*` namespace per Brett's Sep 28 decision (this
 * overrides spec §8's `loop.*` keys — see docs/HANDOFF-NEXT.md, "Decisions (Brett, Sep 28)" #1):
 *   - `bogeyman-matches:shots:v1`        one object, { [roundId]: ShotRecord[] }
 *   - `bogeyman-matches:lieOverrides:v1` one array of override entries (spec §5.6)
 *
 * A ShotRecord follows spec §4.6. Two fields are added beyond the spec's illustrative JSON,
 * both documented in-line where they're built: `start.frame` and a top-level `target.frame`,
 * the hole-frame {x,y} yard coordinates (src/caddie/course.js) needed to do the §4.5 miss-distance
 * math without re-deriving it from lat/lng every time.
 */

import { DEFAULT_CONFIG } from "./config.js";

export const SHOT_SCHEMA = 1;
export const SHOTS_KEY = "bogeyman-matches:shots:v1";
export const LIE_OVERRIDES_KEY = "bogeyman-matches:lieOverrides:v1";

/** Wedges, per §4.2's parenthetical: "if club is a wedge (GW/SW/LW)". */
const WEDGES = Object.freeze(["GW", "SW", "LW"]);

const DEG = Math.PI / 180;

/* ---------- ids / clock ---------- */

function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback for environments without the Web Crypto API (spec: "or a fallback").
  return `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

/* ---------- §4.1 routing ---------- */

/**
 * §4.1 — which card a shot gets.
 * On the green → "putt" (not captured by this card, regardless of distance — greenside chips
 * that happen to sit inside the green polygon are the same case as a real putt here).
 * Otherwise: ≥ 75 yds from the pin → "long"; < 75 → "shortGame".
 */
export function routeShot({ distanceToPinYds, lieType }) {
  if (lieType === "green") return "putt";
  return distanceToPinYds >= 75 ? "long" : "shortGame";
}

/* ---------- §4.2 defaults ---------- */

/** Club of the SAFE option, or the single option when `sameShot` (recommendation.aggressive is null). */
function defaultClub(recommendation) {
  return recommendation?.safe?.club ?? null;
}

/** Line played, inferred from a club match against the recommendation snapshot. */
function inferLinePlayed(club, recommendation) {
  if (!recommendation || !club) return "own";
  if (recommendation.safe && recommendation.safe.club === club) return "safe";
  if (recommendation.aggressive && recommendation.aggressive.club === club) return "aggressive";
  return "own";
}

/** The target the club actually played toward, read off whichever recommendation option it matches. */
function defaultTarget(club, linePlayed, recommendation, explicit) {
  if (explicit) return explicit;
  const opt = linePlayed === "safe" ? recommendation?.safe : linePlayed === "aggressive" ? recommendation?.aggressive : null;
  if (!opt || !opt.target) return null;
  return { frame: { x: opt.target.x, y: opt.target.y }, label: opt.target.label ?? null };
}

/** finesse if the club is a wedge and the start distance is ≤ 120, else full. */
function defaultShotType(club, startDistanceYds) {
  if (WEDGES.includes(club) && typeof startDistanceYds === "number" && startDistanceYds <= 120) return "finesse";
  return "full";
}

/** Brett's most common intended shape for this club from prior records; "straight" with no history
 *  (also the tie-break when two shapes are equally common). */
function defaultIntendedShape(club, history) {
  if (!Array.isArray(history) || !history.length || !club) return "straight";
  const counts = { draw: 0, straight: 0, fade: 0 };
  for (const rec of history) {
    if (rec && rec.club === club && rec.intendedShape in counts) counts[rec.intendedShape]++;
  }
  let best = "straight", bestN = counts.straight;
  for (const shape of ["draw", "fade"]) {
    if (counts[shape] > bestN) { best = shape; bestN = counts[shape]; }
  }
  return bestN > 0 ? best : "straight";
}

/** Curve that matches an intended shape: draw → −1, straight → 0, fade → +1. */
function curveForShape(shape) {
  return shape === "draw" ? -1 : shape === "fade" ? 1 : 0;
}

/**
 * §4.6 — build a full shot record, filling every §4.2 default that `input` doesn't already supply.
 * `input.recommendation` is whatever `recommend()` (src/caddie/engine.js) returned for this shot —
 * stored verbatim as the record's `recommendation` snapshot, so it always matches what the engine
 * returned, chips and pin included (its `context` carries lie/quality/conditions/pin/wind — see
 * SPEC-caddie-UI.md §9.4). `input.history` is prior records, used only to default `intendedShape`.
 */
export function newShotRecord(input = {}) {
  const club = input.club ?? defaultClub(input.recommendation);
  const linePlayed = input.linePlayed ?? inferLinePlayed(club, input.recommendation);
  const target = defaultTarget(club, linePlayed, input.recommendation, input.target);
  const startDistance = input.start?.distanceToPinYds;
  const shotType = input.shotType ?? defaultShotType(club, startDistance);
  const intendedShape = input.intendedShape ?? defaultIntendedShape(club, input.history);
  const curve = input.curve ?? curveForShape(intendedShape);

  return {
    id: input.id ?? genId(),
    schema: SHOT_SCHEMA,
    roundId: input.roundId ?? null,
    courseId: input.courseId ?? null,
    nine: input.nine ?? null,
    hole: input.hole ?? null,
    shotNo: input.shotNo ?? null,
    ts: input.ts ?? nowIso(),
    start: input.start ?? null,
    target,
    lie: input.lie ?? null,
    conditions: input.conditions ?? "normal",
    wind: input.wind ?? null,
    recommendation: input.recommendation ?? null,
    club,
    linePlayed,
    shotType,
    contact: input.contact ?? 0,
    strike: input.strike ?? "center",
    intendedShape,
    startLine: input.startLine ?? "on",
    curve,
    end: input.end ?? null,
    derived: input.derived ?? null,
    logged: input.logged ?? "quick",
  };
}

/* ---------- §4.3 quick path / detail / skip ---------- */

/** "Good shot ✓" — every field at its default, `logged: "quick"`. */
export function quickLog(record) {
  return newShotRecord({ ...record, logged: "quick" });
}

/** Detail entry — `fields` overrides whichever ones were off; `logged: "full"`. */
export function detailLog(record, fields = {}) {
  return newShotRecord({ ...record, ...fields, logged: "full" });
}

/** §4.4 — a shot moved past without logging. GPS result still recorded; excluded from miss-cause analysis. */
export function skipShot(record) {
  return newShotRecord({ ...record, logged: "skipped" });
}

/* ---------- putt capture (Sep 28 spec, filling engine spec §4.1's "separate future spec") ----------
 * A putt record is a lighter sibling of the long/short-game ShotRecord: no club, no recommendation
 * snapshot, no start/target frame — just where it started (feet) and, on a miss, three −2..2 axes
 * (speed, break, line) that the reasons/learning layers can read the same way they read `contact`,
 * `strike` etc. on a full swing. `PUTT_AXES` is the one source for both the axis order and Brett's
 * exact five-cell copy, so caddieState.js / app.jsx never restate it. `short` is a display-only
 * alias per option (the pill on a 375-wide card clips/wraps to three lines on the full copy) —
 * `options` stays the copy of record, and is what tests and any future export/reason text read.
 */
export const PUTT_AXES = Object.freeze([
  { key: "speed", label: "Speed", options: ["Very short", "Short", "Good", "Long", "Very long"],
    short: ["V. short", "Short", "Good", "Long", "V. long"] },
  { key: "breakRead", label: "Break", options: ["Big under-read", "Under-read", "Good", "Over-read", "Way over-read"],
    short: ["Big under", "Under", "Good", "Over", "Way over"] },
  { key: "line", label: "Line", options: ["Big pull", "Pull", "Good", "Push", "Big push"],
    short: ["Big pull", "Pull", "Good", "Push", "Big push"] },
]);

/** Interpretation: an axis value is CLAMPED into −2..2 (rounded first), never thrown on — a slider
 *  can only ever emit an in-range integer, so this only guards a corrupt or hand-edited record. A
 *  missing/non-finite value defaults to 0 ("Good"), matching the card's pre-selected default. */
function clampAxis(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-2, Math.min(2, Math.round(v)));
}

/**
 * Builds one putt record. `made` forces all three axes to null (nothing to grade on a holed putt)
 * and, unless `logged` is given explicitly, defaults `logged` to "quick" for a made putt and "full"
 * for a graded miss — the two paths the card actually offers (`Made ✓` vs. the sliders + `Save`).
 */
export function newPuttRecord(input = {}) {
  const made = !!input.made;
  const speed = made ? null : clampAxis(input.speed);
  const breakRead = made ? null : clampAxis(input.breakRead);
  const line = made ? null : clampAxis(input.line);
  return {
    id: input.id ?? genId(),
    schema: SHOT_SCHEMA,
    roundId: input.roundId ?? null,
    courseId: input.courseId ?? null,
    hole: input.hole ?? null,
    shotNo: input.shotNo ?? null,
    ts: input.ts ?? nowIso(),
    gps: input.gps ?? null,
    shotType: "putt",
    logged: input.logged ?? (made ? "quick" : "full"),
    putt: {
      distanceFt: Number.isFinite(input.distanceFt) ? Math.round(input.distanceFt) : null,
      made, speed, breakRead, line,
    },
  };
}

/** `Made ✓` — the quick path: holed out, no axes to grade, `logged: "quick"`. */
export function quickMade(record) {
  return newPuttRecord({ ...record, made: true, logged: "quick" });
}

/* ---------- §4.5 auto-derived fields ---------- */

/** Rotate a unit direction vector 90° so +x of the result is "to the right of travel". */
function rightPerp(dir) {
  return { x: dir.y, y: -dir.x };
}

/**
 * §4.5 — fires on the next "I'm at my ball" (or hole completion). `prev` is the shot record being
 * closed out; `endFrame` is its end position already projected into the hole frame (src/caddie/course.js),
 * matching `prev.start.frame` / `prev.target.frame`. `endGps`/`endLie`/`endAccuracyM` are stored as-is.
 *
 * Math: intended distance/line = start → target in the hole frame. `distanceMissYds` is the actual
 * distance along that line minus the intended distance (negative = short). `lateralMissYds` is the
 * signed perpendicular offset (negative = left). `onTarget` uses `DEFAULT_CONFIG.ON_TARGET`
 * (±distPct of the intended distance, ±carry·tan(latDeg) laterally — carry approximated by the
 * intended distance itself, since that's the shot Brett aimed). `intendedYds` / `actualYds` are the
 * two raw distances behind that miss (start→target, and the actual distance along the target
 * line) — src/caddie/learning.js reads these to learn an absolute distance median.
 */
export function closeOutShot(prev, { endGps, endLie, endAccuracyM, endFrame } = {}, cfg = DEFAULT_CONFIG) {
  const end = {
    lat: endGps?.lat ?? null,
    lng: endGps?.lng ?? null,
    accuracyM: endAccuracyM ?? null,
    lie: endLie ?? null,
  };

  const startFrame = prev.start?.frame;
  const targetFrame = prev.target?.frame;
  let derived = { distanceMissYds: null, lateralMissYds: null, onTarget: null, intendedYds: null, actualYds: null };

  if (startFrame && targetFrame && endFrame) {
    const tv = { x: targetFrame.x - startFrame.x, y: targetFrame.y - startFrame.y };
    const intendedDistance = Math.hypot(tv.x, tv.y);
    if (intendedDistance > 1e-9) {
      const dir = { x: tv.x / intendedDistance, y: tv.y / intendedDistance };
      const perp = rightPerp(dir);
      const v = { x: endFrame.x - startFrame.x, y: endFrame.y - startFrame.y };
      const along = v.x * dir.x + v.y * dir.y;
      const lat = v.x * perp.x + v.y * perp.y;
      const distanceMissYds = round1(along - intendedDistance);
      const lateralMissYds = round1(lat);
      const intendedYds = round1(intendedDistance);
      const actualYds = round1(along);
      const distTol = cfg.ON_TARGET.distPct * intendedDistance;
      const latTol = intendedDistance * Math.tan(cfg.ON_TARGET.latDeg * DEG);
      const onTarget = Math.abs(distanceMissYds) <= distTol && Math.abs(lateralMissYds) <= latTol;
      derived = { distanceMissYds, lateralMissYds, onTarget, intendedYds, actualYds };
    }
  }

  return { ...prev, end, derived };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/* ---------- schema migration ---------- */

/** Identity for schema 1. Missing `schema` → treated as 1 and stamped. Throws on any other schema. */
export function migrateShot(record) {
  const schema = record.schema ?? 1;
  if (schema === 1) return record.schema === 1 ? record : { ...record, schema: 1 };
  throw new Error(`shotlog: unknown schema ${schema}`);
}

/* ---------- storage plumbing ---------- */

function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

function readShotsMap(storage) {
  return readJSON(storage, SHOTS_KEY, {});
}

function writeShotsMap(storage, map) {
  writeJSON(storage, SHOTS_KEY, map);
}

/** All shots for one round (migrated), or every shot across every round when `roundId` is omitted. */
export function loadShots(storage, roundId) {
  const all = readShotsMap(storage);
  if (roundId != null) return (all[roundId] || []).map(migrateShot);
  return Object.values(all).flat().map(migrateShot);
}

/** Upsert one record by id, into its round's array. */
export function saveShot(storage, record) {
  const rec = migrateShot(record);
  const all = readShotsMap(storage);
  const roundId = rec.roundId ?? "unassigned";
  const list = all[roundId] ? [...all[roundId]] : [];
  const idx = list.findIndex((r) => r.id === rec.id);
  if (idx >= 0) list[idx] = rec;
  else list.push(rec);
  all[roundId] = list;
  writeShotsMap(storage, all);
  return rec;
}

/** Every shot record in storage, across every round. */
export function allShots(storage) {
  return loadShots(storage);
}

/* ---------- §8 export / import ---------- */

/** `{ schema, exportedAt, shots }` for all rounds, or just `roundIds` when given. */
export function exportShots(storage, roundIds) {
  const all = readShotsMap(storage);
  const keys = roundIds && roundIds.length ? roundIds : Object.keys(all);
  const shots = keys.flatMap((rid) => (all[rid] || []).map(migrateShot));
  return JSON.stringify({ schema: SHOT_SCHEMA, exportedAt: nowIso(), shots });
}

/** Merge an export back in, by id. Never deletes; on a conflict the newer `ts` wins. */
export function importShots(storage, json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const incoming = Array.isArray(data?.shots) ? data.shots.map(migrateShot) : [];
  const all = readShotsMap(storage);
  let added = 0, updated = 0, unchanged = 0;

  for (const rec of incoming) {
    const roundId = rec.roundId ?? "unassigned";
    const list = all[roundId] ? [...all[roundId]] : [];
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx === -1) {
      list.push(rec);
      added++;
    } else {
      const existingTs = Date.parse(list[idx].ts ?? 0) || 0;
      const incomingTs = Date.parse(rec.ts ?? 0) || 0;
      if (incomingTs > existingTs) { list[idx] = rec; updated++; }
      else unchanged++;
    }
    all[roundId] = list;
  }

  writeShotsMap(storage, all);
  return { added, updated, unchanged, total: incoming.length };
}

/* ---------- miss-cause aggregation ---------- */

/** §4.4 / T19 — the filter every miss-cause aggregate must go through: skipped shots excluded. */
export function missCauseSample(records) {
  return records.filter((r) => r.logged !== "skipped");
}

/* ---------- §5.6 lie-override storage ---------- */

function readLieOverrides(storage) {
  return readJSON(storage, LIE_OVERRIDES_KEY, []);
}

/**
 * §5.6 — store one lie-chip correction. The inference rule that reads these back (≥ 2 corrections
 * within 15 m → future inference uses the corrected value) belongs to S5's learning module; this
 * is storage only.
 */
export function recordLieOverride(storage, { courseId, hole, gps, inferred, corrected, ts } = {}) {
  const entry = {
    courseId: courseId ?? null,
    hole: hole ?? null,
    gps: gps ?? null,
    inferred: inferred ?? null,
    corrected: corrected ?? null,
    ts: ts ?? nowIso(),
  };
  const list = readLieOverrides(storage);
  list.push(entry);
  writeJSON(storage, LIE_OVERRIDES_KEY, list);
  return entry;
}

/** Every stored lie-override entry, in the order recorded. */
export function loadLieOverrides(storage) {
  return readLieOverrides(storage);
}
