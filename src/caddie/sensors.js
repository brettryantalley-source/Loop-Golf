/*
 * sensors.js — weather and elevation for the caddie (spec §6.5), Open-Meteo, free, no key.
 *
 * Every network call takes an injected `fetchImpl` and NEVER throws into the UI: on any failure it
 * hands back the last good value marked `stale: true` with its as-of time (spec §6.5 "use the last
 * value and show its as-of time").
 *
 * Built against Open-Meteo's documented request/response shapes; NOT verified live from the build
 * container (egress blocked). Check on device: field names, CORS from github.io, rate limits,
 * elevation coverage/resolution at Ironwood and Hampton.
 *
 *   forecast  GET https://api.open-meteo.com/v1/forecast?latitude=&longitude=
 *               &current=wind_speed_10m,wind_direction_10m,precipitation
 *               &hourly=precipitation&past_days=1&forecast_days=1
 *               &wind_speed_unit=mph&precipitation_unit=mm&timeformat=unixtime
 *             → { current: { time, wind_speed_10m, wind_direction_10m, precipitation },
 *                 current_units: {…}, hourly: { time: [], precipitation: [] } }
 *   elevation GET https://api.open-meteo.com/v1/elevation?latitude=a,b&longitude=c,d  (≤ 100 points)
 *             → { elevation: [metres, …] }
 */

import { DEFAULT_CONFIG } from "./config.js";

export const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ELEVATION = "https://api.open-meteo.com/v1/elevation";
export const ELEVATION_BATCH = 100;             // documented per-request maximum
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 8000;
const YARDS_PER_METER = 1.0936133;
const rad = (d) => (d * Math.PI) / 180;

const lonOf = (p) => p.lon ?? p.lng;
const fx = (n) => Number(n).toFixed(5);
const msOf = (t) => (t == null ? null : t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

/** fetch with a timeout (cellular at the first tee can hang). */
async function getJson(fetchImpl, url, timeoutMs = FETCH_TIMEOUT_MS) {
  if (typeof fetchImpl !== "function") throw new Error("no fetch");
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r || !r.ok) throw new Error("http " + (r ? r.status : "?"));
    return await r.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------- weather ---------- */

export function weatherUrl(lat, lon) {
  return `${OPEN_METEO_FORECAST}?latitude=${fx(lat)}&longitude=${fx(lon)}`
    + "&current=wind_speed_10m,wind_direction_10m,precipitation"
    + "&hourly=precipitation&past_days=1&forecast_days=1"
    + "&wind_speed_unit=mph&precipitation_unit=mm&timeformat=unixtime";
}

const TO_MPH = { mph: 1, "km/h": 0.621371, "m/s": 2.236936, kn: 1.150779 };
/** An Open-Meteo time (unix seconds with timeformat=unixtime, else an ISO string in GMT) → ms. */
const omTime = (t) => (typeof t === "number" ? t * 1000 : typeof t === "string" ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z") : NaN);

/** Parse a forecast response. Throws on a shape it doesn't recognise (fetchWeather catches). */
export function parseWeather(json, now = Date.now()) {
  const cur = json?.current;
  if (!cur || !Number.isFinite(cur.wind_speed_10m) || !Number.isFinite(cur.wind_direction_10m)) throw new Error("weather: no current wind");
  const unit = json.current_units?.wind_speed_10m || "mph";
  const speedMph = cur.wind_speed_10m * (TO_MPH[unit] ?? 1);
  const asOf = Number.isFinite(omTime(cur.time)) ? omTime(cur.time) : now;
  // hourly precipitation at time t is the total for the hour ending at t → sum (asOf − 24 h, asOf]
  let rain = 0, seen = 0;
  const ts = json.hourly?.time || [], pr = json.hourly?.precipitation || [];
  for (let i = 0; i < ts.length; i++) {
    const t = omTime(ts[i]);
    if (t > asOf - 24 * 3600 * 1000 && t <= asOf && Number.isFinite(pr[i])) { rain += pr[i]; seen++; }
  }
  if (!seen && Number.isFinite(cur.precipitation)) rain = cur.precipitation;
  return {
    speedMph: Math.round(speedMph * 10) / 10,
    dirDeg: ((cur.wind_direction_10m % 360) + 360) % 360,   // meteorological: where the wind blows FROM
    rainMm24h: Math.round(rain * 10) / 10,
    asOf,
    fetchedAt: now,
    stale: false,
    source: "open-meteo",
  };
}

/**
 * → { speedMph, dirDeg, rainMm24h, asOf, fetchedAt, stale, error? }. Never throws.
 * opts.last = the previous good value (returned, stale, on failure); opts.now for tests.
 */
export async function fetchWeather(lat, lon, fetchImpl = globalThis.fetch, { last = null, now = Date.now(), timeoutMs } = {}) {
  try {
    return parseWeather(await getJson(fetchImpl, weatherUrl(lat, lon), timeoutMs), now);
  } catch (e) {
    const error = String(e?.message || e);
    return last
      ? { ...last, stale: true, error, lastAttempt: now }
      : { speedMph: null, dirDeg: null, rainMm24h: null, asOf: null, fetchedAt: null, stale: true, error, lastAttempt: now };
  }
}

/**
 * §6.5 — "refresh every 15 minutes or on I'm on the tee, whichever is later": call on each tee tap;
 * true when nothing has been fetched yet or ≥ 15 min have passed since the last good fetch.
 * lastFetch = a timestamp (ms / Date / ISO) or a weather object (its fetchedAt).
 */
export function weatherRefreshDue(lastFetch, now = Date.now(), intervalMs = WEATHER_REFRESH_MS) {
  const t = lastFetch && typeof lastFetch === "object" && !(lastFetch instanceof Date) ? msOf(lastFetch.fetchedAt) : msOf(lastFetch);
  if (t == null || !Number.isFinite(t)) return true;
  return msOf(now) - t >= intervalMs;
}

/** "wet" when the last 24 h of rain reaches config.WET_RAIN_MM_24H, else "normal". */
export function conditionsFrom(weather, config = DEFAULT_CONFIG) {
  const mm = weather?.rainMm24h;
  const th = config?.WET_RAIN_MM_24H ?? DEFAULT_CONFIG.WET_RAIN_MM_24H;
  return Number.isFinite(mm) && mm >= th ? "wet" : "normal";
}

/* ---------- elevation ---------- */

export function elevationUrl(points) {
  return `${OPEN_METEO_ELEVATION}?latitude=${points.map((p) => fx(p.lat)).join(",")}&longitude=${points.map((p) => fx(lonOf(p))).join(",")}`;
}

/**
 * Elevation (metres) for each point, ≤ 100 per request. → { samples: [{lat, lon, elevM|null}], asOf, stale, error? }.
 * A failed batch leaves its points null; if everything failed and opts.last is given, last comes back stale.
 */
export async function fetchElevationSamples(points, fetchImpl = globalThis.fetch, { last = null, now = Date.now(), batch = ELEVATION_BATCH, timeoutMs } = {}) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(lonOf(p)));
  const samples = pts.map((p) => ({ lat: p.lat, lon: lonOf(p), elevM: null }));
  const errors = [];
  for (let i = 0; i < pts.length; i += batch) {
    const chunk = pts.slice(i, i + batch);
    try {
      const j = await getJson(fetchImpl, elevationUrl(chunk), timeoutMs);
      const el = j?.elevation;
      if (!Array.isArray(el) || el.length !== chunk.length) throw new Error("elevation: length mismatch");
      el.forEach((v, k) => { if (Number.isFinite(v)) samples[i + k].elevM = v; });
    } catch (e) { errors.push(String(e?.message || e)); }
  }
  const got = samples.filter((s) => s.elevM != null).length;
  if (!got && pts.length && last?.samples?.length) return { ...last, stale: true, error: errors[0] || "elevation unavailable" };
  return { samples, asOf: got ? now : null, stale: got < pts.length, ...(errors.length ? { error: errors[0] } : {}) };
}

/**
 * The points to sample once per course at geometry-fetch time (§6.5): each hole's tee end, every
 * `stepM` along the centreline, the green centre and a few green edge points, and fairway / tee
 * centroids. Deduplicated to ~1 m. (Open-Meteo's DEM is ~90 m — denser sampling buys nothing.)
 */
export function elevationSamplePoints(geometry, { stepM = 50 } = {}) {
  const out = [], seen = new Set();
  const add = (p) => { if (!p) return; const q = { lat: p.lat, lon: lonOf(p) }; const k = `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`; if (!seen.has(k)) { seen.add(k); out.push(q); } };
  for (const h of Object.values(geometry?.holes || {})) {
    const line = h.line || [];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1], n = Math.max(1, Math.round(metres(a, b) / stepM));
      for (let k = 0; k < n; k++) add({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
    }
    if (line.length) add(line[line.length - 1]);
    if (h.green?.center) add(h.green.center);
    const r = h.green?.ring || [];
    for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 4))) add(r[i]);
  }
  for (const f of geometry?.features || []) if ((f.kind === "fairway" || f.kind === "tee") && f.ring?.length) add(meanPt(f.ring));
  return out;
}
function meanPt(ring) { return { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lon: ring.reduce((s, p) => s + lonOf(p), 0) / ring.length }; }
function metres(a, b) {
  const k = Math.cos(rad(a.lat));
  return Math.hypot(rad(lonOf(b) - lonOf(a)) * 6371008.8 * k, rad(b.lat - a.lat) * 6371008.8);
}

/** Inverse-distance (power 2) over the 4 nearest samples with an elevation. Metres, or null. */
export function interpolateElevation(samples, point, { k = 4, power = 2 } = {}) {
  const list = (Array.isArray(samples) ? samples : samples?.samples || []).filter((s) => Number.isFinite(s?.elevM));
  if (!list.length || !point) return null;
  const ds = list.map((s) => ({ s, d: metres(point, s) })).sort((a, b) => a.d - b.d).slice(0, k);
  if (ds[0].d < 1) return ds[0].s.elevM;
  let w = 0, v = 0;
  for (const { s, d } of ds) { const wi = 1 / d ** power; w += wi; v += wi * s.elevM; }
  return v / w;
}

/** Elevation of target − ball, in yards (+ = uphill), rounded to 0.1; null when either is unknown. */
export function elevationDeltaYds(samples, ball, target) {
  const a = interpolateElevation(samples, ball), b = interpolateElevation(samples, target);
  return a == null || b == null ? null : Math.round((b - a) * YARDS_PER_METER * 10) / 10;
}
