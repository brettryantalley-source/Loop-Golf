# Loop Golf — Development Log

**Log revision:** v5 · **current through app build:** v21.1
**Live:** https://brettryantalley-source.github.io/Loop-Golf/ · **Repo:** brettryantalley-source/Loop-Golf

A self-contained single-page golf side-game PWA (React UMD, no framework), deployed
as a static site on GitHub Pages and installed on Brett's iPhone. Brett plays
head-to-head against a handicap-calibrated "ghost" scored from his last-5 rolling
differential. See `CLAUDE.md` for standing rules and `HANDOFF.md` for cross-machine
resume context.

## Working-copy rule (learned the hard way)
The project existed as two clones of the same GitHub repo — an iCloud `Claude/` clone
frozen at v4 (never `git fetch`ed) and the `ClaudeCode/` clone at v5. The stale clone
caused a false "the sheet differential was never built" conclusion (it shipped as v5).
**Single source of truth = the `ClaudeCode/` clone; sync machines via GIT, not iCloud;
always `git fetch` and check `origin/main` before judging what exists.**

## Frozen invariants (do not change without an explicit ask)
- Scoring engine `computeGhost` / `evalMatch` — verified, treat as frozen.
- localStorage schemas: in-progress round `bogeyman-matches:v1`; match history
  `bogeyman-matches:history:v1`; differential cache `bogeyman-matches:diff-cache:v1`;
  per-course cache `course_cache_{id}`.
- Deploy loop (CLAUDE.md): edit `src/app.jsx` → `./build.sh` → bump BOTH `BUILD`
  (app.jsx) and `CACHE` (sw.js) together → show a diff → wait for explicit "go" → push.

## Version history
On-screen build tags began at v4 (when the tag + sw-cache-sync rule was introduced);
earlier commits predate the counter.

| Build | Commit | Date | What shipped |
|-------|--------|------|--------------|
| v21.1 | | Sep 27 | **Leaving a hole confirms a pending score.** Tapping a number once and then `Hole N+1` (or `Hole N-1`, or any cell in the Out/In strips) now writes that score, the same as tapping the number twice. Before this, navigating away discarded it silently — a real score lost with no signal, where a wrong one is a single tap to correct. Tapping a different number still moves the pending score; the last one tapped is what gets written. Nothing pending still navigates without writing. |
| v21 | (branch `redesign-v21`) | Sep 27 | **Paper scorecard redesign — Setup and mid-round.** Built from `loop-design/SPEC.md`, its two reference screens, and the 26 Sep behaviour decisions. New `src/theme.jsx` holds every colour and type token, the `#pencil` grain filter and the `#soft` pending-score disc; the Pinyon wordmark is outline paths, not a font. Five fonts ship as woff2 in `fonts/` and sit in the service-worker shell — nothing is fetched at runtime. **Setup:** double-rule card, course opens a full-screen paper picker, tee markers with yardage (default = the tee played here last, else the middle by yardage), read-only `HCap Diff` (the ± stepper and the per-round override are gone), last-five pencil chart with y inverted so a lower differential reads higher, record as five-bar tally marks. **Mid-round:** header points as `You N · up · Ghost N`, the current 3-hole segment card, the hole itself, and five relative-to-par options with **two-tap confirm** — first tap pends with a graphite disc, second writes and advances. **Long-press the red box goes past par+2**, because the differential's USGA cap is par + 2 + strokes received and a fixed par+2 ceiling would understate gross on stroked holes and drift the ghost harder. Out/In strips fill green/red/grey by hole result, yellow for the current hole; tapping a cell jumps there. Writing hole 18 with nothing else blank finishes the round. **Removed from the UI:** the Caddie, the Hole View, GPS and the Overpass geometry — their files, tests and the tile cache are PARKED on disk, not deleted. Summary and History are not redesigned yet and keep the dark palette behind `<DarkShell>`. Scores are still absolute stroke counts, so history, the differential and the cloud schema are untouched. `computeGhost`/`evalMatch` byte-identical; `npm test` 43/43. |
| v20 | `ca5ec12` | Sep 26 | **Renamed to Loop Golf.** On-screen name, `<title>`, manifest (`Loop Golf` / `Loop`), share sheet, backup filename prefix and `BACKUP_TAG`, package name, and the sw shell cache (`loop-golf-v20`). The GitHub repo, the Pages URL and the working folder all moved to `Loop-Golf`; the repo left `~/.claude`, which is Claude Code's config directory and a protected location. **Deliberately unchanged:** the `ghost` opponent everywhere in the engine and UI, the `bogeyman-matches:*` localStorage keys, the `bogeyman-tiles-v1` tile cache, and the Firebase project `ghost-match-cd04d` — the host is the same, so history, saved tiles and sign-in all carry over. `computeGhost`/`evalMatch` untouched. |
| v19 | `1a66cb1` | Sep 19 | **Hole View.** `src/holeMap.jsx`: MapLibre GL 5.24 (served same-origin from `vendor/`, in the service-worker shell) over MapTiler satellite (512-px XYZ, key origin-locked to the Pages host), hole-up (bearing player→green, pitch 0, rotation disabled), layers satellite → trouble (bunkers gold, water red) → dashed centreline → green outline → 48-point dispersion ellipse for the shown club with rim samples red where inside trouble → accuracy ring (> 8 m) → player dot. Fit player↔green (short/putt: the green), re-fit on hole/phase/first fix or when you walk out of frame. Tapping an alternatives chip swaps the ellipse and the card. **Offline:** `sw.js` gains a cache-first tile store `bogeyman-tiles-v1` that survives version bumps; Setup shows `Satellite offline · n/254 tiles — tap to save on wifi` and pre-fetches z16–18 for the course (~9 MB) straight into Cache Storage; with no tiles the geometry draws on a dark background. `geometry.js` adds ellipse/dispersion/tile math (43 node tests). Putt input placeholder shortened; GPS-to-middle hint moves into the card text. `computeGhost`/`evalMatch` untouched. |
| v18.5 | `7b36d57` | Sep 19 | **GPS picks the shot.** `src/geometry.js`: haversine/bearing, point-in-polygon, front/middle/back where the player→green ray enters and exits the green polygon, Overpass query + parser (greens assigned to holes by containment, else nearest ≤ 40 m; orphans warned), spec §4.3 auto-phase. Hole map fetched once when a course is picked (`lz4.overpass-api.de` first, main URL as fallback — the public instance 429s by IP), cached in `bogeyman-matches:geo:v1:{apiId}`; `buildCourse` now carries `apiId`/`lat`/`lon`. Caddie: `watchPosition` (high accuracy, 2 s max age) fills the distance and picks TEE/APPROACH/SHORT/PUTT; the four chips only appear when there is no fix or no green. One line shows `APPROACH · 140 to middle · F 125 · B 158`; tap it to override, AUTO to hand back; typing a number overrides GPS with a one-tap revert. Putts stay typed (GPS cannot read feet). No OSM green → stand on it and tap to mark; marks persist per course/hole in `bogeyman-matches:greens:v1`. Setup shows `Hole map · 18/18 greens from OpenStreetMap`. Real Hampton OSM fixture in `src/fixtures/`; 40 node tests. `computeGhost`/`evalMatch` untouched. |
| v18 | `3608980` | Sep 19 | **The Caddie.** Its own screen, toggled from Play (a round now opens on the Caddie; the ghost screen is one tap away, and both share `hole`/`scores` so swapping lands on the same hole). Phase chips TEE · APPROACH · SHORT · PUTT, a large distance input (tee pre-fills hole yardage), flags `tight · water L · water R` remembered per course and hole in `bogeyman-matches:caddie-flags:v1`, `wet · wind` riding with the round in `bogeyman-matches:v1`. The card shows club, swing, leave and zone grade, two why-lines that each cite a number from `src/profile.json`, and `Ghost: n` as a slate status line the engine never reads. Alternatives row: tap a club to see why it lost (4-hybrid shows its tee ban). Engine is `src/caddie.js` (Session 1, `b543e8a`); 29 node tests via `npm test`. `loadState` resumes the caddie screen like play. Fixes the two stale "API has no coords" comments. `computeGhost`/`evalMatch` untouched. |
| v17 | `b41b4e3` | Sep 19 | **Tapping a score advances to the next hole.** 350ms pause so the "logged ✓" confirmation registers before the dial swaps; hole 18 stays put (Finalize appears there); picking a hole yourself during the pause wins. |
| v16 | `71963c1` | Sep 19 | **Automatic cloud backup — Firebase Auth (Google) + Firestore.** Rounds mirror to `users/{uid}/rounds/{id}` in project `ghost-match-cd04d`, owner-only by security rules. Local-first: localStorage stays the read path, Firestore queues writes made without signal. Merge is a UNION by id, last-write-wins on a new `updatedAt` (records → v3); deletes write tombstones so they replicate instead of being resurrected. Sign-in uses redirect in an installed PWA, popup elsewhere. Adds npm + the Firebase SDK to the build (tree-shaken, still inlined). Verified end-to-end on Brett's phone: sign-in, write, tombstone delete. |
| v15 | `49e42a8` | Sep 19 | **Export / import rounds as JSON.** Export via the iOS share sheet (Save to Files), `<a download>` elsewhere. Import merges BY ID — an old export can never delete newer rounds. Now labelled MANUAL BACKUP beneath the cloud panel. |
| v14 | `1887a60` | Sep 19 | **Auto last-5 differential from in-app rounds — the Google Sheet source is gone.** Per-round Score Differential = (adjusted gross − rating) × 113 / slope, adjusted gross capping each hole at net double bogey using the same stroke-index distribution the ghost gets. Records → v2 (rating/slope/par + per-hole pars/strokeIndex as numbers); v1 records parse the `"70.1/125"` string and still count, uncapped. `SEED_ROUNDS` bakes in Brett's official last-5 (8.2) as a cold-start floor — differential only, never the W-L-T, and they age out as rounds are played. Also ships the v13 network-first service worker. |
| v13 | (in `1887a60`) | Sep 19 | **Network-first service worker.** Online you always get the latest bundle, so a deploy lands on the next open instead of needing a second reopen; offline falls back to cache and still serves the app at the course. |
| v12 | `b21e3e7` | Sep 19 | Score picker wheel for hole entry. |
| v11 | `71af90b` | Aug 23 | Ghost Race mid-round — running chart, hole board nav, score entry moved to the bottom. |
| v10 | `60753c5` | Aug 8 | Replace the leftover circles mark with a ghost logo mark. |
| v9 | `322add1` | Aug 8 | Don't resume empty rounds; add an exit button to the Play screen. |
| v8 | `59cf760` | Aug 8 | Rebrand to Loop Golf + new logo, round history button, course search & state filter. |
| v7 | `d2a5305` | Jul 26 | **Display quarter-points faithfully.** A tied nine splits 0.5 → 0.25 each, so match points can land on quarters; `fmtPts` had rounded to one decimal (2.25/5.75 shown as 2.3/5.8, appearing to sum to 8.1). Now prints up to 2 decimals, trailing zeros trimmed. Display-only — `evalMatch`/`computeGhost` untouched; scoring unchanged (0.5/nine, 1/total). First real on-course round (Sugar Creek GC, v6) surfaced this. |
| v6 | `147fc7b` | Jul 20 | **Live golfcourseapi.com course search** replaces the hardcoded 14-course library (debounced search, per-course caching, male/female tee picker skipping non-18-hole tees, spec'd error states). **One-screen Setup** (START pinned, never behind a scroll). Per-hole yardage stored in rounds → scorecard yardage row. sw.js same-origin guard so live API/CSV never serve stale from cache; build.sh npx-esbuild fallback. |
| v5 | `0ed33dc` | Jul 18 | **Auto last-5 differential** from Brett's published Google Sheet CSV (read-only): cache-first → network → manual fallback, source/as-of label, per-round manual override with USE SHEET revert. Fed into the existing `diff`; write-back deferred to Phase 2. |
| v4 | `03a60e9` | Jul 18 | Docs: require bumping the on-screen build tag in sync with the sw cache on every user-facing deploy. |
| v4 | `0382b36` | Jul 18 | On-screen build tag on Setup; match history with per-round delete. (Build-tag counter starts here.) |
| v4 | `864e35e` | Jul 18 | Tier 1: Finalize → Summary, full scorecard, inline hole edit, W-L-T record. |
| — | `e96b5b6` | Jul 18 | Docs: add `CLAUDE.md` project guide. |
| — | `387eaee` | — | Add Chicopee Sch/Mill routing; step differential by 0.1. |
| — | `0ac356d` | — | Add Bogeyman Matches PWA build. |
| — | `64ef061` | — | Initial commit. |

## v6 verification (live, mobile 375×812, real API)
Search → results → select → tee picker (15 Woodmont tees) → START enables · cached
re-select makes 0 Call-2 requests · full round → Finalize → scorecard YDS row renders ·
differential still auto-pulls (6.9 from Sheet) · manual override + USE SHEET intact ·
record `1–0–0 · W1 · +8.0` + History/delete intact · build tag `v6 · Jul 20`, sw cache
`bogeyman-matches-v6` · no old course library · one screen, START pinned.

## Field-test watch-list — first real round on v6 (report back what broke)
v6 was verified in a desktop browser at phone size with the live API — NOT yet on
Brett's phone, on cellular, at a course, mid-round. On the first real round, watch:
- [ ] **Course search finds the actual course** you're playing (try the real name/spelling).
- [ ] **The tee you play is in the picker**, and its **rating / slope / stroke index look
      correct** — a wrong stroke index silently skews the ghost. Sanity-check the ghost's
      "plays to" number against expectation.
- [ ] **Signal at the first tee.** v6's course search REQUIRES connectivity the first
      time a course is loaded (it caches after). See the top next-step below.
- [ ] **Differential** still auto-pulls from the Sheet (6.9-ish) with the source label.
- [ ] **50/day API cap** — if search ever just errors, this may be why.
- [ ] Full round → **Finalize → scorecard yardage row** shows; **record/History** update.

## Next steps (suggested order)
1. **Offline "recently played courses" quick-pick (top functional gap).** v6's course
   search needs a connection to find a course the first time — but the app's whole
   premise is "runs at the first tee, often no signal." Add a quick-pick of
   cached/recent courses (from `course_cache_{id}`) so Brett can tee off offline on any
   course he's loaded before.
2. **Durable stats (Phase 2).** History + record are localStorage-only today — a cache
   wipe / reinstall / new phone erases them. Add a lightweight cloud datastore; keep it
   additive (localStorage stays as the offline cache, cloud layers on top).
3. **Friends on their own phones (Phase 2).** Per-person records via a light identity
   (name / per-device id), NOT password accounts, so friends' histories don't mix.
4. **Sheet write-back.** Deferred since v5 — the app reads the differential from the
   Sheet but never writes finished rounds back; unifying them keeps everything in Brett's
   Sheets ecosystem.
5. **Polish / untested edges:** force Call-2 failure/retry; a course with no valid
   18-hole tees; one-tee courses; an in-app way to correct a bad tee's stroke index/
   rating; a clearer "change course" affordance after New round.

Phase 2 stays "simple hosted PWA, no backend" until the app is finished. Candidate
low-friction backends to weigh later (pick one): Supabase/Firebase, Cloudflare Workers +
KV/D1, or a Google Apps Script appending rounds to a Sheet. Details in `HANDOFF.md`.
