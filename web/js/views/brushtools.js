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
import { Painter, registerTip, registerTexture, forgetBrushImage, textureFor, grainFor, wetFor } from '../painter.js';
import { sanitizeBrush, strokeStamps, dualStamps, seeded } from '../vector.js';
import { TEXTURES } from '../textures.js';
import { TIPS, TOOL_BY_ID, BRUSH_KEYS, SETTING_GROUPS, applySettings } from '../tools.js';
import { BUILTIN_BY_ID, brushListGroups, brushChanged } from '../builtinbrushes.js';
import { esc, toast, menu, modal, promptBox, confirmBox, store } from '../ui.js';
import { icon } from '../icons.js';
import { PICK_ALL_UP_TO, pickMatches, rangePick, noteSummary } from '../brushpick.js';
import { presetGroups, groupLabel } from '../brushorg.js';

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const IMG_RE = /^image\//;
/** The Brushes window's stroke sizes: [name, stroke height in CSS px]. */
const BRUSH_LIST_SIZES = { s: ['Small', 26], m: ['Medium', 40], l: ['Large', 64] };
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

/** Makes a decoded tip or texture image available to brushes as 'img:<id>' (tips: the shape as alpha). */
function registerImage(id, kind, img) {
  const { w, h } = fitSide(img.naturalWidth, img.naturalHeight, kind === 'tip' ? TIP_MAX : TEXTURE_MAX);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (kind === 'tip') {
    const mask = tipMask(data.data), out = new ImageData(w, h);
    for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = mask[i];
    ctx.putImageData(out, 0, 0);
    registerTip(id, c);
  } else registerTexture(id, textureGray(data.data), w, h);
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
    registerImage(entry.id, entry.kind, await loadImage(api.brushImageUrl(entry.id)));
    entry.ready = true;
    this.brushThumbs?.clear();
  },

  brushImages(kind) {
    return (this.brushLib?.images || []).filter(i => i.kind === kind && i.ready);
  },

  /** Options for the Tip and Texture choices: the built-in ones plus the library's images. */
  tipChoices() { return [...TIPS, ...this.brushImages('tip').map(i => [`img:${i.id}`, i.name])]; },
  textureChoices() { return [...TEXTURES, ...this.brushImages('texture').map(i => [`img:${i.id}`, i.name])]; },

  /**
   * The Brush row at the top of a paint tool's panel: the built-in or saved brush it came from (with * once its
   * settings were changed) and the brush menu, over a strip with the current brush's stroke that opens the Brushes
   * window.
   */
  presetRowHtml(s) {
    const cur = this.presetById(s.preset) ? s.preset : '', star = brushChanged(s, this.presetById(cur)) ? ' *' : '';
    const opt = p => `<option value="${esc(p.id)}" ${p.id === cur ? `selected data-name="${esc(p.name)}">${esc(p.name + star)}` : `>${esc(p.name)}`}</option>`;
    // the same groups as the Brushes window (hidden ones left out, but the brush in use is always there)
    const list = brushListGroups(this.tool, this.brushLib?.presets || [], '', this.hiddenBrushGroups());
    if (cur && !list.some(g => g.brushes.some(b => b.id === cur))) list.push({ name: 'Hidden group', brushes: [this.presetById(cur)] });
    const groups = list.map(g => `<optgroup label="${esc(g.name)}">${g.brushes.map(opt).join('')}</optgroup>`).join('');
    return `<div class="preset-row"><label class="slider" title="Ready-made and saved brushes: pick one to load its settings"><span>Brush</span>
      <select data-preset><option value="">Custom</option>${groups}</select></label>
      <button class="icon-btn" data-brush-menu title="Save, import and manage brushes">⋯</button></div>
      <button class="brush-strip${this.brushListWin ? ' on' : ''}" data-brush-list title="The current brush. Click to choose from every brush, each with a sample stroke">
        <canvas></canvas><span class="bs-more">${icon('brush', 14)}</span></button>`;
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

  /**
   * Redraws the current brush's strokes (the Brush settings window's preview and the strip in the tool panel) and
   * its changed mark (*), once per frame however often asked.
   */
  drawBrushPreview() {
    if (this.previewRaf) return;
    this.previewRaf = requestAnimationFrame(() => {
      this.previewRaf = 0;
      const t = TOOL_BY_ID[this.tool];
      if (t.kind !== 'paint' || this.destroyed) return;
      const s = this.settings[t.id], dpr = window.devicePixelRatio || 1;
      for (const [c, maxSize] of [[this.brushWin?.querySelector('.bw-preview'), 1 / 4], [this.root.querySelector('.brush-strip canvas'), 0.35]]) {
        if (!c?.clientWidth) continue;
        const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        this.paintPreviewStroke(c, s, maxSize);
      }
      this.markBrushChanged();
    });
  },

  /** Shows whether the current brush was changed since it was loaded: * after its name in the Brush row and the Brushes window. */
  markBrushChanged() {
    const s = this.settings[this.tool], changed = brushChanged(s, this.presetById(s.preset));
    const opt = this.root.querySelector('.tool-props [data-preset] option[data-name]');
    if (opt) opt.textContent = opt.dataset.name + (changed ? ' *' : '');
    this.brushListWin?.querySelectorAll('.bl-row').forEach(r => r.classList.toggle('changed', changed && r.dataset.id === s.preset));
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
    const r = { x: 0, y: 0, w, h }, [src, sx, sy] = liveSource({ canvas: scratch, texture: textureFor(b), wet: wetFor(b), dual }, r);
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
    ctx.globalAlpha = 1;
  },

  // ---------- the Brushes window ----------

  /**
   * Opens or closes the Brushes window: every brush the current paint tool can take on (built-in and saved, as in
   * the Brush choice), each with its name and a sample stroke, a search box, three stroke sizes and a menu per brush
   * (right-click). Clicking one loads it; the arrow keys step through them. Its place, size and stroke size are
   * remembered in koe.brushList = {open, x, y, w, h, size}.
   */
  toggleBrushList(open = !this.brushListState().open) {
    store('brushList', { ...this.brushListState(), open });
    this.renderToolProps();
  },

  brushListState() {
    const st = store('brushList'), num = v => (Number.isFinite(v) ? v : null);
    return { open: !!st?.open, x: num(st?.x) ?? 300, y: num(st?.y) ?? 120, w: num(st?.w), h: num(st?.h),
      size: BRUSH_LIST_SIZES[st?.size] ? st.size : 'm' };
  },

  /** Shows the window for the current tool (paint tools only), rebuilding its rows; thumbnails come from a cache. */
  renderBrushList() {
    const t = TOOL_BY_ID[this.tool], st = this.brushListState();
    if (!st.open || t.kind !== 'paint' || this.destroyed) {
      this.brushListObs?.disconnect();
      this.brushListWin?.remove();
      this.brushListWin = null;
      return;
    }
    const fresh = !this.brushListWin || this.brushListTool !== t.id;
    const w = this.brushListWin || this.createBrushList(st);
    this.brushListTool = t.id;
    w.querySelector('.bw-title').textContent = `Brushes · ${t.label}`;
    w.dataset.size = st.size;
    w.querySelectorAll('[data-bl-size]').forEach(b => b.classList.toggle('on', b.dataset.blSize === st.size));
    const s = this.settings[t.id], list = w.querySelector('.bl-list'), top = list.scrollTop;
    const groups = brushListGroups(t.id, this.brushLib?.presets || [], this.brushListQuery, this.hiddenBrushGroups());
    list.innerHTML = groups.map(g => `<div class="bl-group">${esc(g.name)}</div>${g.brushes.map(b =>
      `<button class="bl-row${b.id === s.preset ? ' on' : ''}" data-id="${esc(b.id)}" title="${esc(b.name)}${b.builtin ? '' : ' (your brush)'}. Right-click for more">
        <span class="bl-name">${esc(b.name)}<i class="bl-star" title="Changed since it was loaded: click to load it again">*</i></span><canvas class="bl-thumb"></canvas></button>`).join('')}`).join('')
      || '<p class="muted small bl-empty">No brush has that name.</p>';
    list.scrollTop = top;
    this.markBrushChanged();
    if (fresh) list.querySelector('.bl-row.on')?.scrollIntoView({ block: 'nearest' });
    this.drawBrushList();
  },

  /** Makes the Brushes window (renderBrushList fills it). */
  createBrushList(st) {
    const w = this.brushListWin = document.createElement('div');
    w.className = 'brush-win bl-win';
    w.setAttribute('role', 'dialog');
    w.innerHTML = `<div class="bw-head"><span class="bw-title"></span><button class="icon-btn" data-bl-close title="Close">✕</button></div>
      <div class="bl-bar"><input class="bl-search" type="search" placeholder="Search" spellcheck="false" aria-label="Search brushes" title="Type part of a name; ↑ ↓ pick the brush above or below">
        <span class="bl-sizes">${Object.entries(BRUSH_LIST_SIZES).map(([k, [label]]) => `<button data-bl-size="${k}" title="${label} strokes"><i class="bl-size-${k}"></i></button>`).join('')}</span></div>
      <div class="bl-list"></div>
      <div class="bl-foot"><button data-bl-act="save" title="Keep the current settings as a brush of your own">${icon('plus', 14)} Save as new…</button>
        <button data-bl-act="import" title="Procreate, Photoshop, GIMP and Krita brushes">Import…</button>
        <button data-bl-act="manage" title="Put your brushes in groups and in order, hide groups, delete brushes">Manage…</button></div>`;
    if (st.w) w.style.width = st.w + 'px';
    if (st.h) w.style.height = st.h + 'px';
    this.root.append(w);
    this.placeFloating(w, st.x, st.y);
    this.bindFloatingHead(w, (x, y) => store('brushList', { ...this.brushListState(), x, y }));
    w.querySelector('[data-bl-close]').onclick = () => this.toggleBrushList(false);
    w.querySelector('[data-bl-act="save"]').onclick = () => this.saveBrushAs();
    w.querySelector('[data-bl-act="import"]').onclick = () => this.importBrushFile();
    w.querySelector('[data-bl-act="manage"]').onclick = () => this.manageBrushes();
    w.querySelectorAll('[data-bl-size]').forEach(b => {
      b.onclick = () => { store('brushList', { ...this.brushListState(), size: b.dataset.blSize }); this.renderBrushList(); };
    });
    const search = w.querySelector('.bl-search');
    search.value = this.brushListQuery || '';
    search.oninput = () => { this.brushListQuery = search.value; this.renderBrushList(); };
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape' && e.target === search) { search.blur(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      this.stepBrushList(e.key === 'ArrowDown' ? 1 : -1);
    });
    const list = w.querySelector('.bl-list');
    list.onclick = e => {
      const row = e.target.closest('[data-id]');
      if (row) this.applyPreset(row.dataset.id);
    };
    list.oncontextmenu = e => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      e.preventDefault();
      this.brushRowMenu(row);
    };
    // resizing the window (its corner): remember the size, and redraw the strokes at the new width
    let timer = 0;
    this.brushListObs = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!w.isConnected) return;
        const r = w.getBoundingClientRect();
        if (r.width && r.height) store('brushList', { ...this.brushListState(), w: Math.round(r.width), h: Math.round(r.height) });
        this.drawBrushList();
      }, 150);
    });
    this.brushListObs.observe(w);
    return w;
  },

  /** Loads the brush below (dir 1) or above (-1) the current one in the Brushes window, as it is filtered now. */
  stepBrushList(dir) {
    const rows = [...(this.brushListWin?.querySelectorAll('.bl-row') || [])];
    if (!rows.length) return;
    const i = rows.findIndex(r => r.classList.contains('on'));
    const next = rows[i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + dir))];
    this.applyPreset(next.dataset.id);
    this.brushListWin?.querySelector('.bl-row.on')?.scrollIntoView({ block: 'nearest' });
  },

  /** The menu of a brush in the Brushes window (right-click). */
  brushRowMenu(row) {
    const p = this.presetById(row.dataset.id);
    if (!p) return;
    const s = this.settings[this.tool], current = s.preset === p.id, mine = !p.builtin;
    menu(row, [
      { label: current && brushChanged(s, p) ? 'Undo my changes (load it again)' : 'Use', run: () => this.applyPreset(p.id) },
      { label: 'Save a copy as new brush…', run: () => this.saveBrushAs(this.brushSettingsOf(applySettings({ ...s }, p.settings)), `${p.name} copy`) },
      '-',
      { label: 'Update with the current settings', disabled: !mine || !current, run: () => this.updatePreset(p) },
      { label: 'Rename…', disabled: !mine, run: () => this.renamePreset(p) },
      { label: 'Delete…', disabled: !mine, run: () => this.deletePreset(p) },
    ]);
  },

  /**
   * Draws the sample strokes in the Brushes window: a cached picture per brush, settings, colour and size; missing
   * ones are painted a few per frame so a long list never holds up the screen.
   */
  drawBrushList() {
    const w = this.brushListWin, t = TOOL_BY_ID[this.tool];
    if (!w || t.kind !== 'paint') return;
    const cache = this.brushThumbs ||= new Map(), dpr = window.devicePixelRatio || 1, s = this.settings[t.id];
    const todo = [];
    for (const c of w.querySelectorAll('.bl-thumb')) {
      const p = this.presetById(c.closest('[data-id]').dataset.id);
      if (!p || !c.clientWidth) continue;
      const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
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
      { label: 'Manage brushes (groups, order, delete)…', run: () => this.manageBrushes() },
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

  /** Saves settings (the current tool's unless given) as a new brush of the user's, and loads it. */
  async saveBrushAs(settings = null, suggest = '') {
    const s = this.settings[this.tool];
    const name = await promptBox('Save as new brush', 'Name', suggest || `${TOOL_BY_ID[this.tool].label} ${this.brushLib.presets.length + 1}`);
    if (!name) return;
    const p = { id: newId(), name, settings: settings || this.brushSettingsOf(s) };
    this.brushLib.presets.push(p);
    if (await this.savePresetList()) {
      if (settings) applySettings(s, settings);
      s.preset = p.id;
      store('tools', this.settings);
      toast(`Saved the brush “${name}”`);
    }
    this.renderToolProps();
  },

  async updatePreset(p) {
    p.settings = this.brushSettingsOf(this.settings[this.tool]);
    if (await this.savePresetList()) toast(`Updated “${p.name}”`);
    this.markBrushChanged();
    this.drawBrushList();
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

  /**
   * Brush menu → Import brushes: a Procreate, Photoshop, GIMP or Krita file; pick which to keep. Every brush shows its
   * own sample stroke (the pack's images are registered under temporary ids while the dialog is open, and strokes are
   * drawn only once a card scrolls into view), with a search box, All / None for the brushes shown, Shift+click for a
   * range, and a badge listing what a brush loses. Big packs start with nothing picked (brushpick.js).
   */
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
    const temp = new Map();  // image index -> temporary id
    await Promise.all(res.images.map(async (im, k) => {
      const url = im.white ? URL.createObjectURL(await this.importedImagePng(im)) : im.png;
      try {
        const id = newId();
        registerImage(id, im.kind, await loadImage(url));
        temp.set(k, id);
      } catch { /* drawn with a round tip */ } finally { if (im.white) URL.revokeObjectURL(url); }
    }));
    const base = this.brushSettingsOf(TOOL_BY_ID.brush.defaults), ref = k => (temp.has(k) ? `img:${temp.get(k)}` : null);
    const looks = res.brushes.map(b => applySettings({ ...base }, { ...b.settings,
      tip: ref(b.tip) || 'round', texture: ref(b.texture) || 'none', ...(ref(b.dual) ? { dualTip: ref(b.dual) } : {}) }));
    const n = res.brushes.length, picked = new Set(n <= PICK_ALL_UP_TO ? res.brushes.keys() : []);
    const lost = noteSummary(res.brushes);
    let observer = null, raf = 0, group = res.name;
    const chosen = await modal({
      title: `Import brushes from ${file.name}`,
      wide: true,
      body: `<div class="imp">
        <div class="imp-bar"><input type="search" class="imp-search" placeholder="Search ${n} brush${n === 1 ? '' : 'es'}" aria-label="Search the brushes" spellcheck="false" data-own-enter>
          <button type="button" data-imp="all" title="Pick every brush shown">All</button><button type="button" data-imp="none" title="Pick none of the brushes shown">None</button>
          <span class="imp-count muted small"></span></div>
        <div class="imp-grid">${res.brushes.map((b, i) => `<button type="button" class="imp-card" data-i="${i}" title="${esc(b.name)}">
          <canvas></canvas><span class="imp-name">${esc(b.name)}</span>${b.notes.length ? `<i class="imp-note" title="${esc('Not carried over: ' + b.notes.join(', '))}">!</i>` : ''}<i class="imp-tick">${icon('check', 12)}</i></button>`).join('')}</div>
        <p class="imp-empty muted small" hidden>No brush has that name.</p>
        <div class="imp-foot"><label class="imp-group" title="The group the brushes go into in the Brushes window and the Brush row: the pack's own name, or one you already have">Add to group
          <input type="text" class="imp-group-name" list="imp-groups" value="${esc(res.name)}" spellcheck="false" data-own-enter></label>
          <datalist id="imp-groups">${presetGroups(this.brushLib.presets).map(g => `<option value="${esc(groupLabel(g.name))}">`).join('')}</datalist></div>
        <p class="muted small">Click the brushes to keep (Shift+click picks a range). Size, opacity, spacing, tip, pen pressure, texture and wet mixing come with them; Procreate settings are approximate, so check the size after importing.${lost.length ? ` <span title="${esc(lost.map(([t, c]) => `${t}: ${c}`).join(', '))}">Some brushes lose a setting KoeStudio does not have (marked !).</span>` : ''}</p>
      </div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Import', primary: true }],
      onOpen: root => {
        const grid = root.querySelector('.imp-grid'), cards = [...grid.children], search = root.querySelector('.imp-search');
        const ok = root.querySelector('.modal-buttons .primary'), count = root.querySelector('.imp-count');
        let shown = cards.map((_, i) => i), last = null;
        const update = () => {
          cards.forEach((c, i) => c.classList.toggle('on', picked.has(i)));
          count.textContent = `${picked.size} of ${n} picked`;
          ok.textContent = picked.size ? `Import ${picked.size}` : 'Import';
          ok.disabled = !picked.size;
        };
        // strokes are drawn for cards in view, a few per frame
        const todo = new Set();
        const draw = () => {
          const t0 = performance.now();
          for (const c of todo) {
            if (performance.now() - t0 > 12) break;
            todo.delete(c);
            const cv = c.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
            cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
            if (cv.width && cv.height) this.paintPreviewStroke(cv, looks[+c.dataset.i], 0.32);
          }
          raf = todo.size && root.isConnected ? requestAnimationFrame(draw) : 0;
        };
        observer = new IntersectionObserver(entries => {
          for (const e of entries) if (e.isIntersecting) { todo.add(e.target); observer.unobserve(e.target); }
          if (todo.size && !raf) raf = requestAnimationFrame(draw);
        }, { root: grid, rootMargin: '120px' });
        cards.forEach(c => observer.observe(c));
        grid.onclick = e => {
          const c = e.target.closest('.imp-card');
          if (!c) return;
          const i = +c.dataset.i, on = !picked.has(i);
          for (const k of e.shiftKey ? rangePick(shown, last, i) : [i]) on ? picked.add(k) : picked.delete(k);
          last = i;
          update();
        };
        search.oninput = () => {
          shown = pickMatches(res.brushes.map(b => b.name), search.value);
          const vis = new Set(shown);
          cards.forEach((c, i) => { c.hidden = !vis.has(i); });
          root.querySelector('.imp-empty').hidden = shown.length > 0;
          root.querySelector('[data-imp="all"]').textContent = search.value.trim() ? `All ${shown.length}` : 'All';
        };
        root.querySelector('[data-imp="all"]').onclick = () => { shown.forEach(i => picked.add(i)); update(); };
        root.querySelector('[data-imp="none"]').onclick = () => { shown.forEach(i => picked.delete(i)); update(); };
        update();
      },
      collect: back => {
        if (!picked.size) return undefined;
        const g = back.querySelector('.imp-group-name').value.trim();
        group = g === groupLabel('') ? '' : g || res.name;
        return [...picked].sort((a, b) => a - b).map(i => res.brushes[i]);
      },
    });
    observer?.disconnect();
    cancelAnimationFrame(raf);
    for (const id of temp.values()) forgetBrushImage(id);
    if (!chosen) return;
    if (chosen.length > 20) toast(`Importing ${chosen.length} brushes…`);
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
    const presets = chosen.map(b => ({
      id: newId(), name: b.name, ...(group ? { source: group } : {}),
      settings: applySettings({ ...base }, { ...b.settings,
        tip: b.tip != null ? `img:${saved.get(b.tip)}` : 'round', texture: b.texture != null ? `img:${saved.get(b.texture)}` : 'none',
        ...(b.dual != null ? { dualTip: `img:${saved.get(b.dual)}` } : {}) }),
    }));
    this.brushLib.presets.push(...presets);
    if (!(await this.savePresetList())) return;
    if (TOOL_BY_ID[this.tool].kind !== 'paint' || TOOL_BY_ID[this.tool].erase) this.selectTool('brush');
    this.applyPreset(presets[0].id);
    if (presets.length > 1 && !this.brushListState().open) this.toggleBrushList(true);  // the pack, as a group of its own
    toast(presets.length === 1 ? `Imported “${presets[0].name}”` : `Imported ${presets.length} brushes`);
  },
};
