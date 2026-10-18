// The Filter menu: each filter (filters.js) runs on the current layer or mask, inside the selection, with a
// dialog whose sliders change the layer live; OK records one undo step, Cancel puts the pixels back.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { FILTERS, FILTER_BY_ID, CURVE_CHANNELS, defaultParams, sanitizeParams, mixByMask, parseStopColor } from '../filters.js';
import { gradientStops } from '../gradient.js';
import { hexToRgb } from '../color.js';
import { curveAt } from '../brush.js';
import { clip } from '../rect.js';
import { esc, modal, store, toast } from '../ui.js';

export const filterMethods = {
  /** Menu items for the Filter menu. */
  filterMenuItems() {
    const last = this.lastFilter && FILTER_BY_ID[this.lastFilter.id];
    return [
      { label: last ? `Repeat ${last.label.replace(/…$/, '')}` : 'Repeat last filter', key: 'Ctrl+F', disabled: !last, run: () => this.repeatFilter() },
      '-',
      ...FILTERS.map(f => (f === '-' ? '-' : { label: f.label, run: () => this.runFilter(f.id) })),
    ];
  },

  /** Ctrl+F: the last filter again with the same settings, without the dialog. */
  repeatFilter() {
    if (!this.lastFilter) return toast('No filter has been used yet.');
    return this.runFilter(this.lastFilter.id, this.lastFilter.params);
  },

  /** Runs a filter on the current layer or mask; with `fixed` params there is no dialog. */
  async runFilter(id, fixed = null) {
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
    if (filter.gradient) {  // Gradient map: the Gradient tool's colours, as they are now
      job.extra = { stops: gradientStops(this.settings.gradient.colors, this.colors.main, this.colors.sub, this.userGrads()).map(([o, c]) => [o, parseStopColor(c)]) };
    }
    if (filter.mainColor) job.extra = { color: hexToRgb(this.colors.main) };  // Change color: the main colour, as it is now
    this.filtering = job;
    let params;
    if (fixed) {
      params = job.params = sanitizeParams(filter, fixed);
      this.previewFilter(job);
    } else if (filter.fields.length || filter.curves) {
      job.params = sanitizeParams(filter, (store('filters') || {})[id]);
      this.previewFilter(job);
      // one preview per frame, however fast the slider moves
      const dialog = filter.curves ? (f, p, cb) => curvesDialog(f, p, cb, histogram(orig, selData)) : filterDialog;
      // a centred blur: clicking the canvas moves the centre there (the dialog lets clicks through)
      const pick = filter.centre ? set => { this.canvasPick = dp => set({ cx: Math.round(dp.x / W * 100), cy: Math.round(dp.y / H * 100) }); } : null;
      params = await dialog(filter, job.params, p => {
        job.params = p;
        cancelAnimationFrame(job.raf);
        job.raf = requestAnimationFrame(() => this.previewFilter(job));
      }, pick);
      this.canvasPick = null;
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
    if (filter.fields.length || filter.curves) store('filters', { ...(store('filters') || {}), [id]: params });
    this.lastFilter = { id, params };
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
    filter.apply(out, r.w, r.h, job.extra ? { ...params, ...job.extra } : params, r.x, r.y, W, H);
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

/**
 * The sliders of a filter; onChange(params) runs on every change. Resolves to the params, or null when cancelled.
 * pick(set), when given, receives a function that sets some sliders from outside (a click on the canvas).
 */
export function filterDialog(filter, params, onChange, pick = null) {
  const fmt = (x, v) => (x.step < 1 ? (+v).toFixed(2).replace(/\.?0+$/, '') : Math.round(v)) + x.unit;
  return modal({
    title: filter.label.replace(/…$/, ''),
    body: `<div class="filter-fields">${filter.fields.map(x => `
      <label class="slider"><span>${esc(x.label)}</span>
        <input type="range" data-k="${x.key}" min="${x.min}" max="${x.max}" step="${x.step}" value="${params[x.key]}"><output>${fmt(x, params[x.key])}</output></label>`).join('')}
      </div>
      <div class="btn-row"><button type="button" data-reset>Reset</button></div>
      <p class="muted small">${filter.note ? esc(filter.note) + ' ' : ''}The canvas shows the result as you drag.${pick ? ' Click the canvas to put the centre there.' : ''}</p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
    live: true,
    passClicks: !!pick,
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
      pick?.(vals => {
        root.querySelectorAll('input[data-k]').forEach(inp => { if (inp.dataset.k in vals) inp.value = vals[inp.dataset.k]; });
        changed();
      });
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

/** How many pixels of each brightness (0-255) there are, counting only painted pixels inside the selection. */
export function histogram(img, selData) {
  const h = new Uint32Array(256), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || (selData && !selData[i + 3])) continue;
    h[(d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8]++;
  }
  return h;
}

const CURVE_PX = 256;  // drawing size of the curve box, CSS px
const GRAB_PX = 9;     // how close a click must be to grab a point
const DROP_PX = 24;    // a point dragged this far out of the box is removed

/**
 * Curves: drag the points of each channel's curve; click to add one, drag one out of the box (or double-click
 * it) to remove it. Resolves to the params ({rgb, r, g, b}: point lists), or null when cancelled.
 */
export function curvesDialog(filter, params, onChange, hist) {
  let p = JSON.parse(JSON.stringify(params)), ch = 'rgb';
  const colors = { rgb: '#e8e8ea', r: '#ff6b6b', g: '#5fd47f', b: '#6ea8ff' };
  const copy = () => JSON.parse(JSON.stringify(p));
  return modal({
    title: 'Curves',
    body: `<div class="curves">
        <label class="slider"><span>Channel</span><select data-ch>${CURVE_CHANNELS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <canvas class="curve-box"></canvas>
        <p class="muted small">Click to add a point and drag to bend the curve. Drag a point out of the box, or double-click it, to remove it.</p>
      </div>
      <div class="btn-row"><button type="button" data-reset-ch>Reset channel</button><button type="button" data-reset>Reset all</button></div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
    live: true,
    onOpen: root => {
      const cv = root.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
      cv.width = cv.height = CURVE_PX * dpr;
      const ctx = cv.getContext('2d');
      const max = Math.max(1, ...hist);
      const toPx = ([x, y]) => [x * CURVE_PX, (1 - y) * CURVE_PX];
      const drawCurve = (k, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = colors[k];
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 128; i++) {
          const x = i / 128, [px, py] = toPx([x, curveAt(p[k], x)]);
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      const draw = (drop = -1) => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, CURVE_PX, CURVE_PX);
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        for (let v = 0; v < 256; v++) {  // histogram, square-root scaled so small counts still show
          const hh = Math.sqrt(hist[v] / max) * CURVE_PX;
          ctx.fillRect(v * CURVE_PX / 256, CURVE_PX - hh, CURVE_PX / 256 + 0.5, hh);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
          const q = Math.round(i * CURVE_PX / 4) + 0.5;
          ctx.moveTo(q, 0); ctx.lineTo(q, CURVE_PX); ctx.moveTo(0, q); ctx.lineTo(CURVE_PX, q);
        }
        ctx.moveTo(0, CURVE_PX); ctx.lineTo(CURVE_PX, 0);
        ctx.stroke();
        for (const [k] of CURVE_CHANNELS) if (k !== ch) drawCurve(k, 0.25);  // the other channels faintly
        drawCurve(ch, 1);
        p[ch].forEach((pt, i) => {
          const [x, y] = toPx(pt);
          ctx.fillStyle = i === drop ? '#ff6b6b' : '#fff';
          ctx.strokeStyle = '#111';
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      };
      const changed = () => { draw(); onChange(copy()); };
      const at = e => {
        const r = cv.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, r];
      };
      const pointAt = (x, y) => p[ch].findIndex(q => Math.hypot((q[0] - x) * CURVE_PX, (q[1] - y) * CURVE_PX) <= GRAB_PX);
      let drag = null;
      cv.addEventListener('pointerdown', e => {
        const [x, y] = at(e), pts = p[ch];
        let i = pointAt(x, y);
        if (i < 0) {  // a new point where clicked
          if (pts.some(q => Math.abs(q[0] - x) < 0.02)) return;
          i = pts.findIndex(q => q[0] > x);
          if (i < 0) i = pts.length;
          pts.splice(i, 0, [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]);
        }
        drag = { i, drop: false };
        try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        changed();
      });
      cv.addEventListener('pointermove', e => {
        if (!drag) return;
        const [x, y, r] = at(e), pts = p[ch], i = drag.i;
        const lo = i > 0 ? pts[i - 1][0] + 0.01 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 0.01 : 1;
        pts[i] = [Math.max(lo, Math.min(hi, x)), Math.max(0, Math.min(1, y))];
        const out = e.clientX < r.left - DROP_PX || e.clientX > r.right + DROP_PX || e.clientY < r.top - DROP_PX || e.clientY > r.bottom + DROP_PX;
        drag.drop = out && i > 0 && i < pts.length - 1;
        draw(drag.drop ? i : -1);
        onChange(copy());
      });
      const up = () => {
        if (!drag) return;
        if (drag.drop) p[ch].splice(drag.i, 1);
        drag = null;
        changed();
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
      cv.addEventListener('dblclick', e => {
        const [x, y] = at(e), i = pointAt(x, y);
        if (i > 0 && i < p[ch].length - 1) { p[ch].splice(i, 1); changed(); }
      });
      root.querySelector('[data-ch]').onchange = e => { ch = e.target.value; draw(); };
      root.querySelector('[data-reset-ch]').onclick = () => { p[ch] = [[0, 0], [1, 1]]; changed(); };
      root.querySelector('[data-reset]').onclick = () => { p = defaultParams(filter); changed(); };
      draw();
    },
    collect: () => sanitizeParams(filter, p),
  });
}
