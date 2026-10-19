// The shortcut strip (Settings → Shortcut strip): a column of big buttons beside the canvas for drawing on a pen tablet
// without a keyboard, on the left, right or bottom of the canvas or floating over it (undo, redo, brush size, swap colours, hold to pick a colour, hold to move the view, fit).
// The buttons call the editor's own methods; the hold buttons set `this.held` like holding Alt / Space. A finger on
// the strip never reaches the canvas's pointer handlers, so it cannot drop or end the pen's stroke there.
// Settings in `koe.strip` (sanitizeStrip); `koe.penSeen` is set by the first pen or finger on the canvas.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { icon } from '../icons.js';
import { menuKeyLabel } from '../shortcuts.js';
import { HoldTracker, REPEAT_DELAY, REPEAT_EVERY, STRIP_BUTTONS, floatSpot, sanitizeStrip, stripShown } from '../strip.js';
import { nextSize } from '../tools.js';
import { esc, store } from '../ui.js';
import { keyBindings } from './shortcutsdialog.js';

const BY_ID = Object.fromEntries(STRIP_BUTTONS.filter(b => b !== '-').map(b => [b.id, b]));

export const stripMethods = {
  stripState() { return sanitizeStrip(store('strip')); },

  setStripState(change) {
    store('strip', { ...this.stripState(), ...change });
    this.applyStrip();
  },

  /** Settings → Shortcut strip items. */
  stripMenu() {
    const s = this.stripState(), shown = stripShown(s, store('penSeen'));
    return [
      { label: 'Show shortcut strip', checked: shown, run: () => this.setStripState({ on: !shown }) },
      '-',
      { label: 'On the left', checked: s.side === 'left', run: () => this.setStripState({ side: 'left', on: true }) },
      { label: 'On the right', checked: s.side === 'right', run: () => this.setStripState({ side: 'right', on: true }) },
      { label: 'At the bottom', checked: s.side === 'bottom', run: () => this.setStripState({ side: 'bottom', on: true }) },
      { label: 'Floating (drag it anywhere)', checked: s.side === 'float', run: () => this.setStripState({ side: 'float', on: true }) },
      { label: 'Floating bar lies flat', checked: s.flat, disabled: s.side !== 'float', run: () => this.setStripState({ flat: !s.flat }) },
      '-',
      { label: 'Folded up', checked: s.collapsed, run: () => this.setStripState({ collapsed: !s.collapsed, on: true }) },
    ];
  },

  /** Shows or hides the strip and puts it on its side (the viewport's ResizeObserver then resizes the view). */
  applyStrip() {
    const s = this.stripState(), shown = stripShown(s, store('penSeen'));
    let strip = this.strip;
    if (!shown) {
      if (strip) strip.hidden = true;
      this.releaseStripHolds();
      return;
    }
    if (!strip) strip = this.buildStrip();
    strip.hidden = false;
    strip.classList.toggle('collapsed', s.collapsed);
    strip.classList.toggle('left', s.side === 'left');
    strip.classList.toggle('bottom', s.side === 'bottom');
    strip.classList.toggle('float', s.side === 'float');
    const row = s.side === 'bottom' || (s.side === 'float' && s.flat);
    strip.classList.toggle('row', row);
    strip.setAttribute('aria-orientation', row ? 'horizontal' : 'vertical');
    const fold = strip.querySelector('.strip-fold');
    fold.title = s.collapsed ? 'Unfold the shortcut strip' : 'Fold the shortcut strip away';
    fold.setAttribute('aria-expanded', String(!s.collapsed));
    // left / right: a column in .ed-body beside .ed-center; bottom: a row in .ed-center under the canvas;
    // float: on top of the canvas inside .ed-viewport (which then keeps its size)
    const center = this.root.querySelector('.ed-center');
    const [parent, before] = s.side === 'float' ? [this.viewport, null]
      : s.side === 'bottom' ? [center, null]
      : [this.root.querySelector('.ed-body'), s.side === 'left' ? center : center.nextSibling];
    if (strip.nextSibling !== before || strip.parentNode !== parent) parent.insertBefore(strip, before);
    if (s.side === 'float') this.placeStrip();
    else strip.style.left = strip.style.top = '';
    if (s.collapsed) this.releaseStripHolds();
  },

  /** Puts a floating strip at x, y or its saved spot, kept inside the canvas area (also when the window resizes). */
  placeStrip(x, y) {
    const strip = this.strip;
    if (!strip || strip.hidden || !strip.classList.contains('float')) return null;
    const s = this.stripState();
    const p = floatSpot(x ?? s.x, y ?? s.y, strip.offsetWidth, strip.offsetHeight, this.viewport.clientWidth, this.viewport.clientHeight);
    strip.style.left = p.x + 'px';
    strip.style.top = p.y + 'px';
    return p;
  },

  /** Dragging a floating strip by its grip (pen, finger or mouse); the spot is saved when let go. */
  bindStripGrip(grip) {
    grip.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const strip = this.strip, dx = e.clientX - strip.offsetLeft, dy = e.clientY - strip.offsetTop;
      try { grip.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      grip.classList.add('down');
      let at = null;
      const move = ev => { if (ev.pointerId === e.pointerId) at = this.placeStrip(ev.clientX - dx, ev.clientY - dy); };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        grip.classList.remove('down');
        if (at) store('strip', { ...this.stripState(), x: at.x, y: at.y });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  },

  /** A pen or finger touched the canvas: the first time, the strip appears (unless it was turned off) once it lifts. */
  notePenUsed() {
    if (store('penSeen')) return;
    store('penSeen', true);
    if (this.stripState().on === null) window.addEventListener('pointerup', () => { if (!this.destroyed) this.applyStrip(); }, { once: true });
  },

  /** The tooltips, with the user's own keys (Settings → Keyboard shortcuts…). */
  stripTitles() {
    if (!this.strip) return;
    const { binds } = keyBindings();
    this.strip.querySelectorAll('[data-strip]').forEach(btn => {
      const b = BY_ID[btn.dataset.strip], key = menuKeyLabel(b.key, binds);
      btn.title = b.label + (key ? ` (${key})` : '');
    });
  },

  buildStrip() {
    const strip = this.strip = document.createElement('div');
    strip.className = 'ed-strip';
    strip.setAttribute('role', 'toolbar');
    strip.setAttribute('aria-label', 'Shortcut strip');
    strip.setAttribute('aria-orientation', 'vertical');
    strip.innerHTML = `<div class="strip-grip" title="Drag to move the shortcut strip">${icon('grip', 16)}</div>` +
      `<button class="strip-fold" aria-label="Fold the shortcut strip">${icon('chevron', 14)}</button>` +
      STRIP_BUTTONS.map(b => (b === '-' ? '<span class="strip-sep"></span>'
        : `<button class="strip-btn" data-strip="${b.id}" aria-label="${esc(b.label)}">${icon(b.icon, 24)}</button>`)).join('');
    this.stripHolds = new HoldTracker();
    this.stripPress = new Map();  // pointer id → {btn, timer} for buttons that run when let go or repeat
    this.bindStripGrip(strip.querySelector('.strip-grip'));
    strip.querySelector('.strip-fold').onclick = () => this.setStripState({ collapsed: !this.stripState().collapsed });
    strip.addEventListener('pointerdown', e => {
      const btn = e.target.closest('[data-strip]');
      if (!btn) return;
      e.preventDefault();  // no focus moving to the button, no text selection
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const b = BY_ID[btn.dataset.strip];
      btn.classList.add('down');
      if (b.hold) {
        if (this.stripHolds.press(b.hold, e.pointerId)) { this.held[b.hold] = true; this.drawOverlay(); }
        return;
      }
      const press = { btn, timer: 0 };
      this.stripPress.set(e.pointerId, press);
      if (b.repeat) {
        this.stripRun(b.id);
        const again = () => { this.stripRun(b.id); press.timer = setTimeout(again, REPEAT_EVERY); };
        press.timer = setTimeout(again, REPEAT_DELAY);
      }
    });
    const up = e => {
      const press = this.stripPress.get(e.pointerId);
      if (press) {
        this.stripPress.delete(e.pointerId);
        clearTimeout(press.timer);
        press.btn.classList.remove('down');
        const b = BY_ID[press.btn.dataset.strip], r = press.btn.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (e.type === 'pointerup' && inside && !b.repeat) this.stripRun(b.id);  // slid off the button: nothing
        return;
      }
      const kind = this.stripHolds?.release(e.pointerId);
      if (kind) { this.held[kind] = false; this.drawOverlay(); }
      for (const btn of strip.querySelectorAll('[data-strip].down')) {
        const hold = BY_ID[btn.dataset.strip].hold;
        if (hold && !this.stripHolds.isHeld(hold)) btn.classList.remove('down');
      }
    };
    strip.addEventListener('pointerup', up);
    strip.addEventListener('pointercancel', up);
    strip.addEventListener('lostpointercapture', up);
    strip.addEventListener('contextmenu', e => e.preventDefault());  // a long press with a finger
    // Enter / Space on a focused button (keyboard): pointer presses are handled above, so only clicks without one
    strip.addEventListener('click', e => {
      const btn = e.target.closest('[data-strip]');
      if (btn && e.detail === 0 && !BY_ID[btn.dataset.strip].hold) this.stripRun(btn.dataset.strip);
    });
    this.stripTitles();
    return strip;
  },

  /** One button's action. Like their keys, they wait while a stroke or other gesture is under way. */
  stripRun(id) {
    if (this.gesture || this.destroyed) return;
    const s = this.settings[this.tool];
    if (id === 'undo') this.undo();
    else if (id === 'redo') this.redo();
    else if (id === 'sizeDown' || id === 'sizeUp') { if (s.size) this.setSize(nextSize(s.size, id === 'sizeUp' ? 1 : -1)); }
    else if (id === 'swap') this.colors.swap();
    else if (id === 'fit') this.fit();
  },

  /** Lets go of the hold buttons (the window lost focus, the strip was hidden or folded). */
  releaseStripHolds() {
    if (!this.stripHolds) return;
    for (const kind of this.stripHolds.clear()) this.held[kind] = false;
    for (const press of this.stripPress.values()) clearTimeout(press.timer);
    this.stripPress.clear();
    this.strip?.querySelectorAll('.down').forEach(b => b.classList.remove('down'));
  },
};
