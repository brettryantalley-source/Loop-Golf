/*
 * historyFix.js — v22.16: finished rounds re-read from a verified local card (src/localCards.js).
 *
 * The Ironwood round Brett scored in Loop on 2026-09-28 was played on the course API's "… / Ridge"
 * routing before v22.12: the API's back-nine pars were not Ridge's, and each nine's handicaps ran
 * 1–9, so the stored card had every stroke index twice and the ghost took double strokes (D54–D55
 * fixed Setup afterwards, not the round already in history). This rewrites such a round from the
 * printed card — pars, par, yards for the tee played, the odd/even stroke index — and regenerates
 * exactly the fields a live round's record derives from them, by CALLING the frozen engine
 * (`computeGhost`, `evalMatch`, injected from app.jsx — never copied, never edited):
 *   ghostHoleScores, ghostTotal, yourPoints, ghostPoints, result, yourTotal, differential.
 * Hole scores, the date, the id, rating / slope, the differential used and the tee are untouched.
 * `updatedAt` moves forward (the cloud mirror is last-write-wins on it) and `cardFix` marks the
 * record so the fix runs once. Pure: no DOM, no storage.
 */

import { composeStrokeIndex, localCombo } from "./routing.js";

export const CARD_FIX_VERSION = 1;
export const cardFixTag = (club) => `${club.key}@${CARD_FIX_VERSION}`;

/** A finished round's result from Brett's points out of 8 — the rule buildRecord (app.jsx) writes. */
export function matchResult(yourPoints) {
  return yourPoints > 4.0001 ? "W" : yourPoints < 3.9999 ? "L" : "T";
}

const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/** The card's [i, j] for the nines a stored round names: `routing` ("Lakes / Ridge"), else `nines`
 *  (["Lakes", "Ridge"] or { play: [...] }). null when it names no two of the card's nines. */
export function recordNines(record, card) {
  if (!record || !card) return null;
  if (typeof record.routing === "string") {
    const c = localCombo(card, record.routing);
    if (c) return c;
  }
  const n = record.nines;
  const play = Array.isArray(n) ? n : n && Array.isArray(n.play) ? n.play : null;
  if (play && play.length === 2) return localCombo(card, play.join("/"));
  return null;
}

function ratingSlopeOf(r) {
  if (Number.isFinite(r.rating) && Number.isFinite(r.slope)) return { rating: r.rating, slope: r.slope };
  const m = /^\s*([\d.]+)\s*\/\s*(\d+)\s*$/.exec(String(r.ratingSlope ?? ""));
  return m ? { rating: parseFloat(m[1]), slope: parseInt(m[2], 10) } : null;
}

/**
 * history → { history, changed: [{ id, club, nines, before, after }], skipped: [{ id, reason }] }.
 * `clubs` = LOCAL_CLUBS; `engine` = { computeGhost, evalMatch, recordDifferential?, now? }.
 * A round is considered when its course name matches a card (`match.name`; stored rounds carry no
 * location). Left alone, and listed in `skipped` with the reason, when: already fixed (cardFix),
 * the nines cannot be read off it, it cannot be re-scored (no hole scores / differential used /
 * rating), or it already matches the card (a round played on the card since v22.12 — not bumped).
 * Returns the SAME array when nothing changed.
 */
export function fixHistoryFromLocalCards(history, clubs, engine = {}) {
  const { computeGhost, evalMatch, recordDifferential } = engine;
  if (typeof computeGhost !== "function" || typeof evalMatch !== "function") throw new Error("historyFix: computeGhost and evalMatch are required");
  const now = Number.isFinite(engine.now) ? engine.now : Date.now();
  const changed = [], skipped = [];
  let any = false;
  const out = (history || []).map((r) => {
    if (!r || typeof r !== "object") return r;
    const card = (clubs || []).find((c) => c?.match?.name?.test(String(r.course || "")));
    if (!card) return r;
    const tag = cardFixTag(card);
    if (r.cardFix === tag) { skipped.push({ id: r.id, reason: "already fixed" }); return r; }
    const combo = recordNines(r, card);
    if (!combo) { skipped.push({ id: r.id, reason: "nines unknown" }); return r; }
    const rs = ratingSlopeOf(r);
    if (!rs || !Array.isArray(r.holeScores) || r.holeScores.length !== 18 || !Number.isFinite(r.differentialUsed)) {
      skipped.push({ id: r.id, reason: "cannot re-score" }); return r;
    }
    const [a, b] = [card.nines[combo[0]], card.nines[combo[1]]];
    const pars = [...a.pars, ...b.pars];
    const strokeIndex = composeStrokeIndex(a.si, b.si);
    const par = pars.reduce((x, y) => x + y, 0);
    const tee = (card.tees || []).find((t) => t.toLowerCase() === String(r.tee || "").trim().toLowerCase()) || null;
    const yardages = tee ? [...a.yards[tee], ...b.yards[tee]] : r.yardages;
    if (sameArr(r.pars, pars) && sameArr(r.strokeIndex, strokeIndex) && r.par === par && (!tee || sameArr(r.yardages, yardages))) {
      skipped.push({ id: r.id, reason: "matches the card" }); return r;
    }

    // the same two calls a live round makes (App's ghost memo + buildRecord), on the card's holes
    const course = { rating: rs.rating, slope: rs.slope, par, holes: pars.map((p, k) => ({ par: p, si: strokeIndex[k] })) };
    const ghost = computeGhost(course, r.differentialUsed);
    const m = evalMatch(r.holeScores, ghost.holes);
    const next = {
      ...r,
      pars, strokeIndex, par,
      ...(yardages !== undefined ? { yardages } : {}),
      ghostHoleScores: ghost.holes.slice(),
      ghostTotal: ghost.gross,
      yourTotal: m.total.yourTot,
      yourPoints: m.you,
      ghostPoints: m.opp,
      result: matchResult(m.you),
      updatedAt: Math.max(now, (Number.isFinite(r.updatedAt) ? r.updatedAt : 0) + 1),
      cardFix: tag,
      // what the card replaced, so the change can be read (or undone) later; additive
      cardFixPrev: {
        pars: r.pars ?? null, strokeIndex: r.strokeIndex ?? null, par: r.par ?? null,
        ghostTotal: r.ghostTotal ?? null, yourPoints: r.yourPoints ?? null, ghostPoints: r.ghostPoints ?? null,
        result: r.result ?? null, differential: r.differential ?? null,
      },
    };
    if (typeof recordDifferential === "function") next.differential = recordDifferential(next);
    any = true;
    changed.push({
      id: r.id, club: card.key, nines: combo.map((i) => card.nines[i].label),
      before: { result: r.result, yourPoints: r.yourPoints, ghostPoints: r.ghostPoints, ghostTotal: r.ghostTotal, differential: r.differential ?? null },
      after: { result: next.result, yourPoints: next.yourPoints, ghostPoints: next.ghostPoints, ghostTotal: next.ghostTotal, differential: next.differential ?? null },
    });
    return next;
  });
  return { history: any ? out : history, changed, skipped };
}
