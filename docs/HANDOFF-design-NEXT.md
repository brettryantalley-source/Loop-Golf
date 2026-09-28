# Loop — design brief for a new feature

Paste this whole file into a fresh UI/UX thread. It carries everything that thread needs about
the product, the brand and the constraints, so it can design without reading the codebase.

**Fill this in before you paste:**

> ## The feature
> _What it is, in a sentence or two. What problem it solves for the golfer. When in a round (or
> outside a round) it gets used. Anything you already know you want._

Everything below is settled and should be treated as the ground truth.

---

## 1. What Loop is

A phone app for one golfer. Brett plays an 18-hole match against a **ghost** — a projected
opponent whose per-hole scores are fixed before the round from his last-five handicap
differential. He is outdoors, in sunlight, one-handed, often with no signal, walking between
shots. The app is installed to the home screen as a PWA; it is not a website anyone browses.

Match rules, frozen: six 3-hole segments worth 1 point each (½ each on a tie), front nine ½,
back nine ½, total 1 — eight points. Lower score wins each.

## 2. Where the app is today (v21.2, live)

| Screen | State |
|---|---|
| **Setup** | Redesigned. Logo, course, tee markers, rating/slope/yards, read-only handicap differential, last-five chart, record as tally marks, Start round. |
| **Mid-round** | Redesigned. Match header, current 3-hole segment card, the hole, five-number score chooser, hole nav, Out/In strips, footer. |
| **Result** | Redesigned. Pencil headline, match line, six segments, the full finished card, record, New round. |
| **Course picker** | Redesigned. Full-screen paper overlay: search, state filter, results. |
| **History** | **NOT redesigned.** Still on the old dark palette. Round list, cloud sign-in, export/import. |

Reference renders of Setup and mid-round live in `loop-design/U-Setup.png` and
`loop-design/U-Round.png`, with the exact HTML beside them. Open those first — they are the
house style in one glance.

Parked and deliberately out of the UI: a Caddie (club recommendations), a satellite Hole View,
and GPS. The code is still on disk. Do not design around them; if the new feature wants GPS,
say so explicitly and expect a conversation.

---

## 3. The brand

**Look:** a classic paper golf scorecard. One printed ink on linen card stock, thin ruled
lines, small-caps labels — and the golfer's own numbers written in pencil on top. No gradients,
no drop shadows, no rounded cards, no slogans or taglines anywhere.

The central idea is the split between **printed** and **written**. Anything the course or the
app supplies is printed in ink. Anything the golfer did is in pencil. Hold that line; it is what
makes the app feel like a scorecard rather than a skin.

### Colour

| Role | Hex |
|---|---|
| Paper (background) | `#F4F0E4` |
| Ink — rules, labels, printed numbers, primary button | `#1E6B3A` |
| Ink pressed | `#154D2A` |
| Hairline — inner grid lines | `#A9C7B4` |
| Muted ink — inactive, secondary | `#7FA58C` |
| Yellow — current hole, flag, button inner line, chart dot | `#F2C94C` |
| Black — headline numerals, par score | `#1F1F1F` |
| Pencil — the golfer's writing | `#3F3F3F` |
| Ghost's pencil | `#8C8C8C` |
| Bogey text | `#B8901E` |
| Double-bogey text | `#A3352B` |
| Won-hole fill | `#DCEBDC` |
| Lost-hole fill | `#F1DAD6` |
| Halved-hole fill | `#E6E4DF` |
| Pending-score shade | `rgba(63,63,63,0.26)`, blurred |
| Tee markers | `#4A4A4A` · `#7C9DA6` · paper with an ink ring · `#D9A441` |

There is no dark mode and there should not be one. It is paper.

### Type

Five faces, each with one job. All bundled as woff2 — nothing is fetched at runtime.

| Use | Font | Notes |
|---|---|---|
| Printed labels and words | **Bitter** 400/500/700 | Small caps = uppercase + `letter-spacing: 0.16em` |
| Printed numbers — par, rating, hole numbers, the big hole numeral | **Old Standard TT** 400/700 | |
| Handwritten words | **Reenie Beanie** | ~15–38px depending on weight of the moment |
| Handwritten numbers | **Architects Daughter** | ~13–34px; grids use 15–21 |
| Logo | **Pinyon Script**, converted to outline paths | Do not reintroduce the font |

Sizes in practice: section labels 10–11px small caps · body 11px Bitter · printed numerals
11–13px, the big hole numeral 72px · written numbers 15–24px in cells and boxes, 34–44px when
they are the headline · written words 15–17px inline, 26–38px for a result headline.

### The pencil treatment

Everything "written" carries an SVG grain-and-wobble filter (`#pencil`) so it reads as graphite
rather than vector. A chosen-but-uncommitted score sits on a soft blurred graphite disc
(`#soft`). Both are defined once in `loop-design/pencil-filter.svg` and mounted at the app root.
Assume it exists; design with it, don't redesign it.

### Shape language

Scores carry the marks a golfer actually draws: **two rings** for an eagle, **one ring** for a
birdie, **nothing** for par, **one box** for a bogey, **two boxes** for double or worse. Strokes
are 1.1–1.4px, tilted ±1.5–8°, with a small pen-lift gap in the dash pattern. Colour follows the
score, not the shape. This vocabulary appears in the score chooser and again on the finished
card, and any new surface showing a score should use it.

### Components that already exist

Double-rule frame · 1px ink section rules with content centred between them · 30px floating
hairline dividers · tee markers (colour dot, name, yardage; selected gets a pencil ellipse) ·
the ruled 9-column strip (hole / you / ghost, segment boundaries in ink, others hairline,
result as a cell fill) · pencil polyline chart with a dotted baseline · five-bar tally marks ·
the primary button (solid ink pill, 2px ink border, 1.5px yellow line just inside, cream text,
yellow flag) · the bottom sheet (paper, 4px double top rule, ink pill + outlined pill).

Reuse these before inventing. If the feature needs something genuinely new, say what it is and
why nothing existing fits.

---

## 4. Hard constraints

- **Portrait only, one-handed.** Reachable with a thumb. The golfer is standing on grass.
- **375×812 is the design target.** It must also survive 393×852 and 375×667, and real safe-area
  insets on a notched phone.
- **Offline-first.** No webfonts, no runtime network dependency. Anything that fetches has to
  degrade honestly with no signal and say so plainly.
- **Sunlight.** High contrast, generous touch targets. Colour alone never carries meaning —
  pair it with a shape, a label or a position.
- **No slogans, taglines, marketing copy, or exclamation points.** Labels are nouns.
- **The match rules and the scoring engine are frozen.** A feature may read them; it may not
  change how points are scored or how the ghost is built.
- Scores are stored as absolute stroke counts. Anything new that touches scoring keeps that.

## 5. What to hand back

Enough that a build thread can execute without guessing:

1. **What changes structurally** — new screens, or changes to existing ones, named.
2. **Where it lives** — how the golfer reaches it, and what it displaces.
3. **A pixel reference at 375×812** — standalone HTML is ideal (match how
   `loop-design/U-Setup.html` is written: inline styles, real values, no framework). A PNG plus
   a spec works too.
4. **Every state**, not just the happy one: empty, loading, offline, error, first-run.
5. **Real copy.** Not lorem, not placeholders — the actual words, in the app's register.
6. **Behaviour decisions**, listed separately from the visuals: what taps do, what persists, what
   happens on interruption. The last round of this produced a `loop-behavior-decisions.md`
   alongside the spec, and that file did more work than the renders.

## 6. Things worth flagging back to Brett

If the feature implies any of these, name it rather than designing around it:
GPS or location · a network call during a round · a change to how the differential is computed ·
anything that would make History (still dark) visible next to a paper screen · storing something
that has to survive a cache wipe.
