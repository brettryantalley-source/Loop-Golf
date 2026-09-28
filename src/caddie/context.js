/*
 * context.js — spec §3.1 ShotContext assembly. Takes everything the phone knows at the tap
 * (round state, the built hole, the GPS fix, weather, elevation samples, lie overrides, Brett's
 * chip corrections) and returns the ctx that engine.js `recommend(ctx, hole, P)` accepts.
 *
 * Chip lifetime (UI addendum §9.3) is the caller's job: pass only the chips that are live for this
 * ball (lie / quality / elevation reset each ball; pin per hole; wind / conditions per round).
 *
 * Pure. No DOM, no storage, no network.
 */

import { DEFAULT_CONFIG } from "./config.js";
import { frameOf, inferLie, distances, clampToGreen, ll } from "./geo.js";
import { conditionsFrom, elevationDeltaYds as elevDelta, weatherTempF } from "./sensors.js";

const norm360 = (d) => ((d % 360) + 360) % 360;
const DEG = Math.PI / 180;

/**
 * Meteorological wind direction (compass degrees the wind blows FROM) → the hole frame's fromDeg
 * (0 = from the green, i.e. straight into Brett's face up the hole; 90 = from the right).
 */
export function windToHoleFrame(dirDeg, holeBearingDeg) {
  return Number.isFinite(dirDeg) && Number.isFinite(holeBearingDeg) ? norm360(dirDeg - holeBearingDeg) : null;
}

/** Hole-frame bearing a → b (0 = up the hole, 90 = right), the same convention engine.js uses. */
export function frameBearing(a, b) {
  return norm360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);
}

const LIE_CHIP = { tee: "tee", fairway: "fairway", rough: "rough", sand: "sand", recovery: "recovery" };
/** "Rough" → { lieType: "rough", unsure: false }; "Rough ?" / "Rough?" → unsure. null when not a lie chip. */
export function parseLieChip(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const unsure = /\?\s*$/.test(s);
  const t = LIE_CHIP[s.replace(/\?\s*$/, "").trim().toLowerCase()];
  return t ? { lieType: t, unsure } : null;
}

const QUALITY = { good: "good", standard: "standard", bad: "bad", buried: "buried", "buried/sitting down": "buried", "sitting down": "buried" };
const CONDITIONS = { firm: "firm", normal: "normal", wet: "wet" };
const WIND_DIR = { into: 0, helping: 180, "from left": -90, "from right": 90, left: -90, right: 90 };

/**
 * The wind chip (addendum §7.1: Into · Helping · From left · From right · Calm; 0 · 5 · 10 · 15 · 20+)
 * relative to the shot line → { speedMph, fromDeg } in the hole frame, or null for calm.
 * Also accepts { speedMph, fromDeg } already in the frame.
 */
export function chipWind(chip, shotBearingDeg) {
  if (!chip) return undefined;
  if (Number.isFinite(chip.fromDeg)) return chip.speedMph > 0 ? { speedMph: chip.speedMph, fromDeg: norm360(chip.fromDeg) } : null;
  const dir = String(chip.direction ?? chip.dir ?? "").toLowerCase();
  const speed = typeof chip.speed === "string" ? parseFloat(chip.speed) : chip.speed ?? chip.speedMph;
  if (dir === "calm" || !(speed > 0)) return null;
  const off = WIND_DIR[dir];
  return off == null ? undefined : { speedMph: speed, fromDeg: norm360(shotBearingDeg + off) };
}

/**
 * inputs = {
 *   round:     { hole, par, nine, shotNo, courseId, trigger: "tee" | "ball", pins: { [hole]: preset | {lat,lng} },
 *                windOverride, conditionsOverride },
 *   hole:      a Hole from geo.js buildHole (carries origin + bearingDeg),
 *   geometry:  the course geometry (optional; lets lie inference see features beyond this hole),
 *   fix:       { lat, lng|lon, accuracyM } from navigator.geolocation,
 *   weather:   sensors.fetchWeather result,  elevation: samples (array or { samples }),
 *   overrides: shotlog.js lie-override entries,
 *   chips:     Brett's corrections { lie, quality, conditions, pin, wind, elevation },
 *   config }
 * → { hole, par, shotNo, ball, lieType, lieQuality, lieConfidence, conditions, pinPos, wind,
 *     elevationDeltaYds, tempF, meta }. `meta` is for the UI (distances, sources, as-of times); the
 *     engine ignores it.
 * ball is null when there is no fix and it is not the first shot — the caller shows the no-GPS state.
 */
export function assembleShotContext(inputs = {}) {
  const { round = {}, hole, geometry = null, fix = null, weather = null, elevation = null, overrides = [], chips = {}, config = DEFAULT_CONFIG } = inputs;
  if (!hole) throw new Error("assembleShotContext: no hole (club-brain mode has no geometry)");
  const F = frameOf(hole);
  const shotNo = round.shotNo ?? 1;
  const trigger = round.trigger ?? (shotNo === 1 ? "tee" : "ball");
  const sources = {};

  /* ball */
  const fixLL = ll(fix);
  let ball = null;
  if (fixLL && F) { ball = F.toFrame(fixLL); sources.ball = "gps"; }
  else if (round.ball && Number.isFinite(round.ball.x)) { ball = { x: round.ball.x, y: round.ball.y }; sources.ball = "round"; }
  else if (trigger === "tee") { ball = { ...hole.tee }; sources.ball = "tee"; }

  /* pin: chip > per-hole round state > middle; custom pins are clamped inside the green */
  const holeKey = round.hole ?? hole.id;
  let pinPos = chips.pin ?? round.pins?.[holeKey] ?? round.pinPos ?? "middle";
  if (pinPos && typeof pinPos === "object") {
    const xy = Number.isFinite(pinPos.x) ? { x: pinPos.x, y: pinPos.y } : F && ll(pinPos) ? F.toFrame(ll(pinPos)) : null;
    pinPos = xy ? clampToGreen(hole, xy) : "middle";
  } else {
    pinPos = ["front", "middle", "back"].includes(String(pinPos).toLowerCase()) ? String(pinPos).toLowerCase() : "middle";
  }
  const dists = ball ? distances(hole, ball, pinPos) : null;
  const target = dists ? dists.pinPoint : hole.green.center;

  /* lie */
  let lieType, lieConfidence, lie = null, penalty = null;
  const lc = parseLieChip(chips.lie);
  if (lc) { lieType = lc.lieType; lieConfidence = lc.unsure ? "low" : "high"; sources.lie = "chip"; }
  else if (trigger === "tee") { lieType = "tee"; lieConfidence = "high"; lie = "tee"; sources.lie = "tee"; }
  else if (ball) {
    const r = inferLie(hole, geometry, fixLL || ball, { accuracyM: fix?.accuracyM, overrides, courseId: round.courseId ?? null });
    lieType = r.lieType; lieConfidence = r.lieConfidence; lie = r.lie; penalty = r.penalty; sources.lie = r.source;
  } else { lieType = "fairway"; lieConfidence = "low"; sources.lie = "default"; }

  /* quality, conditions */
  const lieQuality = QUALITY[String(chips.quality ?? "standard").toLowerCase()] || "standard";
  sources.quality = chips.quality != null ? "chip" : "default";
  const condChip = CONDITIONS[String(chips.conditions ?? round.conditionsOverride ?? "").toLowerCase()];
  const conditions = condChip || conditionsFrom(weather, config);
  sources.conditions = condChip ? "chip" : weather?.rainMm24h != null ? "weather" : "default";

  /* wind: Brett's chip wins for the round; else weather, turned into the hole frame */
  const shotBearing = ball ? frameBearing(ball, target) : 0;
  let wind = chipWind(chips.wind ?? round.windOverride, shotBearing);
  if (wind !== undefined) sources.wind = "chip";
  else if (weather && Number.isFinite(weather.speedMph) && Number.isFinite(weather.dirDeg)) {
    wind = weather.speedMph > 0 ? { speedMph: weather.speedMph, fromDeg: windToHoleFrame(weather.dirDeg, hole.bearingDeg ?? 0) } : null;
    sources.wind = "weather";
  } else { wind = null; sources.wind = "none"; }

  /* elevation: chip, else sampled target − ball */
  let elevationDeltaYds = 0;
  if (Number.isFinite(chips.elevation)) { elevationDeltaYds = chips.elevation; sources.elevation = "chip"; }
  else if (elevation && ball && F) {
    const d = elevDelta(elevation, F.toLatLng(ball), F.toLatLng(target));
    elevationDeltaYds = d ?? 0;
    sources.elevation = d == null ? "none" : "sampled";
  } else sources.elevation = "none";

  /* temperature: a fresh weather reading only (§3.3) — stale or absent never fakes 70° */
  const tempF = weatherTempF(weather);
  sources.temp = tempF != null ? "weather" : "none";

  return {
    hole: holeKey, par: round.par ?? hole.par, shotNo,
    ball, lieType, lieQuality, lieConfidence, conditions, pinPos, wind, elevationDeltaYds, tempF,
    meta: {
      nine: round.nine ?? null, trigger, lie, penalty, sources, distances: dists,
      ballGps: fixLL ? { lat: fixLL.lat, lng: fixLL.lon, accuracyM: fix.accuracyM ?? null } : null,
      weatherAsOf: weather?.asOf ?? null, weatherStale: !!weather?.stale,
    },
  };
}
