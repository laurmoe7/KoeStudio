// Exporting the picture (Export dialog: format, size, quality, background, area, folder and file name) and the
// project file, as Editor methods. Where files go is picked with the file browser (filebrowser.js) and remembered
// (koe.exportDir for pictures, koe.projectDir for project files; '' is Pictures\KoeStudio\Exports).

import { api } from '../api.js';
import { composite, renderFolder } from '../doc.js';
import { allLayers } from '../tree.js';
import { EXPORT_FORMATS, EXPORT_BY_ID, EXPORT_MAX_SIDE, encodePixels, encodeGifAnimation, exportSize, sanitizeExportOptions } from '../imageformats.js';
import { animFrames, frameDelays } from '../anim.js';
import { pngWithDpi, jpegWithDpi } from '../resolution.js';
import { esc, toast, modal, store, confirmBox } from '../ui.js';
import { versionsDialog, newCanvasDialog, importImage } from './gallery.js';
import { browseFile } from './filebrowser.js';

const showFolder = folder => ({ label: 'Show folder', run: () => api.openFolder('', folder).catch(e => toast(e.message, { error: true })) });
const dirLabel = dir => dir || 'Exports folder (Pictures\\KoeStudio\\Exports)';

/**
 * Writes an exported file into dir. ask: a file of that name is replaced only after asking (otherwise the new one
 * is numbered). A remembered folder that has gone away falls back to the Exports folder. Resolves to the server's
 * {path, folder}, or null when the user chose not to replace.
 */
async function writeExport(name, ext, blob, dir, ask) {
  try {
    return await api.exportImage(name, ext, blob, { dir, mode: ask ? 'ask' : 'number' });
  } catch (e) {
    if (e.data?.exists) {
      if (!await confirmBox('Replace file', `${name}.${ext} already exists in ${dir || 'the Exports folder'}. Replace it?`, 'Replace')) return null;
      return api.exportImage(name, ext, blob, { dir, mode: 'replace' });
    }
    if (dir && /does not exist/.test(e.message)) {
      toast(`${dir} is not there any more; saving in the Exports folder instead.`);
      return api.exportImage(name, ext, blob, { mode: ask ? 'ask' : 'number' });
    }
    throw e;
  }
}

export const exportMethods = {
  /**
   * Exports the flattened picture. exportAs('png') exports straight away (whole canvas, 100%, with paper, into the
   * last export folder, numbered if the name is taken); without a format the Export dialog asks, and its choices
   * are kept (koe.exportOpts, koe.exportDir).
   */
  async exportAs(format) {
    this.finishText();
    let o, name = this.doc.title, dir = store('exportDir') || '';
    if (format) o = sanitizeExportOptions({ format });
    else {
      const res = await this.exportDialog(sanitizeExportOptions(store('exportOpts')), dir);
      if (!res) return;
      ({ opts: o, name, dir } = res);
      store('exportOpts', o);
      store('exportDir', dir);
    }
    const fmt = EXPORT_BY_ID[o.format];
    try {
      const canvas = this.exportCanvas(o, fmt);
      let blob;
      if (['gif', 'tga', 'bmp'].includes(fmt.id)) {
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        blob = new Blob([encodePixels(fmt.id, data, canvas.width, canvas.height, this.doc.dpi)]);
      } else {
        blob = await new Promise(r => canvas.toBlob(r, fmt.mime, fmt.quality ? o.quality / 100 : undefined));
        if (!blob || blob.type !== fmt.mime) throw new Error(`This window cannot make ${fmt.label} files`);
        // the artwork's resolution goes into the file, so it prints at the same size elsewhere
        if (fmt.id === 'png') blob = new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), this.doc.dpi)], { type: fmt.mime });
        if (fmt.id === 'jpg') blob = new Blob([jpegWithDpi(new Uint8Array(await blob.arrayBuffer()), this.doc.dpi)], { type: fmt.mime });
      }
      const res = await writeExport(name, fmt.ext, blob, dir, !format);
      if (res) toast(`Exported ${canvas.width} × ${canvas.height} ${fmt.label} to ${res.path}`, { action: showFolder(res.folder), ms: 6000 });
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
    composite(sctx, o.paper ? d : { paper: null, root: d.root, anim: d.anim, active: d.active }, area, null, o.view || null);
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

  /** The Export dialog. Resolves to {opts, name, dir}, or null when cancelled. */
  exportDialog(o, dir) {
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
        <label class="field"><span>Save in</span>
          <div class="fb-dest"><span class="fb-path" data-dest></span><button type="button" data-browse>Browse…</button></div></label>`,
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
        const dest = root.querySelector('[data-dest]');
        const showDir = () => { dest.textContent = dirLabel(dir); dest.title = dirLabel(dir); };
        root.querySelector('[data-browse]').onclick = async () => {
          const nameEl = root.querySelector('[name="name"]');
          const pick = await browseFile({ title: 'Export to', dir, name: nameEl.value.trim() || d.title, ext: EXPORT_BY_ID[read(root).format].ext, okLabel: 'Choose' });
          if (pick) { dir = pick.dir; nameEl.value = pick.name; showDir(); }
        };
        root.querySelector('[name="name"]').select();
        showDir();
        show();
      },
      collect: root => {
        const opts = read(root), a = areaOf(opts.area);
        if (exportSize(a.w, a.h, opts.scale).tooBig) return undefined;
        return { opts, dir, name: root.querySelector('[name="name"]').value.trim() || d.title };
      },
    });
  },

  /**
   * File → Export animation…: every frame (anim.js) as an animated GIF at the animation's speed, or as numbered PNG
   * files (name-001.png, …) for video editors. Onion skins are never exported.
   */
  async exportAnimation() {
    const d = this.doc;
    if (!d.anim.on) return toast('Turn on View → Animation timeline first.');
    const n = animFrames(d.root.children, d.anim).frames.length;
    if (!n) return toast('There are no frames to export: show at least one layer.');
    this.stopAnimation();
    this.finishText();
    const saved = store('animExport') || {};
    let dir = store('exportDir') || '';
    const read = root => {
      const f = k => root.querySelector(`[name="${k}"]`);
      return { ...sanitizeExportOptions({ scale: f('scale').value, paper: d.paper ? f('paper').checked : saved.paper !== false }),
        format: f('format').value === 'png' ? 'png' : 'gif', name: f('name').value.trim() || d.title };
    };
    const res = await modal({
      title: 'Export animation',
      body: `
        <label class="field"><span>File name</span><input type="text" name="name" value="${esc(d.title)}" maxlength="80"></label>
        <div class="field-row">
          <label class="field"><span>Format</span><select name="format">
            <option value="gif"${saved.format !== 'png' ? ' selected' : ''}>Animated GIF</option>
            <option value="png"${saved.format === 'png' ? ' selected' : ''}>PNG frames (one file per frame)</option></select></label>
          <label class="field"><span>Size (%)</span><input type="number" name="scale" min="1" max="800" step="any" value="${sanitizeExportOptions(saved).scale}"></label>
        </div>
        <label class="check"><input type="checkbox" name="paper"${saved.paper !== false && d.paper ? ' checked' : ''}${d.paper ? '' : ' disabled'}> Include the paper colour</label>
        <p class="small" data-size></p>
        <label class="field"><span>Save in</span>
          <div class="fb-dest"><span class="fb-path" data-dest></span><button type="button" data-browse>Browse…</button></div></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Export', primary: true }],
      onOpen: root => {
        const show = () => {
          const p = read(root), size = exportSize(d.width, d.height, p.scale);
          const el = root.querySelector('[data-size]');
          el.textContent = `${n} frames of ${size.w} × ${size.h} px at ${d.anim.fps} fps` + (p.format === 'gif' ? (d.anim.loop ? ', looping' : ', playing once') + '. GIF has at most 256 colours per frame.' : `: ${p.name}-001.png and on.`)
            + (size.tooBig ? ` Too big: at most ${EXPORT_MAX_SIDE} px a side.` : '');
          el.classList.toggle('error', size.tooBig);
        };
        root.querySelectorAll('input, select').forEach(el => el.addEventListener('input', show));
        const dest = root.querySelector('[data-dest]');
        const showDir = () => { dest.textContent = dirLabel(dir); dest.title = dirLabel(dir); };
        root.querySelector('[data-browse]').onclick = async () => {
          const p = read(root), pick = await browseFile({ title: 'Export to', dir, name: p.name, ext: p.format, okLabel: 'Choose' });
          if (pick) { dir = pick.dir; root.querySelector('[name="name"]').value = pick.name; showDir(); }
        };
        root.querySelector('[name="name"]').select();
        showDir();
        show();
      },
      collect: root => (exportSize(d.width, d.height, read(root).scale).tooBig ? undefined : read(root)),
    });
    if (!res) return;
    store('animExport', { format: res.format, scale: res.scale, paper: res.paper });
    store('exportDir', dir);
    const frame = i => this.exportCanvas({ ...res, area: 'canvas', view: { frame: i, onion: false } }, EXPORT_BY_ID[res.format]);
    try {
      if (res.format === 'gif') {
        let w = 0, h = 0;
        const pixels = [];
        for (let i = 0; i < n; i++) {
          const c = frame(i);
          w = c.width; h = c.height;
          pixels.push(c.getContext('2d').getImageData(0, 0, w, h).data);
        }
        const gif = encodeGifAnimation(pixels, w, h, frameDelays(d.anim.fps, n), d.anim.loop);
        const r = await writeExport(res.name, 'gif', new Blob([gif]), dir, true);
        if (r) toast(`Exported a ${n}-frame GIF to ${r.path}`, { action: showFolder(r.folder), ms: 6000 });
        return;
      }
      let mode = 'ask', last = null;
      for (let i = 0; i < n; i++) {
        const c = frame(i);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const png = new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), d.dpi)], { type: 'image/png' });
        const name = `${res.name}-${String(i + 1).padStart(3, '0')}`;
        try {
          last = await api.exportImage(name, 'png', png, { dir, mode });
        } catch (e) {
          if (!e.data?.exists) throw e;
          if (!await confirmBox('Replace frames', `${name}.png already exists in ${dirLabel(dir)}. Replace it and any other frames of the same name?`, 'Replace')) return;
          mode = 'replace';
          last = await api.exportImage(name, 'png', png, { dir, mode });
        }
      }
      if (last) toast(`Exported ${n} frames to ${last.folder}`, { action: showFolder(last.folder), ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    }
  },

  /**
   * File → Export layers…: each layer (or each top-level layer and folder, as it looks) as its own canvas-sized
   * transparent PNG, named "<name>-01-<layer name>.png" from the bottom up, for other programs and game engines.
   */
  async exportLayers() {
    const d = this.doc;
    this.finishText();
    this.stopAnimation?.();
    let dir = store('exportDir') || '';
    const saved = store('layerExport') || {};
    const res = await modal({
      title: 'Export layers',
      body: `
        <label class="field"><span>File names start with</span><input type="text" name="name" value="${esc(d.title)}" maxlength="60"></label>
        <label class="field"><span>Export</span><select name="which">
          <option value="top"${saved.which !== 'all' ? ' selected' : ''}>Each top-level layer or folder (a folder as one picture)</option>
          <option value="all"${saved.which === 'all' ? ' selected' : ''}>Every layer on its own</option></select></label>
        <label class="check"><input type="checkbox" name="hidden"${saved.hidden ? ' checked' : ''}> Hidden layers too</label>
        <p class="muted small">Each file is the size of the canvas, with a transparent background, so the parts line up when they are put together again.</p>
        <label class="field"><span>Save in</span>
          <div class="fb-dest"><span class="fb-path" data-dest></span><button type="button" data-browse>Browse…</button></div></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Export', primary: true }],
      onOpen: root => {
        const dest = root.querySelector('[data-dest]');
        const showDir = () => { dest.textContent = dirLabel(dir); dest.title = dirLabel(dir); };
        root.querySelector('[data-browse]').onclick = async () => {
          const pick = await browseFile({ title: 'Export to', dir, name: d.title, ext: 'png', okLabel: 'Choose' });
          if (pick) { dir = pick.dir; showDir(); }
        };
        showDir();
      },
      collect: root => ({ name: root.querySelector('[name="name"]').value.trim() || d.title,
        which: root.querySelector('[name="which"]').value, hidden: root.querySelector('[name="hidden"]').checked }),
    });
    if (!res) return;
    store('layerExport', { which: res.which, hidden: res.hidden });
    store('exportDir', dir);
    const parts = layerExportParts(d.root, res.which, res.hidden);
    if (!parts.length) return toast('There are no layers to export.');
    const full = { x: 0, y: 0, w: d.width, h: d.height };
    let mode = 'ask', last = null;
    try {
      for (let i = 0; i < parts.length; i++) {
        const { name: partName, draw, clipTo } = parts[i], c = document.createElement('canvas');
        c.width = d.width; c.height = d.height;
        const ctx = c.getContext('2d');
        drawShown(ctx, draw, full);
        if (clipTo) {  // a clipped layer on its own: cut down to the layer it clips to, as it shows in the picture
          const b = document.createElement('canvas');
          b.width = d.width; b.height = d.height;
          drawShown(b.getContext('2d'), [clipTo], full);
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(b, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
        }
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const png = new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), d.dpi)], { type: 'image/png' });
        const name = `${res.name}-${String(i + 1).padStart(2, '0')}-${partName}`;
        try {
          last = await api.exportImage(name, 'png', png, { dir, mode });
        } catch (e) {
          if (!e.data?.exists) throw e;
          if (!await confirmBox('Replace files', `${name}.png already exists in ${dirLabel(dir)}. Replace it and any other layer files of the same name?`, 'Replace')) return;
          mode = 'replace';
          last = await api.exportImage(name, 'png', png, { dir, mode });
        }
      }
      if (last) toast(`Exported ${parts.length} layer${parts.length === 1 ? '' : 's'} to ${last.folder}`, { action: showFolder(last.folder), ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    }
  },

  /** File → Earlier versions…: saves, lists the kept versions, and opens the chosen one as a new artwork. */
  async openEarlierVersion() {
    await this.flush();
    if (!this.doc.id) return;
    const doc = await versionsDialog(this.doc.id, this.doc.title);
    if (doc) this.onOpen({ newDoc: doc });
  },

  /** File → New canvas…: the gallery's dialog; this artwork is saved before the new one opens (app.js). */
  async newCanvas() {
    this.finishText?.();
    const doc = await newCanvasDialog();
    if (doc) this.onOpen({ newDoc: doc });
  },

  /** File → Open image or project…: as in the gallery, the file opens as a new artwork. */
  openOther() {
    this.finishText?.();
    importImage(this.onOpen);
  },

  /**
   * Writes a self-contained .koe project (layers, masks, text, rulers…) where the user picks in the file browser;
   * reopen it with "Open image or project…" in the gallery or by double-clicking it.
   */
  async saveProjectFile() {
    if (this.xf || this.textEdit) { toast('Finish the current edit first.'); return; }
    const pick = await browseFile({ title: 'Save project file', dir: store('projectDir') || '', name: this.doc.title, ext: 'koe', okLabel: 'Save' });
    if (!pick) return;
    store('projectDir', pick.dir);
    try {
      const json = await this.doc.toJSON();
      const res = await writeExport(pick.name, 'koe', new Blob([JSON.stringify(json)]), pick.dir, true);
      if (res) toast('Project saved to ' + res.path, { action: showFolder(res.folder), ms: 6000 });
    } catch (e) {
      toast('Could not save project: ' + e.message, { error: true });
    }
  },
};

/**
 * What File → Export layers writes, bottom first: [{name, draw (nodes drawn together), clipTo (a clipped layer's
 * base, or null)}]. 'top': each top-level node with the layers clipped to it, so the part looks as it does in the
 * picture; 'all': every layer, a clipped one cut to its base. Correction layers alone have nothing to show.
 */
export function layerExportParts(root, which, hidden) {
  const shown = n => hidden || n.visible;
  const out = [];
  if (which === 'all') {
    for (const n of allLayers(root)) {
      let ok = !n.adjust;
      for (let x = n; ok && x && x !== root; x = x.parent) if (!shown(x)) ok = false;
      if (ok) out.push({ name: n.name, draw: [n], clipTo: clipBase(n) });
    }
    return out;
  }
  const kids = root.children;
  for (let i = 0; i < kids.length; i++) {
    let j = i + 1;
    while (j < kids.length && kids[j].clip) j++;
    const base = kids[i], group = kids.slice(i, j).filter(shown);
    i = j - 1;
    if (shown(base) && !base.adjust) out.push({ name: base.name, draw: group, clipTo: null });
  }
  return out;
}

/** The node a clipped node clips to, as composite() reads clipping (a clipped bottom node clips to nothing). */
function clipBase(n) {
  const sib = n.parent?.children || [];
  let i = sib.indexOf(n);
  if (!n.clip || i <= 0) return null;
  while (i > 0 && sib[i].clip) i--;
  return sib[i];
}

/** Draws nodes together as if each were shown (hidden ones only get here when asked for). */
function drawShown(ctx, nodes, r) {
  const vis = nodes.map(n => n.visible);
  nodes.forEach(n => { n.visible = true; });
  try { renderFolder(ctx, { children: nodes }, r); } finally { nodes.forEach((n, k) => { n.visible = vis[k]; }); }
}
