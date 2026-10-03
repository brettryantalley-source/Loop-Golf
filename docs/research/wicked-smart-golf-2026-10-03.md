# How to Play Wicked Smart Golf — notes for the caddie (Oct 3, 2026)

Source: Michael Leonard, *How to Play Wicked Smart Golf: 7 Proven Course Management Strategies to
Shoot Lower Scores* (Wicked Smart Golf, free guide, 11 pages). Brett uploaded it Oct 3 with the
instruction: **where it disagrees with `caddie-brain-2026-09-29.md`, trust this guide.**

These are notes, not a transcription. What each tip says that the engine can use, with the line
it rests on. What the engine did with each tip: `../CADDIE-BRAIN-INTEGRATION.md` part 2.

| # | Tip | What it says (engine-relevant) |
|---|---|---|
| 1 | Track your stats | Data over self-assessment. Recommends Shot Pattern and Arccos. |
| 2 | Warm up | Dynamic warm-up, putting and short game first, range from wedges up to driver, rehearse the first tee shot. Nothing for a shot decision. |
| 3 | Tee up like a tour pro | Before every tee shot identify the trouble (water, bunkers, OB) and pick a specific target, not "down the middle". "Don't automatically reach for less club because it 'feels safer'": Arccos shows 3-wood gains only 1–3% fairways at every handicap, and driver is often the smarter choice. Play one stock shape (fade or draw) all round; don't work it both ways. |
| 4 | Club up on approach shots | "Most trouble is short of the green — bunkers, water, false fronts, and difficult up-and-down situations." Golfers come up short because they don't know their true carries and "pick clubs based on perfect shots, not average shots." "You shouldn't need your best swing to hit the green." Take enough club that a mishit still finds the green and a pure one is on the back with a putt. (Scratch golfers hit about 50% of greens.) |
| 5 | Adapt to the pin | **Front pin: take more club** — a normal shot should find the middle. **Middle pin: be slightly more aggressive**, especially with wedges; with longer clubs respect your dispersion and don't chase flags. **Back pin: take less than the pin yardage** — pured, you're at the flag; slightly missed, you're in the middle instead of chipping from long. Whatever the pin: one stock shape, trust the pattern, aim accordingly; "simple targets lead to more greens." |
| 6 | Avoid the double bogey | Ask "How can I make bogey at worst?" after a bad shot. "Quit playing hero golf": "Only attempt recovery shots you could successfully execute 9 out of 10 times in practice. Otherwise, punch out." "Sometimes the smartest shot is the boring one." |
| 7 | Pre-shot routine | Commit to the target with the same routine every shot. Nothing for a shot decision. |

## Where it disagrees with the Sep 29 research

| Topic | Sep 29 research | This guide | Engine (Oct 3) |
|---|---|---|---|
| Pin position | §2.4: choose the target that minimizes expected strokes; "don't use a fixed edge rule" | Fixed rule by pin depth: front → more club, back → less than the pin yardage, middle → attack with wedges | Guide (D76) |
| Recovery shots | Minimize expected strokes | 9-in-10 or punch out | Guide (D76) |
| Approach club | Minimize expected strokes; no club-up rule | Club up; a short miss is the expensive one | Guide (D76) |
| Driver off the tee | §2.2: default driver; flip only when the penalty math says so | Default driver; don't reach for less club by feel | Agree — unchanged (T43), plus a tie rule |
| Center of green from 100+ | §2.4: center / fat side | Center for front and back pins | Agree |

## Brett's own numbers on short misses

Profile v2 `shortPct` = share of approach shots that came up more than 10% short (Shot Pattern,
DISPERSION BIAS). PW 20%, GW 19%, SW finesse 36%, LW finesse 25%, 7i 11%, 6i 10%, 5i 15% (8i and 9i
0%). The engine models distance as a symmetric normal with σ ≈ 5–6% of carry, which puts that
share near 2–5%. So for most of Brett's clubs the engine underrates the short miss the guide warns
about. That is why the pin rule is allowed to cost up to half a stroke by the engine's own price
before Brett's numbers overrule it (D76).
