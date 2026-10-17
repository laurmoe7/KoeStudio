// The retouch tools, as Editor methods: Blur (J, after Smudge and Liquify), Dodge and Burn (O) and Clone stamp (S).
//
// Like Smudge they change the layer directly dab by dab (each dab reads what the last one left), through a pixel
// cache (directpaint.js), and on pen-up make the changed rectangle one undo step, putting the old pixels back outside
// the selection. Blur, Dodge and Burn follow the symmetry ruler. Clone stamp copies from where you Ctrl+clicked:
// it reads the picture as it was at pen-down (this layer, or everything visible), so it never copies its own dabs;
// with Aligned on, the distance between source and brush stays the same from stroke to stroke.

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { union } from '../rect.js';
import { mixDab, toneDab, blurredPatch, blurRadius } from '../retouch.js';
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
    const brush = { ...s, flow: s.strength }, sizeAt = p => stampAt(brush, p).size;
    const g = this.gesture = { type: 'retouch', tool: toolId, id, s, brush, layer, cache: this.pixelCache(layer.canvas), bounds: null, sizeAt,
      smoother: new Smoother(s.smoothing), path: new StampPath(sizeAt, s.spacing) };
    if (toolId === 'clone') {
      const src = this.cloneSrc;
      if (!s.aligned || !src.offset) src.offset = { x: src.x - pt.x, y: src.y - pt.y };
      g.offset = src.offset;
      // this layer as it was at pen-down (the cache keeps that), or a copy of what is visible now
      g.source = s.sample === 'layer' ? null : this.pixelCache(this.sampleCanvas(s.sample));
    }
    this.retouchPoint(pt);
  },

  retouchPoint(pt) {
    const g = this.gesture, d = this.doc;
    g.last = pt;
    const stamps = g.path.add(g.smoother.add(pt));
    if (!stamps.length) return;
    const all = g.tool === 'clone' ? stamps : symmetryStamps(d.rulers.symmetry, stamps, d.width, d.height);
    const c = g.cache, lock = !!g.layer.alphaLock;
    for (const st of all) {
      const { size, flow } = stampAt(g.brush, st.p);
      const dd = Math.max(2, Math.round(size)), x0 = Math.round(st.x - dd / 2), y0 = Math.round(st.y - dd / 2);
      if (g.tool === 'blur') {
        const m = blurRadius(dd) * 2, w = dd + 2 * m;
        const src = blurredPatch(c.get(x0 - m, y0 - m, w, w), w, w, m, m, dd);
        const img = c.get(x0, y0, dd, dd);
        mixDab(img, src, dd, flow, g.s.hardness, lock);
        c.set(x0, y0, dd, dd, img);
      } else if (g.tool === 'clone') {
        const sx = x0 + Math.round(g.offset.x), sy = y0 + Math.round(g.offset.y);
        const src = g.source ? g.source.get(sx, sy, dd, dd) : c.getBefore(sx, sy, dd, dd);
        const img = c.get(x0, y0, dd, dd);
        mixDab(img, src, dd, flow, g.s.hardness, lock);
        c.set(x0, y0, dd, dd, img);
      } else {
        const img = c.get(x0, y0, dd, dd);
        toneDab(img, dd, flow, g.s.hardness, g.tool === 'burn');
        c.set(x0, y0, dd, dd, img);
      }
    }
    const r = stampBounds(all, g.sizeAt);
    g.bounds = union(g.bounds, r);
    this.flushDirect(g, r);
  },

  endRetouch() {
    const labels = { blur: 'Blur', dodge: 'Dodge', burn: 'Burn', clone: 'Clone stamp' };
    this.endDirect(this.gesture, labels[this.gesture.tool]);
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
