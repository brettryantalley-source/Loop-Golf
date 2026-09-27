#!/usr/bin/env bash
# Rebuild index.html from src/app.jsx.
# Requires: esbuild (brew install esbuild) OR npx (falls back to `npx esbuild`), curl, python3.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p build

# Resolve esbuild: prefer a globally installed binary, else fall back to npx.
if command -v esbuild >/dev/null 2>&1; then
  ESBUILD=(esbuild)
elif command -v npx >/dev/null 2>&1; then
  echo "esbuild not on PATH — using 'npx --yes esbuild'."
  ESBUILD=(npx --yes esbuild)
else
  echo "ERROR: neither 'esbuild' nor 'npx' found. Install esbuild (brew install esbuild) or Node/npx." >&2
  exit 1
fi

# 1. Fetch React UMD builds if missing.
[ -f build/react.min.js ]     || curl -sSLo build/react.min.js     https://unpkg.com/react@18.3.1/umd/react.production.min.js
[ -f build/react-dom.min.js ] || curl -sSLo build/react-dom.min.js https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js

# 1b. MapLibre GL (v19) is served same-origin from vendor/ so the service worker can cache it.
#     Refresh the committed copies from node_modules when present (pinned in package.json).
if [ -f node_modules/maplibre-gl/dist/maplibre-gl.js ]; then
  cp node_modules/maplibre-gl/dist/maplibre-gl.js vendor/maplibre-gl.js
  cp node_modules/maplibre-gl/dist/maplibre-gl.css vendor/maplibre-gl.css
  cp node_modules/maplibre-gl/LICENSE.txt vendor/maplibre-gl.LICENSE.txt
fi

# 2. Bundle app.
"${ESBUILD[@]}" src/app.jsx \
  --loader:.jsx=jsx --jsx=transform \
  --bundle --minify --format=iife --target=es2018 \
  --outfile=build/app.min.js

# 3. Assemble index.html.
python3 - <<'PY'
from pathlib import Path
def safe(js): return js.replace("</script>", "<\\/script>")
react     = safe(Path("build/react.min.js").read_text())
react_dom = safe(Path("build/react-dom.min.js").read_text())
app       = safe(Path("build/app.min.js").read_text())
html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#F4F0E4" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Loop" />
<meta name="mobile-web-app-capable" content="yes" />
<link rel="manifest" href="./manifest.webmanifest" />
<link rel="apple-touch-icon" href="./icon-512.png" />
<link rel="icon" type="image/png" sizes="512x512" href="./icon-512.png" />
<title>Loop</title>
<style>
/* Bundled, never fetched at runtime — the app must render identically offline. */
@font-face{{font-family:'Bitter';font-style:normal;font-weight:400;font-display:block;src:url(./fonts/bitter-latin-400-normal.woff2) format('woff2')}}
@font-face{{font-family:'Bitter';font-style:normal;font-weight:500;font-display:block;src:url(./fonts/bitter-latin-500-normal.woff2) format('woff2')}}
@font-face{{font-family:'Bitter';font-style:normal;font-weight:700;font-display:block;src:url(./fonts/bitter-latin-700-normal.woff2) format('woff2')}}
@font-face{{font-family:'Old Standard TT';font-style:normal;font-weight:400;font-display:block;src:url(./fonts/old-standard-tt-latin-400-normal.woff2) format('woff2')}}
@font-face{{font-family:'Old Standard TT';font-style:normal;font-weight:700;font-display:block;src:url(./fonts/old-standard-tt-latin-700-normal.woff2) format('woff2')}}
@font-face{{font-family:'Reenie Beanie';font-style:normal;font-weight:400;font-display:block;src:url(./fonts/reenie-beanie-latin-400-normal.woff2) format('woff2')}}
@font-face{{font-family:'Architects Daughter';font-style:normal;font-weight:400;font-display:block;src:url(./fonts/architects-daughter-latin-400-normal.woff2) format('woff2')}}
html,body{{margin:0;background:#F4F0E4;color:#1E6B3A;overscroll-behavior:none;-webkit-text-size-adjust:100%}}
body{{font-family:Bitter,Rockwell,Georgia,serif}}
#root{{min-height:100dvh;background:#F4F0E4}}
</style>
</head>
<body>
<div id="root"></div>
<script>/* React 18 UMD (production) */
{react}
</script>
<script>/* ReactDOM 18 UMD (production) */
{react_dom}
</script>
<script>/* Loop app bundle */
{app}
</script>
<script>
if ('serviceWorker' in navigator) {{
  window.addEventListener('load', function () {{
    navigator.serviceWorker.register('./sw.js').catch(function (e) {{ console.warn('sw register failed', e); }});
  }});
}}
</script>
</body>
</html>
"""
Path("index.html").write_text(html)
print(f"index.html {len(html)} bytes")
PY

echo "Build complete."
