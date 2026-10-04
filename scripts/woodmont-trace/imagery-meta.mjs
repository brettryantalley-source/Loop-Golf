// What imagery is under Woodmont in Esri World Imagery: capture date, nominal resolution, stated horizontal accuracy.
const H = { "User-Agent": "Loop-Golf-tracing/1.0 (personal golf app; https://github.com/brettryantalley-source/Loop-Golf)" };
const base = "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer";
const j = async (u) => { const r = await fetch(u, { headers: H }); const t = await r.text(); try { return JSON.parse(t); } catch { return { _status: r.status, _text: t.slice(0, 200) }; } };
const root = await j(`${base}?f=json`);
console.log("layers:", (root.layers || []).map((l) => `${l.id}:${l.name}`).join(" | ") || JSON.stringify(root).slice(0, 300));
// the point query; try every layer, keep the ones that return attributes
const pt = "-84.3538,34.2315";
for (const l of root.layers || []) {
  const q = `${base}/${l.id}/query?geometry=${pt}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
  const r = await j(q);
  const f = r.features || [];
  if (f.length) {
    const a = f[0].attributes;
    const keep = Object.fromEntries(Object.entries(a).filter(([k]) => /name|date|res|acc|source|sensor|prod/i.test(k)));
    console.log(`layer ${l.id} (${l.name}) hits ${f.length}:`, JSON.stringify(keep));
  }
}
