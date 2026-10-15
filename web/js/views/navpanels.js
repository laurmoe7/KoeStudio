// The History and Navigator panels under the tool panel.
// History lists every step that can be undone or redone; clicking one goes back (or forward) to it.
// Navigator shows the whole picture with the part in the window outlined; clicking or dragging in it moves the view.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { esc } from '../ui.js';
import { toDoc, toScreen } from '../view.js';

const NAV_MAX_H = 160;         // tallest the navigator picture gets, in CSS px
const NAV_CONTENT_MS = 300;    // the picture is redrawn at most this often while painting

export const navMethods = {
  // ---------- History ----------

  /** Redraws the History list once per frame, however many steps changed. */
  scheduleHistory() {
    if (this.historyRaf || this.destroyed) return;
    this.historyRaf = requestAnimationFrame(() => { this.historyRaf = 0; this.renderHistory(); });
  },

  renderHistory() {
    const box = this.root.querySelector('.history-list');
    if (!box) return;
    const { labels, done } = this.history.steps;
    const rows = ['Start', ...labels];
    box.innerHTML = rows.map((l, n) => `<button class="hs-row${n === done ? ' current' : n > done ? ' undone' : ''}" data-n="${n}"
      title="${n === 0 ? 'Back to how it was before the oldest step kept' : n > done ? 'Undone: click to redo up to here' : 'Click to go back to here'}">${esc(l)}</button>`).join('');
    box.querySelectorAll('[data-n]').forEach(b => { b.onclick = () => this.historyGoTo(+b.dataset.n); });
    box.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  },

  /** Undoes or redoes until n steps are done. */
  historyGoTo(n) {
    if (this.gesture) return;
    this.finishText();
    if (this.xf) this.cancelTransform();
    this.cancelFigurePoly();
    this.cancelPolygon();
    this.history.goTo(n);
    this.layerPanel.render();
  },

  // ---------- Navigator ----------

  bindNavigator() {
    const c = this.root.querySelector('.nav-canvas');
    if (!c) return;
    const go = e => {
      const p = this.navToDoc(e);
      if (!p) return;
      const s = toScreen(this.view, p.x, p.y);
      this.setView({ ...this.view, panX: this.view.panX + this.vw / 2 - s.x, panY: this.view.panY + this.vh / 2 - s.y });
    };
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.navDrag = e.pointerId;
      go(e);
    });
    c.addEventListener('pointermove', e => { if (this.navDrag === e.pointerId) go(e); });
    const end = e => { if (this.navDrag === e.pointerId) this.navDrag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', e => {  // zoom about the middle of the window
      e.preventDefault();
      this.zoomStep(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  },

  /** Where the picture sits in the navigator: {x, y, scale, w, h} in CSS px. */
  navLayout() {
    const c = this.root.querySelector('.nav-canvas'), d = this.doc;
    const w = c?.parentElement.clientWidth - 20;
    if (!(w > 0)) return null;
    const h = Math.min(NAV_MAX_H, Math.round((w * d.height) / d.width));
    const scale = Math.min(w / d.width, h / d.height);
    return { w, h, scale, x: (w - d.width * scale) / 2, y: (h - d.height * scale) / 2 };
  },

  navToDoc(e) {
    const L = this.navLayout();
    if (!L) return null;
    const r = e.target.getBoundingClientRect();
    return { x: (e.clientX - r.left - L.x) / L.scale, y: (e.clientY - r.top - L.y) / L.scale };
  },

  /** After every render: the outline follows the view at once, the picture catches up every NAV_CONTENT_MS. */
  scheduleNav() {
    if (this.destroyed || this.root.querySelector('[data-panel="navigator"]')?.classList.contains('folded')) return;
    if (!this.navRaf) this.navRaf = requestAnimationFrame(() => { this.navRaf = 0; this.paintNav(); });
    // one picture refresh per burst of renders (not re-armed by its own repaint, so an idle editor stays idle)
    if (!this.navTimer) {
      this.navTimer = setTimeout(() => {
        this.navTimer = 0;
        this.navStale = true;
        if (!this.navRaf && !this.destroyed) this.navRaf = requestAnimationFrame(() => { this.navRaf = 0; this.paintNav(); });
      }, NAV_CONTENT_MS);
    }
  },

  paintNav() {
    const c = this.root.querySelector('.nav-canvas'), L = this.navLayout(), d = this.doc;
    if (!c || !L) return;
    const dpr = window.devicePixelRatio || 1, W = Math.round(L.w * dpr), H = Math.round(L.h * dpr);
    c.style.width = L.w + 'px';
    c.style.height = L.h + 'px';
    const thumb = this.navThumb || (this.navThumb = document.createElement('canvas'));
    if (c.width !== W || c.height !== H || thumb.width !== W || thumb.height !== H || this.navStale !== false) {
      c.width = thumb.width = W;
      c.height = thumb.height = H;
      const t = thumb.getContext('2d');
      t.setTransform(dpr * L.scale, 0, 0, dpr * L.scale, dpr * L.x, dpr * L.y);
      t.fillStyle = d.paper ? '#fff' : '#e4e4ea';  // transparent paper: light gray (a checker this small is noise)
      t.fillRect(0, 0, d.width, d.height);
      t.imageSmoothingQuality = 'high';
      t.drawImage(this.comp, 0, 0);
      this.navStale = false;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(thumb, 0, 0);
    // the window's corners on the picture (a turned view outlines a turned box)
    const pts = [[0, 0], [this.vw, 0], [this.vw, this.vh], [0, this.vh]].map(([x, y]) => toDoc(this.view, x, y))
      .map(p => [dpr * (L.x + p.x * L.scale), dpr * (L.y + p.y * L.scale)]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(110, 168, 255, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#ff5a5a';
    ctx.stroke();
  },
};
