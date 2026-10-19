// Brush ⋯ → Manage brushes…: every saved brush in its group (your own, and one per imported pack), with its sample
// stroke, as Editor methods. Pick brushes (click, Shift+click for a range, All / None for what the search shows),
// then delete them or move them to a group; drag them to put them in order or into another group; rename, reorder,
// hide or delete whole groups. Built-in groups can be hidden too. Every change is saved at once (brushes.json keeps
// the order; brushorg.js does the reordering), and tip and texture images only deleted brushes used go with them.
// Hidden groups are kept per machine in koe.hiddenBrushGroups (keys from hideKey).

import { api } from '../api.js';
import { applySettings, TOOL_BY_ID } from '../tools.js';
import { BUILTIN_BRUSHES } from '../builtinbrushes.js';
import { presetGroups, withoutPresets, moveToGroup, renameGroup, moveGroup, orphanImages, groupLabel, hideKey } from '../brushorg.js';
import { pickMatches, rangePick } from '../brushpick.js';
import { forgetBrushImage } from '../painter.js';
import { esc, toast, menu, modal, promptBox, confirmBox, store } from '../ui.js';
import { icon } from '../icons.js';

export const brushManagerMethods = {
  /** The keys of the groups left out of the Brushes window and the Brush choice. */
  hiddenBrushGroups() {
    const h = store('hiddenBrushGroups');
    return Array.isArray(h) ? h.filter(k => typeof k === 'string') : [];
  },

  setGroupHidden(key, hide) {
    const h = new Set(this.hiddenBrushGroups());
    if (hide) h.add(key); else h.delete(key);
    store('hiddenBrushGroups', [...h]);
    this.renderToolProps();
  },

  /** Replaces the saved brush list with `presets` and saves it; brushes no longer in it are dropped from the tools. */
  async setPresets(presets) {
    const ids = new Set(presets.map(p => p.id)), removed = this.brushLib.presets.filter(p => !ids.has(p.id));
    this.brushLib.presets = presets;
    for (const s of Object.values(this.settings)) if (s.preset && !s.preset.startsWith('b-') && !ids.has(s.preset)) s.preset = '';
    store('tools', this.settings);
    const ok = await this.savePresetList();
    if (ok && removed.length) {  // tip and texture pictures nothing uses any more go too
      for (const id of orphanImages(removed, presets, Object.values(this.settings))) {
        try { await api.deleteBrushImage(id); } catch { continue; }
        this.brushLib.images = this.brushLib.images.filter(i => i.id !== id);
        forgetBrushImage(id);
      }
    }
    this.renderToolProps();
    return ok;
  },

  async manageBrushes() {
    const picked = new Set(), thumbs = new Map();  // thumbs: preset id + settings -> drawn stroke
    let query = '', last = null, dragIds = null, observer = null, raf = 0, root = null;
    const s0 = this.settings[this.tool], look = p => applySettings({ ...('tip' in s0 ? s0 : TOOL_BY_ID.brush.defaults) }, p.settings);
    const all = () => this.brushLib.presets;

    const card = p => `<button type="button" class="imp-card bm-card${picked.has(p.id) ? ' on' : ''}" data-id="${esc(p.id)}" draggable="true"
      title="${esc(p.name)}. Double-click to rename, drag to move"><canvas></canvas><span class="imp-name">${esc(p.name)}</span><i class="imp-tick">${icon('check', 12)}</i></button>`;
    const render = () => {
      const list = root.querySelector('.bm-list'), top = list.scrollTop, hidden = new Set(this.hiddenBrushGroups());
      const names = all().map(p => `${p.name} ${groupLabel(p.source || '')}`), shown = new Set(pickMatches(names, query).map(i => all()[i].id));
      const groups = presetGroups(all());
      list.innerHTML = groups.map((g, gi) => {
        const vis = g.presets.filter(p => shown.has(p.id)), key = hideKey(g.name), off = hidden.has(key);
        if (!vis.length) return '';
        return `<section class="bm-group${off ? ' off' : ''}" data-g="${esc(g.name)}">
          <header class="bm-head"><b>${esc(groupLabel(g.name))}</b><span class="muted small">${g.presets.length}</span>
            <span class="bm-tools">
              <button type="button" class="icon-btn" data-gact="pick" title="Pick every brush in this group">All</button>
              <button type="button" class="icon-btn" data-gact="hide" title="${off ? 'Hidden from the Brushes window and the Brush row: click to show it' : 'Shown in the Brushes window and the Brush row: click to hide it'}">${icon(off ? 'eyeOff' : 'eye', 15)}</button>
              <button type="button" class="icon-btn" data-gact="up" title="Move the group up"${gi ? '' : ' disabled'}>↑</button>
              <button type="button" class="icon-btn" data-gact="down" title="Move the group down"${gi < groups.length - 1 ? '' : ' disabled'}>↓</button>
              <button type="button" class="icon-btn" data-gact="rename" title="Rename the group">${icon('pen', 14)}</button>
              <button type="button" class="icon-btn" data-gact="delete" title="Delete the group and its brushes">${icon('trash', 14)}</button>
            </span></header>
          <div class="imp-grid bm-grid">${vis.map(card).join('')}</div></section>`;
      }).join('') || `<p class="muted small bm-empty">${all().length ? 'No brush or group has that name.' : 'No saved brushes yet. Save one from the Brush ⋯ menu, or import a brush pack.'}</p>`;
      list.scrollTop = top;
      update();
      watch();
    };
    const shownIds = () => [...root.querySelectorAll('.bm-card')].map(c => c.dataset.id);
    const update = () => {
      for (const id of picked) if (!all().some(p => p.id === id)) picked.delete(id);
      root.querySelectorAll('.bm-card').forEach(c => c.classList.toggle('on', picked.has(c.dataset.id)));
      root.querySelector('.imp-count').textContent = `${picked.size} picked`;
      root.querySelectorAll('[data-bm]').forEach(b => { b.disabled = !picked.size; });
    };
    // strokes for the cards in view, a few per frame, kept while the window is open
    const watch = () => {
      observer?.disconnect();
      const todo = new Set(), grid = root.querySelector('.bm-list');
      const draw = () => {
        const t0 = performance.now();
        for (const c of todo) {
          if (performance.now() - t0 > 12) break;
          todo.delete(c);
          const p = this.presetById(c.dataset.id), cv = c.querySelector('canvas'), dpr = window.devicePixelRatio || 1;
          if (!p || !cv.clientWidth) continue;
          const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr), st = look(p), key = `${p.id}|${w}x${h}|${JSON.stringify(st)}`;
          if (!thumbs.has(key)) {
            const pic = document.createElement('canvas');
            pic.width = w; pic.height = h;
            this.paintPreviewStroke(pic, st, 0.32);
            thumbs.set(key, pic);
          }
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(thumbs.get(key), 0, 0);
        }
        raf = todo.size && root.isConnected ? requestAnimationFrame(draw) : 0;
      };
      observer = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) { todo.add(e.target); observer.unobserve(e.target); }
        if (todo.size && !raf) raf = requestAnimationFrame(draw);
      }, { root: grid, rootMargin: '160px' });
      root.querySelectorAll('.bm-card').forEach(c => observer.observe(c));
    };
    const change = async presets => { if (await this.setPresets(presets)) render(); };
    const groupAt = el => el.closest('[data-g]')?.dataset.g;

    const deletePicked = async () => {
      const n = picked.size;
      if (!n || !(await confirmBox('Delete brushes', `Delete ${n === 1 ? `“${this.presetById([...picked][0])?.name}”` : `${n} brushes`}? This cannot be undone.`, 'Delete'))) return;
      await change(withoutPresets(all(), [...picked]));
      toast(n === 1 ? 'Deleted 1 brush' : `Deleted ${n} brushes`);
    };
    const askGroup = async () => {
      const name = (await promptBox('New group', 'Name'))?.trim();
      return name ? (name === groupLabel('') ? '' : name) : null;
    };
    const moveMenu = btn => {
      const ids = all().filter(p => picked.has(p.id)).map(p => p.id);
      menu(btn, [...presetGroups(all()).map(g => ({ label: groupLabel(g.name), run: () => change(moveToGroup(all(), ids, g.name)) })),
        ...(all().some(p => !p.source) ? [] : [{ label: groupLabel(''), run: () => change(moveToGroup(all(), ids, '')) }]),
        '-', { label: 'New group…', run: async () => { const g = await askGroup(); if (g !== null) change(moveToGroup(all(), ids, g)); } }]);
    };
    const groupAction = async (act, g) => {
      const groups = presetGroups(all()), i = groups.findIndex(x => x.name === g), ids = groups[i]?.presets.map(p => p.id) || [];
      if (act === 'pick') { ids.forEach(id => picked.add(id)); update(); }
      else if (act === 'hide') { this.setGroupHidden(hideKey(g), !this.hiddenBrushGroups().includes(hideKey(g))); render(); }
      else if (act === 'up' && i > 0) change(moveGroup(all(), g, groups[i - 1].name));
      else if (act === 'down' && i < groups.length - 1) change(moveGroup(all(), g, groups[i + 2]?.name ?? null));
      else if (act === 'rename') {
        let name = (await promptBox('Rename group', 'Name', groupLabel(g)))?.trim();
        if (!name) return;
        if (name === groupLabel('')) name = '';
        const hidden = this.hiddenBrushGroups().includes(hideKey(g));
        await change(renameGroup(all(), g, name));
        if (hidden) { this.setGroupHidden(hideKey(g), false); this.setGroupHidden(hideKey(name), true); render(); }
      } else if (act === 'delete') {
        if (!(await confirmBox('Delete group', `Delete “${groupLabel(g)}” and its ${ids.length} brush${ids.length === 1 ? '' : 'es'}? This cannot be undone.`, 'Delete'))) return;
        await change(withoutPresets(all(), ids));
        this.setGroupHidden(hideKey(g), false);
      }
    };

    const builtinGroups = [...new Set(BUILTIN_BRUSHES.map(b => b.group))];
    await modal({
      title: 'Manage brushes',
      wide: true,
      body: `<div class="imp bm">
        <div class="imp-bar"><input type="search" class="imp-search" placeholder="Search brushes and groups" aria-label="Search brushes" spellcheck="false" data-own-enter>
          <button type="button" data-sel="all" title="Pick every brush shown">All</button><button type="button" data-sel="none" title="Pick none">None</button>
          <span class="imp-count muted small"></span>
          <span class="bm-acts"><button type="button" data-bm="move" title="Put the picked brushes in another group, or a new one">Move to group ▾</button>
          <button type="button" data-bm="delete" class="bm-del" title="Delete the picked brushes">${icon('trash', 14)} Delete</button></span></div>
        <div class="bm-list"></div>
        <details class="bm-builtin"><summary>Built-in brushes</summary><div class="bm-chips">${builtinGroups.map(g =>
          `<label class="check"><input type="checkbox" data-bg="${esc(g)}"> ${esc(g)}</label>`).join('')}</div>
          <p class="muted small">Untick a group to hide it from the Brushes window and the Brush row. Built-in brushes cannot be deleted.</p></details>
        <p class="muted small">Click brushes to pick them (Shift+click for a range), then move or delete them. Drag brushes to put them in order or into another group. Double-click a brush to rename it.</p>
      </div>`,
      buttons: [{ label: 'Close', value: null, primary: true }],
      onOpen: back => {
        root = back;
        const search = root.querySelector('.imp-search'), list = root.querySelector('.bm-list');
        search.oninput = () => { query = search.value; render(); };
        root.querySelector('[data-sel="all"]').onclick = () => { shownIds().forEach(id => picked.add(id)); update(); };
        root.querySelector('[data-sel="none"]').onclick = () => { picked.clear(); update(); };
        root.querySelector('[data-bm="delete"]').onclick = deletePicked;
        root.querySelector('[data-bm="move"]').onclick = e => moveMenu(e.currentTarget);
        list.onclick = e => {
          const b = e.target.closest('[data-gact]');
          if (b) { groupAction(b.dataset.gact, groupAt(b)); return; }
          const c = e.target.closest('.bm-card');
          if (!c) return;
          const id = c.dataset.id, on = !picked.has(id);
          for (const k of e.shiftKey ? rangePick(shownIds(), last, id) : [id]) on ? picked.add(k) : picked.delete(k);
          last = id;
          update();
        };
        list.ondblclick = async e => {
          const c = e.target.closest('.bm-card'), p = c && this.presetById(c.dataset.id);
          if (!p) return;
          const name = (await promptBox('Rename brush', 'Name', p.name))?.trim();
          if (name) change(all().map(x => (x.id === p.id ? { ...x, name } : x)));
        };
        list.onkeydown = e => { if (e.key === 'Delete' && picked.size) { e.preventDefault(); deletePicked(); } };
        // dragging: a picked brush takes every picked brush along; drop on a brush to go before it, on a group to go last
        list.ondragstart = e => {
          const c = e.target.closest('.bm-card');
          if (!c) return;
          dragIds = picked.has(c.dataset.id) ? all().filter(p => picked.has(p.id)).map(p => p.id) : [c.dataset.id];
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', dragIds.join(','));
        };
        const clearMark = () => root.querySelectorAll('.drop-before, .drop-into').forEach(x => x.classList.remove('drop-before', 'drop-into'));
        list.ondragover = e => {
          if (!dragIds || !groupAt(e.target) && groupAt(e.target) !== '') return;
          e.preventDefault();
          clearMark();
          const c = e.target.closest('.bm-card');
          (c && !dragIds.includes(c.dataset.id) ? c : e.target.closest('.bm-group'))?.classList.add(c && !dragIds.includes(c.dataset.id) ? 'drop-before' : 'drop-into');
        };
        list.ondragleave = e => { if (!list.contains(e.relatedTarget)) clearMark(); };
        list.ondrop = e => {
          e.preventDefault();
          clearMark();
          const g = groupAt(e.target), c = e.target.closest('.bm-card'), ids = dragIds;
          dragIds = null;
          if (!ids || g === undefined) return;
          change(moveToGroup(all(), ids, g, c && !ids.includes(c.dataset.id) ? c.dataset.id : null));
        };
        list.ondragend = () => { dragIds = null; clearMark(); };
        const hidden = new Set(this.hiddenBrushGroups());
        root.querySelectorAll('[data-bg]').forEach(b => {
          b.checked = !hidden.has(hideKey(b.dataset.bg, true));
          b.onchange = () => this.setGroupHidden(hideKey(b.dataset.bg, true), !b.checked);
        });
        render();
      },
    });
    observer?.disconnect();
    cancelAnimationFrame(raf);
  },
};
