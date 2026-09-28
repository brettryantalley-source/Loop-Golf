# Profile v2 — schema and build rules

`src/profile.json` is BUILT from `data/extracted/` by `scripts/build-profile.mjs`. Never hand-edit
the JSON; edit the rules here and in the script, then rebuild with `npm run build:profile`.

Spec: `docs/SPEC-caddie.md` §5.1 (schema), §5.2 (Shot Pattern only — Loop's shot log never feeds
this file), §3.3 (roll model). Decisions Sep 28: the profile stays bundled at `src/profile.json`;
the seed source is the Last 10 batch (`data/README.md`), not the spec's Appendix A.

## Inputs

| File | Role |
|---|---|
| `data/extracted/2026-09-27-report.txt` | Exact text of the Stats Report PDF (Casual · Last 10, Jun 27–Sep 20 2026). **Wins over screenshots.** |
| `data/extracted/2026-09-27-screens.json` | Transcribed screenshots. Each screen carries `resolvedFilters` + `filterSource`. Screens 01–03 are **Last 5**; screens with `filterSource: "excluded"` are not profile data. |

The script must read both files and parse the report text (fixed column tables); it must not
carry any transcribed number as a literal. Every number in the output is traceable to a line of
the report or a `file` in the screens JSON, and each entry records where it came from.

## Value precedence

1. Report text (Last 10) over any screen.
2. A Last 10 screen over a Last 5 screen.
3. A value that exists only on a Last 5 screen is used, and its `source.window` says `"Last 5"`.
4. Known conflicts (`knownConflicts` in the screens JSON) resolve by rule 1. Never average.
5. Missing → `null`. The engine falls back per spec §5.4; it never receives an invented number.

## Output shape

```jsonc
{
  "version": 2,
  "generated": "2026-09-28",                    // build date, ISO
  "sources": {
    "shotPattern": { "window": "Casual · Last 10", "dateRange": ["2026-06-27","2026-09-20"], "rounds": 10,
                     "batch": "2026-09-27", "report": "data/extracted/2026-09-27-report.txt",
                     "screens": "data/extracted/2026-09-27-screens.json",
                     "last5": { "window": "Casual · Last 5", "dateRange": ["2026-08-15","2026-09-20"], "screens": ["01_191019.png","02_191311.png","03_191330.png"] } },
    "launchMonitor": { "date": null, "notes": "none — carries derived from totals (spec §3.3)" },
    "tangent": { "role": "historical baseline only", "used": false }
  },
  "clubOrder": ["Dr","2i","2Hy","4Hy","5i","6i","7i","8i","9i","PW","GW","SW","LW"],   // longest first
  "clubs": [ Club, ... ],
  "approachBuckets": [ Bucket, ... ],
  "approachAggregate": { "fairway": Aggregate, "rough": Aggregate },
  "putting": [ PuttBucket, ... ],
  "puttingSgPer18": -2.74,
  "shortGame": { "bands": [ ShortBand, ... ] },
  "tendencies": { "driver": DriverTendencies },
  "benchmarks": { "scratch": ScratchBench },
  "scoring": { "rounds": 10, "avg": 81.7, "toPar": 10.2, "best": 78, "worst": 85,
               "per18": { "birdies": 0.9, "pars": 8.6, "bogeys": 6.1, "doubles": 2.4 },
               "byPar": { "3": 3.6, "4": 4.62, "5": 5.38 },
               "sgPer18": { "offTee": -1.27, "approach": -1.79, "aroundGreen": -0.10, "putting": -2.74 } }
}
```

### Club

```jsonc
{ "id": "7i", "label": "7-iron", "family": "mid", "loftDeg": null,
  "entries": {
    "full":    { "tee": Entry|null, "fairway": Entry|null, "rough": Entry|null },
    "finesse": { "tee": Entry|null, "fairway": Entry|null, "rough": Entry|null } | null
  } }
```

Ids, labels, families (families from `CLUB_FAMILY` in `src/caddie/config.js`):

| id | label | family | Shot Pattern name |
|---|---|---|---|
| Dr | Driver | long | Driver • Cobra Adapt |
| 2i | 2-iron | long | 2-Iron • Sub 70 699 |
| 2Hy | 2-hybrid | long | 2-Hybrid • Sub 70 949 pro |
| 4Hy | 4-hybrid | long | 4-Hybrid • Cobra F6 |
| 5i … 9i | 5-iron … 9-iron | mid (5–7) / short (8–9) | N-Iron • Sub 70 699 Pro |
| PW | Pitching wedge | short | Pitching Wedge • Sub 70 699 Pro |
| GW | Gap wedge | wedge | Gap Wedge • Sub 70 TAIII |
| SW | Sand wedge (54°?) | wedge | Sand Wedge • Sub 70 TAIII |
| LW | Lob wedge (56°?) | wedge | Lob Wedge • Sub 70 TAIII |

The wedge ↔ loft mapping is an open input (spec §11); `loftDeg` stays `null`. The one-shot
"9-Iron" tee row and every "Unassigned" row are ignored.

### Entry (one club × swingType × lie)

```jsonc
{ "n": 12,
  "totalMedianYds": 181, "p25Yds": null, "p75Yds": null,
  "carryMedianYds": 175, "carrySource": "derived",      // total − ROLL_YDS[swing][family]; "measured" only if a real carry is ever supplied
  "distSdYds": null, "distSdSource": null,               // tee clubs: (p75 − p25) / 1.349, source "iqr"
  "lateralSdDeg": 4.04,
  "biasDistYds": null, "biasLatYds": null,
  "leftPct": 0.333, "rightPct": 0.667, "shortPct": 0.111,   // fractions 0–1; shortPct = "came up short" (> 10% short)
  "bigMiss": { "left": 0.12, "right": 0.152, "latYds": 54.5 },   // tee clubs only; approach clubs: { "left": 0, "right": 0, "latYds": null }
  "bigMissPct": null,                                    // approach clubs: "% BIG MISS" (> 10% of distance); tee clubs null
  "mishitPct": 0.043,                                    // tee clubs only
  "penaltyPct": 0.109, "recoveryPct": 0.109, "penaltyCount": 10,   // tee clubs; penaltyCount = round(penaltyPct × n); approach: 0 / 0 / 0
  "girPct": 0.556, "medianProximityFt": 31, "sgPerShot": -0.10,
  "blended": false,                                      // true when the median mixes swing types (wedges)
  "source": { "window": "Last 10", "report": ["§04 BAG MAPPING", "§04 DISPERSION BIAS"], "screens": [] } }
```

Percentages in the sources are 0–100; store as fractions 0–1, rounded to 3 decimals. Yards and
feet as integers as printed; degrees to 2 decimals.

### Where each entry comes from

**Tee entries (`full.tee`) — Dr, 2Hy, 4Hy, 2i only.** Report §04:
- BAG MAPPING → `n`, `totalMedianYds` (MEDIAN), `p25Yds`/`p75Yds` (RANGE), plus `width95Yds`, `width90Yds` (keep both, integers).
- `distSdYds` = round((p75 − p25) / 1.349, 1), `distSdSource: "iqr"`.
- DISPERSION BIAS → `leftPct`, `rightPct`, `bigMiss.left`, `bigMiss.right`, `mishitPct`, `lateralSdDeg` (σ(α)).
- POOR DRIVES → `penaltyPct`, `recoveryPct`; `penaltyCount = round(penaltyPct × n)`.
- STROKES GAINED BY CLUB → `sgPerShot`.
- `bigMiss.latYds = max(40, width95Yds / 2)` (a big miss is > 35 yds offline; half the 95% width is where the tail sits, floored so it is never inside the threshold). Note this rule in `source.rule`.
- `carryMedianYds = totalMedianYds` for the tee entries of Dr/2Hy/4Hy/2i (`ROLL_YDS.tee = 0`; tee shots use total), `carrySource: "derived"`.
- `girPct`, `medianProximityFt`, `shortPct`, `bigMissPct` → `null`.
- Screens 17–20 (per-club sheets, Last 10) carry `Longest`, `Avg. Offline`, `68% Arc`, `95% Arc`: store under `extra: { longestYds, avgOfflineYds, arc68Yds, arc95Yds }`. Where the sheet's 25th–75th differs from the report (2Hy, 2i) the report wins and the sheet value goes in `extra.p25p75Sheet`.

**Fairway entries (`*.fairway`) — every club except Dr.** Report §05 FROM TEE & FAIRWAY — BY CLUB → `n`, `girPct`, `sgPerShot`, `bigMissPct`, `medianProximityFt`. DISPERSION BIAS — FROM TEE & FAIRWAY → `leftPct`, `rightPct`, `shortPct`, `lateralSdDeg`. Medians from the Club Distances cards: screen `26_225158.png` (Last 10) first; PW and LW appear only on `02_191311.png` (Last 5) — use them with `source.window: "Last 5"`. 5i/7i/9i/SW differ between the two windows: Last 10 wins. 4Hy and 2i have no fairway median → `totalMedianYds: null` (4Hy keeps its n=2 stats; 2i fairway entry is `null` entirely, 0 shots).

Swing-type assignment (Brett's notes, spec §3.8 / Appendix A). Shot Pattern does not split swing types, so:
- PW and longer → `full.fairway`. `finesse` = `{ tee: null, fairway: null, rough: null }` for 2i (placeholder — Brett plays it as a finesse club at times; carries pending) and `null` for the others.
- GW → `full.fairway` with the blended 119 and `blended: true`; `finesse.fairway` = placeholder entry with `n: null, totalMedianYds: null` and the same `source` note.
- SW, LW → `finesse.fairway` carries the measured blended median (`blended: true`) because Brett plays these as finesse clubs inside 120; `full.fairway` = placeholder with `totalMedianYds: null`. Their rough stats go on `finesse.rough`.
- `carryMedianYds = totalMedianYds − ROLL_YDS[swingType][family]` (import `DEFAULT_CONFIG` from `src/caddie/config.js`; do not copy the numbers), rounded to an integer; `null` when the total is null. `carrySource: "derived"`.
- `bigMiss: { left: 0, right: 0, latYds: null }`, `penaltyPct: 0, recoveryPct: 0, penaltyCount: 0`, `mishitPct: null`, `distSdYds: null`.

**Rough entries (`*.rough`).** Report §05 FROM ROUGH — BY CLUB → `n`, `girPct`, `sgPerShot`, `bigMissPct`, `medianProximityFt`. No distance, no dispersion in the rough tables → `totalMedianYds`, `carryMedianYds`, `lateralSdDeg`, `leftPct`, `rightPct`, `shortPct` all `null`. Clubs absent from the rough table (6i, 2i) → `rough: null`.

**Tee entries for non-tee clubs** → `null` (Shot Pattern pools tee & fairway for approach clubs; the engine falls back to the fairway entry).

### Bucket (approachBuckets)

One per row of FROM TEE & FAIRWAY — BY DISTANCE (`lie: "fairway"`) and FROM ROUGH — BY DISTANCE (`lie: "rough"`). Half-open `[fromYds, toYds)`; "200-225" → 200/225, "225-250" → 225/250.

```jsonc
{ "fromYds": 130, "toYds": 140, "lie": "fairway", "n": 6, "girPct": 0.833, "sgPerShot": 0.03,
  "gainingPct": 0.833, "bigMissPct": 0.167, "medianProximityFt": 26,
  "missPct": null }                                   // per-bucket short/long/left/right is not in the data
```

### Aggregate (approachAggregate) — all distances, from screens 22/23 (fairway) and 28/29 (rough)

```jsonc
{ "n": 104, "wellLeft": 0.11, "left": 0.39, "right": 0.34, "wellRight": 0.16,
  "wellShort": 0.23, "short": 0.43, "long": 0.24, "wellLong": 0.10,
  "proximityZones": { "pro": 0.23, "scratch": 0.22, "fiveIndex": 0.11, "miss": 0.44 } }   // screen 21 / 27
```

### PuttBucket — report §07 PERFORMANCE BY DISTANCE

```jsonc
{ "fromFt": 4, "toFt": 6, "n": 41, "makePct": 0.488, "sgPer18": -0.77, "threePuttPct": 0.0,
  "threePuttN": [0, 26], "missShortPct": 0.048, "missLongPct": 0.952, "avgLeaveFt": 1.6, "within10Pct": null,
  "missLeftPct": 0.32, "missRightPct": 0.20 }        // left/right from screens 44–53 (share of ALL putts in the bucket, as printed)
```

Buckets: 0–3, 4–6, 7–9, 10–15, 16–24, 25–40, 41+ (`toFt: null` for 41+). `threePuttN` is the
"(0/22)" pair. Feet as printed. Missing (e.g. "—") → `null`.

### ShortBand — report §06

```jsonc
{ "fromYds": 0, "toYds": 25, "lie": "rough", "n": 56, "sgPerShot": -0.07, "upDownPct": 0.446,
  "inside3Pct": 0.232, "inside6Pct": 0.50, "missGreenPct": 0.107, "medianProximityFt": 6 }
```
Lies: fairway, rough, bunker; bands 0–25 and 25–50. Screens 41–43 add per-lie
`sgPer18` and `avgProximityFtIn` (e.g. `10' 9"` → 10.75): store under `extra`.

### DriverTendencies — report §04 headline + GOOD DRIVES / screen 12

```jsonc
{ "teeShots": 141, "goodDrivePct": 0.688, "fairwaysHitPct": 0.397, "intoTroublePct": 0.255,
  "driver": { "fairwaysHitPct": 0.457, "goodDrivePct": 0.739, "within40Pct": 0.528, "within70Pct": 0.73,
              "outside40Pct": 0.472, "outside70Pct": 0.27 },
  "landingZones": { "alwaysSafe": 0.53, "oftenPlayable": 0.20, "foul": 0.27, "safeHalfWidthYds": 20, "playableHalfWidthYds": 35 },
  "penaltyDrivesInsideCorridor": 8 }                  // rows in §04 STRATEGIC OPPORTUNITIES · PENALTY SITUATIONS
```

### ScratchBench — report §08 (the benchmark Shot Pattern scores Brett against)

```jsonc
{ "note": "Shot Pattern's scratch benchmark (Arccos, Broadie, Stagner, Shot Scope, Tour data). SG per shot elsewhere in this file is measured against it.",
  "scoring": { "birdiesPer18": 2.2, "parsPer18": 10.5, "bogeysPer18": 4.6, "doublesPer18": 0.7 },
  "driving": { "medianYds": 259, "fairwaysHitPct": 0.462, "lateralSdDeg": 4.8, "width90Yds": 87, "penaltyPct": 0.039, "recoveryPct": 0.07, "waywardPct": 0.109 },
  "approach": [ { "fromYds": 50, "toYds": 75, "girPct": 0.836, "proxPct": 0.109 }, ... ],   // BENCH GIR / BENCH PROX; "N/A" → null
  "putting":   [ { "fromFt": 0, "toFt": 3, "makePct": 0.98 }, ... ],
  "threePutt": [ { "fromFt": 10, "toFt": 15, "pct": 0.013 }, ... ] }
```

## Validation the script must enforce (fail the build otherwise)

- Every club in `clubOrder` exists exactly once; every entry that is not `null` has `n` (number or
  null), `totalMedianYds`, `carryMedianYds`, `carrySource`, `lateralSdDeg`, `bigMiss`, `sgPerShot`,
  `source` keys present.
- `carryMedianYds ≤ totalMedianYds` whenever both are numbers.
- Buckets per lie are contiguous and non-overlapping.
- All fractions in [0, 1]; all `n` integers ≥ 0 or null.
- The build is deterministic: running it twice yields byte-identical JSON (2-space indent, keys in
  the order shown here, trailing newline).

## Also emitted

`scripts/build-profile.mjs --check` exits non-zero if the committed `src/profile.json` differs from
a fresh build. `npm run build:profile` runs the build. The test in `src/caddie/profile.test.js`
(engine side) loads the JSON and checks the invariants above.
