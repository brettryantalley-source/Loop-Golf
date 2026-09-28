/*
 * random.js — deterministic sampling for the simulation (spec §3.5).
 *
 * The engine draws one set of "common random numbers" per recompute and reuses it for every
 * candidate. Two things follow: identical input gives byte-identical output (T7), and candidates
 * are compared on the same draws, so a 0.01 difference in birdie probability is a real difference
 * and not sampling noise. Pure functions.
 */

/** mulberry32 — small, fast, good enough for 500 draws. Returns () => [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N samples of { z1, z2, u }: two standard normals (Box–Muller) and one uniform. */
export function makeSamples(n, seed) {
  const rnd = mulberry32(seed);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let u1 = rnd();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = { z1: r * Math.cos(2 * Math.PI * u2), z2: r * Math.sin(2 * Math.PI * u2), u: rnd() };
  }
  return out;
}
