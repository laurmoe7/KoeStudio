// The Liquify tool (J, after Smudge), as Editor methods. Like Smudge it changes the layer directly dab by dab
// (each dab reads what the last one left), keeps a copy of the layer from pen-down and on pen-up makes the changed
// rectangle one undo step, putting the old pixels back outside the selection. Push dabs follow the pen; Pinch,
// Bloat and Twirl also keep working while the pen is held still.

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { mixByMask } from '../filters.js';
import { liquifyDab, liquifyReach } from '../liquify.js';
import { union, clip } from '../rect.js';

const HOLD_MS = 50;  // while the pen stays put, Pinch/Bloat/Twirl dab this often

export const liquifyMethods = {
  beginLiquify(pt, id) {
    const s = this.settings.liquify, layer = this.target('liquify');
    if (!layer) return;
    const d = this.doc;
    const before = document.createElement('canvas');
    before.width = d.width; before.height = d.height;
    before.getContext('2d').drawImage(layer.canvas, 0, 0);
    const brush = { ...s, flow: s.strength }, sizeAt = p => stampAt(brush, p).size;
    this.gesture = { type: 'liquify', tool: 'liquify', id, s, brush, layer, before, bounds: null, sizeAt, last: pt, prev: null,
      smoother: new Smoother(s.smoothing), path: new StampPath(sizeAt, s.spacing), timer: 0 };
    if (s.liquify !== 'push') this.gesture.timer = setInterval(() => { const g = this.gesture; if (g?.prev) { this.liquifyAt(g.prev, 0, 0); this.requestRender(); } }, HOLD_MS);
    this.liquifyPoint(pt);
  },

  liquifyPoint(pt) {
    const g = this.gesture;
    g.last = pt;
    for (const st of g.path.add(g.smoother.add(pt))) {
      const dx = g.prev ? st.x - g.prev.x : 0, dy = g.prev ? st.y - g.prev.y : 0;
      if (g.prev || g.s.liquify !== 'push') this.liquifyAt(st, dx, dy);
      g.prev = st;
    }
  },

  /** One dab at stamp st (with the pen's step dx, dy for Push), straight onto the layer. */
  liquifyAt(st, dx, dy) {
    const g = this.gesture, d = this.doc, mode = g.s.liquify;
    const { size, flow } = stampAt(g.brush, st.p), r = Math.max(1, size / 2);
    if (mode === 'push' && !dx && !dy) return;
    const reach = r + liquifyReach(mode, r, flow, dx, dy);
    const area = clip({ x: Math.floor(st.x - reach), y: Math.floor(st.y - reach), w: Math.ceil(2 * reach) + 1, h: Math.ceil(2 * reach) + 1 }, d.width, d.height);
    if (!area) return;
    const img = g.layer.ctx.getImageData(area.x, area.y, area.w, area.h);
    liquifyDab(img.data, area.w, area.h, st.x - area.x, st.y - area.y, r, mode, flow, dx, dy);
    g.layer.ctx.putImageData(img, area.x, area.y);
    const changed = stampBounds([st], g.sizeAt);
    g.bounds = union(g.bounds, changed);
    g.layer.touch();
    this.updateComp(changed);
  },

  endLiquify() {
    const g = this.gesture, d = this.doc;
    clearInterval(g.timer);
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
    this.pushPatch(g.layer, r, before, after, 'Liquify');
    g.layer.touch();
    this.changed(r);
  },
};
