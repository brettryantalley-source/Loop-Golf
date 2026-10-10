# C29: a short-game card inside 100 yds (spec for Brett's OK)

Draft, Oct 10. No code until Brett says OK. Item: `docs/OPEN-ITEMS.md` C29. Brett, Oct 10: "a chip
screen from 100 yards and in, so we don't confuse chip and finesse shots with full-shot data".

## Today
- From about 30 to 120 yds the caddie calls a wedge as usual. A wedge inside 120 is logged as
  `finesse`, which the profile learns separately from full swings.
- **5–15 yds off the green, on any lie, there is no call:** "No club in the profile reaches a useful
  target from here." (found in the C9 build).
- The logging card is the same as for a full shot. Chips and putts never teach the full-swing
  profile (`isShortGameOrPutt`), but nothing marks a shot as a chip, pitch or bunker shot.
- His short-game numbers are in the profile, last 10 rounds (up and down · median leave):
  rough 0–25 yds 43% · 7 ft (58 shots) · fairway 0–25 38% · 8 ft (8) · bunker 0–25 0 of 8 ·
  rough 25–50 9% · 15 ft (22).

## The card: off the green, 100 yds or less to the pin
**The call** (where the action button sits):
- **30–100 yds:** the caddie's wedge call as today. Nothing changes.
- **Inside 30 yds:** no club call; there's no data for one yet. His own numbers from this lie and
  distance instead: "Rough, 18 yds: up and down 43% · you leave it 7 ft". Shot type chips are
  pre-set from the lie: **Chip** (fairway / rough, inside 30) · **Bunker** (sand).

**Logging** (after the shot): one row of type chips, **Chip · Pitch · Bunker · Wedge**, the club,
then tap where it finished (as today).

| Type | Teaches |
|---|---|
| Chip, Pitch, Bunker | the short-game bands only (up and down, leave) by lie and distance; never a club's distances |
| Wedge | the club's finesse entry (as a finesse wedge does today) |

- Pre-selected: **Wedge** from 30 yds and out; **Chip** inside 30 (**Bunker** from sand). One tap
  to change.
- On the green it is the putting card, as today.

## Tests
- Routing at 29/30/100/101 yds and on each lie.
- A Chip record never reaches `applyShotLog`'s full-swing or finesse overlays.
- A Wedge record does reach the finesse overlay.
- The inside-30 line reads the right band for the lie.
- Smoke test: the card renders. Bump BUILD and CACHE.

## Brett decides
1. Where the card starts: **100 yds** (your words; recommended) or 75 (the old spec's line).
2. Inside 30: **your numbers only** (recommended until chips are logged) or a club suggestion
   (needs data Loop doesn't have yet).
3. The type chips: **Chip · Pitch · Bunker · Wedge** (recommended), or add Flop / Bump-and-run.
