/*
 * learning.test.js — spec §10 acceptance tests T21–T32 (S5, learning loop) plus unit tests.
 * Run: node --test src/caddie/learning.test.js
 *
 * Profile: an inline v2-shaped profile (below). src/profile.json was still v1 when S5 was written
 * (another session is generating v2), and these tests assert exact numbers against known priors.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, mergeConfig } from "./config.js";
import { loadProfile } from "./profile.js";
import { ellipseSampler } from "./engine.js";
import { makeSamples } from "./random.js";
import {
  familyOf, withinRound, recencyWeight, shrink, priorFor, applyShotLog, entryWithOverlay,
  lieOverrideAt, aggressionScorecard, clubGapYds, fitEll80, entryKey,
} from "./learning.js";

const K = DEFAULT_CONFIG.SHRINK_K;
const N = DEFAULT_CONFIG.TAKEOVER_N;

/* ---------- inline v2 profile ---------- */

function entry(total, extra = {}) {
  return {
    n: 10, totalMedianYds: total, carryMedianYds: null, carrySource: "derived",
    distSdYds: null, lateralSdDeg: null, biasDistYds: null, biasLatYds: null,
    bigMiss: { left: 0, right: 0, latYds: null }, penaltyCount: 0, girPct: null,
    medianProximityFt: null, sgPerShot: null, ...extra,
  };
}
function club(id, label, family, full, finesse = null) {
  return { id, label, family, loftDeg: null, entries: { full, finesse } };
}
function rawProfile() {
  return {
    version: 2,
    generated: "2026-09-28",
    sources: { shotPattern: { window: "Casual · Last 10" } },
    clubOrder: ["Dr", "2Hy", "4Hy", "5i", "6i", "7i", "8i", "9i", "PW", "GW", "SW"],
    clubs: [
      club("Dr", "Driver", "long", { tee: entry(288, { carryMedianYds: 288, distSdYds: 23.7, lateralSdDeg: 5.2, bigMiss: { left: 0.11, right: 0.18, latYds: 54 } }), fairway: null, rough: null }),
      club("2Hy", "2-hybrid", "long", { tee: entry(248, { carryMedianYds: 248, lateralSdDeg: 4.4 }), fairway: entry(224, { lateralSdDeg: 4.1 }), rough: null }),
      club("4Hy", "4-hybrid", "long", { tee: entry(222, { carryMedianYds: 222, lateralSdDeg: 4.6 }), fairway: entry(null, { n: 2 }), rough: null }),
      club("5i", "5-iron", "mid", { tee: null, fairway: entry(196, { lateralSdDeg: 4.3 }), rough: entry(null, { n: 3 }) }),
      club("6i", "6-iron", "mid", { tee: null, fairway: entry(186, { lateralSdDeg: 4.2, distSdYds: 9 }), rough: null }),
      club("7i", "7-iron", "mid", {
        tee: null,
        fairway: entry(176, { n: 12, lateralSdDeg: 4.04, ell80: { wYds: 30, hYds: 40, tiltDeg: 90, dxYds: 1, dyYds: 2, source: "shotPattern", capturedAt: "2026-09-19", lies: "all", confidence: "low" } }),
        rough: entry(null, { n: 5 }),
      }),
      club("8i", "8-iron", "short", { tee: null, fairway: entry(166, { lateralSdDeg: 3.9 }), rough: entry(null, { n: 4 }) }),
      club("9i", "9-iron", "short", { tee: null, fairway: entry(155, { lateralSdDeg: 3.7 }), rough: null }),
      club("PW", "Pitching wedge", "short", { tee: null, fairway: entry(141, { lateralSdDeg: 3.5, ell80: { wYds: 16.7, hYds: 23.7, tiltDeg: 39.9, dxYds: -0.2, dyYds: 1.1, source: "shotPattern" } }), rough: null }),
      club("GW", "Gap wedge", "wedge", { tee: null, fairway: entry(119, { blended: true }), rough: null }, { tee: null, fairway: entry(null, { n: null }), rough: null }),
      club("SW", "Sand wedge", "wedge", { tee: null, fairway: entry(null), rough: null }, { tee: null, fairway: entry(95, { blended: true, lateralSdDeg: 4.8 }), rough: null }),
    ],
    approachBuckets: [],
    putting: [{ fromFt: 0, toFt: null, n: 1, makePct: 0.5, threePuttPct: 0.05 }],
    shortGame: { bands: [] },
  };
}
const P = loadProfile(rawProfile());

/* ---------- shot records (§4.6, only the fields learning reads) ---------- */

let seq = 0;
function shot({ round = "r1", course = "c1", hole, shotNo = 2, club = "7i", swing = "full", lie = "fairway",
  dist = 0, lat = 0, on = null, intended = null, contact = 0, logged = "full", line = null, ts = null, rec = null }) {
  seq++;
  return {
    id: `s${seq}`, schema: 1, roundId: round, courseId: course, hole, shotNo,
    ts: ts ?? new Date(Date.UTC(2026, 8, 20, 12, 0, seq)).toISOString(),
    lie: { inferred: lie, confidence: "high", confirmed: lie, quality: "standard" },
    club, shotType: swing, linePlayed: line, contact, strike: "center", logged,
    recommendation: rec,
    derived: { distanceMissYds: dist, lateralMissYds: lat, onTarget: on ?? (dist === 0 && lat === 0), ...(intended != null ? { intendedYds: intended } : {}) },
  };
}

const opts = { P };

/* ---------- families and gaps ---------- */

test("familyOf: CLUB_FAMILY table, wedges GW and below, patterns for clubs outside the bag", () => {
  assert.equal(familyOf("Dr"), "long");
  assert.equal(familyOf("2i"), "long");
  assert.equal(familyOf("4Hy"), "long");
  assert.equal(familyOf("6i"), "mid");
  assert.equal(familyOf("PW"), "short");
  assert.equal(familyOf("GW"), "wedge");
  assert.equal(familyOf("LW"), "wedge");
  assert.equal(familyOf({ id: "SW" }), "wedge");
  assert.equal(familyOf("3W"), "long");
  assert.equal(familyOf("4i"), "long");
  assert.equal(familyOf("9i"), "short");
  assert.equal(familyOf("56"), "wedge");
  assert.equal(familyOf("putter"), null);
});

test("clubGapYds: derived from the profile's carries, overridable", () => {
  const g = clubGapYds(P);
  assert.equal(g.mid, 10, "5i/6i/7i carries 190/180/170");
  assert.ok(g.long > 0 && g.short > 0 && g.wedge > 0);
  assert.equal(clubGapYds(P, { mid: 12 }).mid, 12);
  assert.equal(clubGapYds(null).mid, 10, "no profile → default gap");
});

/* ---------- §5.5 within-round: T21–T27 ---------- */

test("T21 one short miss → no nudge", () => {
  const r = withinRound([shot({ hole: 4, dist: -12, intended: 170 })], DEFAULT_CONFIG, opts);
  assert.deepEqual(r.nudges, []);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.adjust.distYds, {});
  assert.deepEqual(r.adjust.aimYds, {});
});

test("T22 two short misses, same family → distance nudge with holes cited", () => {
  const r = withinRound([
    shot({ hole: 4, club: "7i", dist: -10, intended: 170 }),
    shot({ hole: 9, club: "6i", dist: -12, intended: 180 }),
  ], DEFAULT_CONFIG, opts);
  assert.equal(r.nudges.length, 1);
  assert.equal(r.nudges[0].axis, "distance");
  assert.equal(r.nudges[0].text, "Short twice with mid irons (H4, H9) → +½ club");
  assert.equal(r.adjust.distYds.mid, 5.5, "50% of the mean miss (−11) → plays 5.5 longer");
  assert.deepEqual(r.adjust.aimYds, {});
  assert.equal(r.adjust.distYds.short, undefined, "other families untouched");
});

test("T23 two short-left misses → distance AND direction, one combined line", () => {
  const r = withinRound([
    shot({ hole: 4, club: "7i", dist: -10, lat: -12, intended: 170 }),
    shot({ hole: 9, club: "6i", dist: -12, lat: -14, intended: 180 }),
  ], DEFAULT_CONFIG, opts);
  assert.equal(r.nudges.length, 1, "one combined line (the fairway-lie reading of the same shots is not repeated)");
  assert.equal(r.nudges[0].text, "Short-left twice with mid irons (H4, H9) → +½ club, aim right-center");
  assert.equal(r.nudges[0].axis, "distance+direction");
  assert.equal(r.adjust.distYds.mid, 5.5);
  assert.equal(r.adjust.aimYds.mid, 6.5, "aim right by 50% of the mean left miss (−13)");
  assert.deepEqual(r.adjust.clampTo, ["fairway", "green"], "target stays inside the fairway / green polygon");
});

test("T24 two pulls left, distances on → direction nudge only; club unchanged", () => {
  const r = withinRound([
    shot({ hole: 4, club: "7i", dist: 1, lat: -12, intended: 170 }),
    shot({ hole: 9, club: "5i", dist: -2, lat: -14, intended: 190 }),
  ], DEFAULT_CONFIG, opts);
  assert.equal(r.nudges.length, 1);
  assert.equal(r.nudges[0].axis, "direction");
  assert.equal(r.nudges[0].text, "Left twice with mid irons (H4, H9) → aim right-center");
  assert.deepEqual(r.adjust.distYds, {}, "no plays-like change");
  assert.equal(r.adjust.aimYds.mid, 6.5);
});

test("T25 two fat shots → contact flag only; no numeric change", () => {
  const r = withinRound([
    shot({ hole: 3, club: "GW", contact: -1, intended: 110 }),
    shot({ hole: 6, club: "SW", swing: "finesse", contact: -2, intended: 90 }),
  ], DEFAULT_CONFIG, opts);
  assert.deepEqual(r.nudges, []);
  assert.deepEqual(r.adjust.distYds, {});
  assert.deepEqual(r.adjust.aimYds, {});
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].type, "contact");
  assert.equal(r.flags[0].text, "2 fat wedges today (H3, H6)");
});

test("T26 five short misses → distance correction capped at 1 club", () => {
  const shots = [2, 4, 6, 9, 11].map((h) => shot({ hole: h, club: "7i", dist: -30, intended: 170 }));
  const r = withinRound(shots, DEFAULT_CONFIG, opts);
  const gap = clubGapYds(P).mid;
  assert.equal(r.adjust.distYds.mid, gap, "raw shift 15 yds, capped at one mid-iron gap (10)");
  assert.equal(r.nudges[0].text, "Short 5 times with mid irons (H2, H4, H6, H9, H11) → +1 club");
  const c = r.corrections.find((x) => x.axis === "distance" && x.group.kind === "family");
  assert.equal(c.capped, true);
  assert.equal(c.rawShiftYds, 15);
  // A caller-supplied gap map wins over the derived gap.
  const r2 = withinRound(shots, DEFAULT_CONFIG, { P, gapYds: { mid: 12 } });
  assert.equal(r2.adjust.distYds.mid, 12);
});

test("T27 two on-target shots after a nudge → correction clears", () => {
  const miss = [shot({ hole: 4, dist: -10, intended: 170 }), shot({ hole: 9, club: "6i", dist: -12, intended: 180 })];
  assert.equal(withinRound(miss, DEFAULT_CONFIG, opts).nudges.length, 1);
  const cleared = withinRound([...miss, shot({ hole: 11, on: true }), shot({ hole: 12, club: "5i", on: true })], DEFAULT_CONFIG, opts);
  assert.deepEqual(cleared.nudges, []);
  assert.deepEqual(cleared.adjust.distYds, {});
  assert.deepEqual(cleared.corrections, []);
});

test("clearing needs two CONSECUTIVE on-target shots in that family", () => {
  const shots = [
    shot({ hole: 4, dist: -10, intended: 170 }),
    shot({ hole: 9, club: "6i", dist: -12, intended: 180 }),
    shot({ hole: 10, on: true }),
    shot({ hole: 11, club: "6i", dist: 0, lat: 9, intended: 180 }),  // a push: breaks the streak
    shot({ hole: 12, on: true }),
  ];
  const r = withinRound(shots, DEFAULT_CONFIG, opts);
  assert.equal(r.adjust.distYds.mid, 5.5, "still active");
  // On-target shots in ANOTHER family do not clear the mid-iron correction.
  const other = withinRound([...shots.slice(0, 2), shot({ hole: 13, club: "PW", on: true }), shot({ hole: 14, club: "9i", on: true })], DEFAULT_CONFIG, opts);
  assert.equal(other.adjust.distYds.mid, 5.5);
});

test("skipped shots are not evidence (§4.4 / T19)", () => {
  const r = withinRound([
    shot({ hole: 4, dist: -10, intended: 170 }),
    shot({ hole: 9, club: "6i", dist: -12, intended: 180, logged: "skipped" }),
  ], DEFAULT_CONFIG, opts);
  assert.deepEqual(r.nudges, []);
});

test("same lie type across families: applies to every family only when the next shot is from that lie", () => {
  const shots = [
    shot({ hole: 3, club: "7i", lie: "rough", dist: -12, intended: 170 }),
    shot({ hole: 6, club: "PW", lie: "rough", dist: -10, intended: 140 }),
  ];
  const fromRough = withinRound(shots, DEFAULT_CONFIG, { P, lie: "rough" });
  assert.equal(fromRough.nudges.length, 1);
  assert.equal(fromRough.nudges[0].text, "Short twice from rough (H3, H6) → +½ club");
  for (const f of ["long", "mid", "short", "wedge"]) assert.equal(fromRough.adjust.distYds[f], 5.5, f);
  const fromFairway = withinRound(shots, DEFAULT_CONFIG, { P, lie: "fairway" });
  assert.deepEqual(fromFairway.nudges, []);
  assert.deepEqual(fromFairway.adjust.distYds, {});
  assert.equal(fromFairway.corrections.length, 1);
  assert.equal(fromFairway.corrections[0].applies, false);
});

test("long misses → club down, right misses → aim left", () => {
  const r = withinRound([
    shot({ hole: 1, club: "8i", dist: 12, lat: 10, intended: 160 }),
    shot({ hole: 2, club: "9i", dist: 10, lat: 12, intended: 150 }),
  ], DEFAULT_CONFIG, opts);
  assert.ok(r.adjust.distYds.short < 0);
  assert.ok(r.adjust.aimYds.short < 0);
  assert.match(r.nudges[0].text, /^Long-right twice with short irons \(H1, H2\) → −½ club, aim left-center$/);
});

/* ---------- §5.3 recency: T28 ---------- */

test("T28 recency tiers apply the configured weights", () => {
  const w = (r, m) => recencyWeight(r, m, DEFAULT_CONFIG);
  assert.equal(w(1, 0), 1.0); assert.equal(w(3, 1), 1.0);
  assert.equal(w(4, 1), 0.5); assert.equal(w(8, 1), 0.5);
  assert.equal(w(9, 1), 0.2); assert.equal(w(20, 1), 0.2);
  assert.equal(w(21, 1), 0);
  assert.equal(w(2, 13), 0, "> 12 months → excluded");
  assert.equal(w(2, 12), 1.0);
  // Tuned tiers are honoured, not the defaults.
  const tuned = mergeConfig({ RECENCY_TIERS: [[2, 0.9], [5, 0.3]], RECENCY_MAX_MONTHS: 6 });
  assert.equal(recencyWeight(2, 1, tuned), 0.9);
  assert.equal(recencyWeight(3, 1, tuned), 0.3);
  assert.equal(recencyWeight(6, 1, tuned), 0);
  assert.equal(recencyWeight(1, 7, tuned), 0);
  // …and they carry through into the overlay's effective sample size.
  const idx = { a: 1, b: 5, c: 10, d: 25 };
  const shots = ["a", "b", "c", "d"].map((round) => shot({ round, hole: 1, dist: -5, lat: 2, intended: 170 }));
  const ov = applyShotLog(P, shots, { roundIndexById: idx }, DEFAULT_CONFIG)[entryKey("7i", "full", "fairway")];
  assert.ok(Math.abs(ov.nEff - (1 + 0.5 + 0.2)) < 1e-12);
  assert.equal(ov.n, 3, "the round 25 shot weighs 0 and is excluded");
  const ovTuned = applyShotLog(P, shots, { roundIndexById: idx }, tuned)[entryKey("7i", "full", "fairway")];
  assert.ok(Math.abs(ovTuned.nEff - (0.9 + 0.3)) < 1e-12, "rounds a (0.9) and b (0.3); c and d fall outside the tuned tiers");
});

test("recency: 12-month cut-off from the caller's `now`; round order derived when no index given", () => {
  const old = shot({ round: "old", hole: 1, dist: -5, intended: 170, ts: "2025-08-01T12:00:00Z" });
  const fresh = shot({ round: "new", hole: 1, dist: -3, intended: 170, ts: "2026-09-20T12:00:00Z" });
  const ov = applyShotLog(P, [old, fresh], { now: "2026-09-28T00:00:00Z" })[entryKey("7i", "full", "fairway")];
  assert.equal(ov.n, 1);
  assert.equal(ov.nEff, 1);
});

/* ---------- §5.4 shrinkage: T29 ---------- */

test("shrink and priorFor: formula and preference order", () => {
  assert.equal(shrink(10, 0, 5, 5), 5);
  assert.equal(shrink(null, 7, 3, 5), 7);
  assert.equal(shrink(9, null, 3, 5), 9);
  assert.equal(shrink(9, 7, 0, 5), 7);
  assert.deepEqual(priorFor(P, "7i", "full", "fairway", "totalMedianYds"), { value: 176, club: "7i", swing: "full", lie: "fairway", rank: "entry" });
  assert.deepEqual(priorFor(P, "7i", "full", "rough", "lateralSdDeg"), { value: 4.04, club: "7i", swing: "full", lie: "fairway", rank: "adjacentLie" });
  assert.deepEqual(priorFor(P, "6i", "full", "fairway", "ell80")?.rank, "adjacentClub");
  assert.equal(priorFor(P, "6i", "full", "fairway", "ell80").club, "7i", "nearest club first");
  assert.equal(priorFor(P, "SW", "full", "fairway", "girPct"), null, "no prior anywhere → null (caller uses baseline)");
});

test("T29 a bucket with n = 1 moves at most 1/(1+K) of the way from prior to that shot", () => {
  const s = shot({ hole: 5, dist: 24, lat: 12, intended: 176 });   // flew 200 against a 176 prior
  const ov = applyShotLog(P, [s], {})[entryKey("7i", "full", "fairway")];
  assert.equal(ov.n, 1);
  assert.equal(ov.takeover, false);
  const frac = 1 / (1 + K);
  const prior = 176, personal = 200;
  assert.ok(Math.abs(ov.totalMedianYds - prior) <= frac * Math.abs(personal - prior) + 1e-9);
  assert.ok(Math.abs(ov.totalMedianYds - 180) < 1e-9, "(1·200 + 5·176)/6 = 180");
  assert.ok(Math.abs(ov.biasLatYds - 12 * frac) < 1e-9, "lateral bias from a 0 baseline");
  assert.ok(Math.abs(ov.biasDistYds - 24 * frac) < 1e-9);
  assert.equal(ov.lateralSdDeg, 4.04, "one shot has no spread → σ stays the prior");
  const merged = entryWithOverlay(P, { [ov.key]: ov }, "7i", "full", "fairway");
  assert.equal(merged.totalMedianYds, 180);
  assert.equal(merged.ell80.source, "shotPattern", "below takeover Shot Pattern's ellipse stays");
  assert.equal(merged.learning.source, "blend");
});

/* ---------- §5.2 takeover: T30 ---------- */

function loopShots(n, clubId = "7i", lie = "fairway") {
  const out = [];
  for (let i = 0; i < n; i++) {
    const dm = ((i * 7) % 11) - 6;            // −6 … +4, deterministic spread
    const lm = ((i * 5) % 9) - 3;             // −3 … +5
    out.push(shot({ round: `r${1 + (i % 3)}`, hole: 1 + (i % 18), club: clubId, lie, dist: dm, lat: lm, intended: 170, on: false }));
  }
  return out;
}

test("T30 at ≥ TAKEOVER_N Loop shots, Loop numbers replace Shot Pattern's for that entry only", () => {
  const shots = [...loopShots(N), ...loopShots(4, "6i")];
  const ovs = applyShotLog(P, shots, { now: "2026-09-28T00:00:00Z" });
  const ov = ovs[entryKey("7i", "full", "fairway")];
  assert.equal(ov.n, N);
  assert.equal(ov.takeover, true);
  const e = entryWithOverlay(P, ovs, "7i", "full", "fairway");
  // Loop's own numbers, unshrunk:
  assert.equal(e.totalMedianYds, ov.personal.totalMedianYds);
  assert.equal(e.distSdYds, ov.personal.distSdYds);
  assert.equal(e.lateralSdDeg, ov.personal.lateralSdDeg);
  assert.equal(e.biasDistYds, ov.personal.biasDistYds);
  assert.notEqual(e.lateralSdDeg, 4.04);
  assert.equal(e.n, N);
  assert.equal(e.ell80.source, "loop");
  assert.equal(e.ell80.n, N);
  assert.ok(e.ell80.wYds >= e.ell80.hYds && e.ell80.hYds > 0);
  assert.ok(Math.abs(e.ell80.dxYds - ov.personal.biasLatYds) < 1e-9, "dx = mean lateral");
  assert.ok(Math.abs(e.ell80.dyYds + ov.personal.biasDistYds) < 1e-9, "dy = −mean distance miss (+y short)");
  assert.equal(e.learning.takeover, true);
  // Every other entry keeps Shot Pattern's numbers.
  const sixFw = entryWithOverlay(P, ovs, "6i", "full", "fairway");
  assert.equal(ovs[entryKey("6i", "full", "fairway")].takeover, false);
  assert.equal(sixFw.lateralSdDeg !== ovs[entryKey("6i", "full", "fairway")].personal.lateralSdDeg, true, "6i below takeover → blended, not replaced");
  assert.equal(sixFw.ell80, undefined, "6i had no ell80 and gets none");
  const sevenRough = entryWithOverlay(P, ovs, "7i", "full", "rough");
  assert.deepEqual({ ...sevenRough, learning: undefined }, { ...P.raw.clubs.find((c) => c.id === "7i").entries.full.rough, learning: undefined });
  const pw = entryWithOverlay(P, ovs, "PW", "full", "fairway");
  assert.deepEqual(pw.ell80, P.raw.clubs.find((c) => c.id === "PW").entries.full.fairway.ell80);
  // One shot short of the threshold → still Shot Pattern's ellipse.
  const below = applyShotLog(P, loopShots(N - 1), {});
  assert.equal(below[entryKey("7i", "full", "fairway")].takeover, false);
  assert.equal(entryWithOverlay(P, below, "7i", "full", "fairway").ell80.source, "shotPattern");
});

test("fitEll80 recovers a known ellipse from its own samples (engine sampler round trip)", () => {
  const ell = { wYds: 40, hYds: 20, tiltDeg: 30, dxYds: 3, dyYds: -2 };
  const sample = ellipseSampler(ell);
  const pts = makeSamples(20000, 99).map(({ z1, z2 }) => sample(z1, z2));
  const fit = fitEll80(pts.map((p) => p.lat), pts.map((p) => p.alongMiss));
  assert.ok(Math.abs(fit.wYds - 40) < 1, `w ${fit.wYds}`);
  assert.ok(Math.abs(fit.hYds - 20) < 0.6, `h ${fit.hYds}`);
  assert.ok(Math.abs(fit.tiltDeg - 30) < 2, `tilt ${fit.tiltDeg}`);
  assert.ok(Math.abs(fit.dxYds - 3) < 0.5 && Math.abs(fit.dyYds + 2) < 0.5);
  assert.equal(fit.source, "loop");
});

/* ---------- §5.6 lie overrides: T31 ---------- */

// ~1 m of latitude = 1/111_195 degrees.
const M = 1 / 111195;
const base = { lat: 34.0, lng: -84.0 };
const at = (dN, dE = 0) => ({ lat: base.lat + dN * M, lng: base.lng + (dE * M) / Math.cos(base.lat * Math.PI / 180) });

test("T31 two lie corrections within 15 m → inference inside that radius returns the corrected lie", () => {
  const ov = [
    { courseId: "c1", hole: 7, gps: at(0), inferred: "fairway", corrected: "rough", ts: "2026-09-01T12:00:00Z" },
    { courseId: "c1", hole: 7, gps: at(8), inferred: "fairway", corrected: "rough", ts: "2026-09-20T12:00:00Z" },
  ];
  assert.equal(lieOverrideAt(ov, at(4), "c1"), "rough");
  assert.equal(lieOverrideAt(ov, at(4, 5), "c1"), "rough");
  assert.equal(lieOverrideAt(ov, at(40), "c1"), null, "outside the radius");
  assert.equal(lieOverrideAt(ov, at(4), "c2"), null, "other course");
  assert.equal(lieOverrideAt(ov.slice(0, 1), at(0), "c1"), null, "one correction is not enough");
  const apart = [ov[0], { ...ov[1], gps: at(30) }];
  assert.equal(lieOverrideAt(apart, at(15), "c1"), null, "two corrections 30 m apart are not a cluster");
  const mixed = [ov[0], { ...ov[1], corrected: "sand" }];
  assert.equal(lieOverrideAt(mixed, at(4), "c1"), null, "different corrected values don't combine");
  assert.equal(lieOverrideAt(ov, at(4), "c1", { radiusM: 5 }), null, "radius is tunable");
});

/* ---------- §5.7 aggression scorecard ---------- */

test("aggression scorecard: counts per line and the sign of 'paid' vs 'cost'", () => {
  const rec = (safe, aggressive) => ({ safe: { club: "5i", expScore: safe }, aggressive: aggressive == null ? null : { club: "2Hy", expScore: aggressive }, sameShot: aggressive == null });
  const shots = [
    // r1 H5: went at it from shot 2, priced 3.2 to hole out, made 4 → 3 strokes from there: beat the price by 0.2.
    shot({ round: "r1", hole: 5, shotNo: 2, line: "aggressive", rec: rec(3.0, 3.2) }),
    shot({ round: "r1", hole: 6, shotNo: 1, line: "safe", rec: rec(4.1, 4.3) }),
    shot({ round: "r1", hole: 7, shotNo: 1, line: "own", rec: rec(3.9, 4.0) }),
    // r2 H3: priced 2.5, made 5 → 4 strokes from shot 2: cost 1.5.
    shot({ round: "r2", hole: 3, shotNo: 2, line: "aggressive", rec: rec(2.4, 2.5) }),
  ];
  const scores = { r1: { 5: 4, 6: 4, 7: 5 }, r2: { 3: 5 } };
  const a = aggressionScorecard(shots, scores);
  assert.equal(a.safe.n, 1); assert.equal(a.aggressive.n, 2); assert.equal(a.own.n, 1);
  assert.equal(a.rounds.r1.text, "Aggression paid +0.2");
  assert.ok(Math.abs(a.rounds.r1.aggressive.delta - -0.2) < 1e-9, "delta = actual − expected (negative = beat it)");
  assert.equal(a.rounds.r2.text, "Aggression cost −1.5");
  assert.ok(Math.abs(a.aggressive.delta - 1.3) < 1e-9);
  assert.equal(a.text, "Aggression cost −1.3");
  assert.ok(Math.abs(a.safe.delta - (4 - 4.1)) < 1e-9);
  assert.ok(Math.abs(a.own.delta - (5 - 3.9)) < 1e-9, "own call is measured against the SAFE price");
  assert.equal(aggressionScorecard([shots[1]], scores).text, null, "no aggressive shots → no line");
});

/* ---------- source separation: T32 ---------- */

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

test("T32 source separation: no code path writes Loop shot-log data into the loaded profile", () => {
  const Pf = loadProfile(rawProfile());
  const before = JSON.stringify(Pf.raw);
  deepFreeze(Pf.raw);                                  // any write into the profile now throws
  const shots = [...loopShots(N + 2), ...loopShots(3, "PW"), ...loopShots(2, "SW", "fairway").map((s) => ({ ...s, shotType: "finesse" }))];
  shots.push(shot({ hole: 4, dist: -10, lat: -12, intended: 170, contact: -1, line: "aggressive", rec: { safe: { expScore: 3 }, aggressive: { expScore: 3.1 } } }));
  const ovs = applyShotLog(Pf, shots, { now: "2026-09-28T00:00:00Z" });
  withinRound(shots, Pf.config, { P: Pf, lie: "fairway" });
  for (const [id] of Pf.clubs) for (const sw of ["full", "finesse"]) for (const lie of ["tee", "fairway", "rough"]) {
    const e = entryWithOverlay(Pf, ovs, id, sw, lie);
    if (e) { e.totalMedianYds = -1; if (e.ell80) e.ell80.wYds = -1; }   // mutating the merged copy is harmless
  }
  aggressionScorecard(shots, { r1: { 4: 5 } });
  clubGapYds(Pf);
  priorFor(Pf, "7i", "full", "fairway", "totalMedianYds");
  assert.equal(JSON.stringify(Pf.raw), before);
  for (const c of Pf.raw.clubs) assert.equal(Pf.clubs.get(c.id), c, "P.clubs still holds the raw club objects");
  assert.ok(!Object.values(ovs).some((o) => Object.values(Pf.raw.clubs).some((c) => Object.values(c.entries.full || {}).includes(o))));
});
