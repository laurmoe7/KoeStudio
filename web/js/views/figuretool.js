// The Figure tool: drag to draw a straight line, rectangle or ellipse with the brush settings (size, opacity,
// hardness), filled or outlined. The shape is stamped into the stroke canvas on every move and committed like a
// stroke on pen-up, so opacity, the selection, alpha lock, masks and undo behave as for painting.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { constrain, figurePoints, figureBounds } from '../figure.js';
import { Painter } from '../painter.js';
import { union } from '../rect.js';

const SPACING = 0.1;  // stamp spacing as a share of the brush size

export const figureMethods = {
  beginFigure(dp, id, shift) {
    const s = this.settings.figure, layer = this.target('draw on');
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
    const { points, closed } = figurePoints(s.figure, g.start, b, s.size * SPACING);
    if (s.fill && closed) {
      ctx.fillStyle = this.inkFor(g.layer);
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
    // stamp along the outline at an even spacing, carrying the distance over from one segment to the next
    const step = Math.max(0.25, s.size * SPACING), segs = closed ? points.length : points.length - 1;
    let next = 0, walked = 0;
    for (let i = 0; i < segs; i++) {
      const p = points[i], q = points[(i + 1) % points.length], len = Math.hypot(q.x - p.x, q.y - p.y);
      while (len > 0 && next <= walked + len) {
        const t = (next - walked) / len;
        g.painter.dab(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, s.size, 1);
        next += step;
      }
      walked += len;
    }
    if (walked === 0) g.painter.dab(points[0].x, points[0].y, s.size, 1);  // a click: one dab
    ctx.restore();
    this.sel.clipCanvas(ctx, area);
    g.bounds = area;
    this.updateComp(area);
    this.requestRender();
  },

  endFigure() {
    const g = this.gesture;
    this.commitStroke(g.layer, g.bounds, 'Figure');
    if (g.layer.kind !== 'mask') this.colors.used();
  },
};
