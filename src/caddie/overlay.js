/*
 * overlay.js — pure geometry and the render model for the caddie map overlay
 * (UI addendum §4.1 camera, §4.2 overlay, §4.3 fallback, §5.3 ellipse drawing, §8 map states).
 *
 * THREE FRAMES
 *   hole frame  (course.js / geo.js) — yards; +x right of the tee→green line, +y toward the green.
 *   SP frame    (Shot Pattern's club plot, addendum §5.1) — yards around the aim point; +x right,
 *               +y SHORT, tilt clockwise from +x. engine.js `ellipseSampler` samples in this frame.
 *   screen      — CSS px; +x right, +y DOWN.
 * When the shot runs straight up the screen (θ = 0) the SP frame IS the screen frame scaled by
 * px/yd: +x right = right, +y short = toward the ball = down. For any other shot line the SP frame
 * is rotated by θ (clockwise from screen-up), which is exactly addendum §5.3's Rθ.
 *
 * Nothing here touches the DOM, MapLibre or storage; mapLayer.jsx feeds it a `project` function
 * (map.project on satellite, `linearProjector` on the drawn fallback) and renders what comes back.
 */

import { DEFAULT_CONFIG } from "./config.js";

const DEG = Math.PI / 180;
const f1 = (n) => Math.round(n * 10) / 10;
const f2 = (n) => Math.round(n * 100) / 100;

/** The 80% contour of a 2-D normal sits at √(−2 ln 0.2) σ = 1.794 σ (addendum §5.2). */
export const K80 = Math.sqrt(-2 * Math.log(0.2));

/** Inner-ring scale: the contour holding `pct` of a 2-D normal, as a fraction of the 80% one. */
export const innerRingFrac = (pct) => Math.sqrt(-2 * Math.log(1 - pct)) / K80;
export const YARDS_PER_METER = 1.0936133;
/** Low-accuracy threshold for the dashed ring on the ball (addendum §8, geo.js LOW_ACCURACY_M). */
export const LOW_ACCURACY_M = 8;

/* ---------- §5.3 ellipse on screen ---------- */

/**
 * θ = clockwise angle of ball → target from screen-up, in degrees (screen coords, y down).
 * Computed from projected points, so it already includes the map bearing.
 */
export function thetaDeg(ballPx, targetPx) {
  return Math.atan2(targetPx.x - ballPx.x, -(targetPx.y - ballPx.y)) / DEG;
}

/**
 * Addendum §5.3, exactly:
 *   C = T + Rθ(dx, dy) · px,  Rθ(x, y) = (x cosθ − y sinθ, x sinθ + y cosθ)   (screen, y down)
 *   α = tiltDeg + θ,  A = w/2 · px,  B = h/2 · px
 * target = the aim point in screen px {x, y}; dx, dy, w, h in yards (SP frame); tiltDeg SP tilt.
 * Returns { cx, cy, A, B, alphaDeg, thetaDeg }. `A` lies along u = (cosα, sinα).
 */
export function ellipseScreen({ target, dx = 0, dy = 0, w, h, tiltDeg = 0, thetaDeg: th = 0, pxPerYd = 1 }) {
  const t = th * DEG, c = Math.cos(t), s = Math.sin(t);
  return {
    cx: target.x + (dx * c - dy * s) * pxPerYd,
    cy: target.y + (dx * s + dy * c) * pxPerYd,
    A: (w / 2) * pxPerYd,
    B: (h / 2) * pxPerYd,
    alphaDeg: tiltDeg + th,
    thetaDeg: th,
  };
}

const axes = (e) => {
  const a = e.alphaDeg * DEG;
  return { u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)] };
};

/** The ellipse's support point in unit direction n (addendum §5.3). */
function support(e, n) {
  const { u, v } = axes(e);
  const nu = n[0] * u[0] + n[1] * u[1], nv = n[0] * v[0] + n[1] * v[1];
  const hh = Math.sqrt(e.A * e.A * nu * nu + e.B * e.B * nv * nv) || 1;
  return {
    x: e.cx + (e.A * e.A * nu * u[0] + e.B * e.B * nv * v[0]) / hh,
    y: e.cy + (e.A * e.A * nu * u[1] + e.B * e.B * nv * v[1]) / hh,
  };
}

/**
 * The corridor's two support points: the ellipse's extreme points in directions ±n,
 * n = (cosθ, sinθ) = the screen direction perpendicular to the shot, pointing to its right.
 * θ defaults to the ellipse's own. Returns { left, right } in the ellipse's coordinates.
 */
export function supportPoints(e, th = e.thetaDeg ?? 0) {
  const t = th * DEG, n = [Math.cos(t), Math.sin(t)];
  return { left: support(e, [-n[0], -n[1]]), right: support(e, n) };
}

/** Is p ({x,y} or [x,y]) inside (or on) the ellipse? */
export function pointInEllipse(e, p) {
  const x = (p.x ?? p[0]) - e.cx, y = (p.y ?? p[1]) - e.cy;
  const { u, v } = axes(e);
  const a = (x * u[0] + y * u[1]) / e.A, b = (x * v[0] + y * v[1]) / e.B;
  return a * a + b * b <= 1 + 1e-12;
}

/** n points around the ellipse as [[x, y], …] (drawing, hit-testing, camera bounds). */
export function ellipsePolygon(e, n = 72) {
  const { u, v } = axes(e);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n, ca = Math.cos(t) * e.A, sb = Math.sin(t) * e.B;
    out.push([e.cx + ca * u[0] + sb * v[0], e.cy + ca * u[1] + sb * v[1]]);
  }
  return out;
}

/** Exact axis-aligned box of a screen ellipse: { minX, minY, maxX, maxY, width, height }. */
export function ellipseBbox(e) {
  const a = e.alphaDeg * DEG;
  const hw = Math.sqrt((e.A * Math.cos(a)) ** 2 + (e.B * Math.sin(a)) ** 2);
  const hh = Math.sqrt((e.A * Math.sin(a)) ** 2 + (e.B * Math.cos(a)) ** 2);
  return { minX: e.cx - hw, maxX: e.cx + hw, minY: e.cy - hh, maxY: e.cy + hh, width: 2 * hw, height: 2 * hh };
}

/**
 * Width × depth (yards) of a yard ellipse {w, h, tiltDeg} in the SP frame — what Shot Pattern
 * prints as Width × Depth, and what the details panel's Dispersion line shows (§5.6).
 */
export function bboxYds(ell) {
  const b = ellipseBbox({ cx: 0, cy: 0, A: ell.w / 2, B: ell.h / 2, alphaDeg: ell.tiltDeg ?? 0 });
  return { w: b.width, d: b.height };
}

/* ---------- §5.1/§5.2 the drawn ellipse for a resolved profile entry ---------- */

/**
 * The 80% ellipse to DRAW for a resolved entry (profile.js resolveEntry), in the SP frame:
 * { w, h, tiltDeg, dx, dy, source, scaled, capturedAt, confidence }.
 *
 * ell80 present: w/h/tilt/dx/dy from it. w and h scale by the entry's lie multiplier
 *   (resolveEntry puts it on ell80.sdMult) times the lie-quality multiplier (config LIE_QUALITY:
 *   bad / buried 1.15); a bad / buried lie adds its 5 yds to dy (−distYds; +dy = short). This is
 *   the same scaling engine.js `ellipseSampler` applies, so the drawn ellipse is the simulated one.
 *
 * No ell80: an 80% ellipse from the entry's σs, matching engine.js simulateCandidate's normal path:
 *   σ_along = distSd × q,   σ_lat = carry × tan(lateralSdDeg) × q     (q = lie-quality multiplier)
 *   MAPPING: w = along full axis = 2 · 1.794 · σ_along, h = lateral full axis = 2 · 1.794 · σ_lat,
 *   tilt = 90°. With tilt 90 the w axis u = (cos 90°, sin 90°) = (0, 1) runs along SP +y (the shot
 *   line) and h runs across it, so `ellipseSampler`'s z1 is the distance miss and z2 the lateral one
 *   — the same roles those draws play in the engine's non-ell80 branch. (Putting w on the lateral
 *   axis AND tilt 90 would lay the lateral spread along the shot line; the geometrically identical
 *   alternative is w = lateral with tilt 0.) Centre: dx = biasLat (+ right), dy = −biasDist
 *   (+ short) plus the bad-lie 5 yds. Not drawn: the big-miss tail.
 *   NOTE: the engine does NOT apply the entry's lie σ multiplier to σ_lat on this path (it does to
 *   distSd, inside resolveEntry); this mirrors that so drawn = simulated. See the S3a report.
 */
export function ellipseFromEntry(entry, { lieQuality = "standard", config = DEFAULT_CONFIG } = {}) {
  if (!entry) return null;
  const Q = config.LIE_QUALITY || DEFAULT_CONFIG.LIE_QUALITY;
  const q = Q[lieQuality] || Q.standard;
  const qMult = q.sdMult ?? 1, shortYds = -(q.distYds ?? 0);
  const scaled = qMult !== 1;
  const e = entry.ell80;
  if (e && e.wYds > 0 && e.hYds > 0) {
    const k = (e.sdMult || 1) * qMult;
    return {
      w: e.wYds * k, h: e.hYds * k, tiltDeg: e.tiltDeg ?? 0,
      dx: e.dxYds ?? 0, dy: (e.dyYds ?? 0) + shortYds,
      source: e.source || "shotPattern", scaled, capturedAt: e.capturedAt ?? null, confidence: e.confidence ?? null,
      innerFrac: innerRingFrac(config.RING_INNER_PCT ?? DEFAULT_CONFIG.RING_INNER_PCT),
    };
  }
  if (!(entry.distSd > 0) || !(entry.carry > 0) || !Number.isFinite(entry.lateralSdDeg)) return null;
  const sAlong = entry.distSd * qMult;
  const sLat = (entry.lateralSd ?? entry.carry * Math.tan(entry.lateralSdDeg * DEG)) * qMult;   // resolveEntry widens by lie
  const cap = config.RING_DRAW_CAP_YDS ?? DEFAULT_CONFIG.RING_DRAW_CAP_YDS;
  return {
    w: Math.min(2 * K80 * sAlong, cap), h: Math.min(2 * K80 * sLat, cap), tiltDeg: 90,
    dx: entry.biasLat || 0, dy: -(entry.biasDist || 0) + shortYds,
    source: "profile", scaled, capturedAt: null, confidence: null,
    innerFrac: innerRingFrac(config.RING_INNER_PCT ?? DEFAULT_CONFIG.RING_INNER_PCT),
  };
}

/**
 * Attach the drawn ellipse to each option of a recommend() result, re-resolving its entry.
 * resolve = (club, swingType) → entry (e.g. (c, s) => resolveEntry(P, c, s, lieType)).
 * Returns { safe, aggressive } with `.ell` on each (aggressive null when sameShot).
 */
export function withEllipses(res, resolve, { lieQuality = "standard", config = DEFAULT_CONFIG } = {}) {
  const one = (o) => (o ? { ...o, ell: onFinish(ellipseFromEntry(resolve(o.club, o.swingType), { lieQuality, config }), o) } : null);
  return { safe: one(res?.safe), aggressive: res?.sameShot ? null : one(res?.aggressive) };
}

/**
 * v22.22 (C3, D93): the rings sit where the shot finishes. The ring's own lateral offset plus the
 * crosswind drift, less the aim-off (engine.js aimFor): 0 when the aim cancels the drift, so both
 * rings centre on the target; the drift itself when it is under PATTERN_AIM_MIN_YDS.
 */
function onFinish(ell, o) {
  if (!ell) return ell;
  const dx = ell.dx + (Number.isFinite(o?.windYds) ? o.windYds : 0) + (Number.isFinite(o?.aimOffsetYds) ? o.aimOffsetYds : 0);
  return { ...ell, dx: Math.abs(dx) < 0.15 ? 0 : f1(dx) };
}

/**
 * The caddie's aim point for an option, hole frame: `aimOffsetYds` square to the ball → target line
 * (+ right). The target itself when there is no offset. null without a ball or a target.
 */
export function aimPointFor(option, ball) {
  const T = option?.target;
  if (!T || !ball || !Number.isFinite(T.x) || !Number.isFinite(ball.x)) return null;
  const o = Number.isFinite(option.aimOffsetYds) ? option.aimOffsetYds : 0;
  const dx = T.x - ball.x, dy = T.y - ball.y, L = Math.hypot(dx, dy);
  if (!o || L < 1e-9) return { x: T.x, y: T.y };
  return { x: T.x + (dy / L) * o, y: T.y - (dx / L) * o };
}

/** Bearing (degrees clockwise from +y, the hole frame) of the caddie's start line: ball → aim point. */
export function aimLineDeg(option, ball) {
  const A = aimPointFor(option, ball);
  if (!A) return null;
  const dx = A.x - ball.x, dy = A.y - ball.y;
  return Math.hypot(dx, dy) < 1e-9 ? null : Math.atan2(dx, dy) / DEG;
}

/* ---------- the same ellipse in the hole frame (camera bounds, hit tests) ---------- */

/** Hole frame (y up) ⇄ a 1 px/yd screen (y down). */
const toS = (p) => ({ x: p.x, y: -p.y });

/** The ellipse for an aim at `target` from `ball` as a polygon in hole-frame yards. */
export function ellipseInFrame(ell, ball, target, n = 48) {
  if (!ell || !ball || !target) return [];
  const B = toS(ball), T = toS(target);
  const e = ellipseScreen({ target: T, dx: ell.dx, dy: ell.dy, w: ell.w, h: ell.h, tiltDeg: ell.tiltDeg, thetaDeg: thetaDeg(B, T), pxPerYd: 1 });
  return ellipsePolygon(e, n).map(([x, y]) => [x, -y]);
}

/* ---------- §4.1 camera ---------- */

/** Axis-aligned box of points ({x,y} or [x,y]); non-finite entries are skipped. null when empty. */
export function fitBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points || []) {
    if (!p) continue;
    const x = p.x ?? p[0], y = p.y ?? p[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

const asXY = (p) => (p ? (Array.isArray(p) ? { x: p[0], y: p[1] } : p) : null);

/**
 * What the camera frames (addendum §4.1), in hole-frame yards:
 * ball + green polygon + BOTH options' ellipses (their boxes are the polygons' boxes) + the
 * layup-to-pin line. With no ball (pre-tee) the hole is framed tee → green: the centreline + green.
 */
export function cameraPoints({ hole, ball, pin, options }) {
  const pts = [];
  if (!hole) return pts;
  const b = asXY(ball);
  if (b) pts.push(b);
  else {
    pts.push(hole.tee || { x: 0, y: 0 });
    for (const q of hole.line || []) pts.push(asXY(q));
  }
  for (const q of hole.green?.ring || []) pts.push(asXY(q));
  if (b) {
    for (const o of [options?.safe, options?.aggressive]) {
      if (!o || !o.target) continue;
      pts.push(o.target);
      for (const q of ellipseInFrame(o.ell, b, o.target)) pts.push(asXY(q));
      if (o.kind === "layup" && pin) pts.push(asXY(pin));
    }
  } else if (pin) pts.push(asXY(pin));
  return pts;
}

/**
 * Fit a hole-frame box into the visible map region. The map bearing is the hole's bearing, so the
 * hole frame's axes ARE the screen's (x right, y up) and a frame box is a screen box.
 * viewport {width, height}; insets {top, right, bottom, left} = the region's edges (§3.1:
 * right = rail width, top = safe-top + 49, bottom = bar height + 16); padding inside the region.
 * Returns { center: {x, y} (frame yards at the viewport centre), pxPerYd }.
 */
export function cameraFor(bounds, { width, height }, insets = {}, { padding = 16, minPxPerYd = 0.2, maxPxPerYd = 12 } = {}) {
  const L = (insets.left || 0) + padding, R = width - (insets.right || 0) - padding;
  const Tp = (insets.top || 0) + padding, Bt = height - (insets.bottom || 0) - padding;
  const rw = Math.max(1, R - L), rh = Math.max(1, Bt - Tp);
  if (!bounds) return { center: { x: 0, y: 0 }, pxPerYd: 1 };
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX), bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const px = Math.min(maxPxPerYd, Math.max(minPxPerYd, Math.min(rw / bw, rh / bh)));
  const bc = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const rx = (L + R) / 2, ry = (Tp + Bt) / 2;             // where the box centre must land on screen
  return { center: { x: bc.x + (width / 2 - rx) / px, y: bc.y - (height / 2 - ry) / px }, pxPerYd: px };
}

/** Screen ⇄ hole frame for a camera (the fallback map's projection; also what MapLibre agrees with). */
export function linearProjector(camera, { width, height }) {
  const { center, pxPerYd: px } = camera;
  return {
    pxPerYd: px,
    project: (p) => ({ x: width / 2 + (p.x - center.x) * px, y: height / 2 - (p.y - center.y) * px }),
    unproject: (s) => ({ x: center.x + (s.x - width / 2) / px, y: center.y - (s.y - height / 2) / px }),
  };
}

/** MapLibre's circumference (2π · 6 371 008.8 m) — the same earth radius geo.js uses. */
const EARTH_CIRC_M = 2 * Math.PI * 6371008.8;
/**
 * The MapLibre zoom that shows `pxPerYd` at latitude `latDeg`. MapLibre's world is 512·2^z px
 * wide (transform `_tileSize = 512`, `worldSize = tileSize · scale`, checked in vendor/maplibre-gl.js).
 */
export function zoomForPxPerYd(pxPerYd, latDeg) {
  const pxPerM = pxPerYd * YARDS_PER_METER;
  return Math.log2((pxPerM * EARTH_CIRC_M * Math.cos(latDeg * DEG)) / 512);
}

/**
 * Refit key (§4.1, §9.7): the camera moves only on a new hole, a new ball position, or when the
 * options for that ball first arrive. Toggle, chip, pin and redraws never change it (T36).
 */
export function cameraKey({ hole, ball, options, viewport, insets }) {
  const b = asXY(ball);
  return [
    hole ? String(hole.key ?? hole.id ?? "") : "-",
    b ? `${f1(b.x)},${f1(b.y)}` : "tee",
    options && (options.safe || options.aggressive) ? "opts" : "",
    viewport ? `${Math.round(viewport.width)}x${Math.round(viewport.height)}` : "",
    insets ? `${Math.round(insets.top || 0)},${Math.round(insets.right || 0)},${Math.round(insets.bottom || 0)},${Math.round(insets.left || 0)}` : "",
  ].join("|");
}

/* ---------- §4.3 / §8 which map ---------- */

export const NOTICE_NO_SATELLITE = "No satellite here. Map drawn from course data.";
export const NOTICE_NO_SATELLITE_MARKED = "No satellite here. Map drawn from the marked green.";
export const NOTICE_MARK_GREEN = "No course map. Satellite on GPS — tap the green to mark it.";
export const noticeNoCourseMap = (holeNo) => `No course map for hole ${holeNo}. Enter yards for a club.`;

/**
 * T39. { hasHole, libFailed, tilesCached, online, probeOk } → { mode, notice }.
 * mode: "none" (no geometry: paper, §8 No course map) | "satellite" | "fallback" | "checking"
 *       | "mark" (v22.11: no geometry, a GPS fix, no marked green — the satellite north-up on the ball).
 * Satellite needs MapLibre and tiles that are cached or fetchable; otherwise the drawn map.
 *
 * v22.11 marked-green mode, when the hole has no geometry (hasHole false):
 *   no GPS fix                         → "none", the old notice (unchanged: paper + Enter yards)
 *   GPS, green not marked, satellite   → "mark" + NOTICE_MARK_GREEN
 *   GPS, green not marked, no satellite→ "none", the old notice (nothing to tap a green on)
 *   GPS, green marked                  → "satellite" / "fallback" / "checking" over the synthetic
 *                                        hole; the drawn map says it is drawn from the marked green
 * Here tilesCached / probeOk describe the tiles at the ball, not a hole's.
 */
export function mapModeFor({ hasHole, holeNo = null, libFailed = false, tilesCached = false, online = true, probeOk = null, hasGps = false, greenMarked = false }) {
  if (!hasHole) {
    const none = { mode: "none", notice: holeNo != null ? noticeNoCourseMap(holeNo) : null };
    if (!hasGps) return none;
    const sat = libFailed ? false : tilesCached ? true : (!online || probeOk === false) ? false : probeOk === true ? true : null;
    if (!greenMarked) return sat === true ? { mode: "mark", notice: NOTICE_MARK_GREEN } : sat === false ? none : { mode: "checking", notice: null };
    return sat === true ? { mode: "satellite", notice: null } : sat === false ? { mode: "fallback", notice: NOTICE_NO_SATELLITE_MARKED } : { mode: "checking", notice: null };
  }
  if (libFailed) return { mode: "fallback", notice: NOTICE_NO_SATELLITE };
  if (tilesCached) return { mode: "satellite", notice: null };
  if (!online || probeOk === false) return { mode: "fallback", notice: NOTICE_NO_SATELLITE };
  if (probeOk === true) return { mode: "satellite", notice: null };
  return { mode: "checking", notice: null };
}

/* ---------- v22.12: why the satellite is out, in words ---------- */

/* one tile fetch's result { ok, status, error } → "tiles blocked (HTTP 403)" / "tiles unreachable (timeout)" */
function tileFailure(t) {
  if (Number.isFinite(t.status) && t.status > 0) return t.status >= 500 ? `tiles unreachable (HTTP ${t.status})` : `tiles blocked (HTTP ${t.status})`;
  return `tiles unreachable (${t.error || "no response"})`;
}

/**
 * The caddie's reason, from useSatellite's state: `probe` = the tile fetch at the ball / hole
 * ({ ok, status, error } | null), `failReason` = what MapLayer reported ("maplibre" | "webgl" |
 * "tiles" | null), `online` = navigator.onLine. The library failing wins (without it nothing draws);
 * a failed probe says exactly how; then offline; then the map's own tile errors. null = nothing failed.
 */
export function satelliteFailure({ probe = null, failReason = null, online = true } = {}) {
  if (failReason === "maplibre") return "map library failed to load";
  if (failReason === "webgl") return "WebGL unavailable";
  if (probe && probe.ok === false) return tileFailure(probe);
  if (!online) return "offline";
  if (failReason === "tiles") return "tiles failed to load";
  return null;
}

/**
 * Setup's `Satellite check` line from satelliteCheck's result { lib, tile, noLocation } (null while
 * nothing has run; { running: true } while it runs). Every part that failed is named, joined by ·.
 */
export function satelliteCheckLine(r) {
  if (!r) return null;
  if (r.running) return "Satellite check · running";
  const parts = [];
  if (r.lib === false) parts.push("map library failed to load");
  if (r.noLocation) parts.push("no course location to test");
  else if (r.tile && r.tile.ok === false) parts.push(tileFailure(r.tile));
  return parts.length ? `Satellite: ${parts.join(" · ")}` : "Satellite ready";
}

/* ---------- v22.11 cameras: the mark view and the pin view ---------- */

/** The visible map region (§3.1) of a viewport: { L, R, T, B, cx, cy, width, height } in screen px. */
export function visibleRegion({ width, height }, insets = {}) {
  const L = insets.left || 0, R = width - (insets.right || 0), Tp = insets.top || 0, B = height - (insets.bottom || 0);
  return { L, R, T: Tp, B, cx: (L + R) / 2, cy: (Tp + B) / 2, width: Math.max(1, R - L), height: Math.max(1, B - Tp) };
}

/**
 * Before a green is marked (v22.11 A.1): north-up, the ball centred in the visible region, the
 * region `spanYds` (300) tall. Returns { centerOffset: {x, y} yards east / north of the ball that
 * belongs at the viewport centre, pxPerYd, bearingDeg: 0 } — the caller turns the offset into
 * lat/lon through a north-up frame on the ball (geo.js holeFrame({ origin: ball, bearingDeg: 0 })).
 */
export function markCamera(viewport, insets = {}, { spanYds = 300 } = {}) {
  const r = visibleRegion(viewport, insets);
  const px = r.height / spanYds;
  return { centerOffset: { x: (viewport.width / 2 - r.cx) / px, y: (r.cy - viewport.height / 2) / px }, pxPerYd: px, bearingDeg: 0 };
}

/**
 * The pin view (v22.11 B.1): the green polygon padded by `padYds` (15) on every side, fitted into
 * the visible region, hole-up (the frame's axes are the screen's, as for cameraFor). The pin (a
 * custom one can sit on the edge) is inside the box by construction; it is added anyway.
 * → cameraFor's { center, pxPerYd }, or null without a green.
 */
export function pinViewCamera(hole, viewport, insets = {}, { padYds = 15, pin = null, maxPxPerYd = 12 } = {}) {
  const ring = hole?.green?.ring;
  if (!ring || ring.length < 3) return null;
  const b = fitBounds([...ring.map(asXY), pin && asXY(pin)]);
  if (!b) return null;
  const padded = { minX: b.minX - padYds, minY: b.minY - padYds, maxX: b.maxX + padYds, maxY: b.maxY + padYds };
  return cameraFor(padded, viewport, insets, { padding: 0, maxPxPerYd });
}

/** The pin view's refit key: once per hole and viewport; the pin moving inside it never refits. */
export const pinViewKey = ({ hole, viewport, insets }) => `pin|${cameraKey({ hole, ball: null, options: null, viewport, insets })}`;

/** Hit radius (px) of the pin marker in the pin view — a fingertip, around the cup and the flag. */
export const PIN_MARKER_HIT_PX = 28;
/**
 * Is a press at screen point `pt` on the pin marker drawn at `pinPx`? The flag flies up and right
 * of the cup, so the target is the cup and the flag cloth: the nearer of the two within the radius.
 */
export function pinMarkerHit(pinPx, pt, radius = PIN_MARKER_HIT_PX) {
  if (!pinPx || !pt) return false;
  const cup = Math.hypot(pt.x - pinPx.x, pt.y - pinPx.y);
  const flag = Math.hypot(pt.x - (pinPx.x + 7), pt.y - (pinPx.y - 22));
  return Math.min(cup, flag) <= radius;
}

/* ---------- §4.2 the overlay render model ---------- */

/* Colours. Only paper, yellow and the trouble hatch go on satellite (§4.2); the fallback swaps to
   ink on paper (§4.3). Values are theme.jsx T tokens, copied so this module stays DOM- and JSX-free. */
const PAPER = "#F4F0E4", INK = "#1E6B3A", YELLOW = "#F2C94C", BLACK = "#1F1F1F", PENCIL = "#3F3F3F";
const FILL_LOST = "#F1DAD6", DOUBLE = "#A3352B";
const HALO = "rgba(20,28,16,.45)";

export const PALETTES = {
  satellite: {
    line: PAPER, halo: HALO, ringHalo: "rgba(20,28,16,.5)", ballHalo: "rgba(20,28,16,.35)",
    corridorFill: "rgba(244,240,228,.12)", ellFill: "rgba(244,240,228,.14)", pole: PAPER, prev: PAPER,
    hatchLine: FILL_LOST, hatchBg: "rgba(163,53,43,.28)", ringEdge: null,
  },
  paper: {
    line: INK, halo: null, ringHalo: null, ballHalo: null,
    corridorFill: "rgba(30,107,58,.08)", ellFill: "rgba(30,107,58,.10)", pole: INK, prev: PENCIL,
    hatchLine: DOUBLE, hatchBg: "rgba(163,53,43,.12)", ringEdge: BLACK,
  },
};

const pathD = (pts) => pts.length ? `M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join(" L")} Z` : "";
const el = (tag, attrs, children) => (children ? { tag, attrs, children } : { tag, attrs });

/** A line on its halo (§4.2: same geometry, stroke +2.4, dark). */
function haloLine(a, b, w, P, extra = {}) {
  const g = { x1: f1(a.x), y1: f1(a.y), x2: f1(b.x), y2: f1(b.y), strokeLinecap: "round" };
  const out = [];
  if (P.halo) out.push(el("line", { ...g, stroke: P.halo, strokeWidth: f2(w + 2.4) }));      // solid, as U-Caddie's line()
  out.push(el("line", { ...g, stroke: P.line, strokeWidth: w, ...extra }));
  return out;
}

function ellipseAttrs(e) {
  return { cx: f1(e.cx), cy: f1(e.cy), rx: f1(e.A), ry: f1(e.B), transform: `rotate(${f1(e.alphaDeg)} ${f1(e.cx)} ${f1(e.cy)})` };
}

/** Screen px per yard at hole-frame point p, from the projection itself (10-yd baseline). */
export function pxPerYdAt(project, p) {
  const a = project(p), b = project({ x: p.x + 10, y: p.y }), c = project({ x: p.x, y: p.y + 10 });
  return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 20;
}

/** The active option's ellipse on screen, plus θ and its support points. null without an ellipse. */
export function screenEllipseFor(option, ball, project) {
  if (!option?.ell || !option.target || !ball) return null;
  const B = project(ball), T = project(option.target);
  const th = thetaDeg(B, T);
  const e = ellipseScreen({ target: T, ...option.ell, thetaDeg: th, pxPerYd: pxPerYdAt(project, option.target) });
  return { e, B, T, ...supportPoints(e, th) };
}

/** Rings (hole frame [[x,y]]) that the hatch is clipped to: water, bunkers, trees (§4.2 #7). */
export function troubleRings(hole) {
  return (hole?.hazards || []).filter((h) => h.type === "water" || h.type === "sand" || h.type === "trees");
}

/**
 * The §4.2 overlay as a tree of SVG element descriptors { tag, attrs (React prop names), children? }.
 * mapLayer.jsx turns it into React elements; tests walk it (T37: no <text>, ever).
 *
 * input: { project (frame {x,y} → screen {x,y}), viewport {width,height}, hole, ball, accuracyM,
 *          pin, active (option with target/kind/ell), other (the ghosted option; null when sameShot),
 *          previousShots [{from, to}], palette "satellite"|"paper", idPrefix, redrawKey, recomputing }
 * Draw order (§4.2): pin · [cur: previous shots · other option · the caddie's start line (C3) ·
 * corridor · leave line · ellipse · trouble hatch · target ring] · intent · ball. The `cur` group
 * carries the redraw fade.
 */
export function overlayModel(input) {
  const {
    project, viewport = { width: 375, height: 812 }, hole = null, ball = null, accuracyM = null, pin = null,
    active = null, other = null, previousShots = [], palette = "satellite", idPrefix = "ovl", redrawKey = "", recomputing = false,
    pinMarker = false, pinDragging = false,
    intent = null,
  } = input;
  const P = PALETTES[palette] || PALETTES.satellite;
  const hatchId = `${idPrefix}-hatch`, clipId = `${idPrefix}-trouble`;
  const out = [];

  // 1a. v22.11 pin view: the draggable hole + flag marker, bigger than the §4.2 flag — a cup
  //     r 4 (black, 1.5 px pole-colour ring), a 26 px pole, a 14×10 yellow flag; a dashed ring
  //     round the cup while it is being dragged. Still shapes only (T37).
  if (pin && pinMarker) {
    const p = project(pin);
    const g = [];
    if (pinDragging) g.push(el("circle", { "data-part": "pin-drag", cx: f1(p.x), cy: f1(p.y), r: 14, fill: "none", stroke: P.pole, strokeWidth: 1.4, strokeDasharray: "3 3" }));
    if (P.halo) g.push(el("line", { x1: f1(p.x), y1: f1(p.y), x2: f1(p.x), y2: f1(p.y - 26), stroke: P.halo, strokeWidth: 4, strokeLinecap: "round" }));
    g.push(el("line", { x1: f1(p.x), y1: f1(p.y), x2: f1(p.x), y2: f1(p.y - 26), stroke: P.pole, strokeWidth: 2, strokeLinecap: "round" }));
    g.push(el("path", { d: `M${f1(p.x)} ${f1(p.y - 26)} L${f1(p.x + 14)} ${f1(p.y - 21)} L${f1(p.x)} ${f1(p.y - 16)} Z`, fill: YELLOW, stroke: BLACK, strokeWidth: 0.8, strokeLinejoin: "round" }));
    g.push(el("circle", { cx: f1(p.x), cy: f1(p.y), r: 4, fill: BLACK, stroke: P.pole, strokeWidth: 1.5 }));
    out.push(el("g", { "data-part": "pin-marker" }, g));
  }
  // 1. pin flag: hole dot r 1.9 black; pole 17 px 1.5 paper; flag 10×7 yellow, 0.6 black edge
  if (pin && !pinMarker) {
    const p = project(pin);
    out.push(el("g", { "data-part": "pin" }, [
      el("line", { x1: f1(p.x), y1: f1(p.y), x2: f1(p.x), y2: f1(p.y - 17), stroke: P.pole, strokeWidth: 1.5 }),
      el("path", { d: `M${f1(p.x)} ${f1(p.y - 17)} L${f1(p.x + 10)} ${f1(p.y - 13.5)} L${f1(p.x)} ${f1(p.y - 10)} Z`, fill: YELLOW, stroke: BLACK, strokeWidth: 0.6 }),
      el("circle", { cx: f1(p.x), cy: f1(p.y), r: 1.9, fill: BLACK }),
    ]));
  }

  const cur = [];
  // 2. previous shots this hole — pencil: Brett did these
  for (const s of previousShots || []) {
    if (!s?.from || !s?.to) continue;
    const a = project(s.from), b = project(s.to);
    cur.push(el("path", { "data-part": "previous", d: `M${f1(a.x)} ${f1(a.y)} L${f1(b.x)} ${f1(b.y)}`, fill: "none", stroke: P.prev, strokeWidth: 1.8,
      strokeDasharray: "2.5 6", strokeLinecap: "round", opacity: 0.8, filter: "url(#pencil)" }));
  }

  const B = ball ? project(ball) : null;
  // 3. other option, ghosted (omitted when sameShot — the caller passes other = null)
  if (B && other?.target) {
    const OT = project(other.target);
    cur.push(el("g", { "data-part": "other", opacity: 0.75 }, [
      el("line", { x1: f1(B.x), y1: f1(B.y), x2: f1(OT.x), y2: f1(OT.y), stroke: P.line, strokeWidth: 1.8, strokeDasharray: ".5 6.5", strokeLinecap: "round" }),
      el("circle", { cx: f1(OT.x), cy: f1(OT.y), r: 6, fill: "none", stroke: P.line, strokeWidth: 1.5 }),
    ]));
  }

  // 3b. v22.22 (C3, D93): the caddie's start line, ball → aim point and on to the map edge. Printed,
  //     thin and dashed — lighter than the pencil line Brett sets, which replaces it (8b).
  const autoDeg = B && active?.target && !Number.isFinite(intent?.lineDeg) ? aimLineDeg(active, ball) : null;
  if (autoDeg != null) {
    const F2 = project(rayEnd(ball, autoDeg));
    const g = { x1: f1(B.x), y1: f1(B.y), x2: f1(F2.x), y2: f1(F2.y), strokeLinecap: "round" };
    cur.push(el("g", { "data-part": "aim-line" }, [
      ...(P.halo ? [el("line", { ...g, stroke: P.halo, strokeWidth: 2.8, opacity: 0.5 })] : []),
      el("line", { ...g, stroke: P.line, strokeWidth: 1.3, strokeDasharray: "6 5", opacity: 0.9 }),
    ]));
  }

  const se = B && active ? screenEllipseFor(active, ball, project) : null;
  const defs = [];
  if (se) {
    const { e, T, left, right } = se;
    // 4. corridor: ball → the ellipse's left and right support points
    cur.push(el("g", { "data-part": "corridor" }, [
      el("path", { d: pathD([B, left, right]), fill: P.corridorFill, stroke: "none" }),
      ...haloLine(B, left, 1.3, P, { opacity: 0.95 }),
      ...haloLine(B, right, 1.3, P, { opacity: 0.95 }),
    ]));
    // 5. leave line (layup only): target → pin
    if (active.kind === "layup" && pin) {
      cur.push(el("g", { "data-part": "leave" }, haloLine(T, project(pin), 1.4, P, { strokeDasharray: "5 6", opacity: 0.92 })));
    }
    // 6. the Shot Pattern 80% ellipse
    cur.push(el("ellipse", { "data-part": "ellipse", ...ellipseAttrs(e), fill: P.ellFill, stroke: P.line, strokeWidth: 1.6 }));
    // 6b. C17: the inner ring, the best RING_INNER_PCT of the shots — an outline only, so the fill is not doubled
    if (active.ell?.innerFrac > 0) {
      const ei = ellipseScreen({ target: T, ...active.ell, w: active.ell.w * active.ell.innerFrac, h: active.ell.h * active.ell.innerFrac,
        thetaDeg: thetaDeg(B, T), pxPerYd: pxPerYdAt(project, active.target) });
      cur.push(el("ellipse", { "data-part": "ellipse-inner", ...ellipseAttrs(ei), fill: "none", stroke: P.line, strokeWidth: 1.2, strokeDasharray: "4 3" }));
    }
    // 7. trouble hatch: the same ellipse, hatched, clipped to water / bunkers / trees / outside OB
    const clip = troubleClip(hole, project, viewport);
    if (clip.length) {
      defs.push(el("pattern", { id: hatchId, width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, [
        el("rect", { width: 5, height: 5, fill: P.hatchBg }),
        el("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: P.hatchLine, strokeWidth: 1.8 }),
      ]));
      defs.push(el("clipPath", { id: clipId }, clip));
      // An untransformed path, inside a clipped group: clip-path and a userSpaceOnUse pattern resolve
      // in the referencing element's own user space, so on the rotated <ellipse> both would turn by α
      // (U-Caddie.html has that slip). Here the clip and the 45° hatch stay in screen space.
      cur.push(el("g", { "data-part": "hatch", clipPath: `url(#${clipId})` }, [
        el("path", { d: pathD(ellipsePolygon(e, 72).map(([x, y]) => ({ x, y }))), fill: `url(#${hatchId})` }),
      ]));
    }
    // 8. target ring: yellow r 8, 2.6 px, on a 5.2 px dark halo (fallback: black edges); dot r 2.4
    const ring = [];
    if (P.ringHalo) ring.push(el("circle", { cx: f1(T.x), cy: f1(T.y), r: 8, fill: "none", stroke: P.ringHalo, strokeWidth: 5.2 }));
    if (P.ringEdge) ring.push(el("circle", { cx: f1(T.x), cy: f1(T.y), r: 8, fill: "none", stroke: P.ringEdge, strokeWidth: 4.2 }));
    ring.push(el("circle", { cx: f1(T.x), cy: f1(T.y), r: 8, fill: "none", stroke: YELLOW, strokeWidth: 2.6 }));
    ring.push(el("circle", { cx: f1(T.x), cy: f1(T.y), r: 2.4, fill: YELLOW, ...(P.ringEdge ? { stroke: P.ringEdge, strokeWidth: 0.6 } : {}) }));
    cur.push(el("g", { "data-part": "target" }, ring));
  }
  if (defs.length) out.unshift(el("defs", {}, defs));
  if (cur.length) out.push(el("g", { "data-part": "cur", className: "loop-ovl-cur", "data-redraw": String(redrawKey), opacity: recomputing ? 0.4 : 1 }, cur));

  // 8b. v22.15 intent (SPEC-shotlog-v2 §2) — Brett's own marks, so pencil: the start-line ray from
  //     the ball to the map edge, and the target marker (a ring with a dot, not the flag). Paper on
  //     satellite, pencil graphite on the drawn map, both through the #pencil filter.
  if (B && intent) {
    const g = [];
    if (Number.isFinite(intent.lineDeg)) {
      const far = rayEnd(ball, intent.lineDeg);
      const F2 = project(far);
      if (P.halo) g.push(el("line", { x1: f1(B.x), y1: f1(B.y), x2: f1(F2.x), y2: f1(F2.y), stroke: P.halo, strokeWidth: 3.8, strokeLinecap: "round" }));
      g.push(el("line", { "data-part": "start-line", x1: f1(B.x), y1: f1(B.y), x2: f1(F2.x), y2: f1(F2.y), stroke: P.prev, strokeWidth: 1.6, strokeLinecap: "round", filter: "url(#pencil)" }));
    }
    if (intent.marker && Number.isFinite(intent.marker.x)) {
      const M = project(intent.marker);
      if (intent.dragging) g.push(el("circle", { "data-part": "target-drag", cx: f1(M.x), cy: f1(M.y), r: 18, fill: "none", stroke: P.prev, strokeWidth: 1.2, strokeDasharray: "3 3" }));
      if (P.halo) g.push(el("circle", { cx: f1(M.x), cy: f1(M.y), r: TARGET_MARKER_R, fill: "none", stroke: P.halo, strokeWidth: 4 }));
      g.push(el("circle", { "data-part": "target-marker", cx: f1(M.x), cy: f1(M.y), r: TARGET_MARKER_R, fill: "none", stroke: P.prev, strokeWidth: 1.8, filter: "url(#pencil)" }));
      g.push(el("circle", { cx: f1(M.x), cy: f1(M.y), r: 2.2, fill: P.prev }));
    }
    if (g.length) out.push(el("g", { "data-part": "intent" }, g));
  }

  // 9. ball: paper disc r 6, 1.6 black ring, over a r 7.5 dark disc; low accuracy adds a dashed ring
  if (B) {
    const g = [];
    if (Number.isFinite(accuracyM) && accuracyM > LOW_ACCURACY_M) {
      const r = accuracyM * YARDS_PER_METER * pxPerYdAt(project, ball);
      g.push(el("circle", { "data-part": "accuracy", cx: f1(B.x), cy: f1(B.y), r: f1(r), fill: "none", stroke: P.line, strokeWidth: 1.2, strokeDasharray: "3 4" }));
    }
    if (P.ballHalo) g.push(el("circle", { cx: f1(B.x), cy: f1(B.y), r: 7.5, fill: P.ballHalo }));
    g.push(el("circle", { cx: f1(B.x), cy: f1(B.y), r: 6, fill: PAPER, stroke: BLACK, strokeWidth: 1.6 }));
    out.push(el("g", { "data-part": "ball" }, g));
  }
  return out;
}

/** The target marker's radius (px) and hit radius — a fingertip around the ring (§2). */
export const TARGET_MARKER_R = 11;
export const TARGET_MARKER_HIT_PX = 26;
export const targetMarkerHit = (markerPx, pt, radius = TARGET_MARKER_HIT_PX) =>
  !!(markerPx && pt) && Math.hypot(pt.x - markerPx.x, pt.y - markerPx.y) <= radius;

/** A point `yds` along a hole-frame bearing (degrees clockwise from +y) from p — far enough to leave any map. */
export function rayEnd(p, deg, yds = 1500) {
  const r = deg * DEG;
  return { x: p.x + Math.sin(r) * yds, y: p.y + Math.cos(r) * yds };
}

/** clipPath children: every trouble ring (trees keep their clearings via evenodd) + outside OB. */
function troubleClip(hole, project, viewport) {
  const ringD = (ring) => {
    const pts = (ring || []).map(([x, y]) => project({ x, y }));
    return pts.length >= 3 ? `M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join(" L")} Z` : "";
  };
  const out = [];
  for (const h of troubleRings(hole)) {
    const d = [ringD(h.ring), ...(h.inner || []).map(ringD)].filter(Boolean).join(" ");
    if (d) out.push(el("path", { d, clipRule: "evenodd" }));
  }
  if (hole?.boundary && hole.boundary.length >= 3) {
    // outside the course boundary = OB: a viewport-sized frame with the boundary cut out
    const m = 4000, W = viewport.width, H = viewport.height;
    const frame = `M${-m} ${-m} L${W + m} ${-m} L${W + m} ${H + m} L${-m} ${H + m} Z`;
    out.push(el("path", { d: `${frame} ${ringD(hole.boundary)}`, clipRule: "evenodd" }));
  }
  return out;
}

/* ---------- §4.3 the drawn fallback map (no satellite) ---------- */

const FB = { fillWon: "#DCEBDC", fillHalf: "#E6E4DF", hair: "#A9C7B4", muted: "#7FA58C" };

/**
 * The flat OSM polygons for the fallback, as element descriptors in draw order:
 * trees (muted @ 35%) · fairways + nearby fairways + tees (fillWon) · green (fillWon) ·
 * water (hair @ 60%) · bunkers (fillHalf); every polygon with a 1 px ink outline. No text.
 */
export function fallbackMapModel({ hole, project }) {
  if (!hole) return [];
  // v22.11: a marked green's synthetic hole has no real fairway to draw — only the green Brett
  // marked. Painting the 40-yd engine corridor would pass it off as course data.
  if (hole.synthetic) return [(() => {
    const pts = (hole.green?.ring || []).map((q) => project(Array.isArray(q) ? { x: q[0], y: q[1] } : q));
    return pts.length >= 3 ? el("path", { d: pathD(pts), fill: FB.fillWon, stroke: INK, strokeWidth: 1, strokeLinejoin: "round" }) : null;
  })()].filter(Boolean);
  const poly = (ring, fill, extra = {}) => {
    const pts = (ring || []).map((q) => project(Array.isArray(q) ? { x: q[0], y: q[1] } : q));
    return pts.length >= 3 ? el("path", { d: pathD(pts), fill, stroke: INK, strokeWidth: 1, strokeLinejoin: "round", ...extra }) : null;
  };
  const hz = hole.hazards || [];
  const out = [
    ...hz.filter((h) => h.type === "trees").map((h) => poly(h.ring, FB.muted, { fillOpacity: 0.35 })),
    ...(hole.nearby?.fairways || []).map((r) => poly(r, FB.fillWon)),
    ...(hole.fairways || []).map((r) => poly(r, FB.fillWon)),
    ...(hole.tees || []).map((r) => poly(r, FB.fillWon)),
    poly(hole.green?.ring, FB.fillWon),
    ...hz.filter((h) => h.type === "water").map((h) => poly(h.ring, FB.hair, { fillOpacity: 0.6 })),
    ...hz.filter((h) => h.type === "sand").map((h) => poly(h.ring, FB.fillHalf)),
  ];
  return out.filter(Boolean);
}

/** Every tag in a descriptor tree (T37 walks this). */
export function tagsOf(nodes) {
  const out = [];
  const walk = (list) => { for (const n of list || []) { if (!n) continue; out.push(n.tag); walk(n.children); } };
  walk(nodes);
  return out;
}
