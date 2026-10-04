// Overview mosaic of Woodmont (Esri World Imagery, z17) with the OSM outline and the API anchor drawn on it.
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = "/tmp/woodmont-trace";
const Z = Number(process.argv[2] || 17);
const A = JSON.parse(readFileSync(`${OUT}/woodmont-A.json`, "utf8"));
const ring = A.elements.find((e) => e.tags?.leisure === "golf_course").geometry;
const ANCHOR = { lat: 34.2315, lon: -84.3538 };
const n = 2 ** Z;
const wx = (lon) => ((lon + 180) / 360) * n;
const wy = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n; };
const lats = ring.map((p) => p.lat), lons = ring.map((p) => p.lon);
const x0 = Math.floor(wx(Math.min(...lons))), x1 = Math.floor(wx(Math.max(...lons)));
const y0 = Math.floor(wy(Math.max(...lats))), y1 = Math.floor(wy(Math.min(...lats)));
const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
console.log(`z${Z}: tiles x ${x0}..${x1}, y ${y0}..${y1} -> ${cols}×${rows} = ${cols * rows} tiles · ${(156543.03 * Math.cos((ANCHOR.lat * Math.PI) / 180) / n).toFixed(3)} m/px`);

const dir = `${OUT}/t${Z}`;
mkdirSync(dir, { recursive: true });
const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const files = [];
let bad = 0;
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const f = `${dir}/${x}_${y}.jpg`;
    files.push(f);
    if (existsSync(f)) continue;
    try {
      const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`, { headers: H });
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !/image/.test(r.headers.get("content-type") || "")) { bad++; console.log("tile", x, y, "->", r.status, r.headers.get("content-type")); continue; }
      writeFileSync(f, buf);
    } catch (e) { bad++; console.log("tile", x, y, "threw", e.message); }
  }
}
if (bad) { console.log("missing tiles:", bad); process.exit(1); }

execFileSync("montage", ["-mode", "concatenate", "-tile", `${cols}x${rows}`, ...files, `${OUT}/mosaic-z${Z}.jpg`]);
const px = (p) => `${((wx(p.lon) - x0) * 256).toFixed(1)},${((wy(p.lat) - y0) * 256).toFixed(1)}`;
const poly = "polyline " + [...ring, ring[0]].map(px).join(" ");
const a = px(ANCHOR).split(",").map(Number);
execFileSync("convert", [`${OUT}/mosaic-z${Z}.jpg`, "-fill", "none", "-stroke", "red", "-strokewidth", "2", "-draw", poly,
  "-stroke", "yellow", "-strokewidth", "3", "-draw", `circle ${a[0]},${a[1]} ${a[0] + 7},${a[1]}`, `${OUT}/overview-z${Z}.png`]);
console.log("wrote", `${OUT}/overview-z${Z}.png`);
