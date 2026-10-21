// Bezier control points for vector lines (pure, tested). A line may keep `ctrl`, its control points, as Clip Studio
// Paint's vector lines do: then its pen path `pts` is always curvePoints(ctrl), and the Control point tool moves,
// adds and removes points and bends their handles.
//
// ctrl = [[x, y, p, ix, iy, ox, oy], ...]: an anchor at (x, y) with pen pressure p (0-1), and its two handles as
// offsets from it: in (towards the anchor before) and out (towards the one after). A corner has both handles at 0
// (straight lines meet there); a smooth point has them pointing opposite ways. Between two anchors runs a cubic
// Bezier curve, the pressure blended along it. A closed line runs on from the last anchor back to the first.
//
// fitCurve turns a drawn path into as few anchors as keep it within a tolerance (Schneider's algorithm, Graphics
// Gems 1990: least-squares handle lengths along fixed tangents, Newton steps to refit the parameters, split at the
// worst point), with corners kept where the path turns sharply. It is how a drawn line gets control points and how
// Simplify tidies one up.

export const MAX_ANCHORS = 5000;

const X = 0, Y = 1, P = 2, IX = 3, IY = 4, OX = 5, OY = 6;

/** Cleans control points from a file: null unless at least two anchors of finite numbers. */
export function sanitizeCtrl(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const a of raw.slice(0, MAX_ANCHORS)) {
    if (!Array.isArray(a)) return null;
    const n = [0, 1, 2, 3, 4, 5, 6].map(k => Number(a[k] ?? 0));
    if (!n.every(Number.isFinite)) return null;
    n[P] = Math.max(0, Math.min(1, n[P]));
    out.push(n);
  }
  return out.length >= 2 ? out : null;
}

const segCount = (ctrl, closed) => (closed ? ctrl.length : ctrl.length - 1);

/** Segment i's four Bezier points [[x, y] x4] and its end pressures [pa, pb]. */
export function segment(ctrl, closed, i) {
  const a = ctrl[i], b = ctrl[(i + 1) % ctrl.length];
  return {
    q: [[a[X], a[Y]], [a[X] + a[OX], a[Y] + a[OY]], [b[X] + b[IX], b[Y] + b[IY]], [b[X], b[Y]]],
    pa: a[P], pb: b[P],
  };
}

/** The point at t (0-1) on a cubic Bezier given by four points. */
export function bezierAt(q, t) {
  const s = 1 - t, a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t;
  return [a * q[0][0] + b * q[1][0] + c * q[2][0] + d * q[3][0], a * q[0][1] + b * q[1][1] + c * q[2][1] + d * q[3][1]];
}

/**
 * The line's path: points [x, y, p] no more than about `step` apart along each curve, ending on the last anchor
 * (for a closed line, back on the first).
 */
export function curvePoints(ctrl, closed, step = 2) {
  const out = [];
  if (ctrl.length === 1) return [[ctrl[0][X], ctrl[0][Y], ctrl[0][P]]];
  for (let i = 0; i < segCount(ctrl, closed); i++) {
    const { q, pa, pb } = segment(ctrl, closed, i);
    const len = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]) + Math.hypot(q[3][0] - q[2][0], q[3][1] - q[2][1]);
    // the curve runs up to 1.5 times its average speed in t (a straight line with no handles, at t = 1/2)
    const m = Math.max(1, Math.ceil(1.5 * len / Math.max(0.25, step)));
    for (let k = 0; k < m; k++) {
      const t = k / m, [x, y] = bezierAt(q, t);
      out.push([x, y, pa + (pb - pa) * t]);
    }
  }
  const end = closed ? ctrl[0] : ctrl[ctrl.length - 1];
  out.push([end[X], end[Y], end[P]]);
  return out;
}

/** The nearest place on the line to (x, y): {seg, t, d (distance), x, y}. */
export function nearestOnCurve(ctrl, closed, x, y) {
  let best = { seg: 0, t: 0, d: Infinity, x: ctrl[0][X], y: ctrl[0][Y] };
  for (let i = 0; i < segCount(ctrl, closed); i++) {
    const { q } = segment(ctrl, closed, i);
    const len = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]);
    const m = Math.max(16, Math.ceil(len));
    for (let k = 0; k <= m; k++) {
      const [px, py] = bezierAt(q, k / m), d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { seg: i, t: k / m, d, x: px, y: py };
    }
  }
  return best;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A new anchor at t on segment seg, the curve unchanged (de Casteljau); returns [ctrl, index of the new anchor]. */
export function splitAt(ctrl, closed, seg, t) {
  const { q, pa, pb } = segment(ctrl, closed, seg);
  const q0 = lerp(q[0], q[1], t), q1 = lerp(q[1], q[2], t), q2 = lerp(q[2], q[3], t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t);
  const out = ctrl.map(a => a.slice());
  const ia = seg, ib = (seg + 1) % ctrl.length;
  out[ia][OX] = q0[0] - q[0][0]; out[ia][OY] = q0[1] - q[0][1];
  out[ib][IX] = q2[0] - q[3][0]; out[ib][IY] = q2[1] - q[3][1];
  const mid = [s[0], s[1], pa + (pb - pa) * t, r0[0] - s[0], r0[1] - s[1], r1[0] - s[0], r1[1] - s[1]];
  out.splice(seg + 1, 0, mid);
  return [out, seg + 1];
}

/** Without anchor i (at least two stay). */
export function removeAnchor(ctrl, i) {
  return ctrl.length <= 2 ? ctrl : ctrl.filter((_, k) => k !== i);
}

/** Anchor i moved to (x, y), its handles along. */
export function moveAnchor(ctrl, i, x, y) {
  return ctrl.map((a, k) => (k === i ? [x, y, ...a.slice(2)] : a));
}

/** Anchor i with pressure p. */
export function setPressure(ctrl, i, p) {
  return ctrl.map((a, k) => (k === i ? [a[X], a[Y], Math.max(0, Math.min(1, p)), ...a.slice(3)] : a));
}

const hlen = (a, which) => (which === 'in' ? Math.hypot(a[IX], a[IY]) : Math.hypot(a[OX], a[OY]));

/** Whether anchor a is smooth: both handles there and pointing opposite ways (within about 2°). */
export function isSmooth(a) {
  const li = hlen(a, 'in'), lo = hlen(a, 'out');
  if (li < 1e-6 || lo < 1e-6) return false;
  return (a[IX] * a[OX] + a[IY] * a[OY]) / (li * lo) < -0.999;
}

/**
 * Anchor i's handle `which` ('in' / 'out') dragged to the doc point (x, y). With mirror, the other handle turns to
 * point the opposite way, keeping its length (a smooth point stays smooth).
 */
export function moveHandle(ctrl, i, which, x, y, mirror) {
  return ctrl.map((a, k) => {
    if (k !== i) return a;
    const b = a.slice(), dx = x - a[X], dy = y - a[Y], len = Math.hypot(dx, dy);
    const [hx, hy, ox, oy] = which === 'in' ? [IX, IY, OX, OY] : [OX, OY, IX, IY];
    b[hx] = dx; b[hy] = dy;
    const other = Math.hypot(a[ox], a[oy]);
    if (mirror && len > 1e-6 && other > 1e-6) { b[ox] = -dx / len * other; b[oy] = -dy / len * other; }
    return b;
  });
}

/**
 * Anchor i turned into a corner (handles dropped) or, when it is one, into a smooth point whose handles follow the
 * direction from the anchor before to the one after, a third of the way to each.
 */
export function toggleCorner(ctrl, closed, i) {
  const a = ctrl[i], n = ctrl.length;
  if (hlen(a, 'in') > 1e-6 || hlen(a, 'out') > 1e-6) return ctrl.map((c, k) => (k === i ? [c[X], c[Y], c[P], 0, 0, 0, 0] : c));
  const prev = i > 0 ? ctrl[i - 1] : closed ? ctrl[n - 1] : null, next = i < n - 1 ? ctrl[i + 1] : closed ? ctrl[0] : null;
  const from = prev || a, to = next || a;
  let dx = to[X] - from[X], dy = to[Y] - from[Y];
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return ctrl;
  dx /= d; dy /= d;
  const li = prev ? Math.hypot(a[X] - prev[X], a[Y] - prev[Y]) / 3 : 0, lo = next ? Math.hypot(next[X] - a[X], next[Y] - a[Y]) / 3 : 0;
  return ctrl.map((c, k) => (k === i ? [c[X], c[Y], c[P], -dx * li, -dy * li, dx * lo, dy * lo] : c));
}

/** Every anchor and handle moved by f(x, y) -> [x, y] (a handle is its end point mapped, less the mapped anchor). */
export function mapCtrl(ctrl, f) {
  return ctrl.map(a => {
    const [x, y] = f(a[X], a[Y]);
    const [ix, iy] = f(a[X] + a[IX], a[Y] + a[IY]), [ox, oy] = f(a[X] + a[OX], a[Y] + a[OY]);
    return [x, y, a[P], ix - x, iy - y, ox - x, oy - y];
  });
}

/** Anchors with zero handles at the given points ({x, y}, pressure p or 1): a polyline or polygon. */
export const cornerCtrl = points => points.map(q => [q.x, q.y, q.p ?? 1, 0, 0, 0, 0]);

// ---------- fitting a drawn path ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = v => { const l = Math.hypot(v[0], v[1]); return l > 1e-12 ? [v[0] / l, v[1] / l] : [0, 0]; };
const scale = (v, k) => [v[0] * k, v[1] * k];

/** Index of the first point at least `w` along the path from point i, stepping by dir (+1 / -1), clamped to the ends. */
function reachIndex(pts, i, w, dir) {
  let j = i, d = 0;
  while (j + dir >= 0 && j + dir < pts.length && d < w) { d += Math.hypot(pts[j + dir][0] - pts[j][0], pts[j + dir][1] - pts[j][1]); j += dir; }
  return j;
}

/** Indices where the path turns by more than ~65° within `w` either side (the sharpest point of each turn). */
function cornersOf(pts, w) {
  const turn = pts.map((q, i) => {
    const a = reachIndex(pts, i, w, -1), b = reachIndex(pts, i, w, 1);
    if (a === i || b === i) return 0;
    const u = unit(sub(q, pts[a])), v = unit(sub(pts[b], q));
    return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  });
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (turn[i] < 1.15 || turn[i] < turn[i - 1] || turn[i] < turn[i + 1]) continue;
    if (out.length && Math.hypot(pts[i][0] - pts[out.at(-1)][0], pts[i][1] - pts[out.at(-1)][1]) < w) {
      if (turn[i] > turn[out.at(-1)]) out[out.length - 1] = i;
      continue;
    }
    out.push(i);
  }
  return out;
}

const B0 = u => (1 - u) ** 3, B1 = u => 3 * u * (1 - u) ** 2, B2 = u => 3 * u * u * (1 - u), B3 = u => u ** 3;

/** Chord-length parameters 0-1 for points d[first..last]. */
function chordParams(d, first, last) {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
  const L = u[u.length - 1] || 1;
  return u.map(v => v / L);
}

/** Least-squares Bezier for d[first..last] at parameters u, the handles along t1 (start, forwards) and t2 (end, backwards). */
function generateBezier(d, first, last, u, t1, t2) {
  const p0 = d[first], p3 = d[last];
  const C = [[0, 0], [0, 0]], Xv = [0, 0];
  for (let i = 0; i < u.length; i++) {
    const a1 = scale(t1, B1(u[i])), a2 = scale(t2, B2(u[i]));
    C[0][0] += dot(a1, a1); C[0][1] += dot(a1, a2); C[1][1] += dot(a2, a2);
    const tmp = sub(d[first + i], [p0[0] * (B0(u[i]) + B1(u[i])) + p3[0] * (B2(u[i]) + B3(u[i])), p0[1] * (B0(u[i]) + B1(u[i])) + p3[1] * (B2(u[i]) + B3(u[i]))]);
    Xv[0] += dot(a1, tmp); Xv[1] += dot(a2, tmp);
  }
  C[1][0] = C[0][1];
  const det = C[0][0] * C[1][1] - C[1][0] * C[0][1];
  let al = det ? (Xv[0] * C[1][1] - Xv[1] * C[0][1]) / det : 0, ar = det ? (C[0][0] * Xv[1] - C[1][0] * Xv[0]) / det : 0;
  const len = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), eps = 1e-6 * len;
  if (al < eps || ar < eps) al = ar = len / 3;  // a degenerate fit: the usual third of the chord
  return [[p0[0], p0[1]], [p0[0] + t1[0] * al, p0[1] + t1[1] * al], [p3[0] + t2[0] * ar, p3[1] + t2[1] * ar], [p3[0], p3[1]]];
}

/** One Newton step improving parameter u of point p on curve q. */
function newton(q, p, u) {
  const d1 = [0, 1, 2].map(k => scale(sub(q[k + 1], q[k]), 3)), d2 = [0, 1].map(k => scale(sub(d1[k + 1], d1[k]), 2));
  const at = (pts, t) => {
    if (pts.length === 3) { const s = 1 - t; return [s * s * pts[0][0] + 2 * s * t * pts[1][0] + t * t * pts[2][0], s * s * pts[0][1] + 2 * s * t * pts[1][1] + t * t * pts[2][1]]; }
    return lerp(pts[0], pts[1], t);
  };
  const qu = bezierAt(q, u), q1 = at(d1, u), q2 = at(d2, u), diff = sub(qu, p);
  const num = dot(diff, q1), den = dot(q1, q1) + dot(diff, q2);
  return den ? Math.max(0, Math.min(1, u - num / den)) : u;
}

/**
 * How far the curve is off: the worst point's distance over tol, or its pressure difference over P_TOL when that is
 * worse, and that point's index.
 */
const P_TOL = 0.08;
function maxError(d, first, last, q, u) {
  let worst = 0, at = Math.floor((first + last) / 2);
  const pa = d[first][2], pb = d[last][2];
  for (let i = first + 1; i < last; i++) {
    const t = u[i - first], c = bezierAt(q, t);
    const e = Math.max(Math.hypot(c[0] - d[i][0], c[1] - d[i][1]) / tolNow, Math.abs(pa + (pb - pa) * t - d[i][2]) / P_TOL);
    if (e > worst) { worst = e; at = i; }
  }
  return [worst, at];
}
let tolNow = 1;

/** Bezier curves (each four points, from index first to last) through d[first..last] within tolNow. */
function fitCubic(d, first, last, t1, t2, out) {
  if (last - first === 1) {
    const dist = Math.hypot(d[last][0] - d[first][0], d[last][1] - d[first][1]) / 3;
    out.push({ first, last, q: [d[first].slice(0, 2), [d[first][0] + t1[0] * dist, d[first][1] + t1[1] * dist], [d[last][0] + t2[0] * dist, d[last][1] + t2[1] * dist], d[last].slice(0, 2)] });
    return;
  }
  let u = chordParams(d, first, last), q = generateBezier(d, first, last, u, t1, t2);
  let [err, split] = maxError(d, first, last, q, u);
  if (err < 1) { out.push({ first, last, q }); return; }
  if (err < 4) {
    for (let k = 0; k < 4; k++) {
      u = u.map((t, i) => newton(q, d[first + i], t));
      q = generateBezier(d, first, last, u, t1, t2);
      [err, split] = maxError(d, first, last, q, u);
      if (err < 1) { out.push({ first, last, q }); return; }
    }
  }
  split = Math.max(first + 1, Math.min(last - 1, split));
  let tc = unit(sub(d[split - 1], d[split + 1]));
  if (!tc[0] && !tc[1]) tc = unit(sub(d[split - 1], d[split]));
  fitCubic(d, first, split, t1, tc, out);
  fitCubic(d, split, last, scale(tc, -1), t2, out);
}

/**
 * Control points for a drawn path ([[x, y, p, ...]]): as few anchors as keep the curve within `tol` px of every
 * point (and the pressure within 0.08), with corners where the path turns sharply. Tilt and speed are not kept.
 */
export function fitCurve(pts, tol = 1) {
  const d = [];
  for (const q of pts) {
    const prev = d[d.length - 1];
    if (!prev || Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 1e-3) d.push([q[0], q[1], q[2] ?? 1]);
  }
  if (d.length < 2) {
    const q = d[0] || [0, 0, 1];
    return [[q[0], q[1], q[2], 0, 0, 0, 0], [q[0], q[1], q[2], 0, 0, 0, 0]];
  }
  tolNow = Math.max(0.1, tol);
  const w = Math.max(3, 2 * tolNow);
  const breaks = [0, ...cornersOf(d, w), d.length - 1];
  const curves = [];
  for (let k = 0; k < breaks.length - 1; k++) {
    const a = breaks[k], b = breaks[k + 1];
    const t1 = unit(sub(d[Math.min(b, reachIndex(d, a, w, 1))], d[a])), t2 = unit(sub(d[Math.max(a, reachIndex(d, b, w, -1))], d[b]));
    fitCubic(d, a, b, t1, t2, curves);
  }
  const ctrl = [];
  curves.forEach((c, k) => {
    const p0 = d[c.first];
    if (k === 0) ctrl.push([p0[0], p0[1], p0[2], 0, 0, 0, 0]);
    const a = ctrl[ctrl.length - 1];
    a[OX] = c.q[1][0] - c.q[0][0]; a[OY] = c.q[1][1] - c.q[0][1];
    const p3 = d[c.last];
    ctrl.push([p3[0], p3[1], p3[2], c.q[2][0] - c.q[3][0], c.q[2][1] - c.q[3][1], 0, 0]);
  });
  const r = v => Math.round(v * 100) / 100;
  return ctrl.slice(0, MAX_ANCHORS).map(a => [r(a[X]), r(a[Y]), Math.round(a[P] * 1000) / 1000, r(a[IX]), r(a[IY]), r(a[OX]), r(a[OY])]);
}
