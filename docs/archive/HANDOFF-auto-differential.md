# Build: auto-differential from in-app rounds (Ghost Match)

> **Archived.** Paths below say `Bogeyman-Matches`; that folder was renamed to
> `~/…/ClaudeCode/Ghost-Match` on Sep 26 2026, and the second clone at
> `Claude/Bogeyman-Matches` was deleted the same day. Kept for the record.


You're picking up the Ghost Match golf PWA. Goal for this session: **stop relying on
Brett's manually-updated Google Sheet for the last-5 differential, and instead compute
each round's differential automatically from the rounds recorded in the app**, averaging
the most recent 5. Read this whole file, then do the CONSOLIDATION steps before writing code.

## Background
Ghost Match is a self-contained single-page golf PWA (React UMD, no framework), deployed on
GitHub Pages, installed on Brett's iPhone. You play head-to-head against a handicap-calibrated
"ghost" scored from your last-5 rolling differential. Live:
https://brettryantalley-source.github.io/Bogeyman-Matches/ · Repo:
brettryantalley-source/Bogeyman-Matches. Currently at v13.

## Working-copy rule (learned the hard way)
The project has two iCloud clones of the same GitHub repo. The single source of truth is the
`ClaudeCode/Bogeyman-Matches` clone (path:
`~/Library/Mobile Documents/com~apple~CloudDocs/ClaudeCode/Bogeyman-Matches`). Sync via GIT,
not iCloud. Do NOT develop in the `Claude/Bogeyman-Matches` clone (it's stale). Also read
`CLAUDE.md` in the repo for standing rules.

## CONSOLIDATION — do first, in order
1. `git fetch`; confirm HEAD == origin/main and the tree is clean. Reconcile before touching code.
2. Read the current `src/app.jsx` — especially the Sheet-differential code and the
   history/record code (details below) — before changing anything.

## The task
Replace (or, per Brett's choice below, supplement) the Google Sheet source with a differential
computed from the app's own finished rounds.

## Current implementation to integrate with (in `src/app.jsx`)
- **Sheet source (to replace):** `CSV_URL`, `DIFF_CACHE_KEY = "bogeyman-matches:diff-cache:v1"`,
  helpers `parseCSV`, `parseSheetDate`, `computeLast5(text) -> {diff, asOf, count}`. In `Setup`:
  `syncDiff()` (cache-first -> fetch CSV -> `computeLast5`), a `source` state
  (`loading|sheet|cache|manual|none`), `bumpDiff`, the source label `srcLine`
  ("Last-5: 6.9 · from your Sheet (…)"), and a "USE SHEET" revert button. The resulting `diff`
  is passed to `computeGhost`.
- **History (the new data source):** `HIST_KEY = "bogeyman-matches:history:v1"`. Rounds are
  written by `buildRecord(base, course, diff, scores, ghost)`, which stores per round: `date`
  (ISO), `course` (name), `tee`, `ratingSlope` (a STRING like `"70.1/125"`), `differentialUsed`
  (the diff used for the ghost that round — NOT the round's own scoring differential),
  `yourTotal` (the player's gross), `ghostTotal`, `yourPoints`, `ghostPoints`, `result`,
  `holeScores`, `ghostHoleScores`, `yardages`. `deriveStats(history)` computes the W-L-T record.
  Rounds are only written on **Finalize** (completed rounds).
- **FROZEN — do not modify:** `computeGhost` and `evalMatch`.

## The math
A round's **Score Differential** ~= `(gross − courseRating) × 113 / slope`, where `gross` = the
player's `yourTotal` for that round. Round each to 0.1. Then take the **5 most recent finalized
rounds by date, average their differentials, round the average to 0.1** — same shape as the
current `computeLast5`, but over in-app history instead of the CSV. (Note this is a
simplification of the USGA calc — no adjusted-gross/ESC, no PCC. Confirm with Brett that
gross-vs-rating/slope is acceptable; it matches what his Sheet effectively did.)

## Data-model change needed
`buildRecord` currently stores rating/slope only as the `ratingSlope` string. To compute
differentials reliably, **store `rating` and `slope` as numbers** on each record going forward
(and/or compute+store a `differential` field per round). **Handle backward-compat**: existing
records only have `ratingSlope` — parse it (`"70.1/125"` -> 70.1, 125) so old rounds still
count. Recompute the last-5 whenever history changes (a finalized round, an inline edit, or a
delete must update the differential).

## Open decisions — confirm with Brett before building
1. **Source strategy / cold-start.** The app starts with no in-app rounds, and Brett's past
   rounds live only in the Sheet. Proposed default: **use in-app last-5 once there are >=5
   finalized rounds; below that, fall back to the Sheet (current behavior); manual override
   always available.** Confirm, or he may want in-app-only, or a manual toggle.
2. **How many rounds** to average (default 5, matching today).
3. **The formula simplification** above (gross, no adjustments) — OK?
4. **Keep the Sheet at all** long-term, or remove it once in-app history is the source?

## UI changes
- Update the Setup source label to reflect the real source (e.g. "Last-5: 6.9 · from your
  rounds" vs "· from your Sheet"), and keep the manual override + a "use auto" revert.
- Keep it graceful when there aren't enough rounds yet.

## Important dependency to flag to Brett
Match history is **localStorage-only** (`bogeyman-matches:history:v1`). Once the differential is
derived from that history, a browser cache wipe / reinstall would reset the differential basis
too. This strengthens the case for the **Phase 2 durable/cloud stats** work — mention it; don't
build it here unless Brett asks.

## Deploy loop & hard rules (from CLAUDE.md)
1. Edit `src/app.jsx` -> 2. run `./build.sh` (regenerates `index.html`; esbuild present, or
   `npx esbuild` fallback) -> 3. bump BOTH version markers together: `const BUILD = "vN · <date>"`
   (currently v13) and `sw.js` `const CACHE = 'bogeyman-matches-vN'` -> 4. **show Brett a diff**
   -> 5. **WAIT for his explicit "go" before commit/push** -> 6. Pages redeploys; Brett
   closes/reopens the app to load the new SW. NEVER modify `computeGhost`/`evalMatch`. Verify
   with a local server + the in-app browser at a phone viewport before shipping.

## Verification checklist
- [ ] With >=5 finalized in-app rounds, the Setup differential = rounded average of the last-5
      rounds' computed differentials (spot-check the math by hand).
- [ ] Old records (only `ratingSlope` string) are parsed and counted.
- [ ] Deleting/editing a round updates the differential.
- [ ] Below the threshold, the chosen fallback (Sheet/manual) works.
- [ ] Manual override still works and reverts.
- [ ] Source label reads correctly; ghost recomputes from the new diff.
- [ ] Build tag + sw cache bumped together; engine untouched.
