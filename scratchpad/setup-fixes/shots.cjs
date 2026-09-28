/* v22.8 verification screenshots: build tag, tee colours + pencil ring, seed rounds in
 * History (+ one seed card view), and the split course-map failure lines. Stubs
 * golfcourseapi (search + course) and the two Overpass hosts via page.route; everything
 * else non-localhost is aborted, same pattern as scratchpad/latest/setup-shot.cjs. */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const path = require("path");

const OUT = __dirname;

// A single 18-hole club with five tees named to hit every colour family in teeTintFor.
const COURSE_ID = 9001;
const PARS =   [4,4,3,5,4,4,3,5,4, 4,4,3,5,4,4,3,5,4];
const SI =     [7,13,17,1,9,3,15,11,5, 8,14,18,2,10,4,16,12,6];
const YARDS =  [410,165,320,560,400,380,190,540,430, 420,150,340,580,390,410,175,520,400];
const holesFor = () => PARS.map((par, i) => ({ par, handicap: SI[i], yardage: YARDS[i] }));
const TEES = [
  { tee_name: "Gold",  course_rating: 73.1, slope_rating: 135, par_total: 72, holes: holesFor() },
  { tee_name: "Green", course_rating: 71.4, slope_rating: 128, par_total: 72, holes: holesFor() },
  { tee_name: "Blue",  course_rating: 72.6, slope_rating: 132, par_total: 72, holes: holesFor() },
  { tee_name: "Black", course_rating: 74.2, slope_rating: 140, par_total: 72, holes: holesFor() },
  { tee_name: "White", course_rating: 70.0, slope_rating: 122, par_total: 72, holes: holesFor() },
];
const FULL_COURSE = {
  id: COURSE_ID, club_name: "Ironwood Golf Club", course_name: "Ironwood Golf Club",
  location: { latitude: 34.05, longitude: -84.1, city: "Test City", state: "GA" },
  tees: { male: TEES, female: [] },
};
const SEARCH_RESULTS = [{ id: COURSE_ID, club_name: "Ironwood Golf Club", course_name: "Ironwood Golf Club",
  location: { city: "Test City", state: "GA" } }];

async function json(route, body) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/* overpassMode: "hang" (never resolves — used where the map status doesn't matter for the
 * shot), "fail" (500, both hosts — network-error), "empty" (200, {elements: []} — no-holes). */
function installRoutes(page, overpassMode) {
  return page.route(/^(?!http:\/\/localhost:8765).*/, async (route) => {
    const url = route.request().url();
    if (url.includes("api.golfcourseapi.com/v1/search")) return json(route, { courses: SEARCH_RESULTS });
    if (url.includes(`api.golfcourseapi.com/v1/courses/${COURSE_ID}`)) return json(route, { course: FULL_COURSE });
    if (url.includes("overpass-api.de")) {
      if (overpassMode === "empty") return json(route, { elements: [] });
      if (overpassMode === "fail") return route.fulfill({ status: 500, body: "overpass down" });
      return new Promise(() => {}); // "hang" — loading forever, no status noise in these shots
    }
    return route.abort();
  });
}

async function pickCourse(page) {
  await page.getByText("Tap to choose").click();
  await page.getByPlaceholder("Course name…").fill("Ironwood");
  await page.waitForTimeout(600); // debounce + fake network
  await page.getByText("Ironwood Golf Club", { exact: true }).first().click();
  await page.waitForSelector('button:has-text("Gold")');
}

async function selectTee(page, name) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForTimeout(150);
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // ---- 1. Setup, empty, build tag visible — 812 and 667 ----
  for (const [w, h] of [[375, 812], [375, 667]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await installRoutes(page, "hang");
    await page.goto("http://localhost:8765/index.html");
    await page.waitForTimeout(800);
    const scroll = await page.evaluate(() => document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight);
    console.log(`setup ${w}x${h} scroll overflow: ${scroll}px`);
    await page.screenshot({ path: path.join(OUT, `${w}x${h}-00-setup-buildtag.png`) });
    await ctx.close();
  }

  // ---- 2. Tee colours + pencil ring, one tee selected at a time — 812 ----
  {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await installRoutes(page, "hang");
    await page.goto("http://localhost:8765/index.html");
    await page.waitForTimeout(500);
    await pickCourse(page);
    for (const name of ["Gold", "Green", "Blue", "Black", "White"]) {
      await selectTee(page, name);
      await page.screenshot({ path: path.join(OUT, `375x812-01-tee-${name.toLowerCase()}.png`) });
    }
  }

  // ---- 3. History with the five seed rows ----
  {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await installRoutes(page, "hang");
    await page.goto("http://localhost:8765/index.html");
    await page.waitForTimeout(500);
    await page.getByText(/^Round history/).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "375x812-02-history-seeds.png"), fullPage: true });

    // ---- 4. One seed card view (tap the first seed row) ----
    await page.getByText("card", { exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "375x812-03-seed-card-view.png"), fullPage: true });
  }

  // ---- 5. Course-map failure lines: network-error, then no-holes ----
  {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await installRoutes(page, "fail");
    await page.goto("http://localhost:8765/index.html");
    await page.waitForTimeout(500);
    await pickCourse(page);
    await page.waitForSelector('text=could not reach the map server', { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, "375x812-04-map-network-error.png") });
    await ctx.close();
  }
  {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await installRoutes(page, "empty");
    await page.goto("http://localhost:8765/index.html");
    await page.waitForTimeout(500);
    await pickCourse(page);
    await page.waitForSelector('text=OpenStreetMap has no holes', { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, "375x812-05-map-no-holes.png") });
    await ctx.close();
  }

  await b.close();
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
