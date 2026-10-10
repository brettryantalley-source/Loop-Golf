#!/usr/bin/env node
/*
 * smoke-caddie.mjs — opens the BUILT app (index.html) in headless Chromium on a restored Woodmont
 * round in test mode, walks the caddie screen through a tee shot, a logged shot, the next ball and a
 * ball by the green (the short-game line and card, C29), and fails on any page error. `npm test` never renders CaddieScreen; this catches what it can't
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
import { initialCaddie, serializeCaddie } from "../src/caddie/caddieState.js";

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
const page = await ctx.newPage();
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
// v22.40 (C29, D111): log shot 2 and drop the ball just short of the green, inside 30 yds: no club
// call, his short-game numbers instead, and the log card's Chip · Pitch · Bunker · Wedge row.
await step("shot 2 → by the green", async () => {
  await logGood();
  await page.getByText(/^Test mode ·/).first().waitFor({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(300);
  await tapMap(0.44, 0.165);
  await page.getByText(/up and down/).first().waitFor({ timeout: 12000 });
});
await shot("5-short-game");
await step("short-game card", () => logGood(async () => {
  await page.locator('[data-part="short-kind"]').first().waitFor({ timeout: 3000 });
  await page.getByRole("dialog").getByText("LW", { exact: true }).first().click({ timeout: 3000 });   // no call: he names the club
}));
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));

await browser.close();
server.close();
console.log(`screen: ${text}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("smoke-caddie: no page errors");
