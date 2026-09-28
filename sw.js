/* Loop — network-first service worker (latest when online, cached fallback offline).
   v22: the caddie's map is back, so the satellite tile store is read again — cache-first,
   filled by the Setup prefetch and while playing. Its name stays bogeyman-tiles-v1 (the
   Sep 28 storage-key decision), so tiles saved by v19 carry over. MapLibre is served
   same-origin from vendor/ and is in the shell so the map starts with no signal. */
const CACHE = 'loop-golf-v22-1';
const TILES = 'bogeyman-tiles-v1';          // survives app-version bumps; only its own name is kept below
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-512.png',
  // MapLibre GL 5.24 (v22 caddie map) — loaded on first use of the caddie screen.
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  // Bundled fonts (v21) — the paper design renders wrong without them offline.
  './fonts/bitter-latin-400-normal.woff2',
  './fonts/bitter-latin-500-normal.woff2',
  './fonts/bitter-latin-700-normal.woff2',
  './fonts/old-standard-tt-latin-400-normal.woff2',
  './fonts/old-standard-tt-latin-700-normal.woff2',
  './fonts/reenie-beanie-latin-400-normal.woff2',
  './fonts/architects-daughter-latin-400-normal.woff2',
];
const TILE_HOST = 'api.maptiler.com';

self.addEventListener('install', (event) => {
  // Per-entry, not addAll: addAll is all-or-nothing, so one flaky fetch on cellular
  // aborted the whole install and left the shell — fonts included — uncached.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Satellite tiles: cache-first. Imagery does not change between rounds, and at the course
  // there may be no signal at all. Pre-fetched on wifi from Setup; also filled while playing.
  if (url.hostname === TILE_HOST && url.pathname.startsWith('/tiles/')) {
    event.respondWith(
      caches.open(TILES).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  // Other cross-origin live data (golfcourseapi, Overpass, Firebase) always hits the network.
  if (url.origin !== self.location.origin) return;
  // Network-first for same-origin shell: online you always get the latest bundle
  // (deploys show on the next open, no double-reopen). Offline, fall back to cache,
  // and serve the cached page for navigations so the app still launches at the course.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        // Only a NAVIGATION may fall back to the shell. Handing index.html to a font,
        // script or stylesheet request answers it with HTML: the browser rejects the
        // bytes and silently drops to a fallback family, which reads on the phone as
        // "the fonts changed". A real failure has to fail.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
