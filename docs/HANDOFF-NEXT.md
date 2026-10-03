# Loop — start-here for the next thread

**Folder to connect: `~/Developer/Loop-Golf`**

## First three commands
```bash
git status                 # must be clean
git log --oneline -6
npm install && npm test    # 274 tests; must be green
```

## Where things stand (Oct 1, after PR #11 merged)

Live at https://brettryantalley-source.github.io/Loop-Golf/ — **`main` is v22.16** (PR #11 merged Oct 1:
v22.14 pencil-only score marks D58, v22.15 shot log v2 `docs/SPEC-shotlog-v2.md` D59–D65, v22.16 Shot
Pattern importer + history card fix D66–D71; before it PR #10 sliders, PR #9 Ironwood fixes, PR #8
marked-green mode, PR #7 v22.6–v22.10, PR #6 v22.3–v22.5, PR #5 the caddie). The working branch
`claude/bold-pascal-2s136s` is restarted from `main` after each merge; nothing is unmerged.

**Shot Pattern rounds imported: seven of thirteen** — Ironwood 9/28, Hampton 9/20, Lake Arrowhead 9/12,
Beachwood 9/2, Canongate 8/23, Chicopee Woods Village/School 8/15, Riverpines 8/9: 558 records in
`src/shotpattern.json` (v22.16.1, Oct 1). Shot Pattern's round history runs back to Jun 17; still to
transcribe: Chicopee Village/Mill 8/3, Sugar Creek 7/26, Chicopee Mill/School 7/17, Woodmont 6/27,
Riverpines 6/21, Woodmont 6/17 — their cards are already in History (below), only the shot lists are missing.
**History since June (v22.16.1):** `src/seedRounds.js` holds 12 imported cards, Jun 17 → Sep 20, every
one reproducing GHIN's differential (GHIN's list: `data/extracted/2026-09-30-ghin-scores.json`). Only the
five newest reach the last-5, so the ghost stays at 7.4. Bear Slide 6/10 and Cider Ridge 6/6 are in GHIN
but predate Shot Pattern — no card, not in History, until Brett sends GHIN's hole-by-hole. Play dates are
Shot Pattern's (Brett, Oct 1): Beachwood 9/2 and Ironwood 9/28, though GHIN shows 9/5 and 9/30.
**Cards vs. the ghost (v22.16.2, D72):** every card is played against the ghost Loop would have built that
day (`ghostDiff`, `strokeIndex` from golfcourseapi) and counts toward the record: the cards alone are
**6–4–2**. June 17 and 21's ghosts average only 3 and 4 prior GHIN rounds — send GHIN rounds older than
May 16 to fill them. A new card needs both fields or it stays unscored (History shows it without a result).
**Routine for each** (a code thread does all of it; no middle step): Brett screen-
records Shot Pattern's round page — scorecard, Summary, then the four Shot List tabs (Driving, Approach,
Short Game, Putting) scrolled slowly top to bottom — and drops the recording in the chat. The thread
extracts frames (`ffmpeg -vf "fps=2,scale=460:-1"`, dedupe near-identical frames, 4-up contact sheets),
reads them, writes `data/extracted/rounds/{date}-{course}/shots.json` (schema 1; the five existing files
are the contract), reconciles every hole — drives + approaches + short game + putts + penalty strokes
must equal the card score — then `npm run import:shots`, `npm test` (274), the frozen check, `./build.sh`,
commit, push, PR, merge on Brett's "merge". Conventions learned: Shot Pattern's "(+2)" on a tee shot to a
penalty is one penalty stroke plus the re-tee (store `penalty: 1`, note it); "Unknown Club" → `null`;
clubs Dr, 2i, 2Hy, 4Hy, 5i–9i, PW, GW, SW, LW, putter; lies tee / fairway / rough / bunker / recovery /
penalty / green. Data-only commits do not bump the build tag.
Cloud containers block unpkg.com, which `./build.sh` uses for React: `npm pack react@18.3.1 react-dom@18.3.1`
and copy each `package/umd/*.production.min.js` to `build/react.min.js` / `build/react-dom.min.js` (byte-identical).

Queued builds: **v22.17 aim warning** (re-run the dispersion sim at Brett's target and line; warn when
trouble is 10+ points worse than the recommendation or his club bias leaves the green; n ≥ 10; reads
`tendencies()` in `learning.js`, which the imported rounds feed) and **v22.18 breadcrumb trail + stops**
(`SPEC-shotlog-v2.md` §10). Brett merges a PR from his phone (GitHub app or "merge" in the Claude app);
Pages redeploys in about a minute; he fully closes and reopens Loop and reads the build tag top-right
of Setup.

Engine as of v22.10 follows `docs/CADDIE-BRAIN-INTEGRATION.md` (D43–D46; known gaps in D46). **v22.16.9
adds part 2 of that file: Michael Leonard's *How to Play Wicked Smart Golf*** (notes in
`docs/research/wicked-smart-golf-2026-10-03.md`; Brett: where it disagrees with the Sep 29 research, the
guide wins). `src/caddie/strategy.js` chooses SAFE from the priced candidates — front / back pin → the
club whose average finishes mid-green, middle pin → wedges may attack, a short finish counts double;
from trees or a bad rough lie only a 9-in-10 shot, else punch out; driver on tee ties (D76). Left out on
purpose: aim-for-the-pattern (fold into v22.17), sand as a no-hero lie, a short-miss tail in the
simulation (D77). On the course: SAFE now often plays to the middle of the green and AGGRESSIVE can show
a lower average (`−0.n`) — that is the guide overruling the price, by design.
`npm test` is 299 tests (v22.16.9). Decisions run D1–D77 in `docs/DECISIONS-caddie.md`.

**Ironwood (Fishers, IN) is not traced in OpenStreetMap.** v22.11's marked-green mode is the
bridge (satellite on GPS, tap the green, distance-only pricing). First round there (Sep 29, v22.11):
the satellite never loaded and the app could not say why — v22.12 adds the Setup `Satellite check`
line; read it before the next round and report the exact text. The permanent fix is tracing the
course in the OSM iD editor; a prompt for a web-enabled chat to check OSM coverage was handed to
Brett on Sep 29.

**Woodmont (Canton, GA) has a hole map as of v22.16.3 (D73).** OSM has the club outline only (Overpass,
Oct 2: no holes, greens, tees, fairways or bunkers — the app was right to say `No course map`).
`src/localGeometry/woodmont.json` is a hand trace from aerial imagery: 18 hole lines, 18 greens, 58 tee
boxes, 17 fairways, 44 bunkers, the two lakes and the creek. `useCourseMap` reads it before the cache or
Overpass, so the Setup line reads `Course map ready` and the caddie draws every hole. It is NOT surveyed.
First round there: stand on the middle of three greens with the caddie open and read the distance to
the middle (should be 0–3 yds); report the offset by hole, and `shiftM` in the file moves everything at
once. Tee boxes marked `q: est` are ellipses on the pad centre, not outlines (8, 15 and 18 are the least
certain). No trees and no OB. The permanent fix is the same ways in OSM; the trace converts directly.

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
