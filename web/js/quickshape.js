// QuickShape (pure, tested), as in Procreate: draw a line or a loop and keep the pen still at the end, and the
// stroke is redrawn as a clean straight line or ellipse; moving the pen before lifting it then stretches the shape.

const MIN_LENGTH = 20;   // shorter strokes are left alone (px along the path)
const CLOSED = 0.2;      // a stroke whose ends are this share of its length apart (or 12 px) is a loop: an ellipse
const STRAIGHT = 0.5;    // an open stroke whose ends are less than this share of its length apart wanders too much

const pathLength = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);

/**
 * The shape a stroke (points {x, y}) looks like: {shape: 'line', a, b} from its first to its last point, or
 * {shape: 'ellipse', cx, cy, rx, ry, angle} fitted along the loop's main direction (from the spread of its points),
 * or null when it is too short or too wandering to be either.
 */
export function detectShape(pts) {
  if (pts.length < 2) return null;
  const len = pathLength(pts), a = pts[0], b = pts[pts.length - 1], gap = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < MIN_LENGTH) return null;
  if (gap <= Math.max(12, CLOSED * len)) {
    const n = pts.length;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);  // the direction the points spread most along
    const ux = Math.cos(angle), uy = Math.sin(angle);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const u = (p.x - mx) * ux + (p.y - my) * uy, v = -(p.x - mx) * uy + (p.y - my) * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    return { shape: 'ellipse', cx: mx + cu * ux - cv * uy, cy: my + cu * uy + cv * ux, rx: (u1 - u0) / 2, ry: (v1 - v0) / 2, angle };
  }
  if (gap < STRAIGHT * len) return null;
  return { shape: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
}

/** Points along a shape about `step` px apart, with pressure p; an ellipse ends where it began. */
export function shapePoints(s, p = 1, step = 1) {
  const out = [];
  if (s.shape === 'line') {
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) out.push({ x: s.a.x + (s.b.x - s.a.x) * i / n, y: s.a.y + (s.b.y - s.a.y) * i / n, p });
    return out;
  }
  const per = Math.PI * (3 * (s.rx + s.ry) - Math.sqrt((3 * s.rx + s.ry) * (s.rx + 3 * s.ry)));  // Ramanujan
  const n = Math.max(12, Math.ceil(per / step)), c = Math.cos(s.angle), sn = Math.sin(s.angle);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2, u = Math.cos(t) * s.rx, v = Math.sin(t) * s.ry;
    out.push({ x: s.cx + u * c - v * sn, y: s.cy + u * sn + v * c, p });
  }
  return out;
}

/**
 * The shape after the pen moved from `from` (where it was when the shape snapped) to `to`: a line's end follows
 * the pen; an ellipse grows or shrinks about its centre by how much nearer or further the pen is from it.
 */
export function adjustShape(s, from, to) {
  if (s.shape === 'line') return { ...s, b: { x: s.b.x + to.x - from.x, y: s.b.y + to.y - from.y } };
  const d0 = Math.hypot(from.x - s.cx, from.y - s.cy), k = d0 > 1 ? Math.hypot(to.x - s.cx, to.y - s.cy) / d0 : 1;
  return { ...s, rx: s.rx * k, ry: s.ry * k };
}
