// Canvas view transform (pure, tested): screen = pan + rotate(flip(zoom * doc)).
// The view keeps the canvas point under the cursor fixed while zooming and rotating.

export const ZOOM_MIN = 0.02, ZOOM_MAX = 64;

export function newView() {
  return { zoom: 1, rot: 0, flip: false, panX: 0, panY: 0 };
}

/** The 2D matrix [a, b, c, d, e, f] (as for ctx.setTransform) taking doc pixels to screen pixels. */
export function matrix(v) {
  const cos = Math.cos(v.rot), sin = Math.sin(v.rot), z = v.zoom, fx = v.flip ? -1 : 1;
  return [cos * z * fx, sin * z * fx, -sin * z, cos * z, v.panX, v.panY];
}

export function toScreen(v, x, y) {
  const [a, b, c, d, e, f] = matrix(v);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export function toDoc(v, sx, sy) {
  const [a, b, c, d, e, f] = matrix(v);
  const det = a * d - b * c;
  const x = sx - e, y = sy - f;
  return { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
}

/** Zoom by factor around screen point (sx, sy). */
export function zoomAt(v, factor, sx, sy) {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
  const p = toDoc(v, sx, sy);
  const n = { ...v, zoom: z };
  const s = toScreen(n, p.x, p.y);
  return { ...n, panX: n.panX + sx - s.x, panY: n.panY + sy - s.y };
}

/** Rotate by radians around screen point (sx, sy). */
export function rotateAt(v, rad, sx, sy) {
  const p = toDoc(v, sx, sy);
  const n = { ...v, rot: v.rot + rad };
  const s = toScreen(n, p.x, p.y);
  return { ...n, panX: n.panX + sx - s.x, panY: n.panY + sy - s.y };
}

/** Mirror the view left-right around screen point (sx, sy). */
export function flipAt(v, sx, sy) {
  const p = toDoc(v, sx, sy);
  const n = { ...v, flip: !v.flip, rot: -v.rot };
  const s = toScreen(n, p.x, p.y);
  return { ...n, panX: n.panX + sx - s.x, panY: n.panY + sy - s.y };
}

/**
 * Two-finger view change: from view v with the fingers first at a0 and b0 (screen points) and now at a1 and b1,
 * the canvas zooms by how far apart they moved, turns by how much the line between them turned (less a small
 * dead zone, `dead` radians, so a plain pinch does not tilt the canvas), and the point between the fingers stays
 * under them.
 */
export function pinchView(v, a0, b0, a1, b1, dead = 0) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const k = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  let turn = d0 > 0 && d1 > 0 ? Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x) : 0;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));  // -pi..pi
  turn = Math.abs(turn) <= dead ? 0 : turn - Math.sign(turn) * dead;
  const c0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, c1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const p = toDoc(v, c0.x, c0.y);
  const n = { ...v, zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * k)), rot: v.rot + turn };
  const s = toScreen(n, p.x, p.y);
  return { ...n, panX: n.panX + c1.x - s.x, panY: n.panY + c1.y - s.y };
}

/** Whole canvas centred in a vw x vh viewport, with a margin, no rotation. */
export function fitView(docW, docH, vw, vh, margin = 40) {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((vw - margin * 2) / docW, (vh - margin * 2) / docH)));
  return { zoom, rot: 0, flip: false, panX: (vw - docW * zoom) / 2, panY: (vh - docH * zoom) / 2 };
}

/** The view keeping v's turn and mirror that shows doc rectangle r ({x, y, w, h}) as big as fits, centred. */
export function fitRectView(v, r, vw, vh, margin = 40) {
  const c = Math.abs(Math.cos(v.rot)), s = Math.abs(Math.sin(v.rot));
  const bw = Math.max(1, c * r.w + s * r.h), bh = Math.max(1, s * r.w + c * r.h);
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((vw - margin * 2) / bw, (vh - margin * 2) / bh)));
  const at = toScreen({ ...v, zoom, panX: 0, panY: 0 }, r.x + r.w / 2, r.y + r.h / 2);
  return { ...v, zoom, panX: vw / 2 - at.x, panY: vh / 2 - at.y };
}

/** Same zoom as v but 100%, centred on the viewport centre. */
export function actualSize(v, vw, vh) {
  return zoomAt(v, 1 / v.zoom, vw / 2, vh / 2);
}
