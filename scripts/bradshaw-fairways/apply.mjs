#!/usr/bin/env node
/*
 * apply.mjs — writes ship.py's fairways into src/localGeometry/bradshaw.json (v22.63, C40, D135).
 *
 *   WORK=<dir> node scripts/bradshaw-fairways/apply.mjs [--out=<file>]
 *
 * Each grown fairway replaces the OSM way it grew from (matched by index and id), `source.fairways` says how, and
 * `version` goes up one so the phones' cached copy is replaced once. The rest of the file is written as it was.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const work = process.env.WORK || "/tmp/bradshaw-fairways";
const outArg = process.argv.find((a) => a.startsWith("--out="));
const file = join(here, "..", "..", "src", "localGeometry", "bradshaw.json");
const text = readFileSync(file, "utf8");
const esc = (s) => s.replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const fmt = [esc, (s) => s].find((f) => f(JSON.stringify(JSON.parse(text))) === text);
if (!fmt) throw new Error("bradshaw.json doesn't round-trip; check its formatting first");
const data = JSON.parse(text);
const { criteria, replace } = JSON.parse(readFileSync(join(work, "fairways-ship.json"), "utf8"));
for (const r of replace) {
  const w = data.ways[r.index];
  if (!w || w.tags?.golf !== "fairway" || w.id !== r.id) throw new Error(`way ${r.index} is not fairway ${r.id}`);
  data.ways[r.index] = r.way;
}
data.version = (data.version || 1) + 1;
data.source = { ...data.source, fairways: `OSM's, ${replace.length} of them grown where the winter Esri photo (Wayback 63116: dormant rough, green fairway) reads fairway past OSM's edge — d′ ≥ ${criteria.dprime}, log-likelihood ≥ ${criteria.lr}, pieces ≥ ${criteria.areaM2} m² touching OSM's fairway, never into the lidar trees (scripts/bradshaw-fairways/, D135); q "osm+photo".` };
writeFileSync(outArg ? outArg.slice(6) : file, fmt(JSON.stringify(data)));
console.log(`bradshaw: ${replace.length} fairways grown (+${replace.reduce((s, r) => s + r.addedM2, 0)} m²), version ${data.version}`);
