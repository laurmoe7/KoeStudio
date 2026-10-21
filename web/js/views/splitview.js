// View → Second view: the canvas area splits in two, each half showing the same artwork with its own zoom, turn
// and mirror (Clip Studio Paint's Window → Canvas → New window, tiled): one zoomed in to work on, one showing the
// whole picture. You can draw in either: the editor works on one pane at a time (this.view, this.viewport,
// this.viewCanvas, this.overlay, ...), and pressing or scrolling in the other one swaps the two (swapPane), so
// every tool works there unchanged. The other pane (this.pane2) is redrawn from the composite after each render.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { store } from '../ui.js';
import { fitView, resizedView } from '../view.js';
import { union } from '../rect.js';

/** What makes a pane: swapped between the editor and this.pane2. */
const PANE_FIELDS = ['viewport', 'viewCanvas', 'overlay', 'vctx', 'octx', 'view', 'vw', 'vh', 'paperLayer'];
const MIN_SHARE = 0.15;  // neither pane gets narrower than this share of the canvas area

export const splitViewMethods = {
  /** The second pane's elements (hidden until the split is on); called from build(). */
  initPanes() {
    const vp = this.root.querySelector('.ed-view2');
    this.pane2 = { viewport: vp, viewCanvas: vp.querySelector('.ed-view'), overlay: vp.querySelector('.ed-overlay'), view: null, vw: 0, vh: 0, paperLayer: null };
    this.pane2.vctx = this.pane2.viewCanvas.getContext('2d');
    this.pane2.octx = this.pane2.overlay.getContext('2d');
    for (const el of [this.viewport, vp]) {
      // a press or a scroll in the other pane makes it the one being worked on, before the tools see the event
      el.addEventListener('pointerdown', () => { if (el === this.pane2.viewport) this.activatePane(); }, true);
      el.addEventListener('wheel', () => { if (el === this.pane2.viewport) this.activatePane(); }, true);
    }
    this.bindPointer(this.pane2.overlay, vp);
    this.bindSplitter();
    this.split = false;
    if (store('splitView') === true) this.toggleSplit(true);
  },

  /** Swaps the pane being worked on with the other one; bars and floating strips on the canvas move along. */
  swapPane() {
    const p = this.pane2, from = this.viewport;
    for (const k of PANE_FIELDS) [this[k], p[k]] = [p[k], this[k]];
    for (const el of [...from.children]) if (el.tagName !== 'CANVAS') this.viewport.append(el);
    from.classList.remove('active-pane');
    this.viewport.classList.toggle('active-pane', this.split);
  },

  /** Makes the other pane the one being worked on (not in the middle of a stroke or drag). */
  activatePane() {
    if (!this.split || this.gesture) return;
    this.pointer = null;
    this.swapPane();
    this.resize();  // sizes and draws the new one, with its labels
    this.renderPassive();
  },

  /** View → Second view: shows or hides the second pane beside the canvas. */
  toggleSplit(on = !this.split) {
    if (on === this.split) return;
    const second = this.root.querySelector('.ed-view2');
    if (!on && this.viewport === second) this.swapPane();  // the pane that stays is the first one
    this.split = on;
    second.hidden = !on;
    this.root.querySelector('.ed-splitter').hidden = !on;
    this.viewport.classList.toggle('active-pane', on);
    if (!on) { this.pane2.view = null; this.pane2.paperLayer = null; }
    store('splitView', on);
    this.applySplitShare();
  },

  /** The second pane's share of the canvas area (dragging the bar between the panes; remembered). */
  applySplitShare(share = store('splitShare')) {
    const s = Number.isFinite(share) ? Math.max(MIN_SHARE, Math.min(1 - MIN_SHARE, share)) : 0.4;
    this.root.querySelector('.ed-view2').style.flex = `0 0 ${(s * 100).toFixed(2)}%`;
  },

  bindSplitter() {
    const bar = this.root.querySelector('.ed-splitter'), box = this.root.querySelector('.ed-views');
    bar.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const r = box.getBoundingClientRect();
      const move = ev => { const s = 1 - (ev.clientX - r.left) / r.width; this.applySplitShare(s); store('splitShare', Math.max(MIN_SHARE, Math.min(1 - MIN_SHARE, s))); };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => { store('splitShare', 0.5); this.applySplitShare(0.5); });
  },

  /** Runs fn with the other pane's fields in place of the active one's (for drawing it), then swaps back. */
  withPassive(fn) {
    const p = this.pane2, dirty = this.dirty;
    for (const k of PANE_FIELDS) [this[k], p[k]] = [p[k], this[k]];
    this.drawingPassive = true;
    try { fn(); } finally {
      this.drawingPassive = false;
      for (const k of PANE_FIELDS) [this[k], p[k]] = [p[k], this[k]];
      this.dirty = dirty;  // render() clears it, but it belongs to the active pane
    }
  },

  /** The other pane after a size change: its canvases follow, a fitted (new) view fits, otherwise the middle stays. */
  resizePassive() {
    if (!this.split || this.destroyed) return;
    const p = this.pane2, r = p.viewport.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (r.width <= 0 || r.height <= 0) return;
    if (!p.view) p.view = fitView(this.doc.width, this.doc.height, r.width, r.height);
    else if (p.vw > 0 && p.vh > 0 && (r.width !== p.vw || r.height !== p.vh)) p.view = resizedView(p.view, this.doc.width, this.doc.height, p.vw, p.vh, r.width, r.height);
    p.vw = r.width; p.vh = r.height;
    for (const c of [p.viewCanvas, p.overlay]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    this.renderPassive();
  },

  /**
   * Redraws doc region r (or 'all') of the other pane on the next frame, after the active one drew it: while
   * drawing only the part the stroke changed, as in the active pane.
   */
  schedulePassive(r = 'all') {
    if (!this.split) return;
    const d = this.passiveDirty;
    this.passiveDirty = r === 'all' || d === 'all' ? 'all' : d ? union(d, r) : r;
    if (!this.passiveRaf) this.passiveRaf = requestAnimationFrame(() => {
      this.passiveRaf = 0;
      const region = this.passiveDirty;
      this.passiveDirty = null;
      this.renderPassive(region || 'all');
    });
  },

  /** Draws the other pane (region: a doc rect, or 'all': paper, the composite through its own view, an empty overlay). */
  renderPassive(region = 'all') {
    if (!this.split || this.destroyed) return;
    if (!this.pane2.view) { this.resizePassive(); return; }
    this.withPassive(() => {
      const all = region === 'all' || !this.paperLayer;  // a partial redraw copies the paper from its last full one
      this.render(all ? 'all' : region);
      if (!all) return;
      this.octx.setTransform(1, 0, 0, 1, 0, 0);
      this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    });
  },
};
