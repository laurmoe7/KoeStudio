// Patterns (patterns.js keeps the maths, fillrender.js the drawing): your own patterns (Edit → Patterns…, made
// from a picture or the selection, kept per machine in koe.patterns), filling with a pattern (the Fill tool's
// Pattern setting, Edit → Fill with pattern…), the pattern brush (a paint tool's Pattern setting, applied in
// liveSource), and fill layers (Layer → New → Fill layer…: a colour, gradient or pattern kept as data, its pixels
// always a rendering of it). Editor methods (mixed into Editor.prototype in editor.js).

import { Layer, Mask } from '../doc.js';
import { patternChoices, patternExists, isUserPattern, sanitizeUserPatterns, patternSize, sanitizeFill, newGradientFill,
  FILL_TYPES, BUILTIN_PATTERNS, MAX_USER_PATTERNS } from '../patterns.js';
import { builtinTile, srcTile, loadPatternSrc, blackTile, paintPattern, renderFillLayer, tileSrc } from '../fillrender.js';
import { gradientChoices, gradientStops, GRADIENT_SHAPES, GRADIENT_REPEATS } from '../gradient.js';
import { insertNode, removeNode } from '../tree.js';
import { esc, modal, store, toast, fileToDataUrl, confirmBox, promptBox } from '../ui.js';

const THUMB = 56;
const options = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
const pct = v => Math.round(v * 100);

export const patternMethods = {
  // ---------- the library ----------

  /** Your saved patterns (read from storage once per resume). */
  userPatterns() {
    return (this.userPatternList ||= sanitizeUserPatterns(store('patterns')));
  },

  /** Saves your patterns; false (with a toast) when storage is full. */
  saveUserPatterns(list) {
    const clean = sanitizeUserPatterns(list), json = JSON.stringify(clean);
    store('patterns', clean);
    let ok = false;
    try { ok = localStorage.getItem('koe.patterns')?.length === json.length; } catch { /* storage unavailable */ }
    if (!ok) { toast('There is no room left to keep more patterns. Delete some, or use smaller pictures.', { error: true }); return false; }
    this.userPatternList = clean;
    return true;
  },

  /** Decodes your patterns' pictures in the background, so they are ready to paint and fill with. */
  preloadPatterns() {
    for (const p of this.userPatterns()) loadPatternSrc(p.src);
  },

  /** A pattern's tile for painting on target t (built-in ones in the main colour; on masks black), or null. */
  patternTile(id, t) {
    const mask = t?.kind === 'mask';
    if (isUserPattern(id)) {
      const p = this.userPatterns().find(x => x.id === id.slice(5));
      const tile = p && srcTile(p.src);
      if (p && !tile) loadPatternSrc(p.src);
      return tile ? (mask ? blackTile(tile) : tile) : null;
    }
    return builtinTile(id, mask ? '#000000' : this.colors.main);
  },

  /** Where a tool's pattern lies: its size, angle and shift (the brush has no shift). */
  patternPlace(s) {
    return { scale: s.patScale ?? 1, angle: s.patAngle ?? 0, x: s.patX || 0, y: s.patY || 0, mirror: false };
  },

  /** The pattern brush (a paint tool's Pattern setting) for live.pattern, or null. Not for erasers or vector layers. */
  strokePattern(s, layer, erase) {
    if (erase || layer.vector || !s.pattern || s.pattern === 'none' || !patternExists(s.pattern, this.userPatterns())) return null;
    const tile = this.patternTile(s.pattern, layer);
    if (!tile) { toast('That pattern is still loading. Try again in a moment.'); return null; }
    return { tile, place: this.patternPlace(s) };
  },

  /** Turns what the stroke canvas holds in `area` into the tool's pattern (keeping its shape); false when the pattern is missing. */
  patternIntoStroke(s, t, area) {
    if (!patternExists(s.pattern, this.userPatterns())) return false;
    const tile = this.patternTile(s.pattern, t);
    if (!tile) { toast('That pattern is still loading. Try again in a moment.'); return false; }
    const ctx = this.strokeCtx;
    ctx.globalCompositeOperation = 'source-in';
    paintPattern(ctx, tile, this.patternPlace(s), area);
    ctx.globalCompositeOperation = 'source-over';
    return true;
  },

  /** Fills the selection (or the layer) with the Fill tool's pattern; with none chosen, asks for one first. */
  fillWithPattern() {
    const s = this.settings.fill;
    if (s.pattern === 'none' || !patternExists(s.pattern, this.userPatterns())) return this.fillPatternDialog();
    const t = this.target('fill');
    if (!t) return;
    const d = this.doc, area = this.sel.active ? this.sel.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    this.resetStroke();
    this.strokeCtx.fillStyle = '#000';
    this.strokeCtx.fillRect(area.x, area.y, area.w, area.h);
    if (!this.patternIntoStroke(s, t, area)) return this.resetStroke();
    this.sel.clipCanvas(this.strokeCtx, area);
    this.live = { layer: t, canvas: this.stroke, alpha: 1, mode: this.strokeMode(t, false) };
    this.commitStroke(t, area, this.sel.active ? 'Fill selection with pattern' : 'Fill layer with pattern');
  },

  /** Edit → Fill with pattern…: choose the pattern and where it lies (the Fill tool's settings), then fill. */
  async fillPatternDialog() {
    const s = this.settings.fill, user = this.userPatterns();
    if (!this.target('fill')) return;
    const pick = s.pattern !== 'none' && patternExists(s.pattern, user) ? s.pattern : 'dots';
    const res = await modal({
      title: this.sel.active ? 'Fill selection with pattern' : 'Fill layer with pattern',
      body: `${this.patternFields({ pattern: pick, scale: s.patScale, angle: s.patAngle, x: s.patX, y: s.patY })}
        <p class="muted small">The Fill tool uses these too. Built-in patterns take the main colour. Edit → Patterns… makes your own.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Fill', primary: true }],
      onOpen: root => this.bindPatternFields(root),
      collect: root => readPattern(root),
    });
    if (!res) return;
    Object.assign(s, { pattern: res.pattern, patScale: res.scale, patAngle: res.angle, patX: res.x, patY: res.y });
    store('tools', this.settings);
    if (this.tool === 'fill') this.renderToolProps();
    this.fillWithPattern();
  },

  /** Dialog fields choosing a pattern and where it lies (names: pattern, pscale, pangle, px, py). */
  patternFields(v, withShift = true) {
    return `<div class="pat-pick"><canvas class="pat-swatch" width="${THUMB}" height="${THUMB}"></canvas>
        <label class="field"><span>Pattern</span><select name="pattern">${options(patternChoices(this.userPatterns(), null), v.pattern)}</select></label></div>
      <div class="field-row">
        <label class="field"><span>Size (%)</span><input type="number" name="pscale" min="10" max="1000" value="${pct(v.scale ?? 1)}"></label>
        <label class="field"><span>Angle (°)</span><input type="number" name="pangle" min="0" max="360" value="${Math.round(v.angle || 0)}"></label>
        ${withShift ? `<label class="field"><span>Shift → (px)</span><input type="number" name="px" min="-500" max="500" value="${Math.round(v.x || 0)}"></label>
        <label class="field"><span>Shift ↓ (px)</span><input type="number" name="py" min="-500" max="500" value="${Math.round(v.y || 0)}"></label>` : ''}
      </div>`;
  },

  /** Keeps the swatch beside a pattern choice showing it. */
  bindPatternFields(root) {
    const sel = root.querySelector('[name="pattern"]'), sw = root.querySelector('.pat-swatch');
    const show = () => this.drawPatternThumb(sw, sel.value);
    sel.addEventListener('change', show);
    show();
  },

  /** Draws a pattern repeated over a small canvas (shrunk to fit when its tile is big). */
  drawPatternThumb(c, id) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const tile = this.patternTile(id, null);
    if (!tile) {
      const p = this.userPatterns().find(x => `user:${x.id}` === id);
      if (p) loadPatternSrc(p.src).then(t => t && this.drawPatternThumb(c, id));
      return;
    }
    const k = Math.min(1, c.width / Math.max(tile.width, tile.height));
    paintPattern(ctx, tile, { scale: k, angle: 0, x: 0, y: 0 }, { x: 0, y: 0, w: c.width, h: c.height });
  },

  // ---------- making and managing patterns ----------

  /** Keeps a canvas's picture as a new pattern of yours (scaled down to PATTERN_MAX). */
  addUserPattern(src, name) {
    const list = this.userPatterns();
    if (list.length >= MAX_USER_PATTERNS) { toast(`You can keep up to ${MAX_USER_PATTERNS} patterns. Delete one first.`); return null; }
    const { w, h } = patternSize(src.width, src.height);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || 'Pattern').slice(0, 40), src: c.toDataURL('image/png'), w, h };
    if (!this.saveUserPatterns([...list, p])) return null;
    loadPatternSrc(p.src);
    return p;
  },

  /** The current layer's pixels inside the selection, kept as a pattern. */
  patternFromSelection(name = 'From selection') {
    if (!this.sel.active) { toast('Select the part to make a pattern from first.'); return null; }
    const t = this.target('make a pattern from', { read: true, vector: true, text: true });
    if (!t) return null;
    const b = this.sel.bounds, c = document.createElement('canvas');
    c.width = b.w; c.height = b.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(t.canvas, -b.x, -b.y);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.sel.canvas, -b.x, -b.y);
    const p = this.addUserPattern(c, name);
    c.width = c.height = 0;
    if (p) toast(`"${p.name}" is now one of your patterns.`);
    return p;
  },

  /** Asks for a picture file and keeps it as a pattern. Resolves to the pattern, or null. */
  patternFromPicture() {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return resolve(null);
        try {
          const img = new Image();
          img.src = await fileToDataUrl(f);
          await img.decode();
          resolve(this.addUserPattern(img, f.name.replace(/\.[^.]+$/, '')));
        } catch { toast('That picture could not be read.', { error: true }); resolve(null); }
      };
      inp.click();
    });
  },

  /** Edit → Patterns…: your patterns and the built-in ones; add from a picture or the selection, rename, delete. */
  async patternsDialog() {
    this.finishTransform();
    this.finishText();
    await modal({
      title: 'Patterns',
      wide: true,
      body: `<div class="pat-grid"></div>
        <div class="btn-row"><button type="button" data-add="picture">Add from picture…</button>
          <button type="button" data-add="selection" ${this.sel.active ? '' : 'disabled title="Select part of a layer first"'}>Add from selection</button></div>
        <p class="muted small">Use patterns with the Fill tool, Edit → Fill with pattern…, a brush's Pattern setting (Brush settings → Pattern) or Layer → New → Fill layer…. Built-in patterns take the main colour.</p>`,
      buttons: [{ label: 'Close', value: true, primary: true }],
      onOpen: root => {
        const grid = root.querySelector('.pat-grid');
        const draw = () => {
          const user = this.userPatterns();
          grid.innerHTML = [...BUILTIN_PATTERNS.map(([id, name]) => [id, name, false]), ...user.map(p => [`user:${p.id}`, p.name, true])]
            .map(([id, name, own]) => `<div class="pat-card" data-id="${esc(id)}"><canvas width="${THUMB}" height="${THUMB}"></canvas><span title="${esc(name)}">${esc(name)}</span>
              ${own ? `<span class="pat-acts"><button type="button" class="icon-btn" data-rename title="Rename">✎</button><button type="button" class="icon-btn" data-del title="Delete">✕</button></span>` : '<small class="muted">built in</small>'}</div>`).join('');
          grid.querySelectorAll('.pat-card').forEach(card => {
            const id = card.dataset.id;
            this.drawPatternThumb(card.querySelector('canvas'), id);
            card.querySelector('[data-del]')?.addEventListener('click', async () => {
              const p = this.userPatterns().find(x => `user:${x.id}` === id);
              if (!p || !await confirmBox('Delete pattern', `Delete "${p.name}"? Fill layers made with it keep it.`, 'Delete')) return;
              if (this.saveUserPatterns(this.userPatterns().filter(x => x !== p))) {
                for (const s of Object.values(this.settings)) if (s.pattern === id) s.pattern = 'none';
                store('tools', this.settings);
                this.renderToolProps();
                draw();
              }
            });
            card.querySelector('[data-rename]')?.addEventListener('click', async () => {
              const p = this.userPatterns().find(x => `user:${x.id}` === id);
              const name = p && await promptBox('Rename pattern', 'Name', p.name);
              if (!name) return;
              if (this.saveUserPatterns(this.userPatterns().map(x => (x === p ? { ...x, name } : x)))) { this.renderToolProps(); draw(); }
            });
          });
        };
        root.querySelector('[data-add="picture"]').addEventListener('click', async () => { if (await this.patternFromPicture()) { this.renderToolProps(); draw(); } });
        root.querySelector('[data-add="selection"]').addEventListener('click', () => { if (this.patternFromSelection()) { this.renderToolProps(); draw(); } });
        draw();
      },
    });
  },

  // ---------- fill layers ----------

  /** Layer → New → Fill layer…: a layer that is all one colour, gradient or pattern, kept editable. With a
   *  selection it gets a mask showing only the selected part. */
  async newFillLayer() {
    this.finishTransform();
    this.finishText();
    const d = this.doc, last = store('fillLayer');
    const type = FILL_TYPES.some(t => t[0] === last?.type) ? last.type : 'color';
    const layer = new Layer(d.width, d.height, { name: d.newName('Fill'), fill: this.fillFor(type, null, last) });
    if (this.sel.active) {  // hide what is not selected, as Add mask does
      const m = new Mask(d.width, d.height);
      m.ctx.fillRect(0, 0, d.width, d.height);
      m.ctx.globalCompositeOperation = 'destination-out';
      m.ctx.drawImage(this.sel.canvas, 0, 0);
      m.ctx.globalCompositeOperation = 'source-over';
      layer.mask = m;
    }
    // shown while the dialog is open, outside the history
    const prev = d.active, parent = prev.parent;
    insertNode(parent, parent.children.indexOf(prev) + 1, layer);
    await this.showFill(layer, layer.fill);
    this.layerPanel.render();
    const fill = await this.fillDialog(layer, 'New fill layer', 'Create');
    removeNode(layer);
    d.active = prev;
    if (!fill) { this.layersChanged(); return; }
    layer.fill = fill;
    store('fillLayer', { type: fill.type, pattern: fill.id, colors: fill.colors });
    this.insertNode(layer, 'New fill layer');
  },

  /** Layer → Fill layer settings… (or a second click on its thumbnail): change what it shows, as one undo step. */
  async fillLayerSettings(layer = this.doc.active) {
    if (!layer?.fill) return toast('Select a fill layer first (Layer → New → Fill layer… makes one).');
    this.finishTransform();
    this.finishText();
    const before = layer.fill, after = await this.fillDialog(layer, `Fill layer: ${layer.name}`, 'OK');
    if (!after) { await this.showFill(layer, before); return; }
    this.structural('Fill layer settings', () => { layer.fill = after; renderFillLayer(layer); }, () => { layer.fill = before; renderFillLayer(layer); });
  },

  /** Draws `fill` as the layer's pixels (its pattern decoded first when needed) and shows it. */
  async showFill(layer, fill) {
    if (fill.type === 'pattern' && !srcTile(fill.src)) await loadPatternSrc(fill.src);
    renderFillLayer(layer, fill);
    this.changed(null);
  },

  /** A fill of the given type from the dialog's values `v` (or defaults), keeping `base`'s colours when they were not changed. */
  fillFor(type, base, v) {
    v ||= {};
    const d = this.doc, main = this.colors.main;
    if (type === 'color') return { type: 'color', color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color.toLowerCase() : main };
    if (type === 'gradient') {
      const colors = v.colors || base?.colors || 'main-sub';
      const keep = base?.type === 'gradient' && base.colors === colors;
      const g = keep ? base : newGradientFill(gradientStops(colors, main, this.colors.sub, this.userGrads()), colors, d.width, d.height);
      return sanitizeFill({ ...g, shape: v.shape ?? g.shape, repeat: v.repeat ?? g.repeat, angle: v.angle ?? g.angle, scale: v.scale ?? g.scale });
    }
    const user = this.userPatterns(), id = patternExists(v.pattern, user) ? v.pattern : base?.type === 'pattern' ? base.id : 'dots';
    let src = base?.type === 'pattern' && base.id === id ? base.src : null, w = base?.w, h = base?.h;
    let name = BUILTIN_PATTERNS.find(p => p[0] === id)?.[1];
    if (!src) {
      const own = user.find(p => `user:${p.id}` === id);
      if (own) ({ src, w, h, name } = own);
      else { const tile = builtinTile(id, main) || builtinTile('dots', main); src = tileSrc(tile); w = tile.width; h = tile.height; }
    } else name = base.name;
    const place = base?.type === 'pattern' ? base : {};
    return sanitizeFill({ type: 'pattern', id, name, src, w, h, scale: v.scale ?? place.scale, angle: v.angle ?? place.angle, x: v.x ?? place.x, y: v.y ?? place.y, mirror: place.mirror });
  },

  /** The fill layer dialog: the canvas shows the layer as the fields change. Resolves to the new fill, or null. */
  fillDialog(layer, title, ok) {
    const f = layer.fill, g = f.type === 'gradient' ? f : { colors: 'main-sub', shape: 'linear', repeat: 'none', angle: 0, scale: 1 };
    const p = f.type === 'pattern' ? { ...f, pattern: f.id } : { pattern: 'dots', scale: 1, angle: 0, x: 0, y: 0 };
    const read = root => {
      const v = Object.fromEntries(new FormData(root.querySelector('form')));
      const type = v.type;
      return this.fillFor(type, layer.fill, type === 'color' ? { color: v.color }
        : type === 'gradient' ? { colors: v.colors, shape: v.shape, repeat: v.repeat, angle: +v.gangle || 0, scale: (+v.gscale || 100) / 100 }
          : readPattern(root));
    };
    return modal({
      title,
      live: true,
      body: `<form class="fill-form" onsubmit="return false">
        <label class="field"><span>Fill with</span><select name="type">${options(FILL_TYPES, f.type)}</select></label>
        <div data-for="color"><label class="field"><span>Color</span><input type="color" name="color" value="${f.type === 'color' ? f.color : this.colors.main}"></label></div>
        <div data-for="gradient">
          <label class="field"><span>Colors</span><select name="colors">${options(gradientChoices(this.userGrads()), g.colors)}</select></label>
          <div class="field-row"><label class="field"><span>Shape</span><select name="shape">${options(GRADIENT_SHAPES, g.shape)}</select></label>
            <label class="field"><span>Repeat</span><select name="repeat">${options(GRADIENT_REPEATS, g.repeat)}</select></label></div>
          <div class="field-row"><label class="field"><span>Angle (°)</span><input type="number" name="gangle" min="0" max="360" value="${Math.round(g.angle)}"></label>
            <label class="field"><span>Length (%)</span><input type="number" name="gscale" min="5" max="1000" value="${pct(g.scale)}"></label></div>
        </div>
        <div data-for="pattern">${this.patternFields(p)}</div>
        <p class="muted small">The layer stays editable: open these settings again from the Layer menu or by clicking its thumbnail twice. It works with masks, blend modes and opacity like any layer; Layer → Rasterize → Fill layer makes it ordinary pixels.</p>
      </form>`,
      buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true }],
      onOpen: root => {
        const typeSel = root.querySelector('[name="type"]');
        const sections = () => root.querySelectorAll('[data-for]').forEach(el => { el.hidden = el.dataset.for !== typeSel.value; });
        let busy = 0;
        const update = async () => {
          sections();
          const n = ++busy, fill = read(root);
          if (fill.type === 'pattern' && !srcTile(fill.src)) await loadPatternSrc(fill.src);
          if (n === busy) { renderFillLayer(layer, fill); this.changed(null); }
        };
        root.querySelectorAll('input').forEach(el => el.addEventListener('input', update));
        root.querySelectorAll('select').forEach(el => el.addEventListener('change', update));
        this.bindPatternFields(root);
        sections();
      },
      collect: root => read(root),
    });
  },

  /** Turns a fill layer into ordinary pixels (an undo step); tools that need pixels offer this. */
  rasterizeFill(layer) {
    const f = layer.fill;
    if (!f) return;
    this.structural('Rasterize fill layer', () => { layer.fill = null; }, () => { layer.fill = f; });
    toast('The fill is now ordinary pixels you can paint on.');
  },
};

/** The pattern fields' values: {pattern, scale, angle, x, y}. */
function readPattern(root) {
  const val = n => root.querySelector(`[name="${n}"]`)?.value;
  return { pattern: val('pattern'), scale: Math.max(0.1, Math.min(10, (+val('pscale') || 100) / 100)), angle: ((+val('pangle') || 0) % 360 + 360) % 360,
    x: Math.max(-500, Math.min(500, +val('px') || 0)), y: Math.max(-500, Math.min(500, +val('py') || 0)) };
}
