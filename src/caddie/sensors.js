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
 *               &current=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m,dew_point_2m,cloud_cover
 *               &hourly=precipitation,temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m
 *               &past_hours=24&forecast_hours=1
 *               &daily=precipitation_sum,temperature_2m_max,sunrise&past_days=5&forecast_days=1
 *               &timezone=auto
 *               &wind_speed_unit=mph&precipitation_unit=mm&temperature_unit=fahrenheit&timeformat=unixtime
 *             → { utc_offset_seconds, current: { time, wind_speed_10m, …, dew_point_2m, cloud_cover },
 *                 current_units: {…}, hourly: { time: [], precipitation: [], … },
 *                 daily: { time: [], precipitation_sum: [], temperature_2m_max: [], sunrise: [] } }
 *             ONE call (conditions v2, integration item 11): `past_days` / `forecast_days` size the
 *             daily block (5 past days + today) and `past_hours` / `forecast_hours` size the hourly
 *             block (the last 24 h) — Open-Meteo documents both pairs; hourly-count parameters take
 *             precedence over the day counts for hourly data. If a device check shows otherwise the
 *             parser still sums only the hours inside each window, so a longer hourly block is harmless.
 *             `timezone=auto` makes the daily rows local days and returns utc_offset_seconds (used for
 *             the local-hour rules); unixtime values stay epoch seconds.
 *             Field names (temperature_2m, dew_point_2m, cloud_cover, precipitation_sum,
 *             temperature_2m_max, sunrise) are the documented Open-Meteo names; NOT verified live from
 *             this container (egress blocked) — check on device same as the rest of this file.
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
    + "&current=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m,dew_point_2m,cloud_cover"
    + "&hourly=precipitation,temperature_2m,dew_point_2m,cloud_cover,wind_speed_10m&past_hours=24&forecast_hours=1"
    + "&daily=precipitation_sum,temperature_2m_max,sunrise&past_days=5&forecast_days=1"
    + "&timezone=auto"
    + "&wind_speed_unit=mph&precipitation_unit=mm&temperature_unit=fahrenheit&timeformat=unixtime";
}

const TO_MPH = { mph: 1, "km/h": 0.621371, "m/s": 2.236936, kn: 1.150779 };
/** An Open-Meteo time (unix seconds with timeformat=unixtime, else an ISO string in GMT) → ms. */
const omTime = (t) => (typeof t === "number" ? t * 1000 : typeof t === "string" ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z") : NaN);

const H = 3600 * 1000;
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** °C → °F when the units block says so (we ask for fahrenheit; a server that ignores it still parses). */
const toF = (v, unit) => (!Number.isFinite(v) ? null : unit && /C/.test(unit) && !/F/.test(unit) ? v * 9 / 5 + 32 : v);

/** Sum of hourly precipitation over (asOf − hours, asOf]; `seen` = how many hours had a value. */
function rainOver(ts, pr, asOf, hours) {
  let sum = 0, seen = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t > asOf - hours * H && t <= asOf && Number.isFinite(pr[i])) { sum += pr[i]; seen++; }
  }
  return { sum, seen };
}

/**
 * Parse a forecast response. Throws on a shape it doesn't recognise (fetchWeather catches).
 * Conditions v2 (integration item 11) adds, each null when the response lacks it:
 *   dewPointF, cloudPct (current); rainMm12h (hourly, like rainMm24h);
 *   rainDays5 / tMaxF5 — daily precipitation_sum (mm) / temperature_2m_max (°F) for the completed
 *     days before today, oldest first (up to 5); sunriseIso — today's local sunrise;
 *   night — { spreadMinF, cloudPct, windMph, hours }: the overnight window (the 8 h before today's
 *     sunrise, cut at asOf) from the hourly block — min(air − dew point), mean cloud, mean wind.
 *     null when the hourly block has no overnight hours (conditionsFrom then uses current values).
 *   utcOffsetSec — Open-Meteo's utc_offset_seconds (timezone=auto) for the local-hour rules.
 */
export function parseWeather(json, now = Date.now()) {
  const cur = json?.current;
  if (!cur || !Number.isFinite(cur.wind_speed_10m) || !Number.isFinite(cur.wind_direction_10m)) throw new Error("weather: no current wind");
  const unit = json.current_units?.wind_speed_10m || "mph";
  const speedMph = cur.wind_speed_10m * (TO_MPH[unit] ?? 1);
  const asOf = Number.isFinite(omTime(cur.time)) ? omTime(cur.time) : now;
  // hourly precipitation at time t is the total for the hour ending at t → sum (asOf − N h, asOf]
  const hr = json.hourly || {};
  const ts = (hr.time || []).map(omTime);
  const pr = hr.precipitation || [];
  const r24 = rainOver(ts, pr, asOf, 24), r12 = rainOver(ts, pr, asOf, 12);
  let rain = r24.sum;
  if (!r24.seen && Number.isFinite(cur.precipitation)) rain = cur.precipitation;
  const rain12 = r12.seen ? r12.sum : Number.isFinite(cur.precipitation) ? cur.precipitation : null;

  const tUnit = json.current_units?.temperature_2m, hUnit = json.hourly_units?.temperature_2m, dUnit = json.daily_units?.temperature_2m_max;
  const utcOffsetSec = Number.isFinite(json.utc_offset_seconds) ? json.utc_offset_seconds : null;

  // daily: find today's row (local day containing asOf); completed days are the rows before it
  const dl = json.daily || {};
  const dTimes = (dl.time || []).map(omTime);
  let today = -1;
  for (let i = 0; i < dTimes.length; i++) if (Number.isFinite(dTimes[i]) && dTimes[i] <= asOf && asOf < dTimes[i] + 24 * H) today = i;
  if (today < 0 && dTimes.length) today = dTimes.length - 1;
  const past = (arr, f = (v) => v) => (today > 0 ? (arr || []).slice(Math.max(0, today - 5), today).map((v) => (Number.isFinite(v) ? f(v) : null)) : []);
  const rainDays5 = past(dl.precipitation_sum, (v) => Math.round(v * 10) / 10);
  const tMaxF5 = past(dl.temperature_2m_max, (v) => r1(toF(v, dUnit)));
  const sunriseMs = today >= 0 ? omTime(dl.sunrise?.[today]) : NaN;
  const sunriseIso = Number.isFinite(sunriseMs) ? new Date(sunriseMs).toISOString() : null;

  // overnight window from the hourly block
  let night = null;
  if (Number.isFinite(sunriseMs) && ts.length) {
    const from = sunriseMs - 8 * H, to = Math.min(sunriseMs, asOf);
    const spreads = [], clouds = [], winds = [];
    const hw = json.hourly_units?.wind_speed_10m || unit;
    for (let i = 0; i < ts.length; i++) {
      if (!(ts[i] > from && ts[i] <= to)) continue;
      const tF = toF(hr.temperature_2m?.[i], hUnit), dF = toF(hr.dew_point_2m?.[i], hUnit);
      if (tF != null && dF != null) spreads.push(tF - dF);
      if (Number.isFinite(hr.cloud_cover?.[i])) clouds.push(hr.cloud_cover[i]);
      if (Number.isFinite(hr.wind_speed_10m?.[i])) winds.push(hr.wind_speed_10m[i] * (TO_MPH[hw] ?? 1));
    }
    if (spreads.length || clouds.length || winds.length) {
      night = { spreadMinF: spreads.length ? r1(Math.min(...spreads)) : null, cloudPct: r1(mean(clouds)), windMph: r1(mean(winds)), hours: Math.max(spreads.length, clouds.length, winds.length) };
    }
  }

  return {
    speedMph: Math.round(speedMph * 10) / 10,
    dirDeg: ((cur.wind_direction_10m % 360) + 360) % 360,   // meteorological: where the wind blows FROM
    rainMm24h: Math.round(rain * 10) / 10,
    tempF: Number.isFinite(cur.temperature_2m) ? Math.round(toF(cur.temperature_2m, tUnit) * 10) / 10 : null,
    dewPointF: r1(toF(cur.dew_point_2m, tUnit)),
    cloudPct: Number.isFinite(cur.cloud_cover) ? cur.cloud_cover : null,
    rainMm12h: rain12 == null ? null : Math.round(rain12 * 10) / 10,
    rainDays5,
    tMaxF5,
    sunriseIso,
    night,
    utcOffsetSec,
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
      : { speedMph: null, dirDeg: null, rainMm24h: null, tempF: null, dewPointF: null, cloudPct: null, rainMm12h: null, rainDays5: [], tMaxF5: [], sunriseIso: null, night: null, utcOffsetSec: null, asOf: null, fetchedAt: null, stale: true, error, lastAttempt: now };
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

/** The temperature reading to price plays-like against: a fresh, finite tempF only. Stale or
 *  absent weather never contributes a temperature term — no default pretending to be a reading. */
export function weatherTempF(weather) {
  return weather && !weather.stale && Number.isFinite(weather.tempF) ? weather.tempF : null;
}

/**
 * Local clock at `nowMs` for the course: { hour (fractional), month (1–12) }. Uses the weather's
 * utc_offset_seconds; opts.hour / opts.month override. null when neither the offset nor an
 * override is known — the time-of-day rules are then skipped (never the device's own timezone,
 * so the answer does not depend on where the code runs).
 */
function localClock(weather, nowMs, opts) {
  const off = Number.isFinite(opts.utcOffsetSec) ? opts.utcOffsetSec : weather?.utcOffsetSec;
  const d = Number.isFinite(nowMs) && Number.isFinite(off) ? new Date(nowMs + off * 1000) : null;
  const hour = Number.isFinite(opts.hour) ? opts.hour : d ? d.getUTCHours() + d.getUTCMinutes() / 60 : null;
  const month = Number.isFinite(opts.month) ? opts.month : d ? d.getUTCMonth() + 1 : null;
  return { hour, month };
}

/**
 * Conditions v2 (integration item 11; research §4.2) → "wet" | "firm" | "normal". Thresholds are
 * config.CONDITIONS, ALL UNCALIBRATED. In order:
 *   1. rain:   rainMm12h ≥ rainMm12h OR rainMm24h ≥ rainMm24h                          → wet
 *   2. dew:    overnight (air − dew point) ≤ dewSpreadF AND cloud ≤ dewCloudPct AND wind ≤
 *              dewWindMph AND now < sunrise + dewHoursAfterSunrise h                    → wet
 *              (overnight values from weather.night, else the current reading)
 *   3. irrigation "morning moist": local month ∈ irrigationMonths AND hour < irrigationBeforeHour → wet
 *   4. firm:   the last firmDryDays completed days each < firmDayMm AND the last 24 h < firmDayMm
 *              AND the hottest of those days' max ≥ firmTmaxF                           → firm
 *   5. otherwise normal.
 * opts = { now (ms | Date | ISO; default weather.asOf), month, hour, utcOffsetSec }. With no clock
 * at all rules 2–3 are skipped. Missing fields fail their rule (→ normal). Never throws. The
 * Conditions chip still wins (context.js).
 */
export function conditionsFrom(weather, config = DEFAULT_CONFIG, opts = {}) {
  try {
    if (!weather || typeof weather !== "object") return "normal";
    const C = { ...DEFAULT_CONFIG.CONDITIONS, ...(config?.CONDITIONS || {}) };
    const fin = Number.isFinite;
    const o = opts || {};
    const now = msOf(o.now ?? weather.asOf);

    // 1. rain
    if ((fin(weather.rainMm12h) && weather.rainMm12h >= C.rainMm12h) || (fin(weather.rainMm24h) && weather.rainMm24h >= C.rainMm24h)) return "wet";

    // 2. dew
    const sunrise = msOf(weather.sunriseIso);
    if (fin(now) && fin(sunrise) && now < sunrise + C.dewHoursAfterSunrise * H) {
      const n = weather.night || {};
      const curSpread = fin(weather.tempF) && fin(weather.dewPointF) ? weather.tempF - weather.dewPointF : null;
      const spread = fin(n.spreadMinF) ? n.spreadMinF : curSpread;
      const cloud = fin(n.cloudPct) ? n.cloudPct : weather.cloudPct;
      const wind = fin(n.windMph) ? n.windMph : weather.speedMph;
      if (fin(spread) && fin(cloud) && fin(wind) && spread <= C.dewSpreadF && cloud <= C.dewCloudPct && wind <= C.dewWindMph) return "wet";
    }

    // 3. irrigation
    const { hour, month } = localClock(weather, now, o);
    if (fin(hour) && fin(month) && Array.isArray(C.irrigationMonths) && C.irrigationMonths.includes(month) && hour < C.irrigationBeforeHour) return "wet";

    // 4. firm
    const days = Array.isArray(weather.rainDays5) ? weather.rainDays5 : [];
    const tmax = Array.isArray(weather.tMaxF5) ? weather.tMaxF5 : [];
    const k = C.firmDryDays;
    if (k > 0 && days.length >= k && fin(weather.rainMm24h)) {
      const recent = days.slice(-k), hot = tmax.slice(-k).filter(fin);
      const dry = recent.every((mm) => fin(mm) && mm < C.firmDayMm) && weather.rainMm24h < C.firmDayMm;
      if (dry && hot.length && Math.max(...hot) >= C.firmTmaxF) return "firm";
    }
    return "normal";
  } catch {
    return "normal";
  }
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
