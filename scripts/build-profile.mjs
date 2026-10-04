#!/usr/bin/env node
/*
 * build-profile.mjs — builds src/profile.json (v2) from data/extracted/*.
 *
 * Every number in the output is parsed from data/extracted/2026-10-04-report.txt (exact PDF text)
 * and data/extracted/2026-10-04-screens.json (screen-recording transcriptions), plus the measured
 * ellipses in data/extracted/2026-10-04-ell80.json. See docs/PROFILE-v2.md for the contract.
 * The Oct 4 batch (Casual · Last 10, Jul 26 – Oct 3) replaces the Sep 27 one entirely (D78).
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

const BATCH = "2026-10-04";
const REPORT_REL = `data/extracted/${BATCH}-report.txt`;
const SCREENS_REL = `data/extracted/${BATCH}-screens.json`;
const ELL80_REL = `data/extracted/${BATCH}-ell80.json`;
const REPORT_PATH = path.join(ROOT, REPORT_REL);
const SCREENS_PATH = path.join(ROOT, SCREENS_REL);
const ELL80_PATH = path.join(ROOT, ELL80_REL);
const OUT_PATH = path.join(ROOT, "src/profile.json");

const ROLL_YDS = DEFAULT_CONFIG.ROLL_YDS;
// Shot Pattern draws no pattern under 5 shots: σ(α) from fewer is not used (D78).
const MIN_SIGMA_N = 5;

// The per-distance buckets E() and B() price from hold 1–16 shots each. Raw, they made the caddie
// lay up off par-4 tees (Oct 4 PDF: +0.47 SG from 225–250 on 6 shots, −0.45 from 120–130 on 6).
// Each bucket's SG, GIR and proximity are shrunk toward its lie's shot-weighted average with the
// learning loop's own prior weight (SHRINK_K, as learning.js does between rounds):
//   v = (n·v_bucket + K·v_lie) / (n + K);  proximity is pooled per yard of start distance.
// Short-game bands shrink the same way toward their distance range's average. The PDF's own
// numbers stay on `raw` (D78).
const SHRINK_K = DEFAULT_CONFIG.SHRINK_K;
function shrinkRows(rows, { mid, stats }) {
  const has = rows.filter((r) => r.n > 0 && r.sgPerShot != null);
  const N = has.reduce((a, r) => a + r.n, 0);
  const mean = {};
  for (const k of stats) {
    const perYd = k === "medianProximityFt";
    mean[k] = has.reduce((a, r) => a + r.n * (perYd ? r[k] / mid(r) : r[k]), 0) / N;
  }
  return rows.map((r) => {
    const out = { ...r, raw: {} };
    const w = r.n / (r.n + SHRINK_K);
    for (const k of stats) {
      out.raw[k] = r[k];
      const prior = k === "medianProximityFt" ? mean[k] * mid(r) : mean[k];
      const dec = k === "medianProximityFt" ? 0 : k === "sgPerShot" ? 2 : 3;
      out[k] = r[k] == null ? round(prior, dec) : round(w * r[k] + (1 - w) * prior, dec);
    }
    out.shrink = { k: SHRINK_K, toward: `${r.lie} average over ${N} shots` };
    return out;
  });
}
const BUCKET_STATS = ["sgPerShot", "girPct", "medianProximityFt"];
const BAND_STATS = ["sgPerShot", "medianProximityFt"];
const bucketMid = (r) => (r.fromYds + r.toYds) / 2;
const bandMid = (r) => (r.fromYds + r.toYds) / 2;

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

/* ---------------------------------------------------------------------- */
/* load inputs                                                            */
/* ---------------------------------------------------------------------- */

const reportText = fs.readFileSync(REPORT_PATH, "utf8");
const screensDoc = JSON.parse(fs.readFileSync(SCREENS_PATH, "utf8"));
const ell80Doc = JSON.parse(fs.readFileSync(ELL80_PATH, "utf8"));

// Transcribed values are keyed by meaning (approach.clubSheets.fairway.5i, putting.direction.4-6 …),
// never by screen number; the file says which recording and frames each block was read from.
const sheets = screensDoc.approach.clubSheets;
const leaveZonesDoc = screensDoc.approach.leaveZones;

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
const sgHeadlineMatch = /^\s*([−+][\d.]+)\s+([−+][\d.]+)\s+([−+][\d.]+)\s+([−+][\d.]+)\s*$/m.exec(
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
/* recordings: per-club sheets (Approach → Breakdown → club)               */
/* ---------------------------------------------------------------------- */

// Shot Distances on a club sheet = yards the ball travelled (median, 25th, 75th), every swing
// length mixed. Fairway sheets feed totalMedianYds; rough sheets are stored, not used (D78).
function sheetFor(lie, id) {
  return sheets[lie]?.[id] ?? null;
}
function sheetSource(lie, id) {
  const sh = sheetFor(lie, id);
  return sh ? [`${SCREENS_REL}#approach.clubSheets.${lie}.${id} (${sh.frames})`] : [];
}

/* ---------------------------------------------------------------------- */
/* recordings: per-club leave zones (fairway / rough)                      */
/* ---------------------------------------------------------------------- */

function fracZones(z) {
  if (!z) return null;
  const out = {};
  for (const [k, v] of Object.entries(z)) out[k] = frac(v);
  return out;
}
function leaveZonesFor(lie, id) {
  const z = leaveZonesDoc[lie]?.[id];
  if (!z) return null;
  return {
    n: z.n,
    proximity: fracZones(z.proximity),
    leftRight: fracZones(z.leftRight),
    shortLong: fracZones(z.shortLong),
  };
}

// The all-clubs aggregate is the sum of the per-club counts (pct × n, each club rounding to whole
// shots); a dimension a club never showed alone is left out of that dimension's n.
function aggregateFrom(lie) {
  const dims = {
    proximity: ["pro", "scratch", "fiveIndex", "miss"],
    leftRight: ["wellLeft", "left", "right", "wellRight"],
    shortLong: ["wellShort", "short", "long", "wellLong"],
  };
  const tot = {};
  for (const [dim, keys] of Object.entries(dims)) {
    tot[dim] = { n: 0 };
    for (const k of keys) tot[dim][k] = 0;
  }
  for (const z of Object.values(leaveZonesDoc[lie])) {
    for (const [dim, keys] of Object.entries(dims)) {
      if (!z[dim]) continue;
      const counts = keys.map((k) => Math.round((z[dim][k] * z.n) / 100));
      const sum = counts.reduce((a, b) => a + b, 0);
      if (sum !== z.n) throw new Error(`build-profile: leave zones ${lie} ${dim} counts ${counts} do not sum to n ${z.n}`);
      tot[dim].n += z.n;
      keys.forEach((k, i) => (tot[dim][k] += counts[i]));
    }
  }
  const share = (dim, k) => (tot[dim].n ? round(tot[dim][k] / tot[dim].n, 3) : null);
  return {
    n: tot.proximity.n,
    wellLeft: share("leftRight", "wellLeft"),
    left: share("leftRight", "left"),
    right: share("leftRight", "right"),
    wellRight: share("leftRight", "wellRight"),
    wellShort: share("shortLong", "wellShort"),
    short: share("shortLong", "short"),
    long: share("shortLong", "long"),
    wellLong: share("shortLong", "wellLong"),
    proximityZones: {
      pro: share("proximity", "pro"),
      scratch: share("proximity", "scratch"),
      fiveIndex: share("proximity", "fiveIndex"),
      miss: share("proximity", "miss"),
    },
    nLeftRight: tot.leftRight.n,
    nShortLong: tot.shortLong.n,
    rule: "sum of the per-club Leave Zones counts (pct × n per club)",
  };
}
const approachAggregateFairway = aggregateFrom("fairway");
const approachAggregateRough = aggregateFrom("rough");

/* ---------------------------------------------------------------------- */
/* recordings: putting direction + speed per bucket                        */
/* ---------------------------------------------------------------------- */

function puttingRecordingFor(fromFt, toFt) {
  const label = toFt == null ? `${fromFt}+` : `${fromFt}-${toFt}`;
  const dir = screensDoc.putting.direction[label];
  const spd = screensDoc.putting.speed[label];
  return {
    // share of ALL putts in the bucket, as printed (Miss Left · Make · Miss Right)
    missLeftPct: dir ? frac(dir.pct[0]) : null,
    missRightPct: dir ? frac(dir.pct[2]) : null,
    extra: dir || spd
      ? {
          direction: dir ? { missLeft: dir.missLeft, make: dir.make, missRight: dir.missRight } : null,
          speed: spd ? { short: spd.short, good: spd.good, long: spd.long } : null,
        }
      : null,
  };
}

/* ---------------------------------------------------------------------- */
/* recordings: short-game per-lie extras                                   */
/* ---------------------------------------------------------------------- */

function shortGameExtra(bucket, lie) {
  const b = screensDoc.shortGame[bucket];
  const row = b.byLie[lie];
  const zones = b.leaveZones[lie];
  if (!row && !zones) return null;
  const sgm = row ? row.sgPer18 : null;
  const dc = zones?.distanceControl;
  return {
    avgProximityFtIn: row ? ftFromString(row.avgProximity) : null,
    sgPer18: sgm == null ? null : round(sgm, 2),
    leaveProximity: zones?.proximity
      ? { pro: frac(zones.proximity.pro), scratch: frac(zones.proximity.scratch), miss: frac(zones.proximity.miss), bands: zones.proximity.bands ?? null }
      : null,
    distanceControl: dc ? { onTarget: frac(dc.onTarget), short: frac(dc.short), long: frac(dc.long), band: dc.band } : null,
  };
}

/* ---------------------------------------------------------------------- */
/* ell80 (measured fairway patterns)                                       */
/* ---------------------------------------------------------------------- */

// dyYds is set to 0: the ellipse's distance offset is measured against Shot Pattern's target, and
// the same shots' shortfall is already in totalMedianYds (yards travelled) — applying both would
// count it twice (2Hy: median 236 to a ~251 target, centre 28 short). The measured value stays on
// dyMeasuredYds. The lateral offset dx has no such twin and is kept (D78).
const ell80ByClubLie = {};
for (const e of ell80Doc.entries) {
  ell80ByClubLie[`${e.club}|${e.lie}`] = {
    wYds: e.wYds,
    hYds: e.hYds,
    tiltDeg: e.tiltDeg,
    dxYds: e.dxYds,
    dyYds: 0,
    dyMeasuredYds: e.dyYds,
    bboxWYds: e.bboxWYds,
    bboxDYds: e.bboxDYds,
    source: "shotPattern",
    capturedAt: ell80Doc.batch,
    lies: ell80Doc.resolvedFilters.lies,
    n: e.n,
    confidence: e.confidence,
  };
}
function ell80For(id, lie) {
  return ell80ByClubLie[`${id}|${lie}`] ?? null;
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
  // Shot Pattern's ellipse is an approach measure; a tee shot reads the fairway one only through
  // resolveEntry's lie chain, as it did with the Sep 19 all-lies ellipses.
  e.ell80 = null;
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
  const sheet = forceNullMedian ? null : sheetFor("fairway", id);

  const e = baseEntry();
  e.n = byClub.n;
  e.totalMedianYds = sheet?.medianYds ?? null;
  // The sheet's 25th–75th mixes swing lengths and targets, so it is kept as data but never turned
  // into distSdYds for an approach club (the ellipse depth is the dispersion; D78).
  e.p25Yds = sheet?.p25Yds ?? null;
  e.p75Yds = sheet?.p75Yds ?? null;
  fairwayDefaultsInto(e);
  // σ(α) from fewer than 5 shots is not a spread (4Hy: 0.72° from 3); null lets resolveEntry take
  // the club's own tee σ through the lie chain (D78).
  e.lateralSdDeg = disp.n >= MIN_SIGMA_N ? disp.lateralSdDeg ?? null : null;
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
    window: "Last 10",
    report: ["§05 FROM TEE & FAIRWAY — BY CLUB", "§05 DISPERSION BIAS — FROM TEE & FAIRWAY"],
    screens: sheetSource("fairway", id),
  };
  if (disp.n != null && disp.n < MIN_SIGMA_N) {
    e.source.note = `σ(α) ${disp.lateralSdDeg}° from ${disp.n} shots dropped (< ${MIN_SIGMA_N}); the lie chain supplies it.`;
  }
  e.ell80 = ell80For(id, "fairway");
  e.extra = {
    sheetN: sheet?.n ?? null,
    pattern80: sheet?.pattern80 ?? null,
    leaveZones: leaveZonesFor("fairway", id),
  };
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
    screens: sheetSource("rough", id),
  };
  e.ell80 = null;
  const sheet = sheetFor("rough", id);
  e.extra = {
    // Stored, not read by the engine until Brett decides (D78): totalMedianYds stays null, so a rough
    // lie still takes the fairway distance × LIE_DIST_ADJ_FAMILY.
    shotDistances: sheet && sheet.medianYds != null
      ? { n: sheet.n, medianYds: sheet.medianYds, p25Yds: sheet.p25Yds, p75Yds: sheet.p75Yds }
      : null,
    pattern80: sheet?.pattern80 ?? null,
    leaveZones: leaveZonesFor("rough", id),
  };
  return e;
}

function placeholderFairwayEntry(sourceNote, id) {
  const e = baseEntry();
  fairwayDefaultsInto(e);
  e.source = { window: "Last 10", report: [], screens: [] };
  e.source.rule = sourceNote;
  e.ell80 = null;
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

const approachBuckets = [
  ...shrinkRows(approachBucketsFairway, { mid: bucketMid, stats: BUCKET_STATS }),
  ...shrinkRows(approachBucketsRough, { mid: bucketMid, stats: BUCKET_STATS }),
];
const approachAggregate = { fairway: approachAggregateFairway, rough: approachAggregateRough };

/* ---------------------------------------------------------------------- */
/* putting                                                                 */
/* ---------------------------------------------------------------------- */

const putting = puttingRowsRaw.map((r) => {
  const dir = puttingRecordingFor(r.fromFt, r.toFt);
  const row = {
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
  if (dir.extra) row.extra = dir.extra;
  return row;
});
const puttingSgPer18 = sgPer18.putting;

/* ---------------------------------------------------------------------- */
/* shortGame bands                                                        */
/* ---------------------------------------------------------------------- */

function buildBand(fromYds, toYds, lie, base, bucket) {
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
  const ex = shortGameExtra(bucket, lie);
  if (ex) band.extra = ex;
  return band;
}

const shortGameBandsRaw = [
  buildBand(0, 25, "fairway", shortGame025, "0-25"),
  buildBand(0, 25, "rough", shortGame025, "0-25"),
  buildBand(0, 25, "bunker", shortGame025, "0-25"),
  buildBand(25, 50, "fairway", shortGame2550, "25-50"),
  buildBand(25, 50, "rough", shortGame2550, "25-50"),
  buildBand(25, 50, "bunker", shortGame2550, "25-50"),
].filter(Boolean);
// shrink each band toward its distance range's average (every lie in 0–25, every lie in 25–50)
const shortGameBands = [0, 25].flatMap((from) => {
  const rows = shortGameBandsRaw.filter((b) => b.fromYds === from);
  return shrinkRows(rows.map((b) => ({ ...b, lie: b.lie })), { mid: bandMid, stats: BAND_STATS }).map((b) => {
    b.shrink.toward = `${from}–${from + 25} yds average over ${b.shrink.toward.split(" over ")[1]}`;
    return b;
  });
});

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
    landingZones: null, // the Driving tab's Landing Zones were not recorded for the Oct 4 batch
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

const sources = {
  shotPattern: {
    window: `${screensDoc.companionReport.filters.roundType} · ${screensDoc.companionReport.filters.window}`,
    dateRange: screensDoc.companionReport.filters.dateRange,
    rounds,
    batch: screensDoc.batch,
    report: REPORT_REL,
    screens: SCREENS_REL,
    ell80: {
      file: ELL80_REL,
      window: `${ell80Doc.resolvedFilters.roundType} · ${ell80Doc.resolvedFilters.window}`,
      lies: ell80Doc.resolvedFilters.lies,
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

// Every approach club Shot Pattern measured from the fairway carries that distance.
for (const c of profile.clubs) {
  for (const swingType of ["full", "finesse"]) {
    const fw = c.entries[swingType]?.fairway;
    if (fw && fw.n > 0 && fw.source.rule == null && fw.totalMedianYds == null && sheetFor("fairway", c.id)) {
      fail(`${c.id}.${swingType}.fairway: measured on a sheet but totalMedianYds is null`);
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
