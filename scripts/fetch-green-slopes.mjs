#!/usr/bin/env node
/*
 * fetch-green-slopes.mjs — bake a 2 m USGS 3DEP lidar grid over every green of a bundled course map
 * (v22.60, R10, D131). Offline tool: not in the build, not run by `npm test`.
 *
 *   node scripts/fetch-green-slopes.mjs [club …]   # default: woodmont chicopee riverpines hampton bradshaw
 *
 * For each green way in src/localGeometry/<club>.json: a 2 m lat/lon grid over the green's box plus
 * 4 m, every cell within 3 m of the green kept (a slope at the edge needs its neighbours), sampled from
 * the 3DEP ImageServer's getSamples (1 m lidar where flown, bilinear, batches of 500 points) and written
 * into the file as `greenGrids` — beside the 20 m `elevation` grid (fetch-3dep.mjs), which is too coarse for
 * a green. The app turns each grid into downhill arrows and a putt read (src/caddie/greenslope.js).
 *
 * Stored compactly (src/localGeometry.js `greenGrids` expands it):
 *   greenGrids: { source, fetched, stepM, grids: [{ c: [lat, lon], lat0, lon0, dLat, dLon, nx, ny, baseCm,
 *            rows: [[j, i0, [d, d, …]], …] }] }
 *   cell (i, j) sits at lat0 + j·dLat, lon0 + i·dLon; its elevation is (baseCm + d) / 100 metres; a row is
 *   a run of consecutive i from i0; `c` is the green's centroid, which the app matches to a hole's green.
 * The rest of the file is kept byte for byte and its `version` is not bumped: like `elevation`, the grids
 * ride the bundle in memory and are never cached (the cached geometry has none to replace).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "..", "src", "localGeometry");
const URL_3DEP = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const STEP_M = 2, PAD_M = 4, KEEP_M = 3, BATCH = 500;
const M_PER_DEG = 111320;

const clubs = process.argv.slice(2).length ? process.argv.slice(2) : ["woodmont", "chicopee", "riverpines", "hampton", "bradshaw"];

async function samples(points) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryMultipoint", returnFirstValueOnly: "true",
    interpolation: "RSP_BilinearInterpolation", f: "json",
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(URL_3DEP, { method: "POST", body });
      const j = await r.json();
      if (!Array.isArray(j.samples)) throw new Error(JSON.stringify(j.error || j).slice(0, 200));
      const out = new Array(points.length).fill(null);
      for (const s of j.samples) { const v = Number(s.value); if (Number.isFinite(v) && v > -1000) out[s.locationId] = v; }
      return out;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}

/** Is local point (x east, y north, metres) inside the ring, or within `m` metres of its edge? */
function nearRing(ring, x, y, m) {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  if (inside) return true;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [xa, ya] = ring[a], [xb, yb] = ring[b];
    const dx = xb - xa, dy = yb - ya, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xa) * dx + (y - ya) * dy) / L));
    if (Math.hypot(x - (xa + t * dx), y - (ya + t * dy)) <= m) return true;
  }
  return false;
}

for (const club of clubs) {
  const file = join(DIR, `${club}.json`);
  const text = readFileSync(file, "utf8");
  const data = JSON.parse(text);
  const greens = data.ways.filter((w) => w.tags?.golf === "green" && Array.isArray(w.pts) && w.pts.length >= 3);
  const grids = [];
  let n = 0;
  for (const g of greens) {
    const lat0c = g.pts.reduce((s, p) => s + p[0], 0) / g.pts.length, lon0c = g.pts.reduce((s, p) => s + p[1], 0) / g.pts.length;
    const mLon = M_PER_DEG * Math.cos((lat0c * Math.PI) / 180);
    const ring = g.pts.map(([la, lo]) => [(lo - lon0c) * mLon, (la - lat0c) * M_PER_DEG]);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const x0 = Math.min(...xs) - PAD_M, y0 = Math.min(...ys) - PAD_M;
    const nx = Math.ceil((Math.max(...xs) + PAD_M - x0) / STEP_M) + 1, ny = Math.ceil((Math.max(...ys) + PAD_M - y0) / STEP_M) + 1;
    const dLat = STEP_M / M_PER_DEG, dLon = STEP_M / mLon;
    const lat0 = lat0c + y0 / M_PER_DEG, lon0 = lon0c + x0 / mLon;
    const cells = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (nearRing(ring, x0 + i * STEP_M, y0 + j * STEP_M, KEEP_M)) cells.push([i, j]);
    const vals = [];
    for (let k = 0; k < cells.length; k += BATCH) {
      const pts = cells.slice(k, k + BATCH).map(([i, j]) => [+(lon0 + i * dLon).toFixed(7), +(lat0 + j * dLat).toFixed(7)]);
      vals.push(...(await samples(pts)));
    }
    const ok = vals.filter((v) => v != null);
    if (!ok.length) { console.log(club, "a green with no lidar, skipped"); continue; }
    const baseCm = Math.round(Math.min(...ok) * 100);
    const byRow = new Map();
    cells.forEach(([i, j], k) => { if (vals[k] != null) { if (!byRow.has(j)) byRow.set(j, []); byRow.get(j).push([i, Math.round(vals[k] * 100) - baseCm]); } });
    const rows = [];
    for (const [j, list] of [...byRow].sort((a, b) => a[0] - b[0])) {
      let run = null;
      for (const [i, d] of list.sort((a, b) => a[0] - b[0])) {
        if (run && i === run[1] + run[2].length) run[2].push(d);
        else { run = [j, i, [d]]; rows.push(run); }
      }
    }
    grids.push({ c: [+lat0c.toFixed(6), +lon0c.toFixed(6)], lat0: +lat0.toFixed(7), lon0: +lon0.toFixed(7), dLat: +dLat.toFixed(9), dLon: +dLon.toFixed(9), nx, ny, baseCm, rows });
    n += ok.length;
  }
  const greenGrids = { source: "USGS 3DEP 1 m lidar (elevation.nationalmap.gov ImageServer getSamples, bilinear), via scripts/fetch-green-slopes.mjs",
    fetched: new Date().toISOString().slice(0, 10), stepM: STEP_M, grids };
  // keep the rest of the file byte for byte: the grids replaced or appended at the end
  let out = text;
  const at = out.indexOf(',"greenGrids":{');
  if (at >= 0) out = out.slice(0, at) + "}";
  out = out.replace(/\}\s*$/, `,"greenGrids":${JSON.stringify(greenGrids)}}`);
  JSON.parse(out);
  writeFileSync(file, out);
  console.log(`${club}: ${grids.length} of ${greens.length} greens, ${n} cells, +${((out.length - text.length) / 1000) | 0} KB`);
}
