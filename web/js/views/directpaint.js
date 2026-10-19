// Shared by the tools that change a layer's pixels directly, dab by dab (Smudge, Liquify, Blur, Dodge, Burn, Clone
// stamp), as Editor methods. They read and write through a PixelCache (pixelcache.js) instead of calling
// getImageData for every dab, write the changed tiles back once per pointer move, and on pen-up record one undo
// patch from the cache's before/after pixels, putting the old pixels back outside the selection.

import { mixByMask } from '../filters.js';
import { PixelCache } from '../pixelcache.js';
import { clip } from '../rect.js';

export const directPaintMethods = {
  /**
   * A pixel cache over a canvas (its pixels are read tile by tile, when first touched). Each tile is copied into a
   * small canvas of its own and read there: reading the layer itself would make the browser move it off the GPU for
   * good, and every later redraw would upload it again.
   */
  pixelCache(canvas) {
    let c = null, ctx = null;
    return new PixelCache(canvas.width, canvas.height, (x, y, w, h) => {
      if (!c || c.width < w || c.height < h) {
        c = document.createElement('canvas');
        c.width = w; c.height = h;
        ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.globalCompositeOperation = 'copy';
      }
      ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    });
  },

  /** Writes the gesture's changed tiles onto its layer and queues region r for redrawing. */
  flushDirect(g, r) {
    const ctx = g.layer.ctx;
    g.cache.flush((x, y, w, h, data) => ctx.putImageData(new ImageData(data, w, h), x, y));
    g.layer.touch();
    if (r) this.updateComp(r);
  },

  /** Pen-up: one undo step for what the gesture changed (inside the selection only). */
  endDirect(g, label) {
    this.flushDirect(g);
    const d = this.doc, r = clip(g.bounds, d.width, d.height);
    if (!r) return;
    const before = new ImageData(g.cache.getBefore(r.x, r.y, r.w, r.h), r.w, r.h);
    const after = new ImageData(g.cache.get(r.x, r.y, r.w, r.h), r.w, r.h);
    if (this.sel.active) {  // only inside the selection
      const sel = this.sel.ctx.getImageData(r.x, r.y, r.w, r.h).data, mask = new Uint8Array(r.w * r.h);
      for (let i = 0; i < mask.length; i++) mask[i] = sel[i * 4 + 3];
      const mixed = new Uint8ClampedArray(before.data);
      mixByMask(mixed, after.data, mask);
      after.data.set(mixed);
      g.layer.ctx.putImageData(after, r.x, r.y);
    }
    this.pushPatch(g.layer, r, before, after, label);
    g.layer.touch();
    this.changed(r);
  },
};
