// Woodmont's mapped cart paths with full geometry (the routing graph), saved to carts.json. Retries across endpoints.
import { writeFileSync } from "node:fs";
const OUT = "/tmp/woodmont-trace";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = `[out:json][timeout:60];way["golf"="cartpath"](around:1500,34.2315,-84.3538);out geom;`;
const H = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)", "Accept": "application/json" };
const urls = ["https://overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
for (let attempt = 0; attempt < 9; attempt++) {
  const u = urls[attempt % urls.length];
  await sleep(attempt ? 12000 : 0);
  try {
    const r = await fetch(u, { method: "POST", headers: H, body: "data=" + encodeURIComponent(q) });
    if (!r.ok) { console.log(attempt, u, "http", r.status); continue; }
    const j = await r.json();
    writeFileSync(`${OUT}/carts.json`, JSON.stringify(j));
    console.log("ok", u, "ways:", j.elements.length, "nodes:", j.elements.reduce((a, e) => a + (e.geometry?.length || 0), 0));
    process.exit(0);
  } catch (e) { console.log(attempt, u, "threw", e.message); }
}
console.log("gave up");
