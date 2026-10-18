// Whole-canvas operations: canvas size, image size, crop (tool and to selection) and turning the canvas.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.
// Every one goes through reshapeCanvas(): each layer (and the quick mask, while it is on) gets a new canvas, and
// one undo step swaps them back.

import { mapRulers } from '../rulers.js';
import { ANCHORS, anchorOffset, validSide, keepRatio, rotatedSize, cropRect } from '../canvasmath.js';
import { MAX_SIDE, renderFolder } from '../doc.js';
import { DPI_MIN, DPI_MAX, sanitizeDpi, printLabel } from '../resolution.js';
import { icon } from '../icons.js';
import { Selection, maskBounds } from '../selection.js';
import { newTransform, corners, hitTest, dragHandle } from '../transform.js';
import { modal, toast } from '../ui.js';
import { matrix, toDoc } from '../view.js';
import { HANDLE_PX } from './selecttools.js';

export const canvasMethods = {
  /** Gives every layer and mask (the quick mask too) a new w x h canvas drawn by paint(ctx, oldCanvas), as one undo step.
   *  m ([a, b, c, d, e, f], old doc point to new) carries the guides and rulers along (mapRulers). */
  reshapeCanvas(label, w, h, paint, m = null) {
    this.finishTransform();
    this.finishText();
    if (!validSide(w) || !validSide(h)) return toast(`Width and height must be between 1 and ${MAX_SIDE} pixels.`, { error: true });
    const d = this.doc;
    const rasters = this.quickMask ? [...d.rasters(), this.quickMask] : d.rasters();  // the quick mask changes along
    const before = { w: d.width, h: d.height, canvases: new Map(rasters.map(l => [l, l.canvas])) };
    const after = { w, h, canvases: new Map() };
    for (const l of rasters) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      paint(ctx, l.canvas);
      after.canvases.set(l, c);
    }
    const bytes = rasters.length * (before.w * before.h + w * h) * 4;
    const tx = this.textsIn(rasters, m);  // text follows m in its matrix (else becomes pixels); lines follow a shift
    const rl = this.rulersAlong(m, d.width, d.height, w, h);
    this.structural(label, () => { this.setCanvasState(after); tx.drop(); rl.apply(); }, () => { this.setCanvasState(before); tx.restore(); rl.revert(); }, bytes);
  },

  /** apply/revert for moving the rulers with a change of the canvas (see reshapeCanvas); nothing without m. */
  rulersAlong(m, oldW, oldH, newW, newH) {
    if (!m) return { apply() {}, revert() {} };
    const before = JSON.stringify(this.doc.rulers), after = JSON.stringify(mapRulers(this.doc.rulers, m, oldW, oldH, newW, newH));
    const set = json => { this.doc.rulers = JSON.parse(json); this.rulerPick = -1; this.updateSnapButton(); this.drawOverlay(); };
    return { apply: () => set(after), revert: () => set(before) };
  },

  setCanvasState(s) {
    const d = this.doc;
    d.width = s.w;
    d.height = s.h;
    for (const [layer, canvas] of s.canvases) {
      layer.canvas = canvas;
      layer.ctx = canvas.getContext('2d');
      layer.touch();
    }
    for (const c of [this.comp, this.stroke]) { c.width = s.w; c.height = s.h; }
    this.mips = [this.comp];
    this.sel = new Selection(s.w, s.h);  // a selection does not survive a change of canvas size
    this.showDocSize();
    if (this.crop) this.startCrop();
    this.updateComp(null);
    this.fit();
  },

  // ---------- dialogs and menu commands ----------

  async canvasSizeDialog() {
    const d = this.doc;
    const res = await modal({
      title: 'Canvas size',
      body: `
        <p class="muted small">Adds or removes space around the picture without stretching it. Now ${d.width} × ${d.height} px.</p>
        <div class="field-row">
          <label class="field"><span>Width (px)</span><input type="number" name="w" min="1" max="${MAX_SIDE}" value="${d.width}"></label>
          <label class="field"><span>Height (px)</span><input type="number" name="h" min="1" max="${MAX_SIDE}" value="${d.height}"></label>
        </div>
        <div class="field"><span>Keep the picture at</span>
          <div class="anchor-grid" role="radiogroup" aria-label="Anchor">${ANCHORS.map(a =>
            `<button type="button" data-a="${a}" class="${a === 'c' ? 'on' : ''}" aria-label="${a}" title="${anchorName(a)}"></button>`).join('')}</div>
        </div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Resize canvas', primary: true }],
      onOpen: root => {
        root.querySelectorAll('[data-a]').forEach(b => {
          b.onclick = () => root.querySelectorAll('[data-a]').forEach(x => x.classList.toggle('on', x === b));
        });
      },
      collect: root => {
        const w = validSide(root.querySelector('[name="w"]').value), h = validSide(root.querySelector('[name="h"]').value);
        if (!w || !h) { toast(`Width and height must be between 1 and ${MAX_SIDE} pixels.`, { error: true }); return undefined; }
        return { w, h, anchor: root.querySelector('[data-a].on').dataset.a };
      },
    });
    if (!res || (res.w === d.width && res.h === d.height)) return;
    const { dx, dy } = anchorOffset(d.width, d.height, res.w, res.h, res.anchor);
    this.reshapeCanvas('Canvas size', res.w, res.h, (ctx, old) => ctx.drawImage(old, dx, dy), [1, 0, 0, 1, dx, dy]);
  },

  async imageSizeDialog() {
    const d = this.doc;
    const res = await modal({
      title: 'Image size',
      body: `
        <p class="muted small">Stretches or shrinks the whole picture, every layer. Now ${d.width} × ${d.height} px at ${d.dpi} dpi.</p>
        <div class="field-row">
          <label class="field"><span>Width (px)</span><input type="number" name="w" min="1" max="${MAX_SIDE}" value="${d.width}"></label>
          <label class="field"><span>Height (px)</span><input type="number" name="h" min="1" max="${MAX_SIDE}" value="${d.height}"></label>
          <label class="field"><span>Scale (%)</span><input type="number" name="pct" min="1" max="1000" value="100"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Resolution (dpi)</span><input type="number" name="dpi" min="${DPI_MIN}" max="${DPI_MAX}" value="${d.dpi}"></label>
        </div>
        <p class="muted small" data-print></p>
        <label class="check"><input type="checkbox" name="keep" checked> Keep proportions</label>
        <label class="check"><input type="checkbox" name="smooth" checked> Smooth (off keeps hard pixels, for pixel art)</label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Resize image', primary: true }],
      onOpen: root => {
        const f = n => root.querySelector(`[name="${n}"]`);
        const print = () => { root.querySelector('[data-print]').textContent = 'Prints at ' + printLabel(+f('w').value || 1, +f('h').value || 1, f('dpi').value); };
        f('w').oninput = () => {
          if (f('keep').checked && validSide(f('w').value)) f('h').value = keepRatio(d.width, d.height, +f('w').value);
          f('pct').value = Math.round(+f('w').value / d.width * 100);
          print();
        };
        f('h').oninput = () => {
          if (f('keep').checked && validSide(f('h').value)) f('w').value = keepRatio(d.height, d.width, +f('h').value);
          f('pct').value = Math.round(+f('h').value / d.height * 100);
          print();
        };
        f('pct').oninput = () => {
          const k = +f('pct').value / 100;
          if (k > 0) { f('w').value = Math.max(1, Math.round(d.width * k)); f('h').value = Math.max(1, Math.round(d.height * k)); }
          print();
        };
        f('dpi').oninput = print;
        print();
      },
      collect: root => {
        const f = n => root.querySelector(`[name="${n}"]`);
        const w = validSide(f('w').value), h = validSide(f('h').value);
        if (!w || !h) { toast(`Width and height must be between 1 and ${MAX_SIDE} pixels.`, { error: true }); return undefined; }
        return { w, h, smooth: f('smooth').checked, dpi: sanitizeDpi(f('dpi').value) };
      },
    });
    if (!res) return;
    if (res.dpi !== d.dpi) {  // the print size: no pixels change, so its own small undo step
      const old = d.dpi;
      this.structural('Resolution', () => { d.dpi = res.dpi; this.showDocSize(); }, () => { d.dpi = old; this.showDocSize(); });
    }
    if (res.w === d.width && res.h === d.height) return;
    this.reshapeCanvas('Image size', res.w, res.h, (ctx, old) => {
      ctx.imageSmoothingEnabled = res.smooth;
      ctx.drawImage(old, 0, 0, res.w, res.h);
    }, [res.w / d.width, 0, 0, res.h / d.height, 0, 0]);
  },

  cropToSelection() {
    if (!this.sel.active) return toast('Make a selection first, then crop to it.');
    this.cropTo(this.sel.bounds);
  },

  /** Image → Trim to content: crops to the bounding box of everything visible (the paper does not count). */
  trimToContent() {
    const d = this.doc, c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    renderFolder(ctx, d.root, { x: 0, y: 0, w: d.width, h: d.height });
    const data = ctx.getImageData(0, 0, d.width, d.height).data, alpha = new Uint8Array(d.width * d.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    const r = maskBounds(alpha, d.width, d.height);
    if (!r) return toast('Nothing is drawn yet, so there is nothing to trim to.');
    if (r.w === d.width && r.h === d.height) return toast('The drawing already reaches every edge.');
    this.cropTo(r);
  },

  cropTo(r) {
    this.reshapeCanvas('Crop', r.w, r.h, (ctx, old) => ctx.drawImage(old, -r.x, -r.y), [1, 0, 0, 1, -r.x, -r.y]);
  },

  /** Turns the canvas by quarter turns: 1 = 90° right, -1 = 90° left, 2 = 180°. */
  rotateCanvas(q) {
    const d = this.doc, { w, h } = rotatedSize(d.width, d.height, q);
    const label = q === 2 ? 'Rotate canvas 180°' : `Rotate canvas 90° ${q > 0 ? 'right' : 'left'}`;
    this.reshapeCanvas(label, w, h, (ctx, old) => {
      if (q === 1) ctx.translate(w, 0);
      else if (q === -1) ctx.translate(0, h);
      else ctx.translate(w, h);
      ctx.rotate(q * Math.PI / 2);
      ctx.drawImage(old, 0, 0);
    }, q === 1 ? [0, 1, -1, 0, w, 0] : q === -1 ? [0, -1, 1, 0, 0, h] : [-1, 0, 0, -1, w, h]);
  },

  // ---------- crop tool ----------

  /** Selecting the Crop tool starts with a box around the selection, or the whole canvas. */
  startCrop() {
    const d = this.doc;
    this.crop = { r: this.sel.active ? { ...this.sel.bounds } : { x: 0, y: 0, w: d.width, h: d.height } };
    this.showCropBar();
    this.drawOverlay();
  },

  cancelCrop() {
    this.crop = null;
    this.viewport.querySelector('.crop-bar')?.remove();
    this.drawOverlay();
  },

  applyCrop() {
    const r = this.crop?.r, d = this.doc;
    if (!r) return;
    if (r.x === 0 && r.y === 0 && r.w === d.width && r.h === d.height) return toast('Drag the crop box edges inward first.');
    this.cropTo(r);
  },

  beginCrop(dp, id) {
    if (!this.crop) this.startCrop();
    const r = this.crop.r;
    const grab = hitTest(newTransform(r), dp, HANDLE_PX / this.view.zoom);
    this.gesture = { type: 'crop', tool: 'crop', id, grab: grab === 'rotate' ? 'new' : grab, r0: { ...r }, p0: dp };
  },

  cropDrag(dp, shift) {
    const g = this.gesture, d = this.doc;
    let r;
    if (g.grab === 'new') {
      r = cropRect(g.p0, dp, d.width, d.height);
    } else if (g.grab === 'move') {
      const x = Math.max(0, Math.min(d.width - g.r0.w, Math.round(g.r0.x + dp.x - g.p0.x)));
      const y = Math.max(0, Math.min(d.height - g.r0.h, Math.round(g.r0.y + dp.y - g.p0.y)));
      r = { ...g.r0, x, y };
    } else {
      const cs = corners(dragHandle(newTransform(g.r0), g.grab, dp, shift));
      r = cropRect(cs[0], cs[2], d.width, d.height);
    }
    if (r) this.crop.r = r;
    this.updateCropBar();
  },

  showCropBar() {
    if (this.viewport.querySelector('.crop-bar')) return this.updateCropBar();
    const bar = document.createElement('div');
    bar.className = 'xf-bar crop-bar';
    bar.innerHTML = `
      <span class="crop-readout muted small"></span>
      <button data-c="sel" title="Put the crop box around the selection">${icon('rectSel', 16)} Selection</button>
      <button data-c="all" title="Put the crop box around the whole canvas">${icon('fit', 16)} Whole canvas</button>
      <button data-c="cancel" title="Leave the crop tool (Esc)">Cancel</button>
      <button class="primary" data-c="ok" title="Crop (Enter)">Crop</button>`;
    const acts = {
      sel: () => { if (this.sel.active) { this.crop.r = { ...this.sel.bounds }; this.updateCropBar(); this.drawOverlay(); } else toast('Nothing is selected.'); },
      all: () => { this.crop.r = { x: 0, y: 0, w: this.doc.width, h: this.doc.height }; this.updateCropBar(); this.drawOverlay(); },
      cancel: () => this.selectTool('pen'),
      ok: () => this.applyCrop(),
    };
    bar.querySelectorAll('[data-c]').forEach(b => { b.onclick = () => acts[b.dataset.c](); });
    this.viewport.append(bar);
    this.updateCropBar();
  },

  updateCropBar() {
    const el = this.viewport.querySelector('.crop-readout');
    if (el && this.crop) el.textContent = `${this.crop.r.w} × ${this.crop.r.h} px`;
  },

  cropCursor() {
    if (!this.crop || !this.pointer) return 'crosshair';
    return this.handleCursor(newTransform(this.crop.r), toDoc(this.view, this.pointer.x, this.pointer.y));
  },

  /** Dims everything outside the crop box, and draws the box with thirds lines and handles. */
  drawCropOverlay(ctx) {
    if (!this.crop || this.xf) return;
    const dpr = this.dpr || 1, r = this.crop.r;
    const [a, b, c, d, e, f] = matrix(this.view);
    const sp = (x, y) => [(a * x + c * y + e) * dpr, (b * x + d * y + f) * dpr];
    const poly = pts => { ctx.moveTo(...sp(...pts[0])); for (const p of pts.slice(1)) ctx.lineTo(...sp(...p)); ctx.closePath(); };
    const box = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, this.overlay.width, this.overlay.height);
    poly(box);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const k of [1, 2]) {
      ctx.moveTo(...sp(r.x + r.w * k / 3, r.y)); ctx.lineTo(...sp(r.x + r.w * k / 3, r.y + r.h));
      ctx.moveTo(...sp(r.x, r.y + r.h * k / 3)); ctx.lineTo(...sp(r.x + r.w, r.y + r.h * k / 3));
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    poly(box);
    ctx.stroke();
    this.drawHandles(ctx, newTransform(r));
  },
};

function anchorName(a) {
  return { nw: 'Top left', n: 'Top', ne: 'Top right', w: 'Left', c: 'Centre', e: 'Right', sw: 'Bottom left', s: 'Bottom', se: 'Bottom right' }[a];
}
