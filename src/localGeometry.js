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

/** Overpass-shaped `{ elements }` from a local file. Ids are negative (new objects) unless a way keeps its OSM `id` (Chicopee's holes, so their keys match the Overpass geometry). `shiftM` = [east, north] metres. */
export function toOverpass(data) {
  const [dE, dN] = Array.isArray(data.shiftM) ? data.shiftM : [0, 0];
  const at = (p) => {
    let q = { lat: p[0], lon: p[1] };
    if (dN) q = destination(q, dN > 0 ? 0 : 180, Math.abs(dN));
    if (dE) q = destination(q, dE > 0 ? 90 : 270, Math.abs(dE));
    return q;
  };
  const id = (w, i) => (Number.isInteger(w.id) ? w.id : -(i + 1));
  // a multipolygon (an OSM fairway with bunkers cut out) keeps its rings: `outer` / `inner` = arrays of point lists
  const member = (role) => (pts) => ({ type: "way", role, geometry: pts.map(at) });
  return { elements: data.ways.map((w, i) => (Array.isArray(w.outer)
    ? { type: "relation", id: id(w, i), tags: w.tags, members: [...w.outer.map(member("outer")), ...(w.inner || []).map(member("inner"))] }
    : { type: "way", id: id(w, i), tags: w.tags, geometry: w.pts.map(at) })) };
}

const PARSED = new WeakMap();
const ELEV = new WeakMap();

/**
 * v22.71 (D146): a nine played twice. Bobby Jones (Atlanta) is a reversible nine, so its file writes each hole
 * line twice, as refs 1–9 and 10–18 (`loop: 9`). parseOverpass hands a fairway, tee, rough or hazard to the ONE
 * nearest hole (its greens and woods to every hole that close), so the second loop's holes came up bare; here
 * every shape of hole n is hole n + loop's too, and the other way round. Mutates and returns the parsed geometry.
 */
export function mirrorLoop(geometry, loop) {
  const L = Number(loop);
  if (!geometry || !Number.isInteger(L) || L <= 0) return geometry;
  const twin = (k) => { const n = Number(k); if (!Number.isInteger(n) || String(n) !== String(k)) return null; return n > L ? n - L : n + L; };
  const widen = (x) => {
    const refs = (x.holeRefs || []).map(String);
    for (const r of [...refs]) { const t = twin(r); if (t != null && geometry.holes[t] && !refs.includes(String(t))) refs.push(String(t)); }
    x.holeRefs = refs.map((r) => (geometry.holes[r] ? geometry.holes[r].key : r));
  };
  for (const list of [geometry.features, geometry.trouble, geometry.greens]) (list || []).forEach(widen);
  return geometry;
}

/**
 * v22.45 (C34, D116): the file's baked USGS 3DEP grid (scripts/fetch-3dep.mjs) as elevation samples
 * [{ lat, lon, elevM }], the shape sensors.js fetches from Open-Meteo, or null when the file has none.
 * Cell (i, j) of a row [j, i0, ds] sits at lat0 + j·dLat, lon0 + (i0 + k)·dLon; elevM = (baseDm + d) / 10.
 */
export function elevationSamples(data) {
  const e = data && data.elevation;
  if (!e || !Array.isArray(e.rows)) return null;
  if (ELEV.has(data)) return ELEV.get(data);
  const out = [];
  for (const [j, i0, ds] of e.rows) {
    const lat = +(e.lat0 + j * e.dLat).toFixed(7);
    ds.forEach((d, k) => out.push({ lat, lon: +(e.lon0 + (i0 + k) * e.dLon).toFixed(7), elevM: (e.baseDm + d) / 10 }));
  }
  const res = out.length ? out : null;
  ELEV.set(data, res);
  return res;
}

const GRIDS = new WeakMap();

/**
 * v22.60 (R10, D131): the file's 2 m lidar grids over its greens (scripts/fetch-green-slopes.mjs) as
 * [{ c: [lat, lon], stepM, cells: [{ i, j, lat, lon, z }] }] (z metres), or null when the file has none.
 * Cell (i, j) of a row [j, i0, ds] sits at lat0 + j·dLat, lon0 + (i0 + k)·dLon; z = (baseCm + d) / 100.
 */
export function greenGrids(data) {
  const G = data && data.greenGrids;
  if (!G || !Array.isArray(G.grids)) return null;
  if (GRIDS.has(data)) return GRIDS.get(data);
  const out = G.grids.map((g) => {
    const cells = [];
    for (const [j, i0, ds] of g.rows) ds.forEach((d, k) => cells.push({ i: i0 + k, j, lat: g.lat0 + j * g.dLat, lon: g.lon0 + (i0 + k) * g.dLon, z: (g.baseCm + d) / 100 }));
    return { c: g.c, stepM: G.stepM, cells };
  });
  const res = out.length ? out : null;
  GRIDS.set(data, res);
  return res;
}

/**
 * The parsed geometry for a club, or null when no local file covers it.
 * registry = the bundled files ([{ apiId, apiIds?, version, ways, … }]); clubId = the club's API id.
 * `version` stamps the cache entry (geo.js saveGeometryCache) so an older cache is replaced once.
 * `elevation` = the bundled 3DEP samples (v22.45), or null (the app then asks Open-Meteo).
 * `greenGrids` = the 2 m lidar grids over the greens (v22.60), or null.
 */
export function localGeometryFor(registry, clubId) {
  if (clubId == null || !Array.isArray(registry)) return null;
  // a 27-hole club answers to every routing's id (`apiIds`), whichever one keys its map
  const data = registry.find((d) => d && (String(d.apiId) === String(clubId) || (d.apiIds || []).some((id) => String(id) === String(clubId))));
  if (!data) return null;
  let geometry = PARSED.get(data);
  if (!geometry) { geometry = mirrorLoop(parseOverpass(toOverpass(data)), data.loop); PARSED.set(data, geometry); }
  return { version: `${data.apiId}@${data.version}`, geometry, name: data.name || null, elevation: elevationSamples(data), greenGrids: greenGrids(data) };
}

/**
 * v22.68: which id keys a course's map. Setup folds every course sharing a club name into one club
 * keyed by its lowest API id (routing.js), right for a 27-hole club whose file answers to every
 * routing's id, wrong for two separate 18s: Golf Club of Georgia's Creekside (yx7d5vnk) was keyed
 * by Lakeside's id (mse9vsm1), so its bundled map never loaded (Brett, Oct 23). When the club id
 * has no file and the course's own id does, the course's own id keys the map.
 */
export function bundledMapId(registry, ownId, clubId) {
  const has = (id) => id != null && Array.isArray(registry) && registry.some((d) => d && (String(d.apiId) === String(id) || (d.apiIds || []).some((x) => String(x) === String(id))));
  if (clubId != null && !has(clubId) && has(ownId)) return ownId;
  return clubId ?? ownId;
}

/** The bundled map's own satellite imagery ({ url, tileSize, maxzoom, zooms, probeZoom, credit }), or null (MapTiler). */
export function imageryFor(registry, clubId) {
  if (clubId == null || !Array.isArray(registry)) return null;
  const data = registry.find((d) => d && (String(d.apiId) === String(clubId) || (d.apiIds || []).some((id) => String(id) === String(clubId))));
  return data && data.imagery && typeof data.imagery.url === "string" ? data.imagery : null;
}
