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
export function defaultIntendedShape(club, history) {
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
  const intent = normIntent(input.intent);
  // v22.15: with an intent on the map, the line played is read off where Brett aimed (§2)
  const linePlayed = input.linePlayed ?? (intent ? linePlayedFor(intent, input.recommendation, club) : inferLinePlayed(club, input.recommendation));
  const target = intent?.target && !input.target
    ? { frame: { x: intent.target.x, y: intent.target.y }, label: intent.targetLabel ?? null }
    : defaultTarget(club, linePlayed, input.recommendation, input.target);
  const startDistance = input.start?.distanceToPinYds;
  const shotType = input.shotType ?? defaultShotType(club, startDistance);
  const intendedShape = input.intendedShape ?? intent?.shape ?? defaultIntendedShape(club, input.history);
  const curve = input.curve ?? curveForShape(intendedShape);
  const logged = input.logged ?? "quick";
  // an explicit null (an auto-created record nobody has graded yet) stays null; undefined defaults
  const orDefault = (v, d) => (v === null ? null : v ?? d);

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
    contact: orDefault(input.contact, 0),
    strike: orDefault(input.strike, "center"),
    intendedShape,
    startLine: orDefault(input.startLine, "on"),
    curve,
    end: input.end ?? null,
    derived: input.derived ?? null,
    logged,
    /* v22.15 (SPEC-shotlog-v2 §7), all additive: the pre-shot intent, where the curve value came
       from, whether Brett has looked at the record, and whether its start was placed by hand. */
    intent,
    curveSource: input.curveSource ?? null,
    reviewed: input.reviewed ?? (logged !== "auto" && logged !== "skipped"),
    placed: !!input.placed,
  };
}

/**
 * v22.12 — a shot logged with NO recommendation on screen: no course map and no satellite, a
 * marked-green hole before the tee, or Enter yards not used yet. Brett picks the club on the card.
 * Whatever the caddie did not work out is null rather than guessed: no target, no recommendation
 * snapshot, no frame — so its §4.5 closeout has no miss math (derived all null), §5.3 learning
 * (applyShotLog) skips it, and within the round only its contact counts. `gps` = the ball's fix
 * ({ lat, lng, accuracyM }) or null; `distanceToPinYds` = entered yards or the card's yardage, or
 * null; `lie` = the Lie chip or the tee on shot 1, else null. linePlayed reads "own" (spec §4.2's
 * rule with nothing to match against).
 */
export function bareShotRecord(input = {}) {
  const g = input.gps && Number.isFinite(input.gps.lat) && Number.isFinite(input.gps.lng ?? input.gps.lon) ? input.gps : null;
  const yds = Number.isFinite(input.distanceToPinYds) && input.distanceToPinYds > 0 ? Math.round(input.distanceToPinYds) : null;
  return newShotRecord({
    id: input.id, ts: input.ts,
    roundId: input.roundId, courseId: input.courseId, nine: input.nine, hole: input.hole, shotNo: input.shotNo,
    start: {
      lat: g ? g.lat : null, lng: g ? (g.lng ?? g.lon) : null, accuracyM: g && Number.isFinite(g.accuracyM) ? g.accuracyM : null,
      distanceToPinYds: yds, playsLikeYds: null, frame: null,
    },
    target: null,
    lie: { inferred: null, confidence: null, confirmed: input.lie ?? null, quality: input.quality ?? "standard" },
    conditions: input.conditions ?? "normal",
    wind: null,
    recommendation: null,
    club: input.club ?? null,
    history: input.history,
  });
}

/* ---------- §4.3 quick path / detail / skip ---------- */

/** The card's defaults for the graded fields an auto-created record leaves null (v22.15). */
export function withCardDefaults(record) {
  return { ...record, contact: record.contact ?? 0, strike: record.strike ?? "center", startLine: record.startLine ?? "on" };
}

/** "Good shot ✓" — every field at its default, `logged: "quick"`. Brett looked at it: reviewed. */
export function quickLog(record) {
  return newShotRecord({ ...withCardDefaults(record), logged: "quick", reviewed: true });
}

/** Detail entry — `fields` overrides whichever ones were off; `logged: "full"`, reviewed. */
export function detailLog(record, fields = {}) {
  return newShotRecord({ ...withCardDefaults(record), ...fields, logged: "full", reviewed: true });
}

/** §4.4 — a shot moved past without logging. GPS result still recorded; excluded from miss-cause analysis. */
export function skipShot(record) {
  return newShotRecord({ ...record, logged: "skipped", reviewed: false });
}

/**
 * v22.15 §3 — the record auto-created when a shot closes and Brett never opened its card: the
 * intent (default or set), the recommendation's club (else null), `logged: "auto"`,
 * `reviewed: false`. Contact, strike and start line stay null — nobody graded them, so the learning
 * loop does not read a default 0 as a pure strike; the card and the Review sheet fill the defaults.
 */
export function autoShotRecord(record) {
  return newShotRecord({ ...record, logged: "auto", reviewed: false, contact: null, strike: null, startLine: null, curveSource: record.curveSource ?? null });
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
export function closeOutShot(prev0, { endGps, endLie, endAccuracyM, endFrame, intent } = {}, cfg = DEFAULT_CONFIG) {
  // v22.15: `intent` (the caddie's intent for this shot at the moment it closed) supersedes the one
  // the record was logged with; either way the record's target becomes where Brett aimed.
  const it = normIntent(intent !== undefined ? intent : prev0.intent);
  const prev = it ? withIntent(prev0, it) : prev0;
  const end = {
    lat: endGps?.lat ?? null,
    lng: endGps?.lng ?? endGps?.lon ?? null,
    accuracyM: endAccuracyM ?? null,
    lie: endLie ?? null,
    ...(it ? { frame: endFrame && Number.isFinite(endFrame.x) ? { x: endFrame.x, y: endFrame.y } : null } : {}),
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

  if (!it) return { ...prev, end, derived };
  const r = deriveResult(
    startFrame ? { x: startFrame.x, y: startFrame.y, accuracyM: prev.start?.accuracyM ?? null } : null,
    it,
    endFrame ? { x: endFrame.x, y: endFrame.y, accuracyM: endAccuracyM ?? null } : null,
    cfg,
  );
  const out = { ...prev, end, derived: { ...derived, ...r } };
  // §3: the curve follows the GPS read until Brett sets it by hand
  if (prev.curveSource !== "hand" && r.curveAuto != null) { out.curve = r.curveAuto; out.curveSource = "auto"; }
  return out;
}

/* ---------- v22.15 intent and the derived result (SPEC-shotlog-v2 §2, §3) ---------- */

/** A target within this many yards of an option's target counts as playing that option (§2). */
export const LINE_MATCH_YDS = 5;
const SHAPES = ["draw", "straight", "fade"];
const isPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** A stored intent, validated (null when there is none). Unknown keys are dropped. */
export function normIntent(it) {
  if (!it || typeof it !== "object") return null;
  const target = isPt(it.target) ? { x: it.target.x, y: it.target.y } : null;
  const ll0 = it.targetLL;
  const targetLL = ll0 && Number.isFinite(ll0.lat) && Number.isFinite(ll0.lng ?? ll0.lon) ? { lat: ll0.lat, lng: ll0.lng ?? ll0.lon } : null;
  const l0 = it.lineLL;
  const lineLL = l0 && Number.isFinite(l0.lat) && Number.isFinite(l0.lng ?? l0.lon) ? { lat: l0.lat, lng: l0.lng ?? l0.lon } : null;
  return {
    target, targetLabel: it.targetLabel ?? null, targetLL,
    startLineDeg: Number.isFinite(it.startLineDeg) ? it.startLineDeg : null,
    // a point on the start line (lat/lng), so the bearing can be read again in another frame (Review)
    ...(lineLL ? { lineLL } : {}),
    shape: SHAPES.includes(it.shape) ? it.shape : null,
    source: it.source === "set" ? "set" : "default",
  };
}

/** Bearing of `to` seen from `from` in a hole frame: degrees clockwise from +y (the tee → green way), (−180, 180]. */
export function bearingInFrame(from, to) {
  if (!isPt(from) || !isPt(to)) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  return Math.round((Math.atan2(dx, dy) / DEG) * 10) / 10;
}

/**
 * §2 — `linePlayed` derived from where Brett aimed: `safe` if the target is within 5 yds of the
 * SAFE option's target, `aggressive` within 5 yds of AGGRESSIVE's (the nearer wins when both are),
 * else `own`. An untouched (default) intent keeps the §9.5 club rule too: a club that matches only
 * the other option says that option was played.
 */
export function linePlayedFor(intent, recommendation, club) {
  const it = normIntent(intent);
  if (!recommendation) return "own";
  const byClub = inferLinePlayed(club, recommendation);
  if (!it?.target) return byClub;
  const d = (o) => (o?.target && isPt(o.target) ? Math.hypot(o.target.x - it.target.x, o.target.y - it.target.y) : Infinity);
  const ds = d(recommendation.safe), da = d(recommendation.aggressive);
  const byTarget = ds <= LINE_MATCH_YDS || da <= LINE_MATCH_YDS ? (da < ds ? "aggressive" : "safe") : "own";
  if (it.source !== "set" && byClub !== "own" && byClub !== byTarget) return byClub;
  return byTarget;
}

/** The record with an intent applied: target, label, line played and intended shape follow it. */
function withIntent(rec, it) {
  const out = { ...rec, intent: it };
  if (it.target) out.target = { frame: { x: it.target.x, y: it.target.y }, label: it.targetLabel ?? rec.target?.label ?? null };
  if (it.shape) out.intendedShape = it.shape;
  if (rec.recommendation) out.linePlayed = linePlayedFor(it, rec.recommendation, rec.club);
  return out;
}

/**
 * §2 — the intent for a shot: the marks Brett set (`set`: target {x,y}, targetLabel, startLineDeg,
 * shape) over the defaults — target = the recommended option's target, start line through the
 * target, shape = his usual shape for the club (defaultIntendedShape). `frame` (optional, the shot's
 * hole frame) adds the target in lat/lng so the Review sheet can compare shots across frames.
 * source = "set" once any mark is Brett's. With no option and no marks (no recommendation): shape only.
 */
export function shotIntent({ set = {}, option = null, ball = null, history = null, club = option?.club ?? null, frame = null } = {}) {
  const mine = set || {};
  const target = isPt(mine.target) ? { x: mine.target.x, y: mine.target.y } : isPt(option?.target) ? { x: option.target.x, y: option.target.y } : null;
  const targetLabel = isPt(mine.target) ? mine.targetLabel ?? "own target" : option?.target?.label ?? null;
  const startLineDeg = Number.isFinite(mine.startLineDeg) ? mine.startLineDeg : target && isPt(ball) ? bearingInFrame(ball, target) : null;
  const shape = SHAPES.includes(mine.shape) ? mine.shape : defaultIntendedShape(club, history);
  const source = isPt(mine.target) || Number.isFinite(mine.startLineDeg) || SHAPES.includes(mine.shape) ? "set" : "default";
  let targetLL = null;
  if (target && frame && typeof frame.toLatLng === "function") { const q = frame.toLatLng(target); targetLL = { lat: q.lat, lng: q.lon ?? q.lng }; }
  const ll0 = mine.lineLL;
  const lineLL = Number.isFinite(mine.startLineDeg) && ll0 && Number.isFinite(ll0.lat) && Number.isFinite(ll0.lng ?? ll0.lon) ? { lat: ll0.lat, lng: ll0.lng ?? ll0.lon } : null;
  return { target, targetLabel, targetLL, startLineDeg, shape, source, ...(lineLL ? { lineLL } : {}) };
}

/** A miss in yards → 0 / ±1 / ±2 by the §3 bands: |v| < slight → 0, slight … big → ±1, > big → ±2. */
export function missBand(v, bands = DEFAULT_CONFIG.MISS_BANDS) {
  if (!Number.isFinite(v)) return null;
  const a = Math.abs(v), b = bands || DEFAULT_CONFIG.MISS_BANDS;
  const k = a < b.slightYds ? 0 : a <= b.bigYds ? 1 : 2;
  return k === 0 ? 0 : Math.sign(v) * k;
}

/**
 * §3 — the result of a closed shot, in yards in the shot's hole frame, from its start, the intent's
 * target and its end:
 *   distMissYds  along the ball → target line, end past the target (+ long, − short)
 *   latMissYds   perpendicular offset of the end from that line (+ right, − left, seen from the ball)
 *   curveAuto    missBand(latMissYds): right of target = fade side (+), left = draw side (−). The shape
 *                only changes the words (curveReadback), never the number.
 *   distClass    missBand(distMissYds): −2 … +2, short … long. Not written into `contact`.
 *   derivedLowAcc  either fix's accuracyM > LOW_ACC_M (12 m); the fields are still computed.
 * start / end = { x, y, accuracyM? }; the start line is not observable from two fixes and is not used.
 * Every field is null when a point is missing.
 */
export function deriveResult(start, intent, end, cfg = DEFAULT_CONFIG) {
  const it = normIntent(intent);
  const lowM = cfg?.LOW_ACC_M ?? DEFAULT_CONFIG.LOW_ACC_M;
  const acc = [start?.accuracyM, end?.accuracyM].filter(Number.isFinite);
  const derivedLowAcc = acc.length ? acc.some((m) => m > lowM) : null;
  const none = { distMissYds: null, latMissYds: null, curveAuto: null, distClass: null, derivedLowAcc: isPt(start) && isPt(end) ? derivedLowAcc : null };
  const T = it?.target;
  if (!isPt(start) || !isPt(end) || !isPt(T)) return none;
  const tv = { x: T.x - start.x, y: T.y - start.y };
  const L = Math.hypot(tv.x, tv.y);
  if (L < 1e-9) return none;
  const dir = { x: tv.x / L, y: tv.y / L }, perp = rightPerp(dir);
  const v = { x: end.x - start.x, y: end.y - start.y };
  const distMissYds = round1(v.x * dir.x + v.y * dir.y - L);
  const latMissYds = round1(v.x * perp.x + v.y * perp.y);
  const bands = cfg?.MISS_BANDS || DEFAULT_CONFIG.MISS_BANDS;
  return { distMissYds, latMissYds, curveAuto: missBand(latMissYds, bands), distClass: missBand(distMissYds, bands), derivedLowAcc: !!derivedLowAcc };
}

/** The read-back word for curveAuto against the intended shape (§3), or null for 0 / no value. */
export function curveReadback(curveAuto, shape) {
  if (!curveAuto) return null;
  const big = Math.abs(curveAuto) === 2;
  if (shape === "draw") return curveAuto < 0 ? (big ? "way over-drew" : "over-drew") : (big ? "held it, big" : "held / under-drew");
  if (shape === "fade") return curveAuto > 0 ? (big ? "way over-faded" : "over-faded") : (big ? "held it, big" : "held / under-faded");
  return curveAuto < 0 ? (big ? "well left" : "left") : (big ? "well right" : "right");
}

/** A derived result in one line for the Review row: `+2 long · 12 R`, `on · 3 L`; null without one. */
export function resultText(d) {
  if (!d || !Number.isFinite(d.distMissYds) || !Number.isFinite(d.latMissYds)) return null;
  const k = d.distClass ?? 0;
  const dist = k === 0 ? "on" : `${k > 0 ? "+" : "−"}${Math.abs(k)} ${k > 0 ? "long" : "short"}`;
  const lat = Math.round(Math.abs(d.latMissYds));
  return `${dist} · ${lat === 0 ? "0" : `${lat} ${d.latMissYds > 0 ? "R" : "L"}`}`;
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

/** v22.15 Review — remove one record by id (Delete stroke). Returns true when something went. */
export function deleteShot(storage, id, roundId) {
  const all = readShotsMap(storage);
  let hit = false;
  for (const rid of roundId != null ? [roundId] : Object.keys(all)) {
    const list = all[rid];
    if (!Array.isArray(list)) continue;
    const next = list.filter((r) => r.id !== id);
    if (next.length !== list.length) { all[rid] = next; hit = true; }
  }
  if (hit) writeShotsMap(storage, all);
  return hit;
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

/* ---------- v22.16 Shot Pattern imports (scripts/import-shotpattern.mjs → src/shotpattern.json) ---------- */

export const SHOTPATTERN_SOURCE = "shotpattern";

/* words that name the kind of place rather than the place: "Ironwood" ↔ "Ironwood Golf Club" */
const COURSE_NOISE = new Set(["golf", "club", "course", "country", "cc", "gc", "the", "links", "and", "at", "of"]);
function courseWords(name) {
  return String(name || "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter((w) => w && !COURSE_NOISE.has(w));
}

/** Two course names name the same club when one's distinctive words are all in the other's. */
export function sameCourse(a, b) {
  const x = courseWords(a), y = courseWords(b);
  if (!x.length || !y.length) return false;
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  return small.every((w) => big.includes(w));
}

/* A history date (ISO, UTC) is the same day as `ymd` in the phone's own calendar or in UTC. */
function sameDay(iso, ymd) {
  if (!iso || !ymd) return false;
  if (String(iso).slice(0, 10) === ymd) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local === ymd;
}

/**
 * The finished Loop round a Shot Pattern round was: same date and a matching course name
 * (sameCourse). Several on the day → the one whose total matches Shot Pattern's score, else the
 * first. null when none.
 */
export function matchHistoryRound(round, history) {
  if (!round) return null;
  const hits = (history || []).filter((r) => r && r.id && !r.deleted && sameDay(r.date, round.date) && sameCourse(r.course, round.course));
  if (!hits.length) return null;
  return hits.find((r) => Number.isFinite(round.score) && r.yourTotal === round.score) || hits[0];
}

/** The roundId a Shot Pattern round's records file under: the matching Loop round's id, else `sp:{key}`. */
export function spRoundIdFor(round, history) {
  const hit = matchHistoryRound(round, history);
  return hit ? hit.id : `sp:${round.key}`;
}

/**
 * Merges the bundled Shot Pattern records into `bogeyman-matches:shots:v1` by id. Idempotent:
 * a record whose id is already stored is never overwritten, and nothing is ever deleted. The one
 * move it makes: a record still filed under its fallback `sp:{key}` (no Loop round matched when it
 * was seeded — e.g. a fresh phone before the cloud history arrived) moves, content unchanged, to
 * the Loop round that now matches. Writes storage only when something changed.
 * → { added, moved, kept }.
 */
export function seedShotPatternRecords(storage, bundle, history = []) {
  const res = { added: 0, moved: 0, kept: 0 };
  if (!storage || !bundle || !Array.isArray(bundle.rounds)) return res;
  const all = readShotsMap(storage);
  const where = new Map();
  for (const [rid, list] of Object.entries(all)) if (Array.isArray(list)) list.forEach((r) => { if (r && r.id) where.set(r.id, rid); });
  for (const round of bundle.rounds) {
    if (!round || !Array.isArray(round.records)) continue;
    const rid = spRoundIdFor(round, history);
    const fallback = `sp:${round.key}`;
    for (const rec of round.records) {
      if (!rec || !rec.id) continue;
      const at = where.get(rec.id);
      if (at == null) {
        (all[rid] ||= []).push({ ...rec, roundId: rid });
        where.set(rec.id, rid);
        res.added++;
      } else if (at === fallback && rid !== fallback) {
        const list = all[at];
        const i = list.findIndex((r) => r && r.id === rec.id);
        const cur = list[i];
        list.splice(i, 1);
        if (!list.length) delete all[at];
        (all[rid] ||= []).push({ ...cur, roundId: rid });
        where.set(rec.id, rid);
        res.moved++;
      } else res.kept++;
    }
  }
  if (res.added || res.moved) writeShotsMap(storage, all);
  return res;
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
