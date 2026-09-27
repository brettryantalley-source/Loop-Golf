/* Loop — network-first service worker (latest when online, cached fallback offline).
   The Hole View is parked (v21), so no new satellite tiles are cached. The existing
   tile store is deliberately KEPT, not deleted, so the feature can come back without
   a re-download; nothing reads it today. */
const CACHE = 'loop-golf-v21-2';
const TILES = 'bogeyman-tiles-v1';          // survives app-version bumps; only its own name is kept below
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-512.png',
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
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
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
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
