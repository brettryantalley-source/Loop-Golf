# HANDOFF — Bogeyman Matches (v6 build, picking up mid-stream)

> **Archived.** The app was called Bogeyman Matches, then Ghost Match; it is now
> **Loop Golf**. The repo is `brettryantalley-source/Loop-Golf`, lives at
> `~/Developer/Loop-Golf`, and is live at
> https://brettryantalley-source.github.io/Loop-Golf/ . Names and paths in the
> text below are the ones that were current at the time. Kept for the record.


You are picking up a project mid-stream. This file is the complete context — the prior
conversation happened on another machine and does not carry over. Read it fully, then follow
the CONSOLIDATION steps before writing any code.

## BACKGROUND: WHAT HAPPENED THIS WEEK
Bogeyman Matches is a self-contained single-page golf side-game PWA (React, no framework),
deployed as a static site on GitHub Pages, installed on Brett's iPhone. Repo:
brettryantalley-source/Bogeyman-Matches. Live: https://brettryantalley-source.github.io/Bogeyman-Matches/
A v6 build was spec'd. During planning we discovered the project existed as TWO clones of the
same GitHub repo: an iCloud "Claude/" clone that had never run `git fetch` and was frozen at
v4, and this "ClaudeCode/" clone at v5. The stale iCloud clone caused a false conclusion that
the "sheet differential" feature was never built. In reality it SHIPPED as v5 (commit 0ed33dc).
Lesson baked into this handoff: git syncs machines, not iCloud; always `git fetch` and check
origin/main before judging what exists.

## TWO GATING DECISIONS (resolved by Brett)
1) WORKING COPY: Use THIS ClaudeCode/ clone as the SINGLE working copy going forward. It's at
   v5 (0ed33dc), clean, no iCloud junk. Sync between machines via GIT, not iCloud. Do NOT
   develop in two folders again.
2) V6 SCOPE: Build ON TOP of v5. The sheet differential already shipped in v5 — do NOT rebuild
   it. v6 = exactly two things:
     (a) Live golfcourseapi.com course search replacing the hardcoded COURSES library
         (+ tee picker, per-course caching, error states).
     (b) The one-screen setup refactor (START never behind a scroll).
   Everything else stays intact: computeGhost/evalMatch are FROZEN; the v5 differential block
   (CSV fetch, avg-of-last-5, source label, manual override, USE SHEET revert) is PRESERVED —
   refactor the layout AROUND it, do not rewrite it; the round lifecycle (Finalize->Summary,
   scorecard, inline edit, W-L-T record, History) and all localStorage schemas stay.

## CONSOLIDATION — DO THESE FIRST, IN ORDER
1. `git fetch`; verify HEAD = origin/main (v5, 0ed33dc) and the working tree is clean. If
   local is ahead/behind, reconcile before touching code.
2. Save this entire block as HANDOFF.md IN THIS CLONE (so the reference lives in git, not iCloud).
3. Retire the iCloud clone at
   "~/Library/Mobile Documents/com~apple~CloudDocs/Claude/Bogeyman-Matches": it's at v4, behind
   the remote, with no uncommitted tracked work — nothing there is unique except an older copy
   of this handoff (Brett is keeping that one as a backup for now). Never develop there again.
4. Read the ACTUAL v5 src/app.jsx to see how the differential is really implemented — the
   one-screen refactor must reuse that code as-is, so know its shape before you move it.
5. Then build v6 per the plan below.

## VERIFIED golfcourseapi.com FACTS (tested live from the real origin; do not re-derive)
Confirmed from https://brettryantalley-source.github.io. CORS is open — call directly from the
browser. Rate limit 50 req/day — debounce, require >=2 chars, don't test-spam (~4 already used).
  - Base: https://api.golfcourseapi.com/v1   Header: Authorization: Bearer Y2KP2ACTI2YKKBK5UAR244RBKA
  - Search: GET /v1/search?search_query={q}&fuzzy_match=true
      -> { courses: [ {id, club_name, course_name, location:{city,state,...}, tees:{...}}, ... ] }
  - Full course: GET /v1/courses/{id}
      -> { course: { id, club_name, course_name, location, tees: { female:[...], male:[...] } } }
      TEES ARE NESTED under tees.male / tees.female (arrays), NOT a flat array (original spec
      was wrong). Flatten both into one picker list; disambiguate duplicate names by rating/
      slope; skip any tee whose holes.length !== 18. A club can have many tees (Woodmont id
      6939: 9 male, 6 female).
      Each tee: { tee_name, course_rating, slope_rating, total_yards, par_total, holes:[18] }
      Each hole: { par, yardage, handicap }
  - FIELD MAPPING (do NOT rename): hole.handicap -> si (stroke index, feeds computeGhost);
      hole.yardage -> yards (scorecard yardage row reads h.yards); course_rating -> rating,
      slope_rating -> slope, par_total -> par.
      Engine course object shape stays: { id, name, tee, rating, slope, par, holes:[{par, si, yards}] }

## REFERENCE ONLY — sheet differential (ALREADY LIVE in v5; do NOT rebuild)
  - CSV URL: https://docs.google.com/spreadsheets/d/e/2PACX-1vRzaFF9AvD61Y6iWgCyeEVm_bCG2DVW8waalO3Fdom3tFiIC3vmGv_Oqe_9xJQikMvQexT9sTIEu7hQ/pub?output=csv
    (ambiguous char is a CAPITAL I: ...tFiIC3vm...)
  - Columns: Date, Differential, Course, Tees, Score, Course Rating, Slope, Diff check (optional), Notes
  - Confirmed math: sort rows by Date descending -> take the 5 most recent -> average their
    Differential -> round to 0.1. (Current data averages to 6.9.) Open CORS, 200.
  - If v5's implementation differs, v5's shipped behavior wins unless Brett says otherwise.

## V6 BUILD PLAN (src/app.jsx — targeted edits on the v5 base)
  - Delete the mk helper + the entire hardcoded COURSES array; no reference to the old library
    may remain anywhere.
  - Add course-source helpers:
      * searchCourses(query, signal) -> GET /search, return courses.
      * courseCacheKey(id) = `course_cache_${id}`; loadFullCourse(id): cache hit (localStorage)
        => return, NO network Call 2; miss => GET /courses/{id}, cache the course object, return
        it; THROW on failure (drives the retry error state).
      * teeOptions(fullCourse) -> flatten tees.male + tees.female into
        [{key:'male:0', gender, tee}, ...], skipping tees with holes.length !== 18.
      * buildCourse(fullCourse, teeOpt) -> engine course object using the field mapping above.
  - Rewrite Setup as ONE screen: flex column, height:100dvh, overflow:hidden, START pinned at
    bottom (flex-shrink:0), middle content flex:1 minHeight:0. Stack top->bottom:
      header(+BUILD tag) · compact record/HISTORY row (if stats.n>0) · course search input
      ("Search for a course…") with results as an ABSOLUTELY-positioned dropdown (max 5, must
      NOT push START down) · tee picker (native select, appears only after Call 2 resolves) ·
      the EXISTING v5 differential block (reused, just placed in the new layout) · optional
      compact ghost preview (only when course+tee chosen) · START (disabled until course AND
      tee selected).
    Search box starts EMPTY on load; do NOT pre-populate from the course cache. Debounce ~350ms,
    require length>=2, use AbortController to cancel stale requests.
  - Error copy (EXACT): no results -> "No courses found — try a different name or spelling."
    search fails -> "Course search unavailable — check your connection." Call 2 fails ->
    "Couldn't load course data — tap to retry." (do NOT advance to the tee picker on Call 2 fail).
  - Persistence/App: replace courseId (index into the deleted COURSES) with the resolved course
    object. Restore an in-progress round only when screen is play/summary AND the saved course
    passes a validCourse() check (18 holes w/ par+si); else fresh setup. start(course, diff)
    sets course+diff then screen=play. Guard ghost = course ? computeGhost(course,diff) : null
    (course is null during setup). Keep the v5 differential flow exactly.
  - buildRecord: store per-hole yardage:
      yardages: course.holes.map(h => typeof h.yards === "number" ? h.yards : null)
    (Summary scorecard already renders the yardage row via
    hasYardage = course.holes.some(h => typeof h.yards === "number"); API yardage makes it appear.)
  - sw.js: verify a same-origin guard exists; if not, add near the top of the fetch listener:
      if (new URL(req.url).origin !== self.location.origin) return;
    so live cross-origin API/CSV calls always hit the network (never served stale from SW cache).
  - Version bump v5 -> v6, BOTH in the same commit:
      BUILD = "v6 · Jul 23"  (ask Brett: literal spec string vs actual build date)
      sw.js CACHE = 'bogeyman-matches-v6'  (from -v5)

## BUILD + VERIFY
  - ./build.sh regenerates index.html (esbuild + python3 assemble). esbuild was NOT on PATH in
    the prior env — check `which esbuild`; if missing, `brew install esbuild` OR make build.sh
    fall back to `npx esbuild` (ASK BRETT which). react UMD is cached in build/.
  - Load index.html in a phone-sized browser viewport and run the checklist. Real API + sheet
    work from the browser (CORS open) — mind the 50/day API cap.

## VERIFICATION CHECKLIST
  [ ] Type a course name -> results appear -> select -> tee picker populates
  [ ] Select a tee -> START enables
  [ ] Complete a round -> Finalize -> scorecard shows yardage row
  [ ] Re-select a cached course -> tee picker populates with NO network Call 2
  [ ] Differential still auto-pulls from sheet with source label (v5 behavior intact)
  [ ] Manual differential override still works; USE SHEET still reverts
  [ ] W-L-T record still displays/updates; History screen works
  [ ] Build tag reads "v6 · Jul 23"; sw.js cache is bogeyman-matches-v6
  [ ] No reference to the old hardcoded course library anywhere
  [ ] One screen, START never behind a scroll (small phone viewport)

## DEPLOY (per CLAUDE.md — do NOT skip)
  1. Edit src/app.jsx -> 2. ./build.sh -> 3. version markers bumped (both) -> 4. SHOW BRETT A
  DIFF -> 5. WAIT for his explicit "go" before git commit/push -> 6. Pages redeploys same URL
  (~1 min); Brett closes+reopens the PWA to load the new service worker.

## BEFORE WRITING COURSE-SEARCH CODE, ASK BRETT
  (a) esbuild via `brew install` or `npx esbuild` fallback?
  (b) build tag literal "v6 · Jul 23" or today's actual date?
  (c) confirm no live in-progress round he cares about (deleting COURSES resets any in-progress
      round; history is safe regardless).

## HOUSEKEEPING
  - The iCloud clone has sync-duplicate junk (index 2.html, sw 2.js, README 2.md, .gitignore 2,
    icon-512 2.png, broken ref "main 2"). Ignore; never commit or build from them.
  - Also read CLAUDE.md in the repo for the project's standing rules (deploy loop, frozen engine,
    course data format, persistence keys, "show a diff and wait for go before pushing").

## PHASE 2 — CLOUD ROADMAP (AFTER v6 ships; scope WITH Brett, don't build blindly)
Brett's near-term choice: STAY A SIMPLE HOSTED PWA — no new hosting, no backend — while
finishing the app. Two durable goals to design toward later:
  1. DURABLE STATS — round history + W-L-T must survive a browser cache wipe. Today they live
     ONLY in localStorage (bogeyman-matches:history:v1), which a cache clear erases. Needs a
     lightweight cloud datastore.
  2. FRIENDS ON THEIR OWN PHONES — the public URL already lets friends load it; the gap is
     per-person records so each friend keeps their own history/stats and Brett's aren't mixed
     in. Implies a LIGHT identity (a name or per-device id), NOT full password accounts.
Candidate low-friction backends to weigh later (pick ONE with Brett): Supabase or Firebase
(free tier, simple SDK + optional light auth); Cloudflare Workers + KV/D1; or a Google Apps
Script appending rounds to a Sheet (stays in Brett's existing Sheets ecosystem — he already
publishes the differential sheet). Keep any migration ADDITIVE: localStorage stays as an
offline cache, cloud read/write layers on top, existing history schema preserved. NOT NOW:
real auth/passwords, payments, anything heavy.
