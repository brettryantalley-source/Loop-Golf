# data — the caddie's source material

Three layers. Each is built only from the one before; nothing is typed straight into the profile.

| Layer | Where | Rule |
|---|---|---|
| 1. Raw | `raw/<batch-date>/` | Originals, never edited. Screenshots renamed `NN_HHMMSS.png` (capture order, capture time). |
| 2. Extracted | `extracted/<batch-date>-screens.json`, `-report.txt` | Verbatim transcription. Every screen carries `resolvedFilters` + `filterSource` (seen / inherited / inferred / excluded). Filters are confirmed by Brett per batch. |
| 3. Profile | `src/profile.json` (bundled, not fetched) | Built by script from layer 2 (Caddie S1). Never hand-edited. |

- A filter carries forward until a screenshot shows a new one.
- PDF text beats a screenshot where both exist: it is exact.
- Conflicting values stay side by side with their filters; the build picks by a written rule, never by averaging.
- Loop's own shot log never feeds this folder (spec §5.2).

## Batches
| Batch | Contents | Filters |
|---|---|---|
| 2026-09-27 | 59 screenshots + 16-page Stats Report PDF | Casual · Last 10 (Jun 27 – Sep 20) except screens 01–03 = Last 5. Confirmed 2026-09-28. |
