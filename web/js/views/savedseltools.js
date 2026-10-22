// Saved selections (savedsel.js): Select → Save selection…, Load selection ▸ and the Saved selections… dialog
// (load as a new selection or added, subtracted or intersected; rename; delete). Saving, renaming and deleting
// are undo steps that swap `doc.savedSels`; loading is a selection change. Whole-canvas changes take them along
// (savedSelsAlong, from reshapeCanvas and Flip canvas).
// Editor methods (mixed into Editor.prototype in editor.js).

import { SELECT_MODES } from '../selection.js';
import { SAVED_SEL_MAX, savedSel, nextSelName, uniqueSelName, savedSelBytes, savedSelCanvas, mapSavedSel } from '../savedsel.js';
import { esc, modal, promptBox, toast } from '../ui.js';

const THUMB = 72;  // px across the dialog's pictures

export const savedSelMethods = {
  /** Select → Save selection…: keeps the selection under a name, with the artwork. */
  async saveSelection() {
    const d = this.doc;
    if (!this.sel.active) return toast(this.quickMask ? 'Turn Quick mask off first: its red paint becomes the selection.' : 'Select something first, then save it.');
    if (d.savedSels.length >= SAVED_SEL_MAX) return toast(`An artwork keeps up to ${SAVED_SEL_MAX} saved selections. Delete one first (Select → Saved selections…).`, { error: true });
    const names = d.savedSels.map(s => s.name);
    const name = await promptBox('Save selection', 'Name', nextSelName(names));
    if (!name || !this.sel.active) return;
    const { alpha, bounds } = this.sel.snapshot();  // the selected part only
    const entry = savedSel(uniqueSelName(names, name), bounds, alpha);
    this.setSavedSels('Save selection', [...d.savedSels, entry]);
    toast(`Saved as "${entry.name}". Select → Load selection brings it back.`);
  },

  /** Replaces the list of saved selections as one undo step. */
  setSavedSels(label, next) {
    const d = this.doc, before = d.savedSels;
    this.structural(label, () => { d.savedSels = next; }, () => { d.savedSels = before; }, savedSelBytes(next, before));
  },

  /** Makes a saved selection the selection, or combines it with the selection (mode from SELECT_MODES). */
  loadSavedSel(id, mode = 'replace') {
    const s = this.doc.savedSels.find(x => x.id === id);
    if (!s) return;
    if (this.quickMask) return toast('Turn Quick mask off first, then load the selection.');
    this.finishTransform();
    const label = mode === 'replace' ? 'Load selection' : `Load selection (${SELECT_MODES.find(m => m[0] === mode)?.[1].replace(/ \(.*\)/, '').toLowerCase()})`;
    this.changeSelection(label, () => this.sel.combine(mode, ctx => {
      const c = savedSelCanvas(s);
      ctx.drawImage(c, s.x, s.y);
      c.width = c.height = 0;
    }, { x: s.x, y: s.y, w: s.w, h: s.h }));
  },

  /** loadSavedSel by name: what the Saved selections… window's Load records, so an auto action can play it back. */
  loadSelectionNamed(name, mode = 'replace') {
    const s = this.doc.savedSels.find(x => x.name === name);
    if (!s) throw new Error(`there is no saved selection called “${name}”`);
    if (!SELECT_MODES.some(m => m[0] === mode)) mode = 'replace';
    this.loadSavedSel(s.id, mode);
  },

  /** The Load selection submenu: each saved selection (as a new selection), or a note that there are none. */
  savedSelMenu() {
    const list = this.doc.savedSels;
    if (!list.length) return [{ label: 'None saved yet', disabled: true }];
    return list.map(s => ({ label: s.name, run: () => this.loadSavedSel(s.id) }));
  },

  /** Select → Saved selections…: every saved selection with a picture of it, to load, rename or delete. */
  savedSelsDialog() {
    const d = this.doc;
    let mode = 'replace';
    const body = `
      <p class="muted small">Selections kept with this artwork. Load one as the new selection, or add, subtract or intersect it with the one you have.</p>
      <label class="field"><span>Load as</span><select data-mode>${SELECT_MODES.map(([v, l]) => `<option value="${v}">${esc(l.replace(/ \(.*\)/, ''))}</option>`).join('')}</select></label>
      <div class="ssel-list"></div>
      <div class="btn-row"><button data-save>Save the current selection…</button></div>`;
    modal({ title: 'Saved selections', body, buttons: [{ label: 'Close', value: null, primary: true }], onOpen: (root, done) => {
      const listEl = root.querySelector('.ssel-list'), saveBtn = root.querySelector('[data-save]');
      root.querySelector('[data-mode]').onchange = e => { mode = e.target.value; };
      const render = () => {
        saveBtn.disabled = !this.sel.active;
        listEl.innerHTML = d.savedSels.length ? d.savedSels.map(s => `<div class="ssel-row" data-id="${s.id}">
            <canvas></canvas><span class="ssel-name" title="${esc(s.name)}">${esc(s.name)}</span>
            <button data-load>Load</button><button data-rename>Rename</button><button data-del>Delete</button></div>`).join('')
          : '<p class="muted small">None saved yet. Make a selection, then Save the current selection.</p>';
        listEl.querySelectorAll('.ssel-row').forEach(row => {
          const s = d.savedSels.find(x => x.id === +row.dataset.id);
          this.drawSavedSelThumb(row.querySelector('canvas'), s);
          row.querySelector('[data-load]').onclick = () => { done(null); this.loadSelectionNamed(s.name, mode); };
          row.querySelector('[data-rename]').onclick = async () => {
            const name = await promptBox('Rename saved selection', 'Name', s.name);
            if (!name || name === s.name) return;
            const others = d.savedSels.filter(x => x !== s).map(x => x.name);
            this.setSavedSels('Rename saved selection', d.savedSels.map(x => (x === s ? { ...s, name: uniqueSelName(others, name) } : x)));
            render();
          };
          row.querySelector('[data-del]').onclick = () => {
            this.setSavedSels('Delete saved selection', d.savedSels.filter(x => x !== s));
            toast(`"${s.name}" deleted. Undo (Ctrl+Z) brings it back.`);
            render();
          };
        });
      };
      // recorded as Select › Save selection… (this window is not a step, and is shut meanwhile: a recorded step
      // waits for every dialog to close), then the window comes back with the new entry
      saveBtn.onclick = async () => {
        done(null);
        await this.recordStep({ kind: 'menu', menu: 'select', path: ['Save selection…'] }, () => this.saveSelection());
        this.savedSelsDialog();
      };
      render();
    } });
  },

  /** A small picture of a saved selection: the selected part light on the shape of the canvas. */
  drawSavedSelThumb(c, s) {
    const d = this.doc, k = Math.min(THUMB / d.width, (THUMB * 0.75) / d.height);
    c.width = Math.max(1, Math.round(d.width * k));
    c.height = Math.max(1, Math.round(d.height * k));
    const ctx = c.getContext('2d'), src = savedSelCanvas(s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, s.x * k, s.y * k, s.w * k, s.h * k);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#4a4b55';
    ctx.fillRect(0, 0, c.width, c.height);
    src.width = src.height = 0;
  },

  /**
   * apply/revert (and the memory it holds) for taking the saved selections along with a change of the canvas to
   * W x H (m: old doc point to new; null keeps them in place, cut to the new size). One that ends up off the canvas
   * is dropped (and comes back on undo), as are the ones in the file that could not be read (doc.lostSels) when the
   * canvas moves under them: they can't be moved, and kept as they were they would come back in the wrong place.
   */
  savedSelsAlong(m, W, H) {
    const d = this.doc, before = d.savedSels, lost = d.lostSels;
    if (!before.length && !lost.length) return { apply() {}, revert() {}, bytes: 0 };
    const after = before.map(s => mapSavedSel(s, m || [1, 0, 0, 1, 0, 0], W, H)).filter(Boolean);
    const lostAfter = m ? [] : lost.filter(s => s.x + s.w <= W && s.y + s.h <= H);  // in place: kept while they fit
    return {
      apply: () => { d.savedSels = after; d.lostSels = lostAfter; },
      revert: () => { d.savedSels = before; d.lostSels = lost; },
      bytes: savedSelBytes(after),
    };
  },
};
