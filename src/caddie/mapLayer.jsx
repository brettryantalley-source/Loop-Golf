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
  overlayModel, fallbackMapModel, mapModeFor,
} from "./overlay.js";
import { frameOf, pinFromTap } from "./geo.js";
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

/** Can one tile of this hole be fetched right now? (goes through the service worker, which caches it) */
export async function probeTile(geo, key, timeoutMs = 5000) {
  const h = geo?.holes?.[key];
  const c = h?.green?.center || h?.line?.[0];
  if (!c) return false;
  try { const r = await fetchWithTimeout(tileUrl(lonLatToTile(c.lon, c.lat, 17)), timeoutMs); return !!r.ok; } catch (e) { return false; }
}

/**
 * Which map this hole gets (§4.3, §8 No satellite): { mode: "checking" | "satellite" | "fallback",
 * notice, markFailed }. geometry = the compact course geometry; key = its hole key.
 */
export function useSatellite(geo, key) {
  const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
  const [st, setSt] = useState({ tilesCached: false, probeOk: null, failed: false, online: online() });
  useEffect(() => {
    let live = true;
    setSt({ tilesCached: false, probeOk: null, failed: false, online: online() });
    if (!geo || key == null || !geo.holes?.[key]) return undefined;
    (async () => {
      if (await holeTilesCached(geo, key)) { if (live) setSt((s) => ({ ...s, tilesCached: true })); return; }
      if (!online()) return;
      const ok = await probeTile(geo, key);
      if (live) setSt((s) => ({ ...s, probeOk: ok }));
    })();
    return () => { live = false; };
  }, [geo, key]);
  const markFailed = useCallback(() => setSt((s) => (s.failed ? s : { ...s, failed: true })), []);
  const m = mapModeFor({ hasHole: !!(geo && key != null && geo.holes?.[key]), libFailed: st.failed, tilesCached: st.tilesCached, online: st.online, probeOk: st.probeOk });
  return { ...m, markFailed };
}

/* ---------- rendering overlay.js descriptors ---------- */
function renderNodes(nodes) {
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
 */
export function MapLayer({
  hole = null, geometry = null, ball = null, accuracyM = null, pin = null, options = null, active = "safe", sameShot = false,
  previousShots = [], insets = {}, fallback = false, onPinTap, onMapTap, onSatelliteFail, recomputing = false, attributionBottom,
  fitBall, fitOptions,
}) {
  const camBall = fitBall !== undefined ? fitBall : ball;
  const camOptions = fitOptions !== undefined ? fitOptions : options;
  const boxRef = useRef(null), mapBoxRef = useRef(null), mapRef = useRef(null);
  const idPrefix = useRef(`loopovl${++idSeq}`).current;
  const [vp, setVp] = useState(() => ({ width: (typeof window !== "undefined" && window.innerWidth) || 375, height: (typeof window !== "undefined" && window.innerHeight) || 812 }));
  const [, setTick] = useState(0);
  const [mapFailed, setMapFailed] = useState(false);
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
  const wantSat = !!hole && !!Fr && !fallback;
  const { lib, failed: libFailed } = useMapLibre(wantSat);
  useEffect(() => { if (wantSat && libFailed && failRef.current) failRef.current("maplibre"); }, [wantSat, libFailed]);
  useEffect(() => { setMapFailed(false); }, [hole, fallback]);
  const drawn = !wantSat || libFailed || mapFailed;       // the §4.3 paper map
  const satellite = !drawn && !!lib;

  /* camera — refit only when the cameraKey changes (§4.1, §9.7; T36) */
  const key = cameraKey({ hole, ball: camBall, options: camOptions, viewport: vp, insets });
  const camRef = useRef({ key: null, cam: null });
  if (camRef.current.key !== key) {
    camRef.current = { key, cam: hole ? cameraFor(fitBounds(cameraPoints({ hole, ball: camBall, pin, options: camOptions })), vp, insets) : null };
  }
  const cam = camRef.current.cam;
  const camView = useMemo(() => {
    if (!cam || !Fr) return null;
    const c = Fr.toLatLng(cam.center);
    return { center: [c.lon, c.lat], zoom: zoomForPxPerYd(cam.pxPerYd, Fr.origin.lat), bearing: hole.bearingDeg, pitch: 0 };
  }, [cam, Fr, hole]);

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
    bump();
    return () => { map.remove(); mapRef.current = null; if (typeof window !== "undefined" && window.__loopMap === map) window.__loopMap = null; };
  }, [satellite, lib, !!camView]);

  /* camera + size changes → jumpTo (never animated: the camera only moves on a new ball / hole) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camView) return;
    map.resize();
    map.jumpTo(camView);
  }, [camView, vp.width, vp.height]);

  /* projection: map.project on satellite, the camera's linear projection otherwise */
  const lin = cam ? linearProjector(cam, vp) : null;
  const map = satellite ? mapRef.current : null;
  const project = map && Fr
    ? (p) => { const q = Fr.toLatLng(p); const s = map.project([q.lon, q.lat]); return { x: s.x, y: s.y }; }
    : lin ? lin.project : null;
  const unproject = map && Fr
    ? (s) => { const q = map.unproject([s.x, s.y]); return Fr.toFrame({ lat: q.lat, lon: q.lng }); }
    : lin ? lin.unproject : null;

  const { active: opt, other } = overlayPair(options, active, sameShot);
  const redrawKey = [active, sameShot ? 1 : 0, opt?.club, opt?.target && `${r1(opt.target.x)},${r1(opt.target.y)}`, opt?.ell && `${r1(opt.ell.w)}x${r1(opt.ell.h)}`,
    pin && `${r1(pin.x)},${r1(pin.y)}`].join("|");

  const model = hole && project ? overlayModel({
    project, viewport: vp, hole, ball, accuracyM, pin, active: opt, other, previousShots,
    palette: drawn ? "paper" : "satellite", idPrefix, redrawKey, recomputing,
  }) : [];
  const base = hole && drawn && project ? fallbackMapModel({ hole, project }) : [];

  const onClick = (ev) => {
    if (!hole || !unproject || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const p = unproject({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    const pinP = p ? pinFromTap(hole, p) : null;
    if (pinP) { if (onPinTap) onPinTap(pinP); } else if (onMapTap) onMapTap();
  };

  const svgStyle = { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", display: "block", overflow: "visible" };
  const attrBottom = attributionBottom ?? Math.max(6, (insets.bottom || 0) - 10);
  return (
    <div ref={boxRef} className="loop-map" onClick={onClick}
      style={{ position: "absolute", inset: 0, overflow: "hidden", background: drawn ? T.paper : SAT_BG, touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
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
      {hole && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 6, bottom: attrBottom, padding: "1px 4px", background: "rgba(0,0,0,.4)",
          color: T.paper, fontFamily: F.label, fontSize: 9, lineHeight: "12px", whiteSpace: "nowrap", pointerEvents: "auto" }}>
          {!drawn && <><a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener" style={{ color: T.paper, textDecoration: "none" }}>© MapTiler</a>{" "}</>}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style={{ color: T.paper, textDecoration: "none" }}>© OpenStreetMap contributors</a>
        </div>
      )}
    </div>
  );
}
