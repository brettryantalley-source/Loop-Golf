// Woodmont Golf & CC (golfcourseapi tnw4ghn5) — does OSM have it, and what would Loop's Setup say?
// Uses the app's own overpassQuery / parseOverpass / coverageCheck. Read-only; writes only to the scratchpad.
import { writeFileSync } from "node:fs";
import { overpassQuery, parseOverpass, haversineM, pointInRing, distToRingM, distToPolylineM, OVERPASS_URLS } from "/home/user/Loop-Golf/src/geometry.js";
import { coverageCheck } from "/home/user/Loop-Golf/src/caddie/geo.js";

const OUT = "/tmp/woodmont-trace";
const ANCHOR = { lat: 34.2315, lon: -84.3538 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(query, label) {
  let lastErr = null;
  // lz4 first (it is the one that answers from this sandbox); retry 5xx a few times with backoff.
  // The app's two endpoints first (lz4 with growing backoff); the two extra public mirrors are harness-only fallbacks for the same OSM data.
  const plan = [[OVERPASS_URLS[0], 3000], [OVERPASS_URLS[0], 20000], [OVERPASS_URLS[0], 40000], [OVERPASS_URLS[1], 0],
                ["https://overpass.private.coffee/api/interpreter", 0], ["https://overpass.kumi.systems/api/interpreter", 0]];
  for (const [url, wait] of plan) {
    await sleep(wait);
    try {
      // Overpass's Apache 406s generic clients; node's fetch has no browser UA, so identify ourselves (harness only — the app runs in a browser).
      const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)", "Accept": "application/json" };
      const r = await fetch(url, { method: "POST", headers, body: "data=" + encodeURIComponent(query) });
      if (!r.ok) { const t = (await r.text()).replace(/\s+/g, " ").slice(0, 160); lastErr = new Error(`${url} -> http ${r.status}`); console.log(`[${label}] ${url} http ${r.status} · ${t}`); continue; }
      const json = await r.json();
      console.log(`[${label}] ${url} ok · ${json.elements?.length ?? 0} elements`);
      return json;
    } catch (e) {
      lastErr = e;
      console.log(`[${label}] ${url} threw: ${e.message}${e.cause ? " · cause: " + (e.cause.code || e.cause.message) : ""}`);
    }
  }
  throw lastErr || new Error("unreachable");
}

console.log("node", process.version);

/* ---------- A. the app's exact query ---------- */
const qA = overpassQuery(ANCHOR.lat, ANCHOR.lon);
console.log("\n=== A. app query ===\n" + qA.split("\n")[0] + " … bbox line:", qA.match(/\(([-\d.,]+)\)/)[1]);
let rawA;
try { rawA = await post(qA, "A"); }
catch (e) { console.log("PHASE the app would show: network-error (fetchGeometry threw):", e.message); process.exit(0); }
writeFileSync(`${OUT}/woodmont-A.json`, JSON.stringify(rawA));

const tally = {};
for (const el of rawA.elements) {
  const t = el.tags || {};
  const k = t.golf ? `golf=${t.golf}` : t.leisure ? `leisure=${t.leisure}` : t.natural ? `natural=${t.natural}` : t.landuse ? `landuse=${t.landuse}` : "other";
  const kk = `${el.type}:${k}`;
  tally[kk] = (tally[kk] || 0) + 1;
}
console.log("element tally (type:tag):", tally);

const g = parseOverpass(rawA);
const holeKeys = Object.keys(g.holes);
console.log("\nhole ways parsed:", holeKeys.length, "refs:", Object.values(g.holes).map((h) => h.ref).sort((a, b) => a - b).join(","));
console.log("greens:", g.greens.length, "· features:", g.features.reduce((m, f) => (m[f.kind] = (m[f.kind] || 0) + 1, m), {}), "· trouble:", g.trouble.reduce((m, f) => (m[f.kind] = (m[f.kind] || 0) + 1, m), {}));
console.log("boundary:", g.boundary ? { name: g.boundary.name, osmId: g.boundary.osmId, nodes: g.boundary.ring.length } : null);
console.log("parse warnings:", g.warnings.slice(0, 40));

const expected = [...Array(18)].map((_, i) => i + 1);
const cov = coverageCheck(g, { expected });
const mapped = 18 - cov.missing.filter((k) => Number.isInteger(k) || /^\d+$/.test(String(k))).length;
console.log("\ncoverageCheck:", { complete: cov.complete, missing: cov.missing, reasons: cov.reasons, orphanGreens: cov.orphanGreens });
console.log("mapped holes (app's formula):", mapped, "of 18");
const phase = mapped <= 0 ? "no-holes" : mapped < 18 ? "partial" : "ready (→ tile prefetch)";
console.log("PHASE the app would show:", phase);

/* per-hole detail */
console.log("\nper hole  (line nodes · green? · fairways · tees · hazards · par tag)");
for (let n = 1; n <= 18; n++) {
  const h = g.holes[n] || Object.values(g.holes).find((x) => x.ref === n);
  if (!h) { console.log(String(n).padStart(2), " —  no hole way"); continue; }
  const fs = g.features.filter((f) => (f.holeRefs || []).map(String).includes(String(h.key)));
  const tb = g.trouble.filter((f) => (f.holeRefs || []).map(String).includes(String(h.key)));
  console.log(String(n).padStart(2), `${h.line.length} nodes · green ${h.green ? "yes" : "NO"} · fw ${fs.filter((f) => f.kind === "fairway").length} · tee ${fs.filter((f) => f.kind === "tee").length} · haz ${tb.length} · par ${h.par ?? "-"}`);
}

/* ---------- anchor vs course outline ---------- */
console.log("\n=== anchor distances ===");
const allPts = (r) => r.map((p) => p);
const courses = rawA.elements.filter((e) => e.tags?.leisure === "golf_course");
for (const c of courses) {
  const ring = (c.geometry || (c.members || []).flatMap((m) => m.geometry || [])).filter(Boolean).map((p) => ({ lat: p.lat, lon: p.lon }));
  if (!ring.length) { console.log("golf_course", c.type, c.id, c.tags?.name, "(no geometry)"); continue; }
  const inside = pointInRing(ANCHOR, ring);
  const dEdge = inside ? 0 : distToRingM(ANCHOR, ring);
  const cen = ring.reduce((a, p) => ({ lat: a.lat + p.lat / ring.length, lon: a.lon + p.lon / ring.length }), { lat: 0, lon: 0 });
  console.log(`golf_course ${c.type}/${c.id} "${c.tags?.name}" · anchor ${inside ? "INSIDE" : "outside"} · edge ${Math.round(dEdge)} m · vertex-mean centre ${Math.round(haversineM(ANCHOR, cen))} m away`);
}
let nearestHole = null;
for (const h of Object.values(g.holes)) {
  const d = Math.min(haversineM(ANCHOR, h.teeEnd), haversineM(ANCHOR, h.greenEnd));
  if (!nearestHole || d < nearestHole.d) nearestHole = { ref: h.ref, d };
}
if (nearestHole) console.log("nearest hole end to anchor:", `hole ${nearestHole.ref}, ${Math.round(nearestHole.d)} m`);
const holeCentre = Object.values(g.holes).length ? Object.values(g.holes).reduce((a, h) => ({ lat: a.lat + (h.teeEnd.lat + h.greenEnd.lat) / 2 / Object.keys(g.holes).length, lon: a.lon + (h.teeEnd.lon + h.greenEnd.lon) / 2 / Object.keys(g.holes).length }), { lat: 0, lon: 0 }) : null;
if (holeCentre) console.log("mean hole-line midpoint is", Math.round(haversineM(ANCHOR, holeCentre)), "m from the anchor");

/* ---------- B. wider net: is it mapped, just not in the app's box? ---------- */
await sleep(2500);
const W = { s: ANCHOR.lat - 0.06, w: ANCHOR.lon - 0.08, n: ANCHOR.lat + 0.06, e: ANCHOR.lon + 0.08 };
const wb = `${W.s},${W.w},${W.n},${W.e}`;
console.log("\n=== B. wide net, bbox", wb, "(~13 km × 15 km) ===");
const qB = `[out:json][timeout:60];
(
  nwr["leisure"="golf_course"](${wb});
  nwr["golf"](${wb});
);
out tags center;`;
try {
  const rawB = await post(qB, "B");
  writeFileSync(`${OUT}/woodmont-B.json`, JSON.stringify(rawB));
  const courseEls = rawB.elements.filter((e) => e.tags?.leisure === "golf_course");
  console.log("golf_course elements in wide box:");
  for (const e of courseEls) {
    const c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    console.log(`  ${e.type}/${e.id} "${e.tags.name || "(unnamed)"}" ${c ? Math.round(haversineM(ANCHOR, c)) + " m from anchor" : ""} · ${Object.entries(e.tags).filter(([k]) => !["name", "leisure"].includes(k)).map(([k, v]) => k + "=" + v).join(" ")}`);
  }
  const golfTags = {};
  for (const e of rawB.elements) if (e.tags?.golf) { golfTags[e.tags.golf] = (golfTags[e.tags.golf] || 0) + 1; }
  console.log("golf=* tags in wide box:", golfTags);
  // cluster golf=hole by distance from anchor
  const holes = rawB.elements.filter((e) => e.tags?.golf === "hole" && e.center);
  const bands = { "<1.5km": 0, "1.5–3km": 0, "3–6km": 0, ">6km": 0 };
  for (const e of holes) { const d = haversineM(ANCHOR, e.center); bands[d < 1500 ? "<1.5km" : d < 3000 ? "1.5–3km" : d < 6000 ? "3–6km" : ">6km"]++; }
  console.log("golf=hole ways by distance from anchor:", bands, "total", holes.length);
} catch (e) { console.log("B failed:", e.message); }

/* ---------- C. anything named Woodmont near Canton ---------- */
await sleep(2500);
console.log("\n=== C. name search 'Woodmont' (Cherokee/Cobb/Bartow-wide box) ===");
const qC = `[out:json][timeout:60];
(
  nwr["name"~"Woodmont",i](33.9,-84.9,34.5,-84.0);
);
out tags center;`;
try {
  const rawC = await post(qC, "C");
  writeFileSync(`${OUT}/woodmont-C.json`, JSON.stringify(rawC));
  for (const e of rawC.elements) {
    const c = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    console.log(`  ${e.type}/${e.id} "${e.tags.name}" ${c ? Math.round(haversineM(ANCHOR, c)) + " m from anchor" : ""} · ${Object.entries(e.tags).filter(([k]) => k !== "name").slice(0, 6).map(([k, v]) => k + "=" + v).join(" ")}`);
  }
  if (!rawC.elements.length) console.log("  (nothing named Woodmont in that box)");
} catch (e) { console.log("C failed:", e.message); }
