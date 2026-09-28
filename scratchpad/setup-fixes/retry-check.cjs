/* Sanity check (not a deliverable screenshot): tap-to-retry on a network-error course-map
 * status actually re-fetches, and succeeds once the route is fixed. */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");

const COURSE_ID = 9001;
const PARS = [4,4,3,5,4,4,3,5,4, 4,4,3,5,4,4,3,5,4];
const SI = [7,13,17,1,9,3,15,11,5, 8,14,18,2,10,4,16,12,6];
const YARDS = [410,165,320,560,400,380,190,540,430, 420,150,340,580,390,410,175,520,400];
const holesFor = () => PARS.map((par, i) => ({ par, handicap: SI[i], yardage: YARDS[i] }));
const FULL_COURSE = { id: COURSE_ID, club_name: "Ironwood Golf Club", course_name: "Ironwood Golf Club",
  location: { latitude: 34.05, longitude: -84.1, city: "Test City", state: "GA" },
  tees: { male: [{ tee_name: "Gold", course_rating: 73.1, slope_rating: 135, par_total: 72, holes: holesFor() }], female: [] } };
const SEARCH_RESULTS = [{ id: COURSE_ID, club_name: "Ironwood Golf Club", course_name: "Ironwood Golf Club", location: { city: "Test City", state: "GA" } }];

let overpassCalls = 0;
let overpassShouldFail = true;

async function json(route, body) { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }); }

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.route(/^(?!http:\/\/localhost:8765).*/, async (route) => {
    const url = route.request().url();
    if (url.includes("api.golfcourseapi.com/v1/search")) return json(route, { courses: SEARCH_RESULTS });
    if (url.includes(`api.golfcourseapi.com/v1/courses/${COURSE_ID}`)) return json(route, { course: FULL_COURSE });
    if (url.includes("overpass-api.de")) {
      overpassCalls++;
      if (overpassShouldFail) return route.fulfill({ status: 500, body: "down" });
      return json(route, { elements: [] }); // succeeds but no holes -> "no-holes", proves the retry re-ran the fetch
    }
    return route.abort();
  });
  await page.goto("http://localhost:8765/index.html");
  await page.waitForTimeout(400);
  await page.getByText("Tap to choose").click();
  await page.getByPlaceholder("Course name…").fill("Ironwood");
  await page.waitForTimeout(600);
  await page.getByText("Ironwood Golf Club", { exact: true }).first().click();
  await page.waitForSelector('text=could not reach the map server', { timeout: 8000 });
  const callsAfterFailure = overpassCalls;                // both mirrors tried and failed
  console.log("overpassCalls after initial failure:", callsAfterFailure);
  overpassShouldFail = false;
  await page.getByText(/tap to retry/).click();
  await page.waitForSelector('text=OpenStreetMap has no holes', { timeout: 8000 });
  console.log("overpassCalls after retry:", overpassCalls);
  console.log(overpassCalls > callsAfterFailure ? "PASS: retry re-ran the fetch" : "FAIL: retry did not re-fetch");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
