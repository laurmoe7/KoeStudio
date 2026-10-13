// Layer panel: layer properties for the selected layer, the layer list (top layer first) and layer buttons.
// All changes go through the editor, which records them for undo.

import { BLEND_MODES } from '../doc.js';
import { icon } from '../icons.js';
import { esc, promptBox } from '../ui.js';

const TW = 44, TH = 32;

export class LayerPanel {
  constructor(root, editor) {
    this.root = root;
    this.ed = editor;
    root.innerHTML = `
      <div class="lp-props">
        <select class="lp-blend" title="Blending mode">${BLEND_MODES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        <label class="lp-opacity" title="Layer opacity"><input type="range" min="0" max="100" step="1"><span></span></label>
      </div>
      <div class="lp-props">
        <label class="check" title="Lock transparent pixels: paint only where the layer already has paint"><input type="checkbox" class="lp-lock">${icon('lock', 15)} Lock alpha</label>
        <label class="check" title="Clip to layer below: show only where the layer below has paint"><input type="checkbox" class="lp-clip">${icon('clip', 15)} Clip below</label>
      </div>
      <div class="lp-list" role="listbox" aria-label="Layers"></div>
      <div class="lp-buttons">
        <button class="icon-btn" data-op="add" title="New layer (Ctrl+Shift+N)">${icon('plus', 18)}</button>
        <button class="icon-btn" data-op="dup" title="Duplicate layer">${icon('copy', 18)}</button>
        <button class="icon-btn" data-op="up" title="Move layer up">${icon('up', 18)}</button>
        <button class="icon-btn" data-op="down" title="Move layer down">${icon('down', 18)}</button>
        <button class="icon-btn" data-op="merge" title="Merge with layer below (Ctrl+E)">${icon('merge', 18)}</button>
        <button class="icon-btn" data-op="del" title="Delete layer">${icon('trash', 18)}</button>
      </div>`;
    this.list = root.querySelector('.lp-list');
    root.querySelectorAll('.lp-buttons button').forEach(b => {
      b.onclick = () => ({ add: () => editor.layerAdd(), dup: () => editor.layerDuplicate(), up: () => editor.layerMove(1),
        down: () => editor.layerMove(-1), merge: () => editor.mergeDown(), del: () => editor.layerDelete() })[b.dataset.op]();
    });
    const blend = root.querySelector('.lp-blend');
    blend.onchange = () => editor.setLayerProp(editor.doc.layer, 'blend', blend.value, 'Blending mode');
    const op = root.querySelector('.lp-opacity input');
    let start = null;
    op.addEventListener('input', () => {
      const l = editor.doc.layer;
      if (start === null) start = l.opacity;
      l.opacity = op.value / 100;
      root.querySelector('.lp-opacity span').textContent = op.value + '%';
      editor.changed(null, { save: false });
    });
    op.addEventListener('change', () => {
      const l = editor.doc.layer, v = op.value / 100;
      if (start !== null) l.opacity = start;
      start = null;
      editor.setLayerProp(l, 'opacity', v, 'Layer opacity');
    });
    root.querySelector('.lp-lock').onchange = e => editor.setLayerProp(editor.doc.layer, 'alphaLock', e.target.checked, 'Lock alpha');
    root.querySelector('.lp-clip').onchange = e => editor.setLayerProp(editor.doc.layer, 'clip', e.target.checked, 'Clip to layer below');
  }

  render() {
    const doc = this.ed.doc, l = doc.layer;
    this.root.querySelector('.lp-blend').value = l.blend;
    this.root.querySelector('.lp-opacity input').value = Math.round(l.opacity * 100);
    this.root.querySelector('.lp-opacity span').textContent = Math.round(l.opacity * 100) + '%';
    this.root.querySelector('.lp-lock').checked = l.alphaLock;
    this.root.querySelector('.lp-clip').checked = l.clip;
    this.list.innerHTML = '';
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const layer = doc.layers[i];
      const row = document.createElement('div');
      row.className = 'lp-row' + (i === doc.active ? ' active' : '') + (layer.clip ? ' clipped' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === doc.active);
      row.innerHTML = `
        <button class="icon-btn lp-eye" title="${layer.visible ? 'Hide' : 'Show'} layer">${icon(layer.visible ? 'eye' : 'eyeOff', 16)}</button>
        <canvas width="${TW}" height="${TH}"></canvas>
        <div class="lp-name"><span>${esc(layer.name)}</span><small>${esc(blendLabel(layer.blend))} · ${Math.round(layer.opacity * 100)}%${layer.alphaLock ? ' · locked' : ''}</small></div>`;
      row.onclick = e => { if (!e.target.closest('.lp-eye')) this.ed.selectLayer(i); };
      row.querySelector('.lp-eye').onclick = () => this.ed.toggleVisible(layer);
      row.querySelector('.lp-name').ondblclick = async () => {
        const name = await promptBox('Rename layer', 'Layer name', layer.name);
        if (name) this.ed.setLayerProp(layer, 'name', name, 'Rename layer');
      };
      row._layer = layer;
      this.list.append(row);
    }
    this.thumbs();
  }

  /** Redraws the small previews (after painting). */
  thumbs() {
    const doc = this.ed.doc;
    const s = Math.min(TW / doc.width, TH / doc.height);
    const w = doc.width * s, h = doc.height * s;
    for (const row of this.list.children) {
      const ctx = row.querySelector('canvas').getContext('2d');
      ctx.clearRect(0, 0, TW, TH);
      ctx.fillStyle = '#fff';
      ctx.fillRect((TW - w) / 2, (TH - h) / 2, w, h);
      ctx.drawImage(row._layer.canvas, (TW - w) / 2, (TH - h) / 2, w, h);
    }
  }
}

function blendLabel(v) {
  return BLEND_MODES.find(m => m[0] === v)?.[1] || 'Normal';
}
