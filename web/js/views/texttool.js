// Text tool: click to start a text layer, click an existing text to edit it again. Typing goes into a textarea
// laid over the canvas (its own text is invisible; what you see is the layer being drawn as you type), placed
// with the view's transform so it follows zoom, rotation and mirroring. Click elsewhere, switch tools,
// Esc or Ctrl+Enter to finish. Dragging instead of clicking draws a path for a new text to follow; a text on a path
// or warped shows its box, with the letters visible, under the text instead. With some characters selected in the box, the font, size, bold, italic and the main
// colour change only those (textlayer.js runs); with none selected they change the whole text.
// Editor methods (mixed into Editor.prototype in editor.js).

import { Layer } from '../doc.js';
import { fontCss, renderTextLayer, sanitizeText, textBounds, textMatrix, toTextLocal, textAfterMap, editContent, styleRange, restyleText, styleAt, pathFromPoints, isWarped, RUN_KEYS } from '../textlayer.js';
import { translateVector } from '../vector.js';
import { allLayers, insertNode, removeNode, contains } from '../tree.js';
import { toast } from '../ui.js';
import { matrix } from '../view.js';

const TEXT_KEYS = ['font', 'size', 'bold', 'italic', 'align', 'leading', 'tracking', 'vertical', 'outline', 'warp', 'bend'];
/** Screen px the pointer must travel for a drag to draw a text path rather than click. */
const PATH_DRAG = 12;

export const textMethods = {
  /** The Text tool went down at dp: a click edits or starts a text (textClick), a drag draws a path for a new one. */
  beginTextPath(dp, id) {
    if (this.insideTextEdit(dp)) return;
    this.gesture = { type: 'textpath', tool: 'text', id, points: [dp], far: false };
  },

  textPathDrag(dp) {
    const g = this.gesture, z = this.view.zoom, a = g.points[0], last = g.points[g.points.length - 1];
    if (Math.hypot(dp.x - last.x, dp.y - last.y) * z < 2) return;
    g.points.push(dp);
    g.far ||= Math.hypot(dp.x - a.x, dp.y - a.y) * z >= PATH_DRAG;
    this.drawOverlay();
  },

  endTextPath() {
    const g = this.gesture;
    this.gesture = null;
    this.drawOverlay();
    const { x, y, path } = g.far ? pathFromPoints(g.points, Math.max(1, 4 / this.view.zoom)) : {};
    if (!path) return this.textClick(g.points[0]);
    this.finishText();
    const s = this.settings.text;
    this.editText(null, sanitizeText({ ...pick(s), outlineColor: this.outlineHex(s), content: '', x, y, path, color: this.colors.main }));
  },

  /** True when dp is on the text being edited (a click there moves the caret, it does not finish the edit). */
  insideTextEdit(dp) {
    if (!this.textEdit) return false;
    const b = this.editBounds(), q = toTextLocal(this.textEdit.layer.text, dp);
    const pad = 6 / this.view.zoom;
    return !!b && q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
  },

  /** The path being drawn, and the path of the text being edited (dashed), as thin lines over the canvas. */
  drawTextPathOverlay(ctx) {
    const g = this.gesture?.type === 'textpath' ? this.gesture : null, t = this.textEdit?.layer.text;
    const pts = g ? (g.far ? g.points : null) : t?.path ? t.path.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })) : null;
    if (!pts) return;
    const dpr = this.dpr || 1, [a, b, c, d, e, f] = matrix(this.view), [ma, mb, mc, md, me, mf] = g ? [1, 0, 0, 1, 0, 0] : textMatrix(t);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.setLineDash(g ? [] : [4 * dpr, 4 * dpr]);
    for (const [color, w] of [['rgba(0,0,0,.5)', 3 * dpr], ['#6ea8ff', 1.5 * dpr]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = ma * p.x + mc * p.y + me, y = mb * p.x + md * p.y + mf;  // the text's own matrix, then the view
        const sx = (a * x + c * y + e) * dpr, sy = (b * x + d * y + f) * dpr;
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.restore();
  },

  /** Takes a text off its path: it becomes an ordinary line of text starting where the path started (an undo step). */
  removeTextPath(layer) {
    this.finishText();
    const before = layer.text;
    if (!before?.path) return;
    const after = { ...before };
    delete after.path;
    const set = t => { layer.text = t; renderTextLayer(layer); };
    this.structural('Remove text path', () => set(after), () => set(before));
  },

  /** The text tool was clicked at dp: finish any edit, then edit the text there or start a new one. */
  textClick(dp) {
    if (this.textEdit) {
      if (this.insideTextEdit(dp)) return;
      this.commitText();
    }
    const hit = this.textLayerAt(dp);
    if (hit) return this.editText(hit);
    const s = this.settings.text;
    this.editText(null, sanitizeText({ ...pick(s), outlineColor: this.outlineHex(s), content: '', x: dp.x, y: dp.y, color: this.colors.main }));
  },

  /** The topmost visible text layer whose text covers dp. */
  textLayerAt(dp) {
    const pad = 4 / this.view.zoom;
    const layers = allLayers(this.doc.root).filter(l => l.text && this.isShown(l)).reverse();
    return layers.find(l => {
      const b = textBounds(l.text, l.ctx), q = toTextLocal(l.text, dp);
      return q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
    }) || null;
  },

  /** A node is shown when it and every folder around it are visible. */
  isShown(n) {
    for (let x = n; x && x.parent; x = x.parent) if (!x.visible) return false;
    return true;
  },

  editText(layer, props = null) {
    const d = this.doc;
    let isNew = false;
    if (!layer) {  // a new text layer, in the tree for the preview only; the undo step is made when finishing
      layer = new Layer(d.width, d.height, { name: 'Text' });
      layer.text = props;
      const anchor = d.active, parent = anchor.parent;
      insertNode(parent, parent.children.indexOf(anchor) + 1, layer);
      isNew = true;
    } else {
      // the panel shows (and edits) this text's settings
      Object.assign(this.settings.text, pick(layer.text), { outlineColor: { '#ffffff': 'white', '#000000': 'black' }[layer.text.outlineColor] || 'sub' });
      this.renderToolProps();
    }
    this.textEdit = { layer, isNew, before: isNew ? null : { ...layer.text } };
    if (layer !== d.active && !isNew) this.selectNode(layer);
    this.showTextEditor();
    this.renderEditingText();
  },

  renderEditingText() {
    const te = this.textEdit;
    renderTextLayer(te.layer);
    this.changed(null, { save: false });
    this.placeTextEditor();
  },

  editBounds() {
    const te = this.textEdit;
    return te ? textBounds({ ...te.layer.text, content: te.layer.text.content || ' ' }, te.layer.ctx) : null;
  },

  showTextEditor() {
    const box = document.createElement('div');
    box.className = 'text-edit';
    box.innerHTML = '<textarea spellcheck="false" aria-label="Text"></textarea>';
    this.viewport.append(box);
    const ta = box.querySelector('textarea');
    ta.value = this.textEdit.layer.text.content;
    ta.addEventListener('input', () => {
      const te = this.textEdit;
      te.layer.text = editContent(te.layer.text, ta.value.slice(0, 5000));  // styled parts follow the typing
      this.renderEditingText();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); this.commitText(); }
    });
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    for (const ev of ['select', 'keyup', 'pointerup']) ta.addEventListener(ev, () => this.syncTextPanel());
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  },

  /** Keeps the textarea over the text, in doc coordinates under the view transform. */
  placeTextEditor() {
    const box = this.viewport.querySelector('.text-edit');
    if (!box || !this.textEdit) return;
    const t = this.textEdit.layer.text, b = this.editBounds();
    // the view's matrix after the text's own (turned or scaled text keeps its editor lined up with it)
    const [va, vb, vc, vd, ve, vf] = matrix(this.view), [ma, mb, mc, md, me, mf] = textMatrix(t);
    const a = va * ma + vc * mb, bb = vb * ma + vd * mb, c = va * mc + vc * md, d = vb * mc + vd * md;
    const e = va * me + vc * mf + ve, f = vb * me + vd * mf + vf;
    box.style.transform = `matrix(${a}, ${bb}, ${c}, ${d}, ${e}, ${f})`;
    const ta = box.firstElementChild, extra = t.size;  // room for the next character
    // on a path or warped, the letters cannot line up with the box: it shows them plainly, just under the text
    const shaped = !!t.path || isWarped(t);
    box.classList.toggle('shaped', shaped);
    if (shaped) {
      const f = textBounds({ ...t, content: t.content || ' ', path: undefined, warp: 'none' }, this.textEdit.layer.ctx), vertical = t.vertical && !t.path;
      Object.assign(ta.style, {
        left: b.x + 'px', top: b.y + b.h + 8 / this.view.zoom + 'px',
        width: f.w + extra + 'px', height: f.h + (vertical ? extra : 0) + 'px',
        font: fontCss(t), lineHeight: t.size * t.leading + 'px', letterSpacing: (t.tracking || 0) * t.size + 'px',
        textAlign: vertical ? 'start' : t.align, writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
        outlineWidth: 1 / this.view.zoom + 'px',
      });
      return;
    }
    Object.assign(ta.style, {
      left: (t.vertical ? b.x - extra : t.align === 'center' ? b.x - extra / 2 : t.align === 'right' ? b.x - extra : b.x) + 'px',
      top: b.y + 'px',
      width: b.w + extra + 'px',
      height: b.h + (t.vertical ? extra : 0) + 'px',
      font: fontCss(t),
      lineHeight: t.size * t.leading + 'px',
      letterSpacing: (t.tracking || 0) * t.size + 'px',
      textAlign: t.vertical ? 'start' : t.align,
      writingMode: t.vertical ? 'vertical-rl' : 'horizontal-tb',
      outlineWidth: 1 / this.view.zoom + 'px',
    });
  },

  /** Finishes editing: a new text becomes an undo step (or vanishes if empty); a changed one too. */
  commitText() {
    const te = this.textEdit;
    if (!te) return;
    this.textEdit = null;
    this.viewport.querySelector('.text-edit')?.remove();
    const layer = te.layer, empty = !layer.text.content.trim();
    if (te.isNew) {
      removeNode(layer);
      if (empty) { this.changed(null, { save: false }); return; }
      layer.name = layer.text.content.trim().split('\n')[0].slice(0, 30) || 'Text';
      this.insertNode(layer, 'Add text');
      return;
    }
    const after = { ...layer.text };
    if (JSON.stringify(after) === JSON.stringify(te.before)) { this.changed(null, { save: false }); return; }
    if (empty) {  // emptied: put the old text back and delete the layer
      layer.text = te.before;
      renderTextLayer(layer);
      this.selectNode(layer);
      if (allLayers(this.doc.root).some(l => !contains(layer, l))) this.layerDelete();
      else toast('The text is empty, but an artwork needs at least one layer, so the old text stays.');
      return;
    }
    const set = t => { layer.text = { ...t }; renderTextLayer(layer); };
    this.structural('Edit text', () => set(after), () => set(te.before));
  },

  /** Finishes any text edit; for code that must not leave one open (switching tools, saving, reloading). */
  finishText() {
    if (this.textEdit) this.commitText();
  },

  /** The characters selected in the text box ([from, to], string indices), or null when only the caret is there. */
  textSelection() {
    const ta = this.viewport.querySelector('.text-edit textarea');
    return ta && ta.selectionEnd > ta.selectionStart ? [ta.selectionStart, ta.selectionEnd] : null;
  },

  /**
   * Tool panel or colour changes while editing apply to the text being edited: to the selected characters for a
   * setting a part can have (key k), else to the whole text.
   */
  textSettingsChanged(k = null) {
    if (!this.textEdit) return;
    const sel = this.textSelection(), te = this.textEdit;
    if (sel && RUN_KEYS.includes(k)) {
      te.layer.text = styleRange(te.layer.text, sel[0], sel[1], { [k]: this.settings.text[k] });
      this.renderEditingText();
      this.viewport.querySelector('.text-edit textarea')?.focus();
      return;
    }
    // only the setting that changed: the panel may be showing a styled part's look (syncTextPanel)
    const s = this.settings.text;
    const change = k === 'outlineColor' ? { outlineColor: this.outlineHex(s) } : k ? (TEXT_KEYS.includes(k) ? { [k]: s[k] } : {}) : { ...pick(s), outlineColor: this.outlineHex(s) };
    te.layer.text = sanitizeText(restyleText(te.layer.text, change));
    this.renderEditingText();
    this.viewport.querySelector('.text-edit textarea')?.focus();
  },

  /** The panel shows the look under the caret (or at the start of the selected characters) while editing. */
  syncTextPanel() {
    const te = this.textEdit, ta = this.viewport.querySelector('.text-edit textarea');
    if (!te || !ta) return;
    const i = ta.selectionEnd > ta.selectionStart ? ta.selectionStart : ta.selectionStart - 1;
    const st = styleAt(te.layer.text, i), s = this.settings.text;
    if (['font', 'size', 'bold', 'italic'].every(k => s[k] === st[k])) return;
    Object.assign(s, { font: st.font, size: st.size, bold: st.bold, italic: st.italic });
    this.renderToolProps();
  },

  /** The outline colour a Text tool setting stands for ('sub' is the sub colour now). */
  outlineHex(s) {
    return s.outlineColor === 'black' ? '#000000' : s.outlineColor === 'sub' ? this.colors.sub : '#ffffff';
  },

  textColorChanged() {
    if (!this.textEdit) return;
    const sel = this.textSelection();
    if (sel) {
      this.textEdit.layer.text = styleRange(this.textEdit.layer.text, sel[0], sel[1], { color: this.colors.main });
      this.renderEditingText();
      return;
    }
    this.textEdit.layer.text.color = this.colors.main;
    this.renderEditingText();
  },

  /** Turns a text layer into ordinary pixels (an undo step); painting tools offer this. */
  rasterizeText(layer) {
    const t = layer.text;
    if (!t) return;
    this.structural('Rasterize text', () => { layer.text = null; }, () => { layer.text = t; });
    toast('The text is now ordinary pixels you can paint on.');
  },

  /**
   * For operations that change text or vector layers' pixels directly: drop their text or lines, so they become
   * ordinary pixels (and restore them on undo). With `m` (the affine the operation maps doc points by) text layers
   * instead follow it in their matrix and stay editable (redrawn sharp), unless that would shear them; vector
   * lines follow a plain shift (crop, canvas size).
   */
  textsIn(rasters, m = null) {
    const shift = m && m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
    const list = rasters.filter(r => r.text || r.vector).map(r => {
      const t2 = r.text && m ? textAfterMap(r.text, m) : null;
      const v2 = r.vector && shift ? translateVector(r.vector, m[4], m[5]) : null;
      return [r, r.text, r.vector, t2, v2];
    });
    return {
      drop: () => list.forEach(([r, , , t2, v2]) => {
        r.text = t2;
        r.vector = v2;
        if (t2) renderTextLayer(r);
      }),
      restore: () => list.forEach(([r, t, v]) => { r.text = t; r.vector = v; }),
    };
  },
};

function pick(s) {
  return Object.fromEntries(TEXT_KEYS.map(k => [k, s[k]]));
}
