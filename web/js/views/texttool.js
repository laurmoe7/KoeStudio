// Text tool: click to start a text layer, click an existing text to edit it again. Typing goes into a textarea
// laid over the canvas (its own text is invisible; what you see is the layer being drawn as you type), placed
// with the view's transform so it follows zoom, rotation and mirroring. Click elsewhere, switch tools,
// Esc or Ctrl+Enter to finish. Editor methods (mixed into Editor.prototype in editor.js).

import { Layer } from '../doc.js';
import { fontCss, renderTextLayer, sanitizeText, textBounds } from '../textlayer.js';
import { allLayers, insertNode, removeNode, contains } from '../tree.js';
import { toast } from '../ui.js';
import { matrix } from '../view.js';

const TEXT_KEYS = ['font', 'size', 'bold', 'italic', 'align', 'leading', 'vertical', 'outline'];

export const textMethods = {
  /** The text tool was clicked at dp: finish any edit, then edit the text there or start a new one. */
  textClick(dp) {
    if (this.textEdit) {
      const b = this.editBounds();
      const pad = 6 / this.view.zoom;
      if (b && dp.x >= b.x - pad && dp.x <= b.x + b.w + pad && dp.y >= b.y - pad && dp.y <= b.y + b.h + pad) return;
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
      const b = textBounds(l.text, l.ctx);
      return dp.x >= b.x - pad && dp.x <= b.x + b.w + pad && dp.y >= b.y - pad && dp.y <= b.y + b.h + pad;
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
      this.textEdit.layer.text.content = ta.value.slice(0, 5000);
      this.renderEditingText();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) { e.preventDefault(); this.commitText(); }
    });
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  },

  /** Keeps the textarea over the text, in doc coordinates under the view transform. */
  placeTextEditor() {
    const box = this.viewport.querySelector('.text-edit');
    if (!box || !this.textEdit) return;
    const t = this.textEdit.layer.text, b = this.editBounds();
    const [a, bb, c, d, e, f] = matrix(this.view);
    box.style.transform = `matrix(${a}, ${bb}, ${c}, ${d}, ${e}, ${f})`;
    const ta = box.firstElementChild, extra = t.size;  // room for the next character
    Object.assign(ta.style, {
      left: (t.vertical ? b.x - extra : t.align === 'center' ? b.x - extra / 2 : t.align === 'right' ? b.x - extra : b.x) + 'px',
      top: b.y + 'px',
      width: b.w + extra + 'px',
      height: b.h + (t.vertical ? extra : 0) + 'px',
      font: fontCss(t),
      lineHeight: t.size * t.leading + 'px',
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

  /** Tool panel or colour changes while editing apply to the text being edited. */
  textSettingsChanged() {
    if (!this.textEdit) return;
    Object.assign(this.textEdit.layer.text, sanitizeText({ ...this.textEdit.layer.text, ...pick(this.settings.text), outlineColor: this.outlineHex(this.settings.text) }));
    this.renderEditingText();
    this.viewport.querySelector('.text-edit textarea')?.focus();
  },

  /** The outline colour a Text tool setting stands for ('sub' is the sub colour now). */
  outlineHex(s) {
    return s.outlineColor === 'black' ? '#000000' : s.outlineColor === 'sub' ? this.colors.sub : '#ffffff';
  },

  textColorChanged() {
    if (!this.textEdit) return;
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
   * ordinary pixels (and restore them on undo).
   */
  textsIn(rasters) {
    const list = rasters.filter(r => r.text || r.vector).map(r => [r, r.text, r.vector]);
    return {
      drop: () => list.forEach(([r]) => { r.text = null; r.vector = null; }),
      restore: () => list.forEach(([r, t, v]) => { r.text = t; r.vector = v; }),
    };
  },
};

function pick(s) {
  return Object.fromEntries(TEXT_KEYS.map(k => [k, s[k]]));
}
