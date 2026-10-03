/*
 * mapLayer.jsx — the caddie screen's map (UI addendum §4, §5.3, §11.2). S3a.
 *
 * MapLibre GL (served same-origin from ./vendor, loaded on first use, cached by the service
 * worker) over MapTiler satellite, hole-up: bearing = the hole's tee → green bearing, pitch 0, every
 * gesture off (`interactive: false`). An SVG overlay above the canvas is re-projected through
 * `map.project` whenever the map moves or resizes. With no tiles (§4.3) the same overlay draws over a
 * flat paper map of the OSM polygons in an SVG with its own linear projection — no MapLibre at all.
 *
 * All geometry and the overlay's element list live in overlay.js (pure, Node-tested). This file is
 * DOM + MapLibre glue only. It knows nothing about the round: no ghost, no match, no scores (T41).
 *
 * Moved here from the parked src/holeMap.jsx (which stays on disk, unimported): the MapTiler key,
 * TILE_URL, MAP_ATTRIBUTION (v19 wording, unchanged), TILE_CACHE, PREFETCH_ZOOMS, tileUrl,
 * prefetchTiles (now per hole, for the Setup "loading 7 of 18" line) and tileCacheStatus.
 *
 * MapLibre 5.24 APIs used, each checked against the pinned vendor/maplibre-gl.js (no docs reachable
 * from the build container): `new Map({ container, style, center, zoom, bearing, pitch, interactive,
 * attributionControl, fadeDuration, renderWorldCopies, maxPitch, canvasContextAttributes })`
 * (defaults object: `interactive:!0 … canvasContextAttributes:{…preserveDrawingBuffer…}`; every
 * handler is enabled only `e.interactive&&…`), `jumpTo({ center, zoom, bearing, pitch })`,
 * `project(lngLat)` → `transform.locationToScreenPoint`, `unproject(point)`, `resize()`, `remove()`,
 * `triggerRepaint()`, events "load" / "move" / "resize" / "error" / "data"; the transform's
 * `_tileSize=512` / `worldSize = tileSize · scale` (zoom math in overlay.js zoomForPxPerYd); a failed
 * WebGL context throws "Failed to initialize WebGL" from the constructor (caught → drawn map).
 */
import {
  cameraKey, cameraFor, cameraPoints, fitBounds, linearProjector, zoomForPxPerYd,
  overlayModel, fallbackMapModel, mapModeFor, markCamera, pinViewCamera, pinViewKey, pinMarkerHit, satelliteFailure, targetMarkerHit,
} from "./overlay.js";
import { frameOf, pinFromTap, holeFrame, clampToGreen } from "./geo.js";
import { nearMarkedGreen } from "./greens.js";
import { geometryBbox, tilesForBbox, lonLatToTile } from "../geometry.js";
import { overlayPair } from "./caddieState.js";
import { T, F } from "../theme.jsx";

const React = window.React;
const { useEffect, useMemo, useRef, useState, useCallback } = React;

/* ---------- MapTiler (v19 values) ---------- */
export const MAPTILER_KEY = "3frli95k3gG0NelkI7Kx";          // client-side by design; origin-locked to the Pages host in MapTiler
export const TILE_URL = `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;
/* Wording kept from v19 (docs/HANDOFF-caddie.md §4.3: "© MapTiler © OpenStreetMap contributors").
   UNVERIFIED in S3a: MapTiler's current attribution requirements could not be fetched from the build
   container. Check maptiler.com/copyright before shipping. */
export const MAP_ATTRIBUTION = '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>';
export const TILE_CACHE = "bogeyman-tiles-v1";                 // must match sw.js; kept per the Sep 28 storage-key decision
export const PREFETCH_ZOOMS = [16, 17, 18];                    // 512-px tiles: a whole-hole fit is z≈16, an approach z≈18
/* Addendum §11.2 blocking check: MapTiler's terms on caching / offline use of satellite tiles are
   UNVERIFIED (maptiler.com is unreachable from the build container). v19 shipped this prefetch.
   If the terms forbid it, set this false: Setup skips the prefetch and a round with no signal falls
   back to the drawn map (§4.3). The service worker's cache-first tile store is separate (sw.js). */
export const TILE_PREFETCH_ENABLED = true;
export const MAPLIBRE_JS = "./vendor/maplibre-gl.js";
export const MAPLIBRE_CSS = "./vendor/maplibre-gl.css";

const SAT_BG = "#34432C";      // under the tiles while they load (never shown on the drawn map)

/* ---------- loading MapLibre (same-origin, once, only when the caddie needs it) ---------- */
let libPromise = null;
export function loadMapLibre(timeoutMs = 20000) {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = MAPLIBRE_CSS; document.head.appendChild(l);
    }
    const s = document.createElement("script");
    s.src = MAPLIBRE_JS; s.async = true;
    const t = setTimeout(() => reject(new Error("maplibre timeout")), timeoutMs);
    s.onload = () => { clearTimeout(t); window.maplibregl ? resolve(window.maplibregl) : reject(new Error("maplibre missing")); };
    s.onerror = () => { clearTimeout(t); reject(new Error("maplibre load failed")); };
    document.head.appendChild(s);
  }).catch((e) => { libPromise = null; throw e; });
  return libPromise;
}

/** { lib, failed } — asks for MapLibre only while `wanted`. */
export function useMapLibre(wanted) {
  const [lib, setLib] = useState(() => (typeof window !== "undefined" && window.maplibregl) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || lib) return;
    let live = true;
    loadMapLibre().then((l) => { if (live) setLib(l); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [wanted, lib]);
  return { lib, failed };
}

/* ---------- tiles: prefetch (Setup, §11.2) and the per-hole satellite check (§4.3, T39) ---------- */
export function tileUrl(t) { return TILE_URL.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y); }

const holeKeys = (geo) => Object.keys(geo?.holes || {})
  .filter((k) => geo.holes[k]?.line?.length >= 2)
  .sort((a, b) => (parseInt(a, 10) - parseInt(b, 10)) || a.localeCompare(b));

/** Tiles covering one hole's centreline + green, padded (the fitted bounds of any shot on it). */
export function holeTiles(geo, key, zooms = PREFETCH_ZOOMS, padM = 60) {
  const h = geo?.holes?.[key];
  const bbox = h ? geometryBbox({ holes: { [key]: h } }, padM) : null;
  return bbox ? tilesForBbox(bbox, zooms) : [];
}

async function fetchWithTimeout(url, ms) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try { return await fetch(url, ctl ? { signal: ctl.signal } : undefined); } finally { if (t) clearTimeout(t); }
}

/**
 * Write every hole's tiles into the tile cache the service worker reads (works before the worker
 * controls the page). Hole by hole, so Setup can say "loading 7 of 18". Skips cached tiles and
 * tiles an earlier hole already covered. onProgress({ holesDone, holes, ok, total }).
 */
export async function prefetchTiles(geo, { onProgress, zooms = PREFETCH_ZOOMS, concurrency = 4, isLive = () => true, timeoutMs = 8000 } = {}) {
  const keys = holeKeys(geo);
  if (!keys.length || typeof caches === "undefined") return { holes: keys.length, holesDone: 0, ok: 0, total: 0 };
  const cache = await caches.open(TILE_CACHE);
  const seen = new Set();
  let holesDone = 0, ok = 0, total = 0;
  for (const k of keys) {
    if (!isLive()) break;
    const queue = holeTiles(geo, k, zooms).map(tileUrl).filter((u) => !seen.has(u) && seen.add(u));
    total += queue.length;
    const worker = async () => {
      while (queue.length && isLive()) {
        const url = queue.shift();
        try {
          if (await cache.match(url)) ok++;
          else { const r = await fetchWithTimeout(url, timeoutMs); if (r.ok) { await cache.put(url, r); ok++; } }
        } catch (e) { /* offline, timeout or 4xx — the drawn map covers it */ }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    holesDone++;
    if (onProgress && isLive()) onProgress({ holesDone, holes: keys.length, ok, total });
  }
  return { holes: keys.length, holesDone, ok, total };
}

/** How many of the course's tiles are already cached: { have, total } (v19 helper, kept). */
export async function tileCacheStatus(geo, zooms = PREFETCH_ZOOMS) {
  const keys = holeKeys(geo);
  if (!keys.length || typeof caches === "undefined") return null;
  const urls = [...new Set(keys.flatMap((k) => holeTiles(geo, k, zooms).map(tileUrl)))];
  const cache = await caches.open(TILE_CACHE);
  let have = 0;
  for (const u of urls) if (await cache.match(u)) have++;
  return { have, total: urls.length };
}

/** True when every z17 tile of this hole is cached (the prefetch ran, or the hole was viewed online). */
export async function holeTilesCached(geo, key, zoom = 17) {
  if (typeof caches === "undefined") return false;
  const urls = holeTiles(geo, key, [zoom]).map(tileUrl);
  if (!urls.length) return false;
  try {
    const cache = await caches.open(TILE_CACHE);
    for (const u of urls) if (!(await cache.match(u))) return false;
    return true;
  } catch (e) { return false; }
}

/** v22.11: is the z17 tile under a point cached? (marked-green mode has no hole to cover) */
export async function pointTileCached(at, zoom = 17) {
  if (typeof caches === "undefined" || !at) return false;
  try { return !!(await (await caches.open(TILE_CACHE)).match(tileUrl(lonLatToTile(at.lon, at.lat, zoom)))); } catch (e) { return false; }
}

/**
 * v22.12: fetch the z17 tile under a point and say what happened: { ok, status, error } — the HTTP
 * status when the server answered (403 = the key / origin refused), else the error's name
 * ("timeout" when our own timer aborted it, "TypeError" for a network failure or CORS refusal).
 * Goes through the service worker, which caches a good tile.
 */
export async function probeTileDetail(at, timeoutMs = 8000) {
  if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon ?? at.lng)) return { ok: false, status: null, error: "no location" };
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); }, timeoutMs);
  try {
    const r = await fetch(tileUrl(lonLatToTile(at.lon ?? at.lng, at.lat, 17)), ctl ? { signal: ctl.signal } : undefined);
    return { ok: !!r.ok, status: r.status, error: null };
  } catch (e) {
    return { ok: false, status: null, error: timedOut ? "timeout" : (e && e.name) || "error" };
  } finally { clearTimeout(t); }
}

/** v22.11: can the z17 tile under a point be fetched right now? */
export async function probeTileAt(at, timeoutMs = 5000) { return (await probeTileDetail(at, timeoutMs)).ok; }

/** Can one tile of this hole be fetched right now? (goes through the service worker, which caches it) */
export async function probeTile(geo, key, timeoutMs = 5000) { return (await probeTileDetail(holeProbePoint(geo, key), timeoutMs)).ok; }
const holeProbePoint = (geo, key) => { const h = geo?.holes?.[key]; return h?.green?.center || h?.line?.[0] || null; };

/**
 * v22.12 Setup's `Satellite check`: MapLibre loads (from vendor/, as the caddie loads it) and one
 * z17 tile at the course's location comes back. → { lib: bool, tile: probeTileDetail | null,
 * noLocation }. Never throws. Overlay.js satelliteCheckLine turns it into the line.
 */
export async function satelliteCheck(at, { timeoutMs = 8000 } = {}) {
  const lib = loadMapLibre().then(() => true, () => false);
  const tile = at ? probeTileDetail(at, timeoutMs) : Promise.resolve(null);
  const [libOk, t] = await Promise.all([lib, tile]);
  return { lib: libOk, tile: t, noLocation: !at };
}

/**
 * Which map this hole gets (§4.3, §8 No satellite): { mode: "checking" | "satellite" | "fallback"
 * | "none" | "mark", notice, markFailed }. geometry = the compact course geometry; key = its hole key.
 * v22.11: a hole with no geometry checks the tile under `at` (the ball's GPS fix) instead, and
 * `greenMarked` says whether the marked-green synthetic hole is in play (overlay.js mapModeFor).
 */
export function useSatellite(geo, key, { at = null, greenMarked = false, holeNo = null } = {}) {
  const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
  // v22.12: `probe` keeps the tile fetch's status / error and `failReason` what MapLayer reported,
  // so the caddie can say which part failed (overlay.js satelliteFailure)
  const [st, setSt] = useState({ tilesCached: false, probeOk: null, probe: null, failed: false, failReason: null, online: online() });
  const hasHole = !!(geo && key != null && geo.holes?.[key]);
  // ~100 m cells: a new fix nearby does not re-probe (and the map does not flicker to "checking")
  const atKey = !hasHole && at && Number.isFinite(at.lat) && Number.isFinite(at.lon) ? `${at.lat.toFixed(3)},${at.lon.toFixed(3)}` : null;
  useEffect(() => {
    let live = true;
    setSt({ tilesCached: false, probeOk: null, probe: null, failed: false, failReason: null, online: online() });
    if (hasHole) {
      (async () => {
        if (await holeTilesCached(geo, key)) { if (live) setSt((s) => ({ ...s, tilesCached: true })); return; }
        if (!online()) return;
        const probe = await probeTileDetail(holeProbePoint(geo, key), 5000);
        if (live) setSt((s) => ({ ...s, probeOk: probe.ok, probe }));
      })();
    } else if (atKey) {
      const [lat, lon] = atKey.split(",").map(Number);
      (async () => {
        if (await pointTileCached({ lat, lon })) { if (live) setSt((s) => ({ ...s, tilesCached: true })); return; }
        if (!online()) return;
        const probe = await probeTileDetail({ lat, lon }, 5000);
        if (live) setSt((s) => ({ ...s, probeOk: probe.ok, probe }));
      })();
    }
    return () => { live = false; };
  }, [geo, key, hasHole, atKey]);
  const markFailed = useCallback((reason) => setSt((s) => (s.failed ? s : { ...s, failed: true, failReason: reason || null })), []);
  const m = mapModeFor({ hasHole, holeNo, libFailed: st.failed, tilesCached: st.tilesCached, online: st.online, probeOk: st.probeOk, hasGps: !!atKey, greenMarked });
  const out = m.mode === "none" || m.mode === "fallback";
  return { ...m, failure: out ? satelliteFailure({ probe: st.probe, failReason: st.failed ? st.failReason || "tiles" : null, online: st.online }) : null, markFailed };
}

/* ---------- rendering overlay.js descriptors ---------- */
export function renderNodes(nodes) {
  return (nodes || []).map((n, i) => {
    const { "data-redraw": redraw, ...attrs } = n.attrs || {};
    return React.createElement(n.tag, { key: redraw != null ? `r:${redraw}` : i, ...attrs }, n.children ? renderNodes(n.children) : undefined);
  });
}

const FADE_CSS = `.loop-ovl-cur{animation:loopOvlRedraw .22s ease-out}
@keyframes loopOvlRedraw{from{opacity:.15}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.loop-ovl-cur{animation:none}}
.loop-map .maplibregl-canvas{outline:none}`;

let idSeq = 0;
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * props:
 *   hole          course.js Hole built by geo.js buildHole (has origin + bearingDeg); null → paper only
 *   geometry      the compact course geometry (reserved for S3b: other holes' context; unused today)
 *   ball          {x,y} hole frame | null (pre-tee, locating, no fix)
 *   accuracyM     GPS accuracy in metres; > 8 draws the dashed ring
 *   pin           {x,y} hole frame — the pin in effect
 *   options       { safe, aggressive } engine options, each with `.ell` (overlay.js withEllipses) | null
 *   active        "safe" | "aggressive"
 *   sameShot      one option drawn, no ghost line
 *   previousShots [{ from, to }] hole frame
 *   insets        { top, right, bottom, left } the visible map region's edges (§3.1)
 *   fallback      true → the drawn map (§4.3); false → satellite
 *   onPinTap(p)   a tap on the green or within 3 yds (p clamped inside the green, hole frame)
 *   onMapTap()    any other tap
 *   onSatelliteFail(reason)  MapLibre / WebGL / tiles failed — the parent should switch to fallback
 *   recomputing   keep the old overlay at 40% (§9.6)
 *   fitBall, fitOptions  what the camera frames when it differs from what is drawn (S3b: No GPS fix,
 *                 Locating and Yards entered keep the last camera with no ball drawn, §8). Default:
 *                 ball / options.
 *   attributionBottom  px from the bottom of the map to the attribution (default insets.bottom − 10 = 6 above the bar)
 *
 * v22.11:
 *   markAt        {lat, lon} — marked-green mode before the green is marked (hole must be null):
 *                 satellite north-up on this GPS fix, the region 300 yds tall (overlay.js markCamera),
 *                 the ball drawn there; drag-pan and pinch-zoom ON so a green beyond the first view
 *                 can be found; a tap calls onMarkGreen({lat, lon}).
 *   onRemark()    a long-press (600 ms) on or near a marked green's synthetic green (hole.synthetic)
 *   pinView       the camera fits the green (+15 yds), the pin becomes the big marker, the shot
 *                 overlay is hidden, and every tap does nothing. Press and hold the marker 300 ms,
 *                 then drag: onPinDrag(p | null) live (p clamped inside the green, hole frame),
 *                 onPinDrop(p) on release.
 *
 * v22.15 (SPEC-shotlog-v2 §1, §2):
 *   intentMarker  {x,y} hole frame — the target marker (pencil ring + dot); press and hold 300 ms,
 *                 then drag (the pin view's mechanics): onTargetDrag(p | null) live, onTargetDrop(p).
 *   startLineDeg  the start-line ray from the ball (hole-frame bearing, clockwise from +y), or null.
 *   lineMode      press and drag (or tap) sets the start line: onLineTap(p) (hole frame) live, onLineTap(null) on the ball.
 *   onFakeTap(ll) test mode, armed: the next tap is a GPS fix at {lat, lon}; nothing else happens.
 *   fakeAt        { lat, lon, spanYds, ball } — no hole and no mark view: a north-up frame on this
 *                 point (the course centre) so there is something to tap; drawn when there are no tiles.
 *   testBorder    a thin dashed pencil border round the map: test mode is on.
 */
export function MapLayer({
  hole = null, geometry = null, ball = null, accuracyM = null, pin = null, options = null, active = "safe", sameShot = false,
  previousShots = [], insets = {}, fallback = false, onPinTap, onMapTap, onSatelliteFail, recomputing = false, attributionBottom,
  fitBall, fitOptions, markAt = null, onMarkGreen, onRemark, pinView = false, onPinDrag, onPinDrop,
  intentMarker = null, startLineDeg = null, onTargetDrag, onTargetDrop, lineMode = false, onLineTap, onFakeTap = null, fakeAt = null, testBorder = false,
}) {
  const camBall = fitBall !== undefined ? fitBall : ball;
  const camOptions = fitOptions !== undefined ? fitOptions : options;
  const boxRef = useRef(null), mapBoxRef = useRef(null), mapRef = useRef(null);
  const idPrefix = useRef(`loopovl${++idSeq}`).current;
  const [vp, setVp] = useState(() => ({ width: (typeof window !== "undefined" && window.innerWidth) || 375, height: (typeof window !== "undefined" && window.innerHeight) || 812 }));
  const [, setTick] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapGen, setMapGen] = useState(0);                // bumps when a MapLibre map is created
  const [drag, setDrag] = useState(null);                 // v22.11: the pin marker's frame point mid-drag
  const [tdrag, setTdrag] = useState(null);               // v22.15: the target marker's frame point mid-drag
  const dragRef = useRef(null);
  const pressRef = useRef(null);
  const failRef = useRef(onSatelliteFail); failRef.current = onSatelliteFail;

  /* measure the map box */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setVp((v) => (v.width === r.width && v.height === r.height ? v : { width: r.width, height: r.height })); };
    read();
    if (typeof ResizeObserver !== "undefined") { const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect(); }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const Fr = useMemo(() => frameOf(hole), [hole]);
  // v22.15: with no hole, the test-mode frame on the course centre works like the mark view
  const markSrc = !hole && markAt && Number.isFinite(markAt.lat) && Number.isFinite(markAt.lon ?? markAt.lng) ? markAt
    : !hole && fakeAt && Number.isFinite(fakeAt.lat) && Number.isFinite(fakeAt.lon ?? fakeAt.lng) ? fakeAt : null;
  const markMode = !!markSrc;
  const fakeFrame = markMode && markSrc === fakeAt;
  const markLat = markMode ? markSrc.lat : null, markLon = markMode ? (markSrc.lon ?? markSrc.lng) : null;
  const markSpan = fakeFrame ? fakeAt.spanYds || 400 : 300;
  const markF = useMemo(() => (markMode ? holeFrame({ origin: { lat: markLat, lon: markLon }, bearingDeg: 0 }) : null), [markMode, markLat, markLon]);
  const PF = Fr || markF;                                  // the frame the overlay projects through
  const inPinView = !!pinView && !!hole?.green;
  const wantSat = !fallback && ((!!hole && !!Fr) || markMode);
  const { lib, failed: libFailed } = useMapLibre(wantSat);
  useEffect(() => { if (wantSat && libFailed && failRef.current) failRef.current("maplibre"); }, [wantSat, libFailed]);
  useEffect(() => { setMapFailed(false); }, [hole, fallback]);
  const drawn = !wantSat || libFailed || mapFailed;       // the §4.3 paper map
  const satellite = !drawn && !!lib;

  /* camera — refit only when the cameraKey changes (§4.1, §9.7; T36). v22.11: the mark view keys
     on the fix, the pin view on the hole (a pin dragged inside it never refits). */
  const vpKey = `${Math.round(vp.width)}x${Math.round(vp.height)}|${Math.round(insets.top || 0)},${Math.round(insets.right || 0)},${Math.round(insets.bottom || 0)}`;
  const key = markMode ? `mark|${markLat.toFixed(6)},${markLon.toFixed(6)}|${markSpan}|${vpKey}`
    : inPinView ? pinViewKey({ hole, viewport: vp, insets })
    : cameraKey({ hole, ball: camBall, options: camOptions, viewport: vp, insets });
  const camRef = useRef({ key: null, cam: null, mark: null });
  if (camRef.current.key !== key) {
    camRef.current = {
      key,
      cam: markMode ? null : inPinView ? pinViewCamera(hole, vp, insets, { pin })
        : hole ? cameraFor(fitBounds(cameraPoints({ hole, ball: camBall, pin, options: camOptions })), vp, insets) : null,
      mark: markMode ? markCamera(vp, insets, { spanYds: markSpan }) : null,
    };
  }
  const cam = camRef.current.cam, markCam = camRef.current.mark;
  const camView = useMemo(() => {
    if (markCam && markF) {
      const c = markF.toLatLng(markCam.centerOffset);
      return { center: [c.lon, c.lat], zoom: zoomForPxPerYd(markCam.pxPerYd, markLat), bearing: 0, pitch: 0 };
    }
    if (!cam || !Fr) return null;
    const c = Fr.toLatLng(cam.center);
    return { center: [c.lon, c.lat], zoom: zoomForPxPerYd(cam.pxPerYd, Fr.origin.lat), bearing: hole.bearingDeg, pitch: 0 };
  }, [cam, markCam, Fr, markF, hole, markLat]);

  /* the map itself: created once per satellite session, removed when the drawn map takes over */
  useEffect(() => {
    if (!satellite || !mapBoxRef.current || mapRef.current || !camView) return undefined;
    let map;
    try {
      map = new lib.Map({
        container: mapBoxRef.current,
        style: {
          version: 8,
          sources: { sat: { type: "raster", tiles: [TILE_URL], tileSize: 512, maxzoom: 18 } },
          layers: [
            { id: "bg", type: "background", paint: { "background-color": SAT_BG } },
            { id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 0 } },
          ],
        },
        ...camView,
        interactive: false,                 // pan, zoom, rotate, pitch all off (§4.1)
        attributionControl: false,          // the attribution is ours (§3.1)
        maxPitch: 0, renderWorldCopies: false, fadeDuration: 0,
        canvasContextAttributes: { preserveDrawingBuffer: true },   // keep the last frame (v19: blank-canvas race)
      });
    } catch (e) {
      setMapFailed(true);
      if (failRef.current) failRef.current("webgl");
      return undefined;
    }
    let tileErrors = 0, tileLoaded = false;
    const bump = () => setTick((t) => t + 1);
    map.on("load", bump); map.on("move", bump); map.on("resize", bump);
    map.on("moveend", () => map.triggerRepaint());
    map.once("idle", () => map.triggerRepaint());
    map.on("data", (e) => { if (e && e.tile && e.dataType === "source") tileLoaded = true; });
    map.on("error", (e) => {
      if (e && (e.tile || e.sourceId === "sat")) tileErrors++;
      if (!tileLoaded && tileErrors >= 3 && failRef.current) failRef.current("tiles");
    });
    if (typeof window !== "undefined") window.__loopMap = map;   // field-debug handle (Safari → Develop → console)
    mapRef.current = map;
    setMapGen((g) => g + 1);
    bump();
    return () => { map.remove(); mapRef.current = null; if (typeof window !== "undefined" && window.__loopMap === map) window.__loopMap = null; };
  }, [satellite, lib, !!camView]);

  /* v22.11: pan and pinch-zoom only in the mark view (no rotate, no pitch), so a green beyond the
     first 300 yds can be brought on screen and tapped. Everywhere else every gesture stays off. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (markMode) { map.dragPan.enable(); map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation(); map.scrollZoom.enable(); }
      else { map.dragPan.disable(); map.touchZoomRotate.disable(); map.scrollZoom.disable(); }
    } catch (e) { /* an older MapLibre without a handler: the view stays fixed */ }
  }, [markMode, mapGen]);

  /* camera + size changes → jumpTo (never animated: the camera only moves on a new ball / hole) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camView) return;
    map.resize();
    map.jumpTo(camView);
  }, [camView, vp.width, vp.height]);

  /* projection: map.project on satellite, the camera's linear projection otherwise (v22.15: the
     mark / test frame too, so a tap lands on the drawn paper map when there are no tiles) */
  const lin = cam ? linearProjector(cam, vp) : markCam ? linearProjector({ center: markCam.centerOffset, pxPerYd: markCam.pxPerYd }, vp) : null;
  const map = satellite ? mapRef.current : null;
  const project = map && PF
    ? (p) => { const q = PF.toLatLng(p); const s = map.project([q.lon, q.lat]); return { x: s.x, y: s.y }; }
    : lin && (!markMode || drawn) ? lin.project : null;
  const unproject = map && PF
    ? (s) => { const q = map.unproject([s.x, s.y]); return PF.toFrame({ lat: q.lat, lon: q.lng }); }
    : lin && (!markMode || drawn) ? lin.unproject : null;

  // field / test debug handle, like window.__loopMap: the overlay's projection in the frame it draws
  if (typeof window !== "undefined") window.__loopOverlay = { project, unproject, frame: PF, mode: markMode ? (fakeFrame ? "test" : "mark") : hole ? "hole" : "none" };
  const { active: opt, other } = overlayPair(options, active, sameShot);
  const pinDrawn = (inPinView && drag) || pin;
  const redrawKey = [active, sameShot ? 1 : 0, opt?.club, opt?.target && `${r1(opt.target.x)},${r1(opt.target.y)}`, opt?.ell && `${r1(opt.ell.w)}x${r1(opt.ell.h)}`,
    pin && `${r1(pin.x)},${r1(pin.y)}`, inPinView ? "pv" : ""].join("|");

  // the pin view hides the shot (its ellipse and lines would sit on the green) — pin and ball only
  const markerDrawn = tdrag || intentMarker;
  const model = (hole || markMode) && project ? overlayModel({
    project, viewport: vp, hole, ball: markMode ? (fakeFrame && !fakeAt.ball ? null : { x: 0, y: 0 }) : ball, accuracyM, pin: markMode ? null : pinDrawn,
    active: inPinView ? null : opt, other: inPinView ? null : other, previousShots: inPinView ? [] : previousShots,
    palette: drawn ? "paper" : "satellite", idPrefix, redrawKey, recomputing, pinMarker: inPinView, pinDragging: inPinView && !!drag,
    intent: inPinView || markMode ? null : { marker: markerDrawn, lineDeg: startLineDeg, dragging: !!tdrag },
  }) : [];
  const base = hole && drawn && project ? fallbackMapModel({ hole, project }) : [];

  /* ---------- pointer input: tap, long-press (re-mark), press-hold-drag (pin view) ---------- */
  const TAP_SLOP_PX = 8, HOLD_MS = 300, LONG_MS = 600;
  const local = (ev) => { const r = boxRef.current.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const endDrag = () => { dragRef.current = null; setDrag(null); if (onPinDrag) onPinDrag(null); };
  const endTdrag = () => { dragRef.current = null; setTdrag(null); if (onTargetDrag) onTargetDrag(null); };
  // the start line through a screen point; on the ball (within 20 px) it clears
  const lineAt = (pt) => {
    if (!unproject || !project || !ball || !onLineTap) return;
    const p = unproject(pt), bp = project(ball);
    onLineTap(Math.hypot(pt.x - bp.x, pt.y - bp.y) <= 20 ? null : p);
  };
  const tap = (pt) => {
    // v22.15 test mode: armed, the tap is a fix — wherever it lands, and nothing else happens
    if (onFakeTap) {
      let q = null;
      if (map) { const g = map.unproject([pt.x, pt.y]); q = { lat: g.lat, lon: g.lng }; }
      else if (unproject && PF) { const g = PF.toLatLng(unproject(pt)); q = { lat: g.lat, lon: g.lon }; }
      if (q && Number.isFinite(q.lat) && Number.isFinite(q.lon)) onFakeTap(q);
      return;
    }
    if (inPinView) return;                                // pin view: a tap does nothing else (B.3)
    if (lineMode && hole && unproject && ball && onLineTap) { lineAt(pt); return; }
    if (markMode) {
      if (fakeFrame) return;
      if (!map) return;
      const q = map.unproject([pt.x, pt.y]);
      if (onMarkGreen && Number.isFinite(q.lat) && Number.isFinite(q.lng)) onMarkGreen({ lat: q.lat, lon: q.lng });
      return;
    }
    if (!hole || !unproject) return;
    const p = unproject(pt);
    const pinP = p ? pinFromTap(hole, p) : null;
    if (pinP) { if (onPinTap) onPinTap(pinP); } else if (onMapTap) onMapTap();
  };
  const onPointerDown = (ev) => {
    if (!boxRef.current || (ev.button != null && ev.button > 0)) return;
    const pt = local(ev);
    const pr = { id: ev.pointerId, x0: pt.x, y0: pt.y, moved: false, mode: null, timer: null, grab: null };
    pressRef.current = pr;
    const pinPx = inPinView && pin && project ? project(pin) : null;
    const tgtPx = !onFakeTap && !inPinView && !markMode && hole && intentMarker && onTargetDrop && project ? project(intentMarker) : null;
    if (!onFakeTap && !inPinView && lineMode && hole && unproject && ball && onLineTap) {
      // v22.16.5: Line follows the finger — press anywhere and drag; a tap still sets it in one go
      pr.mode = "line";
      try { boxRef.current.setPointerCapture(pr.id); } catch (e) { /* synthetic events */ }
    } else if (tgtPx && unproject && targetMarkerHit(tgtPx, pt)) {
      // v22.15 §2: the target marker — the pin drag's hold-then-drag, anywhere on the map
      pr.grab = { dx: tgtPx.x - pt.x, dy: tgtPx.y - pt.y };
      pr.timer = setTimeout(() => {
        if (pressRef.current !== pr) return;
        pr.mode = "tdrag";
        try { boxRef.current.setPointerCapture(pr.id); } catch (e) { /* synthetic events */ }
        dragRef.current = { x: intentMarker.x, y: intentMarker.y }; setTdrag(dragRef.current);
        if (onTargetDrag) onTargetDrag(dragRef.current);
      }, HOLD_MS);
    } else if (pinPx && unproject && pinMarkerHit(pinPx, pt)) {
      pr.grab = { dx: pinPx.x - pt.x, dy: pinPx.y - pt.y };
      pr.timer = setTimeout(() => {
        if (pressRef.current !== pr) return;
        pr.mode = "drag";
        try { boxRef.current.setPointerCapture(pr.id); } catch (e) { /* synthetic events */ }
        dragRef.current = { x: pin.x, y: pin.y }; setDrag(dragRef.current);
        if (onPinDrag) onPinDrag(dragRef.current);
      }, HOLD_MS);
    } else if (!inPinView && hole?.synthetic && onRemark && unproject) {
      const p = unproject(pt);
      if (p && nearMarkedGreen(hole, p)) pr.timer = setTimeout(() => { if (pressRef.current === pr) { pr.mode = "long"; onRemark(); } }, LONG_MS);
    }
  };
  const onPointerMove = (ev) => {
    const pr = pressRef.current;
    if (!pr || pr.id !== ev.pointerId) return;
    const pt = local(ev);
    if (pr.mode === "drag") {
      const q = unproject ? unproject({ x: pt.x + pr.grab.dx, y: pt.y + pr.grab.dy }) : null;
      if (q && hole?.green) { dragRef.current = clampToGreen(hole, q); setDrag(dragRef.current); if (onPinDrag) onPinDrag(dragRef.current); }
      return;
    }
    if (pr.mode === "line") {
      if (Math.hypot(pt.x - pr.x0, pt.y - pr.y0) > TAP_SLOP_PX) pr.moved = true;
      if (pr.moved) lineAt(pt);
      return;
    }
    if (pr.mode === "tdrag") {
      const q = unproject ? unproject({ x: pt.x + pr.grab.dx, y: pt.y + pr.grab.dy }) : null;
      if (q) { dragRef.current = { x: q.x, y: q.y }; setTdrag(dragRef.current); if (onTargetDrag) onTargetDrag(dragRef.current); }
      return;
    }
    if (!pr.moved && Math.hypot(pt.x - pr.x0, pt.y - pr.y0) > TAP_SLOP_PX) { pr.moved = true; clearTimeout(pr.timer); }
  };
  const onPointerUp = (ev) => {
    const pr = pressRef.current;
    if (!pr || pr.id !== ev.pointerId) return;
    pressRef.current = null;
    clearTimeout(pr.timer);
    if (pr.mode === "drag") { const p = dragRef.current; endDrag(); if (p && onPinDrop) onPinDrop(p); return; }
    if (pr.mode === "tdrag") { const p = dragRef.current; endTdrag(); if (p && onTargetDrop) onTargetDrop(p); return; }
    if (pr.mode === "line") { lineAt(local(ev)); return; }
    if (pr.mode === "long" || pr.moved) return;
    tap(local(ev));
  };
  const onPointerCancel = () => {
    const pr = pressRef.current;
    pressRef.current = null;
    if (!pr) return;
    clearTimeout(pr.timer);
    if (pr.mode === "drag") endDrag();                    // the system took the touch: no pin change
    if (pr.mode === "tdrag") endTdrag();
  };
  useEffect(() => { if (!inPinView && dragRef.current) endDrag(); }, [inPinView]);

  const svgStyle = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "block", overflow: "visible" };
  const attrBottom = attributionBottom ?? Math.max(6, (insets.bottom || 0) - 10);
  return (
    <div ref={boxRef} className="loop-map" data-mode={fakeFrame ? "test" : markMode ? "mark" : inPinView ? "pin" : hole?.synthetic ? "marked" : hole ? "hole" : "none"}
      data-armed={onFakeTap ? "true" : undefined} data-line={lineMode ? "true" : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: drawn ? T.paper : SAT_BG, touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <style dangerouslySetInnerHTML={{ __html: FADE_CSS }} />
      {!drawn && <div ref={mapBoxRef} style={{ position: "absolute", inset: 0 }} />}
      {base.length > 0 && (
        <svg data-layer="drawn-map" style={{ ...svgStyle, pointerEvents: "none" }} width={vp.width} height={vp.height} viewBox={`0 0 ${vp.width} ${vp.height}`} aria-hidden="true">
          {renderNodes(base)}
        </svg>
      )}
      <svg data-layer="overlay" style={{ ...svgStyle, pointerEvents: "none" }} width={vp.width} height={vp.height} viewBox={`0 0 ${vp.width} ${vp.height}`} aria-hidden="true">
        {renderNodes(model)}
      </svg>
      {/* v22.15: test mode — a thin dashed pencil border, so a fake round is never mistaken for a live one */}
      {testBorder && <div data-part="test-border" aria-hidden="true" style={{ position: "absolute", inset: 2, border: `1.5px dashed ${T.pencil}`, pointerEvents: "none", zIndex: 5 }} />}
      {(hole || markMode) && (
        <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} style={{ position: "absolute", left: 6, bottom: attrBottom, padding: "1px 4px", background: "rgba(0,0,0,.4)",
          color: T.paper, fontFamily: F.label, fontSize: 9, lineHeight: "12px", whiteSpace: "nowrap", pointerEvents: "auto" }}>
          {!drawn && <><a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener" style={{ color: T.paper, textDecoration: "none" }}>© MapTiler</a>{" "}</>}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style={{ color: T.paper, textDecoration: "none" }}>© OpenStreetMap contributors</a>
        </div>
      )}
    </div>
  );
}
