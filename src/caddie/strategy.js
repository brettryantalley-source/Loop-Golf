/*
 * strategy.js — the course-management rules that choose SAFE from the priced candidates (v22.16.9).
 *
 * Source: Michael Leonard, "How to Play Wicked Smart Golf: 7 Proven Course Management Strategies to
 * Shoot Lower Scores" (Wicked Smart Golf), tips 3–6. Brett, Oct 3: where the guide and the Sep 29
 * research (docs/research/caddie-brain-2026-09-29.md) disagree, the guide wins. Every tip and what
 * became of it: docs/CADDIE-BRAIN-INTEGRATION.md part 2. Decision record: D76.
 *
 * The simulation still prices every candidate; these rules decide which priced shot is SAFE.
 *   no hero  (tip 6)     From trees, or a bad / buried lie in the rough, SAFE must stay out of
 *                        trouble 9 times in 10 ("only attempt recovery shots you could execute 9
 *                        out of 10 times"). If no shot does, the one with the least trouble: punch out.
 *   driver   (tip 3)     On a par-4/5 tee, a tie in expected score goes to the driver ("don't
 *                        automatically reach for less club because it feels safer"). A tie only:
 *                        the research's flip threshold (T43) still decides when water makes a shorter
 *                        club worth it, and the two sources agree on that.
 *   pin      (tips 4, 5) When the best-priced shot goes at the green, the club is chosen by where its
 *                        AVERAGE shot finishes: front or back pin → nearest the middle of the green,
 *                        aimed at the center or the fat side, never the flag; middle pin → nearest the
 *                        pin, and only the wedges may aim at the flag. A club that finishes short of
 *                        that depth counts double ("club up": most trouble is short, and you shouldn't
 *                        need your best swing to hit the green). Between equally priced targets for the
 *                        chosen club, the center ("simple targets").
 *                        Brett's numbers overrule the pin rule only where the hole contradicts it:
 *                        its pick finds more than maxExtraTrouble more trouble, or costs more than
 *                        maxCostStrokes, than the best-priced shot. Then the next club in line.
 *
 * Locked rule 1 is restated by this (D76): SAFE = the lowest expected score among the shots these
 * rules allow; with every rule off it is the plain argmin again. AGGRESSIVE (max birdie, rule 2) and
 * the same-shot rule (rule 3) are untouched. Pure: no DOM, no storage, no network.
 */

import { DEFAULT_CONFIG } from "./config.js";

const EPS = 1e-9;
/** Trouble rates this close to the lowest one are the same punch-out (500 samples ≈ ±1 point). */
const PUNCH_OUT_TOL = 0.02;
/** Pin rule: clubs whose average finishes this close in yards (weighted) are a tie on depth. */
const KEY_TIE_YDS = 2;

function strategyCfg(cfg) {
  return { ...DEFAULT_CONFIG.STRATEGY, ...(cfg?.STRATEGY || {}) };
}

/**
 * Front / middle / back third of the green for the pin, along the ball → green-center line.
 * Presets are taken as given; a custom {x, y} pin is projected onto the line and placed in a third
 * of the green's depth (`g` = greenDistances: front and back edges on that line).
 */
export function pinDepthClass(pinPos, g, ball, center) {
  if (typeof pinPos === "string") return pinPos === "front" || pinPos === "back" ? pinPos : "middle";
  if (!pinPos || !Number.isFinite(pinPos.x) || !Number.isFinite(pinPos.y)) return "middle";
  const ux = center.x - ball.x, uy = center.y - ball.y, L = Math.hypot(ux, uy);
  const third = (g.back - g.front) / 3;
  if (!(L > 0) || !(third > 0)) return "middle";
  const along = ((pinPos.x - ball.x) * ux + (pinPos.y - ball.y) * uy) / L;
  return along < g.front + third ? "front" : along > g.back - third ? "back" : "middle";
}

/** What the rules need to know about the shot. `g` = greenDistances for ctx.pinPos. */
export function situationOf(ctx, hole, g) {
  const pin = pinDepthClass(ctx.pinPos, g, ctx.ball, hole.green.center);
  return {
    teeShot: ctx.shotNo === 1 && ctx.par >= 4 && ctx.lieType === "tee",
    recovery: ctx.lieType === "recovery" || (ctx.lieType === "rough" && (ctx.lieQuality === "bad" || ctx.lieQuality === "buried")),
    pin,
    depthTargetYds: pin === "middle" ? g.pin : g.center,
  };
}

/** Distance between where the club lands on average and where it was aimed — "plays the number". */
const fit = (c) => Math.abs(c.meanYds - c.distToTarget);

/** Lowest expected score; ties (EXP_TIE_TOLERANCE, D13) to the driver on a par-4/5 tee, else to fit. */
function plainPick(pool, sit, cfg, S) {
  const tol = cfg.EXP_TIE_TOLERANCE ?? 0;
  const minExp = Math.min(...pool.map((c) => c.expScore));
  const tied = pool.filter((c) => c.expScore <= minExp + tol);
  const byFit = tied.reduce((a, b) => (fit(b) < fit(a) ? b : a));
  if (S.driverDefault && sit.teeShot) {
    const dr = tied.filter((c) => c.club === "Dr");
    if (dr.length) {
      const pick = dr.reduce((a, b) => (fit(b) < fit(a) ? b : a));
      return { pick, driver: pick !== byFit };
    }
  }
  return { pick: byFit, driver: false };
}

const aimsAt = (c, ...kinds) => (c.aims || []).some((a) => kinds.includes(a));

/**
 * Tips 4–5: the club whose average finishes nearest the depth target (short × clubUpShortWeight),
 * through the guards against `best`. Null when no approach candidate is allowed or none passes.
 */
function pinRulePick(pool, best, sit, cfg, S) {
  const attack = new Set(S.attackClubs || []);
  const allowed = pool.filter((c) => c.kind === "approach" &&
    ((sit.pin === "middle" && attack.has(c.club)) || aimsAt(c, "center", "fat")));
  if (!allowed.length) return null;
  const w = Number.isFinite(S.clubUpShortWeight) ? S.clubUpShortWeight : 1;
  const key = (c) => { const m = c.meanYds - sit.depthTargetYds; return m < 0 ? -m * w : m; };
  const groups = new Map();
  for (const c of allowed) {
    const k = `${c.club}/${c.swing}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  let rest = [...groups.values()].map((cs) => ({ cs, k: Math.min(...cs.map(key)) })).sort((a, b) => a.k - b.k);
  const passes = (c) => c.troubleRate <= best.troubleRate + S.maxExtraTrouble + EPS &&
    c.expScore <= best.expScore + S.maxCostStrokes + EPS;
  // Clubs finishing within KEY_TIE_YDS of each other are the same answer to "where does the average
  // shot finish"; between them Brett's numbers decide.
  while (rest.length) {
    const k0 = rest[0].k;
    const ok = rest.filter((g) => g.k <= k0 + KEY_TIE_YDS).flatMap((g) => g.cs).filter(passes);
    rest = rest.filter((g) => g.k > k0 + KEY_TIE_YDS);
    if (!ok.length) continue;
    const lowest = ok.reduce((a, b) => (b.expScore < a.expScore ? b : a));
    // "Simple targets": between equally priced aims with that club, the center.
    const tol = cfg.EXP_TIE_TOLERANCE ?? 0;
    return ok.find((c) => c.club === lowest.club && c.swing === lowest.swing && aimsAt(c, "center") &&
      c.expScore <= lowest.expScore + tol) || lowest;
  }
  return null;
}

/**
 * SAFE from the scored candidates. Returns { safe, rules }: `rules` names each rule that moved SAFE
 * off the plain pick — "no-hero", "driver", "pin-front" / "pin-middle" / "pin-back".
 */
export function pickSafe(scored, sit, cfg = DEFAULT_CONFIG) {
  const S = strategyCfg(cfg);
  const rules = [];
  let pool = scored;
  if (S.noHero && sit.recovery) {
    const clean = scored.filter((c) => c.troubleRate <= S.noHeroMaxTrouble + EPS);
    if (clean.length) pool = clean;
    else {
      const least = Math.min(...scored.map((c) => c.troubleRate));
      pool = scored.filter((c) => c.troubleRate <= least + PUNCH_OUT_TOL);
    }
    if (!pool.includes(plainPick(scored, sit, cfg, S).pick)) rules.push("no-hero");
  }
  const plain = plainPick(pool, sit, cfg, S);
  let safe = plain.pick;
  if (plain.driver) rules.push("driver");
  if (S.pinRule && safe.kind === "approach") {
    const r = pinRulePick(pool, safe, sit, cfg, S);
    if (r && r !== safe) { safe = r; rules.push(`pin-${sit.pin}`); }
  }
  return { safe, rules };
}
