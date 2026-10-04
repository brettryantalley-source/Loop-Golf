// Open the caddie on a Woodmont round in the BUILT app and screenshot what it draws (no tiles: the drawn-from-data map, spec §4.3).
import { chromium } from "playwright-core";
const OUT = "/tmp/woodmont-trace";
const PAR = [5, 3, 4, 4, 4, 3, 4, 4, 5, 5, 3, 4, 3, 4, 3, 5, 4, 5];
const SI = [15, 11, 9, 1, 5, 17, 7, 3, 13, 12, 18, 6, 14, 2, 10, 4, 8, 16];
const YD = [506, 166, 392, 432, 397, 120, 363, 442, 518, 506, 106, 373, 142, 391, 179, 543, 360, 485];
const course = { id: "tnw4ghn5:medal", apiId: "tnw4ghn5", lat: 34.2315, lon: -84.3538, name: "Woodmont Golf & Country Club", tee: "Medal", rating: 71.3, slope: 135, par: 72, holes: PAR.map((p, i) => ({ par: p, si: SI[i], yards: YD[i] })) };
const holeArg = Number(process.argv[2] || 0);                       // 0-based hole to open on
const state = { screen: "setup", course, diff: 7.4, scores: Array(18).fill(null), hole: holeArg, roundId: null, caddie: null };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 34.2300, longitude: -84.3555 }, permissions: ["geolocation"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/maptiler\.com|open-meteo\.com|overpass/, (r) => r.abort());
await page.addInitScript((s) => { if (!localStorage.getItem("bogeyman-matches:v1")) localStorage.setItem("bogeyman-matches:v1", JSON.stringify(s)); }, state);
await page.goto("file:///home/user/Loop-Golf/index.html");
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/cad-0-setup.png` });
const start = page.getByRole("button", { name: /start round/i }).first();
console.log("start button:", await start.count());
await start.click();
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/cad-1-caddie.png` });
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
console.log("caddie screen text:", text);
console.log("uncaught errors:", errors.length ? errors : "none");
await browser.close();
