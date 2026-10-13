// Layer panel: properties of the selected layer or folder, the layer list (top first, folders indented,
// drag a row to reorder or drop it on a folder) and the layer buttons. Changes go through the editor (undo).

import { BLEND_MODES, PASS_THROUGH, LABELS } from '../doc.js';
import { icon } from '../icons.js';
import { isDoubleTap } from '../taps.js';
import { isFolder, panelRows } from '../tree.js';
import { esc, promptBox } from '../ui.js';

const TW = 40, TH = 30, INDENT = 14, DRAG_PX = 5;

export class LayerPanel {
  constructor(root, editor) {
    this.root = root;
    this.ed = editor;
    root.innerHTML = `
      <div class="lp-props">
        <select class="lp-blend" title="Blending mode"></select>
        <label class="lp-opacity" title="Opacity"><input type="range" min="0" max="100" step="1"><span></span></label>
      </div>
      <div class="lp-props">
        <label class="check" title="Lock transparent pixels: paint only where the layer already has paint"><input type="checkbox" class="lp-lock">${icon('lock', 15)} Lock alpha</label>
        <label class="check" title="Clip to the layer below: show only where it has paint"><input type="checkbox" class="lp-clip">${icon('clip', 15)} Clip below</label>
      </div>
      <div class="lp-props">
        <span class="lp-labels" role="radiogroup" aria-label="Color label" title="Color label: marks the layer in this list"><span>Label</span>
          <button class="lp-label-btn none" data-label="" title="No label"></button>
          ${LABELS.map(([id, color]) => `<button class="lp-label-btn" data-label="${id}" style="background:${color}" title="${id[0].toUpperCase() + id.slice(1)} label"></button>`).join('')}
        </span>
      </div>
      <div class="lp-list" role="tree" aria-label="Layers"></div>
      <div class="lp-buttons">
        <button class="icon-btn" data-op="add" title="New layer (Ctrl+Shift+N)">${icon('plus', 18)}</button>
        <button class="icon-btn" data-op="folder" title="New folder (Ctrl+G puts the selected layer in one)">${icon('folderPlus', 18)}</button>
        <button class="icon-btn" data-op="mask" title="Add a mask (hides outside the selection, if there is one)">${icon('mask', 18)}</button>
        <button class="icon-btn" data-op="dup" title="Duplicate">${icon('copy', 18)}</button>
        <button class="icon-btn" data-op="up" title="Move up">${icon('up', 18)}</button>
        <button class="icon-btn" data-op="down" title="Move down">${icon('down', 18)}</button>
        <button class="icon-btn" data-op="merge" title="Merge with layer below, or merge a folder into one layer (Ctrl+E)">${icon('merge', 18)}</button>
        <button class="icon-btn" data-op="del" title="Delete">${icon('trash', 18)}</button>
      </div>`;
    this.list = root.querySelector('.lp-list');
    const ops = {
      add: () => editor.layerAdd(), folder: () => editor.folderAdd(), dup: () => editor.layerDuplicate(),
      mask: () => editor.doc.active.mask ? editor.editMask(true) : editor.addMask(),
      up: () => editor.layerMove(1), down: () => editor.layerMove(-1), merge: () => editor.mergeDown(), del: () => editor.layerDelete(),
    };
    root.querySelectorAll('.lp-buttons button').forEach(b => { b.onclick = () => ops[b.dataset.op](); });
    const blend = root.querySelector('.lp-blend');
    blend.onchange = () => editor.setLayerProp(editor.doc.active, 'blend', blend.value, 'Blending mode');
    const op = root.querySelector('.lp-opacity input');
    let start = null;
    op.addEventListener('input', () => {
      const n = editor.doc.active;
      if (start === null) start = n.opacity;
      n.opacity = op.value / 100;
      root.querySelector('.lp-opacity span').textContent = op.value + '%';
      editor.changed(null, { save: false });
    });
    op.addEventListener('change', () => {
      const n = editor.doc.active, v = op.value / 100;
      if (start !== null) n.opacity = start;
      start = null;
      editor.setLayerProp(n, 'opacity', v, 'Opacity');
    });
    root.querySelector('.lp-lock').onchange = e => editor.setLayerProp(editor.doc.active, 'alphaLock', e.target.checked, 'Lock alpha');
    root.querySelector('.lp-clip').onchange = e => editor.setLayerProp(editor.doc.active, 'clip', e.target.checked, 'Clip to layer below');
    root.querySelectorAll('.lp-label-btn').forEach(b => { b.onclick = () => editor.setLayerProp(editor.doc.active, 'label', b.dataset.label || null, 'Color label'); });
    this.bindDrag();
  }

  render() {
    const ed = this.ed, n = ed.doc.active, folder = isFolder(n);
    const blend = this.root.querySelector('.lp-blend');
    blend.innerHTML = (folder ? [PASS_THROUGH, ...BLEND_MODES] : BLEND_MODES).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    blend.value = n.blend;
    this.root.querySelector('.lp-opacity input').value = Math.round(n.opacity * 100);
    this.root.querySelector('.lp-opacity span').textContent = Math.round(n.opacity * 100) + '%';
    const lock = this.root.querySelector('.lp-lock');
    lock.checked = !!n.alphaLock;
    lock.disabled = folder;
    this.root.querySelector('.lp-clip').checked = n.clip;
    this.root.querySelectorAll('.lp-label-btn').forEach(b => { b.classList.toggle('on', (n.label || '') === b.dataset.label); b.setAttribute('aria-checked', (n.label || '') === b.dataset.label); });
    this.root.querySelector('[data-op="mask"]').title = n.mask ? 'Paint on the mask' : 'Add a mask (hides outside the selection, if there is one)';
    const chip = ed.root.querySelector('.mask-chip');
    if (chip) chip.hidden = !ed.maskEdit;
    this.list.innerHTML = '';
    for (const { node, depth } of panelRows(ed.doc.root)) {
      const row = document.createElement('div');
      const active = node === n;
      row.className = 'lp-row' + (active ? ' active' : '') + (node.clip ? ' clipped' : '') + (isFolder(node) ? ' folder' : '');
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', active);
      if (isFolder(node)) row.setAttribute('aria-expanded', node.open);
      row.style.paddingLeft = 4 + depth * INDENT + 'px';
      const sub = [blendLabel(node.blend), Math.round(node.opacity * 100) + '%'];
      if (node.text) sub.unshift('Text');
      if (node.tone) sub.unshift('Tone');
      if (node.alphaLock) sub.push('locked');
      if (node.mask && !node.mask.enabled) sub.push('mask off');
      row.innerHTML = `
        <button class="icon-btn lp-eye" title="${node.visible ? 'Hide' : 'Show'}">${icon(node.visible ? 'eye' : 'eyeOff', 16)}</button>
        ${isFolder(node)
          ? `<button class="icon-btn lp-twisty" title="${node.open ? 'Close' : 'Open'} folder">${node.open ? '▾' : '▸'}</button><span class="lp-foldericon">${icon('folder', 22)}</span>`
          : `<canvas class="lp-thumb${active && !ed.maskEdit ? ' target' : ''}" width="${TW}" height="${TH}" title="Layer pixels"></canvas>`}
        ${node.mask ? `<canvas class="lp-mask${active && ed.maskEdit ? ' target' : ''}${node.mask.enabled ? '' : ' off'}" width="${TW}" height="${TH}" title="Mask: click to paint on it (painting hides, erasing shows)"></canvas>` : ''}
        <div class="lp-name"><span>${node.label ? `<i class="lp-dot" style="background:${labelColor(node.label)}"></i>` : ''}${esc(node.name)}</span><small>${esc(sub.join(' · '))}</small></div>`;
      row.querySelector('.lp-eye').onclick = () => ed.toggleVisible(node);
      const tw = row.querySelector('.lp-twisty');
      if (tw) tw.onclick = () => ed.toggleOpen(node);
      row._node = node;
      this.list.append(row);
    }
    this.thumbs();
  }

  /** Redraws the small previews (after painting). */
  thumbs() {
    const doc = this.ed.doc;
    const s = Math.min(TW / doc.width, TH / doc.height);
    const w = doc.width * s, h = doc.height * s, x = (TW - w) / 2, y = (TH - h) / 2;
    for (const row of this.list.children) {
      const n = row._node;
      const thumb = row.querySelector('.lp-thumb');
      if (thumb) {
        const ctx = thumb.getContext('2d');
        ctx.clearRect(0, 0, TW, TH);
        ctx.drawImage(n.canvas, x, y, w, h);
      }
      const mask = row.querySelector('.lp-mask');
      if (mask) {  // white = shown, black = hidden
        const ctx = mask.getContext('2d');
        ctx.clearRect(0, 0, TW, TH);
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, w, h);
        ctx.drawImage(n.mask.canvas, x, y, w, h);
      }
    }
  }

  async rename(node) {
    const name = await promptBox(isFolder(node) ? 'Rename folder' : 'Rename layer', 'Name', node.name);
    if (name) this.ed.setLayerProp(node, 'name', name, 'Rename');
  }

  /** Click a row to select it (its mask thumbnail to paint on the mask), tap it again to rename it; drag it to move it. */
  bindDrag() {
    const list = this.list;
    let drag = null;
    const clearMarks = () => list.querySelectorAll('.drop-above, .drop-below, .drop-into').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
    list.addEventListener('pointerdown', e => {
      const row = e.target.closest('.lp-row');
      if (!row || e.button !== 0 || e.target.closest('button')) return;
      drag = { node: row._node, mask: !!e.target.closest('.lp-mask'), y: e.clientY, id: e.pointerId, moving: false, drop: null };
      try { list.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    });
    list.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moving && Math.abs(e.clientY - drag.y) < DRAG_PX) return;
      drag.moving = true;
      list.classList.add('dragging');
      clearMarks();
      drag.drop = null;
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lp-row');
      if (!row || row._node === drag.node) return;
      const r = row.getBoundingClientRect(), f = (e.clientY - r.top) / r.height, t = row._node;
      let where;
      if (isFolder(t)) where = f < 0.25 ? 'above' : f > 0.75 && !t.open ? 'below' : 'top-of';
      else where = f < 0.5 ? 'above' : 'below';
      drag.drop = { target: t, where };
      row.classList.add(where === 'above' ? 'drop-above' : where === 'below' ? 'drop-below' : 'drop-into');
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      list.classList.remove('dragging');
      clearMarks();
      if (!d.moving) {
        // a second tap on the same row renames it (a dblclick event never arrives: selecting rebuilds the rows)
        const rename = !d.mask && isDoubleTap(this.lastTap, d.node, performance.now());
        this.lastTap = rename ? null : { key: d.node, time: performance.now() };
        this.ed.selectNode(d.node, { mask: d.mask });
        if (rename) this.rename(d.node);
      }
      else if (d.drop && e.type === 'pointerup') this.ed.moveNodeTo(d.node, d.drop.target, d.drop.where);
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
  }
}

function labelColor(id) {
  return LABELS.find(l => l[0] === id)?.[1] || 'transparent';
}

function blendLabel(v) {
  return v === PASS_THROUGH[0] ? PASS_THROUGH[1] : BLEND_MODES.find(m => m[0] === v)?.[1] || 'Normal';
}
