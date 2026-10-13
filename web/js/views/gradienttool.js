// Gradient tool: drag from where the gradient starts to where it ends (Shift snaps the angle). Fills the
// selection, or the whole layer, through the stroke canvas, so opacity, alpha lock, masks and undo work as for
// painting. Editor methods (mixed into Editor.prototype in editor.js).

import { gradientStops, snapEnd } from '../gradient.js';
import { clip } from '../rect.js';
import { matrix } from '../view.js';

export const gradientMethods = {
  beginGradient(dp, id) {
    const t = this.target('fill');
    if (!t) return;
    const d = this.doc, s = this.settings.gradient;
    const area = this.sel.active ? this.sel.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    this.gesture = { type: 'gradient', tool: 'gradient', id, t, s, area, start: dp, end: dp };
    this.live = { layer: t, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(t, false) };
  },

  gradientDrag(dp, shift) {
    const g = this.gesture;
    g.end = shift ? snapEnd(g.start, dp) : dp;
    this.paintGradient();
    this.drawOverlay();
  },

  paintGradient() {
    const g = this.gesture, ctx = this.strokeCtx, { start, end, area, s } = g;
    this.resetStroke();
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (len < 0.5) { this.updateComp(area); this.requestRender(); return; }
    // on a mask only coverage counts: the main colour end hides fully, the other end hides nothing
    const stops = g.t.kind === 'mask'
      ? (s.colors.startsWith('main') ? [[0, '#000000'], [1, 'rgba(0,0,0,0)']] : [[0, 'rgba(0,0,0,0)'], [1, '#000000']])
      : gradientStops(s.colors, this.colors.main, this.colors.sub);
    const grad = s.shape === 'radial'
      ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, len)
      : ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    for (const [o, c] of stops) grad.addColorStop(o, c);
    ctx.fillStyle = grad;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    this.sel.clipCanvas(ctx, area);
    this.updateComp(area);
    this.requestRender();
  },

  endGradient() {
    const g = this.gesture;
    if (Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) < 0.5) {
      this.live = null;
      this.updateComp(g.area);
      this.requestRender();
      return;
    }
    this.commitStroke(g.t, clip(g.area, this.doc.width, this.doc.height), 'Gradient');
    if (g.t.kind !== 'mask') this.colors.used();
  },

  /** The drag line while making a gradient. */
  drawGradientOverlay(ctx) {
    const g = this.gesture;
    if (g?.type !== 'gradient') return;
    const dpr = this.dpr || 1;
    const [a, b, c, d, e, f] = matrix(this.view);
    const sp = p => [(a * p.x + c * p.y + e) * dpr, (b * p.x + d * p.y + f) * dpr];
    ctx.save();
    for (const [color, w] of [['rgba(0,0,0,.6)', 3], ['#fff', 1.5]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w * dpr;
      ctx.beginPath(); ctx.moveTo(...sp(g.start)); ctx.lineTo(...sp(g.end)); ctx.stroke();
    }
    for (const p of [g.start, g.end]) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3d6fd1';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(...sp(p), 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  },
};
