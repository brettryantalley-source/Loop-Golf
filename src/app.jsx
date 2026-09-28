import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, doc, setDoc, getDocs } from "firebase/firestore";
import { T, F, caps, printed, written, writtenWord, rule, hairline, doubleRule, PencilDefs, Logo, teeTint } from "./theme.jsx";
/* Caddie (S3a, v22): the map layer. The profile is bundled, never fetched (addendum §11.1). */
import { fetchGeometry } from "./geometry.js";
import { buildHole, distances, loadGeometryCache, saveGeometryCache } from "./caddie/geo.js";
import { loadProfile } from "./caddie/profile.js";
import { noticeNoCourseMap } from "./caddie/overlay.js";
import { MapLayer, useSatellite, prefetchTiles, TILE_PREFETCH_ENABLED } from "./caddie/mapLayer.jsx";
import PROFILE_JSON from "./profile.json";

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
const BUILD = "v22 · Sep 28";

/* Every colour and type role now lives in src/theme.jsx. The old Shot-Pattern dark
   palette is gone: at v21.3 History was the last screen still using it. */
const RESET = `*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
button{font-family:inherit;cursor:pointer;border:none;padding:0;background:none}
html,body{margin:0;background:#F4F0E4}
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

/* ---------- course map (v22, caddie S3a) ----------
   OSM geometry via Overpass when a course is chosen (the v18.5 pattern: fetch once with signal,
   cache per course under bogeyman-matches:geo:v1:{apiId}), then the satellite tiles for every
   hole (addendum §11.2). Setup shows one status line; the caddie reads the cached geometry. */
const apiIdOf = (course) => course?.apiId ?? (course?.id != null ? String(course.id).split(":")[0] : null);
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
const safeStorage = () => { try { return window.localStorage; } catch (e) { return null; } };
/* { geometry, phase: none | loading | ready | unavailable, done, total } */
function useCourseMap(course) {
  const apiId = apiIdOf(course);
  const [geometry, setGeometry] = useState(() => (apiId != null ? loadGeometryCache(safeStorage(), apiId) : null));
  const [st, setSt] = useState({ phase: "none", done: 0, total: 0 });
  useEffect(() => {
    if (apiId == null) { setGeometry(null); setSt({ phase: "none", done: 0, total: 0 }); return undefined; }
    let live = true;
    let g = loadGeometryCache(safeStorage(), apiId);
    setGeometry(g);                                   // never show the previous course's holes
    (async () => {
      if (!g) {
        const anchor = courseAnchor(course);
        if (!anchor) { setGeometry(null); setSt({ phase: "unavailable", done: 0, total: 0 }); return; }
        setSt({ phase: "loading", done: 0, total: 18 });
        try {
          const parsed = await fetchGeometry(anchor.lat, anchor.lon);
          saveGeometryCache(safeStorage(), apiId, parsed);
          g = loadGeometryCache(safeStorage(), apiId) || parsed;
        } catch (e) {
          if (live) { setGeometry(null); setSt({ phase: "unavailable", done: 0, total: 0 }); }
          return;
        }
      }
      if (!live) return;
      setGeometry(g);
      const holes = Object.keys(g.holes || {}).length;
      if (!holes) { setSt({ phase: "unavailable", done: 0, total: 0 }); return; }
      if (!TILE_PREFETCH_ENABLED || typeof caches === "undefined") { setSt({ phase: "ready", done: holes, total: holes }); return; }
      setSt({ phase: "loading", done: 0, total: holes });
      await prefetchTiles(g, { isLive: () => live, onProgress: (p) => setSt({ phase: "loading", done: p.holesDone, total: p.holes }) }).catch(() => null);
      // Tiles that did not come down are not an error: the caddie draws the map from the geometry (§4.3).
      if (live) setSt({ phase: "ready", done: holes, total: holes });
    })();
    return () => { live = false; };
  }, [apiId]);
  return { geometry: apiId != null ? geometry : null, ...st };
}
/* Addendum §10.1 copy. */
const courseMapLine = (m) => !m || m.phase === "none" ? null
  : m.phase === "ready" ? "Course map ready"
  : m.phase === "loading" ? `Course map · loading ${m.done} of ${m.total || 18}`
  : "Course map unavailable · caddie will use yards";

/* Profile v2 — bundled with the app. null only if the file is malformed (§8 No profile, S3b). */
const CADDIE_PROFILE = (() => { try { return loadProfile(PROFILE_JSON); } catch (e) { return null; } })();

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

function Setup({ course, setCourse, diff, setDiff, stats, history, onStart, onHistory, courseMap }) {
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
          : tees.length === 0 && selectedFull ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>No 18-hole tees for this course.</span>
          : tees.length === 0 && course ? (
            /* restored from a saved round: the tee list was never fetched, so show
               the tee that round was on rather than asking for a course again */
            <div style={{ display: "flex", alignItems: "center", gap: 3, height: 58 }}>
              <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, width: 66, height: 58 }}>
                <span style={{ width: 14, height: 14, borderRadius: 7, background: T.paper, border: `1.5px solid ${T.ink}` }} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>{course.tee}</span>
                <span style={printed(11, 400)}>{yards ? yards.toLocaleString() : ""}</span>
                <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 58, overflow: "visible" }} viewBox="0 0 66 58" preserveAspectRatio="none" fill="none" aria-hidden="true">
                  <ellipse cx="33" cy="29" rx="29" ry="26" transform="rotate(-4 33 29)" stroke={T.pencil} strokeWidth="1.7" strokeDasharray="160 6" filter="url(#pencil)" />
                </svg>
              </span>
              <button onClick={() => setPicking(true)} style={{ background: "none", border: "none", color: T.ink, padding: "0 6px", ...caps(10, 700, "0.14em") }}>Change</button>
            </div>
          )
          : tees.length === 0 ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>Choose a course first.</span>
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
          {/* course-map prefetch (addendum §11.2) — one line, Bitter 11 ink */}
          {course && courseMapLine(courseMap) && (
            <span data-testid="course-map-status" style={{ fontFamily: F.label, fontSize: 11, color: T.ink, lineHeight: "14px", marginTop: -4 }}>{courseMapLine(courseMap)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- mid-round (paper scorecard, v21) ---------- */
/* Per-hole result against the ghost's fixed score. "" = not played yet. */
const holeRes = (you, gh) => you == null ? "" : you < gh ? "W" : you > gh ? "L" : "H";
const RES_FILL = { W: T.fillWon, L: T.fillLost, H: T.fillHalf };
const RES_WORD = { win: "won", loss: "lost", tie: "halved" };
/* Who a finished nine/total belongs to, in the footer's voice. */
const sideWord = (res) => res === "win" ? "you" : res === "loss" ? "ghost" : res === "tie" ? "halved" : "open";

/* The five options, relative to par. The last one is a ceiling the long-press
   can raise: the USGA cap is par + 2 + strokes received, so on a stroked hole
   par+2 is below your legal maximum and has to be reachable. */
function choicesFor(par, ceiling) {
  return [
    { v: par - 2, kind: "eagle",  rings: 2, color: T.ink },
    { v: par - 1, kind: "birdie", rings: 1, color: T.ink },
    { v: par,     kind: "par",    rings: 0, color: T.black },
    { v: par + 1, kind: "bogey",  boxes: 1, color: T.bogey },
    { v: ceiling, kind: "double", boxes: 2, color: T.double, ceiling: true },
  ];
}

/* A number written in pencil, with the shapes a scorecard puts round it.
   One tap makes it pending (the soft graphite disc); a second commits. */
function ScoreChoice({ c, par, pending, onTap, onHold }) {
  const held = React.useRef(false);
  const timers = React.useRef([]);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current.forEach(clearInterval); timers.current = []; };
  useEffect(() => stop, []);
  const start = () => {
    if (!c.ceiling) return;
    const t = setTimeout(() => {
      held.current = true; onHold();
      const iv = setInterval(onHold, 400); timers.current.push(iv);
    }, 450);
    timers.current.push(t);
  };
  const end = () => stop();
  const click = () => { if (held.current) { held.current = false; return; } onTap(c.v); };
  const label = c.ceiling && c.v === par + 2 ? `${c.v}+` : `${c.v}`;
  const S = 52;
  return (
    <button onClick={click} onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${c.kind}, ${label}${c.ceiling ? ", hold to go higher" : ""}${pending ? ", tap again to confirm" : ""}`}
      style={{ position: "relative", width: S, height: S, border: "none", background: "transparent",
        fontFamily: F.handNum, fontSize: 25, color: c.color, filter: "url(#pencil)", touchAction: "none", userSelect: "none" }}>
      {pending && <span style={{ position: "absolute", left: 6, top: 6, width: S - 12, height: S - 12, borderRadius: (S - 12) / 2, background: T.shade, filter: "url(#soft)" }} />}
      {c.rings > 0 && (
        <svg style={{ position: "absolute", left: 0, top: 0, width: S, height: S }} viewBox="0 0 52 52" fill="none" stroke={c.color} strokeWidth="1.4" aria-hidden="true">
          <ellipse cx="26" cy="26" rx="22" ry="21" transform="rotate(-8 26 26)" strokeDasharray="132 5" />
          {c.rings > 1 && <ellipse cx="26" cy="26" rx="17" ry="16.5" transform="rotate(12 26 26)" strokeDasharray="102 4" />}
        </svg>
      )}
      {c.boxes > 0 && (
        <svg style={{ position: "absolute", left: 0, top: 0, width: S, height: S }} viewBox="0 0 52 52" fill="none" stroke={c.color} strokeWidth="1.4" aria-hidden="true">
          {c.boxes > 1
            ? <><rect x="4" y="4" width="44" height="44" rx="1.5" transform="rotate(-1.5 26 26)" strokeDasharray="170 5" />
                <rect x="9.5" y="9.5" width="33" height="33" rx="1.5" transform="rotate(2 26 26)" strokeDasharray="128 4" /></>
            : <rect x="6" y="6" width="40" height="40" rx="1.5" transform="rotate(1.5 26 26)" strokeDasharray="155 5" />}
        </svg>
      )}
      <span style={{ position: "relative" }}>{label}</span>
    </button>
  );
}

/* One nine as a ruled strip: hole numbers, your line, the ghost's line.
   Cells carry the hole's result as a fill; the hole you are on is yellow. */
function Strip({ start, scores, ghost, hole, onJump }) {
  const idx = [...Array(9)].map((_, k) => start + k);
  const rows = [
    { key: "", h: 22, get: (i) => String(i + 1), style: { ...printed(12), color: T.ink }, under: T.ink },
    { key: "you", h: 30, get: (i) => scores[i] ?? "", style: written(17), under: T.hair },
    { key: "gh.", h: 30, get: (i) => ghost.holes[i], style: written(17, T.ghost), under: T.ink },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "34px repeat(9, minmax(0, 1fr))", borderTop: rule, borderLeft: rule }}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <div style={{ display: "flex", alignItems: "center", height: r.h, paddingLeft: 4, borderRight: rule,
            borderBottom: `1px solid ${r.under}`, fontFamily: F.label, fontSize: 10 }}>{r.key}</div>
          {idx.map((i, k) => {
            const res = i === hole ? "now" : holeRes(scores[i], ghost.holes[i]);
            return (
              <button key={i} onClick={() => onJump(i)} aria-label={`Hole ${i + 1}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", height: r.h, padding: 0,
                  border: "none", borderRight: `1px solid ${k % 3 === 2 ? T.ink : T.hair}`, borderBottom: `1px solid ${r.under}`,
                  background: res === "now" ? T.yellow : (RES_FILL[res] || "transparent"), ...r.style }}>
                {r.get(i)}
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function Play({ course, ghost, scores, setScores, hole, setHole, onFinish, onExit, onCaddie }) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [pending, setPending] = useState(null);          // { hole, v } — chosen, not written
  const [ceiling, setCeiling] = useState(null);          // raised par+2, this hole only
  const m = useMemo(() => evalMatch(scores, ghost.holes), [scores, ghost]);
  const h = course.holes[hole];
  const par = h.par;
  const cap = ceiling != null && ceiling > par + 2 ? ceiling : par + 2;
  const pend = pending && pending.hole === hole ? pending.v : null;

  useEffect(() => { setPending(null); setCeiling(null); }, [hole]);

  /* Write the number down. No navigation — the callers decide where to go. */
  const write = (v) => {
    const after = [...scores]; after[hole] = Math.max(1, v);
    setScores(after);
    setPending(null); setCeiling(null);
    return after;
  };

  /* Leaving a hole CONFIRMS a pending score rather than throwing it away: tapping a
     number and then Hole N+1 is the same as tapping the number twice. Discarding
     loses a real score silently; a wrong one can be retapped. */
  const goHole = (i) => {
    if (i === hole) return;
    if (pend != null) write(pend);
    setHole(i);
  };

  const commit = (v) => {
    const before = scores;
    const after = write(v);
    /* Hole 18 written and nothing left blank -> the round is over (decision 4). */
    const blanksBefore = before.reduce((a, s, i) => a + (s == null && i !== hole ? 1 : 0), 0);
    if (blanksBefore === 0 && before[hole] == null) { onFinish(after); return; }
    const nextBlank = after.findIndex((s, i) => s == null && i > hole);
    if (nextBlank !== -1) { setHole(nextBlank); return; }
    if (hole < 17) setHole(hole + 1);
  };
  const tap = (v) => { if (pend === v) commit(v); else setPending({ hole, v }); };
  /* Leaving for the caddie is navigation too: a pending score is written, never dropped. */
  const goCaddie = () => { if (pend != null) write(pend); if (onCaddie) onCaddie(); };
  const raise = () => setCeiling((c) => {
    const next = Math.min((c != null && c > par + 2 ? c : par + 2) + 1, 15);
    setPending({ hole, v: next });
    return next;
  });

  const seg = Math.floor(hole / 3);
  const segHoles = [seg * 3, seg * 3 + 1, seg * 3 + 2];
  const lead = m.you - m.opp;
  const relation = lead === 0 ? "all square" : lead > 0 ? "up" : "down";
  const played = (a, b) => scores.slice(a, b).reduce((x, s) => x + (s ?? 0), 0);
  const ghPlayed = (a, b) => scores.slice(a, b).reduce((x, s, k) => s != null ? x + ghost.holes[a + k] : x, 0);

  const segLine = (from, to) => {
    const done = [], open = [];
    for (let s = from; s <= to; s++) (m.segs[s].done ? done : open).push(s);
    if (done.length) return {
      parts: done.map((s, k) => <span key={s}>{k ? " · " : ""}S{s + 1} <span style={writtenWord(16)}>{RES_WORD[m.segs[s].res]}</span></span>),
      open: "",
    };
    return { parts: null, open: open.map(s => `S${s + 1}`).join(" · ") };
  };
  const front = segLine(0, 2), back = segLine(3, 5);
  const frontPlayed = scores.slice(0, 9).some(s => s != null);

  return (
    <div style={{ height: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column",
      justifyContent: "space-between", padding: "max(env(safe-area-inset-top), 28px) 20px max(env(safe-area-inset-bottom), 16px)", background: T.paper }}>

      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: rule, gap: 10 }}>
        <button onClick={() => (scores.every(s => s == null) ? onExit() : setConfirmExit(true))}
          aria-label="Leave round" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", background: "none", border: "none", padding: 0, minWidth: 0, textAlign: "left" }}>
          <span style={{ fontFamily: F.label, fontSize: 15, fontWeight: 700, color: T.black, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
            <span style={{ color: T.ink, fontWeight: 400 }}>‹ </span>{course.name} · {course.tee}
          </span>
          <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink }}>
            segment <span style={printed(12)}>{seg + 1}</span> of 6 · holes <span style={printed(12)}>{seg * 3 + 1}–{seg * 3 + 3}</span>
          </span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={caps(9, 400, "0.14em")}>You</span>
            <span style={{ ...written(22), lineHeight: "22px" }}>{fmtPts(m.you)}</span>
          </div>
          <span style={{ ...writtenWord(relation === "all square" ? 19 : 26), lineHeight: "22px", whiteSpace: "nowrap" }}>{relation}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={caps(9, 400, "0.14em")}>Ghost</span>
            <span style={{ ...written(22, T.ghost), lineHeight: "22px" }}>{fmtPts(m.opp)}</span>
          </div>
        </div>
      </div>

      {confirmExit && <LeaveSheet hole={hole} onStay={() => setConfirmExit(false)} onLeave={() => { setConfirmExit(false); onExit(); }} />}

      {/* the segment you are in */}
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(3, minmax(0, 1fr))", borderLeft: rule }}>
        <div style={{ display: "flex", alignItems: "center", height: 42, paddingLeft: 6, borderRight: rule, borderBottom: rule, ...caps(10, 700, "0.12em") }}>Hole</div>
        {segHoles.map((i, k) => {
          const now = i === hole;
          return (
            <button key={i} onClick={() => goHole(i)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 42,
              border: "none", borderRight: `1px solid ${k === 2 ? T.ink : T.hair}`, borderBottom: rule, background: now ? T.yellow : "transparent", padding: 0 }}>
              <span style={{ ...printed(24), color: T.black }}>{i + 1}</span>
              <span style={{ fontFamily: F.label, fontSize: 10, lineHeight: "12px", color: now ? T.black : T.ink, textAlign: "left" }}>
                par {course.holes[i].par}<br />idx {course.holes[i].si}
              </span>
            </button>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", height: 42, paddingLeft: 6, borderRight: rule, borderBottom: hairline, ...caps(10, 700, "0.12em") }}>Ghost</div>
        {segHoles.map((i, k) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 42,
            borderRight: `1px solid ${k === 2 ? T.ink : T.hair}`, borderBottom: hairline, ...written(21, T.ghost) }}>{ghost.holes[i]}</div>
        ))}
        <div style={{ display: "flex", alignItems: "center", height: 42, paddingLeft: 6, borderRight: rule, borderBottom: rule, ...caps(10, 700, "0.12em") }}>You</div>
        {segHoles.map((i, k) => {
          const showPend = i === hole && pend != null && scores[i] == null;
          const val = scores[i] != null ? scores[i] : showPend ? pend : "";
          const col = showPend ? (pend > course.holes[i].par + 1 ? T.double : pend > course.holes[i].par ? T.bogey : T.pencil) : T.pencil;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 42,
              borderRight: `1px solid ${k === 2 ? T.ink : T.hair}`, borderBottom: rule }}>
              <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30 }}>
                {showPend && <span style={{ position: "absolute", left: 2, top: 2, width: 26, height: 26, borderRadius: 13, background: T.shade, filter: "url(#soft)" }} />}
                <span style={{ position: "relative", ...written(21, col) }}>{val}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* the hole itself, then the five numbers */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={caps(9, 400, "0.14em")}>Ghost</span>
            <span style={{ width: 44, height: 44, border: hairline, display: "flex", alignItems: "center", justifyContent: "center", ...written(24, T.ghost) }}>{ghost.holes[hole]}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ ...printed(72), lineHeight: "62px", color: T.black }}>{hole + 1}</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink }}>par <span style={printed(12)}>{par}</span> · index <span style={printed(12)}>{h.si}</span></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={caps(9, 400, "0.14em")}>You</span>
            <span style={{ width: 44, height: 44, border: rule, background: T.yellow, display: "flex", alignItems: "center", justifyContent: "center",
              ...written(24, (scores[hole] ?? pend) > par + 1 ? T.double : (scores[hole] ?? pend) > par ? T.bogey : T.pencil) }}>
              {scores[hole] != null ? scores[hole] : pend != null ? pend : ""}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", paddingTop: 6 }}>
          {choicesFor(par, cap).map((c) => (
            <ScoreChoice key={c.kind} c={c} par={par} pending={pend === c.v} onTap={tap} onHold={raise} />
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", width: "100%", paddingTop: 4 }}>
          <button onClick={() => goHole(hole - 1)} disabled={hole === 0}
            aria-label={pend != null ? `Confirm ${pend} and go back to hole ${hole}` : `Go back to hole ${hole}`}
            style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "none", border: "none",
              justifySelf: "start", color: hole === 0 ? T.muted : T.ink, ...caps(11, 700, "0.14em") }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 7 H2" /><path d="M7 2 L2 7 L7 12" /></svg>
            Hole <span style={{ ...printed(13), letterSpacing: 0 }}>{hole}</span>
          </button>
          {/* addendum §2: the way to the caddie, centred between the hole links */}
          <button onClick={goCaddie} aria-label={`Caddie for hole ${hole + 1}`}
            style={{ display: "flex", alignItems: "center", gap: 7, height: 40, padding: "0 10px", background: "none", border: "none", color: T.ink, ...caps(11, 700) }}>
            <svg width="12" height="15" viewBox="0 0 14 18" fill="none" stroke={T.ink} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={T.ink} stroke={T.ink} />
            </svg>
            Caddie
          </button>
          <button onClick={() => goHole(hole + 1)} disabled={hole === 17}
            aria-label={pend != null ? `Confirm ${pend} and go on to hole ${hole + 2}` : `Go on to hole ${hole + 2}`}
            style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 12px", background: "none", border: "none",
              justifySelf: "end", color: hole === 17 ? T.muted : T.ink, ...caps(11, 700, "0.14em") }}>
            Hole <span style={{ ...printed(13), letterSpacing: 0 }}>{hole + 2}</span>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 7 H16" /><path d="M11 2 L16 7 L11 12" /></svg>
          </button>
        </div>
      </div>

      {/* the whole card */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={caps(10)}>Out</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink, textAlign: "right" }}>
              {front.parts}
              {front.open && <span style={{ color: T.muted }}>{front.open} open</span>}
              {frontPlayed && <>{(front.parts || front.open) ? " · " : ""}you <span style={printed(12)}>{played(0, 9)}</span>, ghost <span style={printed(12)}>{ghPlayed(0, 9)}</span></>}
            </span>
          </div>
          <Strip start={0} scores={scores} ghost={ghost} hole={hole} onJump={goHole} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={caps(10)}>In</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink, textAlign: "right" }}>
              {back.parts}
              {back.open && <span style={{ color: T.muted }}>{back.open} open</span>}
            </span>
          </div>
          <Strip start={9} scores={scores} ghost={ghost} hole={hole} onJump={goHole} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", paddingTop: 2, ...caps(10, 400, "0.14em") }}>
          <div>Out <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.front.res)}</span></div>
          <div style={{ textAlign: "center", color: m.back.res === "live" ? T.muted : T.ink }}>In <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.back.res)}</span></div>
          <div style={{ textAlign: "right" }}>Total <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.total.res)}</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- caddie (v22, S3a: the map layer) ----------
   Full-bleed map of the hole with the ‹ Card tag, the notice tag and the attribution (addendum
   §3.1). The rail and the bar are PLACEHOLDERS until S3b: an empty 106-wide paper rail and one
   primary pill that does nothing yet. Gets the course's hole data and the geometry only — no ghost,
   no match, no scores (engine rule 4, T41). */
function useSafeArea() {
  const [s, setS] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(d);
    const read = () => { const cs = getComputedStyle(d); setS({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }); };
    read();
    window.addEventListener("resize", read);
    return () => { window.removeEventListener("resize", read); d.remove(); };
  }, []);
  return s;
}

const CADDIE_RAIL_W = 106;
function Caddie({ course, hole, geometry, profile, onCard }) {
  const safe = useSafeArea();
  const n = hole + 1;
  const h = course.holes[hole];
  // S3a plays the holes in scorecard order: OSM hole n = scorecard hole n (27-hole nine mapping: S3b).
  const key = geometry && geometry.holes && geometry.holes[String(n)] ? String(n) : null;
  const built = useMemo(() => {
    try { return key != null ? buildHole(geometry, key, { par: h.par, yards: h.yards }) : null; } catch (e) { return null; }
  }, [geometry, key, h.par, h.yards]);
  // A tap on the green moves the flag. Held here for the session only; S3b stores it per hole (§6, §9.8).
  const [pins, setPins] = useState({});
  const pin = useMemo(() => (built ? pins[n] || distances(built, built.tee, "middle").pinPoint : null), [built, pins, n]);
  const sat = useSatellite(built ? geometry : null, built ? key : null);
  const notice = built ? sat.notice : noticeNoCourseMap(n);
  const barH = 78 + safe.bottom;
  const insets = useMemo(() => ({ top: safe.top + 49, right: CADDIE_RAIL_W, bottom: barH + 16, left: 0 }), [safe.top, barH]);
  void profile;   // S3b: recommend(ctx, built, profile) → options for the map

  return (
    <div data-screen="caddie" style={{ position: "fixed", inset: 0, overflow: "hidden", background: T.paper, color: T.ink, fontFamily: F.label }}>
      <MapLayer hole={built} geometry={geometry} ball={null} accuracyM={null} pin={pin} options={null} active="safe" sameShot={false}
        previousShots={[]} insets={insets} fallback={!built || sat.mode === "fallback"}
        onPinTap={(p) => setPins((s) => ({ ...s, [n]: p }))} onMapTap={() => {}} onSatelliteFail={sat.markFailed} />

      <button onClick={onCard} aria-label="Back to the scorecard" style={{ position: "absolute", left: 14, top: safe.top + 9, height: 32, padding: "0 11px",
        display: "flex", alignItems: "center", background: T.paper, border: rule, borderRadius: 0, color: T.ink, fontFamily: F.label, fontSize: 12, zIndex: 15, whiteSpace: "nowrap" }}>
        ‹&nbsp;Card
      </button>

      {notice && (
        <div role="status" style={{ position: "absolute", left: 14, right: 120, top: safe.top + 49, padding: "7px 11px", background: T.paper, border: rule,
          color: T.ink, fontFamily: F.label, fontSize: 12, lineHeight: "16px", zIndex: 15, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {notice}
        </div>
      )}

      {/* rail — placeholder until S3b */}
      <div data-part="rail" style={{ position: "absolute", right: 0, top: 0, bottom: barH, width: CADDIE_RAIL_W, background: T.paper, borderLeft: `4px double ${T.ink}`, zIndex: 20 }} />

      {/* bar — one primary pill (Log shot stays hidden until S4); it does nothing until S3b */}
      <div data-part="bar" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barH, background: T.paper, borderTop: `4px double ${T.ink}`,
        padding: `12px 18px ${safe.bottom + 10}px`, display: "flex", gap: 10, zIndex: 21 }}>
        <button onClick={() => {}} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 26,
          background: T.ink, border: `2px solid ${T.ink}`, boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, color: T.paper, ...caps(12, 700, "0.18em") }}>
          <svg width="14" height="18" viewBox="0 0 14 18" fill="none" stroke={T.paper} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={T.yellow} stroke={T.yellow} />
          </svg>
          I'm on the tee
        </button>
      </div>
    </div>
  );
}

/* ---------- shared: leave-round sheet ---------- */
function LeaveSheet({ hole, onStay, onLeave }) {
  return (
    <div onClick={onStay} style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: T.paper, borderTop: `4px double ${T.ink}`,
        padding: "20px 22px calc(env(safe-area-inset-bottom) + 20px)" }}>
        <div style={{ ...caps(12), marginBottom: 6 }}>Leave this round?</div>
        <div style={{ fontFamily: F.label, fontSize: 13, color: T.ink, marginBottom: 18 }}>
          You're on hole <span style={printed(14)}>{hole + 1}</span>. This round isn't finished, so it won't be saved to your record.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onStay} style={{ flex: 1, height: 50, border: `2px solid ${T.ink}`, borderRadius: 25, background: T.ink, color: T.paper,
            boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, ...caps(12, 700, "0.18em") }}>Keep playing</button>
          <button onClick={onLeave} style={{ flex: 1, height: 50, border: `2px solid ${T.double}`, borderRadius: 25, background: "transparent",
            color: T.double, ...caps(12, 700, "0.18em") }}>Leave round</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- the finished card (paper, v21.2) ---------- */
/* A score written on a scorecard, with the shapes the chooser uses: two rings for
   an eagle, one for a birdie, nothing for par, one box for a bogey, two for worse. */
function PencilMark({ score, par, size = 22 }) {
  if (score == null) return <span style={{ ...written(14, T.muted) }}>·</span>;
  const d = score - par;
  const rings = d <= -2 ? 2 : d === -1 ? 1 : 0;
  const boxes = d === 1 ? 1 : d >= 2 ? 2 : 0;
  const col = d < 0 ? T.ink : d === 0 ? T.black : d === 1 ? T.bogey : T.double;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size }}>
      {rings > 0 && (
        <svg style={{ position: "absolute", left: 0, top: 0, width: size, height: size }} viewBox="0 0 22 22" fill="none" stroke={col} strokeWidth="1.1" aria-hidden="true">
          <ellipse cx="11" cy="11" rx="9.5" ry="9" transform="rotate(-8 11 11)" strokeDasharray="56 3" />
          {rings > 1 && <ellipse cx="11" cy="11" rx="6.5" ry="6" transform="rotate(12 11 11)" strokeDasharray="38 3" />}
        </svg>
      )}
      {boxes > 0 && (
        <svg style={{ position: "absolute", left: 0, top: 0, width: size, height: size }} viewBox="0 0 22 22" fill="none" stroke={col} strokeWidth="1.1" aria-hidden="true">
          {boxes > 1
            ? <><rect x="1.5" y="1.5" width="19" height="19" transform="rotate(-1.5 11 11)" strokeDasharray="74 3" />
                <rect x="4.5" y="4.5" width="13" height="13" transform="rotate(2 11 11)" strokeDasharray="50 3" /></>
            : <rect x="2.5" y="2.5" width="17" height="17" transform="rotate(1.5 11 11)" strokeDasharray="66 3" />}
        </svg>
      )}
      <span style={{ position: "relative", ...written(15, col) }}>{score}</span>
    </span>
  );
}

/* The whole round as one ruled card: hole, par, you, the ghost, and the totals. */
function ScoreCard({ course, ghost, scores, onTapHole }) {
  const cols = "26px repeat(9, minmax(0, 1fr)) 28px 30px";
  const nine = (start) => {
    const isIn = start === 9;
    const idx = [...Array(9)].map((_, k) => start + k);
    const sum = (f) => idx.reduce((a, i) => a + f(i), 0);
    const cell = (extra) => ({ display: "flex", alignItems: "center", justifyContent: "center", ...extra });
    const row = (label, get, tot, all, h, under, style) => (
      <React.Fragment key={label}>
        <div style={cell({ height: h, justifyContent: "flex-start", paddingLeft: 3, borderRight: rule, borderBottom: `1px solid ${under}`, fontFamily: F.label, fontSize: 9, fontWeight: 700 })}>{label}</div>
        {idx.map((i, k) => {
          const res = holeRes(scores[i], ghost.holes[i]);
          const tap = label === "you" && onTapHole;
          const El = tap ? "button" : "div";
          return (
            <El key={i} {...(tap ? { onClick: () => onTapHole(i), "aria-label": `Edit hole ${i + 1}` } : {})}
              style={cell({ height: h, padding: 0, border: "none", borderRight: `1px solid ${k % 3 === 2 ? T.ink : T.hair}`,
                borderBottom: `1px solid ${under}`, background: RES_FILL[res] || "transparent", ...style })}>
              {get(i)}
            </El>
          );
        })}
        <div style={cell({ height: h, borderRight: `1px solid ${T.hair}`, borderBottom: `1px solid ${under}`, ...style })}>{tot}</div>
        <div style={cell({ height: h, borderRight: rule, borderBottom: `1px solid ${under}`, ...style })}>{isIn ? all : ""}</div>
      </React.Fragment>
    );
    return (
      <div style={{ display: "grid", gridTemplateColumns: cols, borderTop: rule, borderLeft: rule, marginBottom: isIn ? 0 : 10 }}>
        <div style={{ display: "flex", alignItems: "center", height: 20, paddingLeft: 3, borderRight: rule, borderBottom: rule, ...caps(9, 700, "0.1em") }}>{isIn ? "In" : "Out"}</div>
        {idx.map((i, k) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 20,
            borderRight: `1px solid ${k % 3 === 2 ? T.ink : T.hair}`, borderBottom: rule, ...printed(11) }}>{i + 1}</div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 20, borderRight: `1px solid ${T.hair}`, borderBottom: rule, ...caps(8, 700, "0.06em") }}>{isIn ? "In" : "Out"}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 20, borderRight: rule, borderBottom: rule, ...caps(8, 700, "0.06em") }}>{isIn ? "Tot" : ""}</div>
        {row("par", (i) => course.holes[i].par, sum(i => course.holes[i].par), course.par, 20, T.hair, { ...printed(11, 400), color: T.ink })}
        {/* you wrote these, so the totals are in pencil too — only par is pre-printed */}
        {row("you", (i) => <PencilMark score={scores[i]} par={course.holes[i].par} />, sum(i => scores[i] ?? 0), scores.reduce((a, s) => a + (s ?? 0), 0), 28, T.hair, written(18))}
        {row("gh.", (i) => ghost.holes[i], sum(i => ghost.holes[i]), ghost.gross, 26, T.ink, written(15, T.ghost))}
      </div>
    );
  };
  return <div>{nine(0)}{nine(9)}</div>;
}

/* ---------- summary ---------- */
function Summary({ course, ghost, scores, history, onEditScore, onReset }) {
  const m = evalMatch(scores, ghost.holes);
  const won = m.you > m.opp, tie = m.you === m.opp;
  const stats = deriveStats(history);
  const toPar = m.total.yourTot - course.par;
  const tp = toPar === 0 ? "even" : toPar > 0 ? `+${toPar}` : `${toPar}`;
  const [editHole, setEditHole] = useState(null);
  const [editVal, setEditVal] = useState(0);
  const openEdit = (i) => { setEditVal(scores[i] ?? course.holes[i].par); setEditHole(i); };
  const saveEdit = () => { onEditScore(editHole, editVal); setEditHole(null); };
  const lead = m.you - m.opp;
  const relation = lead === 0 ? "all square" : lead > 0 ? "up" : "down";

  return (
    <div style={{ minHeight: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", background: T.paper,
      padding: "max(env(safe-area-inset-top), 26px) 20px max(env(safe-area-inset-bottom), 28px)" }}>

      {/* who took it */}
      <div style={{ textAlign: "center", paddingBottom: 10, borderBottom: rule }}>
        <div style={caps(10)}>Final · {course.name} · {course.tee}</div>
        <div style={{ ...writtenWord(38), lineHeight: "44px", marginTop: 2, color: won ? T.ink : tie ? T.pencil : T.double }}>
          {won ? "you beat the ghost" : tie ? "dead heat" : "the ghost takes it"}
        </div>
      </div>

      {/* the match */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 18, padding: "14px 0", borderBottom: rule }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={caps(9, 400, "0.14em")}>You</span>
          <span style={{ ...written(34), lineHeight: "36px" }}>{fmtPts(m.you)}</span>
          <span style={{ fontFamily: F.label, fontSize: 11 }}>gross <span style={printed(12)}>{m.total.yourTot}</span></span>
        </div>
        <span style={{ ...writtenWord(relation === "all square" ? 22 : 30), lineHeight: "40px", whiteSpace: "nowrap" }}>{relation}</span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={caps(9, 400, "0.14em")}>Ghost</span>
          <span style={{ ...written(34, T.ghost), lineHeight: "36px" }}>{fmtPts(m.opp)}</span>
          <span style={{ fontFamily: F.label, fontSize: 11 }}>gross <span style={printed(12)}>{ghost.gross}</span></span>
        </div>
      </div>

      {/* where the eight points went */}
      <div style={{ padding: "10px 0", borderBottom: rule }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 2 }}>
          {m.segs.map((s, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "3px 0",
              background: s.res === "win" ? T.fillWon : s.res === "loss" ? T.fillLost : s.res === "tie" ? T.fillHalf : "transparent" }}>
              <span style={caps(9, 700, "0.08em")}>S{i + 1}</span>
              <span style={{ ...writtenWord(15), lineHeight: "15px" }}>{RES_WORD[s.res] || "—"}</span>
              <span style={{ ...printed(10, 400), color: T.ink }}>{s.yourSum}–{s.ghostSum}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", paddingTop: 8, ...caps(10, 400, "0.14em") }}>
          <div>Out <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.front.res)}</span></div>
          <div style={{ textAlign: "center" }}>In <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.back.res)}</span></div>
          <div style={{ textAlign: "right" }}>Total <span style={{ ...writtenWord(17), letterSpacing: 0, textTransform: "none" }}>{sideWord(m.total.res)}</span></div>
        </div>
      </div>

      {/* the card */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 6px" }}>
        <span style={caps(10)}>The card</span>
        <span style={{ fontFamily: F.label, fontSize: 11 }}>
          <span style={printed(12)}>{course.rating}</span>/<span style={printed(12)}>{course.slope}</span> · <span style={written(17)}>{tp}</span>
        </span>
      </div>
      <ScoreCard course={course} ghost={ghost} scores={scores} onTapHole={openEdit} />
      <div style={{ textAlign: "center", fontFamily: F.label, fontSize: 11, color: T.muted, padding: "8px 0 0" }}>Tap any hole in your row to change it</div>

      {/* the running record, now including this round */}
      <div style={{ padding: "14px 0 0", marginTop: 12, borderTop: rule }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={caps(10)}>Record vs. the ghost</span>
          <span style={{ fontFamily: F.label, fontSize: 11 }}>streak {stats.streakText} · avg {stats.marginStr}</span>
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

      <div style={{ display: "flex", justifyContent: "center", paddingTop: 20 }}>
        <button onClick={onReset} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 52, padding: "0 30px",
          background: T.ink, border: `2px solid ${T.ink}`, borderRadius: 26, boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, color: T.paper, ...caps(13, 700, "0.22em") }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={T.yellow} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M14 8a6 6 0 1 1-1.8-4.3" /><path d="M14 2v4h-4" />
          </svg>
          New round
        </button>
      </div>

      {/* change one hole */}
      {editHole != null && (
        <div onClick={() => setEditHole(null)} style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: T.paper, borderTop: `4px double ${T.ink}`,
            padding: "20px 22px calc(env(safe-area-inset-bottom) + 20px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: rule }}>
              <div>
                <div style={caps(12)}>Hole <span style={{ ...printed(15), letterSpacing: 0 }}>{editHole + 1}</span></div>
                <div style={{ fontFamily: F.label, fontSize: 11 }}>par <span style={printed(12)}>{course.holes[editHole].par}</span> · index <span style={printed(12)}>{course.holes[editHole].si}</span></div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={caps(9, 400, "0.14em")}>Ghost</span>
                <span style={{ width: 40, height: 40, border: hairline, display: "flex", alignItems: "center", justifyContent: "center", ...written(22, T.ghost) }}>{ghost.holes[editHole]}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 0" }}>
              <button onClick={() => setEditVal(v => Math.max(1, v - 1))} aria-label="One fewer"
                style={{ width: 52, height: 52, border: rule, background: "transparent", color: T.ink, fontSize: 24, lineHeight: "24px" }}>−</button>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ ...written(44), lineHeight: "46px" }}>{editVal}</div>
                <div style={{ fontFamily: F.label, fontSize: 11, color: T.ink }}>{scoreName(editVal, course.holes[editHole].par)}</div>
              </div>
              <button onClick={() => setEditVal(v => v + 1)} aria-label="One more"
                style={{ width: 52, height: 52, border: rule, background: "transparent", color: T.ink, fontSize: 24, lineHeight: "24px" }}>+</button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEditHole(null)} style={{ flex: 1, height: 50, border: `2px solid ${T.muted}`, borderRadius: 25, background: "transparent", color: T.muted, ...caps(12, 700, "0.18em") }}>Cancel</button>
              <button onClick={saveEdit} style={{ flex: 1, height: 50, border: `2px solid ${T.ink}`, borderRadius: 25, background: T.ink, color: T.paper, boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, ...caps(12, 700, "0.18em") }}>Save</button>
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

/* ---------- history (paper ledger, v21.3) ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const RES_FILL_LETTER = { W: T.fillWon, L: T.fillLost, T: T.fillHalf };
const RES_EDGE = { W: T.ink, L: T.double, T: T.muted };
const RES_LONG = { W: "won", L: "lost", T: "halved" };

function History({ history, stats, cloud, onDelete, onImport, onBack }) {
  const [confirmId, setConfirmId] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = React.useRef(null);
  const rounds = [...history].reverse();                  // most recent first

  const doExport = async () => {
    if (!history.length) { setMsg("Nothing to export yet."); return; }
    const r = await exportRounds(history);
    if (r) setMsg(`${r} ${history.length} round${history.length === 1 ? "" : "s"}.`);
  };
  const doImport = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";                                   // let the same file be picked again
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const parsed = parseBackup(String(fr.result));
      if (!parsed) { setMsg("That doesn't look like a Loop backup."); return; }
      if (!parsed.length) { setMsg("No usable rounds in that file."); return; }
      const { added, skipped } = onImport(parsed);
      setMsg(added ? `Added ${added} round${added === 1 ? "" : "s"}${skipped ? `, ${skipped} already here` : ""}.`
                   : "Already up to date — nothing new to add.");
    };
    fr.onerror = () => setMsg("Couldn't read that file.");
    fr.readAsText(f);
  };

  const cu = (cloud && cloud.user) || null;
  const cstatus = (cloud && cloud.status) || "off";
  const signedIn = !!cu;
  const doSignIn = async () => {
    setBusy(true); setMsg("");
    try { await cloudSignIn(); }
    catch (e) { setMsg("Couldn't sign in — " + ((e && e.code) || "try again")); }
    finally { setBusy(false); }
  };
  const syncDot = cstatus === "synced" ? T.ink : cstatus === "syncing" ? T.muted : cstatus === "error" ? T.double : T.hair;
  const syncTitle = !signedIn ? "Not backed up" : cstatus === "synced" ? "Backed up"
    : cstatus === "syncing" ? "Syncing…" : cstatus === "error" ? "Sync problem" : "Connecting…";
  const syncNote = !signedIn ? "Sign in once. Rounds then save themselves — and survive a wipe."
    : cstatus === "error" ? "Saved on this phone. Will retry when you're back online."
    : `${history.length} round${history.length === 1 ? "" : "s"} · ${cu.email || "signed in"}`;

  const outlinePill = { height: 44, border: rule, borderRadius: 22, background: "transparent", color: T.ink, ...caps(11, 700, "0.16em") };

  return (
    <div style={{ minHeight: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", background: T.paper,
      padding: "max(env(safe-area-inset-top), 26px) 20px max(env(safe-area-inset-bottom), 28px)" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: rule }}>
        <button onClick={onBack} style={{ background: "none", border: "none", padding: "6px 0", color: T.ink, ...caps(11) }}>‹ Back</button>
        <span style={caps(11)}>Round history</span>
      </div>

      {/* the record these rounds add up to */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderBottom: rule }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={caps(10)}>Record vs. the ghost</span>
          <span style={{ fontFamily: F.label, fontSize: 11 }}>
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

      {/* the ledger */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 4px" }}>
        <span style={caps(10)}>Rounds</span>
        <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>newest first</span>
      </div>

      {rounds.length === 0 ? (
        <div style={{ fontFamily: F.label, fontSize: 12, color: T.muted, padding: "26px 0", textAlign: "center", borderTop: rule, borderBottom: rule }}>
          No rounds logged yet.
        </div>
      ) : (
        <div style={{ borderTop: rule }}>
          {rounds.map(r => {
            const confirming = confirmId === r.id;
            const margin = r.yourPoints - r.ghostPoints;
            const rd = recordDifferential(r);              // this round's differential — feeds the last-5
            return (
              /* the result reads off an edge mark, not a full wash — a ledger of six
                 tinted bands stops looking like paper */
              <div key={r.id} style={{ borderBottom: rule, borderLeft: `4px solid ${RES_EDGE[r.result] || T.hair}`,
                background: confirming ? RES_FILL_LETTER[r.result] || "transparent" : "transparent", padding: "8px 8px 7px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ ...writtenWord(21), lineHeight: "21px", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.course}
                  </span>
                  <span style={{ ...written(18), whiteSpace: "nowrap" }}>{fmtPts(r.yourPoints)}–{fmtPts(r.ghostPoints)}</span>
                  {!confirming && (
                    <button onClick={() => setConfirmId(r.id)} aria-label={`Delete the round at ${r.course}`}
                      style={{ background: "none", border: "none", padding: "0 0 0 4px", color: T.muted, fontSize: 15, lineHeight: "15px" }}>✕</button>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, fontFamily: F.label, fontSize: 11, color: T.ink }}>
                  <span style={{ ...writtenWord(15) }}>{RES_LONG[r.result] || "—"}</span>
                  <span style={{ color: T.muted }}>·</span>
                  <span>{fmtDate(r.date)}</span>
                  <span style={{ color: T.muted }}>·</span>
                  <span>{r.tee}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: T.muted }}>
                    {margin >= 0 ? "+" : ""}{margin.toFixed(1)}{rd != null ? ` · diff ${rd.toFixed(1)}` : ""}
                  </span>
                </div>
                {confirming && (
                  <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
                    <button onClick={() => setConfirmId(null)} style={{ flex: 1, height: 36, border: `1px solid ${T.muted}`, borderRadius: 18, background: "transparent", color: T.muted, ...caps(10, 700, "0.16em") }}>Keep</button>
                    <button onClick={() => { onDelete(r.id); setConfirmId(null); }} style={{ flex: 1, height: 36, border: `1px solid ${T.double}`, borderRadius: 18, background: "transparent", color: T.double, ...caps(10, 700, "0.16em") }}>Delete</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* cloud backup — the durable copy */}
      <div style={{ padding: "16px 0 10px", borderBottom: rule }}>
        <div style={caps(10)}>Cloud backup</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: syncDot, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F.label, fontSize: 13, fontWeight: 700, color: T.ink }}>{syncTitle}</div>
            <div style={{ fontFamily: F.label, fontSize: 11, color: T.muted, marginTop: 1, lineHeight: 1.4, overflowWrap: "anywhere" }}>{syncNote}</div>
          </div>
          {signedIn ? (
            <button onClick={cloudSignOut} style={{ background: "none", border: "none", color: T.muted, flexShrink: 0, ...caps(10, 700, "0.14em") }}>Sign out</button>
          ) : (
            <button onClick={doSignIn} disabled={busy} style={{ height: 38, padding: "0 18px", border: `2px solid ${T.ink}`, borderRadius: 19,
              background: T.ink, color: T.paper, boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, flexShrink: 0, opacity: busy ? 0.6 : 1, ...caps(11, 700, "0.16em") }}>
              {busy ? "…" : "Turn on"}
            </button>
          )}
        </div>
      </div>

      {/* manual backup — the fallback you hold yourself */}
      <div style={{ paddingTop: 14 }}>
        <div style={{ ...caps(10), marginBottom: 8 }}>Manual backup</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={doExport} style={{ ...outlinePill, flex: 1 }}>Export rounds</button>
          <button onClick={() => fileRef.current && fileRef.current.click()} style={{ ...outlinePill, flex: 1 }}>Import</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: "none" }} />
        <div style={{ fontFamily: F.label, fontSize: 11, color: msg ? T.ink : T.muted, marginTop: 8, lineHeight: 1.45 }}>
          {msg || "A file copy you control. Export saves to Files or iCloud; import merges a backup back in without touching rounds you already have."}
        </div>
      </div>
    </div>
  );
}

/* ---------- localStorage persistence ---------- */
const LS_KEY = "bogeyman-matches:v1";
const HIST_KEY = "bogeyman-matches:history:v1";
const DEFAULT_STATE = { screen: "setup", course: null, diff: 7.9, scores: Array(18).fill(null), hole: 0, roundId: null };
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
    // Resume ONLY a genuinely in-progress round: at least one hole scored. An empty
    // just-started round or a finished summary opens the menu. A round left on the
    // old caddie screen resumes on the scorecard, which is all there is now.
    const wantResume = (s.screen === "play" || s.screen === "caddie") && course && scoresOk && played >= 1;
    return {
      screen: wantResume ? "play" : "setup",
      course,
      diff: typeof s.diff === "number" ? s.diff : 7.9,
      scores,
      hole: Number.isInteger(s.hole) && s.hole >= 0 && s.hole < 18 ? s.hole : 0,
      roundId: typeof s.roundId === "string" ? s.roundId : null,
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
  const [history, setHistory] = useState(loadHistory());
  const [tombs, setTombs] = useState(loadTombs());
  const cloud = useCloudSync(history, setHistory, tombs, setTombs);
  const courseMap = useCourseMap(course);
  useEffect(() => { saveState({ screen, course, diff, scores, hole, roundId }); }, [screen, course, diff, scores, hole, roundId]);
  useEffect(() => { saveHistory(history); }, [history]);
  useEffect(() => { saveTombs(tombs); }, [tombs]);
  const ghost = useMemo(() => course ? computeGhost(course, diff) : null, [course, diff]);
  const stats = useMemo(() => deriveStats(history), [history]);
  const start = () => { if (!course) return; setScores(Array(18).fill(null)); setHole(0); setRoundId(null); setScreen("play"); };
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
      {screen === "setup" && <Setup course={course} setCourse={setCourse} diff={diff} setDiff={setDiff} stats={stats} history={history} onStart={start} onHistory={() => setScreen("history")} courseMap={courseMap} />}
      {screen === "play" && course && ghost && <Play course={course} ghost={ghost} scores={scores} setScores={setScores} hole={hole} setHole={setHole} onFinish={finalize} onExit={exitRound} onCaddie={() => setScreen("caddie")} />}
      {screen === "caddie" && course && <Caddie course={course} hole={hole} geometry={courseMap.geometry} profile={CADDIE_PROFILE} onCard={() => setScreen("play")} />}
      {screen === "summary" && course && ghost && <Summary course={course} ghost={ghost} scores={scores} history={history} onEditScore={editScore} onReset={reset} />}
      {screen === "history" && <History history={history} stats={stats} cloud={cloud} onDelete={deleteRound} onImport={importRounds} onBack={() => setScreen("setup")} />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
