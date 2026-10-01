/*
 * caddieState.js — the caddie screen's state and render model (UI addendum §2, §3.2–3.5, §6–§10,
 * §11.1). S3b.
 *
 * Three pieces, all pure (no DOM, no storage, no network) so the rules are Node-testable:
 *   1. caddieReducer — the round-level caddie state that app.jsx keeps and persists inside the
 *      round state `bogeyman-matches:v1` under `caddie` (§9.8). Holds INPUTS only (the fix, the
 *      chips, the pin, the toggle); the recommendation is recomputed from them on every render, so
 *      a reload restores the screen exactly without re-running GPS.
 *   2. caddieView — every string the rail, the details column, the bar and the notice show, as
 *      one object (§8 table, §10 copy). The React component renders this and nothing else, which
 *      is what T41 checks: the function has no ghost, match or segment input to leak.
 *   3. small helpers the component needs: aim short form (§10.2), pin presets and taps (§6), the
 *      club-brain synthetic hole (§8 Yards entered), pickers (§7.3), the 27-hole default mapping.
 */

import { dist, rect, ellipse } from "./course.js";
import { distances, pinFromTap, frameOf, holeKeyFor, clampToGreen } from "./geo.js";
import { parseLieChip } from "./context.js";
import { bboxYds, withEllipses, NOTICE_MARK_GREEN } from "./overlay.js";
import { markedPinPoint, NOTE_NO_HAZARDS } from "./greens.js";
import { DEFAULT_CONFIG } from "./config.js";
import { withinRound, applyShotLog, aggressionScorecard } from "./learning.js";

export const CADDIE_SCHEMA = 1;
export const PHASES = Object.freeze(["pretee", "locating", "ready", "nofix", "locationoff", "yards"]);
export const GPS_TIMEOUT_MS = 10000;
export const DASH = "—";

/* ---------- §10.1 copy ---------- */
export const COPY = Object.freeze({
  card: "‹ Card",
  details: "‹ Details",
  close: "Close ›",
  sameA: "Same shot",
  sameB: "both ways",
  finesse: "finesse",
  tee: "I'm on the tee",
  ball: "I'm at my ball",
  logShot: "Log shot",
  score: (n) => `Score hole ${n}`,
  logPutt: "Log putt",
  retry: "Try again",
  yards: "Enter yards",
  locating: "Locating",
  aimPreTee: "Tap I'm on the tee",
  aimLocating: "Locating",
  aimGreen: "On the green",
  aimNoFix: "No GPS fix",
  aimLocOff: "Location off",
  aimClubOnly: "Club only",
  aimNoMap: "No course map",
  aimNoProfile: "No profile",
  aimMark: "Tap the green",
  markHere: "Mark green here",          // v22.12: the fix, stored as this hole's green (no imagery needed)
  pinYds: (n) => `${n} yds to the pin`,
  done: "Done",
  useInferred: (v) => `Use inferred · ${v}`,
  pinNote: "Or tap the green on the map.",
  yardsTitle: "Yards to pin",
  use: (n) => `Use ${n}`,
  /* v22.15 shot log v2 */
  tapMap: "Tap the map…",
  aimTap: "Tap the map",
  onGreen: "On the green",
  shots: "Shots",
  line: "Line",
  shapes: [["draw", "Draw"], ["straight", "Straight"], ["fade", "Fade"]],
  review: "Review",
  saveAll: "Save all",
  later: "Later",
});
export const NOTICES = Object.freeze({
  nofix: "No GPS fix. Step into the open and tap Try again.",
  locationoff: "Location is off for Loop. Turn it on in Settings, then tap Try again.",
  noprofile: "Profile didn't load. Reconnect and tap Try again.",
  nomap: (n) => `No course map for hole ${n}. Enter yards for a club.`,
  /* v22.11 marked-green mode (no OSM geometry for the hole) */
  markPreTee: (n) => `No course map for hole ${n}. Tap I'm on the tee for satellite.`,
  markedPreTee: (n) => `Hole ${n}: green marked. Tap I'm on the tee for satellite.`,
  mark: NOTICE_MARK_GREEN,
  noHazards: NOTE_NO_HAZARDS,
  /* v22.12: an unmapped hole with a fix but no satellite says which part failed (overlay.js satelliteFailure) */
  noSatellite: (why) => `Satellite: ${why}. Enter yards for a club.`,
  /* v22.15 test mode (SPEC-shotlog-v2 §1) */
  testTap: "Test mode · tap the map where you are",
});

/* ---------- 1. state ---------- */

/** A fresh caddie for a round (§2: Start round → hole 1, pre-tee). */
export function initialCaddie(hole = 1) {
  return {
    v: CADDIE_SCHEMA,
    hole, shotNo: 1, phase: "pretee", prevPhase: null, trigger: null,
    ball: null,          // the GPS fix for the current ball: { lat, lng, accuracyM }
    ballXY: null,        // the same point in this hole's frame (the next shot's `from`)
    yards: null,         // club-brain mode (§8 Yards entered)
    opt: "safe", exp: false,
    chips: {},           // per ball: { lie, quality, elevation }   (§9.3)
    pins: {},            // per hole: { [hole]: "front" | "middle" | "back" | {lat,lng} | {x,y} }
    windOverride: null,  // per round: { direction, speed }
    conditionsOverride: null,
    shots: {},           // per hole: [{ from:{x,y}, to:{x,y} }]  (MapLayer previousShots)
    context: null,       // the last assembled ShotContext (snapshot for S4's shot record)
    logCard: null,       // S4: "log" (Log shot sheet open) | "prev" (blocking previous-shot prompt) | "putt" (putt card open) | null
    openShot: null,      // S4: the last logged (quick/full/skipped) ShotRecord awaiting §4.5 closeout
    putts: {},           // per hole: number of putts logged this hole (putt capture, Sep 28 spec)
    lastPuttFt: null,    // the last putt distance used THIS HOLE — the stepper's starting point; resets on a new hole
    pinView: false,      // v22.11: the map zoomed to the green with the draggable pin (transient, not persisted)
    remark: false,       // v22.11: marked-green mode is waiting for a re-tap of the green (transient, not persisted)
    /* v22.15 (SPEC-shotlog-v2 §1, §2, §4, §6) */
    awaitingTap: null,   // test mode: { action, trigger } — the next map tap is the fix (serialized, never restored)
    intent: {},          // this hole's pre-shot marks: { [hole]: { [shotNo]: { target, targetLabel, targetLL, startLineDeg, shape } } }
    lineMode: false,     // the rail's Line is armed: map taps set the start line (transient)
    greenHole: null,     // the hole Brett said he is on the green of (manual On the green, §6)
    review: null,        // the Review sheet: { hole, next } — next = "finish" | a 0-based hole index | null
  };
}

/** §2 caddie hole rule: the lowest-numbered hole with no score (1-based), or null when all are in. */
export function caddieHoleFor(scores) {
  const i = (scores || []).findIndex((s) => s == null);
  return i < 0 ? null : i + 1;
}

/** Moving to a new hole: pre-tee, shot 1, pin back to Middle, no previous shots (§6, §9.3, §9.10).
 *  `openShot` (§4.4/§4.5 hole-completion closeout) carries over on purpose — the caller closes it
 *  out (or auto-resolves it) against the completing hole before the next render; any open sheet is
 *  dismissed since it referred to a hole that's now behind us. */
function newHole(s, n) {
  const pins = { ...s.pins }; delete pins[n];
  return {
    ...s, hole: n, shotNo: 1, phase: "pretee", prevPhase: null, trigger: null,
    ball: null, ballXY: null, yards: null, opt: "safe", exp: false, chips: {}, pins, logCard: null,
    shots: { ...s.shots, [n]: [] }, context: null, lastPuttFt: null, pinView: false, remark: false,
    // v22.15: intents belong to the shots of one hole and are in their records by now
    awaitingTap: null, intent: {}, lineMode: false, greenHole: null,
  };
}

/** A new ball position: SAFE, rail collapsed, per-ball chips cleared (§9.1–9.3). Any Log-shot sheet
 *  or previous-shot prompt for the shot just left behind should already be resolved by this point
 *  (the "ball" tap is intercepted while one is pending — see `hasUnloggedShot`); clearing `logCard`
 *  here is defensive. */
const newBall = (s) => ({ ...s, opt: "safe", exp: false, chips: {}, logCard: null, pinView: false, remark: false, lineMode: false });

const PIN_PRESETS = ["front", "middle", "back"];
const isXY = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const isLL = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon);

export function caddieReducer(s, a) {
  switch (a.type) {
    case "tee":
    case "ball":
    case "green":        // v22.15 §6: the manual On the green takes a fix like I'm at my ball
    case "retry": {
      const trigger = a.type === "retry" ? (s.trigger || (s.ball || s.yards != null ? "ball" : "tee")) : a.type;
      // test mode (§1): `tap` arms the map — the next tap is the fix; the phase is Locating meanwhile
      const awaitingTap = a.tap ? { action: a.type, trigger } : null;
      return { ...s, phase: "locating", prevPhase: s.phase === "locating" ? s.prevPhase : s.phase, trigger, pinView: false, lineMode: false, awaitingTap };
    }
    /* test mode, Mark green here (§1): the next tap is where the green is — no fix, no shot */
    case "awaitMark":
      return { ...s, awaitingTap: { action: "mark", trigger: null }, pinView: false, lineMode: false };
    case "tapDone":
      return s.awaitingTap ? { ...s, awaitingTap: null } : s;
    case "fix": {
      // a.fix = { lat, lng, accuracyM }; a.point = {x,y} in the (possibly new) hole's frame; a.hole = detected hole
      let t = s;
      if (a.hole != null && a.hole !== s.hole) t = newHole(s, a.hole);
      const trigger = t === s ? s.trigger || "ball" : "tee";
      const point = isXY(a.point) ? { x: a.point.x, y: a.point.y } : null;
      if (trigger === "tee") {
        return newBall({ ...t, phase: "ready", prevPhase: null, trigger, shotNo: 1, ball: a.fix, ballXY: point, yards: null, shots: { ...t.shots, [t.hole]: [] }, awaitingTap: null, greenHole: null });
      }
      const prev = t.shots[t.hole] || [];
      const shots = t.ballXY && point ? [...prev, { from: t.ballXY, to: point }] : prev;
      const greenHole = trigger === "green" ? t.hole : t.greenHole;
      return newBall({ ...t, phase: "ready", prevPhase: null, trigger: trigger === "green" ? "ball" : trigger, shotNo: t.shotNo + 1, ball: a.fix, ballXY: point, yards: null,
        shots: { ...t.shots, [t.hole]: shots }, awaitingTap: null, greenHole });
    }
    case "fixError":
      // v22.15 §6: On the green with no fix still puts Brett on the green (the shot closes with no end)
      if (s.trigger === "green") {
        const back = s.prevPhase && s.prevPhase !== "locating" ? s.prevPhase : s.ball ? "ready" : s.yards ? "yards" : "pretee";
        return { ...s, phase: back, prevPhase: null, trigger: "ball", awaitingTap: null, greenHole: s.hole, shotNo: s.shotNo + 1 };
      }
      return { ...s, phase: a.code === 1 ? "locationoff" : "nofix", prevPhase: null, awaitingTap: null };
    case "yards": {
      const n = Math.round(a.yards);
      if (!(n > 0)) return s;
      // v22.12: `same` = yards for the ball Brett is standing at (the rail's Enter yards on a hole
      // with no map): the shot number, the fix and the chips stay; only the distance is new.
      if (a.same && ((s.phase === "ready" && s.ball) || s.phase === "yards")) {
        return { ...s, phase: "yards", prevPhase: null, yards: n, pinView: false, remark: false };
      }
      const fresh = s.phase === "pretee" || ((s.phase === "nofix" || s.phase === "locationoff" || s.phase === "locating") && s.trigger === "tee");
      return newBall({ ...s, phase: "yards", prevPhase: null, trigger: fresh ? "tee" : "ball", shotNo: fresh ? 1 : s.shotNo + 1, ball: null, ballXY: null, yards: n });
    }
    case "opt":
      return a.opt === "safe" || a.opt === "aggressive" ? { ...s, opt: a.opt } : s;
    case "exp":
      return { ...s, exp: !!a.exp };
    case "chip": {
      const v = a.value ?? null;
      if (a.key === "wind") return { ...s, windOverride: v };
      if (a.key === "conditions") return { ...s, conditionsOverride: v };
      if (a.key === "pin") return setPin(s, v);
      if (a.key === "lie" || a.key === "quality" || a.key === "elevation") {
        const chips = { ...s.chips };
        if (v == null) delete chips[a.key]; else chips[a.key] = v;
        return { ...s, chips };
      }
      return s;
    }
    case "pin":
      return setPin(s, a.value ?? null);
    case "scores": {
      const cur = a.scores?.[s.hole - 1];
      if (cur == null) return s;                       // editing an earlier hole never moves the caddie
      const n = caddieHoleFor(a.scores);
      return n == null ? s : newHole(s, n);
    }
    case "hole":
      return Number.isInteger(a.hole) && a.hole >= 1 && a.hole <= 18 ? newHole(s, a.hole) : s;
    case "context":
      return { ...s, context: a.context ?? null };
    /* ---------- S4: shot-log capture flow (§4.2–§4.5) ---------- */
    /* logOpen: show the Log-shot card for the current ball. v22.15 (SPEC-shotlog-v2 §3): the
       blocking previous-shot prompt (§4.4 step 2) is gone — a shot closes itself with an auto
       record, so there is only ever the optional card. */
    case "logOpen":
      return { ...s, logCard: "log" };
    /* logDismiss: close the Log-shot sheet without writing anything. */
    case "logDismiss":
      return s.logCard === "log" ? { ...s, logCard: null } : s;
    /* logSave / logSkip: a.record is a full ShotRecord already built by the caller (quickLog,
       detailLog or skipShot from shotlog.js) and already written to storage. It becomes the
       `openShot` awaiting §4.5 closeout on the next fix or hole completion. */
    case "logSave":
    case "logSkip":
      return a.record ? { ...s, logCard: null, openShot: a.record } : s;
    /* logClosed: the caller has computed closeOutShot(openShot, ...) and saved the result — clear
       the slot so a new long shot can occupy it. */
    case "logClosed":
      return { ...s, openShot: null };
    /* ---------- putt capture (Sep 28 spec) ---------- */
    /* puttOpen: the outlined "Log putt" pill on the green, or reopening the card for a second putt. */
    case "puttOpen":
      return { ...s, logCard: "putt" };
    /* puttSave: a.record is already built (newPuttRecord / quickMade) and already written to
       storage by the caller. Increments that hole's putt count and remembers the distance for the
       stepper's next starting point. */
    case "puttSave": {
      if (!a.record) return s;
      const hole = Number.isInteger(a.record.hole) ? a.record.hole : s.hole;
      const putts = { ...s.putts, [hole]: (s.putts[hole] || 0) + 1 };
      const ft = a.record.putt?.distanceFt;
      const lastPuttFt = Number.isFinite(ft) ? ft : s.lastPuttFt;
      return { ...s, logCard: null, putts, lastPuttFt };
    }
    /* puttDismiss: Skip, or the scrim — closes the card, writes nothing. */
    case "puttDismiss":
      return s.logCard === "putt" ? { ...s, logCard: null } : s;
    /* ---------- v22.11 ---------- */
    /* pinView: the flag button / Done. Opening it collapses the rail (the camera leaves the shot). */
    case "pinView":
      return a.on ? { ...s, pinView: true, exp: false, remark: false } : (s.pinView ? { ...s, pinView: false } : s);
    /* remark: a long-press on a marked green re-opens the mark view; greenMarked closes it. */
    case "remark":
      return { ...s, remark: !!a.on, pinView: false };
    case "greenMarked": {
      // a custom pin belonged to the old mark; the new green starts at Middle
      const pins = { ...s.pins };
      if (pins[s.hole] && typeof pins[s.hole] === "object") delete pins[s.hole];
      return { ...s, remark: false, pins };
    }
    /* ---------- v22.15 shot log v2 ---------- */
    /* intent: a.patch merges into this shot's marks (a.hole / a.shotNo default to the caddie's);
       a null value clears that mark. */
    case "intent": {
      const hole = Number.isInteger(a.hole) ? a.hole : s.hole, shotNo = Number.isInteger(a.shotNo) ? a.shotNo : s.shotNo;
      const cur = { ...(s.intent?.[hole]?.[shotNo] || {}) };
      for (const [k, v] of Object.entries(a.patch || {})) { if (v == null) delete cur[k]; else cur[k] = v; }
      const forHole = { ...(s.intent?.[hole] || {}) };
      if (Object.keys(cur).length) forHole[shotNo] = cur; else delete forHole[shotNo];
      return { ...s, intent: { ...s.intent, [hole]: forHole } };
    }
    case "lineMode":
      return { ...s, lineMode: !!a.on, pinView: a.on ? false : s.pinView };
    case "reviewOpen":
      return Number.isInteger(a.hole) ? { ...s, review: { hole: a.hole, next: a.next ?? null } } : s;
    case "reviewClose":
      return s.review ? { ...s, review: null } : s;
    /* lines: the previous-shot lines for a hole rebuilt from its (edited) records */
    case "lines":
      return Number.isInteger(a.hole) && Array.isArray(a.lines) ? { ...s, shots: { ...s.shots, [a.hole]: a.lines.filter((x) => isXY(x?.from) && isXY(x?.to)) } } : s;
    case "restore":
      return restoreCaddie(a.state) || s;
    default:
      return s;
  }
}

function setPin(s, v) {
  const pins = { ...s.pins };
  if (v == null || v === "middle") delete pins[s.hole];
  else if (PIN_PRESETS.includes(v)) pins[s.hole] = v;
  else if (isLL(v)) pins[s.hole] = { lat: v.lat, lng: v.lng ?? v.lon };
  else if (isXY(v)) pins[s.hole] = { x: v.x, y: v.y };
  else return s;
  return { ...s, pins };
}

/** The pin setting in effect on the caddie's hole (§6: Middle unless Brett moved it). */
export const pinSetting = (s, hole = s.hole) => s.pins?.[hole] ?? "middle";

/** v22.15 §1 — a test-mode tap becomes a fix of exactly the real shape (accuracy 4 m). */
export const FAKE_ACCURACY_M = 4;
export function fakeFix(p) {
  const lng = p?.lng ?? p?.lon;
  return p && Number.isFinite(p.lat) && Number.isFinite(lng) ? { lat: p.lat, lng, accuracyM: FAKE_ACCURACY_M } : null;
}

/** v22.15 §2 — the marks Brett set for a shot (none → {}). */
export const intentSet = (s, hole = s.hole, shotNo = s.shotNo) => s.intent?.[hole]?.[shotNo] || {};

/* ---------- persistence (§9.8, §11.1, T42) ---------- */

/** What goes into the round state's `caddie` key. `context` = the ShotContext on screen (a snapshot). */
export function serializeCaddie(s, context = s?.context ?? null) {
  if (!s) return null;
  const { v, hole, shotNo, phase, prevPhase, trigger, ball, ballXY, yards, opt, exp, chips, pins, windOverride, conditionsOverride, shots, logCard, openShot, putts, lastPuttFt,
    awaitingTap, intent, greenHole, review } = s;
  return { v, hole, shotNo, phase, prevPhase, trigger, ball, ballXY, yards, opt, exp, chips, pins, windOverride, conditionsOverride, shots, context, logCard, openShot, putts, lastPuttFt,
    awaitingTap: awaitingTap ?? null, intent: intent ?? {}, greenHole: greenHole ?? null, review: review ?? null };
}

/**
 * Back from storage, validated. A reload mid-Locating comes back to where it was before the tap
 * (no automatic GPS re-fix on resume, §9.8). Returns null when the value is not a caddie state.
 */
export function restoreCaddie(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== CADDIE_SCHEMA) return null;
  const s = initialCaddie(Number.isInteger(raw.hole) && raw.hole >= 1 && raw.hole <= 18 ? raw.hole : 1);
  s.shotNo = Number.isInteger(raw.shotNo) && raw.shotNo >= 1 ? raw.shotNo : 1;
  s.ball = isLL(raw.ball) ? { lat: raw.ball.lat, lng: raw.ball.lng ?? raw.ball.lon, accuracyM: Number.isFinite(raw.ball.accuracyM) ? raw.ball.accuracyM : null } : null;
  s.ballXY = isXY(raw.ballXY) ? { x: raw.ballXY.x, y: raw.ballXY.y } : null;
  s.yards = Number.isFinite(raw.yards) && raw.yards > 0 ? raw.yards : null;
  let phase = PHASES.includes(raw.phase) ? raw.phase : "pretee";
  if (phase === "locating") phase = PHASES.includes(raw.prevPhase) && raw.prevPhase !== "locating" ? raw.prevPhase : s.ball ? "ready" : s.yards ? "yards" : "pretee";
  if (phase === "ready" && !s.ball) phase = "pretee";
  if (phase === "yards" && !s.yards) phase = "pretee";
  s.phase = phase;
  s.trigger = raw.trigger === "tee" || raw.trigger === "ball" ? raw.trigger : null;
  s.opt = raw.opt === "aggressive" ? "aggressive" : "safe";
  s.exp = !!raw.exp;
  s.chips = {};
  for (const k of ["lie", "quality"]) if (typeof raw.chips?.[k] === "string") s.chips[k] = raw.chips[k];
  if (Number.isFinite(raw.chips?.elevation)) s.chips.elevation = raw.chips.elevation;
  s.pins = {};
  for (const [k, v] of Object.entries(raw.pins || {})) if (PIN_PRESETS.includes(v) || isLL(v) || isXY(v)) s.pins[k] = v;
  s.windOverride = raw.windOverride && typeof raw.windOverride === "object" ? raw.windOverride : null;
  s.conditionsOverride = ["firm", "normal", "wet"].includes(raw.conditionsOverride) ? raw.conditionsOverride : null;
  s.shots = {};
  for (const [k, list] of Object.entries(raw.shots || {})) if (Array.isArray(list)) s.shots[k] = list.filter((x) => isXY(x?.from) && isXY(x?.to));
  s.context = raw.context && typeof raw.context === "object" ? raw.context : null;
  // v22.15: the old blocking prompt ("prev") is gone; a reload that had it open comes back to the screen
  s.logCard = raw.logCard === "log" || raw.logCard === "putt" ? raw.logCard : null;
  s.openShot = raw.openShot && typeof raw.openShot === "object" && typeof raw.openShot.id === "string"
    && Number.isInteger(raw.openShot.hole) && Number.isInteger(raw.openShot.shotNo) ? raw.openShot : null;
  s.putts = {};
  for (const [k, v] of Object.entries(raw.putts || {})) if (Number.isInteger(v) && v >= 0) s.putts[k] = v;
  s.lastPuttFt = Number.isFinite(raw.lastPuttFt) && raw.lastPuttFt > 0 ? raw.lastPuttFt : null;
  /* v22.15. awaitingTap is never restored: like Locating, a reload comes back to before the tap
     (the phase above already did that), and the tap's handler did not survive the reload. */
  s.intent = {};
  for (const [h, per] of Object.entries(raw.intent || {})) {
    if (!per || typeof per !== "object") continue;
    const out = {};
    for (const [n, it] of Object.entries(per)) {
      if (!it || typeof it !== "object") continue;
      const m = {};
      if (isXY(it.target)) m.target = { x: it.target.x, y: it.target.y };
      if (typeof it.targetLabel === "string") m.targetLabel = it.targetLabel;
      if (isLL(it.targetLL)) m.targetLL = { lat: it.targetLL.lat, lng: it.targetLL.lng ?? it.targetLL.lon };
      if (Number.isFinite(it.startLineDeg)) m.startLineDeg = it.startLineDeg;
      if (isLL(it.lineLL)) m.lineLL = { lat: it.lineLL.lat, lng: it.lineLL.lng ?? it.lineLL.lon };
      if (["draw", "straight", "fade"].includes(it.shape)) m.shape = it.shape;
      if (Object.keys(m).length) out[n] = m;
    }
    if (Object.keys(out).length) s.intent[h] = out;
  }
  s.greenHole = Number.isInteger(raw.greenHole) && raw.greenHole === s.hole ? raw.greenHole : null;
  s.review = raw.review && Number.isInteger(raw.review.hole) && raw.review.hole >= 1 && raw.review.hole <= 18
    ? { hole: raw.review.hole, next: raw.review.next === "finish" || (Number.isInteger(raw.review.next) && raw.review.next >= 0 && raw.review.next < 18) ? raw.review.next : null }
    : null;
  return s;
}

/* ---------- 3a. pin (§6, T35) ---------- */

/** The pin point {x,y} for a setting from `from` (the ball, or the tee pre-shot). null without a hole. */
export function pinPointFor(hole, from, setting = "middle") {
  if (!hole?.green?.ring) return null;
  // v22.11: a marked green's presets are ±10 yds along ball → green (greens.js), not thirds
  if (hole.synthetic) {
    const q = markedPinPoint(hole, setting || "middle", from || hole.tee);
    return q && typeof setting === "object" ? clampToGreen(hole, q) : q;
  }
  const d = distances(hole, from || hole.tee || { x: 0, y: 0 }, setting || "middle");
  return d ? d.pinPoint : null;
}

/**
 * A map tap → the value to store as the custom pin, or null when the tap was not on the green or
 * within 3 yds of it. Clamped inside the green (geo.js pinFromTap). Stored as {lat,lng} when the hole
 * has a frame (addendum §11.1), else as the frame point.
 */
export function pinFromMapTap(hole, p) {
  const q = pinFromTap(hole, p);
  if (!q) return null;
  const F = frameOf(hole);
  if (!F) return { x: q.x, y: q.y };
  const g = F.toLatLng(q);
  return { lat: g.lat, lng: g.lon };
}

/**
 * v22.11 B.2 — the pin view's drag released at frame point p → the custom pin to store, clamped
 * inside the green (geo.js clampToGreen, the same clamp the tap path uses — a drag may end
 * anywhere, so there is no 3-yd gate). {lat,lng} when the hole has a frame, else {x,y}.
 */
export function pinFromDrag(hole, p) {
  if (!hole?.green?.ring || !isXY(p)) return null;
  const q = clampToGreen(hole, p);
  const F = frameOf(hole);
  if (!F) return { x: q.x, y: q.y };
  const g = F.toLatLng(q);
  return { lat: g.lat, lng: g.lon };
}

/* ---------- 3b. aim short form (§10.2) ---------- */

/** Where `p` sits on the green, seen from `from`: { v: front|middle|back, h: left|""|right }. Thirds of the green's depth and width. */
export function greenPosition(green, from, p) {
  const c = green.center;
  const L = dist(from, c) || 1;
  const dir = { x: (c.x - from.x) / L, y: (c.y - from.y) / L };
  const right = { x: dir.y, y: -dir.x };
  const along = (q) => (q.x - c.x) * dir.x + (q.y - c.y) * dir.y;
  const lat = (q) => (q.x - c.x) * right.x + (q.y - c.y) * right.y;
  const ring = (green.ring || []).map(([x, y]) => ({ x, y }));
  const as = ring.map(along), ls = ring.map(lat);
  const depth = as.length ? Math.max(...as) - Math.min(...as) : 24;
  const width = ls.length ? Math.max(...ls) - Math.min(...ls) : 24;
  const a = along(p), l = lat(p);
  const tA = Math.max(1.5, depth / 6), tL = Math.max(1.5, width / 6);
  return { v: a < -tA ? "front" : a > tA ? "back" : "middle", h: l < -tL ? "left" : l > tL ? "right" : "" };
}

const NINE = {
  "front|left": "Front-left", "front|": "Front", "front|right": "Front-right",
  "middle|left": "Left side", "middle|": "Center", "middle|right": "Right side",
  "back|left": "Back-left", "back|": "Back", "back|right": "Back-right",
};

/**
 * §10.2 — the rail's short aim from an engine option. Layup → `Leave {n}`; an approach at the
 * green → one of nine positions from the target relative to the green centre; a fairway shot off
 * the tee (corridor) → Left-center / Center / Right-center.
 */
export function aimShort(option, { ball, green } = {}) {
  if (!option?.target) return DASH;
  const label = String(option.target.label || "");
  const leave = /leave (\d+)/i.exec(label);
  if (option.kind === "layup") return leave ? `Leave ${leave[1]}` : "Layup";
  if (option.kind === "corridor") {
    const m = /(\d+) (left|right) of center/i.exec(label);
    if (m && Number(m[1]) >= 4) return m[2].toLowerCase() === "left" ? "Left-center" : "Right-center";
    return "Center";
  }
  if (green && ball) {
    const g = greenPosition(green, ball, option.target);
    return NINE[`${g.v}|${g.h}`];
  }
  return "Center";
}

/* ---------- 3c. names and numbers ---------- */

const CLUB_SHORT = { Dr: "Driver", "2i": "2-iron", "2Hy": "2-hybrid", "4Hy": "4-hybrid", "5i": "5-iron", "6i": "6-iron", "7i": "7-iron", "8i": "8-iron", "9i": "9-iron", PW: "PW", GW: "GW", SW: "SW", LW: "LW" };
/** Rail / table club name (the reference's `PW`, `9-iron`, `2-hybrid`). */
export const clubShort = (id, label) => CLUB_SHORT[id] || label || String(id ?? DASH);

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : null; };
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/**
 * §5.6 — the dispersion line for the drawn ellipse of an option. Before takeover it reads Shot
 * Pattern's source (`Shot Pattern · 80% · Sep 19`, or `Profile spread · 80%` with no ellipse);
 * after the §5.2 takeover the ellipse is Loop's own: `Loop · 80% · {n} shots`.
 */
export function dispersionLine(o) {
  if (!o?.ell) return null;
  const b = bboxYds(o.ell);
  const n = o.ell.n ?? o.learningN ?? null;
  const src = o.ell.source === "shotPattern"
    ? ["Shot Pattern", "80%", shortDate(o.ell.capturedAt)].filter(Boolean).join(" · ")
    : o.ell.source === "loop" ? (n != null ? `Loop · 80% · ${n} shots` : "Loop · 80%") : "Profile spread · 80%";
  return { club: clubShort(o.club, o.label), w: Math.round(b.w), d: Math.round(b.d), source: src + (o.ell.scaled ? " · +15% bad lie" : "") };
}

/**
 * overlay.js `withEllipses`, plus the shot count a Loop ellipse was fitted from (ellipseFromEntry
 * does not carry it): `ell.n` from the resolved entry's ell80 when that ellipse is Loop's (§5.6).
 */
export function ellipsesFor(res, resolve, opts = {}) {
  const out = withEllipses(res, resolve, opts);
  const addN = (o) => {
    if (!o?.ell || o.ell.source !== "loop") return o;
    const e = resolve(o.club, o.swingType);
    const n = e?.ell80?.n ?? null;
    return n != null ? { ...o, ell: { ...o.ell, n } } : o;
  };
  return { safe: addN(out.safe), aggressive: addN(out.aggressive) };
}

/* ---------- 3c'. the learning loop (spec §5.2–§5.7, S5) ---------- */

/**
 * §5.5 — this round's closed-out shots → the engine ctx with `adjust`, `nudges` and `flags`.
 * Recomputed from the shot log before every recommend(); nothing is stored and nothing reaches
 * the profile (§5.5: the round's shots enter the profile through §5.3 after the round).
 */
export function withinRoundCtx(ctx, shotsThisRound, P, config) {
  if (!ctx || !P) return ctx;
  const w = withinRound(shotsThisRound || [], config || P.config, { P, lie: ctx.lieType });
  return { ...ctx, adjust: w.adjust, nudges: w.nudges, flags: w.flags };
}

/** §5.3 rounds-ago for each finished round: newest = 1, by date (ties: later in the list is newer). */
export function roundIndexFromHistory(history) {
  const list = (history || []).map((r, i) => ({ id: r?.id, t: Date.parse(r?.date) || 0, i })).filter((r) => r.id != null);
  list.sort((a, b) => b.t - a.t || b.i - a.i);
  const out = {};
  list.forEach((r, k) => { if (out[r.id] == null) out[r.id] = k + 1; });
  return out;
}

/**
 * §5.2–§5.4 — the per-entry overlays for profile.js `loadProfile(json, config, { overlays })`.
 * Only FINISHED rounds count: the round in progress is not in `history`, so applyShotLog weighs
 * its shots 0 (it is the within-round layer's, §5.5), and so do shots of deleted rounds.
 */
export function learningOverlays(P, shots, history, now) {
  if (!P) return null;
  const ovs = applyShotLog(P, shots || [], { now, roundIndexById: roundIndexFromHistory(history) }, P.config);
  return Object.keys(ovs).length ? ovs : null;
}

/** The rail's `Today` lines (addendum §3.3 item 6): one per nudge, then one per flag. */
export function todayLines(res) {
  if (!res) return [];
  return [...(res.nudges || []), ...(res.flags || [])].map((x) => String(x?.text || "")).filter(Boolean);
}

const LINE_LABELS = [["safe", "Safe"], ["aggressive", "Aggressive"], ["own", "Own call"]];

/** One tally (learning.js aggressionScorecard, season or a round) → what Summary / History print. null when no shots. */
export function aggressionView(t) {
  if (!t) return null;
  const counts = LINE_LABELS.map(([k, label]) => ({ key: k, label, n: t[k]?.n || 0 }));
  if (!counts.some((c) => c.n > 0)) return null;
  const m = t.text ? /^(.*) ([+−-]\d+(?:\.\d+)?)$/.exec(t.text) : null;
  return { text: t.text || null, word: m ? m[1] : null, amount: m ? m[2] : null, counts };
}

/**
 * §5.7 — the aggression scorecard for display. `shots` = saved shot records, `history` = finished
 * rounds (hole scores from `holeScores`), `extra` = { [roundId]: holeScores } for a round whose
 * scores are live (the Summary screen). Skipped shots are left out: their line was never
 * confirmed. Only rounds that exist (history or extra) count toward the season.
 * → { season: view | null, rounds: { [roundId]: view | null } }. Display only.
 */
export function aggressionModel(shots, history, extra = {}) {
  const holeScores = {};
  for (const r of history || []) if (r?.id) holeScores[r.id] = r.holeScores || [];
  for (const [id, sc] of Object.entries(extra || {})) holeScores[id] = sc;
  const list = (shots || []).filter((s) => s && s.logged !== "skipped" && holeScores[s.roundId] != null);
  const sc = aggressionScorecard(list, holeScores);
  const rounds = {};
  for (const [id, t] of Object.entries(sc.rounds)) rounds[id] = aggressionView(t);
  return { season: aggressionView(sc), rounds };
}

/* ---------- 3d. chips (§7.1, §7.2) ---------- */

const WIND_DIRS = ["into", "helping", "from left", "from right", "calm"];
const WIND_SPEEDS = [0, 5, 10, 15, 20];
const speedLabel = (n) => (n >= 20 ? "20+" : String(n));
/** A wind chip Brett set: `10 into`, `20+ helping`, `15 from L`, `Calm` (short: it is written in a 111-px cell). */
const CHIP_DIR = { into: "into", helping: "helping", "from left": "from L", "from right": "from R" };
export function windChipText(w) {
  if (!w) return DASH;
  const d = String(w.direction || "").toLowerCase();
  if (d === "calm" || !(w.speed > 0)) return "Calm";
  return `${speedLabel(w.speed)} ${CHIP_DIR[d] || d}`;
}
/** engine.js windEffect's `relative` → chip words: `into-left`, `help-right`, `from right`. */
const REL = { down: "helping", "down-left": "help-left", "down-right": "help-right", "cross-from-left": "from left", "cross-from-right": "from right" };
/**
 * Inferred wind (engine context.wind): `8 into-left`; null → Calm; undefined (no weather) → —.
 * A fresh temperature reading is appended to whatever the wind reads (§3.3): `8 into-left · 58°`,
 * `Calm · 58°`, or `— · 58°` when there is no wind data at all; nothing appended when there is no
 * temperature reading either.
 */
export function windText(w, tempF) {
  const suffix = Number.isFinite(tempF) ? ` · ${Math.round(tempF)}°` : "";
  if (w === undefined) return DASH + suffix;
  if (!w || !(w.speedMph > 0)) return "Calm" + suffix;
  return `${Math.round(w.speedMph)} ${REL[w.relative] || w.relative || ""}`.trim() + suffix;
}
export const elevText = (n) => (Number.isFinite(n) ? `${signed(Math.round(n))} yds` : DASH);

/**
 * The six chips. inferred = { lieType, lieConfidence, quality, wind, elevation, conditions, tempF }
 * as Loop worked them out (no Brett input); a key missing from `inferred` shows —. `tempF` has no
 * chip of its own (§3.3) — it rides along on the Wind chip's text.
 */
export function chipList({ chips = {}, pin = "middle", windOverride = null, conditionsOverride = null, inferred = null } = {}) {
  const inf = inferred || {};
  const has = !!inferred;
  const lieEdited = chips.lie != null;
  const pinEdited = pin != null && pin !== "middle";
  return [
    { key: "lie", label: "Lie", edited: lieEdited, value: lieEdited ? cap(chips.lie) : has && inf.lieType ? cap(inf.lieType) : DASH,
      unsure: !lieEdited && has && inf.lieConfidence === "low", inferredValue: has && inf.lieType ? cap(inf.lieType) : null },
    { key: "quality", label: "Quality", edited: chips.quality != null, value: cap(chips.quality ?? "standard"), inferredValue: "Standard" },
    { key: "wind", label: "Wind", edited: windOverride != null, value: windOverride != null ? windChipText(windOverride) : has ? windText(inf.wind, inf.tempF) : DASH,
      inferredValue: has ? windText(inf.wind, inf.tempF) : null },
    { key: "elevation", label: "Elevation", edited: Number.isFinite(chips.elevation), value: Number.isFinite(chips.elevation) ? elevText(chips.elevation) : has ? elevText(inf.elevation ?? 0) : DASH,
      inferredValue: has ? elevText(inf.elevation ?? 0) : null },
    { key: "pin", label: "Pin", edited: pinEdited, value: typeof pin === "string" ? cap(pin) : "Custom", inferredValue: "Middle" },
    { key: "conditions", label: "Conditions", edited: conditionsOverride != null, value: cap(conditionsOverride ?? inf.conditions ?? "normal"),
      inferredValue: cap(inf.conditions ?? "normal") },
  ];
}

/**
 * §7.3 — the bottom sheet for one chip. current = the value in effect (as stored); edited = Brett
 * changed it. Returns { title, options, speeds?, inferredLabel, note }. Option values are what the
 * reducer's `chip` action stores.
 */
export function pickerModel(key, { chip, current } = {}) {
  const opt = (label, value, cur) => ({ label, value, current: !!cur });
  const inferredLabel = chip?.edited && chip.inferredValue ? COPY.useInferred(chip.inferredValue) : null;
  switch (key) {
    case "lie": {
      const eff = String(current || "").toLowerCase();
      return { key, title: "Lie", options: ["tee", "fairway", "rough", "sand", "recovery"].map((v) => opt(cap(v), v, v === eff)), inferredLabel, note: null };
    }
    case "quality": {
      const eff = String(current || "standard").toLowerCase();
      return { key, title: "Quality", options: ["good", "standard", "bad", "buried"].map((v) => opt(cap(v), v, v === eff)), inferredLabel, note: null };
    }
    case "wind": {
      const w = current || null;
      const dir = w ? String(w.direction || "").toLowerCase() : null;
      return {
        key, title: "Wind",
        options: WIND_DIRS.map((v) => opt(cap(v), v, w && (v === dir || (v === "calm" && !(w.speed > 0))))),
        speeds: WIND_SPEEDS.map((n) => opt(speedLabel(n), n, w && w.speed === n && dir !== "calm")),
        inferredLabel, note: null,
      };
    }
    case "elevation":
      return { key, title: "Elevation", options: [-10, -5, 0, 5, 10].map((n) => opt(signed(n), n, Number.isFinite(current) && current === n)), inferredLabel, note: null };
    case "pin": {
      const eff = typeof current === "string" ? current : "custom";
      return { key, title: "Pin", options: ["front", "middle", "back"].map((v) => opt(cap(v), v, v === eff)), inferredLabel, note: COPY.pinNote };
    }
    case "conditions": {
      const eff = String(current || "normal").toLowerCase();
      return { key, title: "Conditions", options: ["firm", "normal", "wet"].map((v) => opt(cap(v), v, v === eff)), inferredLabel, note: null };
    }
    default:
      return null;
  }
}

/* ---------- 3e. club-brain mode (§8 Yards entered, engine §6.1) ---------- */

/**
 * A straight hole of `yds` in the course.js frame, no hazards and no OB: tee at the origin, a
 * 40-yd fairway, a 28 × 24 green centred on the pin. Profile-only recommendations run on it.
 */
export function syntheticHole(yds, par = 4) {
  const n = Math.max(20, Math.round(yds));
  return {
    id: "yards", key: "yards", par, yards: n,
    tee: { x: 0, y: 0 },
    green: { ring: ellipse(0, n, 12, 14, 32), center: { x: 0, y: n } },
    fairways: n > 60 ? [rect(-20, Math.min(30, n / 4), 20, n - 14)] : [],
    tees: [rect(-5, -5, 5, 5)],
    hazards: [], boundary: null,
  };
}

/**
 * The engine ctx for club-brain mode (the ball at the synthetic tee; chips still apply). `tempF`
 * is club-brain's only weather input — it needs no GPS or geometry, only a fresh reading (the
 * caller derives it with sensors.js `weatherTempF`; §3.3 applies to this path too).
 */
export function clubBrainContext({ holeNo, par, shotNo, chips = {}, windOverride = null, conditionsOverride = null, tempF = null }) {
  const lc = parseLieChip(chips.lie);
  const lieType = lc ? lc.lieType : shotNo <= 1 ? "tee" : "fairway";
  return {
    hole: holeNo, par, shotNo, ball: { x: 0, y: 0 },
    lieType, lieQuality: chips.quality || "standard", lieConfidence: lc ? "high" : "low",
    conditions: conditionsOverride || "normal", pinPos: "middle",
    wind: windOverride ? windFromChip(windOverride) : null,
    elevationDeltaYds: Number.isFinite(chips.elevation) ? chips.elevation : 0,
    tempF: Number.isFinite(tempF) ? tempF : null,
    meta: { trigger: shotNo <= 1 ? "tee" : "ball", sources: { lie: lc ? "chip" : "default", ball: "yards" } },
  };
}
/** Wind chip on the synthetic hole: the shot runs up the frame, so the chip's direction is the frame's. */
function windFromChip(w) {
  const d = String(w.direction || "").toLowerCase();
  if (d === "calm" || !(w.speed > 0)) return null;
  const off = { into: 0, helping: 180, "from left": 270, "from right": 90 }[d];
  return off == null ? null : { speedMph: w.speed, fromDeg: off };
}

/* ---------- 3f. the MapLayer input (T38) ---------- */

/** The option drawn and the one ghosted beside it. sameShot → one option, no ghost line. */
export function overlayPair(options, active = "safe", sameShot = false) {
  if (!options) return { active: null, other: null };
  const opt = sameShot ? options.safe || options.aggressive || null : options[active] || options.safe || null;
  const other = sameShot ? null : options[active === "aggressive" ? "safe" : "aggressive"] || null;
  return { active: opt, other };
}

/**
 * What MapLayer gets for a view state (§8 Map column): ball / options only when there is a live
 * recommendation; `fitBall` keeps the last camera for No GPS fix, Locating and Yards entered.
 */
export function mapInput({ state, view, ballXY = null, accuracyM = null, options = null, sameShot = false, pin = null, previousShots = [] }) {
  const live = view === "ready" || view === "sameshot";
  const showBall = live || view === "green";
  return {
    ball: showBall ? ballXY : null,
    accuracyM: showBall ? accuracyM : null,
    options: live ? (sameShot ? { safe: options?.safe || null, aggressive: null } : options) : null,
    active: state?.opt || "safe",
    sameShot: !!sameShot,
    pin,
    previousShots: previousShots || [],
    fitBall: ballXY,
    fitOptions: live ? options : null,
  };
}

/* ---------- 2. the render model (§8, §10; T41) ---------- */

/**
 * Every word and number the caddie screen shows, from:
 *   state (reducer), par, profileOk, mapOk, res (recommend output | null), options (withEllipses),
 *   inferred (chip defaults, see chipList), onGreen, ballXY + green (aim), config.
 * Nothing about the ghost, the match or the segments is an input, so nothing about them can show.
 * view: noprofile | nomap | pretee | locating | ready | sameshot | green | nofix | locationoff | yards.
 */
export function caddieView({
  state, par = null, profileOk = true, mapOk = true, res = null, options = null, inferred = null, onGreen = false,
  ballXY = null, green = null, config = DEFAULT_CONFIG,
  markable = false, greenMarked = false, synthetic = false, pinYds = null, satFailure = null,
  greenManual = false, unreviewed = 0,
}) {
  const s = state;
  const holeNo = s.hole;
  let view;
  // v22.15 §6: Brett said he is on the green of this hole (manual On the green) — the putt card's
  // state whatever the map can or cannot see
  const saidGreen = s.greenHole != null && s.greenHole === holeNo && (s.phase === "ready" || s.phase === "yards");
  // v22.11 marked-green mode: `markable` = this hole has no geometry but the satellite-on-GPS
  // bridge can run (the caller says no when the satellite cannot be had). Pre-tee and the GPS
  // errors keep their own views; a fix with no marked green is `markgreen`. Once a green is
  // marked the caller hands over its synthetic hole, so mapOk is true and every state is normal.
  if (!profileOk) view = "noprofile";
  else if (s.phase === "locating") view = "locating";
  else if (saidGreen) view = "green";
  else if (!mapOk && s.phase !== "yards" && markable) {
    view = s.phase === "nofix" || s.phase === "locationoff" ? s.phase : s.phase === "ready" ? "markgreen" : "pretee";
  }
  else if (s.phase === "nofix" || s.phase === "locationoff") view = s.phase;   // v22.12: a GPS error says so, map or not
  else if (!mapOk && s.phase !== "yards") view = "nomap";
  else if (s.phase === "yards") view = "yards";
  else if (s.phase === "ready") view = onGreen ? "green" : res?.sameShot ? "sameshot" : "ready";
  else view = "pretee";

  const hasRec = (view === "ready" || view === "sameshot" || view === "yards") && !!res?.safe;
  // v22.12: the no-map states, where nothing on screen prices the shot yet
  const bare = !mapOk && (view === "nomap" || view === "markgreen" || view === "yards" || (view === "pretee" && markable));
  const sameShot = hasRec && !!res.sameShot;
  const activeKey = sameShot ? "safe" : s.opt;
  const opts = options || { safe: res?.safe || null, aggressive: res?.aggressive || null };
  const active = hasRec ? (opts[activeKey] || opts.safe) : null;

  const AIM = {
    noprofile: COPY.aimNoProfile, nomap: COPY.aimNoMap, pretee: COPY.aimPreTee, locating: COPY.aimLocating,
    green: COPY.aimGreen, nofix: COPY.aimNoFix, locationoff: COPY.aimLocOff, yards: COPY.aimClubOnly, markgreen: COPY.aimMark,
  };
  const origin = view === "yards" ? { x: 0, y: 0 } : ballXY;
  const toTarget = active?.target && origin ? String(Math.round(dist(origin, active.target))) : active ? String(active.meanYds ?? DASH) : DASH;

  const rail = {
    hole: String(holeNo),
    par: par != null ? String(par) : DASH,
    shot: String(s.shotNo),
    toggle: hasRec ? (sameShot ? "same" : "pills") : null,
    opt: activeKey,
    showClub: view !== "green",
    club: active ? clubShort(active.club, active.label) : DASH,
    finesse: !!active && active.swingType === "finesse",
    toTarget: active ? toTarget : DASH,
    toTargetPencil: view === "yards" && !!active,
    aim: view === "ready" || view === "sameshot" ? aimShort(active, { ball: ballXY, green }) : view === "yards" && !active ? DASH : AIM[view],
    details: s.exp ? COPY.close : COPY.details,
    // v22.12: on a hole with no map the bar carries I'm at my ball + Log shot, so Enter yards (for
    // the ball Brett is at) moves here as a text button under the aim. v22.15 (SPEC-shotlog-v2 §8):
    // on a mapped Ready too — yards for this ball.
    action: bare || view === "ready" || view === "sameshot" ? { label: COPY.yards, action: "yardsSame" } : null,
    // v22.15 §2 / §8 rail extras: shape pills wherever a shot is about to be hit, Line only where
    // the map can take a mark (Ready and Same shot — §2 says Same shot takes the shape only, but an
    // approach is usually Same shot and its one option has a target to move; yards: shape only),
    // Shots wherever the hole has a story
    shapes: ["pretee", "ready", "sameshot", "yards", "nomap", "markgreen"].includes(view),
    line: view === "ready" || view === "sameshot",
    shots: !["noprofile", "locating"].includes(view),
    unreviewed: Number.isFinite(unreviewed) && unreviewed > 0 ? unreviewed : 0,
  };

  /* details column */
  const dctx = hasRec || view === "green" ? res?.context?.distances || inferred?.distances || null : null;
  const num = (v) => (Number.isFinite(v) ? String(Math.round(v)) : DASH);
  const distancesStrip = [
    { k: "Front", v: num(dctx?.front) },
    { k: "Pin", v: num(dctx?.pin) },
    { k: "Back", v: num(dctx?.back) },
    { k: "Plays", v: hasRec ? num(res.context?.playsLike) : DASH },
  ];
  const cfg = config || DEFAULT_CONFIG;
  const rows = [];
  if (hasRec) {
    const row = (id, label, o, selected, delta) => ({
      id, label, club: clubShort(o.club, o.label), avg: o.expScore.toFixed(1), delta, birdie: pct(o.birdieProb), trouble: pct(o.troubleRate), selected,
    });
    if (sameShot) rows.push(row("safe", "Both", opts.safe, true, null));
    else {
      rows.push(row("safe", "Safe", opts.safe, activeKey === "safe", null));
      if (opts.aggressive) {
        const d = opts.aggressive.deltaExp ?? (opts.aggressive.expScore - opts.safe.expScore);
        const delta = Math.abs(d) < (cfg.SAME_AVG_DELTA ?? 0.05) ? "≈ same" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
        rows.push(row("aggressive", "Aggressive", opts.aggressive, activeKey === "aggressive", delta));
      }
    }
  }
  const reasons = hasRec ? (sameShot ? [opts.safe] : [opts.safe, opts.aggressive]).filter(Boolean).map((o) => o.reason).filter(Boolean) : [];
  const today = hasRec ? todayLines(res) : [];

  const details = {
    distances: distancesStrip,
    chips: chipList({ chips: s.chips, pin: pinSetting(s), windOverride: s.windOverride, conditionsOverride: s.conditionsOverride, inferred }),
    rows,
    dispersion: active ? dispersionLine(active) : null,
    reasons,
    today,
    mapNote: synthetic && (hasRec || view === "green" || view === "pretee") ? NOTICES.noHazards : null,   // v22.11: said once, in the details
  };

  /* bar (§3.4, §8). v22.12: every post-tee state with no map keeps the Ready bar — I'm at my ball
     advances the shot as it does on a mapped hole, Log shot logs it with or without a
     recommendation — and Enter yards moves to the rail (rail.action above). */
  let primary, secondary = null;
  if (view === "noprofile") primary = { label: COPY.retry, action: "profile" };
  else if (view === "locating") primary = { label: COPY.locating, action: null, disabled: true };
  else if (view === "nomap") { primary = s.phase === "pretee" ? { label: COPY.tee, action: "tee" } : { label: COPY.ball, action: "ball" }; secondary = { label: COPY.logShot, action: "logshot" }; }
  else if (view === "markgreen") { primary = { label: COPY.ball, action: "ball" }; secondary = { label: COPY.logShot, action: "logshot" }; }
  else if (view === "pretee" && markable && !mapOk) { primary = { label: COPY.tee, action: "tee" }; secondary = { label: COPY.logShot, action: "logshot" }; }
  else if (view === "nofix" || view === "locationoff") { primary = { label: COPY.retry, action: "retry" }; secondary = { label: COPY.yards, action: "yards" }; }
  else if (view === "pretee") { primary = { label: COPY.tee, action: "tee" }; secondary = { label: COPY.logShot, action: "logshot" }; }   // v22.15 §8
  else if (view === "green") { primary = { label: COPY.score(holeNo), action: "score" }; secondary = { label: COPY.logPutt, action: "logputt" }; }
  else { primary = { label: COPY.ball, action: "ball" }; secondary = { label: COPY.logShot, action: "logshot" }; }

  // v22.15 §6: where the green cannot be detected, On the green takes the secondary after the tee shot
  if (greenManual && s.shotNo >= 2 && s.phase !== "pretee" && ["ready", "sameshot", "yards", "nomap", "markgreen"].includes(view)) {
    secondary = { label: COPY.onGreen, action: "green" };
  }
  // v22.15 §1 test mode: while the map is armed the bar waits for the tap
  if (s.awaitingTap) {
    primary = { label: COPY.tapMap, action: null, disabled: true };
    secondary = null;
    rail.aim = COPY.aimTap;
    rail.shapes = false; rail.line = false; rail.action = null;
  }

  const notice = s.awaitingTap ? NOTICES.testTap : view === "noprofile" ? NOTICES.noprofile
    : view === "nomap" ? (satFailure && s.ball ? NOTICES.noSatellite(satFailure) : NOTICES.nomap(holeNo))
    : view === "nofix" ? NOTICES.nofix
    : view === "locationoff" ? NOTICES.locationoff
    : view === "markgreen" ? NOTICES.mark
    : view === "pretee" && markable && !mapOk ? (greenMarked ? NOTICES.markedPreTee(holeNo) : NOTICES.markPreTee(holeNo))
    : null;
  // v22.11 B.2: in the pin view the notice tag reads the yards to the pin (live while dragging)
  const pinNotice = s.pinView && Number.isFinite(pinYds) ? COPY.pinYds(Math.round(pinYds)) : null;

  return { view, rail, details, bar: { primary, secondary }, notice: pinNotice || notice, sameShot };
}

/* ---------- 3g. 27-hole courses (engine §6.4) ---------- */

/**
 * First guess for the mapping screen from the OSM refs: refs 1–27 → nine ⌈ref/9⌉; refs that
 * repeat (1–9 per nine) → the n-th time a ref appears is nine n. Brett confirms or changes it.
 * candidates = geo.js nineMapCandidates. Returns { [key]: { nine: "1"|"2"|"3", hole } }.
 */
export function defaultNineMap(candidates) {
  const list = [...(candidates || [])].sort((a, b) => (Number(a.ref) || 99) - (Number(b.ref) || 99) || String(a.key).localeCompare(String(b.key)));
  const seen = {};
  const out = {};
  list.forEach((c, i) => {
    const r = Number(c.ref);
    if (Number.isInteger(r) && r >= 1 && r <= 27 && list.every((o) => o === c || Number(o.ref) !== r)) {
      out[c.key] = { nine: String(Math.ceil(r / 9)), hole: ((r - 1) % 9) + 1 };
    } else if (Number.isInteger(r) && r >= 1 && r <= 9) {
      seen[r] = (seen[r] || 0) + 1;
      out[c.key] = { nine: String(Math.min(3, seen[r])), hole: r };
    } else {
      out[c.key] = { nine: String(Math.min(3, Math.floor(i / 9) + 1)), hole: (i % 9) + 1 };
    }
  });
  return out;
}

/**
 * The geometry hole key for scorecard hole n (1–18). 18-hole courses: the key "n". With a nine map,
 * holes 1–9 are the first nine played and 10–18 the second (map._play = [front, back]).
 */
export function geometryKeyFor(geometry, nineMap, n) {
  if (nineMap) {
    const play = Array.isArray(nineMap._play) ? nineMap._play : ["1", "2"];
    const k = holeKeyFor(nineMap, String(play[n <= 9 ? 0 : 1]), ((n - 1) % 9) + 1);
    return k != null && geometry?.holes?.[k] ? k : null;
  }
  return geometry?.holes?.[String(n)] ? String(n) : null;
}

/** Hole keys in scorecard order (detectHole's `order`); a missing hole keeps its slot as null. */
export const scorecardOrder = (geometry, nineMap) => Array.from({ length: 18 }, (_, i) => geometryKeyFor(geometry, nineMap, i + 1));

/** A detectHole result key → scorecard hole number, or null. Never goes backwards (no 18 → 1 wrap). */
export function detectedHoleNo(order, key, current) {
  if (key == null) return null;
  const i = order.findIndex((k) => k != null && String(k) === String(key));
  return i >= 0 && i + 1 > current ? i + 1 : null;
}

