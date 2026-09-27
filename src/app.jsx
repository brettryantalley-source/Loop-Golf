import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, doc, setDoc, getDocs } from "firebase/firestore";
import { advise } from "./caddie.js";
import PROFILE from "./profile.json";
import { greenDistances, autoPhase, fetchGeometry, compactGeometry } from "./geometry.js";
import { HoleMap, prefetchTiles, tileCacheStatus } from "./holeMap.jsx";
import { T, F, caps, printed, written, writtenWord, rule, hairline, doubleRule, PencilDefs, Logo, teeTint } from "./theme.jsx";

const React = window.React;
const { useState, useMemo, useEffect } = React;
const { createRoot } = window.ReactDOM;

/* ---------- inline lucide-style icons ---------- */
const svgBase = {
  width: 24, height: 24, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round", strokeLinejoin: "round",
};
const Icon = ({ size = 24, color, children }) => (
  <svg {...svgBase} width={size} height={size} style={{ color: color || "currentColor", display: "block" }}>{children}</svg>
);
const ChevronLeft = (p) => <Icon {...p}><polyline points="15 18 9 12 15 6" /></Icon>;
const ChevronRight = (p) => <Icon {...p}><polyline points="9 18 15 12 9 6" /></Icon>;
const Minus = (p) => <Icon {...p}><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Plus = (p) => <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const Flag = (p) => <Icon {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></Icon>;
const RotateCcw = (p) => <Icon {...p}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Icon>;
const Target = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Icon>;
const Ghost = ({ size = 24, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", color: color || "currentColor" }}>
    <path fill="currentColor" d="M4 10a8 8 0 0 1 16 0v10c-.7 1.3-3.3 1.3-4 0-.7 1.3-3.3 1.3-4 0-.7 1.3-3.3 1.3-4 0-.7 1.3-3.3 1.3-4 0z" />
  </svg>
);
const Trash = (p) => <Icon {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>;
const Clock = (p) => <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>;
const MapPin = (p) => <Icon {...p}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></Icon>;
const X = (p) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;

/* build tag — bump alongside the sw.js cache version so a deploy is confirmable on-screen */
const BUILD = "v21 · Sep 27";

/* palette — Shot Pattern dark */
const C = {
  bg: "#000000", card: "#161719", card2: "#212327", ink: "#FFFFFF", sub: "#8A8F98",
  line: "#2A2D31", green: "#57C77F", greenDim: "rgba(87,199,127,0.15)",
  slate: "#9AA7B4", slateDim: "rgba(154,167,180,0.15)", red: "#FF5B52",
  redDim: "rgba(255,91,82,0.16)", tie: "#34373D",
};
const NUM = "-apple-system,ui-sans-serif,'SF Pro Display',system-ui,sans-serif";
const SANS = "-apple-system,ui-sans-serif,'SF Pro Text',system-ui,sans-serif";
const tnum = { fontVariantNumeric: "tabular-nums" };
const RESET = `*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
button{font-family:inherit;cursor:pointer;border:none;padding:0;background:none}
html,body{margin:0;background:#F4F0E4}
.dialscroll::-webkit-scrollbar{display:none}
div::-webkit-scrollbar{display:none}`;

/* ---------- live course source (golfcourseapi.com) ---------- */
const API_BASE = "https://api.golfcourseapi.com/v1";
const API_KEY = "Y2KP2ACTI2YKKBK5UAR244RBKA";
const apiHeaders = { Authorization: `Bearer ${API_KEY}` };
const courseCacheKey = (id) => `course_cache_${id}`;

/* Call 1 — search. Returns the `courses` array (may include inline tee data). */
async function searchCourses(query, signal) {
  const r = await fetch(`${API_BASE}/search?search_query=${encodeURIComponent(query)}&fuzzy_match=true`, { headers: apiHeaders, signal });
  if (!r.ok) throw new Error("search http " + r.status);
  const data = await r.json();
  return Array.isArray(data.courses) ? data.courses : [];
}

/* Call 2 — full course. Cache hit => no network. Miss => fetch + cache. Throws on failure. */
async function loadFullCourse(id) {
  try { const raw = localStorage.getItem(courseCacheKey(id)); if (raw) { const c = JSON.parse(raw); if (c && c.tees) return c; } } catch (e) { /* ignore */ }
  const r = await fetch(`${API_BASE}/courses/${id}`, { headers: apiHeaders });
  if (!r.ok) throw new Error("course http " + r.status);
  const data = await r.json();
  const course = data.course;
  if (!course || !course.tees) throw new Error("bad course payload");
  try { localStorage.setItem(courseCacheKey(id), JSON.stringify(course)); } catch (e) { /* quota */ }
  return course;
}

/* Flatten tees.male + tees.female into one picker list; skip any non-18-hole tee. */
function teeOptions(fullCourse) {
  const tees = fullCourse.tees || {};
  const out = [];
  ["male", "female"].forEach(gender => {
    const arr = Array.isArray(tees[gender]) ? tees[gender] : [];
    arr.forEach((tee, i) => {
      if (Array.isArray(tee.holes) && tee.holes.length === 18) out.push({ key: `${gender}:${i}`, gender, tee });
    });
  });
  return out;
}

/* Total yardage of a tee option — summed from its holes (the API's own total is
   not always present). Shown under each tee marker on Setup. */
const teeYards = (opt) => (opt.tee.holes || []).reduce((a, h) => a + (h.yardage || 0), 0);

/* Build the engine course object from a full course + a chosen tee option.
   Field mapping (do NOT rename): handicap->si, yardage->yards, course_rating->rating,
   slope_rating->slope, par_total->par. */
function buildCourse(fullCourse, teeOpt) {
  const t = teeOpt.tee;
  const name = fullCourse.club_name || fullCourse.course_name || "Course";
  const loc = fullCourse.location || {};
  return {
    id: `${fullCourse.id}:${teeOpt.key}`,
    apiId: fullCourse.id,
    lat: typeof loc.latitude === "number" ? loc.latitude : undefined,
    lon: typeof loc.longitude === "number" ? loc.longitude : undefined,
    name,
    tee: t.tee_name || teeOpt.gender,
    rating: t.course_rating,
    slope: t.slope_rating,
    par: t.par_total,
    holes: t.holes.map(h => ({ par: h.par, si: h.handicap, yards: h.yardage })),
  };
}

/* Validate a persisted course object before restoring an in-progress round. */
function validCourse(c) {
  return !!c && Array.isArray(c.holes) && c.holes.length === 18 &&
    c.holes.every(h => h && typeof h.par === "number" && typeof h.si === "number") &&
    typeof c.rating === "number" && typeof c.slope === "number" && typeof c.par === "number";
}

/* ---------- home-state filter (results have state; the API also returns location.latitude/longitude since v1.1 — used by the Hole View, not here) ---------- */
const HOME_STATE_KEY = "bogeyman-matches:home-state";
const GEO_URL = "https://api-bdc.io/data/reverse-geocode-client"; // free, no key, CORS-open reverse geocode
const US_STATES = [
  {c:"AL",n:"Alabama"},{c:"AK",n:"Alaska"},{c:"AZ",n:"Arizona"},{c:"AR",n:"Arkansas"},{c:"CA",n:"California"},{c:"CO",n:"Colorado"},{c:"CT",n:"Connecticut"},{c:"DE",n:"Delaware"},{c:"DC",n:"District of Columbia"},{c:"FL",n:"Florida"},{c:"GA",n:"Georgia"},{c:"HI",n:"Hawaii"},{c:"ID",n:"Idaho"},{c:"IL",n:"Illinois"},{c:"IN",n:"Indiana"},{c:"IA",n:"Iowa"},{c:"KS",n:"Kansas"},{c:"KY",n:"Kentucky"},{c:"LA",n:"Louisiana"},{c:"ME",n:"Maine"},{c:"MD",n:"Maryland"},{c:"MA",n:"Massachusetts"},{c:"MI",n:"Michigan"},{c:"MN",n:"Minnesota"},{c:"MS",n:"Mississippi"},{c:"MO",n:"Missouri"},{c:"MT",n:"Montana"},{c:"NE",n:"Nebraska"},{c:"NV",n:"Nevada"},{c:"NH",n:"New Hampshire"},{c:"NJ",n:"New Jersey"},{c:"NM",n:"New Mexico"},{c:"NY",n:"New York"},{c:"NC",n:"North Carolina"},{c:"ND",n:"North Dakota"},{c:"OH",n:"Ohio"},{c:"OK",n:"Oklahoma"},{c:"OR",n:"Oregon"},{c:"PA",n:"Pennsylvania"},{c:"RI",n:"Rhode Island"},{c:"SC",n:"South Carolina"},{c:"SD",n:"South Dakota"},{c:"TN",n:"Tennessee"},{c:"TX",n:"Texas"},{c:"UT",n:"Utah"},{c:"VT",n:"Vermont"},{c:"VA",n:"Virginia"},{c:"WA",n:"Washington"},{c:"WV",n:"West Virginia"},{c:"WI",n:"Wisconsin"},{c:"WY",n:"Wyoming"},
];
const STATE_SET = new Set(US_STATES.map(s => s.c));

/* engine (verified) — do not modify */
function computeGhost(c, d) {
  const hcp = Math.round(d * c.slope / 113 + (c.rating - c.par));
  const base = Math.floor(hcp / 18), rem = ((hcp % 18) + 18) % 18;
  const holes = c.holes.map(h => h.par + base + (h.si <= rem ? 1 : 0));
  return { holes, hcp, gross: holes.reduce((a, b) => a + b, 0) };
}
const TOTAL_PT = 1.0;
function evalMatch(scores, ghost) {
  let you = 0, opp = 0; const segs = [];
  for (let s = 0; s < 6; s++) {
    const idx = [s * 3, s * 3 + 1, s * 3 + 2];
    const played = idx.filter(i => scores[i] != null);
    const done = played.length === 3;
    const yourSum = idx.reduce((a, i) => a + (scores[i] ?? 0), 0);
    const ghostSum = idx.reduce((a, i) => a + ghost[i], 0);
    const liveMargin = played.reduce((a, i) => a + scores[i] - ghost[i], 0);
    let res = "live";
    if (done) { if (yourSum < ghostSum) { you += 1; res = "win"; } else if (yourSum > ghostSum) { opp += 1; res = "loss"; } else { you += 0.5; opp += 0.5; res = "tie"; } }
    segs.push({ idx, done, res, yourSum, ghostSum, holesIn: played.length, liveMargin });
  }
  const nine = (start) => {
    const idx = [...Array(9)].map((_, k) => start + k);
    const played = idx.filter(i => scores[i] != null);
    const done = played.length === 9;
    const yourSum = idx.reduce((a, i) => a + (scores[i] ?? 0), 0);
    const ghostSum = idx.reduce((a, i) => a + ghost[i], 0);
    let res = "live";
    if (done) res = yourSum < ghostSum ? "win" : yourSum > ghostSum ? "loss" : "tie";
    return { done, res, yourSum, ghostSum, liveMargin: played.reduce((a, i) => a + scores[i] - ghost[i], 0) };
  };
  const front = nine(0), back = nine(9);
  [front, back].forEach(n => { if (n.done) { if (n.res === "win") you += 0.5; else if (n.res === "loss") opp += 0.5; else { you += 0.25; opp += 0.25; } } });
  const allDone = scores.every(s => s != null);
  const yourTot = scores.reduce((a, s) => a + (s ?? 0), 0);
  const ghostTot = ghost.reduce((a, s) => a + s, 0);
  const liveMargin = scores.reduce((a, s, i) => s != null ? a + s - ghost[i] : a, 0);
  let totRes = "live";
  if (allDone) { if (yourTot < ghostTot) { you += TOTAL_PT; totRes = "win"; } else if (yourTot > ghostTot) { opp += TOTAL_PT; totRes = "loss"; } else { you += TOTAL_PT / 2; opp += TOTAL_PT / 2; totRes = "tie"; } }
  return { you, opp, segs, front, back, total: { res: totRes, yourTot, ghostTot, liveMargin } };
}
const scoreName = (s, par) => { const d = s - par; return d <= -3 ? "albatross" : d === -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : d === 2 ? "double" : d === 3 ? "triple" : `+${d}`; };
// Points come in quarter increments (a tied nine splits 0.5 -> 0.25 each).
// Print them faithfully: integers plain, else up to 2 decimals with trailing zeros
// trimmed (2 -> "2", 2.5 -> "2.5", 2.25 -> "2.25", 5.75 -> "5.75"). Never round a quarter away.
const fmtPts = (n) => Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.?0+$/, "");
const marginText = (m) => m === 0 ? "AS" : m < 0 ? `${-m}↑` : `${m}↓`;

/* ---------- auto last-5 differential, computed from the app's own finished rounds ----------
   Replaces the published-Sheet source (v5-v13). Every finalized round stores the parts
   needed to score itself; the Setup differential is the average of the most recent
   DIFF_WINDOW of them. Nothing is fetched — this works offline at the course. */
const DIFF_WINDOW = 5;
const fmtShortDate = (d) => { try { return `${MONTHS[d.getMonth()]} ${d.getDate()}`; } catch (e) { return ""; } };

/* Strokes received on each hole at a given course handicap. Same distribution the ghost
   gets in computeGhost — one stroke per hole by stroke index, hardest first, wrapping
   past 18 — so the player and the ghost are stroked off the same card. */
function strokesByHole(strokeIndex, hcp) {
  const base = Math.floor(hcp / 18), rem = ((hcp % 18) + 18) % 18;
  return strokeIndex.map(si => base + (si <= rem ? 1 : 0));
}
/* USGA-style adjusted gross: each hole capped at net double bogey (par + 2 + strokes
   received), so one blow-up hole can't inflate the differential. */
function adjustedGross(holeScores, pars, strokeIndex, hcp) {
  const str = strokesByHole(strokeIndex, hcp);
  return holeScores.reduce((a, s, i) => a + Math.min(s ?? 0, pars[i] + 2 + str[i]), 0);
}
/* Score Differential, rounded to 0.1. (No PCC — this is the simplified calc.) */
const scoreDifferential = (gross, rating, slope) => Math.round((gross - rating) * 113 / slope * 10) / 10;

/* Records written before v2 stored rating/slope only as the "70.1/125" string. */
function parseRatingSlope(s) {
  const m = /^\s*([\d.]+)\s*\/\s*(\d+)\s*$/.exec(String(s ?? ""));
  if (!m) return null;
  const rating = parseFloat(m[1]), slope = parseInt(m[2], 10);
  return isFinite(rating) && slope > 0 ? { rating, slope } : null;
}
/* One round's differential. v2 records carry pars + stroke indexes, so the gross is
   capped at net double bogey; older records have only the rating/slope string and fall
   back to an uncapped gross so they still count toward the last-5. null = unusable. */
function recordDifferential(r) {
  if (!r) return null;
  let rating = typeof r.rating === "number" ? r.rating : null;
  let slope = typeof r.slope === "number" ? r.slope : null;
  if (rating == null || slope == null) {
    const rs = parseRatingSlope(r.ratingSlope);
    if (!rs) return null;
    rating = rs.rating; slope = rs.slope;
  }
  if (!(slope > 0) || !isFinite(rating)) return null;
  const scores = Array.isArray(r.holeScores) ? r.holeScores : null;
  const canCap = !!scores && scores.length === 18 &&
    Array.isArray(r.pars) && r.pars.length === 18 &&
    Array.isArray(r.strokeIndex) && r.strokeIndex.length === 18 &&
    typeof r.par === "number" && typeof r.differentialUsed === "number";
  const gross = canCap
    ? adjustedGross(scores, r.pars, r.strokeIndex, Math.round(r.differentialUsed * slope / 113 + (rating - r.par)))
    : (typeof r.yourTotal === "number" ? r.yourTotal : null);
  if (gross == null || !isFinite(gross) || gross <= 0) return null;
  return scoreDifferential(gross, rating, slope);
}
/* Brett's official last-5 (GHIN) as of Sep 19 2026, so the app starts calibrated instead
   of cold. These seed the differential ONLY — they are not match records, so they never
   touch the W-L-T. Each in-app round played after Sep 5 2026 pushes one further out of
   the window; once five newer rounds exist these stop counting on their own. Gross only
   (no hole detail came across), so no net-double cap is applied to them. */
const SEED_ROUNDS = [
  { date: "2026-09-05", course: "Beachwood Golf Club",              tee: "Blue",  rating: 71.6, slope: 127, gross: 86 },
  { date: "2026-08-15", course: "Chicopee Woods · School/Village",  tee: "Gold",  rating: 73.6, slope: 137, gross: 81 },
  { date: "2026-08-09", course: "RiverPines Golf Course",           tee: "Black", rating: 71.1, slope: 132, gross: 80 },
  { date: "2026-08-03", course: "Chicopee Woods · Village/Mill",    tee: "Gold",  rating: 72.7, slope: 133, gross: 78 },
  { date: "2026-07-26", course: "Sugar Creek Golf Course",          tee: "Blue",  rating: 70.1, slope: 125, gross: 81 },
];

/* {diff, asOf, count, total, seeded} over the DIFF_WINDOW most recent rounds — played
   rounds and seeds pooled together and taken by date — or null when there's nothing
   scorable. Recomputed whenever history changes. */
function computeAutoDiff(history) {
  const recs = (history || [])
    .map(r => ({ d: new Date(r && r.date), v: recordDifferential(r), seed: false }))
    .filter(x => x.v != null && !isNaN(x.d.getTime()));
  SEED_ROUNDS.forEach(s => {
    const d = new Date(s.date + "T12:00:00");           // noon: no TZ drift across the date line
    if (!isNaN(d.getTime()) && s.slope > 0) recs.push({ d, v: scoreDifferential(s.gross, s.rating, s.slope), seed: true });
  });
  if (!recs.length) return null;
  recs.sort((a, b) => b.d - a.d);
  const last = recs.slice(0, DIFF_WINDOW);
  const avg = Math.round((last.reduce((a, x) => a + x.v, 0) / last.length) * 10) / 10;
  return { diff: avg, asOf: last[0].d, count: last.length, total: recs.length,
           seeded: last.filter(x => x.seed).length,
           series: last.slice().reverse().map(x => ({ v: x.v, d: x.d, seed: x.seed })) };
}

/* ---------- history records (reuses evalMatch; no engine changes) ---------- */
const nowISO = () => new Date().toISOString();
const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function buildRecord(base, course, diff, scores, ghost) {
  const m = evalMatch(scores, ghost.holes);
  const yourOut = scores.slice(0, 9).reduce((a, s) => a + (s ?? 0), 0);
  const yourIn = scores.slice(9).reduce((a, s) => a + (s ?? 0), 0);
  const yourPoints = m.you, ghostPoints = m.opp;
  const result = yourPoints > 4.0001 ? "W" : yourPoints < 3.9999 ? "L" : "T";
  const rec = {
    version: 3,
    id: base.id, date: base.date,
    // v3: when this record last changed — the tiebreaker when the same round
    // exists on two devices. Set on every build, including an inline edit.
    updatedAt: Date.now(),
    course: course.name, tee: course.tee, ratingSlope: `${course.rating}/${course.slope}`,
    // v2: rating/slope/par and the per-hole card as NUMBERS, so the round can score its
    // own differential later without re-parsing the display string.
    rating: course.rating, slope: course.slope, par: course.par,
    pars: course.holes.map(h => h.par), strokeIndex: course.holes.map(h => h.si),
    differentialUsed: diff,
    holeScores: scores.slice(), ghostHoleScores: ghost.holes.slice(),
    yardages: course.holes.map(h => typeof h.yards === "number" ? h.yards : null),
    yourOut, yourIn, yourTotal: m.total.yourTot, ghostTotal: ghost.gross,
    yourPoints, ghostPoints,
    result,
  };
  // This round's own Score Differential — the thing the last-5 averages.
  rec.differential = recordDifferential(rec);
  return rec;
}
function deriveStats(history) {
  const n = history.length;
  let w = 0, l = 0, t = 0;
  history.forEach(r => { if (r.result === "W") w++; else if (r.result === "L") l++; else t++; });
  let streak = null; // consecutive most-recent W or L; a T ends any streak
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i].result;
    if (r === "T") break;
    if (!streak) streak = { type: r, count: 1 };
    else if (streak.type === r) streak.count++;
    else break;
  }
  const margin = n ? history.reduce((a, r) => a + (r.yourPoints - r.ghostPoints), 0) / n : 0;
  return {
    n, w, l, t, streak, margin,
    recordText: `${w}–${l}–${t}`,
    streakText: streak ? `${streak.type}${streak.count}` : "—",
    marginStr: n ? `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}` : "—",
  };
}

/* ghost dispersion ring */
function GhostRing({ value, size = 44, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1.5px solid ${C.slate}`, opacity: 0.3 }} />
        <div style={{ position: "absolute", inset: size * 0.13, borderRadius: "50%", border: `2px solid ${C.slate}`, background: C.slateDim }} />
        <span style={{ position: "relative", fontFamily: NUM, fontWeight: 800, color: C.slate, fontSize: size * 0.4, ...tnum }}>{value}</span>
      </div>
      {label && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: C.slate }}>{label}</span>}
    </div>
  );
}

/* segment cell */
function SegCell({ res, label, sub, margin }) {
  let bg = C.card2, fg = C.sub, sc = C.sub;
  if (res === "win") { bg = C.green; fg = "#07140C"; sc = "rgba(7,20,12,0.7)"; }
  else if (res === "loss") { bg = C.red; fg = "#fff"; sc = "rgba(255,255,255,0.85)"; }
  else if (res === "tie") { bg = C.tie; fg = "#fff"; sc = "rgba(255,255,255,0.6)"; }
  else { sc = margin < 0 ? C.green : margin > 0 ? C.red : C.sub; }
  return (
    <div style={{ background: bg, border: res === "live" ? `1px solid ${C.line}` : "none", borderRadius: 10, padding: "5px 1px", textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: fg }}>{label}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: sc, fontFamily: NUM, ...tnum }}>{sub}</div>
    </div>
  );
}
function StatPill({ label, res, sub }) {
  let bg = C.card2, fg = C.sub, sc = C.sub;
  if (res === "win") { bg = C.greenDim; fg = C.green; sc = C.green; }
  else if (res === "loss") { bg = C.redDim; fg = C.red; sc = C.red; }
  else if (res === "tie") { bg = C.tie; fg = "#fff"; sc = "rgba(255,255,255,0.7)"; }
  return (
    <div style={{ background: bg, borderRadius: 10, padding: "5px 2px", textAlign: "center" }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: fg }}>{label}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: sc, fontFamily: NUM, ...tnum }}>{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 6px", textAlign: "center" }}>
      <div style={{ color: C.sub, fontSize: 9, fontWeight: 800, letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color: accent || C.ink, fontFamily: NUM, fontSize: 17, fontWeight: 800, marginTop: 2, ...tnum }}>{value}</div>
    </div>
  );
}
const streakAccent = (stats) => stats.streak ? (stats.streak.type === "W" ? C.green : C.red) : C.sub;
const marginAccent = (stats) => stats.n ? (stats.margin > 0 ? C.green : stats.margin < 0 ? C.red : C.ink) : C.sub;

const stepBtn = { width: 54, height: 54, borderRadius: 15, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const lbl = { color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: 1 };

/* ---------- setup (one screen: search course · pick tee · differential · start) ---------- */
/* Satellite for offline (v19): the course's tiles at z16–19 into the tile cache, on wifi, before the round. */
function TileCacheLine({ geo }) {
  const [st, setSt] = useState(null);          // { have, total }
  const [prog, setProg] = useState(null);      // { done, total, ok } while fetching
  useEffect(() => { let live = true; tileCacheStatus(geo).then(r => { if (live) setSt(r); }); return () => { live = false; }; }, [geo]);
  const run = () => {
    if (prog) return;
    setProg({ done: 0, total: 0, ok: 0 });
    prefetchTiles(geo, setProg).then(r => { setProg(null); setSt({ have: r.ok, total: r.total }); }).catch(() => setProg(null));
  };
  if (!st) return null;
  const full = st.total > 0 && st.have >= st.total;
  const label = prog ? `Saving satellite… ${prog.done}/${prog.total}` : full ? `Satellite saved for offline · ${st.total} tiles` : `Satellite offline · ${st.have}/${st.total} tiles — tap to save on wifi`;
  return <button onClick={full ? undefined : run} style={{ display: "block", color: full ? C.green : C.sub, fontSize: 11, marginTop: 3, textAlign: "left", ...tnum }}>{label}</button>;
}

/* Summary and History are not redesigned yet (the result screen is still to be
   drawn). They keep the old dark palette, so they need their own shell now that
   the app root is paper. */
function DarkShell({ children }) {
  return <div style={{ minHeight: "100dvh", background: C.bg, color: C.ink, fontFamily: SANS }}>{children}</div>;
}

/* ---------- setup (paper scorecard, v21) ---------- */
/* Pencil polyline of the last five differentials. Most recent point is yellow —
   it is the one a new round shifts. Dotted baseline sits at the series mean. */
function LastFiveChart({ series }) {
  const W = 291, H = 64, base = 44, top = 12, bot = 34;
  const pts = series.slice(-DIFF_WINDOW);
  if (!pts.length) return <div style={{ height: H, ...caps(11, 400, "0"), color: T.muted, display: "flex", alignItems: "center" }}>No rounds on record yet.</div>;
  const vals = pts.map(p => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  /* lower differential is better, so invert: the best round sits highest */
  const y = (v) => top + ((v - lo) / span) * (bot - top);
  const x = (i) => pts.length === 1 ? W / 2 : 14 + (i * (W - 28)) / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d={`M0 ${base} H${W}`} stroke={T.hair} strokeWidth="1" strokeDasharray="2 3" />
      <path d={d} stroke={T.pencil} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" filter="url(#pencil)" />
      {pts.map((p, i) => {
        const last = i === pts.length - 1;
        return last
          ? <circle key={i} cx={x(i)} cy={y(p.v)} r="4" fill={T.yellow} stroke={T.pencil} strokeWidth="1.4" />
          : <circle key={i} cx={x(i)} cy={y(p.v)} r="2.6" fill={T.pencil} />;
      })}
      {pts.map((p, i) => (
        <text key={"t" + i} x={x(i)} y="60" textAnchor="middle" fontFamily={F.handNum} fontSize="13" fill={p.seed ? T.ghost : T.pencil}>{p.v.toFixed(1)}</text>
      ))}
    </svg>
  );
}

/* Five-bar gate. Four uprights then a diagonal across them, wrapping every 3 groups. */
function TallyMarks({ n }) {
  const groups = Math.floor(n / 5), rem = n % 5;
  const per = 46, lead = 5, gap = 10;
  const items = [...Array(groups)].map(() => 5).concat(rem ? [rem] : []);
  if (!n) return <span style={{ ...caps(11, 400, "0"), fontFamily: F.label, color: T.muted }}>—</span>;
  const W = Math.max(1, items.length) * per;
  return (
    <svg width={W} height="24" viewBox={`0 0 ${W} 24`} fill="none" stroke={T.pencil} strokeWidth="1.8" strokeLinecap="round" filter="url(#pencil)" aria-hidden="true">
      {items.map((c, g) => {
        const ox = g * per;
        const bars = [...Array(Math.min(c, 4))].map((_, k) => `M${ox + lead + k * gap} 3 L${ox + lead + k * gap + 0.6} 21`).join(" ");
        const slash = c === 5 ? ` M${ox + lead - 3} 20 L${ox + lead + 3 * gap + 3} 4` : "";
        return <path key={g} d={bars + slash} />;
      })}
    </svg>
  );
}

/* A section of the card: content vertically centred between two ink rules. */
function Row({ height, pad, last, children, ...rest }) {
  return (
    <div {...rest} style={{ display: "flex", flexDirection: "column", justifyContent: "center",
      height, padding: pad, borderBottom: last ? "none" : rule, boxSizing: "border-box", ...(rest.style || {}) }}>
      {children}
    </div>
  );
}

/* Full-screen course search. The chevron row on Setup opens it; picking a course
   closes it and the tee markers below take over. Same API calls as before. */
function CoursePicker({ onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState("idle");
  const [homeState, setHomeState] = useState(() => { try { return localStorage.getItem(HOME_STATE_KEY) || ""; } catch (e) { return ""; } });
  const [locating, setLocating] = useState(false);
  const [locMsg, setLocMsg] = useState("");
  const saveHomeState = (s) => { setHomeState(s); setLocMsg(""); try { s ? localStorage.setItem(HOME_STATE_KEY, s) : localStorage.removeItem(HOME_STATE_KEY); } catch (e) { /* quota */ } };
  const detectState = () => {
    if (!navigator.geolocation) { setLocMsg("Location isn't available — pick your state."); return; }
    setLocating(true); setLocMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetch(`${GEO_URL}?latitude=${pos.coords.latitude}&longitude=${pos.coords.longitude}&localityLanguage=en`)
          .then(r => r.ok ? r.json() : Promise.reject(new Error("http " + r.status)))
          .then(d => {
            const code = String(d.principalSubdivisionCode || "").split("-").pop();
            if (d.countryCode === "US" && STATE_SET.has(code)) saveHomeState(code);
            else setLocMsg("Couldn't match your state — pick it below.");
          })
          .catch(() => setLocMsg("Location lookup failed — pick your state."))
          .finally(() => setLocating(false));
      },
      () => { setLocating(false); setLocMsg("Location off or denied — pick your state."); },
      { timeout: 8000, maximumAge: 300000 }
    );
  };
  const CAP = 12;
  const stateOf = (r) => (r.location && r.location.state) || "";
  const displayed = useMemo(() => {
    if (!homeState) return results.slice(0, CAP);
    return [...results.filter(r => stateOf(r) === homeState), ...results.filter(r => stateOf(r) !== homeState)].slice(0, CAP);
  }, [results, homeState]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearchState("idle"); return; }
    const ctrl = new AbortController();
    setSearchState("loading");
    const t = setTimeout(() => {
      searchCourses(q, ctrl.signal)
        .then(cs => { setResults(cs.slice(0, 40)); setSearchState(cs.length ? "done" : "empty"); })
        .catch(err => { if (err.name !== "AbortError") { setResults([]); setSearchState("error"); } });
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  const field = { width: "100%", boxSizing: "border-box", padding: "10px 0", background: "transparent",
    border: "none", borderBottom: rule, color: T.pencil, fontFamily: F.hand, fontSize: 26, outline: "none" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: T.paper, display: "flex", flexDirection: "column",
      padding: "calc(env(safe-area-inset-top) + 16px) 22px calc(env(safe-area-inset-bottom) + 16px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: rule }}>
        <span style={caps(11)}>Course</span>
        <button onClick={onClose} style={{ ...caps(11), background: "none", border: "none", color: T.ink, padding: "6px 0" }}>Close</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 12 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder="Course name…" autoCapitalize="words" autoCorrect="off" spellCheck={false} style={field} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: rule }}>
        <button onClick={detectState} disabled={locating} style={{ ...caps(10), background: "none", border: "none", color: locating ? T.muted : T.ink, padding: 0 }}>Use my location</button>
        <span style={{ color: T.hair }}>·</span>
        <select value={homeState} onChange={(e) => saveHomeState(e.target.value)} aria-label="Home state"
          style={{ appearance: "none", WebkitAppearance: "none", background: "transparent", border: "none",
            color: homeState ? T.ink : T.muted, fontFamily: F.label, fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          <option value="">All states</option>
          {US_STATES.map(s => <option key={s.c} value={s.c}>{s.n}</option>)}
        </select>
      </div>
      {locMsg && <div style={{ ...caps(10, 400, "0"), fontFamily: F.label, color: T.muted, paddingTop: 8 }}>{locMsg}</div>}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {searchState === "loading" && <div style={{ ...caps(11, 400, "0"), fontFamily: F.label, color: T.muted, padding: "14px 0" }}>Searching…</div>}
        {searchState === "empty" && <div style={{ ...caps(11, 400, "0"), fontFamily: F.label, color: T.muted, padding: "14px 0" }}>No courses found — try a different spelling.</div>}
        {searchState === "error" && <div style={{ ...caps(11, 400, "0"), fontFamily: F.label, color: T.double, padding: "14px 0" }}>Course search unavailable — check your connection.</div>}
        {searchState === "done" && displayed.map(r => (
          <button key={r.id} onClick={() => onPick(r.id)} style={{ display: "block", width: "100%", textAlign: "left",
            padding: "11px 0", background: "none", border: "none", borderBottom: hairline, color: T.ink }}>
            <div style={{ fontFamily: F.hand, fontSize: 24, lineHeight: "24px", color: T.pencil, filter: "url(#pencil)" }}>{r.club_name || r.course_name}</div>
            <div style={{ fontFamily: F.label, fontSize: 11, color: T.muted, marginTop: 2 }}>
              {[r.course_name && r.course_name !== r.club_name ? r.course_name : null, r.location && [r.location.city, r.location.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* Reenie Beanie is wide; step the course name down so long club names still fit
   the row rather than ellipsing halfway through. */
const courseNameSize = (n) => !n ? 26 : n.length <= 16 ? 26 : n.length <= 22 ? 22 : 19;

/* Which tee to pre-select: the one played here last, else the middle set by
   yardage. The longest is the wrong guess — it is the one you play least. */
function defaultTee(opts, full, history) {
  const name = (full.club_name || full.course_name || "").trim();
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const r = history[i];
    if (r && r.course === name && r.tee) {
      const hit = opts.find(o => (o.tee.tee_name || o.gender) === r.tee);
      if (hit) return hit;
    }
  }
  const byYards = opts.slice().sort((a, b) => teeYards(b) - teeYards(a));
  return byYards[Math.floor((byYards.length - 1) / 2)];
}

function Setup({ course, setCourse, diff, setDiff, stats, history, onStart, onHistory, geometry }) {
  const [picking, setPicking] = useState(false);
  const [selectedFull, setSelectedFull] = useState(null);
  const [tees, setTees] = useState([]);
  const [teeKey, setTeeKey] = useState("");
  const [loadState2, setLoadState2] = useState("idle");   // idle | loading | error
  const [pendingId, setPendingId] = useState(null);

  const pickCourse = (id) => {
    setPicking(false);
    setCourse(null); setTees([]); setTeeKey("");
    setPendingId(id); setLoadState2("loading");
    loadFullCourse(id)
      .then(full => {
        const opts = teeOptions(full);
        setSelectedFull(full); setTees(opts); setLoadState2("idle");
        if (opts.length) pickTee(defaultTee(opts, full, history).key, opts, full);
      })
      .catch(() => { setSelectedFull(null); setTees([]); setLoadState2("error"); });
  };
  const pickTee = (key, optsArg, fullArg) => {
    const opts = optsArg || tees, full = fullArg || selectedFull;
    setTeeKey(key);
    const opt = opts.find(o => o.key === key);
    setCourse(opt && full ? buildCourse(full, opt) : null);
  };

  /* differential is read-only now (behaviour decision §5): last five rounds, no override */
  const auto = useMemo(() => computeAutoDiff(history), [history]);
  useEffect(() => { if (auto) setDiff(auto.diff); }, [auto, setDiff]);
  const g = course ? computeGhost(course, diff) : null;

  const courseName = course ? course.name : selectedFull ? (selectedFull.club_name || selectedFull.course_name) : null;
  const parText = course ? course.par : null;
  const yards = course ? course.holes.reduce((a, h) => a + (h.yards || 0), 0) : null;

  return (
    <div style={{ height: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 30px) 20px max(env(safe-area-inset-bottom), 18px)", background: T.paper }}>
      {picking && <CoursePicker onPick={pickCourse} onClose={() => setPicking(false)} />}

      {/* the card: double-rule frame, sections evenly spaced between ink rules */}
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "space-between",
        border: rule, boxShadow: `inset 0 0 0 3px ${T.paper}, inset 0 0 0 4px ${T.ink}`, padding: "20px 22px 18px" }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <Logo width={168} />
          <div style={doubleRule} />
          <span style={{ position: "absolute", left: -9999 }}>{BUILD}</span>
        </div>

        {/* course */}
        <button onClick={() => setPicking(true)} style={{ display: "grid", gridTemplateColumns: "58px 1fr 16px", alignItems: "center", columnGap: 6,
          height: 48, borderBottom: rule, background: "none", border: "none", borderBottomStyle: "solid", padding: 0, textAlign: "left", color: T.ink, width: "100%" }}>
          <span style={caps(11)}>Course</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ ...writtenWord(courseNameSize(courseName)), lineHeight: "26px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {courseName || "Tap to choose"}
            </span>
            {parText != null && <span style={{ fontFamily: F.label, fontSize: 11, whiteSpace: "nowrap", paddingLeft: 2 }}>par <span style={printed(13)}>{parText}</span></span>}
          </span>
          <span style={{ fontSize: 16, textAlign: "right" }}>›</span>
        </button>

        {/* tee markers — yardage under each; the selected one is circled in pencil */}
        <div style={{ display: "grid", gridTemplateColumns: "66px 1fr", alignItems: "center", height: 74, borderBottom: rule }}>
          <span style={caps(11)}>Tee</span>
          {loadState2 === "loading" ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>Loading course…</span>
          : loadState2 === "error" ? <button onClick={() => pendingId && pickCourse(pendingId)} style={{ fontFamily: F.label, fontSize: 11, color: T.double, background: "none", border: "none", textAlign: "left", padding: 0 }}>Couldn't load — tap to retry.</button>
          : tees.length === 0 ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>{selectedFull ? "No 18-hole tees for this course." : "Choose a course first."}</span>
          : (
            <div style={tees.length <= 5
              ? { display: "grid", gridTemplateColumns: `repeat(${tees.length}, minmax(0, 1fr))`, gap: 2 }
              : { display: "flex", gap: 2, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
              {tees.map((o, i) => {
                const sel = o.key === teeKey, tint = teeTint(i);
                return (
                  <button key={o.key} onClick={() => pickTee(o.key)} style={{ position: "relative",
                    ...(tees.length > 5 ? { flex: "0 0 58px" } : { minWidth: 0 }),
                    height: 58, border: "none", background: "transparent", color: T.ink, fontFamily: F.label,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 0 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 7, background: tint === "PAPER" ? T.paper : tint,
                      border: tint === "PAPER" ? `1.5px solid ${T.ink}` : "none" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.tee.tee_name || o.gender}</span>
                    <span style={printed(11, 400)}>{teeYards(o).toLocaleString()}</span>
                    {sel && (
                      <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 58, overflow: "visible" }} viewBox="0 0 66 58" preserveAspectRatio="none" fill="none" aria-hidden="true">
                        <ellipse cx="33" cy="29" rx="29" ry="26" transform="rotate(-4 33 29)" stroke={T.pencil} strokeWidth="1.7" strokeDasharray="160 6" filter="url(#pencil)" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* rating / slope / yards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr 1px 1fr", alignItems: "center", height: 56, borderBottom: rule }}>
          {[["Rating", course ? course.rating : "—"], ["Slope", course ? course.slope : "—"], ["Yards", yards ? yards.toLocaleString() : "—"]]
            .flatMap(([k, v], i) => [
              <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                <span style={caps(10)}>{k}</span>
                <span style={{ ...printed(19), color: course ? T.ink : T.muted }}>{v}</span>
              </div>,
              i < 2 ? <div key={k + "d"} style={{ width: 1, height: 30, background: T.hair }} /> : null,
            ]).filter(Boolean)}
        </div>

        {/* handicap differential — read-only (§5): last-5 / the ghost's projected score */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", height: 54, borderBottom: rule }}>
          <span style={caps(11)}>HCap Diff</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 6, lineHeight: 1 }}>
            <span style={written(24)}>{auto ? diff.toFixed(1) : "—"}</span>
            <span style={{ ...printed(18, 400), color: T.ink }}>/</span>
            <span style={written(24)}>{g ? g.gross : "—"}</span>
          </span>
        </div>

        {/* last five */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderBottom: rule, padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={caps(10)}>Your last five</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink }}>the ghost is built from these</span>
          </div>
          <LastFiveChart series={auto ? auto.series : []} />
        </div>

        {/* record */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, borderBottom: rule, padding: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={caps(10)}>Record vs. the ghost</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink }}>
              {stats.n ? `streak ${stats.streakText} · avg ${stats.marginStr}` : "no rounds yet"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {[["Won", stats.w], ["Lost", stats.l], ["Halved", stats.t]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontFamily: F.label, fontSize: 11 }}>{k}</span>
                <TallyMarks n={v} />
              </div>
            ))}
          </div>
        </div>

        {/* start */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <button onClick={onStart} disabled={!course} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            height: 52, padding: "0 30px", background: course ? T.ink : "transparent", border: `2px solid ${course ? T.ink : T.muted}`,
            borderRadius: 26, boxShadow: course ? `inset 0 0 0 1.5px ${T.yellow}` : "none",
            color: course ? T.paper : T.muted, ...caps(13, 700, "0.22em") }}>
            <svg width="14" height="18" viewBox="0 0 14 18" fill="none" stroke={course ? T.paper : T.muted} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={course ? T.yellow : "none"} stroke={course ? T.yellow : T.muted} />
            </svg>
            {course ? "Start round" : "Choose a course"}
          </button>
          <button onClick={onHistory} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, height: 34,
            background: "none", border: "none", color: T.ink, ...caps(11, 500, "0.14em") }}>
            Round history <span style={{ ...printed(13), letterSpacing: 0 }}>· {stats.n}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- play (fixed one screen) ---------- */
/* running strokes-vs-ghost chart (derived from scores; no engine changes) */
function GhostChart({ scores, ghost }) {
  const W = 280, H = 78, top = 11, bot = 71;
  let cum = 0; const played = [];
  for (let i = 0; i < 18; i++) { if (scores[i] != null) { cum += scores[i] - ghost.holes[i]; played.push({ i, m: cum }); } }
  const cur = played.length ? played[played.length - 1].m : 0;
  const maxAbs = Math.max(3, ...played.map(p => Math.abs(p.m)));
  const evenY = top + (bot - top) * 0.30;
  const yOf = (m) => m >= 0 ? evenY + (m / maxAbs) * (bot - evenY) : evenY + (m / maxAbs) * (evenY - top);
  const xOf = (i) => ((i + 1) / 18) * W;
  const linePts = [[0, evenY]].concat(played.map(p => [xOf(p.i), yOf(p.m)]));
  const lineStr = linePts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const lastX = linePts[linePts.length - 1][0], lastY = linePts[linePts.length - 1][1];
  const areaStr = `${lineStr} ${lastX.toFixed(1)},${H} 0,${H}`;
  const accent = cur > 0 ? C.red : cur < 0 ? C.green : C.slate;
  const fill = cur > 0 ? "rgba(255,91,82,0.14)" : cur < 0 ? "rgba(87,199,127,0.14)" : "rgba(154,167,180,0.12)";
  const status = played.length === 0 ? "not started" : cur > 0 ? `+${cur} · behind` : cur < 0 ? `${cur} · ahead` : "even";
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 15, padding: "9px 12px 5px", flexShrink: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ ...lbl, fontSize: 9 }}>STROKES VS GHOST</span>
        <span style={{ fontFamily: NUM, fontSize: 11, fontWeight: 800, color: accent, ...tnum }}>{status}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <line x1="0" y1={evenY} x2={W} y2={evenY} stroke={C.line} strokeWidth="1" strokeDasharray="3 4" />
        <text x="3" y={evenY - 3} fill={C.sub} fontSize="8">even</text>
        {played.length > 0 && <polygon points={areaStr} fill={fill} />}
        {played.length > 0 && <polyline points={lineStr} fill="none" stroke={accent} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {played.length > 0 && <circle cx={lastX} cy={lastY} r="5" fill={accent} stroke="#000" strokeWidth="2" />}
        <text x={W - 3} y={evenY - 3} fill={C.sub} fontSize="8" textAnchor="end">18</text>
      </svg>
    </div>
  );
}

/* score picker wheel — par centered & enlarged, roll to your number, tap to log */
function ScoreDial({ par, si, ghost, value, onPick }) {
  const ref = React.useRef(null);
  const raf = React.useRef(0);
  const W = 56;
  const min = Math.max(1, par - 4), max = par + 8;
  const nums = []; for (let n = min; n <= max; n++) nums.push(n);
  const [center, setCenter] = useState(value != null ? value : par);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const sel = value != null ? value : par;
    el.scrollLeft = (sel - min) * W;
    setCenter(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = ref.current; if (!el) return;
      setCenter(Math.min(max, Math.max(min, min + Math.round(el.scrollLeft / W))));
    });
  };
  const pick = (n) => { onPick(n); setCenter(n); const el = ref.current; if (el) el.scrollTo({ left: (n - min) * W, behavior: "smooth" }); };
  const size = (d) => d === 0 ? 42 : d === 1 ? 27 : d === 2 ? 20 : 16;
  const op = (d) => d === 0 ? 1 : d === 1 ? 0.82 : d === 2 ? 0.55 : 0.38;
  const logged = value != null && value === center;
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 6px 5px" }}>
        <span style={{ color: C.sub, fontSize: 11, fontWeight: 700, ...tnum }}>PAR {par} · SI {si}</span>
        <span style={{ color: logged ? C.green : C.ink, fontSize: 12, fontWeight: 800 }}>{scoreName(center, par)}{logged ? " · logged ✓" : " · tap to log"}</span>
        <span style={{ color: C.slate, fontSize: 11, fontWeight: 700, ...tnum }}>GHOST {ghost}</span>
      </div>
      <div style={{ position: "relative", height: 66 }}>
        <div style={{ position: "absolute", top: 3, left: "50%", transform: "translateX(-50%)", width: 60, height: 60, borderRadius: 15, border: `1.5px solid ${C.green}`, background: C.greenDim, pointerEvents: "none" }} />
        <div ref={ref} onScroll={onScroll} className="dialscroll" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x mandatory", paddingInline: "calc(50% - 28px)", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
          {nums.map(n => {
            const d = Math.abs(n - center);
            return (
              <button key={n} onClick={() => pick(n)} style={{ scrollSnapAlign: "center", flex: "0 0 56px", width: 56, height: 66, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", padding: 0 }}>
                <span style={{ fontFamily: NUM, fontWeight: d === 0 ? 800 : 700, fontSize: size(d), lineHeight: 1, color: n === value ? C.green : d === 0 ? C.ink : C.sub, opacity: op(d), ...tnum }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Play({ course, ghost, scores, setScores, hole, setHole, onFinish, onExit, onCaddie }) {
  const [confirmExit, setConfirmExit] = useState(false);
  const m = useMemo(() => evalMatch(scores, ghost.holes), [scores, ghost]);
  const h = course.holes[hole], gh = ghost.holes[hole];
  /* Tap a score -> log it, then hand over the next hole. The short pause lets the
     "logged ✓" confirmation register before the dial swaps to the new par; the
     guard means a hole you picked yourself mid-pause wins over the auto-advance. */
  const advance = React.useRef(0);
  useEffect(() => () => clearTimeout(advance.current), []);
  const setVal = (v) => {
    setScores(prev => { const n = [...prev]; n[hole] = Math.max(1, v); return n; });
    if (hole < 17) {
      clearTimeout(advance.current);
      advance.current = setTimeout(() => setHole(h => (h === hole ? h + 1 : h)), 350);
    }
  };
  const lead = m.you - m.opp;
  const filled = scores.filter(s => s != null).length;
  const allIn = filled === 18;
  // Finalize once every hole has a score (the current hole's pending value counts).
  const onlyCurrentMissing = scores.every((s, i) => s != null || i === hole);
  const canFinalize = allIn || onlyCurrentMissing;
  const doFinalize = () => {
    const committed = scores.map((s, i) => s == null ? course.holes[i].par : s);
    setScores(committed);
    onFinish(committed);
  };

  const segSub = (s) => s.done ? `${s.yourSum}–${s.ghostSum}` : (s.holesIn === 0 ? "·" : marginText(s.liveMargin));
  const segLab = (s) => s.done ? (s.res === "win" ? "WON" : s.res === "loss" ? "LOST" : "HALF") : `S${s.idx[0] / 3 + 1}`;
  const nineSub = (n) => n.done ? `${n.yourSum}–${n.ghostSum}` : marginText(n.liveMargin);
  const totSub = m.total.res !== "live" ? `${m.total.yourTot}–${m.total.ghostTot}` : marginText(m.total.liveMargin);

  return (
    <div style={{ height: "100dvh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8, padding: "calc(env(safe-area-inset-top) + 10px) 14px calc(env(safe-area-inset-bottom) + 10px)", overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={() => (filled === 0 ? onExit() : setConfirmExit(true))} aria-label="Exit round" style={{ width: 34, height: 34, borderRadius: 10, background: C.card2, color: C.sub, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={18} /></button>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
            <div style={{ color: C.sub, fontSize: 11, ...tnum }}>{course.tee} · ghost {ghost.gross}</div>
          </div>
        </div>
        {/* screen toggle — same slot on the Caddie header so it reads as one control */}
        <button onClick={onCaddie} aria-label="Open caddie" style={togglePill}><Target size={14} /> CADDIE</button>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ ...lbl, fontSize: 10 }}>HOLE</div>
          <div style={{ fontFamily: NUM, fontWeight: 800, fontSize: 18, color: C.ink, ...tnum }}>{hole + 1}<span style={{ color: C.sub, fontSize: 12 }}>/18</span></div>
        </div>
      </div>

      {/* exit confirmation */}
      {confirmExit && <LeaveSheet hole={hole} onStay={() => setConfirmExit(false)} onLeave={() => { setConfirmExit(false); onExit(); }} />}

      {/* scoreboard */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, borderRadius: 16, padding: "9px 18px", flexShrink: 0 }}>
        <div>
          <div style={{ color: C.green, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>YOU</div>
          <div style={{ fontFamily: NUM, fontSize: 34, fontWeight: 800, color: C.green, lineHeight: 1, ...tnum }}>{fmtPts(m.you)}</div>
        </div>
        <div style={{ color: lead > 0 ? C.green : lead < 0 ? C.red : C.sub, fontSize: 12, fontWeight: 800, letterSpacing: 0.5 }}>
          {lead === 0 ? "ALL SQUARE" : lead > 0 ? `${fmtPts(lead)} UP` : `${fmtPts(-lead)} DOWN`}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.slate, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>GHOST</div>
          <div style={{ fontFamily: NUM, fontSize: 34, fontWeight: 800, color: C.slate, lineHeight: 1, ...tnum }}>{fmtPts(m.opp)}</div>
        </div>
      </div>

      {/* running chart */}
      <GhostChart scores={scores} ghost={ghost} />

      {/* segment strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 5, flexShrink: 0 }}>
        {m.segs.map((s, i) => <SegCell key={i} res={s.res} label={segLab(s)} sub={segSub(s)} margin={s.liveMargin} />)}
      </div>

      {/* front / back / total */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, flexShrink: 0 }}>
        <StatPill label="FRONT 9" res={m.front.res} sub={nineSub(m.front)} />
        <StatPill label="BACK 9" res={m.back.res} sub={nineSub(m.back)} />
        <StatPill label="TOTAL" res={m.total.res} sub={totSub} />
      </div>

      {/* 18-hole board — result at a glance; tap any hole to jump */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(9,1fr)", gap: 5, flexShrink: 0 }}>
        {scores.map((s, i) => {
          let bg = C.card2, col = C.sub, border = `1px solid ${C.line}`;
          if (s != null) { const d = s - ghost.holes[i]; if (d < 0) { bg = C.green; col = "#07140C"; border = "none"; } else if (d > 0) { bg = C.red; col = "#fff"; border = "none"; } else { bg = "#4A4E54"; col = "#fff"; border = "none"; } }
          const now = i === hole;
          return <button key={i} onClick={() => setHole(i)} style={{ height: 30, borderRadius: 8, background: bg, color: col, border: now ? `2px solid ${C.ink}` : border, fontFamily: NUM, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", ...tnum }}>{i + 1}</button>;
        })}
      </div>

      {/* score entry — roll the dial to your number, tap to log (par is centered) */}
      <ScoreDial key={hole} par={h.par} si={h.si} ghost={gh} value={scores[hole]} onPick={setVal} />

      {/* finalize — appears once the round is complete */}
      {canFinalize && (
        <button onClick={doFinalize} style={{ flexShrink: 0, height: 50, borderRadius: 14, background: C.green, color: "#07140C", fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Flag size={18} /> Finalize round</button>
      )}
    </div>
  );
}

/* ---------- shared: header toggle pill + leave-round sheet (Play and Caddie) ---------- */
const togglePill = { height: 34, padding: "0 12px", borderRadius: 10, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: 1, flexShrink: 0 };
function LeaveSheet({ hole, onStay, onLeave }) {
  return (
    <div onClick={onStay} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.line}`, padding: "18px 18px calc(env(safe-area-inset-bottom) + 18px)" }}>
        <div style={{ color: C.ink, fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Leave this round?</div>
        <div style={{ color: C.sub, fontSize: 13, marginBottom: 16 }}>You're on hole {hole + 1}. This round isn't finished, so it won't be saved to your record.</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onStay} style={{ flex: 1, height: 50, borderRadius: 14, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 15 }}>Keep playing</button>
          <button onClick={onLeave} style={{ flex: 1, height: 50, borderRadius: 14, background: C.red, color: "#fff", fontWeight: 800, fontSize: 15 }}>Leave round</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- hole geometry (v18.5) — OpenStreetMap via Overpass, cached per course; greens you mark by standing on them as the fallback ---------- */
const GEO_KEY = (apiId) => `bogeyman-matches:geo:v1:${apiId}`;
const MARK_KEY = "bogeyman-matches:greens:v1";
const apiIdOf = (course) => course?.apiId ?? (course?.id != null ? String(course.id).split(":")[0] : null);
/* Anchor coords: on the built course since v18.5; older in-progress rounds fall back to the cached full course. */
function courseAnchor(course) {
  if (!course) return null;
  if (typeof course.lat === "number" && typeof course.lon === "number") return { lat: course.lat, lon: course.lon };
  try {
    const full = JSON.parse(localStorage.getItem(courseCacheKey(apiIdOf(course))) || "null");
    const loc = full && full.location;
    if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") return { lat: loc.latitude, lon: loc.longitude };
  } catch (e) { /* ignore */ }
  return null;
}
function loadGeo(apiId) {
  try { const g = JSON.parse(localStorage.getItem(GEO_KEY(apiId)) || "null"); return g && g.holes ? g : null; } catch (e) { return null; }
}
function saveGeo(apiId, geo) {
  try { localStorage.setItem(GEO_KEY(apiId), JSON.stringify(geo)); } catch (e) { /* quota */ }
}
function loadMarks(course) {
  try { const all = JSON.parse(localStorage.getItem(MARK_KEY) || "{}"); const c = all[courseKey(course)]; return c && typeof c === "object" ? c : {}; } catch (e) { return {}; }
}
function saveMarks(course, marks) {
  try { const all = JSON.parse(localStorage.getItem(MARK_KEY) || "{}"); all[courseKey(course)] = marks; localStorage.setItem(MARK_KEY, JSON.stringify(all)); } catch (e) { /* quota */ }
}
/* Fetch once per course when it is selected (needs signal then, not on the course); cache-first afterwards. */
function useGeometry(course) {
  const apiId = apiIdOf(course);
  const anchor = courseAnchor(course);
  const [geo, setGeo] = useState(() => (apiId ? loadGeo(apiId) : null));
  const [status, setStatus] = useState(geo ? "ok" : "none");   // none | nocoords | loading | ok | error
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!apiId) { setGeo(null); setStatus("none"); return; }
    const cached = loadGeo(apiId);
    if (cached) { setGeo(cached); setStatus("ok"); return; }
    if (!anchor) { setGeo(null); setStatus("nocoords"); return; }
    let live = true;
    setStatus("loading");
    fetchGeometry(anchor.lat, anchor.lon)
      .then(g => { if (!live) return; const c = { ...compactGeometry(g), fetchedAt: Date.now() }; saveGeo(apiId, c); setGeo(c); setStatus("ok"); })
      .catch(() => { if (live) { setGeo(null); setStatus("error"); } });
    return () => { live = false; };
  }, [apiId, anchor && anchor.lat, anchor && anchor.lon, tick]);
  return { geo, status, retry: () => setTick(t => t + 1) };
}
/* Live position. High accuracy, 2 s max age (spec §4.2). `retry` re-subscribes after a denial. */
function useGeo(active) {
  const [fix, setFix] = useState(null);      // { lat, lon, acc, ts }
  const [err, setErr] = useState(null);      // null | no-geo | denied | unavailable
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) { setErr("no-geo"); return; }
    setErr(null);
    const id = navigator.geolocation.watchPosition(
      p => setFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: p.timestamp }),
      e => setErr(e && e.code === 1 ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [active, tick]);
  return { fix, err, retry: () => setTick(t => t + 1) };
}
const geoStatusText = (geo, status) => {
  if (status === "ok" && geo) { const n = Object.values(geo.holes).filter(h => h.green).length; return `Hole map · ${n}/18 greens from OpenStreetMap`; }
  if (status === "loading") return "Fetching hole map…";
  if (status === "nocoords") return "No hole map — this course has no coordinates";
  if (status === "error") return "Hole map failed — tap to retry";
  return null;
};

/* ---------- Caddie (v18 → v18.5) — club, aim and why, every note citing a number from src/profile.json ----------
   Its own screen, toggled from Play. The engine is src/caddie.js; nothing here touches the ghost
   beyond passing the hole's ghost score through as a status line (the engine never reads it).
   v18.5: GPS + hole geometry pick the phase and fill the distance; the chips are the fallback. */
const CADDIE_FLAGS_KEY = "bogeyman-matches:caddie-flags:v1";   // per-course, per-hole tight / water flags
const courseKey = (course) => `${course.id ?? course.name}|${course.tee ?? ""}`;
function loadHoleFlags(course) {
  try { const all = JSON.parse(localStorage.getItem(CADDIE_FLAGS_KEY) || "{}"); const c = all[courseKey(course)]; return c && typeof c === "object" ? c : {}; } catch (e) { return {}; }
}
function saveHoleFlags(course, flags) {
  try { const all = JSON.parse(localStorage.getItem(CADDIE_FLAGS_KEY) || "{}"); all[courseKey(course)] = flags; localStorage.setItem(CADDIE_FLAGS_KEY, JSON.stringify(all)); } catch (e) { /* quota */ }
}
const ZONE_COLOR = { green: C.green, amber: "#D4A94A", red: "#C9645E" };
const PHASES = [["tee", "TEE"], ["approach", "APPROACH"], ["short", "SHORT"], ["putt", "PUTT"]];
const PHASE_ORDER = PHASES.map(p => p[0]);
const HOLE_FLAGS = [["tight", "tight"], ["waterL", "water L"], ["waterR", "water R"]];
const ROUND_FLAGS = [["wet", "wet"], ["wind", "wind"]];
const clubName = (id) => (PROFILE.clubs.find(c => c.id === id) || { name: id }).name;
const MAP_H = Math.round(Math.min(340, Math.max(220, (typeof window !== "undefined" ? window.innerHeight : 800) * 0.36)));

function Chip({ on, onClick, children, tone = "ink", dim, small }) {
  const bg = on ? (tone === "green" ? C.green : tone === "slate" ? C.slate : C.ink) : C.card2;
  return (
    <button onClick={onClick} style={{ height: small ? 26 : 32, padding: small ? "0 9px" : "0 12px", borderRadius: 10, background: bg, color: on ? "#07140C" : (dim ? "#55595F" : C.sub), border: `1px solid ${on ? "transparent" : C.line}`, fontSize: small ? 11 : 12, fontWeight: 800, letterSpacing: 0.5, whiteSpace: "nowrap", flexShrink: 0, textDecoration: dim ? "line-through" : "none", ...tnum }}>{children}</button>
  );
}

function Caddie({ course, ghost, hole, setHole, scores, roundFlags, setRoundFlags, geo, geoStatus, onRetryGeo, onPlay, onExit }) {
  const h = course.holes[hole];
  const par = h.par, yards = typeof h.yards === "number" ? h.yards : null;
  const [manualPhase, setManualPhase] = useState(null);    // null = follow GPS
  const [distOverride, setDistOverride] = useState(null);  // null = follow GPS
  const [lie, setLie] = useState("fairway");
  const [alt, setAlt] = useState(null);                    // manually tapped alternative club
  const [holeFlagsAll, setHoleFlagsAll] = useState(() => loadHoleFlags(course));
  const [marks, setMarks] = useState(() => loadMarks(course));
  const [confirmExit, setConfirmExit] = useState(false);
  const { fix, err: gpsErr, retry: retryGps } = useGeo(true);

  /* the green for this hole: a green you marked wins, else OpenStreetMap */
  const osmHole = geo && geo.holes ? geo.holes[hole + 1] : null;
  const mark = marks[hole];
  const green = mark ? { center: mark, ring: null } : (osmHole && osmHole.green) || null;
  const live = fix && green ? greenDistances(fix, green) : null;
  const auto = live ? autoPhase(live.middle, yards, live.inside) : null;
  const phase = manualPhase || auto || "tee";
  // a new auto phase (you walked into the next band) drops any typed distance and alt club
  useEffect(() => { setDistOverride(null); setAlt(null); }, [auto]);

  const holeFlags = holeFlagsAll[hole] || {};
  const toggleHoleFlag = (k) => { const next = { ...holeFlagsAll, [hole]: { ...holeFlags, [k]: !holeFlags[k] } }; setHoleFlagsAll(next); saveHoleFlags(course, next); };
  const toggleRoundFlag = (k) => setRoundFlags(f => ({ ...f, [k]: !f[k] }));
  const pickPhase = (p) => { setManualPhase(p === auto ? null : p); setAlt(null); setDistOverride(null); };
  const cyclePhase = () => pickPhase(PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length]);
  const markGreen = () => { if (!fix) return; const next = { ...marks, [hole]: { lat: fix.lat, lon: fix.lon } }; setMarks(next); saveMarks(course, next); };
  const clearMark = () => { const next = { ...marks }; delete next[hole]; setMarks(next); saveMarks(course, next); };
  const filled = scores.filter(s => s != null).length;

  /* distance: typed wins, else GPS to the middle, else the scorecard yardage on the tee. Putts are typed (GPS can't read feet). */
  const gpsDist = live && phase !== "putt" ? String(Math.round(live.middle)) : null;
  const dist = distOverride != null ? distOverride : (gpsDist != null ? gpsDist : (phase === "tee" && yards != null ? String(yards) : ""));
  const flags = { ...holeFlags, ...roundFlags };
  const n = parseFloat(dist);
  const distance = Number.isFinite(n) && n > 0 ? n : null;
  const unit = phase === "putt" ? "ft" : "yds";
  const ghostScore = ghost.holes[hole];
  let advice = null;
  try {
    if (distance == null) advice = null;
    else if (phase === "tee") advice = advise({ phase: "tee", par, yards: distance, flags, forceClub: alt, ghost: ghostScore }, PROFILE);
    else if (phase === "approach") advice = advise({ phase: "approach", distance, lie, flags, forceClub: alt, ghost: ghostScore }, PROFILE);
    else if (phase === "short") advice = advise({ phase: "short", distance, ghost: ghostScore }, PROFILE);
    else advice = advise({ phase: "putt", distance, ghost: ghostScore }, PROFILE);
  } catch (e) { advice = null; }

  const grade = advice && advice.zoneGrade;
  const gradeColor = grade ? ZONE_COLOR[grade] : C.sub;
  const summary = advice && (
    phase === "tee" && advice.leave != null
      ? `leaves ~${advice.leave}${advice.plan === "layup" ? ` · ${advice.secondClub} to ~${advice.leave3}` : ""}${grade ? ` · ${grade.toUpperCase()} ZONE` : ""}${advice.target && advice.target !== "center" ? ` · aim ${advice.target}` : ""}`
      : phase === "approach" || phase === "tee"
        ? `${distance} · ${grade ? `${grade.toUpperCase()} ZONE` : "no zone"}${advice.target ? ` · ${advice.target}` : ""}`
        : null
  );
  const alts = (advice && advice.alternatives) || [];
  const selected = alt || (advice && advice.club);

  const flagChip = (k, label, on, fn) => <Chip key={k} on={on} onClick={() => { fn(k); setAlt(null); }} tone="green">{label}</Chip>;
  const holeMeta = `Par ${par}${yards != null ? ` · ${yards} yds` : ""}${h.si ? ` · SI ${h.si}` : ""}`;
  const gpsLabel = fix ? `GPS ±${Math.round(fix.acc)} m` : gpsErr === "denied" ? "Location off — tap to allow" : gpsErr === "no-geo" ? "No GPS on this device" : gpsErr ? "GPS lost — tap to retry" : "Finding GPS…";
  const greenSource = mark ? "green you marked" : (osmHole && osmHole.green ? (live && live.hasRing ? "OSM green" : "OSM green") : null);
  const mapLine = geoStatusText(geo, geoStatus);

  return (
    <div style={{ minHeight: "100dvh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12, padding: "calc(env(safe-area-inset-top) + 10px) 14px calc(env(safe-area-inset-bottom) + 14px)" }}>
      {/* header — mirrors Play: exit at left, toggle in the middle, hole at right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button onClick={() => (filled === 0 ? onExit() : setConfirmExit(true))} aria-label="Exit round" style={{ width: 34, height: 34, borderRadius: 10, background: C.card2, color: C.sub, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={18} /></button>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
            <div style={{ color: C.sub, fontSize: 11, ...tnum }}>{holeMeta}</div>
          </div>
        </div>
        <button onClick={onPlay} aria-label="Open ghost match" style={togglePill}><Ghost size={14} /> GHOST</button>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ ...lbl, fontSize: 10 }}>HOLE</div>
          <div style={{ fontFamily: NUM, fontWeight: 800, fontSize: 18, color: C.ink, ...tnum }}>{hole + 1}<span style={{ color: C.sub, fontSize: 12 }}>/18</span></div>
        </div>
      </div>
      {confirmExit && <LeaveSheet hole={hole} onStay={() => setConfirmExit(false)} onLeave={() => { setConfirmExit(false); onExit(); }} />}

      {/* the hole, hole-up: satellite, trouble, green outline, your landing ellipse for the shown club */}
      <HoleMap fix={fix} hole={osmHole} green={green} trouble={(geo && geo.trouble) || []} club={PROFILE.clubs.find(c => c.id === selected) || null} phase={phase} height={MAP_H} />

      {/* where you are — GPS picks the phase; tap the line to override, AUTO to hand it back */}
      {auto ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={cyclePhase} aria-label="Shot phase, tap to change" style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 12, background: manualPhase ? C.card2 : C.ink, color: manualPhase ? C.ink : "#07140C", border: `1px solid ${manualPhase ? C.line : "transparent"}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>{phase.toUpperCase()}</span>
            <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...tnum }}>
              {live.inside ? "on the green" : `${Math.round(live.middle)} to middle · F ${Math.round(live.front)} · B ${Math.round(live.back)}`}
            </span>
          </button>
          {manualPhase && <Chip on tone="slate" onClick={() => pickPhase(auto)}>AUTO</Chip>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
          {PHASES.map(([k, label]) => <Chip key={k} on={phase === k} onClick={() => pickPhase(k)}>{label}</Chip>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Chip small on={!!fix} tone="slate" onClick={retryGps}>{gpsLabel}</Chip>
        {green
          ? <Chip small on={false} onClick={mark ? clearMark : undefined}>{greenSource}{mark ? " · clear" : ""}</Chip>
          : <Chip small on={!!fix} tone="green" onClick={markGreen}>{fix ? "Stand on the green · tap to mark it" : "No green for this hole"}</Chip>}
        {!green && mapLine && <button onClick={onRetryGeo} style={{ color: C.sub, fontSize: 11, padding: "0 4px" }}>{mapLine}</button>}
      </div>

      {/* distance — GPS fills it, typing overrides it (a laser beats GPS) */}
      <div style={{ position: "relative" }}>
        <input type="number" inputMode="decimal" min="1" value={dist} onChange={(e) => { setDistOverride(e.target.value); setAlt(null); }} placeholder={phase === "putt" ? "feet" : "yards"} aria-label={`Distance in ${unit}`}
          style={{ width: "100%", background: C.card, color: distOverride != null ? C.ink : (gpsDist != null ? C.green : C.ink), border: `1px solid ${C.line}`, borderRadius: 16, fontFamily: NUM, fontSize: 46, fontWeight: 800, padding: "10px 64px 10px 18px", textAlign: "center", outline: "none", ...tnum }} />
        <div style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", color: C.sub, fontSize: 12, fontWeight: 800, letterSpacing: 1, textAlign: "right" }}>
          {unit.toUpperCase()}
          {distOverride != null && gpsDist != null && <div onClick={() => setDistOverride(null)} style={{ fontSize: 9, color: C.green, marginTop: 2 }}>GPS {gpsDist}</div>}
        </div>
      </div>

      {/* lie (approach only) */}
      {phase === "approach" && (
        <div style={{ display: "flex", gap: 6 }}>
          {[["fairway", "fairway"], ["rough", "rough"]].map(([k, label]) => <Chip key={k} on={lie === k} onClick={() => { setLie(k); setAlt(null); }}>{label}</Chip>)}
        </div>
      )}

      {/* flags — tight / water are per hole and remembered per course; wet / wind ride with the round */}
      {(phase === "tee" || phase === "approach") && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {HOLE_FLAGS.map(([k, label]) => flagChip(k, label, !!holeFlags[k], toggleHoleFlag))}
          <div style={{ width: 1, background: C.line, flexShrink: 0, margin: "4px 2px" }} />
          {ROUND_FLAGS.map(([k, label]) => flagChip(k, label, !!roundFlags[k], toggleRoundFlag))}
        </div>
      )}

      {/* the card */}
      <div style={{ background: C.card, borderRadius: 18, padding: "16px 18px", border: `1px solid ${C.line}`, borderLeft: `4px solid ${gradeColor}` }}>
        {!advice && <div style={{ color: C.sub, fontSize: 14, lineHeight: 1.4 }}>{phase === "putt" ? `Type the first-putt distance in feet.${live ? ` GPS puts the middle of the green at ~${Math.round(live.middle * 3)} ft, but GPS cannot read feet.` : ""}` : "Type the distance in yards."}</div>}
        {advice && (
          <>
            {advice.club && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontFamily: NUM, fontSize: 34, fontWeight: 800, letterSpacing: 0.5, lineHeight: 1.1 }}>{clubName(advice.club).toUpperCase()}</div>
                {advice.swing && <div style={{ color: C.sub, fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>{advice.swing}</div>}
              </div>
            )}
            {summary && <div style={{ color: gradeColor, fontSize: 13, fontWeight: 800, letterSpacing: 0.3, marginTop: 6, ...tnum }}>{summary}</div>}
            {advice.why.map((w, i) => <div key={i} style={{ color: C.ink, fontSize: 14, lineHeight: 1.45, marginTop: i === 0 ? 12 : 8 }}>{w}</div>)}
            {advice.ghostLine && <div style={{ color: C.slate, fontSize: 12, marginTop: 14, ...tnum }}>{advice.ghostLine}</div>}
          </>
        )}
      </div>

      {/* alternatives — tap a club to see why it lost */}
      {alts.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {alts.map(a => (
            <Chip key={a.club} on={selected === a.club} dim={!!a.teeBanReason} onClick={() => setAlt(a.club === advice.club && !alt ? null : (a.club === alt ? null : a.club))}>
              {a.club} {a.leave != null ? a.leave : a.median}
            </Chip>
          ))}
        </div>
      )}

      {/* hole nav */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <button onClick={() => setHole(x => Math.max(0, x - 1))} disabled={hole === 0} aria-label="Previous hole" style={{ width: 50, height: 50, borderRadius: 14, background: C.card2, color: hole === 0 ? C.line : C.ink, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={22} /></button>
        <button onClick={onPlay} style={{ flex: 1, height: 50, borderRadius: 14, background: C.card, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Ghost size={16} /> Score this hole</button>
        <button onClick={() => setHole(x => Math.min(17, x + 1))} disabled={hole === 17} aria-label="Next hole" style={{ width: 50, height: 50, borderRadius: 14, background: C.card2, color: hole === 17 ? C.line : C.ink, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={22} /></button>
      </div>
    </div>
  );
}

/* ---------- scorecard (Shot-Pattern visual language) ---------- */
const cellBase = { display: "flex", alignItems: "center", justifyContent: "center", height: 26, fontFamily: NUM, ...tnum };
const segWash = (res) => res === "win" ? C.greenDim : res === "loss" ? C.slateDim : "transparent";

// par-relative notation: circle=birdie, double circle=eagle+, square=bogey, double square=double+
function ScoreMark({ score, par }) {
  if (score == null) return <span style={{ color: C.sub, fontSize: 12 }}>·</span>;
  const d = score - par;
  const shape = d <= -2 ? 2 : d === -1 ? 1 : d === 0 ? 0 : d === 1 ? -1 : -2;
  const ring = Math.abs(shape) >= 1, dbl = Math.abs(shape) >= 2;
  const ringCol = shape > 0 ? C.green : C.sub;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 18, height: 18, padding: "0 2px", fontFamily: NUM, fontWeight: 800, fontSize: 11, ...tnum,
      color: shape > 0 ? C.green : C.ink,
      borderRadius: shape > 0 ? "50%" : "3px",
      border: ring ? `1.5px solid ${ringCol}` : "none",
      outline: dbl ? `1.5px solid ${ringCol}` : "none",
      outlineOffset: dbl ? "1.5px" : 0,
    }}>{score}</span>
  );
}

function ScoreCard({ course, ghost, scores, m, onTapHole }) {
  const hasYardage = course.holes.some(h => typeof h.yards === "number");
  const cols = "26px repeat(9,1fr) 26px 30px";
  const renderNine = (start) => {
    const isIn = start === 9;
    const idx = [...Array(9)].map((_, k) => start + k);
    const parSum = idx.reduce((a, i) => a + course.holes[i].par, 0);
    const youSum = idx.reduce((a, i) => a + (scores[i] ?? 0), 0);
    const ghSum = idx.reduce((a, i) => a + ghost.holes[i], 0);
    return (
      <div style={{ display: "grid", gridTemplateColumns: cols, columnGap: 1, rowGap: 2, marginBottom: isIn ? 0 : 10 }}>
        {/* hole numbers */}
        <div style={{ ...cellBase, height: 18 }} />
        {idx.map(i => <div key={"h" + i} style={{ ...cellBase, fontSize: 10, fontWeight: 800, color: C.sub, height: 18 }}>{i + 1}</div>)}
        <div style={{ ...cellBase, fontSize: 9, fontWeight: 800, color: C.sub, height: 18 }}>{isIn ? "IN" : "OUT"}</div>
        <div style={{ ...cellBase, fontSize: 9, fontWeight: 800, color: C.sub, height: 18 }}>{isIn ? "TOT" : ""}</div>
        {/* yardage (rendered only when course data carries it) */}
        {hasYardage && (
          <React.Fragment>
            <div style={{ ...cellBase, justifyContent: "flex-start", fontSize: 9, fontWeight: 800, color: C.sub, height: 16 }}>YDS</div>
            {idx.map(i => <div key={"y" + i} style={{ ...cellBase, fontSize: 9, color: C.sub, height: 16 }}>{course.holes[i].yards ?? "·"}</div>)}
            <div style={{ ...cellBase, fontSize: 9, color: C.sub, height: 16 }}>{idx.reduce((a, i) => a + (course.holes[i].yards ?? 0), 0) || ""}</div>
            <div style={{ ...cellBase, fontSize: 9, color: C.sub, height: 16 }}>{isIn ? (course.holes.reduce((a, h) => a + (h.yards ?? 0), 0) || "") : ""}</div>
          </React.Fragment>
        )}
        {/* par */}
        <div style={{ ...cellBase, justifyContent: "flex-start", fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.sub }}>PAR</div>
        {idx.map(i => <div key={"p" + i} style={{ ...cellBase, fontSize: 10, color: C.sub }}>{course.holes[i].par}</div>)}
        <div style={{ ...cellBase, fontSize: 10, fontWeight: 700, color: C.sub }}>{parSum}</div>
        <div style={{ ...cellBase, fontSize: 10, fontWeight: 700, color: C.sub }}>{isIn ? course.par : ""}</div>
        {/* you — tappable, segment-shaded */}
        <div style={{ ...cellBase, justifyContent: "flex-start", fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.green }}>YOU</div>
        {idx.map(i => (
          <button key={"u" + i} onClick={() => onTapHole(i)} style={{ ...cellBase, background: segWash(m.segs[Math.floor(i / 3)].res), borderRadius: 4, padding: 0 }}>
            <ScoreMark score={scores[i]} par={course.holes[i].par} />
          </button>
        ))}
        <div style={{ ...cellBase, fontSize: 12, fontWeight: 800, color: C.green }}>{youSum}</div>
        <div style={{ ...cellBase, fontSize: 12, fontWeight: 800, color: C.green }}>{isIn ? scores.reduce((a, s) => a + (s ?? 0), 0) : ""}</div>
        {/* ghost — projected line, plain numbers in dispersion accent */}
        <div style={{ ...cellBase, justifyContent: "flex-start", fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.slate }}>GHOST</div>
        {idx.map(i => <div key={"g" + i} style={{ ...cellBase, background: segWash(m.segs[Math.floor(i / 3)].res), borderRadius: 4, color: C.slate, fontSize: 11, fontWeight: 700 }}>{ghost.holes[i]}</div>)}
        <div style={{ ...cellBase, fontSize: 12, fontWeight: 800, color: C.slate }}>{ghSum}</div>
        <div style={{ ...cellBase, fontSize: 12, fontWeight: 800, color: C.slate }}>{isIn ? ghost.gross : ""}</div>
      </div>
    );
  };
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: "12px 10px", marginTop: 12 }}>
      {renderNine(0)}
      {renderNine(9)}
    </div>
  );
}

/* ---------- summary ---------- */
function Summary({ course, ghost, scores, history, onEditScore, onReset }) {
  const m = evalMatch(scores, ghost.holes);
  const won = m.you > m.opp, tie = m.you === m.opp;
  const stats = deriveStats(history);
  const yourTotal = m.total.yourTot;
  const toPar = yourTotal - course.par;
  const tp = toPar === 0 ? "E" : toPar > 0 ? `+${toPar}` : `${toPar}`;
  const yourOut = scores.slice(0, 9).reduce((a, s) => a + (s ?? 0), 0);
  const yourIn = scores.slice(9).reduce((a, s) => a + (s ?? 0), 0);
  const segSub = (s) => `${s.yourSum}–${s.ghostSum}`;
  const segLab = (s) => s.res === "win" ? "WON" : s.res === "loss" ? "LOST" : "HALF";
  const [editHole, setEditHole] = useState(null);
  const [editVal, setEditVal] = useState(0);
  const openEdit = (i) => { setEditVal(scores[i] ?? course.holes[i].par); setEditHole(i); };
  const saveEdit = () => { onEditScore(editHole, editVal); setEditHole(null); };
  return (
    <div style={{ maxWidth: 460, margin: "0 auto", padding: "calc(env(safe-area-inset-top) + 18px) 18px 40px" }}>
      <div style={{ color: C.sub, letterSpacing: 2.5, fontSize: 11, fontWeight: 800, textAlign: "center" }}>FINAL · {course.name}</div>
      <h1 style={{ textAlign: "center", margin: "4px 0 18px", fontSize: 28, fontWeight: 800, letterSpacing: -0.3, color: won ? C.green : tie ? C.ink : C.red }}>
        {won ? "You beat the ghost" : tie ? "Dead heat" : "Ghost takes it"}
      </h1>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, marginBottom: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: C.green, fontSize: 12, fontWeight: 800 }}>YOU</div>
          <div style={{ fontFamily: NUM, fontSize: 48, fontWeight: 800, color: C.green, lineHeight: 1, ...tnum }}>{fmtPts(m.you)}</div>
          <div style={{ color: C.sub, fontSize: 12, ...tnum }}>gross {m.total.yourTot}</div>
        </div>
        <div style={{ color: C.line, fontSize: 26 }}>·</div>
        <div style={{ textAlign: "center" }}>
          <GhostRing value={fmtPts(m.opp)} size={56} />
          <div style={{ color: C.sub, fontSize: 12, marginTop: 2, ...tnum }}>gross {ghost.gross}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 5, marginBottom: 5 }}>
        {m.segs.map((s, i) => <SegCell key={i} res={s.res} label={segLab(s)} sub={segSub(s)} margin={s.liveMargin} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
        <StatPill label="FRONT 9" res={m.front.res} sub={`${m.front.yourSum}–${m.front.ghostSum}`} />
        <StatPill label="BACK 9" res={m.back.res} sub={`${m.back.yourSum}–${m.back.ghostSum}`} />
        <StatPill label="TOTAL" res={m.total.res} sub={`${m.total.yourTot}–${m.total.ghostTot}`} />
      </div>

      {/* scorecard header + grid */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 22 }}>
        <div>
          <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{course.name}</div>
          <div style={{ color: C.sub, fontSize: 11, ...tnum }}>{course.tee} · {course.rating}/{course.slope}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.green, fontWeight: 800, fontSize: 16, ...tnum }}>{tp}</div>
          <div style={{ color: C.sub, fontSize: 11, ...tnum }}>{yourOut} · {yourIn} | {yourTotal}</div>
        </div>
      </div>
      <ScoreCard course={course} ghost={ghost} scores={scores} m={m} onTapHole={openEdit} />
      <div style={{ textAlign: "center", color: C.sub, fontSize: 11, marginTop: 8 }}>Tap any hole in your row to edit</div>

      {/* record vs the Ghost (updates live as you edit) */}
      <div style={{ marginTop: 22 }}>
        <div style={{ ...lbl, marginBottom: 8 }}>VS THE GHOST</div>
        <div style={{ display: "flex", gap: 8 }}>
          <MiniStat label="RECORD" value={stats.recordText} />
          <MiniStat label="STREAK" value={stats.streakText} accent={streakAccent(stats)} />
          <MiniStat label="AVG MARGIN" value={stats.marginStr} accent={marginAccent(stats)} />
        </div>
      </div>

      <button onClick={onReset} style={{ width: "100%", marginTop: 22, padding: "15px 0", background: C.card, color: C.ink, borderRadius: 16, border: `1px solid ${C.line}`, fontSize: 15, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><RotateCcw size={18} /> New round</button>

      {/* inline hole editor */}
      {editHole != null && (
        <div onClick={() => setEditHole(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.card, borderRadius: "20px 20px 0 0", border: `1px solid ${C.line}`, padding: "18px 18px calc(env(safe-area-inset-bottom) + 18px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ color: C.ink, fontWeight: 800, fontSize: 16 }}>Hole {editHole + 1}</div>
                <div style={{ color: C.sub, fontSize: 12, ...tnum }}>Par {course.holes[editHole].par} · stroke index {course.holes[editHole].si}</div>
              </div>
              <GhostRing value={ghost.holes[editHole]} size={44} label="GHOST" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <button onClick={() => setEditVal(v => Math.max(1, v - 1))} style={stepBtn}><Minus size={24} /></button>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontFamily: NUM, fontSize: 52, fontWeight: 800, color: C.green, lineHeight: 1, ...tnum }}>{editVal}</div>
                <div style={{ color: editVal - course.holes[editHole].par <= 0 ? C.green : C.sub, fontSize: 12, fontWeight: 700, marginTop: 3 }}>{scoreName(editVal, course.holes[editHole].par)}</div>
              </div>
              <button onClick={() => setEditVal(v => v + 1)} style={stepBtn}><Plus size={24} /></button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEditHole(null)} style={{ flex: 1, height: 50, borderRadius: 14, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 15 }}>Cancel</button>
              <button onClick={saveEdit} style={{ flex: 1, height: 50, borderRadius: 14, background: C.green, color: "#07140C", fontWeight: 800, fontSize: 15 }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- cloud sync (Firebase Auth + Firestore) ----------
   Local-first by design: localStorage stays the read path, so the app opens
   instantly and a round can be played and finalized with no signal at all. When
   signed in, each round mirrors to users/{uid}/rounds/{id}; Firestore's own
   offline cache queues writes made in a dead zone and flushes them on reconnect.
   Merge is by id with last-write-wins on updatedAt. Deletes are tombstones, so
   deleting on one device doesn't get undone by a stale copy on another. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDkKB_5MjvKRDQYdi6VPpARkkM5Gkx1jvE",
  authDomain: "ghost-match-cd04d.firebaseapp.com",
  projectId: "ghost-match-cd04d",
  storageBucket: "ghost-match-cd04d.firebasestorage.app",
  messagingSenderId: "46156778167",
  appId: "1:46156778167:web:e54c74a6d907c14f2b5b32",
};
const TOMB_KEY = "bogeyman-matches:tombstones:v1";

let fb = null;
/* Lazy so a Firebase failure can never stop the golf app from loading. */
function initCloud() {
  if (fb !== null) return fb || null;
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
    });
    fb = { app, auth, db };
  } catch (e) { fb = false; }
  return fb || null;
}
/* An installed iOS PWA has no reliable popup window; redirect is the supported
   path there. Popup elsewhere keeps you in the page. */
const isStandalone = () =>
  (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
  window.navigator.standalone === true;

async function cloudSignIn() {
  const c = initCloud();
  if (!c) throw new Error("cloud unavailable");
  const provider = new GoogleAuthProvider();
  if (isStandalone()) return signInWithRedirect(c.auth, provider);
  try { return await signInWithPopup(c.auth, provider); }
  catch (e) {
    const code = (e && e.code) || "";
    if (/popup-blocked|popup-closed|operation-not-supported|cancelled-popup/.test(code)) {
      return signInWithRedirect(c.auth, provider);
    }
    throw e;
  }
}
const cloudSignOut = () => { const c = initCloud(); if (c) fbSignOut(c.auth).catch(() => {}); };

const stampOf = (r) => (r && typeof r.updatedAt === "number" ? r.updatedAt : Date.parse(r && r.date) || 0);
const roundDoc = (c, uid, id) => doc(c.db, "users", uid, "rounds", id);
async function cloudFetchAll(c, uid) {
  const snap = await getDocs(collection(c.db, "users", uid, "rounds"));
  const out = []; snap.forEach(d => out.push(d.data())); return out;
}
const cloudPut = (c, uid, rec) => setDoc(roundDoc(c, uid, rec.id), rec);

/* Union local + cloud by id, newest updatedAt wins, tombstones drop out of the
   active list but survive as markers. toPush is what the cloud is missing or
   holds an older copy of. */
function mergeRounds(local, localTombs, cloudDocs) {
  const byId = new Map();
  const put = (r, from) => {
    const hit = byId.get(r.id);
    if (!hit || stampOf(r) >= stampOf(hit.r)) byId.set(r.id, { r, from });
  };
  (cloudDocs || []).forEach(r => { if (r && r.id) put(r, "cloud"); });
  (local || []).forEach(r => { if (r && r.id) put(r, "local"); });
  (localTombs || []).forEach(t => { if (t && t.id) put({ id: t.id, deleted: true, updatedAt: t.updatedAt }, "local"); });
  const all = [...byId.values()];
  return {
    merged: all.filter(x => !x.r.deleted).map(x => x.r).sort((a, b) => new Date(a.date) - new Date(b.date)),
    tombs: all.filter(x => x.r.deleted).map(x => ({ id: x.r.id, updatedAt: stampOf(x.r) })),
    toPush: all.filter(x => x.from === "local").map(x => x.r),
  };
}

/* off | signed-out | syncing | synced | error */
function useCloudSync(history, setHistory, tombs, setTombs) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("off");
  const pushed = React.useRef(new Map());   // id -> updatedAt already accepted by the server
  const ready = React.useRef(false);
  const stateRef = React.useRef({ history, tombs });
  stateRef.current = { history, tombs };

  useEffect(() => {
    const c = initCloud();
    if (!c) { setStatus("error"); return; }
    getRedirectResult(c.auth).catch(() => {});   // completes an iOS redirect sign-in
    return onAuthStateChanged(c.auth, (u) => {
      setUser(u || null);
      if (!u) { ready.current = false; pushed.current = new Map(); setStatus("signed-out"); }
    });
  }, []);

  // One reconcile per sign-in: pull everything, merge, push what's only local.
  useEffect(() => {
    if (!user) return;
    const c = initCloud(); if (!c) return;
    let alive = true;
    setStatus("syncing");
    (async () => {
      try {
        const cloud = await cloudFetchAll(c, user.uid);
        if (!alive) return;
        const { history: h, tombs: t } = stateRef.current;
        const m = mergeRounds(h, t, cloud);
        cloud.forEach(r => pushed.current.set(r.id, stampOf(r)));
        setHistory(m.merged); setTombs(m.tombs);
        for (const r of m.toPush) { await cloudPut(c, user.uid, r); pushed.current.set(r.id, stampOf(r)); }
        if (!alive) return;
        ready.current = true; setStatus("synced");
      } catch (e) { if (alive) { ready.current = true; setStatus("error"); } }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Mirror later changes (a finalized round, an inline edit, a delete).
  useEffect(() => {
    if (!user || !ready.current) return;
    const c = initCloud(); if (!c) return;
    const pending = [];
    history.forEach(r => { if (r && r.id && pushed.current.get(r.id) !== stampOf(r)) pending.push(r); });
    tombs.forEach(t => {
      if (t && t.id && pushed.current.get(t.id) !== t.updatedAt) pending.push({ id: t.id, deleted: true, updatedAt: t.updatedAt });
    });
    if (!pending.length) return;
    let alive = true;
    setStatus("syncing");
    Promise.all(pending.map(r => cloudPut(c, user.uid, r).then(() => pushed.current.set(r.id, stampOf(r)))))
      .then(() => { if (alive) setStatus("synced"); })
      .catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [history, tombs, user]);

  return { user, status };
}

/* ---------- backup: export / import rounds as JSON ----------
   History lives only in localStorage, and since v14 the differential is derived from it,
   so a cache wipe would reset the ghost's calibration too. Until durable cloud stats
   land, this turns total loss into "lost since my last export". Seeds aren't included —
   they ship in the bundle and survive a wipe on their own. */
const BACKUP_TAG = "loop-golf";
function backupPayload(history) {
  return JSON.stringify({ app: BACKUP_TAG, schema: 1, exportedAt: nowISO(), rounds: history }, null, 2);
}
const backupName = () => `loop-golf-rounds-${new Date().toISOString().slice(0, 10)}.json`;
/* On an installed iPhone PWA the share sheet ("Save to Files") is the reliable way out;
   <a download> is the desktop/browser fallback. */
async function exportRounds(history) {
  const text = backupPayload(history), name = backupName();
  try {
    const file = new File([text], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Loop Golf rounds" });
      return "Saved";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return null;   // user dismissed the share sheet
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "Downloaded";
  } catch (e) { return "Export failed"; }
}
/* Accepts a wrapped backup or a bare array; keeps only records the app can actually read
   (same shape loadHistory enforces). Returns null when the file isn't a backup at all. */
function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return null; }
  const rounds = Array.isArray(data) ? data : (data && Array.isArray(data.rounds) ? data.rounds : null);
  if (!rounds) return null;
  return rounds.filter(r => r && typeof r === "object" && typeof r.id === "string" &&
    Array.isArray(r.holeScores) && Array.isArray(r.ghostHoleScores));
}

/* ---------- history + delete ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const resColor = (r) => r === "W" ? C.green : r === "L" ? C.red : C.slate;

function History({ history, stats, cloud, onDelete, onImport, onBack }) {
  const [confirmId, setConfirmId] = useState(null);
  const [msg, setMsg] = useState("");
  const fileRef = React.useRef(null);
  const rounds = [...history].reverse(); // most recent first
  const doExport = async () => {
    if (!history.length) { setMsg("Nothing to export yet."); return; }
    const r = await exportRounds(history);
    if (r) setMsg(`${r} ${history.length} round${history.length === 1 ? "" : "s"}.`);
  };
  /* cloud status, rendered from the hook's state */
  const cu = (cloud && cloud.user) || null;
  const cstatus = (cloud && cloud.status) || "off";
  const signedIn = !!cu;
  const [busy, setBusy] = useState(false);
  const doSignIn = async () => {
    setBusy(true); setMsg("");
    try { await cloudSignIn(); }
    catch (e) { setMsg("Couldn't sign in — " + ((e && e.code) || "try again")); }
    finally { setBusy(false); }
  };
  const syncDot =
    cstatus === "synced" ? C.green :
    cstatus === "syncing" ? C.slate :
    cstatus === "error" ? C.red : C.line;
  const syncTitle =
    !signedIn ? "Not backed up" :
    cstatus === "synced" ? "Backed up" :
    cstatus === "syncing" ? "Syncing…" :
    cstatus === "error" ? "Sync problem" : "Connecting…";
  const syncNote =
    !signedIn ? "Sign in once. Rounds then save themselves — and survive a wipe." :
    cstatus === "error" ? "Saved on this phone. Will retry when you're back online." :
    cstatus === "syncing" ? `${history.length} round${history.length === 1 ? "" : "s"} · ${cu.email || "signed in"}` :
    `${history.length} round${history.length === 1 ? "" : "s"} · ${cu.email || "signed in"}`;

  const doImport = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";                       // let the same file be picked again
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const rounds = parseBackup(String(fr.result));
      if (!rounds) { setMsg("That doesn't look like a Loop Golf backup."); return; }
      if (!rounds.length) { setMsg("No usable rounds in that file."); return; }
      const { added, skipped } = onImport(rounds);
      setMsg(added ? `Added ${added} round${added === 1 ? "" : "s"}${skipped ? `, ${skipped} already here` : ""}.`
                   : "Already up to date — nothing new to add.");
    };
    fr.onerror = () => setMsg("Couldn't read that file.");
    fr.readAsText(f);
  };
  return (
    <div style={{ maxWidth: 460, margin: "0 auto", padding: "calc(env(safe-area-inset-top) + 14px) 18px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ width: 44, height: 44, borderRadius: 13, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ChevronLeft size={22} /></button>
        <div>
          <h1 style={{ color: C.ink, fontSize: 24, fontWeight: 800, letterSpacing: -0.3, margin: 0 }}>Round history</h1>
          <div style={{ color: C.sub, fontSize: 12, ...tnum }}>{stats.recordText} · {stats.streakText} · {stats.marginStr}</div>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div style={{ textAlign: "center", color: C.sub, fontSize: 14, padding: "48px 0" }}>No rounds logged yet.</div>
      ) : rounds.map(r => {
        const confirming = confirmId === r.id;
        const margin = r.yourPoints - r.ghostPoints;
        const rd = recordDifferential(r); // this round's differential — feeds the last-5
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: C.card2, color: resColor(r.result), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{r.result}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.course}<span style={{ color: C.sub, fontWeight: 600 }}> · {r.tee}</span></div>
              <div style={{ color: C.sub, fontSize: 11, ...tnum }}>{fmtDate(r.date)} · {fmtPts(r.yourPoints)}–{fmtPts(r.ghostPoints)} · {margin >= 0 ? "+" : ""}{margin.toFixed(1)}{rd != null ? ` · diff ${rd.toFixed(1)}` : ""}</div>
            </div>
            {confirming ? (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => setConfirmId(null)} style={{ height: 34, padding: "0 12px", borderRadius: 9, background: C.card2, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 12 }}>Cancel</button>
                <button onClick={() => { onDelete(r.id); setConfirmId(null); }} style={{ height: 34, padding: "0 12px", borderRadius: 9, background: C.red, color: "#fff", fontWeight: 800, fontSize: 12 }}>Delete</button>
              </div>
            ) : (
              <button onClick={() => setConfirmId(r.id)} style={{ width: 34, height: 34, borderRadius: 9, background: C.card2, color: C.sub, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Trash size={16} /></button>
            )}
          </div>
        );
      })}

      {/* cloud sync — the durable copy; export/import below is the manual fallback */}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.line}` }}>
        <div style={{ ...lbl, marginBottom: 8 }}>CLOUD BACKUP</div>
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: syncDot, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: 13 }}>{syncTitle}</div>
              <div style={{ color: C.sub, fontSize: 11, marginTop: 2, lineHeight: 1.4, overflowWrap: "anywhere" }}>{syncNote}</div>
            </div>
            {signedIn ? (
              <button onClick={cloudSignOut} style={{ color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, background: "none", flexShrink: 0 }}>SIGN OUT</button>
            ) : (
              <button onClick={doSignIn} disabled={busy} style={{ height: 34, padding: "0 14px", borderRadius: 9, background: C.green, color: "#07140C", fontWeight: 800, fontSize: 12, flexShrink: 0, opacity: busy ? 0.6 : 1 }}>
                {busy ? "…" : "Turn on"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ ...lbl, marginBottom: 8 }}>MANUAL BACKUP</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={doExport} style={{ flex: 1, height: 46, borderRadius: 13, background: C.card, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 14 }}>Export rounds</button>
          <button onClick={() => fileRef.current && fileRef.current.click()} style={{ flex: 1, height: 46, borderRadius: 13, background: C.card, color: C.ink, border: `1px solid ${C.line}`, fontWeight: 800, fontSize: 14 }}>Import</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: "none" }} />
        <div style={{ color: msg ? C.ink : C.sub, fontSize: 11, marginTop: 8, lineHeight: 1.45 }}>
          {msg || "A file copy you control. Export saves to Files/iCloud; import merges a backup back in without touching rounds you already have."}
        </div>
      </div>
    </div>
  );
}

/* ---------- localStorage persistence ---------- */
const LS_KEY = "bogeyman-matches:v1";
const HIST_KEY = "bogeyman-matches:history:v1";
const DEFAULT_CADDIE = { wet: false, wind: false };   // round-level caddie flags (v18)
const DEFAULT_STATE = { screen: "setup", course: null, diff: 7.9, scores: Array(18).fill(null), hole: 0, roundId: null, caddie: DEFAULT_CADDIE };
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_STATE;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return DEFAULT_STATE;
    const course = validCourse(s.course) ? s.course : null;
    const scoresOk = Array.isArray(s.scores) && s.scores.length === 18;
    const scores = scoresOk ? s.scores.map(v => (typeof v === "number" && v > 0 ? v : null)) : Array(18).fill(null);
    const played = scores.filter(v => v != null).length;
    // Resume ONLY a genuinely in-progress round: the play or caddie screen with at least
    // one hole scored. An empty just-started round or a finished summary opens the menu.
    const wantResume = (s.screen === "play" || s.screen === "caddie") && course && scoresOk && played >= 1;
    return {
      screen: wantResume ? s.screen : "setup",
      course,
      diff: typeof s.diff === "number" ? s.diff : 7.9,
      scores,
      hole: Number.isInteger(s.hole) && s.hole >= 0 && s.hole < 18 ? s.hole : 0,
      roundId: typeof s.roundId === "string" ? s.roundId : null,
      caddie: s.caddie && typeof s.caddie === "object" ? { wet: !!s.caddie.wet, wind: !!s.caddie.wind } : DEFAULT_CADDIE,
    };
  } catch (e) {
    return DEFAULT_STATE;
  }
}
function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { /* quota / private mode */ }
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter(r => r && typeof r === "object" && Array.isArray(r.holeScores) && Array.isArray(r.ghostHoleScores)) : [];
  } catch (e) { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) { /* quota / private mode */ }
}
/* Deleted rounds leave a marker so the delete replicates instead of being undone
   by a stale copy still sitting in the cloud. */
function loadTombs() {
  try {
    const a = JSON.parse(localStorage.getItem(TOMB_KEY) || "[]");
    return Array.isArray(a) ? a.filter(t => t && typeof t.id === "string") : [];
  } catch (e) { return []; }
}
function saveTombs(t) {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch (e) { /* quota */ }
}

/* ---------- app ---------- */
function App() {
  const initial = loadState();
  const [screen, setScreen] = useState(initial.screen);
  const [course, setCourse] = useState(initial.course);
  const [diff, setDiff] = useState(initial.diff);
  const [scores, setScores] = useState(initial.scores);
  const [hole, setHole] = useState(initial.hole);
  const [roundId, setRoundId] = useState(initial.roundId);
  const [caddieFlags, setCaddieFlags] = useState(initial.caddie);
  const [history, setHistory] = useState(loadHistory());
  const [tombs, setTombs] = useState(loadTombs());
  const cloud = useCloudSync(history, setHistory, tombs, setTombs);
  const geometry = useGeometry(course);   // v18.5: hole map, fetched when a course is picked, cached per course
  useEffect(() => { saveState({ screen, course, diff, scores, hole, roundId, caddie: caddieFlags }); }, [screen, course, diff, scores, hole, roundId, caddieFlags]);
  useEffect(() => { saveHistory(history); }, [history]);
  useEffect(() => { saveTombs(tombs); }, [tombs]);
  const ghost = useMemo(() => course ? computeGhost(course, diff) : null, [course, diff]);
  const stats = useMemo(() => deriveStats(history), [history]);
  // A round opens on the Caddie: you are on the tee wanting a club before you need a scorecard (Brett, Sep 19).
  const start = () => { if (!course) return; setScores(Array(18).fill(null)); setHole(0); setRoundId(null); setCaddieFlags(DEFAULT_CADDIE); setScreen("caddie"); };
  // Exit an unfinished round without saving it: clear scores and return to the menu.
  const exitRound = () => { setScores(Array(18).fill(null)); setHole(0); setRoundId(null); setScreen("setup"); };
  // Finalize: persist the finished round, then a soft (editable) transition to summary.
  const finalize = (finalScores) => {
    const rec = buildRecord({ id: newId(), date: nowISO() }, course, diff, finalScores, ghost);
    setHistory(h => [...h, rec]);
    setRoundId(rec.id);
    setScreen("summary");
  };
  // Edit a hole from the summary: recompute in place; if finalized, update the stored round.
  const editScore = (i, v) => {
    const ns = scores.map((s, k) => k === i ? Math.max(1, v) : s);
    setScores(ns);
    if (roundId) setHistory(h => h.map(r => r.id === roundId ? buildRecord({ id: r.id, date: r.date }, course, diff, ns, ghost) : r));
  };
  const reset = () => { setRoundId(null); setScreen("setup"); };
  // Delete a stored round so test rounds never pollute the record.
  const deleteRound = (id) => {
    setHistory(h => h.filter(r => r.id !== id));
    setTombs(t => [...t.filter(x => x.id !== id), { id, updatedAt: Date.now() }]);
    if (id === roundId) setRoundId(null);
  };
  // Restore a backup: merge by id so an old export can never delete newer rounds, and
  // keep history in date order (deriveStats reads the streak off the end).
  const importRounds = (incoming) => {
    const seen = new Set(history.map(r => r.id));
    const add = incoming.filter(r => !seen.has(r.id));
    if (add.length) setHistory(h => [...h, ...add].sort((a, b) => new Date(a.date) - new Date(b.date)));
    return { added: add.length, skipped: incoming.length - add.length };
  };
  return (
    <div style={{ minHeight: "100dvh", background: T.paper, color: T.ink, fontFamily: F.label }}>
      <style dangerouslySetInnerHTML={{ __html: RESET }} />
      <PencilDefs />
      {screen === "setup" && <Setup course={course} setCourse={setCourse} diff={diff} setDiff={setDiff} stats={stats} history={history} onStart={start} onHistory={() => setScreen("history")} geometry={geometry} />}
      {screen === "play" && course && ghost && <Play course={course} ghost={ghost} scores={scores} setScores={setScores} hole={hole} setHole={setHole} onFinish={finalize} onExit={exitRound} onCaddie={() => setScreen("caddie")} />}
      {screen === "caddie" && course && ghost && <Caddie key={hole} course={course} ghost={ghost} hole={hole} setHole={setHole} scores={scores} roundFlags={caddieFlags} setRoundFlags={setCaddieFlags} geo={geometry.geo} geoStatus={geometry.status} onRetryGeo={geometry.retry} onPlay={() => setScreen("play")} onExit={exitRound} />}
      {screen === "summary" && course && ghost && <DarkShell><Summary course={course} ghost={ghost} scores={scores} history={history} onEditScore={editScore} onReset={reset} /></DarkShell>}
      {screen === "history" && <DarkShell><History history={history} stats={stats} cloud={cloud} onDelete={deleteRound} onImport={importRounds} onBack={() => setScreen("setup")} /></DarkShell>}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
