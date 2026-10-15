// Vector layers in the editor: making one, drawing lines into it with the pen tools and the Figure tool, erasing
// lines with the Eraser's vector modes (Touched area, Up to intersection, Whole line), and rasterizing.
// A vector layer is an ordinary Layer with `vector` data (vector.js); its pixels are always renderVector of it.
// Every edit swaps the whole (immutable) vector object, and undo swaps it back and redraws what differs.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { Layer } from '../doc.js';
import { symmetryPoints } from '../symmetry.js';
import { stampAt } from '../brush.js';
import { emptyVector, addStrokes, resample, changedBounds, eraseVector } from '../vector.js';
import { renderVector } from '../vectorlayer.js';
import { toast } from '../ui.js';

export const vectorMethods = {
  newVectorLayer() {
    const d = this.doc;
    this.insertNode(new Layer(d.width, d.height, { name: d.newName('Vector'), vector: emptyVector() }), 'New vector layer');
    toast('Vector layer: lines stay editable. The Eraser can remove whole lines or cut them back to where they cross.');
  },

  /** Turns a vector layer into ordinary pixels (an undo step); tools that need pixels offer this. */
  rasterizeVector(layer) {
    const v = layer.vector;
    if (!v) return;
    this.structural('Rasterize vector layer', () => { layer.vector = null; }, () => { layer.vector = v; });
    toast('The lines are now ordinary pixels you can paint on.');
  },

  /** Redraws what differs between two vector objects after making `to` the layer's lines. */
  showVector(layer, from, to) {
    layer.vector = to;
    const r = changedBounds(from, to);
    if (!r) return;
    renderVector(layer, r);
    this.changed(r);
  },

  /** Records a change of a layer's lines (already shown) as one undo step. */
  pushVectorStep(layer, before, after, label) {
    const points = v => v.strokes.reduce((n, s) => n + s.pts.length, 0);
    this.history.push({ label, bytes: (points(before) + points(after)) * 24 + 1024,
      undo: () => this.showVector(layer, after, before), redo: () => this.showVector(layer, before, after) });
  },

  /**
   * Turns a finished pen stroke (its smoothed path, [[x, y, p]]) into vector lines, one per symmetric copy, and
   * replaces the live stroke with them. s: the tool settings it was drawn with.
   */
  commitVectorStroke(layer, pts, s, opacity, label, color = this.inkFor(layer)) {
    this.live = null;
    if (!pts.length) { this.updateComp(null); this.requestRender(); return; }
    const d = this.doc, base = resample(pts, Math.max(1, Math.min(4, s.size * 0.15)));
    const copies = base.map(([x, y]) => symmetryPoints(d.rulers.symmetry, x, y, d.width, d.height));
    const r2 = v => Math.round(v * 100) / 100;
    const strokes = copies[0].map((_, k) => ({
      pts: base.map((q, i) => [r2(copies[i][k].x), r2(copies[i][k].y), q[2]]),
      color, opacity, seed: Math.floor(Math.random() * 2147483646) + 1,
    }));
    const before = layer.vector, after = addStrokes(before, s, strokes);
    this.showVector(layer, before, after);
    this.pushVectorStep(layer, before, after, label);
  },

  /** A Figure outline as a vector line: even pressure, the figure's size, hardness and opacity. */
  commitVectorFigure(layer, points, closed, s) {
    const pts = points.map(p => [p.x, p.y, 1]);
    if (closed && pts.length > 1) pts.push(pts[0].slice());
    const brush = { size: s.size, hardness: s.hardness, flow: 1, spacing: 0.08, pressureSize: false, pressureOpacity: false };
    this.commitVectorStroke(layer, pts, brush, s.opacity, 'Figure');
  },

  // ---------- erasing lines ----------

  beginVectorErase(toolId, pt, id, layer) {
    const s = this.settings[toolId];
    this.gesture = { type: 'verase', tool: toolId, id, layer, s, before: layer.vector, last: pt };
    this.vectorEraseTo(pt);
  },

  vectorEraseTo(pt) {
    const g = this.gesture, cur = g.layer.vector;
    const next = eraseVector(cur, g.s.vectorErase, [g.last.x, g.last.y], [pt.x, pt.y], stampAt(g.s, pt.p).size / 2);
    g.last = pt;
    if (next !== cur) this.showVector(g.layer, cur, next);
    this.requestRender();
  },

  endVectorErase() {
    const g = this.gesture;
    if (g.layer.vector !== g.before) this.pushVectorStep(g.layer, g.before, g.layer.vector, 'Erase lines');
  },
};
