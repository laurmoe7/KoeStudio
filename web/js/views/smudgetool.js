// The Smudge tool (J) and Lasso fill (G, after Fill and Gradient), as Editor methods.
//
// Smudge changes the layer directly dab by dab (it has to read what earlier dabs left), keeping a copy of the
// layer from pen-down; on pen-up the changed rectangle becomes one undo step, and outside the selection the old
// pixels are put back (softly where it is feathered). Lasso fill draws the enclosed shape into the stroke canvas
// and commits it like a stroke, so opacity, alpha lock, masks and undo behave as for painting.

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { mixByMask } from '../filters.js';
import { union, clip } from '../rect.js';
import { smudgeDab } from '../smudge.js';
import { symmetryStamps } from '../symmetry.js';

export const smudgeMethods = {
  beginSmudge(pt, id) {
    const s = this.settings.smudge, layer = this.target('smudge');
    if (!layer) return;
    const d = this.doc;
    const before = document.createElement('canvas');
    before.width = d.width; before.height = d.height;
    before.getContext('2d').drawImage(layer.canvas, 0, 0);
    const sizeAt = p => stampAt({ ...s, flow: s.strength }, p).size;
    this.gesture = { type: 'smudge', tool: 'smudge', id, s, layer, before, bounds: null, sizeAt, last: pt,
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
    const ctx = g.layer.ctx;
    all.forEach((st, k) => {
      const copy = k % per;
      const { size, flow } = stampAt({ ...s, flow: s.strength }, st.p);
      const dd = Math.max(2, Math.round(size)), x0 = Math.round(st.x - dd / 2), y0 = Math.round(st.y - dd / 2);
      const img = ctx.getImageData(x0, y0, dd, dd);
      let buf = g.bufs[copy];
      if (!buf || buf.d !== dd) {  // first dab (or the size changed with pressure): pick up what is here
        buf = g.bufs[copy] = { d: dd, data: new Uint8ClampedArray(img.data) };
        return;
      }
      smudgeDab(img.data, buf.data, dd, flow, s.hardness, g.layer.alphaLock);
      ctx.putImageData(img, x0, y0);
    });
    const r = stampBounds(all, g.sizeAt);
    g.bounds = union(g.bounds, r);
    g.layer.touch();
    this.updateComp(r);
  },

  endSmudge() {
    const g = this.gesture, d = this.doc;
    const r = clip(g.bounds, d.width, d.height);
    if (!r) return;
    const bctx = g.before.getContext('2d');
    const before = bctx.getImageData(r.x, r.y, r.w, r.h);
    const after = g.layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    if (this.sel.active) {  // only inside the selection
      const sel = this.sel.ctx.getImageData(r.x, r.y, r.w, r.h).data, mask = new Uint8Array(r.w * r.h);
      for (let i = 0; i < mask.length; i++) mask[i] = sel[i * 4 + 3];
      const mixed = new Uint8ClampedArray(before.data);
      mixByMask(mixed, after.data, mask);
      after.data.set(mixed);
      g.layer.ctx.putImageData(after, r.x, r.y);
    }
    this.pushPatch(g.layer, r, before, after, 'Smudge');
    g.layer.touch();
    this.changed(r);
  },

  // ---------- lasso fill ----------

  beginLassoFill(pt, id) {
    const layer = this.target('fill');
    if (!layer) return;
    this.resetStroke();
    this.gesture = { type: 'lassofill', tool: 'lassofill', id, layer, points: [pt], bounds: null };
    this.live = { layer, canvas: this.stroke, alpha: this.settings.lassofill.opacity, mode: this.strokeMode(layer, false) };
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
    this.commitStroke(g.layer, g.bounds, 'Lasso fill');
    if (g.layer.kind !== 'mask') this.colors.used();
  },
};
