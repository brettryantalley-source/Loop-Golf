# docs — which file is current

| File | Use it for | Status |
|---|---|---|
| `HANDOFF-design-NEXT.md` | The brief to paste into a **UI/UX** thread for a new feature. Carries the full brand, the constraints and what to hand back. Add the feature at the top before pasting. | current |
| `DEVLOG.md` | Version history, newest first. Append, never rewrite. | living |
| `../loop-design/` | The design source: `SPEC.md`, the two approved reference screens as standalone HTML + 2× PNGs, the pencil filter, the logo. What v21 was built from. | reference |
| `SPEC-caddie.md` | The locked spec for the caddie engine, shot log and learning loop (S1–S5). What the overnight Sep 28–29 build implements. | current |
| `SPEC-caddie-UI.md` | UI addendum v1 to the caddie spec — the caddie screen, shot-log capture flow, dispersion ellipse data (§5.4). | current |
| `PROFILE-v2.md` | Schema and build contract for `src/profile.json` v2, built by `scripts/build-profile.mjs`. Never hand-edit the JSON. | current |
| `DECISIONS-caddie.md` | Calls made during the overnight caddie build that override the spec. Read before touching `src/caddie/`. | current |
| `HANDOFF-design-caddie-LATER.md` | Caddie + Hole View content and copy, from when the Caddie left the UI at v21. Superseded by `SPEC-caddie-UI.md` for anything it also covers; keep for copy not in the addendum. | superseded |
| `HANDOFF-caddie.md` | Context for the parked v1 Caddie build (deleted overnight — see `DECISIONS-caddie.md` D9). Keep for the MapTiler key table (§4.3); the engine content is superseded by `SPEC-caddie.md`. | superseded |
| `FIELD-TEST-v19.md` | On-course checklist for the v1 Caddie + Hole View, which is gone. Reference only if a v2 field-test doc is written from it. | reference |
| `archive/` | Handoffs for work that has shipped. `HANDOFF-v6.md` → v6 · `HANDOFF-auto-differential.md` → v14 · `HANDOFF-design.md` and `HANDOFF-redesign.md` → the v21 paper redesign. | history |

Rules that keep the threads aligned live in `../CLAUDE.md`.
