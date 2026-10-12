#!/usr/bin/env node
/*
 * apply.mjs — step 3 of the lidar trees: <club>-woods.json (trees.py) into src/localGeometry/<club>.json.
 *
 *   node apply.mjs <club> [--out=<file>]
 *
 * Every `natural=wood` way traced automatically from a photo (`q: "auto"`, D74 / D126) or by an earlier run
 * (`q: "lidar"`) is replaced; OSM's own woods (`q: "osm"`) stay. `source.woods` says where the trees came from,
 * and `version` goes up one so the phones' cached copy is replaced once. The rest of the file is written as it
 * was (non-ASCII escaped, as Python wrote it), so the diff is the woods, the note and the version.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const club = process.argv[2];
const outArg = process.argv.find((a) => a.startsWith("--out="));
const file = join(here, "..", "..", "src", "localGeometry", `${club}.json`);
const text = readFileSync(file, "utf8");
const esc = (s) => s.replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
if (esc(JSON.stringify(JSON.parse(text))) !== text) throw new Error(`${club}.json doesn't round-trip; check its formatting first`);
const data = JSON.parse(text);
const { survey, woods } = JSON.parse(readFileSync(`${club}-woods.json`, "utf8"));
const isTraced = (w) => w.tags?.natural === "wood" && (w.q === "auto" || w.q === "lidar");
const before = data.ways.filter(isTraced).length;
data.ways = [...data.ways.filter((w) => !isTraced(w)), ...woods];
data.version = (data.version || 1) + 1;
data.source = { ...data.source, woods: `USGS 3DEP lidar point cloud (${survey}, s3://usgs-lidar-public): every 1 m cell whose highest return stands 3 m or more above the bare earth and holds high-vegetation points, within 75 m of a hole line, off the mapped turf, bunkers and water (scripts/lidar-trees/, D133).` };
writeFileSync(outArg ? outArg.slice(6) : file, esc(JSON.stringify(data)));
console.log(`${club}: ${before} traced woods → ${woods.length} from lidar, version ${data.version}`);
