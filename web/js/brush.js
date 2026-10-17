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

/**
 * Random variation of one dab: an offset of up to scatter x its size in any direction, and size and density
 * lowered by up to sizeJitter / flowJitter. rnd() gives numbers in [0, 1) (Math.random, or a fixed list in tests).
 */
export function dabJitter(s, size, rnd = Math.random) {
  const out = { dx: 0, dy: 0, sizeK: 1, flowK: 1 };
  if (s.scatter > 0) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s.scatter * size;  // even spread over the disc
    out.dx = Math.cos(a) * r;
    out.dy = Math.sin(a) * r;
  }
  if (s.sizeJitter > 0) out.sizeK = 1 - s.sizeJitter * rnd();
  if (s.flowJitter > 0) out.flowK = 1 - s.flowJitter * rnd();
  return out;
}

/**
 * Random colour variation: hue turned up to hueJitter x 180 degrees either way, saturation and brightness moved up
 * to satJitter / valJitter either way (for color.js shiftColor). null when the brush has none.
 */
export function colorJitter(s, rnd = Math.random) {
  if (!(s.hueJitter > 0 || s.satJitter > 0 || s.valJitter > 0)) return null;
  const either = k => k > 0 ? (rnd() * 2 - 1) * k : 0;
  return { h: either(s.hueJitter) * 180, s: either(s.satJitter), v: either(s.valJitter) };
}

/**
 * The sample stroke of a brush preview: an S-curve across a w x h box (padX px in from the sides, padY from the
 * top and bottom), with pen pressure rising from light to full in the middle and back. [[x, y, p]], n + 1 points.
 */
export function previewPath(w, h, padX, padY = padX, n = 64) {
  const out = [], amp = Math.max(0, h / 2 - padY);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([padX + (w - 2 * padX) * t, h / 2 - Math.sin(t * Math.PI * 2) * amp, 0.15 + 0.85 * Math.sin(t * Math.PI)]);
  }
  return out;
}

/** Brush settings for a preview: size at most maxSize, with the tapers shrunk along so the stroke looks the same. */
export function previewSettings(s, maxSize) {
  const k = Math.min(1, maxSize / Math.max(0.5, s.size || 1));
  return { ...s, size: (s.size || 1) * k, taperIn: (s.taperIn || 0) * k, taperOut: (s.taperOut || 0) * k };
}

/** Size factor of the starting taper: grows from 10% to full over the first `length` pixels of the stroke. */
export function taperIn(dist, length) {
  if (!(length > 0) || dist >= length) return 1;
  const t = Math.max(0, dist) / length;
  return 0.1 + 0.9 * t * (2 - t);  // eases out: quick at first, then settles
}

/**
 * The ending taper holds the last `length` px of a stroke back until the pen lifts (only then is it known to be
 * the end). Given the held stamps (each with its distance `d` along the stroke) and the distance so far, returns
 * the ones now far enough from the end to draw as they are, and those still held.
 */
export function releaseHeld(held, dist, length) {
  let i = 0;
  while (i < held.length && held[i].d <= dist - length) i++;
  return { ready: held.slice(0, i), held: held.slice(i) };
}

/** Size factor of the ending taper for a stamp `left` px before the end: the start taper's curve, mirrored. */
export const taperOut = (left, length) => taperIn(left, length);

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

// ---------- pen pressure adjustment ----------
// One curve for the whole program (File → Pen pressure settings…, kept in koe.pressureCurve) that every pen
// pressure passes through before any tool sees it, so a heavy or light hand can be matched once.

/** Ready-made pressure curves: light pressure counts more (soft), as it comes (normal), or you press harder (firm). */
export const PRESSURE_PRESETS = {
  soft: [[0, 0], [0.3, 0.55], [1, 1]],
  normal: [[0, 0], [1, 1]],
  firm: [[0, 0], [0.6, 0.35], [1, 1]],
};

/** A pen's pressure through the curve (none: as it is); never 0, so a light touch still draws. */
export function adjustPressure(curve, p) {
  if (!curve) return p;
  return Math.max(0.01, Math.min(1, curveAt(curve, p)));
}

/**
 * A curve fitted to test strokes drawn the way you normally draw (their raw pressures): your usual pressure (the
 * median) becomes one half, and your firm pressure (the 95th percentile) full strength. null with too few samples.
 */
export function pressureFromStrokes(samples) {
  const s = samples.filter(p => p > 0 && p <= 1).sort((a, b) => a - b);
  if (s.length < 20) return null;
  const q = f => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))];
  const hi = Math.max(0.05, Math.min(1, q(0.95))), mid = Math.min(q(0.5), hi * 0.9);
  const pts = [[0, 0]];
  if (mid > 0.02) pts.push([+mid.toFixed(3), 0.5]);
  pts.push([+hi.toFixed(3), 1]);
  if (hi < 1) pts.push([1, 1]);
  return sanitizeCurve(pts);
}
