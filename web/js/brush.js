// Stroke maths (pure, tested): smoothing of the pen position and spacing of brush stamps along the stroke.

/** Shapes pen pressure: gamma < 1 makes light pressure count for more, > 1 for less. */
export function pressureCurve(p, gamma = 1) {
  p = Math.max(0, Math.min(1, p));
  return gamma === 1 ? p : Math.pow(p, gamma);
}

/**
 * A pressure curve: 2-16 [x, y] points in [0, 1], x rising, or null for none. Points out of order or outside the
 * square are sorted and clamped; fewer than two usable points means no curve.
 */
export function sanitizeCurve(pts) {
  if (!Array.isArray(pts)) return null;
  const out = pts.filter(q => Array.isArray(q) && Number.isFinite(+q[0]) && Number.isFinite(+q[1]))
    .map(([x, y]) => [Math.max(0, Math.min(1, +x)), Math.max(0, Math.min(1, +y))])
    .sort((a, b) => a[0] - b[0])
    .filter((q, i, a) => i === 0 || q[0] > a[i - 1][0])
    .slice(0, 16);
  return out.length >= 2 ? out : null;
}

/**
 * The curve's value at p: a smooth line through the points that never overshoots them (monotone cubic, Fritsch-
 * Carlson), flat before the first point and after the last. Straight between two points when that is all there is.
 */
export function curveAt(pts, p) {
  const n = pts.length;
  if (p <= pts[0][0]) return pts[0][1];
  if (p >= pts[n - 1][0]) return pts[n - 1][1];
  let i = 0;
  while (pts[i + 1][0] < p) i++;
  const slope = k => (pts[k + 1][1] - pts[k][1]) / (pts[k + 1][0] - pts[k][0]);
  const tangent = k => {  // at point k
    if (k === 0) return slope(0);
    if (k === n - 1) return slope(n - 2);
    const a = slope(k - 1), b = slope(k);
    return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b);  // harmonic mean keeps it monotone
  };
  const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = x1 - x0, t = (p - x0) / h;
  const t2 = t * t, t3 = t2 * t;
  const v = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tangent(i) + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * tangent(i + 1);
  return Math.max(0, Math.min(1, v));
}

/**
 * Size and density of one stamp at raw pen pressure p: through the size and density curves when the brush has
 * them (imported brushes), else through the shared gamma curve; minSize / minFlow are what the lightest touch gives.
 */
export function stampAt(s, p) {
  const ps = s.sizeCurve ? curveAt(s.sizeCurve, p) : pressureCurve(p, s.gamma ?? 1);
  const pf = s.flowCurve ? curveAt(s.flowCurve, p) : pressureCurve(p, s.gamma ?? 1);
  const minSize = s.minSize ?? 0.1, minFlow = s.minFlow ?? 0;
  const size = s.size * (s.pressureSize ? minSize + (1 - minSize) * ps : 1);
  const flow = (s.flow ?? 1) * (s.pressureOpacity ? minFlow + (1 - minFlow) * pf : 1);
  return { size: Math.max(0.5, size), flow };
}

/** Size and opacity of one stamp for a tool's settings at pressure p (already curved). */
export function stampFor(settings, p) {
  const minSize = settings.minSize ?? 0.1;
  const size = settings.size * (settings.pressureSize ? minSize + (1 - minSize) * p : 1);
  const flow = (settings.flow ?? 1) * (settings.pressureOpacity ? p : 1);
  return { size: Math.max(0.5, size), flow };
}

/**
 * Lazy-pull smoothing ("stabilization" in other painting programs): each new point moves only part of the way
 * toward the pen, so wobbles even out. strength 0 is off, 1-20 is increasingly smooth.
 */
export class Smoother {
  constructor(strength = 0) {
    this.k = 1 / (1 + Math.max(0, strength) * 0.6);
    this.last = null;
  }
  add(pt) {
    if (!this.last || this.k === 1) return (this.last = { ...pt });
    const l = this.last, k = this.k;
    return (this.last = { x: l.x + (pt.x - l.x) * k, y: l.y + (pt.y - l.y) * k, p: l.p + (pt.p - l.p) * k });
  }
  /** How far the smoothed point still is from pt (Infinity before the first point); the stroke is finished when it is ~0. */
  distanceTo(pt) {
    return this.last ? Math.hypot(pt.x - this.last.x, pt.y - this.last.y) : Infinity;
  }
}

/**
 * Turns pen points into evenly spaced stamps. spacing is a share of the stamp's diameter (0.1 = a stamp every
 * tenth of a brush width), so the line looks the same at every size. The first point always gives a stamp.
 */
export class StampPath {
  constructor(sizeAt, spacing = 0.12) {
    this.sizeAt = sizeAt;   // p -> diameter
    this.spacing = spacing;
    this.prev = null;
    this.carry = 0;         // distance already travelled toward the next stamp
  }
  add(pt) {
    const out = [];
    if (!this.prev) {
      this.prev = pt;
      out.push({ ...pt });
      return out;
    }
    const a = this.prev, dx = pt.x - a.x, dy = pt.y - a.y, len = Math.hypot(dx, dy);
    if (len === 0) return out;
    let t = 0;
    for (let guard = 0; guard < 100000; guard++) {
      const p = a.p + (pt.p - a.p) * t;
      const step = Math.max(0.25, this.sizeAt(p) * this.spacing);
      const need = step - this.carry;
      if (t * len + need > len) {
        this.carry += len - t * len;
        break;
      }
      t += need / len;
      this.carry = 0;
      out.push({ x: a.x + dx * t, y: a.y + dy * t, p: a.p + (pt.p - a.p) * t });
    }
    this.prev = pt;
    return out;
  }
}

/** Bounding box of stamps (with their radius), as integer {x, y, w, h}; null when empty. */
export function stampBounds(stamps, sizeAt) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of stamps) {
    const r = sizeAt(s.p) / 2 + 2;
    x0 = Math.min(x0, s.x - r); y0 = Math.min(y0, s.y - r);
    x1 = Math.max(x1, s.x + r); y1 = Math.max(y1, s.y + r);
  }
  if (x0 === Infinity) return null;
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  return { x: x0, y: y0, w: Math.ceil(x1) - x0, h: Math.ceil(y1) - y0 };
}
