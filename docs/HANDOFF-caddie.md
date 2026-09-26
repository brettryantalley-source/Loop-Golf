# Build: the Caddie (v18) + Hole View (v19) — Ghost Match

You're picking up the Ghost Match golf PWA to add a **caddie**: on every shot it tells Brett
which club, where to aim, and why — with the "why" always citing one of his own numbers.

**This file is the corrections-and-context layer. The full feature spec is a separate
document Brett will paste alongside it** ("Bogeyman Matches — v7 Caddie + v8 Hole View").
Where the two disagree, THIS FILE WINS — the spec was written against a stale picture of the
repo, and the conflicts are listed in §3. Read both before writing code.

---

## 1. Working-copy rule (learned the hard way)
The single source of truth is
`~/Library/Mobile Documents/com~apple~CloudDocs/ClaudeCode/Ghost-Match`
(renamed from `Bogeyman-Matches` on Sep 26 to match the app). Sync via GIT, not iCloud.
The second clone at `Claude/Bogeyman-Matches` was stale and was deleted Sep 26 — if you
find a `Bogeyman-Matches` folder anywhere, it is not this repo.
Read `CLAUDE.md` in the repo for standing rules — it is current.

## 2. Where the app actually is — v17, not v6
The spec says the build log is "currently at v5/v6". It is not. Shipped since:

| Version | What |
|---|---|
| v13 | Network-first service worker — deploys land on the next open, no double-reopen |
| v14 | **Auto last-5 differential from in-app rounds.** Google Sheet source removed entirely |
| v15 | Export / import rounds as JSON (manual backup) |
| v16 | **Automatic cloud backup** — Firebase Auth (Google) + Firestore, verified end-to-end |
| v17 | Tapping a score on the dial auto-advances to the next hole |

Also true now and not reflected in the spec:
- The app has **npm dependencies** (`package.json`, Firebase SDK, `node_modules/` gitignored).
  Run `npm install` before `./build.sh` in a fresh clone.
- Round history is **cloud-synced** to `users/{uid}/rounds/{id}` in Firebase project
  `ghost-match-cd04d`. Deletes are tombstones. Merge is a union by id, last-write-wins on
  `updatedAt`. **Stay off Cloud Functions** — they force a billing upgrade; everything is
  client-side and free.
- The last-5 differential is **derived from round history**, with `SEED_ROUNDS` in
  `src/app.jsx` as a baked-in floor (Brett's official last-5, currently 8.2).
- `docs/DEVLOG.md`'s version history table stops at v7 (Jul 26) and is ten versions stale.
  Bringing it current is a good first docs commit; append, never rewrite.

## 3. Corrections to the spec — apply these

### 3.1 Version numbers: ship as v18 and v19, NOT v7 and v8
`v7` is already taken in `docs/DEVLOG.md` (Jul 26, the quarter-points display fix), and the
live build tag is `v17`. Shipping a "v7" would collide with real history and push Brett's
installed PWA backwards through the service-worker cache name.
- Caddie card ships as **v18**. Hole View ships as **v19**.
- Keep "Caddie" / "Hole View" as the feature names in copy and the DEVLOG.

### 3.2 Two screens with a toggle — NOT one combined screen (Brett's call)
The spec §3 puts the caddie card "on the existing hole screen, above score entry." **Don't.**
Brett wants the ghost game screen and the caddie/map screen kept separate, with a button on
each that swaps to the other.

Why this is right: the Play screen is `height: 100dvh` with `overflow: hidden` and
`justifyContent: space-between` — a fixed full-height layout with no spare room. Dropping a
card into it would force a scroll rework. Separate screens leave Play untouched.

Consequences to build to:
- Add `caddie` to the `screen` switch in `App` (`setup | play | caddie | summary | history`).
- `course`, `hole` and `scores` already live in `App` — both screens read the same state, so
  swapping on hole 7 lands on hole 7. Nothing to plumb.
- This composes with v17 auto-advance for free: log a score on Play, the hole advances, swap
  and the caddie is already on the new hole.
- **`loadState` needs extending.** It only resumes an in-progress round when
  `screen === "play"`. Closing the app on the caddie screen currently drops you to Setup and
  loses your place. Resume `caddie` the same way.
- Put the toggle in the same position in both headers so it reads as one control. The Play
  header has the exit `X` at left and `HOLE n/18` at right; the middle of that bar is free.
- Spec §3's "collapsible; default expanded" is no longer needed — on its own screen the card
  is simply always open.
- **DECIDED (Brett, Sep 19):** a round opens on the **caddie** screen — you are on the tee
  wanting a club before you need a scorecard. The ghost/Play screen is one tap away.

### 3.3 Four bugs in the spec's engine section
1. **§2.4 is a no-op:** `playing = flags.wet ? distance : distance` — both branches identical.
   Decide what wet actually changes (the club-up is handled separately) and write it, or
   delete the line.
2. **Acceptance test #5 contradicts §2.4.** Approach 140 → stock is 9i, whose `shortPct` is
   `0.00`, so the rule produces `swing: "stock"`. The test expects `swing: easy`. Fix one.
   (Recommendation: the rule is right; relax the test to `swing: "stock", target: "center"`.)
3. **§2.3 references `secondClub`** in the par-5 value formula without defining how it is
   chosen. Define it: the approach club whose median best leaves 130–150.
4. **Zone boundaries overlap.** 75 appears in both `50–75` and `75–100`, and so on at every
   seam. Pin the convention as `from <= d < to` and test the seam values.

### 3.4 One spec claim that checked out — and one repo comment that is now wrong
`src/app.jsx` says twice that "the API has no geo/coords". **That is now stale.**
golfcourseapi does return coordinates. Verified Sep 19 2026:

    GET /v1/search?search_query=Hampton%20Golf%20Village
    id xa17vk0a · location.latitude 34.301726 · location.longitude -84.060013

Fix those two comments while you're in there. The map has its anchor; §4.1 is buildable.

## 4. Verified for you already

### 4.1 `src/profile.json` — written and validated, in the tree
Transcribed verbatim from the spec and JSON-validated: 13 clubs, 8 zones, 13 bench points.
Tee-legal clubs are `Dr, 2i, 2Hy`; `4Hy` carries `teeBanReason`. One addition:
`constants.strokeToParScale: 0.5` — the spec's §2.2 says to keep the stroke→par conversion
`0.5` as a named constant, so it lives in the profile rather than in code.

### 4.2 Hampton Golf Village is well mapped in OSM — confirmed
Overpass query from spec §4.1, bbox = anchor ± 0.015 lat / ± 0.02 lon, returned 196 elements:

| Feature | Count |
|---|---|
| `golf=hole` | **18** — every hole, each with `ref` 1–18 |
| `golf=green` | 20 |
| `golf=bunker` | 41 |
| `natural=water` | 27 |
| `golf=tee` | 84 |
| `golf=fairway` | 6 |

Four things that fall out of the real data:
- **`handicap` is absent on every hole**, and `par` is missing on hole 5. Do NOT treat OSM as
  a source for par or stroke index — golfcourseapi already supplies both and is authoritative.
  Use OSM for **geometry only**. That simplifies §4.1's "cross-check" step to nothing.
- **20 greens for 18 holes.** The nearest-centerline-endpoint match (≤ 40 m) is genuinely
  needed and can mis-assign. Log a warning when a green matches no hole, and make the
  tap-to-place fallback work per-hole, not just per-course.
- **Most centerlines are 2 nodes** (straight tee→green); doglegs (3, 4, 7, 10, 16) have 4–5.
  Two nodes is enough for a tee→green bearing; don't assume a rich polyline.
- **Overpass returns 406 without a User-Agent.** Browsers always send one, so `fetch` from
  the app is fine — but any node-side test script must set one.

### 4.3 MapTiler — account and key exist (done Sep 20, 2026)
Brett's MapTiler Cloud account (free plan) has one key, created for this app and verified:

| | |
|---|---|
| Key name | `Ghost Match PWA` |
| Key | `3frli95k3gG0NelkI7Kx` (client-side by design; origin-locked, see below) |
| Allowed HTTP origins | `brettryantalley-source.github.io`, `localhost`, `127.0.0.1` |
| Raster XYZ | `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=KEY` |
| TileJSON | `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=KEY` |
| Zoom | 0–22, jpg, tileset version 2.5 |
| Attribution (required) | `© MapTiler © OpenStreetMap contributors` |

Verified with curl: a tile request carrying `Origin: https://brettryantalley-source.github.io`
returns 200 (image/jpeg, ~55 KB at z16); a foreign origin or no origin returns 403. So a
node-side tile pre-fetch script must send that Origin header, and the in-app tile cache (§5)
works unchanged because the PWA's own requests carry the Pages origin. WMTS and the OGC Tiles
API are not on the free plan — use XYZ.

## 5. Decide before Session 4: the map must work with bad signal
This app is deliberately offline-first — network-first service worker with cache fallback,
Firestore queuing writes in dead zones, localStorage as the read path. That was built because
signal is bad at the course.

v19 depends on **live satellite tiles** and an **Overpass fetch at course selection**. At a
course with two bars, the marquee feature is a grey rectangle — and the caddie's distances
depend on the same geometry. Decide the caching story UP FRONT; retrofitting tile caching into
MapLibre afterwards is much harder than designing for it:
- Pre-fetch the Overpass geometry when the course is selected (already specified) AND persist
  it — it is small and cache-friendly.
- Pre-fetch and store the satellite tiles for the course bbox at the zooms you render, on
  wifi, before the round. Budget this as real work in Session 4, not Session 5 polish.
- Degrade honestly: if tiles are missing, draw the geometry on a plain dark background rather
  than showing a broken map. The ellipse, green outline and distances all still work.

## 6. Build order

| Session | Deliverable | Ship |
|---|---|---|
| 1 | `src/caddie.js` + `src/caddie.test.js`, node tests green (spec §8, with §3.3 fixes) | no |
| 2 | Caddie **screen** + toggle, phase chips, flags, manual distance, persistence | **ship v18** |
| 3 | Overpass fetch + cache + tap-to-place fallback + GPS distance (no map) | ship v18.5 |
| 4 | MapLibre + satellite + tile caching + ellipse + trouble overlap + chips + auto phase | **ship v19** |
| 5 | Hampton field test; tune `constants`; copy pass | ship v19.1 |

`profile.json` is done, so Session 1 is engine + tests only.

Session 4 needs a **MapTiler account** (free, no card) for satellite tiles — that is a
Brett-must-do signup, like Firebase was. Get the key before the session starts.

## 7. Frozen — do not modify
- `computeGhost` and `evalMatch`. Verified and correct. Every session so far has confirmed
  them byte-identical before committing; keep doing that.
- **The ghost is a status line, never an input.** The ghost score may render under the card as
  `Ghost: 5` in slate. It must not change the club, the target, or a single word of the why.
  Spec test #10 enforces this — do not let it be "simplified" away.

## 8. Deploy loop (from CLAUDE.md)
1. Edit `src/app.jsx` (and the new `src/*` files) → 2. `npm install` if deps changed →
3. `./build.sh` → 4. bump BOTH `const BUILD = "vN · <date>"` and `sw.js`
`const CACHE = 'bogeyman-matches-vN'` together → 5. **show Brett a diff** → 6. **wait for his
explicit "go"** before commit/push → 7. Pages redeploys; since v13 the new bundle loads on the
next open.

Verify with a local server at a phone viewport (375×812) before shipping. `python3 -m
http.server` from the repo root works; the in-app browser can drive it.

## 9. Open items not in scope here
- `docs/DEVLOG.md` version history is stale at v7 — append v13–v17.
- The two "API has no coords" comments in `src/app.jsx` are wrong (§3.4).
- Bundle is 878KB raw / **252KB gzipped** over the wire. That is fine today. MapLibre adds
  roughly 200KB gzipped; at ~450KB consider splitting Firebase and the map into separate
  files loaded on demand, rather than inlining everything into `index.html`.
- v15's manual export/import still ships under the cloud panel as a fallback. Brett has not
  asked to remove it.
