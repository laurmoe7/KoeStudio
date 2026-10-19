// Edge rulers, guides, the perspective ruler and stroke snapping. Editor methods (mixed into Editor.prototype).
//
// Guides are made by dragging out of the edge rulers (top = horizontal, left = vertical) and removed by dragging
// them back. The Ruler tool (U) moves guides and vanishing points. Ruler edits are undo steps and are saved with
// the artwork (doc.rulers); the edge rulers themselves are a view setting.

import { icon } from '../icons.js';
import { newPerspective, niceStep, ticks, snapCandidates, pickLine, project, guideAt, gridStep, snapToGrid, snapToGuides, sanitizeGrid, MAX_GUIDES,
  MAX_SHAPES, sanitizeShape, shapeHandles, shapeHandleAt, dragShapeHandle, shapeFromDrag, curveFromStroke, curvePath } from '../rulers.js';
import { modal, store, toast } from '../ui.js';
import { matrix, toScreen, toDoc } from '../view.js';

export const RULER_PX = 20;   // thickness of the edge rulers, in screen pixels
const GRAB_PX = 6;            // how close (screen px) the pointer must be to a guide to grab it
const VP_PX = 10;             // ... or to a vanishing point
const GRID_SNAP_PX = 10;      // corners of selections, figures and crops this close (on screen) to a grid line go onto it
const SNAP_PX = 6;            // how far the pen moves before a stroke picks its snap line
const LINE_SNAP_PX = 24;      // a stroke starting this close (on screen) to a straight-line ruler follows it
const HANDLE_PX = 8;          // grab distance of straight-line, concentric and curve ruler handles
const MAKE_PX = 6;            // a drag on empty canvas shorter than this makes no new ruler
const SHAPE_COLOR = 'rgba(70, 220, 160, 0.9)';
const SHAPE_FAINT = 'rgba(70, 220, 160, 0.3)';
const SHAPE_LABELS = { line: 'Straight-line ruler', ellipse: 'Concentric ruler', curve: 'Curve ruler' };  // undo step names, by kind
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

  clearShapes() {
    this.rulerPick = -1;
    this.editRulers('Clear rulers', () => { this.doc.rulers.shapes = []; });
  },

  /** The picked straight-line or concentric ruler's index, or -1 (undo may have removed it). */
  pickedShape() {
    const i = this.rulerPick ?? -1;
    return i >= 0 && i < this.doc.rulers.shapes.length ? i : -1;
  },

  /** Removes the picked ruler (Del with the Ruler tool); false when none is picked. */
  deleteShape() {
    const i = this.pickedShape();
    if (i < 0) return false;
    this.rulerPick = -1;
    this.editRulers('Remove ruler', () => { this.doc.rulers.shapes.splice(i, 1); });
    return true;
  },

  /** Adds a straight-line or concentric ruler in the middle of what is on screen. */
  addShape(kind) {
    const r = this.doc.rulers;
    if (r.shapes.length >= MAX_SHAPES) return toast(`There can be at most ${MAX_SHAPES} rulers.`);
    const box = this.viewport.getBoundingClientRect();
    const c = toDoc(this.view, box.width / 2, box.height / 2), reach = Math.min(box.width, box.height) / 4 / this.view.zoom;
    const shape = kind === 'curve'  // a gentle S across the middle of the view
      ? sanitizeShape({ type: 'curve', pts: [[c.x - reach, c.y], [c.x - reach / 3, c.y - reach / 3], [c.x + reach / 3, c.y + reach / 3], [c.x + reach, c.y]] })
      : sanitizeShape(shapeFromDrag(kind, c, { x: c.x + reach, y: c.y }));
    if (kind === 'line') { shape.x1 = c.x - reach; shape.x2 = c.x + reach; }
    this.editRulers(SHAPE_LABELS[kind], () => { r.shapes.push(shape); r.visible = true; });
    this.rulerPick = r.shapes.length - 1;
    this.renderToolProps();
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
        <label class="check"><input type="checkbox" name="snap"${before.snap ? ' checked' : ''}> Snap to the grid: strokes started on a line follow it; selections, figures and crops snap their corners (with Snap to rulers on)</label>
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

  /** A selection, figure or crop corner moved onto the grid (when it is shown and snaps) and onto guides (when they
   *  are shown), while snapping is on. A nearby guide wins over the grid. */
  gridPoint(dp) {
    const r = this.doc.rulers, tol = GRID_SNAP_PX / this.view.zoom;
    if (!r.snap) return dp;
    const p = r.grid.show && r.grid.snap ? snapToGrid(r.grid, dp, tol) : dp;
    if (!r.visible || !r.guides.length) return p;
    const g = snapToGuides(r.guides, dp, tol);
    return { ...p, x: g.x !== dp.x ? g.x : p.x, y: g.y !== dp.y ? g.y : p.y };
  },

  updateSnapButton() {
    const b = this.root.querySelector('[data-act="snap"]');
    if (!b) return;
    const r = this.doc.rulers;
    const on = r.snap && ((r.visible && (r.guides.length || r.perspective || r.shapes.length)) || (r.grid.show && r.grid.snap));
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

  /** The Ruler tool grabs a ruler handle, vanishing point or guide under the pointer; on empty canvas it drags out a
   *  new straight-line or concentric ruler (the kind picked in the tool panel). */
  beginRulerTool(dp, id) {
    const r = this.doc.rulers;
    if (this.symAt(dp)) { this.gesture = { type: 'vp', tool: 'ruler', id, index: 'sym', before: clone(r) }; return; }
    if (!r.visible) return toast('Rulers are hidden. Turn them on in the Ruler tool settings.');
    const sh = shapeHandleAt(r.shapes, dp, HANDLE_PX / this.view.zoom);
    if (sh) {
      const hd = shapeHandles(r.shapes[sh.index]).find(x => x.h === sh.h);
      this.rulerPick = sh.index;
      this.gesture = { type: 'shape', tool: 'ruler', id, index: sh.index, h: sh.h, off: { x: dp.x - hd.x, y: dp.y - hd.y }, before: clone(r) };
      this.renderToolProps();
      return;
    }
    const vp = this.vpAt(dp);
    if (vp >= 0) { this.gesture = { type: 'vp', tool: 'ruler', id, index: vp, before: clone(r) }; return; }
    const gi = guideAt(r.guides, dp, GRAB_PX / this.view.zoom);
    if (gi >= 0) {
      const g = r.guides[gi];
      this.gesture = { type: 'guide', tool: 'ruler', id, index: gi, axis: g.axis, pos: g.pos, before: clone(r) };
      return;
    }
    if (this.rulerPick >= 0) { this.rulerPick = -1; this.renderToolProps(); }
    if (r.shapes.length >= MAX_SHAPES) return;
    this.gesture = { type: 'shape', tool: 'ruler', id, index: -1, start: { x: dp.x, y: dp.y }, kind: this.rulerMake || 'line', path: [{ x: dp.x, y: dp.y }], before: clone(r) };
  },

  vpAt(dp) {
    const pts = this.doc.rulers.perspective?.points || [];
    const s = toScreen(this.view, dp.x, dp.y);
    return pts.findIndex(p => { const q = toScreen(this.view, p.x, p.y); return Math.hypot(q.x - s.x, q.y - s.y) <= VP_PX; });
  },

  rulerDrag(dp, shift = false) {
    const g = this.gesture, r = this.doc.rulers;
    if (g.type === 'shape' && g.index < 0) {  // dragging out a new ruler: shown once the drag is long enough
      const far = Math.hypot(dp.x - g.start.x, dp.y - g.start.y) * this.view.zoom >= MAKE_PX;
      if (g.kind === 'curve') {  // drawn freehand, thinned to a few points (3 screen px off at most)
        g.path.push({ x: dp.x, y: dp.y });
        g.shape = far || g.path.length > 8 ? curveFromStroke(g.path, 3 / this.view.zoom) : null;
      } else g.shape = far ? sanitizeShape(shapeFromDrag(g.kind, g.start, dp, shift)) : null;
    } else if (g.type === 'shape') {
      r.shapes[g.index] = dragShapeHandle(r.shapes[g.index], g.h, { x: dp.x - g.off.x, y: dp.y - g.off.y }, shift);
    } else if (g.type === 'vp' && g.index === 'sym') r.symmetry = { ...r.symmetry, x: Math.round(dp.x), y: Math.round(dp.y) };
    else if (g.type === 'vp') r.perspective.points[g.index] = { x: Math.round(dp.x), y: Math.round(dp.y) };
    else {
      g.pos = Math.round(g.axis === 'h' ? dp.y : dp.x);
      if (g.index >= 0) r.guides[g.index].pos = g.pos;
    }
    this.drawOverlay();
  },

  /** Ends a guide or vanishing point drag; a guide dropped on an edge ruler is removed. */
  rulerEnd(p) {
    const g = this.gesture, r = this.doc.rulers;
    if (g.type === 'shape') {
      if (g.index >= 0) {
        const s = sanitizeShape(r.shapes[g.index]);
        return this.editRulers('Move ruler', () => { if (s) r.shapes[g.index] = s; else r.shapes.splice(g.index, 1); }, g.before);
      }
      if (!g.shape) return;
      this.editRulers(SHAPE_LABELS[g.kind], () => { r.shapes.push(g.shape); }, g.before);
      this.rulerPick = r.shapes.length - 1;
      return this.renderToolProps();
    }
    const dropped = this.rulerBand(p) && g.type === 'guide';
    this.editRulers(g.index === 'sym' ? 'Move symmetry centre' : g.type === 'vp' ? 'Move vanishing point' : dropped ? 'Remove guide' : g.index < 0 ? 'Add guide' : 'Move guide', () => {
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
    if (g?.type === 'vp' || (g?.type === 'shape' && g.index >= 0)) return 'grabbing';
    if (g?.type === 'shape') return 'crosshair';
    if (this.effectiveTool() === 'ruler' && p && this.symAt(toDoc(this.view, p.x, p.y))) return 'grab';
    if (this.effectiveTool() !== 'ruler' || !p || !this.doc.rulers.visible) return null;
    const dp = toDoc(this.view, p.x, p.y);
    if (shapeHandleAt(this.doc.rulers.shapes, dp, HANDLE_PX / this.view.zoom) || this.vpAt(dp) >= 0) return 'grab';
    const gi = guideAt(this.doc.rulers.guides, dp, GRAB_PX / this.view.zoom);
    if (gi >= 0) return this.doc.rulers.guides[gi].axis === 'h' ? 'row-resize' : 'col-resize';
    return 'crosshair';
  },

  // ---------- snapping strokes ----------

  /** Snap state for a stroke starting at pt, or null when snapping is off or there is nothing to snap to. */
  snapFor(pt) {
    const r = this.doc.rulers;
    if (!r.snap) return null;
    const cands = snapCandidates(r, pt, (GRAB_PX * 2) / this.view.zoom, LINE_SNAP_PX / this.view.zoom);
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
    const shapes = r.visible ? r.shapes.slice() : [];
    if (g?.type === 'shape' && g.shape) shapes.push(g.shape);
    this.drawShapes(ctx, sp, dpr, shapes);
    ctx.restore();
  },

  /** Straight-line rulers (solid between the ends, faint beyond) and concentric rulers (with their handles while the
   *  Ruler tool is in use; the picked one filled). */
  drawShapes(ctx, sp, dpr, shapes) {
    if (!shapes.length) return;
    const tool = this.effectiveTool() === 'ruler', pick = this.pickedShape(), FAR = 1e5;
    shapes.forEach((s, i) => {
      ctx.lineWidth = (i === pick ? 2 : 1.5) * dpr;
      ctx.beginPath();
      if (s.type === 'curve') {
        curvePath(s).forEach((q, k) => (k ? ctx.lineTo(...sp(q.x, q.y)) : ctx.moveTo(...sp(q.x, q.y))));
      } else if (s.type === 'line') {
        const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, ux = (s.x2 - s.x1) / l, uy = (s.y2 - s.y1) / l;
        ctx.strokeStyle = SHAPE_FAINT;
        ctx.moveTo(...sp(s.x1 - ux * FAR, s.y1 - uy * FAR)); ctx.lineTo(...sp(s.x2 + ux * FAR, s.y2 + uy * FAR));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(...sp(s.x1, s.y1)); ctx.lineTo(...sp(s.x2, s.y2));
      } else {
        const cos = Math.cos(s.angle), sin = Math.sin(s.angle), n = 96;
        for (let k = 0; k <= n; k++) {
          const t = (k / n) * Math.PI * 2, ox = s.rx * Math.cos(t), oy = s.ry * Math.sin(t);
          const q = sp(s.x + ox * cos - oy * sin, s.y + ox * sin + oy * cos);
          k ? ctx.lineTo(...q) : ctx.moveTo(...q);
        }
      }
      ctx.strokeStyle = SHAPE_COLOR;
      ctx.stroke();
      if (!tool) return;
      for (const hd of shapeHandles(s)) {
        const [x, y] = sp(hd.x, hd.y), big = hd.h === 'mid' || hd.h === 'c';
        ctx.fillStyle = i === pick ? SHAPE_COLOR : '#fff';
        ctx.strokeStyle = '#1d8f66';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        if (big) ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
        else ctx.rect(x - 4 * dpr, y - 4 * dpr, 8 * dpr, 8 * dpr);
        ctx.fill(); ctx.stroke();
      }
    });
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
    ctx.fillStyle = this.rulerBg;
    ctx.fillRect(0, 0, W, B);
    ctx.fillRect(0, 0, B, H);
    ctx.fillStyle = this.rulerLine;
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
    ctx.fillStyle = this.rulerBg;
    ctx.fillRect(0, 0, B, B);
    ctx.restore();
  },

  // ---------- tool panel ----------

  renderRulerProps(box) {
    const r = this.doc.rulers, n = r.perspective?.points.length || 0, pick = this.pickedShape();
    const make = SHAPE_LABELS[this.rulerMake] ? this.rulerMake : 'line';
    box.innerHTML = `
      <div class="field"><span>Perspective ruler</span>
        <div class="seg">${[1, 2, 3].map(k => `<button data-r="p${k}" class="${n === k ? 'on' : ''}">${k}-point</button>`).join('')}
        <button data-r="p0" ${n ? '' : 'disabled'} title="Remove the perspective ruler">${icon('trash', 14)}</button></div>
      </div>
      <div class="field"><span>Drag on the canvas for</span>
        <div class="seg">${[['line', 'Straight line'], ['ellipse', 'Concentric'], ['curve', 'Curve']].map(([k, label]) =>
          `<button data-make="${k}" class="${make === k ? 'on' : ''}" title="${k === 'line' ? 'Strokes started near the line follow it' : k === 'curve' ? 'Draw the curve freehand; strokes started near it follow it. Drag its points to reshape it' : 'Every stroke follows a circle (or ellipse) around the same centre'}">${label}</button>`).join('')}</div>
      </div>
      <div class="btn-row">
        <button data-r="addline" title="Add a straight-line ruler in the middle of the view">+ Line</button>
        <button data-r="addellipse" title="Add a concentric ruler in the middle of the view">+ Concentric</button>
        <button data-r="addcurve" title="Add a curve ruler in the middle of the view">+ Curve</button>
        <button data-r="delshape" ${pick >= 0 ? '' : 'disabled'} title="Remove the picked ruler (Del)">${icon('trash', 14)}</button>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" data-r="visible" ${r.visible ? 'checked' : ''}> Show rulers and guides</label>
        <label class="check"><input type="checkbox" data-r="snap" ${r.snap ? 'checked' : ''}> Snap strokes to them (Ctrl+2)</label>
        <label class="check"><input type="checkbox" data-r="edge" ${this.showRulers ? 'checked' : ''}> Rulers along the edges</label>
      </div>
      <div class="btn-row"><button data-r="clear" ${r.guides.length ? '' : 'disabled'}>Clear ${r.guides.length || ''} guide${r.guides.length === 1 ? '' : 's'}</button>
        <button data-r="clearshapes" ${r.shapes.length ? '' : 'disabled'}>Clear ${r.shapes.length || ''} ruler${r.shapes.length === 1 ? '' : 's'}</button></div>
      <p class="hint">Drag out of an edge ruler to add a guide, drag a guide back onto it to remove it. With this tool, drag guides, vanishing points and ruler handles to move them (Shift: 15° steps, or a circle). Ctrl+2 turns snapping off for free strokes.</p>`;
    const acts = {
      p1: () => this.setPerspective(1), p2: () => this.setPerspective(2), p3: () => this.setPerspective(3), p0: () => this.setPerspective(0),
      clear: () => this.clearGuides(), clearshapes: () => this.clearShapes(),
      addline: () => this.addShape('line'), addellipse: () => this.addShape('ellipse'), addcurve: () => this.addShape('curve'), delshape: () => this.deleteShape(),
    };
    box.querySelectorAll('button[data-r]').forEach(bt => { bt.onclick = () => acts[bt.dataset.r](); });
    box.querySelectorAll('button[data-make]').forEach(bt => {
      bt.onclick = () => { this.rulerMake = bt.dataset.make; store('rulerMake', this.rulerMake); this.renderToolProps(); };
    });
    box.querySelector('[data-r="visible"]').onchange = () => this.toggleRulerVisibility();
    box.querySelector('[data-r="snap"]').onchange = () => this.toggleSnap();
    box.querySelector('[data-r="edge"]').onchange = () => this.toggleEdgeRulers();
  },
};
