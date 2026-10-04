/*
 * trail.js — the breadcrumb trail's pure model (docs/SPEC-shotlog-v2.md §10, v22.18).
 *
 * While the caddie screen is open, every GPS fix (and every test-mode tap) is offered to
 * appendPoint; the per-hole trail is a shot-position memory first and a walking map second.
 *
 *   appendPoint(points, p, cfg)   thin to points ≥ thinM (3 m) OR ≥ thinSec (10 s) apart, cap maxPoints (600)
 *   stopsFrom(points, cfg)        runs of points within radiusM (6 m) of their mean for ≥ minSec (15 s)
 *   matchStops(stops, shots)      a stop within matchYds (8 yds) of a recorded shot's start is that shot
 *   candidates(stops, shots)      the stops no shot matches
 *   candidateFor(stop, shots)     the shot number a candidate would place: the next unplaced shot
 *
 * A point is { t (ms since epoch), lat, lng, acc (metres, may be null) }. A stop is
 * { lat, lng, acc, t0, t1, n }: the run's mean position, its best accuracy, first / last time and
 * point count. Shots are shot records (shotlog.js): hole, shotNo, start.{lat,lng}, placed.
 *
 * Pure: no DOM, no storage, no clock (times come in on the points). Storage (`bogeyman-matches:
 * trail:v1:{roundId}`) and watchPosition belong to the app.
 */

import { DEFAULT_CONFIG } from "./config.js";

const R_EARTH_M = 6371008.8;
const M_PER_YD = 0.9144;
const DEG = Math.PI / 180;

function trailCfg(cfg) {
  return { ...DEFAULT_CONFIG.TRAIL_STOP, ...(cfg?.TRAIL_STOP || {}) };
}

const isFix = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Great-circle distance in metres between two { lat, lng }. */
export function distM(a, b) {
  const dLat = (b.lat - a.lat) * DEG, dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A fix in trail form: { t, lat, lng, acc }. Accepts `lon` for `lng` and `accuracyM` for `acc`. */
function norm(p) {
  const lng = Number.isFinite(p.lng) ? p.lng : p.lon;
  const acc = Number.isFinite(p.acc) ? p.acc : Number.isFinite(p.accuracyM) ? p.accuracyM : null;
  return { t: p.t, lat: p.lat, lng, acc };
}

/**
 * The trail with `p` appended, or the same array (unchanged reference) when `p` is thinned out:
 * kept only when it is ≥ thinM metres from the last kept point OR ≥ thinSec seconds after it. An
 * unusable fix, or one older than the last point, is dropped. Past maxPoints the oldest points go.
 * Never mutates `points`.
 */
export function appendPoint(points, p, cfg = DEFAULT_CONFIG) {
  const C = trailCfg(cfg);
  const list = Array.isArray(points) ? points : [];
  if (!p || !Number.isFinite(p.t)) return list;
  const q = norm(p);
  if (!isFix(q)) return list;
  const last = list[list.length - 1];
  if (last) {
    if (q.t < last.t) return list;
    if (distM(last, q) < C.thinM && (q.t - last.t) / 1000 < C.thinSec) return list;
  }
  const out = [...list, q];
  return out.length > C.maxPoints ? out.slice(out.length - C.maxPoints) : out;
}

function meanOf(run) {
  let lat = 0, lng = 0;
  for (const p of run) { lat += p.lat; lng += p.lng; }
  return { lat: lat / run.length, lng: lng / run.length };
}

function stopOf(run) {
  const m = meanOf(run);
  const accs = run.map((p) => p.acc).filter(Number.isFinite);
  return { lat: m.lat, lng: m.lng, acc: accs.length ? Math.min(...accs) : null, t0: run[0].t, t1: run[run.length - 1].t, n: run.length };
}

/**
 * Stops: maximal runs of consecutive points that all stay within radiusM of one another and span
 * ≥ minSec seconds. The run grows while the next point is within radiusM of every point in it; when
 * it is not, the run closes. A run that lasted long enough is a stop and the next run starts fresh;
 * one that did not hands on its tail still within reach of the new point (so an approach step that
 * broke the run does not cost the pause its first, up-to-10-s-thinned, point). Pairwise, not
 * "within radiusM of the mean" (a 12 m circle): walking through 6 m takes ~5 s, so a short pause plus
 * the steps either side of it does not read as a 15-s stop. Points must be in time order
 * (appendPoint keeps them so).
 */
export function stopsFrom(points, cfg = DEFAULT_CONFIG) {
  const C = trailCfg(cfg);
  const pts = (points || []).filter((p) => isFix(p) && Number.isFinite(p.t));
  const stops = [];
  let run = [];
  for (const p of pts) {
    if (run.every((q) => distM(q, p) <= C.radiusM)) { run.push(p); continue; }
    if (run.length >= 2 && (run[run.length - 1].t - run[0].t) / 1000 >= C.minSec) {
      stops.push(stopOf(run));
      run = [p];
      continue;
    }
    let k = run.length;
    while (k > 0 && distM(run[k - 1], p) <= C.radiusM) k--;
    run = [...run.slice(k), p];
  }
  if (run.length >= 2 && (run[run.length - 1].t - run[0].t) / 1000 >= C.minSec) stops.push(stopOf(run));
  return stops;
}

const startOf = (s) => {
  const st = s?.start;
  if (!st) return null;
  const lng = Number.isFinite(st.lng) ? st.lng : st.lon;
  return Number.isFinite(st.lat) && Number.isFinite(lng) ? { lat: st.lat, lng } : null;
};

/**
 * Every stop, marked: { ...stop, matched, shotNo, distYds }. A stop within matchYds (8) of a
 * recorded shot's start is that shot (the nearest shot when several are in range; each shot claims
 * at most one stop, the nearest). Unmatched stops carry matched false, shotNo null.
 */
export function matchStops(stops, shots, cfg = DEFAULT_CONFIG) {
  const C = trailCfg(cfg);
  const starts = (shots || []).map((s) => ({ s, at: startOf(s) })).filter((x) => x.at && Number.isFinite(x.s.shotNo));
  // every (stop, shot) pair in range, nearest first; greedy one-to-one
  const pairs = [];
  (stops || []).forEach((st, i) => {
    for (const x of starts) {
      const yds = distM(st, x.at) / M_PER_YD;
      if (yds <= C.matchYds) pairs.push({ i, x, yds });
    }
  });
  pairs.sort((a, b) => a.yds - b.yds);
  const byStop = new Map(), used = new Set();
  for (const pr of pairs) {
    if (byStop.has(pr.i) || used.has(pr.x.s)) continue;
    byStop.set(pr.i, pr);
    used.add(pr.x.s);
  }
  return (stops || []).map((st, i) => {
    const m = byStop.get(i);
    return m ? { ...st, matched: true, shotNo: m.x.s.shotNo, distYds: Math.round(m.yds * 10) / 10 }
      : { ...st, matched: false, shotNo: null, distYds: null };
  });
}

/** The stops no recorded shot accounts for — the hollow rings Brett can place a shot on. */
export function candidates(stops, shots, cfg = DEFAULT_CONFIG) {
  return matchStops(stops, shots, cfg).filter((s) => !s.matched);
}

/**
 * The shot a candidate stop would become (`Shot N was here`): the lowest-numbered shot on the hole
 * with no start fix and not placed by hand, else one past the highest shot number (1 with none).
 * → { stop, shotNo }.
 */
export function candidateFor(stop, shots) {
  const list = (shots || []).filter((s) => Number.isFinite(s?.shotNo));
  const open = list.filter((s) => !startOf(s) && !s.placed).map((s) => s.shotNo).sort((a, b) => a - b);
  const shotNo = open.length ? open[0] : list.length ? Math.max(...list.map((s) => s.shotNo)) + 1 : 1;
  return { stop, shotNo };
}
