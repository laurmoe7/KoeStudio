// The selection bar (Clip Studio Paint's selection launcher): a small row of buttons under the selection for what
// is usually done next. Placed on every overlay redraw (`placeSelectionBar` from paintOverlay); hidden while a
// gesture or transform runs. View → Selection bar turns it off (`koe.selBar`).
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { icon } from '../icons.js';
import { selectionBarSpot } from '../selection.js';
import { esc, menu, store } from '../ui.js';
import { toScreen } from '../view.js';

const BUTTONS = [
  ['deselect', 'Deselect (Ctrl+D)', ed => ed.deselect()],
  ['invert', 'Invert selection (Ctrl+Shift+I)', ed => ed.invertSelection()],
  ['transform', 'Transform (Ctrl+T)', ed => ed.beginTransform()],
  ['fill', 'Fill with main color (Alt+Del)', ed => ed.fillLayer()],
  ['trash', 'Delete selected pixels (Del)', ed => ed.clearLayer()],
  ['copy', 'Copy to new layer (Ctrl+J)', ed => ed.layerViaCopy()],
  ['crop', 'Crop to selection', ed => ed.cropToSelection()],
];

export const selectionBarMethods = {
  /** View → Selection bar. */
  toggleSelectionBar() {
    this.selBarOn = !this.selBarOn;
    store('selBar', this.selBarOn);
    this.drawOverlay();
  },

  /** Shows, hides and places the bar (cheap: only its position changes between redraws). */
  placeSelectionBar() {
    const show = this.selBarOn !== false && this.sel?.active && !this.xf && !this.gesture && !this.quickMask && !this.poly;
    let bar = this.selBar;
    if (!show) { if (bar) bar.hidden = true; return; }
    if (!bar) bar = this.buildSelectionBar();
    bar.hidden = false;
    const b = this.sel.bounds, v = this.view;
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toScreen(v, x, y));
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    const w = bar.offsetWidth || 260, h = bar.offsetHeight || 32;
    const { x, y } = selectionBarSpot(pts, w, h, vw, vh);
    const key = `${x},${y}`;
    if (bar.dataset.at !== key) { bar.dataset.at = key; bar.style.transform = `translate(${x}px, ${y}px)`; }
  },

  buildSelectionBar() {
    const bar = this.selBar = document.createElement('div');
    bar.className = 'sel-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Selection');
    bar.innerHTML = BUTTONS.map(([ic, title], i) => `<button class="icon-btn" data-i="${i}" title="${esc(title)}" aria-label="${esc(title)}">${icon(ic, 16)}</button>`).join('') +
      `<button class="icon-btn" data-more title="More selection commands">${icon('more', 16)}</button>`;
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    bar.onclick = e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.hasAttribute('data-more')) return menu(btn, this.menuItems('select'));
      BUTTONS[+btn.dataset.i][2](this);
      this.drawOverlay();
    };
    this.viewport.appendChild(bar);
    return bar;
  },
};
