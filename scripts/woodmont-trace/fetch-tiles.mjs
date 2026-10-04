// fetch-tiles.mjs <z> <south> <west> <north> <east> <outdir>
// Esri World Imagery tiles for a lat/lon box, 8 at a time, skipping any already on disk. Writes <outdir>/meta.json.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const [zArg, sArg, wArg, nArg, eArg, dir] = process.argv.slice(2);
const Z = Number(zArg), S = Number(sArg), W = Number(wArg), N = Number(nArg), E = Number(eArg);
const n = 2 ** Z;
const wx = (lon) => ((lon + 180) / 360) * n;
const wy = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const x0 = Math.floor(wx(W)), x1 = Math.floor(wx(E));
const y0 = Math.floor(wy(N)), y1 = Math.floor(wy(S));
const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/meta.json`, JSON.stringify({ z: Z, x0, y0, cols, rows }));
console.log(`z${Z}: x ${x0}..${x1}, y ${y0}..${y1} -> ${cols}×${rows} = ${cols * rows} tiles`);

const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const jobs = [];
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
let done = 0, bad = 0;
async function worker() {
  while (jobs.length) {
    const [x, y] = jobs.shift();
    const f = `${dir}/${x}_${y}.jpg`;
    if (existsSync(f)) { done++; continue; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`, { headers: H });
        const b = Buffer.from(await r.arrayBuffer());
        if (r.ok && /image/.test(r.headers.get("content-type") || "") && b.length > 3000) { writeFileSync(f, b); done++; break; }
        if (attempt === 2) { bad++; console.log("bad tile", x, y, r.status, b.length); }
      } catch (e) { if (attempt === 2) { bad++; console.log("tile threw", x, y, e.message); } }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`done ${done}, bad ${bad}`);
