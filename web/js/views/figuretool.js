// The Figure tool: drag to draw a straight line, rectangle or ellipse with the brush settings (size, opacity,
// hardness), filled or outlined. The shape is stamped into the stroke canvas on every move and committed like a
// stroke on pen-up, so opacity, the selection, alpha lock, masks and undo behave as for painting.
// Polyline, polygon and the curves are clicked point by point (this.figPoly holds them between clicks, drawn as a
// thin line on the overlay) and stamped when finished: a double click, Enter, or for a closed shape a click on the
// first point. A curve runs smoothly through its points (splinePoints). The Bezier curves are clicked the same way,
// but each press can be dragged to pull out that point's handles (both ways, so the point is smooth); figPoly.ctrl
// holds the anchors (bezier.js). On a vector layer the clicked shapes keep their control points, so the Control
// point tool can change them afterwards.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { constrain, figurePoints, figureBounds, pointsBounds, polyCorners, splinePoints, POLY_SHAPES, SMOOTH_SHAPES, BEZIER_SHAPES } from '../figure.js';
import { curvePoints, cornerCtrl, fitCurve } from '../bezier.js';
import { Painter } from '../painter.js';
import { union } from '../rect.js';
import { toast } from '../ui.js';
import { toScreen, toDoc, matrix } from '../view.js';

const SPACING = 0.1;  // stamp spacing as a share of the brush size
const CLOSE_PX = 8;   // clicking this close (screen px) to a polygon's first corner closes it

export const figureMethods = {
  beginFigure(dp, id, shift, dbl = false) {
    const s = this.settings.figure;
    if (this.figPoly?.ctrl || (!this.figPoly && BEZIER_SHAPES.has(s.figure))) return this.bezierPenDown(dp, id, shift, dbl);
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
    const { points, closed } = figurePoints(s.figure, g.start, b, s.size * SPACING, s.corner, s.sides, s.depth);
    const r = union(figureBounds(g.start, b, s.size), pointsBounds(points, s.size));  // an arrow's head reaches past the box
    const area = union(g.bounds, r);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(area.x, area.y, area.w, area.h);
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

  // ---------- Bezier curves ----------

  /** A press with the Bezier curve: starts the curve or adds an anchor (dragging then pulls its handles), or finishes. */
  bezierPenDown(dp, id, shift, dbl) {
    let p = this.figPoly;
    if (!p) {
      const layer = this.figureTarget();
      if (!layer) return;
      p = this.figPoly = { layer, closed: POLY_SHAPES[this.settings.figure.figure], ctrl: [] };
    } else {
      const first = toScreen(this.view, p.ctrl[0][0], p.ctrl[0][1]), here = toScreen(this.view, dp.x, dp.y);
      const onFirst = p.closed && p.ctrl.length >= 2 && Math.hypot(first.x - here.x, first.y - here.y) <= CLOSE_PX;
      if (dbl || onFirst) return this.finishFigurePoly();
    }
    const last = p.ctrl[p.ctrl.length - 1], q = shift && last ? constrain('line', { x: last[0], y: last[1] }, dp) : dp;
    p.ctrl.push([q.x, q.y, 1, 0, 0, 0, 0]);
    this.gesture = { type: 'bezierpen', tool: 'figure', id, i: p.ctrl.length - 1 };
  },

  /** Dragging after a press: the anchor's out handle follows the pointer, its in handle the other way. */
  bezierPenDrag(dp) {
    const p = this.figPoly, a = p?.ctrl[this.gesture.i];
    if (!a) return;
    const dx = dp.x - a[0], dy = dp.y - a[1], small = Math.hypot(dx, dy) * this.view.zoom < 3;
    a[3] = small ? 0 : -dx; a[4] = small ? 0 : -dy; a[5] = small ? 0 : dx; a[6] = small ? 0 : dy;
  },

  /** Stamps the clicked shape and commits it like a stroke (one undo step). */
  finishFigurePoly() {
    const p = this.figPoly;
    if (!p) return;
    this.figPoly = null;
    const s = this.settings.figure, step = Math.max(0.5, s.size * SPACING);
    let pts, closed, curve;
    if (p.ctrl) {
      if (p.ctrl.length < 2) return this.drawOverlay();
      closed = p.closed;
      curve = { ctrl: p.ctrl, closed };
      pts = curvePoints(p.ctrl, closed, step).map(([x, y]) => ({ x, y }));
      if (closed) pts.pop();  // stampOutline closes it
    } else {
      const corners = polyCorners(p.points, p.closed);
      if (corners.length < 2) return this.drawOverlay();
      closed = p.closed && corners.length > 2;
      pts = p.smooth ? splinePoints(corners, closed, step) : corners;
      // kept on a vector layer as control points: corners as they are, a curve fitted closely
      curve = p.smooth ? { ctrl: fitCurve([...pts, ...(closed ? [pts[0]] : [])].map(q => [q.x, q.y, 1]), 0.25), closed: false }
        : { ctrl: cornerCtrl(corners), closed };
    }
    if (p.layer.vector) { this.commitVectorFigure(p.layer, pts, closed, s, curve); this.colors.used(); this.drawOverlay(); return; }
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
    else if (c === 'backspace' || c === 'delete') { const list = p.ctrl || p.points; list.pop(); if (!list.length) this.figPoly = null; }
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
    if (p.ctrl) return this.drawBezierPen(ctx, p, sx, sy, dpr);
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

  /** The Bezier curve so far on the overlay, a rubber band to the pointer, and the newest point's handles. */
  drawBezierPen(ctx, p, sx, sy, dpr) {
    const ctrl = p.ctrl.map(q => q.slice());
    if (this.pointer && !this.gesture && ctrl.length) {
      const q = toDoc(this.view, this.pointer.x, this.pointer.y), last = ctrl[ctrl.length - 1];
      const r = this.pointerShift ? constrain('line', { x: last[0], y: last[1] }, q) : q;
      ctrl.push([r.x, r.y, 1, 0, 0, 0, 0]);
    }
    const pts = curvePoints(ctrl, p.closed && ctrl.length > 2, 2 / this.view.zoom);
    ctx.save();
    ctx.lineJoin = 'round';
    for (const [color, w] of [['rgba(0,0,0,.6)', 3 * dpr], ['#6ea8ff', 1.5 * dpr]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x, y), sy(x, y)) : ctx.moveTo(sx(x, y), sy(x, y))));
      ctx.stroke();
    }
    const last = p.ctrl[p.ctrl.length - 1];
    if (last) {
      for (const [hx, hy] of [[last[3], last[4]], [last[5], last[6]]]) {
        if (!hx && !hy) continue;
        const x0 = sx(last[0], last[1]), y0 = sy(last[0], last[1]), x1 = sx(last[0] + hx, last[1] + hy), y1 = sy(last[0] + hx, last[1] + hy);
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.fillStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(x1, y1, 3 * dpr, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
    for (const q of p.ctrl) { const x = sx(q[0], q[1]), y = sy(q[0], q[1]); ctx.beginPath(); ctx.rect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  },

  endFigure() {
    const g = this.gesture;
    if (g.layer.vector) this.commitVectorFigure(g.layer, g.points, g.closed, g.s);
    else this.commitStroke(g.layer, g.bounds, 'Figure');
    if (g.layer.kind !== 'mask') this.colors.used();
  },
};
