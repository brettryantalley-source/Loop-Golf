// Which Wayback releases give a *different* picture over Woodmont (tile hash), and how green is each (season proxy)?
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const OUT = "/tmp/woodmont-trace";
mkdirSync(`${OUT}/wb`, { recursive: true });
const rels = JSON.parse(readFileSync(`${OUT}/wayback-releases.json`, "utf8"));
const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const Z = 18, X = 69647, Y = 104514;
const dateOf = (t) => (t.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
const jobs = rels.map((r) => ({ num: r.num, date: dateOf(r.title), url: r.url.replace("{level}", Z).replace("{row}", Y).replace("{col}", X) }));
const results = [];
async function worker() {
  while (jobs.length) {
    const j = jobs.shift();
    try {
      const r = await fetch(j.url, { headers: H });
      const b = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !/image/.test(r.headers.get("content-type") || "")) { results.push({ ...j, ok: false, status: r.status, len: b.length }); continue; }
      results.push({ ...j, ok: true, len: b.length, md5: createHash("md5").update(b).digest("hex"), buf: b });
    } catch (e) { results.push({ ...j, ok: false, status: String(e.message) }); }
  }
}
await Promise.all(Array.from({ length: 10 }, worker));
const ok = results.filter((r) => r.ok).sort((a, b) => String(a.date).localeCompare(String(b.date)));
console.log("fetched", results.length, "ok", ok.length, "failed", results.length - ok.length);
const byHash = new Map();
for (const r of ok) { if (!byHash.has(r.md5)) byHash.set(r.md5, []); byHash.get(r.md5).push(r); }
console.log("distinct pictures:", byHash.size);
const rows = [];
for (const [h, list] of byHash) {
  const first = list[0];
  mkdirSync(`${OUT}/wb`, { recursive: true });
  writeFileSync(`${OUT}/wb/${first.date}_${first.num}.jpg`, first.buf);
  rows.push({ date: first.date, num: first.num, count: list.length, bytes: first.len });
}
rows.sort((a, b) => a.date.localeCompare(b.date));
for (const r of rows) console.log(`  ${r.date}  release ${r.num}  (same picture in ${r.count} release${r.count > 1 ? "s" : ""})  ${r.bytes} B`);
writeFileSync(`${OUT}/wayback-distinct.json`, JSON.stringify(rows));
