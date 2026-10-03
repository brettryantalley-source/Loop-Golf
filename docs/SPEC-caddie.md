# Loop — Caddie Engine, Shot Log & Learning Profile · Claude Code Spec

**Date:** 2026-09-27
**Status:** Locked design. Ready for build sessions (see §9). Some seed data is provisional (see §11).
**Supersedes:** the engine logic, profile schema, and caddie-card layout in `Bogeyman-v7-v8-Caddie-ClaudeCode-prompt.md`. The v8 geometry approach (MapLibre + MapTiler + OpenStreetMap/Overpass) is retained and extended in §6. Where this doc and the v7/v8 spec disagree, **this doc wins**.
**Source of truth for code:** `src/app.jsx` (`index.html` is the built artifact).

---

## 0. Read first (Claude Code)

Before writing any code in any session:

1. Read `CLAUDE.md`, the current Build Log, and `Bogeyman-v7-v8-Caddie-ClaudeCode-prompt.md`.
2. **Audit the existing caddie code** already in `src/app.jsx` (Brett built and played a v1 caddie). Report what exists — engine functions, profile shape, UI components, storage keys — and what this spec replaces, keeps, or deletes. **Make no changes in the audit pass.** Wait for Brett's "go."
3. Keep the frozen code frozen: `computeGhost` and `evalMatch` are not touched by anything in this spec.
4. Every deploy: bump build tag + `sw.js` cache version together (existing `CLAUDE.md` rule).

---

## 1. What we're building

Three components that stack. Each is shippable on its own.

| Component | Job | Needs |
|---|---|---|
| **A. Caddie engine** | At every ball, give two priced options: SAFE and AGGRESSIVE | Profile + hole geometry + GPS |
| **B. Shot log** | After each full shot (≥75 yds), capture what happened and why | GPS + a fast post-shot card |
| **C. Learning profile** | Turn Shot Pattern exports + Loop's shot log into the numbers A uses; adapt within a round and across rounds | A and B |

Shot Pattern is passive (shows dispersion and results). Loop is prescriptive (tells Brett what to hit, where, and what it costs). Loop never tries to replace Shot Pattern's tracking; it adds the *why* (miss cause) and the *what next* (recommendation).

---

## 2. Locked rules (non-negotiable)

1. **Two options, every ball.** SAFE = lowest expected score. AGGRESSIVE = highest birdie probability. Recomputed from wherever Brett is standing. *(Amended Oct 3, D76: SAFE = the lowest expected score among the shots the course-management rules in `src/caddie/strategy.js` allow — pin position, club up, no hero shots, driver on ties.)*
2. **Aggressive is never hidden.** It is always shown with its price: expected-score cost and trouble rate.
3. **Same shot → say so.** If no alternative materially raises birdie probability, show one line: "Same shot both ways." Never invent a hero option. (Definition in §3.6.)
4. **Every hole is played for par.** The ghost score, match state, and differential **never** enter the engine. The ghost is a status reminder only. (Acceptance test T7 enforces this.)
5. **No pre-shot input required.** Pre-shot, Loop only informs. Brett taps one button ("I'm on the tee" / "I'm at my ball"); everything else is inferred and shown as editable assumptions. He may correct an assumption; he is never asked to.
6. **The engine does not recommend shot shape.** Brett decides shape. Loop recommends club, swing type, target, and line only.
7. **All capture is post-shot.** Intended shape, contact, strike, start line, curve — all logged after the swing.
8. **Every recommendation cites Brett's own numbers.** Reason strings must be generated from profile fields, never free text.
9. **Nudge, never overhaul.** Within-round adaptation is capped and always explained (§5.5).

---

## 3. Component A — Caddie decision engine

All engine code is **pure functions** (no DOM, no storage, no network) so every rule is testable in Node. Suggested module: `src/caddie/engine.js` (+ helpers). If `build.sh` only bundles `app.jsx`, adapt the build minimally to include the module and document the change in `CLAUDE.md`.

### 3.1 Trigger and context assembly

Two buttons drive everything:

- **"I'm on the tee"** → shot 1 of the current hole.
- **"I'm at my ball"** → next shot of the current hole. This tap also closes out the previous shot (its end position = this GPS fix; see §4.5).

On tap, assemble a `ShotContext` with no user input:

| Field | Source |
|---|---|
| `hole`, `par`, `nine`, `shotNo` | Round state + hole detection (§6.4) |
| `ballGps {lat, lng, accuracyM}` | `navigator.geolocation` with `enableHighAccuracy: true` |
| `distances {front, center, back, pin}` | Ball → green polygon (§6.3) |
| `lieType` | Point-in-polygon inference (§6.2) — `tee | fairway | rough | sand | recovery | green` |
| `lieQuality` | Default `standard` (GPS cannot know this) |
| `conditions` | Default `normal`; `wet` if weather shows meaningful rain in last 24h (threshold tunable) |
| `wind {speedMph, dirDeg}` | Weather API at course location (§6.5) |
| `elevationDeltaYds` | Elevation of target − elevation of ball (§6.5) |
| `pinPos` | Default `middle` |
| `hazards` | Polygons for this hole (§6.1) |

### 3.2 Editable assumption chips

Every inferred value that the engine uses and that Brett might know better is shown as a chip. One tap opens a small picker; the engine recomputes instantly.

| Chip | Default | Options |
|---|---|---|
| Lie type | inferred | Tee · Fairway · Rough · Sand · Recovery |
| Lie quality | Standard | Good · Standard · Bad · Buried/Sitting down |
| Conditions | Normal (or Wet from weather) | Firm · Normal · Wet |
| Pin | Middle | Front · Middle · Back |

Low-confidence lie inference (§6.2) renders the lie chip with a "?" marker. Every correction is logged (§5.6).

### 3.3 Plays-like distance

```
playsLike = rawDistance
          + elevationDeltaYds * ELEV_FACTOR          // default 1.0 (1 yd per yd of rise)
          + windAlongYds                              // head: +HEAD_PCT per mph; tail: −TAIL_PCT per mph
          + lieDistanceAdj(club, lieType, lieQuality) // from profile, e.g. rough → short bias
          + conditionsAdj(conditions)                 // wet: roll = 0 on approach clubs
```

- `HEAD_PCT = 0.01`, `TAIL_PCT = 0.005` per mph of along-shot wind. Crosswind produces an aim offset, not a distance change. **These are rules of thumb — expose as tunable constants in one config object.**
- Temperature adjustment: out of scope for v1.
- Carry vs. total: approach shots and any shot whose landing zone is the green use **carry**. Tee shots into fairway use **total** (carry + roll). Wet → roll = 0 for all clubs.
- **No launch-monitor data exists and none is coming.** Shot Pattern medians are the permanent distance source, and they are **totals, not carries**. The engine derives carry from total with an explicit, tunable roll model rather than treating the median as carry:
  - `carryMedianYds = totalMedianYds − rollYds(club, conditions)`
  - Default `rollYds`: irons and wedges into a green **6 yds** (range 5–8); hybrids/long irons **10 yds**; driver/tee shots **not applicable** (total is used directly).
  - Wet conditions → `rollYds = 0`.
  - Finesse entries → `rollYds = 3`.
  - Expose the whole roll table in the same tunable config object as the wind constants. If a measured carry is ever supplied for a club, it overrides the derivation for that club.

### 3.4 Candidate generation

For the current `ShotContext`, build a candidate set of `(club, swingType, target)`:

- **Clubs:** every club in the profile whose plays-like range can reach a useful target. Prune clubs that can't reach or would fly the green by more than its depth + 20 yds.
- **Swing types:** `full` for every club; `finesse` for clubs that have a finesse entry in the profile (initially the wedges and the 2-iron — §5.1). Recovery is never recommended; it is a capture-only type.
- **Targets:**
  - *Tee / fairway-bound shots:* aim points across the landing corridor at the club's expected total distance, every 5 yds from the left edge to the right edge of the fairway polygon, plus the hole centerline.
  - *Green-reachable approach:* pin (from `pinPos`), green center, and fat side (center of the largest green area farthest from the nearest hazard).
  - *Layup:* see §3.7.

### 3.5 Scoring a candidate

Score each candidate by simulation over Brett's dispersion.

**Dispersion model (per club × swingType × lieType, from profile):**
- Core: bivariate normal. Longitudinal σ = `distSdYds`. Lateral σ = `carry × tan(lateralSdDeg)`.
- Bias: mean offsets `biasDistYds` (e.g. short from rough) and `biasLatYds` (e.g. 8-iron left).
- Big-miss tail: mixture component with probability `bigMiss.left` / `bigMiss.right` and lateral magnitude `bigMiss.latYds`. This is what prices driver penalty risk; do not drop it.
- Lie quality `bad` / `buried`: widen σ by `LIE_QUALITY_SPREAD` and add short bias (tunable; default +15% σ, −5 yds).

**Simulation:** `N = 500` samples per candidate (tunable). For each sample landing point, classify via §6.2 and compute:

| Landing | Strokes after this shot |
|---|---|
| Green | `1 + Eputt(distanceFt)` |
| Fairway / rough / sand / recovery | `1 + E(distanceYds, lie)` |
| Water / lateral water | `1 + 1 (penalty) + E(dropPoint, rough)` — drop point ≈ entry point on the water polygon edge along the line of flight |
| Out of bounds (outside `leisure=golf_course` boundary) | `1 + 1 + E(currentPosition, currentLie)` (stroke and distance) |
| Trees (`natural=wood`, `landuse=forest`) | `1 + E(distanceYds, recovery)` |

Candidate outputs:
- `expScore` = strokes already taken on the hole + mean(strokes after).
- `birdieProb` = mean over samples of `B(landingState, par − 1 − strokesTakenIncludingThisOne)`.
- `troubleRate` = share of samples landing in water, OB, sand, or recovery.

**Expected-strokes functions:**
- `E(distanceYds, lie)` = scratch baseline expected strokes − Brett's personal strokes-gained-per-shot for that distance bucket and lie (from profile). **The scratch baseline table must come from a published strokes-gained baseline; cite the source in a code comment. Do not invent baseline values.**
- `Eputt(ft)` = `1 + (1 − makePct(ft)) + threePuttPct(ft)` from Brett's putting table.
- `B(state, k)` = probability of holing out in ≤ k more strokes. `k = 1` on green → `makePct(ft)`. `k = 2` from an approach state → `GIR%(bucket, lie) × makePct(medianProximityFt(bucket, lie))`. `k ≥ 3` → approximate from the best `k = 2` state reachable with one more shot (precompute tables at profile load; do not recurse the full simulation live).

**Performance budget:** full recompute < 500 ms on an iPhone. Prune candidates before simulating.

### 3.6 Two-option selection and the same-shot rule

```
SAFE       = argmin(expScore)            // over the shots strategy.js allows (D76)
AGGRESSIVE = argmax(birdieProb)            // ties → lower expScore
if AGGRESSIVE.birdieProb − SAFE.birdieProb < SAME_SHOT_BIRDIE_GAIN   // default 0.01
   or (same club AND same swingType AND targets within 10 yds):
       sameShot = true
```

- When `sameShot`, return one option and the message "Same shot both ways."
- Otherwise return both, each with its price.

### 3.7 Layup optimizer

Layup is a **proximity decision, not a distance decision.**

When the green is not the best target (or not reachable), generate layup candidates at leave-distances from 50 to 150 yds in 5-yd steps, targeting the fairway center at that distance. Score each exactly as §3.5 (landing lie and hazards included), where the next-state value `E(leaveDistance, landingLie)` comes from Brett's personal data. This makes the optimizer choose, for example, leave-100 over leave-75 whenever his personal numbers say 100 plays better — no hard-coded preferred numbers.

The layup club's own dispersion must be simulated. A leave-100 whose landing ellipse catches a bunker loses to a leave-110 that doesn't, if the numbers say so.

### 3.8 Club logic: lie × swing type

The profile stores numbers per **club × swingType × lie**, never one blended median.

- Known example: 2-hybrid is 248 off the tee, 224 from the fairway. Rough applies its own short bias per club (8-iron proximity collapses from fairway to rough in the current data).
- Swing type matters most inside ~130: Brett stops full swings around 120 and in, and plays finesse wedges. At 100 he almost always hits a finesse 54°. The engine should prefer finesse entries when the profile says they score better, and must never assume a wedge's full carry for a finesse shot.
- Bag gaps (distances no full swing covers) are not special-cased. They surface naturally through the personal `E()` values and finesse entries.

### 3.9 Output contract

```json
{
  "context": { "hole": 7, "par": 5, "shotNo": 2, "distances": {"front": 226, "center": 238, "back": 251},
               "playsLike": 245, "lieType": "fairway", "lieConfidence": "high", "wind": {"speedMph": 8, "relative": "into-left"} },
  "sameShot": false,
  "safe":       { "club": "5i", "swingType": "full", "target": {"lat": 0, "lng": 0, "label": "leave 100, fairway center"},
                  "expScore": 4.84, "birdieProb": 0.06, "troubleRate": 0.04, "reason": "..." },
  "aggressive": { "club": "2H", "swingType": "full", "target": {"lat": 0, "lng": 0, "label": "green, front-left"},
                  "expScore": 5.02, "birdieProb": 0.13, "troubleRate": 0.19, "reason": "..." },
  "nudges": [ { "axis": "distance", "text": "Short twice from rough today (H3, H6) → +½ club" } ],
  "flags":  [ { "type": "contact", "text": "2 fat wedges today" } ]
}
```

(Values above are illustrative only.)

### 3.10 Display strings

One line per option. Readable without the map.

```
SAFE        5-iron · leave 100 center        Avg 4.8 · Birdie 6% · Trouble 4%
AGGRESSIVE  2-hybrid · at green, front-left  Avg 5.0 (+0.2) · Birdie 13% · Trouble 19%
```

- Avg to 1 decimal; aggressive shows its delta vs. safe. If |delta| < 0.05, show "≈ same avg."
- Reason line (smaller, one line max) under each option, generated from profile fields. Example template: `"{club}: {lateralSdDeg}° spread, {penaltyCount} penalties in last {n}"`.
- Same shot: `BOTH  Driver · center  Avg 4.4 · Birdie 11% — Same shot both ways.`

---

## 4. Component B — Shot log (post-shot capture)

### 4.1 Scope

| Shot | Capture |
|---|---|
| Any shot where the ball started **≥ 75 yds** from the pin | **Long card** (this section) |
| Shots from < 75 yds, off the green | Auto-classified `shortGame`. Minimal log (club + GPS only) for now. Full short-game capture is a **separate future spec**. These shots must never feed full-swing or finesse numbers. |
| Putts | Not captured by this card. Putting capture is a separate future spec. |

### 4.2 Long-card fields

All fields have smart defaults so a good shot takes one tap.

| Field | Values | Default |
|---|---|---|
| Club | bag list | Club of the SAFE option (or the single option when `sameShot`) |
| Line played | Safe · Aggressive · Own call | Inferred from club match with the recommendation; editable |
| Shot type | Full · Finesse · Recovery | `finesse` if club is a wedge and start distance ≤ 120; else `full` |
| Contact (vertical) | −2 super fat · −1 chunky · 0 pure · +1 thin · +2 really thin | 0 |
| Strike (horizontal) | Heel · Center · Toe | Center |
| Intended shape | Draw · Straight · Fade | Brett's most common intended shape for this club; Straight if no history |
| Start line (vs. target line) | Left · On · Right | On |
| Curve (actual) | −2 big draw · −1 draw · 0 straight · +1 fade · +2 big fade | Matches intended shape |

Contact and strike together form a face map (vertical scale × horizontal three-state) without a nine-box grid.

Start line is recorded **relative to the target line**. Intended shape gives it meaning: a fade that starts left and curves right is executed; a fade that starts left and draws is a flip.

### 4.3 Quick path

- A large **"Good shot ✓"** button writes all defaults (pure, center, as-intended, start on line) in one tap.
- Misses get detail: tap only the fields that were off.
- Target: ~1 tap on good shots, 3–5 taps on misses.

### 4.4 Flow and timing

1. Brett hits. The long card is available immediately (swipe up or tap "Log shot").
2. If he doesn't log before tapping "I'm at my ball," Loop shows the previous shot's card first, collapsed, with **Good shot ✓ · Detail · Skip**. One tap and the caddie appears.
3. Skipped shots are stored with `logged: "skipped"` and excluded from miss-cause analysis (but their GPS result is still used).

### 4.5 Auto-derived fields (no taps)

When the next "I'm at my ball" (or hole completion) fires, compute for the previous shot:

- `endGps` = the new fix.
- `endLie` = inferred lie at `endGps` (plus any correction Brett makes on the new chip).
- `distanceMissYds` = actual distance along target line − intended distance (negative = short).
- `lateralMissYds` = signed offset from the target line (negative = left).
- `onTarget` = within tolerance ellipse (tunable; default ±5% distance, ±`carry × tan(1.5°)` lateral).

### 4.6 Shot record schema

```json
{
  "id": "uuid",
  "schema": 1,
  "roundId": "uuid",
  "courseId": "golfcourseapi id",
  "nine": "Ridge",
  "hole": 7,
  "shotNo": 2,
  "ts": "ISO-8601",
  "start": { "lat": 0, "lng": 0, "accuracyM": 4, "distanceToPinYds": 238, "playsLikeYds": 245 },
  "lie": { "inferred": "fairway", "confidence": "high", "confirmed": "fairway", "quality": "standard" },
  "conditions": "normal",
  "wind": { "speedMph": 8, "dirDeg": 210 },
  "recommendation": { "safe": {"club": "5i", "swingType": "full", "targetLabel": "leave 100"},
                      "aggressive": {"club": "2H", "swingType": "full", "targetLabel": "green front-left"},
                      "sameShot": false, "nudgesShown": [] },
  "club": "5i",
  "linePlayed": "safe",
  "shotType": "full",
  "contact": 0,
  "strike": "center",
  "intendedShape": "draw",
  "startLine": "on",
  "curve": -1,
  "end": { "lat": 0, "lng": 0, "accuracyM": 5, "lie": "fairway" },
  "derived": { "distanceMissYds": -6, "lateralMissYds": 3, "onTarget": true },
  "logged": "quick"
}
```

`logged` ∈ `full | quick | skipped`. Store `schema` on every record and write a migration function for any future change.

---

## 5. Component C — Profile and learning

### 5.1 Profile v2 schema (`profile.json`)

```json
{
  "version": 2,
  "generated": "ISO date",
  "sources": {
    "shotPattern": { "window": "Casual · Last 5", "dateRange": ["2026-08-15", "2026-09-20"], "rounds": 5 },
    "launchMonitor": { "date": null, "notes": "pending" },
    "tangent": { "role": "historical baseline only" }
  },
  "clubs": [
    {
      "id": "7i", "label": "7-iron", "loftDeg": null,
      "entries": {
        "full":    { "tee": {...}, "fairway": {...}, "rough": {...} },
        "finesse": null
      }
    }
  ],
  "approachBuckets": [
    { "fromYds": 130, "toYds": 150, "lie": "fairway", "n": 0, "girPct": 0, "medianProximityFt": 0, "sgPerShot": 0,
      "missPct": { "short": 0, "long": 0, "left": 0, "right": 0 } }
  ],
  "putting": [ { "fromFt": 4, "toFt": 6, "n": 0, "makePct": 0, "threePuttPct": 0, "missLongPct": 0, "missShortPct": 0 } ],
  "shortGame": { "note": "structure TBD with short-game capture spec" }
}
```

Each lie entry inside a club:

```json
{ "n": 0, "carryMedianYds": 0, "totalMedianYds": 0, "distSdYds": 0, "lateralSdDeg": 0,
  "biasDistYds": 0, "biasLatYds": 0, "bigMiss": { "left": 0, "right": 0, "latYds": 0 },
  "penaltyCount": 0, "girPct": null }
```

- `finesse` entries exist for wedges and the 2-iron at minimum (Brett plays the 2-iron as a finesse club off tees and fairways at times).
- `totalMedianYds` is the measured value from Shot Pattern. `carryMedianYds` is **derived** per the roll model in §3.3 unless a measured carry is supplied. Mark derived values with `"carrySource": "derived"` so a later real measurement can replace them cleanly.
- Any field may be `null` when data doesn't exist. The engine falls back per §5.4, never to a made-up value.

### 5.2 Source separation (no double counting)

Brett logs every round in **both** Shot Pattern and Loop, so the same swings appear in two sources. Rules:

1. `profile.json` is built **only** from Shot Pattern exports (plus launch-monitor carries and Tangent history as a prior). It never includes Loop shot-log data.
2. Loop's shot log is applied **in-app only**, on top of `profile.json`, for:
   - fields Shot Pattern doesn't have (swing type, contact, strike, intended shape, start line, curve);
   - splitting blended distances into full vs. finesse;
   - within-round adaptation (§5.5);
   - recency-weighted adjustments (§5.3).
3. **Takeover threshold:** once Loop has ≥ `TAKEOVER_N` (default 30) logged, non-skipped shots for a given club × swingType × lie, Loop's own distance and dispersion numbers replace Shot Pattern's for that entry. Below the threshold, blend per §5.4 with Shot Pattern as the prior.

### 5.3 Between-round recency weighting

Weight each Loop-logged round by age (most recent = 1):

| Rounds ago | Weight |
|---|---|
| 1–3 | 1.0 |
| 4–8 | 0.5 |
| 9–20 | 0.2 |
| > 20 or > 12 months | 0 (excluded) |

Tiers and weights are tunable constants. Shot Pattern's export is already a recency window ("Last 5"), so it is not re-weighted.

### 5.4 Small-sample shrinkage

Many buckets hold 1–8 shots. Never let one shot swing a number:

```
estimate = (n_eff × personal + K × prior) / (n_eff + K)      // K default 5
```

- `n_eff` = recency-weighted shot count.
- `prior` order of preference: Shot Pattern value for the same entry → same club, adjacent lie → adjacent club, same lie → scratch baseline.

### 5.5 Within-round adaptation

Earlier shots in **this round** influence later recommendations. Tiny samples, so it needs evidence and caps.

**Evidence rule:** a correction fires after **≥ 2 same-direction misses on the same axis** this round, within the same **club family** OR from the same **lie type**.

Club families: `long` (driver, woods, hybrids, 2-iron) · `mid` (5–7 iron) · `short` (8-iron–PW) · `wedge` (GW and below, full or finesse).

**Axes are independent and stack:**

| Axis | Trigger | Correction | Cap |
|---|---|---|---|
| Distance | ≥ 2 short (or long) misses | Shift plays-like by 50% of the mean distance miss → surfaces as a club change when it crosses a gap | 1 club total (per family) |
| Direction | ≥ 2 left (or right) misses | Shift aim by 50% of the mean lateral miss, toward the opposite side | Target stays inside the green / fairway polygon |
| Contact | ≥ 2 fat or thin (|contact| ≥ 1) | **Flag only**, no adjustment | — |

- Short **and** left → both corrections fire and the nudge text names both: "Short-left twice with mid irons (H4, H9) → +½ club, aim right-center."
- Direction only → aim nudge only; club unchanged. Distance only → club nudge only; aim unchanged.
- **Clearing:** a correction clears after 2 consecutive on-target shots in that family (or from that lie).
- Every nudge is one line, cites the holes, and is visible on the caddie screen. The engine uses the nudged numbers in both SAFE and AGGRESSIVE.
- Within-round corrections never write back to the profile directly; the round's shots enter the profile through §5.3 after the round.

### 5.6 Lie-override learning

Every lie-chip correction is stored: `{ courseId, hole, gps, inferred, corrected, ts }`.

- If ≥ 2 corrections to the same value fall within 15 m of each other on the same course, future inference inside that radius uses the corrected value.
- This fixes badly traced OSM polygon edges over time without re-mapping.

### 5.7 Aggression scorecard

From `linePlayed` and hole scores:

- Per round and season: count of Safe / Aggressive / Own-call shots.
- For each line: actual strokes-to-hole-out vs. the engine's `expScore` at the time. Sum the difference → "Aggression paid +0.8" or "Aggression cost −1.4."
- Shown on the round Summary screen and in History. No effect on recommendations.

### 5.8 Refresh workflow (round cadence)

Shot Pattern is export-only (PDF), so the profile refreshes after rounds, not live:

1. After a round, Brett exports Shot Pattern (PDF) and Loop's shot log (JSON, §8) and uploads both to the Golf project chat.
2. That chat produces an updated `profile.json` (Shot Pattern data only, per §5.2).
3. Claude Code commits it to `data/profile.json`.
4. The app loads it at round start with the existing v5 pattern: cache-first → live fetch → last good copy. Show "Profile: Sep 20 · Last 5" inline on the setup screen.

---

## 6. Geometry and sensors

Free-first. No paid data in this spec.

### 6.1 Course geometry (OpenStreetMap via Overpass)

- On course select, query Overpass for the `leisure=golf_course` boundary nearest the selected course and every golf feature inside it: `golf=hole` (ways with `ref` and `par`), `golf=tee`, `golf=fairway`, `golf=green`, `golf=bunker`, `golf=rough`, `golf=water_hazard`, `golf=lateral_water_hazard`, `natural=water`, `natural=wood`, `landuse=forest`. **Verify tag usage against the OSM wiki in-session.**
- Cache the result per course permanently (`loop.geo.{courseId}`), versioned. Re-fetch only on explicit refresh.
- **Coverage check** on fetch: report holes missing a `golf=hole` way or a green polygon. Show "Geometry incomplete: holes X, Y." For those holes only, the caddie drops to club-brain mode (profile-only recommendation with an optional distance chip). This is the one allowed exception to "no pre-shot input."

### 6.2 Lie inference

Point-in-polygon with priority: green → sand → water → tee → fairway → trees → rough (inside boundary, no other feature) → OB (outside boundary).

- Apply lie overrides (§5.6) before polygon checks.
- `lieConfidence = "low"` when `accuracyM > 8` **or** the point is within `max(accuracyM, 5)` m of an edge whose other side is a different lie. Low confidence shows "?" on the chip. The engine still uses the inferred lie.
- Phone GPS runs ~3–5 m in good conditions: expect it to separate fairway from rough on most holes and to be unreliable on fringe vs. greenside rough. The chip exists for exactly that.

### 6.3 Distances

- Front / center / back: along the line from ball to green centroid, nearest and farthest intersections with the green polygon, plus centroid distance.
- Pin: center adjusted by the `pinPos` chip (front third / middle / back third along that line).

### 6.4 Hole detection and 27-hole courses

- Current hole comes from round state. When "I'm on the tee" is tapped inside or near the next hole's tee polygon, advance automatically.
- **27-hole clubs** (Ironwood: Ridge / Valley / Lakes) may number OSM holes 1–27 or 1–9 per nine. On first use of a course, show a one-time mapping screen pairing each OSM hole with `{nine, hole}`. Save permanently (`loop.nineMap.{courseId}`). Never ask again for that course.

### 6.5 Weather and elevation

- Free APIs, candidate: Open-Meteo (weather and elevation). **Verify endpoints, fields, CORS, and rate limits in-session before building.**
- Elevation: sample tee, green, and fairway points at geometry-fetch time; cache per course; interpolate for the ball position. No per-shot elevation calls.
- Weather: fetch at round start and refresh every 15 minutes or on "I'm on the tee," whichever is later. On failure, use the last value and show its as-of time.

### 6.6 Map layer

MapLibre GL JS + MapTiler satellite + OSM polygons (from v8) is retained. It draws both options' dispersion ellipses and targets. It is **never** on the default caddie screen (§7).

### 6.7 Connectivity

Brett is on cellular at the first tee. Fetch all geometry, elevation, and the profile at round start. GPS works without data, so mid-round signal loss affects only weather refresh.

---

## 7. UI constraints (full design pass pending)

The v1 caddie failed on layout, not logic: map crammed into the top sliver, too much blocked text below. A dedicated UI design chat precedes Session 3. These constraints are fixed regardless of that design:

1. **Text first, map optional.** The default caddie screen has no map. "Show hole" opens a full-screen map; closing returns to the card.
2. **One screen, no scrolling** on an iPhone.
3. **Top-to-bottom order:** context strip (1 line: hole · par · shot · distances · plays-like · wind) → chips row → SAFE line + reason → AGGRESSIVE line + reason (or the single BOTH line) → nudge line (if any) → big primary buttons.
4. **Primary buttons:** "I'm at my ball" / "I'm on the tee" and "Log shot." Large, thumb-reachable, bottom of screen.
5. **Glanceable in sunlight:** large type, high contrast, existing dark theme.
6. **Post-shot card:** bottom sheet. "Good shot ✓" is the largest target. Scales are segmented controls. No text entry anywhere.

---

## 8. Storage and export

| Key | Contents |
|---|---|
| `loop.profile` | Cached `profile.json` |
| `loop.geo.{courseId}` | Geometry + elevation samples |
| `loop.nineMap.{courseId}` | 27-hole mapping |
| `loop.shots.{roundId}` | Shot records for one round |
| `loop.lieOverrides` | Lie corrections |
| `loop.config` | Tunable constants (§3.3, §3.5, §3.6, §5) |

- Size: ~1 KB/shot × ~35 long-card shots/round ≈ 35 KB/round. localStorage is fine for a season; move the shot log to IndexedDB if it approaches limits.
- **Export:** History → "Export shot log" → JSON (all rounds or selected) via share sheet / download, clipboard fallback. This file goes to the Golf project chat after each round.
- **Import:** accept the same JSON (restore on a new phone).
- **Durability risk:** the shot log lives on one phone. Verify iOS persistence behavior for home-screen web apps in-session; post-round export is the backup regardless.

---

## 9. Build order and ship points

| Session | Scope | Model | Gate / tests |
|---|---|---|---|
| **S0 — Audit** | Read everything in §0. Report existing caddie code. **No changes.** | Sonnet | Brett's "go" |
| **S1 — Engine core** | Profile v2 schema + loader, `E()` / `Eputt()` / `B()`, dispersion + simulation, candidate generation, two-option selection, same-shot rule, layup optimizer, lie × swing-type logic, reason templates. Pure modules, synthetic fixture holes. | Fable (Opus fallback) | T1–T10 |
| **S2 — Geometry + sensors** | Overpass fetch/cache, coverage check, lie inference, distances, hole detection, 27-hole mapping, weather/elevation, `ShotContext` assembly. | Fable (Opus fallback) | T11–T15 · Ironwood coverage verified |
| **S3 — Caddie screen** | Build from the UI design pass. Chips, option lines, nudge line, full-screen map toggle. | Sonnet | **SHIP 1 — caddie on course** |
| **S4 — Shot log** | Long card, quick path, previous-shot prompt, auto-derived fields, storage, export/import. | Sonnet | T16–T20 · **SHIP 2** |
| **S5 — Learning loop** | Within-round nudges, recency weights, shrinkage, takeover threshold, lie-override learning, aggression scorecard on Summary/History. | Opus | T21–T32 · **SHIP 3** |

---

## 10. Acceptance tests (Node, pure functions)

Fixtures: synthetic holes (open par 5, water-left par 4, bunkered par 3) + the provisional seed in Appendix A.

**S1 — Engine**
- **T1 Same shot:** wide-open par 5, no hazards in driver's ellipse → `sameShot: true`, single option = driver, message "Same shot both ways."
- **T2 Aggressive always priced:** whenever `sameShot` is false, both options are present with `expScore`, `birdieProb`, `troubleRate`, and a delta.
- **T3 Lie club-up:** 174 plays-like from fairway → 7-iron. Same shot from rough with the profile's rough short bias → one more club.
- **T4 Finesse preference:** 100 yds from fairway → a finesse wedge entry, not a full-swing wedge carry.
- **T5 Layup by proximity:** 240 out on a par 5 with personal `E(100, fairway) < E(75, fairway)` → layup leaves ~100, not ~75.
- **T6 Layup landing safety:** bunker inside the leave-100 landing ellipse, clear at leave-110 → optimizer follows the simulated numbers, not the preferred distance.
- **T7 Ghost isolation:** varying ghost differential, match score, and segment state produces byte-identical engine output.
- **T8 Recompute:** a new ball position produces a new recommendation (no stale cache).
- **T9 Big-miss pricing:** water-left par 4 with driver `bigMiss.left > bigMiss.right` → the SAFE driver target shifts away from the water vs. the no-water fixture, and trouble rate drops.
- **T10 Output hygiene:** every reason string resolves only profile fields (no free text); no output contains a shot-shape field.

**S2 — Geometry**
- **T11 Lie inference:** points inside fairway / bunker / green / water polygons classify correctly; inside boundary with no feature → rough.
- **T12 Confidence:** `accuracyM = 12`, or a point 3 m from a fairway/rough edge → `lieConfidence: "low"`.
- **T13 OB:** point outside `leisure=golf_course` → OB; simulation applies stroke and distance.
- **T14 Distances:** front < center < back for a ball in front of the green; pin shifts with `pinPos`.
- **T15 Nine mapping:** mapping saved once is reused; no prompt on second load of the same course.

**S4 — Shot log**
- **T16 Routing:** start ≥ 75 yds → long card; < 75 yds off green → `shortGame` minimal record; putts → no card.
- **T17 Quick path:** "Good shot ✓" writes contact 0, strike center, start line on, curve = intended shape.
- **T18 Auto-derive:** the next "I'm at my ball" fills the previous shot's `end`, `derived.distanceMissYds`, `derived.lateralMissYds`, `onTarget`.
- **T19 Skip:** skipped shot keeps its GPS result and is excluded from miss-cause aggregates.
- **T20 Export/import round trip:** export → clear storage → import restores identical records.

**S5 — Learning**
- **T21** One short miss → no nudge.
- **T22** Two short misses, same family → distance nudge with holes cited.
- **T23** Two short-left misses → distance **and** direction nudges, one combined line.
- **T24** Two pulls left, distances on → direction nudge only; club unchanged.
- **T25** Two fat shots → contact flag only; no numeric change.
- **T26** Five short misses → distance correction capped at 1 club.
- **T27** Two on-target shots after a nudge → correction clears.
- **T28** Recency tiers apply the configured weights.
- **T29** A bucket with n = 1 moves at most `1/(1+K)` of the way from prior to that shot.
- **T30** At ≥ `TAKEOVER_N` Loop shots for an entry, Loop numbers replace Shot Pattern's for that entry only.
- **T31** Two lie corrections within 15 m → inference inside that radius returns the corrected lie.
- **T32** Source separation: no code path writes Loop shot-log data into the loaded `profile.json` object.

---

## 11. Open inputs

**Blocking**

| Item | Blocks | Owner |
|---|---|---|
| Scratch expected-strokes baseline table from a published strokes-gained source | S1 | Claude Code (cite source) |
| Ironwood (all 27 holes) traced in OSM with greens + `golf=hole` ways | S2 gate | Claude Code runs Overpass; Brett confirms |
| Caddie screen UI design pass | S3 | Separate Golf project chat |

**Non-blocking** (engine runs on the provisional seed; accuracy improves when supplied)

| Item | Owner |
|---|---|
| Roll-model defaults sanity-checked against Brett's eye for how far his irons release on a green | Brett (non-blocking, tune in-app) |
| Wedge label ↔ loft mapping (Shot Pattern shows GW / SW / LW; Brett plays gap wedge + 54° + 56°) and finesse carries per wedge and 2-iron | Brett |
| Remaining Shot Pattern export screens (more data exists than was reviewed) — final profile seeding waits on this | Brett → Golf project chat |
| Old Tangent report (shows capture fields Brett has logged before) | Brett |
| Weather + elevation API verified | Claude Code (S2) |
| Mid-round Shot Pattern screenshots (UI reference) | Brett |

---

## 12. Out of scope

- **Putting coach.** Needs green contour data (paid). Deferred; separate spec.
- **Short-game capture (< 75 yds).** Separate spec; minimal record only here.
- Temperature adjustment, shot-shape recommendations, any pre-shot input beyond optional chip corrections.
- Shot Pattern integration (export-only; no API).
- Paid geometry. Revisit after free-first engine proves out (plan: one month of Golf Intelligence Tester, hydrate ~20 courses, cache, cancel).

---

## Appendix A — Provisional seed (replace when full export + launch-monitor data land)

Source: Shot Pattern, Casual · Last 5, Aug 15–Sep 20, 2026 (avg 82.6). Small buckets (1–8 shots) → leanings, not laws.

**Club medians (blended — not yet split by swing type)**

| Club | Median yds | Notes |
|---|---|---|
| Driver | 285 | tee; likely total |
| 2-iron | 253 | tee; also used as finesse club (~250–260 all-in) |
| 2-hybrid | 248 tee / 224 fairway | 6 shots; ellipse unreliable |
| 4-hybrid | 235 | tee |
| 5-iron | 204 | |
| 6-iron | 194 | |
| 7-iron | 181 | 12 shots, central 80% ~95–235 (punch-outs/mis-tags); use median only |
| 8-iron | 168 | |
| 9-iron | 153 | |
| PW | 140 | |
| GW | 119 | blended; Brett's full GW ≈ 130 |
| SW | 98 | blended |
| LW | 85 | blended |

Brett's swing-type notes: full swings stop around 120 and in; from 100 he almost always hits a finesse 54°; his 54° goes ~120 full but he prefers not to hit it full.

**Tendencies**
- Strokes gained / round: putting −3.55 · approach −1.92 · off the tee −1.59 · around the green +0.35.
- Driver big miss: left 13.6% · right 9.1%. All 4 penalty drives were inside normal dispersion (aim, not swing).
- 2-iron: tightest club (σ 3.98°), 0 penalties, 100% within 70 yds.
- From fairway: 5-iron 14.3% GIR · 6-iron 25% GIR. 8-iron misses left 80%. 8-iron proximity 28 ft fairway → 82 ft rough. GW 40% GIR, 40% big miss.
- Putting: 4–6 ft make 39.1% (misses finish ~1.4 ft past → line/read). 25–40 ft three-putt 29.4%; 58.8% of misses short.
- Short game from rough 0–25 yds: 31% finish > 15% short.

**Sanity checks for S1 (derived, never hard-coded):** approach green zones 130–150 and 180–190; red zones 120–130, 160–180, 190–225. With the seed loaded, personal `E()` should rank those buckets the same way. If it doesn't, the seed or `E()` is wrong.
