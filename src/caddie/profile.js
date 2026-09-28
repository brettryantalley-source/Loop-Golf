/*
 * profile.js — loads profile v2 (docs/PROFILE-v2.md) and answers the engine's questions about
 * Brett's numbers: which club entry applies here, what it carries, how it scatters, and the three
 * expected-value functions of spec §3.5 — E(), Eputt(), B().
 *
 * Fallback order (spec §5.4) whenever a field is null:
 *   same entry → same club, adjacent lie → adjacent club, same lie → scratch baseline / config.
 * Every resolved field carries provenance so a reason string can only ever cite a real number.
 *
 * Pure functions. No DOM, no storage, no network. Nothing here writes to the profile (T32).
 */

import { DEFAULT_CONFIG, CLUB_FAMILY } from "./config.js";
import { baselineE, baselinePutts } from "./baseline.js";

const ENTRY_LIES = ["tee", "fairway", "rough"];
/** Which stored lie a context lie reads first, then the adjacent lies in order. */
const LIE_CHAIN = Object.freeze({
  tee: ["tee", "fairway", "rough"],
  fairway: ["fairway", "tee", "rough"],
  rough: ["rough", "fairway", "tee"],
  sand: ["rough", "fairway", "tee"],
  recovery: ["rough", "fairway", "tee"],
});
/** Fields a resolved entry exposes (and that reason templates may cite). */
const ENTRY_FIELDS = [
  "n", "totalMedianYds", "carryMedianYds", "distSdYds", "lateralSdDeg", "biasDistYds", "biasLatYds",
  "leftPct", "rightPct", "shortPct", "bigMissPct", "mishitPct", "penaltyPct", "recoveryPct", "penaltyCount",
  "girPct", "medianProximityFt", "sgPerShot", "blended",
];

/* ---------- loading ---------- */

export function loadProfile(json, config = DEFAULT_CONFIG) {
  if (!json || json.version !== 2) throw new Error("profile: expected version 2");
  const clubs = new Map();
  for (const c of json.clubs) {
    if (clubs.has(c.id)) throw new Error(`profile: duplicate club ${c.id}`);
    clubs.set(c.id, c);
  }
  for (const id of json.clubOrder) if (!clubs.has(id)) throw new Error(`profile: clubOrder names unknown club ${id}`);
  const buckets = {};
  for (const b of json.approachBuckets) (buckets[b.lie] ||= []).push(b);
  for (const lie of Object.keys(buckets)) buckets[lie].sort((a, b) => a.fromYds - b.fromYds);
  const putting = [...json.putting].sort((a, b) => a.fromFt - b.fromFt);
  const shortGame = {};
  for (const b of json.shortGame?.bands || []) (shortGame[b.lie] ||= []).push(b);
  const P = {
    raw: json,
    config,
    clubs,
    clubOrder: [...json.clubOrder],
    buckets,
    putting,
    shortGame,
    puttDeficitPerHole: config.PUTT_DEFICIT_IN_E && typeof json.puttingSgPer18 === "number" ? -json.puttingSgPer18 / 18 : 0,
    scratchLateralSdDeg: json.benchmarks?.scratch?.driving?.lateralSdDeg ?? null,
    _b3: new Map(),
    _E: new Map(),
    _Ep: new Map(),
    _B2: new Map(),
  };
  return P;
}

/** Club family for an id (config table first, then the profile's own label). */
export function familyOf(P, clubId) {
  return CLUB_FAMILY[clubId] || P.clubs.get(clubId)?.family || "mid";
}

/** total − roll (spec §3.3). Tee entries of tee clubs use total. */
export function carryFromTotal(total, swing, family, lie, config, wet = false) {
  if (total == null) return null;
  if (wet) return total;                                     // no roll anywhere when wet → carry is the whole shot
  if (lie === "tee" && family === "long") return total - config.ROLL_YDS.tee;
  const roll = config.ROLL_YDS[swing]?.[family] ?? 0;
  return total - roll;
}

/* ---------- entry resolution (§5.4) ---------- */

function rawEntry(club, swing, lie) {
  const s = club.entries?.[swing];
  if (!s) return null;
  return s[lie] || null;
}

function firstNonNull(chain, field) {
  for (const { entry, lie } of chain) {
    if (entry && entry[field] != null) return { value: entry[field], lie };
  }
  return null;
}

/**
 * The numbers the simulation uses for `clubId` × `swing` from `lie`, with fallbacks applied.
 * Returns null when the club has no usable distance for this swing type at all (not a candidate).
 */
export function resolveEntry(P, clubId, swing, lie, opts = {}) {
  const cfg = P.config;
  const club = P.clubs.get(clubId);
  if (!club || !club.entries?.[swing]) return null;
  const chainLies = LIE_CHAIN[lie] || LIE_CHAIN.fairway;
  const chain = chainLies.map((l) => ({ entry: rawEntry(club, swing, l), lie: l }));
  if (!chain.some((c) => c.entry)) return null;

  const fields = {};
  const provenance = {};
  for (const f of ENTRY_FIELDS) {
    const hit = firstNonNull(chain, f);
    fields[f] = hit ? hit.value : null;
    if (hit) provenance[f] = { club: clubId, swing, lie: hit.lie };
  }
  if (fields.totalMedianYds == null) return null;

  const family = familyOf(P, clubId);
  const srcLie = provenance.totalMedianYds.lie;
  // Carry: derive from total unless a measured carry exists on the same lie the total came from.
  const measured = firstNonNull(chain, "carryMedianYds");
  let carry = measured && measured.lie === srcLie && rawEntry(club, swing, srcLie)?.carrySource === "measured"
    ? measured.value
    : carryFromTotal(fields.totalMedianYds, swing, family, srcLie, cfg, opts.wet);
  // Lie adjustment when the distance came from a different lie than the one we are on.
  const adjReq = cfg.LIE_DIST_ADJ[lie] ?? 0, adjSrc = cfg.LIE_DIST_ADJ[srcLie] ?? 0;
  const lieFactor = (1 + adjReq) / (1 + adjSrc);
  carry = carry * lieFactor;
  const sdReq = cfg.LIE_SD_MULT[lie] ?? 1, sdSrc = cfg.LIE_SD_MULT[srcLie] ?? 1;
  const sdMult = sdReq / sdSrc;

  // Lateral σ: same club chain → adjacent clubs same swing/lie → scratch benchmark.
  let lateralSdDeg = fields.lateralSdDeg;
  if (lateralSdDeg == null) {
    const nb = neighbours(P, clubId);
    for (const id of nb) {
      const e = P.clubs.get(id);
      const hit = firstNonNull(chainLies.map((l) => ({ entry: rawEntry(e, swing, l) || rawEntry(e, "full", l), lie: l })), "lateralSdDeg");
      if (hit) { lateralSdDeg = hit.value; provenance.lateralSdDeg = { club: id, swing, lie: hit.lie }; break; }
    }
    if (lateralSdDeg == null && P.scratchLateralSdDeg != null) {
      lateralSdDeg = P.scratchLateralSdDeg;
      provenance.lateralSdDeg = { benchmark: "scratch" };
    }
    if (lateralSdDeg == null) return null;
    fields.lateralSdDeg = lateralSdDeg;
  }

  const distSd = fields.distSdYds != null ? fields.distSdYds * (carry / fields.totalMedianYds) : cfg.DIST_SD_PCT[family] * carry;
  if (fields.distSdYds == null) provenance.distSdYds = { config: "DIST_SD_PCT" };
  const bmRaw = firstNonNull(chain, "bigMiss");
  const bigMiss = {
    left: bmRaw?.value?.left ?? 0,
    right: bmRaw?.value?.right ?? 0,
    latYds: bmRaw?.value?.latYds ?? cfg.BIG_MISS_LAT_YDS_DEFAULT,
  };

  // Roll the ball takes after landing (total − carry before the lie adjustment). 0 wet / tee.
  const roll = opts.wet ? 0 : Math.max(0, fields.totalMedianYds - carry / lieFactor);
  // §5 UI addendum: Shot Pattern's 80% ellipse is the dispersion core where it exists.
  const ellHit = firstNonNull(chain, "ell80");
  const ell80 = ellHit ? { ...ellHit.value, sdMult } : null;
  if (ell80) provenance.ell80 = { club: clubId, swing, lie: ellHit.lie };

  return {
    club: clubId,
    label: club.label,
    family,
    swing,
    lie,
    sourceLie: srcLie,
    carry,
    total: fields.totalMedianYds,
    roll,
    distSd: distSd * sdMult,
    lateralSd: carry * Math.tan((lateralSdDeg * Math.PI) / 180) * sdMult,   // yards, lie-widened like distSd
    lieSdMult: sdMult,
    lateralSdDeg,
    biasDist: fields.biasDistYds ?? 0,
    biasLat: fields.biasLatYds ?? 0,
    bigMiss,
    ell80,
    fields,
    provenance,
  };
}

/** Clubs adjacent to `clubId` in clubOrder, nearest first. */
function neighbours(P, clubId) {
  const i = P.clubOrder.indexOf(clubId);
  const out = [];
  for (let k = 1; k < P.clubOrder.length; k++) {
    if (i - k >= 0) out.push(P.clubOrder[i - k]);
    if (i + k < P.clubOrder.length) out.push(P.clubOrder[i + k]);
  }
  return out;
}

/** Every (club, swing) pair that resolves from this lie. */
export function candidateEntries(P, lie, opts = {}) {
  const out = [];
  for (const id of P.clubOrder) {
    for (const swing of ["full", "finesse"]) {
      const e = resolveEntry(P, id, swing, lie, opts);
      if (e) out.push(e);
    }
  }
  return out;
}

/* ---------- personal strokes gained lookups ---------- */

const BUCKET_LIE = { tee: "fairway", fairway: "fairway", rough: "rough", sand: null, recovery: null, trees: null };
const SHORT_LIE = { tee: "fairway", fairway: "fairway", rough: "rough", sand: "bunker", recovery: "rough", trees: "rough" };

export function bucketFor(P, d, lie) {
  const bl = BUCKET_LIE[lie];
  if (!bl) return null;
  const list = P.buckets[bl] || [];
  for (const b of list) if (d >= b.fromYds && d < b.toYds) return b;
  return null;
}

export function shortBandFor(P, d, lie) {
  const list = P.shortGame[SHORT_LIE[lie]] || [];
  for (const b of list) if (d >= b.fromYds && d < b.toYds) return b;
  return null;
}

/** Brett's strokes gained per shot from `d` on `lie` (0 where he has no data). */
export function personalSg(P, d, lie) {
  if (d < 50) {
    const band = shortBandFor(P, d, lie);
    return band?.sgPerShot ?? 0;
  }
  const b = bucketFor(P, d, lie);
  return b?.sgPerShot ?? 0;
}

/* ---------- §3.5 expected-value functions ---------- */

/**
 * Brett's putting gap at the distance a shot from (d, lie) typically leaves: Eputt(prox) minus the
 * baseline's expected putts from there. The baseline assumes a Tour putter after the shot; this
 * swaps in Brett's, at his own median proximity for that bucket. Falls back to his flat per-hole
 * putting deficit when the bucket has no proximity.
 */
export function puttingGapAt(P, d, lie) {
  if (!P.config.PUTT_DEFICIT_IN_E) return 0;
  const b = d < 50 ? shortBandFor(P, d, lie) : bucketFor(P, d, lie) || (lie === "sand" || lie === "recovery" || lie === "trees" ? bucketFor(P, d, "rough") : null);
  const prox = b?.medianProximityFt;
  if (prox == null) return P.puttDeficitPerHole;
  return Math.max(0, Eputt(P, prox) - baselinePutts(prox));
}

/** E(d, lie): baseline − Brett's SG per shot for the bucket + his putting gap at the typical leave. */
export function E(P, d, lie) {
  const l = lie === "trees" ? "recovery" : lie === "green" ? "fairway" : lie;
  const dr = Math.round(d);                       // 1-yd resolution is finer than any input; the
  const key = `${l}|${dr}`;                       // memo key and the value must use the same d
  const hit = P._E.get(key);
  if (hit !== undefined) return hit;
  const base = baselineE(dr, l) + (P.config.BASELINE_SCRATCH_OFFSET || 0);
  const v = base - personalSg(P, dr, l) + puttingGapAt(P, dr, l);
  P._E.set(key, v);
  return v;
}

export function puttBucket(P, ft) {
  for (const b of P.putting) if (ft >= b.fromFt && (b.toFt == null || ft < b.toFt + 1)) return b;
  return P.putting[P.putting.length - 1];
}

export function makePct(P, ft) { return puttBucket(P, ft)?.makePct ?? 0; }
export function threePuttPct(P, ft) { return puttBucket(P, ft)?.threePuttPct ?? 0; }

/** Eputt(ft) = 1 + (1 − make) + threePutt, from Brett's putting table. */
export function Eputt(P, ft) {
  const key = Math.round(ft);
  const hit = P._Ep.get(key);
  if (hit !== undefined) return hit;
  const v = 1 + (1 - makePct(P, key)) + threePuttPct(P, key);
  P._Ep.set(key, v);
  return v;
}

/** Probability of holing the next shot + one putt from `d` on `lie`: GIR% × make(median proximity). */
export function B2(P, d, lie) {
  const dr = Math.round(d);
  const key = `${lie}|${dr}`;
  const hit = P._B2.get(key);
  if (hit !== undefined) return hit;
  const v = B2raw(P, dr, lie);
  P._B2.set(key, v);
  return v;
}

function B2raw(P, d, lie) {
  if (d < 50) {
    const band = shortBandFor(P, d, lie);
    return band?.upDownPct ?? 0;
  }
  let b = bucketFor(P, d, lie);
  if (!b && (lie === "sand" || lie === "recovery" || lie === "trees")) b = bucketFor(P, d, "rough");
  if (!b) {
    const list = P.buckets[BUCKET_LIE[lie] || "rough"] || [];
    b = list.length ? list[list.length - 1] : null;     // beyond the last bucket → the last one
  }
  if (!b || b.girPct == null || b.medianProximityFt == null) return 0;
  return b.girPct * makePct(P, b.medianProximityFt);
}

/** Best k=2 state reachable with one more (fairway) shot — the §3.5 approximation for k ≥ 3. */
export function B3(P, d) {
  const key = Math.round(d);
  if (P._b3.has(key)) return P._b3.get(key);
  let best = 0;
  for (const e of candidateEntries(P, "fairway")) {
    const leave = key - e.carry;
    if (leave < 0) continue;
    best = Math.max(best, B2(P, leave, "fairway"));
  }
  P._b3.set(key, best);
  return best;
}

/**
 * B(state, k): probability of holing out in ≤ k more strokes.
 * state = { lie: 'green', ft } | { lie, d }
 */
export function B(P, state, k) {
  if (k <= 0) return 0;
  if (state.lie === "green") {
    if (k === 1) return makePct(P, state.ft);
    if (k === 2) return 1 - threePuttPct(P, state.ft);
    return 1;
  }
  if (k === 1) return 0;
  if (k === 2) return B2(P, state.d, state.lie);
  return B3(P, state.d);
}

export const _internal = { LIE_CHAIN, ENTRY_FIELDS, neighbours };
