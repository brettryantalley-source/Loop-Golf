#!/usr/bin/env node
/*
 * smoke-caddie.mjs — opens the BUILT app (index.html) in headless Chromium on a restored Woodmont
 * round in test mode, walks the caddie screen through a tee shot, a logged shot, the next ball and a
 * ball by the green (the short-game line and card, C29), a one-finger pan and Fit (C37, satellite only), the Shots list's
 * map zoom (C42), Score hole's pre-filled score (C43), Catch up through one hole (C47), the green's slope arrows (R10), and fails on any page error. `npm test` never renders CaddieScreen; this catches what it can't
 * (a hook out of order, a value used before it is declared). Not part of `npm test`: it needs
 * Playwright and a Chromium (a cloud session has both).
 *
 *   node scripts/smoke-caddie.mjs [--shots out-dir]
 *
 * Exit 0 = no page errors; 1 = errors (printed). Network is not needed: Woodmont's map is bundled,
 * and with no satellite tiles the caddie draws the paper map. Open-Meteo is held 30 s, as on a weak
 * signal (D109).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { initialCaddie, serializeCaddie } from "../src/caddie/caddieState.js";
import { parseOverpass } from "../src/geometry.js";
import { toOverpass } from "../src/localGeometry.js";
import { buildHole, frameOf } from "../src/caddie/geo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const require = createRequire(import.meta.url);
let chromium;
for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
if (!chromium) { console.error("smoke-caddie: Playwright not found"); process.exit(2); }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const body = await readFile(path.endsWith("/") ? join(path, "index.html") : path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

// A Woodmont round restored on the caddie, hole 1, pre-tee; test mode on (fake GPS by tap).
const course = { id: "tnw4ghn5:smoke", apiId: "tnw4ghn5", lat: 34.2366, lon: -84.4588, name: "Woodmont Golf & Country Club", tee: "Blue",
  rating: 72, slope: 130, par: 72, holes: Array.from({ length: 18 }, (_, i) => ({ par: [4, 5, 3, 4, 4, 3, 4, 5, 4][i % 9], si: i + 1, yards: 400 })) };
const state = { screen: "caddie", course, diff: 7.4, scores: Array(18).fill(null), hole: 0, roundId: "smoke-round", caddie: serializeCaddie(initialCaddie(1)) };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx.addInitScript(([s]) => {
  if (sessionStorage.getItem("smoke-seeded")) return;
  sessionStorage.setItem("smoke-seeded", "1");
  localStorage.setItem("bogeyman-matches:v1", s);
  localStorage.setItem("bogeyman-matches:config:v1", JSON.stringify({ testMode: { fakeGps: true } }));
}, [JSON.stringify(state)]);
// A weak signal (D109): Open-Meteo (weather, elevation) answers after 30 s. A bundled map must not wait for it.
await ctx.route(/open-meteo\.com/, (route) => setTimeout(() => route.abort().catch(() => {}), 30000));
let page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
const shot = async (name) => { if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`) }); };
const step = async (label, fn) => { try { await fn(); } catch (e) { errors.push(`${label}: ${e.message.split("\n")[0]}`); } };
const tapMap = (fx, fy) => page.mouse.click(390 * fx, 844 * fy);

await page.goto(base, { waitUntil: "load" });
await page.waitForTimeout(2500);
await shot("1-pretee");
// I'm on the tee → tap the ball → the call is on screen (the strip above the action button). Twice at
// most: on a slow start the first click can land before the screen is ready.
const CALL = /chance at par|birdie chance|Punch out/;
await step("call on screen", async () => {
  for (let i = 0; i < 2; i++) {
    const tee = page.getByText("I'm on the tee", { exact: false }).first();
    if (await tee.isVisible().catch(() => false)) await tee.click({ timeout: 5000 });
    // test mode asks for the tap; tapping before it shows is ignored
    await page.getByText(/^Test mode ·/).first().waitFor({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(300);
    await tapMap(0.5, 0.75);
    try { await page.getByText(CALL).first().waitFor({ timeout: 12000 }); return; } catch (e) { /* once more */ }
  }
  throw new Error("no call after I'm on the tee and a tap");
});
await shot("2-ready");
// v22.47 (C37, D118): one finger off the target pans the satellite map, the call stays, `Fit` puts it back.
// The paper map (no tiles) does not pan, so the check runs only when the satellite map is up.
await step("one-finger pan", async () => {
  const before = await page.evaluate(() => {
    const m = window.__loopMap, box = document.querySelector(".loop-map");
    return m && box?.dataset.mode === "hole" ? { c: m.getCenter(), tgt: (document.body.innerText.match(/TO TARGET\s*(\d+)/i) || [])[1] } : null;
  });
  if (!before) { console.log("pan: skipped (paper map, no satellite)"); return; }
  await page.mouse.move(250, 560); await page.mouse.down();
  await page.mouse.move(250, 500, { steps: 4 }); await page.mouse.move(230, 420, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ c: window.__loopMap.getCenter(), tgt: (document.body.innerText.match(/TO TARGET\s*(\d+)/i) || [])[1] }));
  if (Math.hypot(after.c.lat - before.c.lat, after.c.lng - before.c.lng) < 1e-5) throw new Error("the map did not move");
  if (after.tgt !== before.tgt) throw new Error(`the target moved: ${before.tgt} → ${after.tgt}`);
  await shot("2b-panned");
  await page.locator('[data-part="map-fit"]').click({ timeout: 3000 });
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => window.__loopMap.getCenter());
  if (Math.hypot(back.lat - before.c.lat, back.lng - before.c.lng) > 1e-6) throw new Error("Fit did not put the camera back");
  console.log("pan: moved, target held, Fit restored");
});
// Log shot → Good shot. Three tries: the screen can still be settling, and a re-render can close the
// card between the two clicks. `check` runs on the open card before Good shot.
const logGood = async (check = null) => {
  for (let i = 0; i < 3; i++) {
    const good = page.getByText("Good shot", { exact: false }).first();
    if (!(await good.isVisible().catch(() => false))) {
      await page.getByText("Log shot", { exact: false }).first().click({ timeout: 5000 });
      try { await good.waitFor({ timeout: 3000 }); } catch (e) { continue; }
    }
    if (check) await check();
    try { await good.click({ timeout: 4000 }); return; } catch (e) { /* once more */ }
  }
  await shot("fail-log");
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "");
  throw new Error(`Log shot → Good shot never went through · screen: ${t}`);
};
await step("Log shot → Good shot", () => logGood());
await page.waitForTimeout(1200);
await shot("3-after-log");
await step("next-ball tap", async () => {
  await page.getByText(/^Test mode ·/).first().waitFor({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(300);
  await tapMap(0.5, 0.45);
});
await page.waitForTimeout(2500);
await shot("4-next-ball");
// v22.51 (C42, D122): the Shots list's map opens on the shot, moves with a finger, pinches, and Fit puts it back
await step("review map zoom", async () => {
  await page.locator('[data-part="shots-button"]').first().click({ timeout: 5000 });
  await page.locator('[data-part="review-row"][data-kind="shot"] > button').first().click({ timeout: 5000 });
  const map = page.locator('[data-part="review-map"]').first();
  await map.waitFor({ timeout: 5000 });
  const b = await map.boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 30, { steps: 5 }); await page.mouse.up();
  await page.locator('[data-part="review-fit"]').waitFor({ timeout: 3000 });
  await page.locator('[data-part="review-fit"]').click();
  if (await page.locator('[data-part="review-fit"]').count()) throw new Error("Fit did not reset the review map");
  // a two-finger pinch (pointer events, as a phone sends them)
  const svgW = async () => (await map.locator("svg path").first().boundingBox())?.width || 0;
  const w0 = await svgW();
  await map.evaluate((el, [x, y]) => {
    const ev = (type, id, dx) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x + dx, clientY: y, bubbles: true, pointerType: "touch", isPrimary: id === 1 }));
    ev("pointerdown", 1, -20); ev("pointerdown", 2, 20);
    for (let k = 1; k <= 5; k++) { ev("pointermove", 1, -20 - 8 * k); ev("pointermove", 2, 20 + 8 * k); }
    ev("pointerup", 1, -60); ev("pointerup", 2, 60);
  }, [cx, cy]);
  await page.waitForTimeout(200);
  const w1 = await svgW();
  if (!(w1 > w0 * 1.5)) throw new Error(`the pinch did not zoom in (${w0.toFixed(0)} → ${w1.toFixed(0)} px)`);
  await shot("4b-review-zoomed");
  console.log(`review map: moved, Fit reset, pinched ${w0.toFixed(0)} → ${w1.toFixed(0)} px`);
  await page.getByText("Close", { exact: true }).last().click({ timeout: 3000 });
});

// v22.57 (C46, D128): on an armed map a hold anywhere lifts a marker above the finger and letting go places
// the ball there — the shot count moves on as a tap's would.
const shotNo = async () => Number((await page.evaluate(() => (document.body.innerText.match(/shot\s*(\d+)/i) || [])[1])) || 0);
await step("hold-and-drag place", async () => {
  const before = await shotNo();
  await logGood();
  await page.getByText(/^Test mode ·/).first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.mouse.move(200, 520); await page.mouse.down();
  await page.waitForTimeout(450);                                  // past the 300 ms hold: the marker is up
  const marker = await page.locator('[data-layer="place"]').count();
  await page.mouse.move(200, 470, { steps: 5 }); await page.mouse.move(210, 430, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const after = await shotNo();
  if (!marker) throw new Error("no place marker after the hold");
  if (after !== before + 1) throw new Error(`the hold-and-drag did not place the ball (shot ${before} → ${after})`);
  console.log(`place: held, dragged, placed (shot ${before} → ${after})`);
});
await shot("4c-placed");
// v22.57 (C46, D128): Delete stroke from the mid-hole Shots list takes two taps, and the caddie's count follows.
await step("delete stroke mid-hole", async () => {
  const before = await shotNo();
  await page.locator('[data-part="shots-button"]').first().click({ timeout: 5000 });
  const rows = await page.locator('[data-part="review-row"][data-kind="shot"]').count();
  await page.locator('[data-part="review-row"][data-kind="shot"] > button').first().click({ timeout: 5000 });
  const del = page.locator('[data-part="review-delete"]').first();
  await del.click({ timeout: 3000 });
  await page.getByText("Tap again to delete").first().waitFor({ timeout: 3000 }).catch(() => { throw new Error("the first tap did not arm Delete stroke"); });
  await page.getByText("Tap again to delete").first().click({ timeout: 3000 });
  await page.waitForTimeout(200);
  const left = await page.locator('[data-part="review-row"][data-kind="shot"]').count();
  if (left !== rows - 1) throw new Error(`the row did not go (${rows} → ${left})`);
  await page.locator('[data-part="review-save"]').click({ timeout: 3000 });
  await page.waitForTimeout(500);
  const after = await shotNo();
  if (after !== before - 1) throw new Error(`the shot count did not follow (${before} → ${after})`);
  console.log(`delete: two taps, ${rows} → ${left} rows, shot ${before} → ${after}`);
});

// v22.40 (C29, D111): a ball 22 yds short of hole 1's green — restored, so the camera's framing of the
// shot before cannot move it: no club call, his short-game numbers instead, and the log card's
// Chip · Pitch · Bunker · Wedge row.
const wm = parseOverpass(toOverpass(JSON.parse(readFileSync(join(root, "src/localGeometry/woodmont.json"), "utf8"))));
const h1 = buildHole(wm, "1", { par: 4 });
const near = frameOf(h1).toLatLng({ x: h1.green.center.x, y: h1.green.center.y - 22 });
const byGreen = { ...state, caddie: serializeCaddie({ ...initialCaddie(1), phase: "ready", trigger: "ball", shotNo: 3, ball: { lat: near.lat, lng: near.lon, accuracyM: 4 } }) };
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx2.route(/open-meteo\.com/, (route) => setTimeout(() => route.abort().catch(() => {}), 30000));
await ctx2.addInitScript(([s]) => {
  if (sessionStorage.getItem("smoke-seeded")) return;
  sessionStorage.setItem("smoke-seeded", "1");
  localStorage.setItem("bogeyman-matches:v1", s);
  localStorage.setItem("bogeyman-matches:config:v1", JSON.stringify({ testMode: { fakeGps: true } }));
}, [JSON.stringify(byGreen)]);
page = await ctx2.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.goto(base, { waitUntil: "load" });
await step("by the green: his numbers", async () => { await page.getByText(/up and down/).first().waitFor({ timeout: 15000 }); });
await shot("5-short-game");
await step("short-game card", () => logGood(async () => {
  await page.locator('[data-part="short-kind"]').first().waitFor({ timeout: 3000 });
  await page.getByRole("dialog").getByText("LW", { exact: true }).first().click({ timeout: 3000 });   // no call: he names the club
}));
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));

// v22.52 (C43, D123): on the green with two shots and a putt logged, Score hole opens the card with 3 crossed
// in, and one tap on it writes it.
const g1 = frameOf(h1).toLatLng(h1.green.center);
const onGreen = { ...state, caddie: serializeCaddie({ ...initialCaddie(1), phase: "ready", trigger: "ball", shotNo: 3, ball: { lat: g1.lat, lng: g1.lon, accuracyM: 4 } }) };
const rec = (id, shotNo, shotType = "full") => ({ id, roundId: "smoke-round", hole: 1, shotNo, shotType, club: shotType === "putt" ? "Putter" : "7i", ts: `2026-10-11T10:0${shotNo}:00Z`, reviewed: true });
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx3.route(/open-meteo\.com/, (route) => route.abort().catch(() => {}));
await ctx3.addInitScript(([s, sh]) => {
  if (sessionStorage.getItem("smoke-seeded")) return;
  sessionStorage.setItem("smoke-seeded", "1");
  localStorage.setItem("bogeyman-matches:v1", s);
  localStorage.setItem("bogeyman-matches:shots:v1", sh);
}, [JSON.stringify(onGreen), JSON.stringify({ "smoke-round": [rec("s1", 1), rec("s2", 2), rec("p1", 3, "putt")] })]);
page = await ctx3.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(base, { waitUntil: "load" });
await step("score from the caddie: pre-filled", async () => {
  // v22.60 (R10, D131): on the green, the lidar's downhill arrows are drawn over it
  await page.getByText("Score hole 1").first().waitFor({ timeout: 15000 });
  const arrows = await page.locator('[data-layer="slopes"] [data-part="slope"]').count();
  if (arrows < 5) throw new Error(`${arrows} slope arrows on the green`);
  console.log(`green: ${arrows} slope arrows`);
  await page.getByText("Score hole 1").first().click({ timeout: 15000 });
  const cap = await page.locator('[data-part="score-suggested"]').innerText({ timeout: 5000 });
  if (!/tap 3 to keep/.test(cap)) throw new Error(`caption: ${cap}`);
  await shot("6-score-suggested");
  await page.locator('[data-part="chooser"] [data-score="3"]').click();
  await page.waitForTimeout(500);
  const sc = await page.evaluate(() => JSON.parse(localStorage.getItem("bogeyman-matches:v1")).scores[0]);
  if (sc !== 3) throw new Error(`one tap wrote ${sc}`);
  console.log("score: 3 crossed in from the log, one tap wrote it");
});

// v22.58 (C47, D129): Catch up — hole 1 played and scored with nothing logged, the caddie on hole 2. ‹ to
// hole 1 → Catch up → the call from the tee → a tap where the drive finished ✓ → Save (the call's club) → the
// call from there → a tap on the green ✓ → Save → In the hole: two shots and a putt in the log, the first aimed
// at the caddie's target (a recommendation and a measured miss), the hole's count on screen, back to hole 2.
const sc1 = Array(18).fill(null); sc1[0] = 3;
const pastHole = { ...state, scores: sc1, hole: 1, caddie: serializeCaddie(initialCaddie(2)) };
const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await ctx4.route(/open-meteo\.com/, (route) => route.abort().catch(() => {}));
await ctx4.addInitScript(([s]) => {
  if (sessionStorage.getItem("smoke-seeded")) return;
  sessionStorage.setItem("smoke-seeded", "1");
  localStorage.setItem("bogeyman-matches:v1", s);
}, [JSON.stringify(pastHole)]);
page = await ctx4.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.goto(base, { waitUntil: "load" });
await step("catch up a hole", async () => {
  const btn = (name) => page.getByRole("button", { name }).first().click({ timeout: 8000 });
  const tapAt = async (p) => { const q = await page.evaluate((x) => window.__loopOverlay?.project?.(x) || null, p); if (!q) throw new Error("no map projection"); await page.mouse.click(q.x, q.y); };
  await page.getByLabel("Previous hole").click({ timeout: 15000 });
  await btn(/^Catch up$/i);
  // shot 1 opens on the caddie's call from the tee box (the rings, the target), not a tee confirm
  await page.getByText(CALL).first().waitFor({ timeout: 12000 });
  const t = h1.tee, g = h1.green.center;
  await page.waitForTimeout(300);
  await tapAt({ x: t.x + (g.x - t.x) * 0.6, y: t.y + (g.y - t.y) * 0.6 });
  await btn(/Finished here/i);
  await page.locator('[data-part="cu-save"]').click({ timeout: 5000 });
  await page.waitForTimeout(300);
  await tapAt(g);
  await btn(/Finished here/i);
  await page.locator('[data-part="cu-lies"]').getByText("Green", { exact: true }).click({ timeout: 5000 });
  await page.locator('[data-part="cu-save"]').click({ timeout: 5000 });
  // v22.60 (R10, D131): the putt step reads the green — arrows over it, the putt's read above the buttons
  await page.waitForTimeout(500);
  if (!(await page.locator('[data-layer="slopes"] [data-part="slope"]').count())) throw new Error("no slope arrows on the putt");
  await btn(/In the hole/i);
  await page.getByText("Hole 1 · 2 shots + 1 putt = 3").first().waitFor({ timeout: 5000 });
  await shot("7-catch-up-done");
  const log = await page.evaluate(() => (JSON.parse(localStorage.getItem("bogeyman-matches:shots:v1") || "{}")["smoke-round"] || []).filter((r) => r.hole === 1));
  const shots = log.filter((r) => r.shotType !== "putt"), putts = log.filter((r) => r.shotType === "putt");
  if (shots.length !== 2 || putts.length !== 1) throw new Error(`the log has ${shots.length} shots + ${putts.length} putts`);
  if (!shots.every((r) => r.logged === "full" && r.placed && r.end && !r.end.assumed && r.club)) throw new Error("a shot is not a placed, logged, closed record");
  if (!putts[0].putt.made) throw new Error("the putt is not holed");
  if (!shots[0].recommendation || !Number.isFinite(shots[0].derived?.distanceMissYds)) throw new Error("the drive was not logged against the call");
  await btn(/Done · back to 2/i);
  await page.waitForTimeout(500);
  const pill = await page.locator('[data-part="hole-switch"]').innerText();
  if (!/Hole\s*2/.test(pill)) throw new Error(`not back on hole 2: ${pill}`);
  console.log(`catch up: ${shots.map((r) => `${r.club} ${r.lie?.confirmed}→${r.end?.lie}`).join(", ")}, putt ${putts[0].putt.distanceFt} ft holed; back to hole 2`);
});

await browser.close();
server.close();
console.log(`screen: ${text}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("smoke-caddie: no page errors");
