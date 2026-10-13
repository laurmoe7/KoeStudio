// Free-transform maths (pure, tested). A transform places a w x h source image with its centre at (cx, cy),
// scaled by (sx, sy) (negative = mirrored) and rotated by rot radians:
//   doc = (cx, cy) + R(rot) * (sx * (u - w/2), sy * (v - h/2))   for source pixel (u, v).

export const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export function newTransform(r) {
  return { w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0 };
}

/** Matrix [a, b, c, d, e, f] taking source pixels to doc pixels (for ctx.setTransform). */
export function xfMatrix(t) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const a = cos * t.sx, b = sin * t.sx, c = -sin * t.sy, d = cos * t.sy;
  return [a, b, c, d, t.cx - a * t.w / 2 - c * t.h / 2, t.cy - b * t.w / 2 - d * t.h / 2];
}

/** Doc position of a point given in box units: (hx, hy) in [-1, 1] from the centre. */
export function boxPoint(t, hx, hy) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const lx = hx * t.sx * t.w / 2, ly = hy * t.sy * t.h / 2;
  return { x: t.cx + cos * lx - sin * ly, y: t.cy + sin * lx + cos * ly };
}

export function corners(t) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => boxPoint(t, x, y));
}

/** Point in box units (inverse of boxPoint). */
export function toBox(t, p) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const dx = p.x - t.cx, dy = p.y - t.cy;
  const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
  return { x: lx / (t.sx * t.w / 2), y: ly / (t.sy * t.h / 2) };
}

/**
 * What a pointer at doc point p would grab: a handle name, 'move' (inside the box) or 'rotate' (outside).
 * tol is the grab distance in doc pixels (screen tolerance / zoom).
 */
export function hitTest(t, p, tol) {
  for (const [name, [hx, hy]] of Object.entries(HANDLES)) {
    const q = boxPoint(t, hx, hy);
    if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) return name;
  }
  const b = toBox(t, p);
  return Math.abs(b.x) <= 1 && Math.abs(b.y) <= 1 ? 'move' : 'rotate';
}

/** Dragging handle `name` of start transform t0 to doc point p; the opposite handle stays put. */
export function dragHandle(t0, name, p, keepAspect = false) {
  const [hx, hy] = HANDLES[name];
  const anchor = boxPoint(t0, -hx, -hy);
  const cos = Math.cos(t0.rot), sin = Math.sin(t0.rot);
  const dx = p.x - anchor.x, dy = p.y - anchor.y;
  const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;  // pointer in the box's own axes, from the anchor
  let sx = hx ? lx / (hx * t0.w) : t0.sx;
  let sy = hy ? ly / (hy * t0.h) : t0.sy;
  if (keepAspect) {
    if (hx && hy) {
      const kx = sx / t0.sx, ky = sy / t0.sy;
      const k = Math.abs(kx) > Math.abs(ky) ? kx : ky;
      sx = t0.sx * k; sy = t0.sy * k;
    } else if (hx) {
      sy = t0.sy * Math.abs(sx / t0.sx);
    } else {
      sx = t0.sx * Math.abs(sy / t0.sy);
    }
  }
  sx = clampScale(sx, t0.w);
  sy = clampScale(sy, t0.h);
  const t = { ...t0, sx, sy };
  // put the anchor back where it was
  const a2 = boxPoint(t, -hx, -hy);
  return { ...t, cx: t.cx + anchor.x - a2.x, cy: t.cy + anchor.y - a2.y };
}

function clampScale(s, size) {
  const min = 1 / Math.max(1, size);  // never thinner than one pixel
  return Math.abs(s) < min ? (s < 0 ? -min : min) : s;
}

/** Rotating from start point p0 to p around the centre; snap rounds to 15 degree steps. */
export function dragRotate(t0, p0, p, snap = false) {
  const a0 = Math.atan2(p0.y - t0.cy, p0.x - t0.cx), a1 = Math.atan2(p.y - t0.cy, p.x - t0.cx);
  let rot = t0.rot + a1 - a0;
  if (snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
  return { ...t0, rot };
}

export function dragMove(t0, p0, p) {
  return { ...t0, cx: t0.cx + p.x - p0.x, cy: t0.cy + p.y - p0.y };
}

/** Integer doc rectangle covering the transformed box (plus a pixel for anti-aliasing). */
export function xfBounds(t) {
  const cs = corners(t);
  const x0 = Math.floor(Math.min(...cs.map(c => c.x))) - 1, y0 = Math.floor(Math.min(...cs.map(c => c.y))) - 1;
  const x1 = Math.ceil(Math.max(...cs.map(c => c.x))) + 1, y1 = Math.ceil(Math.max(...cs.map(c => c.y))) + 1;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function isIdentity(t, r) {
  return t.sx === 1 && t.sy === 1 && t.rot % (2 * Math.PI) === 0 && t.cx === r.x + r.w / 2 && t.cy === r.y + r.h / 2;
}
