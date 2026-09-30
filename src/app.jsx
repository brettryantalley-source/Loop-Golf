import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as fbSignOut } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, doc, setDoc, getDocs } from "firebase/firestore";
import { T, F, caps, printed, written, writtenWord, rule, hairline, doubleRule, PencilDefs, Logo, teeTintFor, PencilRing, GhostGlyph } from "./theme.jsx";
/* v22.8: Brett's last five scorecards (differential floor + History ledger rows). */
import { SEED_ROUNDS, historyRows } from "./seedRounds.js";
/* Caddie (S3a, v22): the map layer. The profile is bundled, never fetched (addendum §11.1). */
import { fetchGeometry } from "./geometry.js";
import { buildHole, frameOf, detectHole, needsNineMap, nineMapCandidates, saveNineMap, loadNineMap, loadGeometryCache, saveGeometryCache, inferLie, ll,
  nineMapFromRouting, playFromRouting, ninesAssociation, guessPlay, coverageCheck } from "./caddie/geo.js";
/* v22.7: clubs with more than 18 holes — one picker row per club, the nines chosen on Setup. */
import { groupResultsByClub, clubKeyOf, routingLabel, routingNines, splitTee27, nineCombos, teeForCombo, loadLastRouting, saveLastRouting, defaultRoutingIndex,
  normalizeStrokeIndex, localNineCombos, localCombo, localCardHoles, localRoutingFor, apiTeeNamed } from "./routing.js";
import { localClubFor } from "./localCards.js";
import { loadProfile, resolveEntry } from "./caddie/profile.js";
import { MapLayer, useSatellite, prefetchTiles, satelliteCheck, TILE_PREFETCH_ENABLED, renderNodes } from "./caddie/mapLayer.jsx";
/* Caddie (S3b, v22): the engine, its inputs and the screen's state + render model. */
import { assembleShotContext, frameBearing } from "./caddie/context.js";
import { recommend, windEffect } from "./caddie/engine.js";
import { fetchWeather, weatherRefreshDue, weatherTempF } from "./caddie/sensors.js";
import {
  loadLieOverrides, recordLieOverride, routeShot, newShotRecord, quickLog, detailLog, skipShot, closeOutShot,
  saveShot, loadShots, allShots, exportShots, importShots, newPuttRecord, quickMade, PUTT_AXES, bareShotRecord,
  autoShotRecord, shotIntent, curveReadback, resultText, deleteShot, bearingInFrame, normIntent,
} from "./caddie/shotlog.js";
/* v22.15 shot log v2: the hole's story at the score (docs/SPEC-shotlog-v2.md §4, §5). */
import { holeReview, reviewNeeded, splitHole, placeShot, recomputeChain, setShotIntent, lineFromTap, deleteStroke, renumber, inferredPutts, reviewAll } from "./caddie/review.js";
import { satelliteCheckLine, fallbackMapModel, fitBounds, cameraFor, linearProjector } from "./caddie/overlay.js";
import { fetchElevationSamples, elevationSamplePoints } from "./caddie/sensors.js";
import { DEFAULT_CONFIG, mergeConfig } from "./caddie/config.js";
import {
  COPY, GPS_TIMEOUT_MS, initialCaddie, caddieReducer, caddieHoleFor, serializeCaddie, restoreCaddie, pinSetting, pinPointFor,
  pinFromMapTap, pickerModel, syntheticHole, clubBrainContext, mapInput, caddieView, defaultNineMap, geometryKeyFor, scorecardOrder, detectedHoleNo,
  clubShort, ellipsesFor, withinRoundCtx, learningOverlays, aggressionModel, pinFromDrag, fakeFix, intentSet,
} from "./caddie/caddieState.js";
/* v22.11: marked-green mode — the caddie on a hole OpenStreetMap does not have. */
import { loadGreens, saveGreen, greenFor, greenSlot, markedGreenHole, markedGreenContext, anchorFrame, toSyntheticFrame, markedEndLie } from "./caddie/greens.js";
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
const BUILD = "v22.15 · Sep 30";

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

/* Flatten tees.male + tees.female into one picker list. 18-hole tees as before; a 27-hole tee
   (v22.7) is kept with its three nines split out (`nines`) — Setup turns it into one tee per
   two-nine combination. Anything else is skipped. */
function teeOptions(fullCourse) {
  const tees = fullCourse.tees || {};
  const out = [];
  ["male", "female"].forEach(gender => {
    const arr = Array.isArray(tees[gender]) ? tees[gender] : [];
    arr.forEach((tee, i) => {
      if (!Array.isArray(tee.holes)) return;
      if (tee.holes.length === 18) out.push({ key: `${gender}:${i}`, gender, tee });
      else if (tee.holes.length === 27) out.push({ key: `${gender}:${i}`, gender, tee, nines: splitTee27(tee) });
    });
  });
  return out;
}
const teeNameOf = (o) => o.tee.tee_name || o.gender;
/* The tees Setup lists for one routing: a 27-hole combination composes each 27-hole tee into
   that 18; an ordinary routing lists its 18-hole tees. */
function teesForRouting(opts, route) {
  if (route && route.combo) {
    return opts.filter(o => o.nines).map(o => {
      const tee = teeForCombo(o.tee, o.nines, route.combo);
      return tee ? { ...o, key: `${o.key}~${route.combo.join("")}`, tee, ratingSource: "27-hole tee" } : null;
    }).filter(Boolean);
  }
  return opts.filter(o => !o.nines);
}
/* A single entry with a 27-hole tee: its three combinations are the routings. */
function combosFor(full, opts) {
  const t27 = opts.find(o => o.nines);
  if (!t27) return [];
  const club = t27.nines.map(n => n.label);
  return nineCombos(t27.nines).map(k => ({ key: `c:${k.combo.join("")}`, id: full.id, combo: k.combo, label: k.label, nines: k.nines, club }));
}

/* Total yardage of a tee option — summed from its holes (the API's own total is
   not always present). Shown under each tee marker on Setup. */
const teeYards = (opt) => (opt.tee.holes || []).reduce((a, h) => a + (h.yardage || 0), 0);

/* Build the engine course object from a full course + a chosen tee option.
   Field mapping (do NOT rename): handicap->si, yardage->yards, course_rating->rating,
   slope_rating->slope, par_total->par. */
function buildCourse(fullCourse, teeOpt, club) {
  const t = teeOpt.tee;
  const name = fullCourse.club_name || fullCourse.course_name || "Course";
  const loc = fullCourse.location || {};
  const c = {
    id: `${fullCourse.id}:${teeOpt.key}`,
    apiId: fullCourse.id,
    lat: typeof loc.latitude === "number" ? loc.latitude : undefined,
    lon: typeof loc.longitude === "number" ? loc.longitude : undefined,
    name,
    tee: t.tee_name || teeOpt.gender,
    rating: t.course_rating,
    slope: t.slope_rating,
    par: t.par_total,
    // v22.12: a routing whose two nines are each handicapped 1–9 gets the odd/even rule, so no
    // stroke index appears twice (routing.js normalizeStrokeIndex; 1–18 is left as it is)
    holes: normalizeStrokeIndex(t.holes).map(h => ({ par: h.par, si: h.handicap, yards: h.yardage })),
  };
  /* v22.7 — clubs with more than 18 holes. clubApiId keys the club-level map (geometry cache,
     tile prefetch, nine map); routing is the pill's label ("Village / School"); nines is what the
     caddie's nine map reads: { play: [first, second], club: [all nines], ordered }. */
  if (club && club.clubApiId != null && (club.route || String(club.clubApiId) !== String(fullCourse.id))) c.clubApiId = club.clubApiId;
  if (club && club.route) {
    c.routing = club.route.label;
    if (Array.isArray(club.route.nines)) c.nines = { play: club.route.nines, club: club.route.club || club.route.nines, ordered: !!club.route.combo };
  }
  if (teeOpt.ratingSource) c.ratingSource = teeOpt.ratingSource;
  return c;
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
/* The club's key for everything that is one per club, not one per routing: the OSM geometry, the
   tile prefetch and the nine map. An 18-hole course has no clubApiId, so this is its apiId. */
const clubIdOf = (course) => course?.clubApiId ?? apiIdOf(course);
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
/* { geometry, phase: none | loading | ready | network-error | no-holes | partial | unavailable, done, total, retry }
   v22.8: "unavailable" used to cover three different failures with one copy line. Split:
   - the Overpass fetch itself threw or timed out             -> network-error (retryable)
   - it answered but coverageCheck found NO holes at all      -> no-holes (not retryable — OSM just
     doesn't have this course; retrying the same query won't change that)
   - it answered with SOME but not all 18 holes               -> partial (retryable — a wider/second
     Overpass mirror can fill in what the first one missed)
   - no anchor (lat/lon) to even query from                   -> unavailable, unchanged (nothing to retry) */
function useCourseMap(course) {
  const apiId = clubIdOf(course);                     // per club: switching routings never refetches
  const [geometry, setGeometry] = useState(() => (apiId != null ? loadGeometryCache(safeStorage(), apiId) : null));
  const [st, setSt] = useState({ phase: "none", done: 0, total: 0 });
  const [retryTick, setRetryTick] = useState(0);
  const forceRefetch = React.useRef(false);
  const retry = () => { forceRefetch.current = true; setRetryTick((t) => t + 1); };
  useEffect(() => {
    if (apiId == null) { setGeometry(null); setSt({ phase: "none", done: 0, total: 0 }); return undefined; }
    let live = true;
    const force = forceRefetch.current; forceRefetch.current = false;
    let g = force ? null : loadGeometryCache(safeStorage(), apiId);
    setGeometry(g);                                   // never show the previous course's holes
    (async () => {
      if (!g) {
        const anchor = courseAnchor(course);
        if (!anchor) { setGeometry(null); setSt({ phase: "unavailable", done: 0, total: 0 }); return; }
        setSt({ phase: "loading", done: 0, total: 18 });
        try {
          const parsed = await fetchGeometry(anchor.lat, anchor.lon);
          // §6.5 / D23: sample elevation once per course at geometry-fetch time, cached alongside
          // it. Best-effort and silent — offline (or Open-Meteo unreachable) leaves elevation
          // absent and the caddie's elevationDeltaYds falls back to 0 (context.js), never throws.
          let elevation = null;
          if (typeof fetch !== "undefined") {
            try {
              const pts = elevationSamplePoints(parsed);
              if (pts.length) {
                const res = await fetchElevationSamples(pts, fetch);
                if (res && res.samples && res.samples.some((s) => s.elevM != null)) elevation = res.samples;
              }
            } catch (e2) { /* silent — elevation is a nice-to-have */ }
          }
          saveGeometryCache(safeStorage(), apiId, parsed, elevation);
          g = loadGeometryCache(safeStorage(), apiId) || parsed;
        } catch (e) {
          if (live) { setGeometry(null); setSt({ phase: "network-error", done: 0, total: 0 }); }
          return;
        }
      }
      if (!live) return;
      setGeometry(g);
      const cov = coverageCheck(g, { expected: [...Array(18)].map((_, i) => i + 1) });
      const mapped = 18 - cov.missing.filter((k) => Number.isInteger(k) || /^\d+$/.test(String(k))).length;
      if (mapped <= 0) { setSt({ phase: "no-holes", done: 0, total: 18 }); return; }
      if (mapped < 18) { setSt({ phase: "partial", done: mapped, total: 18 }); return; }
      if (!TILE_PREFETCH_ENABLED || typeof caches === "undefined") { setSt({ phase: "ready", done: mapped, total: mapped }); return; }
      setSt({ phase: "loading", done: 0, total: mapped });
      await prefetchTiles(g, { isLive: () => live, onProgress: (p) => setSt({ phase: "loading", done: p.holesDone, total: p.holes }) }).catch(() => null);
      // Tiles that did not come down are not an error: the caddie draws the map from the geometry (§4.3).
      if (live) setSt({ phase: "ready", done: mapped, total: mapped });
    })();
    return () => { live = false; };
  }, [apiId, retryTick]);
  return { geometry: apiId != null ? geometry : null, ...st, retry };
}
/* Addendum §10.1 copy, split per failure (v22.8) so Brett knows whether tapping can help. */
const courseMapLine = (m) => !m || m.phase === "none" ? null
  : m.phase === "ready" ? "Course map ready"
  : m.phase === "loading" ? `Course map · loading ${m.done} of ${m.total || 18}`
  : m.phase === "network-error" ? "Course map · could not reach the map server · tap to retry"
  : m.phase === "no-holes" ? "No course map. Satellite on GPS — mark each green on the tee."
  : m.phase === "partial" ? `Course map · ${m.done} of ${m.total || 18} holes mapped · tap to retry`
  : "Course map unavailable · caddie will use yards";
const courseMapRetryable = (m) => !!m && (m.phase === "network-error" || m.phase === "partial");


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
/* Brett's official last-5 (GHIN), so the app starts calibrated instead of cold. These seed the
   differential ONLY — they are not match records, so they never touch the W-L-T. Each in-app
   round played pushes one further out of the window; once five newer rounds exist these stop
   counting on their own. v22.8: full scorecards, not just gross — see src/seedRounds.js. */

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
  // A seed and a round logged in Loop on the same calendar day are the same round: keep the seed
  // (the official differential) so the round is never counted twice.
  const seedDays = new Set(recs.filter(x => x.seed).map(x => x.d.toDateString()));
  for (let i = recs.length - 1; i >= 0; i--) if (!recs[i].seed && seedDays.has(recs[i].d.toDateString())) recs.splice(i, 1);
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
  // v22.7: the nines played at a club with more than 18 holes. Only when there is one — Firestore
  // rejects an undefined field, and old records simply don't have it.
  if (typeof course.routing === "string" && course.routing) rec.routing = course.routing;
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
  /* v22.7: one row per club. A 27-hole club comes back as one result per routing sharing a
     club_name; they fold into one row and the nines are chosen on Setup. */
  const displayed = useMemo(() => {
    const clubs = groupResultsByClub(results);
    if (!homeState) return clubs.slice(0, CAP);
    return [...clubs.filter(r => stateOf(r) === homeState), ...clubs.filter(r => stateOf(r) !== homeState)].slice(0, CAP);
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
        {searchState === "done" && displayed.map(g => {
          const r = g.entries[0], many = g.entries.length > 1;
          return (
            <button key={g.key} data-club={g.key} onClick={() => onPick(g)} style={{ display: "block", width: "100%", textAlign: "left",
              padding: "11px 0", background: "none", border: "none", borderBottom: hairline, color: T.ink }}>
              <div style={{ fontFamily: F.hand, fontSize: 24, lineHeight: "24px", color: T.pencil, filter: "url(#pencil)" }}>{g.club_name || r.course_name}</div>
              <div style={{ fontFamily: F.label, fontSize: 11, color: T.muted, marginTop: 2 }}>
                {[!many && r.course_name && r.course_name !== r.club_name ? r.course_name : null,
                  g.location && [g.location.city, g.location.state].filter(Boolean).join(", "),
                  localClubFor(g.club_name, g.location) ? "3 nines" : many ? `${g.entries.length} routings` : null].filter(Boolean).join(" · ")}
              </div>
            </button>
          );
        })}
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

/* The nines of every routing of a club, in first-seen order ("Village/School", "Mill/School" → Village, School, Mill). */
function clubNinesOf(routes) {
  const out = [];
  routes.forEach(r => (r.nines || []).forEach(n => { if (!out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n); }));
  return out;
}

/* v22.12 — Setup's Satellite check (Ironwood, Sep 29: the satellite never appeared and nothing said
   why). Once per course chosen: MapLibre loads and one z17 tile at the course's location comes
   back through fetch (8 s). The line says Satellite ready or exactly which part failed; tap re-runs.
   Component state only — the caddie re-derives its own reason at the ball (useSatellite). */
function useSatelliteCheck(course) {
  const anchor = course ? courseAnchor(course) : null;
  const k = !course ? null : anchor ? `${anchor.lat.toFixed(4)},${anchor.lon.toFixed(4)}` : "none";
  const [res, setRes] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (k == null) { setRes(null); return undefined; }
    let live = true;
    setRes({ running: true });
    satelliteCheck(anchor).then((r) => { if (live) setRes(r); }).catch(() => { if (live) setRes({ lib: false, tile: null, noLocation: !anchor }); });
    return () => { live = false; };
  }, [k, tick]);
  const failed = !!res && !res.running && (res.lib === false || res.noLocation || (res.tile && res.tile.ok === false));
  return { line: satelliteCheckLine(res), failed, running: !!res?.running, rerun: () => setTick((t) => t + 1) };
}

/* v22.12 — a club with a verified local card (src/localCards.js): its tees for two nines played in
   order, built from the card (pars, yards, odd/even stroke index) with rating and slope from the
   API routing that has both nines (else the club's first routing), by tee name. A card tee the API
   has no rating for is not offered: the ghost needs rating and slope. */
function localTeeOptions(card, combo, full, srcLabel) {
  return card.tees.map((name) => {
    const api = apiTeeNamed(full, name);
    if (!api || !Number.isFinite(api.tee.course_rating) || !Number.isFinite(api.tee.slope_rating)) return null;
    const holes = localCardHoles(card, combo, name);
    if (!holes) return null;
    return { key: `local:${combo.join("")}:${name}`, gender: api.gender, ratingSource: `API · ${srcLabel}`,
      tee: { tee_name: name, course_rating: api.tee.course_rating, slope_rating: api.tee.slope_rating, par_total: holes.reduce((a, h) => a + h.par, 0), holes } };
  }).filter(Boolean);
}

function Setup({ course, setCourse, diff, setDiff, stats, history, onStart, onHistory, courseMap, testMode = false, setTestMode }) {
  // v22.15 §1: long-press (~700 ms) the build tag for the Test mode sheet
  const [testOpen, setTestOpen] = useState(false);
  const pressT = React.useRef(null);
  const pressStart = () => { clearTimeout(pressT.current); pressT.current = setTimeout(() => setTestOpen(true), 700); };
  const pressEnd = () => clearTimeout(pressT.current);
  const [picking, setPicking] = useState(false);
  const [club, setClub] = useState(null);                 // v22.7: the picked club { key, club_name, clubApiId, entries }
  const [routings, setRoutings] = useState([]);           // its routings (entries or 27-hole combinations)
  const [routingKey, setRoutingKey] = useState("");
  const [selectedFull, setSelectedFull] = useState(null);
  const [tees, setTees] = useState([]);
  const [teeKey, setTeeKey] = useState("");
  const [loadState2, setLoadState2] = useState("idle");   // idle | loading | error
  const [local, setLocal] = useState(null);               // v22.12: the club's local card, when it has one
  const [localPick, setLocalPick] = useState([0, 1]);     // …and the two nines chosen off it, in play order
  const satCheck = useSatelliteCheck(course);
  const retry = React.useRef(null);
  const seq = React.useRef(0);                            // a late load for an earlier tap never wins

  /* One routing: fetch its full course (cached after the first time), list its tees, keep the
     tee name already chosen when this routing has it. No route = a single-entry club, which may
     turn out to carry a 27-hole tee — then its three combinations become the routings. */
  const showRouting = (c, routes, route, keepName) => {
    const my = ++seq.current;
    retry.current = () => showRouting(c, routes, route, keepName);
    setRoutingKey(route ? route.key : ""); setCourse(null); setTeeKey(""); setLoadState2("loading");
    loadFullCourse(route ? route.id : c.entries[0].id)
      .then(full => {
        if (my !== seq.current) return;
        const opts = teeOptions(full);
        let rs = routes, r = route;
        if (!rs.length || (r && r.combo)) {
          const combos = combosFor(full, opts);
          if (combos.length) {
            rs = combos;
            if (!r) r = combos[defaultRoutingIndex(combos, loadLastRouting(safeStorage(), c.key))];
            setRoutings(combos); setRoutingKey(r.key);
          }
        }
        const list = teesForRouting(opts, r);
        setSelectedFull(full); setTees(list); setLoadState2("idle");
        if (list.length) {
          const keep = keepName ? list.find(o => teeNameOf(o) === keepName) : null;
          pickTee((keep || defaultTee(list, full, history)).key, list, full, c, r);
        }
      })
      .catch(() => { if (my === seq.current) { setSelectedFull(null); setTees([]); setLoadState2("error"); } });
  };
  /* v22.12: a local card replaces the API's routings with First nine / Second nine. The API is still
     read — for the rating and slope, from the routing that has both nines (either order). */
  const showLocal = (c, card, combo, keepName) => {
    const my = ++seq.current;
    retry.current = () => showLocal(c, card, combo, keepName);
    const nines = combo.map(i => card.nines[i].label);
    const route = { key: `l:${combo.join("")}`, label: nines.join(" / "), nines, club: card.nines.map(x => x.label), combo, local: true };
    setLocalPick(combo); setRoutings([route]); setRoutingKey(route.key); setCourse(null); setTeeKey(""); setLoadState2("loading");
    const src = localRoutingFor(c.entries, nines) || c.entries[0];
    loadFullCourse(src.id)
      .then(full => {
        if (my !== seq.current) return;
        const rn = routingNines(src);
        const list = localTeeOptions(card, combo, full, rn ? rn.join("/") : routingLabel(src));
        setSelectedFull(full); setTees(list); setLoadState2("idle");
        if (list.length) {
          const keep = keepName ? list.find(o => teeNameOf(o).toLowerCase() === String(keepName).toLowerCase()) : null;
          pickTee((keep || defaultTee(list, full, history)).key, list, full, c, route);
        }
      })
      .catch(() => { if (my === seq.current) { setSelectedFull(null); setTees([]); setLoadState2("error"); } });
  };
  const pickLocalNine = (slot, i) => {
    if (!local || !club || localPick[slot] === i) return;
    const next = [...localPick];
    if (next[1 - slot] === i) next[1 - slot] = next[slot];   // picking the other slot's nine swaps them
    next[slot] = i;
    const cur = tees.find(o => o.key === teeKey);
    showLocal(club, local, next, cur ? teeNameOf(cur) : (course && course.tee));
  };
  const pickClub = (group) => {
    setPicking(false);
    setCourse(null); setTees([]); setTeeKey(""); setSelectedFull(null); setRoutings([]); setRoutingKey("");
    const last = loadLastRouting(safeStorage(), group.key);
    // sticky: the id this club's map was first cached under, even if a later search misses that routing
    const c = { ...group, clubApiId: last && last.clubApiId != null ? last.clubApiId : group.clubApiId };
    setClub(c);
    const card = localClubFor(group.club_name, group.location);
    setLocal(card);
    if (card) {
      showLocal(c, card, (last && localCombo(card, last.label)) || [0, 1], null);
      return;
    }
    if (group.entries.length > 1) {
      const base = group.entries.map(e => ({ key: `e:${e.id}`, id: e.id, label: routingLabel(e), nines: routingNines(e) }));
      const allNines = clubNinesOf(base);
      const routes = base.map(r => ({ ...r, club: allNines }));
      setRoutings(routes);
      showRouting(c, routes, routes[defaultRoutingIndex(routes, last)], null);
    } else {
      showRouting(c, [], null, null);
    }
  };
  const pickRouting = (key) => {
    const r = routings.find(x => x.key === key);
    if (!r || !club || key === routingKey) return;
    const cur = tees.find(o => o.key === teeKey);
    showRouting(club, routings, r, cur ? teeNameOf(cur) : (course && course.tee));
  };
  const pickTee = (key, optsArg, fullArg, clubArg, routeArg) => {
    const opts = optsArg || tees, full = fullArg || selectedFull, c = clubArg || club;
    const route = routeArg !== undefined ? routeArg : routings.find(x => x.key === routingKey) || null;
    setTeeKey(key);
    const opt = opts.find(o => o.key === key);
    setCourse(opt && full ? buildCourse(full, opt, c ? { clubApiId: c.clubApiId, route } : null) : null);
  };
  /* Start: remember this club's routing (and the key its map is cached under) for next time. */
  const start = () => {
    const route = routings.find(x => x.key === routingKey);
    if (course && club && route && course.routing) {
      saveLastRouting(safeStorage(), club.key, { id: route.combo ? null : route.id, label: route.label, clubApiId: club.clubApiId });
    }
    onStart();
  };

  /* differential is read-only now (behaviour decision §5): last five rounds, no override */
  const auto = useMemo(() => computeAutoDiff(history), [history]);
  useEffect(() => { if (auto) setDiff(auto.diff); }, [auto, setDiff]);
  const g = course ? computeGhost(course, diff) : null;

  const courseName = course ? course.name : selectedFull ? (selectedFull.club_name || selectedFull.course_name) : club ? club.club_name : null;
  /* the NINES row: the club's routings, or — restored from a saved round — the one it was on */
  const nineRow = local ? null : routings.length > 1 ? routings
    : !club && course && course.routing ? [{ key: "saved", label: course.routing }] : null;
  const shownRoutingKey = routings.length > 1 ? routingKey : "saved";
  const parText = course ? course.par : null;
  const yards = course ? course.holes.reduce((a, h) => a + (h.yards || 0), 0) : null;

  return (
    <div style={{ height: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 30px) 20px max(env(safe-area-inset-bottom), 18px)", background: T.paper }}>
      {picking && <CoursePicker onPick={pickClub} onClose={() => setPicking(false)} />}
      {testOpen && (
        <CaddieSheet onClose={() => setTestOpen(false)} label="Test mode">
          <div style={{ ...caps(12), marginBottom: 12 }}>Test mode</div>
          <button data-part="test-fake-gps" role="switch" aria-checked={testMode ? "true" : "false"} onClick={() => setTestMode && setTestMode(!testMode)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, borderTop: rule, borderBottom: rule, background: "transparent", color: T.ink, padding: 0 }}>
            <span style={{ fontFamily: F.label, fontSize: 14, fontWeight: 700 }}>Fake my location</span>
            <span style={{ ...(testMode ? primaryPill : outlinedPill), height: 32, minWidth: 64, padding: "0 14px", borderRadius: 16, fontSize: 10 }}>{testMode ? "On" : "Off"}</span>
          </button>
          <div style={{ fontFamily: F.label, fontSize: 12, lineHeight: 1.45, color: T.ink, margin: "10px 0 14px" }}>
            Every GPS fix in the caddie becomes a tap on its map — I'm on the tee, I'm at my ball, On the green, Mark green here. For trying the caddie off the course; turn it off before a real round.
          </div>
          <button onClick={() => setTestOpen(false)} className="lc-primary" style={{ ...primaryPill, width: "100%", height: 48 }}>{COPY.done}</button>
        </CaddieSheet>
      )}

      {/* the card: double-rule frame, sections evenly spaced between ink rules */}
      <div style={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "space-between",
        border: rule, boxShadow: `inset 0 0 0 3px ${T.paper}, inset 0 0 0 4px ${T.ink}`, padding: "20px 22px 18px" }}>

        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span data-part="build-tag" onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd} onContextMenu={(e) => e.preventDefault()}
            style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "baseline", gap: 6, ...caps(9, 700, "0.04em"), color: T.muted, whiteSpace: "nowrap",
              padding: "6px 0 6px 10px", marginTop: -6, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", touchAction: "manipulation" }}>
            {testMode && <span data-part="test-tag" style={{ ...writtenWord(20), lineHeight: "10px", letterSpacing: "0.04em", textTransform: "none" }}>TEST</span>}
            {BUILD}
          </span>
          <Logo width={168} />
          <div style={doubleRule} />
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

        {/* v22.7 nines — a club with more than 18 holes: one outlined pill per routing, the chosen
            one primary. Two nines stack on two lines so three routings fit at 375 wide. */}
        {nineRow && (
          <div data-row="nines" style={{ display: "grid", gridTemplateColumns: "66px 1fr", alignItems: "center", height: 54, borderBottom: rule }}>
            <span style={caps(11)}>Nines</span>
            <div style={nineRow.length <= 3
              ? { display: "grid", gridTemplateColumns: `repeat(${nineRow.length}, minmax(0, 1fr))`, gap: 5 }
              : { display: "flex", gap: 5, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
              {nineRow.map(r => {
                const sel = r.key === shownRoutingKey;
                const parts = String(r.label).length > 9 ? String(r.label).split(" / ") : [r.label];   // "1 / 2" stays on one line
                return (
                  <button key={r.key} onClick={() => pickRouting(r.key)} aria-pressed={sel ? "true" : "false"} aria-label={`Nines ${r.label}`}
                    className={sel ? "lc-primary" : undefined}
                    style={{ ...(sel ? primaryPill : outlinedPill), ...(nineRow.length > 3 ? { flex: "0 0 74px" } : { minWidth: 0 }),
                      height: 40, borderRadius: 20, padding: "0 4px", flexDirection: "column", gap: 0, ...caps(9, 700, "0.06em"), lineHeight: "12px" }}>
                    {parts.length === 2
                      ? <><span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts[0]} /</span>
                          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts[1]}</span></>
                      : <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* v22.12 local card — First nine / Second nine over the card's three nines, any order.
            The chosen nine in each row is the primary pill; picking the other row's nine swaps them. */}
        {local && (
          <div data-row="nines-local" style={{ display: "grid", gridTemplateColumns: "66px 1fr", alignItems: "center", rowGap: 6, padding: "7px 0", borderBottom: rule }}>
            {[["First", 0], ["Second", 1]].map(([word, slot]) => (
              <React.Fragment key={word}>
                <span style={{ ...caps(10), lineHeight: "12px" }}>{word}<br />nine</span>
                <div role="group" aria-label={`${word} nine`} style={{ display: "grid", gridTemplateColumns: `repeat(${local.nines.length}, minmax(0, 1fr))`, gap: 5 }}>
                  {local.nines.map((x, i) => {
                    const sel = localPick[slot] === i;
                    return (
                      <button key={x.label} onClick={() => pickLocalNine(slot, i)} aria-pressed={sel ? "true" : "false"} aria-label={`${word} nine ${x.label}`}
                        className={sel ? "lc-primary" : undefined}
                        style={{ ...(sel ? primaryPill : outlinedPill), minWidth: 0, height: 34, borderRadius: 17, padding: "0 4px", ...caps(10, 700, "0.08em") }}>
                        {x.label}
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* tee markers — yardage under each; the selected one is circled in pencil */}
        <div style={{ display: "grid", gridTemplateColumns: "66px 1fr", alignItems: "center", height: 74, borderBottom: rule }}>
          <span style={caps(11)}>Tee</span>
          {loadState2 === "loading" ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>Loading course…</span>
          : loadState2 === "error" ? <button onClick={() => retry.current && retry.current()} style={{ fontFamily: F.label, fontSize: 11, color: T.double, background: "none", border: "none", textAlign: "left", padding: 0 }}>Couldn't load — tap to retry.</button>
          : tees.length === 0 && selectedFull ? <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>{local ? "No rated tees for these nines in the course data." : "No 18-hole tees for this course."}</span>
          : tees.length === 0 && course ? (
            /* restored from a saved round: the tee list was never fetched, so show
               the tee that round was on rather than asking for a course again */
            <div style={{ display: "flex", alignItems: "center", gap: 3, height: 58 }}>
              <span style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, width: 66, height: 58 }}>
                {(() => { const t = teeTintFor(course.tee, 0); return (
                  <span style={{ width: 14, height: 14, borderRadius: 7, background: t === "PAPER" ? T.paper : t,
                    border: t === "PAPER" ? `1.5px solid ${T.ink}` : "none" }} />
                ); })()}
                <span style={{ fontSize: 11, fontWeight: 700 }}>{course.tee}</span>
                <span style={printed(11, 400)}>{yards ? yards.toLocaleString() : ""}</span>
                <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 58, overflow: "visible" }} viewBox="0 0 66 58" preserveAspectRatio="none" fill="none" aria-hidden="true">
                  <PencilRing cx={33} cy={29} rx={29} ry={26} seedKey={course.tee || "restored"} />
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
                const sel = o.key === teeKey, name = o.tee.tee_name || o.gender, tint = teeTintFor(name, i);
                return (
                  <button key={o.key} onClick={() => pickTee(o.key)} style={{ position: "relative",
                    ...(tees.length > 5 ? { flex: "0 0 58px" } : { minWidth: 0 }),
                    height: 58, border: "none", background: "transparent", color: T.ink, fontFamily: F.label,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 0 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 7, background: tint === "PAPER" ? T.paper : tint,
                      border: tint === "PAPER" ? `1.5px solid ${T.ink}` : "none" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    <span style={printed(11, 400)}>{teeYards(o).toLocaleString()}</span>
                    {sel && (
                      <svg style={{ position: "absolute", left: 0, top: 0, width: "100%", height: 58, overflow: "visible" }} viewBox="0 0 66 58" preserveAspectRatio="none" fill="none" aria-hidden="true">
                        <PencilRing cx={33} cy={29} rx={29} ry={26} seedKey={o.key} />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* rating / slope / yards — v22.12: when the rating is not the chosen routing's own (a local
            card, a 27-hole tee) a small line under it says where it came from */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: course && course.ratingSource ? 66 : 56, borderBottom: rule }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1px 1fr 1px 1fr", alignItems: "center" }}>
            {[["Rating", course ? course.rating : "—"], ["Slope", course ? course.slope : "—"], ["Yards", yards ? yards.toLocaleString() : "—"]]
              .flatMap(([k, v], i) => [
                <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1 }}>
                  <span style={caps(10)}>{k}</span>
                  <span style={{ ...printed(19), color: course ? T.ink : T.muted }}>{v}</span>
                </div>,
                i < 2 ? <div key={k + "d"} style={{ width: 1, height: 30, background: T.hair }} /> : null,
              ]).filter(Boolean)}
          </div>
          {course && course.ratingSource && (
            <span data-testid="rating-source" style={{ fontFamily: F.label, fontSize: 10, color: T.ink, textAlign: "center", lineHeight: "12px", marginTop: 3 }}>rating from {course.ratingSource}</span>
          )}
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
          <button onClick={start} disabled={!course} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
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
          {/* course-map prefetch (addendum §11.2) — one line, Bitter 11 ink. A network-error or
              partial-coverage line is tap-to-retry (v22.8); the others are plain status. */}
          {course && courseMapLine(courseMap) && (
            courseMapRetryable(courseMap) ? (
              <button onClick={courseMap.retry} data-testid="course-map-status" style={{ fontFamily: F.label, fontSize: 11, color: T.ink,
                lineHeight: "14px", marginTop: -4, background: "none", border: "none", padding: 0, textAlign: "center" }}>{courseMapLine(courseMap)}</button>
            ) : (
              <span data-testid="course-map-status" style={{ fontFamily: F.label, fontSize: 11, color: T.ink, lineHeight: "14px", marginTop: -4 }}>{courseMapLine(courseMap)}</span>
            )
          )}
          {/* v22.12 Satellite check — same role as the course-map line; tap to run it again */}
          {course && satCheck.line && (
            <button onClick={satCheck.running ? undefined : satCheck.rerun} data-testid="satellite-check" aria-label={`${satCheck.line}. Tap to check again.`}
              style={{ fontFamily: F.label, fontSize: 11, color: satCheck.failed ? T.double : T.ink, lineHeight: "14px", marginTop: 2,
                background: "none", border: "none", padding: 0, textAlign: "center" }}>{satCheck.line}</button>
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

/* v22.9 — the chooser is a strip of every score from 1 to min(15, par + 10), five in view,
   snapping to a centred cell. It replaces the five fixed options and the long-press past
   par+2: the USGA cap is par + 2 + strokes received, so on a stroked hole par+2 is below
   your legal maximum, and the strip simply runs past it. A score already on the card that
   lies above the range (an old long-press 15 on a par 3) stretches the strip to reach it. */
const SCORE_MAX = 15;
function scoreOptions(par, keep) {
  const top = Math.max(Math.min(SCORE_MAX, par + 10), Number.isFinite(keep) ? keep : 0);
  return Array.from({ length: top }, (_, k) => k + 1);
}

/* A number written in pencil, with the shapes a scorecard puts round it (PencilMark's
   shapes, at chooser size), all in pencil (v22.14). One tap makes it pending (a pencilled X
   through the cell); a second commits. No pointer handlers: the strip scrolls natively, so a swipe never taps. */
function ScoreChoice({ v, par, pending, onTap }) {
  const d = v - par;
  const S = 52;
  return (
    <button onClick={() => onTap(v)} data-score={v}
      aria-label={`${scoreName(v, par)}, ${v}${pending ? ", tap again to confirm" : ""}`}
      style={{ position: "relative", flexShrink: 0, width: S, height: S, padding: 0, border: "none", background: "transparent",
        fontFamily: F.handNum, fontSize: 25, color: T.pencil, filter: "url(#pencil)", userSelect: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}>
      <MarkShapes d={d} size={S} color={T.pencil} sw={1.4} font={25} digits={String(v).length} />
      <span style={{ position: "relative" }}>{v}</span>
      {pending && <PencilX size={S} seed={v} filtered={false} />}
    </button>
  );
}

/* The strip itself. Five cells of 20% each, with two cells' worth of blank at either end so
   1 and the top score can both reach the centre; the scroll offset of a centred score is
   therefore (score - 1) cells. Positioned on entering a hole — on the written score, else
   the pending one, else par — and left alone after that; nothing about it is persisted. */
function ScoreStrip({ hole, par, focus, pend, onTap }) {
  const ref = React.useRef(null);
  const opts = scoreOptions(par, focus);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = (focus - 1) * (el.clientWidth / 5);
  }, [hole, par]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="lc-strip" data-part="chooser" role="group" aria-label={`Score for hole ${hole + 1}`}
      style={{ display: "flex", width: "100%", overflowX: "auto", overflowY: "hidden", scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain", touchAction: "pan-x", scrollbarWidth: "none" }}>
      <div aria-hidden="true" style={{ flex: "0 0 40%" }} />
      {opts.map((v) => (
        <div key={v} style={{ flex: "0 0 20%", display: "flex", justifyContent: "center", scrollSnapAlign: "center" }}>
          <ScoreChoice v={v} par={par} pending={pend === v} onTap={onTap} />
        </div>
      ))}
      <div aria-hidden="true" style={{ flex: "0 0 40%" }} />
    </div>
  );
}
const STRIP_CSS = `.lc-strip::-webkit-scrollbar{display:none}`;

/* One nine as a ruled strip: hole numbers, your line, the ghost's line.
   Cells carry the hole's result as a fill; the hole you are on is yellow. Your scores carry
   the finished card's rings and boxes (v22.9), so the two cards speak the same language. */
function Strip({ start, scores, ghost, pars, hole, onJump }) {
  const idx = [...Array(9)].map((_, k) => start + k);
  const rows = [
    { key: "", h: 22, get: (i) => String(i + 1), style: { ...printed(12), color: T.ink }, under: T.ink },
    { key: "you", h: 30, get: (i) => scores[i] != null ? <PencilMark score={scores[i]} par={pars[i]} size={27} font={16} /> : "", style: written(17), under: T.hair },
    { key: "gh.", label: <GhostGlyph size={12} />, h: 30, get: (i) => ghost.holes[i], style: written(17, T.ghost), under: T.ink },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "34px repeat(9, minmax(0, 1fr))", borderTop: rule, borderLeft: rule }}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <div style={{ display: "flex", alignItems: "center", height: r.h, paddingLeft: 4, borderRight: rule,
            borderBottom: `1px solid ${r.under}`, fontFamily: F.label, fontSize: 10 }}>{r.label || r.key}</div>
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

/* One side of the Out / In / Total line (v22.9): the label, your strokes in pencil, the ghost
   glyph and its strokes in print. Blank until a hole on that side is written. */
function SideTotal({ label, t }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", color: t ? T.ink : T.muted }}>
      <span style={caps(10, 400, "0.14em")}>{label}</span>
      {t ? <>
        <span style={{ ...written(23), lineHeight: "22px" }}>{t.you}</span>
        <GhostGlyph size={12} style={{ marginLeft: 3 }} />
        <span style={{ ...printed(20), color: T.ink, lineHeight: "22px" }}>{t.gh}</span>
      </> : <span style={{ ...writtenWord(17, T.muted), lineHeight: "22px" }}>open</span>}
    </div>
  );
}

function Play({ course, ghost, scores, setScores, hole, setHole, onFinish, onExit, onCaddie, onScored, reviewInfo, onReview }) {
  const [confirmExit, setConfirmExit] = useState(false);
  const [pending, setPending] = useState(null);          // { hole, v } — chosen, not written
  const m = useMemo(() => evalMatch(scores, ghost.holes), [scores, ghost]);
  const h = course.holes[hole];
  const par = h.par;
  const pend = pending && pending.hole === hole ? pending.v : null;

  useEffect(() => { setPending(null); }, [hole]);

  /* Write the number down. No navigation — the callers decide where to go. */
  const write = (v) => {
    const after = [...scores]; after[hole] = Math.max(1, v);
    setScores(after);
    setPending(null);
    return after;
  };

  /* Leaving a hole CONFIRMS a pending score rather than throwing it away: tapping a
     number and then Hole N+1 is the same as tapping the number twice. Discarding
     loses a real score silently; a wrong one can be retapped. */
  const goHole = (i) => {
    if (i === hole) return;
    if (pend != null) {
      const after = write(pend);
      // v22.15 §4: a score written by leaving the hole opens the Review sheet too; the move waits for it
      if (onScored && scores[hole] == null && onScored(hole + 1, after[hole], i)) return;
    }
    setHole(i);
  };

  const commit = (v) => {
    const before = scores;
    const after = write(v);
    /* Hole 18 written and nothing left blank -> the round is over (decision 4). */
    const blanksBefore = before.reduce((a, s, i) => a + (s == null && i !== hole ? 1 : 0), 0);
    const finish = blanksBefore === 0 && before[hole] == null;
    const nextBlank = after.findIndex((s, i) => s == null && i > hole);
    const next = finish ? "finish" : nextBlank !== -1 ? nextBlank : hole < 17 ? hole + 1 : null;
    /* v22.15 §4: the hole's story first when it needs a look — the Review sheet moves on when it closes */
    if (onScored && onScored(hole + 1, after[hole], next)) return;
    if (finish) { onFinish(after); return; }
    if (next != null) setHole(next);
  };
  const rv = scores[hole] != null && reviewInfo ? reviewInfo(hole + 1) : null;
  const tap = (v) => { if (pend === v) commit(v); else setPending({ hole, v }); };
  /* Leaving for the caddie is navigation too: a pending score is written, never dropped. */
  const goCaddie = () => { if (pend != null) write(pend); if (onCaddie) onCaddie(); };

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
  const pars = course.holes.map((x) => x.par);
  /* Out / In / Total: your strokes in pencil, the ghost's in print, like for like — the
     ghost's figure counts only the holes you have written, so the two can be compared. */
  const sideTotals = (a, b) => scores.slice(a, b).some((s) => s != null) ? { you: played(a, b), gh: ghPlayed(a, b) } : null;

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
        <div style={{ display: "flex", alignItems: "center", height: 42, paddingLeft: 6, borderRight: rule, borderBottom: hairline, ...caps(10, 700, "0.12em") }}><GhostGlyph size={14} /></div>
        {segHoles.map((i, k) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 42,
            borderRight: `1px solid ${k === 2 ? T.ink : T.hair}`, borderBottom: hairline, ...written(21, T.ghost) }}>{ghost.holes[i]}</div>
        ))}
        <div style={{ display: "flex", alignItems: "center", height: 42, paddingLeft: 6, borderRight: rule, borderBottom: rule, ...caps(10, 700, "0.12em") }}>You</div>
        {segHoles.map((i, k) => {
          const showPend = i === hole && pend != null && scores[i] == null;
          const val = scores[i] != null ? scores[i] : showPend ? pend : null;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 42,
              borderRight: `1px solid ${k === 2 ? T.ink : T.hair}`, borderBottom: rule }}>
              <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36 }}>
                {val != null && <PencilMark score={val} par={course.holes[i].par} size={36} font={21} />}
                {showPend && <PencilX size={36} seed={pend} />}
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
            {/* v22.15 §4: a finished hole with a shot story reopens its Review sheet */}
            {rv && onReview && (
              <button data-part="review-button" onClick={() => onReview(hole + 1)}
                style={{ marginTop: 2, height: 22, padding: "0 8px", background: "none", border: "none", color: T.ink, ...caps(9, 700, "0.14em") }}>
                {COPY.review}{rv.unreviewed > 0 && <span style={{ ...printed(12), color: T.bogey, letterSpacing: 0 }}> ?</span>}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={caps(9, 400, "0.14em")}>You</span>
            <span style={{ width: 44, height: 44, border: rule, background: T.yellow, display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative", ...written(24) }}>
              {scores[hole] != null ? scores[hole] : pend != null ? pend : ""}
              {pend != null && scores[hole] == null && <PencilX size={44} seed={pend} filtered={false} />}
            </span>
          </div>
        </div>

        <div style={{ width: "100%", paddingTop: 6 }}>
          <style dangerouslySetInnerHTML={{ __html: STRIP_CSS }} />
          <ScoreStrip hole={hole} par={par} focus={scores[hole] ?? pend ?? par} pend={pend} onTap={tap} />
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
          <Strip start={0} scores={scores} ghost={ghost} pars={pars} hole={hole} onJump={goHole} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={caps(10)}>In</span>
            <span style={{ fontFamily: F.label, fontSize: 11, color: T.ink, textAlign: "right" }}>
              {back.parts}
              {back.open && <span style={{ color: T.muted }}>{back.open} open</span>}
            </span>
          </div>
          <Strip start={9} scores={scores} ghost={ghost} pars={pars} hole={hole} onJump={goHole} />
        </div>
        <div data-part="totals" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 2 }}>
          <SideTotal label="Out" t={sideTotals(0, 9)} />
          <SideTotal label="In" t={sideTotals(9, 18)} />
          <SideTotal label="Total" t={sideTotals(0, 18)} />
        </div>
      </div>
    </div>
  );
}

/* ---------- caddie (v22: S3a map layer, S3b rail · bar · chips · states) ----------
   Full-bleed map of the hole, the right-edge rail, the bottom bar (addendum §3). The caddie state
   (caddieState.js) lives in App so ‹ Card keeps it and a reload restores it (§9.8, §9.9). Every word
   on this screen comes from caddieView(): it gets the course's hole data, the geometry, the profile
   and the caddie state — no ghost, no match, no scores (engine rule 4, T41). */
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
function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight || 812);
  useEffect(() => {
    const read = () => setH(window.innerHeight || 812);
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return h;
}

/* Runtime tunables: bogeyman-matches:config:v1 merged over DEFAULT_CONFIG (decision 1, Sep 28). */
const CADDIE_CONFIG_KEY = "bogeyman-matches:config:v1";
function loadCaddieConfig() {
  try { const raw = localStorage.getItem(CADDIE_CONFIG_KEY); return mergeConfig(raw ? JSON.parse(raw) : null); } catch (e) { return DEFAULT_CONFIG; }
}
/* v22.15 test mode (SPEC-shotlog-v2 §1): `testMode.fakeGps` in the same config object, read and
   written on its own so the Setup toggle never disturbs any other override stored there. */
function loadTestMode() {
  try { const raw = JSON.parse(localStorage.getItem(CADDIE_CONFIG_KEY) || "null"); return !!(raw && raw.testMode && raw.testMode.fakeGps === true); } catch (e) { return false; }
}
function saveTestMode(on) {
  try {
    const raw = JSON.parse(localStorage.getItem(CADDIE_CONFIG_KEY) || "null");
    const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    cfg.testMode = { ...(cfg.testMode && typeof cfg.testMode === "object" ? cfg.testMode : {}), fakeGps: !!on };
    localStorage.setItem(CADDIE_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) { /* private mode: the toggle holds for this session */ }
}
/* Profile v2 — bundled with the app. null only if the file is malformed (§8 No profile). */
function loadCaddieProfile() { try { return loadProfile(PROFILE_JSON, loadCaddieConfig()); } catch (e) { return null; } }
/* S5 (§5.2–§5.4): Shot Pattern's profile with Loop's between-round overlays merged in by
   resolveEntry. Built from the finished rounds' shots only; P.raw stays Shot Pattern (T32).
   Any failure falls back to the plain profile — learning can never cost Brett his caddie. */
function withLearning(base, history) {
  if (!base) return base;
  try {
    const overlays = learningOverlays(base, allShots(safeStorage()), history, Date.now());
    return overlays ? loadProfile(PROFILE_JSON, base.config, { overlays }) : base;
  } catch (e) { console.warn("learning overlays failed", e); return base; }
}

const CADDIE_RAIL_W = 106, CADDIE_RAIL_EXP = 356;
const CADDIE_CSS = `.lc-rail{transition:width .28s cubic-bezier(.2,.8,.2,1)}
.lc-det{transition:opacity .18s}
@media (prefers-reduced-motion: reduce){.lc-rail,.lc-det{transition:none !important}}
.lc-primary:active{background:${T.inkDark} !important;border-color:${T.inkDark} !important}
.lc-chip:active{background:${T.fillHalf} !important}
.lc-clamp1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-scale:focus{outline:none}
.lc-scale:focus-visible{outline:2px solid ${T.ink};outline-offset:-2px;border-radius:6px}`;

const FlagGlyph = () => (
  <svg width="14" height="18" viewBox="0 0 14 18" fill="none" stroke={T.paper} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={T.yellow} stroke={T.yellow} />
  </svg>
);
const pillBase = { display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 26, ...caps(12, 700, "0.18em") };
const primaryPill = { ...pillBase, gap: 10, background: T.ink, border: `2px solid ${T.ink}`, boxShadow: `inset 0 0 0 1.5px ${T.yellow}`, color: T.paper };
const outlinedPill = { ...pillBase, background: "transparent", border: `2px solid ${T.ink}`, color: T.ink };

/* The bottom sheet (§7.3): paper, 4px double ink top rule, scrim; tap the scrim to close. */
function CaddieSheet({ onClose, children, label }) {
  return (
    <div data-part="sheet" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }}>
      <div role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: T.paper, borderTop: `4px double ${T.ink}`,
        padding: "20px 22px calc(env(safe-area-inset-bottom) + 20px)" }}>
        {children}
      </div>
    </div>
  );
}
const SheetPill = ({ label, current, onClick, style }) => (
  <button onClick={onClick} className={current ? "lc-primary" : undefined} aria-pressed={current ? "true" : "false"}
    style={{ ...(current ? primaryPill : outlinedPill), height: 48, borderRadius: 24, letterSpacing: "0.12em", ...style }}>{label}</button>
);

function ChipPicker({ model, onPick, onInferred, onClose, windDir, setWindDir }) {
  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
  const isWind = model.key === "wind";
  return (
    <CaddieSheet onClose={onClose} label={model.title}>
      <div style={{ ...caps(12), marginBottom: 14 }}>{model.title}</div>
      <div style={grid}>
        {model.options.map((o) => (
          <SheetPill key={String(o.value)} label={o.label} current={isWind ? (windDir ? windDir === o.value : o.current) : o.current}
            onClick={() => (isWind && o.value !== "calm" ? setWindDir(o.value) : onPick(isWind ? { direction: "calm", speed: 0 } : o.value))} />
        ))}
      </div>
      {isWind && (
        <>
          <div style={{ ...caps(9), margin: "14px 0 8px" }}>Speed · mph</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {model.speeds.map((o) => (
              <SheetPill key={o.value} label={o.label} current={o.current} style={{ letterSpacing: 0 }}
                onClick={() => onPick(o.value > 0 ? { direction: windDir || model.options.find((x) => x.current && x.value !== "calm")?.value || "into", speed: o.value } : { direction: "calm", speed: 0 })} />
            ))}
          </div>
        </>
      )}
      {model.note && <div style={{ fontFamily: F.label, fontSize: 11, color: T.ink, marginTop: 10 }}>{model.note}</div>}
      {model.inferredLabel && <SheetPill label={model.inferredLabel} current={false} onClick={onInferred} style={{ width: "100%", marginTop: 12, textTransform: "none", letterSpacing: "0.02em", fontSize: 13 }} />}
    </CaddieSheet>
  );
}

function YardsSheet({ initial, onUse, onClose }) {
  const [n, setN] = useState(Math.max(1, Math.round(initial || 150)));
  const step = (d) => setN((v) => Math.min(700, Math.max(1, v + d)));
  return (
    <CaddieSheet onClose={onClose} label={COPY.yardsTitle}>
      <div style={{ ...caps(12), marginBottom: 6 }}>{COPY.yardsTitle}</div>
      <div data-part="yards-value" style={{ ...written(44), textAlign: "center", lineHeight: "60px", margin: "4px 0 10px" }}>{n}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[-10, -1, 1, 10].map((d) => <SheetPill key={d} label={d > 0 ? `+${d}` : `−${Math.abs(d)}`} current={false} onClick={() => step(d)} style={{ letterSpacing: 0 }} />)}
      </div>
      <button onClick={() => onUse(n)} className="lc-primary" style={{ ...primaryPill, width: "100%", height: 52, marginTop: 14 }}><FlagGlyph />{COPY.use(n)}</button>
    </CaddieSheet>
  );
}

/* ---------- shot log (S4): the long card (spec §4.2–§4.3). v22.15: the collapsed previous-shot
   prompt (§4.4 step 2) is gone — a shot closes itself with an auto record (SPEC-shotlog-v2 §3). ---------- */
const capWord = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s);
const CONTACT_OPTS = [[-2, "−2 super fat"], [-1, "−1 chunky"], [0, "0 pure"], [1, "+1 thin"], [2, "+2 v. thin"]];
const CURVE_OPTS = [[-2, "−2 big draw"], [-1, "−1 draw"], [0, "0 straight"], [1, "+1 fade"], [2, "+2 big fade"]];
const SHOTTYPE_OPTS = [["full", "Full"], ["finesse", "Finesse"], ["recovery", "Recovery"]];
const wordOpts = (words) => words.map((w) => [w, capWord(w)]);

const SegPill = ({ label, current, onClick, fontSize = 11 }) => (
  <button onClick={onClick} aria-pressed={current ? "true" : "false"}
    style={{ ...(current ? primaryPill : outlinedPill), height: 34, borderRadius: 17, padding: "0 11px", fontSize, lineHeight: 1.15, letterSpacing: "0.04em", flex: "none", minWidth: 0, textAlign: "center" }}>
    {label}
  </button>
);
const SegField = ({ title, children }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ ...caps(9), marginBottom: 4 }}>{title}</div>
    {children}
  </div>
);
const SegGrid = ({ options, value, onChange, cols = 3, fontSize }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
    {options.map(([val, label]) => <SegPill key={String(val)} label={label} current={val === value} onClick={() => onChange(val)} fontSize={fontSize} />)}
  </div>
);

/**
 * v22.13 — the sliding scale for every 3- or 5-point ORDINAL question (contact, strike, intended
 * shape, start line, curve, and the three putt axes). `options` = [[value, label, full?], …] in order,
 * left to right; the centre stop is the middle entry. Labels sit under the two ends and the centre;
 * the CURRENT stop's full label (`full`, else `label`) is written in pencil to the right of the title.
 * One pointer handler on the whole box: pointerdown snaps to the nearest stop at once (a tap is as
 * fast as a pill), pointermove while captured snaps live (a drag is the bonus). No native range input.
 * `title` is optional, but without it there is no read-back line.
 */
const SCALE_INSET = 14;   // the thumb's radius plus a hair, so the thumb at either end stays inside the box
function ScaleSlider({ title, options, value, onChange, ariaLabel }) {
  const n = options.length;
  const found = options.findIndex(([v]) => v === value);
  const idx = found >= 0 ? found : (n - 1) >> 1;
  const boxRef = React.useRef(null);
  const [drag, setDrag] = useState(false);
  const at = (i) => `calc(${SCALE_INSET}px + (100% - ${2 * SCALE_INSET}px) * ${i / (n - 1)})`;
  const stopFor = (clientX) => {
    const r = boxRef.current.getBoundingClientRect();
    const f = (clientX - r.left - SCALE_INSET) / Math.max(1, r.width - 2 * SCALE_INSET);
    return Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
  };
  const pick = (i) => { if (i !== idx) onChange(options[i][0]); };
  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* no capture: the tap still works */ }
    setDrag(true);
    pick(stopFor(e.clientX));
  };
  const move = (e) => { if (drag) pick(stopFor(e.clientX)); };
  const up = () => setDrag(false);
  const key = (e) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    if (d) { e.preventDefault(); pick(Math.max(0, Math.min(n - 1, idx + d))); }
    else if (e.key === "Home") { e.preventDefault(); pick(0); }
    else if (e.key === "End") { e.preventDefault(); pick(n - 1); }
  };
  const full = (o) => o[2] ?? o[1];
  const lab = { position: "absolute", top: 29, whiteSpace: "nowrap", pointerEvents: "none", ...caps(9, 700, "0.08em"), color: T.muted };
  return (
    <div data-part="scale">
      {title != null && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, minHeight: 16 }}>
          <div style={caps(9)}>{title}</div>
          <div data-part="scale-readout" style={{ ...written(15), lineHeight: "16px", whiteSpace: "nowrap", pointerEvents: "none" }}>{full(options[idx])}</div>
        </div>
      )}
      <div ref={boxRef} className="lc-scale" role="slider" tabIndex={0} aria-label={ariaLabel || title}
        aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={idx} aria-valuetext={String(full(options[idx]))}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={key}
        style={{ position: "relative", height: 44, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent", cursor: "pointer" }}>
        <div style={{ position: "absolute", left: SCALE_INSET, right: SCALE_INSET, top: 14, borderTop: `1.5px solid ${T.ink}` }} />
        {options.map((o, i) => {
          const mid = i === (n - 1) / 2;
          return <div key={String(o[0])} style={{ position: "absolute", left: at(i), top: mid ? 4 : 9, width: mid ? 2.5 : 1.5, height: mid ? 20 : 10, marginLeft: mid ? -1.25 : -0.75, background: T.ink }} />;
        })}
        {/* an opaque paper disc (so the tick under it never shows) with the pencil-filtered ring on top */}
        <div data-part="scale-thumb" style={{ position: "absolute", left: at(idx), top: 1, width: 26, height: 26, marginLeft: -13, borderRadius: "50%",
          background: T.paper, transition: drag ? "none" : "left 80ms ease-out" }}>
          <div style={{ position: "absolute", inset: 0, boxSizing: "border-box", borderRadius: "50%", border: `4px solid ${T.ink}`, filter: "url(#pencil)" }} />
        </div>
        <div style={{ ...lab, left: 0 }}>{options[0][1]}</div>
        <div style={{ ...lab, left: "50%", transform: "translateX(-50%)" }}>{options[(n - 1) >> 1][1]}</div>
        <div style={{ ...lab, right: 0 }}>{options[n - 1][1]}</div>
      </div>
    </div>
  );
}

/**
 * The long card (§4.2): a "Good shot ✓" quick pill up top, the club, the shot type, the v22.13
 * sliders, Save / Skip. v22.15 (SPEC-shotlog-v2 §2–§3): no collapsed prompt mode; no Line played
 * pill (the line is read off the target on the map); a record that already has a GPS result opens
 * with Curve on that read (`curveSource: "auto"`) until Brett moves the slider (`"hand"`), and a
 * low-accuracy result puts the ? on Curve. Save and Good shot hand back to the caddie as it was.
 */
function LongCardSheet({ record, clubOrder, onQuick, onSave, onSkip, onClose }) {
  const init = (r) => {
    const auto = r.curveSource !== "hand" && Number.isFinite(r.derived?.curveAuto);
    return { ...r, contact: r.contact ?? 0, strike: r.strike ?? "center", startLine: r.startLine ?? "on", curve: auto ? r.derived.curveAuto : r.curve, curveSource: auto ? "auto" : r.curveSource ?? null };
  };
  const [draft, setDraft] = useState(() => init(record));
  useEffect(() => { setDraft(init(record)); }, [record.id]);
  const set = (k, val) => setDraft((d) => ({ ...d, [k]: val }));
  // v22.12: a shot with no recommendation — Brett names the club
  const bare = !record.recommendation;
  const needClub = bare && !draft.club;
  const off = needClub ? { opacity: 0.45 } : null;
  const lowAcc = !!record.derived?.derivedLowAcc;
  const word = curveReadback(record.derived?.curveAuto, draft.intendedShape);
  // the fields the card owns; linePlayed: undefined re-derives it for the club picked (§2)
  const fields = () => ({ club: draft.club, shotType: draft.shotType, contact: draft.contact, strike: draft.strike, intendedShape: draft.intendedShape,
    startLine: draft.startLine, curve: draft.curve, curveSource: draft.curveSource, linePlayed: undefined });
  return (
    <div data-part="sheet" data-log="full" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 65 }}>
      <div role="dialog" aria-label="Log shot" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto",
        background: T.paper, borderTop: `4px double ${T.ink}`, padding: "14px 22px calc(env(safe-area-inset-bottom) + 14px)" }}>
        <div style={{ ...caps(12), marginBottom: 10 }}>{COPY.logShot}{Number.isInteger(record.shotNo) ? <span style={{ ...printed(12), marginLeft: 6 }}>{record.shotNo}</span> : null}</div>
        {bare && <div data-part="log-bare" style={{ fontFamily: F.label, fontSize: 12, lineHeight: 1.4, color: T.ink, margin: "-6px 0 12px" }}>No caddie call on this shot. Pick the club you hit.</div>}
        {resultText(record.derived) && (
          <div data-part="log-result" style={{ fontFamily: F.label, fontSize: 12, color: T.ink, margin: "-4px 0 10px" }}>
            GPS <span style={printed(13)}>{resultText(record.derived)}</span>{lowAcc && <span style={{ ...printed(13), color: T.bogey }}> ?</span>}
          </div>
        )}
        <button onClick={() => onQuick({ ...draft, ...fields() })} disabled={needClub} className={needClub ? undefined : "lc-primary"} style={{ ...primaryPill, height: 44, width: "100%", marginBottom: 10, ...off }}><FlagGlyph />Good shot ✓</button>
        <SegField title="Club">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {clubOrder.map((id) => <SegPill key={id} label={clubShort(id)} current={id === draft.club} onClick={() => set("club", id)} />)}
          </div>
        </SegField>
        <SegField title="Shot type"><SegGrid cols={3} options={SHOTTYPE_OPTS} value={draft.shotType} onChange={(val) => set("shotType", val)} /></SegField>
        <ScaleSlider title="Contact" options={CONTACT_OPTS} value={draft.contact} onChange={(val) => set("contact", val)} />
        <ScaleSlider title="Strike" options={wordOpts(["heel", "center", "toe"])} value={draft.strike} onChange={(val) => set("strike", val)} />
        <ScaleSlider title="Intended shape" options={wordOpts(["draw", "straight", "fade"])} value={draft.intendedShape} onChange={(val) => set("intendedShape", val)} />
        <ScaleSlider title="Start line" options={wordOpts(["left", "on", "right"])} value={draft.startLine} onChange={(val) => set("startLine", val)} />
        <ScaleSlider title={<>Curve{lowAcc && <span data-part="curve-lowacc" style={{ ...printed(11), color: T.bogey }}> ?</span>}{draft.curveSource === "auto" && word ? <span style={{ fontFamily: F.label, fontSize: 10, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>({word})</span> : null}</>}
          ariaLabel="Curve" options={CURVE_OPTS} value={draft.curve} onChange={(val) => setDraft((d) => ({ ...d, curve: val, curveSource: "hand" }))} />
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={() => onSave(fields())} disabled={needClub} className={needClub ? undefined : "lc-primary"} style={{ ...primaryPill, flex: 1.4, height: 44, ...off }}><FlagGlyph />Save</button>
          <button onClick={onSkip} style={{ ...outlinedPill, flex: 1, height: 44 }}>Skip</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Putt capture (Sep 28 spec, addendum §3.4 / §8 "On the green"). `Made ✓` is the quick path
 * (writes nothing but the distance); `Save` grades the miss on the three §PUTT_AXES sliders,
 * each a 5-stop ScaleSlider (v22.13) with 0 ("Good") at the centre; the ends and centre carry the
 * `short` copy, the read-back line carries the full `options` copy.
 */
function PuttSheet({ initialFt, onMade, onSave, onSkip }) {
  const [ft, setFt] = useState(Math.max(1, Math.round(initialFt || 20)));
  const [axes, setAxes] = useState({ speed: 0, breakRead: 0, line: 0 });
  const step = (d) => setFt((v) => Math.min(200, Math.max(1, v + d)));
  const setAxis = (k, val) => setAxes((a) => ({ ...a, [k]: val }));
  return (
    <div data-part="sheet" data-log="putt" onClick={onSkip} style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 65 }}>
      <div role="dialog" aria-label="Putt" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto",
        background: T.paper, borderTop: `4px double ${T.ink}`, padding: "20px 22px calc(env(safe-area-inset-bottom) + 20px)" }}>
        <div style={{ ...caps(12), marginBottom: 10 }}>Putt</div>
        <div style={{ ...caps(9), marginBottom: 4 }}>From</div>
        <div data-part="putt-ft" style={{ ...written(44), textAlign: "center", lineHeight: "56px", margin: "2px 0 10px" }}>{ft}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
          {[-10, -1, 1, 10].map((d) => <SheetPill key={d} label={d > 0 ? `+${d}` : `−${Math.abs(d)}`} current={false} onClick={() => step(d)} style={{ letterSpacing: 0 }} />)}
        </div>
        <button onClick={() => onMade(ft)} className="lc-primary" style={{ ...primaryPill, width: "100%", height: 52, marginBottom: 16 }}><FlagGlyph />Made ✓</button>
        {PUTT_AXES.map((axis) => (
          <ScaleSlider key={axis.key} title={axis.label} options={axis.short.map((label, i) => [i - 2, label, axis.options[i]])} value={axes[axis.key]} onChange={(v) => setAxis(axis.key, v)} />
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button onClick={() => onSave({ distanceFt: ft, ...axes })} style={{ ...outlinedPill, flex: 1, height: 52 }}>Save</button>
          <button onClick={onSkip} style={{ ...outlinedPill, flex: 1, height: 52 }}>Skip</button>
        </div>
      </div>
    </div>
  );
}

/* 27-hole clubs (engine §6.4): a one-time paper list pairing each OSM hole with {nine, hole}. */
/* v22.7: `routing` (course.nines) pre-selects the nines being played and names them on the
   front/back rows; `initialMap` is a map already saved for this club on another routing. */
function NineMapScreen({ geometry, courseId, routing, initialMap, initialPlay, onSaved, onCard }) {
  const cands = useMemo(() => [...nineMapCandidates(geometry)].sort((a, b) => (Number(a.ref) || 99) - (Number(b.ref) || 99) || String(a.key).localeCompare(String(b.key))), [geometry]);
  const [map, setMap] = useState(() => {
    const d = defaultNineMap(cands);
    if (!initialMap) return d;
    cands.forEach((c) => { const v = initialMap[c.key]; if (v && v.nine && v.hole) d[c.key] = { nine: String(v.nine), hole: Number(v.hole) }; });
    return d;
  });
  const [play, setPlay] = useState(() => initialPlay || ["1", "2"]);
  const set = (k, patch) => setMap((m) => ({ ...m, [k]: { ...m[k], ...patch } }));
  const small = (on) => ({ width: 30, height: 30, borderRadius: 15, border: `1.5px solid ${T.ink}`, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink,
    fontFamily: F.num, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" });
  const named = routing && Array.isArray(routing.play) && !routing.play.every((x) => ["1", "2", "3"].includes(String(x))) ? routing.play : null;
  const save = () => {
    const assoc = routing ? ninesAssociation(play, routing) : null;
    const prev = initialMap && initialMap._nines;
    saveNineMap(safeStorage(), courseId, { ...map, _play: play, ...(assoc ? { _nines: assoc } : prev ? { _nines: prev } : {}) });
    onSaved(loadNineMap(safeStorage(), courseId) || { ...map, _play: play });
  };
  return (
    <div data-screen="nine-map" style={{ position: "fixed", inset: 0, overflowY: "auto", background: T.paper, color: T.ink, fontFamily: F.label,
      padding: "max(env(safe-area-inset-top), 20px) 20px max(env(safe-area-inset-bottom), 16px)" }}>
      <button onClick={onCard} style={{ height: 32, padding: "0 11px", background: T.paper, border: rule, color: T.ink, fontFamily: F.label, fontSize: 12 }}>‹&nbsp;Card</button>
      <div style={{ ...caps(12), marginTop: 16 }}>Course holes</div>
      <div style={{ fontSize: 13, lineHeight: 1.45, margin: "6px 0 12px" }}>This course maps more than 18 holes. Pair each with its nine and hole once; Loop keeps it.</div>
      {[["Front nine", 0], ["Back nine", 1]].map(([label, i]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: hairline }}>
          <span style={caps(10)}>{label}{named ? <span style={{ ...writtenWord(17), textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>{named[i]}</span> : null}</span>
          <span style={{ display: "flex", gap: 6 }}>{["1", "2", "3"].map((nine) => (
            <button key={nine} onClick={() => setPlay((p) => { const q = [...p]; q[i] = nine; return q; })} style={small(play[i] === nine)} aria-label={`${label}: nine ${nine}`}>{nine}</button>
          ))}</span>
        </div>
      ))}
      <div style={{ borderTop: rule, marginTop: 12 }}>
        {cands.map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 44, borderBottom: hairline }}>
            <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>Map hole <span style={printed(14)}>{c.ref ?? c.key}</span>{c.name ? ` · ${c.name}` : ""}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={caps(9)}>Nine</span>
              {["1", "2", "3"].map((nine) => <button key={nine} onClick={() => set(c.key, { nine })} style={small(map[c.key]?.nine === nine)}>{nine}</button>)}
              <span style={{ ...caps(9), marginLeft: 6 }}>Hole</span>
              <button onClick={() => set(c.key, { hole: Math.max(1, (map[c.key]?.hole || 1) - 1) })} style={small(false)} aria-label="Earlier hole">−</button>
              <span style={{ ...printed(15), width: 16, textAlign: "center" }}>{map[c.key]?.hole}</span>
              <button onClick={() => set(c.key, { hole: Math.min(9, (map[c.key]?.hole || 1) + 1) })} style={small(false)} aria-label="Later hole">+</button>
            </span>
          </div>
        ))}
      </div>
      <button onClick={save} className="lc-primary" style={{ ...primaryPill, width: "100%", height: 52, marginTop: 16 }}><FlagGlyph />Save</button>
    </div>
  );
}

/* The nine map for this round. Saved per CLUB (v22.7; before that per routing apiId, still read).
   With a routing chosen on Setup: a saved map takes this routing's `_play` from its `_nines`; with
   nothing saved, a confident map read off the routing (nineMapFromRouting) is saved and the screen
   skipped. Otherwise { ask } — the screen, pre-filled. */
function resolveNineMap(storage, geometry, course) {
  const clubId = clubIdOf(course), apiId = apiIdOf(course);
  const nines = course && course.nines;
  let saved = loadNineMap(storage, clubId) || (String(apiId) !== String(clubId) ? loadNineMap(storage, apiId) : null);
  if (!saved && nines) {
    const derived = nineMapFromRouting(geometry, nines);
    if (derived) saved = saveNineMap(storage, clubId, derived) ? (loadNineMap(storage, clubId) || derived) : derived;
  }
  if (!saved) return { map: null, ask: { initialMap: null, initialPlay: nines ? guessPlay(nines) : null } };
  if (!nines) return { map: saved, ask: null };
  const play = playFromRouting(saved, nines);
  if (play) return { map: { ...saved, _play: play }, ask: null };
  // a map saved without names for this routing's nines: ask which nines these are, holes pre-filled
  return { map: null, ask: { initialMap: saved, initialPlay: guessPlay(nines) } };
}

/* Wrapper: the 27-hole mapping screen first when the course needs it (never again once saved). */
function Caddie(props) {
  const { geometry, course, onCard } = props;
  const clubId = clubIdOf(course);
  const needs = !!geometry && needsNineMap(geometry);
  const resolve = () => (needs ? resolveNineMap(safeStorage(), geometry, course) : { map: null, ask: null });
  const [nm, setNm] = useState(resolve);
  useEffect(() => { setNm(resolve()); }, [geometry, clubId, course && course.routing]);
  if (needs && !nm.map) {
    return <NineMapScreen key={`${clubId}:${course && course.routing}`} geometry={geometry} courseId={clubId} routing={course.nines || null}
      initialMap={nm.ask && nm.ask.initialMap} initialPlay={nm.ask && nm.ask.initialPlay}
      onSaved={(m) => setNm({ map: course.nines ? { ...m, _play: playFromRouting(m, course.nines) || m._play } : m, ask: null })} onCard={onCard} />;
  }
  return <CaddieScreen {...props} nineMap={needs ? nm.map : null} />;
}

function CaddieScreen({ course, geometry, profile, cs, dispatch, weather, setWeather, onCard, onScore, onRetryProfile, contextRef, nineMap, roundId, testMode = false }) {
  const safe = useSafeArea();
  const vh = useViewportHeight();
  const compact = vh < 740;                             // 375×667: one-row distances, one-line reasons (§3.5)
  const n = cs.hole;
  const h = course.holes[n - 1];
  const courseId = apiIdOf(course);
  const config = profile?.config || DEFAULT_CONFIG;
  const buildFor = (m) => {
    const k = geometryKeyFor(geometry, nineMap, m), hh = course.holes[m - 1];
    try { return k != null && hh ? buildHole(geometry, k, { par: hh.par, yards: hh.yards }) : null; } catch (e) { return null; }
  };
  const key = geometryKeyFor(geometry, nineMap, n);
  const mapped = useMemo(() => buildFor(n), [geometry, nineMap, n, h.par, h.yards]);
  /* v22.11 marked-green mode: no geometry for this hole → the satellite on GPS, and once Brett has
     tapped the green, a synthetic hole from the ball to it (src/caddie/greens.js). */
  const noGeo = !mapped;
  const slotFor = (m) => greenSlot(course, m, { apiId: courseId, clubId: clubIdOf(course) });
  const slot = slotFor(n);
  const [greens, setGreens] = useState(() => loadGreens(safeStorage()));
  const marked = noGeo ? greenFor(greens, slot.courseId, slot.holeKey) : null;
  const greenInUse = marked && !cs.remark ? marked : null;
  const ballLat = cs.ball?.lat, ballLng = cs.ball?.lng;
  const synthetic = useMemo(() => (noGeo && greenInUse && Number.isFinite(ballLat)
    ? markedGreenHole({ ball: { lat: ballLat, lon: ballLng }, green: greenInUse, holeNo: n, par: h.par }) : null),
    [noGeo, greenInUse?.lat, greenInUse?.lon, ballLat, ballLng, n, h.par]);
  const built = mapped || synthetic;
  const Fr = useMemo(() => frameOf(built), [built]);
  // where an unmapped hole's ballXY and previous-shot lines are kept (the synthetic frame moves with the ball)
  const courseLL = useMemo(() => (noGeo ? courseAnchor(course) : null), [noGeo, course]);
  const anchorSrc = noGeo ? (courseLL || (Number.isFinite(ballLat) ? { lat: ballLat, lon: ballLng } : null)) : null;
  const anchorF = useMemo(() => anchorFrame(anchorSrc), [anchorSrc && anchorSrc.lat.toFixed(2), anchorSrc && anchorSrc.lon.toFixed(2)]);
  const [overrides, setOverrides] = useState(() => loadLieOverrides(safeStorage()));
  const [picker, setPicker] = useState(null);           // chip key
  const [windDir, setWindDir] = useState(null);
  const [yardsOpen, setYardsOpen] = useState(false);     // false | "next" (a new ball, §8) | "same" (v22.12: this ball, from the rail)
  const [markHereOpen, setMarkHereOpen] = useState(false);  // v22.12: the Mark green here confirmation
  const [shotsOpen, setShotsOpen] = useState(false);        // v22.15 §5: the Shots list

  const ballXY = noGeo ? (cs.ball && Fr ? Fr.toFrame({ lat: cs.ball.lat, lon: cs.ball.lng }) : null)
    : cs.ballXY || (cs.ball && Fr ? Fr.toFrame({ lat: cs.ball.lat, lon: cs.ball.lng }) : null);
  const pinSet = pinSetting(cs);

  /* the engine: assembleShotContext → §5.5 within-round nudges → recommend → ellipses (≈ 20–45 ms, inside the 500 ms budget) */
  // shotsRev: bumped on every saveShot here, so a logged / closed-out shot re-runs the nudges.
  const [shotsRev, setShotsRev] = useState(0);
  const saveShotHere = (record) => { const r = saveShot(safeStorage(), record); setShotsRev((x) => x + 1); return r; };
  const engine = useMemo(() => {
    if (!profile) return null;
    const lieOf = (ctx) => (c, sw) => resolveEntry(profile, c, sw, ctx.lieType, { wet: ctx.conditions === "wet" });
    // §5.5: recomputed from this round's shot log on every recommend(); never persisted.
    const today = roundId ? loadShots(safeStorage(), roundId) : [];
    const nudged = (ctx) => withinRoundCtx(ctx, today, profile, config);
    try {
      const tempF = weatherTempF(weather);
      if (cs.phase === "yards" && cs.yards) {
        const syn = syntheticHole(cs.yards, h.par);
        const ctx = nudged(clubBrainContext({ holeNo: n, par: h.par, shotNo: cs.shotNo, chips: cs.chips, windOverride: cs.windOverride, conditionsOverride: cs.conditionsOverride, tempF }));
        const res = recommend(ctx, syn, profile);
        const options = res ? ellipsesFor(res, lieOf(ctx), { lieQuality: ctx.lieQuality, config }) : null;
        const inferred = { lieType: cs.shotNo <= 1 ? "tee" : "fairway", lieConfidence: "low", wind: undefined, elevation: 0, conditions: "normal", tempF, distances: res?.context?.distances };
        return { ctx, res, options, inferred, onGreen: false, green: syn.green };
      }
      if (cs.phase !== "ready" || !built || !cs.ball) return null;
      const round = { hole: n, par: h.par, shotNo: cs.shotNo, courseId, trigger: cs.trigger || "tee", pins: { [n]: pinSet }, windOverride: cs.windOverride, conditionsOverride: cs.conditionsOverride };
      const wx = weather && (Number.isFinite(weather.speedMph) || Number.isFinite(weather.tempF)) ? weather : null;
      const common = { hole: built, geometry: built.synthetic ? null : geometry, fix: { lat: cs.ball.lat, lng: cs.ball.lng, accuracyM: cs.ball.accuracyM }, weather: wx,
        elevation: built.synthetic ? null : geometry?.elevation || null, overrides, config };
      // a marked green: the same assembly, its ±10-yd pin presets, and no lie inference (greens.js)
      const assemble = built.synthetic ? markedGreenContext : assembleShotContext;
      const ctx = nudged(assemble({ ...common, round, chips: cs.chips }));
      const base = assemble({ ...common, round: { ...round, windOverride: null, conditionsOverride: null }, chips: {} });
      const res = recommend(ctx, built, profile);
      const options = res && res.safe ? ellipsesFor(res, lieOf(ctx), { lieQuality: ctx.lieQuality, config }) : null;
      const pinPt = base.meta.distances?.pinPoint || built.green.center;
      const wind = base.wind ? { speedMph: base.wind.speedMph, relative: windEffect(base.wind, frameBearing(base.ball, pinPt), 100, config).relative }
        : base.meta.sources.wind === "weather" ? null : undefined;
      const inferred = { lieType: base.lieType, lieConfidence: base.lieConfidence, wind, elevation: base.elevationDeltaYds, conditions: base.conditions, tempF: base.tempF, distances: ctx.meta.distances };
      return { ctx, res, options, inferred, onGreen: res === null, green: built.green };
    } catch (e) {
      console.warn("caddie compute failed", e);
      return null;
    }
  }, [profile, cs.phase, cs.yards, cs.ball, cs.chips, cs.shotNo, cs.trigger, cs.windOverride, cs.conditionsOverride, pinSet, built, geometry, weather, overrides, n, h.par, roundId, shotsRev]);
  // The saved snapshot (§9.8) is the ShotContext only: §5.5 nudges are recomputed, never stored.
  if (contextRef) contextRef.current = engine?.ctx ? (({ adjust, nudges, flags, ...rest }) => rest)(engine.ctx) : null;

  /* map mode (§4.3, §8; v22.11 marked green) */
  const sat = useSatellite(mapped ? geometry : null, mapped ? key : null,
    { at: noGeo && Number.isFinite(ballLat) ? { lat: ballLat, lon: ballLng } : null, greenMarked: !!greenInUse, holeNo: n });
  // an unmapped hole can use the bridge unless there is a fix and the satellite is out of reach —
  // v22.12: once a green is marked the synthetic hole needs no imagery (it draws on the paper map)
  const markable = noGeo && (!!greenInUse || !(Number.isFinite(ballLat) && sat.mode === "none"));

  /* pin view (v22.11 B): the green, the draggable marker, the yards to it */
  const pinView = !!cs.pinView && !!built;
  const [dragPin, setDragPin] = useState(null);
  const pinXY = useMemo(() => (built ? pinPointFor(built, (cs.phase === "ready" && ballXY) || built.tee, pinSet) : null), [built, cs.phase, ballXY?.x, ballXY?.y, pinSet]);
  const pinFrom = (cs.phase === "ready" && ballXY) || built?.tee || null;
  const pinYds = pinView && pinFrom && (dragPin || pinXY) ? Math.hypot((dragPin || pinXY).x - pinFrom.x, (dragPin || pinXY).y - pinFrom.y) : null;

  // v22.15: this hole's records (the rail's ? count, the Shots list)
  const holeRecords = useMemo(() => (roundId ? loadShots(safeStorage(), roundId).filter((r) => r.hole === n) : []), [roundId, n, shotsRev]);
  const unreviewed = holeRecords.filter((r) => r.reviewed === false).length;
  // §6: the green cannot be detected on a hole with no OSM geometry (no map, a marked green, or a
  // green marked by standing on it) — or with yards and no GPS
  const greenManual = noGeo || cs.phase === "yards";
  const v = caddieView({ state: cs, par: h.par, profileOk: !!profile, mapOk: !!built, res: engine?.res || null, options: engine?.options || null,
    inferred: engine?.inferred || null, onGreen: !!engine?.onGreen, ballXY: cs.phase === "yards" ? null : ballXY, green: engine?.green || null, config,
    markable, greenMarked: !!marked, synthetic: !!built?.synthetic, pinYds: pinView ? pinYds : null, satFailure: noGeo ? sat.failure : null,
    greenManual, unreviewed });

  /* ---------- S4: shot log (SPEC-caddie §4, UI addendum §3.4/§9.4–9.5) ---------- */
  /* v22.15 §2 — the intent: Brett's marks for this shot over the defaults (the toggled option's
     target, the line through it, his usual shape for the club). Same shot and yards take the shape
     only (no map marks). The target is in this hole's frame (the synthetic one on a marked green)
     and in lat/lng, so the Review sheet can compare shots measured in different frames. */
  const marks = intentSet(cs);
  const liveOpts = engine?.options || null;
  const activeOpt = v.view === "ready" || v.view === "sameshot" ? (v.sameShot ? liveOpts?.safe : liveOpts?.[cs.opt] || liveOpts?.safe) || null : null;
  const mapMarks = v.view === "ready" || v.view === "sameshot";
  const intentNow = (opt = activeOpt) => shotIntent({
    set: mapMarks ? marks : { shape: marks.shape }, option: mapMarks ? opt : null,
    ball: cs.phase === "yards" ? null : ballXY, club: opt?.club ?? null, history: allShots(safeStorage()), frame: cs.phase === "yards" ? null : Fr,
  });
  // §9.4/§9.5 — everything the shot record needs to default from, snapshotted at the moment Brett
  // acts (Log shot / I'm at my ball), not eagerly at arrival: the toggle, chips and pin may still
  // change while he's standing over the ball. `club` (optional) overrides the toggle's club.
  // v22.15: the record for this shot keeps its id if one exists (a second Log shot edits it).
  const existingFor = (hole = n, shotNo = cs.shotNo) => (cs.openShot && cs.openShot.hole === hole && cs.openShot.shotNo === shotNo ? cs.openShot : null)
    || (roundId ? loadShots(safeStorage(), roundId).find((r) => r.hole === hole && r.shotNo === shotNo && r.shotType !== "putt") : null) || null;
  const buildDraftShot = (club) => {
    const res = engine?.res;
    if (!res || !res.safe) return null;
    // v22.12: the fix is kept when Enter yards was for the ball Brett stands at (the rail). Club-brain's
    // target is in the synthetic straight-hole frame, not this hole's, so a yards shot has no start
    // frame — its closeout then records the end without miss math instead of measuring across frames.
    const startGps = cs.ball;
    const startFrame = cs.phase === "yards" ? null : ballXY;
    const toggled = v.sameShot ? res.safe : (res[cs.opt] || res.safe);
    const chipsInEffect = { chips: cs.chips, pin: pinSet, windOverride: cs.windOverride, conditionsOverride: cs.conditionsOverride };
    const opt = engine?.options?.[v.sameShot ? "safe" : cs.opt] || toggled;
    return newShotRecord({
      id: existingFor()?.id,
      roundId: roundId ?? null, courseId, nine: n <= 9 ? "front" : "back", hole: n, shotNo: cs.shotNo,
      start: {
        lat: startGps?.lat ?? null, lng: startGps?.lng ?? null, accuracyM: startGps?.accuracyM ?? null,
        distanceToPinYds: res.context.distances.pin, playsLikeYds: res.context.playsLike, frame: startFrame,
      },
      lie: { inferred: engine.inferred?.lieType ?? null, confidence: res.context.lieConfidence, confirmed: res.context.lieType, quality: res.context.lieQuality },
      conditions: res.context.conditions,
      wind: res.context.wind,
      recommendation: { ...res, chipsInEffect },
      club: club ?? toggled.club,
      intent: cs.phase === "yards" ? shotIntent({ set: { shape: marks.shape }, club: club ?? toggled.club, history: allShots(safeStorage()) }) : intentNow(opt),
      history: allShots(safeStorage()),
    });
  };
  // v22.12: Log shot with nothing on screen to price it (no map, no satellite, before Enter yards, or
  // the engine returned nothing): a recommendation-less record, the club picked on the card.
  const buildBareShot = () => bareShotRecord({
    id: existingFor()?.id,
    roundId: roundId ?? null, courseId, nine: n <= 9 ? "front" : "back", hole: n, shotNo: cs.shotNo,
    gps: cs.ball || null,
    // shot 1 is from the tee, so the card's yardage is the honest start distance with nothing better
    distanceToPinYds: cs.phase === "yards" ? cs.yards : engine?.inferred?.distances?.pin ?? (cs.shotNo <= 1 && cs.trigger !== "ball" ? h.yards : null),
    lie: cs.chips.lie ?? (cs.shotNo <= 1 ? "tee" : null), quality: cs.chips.quality ?? "standard",
    conditions: cs.conditionsOverride ?? "normal",
    history: allShots(safeStorage()),
  });
  // a bare record still carries the shape Brett picked (§2: shape pills on every shot state)
  const bareWithShape = (r) => (r ? { ...r, intent: normIntent({ shape: marks.shape || r.intendedShape }), intendedShape: marks.shape || r.intendedShape } : r);
  // { record } | null — local; the underlying data is persisted through cs.logCard / cs.openShot (§9.8).
  const [logSheet, setLogSheet] = useState(null);
  const openLogSheet = () => {
    const record = buildDraftShot() || bareWithShape(buildBareShot());
    if (!record) return;
    setLogSheet({ record });
    dispatch({ type: "logOpen" });
  };
  // `build` turns the sheet's record into the final one (quickLog / detailLog / skipShot). v22.15 §3
  // auto-advance: the sheet closes onto the caddie as it was (Ready with this ball) — no extra tap.
  // A record that is already closed (reopened from the Shots list) is saved in place, not re-opened.
  const commitLog = (build) => {
    if (!logSheet) return;
    let record = build(logSheet.record);
    // the card's Intended shape is the intent's shape: keep the two in step, and the caddie's marks
    // too, so the close-out (which applies the intent in effect) does not undo the card
    if (record.intent && record.intendedShape && record.intent.shape !== record.intendedShape) {
      record = { ...record, intent: { ...record.intent, shape: record.intendedShape, source: "set" } };
      if (!logSheet.closed && record.hole === n && record.shotNo === cs.shotNo) dispatch({ type: "intent", patch: { shape: record.intendedShape } });
    }
    saveShotHere(record);
    if (!logSheet.closed) dispatch({ type: record.logged === "skipped" ? "logSkip" : "logSave", record });
    else dispatch({ type: "logDismiss" });
    setLogSheet(null);
  };
  const cancelLogSheet = () => { setLogSheet(null); dispatch({ type: "logDismiss" }); };
  // Reopen a restored logCard (e.g. after a reload mid-hole, §9.8) once the engine has recomputed.
  useEffect(() => {
    // v22.13: "putt" is the PuttSheet's own card — restoring it here opened a stray bare long card under it (v22.12)
    if (logSheet || cs.logCard !== "log") return;
    const record = buildDraftShot() || bareWithShape(buildBareShot());
    if (record) setLogSheet({ record });
    else dispatch({ type: "logDismiss" });
  }, [cs.logCard, !!engine?.res]);
  // §4.5 — the hole moved on (score entered, possibly while the caddie screen wasn't even open)
  // without a fresh fix to close the last long shot out. Best effort: the hole's green centre
  // stands in for the missing GPS end point, since the round has already left that ball behind.
  useEffect(() => {
    if (!cs.openShot || cs.openShot.hole === n) return;
    let prevHole = buildFor(cs.openShot.hole);
    if (!prevHole) {
      // v22.11: an unmapped hole with a marked green — rebuild the shot's synthetic hole from its start
      const ps = slotFor(cs.openShot.hole), g = greenFor(greens, ps.courseId, ps.holeKey), st = cs.openShot.start;
      prevHole = g && Number.isFinite(st?.lat) ? markedGreenHole({ ball: { lat: st.lat, lon: st.lng }, green: g, holeNo: cs.openShot.hole }) : null;
    }
    const prevFr = frameOf(prevHole);
    const endLL = prevFr ? prevFr.toLatLng(prevHole.green.center) : null;
    const closed = prevHole && endLL
      ? closeOutShot(cs.openShot, { endGps: { lat: endLL.lat, lng: endLL.lon }, endLie: "green", endAccuracyM: null, endFrame: prevHole.green.center }, config)
      : cs.openShot;
    saveShotHere(closed);
    dispatch({ type: "logClosed" });
  }, [cs.openShot, n]);

  /* map */
  const prevShots = noGeo ? (built ? toSyntheticFrame(cs.shots[n] || [], anchorF, Fr) : []) : cs.shots[n] || [];
  const mi = mapInput({ state: cs, view: v.view, ballXY, accuracyM: cs.ball?.accuracyM ?? null, options: engine?.options || null, sameShot: v.sameShot, pin: pinXY, previousShots: prevShots });
  // §8: Locating, No GPS fix, Location off and Yards entered keep the last camera (no ball drawn).
  const lastFit = React.useRef({ hole: null, ball: null, options: null });
  if (v.view === "ready" || v.view === "sameshot") lastFit.current = { hole: n, ball: mi.fitBall, options: mi.fitOptions };
  else if (v.view === "pretee" || v.view === "green") lastFit.current = { hole: n, ball: mi.fitBall, options: null };
  const keepCam = ["locating", "nofix", "locationoff", "yards"].includes(v.view) && lastFit.current.hole === n;
  const fitBall = keepCam ? lastFit.current.ball : mi.fitBall, fitOptions = keepCam ? lastFit.current.options : mi.fitOptions;
  const notice = v.notice || (built ? sat.notice : null);
  const markAt = noGeo && !built && v.view === "markgreen" && cs.ball ? { lat: cs.ball.lat, lon: cs.ball.lng } : null;
  /* v22.15 §2: the target marker and the start line on Ready; the ellipse follows a moved target
     (the recommendation does not — it is what Brett was told, the marker is where he aims) */
  const [dragTarget, setDragTarget] = useState(null);
  const shownTarget = mapMarks && !pinView ? dragTarget || marks.target || activeOpt?.target || null : null;
  const optKey = v.sameShot ? "safe" : cs.opt;
  const drawnOptions = mi.options && mapMarks && (dragTarget || marks.target) && mi.options[optKey]
    ? { ...mi.options, [optKey]: { ...mi.options[optKey], target: { ...(dragTarget || marks.target), label: "own target" } } } : mi.options;
  const toLLxy = (p) => { if (!Fr || !p) return null; const q = Fr.toLatLng(p); return { lat: q.lat, lng: q.lon }; };
  const setTarget = (p) => { setDragTarget(null); if (p) dispatch({ type: "intent", patch: { target: { x: p.x, y: p.y }, targetLabel: "own target", targetLL: toLLxy(p) } }); };
  const setLine = (p) => {
    const deg = p && ballXY ? bearingInFrame(ballXY, p) : null;
    const r = deg != null ? (deg * Math.PI) / 180 : 0;
    dispatch({ type: "intent", patch: { startLineDeg: deg, lineLL: deg != null ? toLLxy({ x: ballXY.x + Math.sin(r) * 100, y: ballXY.y + Math.cos(r) * 100 }) : null } });
  };
  // §1: test mode on a hole with nothing to frame (no map, no mark view) — the course centre
  // north-up ~400 yds, or the ball when there is one
  const fakeAt = testMode && !built && !markAt
    ? (cs.ball ? { lat: cs.ball.lat, lon: cs.ball.lng, spanYds: 400, ball: true } : (courseLL ? { ...courseLL, spanYds: 400, ball: false } : null)) : null;
  const markGreen = (q) => { setGreens(saveGreen(safeStorage(), slot.courseId, slot.holeKey, q)); dispatch({ type: "greenMarked" }); };
  const barH = 78 + safe.bottom;
  const insets = useMemo(() => ({ top: safe.top + 49, right: CADDIE_RAIL_W, bottom: barH + 16, left: 0 }), [safe.top, barH]);

  /* weather: at round start and on I'm on the tee when 15 minutes have passed (§6.5); silent when unreachable */
  const refreshWeather = () => {
    const a = courseAnchor(course) || (Fr ? (() => { const q = Fr.toLatLng({ x: 0, y: 0 }); return { lat: q.lat, lon: q.lon }; })() : null);
    if (!a || typeof fetch === "undefined") return;
    fetchWeather(a.lat, a.lon, fetch, { last: weather && !weather.error ? weather : null })
      .then((w) => { if (w && Number.isFinite(w.speedMph)) setWeather(w); })
      .catch(() => {});
  };
  useEffect(() => { if (weatherRefreshDue(weather)) refreshWeather(); }, []);

  /* v22.15 §1 — the one place a fix comes from. Real GPS: one fix per tap, high accuracy, 10 s
     (§8 Locating). Test mode: the map is armed (the action went to the reducer with `tap`) and the
     next tap on it calls the same onFix with a fix of the same shape (accuracy 4 m). Everything
     after that — close-out, hole detection, lie inference, the reducer's `fix` — is shared. */
  const fixHandler = React.useRef(null);
  const getFix = (onFix, onErr) => {
    if (testMode) { fixHandler.current = { onFix, onErr }; return; }
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : null;
    if (!geo) { onErr({ code: 2 }); return; }
    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; onErr({ code: 3 }); } }, GPS_TIMEOUT_MS + 1500);
    geo.getCurrentPosition((pos) => {
      if (done) return; done = true; clearTimeout(guard);
      onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null });
    }, (err) => {
      if (done) return; done = true; clearTimeout(guard);
      onErr(err);
    }, { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 });
  };
  const [markHereAt, setMarkHereAt] = useState(null);    // test mode: where the tap says the green is
  const onFakeTap = (q) => {
    const a = cs.awaitingTap;
    const hnd = fixHandler.current;
    fixHandler.current = null;
    dispatch({ type: "tapDone" });
    if (a?.action === "mark") { setMarkHereAt({ lat: q.lat, lng: q.lon, accuracyM: 4 }); setMarkHereOpen(true); return; }
    if (hnd) hnd.onFix(fakeFix(q));
    else dispatch({ type: "fixError", code: 3 });        // the handler did not survive (a reload): Try again re-arms
  };

  /* §3 — what closes when the next fix arrives: the shot being played now. Snapshotted when Brett
     acts (the engine blanks while Locating) and kept for a Try again of the same ball. */
  const closingRef = React.useRef(null);
  const snapshotClosing = (trigger) => {
    if (trigger === "tee") return null;
    const live = cs.phase === "ready" || cs.phase === "yards";
    if (!live) return closingRef.current && closingRef.current.hole === n && closingRef.current.shotNo === cs.shotNo ? closingRef.current : null;
    const logged = existingFor();
    const intent = cs.phase === "yards" ? shotIntent({ set: { shape: marks.shape }, club: logged?.club ?? activeOpt?.club ?? null, history: allShots(safeStorage()) }) : intentNow();
    const draft = logged ? null : (buildDraftShot() || bareWithShape(buildBareShot()));
    return { hole: n, shotNo: cs.shotNo, logged, draft, intent, frameHole: built };
  };
  const closeShot = (snap, { fix, endFrame, endLie }) => {
    if (!snap || !fix) return;
    const base = snap.logged || (snap.draft ? autoShotRecord(snap.draft) : null);
    if (!base) return;
    // an intent set after the card was saved still counts: the one in effect at the close wins
    const intent = snap.logged && !snap.logged.intent ? undefined : snap.intent;
    saveShotHere(closeOutShot(base, { endGps: fix, endLie: endLie ?? null, endAccuracyM: fix.accuracyM, endFrame: endFrame ?? null, intent }, config));
    if (cs.openShot && cs.openShot.id === base.id) dispatch({ type: "logClosed" });
  };

  const locate = (kind) => {
    const trigger = kind === "retry" ? (cs.trigger || (cs.ball || cs.yards != null ? "ball" : "tee")) : kind;
    const snap = snapshotClosing(trigger);
    closingRef.current = snap;
    dispatch({ type: kind, tap: testMode });
    if (trigger === "tee" && weatherRefreshDue(weather)) refreshWeather();
    getFix((fix) => {
      closingRef.current = null;
      let holeNo = null, hole = built;
      if (trigger === "tee" && geometry && key != null) {       // v22.11: no hole detection from an unmapped hole (§2 rule only)
        const order = scorecardOrder(geometry, nineMap);
        const r = detectHole(geometry, fix, key, { order: order.filter((k) => k != null) });
        const m = r.advanced ? detectedHoleNo(order, r.hole, n) : null;
        if (m && course.holes[m - 1]) { holeNo = m; hole = buildFor(m); }
      }
      const Fh = frameOf(hole);
      // v22.12: a shot logged before I'm on the tee is the tee shot itself — the tee fix is its start, not its end
      const teeShot = trigger === "tee" && cs.openShot && cs.openShot.hole === (holeNo || n) && cs.openShot.shotNo === 1 ? cs.openShot : null;
      if (teeShot && !Number.isFinite(teeShot.start?.lat)) {
        const tp = Fh ? Fh.toFrame({ lat: fix.lat, lon: fix.lng }) : null;
        const patched = { ...teeShot, start: { ...(teeShot.start || {}), lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, frame: noGeo ? null : tp } };
        saveShotHere(patched);
        dispatch({ type: "logSave", record: patched });
      }
      if (noGeo) {
        // v22.11: ballXY and the previous-shot lines go in the anchor frame; the shot being closed
        // out was aimed in the last ball's synthetic frame (`hole`), so its end is measured there.
        const aF = anchorF || anchorFrame({ lat: fix.lat, lon: fix.lng });
        const endFrame = Fh ? Fh.toFrame({ lat: fix.lat, lon: fix.lng }) : null;
        // v22.12: no map and no marked green — still record where the ball ended; no frame, so no miss math
        closeShot(snap, { fix, endFrame, endLie: endFrame ? markedEndLie(hole, endFrame) : null });
        dispatch({ type: "fix", fix, point: aF ? aF.toFrame({ lat: fix.lat, lon: fix.lng }) : null, hole: null });
        return;
      }
      const point = Fh ? Fh.toFrame({ lat: fix.lat, lon: fix.lng }) : null;
      // §4.5 / v22.15 §3 — this fix is what the shot being played was waiting on: its end position
      // and the result, on the logged record or on an auto-created one
      if (point && snap) {
        const endLie = inferLie(hole, geometry, ll(fix) || point, { accuracyM: fix.accuracyM, overrides, courseId }).lieType;
        closeShot(snap, { fix, endFrame: point, endLie });
      }
      dispatch({ type: "fix", fix, point, hole: holeNo });
    }, (err) => {
      // §6: On the green with no fix still closes the shot (no end) — the reducer puts him on the green
      if (trigger === "green" && snap) {
        const base = snap.logged || (snap.draft ? autoShotRecord(snap.draft) : null);
        if (base) { saveShotHere(closeOutShot(base, { intent: snap.intent }, config)); if (cs.openShot && cs.openShot.id === base.id) dispatch({ type: "logClosed" }); }
      }
      dispatch({ type: "fixError", code: err && err.code });
    });
  };

  /* chips: every change recomputes; a lie correction is also stored for §5.6 (§9.4) */
  const applyChip = (k, value) => {
    if (k === "lie" && value != null && cs.ball && !built?.synthetic && engine?.inferred?.lieType && value !== engine.inferred.lieType) {
      const e = recordLieOverride(safeStorage(), { courseId, hole: n, gps: { lat: cs.ball.lat, lng: cs.ball.lng, accuracyM: cs.ball.accuracyM }, inferred: engine.inferred.lieType, corrected: value });
      setOverrides((o) => [...o, e]);
    }
    dispatch({ type: "chip", key: k, value });
    setPicker(null); setWindDir(null);
  };
  const chipCurrent = (k) => k === "lie" ? (cs.chips.lie ?? engine?.inferred?.lieType ?? null)
    : k === "quality" ? (cs.chips.quality ?? "standard")
    : k === "wind" ? cs.windOverride
    : k === "elevation" ? (Number.isFinite(cs.chips.elevation) ? cs.chips.elevation : Number.isFinite(engine?.inferred?.elevation) ? Math.round(engine.inferred.elevation) : null)
    : k === "pin" ? pinSet
    : (cs.conditionsOverride ?? engine?.inferred?.conditions ?? "normal");
  const pickerM = picker ? pickerModel(picker, { chip: v.details.chips.find((c) => c.key === picker), current: chipCurrent(picker) }) : null;

  const act = (a) => {
    // v22.15: no previous-shot prompt — I'm at my ball closes the shot itself (§3)
    if (a === "tee" || a === "ball" || a === "retry" || a === "green") locate(a);
    else if (a === "yards") setYardsOpen("next");
    else if (a === "yardsSame") setYardsOpen("same");
    else if (a === "logshot") openLogSheet();
    else if (a === "logputt") dispatch({ type: "puttOpen" });
    else if (a === "score") onScore(n);
    else if (a === "profile") onRetryProfile();
  };
  const yardsInitial = cs.yards || engine?.inferred?.distances?.pin || (cs.shotNo <= 1 && (cs.phase === "pretee" || (noGeo && cs.trigger !== "ball")) ? h.yards : null) || 150;

  const r = v.rail, d = v.details;
  const k9 = { ...caps(9), lineHeight: 1 };
  const hr = <div style={{ width: 88, borderTop: hairline, margin: "14px 0", flex: "none" }} />;
  const exp = cs.exp;

  return (
    <div data-screen="caddie" style={{ position: "fixed", inset: 0, overflow: "hidden", background: T.paper, color: T.ink, fontFamily: F.label, userSelect: "none", WebkitUserSelect: "none" }}>
      <style dangerouslySetInnerHTML={{ __html: CADDIE_CSS }} />
      <MapLayer hole={built} geometry={geometry} ball={mi.ball} accuracyM={mi.accuracyM} pin={mi.pin} options={drawnOptions} active={mi.active} sameShot={mi.sameShot}
        previousShots={mi.previousShots} fitBall={fitBall} fitOptions={fitOptions} insets={insets} fallback={sat.mode === "fallback" || (!built && !markAt)}
        onPinTap={(p) => { const q = pinFromMapTap(built, p); if (q) dispatch({ type: "pin", value: q }); }}
        onMapTap={() => { if (cs.exp) dispatch({ type: "exp", exp: false }); }} onSatelliteFail={sat.markFailed}
        markAt={markAt} onMarkGreen={markGreen} onRemark={() => dispatch({ type: "remark", on: true })}
        pinView={pinView} onPinDrag={setDragPin} onPinDrop={(p) => { const q = pinFromDrag(built, p); if (q) dispatch({ type: "pin", value: q }); }}
        intentMarker={shownTarget} startLineDeg={mapMarks ? marks.startLineDeg ?? null : null}
        onTargetDrag={(p) => { if (p) setDragTarget(p); }} onTargetDrop={setTarget}
        lineMode={!!cs.lineMode && mapMarks} onLineTap={setLine}
        onFakeTap={cs.awaitingTap ? onFakeTap : null} fakeAt={fakeAt} testBorder={testMode} />

      {/* v22.11 B: the pin button — paper disc, ink flag; bottom-left of the map region, clear of the attribution */}
      {built && ["pretee", "ready", "sameshot", "green"].includes(v.view) && (
        <div style={{ position: "absolute", left: 14, bottom: barH + 26, display: "flex", alignItems: "center", gap: 8, zIndex: 15 }}>
          <button data-part="pin-button" onClick={() => dispatch({ type: "pinView", on: !pinView })} aria-pressed={pinView ? "true" : "false"}
            aria-label={pinView ? "Back to the shot" : "Move the pin"}
            style={{ width: 38, height: 38, borderRadius: 19, border: rule, background: pinView ? T.ink : T.paper, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: pinView ? `inset 0 0 0 1.5px ${T.yellow}` : "0 1px 3px rgba(20,28,16,.35)" }}>
            <svg width="13" height="17" viewBox="0 0 14 18" fill="none" stroke={pinView ? T.paper : T.ink} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={pinView ? T.yellow : T.ink} stroke={pinView ? T.yellow : T.ink} />
            </svg>
          </button>
          {pinView && (
            <button data-part="pin-done" onClick={() => dispatch({ type: "pinView", on: false })}
              style={{ height: 32, padding: "0 11px", display: "flex", alignItems: "center", background: T.paper, border: rule, borderRadius: 0, color: T.ink, fontFamily: F.label, fontSize: 12 }}>
              {COPY.done}
            </button>
          )}
        </div>
      )}

      {/* v22.12 Mark green here — no imagery needed: the fix Brett is standing on becomes this hole's green */}
      {noGeo && cs.ball && (v.view === "nomap" || v.view === "markgreen") && (
        <button data-part="mark-here" onClick={() => { if (testMode) { dispatch({ type: "awaitMark" }); return; } setMarkHereAt(null); setMarkHereOpen(true); }}
          style={{ position: "absolute", left: 14, bottom: barH + 26, height: 38, padding: "0 12px", display: "flex", alignItems: "center", gap: 8, zIndex: 15,
            background: T.paper, border: rule, borderRadius: 0, color: T.ink, fontFamily: F.label, fontSize: 12, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(20,28,16,.35)" }}>
          <svg width="11" height="15" viewBox="0 0 14 18" fill="none" stroke={T.ink} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M3 17 V2" /><path d="M3 2 L13 6 L3 10 Z" fill={T.ink} />
          </svg>
          {COPY.markHere}
        </button>
      )}

      <button onClick={onCard} aria-label="Back to the scorecard" style={{ position: "absolute", left: 14, top: safe.top + 9, height: 32, padding: "0 11px",
        display: "flex", alignItems: "center", background: T.paper, border: rule, borderRadius: 0, color: T.ink, fontFamily: F.label, fontSize: 12, zIndex: 15, whiteSpace: "nowrap" }}>
        {COPY.card}
      </button>

      {notice && (
        <div role="status" style={{ position: "absolute", left: 14, right: 120, top: safe.top + 49, padding: "7px 11px", background: T.paper, border: rule,
          color: T.ink, fontFamily: F.label, fontSize: 12, lineHeight: "16px", zIndex: 15, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {notice}
        </div>
      )}

      {/* rail (§3.2, §3.3): the 102 column on the right, the 250 details column opening to its left */}
      <div data-part="rail" data-view={v.view} className="lc-rail" style={{ position: "absolute", right: 0, top: 0, bottom: barH, width: exp ? CADDIE_RAIL_EXP : CADDIE_RAIL_W,
        background: T.paper, borderLeft: `4px double ${T.ink}`, zIndex: 20, display: "flex", flexDirection: "row-reverse", overflow: "hidden" }}>
        <div data-part="rail-col" style={{ flex: "none", width: 102, padding: `${safe.top + 7}px 7px 0`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", minHeight: 0 }}>
          <span style={k9}>Hole</span>
          <span style={{ position: "relative", ...printed(42), color: T.black, lineHeight: 0.9, marginTop: 6 }}>{r.hole}
            {/* v22.15 §3–§4: a small ? while this hole has shots nobody has looked at */}
            {r.unreviewed > 0 && <span data-part="rail-q" aria-label={`${r.unreviewed} to review`} style={{ position: "absolute", left: "100%", top: -2, marginLeft: 2, ...printed(13), color: T.bogey, lineHeight: 1, whiteSpace: "nowrap" }}>?{r.unreviewed > 1 ? <sub style={{ fontSize: 9 }}>{r.unreviewed}</sub> : null}</span>}
          </span>
          <span style={{ fontSize: 11, color: T.ink, marginTop: 6 }}>par <span style={printed(12)}>{r.par}</span> · shot <span style={printed(12)}>{r.shot}</span></span>
          {hr}
          {r.toggle === "pills" && (
            <div role="group" aria-label="Option" style={{ display: "flex", flexDirection: "column", gap: 8, width: 88 }}>
              {[["safe", "Safe"], ["aggressive", "Aggressive"]].map(([id, label]) => {
                const on = r.opt === id;
                return (
                  <button key={id} onClick={() => dispatch({ type: "opt", opt: id })} aria-pressed={on ? "true" : "false"}
                    style={{ height: 44, borderRadius: 22, border: `2px solid ${T.ink}`, background: on ? T.ink : "transparent", color: on ? T.paper : T.ink,
                      boxShadow: on ? `inset 0 0 0 1.5px ${T.yellow}` : "none", textAlign: "center", ...caps(10, 700, "0.08em") }}>{label}</button>
                );
              })}
            </div>
          )}
          {r.toggle === "same" && (
            <div data-part="same-shot" style={{ width: 88, padding: "10px 0", borderTop: rule, borderBottom: rule, textAlign: "center", ...caps(10, 700, "0.1em"), lineHeight: 1.5 }}>
              {COPY.sameA}<br />{COPY.sameB}
            </div>
          )}
          {r.toggle && hr}
          {r.showClub && (
            <>
              <span style={k9}>Club</span>
              <span data-part="club" style={{ ...printed(r.club.length > 7 ? 20 : 23), color: T.black, lineHeight: 0.9, margin: r.finesse ? "6px 0 4px" : "6px 0 14px", whiteSpace: "nowrap" }}>{r.club}</span>
              {r.finesse && <span style={{ fontSize: 11, color: T.ink, marginBottom: 10 }}>{COPY.finesse}</span>}
              <span style={k9}>To target</span>
              <span data-part="to-target" style={r.toTargetPencil ? { ...written(26), lineHeight: 0.9, margin: "4px 0 12px" } : { ...printed(26), color: T.ink, lineHeight: 0.9, margin: "6px 0 14px" }}>{r.toTarget}</span>
            </>
          )}
          <span data-part="aim" style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.25, color: T.ink, marginTop: r.showClub ? -4 : 0 }}>{r.aim}</span>
          {/* v22.15 §2: the shape for this shot, and the start line on the map */}
          {r.shapes && (
            <div role="group" aria-label="Shape" data-part="rail-shapes" style={{ marginTop: 10, width: 88, display: "flex", flexDirection: "column", border: rule, borderRadius: 12, overflow: "hidden", flex: "none" }}>
              {COPY.shapes.map(([k, label], i) => {
                const on = (marks.shape || (activeOpt ? intentNow().shape : "straight")) === k;
                return (
                  <button key={k} data-shape={k} onClick={() => dispatch({ type: "intent", patch: { shape: k } })} aria-pressed={on ? "true" : "false"}
                    style={{ height: compact ? 22 : 24, borderTop: i ? hairline : "none", background: on ? T.ink : "transparent", color: on ? T.paper : T.ink,
                      boxShadow: on ? `inset 0 0 0 1.5px ${T.yellow}` : "none", ...caps(9, 700, "0.08em"), textAlign: "center" }}>{label}</button>
                );
              })}
            </div>
          )}
          {r.line && (
            <button data-part="rail-line" onClick={() => dispatch({ type: "lineMode", on: !cs.lineMode })} aria-pressed={cs.lineMode ? "true" : "false"}
              style={{ marginTop: 8, width: 88, height: 30, flex: "none", border: rule, borderRadius: 15, background: cs.lineMode ? T.ink : "transparent", color: cs.lineMode ? T.paper : T.ink,
                boxShadow: cs.lineMode ? `inset 0 0 0 1.5px ${T.yellow}` : "none", textAlign: "center", ...caps(9, 700, "0.14em") }}>
              {COPY.line}{Number.isFinite(marks.startLineDeg) && !cs.lineMode ? " ·" : ""}
            </button>
          )}
          {/* v22.12: no map — Enter yards (for this ball) is a text button here; the bar keeps I'm at my ball + Log shot */}
          {r.action && (
            <button data-part="rail-action" onClick={() => act(r.action.action)}
              style={{ marginTop: r.shapes ? 8 : 14, width: 88, height: r.shapes ? 34 : 40, flex: "none", borderTop: rule, borderBottom: rule, background: "transparent", color: T.ink, textAlign: "center", ...caps(10, 700, "0.14em") }}>
              {r.action.label}
            </button>
          )}
          <button onClick={() => dispatch({ type: "exp", exp: !exp })} aria-expanded={exp ? "true" : "false"}
            style={{ marginTop: "auto", alignSelf: "stretch", marginLeft: -7, marginRight: -7, height: 48, flex: "none", borderTop: rule, background: "transparent", color: T.ink, textAlign: "center", ...caps(10, 700, "0.14em") }}>
            {r.details}
          </button>
        </div>

        <div data-part="details" className="lc-det" aria-hidden={exp ? "false" : "true"} style={{ position: "relative", flex: "none", width: 250, padding: `${safe.top + 7}px 12px 48px 14px`, borderRight: hairline,
          opacity: exp ? 1 : 0, overflow: "hidden", pointerEvents: exp ? "auto" : "none" }}>
          {/* 1. distances */}
          <div style={{ display: "grid", gridTemplateColumns: compact ? "repeat(4, 1fr)" : "1fr 1fr", rowGap: 10, borderBottom: rule, padding: "2px 0 8px" }}>
            {d.distances.map((c, i) => (
              <div key={c.k} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, borderRight: (compact ? i < 3 : i % 2 === 0) ? hairline : "none" }}>
                <span style={k9}>{c.k}</span>
                <span style={{ ...printed(20), color: T.ink, lineHeight: 1 }}>{c.v}</span>
              </div>
            ))}
          </div>
          {/* 2. chips */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: T.hair, border: rule, marginTop: 10 }}>
            {d.chips.map((c) => (
              <button key={c.key} className="lc-chip" data-chip={c.key} onClick={() => { setWindDir(null); setPicker(c.key); }} aria-label={`${c.label}: ${c.value}`}
                style={{ position: "relative", background: T.paper, height: 50, padding: "7px 9px 6px", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "flex-start", textAlign: "left", minWidth: 0 }}>
                <span style={k9}>{c.label}</span>
                <span style={{ ...(c.edited ? { ...writtenWord(c.value.length > 8 ? 24 : 29), lineHeight: 0.62 } : { fontSize: c.value.length > 11 ? 12.5 : 14, color: T.black, lineHeight: 1 }),
                  whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.value}{c.unsure && <span style={{ ...printed(14), color: T.bogey }}> ?</span>}
                </span>
                <i style={{ position: "absolute", right: 8, top: 7, width: 5, height: 5, borderRight: `1.3px solid ${T.muted}`, borderBottom: `1.3px solid ${T.muted}`, transform: "rotate(45deg)" }} />
              </button>
            ))}
          </div>
          {/* 3. options */}
          {d.rows.length > 0 && (
            <div style={{ marginTop: 10, borderTop: rule }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", alignItems: "center", height: 22, borderBottom: hairline }}>
                <span />
                {["Avg", "Birdie", "Trouble"].map((t) => <span key={t} style={{ ...caps(8, 700, "0.08em"), textAlign: "right", paddingRight: 3 }}>{t}</span>)}
              </div>
              {d.rows.map((row) => (
                <button key={row.id} data-row={row.id} onClick={() => { if (!v.sameShot) dispatch({ type: "opt", opt: row.id }); }} aria-pressed={row.selected ? "true" : "false"}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", alignItems: "center", height: 44, borderBottom: rule, background: "transparent", padding: 0 }}>
                  <span style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", paddingLeft: 8, textAlign: "left",
                    background: row.selected ? T.yellow : "transparent", minWidth: 0 }}>
                    <b style={{ ...caps(9, 700, "0.06em") }}>{row.label}</b>
                    <i style={{ fontStyle: "normal", fontSize: 12, color: T.ink, marginTop: 3, whiteSpace: "nowrap" }}>{row.club}</i>
                  </span>
                  <span style={{ ...printed(16), color: T.ink, textAlign: "right", paddingRight: 3, whiteSpace: "nowrap" }}>
                    {row.avg}{row.delta && <small style={{ ...printed(11), marginLeft: 3, display: row.delta === "≈ same" ? "block" : "inline" }}>{row.delta}</small>}
                  </span>
                  <span style={{ ...printed(16), color: T.ink, textAlign: "right", paddingRight: 3 }}>{row.birdie}</span>
                  <span style={{ ...printed(16), color: T.ink, textAlign: "right", paddingRight: 3 }}>{row.trouble}</span>
                </button>
              ))}
            </div>
          )}
          {/* 4. dispersion (§5.6) */}
          {d.dispersion && (
            <div style={{ marginTop: 9, paddingTop: 7, borderTop: hairline, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={k9}>Dispersion</span>
              <span style={{ fontSize: 12, color: T.ink }}><b style={{ ...printed(16), color: T.black }}>{d.dispersion.club} {d.dispersion.w} × {d.dispersion.d}</b> yds</span>
              <span style={{ fontSize: 10, color: T.ink }}>{d.dispersion.source}</span>
            </div>
          )}
          {/* 5. reasons */}
          {d.reasons.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {d.reasons.map((t, i) => <div key={i} className={compact ? "lc-clamp1" : undefined} style={{ fontSize: 11, lineHeight: 1.45, color: T.ink }}>{t}</div>)}
            </div>
          )}
          {/* v22.11: on a marked green, say once that there is nothing on the map to price but distance */}
          {d.mapNote && (
            <div data-part="map-note" className={compact ? "lc-clamp1" : undefined} style={{ marginTop: 8, paddingTop: 7, borderTop: hairline, fontSize: 11, lineHeight: 1.45, color: T.ink }}>{d.mapNote}</div>
          )}
          {/* v22.15 §5: the hole's strokes so far — the back door for an intent or a ball position after the fact */}
          {r.shots && (
            <button data-part="shots-button" onClick={() => setShotsOpen(true)}
              style={{ position: "absolute", left: 0, bottom: 0, width: 250, height: 48, borderTop: rule, borderRight: hairline, background: T.paper, color: T.ink, textAlign: "center", ...caps(10, 700, "0.14em") }}>
              {COPY.shots} · <span style={{ ...printed(12), letterSpacing: 0 }}>{holeRecords.filter((x) => x.shotType !== "putt").length}</span>
              {r.unreviewed > 0 && <span style={{ ...printed(12), color: T.bogey, letterSpacing: 0 }}> ?</span>}
            </button>
          )}
          {/* 6. nudge (§3.3 item 6, spec §5.5): one line per nudge, then per contact flag; nothing when none */}
          {d.today.length > 0 && (
            <div data-part="today" style={{ marginTop: 8, paddingTop: 7, borderTop: hairline, display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ ...k9, flex: "none" }}>Today</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                {/* never clamped, even at 667: the correction after the → is the point of the line */}
                {d.today.map((t, i) => <span key={i} style={{ fontFamily: F.label, fontSize: 12, lineHeight: 1.35, color: T.black }}>{t}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bar (§3.4). Log shot (S4) shrinks the primary to flex 1.45 whenever it's shown. */}
      <div data-part="bar" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barH, background: T.paper, borderTop: `4px double ${T.ink}`,
        padding: `12px 18px ${safe.bottom + 10}px`, display: "flex", gap: 10, zIndex: 21 }}>
        <button onClick={() => v.bar.primary.action && act(v.bar.primary.action)} disabled={!!v.bar.primary.disabled} className={v.bar.primary.disabled ? undefined : "lc-primary"}
          style={{ ...primaryPill, flex: v.bar.secondary ? 1.45 : 1, height: 52, opacity: v.bar.primary.disabled ? 0.72 : 1 }}>
          <FlagGlyph />{v.bar.primary.label}
        </button>
        {v.bar.secondary && (
          <button onClick={() => act(v.bar.secondary.action)} style={{ ...outlinedPill, flex: 1, height: 52 }}>{v.bar.secondary.label}</button>
        )}
      </div>

      {pickerM && (
        <ChipPicker model={pickerM} windDir={windDir} setWindDir={setWindDir} onClose={() => { setPicker(null); setWindDir(null); }}
          onPick={(val) => applyChip(picker, val)} onInferred={() => applyChip(picker, null)} />
      )}
      {yardsOpen && <YardsSheet initial={yardsInitial} onClose={() => setYardsOpen(false)} onUse={(y) => { const same = yardsOpen === "same"; setYardsOpen(false); dispatch({ type: "yards", yards: y, same }); }} />}
      {markHereOpen && (markHereAt || cs.ball) && (
        <CaddieSheet onClose={() => { setMarkHereOpen(false); setMarkHereAt(null); }} label={COPY.markHere}>
          <div style={{ ...caps(12), marginBottom: 8 }}>{COPY.markHere}</div>
          <div style={{ fontFamily: F.label, fontSize: 13, lineHeight: 1.45, color: T.ink, marginBottom: 14 }}>
            Stand on the green of hole <span style={printed(14)}>{n}</span>. Loop keeps this spot as its green
            {Number.isFinite((markHereAt || cs.ball).accuracyM) ? <> ({markHereAt ? "test tap" : "GPS"} ±<span style={printed(14)}>{Math.round((markHereAt || cs.ball).accuracyM)}</span> m)</> : null} for every round here.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button data-part="mark-here-confirm" onClick={() => { const at = markHereAt || cs.ball; setMarkHereOpen(false); setMarkHereAt(null); markGreen({ lat: at.lat, lon: at.lng }); }} className="lc-primary" style={{ ...primaryPill, flex: 1.45, height: 52 }}><FlagGlyph />Mark green</button>
            <button onClick={() => { setMarkHereOpen(false); setMarkHereAt(null); }} style={{ ...outlinedPill, flex: 1, height: 52 }}>Cancel</button>
          </div>
        </CaddieSheet>
      )}
      {logSheet && (
        <LongCardSheet record={logSheet.record} clubOrder={profile?.clubOrder || []}
          onQuick={(dr) => commitLog((r) => (r.recommendation
            ? quickLog({ ...r, club: dr.club ?? r.club, linePlayed: undefined, curve: dr.curve, curveSource: dr.curveSource })
            // v22.12 no recommendation: the club off the card; shot type re-defaults for it
            : quickLog({ ...r, club: dr?.club ?? r.club, shotType: undefined, curve: dr.curve, curveSource: dr.curveSource, history: allShots(safeStorage()) })))}
          onSave={(fields) => commitLog((r) => detailLog(r, fields))}
          onSkip={() => commitLog((r) => skipShot(r))}
          onClose={cancelLogSheet} />
      )}
      {shotsOpen && (() => {
        const all = roundId ? loadShots(safeStorage(), roundId) : [];
        const ctx = reviewContext({ course, geometry, nineMap, n, records: all.filter((x) => x.hole === n) });
        return (
          <ReviewSheet mode="shots" n={n} records={all} ctx={ctx} clubOrder={profile?.clubOrder || []} config={config}
            base={{ roundId: roundId ?? null, courseId, nine: n <= 9 ? "front" : "back" }}
            onClose={() => setShotsOpen(false)}
            onDone={(changed, deleted, { all: story }) => {
              writeReview(changed, deleted, roundId);
              setShotsRev((x) => x + 1);
              // the map's previous-shot lines follow the edited positions (the caddie's ball frame is the review frame)
              const { shots: ss } = splitHole(story, n);
              const lines = ss.map((r) => { const p = recPoints(r, ctx.F, ctx.sameFrame); return p.s && p.e ? { from: p.s, to: p.e } : null; }).filter(Boolean);
              if (lines.length) dispatch({ type: "lines", hole: n, lines });
              setShotsOpen(false);
            }} />
        );
      })()}
      {cs.logCard === "putt" && (
        <PuttSheet initialFt={cs.lastPuttFt ?? 20}
          onMade={(distanceFt) => {
            const record = quickMade({ roundId, courseId, hole: n, shotNo: (cs.putts[n] || 0) + 1, distanceFt,
              gps: cs.ball ? { lat: cs.ball.lat, lng: cs.ball.lng, accuracyM: cs.ball.accuracyM } : null });
            saveShotHere(record);
            dispatch({ type: "puttSave", record });
          }}
          onSave={({ distanceFt, speed, breakRead, line }) => {
            const record = newPuttRecord({ roundId, courseId, hole: n, shotNo: (cs.putts[n] || 0) + 1, distanceFt, made: false, speed, breakRead, line,
              gps: cs.ball ? { lat: cs.ball.lat, lng: cs.ball.lng, accuracyM: cs.ball.accuracyM } : null });
            saveShotHere(record);
            dispatch({ type: "puttSave", record });
          }}
          onSkip={() => dispatch({ type: "puttDismiss" })} />
      )}
    </div>
  );
}

/* ---------- v22.15 the hole's story: the Review sheet (SPEC-shotlog-v2 §4) and the Shots list (§5) ----------
   One component for both. `holeReview` (src/caddie/review.js) is the model; the sheet keeps a
   working copy of the hole's records, every edit goes through review.js, and nothing is written
   until Save all / Save (or Later, which keeps the edits but leaves the ? marks). The mini map is a
   compact render of the drawn paper map (overlay.js fallbackMapModel + a linear camera), not a
   second MapLayer: it needs its own taps (Place, Target, Line), no satellite and no camera rules. */

/** The review frame for hole n: the mapped hole's own frame, else the course's north-up anchor frame
    (the same one the caddie keeps an unmapped hole's ball positions in). */
function reviewContext({ course, geometry, nineMap, n, records }) {
  let nm = nineMap;
  if (nm === undefined) { try { nm = geometry && needsNineMap(geometry) ? resolveNineMap(safeStorage(), geometry, course).map : null; } catch (e) { nm = null; } }
  const k = geometry ? geometryKeyFor(geometry, nm, n) : null;
  const hh = course.holes[n - 1];
  let geoHole = null;
  try { geoHole = k != null && hh ? buildHole(geometry, k, { par: hh.par, yards: hh.yards }) : null; } catch (e) { geoHole = null; }
  const first = (records || []).map((r) => r.start || r.gps || r.end).find((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon));
  const F = frameOf(geoHole) || anchorFrame(courseAnchor(course) || (first ? { lat: first.lat, lon: first.lng ?? first.lon } : null));
  const slot = greenSlot(course, n, { apiId: apiIdOf(course), clubId: clubIdOf(course) });
  const g = geoHole ? null : greenFor(loadGreens(safeStorage()), slot.courseId, slot.holeKey);
  const greenPt = g && F ? F.toFrame({ lat: g.lat, lon: g.lon }) : null;
  return { geoHole, F, sameFrame: !!geoHole, greenPt };
}
const ptIn = (F, sameFrame, q, frame) => {
  const g = q && Number.isFinite(q.lat) && Number.isFinite(q.lng ?? q.lon) ? { lat: q.lat, lon: q.lng ?? q.lon } : null;
  return g && F ? F.toFrame(g) : sameFrame && frame && Number.isFinite(frame.x) ? { x: frame.x, y: frame.y } : null;
};
/** A record's start / end / target in the review frame, and its start-line bearing there. */
function recPoints(r, F, sameFrame) {
  const s = ptIn(F, sameFrame, r.start, r.start?.frame);
  const e = ptIn(F, sameFrame, r.end, r.end?.frame);
  const t = ptIn(F, sameFrame, r.intent?.targetLL, r.intent?.target || r.target?.frame);
  const lp = ptIn(F, false, r.intent?.lineLL, null);
  const line = s && lp ? bearingInFrame(s, lp) : s && sameFrame && Number.isFinite(r.intent?.startLineDeg) ? r.intent.startLineDeg : s && t ? bearingInFrame(s, t) : null;
  return { s, e, t, line };
}

const RM_PENCIL = T.pencil;
function ReviewMap({ ctx, shots, selId, mode, onTap, onTargetDrop, height = 184 }) {
  const boxRef = React.useRef(null);
  const [w, setW] = useState(331);
  const [drag, setDrag] = useState(null);
  const dragRef = React.useRef(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0) setW(Math.round(r.width)); };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const { geoHole, F, sameFrame, greenPt } = ctx;
  const pts = shots.map((r) => ({ id: r.id, n: r.shotNo, ...recPoints(r, F, sameFrame) }));
  const vp = { width: w, height };
  const camKey = JSON.stringify(pts.map((p) => [p.s, p.e, p.t].map((q) => q && [Math.round(q.x), Math.round(q.y)])));
  const cam = useMemo(() => {
    const list = [];
    if (geoHole) { list.push(geoHole.tee || { x: 0, y: 0 }); for (const q of geoHole.green?.ring || []) list.push({ x: q[0], y: q[1] }); }
    if (greenPt) list.push({ x: greenPt.x - 14, y: greenPt.y - 14 }, { x: greenPt.x + 14, y: greenPt.y + 14 });
    for (const p of pts) for (const q of [p.s, p.e, p.t]) if (q) list.push(q);
    const b = fitBounds(list) || { minX: -40, minY: -40, maxX: 40, maxY: 260 };
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const hw = Math.max(45, (b.maxX - b.minX) / 2 + 12), hh = Math.max(60, (b.maxY - b.minY) / 2 + 12);
    return cameraFor({ minX: cx - hw, maxX: cx + hw, minY: cy - hh, maxY: cy + hh }, vp, {}, { padding: 10 });
  }, [w, height, geoHole, greenPt && greenPt.x, camKey]);
  const L = linearProjector(cam, vp);
  const base = geoHole ? fallbackMapModel({ hole: geoHole, project: L.project }) : [];
  const sel = pts.find((p) => p.id === selId) || null;
  const selT = drag || sel?.t || null;
  const local = (ev) => { const r = boxRef.current.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const down = (ev) => {
    const pt = local(ev);
    const tp = selT ? L.project(selT) : null;
    if (tp && Math.hypot(pt.x - tp.x, pt.y - tp.y) <= 22 && onTargetDrop) {
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
      dragRef.current = { id: ev.pointerId, p: selT };
      setDrag(selT);
    } else dragRef.current = { id: ev.pointerId, tap: pt };
  };
  const move = (ev) => {
    const d = dragRef.current;
    if (!d || d.id !== ev.pointerId || d.tap) return;
    const q = L.unproject(local(ev));
    d.p = q; setDrag(q);
  };
  const up = (ev) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.id !== ev.pointerId) return;
    if (d.tap) { const pt = local(ev); if (Math.hypot(pt.x - d.tap.x, pt.y - d.tap.y) <= 10 && onTap) onTap(L.unproject(pt)); return; }
    setDrag(null);
    if (d.p && onTargetDrop) onTargetDrop(d.p);
  };
  const P = (q) => L.project(q);
  const f1 = (x) => Math.round(x * 10) / 10;
  return (
    <div ref={boxRef} data-part="review-map" data-mode={mode || "none"} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
      style={{ position: "relative", width: "100%", height, border: rule, background: T.paper, touchAction: "none", overflow: "hidden", cursor: mode ? "crosshair" : "default" }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: "block", pointerEvents: "none" }} aria-hidden="true">
        {renderNodes(base)}
        {greenPt && (() => { const g = P(greenPt); return <circle cx={f1(g.x)} cy={f1(g.y)} r={Math.max(5, 13 * cam.pxPerYd)} fill={T.fillWon} stroke={T.ink} strokeWidth="1" />; })()}
        {pts.map((p) => (p.s && p.e ? (() => { const a = P(p.s), b = P(p.e); return <path key={`l${p.id}`} d={`M${f1(a.x)} ${f1(a.y)} L${f1(b.x)} ${f1(b.y)}`} stroke={RM_PENCIL} strokeWidth={p.id === selId ? 2 : 1.4} strokeDasharray="2.5 5" strokeLinecap="round" fill="none" filter="url(#pencil)" opacity={p.id === selId ? 1 : 0.7} />; })() : null))}
        {sel?.s && Number.isFinite(sel.line) && (() => {
          const a = P(sel.s), r = (sel.line * Math.PI) / 180, b = P({ x: sel.s.x + Math.sin(r) * 1200, y: sel.s.y + Math.cos(r) * 1200 });
          return <line data-part="review-line" x1={f1(a.x)} y1={f1(a.y)} x2={f1(b.x)} y2={f1(b.y)} stroke={RM_PENCIL} strokeWidth="1.3" strokeLinecap="round" filter="url(#pencil)" opacity="0.85" />;
        })()}
        {selT && (() => { const t = P(selT); return (
          <g data-part="review-target">
            {drag && <circle cx={f1(t.x)} cy={f1(t.y)} r="16" fill="none" stroke={RM_PENCIL} strokeWidth="1.1" strokeDasharray="3 3" />}
            <circle cx={f1(t.x)} cy={f1(t.y)} r="9" fill="none" stroke={RM_PENCIL} strokeWidth="1.7" filter="url(#pencil)" />
            <circle cx={f1(t.x)} cy={f1(t.y)} r="2" fill={RM_PENCIL} />
          </g>
        ); })()}
        {pts.map((p) => (p.s ? (() => { const a = P(p.s), on = p.id === selId; return <circle key={`b${p.id}`} data-part={on ? "review-ball" : undefined} cx={f1(a.x)} cy={f1(a.y)} r={on ? 6 : 4} fill={T.paper} stroke={T.black} strokeWidth={on ? 1.6 : 1.1} />; })() : null))}
        {pts.length > 0 && (() => { const lastE = pts[pts.length - 1].e; if (!lastE) return null; const a = P(lastE); return <circle cx={f1(a.x)} cy={f1(a.y)} r="3" fill={T.black} />; })()}
      </svg>
    </div>
  );
}

const RV_TOOL = { height: 30, padding: "0 10px", border: rule, borderRadius: 15, background: "transparent", color: T.ink, ...caps(9, 700, "0.1em") };
const RV_TOOL_ON = { ...RV_TOOL, background: T.ink, color: T.paper, boxShadow: `inset 0 0 0 1.5px ${T.yellow}` };

/**
 * mode "review": the hole's score is written — header, putt stepper, rows, Save all / Later.
 * mode "shots": the Shots list mid-hole (no score yet) — rows, Save / Close.
 * onDone(records, deletedIds, { reviewed }) writes; onClose() leaves without writing.
 */
function ReviewSheet({ mode = "review", n, score = null, records, ctx, clubOrder = [], config = DEFAULT_CONFIG, base = {}, onDone, onClose }) {
  const [recs, setRecs] = useState(() => records.filter((r) => r.hole === n));
  const [deleted, setDeleted] = useState([]);
  const [edited, setEdited] = useState(() => new Set());
  const [open, setOpen] = useState(null);             // the expanded row: record id, or "missing:k"
  const [tool, setTool] = useState(null);             // "place" | "target" | "line" on the mini map
  const [puttCount, setPuttCount] = useState(null);
  const { shots, putts } = splitHole(recs, n);
  const R = holeReview(shots, putts, mode === "review" ? score : null, n, { puttCount: puttCount ?? undefined });
  const count = R.problems.find((p) => p.type === "count");
  const opts = { frame: ctx.F, sameFrame: ctx.sameFrame, cfg: config, hole: n, base: { ...base, hole: n } };
  const touch = (id) => setEdited((s) => new Set([...s, id]));
  const patchRec = (id, patch) => { setRecs((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); touch(id); };
  const onTap = (row) => (p) => {
    if (!tool || !p) return;
    if (tool === "place") {
      const out = placeShot(recs, row.n, p, opts);
      const rec = out.find((r) => r.hole === n && r.shotNo === row.n && r.shotType !== "putt");
      setRecs(out);
      if (rec) { touch(rec.id); setOpen(rec.id); }
      setTool(null);
    } else if (tool === "target" && row.record) {
      setRecs((rs) => setShotIntent(rs, row.record.id, { target: p }, opts)); touch(row.record.id); setTool(null);
    } else if (tool === "line" && row.record) {
      const deg = lineFromTap(recs, row.record.id, p, opts);
      setRecs((rs) => setShotIntent(rs, row.record.id, { startLineDeg: deg }, opts)); touch(row.record.id);
    }
  };
  const addStroke = () => {
    const k = R.header.shots + 1;
    const r = bareShotRecord({ ...base, hole: n, shotNo: k, gps: null });
    setRecs((rs) => [...rs, { ...r, logged: "auto", reviewed: false, contact: null, strike: null, startLine: null, intent: normIntent({}) }]);
    setOpen(r.id); setTool("place");
  };
  const delStroke = (row) => {
    if (!row.record) return;
    const id = row.record.id;
    setRecs(recomputeChain(deleteStroke(recs, id), opts));
    setDeleted((d) => [...d, id]);
    setOpen(null); setTool(null);
  };
  const finish = (reviewed) => {
    let out = renumber(recs);
    if (reviewed) out = reviewAll(out).map((r) => (edited.has(r.id) && r.logged === "auto" ? { ...r, logged: "full" } : r));
    else if (mode === "shots") out = out.map((r) => (edited.has(r.id) ? { ...r, reviewed: true, logged: r.logged === "auto" ? "full" : r.logged } : r));
    if (reviewed && R.puttsNeeded) out = [...out, ...inferredPutts(R.header.putts, { ...base, hole: n, courseId: base.courseId })];
    const changed = reviewed ? out : out.filter((r) => edited.has(r.id) || !records.some((o) => o.id === r.id));
    onDone(changed, deleted, { reviewed, all: out });
  };

  const rowLine = (row) => {
    if (row.kind === "putt") return [`Putt ${row.n}`, row.result];
    const club = row.club ? clubShort(row.club) : "—";
    return [club, row.pos, row.intent, row.result];
  };
  return (
    <div data-part="sheet" data-review={mode} onClick={mode === "shots" ? onClose : undefined}
      style={{ position: "fixed", inset: 0, background: "rgba(31,31,31,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 70 }}>
      <div role="dialog" aria-label={mode === "review" ? `Review hole ${n}` : `Shots, hole ${n}`} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, maxHeight: "94vh", display: "flex", flexDirection: "column", background: T.paper, borderTop: `4px double ${T.ink}` }}>
        <div style={{ padding: "14px 22px 8px", borderBottom: hairline, flex: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={caps(12)}>{mode === "review" ? <>Hole <span style={printed(13)}>{n}</span>{Number.isFinite(score) && <> · <span style={printed(13)}>{score}</span> strokes</>}</> : <>Shots · hole <span style={printed(13)}>{n}</span></>}</span>
            <span data-part="review-counts" style={{ fontFamily: F.label, fontSize: 12, color: T.ink }}>
              <span style={printed(13)}>{R.header.shots}</span> {R.header.shots === 1 ? "shot" : "shots"}{mode === "review" && <> · <span style={printed(13)}>{R.header.putts}</span> {R.header.putts === 1 ? "putt" : "putts"}</>}
            </span>
          </div>
          {mode === "review" && R.puttsNeeded && (
            <div data-part="putt-stepper" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={caps(9)}>Putts</span>
              <button aria-label="One putt fewer" onClick={() => setPuttCount(Math.max(0, R.header.putts - 1))} style={{ ...RV_TOOL, width: 34, padding: 0 }}>−</button>
              <span style={{ ...written(24), minWidth: 18, textAlign: "center" }}>{R.header.putts}</span>
              <button aria-label="One putt more" onClick={() => setPuttCount(R.header.putts + 1)} style={{ ...RV_TOOL, width: 34, padding: 0 }}>+</button>
              <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>no putts logged</span>
            </div>
          )}
          {count && (
            <div data-part="review-mismatch" style={{ fontFamily: F.label, fontSize: 12, color: T.double, marginTop: 6 }}>
              The card says <span style={printed(13)}>{count.score}</span>; this story has <span style={printed(13)}>{count.story}</span>. The score stands.
            </div>
          )}
        </div>
        <div style={{ overflowY: "auto", padding: "0 22px", flex: "1 1 auto" }}>
          {R.rows.map((row) => {
            const id = row.record ? row.record.id : `${row.kind}:${row.n}`;
            const isOpen = open === id;
            const cells = rowLine(row);
            return (
              <div key={id} data-part="review-row" data-kind={row.kind} data-n={row.n} data-open={isOpen ? "true" : "false"} style={{ borderBottom: hairline }}>
                <button onClick={() => { setOpen(isOpen ? null : id); setTool(row.kind === "shot" && !row.record ? "place" : null); }}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: row.kind === "putt" ? "26px 1fr auto 14px" : "26px 52px 46px 50px 1fr 14px", alignItems: "center",
                    gap: 4, height: 40, background: "transparent", color: T.ink, textAlign: "left", padding: 0 }}>
                  <span style={{ ...printed(15), color: T.black }}>{row.kind === "putt" ? "P" : row.n}</span>
                  {cells.map((c, i) => (
                    <span key={i} className="lc-clamp1" style={{ fontSize: i === 0 ? 12 : 11, color: c === "—" ? T.muted : T.ink, fontWeight: i === 0 ? 700 : 400,
                      textAlign: row.kind === "putt" && i === 1 ? "right" : "left", ...(i === cells.length - 1 && row.kind === "shot" ? printed(12) : {}) }}>{c}</span>
                  ))}
                  <span data-part={row.unreviewed ? "review-q" : undefined} style={{ ...printed(14), color: T.bogey, textAlign: "right" }}>{row.unreviewed || row.missing ? "?" : ""}</span>
                </button>
                {isOpen && row.kind === "shot" && (
                  <div data-part="review-detail" style={{ padding: "2px 0 12px" }}>
                    {ctx.F ? (
                      <>
                        <ReviewMap ctx={ctx} shots={splitHole(recs, n).shots} selId={row.record?.id} mode={tool} onTap={onTap(row)}
                          onTargetDrop={row.record ? (p) => { setRecs((rs) => setShotIntent(rs, row.record.id, { target: p }, opts)); touch(row.record.id); } : null} />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 4px" }}>
                          <button data-part="review-place" onClick={() => setTool(tool === "place" ? null : "place")} style={tool === "place" ? RV_TOOL_ON : RV_TOOL}>Place</button>
                          {row.record && <button data-part="review-target-tool" onClick={() => setTool(tool === "target" ? null : "target")} style={tool === "target" ? RV_TOOL_ON : RV_TOOL}>Target</button>}
                          {row.record && <button data-part="review-line-tool" onClick={() => setTool(tool === "line" ? null : "line")} style={tool === "line" ? RV_TOOL_ON : RV_TOOL}>{COPY.line}</button>}
                        </div>
                        {tool && <div style={{ fontFamily: F.label, fontSize: 11, color: T.ink, marginBottom: 4 }}>
                          {tool === "place" ? `Tap the map where shot ${row.n} was played from.` : tool === "target" ? "Tap where you aimed (or drag the ring)." : "Tap the start line; tap the ball to clear it."}
                        </div>}
                      </>
                    ) : <div style={{ fontFamily: F.label, fontSize: 11, color: T.muted, margin: "4px 0 8px" }}>No map or course location for this hole — positions cannot be placed.</div>}
                    {row.record && (() => {
                      const r = row.record;
                      const shape = r.intent?.shape || r.intendedShape || "straight";
                      const lowAcc = !!r.derived?.derivedLowAcc;
                      return (
                        <>
                          <div role="group" aria-label="Shape" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, margin: "4px 0 8px" }}>
                            {COPY.shapes.map(([k, label]) => <SegPill key={k} label={label} current={shape === k} onClick={() => { setRecs((rs) => setShotIntent(rs, r.id, { shape: k }, opts)); touch(r.id); }} />)}
                          </div>
                          {(!r.recommendation || !r.club) && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                              {clubOrder.map((c) => <SegPill key={c} label={clubShort(c)} current={c === r.club} onClick={() => patchRec(r.id, { club: c })} fontSize={10} />)}
                            </div>
                          )}
                          <ScaleSlider title="Contact" options={CONTACT_OPTS} value={r.contact ?? 0} onChange={(val) => patchRec(r.id, { contact: val })} />
                          <ScaleSlider title="Strike" options={wordOpts(["heel", "center", "toe"])} value={r.strike ?? "center"} onChange={(val) => patchRec(r.id, { strike: val })} />
                          <ScaleSlider title="Start line" options={wordOpts(["left", "on", "right"])} value={r.startLine ?? "on"} onChange={(val) => patchRec(r.id, { startLine: val })} />
                          <ScaleSlider title={<>Curve{lowAcc && <span style={{ ...printed(11), color: T.bogey }}> ?</span>}</>} ariaLabel="Curve" options={CURVE_OPTS} value={r.curve ?? 0}
                            onChange={(val) => patchRec(r.id, { curve: val, curveSource: "hand" })} />
                        </>
                      );
                    })()}
                    {/* Delete / Add keep the story in step with the score — the Review sheet's job; mid-hole the
                        caddie's shot count is the story, so the Shots list edits rows but never adds or removes one */}
                    {mode === "review" && row.record && <button data-part="review-delete" onClick={() => delStroke(row)} style={{ ...RV_TOOL, marginTop: 6, color: T.double, borderColor: T.double }}>Delete stroke</button>}
                  </div>
                )}
                {isOpen && row.kind === "putt" && row.record && !row.record.putt?.made && (
                  <div style={{ padding: "2px 0 10px" }}>
                    {PUTT_AXES.map((axis) => (
                      <ScaleSlider key={axis.key} title={axis.label} options={axis.short.map((label, i) => [i - 2, label, axis.options[i]])} value={row.record.putt?.[axis.key] ?? 0}
                        onChange={(val) => patchRec(row.record.id, { putt: { ...row.record.putt, [axis.key]: val } })} />
                    ))}
                    {mode === "review" && <button onClick={() => delStroke(row)} style={{ ...RV_TOOL, marginTop: 6, color: T.double, borderColor: T.double }}>Delete stroke</button>}
                  </div>
                )}
              </div>
            );
          })}
          {mode === "review" && <button data-part="review-add" onClick={addStroke} style={{ ...RV_TOOL, margin: "10px 0 12px" }}>Add stroke</button>}
          {mode === "shots" && R.rows.length === 0 && <div style={{ fontFamily: F.label, fontSize: 12, color: T.muted, padding: "14px 0" }}>No shots on this hole yet.</div>}
        </div>
        <div style={{ display: "flex", gap: 10, padding: "10px 18px calc(env(safe-area-inset-bottom) + 12px)", borderTop: `4px double ${T.ink}`, flex: "none" }}>
          {mode === "review" ? (
            <>
              <button data-part="review-save" onClick={() => finish(true)} className="lc-primary" style={{ ...primaryPill, flex: 1.45, height: 52 }}><FlagGlyph />{COPY.saveAll}</button>
              <button data-part="review-later" onClick={() => finish(false)} style={{ ...outlinedPill, flex: 1, height: 52 }}>{COPY.later}</button>
            </>
          ) : (
            <>
              <button data-part="review-save" onClick={() => finish(false)} className="lc-primary" style={{ ...primaryPill, flex: 1.45, height: 52 }}><FlagGlyph />Save</button>
              <button onClick={onClose} style={{ ...outlinedPill, flex: 1, height: 52 }}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Write what a Review / Shots sheet handed back: upserts, deletes. Returns nothing. */
function writeReview(changed, deleted, roundId) {
  const st = safeStorage();
  if (!st) return;
  for (const id of deleted || []) deleteShot(st, id, roundId);
  for (const r of changed || []) saveShot(st, r);
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
/* The scorecard's shape language, one shape per stroke off par (v22.9): a ring for each
   stroke under, a box for each stroke over, nothing for par — so a 1 on a par 4 has three
   rings and a 7 has three boxes. Near-clean ellipses and squares, alternating slight tilts, a
   small pen-lift gap in each. The outer shape is the same size whatever the count; extra ones
   nest inside it, closing up (and thinning) as they go so the numeral in the middle stays
   clear — at size 22 and 52 the first two land where the v21 ring/box pair did. */
/* v22.14 — no result colouring on a score: every numeral, ring and box is pencil. The shapes
   alone say under or over. (Win / loss colour lives on the match edge marks, not on scores.) */
const RING_TILT = [-8, 12, -4, 9, -11, 5, -6, 10, -3, 7];
const BOX_TILT = [-1.5, 2, -1, 1.5, -2, 1, -0.8, 1.8, -1.2, 0.6];
function MarkShapes({ d, size: S, color = T.pencil, sw = 1.1, font = 15, digits = 1 }) {
  const n = Math.abs(d);
  if (!n) return null;
  const ring = d < 0, c = S / 2;
  const outer = !ring && n === 1 ? S * 0.386 : S * 0.43;                 // half-size of the outer shape
  const inner = Math.max(S * 0.2, font * (digits > 1 ? 0.55 : 0.36));   // keep clear of the numeral
  const base = 3 + (S - 22) * 0.07;
  const step = n > 1 ? Math.min(base, (outer - inner) / (n - 1)) : 0;
  const w = n > 1 ? Math.min(sw, Math.max(0.45, step * 0.5)) : sw;
  const gap = 3 + (S - 22) * 0.05;
  const shapes = [];
  for (let k = 0; k < n; k++) {
    const r = outer - k * step;
    if (ring) {
      const rx = r, ry = r - S * 0.02;
      const per = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
      shapes.push(<ellipse key={k} cx={c} cy={c} rx={rx.toFixed(2)} ry={ry.toFixed(2)} transform={`rotate(${RING_TILT[k % 10]} ${c} ${c})`} strokeDasharray={`${(per - gap).toFixed(1)} ${gap.toFixed(1)}`} />);
    } else {
      const tilt = n === 1 ? 1.5 : BOX_TILT[k % 10];
      shapes.push(<rect key={k} x={(c - r).toFixed(2)} y={(c - r).toFixed(2)} width={(2 * r).toFixed(2)} height={(2 * r).toFixed(2)} rx={S > 40 ? 1.5 : 0}
        transform={`rotate(${tilt} ${c} ${c})`} strokeDasharray={`${(8 * r - gap).toFixed(1)} ${gap.toFixed(1)}`} />);
    }
  }
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, width: S, height: S }} viewBox={`0 0 ${S} ${S}`} fill="none" stroke={color} strokeWidth={w.toFixed(2)}
      aria-hidden="true" data-mark={ring ? "rings" : "boxes"} data-count={n}>
      {shapes}
    </svg>
  );
}

/* v22.14 — a pending score is crossed through in pencil: two slightly irregular strokes, the
   second lifted and landing a little off the first, so it reads as a quick hand-drawn X and
   the numeral underneath stays readable. `seed` nudges the strokes per score so a row of
   them is not a row of clones. `filtered` is false where an ancestor already carries #pencil
   (the chooser button, the You box) so the grain is not applied twice. Drawn in a 100-unit box. */
const X_STROKES = [
  ["M20 17 Q47 42 81 85", "M82 15 Q55 49 18 84"],
  ["M18 20 Q50 45 83 82", "M84 19 Q51 50 21 83"],
  ["M21 15 Q46 50 80 86", "M80 20 Q54 45 17 81"],
];
function PencilX({ size: S, seed = 0, filtered = true }) {
  const [a, b] = X_STROKES[Math.abs(seed) % X_STROKES.length];
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, width: S, height: S, pointerEvents: "none", ...(filtered ? { filter: "url(#pencil)" } : null) }}
      viewBox="0 0 100 100" fill="none" stroke={T.pencil} strokeWidth={(1.6 * 100 / S).toFixed(2)} strokeLinecap="round" aria-hidden="true" data-mark="pending-x">
      <path d={a} /><path d={b} />
    </svg>
  );
}

/* A score written on a scorecard, with the shapes the chooser uses. */
function PencilMark({ score, par, size = 22, font = 15 }) {
  if (score == null) return <span style={{ ...written(14, T.muted) }}>·</span>;
  const d = score - par;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size }}>
      <MarkShapes d={d} size={size} font={font} digits={String(score).length} />
      <span style={{ position: "relative", ...written(font) }}>{score}</span>
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
/* §5.7 aggression scorecard — the Safe / Aggressive / Own-call counts and what aggression paid or
   cost against the engine's price. Printed numbers on paper; renders nothing without logged shots.
   Display only: nothing here reaches a recommendation. */
function AggressionLines({ view, label = "Lines played", size = 11 }) {
  if (!view) return null;
  return (
    <div data-part="aggression" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={caps(10)}>{label}</span>
        <span style={{ fontFamily: F.label, fontSize: size, color: T.ink }}>
          {view.counts.map((c, i) => <React.Fragment key={c.key}>{i ? " · " : ""}{c.label} <span style={printed(size + 1)}>{c.n}</span></React.Fragment>)}
        </span>
      </div>
      {view.text && (
        <div style={{ fontFamily: F.label, fontSize: size + 1, color: T.black, textAlign: "right" }}>
          {view.word ? <>{view.word} <span style={printed(size + 3)}>{view.amount}</span></> : view.text}
        </div>
      )}
    </div>
  );
}

function Summary({ course, ghost, scores, history, roundId, onEditScore, onReset }) {
  const m = evalMatch(scores, ghost.holes);
  // §5.7 — this round's saved shots against its live hole scores (an edit re-prices it).
  const aggView = useMemo(() => {
    if (!roundId) return null;
    try { return aggressionModel(loadShots(safeStorage(), roundId), [], { [roundId]: scores }).rounds[roundId] || null; } catch (e) { return null; }
  }, [roundId, scores]);
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

      {/* the lines played (§5.7) — only when the caddie logged shots this round */}
      {aggView && (
        <div style={{ padding: "12px 0 0", marginTop: 12, borderTop: rule }}>
          <AggressionLines view={aggView} />
        </div>
      )}

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
   <a download> is the desktop/browser fallback. Shared by the round backup and (§8) the shot log. */
async function shareOrDownload(text, name, shareTitle) {
  try {
    const file = new File([text], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle });
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
  } catch (e) {
    // Clipboard fallback (spec §8: "share sheet / download, clipboard fallback").
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return "Copied"; }
    } catch (e2) { /* fall through */ }
    return "Export failed";
  }
}
async function exportRounds(history) { return shareOrDownload(backupPayload(history), backupName(), "Loop Golf rounds"); }
/* §8 — shot log export/import, same share/download/clipboard path as round backups. */
const shotLogName = () => `loop-shots-${new Date().toISOString().slice(0, 10)}.json`;
async function exportShotLog() { return shareOrDownload(exportShots(safeStorage()), shotLogName(), "Loop shot log"); }
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

/* Read-only finished-card view for one of Brett's imported scorecards (v22.8). No ghost, no
   points — these predate Loop, so there's nothing to score them against. Deliberately its own
   small component rather than a read-only mode bolted onto Summary: Summary's whole shape (the
   match line, the segments, the record) assumes a ghost and evalMatch, neither of which a seed
   round has. */
function SeedCardView({ seed, onBack }) {
  const cols = "26px repeat(9, minmax(0, 1fr)) 28px 30px";
  const nine = (start) => {
    const isIn = start === 9;
    const idx = [...Array(9)].map((_, k) => start + k);
    const sum = (f) => idx.reduce((a, i) => a + f(i), 0);
    const cell = (extra) => ({ display: "flex", alignItems: "center", justifyContent: "center", ...extra });
    const row = (label, get, tot, all, h, under, style) => (
      <React.Fragment key={label}>
        <div style={cell({ height: h, justifyContent: "flex-start", paddingLeft: 3, borderRight: rule, borderBottom: `1px solid ${under}`, fontFamily: F.label, fontSize: 9, fontWeight: 700 })}>{label}</div>
        {idx.map((i, k) => (
          <div key={i} style={cell({ height: h, padding: 0, border: "none", borderRight: `1px solid ${k % 3 === 2 ? T.ink : T.hair}`, borderBottom: `1px solid ${under}`, ...style })}>
            {get(i)}
          </div>
        ))}
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
        {row("par", (i) => seed.pars[i], sum((i) => seed.pars[i]), seed.pars.reduce((a, b) => a + b, 0), 20, T.hair, { ...printed(11, 400), color: T.ink })}
        {/* imported cards are pencil too — Brett wrote these on paper before Loop existed */}
        {row("you", (i) => <PencilMark score={seed.scores[i]} par={seed.pars[i]} />, sum((i) => seed.scores[i] ?? 0), seed.scores.reduce((a, b) => a + (b ?? 0), 0), 28, T.hair, written(18))}
        {row("yds", (i) => seed.yards[i] ?? "—", sum((i) => seed.yards[i] || 0), seed.yards.reduce((a, b) => a + (b || 0), 0), 18, T.ink, { ...printed(10, 400), color: T.muted })}
      </div>
    );
  };
  const par = seed.pars.reduce((a, b) => a + b, 0);
  const toPar = seed.cardTotal - par;
  const tp = toPar === 0 ? "even" : toPar > 0 ? `+${toPar}` : `${toPar}`;
  return (
    <div style={{ minHeight: "100dvh", maxWidth: 460, margin: "0 auto", boxSizing: "border-box", background: T.paper,
      padding: "max(env(safe-area-inset-top), 26px) 20px max(env(safe-area-inset-bottom), 28px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 10, borderBottom: rule }}>
        <button onClick={onBack} style={{ background: "none", border: "none", padding: "6px 0", color: T.ink, ...caps(11) }}>‹ Back</button>
        <span style={caps(11)}>Imported card</span>
      </div>
      <div style={{ textAlign: "center", padding: "14px 0", borderBottom: rule }}>
        <div style={caps(10)}>card · {seed.course} · {fmtDate(seed.date)}</div>
        <div style={{ ...writtenWord(30), lineHeight: "34px", marginTop: 4 }}>{seed.tee}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 6px" }}>
        <span style={caps(10)}>The card</span>
        <span style={{ fontFamily: F.label, fontSize: 11 }}>
          <span style={printed(12)}>{seed.rating}</span>/<span style={printed(12)}>{seed.slope}</span> · <span style={written(17)}>{tp}</span>
        </span>
      </div>
      {nine(0)}
      {nine(9)}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 4px 0", fontFamily: F.label, fontSize: 11, color: T.muted }}>
        <span>Card total <span style={printed(12)}>{seed.cardTotal}</span></span>
        {seed.cardTotal !== seed.gross && <span>Differential adj. <span style={printed(12)}>{seed.gross}</span></span>}
      </div>
    </div>
  );
}

function History({ history, stats, cloud, onDelete, onImport, onBack }) {
  const [confirmId, setConfirmId] = useState(null);
  const [viewSeed, setViewSeed] = useState(null);
  const [msg, setMsg] = useState("");
  // §5.7 — per round and season, from the saved shot records and each round's hole scores.
  const [shotsRev, setShotsRev] = useState(0);
  const agg = useMemo(() => { try { return aggressionModel(allShots(safeStorage()), history); } catch (e) { return { season: null, rounds: {} }; } }, [history, shotsRev]);
  const [busy, setBusy] = useState(false);
  const fileRef = React.useRef(null);
  const shotFileRef = React.useRef(null);
  // v22.8: the ledger merges played rounds with Brett's imported seed scorecards, newest first.
  const rows = useMemo(() => historyRows(history, SEED_ROUNDS), [history]);

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
  /* §8 — shot log export/import: same pattern, exportShots/importShots (shotlog.js) do the work. */
  const doExportShots = async () => {
    const total = allShots(safeStorage()).length;
    if (!total) { setMsg("No shots logged yet."); return; }
    const r = await exportShotLog();
    if (r) setMsg(`${r} ${total} shot${total === 1 ? "" : "s"}.`);
  };
  const doImportShots = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      let result;
      try { result = importShots(safeStorage(), String(fr.result)); }
      catch (e2) { setMsg("That doesn't look like a Loop shot log."); return; }
      setShotsRev((x) => x + 1);
      setMsg(`Imported ${result.added} shot${result.added === 1 ? "" : "s"}${result.updated ? ` · ${result.updated} updated` : ""}.`);
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

  if (viewSeed) return <SeedCardView seed={viewSeed} onBack={() => setViewSeed(null)} />;

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
        {agg.season && <div style={{ paddingTop: 4, borderTop: hairline, marginTop: 2 }}><AggressionLines view={agg.season} label="Season lines" /></div>}
      </div>

      {/* the ledger */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 4px" }}>
        <span style={caps(10)}>Rounds</span>
        <span style={{ fontFamily: F.label, fontSize: 11, color: T.muted }}>newest first</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontFamily: F.label, fontSize: 12, color: T.muted, padding: "26px 0", textAlign: "center", borderTop: rule, borderBottom: rule }}>
          No rounds logged yet.
        </div>
      ) : (
        <div style={{ borderTop: rule }}>
          {rows.map(row => {
            if (row.kind === "card") {
              const s = row.seed;
              return (
                /* imported scorecard — no ghost, no points, no delete. A neutral hairline edge
                   (not a W/L/T colour) so it never reads as part of the record tally. */
                <button key={`card:${s.date}:${s.course}`} onClick={() => setViewSeed(s)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none",
                    border: "none", borderBottom: rule, borderLeft: `4px solid ${T.hair}`, padding: "8px 8px 7px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ ...writtenWord(21), lineHeight: "21px", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.course}
                    </span>
                    <span style={{ ...written(18), whiteSpace: "nowrap" }}>
                      {s.cardTotal}
                      {s.cardTotal !== s.gross && <span style={{ fontFamily: F.label, fontSize: 10, fontWeight: 700, color: T.muted, marginLeft: 5 }}>adj {s.gross}</span>}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, fontFamily: F.label, fontSize: 11, color: T.ink }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.tee} · {fmtDate(s.date)}</span>
                    <span style={{ color: T.muted }}>·</span>
                    <span style={{ ...caps(9, 700, "0.12em"), color: T.muted }}>card</span>
                  </div>
                </button>
              );
            }
            const r = row.round;
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
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.tee}{r.routing ? ` · ${r.routing}` : ""}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: T.muted }}>
                    {margin >= 0 ? "+" : ""}{margin.toFixed(1)}{rd != null ? ` · diff ${rd.toFixed(1)}` : ""}
                  </span>
                </div>
                {agg.rounds[r.id] && (() => {
                  const a = agg.rounds[r.id];
                  return (
                    <div data-part="aggression-row" style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 6, marginTop: 2, fontFamily: F.label, fontSize: 11, color: T.ink }}>
                      {a.text && <span style={{ color: T.black }}>{a.word} <span style={printed(12)}>{a.amount}</span></span>}
                      {a.text && <span style={{ color: T.muted }}>·</span>}
                      <span>{a.counts.map((c, i) => <React.Fragment key={c.key}>{i ? " · " : ""}{c.label} <span style={printed(12)}>{c.n}</span></React.Fragment>)}</span>
                    </div>
                  );
                })()}
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
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button onClick={doExportShots} style={{ ...outlinePill, flex: 1 }}>Export shot log</button>
          <button onClick={() => shotFileRef.current && shotFileRef.current.click()} style={{ ...outlinePill, flex: 1 }}>Import shot log</button>
        </div>
        <input ref={shotFileRef} type="file" accept="application/json,.json" onChange={doImportShots} style={{ display: "none" }} />
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
const DEFAULT_STATE = { screen: "setup", course: null, diff: 7.9, scores: Array(18).fill(null), hole: 0, roundId: null, caddie: null };
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
    // Resume ONLY a genuinely in-progress round. The caddie (v22) is the play screen: a round
    // left on it comes back on it, exactly as it was (addendum §9.8) — Start round opens it, so its
    // state under `caddie` marks a started round even before the first score. A scorecard round
    // resumes on the scorecard once a hole is scored or a caddie round is under way. A finished
    // summary opens the menu.
    const caddie = course && scoresOk ? restoreCaddie(s.caddie) : null;
    const resumeCaddie = s.screen === "caddie" && course && scoresOk && (caddie || played >= 1);
    const resumePlay = s.screen === "play" && course && scoresOk && (played >= 1 || caddie);
    return {
      screen: resumeCaddie ? (caddie ? "caddie" : "play") : resumePlay ? "play" : "setup",
      caddie: resumeCaddie || resumePlay ? caddie : null,
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
  /* The caddie's state for this round (addendum §9.8): App-level so ‹ Card keeps it, saved on every change. */
  const [caddie, dispatchCaddie] = React.useReducer((st, a) => (a.type === "reset" ? a.state : st ? caddieReducer(st, a) : st), initial.caddie);
  const caddieCtx = React.useRef(null);
  const [weather, setWeather] = useState(null);
  const [profileBase, setProfile] = useState(loadCaddieProfile);
  const [history, setHistory] = useState(loadHistory());
  const [testMode, setTestModeState] = useState(loadTestMode);
  const setTestMode = (on) => { saveTestMode(on); setTestModeState(!!on); };
  // §5.2–§5.4: Loop's between-round overlays, rebuilt when history changes and each time the
  // caddie opens (a shot-log import lands in storage, not in React state).
  const caddieOpen = screen === "caddie";
  const profile = useMemo(() => withLearning(profileBase, history), [profileBase, history, caddieOpen]);
  const [tombs, setTombs] = useState(loadTombs());
  const cloud = useCloudSync(history, setHistory, tombs, setTombs);
  const courseMap = useCourseMap(course);
  useEffect(() => { saveState({ screen, course, diff, scores, hole, roundId, caddie: serializeCaddie(caddie, caddieCtx.current) }); }, [screen, course, diff, scores, hole, roundId, caddie]);
  // §2 caddie hole rule: writing the caddie hole's score moves it to the lowest unscored hole, pre-tee.
  useEffect(() => { dispatchCaddie({ type: "scores", scores }); }, [scores]);
  useEffect(() => { saveHistory(history); }, [history]);
  useEffect(() => { saveTombs(tombs); }, [tombs]);
  const ghost = useMemo(() => course ? computeGhost(course, diff) : null, [course, diff]);
  const stats = useMemo(() => deriveStats(history), [history]);
  // Start round → the caddie, hole 1, pre-tee (addendum §2). The round gets its id now (not at
  // finalize) so shots logged mid-round carry the same roundId the finished history record ends
  // up with — S4 §4.6.
  const start = () => { if (!course) return; setScores(Array(18).fill(null)); setHole(0); setRoundId(newId()); dispatchCaddie({ type: "reset", state: initialCaddie(1) }); setScreen("caddie"); };
  // Exit an unfinished round without saving it: clear scores and return to the menu.
  const exitRound = () => { setScores(Array(18).fill(null)); setHole(0); setRoundId(null); dispatchCaddie({ type: "reset", state: null }); setScreen("setup"); };
  // Scorecard → caddie. A round resumed from before v22 has no caddie yet: start one on the caddie hole.
  const openCaddie = () => { if (!caddie) dispatchCaddie({ type: "reset", state: initialCaddie(caddieHoleFor(scores) || hole + 1) }); setScreen("caddie"); };
  // ‹ Card and Score hole N → the scorecard on the caddie's hole (§2).
  const openCard = (n) => { setHole(Math.max(0, Math.min(17, (n || (caddie ? caddie.hole : hole + 1)) - 1))); setScreen("play"); };
  // Finalize: persist the finished round, then a soft (editable) transition to summary.
  const finalize = (finalScores) => {
    const rec = buildRecord({ id: roundId || newId(), date: nowISO() }, course, diff, finalScores, ghost);
    setHistory(h => [...h, rec]);
    setRoundId(rec.id);
    dispatchCaddie({ type: "reset", state: null });
    setScreen("summary");
  };
  // Edit a hole from the summary: recompute in place; if finalized, update the stored round.
  const editScore = (i, v) => {
    const ns = scores.map((s, k) => k === i ? Math.max(1, v) : s);
    setScores(ns);
    if (roundId) setHistory(h => h.map(r => r.id === roundId ? buildRecord({ id: r.id, date: r.date }, course, diff, ns, ghost) : r));
  };
  const reset = () => { setRoundId(null); setScreen("setup"); };
  /* v22.15 §4 — a score written on the card: the Review sheet first when the hole's story needs it
     (an unreviewed or missing stroke, or a putt count that does not match); the move the card was
     about to make (the next blank hole, or finishing the round) waits until it closes. */
  const onScored = (n, score, next) => {
    if (!caddie || !roundId) return false;
    let need = false;
    try { need = reviewNeeded(loadShots(safeStorage(), roundId), n, score); } catch (e) { need = false; }
    if (!need) return false;
    dispatchCaddie({ type: "reviewOpen", hole: n, next });
    return true;
  };
  const reviewInfo = (n) => {
    if (!roundId) return null;
    try {
      const mine = loadShots(safeStorage(), roundId).filter((r) => r.hole === n);
      return mine.length ? { n: mine.length, unreviewed: mine.filter((r) => r.reviewed === false).length } : null;
    } catch (e) { return null; }
  };
  const closeReview = () => {
    const next = caddie?.review?.next ?? null;
    dispatchCaddie({ type: "reviewClose" });
    if (next === "finish") finalize(scores);
    else if (Number.isInteger(next)) setHole(next);
  };
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
      {screen === "setup" && <Setup course={course} setCourse={setCourse} diff={diff} setDiff={setDiff} stats={stats} history={history} onStart={start} onHistory={() => setScreen("history")} courseMap={courseMap}
        testMode={testMode} setTestMode={setTestMode} />}
      {screen === "play" && course && ghost && <Play course={course} ghost={ghost} scores={scores} setScores={setScores} hole={hole} setHole={setHole} onFinish={finalize} onExit={exitRound} onCaddie={openCaddie}
        onScored={onScored} reviewInfo={reviewInfo} onReview={(n) => { if (caddie) dispatchCaddie({ type: "reviewOpen", hole: n, next: null }); }} />}
      {screen === "caddie" && course && caddie && <Caddie course={course} geometry={courseMap.geometry} profile={profile} cs={caddie} dispatch={dispatchCaddie}
        weather={weather} setWeather={setWeather} contextRef={caddieCtx} roundId={roundId} onCard={() => openCard()} onScore={(n) => openCard(n)} onRetryProfile={() => setProfile(loadCaddieProfile())}
        testMode={testMode} />}
      {caddie && caddie.review && course && (screen === "play" || screen === "caddie") && (() => {
        const n = caddie.review.hole;
        const all = roundId ? loadShots(safeStorage(), roundId) : [];
        const ctx = reviewContext({ course, geometry: courseMap.geometry, nineMap: undefined, n, records: all.filter((r) => r.hole === n) });
        return (
          <ReviewSheet key={`review-${n}`} mode="review" n={n} score={scores[n - 1]} records={all} ctx={ctx} clubOrder={profile?.clubOrder || []} config={profile?.config || DEFAULT_CONFIG}
            base={{ roundId: roundId ?? null, courseId: apiIdOf(course), nine: n <= 9 ? "front" : "back" }}
            onClose={closeReview} onDone={(changed, deleted) => { writeReview(changed, deleted, roundId); closeReview(); }} />
        );
      })()}
      {screen === "summary" && course && ghost && <Summary course={course} ghost={ghost} scores={scores} history={history} roundId={roundId} onEditScore={editScore} onReset={reset} />}
      {screen === "history" && <History history={history} stats={stats} cloud={cloud} onDelete={deleteRound} onImport={importRounds} onBack={() => setScreen("setup")} />}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
