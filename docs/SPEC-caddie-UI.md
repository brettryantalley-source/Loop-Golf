# Loop — Caddie Screen · UI Addendum v1 · Claude Code Spec

**Date:** 2026-09-27
**Status:** Locked for S3. Build from this plus the engine spec.
**Amends:** `Loop-Caddie-Engine-ShotLog-Spec.md`. **Replaces §7 entirely.** Amends §3.2, §3.5, §5.1, §6.3, §6.6, §6.7, §8, §9, §10, §11. Where the two disagree, **this doc wins.**
**Pixel reference:** `loop-design/U-Caddie.html` (375×812, interactive). Open it first. Its drawn map, Google Fonts, static Avg/Birdie numbers, and tap-to-cycle chips are reference-only.
**Brand tokens:** `src/theme.jsx` — `T`, `F`, `caps`, `printed`, `written`, `writtenWord`, `rule`, `hairline`, `PencilDefs`. **Do not use `C` in `app.jsx`**; that is the legacy dark palette History still uses.

---

## 0. Read first (Claude Code)

1. Read this doc, the engine spec, `CLAUDE.md`, the current Build Log, `loop-design/SPEC.md`, `U-Setup.html`, `U-Round.html`, and `U-Caddie.html`.
2. `computeGhost` and `evalMatch` stay frozen.
3. Bump build tag + `sw.js` cache version together on every deploy.
4. **Verify in-session before building, do not assume:** the MapLibre GL JS APIs you use (bearing, fit, project); MapTiler satellite terms for **tile caching/offline use** and **required attribution text**; whether OSM `golf=hole` ways run tee → green.
5. `app.jsx` ~line 1548 currently resumes a `screen: "caddie"` round onto the scorecard. Change it so an in-progress caddie round resumes on the caddie screen (§9.8).

---

## 1. What changes

| Area | Change |
|---|---|
| **New screen `caddie`** | Full-bleed satellite map of the hole, right-edge rail, bottom bar. The default play screen once S3 ships. |
| **Scorecard (`play`)** | Layout unchanged. Adds a `Caddie` control centered in the hole-nav row (§2). Still where scores are entered. |
| **Setup** | Adds one status line under Round history for course-map prefetch (§11.2). |
| **Engine spec §7** | Replaced. "Map optional" is gone; the map is the screen. |
| **Profile** | Adds `ell80` (Shot Pattern 80% ellipse) per club × swingType × lie (§5). |
| **`pinPos`** | Adds a custom point set by tapping the green (§6). |
| **Chips** | Six: Lie, Quality, Wind, Elevation, Pin, Conditions (§7). |

---

## 2. Where it lives

- **Start round** → caddie, hole 1, pre-tee state (§8).
- **`‹ Card`** tag (top-left of map) → scorecard on the caddie's current hole. Caddie state is kept.
- **Scorecard → caddie:** a `Caddie` control centered between `← HOLE` and `HOLE →` in the existing hole-nav row. Flag glyph (the primary button's flag, 12×15, ink) + `caps(11, 700)` label "Caddie". Tap → caddie.
- **Caddie hole rule:** caddie hole = the lowest-numbered hole with no score. Entering hole 7's score moves the caddie to hole 8, pre-tee. Editing an earlier hole's score does not move it.
- **Hole completion:** when the lie is `green`, the primary button reads **Score hole 7** → opens the scorecard on hole 7 with the score chooser.
- **Ghost and match state never appear on the caddie screen.** (Engine rule 4; UI test T41.)

---

## 3. Layout (375×812)

### 3.1 Regions (bottom → top)

| Region | Frame | Notes |
|---|---|---|
| Map | full bleed, 0,0 → 375×812 | Under status bar, rail, bar |
| Shot overlay | same frame | `pointer-events: none` |
| `‹ Card` tag | left 14, top `safe-top + 9`, h 32, pad 0 11 | Paper, 1px ink border, square corners, Bitter 12 ink |
| Notice tag | left 14, right 120, top `safe-top + 49` | Error/fallback states only (§8). Paper, 1px ink border, Bitter 12 ink, max 2 lines, pad 7 11 |
| Rail | right 0, top 0, bottom = bar height; width 106 collapsed / 356 expanded | Paper, 4px double ink left rule |
| Bottom bar | left 0, right 0, bottom 0; height `78 + safe-bottom` | Paper, 4px double ink top rule, pad 12 18 `safe-bottom + 10` |
| Attribution | bottom-left of map region, 6px above the bar | 9px paper text on `rgba(0,0,0,.4)`; wording per MapTiler/OSM terms (verify) |

**Visible map region (for camera fit):** x 0 → 269, y `safe-top + 49` → bar top − 16.

### 3.2 Rail — collapsed (106 wide, content column 102, pad-x 7, centered)

Top padding `safe-top + 7`. Top to bottom:

| Element | Spec |
|---|---|
| `HOLE` | `caps(9)` ink |
| Hole numeral | `printed(42)` `T.black`, margin-top 6 |
| `par 5 · shot 2` | Bitter 11 ink; numbers `printed(12)` |
| Hairline | 88 wide, 1px `T.hair`, margin 14 0 |
| Toggle | Vertical, two pills 88×44, gap 8, radius 22, 2px ink border. Labels `Safe` / `Aggressive`, Bitter 700 10px, uppercase, tracking .08em. **On** = ink fill + `inset 0 0 0 1.5px T.yellow` + paper text. **Off** = transparent, ink text. |
| Same-shot replacement | `Same shot` / `both ways`, two lines, Bitter 700 10px uppercase .1em, between 1px ink rules top and bottom, pad 10 0. Not tappable. |
| Hairline | as above |
| `CLUB` | `caps(9)` |
| Club | `printed(23)` `T.black`, margin 6 0 14. If `swingType = finesse`, add a line below: Bitter 11 ink `finesse`. |
| `TO TARGET` | `caps(9)` |
| Yards | `printed(26)` ink |
| Aim (short) | Bitter 500 12.5px ink, line-height 1.25 (§10.2) |
| `‹ Details` / `Close ›` | Pinned to rail bottom. Full rail width × 48, 1px ink top rule, Bitter 700 10px uppercase .14em. |

### 3.3 Rail — expanded (356 wide)

Width animates 106 → 356, 280ms `cubic-bezier(.2,.8,.2,1)`. A 250-wide details column appears **left** of the unchanged 102 column, with a 1px `T.hair` right border, pad `safe-top + 7` 12 0 14. Details fade in over 180ms. The map does not move. Order:

1. **Distances strip**, 2×2: `Front` · `Pin` · `Back` · `Plays`. `caps(9)` labels over `printed(20)` ink; hairline dividers; 1px ink rule under; row gap 10. Plays = plays-like to the pin.
2. **Chips**, 2 columns × 3 rows, margin-top 10. Ruled grid: 1px ink outer border, 1px `T.hair` gaps, cells 50 tall, pad 7 9 6. Key `caps(9)` top-left; value at bottom; caret top-right (5×5, 1.3px `T.muted` borders rotated 45°). Values: §7.2.
3. **Options table**, margin-top 10, 1px ink top rule. Header row 22 tall: `Avg` · `Birdie` · `Trouble`, Bitter 700 8px uppercase .08em, right-aligned. Rows 44 tall, 1px ink bottom rule: label cell (`Safe` / `Aggressive` / `Both`, Bitter 700 9px uppercase .06em, club name Bitter 12 under it) + three numbers `printed(16)` right-aligned. Aggressive avg shows its delta after it, `printed(11)`, e.g. `5.1 +0.3`; if |delta| < 0.05 show `≈ same`. **Selected row: label cell `T.yellow` fill.** Row tap = toggle.
4. **Dispersion line** (§5.6), margin-top 9, hairline above.
5. **Reasons**, one line per option, Bitter 11 ink, line-height 1.45. Generated from profile fields (engine §3.10). No free text.
6. **Nudge** (only if the engine returns one): hairline above, `caps(9)` `Today` + Bitter 12 `T.black`.

### 3.4 Bottom bar

Primary pill (flex 1.45) + outlined pill (flex 1), gap 10, both 52 tall, radius 26, Bitter 700 12px uppercase .18em.
- **Primary** = existing primary button: ink fill, 2px ink border, `inset 0 0 0 1.5px T.yellow`, paper text, yellow flag glyph. Pressed `T.inkDark`.
- **Outlined** = 2px ink border, transparent, ink text.
- Labels by state in §8. **`Log shot` is hidden until S4 ships**; the primary spans the full width until then.

### 3.5 Other viewports

- **393×852:** same rail and bar widths; map region gets wider.
- **375×667** (safe-top 20, safe-bottom 0): rail column fits unchanged. In details, the distances strip becomes one row of four and reasons clamp to one line each with ellipsis. **No scrolling anywhere at any of the three sizes.**
- Use real `env(safe-area-inset-*)` values; the 47/34 insets in the reference are the 375×812 case.

---

## 4. Map

### 4.1 Base layer (amends engine §6.6)

- MapLibre GL JS + MapTiler satellite + OSM geometry (engine §6.1).
- **Bearing:** tee → green azimuth of the hole's `golf=hole` way, so the hole runs bottom → top. Pitch 0.
- **Camera fit:** once per ball position, and once for the pre-tee view. Bounds = ball + green polygon + **both** options' ellipse bounding boxes + the layup-to-pin line, fit into the visible map region (§3.1) with 16px padding. **Never refit on toggle, chip, or pin changes.**
- **Gestures:** pan, zoom, rotate, pitch all disabled. Single tap on the green (inside the green polygon or within 3 yds of it) moves the pin (§6). Any other map tap: nothing when the rail is collapsed; collapses the rail when expanded.

### 4.2 Overlay (SVG above the map canvas, re-projected on every render)

Colours on satellite are **paper, yellow, and the trouble hatch only**. Ink green disappears on grass; do not use it on the map. Every line sits on a dark halo: same geometry, stroke width +2.4, `rgba(20,28,16,.45)`.

Draw order:

| # | Element | Spec |
|---|---|---|
| 1 | Pin flag | Hole dot r 1.9 `T.black`; pole 17px, 1.5px paper; flag triangle 10×7 `T.yellow`, 0.6px `T.black` edge |
| 2 | Previous shots this hole (**pencil**: Brett did these) | Start → end of each earlier shot on this hole. Paper 1.8px, dash 2.5/6, round caps, opacity .8, `filter: url(#pencil)` |
| 3 | Other option (ghosted) | Dotted line ball → its target: paper 1.8px, dash .5/6.5, round caps, opacity .75; hollow circle r 6, 1.5px paper at its target. Omitted when `sameShot`. |
| 4 | Corridor | Triangle: ball → active ellipse's left and right support points (§5.3). Fill paper @ 12%. Both edges paper 1.3px with halo. |
| 5 | Leave line (layup only) | Target → pin, paper 1.4px, dash 5/6, opacity .92, halo |
| 6 | Dispersion ellipse | Shot Pattern 80% ellipse (§5). Fill paper @ 14%, stroke paper 1.6px |
| 7 | Trouble hatch | Same ellipse filled with the hatch pattern, clipped to water, bunkers, trees, and outside-OB polygons. Hatch: 45° lines `T.fillLost` (#F1DAD6) 1.8px every 5px over `rgba(163,53,43,.28)`. Pattern + colour, so colour never carries the meaning alone. |
| 8 | Target ring | `T.yellow` circle r 8, 2.6px, over a 5.2px `rgba(20,28,16,.5)` halo; centre dot r 2.4 yellow |
| 9 | Ball | Paper disc r 6, 1.6px `T.black` ring, over a r 7.5 `rgba(20,28,16,.35)` disc. Low accuracy adds a dashed paper ring, radius = `accuracyM` (§8). |

**No text on the map.** The `‹ Card` tag, notice tag, and attribution are the only words over the map region. Test T37 enforces this.

**Redraw:** on toggle, chip, or pin change, the overlay redraws and fades opacity .15 → 1 over 220ms. With `prefers-reduced-motion`, no fade and no rail width animation.

### 4.3 Fallback drawn map (no satellite tiles)

When tiles for this hole are neither cached nor fetchable:
- Background `T.paper`. OSM polygons drawn flat: fairway and green fill `T.fillWon`, bunkers `T.fillHalf`, water `T.hair` @ 60%, trees `T.muted` @ 35%, all with 1px ink outlines.
- Overlay colours swap for paper: lines, ellipse stroke, and corridor edges in ink; ellipse fill ink @ 10%; hatch lines `T.double`; target ring and flag stay yellow with `T.black` edges; halos off.
- Notice tag: **No satellite here. Map drawn from course data.**

---

## 5. Dispersion = Shot Pattern's 80% ellipse

### 5.1 Profile field (amends engine §5.1)

Each club × swingType × lie entry gains:

```json
"ell80": {
  "wYds": 16.7, "hYds": 23.7, "tiltDeg": 39.9,
  "dxYds": -0.2, "dyYds": 1.1,
  "bboxWYds": 20, "bboxDYds": 21,
  "source": "shotPattern", "capturedAt": "2026-09-19", "lies": "all", "confidence": "high"
}
```

Frame = Shot Pattern's club plot: +x right, +y **short**. `wYds` is the full axis at `tiltDeg` clockwise from +x; `hYds` is the perpendicular axis. `dx`, `dy` = ellipse centre relative to Shot Pattern's target cross. `bboxW/D` = Shot Pattern's own Width × Depth labels.

### 5.2 Engine (amends engine §3.5)

When `ell80` exists for an entry, it **is** the dispersion core:
- Bivariate normal on the tilted axes, `σ = semi-axis / 1.794` (the 80% contour of a 2-D normal is at √(−2 ln 0.2) σ).
- Mean offset = (`dx`, `dy`); distance miss = −`dy`.
- This replaces `distSdYds`, `lateralSdDeg`, `biasDistYds`, `biasLatYds` for that entry. The big-miss tail still applies on top.
- Bad or buried lie: scale `w`, `h` by `LIE_QUALITY_SPREAD` (1.15) and add 5 to `dy`.
- A lie with no `ell80` of its own uses the all-lies ellipse plus that lie's profile `biasDistYds`.
- After the §5.2 takeover threshold (30 Loop shots for an entry), Loop's own 80% ellipse replaces Shot Pattern's for that entry.

### 5.3 Drawing (reference: `ellScreen()` in `U-Caddie.html`)

- θ = clockwise angle of ball → target from screen-up, after map bearing. `px` = pixels per yard at the target.
- Centre `C = T + Rθ(dx, dy) · px`, where in screen coords (y down) `Rθ(x, y) = (x cosθ − y sinθ, x sinθ + y cosθ)`.
- Rotation `α = tiltDeg + θ`. Semi-axes `A = w/2 · px`, `B = h/2 · px`.
- Corridor edges: support points in directions ±n, `n = (cosθ, sinθ)`:
  `support(n) = C + (A²(n·u)u + B²(n·v)v) / √(A²(n·u)² + B²(n·v)²)`, with `u = (cosα, sinα)`, `v = (−sinα, cosα)`.

### 5.4 Seed values (measured from the Sep 19 Shot Pattern club screens, all lies, 80% coverage)

| Club | SP label W × D | Axes w × h | Tilt | dx, dy | Confidence |
|---|---|---|---|---|---|
| PW | 20 × 21 | 16.7 × 23.7 | 39.9° | −0.2, +1.1 | High |
| 9-iron | 43 × 29 | 25.1 × 45.3 | 113.0° | +4.1, −0.1 | High |
| 2-hybrid | 68 × 112 | 57.1 × 117.9 | 21.1° | −1.0, +0.2 | Low: screen scrolled, top of ellipse estimated; mixes tee (248) and fairway (224) |
| 4-hybrid | 73 × 69 | 60.1 × 80.6 | 129.1° | +2.9, +0.1 | Low: screen scrolled, top estimated |
| Dr, 2i, 5i, 6i, 7i, 8i, GW | screens exist | not yet measured | | | Pending |
| SW, LW, finesse entries | no screens reviewed | | | | Pending |

Method: fit an ellipse to the solid 80% outline, scale by the Width/Depth labels (PW and 9-iron checked isotropic within 1.1%), measure the offset from the target cross.

### 5.5 Refresh (amends engine §5.8)

Claude Code does **not** measure screenshots. After a round, Brett sends each club's Shot Pattern dispersion screen (coverage 80%, full ellipse visible, one screen per lie where Shot Pattern allows that filter) to the Golf project chat. That chat measures and writes `ell80` into `profile.json`. Claude Code commits and loads it as today.

### 5.6 Dispersion line (details panel)

- `DISPERSION` — `caps(9)`
- `2-hybrid 68 × 112 yds` — club and numbers `printed(16)` `T.black`, `yds` Bitter 12 ink. Numbers = the drawn ellipse's bounding box (after any lie-quality scaling), rounded.
- Source, Bitter 10 ink: `Shot Pattern · 80% · Sep 19`; append ` · +15% bad lie` when scaled; after takeover, `Loop · 80% · {n} shots`.

---

## 6. Pin (amends engine §3.2, §6.3)

- `pinPos` ∈ `front | middle | back | { lat, lng }`. Presets keep the engine §6.3 rule (thirds along ball → green).
- **Map tap** on the green (or within 3 yds) sets a custom pin, clamped inside the green polygon. Pin chip shows `Custom` in pencil.
- **Pin chip** opens the picker (§7.3): Front · Middle · Back. Choosing one clears a custom pin.
- **Lifetime:** the pin holds for every shot on that hole. A new hole starts at Middle. Stored per hole in round state.
- Every pin change recomputes both options (< 500ms budget). The layup re-aims to its leave distance **to the pin**; the aggressive target moves with the pin.
- Distances strip shows `Pin` in place of Center; `Plays` is to the pin.

---

## 7. Chips and pickers (amends engine §3.2)

### 7.1 Set

| Chip | Default source | Picker options |
|---|---|---|
| Lie | inferred (§6.2) | Tee · Fairway · Rough · Sand · Recovery |
| Quality | Standard | Good · Standard · Bad · Buried |
| Wind | weather API, relative to shot line | Direction: Into · Helping · From left · From right · Calm. Speed: 0 · 5 · 10 · 15 · 20+ mph |
| Elevation | sampled (§6.5) | −10 · −5 · 0 · +5 · +10 yds |
| Pin | Middle | Front · Middle · Back (or tap the green) |
| Conditions | Normal, or Wet from weather | Firm · Normal · Wet |

### 7.2 Value display (printed vs pencil)

- **Inferred by Loop → printed:** Bitter 14 ink, e.g. `Fairway`, `8 into-left`, `+4 yds`.
- **Changed by Brett → pencil:** `writtenWord(29)` (Reenie Beanie, `T.pencil`, `#pencil` filter), line-height .62.
- **Low-confidence lie:** printed value + ` ?` in `printed(14)` `T.bogey`.

### 7.3 Picker

The existing bottom sheet: paper, 4px double ink top rule, scrim `rgba(31,31,31,.45)`, pad 20 22 `safe-bottom + 20`.
- Title = chip key, `caps(12)`.
- Options as outlined pills, 48 tall, 2 columns, gap 10; the current value uses the primary style.
- When Brett has changed the value, a full-width outlined pill at the bottom: `Use inferred · Fairway`.
- Pin picker adds Bitter 11 ink under the options: `Or tap the green on the map.`
- Tap an option → apply, close, recompute. Tap the scrim → close, no change.
- The reference cycles chips on tap for demo only. **The build opens the picker for every chip.**

---

## 8. States

| State | Trigger | Rail | Map | Bar | Notice |
|---|---|---|---|---|---|
| **Pre-tee** | New hole | Hole, par, `shot 1`; toggle hidden; Club `—`; To target `—`; aim `Tap I'm on the tee` | Hole framed tee → green, pin at Middle, no overlay | **I'm on the tee** | — |
| **Locating** | After the tap, until fix + compute (10s timeout) | Values `—`; aim `Locating` | No ball, no overlay | Primary disabled: **Locating** | — |
| **Ready** | Engine returns two options | As §3.2 | Full overlay | **I'm at my ball** · **Log shot** | — |
| **Same shot** | `sameShot: true` | Toggle → `Same shot / both ways` | One option; no ghost line | As Ready | — |
| **Low accuracy** | `accuracyM > 8` | Lie chip shows `?` | Dashed accuracy ring on ball | As Ready | — |
| **On the green** | `lieType = green` | Toggle, club, yards hidden; aim `On the green` | Pin + ball only | **Score hole 7** | — |
| **No GPS fix** | Timeout or position error | Values `—`; aim `No GPS fix` | Last camera, no ball | **Try again** · **Enter yards** | No GPS fix. Step into the open and tap Try again. |
| **Location off** | Permission denied | Values `—`; aim `Location off` | Last camera, no ball | **Try again** · **Enter yards** | Location is off for Loop. Turn it on in Settings, then tap Try again. |
| **Yards entered** | Brett used Enter yards | Normal; To target in pencil; aim `Club only` | No overlay | **I'm at my ball** · **Log shot** | — |
| **No course map** | Geometry incomplete for this hole (engine §6.1) | Values `—`; aim `No course map` | Paper background | **Enter yards** | No course map for hole 7. Enter yards for a club. |
| **No satellite** | Tiles not cached and not fetchable | Normal | Fallback drawn map (§4.3) | As Ready | No satellite here. Map drawn from course data. |
| **No profile** | `profile.json` not loaded and no cached copy | Values `—`; aim `No profile` | No overlay | **Try again** | Profile didn't load. Reconnect and tap Try again. |

**Enter yards** opens the bottom sheet: title `Yards to pin`, large pencil number (`written(44)`), buttons `−10` `−1` `+1` `+10` as outlined pills, primary `Use 150`. No keyboard. The engine runs club-brain mode (profile only).

**First run:** nothing beyond the engine §6.4 nine-mapping screen. No coach marks.

---

## 9. Behavior decisions

1. **Default option:** SAFE on every new ball position.
2. **Rail:** collapses on every new ball position.
3. **Chip lifetime:** Lie, Quality, Elevation reset on each new ball. Pin holds for the hole. Wind and Conditions hold for the rest of the round; a weather refresh never overwrites a wind Brett set.
4. **Recording:** every chip and pin value in effect at the shot is saved in the shot record's `recommendation` snapshot. Lie corrections also feed engine §5.6 overrides.
5. **Line played default:** the option showing on the toggle when Brett taps `Log shot` or `I'm at my ball`. If the logged club matches only the other option, the club match wins (engine §4.2).
6. **Recompute:** during a recompute, keep the old overlay at 40% opacity. No spinner.
7. **Camera:** moves only on a new ball position or a new hole.
8. **Interruption:** persist caddie state on every change (hole, shotNo, context, toggle, chips, pin, expanded). A reload or relaunch restores the caddie screen exactly. No automatic GPS re-fix on resume.
9. **`‹ Card`:** keeps caddie state. Returning shows the same screen.
10. **Hole advance:** per §2's caddie hole rule.
11. **Ghost:** never rendered on this screen.
12. **`Log shot`:** hidden until S4.

---

## 10. Copy

### 10.1 Fixed strings

| Where | Copy |
|---|---|
| Map tag | `‹ Card` |
| Rail | `Hole` · `par 5 · shot 2` · `Club` · `To target` · `‹ Details` · `Close ›` · `Same shot` / `both ways` · `finesse` |
| Details | `Front` · `Pin` · `Back` · `Plays` · `Lie` · `Quality` · `Wind` · `Elevation` · `Pin` · `Conditions` · `Avg` · `Birdie` · `Trouble` · `Safe` · `Aggressive` · `Both` · `Dispersion` · `Today` |
| Bar | `I'm on the tee` · `I'm at my ball` · `Log shot` · `Score hole 7` · `Try again` · `Enter yards` · `Locating` |
| Rail aim, non-ready | `Tap I'm on the tee` · `Locating` · `On the green` · `No GPS fix` · `Location off` · `Club only` · `No course map` · `No profile` |
| Pickers | chip key as title · `Use inferred · {value}` · `Or tap the green on the map.` · `Yards to pin` · `Use {n}` |
| Setup status | `Course map ready` · `Course map · loading 7 of 18` · `Course map unavailable · caddie will use yards` |

No exclamation points. No slogans. Errors say what happened and what to do.

### 10.2 Aim short form (rail)

Derived from the engine's `target.label`:
- Layup → `Leave {n}`
- Green → `Front-left` · `Front` · `Front-right` · `Left side` · `Center` · `Right side` · `Back-left` · `Back` · `Back-right`
- Fairway (tee shots) → `Left-center` · `Center` · `Right-center`

---

## 11. Storage and network (amends engine §6.7, §8)

### 11.1 Keys

| Key | Contents |
|---|---|
| round state `caddie` | `{ hole, shotNo, context, opt, exp, chips, pins: { [hole]: preset or {lat,lng} }, windOverride, conditionsOverride }` |
| Cache Storage `loop-tiles-{courseId}` | Prefetched satellite tiles |

Nothing added here must survive a cache wipe. Tiles re-fetch; `ell80` lives in `profile.json` in the repo.

### 11.2 Tile prefetch

- Start when a course and tee are chosen on Setup. Cover every hole's fitted bounds at the zoom levels the camera fit will use.
- Setup shows one status line under Round history, Bitter 11 ink (§10.1 copy).
- **Blocking check:** confirm MapTiler's terms allow this caching. If they don't, skip prefetch; mid-round signal loss falls back to the drawn map (§4.3).

---

## 12. Build order and tests (replaces engine §9 row S3)

| Session | Scope | Model | Tests |
|---|---|---|---|
| **S3a — Map layer** | MapLibre + MapTiler, bearing, camera fit, overlay projection, ellipse + corridor math, hatch clip, fallback drawn map, tile prefetch + Setup status line | Opus | T33, T34, T36, T37, T39 |
| **S3b — Rail, bar, states** | Rail collapsed/expanded, toggle, chips + pickers, pin (chip + map tap), all §8 states, navigation (§2), persistence (§9.8) | Sonnet | T35, T38, T40–T42 · **SHIP 1** |

**Acceptance tests** (continue engine §10 numbering; pure functions where possible)

- **T33 Ellipse size:** projected ellipse bounding box at the current zoom equals `bboxW/D` within 1 yd.
- **T34 Coverage:** 10,000 samples from the engine distribution for an `ell80` entry → 80% ± 1% fall inside the drawn ellipse.
- **T35 Pin:** presets land in the front/middle/back thirds; a tap outside the green but within 3 yds clamps inside; the pin holds across shots on the hole and resets on a new hole.
- **T36 Toggle redraw:** SAFE ↔ AGGRESSIVE changes club, target, ellipse, corridor, and rail text; the map camera is unchanged.
- **T37 No map text:** the overlay contains no `<text>` nodes.
- **T38 Same shot:** toggle replaced; one option drawn; no ghost line.
- **T39 Offline tiles:** network blocked, no cache → fallback drawn map + its notice.
- **T40 Fit:** at 375×667, 375×812, and 393×852 the rail, details, and bar render without scrolling or clipping.
- **T41 Ghost isolation (UI):** caddie screen DOM contains no ghost score, match score, or segment state.
- **T42 Resume:** reload mid-hole restores hole, shotNo, toggle, chips, pin, and expanded state.

---

## 13. Flags and open inputs

| Item | Status | Owner |
|---|---|---|
| **GPS required.** Location prompt appears on the first `I'm on the tee`. Verify iOS home-screen PWA permission behavior in-session. | Flag | Claude Code |
| **Network mid-round** for tiles. Mitigated by prefetch (§11.2) and the drawn fallback (§4.3). | Flag | Claude Code |
| MapTiler caching terms and attribution wording | **Blocking for prefetch** | Claude Code |
| MapTiler key in client (same exposure as the golfcourseapi key). Restrict it by domain in the MapTiler dashboard if that option exists. | Non-blocking | Brett |
| Full 2-hybrid and 4-hybrid dispersion screens (ellipse fully visible) | Non-blocking; seed marked low confidence | Brett → Golf project chat |
| Per-lie dispersion screens, if Shot Pattern filters by lie | Non-blocking | Brett → Golf project chat |
| Measure remaining clubs (Dr, 2i, 5i, 6i, 7i, 8i, GW; SW, LW, finesse) | Non-blocking | Golf project chat |
| Satellite screenshot of one Ironwood hole, for a reference render on real imagery | Optional | Brett → build thread |
