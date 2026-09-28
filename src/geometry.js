/*
 * geometry.js — hole geometry for the Caddie (v18.5) and Hole View (v19).
 *
 * Pure functions, no DOM. Points are { lat, lon } in degrees. Distances come
 * back in yards unless the name says metres. Overpass (OpenStreetMap) is used
 * for GEOMETRY ONLY — par and stroke index stay with golfcourseapi.
 *
 * S2 (Sep 28): parseOverpass also returns fairways, tees, rough, trees (natural=wood /
 * landuse=forest) and the leisure=golf_course boundary, each tagged with the holes it belongs
 * to. src/caddie/geo.js projects all of it into the engine's hole frame.
 */

export const YARDS_PER_METER = 1.0936133;
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const R_EARTH = 6371008.8;                    // metres
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/* ---------- distances and bearings ---------- */

/** Great-circle distance in metres. */
export function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
export const toYards = (m) => m * YARDS_PER_METER;
export const yardsBetween = (a, b) => toYards(haversineM(a, b));

/** Initial bearing a → b in degrees, 0 = north, clockwise. */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `distM` metres from `a` along `bearing` degrees. */
export function destination(a, bearing, distM) {
  const d = distM / R_EARTH, br = rad(bearing), la = rad(a.lat), lo = rad(a.lon);
  const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br));
  const lon = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
  return { lat: deg(lat), lon: ((deg(lon) + 540) % 360) - 180 };
}

/* ---------- polygons ---------- */

/** Area-weighted centroid of a ring (falls back to the vertex mean for degenerate rings). */
export function centroid(ring) {
  if (!ring || ring.length === 0) return null;
  if (ring.length < 3) return { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lon: ring.reduce((s, p) => s + p.lon, 0) / ring.length };
  const lat0 = ring[0].lat, k = Math.cos(rad(lat0));
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const x1 = (p.lon - ring[0].lon) * k, y1 = p.lat - lat0, x2 = (q.lon - ring[0].lon) * k, y2 = q.lat - lat0;
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-18) return { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lon: ring.reduce((s, p) => s + p.lon, 0) / ring.length };
  a *= 0.5;
  return { lat: lat0 + cy / (6 * a), lon: ring[0].lon + cx / (6 * a) / k };
}

/** Ray-casting point-in-polygon on lon/lat (fine at course scale). */
export function pointInRing(p, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const cross = (a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (cross) inside = !inside;
  }
  return inside;
}

/* Local planar frame (metres) around an origin — good to well under a yard at course scale. */
function toXY(origin, p) {
  const k = Math.cos(rad(origin.lat));
  return { x: rad(p.lon - origin.lon) * R_EARTH * k, y: rad(p.lat - origin.lat) * R_EARTH };
}

/**
 * Where the ray player → centre enters and exits the green ring, as distances along the ray
 * in metres from the player. Returns null when the ray misses the ring.
 */
function rayRingHits(player, center, ring) {
  const o = player;
  const c = toXY(o, center);
  const len = Math.hypot(c.x, c.y);
  if (len === 0) return null;
  const dx = c.x / len, dy = c.y / len;
  const hits = [];
  for (let i = 0; i < ring.length; i++) {
    const a = toXY(o, ring[i]), b = toXY(o, ring[(i + 1) % ring.length]);
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (a.x * ey - a.y * ex) / den;           // distance along the ray
    const u = (a.x * dy - a.y * dx) / den;           // position along the edge
    if (t >= 0 && u >= 0 && u <= 1) hits.push(t);
  }
  if (hits.length === 0) return null;
  return { min: Math.min(...hits), max: Math.max(...hits) };
}

/**
 * Front / middle / back of the green from the player, in yards.
 * green = { center, ring? }. Without a ring, front/back = centre ∓ 12 yds (spec §4.2).
 */
export function greenDistances(player, green) {
  const middle = yardsBetween(player, green.center);
  const inside = green.ring ? pointInRing(player, green.ring) : false;
  if (green.ring && green.ring.length >= 3 && !inside) {
    const h = rayRingHits(player, green.center, green.ring);
    if (h) return { front: toYards(h.min), middle, back: toYards(h.max), inside, hasRing: true };
  }
  return { front: Math.max(0, middle - 12), middle, back: middle + 12, inside, hasRing: !!green.ring };
}

/* ---------- Overpass ---------- */

/**
 * Spec §4.1 / caddie spec §6.1 query for a course anchored at lat/lon: bbox = anchor ± 0.015° lat /
 * ± 0.02° lon. `out geom` (no bbox argument) returns every selected way's FULL geometry, so a
 * course boundary or a wood that only crosses the bbox still comes back whole.
 * Tag conventions assumed from the OSM wiki (verify): golf=hole ways run tee → green; greens,
 * bunkers, tees, fairways, rough and water hazards are closed ways or multipolygon relations.
 */
export function overpassQuery(lat, lon, dLat = 0.015, dLon = 0.02) {
  const bbox = `${(lat - dLat).toFixed(6)},${(lon - dLon).toFixed(6)},${(lat + dLat).toFixed(6)},${(lon + dLon).toFixed(6)}`;
  return `[out:json][timeout:25];
(
  way["golf"~"^(hole|green|bunker|fairway|tee|water_hazard|lateral_water_hazard|out_of_bounds)$"](${bbox});
  way["golf"="rough"](${bbox});
  way["natural"="water"](${bbox});
  way["natural"="wood"](${bbox});
  way["landuse"="forest"](${bbox});
  way["leisure"="golf_course"](${bbox});
  relation["golf"~"^(green|bunker|water_hazard|lateral_water_hazard|fairway|tee|rough)$"](${bbox});
  relation["natural"~"^(water|wood)$"](${bbox});
  relation["landuse"="forest"](${bbox});
  relation["leisure"="golf_course"](${bbox});
);
out geom;`;
}

const TROUBLE_KINDS = new Set(["bunker", "water_hazard", "lateral_water_hazard", "out_of_bounds", "water"]);
const GREEN_MATCH_M = 40;
/** A fairway / tee / rough / trees / hazard polygon within this of a hole's centreline (or green) belongs to it. */
export const FEATURE_MATCH_M = 40;
/** Bump when the parsed / cached shape changes; loaders re-fetch anything older. */
export const GEOMETRY_SCHEMA = 2;

const samePt = (a, b) => a && b && a.lat === b.lat && a.lon === b.lon;
const ptsOf = (geom) => (Array.isArray(geom) ? geom.filter(Boolean).map((g) => ({ lat: g.lat, lon: g.lon })) : []);

/** Join member ways end-to-end into rings (multipolygon outers are often split across several ways). */
function stitch(segments) {
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    for (let guard = 0; !samePt(cur[0], cur[cur.length - 1]) && guard < 10000; guard++) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex((s) => samePt(s[0], end) || samePt(s[s.length - 1], end));
      if (i < 0) break;
      const seg = pool.splice(i, 1)[0];
      cur = cur.concat((samePt(seg[0], end) ? seg : seg.slice().reverse()).slice(1));
    }
    rings.push(cur);
  }
  return rings;
}

/** { outers, inners } for a way (one outer, no inners) or a multipolygon relation (stitched). */
function ringsOf(el) {
  if (el.type === "way" && Array.isArray(el.geometry)) return { outers: [ptsOf(el.geometry)], inners: [] };
  if (el.type === "relation" && Array.isArray(el.members)) {
    const role = (r) => el.members.filter((m) => m.type !== "node" && (m.role || "outer") === r && Array.isArray(m.geometry)).map((m) => ptsOf(m.geometry));
    return { outers: stitch(role("outer")), inners: stitch(role("inner")) };
  }
  return { outers: [], inners: [] };
}

/** The element's main ring: the way itself, or a relation's largest stitched outer. */
function ringOf(el) {
  const { outers } = ringsOf(el);
  if (!outers.length) return null;
  return outers.reduce((a, b) => (b.length > a.length ? b : a));
}
const isClosed = (ring) => ring.length >= 4 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon;
const dropClose = (ring) => (isClosed(ring) ? ring.slice(0, -1) : ring);

/** fairway | tee | rough | trees | null — the S2 feature kinds (golf=* wins over natural / landuse). */
function featureKind(tags) {
  if (tags.golf === "fairway" || tags.golf === "tee" || tags.golf === "rough") return tags.golf;
  if (tags.golf) return null;
  if (tags.natural === "wood" || tags.landuse === "forest") return "trees";
  return null;
}

/* Planar helpers in metres around a point (course scale). */
function segDistM(p, a, b) {
  const A = toXY(p, a), B = toXY(p, b);
  const vx = B.x - A.x, vy = B.y - A.y, l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(A.x * vx + A.y * vy) / l2));
  return Math.hypot(A.x + t * vx, A.y + t * vy);
}
/** Metres from p to the nearest point of a polyline (closed = treat as a ring's edges). */
export function distToPolylineM(p, pts, closed = false) {
  if (!pts || !pts.length) return Infinity;
  if (pts.length === 1) return haversineM(p, pts[0]);
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, segDistM(p, pts[i], pts[(i + 1) % pts.length]));
  return best;
}
/** Metres from p to a ring (0 inside). */
export function distToRingM(p, ring) {
  return pointInRing(p, ring) ? 0 : distToPolylineM(p, ring, true);
}
/** Points along a polyline every `stepM` metres (always includes every vertex). */
export function sampleLine(line, stepM = 10) {
  const out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const n = Math.max(1, Math.ceil(haversineM(a, b) / stepM));
    for (let k = 0; k < n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
  }
  if (line.length) out.push(line[line.length - 1]);
  return out;
}
/** Lat/lon bounding box of points. */
function bboxLL(pts) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const p of pts) { if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon; }
  return { s, n, w, e };
}
/** True when two boxes are more than `m` metres apart (a cheap reject before the exact distance). */
function bboxApart(a, b, m) {
  const dLat = Math.max(0, a.s - b.n, b.s - a.n) * (Math.PI / 180) * R_EARTH;
  const k = Math.cos(rad((a.s + a.n) / 2));
  const dLon = Math.max(0, a.w - b.e, b.w - a.e) * (Math.PI / 180) * R_EARTH * k;
  return Math.hypot(dLat, dLon) > m;
}

/** Metres between a ring and a set of line samples: 0 when any sample is inside the ring. */
function ringToSamplesM(ring, samples) {
  let best = Infinity;
  for (const s of samples) {
    const d = distToRingM(s, ring);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

/**
 * Parse an Overpass `out geom` payload into per-hole geometry.
 * Returns { schema,
 *           holes: { [key]: { key, ref, par, name, line, teeEnd, greenEnd, green: {center, ring} | null } },
 *           greens: [{center, ring, holeRefs}],
 *           trouble: [{kind, ring, center, holeRefs}],                      // bunker / water / OB
 *           features: [{kind: fairway|tee|rough|trees, ring, inner, center, holeRefs}],
 *           boundary: { ring, rings, name } | null,                          // leisure=golf_course
 *           warnings: [] }.
 * `key` is the numeric ref, except that a repeated ref (27-hole clubs numbered 1–9 per nine) keys
 * its later ways as "ref@osmId" instead of overwriting the first.
 * A green is assigned to a hole when the centreline's last node is inside it, else the nearest
 * green centroid within 40 m. Greens matching no hole are reported in `warnings`.
 * Other features: containment of the centreline first, then the nearest centreline within
 * FEATURE_MATCH_M (tees: the one nearest; trees and hazards: every hole that close), else they
 * stay course-level (holeRefs = []).
 */
export function parseOverpass(json) {
  const els = Array.isArray(json?.elements) ? json.elements : [];
  const holes = {}, greens = [], trouble = [], features = [], courses = [], warnings = [];
  for (const el of els) {
    const tags = el.tags || {};
    const fk = featureKind(tags);
    if (fk) {
      const { outers, inners } = ringsOf(el);
      for (const o of outers) {
        const r = dropClose(o);
        if (r.length < 3) continue;
        const inner = inners.map(dropClose).filter((q) => q.length >= 3 && pointInRing(q[0], r));
        features.push({ kind: fk, ring: r, inner, center: centroid(r), holeRefs: [], osmId: el.id });
      }
      continue;
    }
    if (!tags.golf && tags.leisure === "golf_course") {
      const rings = ringsOf(el).outers.map(dropClose).filter((q) => q.length >= 3);
      if (rings.length) courses.push({ rings, name: tags.name || null, osmId: el.id });
      continue;
    }
    const kind = tags.golf || (tags.natural === "water" ? "water" : null);
    if (!kind) continue;
    const ring = ringOf(el);
    if (!ring || ring.length === 0) continue;
    if (kind === "hole") {
      const ref = parseInt(tags.ref, 10);
      if (!Number.isInteger(ref)) { warnings.push(`hole way ${el.id} has no numeric ref`); continue; }
      if (ring.length < 2) { warnings.push(`hole ${ref} centreline has fewer than 2 nodes`); continue; }
      let key = ref;
      if (holes[ref]) { key = `${ref}@${el.id}`; warnings.push(`hole ref ${ref} appears more than once (way ${el.id} kept as "${key}")`); }
      const par = parseInt(tags.par, 10);
      holes[key] = { key, ref, par: Number.isInteger(par) ? par : null, name: tags.name || null, line: ring, teeEnd: ring[0], greenEnd: ring[ring.length - 1], green: null, osmId: el.id };
    } else if (kind === "green") {
      const r = dropClose(ring);
      if (r.length >= 3) greens.push({ ring: r, center: centroid(r), holeRefs: [], osmId: el.id });
    } else if (TROUBLE_KINDS.has(kind)) {
      const r = dropClose(ring);
      if (r.length >= 3) trouble.push({ kind, ring: r, center: centroid(r), holeRefs: [], osmId: el.id });
    }
  }
  const holeList = Object.values(holes);
  for (const h of holeList) {
    let best = greens.find((g) => pointInRing(h.greenEnd, g.ring)) || null;
    if (!best) {
      let bestD = Infinity;
      for (const g of greens) {
        const d = haversineM(h.greenEnd, g.center);
        if (d < bestD) { bestD = d; best = g; }
      }
      if (bestD > GREEN_MATCH_M) { warnings.push(`hole ${h.ref}: no green within ${GREEN_MATCH_M} m of the centreline end (nearest ${Math.round(bestD)} m)`); best = null; }
    }
    if (best) { h.green = { center: best.center, ring: best.ring }; best.holeRefs.push(h.key); }
  }
  for (const g of greens) if (g.holeRefs.length === 0) warnings.push(`green ${g.osmId} matched no hole`);

  /* ---- S2: fairway / tee / rough / trees / hazards → holes ---- */
  const samples = new Map(holeList.map((h) => [h.key, sampleLine(h.line, 10)]));
  const hBox = new Map(holeList.map((h) => [h.key, bboxLL([...h.line, ...(h.green?.ring || [])])]));
  const lineDist = (ring, fb = bboxLL(ring)) => holeList.map((h) => ({ h, d: bboxApart(fb, hBox.get(h.key), FEATURE_MATCH_M) ? Infinity : ringToSamplesM(ring, samples.get(h.key)) }));
  for (const f of features) {
    if (f.kind === "tee") {
      const inside = holeList.filter((h) => pointInRing(h.teeEnd, f.ring));
      if (inside.length) { f.holeRefs = inside.map((h) => h.key); continue; }
      let best = null;
      for (const h of holeList) { const d = distToPolylineM(f.center, h.line); if (d <= FEATURE_MATCH_M && (!best || d < best.d)) best = { h, d }; }
      if (best) f.holeRefs = [best.h.key];
      continue;
    }
    const ds = lineDist(f.ring);
    const inside = ds.filter((x) => x.d === 0);
    if (f.kind === "trees") { f.holeRefs = ds.filter((x) => x.d <= FEATURE_MATCH_M).map((x) => x.h.key); continue; }
    if (inside.length) { f.holeRefs = inside.map((x) => x.h.key); continue; }
    const near = ds.filter((x) => x.d <= FEATURE_MATCH_M).sort((a, b) => a.d - b.d);
    if (near.length) f.holeRefs = [near[0].h.key];
  }
  for (const t of trouble) {
    const tb = bboxLL(t.ring);
    t.holeRefs = holeList.filter((h) => {
      if (bboxApart(tb, hBox.get(h.key), FEATURE_MATCH_M)) return false;
      if (ringToSamplesM(t.ring, samples.get(h.key)) <= FEATURE_MATCH_M) return true;
      return h.green ? t.ring.some((p) => distToRingM(p, h.green.ring) <= FEATURE_MATCH_M) : false;
    }).map((h) => h.key);
  }

  /* ---- the course boundary: the leisure=golf_course polygon holding the most hole ends ---- */
  let boundary = null, bestCount = 0;
  for (const c of courses) {
    const count = holeList.reduce((n, h) => n + c.rings.some((r) => pointInRing(h.teeEnd, r)) + c.rings.some((r) => pointInRing(h.greenEnd, r)), 0);
    if (count > bestCount) { bestCount = count; boundary = { ring: c.rings.reduce((a, b) => (b.length > a.length ? b : a)), rings: c.rings, name: c.name, osmId: c.osmId }; }
  }
  if (!boundary) warnings.push(courses.length ? "no leisure=golf_course polygon contains the holes — OB off" : "no leisure=golf_course boundary — OB off");
  return { schema: GEOMETRY_SCHEMA, holes, greens, trouble, features, boundary, warnings };
}

/** The features assigned to one hole (by key), lat/lon rings. Works on parsed or compact geometry. */
export function featuresForHole(geo, key) {
  const has = (x) => (x.holeRefs || []).some((r) => String(r) === String(key));
  const fs = (geo?.features || []).filter(has);
  return {
    fairways: fs.filter((f) => f.kind === "fairway"),
    tees: fs.filter((f) => f.kind === "tee"),
    roughs: fs.filter((f) => f.kind === "rough"),
    trees: fs.filter((f) => f.kind === "trees"),
    hazards: (geo?.trouble || []).filter(has),
  };
}

/* The public instance rate-limits by IP (429 seen Sep 19 2026 after a handful of pulls). lz4 is the
   same data behind a second front door and answered in ~1.5 s when the main URL was throttled; the
   other public mirrors did not answer at all, so they are not listed. */
export const OVERPASS_URLS = ["https://lz4.overpass-api.de/api/interpreter", OVERPASS_URL];

/** Fetch + parse geometry for a course anchor. Tries each endpoint in turn; `fetchImpl` is injectable for tests. */
export async function fetchGeometry(lat, lon, fetchImpl = globalThis.fetch, urls = OVERPASS_URLS) {
  const body = "data=" + encodeURIComponent(overpassQuery(lat, lon));
  let lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      if (!r.ok) { lastErr = new Error("overpass http " + r.status); continue; }
      return parseOverpass(await r.json());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("overpass unreachable");
}

/* ---------- auto phase (spec §4.3) ---------- */

/**
 * distYds = player → green middle; holeYards = scorecard yardage (null if unknown).
 * > holeYards − 40 → tee · 50 < d ≤ holeYards − 40 → approach · d ≤ 50 outside the green → short · inside → putt.
 */
export function autoPhase(distYds, holeYards, insideGreen) {
  if (insideGreen) return "putt";
  if (distYds == null || !Number.isFinite(distYds)) return null;
  if (distYds <= 50) return "short";
  if (holeYards != null && distYds > holeYards - 40) return "tee";
  return "approach";
}

/* ---------- dispersion ellipse (spec §4.4) ---------- */

/**
 * 48-point ellipse centred `alongYds` yards from `player` on `bearing`, semi-axes depth/2 (along)
 * and width/2 (across), in yards. Returns { center, ring } in lon/lat.
 */
export function ellipsePolygon(player, bearing, alongYds, depthYds, widthYds, n = 48) {
  const center = destination(player, bearing, alongYds / YARDS_PER_METER);
  const a = depthYds / 2 / YARDS_PER_METER, b = widthYds / 2 / YARDS_PER_METER;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const along = a * Math.cos(t), across = b * Math.sin(t);
    const dist = Math.hypot(along, across);
    const ang = (bearing + deg(Math.atan2(across, along)) + 360) % 360;
    ring.push(destination(center, ang, dist));
  }
  return { center, ring };
}

/** Trouble polygons whose centroid lies within `withinM` metres of any point on the hole line or the green. */
export function troubleNearHole(trouble, hole, withinM = 250) {
  const pts = [...(hole?.line || []), hole?.green?.center].filter(Boolean);
  if (!pts.length) return [];
  return trouble.filter((t) => {
    const c = t.center || centroid(t.ring);
    return pts.some((p) => haversineM(p, c) <= withinM);
  });
}

/**
 * The club's landing ellipse with each rim point tested against trouble.
 * club = { median, depth80, width80 }. Returns { center, ring, samples: [{ lat, lon, trouble: kind|null }], troublePct }.
 */
export function dispersion(player, bearing, club, trouble) {
  const depth = club.depth80 ?? Math.max(20, (club.p75 ?? club.median + 10) - (club.p25 ?? club.median - 10)) * 1.5;
  const width = club.width80 ?? depth * 0.6;
  const { center, ring } = ellipsePolygon(player, bearing, club.median, depth, width);
  const samples = ring.map((p) => {
    const hit = trouble.find((t) => pointInRing(p, t.ring));
    return { lat: p.lat, lon: p.lon, trouble: hit ? hit.kind : null };
  });
  const bad = samples.filter((s) => s.trouble).length;
  return { center, ring, samples, troublePct: bad / samples.length, depth, width };
}

/* ---------- slippy-map tile math (for the offline tile cache) ---------- */

export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = rad(lat);
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)), z };
}

/** Bounding box { minLat, minLon, maxLat, maxLon } of every hole line and green ring, padded by `padM` metres. */
export function geometryBbox(geo, padM = 60) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const take = (p) => { if (!p) return; minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat); minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon); };
  for (const h of Object.values(geo?.holes || {})) { (h.line || []).forEach(take); (h.green?.ring || []).forEach(take); take(h.green?.center); }
  if (!Number.isFinite(minLat)) return null;
  const sw = destination(destination({ lat: minLat, lon: minLon }, 180, padM), 270, padM);
  const ne = destination(destination({ lat: maxLat, lon: maxLon }, 0, padM), 90, padM);
  return { minLat: sw.lat, minLon: sw.lon, maxLat: ne.lat, maxLon: ne.lon };
}

/** Every tile {x,y,z} covering bbox for each zoom in `zooms`. */
export function tilesForBbox(bbox, zooms) {
  const out = [];
  for (const z of zooms) {
    const a = lonLatToTile(bbox.minLon, bbox.maxLat, z), b = lonLatToTile(bbox.maxLon, bbox.minLat, z);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ x, y, z });
  }
  return out;
}

/** Serialise a parsed geometry for localStorage — small, no OSM ids needed. Idempotent. */
export function compactGeometry(geo) {
  const holes = {};
  for (const [key, h] of Object.entries(geo.holes)) holes[key] = { key: h.key ?? h.ref, ref: h.ref, par: h.par ?? null, name: h.name ?? null, line: h.line, green: h.green };
  const refs = (x) => (x.holeRefs || []).slice();
  return {
    schema: GEOMETRY_SCHEMA,
    holes,
    greens: (geo.greens || []).map((g) => ({ ring: g.ring, center: g.center, holeRefs: refs(g) })),
    trouble: geo.trouble.map((t) => ({ kind: t.kind, ring: t.ring, holeRefs: refs(t) })),
    features: (geo.features || []).map((f) => ({ kind: f.kind, ring: f.ring, inner: f.inner || [], holeRefs: refs(f) })),
    boundary: geo.boundary ? { ring: geo.boundary.ring, rings: geo.boundary.rings || [geo.boundary.ring], name: geo.boundary.name ?? null } : null,
    warnings: geo.warnings,
  };
}
