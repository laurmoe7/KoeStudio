// Guides, perspective rulers and snapping (pure, tested).
//
// doc.rulers = { guides: [{axis: 'h'|'v', pos}], perspective: {points: [{x, y}] (1-3 vanishing points)} | null,
//                visible, snap, grid: {show, size, div, snap} }. A horizontal guide ('h') is the line y = pos; a
//                vertical one ('v') is x = pos. The grid has a line every `size` px, split into `div` parts, from
//                the top-left corner; with grid.snap a stroke starting near a grid line can follow it.
// While snapping is on, a stroke follows one line: once the pen has moved a little, the candidate line closest
// to the stroke's direction is picked (towards a vanishing point, the perspective's horizontal/vertical, or a
// guide the stroke started on), and every point is projected onto it.
//
// doc.rulers.shapes holds the straight-line and concentric rulers:
//   {type: 'line', x1, y1, x2, y2}: a stroke started near the line (or its extension) follows it;
//   {type: 'ellipse', x, y, rx, ry, angle}: every stroke follows the ellipse with the same centre, shape and turn
//   that passes through where it started (concentric circles when rx = ry).

import { defaultSymmetry, sanitizeSymmetry } from './symmetry.js';

export const MAX_GUIDES = 100;
export const MAX_SHAPES = 50;
const FAR = 200000;  // vanishing points may sit far outside the canvas (20 x the largest canvas side)

export function defaultRulers() {
  return { guides: [], perspective: null, visible: true, snap: true, grid: defaultGrid(), symmetry: defaultSymmetry(), shapes: [] };
}

const fin = v => (v !== null && v !== '' && Number.isFinite(+v) ? Math.max(-FAR, Math.min(FAR, +v)) : null);
const r2 = v => Math.round(v * 100) / 100;

/** A straight-line or concentric ruler checked and rounded, or null when it is unusable. */
export function sanitizeShape(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'line') {
    const [x1, y1, x2, y2] = [s.x1, s.y1, s.x2, s.y2].map(fin);
    if ([x1, y1, x2, y2].includes(null) || (x1 === x2 && y1 === y2)) return null;
    return { type: 'line', x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2) };
  }
  if (s.type === 'ellipse') {
    const [x, y, rx, ry] = [s.x, s.y, s.rx, s.ry].map(fin);
    if ([x, y, rx, ry].includes(null) || rx < 1 || ry < 1) return null;
    const a = fin(s.angle) ?? 0, turn = Math.atan2(Math.sin(a), Math.cos(a));  // kept within -pi..pi
    return { type: 'ellipse', x: r2(x), y: r2(y), rx: r2(rx), ry: r2(ry), angle: Math.round(turn * 1e6) / 1e6 || 0 };
  }
  return null;
}

export const defaultGrid = () => ({ show: false, size: 100, div: 4, snap: false });

export function sanitizeGrid(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const int = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.round(+v))) : def);
  return { show: g.show === true, size: int(g.size, 2, 5000, 100), div: int(g.div, 1, 20, 4), snap: g.snap === true };
}

/** Spacing between neighbouring grid lines (subdivisions included). */
export const gridStep = g => g.size / g.div;

/** pt moved onto the nearest grid line across and down, each only when it is within tol (for selections and figures). */
export function snapToGrid(g, pt, tol) {
  const step = gridStep(g), sx = Math.round(pt.x / step) * step + 0, sy = Math.round(pt.y / step) * step + 0;  // + 0 turns -0 into 0
  return { ...pt, x: Math.abs(pt.x - sx) <= tol ? sx : pt.x, y: Math.abs(pt.y - sy) <= tol ? sy : pt.y };
}

export function sanitizeRulers(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = v => (Number.isFinite(+v) ? Math.max(-FAR, Math.min(FAR, +v)) : null);
  const guides = (Array.isArray(r.guides) ? r.guides : [])
    .filter(g => g && (g.axis === 'h' || g.axis === 'v') && num(g.pos) !== null)
    .slice(0, MAX_GUIDES)
    .map(g => ({ axis: g.axis, pos: Math.round(num(g.pos)) }));
  let perspective = null;
  const pts = Array.isArray(r.perspective?.points) ? r.perspective.points.filter(p => num(p?.x) !== null && num(p?.y) !== null) : [];
  if (pts.length) perspective = { points: pts.slice(0, 3).map(p => ({ x: num(p.x), y: num(p.y) })) };
  const shapes = (Array.isArray(r.shapes) ? r.shapes : []).map(sanitizeShape).filter(Boolean).slice(0, MAX_SHAPES);
  return { guides, perspective, visible: r.visible !== false, snap: r.snap !== false, grid: sanitizeGrid(r.grid), symmetry: sanitizeSymmetry(r.symmetry), shapes };
}

/** Vanishing points for a new 1-, 2- or 3-point perspective ruler on a w x h canvas (horizon at 40% height). */
export function newPerspective(n, w, h) {
  const y = Math.round(h * 0.4);
  if (n === 1) return { points: [{ x: Math.round(w / 2), y }] };
  const two = [{ x: Math.round(-w * 0.15), y }, { x: Math.round(w * 1.15), y }];
  return { points: n === 2 ? two : [...two, { x: Math.round(w / 2), y: Math.round(h * 1.8) }] };
}

/** A tick spacing (1, 2 or 5 times a power of ten) at least `min` doc pixels. */
export function niceStep(min) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(min, 1e-9))));
  for (const m of [1, 2, 5, 10]) if (m * p >= min) return m * p;
  return 10 * p;
}

/** Multiples of step from a to b (in either order). */
export function ticks(a, b, step) {
  const lo = Math.min(a, b), hi = Math.max(a, b), out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi && out.length < 2000; v += step) out.push(Math.round(v * 1e6) / 1e6 || 0);  // || 0 turns -0 into 0
  return out;
}

const unit = (x, y) => { const l = Math.hypot(x, y); return l ? { x: x / l, y: y / l } : null; };

/** The concentric ellipse of ruler e through pt, as a snap candidate ({p, d: tangent at pt, kind, e}); null at the centre. */
export function concentricThrough(e, pt) {
  const cos = Math.cos(e.angle), sin = Math.sin(e.angle);
  const dx = pt.x - e.x, dy = pt.y - e.y;
  const u = (dx * cos + dy * sin) / e.rx, v = (-dx * sin + dy * cos) / e.ry;
  const k = Math.hypot(u, v);
  if (k < 1e-9) return null;
  const tx = -v * e.rx, ty = u * e.ry;  // tangent in the ellipse's own (unturned) frame
  const d = unit(tx * cos - ty * sin, tx * sin + ty * cos);
  return { p: pt, d, kind: 'ellipse', e: { x: e.x, y: e.y, rx: e.rx, ry: e.ry, cos, sin, k } };
}

/** Lines a stroke starting at `start` may snap to: [{p: point on the line, d: unit direction, kind}]. Straight-line
 *  rulers count within lineTol (default guideTol); concentric rulers always do. */
export function snapCandidates(rulers, start, guideTol, lineTol = guideTol) {
  const out = [];
  const g = rulers?.grid;
  if (g?.show && g.snap) {  // the nearest grid line each way, like a guide
    const step = gridStep(g), gy = Math.round(start.y / step) * step, gx = Math.round(start.x / step) * step;
    if (Math.abs(start.y - gy) <= guideTol) out.push({ p: { x: start.x, y: gy }, d: { x: 1, y: 0 }, kind: 'grid' });
    if (Math.abs(start.x - gx) <= guideTol) out.push({ p: { x: gx, y: start.y }, d: { x: 0, y: 1 }, kind: 'grid' });
  }
  if (!rulers?.visible) return out;
  const pts = rulers.perspective?.points || [];
  for (const vp of pts) {
    const d = unit(vp.x - start.x, vp.y - start.y);
    if (d) out.push({ p: start, d, kind: 'perspective' });
  }
  if (pts.length === 1) out.push({ p: start, d: { x: 1, y: 0 }, kind: 'perspective' }, { p: start, d: { x: 0, y: 1 }, kind: 'perspective' });
  if (pts.length === 2) out.push({ p: start, d: { x: 0, y: 1 }, kind: 'perspective' });
  for (const g of rulers.guides) {
    if (g.axis === 'h' && Math.abs(start.y - g.pos) <= guideTol) out.push({ p: { x: start.x, y: g.pos }, d: { x: 1, y: 0 }, kind: 'guide' });
    if (g.axis === 'v' && Math.abs(start.x - g.pos) <= guideTol) out.push({ p: { x: g.pos, y: start.y }, d: { x: 0, y: 1 }, kind: 'guide' });
  }
  for (const s of rulers.shapes || []) {
    if (s.type === 'line') {
      const d = unit(s.x2 - s.x1, s.y2 - s.y1);
      if (!d) continue;
      const p = project({ p: { x: s.x1, y: s.y1 }, d }, start);
      if (Math.hypot(p.x - start.x, p.y - start.y) <= lineTol) out.push({ p, d, kind: 'line' });
    } else if (s.type === 'ellipse') {
      const c = concentricThrough(s, start);
      if (c) out.push(c);
    }
  }
  return out;
}

const LOCAL = new Set(['guide', 'grid', 'line']);  // lines the stroke started on (the others reach everywhere)
const ALONG = Math.cos(Math.PI / 6);               // moving within 30° of a line the stroke started on keeps to it

/** The candidate line closest in direction to the movement from start to cur; null without candidates. A guide, grid
 *  line or straight-line ruler the stroke started on wins when the stroke heads along it, so a concentric or
 *  perspective ruler does not take over strokes drawn on purpose along a nearby line. */
export function pickLine(cands, start, cur) {
  const m = unit(cur.x - start.x, cur.y - start.y);
  if (!m || !cands.length) return null;
  const local = cands.filter(c => LOCAL.has(c.kind) && Math.abs(m.x * c.d.x + m.y * c.d.y) >= ALONG);
  let best = null, bestDot = -1;
  for (const c of local.length ? local : cands) {
    const dot = Math.abs(m.x * c.d.x + m.y * c.d.y);
    if (dot > bestDot) { best = c; bestDot = dot; }
  }
  return best;
}

/** The point on line nearest to pt; on a concentric ellipse, the point in the same direction from the centre (measured
 *  in the ellipse's own frame, so a circle gives the nearest point too). */
export function project(line, pt) {
  if (line.e) {
    const { x, y, rx, ry, cos, sin, k } = line.e, dx = pt.x - x, dy = pt.y - y;
    const th = Math.atan2((-dx * sin + dy * cos) / ry, (dx * cos + dy * sin) / rx);
    const ox = k * rx * Math.cos(th), oy = k * ry * Math.sin(th);
    return { x: x + ox * cos - oy * sin, y: y + ox * sin + oy * cos };
  }
  const t = (pt.x - line.p.x) * line.d.x + (pt.y - line.p.y) * line.d.y;
  return { x: line.p.x + line.d.x * t, y: line.p.y + line.d.y * t };
}

/** Index of the guide within tol doc pixels of pt (nearest first), or -1. */
export function guideAt(guides, pt, tol) {
  let best = -1, bestDist = tol;
  guides.forEach((g, i) => {
    const dist = Math.abs(g.axis === 'h' ? pt.y - g.pos : pt.x - g.pos);
    if (dist <= bestDist) { best = i; bestDist = dist; }
  });
  return best;
}

const SNAP_TURN = Math.PI / 12;  // Shift turns straight rulers and ellipse axes in 15° steps
const snapAngle = (dx, dy) => {
  const len = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / SNAP_TURN) * SNAP_TURN;
  return { x: Math.cos(a) * len, y: Math.sin(a) * len };
};

/** The drag handles of a straight-line or concentric ruler: [{h, x, y}]. 'mid' / 'c' move the whole ruler. */
export function shapeHandles(s) {
  if (s.type === 'line') return [{ h: 'a', x: s.x1, y: s.y1 }, { h: 'b', x: s.x2, y: s.y2 }, { h: 'mid', x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }];
  const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
  return [{ h: 'c', x: s.x, y: s.y }, { h: 'rx', x: s.x + s.rx * cos, y: s.y + s.rx * sin }, { h: 'ry', x: s.x - s.ry * sin, y: s.y + s.ry * cos }];
}

/** The ruler with handle h dragged to pt. Shift keeps a straight ruler at 15° steps and makes an ellipse a circle. */
export function dragShapeHandle(s, h, pt, shift = false) {
  if (s.type === 'line') {
    if (h === 'mid') {
      const dx = pt.x - (s.x1 + s.x2) / 2, dy = pt.y - (s.y1 + s.y2) / 2;
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    }
    const [ox, oy] = h === 'a' ? [s.x2, s.y2] : [s.x1, s.y1];
    const v = shift ? snapAngle(pt.x - ox, pt.y - oy) : { x: pt.x - ox, y: pt.y - oy };
    return h === 'a' ? { ...s, x1: ox + v.x, y1: oy + v.y } : { ...s, x2: ox + v.x, y2: oy + v.y };
  }
  if (h === 'c') return { ...s, x: pt.x, y: pt.y };
  const dx = pt.x - s.x, dy = pt.y - s.y;
  if (h === 'rx') {
    const v = shift ? snapAngle(dx, dy) : { x: dx, y: dy };
    const rx = Math.max(1, Math.hypot(v.x, v.y));
    return { ...s, rx, ry: shift ? rx : s.ry, angle: Math.atan2(v.y, v.x) };
  }
  const ry = Math.max(1, Math.abs(-dx * Math.sin(s.angle) + dy * Math.cos(s.angle)));  // distance along the second axis
  return { ...s, ry, rx: shift ? ry : s.rx };
}

/** A new ruler dragged out from a to b: a straight line from a to b, or a circle centred on a through b. */
export function shapeFromDrag(kind, a, b, shift = false) {
  if (kind === 'ellipse') {
    const r = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    return { type: 'ellipse', x: a.x, y: a.y, rx: r, ry: r, angle: 0 };
  }
  const v = shift ? snapAngle(b.x - a.x, b.y - a.y) : { x: b.x - a.x, y: b.y - a.y };
  return { type: 'line', x1: a.x, y1: a.y, x2: a.x + v.x, y2: a.y + v.y };
}

/** The ruler handle within tol of pt, nearest first: {index, h} or null. */
export function shapeHandleAt(shapes, pt, tol) {
  let best = null, bestDist = tol;
  shapes.forEach((s, index) => {
    for (const hd of shapeHandles(s)) {
      const dist = Math.hypot(hd.x - pt.x, hd.y - pt.y);
      if (dist <= bestDist) { best = { index, h: hd.h }; bestDist = dist; }
    }
  });
  return best;
}
