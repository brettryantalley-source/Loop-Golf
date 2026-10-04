# data — the caddie's source material

Three layers. Each is built only from the one before; nothing is typed straight into the profile.

| Layer | Where | Rule |
|---|---|---|
| 1. Raw | `raw/<batch-date>/` | Originals, never edited. Screenshots renamed `NN_HHMMSS.png` (capture order, capture time). |
| 2. Extracted | `extracted/<batch-date>-screens.json`, `-report.txt` | Verbatim transcription. Every screen carries `resolvedFilters` + `filterSource` (seen / inherited / inferred / excluded). Filters are confirmed by Brett per batch. |
| 3. Profile | `src/profile.json` (bundled, not fetched) | Built by `scripts/build-profile.mjs` from layer 2 (Caddie S1, done overnight Sep 28–29). Never hand-edited. Contract: `docs/PROFILE-v2.md`. `node scripts/build-profile.mjs --check` verifies the committed file matches a fresh build. |

- A filter carries forward until a screenshot shows a new one.
- PDF text beats a screenshot where both exist: it is exact.
- Conflicting values stay side by side with their filters; the build picks by a written rule, never by averaging.
- Loop's own shot log never feeds this folder (spec §5.2).
- A recording batch: each still is named `NNNN_TTT.TTs.jpg` (pick number, time in the recording); the transcription names the recording and frames each block came from.

## Batches
| Batch | Contents | Filters |
|---|---|---|
| 2026-10-04 | 17-page Stats Report PDF (`raw/2026-10-04/stats-report-last10.pdf` → `extracted/2026-10-04-report.txt`) + 12 screen recordings, transcribed to `extracted/2026-10-04-screens.json` (keyed by meaning, not screen number); the videos are not kept — `raw/2026-10-04/rec-HHMMSS/` holds the 340 settled stills the values were read from. `extracted/2026-10-04-ell80.json`: fairway 80% patterns for 10 clubs, fitted by `scripts/fit-ell80.py` from those stills. **The profile's only source from Oct 4 (D85).** | Casual · Last 10 (Jul 26 – Oct 3), seen on screen per recording; club sheets inferred Last 10 from n/SG matching the PDF. Confirmed by Brett 2026-10-04. |
| 2026-10-04 (Tangent) | `extracted/2026-10-04-tangent-gapfill.md` — the Golf project's read of the pre-6/18 Tangent screens against the D85 gap list. Record only: not read by the build (no dates, counts, carry or lie split). | None printed. |
| 2026-09-27 | 59 screenshots + 16-page Stats Report PDF — history, no longer read by the build | Casual · Last 10 (Jun 27 – Sep 20) except screens 01–03 = Last 5. Confirmed 2026-09-28. |
| 2026-09-19 | (history, no longer read) `extracted/2026-09-19-ell80.json` — Shot Pattern 80% dispersion ellipses for PW, 9i, 2Hy, 4Hy, transcribed from `docs/SPEC-caddie-UI.md` §5.4 (UI addendum). No raw screenshots in `raw/` for this one — transcribed straight from the addendum. | Casual · Last 5, all lies. 2Hy and 4Hy are `confidence: "low"` (screen scrolled, top of ellipse estimated). Remaining clubs (Dr, 2i, 5i–8i, GW, SW, LW, every finesse entry) are `pending`. |
