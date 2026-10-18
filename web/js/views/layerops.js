// Layers, folders and masks: everything that changes the layer tree, plus the operations that work on "the
// current layer" (move, clear, fill, flip). Editor methods (mixed into Editor.prototype in editor.js).
//
// What tools paint on is this.target(): the selected layer, or its mask while mask editing is on (this.maskEdit,
// set by clicking the mask thumbnail). Folders have no pixels of their own, only an optional mask.

import { Layer, Folder, Mask, cloneNode, nodeRasters, renderFolder, tonedCanvas, effectsCanvas, PASS_THROUGH } from '../doc.js';
import { isFolder, allLayers, contains, removeNode, insertNode, destination, stepTarget, outermost, rowRange, removeNodes, restoreNodes, moveNodes, shownLayersTopFirst, clipBase } from '../tree.js';
import { toast, menu } from '../ui.js';
import { animFrames } from '../anim.js';
import { toneDensity } from '../tone.js';
import { translateVector } from '../vector.js';
import { adjustFilter } from '../adjust.js';

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
  target(verb = 'draw on', { read = false, vector = false, text = false } = {}) {
    if (this.quickMask) return this.quickMask;
    const n = this.doc.active;
    if (!n.visible) { toast(`This ${isFolder(n) ? 'folder' : 'layer'} is hidden. Show it to ${verb} it.`); return null; }
    const lockedBy = lockedNode(n);
    if (lockedBy) { toast(`${lockedBy === n ? '' : 'Its folder '}"${lockedBy.name}" is locked. Untick Lock in the Layers panel to ${verb} it.`); return null; }
    if (this.maskEdit && n.mask) return n.mask;
    if (isFolder(n)) { toast(`A folder has no pixels of its own. Select a layer inside it to ${verb}, or click the folder's mask.`); return null; }
    if (n.adjust) {
      toast(`This is a correction layer: it has no pixels of its own. Paint on its mask to choose where it applies, or change its settings.`, { action: { label: 'Settings', run: () => this.adjustSettings(n) }, ms: 6000 });
      return null;
    }
    if (n.text && !read && !text) {
      toast('This is a text layer. Use the Text tool to change it, or rasterize it to paint on it.', { action: { label: 'Rasterize', run: () => this.rasterizeText(n) }, ms: 6000 });
      return null;
    }
    if (n.vector && !read && !vector) {
      toast(`This is a vector layer: pens, the Eraser and Figure outlines work on it. Rasterize it to ${verb} it.`, { action: { label: 'Rasterize', run: () => this.rasterizeVector(n) }, ms: 6000 });
      return null;
    }
    return n;
  },

  /** Colour to paint with on a target: masks only care about coverage, so they get black. */
  inkFor(t) { return t.kind === 'mask' ? '#000000' : this.colors.main; },

  /** How a stroke lands on a target: erase, paint, or paint only on existing pixels (alpha lock). */
  strokeMode(t, erase) { return erase ? 'destination-out' : t.alphaLock ? 'source-atop' : 'source-over'; },

  // ---------- selecting ----------

  /**
   * Selects a node. add (Ctrl+click) picks it as well, or unpicks it when it is already picked; range (Shift+click)
   * picks the rows from the last clicked one to this one. Several picked nodes are moved, hidden, deleted, merged,
   * duplicated or put in a folder together; everything else works on doc.active.
   */
  selectNode(node, { mask = false, add = false, range = false } = {}) {
    const d = this.doc, alive = n => n && contains(d.root, n);
    if (range) {
      this.picked = new Set(rowRange(d.root, alive(this.pickAnchor) ? this.pickAnchor : d.active, node));
    } else if (add) {
      const picked = new Set([...this.picked].filter(alive));
      picked.add(d.active);
      if (picked.has(node) && picked.size > 1) {
        picked.delete(node);
        node = node === d.active ? [...picked].pop() : d.active;
      } else picked.add(node);
      this.picked = picked;
      this.pickAnchor = node;
    } else {
      this.picked = new Set();
      this.pickAnchor = node;
    }
    if (this.picked.size < 2) this.picked = new Set();
    else mask = false;
    d.active = node;
    this.maskEdit = mask && !!node.mask;
    this.layerPanel.render();
    this.doc.version++;
    this.scheduleSave();
  },

  /**
   * The layers with visible paint at doc point p, top first: their pixel there is not see-through, not hidden by
   * their own or a folder's mask, and (clipped layers) their base has paint there too. Tone layers count where they
   * show dots. While the animation is on, only the frame shown (and background/foreground) count.
   */
  layersAt(p) {
    const d = this.doc, x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= d.width || y >= d.height) return [];
    let tops = null;
    if (d.anim.on) {
      const { frames, bg, fg } = animFrames(d.root.children, d.anim);
      tops = new Set([frames[this.drawnFrame()], bg, fg].filter(Boolean));
    }
    const px = r => r.ctx.getImageData(x, y, 1, 1).data;
    const hidden = n => {
      for (let m = n; m && m !== d.root; m = m.parent) if (m.mask?.enabled && px(m.mask)[3] > 200) return true;
      return false;
    };
    const paint = l => {
      const [r, g, b, a] = px(l);
      return l.tone ? toneDensity(r, g, b, a) > 0.02 : a > 12;
    };
    return shownLayersTopFirst(d.root, tops).filter(l => {
      if (l.opacity <= 0.02 || !paint(l) || hidden(l)) return false;
      const base = clipBase(l);
      return !l.clip || (base && !isFolder(base) && base.visible && paint(base) && !hidden(base));
    });
  },

  /** Ctrl+click with the Move tool: selects the top layer with paint under the point. */
  pickLayerAt(p) {
    const [l] = this.layersAt(p);
    if (!l) { toast('No layer has paint there.'); return false; }
    if (l !== this.doc.active || this.maskEdit) this.selectNode(l);
    return true;
  },

  /** Right-click with the Move tool: a menu of every layer with paint under the point, to pick one. */
  layerMenuAt(p, clientX, clientY) {
    const layers = this.layersAt(p);
    const at = { getBoundingClientRect: () => ({ left: clientX, right: clientX, top: clientY, bottom: clientY, width: 0, height: 0 }) };
    menu(at, layers.length
      ? layers.slice(0, 20).map(l => ({ label: l.name, checked: l === this.doc.active, run: () => this.selectNode(l) }))
      : [{ label: 'No layer has paint here', disabled: true, run: () => {} }]);
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
    const multi = this.multiPicked(), v = !node.visible;
    for (const n of multi && this.picked.has(node) ? multi : [node]) n.visible = v;  // the eye of a picked row: all of them
    this.layersChanged();
  },

  // ---------- structure ----------

  /**
   * Records and applies a structural change; do() and undo() must leave doc.active sensible. Several picked nodes
   * are let go first; do() / undo() may pick nodes again (this.picked).
   */
  structural(label, doIt, undoIt, bytes = 0) {
    const run = f => { this.picked = new Set(); f(); };
    run(doIt);
    this.history.push({ label, bytes, undo: () => { run(undoIt); this.layersChanged(); }, redo: () => { run(doIt); this.layersChanged(); } });
    this.layersChanged();
  },

  /** The picked nodes when there are several (outermost, bottom first, so the top one is last), else null. */
  multiPicked() {
    if (this.picked.size < 2) return null;
    const list = outermost(this.doc.root, new Set([...this.picked, this.doc.active]));
    return list.length > 1 ? list : null;
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
    const multi = this.multiPicked();
    if (multi) {  // the folder goes where the top one was, holding them all in their order
      const top = multi[multi.length - 1], parent = top.parent, index = parent.children.indexOf(top) + 1;
      let recs;
      return this.structural('Put in new folder',
        () => { insertNode(parent, index, f); recs = removeNodes(multi); multi.forEach((m, k) => insertNode(f, k, m)); f.open = true; d.active = f; },
        () => { removeNodes(multi); restoreNodes(recs); removeNode(f); d.active = n; this.picked = new Set(multi); });
    }
    let at;
    this.structural('Put in new folder',
      () => { at = removeNode(n); insertNode(at.parent, at.index, f); insertNode(f, 0, n); d.active = f; },
      () => { removeNode(n); removeNode(f); insertNode(at.parent, at.index, n); d.active = n; });
  },

  layerDuplicate() {
    const d = this.doc, n = d.active, multi = this.multiPicked();
    if (multi) {  // each copy just above its original; the copies end up picked
      const copies = multi.map(m => Object.assign(cloneNode(m, d.width, d.height), { name: m.name + ' copy' }));
      const bytes = multi.reduce((b, m) => b + nodeRasters(m).length, 0) * d.width * d.height * 4;
      return this.structural('Duplicate layers',
        () => {
          multi.forEach((m, k) => insertNode(m.parent, m.parent.children.indexOf(m) + 1, copies[k]));
          d.active = copies[multi.indexOf(n)] || copies[copies.length - 1];
          this.picked = new Set(copies);
        },
        () => { removeNodes(copies); d.active = n; this.picked = new Set(multi); }, bytes);
    }
    const copy = cloneNode(n, d.width, d.height);
    copy.name = n.name + ' copy';
    this.insertNode(copy, isFolder(n) ? 'Duplicate folder' : 'Duplicate layer');
  },

  layerDelete() {
    const d = this.doc, n = d.active, multi = this.multiPicked();
    if (multi) {
      if (!allLayers(d.root).some(l => !multi.some(m => contains(m, l)))) return toast('An artwork needs at least one layer. Leave one out of the selection.');
      const bytes = multi.reduce((b, m) => b + nodeRasters(m).length, 0) * d.width * d.height * 4;
      let recs;
      return this.structural('Delete layers',
        () => {
          recs = removeNodes(multi);
          const last = recs[recs.length - 1], sib = last.parent.children;  // select what was below the top one
          d.active = sib[last.index - 1] || sib[last.index] || (last.parent.parent ? last.parent : null) || allLayers(d.root)[0];
        },
        () => { restoreNodes(recs); d.active = n; this.picked = new Set(multi); }, bytes);
    }
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

  /** Moves several nodes together above/below another or into a folder, keeping their order (one undo step). */
  moveNodesTo(nodes, target, where) {
    const d = this.doc, n = d.active;
    if (nodes.some(m => contains(m, target))) return;
    if (where === 'top-of' || where === 'bottom-of') target.open = true;
    let recs;
    this.structural('Move layers',
      () => { recs = moveNodes(nodes, target, where); d.active = n; this.picked = new Set(nodes); },
      () => { removeNodes(nodes); restoreNodes(recs); d.active = n; this.picked = new Set(nodes); });
  },

  /** One step up (1) or down (-1) in the layer list, into and out of folders. */
  layerMove(dir) {
    const multi = this.multiPicked();
    if (multi) {  // the group steps past what is above its top one (or below its bottom one) and closes up
      const t = stepTarget(dir > 0 ? multi[multi.length - 1] : multi[0], dir);
      return t && this.moveNodesTo(multi, t.target, t.where);
    }
    const t = stepTarget(this.doc.active, dir);
    if (t) this.moveNodeTo(this.doc.active, t.target, t.where);
  },

  mergeDown() {
    const d = this.doc, n = d.active, multi = this.multiPicked();
    if (multi) return this.mergePicked(multi);
    if (isFolder(n)) return this.mergeFolder(n);
    const parent = n.parent, i = parent.children.indexOf(n), lower = parent.children[i - 1];
    if (!lower) return toast('There is no layer below this one (in the same folder) to merge into.');
    if (isFolder(lower)) return toast('The layer below is a folder. Use Layer → Merge folder on it first.');
    if (lower.adjust) return toast('The layer below is a correction layer, which has no pixels to merge into.');
    if (lower.mask) return toast('The layer below has a mask. Apply or delete that mask first.');
    if (!n.visible || !lower.visible) return toast('Show both layers before merging them.');
    const W = d.width, H = d.height;
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const c = src.getContext('2d');
    if (n.adjust) {  // a correction merges as the layer below seen through it
      c.filter = adjustFilter(n.adjust);
      c.drawImage(lower.canvas, 0, 0);
      c.filter = 'none';
    } else c.drawImage(n.tone ? tonedCanvas(n) : n.canvas, 0, 0);  // a tone layer merges as the dots it shows
    if (n.mask?.enabled) { c.globalCompositeOperation = 'destination-out'; c.drawImage(n.mask.canvas, 0, 0); }
    if (n.effects) {  // its border and shadow become pixels too
      const fx = effectsCanvas(n, src);
      c.globalCompositeOperation = 'copy'; c.drawImage(fx, 0, 0); c.globalCompositeOperation = 'source-over';
    }
    if (n.clip) { c.globalCompositeOperation = 'destination-in'; c.drawImage(lower.canvas, 0, 0); }
    const before = lower.ctx.getImageData(0, 0, W, H);
    lower.ctx.save();
    lower.ctx.globalAlpha = n.opacity;
    lower.ctx.globalCompositeOperation = lower.alphaLock || (n.adjust && n.blend === 'source-over') ? 'source-atop' : n.blend;
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

  /**
   * Merges several picked nodes into one layer where the top one was. They are drawn in stacking order with their
   * own opacity, blend and masks (clipping only onto the picked node below); folders around them are left out.
   */
  mergePicked(nodes) {
    const d = this.doc, n = d.active;
    if (nodes.some(m => !m.visible)) return toast('Show all the selected layers before merging them.');
    const top = nodes[nodes.length - 1], parent = top.parent, index = parent.children.indexOf(top) + 1;
    const layer = new Layer(d.width, d.height, { name: top.name });
    renderFolder(layer.ctx, { children: nodes }, { x: 0, y: 0, w: d.width, h: d.height });
    let recs;
    this.structural('Merge layers',
      () => { insertNode(parent, index, layer); recs = removeNodes(nodes); d.active = layer; },
      () => { restoreNodes(recs); removeNode(layer); d.active = n; this.picked = new Set(nodes); },
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

  /**
   * Layer → Copy to new layer (Ctrl+J) / Cut to new layer (Ctrl+Shift+J): the selected pixels (or the whole layer)
   * on a new layer just above, with the same opacity and blend mode, as one undo step.
   */
  layerViaCopy(cut = false) {
    const d = this.doc, W = d.width, H = d.height;
    const t = this.target(cut ? 'cut from' : 'copy from', cut ? {} : { read: true });
    if (!t) return;
    if (t.kind === 'mask') return toast('That copies layer pixels: turn off mask editing first.');
    const layer = new Layer(W, H, { name: `${t.name} ${cut ? 'cut' : 'copy'}` });
    layer.opacity = t.opacity;
    layer.blend = t.blend;
    layer.ctx.drawImage(t.canvas, 0, 0);
    if (this.sel.active) {
      layer.ctx.globalCompositeOperation = 'destination-in';
      layer.ctx.drawImage(this.sel.canvas, 0, 0);
      layer.ctx.globalCompositeOperation = 'source-over';
    }
    let before = null, after = null;
    if (cut) {
      before = t.ctx.getImageData(0, 0, W, H);
      if (this.sel.active) {
        t.ctx.save();
        t.ctx.globalCompositeOperation = 'destination-out';
        t.ctx.drawImage(this.sel.canvas, 0, 0);
        t.ctx.restore();
      } else t.ctx.clearRect(0, 0, W, H);
      after = t.ctx.getImageData(0, 0, W, H);
    }
    const parent = t.parent, index = parent.children.indexOf(t) + 1, prev = d.active, prevMask = this.maskEdit;
    this.structural(cut ? 'Cut to new layer' : 'Copy to new layer',
      () => { if (cut) { t.ctx.putImageData(after, 0, 0); t.touch(); } insertNode(parent, index, layer); d.active = layer; this.maskEdit = false; },
      () => { removeNode(layer); if (cut) { t.ctx.putImageData(before, 0, 0); t.touch(); } d.active = prev; this.maskEdit = prevMask; },
      W * H * 4 * (cut ? 3 : 1));
  },

  /** Layer → Flatten image: everything visible on one layer; hidden layers are left out. The paper stays the paper. */
  flattenImage() {
    const d = this.doc, W = d.width, H = d.height;
    const layer = new Layer(W, H, { name: 'Flattened' });
    renderFolder(layer.ctx, d.root, { x: 0, y: 0, w: W, h: H });
    const old = [...d.root.children], prev = d.active, prevMask = this.maskEdit;
    this.structural('Flatten image',
      () => { for (const n of [...d.root.children]) removeNode(n); insertNode(d.root, 0, layer); d.active = layer; this.maskEdit = false; },
      () => { removeNode(layer); old.forEach((n, i) => insertNode(d.root, i, n)); d.active = prev; this.maskEdit = prevMask; },
      W * H * 4);
  },

  setLayerProp(node, key, value, label) {
    const old = node[key];
    if (old === value) return this.layerPanel.render();
    this.structural(label, () => { node[key] = value; }, () => { node[key] = old; });
  },

  /** The nodes the layer panel's settings change: every picked one, or the selected one. */
  propNodes() { return this.multiPicked() || [this.doc.active]; },

  /** A layer panel setting for every picked node (or the selected one), as one undo step; they stay picked. */
  setPickedProp(key, value, label) {
    const multi = this.multiPicked();
    if (!multi) return this.setLayerProp(this.doc.active, key, value, label);
    const nodes = multi.filter(n => key !== 'alphaLock' || !isFolder(n));  // folders have no alpha lock
    const blendOk = n => key !== 'blend' || value !== PASS_THROUGH[0] || isFolder(n);  // "Through" is for folders
    const olds = nodes.map(n => n[key]);
    const set = vals => { nodes.forEach((n, k) => { if (blendOk(n)) n[key] = vals[k]; }); this.picked = new Set(multi); };
    this.structural(label, () => set(nodes.map(() => value)), () => set(olds));
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
    for (const m of this.quickMask ? [] : this.multiPicked() || [n]) {
      if (!m.visible) return toast(`"${m.name}" is hidden. Show it to move it.`);
      if (lockedNode(m)) return toast(`"${lockedNode(m).name}" is locked. Untick Lock in the Layers panel to move it.`);
    }
    const rasters = this.layerRasters();
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
      if (p.r.text) {  // a text layer keeps its text editable: move where it is drawn (a turned text moves its matrix)
        const t = p.r.text, m = t.m;
        p.textBefore = t;
        p.textAfter = m ? { ...t, m: [m[0], m[1], m[2], m[3], m[4] + g.dx, m[5] + g.dy] } : { ...t, x: t.x + g.dx, y: t.y + g.dy };
        p.r.text = p.textAfter;
      }
      if (p.r.vector) {  // a vector layer keeps its lines: move them too
        p.vectorBefore = p.r.vector;
        p.vectorAfter = p.r.vector = translateVector(p.r.vector, g.dx, g.dy);
      }
    }
    const put = key => {
      for (const p of g.parts) {
        p.r.ctx.putImageData(p[key], 0, 0);
        p.r.touch();
        if (p.textBefore) p.r.text = key === 'before' ? p.textBefore : p.textAfter;
        if (p.vectorBefore) p.r.vector = key === 'before' ? p.vectorBefore : p.vectorAfter;
      }
      this.changed(null);
    };
    this.history.push({ label: 'Move', bytes: g.parts.length * d.width * d.height * 8, undo: () => put('before'), redo: () => put('after') });
    this.changed(null);
  },

  /** Clears the selected pixels, or the whole layer when nothing is selected (on a mask: reveals). */
  clearLayer(label = 'Delete') {
    const n = this.doc.active;
    if (n.vector && !this.sel.active && !this.maskEdit && !this.quickMask && !lockedNode(n) && n.visible) {  // a vector layer: every line goes
      if (n.vector.strokes.length) { const before = n.vector, after = { brushes: before.brushes, strokes: [] }; this.showVector(n, before, after); this.pushVectorStep(n, before, after, 'Clear layer'); }
      return;
    }
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
    if (this.quickMask) return [this.quickMask];
    if (this.maskEdit && n.mask) return [n.mask];
    const multi = this.multiPicked();  // several picked: all of them (the Move tool, flips)
    return multi ? multi.flatMap(m => nodeRasters(m)) : nodeRasters(n);
  },

  /** Mirrors rasters' pixels. Mirroring twice gives the original back, so undo is the same operation. With
   *  canvas = true (Flip canvas) the guides and rulers turn round too. */
  flipPixels(rasters, axis, label, canvas = false) {
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
    const m = axis === 'h' ? [-1, 0, 0, 1, d.width, 0] : [1, 0, 0, -1, 0, d.height];
    const tx = this.textsIn(rasters, m);  // text layers are mirrored in their matrix and stay editable
    const rl = this.rulersAlong(canvas ? m : null, d.width, d.height, d.width, d.height);
    this.structural(label, () => { flip(); tx.drop(); rl.apply(); }, () => { flip(); tx.restore(); rl.revert(); });
  },
};
