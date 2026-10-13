// The Filter menu: each filter (filters.js) runs on the current layer or mask, inside the selection, with a
// dialog whose sliders change the layer live; OK records one undo step, Cancel puts the pixels back.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { FILTERS, FILTER_BY_ID, defaultParams, sanitizeParams, mixByMask } from '../filters.js';
import { clip } from '../rect.js';
import { esc, modal, store } from '../ui.js';

export const filterMethods = {
  /** Menu items for the Filter menu. */
  filterMenuItems() {
    return FILTERS.map(f => (f === '-' ? '-' : { label: f.label, run: () => this.runFilter(f.id) }));
  },

  async runFilter(id) {
    const filter = FILTER_BY_ID[id];
    if (!filter || this.filtering) return;
    this.finishTransform();
    this.finishText();
    const t = this.target('apply a filter to');
    if (!t) return;
    const d = this.doc, W = d.width, H = d.height;
    const area = this.sel.active ? { ...this.sel.bounds } : { x: 0, y: 0, w: W, h: H };
    const orig = t.ctx.getImageData(0, 0, W, H);
    const selData = this.sel.active ? this.sel.ctx.getImageData(0, 0, W, H).data : null;
    const job = { filter, t, orig, selData, area, params: sanitizeParams(filter, defaultParams(filter)) };
    this.filtering = job;
    let params;
    if (filter.fields.length) {
      job.params = sanitizeParams(filter, (store('filters') || {})[id]);
      this.previewFilter(job);
      // one preview per frame, however fast the slider moves
      params = await filterDialog(filter, job.params, p => {
        job.params = p;
        cancelAnimationFrame(job.raf);
        job.raf = requestAnimationFrame(() => this.previewFilter(job));
      });
      cancelAnimationFrame(job.raf);  // a preview still waiting must not land after the cancel or the undo step
      if (params) { job.params = params; this.previewFilter(job); }
    } else {
      params = job.params;
      this.previewFilter(job);
    }
    this.filtering = null;
    if (!params) {  // cancelled: back to how it was
      t.ctx.putImageData(orig, 0, 0);
      t.touch();
      this.changed(null, { save: false });
      return;
    }
    if (filter.fields.length) store('filters', { ...(store('filters') || {}), [id]: params });
    const a = area;
    const before = new ImageData(new Uint8ClampedArray(a.w * a.h * 4), a.w, a.h);
    for (let y = 0; y < a.h; y++) before.data.set(orig.data.subarray(((a.y + y) * W + a.x) * 4, ((a.y + y) * W + a.x + a.w) * 4), y * a.w * 4);
    const after = t.ctx.getImageData(a.x, a.y, a.w, a.h);
    this.pushPatch(t, a, before, after, filter.label.replace(/…$/, ''));
    t.touch();
    this.changed(a);
  },

  /**
   * Shows the filter with job.params on the layer: the original pixels of the area (plus the filter's margin
   * around it, so blurs see their surroundings) are filtered and mixed back in by the selection.
   */
  previewFilter(job) {
    const { filter, t, orig, selData, area, params } = job;
    const W = orig.width, H = orig.height, m = filter.margin(params);
    const r = clip({ x: area.x - m, y: area.y - m, w: area.w + 2 * m, h: area.h + 2 * m }, W, H);
    const src = new Uint8ClampedArray(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) src.set(orig.data.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
    const out = new Uint8ClampedArray(src);
    filter.apply(out, r.w, r.h, params, r.x, r.y);
    // the mask: the selection inside the area, nothing in the margin
    const mask = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) {
      const dy = r.y + y;
      if (dy < area.y || dy >= area.y + area.h) continue;
      for (let x = 0; x < r.w; x++) {
        const dx = r.x + x;
        if (dx < area.x || dx >= area.x + area.w) continue;
        mask[y * r.w + x] = selData ? selData[(dy * W + dx) * 4 + 3] : 255;
      }
    }
    mixByMask(src, out, mask);
    t.ctx.putImageData(orig, 0, 0);
    t.ctx.putImageData(new ImageData(src, r.w, r.h), r.x, r.y);
    t.touch();
    this.changed(r, { save: false });
  },
};

/** The sliders of a filter; onChange(params) runs on every change. Resolves to the params, or null when cancelled. */
function filterDialog(filter, params, onChange) {
  const fmt = (x, v) => (x.step < 1 ? (+v).toFixed(2).replace(/\.?0+$/, '') : Math.round(v)) + x.unit;
  return modal({
    title: filter.label.replace(/…$/, ''),
    body: `<div class="filter-fields">${filter.fields.map(x => `
      <label class="slider"><span>${esc(x.label)}</span>
        <input type="range" data-k="${x.key}" min="${x.min}" max="${x.max}" step="${x.step}" value="${params[x.key]}"><output>${fmt(x, params[x.key])}</output></label>`).join('')}
      </div>
      <div class="btn-row"><button type="button" data-reset>Reset</button></div>
      <p class="muted small">The canvas shows the result as you drag.</p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
    live: true,
    onOpen: root => {
      const read = () => {
        const raw = {};
        root.querySelectorAll('input[data-k]').forEach(inp => { raw[inp.dataset.k] = inp.value; });
        return sanitizeParams(filter, raw);
      };
      const show = p => {
        root.querySelectorAll('input[data-k]').forEach(inp => {
          const x = filter.fields.find(f => f.key === inp.dataset.k);
          inp.parentElement.querySelector('output').textContent = fmt(x, p[x.key]);
        });
      };
      const changed = () => {
        const p = read();
        show(p);
        onChange(p);
      };
      root.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', changed));
      root.querySelector('[data-reset]').onclick = () => {
        const def = defaultParams(filter);
        root.querySelectorAll('input[data-k]').forEach(inp => { inp.value = def[inp.dataset.k]; });
        changed();
      };
    },
    collect: root => {
      const raw = {};
      root.querySelectorAll('input[data-k]').forEach(inp => { raw[inp.dataset.k] = inp.value; });
      return sanitizeParams(filter, raw);
    },
  });
}
