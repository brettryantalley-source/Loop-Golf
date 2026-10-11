#!/usr/bin/env node
/*
 * fetch-3dep.mjs — bake USGS 3DEP elevation (1 m lidar where flown) into a bundled course map
 * (v22.45, C34, D116). Offline tool: not in the build, not run by `npm test`.
 *
 *   node scripts/fetch-3dep.mjs [club …]      # default: woodmont chicopee riverpines hampton bradshaw
 *
 * For each src/localGeometry/<club>.json: a 20 m lat/lon grid over every cell within 90 m of a hole
 * line, sampled from the 3DEP ImageServer's getSamples (bilinear, batches of 500 points), written
 * into the file as `elevation` and the file's `version` bumped so phones replace their cached copy
 * once. Open-Meteo's ~90 m grid (sensors.js) read up to 6 m off the lidar on Bradshaw Red 2 and 3;
 * the bundled grid replaces it for these clubs and works with no signal.
 *
 * Stored compactly (src/localGeometry.js `elevationSamples` expands it):
 *   elevation: { source, fetched, stepM, lat0, lon0, dLat, dLon, baseDm,
 *                rows: [[j, i0, [d, d, …]], …] }
 *   cell (i, j) sits at lat0 + j·dLat, lon0 + i·dLon; its elevation is (baseDm + d) / 10 metres;
 *   a row holds a run of consecutive i from i0; a cell 3DEP had no value for ends the run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, "..", "src", "localGeometry");
const URL_3DEP = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples";
const STEP_M = 20, NEAR_M = 90, BATCH = 500, PAR = 3;
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

for (const club of clubs) {
  const file = join(DIR, `${club}.json`);
  const text = readFileSync(file, "utf8");
  const data = JSON.parse(text);
  const lines = data.ways.filter((w) => w.tags?.golf === "hole" && Array.isArray(w.pts)).map((w) => w.pts);
  if (!lines.length) { console.log(club, "no hole lines, skipped"); continue; }
  const all = lines.flat();
  const latMid = all.reduce((s, p) => s + p[0], 0) / all.length;
  const kx = M_PER_DEG * Math.cos((latMid * Math.PI) / 180), ky = M_PER_DEG;
  const dLat = +(STEP_M / ky).toFixed(8), dLon = +(STEP_M / kx).toFixed(8);
  const minLat = Math.min(...all.map((p) => p[0])) - NEAR_M / ky, maxLat = Math.max(...all.map((p) => p[0])) + NEAR_M / ky;
  const minLon = Math.min(...all.map((p) => p[1])) - NEAR_M / kx, maxLon = Math.max(...all.map((p) => p[1])) + NEAR_M / kx;
  const lat0 = +(Math.floor(minLat / dLat) * dLat).toFixed(7), lon0 = +(Math.floor(minLon / dLon) * dLon).toFixed(7);
  // hole segments in local metres, for the near-a-hole test
  const xy = (p) => [(p[1] - lon0) * kx, (p[0] - lat0) * ky];
  const segs = lines.flatMap((l) => l.slice(1).map((p, k) => [xy(l[k]), xy(p)]));
  const segDist = (P, [A, B]) => {
    const vx = B[0] - A[0], vy = B[1] - A[1], L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * vx + (P[1] - A[1]) * vy) / L2)) : 0;
    return Math.hypot(P[0] - (A[0] + t * vx), P[1] - (A[1] + t * vy));
  };
  const cells = [];
  const J = Math.ceil((maxLat - lat0) / dLat), I = Math.ceil((maxLon - lon0) / dLon);
  for (let j = 0; j <= J; j++) for (let i = 0; i <= I; i++) {
    const P = [i * STEP_M, j * STEP_M];
    if (segs.some((s) => segDist(P, s) <= NEAR_M)) cells.push({ i, j, lat: lat0 + j * dLat, lon: lon0 + i * dLon });
  }
  const batches = [];
  for (let k = 0; k < cells.length; k += BATCH) batches.push(cells.slice(k, k + BATCH));
  let done = 0;
  const queue = batches.map((b, n) => ({ b, n }));
  await Promise.all(Array.from({ length: PAR }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const v = await samples(job.b.map((c) => [+c.lon.toFixed(7), +c.lat.toFixed(7)]));
      job.b.forEach((c, k) => { c.m = v[k]; });
      done += job.b.length;
      process.stdout.write(`\r${club}: ${done}/${cells.length}`);
    }
  }));
  const got = cells.filter((c) => c.m != null);
  const baseDm = Math.floor(Math.min(...got.map((c) => c.m)) * 10);
  const rows = [];
  const byRow = new Map();
  for (const c of got) { if (!byRow.has(c.j)) byRow.set(c.j, []); byRow.get(c.j).push(c); }
  for (const j of [...byRow.keys()].sort((a, b) => a - b)) {
    const row = byRow.get(j).sort((a, b) => a.i - b.i);
    let run = null;
    for (const c of row) {
      const d = Math.round(c.m * 10) - baseDm;
      if (run && c.i === run[1] + run[2].length) run[2].push(d);
      else { run = [j, c.i, [d]]; rows.push(run); }
    }
  }
  const elevation = {
    source: "USGS 3DEP (elevation.nationalmap.gov 3DEPElevation ImageServer getSamples, bilinear; 1 m lidar where flown), via scripts/fetch-3dep.mjs",
    fetched: new Date().toISOString().slice(0, 10), stepM: STEP_M, nearHoleM: NEAR_M,
    lat0, lon0, dLat, dLon, baseDm, rows,
  };
  const version = (Number(data.version) || 0) + 1;
  // keep the rest of the file byte for byte: the version in place, the grid replaced or appended
  let out = text.replace(/^\{"version":\d+/, `{"version":${version}`);
  const at = out.indexOf(',"elevation":{');
  if (at >= 0) out = out.slice(0, at) + "}";
  out = out.replace(/\}\s*$/, `,"elevation":${JSON.stringify(elevation)}}`);
  JSON.parse(out);
  writeFileSync(file, out);
  const span = got.map((c) => c.m);
  console.log(`\r${club}: ${got.length}/${cells.length} cells, ${Math.min(...span).toFixed(1)}–${Math.max(...span).toFixed(1)} m, version ${data.version} → ${version}, +${(out.length - text.length) / 1000 | 0} KB`);
}
