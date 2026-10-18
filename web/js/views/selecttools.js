// Selection tools (rectangle, ellipse, lasso, polygon, magic wand), selection commands, copy/cut/paste and free transform.
// These are Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { floodMask } from '../fill.js';
import { hexToRgb, rgbToHex } from '../color.js';
import { colorRangeMask, strokeBand } from '../maskops.js';
import { Layer } from '../doc.js';
import { textBounds, drawText, textTransformStart, textMatrixAfter, renderTextLayer } from '../textlayer.js';
import { strokesInside, removeStrokes, mapStrokes, strokeBounds, brushOf } from '../vector.js';
import { renderVector } from '../vectorlayer.js';
import { icon } from '../icons.js';
import { maskBounds, modeFor, rectBetween, SELECT_MODES } from '../selection.js';
import { newTransform, xfMatrix, boxPoint, corners, hitTest, dragHandle, dragRotate, dragMove, isIdentity, HANDLES, quadHit, quadBounds, warpImage, meshFromQuad, meshSurface, meshWarp, meshHit, pointsBounds, homography, project } from '../transform.js';
import { clip, union } from '../rect.js';
import { esc, modal, store, toast } from '../ui.js';
import { matrix, toDoc, toScreen } from '../view.js';

const HANDLE_PX = 9;  // grab distance and drawn size of transform handles, in screen pixels
const CLOSE_PX = 8;   // clicking this close (screen px) to a polygon's first point closes it

const MESH_N = 3, MESH_SUB = 8;  // a mesh of 4 x 4 points; each cell drawn as 8 x 8 small quads

export const selectionMethods = {
  // ---------- selection commands ----------

  /** Changes the selection through fn() as one undo step. */
  changeSelection(label, fn) {
    if (this.xf) return;
    this.poly = null;  // a polygon being drawn is dropped by any other selection change
    const before = this.sel.snapshot();
    fn();
    const after = this.sel.snapshot();
    const restore = s => { this.sel.restore(s); this.drawOverlay(); };
    const bytes = [before, after].reduce((n, s) => n + s.canvas.width * s.canvas.height * 4 + s.segments.length * 40, 0);
    this.history.push({ label, bytes, undo: () => restore(before), redo: () => restore(after) });
    this.drawOverlay();
  },

  selectAll() { this.changeSelection('Select all', () => this.sel.all()); },
  deselect() { if (this.sel.active) this.changeSelection('Deselect', () => this.sel.clear()); },
  invertSelection() { this.changeSelection('Invert selection', () => this.sel.invert()); },
  selectLayerPixels() {
    const l = this.target('select from', { read: true });
    if (!l) return;
    this.changeSelection('Select layer pixels', () => this.sel.combine('replace', ctx => ctx.drawImage(l.canvas, 0, 0)));
    if (!this.sel.active) toast('This layer is empty, so nothing was selected.');
  },

  /** Select → Expand / Shrink / Feather: asks for a number of pixels, then changes the selection. */
  async morphSelection(kind) {
    if (!this.sel.active) return toast('There is no selection to change.');
    const titles = { expand: ['Expand selection', 'Grow the selection outwards by', 'Expand'], shrink: ['Shrink selection', 'Shrink the selection inwards by', 'Shrink'],
      feather: ['Feather selection', 'Soften the edges over', 'Feather'], border: ['Border selection', 'Select a band along the edge, as wide as', 'Select border'] };
    const [title, label, ok] = titles[kind];
    const last = (this.lastMorph ||= {})[kind] ?? (kind === 'feather' || kind === 'border' ? 10 : 2);
    const n = await modal({
      title,
      body: `<label class="field"><span>${esc(label)}</span><div class="field-row"><input type="number" name="n" min="1" max="500" step="1" value="${last}"><span class="muted small">px</span></div></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true }],
      onOpen: root => root.querySelector('input').select(),
      collect: root => { const v = Math.round(+root.querySelector('input').value); return v >= 1 && v <= 500 ? v : undefined; },
    });
    if (!n) return;
    this.lastMorph[kind] = n;
    this.changeSelection(title, () => (kind === 'feather' ? this.sel.feather(n) : kind === 'border' ? this.sel.border(n) : this.sel.morph(kind, n)));
  },

  /**
   * Select → Color range…: selects by closeness to a colour (the main colour, or one clicked on the canvas while
   * the dialog is open), softly at the edge of the range (colorRangeMask). The selection previews live; OK keeps
   * it as one undo step, Cancel puts the old one back.
   */
  async colorRangeDialog() {
    if (this.xf || this.colorRange) return;
    this.finishText();
    const d = this.doc, before = this.sel.snapshot();
    const saved = store('colorRange') || {};
    const job = this.colorRange = {
      color: hexToRgb(this.colors.main), fuzziness: Math.max(0, Math.min(255, +saved.fuzziness || 40)),
      sample: saved.sample === 'layer' ? 'layer' : 'all', mode: SELECT_MODES.some(([m]) => m === saved.mode) ? saved.mode : 'replace', data: null, raf: 0,
    };
    const sampled = () => {
      if (!job.data) {
        const t = job.sample === 'layer' ? this.target('select from', { read: true }) : null;
        job.data = this.sampleData(t ? 'layer' : 'all', t);
      }
      return job.data;
    };
    const preview = () => {
      const m = colorRangeMask(sampled(), job.color, job.fuzziness);
      const img = new ImageData(d.width, d.height);
      for (let i = 0; i < m.length; i++) img.data[i * 4 + 3] = m[i];
      const tmp = document.createElement('canvas');
      tmp.width = d.width; tmp.height = d.height;
      tmp.getContext('2d').putImageData(img, 0, 0);
      this.sel.restore(before);
      this.sel.combine(job.mode, ctx => ctx.drawImage(tmp, 0, 0));
      this.drawOverlay();
    };
    const later = () => { cancelAnimationFrame(job.raf); job.raf = requestAnimationFrame(preview); };
    let swatch = null;
    this.canvasPick = dp => {
      const x = Math.floor(dp.x), y = Math.floor(dp.y);
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
      const data = sampled(), i = (y * d.width + x) * 4;
      job.color = [data[i], data[i + 1], data[i + 2]];
      if (swatch) swatch.style.background = rgbToHex(...job.color);
      later();
    };
    preview();
    const ok = await modal({
      title: 'Color range',
      body: `<p class="small"><span class="range-swatch"></span> <span class="muted">Click the canvas to pick another colour.</span></p>
        <div class="filter-fields"><label class="slider"><span>Fuzziness</span><input type="range" name="fuzz" min="0" max="255" step="1" value="${job.fuzziness}"><output>${job.fuzziness}</output></label></div>
        <label class="field"><span>Look at</span><select name="sample"><option value="all">The visible picture</option><option value="layer">The current layer</option></select></label>
        <label class="field"><span>Selection</span><select name="mode">${SELECT_MODES.map(([v, l]) => `<option value="${v}">${esc(l.replace(/ \(.*\)$/, ''))}</option>`).join('')}</select></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: true, primary: true }],
      live: true,
      passClicks: true,
      onOpen: root => {
        swatch = root.querySelector('.range-swatch');
        swatch.style.background = rgbToHex(...job.color);
        const fuzz = root.querySelector('[name=fuzz]'), sample = root.querySelector('[name=sample]'), mode = root.querySelector('[name=mode]');
        sample.value = job.sample;
        mode.value = job.mode;
        fuzz.oninput = () => { job.fuzziness = +fuzz.value; fuzz.nextElementSibling.textContent = fuzz.value; later(); };
        sample.onchange = () => { job.sample = sample.value; job.data = null; later(); };
        mode.onchange = () => { job.mode = mode.value; later(); };
      },
    });
    cancelAnimationFrame(job.raf);
    this.colorRange = null;
    this.canvasPick = null;
    if (!ok) { this.sel.restore(before); this.drawOverlay(); return; }
    preview();
    store('colorRange', { fuzziness: job.fuzziness, sample: job.sample, mode: job.mode });
    const after = this.sel.snapshot();
    this.sel.restore(before);
    this.changeSelection('Color range', () => this.sel.restore(after));
    if (!this.sel.active) toast('No pixels are close enough to that colour. Try a higher fuzziness.');
  },

  // ---------- selection tools ----------

  beginSelect(toolId, dp, id, e) {
    const mode = modeFor(this.settings[toolId].mode, e.shiftKey, e.altKey);
    if (toolId === 'wand') return this.magicWand(dp, mode);
    if (toolId === 'polygon') return this.polygonClick(dp, mode, e.detail >= 2);
    this.gesture = { type: 'select', tool: toolId, id, mode, start: dp, cur: dp, points: [dp] };
  },

  selectDrag(dp) {
    const g = this.gesture;
    g.cur = dp;
    const last = g.points[g.points.length - 1];
    if (g.tool === 'lasso' && Math.hypot(dp.x - last.x, dp.y - last.y) * this.view.zoom >= 2) g.points.push(dp);
  },

  endSelect() {
    const g = this.gesture;
    if (g.tool === 'select' || g.tool === 'ellipse') {
      const r = rectBetween(g.start, g.cur);
      if (r.w < 1 || r.h < 1) return this.clickedWithoutShape(g.mode);
      if (g.tool === 'select') this.changeSelection('Rectangle selection', () => this.sel.combine(g.mode, ctx => ctx.fillRect(r.x, r.y, r.w, r.h), r));
      else this.changeSelection('Ellipse selection', () => this.sel.combine(g.mode, ctx => {
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }, r));
    } else {
      const pts = g.points;
      const b = maskBoundsOfPoints(pts);
      if (pts.length < 3 || b.w * this.view.zoom < 3 || b.h * this.view.zoom < 3) return this.clickedWithoutShape(g.mode);
      this.changeSelection('Lasso selection', () => this.sel.combine(g.mode, ctx => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
      }, pointsRect(pts)));
    }
  },

  /** A click with a selection tool (no real shape) clears the selection, as in other painting programs. */
  clickedWithoutShape(mode) {
    if (mode === 'replace') this.deselect();
  },

  // ---------- polygon selection ----------

  /**
   * The Polygon tool: each click adds a corner (this.poly holds them between clicks); a double click, Enter or a
   * click on the first corner closes the shape, Backspace removes the last corner and Esc drops the shape.
   */
  polygonClick(dp, mode, dbl) {
    const p = this.poly;
    if (!p) { this.poly = { mode, points: [dp] }; return; }
    const first = toScreen(this.view, p.points[0].x, p.points[0].y), here = toScreen(this.view, dp.x, dp.y);
    const onFirst = p.points.length >= 3 && Math.hypot(first.x - here.x, first.y - here.y) <= CLOSE_PX;
    if (dbl || onFirst) return this.closePolygon();
    p.points.push(dp);
  },

  closePolygon() {
    const p = this.poly;
    if (!p) return;
    this.poly = null;
    const pts = p.points, b = maskBoundsOfPoints(pts);
    if (pts.length < 3 || b.w * this.view.zoom < 3 || b.h * this.view.zoom < 3) return this.clickedWithoutShape(p.mode);
    this.changeSelection('Polygon selection', () => this.sel.combine(p.mode, ctx => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fill();
    }, pointsRect(pts)));
  },

  cancelPolygon() {
    if (!this.poly) return;
    this.poly = null;
    this.drawOverlay();
  },

  /** Keys while a polygon is being drawn; true when the key was used. */
  onPolygonKey(c) {
    if (!this.poly) return false;
    if (c === 'enter') this.closePolygon();
    else if (c === 'escape') this.cancelPolygon();
    else if (c === 'backspace' || c === 'delete') { this.poly.points.pop(); if (!this.poly.points.length) this.poly = null; }
    else return false;
    this.drawOverlay();
    return true;
  },

  magicWand(dp, mode) {
    const d = this.doc, s = this.settings.wand;
    const a = this.doc.active, t = this.maskEdit && a.mask ? a.mask : a;
    const res = floodMask(this.sampleData(s.sample, t), d.width, d.height, dp.x, dp.y, s.tolerance, s.contiguous);
    if (!res) return;
    this.changeSelection('Magic wand', () => this.sel.combineMask(mode, res.mask, res.bounds));
  },

  // ---------- copy, cut, paste ----------

  copySelection(cut = false) {
    const d = this.doc, l = this.target('copy from', { read: true });
    if (!l) return;
    const r = this.sel.active ? this.sel.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    const c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    const ctx = c.getContext('2d');
    ctx.drawImage(l.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (this.sel.active) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    this.clipboard = { canvas: c, x: r.x, y: r.y, fresh: true };
    // also offer it to other programs (best effort; the window may not allow it)
    c.toBlob(blob => {
      try { navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {}); } catch { /* not allowed */ }
    }, 'image/png');
    if (cut) this.clearLayer('Cut');
    else toast('Copied');
  },

  /** Edit → Stroke selection…: draws the main colour along the selection's edge (inside, centred or outside). */
  async strokeSelectionDialog() {
    if (!this.sel.active) return toast('Make a selection first: Stroke selection draws along its edge.');
    if (!this.target('draw on')) return;
    const last = store('strokeSel') || {}, w0 = Math.min(200, Math.max(1, Math.round(+last.w) || 4));
    const places = [['inside', 'Inside the edge'], ['center', 'Centred on the edge'], ['outside', 'Outside the edge']];
    const res = await modal({
      title: 'Stroke selection',
      body: `
        <label class="field"><span>Width (px)</span><input type="number" name="w" min="1" max="200" value="${w0}"></label>
        <label class="field"><span>Position</span><select name="where">${places.map(([k, label]) =>
          `<option value="${k}"${k === (last.where || 'inside') ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <p class="muted small">Draws the main colour along the edge of the selection on the current layer (on a mask: hides).</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Stroke', primary: true }],
      collect: root => ({ w: Math.min(200, Math.max(1, Math.round(+root.querySelector('[name="w"]').value) || 1)), where: root.querySelector('[name="where"]').value }),
    });
    if (!res) return;
    store('strokeSel', res);
    const t = this.target('draw on');
    if (!t) return;
    const d = this.doc, band = strokeBand(this.sel.alphaPlane(), d.width, d.height, res.w, res.where);
    const b = maskBounds(band, d.width, d.height);
    if (!b) return toast('The selection has no edge to stroke there.');
    const [cr, cg, cb] = hexToRgb(this.inkFor(t)), img = new ImageData(b.w, b.h);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const a = band[(b.y + y) * d.width + b.x + x];
        if (!a) continue;
        const i = (y * b.w + x) * 4;
        img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb; img.data[i + 3] = a;
      }
    }
    this.resetStroke();
    this.strokeCtx.putImageData(img, b.x, b.y);
    this.live = { layer: t, canvas: this.stroke, alpha: 1, mode: this.strokeMode(t, false) };
    this.commitStroke(t, b, 'Stroke selection');
    if (t.kind !== 'mask') this.colors.used();
  },

  /** Pastes what was copied in KoeStudio onto a new layer, at the spot it came from. */
  pasteInternal() {
    const clip = this.clipboard, d = this.doc;
    const layer = new Layer(d.width, d.height, { name: 'Pasted' });
    layer.ctx.drawImage(clip.canvas, clip.x, clip.y);
    this.insertNode(layer, 'Paste');
  },

  // ---------- free transform ----------

  /**
   * Starts transforming the selected pixels of the current layer (or all of its pixels when nothing is selected).
   * A layer with a mask takes its mask along (xf.linked), so the two stay lined up; painting on the mask itself
   * transforms only the mask. moveOnly: started by the Move tool, applied as soon as the drag ends.
   */
  beginTransform({ moveOnly = false } = {}) {
    if (this.xf) return true;
    this.finishText();
    const d = this.doc, layer = this.target('transform', { text: true, vector: true });
    if (!layer) return false;
    if (layer.text) return this.beginTextTransform(layer, moveOnly);
    if (layer.vector) return this.beginVectorTransform(layer, moveOnly);
    const companion = !this.quickMask && !this.maskEdit && layer.kind === 'layer' && layer.mask ? layer.mask : null;
    const whole = { x: 0, y: 0, w: d.width, h: d.height };
    let r = this.sel.active ? this.sel.bounds : null, full = null, mfull = null;
    if (!r) {  // everything painted on the layer (and its mask): the one readback a transform needs
      full = layer.ctx.getImageData(0, 0, d.width, d.height);
      mfull = companion ? companion.ctx.getImageData(0, 0, d.width, d.height) : null;
      const bounds = img => {
        const alpha = new Uint8Array(d.width * d.height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
        return maskBounds(alpha, d.width, d.height);
      };
      const a = bounds(full), b = mfull ? bounds(mfull) : null;
      r = a && b ? union(a, b) : a || b;
    }
    if (!r) { toast('There is nothing on this layer to transform.'); return false; }
    // the pixels in the box (inside the selection, if any) are lifted; the rest stays behind in `base`
    const lift = raster => {
      const src = canvasOf(r.w, r.h), sctx = src.getContext('2d');
      sctx.drawImage(raster.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const base = canvasOf(d.width, d.height), bctx = base.getContext('2d');
      if (this.sel.active) {
        sctx.globalCompositeOperation = 'destination-in';
        sctx.drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        bctx.drawImage(raster.canvas, 0, 0);
        bctx.globalCompositeOperation = 'destination-out';
        bctx.drawImage(this.sel.canvas, 0, 0);
      }
      return { src, base };
    };
    const { src, base } = lift(layer);
    let mask = null;
    if (this.sel.active) {
      mask = canvasOf(r.w, r.h);
      mask.getContext('2d').drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    // how it was, for undo and Esc: with a selection a GPU copy, so starting a transform does not wait for the GPU
    const linked = companion ? { raster: companion, before: mfull || this.snapshot(companion, whole), ...lift(companion) } : null;
    this.xf = { layer, src, mask, base, linked, before: full || this.snapshot(layer, whole), selBefore: this.sel.snapshot(), r, t: newTransform(r),
      keepAspect: false, smooth: true, moveOnly };
    if (!moveOnly) this.showTransformBar();
    this.renderTransform();
    return true;
  },

  /**
   * Transform on a text layer: the whole text, in its own frame (the box is its layout bounds, turned and scaled
   * as its matrix says), shown as pixels while dragging; applying stores a new matrix (textlayer.js), so the text
   * stays editable and is redrawn sharp. The selection and the layer's mask are left as they are.
   */
  beginTextTransform(layer, moveOnly) {
    const d = this.doc, t = layer.text, b = textBounds({ ...t, content: t.content || ' ' }, layer.ctx);
    if (!t.content.trim() || b.w < 1 || b.h < 1) { toast('There is no text on this layer to transform.'); return false; }
    const src = canvasOf(Math.ceil(b.w), Math.ceil(b.h)), sctx = src.getContext('2d');
    sctx.translate(-b.x, -b.y);
    drawText(sctx, t);
    const base = canvasOf(d.width, d.height);
    this.xf = { layer, src, mask: null, base, linked: null, before: this.snapshot(layer, { x: 0, y: 0, w: d.width, h: d.height }), selBefore: this.sel.snapshot(),
      r: { x: b.x, y: b.y, w: src.width, h: src.height }, t: textTransformStart(t, { ...b, w: src.width, h: src.height }),
      keepAspect: false, smooth: true, moveOnly, text: { before: t, b: { ...b, w: src.width, h: src.height } } };
    this.xf.text.t0 = { ...this.xf.t };
    if (!moveOnly) this.showTransformBar();
    this.renderTransform();
    return true;
  },

  renderTransform() {
    const x = this.xf, d = this.doc;
    const draw = (ctx, base, src, srcData) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, d.width, d.height);
      ctx.drawImage(base, 0, 0);
      if (x.mesh) this.drawMeshed(ctx, srcData, src.width, src.height, x.mesh, x.smooth);
      else if (x.quad) this.drawWarped(ctx, srcData, src.width, src.height, x.quad, x.smooth);
      else {
        ctx.setTransform(...xfMatrix(x.t));
        ctx.imageSmoothingEnabled = x.smooth;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0);
      }
      ctx.restore();
    };
    draw(x.layer.ctx, x.base, x.src, x.srcData);
    if (x.linked) draw(x.linked.raster.ctx, x.linked.base, x.linked.src, x.linked.srcData);
    // recomposite only where the lifted pixels were, are now, and were last time (a mesh can bulge: all of it)
    const pts = x.mesh ? null : x.quad || corners(x.t);
    let box = null;
    if (pts) {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.floor(Math.min(...xs)) - 2, y0 = Math.floor(Math.min(...ys)) - 2;
      box = union({ x: x0, y: y0, w: Math.ceil(Math.max(...xs)) + 2 - x0, h: Math.ceil(Math.max(...ys)) + 2 - y0 }, x.r);
    }
    this.updateComp(box ? union(box, x.lastBox || box) : null);
    x.lastBox = box;
    this.requestRender();
    this.drawOverlay();
    this.updateTransformBar();
  },

  applyTransform() {
    const x = this.xf;
    if (!x) return;
    if (x.raf) { cancelAnimationFrame(x.raf); x.raf = 0; this.renderTransform(); }  // a distort drag still waiting to be drawn
    this.xf = null;
    this.hideTransformBar();
    if (x.text) return this.applyTextTransform(x);
    const start = corners(newTransform(x.r));
    const same = (a, b) => a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
    if (x.mesh ? same(x.mesh.pts, x.mesh.start) : x.quad ? same(x.quad, start) : isIdentity(x.t, x.r)) return this.cancelTransformState(x);
    if (x.vector) return this.applyVectorTransform(x);
    const d = this.doc, layer = x.layer, linked = x.linked, whole = { x: 0, y: 0, w: d.width, h: d.height };
    const after = this.snapshot(layer, whole);
    const linkedAfter = linked ? this.snapshot(linked.raster, whole) : null;
    this.transformSelection(x);
    const selAfter = this.sel.snapshot();
    const put = (img, sel, mimg) => {
      this.putSnapshot(layer, whole, img);
      if (linked) this.putSnapshot(linked.raster, whole, mimg);
      this.sel.restore(sel);
      this.changed(null);
    };
    this.history.push({ label: x.moveOnly ? 'Move' : 'Transform', bytes: d.width * d.height * (linked ? 24 : 16),
      undo: () => put(x.before, x.selBefore, linked?.before), redo: () => put(after, selAfter, linkedAfter) });
    layer.touch();
    linked?.raster.touch();
    this.changed(null);
    this.drawOverlay();
  },

  /** After a transform: the selection follows what was lifted (when there was one). */
  transformSelection(x) {
    if (!x.mask) return;
    const d = this.doc, c = this.sel.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, d.width, d.height);
    if (x.mesh) this.drawMeshed(c, x.maskData, x.mask.width, x.mask.height, x.mesh, true);
    else if (x.quad) this.drawWarped(c, x.maskData, x.mask.width, x.mask.height, x.quad, true);
    else {
      c.setTransform(...xfMatrix(x.t));
      c.drawImage(x.mask, 0, 0);
    }
    c.restore();
    this.sel.refresh(x.mesh ? null : x.lastBox);  // the box renderTransform last drew (a mesh can bulge out of it)
  },

  /**
   * Transform on a vector layer: the lines the selection takes (vector.js strokesInside), or all of them, are
   * lifted as pixels for the preview and, on apply, their points are moved (affine, or Distort's homography), so
   * they stay lines. Mesh needs pixels.
   */
  beginVectorTransform(layer, moveOnly) {
    const d = this.doc, v = layer.vector;
    let idxs = v.strokes.map((_, i) => i);
    if (this.sel.active) {
      idxs = strokesInside(v, this.sel.insideTest());
    }
    if (!idxs.length) { toast(this.sel.active ? 'No line is inside the selection (at least half of a line must be).' : 'There are no lines on this layer yet.'); return false; }
    const pick = new Set(idxs), sub = { brushes: v.brushes, strokes: v.strokes.filter((_, i) => pick.has(i)) };
    const scratch = vec => {
      const c = canvasOf(d.width, d.height), l = { vector: vec, canvas: c, ctx: c.getContext('2d'), touch() {} };
      renderVector(l);
      return c;
    };
    const lifted = scratch(sub), base = scratch(removeStrokes(v, idxs));
    let r = null;
    for (const s of sub.strokes) r = union(r, strokeBounds(s, brushOf(sub, s)));
    r = r && clip(r, d.width, d.height);
    if (!r || r.w < 1 || r.h < 1) { toast('The selected lines are outside the canvas.'); return false; }
    const src = canvasOf(r.w, r.h);
    src.getContext('2d').drawImage(lifted, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    let mask = null;
    if (this.sel.active) {
      mask = canvasOf(r.w, r.h);
      mask.getContext('2d').drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    this.xf = { layer, src, mask, base, linked: null, before: this.snapshot(layer, { x: 0, y: 0, w: d.width, h: d.height }), selBefore: this.sel.snapshot(), r,
      t: newTransform(r), keepAspect: false, smooth: true, moveOnly, vector: { before: v, idxs } };
    if (!moveOnly) this.showTransformBar();
    this.renderTransform();
    return true;
  },

  applyVectorTransform(x) {
    const layer = x.layer, before = x.vector.before, r = x.r;
    let after;
    if (x.quad) {  // Distort: each point through the homography of the box onto the four corners
      const H = homography(r.w, r.h, x.quad);
      if (!H) return this.cancelTransformState(x);
      after = mapStrokes(before, x.vector.idxs, (px, py) => { const p = project(H, px - r.x, py - r.y); return [p.x, p.y]; });
    } else {
      const [a, b, c, dd, e, f] = xfMatrix(x.t);
      after = mapStrokes(before, x.vector.idxs, null, [a, b, c, dd, e - a * r.x - c * r.y, f - b * r.x - dd * r.y]);
    }
    this.transformSelection(x);
    const selBefore = x.selBefore, selAfter = this.sel.snapshot();
    layer.vector = after;
    renderVector(layer);
    this.changed(null);
    const points = vv => vv.strokes.reduce((n, s) => n + s.pts.length, 0);
    const show = (vec, sel) => { layer.vector = vec; renderVector(layer); this.sel.restore(sel); this.changed(null); };
    this.history.push({ label: x.moveOnly ? 'Move lines' : 'Transform lines', bytes: (points(before) + points(after)) * 24 + 1024,
      undo: () => show(before, selBefore), redo: () => show(after, selAfter) });
    this.drawOverlay();
  },

  applyTextTransform(x) {
    const layer = x.layer, before = x.text.before, s = x.text.t0;
    if (['cx', 'cy', 'sx', 'sy', 'rot'].every(k => Math.abs(x.t[k] - s[k]) < 1e-9)) return this.cancelTransformState(x);
    const m = textMatrixAfter(xfMatrix(x.t), x.text.b), after = { ...before };
    if (m) after.m = m; else delete after.m;
    const set = t => { layer.text = t; renderTextLayer(layer); this.changed(null); };
    this.structural(x.moveOnly ? 'Move' : 'Transform text', () => set(after), () => set(before));
    this.drawOverlay();
  },

  cancelTransform() {
    const x = this.xf;
    if (!x) return;
    cancelAnimationFrame(x.raf);
    this.xf = null;
    this.hideTransformBar();
    this.cancelTransformState(x);
  },

  cancelTransformState(x) {
    const d = this.doc, whole = { x: 0, y: 0, w: d.width, h: d.height };
    this.putSnapshot(x.layer, whole, x.before);
    if (x.linked) this.putSnapshot(x.linked.raster, whole, x.linked.before);
    this.updateComp(null);
    this.requestRender();
    this.drawOverlay();
  },

  /** Pointer down while transforming: grab a handle, the inside (move) or the outside (rotate). */
  xfPointerDown(dp, id, ctrl = false) {
    const x = this.xf, tol = HANDLE_PX / this.view.zoom;
    // Ctrl+drag on a corner handle switches to Distort, as in Photoshop
    if (!x.quad && !x.mesh && ctrl && ['nw', 'ne', 'se', 'sw'].includes(hitTest(x.t, dp, tol))) this.startDistort();
    if (x.mesh) {
      const grab = meshHit(x.mesh.pts, x.mesh.n, dp, tol);
      this.gesture = { type: 'xf', tool: 'xf', id, grab: grab ?? 'none', m0: x.mesh.pts.map(p => ({ ...p })), p0: dp };
      return;
    }
    if (x.quad) {
      const grab = quadHit(x.quad, dp, tol);
      this.gesture = { type: 'xf', tool: 'xf', id, grab: grab ?? 'none', q0: x.quad.map(p => ({ ...p })), p0: dp };
      return;
    }
    const grab = hitTest(x.t, dp, tol);
    this.gesture = { type: 'xf', tool: 'xf', id, grab, t0: { ...x.t }, p0: dp };
  },

  /** Distort: each corner of the box drags on its own (the transform bar's Distort, or Ctrl+drag a corner). It
   *  stays that way until the transform is applied or cancelled. */
  startDistort() {
    const x = this.xf;
    if (!x || x.quad || x.mesh || x.moveOnly) return;
    if (x.text) return toast('Distort bends pixels: rasterize the text first (Layer → Rasterize text) to distort it.');
    x.quad = corners(x.t);
    this.readTransformSource(x);
    this.viewport.querySelector('.xf-bar')?.classList.add('distort');
    this.renderTransform();
  },

  /** The lifted pixels (and selection) as data, for Distort and Mesh, which draw them pixel by pixel. */
  readTransformSource(x) {
    x.srcData ||= x.src.getContext('2d').getImageData(0, 0, x.src.width, x.src.height).data;
    x.maskData ||= x.mask ? x.mask.getContext('2d').getImageData(0, 0, x.mask.width, x.mask.height).data : null;
    if (x.linked) x.linked.srcData ||= x.linked.src.getContext('2d').getImageData(0, 0, x.linked.src.width, x.linked.src.height).data;
  },

  /**
   * Mesh: a 4 x 4 grid of points over the box (or the Distort corners); dragging a point bends the picture softly
   * around it, dragging inside moves it all. It stays that way until the transform is applied or cancelled.
   */
  startMesh() {
    const x = this.xf;
    if (!x || x.mesh || x.moveOnly) return;
    if (x.vector) return toast('Mesh works on pixels: rasterize the vector layer first (Layer → Rasterize vector layer) to bend it, or use Distort.');
    if (x.text) return toast('Mesh bends pixels: rasterize the text first (Layer → Rasterize text) to bend it.');
    const pts = meshFromQuad(x.quad || corners(x.t), MESH_N);
    x.mesh = { n: MESH_N, pts, start: pts.map(p => ({ ...p })) };
    x.quad = null;
    this.readTransformSource(x);
    const bar = this.viewport.querySelector('.xf-bar');
    bar?.classList.remove('distort');
    bar?.classList.add('mesh');
    this.renderTransform();
  },

  /** Draws RGBA data (sw x sh) bent onto a mesh into ctx (identity transform), clipped to the doc. */
  drawMeshed(ctx, data, sw, sh, mesh, smooth) {
    const d = this.doc, m = mesh.n * MESH_SUB, fine = meshSurface(mesh.pts, mesh.n, MESH_SUB);
    const b = pointsBounds(fine), r = clip({ x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, d.width, d.height);
    if (!r) return;
    const img = new ImageData(r.w, r.h);
    meshWarp(data, sw, sh, fine, m, img.data, r.x, r.y, r.w, r.h, smooth);
    const c = this.warpCanvas || (this.warpCanvas = document.createElement('canvas'));
    if (c.width < r.w || c.height < r.h) { c.width = Math.max(c.width, r.w); c.height = Math.max(c.height, r.h); }
    c.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  },

  /** In Mesh mode the bend is redrawn at most once per frame. */
  setMesh(pts) {
    const x = this.xf;
    x.mesh = { ...x.mesh, pts };
    this.drawOverlay();
    if (!x.raf) x.raf = requestAnimationFrame(() => { x.raf = 0; if (this.xf === x) this.renderTransform(); });
  },

  /** Draws RGBA data (sw x sh) warped onto quad into ctx (identity transform), clipped to the doc. */
  drawWarped(ctx, data, sw, sh, quad, smooth) {
    const d = this.doc, r = clip(quadBounds(quad), d.width, d.height);
    if (!r) return;
    const img = new ImageData(r.w, r.h);
    warpImage(data, sw, sh, quad, img.data, r.x, r.y, r.w, r.h, smooth);
    const c = this.warpCanvas || (this.warpCanvas = document.createElement('canvas'));
    if (c.width < r.w || c.height < r.h) { c.width = Math.max(c.width, r.w); c.height = Math.max(c.height, r.h); }
    c.getContext('2d').putImageData(img, 0, 0);
    ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  },

  /** In Distort mode the warp is redrawn at most once per frame, however fast the pointer moves. */
  setQuad(quad) {
    const x = this.xf;
    x.quad = quad;
    this.drawOverlay();
    this.updateTransformBar();
    if (!x.raf) x.raf = requestAnimationFrame(() => { x.raf = 0; if (this.xf === x) this.renderTransform(); });
  },

  xfDrag(dp, shift) {
    const g = this.gesture, x = this.xf;
    if (x.mesh) {
      if (typeof g.grab === 'number') this.setMesh(g.m0.map((p, i) => (i === g.grab ? { x: dp.x, y: dp.y } : p)));
      else if (g.grab === 'move') this.setMesh(g.m0.map(p => ({ x: p.x + dp.x - g.p0.x, y: p.y + dp.y - g.p0.y })));
      return;
    }
    if (x.quad) {
      if (typeof g.grab === 'number') this.setQuad(g.q0.map((p, i) => (i === g.grab ? { x: dp.x, y: dp.y } : p)));
      else if (g.grab === 'move') this.setQuad(g.q0.map(p => ({ x: p.x + dp.x - g.p0.x, y: p.y + dp.y - g.p0.y })));
      return;
    }
    if (g.grab === 'move') x.t = dragMove(g.t0, g.p0, dp);
    else if (g.grab === 'rotate') x.t = dragRotate(g.t0, g.p0, dp, shift);
    else x.t = dragHandle(g.t0, g.grab, dp, x.keepAspect !== shift);
    this.renderTransform();
  },

  xfEnd() {
    if (this.xf?.moveOnly) this.applyTransform();
  },

  /** Arrow keys while transforming: nudge by a pixel (10 with Shift). */
  xfNudge(dx, dy) {
    if (this.xf.mesh) return this.setMesh(this.xf.mesh.pts.map(p => ({ x: p.x + dx, y: p.y + dy })));
    if (this.xf.quad) return this.setQuad(this.xf.quad.map(p => ({ x: p.x + dx, y: p.y + dy })));
    const t = this.xf.t;
    this.xf.t = { ...t, cx: t.cx + dx, cy: t.cy + dy };
    this.renderTransform();
  },

  xfSet(change) {
    this.xf.t = { ...this.xf.t, ...change(this.xf.t) };
    this.renderTransform();
  },

  /** Cursor for the transform handle or area under the pointer. */
  xfCursor(dp) {
    if (this.xf.mesh) {
      const g = meshHit(this.xf.mesh.pts, this.xf.mesh.n, dp, HANDLE_PX / this.view.zoom);
      return g === 'move' ? 'move' : g === null ? 'default' : 'crosshair';
    }
    if (this.xf.quad) {
      const g = quadHit(this.xf.quad, dp, HANDLE_PX / this.view.zoom);
      return g === 'move' ? 'move' : g === null ? 'default' : 'crosshair';
    }
    return this.handleCursor(this.xf.t, dp);
  },

  /** Cursor over a box with handles (transform or crop): resize arrows, move inside, crosshair outside. */
  handleCursor(t, dp) {
    const grab = hitTest(t, dp, HANDLE_PX / this.view.zoom);
    if (grab === 'move') return 'move';
    if (grab === 'rotate') return 'crosshair';
    // pick the resize arrow from the handle's direction on screen
    const [hx, hy] = HANDLES[grab];
    const a = toScreen(this.view, t.cx, t.cy), q = boxPoint(t, hx, hy), b = toScreen(this.view, q.x, q.y);
    const deg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + 360) % 180;
    return deg < 22.5 || deg >= 157.5 ? 'ew-resize' : deg < 67.5 ? 'nwse-resize' : deg < 112.5 ? 'ns-resize' : 'nesw-resize';
  },

  showTransformBar() {
    const bar = document.createElement('div');
    bar.className = 'xf-bar';
    bar.innerHTML = `
      <span class="xf-readout muted small"></span>
      <button class="icon-btn" data-xf="flipH" title="Flip horizontally">${icon('flip', 16)}</button>
      <button class="icon-btn" data-xf="flipV" title="Flip vertically"><span style="transform:rotate(90deg);display:block">${icon('flip', 16)}</span></button>
      <button class="icon-btn" data-xf="rotL" title="Rotate 90° left">${icon('rotL', 16)}</button>
      <button class="icon-btn" data-xf="rotR" title="Rotate 90° right">${icon('rotR', 16)}</button>
      <button data-xf="distort" title="Drag each corner on its own, for perspective (or Ctrl+drag a corner)">Distort</button>
      <button data-xf="mesh" title="A grid of points: drag one to bend the picture softly around it">Mesh</button>
      <label class="check xf-aspect" title="Corners keep the proportions (hold Shift to switch while dragging)"><input type="checkbox" data-xf="aspect"> Keep aspect</label>
      <label class="check" title="Smooth (on) or hard pixel (off) resampling"><input type="checkbox" data-xf="smooth" checked> Smooth</label>
      <button data-xf="cancel" title="Cancel (Esc)">Cancel</button>
      <button class="primary" data-xf="ok" title="Apply (Enter)">OK</button>`;
    // in Distort mode flips and quarter turns move the four corners round their middle
    const quadOp = fn => {
      const q = this.xf.quad, cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
      this.setQuad(q.map(p => fn(p.x - cx, p.y - cy, cx, cy)));
    };
    // in Mesh mode they move every point round the middle of the mesh
    const meshOp = fn => {
      const q = this.xf.mesh.pts, cx = q.reduce((s, p) => s + p.x, 0) / q.length, cy = q.reduce((s, p) => s + p.y, 0) / q.length;
      this.setMesh(q.map(p => fn(p.x - cx, p.y - cy, cx, cy)));
    };
    const either = (affine, quad) => () => (this.xf.mesh ? meshOp(quad) : this.xf.quad ? quadOp(quad) : this.xfSet(affine));
    const acts = {
      flipH: either(t => ({ sx: -t.sx }), (dx, dy, cx, cy) => ({ x: cx - dx, y: cy + dy })),
      flipV: either(t => ({ sy: -t.sy }), (dx, dy, cx, cy) => ({ x: cx + dx, y: cy - dy })),
      rotL: either(t => ({ rot: t.rot - Math.PI / 2 }), (dx, dy, cx, cy) => ({ x: cx + dy, y: cy - dx })),
      rotR: either(t => ({ rot: t.rot + Math.PI / 2 }), (dx, dy, cx, cy) => ({ x: cx - dy, y: cy + dx })),
      distort: () => this.startDistort(),
      mesh: () => this.startMesh(),
      cancel: () => this.cancelTransform(),
      ok: () => this.applyTransform(),
    };
    bar.querySelectorAll('button[data-xf]').forEach(b => { b.onclick = () => acts[b.dataset.xf](); });
    bar.querySelector('[data-xf="aspect"]').onchange = e => { this.xf.keepAspect = e.target.checked; };
    bar.querySelector('[data-xf="smooth"]').onchange = e => { this.xf.smooth = e.target.checked; this.renderTransform(); };
    this.viewport.append(bar);
  },

  updateTransformBar() {
    const el = this.viewport.querySelector('.xf-readout');
    if (!el || !this.xf) return;
    if (this.xf.mesh) { el.textContent = 'Mesh: drag the points'; return; }
    if (this.xf.quad) { el.textContent = 'Distort: drag the corners'; return; }
    const t = this.xf.t;
    const deg = Math.round(((t.rot * 180 / Math.PI) % 360 + 540) % 360 - 180);
    el.textContent = `W ${Math.round(Math.abs(t.sx) * 100)}%  H ${Math.round(Math.abs(t.sy) * 100)}%  ${deg}°`;
  },

  hideTransformBar() {
    this.viewport.querySelector('.xf-bar')?.remove();
  },

  // ---------- overlay ----------

  /** Marching ants, the shape being dragged and the transform box, on the overlay canvas. */
  drawSelectionOverlay(ctx) {
    const dpr = this.dpr || 1;
    const [a, b, c, d, e, f] = matrix(this.view);
    const sx = (x, y) => (a * x + c * y + e) * dpr, sy = (x, y) => (b * x + d * y + f) * dpr;
    ctx.lineWidth = 1;
    const ants = path => {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#000';
      path(); ctx.stroke();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.lineDashOffset = -(this.antsPhase || 0) * dpr;
      ctx.strokeStyle = '#fff';
      path(); ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.sel.active && !this.xf) {
      // a selection can have 100,000+ edge segments: stroke them only when the selection, the view or the ants'
      // phase changes, and copy that image on the many overlay redraws in between (every pointer move)
      const W = ctx.canvas.width, H = ctx.canvas.height, v = this.view;
      const key = [this.sel.version, v.zoom, v.panX, v.panY, v.rot, v.flip, W, H, dpr, this.antsPhase || 0].join();
      let c = this.antsCache;
      if (!c || c.key !== key) {
        c = this.antsCache ||= { canvas: document.createElement('canvas') };
        c.key = key;
        if (c.canvas.width !== W || c.canvas.height !== H) { c.canvas.width = W; c.canvas.height = H; }
        const cc = c.canvas.getContext('2d');
        cc.clearRect(0, 0, W, H);
        cc.lineWidth = 1;
        const path = new Path2D();
        for (const [x1, y1, x2, y2] of this.sel.segments) {
          path.moveTo(sx(x1, y1), sy(x1, y1));
          path.lineTo(sx(x2, y2), sy(x2, y2));
        }
        cc.strokeStyle = '#000';
        cc.stroke(path);
        cc.setLineDash([4 * dpr, 4 * dpr]);
        cc.lineDashOffset = -(this.antsPhase || 0) * dpr;
        cc.strokeStyle = '#fff';
        cc.stroke(path);
      }
      ctx.drawImage(c.canvas, 0, 0);
    }
    const g = this.gesture;
    const outline = pts => ants(() => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x, y), sy(x, y)) : ctx.moveTo(sx(x, y), sy(x, y))));
      ctx.closePath();
    });
    if (g?.type === 'select') {
      const r = rectBetween(g.start, g.cur);
      outline(g.tool === 'select' ? [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
        : g.tool === 'ellipse' ? ellipsePoints(r) : [...g.points, g.cur].map(p => [p.x, p.y]));
    }
    if (this.poly) {
      const pts = this.poly.points.map(p => [p.x, p.y]);
      if (this.pointer && !this.gesture) { const q = toDoc(this.view, this.pointer.x, this.pointer.y); pts.push([q.x, q.y]); }
      outline(pts);
      const f = this.poly.points[0];
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(sx(f.x, f.y), sy(f.x, f.y), 3 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (this.xf?.mesh) {  // the grid lines as the surface runs, and a handle on every point
      const { n, pts } = this.xf.mesh, m = n * 4, fine = meshSurface(pts, n, 4), F = (i, j) => fine[j * (m + 1) + i];
      for (const [color, w] of [['rgba(0,0,0,.6)', 3 * dpr], ['#6ea8ff', 1.2 * dpr]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let k = 0; k <= n; k++) {
          for (let s = 0; s <= m; s++) { const p = F(s, k * 4); s ? ctx.lineTo(sx(p.x, p.y), sy(p.x, p.y)) : ctx.moveTo(sx(p.x, p.y), sy(p.x, p.y)); }
          for (let s = 0; s <= m; s++) { const p = F(k * 4, s); s ? ctx.lineTo(sx(p.x, p.y), sy(p.x, p.y)) : ctx.moveTo(sx(p.x, p.y), sy(p.x, p.y)); }
        }
        ctx.stroke();
      }
      const h = HANDLE_PX * dpr * 0.7;
      for (const p of pts) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3d6fd1'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.arc(sx(p.x, p.y), sy(p.x, p.y), h / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      return;
    }
    if (this.xf && !this.xf.moveOnly) {
      const t = this.xf.t, quad = this.xf.quad;
      const cs = quad || corners(t);
      ctx.lineWidth = 1.5 * dpr;
      for (const [color, w] of [['rgba(0,0,0,.6)', 3 * dpr], ['#6ea8ff', 1.5 * dpr]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        cs.forEach((p, i) => (i ? ctx.lineTo(sx(p.x, p.y), sy(p.x, p.y)) : ctx.moveTo(sx(p.x, p.y), sy(p.x, p.y))));
        ctx.closePath();
        ctx.stroke();
      }
      if (quad) {  // four corner handles, nothing else
        const h = HANDLE_PX * dpr * 0.8;
        for (const p of quad) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = '#3d6fd1'; ctx.lineWidth = 1.5 * dpr;
          ctx.fillRect(sx(p.x, p.y) - h / 2, sy(p.x, p.y) - h / 2, h, h);
          ctx.strokeRect(sx(p.x, p.y) - h / 2, sy(p.x, p.y) - h / 2, h, h);
        }
        return;
      }
      this.drawHandles(ctx, t);
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath();
      ctx.arc(sx(t.cx, t.cy), sy(t.cx, t.cy), 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/** The eight square handles of a box (transform or crop), on the overlay canvas. */
selectionMethods.drawHandles = function (ctx, t) {
  const dpr = this.dpr || 1, h = HANDLE_PX * dpr * 0.8;
  for (const [hx, hy] of Object.values(HANDLES)) {
    const q = boxPoint(t, hx, hy), s = toScreen(this.view, q.x, q.y);
    const X = s.x * dpr, Y = s.y * dpr;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#3d6fd1';
    ctx.lineWidth = 1.5 * dpr;
    ctx.fillRect(X - h / 2, Y - h / 2, h, h);
    ctx.strokeRect(X - h / 2, Y - h / 2, h, h);
  }
};

export { HANDLE_PX };

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Points around an ellipse inscribed in r (doc coordinates), for drawing it through the view's transform. */
function ellipsePoints(r, n = 72) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r.w / 2, cy + Math.sin(a) * r.h / 2]); }
  return out;
}

/** The rect round some points, for Selection.combine's area. */
function pointsRect(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function maskBoundsOfPoints(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
