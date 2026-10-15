// Figure tool geometry (pure, tested): the outline of a line, rectangle or ellipse dragged from a to b,
// as a polyline the brush is stamped along. Shift constrains: 45° steps for a line, a square / circle otherwise.

export const FIGURE_SHAPES = [['line', 'Straight line'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']];

/** The second corner of the shape after Shift: the drag snapped to 45° (line) or to a square (rect, ellipse). */
export function constrain(shape, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (shape === 'line') {
    const len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
}

/**
 * The outline as points to stamp along: { points: [{x, y}], closed }. A line is its two ends, a rectangle its
 * four corners (closed), or with `corner` (radius in px, at most half the shorter side) rounded corners, each a
 * quarter circle in steps no longer than `spacing`; an ellipse enough points for the stamps to overlap (closed).
 */
export function figurePoints(shape, a, b, spacing = 1, corner = 0) {
  if (shape === 'line') return { points: [{ ...a }, { ...b }], closed: false };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const r = Math.min(corner, (x1 - x0) / 2, (y1 - y0) / 2);
  if (shape === 'rect' && r > 0) {
    const n = Math.max(2, Math.ceil((Math.PI / 2) * r / Math.max(0.25, spacing)));
    const points = [];
    // clockwise from the top edge: top-right, bottom-right, bottom-left, top-left corner arcs
    [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]].forEach(([cx, cy, start]) => {
      for (let k = 0; k <= n; k++) {
        const t = ((start + (k / n) * 90) * Math.PI) / 180;
        points.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
      }
    });
    return { points, closed: true };
  }
  if (shape === 'rect') return { points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  // Ramanujan's perimeter, so the steps are never longer than the stamp spacing
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) || 1;
  const n = Math.max(16, Math.ceil(per / Math.max(0.25, spacing)));
  const points = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; points.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }); }
  return { points, closed: true };
}

/** Where the figure lands (its box grown by half the brush size and a margin), for recompositing and undo. */
export function figureBounds(a, b, size) {
  const m = size / 2 + 2;
  const x0 = Math.floor(Math.min(a.x, b.x) - m), y0 = Math.floor(Math.min(a.y, b.y) - m);
  return { x: x0, y: y0, w: Math.ceil(Math.max(a.x, b.x) + m) - x0, h: Math.ceil(Math.max(a.y, b.y) + m) - y0 };
}

/** Points along a line from a to b every `step` px (b included), for Shift+click straight strokes. */
export function linePoints(a, b, step) {
  const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / Math.max(0.25, step)));
  const out = [];
  for (let i = 1; i <= n; i++) { const t = i / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + ((b.p ?? a.p) - a.p) * t }); }
  return out;
}
