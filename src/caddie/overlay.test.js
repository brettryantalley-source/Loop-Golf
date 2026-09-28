/*
 * overlay.test.js — UI addendum §12: T33 (ellipse size), T34 (coverage), T36 (toggle keeps the
 * camera), T37 (no map text), T39 (offline → drawn map + notice), plus camera fit and the
 * corridor's support points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  K80, thetaDeg, ellipseScreen, supportPoints, pointInEllipse, ellipsePolygon, ellipseBbox, bboxYds,
  ellipseFromEntry, withEllipses, ellipseInFrame, fitBounds, cameraPoints, cameraFor, linearProjector,
  zoomForPxPerYd, cameraKey, mapModeFor, NOTICE_NO_SATELLITE, overlayModel, fallbackMapModel, tagsOf, pxPerYdAt,
  NOTICE_NO_SATELLITE_MARKED, NOTICE_MARK_GREEN, markCamera, pinViewCamera, pinViewKey, pinMarkerHit, visibleRegion,
} from "./overlay.js";
import { ellipseSampler, ELL80_K, recommend } from "./engine.js";
import { loadProfile, resolveEntry } from "./profile.js";
import { makeSamples } from "./random.js";
import { pointInRing } from "./course.js";
import { buildHole, distances, holeFrame } from "./geo.js";
import { markedGreenHole } from "./greens.js";
import { destination, YARDS_PER_METER as YPM } from "../geometry.js";
import { parseOverpass } from "../geometry.js";
import { openPar5, waterLeftPar4, bunkeredPar3 } from "../fixtures/synthetic-holes.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, "../profile.json"), "utf8"));
const P = loadProfile(RAW);
const hampton = parseOverpass(JSON.parse(readFileSync(join(here, "..", "fixtures", "hampton-overpass.json"), "utf8")));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const toPts = (poly) => poly.map(([x, y]) => ({ x, y }));

/** Every profile entry that carries a Shot Pattern ellipse, resolved on the lie it is stored for. */
function ell80Entries() {
  const out = [];
  for (const c of RAW.clubs) for (const [swing, lies] of Object.entries(c.entries || {})) for (const [lie, e] of Object.entries(lies || {})) {
    if (e?.ell80?.bboxWYds) out.push({ club: c.id, swing, lie, raw: e.ell80, entry: resolveEntry(P, c.id, swing, lie) });
  }
  return out;
}

/* ---------- §5.3 formulas ---------- */

test("ellipseScreen: addendum §5.3 centre, rotation and semi-axes", () => {
  // θ = 0: SP frame = screen frame (x right, y short = down)
  const e0 = ellipseScreen({ target: { x: 100, y: 200 }, dx: -0.2, dy: 1.1, w: 16.7, h: 23.7, tiltDeg: 39.9, thetaDeg: 0, pxPerYd: 2 });
  near(e0.cx, 99.6, 1e-9, "cx"); near(e0.cy, 202.2, 1e-9, "cy");
  near(e0.A, 16.7, 1e-9, "A"); near(e0.B, 23.7, 1e-9, "B"); near(e0.alphaDeg, 39.9, 1e-9, "α");
  // θ = 90 (shot to the right): Rθ(dx, dy) = (−dy, dx)
  const e9 = ellipseScreen({ target: { x: 0, y: 0 }, dx: 2, dy: 5, w: 10, h: 20, tiltDeg: 10, thetaDeg: 90, pxPerYd: 1 });
  near(e9.cx, -5, 1e-9, "cx90"); near(e9.cy, 2, 1e-9, "cy90"); near(e9.alphaDeg, 100, 1e-9, "α90");
  // θ from projected points: straight up = 0, right = 90, down = 180, left = −90
  assert.equal(thetaDeg({ x: 0, y: 0 }, { x: 0, y: -10 }), 0);
  assert.equal(thetaDeg({ x: 0, y: 0 }, { x: 10, y: 0 }), 90);
  near(Math.abs(thetaDeg({ x: 0, y: 0 }, { x: 0, y: 10 })), 180, 1e-9, "down");
  assert.equal(thetaDeg({ x: 0, y: 0 }, { x: -10, y: 0 }), -90);
});

/* ---------- T33 ---------- */

test("T33: projected ellipse bbox equals Shot Pattern's Width × Depth within 1 yd", () => {
  const list = ell80Entries().filter((x) => x.entry.ell80.sdMult === 1);
  assert.ok(list.length >= 4, "PW, 9i, 2Hy, 4Hy carry ell80");
  for (const px of [0.8, 2.37, 6.5]) {
    for (const { club, lie, raw, entry } of list) {
      const ell = ellipseFromEntry(entry);
      const e = ellipseScreen({ target: { x: 180, y: 400 }, ...ell, thetaDeg: 0, pxPerYd: px });
      const b = ellipseBbox(e);
      near(b.width / px, raw.bboxWYds, 1, `${club}/${lie} width @${px}`);
      near(b.height / px, raw.bboxDYds, 1, `${club}/${lie} depth @${px}`);
      // the drawn polygon's box agrees with the analytic box
      const pb = fitBounds(ellipsePolygon(e, 720));
      near((pb.maxX - pb.minX) / px, raw.bboxWYds, 1, `${club} polygon width`);
      near((pb.maxY - pb.minY) / px, raw.bboxDYds, 1, `${club} polygon depth`);
      const yb = bboxYds(ell);
      near(yb.w, raw.bboxWYds, 1, `${club} bboxYds w`); near(yb.d, raw.bboxDYds, 1, `${club} bboxYds d`);
    }
  }
});

test("T33: through a projection — pxPerYdAt reads the zoom back and the size holds after a rotation", () => {
  const cam = { center: { x: 0, y: 200 }, pxPerYd: 3.3 };
  const { project } = linearProjector(cam, { width: 375, height: 812 });
  near(pxPerYdAt(project, { x: 5, y: 210 }), 3.3, 1e-9, "px/yd");
  const e2 = ellipseFromEntry(resolveEntry(P, "2Hy", "full", "fairway"));
  // a dogleg shot (θ = 35°): axes are unchanged, only rotated
  const e = ellipseScreen({ target: project({ x: 60, y: 230 }), ...e2, thetaDeg: 35, pxPerYd: 3.3 });
  near((2 * e.A) / 3.3, 57.1, 1e-9, "w"); near((2 * e.B) / 3.3, 117.9, 1e-9, "h");
});

/* ---------- T34 ---------- */

test("T34: 10,000 engine samples from an ell80 entry → 80% ± 1% inside the drawn ellipse", () => {
  const S = makeSamples(10000, 20260928);
  for (const [club, lie, quality] of [["2Hy", "fairway", "standard"], ["PW", "fairway", "standard"], ["9i", "rough", "standard"], ["4Hy", "tee", "bad"]]) {
    const entry = resolveEntry(P, club, "full", lie);
    assert.ok(entry.ell80, `${club} ${lie} has ell80`);
    const q = P.config.LIE_QUALITY[quality];
    const sample = ellipseSampler(entry.ell80, q.sdMult);
    const ell = ellipseFromEntry(entry, { lieQuality: quality });
    for (const [th, px] of [[0, 1], [27, 2.4], [-140, 5]]) {
      const T = { x: 190, y: 330 };
      const e = ellipseScreen({ target: T, ...ell, thetaDeg: th, pxPerYd: px });
      const poly = ellipsePolygon(e, 180);
      const t = th * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      let inside = 0;
      for (const z of S) {
        const d = sample(z.z1, z.z2);
        // back to the SP frame (+y short); a bad lie's −5 yds (applied in landingModel) is +5 short
        const x = d.lat, y = -d.alongMiss - (q.distYds || 0);
        const p = { x: T.x + (x * c - y * s) * px, y: T.y + (x * s + y * c) * px };
        if (pointInRing(p, poly)) inside++;
      }
      const f = inside / S.length;
      assert.ok(Math.abs(f - 0.8) <= 0.01, `${club}/${lie}/${quality} θ=${th}: ${(f * 100).toFixed(2)}% inside`);
    }
  }
  assert.equal(K80, ELL80_K);
});

test("ellipseFromEntry: σ fallback (no ell80) covers 80% of the engine's normal draws", () => {
  const entry = resolveEntry(P, "Dr", "full", "tee");
  assert.equal(entry.ell80, null, "driver has no measured ellipse yet");
  const ell = ellipseFromEntry(entry);
  assert.equal(ell.tiltDeg, 90); assert.equal(ell.source, "profile");
  const sLat = entry.carry * Math.tan(entry.lateralSdDeg * Math.PI / 180);
  near(ell.w, 2 * K80 * entry.distSd, 1e-9, "w = along axis"); near(ell.h, 2 * K80 * sLat, 1e-9, "h = lateral axis");
  // engine non-ell80 branch: along = mean + σD z1, lat = biasLat + σLat z2
  const e = ellipseScreen({ target: { x: 0, y: 0 }, ...ell, thetaDeg: 0, pxPerYd: 1 });
  let inside = 0;
  const S = makeSamples(10000, 7);
  for (const z of S) {
    const lat = entry.biasLat + sLat * z.z2, along = entry.biasDist + entry.distSd * z.z1;
    if (pointInEllipse(e, { x: lat, y: -along })) inside++;
  }
  assert.ok(Math.abs(inside / S.length - 0.8) <= 0.01, `${inside / 100}%`);
  // bad lie: +15% both axes, 5 yds short, flagged for the dispersion line
  const bad = ellipseFromEntry(entry, { lieQuality: "bad" });
  near(bad.w, ell.w * 1.15, 1e-9, "bad w"); near(bad.dy - ell.dy, 5, 1e-9, "bad dy"); assert.equal(bad.scaled, true);
});

/* ---------- support points / corridor ---------- */

test("supportPoints: circle → ±r across the shot; ellipse → tangent points; corridor edges are tangents", () => {
  const circ = ellipseScreen({ target: { x: 50, y: 50 }, w: 20, h: 20, tiltDeg: 0, thetaDeg: 0, pxPerYd: 1 });
  const s0 = supportPoints(circ);
  near(s0.right.x, 60, 1e-9, "right x"); near(s0.right.y, 50, 1e-9, "right y"); near(s0.left.x, 40, 1e-9, "left x");
  // shot to the right (θ = 90): the corridor's "right" is screen-down
  const c90 = { ...circ, thetaDeg: 90 };
  const s9 = supportPoints(c90);
  near(s9.right.x, 50, 1e-9, "θ90 right x"); near(s9.right.y, 60, 1e-9, "θ90 right y");
  // tilted ellipse: the support point lies on the ellipse and maximises n · p
  const e = ellipseScreen({ target: { x: 0, y: 0 }, dx: 3, dy: -2, w: 57.1, h: 117.9, tiltDeg: 21.1, thetaDeg: 12, pxPerYd: 2 });
  const { left, right } = supportPoints(e);
  const n = [Math.cos(12 * Math.PI / 180), Math.sin(12 * Math.PI / 180)];
  const dot = (p) => p.x * n[0] + p.y * n[1];
  const poly = ellipsePolygon(e, 3600);
  const maxDot = Math.max(...poly.map(([x, y]) => x * n[0] + y * n[1])), minDot = Math.min(...poly.map(([x, y]) => x * n[0] + y * n[1]));
  near(dot(right), maxDot, 1e-3, "right maximises n·p"); near(dot(left), minDot, 1e-3, "left minimises n·p");
  const a = e.alphaDeg * Math.PI / 180, on = (p) => { const x = p.x - e.cx, y = p.y - e.cy; return ((x * Math.cos(a) + y * Math.sin(a)) / e.A) ** 2 + ((-x * Math.sin(a) + y * Math.cos(a)) / e.B) ** 2; };
  near(on(right), 1, 1e-9, "right on the ellipse"); near(on(left), 1, 1e-9, "left on the ellipse");
  // symmetric about the centre
  near((left.x + right.x) / 2, e.cx, 1e-9, "mid x"); near((left.y + right.y) / 2, e.cy, 1e-9, "mid y");
});

test("pointInEllipse / ellipsePolygon agree", () => {
  const e = ellipseScreen({ target: { x: 10, y: 10 }, w: 40, h: 12, tiltDeg: 30, thetaDeg: 0, pxPerYd: 1 });
  assert.ok(pointInEllipse(e, { x: 10, y: 10 }));
  assert.ok(pointInEllipse(e, [10 + 19.9 * Math.cos(Math.PI / 6), 10 + 19.9 * Math.sin(Math.PI / 6)]));
  assert.ok(!pointInEllipse(e, { x: 10 + 20.1 * Math.cos(Math.PI / 6), y: 10 + 20.1 * Math.sin(Math.PI / 6) }));
  for (const [x, y] of ellipsePolygon(e, 16)) assert.ok(pointInEllipse(e, { x: x + (e.cx - x) * 1e-6, y: y + (e.cy - y) * 1e-6 }));
});

/* ---------- camera ---------- */

test("fitBounds: box of points, skips junk, null when empty", () => {
  assert.deepEqual(fitBounds([{ x: 1, y: 2 }, [5, -3], null, { x: NaN, y: 0 }, { x: -2, y: 9 }]), { minX: -2, minY: -3, maxX: 5, maxY: 9 });
  assert.equal(fitBounds([]), null);
  assert.equal(fitBounds([null, { x: Infinity, y: 1 }]), null);
});

test("cameraFor: the box fills the visible region (§3.1) with 16 px padding and lands centred in it", () => {
  const vp = { width: 375, height: 812 }, insets = { top: 47 + 49, right: 106, bottom: 78 + 34 + 16, left: 0 };
  const bounds = { minX: -40, minY: -10, maxX: 40, maxY: 420 };
  const cam = cameraFor(bounds, vp, insets);
  const { project } = linearProjector(cam, vp);
  const a = project({ x: bounds.minX, y: bounds.maxY }), b = project({ x: bounds.maxX, y: bounds.minY });
  const L = 16, R = 375 - 106 - 16, T = 96 + 16, B = 812 - 128 - 16;
  assert.ok(a.x >= L - 1e-6 && b.x <= R + 1e-6 && a.y >= T - 1e-6 && b.y <= B + 1e-6, "inside the region");
  // tall hole: height is the binding side, so top and bottom touch the padded region
  near(a.y, T, 1e-6, "top"); near(b.y, B, 1e-6, "bottom");
  near((a.x + b.x) / 2, (L + R) / 2, 1e-6, "centred horizontally");
  // round-trip
  const { unproject } = linearProjector(cam, vp);
  const q = unproject(project({ x: 12.5, y: 301 }));
  near(q.x, 12.5, 1e-9, "x"); near(q.y, 301, 1e-9, "y");
});

test("cameraPoints: ball + green + both ellipses + layup line; pre-tee frames tee → green", () => {
  const hole = { ...openPar5, key: "t", line: [{ x: 0, y: 0 }, { x: 0, y: 540 }] };
  const pre = fitBounds(cameraPoints({ hole, ball: null, pin: { x: 0, y: 540 }, options: null }));
  near(pre.minY, 0, 1e-9, "tee in frame"); near(pre.maxY, 556, 1e-9, "green back in frame");
  const ball = { x: 0, y: 250 };
  const safe = { target: { x: 0, y: 440 }, kind: "layup", ell: ellipseFromEntry(resolveEntry(P, "PW", "full", "fairway")) };
  const aggressive = { target: { x: 4, y: 535 }, kind: "approach", ell: ellipseFromEntry(resolveEntry(P, "2Hy", "full", "fairway")) };
  const pts = cameraPoints({ hole, ball, pin: { x: 0, y: 545 }, options: { safe, aggressive } });
  const bb = fitBounds(pts);
  const eA = fitBounds(ellipseInFrame(aggressive.ell, ball, aggressive.target));
  assert.ok(bb.minX <= eA.minX && bb.maxX >= eA.maxX && bb.maxY >= eA.maxY, "aggressive ellipse inside");
  near(bb.minY, 250, 1e-9, "ball is the low edge");
  // the 2-hybrid ellipse at a straight-up shot: its frame box equals the SP box (x same, y flipped)
  near(eA.maxX - eA.minX, 68, 1.2, "frame width"); near(eA.maxY - eA.minY, 112, 1.2, "frame depth");
});

test("zoomForPxPerYd: MapLibre zoom from px/yd (512-px world)", () => {
  // at the equator, z 0 = 512 px for the whole earth
  const px0 = 512 / (2 * Math.PI * 6371008.8) / 1.0936133;
  near(zoomForPxPerYd(px0, 0), 0, 1e-9, "z0");
  near(zoomForPxPerYd(px0 * 2 ** 17, 0), 17, 1e-9, "z17");
  // a 450-yd hole in ~560 px at 34°N is a z ≈ 16 fit (the prefetch covers 16–18)
  const z = zoomForPxPerYd(560 / 450, 34.3);
  assert.ok(z > 15.9 && z < 16.6, `z ${z}`);
});

/* ---------- T36 ---------- */

test("T36: SAFE ↔ AGGRESSIVE changes the drawn shot, never the camera", () => {
  const hole = buildHole(hampton, 5, { par: 5, yards: 540 });
  const ball = { x: 0, y: 250 };
  const res = recommend({ ball, shotNo: 2, lieType: "fairway", par: 5 }, hole, P);
  assert.ok(res && res.safe && res.aggressive, "engine returns two options here");
  const opts = withEllipses(res, (c, s) => resolveEntry(P, c, s, "fairway"));
  assert.ok(opts.safe.ell && opts.aggressive.ell, "both options carry a drawn ellipse");
  const vp = { width: 375, height: 812 }, insets = { top: 96, right: 106, bottom: 128, left: 0 };
  const k1 = cameraKey({ hole, ball, options: opts, viewport: vp, insets });
  const k2 = cameraKey({ hole, ball, options: { ...opts }, viewport: vp, insets });   // toggle = same inputs, other `active`
  assert.equal(k1, k2);
  assert.notEqual(k1, cameraKey({ hole, ball: { x: 3, y: 180 }, options: opts, viewport: vp, insets }), "new ball → refit");
  const pin = distances(hole, ball, "middle").pinPoint;
  assert.equal(k1, cameraKey({ hole, ball, options: opts, viewport: vp, insets, pin: { x: 1, y: 2 } }), "pin changes don't refit");
  const cam = cameraFor(fitBounds(cameraPoints({ hole, ball, pin, options: opts })), vp, insets);
  const { project } = linearProjector(cam, vp);
  const safeM = overlayModel({ project, hole, ball, pin, active: opts.safe, other: opts.aggressive, palette: "satellite" });
  const aggM = overlayModel({ project, hole, ball, pin, active: opts.aggressive, other: opts.safe, palette: "satellite" });
  const part = (m, name) => JSON.stringify(m.find((n) => n.attrs?.["data-part"] === "cur").children.find((n) => n.attrs["data-part"] === name));
  for (const name of ["ellipse", "corridor", "target"]) assert.notEqual(part(safeM, name), part(aggM, name), `${name} redraws on toggle`);
});

/* ---------- T37 ---------- */

function fullModel(palette) {
  const hole = buildHole(hampton, 18, { par: 4 });
  const ball = { x: 2, y: 150 };
  const pin = distances(hole, ball, "back").pinPoint;
  const safe = { target: { x: 0, y: 300 }, kind: "layup", ell: ellipseFromEntry(resolveEntry(P, "9i", "full", "fairway")) };
  const aggressive = { target: { x: pin.x, y: pin.y - 4 }, kind: "approach", ell: ellipseFromEntry(resolveEntry(P, "4Hy", "full", "fairway")) };
  const vp = { width: 375, height: 812 };
  const cam = cameraFor(fitBounds(cameraPoints({ hole, ball, pin, options: { safe, aggressive } })), vp, { top: 96, right: 106, bottom: 128 });
  const { project } = linearProjector(cam, vp);
  return {
    hole, project,
    model: overlayModel({ project, viewport: vp, hole, ball, accuracyM: 12, pin, active: safe, other: aggressive,
      previousShots: [{ from: { x: 0, y: 0 }, to: ball }], palette, idPrefix: "t37", redrawKey: "k" }),
  };
}

test("T37: the overlay's SVG element list contains no <text> (satellite and fallback, every layer drawn)", () => {
  for (const palette of ["satellite", "paper"]) {
    const { model, hole, project } = fullModel(palette);
    const tags = tagsOf(model);
    for (const t of ["line", "path", "ellipse", "circle", "pattern", "clipPath", "g"]) assert.ok(tags.includes(t), `${palette} draws a ${t}`);
    assert.ok(!tags.includes("text") && !tags.includes("tspan") && !tags.includes("foreignObject"), `${palette}: no text nodes`);
    assert.ok(!tagsOf(fallbackMapModel({ hole, project })).includes("text"), "fallback base map: no text");
  }
});

test("overlay draw order (§4.2) and palettes (§4.3)", () => {
  const { model } = fullModel("satellite");
  const parts = model.map((n) => n.attrs?.["data-part"] ?? n.tag);
  assert.deepEqual(parts, ["defs", "pin", "cur", "ball"]);
  const cur = model.find((n) => n.attrs?.["data-part"] === "cur");
  assert.deepEqual(cur.children.map((n) => n.attrs["data-part"]), ["previous", "other", "corridor", "leave", "ellipse", "hatch", "target"]);
  assert.ok(model.find((n) => n.attrs?.["data-part"] === "ball").children.some((c) => c.attrs["data-part"] === "accuracy"), "accuracy ring > 8 m");
  const json = JSON.stringify(model);
  assert.ok(!json.includes("#1E6B3A"), "no ink green on satellite");
  const paper = JSON.stringify(fullModel("paper").model);
  assert.ok(paper.includes("#1E6B3A") && !paper.includes("rgba(20,28,16"), "fallback: ink lines, halos off");
  // same shot / pre-tee: nothing but what's there
  const hole = { ...waterLeftPar4, key: 2 };
  const { project } = linearProjector({ center: { x: 0, y: 200 }, pxPerYd: 1.5 }, { width: 375, height: 812 });
  assert.deepEqual(overlayModel({ project, hole, pin: { x: 0, y: 410 } }).map((n) => n.attrs["data-part"]), ["pin"]);
  const one = overlayModel({ project, hole, ball: { x: 0, y: 0 }, pin: { x: 0, y: 410 }, active: { target: { x: 0, y: 250 }, kind: "corridor", ell: ellipseFromEntry(resolveEntry(P, "2Hy", "full", "tee")) }, other: null });
  const oc = one.find((n) => n.attrs?.["data-part"] === "cur").children.map((n) => n.attrs["data-part"]);
  assert.ok(!oc.includes("other") && !oc.includes("leave"), "same shot: no ghost line; a corridor shot has no leave line");
  assert.ok(oc.includes("hatch"), "water left is hatched");
});

test("hatch clip covers water / bunkers / trees and the outside of the OB boundary", () => {
  const hole = { ...bunkeredPar3, key: 3, boundary: [[-100, -20], [100, -20], [100, 260], [-100, 260]] };
  const { project } = linearProjector({ center: { x: 0, y: 120 }, pxPerYd: 2 }, { width: 375, height: 812 });
  const m = overlayModel({ project, hole, ball: { x: 0, y: 0 }, pin: { x: 0, y: 175 },
    active: { target: { x: 0, y: 175 }, kind: "approach", ell: ellipseFromEntry(resolveEntry(P, "9i", "full", "fairway")) } });
  const clip = m[0].children.find((n) => n.tag === "clipPath");
  assert.equal(clip.children.length, 3, "sand + water + outside-OB");
  assert.ok(clip.children.every((c) => c.attrs.clipRule === "evenodd"));
});

/* ---------- T39 ---------- */

test("T39: network blocked and no cached tiles → the drawn map and its notice", () => {
  assert.deepEqual(mapModeFor({ hasHole: true, tilesCached: false, online: false }), { mode: "fallback", notice: NOTICE_NO_SATELLITE });
  assert.deepEqual(mapModeFor({ hasHole: true, tilesCached: false, online: true, probeOk: false }), { mode: "fallback", notice: NOTICE_NO_SATELLITE });
  assert.equal(mapModeFor({ hasHole: true, tilesCached: true, online: false }).mode, "satellite", "cached tiles work offline");
  assert.equal(mapModeFor({ hasHole: true, online: true, probeOk: null }).mode, "checking");
  assert.equal(mapModeFor({ hasHole: true, tilesCached: true, libFailed: true }).mode, "fallback", "no MapLibre → drawn map");
  assert.deepEqual(mapModeFor({ hasHole: false, holeNo: 7 }), { mode: "none", notice: "No course map for hole 7. Enter yards for a club." });
  assert.equal(NOTICE_NO_SATELLITE, "No satellite here. Map drawn from course data.");
});

test("fallback map model: flat polygons with ink outlines in §4.3 order", () => {
  const hole = buildHole(hampton, 11, { par: 3 });
  const { project } = linearProjector({ center: { x: 0, y: 90 }, pxPerYd: 2 }, { width: 375, height: 812 });
  const m = fallbackMapModel({ hole, project });
  assert.ok(m.length >= 1 + hole.hazards.length);
  assert.ok(m.every((n) => n.tag === "path" && n.attrs.stroke === "#1E6B3A" && n.attrs.strokeWidth === 1));
  assert.ok(m.some((n) => n.attrs.fill === "#DCEBDC"), "green in fillWon");
  assert.deepEqual(fallbackMapModel({ hole: null, project }), []);
});

/* ---------- v22.11: marked-green mode and the pin view ---------- */

test("mapModeFor, no geometry: no GPS → paper as before; GPS + unmarked → the mark view; GPS + marked → satellite / drawn", () => {
  const nm = "No course map for hole 7. Enter yards for a club.";
  // unchanged without a fix
  assert.deepEqual(mapModeFor({ hasHole: false, holeNo: 7, probeOk: true, greenMarked: true }), { mode: "none", notice: nm });
  // a fix, no green yet: satellite north-up on the ball, and the notice asking for the tap
  assert.deepEqual(mapModeFor({ hasHole: false, holeNo: 7, hasGps: true, probeOk: true }), { mode: "mark", notice: NOTICE_MARK_GREEN });
  assert.deepEqual(mapModeFor({ hasHole: false, holeNo: 7, hasGps: true, tilesCached: true, online: false }), { mode: "mark", notice: NOTICE_MARK_GREEN }, "cached tiles work offline");
  assert.equal(mapModeFor({ hasHole: false, holeNo: 7, hasGps: true }).mode, "checking");
  // …but with no satellite there is nothing to tap a green on: paper and Enter yards, as before
  for (const x of [{ online: false }, { probeOk: false }, { libFailed: true, tilesCached: true }]) {
    assert.deepEqual(mapModeFor({ hasHole: false, holeNo: 7, hasGps: true, ...x }), { mode: "none", notice: nm }, JSON.stringify(x));
  }
  // marked: the synthetic hole on satellite, or drawn on paper from the mark (never "from course data")
  assert.deepEqual(mapModeFor({ hasHole: false, hasGps: true, greenMarked: true, probeOk: true }), { mode: "satellite", notice: null });
  assert.deepEqual(mapModeFor({ hasHole: false, hasGps: true, greenMarked: true, online: false }), { mode: "fallback", notice: NOTICE_NO_SATELLITE_MARKED });
  assert.equal(mapModeFor({ hasHole: false, hasGps: true, greenMarked: true }).mode, "checking");
  assert.equal(NOTICE_MARK_GREEN, "No course map. Satellite on GPS — tap the green to mark it.");
  // a mapped hole ignores all of it
  assert.equal(mapModeFor({ hasHole: true, hasGps: true, greenMarked: false, probeOk: true }).mode, "satellite");
});

test("markCamera: north-up, the ball centred in the visible region, the region 300 yds tall", () => {
  const vp = { width: 375, height: 812 }, insets = { top: 96, right: 106, bottom: 128, left: 0 };
  const m = markCamera(vp, insets);
  const r = visibleRegion(vp, insets);
  assert.equal(m.bearingDeg, 0);
  near(r.height / m.pxPerYd, 300, 1e-9, "300 yds tall");
  // with the viewport centre at ball + centerOffset, the ball lands on the region's centre
  const lin = linearProjector({ center: m.centerOffset, pxPerYd: m.pxPerYd }, vp);
  const b = lin.project({ x: 0, y: 0 });
  near(b.x, r.cx, 1e-9, "ball x at the region centre"); near(b.y, r.cy, 1e-9, "ball y at the region centre");
  near(markCamera(vp, insets, { spanYds: 150 }).pxPerYd, 2 * m.pxPerYd, 1e-9, "span is a parameter");
});

test("pin view camera: the green + 15 yds fills the visible region, hole-up; refit once per hole", () => {
  const hole = buildHole(hampton, "2", { par: 3, yards: 143 });
  const vp = { width: 375, height: 812 }, insets = { top: 96, right: 106, bottom: 128, left: 0 };
  const cam = pinViewCamera(hole, vp, insets);
  const r = visibleRegion(vp, insets);
  const g = fitBounds(hole.green.ring);
  const bw = g.maxX - g.minX + 30, bh = g.maxY - g.minY + 30;
  near(cam.pxPerYd, Math.min(r.width / bw, r.height / bh), 1e-9, "fits the padded box");
  const lin = linearProjector(cam, vp);
  const c = lin.project({ x: (g.minX + g.maxX) / 2, y: (g.minY + g.maxY) / 2 });
  near(c.x, r.cx, 1e-6, "green box centred (x)"); near(c.y, r.cy, 1e-6, "green box centred (y)");
  for (const [x, y] of hole.green.ring) {
    const q = lin.project({ x, y });
    assert.ok(q.x >= r.L + 15 * cam.pxPerYd - 1e-6 && q.x <= r.R - 15 * cam.pxPerYd + 1e-6, "15 yds clear either side (x)");
    assert.ok(q.y >= r.T - 1e-6 && q.y <= r.B + 1e-6, "inside the region (y)");
  }
  assert.ok(cam.pxPerYd > 2.5, `close in: ${cam.pxPerYd.toFixed(2)} px/yd`);
  // the synthetic green of a marked hole: 28 × 24 + 15 each side = 54 wide → width-limited
  const B = { lat: 39.95, lon: -85.98 };
  const mh = markedGreenHole({ ball: B, green: destination(B, 90, 150 / YPM) });
  near(pinViewCamera(mh, vp, insets).pxPerYd, r.width / 54, 0.02, "synthetic green fit");
  assert.equal(pinViewCamera({ green: null }, vp, insets), null);
  // key: per hole + viewport, never the pin
  assert.equal(pinViewKey({ hole, viewport: vp, insets }), pinViewKey({ hole, viewport: vp, insets }));
  assert.notEqual(pinViewKey({ hole, viewport: vp, insets }), cameraKey({ hole, ball: null, options: null, viewport: vp, insets }));
});

test("pin view marker: shapes only (T37), dashed ring while dragging, hit test round the cup and the flag", () => {
  const hole = buildHole(hampton, "2", { par: 3, yards: 143 });
  const vp = { width: 375, height: 812 };
  const lin = linearProjector(pinViewCamera(hole, vp, { top: 96, right: 106, bottom: 128 }), vp);
  const pin = hole.green.center;
  for (const dragging of [false, true]) {
    for (const palette of ["satellite", "paper"]) {
      const m = overlayModel({ project: lin.project, viewport: vp, hole, ball: { x: 0, y: 0 }, pin, pinMarker: true, pinDragging: dragging, palette });
      const tags = tagsOf(m);
      assert.ok(!tags.includes("text"), "no text on the map");
      const parts = JSON.stringify(m);
      assert.ok(parts.includes('"pin-marker"') && !parts.includes('"data-part":"pin"'), "the marker replaces the small flag");
      assert.equal(parts.includes('"pin-drag"'), dragging);
    }
  }
  const px = lin.project(pin);
  assert.ok(pinMarkerHit(px, { x: px.x + 3, y: px.y + 2 }), "on the cup");
  assert.ok(pinMarkerHit(px, { x: px.x + 10, y: px.y - 24 }), "on the flag");
  assert.ok(!pinMarkerHit(px, { x: px.x - 40, y: px.y + 30 }), "clear of it");
});

test("fallback drawn map of a marked green: the green only, never the engine's corridor", () => {
  const B = { lat: 39.95, lon: -85.98 };
  const mh = markedGreenHole({ ball: B, green: destination(B, 90, 200 / YPM) });
  assert.equal(mh.fairways.length, 1, "the engine has a corridor");
  const lin = linearProjector(cameraFor(fitBounds(cameraPoints({ hole: mh, ball: { x: 0, y: 0 } })), { width: 375, height: 812 }), { width: 375, height: 812 });
  const drawn = fallbackMapModel({ hole: mh, project: lin.project });
  assert.equal(drawn.length, 1, "one polygon: the green");
});
