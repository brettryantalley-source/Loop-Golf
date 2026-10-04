# Loop — open items (Oct 4, after v22.17.2 / PR #25)

Everything still unresolved as of `main` = **v22.17.2** (325 tests, decisions D1–D87, no open PRs).
Read `CLAUDE.md` and `docs/HANDOFF-NEXT.md` first; this file only lists what is left and who does it.
When an item closes, delete it here in the same commit.

Legend: **B** = Brett decides or does it on the phone · **T** = a code thread does it.

---

## 1. Decisions Brett owes

### 1.1 Native app, yes or no (B)
Asked Sep 30, never recorded. The breadcrumb trail shipped foreground-only in v22.17 (D84): iOS gives a
web app no GPS when the phone is locked or backgrounded, so the trail has gaps, and Brett declined the
keep-screen-on toggle. The only fix for the gaps is a native shell: a Capacitor wrapper around the
existing bundle, an Apple Developer account ($99/yr), and a Mac or a GitHub Actions macOS runner to
build it. Nothing else in the app needs native. Decide: live with gaps, or schedule the wrapper.

### 1.2 Older GHIN rounds (B)
The June 17 and 21 ghosts are built from only 3–4 prior GHIN rounds. Sending GHIN rounds older than
May 16 (hole-by-hole or at least differentials) fills them. Bear Slide 6/10 and Cider Ridge 6/6 are in
GHIN but have no card in History until Brett sends GHIN's hole-by-hole for them.

## 2. Things Brett checks on the phone (B)

- **v22.17.2 loaded.** Fully close and reopen Loop; the Setup build tag reads `v22.17.2`.
- **Untested since the Oct 3 field test** (v22.17 rebuilt the caddie screen afterwards): the putting
  flow end to end, the trail on a real walk, the full-screen map against the phone's safe areas.
- **Read Summary after the next round:** `Tee shots: Safe · Aggressive · Custom`. More Custom than
  either other means the caddie's calls are not landing — report the counts.
- **Woodmont** first round: stand on the middle of three greens with the caddie open and report the
  distance to the middle (should be 0–3 yds) so `shiftM` in `src/localGeometry/woodmont.json` can be set.
- **Ironwood** next round: read and report the exact text of Setup's `Satellite check` line.
- **Shot Pattern mis-tags** worth fixing at the source so future exports are clean: Lake Arrowhead
  9/12 hole 8 "9i · 287 yds"; Hampton 9/20 hole 6 "Unknown Club · 86 yds". Loop stores both as recorded.

## 3. Data still to import (T, as recordings arrive)

Shot lists still missing (their cards are already in History): **Sugar Creek 7/26, Chicopee
Mill/School 7/17, Woodmont 6/27, Riverpines 6/21, Woodmont 6/17.** Routine, conventions and the
per-hole reconciliation rule are in `docs/HANDOFF-NEXT.md` "Where things stand". Each round is a
data-only commit (no build-tag bump), its own PR, merged on "merge".

## 4. Builds queued (T)

### 4.1 Aim warning (next feature build; Opus-tier)
Still queued; the number v22.17 was taken by the field-test build, so this becomes v22.18. Spec in
`docs/HANDOFF-NEXT.md` "Queued builds" plus D68 and D77 (aim-for-the-pattern was left out of the
Wicked Smart integration to fold in here). When Brett's target or line differs from the recommendation,
re-run the dispersion simulation at *his* target/line and warn when (a) expected trouble is 10+ points
worse than the recommended line, or (b) his club's directional bias from `tendencies()` carries the
ellipse centre off the green. Fires only with n ≥ 10 shots for that club. One line on the bar in the
`reasons.js` style, never free text; dismissable; never blocks logging. Tests under `src/caddie/`.
Bump both version markers.

### 4.2 Keep-screen-on toggle (§10, not built)
Brett declined it in v22.17 (D84). Revisit only if 1.1 lands on "live with gaps" and the gaps turn
out to matter on a real walk.

### 4.3 Three-putt table, 41-ft step
The profile's putting table shows 70% three-putts from 41+ ft on 10 putts, which drives lay-up
pricing. Tangent's longer history may fill the band; otherwise cap or shrink the bucket. Needs data
before code.

## 5. Carried over from earlier handoffs (unchanged)

Listed in `docs/HANDOFF-NEXT.md` "Open follow-ups"; not repeated here: Ironwood OSM tracing (prompt
handed to Brett Sep 29), Broadie baseline live check, Overpass/Open-Meteo field names, MapTiler
caching terms, iOS PWA geolocation first-run, safe-area insets, pencil-filter performance, D31 target
clamp, wedge lofts and finesse carries, Woodmont trace is unsurveyed (D73).

---

## Suggested order

1. Brett: §2 phone check after the next round; §1.2 whenever GHIN is open.
2. Thread: §3 rounds as recordings arrive — each is a 15-minute data commit.
3. Thread: §4.1 aim warning.
4. Brett: §1.1; then §4.2 if needed.

## Paste-ready opener for the next code thread

> Open on the `brettryantalley-source/Loop-Golf` repo, branch `claude/bold-pascal-2s136s` (restart it
> from `origin/main` if it has drifted). Run `git status`, `git log --oneline -3`, `npm install && npm
> test` (325 pass). Read `CLAUDE.md`, `docs/HANDOFF-NEXT.md`, then `docs/OPEN-ITEMS.md` and tell me
> which numbered item you are starting. Hard rules: never touch `computeGhost` / `evalMatch`; never
> rename `bogeyman-matches:*` keys; `index.html`, `src/profile.json`, `src/shotpattern.json` are
> generated; show a diff and wait for my "go" before commit/push; merge only on my "merge". Delete an
> item from `docs/OPEN-ITEMS.md` in the same commit that closes it.
