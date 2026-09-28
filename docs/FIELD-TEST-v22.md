# Field test — Caddie (v22.2) at [course]

The caddie build (S1–S5) is complete on branch `claude/bold-pascal-2s136s`, draft PR #5, merged
into `main` before this round. Everything below can only be checked by walking the course with the
phone. Bring a laser if you have one: it is the reference for GPS.

## Before you leave the house (on wifi)

1. Open the app. Setup should read **v22.2 · Sep 29** top-right.
2. Pick your course and tee.
3. Wait for `Course map ready` under the ghost preview. If it reads
   `Course map · loading n of 18` for more than 30 s, or
   `Course map unavailable · caddie will use yards`, note it — the caddie still works, in
   club-brain (Enter yards) mode.
4. Confirm the tile prefetch runs (satellite tiles into `bogeyman-tiles-v1`). If it never starts or
   stalls, note it; the caddie falls back to a drawn map (§4.3) with no satellite.
5. Confirm the build tag reads **v22.2 · Sep 29** — this is the deploy counter; if it still says
   v21.4, the new bundle hasn't loaded (force-quit and reopen).

## First tee

6. Tap **Start round**. It should open the caddie screen directly (hole 1, pre-tee), not the
   scorecard.
7. Tap **I'm on the tee**. First time this session, iOS prompts for Location — allow **While
   Using** with **Precise** on.
8. Watch the aim/state line go `Locating` → a real recommendation. Note how long it takes.
9. On a normal fix, the rail should show Club, To target, and the aim short form (e.g. `Center`,
   `Leave 103`, `Front-left`). If it instead shows `No GPS fix`, `Location off`, `No course map`,
   or `No profile`, note which and what the notice line says.
10. Tap the green on the map — the pin should move to where you tapped and the recommendation
    should recompute.
11. Tap **‹ Details** to expand the rail. Check Front / Pin / Back / Plays / Lie / Quality / Wind /
    Elevation / Conditions / Avg / Birdie / Trouble, and the Safe / Aggressive / Both dispersion
    line.
12. Toggle **Aggressive**. The overlay, club and reason line should all change together.
13. If there's no course map or no GPS, tap **Enter yards** — confirm the club-brain fallback
    (profile only, no map) gives a sane club call.

## Mid-round

14. Walk to your ball, tap **I'm at my ball**. Confirm the phase/lie updates (fairway, rough, sand,
    recovery) and matches what you're standing on.
15. If a shot from the previous position was never logged, confirm the collapsed previous-shot
    prompt appears before `I'm at my ball` will proceed.
16. Tap **Log shot**. Try the **Good shot ✓** quick path once, and a full **Detail** log (segmented
    fields, Save) at least once.
17. Force a lie correction (e.g. you're actually in the rough, not the fairway) and confirm the chip
    updates; if GPS accuracy is poor, confirm the Lie chip shows `?` rather than guessing wrong
    silently.
18. On the green, confirm the rail collapses to pin-only and the bar reads **Score hole N**.

## Hole out

19. Tap **Score hole N** — confirm it lands you on the scorecard at the right hole, ready to write
    the score.
20. Confirm **‹ Card** and the scorecard's **Caddie** control move you back and forth without losing
    caddie state (chips, pin, toggle should all still be there).

## After the round

21. On Summary, confirm the **aggression line** (Safe/Aggressive lines played this round) renders
    and reads sensibly.
22. On History, confirm the **season aggression line** appears under the ledger.
23. From History, **Export shot log** — confirm a file downloads.
24. If you want this round to feed a profile refresh: pull a **Shot Pattern export** for the round
    (see the refresh workflow in `docs/HANDOFF-NEXT.md`, spec §5.8) and hand it to the Golf project
    chat.

## What to report back

- Fonts: any face that looks wrong or reverts to a system font.
- Pencil filter: any visible lag or stutter on the caddie screen (map + overlay redraw).
- GPS accuracy ring: whether the dashed ring appears when accuracy is poor, and how poor.
- Map vs. drawn fallback: which one you saw, and on which holes.
- Anything that read `—` (dash) when you expected a real value, and where.
