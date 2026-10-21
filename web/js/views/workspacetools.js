// Arranging the workspace (workspace.js holds the pure part): the side panels can be dragged by their heading to the
// other side, to another place in a side, or out over the canvas area as floating windows (resized by their corner);
// right-clicking a heading offers the same. View → Workspace saves the arrangement under a name and switches
// between saved ones. The radial menu (right-click on the canvas with any tool but Move, or its shortcut) shows
// eight tools or commands round the pointer; Settings → Radial menu… picks them.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor. Every editor (one per open
// artwork) builds its own panels; the layout lives in `store`, so resume() applies it again.

import { TOOLS, TOOL_BY_ID } from '../tools.js';
import { COMMANDS } from '../shortcuts.js';
import { icon } from '../icons.js';
import { DEFAULT_LAYOUT, sanitizeLayout, movePanel, foldPanel, dockIndex, clampFloat, panelPlace, sanitizeWorkspaces, saveWorkspace,
  RADIAL_SLOTS, DEFAULT_RADIAL, sanitizeRadial, radialSlot, radialSpot } from '../workspace.js';
import { esc, menu, modal, promptBox, store, toast } from '../ui.js';

const DRAG_PX = 6;          // a heading moved this far is dragged, not clicked
const RADIAL_R = 92, RADIAL_INNER = 30, RADIAL_BTN = 52;  // px: ring radius, centre (cancel) radius, slot size
/** Icons for commands that have one (others show their name); tools show their tool bar icon. */
const COMMAND_ICONS = { undo: 'undo', redo: 'redo', swapColors: 'swap', fit: 'fit', rotateLeft: 'rotL', rotateRight: 'rotR', mirrorView: 'flip',
  deselect: 'deselect', invertSelection: 'invert', transform: 'transform', sizeDown: 'sizeDown', sizeUp: 'sizeUp', newLayer: 'plus',
  grid: 'grid', snap: 'magnet', guides: 'ruler', quickMask: 'mask', zoomIn: 'plus', zoomOut: 'minus', clear: 'trash', layerCopy: 'copy' };

/** Every tool and command the radial menu can hold: [id, label, group]. */
export function radialChoices() {
  return [...TOOLS.map(t => [`tool:${t.id}`, t.label, 'Tools']), ...COMMANDS.filter(c => c[0] !== 'radialMenu').map(([id, group, label]) => [id, label, group])];
}

export const workspaceMethods = {
  // ---------- panels ----------

  /** The layout in use (from `koe.workspace`; the old `koe.folded` fills in folded panels the first time). */
  readLayout() { return sanitizeLayout(store('workspace'), store('folded')); },

  /** Keeps a new layout (for every open artwork) and arranges this editor's panels by it. */
  setLayout(layout) {
    store('workspace', layout);
    this.applyLayout();
  },

  /** Wires up the panel headings (fold on click, drag to move, right-click for the panel menu) and arranges them. */
  initWorkspace() {
    this.floatWraps = {};
    this.root.querySelectorAll('[data-panel]').forEach(sec => {
      const id = sec.dataset.panel, head = sec.querySelector('.panel-head');
      head.onclick = () => {
        if (this.panelDragged) return;
        const l = this.readLayout();
        this.setLayout(foldPanel(l, id, !l.folded[id]));
      };
      head.addEventListener('pointerdown', e => this.panelHeadDown(e, id));
      head.addEventListener('contextmenu', e => { e.preventDefault(); this.panelMenu(id, e); });
    });
    this.applyLayout();
  },

  /** Puts every panel where the layout says: in a side (in order), or in its own floating window. */
  applyLayout() {
    const L = this.readLayout(), $ = s => this.root.querySelector(s), body = $('.ed-body');
    const docks = { left: $('.ed-left'), right: $('.ed-side') }, panel = id => $(`[data-panel="${id}"]`);
    for (const side of ['left', 'right']) {
      for (const id of L[side]) docks[side].append(panel(id));
      docks[side].classList.toggle('empty', !L[side].length);
    }
    const W = body.clientWidth, H = body.clientHeight;
    for (const [id, wrap] of Object.entries(this.floatWraps)) if (!L.float[id]) { wrap.remove(); delete this.floatWraps[id]; }
    for (const [id, f] of Object.entries(L.float)) {
      let wrap = this.floatWraps[id];
      if (!wrap) {
        wrap = this.floatWraps[id] = document.createElement('div');
        wrap.className = 'float-panel';
        wrap.dataset.float = id;
        body.append(wrap);
        // its size, when dragged by the corner, is kept (shortly after the last change)
        new ResizeObserver(() => {
          if (!wrap.isConnected || wrap.classList.contains('folded') || this.panelDrag) return;
          clearTimeout(wrap.sizeTimer);
          wrap.sizeTimer = setTimeout(() => this.keepFloatSize(id, wrap), 200);
        }).observe(wrap);
      }
      if (wrap.firstElementChild !== panel(id)) wrap.append(panel(id));
      const c = W && H ? clampFloat(f, W, H) : f;  // a hidden editor has no size yet: placed when shown
      Object.assign(wrap.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: L.folded[id] ? '' : c.h + 'px' });
      wrap.classList.toggle('folded', !!L.folded[id]);
    }
    for (const id of [...L.left, ...L.right, ...Object.keys(L.float)]) panel(id).classList.toggle('folded', !!L.folded[id]);
    this.navStale = true;
    this.scheduleNav?.();
  },

  /** A floating panel resized by its corner: its new size goes into the layout (without arranging again). */
  keepFloatSize(id, wrap) {
    const L = this.readLayout(), f = L.float[id];
    if (!f || !wrap.isConnected) return;
    const w = Math.round(wrap.offsetWidth), h = Math.round(wrap.offsetHeight);
    if (!w || !h || (w === f.w && h === f.h)) return;  // 0 x 0: hidden (Tab, or another artwork's tab shown), not resized
    store('workspace', movePanel(L, id, { float: { ...f, w, h } }));
  },

  /** A panel heading went down: a drag past DRAG_PX tears the panel off (or moves its floating window). */
  panelHeadDown(e, id) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY }, head = e.currentTarget;
    const move = ev => {
      if (ev.pointerId !== e.pointerId) return;
      if (!this.panelDrag) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
        try { head.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
        this.beginPanelDrag(id, start);
      }
      this.panelDragMove(ev);
    };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!this.panelDrag) return;
      this.endPanelDrag(ev);
      this.panelDragged = true;  // the click that follows does not fold it
      setTimeout(() => { this.panelDragged = false; });
    };
    // on the window: a pointer let go off the heading must still end it, or hovering the heading later would drag
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  },

  /** Starts dragging panel id: a docked one becomes a floating window under the pointer first. */
  beginPanelDrag(id, start) {
    const body = this.root.querySelector('.ed-body'), b = body.getBoundingClientRect();
    let L = this.readLayout();
    if (panelPlace(L, id) !== 'float') {
      const r = this.root.querySelector(`[data-panel="${id}"]`).getBoundingClientRect();
      L = movePanel(L, id, { float: { x: r.left - b.left, y: r.top - b.top, w: Math.max(220, Math.round(r.width)), h: Math.min(Math.max(160, Math.round(r.height)), 440) } });
      this.setLayout(L);
    }
    const f = L.float[id];
    this.panelDrag = { id, dx: start.x - b.left - f.x, dy: start.y - b.top - f.y, f: { ...f }, drop: null };
    body.classList.add('docking');
    if (!this.dockMark) { this.dockMark = document.createElement('div'); this.dockMark.className = 'dock-mark'; }
    body.append(this.dockMark);
  },

  /** Moves the dragged window with the pointer and shows where it would dock (a line in a side), if over one. */
  panelDragMove(ev) {
    const g = this.panelDrag, body = this.root.querySelector('.ed-body'), b = body.getBoundingClientRect();
    g.f.x = Math.round(ev.clientX - b.left - g.dx);
    g.f.y = Math.round(ev.clientY - b.top - g.dy);
    Object.assign(this.floatWraps[g.id].style, { left: g.f.x + 'px', top: g.f.y + 'px' });
    g.drop = null;
    const mark = this.dockMark;
    mark.hidden = true;
    for (const [side, sel] of [['left', '.ed-left'], ['right', '.ed-side']]) {
      const dock = this.root.querySelector(sel), r = dock.getBoundingClientRect();
      dock.classList.remove('drop-here');
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) continue;
      const secs = [...dock.querySelectorAll(':scope > [data-panel]')], rects = secs.map(s => s.getBoundingClientRect());
      const index = dockIndex(rects.map(q => (q.top + q.bottom) / 2), ev.clientY);
      const y = rects.length ? (index < rects.length ? rects[index].top : rects[rects.length - 1].bottom) : r.top + 4;
      g.drop = { dock: side, index };
      dock.classList.add('drop-here');
      Object.assign(mark.style, { left: r.left - b.left + 'px', top: y - b.top - 2 + 'px', width: r.width + 'px' });
      mark.hidden = false;
    }
  },

  endPanelDrag() {
    const g = this.panelDrag, body = this.root.querySelector('.ed-body');
    this.panelDrag = null;
    body.classList.remove('docking');
    this.root.querySelectorAll('.drop-here').forEach(d => d.classList.remove('drop-here'));
    this.dockMark?.remove();
    const wrap = this.floatWraps[g.id];
    if (wrap) g.f = { ...g.f, w: wrap.offsetWidth || g.f.w, h: wrap.classList.contains('folded') ? g.f.h : wrap.offsetHeight || g.f.h };
    this.setLayout(movePanel(this.readLayout(), g.id, g.drop || { float: clampFloat(g.f, body.clientWidth, body.clientHeight) }));
  },

  /** Right-click on a panel heading: dock it on either side, float it, fold it, or reset the workspace. */
  panelMenu(id, e) {
    const L = this.readLayout(), place = panelPlace(L, id), body = this.root.querySelector('.ed-body');
    const float = () => {
      const r = this.root.querySelector(`[data-panel="${id}"]`).getBoundingClientRect(), b = body.getBoundingClientRect();
      const f = { x: Math.round((b.width - 260) / 2), y: Math.round(Math.max(20, r.top - b.top)), w: 260, h: Math.min(Math.max(160, Math.round(r.height)), 440) };
      this.setLayout(movePanel(L, id, { float: clampFloat(f, body.clientWidth, body.clientHeight) }));
    };
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
    menu(anchor, [
      { label: 'Dock on the left', checked: place === 'left', run: () => this.setLayout(movePanel(L, id, { dock: 'left' })) },
      { label: 'Dock on the right', checked: place === 'right', run: () => this.setLayout(movePanel(L, id, { dock: 'right' })) },
      { label: 'Floating window', checked: place === 'float', run: float },
      { label: 'Folded', checked: !!L.folded[id], run: () => this.setLayout(foldPanel(L, id, !L.folded[id])) },
      '-',
      { label: 'Reset the workspace', run: () => this.setLayout(sanitizeLayout(DEFAULT_LAYOUT)) },
    ]);
  },

  // ---------- saved workspaces ----------

  /** View → Workspace: the saved arrangements, Save…, Delete and Reset. */
  workspaceMenu() {
    const list = sanitizeWorkspaces(store('workspaces')), now = JSON.stringify(this.readLayout());
    return [
      ...list.map(w => ({ label: w.name, checked: JSON.stringify(w.layout) === now, run: () => this.setLayout(w.layout) })),
      ...(list.length ? ['-'] : []),
      { label: 'Save workspace…', run: () => this.saveWorkspaceAs() },
      { label: 'Delete workspace', sub: list.length ? list.map(w => ({ label: w.name, run: () => this.deleteWorkspace(w.name) })) : [{ label: 'None saved yet', disabled: true }] },
      { label: 'Reset to the standard workspace', run: () => this.setLayout(sanitizeLayout(DEFAULT_LAYOUT)) },
    ];
  },

  async saveWorkspaceAs() {
    const list = sanitizeWorkspaces(store('workspaces'));
    const name = (await promptBox('Save workspace', 'Name', `Workspace ${list.length + 1}`))?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    if (!name) return;
    if (list.some(w => w.name === name) && !(await modal({ title: 'Save workspace', body: `<p>Replace the workspace "${esc(name)}"?</p>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Replace', value: true, primary: true }] }))) return;
    store('workspaces', saveWorkspace(list, name, this.readLayout()));
    toast(`Workspace "${name}" saved. View → Workspace switches to it.`);
  },

  deleteWorkspace(name) {
    store('workspaces', sanitizeWorkspaces(store('workspaces')).filter(w => w.name !== name));
    toast(`Workspace "${name}" deleted.`);
  },

  // ---------- radial menu ----------

  radialSlots() { return sanitizeRadial(store('radial'), radialChoices().map(c => c[0])); },

  /** Opens the radial menu centred on (clientX, clientY); `held`: opened by a held button, so releasing over a slot runs it. */
  openRadial(clientX, clientY, held = false) {
    this.closeRadial();
    const slots = this.radialSlots(), byId = Object.fromEntries(radialChoices().map(c => [c[0], c]));
    const root = this.root.getBoundingClientRect(), R = RADIAL_R + RADIAL_BTN / 2 + 4;
    const cx = Math.max(root.left + R, Math.min(root.right - R, clientX)), cy = Math.max(root.top + R, Math.min(root.bottom - R, clientY));
    const el = document.createElement('div');
    el.className = 'radial';
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.innerHTML = `<div class="radial-ring"></div><button class="radial-mid" title="Close (Esc)" style="--main:${esc(this.colors.main)};--sub:${esc(this.colors.sub)}"></button>` +
      slots.map((id, i) => {
        const p = radialSpot(i, RADIAL_SLOTS, RADIAL_R), c = byId[id], tool = id.startsWith('tool:') && TOOL_BY_ID[id.slice(5)];
        const ic = tool ? tool.icon : COMMAND_ICONS[id], inner = !c ? '' : ic ? icon(ic, 24) : `<span>${esc(c[1])}</span>`;
        return `<button class="radial-slot${c ? '' : ' empty'}${tool && tool.id === this.tool ? ' on' : ''}" data-i="${i}" style="left:${p.x}px;top:${p.y}px" title="${c ? esc(c[1]) : 'Empty: Settings → Radial menu… fills it'}"${c ? '' : ' disabled'}>${inner}</button>`;
      }).join('');
    document.body.append(el);
    const run = i => {
      const id = slots[i];
      this.closeRadial();
      if (!id) return;
      if (id.startsWith('tool:')) this.selectTool(id.slice(5));
      else this.commandActs()[id]?.();
    };
    const hover = ev => {
      const i = radialSlot(ev.clientX - cx, ev.clientY - cy, RADIAL_SLOTS, RADIAL_INNER);
      el.querySelectorAll('.radial-slot').forEach((b, k) => b.classList.toggle('hot', k === i && !!slots[k]));
      return i;
    };
    const away = ev => { if (!el.contains(ev.target)) this.closeRadial(); };
    const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.closeRadial(); } };
    const release = ev => {  // a press-drag-release on the button that opened it picks the slot it ends on
      if (!held) return;
      held = false;
      const i = hover(ev);
      if (i >= 0 && slots[i]) run(i);
    };
    el.querySelector('.radial-mid').onclick = () => this.closeRadial();
    el.querySelectorAll('.radial-slot').forEach(b => { b.onclick = () => run(+b.dataset.i); });
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    window.addEventListener('pointermove', hover);
    window.addEventListener('pointerup', release);
    setTimeout(() => window.addEventListener('pointerdown', away, true));
    window.addEventListener('keydown', key, true);
    this.radial = { el, off: () => {
      window.removeEventListener('pointermove', hover);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    } };
  },

  closeRadial() {
    if (!this.radial) return;
    this.radial.off();
    this.radial.el.remove();
    this.radial = null;
  },

  /** The radial menu's command: opens it at the pointer (or the middle of the canvas). */
  radialAtPointer() {
    const v = this.viewport.getBoundingClientRect(), p = this.pointer;
    this.openRadial(p ? v.left + p.x : v.left + v.width / 2, p ? v.top + p.y : v.top + v.height / 2);
  },

  /** Settings → Radial menu…: what each of the eight slots holds. */
  async radialDialog() {
    const choices = radialChoices(), slots = this.radialSlots(), groups = [...new Set(choices.map(c => c[2]))];
    const names = ['Top', 'Top right', 'Right', 'Bottom right', 'Bottom', 'Bottom left', 'Left', 'Top left'];
    const select = (i, v) => `<label class="field"><span>${names[i]}</span><select data-slot="${i}"><option value="">(empty)</option>${groups.map(g =>
      `<optgroup label="${esc(g)}">${choices.filter(c => c[2] === g).map(([id, label]) => `<option value="${esc(id)}"${id === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
    const res = await modal({
      title: 'Radial menu',
      body: `<p class="muted small">Right-click the canvas (or press the pen's side button) with any tool but Move, and these show round the
        pointer. Click one, or hold the button, move onto one and let go.</p><div class="radial-grid">${slots.map((v, i) => select(i, v)).join('')}</div>`,
      buttons: [{ label: 'Standard', value: 'reset' }, { label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      collect: root => [...root.querySelectorAll('[data-slot]')].map(s => s.value),
    });
    if (res === 'reset') store('radial', DEFAULT_RADIAL);
    else if (Array.isArray(res)) store('radial', res);
  },
};
