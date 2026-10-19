// The Auto actions window (Window-like floating panel, View → Auto actions), as Clip Studio Paint's Auto actions:
// Record, then use menus, shortcut commands and the Layers panel; every step (with the values typed into its
// dialogs) is kept, and ▶ plays them all again. Steps and their shapes are in autoactions.js; the lists are kept in
// koe.actions, the window's place in koe.actWin = {open, x, y}.
// Recording: menu items are wrapped by recordable(), keyboard commands go through recordStep in onKey, and the
// Layers panel's methods (RECORD_CALLS, setPickedProp) are wrapped per editor by initActions(). recordStep keeps
// only the outermost step (a menu item that calls layerAdd is one step) and listens to modalHooks for its dialogs.
// Playback fills each recorded dialog in through modalHooks.fill and presses OK, unless the step says Show dialog.
// Editor methods (mixed into Editor.prototype in editor.js).

import {
  sanitizeActions, defaultActions, stepLabel, addStep, findMenuItem, dialogValues, fieldFor,
  RECORD_MENUS, SKIP_ITEMS, RECORD_CALLS, PROP_KEYS,
} from '../autoactions.js';
import { icon } from '../icons.js';
import { esc, menu, modalHooks, promptBox, confirmBox, store, toast } from '../ui.js';

const fieldsOf = back => [...back.querySelectorAll('.modal-body input, .modal-body select, .modal-body textarea')];
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const dialogOpen = () => !!document.querySelector('.modal-back');
/** Resolves once res (a step's result) has settled and no dialog it opened is still up. */
async function settled(res) {
  await res;
  await frame();
  while (dialogOpen()) await frame();
}

export const actionMethods = {
  /** Wraps the Layers panel's methods so their use is recorded (once per editor, from the constructor). */
  initActions() {
    this.actions = sanitizeActions(store('actions'));
    this.actSel = 0;
    this.actOpen = new Set();
    this.rec = null;
    this.recDepth = 0;
    for (const name of Object.keys(RECORD_CALLS)) {
      const orig = this[name];
      this[name] = (...args) => this.recordStep({ kind: 'call', name, args: args.filter(a => typeof a === 'number' || typeof a === 'boolean') }, () => orig.apply(this, args));
    }
    const setProp = this.setPickedProp;
    this.setPickedProp = (key, value, label) => (PROP_KEYS.includes(key)
      ? this.recordStep({ kind: 'prop', key, value, label }, () => setProp.call(this, key, value, label))
      : setProp.call(this, key, value, label));
  },

  actionList() { return this.actions.sets[this.actions.set]?.actions || []; },

  saveActions() {
    store('actions', this.actions);
    this.renderActionWindow(true);
  },

  /** Menu items with their runs recorded (menus in RECORD_MENUS; SKIP_ITEMS run as they are). */
  recordable(menuName, items, path = []) {
    if (!RECORD_MENUS.includes(menuName) || !items) return items;
    return items.map(it => {
      if (it === '-' || SKIP_ITEMS.has(it.label)) return it;
      const p = [...path, it.rec || it.label];
      if (it.sub) return { ...it, sub: this.recordable(menuName, it.sub, p) };
      return { ...it, run: () => this.recordStep({ kind: 'menu', menu: menuName, path: p }, it.run) };
    });
  },

  /**
   * Runs `run` and, while recording, keeps `step` (with the values of the dialogs it opened) unless a dialog was
   * cancelled. Only the outermost step counts; during playback nothing is recorded.
   */
  recordStep(step, run) {
    if (!this.rec || this.recDepth || this.actPlaying) return run();
    this.recDepth++;
    const dialogs = [];
    let cancelled = false;
    modalHooks.onClose = (back, ok) => { if (ok) dialogs.push(dialogValues(fieldsOf(back))); else cancelled = true; };
    this.recStep = step;
    const end = () => {
      this.recDepth--;
      modalHooks.onClose = null;
      this.recStep = null;
      if (cancelled || !this.rec) return;
      if (dialogs.length) step.dialogs = dialogs;
      this.rec.steps = addStep(this.rec.steps, step);
      const a = this.actionList()[this.rec.index];
      if (a) { a.steps = this.rec.steps; this.actOpen.add(this.rec.index); this.saveActions(); }
    };
    let res;
    try { res = run(); } catch (e) { end(); throw e; }
    // a step that opened a dialog without handing back its promise is still waited for
    if ((res && typeof res.then === 'function') || dialogOpen()) return settled(res).finally(end);
    end();
    return res;
  },

  /** Starts recording into action i (its steps are added to), or stops. */
  toggleRecording(i = this.actSel) {
    if (this.rec) {
      const n = this.rec.steps.length - this.rec.from;
      this.rec = null;
      toast(n ? `Recorded ${n} step${n === 1 ? '' : 's'}.` : 'Nothing was recorded: menus, shortcut commands and the Layers panel are recorded, painting is not.');
      return this.renderActionWindow(true);
    }
    if (this.actPlaying) return;
    const a = this.actionList()[i];
    if (!a) return this.newAction();
    this.actSel = i;
    this.rec = { index: i, steps: a.steps, from: a.steps.length };
    toast(`Recording “${a.name}”: use the menus, shortcut commands and the Layers panel, then press Stop.`, { ms: 6000 });
    this.renderActionWindow(true);
  },

  async newAction() {
    if (this.rec) this.toggleRecording();
    const list = this.actionList();
    if (!this.actions.sets.length) return;
    const name = await promptBox('New auto action', 'Name', `Action ${list.length + 1}`);
    if (!name) return;
    list.push({ name, steps: [] });
    this.saveActions();
    this.toggleRecording(list.length - 1);
  },

  /** Plays every step of an action in turn; stops at the first one that cannot run now. */
  async playAction(i) {
    const a = this.actionList()[i];
    if (!a || this.actPlaying) return;
    if (this.rec) return toast('Stop recording first.');
    if (!a.steps.length) return toast('This action has no steps yet: press Record and do what it should do.');
    this.finishTransform();
    this.finishText();
    this.actPlaying = { index: i };
    this.renderActionWindow(true);
    try {
      for (let k = 0; k < a.steps.length; k++) {
        const err = await this.playStep(a.steps[k]);
        if (err) { toast(`“${a.name}” stopped at step ${k + 1} (${stepLabel(a.steps[k])}): ${err}.`, { error: true, ms: 8000 }); break; }
        await frame();
      }
    } finally {
      this.actPlaying = null;
      this.renderActionWindow(true);
    }
  },

  /** Runs one step, filling in its dialogs; resolves to an error message, or null when it ran. */
  async playStep(s) {
    const queue = [...(s.dialogs || [])];
    modalHooks.fill = back => {
      const vals = queue.shift();
      if (!vals) return false;
      const fields = fieldsOf(back);
      for (const [k, v] of vals) {
        const f = fieldFor(fields, k);
        if (!f) continue;
        if (typeof v === 'boolean') f.checked = v; else f.value = v;
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return !s.show;
    };
    this.playStepNow = s;
    try {
      if (s.kind === 'menu') {
        const { item, error } = findMenuItem(this.menuItems(s.menu), s.path);
        if (error) return error;
        await settled(item.run());
      } else if (s.kind === 'cmd') await settled(this.commandActs()[s.id]?.());
      else if (s.kind === 'call') await settled(this[s.name](...s.args));
      else await settled(this.setPickedProp(s.key, s.value, s.label));
    } catch (e) {
      return e.message || String(e);
    } finally {
      modalHooks.fill = null;
      this.playStepNow = null;
    }
    return null;
  },

  // ---------- the window ----------

  actState() {
    const st = store('actWin') || {};
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    return { open: !!st.open, x: num(st.x, window.innerWidth - 640), y: num(st.y, 120) };
  },

  toggleActionWindow(open = !this.actState().open) {
    store('actWin', { ...this.actState(), open });
    this.renderActionWindow();
  },

  /** Opens or closes the window to match the remembered state; redraw = refresh its contents. */
  renderActionWindow(redraw = false) {
    const st = this.actState();
    if (!st.open || this.destroyed) { this.actWin?.remove(); this.actWin = null; return; }
    if (this.actWin && !redraw) return;
    let w = this.actWin;
    if (!w) {
      w = this.actWin = document.createElement('div');
      w.className = 'brush-win act-win';
      w.setAttribute('role', 'dialog');
      this.root.append(w);
    }
    const list = this.actionList(), sets = this.actions.sets, rec = this.rec, playing = this.actPlaying;
    w.innerHTML = `<div class="bw-head"><span class="bw-title">${rec ? '<i class="act-dot"></i> Recording…' : 'Auto actions'}</span>
        <button class="icon-btn" data-a="close" title="Close">✕</button></div>
      <div class="act-bar"><select data-a="set" title="Action set">${sets.map((s, i) => `<option value="${i}"${i === this.actions.set ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <button class="icon-btn" data-a="setmenu" title="Sets: new, rename, delete">⋯</button></div>
      <div class="act-list">${list.length ? list.map((a, i) => `
        <div class="act-row${i === this.actSel ? ' on' : ''}${rec?.index === i ? ' rec' : ''}" data-i="${i}">
          <button class="act-fold" data-a="fold" title="Show the steps">${this.actOpen.has(i) ? '▾' : '▸'}</button>
          <span class="act-name" title="Double-click to play">${esc(a.name)}</span><span class="muted small">${a.steps.length}</span>
          <button class="icon-btn" data-a="play" title="Play"${playing || rec ? ' disabled' : ''}>${playing?.index === i ? '…' : '▶'}</button>
        </div>${this.actOpen.has(i) ? `<ol class="act-steps">${a.steps.map((s, k) => `<li data-k="${k}"><span>${esc(stepLabel(s))}</span>
          ${s.dialogs ? `<label class="act-show" title="Open the dialog on playback, to change the values"><input type="checkbox" data-a="show"${s.show ? ' checked' : ''}> dialog</label>` : ''}
          <button class="icon-btn" data-a="stepdel" title="Remove this step">✕</button></li>`).join('') || '<li class="muted small">No steps yet.</li>'}</ol>` : ''}`).join('')
        : '<p class="muted small act-empty">No actions in this set. Press + to record one.</p>'}</div>
      <div class="act-foot">
        <button data-a="new" title="Name a new action and start recording it">${icon('plus', 14)} New</button>
        <button data-a="rec" class="${rec ? 'on' : ''}"${list.length || rec ? '' : ' disabled'} title="${rec ? 'Stop recording' : 'Record more steps into the selected action'}">${rec ? '■ Stop' : '● Record'}</button>
        <button class="icon-btn" data-a="actmenu" title="Rename, duplicate, move or delete the selected action"${list[this.actSel] ? '' : ' disabled'}>⋯</button>
      </div>`;
    this.placeFloating(w, st.x, st.y);
    if (!w.dataset.bound) {
      w.dataset.bound = '1';
      this.bindFloatingHead(w, (x, y) => store('actWin', { ...this.actState(), x, y }));
      w.addEventListener('click', e => this.onActionClick(e));
      w.addEventListener('dblclick', e => { const row = e.target.closest('.act-name'); if (row) this.playAction(+row.parentElement.dataset.i); });
      w.addEventListener('change', e => {
        const a = e.target.dataset.a;
        if (a === 'set') { this.actions.set = +e.target.value; this.actSel = 0; this.actOpen.clear(); this.saveActions(); }
        if (a === 'show') {
          const i = +e.target.closest('.act-steps').previousElementSibling.dataset.i, k = +e.target.closest('li').dataset.k;
          const s = this.actionList()[i]?.steps[k];
          if (s) { if (e.target.checked) s.show = true; else delete s.show; store('actions', this.actions); }
        }
      });
    }
  },

  onActionClick(e) {
    const b = e.target.closest('[data-a]'), a = b?.dataset.a;
    const row = e.target.closest('.act-row');
    const i = row ? +row.dataset.i : this.actSel;
    if (row && a !== 'play' && i !== this.actSel && !this.rec) { this.actSel = i; if (!a) return this.renderActionWindow(true); }
    if (!a) return;
    const list = this.actionList();
    const acts = {
      close: () => this.toggleActionWindow(false),
      fold: () => { this.actOpen.has(i) ? this.actOpen.delete(i) : this.actOpen.add(i); this.renderActionWindow(true); },
      play: () => this.playAction(i),
      rec: () => this.toggleRecording(),
      new: () => this.newAction(),
      stepdel: () => {
        const si = +b.closest('.act-steps').previousElementSibling.dataset.i, k = +b.closest('li').dataset.k;
        list[si]?.steps.splice(k, 1);
        this.saveActions();
      },
      actmenu: () => menu(b, this.actionMenu(i)),
      setmenu: () => menu(b, this.setMenu()),
    };
    acts[a]?.();
  },

  actionMenu(i) {
    const list = this.actionList(), a = list[i], busy = !!this.rec || !!this.actPlaying;
    const move = d => { const j = i + d; [list[i], list[j]] = [list[j], list[i]]; this.actSel = j; this.actOpen.clear(); this.saveActions(); };
    return [
      { label: 'Rename…', disabled: busy, run: async () => { const n = await promptBox('Rename action', 'Name', a.name); if (n) { a.name = n; this.saveActions(); } } },
      { label: 'Duplicate', disabled: busy, run: () => { list.splice(i + 1, 0, { ...structuredClone(a), name: a.name + ' copy' }); this.saveActions(); } },
      { label: 'Move up', disabled: busy || i === 0, run: () => move(-1) },
      { label: 'Move down', disabled: busy || i === list.length - 1, run: () => move(1) },
      '-',
      { label: 'Delete…', disabled: busy, run: async () => {
        if (!await confirmBox('Delete action', `Delete “${a.name}” and its ${a.steps.length} steps?`, 'Delete')) return;
        list.splice(i, 1); this.actSel = Math.max(0, i - 1); this.actOpen.clear(); this.saveActions();
      } },
    ];
  },

  setMenu() {
    const sets = this.actions.sets, set = sets[this.actions.set], busy = !!this.rec || !!this.actPlaying;
    return [
      { label: 'New set…', disabled: busy, run: async () => {
        const n = await promptBox('New action set', 'Name', `Set ${sets.length + 1}`);
        if (n) { sets.push({ name: n, actions: [] }); this.actions.set = sets.length - 1; this.actSel = 0; this.actOpen.clear(); this.saveActions(); }
      } },
      { label: 'Rename set…', disabled: busy || !set, run: async () => { const n = await promptBox('Rename set', 'Name', set.name); if (n) { set.name = n; this.saveActions(); } } },
      { label: 'Delete set…', disabled: busy || !set, run: async () => {
        if (!await confirmBox('Delete set', `Delete the set “${set.name}” with its ${set.actions.length} actions?`, 'Delete')) return;
        sets.splice(this.actions.set, 1);
        if (!sets.length) sets.push({ name: 'Set 1', actions: [] });
        this.actions.set = 0; this.actSel = 0; this.actOpen.clear(); this.saveActions();
      } },
      '-',
      { label: 'Add the built-in set again', disabled: busy, run: () => {
        sets.push(...defaultActions().sets); this.actions.set = sets.length - 1; this.actSel = 0; this.actOpen.clear(); this.saveActions();
      } },
    ];
  },
};
