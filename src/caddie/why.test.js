/*
 * why.test.js — v22.18 (C1, D91): the "why" line on the map. R1 (Brett, Oct 4): "Full" — the main
 * reason, plus today's adjustment when there is one. Pins the wording per rule (reasons.js whyLine),
 * the facts recommend() hands it (engine.js whyFacts) and caddieView's `why`.
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { whyLine, todayClause, clubName, oneIn } from "./reasons.js";
import { familyOf } from "./learning.js";
import { loadProfile } from "./profile.js";
import { recommend } from "./engine.js";
import { caddieView, initialCaddie } from "./caddieState.js";
import { toOverpass } from "../localGeometry.js";
import { parseOverpass } from "../geometry.js";
import { buildHole } from "./geo.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = loadProfile(JSON.parse(readFileSync(join(here, "../profile.json"), "utf8")));

/** An option as recommend() formats it (only the fields the line reads). */
const opt = (club, label, o = {}) => ({ club, label, swingType: "full", target: { x: 0, y: 150, label: "green, center" }, expScore: 3.1, parProb: 0.6, birdieProb: 0.1, ...o });
const res = (safe, why = {}, extra = {}) => ({ safe, aggressive: null, sameShot: true, nudges: [], why: { rule: null, alt: null, ...why }, ...extra });
const line = (r, o) => whyLine(r, { family: familyOf, ...o })?.text;

test("clubName and oneIn: the words the line uses for clubs and rates", () => {
  assert.equal(clubName(opt("Dr", "Driver")), "Driver");
  assert.equal(clubName(opt("Dr", "Driver"), { mid: true }), "the driver");
  assert.equal(clubName(opt("2Hy", "2-hybrid"), { mid: true }), "the 2-hybrid");
  assert.equal(clubName(opt("PW", "Pitching wedge")), "PW", "wedges by their letters");
  assert.equal(clubName(opt("GW", "Gap wedge", { swingType: "finesse" })), "GW (finesse)");
  assert.equal(oneIn(0.33), "1 in 3");
  assert.equal(oneIn(0.29), "1 in 3");
  assert.equal(oneIn(0.5), "1 in 2");
  assert.equal(oneIn(0.7), "7 in 10");
  assert.equal(oneIn(0), null);
});

test("pin rule, front / back: to the middle (or the fat side), and the short rate when it is 20% or more", () => {
  assert.equal(line(res(opt("7i", "7-iron"), { rule: "pin-back", pin: "back", shortPct: 0.33 })),
    "7-iron to the middle: back pin, and you finish short 1 in 3.");
  assert.equal(line(res(opt("9i", "9-iron"), { rule: "pin-front", pin: "front", shortPct: 0 })), "9-iron to the middle: front pin.");
  assert.equal(line(res(opt("8i", "8-iron", { target: { x: 4, y: 160, label: "green, fat side" } }), { rule: "pin-back", pin: "back", shortPct: 0.1 })),
    "8-iron to the fat side: back pin.");
});

test("pin rule, middle pin: a wedge goes at it; anything longer plays to the middle", () => {
  assert.equal(line(res(opt("PW", "Pitching wedge"), { rule: "pin-middle", pin: "middle", attack: true })), "PW at the flag: middle pin, wedge in hand.");
  assert.equal(line(res(opt("7i", "7-iron"), { rule: "pin-middle", pin: "middle", attack: false })), "7-iron to the middle: only wedges go at the flag.");
});

test("no hero: a punch-out says nothing is clean; a clean shot names the one that isn't", () => {
  assert.equal(line(res(opt("9i", "9-iron"), { rule: "no-hero", punchOut: true, lieType: "recovery", noHeroMaxTrouble: 0.1 })),
    "Punch out: from the trees, nothing stays clean 9 times in 10.");
  assert.equal(line(res(opt("6i", "6-iron"), { rule: "no-hero", punchOut: false, lieType: "rough", lieQuality: "bad", noHeroMaxTrouble: 0.1, alt: opt("4Hy", "4-hybrid") })),
    "6-iron: from a bad lie, it stays clean 9 times in 10; the 4-hybrid doesn't.");
  assert.equal(line(res(opt("6i", "6-iron"), { rule: "no-hero", punchOut: false, lieType: "rough", lieQuality: "buried", noHeroMaxTrouble: 0.2 })),
    "6-iron: from a buried lie, it stays clean 8 times in 10.", "the threshold is read from config, not hard-coded");
});

test("driver: the club it beat, and how much closer it leaves you", () => {
  const dr = opt("Dr", "Driver", { leaveYds: 100 });
  assert.equal(line(res(dr, { rule: "driver", alt: opt("2Hy", "2-hybrid", { leaveYds: 130 }) })), "Driver: the 2-hybrid scores the same and leaves 30 yds more.");
  assert.equal(line(res(dr, { rule: "driver", alt: opt("2i", "2-iron", { leaveYds: 103 }) })), "Driver: the 2-iron scores the same.", "under 5 yds isn't worth saying");
});

test("par ranking: the best par chance against the shot the old ranking picked; equal when printed → the plain line", () => {
  assert.equal(line(res(opt("2Hy", "2-hybrid", { parProb: 0.401 }), { rule: "par", alt: opt("Dr", "Driver", { parProb: 0.388 }) })),
    "2-hybrid: best chance at par, 40% (driver 39%).");
  assert.equal(line(res(opt("Dr", "Driver", { parProb: 0.392 }), { rule: "par", alt: opt("Dr", "Driver", { parProb: 0.389 }) })),
    "Driver: best chance at par from here, 39%.");
});

test("no rule fired: the best par chance from here", () => {
  assert.equal(line(res(opt("4Hy", "4-hybrid", { parProb: 0.61 }))), "4-hybrid: best chance at par from here, 61%.");
});

test("Aggressive on screen: the best birdie chance and what it costs on average; Custom and no call → no line", () => {
  const r = { ...res(opt("2Hy", "2-hybrid")), sameShot: false, aggressive: opt("Dr", "Driver", { birdieProb: 0.14, deltaExp: 0.2 }) };
  assert.equal(line(r, { opt: "aggressive" }), "Driver: best birdie chance, 14% (+0.2 strokes).");
  assert.equal(line({ ...r, aggressive: { ...r.aggressive, deltaExp: 0.02 } }, { opt: "aggressive" }), "Driver: best birdie chance, 14% (same average).");
  assert.equal(line(r, { opt: "aggressive", custom: true }), undefined);
  assert.equal(whyLine({ safe: null }), null);
  assert.equal(line({ ...r, sameShot: true }, { opt: "aggressive" }), "2-hybrid: best chance at par from here, 60%.", "same shot → SAFE's line");
});

/* ---------- today's clause ---------- */

const nudge = (o) => ({ text: "x", group: { kind: "family", key: "mid" }, phrase: "with mid irons", times: 2, holes: [4, 7], dist: "short", dirn: null, shiftYds: 5.5, gapYds: 10, ...o });

test("today's clause: the nudge for this club's family, after the main reason", () => {
  const r = res(opt("7i", "7-iron"), { rule: "pin-back", pin: "back", shortPct: 0 }, { nudges: [nudge()] });
  assert.equal(line(r), "7-iron to the middle: back pin · clubbed up: short with mid irons on 4 and 7 today.");
  const lr = res(opt("7i", "7-iron"), {}, { nudges: [nudge({ dist: "long", dirn: "right", shiftYds: -6, holes: [2, 5, 8], times: 3 })] });
  assert.equal(line(lr), "7-iron: best chance at par from here, 60% · clubbed down, aiming left-center: long-right with mid irons on 2, 5 and 8 today.");
});

test("today's clause: under half a club says the yards; another family's nudge stays out; a lie nudge applies to any club", () => {
  assert.equal(todayClause([nudge({ shiftYds: 2 })], "7i", "mid").text, "playing it 2 yds longer: short with mid irons on 4 and 7 today", "the nudge itself reads +2 yds");
  assert.equal(todayClause([nudge({ group: { kind: "family", key: "wedge" }, phrase: "with wedges" })], "7i", "mid"), null);
  assert.equal(todayClause([nudge({ group: { kind: "lie", key: "rough" }, phrase: "from rough", dist: null, dirn: "left" })], "7i", "mid").text,
    "aiming right-center: left from rough on 4 and 7 today");
  assert.equal(todayClause([{ text: "an old nudge with no fields" }], "7i", "mid"), null, "pre-v22.18 nudges are skipped");
});

/* ---------- the engine's facts ---------- */

const chicopee = parseOverpass(toOverpass(JSON.parse(readFileSync(join(here, "../localGeometry/chicopee.json"), "utf8"))));
const village1 = (() => { const k = Object.keys(chicopee.holes).find((x) => chicopee.holes[x].name === "Village 1"); return buildHole(chicopee, k, { par: 4 }); })();

test("recommend(): `why` names the deciding rule and the shot SAFE would have been without it", () => {
  const tee = recommend({ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par: 4 }, village1, P);
  assert.deepEqual(tee.strategy, ["par"]);
  assert.equal(tee.why.rule, "par");
  assert.ok(tee.why.alt && tee.why.alt.club !== tee.safe.club, `without the par ranking: ${tee.why.alt?.club}`);
  const c = village1.green.center;
  const trees = recommend({ shotNo: 2, ball: { x: c.x + 25, y: c.y - 150 }, lieType: "recovery", par: 4, pinPos: "middle" }, village1, P);
  assert.equal(trees.why.rule, "no-hero");
  assert.equal(trees.why.punchOut, true);
  assert.equal(whyLine(trees, { family: familyOf }).text, "Punch out: from the trees, nothing stays clean 9 times in 10.");
});

test("every SAFE with a non-empty strategy gets a line naming its rule (bundled maps, tee + approaches)", () => {
  let named = 0;
  for (const n of ["chicopee", "woodmont", "riverpines", "hampton"]) {
    const geo = parseOverpass(toOverpass(JSON.parse(readFileSync(join(here, "../localGeometry", `${n}.json`), "utf8"))));
    for (const k of Object.keys(geo.holes)) {
      const par = Number(geo.holes[k].par) || 4;
      const h = buildHole(geo, k, { par });
      if (!h) continue;
      const c = h.green.center;
      for (const ctx of [{ shotNo: 1, ball: { x: 0, y: 0 }, lieType: "tee", par },
        { shotNo: 2, ball: { x: c.x, y: c.y - 150 }, lieType: "fairway", par, pinPos: "back" },
        { shotNo: 2, ball: { x: c.x + 25, y: c.y - 150 }, lieType: "recovery", par, pinPos: "middle" }]) {
        const r = recommend(ctx, h, P);
        if (!r?.safe) continue;
        const w = whyLine(r, { family: familyOf });
        assert.ok(w && w.text.length > 10 && w.text.endsWith("."), `${n} ${k}: ${w?.text}`);
        if (r.strategy.length) { named++; assert.ok(r.strategy.includes(w.rule), `${n} ${k}: ${r.strategy} → ${w.rule}`); }
        else assert.equal(w.rule, null);
      }
    }
  }
  assert.ok(named > 20, `${named} rule-driven calls checked`);
});

test("caddieView: `why` for the option on screen; none before the tee or without a call", () => {
  const r = { context: { distances: { front: 140, center: 150, back: 160, pin: 150 }, playsLike: 150, wind: null },
    ...res(opt("7i", "7-iron"), { rule: "pin-back", pin: "back", shortPct: 0 }) };
  const ready = caddieView({ state: { ...initialCaddie(7), phase: "ready", ball: { lat: 0, lng: 0 } }, par: 4, res: r, ballXY: { x: 0, y: 0 } });
  assert.equal(ready.why.text, "7-iron to the middle: back pin.");
  assert.equal(ready.why.rule, "pin-back");
  assert.equal(caddieView({ state: initialCaddie(7), par: 4, res: r }).why, null, "pre-tee");
});
