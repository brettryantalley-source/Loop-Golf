/*
 * catchup.js — v22.58 (C47, D129): Catch up, the chained after-the-hole logging (Shot Pattern's
 * "Add Shots with Map Entry"; Brett, Oct 11 evening). One chain per hole, one tap per step, the map
 * moving on by itself:
 *
 *   end    the caddie's call from where the ball was (rings, dots, target, Line — Brett, Oct 11: "I still
 *          want to see the full dispersion circle to choose the target, the line"), shot 1 on the tee box
 *          the card's yardage matches; tap where the shot finished (a second tap moves it); ✓
 *   from   only on Move tee / Move ball (a wrong box, a drop): a tap or a hold-and-drag places it; ✓
 *   club   the club grid with the club of the call he chose pre-selected (else Loop's guess for the
 *          yards), and where it ended (the lie read off the map); Save writes the shot, aimed where he
 *          aimed, and the next one starts where this one finished
 *   putt   on the green: In the hole, or a tap where the putt stopped and ✓ (the next putt starts there)
 *   done   the hole's count; Score hole N on an unscored hole, else the next hole or back to the live one
 *
 * Every step is undoable, one step at a time; an undo past a Save gives back the record it wrote
 * (`drop`), so the caller deletes it. Pure: no DOM, no storage, no network. The state lives in the
 * caddie state under `catchup` (caddieState.js, the past hole's own state, never persisted); points
 * are {lat, lng}, so they mean the same thing in any frame.
 */

import { bareShotRecord, closeOutShot, newPuttRecord } from "./shotlog.js";
import { candidateEntries } from "./profile.js";
import { ringCentroid, yardsAlongHole } from "./teeboxes.js";

export const CATCHUP_STEPS = Object.freeze(["init", "from", "end", "club", "putt", "done"]);
/** Where a shot can end, as the club sheet offers it (engine lie types; `holed` = in the hole from off the green). */
export const END_LIES = Object.freeze([["fairway", "Fairway"], ["rough", "Rough"], ["sand", "Sand"], ["recovery", "Trees"], ["green", "Green"], ["holed", "In the hole"]]);

export const CU_COPY = Object.freeze({
  start: "Catch up",
  logShots: "Log shots",
  fromOk: (k) => (k === 1 ? "✓ Tee here" : "✓ Ball here"),
  move: (k) => (k === 1 ? "Move tee" : "Move ball"),
  endWait: "Tap where it finished",
  endOk: "✓ Finished here",
  save: "Save shot",
  undo: "Undo",
  holed: "In the hole",
  puttOk: () => "✓ Next putt",
  done: "Done",
  doneBack: (n) => `Done · back to ${n}`,
  score: (n) => `Score hole ${n}`,
  nextHole: (n) => `Hole ${n} ›`,
});

const isLL = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon);
const LL = (p) => (isLL(p) ? { lat: p.lat, lng: p.lng ?? p.lon } : null);
const isXY = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A chain waiting to start (the screen starts it once it has the hole's map and log). */
export const catchupInit = () => ({ step: "init" });

/** What every forward move pushes: the state as it was, minus its own history. */
const push = (cu, next) => ({ ...next, hist: [...(cu.hist || []), { ...cu, hist: undefined }] });

/**
 * Where the chain starts on a hole: after whatever is already logged there.
 *   shots / putts  the hole's records (review.js splitHole), in order
 *   tee            {lat,lng} — the tee box shot 1 starts on (teeStart), or null (then a tap places it)
 *   lieAt(ll)      the engine lie at a point ("green", "fairway", …), or null
 * No shots → shot 1 on the tee. A last shot with an end → the next shot from there (a putt when it is
 * on the green); a last shot with no end → that shot's end, its record kept. Any putt → done.
 */
export function catchupStart({ shots = [], putts = [], tee = null, lieAt = null } = {}) {
  const base = { hist: [], ids: {}, pids: {}, club: null, endLie: null, end: null, puttNo: 1 };
  if (putts.length) return { ...base, step: "done", shotNo: shots.length + 1, puttNo: putts.length + 1, from: null, fromLie: null };
  // the call from the tee shows straight away; no tee box to start on → a tap places it first
  if (!shots.length) return { ...base, step: LL(tee) ? "end" : "from", shotNo: 1, from: LL(tee), fromLie: "tee" };
  const last = shots[shots.length - 1];
  const k = Number.isInteger(last.shotNo) ? last.shotNo : shots.length;
  const end = LL(last.end);
  if (!end) {
    return { ...base, step: "end", shotNo: k, from: LL(last.start), fromLie: last.lie?.confirmed ?? last.lie?.inferred ?? (k === 1 ? "tee" : null),
      club: last.club ?? null, ids: { [k]: last.id } };
  }
  const lie = last.end?.lie ?? (lieAt ? lieAt(end) : null);
  if (lie === "green") return { ...base, step: "putt", shotNo: k + 1, from: end, fromLie: "green" };
  return { ...base, step: "end", shotNo: k + 1, from: end, fromLie: lie };
}

/** A tap (or a hold-and-drag) on the map: the start on `from`, the finish on `end` and `putt`. */
export function cuPoint(cu, at) {
  const p = LL(at);
  if (!cu || !p) return cu;
  if (cu.step === "from") return push(cu, { ...cu, from: p });
  if (cu.step === "end" || cu.step === "putt") return push(cu, { ...cu, end: p });
  return cu;
}

/** Move tee / Move ball (on `end`, nothing placed yet): back to placing where the shot was hit from. */
export function cuMoveFrom(cu) {
  return cu?.step === "end" && !cu.end ? push(cu, { ...cu, step: "from" }) : cu;
}

/** ✓ on `from` → `end`. */
export function cuFromOk(cu) {
  return cu?.step === "from" && cu.from ? push(cu, { ...cu, step: "end", end: null }) : cu;
}

/** ✓ on `end` → the club sheet, with the club (the call he chose, else Loop's guess) and the lie where it finished. */
export function cuEndOk(cu, { club = null, endLie = null } = {}) {
  if (cu?.step !== "end" || !cu.end) return cu;
  return push(cu, { ...cu, step: "club", club: cu.club ?? club, endLie: endLie ?? cu.endLie ?? null });
}

/** The club sheet's picks (no history: Undo from the sheet goes back to the map). */
export function cuSet(cu, patch = {}) {
  if (cu?.step !== "club") return cu;
  const out = { ...cu };
  if ("club" in patch) out.club = patch.club ?? null;
  if ("endLie" in patch) out.endLie = patch.endLie ?? null;
  return out;
}

/** Save on the club sheet: `id` = the record written. The next shot starts where this one finished. */
export function cuSaved(cu, id) {
  if (cu?.step !== "club" || !id) return cu;
  const ids = { ...cu.ids, [cu.shotNo]: id };
  if (cu.endLie === "holed") return push(cu, { ...cu, ids, step: "done", club: null });
  const onGreen = cu.endLie === "green";
  return push(cu, { ...cu, ids, step: onGreen ? "putt" : "end", shotNo: cu.shotNo + 1, from: cu.end, fromLie: cu.endLie, end: null, club: null, endLie: null,
    puttNo: onGreen ? 1 : cu.puttNo });
}

/** A putt written (`id`): holed → done; missed → the next putt from where it stopped. */
export function cuPutted(cu, id, made) {
  if (cu?.step !== "putt" || !id) return cu;
  const pids = { ...cu.pids, [cu.puttNo]: id };
  if (made) return push(cu, { ...cu, pids, step: "done", end: null });
  if (!cu.end) return cu;
  return push(cu, { ...cu, pids, puttNo: cu.puttNo + 1, from: cu.end, end: null });
}

/**
 * Undo: one step back. → { cu, drop } — `drop` = ids of records written after the state it goes back
 * to (a Save or a putt undone); the caller deletes them. Nothing to undo → the same state, drop [].
 */
export function cuUndo(cu) {
  const hist = cu?.hist || [];
  if (!hist.length) return { cu, drop: [] };
  const prev = { ...hist[hist.length - 1], hist: hist.slice(0, -1) };
  const had = new Set([...Object.values(prev.ids || {}), ...Object.values(prev.pids || {})]);
  const drop = [...Object.values(cu.ids || {}), ...Object.values(cu.pids || {})].filter((id) => !had.has(id));
  return { cu: prev, drop };
}

/** The map is armed (a tap or a hold places a point) on these steps. */
export const cuArmed = (cu) => !!cu && (cu.step === "from" || cu.step === "end" || cu.step === "putt");

/**
 * The tee box shot 1 starts on: the box whose card-style yardage (teeboxes.js) is nearest the card's
 * yardage for the tee played, else the hole line's start. {x,y} hole frame, or null.
 */
export function teeStart(hole, cardYds) {
  const boxes = (hole?.tees || []).map((r) => { const c = ringCentroid(r); return c ? { c, y: yardsAlongHole(hole, c) } : null; }).filter((b) => b && Number.isFinite(b.y));
  if (boxes.length && Number.isFinite(cardYds) && cardYds > 0) {
    let best = boxes[0];
    for (const b of boxes) if (Math.abs(b.y - cardYds) < Math.abs(best.y - cardYds)) best = b;
    return { x: best.c.x, y: best.c.y };
  }
  if (boxes.length) return boxes.reduce((a, b) => (b.y > a.y ? b : a)).c;
  return isXY(hole?.tee) ? { x: hole.tee.x, y: hole.tee.y } : null;
}

/**
 * Loop's guess for the club: the one whose average total from this lie is nearest the yards it went
 * (full swings; a finesse swing when one fits better — the club is what is returned). null with no
 * profile or no yards.
 */
export function guessClub(P, yds, lie = "fairway") {
  if (!P || !(yds > 0)) return null;
  let best = null;
  for (const e of candidateEntries(P, lie || "fairway")) {
    const d = Math.abs((e.total ?? 0) - yds);
    if (!best || d < best.d - 1e-9) best = { d, club: e.club };
  }
  return best ? best.club : null;
}

/**
 * The shot a Save writes: a recommendation-less record (shotlog.js bareShotRecord) placed by hand at
 * both ends and closed there (closeOutShot) — `logged: "full"`, reviewed, never an assumed end, so the
 * Score hole pre-fill (D123), Review and the brain read it as a logged shot. Nobody graded contact,
 * strike or start line, so they stay null. from / end = {lat, lng, x?, y?} (x, y in the hole frame).
 */
export function catchupShotRecord({ id, base = {}, shotNo, from, end, startLie = null, endLie = null, club = null, pinYds = null, history, cfg } = {}) {
  const s = LL(from), e = LL(end);
  if (!s || !e || !Number.isInteger(shotNo)) return null;
  const r0 = bareShotRecord({ id, ...base, shotNo, gps: { ...s, accuracyM: null }, distanceToPinYds: pinYds, lie: startLie, lieInferred: startLie, club, history });
  const r1 = { ...r0, start: { ...r0.start, accuracyM: null, frame: isXY(from) ? { x: from.x, y: from.y } : null },
    placed: true, logged: "full", reviewed: true, contact: null, strike: null, startLine: null, catchup: true };
  const holed = endLie === "holed";
  const closed = closeOutShot(r1, { endGps: e, endLie: holed ? "green" : endLie, endAccuracyM: null, endFrame: isXY(end) ? end : null }, cfg);
  return holed ? { ...closed, end: { ...closed.end, holed: true } } : closed;
}

/** A putt the chain writes: its start and length; a miss nobody graded keeps its three axes null. */
export function catchupPuttRecord({ id, base = {}, puttNo, from, distanceFt = null, made = false } = {}) {
  const s = LL(from);
  const r = newPuttRecord({ id, roundId: base.roundId, courseId: base.courseId, hole: base.hole, shotNo: puttNo, distanceFt, made, logged: "full",
    gps: s ? { ...s, accuracyM: null } : null });
  return made ? { ...r, reviewed: true, catchup: true } : { ...r, reviewed: true, catchup: true, putt: { ...r.putt, speed: null, breakRead: null, line: null } };
}

/**
 * The bar, the notice and the hole pill's second line for a step.
 *   holeNo, liveHole, scored (the card has hole N's score)
 *   yds   from → end (end placed) or from → pin, yards;  ft  the putt's feet (from → pin, or end → pin once placed)
 *   counts { shots, putts } — the hole's records (the done step)
 * bar actions: cuFromOk · cuEndOk · cuMove · cuUndo · cuIn · cuPuttOk · cuScore · cuNext · cuDone. `primary` is
 * null where the step waits on a tap (the notice says so); `extra` is Move tee / Move ball.
 */
export function catchupView({ cu, holeNo, liveHole = null, scored = false, yds = null, ft = null, counts = { shots: 0, putts: 0 } } = {}) {
  if (!cu || cu.step === "init") return null;
  const undo = (cu.hist || []).length ? { label: CU_COPY.undo, action: "cuUndo" } : null;
  const Y = Number.isFinite(yds) ? Math.round(yds) : null, Ft = Number.isFinite(ft) ? Math.max(1, Math.round(ft)) : null;
  let primary, secondary = undo, extra = null, notice, line;
  switch (cu.step) {
    case "from":
      primary = cu.from ? { label: CU_COPY.fromOk(cu.shotNo), action: "cuFromOk" } : { label: "Tap where you hit from", action: null, disabled: true };
      notice = cu.from ? `Shot ${cu.shotNo} · tap or hold to move the ${cu.shotNo === 1 ? "tee" : "ball"}.` : `Shot ${cu.shotNo} · tap where you hit it from.`;
      line = `shot ${cu.shotNo}`;
      break;
    case "end":
      primary = cu.end ? { label: CU_COPY.endOk, action: "cuEndOk" } : null;
      if (!cu.end) extra = { label: CU_COPY.move(cu.shotNo), action: "cuMove" };
      notice = cu.end ? `Shot ${cu.shotNo}${Y != null ? ` · ${Y} yds` : ""}. Tap again to move it.` : `Shot ${cu.shotNo} · set the target if you like, then tap where it finished.`;
      line = `shot ${cu.shotNo}`;
      break;
    case "club":
      primary = { label: CU_COPY.save, action: "cuSave", disabled: !cu.club };
      notice = `Shot ${cu.shotNo}${Y != null ? ` · ${Y} yds` : ""} · pick the club.`;
      line = `shot ${cu.shotNo}`;
      break;
    case "putt":
      primary = cu.end ? { label: CU_COPY.puttOk(), action: "cuPuttOk" } : { label: CU_COPY.holed, action: "cuIn" };
      notice = cu.end ? `Putt ${cu.puttNo}${Ft != null ? ` · ${Ft} ft left` : ""}. Tap again to move it.`
        : `Putt ${cu.puttNo}${Ft != null ? ` · ${Ft} ft` : ""} · tap where it stopped, or In the hole.`;
      line = `putt ${cu.puttNo}`;
      break;
    case "done": {
      const s = counts.shots || 0, p = counts.putts || 0;
      notice = `Hole ${holeNo} · ${plural(s, "shot")} + ${plural(p, "putt")} = ${s + p}`;
      line = "logged";
      const back = Number.isInteger(liveHole) && liveHole !== holeNo ? liveHole : null;
      if (!scored) { primary = { label: CU_COPY.score(holeNo), action: "cuScore" }; secondary = undo; }
      else if (back != null && holeNo + 1 < back) { primary = { label: CU_COPY.nextHole(holeNo + 1), action: "cuNext" }; secondary = { label: CU_COPY.doneBack(back), action: "cuDone" }; }
      else { primary = { label: back != null ? CU_COPY.doneBack(back) : CU_COPY.done, action: "cuDone" }; secondary = undo; }
      break;
    }
    default:
      return null;
  }
  return { primary, secondary, extra, notice, line };
}
