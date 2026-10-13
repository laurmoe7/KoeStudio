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

/** Whole canvas centred in a vw x vh viewport, with a margin, no rotation. */
export function fitView(docW, docH, vw, vh, margin = 40) {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((vw - margin * 2) / docW, (vh - margin * 2) / docH)));
  return { zoom, rot: 0, flip: false, panX: (vw - docW * zoom) / 2, panY: (vh - docH * zoom) / 2 };
}

/** Same zoom as v but 100%, centred on the viewport centre. */
export function actualSize(v, vw, vh) {
  return zoomAt(v, 1 / v.zoom, vw / 2, vh / 2);
}
