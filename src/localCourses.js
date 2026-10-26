/*
 * localCourses.js — courses the course API (golfcourseapi.com) does not have, bundled in the API's own
 * shape so Setup, the ghost and the caddie read them like any API course (v22.71, D146).
 *
 * Bobby Jones Golf Course (Atlanta, GA; Bob Cupp, 2018) is a reversible nine on nine double greens: the
 * Azalea routing (red flags, counter-clockwise) one day, the Magnolia (white flags, clockwise) the next, with
 * the Longleaf tee system's eight numbered tees. golfcourseapi has no entry for it (its only "Bobby Jones" is
 * in Sarasota, FL; checked Oct 26 2026), so the card is bundled here from the published GolfPass scorecard:
 * an 18 is the Azalea nine played twice, so each tee's 18 holes are its 9 twice (handicap 1–9 twice; the
 * odd/even rule in routing.js spreads them to 1–18) and its rating is the 9-hole rating doubled with the
 * 9-hole slope, the USGA's rule for a nine played twice. NOT verified against the printed card: Brett checks
 * the rating and slope on the first tee (F47).
 *
 * A bundled course's `id` has no ":" (buildCourse keys the round `${id}:${teeKey}` and apiIdOf splits on it).
 * The same id keys its map in src/localGeometry/. Pure data plus two lookups; no DOM, no fetch.
 */

const AZALEA = {
  par: [5, 3, 4, 4, 5, 4, 3, 4, 4],
  handicap: [2, 9, 3, 7, 6, 4, 8, 5, 1],
  // GolfPass "Bobby Jones Golf Course - The Azalea Nine" scorecard, read Oct 26 2026: yards per tee, then the
  // 9-hole rating and slope (men / women) from the same table's row attributes
  tees: [
    { name: "Tee 8", yards: [616, 223, 441, 329, 505, 402, 195, 486, 452], m: [36.9, 132], f: [40.4, 142] },
    { name: "Tee 7", yards: [557, 200, 415, 315, 490, 377, 171, 465, 411], m: [35.7, 128], f: [38.8, 136] },
    { name: "Tee 6", yards: [521, 179, 404, 300, 424, 360, 164, 425, 363], m: [34.5, 121], f: [37.6, 131] },
    { name: "Tee 5", yards: [461, 162, 366, 270, 409, 314, 144, 378, 333], m: [33.6, 107], f: [35.8, 124] },
    { name: "Tee 4", yards: [406, 145, 352, 241, 356, 282, 129, 338, 275], m: [32.2, 101], f: [34.1, 115] },
    { name: "Tee 3", yards: [368, 131, 293, 215, 325, 244, 116, 308, 232], m: [30.8, 98], f: [32.6, 107] },
    { name: "Tee 2", yards: [316, 112, 219, 177, 278, 212, 100, 265, 212], m: [29.7, 95], f: [30.6, 101] },
    { name: "Tee 1", yards: [265, 95, 185, 155, 219, 176, 82, 220, 185], m: [28.6, 88], f: [28.9, 94] },
  ],
};

/** A nine played twice as an API tee: 18 holes, the 9-hole rating doubled, the 9-hole slope. */
function twiceAround(nine, t, [rating, slope]) {
  const holes = [0, 1].flatMap(() => nine.par.map((par, i) => ({ par, yardage: t.yards[i], handicap: nine.handicap[i] })));
  const yards = holes.reduce((a, h) => a + h.yardage, 0);
  return { tee_name: t.name, course_rating: +(2 * rating).toFixed(1), slope_rating: slope, bogey_rating: null,
    total_yards: yards, total_meters: Math.round(yards * 0.9144), number_of_holes: 18, par_total: 2 * nine.par.reduce((a, p) => a + p, 0), front_course_rating: rating, front_slope_rating: slope, back_course_rating: rating, back_slope_rating: slope, holes };
}

export const LOCAL_COURSES = [
  {
    id: "bobbyjones-azalea",
    club_name: "Bobby Jones Golf Course",
    course_name: "Azalea",
    location: { address: "384 Woodward Way NW, Atlanta, GA 30305, USA", city: "Atlanta", state: "GA", country: "United States", latitude: 33.8167, longitude: -84.4037 },
    tees: {
      male: AZALEA.tees.map((t) => twiceAround(AZALEA, t, t.m)),
      female: AZALEA.tees.map((t) => twiceAround(AZALEA, t, t.f)),
    },
    // what Setup's search matches, besides the club and course names
    aliases: ["bobby jones", "bobby jones golf", "azalea", "bobby jones atlanta", "bobbyjones"],
    source: "GolfPass scorecard (The Azalea Nine), Oct 26 2026; 18-hole rating = 2 × the 9-hole rating, 9-hole slope. Not yet checked against the printed card (F47).",
  },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The bundled courses a Setup search should list for `query` (two letters or more), as API search results. */
export function localCourseSearch(query) {
  const q = norm(query);
  if (q.length < 2) return [];
  return LOCAL_COURSES.filter((c) => {
    const hay = [c.club_name, c.course_name, `${c.club_name} ${c.course_name}`, ...(c.aliases || [])].map(norm);
    return hay.some((h) => h.includes(q) || q.includes(h));
  }).map(({ aliases, source, ...c }) => c);
}

/** The bundled full course for an id, or null. */
export function localFullCourse(id) {
  const c = LOCAL_COURSES.find((x) => String(x.id) === String(id));
  if (!c) return null;
  const { aliases, source, ...full } = c;
  return full;
}

for (const c of LOCAL_COURSES) {
  if (String(c.id).includes(":")) throw new Error(`localCourses: ${c.id} has a ":"`);
  for (const g of ["male", "female"]) for (const t of c.tees[g]) {
    if (t.holes.length !== 18) throw new Error(`localCourses: ${c.id} ${t.tee_name} has ${t.holes.length} holes`);
    if (!Number.isFinite(t.course_rating) || !Number.isFinite(t.slope_rating)) throw new Error(`localCourses: ${c.id} ${t.tee_name} has no rating`);
  }
}
