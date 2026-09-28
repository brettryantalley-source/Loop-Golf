# Loop — start-here for the next code thread

**Folder to connect: `~/Developer/Loop-Golf`**

## First three commands
```bash
git status          # must be clean
git log --oneline -5
npm install && npm test    # 43 tests, must be green
```

## Where things stand

Live at https://brettryantalley-source.github.io/Loop-Golf/ — **`main` is v21.4** (the `history-paper` work is merged). Next user-facing ship is **v22**.

## Caddie S0 audit — done Sep 28
- The v18 caddie is NOT in `app.jsx`; it is parked in `src/caddie.js` + `src/profile.json` (v1). S1 **replaces** both.
- `src/geometry.js`, `src/holeMap.jsx`, `vendor/`, the tile cache: **keep**. `parseOverpass` must be extended for rough, trees and the course boundary (lie inference, OB).
- `bogeyman-matches:caddie-flags:v1` (tight/water) retires once polygons price trouble.
- `npm test` names its test files explicitly — add new engine tests to the script.

**Decisions (Brett, Sep 28) — these override spec §5.8 and §8:**
1. Storage keys stay in the `bogeyman-matches:*` namespace (`bogeyman-matches:shots:v1`, `:lieOverrides:v1`, `:nineMap:v1:{courseId}`, `:config:v1`). No `loop.*` keys.
2. The profile stays **bundled** at `src/profile.json`, built from `data/`. No runtime fetch.
3. Driver big miss is **right** more than left: 15.2% R / 12.0% L (Last 10 report). Appendix A's left-heavy figure is superseded.
4. Seed source is the Last 10 batch in `data/` (see `data/README.md`), not Appendix A.

**Still blocking S1:** a published strokes-gained baseline table (cite it in code).

## Open questions

1. **Fonts on the phone.** Brett saw the wrong fonts in the live app. v21.4 fixes one confirmed cause. Unverified on device. Ask which he saw: everything serif/system (total `@font-face` failure), or only the handwriting gone formal and loopy (iOS substituting Snell Roundhand for `cursive`, so only Reenie Beanie and Architects Daughter failed).
2. **Never tested on a phone:** the pencil SVG filter's performance (~40 filtered numbers on the mid-round screen), long-press against Safari's press-and-hold, real safe-area insets.

## The app

A PWA. Brett plays 18 holes against a **ghost** — fixed per-hole scores projected from his last-five differential. Screens: Setup → mid-round → result, plus History and a course picker. All paper scorecard.

- `src/app.jsx` (1,676 lines) — everything. The entry point.
- `src/theme.jsx` — the only source of colour and type.
- `loop-design/` — the design source: SPEC, the two approved reference screens, the pencil filter.
- `CLAUDE.md` — standing rules. Read it first.
- `docs/DEVLOG.md` — version history.
- `docs/HANDOFF-design-NEXT.md` — the brief for a UI/UX thread, with the full brand.

## Non-negotiable

- `computeGhost` and `evalMatch` are frozen. Verify byte-identical before every commit.
- Never rename the `bogeyman-matches:*` localStorage keys or the Firebase project `ghost-match-cd04d`.
- `.nojekyll` stays — Pages fails without it.
- Every user-facing deploy bumps `BUILD` in `src/app.jsx` AND `CACHE` in `sw.js`, together.
- `./build.sh` after every `src/` edit. `index.html` is generated; never hand-edit it.
- Show a diff and wait for Brett's explicit go before committing or pushing.
- Offline-first. Nothing fetched at runtime that the app needs to render.

## Parked on disk, not in the UI
The Caddie, Hole View, GPS, Overpass geometry: `src/caddie.js`, `src/geometry.js`, `src/holeMap.jsx`, `src/profile.json`, `vendor/`. Their tests still run. Nothing imports them.

---

## The feature

_Describe it here._
