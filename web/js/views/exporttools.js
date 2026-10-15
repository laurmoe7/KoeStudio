// Exporting the picture (Export dialog: format, size, quality, background, area, file name) and the project file,
// as Editor methods.

import { api } from '../api.js';
import { composite } from '../doc.js';
import { EXPORT_FORMATS, EXPORT_BY_ID, EXPORT_MAX_SIDE, encodePixels, exportSize, sanitizeExportOptions } from '../imageformats.js';
import { esc, toast, modal, store } from '../ui.js';
import { versionsDialog } from './gallery.js';

const showFolder = { label: 'Show folder', run: () => api.openFolder('Exports') };

export const exportMethods = {
  /**
   * Exports the flattened picture to Pictures\KoeStudio\Exports. exportAs('png') exports straight away (whole
   * canvas, 100%, with paper); without a format the Export dialog asks, and its choices are kept (koe.exportOpts).
   */
  async exportAs(format) {
    this.finishText();
    let o, name = this.doc.title;
    if (format) o = sanitizeExportOptions({ format });
    else {
      const res = await this.exportDialog(sanitizeExportOptions(store('exportOpts')));
      if (!res) return;
      ({ opts: o, name } = res);
      store('exportOpts', o);
    }
    const fmt = EXPORT_BY_ID[o.format];
    try {
      const canvas = this.exportCanvas(o, fmt);
      let blob;
      if (['gif', 'tga', 'bmp'].includes(fmt.id)) {
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        blob = new Blob([encodePixels(fmt.id, data, canvas.width, canvas.height)]);
      } else {
        blob = await new Promise(r => canvas.toBlob(r, fmt.mime, fmt.quality ? o.quality / 100 : undefined));
        if (!blob || blob.type !== fmt.mime) throw new Error(`This window cannot make ${fmt.label} files`);
      }
      const res = await api.exportImage(name, fmt.id, blob);
      toast(`Exported ${canvas.width} × ${canvas.height} ${fmt.label} to ${res.path}`, { action: showFolder, ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    }
  },

  /** The picture to export: the area (canvas or selection bounds), with or without the paper, scaled once at the end. */
  exportCanvas(o, fmt) {
    const d = this.doc;
    const area = o.area === 'selection' && this.sel.active ? this.sel.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    const size = exportSize(area.w, area.h, o.scale);
    if (size.tooBig) throw new Error(`${size.w} × ${size.h} px is too big to export (at most ${EXPORT_MAX_SIDE} px a side)`);
    let src = document.createElement('canvas');
    src.width = area.w; src.height = area.h;
    const sctx = src.getContext('2d');
    sctx.translate(-area.x, -area.y);
    composite(sctx, o.paper ? d : { paper: null, root: d.root }, area);
    const out = document.createElement('canvas');
    out.width = size.w; out.height = size.h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (fmt.flatten) {  // no alpha in this format: put the picture on white
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size.w, size.h);
    }
    if (o.scale === 100) ctx.drawImage(src, 0, 0);
    else if (o.scale > 100 && o.scale % 100 === 0) {  // whole-number enlargements keep hard pixels (pixel art)
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, size.w, size.h);
    } else {
      // big reductions halve step by step first: one smoothed draw from far away skips pixels and looks grainy
      while (src.width / 2 >= size.w * 1.5 && src.height / 2 >= size.h * 1.5) {
        const half = document.createElement('canvas');
        half.width = Math.round(src.width / 2); half.height = Math.round(src.height / 2);
        const hctx = half.getContext('2d');
        hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(src, 0, 0, half.width, half.height);
        src = half;
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, size.w, size.h);
    }
    return out;
  },

  /** The Export dialog. Resolves to {opts, name}, or null when cancelled. */
  exportDialog(o) {
    const d = this.doc, hasSel = this.sel.active;
    const areaOf = a => (a === 'selection' && hasSel ? this.sel.bounds : { w: d.width, h: d.height });
    const read = root => {
      const f = n => root.querySelector(`[name="${n}"]`);
      return sanitizeExportOptions({
        format: f('format').value, scale: f('scale').value, quality: f('quality').value,
        // a canvas without paper keeps the remembered choice for the next one that has paper
        paper: d.paper ? f('paper').checked : o.paper,
        area: f('area').checked ? 'selection' : 'canvas',
      });
    };
    return modal({
      title: 'Export',
      body: `
        <label class="field"><span>File name</span><input type="text" name="name" value="${esc(d.title)}" maxlength="80"></label>
        <div class="field-row">
          <label class="field"><span>Format</span><select name="format">${EXPORT_FORMATS.map(f =>
            `<option value="${f.id}"${f.id === o.format ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Size (%)</span><input type="number" name="scale" min="1" max="800" step="any" value="${o.scale}"></label>
        </div>
        <p class="muted small" data-note></p>
        <label class="slider" data-quality><span>Quality</span><input type="range" name="quality" min="1" max="100" value="${o.quality}"><output></output></label>
        <label class="check"><input type="checkbox" name="paper"${o.paper && d.paper ? ' checked' : ''}${d.paper ? '' : ' disabled'}> Include the paper colour${d.paper ? '' : ' (this canvas has none)'}</label>
        <label class="check"><input type="checkbox" name="area"${o.area === 'selection' && hasSel ? ' checked' : ''}${hasSel ? '' : ' disabled'}> Only the selected area${hasSel ? '' : ' (nothing is selected)'}</label>
        <p class="small" data-size></p>
        <p class="muted small">Saved in Pictures\\KoeStudio\\Exports; an existing file is never overwritten.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Export', primary: true }],
      onOpen: root => {
        const show = () => {
          const p = read(root), fmt = EXPORT_BY_ID[p.format], a = areaOf(p.area), size = exportSize(a.w, a.h, p.scale);
          root.querySelector('[data-note]').textContent = fmt.note;
          root.querySelector('[data-quality]').hidden = !fmt.quality;
          root.querySelector('[data-quality] output').textContent = p.quality + '%';
          const clear = !p.paper || !d.paper;
          const el = root.querySelector('[data-size]');
          el.textContent = `Result: ${size.w} × ${size.h} px` +
            (size.tooBig ? ` — too big, at most ${EXPORT_MAX_SIDE} px a side` : clear ? (fmt.flatten ? ', on white' : ', transparent background') : '');
          el.classList.toggle('error', size.tooBig);
        };
        root.querySelectorAll('input, select').forEach(el => el.addEventListener('input', show));
        root.querySelector('[name="name"]').select();
        show();
      },
      collect: root => {
        const opts = read(root), a = areaOf(opts.area);
        if (exportSize(a.w, a.h, opts.scale).tooBig) return undefined;
        return { opts, name: root.querySelector('[name="name"]').value.trim() || d.title };
      },
    });
  },

  /** File → Earlier versions…: saves, lists the kept versions, and opens the chosen one as a new artwork. */
  async openEarlierVersion() {
    await this.flush();
    if (!this.doc.id) return;
    const doc = await versionsDialog(this.doc.id, this.doc.title);
    if (doc) this.onOpen({ newDoc: doc });
  },

  /** Writes a self-contained .koe project (layers, masks, text, rulers…) to the Exports folder; reopen it with "Open image or project…" in the gallery. */
  async saveProjectFile() {
    if (this.xf || this.textEdit) { toast('Finish the current edit first.'); return; }
    try {
      const json = await this.doc.toJSON();
      const res = await api.exportImage(this.doc.title, 'koe', new Blob([JSON.stringify(json)]));
      toast('Project saved to ' + res.path, { action: showFolder, ms: 6000 });
    } catch (e) {
      toast('Could not save project: ' + e.message, { error: true });
    }
  },
};
