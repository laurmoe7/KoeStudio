// The shortcut strip (View → Shortcut strip): big buttons beside the canvas for drawing on a pen tablet without a
// keyboard. The editor side is views/striptool.js; this is the part without the DOM.

/**
 * The buttons, top to bottom ('-' is a gap). `key` is the default key shown in the tooltip (the user's own key
 * replaces it, see menuKeyLabel); `hold` buttons act like holding that key while a finger stays on them; `repeat`
 * buttons repeat while held.
 */
export const STRIP_BUTTONS = [
  { id: 'undo', icon: 'undo', label: 'Undo', key: 'Ctrl+Z' },
  { id: 'redo', icon: 'redo', label: 'Redo', key: 'Ctrl+Y' },
  '-',
  { id: 'sizeDown', icon: 'sizeDown', label: 'Smaller brush', key: '[', repeat: true },
  { id: 'sizeUp', icon: 'sizeUp', label: 'Bigger brush', key: ']', repeat: true },
  { id: 'swap', icon: 'swap', label: 'Swap main and sub colour', key: 'X' },
  '-',
  { id: 'pick', icon: 'picker', label: 'Hold to pick a colour', key: 'Alt', hold: 'alt' },
  { id: 'pan', icon: 'hand', label: 'Hold to move the view', key: 'Space', hold: 'space' },
  { id: 'fit', icon: 'fit', label: 'Fit to window', key: 'Ctrl+0' },
];

export const REPEAT_DELAY = 450, REPEAT_EVERY = 110;  // ms before a held repeat button repeats, and between repeats

/**
 * The stored strip settings (`koe.strip`): `on` is true / false once chosen in the View menu, null until then
 * (then it shows once a pen or finger has been used); `side` 'left', 'right' or 'bottom' of the canvas, or 'float':
 * over the canvas at `x`, `y` (px from the canvas area's top left, null until first dragged), lying `flat` (a row)
 * or upright; `collapsed`.
 */
export function sanitizeStrip(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    on: typeof r.on === 'boolean' ? r.on : null,
    side: ['left', 'bottom', 'float'].includes(r.side) ? r.side : 'right',
    collapsed: r.collapsed === true,
    x: Number.isFinite(r.x) ? Math.round(r.x) : null,
    y: Number.isFinite(r.y) ? Math.round(r.y) : null,
    flat: r.flat === true,
  };
}

export const FLOAT_MARGIN = 8;  // px between a floating strip with no spot yet and the canvas area's corner

/**
 * Where a floating strip of size w × h goes in a canvas area of vw × vh: at x, y kept wholly inside (at 0, 0 when
 * it is bigger than the area), or in the top right corner when it has no spot yet.
 */
export function floatSpot(x, y, w, h, vw, vh) {
  if (x === null || y === null) { x = vw - w - FLOAT_MARGIN; y = FLOAT_MARGIN; }
  const fit = (v, size, room) => Math.round(Math.max(0, Math.min(room - size, v)));
  return { x: fit(x, w, vw), y: fit(y, h, vh) };
}

/** Whether the strip shows: as chosen, or (never chosen) once a pen or touch screen has been used. */
export function stripShown(state, penSeen) {
  return state.on ?? !!penSeen;
}

/**
 * Which fingers (pointer ids) hold which hold button. A held key stays down while any finger is on its button, so
 * two fingers or a lost pointerup on one cannot let it go too early or keep it down for good.
 */
export class HoldTracker {
  constructor() { this.by = new Map(); }  // pointer id → kind ('alt' / 'space')
  /** A finger went down on a hold button; true when that kind just became held. */
  press(kind, id) {
    const was = this.isHeld(kind);
    this.by.set(id, kind);
    return !was;
  }
  /** A finger came off (or was cancelled); the kind it let go of, or null when nothing changed. */
  release(id) {
    const kind = this.by.get(id);
    if (!kind) return null;
    this.by.delete(id);
    return this.isHeld(kind) ? null : kind;
  }
  isHeld(kind) { for (const k of this.by.values()) if (k === kind) return true; return false; }
  /** Lets everything go (the window lost focus, the strip was hidden); the kinds that were held. */
  clear() { const kinds = [...new Set(this.by.values())]; this.by.clear(); return kinds; }
}
