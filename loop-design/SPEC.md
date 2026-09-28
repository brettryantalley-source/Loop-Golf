# Loop — design spec (v1, 26 Sep 2026)

Loop (formerly Ghost Match): a phone app where the golfer plays an 18-hole match against a "ghost" projected from their last-5 handicap differential. Portrait, one-handed, outdoors, offline.

The two reference screens in this folder are the source of truth: `U-Setup.html` and `U-Round.html` (open in any browser at 375×812; PNGs included). Copy their exact values. What follows is the system behind them.

## Look

Classic paper golf scorecard. One printed ink on linen card stock, thin ruled lines, small caps labels; the golfer's numbers written in pencil on top. No gradients, no shadows, no rounded cards, no slogans.

## Colors

| Role | Hex |
|---|---|
| Paper (background) | `#F4F0E4` |
| Ink (rules, labels, printed numbers, primary button) | `#1E6B3A` |
| Hairline (inner grid lines) | `#A9C7B4` |
| Muted ink (inactive labels) | `#7FA58C` |
| Yellow accent (current hole cell, flag, button inner line, chart dot) | `#F2C94C` |
| Black (headline numbers, par score) | `#1F1F1F` |
| Pencil (golfer's writing) | `#3F3F3F` |
| Ghost's pencil | `#8C8C8C` |
| Bogey text (yellow that passes contrast) | `#B8901E` |
| Double-bogey text | `#A3352B` |
| Won-hole fill | `#DCEBDC` |
| Lost-hole fill | `#F1DAD6` |
| Halved-hole fill | `#E6E4DF` |
| Tee markers | Black `#4A4A4A` · Blue `#7C9DA6` · White paper + ink ring · Red `#D9A441` |

## Type (bundle the font files; no network at runtime)

| Use | Font | Notes |
|---|---|---|
| Printed labels, words | **Bitter** 400/500/700 | small caps = uppercase + letter-spacing 0.16em |
| Printed numbers (par, rating, hole numbers, big hole) | **Old Standard TT** 400/700 | |
| Handwritten words (pencil) | **Reenie Beanie** | ~26–28px on phone |
| Handwritten numbers (pencil) | **Architects Daughter** | ~17px in grids, ~24px in boxes |
| Logo | **Pinyon Script** "Loop" + thin flourish underline + one yellow dot | see `logo.svg` |

## Pencil treatment

Anything "written" (pencil color) gets a light grain + tiny wobble so it reads as graphite, not vector. Reference implementation is the SVG filter `#pencil` in both HTML files (feTurbulence grain masked into the glyphs, ~0.8px displacement). In native code: a noise-textured mask over the text, or a pre-textured font. Keep it mostly filled; earlier versions were too static-like.

## Setup screen (`U-Setup.html`)

Double-rule frame around the whole screen. Sections separated by 1px ink rules, each section's content vertically centered between its rules, sections spaced evenly top to bottom.

1. Logo (Pinyon "Loop", underline, yellow dot), then a 3px double rule.
2. **Course** — name in pencil, "par 71" small, chevron.
3. **Tee** — four tee markers (color dot, name, yardage). Selected tee gets a pencil ellipse around it.
4. **Rating / Slope / Yards** — three centered cells, short hairline dividers (30px) floating clear of the rules.
5. **HCap Diff** — one line: `8.2 / 79` (last-5 differential / ghost's projected score). No ± control.
6. **Your last five** — pencil polyline of the last 5 differentials, dotted baseline, values under each point, most recent point yellow.
7. **Record vs. the ghost** — Won / Lost / Halved as pencil tally marks; "streak W2 · avg +1.4" right.
8. **Start round** — solid green pill, 2px green border, 1.5px yellow line just inside, cream text, yellow flag icon. Then "Round history · 7".

## Mid-round screen (`U-Round.html`)

Top to bottom, spaced evenly:

1. **Header** — left: course · tee, "segment 3 of 6 · holes 7–9"; right: `YOU 2 · up · GHOST 0` (points, pencil).
2. **Segment card** — grid: Hole (number + par/idx), Ghost (pencil grey), You. Current hole's cell is yellow. A chosen-but-unconfirmed score shows as the shaded number in the You row.
3. **Current hole** — Ghost box (hairline, ghost's score) · big hole number (Old Standard, black) with "par 4 · index 5" · You box (ink border, yellow fill, chosen score).
4. **Score chooser** — exactly five numbers relative to par. Nothing pre-selected.
   - Eagle (par−2): green, two concentric circles
   - Birdie (par−1): green, one circle
   - Par: black, no shape
   - Bogey (par+1): yellow `#B8901E`, one box
   - Double+ (par+2 or worse): red, two boxes
   - Shapes: near-clean ellipse/rect, 1.4px stroke in the number's color, slight tilt (±1.5–8°), tiny pen-lift gap.
   - Tap once: a soft blurred graphite disc (`rgba(63,63,63,0.26)`, blur ~2px, no lines) appears behind the number and the score shows in the You box and the segment card. Tap the same number again to commit and advance.
5. **← Hole 6 / Hole 8 →** — small caps links under the chooser.
6. **Out / In strips** — two 9-column grids (rows: hole, you, gh.). Hole/you/ghost cells filled green/red/grey by result; current hole yellow. Segment boundaries (after 3, 6) are ink lines; others hairline. Above each strip: "S1 won · S2 won · you 25, ghost 29" / "S4 · S5 · S6 open".
7. **Out you · In open · Total you** — footer line.

## Match rules (unchanged from the current app)

18 holes. Ghost's score per hole is fixed before the round. Six 3-hole segments worth 1 point (½ each on a tie), front nine ½, back nine ½, total 1 = 8 points. Per-hole result: won / lost / halved vs the ghost's fixed score.

## Not in scope right now

Caddie features (parked), "which ghost" selector (removed), result screen (not yet designed).
