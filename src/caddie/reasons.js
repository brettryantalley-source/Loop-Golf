/*
 * reasons.js — one-line reasons generated from profile fields, never free text (spec rule 8,
 * §3.10, T10). A template names its tokens; every token is a field of the resolved entry
 * (profile.js ENTRY_FIELDS + label + sourceLie). The output carries `fields` — the raw values
 * used — so a test can check each one against the profile.
 *
 * No shot-shape word ever appears here: the engine does not recommend shape (rule 6).
 */

/** Ordered templates. The first whose tokens all resolve to non-null values wins. */
export const TEMPLATES = [
  { tokens: ["label", "lateralSdDeg", "penaltyCount", "n"],   text: "{label}: {lateralSdDeg}° spread, {penaltyCount} penalties in last {n}" },
  { tokens: ["label", "girPct", "medianProximityFt", "sourceLie", "n"], text: "{label}: {girPct} GIR, {medianProximityFt} ft median from {sourceLie} (n {n})" },
  { tokens: ["label", "lateralSdDeg", "shortPct", "n"],       text: "{label}: {lateralSdDeg}° spread, {shortPct} short (n {n})" },
  { tokens: ["label", "lateralSdDeg", "totalMedianYds"],      text: "{label}: {lateralSdDeg}° spread, {totalMedianYds} median" },
  { tokens: ["label", "totalMedianYds"],                      text: "{label}: {totalMedianYds} median" },
];

const PCT_FIELDS = new Set(["girPct", "shortPct", "leftPct", "rightPct", "penaltyPct", "recoveryPct", "bigMissPct", "mishitPct"]);

function fieldValue(entry, token) {
  if (token === "label") return entry.swing === "finesse" ? `${entry.label} (finesse)` : entry.label;
  // Penalties are a tee-club story (Shot Pattern counts them off the tee); an iron's "0 penalties"
  // says nothing, so the approach templates take over for the other families.
  if (token === "penaltyCount" && entry.family !== "long") return null;
  if (token === "sourceLie") return entry.provenance.girPct?.lie ?? entry.sourceLie;
  if (token === "lateralSdDeg") return entry.lateralSdDeg;
  return entry.fields[token];
}

function fmt(token, v) {
  if (PCT_FIELDS.has(token)) return `${Math.round(v * 100)}%`;
  if (token === "lateralSdDeg") return `${Math.round(v * 10) / 10}`;
  return `${v}`;
}

/** { text, fields } for a resolved entry. `fields` maps token → raw value. */
export function reasonFor(entry) {
  for (const t of TEMPLATES) {
    const vals = {};
    let ok = true;
    for (const tok of t.tokens) {
      const v = fieldValue(entry, tok);
      if (v == null) { ok = false; break; }
      vals[tok] = v;
    }
    if (!ok) continue;
    const text = t.text.replace(/\{(\w+)\}/g, (_, tok) => fmt(tok, vals[tok]));
    return { text, fields: vals, template: t.text };
  }
  return { text: `${entry.label}`, fields: { label: entry.label }, template: "{label}" };
}
