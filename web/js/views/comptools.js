// Layer comps (layercomps.js): the floating Layer comps window (Layers panel button, or View → Layer comps; state in
// koe.compWin = {open, x, y}). New, Update, Rename and Delete swap `doc.comps` as undo steps; applying a comp is one
// undo step for every eye, opacity, blending mode and position it changes (an eye on its own is not one). Export
// writes each comp as a PNG of the whole picture.
// Editor methods (mixed into Editor.prototype in editor.js).

import { api } from '../api.js';
import { COMP_MAX, COMP_PARTS, captureComp, updateComp, compChanges, compMatches, nextCompName, uniqueCompName, turnOffset, turnComps } from '../layercomps.js';
import { allNodes } from '../tree.js';
import { EXPORT_BY_ID, sanitizeExportOptions } from '../imageformats.js';
import { pngWithDpi } from '../resolution.js';
import { drawSnapshot, snapBytes } from '../snapshot.js';
import { mapFill } from '../patterns.js';
import { renderFillLayer } from '../fillrender.js';
import { translateVector } from '../vector.js';
import { esc, toast, modal, menu, promptBox, confirmBox, store } from '../ui.js';
import { icon } from '../icons.js';
import { lockedNode } from './layerops.js';
import { browseFile } from './filebrowser.js';
import { showFolder, dirLabel } from './exporttools.js';

const partsLabel = c => ['Visibility', ...COMP_PARTS.filter(([k]) => c.use[k]).map(([, l]) => l)].join(' · ');

export const compMethods = {
  compState() {
    const st = store('compWin') || {};
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    return { open: !!st.open, x: num(st.x, window.innerWidth - 600), y: num(st.y, 160) };
  },

  toggleCompWindow(open = !this.compState().open) {
    store('compWin', { ...this.compState(), open });
    this.renderCompWindow(true);
  },

  /** Opens or closes the window to match the remembered state; redraw = refresh its contents. */
  renderCompWindow(redraw = false) {
    const st = this.compState();
    if (!st.open || this.destroyed) { this.compWin?.remove(); this.compWin = null; return; }
    if (this.compWin && !redraw) return;
    let w = this.compWin;
    if (!w) {
      w = this.compWin = document.createElement('div');
      w.className = 'brush-win comp-win';
      w.setAttribute('role', 'dialog');
      w.setAttribute('aria-label', 'Layer comps');
      this.root.append(w);
    }
    const comps = this.doc.comps, nodes = allNodes(this.doc.root);
    if (!(this.compSel < comps.length)) this.compSel = comps.length - 1;
    const sel = comps[this.compSel];
    w.innerHTML = `<div class="bw-head"><span class="bw-title">Layer comps</span>
        <button class="icon-btn" data-a="close" title="Close">✕</button></div>
      <div class="comp-list" role="listbox" aria-label="Layer comps">${comps.length ? comps.map((c, i) => `
        <div class="comp-row${i === this.compSel ? ' on' : ''}" data-i="${i}" role="option" aria-selected="${i === this.compSel}" title="Click to show the layers as kept in this comp">
          <span class="comp-mark" title="${compMatches(c, nodes) ? 'The layers look like this now' : ''}">${compMatches(c, nodes) ? '●' : ''}</span>
          <span class="comp-name"><b>${esc(c.name)}</b><small>${esc(partsLabel(c))}</small></span>
        </div>`).join('')
        : '<p class="muted small comp-empty">No comps yet. Show and hide layers the way you want, then press New to keep that.</p>'}</div>
      <div class="act-foot">
        <button data-a="new" title="Keep which layers show now as a new comp">${icon('plus', 14)} New</button>
        <button data-a="update" title="Keep the layers as they look now in the selected comp"${sel ? '' : ' disabled'}>Update</button>
        <button data-a="export" title="Export each comp as a picture"${comps.length ? '' : ' disabled'}>Export…</button>
        <button class="icon-btn" data-a="more" title="Rename or delete the selected comp"${sel ? '' : ' disabled'}>⋯</button>
      </div>`;
    this.placeFloating(w, st.x, st.y);
    if (!w.dataset.bound) {
      w.dataset.bound = '1';
      this.bindFloatingHead(w, (x, y) => store('compWin', { ...this.compState(), x, y }));
      w.addEventListener('click', e => this.onCompClick(e));
    }
  },

  onCompClick(e) {
    const b = e.target.closest('[data-a]'), a = b?.dataset.a, row = e.target.closest('.comp-row');
    if (row) return this.applyComp(+row.dataset.i);
    const i = this.compSel, c = this.doc.comps[i];
    if (a === 'close') this.toggleCompWindow(false);
    if (a === 'new') this.newComp();
    if (a === 'update' && c) this.setComps('Update layer comp', this.doc.comps.map(x => (x === c ? updateComp(c, allNodes(this.doc.root)) : x)), `"${c.name}" now keeps the layers as they look.`);
    if (a === 'export') this.exportComps();
    if (a === 'more' && c) {
      menu(b, [
        { label: 'Rename…', run: () => this.renameComp(i) },
        { label: 'Export this comp…', run: () => this.exportComps(i) },
        '-',
        { label: 'Delete', run: () => this.setComps('Delete layer comp', this.doc.comps.filter(x => x !== c), `"${c.name}" deleted. Undo (Ctrl+Z) brings it back.`) },
      ]);
    }
  },

  /**
   * apply/revert for turning the Move tool's offsets of `layers` (null: every layer) and the positions comps keep
   * for them by m (flips, quarter turns, scaling; see turnOffset), so a comp applied afterwards moves the right way.
   */
  offsetsAlong(m, layers = null) {
    const d = this.doc, list = (layers || allNodes(d.root)).filter(n => n.kind === 'layer');
    const offs = list.map(n => [n, n.offset, turnOffset(n.offset, m)]);
    const comps = d.comps, after = turnComps(comps, m, layers ? new Set(list.map(n => n.uid)) : null);
    return {
      apply: () => { for (const [n, , o] of offs) n.offset = o; d.comps = after; },
      revert: () => { for (const [n, o] of offs) n.offset = o; d.comps = comps; },
    };
  },

  /** Replaces the list of comps as one undo step (the window follows through layersChanged). */
  setComps(label, next, note = '') {
    const d = this.doc, before = d.comps;
    this.structural(label, () => { d.comps = next; }, () => { d.comps = before; });
    if (note) toast(note);
  },

  /** New: asks for a name and what to keep besides visibility (remembered in koe.compUse). */
  async newComp() {
    const d = this.doc;
    if (d.comps.length >= COMP_MAX) return toast(`An artwork keeps up to ${COMP_MAX} layer comps. Delete one first.`, { error: true });
    const names = d.comps.map(c => c.name), use = store('compUse') || {};
    const res = await modal({
      title: 'New layer comp',
      body: `
        <label class="field"><span>Name</span><input type="text" name="name" value="${esc(nextCompName(names))}" maxlength="100"></label>
        <p class="muted small">A comp always keeps which layers and folders show. It can also keep:</p>
        ${COMP_PARTS.map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}"${use[k] ? ' checked' : ''}> ${l}</label>`).join('')}
        <p class="muted small">Position is where the Move tool has put each layer. Paint moved past the edge of the canvas is cut off, as with the Move tool.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }],
      collect: root => {
        const f = n => root.querySelector(`[name="${n}"]`);
        return { name: f('name').value, use: Object.fromEntries(COMP_PARTS.map(([k]) => [k, f(k).checked])) };
      },
    });
    if (!res) return;
    store('compUse', res.use);
    const comp = captureComp(uniqueCompName(names, res.name), allNodes(d.root), res.use);
    this.compSel = d.comps.length;
    this.setComps('New layer comp', [...d.comps, comp]);
  },

  async renameComp(i) {
    const d = this.doc, c = d.comps[i];
    if (!c) return;
    const name = await promptBox('Rename layer comp', 'Name', c.name);
    if (!name || name === c.name) return;
    const others = d.comps.filter(x => x !== c).map(x => x.name);
    this.setComps('Rename layer comp', d.comps.map(x => (x === c ? { ...c, name: uniqueCompName(others, name) } : x)));
  },

  /** Shows the layers as comp i keeps them, as one undo step. */
  applyComp(i) {
    const c = this.doc.comps[i];
    if (!c) return;
    this.compSel = i;
    this.finishTransform?.();
    this.finishText?.();
    const step = this.compStep(c);
    if (!step) return this.renderCompWindow(true);
    let first = true;  // compStep has made the change already
    this.structural(`Show layer comp "${c.name}"`, () => { if (first) first = false; else step.apply(); }, () => step.revert(), () => step.bytes());
    if (step.skipped.length) toast(`Not moved (locked): ${step.skipped.map(n => n.name).join(', ')}.`);
  },

  /**
   * Makes the layers look as comp c keeps them, now, and returns {apply, revert, bytes, free, skipped}, or null when
   * nothing changes. Moves are drawn the way the Move tool draws them (a layer with its mask; text, lines and fills
   * follow); locked layers and correction layers are not moved (skipped lists the locked ones).
   */
  compStep(c) {
    const d = this.doc, full = { x: 0, y: 0, w: d.width, h: d.height };
    const { props, moves } = compChanges(c, allNodes(d.root));
    const skipped = moves.filter(m => lockedNode(m.node)).map(m => m.node);
    const ok = moves.filter(m => !m.node.adjust && !lockedNode(m.node));
    if (!props.length && !ok.length) return null;
    const olds = props.map(p => p.node[p.key]);
    const parts = [];
    for (const { node, dx, dy } of ok) {
      for (const r of [node, node.mask].filter(Boolean)) {
        const p = { r, before: this.snapshot(r, full), text: [r.text], vector: [r.vector], fill: [r.fill], offset: r === node ? [r.offset] : null };
        if (r.fill) renderFillLayer(r, mapFill(r.fill, [1, 0, 0, 1, dx, dy]));  // a fill layer stays whole
        else { r.ctx.clearRect(0, 0, d.width, d.height); drawSnapshot(r.ctx, p.before, dx, dy); }
        if (r.text) { const t = r.text, m = t.m; p.text[1] = m ? { ...t, m: [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy] } : { ...t, x: t.x + dx, y: t.y + dy }; }
        if (r.vector) p.vector[1] = translateVector(r.vector, dx, dy);
        if (r.fill) p.fill[1] = mapFill(r.fill, [1, 0, 0, 1, dx, dy]);
        if (p.offset) { const x = (r.offset?.x || 0) + dx, y = (r.offset?.y || 0) + dy; p.offset[1] = x || y ? { x, y } : null; }
        p.after = this.snapshot(r, full);
        parts.push(p);
      }
    }
    const set = k => {
      props.forEach((p, j) => { p.node[p.key] = k ? p.value : olds[j]; });
      for (const p of parts) {
        this.putSnapshot(p.r, full, k ? p.after : p.before);
        if (p.text[0]) p.r.text = p.text[k];
        if (p.vector[0]) p.r.vector = p.vector[k];
        if (p.fill[0]) p.r.fill = p.fill[k];
        if (p.offset) p.r.offset = p.offset[k];
      }
    };
    set(1);
    return {
      skipped,
      apply: () => set(1),
      revert: () => set(0),
      bytes: () => parts.reduce((n, p) => n + snapBytes(p.before) + snapBytes(p.after), 0),
      free: () => {
        for (const p of parts) for (const s of [p.before, p.after]) if (s.canvas) { s.canvas.width = s.canvas.height = 0; s.canvas = null; }
      },
    };
  },

  /** Export…: every comp (or only comp `only`) as a PNG of the whole picture, "<name>-<comp name>.png". */
  async exportComps(only = null) {
    const d = this.doc, comps = only === null ? d.comps : [d.comps[only]].filter(Boolean);
    if (!comps.length) return;
    this.finishTransform?.();
    this.finishText?.();
    let dir = store('exportDir') || '';
    const res = await modal({
      title: only === null ? 'Export layer comps' : `Export "${comps[0].name}"`,
      body: `
        <label class="field"><span>File names start with</span><input type="text" name="name" value="${esc(d.title)}" maxlength="60"></label>
        <p class="muted small">${comps.length === 1 ? 'The picture is' : `Each of the ${comps.length} comps is`} saved as a PNG of the whole canvas, named after the comp. The layers are put back as they are now afterwards.</p>
        <label class="field"><span>Save in</span>
          <div class="fb-dest"><span class="fb-path" data-dest></span><button type="button" data-browse>Browse…</button></div></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Export', primary: true }],
      onOpen: root => {
        const dest = root.querySelector('[data-dest]');
        const showDir = () => { dest.textContent = dirLabel(dir); dest.title = dirLabel(dir); };
        root.querySelector('[data-browse]').onclick = async () => {
          const pick = await browseFile({ title: 'Export to', dir, name: d.title, ext: 'png', okLabel: 'Choose' });
          if (pick) { dir = pick.dir; showDir(); }
        };
        showDir();
      },
      collect: root => root.querySelector('[name="name"]').value.trim() || d.title,
    });
    if (!res) return;
    store('exportDir', dir);
    const o = sanitizeExportOptions({ format: 'png' }), fmt = EXPORT_BY_ID.png;
    let mode = 'ask', last = null, moved = false;
    try {
      for (const c of comps) {
        // shown as the comp only while the picture is made (synchronously), then put back
        const step = this.compStep(c);
        let canvas;
        try { canvas = this.exportCanvas(o, fmt); } finally {
          if (step) { step.revert(); step.free(); moved = true; }
        }
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error(`"${c.name}" could not be made into a PNG (out of memory?)`);
        const png = new Blob([pngWithDpi(new Uint8Array(await blob.arrayBuffer()), d.dpi)], { type: 'image/png' });
        const name = `${res}-${c.name}`;
        try {
          last = await api.exportImage(name, 'png', png, { dir, mode });
        } catch (e) {
          if (!e.data?.exists) throw e;
          if (!await confirmBox('Replace files', `${name}.png already exists in ${dirLabel(dir)}. Replace it and any other comp files of the same name?`, 'Replace')) return;
          mode = 'replace';
          last = await api.exportImage(name, 'png', png, { dir, mode });
        }
      }
      if (last) toast(`Exported ${comps.length} comp${comps.length === 1 ? '' : 's'} to ${last.folder}`, { action: showFolder(last.folder), ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    } finally {
      if (moved) this.changed(null);  // the layers were drawn moved and back: thumbnails and the screen catch up
    }
  },
};
