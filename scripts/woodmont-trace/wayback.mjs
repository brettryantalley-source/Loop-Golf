// Esri World Imagery Wayback: which dated captures exist over Woodmont, and are any from the growing season?
import { writeFileSync } from "node:fs";
const OUT = "/tmp/woodmont-trace";
const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const get = async (u) => { const r = await fetch(u, { headers: H }); const t = await r.text(); try { return JSON.parse(t); } catch { return { _status: r.status, _text: t.slice(0, 160) }; } };
const cfg = await get("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json");
if (cfg._status) { console.log("config fetch failed:", cfg); process.exit(1); }
const rels = Object.entries(cfg).map(([num, v]) => ({ num, title: v.itemTitle, url: v.itemURL, meta: v.metadataLayerUrl, layer: v.layerIdentifier }));
console.log("releases:", rels.length, "first:", rels[0]?.title, "last:", rels.at(-1)?.title);
writeFileSync(`${OUT}/wayback-releases.json`, JSON.stringify(rels));
// query capture metadata at the point for every release, keep distinct (date,res,acc)
const pt = "-84.3538,34.2315";
const seen = new Map();
let n = 0;
for (const r of rels) {
  if (!r.meta) continue;
  const q = `${r.meta}/query?geometry=${pt}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=SRC_DATE2,SRC_DATE,SRC_RES,SRC_ACC,NICE_NAME&returnGeometry=false&f=json`;
  try {
    const j = await get(q);
    const a = j.features?.[0]?.attributes;
    if (!a) continue;
    const d = a.SRC_DATE2 ? new Date(a.SRC_DATE2).toISOString().slice(0, 10) : a.SRC_DATE;
    const key = `${d}|${a.SRC_RES}|${a.SRC_ACC}|${a.NICE_NAME}`;
    if (!seen.has(key)) seen.set(key, { first: r.title, num: r.num, date: d, res: a.SRC_RES, acc: a.SRC_ACC, name: a.NICE_NAME });
  } catch (e) { /* skip */ }
  if (++n % 25 === 0) console.log("  queried", n, "distinct so far", seen.size);
}
const rows = [...seen.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
console.log("\ndistinct captures over Woodmont:");
for (const r of rows) console.log(`  ${r.date}  res ${r.res} m  acc ${r.acc} m  ${r.name}  (first in release ${r.num}: ${r.first})`);
writeFileSync(`${OUT}/wayback-captures.json`, JSON.stringify(rows));
