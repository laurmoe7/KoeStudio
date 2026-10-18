// Vector layers (pure, tested): a vector layer keeps every line as data, so lines can be erased as lines.
//
// layer.vector = { brushes: [brush, ...], strokes: [stroke, ...] }   (strokes bottom first)
//   brush:  the paint settings a line was drawn with (VECTOR_BRUSH: size, density, hardness, spacing, pen pressure,
//           tip, variation, tapers, texture); lines drawn with the same settings share one entry.
//   stroke: { pts: [[x, y, p], ...] (the smoothed pen path, p = pressure 0-1), b: brush index, color: '#rrggbb',
//           opacity: 0-1, seed: integer (for repeatable jitter) }
//           A line drawn with a brush using pen tilt or speed keeps them per point: [x, y, p, t, v, az] (tilt 0-1,
//           speed 0-1, lean direction in radians or null). Points without them count as upright and slow, which
//           leaves the dabs as they are, so every edit that drops them still gives a sensible line.
// The layer's pixels are always the strokes drawn in order (vectorlayer.js); the PNG is saved too.
// Vector objects are never changed in place: every edit returns a new one, so undo can keep the old one.
//
// The eraser works on lines in one of three ways (VECTOR_ERASE): 'area' cuts away the part of a line the eraser
// passes over, 'intersection' removes the stretch of a touched line up to the nearest crossings with other lines,
// and 'line' removes every line it touches.

import { shiftColor } from './color.js';
import { stampAt, dabJitter, colorJitter, taperIn, taperOut, StampPath, sanitizeCurve, dynamicsAt, dynamicsReach } from './brush.js';
import { tipReach } from './brushtip.js';

export const MAX_STROKES = 20000;
export const MAX_POINTS = 50000;
/** Range of a line's own width factor `w` (Line edit tool); 1 (the brush as drawn) is not saved. */
export const MIN_WIDTH = 0.1, MAX_WIDTH = 5;

/** Brush settings a vector line keeps, with [default, min, max] for numbers, or a default for the rest. */
const NUM = {
  size: [6, 0.5, 1000], flow: [1, 0.01, 1], hardness: [1, 0, 1], spacing: [0.08, 0.02, 1], minSize: [0.15, 0, 1],
  minFlow: [0, 0, 1], gamma: [1, 0.3, 3], thickness: [1, 0.05, 1], tipAngle: [0, 0, 360], tipRandom: [0, 0, 1],
  scatter: [0, 0, 2], count: [1, 1, 16], sizeJitter: [0, 0, 1], flowJitter: [0, 0, 1], hueJitter: [0, 0, 1], satJitter: [0, 0, 1], valJitter: [0, 0, 1], taperIn: [0, 0, 500], taperOut: [0, 0, 500],
  textureAmount: [0.5, 0, 1], textureScale: [1, 0.25, 4],
  tiltSize: [0, 0, 1], tiltFlow: [0, 0, 1], speedSize: [0, -1, 1], speedFlow: [0, -1, 1],
  dualSize: [0.6, 0.05, 3], dualSpacing: [0.25, 0.02, 2], dualScatter: [0.5, 0, 3],
};
const BOOL = { pressureSize: true, pressureOpacity: false, tipFollow: false, textureInvert: false, colorJitterStroke: false, pixel: false, tiltAngle: false };
const CURVES = ['sizeCurve', 'flowCurve'];
export const VECTOR_BRUSH = [...Object.keys(NUM), ...Object.keys(BOOL), ...CURVES, 'tip', 'texture', 'dualTip'];

const NAME = /^(?:[a-z]{1,20}|img:[0-9a-f]{8,32})$/;

/** A clean brush from tool settings or a saved file: known keys only, numbers in range, defaults for the rest. */
export function sanitizeBrush(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, [def, min, max]] of Object.entries(NUM)) {
    const v = Number(s[k]);
    out[k] = Number.isFinite(v) && s[k] !== null && s[k] !== '' ? Math.max(min, Math.min(max, v)) : def;
  }
  for (const [k, def] of Object.entries(BOOL)) out[k] = k in s ? !!s[k] : def;
  for (const k of CURVES) out[k] = sanitizeCurve(s[k]);
  out.tip = typeof s.tip === 'string' && NAME.test(s.tip) ? s.tip : 'round';
  out.texture = typeof s.texture === 'string' && NAME.test(s.texture) ? s.texture : 'none';
  out.dualTip = typeof s.dualTip === 'string' && NAME.test(s.dualTip) ? s.dualTip : 'none';
  return out;
}

export const emptyVector = () => ({ brushes: [], strokes: [] });

/** True when a brush changes its dabs with pen tilt or speed (its lines then keep them per point). */
export const usesDynamics = b => !!(b.tiltSize || b.tiltFlow || b.tiltAngle || b.speedSize || b.speedFlow);

/** A path point's tilt, speed and lean direction ([] when it has none), cleaned up. */
function extras(q) {
  if (!q || q.length <= 3) return [];
  const c = v => (Number.isFinite(+v) && v !== null ? Math.max(0, Math.min(1, +v)) : 0);
  const az = q[5] === null || q[5] === undefined || !Number.isFinite(+q[5]) ? null : Math.round(+q[5] * 1000) / 1000;
  return [c(q[3]), c(q[4]), az];
}

/** The point part way (t, 0-1) from a to b: position, pressure, tilt and speed blended, b's lean direction. */
function mix(a, b, t, round = v => v) {
  const out = [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t), round(a[2] + (b[2] - a[2]) * t)];
  if (b.length > 3) {
    const ea = a.length > 3 ? a : b;
    out.push(round(ea[3] + (b[3] - ea[3]) * t), round(ea[4] + (b[4] - ea[4]) * t), b[5] ?? null);
  }
  return out;
}

/** The brush a line is drawn with: its brush entry, made wider or thinner by the line's own width factor `w`. */
export function brushOf(v, s) {
  const b = v.brushes[s.b];
  return s.w && s.w !== 1 ? { ...b, size: b.size * s.w } : b;
}

/** Cleans a vector layer's data from a file; null when it is not one. Strokes with no points are dropped. */
export function sanitizeVector(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const brushes = (Array.isArray(raw.brushes) ? raw.brushes : []).slice(0, MAX_STROKES).map(sanitizeBrush);
  if (!brushes.length) brushes.push(sanitizeBrush({}));
  const strokes = [];
  for (const s of (Array.isArray(raw.strokes) ? raw.strokes : []).slice(0, MAX_STROKES)) {
    const pts = [];
    for (const q of (Array.isArray(s?.pts) ? s.pts : []).slice(0, MAX_POINTS)) {
      const x = Number(q?.[0]), y = Number(q?.[1]), p = Number(q?.[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y, Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1, ...extras(q)]);
    }
    if (!pts.length) continue;
    const b = Math.round(Number(s.b));
    strokes.push({
      pts, b: b >= 0 && b < brushes.length ? b : 0,
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : '#000000',
      opacity: Number.isFinite(+s.opacity) ? Math.max(0.01, Math.min(1, +s.opacity)) : 1,
      seed: Number.isFinite(+s.seed) ? Math.abs(Math.round(+s.seed)) % 2147483647 : 1,
      ...(Number.isFinite(+s.w) && +s.w !== 1 ? { w: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, +s.w)) } : {}),
    });
  }
  return { brushes, strokes };
}

/** A repeatable random number source (mulberry32): the same seed gives the same numbers. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Points along a path no further apart than `step` (straight lines between the given ones, pressure blended),
 * so erasing can cut a line anywhere along it. Coordinates are rounded to 1/100 px for compact files.
 */
export function resample(pts, step) {
  const r = v => Math.round(v * 100) / 100, out = [];
  pts.forEach((q, i) => {
    if (i) {
      const a = pts[i - 1], n = Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / step);
      for (let k = 1; k < n; k++) out.push(mix(a, q, k / n, r));
    }
    out.push(mix(q, q, 0, r));
  });
  return out;
}

/** Adds strokes drawn with `brush` (tool settings) as a new vector object; the same settings reuse their entry. */
export function addStrokes(v, brush, strokes) {
  const b = sanitizeBrush(brush), key = JSON.stringify(b);
  let bi = v.brushes.findIndex(x => JSON.stringify(x) === key);
  const brushes = bi < 0 ? [...v.brushes, b] : v.brushes;
  if (bi < 0) bi = brushes.length - 1;
  return { brushes, strokes: [...v.strokes, ...strokes.map(s => ({ ...s, b: bi }))].slice(-MAX_STROKES) };
}

/** Moves every line by dx, dy (the Move tool). */
export function translateVector(v, dx, dy) {
  return { brushes: v.brushes, strokes: v.strokes.map(s => ({ ...s, pts: s.pts.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]) })) };
}

/** Half the width of a line at pressure p (tapers and jitter aside): how far from its path it still shows. */
export const halfWidth = (b, p) => stampAt(b, p).size / 2;

/** How far paint can land from a line's path: half the full size (more for an image tip) plus any scatter. */
export function reachOf(b) {
  return b.size * (tipReach(b.tip !== 'round') * (usesDynamics(b) ? dynamicsReach(b) : 1) + b.scatter) + 2;
}

/** The box a line's paint covers, as integer {x, y, w, h}. */
export function strokeBounds(s, b) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = reachOf(b), x = Math.floor(x0 - m), y = Math.floor(y0 - m);
  return { x, y, w: Math.ceil(x1 + m) - x, h: Math.ceil(y1 + m) - y };
}

/** Where two vector objects differ: the box covering every line in one but not the other, or null. */
export function changedBounds(a, b) {
  const inA = new Set(a.strokes), inB = new Set(b.strokes);
  let r = null;
  const add = (s, v) => {
    const q = strokeBounds(s, brushOf(v, s));
    if (!r) { r = q; return; }
    const x = Math.min(r.x, q.x), y = Math.min(r.y, q.y);
    r = { x, y, w: Math.max(r.x + r.w, q.x + q.w) - x, h: Math.max(r.y + r.h, q.y + q.h) - y };
  };
  for (const s of a.strokes) if (!inB.has(s)) add(s, a);
  for (const s of b.strokes) if (!inA.has(s)) add(s, b);
  return r;
}

/**
 * The dabs that draw a line: {x, y, p, k (size factor), f (density factor), c (colour, with per-dab colour
 * jitter)} in order, as the pen tools stamp them (spacing by size, start and end taper by distance along the line,
 * scatter and jitter from its seed). Colour jitter once per stroke is already in the line's colour.
 */
export function strokeStamps(s, b) {
  const sizeAt = p => stampAt(b, p).size, path = new StampPath(sizeAt, b.spacing), rnd = seeded(s.seed);
  const dabColors = !b.colorJitterStroke && !!colorJitter(b);
  const out = [];
  let dist = 0, prev = null;
  const dyn = usesDynamics(b);
  for (const q of s.pts) {
    const pt = { x: q[0], y: q[1], p: q[2] };
    if (dyn && q.length > 3) { pt.t = q[3]; pt.v = q[4]; pt.az = q[5] ?? null; }
    for (const st of path.add(pt)) {
      if (prev) dist += Math.hypot(st.x - prev.x, st.y - prev.y);
      prev = { x: st.x, y: st.y };
      for (let n = 0; n < (b.count || 1); n++) {  // Count: several dabs per step, each with its own variation
        const j = dabJitter(b, sizeAt(st.p), rnd);
        const o = { x: st.x + j.dx, y: st.y + j.dy, p: st.p, k: j.sizeK * taperIn(dist, b.taperIn), f: j.flowK, d: dist };
        if (dyn) {  // pen tilt and speed, as addStampPoint applies them while drawing
          const m = dynamicsAt(b, st.t, st.v);
          o.k *= m.sizeK;
          o.f *= m.flowK;
          if (b.tiltAngle && st.az != null) o.a = st.az;
        }
        if (dabColors) o.c = shiftColor(s.color, colorJitter(b, rnd));
        out.push(o);
      }
    }
  }
  if (b.taperOut > 0) for (const st of out) st.k *= taperOut(dist - st.d, b.taperOut);
  return out;
}

/**
 * The dual brush's dabs along a line (brush dualTip not 'none'): {x, y, size}, its own spacing and scatter, from
 * the line's seed, so the line's paint shows only where these land (liveSource's `dual`). [] when it is off.
 */
export function dualStamps(s, b) {
  if (!b.dualTip || b.dualTip === 'none') return [];
  const dsize = p => Math.max(0.5, stampAt(b, p).size * b.dualSize), path = new StampPath(dsize, b.dualSpacing), rnd = seeded(s.seed + 11);
  const out = [];
  for (const [x, y, p] of s.pts) {
    for (const st of path.add({ x, y, p })) {
      const j = dabJitter({ scatter: b.dualScatter }, dsize(st.p), rnd);
      out.push({ x: st.x + j.dx, y: st.y + j.dy, size: dsize(st.p) });
    }
  }
  return out;
}

// ---------- geometry ----------

/** Distance from point (px, py) to the segment a-b. */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Where segments p1-p2 and p3-p4 cross: [t along the first, u along the second] (both 0-1), or null. */
export function segCross(p1, p2, p3, p4) {
  const rx = p2[0] - p1[0], ry = p2[1] - p1[1], sx = p4[0] - p3[0], sy = p4[1] - p3[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = p3[0] - p1[0], qy = p3[1] - p1[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

/** Distance between segments a1-a2 and b1-b2 (0 when they cross). */
function segSegDist(a1, a2, b1, b2) {
  if (segCross(a1, a2, b1, b2)) return 0;
  return Math.min(segDist(a1[0], a1[1], b1[0], b1[1], b2[0], b2[1]), segDist(a2[0], a2[1], b1[0], b1[1], b2[0], b2[1]),
    segDist(b1[0], b1[1], a1[0], a1[1], a2[0], a2[1]), segDist(b2[0], b2[1], a1[0], a1[1], a2[0], a2[1]));
}

/** The path's box {x0, y0, x1, y1} grown by m. */
function pathBox(pts, m = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}
const boxesMeet = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Where along the line (index + fraction) the eraser segment a-b comes within r plus the line's half width, or -1. */
function touchAt(s, b, a1, a2, r) {
  const pts = s.pts;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i], d = segDist(q[0], q[1], a1[0], a1[1], a2[0], a2[1]) - halfWidth(b, q[2]);
    if (d <= r && d < bestD) { bestD = d; best = i; }
    if (i && d > r) {  // a long segment can pass through the eraser with both ends outside it
      const prev = pts[i - 1];
      if (segSegDist(prev, q, a1, a2) <= r && best < 0) best = i - 0.5;
    }
  }
  return best;
}

/** The point at a position along the path (index + fraction), pressure blended. */
function pointAt(pts, pos) {
  const i = Math.floor(pos), t = pos - i;
  if (t <= 0 || i >= pts.length - 1) return pts[Math.min(i, pts.length - 1)].slice();
  return mix(pts[i], pts[i + 1], t);
}

/** The part of a path between two positions (index + fraction), ends cut exactly; null when shorter than a point. */
function slice(pts, from, to) {
  if (to - from <= 0) return null;
  const out = [pointAt(pts, from)];
  for (let i = Math.floor(from) + 1; i < to; i++) out.push(pts[i].slice());
  out.push(pointAt(pts, to));
  return out.length >= 2 ? out : null;
}

/** Positions (index + fraction) where the line crosses any other line, sorted. */
function crossings(s, others) {
  const out = [], box = pathBox(s.pts);
  for (const o of others) {
    if (o === s || !boxesMeet(box, pathBox(o.pts))) continue;
    for (let i = 1; i < s.pts.length; i++) {
      const a1 = s.pts[i - 1], a2 = s.pts[i];
      const sb = { x0: Math.min(a1[0], a2[0]), y0: Math.min(a1[1], a2[1]), x1: Math.max(a1[0], a2[0]), y1: Math.max(a1[1], a2[1]) };
      for (let j = 1; j < o.pts.length; j++) {
        const b1 = o.pts[j - 1], b2 = o.pts[j];
        if (Math.max(b1[0], b2[0]) < sb.x0 || Math.min(b1[0], b2[0]) > sb.x1 || Math.max(b1[1], b2[1]) < sb.y0 || Math.min(b1[1], b2[1]) > sb.y1) continue;
        const c = segCross(a1, a2, b1, b2);
        if (c) out.push(i - 1 + c[0]);
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * Erases along the eraser segment a-b ([x, y]) with radius r, in one of the VECTOR_ERASE modes. Returns the new
 * vector object, or the same one when nothing was touched.
 *   area:         points within r of the eraser are removed; a line broken in the middle becomes two lines.
 *   intersection: a touched line loses the stretch between the nearest crossings with other lines either side
 *                 of the touch (or its ends), cut exactly at the crossings.
 *   line:         every touched line is removed.
 * A line counts as touched where the eraser comes within r of its painted edge (its path plus half its width).
 */
export function eraseVector(v, mode, a, b, r) {
  const ebox = pathBox([a, b], r);
  let changed = false;
  const out = [];
  for (const s of v.strokes) {
    const br = brushOf(v, s);
    if (!boxesMeet(ebox, pathBox(s.pts, br.size + 2))) { out.push(s); continue; }
    if (mode === 'area') {
      // cut where the eraser covers the path itself, so a thick line is trimmed back to the eraser's edge
      const keep = s.pts.map(q => segDist(q[0], q[1], a[0], a[1], b[0], b[1]) > r);
      if (keep.every(Boolean)) { out.push(s); continue; }
      changed = true;
      let run = [];
      const flush = () => { if (run.length >= 2) out.push({ ...s, pts: run }); run = []; };
      s.pts.forEach((q, i) => (keep[i] ? run.push(q) : flush()));
      flush();
      continue;
    }
    const at = touchAt(s, br, a, b, r);
    if (at < 0) { out.push(s); continue; }
    changed = true;
    if (mode === 'line') continue;
    const xs = crossings(s, v.strokes), last = s.pts.length - 1;
    const lo = xs.filter(x => x < at).pop(), hi = xs.find(x => x > at);
    const before = lo === undefined ? null : slice(s.pts, 0, lo), after = hi === undefined ? null : slice(s.pts, hi, last);
    if (before) out.push({ ...s, pts: before });
    if (after) out.push({ ...s, pts: after });
  }
  return changed ? { brushes: v.brushes, strokes: out } : v;
}

// ---------- editing lines (Line edit tool) ----------

/** The line whose painted edge is nearest to (x, y), within r of it: its index in v.strokes, or -1. */
export function nearestStroke(v, x, y, r) {
  let best = -1, bestD = r;
  v.strokes.forEach((s, i) => {
    const b = brushOf(v, s), box = pathBox(s.pts, b.size + r);
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return;
    for (let k = 0; k < s.pts.length; k++) {
      const q = s.pts[k], prev = s.pts[k - 1] || q;
      const d = segDist(x, y, prev[0], prev[1], q[0], q[1]) - halfWidth(b, q[2]);
      if (d <= bestD) { bestD = d; best = i; }
    }
  });
  return best;
}

/**
 * A line pulled from `grab` to `to`: every point moves by that offset, fully at the grab point and less further
 * away, to nothing at `radius` ((1 - (d/r)^2)^2, d measured from the grab point). Then resampled to `step` so a
 * stretched part keeps its points close. Pressure stays.
 */
export function pullStroke(s, grab, to, radius, step = 2) {
  const dx = to.x - grab.x, dy = to.y - grab.y, r2 = radius * radius;
  const pts = s.pts.map(([x, y, ...rest]) => {
    const d2 = (x - grab.x) ** 2 + (y - grab.y) ** 2;
    if (d2 >= r2) return [x, y, ...rest];
    const f = (1 - d2 / r2) ** 2;
    return [x + dx * f, y + dy * f, ...rest];
  });
  return { ...s, pts: resample(pts, step) };
}

/** The vector object with line i changed (color, opacity, w, pts...); a factor w of 1 is dropped. */
export function editStroke(v, i, props) {
  const s = { ...v.strokes[i], ...props };
  if (s.w === 1) delete s.w;
  return { brushes: v.brushes, strokes: v.strokes.map((o, k) => (k === i ? s : o)) };
}

/** The vector object without line i. */
export function removeStroke(v, i) {
  return { brushes: v.brushes, strokes: v.strokes.filter((_, k) => k !== i) };
}

/** The points evened out by `passes` rounds of a [1, 2, 1] / 4 average of each point with its neighbours (all from
 *  the previous round); the ends and the pressure stay. */
export function smoothPoints(pts, passes) {
  let cur = pts;
  for (let n = 0; n < passes; n++) {
    cur = cur.map((q, i) => (i === 0 || i === cur.length - 1 ? q : [
      (cur[i - 1][0] + 2 * q[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * q[1] + cur[i + 1][1]) / 4, ...q.slice(2)]));
  }
  return cur;
}

/** A shaky line evened out (Line edit → Smooth): `passes` rounds of smoothPoints, resampled to `step` px. */
export function smoothStroke(s, passes, step = 2) {
  return { ...s, pts: resample(smoothPoints(resample(s.pts, step), passes), step) };
}
