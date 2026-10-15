// Selection tools (rectangle, ellipse, lasso, polygon, magic wand), selection commands, copy/cut/paste and free transform.
// These are Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { floodMask } from '../fill.js';
import { Layer } from '../doc.js';
import { icon } from '../icons.js';
import { maskBounds, modeFor, rectBetween } from '../selection.js';
import { newTransform, xfMatrix, boxPoint, corners, hitTest, dragHandle, dragRotate, dragMove, isIdentity, HANDLES } from '../transform.js';
import { esc, modal, toast } from '../ui.js';
import { matrix, toDoc, toScreen } from '../view.js';

const HANDLE_PX = 9;  // grab distance and drawn size of transform handles, in screen pixels
const CLOSE_PX = 8;   // clicking this close (screen px) to a polygon's first point closes it

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
    this.history.push({ label, bytes: this.doc.width * this.doc.height * 8, undo: () => restore(before), redo: () => restore(after) });
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
      if (g.tool === 'select') this.changeSelection('Rectangle selection', () => this.sel.combine(g.mode, ctx => ctx.fillRect(r.x, r.y, r.w, r.h)));
      else this.changeSelection('Ellipse selection', () => this.sel.combine(g.mode, ctx => {
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }));
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
      }));
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
    }));
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
    const src = s.sampleAll || !t.ctx ? this.compCtx : t.ctx;
    const res = floodMask(src.getImageData(0, 0, d.width, d.height).data, d.width, d.height, dp.x, dp.y, s.tolerance, s.contiguous);
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
   * moveOnly: started by the Move tool, applied as soon as the drag ends.
   */
  beginTransform({ moveOnly = false } = {}) {
    if (this.xf) return true;
    const d = this.doc, layer = this.target('transform');
    if (!layer) return false;
    const full = layer.ctx.getImageData(0, 0, d.width, d.height);
    let r = this.sel.active ? this.sel.bounds : null;
    if (!r) {
      const alpha = new Uint8Array(d.width * d.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = full.data[i * 4 + 3];
      r = maskBounds(alpha, d.width, d.height);
    }
    if (!r) { toast('There is nothing on this layer to transform.'); return false; }
    const src = canvasOf(r.w, r.h);
    const sctx = src.getContext('2d');
    sctx.drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    let mask = null;
    const base = canvasOf(d.width, d.height);
    const bctx = base.getContext('2d');
    if (this.sel.active) {
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      mask = canvasOf(r.w, r.h);
      mask.getContext('2d').drawImage(this.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      bctx.drawImage(layer.canvas, 0, 0);
      bctx.globalCompositeOperation = 'destination-out';
      bctx.drawImage(this.sel.canvas, 0, 0);
    }
    this.xf = { layer, src, mask, base, before: full, selBefore: this.sel.snapshot(), r, t: newTransform(r),
      keepAspect: false, smooth: true, moveOnly };
    if (!moveOnly) this.showTransformBar();
    this.renderTransform();
    return true;
  },

  renderTransform() {
    const x = this.xf, d = this.doc, ctx = x.layer.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.drawImage(x.base, 0, 0);
    ctx.setTransform(...xfMatrix(x.t));
    ctx.imageSmoothingEnabled = x.smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(x.src, 0, 0);
    ctx.restore();
    this.updateComp(null);
    this.requestRender();
    this.drawOverlay();
    this.updateTransformBar();
  },

  applyTransform() {
    const x = this.xf;
    if (!x) return;
    this.xf = null;
    this.hideTransformBar();
    if (isIdentity(x.t, x.r)) return this.cancelTransformState(x);
    const d = this.doc, layer = x.layer;
    const after = layer.ctx.getImageData(0, 0, d.width, d.height);
    if (x.mask) {  // the selection follows the pixels
      const c = this.sel.ctx;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, d.width, d.height);
      c.setTransform(...xfMatrix(x.t));
      c.drawImage(x.mask, 0, 0);
      c.restore();
      this.sel.refresh();
    }
    const selAfter = this.sel.snapshot();
    const put = (img, sel) => { layer.ctx.putImageData(img, 0, 0); layer.touch(); this.sel.restore(sel); this.changed(null); };
    this.history.push({ label: x.moveOnly ? 'Move' : 'Transform', bytes: d.width * d.height * 16,
      undo: () => put(x.before, x.selBefore), redo: () => put(after, selAfter) });
    layer.touch();
    this.changed(null);
    this.drawOverlay();
  },

  cancelTransform() {
    const x = this.xf;
    if (!x) return;
    this.xf = null;
    this.hideTransformBar();
    this.cancelTransformState(x);
  },

  cancelTransformState(x) {
    x.layer.ctx.putImageData(x.before, 0, 0);
    this.updateComp(null);
    this.requestRender();
    this.drawOverlay();
  },

  /** Pointer down while transforming: grab a handle, the inside (move) or the outside (rotate). */
  xfPointerDown(dp, id) {
    const grab = hitTest(this.xf.t, dp, HANDLE_PX / this.view.zoom);
    this.gesture = { type: 'xf', tool: 'xf', id, grab, t0: { ...this.xf.t }, p0: dp };
  },

  xfDrag(dp, shift) {
    const g = this.gesture, x = this.xf;
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
      <label class="check" title="Corners keep the proportions (hold Shift to switch while dragging)"><input type="checkbox" data-xf="aspect"> Keep aspect</label>
      <label class="check" title="Smooth (on) or hard pixel (off) resampling"><input type="checkbox" data-xf="smooth" checked> Smooth</label>
      <button data-xf="cancel" title="Cancel (Esc)">Cancel</button>
      <button class="primary" data-xf="ok" title="Apply (Enter)">OK</button>`;
    const acts = {
      flipH: () => this.xfSet(t => ({ sx: -t.sx })),
      flipV: () => this.xfSet(t => ({ sy: -t.sy })),
      rotL: () => this.xfSet(t => ({ rot: t.rot - Math.PI / 2 })),
      rotR: () => this.xfSet(t => ({ rot: t.rot + Math.PI / 2 })),
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
      ants(() => {
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of this.sel.segments) {
          ctx.moveTo(sx(x1, y1), sy(x1, y1));
          ctx.lineTo(sx(x2, y2), sy(x2, y2));
        }
      });
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
    if (this.xf && !this.xf.moveOnly) {
      const t = this.xf.t;
      const cs = corners(t);
      ctx.lineWidth = 1.5 * dpr;
      for (const [color, w] of [['rgba(0,0,0,.6)', 3 * dpr], ['#6ea8ff', 1.5 * dpr]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        cs.forEach((p, i) => (i ? ctx.lineTo(sx(p.x, p.y), sy(p.x, p.y)) : ctx.moveTo(sx(p.x, p.y), sy(p.x, p.y))));
        ctx.closePath();
        ctx.stroke();
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

function maskBoundsOfPoints(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
