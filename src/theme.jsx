/* Loop — paper scorecard design system (v21).
   Source of truth: loop-design/SPEC.md + the two reference screens. Values are copied
   from those files; change them here, never per-component. */

/* ---- colour ------------------------------------------------------------ */
export const T = {
  paper:     "#F4F0E4",   // background
  ink:       "#1E6B3A",   // rules, labels, printed numbers, primary button
  inkDark:   "#154D2A",   // pressed ink
  hair:      "#A9C7B4",   // inner grid lines
  muted:     "#7FA58C",   // inactive labels
  yellow:    "#F2C94C",   // current hole, flag, button inner line, chart dot
  black:     "#1F1F1F",   // headline numerals, par score
  pencil:    "#3F3F3F",   // the golfer's writing
  ghost:     "#8C8C8C",   // the ghost's writing
  bogey:     "#B8901E",   // yellow that passes contrast
  double:    "#A3352B",
  fillWon:   "#DCEBDC",
  fillLost:  "#F1DAD6",
  fillHalf:  "#E6E4DF",
  shade:     "rgba(63,63,63,0.26)",   // pending-score disc
  teeBlue:   "#4F6E8F",   // v22.8: blue tee markers
  teeRed:    "#A3352B",   // v22.8: red/burgundy tee markers — same value as `double` (the "lost" red); kept as its own name for callers that mean "tee colour" rather than "lost"
};

/* Tee marker tints — muted brand, not literal. The label carries the meaning.
   Kept for any caller still picking by list position; Setup itself uses teeTintFor (v22.8). */
export const TEE_TINT = ["#4A4A4A", "#7C9DA6", "PAPER", "#D9A441"];
export const teeTint = (i) => TEE_TINT[i % TEE_TINT.length];

/* v22.8 — tee colour keyed on the tee's own name (case-insensitive substring), so e.g. a
   green-named tee always gets the ink-green marker regardless of where it falls in the list.
   Falls back to the old by-position cycle for names that don't match a known family
   (championship, tips, member, etc). "PAPER" means the paper disc + ink ring, same as before. */
export function teeTintFor(name, index) {
  const n = String(name || "").toLowerCase();
  if (/gold|yellow/.test(n)) return T.yellow;
  if (/green/.test(n)) return T.ink;
  if (/black/.test(n)) return T.black;
  if (/white/.test(n)) return "PAPER";
  if (/blue/.test(n)) return T.teeBlue;
  if (/red|burgundy/.test(n)) return T.teeRed;
  if (/silver|gr[ae]y/.test(n)) return T.muted;
  return teeTint(index);
}

/* ---- type -------------------------------------------------------------- */
export const F = {
  label:  "Bitter, Rockwell, Georgia, serif",            // printed labels, words
  num:    "'Old Standard TT', Georgia, serif",           // printed numerals
  hand:   "'Reenie Beanie', cursive",                    // handwritten words
  handNum:"'Architects Daughter', cursive",              // handwritten numerals
};

/* Small caps = uppercase + tracking. Sizes are the reference screens' values. */
export const caps = (size = 11, weight = 700, ls = "0.16em") => ({
  fontFamily: F.label, fontSize: size, fontWeight: weight,
  letterSpacing: ls, textTransform: "uppercase",
});
export const printed = (size, weight = 700) => ({ fontFamily: F.num, fontSize: size, fontWeight: weight });
export const written = (size, color = T.pencil) => ({ fontFamily: F.handNum, fontSize: size, color, filter: "url(#pencil)" });
export const writtenWord = (size, color = T.pencil) => ({ fontFamily: F.hand, fontSize: size, color, filter: "url(#pencil)" });

/* ---- rules ------------------------------------------------------------- */
export const rule     = `1px solid ${T.ink}`;
export const hairline = `1px solid ${T.hair}`;
/* The 3px double rule under the logo. */
export const doubleRule = { width: "100%", height: 3, borderTop: rule, borderBottom: rule };

/* ---- the pencil filter ------------------------------------------------- *
   Mounted once at the app root. #pencil = graphite grain + ~0.8px wobble.
   #soft = the blurred disc behind a chosen-but-uncommitted score.          */
export function PencilDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><defs>
      <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="4" result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.3 0 0 0 0.2" result="grainA" />
        <feComposite in="SourceGraphic" in2="grainA" operator="in" result="tex" />
        <feTurbulence type="turbulence" baseFrequency="0.04" numOctaves="1" seed="9" result="wob" />
        <feDisplacementMap in="tex" in2="wob" scale="0.8" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.2" />
      </filter>
    </defs></svg>
  );
}

/* ---- wordmark ---------------------------------------------------------- *
   Pinyon Script "Loop" converted to outlines, so the 39 KB font does not ship
   for four glyphs. Flourish + yellow dot match logo.svg.                    */
const LOOP_PATH = "M66 52.7Q64.2 52.7 61.9 52.3Q59.7 51.9 57.5 51.3Q55.2 50.7 53.5 50.2Q49.4 52.1 44.3 52.1Q41.4 52.1 40 51.4Q38.5 50.7 38.5 49.9Q38.5 48.7 40.2 47.9Q41.8 47.2 44.5 47.2Q46.4 47.2 48.5 47.7Q50.6 48.2 53.1 49Q55.1 47.7 57.3 45.3Q59.5 43 62.2 39.2Q56.8 39 53.5 36.8Q50.1 34.6 50.1 31.2Q50.1 28.9 51.6 26.8Q53.1 24.6 55.4 23.2Q57.8 21.8 60.5 21.8Q61 21.8 61 21.9Q61.1 22 61.1 22.1Q61.1 22.3 61 22.3Q60.9 22.4 60.2 22.4Q57.5 22.7 55.7 24Q53.9 25.3 53 27Q52.1 28.8 52.1 30.5Q52.1 34.6 55 36.5Q57.9 38.4 62.8 38.4Q63.6 37.3 64.5 36Q65.4 34.7 66.4 33.2Q70.8 26.7 74.6 22.7Q78.5 18.7 82.1 16.9Q85.7 15.1 89.5 15.1Q91.5 15.1 92.7 15.9Q93.9 16.8 93.9 18.2Q93.9 20.5 92.2 23Q90.5 25.6 87.6 28.2Q84.7 30.7 81.1 33Q77.5 35.2 73.6 36.8Q69.8 38.4 66.2 38.9Q63.3 42.8 60.5 45.4Q57.7 48.1 54.7 49.7Q56.9 50.5 59.8 50.9Q62.6 51.4 66.2 51.4Q69.1 51.4 70.9 50.8Q72.7 50.2 73.6 49.6Q74.5 48.9 74.8 48.7Q75.2 48.3 75.3 48.5Q75.4 48.7 75.2 49Q75.1 49.3 74.9 49.5Q72.7 51.4 70.5 52Q68.3 52.7 66 52.7ZM66.8 38.1Q70.3 37.5 73.9 35.9Q77.5 34.4 80.7 32.2Q84 30 86.6 27.6Q89.1 25.1 90.6 22.7Q92.1 20.2 92.1 18.1Q92.1 17.2 91.3 16.4Q90.5 15.7 89.4 15.7Q85.1 15.7 81 19.1Q76.9 22.5 73 28.8Q71.4 31.4 69.8 33.8Q68.3 36.1 66.8 38.1ZM44 51.4Q46.2 51.4 48.1 51.1Q50 50.7 51.9 49.8Q50.1 49.3 48.2 48.9Q46.2 48.5 44.7 48.5Q39.3 48.5 39.3 49.9Q39.3 50.3 40.5 50.9Q41.8 51.4 44 51.4Z M83.6 52.1Q81.3 52.1 80.3 51Q79.2 50 79.1 48.5Q79 46.8 79.8 44.7Q80.7 42.6 81.7 41.2Q82.9 39.4 84.8 37.7Q86.6 36.1 88.8 35Q91 33.9 93.4 33.9Q94.8 33.9 95.8 34.7Q96.8 35.4 96.9 37Q97 39.2 96 41.7Q95 44.1 93.3 46.3Q93.5 47 94.5 47Q95.5 47 96.6 46.2Q97.8 45.5 98.9 44.4Q100 43.4 100.8 42.5Q101.6 41.6 101.8 41.3L102.4 41.7Q101.9 42.2 101 43.2Q100.1 44.2 98.9 45.2Q97.8 46.3 96.6 47Q95.5 47.8 94.4 47.8Q93.2 47.8 92.7 47Q90.8 49.2 88.3 50.6Q85.9 52.1 83.6 52.1ZM84.2 51.3Q85.2 51.3 86.4 50.7Q87.6 50.2 88.8 49.3Q90.8 47.9 92.5 45.9V45.8Q92.5 44.2 93.3 43.2Q94.2 42.3 95 42Q96.3 39.3 96.2 37.2Q96.1 35.9 95.5 35.4Q94.9 34.9 94.2 34.9Q92.6 34.9 90.4 36.7Q88.2 38.5 85.5 41.9Q83.5 44.4 82.7 46Q81.9 47.7 82.1 49Q82.1 49.7 82.5 50.5Q83 51.3 84.2 51.3Z M103.4 52.1Q101.2 52.1 100.1 51Q99.1 50 98.9 48.5Q98.8 46.8 99.7 44.7Q100.5 42.6 101.5 41.2Q102.8 39.4 104.6 37.7Q106.5 36.1 108.7 35Q110.9 33.9 113.2 33.9Q114.6 33.9 115.6 34.7Q116.6 35.4 116.7 37Q116.9 39.2 115.9 41.7Q114.9 44.1 113.1 46.3Q113.3 47 114.3 47Q115.3 47 116.5 46.2Q117.6 45.5 118.7 44.4Q119.8 43.4 120.6 42.5Q121.4 41.6 121.7 41.3L122.2 41.7Q121.7 42.2 120.8 43.2Q119.9 44.2 118.8 45.2Q117.6 46.3 116.5 47Q115.3 47.8 114.3 47.8Q113 47.8 112.6 47Q110.6 49.2 108.2 50.6Q105.7 52.1 103.4 52.1ZM104.1 51.3Q105 51.3 106.2 50.7Q107.4 50.2 108.6 49.3Q110.7 47.9 112.3 45.9V45.8Q112.3 44.2 113.2 43.2Q114 42.3 114.8 42Q116.1 39.3 116 37.2Q115.9 35.9 115.3 35.4Q114.7 34.9 114 34.9Q112.5 34.9 110.2 36.7Q108 38.5 105.3 41.9Q103.3 44.4 102.6 46Q101.8 47.7 101.9 49Q101.9 49.7 102.4 50.5Q102.9 51.3 104.1 51.3Z M102.4 70.7Q102.1 70.7 101.5 70.6Q100.9 70.6 100.5 70.5Q102.5 67.7 105.1 64.3Q107.7 60.8 110.4 57.1Q113.1 53.3 115.7 49.7Q118.3 46.1 120.4 43.1Q121.9 41 122.9 39.6Q123.9 38.2 124.8 37Q125.7 35.9 126.7 34.5Q127.7 33.2 129.2 31.2Q130.7 29.3 132.9 26.2Q133.9 26.3 134.4 26.4Q135 26.4 135.4 26.4Q135.8 26.4 136.1 26.4Q136.5 26.3 136.9 26.2Q134.6 29 133 30.9Q131.4 32.9 130.3 34.2Q129.2 35.5 128.4 36.6Q127.6 37.7 126.7 38.8Q125.9 39.9 124.8 41.4Q123.7 42.8 122.1 45L122.3 45.2Q130.5 37.3 134.4 35.3Q135.7 34.7 136.6 34.3Q137.6 33.9 139.2 33.9Q140.5 33.9 141.1 34.5Q141.7 35.2 141.7 36.1Q141.7 38.1 139.9 40.5Q138.2 42.9 133.8 46Q131.1 47.9 130.3 48.7Q129.5 49.5 129.5 50.1Q129.5 51.3 131.4 51.3Q133.3 51.3 135.2 50.1Q137.1 49 138.9 47.3Q140.7 45.6 142.1 43.9Q143.6 42.2 144.4 41.3L145 41.7Q144.2 42.6 142.7 44.3Q141.2 46 139.3 47.8Q137.4 49.6 135.3 50.8Q133.3 52.1 131.3 52.1Q129.7 52.1 128.9 51.4Q128.2 50.7 128.2 49.4Q128.2 47.6 130.2 45.1Q132.1 42.6 136.9 39.1Q139.2 37.4 139.7 36.7Q140.3 35.9 140.3 35.4Q140.3 35.1 140 34.9Q139.7 34.6 139.2 34.6Q137.9 34.6 136.8 35Q135.6 35.4 134.2 36.3Q132.5 37.2 130.4 38.9Q128.2 40.6 126 42.7Q123.7 44.8 121.5 47.1Q119.4 49.3 117.5 51.5Q116.2 53.2 114.6 55.6Q113 58 111.3 60.5Q109.7 63 108.3 65.2Q106.9 67.4 106 68.8Q105 70.3 104.9 70.5Q104.6 70.6 104 70.6Q103.4 70.7 102.4 70.7Z";
/* ---- hand-drawn ring (v22.8) --------------------------------------------
   The selected-tee marker used a perfect SVG <ellipse>, which read as too
   clean next to everything else on the card. This builds the same ring as a
   wobbled polyline instead, seeded off the tee key so it's stable across
   re-renders but different per tee — the same family as PencilMark's rings
   on the finished card, just built from points rather than a dashed ellipse. */
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 24–32 points around the ellipse, ±1.5px radial wobble, overshooting the start by ~8%
   of the loop so the stroke crosses itself like a real pencil ring. */
export function pencilRingPath(cx, cy, rx, ry, seed) {
  const rand = mulberry32(hashSeed(String(seed)));
  const n = 24 + Math.floor(rand() * 9);
  const overshoot = Math.max(1, Math.round(n * 0.08));
  const pts = [];
  for (let i = 0; i <= n + overshoot; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = (rand() - 0.5) * 3; // ±1.5px
    const px = cx + (rx + wobble) * Math.cos(t);
    const py = cy + (ry + wobble) * Math.sin(t);
    pts.push(`${i === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`);
  }
  return pts.join(" ");
}
/* Two overlaid strokes at different widths/opacities read as one slightly-uneven pencil
   line, same trick the SPEC uses elsewhere. Caller supplies the <svg> wrapper. */
export function PencilRing({ cx, cy, rx, ry, seedKey, color = T.pencil }) {
  return (
    <>
      <path d={pencilRingPath(cx, cy, rx, ry, seedKey)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" opacity="0.9" filter="url(#pencil)" />
      <path d={pencilRingPath(cx, cy, rx, ry, `${seedKey}:2`)} fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" opacity="0.5" filter="url(#pencil)" />
    </>
  );
}

export function Logo({ width = 180 }) {
  return (
    <svg width={width} height={width * 78 / 180} viewBox="0 0 180 78" fill="none" role="img" aria-label="Loop">
      <path d={LOOP_PATH} fill={T.ink} />
      <path d="M38 66 C72 60 108 60 142 66" stroke={T.ink} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="144" cy="66" r="2.4" fill={T.yellow} />
    </svg>
  );
}

/* ---- ghost glyph (v22.9) ------------------------------------------------ *
   The mid-round card's row label for the ghost: a plain cartoon ghost in one
   ink line — round head, wavy hem, two dot eyes, no fill. On-screen label only;
   nothing named `ghost` in the code changes. The stroke does not scale, so it
   is 1.3px at any size.                                                     */
export function GhostGlyph({ size = 13, color = T.ink, strokeWidth = 1.3, style }) {
  return (
    <svg width={size * 12 / 14} height={size} viewBox="0 0 12 14" fill="none" role="img" aria-label="Ghost"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, overflow: "visible", ...style }}>
      <path d="M1 12.6 V6 A5 5 0 0 1 11 6 V12.6 q-0.83 -1.5 -1.67 0 q-0.83 1.5 -1.67 0 q-0.83 -1.5 -1.67 0 q-0.83 1.5 -1.67 0 q-0.83 -1.5 -1.67 0 q-0.83 1.5 -1.67 0 Z"
        stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx="4.2" cy="6.2" r="0.95" fill={color} />
      <circle cx="7.8" cy="6.2" r="0.95" fill={color} />
    </svg>
  );
}
