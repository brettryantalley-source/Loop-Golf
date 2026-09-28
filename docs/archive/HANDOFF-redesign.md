# Handoff: Loop Golf redesign (from v19)

You're picking up the Loop Golf golf PWA to **redesign it**. The app works and is live at v19.
This file is the context layer for a design-focused thread: what exists, what is load-bearing,
what is free to change, and how to verify at a phone viewport without a phone.

Read `CLAUDE.md` first (standing rules), then this. `docs/HANDOFF-caddie.md` is the previous
handoff and explains the Caddie/Hole View feature; `docs/DEVLOG.md` has the version history.

---

## 1. Working-copy rule
Single source of truth: `~/Developer/Loop-Golf` on the studio Mac. Sync via GIT only. Brett's laptop has no copy of the repo; pushes run from this
Mac (Claude cannot push here — the permission classifier blocks it — so Brett runs the push command).

## 2. Where the app is — v19, live
| Version | Shipped | What |
|---|---|---|
| v17 | Sep 19 | Tap a score → auto-advance |
| v18 | Sep 19 | **The Caddie**: its own screen, toggled from Play; club, aim, why, from `src/profile.json` |
| v18.5 | Sep 19 | **GPS picks the shot**: OSM hole geometry, live distance F/M/B, auto phase |
| v19 | Sep 19 | **Hole View**: satellite map hole-up, dispersion ellipse vs trouble, offline tile cache |

Field test (Session 5) has **not** happened yet. `docs/FIELD-TEST-v19.md` is the checklist.
A redesign thread should not wait for it, but should not change engine behaviour either.

## 3. What the app is (one paragraph)
Brett plays head-to-head against a "ghost" calibrated to his last-5 differential. Two in-round
screens: **Play** (the ghost match: scoreboard, running chart, 3-hole segments, hole board, score
dial) and **Caddie** (satellite map, GPS-driven phase line, distance, flags, the club card with two
why-lines citing his own numbers, alternative-club chips). Plus **Setup** (course search, tee,
differential, hole-map + satellite status, Start), **Summary** (finalized round, scorecard, edit),
**History** (rounds, record, cloud backup, export/import). A round opens on the Caddie.

## 4. Screen and component inventory (`src/app.jsx`, 1,740 lines; `src/holeMap.jsx`)
| Screen | Component | Notes |
|---|---|---|
| Setup | `Setup` (line ~389) + `TileCacheLine`, `GhostRing`, `MiniStat` | Course search is debounced golfcourseapi; state filter; differential stepper; ghost preview card; START pinned at the bottom |
| Play | `Play` (~717) + `GhostChart`, `SegCell`, `StatPill`, `ScoreDial`, `LeaveSheet` | **`height: 100dvh; overflow: hidden; justify-content: space-between`** — a fixed full-height layout, nothing scrolls. Header: exit X · course · CADDIE pill · HOLE n/18 |
| Caddie | `Caddie` (~940) + `HoleMap` (holeMap.jsx), `Chip`, `LeaveSheet` | Scrolls. Order: header → map (`MAP_H` ≈ 36 vh, 220–340) → phase line (or 4 fallback chips) → GPS/green chips → distance input → lie chips (approach) → flag chips → card → alt chips → hole nav |
| Summary | `Summary` (~1197) + `ScoreCard`, `ScoreMark` | Scorecard in Shot-Pattern visual language (circles = birdie, squares = bogey) |
| History | `History` (~1487) | Round list, delete, cloud sign-in panel, manual export/import |
| shared | `App` (~1668) — the `screen` switch: `setup | play | caddie | summary | history` | |

Everything is **inline styles** (239 `style={{` blocks), no CSS framework, no classes beyond a
4-line `RESET`. Icons are hand-inlined lucide paths at the top of the file.

## 5. Current design tokens (all in `src/app.jsx` top)
```js
const C = {
  bg: "#000000", card: "#161719", card2: "#212327", ink: "#FFFFFF", sub: "#8A8F98",
  line: "#2A2D31", green: "#57C77F", greenDim: "rgba(87,199,127,0.15)",
  slate: "#9AA7B4", slateDim: "rgba(154,167,180,0.15)", red: "#FF5B52",
  redDim: "rgba(255,91,82,0.16)", tie: "#34373D",
};
const NUM  = "-apple-system,ui-sans-serif,'SF Pro Display',system-ui,sans-serif";  // numerals
const SANS = "-apple-system,ui-sans-serif,'SF Pro Text',system-ui,sans-serif";
const tnum = { fontVariantNumeric: "tabular-nums" };
const lbl  = { color: C.sub, fontSize: 11, fontWeight: 800, letterSpacing: 1 };       // section labels
const ZONE_COLOR = { green: C.green, amber: "#D4A94A", red: "#C9645E" };              // Caddie zones
```
Palette lineage: "Shot Pattern dark" — the companion app Brett runs alongside this one. Green
`#57C77F` is the brand colour (icon, ghost ring, YOU score). Slate is the ghost's colour.
Map colours live separately in `src/holeMap.jsx` (`GREEN`, `RED`, `GOLD`, `BG`, `SLATE`) and should
be unified with `C` if tokens move.

## 6. Load-bearing — do not change in a redesign
- `computeGhost` and `evalMatch` (scoring). Frozen. Confirm byte-identical before every commit.
- The **ghost is a status line** on the Caddie card, never an input. `src/caddie.test.js` #10.
- Every Caddie why-line **cites a profile number**. Copy rules: second person, present tense, no
  exclamation points, numbers not adjectives. The templates are in `src/caddie.js`; changing words
  is fine, changing which number is cited is not.
- Two screens with a toggle (Brett's call, Sep 19). A round opens on the Caddie.
- localStorage keys and shapes (`bogeyman-matches:v1`, `:history:v1`, `:tombstones:v1`,
  `:caddie-flags:v1`, `:greens:v1`, `:geo:v1:{apiId}`, `course_cache_{id}`, tile cache
  `bogeyman-tiles-v1`). Cloud merge semantics (union by id, last-write-wins).
- Offline-first: the service worker shell, the tile cache, the geometry cache. Anything new that
  fetches must degrade honestly with no signal.
- The deploy loop: bump `BUILD` + `sw.js` cache together, `./build.sh`, show a diff, wait for "go".

## 7. Free to change
- All layout, spacing, type scale, colour tokens, iconography, motion, component structure.
- Which screen owns what, as long as Play stays reachable in one tap from the Caddie and vice versa.
- The Play screen's no-scroll constraint is a *consequence* of its current content, not a rule.
- Setup's information architecture (it has grown: history button, course search, state filter,
  differential + source label, ghost preview, hole-map line, satellite line, START).
- The `Chip` primitive and the ad-hoc pills (`togglePill`, flag chips, alt chips) — good candidates
  for one system.
- Splitting `app.jsx` into files. esbuild bundles anything under `src/`; keep `app.jsx` the entry.

## 8. Things I noticed while building that a redesign should address
1. **Caddie screen is long on a phone.** Map + phase + chips + input + lie + flags + card + alts +
   nav ≈ 1.6 screens at 375×812. The card (the point of the screen) is below the fold on the tee.
   Candidates: collapse flags into an overflow, shrink the input when GPS owns it, or make the map
   a fixed header with the rest scrolling beneath.
2. **Two status chips + a status line** (`GPS ±5 m`, `OSM green`, hole-map text) compete for the
   same row. They matter only when something is wrong.
3. **The 46-px distance input** reads as the headline even when it is GPS-filled; the club name in
   the card is the actual headline. Hierarchy is inverted.
4. **Play header and Caddie header** are near-identical by construction (same slot for the
   toggle). A redesign could make the toggle a segmented control or a swipe.
5. **Setup's course card** now stacks four lines of 11-px status text. It needs a proper status
   block or a pre-round checklist affordance ("ready for offline ✓").
6. **History** and **Summary** predate the Caddie and have their own idioms (MiniStat, ScoreCard).
7. Inline styles everywhere means no hover/active/focus states; buttons rely on colour only.
8. Zone colours (`ZONE_COLOR`) and the map's trouble colours are close to `C.red`/`C.green`
   but not the same values.
9. Safe areas are handled per-screen with `env(safe-area-inset-*)` padding; consistent but
   repeated.

## 9. How to verify at a phone viewport (no phone needed)
```bash
npm install && ./build.sh                 # index.html
python3 -m http.server 8765 --bind 127.0.0.1   # from the repo root; the in-app browser can open it
npm test                                 # 43 node tests; must stay green
```
Open `http://127.0.0.1:8765/index.html` in the in-app browser at **375×812**. The app persists
state in localStorage, so seed a round and reload:
```js
localStorage.clear();
const pars=[4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4], yds=[415,520,165,430,108,185,560,380,445,410,140,545,395,360,200,415,505,470], si=[7,3,15,1,17,13,5,11,9,8,18,4,10,14,16,2,6,12];
const course={id:'xa17vk0a:male:0',apiId:'xa17vk0a',lat:34.301726,lon:-84.060013,name:'Hampton Golf Village',tee:'Blue',rating:71.2,slope:128,par:72,holes:pars.map((p,i)=>({par:p,si:si[i],yards:yds[i]}))};
const scores=Array(18).fill(null); scores[1]=5;                     // ≥1 score so the round resumes
localStorage.setItem('bogeyman-matches:v1', JSON.stringify({screen:'caddie',course,diff:8.2,scores,hole:0,roundId:null,caddie:{wet:false,wind:false}}));
```
Hole geometry: Overpass rate-limits by IP. To avoid it, build a cache seed from the committed fixture
and load it (from the repo root):
```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { parseOverpass, compactGeometry } from "./src/geometry.js";
const g = compactGeometry(parseOverpass(JSON.parse(readFileSync("src/fixtures/hampton-overpass.json","utf8"))));
writeFileSync("build/geo-seed.json", JSON.stringify({ ...g, fetchedAt: Date.now() }));'   # build/ is gitignored and served
```
```js
const g = await (await fetch('/build/geo-seed.json')).json();
localStorage.setItem('bogeyman-matches:geo:v1:xa17vk0a', JSON.stringify(g));   // then reload
```
Fake GPS: the in-app browser denies geolocation, and the JavaScript tool runs in an isolated world,
so inject the override with a `<script>` element and then tap the GPS chip so the hook re-subscribes:
```js
const sc = document.createElement('script');
sc.textContent = `window.__gpsPos={lat:34.301161,lon:-84.060017,acc:5};
window.__fire=function(){ if(window.__gpsCb) window.__gpsCb({coords:{latitude:window.__gpsPos.lat,longitude:window.__gpsPos.lon,accuracy:window.__gpsPos.acc},timestamp:Date.now()}); };
Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:function(ok){window.__gpsCb=ok;setTimeout(window.__fire,50);return 1;},clearWatch:function(){},getCurrentPosition:function(ok){ok&&window.__fire();}}});`;
document.head.appendChild(sc);
[...document.querySelectorAll('button')].find(b=>/Location off|Finding GPS|GPS/.test(b.textContent)).click();
```
Hampton hole 1 positions (lat, lon): tee `34.301161, -84.060017` · 140 out `34.302661, -84.057968`
· 30 out `34.30326, -84.057148` · on the green `34.303406, -84.056949`. Move by setting
`window.__gpsPos` and calling `window.__fire()` from another injected script.

The map exposes `window.__ghostMap` (a MapLibre `Map`) for inspection. If the canvas looks blank
right after load, that was a real race fixed in v19 (`triggerRepaint` on moveend/idle) — if it
comes back, that is the place to look.

The service worker does not register in the in-app browser ("unknown error fetching the script");
that is the browser, not `sw.js`. Test SW behaviour on the phone.

## 10. Sizes and constraints
- `index.html` 257 KB gzipped (React UMD + Firebase + app inlined). `vendor/maplibre-gl.js` 270 KB
  gzipped, loaded `defer`, cached by the SW shell. Both fine; do not inline MapLibre.
- MapTiler key is client-side and origin-locked to `brettryantalley-source.github.io` + localhost.
  A redesign that previews on any other host will get 403 tiles — that is expected.
- golfcourseapi has a 50/day cap on course search.

## 11. Open engine items (not for this thread, but do not paper over them in UI)
- Par-5 "reachable" branch undervalues going for it (`secondShot` in `src/caddie.js`); driver loses
  to 2-hybrid on short par 5s. Waiting on field data.
- `constants.parBase` is unused.
- Putts are typed; GPS cannot read feet. Brett asked whether marking the pin helps — it does not
  (position error ± pin error ≈ ±20 ft). A "paces" input mode was floated, not built.

## 12. Suggested shape for the redesign thread
1. Audit pass: screenshots of all five screens at 375×812 using §9, plus the Play → Caddie toggle.
2. Propose tokens + a component set (buttons, chips, cards, headers, sheets) before touching screens.
3. Rebuild screen by screen, Caddie first (it is the one Brett stares at on every shot), then Play,
   Setup, Summary, History. Ship each as its own version (v20, v20.1, …) through the normal loop.
4. `npm test` and the frozen-function check before every commit; Brett's "go" before every push.
