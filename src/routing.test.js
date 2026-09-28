/*
 * routing.test.js — v22.7 clubs with more than 18 holes: grouping search results by club, the
 * routing label, the single-27-hole-tee split and composition, the last-routing store.
 * Fixtures are inline (golfcourseapi.com is not reachable from the test run).
 * Run: node --test src/routing.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupResultsByClub, clubKeyOf, routingLabel, routingNines, splitTee27, composeRouting, nineCombos, teeForCombo,
  loadLastRouting, saveLastRouting, defaultRoutingIndex, LAST_ROUTING_KEY,
} from "./routing.js";

const GA = { city: "Gainesville", state: "GA" };
const results = [
  { id: 2011, club_name: "Chicopee Woods Golf Course", course_name: "Village/School", location: GA },
  { id: 1776, club_name: "Hampton Golf Village", course_name: "Hampton Golf Village", location: { city: "Hampton", state: "GA" } },
  { id: 2009, club_name: "Chicopee Woods Golf Course ", course_name: "Mill/School", location: GA },
  { id: 2010, club_name: "chicopee woods golf course", course_name: "Village/Mill", location: GA },
  { id: 3001, course_name: "No Club Name Muni", location: GA },
  { id: 3002, course_name: "No Club Name Muni", location: GA },
  { id: 4001, club_name: "Heritage Golf Club", course_name: "Heritage", location: { city: "Tulsa", state: "OK" } },
  { id: 4002, club_name: "Heritage Golf Club", course_name: "Heritage", location: { city: "Hilliard", state: "OH" } },
];

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

test("groupResultsByClub: one row per club (trimmed, case-insensitive), first-appearance order", () => {
  const g = groupResultsByClub(results);
  assert.equal(g.length, 6);
  const chic = g[0];
  assert.equal(chic.club_name, "Chicopee Woods Golf Course");
  assert.deepEqual(chic.entries.map((e) => e.id), [2011, 2009, 2010], "routings keep the API's order");
  assert.equal(chic.clubApiId, 2009, "the club's map keys on its lowest API id");
  assert.deepEqual(chic.location, GA);
  assert.equal(g[1].entries.length, 1);
});

test("groupResultsByClub: single-entry clubs untouched; no club_name stands alone; same name in another state is another club", () => {
  const g = groupResultsByClub(results);
  const hampton = g[1];
  assert.equal(hampton.entries[0], results[1], "the very same result object");
  assert.equal(hampton.clubApiId, 1776, "an 18-hole course keeps its own id as the club key");
  const munis = g.filter((x) => x.club_name === "No Club Name Muni");
  assert.equal(munis.length, 2, "no club_name → never grouped");
  assert.ok(munis.every((x) => x.entries.length === 1));
  const heritage = g.filter((x) => x.club_name === "Heritage Golf Club");
  assert.equal(heritage.length, 2, "OK and OH are two clubs");
  assert.equal(clubKeyOf("  Chicopee  Woods Golf Course ", GA), "chicopee woods golf course|ga");
  assert.equal(clubKeyOf("", GA), null);
  assert.deepEqual(groupResultsByClub(null), []);
});

test("routingLabel / routingNines from course_name", () => {
  assert.equal(routingLabel(results[0]), "Village / School");
  assert.deepEqual(routingNines(results[0]), ["Village", "School"]);
  assert.equal(routingLabel({ club_name: "Ironwood", course_name: "Ironwood - Ridge / Valley" }), "Ridge / Valley", "a leading club name is dropped");
  assert.deepEqual(routingNines({ club_name: "Ironwood", course_name: "Ironwood: Lakes/Ridge" }), ["Lakes", "Ridge"]);
  assert.equal(routingLabel(results[1]), "Hampton Golf Village", "no slash → the course_name");
  assert.equal(routingNines(results[1]), null);
  assert.equal(routingNines({ course_name: "A/B/C" }), null, "three parts is not a two-nine routing");
  assert.equal(routingLabel({ club_name: "Only Club" }), "Only Club");
});

/* a 27-hole tee: pars 4,5,3,… and handicaps 1–27 so every hole is identifiable */
function tee27(extra = {}) {
  const holes = Array.from({ length: 27 }, (_, i) => ({ par: [4, 5, 3][i % 3], handicap: i + 1, yardage: 300 + i }));
  return { tee_name: "Blue", course_rating: 71.2, slope_rating: 128, par_total: 108, holes, ...extra };
}

test("splitTee27: holes 1–9 / 10–18 / 19–27 labelled 1 / 2 / 3; the API's names when it gives them", () => {
  const n = splitTee27(tee27());
  assert.deepEqual(n.map((x) => x.label), ["1", "2", "3"]);
  assert.deepEqual(n.map((x) => x.holes.length), [9, 9, 9]);
  assert.equal(n[1].holes[0].handicap, 10);
  assert.equal(n[2].holes[8].handicap, 27);
  assert.deepEqual(splitTee27(tee27({ nine_names: ["Ridge", "Valley", "Lakes"] })).map((x) => x.label), ["Ridge", "Valley", "Lakes"]);
  assert.deepEqual(splitTee27(tee27({ nines: [{ name: "A" }, { name: "B" }, { name: "C" }] })).map((x) => x.label), ["A", "B", "C"]);
  assert.deepEqual(splitTee27(tee27({ nine_names: ["A", "A", "B"] })).map((x) => x.label), ["1", "2", "3"], "duplicate names → numbers");
  assert.equal(splitTee27({ holes: Array(18).fill({ par: 4 }) }), null);
  assert.equal(splitTee27(null), null);
});

test("composeRouting / nineCombos / teeForCombo: two nines in play order, par/si/yards preserved", () => {
  const t = tee27();
  const n = splitTee27(t);
  const combos = nineCombos(n);
  assert.deepEqual(combos.map((c) => c.label), ["1 / 2", "1 / 3", "2 / 3"]);
  assert.deepEqual(combos[1].combo, [0, 2]);
  assert.deepEqual(combos[1].nines, ["1", "3"]);
  const h = composeRouting(n, [2, 0]);                  // nine 3 first
  assert.equal(h.length, 18);
  assert.deepEqual(h.map((x) => x.handicap), [19, 20, 21, 22, 23, 24, 25, 26, 27, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(h.map((x) => x.yardage).slice(0, 3), [318, 319, 320]);
  assert.deepEqual(h.map((x) => x.par), [...t.holes.slice(18), ...t.holes.slice(0, 9)].map((x) => x.par));
  assert.deepEqual(composeRouting(n, ["1", "3"]).map((x) => x.handicap), [1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 20, 21, 22, 23, 24, 25, 26, 27], "by label too");
  assert.equal(composeRouting(n, [1, 1]), null);
  assert.equal(composeRouting(n, ["1", "9"]), null);
  const ct = teeForCombo(t, n, [0, 1]);
  assert.equal(ct.holes.length, 18);
  assert.equal(ct.par_total, 72, "par of the composed 18, never the 27-hole 108");
  assert.equal(ct.course_rating, 71.2, "rating/slope as given");
  assert.equal(ct.slope_rating, 128);
  assert.equal(ct.tee_name, "Blue");
  assert.equal(t.holes.length, 27, "the source tee is not mutated");
  assert.deepEqual(nineCombos(null), []);
});

test("last routing: saved per club in bogeyman-matches:lastRouting:v1, read back, picks the default", () => {
  const st = memStorage();
  const key = clubKeyOf("Chicopee Woods Golf Course", GA);
  assert.equal(loadLastRouting(st, key), null);
  assert.equal(saveLastRouting(st, key, { id: 2009, label: "Mill / School", clubApiId: 2009 }), true);
  assert.equal(saveLastRouting(st, "hampton golf village|ga", { id: null, label: "1 / 3", clubApiId: 1776 }), true);
  assert.ok(st._m.has(LAST_ROUTING_KEY));
  assert.equal(LAST_ROUTING_KEY, "bogeyman-matches:lastRouting:v1");
  assert.deepEqual(loadLastRouting(st, key), { id: 2009, label: "Mill / School", clubApiId: 2009 });
  assert.equal(loadLastRouting(st, "hampton golf village|ga").label, "1 / 3", "clubs don't overwrite each other");
  const routes = [{ key: "e:2011", id: 2011, label: "Village / School" }, { key: "e:2009", id: 2009, label: "Mill / School" }, { key: "e:2010", id: 2010, label: "Village / Mill" }];
  assert.equal(defaultRoutingIndex(routes, loadLastRouting(st, key)), 1, "the one played here last");
  assert.equal(defaultRoutingIndex(routes, null), 0, "else the first");
  assert.equal(defaultRoutingIndex(routes, { id: 999, label: "Village / Mill" }), 2, "id gone → matched by label");
  const combos = [{ key: "c:01", id: 5, label: "1 / 2" }, { key: "c:02", id: 5, label: "1 / 3" }];
  assert.equal(defaultRoutingIndex(combos, { id: null, label: "1 / 3" }), 1, "27-hole combos share an id: by label");
  assert.equal(defaultRoutingIndex([], null), -1);
  // storage failures never throw
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  assert.equal(saveLastRouting(broken, key, { id: 1 }), false);
  assert.equal(loadLastRouting(broken, key), null);
  st.setItem(LAST_ROUTING_KEY, "{not json");
  assert.equal(loadLastRouting(st, key), null);
  assert.equal(saveLastRouting(st, key, { id: 2 }), true, "a corrupt store is replaced, not fatal");
  assert.equal(loadLastRouting(null, key), null);
});
