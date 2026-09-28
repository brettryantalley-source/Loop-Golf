#!/usr/bin/env node
/*
 * build-profile.mjs — builds src/profile.json (v2) from data/extracted/*.
 *
 * Every number in the output is parsed from data/extracted/2026-09-27-report.txt (exact PDF text)
 * and data/extracted/2026-09-27-screens.json (screenshot transcriptions), plus the small ell80
 * addendum data/extracted/2026-09-19-ell80.json. See docs/PROFILE-v2.md for the contract.
 *
 * Usage:
 *   node scripts/build-profile.mjs           # writes src/profile.json
 *   node scripts/build-profile.mjs --check   # exits 1 if src/profile.json differs from a fresh build
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, CLUB_FAMILY } from "../src/caddie/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const REPORT_PATH = path.join(ROOT, "data/extracted/2026-09-27-report.txt");
const SCREENS_PATH = path.join(ROOT, "data/extracted/2026-09-27-screens.json");
const ELL80_PATH = path.join(ROOT, "data/extracted/2026-09-19-ell80.json");
const OUT_PATH = path.join(ROOT, "src/profile.json");

const ROLL_YDS = DEFAULT_CONFIG.ROLL_YDS;

/* ---------------------------------------------------------------------- */
/* generic helpers                                                        */
/* ---------------------------------------------------------------------- */

const MINUS_RE = /−/g; // − U+2212, used for negatives in the report text

function toNum(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(MINUS_RE, "-").replace(/[%,]/g, "").trim();
  if (cleaned === "" || cleaned === "N/A" || cleaned === "—" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function round(x, d) {
  if (x == null || Number.isNaN(x)) return null;
  const f = Math.pow(10, d);
  return Math.round(x * f) / f;
}

function frac(s) {
  const n = toNum(s);
  if (n == null) return null;
  return round(n / 100, 3);
}

function ftFromString(s) {
  // "10' 9\"" -> 10.75  (feet + inches/12)
  const m = /^(\d+)'\s*(\d+)"$/.exec(s.trim());
  if (!m) return null;
  return round(Number(m[1]) + Number(m[2]) / 12, 2);
}

/* ---------------------------------------------------------------------- */
/* club naming (literal mapping table — allowed by the contract)          */
/* ---------------------------------------------------------------------- */

const CLUB_ORDER = ["Dr", "2i", "2Hy", "4Hy", "5i", "6i", "7i", "8i", "9i", "PW", "GW", "SW", "LW"];

const CLUB_LABEL = {
  Dr: "Driver", "2i": "2-iron", "2Hy": "2-hybrid", "4Hy": "4-hybrid",
  "5i": "5-iron", "6i": "6-iron", "7i": "7-iron", "8i": "8-iron", "9i": "9-iron",
  PW: "Pitching wedge", GW: "Gap wedge", SW: "Sand wedge", LW: "Lob wedge",
};

// Shot Pattern's full club name, as printed in the report tables.
const REPORT_CLUB_NAME = {
  Dr: "Driver • Cobra Adapt",
  "2i": "2-Iron • Sub 70 699",
  "2Hy": "2-Hybrid • Sub 70 949 pro",
  "4Hy": "4-Hybrid • Cobra F6",
  "5i": "5-Iron • Sub 70 699 Pro",
  "6i": "6-Iron • Sub 70 699 Pro",
  "7i": "7-Iron • Sub 70 699 Pro",
  "8i": "8-Iron • Sub 70 699 Pro",
  "9i": "9-Iron • Sub 70 699 Pro",
  PW: "Pitching Wedge • Sub 70 699 Pro",
  GW: "Gap Wedge • Sub 70 TAIII",
  SW: "Sand Wedge • Sub 70 TAIII",
  LW: "Lob Wedge • Sub 70 TAIII",
};

// Shot Pattern's short club label, as printed on screens (case-insensitive).
const SCREEN_CLUB_ID = {};
for (const id of CLUB_ORDER) SCREEN_CLUB_ID[id.toLowerCase()] = id;

function screenClubId(label) {
  return SCREEN_CLUB_ID[String(label).toLowerCase()] || null;
}

/* ---------------------------------------------------------------------- */
/* load inputs                                                            */
/* ---------------------------------------------------------------------- */

const reportText = fs.readFileSync(REPORT_PATH, "utf8");
const screensDoc = JSON.parse(fs.readFileSync(SCREENS_PATH, "utf8"));
const ell80Doc = JSON.parse(fs.readFileSync(ELL80_PATH, "utf8"));

function screen(n) {
  const id = String(n).padStart(2, "0");
  return screensDoc.screens.find((s) => s.file.split("_")[0] === id) || null;
}

function findScreens(pred) {
  return screensDoc.screens.filter(pred);
}

/* ---------------------------------------------------------------------- */
/* report text: sequential section cursor                                 */
/* ---------------------------------------------------------------------- */

let cursor = 0;
function grab(startAnchor, endAnchor) {
  const s = reportText.indexOf(startAnchor, cursor);
  if (s < 0) throw new Error(`build-profile: anchor not found: ${JSON.stringify(startAnchor)}`);
  const from = s + startAnchor.length;
  const e = endAnchor ? reportText.indexOf(endAnchor, from) : reportText.length;
  if (endAnchor && e < 0) throw new Error(`build-profile: end anchor not found: ${JSON.stringify(endAnchor)}`);
  cursor = from;
  return reportText.slice(from, e < 0 ? reportText.length : e);
}

// Non-consuming look-ahead grab (does not move the shared cursor). Used for
// pieces of text that are re-scanned independently of the sequential walk.
function peek(startAnchor, endAnchor, from = 0) {
  const s = reportText.indexOf(startAnchor, from);
  if (s < 0) throw new Error(`build-profile: anchor not found: ${JSON.stringify(startAnchor)}`);
  const f = s + startAnchor.length;
  const e = endAnchor ? reportText.indexOf(endAnchor, f) : reportText.length;
  return reportText.slice(f, e < 0 ? reportText.length : e);
}

function rows(blockText, re) {
  const out = [];
  for (const raw of blockText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = re.exec(line);
    if (m) out.push(m);
  }
  return out;
}

const NUM = "[\\u2212-]?\\d+(?:\\.\\d+)?";
const PCT = "[\\d.]+";

/* ---------------------------------------------------------------------- */
/* §04 Driving — headline                                                 */
/* ---------------------------------------------------------------------- */

const drivingHeadline = peek("T O TA L T E E S H O T S", "BAG MAPPING");
const headlineRow = rows(
  drivingHeadline,
  new RegExp(`^(\\d+)\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%$`)
)[0];
if (!headlineRow) throw new Error("build-profile: driving headline row not found");
const teeShotsTotal = Number(headlineRow[1]);
const goodDrivePct = frac(headlineRow[2]);
const fairwaysHitPctOverall = frac(headlineRow[3]);
const intoTroublePct = frac(headlineRow[4]);

/* ---------------------------------------------------------------------- */
/* §04 BAG MAPPING (tee entries)                                          */
/* ---------------------------------------------------------------------- */

const bagMappingText = grab("BAG MAPPING", "GOOD DRIVES");
const BAG_MAPPING_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(\\d+)\\s*yds\\s+(\\d+)[\\u2013-](\\d+)\\s*yds\\s+(\\d+)\\s*yds\\s+(\\d+)\\s*yds$`
);
const bagMapping = {}; // reportName -> {n, median, p25, p75, width95, width90}
for (const m of rows(bagMappingText, BAG_MAPPING_RE)) {
  bagMapping[m[1]] = {
    n: Number(m[2]),
    median: Number(m[3]),
    p25: Number(m[4]),
    p75: Number(m[5]),
    width95: Number(m[6]),
    width90: Number(m[7]),
  };
}

/* ---------------------------------------------------------------------- */
/* §04 GOOD DRIVES                                                        */
/* ---------------------------------------------------------------------- */

const goodDrivesText = grab("GOOD DRIVES", "POOR DRIVES");
const FOUR_PCT_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%$`
);
const goodDrives = {};
for (const m of rows(goodDrivesText, FOUR_PCT_RE)) {
  goodDrives[m[1]] = {
    n: Number(m[2]),
    fairwaysHitPct: frac(m[3]),
    goodDrivePct: frac(m[4]),
    within40Pct: frac(m[5]),
    within70Pct: frac(m[6]),
  };
}

/* ---------------------------------------------------------------------- */
/* §04 POOR DRIVES                                                        */
/* ---------------------------------------------------------------------- */

const poorDrivesText = grab("POOR DRIVES", "STROKES GAINED BY CLUB");
const poorDrives = {};
for (const m of rows(poorDrivesText, FOUR_PCT_RE)) {
  poorDrives[m[1]] = {
    n: Number(m[2]),
    penaltyPct: frac(m[3]),
    recoveryPct: frac(m[4]),
    outside40Pct: frac(m[5]),
    outside70Pct: frac(m[6]),
  };
}

/* ---------------------------------------------------------------------- */
/* §04 STROKES GAINED BY CLUB (tee)                                       */
/* ---------------------------------------------------------------------- */

const sgByClubTeeText = grab("STROKES GAINED BY CLUB", "DISPERSION BIAS");
const SG_BY_CLUB_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(${NUM})\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%$`
);
const sgByClubTee = {};
for (const m of rows(sgByClubTeeText, SG_BY_CLUB_RE)) {
  sgByClubTee[m[1]] = { n: Number(m[2]), sgPerShot: round(toNum(m[3]), 2) };
}

/* ---------------------------------------------------------------------- */
/* §04 DISPERSION BIAS (driving)                                          */
/* ---------------------------------------------------------------------- */

const dispersionDrivingText = grab("DISPERSION BIAS", "SECTION 04 · DRIVING");
const DISPERSION_DRIVING_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})\\u00b0$`
);
const dispersionDriving = {};
for (const m of rows(dispersionDrivingText, DISPERSION_DRIVING_RE)) {
  dispersionDriving[m[1]] = {
    n: Number(m[2]),
    leftPct: frac(m[3]),
    rightPct: frac(m[4]),
    bigMissLeftPct: frac(m[5]),
    bigMissRightPct: frac(m[6]),
    mishitPct: frac(m[7]),
    lateralSdDeg: round(toNum(m[8]), 2),
  };
}

/* ---------------------------------------------------------------------- */
/* §04 STRATEGIC OPPORTUNITIES · PENALTY SITUATIONS                       */
/* ---------------------------------------------------------------------- */

const penaltySituationsText = peek(
  "P E N A LTY S I T UAT I O N S",
  "R E C OV E RY & D E E P R O U G H"
);
const penaltyDrivesInsideCorridor = penaltySituationsText
  .split("\n")
  .filter((l) => /Penalty\s*$/.test(l.trim())).length;

/* ---------------------------------------------------------------------- */
/* §05 FROM TEE & FAIRWAY — BY CLUB / FROM ROUGH — BY CLUB                */
/* ---------------------------------------------------------------------- */

const teeFairwayByClubText = grab("FROM TEE & FAIRWAY — BY CLUB", "FROM TEE & FAIRWAY — BY DISTANCE");
const teeFairwayByDistanceText = grab("FROM TEE & FAIRWAY — BY DISTANCE", "FROM ROUGH — BY CLUB");
const roughByClubText = grab("FROM ROUGH — BY CLUB", "FROM ROUGH — BY DISTANCE");
const roughByDistanceText = grab("FROM ROUGH — BY DISTANCE", "DISPERSION BIAS — FROM TEE & FAIRWAY");

const BY_CLUB_APPROACH_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(${PCT})%\\s+(${NUM})\\s+(${PCT})%\\s+(${PCT})%\\s+(\\d+)\\s*ft$`
);
function parseByClub(text) {
  const out = {};
  for (const m of rows(text, BY_CLUB_APPROACH_RE)) {
    out[m[1]] = {
      n: Number(m[2]),
      girPct: frac(m[3]),
      sgPerShot: round(toNum(m[4]), 2),
      gainingPct: frac(m[5]),
      bigMissPct: frac(m[6]),
      medianProximityFt: Number(m[7]),
    };
  }
  return out;
}
const teeFairwayByClub = parseByClub(teeFairwayByClubText);
const roughByClub = parseByClub(roughByClubText);

const BY_DISTANCE_RE = new RegExp(
  `^(\\d+)-(\\d+)\\s*yds\\s+(\\d+)\\s+(${PCT})%\\s+(${NUM})\\s+(${PCT})%\\s+(${PCT})%\\s+(\\d+)\\s*ft$`
);
function parseByDistance(text, lie) {
  return rows(text, BY_DISTANCE_RE).map((m) => ({
    fromYds: Number(m[1]),
    toYds: Number(m[2]),
    lie,
    n: Number(m[3]),
    girPct: frac(m[4]),
    sgPerShot: round(toNum(m[5]), 2),
    gainingPct: frac(m[6]),
    bigMissPct: frac(m[7]),
    medianProximityFt: Number(m[8]),
    missPct: null,
  }));
}
const approachBucketsFairway = parseByDistance(teeFairwayByDistanceText, "fairway");
const approachBucketsRough = parseByDistance(roughByDistanceText, "rough");

/* ---------------------------------------------------------------------- */
/* §05 DISPERSION BIAS — FROM TEE & FAIRWAY                                */
/* ---------------------------------------------------------------------- */

const dispersionApproachText = grab("DISPERSION BIAS — FROM TEE & FAIRWAY", "S T R AT E G I C O P P O RT U N I T I E S");
const DISPERSION_APPROACH_RE = new RegExp(
  `^(.+?)\\s{2,}(\\d+)\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})\\u00b0$`
);
const dispersionApproach = {};
for (const m of rows(dispersionApproachText, DISPERSION_APPROACH_RE)) {
  dispersionApproach[m[1]] = {
    n: Number(m[2]),
    leftPct: frac(m[3]),
    rightPct: frac(m[4]),
    shortPct: frac(m[5]),
    lateralSdDeg: round(toNum(m[6]), 2),
  };
}

/* ---------------------------------------------------------------------- */
/* §06 Short Game — 0-25 / 25-50 YARDS BY LIE                              */
/* ---------------------------------------------------------------------- */

const shortGame025Text = grab("0–25 YARDS BY LIE", "25–50 YARDS BY LIE");
const shortGame2550Text = grab("25–50 YARDS BY LIE", "M I S S E D G R E E N S");
const SHORTGAME_LIE_RE = new RegExp(
  `^(Fairway|Rough|Bunker)\\s+(\\d+)\\s+(${NUM})\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})%\\s+(\\d+)\\s*ft$`
);
function parseShortGameLie(text) {
  const out = {};
  for (const m of rows(text, SHORTGAME_LIE_RE)) {
    out[m[1]] = {
      n: Number(m[2]),
      sgPerShot: round(toNum(m[3]), 2),
      upDownPct: frac(m[4]),
      inside3Pct: frac(m[5]),
      inside6Pct: frac(m[6]),
      missGreenPct: frac(m[7]),
      medianProximityFt: Number(m[8]),
    };
  }
  return out;
}
const shortGame025 = parseShortGameLie(shortGame025Text);
const shortGame2550 = parseShortGameLie(shortGame2550Text);

/* ---------------------------------------------------------------------- */
/* §07 PERFORMANCE BY DISTANCE (putting)                                  */
/* ---------------------------------------------------------------------- */

const puttingByDistanceText = grab("PERFORMANCE BY DISTANCE", "SG / 18:");
const PUTT_MAIN_RE = new RegExp(
  `^(\\S+)\\s+(\\d+)\\s+(${PCT})%\\s+(${NUM})\\s+(${PCT})%\\s+(${PCT})%\\s+(${PCT})\\s*ft\\s+(\\u2014|${PCT}%)$`
);
const PCT_ONLY_RE = /^(\d+(?:\.\d+)?)%$/;
const N_PAIR_RE = /^\((\d+)\/(\d+)\)$/;

function parseFtRange(tok) {
  const t = tok.replace(/'$/, "");
  if (t.endsWith("+")) return { fromFt: Number(t.slice(0, -1)), toFt: null };
  const [a, b] = t.split("-");
  return { fromFt: Number(a), toFt: Number(b) };
}

const puttingRowsRaw = [];
{
  const nonBlank = puttingByDistanceText.split("\n").map((l) => l.trim()).filter(Boolean);
  // drop the header/caption lines that precede the first data triple.
  const dataLines = nonBlank.filter(
    (l) => PCT_ONLY_RE.test(l) || PUTT_MAIN_RE.test(l) || N_PAIR_RE.test(l)
  );
  for (let i = 0; i + 2 < dataLines.length + 1 && i < dataLines.length; ) {
    const pctLine = dataLines[i];
    const mainLine = dataLines[i + 1];
    const nLine = dataLines[i + 2];
    if (!PCT_ONLY_RE.test(pctLine) || !PUTT_MAIN_RE.test(mainLine) || !N_PAIR_RE.test(nLine)) {
      i += 1;
      continue;
    }
    const pctM = PCT_ONLY_RE.exec(pctLine);
    const mainM = PUTT_MAIN_RE.exec(mainLine);
    const nM = N_PAIR_RE.exec(nLine);
    const range = parseFtRange(mainM[1]);
    puttingRowsRaw.push({
      ...range,
      n: Number(mainM[2]),
      makePct: frac(mainM[3]),
      sgPer18: round(toNum(mainM[4]), 2),
      threePuttPct: frac(pctM[1]),
      threePuttN: [Number(nM[1]), Number(nM[2])],
      missShortPct: frac(mainM[5]),
      missLongPct: frac(mainM[6]),
      avgLeaveFt: round(toNum(mainM[7]), 2),
      within10Pct: mainM[8] === "—" ? null : frac(mainM[8]),
    });
    i += 3;
  }
}

/* ---------------------------------------------------------------------- */
/* §08 Benchmark Comparison (scratch)                                     */
/* ---------------------------------------------------------------------- */

const scoringBenchText = grab("SCORING", "DRIVING");
function scoringBenchRow(label) {
  const re = new RegExp(`${label}\\s+per 18\\s+(${PCT})\\s+(${PCT})\\s`);
  const m = re.exec(scoringBenchText);
  if (!m) throw new Error(`build-profile: scratch scoring row not found: ${label}`);
  return round(toNum(m[2]), 2);
}
const scratchScoring = {
  birdiesPer18: scoringBenchRow("Birdies or better"),
  parsPer18: scoringBenchRow("Pars"),
  bogeysPer18: scoringBenchRow("Bogeys"),
  doublesPer18: scoringBenchRow("Doubles or worse"),
};

const drivingBenchText = grab("DRIVING", "APPROACH — FROM TEE & FAIRWAY");
function benchRow(label, unit) {
  const re = new RegExp(`${label}\\s+(${PCT})${unit}\\s+(${PCT})${unit}\\s`);
  const m = re.exec(drivingBenchText);
  if (!m) throw new Error(`build-profile: scratch driving row not found: ${label}`);
  return m[2];
}
const scratchDriving = {
  medianYds: Number(benchRow("Driver median distance", " yds")),
  fairwaysHitPct: frac(benchRow("Fairways hit", "%")),
  lateralSdDeg: round(toNum(benchRow("Directional error σ\\(\\u03b1\\)".replace(/\\u03b1/, "α"), "°")), 2),
  width90Yds: Number(benchRow("90% dispersion width", " yds")),
  penaltyPct: frac(benchRow("Penalty rate", "%")),
  recoveryPct: frac(benchRow("Recovery rate", "%")),
  waywardPct: frac(benchRow("Wayward tee shots", "%")),
};

const approachBenchText = grab("APPROACH — FROM TEE & FAIRWAY", "SHORT GAME");
const APPROACH_BENCH_RE = new RegExp(
  `^(\\d+)-(\\d+)\\s*yds\\s+(\\d+)\\s+(${PCT})%\\s+(N/A|${PCT})%?\\s+(N/A|${PCT})%?\\s+(N/A|${PCT})%?`
);
const scratchApproach = [];
for (const m of rows(approachBenchText, APPROACH_BENCH_RE)) {
  scratchApproach.push({
    fromYds: Number(m[1]),
    toYds: Number(m[2]),
    girPct: m[5] === "N/A" ? null : frac(m[5]),
    proxPct: m[7] === "N/A" ? null : frac(m[7]),
  });
}

const puttingMakeBenchText = grab("PUTTING — MAKE RATES", "PUTTING — THREE-PUTT RATES");
const MAKE_RATE_RE = new RegExp(`^Make % from (\\S+) \\((\\d+) putts\\)\\s+(${PCT})%\\s+(${PCT})%`);
const scratchPutting = [];
for (const m of rows(puttingMakeBenchText, MAKE_RATE_RE)) {
  const r = parseFtRange(m[1]);
  scratchPutting.push({ fromFt: r.fromFt, toFt: r.toFt, makePct: frac(m[4]) });
}

const threePuttBenchText = grab("PUTTING — THREE-PUTT RATES", "SHOT PATTERN · STATS REPORT");
const THREE_PUTT_RE = new RegExp(`^3-putt % from (\\S+) \\((\\d+) first putts\\)\\s+(${PCT})%\\s+(${PCT})%`);
const scratchThreePutt = [];
for (const m of rows(threePuttBenchText, THREE_PUTT_RE)) {
  const r = parseFtRange(m[1]);
  scratchThreePutt.push({ fromFt: r.fromFt, toFt: r.toFt, pct: frac(m[4]) });
}

/* ---------------------------------------------------------------------- */
/* Section 01 / 03 — scoring headline & strokes gained per round          */
/* ---------------------------------------------------------------------- */

const roundsMatch = /(\d+)\s*COMPLETE ROUNDS/.exec(reportText);
const rounds = Number(roundsMatch[1]);

const scoreBlock = peek("WORST SCORE", "SCORE DISTRIBUTION");
const scoreLines = scoreBlock.split("\n").map((l) => l.trim()).filter(Boolean);
const scoreNumsLine = scoreLines.find((l) => /^\d+\s+[\d.]+\s+\d+$/.test(l));
const scoreNums = /^(\d+)\s+([\d.]+)\s+(\d+)$/.exec(scoreNumsLine);
const best = Number(scoreNums[1]);
const avg = Number(scoreNums[2]);
const worst = Number(scoreNums[3]);
const toParLine = scoreLines.find((l) => /to par/.test(l));
const toParNums = /\+\d+ to par\s+\+([\d.]+) to par/.exec(toParLine);
const toPar = Number(toParNums[1]);

const distributionBlock = peek("SCORE DISTRIBUTION", "SCORING BY PAR");
const per18Matches = [...distributionBlock.matchAll(/([\d.]+)\s+per 18/g)].map((m) => Number(m[1]));
const scoringPer18 = {
  birdies: per18Matches[0],
  pars: per18Matches[1],
  bogeys: per18Matches[2],
  doubles: per18Matches[3],
};

const byParBlock = peek("SCORING BY PAR", "SECTION 02");
const byParMatches = [...byParBlock.matchAll(/(\d+\.\d+)\s+\+/g)].map((m) => Number(m[1]));
const byPar = { "3": byParMatches[0], "4": byParMatches[1], "5": byParMatches[2] };

const sgHeadlineBlock = peek("GREEN", "PER ROU N D", reportText.indexOf("STROKES GAINED", 0));
const sgHeadlineMatch = /^\s*(−[\d.]+)\s+(−[\d.]+)\s+(−[\d.]+)\s+(−[\d.]+)\s*$/m.exec(
  sgHeadlineBlock
);
if (!sgHeadlineMatch) throw new Error("build-profile: strokes-gained headline row not found");
const sgPer18 = {
  offTee: round(toNum(sgHeadlineMatch[1]), 2),
  approach: round(toNum(sgHeadlineMatch[2]), 2),
  aroundGreen: round(toNum(sgHeadlineMatch[3]), 2),
  putting: round(toNum(sgHeadlineMatch[4]), 2),
};

/* ---------------------------------------------------------------------- */
/* screens: fairway club-distance medians (Last 10 wins over Last 5)      */
/* ---------------------------------------------------------------------- */

function clubDistanceRows(scr) {
  const card = scr.cards.find((c) => c.title === "Club Distances");
  if (!card) return {};
  const out = {};
  for (const r of card.data.rows) {
    const id = screenClubId(r.club);
    if (id) out[id] = Number(r.value);
  }
  return out;
}

const s26 = screen(26);
const s02 = screen(2);
const last10FairwayMedians = clubDistanceRows(s26);
const last5FairwayMedians = clubDistanceRows(s02);

function fairwayMedianFor(id) {
  if (id in last10FairwayMedians) {
    return { value: last10FairwayMedians[id], window: "Last 10", screens: [s26.file] };
  }
  if (id in last5FairwayMedians) {
    return { value: last5FairwayMedians[id], window: "Last 5", screens: [s02.file] };
  }
  return { value: null, window: "Last 10", screens: [] };
}

/* ---------------------------------------------------------------------- */
/* screens: per-club sheets (Last 10) — extra dispersion detail on tee    */
/* ---------------------------------------------------------------------- */

function sheetKeyStats(scr) {
  const shot = scr.cards.find((c) => c.title === "Shot Distances");
  const key = scr.cards.find((c) => c.title === "Key Stats");
  const dist = key.data.Distance;
  const acc = key.data.Accuracy;
  const val = (arr, label) => Number(String(arr.find((r) => r.label === label).value).replace(/[^\d.]/g, ""));
  const range = /(\d+)[–-](\d+)/.exec(dist.find((r) => r.label === "25th–75th").value);
  return {
    longestYds: val(dist, "Longest"),
    avgOfflineYds: val(acc, "Avg. Offline"),
    arc68Yds: val(acc, "68% Arc"),
    arc95Yds: val(acc, "95% Arc"),
    p25Sheet: Number(range[1]),
    p75Sheet: Number(range[2]),
    file: scr.file,
  };
}

const teeSheet = {
  Dr: sheetKeyStats(screen(17)),
  "2Hy": sheetKeyStats(screen(18)),
  "2i": sheetKeyStats(screen(19)),
  "4Hy": sheetKeyStats(screen(20)),
};

/* ---------------------------------------------------------------------- */
/* screens: driver landing zones (tendencies)                              */
/* ---------------------------------------------------------------------- */

const s12 = screen(12);
const landingCard = s12.cards.find((c) => c.title === "Landing Zones");
const lz = landingCard.data.zones;
const zonePct = (label) => frac(lz.find((z) => z.label === label).pct);
const zoneHalfWidth = (label) => Number(/±(\d+)/.exec(lz.find((z) => z.label === label).range)[1]);
const landingZones = {
  alwaysSafe: zonePct("Always Safe"),
  oftenPlayable: zonePct("Often Playable"),
  foul: zonePct("Foul Balls"),
  safeHalfWidthYds: zoneHalfWidth("Always Safe"),
  playableHalfWidthYds: zoneHalfWidth("Often Playable"),
};

/* ---------------------------------------------------------------------- */
/* screens: approach leave-zone aggregates (screens 21-23 fairway, 27-29 rough) */
/* ---------------------------------------------------------------------- */

function aggregateFrom(sProx, sLR, sSL) {
  const n = Number(/(\d+)\s+approach shots/.exec(sProx.filtersVisible.caption)[1]);
  const proxZones = sProx.cards.find((c) => c.title === "Leave Zones").data.zones;
  const zp = (label) => frac(proxZones.find((z) => z.label === label).pct);
  const lrZones = sLR.cards.find((c) => c.title === "Leave Zones").data.zones;
  const zl = (label) => frac(lrZones.find((z) => z.label === label).pct);
  const slZones = sSL.cards.find((c) => c.title === "Leave Zones").data.zones;
  const zs = (label) => frac(slZones.find((z) => z.label === label).pct);
  return {
    n,
    wellLeft: zl("Well Left"),
    left: zl("Left"),
    right: zl("Right"),
    wellRight: zl("Well Right"),
    wellShort: zs("Well Short"),
    short: zs("Short"),
    long: zs("Long"),
    wellLong: zs("Well Long"),
    proximityZones: {
      pro: zp("Pro"),
      scratch: zp("Scratch"),
      fiveIndex: zp("5-Index"),
      miss: zp("Miss"),
    },
  };
}
const approachAggregateFairway = aggregateFrom(screen(21), screen(22), screen(23));
const approachAggregateRough = aggregateFrom(screen(27), screen(28), screen(29));

/* ---------------------------------------------------------------------- */
/* screens: putting direction (miss left/right per bucket)                */
/* ---------------------------------------------------------------------- */

function puttingDirectionFor(fromFt, toFt) {
  const label = toFt == null ? `${fromFt}+'` : `${fromFt}-${toFt}'`;
  const scr = findScreens(
    (s) =>
      s.tab === "Putting" &&
      s.sectionFilters?.segmented?.selected === "Direction" &&
      s.sectionFilters?.distanceChips?.selected === label
  )[0];
  if (!scr) return { missLeftPct: null, missRightPct: null, file: null };
  const boxes = scr.cards.find((c) => c.title === "Leave Zones").data.summaryBoxes;
  const left = boxes.find((b) => b.label === "Miss Left");
  const right = boxes.find((b) => b.label === "Miss Right");
  return {
    missLeftPct: left ? frac(left.pct) : null,
    missRightPct: right ? frac(right.pct) : null,
    file: scr.file,
  };
}

/* ---------------------------------------------------------------------- */
/* screens: short-game per-lie extras (screens 41/42 = 25-50, 43 = 0-25)   */
/* ---------------------------------------------------------------------- */

function shortGameExtras(bucket) {
  const scrs =
    bucket === "0-25"
      ? [screen(43)]
      : [screen(41), screen(42)];
  const byTitle = {};
  const filesUsed = [];
  for (const s of scrs) {
    if (!s) continue;
    filesUsed.push(s.file);
    for (const c of s.cards) {
      const title = c.title.replace(/\s*\(.*\)$/, "").trim();
      if (["ALL LIES", "FAIRWAY", "ROUGH", "BUNKER"].includes(title)) {
        const sgm = /([−+-]?[\d.]+)/.exec(c.data["Strokes Gained (per 18)"]);
        byTitle[title] = {
          avgProximityFtIn: ftFromString(c.data["Avg. Proximity"]),
          sgPer18: round(toNum(sgm[1]), 2),
        };
      }
    }
  }
  return { byTitle, filesUsed };
}
const sgExtras025 = shortGameExtras("0-25");
const sgExtras2550 = shortGameExtras("25-50");

/* ---------------------------------------------------------------------- */
/* ell80 addendum                                                          */
/* ---------------------------------------------------------------------- */

const ell80ByClub = {};
for (const e of ell80Doc.entries) {
  const obj = {
    wYds: e.wYds,
    hYds: e.hYds,
    tiltDeg: e.tiltDeg,
    dxYds: e.dxYds,
    dyYds: e.dyYds,
    bboxWYds: e.bboxWYds,
    bboxDYds: e.bboxDYds,
    source: "shotPattern",
    capturedAt: ell80Doc.batch,
    lies: ell80Doc.resolvedFilters.lies,
    confidence: e.confidence,
  };
  if (e.note) obj.note = e.note;
  ell80ByClub[e.club] = obj;
}
function ell80For(id) {
  return ell80ByClub[id] ? ell80ByClub[id] : null;
}

/* ---------------------------------------------------------------------- */
/* Entry builders                                                         */
/* ---------------------------------------------------------------------- */

function emptyBigMiss() {
  return { left: 0, right: 0, latYds: null };
}

function baseEntry() {
  return {
    n: null,
    totalMedianYds: null,
    p25Yds: null,
    p75Yds: null,
    carryMedianYds: null,
    carrySource: null,
    distSdYds: null,
    distSdSource: null,
    lateralSdDeg: null,
    biasDistYds: null,
    biasLatYds: null,
    leftPct: null,
    rightPct: null,
    shortPct: null,
    bigMiss: { left: null, right: null, latYds: null },
    bigMissPct: null,
    mishitPct: null,
    penaltyPct: null,
    recoveryPct: null,
    penaltyCount: null,
    girPct: null,
    medianProximityFt: null,
    sgPerShot: null,
    blended: false,
    source: { window: null, report: [], screens: [] },
  };
}

function buildTeeEntry(id) {
  const name = REPORT_CLUB_NAME[id];
  const bag = bagMapping[name];
  if (!bag) return null;
  const disp = dispersionDriving[name] || {};
  const poor = poorDrives[name] || {};
  const sg = sgByClubTee[name] || {};
  const sheet = teeSheet[id];

  const e = baseEntry();
  e.n = bag.n;
  e.totalMedianYds = bag.median;
  e.p25Yds = bag.p25;
  e.p75Yds = bag.p75;
  e.carryMedianYds = bag.median; // ROLL_YDS.tee = 0
  e.carrySource = "derived";
  e.distSdYds = round((bag.p75 - bag.p25) / 1.349, 1);
  e.distSdSource = "iqr";
  e.lateralSdDeg = disp.lateralSdDeg ?? null;
  e.leftPct = disp.leftPct ?? null;
  e.rightPct = disp.rightPct ?? null;
  e.shortPct = null;
  e.bigMiss = {
    left: disp.bigMissLeftPct ?? null,
    right: disp.bigMissRightPct ?? null,
    latYds: Math.max(40, bag.width95 / 2),
  };
  e.bigMissPct = null;
  e.mishitPct = disp.mishitPct ?? null;
  e.penaltyPct = poor.penaltyPct ?? null;
  e.recoveryPct = poor.recoveryPct ?? null;
  e.penaltyCount = poor.penaltyPct != null ? Math.round(poor.penaltyPct * bag.n) : null;
  e.girPct = null;
  e.medianProximityFt = null;
  e.sgPerShot = sg.sgPerShot ?? null;
  e.blended = false;
  e.source = {
    window: "Last 10",
    report: ["§04 BAG MAPPING", "§04 DISPERSION BIAS", "§04 POOR DRIVES", "§04 STROKES GAINED BY CLUB"],
    screens: [],
  };
  e.width95Yds = bag.width95;
  e.width90Yds = bag.width90;
  if (sheet) {
    const extra = {
      longestYds: sheet.longestYds,
      avgOfflineYds: sheet.avgOfflineYds,
      arc68Yds: sheet.arc68Yds,
      arc95Yds: sheet.arc95Yds,
    };
    if (sheet.p25Sheet !== bag.p25 || sheet.p75Sheet !== bag.p75) {
      extra.p25p75Sheet = [sheet.p25Sheet, sheet.p75Sheet];
    }
    e.extra = extra;
    e.source.screens = [sheet.file];
  }
  e.ell80 = ell80For(id);
  return e;
}

function fairwayDefaultsInto(e) {
  e.bigMiss = emptyBigMiss();
  e.bigMissPct = null;
  e.penaltyPct = 0;
  e.recoveryPct = 0;
  e.penaltyCount = 0;
  e.mishitPct = null;
  e.distSdYds = null;
  e.distSdSource = null;
}

function buildFairwayEntry(id, { swingType, family, forceNullMedian = false } = {}) {
  const name = REPORT_CLUB_NAME[id];
  const byClub = teeFairwayByClub[name];
  if (!byClub) return null; // 0 shots -> null entirely (2i)

  const disp = dispersionApproach[name] || {};
  const medianInfo = forceNullMedian ? { value: null, window: "Last 10", screens: [] } : fairwayMedianFor(id);

  const e = baseEntry();
  e.n = byClub.n;
  e.totalMedianYds = medianInfo.value;
  fairwayDefaultsInto(e);
  e.lateralSdDeg = disp.lateralSdDeg ?? null;
  e.leftPct = disp.leftPct ?? null;
  e.rightPct = disp.rightPct ?? null;
  e.shortPct = disp.shortPct ?? null;
  e.bigMissPct = byClub.bigMissPct;
  e.girPct = byClub.girPct;
  e.medianProximityFt = byClub.medianProximityFt;
  e.sgPerShot = byClub.sgPerShot;
  e.blended = false;

  const roll = (swingType === "full" ? ROLL_YDS.club?.[id] : null) ?? ROLL_YDS[swingType][family];
  e.carryMedianYds = e.totalMedianYds == null ? null : e.totalMedianYds - roll;
  e.carrySource = "derived";

  e.source = {
    window: medianInfo.window,
    report: ["§05 FROM TEE & FAIRWAY — BY CLUB", "§05 DISPERSION BIAS — FROM TEE & FAIRWAY"],
    screens: medianInfo.screens,
  };
  e.ell80 = ell80For(id);
  return e;
}

function buildRoughEntry(id) {
  const name = REPORT_CLUB_NAME[id];
  const byClub = roughByClub[name];
  if (!byClub) return null;

  const e = baseEntry();
  e.n = byClub.n;
  fairwayDefaultsInto(e);
  e.carryMedianYds = null;
  e.carrySource = null;
  e.bigMissPct = byClub.bigMissPct;
  e.girPct = byClub.girPct;
  e.medianProximityFt = byClub.medianProximityFt;
  e.sgPerShot = byClub.sgPerShot;
  e.blended = false;
  e.source = {
    window: "Last 10",
    report: ["§05 FROM ROUGH — BY CLUB"],
    screens: [],
  };
  e.ell80 = ell80For(id);
  return e;
}

function placeholderFairwayEntry(sourceNote, id) {
  const e = baseEntry();
  fairwayDefaultsInto(e);
  e.source = { window: "Last 10", report: [], screens: [] };
  e.source.rule = sourceNote;
  e.ell80 = ell80For(id);
  return e;
}

/* ---------------------------------------------------------------------- */
/* Assemble clubs                                                          */
/* ---------------------------------------------------------------------- */

const TEE_CLUBS = new Set(["Dr", "2Hy", "4Hy", "2i"]);
const FAIRWAY_FAMILY_SWING = {
  Dr: null,
  "2Hy": { swingType: "full", family: CLUB_FAMILY["2Hy"] },
  "4Hy": { swingType: "full", family: CLUB_FAMILY["4Hy"] },
  "2i": { swingType: "full", family: CLUB_FAMILY["2i"] },
  "5i": { swingType: "full", family: CLUB_FAMILY["5i"] },
  "6i": { swingType: "full", family: CLUB_FAMILY["6i"] },
  "7i": { swingType: "full", family: CLUB_FAMILY["7i"] },
  "8i": { swingType: "full", family: CLUB_FAMILY["8i"] },
  "9i": { swingType: "full", family: CLUB_FAMILY["9i"] },
  PW: { swingType: "full", family: CLUB_FAMILY.PW },
  GW: { swingType: "full", family: CLUB_FAMILY.GW },
  SW: { swingType: "finesse", family: CLUB_FAMILY.SW },
  LW: { swingType: "finesse", family: CLUB_FAMILY.LW },
};

const clubs = CLUB_ORDER.map((id) => {
  const entries = { full: { tee: null, fairway: null, rough: null }, finesse: null };

  if (TEE_CLUBS.has(id)) {
    entries.full.tee = buildTeeEntry(id);
  }

  if (id === "Dr") {
    entries.full.fairway = null;
    entries.full.rough = null;
    entries.finesse = null;
  } else if (id === "2i") {
    entries.full.fairway = buildFairwayEntry(id, FAIRWAY_FAMILY_SWING[id]); // null: 0 shots
    entries.full.rough = null; // absent from rough table
    entries.finesse = {
      tee: null,
      fairway: null,
      rough: null,
    };
  } else if (id === "GW") {
    const fw = buildFairwayEntry(id, FAIRWAY_FAMILY_SWING[id]);
    if (fw) fw.blended = true;
    entries.full.fairway = fw;
    entries.full.rough = buildRoughEntry(id);
    entries.finesse = {
      tee: null,
      fairway: placeholderFairwayEntry(
        "GW blended into full.fairway (measured, blended: true); this is a null placeholder.",
        id
      ),
      rough: null,
    };
  } else if (id === "SW" || id === "LW") {
    const fw = buildFairwayEntry(id, FAIRWAY_FAMILY_SWING[id]);
    if (fw) fw.blended = true;
    entries.full.tee = null;
    entries.full.fairway = placeholderFairwayEntry(
      `${id} played as a finesse club inside 120; measured median lives on finesse.fairway.`,
      id
    );
    entries.full.rough = null;
    entries.finesse = {
      tee: null,
      fairway: fw,
      rough: buildRoughEntry(id),
    };
  } else {
    // 2Hy, 4Hy, 5i, 6i, 7i, 8i, 9i, PW
    entries.full.fairway = buildFairwayEntry(id, FAIRWAY_FAMILY_SWING[id]);
    entries.full.rough = buildRoughEntry(id);
    entries.finesse = null;
  }

  return {
    id,
    label: CLUB_LABEL[id],
    family: CLUB_FAMILY[id],
    loftDeg: null,
    entries,
  };
});

/* ---------------------------------------------------------------------- */
/* approachBuckets / approachAggregate                                     */
/* ---------------------------------------------------------------------- */

const approachBuckets = [...approachBucketsFairway, ...approachBucketsRough];
const approachAggregate = { fairway: approachAggregateFairway, rough: approachAggregateRough };

/* ---------------------------------------------------------------------- */
/* putting                                                                 */
/* ---------------------------------------------------------------------- */

const putting = puttingRowsRaw.map((r) => {
  const dir = puttingDirectionFor(r.fromFt, r.toFt);
  return {
    fromFt: r.fromFt,
    toFt: r.toFt,
    n: r.n,
    makePct: r.makePct,
    sgPer18: r.sgPer18,
    threePuttPct: r.threePuttPct,
    threePuttN: r.threePuttN,
    missShortPct: r.missShortPct,
    missLongPct: r.missLongPct,
    avgLeaveFt: r.avgLeaveFt,
    within10Pct: r.within10Pct,
    missLeftPct: dir.missLeftPct,
    missRightPct: dir.missRightPct,
  };
});
const puttingSgPer18 = sgPer18.putting;

/* ---------------------------------------------------------------------- */
/* shortGame bands                                                        */
/* ---------------------------------------------------------------------- */

function buildBand(fromYds, toYds, lie, base, extras) {
  const row = base[lie === "fairway" ? "Fairway" : lie === "rough" ? "Rough" : "Bunker"];
  if (!row) return null;
  const band = {
    fromYds,
    toYds,
    lie,
    n: row.n,
    sgPerShot: row.sgPerShot,
    upDownPct: row.upDownPct,
    inside3Pct: row.inside3Pct,
    inside6Pct: row.inside6Pct,
    missGreenPct: row.missGreenPct,
    medianProximityFt: row.medianProximityFt,
  };
  const ex = extras.byTitle[lie === "fairway" ? "FAIRWAY" : lie === "rough" ? "ROUGH" : "BUNKER"];
  if (ex) band.extra = ex;
  return band;
}

const shortGameBands = [
  buildBand(0, 25, "fairway", shortGame025, sgExtras025),
  buildBand(0, 25, "rough", shortGame025, sgExtras025),
  buildBand(0, 25, "bunker", shortGame025, sgExtras025),
  buildBand(25, 50, "fairway", shortGame2550, sgExtras2550),
  buildBand(25, 50, "rough", shortGame2550, sgExtras2550),
  buildBand(25, 50, "bunker", shortGame2550, sgExtras2550),
].filter(Boolean);

/* ---------------------------------------------------------------------- */
/* tendencies.driver                                                      */
/* ---------------------------------------------------------------------- */

const drGood = goodDrives[REPORT_CLUB_NAME.Dr];
const drPoor = poorDrives[REPORT_CLUB_NAME.Dr];

const tendencies = {
  driver: {
    teeShots: teeShotsTotal,
    goodDrivePct,
    fairwaysHitPct: fairwaysHitPctOverall,
    intoTroublePct,
    driver: {
      fairwaysHitPct: drGood.fairwaysHitPct,
      goodDrivePct: drGood.goodDrivePct,
      within40Pct: drGood.within40Pct,
      within70Pct: drGood.within70Pct,
      outside40Pct: drPoor.outside40Pct,
      outside70Pct: drPoor.outside70Pct,
    },
    landingZones,
    penaltyDrivesInsideCorridor,
  },
};

/* ---------------------------------------------------------------------- */
/* benchmarks.scratch                                                     */
/* ---------------------------------------------------------------------- */

const benchmarks = {
  scratch: {
    note:
      "Shot Pattern's scratch benchmark (Arccos, Broadie, Stagner, Shot Scope, Tour data). SG per shot elsewhere in this file is measured against it.",
    scoring: scratchScoring,
    driving: scratchDriving,
    approach: scratchApproach,
    putting: scratchPutting,
    threePutt: scratchThreePutt,
  },
};

/* ---------------------------------------------------------------------- */
/* scoring                                                                 */
/* ---------------------------------------------------------------------- */

const scoring = {
  rounds,
  avg,
  toPar,
  best,
  worst,
  per18: scoringPer18,
  byPar,
  sgPer18,
};

/* ---------------------------------------------------------------------- */
/* sources                                                                 */
/* ---------------------------------------------------------------------- */

const last5Screens = screensDoc.screens
  .filter((s) => s.filterSource === "inferred" && s.resolvedFilters?.window === "Last 5")
  .map((s) => s.file);

const sources = {
  shotPattern: {
    window: `${screensDoc.companionReport.filters.roundType} · ${screensDoc.companionReport.filters.window}`,
    dateRange: screensDoc.companionReport.filters.dateRange,
    rounds,
    batch: screensDoc.batch,
    report: "data/extracted/2026-09-27-report.txt",
    screens: "data/extracted/2026-09-27-screens.json",
    last5: {
      window: `${screensDoc.screens[0].resolvedFilters.roundType} · ${screensDoc.screens[0].resolvedFilters.window}`,
      dateRange: screensDoc.screens[0].resolvedFilters.dateRange,
      screens: last5Screens,
    },
    ell80: {
      file: "data/extracted/2026-09-19-ell80.json",
      window: `${ell80Doc.resolvedFilters.roundType} · ${ell80Doc.resolvedFilters.window}`,
      capturedAt: ell80Doc.batch,
    },
  },
  launchMonitor: { date: null, notes: "none — carries derived from totals (spec §3.3)" },
  tangent: { role: "historical baseline only", used: false },
};

/* ---------------------------------------------------------------------- */
/* final assembly (key order matches docs/PROFILE-v2.md)                  */
/* ---------------------------------------------------------------------- */

const profile = {
  version: 2,
  generated: new Date().toISOString().slice(0, 10),
  sources,
  clubOrder: CLUB_ORDER,
  clubs,
  approachBuckets,
  approachAggregate,
  putting,
  puttingSgPer18,
  shortGame: { bands: shortGameBands },
  tendencies,
  benchmarks,
  scoring,
};

/* ---------------------------------------------------------------------- */
/* validation                                                              */
/* ---------------------------------------------------------------------- */

function fail(msg) {
  throw new Error(`build-profile validation failed: ${msg}`);
}

function checkEntryShape(entry, where) {
  if (entry === null) return;
  const required = [
    "n", "totalMedianYds", "carryMedianYds", "carrySource", "lateralSdDeg", "bigMiss",
    "sgPerShot", "source", "ell80",
  ];
  for (const k of required) {
    if (!(k in entry)) fail(`${where}: entry missing key "${k}"`);
  }
  if (entry.carryMedianYds != null && entry.totalMedianYds != null) {
    if (entry.carryMedianYds > entry.totalMedianYds) {
      fail(`${where}: carryMedianYds (${entry.carryMedianYds}) > totalMedianYds (${entry.totalMedianYds})`);
    }
  }
  if (entry.n != null && (!Number.isInteger(entry.n) || entry.n < 0)) fail(`${where}: n must be integer >= 0 or null`);
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v === "number" && /Pct$/.test(k)) {
      if (v < 0 || v > 1) fail(`${where}: fraction ${k}=${v} out of [0,1]`);
    }
  }
  if (entry.ell80 !== null && typeof entry.ell80 !== "object") {
    fail(`${where}: ell80 must be null or an object`);
  }
}

{
  const seen = new Set();
  for (const c of profile.clubs) {
    if (seen.has(c.id)) fail(`duplicate club id ${c.id}`);
    seen.add(c.id);
  }
  for (const id of profile.clubOrder) {
    if (!seen.has(id)) fail(`clubOrder id ${id} missing from clubs`);
  }
  if (seen.size !== profile.clubOrder.length) fail("clubs/clubOrder length mismatch");

  for (const c of profile.clubs) {
    for (const swingType of ["full", "finesse"]) {
      const st = c.entries[swingType];
      if (st === null) continue;
      for (const lie of ["tee", "fairway", "rough"]) {
        checkEntryShape(st[lie], `${c.id}.${swingType}.${lie}`);
      }
    }
  }
}

{
  const byLie = { fairway: [], rough: [] };
  for (const b of profile.approachBuckets) byLie[b.lie].push(b);
  for (const [lie, list] of Object.entries(byLie)) {
    const sorted = [...list].sort((a, b) => a.fromYds - b.fromYds);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].toYds !== sorted[i].fromYds) {
        fail(`approachBuckets ${lie} not contiguous between ${sorted[i - 1].toYds} and ${sorted[i].fromYds}`);
      }
    }
  }
}

for (const p of profile.putting) {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === "number" && /Pct$/.test(k) && (v < 0 || v > 1)) {
      fail(`putting ${p.fromFt}-${p.toFt}: fraction ${k}=${v} out of [0,1]`);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* serialize + write / --check                                            */
/* ---------------------------------------------------------------------- */

const json = JSON.stringify(profile, null, 2) + "\n";

const check = process.argv.includes("--check");
if (check) {
  const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : null;
  // "generated" changes daily; compare with that one field normalized out.
  const normalize = (s) => s && s.replace(/"generated": "[^"]*"/, '"generated": "GENERATED"');
  if (normalize(existing) !== normalize(json)) {
    console.error("build-profile --check: src/profile.json is stale. Run `npm run build:profile`.");
    process.exit(1);
  }
  console.log("build-profile --check: src/profile.json is up to date.");
} else {
  fs.writeFileSync(OUT_PATH, json);
  console.log(`build-profile: wrote ${path.relative(ROOT, OUT_PATH)}`);
}
