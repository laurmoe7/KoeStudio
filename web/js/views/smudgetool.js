// The Smudge tool (J), Lasso fill and Fill gaps (G, after Fill and Gradient), as Editor methods.
//
// Smudge changes the layer directly dab by dab (it has to read what earlier dabs left), through a pixel cache
// (directpaint.js); on pen-up the changed rectangle becomes one undo step, and outside the selection the old
// pixels are put back (softly where it is feathered). Lasso fill draws the enclosed shape into the stroke canvas
// and commits it like a stroke, so opacity, alpha lock, masks and undo behave as for painting. Fill gaps (Clip Studio
// Paint's Paint unfilled area) shows the traced band in the stroke canvas, then on pen-up replaces it with the
// areas wholly inside it (enclosedAreas in fill.js) and commits that the same way.

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { readPixels } from '../doc.js';
import { enclosedAreas } from '../fill.js';
import { hexToRgb } from '../color.js';
import { clip, union } from '../rect.js';
import { toast } from '../ui.js';
import { smudgeDab } from '../smudge.js';
import { symmetryStamps } from '../symmetry.js';

export const smudgeMethods = {
  beginSmudge(pt, id) {
    const s = this.settings.smudge, layer = this.target('smudge');
    if (!layer) return;
    const d = this.doc;
    const sizeAt = p => stampAt({ ...s, flow: s.strength }, p).size;
    this.gesture = { type: 'smudge', tool: 'smudge', id, s, layer, cache: this.pixelCache(layer.canvas), bounds: null, sizeAt, last: pt,
      smoother: new Smoother(s.smoothing), path: new StampPath(sizeAt, s.spacing), bufs: null };
    this.smudgePoint(pt);
  },

  smudgePoint(pt) {
    const g = this.gesture, s = g.s, d = this.doc;
    g.last = pt;
    const stamps = g.path.add(g.smoother.add(pt));
    if (!stamps.length) return;
    // each symmetric copy of the stroke carries its own colour
    const per = symmetryStamps(this.doc.rulers.symmetry, [stamps[0]], d.width, d.height).length;
    const all = symmetryStamps(this.doc.rulers.symmetry, stamps, d.width, d.height);
    g.bufs ||= Array(per).fill(null);
    all.forEach((st, k) => {
      const copy = k % per;
      const { size, flow } = stampAt({ ...s, flow: s.strength }, st.p);
      const dd = Math.max(2, Math.round(size)), x0 = Math.round(st.x - dd / 2), y0 = Math.round(st.y - dd / 2);
      const img = g.cache.get(x0, y0, dd, dd);
      let buf = g.bufs[copy];
      if (!buf || buf.d !== dd) {  // first dab (or the size changed with pressure): pick up what is here
        buf = g.bufs[copy] = { d: dd, data: new Uint8ClampedArray(img) };
        return;
      }
      smudgeDab(img, buf.data, dd, flow, s.hardness, g.layer.alphaLock);
      g.cache.set(x0, y0, dd, dd, img);
    });
    const r = stampBounds(all, g.sizeAt);
    g.bounds = union(g.bounds, r);
    this.flushDirect(g, r);
  },

  endSmudge() { this.endDirect(this.gesture, 'Smudge'); },

  // ---------- lasso fill ----------

  beginLassoFill(pt, id) {
    const layer = this.target('fill');
    if (!layer) return;
    this.resetStroke();
    this.gesture = { type: 'lassofill', tool: 'lassofill', id, layer, points: [pt], bounds: null };
    const s = this.settings.lassofill;
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(layer, s.lassoErase) };
  },

  lassoFillDrag(pt) {
    const g = this.gesture, last = g.points[g.points.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) * this.view.zoom < 2) return;
    g.points.push(pt);
    this.lassoFillDraw();
  },

  /** The enclosed shape (and its symmetric copies) in the main colour, in the stroke canvas. */
  lassoFillDraw() {
    const g = this.gesture, d = this.doc, ctx = this.strokeCtx;
    const pts = g.points;
    const copies = symmetryStamps(d.rulers.symmetry, pts, d.width, d.height);
    const per = copies.length / pts.length;
    let r = null;
    for (const p of copies) r = union(r, { x: Math.floor(p.x) - 2, y: Math.floor(p.y) - 2, w: 5, h: 5 });
    const area = union(g.bounds, r);
    ctx.clearRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = this.inkFor(g.layer);
    for (let k = 0; k < per; k++) {
      ctx.beginPath();
      pts.forEach((_, i) => { const p = copies[i * per + k]; i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath();
      ctx.fill();
    }
    this.sel.clipCanvas(ctx, area);
    g.bounds = area;
    this.strokeVersion = (this.strokeVersion || 0) + 1;
    this.updateComp(area);
    this.requestRender();
  },

  endLassoFill() {
    const g = this.gesture;
    if (g.points.length < 3) { this.live = null; this.resetStroke(); this.updateComp(g.bounds); this.requestRender(); return; }
    this.lassoFillDraw();
    const erase = this.settings.lassofill.lassoErase;
    this.commitStroke(g.layer, g.bounds, erase ? 'Lasso erase' : 'Lasso fill');
    if (g.layer.kind !== 'mask' && !erase) this.colors.used();
  },

  // ---------- fill gaps ----------

  beginGapFill(pt, id) {
    const layer = this.target('fill');
    if (!layer) return;
    this.resetStroke();
    this.gesture = { type: 'gapfill', tool: 'gapfill', id, layer, last: pt, bounds: null };
    this.live = { layer, canvas: this.stroke, alpha: 0.35, mode: 'source-over' };
    this.gapFillDrag(pt);
  },

  /** The traced band, a line of the tool's size, in the stroke canvas (shown faintly until pen-up). */
  gapFillDrag(pt) {
    const g = this.gesture, d = this.doc, ctx = this.strokeCtx, size = Math.max(1, this.settings.gapfill.size);
    ctx.strokeStyle = this.inkFor(g.layer);
    ctx.lineWidth = size;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(g.last.x, g.last.y);
    ctx.lineTo(pt.x + (pt === g.last ? 0.01 : 0), pt.y);
    ctx.stroke();
    const r = Math.ceil(size / 2) + 2;
    const seg = clip({ x: Math.floor(Math.min(g.last.x, pt.x)) - r, y: Math.floor(Math.min(g.last.y, pt.y)) - r,
      w: Math.ceil(Math.abs(pt.x - g.last.x)) + 2 * r + 1, h: Math.ceil(Math.abs(pt.y - g.last.y)) + 2 * r + 1 }, d.width, d.height);
    g.last = pt;
    if (!seg) return;
    g.bounds = union(g.bounds, seg);
    this.strokeVersion = (this.strokeVersion || 0) + 1;
    this.updateComp(seg);
    this.requestRender();
  },

  /** Pen up: every colour area wholly inside the traced band is filled with the main colour, as one undo step. */
  endGapFill() {
    const g = this.gesture, b = g.bounds, d = this.doc, s = this.settings.gapfill;
    const drop = () => { this.live = null; this.resetStroke(); if (b) this.updateComp(b); this.requestRender(); };
    if (!b) return drop();
    const band = readPixels(this.stroke, b.x, b.y, b.w, b.h).data, traced = new Uint8Array(b.w * b.h);
    for (let k = 0; k < traced.length; k++) traced[k] = band[k * 4 + 3] > 127 ? 1 : 0;
    const out = enclosedAreas(this.sampleData(s.sample, g.layer), d.width, d.height, traced, b, s.tolerance);
    if (!out.some(v => v)) {
      drop();
      return toast('Nothing to fill there: only areas wholly inside what you trace over are filled.');
    }
    const [cr, cg, cb] = hexToRgb(this.inkFor(g.layer)), img = new ImageData(b.w, b.h);
    for (let k = 0; k < out.length; k++) {
      if (!out[k]) continue;
      img.data[k * 4] = cr; img.data[k * 4 + 1] = cg; img.data[k * 4 + 2] = cb; img.data[k * 4 + 3] = 255;
    }
    this.resetStroke();
    this.strokeCtx.putImageData(img, b.x, b.y);
    this.sel.clipCanvas(this.strokeCtx, b);
    this.live = { layer: g.layer, canvas: this.stroke, alpha: s.opacity, mode: this.strokeMode(g.layer, false) };
    this.commitStroke(g.layer, b, 'Fill gaps');
    if (g.layer.kind !== 'mask') this.colors.used();
  },
};
