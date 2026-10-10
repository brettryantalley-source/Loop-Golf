# C4: heads-up + aim warning

OK'd by Brett Oct 10, with the recommended choices. Item: `docs/OPEN-ITEMS.md` C4.

## What already shows
- **The why line** (v22.18, D91), above the action button: the main reason, plus a "today" clause
  when 2–3 shots of one club family agree. Example: "7-iron to the middle: back pin · clubbed up:
  short irons short on 3 and 5 today."
- **The aim** (v22.22, D93): the map already aims off for his pattern and the wind.
- **Your own target** (v22.26, D97): drag the marker and the line shows that shot's par chance live.
- **Misses by club** (v22.35, D106) on History.

## 1. Heads-up: one clause on the why line, for SAFE's club only
Shows the first of these that holds, and nothing otherwise:

| # | When | Line |
|---|---|---|
| a | **Today:** this club missed the same way, beyond its pattern, on 3 of its last 4 shots (or 2 of 2) | "Driver: 3 of 4 left today, aiming right-center" |
| b | **History:** at least 10 measured shots with this club, and at least 3 in 10 of them finish 10%+ short (or long) | "GW: finishes short 3 in 10 — the call allows for it" |

- (a) uses the club's own shots. Today's family clause stays as it is. If both would fire, the one
  with more shots shows. Directions are read against the start line (`patternLatYds`), so a shot
  that follows his pattern is not counted as a miss.
- (b) only explains what the price already includes (the short tail, D107). It never moves the aim.
- **It never contradicts SAFE.** "Aiming right-center" only shows when the map actually aims right.
- Assumed ends never count (D87). Shot Pattern imports count toward (a) and (b) by direction only.

## 2. Aim warning: when he moves the target or draws his own Line
One extra clause after his par chance, when either of these holds:

| When | Line |
|---|---|
| His shot finds trouble at least **10 points** more often than SAFE | "6-iron: 41% chance at par · water 1 in 4 (Loop's call: 1 in 12)" |
| His club's measured average miss (at least 10 shots) moves the ring's centre off the green | "8-iron: 48% chance at par · you finish 7 R on average: that's off the green" |

- Tap the line to hide it for this shot. It never blocks logging.
- Pricing reuses `priceTarget` (D97), which already re-runs the simulation at his target and Line.

## Tests
- Replay the Oct 3 Chicopee round (`data/extracted/rounds/2026-10-03-chicopee-woods`) and check
  each heads-up against what happened on the next shot.
- Fixtures: each trigger fires at its threshold and stays silent one shot under it.
- An on-pattern shot never counts as a miss.
- The aim warning names the hazard that actually caused the trouble.
- Bump BUILD and CACHE.

## Brett decides
1. Today's trigger: **3 of 4** (recommended) or 2 of 3.
2. Aim-warning trouble gap: **+10 points** (recommended), +5 or +15.
3. History clause (b): **on** (recommended) or off.
