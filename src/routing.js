/*
 * routing.js — clubs with more than 18 holes (v22.7, Brett Sep 29).
 *
 * The course picker shows a club once; the nines played are chosen on Setup beside the tee.
 * Pure: no DOM, no fetch. Storage is injected (getItem / setItem), as in src/caddie/.
 *
 * Two API shapes are handled (golfcourseapi.com):
 *   1. The usual one: a 27-hole club is SEVERAL search results sharing one `club_name`, one per
 *      18-hole routing ("Village/School", "Mill/School", …), each with its own 18-hole tees and
 *      its own rating/slope. groupResultsByClub folds them into one row; each is a "routing".
 *   2. Rarer: one result whose tee carries 27 holes. splitTee27 cuts it into three nines and
 *      the routings are the three two-nine combinations (nineCombos / teeForCombo).
 */

export const LAST_ROUTING_KEY = "bogeyman-matches:lastRouting:v1";

const norm = (x) => (typeof x === "string" ? x.trim().replace(/\s+/g, " ").toLowerCase() : "");
/**
 * Grouping key for a search result: its club_name, trimmed and lower-cased, plus the state when
 * the API gives one (two clubs called "Heritage Golf Club" in different states are not one club).
 * null = no club_name: the result stands alone.
 */
export const clubKeyOf = (name, location) => {
  const n = norm(name);
  if (!n) return null;
  const st = norm(location && location.state);
  return st ? `${n}|${st}` : n;
};

const idLess = (a, b) => (typeof a === "number" && typeof b === "number" ? a < b : String(a) < String(b));

/**
 * Search results → one entry per club, in first-appearance order.
 * { key, club_name, location, entries: [result…], clubApiId }
 * clubApiId is the lowest API id in the group: the geometry cache and tile prefetch key on it,
 * because the OSM map is one per club, not one per routing. A single-entry club keeps its own id,
 * so every 18-hole course keeps the cache key it has today.
 */
export function groupResultsByClub(results) {
  const out = [];
  const byKey = new Map();
  (results || []).forEach((r, i) => {
    if (!r) return;
    const k = clubKeyOf(r.club_name, r.location);
    const hit = k != null ? byKey.get(k) : null;
    if (hit) {
      hit.entries.push(r);
      if (r.id != null && idLess(r.id, hit.clubApiId)) hit.clubApiId = r.id;
      return;
    }
    const g = { key: k ?? `id:${r.id ?? i}`, club_name: (r.club_name || r.course_name || "").trim(), location: r.location || null, entries: [r], clubApiId: r.id };
    out.push(g);
    if (k != null) byKey.set(k, g);
  });
  return out;
}

/** The nine names in a routing's course_name ("Village/School" → ["Village", "School"]), or null. */
export function routingNines(entry) {
  const raw = stripClub(entry);
  if (!raw || !raw.includes("/")) return null;
  const parts = raw.split("/").map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

/* course_name without a leading copy of the club name ("Chicopee Woods - Village/School" → "Village/School"). */
function stripClub(entry) {
  const course = String(entry?.course_name || "").trim();
  const club = String(entry?.club_name || "").trim();
  if (club && course.toLowerCase().startsWith(club.toLowerCase()) && course.length > club.length) {
    return course.slice(club.length).replace(/^[\s\-–—:|,·]+/, "").trim();
  }
  return course;
}

/** The label a routing pill shows: "Village/School" → "Village / School"; else the course_name. */
export function routingLabel(entry) {
  const nines = routingNines(entry);
  if (nines) return nines.join(" / ");
  return stripClub(entry) || String(entry?.club_name || "").trim() || "Course";
}

/* ---------- a single 27-hole tee ---------- */

/* The API has not been seen naming nines on a tee; accept `nine_names: [..3]` or `nines: [..3]`
   (strings or { name }) when present, else "1", "2", "3". */
function nineNamesOf(tee) {
  const src = Array.isArray(tee?.nine_names) ? tee.nine_names : Array.isArray(tee?.nines) ? tee.nines : null;
  if (src && src.length === 3) {
    const names = src.map((x) => String((x && typeof x === "object" ? x.name : x) ?? "").trim());
    if (names.every(Boolean) && new Set(names.map((n) => n.toLowerCase())).size === 3) return names;
  }
  return ["1", "2", "3"];
}

/** A 27-hole tee → [{ label, holes: [9 API holes] }] × 3 (holes 1–9, 10–18, 19–27); null otherwise. */
export function splitTee27(tee) {
  if (!tee || !Array.isArray(tee.holes) || tee.holes.length !== 27) return null;
  const names = nineNamesOf(tee);
  return [0, 1, 2].map((i) => ({ label: names[i], holes: tee.holes.slice(i * 9, i * 9 + 9) }));
}

const nineIndex = (nines, x) => (typeof x === "number" ? x : nines.findIndex((n) => n.label === x));

/** Two nines played in order (a first) → their 18 API holes, par/handicap/yardage untouched. */
export function composeRouting(nines, [a, b]) {
  const i = nineIndex(nines || [], a), j = nineIndex(nines || [], b);
  if (i < 0 || j < 0 || i === j || !nines[i] || !nines[j]) return null;
  return [...nines[i].holes, ...nines[j].holes];
}

/** The three two-nine combinations in play order: 1 / 2, 1 / 3, 2 / 3. */
export function nineCombos(nines) {
  if (!Array.isArray(nines) || nines.length !== 3) return [];
  return [[0, 1], [0, 2], [1, 2]].map(([i, j]) => ({ combo: [i, j], nines: [nines[i].label, nines[j].label], label: `${nines[i].label} / ${nines[j].label}` }));
}

/**
 * A tee-shaped object for one combination, so buildCourse maps it like any 18-hole tee.
 * Rating/slope are the 27-hole tee's as given (the caller marks ratingSource); par_total is the
 * composed 18's own par, never the 27-hole total.
 */
export function teeForCombo(tee, nines, combo) {
  const holes = composeRouting(nines, combo);
  if (!holes) return null;
  return { ...tee, holes, par_total: holes.reduce((a, h) => a + (h.par || 0), 0) };
}

/* ---------- the routing played here last ---------- */

/** { [clubKey]: { id, label, clubApiId } } — id is the routing's API id (null for a 27-hole combo). */
export function loadLastRouting(storage, clubKey) {
  if (!storage || clubKey == null) return null;
  try {
    const all = JSON.parse(storage.getItem(LAST_ROUTING_KEY) || "null");
    const v = all && typeof all === "object" ? all[clubKey] : null;
    return v && typeof v === "object" ? v : null;
  } catch { return null; }
}

export function saveLastRouting(storage, clubKey, value) {
  if (!storage || clubKey == null || !value) return false;
  try {
    let all = null;
    try { all = JSON.parse(storage.getItem(LAST_ROUTING_KEY) || "null"); } catch { all = null; }
    const next = { ...(all && typeof all === "object" ? all : {}), [clubKey]: value };
    storage.setItem(LAST_ROUTING_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
}

/** Index of the routing to pre-select: the last one played here (by id, then by label), else 0. */
export function defaultRoutingIndex(routings, last) {
  if (!Array.isArray(routings) || !routings.length) return -1;
  if (last) {
    const byId = last.id != null ? routings.findIndex((r) => r.id != null && String(r.id) === String(last.id)) : -1;
    if (byId >= 0) return byId;
    const byLabel = last.label ? routings.findIndex((r) => r.label === last.label) : -1;
    if (byLabel >= 0) return byLabel;
  }
  return 0;
}
