// The retouch tools, as Editor methods: Blur (J, after Smudge and Liquify), Dodge and Burn (O) and Clone stamp (S).
//
// Like Smudge they change the layer directly dab by dab (each dab reads what the last one left), keep a copy of the
// layer from pen-down and on pen-up make the changed rectangle one undo step, putting the old pixels back outside
// the selection. Blur, Dodge and Burn follow the symmetry ruler. Clone stamp copies from where you Ctrl+clicked:
// it reads the picture as it was at pen-down (this layer, or everything visible), so it never copies its own dabs;
// with Aligned on, the distance between source and brush stays the same from stroke to stroke.

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { mixByMask } from '../filters.js';
import { union, clip } from '../rect.js';
import { mixDab, toneDab, copyRegion, blurredPatch, blurRadius } from '../retouch.js';
import { symmetryStamps } from '../symmetry.js';
import { toast } from '../ui.js';
import { matrix } from '../view.js';

export const retouchMethods = {
  /** Ctrl+click with the Clone stamp: copy from here. */
  setCloneSource(pt) {
    this.cloneSrc = { x: pt.x, y: pt.y, offset: null };
    this.drawOverlay();
  },

  beginRetouch(toolId, pt, id, ctrl) {
    if (toolId === 'clone' && ctrl) return this.setCloneSource(pt);
    if (toolId === 'clone' && !this.cloneSrc) { toast('Ctrl+click where the Clone stamp should copy from first.'); return; }
    const s = this.settings[toolId], layer = this.target(toolId === 'clone' ? 'clone onto' : 'retouch');
    if (!layer) return;
    const d = this.doc;
    const before = document.createElement('canvas');
    before.width = d.width; before.height = d.height;
    before.getContext('2d').drawImage(layer.canvas, 0, 0);
    const brush = { ...s, flow: s.strength }, sizeAt = p => stampAt(brush, p).size;
    const g = this.gesture = { type: 'retouch', tool: toolId, id, s, brush, layer, before, bounds: null, sizeAt,
      smoother: new Smoother(s.smoothing), path: new StampPath(sizeAt, s.spacing) };
    if (toolId === 'clone') {
      const src = this.cloneSrc;
      if (!s.aligned || !src.offset) src.offset = { x: src.x - pt.x, y: src.y - pt.y };
      g.offset = src.offset;
      g.source = this.sampleData(s.sample, layer);
    }
    this.retouchPoint(pt);
  },

  retouchPoint(pt) {
    const g = this.gesture, d = this.doc;
    g.last = pt;
    const stamps = g.path.add(g.smoother.add(pt));
    if (!stamps.length) return;
    const all = g.tool === 'clone' ? stamps : symmetryStamps(d.rulers.symmetry, stamps, d.width, d.height);
    const ctx = g.layer.ctx, lock = !!g.layer.alphaLock;
    for (const st of all) {
      const { size, flow } = stampAt(g.brush, st.p);
      const dd = Math.max(2, Math.round(size)), x0 = Math.round(st.x - dd / 2), y0 = Math.round(st.y - dd / 2);
      if (g.tool === 'blur') {
        const m = blurRadius(dd) * 2, w = dd + 2 * m;
        const big = ctx.getImageData(x0 - m, y0 - m, w, w);
        const src = blurredPatch(big.data, w, w, m, m, dd);
        const img = ctx.getImageData(x0, y0, dd, dd);
        mixDab(img.data, src, dd, flow, g.s.hardness, lock);
        ctx.putImageData(img, x0, y0);
      } else if (g.tool === 'clone') {
        const src = copyRegion(g.source, d.width, d.height, x0 + Math.round(g.offset.x), y0 + Math.round(g.offset.y), dd, dd);
        const img = ctx.getImageData(x0, y0, dd, dd);
        mixDab(img.data, src, dd, flow, g.s.hardness, lock);
        ctx.putImageData(img, x0, y0);
      } else {
        const img = ctx.getImageData(x0, y0, dd, dd);
        toneDab(img.data, dd, flow, g.s.hardness, g.tool === 'burn');
        ctx.putImageData(img, x0, y0);
      }
    }
    const r = stampBounds(all, g.sizeAt);
    g.bounds = union(g.bounds, r);
    g.layer.touch();
    this.updateComp(r);
  },

  endRetouch() {
    const g = this.gesture, d = this.doc;
    const r = clip(g.bounds, d.width, d.height);
    if (!r) return;
    const before = g.before.getContext('2d').getImageData(r.x, r.y, r.w, r.h);
    const after = g.layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    if (this.sel.active) {  // only inside the selection
      const sel = this.sel.ctx.getImageData(r.x, r.y, r.w, r.h).data, mask = new Uint8Array(r.w * r.h);
      for (let i = 0; i < mask.length; i++) mask[i] = sel[i * 4 + 3];
      const mixed = new Uint8ClampedArray(before.data);
      mixByMask(mixed, after.data, mask);
      after.data.set(mixed);
      g.layer.ctx.putImageData(after, r.x, r.y);
    }
    const labels = { blur: 'Blur', dodge: 'Dodge', burn: 'Burn', clone: 'Clone stamp' };
    this.pushPatch(g.layer, r, before, after, labels[g.tool]);
    g.layer.touch();
    this.changed(r);
  },

  /** The Clone stamp's source: a crosshair where it copies from (following the brush while painting). */
  drawCloneOverlay(ctx) {
    if (this.tool !== 'clone' || !this.cloneSrc) return;
    let p = this.cloneSrc;
    const g = this.gesture;
    if (g?.type === 'retouch' && g.tool === 'clone' && g.last) p = { x: g.last.x + g.offset.x, y: g.last.y + g.offset.y };
    const v = this.view, dpr = this.dpr || 1;
    const [a, b, c, dd, e, f] = matrix(v);
    const sx = (a * p.x + c * p.y + e) * dpr, sy = (b * p.x + dd * p.y + f) * dpr;
    const r = Math.max(4, this.settings.clone.size * v.zoom / 2) * dpr;
    ctx.save();
    ctx.lineWidth = dpr;
    for (const [color, w] of [['rgba(0,0,0,0.75)', 3 * dpr], ['rgba(255,255,255,0.95)', dpr]]) {
      ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.moveTo(sx - 6 * dpr, sy); ctx.lineTo(sx + 6 * dpr, sy);
      ctx.moveTo(sx, sy - 6 * dpr); ctx.lineTo(sx, sy + 6 * dpr);
      ctx.stroke();
    }
    ctx.restore();
  },
};
