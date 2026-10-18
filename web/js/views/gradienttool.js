// Gradient tool: drag from where the gradient starts to where it ends (Shift snaps the angle). Fills the
// selection, or the whole layer, through the stroke canvas, so opacity, alpha lock, masks and undo work as for
// painting. Editor methods (mixed into Editor.prototype in editor.js).

import { gradientStops, snapEnd, gradientReach, repeatStops, reflectStops, diamondQuarters, ditherData } from '../gradient.js';
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
    let stops = g.t.kind === 'mask'
      ? (!s.colors.startsWith('sub') && !s.colors.startsWith('clear') ? [[0, '#000000'], [1, 'rgba(0,0,0,0)']] : [[0, 'rgba(0,0,0,0)'], [1, '#000000']])
      : gradientStops(s.colors, this.colors.main, this.colors.sub, this.userGrads());
    // Reflected: one straight gradient from the start mirrored behind it to the end, with its stops both ways
    const shape = s.shape === 'reflected' ? 'linear' : s.shape;
    const from = s.shape === 'reflected' ? { x: 2 * start.x - end.x, y: 2 * start.y - end.y } : start;
    if (s.shape === 'reflected') stops = reflectStops(stops);
    let a = from, b = end, r = len;
    const span = Math.hypot(end.x - from.x, end.y - from.y);
    if ((s.repeat === 'repeat' || s.repeat === 'mirror') && shape !== 'conic') {  // stretch the gradient over the area, with copies of the stops
      const { before, after } = gradientReach(shape, from, end, area), dx = end.x - from.x, dy = end.y - from.y;
      const reps = before + 1 + after;
      stops = repeatStops(stops, s.repeat, reps, before, 1 / (span * reps));
      a = { x: from.x - before * dx, y: from.y - before * dy };
      b = { x: end.x + after * dx, y: end.y + after * dy };
      r = len * (1 + after);
    }
    const fill = grad => {
      for (const [o, c] of stops) grad.addColorStop(o, c);
      ctx.fillStyle = grad;
    };
    if (shape === 'diamond') {  // four straight gradients, one per quarter (diamondQuarters)
      const far = 2 * (Math.hypot(area.w, area.h) + Math.hypot(start.x - area.x, start.y - area.y));
      ctx.save();
      for (const q of diamondQuarters(start, end, r, far)) {
        ctx.beginPath();
        q.poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.save();
        ctx.clip();
        fill(ctx.createLinearGradient(q.from.x, q.from.y, q.to.x, q.to.y));
        ctx.fillRect(area.x, area.y, area.w, area.h);
        ctx.restore();
      }
      ctx.restore();
    } else {
      fill(shape === 'radial' ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, r)
        : shape === 'conic' ? ctx.createConicGradient(Math.atan2(end.y - start.y, end.x - start.x), start.x, start.y)
          : ctx.createLinearGradient(a.x, a.y, b.x, b.y));
      ctx.fillRect(area.x, area.y, area.w, area.h);
    }
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
    const r = clip(g.area, this.doc.width, this.doc.height);
    if (g.s.dither && r) {  // only once, at the end: it is too faint to matter while dragging
      const img = this.strokeCtx.getImageData(r.x, r.y, r.w, r.h);
      this.strokeCtx.putImageData(new ImageData(ditherData(img.data, r.w, r.h, r.x, r.y), r.w, r.h), r.x, r.y);
    }
    this.commitStroke(g.t, r, 'Gradient');
    if (g.t.kind !== 'mask') this.colors.used();
  },

  /** The colour strip at the top of the Gradient tool's settings (over a checker, so transparent ends show). */
  drawGradientStrip() {
    const c = this.root.querySelector('.tool-props .grad-strip');
    if (!c || this.tool !== 'gradient') return;
    const dpr = window.devicePixelRatio || 1, w = Math.round((c.clientWidth || 200) * dpr), h = Math.round(18 * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d'), s = this.settings.gradient, cell = 6 * dpr;
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = ((x + y) / cell) % 2 ? '#c8c8c8' : '#ffffff';
      ctx.fillRect(x, y, cell, cell);
    }
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (const [o, col] of gradientStops(s.colors, this.colors.main, this.colors.sub, this.userGrads())) grad.addColorStop(o, col);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
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
