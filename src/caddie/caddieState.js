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
import { distances, pinFromTap, frameOf, holeKeyFor } from "./geo.js";
import { parseLieChip } from "./context.js";
import { bboxYds, withEllipses } from "./overlay.js";
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
  useInferred: (v) => `Use inferred · ${v}`,
  pinNote: "Or tap the green on the map.",
  yardsTitle: "Yards to pin",
  use: (n) => `Use ${n}`,
});
export const NOTICES = Object.freeze({
  nofix: "No GPS fix. Step into the open and tap Try again.",
  locationoff: "Location is off for Loop. Turn it on in Settings, then tap Try again.",
  noprofile: "Profile didn't load. Reconnect and tap Try again.",
  nomap: (n) => `No course map for hole ${n}. Enter yards for a club.`,
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
    logCard: null,       // S4: "log" (Log shot sheet open) | "prev" (blocking previous-shot prompt) | null
    openShot: null,      // S4: the last logged (quick/full/skipped) ShotRecord awaiting §4.5 closeout
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
    shots: { ...s.shots, [n]: [] }, context: null,
  };
}

/** A new ball position: SAFE, rail collapsed, per-ball chips cleared (§9.1–9.3). Any Log-shot sheet
 *  or previous-shot prompt for the shot just left behind should already be resolved by this point
 *  (the "ball" tap is intercepted while one is pending — see `hasUnloggedShot`); clearing `logCard`
 *  here is defensive. */
const newBall = (s) => ({ ...s, opt: "safe", exp: false, chips: {}, logCard: null });

const PIN_PRESETS = ["front", "middle", "back"];
const isXY = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const isLL = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon);

export function caddieReducer(s, a) {
  switch (a.type) {
    case "tee":
    case "ball":
    case "retry": {
      const trigger = a.type === "retry" ? (s.trigger || (s.ball || s.yards != null ? "ball" : "tee")) : a.type;
      return { ...s, phase: "locating", prevPhase: s.phase === "locating" ? s.prevPhase : s.phase, trigger };
    }
    case "fix": {
      // a.fix = { lat, lng, accuracyM }; a.point = {x,y} in the (possibly new) hole's frame; a.hole = detected hole
      let t = s;
      if (a.hole != null && a.hole !== s.hole) t = newHole(s, a.hole);
      const trigger = t === s ? s.trigger || "ball" : "tee";
      const point = isXY(a.point) ? { x: a.point.x, y: a.point.y } : null;
      if (trigger === "tee") {
        return newBall({ ...t, phase: "ready", prevPhase: null, trigger, shotNo: 1, ball: a.fix, ballXY: point, yards: null, shots: { ...t.shots, [t.hole]: [] } });
      }
      const prev = t.shots[t.hole] || [];
      const shots = t.ballXY && point ? [...prev, { from: t.ballXY, to: point }] : prev;
      return newBall({ ...t, phase: "ready", prevPhase: null, trigger, shotNo: t.shotNo + 1, ball: a.fix, ballXY: point, yards: null, shots: { ...t.shots, [t.hole]: shots } });
    }
    case "fixError":
      return { ...s, phase: a.code === 1 ? "locationoff" : "nofix", prevPhase: null };
    case "yards": {
      const n = Math.round(a.yards);
      if (!(n > 0)) return s;
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
    /* logOpen: show a sheet. a.card = "prev" for the blocking previous-shot prompt (§4.4 step 2);
       anything else (including undefined) opens the optional Log-shot card for the current ball. */
    case "logOpen":
      return { ...s, logCard: a.card === "prev" ? "prev" : "log" };
    /* logDismiss: close the optional Log-shot sheet without writing anything. The previous-shot
       prompt is not dismissible this way — it always resolves through logSave/logSkip (§4.4: "One
       tap and the caddie appears"). */
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

/**
 * S4 §4.4 — whether the CURRENT ball position is a long shot Brett hasn't logged yet, i.e. the
 * "I'm at my ball" tap must show the collapsed previous-shot prompt instead of locating.
 * `kind` is shotlog.js `routeShot()`'s classification for the ball in effect right now
 * ("long" | "shortGame" | "putt"), or null when there's no live recommendation to log against.
 * A shot is logged once `openShot` names this exact (hole, shotNo).
 */
export function hasUnloggedShot(s, kind) {
  if (kind !== "long") return false;
  const o = s.openShot;
  return !(o && o.hole === s.hole && o.shotNo === s.shotNo);
}

/* ---------- persistence (§9.8, §11.1, T42) ---------- */

/** What goes into the round state's `caddie` key. `context` = the ShotContext on screen (a snapshot). */
export function serializeCaddie(s, context = s?.context ?? null) {
  if (!s) return null;
  const { v, hole, shotNo, phase, prevPhase, trigger, ball, ballXY, yards, opt, exp, chips, pins, windOverride, conditionsOverride, shots, logCard, openShot } = s;
  return { v, hole, shotNo, phase, prevPhase, trigger, ball, ballXY, yards, opt, exp, chips, pins, windOverride, conditionsOverride, shots, context, logCard, openShot };
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
  s.logCard = raw.logCard === "log" || raw.logCard === "prev" ? raw.logCard : null;
  s.openShot = raw.openShot && typeof raw.openShot === "object" && typeof raw.openShot.id === "string"
    && Number.isInteger(raw.openShot.hole) && Number.isInteger(raw.openShot.shotNo) ? raw.openShot : null;
  return s;
}

/* ---------- 3a. pin (§6, T35) ---------- */

/** The pin point {x,y} for a setting from `from` (the ball, or the tee pre-shot). null without a hole. */
export function pinPointFor(hole, from, setting = "middle") {
  if (!hole?.green?.ring) return null;
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
/** Inferred wind (engine context.wind): `8 into-left`; null → Calm; undefined (no weather) → —. */
export function windText(w) {
  if (w === undefined) return DASH;
  if (!w || !(w.speedMph > 0)) return "Calm";
  return `${Math.round(w.speedMph)} ${REL[w.relative] || w.relative || ""}`.trim();
}
export const elevText = (n) => (Number.isFinite(n) ? `${signed(Math.round(n))} yds` : DASH);

/**
 * The six chips. inferred = { lieType, lieConfidence, quality, wind, elevation, conditions } as Loop
 * worked them out (no Brett input); a key missing from `inferred` shows —.
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
    { key: "wind", label: "Wind", edited: windOverride != null, value: windOverride != null ? windChipText(windOverride) : has ? windText(inf.wind) : DASH,
      inferredValue: has ? windText(inf.wind) : null },
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

/** The engine ctx for club-brain mode (the ball at the synthetic tee; chips still apply). */
export function clubBrainContext({ holeNo, par, shotNo, chips = {}, windOverride = null, conditionsOverride = null }) {
  const lc = parseLieChip(chips.lie);
  const lieType = lc ? lc.lieType : shotNo <= 1 ? "tee" : "fairway";
  return {
    hole: holeNo, par, shotNo, ball: { x: 0, y: 0 },
    lieType, lieQuality: chips.quality || "standard", lieConfidence: lc ? "high" : "low",
    conditions: conditionsOverride || "normal", pinPos: "middle",
    wind: windOverride ? windFromChip(windOverride) : null,
    elevationDeltaYds: Number.isFinite(chips.elevation) ? chips.elevation : 0,
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
}) {
  const s = state;
  const holeNo = s.hole;
  let view;
  if (!profileOk) view = "noprofile";
  else if (s.phase === "locating") view = "locating";
  else if (!mapOk && s.phase !== "yards") view = "nomap";
  else if (s.phase === "nofix" || s.phase === "locationoff") view = s.phase;
  else if (s.phase === "yards") view = "yards";
  else if (s.phase === "ready") view = onGreen ? "green" : res?.sameShot ? "sameshot" : "ready";
  else view = "pretee";

  const hasRec = (view === "ready" || view === "sameshot" || view === "yards") && !!res?.safe;
  const sameShot = hasRec && !!res.sameShot;
  const activeKey = sameShot ? "safe" : s.opt;
  const opts = options || { safe: res?.safe || null, aggressive: res?.aggressive || null };
  const active = hasRec ? (opts[activeKey] || opts.safe) : null;

  const AIM = {
    noprofile: COPY.aimNoProfile, nomap: COPY.aimNoMap, pretee: COPY.aimPreTee, locating: COPY.aimLocating,
    green: COPY.aimGreen, nofix: COPY.aimNoFix, locationoff: COPY.aimLocOff, yards: COPY.aimClubOnly,
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
  };

  /* bar (§3.4, §8). Log shot stays hidden until S4. */
  let primary, secondary = null;
  if (view === "noprofile") primary = { label: COPY.retry, action: "profile" };
  else if (view === "locating") primary = { label: COPY.locating, action: null, disabled: true };
  else if (view === "nomap" || (view === "yards" && !mapOk)) primary = { label: COPY.yards, action: "yards" };
  else if (view === "nofix" || view === "locationoff") { primary = { label: COPY.retry, action: "retry" }; secondary = { label: COPY.yards, action: "yards" }; }
  else if (view === "pretee") primary = { label: COPY.tee, action: "tee" };
  else if (view === "green") primary = { label: COPY.score(holeNo), action: "score" };
  else { primary = { label: COPY.ball, action: "ball" }; secondary = { label: COPY.logShot, action: "logshot" }; }

  const notice = view === "noprofile" ? NOTICES.noprofile
    : view === "nomap" ? NOTICES.nomap(holeNo)
    : view === "nofix" ? NOTICES.nofix
    : view === "locationoff" ? NOTICES.locationoff
    : null;

  return { view, rail, details, bar: { primary, secondary }, notice, sameShot };
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

