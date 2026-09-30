# Shot log v2 — intent on the map, results from GPS, review at the score (v22.15)

Status: agreed with Brett Sep 30 2026 (this thread); amends `SPEC-caddie-UI.md` §3.4, §4.2, §6, §8
and `SPEC-caddie.md` §4 (shot log). Decisions taken while building go in `DECISIONS-caddie.md`
(D59+). Read `SPEC-caddie-UI.md` §8 (states) and §9 (behaviour) first; this document only says
what changes.

## 0. Why

The first on-course test (Ironwood, Sep 29) showed the post-shot card is slow when every field is
typed by hand, and that putting and end-of-hole logging had no path without a map. Brett's ask:
put the *intent* on the map before the shot (target, start line, shape), let GPS read the *result*
after it, and let him do the logging either shot by shot or all at once when he writes the score.
Plus a test mode so all of this can be exercised off the course.

Everything here works with a mapped hole (OSM geometry), a marked green (v22.11 synthetic hole) or
a GPS-only hole (marked by standing on the green, v22.12). Yards-only (no GPS) keeps today's manual
card.

## 1. Test mode — fake GPS by tap (build this FIRST; everything else is tested through it)

- Entry: long-press the build tag on Setup (`vN · date`, top right) for ~700 ms → a `Test mode`
  sheet with one toggle, `Fake my location`. Persisted in `bogeyman-matches:config:v1` under
  `testMode: { fakeGps: true }` so it survives reloads; never on by default; never shipped on in
  a build. A `TEST` pencil tag sits beside the build tag while it is on, and the caddie's map gets a
  thin dashed `T.pencil` border so a live round can never be mistaken for a fake one.
- Behaviour: the caddie's `locate()` (src/app.jsx, the `navigator.geolocation.getCurrentPosition`
  call) is replaced by a **tap on the map**. Any action that would ask for a fix (`I'm on the tee`,
  `I'm at my ball`, `Try again`, `Mark green here`, `On the green`) instead shows the notice
  `Test mode · tap the map where you are`, and the next map tap becomes the fix (accuracy 4 m).
  While waiting, the bar's primary reads `Tap the map…` (disabled). A second tap before any action
  moves the pending position (nothing is committed until the action's flow runs).
- The fake fix flows through exactly the same code path as a real one (`dispatch({type:"fix"…})`,
  close-out of the open shot, hole detection on mapped courses, lie inference), so the test covers
  the real logic. No separate fixtures in the app.
- Pre-tee on a mapped hole the map already frames the hole; on an unmapped hole with no fix yet it
  frames the course centre north-up at ~400 yds so there is something to tap.
- Weather / elevation still fetch normally (they fail gracefully offline already).
- Injection point: one function `getFix(cb, err)` in `CaddieScreen` that either calls geolocation
  or arms the tap; `caddieState` gains `awaitingTap: null | { action, trigger }`. Pure reducer,
  tests for arm → tap → fix.

## 2. Pre-shot intent on the map (§4.2, §6 amendment)

Three optional marks, all one gesture, all defaulted so an untouched shot still has an intent:

| Mark | Gesture | Default | Stored |
|---|---|---|---|
| **Target** | hold-and-drag the target marker (same mechanics as the pin drag, D49); the dispersion ellipse follows it | the recommended option's target (`opt.target`) | `intent.target = {x, y}` hole frame + `label` |
| **Start line** | tap `Line` on the rail, then tap anywhere on the map: a pencil ray from the ball through the tap to the edge of the map; tap again to move it, tap the ball to clear | through the target | `intent.startLineDeg` (bearing from ball, hole frame) |
| **Shape** | three pills on the rail under the aim: `Draw · Straight · Fade` | Brett's usual shape for the club (`defaultIntendedShape`) | `intent.shape` |

- The target marker is a small pencil ring with a dot (not the flag: the flag is the pin). Moving
  the target does NOT change the recommendation; it records where Brett is aiming. `learning.js`'s
  aggression scorecard reads `intent.target` vs the engine target (D-note: this replaces the
  `linePlayed` pill on the card, which is now derived: `safe` if the target is within 5 yds of the
  SAFE option's target, `aggressive` within 5 yds of AGGRESSIVE's, else `own`).
- Intent is per shot (`shotNo` on the hole) and persists in `bogeyman-matches:v1.caddie.intent[hole][shotNo]`
  until the shot record is written; the record then carries it.
- Sameshot / club-brain (yards) states: shape pills only; no map marks.

## 3. Auto-close and derived results (§9 amendment; replaces the manual-only card)

- **A shot closes when the next fix arrives** (`I'm at my ball`, `On the green`, `I'm on the tee`
  of the next hole, or a fake tap), exactly as `closeOutShot` does today, with two additions:
  1. **Auto-create**: if no record exists for the shot being closed (Brett never opened the card),
     one is created with the intent (default or set), club = recommendation's club (else null),
     `logged: "auto"`, `reviewed: false`. The hole's `?` count in the rail goes up by one.
  2. **Derived result** (`derived`, all in yards in the shot's hole frame, from `start`, `intent.target`,
     `intent.startLineDeg`, `end`):
     - `distMissYds` = along-line distance of end past the target (+ long, − short).
     - `latMissYds` = perpendicular offset of end from the ball→target line (+ right, − left, as seen
       from the ball).
     - `curveAuto` from `latMissYds` and `intent.shape` with bands **8 / 20 yds** (`config.MISS_BANDS`):
       |lat| < 8 → 0; 8–20 → ±1; > 20 → ±2; sign: right of target = fade side (+), left = draw side (−).
       With shape `draw`, a −1 reads "over-drew" and +1 "held / under-drew"; the card labels use
       `CURVE_OPTS` unchanged, the read-back adds the word in parentheses.
     - `distClass` from `distMissYds` with the same bands: short / on / long, ±1 / ±2. Stored, shown
       on the review row; NOT written into `contact` (contact stays the fat/thin face read).
     - `curve` is pre-filled from `curveAuto` when the record is auto-created or opened before Brett
       touched the slider; a hand-set curve is never overwritten (`curveSource: "auto" | "hand"`).
  - GPS accuracy: if either fix's `accuracyM` > 12 m the derived fields are still computed but
    `derivedLowAcc: true`, and the card shows the `?` mark on Curve.
- **Manual card** (`Log shot`) stays available at any time and opens pre-filled with the derived
  values; Save sets `reviewed: true`, `logged: "full"`.
- **Auto-advance**: after `Save` or `Good shot ✓` on the card the caddie returns to the state it
  was in (Ready with the new ball) — no extra tap. The previous-shot blocking prompt (§4.4 step 2)
  is REMOVED: with auto-close there is always a record, so nothing goes unlogged.

## 4. The Review sheet at the score (new, §8 state `review`)

- Opens when the hole's score is written (chooser confirm, from the card or `Score hole N` in the
  caddie), before the app moves to the next hole, when the hole has any `reviewed: false` record, any
  stroke with no record, or a putt count that does not match. Otherwise scoring proceeds as today.
  A `Review` text button on the finished-hole row of the card reopens it later.
- Header: `Hole 7 · 5 strokes` (the written score) · `3 shots · 2 putts`. If the putt log has no
  entries for the hole, a one-row stepper `Putts: 2` (default = score − shots with records, min 0)
  sets it and creates `putt` records with `distanceFt: null`.
- Body: one row per stroke, 1..(score − putts) then the putts. A row shows: `#`, club (or `—`),
  position state (`GPS` / `placed` / `—`), intent state (`set` / `default` / `—`), result
  (`+2 long · 12 R` or `—`), and a `?` while unreviewed. Complete rows are one line; tapping any row
  expands it in place to: a mini map (the hole, all placed shots, this shot's ball/target/line) and
  the v22.13 sliders pre-filled.
  - **Position missing or wrong** → `Place` then tap the mini map: sets `start.gps` (+ frame) for
    that shot; the previous shot's `end` and derived result recompute; so does this one's.
  - **Intent missing** → target drag / line tap / shape pills on the mini map, as §2.
  - `Delete stroke` / `Add stroke` keep the count in step with the score; if they disagree at Save
    the sheet says so and Save adjusts nothing on the scorecard (the score is the truth; the sheet
    is the story).
- `Save all` writes every record `reviewed: true` and moves to the next hole. `Later` moves on
  leaving `?` marks (the rail's hole number shows a small `?` until reviewed).
- Pure model in `src/caddie/review.js`: `holeReview(shots, putts, score, hole)` → rows + problems;
  `placeShot`, `recomputeChain`. No DOM. Tests: chain recompute after a placement, putt inference,
  count mismatch, a fully manual hole (no fixes at all) placed from scratch.

## 5. Shots list (mid-hole back door)

- `Shots` text button in the rail (expanded) lists this hole's strokes as in §4 rows; tapping one
  opens the same expanded row (intent, position, sliders). This is how Brett sets shot 2's intent
  after the fact or fixes a wrong ball position without waiting for the score.

## 6. Manual `On the green` (no map)

- On any state after the tee where the app cannot detect the green (no geometry and no marked green
  in reach, or GPS-only), the bar's secondary becomes `On the green` once `shotNo ≥ 2` (and always on
  a par 3 after the tee shot). Tapping it: takes a fix (closes the open shot as §3), sets the view to
  `green` (putt card: `Made ✓` / `Log putt`, `Score hole N` primary) exactly as the detected case.
- `Log putt` keeps the v22.13 sliders; `Made ✓` writes distance only; putt count feeds §4.

## 7. Storage

Shot record additions (`bogeyman-matches:shots:v1`, additive, old records read fine):
```
intent:   { target: {x,y}|null, targetLabel, startLineDeg|null, shape, source: "default"|"set" }
derived:  { …existing, distMissYds, latMissYds, curveAuto, distClass, derivedLowAcc }
curveSource: "auto"|"hand"|null
logged:   "quick"|"full"|"auto"
reviewed: boolean
placed:   boolean          // start position set by hand in Review / Shots
```
Caddie round state (`bogeyman-matches:v1.caddie`): `intent[hole][shotNo]`, `awaitingTap`, `review` (open sheet).
Config (`bogeyman-matches:config:v1`, DEFAULT_CONFIG): `MISS_BANDS: { slightYds: 8, bigYds: 20 }`,
`LOW_ACC_M: 12`, `testMode: { fakeGps: false }`.

## 8. Bar and rail summary (amends §3.4 / §8)

| state | primary | secondary | rail extras |
|---|---|---|---|
| pretee (mapped / marked) | I'm on the tee | Log shot | Shots · Line · shape pills |
| ready | I'm at my ball | Log shot | Shots · Line · shape pills · Enter yards |
| ready, no green detectable | I'm at my ball | On the green | as above |
| green | Score hole N | Log putt | Shots |
| test mode, awaiting tap | Tap the map… (disabled) | — | — |
| review (sheet) | Save all | Later | — |

## 9. Tests (add to `npm test`; Playwright through test mode)

- T44 fake GPS: arm → tap → fix goes through `closeOutShot` and hole detection.
- T45 intent defaults: untouched shot has target = recommendation, line through target, shape = usual.
- T46 derived: end 15 yds right of target with `draw` → `curveAuto +1`, `distClass 0`; 25 yds left → −2;
  accuracy 20 m → `derivedLowAcc`.
- T47 auto-close creates an `auto` record with `reviewed: false`; hand-set curve survives a re-derive.
- T48 review: 5 strokes, 2 putt records, 2 shot records → one missing row; placing it recomputes both
  neighbours; `Save all` marks reviewed; count mismatch reported.
- T49 On the green with no map → green state → putt card → score.
- Playwright: a whole par 4 played by taps in test mode on the Hampton fixture (tee → fairway → green
  → 2 putts → score), with one shot skipped and placed in Review; the record set inspected at the end.
