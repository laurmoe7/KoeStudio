// Saved brushes, tip and texture images, and importing Procreate, Photoshop, GIMP and Krita brushes, as Editor methods.
//
// The brush library lives in the app folder (app.py: <app dir>/brushes): images ({id, name, kind: 'tip' |
// 'texture'}) and presets ({id, name, settings, source}). Paint tools name an image as 'img:<id>' in their tip or
// texture setting; images are loaded once (loadBrushLibrary) and registered with painter.js. A preset is a full
// set of paint settings (BRUSH_KEYS) that any paint tool can take on; the tool remembers which one in `preset`.
// Importing (app.py → brushimport.py) reads every brush in a .brush/.brushset/.abr file with its tip and texture
// images; the dialog picks which to keep, saves their images (each once) and adds them as presets.

import { api } from '../api.js';
import { curveAt, stampAt, previewPath, previewSettings } from '../brush.js';
import { tipMask, textureGray, whiteToAlpha, fitSide, imageRef, TIP_MAX, TEXTURE_MAX } from '../brushtip.js';
import { loadImage, liveSource } from '../doc.js';
import { Painter, registerTip, registerTexture, forgetBrushImage, textureFor, grainFor } from '../painter.js';
import { sanitizeBrush, strokeStamps, dualStamps, seeded } from '../vector.js';
import { TEXTURES } from '../textures.js';
import { TIPS, TOOL_BY_ID, BRUSH_KEYS, SETTING_GROUPS, applySettings } from '../tools.js';
import { BUILTIN_BY_ID, builtinBrushesFor, brushListGroups } from '../builtinbrushes.js';
import { esc, toast, menu, modal, promptBox, confirmBox, store } from '../ui.js';
import { icon } from '../icons.js';

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const IMG_RE = /^image\//;
const PREVIEW_H = 76;  // height of the stroke preview in the Brush settings window, CSS px
const PREVIEW_SEED = 12345;  // the preview's jitter is the same every time, so changing a setting shows only that change

/** Reads an image file as PNG bytes (other formats are converted), with its name without the extension. */
async function fileAsPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not read that image.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

/** A small picture of a pressure curve (x: pressure, y: result). */
export function curveSvg(pts) {
  const line = Array.from({ length: 25 }, (_, i) => `${(i / 24 * 40).toFixed(1)},${(16 - curveAt(pts, i / 24) * 16).toFixed(1)}`).join(' ');
  return `<svg class="curve" viewBox="-1 -1 42 18" aria-hidden="true"><rect x="0" y="0" width="40" height="16"/><polyline points="${line}"/></svg>`;
}

export const brushMethods = {
  /** Loads the brush library from the app folder and registers its images; settings naming a missing image fall back. */
  async loadBrushLibrary() {
    try {
      this.brushLib = await api.brushes();
    } catch {
      this.brushLib = { images: [], presets: [] };
    }
    await Promise.all(this.brushLib.images.map(i => this.registerBrushImage(i).catch(() => {})));
    this.brushThumbs?.clear();  // strokes drawn before the tip images were ready
    if (!this.destroyed) this.renderToolProps();
  },

  async registerBrushImage(entry) {
    const img = await loadImage(api.brushImageUrl(entry.id));
    const { w, h } = fitSide(img.naturalWidth, img.naturalHeight, entry.kind === 'tip' ? TIP_MAX : TEXTURE_MAX);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    if (entry.kind === 'tip') {
      const mask = tipMask(data.data), out = new ImageData(w, h);
      for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = mask[i];
      ctx.putImageData(out, 0, 0);
      registerTip(entry.id, c);
    } else registerTexture(entry.id, textureGray(data.data), w, h);
    entry.ready = true;
    this.brushThumbs?.clear();
  },

  brushImages(kind) {
    return (this.brushLib?.images || []).filter(i => i.kind === kind && i.ready);
  },

  /** Options for the Tip and Texture choices: the built-in ones plus the library's images. */
  tipChoices() { return [...TIPS, ...this.brushImages('tip').map(i => [`img:${i.id}`, i.name])]; },
  textureChoices() { return [...TEXTURES, ...this.brushImages('texture').map(i => [`img:${i.id}`, i.name])]; },

  /** The Brush row at the top of a paint tool's panel: the built-in or saved brush it came from, and the brush menu. */
  presetRowHtml(s) {
    const presets = this.brushLib?.presets || [], builtin = builtinBrushesFor(this.tool);
    const cur = this.presetById(s.preset) ? s.preset : '';
    const opt = p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`;
    const groups = [...new Set(builtin.map(b => b.group))].map(g =>
      `<optgroup label="${esc(g)}">${builtin.filter(b => b.group === g).map(opt).join('')}</optgroup>`).join('');
    return `<div class="preset-row"><label class="slider" title="Ready-made and saved brushes: pick one to load its settings"><span>Brush</span>
      <select data-preset><option value="">Custom</option>${groups}${presets.length ? `<optgroup label="Your brushes">${presets.map(opt).join('')}</optgroup>` : ''}</select></label>
      <button class="icon-btn${this.brushListWin ? ' on' : ''}" data-brush-list title="Brushes window: every brush with a sample stroke">${icon('brush', 14)}</button>
      <button class="icon-btn" data-brush-menu title="Save, import and manage brushes">⋯</button></div>`;
  },

  /** A built-in brush (builtinbrushes.js) or one of the user's saved brushes, by id; or undefined. */
  presetById(id) {
    return id ? BUILTIN_BY_ID[id] || this.brushLib?.presets.find(p => p.id === id) : undefined;
  },

  bindPresetRow(box) {
    const sel = box.querySelector('[data-preset]');
    if (sel) sel.onchange = () => { if (sel.value) this.applyPreset(sel.value); };
    const btn = box.querySelector('[data-brush-menu]');
    if (btn) btn.onclick = () => this.brushMenu(btn);
    const list = box.querySelector('[data-brush-list]');
    if (list) list.onclick = () => this.toggleBrushList();
  },

  // ---------- the Brush settings window ----------

  /**
   * Opens or closes the Brush settings window: every setting of the current paint tool, a page per group
   * (SETTING_GROUPS), in a floating window you can paint beside (as Clip Studio Paint's Sub Tool Detail). The tool
   * panel keeps only the basics (BASIC_PAINT). Whether it is open, where it is and the page are remembered.
   */
  toggleBrushWindow(open = !this.brushWinState().open) {
    store('brushWin', { ...this.brushWinState(), open });
    this.renderToolProps();
  },

  brushWinState() {
    const st = store('brushWin');
    return { open: !!st?.open, x: Number.isFinite(st?.x) ? st.x : 300, y: Number.isFinite(st?.y) ? st.y : 70,
      page: SETTING_GROUPS.some(([g]) => g === st?.page) ? st.page : SETTING_GROUPS[0][0] };
  },

  /** Shows the window for the current tool (paint tools only; it comes back when a paint tool is picked again). */
  renderBrushWindow() {
    const t = TOOL_BY_ID[this.tool], st = this.brushWinState();
    if (!st.open || t.kind !== 'paint' || this.destroyed) { this.brushWin?.remove(); this.brushWin = null; return; }
    let w = this.brushWin;
    if (!w) {
      w = this.brushWin = document.createElement('div');
      w.className = 'brush-win';
      w.setAttribute('role', 'dialog');
      w.innerHTML = `<div class="bw-head"><span class="bw-title"></span><button class="icon-btn" data-bw-close title="Close">✕</button></div>
        <canvas class="bw-preview" title="How a stroke with these settings looks (light to full pressure and back)"></canvas>
        <div class="bw-main"><nav class="bw-nav"></nav><div class="bw-body"></div></div>`;
      this.root.append(w);
      w.querySelector('[data-bw-close]').onclick = () => this.toggleBrushWindow(false);
      this.placeBrushWindow(st.x, st.y);
      const head = w.querySelector('.bw-head');
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        try { head.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        const move = ev => this.placeBrushWindow(ev.clientX - dx, ev.clientY - dy);
        const up = () => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          const b = w.getBoundingClientRect();
          store('brushWin', { ...this.brushWinState(), x: Math.round(b.left), y: Math.round(b.top) });
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
      });
    }
    const s = this.settings[t.id], fields = this.visibleFields(s);
    const preset = this.presetById(s.preset);
    w.querySelector('.bw-title').textContent = `Brush settings · ${t.label}${preset ? ` · ${preset.name}` : ''}`;
    const pages = SETTING_GROUPS.map(([name, keys]) => [name, keys.map(k => fields.find(f => f[0] === k)).filter(Boolean)]).filter(([, fs]) => fs.length);
    const page = pages.find(([name]) => name === st.page) || pages[0];
    const nav = w.querySelector('.bw-nav');
    nav.innerHTML = pages.map(([name]) => `<button data-page="${esc(name)}" class="${name === page[0] ? 'on' : ''}">${esc(name)}</button>`).join('');
    nav.querySelectorAll('[data-page]').forEach(b => {
      b.onclick = () => { store('brushWin', { ...this.brushWinState(), page: b.dataset.page }); this.renderBrushWindow(); };
    });
    const body = w.querySelector('.bw-body');
    body.innerHTML = this.settingsHtml(page[1], s);
    this.bindSettings(body);
    this.drawBrushPreview();
  },

  /** Redraws the stroke preview at the top of the Brush settings window (once per frame, however often asked). */
  drawBrushPreview() {
    if (!this.brushWin || this.previewRaf) return;
    this.previewRaf = requestAnimationFrame(() => {
      this.previewRaf = 0;
      const c = this.brushWin?.querySelector('.bw-preview'), t = TOOL_BY_ID[this.tool];
      if (!c || t.kind !== 'paint') return;
      const dpr = window.devicePixelRatio || 1, w = Math.round((c.clientWidth || 320) * dpr), h = Math.round(PREVIEW_H * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.paintPreviewStroke(c, this.settings[t.id], 1 / 4);
    });
  },

  /**
   * Paints the sample stroke of a brush with settings s across canvas c (its whole size, on white paper), in the
   * main colour (grey for erasers): the real dab pipeline (spacing, pressure, tapers, jitter, colour jitter) as for
   * a vector line. The brush is at most `maxSize` of the height.
   */
  paintPreviewStroke(c, s, maxSize) {
    const t = TOOL_BY_ID[this.tool], dpr = window.devicePixelRatio || 1, w = c.width, h = c.height;
    const ctx = c.getContext('2d');
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // the curve keeps half a brush from the top and bottom (scatter may spill over there) and the scatter too from the sides
    const b = sanitizeBrush(previewSettings(s, h * maxSize)), half = b.size / 2;
    const line = { pts: previewPath(w, h, Math.min(half * (1 + 2 * (b.scatter || 0)) + 10 * dpr, w / 4), half + 5 * dpr), seed: PREVIEW_SEED, color: t.erase ? '#6b6f7a' : this.colors.main };
    const scratch = this.previewScratch ||= document.createElement('canvas');
    scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d');
    const painter = new Painter(sctx, { color: line.color, hardness: b.hardness, tip: b.tip, thickness: b.thickness, angle: b.tipAngle, pixel: b.pixel,
      random: b.tipRandom, follow: b.tipFollow, rnd: seeded(PREVIEW_SEED + 7), grain: grainFor(b) });
    for (const st of strokeStamps(line, b)) {
      const { size, flow } = stampAt(b, st.p);
      painter.dab(st.x, st.y, size * st.k, flow * st.f, 0, st.c, st.a ?? null);
    }
    let dual = null;
    if (b.dualTip !== 'none') {  // the dual brush along the same path, as vector lines draw it
      dual = this.previewDual ||= document.createElement('canvas');
      dual.width = w; dual.height = h;
      const dp = new Painter(dual.getContext('2d'), { color: '#000000', hardness: b.hardness, tip: b.dualTip });
      for (const st of dualStamps(line, b)) dp.dab(st.x, st.y, st.size, 1);
    }
    const r = { x: 0, y: 0, w, h }, [src, sx, sy] = liveSource({ canvas: scratch, texture: textureFor(b), dual }, r);
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    ctx.globalAlpha = 1;
  },

  // ---------- the Brushes window ----------

  /**
   * Opens or closes the Brushes window: every brush the current paint tool can take on (built-in and saved, as in
   * the Brush choice), each with its name and a sample stroke, and a search box. Clicking one loads it. Its place is
   * remembered in koe.brushList = {open, x, y}.
   */
  toggleBrushList(open = !this.brushListState().open) {
    store('brushList', { ...this.brushListState(), open });
    this.renderToolProps();
  },

  brushListState() {
    const st = store('brushList');
    return { open: !!st?.open, x: Number.isFinite(st?.x) ? st.x : 300, y: Number.isFinite(st?.y) ? st.y : 120 };
  },

  /** Shows the window for the current tool (paint tools only), rebuilding its rows; thumbnails come from a cache. */
  renderBrushList() {
    const t = TOOL_BY_ID[this.tool], st = this.brushListState();
    if (!st.open || t.kind !== 'paint' || this.destroyed) { this.brushListWin?.remove(); this.brushListWin = null; return; }
    let w = this.brushListWin;
    if (!w) {
      w = this.brushListWin = document.createElement('div');
      w.className = 'brush-win bl-win';
      w.setAttribute('role', 'dialog');
      w.innerHTML = `<div class="bw-head"><span class="bw-title"></span><button class="icon-btn" data-bl-close title="Close">✕</button></div>
        <input class="bl-search" type="search" placeholder="Search" spellcheck="false" aria-label="Search brushes">
        <div class="bl-list"></div>`;
      this.root.append(w);
      this.placeFloating(w, st.x, st.y);
      this.bindFloatingHead(w, (x, y) => store('brushList', { ...this.brushListState(), x, y }));
      w.querySelector('[data-bl-close]').onclick = () => this.toggleBrushList(false);
      const search = w.querySelector('.bl-search');
      search.value = this.brushListQuery || '';
      search.oninput = () => { this.brushListQuery = search.value; this.renderBrushList(); };
      search.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') search.blur(); };  // typing is not shortcuts
      w.querySelector('.bl-list').onclick = e => {
        const row = e.target.closest('[data-id]');
        if (row) this.applyPreset(row.dataset.id);
      };
    }
    w.querySelector('.bw-title').textContent = `Brushes · ${t.label}`;
    const s = this.settings[t.id], list = w.querySelector('.bl-list'), top = list.scrollTop;
    const groups = brushListGroups(t.id, this.brushLib?.presets || [], this.brushListQuery);
    list.innerHTML = groups.map(g => `<div class="bl-group">${esc(g.name)}</div>${g.brushes.map(b =>
      `<button class="bl-row${b.id === s.preset ? ' on' : ''}" data-id="${esc(b.id)}" title="${esc(b.name)}"><span class="bl-name">${esc(b.name)}</span><canvas class="bl-thumb"></canvas></button>`).join('')}`).join('')
      || '<p class="muted small bl-empty">No brush has that name.</p>';
    list.scrollTop = top;
    this.drawBrushList();
  },

  /**
   * Draws the sample strokes in the Brushes window: a cached picture per brush, settings, colour and width; missing
   * ones are painted a few per frame so a long list never holds up the screen.
   */
  drawBrushList() {
    const w = this.brushListWin, t = TOOL_BY_ID[this.tool];
    if (!w || t.kind !== 'paint') return;
    const cache = this.brushThumbs ||= new Map(), dpr = window.devicePixelRatio || 1, s = this.settings[t.id];
    const todo = [];
    for (const c of w.querySelectorAll('.bl-thumb')) {
      const p = this.presetById(c.closest('[data-id]').dataset.id);
      if (!p) continue;
      const cw = Math.round((c.clientWidth || 180) * dpr), ch = Math.round((c.clientHeight || 40) * dpr);
      const settings = applySettings({ ...s }, p.settings);
      const key = `${t.id}|${cw}x${ch}|${this.colors.main}|${JSON.stringify(settings)}`;
      todo.push({ c, cw, ch, settings, key });
    }
    if (cache.size > 400) cache.clear();
    const show = ({ c, cw, ch, key }) => {
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      c.getContext('2d').drawImage(cache.get(key), 0, 0);
    };
    const missing = [];
    for (const job of todo) (cache.has(job.key) ? show(job) : missing.push(job));
    cancelAnimationFrame(this.brushListRaf);
    const step = () => {
      const t0 = performance.now();
      while (missing.length && performance.now() - t0 < 12) {
        const job = missing.shift();
        if (!cache.has(job.key)) {
          const pic = document.createElement('canvas');
          pic.width = job.cw; pic.height = job.ch;
          this.paintPreviewStroke(pic, job.settings, 0.3);
          cache.set(job.key, pic);
        }
        if (job.c.isConnected) show(job);
      }
      this.brushListRaf = missing.length && !this.destroyed ? requestAnimationFrame(step) : 0;
    };
    if (missing.length) this.brushListRaf = requestAnimationFrame(step);
  },

  /** Moves the window to x, y (screen px), kept on screen with its title bar reachable. */
  placeBrushWindow(x, y) {
    const w = this.brushWin;
    if (!w) return;
    const W = w.offsetWidth || 340;
    w.style.left = Math.max(0, Math.min(window.innerWidth - W, x)) + 'px';
    w.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
  },

  brushMenu(button) {
    const s = this.settings[this.tool], found = this.presetById(s.preset), p = found?.builtin ? null : found;
    menu(button, [
      { label: 'Save as new brush…', run: () => this.saveBrushAs() },
      { label: p ? `Update “${p.name}”` : 'Update brush', disabled: !p, run: () => this.updatePreset(p) },
      { label: 'Rename brush…', disabled: !p, run: () => this.renamePreset(p) },
      { label: 'Delete brush…', disabled: !p, run: () => this.deletePreset(p) },
      '-',
      { label: 'Import brushes (Procreate, Photoshop, GIMP, Krita)…', run: () => this.importBrushFile() },
      '-',
      { label: 'Add tip image…', run: () => this.addBrushImageFile('tip') },
      { label: 'Add texture image…', run: () => this.addBrushImageFile('texture') },
      { label: 'Tip and texture images…', disabled: !this.brushLib?.images.length, run: () => this.brushImagesDialog() },
    ]);
  },

  async savePresetList() {
    try {
      await api.savePresets(this.brushLib.presets.map(({ id, name, settings, source }) => ({ id, name, settings, source })));
      return true;
    } catch (e) {
      toast('Could not save the brushes: ' + e.message, { error: true });
      return false;
    }
  },

  brushSettingsOf(s) { return Object.fromEntries(BRUSH_KEYS.filter(k => k in s).map(k => [k, s[k]])); },

  applyPreset(id) {
    const p = this.presetById(id), s = this.settings[this.tool];
    if (!p || !('tip' in s)) return;
    applySettings(s, p.settings);
    s.preset = p.id;
    store('tools', this.settings);
    this.renderToolProps();
    this.drawOverlay();
  },

  async saveBrushAs() {
    const s = this.settings[this.tool];
    const name = await promptBox('Save as new brush', 'Name', `${TOOL_BY_ID[this.tool].label} ${this.brushLib.presets.length + 1}`);
    if (!name) return;
    const p = { id: newId(), name, settings: this.brushSettingsOf(s) };
    this.brushLib.presets.push(p);
    if (await this.savePresetList()) { s.preset = p.id; store('tools', this.settings); toast(`Saved the brush “${name}”`); }
    this.renderToolProps();
  },

  async updatePreset(p) {
    p.settings = this.brushSettingsOf(this.settings[this.tool]);
    if (await this.savePresetList()) toast(`Updated “${p.name}”`);
  },

  async renamePreset(p) {
    const name = await promptBox('Rename brush', 'Name', p.name);
    if (!name) return;
    p.name = name;
    await this.savePresetList();
    this.renderToolProps();
  },

  async deletePreset(p) {
    if (!(await confirmBox('Delete brush', `Delete the saved brush “${p.name}”? The tool keeps its current settings.`, 'Delete'))) return;
    this.brushLib.presets = this.brushLib.presets.filter(x => x !== p);
    for (const s of Object.values(this.settings)) if (s.preset === p.id) s.preset = '';
    store('tools', this.settings);
    await this.savePresetList();
    this.renderToolProps();
  },

  /** Asks for an image file and adds it to the library; resolves to its entry, or null. */
  async uploadBrushImage(kind, name = '') {
    const file = await pickFile('image/*');
    if (!file) return null;
    if (!IMG_RE.test(file.type || 'image/')) { toast('Choose a picture file (PNG works best).', { error: true }); return null; }
    try {
      const entry = await api.addBrushImage(kind, name || file.name.replace(/\.[^.]+$/, ''), await fileAsPng(file));
      await this.registerBrushImage(entry);
      this.brushLib.images.push(entry);
      return entry;
    } catch (e) {
      toast('Could not add that image: ' + e.message, { error: true });
      return null;
    }
  },

  /** Brush menu → Add tip/texture image…: adds it and uses it in the current paint tool. */
  async addBrushImageFile(kind) {
    const entry = await this.uploadBrushImage(kind);
    if (!entry) return;
    const s = this.settings[this.tool];
    if (kind === 'tip' && 'tip' in s) s.tip = `img:${entry.id}`;
    if (kind === 'texture' && 'texture' in s) { s.texture = `img:${entry.id}`; if (!(s.textureAmount > 0)) s.textureAmount = 0.5; }
    store('tools', this.settings);
    this.renderToolProps();
    toast(`Added the ${kind} “${entry.name}”`);
  },

  async brushImagesDialog() {
    const rows = () => this.brushLib.images.map(i => `<div class="pick-row"><img src="${api.brushImageUrl(i.id)}" alt="">
      <div class="grow"><b>${esc(i.name)}</b><div class="muted small">${i.kind === 'tip' ? 'Tip' : 'Texture'}</div></div>
      <button data-del="${esc(i.id)}">Delete</button></div>`).join('') || '<p class="muted">No images.</p>';
    await modal({
      title: 'Tip and texture images',
      body: `<div class="pick-list">${rows()}</div><p class="muted small">Brushes that use a deleted image go back to a round tip, no texture or no dual tip.</p>`,
      buttons: [{ label: 'Close', value: null, primary: true }],
      onOpen: root => {
        const bind = () => root.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = async () => {
            const id = b.dataset.del;
            try { await api.deleteBrushImage(id); } catch (e) { toast(e.message, { error: true }); return; }
            this.brushLib.images = this.brushLib.images.filter(i => i.id !== id);
            forgetBrushImage(id);
            for (const s of Object.values(this.settings)) {
              if (imageRef(s.tip) === id) s.tip = 'round';
              if (imageRef(s.texture) === id) s.texture = 'none';
              if (imageRef(s.dualTip) === id) s.dualTip = 'none';
            }
            store('tools', this.settings);
            root.querySelector('.pick-list').innerHTML = rows();
            bind();
            this.renderToolProps();
          };
        });
        bind();
      },
    });
  },

  /** A brush file's image as PNG bytes to save: Procreate shapes (white on black) become see-through tips. */
  async importedImagePng(im) {
    if (!im.white) return (await fetch(im.png)).blob();
    const img = await loadImage(im.png);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    whiteToAlpha(data.data, im.invert);
    ctx.putImageData(data, 0, 0);
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not convert a brush tip.'))), 'image/png'));
  },

  /** Brush menu → Import brushes: a Procreate (.brush, .brushset) or Photoshop (.abr) file; pick which to keep. */
  async importBrushFile() {
    const file = await pickFile('.brush,.brushset,.abr,.gbr,.gih,.vbr,.kpp,.bundle');
    if (!file) return;
    let res;
    try {
      res = await api.importBrushes(file.name, await file.arrayBuffer());
    } catch (e) {
      toast(e.message, { error: true });
      return;
    }
    const thumb = b => {
      const im = res.images[b.tip];
      return im ? `<img src="${im.png}" alt=""${im.white ? ' class="white-tip"' : ''}>` : '<span class="round-tip"></span>';
    };
    const chosen = await modal({
      title: `Import brushes from ${file.name}`,
      wide: true,
      body: `<label class="check import-all"><input type="checkbox" data-all checked> All ${res.brushes.length} brush${res.brushes.length === 1 ? '' : 'es'}</label>
        <div class="pick-list import-list">${res.brushes.map((b, i) => `<label class="pick-row"><input type="checkbox" data-i="${i}" checked>${thumb(b)}
          <div class="grow"><b>${esc(b.name)}</b><div class="muted small">${b.texture != null ? 'With texture' : 'No texture'}${b.notes.length ? ` · not carried over: ${esc(b.notes.join(', '))}` : ''}</div></div></label>`).join('')}</div>
        <p class="muted small">Size, opacity, spacing, tip angle, squash and rotation, pen pressure and texture strength come from the brushes. Procreate settings are approximate; check the size after importing.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Import', primary: true }],
      onOpen: root => {
        const boxes = [...root.querySelectorAll('[data-i]')], all = root.querySelector('[data-all]');
        all.onchange = () => boxes.forEach(b => { b.checked = all.checked; });
      },
      collect: root => {
        const picked = [...root.querySelectorAll('[data-i]:checked')].map(b => res.brushes[+b.dataset.i]);
        return picked.length ? picked : undefined;
      },
    });
    if (!chosen) return;
    // the images the chosen brushes use, each saved once
    const saved = new Map();
    try {
      for (const b of chosen) {
        for (const k of [b.tip, b.texture, b.dual]) {
          if (k == null || saved.has(k)) continue;
          const im = res.images[k];
          const entry = await api.addBrushImage(im.kind, im.name, await this.importedImagePng(im));
          await this.registerBrushImage(entry);
          this.brushLib.images.push(entry);
          saved.set(k, entry.id);
        }
      }
    } catch (e) {
      toast('Could not save the brush images: ' + e.message, { error: true });
      return;
    }
    const base = this.brushSettingsOf(TOOL_BY_ID.brush.defaults);
    const presets = chosen.map(b => ({
      id: newId(), name: b.name, source: res.name,
      settings: applySettings({ ...base }, { ...b.settings,
        tip: b.tip != null ? `img:${saved.get(b.tip)}` : 'round', texture: b.texture != null ? `img:${saved.get(b.texture)}` : 'none',
        ...(b.dual != null ? { dualTip: `img:${saved.get(b.dual)}` } : {}) }),
    }));
    this.brushLib.presets.push(...presets);
    if (!(await this.savePresetList())) return;
    if (TOOL_BY_ID[this.tool].kind !== 'paint' || TOOL_BY_ID[this.tool].erase) this.selectTool('brush');
    this.applyPreset(presets[0].id);
    toast(presets.length === 1 ? `Imported “${presets[0].name}”` : `Imported ${presets.length} brushes`);
  },
};
