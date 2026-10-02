/*
 * localGeometry.js — hole geometry for a club OpenStreetMap has no holes for.
 *
 * Woodmont Golf & Country Club (Canton, GA) is in OSM as an outline only: no hole lines, greens,
 * tees, fairways or bunkers (checked Oct 2 2026), so the caddie drew blank paper. A hand-assisted
 * trace from aerial imagery lives in src/localGeometry/woodmont.json (provenance and the accuracy
 * caveat are inside the file). It is expanded into the Overpass JSON shape the app already
 * fetches and run through the SAME parseOverpass, so geo.js, the map and the engine see an
 * ordinary mapped course.
 *
 * Pure: data in, geometry out. app.jsx imports the JSON and passes the registry in, so node tests
 * read the file themselves.
 */

import { parseOverpass, destination } from "./geometry.js";

/** Overpass-shaped `{ elements }` from a local file. Ids are negative (new objects). `shiftM` = [east, north] metres. */
export function toOverpass(data) {
  const [dE, dN] = Array.isArray(data.shiftM) ? data.shiftM : [0, 0];
  const at = (p) => {
    let q = { lat: p[0], lon: p[1] };
    if (dN) q = destination(q, dN > 0 ? 0 : 180, Math.abs(dN));
    if (dE) q = destination(q, dE > 0 ? 90 : 270, Math.abs(dE));
    return q;
  };
  return { elements: data.ways.map((w, i) => ({ type: "way", id: -(i + 1), tags: w.tags, geometry: w.pts.map(at) })) };
}

const PARSED = new WeakMap();

/**
 * The parsed geometry for a club, or null when no local file covers it.
 * registry = the bundled files ([{ apiId, version, ways, … }]); clubId = the club's API id.
 * `version` stamps the cache entry (geo.js saveGeometryCache) so an older cache is replaced once.
 */
export function localGeometryFor(registry, clubId) {
  if (clubId == null || !Array.isArray(registry)) return null;
  const data = registry.find((d) => d && String(d.apiId) === String(clubId));
  if (!data) return null;
  let geometry = PARSED.get(data);
  if (!geometry) { geometry = parseOverpass(toOverpass(data)); PARSED.set(data, geometry); }
  return { version: `${data.apiId}@${data.version}`, geometry, name: data.name || null };
}
