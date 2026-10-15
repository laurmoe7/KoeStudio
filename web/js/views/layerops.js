// Layers, folders and masks: everything that changes the layer tree, plus the operations that work on "the
// current layer" (move, clear, fill, flip). Editor methods (mixed into Editor.prototype in editor.js).
//
// What tools paint on is this.target(): the selected layer, or its mask while mask editing is on (this.maskEdit,
// set by clicking the mask thumbnail). Folders have no pixels of their own, only an optional mask.

import { Layer, Folder, Mask, cloneNode, nodeRasters, renderFolder, tonedCanvas, PASS_THROUGH } from '../doc.js';
import { isFolder, allLayers, contains, removeNode, insertNode, destination, stepTarget } from '../tree.js';
import { toast } from '../ui.js';

/** The node itself or the nearest folder around it that is locked, or null. */
export function lockedNode(n) {
  for (let x = n; x; x = x.parent) if (x.locked) return x;
  return null;
}

export const layerMethods = {
  // ---------- what tools work on ----------

  /**
   * The raster tools change (layer or mask), or null after telling the user why not. verb: 'draw on', 'fill'...
   * read: the tool only reads pixels (copy, select), so text layers are fine as they are.
   */
  target(verb = 'draw on', { read = false } = {}) {
    const n = this.doc.active;
    if (!n.visible) { toast(`This ${isFolder(n) ? 'folder' : 'layer'} is hidden. Show it to ${verb} it.`); return null; }
    const lockedBy = lockedNode(n);
    if (lockedBy) { toast(`${lockedBy === n ? '' : 'Its folder '}"${lockedBy.name}" is locked. Untick Lock in the Layers panel to ${verb} it.`); return null; }
    if (this.maskEdit && n.mask) return n.mask;
    if (isFolder(n)) { toast(`A folder has no pixels of its own. Select a layer inside it to ${verb}, or click the folder's mask.`); return null; }
    if (n.text && !read) {
      toast('This is a text layer. Use the Text tool to change it, or rasterize it to paint on it.', { action: { label: 'Rasterize', run: () => this.rasterizeText(n) }, ms: 6000 });
      return null;
    }
    return n;
  },

  /** Colour to paint with on a target: masks only care about coverage, so they get black. */
  inkFor(t) { return t.kind === 'mask' ? '#000000' : this.colors.main; },

  /** How a stroke lands on a target: erase, paint, or paint only on existing pixels (alpha lock). */
  strokeMode(t, erase) { return erase ? 'destination-out' : t.alphaLock ? 'source-atop' : 'source-over'; },

  // ---------- selecting ----------

  selectNode(node, { mask = false } = {}) {
    this.doc.active = node;
    this.maskEdit = mask && !!node.mask;
    this.layerPanel.render();
    this.doc.version++;
    this.scheduleSave();
  },

  editMask(on) {
    this.maskEdit = on && !!this.doc.active.mask;
    this.layerPanel.render();
  },

  /** Opening and closing folders is not an undo step, but it is saved. */
  toggleOpen(folder) {
    folder.open = !folder.open;
    if (!folder.open && contains(folder, this.doc.active) && this.doc.active !== folder) this.doc.active = folder;
    this.layerPanel.render();
    this.doc.version++;
    this.scheduleSave();
  },

  /** Visibility is not an undo step either (as in other painting programs), but it is saved. */
  toggleVisible(node) {
    node.visible = !node.visible;
    this.layersChanged();
  },

  // ---------- structure ----------

  /** Records and applies a structural change; do() and undo() must leave doc.active sensible. */
  structural(label, doIt, undoIt, bytes = 0) {
    doIt();
    this.history.push({ label, bytes, undo: () => { undoIt(); this.layersChanged(); }, redo: () => { doIt(); this.layersChanged(); } });
    this.layersChanged();
  },

  layersChanged() {
    if (!this.doc.active.mask) this.maskEdit = false;
    this.layerPanel.render();
    this.changed(null);
  },

  /** Puts a new node just above the selected one, in the same folder. */
  insertNode(node, label) {
    const d = this.doc, prev = d.active, prevMask = this.maskEdit;
    const parent = prev.parent, index = parent.children.indexOf(prev) + 1;
    this.structural(label,
      () => { insertNode(parent, index, node); d.active = node; this.maskEdit = false; },
      () => { removeNode(node); d.active = prev; this.maskEdit = prevMask; },
      d.width * d.height * 4);
  },

  layerAdd() {
    const d = this.doc;
    this.insertNode(new Layer(d.width, d.height, { name: d.newName('Layer') }), 'New layer');
  },

  folderAdd() {
    this.insertNode(new Folder({ name: this.doc.newName('Folder') }), 'New folder');
  },

  /** Puts the selected layer or folder into a new folder in its place (Ctrl+G). */
  groupIntoFolder() {
    const d = this.doc, n = d.active, f = new Folder({ name: d.newName('Folder') });
    let at;
    this.structural('Put in new folder',
      () => { at = removeNode(n); insertNode(at.parent, at.index, f); insertNode(f, 0, n); d.active = f; },
      () => { removeNode(n); removeNode(f); insertNode(at.parent, at.index, n); d.active = n; });
  },

  layerDuplicate() {
    const d = this.doc, n = d.active;
    const copy = cloneNode(n, d.width, d.height);
    copy.name = n.name + ' copy';
    this.insertNode(copy, isFolder(n) ? 'Duplicate folder' : 'Duplicate layer');
  },

  layerDelete() {
    const d = this.doc, n = d.active;
    if (!allLayers(d.root).some(l => !contains(n, l))) {
      return toast('An artwork needs at least one layer. Use Edit → Clear layer instead.');
    }
    const parent = n.parent, index = parent.children.indexOf(n);
    // select what was below it, else above it, else the folder it was in
    const next = parent.children[index - 1] || parent.children[index + 1] || (parent.parent ? parent : null) || allLayers(d.root).find(l => !contains(n, l));
    this.structural(isFolder(n) ? 'Delete folder' : 'Delete layer',
      () => { removeNode(n); d.active = next; },
      () => { insertNode(parent, index, n); d.active = n; },
      nodeRasters(n).length * d.width * d.height * 4);
  },

  /** Moves a node above/below another or into a folder ('top-of' / 'bottom-of'), as one undo step. */
  moveNodeTo(node, target, where) {
    const d = this.doc;
    if (!destination(node, target, where)) return;
    let from;
    if (where === 'top-of' || where === 'bottom-of') target.open = true;
    this.structural(isFolder(node) ? 'Move folder' : 'Move layer',
      () => { const dest = destination(node, target, where); from = removeNode(node); insertNode(dest.parent, dest.index, node); d.active = node; },
      () => { removeNode(node); insertNode(from.parent, from.index, node); d.active = node; });
  },

  /** One step up (1) or down (-1) in the layer list, into and out of folders. */
  layerMove(dir) {
    const t = stepTarget(this.doc.active, dir);
    if (t) this.moveNodeTo(this.doc.active, t.target, t.where);
  },

  mergeDown() {
    const d = this.doc, n = d.active;
    if (isFolder(n)) return this.mergeFolder(n);
    const parent = n.parent, i = parent.children.indexOf(n), lower = parent.children[i - 1];
    if (!lower) return toast('There is no layer below this one (in the same folder) to merge into.');
    if (isFolder(lower)) return toast('The layer below is a folder. Use Layer → Merge folder on it first.');
    if (lower.mask) return toast('The layer below has a mask. Apply or delete that mask first.');
    if (!n.visible || !lower.visible) return toast('Show both layers before merging them.');
    const W = d.width, H = d.height;
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const c = src.getContext('2d');
    c.drawImage(n.tone ? tonedCanvas(n) : n.canvas, 0, 0);  // a tone layer merges as the dots it shows
    if (n.mask?.enabled) { c.globalCompositeOperation = 'destination-out'; c.drawImage(n.mask.canvas, 0, 0); }
    if (n.clip) { c.globalCompositeOperation = 'destination-in'; c.drawImage(lower.canvas, 0, 0); }
    const before = lower.ctx.getImageData(0, 0, W, H);
    lower.ctx.save();
    lower.ctx.globalAlpha = n.opacity;
    lower.ctx.globalCompositeOperation = lower.alphaLock ? 'source-atop' : n.blend;
    lower.ctx.drawImage(src, 0, 0);
    lower.ctx.restore();
    const after = lower.ctx.getImageData(0, 0, W, H);
    lower.ctx.putImageData(before, 0, 0);
    const put = img => { lower.ctx.putImageData(img, 0, 0); lower.touch(); };
    const tx = this.textsIn([lower]);  // merged into, a text layer becomes ordinary pixels
    this.structural('Merge down',
      () => { put(after); removeNode(n); d.active = lower; tx.drop(); },
      () => { put(before); insertNode(parent, i, n); d.active = n; tx.restore(); },
      W * H * 12);
  },

  /** Replaces a folder by one layer that looks the same; the folder's opacity, blend and mask carry over. */
  mergeFolder(f) {
    const d = this.doc;
    const layer = new Layer(d.width, d.height, {
      name: f.name, visible: f.visible, opacity: f.opacity, clip: f.clip,
      blend: f.blend === PASS_THROUGH[0] ? 'source-over' : f.blend,
    });
    renderFolder(layer.ctx, f, { x: 0, y: 0, w: d.width, h: d.height });
    layer.mask = f.mask;
    const parent = f.parent, i = parent.children.indexOf(f);
    this.structural('Merge folder',
      () => { removeNode(f); insertNode(parent, i, layer); d.active = layer; },
      () => { removeNode(layer); insertNode(parent, i, f); d.active = f; },
      d.width * d.height * 4);
  },

  /** Layer → Merge visible to new layer: everything visible, as one new layer on top (the layers stay as they are). */
  mergeVisible() {
    const d = this.doc;
    const layer = new Layer(d.width, d.height, { name: 'Merged visible' });
    renderFolder(layer.ctx, d.root, { x: 0, y: 0, w: d.width, h: d.height });
    const root = d.root, prev = d.active;
    this.structural('Merge visible to new layer',
      () => { insertNode(root, root.children.length, layer); d.active = layer; },
      () => { removeNode(layer); d.active = prev; },
      d.width * d.height * 4);
  },

  setLayerProp(node, key, value, label) {
    const old = node[key];
    if (old === value) return this.layerPanel.render();
    this.structural(label, () => { node[key] = value; }, () => { node[key] = old; });
  },

  // ---------- masks ----------

  /** Adds a mask to the selected layer or folder. With a selection, everything outside it is hidden. */
  addMask() {
    const d = this.doc, n = d.active;
    if (n.mask) { this.editMask(true); return toast('This already has a mask. You are now painting on it.'); }
    const m = new Mask(d.width, d.height);
    if (this.sel.active) {
      m.ctx.fillRect(0, 0, d.width, d.height);
      m.ctx.globalCompositeOperation = 'destination-out';
      m.ctx.drawImage(this.sel.canvas, 0, 0);
      m.ctx.globalCompositeOperation = 'source-over';
    }
    this.structural('Add mask', () => { n.mask = m; this.maskEdit = true; }, () => { n.mask = null; this.maskEdit = false; }, d.width * d.height * 4);
  },

  deleteMask() {
    const n = this.doc.active, m = n.mask;
    if (!m) return;
    this.structural('Delete mask', () => { n.mask = null; this.maskEdit = false; }, () => { n.mask = m; }, this.doc.width * this.doc.height * 4);
  },

  /** Makes the mask permanent: what it hides is erased from the layer, and the mask goes. */
  applyMask() {
    const d = this.doc, n = d.active, m = n.mask;
    if (!m) return;
    if (isFolder(n)) return toast('A folder mask cannot be applied. Use Layer → Merge folder to turn the folder into a layer first.');
    const before = n.ctx.getImageData(0, 0, d.width, d.height);
    n.ctx.save();
    n.ctx.globalCompositeOperation = 'destination-out';
    n.ctx.drawImage(m.canvas, 0, 0);
    n.ctx.restore();
    const after = n.ctx.getImageData(0, 0, d.width, d.height);
    const put = img => { n.ctx.putImageData(img, 0, 0); n.touch(); };
    this.structural('Apply mask', () => { put(after); n.mask = null; this.maskEdit = false; }, () => { put(before); n.mask = m; }, d.width * d.height * 8);
  },

  toggleMask() {
    const m = this.doc.active.mask;
    if (m) this.setLayerProp(m, 'enabled', !m.enabled, m.enabled ? 'Turn mask off' : 'Turn mask on');
  },

  // ---------- pixel operations on the current layer ----------

  /** The Move tool: the layer and its mask, everything in a folder, or only the mask while editing it. */
  beginMove(pt, id) {
    const d = this.doc, n = d.active;
    if (!n.visible) return toast('This layer is hidden. Show it to move it.');
    if (lockedNode(n)) return toast(`"${lockedNode(n).name}" is locked. Untick Lock in the Layers panel to move it.`);
    const rasters = this.maskEdit && n.mask ? [n.mask] : nodeRasters(n);
    const parts = rasters.map(r => {
      const copy = document.createElement('canvas');
      copy.width = d.width; copy.height = d.height;
      copy.getContext('2d').drawImage(r.canvas, 0, 0);
      return { r, copy, before: r.ctx.getImageData(0, 0, d.width, d.height) };
    });
    this.gesture = { type: 'move', tool: 'move', id, parts, start: pt, dx: 0, dy: 0 };
  },

  moveTo(pt) {
    const g = this.gesture, d = this.doc;
    g.dx = Math.round(pt.x - g.start.x);
    g.dy = Math.round(pt.y - g.start.y);
    for (const p of g.parts) {
      p.r.ctx.clearRect(0, 0, d.width, d.height);
      p.r.ctx.drawImage(p.copy, g.dx, g.dy);
    }
    this.updateComp(null);
    this.requestRender();
  },

  endMove() {
    const g = this.gesture, d = this.doc;
    if (!g.dx && !g.dy) return;
    for (const p of g.parts) {
      p.after = p.r.ctx.getImageData(0, 0, d.width, d.height);
      p.r.touch();
      if (p.r.text) {  // a text layer keeps its text editable: move where it is drawn
        p.textBefore = p.r.text;
        p.textAfter = { ...p.r.text, x: p.r.text.x + g.dx, y: p.r.text.y + g.dy };
        p.r.text = p.textAfter;
      }
    }
    const put = key => {
      for (const p of g.parts) {
        p.r.ctx.putImageData(p[key], 0, 0);
        p.r.touch();
        if (p.textBefore) p.r.text = key === 'before' ? p.textBefore : p.textAfter;
      }
      this.changed(null);
    };
    this.history.push({ label: 'Move', bytes: g.parts.length * d.width * d.height * 8, undo: () => put('before'), redo: () => put('after') });
    this.changed(null);
  },

  /** Clears the selected pixels, or the whole layer when nothing is selected (on a mask: reveals). */
  clearLayer(label = 'Delete') {
    const d = this.doc, t = this.target('clear');
    if (!t) return;
    if (this.sel.active) {
      this.resetStroke();
      this.strokeCtx.drawImage(this.sel.canvas, 0, 0);
      this.live = { layer: t, canvas: this.stroke, alpha: 1, mode: 'destination-out' };
      return this.commitStroke(t, this.sel.bounds, label);
    }
    const before = t.ctx.getImageData(0, 0, d.width, d.height);
    t.ctx.clearRect(0, 0, d.width, d.height);
    this.pushPatch(t, { x: 0, y: 0, w: d.width, h: d.height }, before, t.ctx.getImageData(0, 0, d.width, d.height), label === 'Delete' ? 'Clear layer' : label);
    t.touch();
    this.changed(null);
  },

  /** Fills the selection, or the whole layer when nothing is selected, with the main colour (on a mask: hides). */
  fillLayer() {
    const d = this.doc, t = this.target('fill');
    if (!t) return;
    if (this.sel.active) {
      const b = this.sel.bounds;
      this.resetStroke();
      this.strokeCtx.fillStyle = this.inkFor(t);
      this.strokeCtx.fillRect(b.x, b.y, b.w, b.h);
      this.sel.clipCanvas(this.strokeCtx, b);
      this.live = { layer: t, canvas: this.stroke, alpha: 1, mode: this.strokeMode(t, false) };
      return this.commitStroke(t, b, 'Fill selection');
    }
    const before = t.ctx.getImageData(0, 0, d.width, d.height);
    t.ctx.save();
    t.ctx.fillStyle = this.inkFor(t);
    t.ctx.globalCompositeOperation = this.strokeMode(t, false);
    t.ctx.fillRect(0, 0, d.width, d.height);
    t.ctx.restore();
    this.pushPatch(t, { x: 0, y: 0, w: d.width, h: d.height }, before, t.ctx.getImageData(0, 0, d.width, d.height), 'Fill layer');
    t.touch();
    this.changed(null);
  },

  /** Rasters "Flip layer" works on: the mask while editing it, else the layer (or folder) with its mask(s). */
  layerRasters() {
    const n = this.doc.active;
    return this.maskEdit && n.mask ? [n.mask] : nodeRasters(n);
  },

  /** Mirrors rasters' pixels. Mirroring twice gives the original back, so undo is the same operation. */
  flipPixels(rasters, axis, label) {
    const d = this.doc;
    const flip = () => {
      const tmp = document.createElement('canvas');
      tmp.width = d.width; tmp.height = d.height;
      const t = tmp.getContext('2d');
      for (const l of rasters) {
        t.clearRect(0, 0, d.width, d.height);
        t.drawImage(l.canvas, 0, 0);
        l.ctx.save();
        l.ctx.clearRect(0, 0, d.width, d.height);
        if (axis === 'h') l.ctx.setTransform(-1, 0, 0, 1, d.width, 0);
        else l.ctx.setTransform(1, 0, 0, -1, 0, d.height);
        l.ctx.drawImage(tmp, 0, 0);
        l.ctx.restore();
        l.touch();
      }
    };
    const tx = this.textsIn(rasters);  // flipped pixels no longer match the text, so text layers become pixels
    this.structural(label, () => { flip(); tx.drop(); }, () => { flip(); tx.restore(); });
  },
};
