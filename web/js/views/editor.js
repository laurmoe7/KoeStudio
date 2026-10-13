// The drawing screen: canvas viewport, tools, tool settings, colour and layer panels, menus and autosave.

import { api } from '../api.js';
import { Smoother, StampPath, pressureCurve, stampFor, stampBounds } from '../brush.js';
import { hexToRgb, rgbToHex } from '../color.js';
import { Doc, Layer, composite, canvasToDataUrl, loadImage } from '../doc.js';
import { floodMask, growMask } from '../fill.js';
import { History } from '../history.js';
import { icon } from '../icons.js';
import { comboOf, isTyping } from '../keys.js';
import { Painter } from '../painter.js';
import { union, clip } from '../rect.js';
import { TOOLS, TOOL_BY_ID, SETTING_FIELDS, sanitizeSettings, nextSize } from '../tools.js';
import { esc, toast, menu, promptBox, fileToDataUrl, store } from '../ui.js';
import { newView, matrix, toDoc, zoomAt, rotateAt, flipAt, fitView, actualSize } from '../view.js';
import { ColorPanel } from './colorpanel.js';
import { LayerPanel } from './layerpanel.js';

const SAVE_DELAY = 800;
const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export class Editor {
  constructor(root, { onHome }) {
    this.root = root;
    this.onHome = onHome;
    this.settings = sanitizeSettings(store('tools'));
    this.tool = TOOL_BY_ID[store('tool')] ? store('tool') : 'pen';
    this.history = new History();
    this.history.onChange = () => this.updateUndoButtons();
    this.view = newView();
    this.gesture = null;
    this.live = null;
    this.held = { space: false, alt: false };
    this.pointer = null;  // last pointer position over the canvas, in screen px
    this.savedVersion = -1;
    this.onKey = this.onKey.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPaste = this.onPaste.bind(this);
  }

  // ---------- setup ----------

  async open(doc, { isNew = false } = {}) {
    this.doc = doc;
    this.savedVersion = isNew ? -1 : doc.version;
    this.build();
    this.comp = document.createElement('canvas');
    this.comp.width = doc.width;
    this.comp.height = doc.height;
    this.compCtx = this.comp.getContext('2d', { willReadFrequently: true });
    this.stroke = document.createElement('canvas');
    this.stroke.width = doc.width;
    this.stroke.height = doc.height;
    this.strokeCtx = this.stroke.getContext('2d');
    this.updateComp(null);
    this.needsFit = true;  // done by resize() once the viewport has a real size
    this.resize();
    this.layers.render();
    this.selectTool(this.tool);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('blur', this.onKeyUp);
    if (isNew) this.save();
    else this.setStatus('Saved');
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('blur', this.onKeyUp);
    this.resizeObs?.disconnect();
    clearTimeout(this.saveTimer);
    this.root.innerHTML = '';
  }

  build() {
    const doc = this.doc;
    this.root.innerHTML = `
      <div class="editor">
        <header class="ed-top">
          <button class="icon-btn" data-act="home" title="Back to the gallery">${icon('back')}</button>
          <button class="menu-btn" data-menu="file">File</button>
          <button class="menu-btn" data-menu="edit">Edit</button>
          <button class="menu-btn" data-menu="layer">Layer</button>
          <button class="menu-btn" data-menu="view">View</button>
          <button class="ed-title" title="Rename the artwork">${esc(doc.title)}</button>
          <div class="grow"></div>
          <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
          <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Y)">${icon('redo')}</button>
          <span class="save-state muted small"></span>
        </header>
        <div class="ed-body">
          <nav class="ed-tools" aria-label="Tools">
            ${TOOLS.map(t => `<button class="tool-btn" data-tool="${t.id}" title="${esc(t.label)} (${t.key.toUpperCase()})">${icon(t.icon, 22)}</button>`).join('')}
          </nav>
          <div class="ed-viewport">
            <canvas class="ed-view"></canvas>
            <canvas class="ed-overlay"></canvas>
          </div>
          <aside class="ed-side">
            <section class="panel"><h3>Color</h3><div class="color-panel"></div></section>
            <section class="panel"><h3 class="tool-title">Tool</h3><div class="tool-props"></div></section>
            <section class="panel grow"><h3>Layers</h3><div class="layer-panel"></div></section>
          </aside>
        </div>
        <footer class="ed-status">
          <button class="icon-btn" data-act="zoomOut" title="Zoom out (Ctrl+-)">−</button>
          <span class="zoom-label" title="Zoom">100%</span>
          <button class="icon-btn" data-act="zoomIn" title="Zoom in (Ctrl+=)">+</button>
          <button class="icon-btn" data-act="actual" title="100% (Ctrl+1)">1:1</button>
          <button class="icon-btn" data-act="fit" title="Fit to window (Ctrl+0)">${icon('fit', 16)}</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="rotL" title="Rotate view left (4)">${icon('rotL', 16)}</button>
          <span class="rot-label" title="View rotation">0°</span>
          <button class="icon-btn" data-act="rotR" title="Rotate view right (6)">${icon('rotR', 16)}</button>
          <button class="icon-btn" data-act="rotReset" title="Reset rotation (5)">0°</button>
          <button class="icon-btn" data-act="flip" title="Mirror the view (M)">${icon('flip', 16)}</button>
          <span class="sep"></span>
          <span class="muted small doc-size">${doc.width} × ${doc.height} px</span>
          <span class="muted small cursor-pos"></span>
        </footer>
      </div>`;
    const $ = s => this.root.querySelector(s);
    this.viewport = $('.ed-viewport');
    this.viewCanvas = $('.ed-view');
    this.overlay = $('.ed-overlay');
    this.vctx = this.viewCanvas.getContext('2d');
    this.octx = this.overlay.getContext('2d');
    this.colors = new ColorPanel($('.color-panel'));
    this.layers = new LayerPanel($('.layer-panel'), this);
    this.root.querySelectorAll('[data-tool]').forEach(b => { b.onclick = () => this.selectTool(b.dataset.tool); });
    const acts = {
      home: () => this.goHome(), undo: () => this.undo(), redo: () => this.redo(),
      zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1), actual: () => this.actual(), fit: () => this.fit(),
      rotL: () => this.rotate(-15), rotR: () => this.rotate(15), rotReset: () => this.rotate(null), flip: () => this.flipView(),
    };
    this.root.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => acts[b.dataset.act](); });
    this.root.querySelectorAll('[data-menu]').forEach(b => { b.onclick = () => menu(b, this.menuItems(b.dataset.menu)); });
    $('.ed-title').onclick = () => this.rename();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.viewport);
    this.bindPointer();
    this.updateUndoButtons();
  }

  menuItems(name) {
    const d = this.doc;
    return {
      file: [
        { label: 'Save now', key: 'Ctrl+S', run: () => this.save() },
        { label: 'Export as PNG…', key: 'Ctrl+Shift+S', run: () => this.exportPng() },
        '-',
        { label: 'Import image as layer…', run: () => this.pickImage() },
        { label: 'Open artwork folder', run: () => api.openFolder() },
        '-',
        { label: 'Back to gallery', run: () => this.goHome() },
      ],
      edit: [
        { label: 'Undo', key: 'Ctrl+Z', run: () => this.undo(), disabled: !this.history.canUndo },
        { label: 'Redo', key: 'Ctrl+Y', run: () => this.redo(), disabled: !this.history.canRedo },
        '-',
        { label: 'Clear layer', key: 'Del', run: () => this.clearLayer() },
        { label: 'Fill layer with main color', key: 'Alt+Del', run: () => this.fillLayer() },
        '-',
        { label: 'Flip canvas horizontally', run: () => this.flipPixels(d.layers, 'h', 'Flip canvas') },
        { label: 'Flip canvas vertically', run: () => this.flipPixels(d.layers, 'v', 'Flip canvas') },
      ],
      layer: [
        { label: 'New layer', key: 'Ctrl+Shift+N', run: () => this.layerAdd() },
        { label: 'Duplicate layer', run: () => this.layerDuplicate() },
        { label: 'Delete layer', run: () => this.layerDelete() },
        { label: 'Merge with layer below', key: 'Ctrl+E', run: () => this.mergeDown(), disabled: d.active === 0 },
        '-',
        { label: 'Flip layer horizontally', run: () => this.flipPixels([d.layer], 'h', 'Flip layer') },
        { label: 'Flip layer vertically', run: () => this.flipPixels([d.layer], 'v', 'Flip layer') },
        '-',
        { label: 'Rename layer…', run: async () => { const n = await promptBox('Rename layer', 'Layer name', d.layer.name); if (n) this.setLayerProp(d.layer, 'name', n, 'Rename layer'); } },
      ],
      view: [
        { label: 'Zoom in', key: 'Ctrl+=', run: () => this.zoomStep(1) },
        { label: 'Zoom out', key: 'Ctrl+-', run: () => this.zoomStep(-1) },
        { label: 'Actual size (100%)', key: 'Ctrl+1', run: () => this.actual() },
        { label: 'Fit to window', key: 'Ctrl+0', run: () => this.fit() },
        '-',
        { label: 'Rotate left', key: '4', run: () => this.rotate(-15) },
        { label: 'Rotate right', key: '6', run: () => this.rotate(15) },
        { label: 'Reset rotation', key: '5', run: () => this.rotate(null) },
        { label: 'Mirror view', key: 'M', run: () => this.flipView() },
        '-',
        { label: 'Reload screen', key: 'F5', run: () => window.koeReload?.() },
      ],
    }[name];
  }

  // ---------- rendering ----------

  resize() {
    const r = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    this.bg = getComputedStyle(this.viewport).getPropertyValue('--canvas-bg').trim() || '#2a2b31';
    if (this.needsFit && r.width > 0 && r.height > 0) {
      this.needsFit = false;
      this.view = fitView(this.doc.width, this.doc.height, r.width, r.height);
    }
    for (const c of [this.viewCanvas, this.overlay]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    this.render();
    this.drawCursor();
  }

  /** Recomposites a doc region (all of it when r is null) into the composite canvas. */
  updateComp(r) {
    const d = this.doc;
    const area = clip(r || { x: 0, y: 0, w: d.width, h: d.height }, d.width, d.height);
    if (area) composite(this.compCtx, d, area, this.live);
  }

  requestRender() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  render() {
    const ctx = this.vctx, d = this.doc, dpr = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
    const [a, b, c, dd, e, f] = matrix(this.view);
    ctx.setTransform(a * dpr, b * dpr, c * dpr, dd * dpr, e * dpr, f * dpr);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, d.width, d.height);
    ctx.shadowColor = 'transparent';
    if (!d.paper) {
      ctx.fillStyle = this.checker(ctx);
      ctx.fillRect(0, 0, d.width, d.height);
    }
    ctx.imageSmoothingEnabled = this.view.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.comp, 0, 0);
    this.root.querySelector('.zoom-label').textContent = Math.round(this.view.zoom * 1000) / 10 + '%';
    const deg = Math.round(((this.view.rot * 180 / Math.PI) % 360 + 540) % 360 - 180);
    this.root.querySelector('.rot-label').textContent = deg + '°' + (this.view.flip ? ' ⇋' : '');
  }

  checker(ctx) {
    if (!this.checkerPattern) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#d9d9de'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      this.checkerPattern = ctx.createPattern(c, 'repeat');
    }
    return this.checkerPattern;
  }

  /** Brush outline (paint tools) under the pointer, drawn on the overlay canvas. */
  drawCursor() {
    const ctx = this.octx, dpr = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const tool = TOOL_BY_ID[this.effectiveTool()];
    this.overlay.style.cursor = { paint: 'none', fill: 'crosshair', picker: 'crosshair', move: 'move',
      hand: this.gesture?.type === 'pan' ? 'grabbing' : 'grab' }[tool.kind];
    if (!this.pointer || tool.kind !== 'paint') return;
    const r = Math.max(1, (this.settings[tool.id].size * this.view.zoom) / 2) * dpr;
    const x = this.pointer.x * dpr, y = this.pointer.y * dpr;
    ctx.lineWidth = 1 * dpr;
    for (const [color, rr] of [['rgba(0,0,0,0.75)', r + dpr], ['rgba(255,255,255,0.9)', r]]) {
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
    }
    if (r < 4 * dpr) {  // tiny brush: add a crosshair so the cursor stays visible
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.moveTo(x - 7 * dpr, y); ctx.lineTo(x - 3 * dpr, y); ctx.moveTo(x + 3 * dpr, y); ctx.lineTo(x + 7 * dpr, y);
      ctx.moveTo(x, y - 7 * dpr); ctx.lineTo(x, y - 3 * dpr); ctx.moveTo(x, y + 3 * dpr); ctx.lineTo(x, y + 7 * dpr);
      ctx.stroke();
    }
  }

  // ---------- view ----------

  setView(v) { this.view = v; this.render(); this.drawCursor(); }
  fit() { this.setView(fitView(this.doc.width, this.doc.height, this.vw, this.vh)); }
  actual() { this.setView(actualSize(this.view, this.vw, this.vh)); }
  zoomStep(dir) {
    const z = this.view.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > z * 1.001) : [...ZOOM_STEPS].reverse().find(s => s < z / 1.001);
    if (next) this.setView(zoomAt(this.view, next / z, this.vw / 2, this.vh / 2));
  }
  rotate(deg) {
    const rad = deg === null ? -this.view.rot : deg * Math.PI / 180;
    this.setView(rotateAt(this.view, rad, this.vw / 2, this.vh / 2));
  }
  flipView() { this.setView(flipAt(this.view, this.vw / 2, this.vh / 2)); }

  // ---------- tools ----------

  selectTool(id) {
    if (!TOOL_BY_ID[id]) return;
    this.tool = id;
    store('tool', id);
    this.root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
    this.renderToolProps();
    this.drawCursor();
  }

  /** The tool in use right now, counting held keys (Space = hand, Alt = eyedropper) and the pen's eraser end. */
  effectiveTool() {
    if (this.gesture?.tool) return this.gesture.tool;
    if (this.held.space) return 'hand';
    const kind = TOOL_BY_ID[this.tool].kind;
    if (this.held.alt && (kind === 'paint' || kind === 'fill')) return 'picker';
    return this.tool;
  }

  renderToolProps() {
    const t = TOOL_BY_ID[this.tool], s = this.settings[t.id];
    this.root.querySelector('.tool-title').textContent = t.label;
    const box = this.root.querySelector('.tool-props');
    const fields = SETTING_FIELDS.filter(f => f[0] in s);
    if (!fields.length) {
      box.innerHTML = `<p class="muted small">${t.kind === 'picker' ? 'Click the canvas to pick a color. Hold Alt with a brush to pick quickly.'
        : t.kind === 'move' ? 'Drag to move the selected layer.' : 'Drag to move the view. Hold Space with any tool to do the same.'}</p>`;
      return;
    }
    box.innerHTML = fields.map(([key, label, type, min, max, step]) => type === 'check'
      ? `<label class="check"><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}> ${esc(label)}</label>`
      : `<label class="slider"><span>${esc(label)}</span><input type="range" data-k="${key}" min="${key === 'size' ? 0 : min}" max="${key === 'size' ? 1000 : max}" step="${key === 'size' ? 1 : step}" value="${key === 'size' ? sizeToSlider(s.size) : s[key]}"><output>${fmt(key, s[key])}</output></label>`).join('');
    box.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        s[k] = inp.type === 'checkbox' ? inp.checked : k === 'size' ? sliderToSize(+inp.value) : +inp.value;
        const out = inp.parentElement.querySelector('output');
        if (out) out.textContent = fmt(k, s[k]);
        store('tools', this.settings);
        this.drawCursor();
      });
    });
  }

  setSize(size) {
    const s = this.settings[this.tool];
    if (!('size' in s)) return;
    s.size = size;
    store('tools', this.settings);
    this.renderToolProps();
    this.drawCursor();
  }

  // ---------- pointer input ----------

  bindPointer() {
    const el = this.overlay;
    const pos = e => {
      const r = this.viewport.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pressure = e => e.pointerType === 'mouse' ? 1 : (e.pressure || (e.pointerType === 'touch' ? 1 : 0.01));
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('pointerdown', e => {
      if (this.gesture) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const p = pos(e);
      this.pointer = p;
      if (e.button === 1) return this.beginPan(p, e.pointerId);
      if (e.button !== 0 && !(e.pointerType === 'pen' && e.button === 5)) return;
      const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
      const toolId = penEraser ? 'eraser' : this.effectiveTool();
      const tool = TOOL_BY_ID[toolId];
      const dp = { ...toDoc(this.view, p.x, p.y), p: pressure(e) };
      if (tool.kind === 'hand') this.beginPan(p, e.pointerId);
      else if (tool.kind === 'paint') this.beginPaint(toolId, dp, e.pointerId);
      else if (tool.kind === 'fill') this.fillAt(dp);
      else if (tool.kind === 'picker') { this.gesture = { type: 'pick', tool: toolId, id: e.pointerId }; this.pickAt(dp); }
      else if (tool.kind === 'move') this.beginMove(dp, e.pointerId);
      this.drawCursor();
    });
    el.addEventListener('pointermove', e => {
      const p = pos(e);
      this.pointer = p;
      const g = this.gesture;
      if (g && g.id === e.pointerId) {
        if (g.type === 'paint') {
          const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          for (const ev of evs.length ? evs : [e]) {
            const q = pos(ev);
            this.addPoint({ ...toDoc(this.view, q.x, q.y), p: pressure(ev) });
          }
          this.requestRender();
        } else if (g.type === 'pan') {
          this.view = { ...this.view, panX: g.view.panX + p.x - g.start.x, panY: g.view.panY + p.y - g.start.y };
          this.requestRender();
        } else if (g.type === 'pick') {
          this.pickAt(toDoc(this.view, p.x, p.y));
        } else if (g.type === 'move') {
          this.moveTo(toDoc(this.view, p.x, p.y));
        }
      }
      const dp = toDoc(this.view, p.x, p.y);
      this.root.querySelector('.cursor-pos').textContent = `${Math.floor(dp.x)}, ${Math.floor(dp.y)}`;
      this.drawCursor();
    });
    const end = e => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      if (g.type === 'paint') this.endPaint();
      else if (g.type === 'move') this.endMove();
      this.gesture = null;
      this.drawCursor();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', () => { if (!this.gesture) { this.pointer = null; this.drawCursor(); } });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const p = pos(e);
      if (e.shiftKey && !e.ctrlKey) this.setView(rotateAt(this.view, Math.sign(e.deltaY || e.deltaX) * Math.PI / 12, p.x, p.y));
      else this.setView(zoomAt(this.view, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y));
    }, { passive: false });
    // drop image files onto the canvas to add them as layers
    this.viewport.addEventListener('dragover', e => e.preventDefault());
    this.viewport.addEventListener('drop', async e => {
      e.preventDefault();
      for (const f of e.dataTransfer?.files || []) if (f.type.startsWith('image/')) await this.addImageLayer(await fileToDataUrl(f), f.name.replace(/\.[^.]+$/, ''));
    });
  }

  beginPan(p, id) {
    this.gesture = { type: 'pan', tool: 'hand', id, start: p, view: { ...this.view } };
  }

  // ---------- painting ----------

  beginPaint(toolId, pt, id) {
    const layer = this.doc.layer, tool = TOOL_BY_ID[toolId], s = this.settings[toolId];
    if (!layer.visible) return toast('This layer is hidden. Show it to draw on it.');
    this.strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.strokeCtx.globalAlpha = 1;
    this.strokeCtx.globalCompositeOperation = 'source-over';
    this.strokeCtx.clearRect(0, 0, this.doc.width, this.doc.height);
    const sizeAt = p => stampFor(s, pressureCurve(p, s.gamma)).size;
    this.gesture = {
      type: 'paint', tool: toolId, id, s, sizeAt, layer, bounds: null, last: pt, erase: !!tool.erase,
      painter: new Painter(this.strokeCtx, { color: tool.erase ? '#000000' : this.colors.main, hardness: s.hardness }),
      smoother: new Smoother(s.smoothing),
      path: new StampPath(sizeAt, s.spacing),
    };
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: tool.erase ? 'destination-out' : layer.alphaLock ? 'source-atop' : 'source-over' };
    this.addPoint(pt);
    this.requestRender();
  }

  addPoint(pt) {
    const g = this.gesture;
    g.last = pt;
    const stamps = g.path.add(g.smoother.add(pt));
    if (!stamps.length) return;
    for (const st of stamps) {
      const { size, flow } = stampFor(g.s, pressureCurve(st.p, g.s.gamma));
      g.painter.dab(st.x, st.y, size, flow);
    }
    const r = stampBounds(stamps, g.sizeAt);
    g.bounds = union(g.bounds, r);
    this.updateComp(r);
  }

  endPaint() {
    const g = this.gesture;
    // stabilization lags behind the pen: catch up to where the pen was lifted
    if (g.s.smoothing) for (let i = 0; i < 12; i++) this.addPoint(g.last);
    this.commitStroke(g.layer, g.bounds, g.erase ? 'Erase' : 'Paint');
    if (!g.erase) this.colors.used();
  }

  /** Applies the stroke canvas (this.live) to its layer inside rect r, recording it for undo. */
  commitStroke(layer, r, label) {
    const live = this.live;
    this.live = null;
    r = clip(r, this.doc.width, this.doc.height);
    if (!live || !r) { this.updateComp(r); this.requestRender(); return; }
    const before = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    const ctx = layer.ctx;
    ctx.save();
    ctx.globalAlpha = live.alpha;
    ctx.globalCompositeOperation = live.mode;
    ctx.drawImage(this.stroke, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx.restore();
    const after = layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    this.pushPatch(layer, r, before, after, label);
    layer.touch();
    this.changed(r);
  }

  pushPatch(layer, r, before, after, label) {
    const put = img => { layer.ctx.putImageData(img, r.x, r.y); layer.touch(); this.changed(r); };
    this.history.push({ label, bytes: r.w * r.h * 8, undo: () => put(before), redo: () => put(after) });
  }

  fillAt(pt) {
    const layer = this.doc.layer, s = this.settings.fill, d = this.doc;
    if (!layer.visible) return toast('This layer is hidden. Show it to fill on it.');
    const src = s.sampleAll ? this.compCtx : layer.ctx;
    const data = src.getImageData(0, 0, d.width, d.height).data;
    let res = floodMask(data, d.width, d.height, pt.x, pt.y, s.tolerance);
    if (!res) return;
    res = growMask(res.mask, d.width, d.height, s.grow, res.bounds);
    const b = res.bounds;
    const [cr, cg, cb] = hexToRgb(this.colors.main);
    const img = new ImageData(b.w, b.h);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (!res.mask[(b.y + y) * d.width + b.x + x]) continue;
        const i = (y * b.w + x) * 4;
        img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = 255;
      }
    }
    this.strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.strokeCtx.clearRect(0, 0, d.width, d.height);
    this.strokeCtx.putImageData(img, b.x, b.y);
    this.live = { layer, canvas: this.stroke, alpha: s.opacity, mode: layer.alphaLock ? 'source-atop' : 'source-over' };
    this.commitStroke(layer, b, 'Fill');
    this.colors.used();
  }

  pickAt(pt) {
    const x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
    const p = this.compCtx.getImageData(x, y, 1, 1).data;
    if (p[3] === 0) return;
    this.colors.set(rgbToHex(p[0], p[1], p[2]));
  }

  // ---------- move layer ----------

  beginMove(pt, id) {
    const layer = this.doc.layer, d = this.doc;
    if (!layer.visible) return toast('This layer is hidden. Show it to move it.');
    const copy = document.createElement('canvas');
    copy.width = d.width; copy.height = d.height;
    copy.getContext('2d').drawImage(layer.canvas, 0, 0);
    this.gesture = { type: 'move', tool: 'move', id, layer, start: pt, copy, dx: 0, dy: 0,
      before: layer.ctx.getImageData(0, 0, d.width, d.height) };
  }

  moveTo(pt) {
    const g = this.gesture, d = this.doc;
    g.dx = Math.round(pt.x - g.start.x);
    g.dy = Math.round(pt.y - g.start.y);
    g.layer.ctx.clearRect(0, 0, d.width, d.height);
    g.layer.ctx.drawImage(g.copy, g.dx, g.dy);
    this.updateComp(null);
    this.requestRender();
  }

  endMove() {
    const g = this.gesture, d = this.doc;
    if (!g.dx && !g.dy) return;
    const r = { x: 0, y: 0, w: d.width, h: d.height };
    this.pushPatch(g.layer, r, g.before, g.layer.ctx.getImageData(0, 0, d.width, d.height), 'Move layer');
    g.layer.touch();
    this.changed(null);
  }

  // ---------- layers ----------

  selectLayer(i) {
    this.doc.active = Math.max(0, Math.min(this.doc.layers.length - 1, i));
    this.layers.render();
    this.doc.version++;
    this.scheduleSave();
  }

  /** Records and applies a structural change; do() and undo() must leave doc.active sensible. */
  structural(label, doIt, undoIt, bytes = 0) {
    doIt();
    this.history.push({ label, bytes, undo: () => { undoIt(); this.layersChanged(); }, redo: () => { doIt(); this.layersChanged(); } });
    this.layersChanged();
  }

  layersChanged() {
    this.layers.render();
    this.changed(null);
  }

  insertLayer(layer, index, label) {
    const d = this.doc, prev = d.active;
    this.structural(label,
      () => { d.layers.splice(index, 0, layer); d.active = index; },
      () => { d.layers.splice(d.layers.indexOf(layer), 1); d.active = Math.min(prev, d.layers.length - 1); },
      d.width * d.height * 4);
  }

  layerAdd() {
    const d = this.doc;
    this.insertLayer(new Layer(d.width, d.height, { name: d.newLayerName() }), d.active + 1, 'New layer');
  }

  layerDuplicate() {
    const d = this.doc, l = d.layer;
    const copy = new Layer(d.width, d.height, { name: l.name + ' copy', visible: l.visible, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock, clip: l.clip });
    copy.ctx.drawImage(l.canvas, 0, 0);
    this.insertLayer(copy, d.active + 1, 'Duplicate layer');
  }

  layerDelete() {
    const d = this.doc;
    if (d.layers.length === 1) return toast('An artwork needs at least one layer. Use Edit → Clear layer instead.');
    const i = d.active, l = d.layer;
    this.structural('Delete layer',
      () => { d.layers.splice(i, 1); d.active = Math.max(0, i - 1); },
      () => { d.layers.splice(i, 0, l); d.active = i; },
      d.width * d.height * 4);
  }

  layerMove(dir) {
    const d = this.doc, i = d.active, j = i + dir;
    if (j < 0 || j >= d.layers.length) return;
    const swap = (a, b) => { [d.layers[a], d.layers[b]] = [d.layers[b], d.layers[a]]; };
    this.structural('Move layer', () => { swap(i, j); d.active = j; }, () => { swap(i, j); d.active = i; });
  }

  mergeDown() {
    const d = this.doc, i = d.active;
    if (i === 0) return toast('There is no layer below to merge into.');
    const upper = d.layers[i], lower = d.layers[i - 1];
    if (!upper.visible || !lower.visible) return toast('Show both layers before merging them.');
    const full = { x: 0, y: 0, w: d.width, h: d.height };
    const before = lower.ctx.getImageData(0, 0, d.width, d.height);
    let src = upper.canvas;
    if (upper.clip) {  // keep only what shows through the layer below
      src = document.createElement('canvas');
      src.width = d.width; src.height = d.height;
      const c = src.getContext('2d');
      c.drawImage(upper.canvas, 0, 0);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(lower.canvas, 0, 0);
    }
    lower.ctx.save();
    lower.ctx.globalAlpha = upper.opacity;
    lower.ctx.globalCompositeOperation = lower.alphaLock ? 'source-atop' : upper.blend;
    lower.ctx.drawImage(src, 0, 0);
    lower.ctx.restore();
    const after = lower.ctx.getImageData(0, 0, d.width, d.height);
    lower.ctx.putImageData(before, 0, 0);
    const put = img => { lower.ctx.putImageData(img, full.x, full.y); lower.touch(); };
    this.structural('Merge down',
      () => { put(after); d.layers.splice(i, 1); d.active = i - 1; },
      () => { put(before); d.layers.splice(i, 0, upper); d.active = i; },
      d.width * d.height * 12);
  }

  setLayerProp(layer, key, value, label) {
    const old = layer[key];
    if (old === value) return this.layers.render();
    this.structural(label, () => { layer[key] = value; }, () => { layer[key] = old; });
  }

  /** Visibility is not an undo step (as in other painting programs), but it is saved. */
  toggleVisible(layer) {
    layer.visible = !layer.visible;
    this.layersChanged();
  }

  clearLayer() {
    const d = this.doc, l = d.layer;
    const before = l.ctx.getImageData(0, 0, d.width, d.height);
    l.ctx.clearRect(0, 0, d.width, d.height);
    this.pushPatch(l, { x: 0, y: 0, w: d.width, h: d.height }, before, l.ctx.getImageData(0, 0, d.width, d.height), 'Clear layer');
    l.touch();
    this.changed(null);
  }

  fillLayer() {
    const d = this.doc, l = d.layer;
    const before = l.ctx.getImageData(0, 0, d.width, d.height);
    l.ctx.save();
    l.ctx.fillStyle = this.colors.main;
    if (l.alphaLock) l.ctx.globalCompositeOperation = 'source-atop';
    l.ctx.fillRect(0, 0, d.width, d.height);
    l.ctx.restore();
    this.pushPatch(l, { x: 0, y: 0, w: d.width, h: d.height }, before, l.ctx.getImageData(0, 0, d.width, d.height), 'Fill layer');
    l.touch();
    this.changed(null);
  }

  /** Mirrors layers' pixels. Mirroring twice gives the original back, so undo is the same operation. */
  flipPixels(layers, axis, label) {
    const d = this.doc;
    const flip = () => {
      const tmp = document.createElement('canvas');
      tmp.width = d.width; tmp.height = d.height;
      const t = tmp.getContext('2d');
      for (const l of layers) {
        t.clearRect(0, 0, d.width, d.height);
        t.drawImage(l.canvas, 0, 0);
        l.ctx.save();
        l.ctx.clearRect(0, 0, d.width, d.height);
        if (axis === 'h') l.ctx.setTransform(-1, 0, 0, 1, d.width, 0);
        else l.ctx.setTransform(1, 0, 0, -1, 0, d.height);
        l.ctx.drawImage(tmp, 0, 0);
        l.ctx.restore();
        l.touch();
      }
    };
    this.structural(label, flip, flip);
  }

  async addImageLayer(src, name = 'Image') {
    const d = this.doc;
    let img;
    try { img = await loadImage(src); } catch (e) { return toast(e.message, { error: true }); }
    const layer = new Layer(d.width, d.height, { name: name.slice(0, 60) || 'Image' });
    const s = Math.min(1, d.width / img.width, d.height / img.height);
    const w = img.width * s, h = img.height * s;
    layer.ctx.drawImage(img, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h);
    this.insertLayer(layer, d.active + 1, 'Import image');
  }

  pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (f) await this.addImageLayer(await fileToDataUrl(f), f.name.replace(/\.[^.]+$/, ''));
    };
    inp.click();
  }

  async onPaste(e) {
    if (isTyping(e.target)) return;
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        await this.addImageLayer(await fileToDataUrl(item.getAsFile()), 'Pasted image');
        return;
      }
    }
  }

  // ---------- undo ----------

  undo() { if (!this.gesture && this.history.undo()) this.layers.render(); }
  redo() { if (!this.gesture && this.history.redo()) this.layers.render(); }

  updateUndoButtons() {
    const u = this.root.querySelector('[data-act="undo"]'), r = this.root.querySelector('[data-act="redo"]');
    if (u) { u.disabled = !this.history.canUndo; u.title = this.history.canUndo ? `Undo ${this.history.done.at(-1).label} (Ctrl+Z)` : 'Nothing to undo'; }
    if (r) { r.disabled = !this.history.canRedo; r.title = this.history.canRedo ? `Redo ${this.history.undone.at(-1).label} (Ctrl+Y)` : 'Nothing to redo'; }
  }

  // ---------- changes and saving ----------

  /** After any change: recomposite (r, or everything), redraw, refresh layer previews, and save soon. */
  changed(r, { save = true } = {}) {
    this.updateComp(r);
    this.requestRender();
    if (!this.thumbRaf) this.thumbRaf = requestAnimationFrame(() => { this.thumbRaf = 0; this.layers.thumbs(); });
    if (save) {
      this.doc.version++;
      this.scheduleSave();
    }
  }

  setStatus(text) {
    const el = this.root.querySelector('.save-state');
    if (el) el.textContent = text;
  }

  scheduleSave() {
    this.setStatus('Unsaved changes');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  async save() {
    clearTimeout(this.saveTimer);
    if (this.saving) { this.saveAgain = true; return this.saving; }
    const d = this.doc, v = d.version;
    if (v === this.savedVersion) return;
    this.setStatus('Saving…');
    this.saving = (async () => {
      const json = await d.toJSON();
      json.thumb = await canvasToDataUrl(d.flatten(360));
      const res = await api.save(d.id || '', json);
      d.id = res.id;
      store('last', res.id);
      this.savedVersion = v;
    })();
    try {
      await this.saving;
    } catch (e) {
      this.setStatus('Not saved!');
      toast('Could not save: ' + e.message, { error: true, ms: 8000 });
    } finally {
      this.saving = null;
    }
    if (d.version !== this.savedVersion && this.saveAgain) { this.saveAgain = false; return this.save(); }
    this.setStatus(d.version === this.savedVersion ? 'Saved' : 'Unsaved changes');
  }

  /** Saves anything pending; used before reloading or leaving the editor. */
  async flush() {
    if (this.saving) await this.saving.catch(() => {});
    if (this.doc && this.doc.version !== this.savedVersion) await this.save();
  }

  async goHome() {
    await this.flush();
    this.onHome();
  }

  async rename() {
    const t = await promptBox('Rename artwork', 'Title', this.doc.title);
    if (!t) return;
    this.doc.title = t;
    this.root.querySelector('.ed-title').textContent = t;
    this.doc.version++;
    this.scheduleSave();
  }

  async exportPng() {
    const blob = await new Promise(r => this.doc.flatten().toBlob(r, 'image/png'));
    try {
      const res = await api.exportPng(this.doc.title, blob);
      toast('Exported to ' + res.path, { action: { label: 'Show folder', run: () => api.openFolder('Exports') }, ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    }
  }

  // ---------- keyboard ----------

  onKey(e) {
    if (isTyping(e.target) || document.querySelector('.modal-back')) return;
    const c = e.key === 'Alt' ? 'alt' : comboOf(e);
    if (c === 'space' || c === 'alt') {
      e.preventDefault();
      if (!this.held[c]) { this.held[c] = true; this.drawCursor(); }
      return;
    }
    const t = TOOLS.find(x => x.key === c);
    if (t) { this.selectTool(t.id); return; }
    const s = this.settings[this.tool];
    const map = {
      '[': () => s.size && this.setSize(nextSize(s.size, -1)),
      ']': () => s.size && this.setSize(nextSize(s.size, 1)),
      'x': () => this.colors.swap(),
      'm': () => this.flipView(),
      '4': () => this.rotate(-15), '6': () => this.rotate(15), '5': () => this.rotate(null),
      'delete': () => this.clearLayer(), 'backspace': () => this.clearLayer(),
      'alt+delete': () => this.fillLayer(), 'alt+backspace': () => this.fillLayer(),
      'ctrl+z': () => this.undo(), 'ctrl+y': () => this.redo(), 'ctrl+shift+z': () => this.redo(),
      'ctrl+s': () => this.save(), 'ctrl+shift+s': () => this.exportPng(),
      'ctrl+e': () => this.mergeDown(), 'ctrl+shift+n': () => this.layerAdd(),
      'ctrl+0': () => this.fit(), 'ctrl+1': () => this.actual(),
      'ctrl+=': () => this.zoomStep(1), 'ctrl+-': () => this.zoomStep(-1),
    };
    const fn = map[c];
    if (fn) { e.preventDefault(); if (!this.gesture) fn(); }
  }

  onKeyUp(e) {
    const key = e?.key === ' ' ? 'space' : e?.key === 'Alt' ? 'alt' : null;
    if (e?.type === 'blur') { this.held.space = this.held.alt = false; }
    else if (key) { this.held[key] = false; if (key === 'alt') e.preventDefault(); }
    else return;
    this.drawCursor();
  }
}

// The size slider is logarithmic, so small sizes get most of its length.
const LOG_MAX = Math.log(1000);
function sliderToSize(v) { return Math.max(1, Math.round(Math.exp((v / 1000) * LOG_MAX) * 10) / 10); }
function sizeToSlider(size) { return Math.round((Math.log(Math.max(1, size)) / LOG_MAX) * 1000); }

function fmt(key, v) {
  if (key === 'size') return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' px';
  if (['opacity', 'flow', 'hardness', 'spacing', 'minSize'].includes(key)) return Math.round(v * 100) + '%';
  if (key === 'gamma') return v.toFixed(2);
  return String(v);
}

export async function openEditor(root, { id, newDoc, onHome }) {
  const ed = new Editor(root, { onHome });
  if (newDoc) {
    await ed.open(newDoc, { isNew: true });
  } else {
    const raw = await api.load(id);
    await ed.open(await Doc.fromJSON(raw, id));
  }
  return ed;
}

