// The Figure tool: drag to draw a straight line, rectangle or ellipse with the brush settings (size, opacity,
// hardness), filled or outlined. The shape is stamped into the stroke canvas on every move and committed like a
// stroke on pen-up, so opacity, the selection, alpha lock, masks and undo behave as for painting.
// Polyline, polygon and the curves are clicked point by point (this.figPoly holds them between clicks, drawn as a
// thin line on the overlay) and stamped when finished: a double click, Enter, or for a closed shape a click on the
// first point. A curve runs smoothly through its points (splinePoints).
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { constrain, figurePoints, figureBounds, pointsBounds, polyCorners, splinePoints, POLY_SHAPES, SMOOTH_SHAPES } from '../figure.js';
import { Painter } from '../painter.js';
import { union } from '../rect.js';
import { toast } from '../ui.js';
import { toScreen, toDoc, matrix } from '../view.js';

const SPACING = 0.1;  // stamp spacing as a share of the brush size
const CLOSE_PX = 8;   // clicking this close (screen px) to a polygon's first corner closes it

export const figureMethods = {
  beginFigure(dp, id, shift, dbl = false) {
    const s = this.settings.figure;
    if (s.figure in POLY_SHAPES || this.figPoly) return this.figurePolyClick(dp, shift, dbl);
    const layer = this.figureTarget();
    if (!layer) return;
    this.resetStroke();
    this.gesture = { type: 'figure', tool: 'figure', id, s, layer, start: dp, cur: dp, shift, bounds: null,
      painter: new Painter(this.strokeCtx, { color: this.inkFor(layer), hardness: s.hardness }) };
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(layer, false) };
    this.figureDraw();
  },

  figureDrag(dp, shift) {
    const g = this.gesture;
    g.cur = dp;
    g.shift = shift;
    this.figureDraw();
  },

  /** Redraws the whole shape into the stroke canvas and recomposites what it covered before and now. */
  figureDraw() {
    const g = this.gesture, s = g.s, ctx = this.strokeCtx;
    const b = g.shift ? constrain(s.figure, g.start, g.cur) : g.cur;
    const r = figureBounds(g.start, b, s.size);
    const area = union(g.bounds, r);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(area.x, area.y, area.w, area.h);
    const { points, closed } = figurePoints(s.figure, g.start, b, s.size * SPACING, s.corner, s.sides, s.depth);
    g.points = points;
    g.closed = closed;
    this.stampOutline(g.painter, s, g.layer, points, closed);
    ctx.restore();
    this.sel.clipCanvas(ctx, area);
    g.bounds = area;
    this.updateComp(area);
    this.requestRender();
  },

  /** Fills (when asked and closed) and stamps the brush along an outline, at an even spacing. */
  stampOutline(painter, s, layer, points, closed) {
    const ctx = this.strokeCtx;
    if (s.fill && closed) {
      ctx.fillStyle = this.inkFor(layer);
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
    // carry the distance over from one segment to the next
    const step = Math.max(0.25, s.size * SPACING), segs = closed ? points.length : points.length - 1;
    let next = 0, walked = 0;
    for (let i = 0; i < segs; i++) {
      const p = points[i], q = points[(i + 1) % points.length], len = Math.hypot(q.x - p.x, q.y - p.y);
      while (len > 0 && next <= walked + len) {
        const t = (next - walked) / len;
        painter.dab(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, s.size, 1);
        next += step;
      }
      walked += len;
    }
    if (walked === 0) painter.dab(points[0].x, points[0].y, s.size, 1);  // a click: one dab
  },

  // ---------- polyline and polygon ----------

  /** The layer a figure goes on: vector layers take outlines (kept as lines), not filled shapes. */
  figureTarget() {
    const layer = this.target('draw on', { vector: true });
    if (layer?.vector && this.settings.figure.fill) {
      toast('A vector layer keeps lines, not filled shapes. Untick "Fill the shape", or draw it on an ordinary layer.');
      return null;
    }
    return layer;
  },

  /** A click with the polyline/polygon figure: the first starts the shape, later ones add corners or finish it. */
  figurePolyClick(dp, shift, dbl) {
    const p = this.figPoly;
    if (!p) {
      const layer = this.figureTarget();
      const shape = this.settings.figure.figure;
      if (layer) this.figPoly = { layer, closed: POLY_SHAPES[shape], smooth: SMOOTH_SHAPES.has(shape), points: [{ x: dp.x, y: dp.y }] };
      return;
    }
    const last = p.points[p.points.length - 1], q = shift ? constrain('line', last, dp) : { x: dp.x, y: dp.y };
    const first = toScreen(this.view, p.points[0].x, p.points[0].y), here = toScreen(this.view, q.x, q.y);
    const onFirst = p.closed && p.points.length >= 3 && Math.hypot(first.x - here.x, first.y - here.y) <= CLOSE_PX;
    if (dbl || onFirst) return this.finishFigurePoly();
    p.points.push(q);
  },

  /** Stamps the clicked shape and commits it like a stroke (one undo step). */
  finishFigurePoly() {
    const p = this.figPoly;
    if (!p) return;
    this.figPoly = null;
    const corners = polyCorners(p.points, p.closed);
    if (corners.length < 2) return this.drawOverlay();
    const s = this.settings.figure, closed = p.closed && corners.length > 2;
    const pts = p.smooth ? splinePoints(corners, closed, Math.max(0.5, s.size * SPACING)) : corners;
    if (p.layer.vector) { this.commitVectorFigure(p.layer, pts, closed, s); this.colors.used(); this.drawOverlay(); return; }
    this.resetStroke();
    const ctx = this.strokeCtx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.stampOutline(new Painter(ctx, { color: this.inkFor(p.layer), hardness: s.hardness }), s, p.layer, pts, closed);
    ctx.restore();
    const area = pointsBounds(pts, s.size);
    this.sel.clipCanvas(ctx, area);
    this.live = { layer: p.layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(p.layer, false) };
    this.commitStroke(p.layer, area, 'Figure');
    if (p.layer.kind !== 'mask') this.colors.used();
    this.drawOverlay();
  },

  cancelFigurePoly() {
    if (!this.figPoly) return;
    this.figPoly = null;
    this.drawOverlay();
  },

  /** Keys while a polyline/polygon is being clicked; true when the key was used. */
  onFigurePolyKey(c) {
    const p = this.figPoly;
    if (!p) return false;
    if (c === 'enter') this.finishFigurePoly();
    else if (c === 'escape') this.cancelFigurePoly();
    else if (c === 'backspace' || c === 'delete') { p.points.pop(); if (!p.points.length) this.figPoly = null; }
    else return false;
    this.drawOverlay();
    return true;
  },

  /** The shape being clicked, on the overlay: its corners so far and a rubber band to the pointer. */
  drawFigurePoly(ctx) {
    const p = this.figPoly;
    if (!p) return;
    const dpr = this.dpr || 1, [a, b, c, d, e, f] = matrix(this.view);
    const sx = (x, y) => (a * x + c * y + e) * dpr, sy = (x, y) => (b * x + d * y + f) * dpr;
    let pts = p.points.slice();
    if (this.pointer && !this.gesture) {
      const q = toDoc(this.view, this.pointer.x, this.pointer.y), last = pts[pts.length - 1];
      pts.push(this.pointerShift ? constrain('line', last, q) : q);
    }
    if (p.smooth) pts = splinePoints(polyCorners(pts, false), p.closed && pts.length > 2, 2 / this.view.zoom);  // the curve as it will be
    ctx.save();
    ctx.lineJoin = 'round';
    for (const [color, w] of [['rgba(0,0,0,.6)', 3 * dpr], ['#6ea8ff', 1.5 * dpr]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(sx(q.x, q.y), sy(q.x, q.y)) : ctx.moveTo(sx(q.x, q.y), sy(q.x, q.y))));
      if (p.closed && pts.length > 2) ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
    for (const q of p.points) { ctx.beginPath(); ctx.arc(sx(q.x, q.y), sy(q.x, q.y), 3 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  },

  endFigure() {
    const g = this.gesture;
    if (g.layer.vector) this.commitVectorFigure(g.layer, g.points, g.closed, g.s);
    else this.commitStroke(g.layer, g.bounds, 'Figure');
    if (g.layer.kind !== 'mask') this.colors.used();
  },
};
