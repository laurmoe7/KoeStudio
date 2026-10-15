// Quick mask (Select → Quick mask, Q): the selection becomes a temporary mask that every tool paints on, shown
// in red over the canvas (red = selected, as in Clip Studio Paint). Painting selects, erasing deselects, lower
// opacity selects partly, and filters such as Gaussian blur soften it. Turning it off makes the painted area
// the selection again. Turning it on and off are undo steps; the strokes in between are ordinary patches on
// the quick mask raster, which the on/off steps keep, so undo and redo walk through it in order.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { Mask } from '../doc.js';
import { toast } from '../ui.js';

export const quickMaskMethods = {
  toggleQuickMask() {
    if (this.gesture) return;
    this.finishTransform();
    this.finishText();
    this.cancelPolygon();
    this.cancelFigurePoly();
    if (this.quickMask) this.exitQuickMask();
    else this.enterQuickMask();
  },

  /** The selection (or nothing) moves into a new quick mask; the selection itself is cleared meanwhile. */
  enterQuickMask() {
    const d = this.doc, qm = new Mask(d.width, d.height), before = this.sel.snapshot();
    if (this.sel.active) qm.ctx.drawImage(this.sel.canvas, 0, 0);
    const on = () => { this.quickMask = qm; this.sel.clear(); this.quickMaskChanged(); };
    const off = () => { this.quickMask = null; this.sel.restore(before); this.quickMaskChanged(); };
    on();
    this.history.push({ label: 'Quick mask', bytes: d.width * d.height * 8, undo: off, redo: on });
    toast('Quick mask: paint to select, erase to deselect. Press Q again to turn it into the selection.');
  },

  /** What was painted on the quick mask becomes the selection. */
  exitQuickMask() {
    const qm = this.quickMask, d = this.doc, before = this.sel.snapshot();
    this.sel.combine('replace', ctx => ctx.drawImage(qm.canvas, 0, 0));
    const after = this.sel.snapshot();
    const off = () => { this.quickMask = null; this.sel.restore(after); this.quickMaskChanged(); };
    const on = () => { this.quickMask = qm; this.sel.restore(before); this.quickMaskChanged(); };
    off();
    this.history.push({ label: 'Quick mask off', bytes: d.width * d.height * 8, undo: on, redo: off });
  },

  quickMaskChanged() {
    this.poly = null;
    this.tintKey = null;
    const chip = this.root.querySelector('.qmask-chip');
    if (chip) chip.hidden = !this.quickMask;
    this.render();
    this.drawOverlay();
  },
};
