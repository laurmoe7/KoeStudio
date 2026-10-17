// The Liquify tool (J, after Smudge), as Editor methods. Like Smudge it changes the layer directly dab by dab
// (each dab reads what the last one left), through a pixel cache (directpaint.js), and on pen-up makes the changed
// rectangle one undo step, putting the old pixels back outside the selection. Push dabs follow the pen; Pinch,
// Bloat and Twirl also keep working while the pen is held still. With the symmetry ruler every copy bends too
// (each pushed its own way; mirrored copies twirl the other way round).

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { liquifyDab, liquifyReach } from '../liquify.js';
import { union, clip } from '../rect.js';
import { symmetryPoints, symmetryFlips } from '../symmetry.js';

const HOLD_MS = 50;  // while the pen stays put, Pinch/Bloat/Twirl dab this often

export const liquifyMethods = {
  beginLiquify(pt, id) {
    const s = this.settings.liquify, layer = this.target('liquify');
    if (!layer) return;
    const d = this.doc;
    const brush = { ...s, flow: s.strength }, sizeAt = p => stampAt(brush, p).size;
    this.gesture = { type: 'liquify', tool: 'liquify', id, s, brush, layer, cache: this.pixelCache(layer.canvas), bounds: null, sizeAt, last: pt, prev: null,
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

  /** One dab at stamp st (with the pen's step dx, dy for Push) and at its symmetric copies, straight onto the layer. */
  liquifyAt(st, dx, dy) {
    const d = this.doc, sym = d.rulers.symmetry, mode = this.gesture.s.liquify;
    const at = symmetryPoints(sym, st.x, st.y, d.width, d.height);
    if (at.length === 1) return this.liquifyDabAt(st, dx, dy, mode);
    const from = symmetryPoints(sym, st.x - dx, st.y - dy, d.width, d.height), flips = symmetryFlips(sym, st.x, st.y, d.width, d.height);
    at.forEach((q, k) => {
      const m = mode.startsWith('twirl') && flips[k] ? (mode === 'twirl' ? 'twirl-left' : 'twirl') : mode;
      this.liquifyDabAt({ ...st, x: q.x, y: q.y }, q.x - from[k].x, q.y - from[k].y, m);
    });
  },

  liquifyDabAt(st, dx, dy, mode) {
    const g = this.gesture, d = this.doc;
    const { size, flow } = stampAt(g.brush, st.p), r = Math.max(1, size / 2);
    if (mode === 'push' && !dx && !dy) return;
    const reach = r + liquifyReach(mode, r, flow, dx, dy);
    const area = clip({ x: Math.floor(st.x - reach), y: Math.floor(st.y - reach), w: Math.ceil(2 * reach) + 1, h: Math.ceil(2 * reach) + 1 }, d.width, d.height);
    if (!area) return;
    const img = g.cache.get(area.x, area.y, area.w, area.h);
    liquifyDab(img, area.w, area.h, st.x - area.x, st.y - area.y, r, mode, flow, dx, dy);
    g.cache.set(area.x, area.y, area.w, area.h, img);
    const changed = stampBounds([st], g.sizeAt);
    g.bounds = union(g.bounds, changed);
    this.flushDirect(g, changed);
  },

  endLiquify() {
    clearInterval(this.gesture.timer);
    this.endDirect(this.gesture, 'Liquify');
  },

};
