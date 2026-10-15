// Edge rulers, guides, the perspective ruler and stroke snapping. Editor methods (mixed into Editor.prototype).
//
// Guides are made by dragging out of the edge rulers (top = horizontal, left = vertical) and removed by dragging
// them back. The Ruler tool (U) moves guides and vanishing points. Ruler edits are undo steps and are saved with
// the artwork (doc.rulers); the edge rulers themselves are a view setting.

import { icon } from '../icons.js';
import { newPerspective, niceStep, ticks, snapCandidates, pickLine, project, guideAt, gridStep, sanitizeGrid, MAX_GUIDES } from '../rulers.js';
import { modal, store, toast } from '../ui.js';
import { matrix, toScreen, toDoc } from '../view.js';

export const RULER_PX = 20;   // thickness of the edge rulers, in screen pixels
const GRAB_PX = 6;            // how close (screen px) the pointer must be to a guide to grab it
const VP_PX = 10;             // ... or to a vanishing point
const SNAP_PX = 6;            // how far the pen moves before a stroke picks its snap line
const LINE_COLOR = 'rgba(64, 200, 255, 0.85)';
const PERSPECTIVE_COLOR = 'rgba(190, 120, 255, 0.35)';
const HORIZON_COLOR = 'rgba(190, 120, 255, 0.9)';
const GRID_COLOR = 'rgba(80, 140, 255, 0.55)';
const GRID_SUB_COLOR = 'rgba(80, 140, 255, 0.22)';
const GRID_MIN_PX = 5;        // grid lines closer than this on screen are left out

const clone = r => JSON.parse(JSON.stringify(r));

export const rulerMethods = {
  // ---------- ruler edits (undo steps) ----------

  /** Changes doc.rulers through fn() as one undo step. */
  editRulers(label, fn, before = clone(this.doc.rulers)) {
    fn();
    const after = clone(this.doc.rulers);
    if (JSON.stringify(before) === JSON.stringify(after)) return this.drawOverlay();
    const set = r => { this.doc.rulers = clone(r); this.rulersChanged(); };
    this.history.push({ label, bytes: 0, undo: () => set(before), redo: () => set(after) });
    this.rulersChanged();
  },

  rulersChanged() {
    this.doc.version++;
    this.scheduleSave();
    if (this.tool === 'ruler') this.renderToolProps();
    this.updateSnapButton();
    this.drawOverlay();
  },

  setPerspective(n) {
    this.editRulers(n ? `${n}-point perspective` : 'Remove perspective', () => {
      this.doc.rulers.perspective = n ? newPerspective(n, this.doc.width, this.doc.height) : null;
      this.doc.rulers.visible = true;
    });
    if (n === 2 || n === 3) toast('The vanishing points sit outside the canvas: zoom out (Ctrl+-) to see and drag them.');
  },

  clearGuides() {
    this.editRulers('Clear guides', () => { this.doc.rulers.guides = []; });
  },

  /** Showing/hiding and snapping are settings, not undo steps, but they are saved with the artwork. */
  toggleRulerVisibility() {
    this.doc.rulers.visible = !this.doc.rulers.visible;
    this.rulersChanged();
  },

  /** View → Grid (Ctrl+'): a setting saved with the artwork, not an undo step. */
  toggleGrid() {
    const g = this.doc.rulers.grid;
    g.show = !g.show;
    this.rulersChanged();
  },

  /** View → Grid settings…: spacing, divisions and snapping. Shows the grid while the dialog is open. */
  async gridDialog() {
    const r = this.doc.rulers, before = { ...r.grid };
    const read = root => sanitizeGrid({
      show: true, size: root.querySelector('[name="size"]').value, div: root.querySelector('[name="div"]').value,
      snap: root.querySelector('[name="snap"]').checked,
    });
    const res = await modal({
      title: 'Grid',
      body: `
        <div class="field-row">
          <label class="field"><span>Spacing (px)</span><input type="number" name="size" min="2" max="5000" value="${before.size}"></label>
          <label class="field"><span>Divisions</span><input type="number" name="div" min="1" max="20" value="${before.div}"></label>
        </div>
        <label class="check"><input type="checkbox" name="snap"${before.snap ? ' checked' : ''}> Strokes started on a grid line follow it (with Snap to rulers on)</label>
        <p class="muted small">A strong line every spacing, divided into thinner ones. View → Grid (Ctrl+') shows or hides it.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      live: true,
      onOpen: root => {
        const show = () => { r.grid = read(root); this.drawOverlay(); };
        root.querySelectorAll('input').forEach(el => el.addEventListener('input', show));
        show();
      },
      collect: root => read(root),
    });
    r.grid = res || before;
    this.rulersChanged();
  },

  toggleSnap() {
    const r = this.doc.rulers;
    r.snap = !r.snap;
    this.rulersChanged();
    toast(r.snap ? 'Snapping to rulers is on.' : 'Snapping to rulers is off.');
  },

  toggleEdgeRulers() {
    this.showRulers = !this.showRulers;
    store('edgeRulers', this.showRulers);
    this.root.querySelector('[data-act="rulers"]')?.classList.toggle('on', this.showRulers);
    if (this.tool === 'ruler') this.renderToolProps();
    this.drawOverlay();
  },

  updateSnapButton() {
    const b = this.root.querySelector('[data-act="snap"]');
    if (!b) return;
    const r = this.doc.rulers;
    const on = r.snap && ((r.visible && (r.guides.length || r.perspective)) || (r.grid.show && r.grid.snap));
    b.classList.toggle('on', !!this.doc.rulers.snap);
    b.title = `Snap strokes to rulers: ${this.doc.rulers.snap ? 'on' : 'off'} (Ctrl+2)${on ? '' : ' — add a guide or perspective ruler to use it'}`;
  },

  // ---------- pointer ----------

  /** 'top', 'left', 'corner' or null: which edge ruler a screen point is on. */
  rulerBand(p) {
    if (!this.showRulers || !p) return null;
    if (p.x < RULER_PX && p.y < RULER_PX) return 'corner';
    if (p.y < RULER_PX) return 'top';
    if (p.x < RULER_PX) return 'left';
    return null;
  },

  /** Dragging out of an edge ruler makes a new guide. */
  beginNewGuide(band, dp, id) {
    const axis = band === 'top' ? 'h' : 'v';
    if (this.doc.rulers.guides.length >= MAX_GUIDES) return toast(`There can be at most ${MAX_GUIDES} guides.`);
    this.gesture = { type: 'guide', tool: 'ruler', id, index: -1, axis, pos: Math.round(axis === 'h' ? dp.y : dp.x), before: clone(this.doc.rulers) };
  },

  /** The Ruler tool grabs a vanishing point or a guide under the pointer. */
  beginRulerTool(dp, id) {
    const r = this.doc.rulers;
    if (!r.visible) return toast('Guides and perspective are hidden. Turn them on in the Ruler tool settings.');
    const vp = this.vpAt(dp);
    if (vp >= 0) { this.gesture = { type: 'vp', tool: 'ruler', id, index: vp, before: clone(r) }; return; }
    const gi = guideAt(r.guides, dp, GRAB_PX / this.view.zoom);
    if (gi >= 0) {
      const g = r.guides[gi];
      this.gesture = { type: 'guide', tool: 'ruler', id, index: gi, axis: g.axis, pos: g.pos, before: clone(r) };
    }
  },

  vpAt(dp) {
    const pts = this.doc.rulers.perspective?.points || [];
    const s = toScreen(this.view, dp.x, dp.y);
    return pts.findIndex(p => { const q = toScreen(this.view, p.x, p.y); return Math.hypot(q.x - s.x, q.y - s.y) <= VP_PX; });
  },

  rulerDrag(dp) {
    const g = this.gesture, r = this.doc.rulers;
    if (g.type === 'vp') r.perspective.points[g.index] = { x: Math.round(dp.x), y: Math.round(dp.y) };
    else {
      g.pos = Math.round(g.axis === 'h' ? dp.y : dp.x);
      if (g.index >= 0) r.guides[g.index].pos = g.pos;
    }
    this.drawOverlay();
  },

  /** Ends a guide or vanishing point drag; a guide dropped on an edge ruler is removed. */
  rulerEnd(p) {
    const g = this.gesture, r = this.doc.rulers;
    const dropped = this.rulerBand(p) && g.type === 'guide';
    this.editRulers(g.type === 'vp' ? 'Move vanishing point' : dropped ? 'Remove guide' : g.index < 0 ? 'Add guide' : 'Move guide', () => {
      if (g.type !== 'guide') return;
      if (dropped) { if (g.index >= 0) r.guides.splice(g.index, 1); }
      else if (g.index < 0) { r.guides.push({ axis: g.axis, pos: g.pos }); r.visible = true; }
    }, g.before);
  },

  rulerCursor(p) {
    const band = this.rulerBand(p);
    if (band) return band === 'corner' ? 'default' : band === 'top' ? 'row-resize' : 'col-resize';
    const g = this.gesture;
    if (g?.type === 'guide') return g.axis === 'h' ? 'row-resize' : 'col-resize';
    if (g?.type === 'vp') return 'grabbing';
    if (this.effectiveTool() !== 'ruler' || !p || !this.doc.rulers.visible) return null;
    const dp = toDoc(this.view, p.x, p.y);
    if (this.vpAt(dp) >= 0) return 'grab';
    const gi = guideAt(this.doc.rulers.guides, dp, GRAB_PX / this.view.zoom);
    if (gi >= 0) return this.doc.rulers.guides[gi].axis === 'h' ? 'row-resize' : 'col-resize';
    return 'default';
  },

  // ---------- snapping strokes ----------

  /** Snap state for a stroke starting at pt, or null when snapping is off or there is nothing to snap to. */
  snapFor(pt) {
    const r = this.doc.rulers;
    if (!r.snap) return null;
    const cands = snapCandidates(r, pt, (GRAB_PX * 2) / this.view.zoom);
    return cands.length ? { start: pt, cands, line: null, held: [] } : null;
  },

  /** Feeds a pen point through snapping; returns the points to paint now (none until a line is picked). */
  snapPoint(snap, pt) {
    if (snap.line) return [{ ...project(snap.line, pt), p: pt.p }];
    snap.held.push(pt);
    if (Math.hypot(pt.x - snap.start.x, pt.y - snap.start.y) * this.view.zoom < SNAP_PX) return [];
    snap.line = pickLine(snap.cands, snap.start, pt);
    const held = snap.held;
    snap.held = [];
    return held.map(h => ({ ...project(snap.line, h), p: h.p }));
  },

  // ---------- drawing ----------

  /** Guides and the perspective ruler, under the edge rulers. */
  drawRulerOverlay(ctx) {
    const r = this.doc.rulers, g = this.gesture;
    if (!r.visible && g?.type !== 'guide') return;
    const dpr = this.dpr || 1, d = this.doc;
    const [a, b, c, dd, e, f] = matrix(this.view);
    const sp = (x, y) => [(a * x + c * y + e) * dpr, (b * x + dd * y + f) * dpr];
    const FAR = 1e5;
    ctx.save();
    if (r.grid.show) this.drawGrid(ctx, sp, dpr);
    if (r.visible && r.perspective) {
      const pts = r.perspective.points;
      // radiating lines, kept inside the canvas
      ctx.save();
      ctx.beginPath();
      [[0, 0], [d.width, 0], [d.width, d.height], [0, d.height]].forEach(([x, y], i) => (i ? ctx.lineTo(...sp(x, y)) : ctx.moveTo(...sp(x, y))));
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = PERSPECTIVE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const vp of pts) {
        for (let k = 0; k < 48; k++) {
          const t = (k / 48) * Math.PI * 2;
          ctx.moveTo(...sp(vp.x, vp.y));
          ctx.lineTo(...sp(vp.x + Math.cos(t) * FAR, vp.y + Math.sin(t) * FAR));
        }
      }
      ctx.stroke();
      ctx.restore();
      // horizon: through the first two vanishing points, or level through a single one
      const h0 = pts[0], h1 = pts[1] || { x: pts[0].x + 1, y: pts[0].y };
      const hd = Math.hypot(h1.x - h0.x, h1.y - h0.y) || 1, ux = (h1.x - h0.x) / hd, uy = (h1.y - h0.y) / hd;
      ctx.strokeStyle = HORIZON_COLOR;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(...sp(h0.x - ux * FAR, h0.y - uy * FAR));
      ctx.lineTo(...sp(h0.x + ux * FAR, h0.y + uy * FAR));
      ctx.stroke();
      if (this.effectiveTool() === 'ruler') {
        for (const vp of pts) {
          const [x, y] = sp(vp.x, vp.y);
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#8a4fe0';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 4 * dpr, y); ctx.lineTo(x + 4 * dpr, y); ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x, y + 4 * dpr); ctx.stroke();
        }
      }
    }
    const guides = r.visible ? r.guides.map((x, i) => ({ ...x, i })) : [];
    if (g?.type === 'guide') {
      if (g.index < 0) guides.push({ axis: g.axis, pos: g.pos, i: -1 });
    }
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (const gd of guides) {
      if (gd.axis === 'h') { ctx.moveTo(...sp(-FAR, gd.pos)); ctx.lineTo(...sp(FAR, gd.pos)); }
      else { ctx.moveTo(...sp(gd.pos, -FAR)); ctx.lineTo(...sp(gd.pos, FAR)); }
    }
    ctx.stroke();
    ctx.restore();
  },

  /** The grid over the canvas: main lines every grid.size, thinner ones between; too dense lines are left out. */
  drawGrid(ctx, sp, dpr) {
    const d = this.doc, g = this.doc.rulers.grid, zoom = this.view.zoom, step = gridStep(g);
    const subs = step * zoom >= GRID_MIN_PX, mains = g.size * zoom >= GRID_MIN_PX;
    if (!mains) return;
    const lines = (main) => {
      ctx.beginPath();
      for (let i = 0, x = 0; x <= d.width + 1e-6; x = ++i * step) {
        if ((i % g.div === 0) !== main) continue;
        ctx.moveTo(...sp(x, 0)); ctx.lineTo(...sp(x, d.height));
      }
      for (let i = 0, y = 0; y <= d.height + 1e-6; y = ++i * step) {
        if ((i % g.div === 0) !== main) continue;
        ctx.moveTo(...sp(0, y)); ctx.lineTo(...sp(d.width, y));
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = dpr;
    if (subs && g.div > 1) { ctx.strokeStyle = GRID_SUB_COLOR; lines(false); }
    ctx.strokeStyle = GRID_COLOR;
    lines(true);
    ctx.restore();
  },

  /** Pixel rulers along the top and left edges of the view, with a marker at the pointer. */
  drawEdgeRulers(ctx) {
    if (!this.showRulers) return;
    const dpr = this.dpr || 1, B = RULER_PX * dpr, W = this.overlay.width, H = this.overlay.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#25262c';
    ctx.fillRect(0, 0, W, B);
    ctx.fillRect(0, 0, B, H);
    ctx.fillStyle = '#3a3b43';
    ctx.fillRect(0, B - dpr, W, dpr);
    ctx.fillRect(B - dpr, 0, dpr, H);
    ctx.font = `${10 * dpr}px "Segoe UI", sans-serif`;
    ctx.fillStyle = ctx.strokeStyle = '#9a9ba5';
    const [a, b, c, d, e, f] = matrix(this.view);
    if (Math.abs(b) > 1e-9 || Math.abs(c) > 1e-9) {  // a turned view has no single x or y along an edge
      ctx.fillText('View is rotated: press 5 to straighten it for the rulers', B + 8 * dpr, 14 * dpr);
      ctx.restore();
      return;
    }
    const z = this.view.zoom, step = niceStep(64 / z), minor = step / 5;
    const showMinor = minor * z >= 5;
    const edge = (horizontal) => {
      const scale = horizontal ? a : d, off = horizontal ? e : f, len = (horizontal ? W : H) / dpr;
      const at = v => (scale * v + off) * dpr;
      const from = (0 - off) / scale, to = (len - off) / scale;
      ctx.beginPath();
      if (showMinor) for (const v of ticks(from, to, minor)) {
        const s = at(v);
        if (horizontal) { ctx.moveTo(s, B - 4 * dpr); ctx.lineTo(s, B); } else { ctx.moveTo(B - 4 * dpr, s); ctx.lineTo(B, s); }
      }
      for (const v of ticks(from, to, step)) {
        const s = at(v);
        if (horizontal) {
          ctx.moveTo(s, B - 10 * dpr); ctx.lineTo(s, B);
          ctx.fillText(String(v), s + 3 * dpr, 10 * dpr);
        } else {
          ctx.moveTo(B - 10 * dpr, s); ctx.lineTo(B, s);
          ctx.save(); ctx.translate(10 * dpr, s + 3 * dpr); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(String(v), 0, 0); ctx.restore();
        }
      }
      ctx.stroke();
    };
    ctx.lineWidth = dpr;
    edge(true);
    edge(false);
    if (this.pointer) {  // where the pointer is
      ctx.fillStyle = '#6ea8ff';
      ctx.fillRect(this.pointer.x * dpr - dpr / 2, 0, dpr, B);
      ctx.fillRect(0, this.pointer.y * dpr - dpr / 2, B, dpr);
    }
    ctx.fillStyle = '#25262c';
    ctx.fillRect(0, 0, B, B);
    ctx.restore();
  },

  // ---------- tool panel ----------

  renderRulerProps(box) {
    const r = this.doc.rulers, n = r.perspective?.points.length || 0;
    box.innerHTML = `
      <div class="field"><span>Perspective ruler</span>
        <div class="seg">${[1, 2, 3].map(k => `<button data-r="p${k}" class="${n === k ? 'on' : ''}">${k}-point</button>`).join('')}
        <button data-r="p0" ${n ? '' : 'disabled'} title="Remove the perspective ruler">${icon('trash', 14)}</button></div>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" data-r="visible" ${r.visible ? 'checked' : ''}> Show guides and perspective</label>
        <label class="check"><input type="checkbox" data-r="snap" ${r.snap ? 'checked' : ''}> Snap strokes to them (Ctrl+2)</label>
        <label class="check"><input type="checkbox" data-r="edge" ${this.showRulers ? 'checked' : ''}> Rulers along the edges</label>
      </div>
      <div class="btn-row"><button data-r="clear" ${r.guides.length ? '' : 'disabled'}>Clear ${r.guides.length || ''} guide${r.guides.length === 1 ? '' : 's'}</button></div>
      <p class="hint">Drag out of an edge ruler to add a guide, drag a guide back onto it to remove it. With this tool, drag guides and the round vanishing points to move them.</p>`;
    const acts = {
      p1: () => this.setPerspective(1), p2: () => this.setPerspective(2), p3: () => this.setPerspective(3), p0: () => this.setPerspective(0),
      clear: () => this.clearGuides(),
    };
    box.querySelectorAll('button[data-r]').forEach(bt => { bt.onclick = () => acts[bt.dataset.r](); });
    box.querySelector('[data-r="visible"]').onchange = () => this.toggleRulerVisibility();
    box.querySelector('[data-r="snap"]').onchange = () => this.toggleSnap();
    box.querySelector('[data-r="edge"]').onchange = () => this.toggleEdgeRulers();
  },
};
