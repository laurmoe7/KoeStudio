// The Control point tool (Y, after Line edit), as Clip Studio Paint's: click a line on a vector layer to see its
// Bezier control points, drag a point to move it, drag a handle to bend the curve (a smooth point stays smooth;
// Alt bends one side only), Alt+click a point to switch it between corner and smooth, double-click the line to add
// a point there and double-click a point to remove it. A line drawn freehand gets its control points from fitCurve
// the first time one is changed. Simplify (here and in Line edit) refits a line, or every line, to fewer points.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor; the picked line is the
// Line edit tool's `this.vline`, the picked point `this.vpoint` (its index).

import { fitCurve, nearestOnCurve, splitAt, removeAnchor, moveAnchor, moveHandle, toggleCorner, isSmooth, setPressure } from '../bezier.js';
import { nearestStroke, editStroke, curveStroke, simplifyStroke } from '../vector.js';
import { toast } from '../ui.js';
import { toDoc, matrix } from '../view.js';

const PICK_PX = 8;     // a click this close (screen px) to a line's edge picks it
const HIT_PX = 7;      // ... to a point or handle grabs it
const DRAG_PX = 2;     // the pointer must move this far before a press turns into a drag
const FIT_TOL = 1;     // px: how closely the control points first given to a freehand line follow it

const fitted = new WeakMap();  // freehand line -> its control points, worked out once while it is shown

/** A line's control points (its own, or fitted to its path) and whether it is closed. */
export function ctrlOf(s) {
  if (s.ctrl) return { ctrl: s.ctrl, closed: !!s.closed };
  let c = fitted.get(s);
  if (!c) fitted.set(s, c = fitCurve(s.pts, FIT_TOL));
  return { ctrl: c, closed: false };
}

/** Indices of the anchors whose handles show: the picked one and its neighbours (all when nothing is picked and few). */
function handleAnchors(ctrl, closed, k) {
  const n = ctrl.length;
  if (k == null || k >= n) return n <= 12 ? ctrl.map((_, i) => i) : [];
  return [...new Set([k - 1, k, k + 1].map(i => (closed ? (i + n) % n : i)).filter(i => i >= 0 && i < n))];
}

export const ctrlPointMethods = {
  /** The picked line's control points for this tool: {layer, v, i, s, ctrl, closed}, or null. */
  pickedCurve() {
    const p = this.pickedLine();
    return p && { ...p, ...ctrlOf(p.s) };
  },

  /** What is under doc point dp on the picked line: {part: 'in' | 'out' | 'anchor', i} or {part: 'curve', seg, t}, or null. */
  ctrlHit(c, dp) {
    const r = HIT_PX / this.view.zoom;
    for (const i of handleAnchors(c.ctrl, c.closed, this.vpoint)) {
      const a = c.ctrl[i];
      for (const [part, hx, hy] of [['out', a[5], a[6]], ['in', a[3], a[4]]]) {
        if ((hx || hy) && Math.hypot(dp.x - a[0] - hx, dp.y - a[1] - hy) <= r) return { part, i };
      }
    }
    let best = null, bd = r;
    c.ctrl.forEach((a, i) => { const d = Math.hypot(dp.x - a[0], dp.y - a[1]); if (d <= bd) { bd = d; best = { part: 'anchor', i }; } });
    if (best) return best;
    const n = nearestOnCurve(c.ctrl, c.closed, dp.x, dp.y);
    return n.d <= Math.max(r, PICK_PX / this.view.zoom) ? { part: 'curve', seg: n.seg, t: n.t } : null;
  },

  /** Puts new control points on the picked line and records it (one undo step), or only shows them while dragging. */
  setCurve(c, ctrl, label, preview = false, from = c.v) {
    const next = editStroke(c.v, c.i, curveStroke(c.s, ctrl, c.closed));
    this.showVector(c.layer, c.layer.vector, next);
    this.vline = { layer: c.layer, stroke: next.strokes[c.i] };
    if (!preview) this.pushVectorStep(c.layer, from, next, label);
    this.drawOverlay();
    return next;
  },

  beginCtrlPoint(dp, id, e) {
    const layer = this.lineEditLayer();
    if (!layer) return;
    const c = this.pickedCurve(), hit = c && this.ctrlHit(c, dp), dbl = e.detail >= 2;
    if (hit && hit.part === 'curve') {
      if (dbl) {  // add a point here
        const [ctrl, k] = splitAt(c.ctrl, c.closed, hit.seg, hit.t);
        this.setCurve(c, ctrl, 'Add control point');
        this.vpoint = k;
      } else this.vpoint = null;
      this.renderToolProps();
      return;
    }
    if (hit) {
      if (hit.part === 'anchor' && dbl) {
        if (c.ctrl.length > 2) { this.setCurve(c, removeAnchor(c.ctrl, hit.i), 'Delete control point'); this.vpoint = null; }
        else toast('A line keeps at least two control points. Del deletes the whole line.');
        this.renderToolProps();
        return;
      }
      if (hit.part === 'anchor' && e.altKey) {
        const ctrl = toggleCorner(c.ctrl, c.closed, hit.i);
        if (ctrl !== c.ctrl) this.setCurve(c, ctrl, 'Corner / smooth point');  // unchanged: no empty undo step
        this.vpoint = hit.i;
        this.renderToolProps();
        return;
      }
      this.vpoint = hit.i;
      this.gesture = { type: 'ctrlpoint', tool: 'ctrlpoint', id, c, hit, grab: dp, moved: false,
        mirror: hit.part !== 'anchor' && !e.altKey && isSmooth(c.ctrl[hit.i]) };
      this.renderToolProps();
      return;
    }
    const v = layer.vector, i = nearestStroke(v, dp.x, dp.y, PICK_PX / this.view.zoom);
    if (i < 0 || v.strokes[i] !== this.vline?.stroke) this.vpoint = null;
    this.vline = i < 0 ? null : { layer, stroke: v.strokes[i] };
    this.renderToolProps();
  },

  ctrlPointDrag(dp, alt) {
    const g = this.gesture, { c, hit } = g;
    if (!g.moved && Math.hypot(dp.x - g.grab.x, dp.y - g.grab.y) * this.view.zoom < DRAG_PX) return;
    g.moved = true;
    const a = c.ctrl[hit.i];
    const ctrl = hit.part === 'anchor' ? moveAnchor(c.ctrl, hit.i, a[0] + dp.x - g.grab.x, a[1] + dp.y - g.grab.y)
      : moveHandle(c.ctrl, hit.i, hit.part, dp.x, dp.y, g.mirror && !alt);
    this.setCurve(c, ctrl, '', true);
  },

  endCtrlPoint() {
    const g = this.gesture;
    if (!g.moved) return;
    const now = this.pickedCurve();
    if (now) this.pushVectorStep(g.c.layer, g.c.v, g.c.layer.vector, g.hit.part === 'anchor' ? 'Move control point' : 'Bend line');
    this.renderToolProps();
  },

  /** Del with this tool: the picked point (when the line keeps two), else the picked line. */
  deleteCtrlPoint() {
    const c = this.pickedCurve();
    if (c && this.vpoint != null && this.vpoint < c.ctrl.length && c.ctrl.length > 2) {
      this.setCurve(c, removeAnchor(c.ctrl, this.vpoint), 'Delete control point');
      this.vpoint = null;
      this.renderToolProps();
      return true;
    }
    return this.deleteLine();
  },

  /** Simplify: the picked line, or with none picked every line on the layer, refitted within the tool's Simplify by. */
  simplifyLines() {
    const tol = this.settings[this.tool].simplify ?? 2;
    const p = this.pickedLine();
    if (p) {
      const next = editStroke(p.v, p.i, simplifyStroke(p.s, tol));
      this.showVector(p.layer, p.v, next);
      this.pushVectorStep(p.layer, p.v, next, 'Simplify line');
      this.vline = { layer: p.layer, stroke: next.strokes[p.i] };
      this.vpoint = null;
      this.renderToolProps();
      this.drawOverlay();
      return;
    }
    const layer = this.lineEditLayer();
    if (!layer || !layer.vector.strokes.length) return;
    const before = layer.vector, after = { brushes: before.brushes, strokes: before.strokes.map(s => simplifyStroke(s, tol)) };
    this.showVector(layer, before, after);
    this.pushVectorStep(layer, before, after, 'Simplify lines');
    const n = after.strokes.reduce((k, s) => k + s.ctrl.length, 0);
    this.drawOverlay();
    toast(`${after.strokes.length} line${after.strokes.length === 1 ? '' : 's'} simplified to ${n} control points.`);
  },

  /** The tool panel under the settings: what to do, and for a picked point its pen pressure. */
  renderCtrlPointProps(box) {
    const c = this.pickedCurve();
    const simplify = `<div class="btn-row"><button data-cp="simplify" title="Refit ${c ? 'the line' : 'every line on the layer'} to fewer control points, within Simplify by">${c ? 'Simplify line' : 'Simplify all lines'}</button>${c ? '<button data-cp="delete" title="Delete the line (Del)">Delete line</button>' : ''}</div>`;
    if (!c) {
      box.insertAdjacentHTML('beforeend', `<p class="hint">On a vector layer: click a line to show its control points.</p>${simplify}`);
    } else {
      const a = this.vpoint != null ? c.ctrl[this.vpoint] : null;
      box.insertAdjacentHTML('beforeend', `
        <div class="le-head"><span class="le-swatch" style="background:${c.s.color}"></span>Picked line: ${c.ctrl.length} points</div>
        ${a ? `<label class="slider" title="Pen pressure at this point: how thick (and strong) the line is here"><span>Pressure</span>
          <input type="range" data-cp="p" min="0" max="1" step="0.01" value="${a[2]}"><output>${Math.round(a[2] * 100)}%</output></label>` : ''}
        ${simplify}
        <p class="hint">Drag a point or a handle. Double-click the line to add a point, a point to remove it. Alt+click a point: corner or smooth.</p>`);
      const inp = box.querySelector('[data-cp="p"]');
      if (inp) {
        let from = null;
        inp.addEventListener('input', () => {
          inp.nextElementSibling.textContent = Math.round(inp.value * 100) + '%';
          const now = this.pickedCurve();
          from ||= now.v;
          this.setCurve(now, setPressure(now.ctrl, this.vpoint, +inp.value), '', true);
        });
        inp.addEventListener('change', () => {
          const now = this.pickedCurve();
          this.setCurve(now, setPressure(now.ctrl, this.vpoint, +inp.value), 'Point pressure', false, from || now.v);
          from = null;
        });
      }
      box.querySelector('[data-cp="delete"]').onclick = () => this.deleteLine();
    }
    box.querySelector('[data-cp="simplify"]').onclick = () => this.simplifyLines();
  },

  /** On the overlay: the line under the pointer, the picked line with its control points and handles. */
  drawCtrlPointOverlay(ctx) {
    if (this.tool !== 'ctrlpoint') return;
    const layer = this.doc.active, v = layer?.vector;
    if (!v) return;
    const dpr = this.dpr || 1, [a, b, cc, d, e, f] = matrix(this.view);
    const sx = (x, y) => (a * x + cc * y + e) * dpr, sy = (x, y) => (b * x + d * y + f) * dpr;
    const path = pts => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, sx(x, y), sy(x, y))); };
    ctx.save();
    ctx.lineJoin = ctx.lineCap = 'round';
    const at = this.pointer && toDoc(this.view, this.pointer.x, this.pointer.y);
    if (at && !this.gesture) {
      const h = nearestStroke(v, at.x, at.y, PICK_PX / this.view.zoom);
      if (h >= 0 && v.strokes[h] !== this.vline?.stroke) { ctx.strokeStyle = 'rgba(110,168,255,.55)'; ctx.lineWidth = 2 * dpr; path(v.strokes[h].pts); ctx.stroke(); }
    }
    const c = this.pickedCurve();
    if (c) {
      for (const [color, w] of [['rgba(0,0,0,.55)', 3], ['#6ea8ff', 1.4]]) { ctx.strokeStyle = color; ctx.lineWidth = w * dpr; path(c.s.pts); ctx.stroke(); }
      const R = 3.5 * dpr;
      for (const i of handleAnchors(c.ctrl, c.closed, this.vpoint)) {  // handles: a line out to a dot
        const p = c.ctrl[i];
        for (const [hx, hy] of [[p[3], p[4]], [p[5], p[6]]]) {
          if (!hx && !hy) continue;
          const x0 = sx(p[0], p[1]), y0 = sy(p[0], p[1]), x1 = sx(p[0] + hx, p[1] + hy), y1 = sy(p[0] + hx, p[1] + hy);
          ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1 * dpr; ctx.stroke();
          ctx.fillStyle = '#ffb347'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x1, y1, R * 0.85, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      c.ctrl.forEach((p, i) => {  // anchors: squares, smooth ones round; the picked one filled
        const x = sx(p[0], p[1]), y = sy(p[0], p[1]), on = i === this.vpoint;
        ctx.fillStyle = on ? '#6ea8ff' : '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = dpr;
        ctx.beginPath();
        if (isSmooth(p)) ctx.arc(x, y, R, 0, Math.PI * 2); else ctx.rect(x - R, y - R, 2 * R, 2 * R);
        ctx.fill(); ctx.stroke();
      });
    }
    ctx.restore();
  },
};
