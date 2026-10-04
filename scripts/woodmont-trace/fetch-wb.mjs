// fetch-wb.mjs <release> <z> <x0> <y0> <cols> <rows> <outdir>  — Wayback tiles, 10 at a time, skip existing
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
const [rel, z, x0, y0, cols, rows, dir] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const jobs = [];
for (let y = +y0; y < +y0 + +rows; y++) for (let x = +x0; x < +x0 + +cols; x++) jobs.push([x, y]);
let ok = 0, bad = 0;
async function worker() {
  while (jobs.length) {
    const [x, y] = jobs.shift(); const f = `${dir}/${x}_${y}.jpg`;
    if (existsSync(f)) { ok++; continue; }
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${rel}/${z}/${y}/${x}`, { headers: H });
        const b = Buffer.from(await r.arrayBuffer());
        if (r.ok && /image/.test(r.headers.get("content-type") || "") && b.length > 1500) { writeFileSync(f, b); ok++; break; }
        if (a === 2) { bad++; console.log("bad", x, y, r.status, b.length); }
      } catch (e) { if (a === 2) { bad++; console.log("threw", x, y, e.message); } }
    }
  }
}
await Promise.all(Array.from({ length: 10 }, worker));
console.log(`done ok ${ok} bad ${bad}`);
