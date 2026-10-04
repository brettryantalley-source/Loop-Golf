// Load the BUILT app in Chromium with a Woodmont course in storage; confirm the Setup line, the cached geometry and no page errors.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const OUT = "/tmp/woodmont-trace";
const PAR = [5, 3, 4, 4, 4, 3, 4, 4, 5, 5, 3, 4, 3, 4, 3, 5, 4, 5];
const SI = [15, 11, 9, 1, 5, 17, 7, 3, 13, 12, 18, 6, 14, 2, 10, 4, 8, 16];
const YD = [506, 166, 392, 432, 397, 120, 363, 442, 518, 506, 106, 373, 142, 391, 179, 543, 360, 485];
const course = { id: "tnw4ghn5:medal", apiId: "tnw4ghn5", lat: 34.2315, lon: -84.3538, name: "Woodmont Golf & Country Club", tee: "Medal", rating: 71.3, slope: 135, par: 72,
  holes: PAR.map((p, i) => ({ par: p, si: SI[i], yards: YD[i] })) };
const state = { screen: "setup", course, diff: 7.4, scores: Array(18).fill(null), hole: 0, roundId: null, caddie: null };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 200)); });
await page.route(/maptiler\.com|open-meteo\.com|overpass/, (r) => r.abort());     // sandbox has no tile / weather / Overpass access; abort fast like an offline phone
await page.addInitScript((s) => {
  if (!localStorage.getItem("bogeyman-matches:v1")) localStorage.setItem("bogeyman-matches:v1", JSON.stringify(s));
}, state);
await page.goto("file:///home/user/Loop-Golf/index.html");
await page.waitForTimeout(4000);

const status = await page.locator('[data-testid="course-map-status"]').first().innerText().catch((e) => "(no status line: " + e.message.split("\n")[0] + ")");
const build = await page.evaluate(() => (document.body.innerText.match(/v\d+\.\d+(\.\d+)?\s·\s\w+\s\d+/) || [])[0] || null);
const cached = await page.evaluate(() => {
  const raw = localStorage.getItem("bogeyman-matches:geo:v1:tnw4ghn5");
  if (!raw) return null;
  const g = JSON.parse(raw);
  return { local: g.local, schema: g.schema, holes: Object.keys(g.holes).length, greens: g.greens.length, features: g.features.length, trouble: g.trouble.length, kb: Math.round(raw.length / 1024) };
});
console.log("build tag on screen:", build);
console.log("Setup course-map line:", JSON.stringify(status));
console.log("cached geometry:", cached);
await page.screenshot({ path: `${OUT}/smoke-setup.png` });

// stale-cache case: put an EMPTY OSM answer in the cache (what a phone that already picked Woodmont would hold), reload, expect it replaced
await page.evaluate(() => localStorage.setItem("bogeyman-matches:geo:v1:tnw4ghn5", JSON.stringify({ schema: 2, holes: {}, greens: [], trouble: [], features: [], boundary: null, warnings: [], elevation: null })));
await page.reload();
await page.waitForTimeout(2500);
const status2 = await page.locator('[data-testid="course-map-status"]').first().innerText().catch(() => "(none)");
const cached2 = await page.evaluate(() => { const g = JSON.parse(localStorage.getItem("bogeyman-matches:geo:v1:tnw4ghn5") || "null"); return g && { local: g.local, holes: Object.keys(g.holes).length }; });
console.log("after seeding an empty cache -> line:", JSON.stringify(status2), "| cache:", cached2);
const real = errors.filter((e) => e.startsWith("pageerror"));
console.log("uncaught page errors:", real.length ? real : "none", "| other console errors (font CORS on file://, blocked hosts):", errors.length - real.length);
await browser.close();
