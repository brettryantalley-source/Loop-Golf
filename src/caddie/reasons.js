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

/* ---------- v22.18 (C1, D91): the "why" line on the map ---------- */

/*
 * One printed line under the call, always on screen (R1, Brett Oct 4: "Full" — the main reason, plus
 * today's adjustment when there is one). Built only from resolved fields: recommend()'s `why` facts
 * (engine.js whyFacts), the options' own numbers, and the within-round nudges' fields (learning.js).
 * C4's heads-up will become its last clause.
 */

const WEDGE_IDS = new Set(["PW", "GW", "SW", "LW"]);

/** "Driver", "7-iron", "2-hybrid", "PW"; "(finesse)" for a part swing. `mid` = mid-sentence ("the driver"). */
export function clubName(o, { mid = false } = {}) {
  if (!o) return "";
  const id = o.club;
  let n = WEDGE_IDS.has(id) ? id : o.label || id || "";
  if (mid && !WEDGE_IDS.has(id)) n = n.charAt(0).toLowerCase() + n.slice(1);
  if (o.swingType === "finesse") n += " (finesse)";
  return mid ? `the ${n}` : n;
}

const pctText = (p) => `${Math.round(p * 100)}%`;

/** 0.33 → "1 in 3"; above one in two → "6 in 10". */
export function oneIn(p) {
  if (!(p > 0)) return null;
  return p <= 0.5 ? `1 in ${Math.round(1 / p)}` : `${Math.round(p * 10)} in 10`;
}

function lieWords(lieType, lieQuality) {
  if (lieType === "recovery") return "the trees";
  if (lieQuality === "buried") return "a buried lie";
  if (lieQuality === "bad") return "a bad lie";
  return "here";
}

function holeWords(hs) {
  if (!hs.length) return "";
  if (hs.length === 1) return String(hs[0]);
  return `${hs.slice(0, -1).join(", ")} and ${hs[hs.length - 1]}`;
}

/** Today's clause for this club: the within-round nudge for its family (else its lie), or null. */
export function todayClause(nudges, club, family) {
  const list = (nudges || []).filter((n) => n && n.group && (n.dist || n.dirn));
  const n = list.find((x) => x.group.kind === "family" && x.group.key === family) || list.find((x) => x.group.kind === "lie");
  if (!n) return null;
  const fix = [];
  if (n.dist) {
    const steps = Number.isFinite(n.shiftYds) && n.gapYds > 0 ? Math.round((Math.abs(n.shiftYds) / n.gapYds) * 2) / 2 : 0;
    const longer = n.dist === "short";
    fix.push(steps >= 0.5 ? (longer ? "clubbed up" : "clubbed down")
      : `playing it ${Math.round(Math.abs(n.shiftYds || 0))} yds ${longer ? "longer" : "shorter"}`);
  }
  if (n.dirn) fix.push(n.dirn === "left" ? "aiming right-center" : "aiming left-center");
  const word = [n.dist, n.dirn].filter(Boolean).join("-");
  const where = n.holes?.length ? ` on ${holeWords(n.holes)}` : "";
  return { text: `${fix.join(", ")}: ${word} ${n.phrase}${where} today`, fields: { group: n.group, dist: n.dist, dirn: n.dirn, holes: n.holes, shiftYds: n.shiftYds } };
}

/** SAFE's main clause from recommend()'s `why` facts. */
function safeClause(res) {
  const s = res.safe, w = res.why || {}, alt = w.alt;
  const name = clubName(s);
  const clean = Number.isFinite(w.noHeroMaxTrouble) ? Math.round((1 - w.noHeroMaxTrouble) * 10) : 9;
  switch (w.rule) {
    case "no-hero": {
      const from = lieWords(w.lieType, w.lieQuality);
      if (w.punchOut) return `Punch out: from ${from}, nothing stays clean ${clean} times in 10`;
      return `${name}: from ${from}, it stays clean ${clean} times in 10${alt && alt.club !== s.club ? `; ${clubName(alt, { mid: true })} doesn't` : ""}`;
    }
    case "pin-front":
    case "pin-back": {
      const to = /fat side/.test(s.target?.label || "") ? "the fat side" : "the middle";
      const short = Number.isFinite(w.shortPct) && w.shortPct >= 0.2 ? `, and you finish short ${oneIn(w.shortPct)}` : "";
      return `${name} to ${to}: ${w.pin} pin${short}`;
    }
    case "pin-middle":
      return w.attack ? `${name} at the flag: middle pin, wedge in hand` : `${name} to the middle: only wedges go at the flag`;
    case "driver": {
      const more = alt && Number.isFinite(alt.leaveYds) && Number.isFinite(s.leaveYds) ? alt.leaveYds - s.leaveYds : null;
      if (!alt) return `Driver: a tie on score goes to the driver`;
      return more != null && more >= 5 ? `Driver: ${clubName(alt, { mid: true })} scores the same and leaves ${more} yds more`
        : `Driver: ${clubName(alt, { mid: true })} scores the same`;
    }
    case "par": {
      // the par ranking chose by less than a printed point: nothing worth naming the other shot for
      if (!alt || pctText(alt.parProb) === pctText(s.parProb)) return `${name}: best chance at par from here, ${pctText(s.parProb)}`;
      const other = alt.club === s.club && alt.swingType === s.swingType ? "the other line" : clubName(alt, { mid: true }).replace(/^the /, "");
      return `${name}: best chance at par, ${pctText(s.parProb)} (${other} ${pctText(alt.parProb)})`;
    }
    default:
      return `${name}: best chance at par from here, ${pctText(s.parProb)}`;
  }
}

/**
 * The line for the option on screen: { text, rule } or null (no call, or Custom — C4's aim warning
 * owns Custom). opts: { opt: "safe" | "aggressive", custom, family (club → family), sameAvgDelta }.
 */
export function whyLine(res, { opt = "safe", custom = false, family = () => null, sameAvgDelta = 0.05 } = {}) {
  if (!res?.safe || custom) return null;
  const aggr = opt === "aggressive" && !res.sameShot && res.aggressive;
  const o = aggr ? res.aggressive : res.safe;
  let main, rule;
  if (aggr) {
    const d = Number.isFinite(o.deltaExp) ? o.deltaExp : o.expScore - res.safe.expScore;
    const avg = Math.abs(d) < sameAvgDelta ? "same average" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} strokes`;
    main = `${clubName(o)}: best birdie chance, ${pctText(o.birdieProb)} (${avg})`;
    rule = "aggressive";
  } else {
    main = safeClause(res);
    rule = res.why?.rule || null;
  }
  const today = todayClause(res.nudges, o.club, family(o.club));
  return { text: `${main}${today ? ` · ${today.text}` : ""}.`, rule, today: today ? today.fields : null };
}
