// Guides, perspective rulers and snapping (pure, tested).
//
// doc.rulers = { guides: [{axis: 'h'|'v', pos}], perspective: {points: [{x, y}] (1-3 vanishing points)} | null,
//                visible, snap }. A horizontal guide ('h') is the line y = pos; a vertical one ('v') is x = pos.
// While snapping is on, a stroke follows one line: once the pen has moved a little, the candidate line closest
// to the stroke's direction is picked (towards a vanishing point, the perspective's horizontal/vertical, or a
// guide the stroke started on), and every point is projected onto it.

export const MAX_GUIDES = 100;
const FAR = 200000;  // vanishing points may sit far outside the canvas (20 x the largest canvas side)

export function defaultRulers() {
  return { guides: [], perspective: null, visible: true, snap: true };
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
  return { guides, perspective, visible: r.visible !== false, snap: r.snap !== false };
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

/** Lines a stroke starting at `start` may snap to: [{p: point on the line, d: unit direction, kind}]. */
export function snapCandidates(rulers, start, guideTol) {
  if (!rulers?.visible) return [];
  const out = [];
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
  return out;
}

/** The candidate line closest in direction to the movement from start to cur; null without candidates. */
export function pickLine(cands, start, cur) {
  const m = unit(cur.x - start.x, cur.y - start.y);
  if (!m || !cands.length) return null;
  let best = null, bestDot = -1;
  for (const c of cands) {
    const dot = Math.abs(m.x * c.d.x + m.y * c.d.y);
    if (dot > bestDot) { best = c; bestDot = dot; }
  }
  return best;
}

/** The point on line nearest to pt. */
export function project(line, pt) {
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
