// The retouch tools, as Editor methods: Blur (J, after Smudge and Liquify), Dodge and Burn (O), Clone stamp and
// Healing brush (S).
//
// Like Smudge they change the layer directly dab by dab (each dab reads what the last one left), through a pixel
// cache (directpaint.js), and on pen-up make the changed rectangle one undo step, putting the old pixels back outside
// the selection. Blur, Dodge and Burn follow the symmetry ruler. Clone stamp copies from where you Ctrl+clicked:
// it reads the picture as it was at pen-down (this layer, or everything visible), so it never copies its own dabs;
// with Aligned on, the distance between source and brush stays the same from stroke to stroke. The Healing brush
// shares the Clone stamp's source but lays each dab on through healPatch (healing.js), so the copied detail takes the
// colour and brightness of where it lands; in Spot mode it has no source and each dab takes the best fitting patch
// from around it (pen-down pixels, so it never copies what it just healed).

import { Smoother, StampPath, stampAt, stampBounds } from '../brush.js';
import { union } from '../rect.js';
import { mixDab, toneDab, blurredPatch, blurRadius } from '../retouch.js';
import { healPatch, rimMismatch, spotOffsets } from '../healing.js';
import { symmetryStamps } from '../symmetry.js';
import { toast } from '../ui.js';
import { matrix } from '../view.js';

export const retouchMethods = {
  /** Ctrl+click with the Clone stamp or the Healing brush: copy from here. */
  setCloneSource(pt) {
    this.cloneSrc = { x: pt.x, y: pt.y, offset: null };
    this.drawOverlay();
  },

  /** Whether the tool copies from a Ctrl+clicked source (Clone stamp, Healing brush unless in Spot mode). */
  usesSource(toolId) {
    return toolId === 'clone' || (toolId === 'heal' && this.settings.heal.heal !== 'spot');
  },

  beginRetouch(toolId, pt, id, ctrl) {
    const sourced = this.usesSource(toolId);
    if (sourced && ctrl) return this.setCloneSource(pt);
    if (sourced && !this.cloneSrc) {
      toast(toolId === 'heal' ? 'Ctrl+click a clean patch the Healing brush should copy from first (or switch it to Spot).' : 'Ctrl+click where the Clone stamp should copy from first.');
      return;
    }
    const s = this.settings[toolId], layer = this.target(toolId === 'clone' ? 'clone onto' : toolId === 'heal' ? 'heal' : 'retouch');
    if (!layer) return;
    const brush = { ...s, flow: s.strength }, sizeAt = p => stampAt(brush, p).size;
    const g = this.gesture = { type: 'retouch', tool: toolId, id, s, brush, layer, cache: this.pixelCache(layer.canvas), bounds: null, sizeAt,
      smoother: new Smoother(s.smoothing), path: new StampPath(sizeAt, s.spacing), sourced };
    if (sourced) {
      const src = this.cloneSrc;
      if (!s.aligned || !src.offset) src.offset = { x: src.x - pt.x, y: src.y - pt.y };
      g.offset = src.offset;
    }
    if (sourced || toolId === 'heal') {
      // this layer as it was at pen-down (the cache keeps that), or a copy of what is visible now
      g.source = s.sample === 'layer' ? null : this.pixelCache(this.sampleCanvas(s.sample));
    }
    this.retouchPoint(pt);
  },

  /** The pen-down picture (this layer, or what the gesture samples) at x, y, w × h. */
  sourcePatch(g, x, y, w, h) {
    return g.source ? g.source.get(x, y, w, h) : g.cache.getBefore(x, y, w, h);
  },

  /**
   * Spot healing: the patch round a dab (at x0, y0, d × d, now looking like img) whose rim fits in best. Patches past
   * the canvas edge are skipped while any is inside; the last dab's choice is kept unless another fits clearly better,
   * so the texture does not jump about along the stroke.
   */
  spotSource(g, img, x0, y0, d) {
    const W = this.doc.width, H = this.doc.height;
    let offs = spotOffsets(d);
    const inside = offs.filter(([dx, dy]) => x0 + dx >= 0 && y0 + dy >= 0 && x0 + dx + d <= W && y0 + dy + d <= H);
    if (inside.length) offs = inside;
    let best = null;
    for (const [dx, dy] of offs) {
      const src = this.sourcePatch(g, x0 + dx, y0 + dy, d, d);
      let score = rimMismatch(img, src, d);
      if (Math.atan2(dy, dx) === g.spotDir) score *= 0.7;
      if (!best || score < best.score) best = { score, src, dir: Math.atan2(dy, dx) };
    }
    g.spotDir = best.dir;
    return best.src;
  },

  retouchPoint(pt) {
    const g = this.gesture, d = this.doc;
    g.last = pt;
    const stamps = g.path.add(g.smoother.add(pt));
    if (!stamps.length) return;
    const all = g.tool === 'clone' || g.tool === 'heal' ? stamps : symmetryStamps(d.rulers.symmetry, stamps, d.width, d.height);
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
        const src = this.sourcePatch(g, x0 + Math.round(g.offset.x), y0 + Math.round(g.offset.y), dd, dd);
        const img = c.get(x0, y0, dd, dd);
        mixDab(img, src, dd, flow, g.s.hardness, lock);
        c.set(x0, y0, dd, dd, img);
      } else if (g.tool === 'heal') {
        const img = c.get(x0, y0, dd, dd);
        const src = g.sourced ? this.sourcePatch(g, x0 + Math.round(g.offset.x), y0 + Math.round(g.offset.y), dd, dd) : this.spotSource(g, img, x0, y0, dd);
        mixDab(img, healPatch(img, src, dd), dd, flow, g.s.hardness, lock);
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
    const labels = { blur: 'Blur', dodge: 'Dodge', burn: 'Burn', clone: 'Clone stamp', heal: 'Healing brush' };
    this.endDirect(this.gesture, labels[this.gesture.tool]);
  },

  /** The Clone stamp's (and Healing brush's) source: a crosshair where it copies from (following the brush while painting). */
  drawCloneOverlay(ctx) {
    if (!this.usesSource(this.tool) || !this.cloneSrc) return;
    let p = this.cloneSrc;
    const g = this.gesture;
    if (g?.type === 'retouch' && g.sourced && g.last) p = { x: g.last.x + g.offset.x, y: g.last.y + g.offset.y };
    const v = this.view, dpr = this.dpr || 1;
    const [a, b, c, dd, e, f] = matrix(v);
    const sx = (a * p.x + c * p.y + e) * dpr, sy = (b * p.x + dd * p.y + f) * dpr;
    const r = Math.max(4, this.settings[this.tool].size * v.zoom / 2) * dpr;
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
