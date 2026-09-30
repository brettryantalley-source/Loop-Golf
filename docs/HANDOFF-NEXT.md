# Loop — start-here for the next thread

**Folder to connect: `~/Developer/Loop-Golf`**

## First three commands
```bash
git status                 # must be clean
git log --oneline -6
npm install && npm test    # 252 tests; must be green
```

## Where things stand (Sep 29, after the v22.11 build)

Live at https://brettryantalley-source.github.io/Loop-Golf/ — **`main` is v22.12** (PR #9 merged Sep 29:
Ironwood field-test fixes D51–D55; PR #8 marked-green mode + pin; PR #7 v22.6–v22.10; PR #6
v22.3–v22.5; PR #5 the caddie). `main` also has v22.13 (PR #10, sliders D56–D57). Branch **`claude/bold-pascal-2s136s`** carries
**v22.14** (pencil-only score marks, D58) and **v22.15** (shot log v2, `docs/SPEC-shotlog-v2.md`,
D59–D65) in PR #11. Queued after it: v22.16 aim warning (re-run the dispersion sim at Brett's target and
line; warn when trouble is 10+ points worse than the recommendation or his club bias leaves the green;
n ≥ 10), v22.17 a Shot Pattern per-round Shot List importer (screenshots → JSON under
`data/extracted/rounds/` → `source: shotpattern` records through the History import; the first round,
Ironwood 2026-09-28, is partly transcribed in `data/extracted/rounds/2026-09-28-ironwood/shots.json`),
and v22.18 the breadcrumb trail + stops (`SPEC-shotlog-v2.md` §10).
Brett merges a PR from his phone (GitHub app or "merge" in the Claude app); Pages redeploys in
about a minute; he fully closes and reopens Loop and reads the build tag top-right of Setup.

Engine as of v22.10 follows `docs/CADDIE-BRAIN-INTEGRATION.md` (D43–D46; known gaps in D46).
`npm test` is 252 tests. Decisions run D1–D65 in `docs/DECISIONS-caddie.md`.

**Ironwood (Fishers, IN) is not traced in OpenStreetMap.** v22.11's marked-green mode is the
bridge (satellite on GPS, tap the green, distance-only pricing). First round there (Sep 29, v22.11):
the satellite never loaded and the app could not say why — v22.12 adds the Setup `Satellite check`
line; read it before the next round and report the exact text. The permanent fix is tracing the
course in the OSM iD editor; a prompt for a web-enabled chat to check OSM coverage was handed to
Brett on Sep 29.

## What each screen does now

- **Setup.** Picking a course now also fetches its OSM geometry (cached
  `bogeyman-matches:geo:v1:{apiId}`, schema 2) and prefetches satellite tiles into
  `bogeyman-tiles-v1` — status lines `Course map ready` / `Course map · loading n of 18` /
  `Course map unavailable · caddie will use yards`.
- **Start round** opens the **caddie screen** directly, hole 1 pre-tee (D22) — not the scorecard.
- **CaddieScreen** (`src/app.jsx`, driven by `src/caddie/caddieState.js`): collapsed/expanded rail,
  Safe/Aggressive toggle, six chips (Lie, Quality, Wind, Elevation, Pin, Conditions — printed vs.
  pencil per §7.2), pin by chip tap or a tap on the map, `Log shot` → `LongCardSheet` (Good shot ✓
  quick path or a full Detail log), every §8 state (pre-tee/locating/ready/same-shot/low-accuracy/
  on-the-green/no-GPS-fix/location-off/yards-entered/no-course-map/no-satellite/no-profile).
- The map (`src/caddie/mapLayer.jsx` + `overlay.js`) is MapLibre over MapTiler satellite when tiles
  are cached, or a flat drawn map from OSM polygons (§4.3) when they aren't; both draw the same
  dispersion-ellipse overlay.
- `‹ Card` returns to the scorecard, which gained a `Caddie` control in the hole-nav row; caddie
  state persists under `bogeyman-matches:v1.caddie` and restores exactly on reload/relaunch.
- **Summary and History** now show an `AggressionLines` line (Safe vs. Aggressive clubs played),
  per round on Summary and as a season roll-up on History.

## Requirements for the caddie to work fully

- **GPS.** Permission prompt fires on the first `I'm on the tee`. No fix / no permission both fall
  back to `Enter yards` (club-brain mode: profile only, no map).
- **Course geometry.** Fetched from OSM on Setup when the course is chosen, cached per `apiId`.
  Missing or incomplete geometry for a hole → `No course map`, `Enter yards` only.
- **Satellite tiles.** Prefetched into `bogeyman-tiles-v1` on Setup. Missing tiles → the map draws
  from course data on paper (§4.3), not a hard failure.
- Enter yards / club-brain mode is the fallback whenever there's no course map OR no GPS fix.

## Storage keys added by this build

- Shots: `bogeyman-matches:shots:v1`. Lie overrides: `bogeyman-matches:lieOverrides:v1`.
- Per-course 27-hole nine mapping: `bogeyman-matches:nineMap:v1:{courseId}`.
- Config overrides: `bogeyman-matches:config:v1` (merged over `DEFAULT_CONFIG`).
- Caddie round state: inside `bogeyman-matches:v1` under the `caddie` key.
- Shot log export/import lives on the History screen.
- All still in the `bogeyman-matches:*` namespace — no `loop.*` keys were introduced.

## On-device verification

Do the on-course walkthrough in **`docs/FIELD-TEST-v22.md`** before or right after merging — GPS,
geometry, tiles and Open-Meteo can only really be checked live. It covers: before-leaving-the-house
checks, first tee (permission prompt, states, pin, details, Aggressive toggle, Enter yards
fallback), mid-round (ball position, previous-shot prompt, Good shot ✓, Detail log, lie
corrections), hole-out, after-the-round (Summary/History aggression lines, shot-log export, Shot
Pattern export), and what to report back.

## Open follow-ups

Unverified in this build container (no internet access):
1. **Broadie baseline transcription** (D1–D2) — `src/caddie/baseline.js` cites the published PGA
   Tour expected-strokes table but was never checked live against the book.
2. **Overpass / Open-Meteo field names + CORS** — built against documented shapes only.
3. **Ironwood 27-hole OSM coverage** — S2 verified against the Hampton fixture only.
4. **MapTiler caching terms** (D19) — tile prefetch is ON behind `TILE_PREFETCH_ENABLED`; flip it
   off in `src/caddie/mapLayer.jsx` if the terms turn out to forbid offline caching.
5. **iOS PWA geolocation permission behavior** — first-run prompt inside an installed PWA, unverified.
6. **Real safe-area insets** on-device.
7. **Pencil-filter performance** on the phone (map + overlay redraw under `filter: url(#pencil)`).

Also open (from `docs/DECISIONS-caddie.md`):
- **D31** — the engine applies `aimYds` but doesn't clamp the shifted target to the fairway/green
  polygon; the displayed `Plays` number doesn't move when a distance nudge fires.
- Wedge lofts (`loftDeg` null for every wedge), finesse carries for GW/SW/LW (placeholders, `n: null`),
  remaining `ell80` clubs (Dr, 2i, 5i, 6i, 7i, 8i, GW, SW, LW, finesse — see the file's `pending`
  list in `data/extracted/2026-09-19-ell80.json`).

## Refresh workflow (spec §5.8)

After a round: on History, **Export shot log** → hand the export (or a **Shot Pattern export** for
the round) to the Golf project chat → it lands under `data/extracted/` → run
`npm run build:profile` (or `node scripts/build-profile.mjs --check` to verify without writing) to
regenerate `src/profile.json`. Never hand-edit `src/profile.json` directly.

## Decisions to review

`docs/DECISIONS-caddie.md` (D1–D31) — calls made during the build to keep it moving. Nothing there
is load-bearing beyond the line it names; read it before touching `src/caddie/`, don't copy it
elsewhere.

## Non-negotiable

- `computeGhost` and `evalMatch` are frozen. Verify byte-identical before every commit.
- Never rename the `bogeyman-matches:*` localStorage keys or the Firebase project `ghost-match-cd04d`.
- `.nojekyll` stays — Pages fails without it.
- Every user-facing deploy bumps `BUILD` in `src/app.jsx` AND `CACHE` in `sw.js`, together.
- `./build.sh` after every `src/` edit. `index.html` is generated; never hand-edit it.
- Show a diff and wait for Brett's explicit go before committing or pushing. The caddie branch's
  own "go" is separate: it's the PR #5 merge.
- Offline-first. Nothing fetched at runtime that the app needs to render.
- `src/profile.json` is generated, not hand-edited. Edit `data/extracted/` or
  `scripts/build-profile.mjs`, then `npm run build:profile`.
- **Never run two code threads on `src/app.jsx` at once** — one working copy, one code thread at a
  time (docs-only threads may overlap; a second parallel code thread needs its own git worktree).

## Parked on disk, not in the UI

`src/holeMap.jsx` — superseded by `src/caddie/mapLayer.jsx`, still unimported, its tests still run.
`vendor/maplibre-gl.*` and the satellite tile cache (`bogeyman-tiles-v1`) are **live again** — the
caddie lazy-loads MapLibre from `vendor/` on first open and both files are back in the `sw.js`
shell. The parked v1 caddie (`src/caddie.js`, `src/caddie.test.js`) is gone (D9); `src/caddie/`
replaces it.

---

## The feature

Caddie engine, shot log and learning profile: **`docs/SPEC-caddie.md`** (locked Sep 27) and
**`docs/SPEC-caddie-UI.md`** (UI addendum v1, §8 states / §13 flags). `docs/DECISIONS-caddie.md`
overrides the spec where they disagree. Build order was spec §9 — S1 through S5 are all done; this
thread's job is on-device verification and, once Brett merges PR #5, moving on to the next feature.
