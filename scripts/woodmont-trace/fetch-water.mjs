// Waterways (creeks) around Woodmont with geometry, plus any golf=* water hazards; saved to waterways.json. Retries across endpoints.
import { writeFileSync } from "node:fs";
const OUT = "/tmp/woodmont-trace";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bbox = "34.2215,-84.3619,34.2355,-84.3415";
const q = `[out:json][timeout:60];(way["waterway"](${bbox});way["natural"="water"](${bbox});way["golf"~"water_hazard|lateral_water_hazard"](${bbox}););out geom tags;`;
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)", "Accept": "application/json" };
const urls = ["https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"];
for (let attempt = 0; attempt < 9; attempt++) {
  const u = urls[attempt % urls.length];
  await sleep(attempt ? 10000 : 0);
  try {
    const r = await fetch(u, { method: "POST", headers: H, body: "data=" + encodeURIComponent(q) });
    if (!r.ok) { console.log(attempt, u, "http", r.status); continue; }
    const j = await r.json();
    writeFileSync(`${OUT}/waterways.json`, JSON.stringify(j));
    const kinds = {};
    for (const e of j.elements) { const k = e.tags?.waterway ? "waterway=" + e.tags.waterway : e.tags?.natural ? "natural=" + e.tags.natural : "golf=" + e.tags?.golf; kinds[k] = (kinds[k] || 0) + 1; }
    console.log("ok", u, j.elements.length, kinds);
    process.exit(0);
  } catch (e) { console.log(attempt, u, "threw", e.message); }
}
console.log("gave up");
