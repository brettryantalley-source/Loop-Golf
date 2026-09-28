# Loop — start-here for the next thread

**Folder to connect: `~/Developer/Loop-Golf`**

## First three commands
```bash
git status                 # must be clean
git log --oneline -6
npm install && npm test    # 105 tests as of Sep 28–29 overnight; must be green
```

## Where things stand

Live at https://brettryantalley-source.github.io/Loop-Golf/ — **`main` is still v21.4**, untouched.
Overnight Sep 28–29 the caddie build ran on branch **`claude/bold-pascal-2s136s`**, draft PR
**https://github.com/brettryantalley-source/Loop-Golf/pull/5**. Nothing has merged. Next
user-facing ship is **v22**, and it isn't ready — the engine is done but nothing in the UI calls it
yet.

## What's done (pure modules, tested, nothing wired to the UI)

- **S1 — engine core.** `src/caddie/config.js`, `baseline.js`, `course.js`, `profile.js`,
  `engine.js`, `reasons.js`. `profile.js` loads `src/profile.json` v2, now BUILT by
  `scripts/build-profile.mjs` from `data/extracted/` (contract `docs/PROFILE-v2.md`) — never
  hand-edited again. `npm run build:profile` rebuilds it; `--check` verifies the committed file
  matches a fresh build.
- **S2 — geometry, sensors, context.** `src/caddie/geo.js` (OSM → hole frame, lie inference, the
  27-hole nine map, coverage check), `src/caddie/sensors.js` (Open-Meteo, injected fetch, never
  throws), `src/caddie/context.js` (assembles the engine's `ctx`). `src/geometry.js` extended to
  schema 2 (fairway/tee/rough/trees/boundary, multipolygon relations).
  Verified against the Hampton fixture only (18/18 holes, 2 orphan greens) — see open items below.
- **S4 logic — shot log.** `src/caddie/shotlog.js`: `bogeyman-matches:shots:v1`,
  `bogeyman-matches:lieOverrides:v1`. Storage injected, pure functions.
- **S5 logic — learning loop.** `src/caddie/learning.js`: within-round nudges, recency-weighted
  between-round shrinkage, shot-log overlays with takeover, lie-override takeover, the aggression
  scorecard.
- The parked v1 caddie (`src/caddie.js`, `src/caddie.test.js`, profile v1) is **deleted** — S1
  replaces both, per decision D9 (`docs/DECISIONS-caddie.md`).
- `npm test` now globs `src/**/*.test.js`: **105/105** (T1–T32, named as in `docs/SPEC-caddie.md`
  §9). `computeGhost`/`evalMatch` byte-identical throughout — verify this yourself before your
  first commit, don't take it on faith.
- Design files landed in the repo alongside the spec: `docs/SPEC-caddie-UI.md` (UI addendum v1)
  and `loop-design/U-Caddie.html`.
- Full list of overnight calls, each with its reasoning and where to flip it:
  `docs/DECISIONS-caddie.md` (D1–D18). Read it before touching the caddie; don't copy it elsewhere.

## In flight tonight (other agents, may already be further along than this)

- **S3a / S3b — the caddie screen UI.** Wiring `engine.js`/`context.js` into an actual screen in
  `src/app.jsx`, built from `loop-design/U-Caddie.html` and `docs/SPEC-caddie-UI.md`.
- **S4 UI** — the shot-log capture flow on top of `shotlog.js`.
- **S5 wiring** — hooking `learning.js`'s outputs (`ctx.adjust`/nudges/flags) into a live round.

Check `git log` and `docs/README.md` before starting anything — one of these may have already
landed on top of this handoff.

## Open items for Brett

1. **Verify the baseline table.** `src/caddie/baseline.js` cites Broadie's PGA Tour expected-
   strokes table (*Every Shot Counts*, 2014) but was transcribed with no network access — golf-
   stats sites are blocked from this build container. Check it against the book before S3 ships.
   It's a Tour baseline, not scratch (Shot Pattern's SG is vs. scratch, ~0.2–0.3 strokes off at
   100–200 yds) — `BASELINE_SCRATCH_OFFSET` in `config.js` is there for a flat correction if you
   want the displayed numbers closer to scratch; it doesn't change club rankings either way.
2. **Ironwood 27-hole coverage.** S2 only checked against the Hampton fixture (18/18, complete).
   The Ironwood 27-hole routing and its nine-map assignment need a real Overpass fetch, which this
   container couldn't reach.
3. **Open-Meteo field names / CORS.** `sensors.js` is built against the documented request/response
   shapes, not verified live. First on-device load will show whether the field names and CORS from
   `github.io` behave as expected.
4. **MapTiler terms.** Still open from the earlier Hole View handoff — carried forward, not new.
5. **Wedge lofts.** `loftDeg` is `null` for every wedge (spec §11 open item) — GW/SW/LW actual
   lofts aren't recorded anywhere.
6. **Finesse carries for GW/SW/LW.** Decision D6: SW/LW medians are stored as finesse-only
   (Brett plays them finesse inside 120, doesn't hit the 54° full); GW is a blended full entry.
   The finesse carries themselves are still placeholders (`n: null`) — need real finesse-swing
   data.
7. **Remaining `ell80` clubs.** `data/extracted/2026-09-19-ell80.json` has PW, 9i, 2Hy, 4Hy.
   Pending: Dr, 2i, 5i, 6i, 7i, 8i, GW, SW, LW, and every finesse entry (see the file's `pending`
   list).
8. **D1–D18 in `docs/DECISIONS-caddie.md`** — review and flip anything you don't like. Nothing
   there is load-bearing beyond the line it names.

## Non-negotiable

- `computeGhost` and `evalMatch` are frozen. Verify byte-identical before every commit.
- Never rename the `bogeyman-matches:*` localStorage keys or the Firebase project `ghost-match-cd04d`.
- `.nojekyll` stays — Pages fails without it.
- Every user-facing deploy bumps `BUILD` in `src/app.jsx` AND `CACHE` in `sw.js`, together.
- `./build.sh` after every `src/` edit. `index.html` is generated; never hand-edit it.
- Show a diff and wait for Brett's explicit go before committing or pushing. The caddie branch's
  own "go" is separate: it's the PR merge, per decision D10.
- Offline-first. Nothing fetched at runtime that the app needs to render.
- `src/profile.json` is generated, not hand-edited. Edit `data/extracted/` or
  `scripts/build-profile.mjs`, then `npm run build:profile`.

## Parked on disk, not in the UI

The Hole View, GPS: `src/holeMap.jsx`, `src/fixtures/`, `vendor/`. `src/geometry.js` is no longer
purely parked — the caddie build extended it and `src/caddie/geo.js` now imports it, but nothing
bundles it into `index.html` yet. Their tests still run under `npm test`.

---

## The feature

Caddie engine, shot log and learning profile: **`docs/SPEC-caddie.md`** (locked Sep 27) and
**`docs/SPEC-caddie-UI.md`** (UI addendum v1). `docs/DECISIONS-caddie.md` overrides the spec where
they disagree. Build order is spec §9 — S1/S2/S4-logic/S5-logic are done; you're picking up S3
and/or the remaining UI wiring.
