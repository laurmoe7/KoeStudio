// The Line edit tool (Y): changes finished lines on a vector layer. Click a line to pick it (the nearest one under
// the pointer); drag from anywhere on it to pull that part along, softly out to the Pull range; the tool panel
// changes the picked line's width, opacity and colour, or deletes it. Every change is one vector undo step.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { nearestStroke, pullStroke, editStroke, removeStroke, MIN_WIDTH, MAX_WIDTH } from '../vector.js';
import { esc, toast } from '../ui.js';
import { toDoc, matrix } from '../view.js';

const PICK_PX = 8;  // a click this close (screen px) to a line's edge picks it
const DRAG_PX = 2;  // the pointer must move this far before a click turns into a pull

export const lineEditMethods = {
  /** The vector layer the tool works on, or null after saying why not. */
  lineEditLayer() {
    const layer = this.target('edit lines on', { vector: true });
    if (layer && !layer.vector) { toast('Line edit changes lines on a vector layer (Layer → New vector layer). Select one first.'); return null; }
    return layer;
  },

  /** The picked line, when it is still on its layer: {layer, v, i, s}; else null. */
  pickedLine() {
    const p = this.vline, v = p?.layer.vector;
    const i = v ? v.strokes.indexOf(p.stroke) : -1;
    return i >= 0 && p.layer === this.doc.active ? { layer: p.layer, v, i, s: v.strokes[i] } : null;
  },

  beginLineEdit(dp, id) {
    const layer = this.lineEditLayer();
    if (!layer) return;
    const v = layer.vector, i = nearestStroke(v, dp.x, dp.y, PICK_PX / this.view.zoom);
    if (i < 0) { this.vline = null; this.renderToolProps(); return; }
    this.vline = { layer, stroke: v.strokes[i] };
    this.gesture = { type: 'lineedit', tool: 'lineedit', id, layer, before: v, index: i, orig: v.strokes[i], grab: dp, moved: false };
    this.renderToolProps();
  },

  lineEditDrag(dp) {
    const g = this.gesture;
    if (!g.moved && Math.hypot(dp.x - g.grab.x, dp.y - g.grab.y) * this.view.zoom < DRAG_PX) return;
    g.moved = true;
    const pulled = pullStroke(g.orig, g.grab, dp, this.settings.lineedit.reach, 2);
    const next = editStroke(g.before, g.index, { pts: pulled.pts });
    this.showVector(g.layer, g.layer.vector, next);
    this.vline = { layer: g.layer, stroke: next.strokes[g.index] };
  },

  endLineEdit() {
    const g = this.gesture;
    if (g.moved) this.pushVectorStep(g.layer, g.before, g.layer.vector, 'Reshape line');
  },

  /**
   * Changes the picked line. With preview the change is only shown (a slider being dragged); the step is recorded
   * by the next call without preview, from where the preview started.
   */
  setLineProps(props, label, preview = false) {
    const p = this.pickedLine();
    if (!p) return;
    const next = editStroke(p.v, p.i, props);
    this.lineEditStart ||= p.v;
    this.showVector(p.layer, p.v, next);
    this.vline = { layer: p.layer, stroke: next.strokes[p.i] };
    if (preview) return;
    const before = this.lineEditStart;
    this.lineEditStart = null;
    this.pushVectorStep(p.layer, before, next, label);
  },

  deleteLine() {
    const p = this.pickedLine();
    if (!p) return false;
    const next = removeStroke(p.v, p.i);
    this.showVector(p.layer, p.v, next);
    this.pushVectorStep(p.layer, p.v, next, 'Delete line');
    this.vline = null;
    this.renderToolProps();
    return true;
  },

  /** The picked line's controls under the tool settings. */
  renderLineEditProps(box) {
    const p = this.pickedLine();
    if (!p) {
      box.insertAdjacentHTML('beforeend', '<p class="hint">On a vector layer: click a line to pick it, then drag along it to bend it. The pull range sets how much of the line follows.</p>');
      return;
    }
    const w = p.s.w || 1, op = p.s.opacity;
    box.insertAdjacentHTML('beforeend', `
      <div class="le-head"><span class="le-swatch" style="background:${esc(p.s.color)}"></span>Picked line</div>
      <label class="slider" title="The picked line's width, compared with how it was drawn"><span>Width</span>
        <input type="range" data-l="w" min="${MIN_WIDTH}" max="${MAX_WIDTH}" step="0.05" value="${w}"><output>${Math.round(w * 100)}%</output></label>
      <label class="slider"><span>Opacity</span>
        <input type="range" data-l="opacity" min="0.01" max="1" step="0.01" value="${op}"><output>${Math.round(op * 100)}%</output></label>
      <div class="btn-row"><button data-l="color" title="Give the line the main colour">Main colour</button><button data-l="delete" title="Delete the line (Del)">Delete line</button></div>`);
    box.querySelectorAll('input[data-l]').forEach(inp => {
      const k = inp.dataset.l, label = k === 'w' ? 'Line width' : 'Line opacity';
      inp.addEventListener('input', () => {
        inp.nextElementSibling.textContent = Math.round(inp.value * 100) + '%';
        this.setLineProps({ [k]: +inp.value }, label, true);
      });
      inp.addEventListener('change', () => this.setLineProps({ [k]: +inp.value }, label));
    });
    box.querySelector('[data-l="color"]').onclick = () => { this.setLineProps({ color: this.colors.main }, 'Line colour'); this.renderToolProps(); };
    box.querySelector('[data-l="delete"]').onclick = () => this.deleteLine();
  },

  /** On the overlay: the line under the pointer (thin), the picked line (accent) and the pull range. */
  drawLineEditOverlay(ctx) {
    if (this.tool !== 'lineedit') return;
    const layer = this.doc.active, v = layer?.vector;
    if (!v) return;
    const dpr = this.dpr || 1, [a, b, c, d, e, f] = matrix(this.view);
    const path = s => {
      ctx.beginPath();
      s.pts.forEach(([x, y], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, (a * x + c * y + e) * dpr, (b * x + d * y + f) * dpr));
    };
    ctx.save();
    ctx.lineJoin = ctx.lineCap = 'round';
    const at = this.pointer && toDoc(this.view, this.pointer.x, this.pointer.y);
    if (at && !this.gesture) {
      const h = nearestStroke(v, at.x, at.y, PICK_PX / this.view.zoom);
      if (h >= 0 && v.strokes[h] !== this.vline?.stroke) {
        ctx.strokeStyle = 'rgba(110,168,255,.55)'; ctx.lineWidth = 2 * dpr; path(v.strokes[h]); ctx.stroke();
      }
    }
    const p = this.pickedLine();
    if (p) {
      for (const [color, w] of [['rgba(0,0,0,.55)', 3.5], ['#6ea8ff', 1.6]]) { ctx.strokeStyle = color; ctx.lineWidth = w * dpr; path(p.s); ctx.stroke(); }
    }
    if (this.pointer) {
      const r = this.settings.lineedit.reach * this.view.zoom * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      for (const [color, w] of [['rgba(0,0,0,.6)', 2], ['rgba(255,255,255,.9)', 1]]) {
        ctx.strokeStyle = color; ctx.lineWidth = w * dpr;
        ctx.beginPath(); ctx.arc(this.pointer.x * dpr, this.pointer.y * dpr, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  },
};

