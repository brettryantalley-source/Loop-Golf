#!/usr/bin/env node
/*
 * gameplan.mjs — a hole-by-hole plan for a bundled club from the caddie's own engine (v22.66, D139). Offline: not in
 * the build, not run by `npm test`.
 *
 *   node scripts/gameplan.mjs <club> --card=<golfcourseapi /courses/{id} JSON> --tee=<tee name> [--out=<file.md>]
 *
 * Every hole from the chosen tee's box (teeboxes.js picks it off the card; the line's start when none matches):
 * the tee call SAFE / AGGRESSIVE with its target, leave, par chance and trouble, then the next shot from SAFE's
 * target (and a third on a par 5 that lays up), the climb, the green's tilt read off the lidar from the approach,
 * and the why line the map would show. No wind, no temperature: the day's conditions are the caddie's on the tee.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localGeometryFor, elevationSamples, greenGrids } from "../src/localGeometry.js";
import { buildHole, frameOf } from "../src/caddie/geo.js";
import { assembleShotContext } from "../src/caddie/context.js";
import { recommend } from "../src/caddie/engine.js";
import { loadProfile } from "../src/caddie/profile.js";
import { DEFAULT_CONFIG } from "../src/caddie/config.js";
import { whyLine } from "../src/caddie/reasons.js";
import { cardForHole, assignTeeBoxes, ringCentroid } from "../src/caddie/teeboxes.js";
import { gridForGreen, puttRead } from "../src/caddie/greenslope.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d = null) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const club = args.find((a) => !a.startsWith("--"));
if (!club || !opt("card")) { console.error("usage: node scripts/gameplan.mjs <club> --card=<api json> --tee=<tee> [--out=<file>]"); process.exit(1); }
const TEE = opt("tee", "Blue");
const data = JSON.parse(readFileSync(join(root, "src/localGeometry", `${club}.json`), "utf8"));
const api = JSON.parse(readFileSync(opt("card"), "utf8")).course;
const tees = api.tees.male || [];
const tee = tees.find((t) => t.tee_name.toLowerCase() === TEE.toLowerCase());
if (!tee) { console.error(`no tee ${TEE}; have ${tees.map((t) => t.tee_name).join(", ")}`); process.exit(1); }
const teeCard = tees.map((t) => ({ name: t.tee_name, yards: t.holes.map((h) => h.yardage) }));
const geo = localGeometryFor([data], data.apiId).geometry;
const elevation = elevationSamples(data), grids = greenGrids(data);
const P = loadProfile(JSON.parse(readFileSync(join(root, "src/profile.json"), "utf8")), DEFAULT_CONFIG);
const profileAsOf = P.meta?.asOf || P.asOf || "";

const pct = (p) => `${Math.round(100 * p)}%`;
const yd = (v) => `${Math.round(v)} yds`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const troubleText = (o) => {
  const by = o.troubleBy || {};
  const parts = Object.entries(by).filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`);
  return parts.length ? `${pct(o.troubleRate)} (${parts.join(", ")})` : pct(o.troubleRate);
};
const climb = (yds) => (Math.abs(yds) < 2 ? "level" : `${Math.abs(Math.round(yds))} yds ${yds > 0 ? "up" : "down"}`);
const optText = (o) => `**${o.club}** → ${o.target?.label || o.kind} (${yd(o.toTargetYds)}, leave ${yd(o.leaveYds)})`;

const rows = [], notes = [], json = [];
let expTotal = 0;
for (let n = 1; n <= 18; n++) {
  const ch = tee.holes[n - 1];
  const par = ch.par, yards = ch.yardage, si = ch.handicap;
  const h = buildHole(geo, n, { par, yards });
  if (!h) { notes.push(`## Hole ${n}\n\nNo map.`); continue; }
  const F = frameOf(h);
  const names = assignTeeBoxes(h, cardForHole(teeCard, n - 1));
  const idx = names.findIndex((x) => x && x.toLowerCase() === TEE.toLowerCase());
  const ball = idx >= 0 ? ringCentroid(h.tees[idx]) : { x: 0, y: 0 };
  const teeNote = idx >= 0 ? `${TEE} box` : `line's start (no ${TEE} box within 20 yds of the card)`;
  const shots = [];
  let ctx = assembleShotContext({ hole: h, round: { shotNo: 1, trigger: "tee", ball, par, hole: n }, geometry: geo, elevation, config: DEFAULT_CONFIG });
  let r = recommend(ctx, h, P);
  const first = r;
  const climbToPin = ctx.elevationDeltaYds;
  let b = ball;
  for (let k = 1; k <= 3 && r?.safe; k++) {
    shots.push({ k, ctx, r });
    const t = r.safe.target;
    if (!t || r.safe.leaveYds <= 30) break;                        // on or at the green: done
    b = { x: t.x, y: t.y };
    ctx = assembleShotContext({ hole: h, round: { shotNo: k + 1, trigger: "ball", ball: b, par, hole: n }, geometry: geo, elevation, config: DEFAULT_CONFIG });
    r = recommend(ctx, h, P);
  }
  // the green's tilt read along the final approach: from 15 yds short of the centre, along the last shot's line
  const last = shots[shots.length - 1];
  const from = last.ctx.ball, c = h.green.center, L = dist(from, c) || 1;
  const u = { x: (c.x - from.x) / L, y: (c.y - from.y) / L };
  const grid = gridForGreen(grids, h, F);
  const read = grid ? puttRead(grid, F, { x: c.x - u.x * 12, y: c.y - u.y * 12 }, { x: c.x + u.x * 8, y: c.y + u.y * 8 }, h.green.ring) : null;
  const greenText = read ? read.text.replace("Uphill", "Rises toward the back").replace("Downhill", "Falls away toward the back").replace("Level", "Flat front to back").replace("breaks right to left", "tilts right to left").replace("breaks left to right", "tilts left to right") : "no lidar read";
  const s = first.safe, a = first.sameShot ? null : first.aggressive;
  expTotal += s.expScore;
  json.push({ hole: n, par, yards, si, teeNote, climbToPin, safe: s, aggressive: a, sameShot: first.sameShot, why: whyLine(first)?.text || null, next: shots.slice(1).map((sh) => ({ k: sh.k, lie: sh.ctx.lieType, toPin: Math.round(sh.ctx.meta.distances?.toPin ?? dist(sh.ctx.ball, h.green.center)), climb: sh.ctx.elevationDeltaYds, safe: sh.r.safe, why: whyLine(sh.r)?.text || null })), green: read ? { ...read, text: greenText } : null });
  rows.push(`| ${n} | ${par} | ${yards} | ${si} | ${s.club} · ${s.target?.label || s.kind} | ${shots[1] ? shots[1].r.safe.club : "—"} | ${pct(s.parProb)} | ${pct(s.troubleRate)} | ${s.expScore.toFixed(1)} |`);
  const lines = [`## Hole ${n} · Par ${par} · ${yards} yds · SI ${si}`, ""];
  lines.push(`From the ${teeNote}. Pin plays ${climb(climbToPin)}.`, "");
  lines.push(`**Tee shot (SAFE):** ${optText(s)} — par ${pct(s.parProb)}, birdie ${pct(s.birdieProb)}, double ${pct(s.doubleProb)}, trouble ${troubleText(s)}.`);
  if (s.aimOffsetYds) lines.push(`Aim ${Math.abs(s.aimOffsetYds)} yds ${s.aimOffsetYds > 0 ? "right" : "left"} of the target for the pattern.`);
  const why = whyLine(first);
  if (why) lines.push(`*${typeof why === "string" ? why : why.text || why.main || JSON.stringify(why)}*`);
  if (a) lines.push(``, `**Aggressive:** ${optText(a)} — birdie ${pct(a.birdieProb)}, par ${pct(a.parProb)}, trouble ${troubleText(a)}, ${a.deltaExp >= 0 ? "+" : "−"}${Math.abs(a.deltaExp).toFixed(2)} strokes vs SAFE.`);
  else lines.push(``, `*Same shot both ways.*`);
  for (const sh of shots.slice(1)) {
    const o = sh.r.safe;
    lines.push(``, `**Shot ${sh.k} from the ${sh.ctx.lieType} (${yd(sh.ctx.meta.distances?.toPin ?? dist(sh.ctx.ball, h.green.center))} to the pin, ${climb(sh.ctx.elevationDeltaYds)}):** ${optText(o)} — par ${pct(o.parProb)}, trouble ${troubleText(o)}.`);
    const w2 = whyLine(sh.r); if (w2) lines.push(`*${typeof w2 === "string" ? w2 : w2.text || w2.main || JSON.stringify(w2)}*`);
  }
  lines.push(``, `**Green:** ${greenText}.`);
  notes.push(lines.join("\n"));
}

const head = [
  `# ${api.club_name} — ${api.course_name}: the plan from the ${tee.tee_name} tees`,
  ``,
  `${tee.tee_name} ${tee.total_yards} yds · rating ${tee.course_rating} / slope ${tee.slope_rating} · par ${tee.par_total}. Built ${new Date().toISOString().slice(0, 10)} by \`scripts/gameplan.mjs\` from the caddie's engine on the bundled map (\`src/localGeometry/${club}.json\`, version ${data.version}) and the profile${profileAsOf ? ` (${profileAsOf})` : ""}; calm, 70 °F — the caddie on the tee adds the day's wind and temperature. Par chance and trouble are the engine's simulation of his own pattern; expected score sums to **${expTotal.toFixed(1)}** over 18.`,
  ...(opt("forecast") ? [``, `**Forecast:** ${opt("forecast")}`] : []),
  ``,
  `| Hole | Par | Yds | SI | Tee call (SAFE) | Next | Par | Trouble | Exp |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows,
  ``,
];
const md = head.join("\n") + "\n" + notes.join("\n\n") + "\n";
const out = opt("out");
if (out) writeFileSync(out, md); else process.stdout.write(md);
if (opt("json")) writeFileSync(opt("json"), JSON.stringify({ club: api.club_name, course: api.course_name, tee: { name: tee.tee_name, yards: tee.total_yards, rating: tee.course_rating, slope: tee.slope_rating, par: tee.par_total }, built: new Date().toISOString().slice(0, 10), mapVersion: data.version, forecast: opt("forecast") || null, expTotal, holes: json }));
console.error(`${club} from the ${tee.tee_name} tees: expected ${expTotal.toFixed(1)}${out ? ` → ${out}` : ""}`);
