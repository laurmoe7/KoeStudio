// The artwork: size, paper colour and a tree of layers and folders (tree.js). Layers and masks are rasters,
// each with its own canvas. Saved as JSON (format 'koe'); pixels are PNG data URLs. See sanitizeDoc for the format.

import { isFolder, allNodes, allLayers, pathOf, nodeAt, insertNode } from './tree.js';
import { defaultRulers, sanitizeRulers } from './rulers.js';
import { sanitizeText } from './textlayer.js';
import { sanitizeTone, applyTone } from './tone.js';
import { sanitizeVector } from './vector.js';
import { sanitizeEffects, effectReach, effectsImage } from './effects.js';
import { sanitizeAdjust, adjustFilter } from './adjust.js';
import { sanitizeDpi } from './resolution.js';
import { sanitizeAnim, defaultAnim, animFrames, frameOf, onionSkins, ONION_COLORS } from './anim.js';

export const BLEND_MODES = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];
/** Folders also have "Through": their layers blend straight onto what is below, as if there were no folder. */
export const PASS_THROUGH = ['pass-through', 'Through'];
const BLEND_IDS = new Set(BLEND_MODES.map(m => m[0]));
/** Colour labels a layer or folder can carry in the layer list (as in Clip Studio Paint's palette colours). */
export const LABELS = [['red', '#e5484d'], ['orange', '#f08c2e'], ['yellow', '#e6c84a'], ['green', '#46a758'], ['blue', '#3e8fe0'], ['purple', '#9b6fe0'], ['gray', '#8b8d98']];
const LABEL_IDS = new Set(LABELS.map(l => l[0]));
export const MAX_SIDE = 10000;
export const FORMAT_VERSION = 2;
const MAX_DEPTH = 20;

const isPng = s => typeof s === 'string' && s.startsWith('data:image/png');

/**
 * Cleans a loaded or new document description (pure, tested). Never throws; fills defaults for missing fields.
 * Version 1 files had a flat `layers` list and an `active` index; version 2 nests folders ({type: 'folder',
 * children}) in `layers`, gives any node an optional `mask: {png, enabled}`, and stores `activePath`.
 * `rulers` (guides, perspective ruler, snapping; see rulers.js) is optional in either version, as is a layer's
 * `tone` (shown as screentone; see tone.js), a layer's `vector` (its lines as data; see vector.js), and any node's
 * `label` (a colour label from LABELS), and a layer's `adjust` (a correction layer; see adjust.js).
 */
export function sanitizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const side = n => Math.max(1, Math.min(MAX_SIDE, Math.round(Number(n) || 0))) || 1;
  let count = 0;
  const node = (l, depth) => {
    const folder = l?.type === 'folder' && depth < MAX_DEPTH;
    count += folder ? 0 : 1;
    const out = {
      type: folder ? 'folder' : 'layer',
      name: String(l?.name ?? (folder ? 'Folder' : `Layer ${count}`)).slice(0, 100),
      visible: l?.visible !== false,
      opacity: Math.max(0, Math.min(1, Number.isFinite(+l?.opacity) ? +l.opacity : 1)),
      blend: BLEND_IDS.has(l?.blend) || (folder && l?.blend === PASS_THROUGH[0]) ? l.blend : folder ? PASS_THROUGH[0] : 'source-over',
      clip: !!l?.clip,
      mask: l?.mask && typeof l.mask === 'object' ? { png: isPng(l.mask.png) ? l.mask.png : null, enabled: l.mask.enabled !== false } : null,
      label: LABEL_IDS.has(l?.label) ? l.label : null,
      locked: l?.locked === true,
      reference: l?.reference === true,
    };
    if (folder) {
      out.open = l.open !== false;
      out.children = (Array.isArray(l.children) ? l.children : []).map(c => node(c, depth + 1));
    } else {
      out.alphaLock = !!l?.alphaLock;
      out.png = isPng(l?.png) ? l.png : null;
      const adjust = sanitizeAdjust(l?.adjust);
      if (adjust) out.adjust = adjust;  // a correction layer (adjust.js): no pixels of its own, png stays empty
      else if (l?.text) out.text = sanitizeText(l.text);  // a text layer (textlayer.js); png holds its last rendering
      else if (l?.vector) out.vector = sanitizeVector(l.vector);  // a vector layer (vector.js); png holds its last rendering
      out.tone = adjust ? null : sanitizeTone(l?.tone);
      out.effects = adjust ? null : sanitizeEffects(l?.effects);  // border and drop shadow (effects.js); null when none
    }
    return out;
  };
  const layers = (Array.isArray(d.layers) ? d.layers : []).map(l => node(l, 0));
  const activePath = Array.isArray(d.activePath) ? d.activePath.map(n => Math.max(0, Math.round(Number(n) || 0)))
    : [Math.max(0, Math.min(layers.length - 1, Math.round(Number(d.active) || 0)))];
  return {
    format: 'koe',
    version: FORMAT_VERSION,
    title: String(d.title || 'Untitled').slice(0, 120),
    width: side(d.width || 1920),
    height: side(d.height || 1080),
    paper: d.paper === null ? null : (/^#[0-9a-f]{6}$/i.test(d.paper) ? d.paper : '#ffffff'),
    dpi: sanitizeDpi(d.dpi),  // resolution for printing (resolution.js); older files: 72
    anim: sanitizeAnim(d.anim),  // frame-by-frame animation settings (anim.js); off for older files
    activePath,
    rulers: sanitizeRulers(d.rulers),
    layers,
  };
}

let nextId = 1;

/** Pixels with a canvas, a change counter and a cached PNG: a layer or a mask. */
class Raster {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.version = 0;      // raised on every pixel change
    this.pngVersion = -1;  // version of the cached PNG below
    this.png = null;
  }
  touch() { this.version++; }
  async toPng() {
    if (this.pngVersion !== this.version) {
      const v = this.version;
      this.png = await canvasToDataUrl(this.canvas);
      this.pngVersion = v;
    }
    return this.png;
  }
  async loadPng(png) {
    if (!png) return;
    this.ctx.drawImage(await loadImage(png), 0, 0);
    this.png = png;
    this.pngVersion = this.version;
  }
  copyFrom(other) {
    this.ctx.drawImage(other.canvas, 0, 0);
  }
}

/**
 * A layer mask (as in Clip Studio Paint): its alpha is how much of the layer or folder is hidden. Painting on it
 * hides, erasing reveals. A new mask hides nothing.
 */
export class Mask extends Raster {
  constructor(w, h, enabled = true) {
    super(w, h);
    this.kind = 'mask';
    this.enabled = enabled;
  }
}

export class Layer extends Raster {
  constructor(w, h, props = {}) {
    super(w, h);
    this.kind = 'layer';
    this.id = nextId++;
    this.parent = null;
    this.name = props.name || 'Layer';
    this.visible = props.visible !== false;
    this.opacity = props.opacity ?? 1;
    this.blend = props.blend || 'source-over';
    this.alphaLock = !!props.alphaLock;
    this.clip = !!props.clip;
    this.mask = null;
    this.label = props.label || null;  // colour label in the layer list (LABELS)
    this.locked = !!props.locked;        // no pixel changes (Layer panel → Lock)
    this.reference = !!props.reference;  // Fill and the wand can look at reference layers only
    this.text = props.text || null;  // set on text layers: what to draw (textlayer.js)
    this.vector = props.vector || null;  // set on vector layers: the lines (vector.js); never changed in place
    this.tone = props.tone || null;  // set on screentone layers: how the dots look (tone.js)
    this.effects = props.effects || null;  // border and drop shadow, drawn under the pixels (effects.js)
    this.adjust = props.adjust || null;  // set on correction layers: the colour change applied to what is below (adjust.js)
  }
}

export class Folder {
  constructor(props = {}) {
    this.kind = 'folder';
    this.id = nextId++;
    this.parent = null;
    this.name = props.name || 'Folder';
    this.visible = props.visible !== false;
    this.opacity = props.opacity ?? 1;
    this.blend = props.blend || PASS_THROUGH[0];
    this.clip = !!props.clip;
    this.open = props.open !== false;
    this.children = [];  // bottom first
    this.mask = null;
    this.label = props.label || null;
    this.locked = !!props.locked;
    this.reference = !!props.reference;
  }
}

/** A deep copy of a layer or folder (with masks), for Duplicate. */
export function cloneNode(n, w, h) {
  const props = { name: n.name, visible: n.visible, opacity: n.opacity, blend: n.blend, clip: n.clip, alphaLock: n.alphaLock, open: n.open, label: n.label, locked: n.locked, reference: n.reference };
  let c;
  if (isFolder(n)) {
    c = new Folder(props);
    for (const child of n.children) insertNode(c, c.children.length, cloneNode(child, w, h));
  } else {
    c = new Layer(w, h, { ...props, text: n.text ? { ...n.text } : null, vector: n.vector, tone: n.tone ? { ...n.tone } : null, effects: n.effects, adjust: n.adjust });
    c.copyFrom(n);
  }
  if (n.mask) {
    c.mask = new Mask(w, h, n.mask.enabled);
    c.mask.copyFrom(n.mask);
  }
  return c;
}

/** Every raster belonging to a node: its pixels, its mask, and for a folder everything inside it. */
export function nodeRasters(n) {
  const out = [];
  const add = x => { if (!isFolder(x)) out.push(x); if (x.mask) out.push(x.mask); };
  add(n);
  if (isFolder(n)) allNodes(n).forEach(add);
  return out;
}

export function canvasToDataUrl(canvas) {
  return new Promise(resolve => canvas.toBlob(b => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(b);
  }, 'image/png'));
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

export class Doc {
  constructor({ width, height, title = 'Untitled', paper = '#ffffff', id = null, dpi = 72 }) {
    this.id = id;
    this.title = title;
    this.width = width;
    this.height = height;
    this.paper = paper;
    this.dpi = sanitizeDpi(dpi);
    this.root = new Folder({ name: 'root' });
    this.active = null;  // the selected layer or folder
    this.rulers = defaultRulers();
    this.anim = defaultAnim();  // animation: every top-level node a frame while anim.on (anim.js)
    this.version = 0;    // raised on any change worth saving
  }

  static blank(opts) {
    const d = new Doc(opts);
    const l = new Layer(d.width, d.height, { name: 'Layer 1' });
    insertNode(d.root, 0, l);
    d.active = l;
    return d;
  }

  static async fromJSON(raw, id = null) {
    const s = sanitizeDoc(raw);
    const d = new Doc({ ...s, id });
    d.rulers = s.rulers;
    d.anim = s.anim;
    const build = async (src, parent) => {
      const n = src.type === 'folder' ? new Folder(src) : new Layer(d.width, d.height, src);
      if (src.type === 'folder') for (const c of src.children) await build(c, n);
      else await n.loadPng(src.png);
      if (src.mask) {
        n.mask = new Mask(d.width, d.height, src.mask.enabled);
        await n.mask.loadPng(src.mask.png);
      }
      insertNode(parent, parent.children.length, n);
    };
    for (const l of s.layers) await build(l, d.root);
    if (!allLayers(d.root).length) insertNode(d.root, d.root.children.length, new Layer(d.width, d.height, { name: 'Layer 1' }));
    d.active = nodeAt(d.root, s.activePath) || d.root.children[d.root.children.length - 1];
    return d;
  }

  async toJSON() {
    const node = async n => {
      const out = { type: n.kind, name: n.name, visible: n.visible, opacity: n.opacity, blend: n.blend, clip: n.clip, label: n.label };
      if (n.locked) out.locked = true;
      if (n.reference) out.reference = true;
      if (isFolder(n)) {
        out.open = n.open;
        out.children = [];
        for (const c of n.children) out.children.push(await node(c));
      } else {
        out.alphaLock = n.alphaLock;
        out.png = await n.toPng();
        if (n.text) out.text = n.text;
        if (n.vector) out.vector = n.vector;
        if (n.tone) out.tone = n.tone;
        if (n.effects) out.effects = n.effects;
        if (n.adjust) out.adjust = n.adjust;
      }
      if (n.mask) out.mask = { enabled: n.mask.enabled, png: await n.mask.toPng() };
      return out;
    };
    const layers = [];
    for (const n of this.root.children) layers.push(await node(n));
    return { format: 'koe', version: FORMAT_VERSION, title: this.title, width: this.width, height: this.height, paper: this.paper, dpi: this.dpi,
      activePath: this.active ? pathOf(this.active) : [], rulers: this.rulers, anim: this.anim, layers };
  }

  /** All raster layers (not folders), bottom first. */
  get layers() { return allLayers(this.root); }

  /** Every canvas in the document: layers and masks. */
  rasters() { return nodeRasters(this.root).filter(r => r !== this.root); }

  newName(base) {
    const used = new Set(allNodes(this.root).map(n => n.name));
    let n = allNodes(this.root).filter(x => (base === 'Folder') === isFolder(x)).length + 1;
    while (used.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  /** Flattened image (paper included) as a new canvas, optionally scaled to fit maxSide. */
  flatten(maxSide = 0) {
    const scale = maxSide ? Math.min(1, maxSide / Math.max(this.width, this.height)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.width * scale));
    c.height = Math.max(1, Math.round(this.height * scale));
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    composite(ctx, this, { x: 0, y: 0, w: this.width, h: this.height });
    return c;
  }
}

// ---------- compositing ----------

// Scratch canvases reused by composite(), by role and nesting depth, so nested folders never share one.
const scratch = {};
function scratchCanvas(key, r, opts) {
  let c = scratch[key];
  if (!c) c = scratch[key] = document.createElement('canvas');
  if (c.width < r.w || c.height < r.h) { c.width = Math.max(c.width, r.w); c.height = Math.max(c.height, r.h); }
  const ctx = c.getContext('2d', opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, r.w, r.h);
  return [c, ctx];
}

const maskOn = n => !!(n.mask && n.mask.enabled);
const blendOf = n => (n.blend === PASS_THROUGH[0] ? 'source-over' : n.blend);

/**
 * Draws the doc's region r (doc pixels) into ctx at the same coordinates (ctx's transform applies on top).
 * live = { layer, canvas, alpha, mode, texture } is a stroke in progress on a layer or mask, drawn as if already
 * applied (see liveSource). Layers with a tone are drawn as screentone dots.
 * Nodes with clip=true are clipped to the nearest non-clipping sibling below them.
 * With the animation on (doc.anim.on) only one frame is drawn (see drawAnimation); view = {frame, onion} picks it
 * and asks for onion skins, otherwise it is the frame holding the selected layer.
 */
export function composite(ctx, doc, r, live = null, view = null) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  if (doc.paper) {
    ctx.fillStyle = doc.paper;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (doc.anim?.on) drawAnimation(ctx, doc, r, live, view);
  else drawChildren(ctx, doc.root.children, r, live, 0);
  ctx.restore();
}

/** The frame index composite() shows for a doc and view (0 when the selected layer is in no frame). */
export function shownFrame(doc, view = null) {
  const { frames } = animFrames(doc.root.children, doc.anim);
  const i = view?.frame ?? frames.indexOf(frameOf(doc.active));
  return Math.max(0, Math.min(frames.length - 1, i));
}

/**
 * One frame of an animation: the background, the onion skins (the frames round it as see-through blue and green
 * silhouettes, only when view.onion), the frame, then the foreground. Each is drawn on its own, so a frame's
 * Clip below or blending never reaches into another frame.
 */
function drawAnimation(ctx, doc, r, live, view) {
  const { frames, bg, fg } = animFrames(doc.root.children, doc.anim);
  const i = shownFrame(doc, view);
  if (bg) drawChildren(ctx, [bg], r, live, 0);
  if (view?.onion) {
    for (const o of onionSkins(i, frames.length, doc.anim)) {
      const [c, cctx] = scratchCanvas('onion', r);
      cctx.translate(-r.x, -r.y);
      drawChildren(cctx, [frames[o.index]], r, null, 1);
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'source-in';
      cctx.fillStyle = ONION_COLORS[o.side];
      cctx.fillRect(0, 0, r.w, r.h);
      ctx.globalAlpha = o.alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
    }
  }
  if (frames[i]) drawChildren(ctx, [frames[i]], r, live, 0);
  if (fg) drawChildren(ctx, [fg], r, live, 0);
}

/** A folder's contents on their own (transparent background), as for Merge folder. */
export function renderFolder(ctx, folder, r) {
  drawChildren(ctx, folder.children, r, null, 0);
}

function drawChildren(ctx, nodes, r, live, depth) {
  for (let i = 0; i < nodes.length; i++) {
    const base = nodes[i];
    if (base.clip && i > 0) continue;  // drawn with its base below
    let j = i + 1;
    while (j < nodes.length && nodes[j].clip) j++;
    if (!base.visible) { i = j - 1; continue; }
    if (j === i + 1) {
      if (isFolder(base) && base.blend === PASS_THROUGH[0] && base.opacity === 1 && !maskOn(base)) {
        drawChildren(ctx, base.children, r, live, depth + 1);  // "Through": as if the folder were not there
      } else {
        drawNode(ctx, base, r, live, base.opacity, blendOf(base), depth);
      }
    } else {
      // clipping group: base at full strength, each clipping node cut to the base's pixels and blended onto it,
      // then the whole group at the base's opacity and blend mode
      const [gc, gctx] = scratchCanvas(`group${depth}`, r);
      gctx.translate(-r.x, -r.y);
      drawNode(gctx, base, r, live, 1, 'source-over', depth + 1);
      for (let k = i + 1; k < j; k++) {
        const n = nodes[k];
        if (!n.visible) continue;
        if (n.adjust) {  // a correction clipped to the base changes only the group so far
          drawAdjust(gctx, n, r, live, n.opacity, blendOf(n), depth + 1);
          continue;
        }
        const [cc, cctx] = scratchCanvas(`clip${depth}`, r);
        cctx.translate(-r.x, -r.y);
        drawNode(cctx, n, r, live, 1, 'source-over', depth + 1);
        drawNode(cctx, base, r, live, 1, 'destination-in', depth + 1);
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.globalAlpha = n.opacity;
        gctx.globalCompositeOperation = blendOf(n);
        gctx.drawImage(cc, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
        gctx.translate(-r.x, -r.y);
      }
      ctx.globalAlpha = base.opacity;
      ctx.globalCompositeOperation = blendOf(base);
      ctx.drawImage(gc, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      i = j - 1;
    }
  }
}

/** Draws one node (with its mask and any live stroke) into ctx with the given alpha and blend. */
function drawNode(ctx, node, r, live, alpha, blend, depth) {
  if (node.adjust) return drawAdjust(ctx, node, r, live, alpha, blend, depth);
  let src = node.canvas, sx = r.x, sy = r.y;
  if (node.effects && !isFolder(node)) {
    // the effects reach beyond r, so the layer is built for a bigger area R and the effects drawn under it there
    const reach = effectReach(node.effects), W = node.canvas.width, H = node.canvas.height;
    const x0 = Math.max(0, r.x - reach), y0 = Math.max(0, r.y - reach);
    const R = { x: x0, y: y0, w: Math.min(W, r.x + r.w + reach) - x0, h: Math.min(H, r.y + r.h + reach) - y0 };
    const [c, cctx] = layerImage(node, R, live, depth, `fxsrc${depth}`);
    const img = cctx.getImageData(0, 0, R.w, R.h);
    const [e, ectx] = scratchCanvas(`fx${depth}`, R);
    ectx.putImageData(new ImageData(effectsImage(img.data, R.w, R.h, node.effects), R.w, R.h), 0, 0);
    ectx.drawImage(c, 0, 0, R.w, R.h, 0, 0, R.w, R.h);
    src = e; sx = r.x - R.x; sy = r.y - R.y;
  } else if (isFolder(node)) {
    const [c, cctx] = scratchCanvas(`folder${depth}`, r);
    cctx.translate(-r.x, -r.y);
    drawChildren(cctx, node.children, r, live, depth + 1);
    if (maskOn(node)) applyMask(cctx, node, r, live, depth);
    src = c; sx = 0; sy = 0;
  } else if ((live && live.layer === node) || maskOn(node) || node.tone) {
    [src] = layerImage(node, r, live, depth, node.tone ? `tone${depth}` : `node${depth}`);
    sx = 0; sy = 0;
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(src, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
}

/**
 * A correction layer: what ctx already holds in region r is copied through the correction's GPU filter (adjust.js),
 * cut by the layer's mask, and laid back over it with the layer's opacity. Normal blending keeps what is below
 * exactly as see-through as it was ('source-atop'), so a correction never paints where there is nothing.
 * ctx's transform may scale (thumbnails), so the region is read where the transform puts it.
 */
function drawAdjust(ctx, node, r, live, alpha, blend, depth) {
  const t = ctx.getTransform();
  const [c, cctx] = scratchCanvas(`adjust${depth}`, r);
  cctx.filter = adjustFilter(node.adjust);
  cctx.drawImage(ctx.canvas, t.a * r.x + t.e, t.d * r.y + t.f, t.a * r.w, t.d * r.h, 0, 0, r.w, r.h);
  cctx.filter = 'none';
  if (maskOn(node)) applyMask(cctx, node, r, live, depth);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend === 'source-over' ? 'source-atop' : blend;
  ctx.drawImage(c, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
}

/** A layer's region r as shown (live stroke, screentone, mask), in a scratch canvas whose (0, 0) is r's corner. */
function layerImage(node, r, live, depth, key) {
  const [c, cctx] = scratchCanvas(key, r, node.tone || node.effects ? { willReadFrequently: true } : undefined);
  cctx.drawImage(node.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (live && live.layer === node) {
    cctx.globalAlpha = live.alpha;
    cctx.globalCompositeOperation = live.mode;
    cctx.drawImage(...liveSource(live, r), r.w, r.h, 0, 0, r.w, r.h);
    cctx.globalAlpha = 1;
    cctx.globalCompositeOperation = 'source-over';
  }
  if (node.tone) toneRegion(cctx, node.tone, r);
  if (maskOn(node)) applyMask(cctx, node, r, live, depth);
  return [c, cctx];
}

/** A layer's pixels with its effects drawn under them (for merging and rasterizing), as a new canvas. */
export function effectsCanvas(layer, canvas = layer.canvas) {
  const W = canvas.width, H = canvas.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (layer.effects) {
    const src = canvas.getContext('2d').getImageData(0, 0, W, H);
    ctx.putImageData(new ImageData(effectsImage(src.data, W, H, layer.effects), W, H), 0, 0);
  }
  ctx.drawImage(canvas, 0, 0);
  return c;
}

/** How far outside a change any layer's effects reach (0 without effects), so redraws can cover them. */
export function docEffectReach(doc) {
  let r = 0;
  for (const l of allLayers(doc.root)) if (l.effects && l.visible) r = Math.max(r, effectReach(l.effects));
  return r;
}

/** Hides what the mask covers, in a scratch canvas whose (0, 0) is r's corner. */
function applyMask(cctx, node, r, live, depth) {
  let src = node.mask.canvas, sx = r.x, sy = r.y;
  if (live && live.layer === node.mask) {
    const [mc, mctx] = scratchCanvas(`mask${depth}`, r);
    mctx.drawImage(node.mask.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    mctx.globalAlpha = live.alpha;
    mctx.globalCompositeOperation = live.mode;
    mctx.drawImage(...liveSource(live, r), r.w, r.h, 0, 0, r.w, r.h);
    src = mc; sx = 0; sy = 0;
  }
  cctx.save();
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.globalAlpha = 1;
  cctx.globalCompositeOperation = 'destination-out';
  cctx.drawImage(src, sx, sy, r.w, r.h, 0, 0, r.w, r.h);
  cctx.restore();
}

/** Turns the scratch canvas cctx (region r of the doc, at 0, 0) into screentone dots. */
function toneRegion(cctx, tone, r) {
  cctx.save();
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = cctx.getImageData(0, 0, r.w, r.h);
  applyTone(img.data, r.w, r.h, r.x, r.y, tone);
  cctx.putImageData(img, 0, 0);
  cctx.restore();
}

/** A layer's pixels as screentone dots (for merging and rasterizing), as a new canvas. */
export function tonedCanvas(layer) {
  const c = document.createElement('canvas');
  c.width = layer.canvas.width; c.height = layer.canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(layer.canvas, 0, 0);
  if (layer.tone) toneRegion(ctx, layer.tone, { x: 0, y: 0, w: c.width, h: c.height });
  return c;
}

/**
 * Where to read region r of a live stroke from: [canvas, sx, sy]. A stroke with a brush texture
 * (live.texture = {tile, scale}, tile being a canvas whose alpha is what the grain removes) is copied to a scratch
 * canvas and the grain cut out of it there; the texture is anchored to the doc, so it never shifts between updates.
 * A stroke inside a selection (live.sel) is cut down to it the same way, once per read: clipping the stroke canvas
 * itself after every dab would apply a feathered selection's partial alpha again and again.
 */
export function liveSource(live, r) {
  if (!live.texture && !live.sel) return [live.canvas, r.x, r.y];
  const [c, ctx] = scratchCanvas('live', r);
  ctx.drawImage(live.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (live.texture) {
    const { tile, scale } = live.texture;
    if (!tile.pattern) tile.pattern = ctx.createPattern(tile, 'repeat');
    tile.pattern.setTransform(new DOMMatrix().translateSelf(-r.x, -r.y).scaleSelf(scale));
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = tile.pattern;
    ctx.fillRect(0, 0, r.w, r.h);
  }
  if (live.sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(live.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  ctx.globalCompositeOperation = 'source-over';
  return [c, 0, 0];
}
