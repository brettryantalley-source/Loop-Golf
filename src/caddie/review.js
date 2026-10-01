/*
 * review.js — the hole's shot story at the score (SPEC-shotlog-v2 §4) and the mid-hole Shots list
 * (§5). Pure: no DOM, no storage, no network. app.jsx's ReviewSheet renders `holeReview` and calls
 * the edit functions; every edit returns NEW records (nothing is mutated), which the sheet writes on
 * `Save all` (or `Later`, which writes nothing but the edits already made — see app.jsx).
 *
 * THE REVIEW FRAME
 *   One hole-frame `F` (geo.js holeFrame: { toFrame, toLatLng }) for the whole hole, handed in by
 *   the caller: the mapped hole's own frame, else the course's north-up anchor frame (greens.js
 *   anchorFrame). Every position is kept in lat/lng on the record (start.lat/lng, end.lat/lng,
 *   intent.targetLL), so shots measured in different frames — a marked green's synthetic frame moves
 *   with the ball — can be compared in F. Distances along a line and signed offsets from it do not
 *   depend on the frame, so a result recomputed in F is the result.
 *   When a shot is recomputed its start.frame, end.frame, target.frame and intent.target are
 *   rewritten in F, so the record stays self-consistent (on a mapped hole F IS the record's frame and
 *   nothing moves; on an unmapped hole the record's frame becomes the anchor frame).
 *   `sameFrame: true` says the records' own frames are F (a mapped hole): an old record with frames
 *   but no lat/lng can then still be read.
 */

import { closeOutShot, bareShotRecord, newPuttRecord, normIntent, resultText, bearingInFrame } from "./shotlog.js";
import { DEFAULT_CONFIG } from "./config.js";

export const isPutt = (r) => r?.shotType === "putt";
const isPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const llOf = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon) ? { lat: p.lat, lng: p.lng ?? p.lon } : null);
const byShotNo = (a, b) => (a.shotNo ?? 99) - (b.shotNo ?? 99) || String(a.ts || "").localeCompare(String(b.ts || ""));

/** A hole's records split and ordered: { shots (non-putt, by shotNo), putts (by shotNo) }. */
export function splitHole(records, hole) {
  const mine = (records || []).filter((r) => r && (hole == null || r.hole === hole));
  return { shots: mine.filter((r) => !isPutt(r)).sort(byShotNo), putts: mine.filter(isPutt).sort(byShotNo) };
}

/**
 * §4 — the Review model for one hole.
 *   shots  the hole's long / short-game records;  putts  its putt records;  score  the written score
 *   (null in the Shots list, where the hole is not finished);  hole  the hole number.
 *   opts.puttCount  the header stepper's value when the putt log is empty (default score − shots, ≥ 0).
 * → { header: { hole, score, shots, putts }, rows, problems, needed, puttsNeeded, puttsDefault, story }
 * rows: one per stroke, 1 … (score − putts) then the putts —
 *   { kind: "shot", n, record | null, club, pos: "GPS" | "placed" | "—", intent: "set" | "default" | "—",
 *     result: "+2 long · 12 R" | "—", unreviewed, missing, extra }
 *   { kind: "putt", n, record | null, result, unreviewed, virtual }
 * problems: { type: "unreviewed" | "missing", n } per row, { type: "putts" } when the log has none,
 *   { type: "count", story, score } when the rows do not add up to the score (the score is the truth).
 */
export function holeReview(shots, putts, score, hole, opts = {}) {
  const S = [...(shots || [])].filter((r) => r && !isPutt(r)).sort(byShotNo);
  const Pt = [...(putts || [])].filter(isPutt).sort(byShotNo);
  const finished = Number.isFinite(score) && score > 0;
  const puttsNeeded = finished && Pt.length === 0;
  const puttsDefault = finished ? Math.max(0, score - S.length) : 0;
  const nPutts = Pt.length || (puttsNeeded ? Math.max(0, Number.isInteger(opts.puttCount) ? opts.puttCount : puttsDefault) : 0);
  const expected = finished ? Math.max(0, score - nPutts) : 0;

  // shot numbers → records; a second record claiming the same number is an extra row
  const byNo = new Map(), extras = [];
  for (const r of S) {
    const k = Number.isInteger(r.shotNo) && r.shotNo >= 1 ? r.shotNo : null;
    if (k != null && !byNo.has(k)) byNo.set(k, r); else extras.push(r);
  }
  const top = Math.max(expected, ...byNo.keys(), 0);
  const rows = [];
  for (let n = 1; n <= top; n++) rows.push(shotRow(n, byNo.get(n) || null, n > expected && finished));
  extras.forEach((r, i) => rows.push(shotRow(top + i + 1, r, true)));
  const shotRows = rows.length;
  if (Pt.length) Pt.forEach((r, i) => rows.push(puttRow(i + 1, r)));
  else for (let i = 1; i <= nPutts; i++) rows.push(puttRow(i, null));

  const problems = [];
  for (const r of rows) {
    if (r.unreviewed) problems.push({ type: "unreviewed", n: r.n, kind: r.kind });
    if (r.missing) problems.push({ type: "missing", n: r.n });
  }
  if (puttsNeeded) problems.push({ type: "putts" });
  const story = shotRows + nPutts;
  if (finished && story !== score) problems.push({ type: "count", story, score });
  return {
    header: { hole, score: finished ? score : null, shots: shotRows, putts: nPutts },
    rows, problems, needed: problems.length > 0, puttsNeeded, puttsDefault, story,
  };
}

function shotRow(n, r, extra = false) {
  if (!r) return { kind: "shot", n, record: null, club: null, pos: "—", intent: "—", result: "—", unreviewed: false, missing: true, extra: false };
  const hasPos = !!llOf(r.start) || isPt(r.start?.frame);
  const it = r.intent;
  return {
    kind: "shot", n, record: r, club: r.club ?? null,
    pos: r.placed ? "placed" : hasPos ? "GPS" : "—",
    intent: it && (it.target || it.shape || Number.isFinite(it.startLineDeg)) ? (it.source === "set" ? "set" : "default") : "—",
    result: resultText(r.derived) ?? "—",
    unreviewed: r.reviewed === false, missing: false, extra,
  };
}

function puttRow(n, r) {
  if (!r) return { kind: "putt", n, record: null, result: "—", unreviewed: false, virtual: true };
  const p = r.putt || {};
  const result = p.made ? "made" : Number.isFinite(p.distanceFt) ? `${p.distanceFt} ft` : "—";
  return { kind: "putt", n, record: r, result, unreviewed: r.reviewed === false, virtual: false };
}

/** Does the hole need the Review sheet when its score is written (§4)? Only a hole with a story. */
export function reviewNeeded(records, hole, score) {
  const { shots, putts } = splitHole(records, hole);
  if (!shots.length && !putts.length) return false;       // nothing was logged: the scorecard alone
  return holeReview(shots, putts, score, hole).needed;
}

/* ---------- edits ---------- */

/** Replace one record by id (or append a new one). */
const upsert = (records, rec) => {
  const i = records.findIndex((r) => r.id === rec.id);
  if (i < 0) return [...records, rec];
  const out = [...records]; out[i] = rec; return out;
};

/** Where a record's start / target / end sit in F (null when they cannot be read). */
function framePoints(rec, F, sameFrame) {
  const sLL = llOf(rec.start), eLL = llOf(rec.end), tLL = llOf(rec.intent?.targetLL);
  const s = sLL && F ? F.toFrame({ lat: sLL.lat, lon: sLL.lng }) : sameFrame && isPt(rec.start?.frame) ? rec.start.frame : null;
  const e = eLL && F ? F.toFrame({ lat: eLL.lat, lon: eLL.lng }) : sameFrame && isPt(rec.end?.frame) ? rec.end.frame : null;
  const t = tLL && F ? F.toFrame({ lat: tLL.lat, lon: tLL.lng })
    : sameFrame ? (isPt(rec.intent?.target) ? rec.intent.target : isPt(rec.target?.frame) ? rec.target.frame : null) : null;
  return { s, e, t };
}

/**
 * Re-close every shot (or just `only`, a Set of shot numbers) against its neighbours: shot k's end is
 * shot k+1's start when that record exists (a placed or GPS start), the last shot's end is the first
 * putt's position when the putt has one, otherwise the end it already had. Then the §3 result is
 * derived again (closeOutShot with the intent). A shot whose start or end cannot be placed in F is
 * left alone. opts = { frame: F, sameFrame, cfg, lieAt(p) → lie | null, only }.
 */
export function recomputeChain(records, { frame: F = null, sameFrame = false, cfg = DEFAULT_CONFIG, lieAt = null, only = null } = {}) {
  let out = [...(records || [])];
  const hole = out.find((r) => !isPutt(r))?.hole;
  const { shots, putts } = splitHole(out, hole);
  shots.forEach((rec, i) => {
    if (only && !only.has(rec.shotNo)) return;
    const next = shots[i + 1] && shots[i + 1].shotNo === rec.shotNo + 1 ? shots[i + 1] : null;
    const last = i === shots.length - 1;
    const nextLL = next ? llOf(next.start) : last && putts[0] ? llOf(putts[0].gps) : null;
    const nextAcc = next ? next.start?.accuracyM ?? null : last && putts[0] ? putts[0].gps?.accuracyM ?? null : null;
    const endLL = nextLL || llOf(rec.end);
    const moved = !!nextLL && !(llOf(rec.end) && Math.abs(llOf(rec.end).lat - nextLL.lat) < 1e-9 && Math.abs(llOf(rec.end).lng - nextLL.lng) < 1e-9);
    const tmp = { ...rec, end: endLL ? { ...(rec.end || {}), lat: endLL.lat, lng: endLL.lng, accuracyM: nextLL ? nextAcc : rec.end?.accuracyM ?? null } : rec.end };
    const { s, e, t } = framePoints(tmp, F, sameFrame);
    if (!s || !e) return;
    const it = normIntent(rec.intent);
    // the start line keeps its bearing on a mapped hole (F is its frame); only a change of frame
    // (an unmapped hole's synthetic frame → the anchor frame) re-reads it from its lat/lng point
    const lineP = !sameFrame && it?.lineLL && F ? F.toFrame({ lat: it.lineLL.lat, lon: it.lineLL.lng }) : null;
    const intent = it ? { ...it, target: t || it.target, targetLL: t && F ? toLL(F, t) : it.targetLL,
      startLineDeg: lineP ? bearingInFrame(s, lineP) ?? it.startLineDeg : it.startLineDeg } : undefined;
    const base = { ...rec, start: { ...rec.start, frame: { x: s.x, y: s.y } }, ...(t ? { target: { frame: { x: t.x, y: t.y }, label: rec.target?.label ?? it?.targetLabel ?? null } } : {}) };
    const endLie = moved ? (lieAt ? lieAt(e) : null) : rec.end?.lie ?? null;
    const closed = closeOutShot(base, { endGps: endLL ? { lat: endLL.lat, lng: endLL.lng } : null, endLie, endAccuracyM: tmp.end?.accuracyM ?? null, endFrame: e, intent }, cfg);
    out = upsert(out, closed);
  });
  return out;
}

const toLL = (F, p) => { const q = F.toLatLng(p); return { lat: q.lat, lng: q.lon }; };

/**
 * §4 `Place` — shot `shotNo`'s start set by hand at `point` (F yards): start lat/lng and frame,
 * accuracy null (a placed ball is where Brett says it is), `placed: true`. A stroke with no record
 * gets one (`makeRecord({ shotNo, start })`, default a recommendation-less bareShotRecord for the
 * hole). Then this shot and the one before it are re-closed (recomputeChain).
 * opts = { frame: F (required), hole, base: fields for a new record (roundId, courseId, nine), makeRecord, cfg, sameFrame, lieAt }.
 */
export function placeShot(records, shotNo, point, opts = {}) {
  const F = opts.frame;
  if (!F || !isPt(point) || !Number.isInteger(shotNo)) return records;
  const ll = toLL(F, point);
  const start = { lat: ll.lat, lng: ll.lng, accuracyM: null, frame: { x: point.x, y: point.y } };
  const cur = (records || []).find((r) => !isPutt(r) && r.hole === opts.hole && r.shotNo === shotNo)
    || (opts.hole == null ? (records || []).find((r) => !isPutt(r) && r.shotNo === shotNo) : null);
  let rec;
  if (cur) rec = { ...cur, start: { ...(cur.start || {}), ...start }, placed: true };
  else {
    const make = opts.makeRecord || ((x) => bareShotRecord({ ...(opts.base || {}), hole: opts.hole, shotNo: x.shotNo, gps: { lat: ll.lat, lng: ll.lng, accuracyM: null } }));
    const fresh = make({ shotNo, start });
    rec = { ...fresh, start: { ...(fresh.start || {}), ...start }, placed: true, logged: "auto", reviewed: false, contact: null, strike: null, startLine: null,
      intent: fresh.intent ?? normIntent({}) };
  }
  const out = upsert(records || [], rec);
  return recomputeChain(out, { frame: F, sameFrame: opts.sameFrame, cfg: opts.cfg, lieAt: opts.lieAt, only: new Set([shotNo - 1, shotNo]) });
}

/**
 * §4 intent on the mini map (or the Shots list): patch = { target: {x,y} | null, startLineDeg, shape }
 * in F. The intent becomes `set`, the target is kept in lat/lng too, the record's target / line
 * played follow it (closeOutShot) and the shot is re-closed.
 */
export function setShotIntent(records, id, patch, opts = {}) {
  const F = opts.frame;
  const rec = (records || []).find((r) => r.id === id);
  if (!rec) return records;
  const it = normIntent(rec.intent) || { target: null, targetLabel: null, targetLL: null, startLineDeg: null, shape: null, source: "default" };
  const next = { ...it, source: "set" };
  if ("target" in patch) {
    next.target = isPt(patch.target) ? { x: patch.target.x, y: patch.target.y } : null;
    next.targetLL = next.target && F ? toLL(F, next.target) : null;
    next.targetLabel = next.target ? "own target" : null;
  }
  if ("startLineDeg" in patch) {
    next.startLineDeg = Number.isFinite(patch.startLineDeg) ? patch.startLineDeg : null;
    // keep a point on the line in lat/lng (100 yds out from the start) so the bearing survives a change of frame
    const s = framePoints(rec, F, opts.sameFrame).s;
    if (next.startLineDeg != null && s && F) {
      const r = (next.startLineDeg * Math.PI) / 180;
      next.lineLL = toLL(F, { x: s.x + Math.sin(r) * 100, y: s.y + Math.cos(r) * 100 });
    } else delete next.lineLL;
  }
  if ("shape" in patch) next.shape = patch.shape || null;
  // a target in F needs the start in F too: re-read the record there before re-closing
  let out = upsert(records, { ...rec, intent: next, ...(next.shape ? { intendedShape: next.shape } : {}) });
  if (F || opts.sameFrame) out = recomputeChain(out, { frame: F, sameFrame: opts.sameFrame, cfg: opts.cfg, lieAt: opts.lieAt, only: new Set([rec.shotNo]) });
  return out;
}

/** The start-line bearing for a tap `p` (F yards) from shot `id`'s start, or null (tap on the ball clears). */
export function lineFromTap(records, id, p, { frame: F = null, sameFrame = false, clearYds = 4 } = {}) {
  const rec = (records || []).find((r) => r.id === id);
  if (!rec || !isPt(p)) return null;
  const { s } = framePoints(rec, F, sameFrame);
  if (!s || Math.hypot(p.x - s.x, p.y - s.y) <= clearYds) return null;
  return bearingInFrame(s, p);
}

/** Delete stroke: the record leaves the story; the later shots move up one number (renumber). */
export function deleteStroke(records, id) {
  return renumber((records || []).filter((r) => r.id !== id));
}

/** Shot records numbered 1, 2, 3 … in their current order, putts likewise (after a delete). */
export function renumber(records) {
  const hole = (records || []).find((r) => r)?.hole;
  const { shots, putts } = splitHole(records, hole);
  const want = new Map();
  shots.forEach((r, i) => want.set(r.id, i + 1));
  putts.forEach((r, i) => want.set(r.id, i + 1));
  return (records || []).map((r) => (want.has(r.id) && r.shotNo !== want.get(r.id) ? { ...r, shotNo: want.get(r.id) } : r));
}

/**
 * The putt log was empty (§4 header stepper): `count` putt records with distanceFt null, the last one
 * holed. A missed putt nobody graded keeps its three axes null (not 0 = Good).
 */
export function inferredPutts(count, base = {}) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    const r = newPuttRecord({ ...base, shotNo: i, made: i === count, distanceFt: null, logged: "full" });
    out.push(i === count ? { ...r, reviewed: true } : { ...r, reviewed: true, putt: { ...r.putt, speed: null, breakRead: null, line: null } });
  }
  return out;
}

/** `Save all` — every record of the story reviewed. */
export const reviewAll = (records) => (records || []).map((r) => (r.reviewed === true ? r : { ...r, reviewed: true }));
