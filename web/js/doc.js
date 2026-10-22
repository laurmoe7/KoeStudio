// The artwork: size, paper colour and a tree of layers and folders (tree.js). Layers and masks are rasters,
// each with its own canvas. Saved as JSON (format 'koe'); pixels are PNG data URLs. See sanitizeDoc for the format.

import { isFolder, allNodes, allLayers, pathOf, nodeAt, insertNode } from './tree.js';
import { defaultRulers, sanitizeRulers } from './rulers.js';
import { sanitizeText } from './textlayer.js';
import { sanitizeTone, applyTone } from './tone.js';
import { sanitizeExpression, applyExpression } from './expression.js';
import { sanitizeVector } from './vector.js';
import { sanitizeFill } from './patterns.js';
import { loadPatternSrc, paintPattern } from './fillrender.js';
import { sanitizeEffects, effectReach, effectsImage } from './effects.js';
import { sanitizeAdjust, adjustFilter } from './adjust.js';
import { sanitizeDpi } from './resolution.js';
import { sanitizeSavedSels, savedSelFrom, savedSelJSON } from './savedsel.js';
import { sanitizeComps, sanitizeOffset, sanitizeUid, newUid } from './layercomps.js';
import { applyTextureMode, textureValueAt } from './texmodes.js';
import { isCustomBlend, CUSTOM_BLENDS, BLEND_SHADER, blendPixels } from './blendmodes.js';

export const BLEND_MODES = [
  ['source-over', 'Normal'],
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color burn'], ['linear-burn', 'Linear burn'],
  ['subtract', 'Subtract'], ['darker-color', 'Darker color'],
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color dodge'], ['add', 'Add'], ['lighter-color', 'Lighter color'],
  ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['vivid-light', 'Vivid light'],
  ['linear-light', 'Linear light'], ['pin-light', 'Pin light'], ['hard-mix', 'Hard mix'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['divide', 'Divide'],
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
 * `tone` (shown as screentone; see tone.js), a layer's `vector` (its lines as data; see vector.js), its `fill` (a fill
 * layer's colour, gradient or pattern; see patterns.js), and any node's
 * `label` (a colour label from LABELS), and a layer's `adjust` (a correction layer; see adjust.js). `selections`
 * (saved selections, savedsel.js) is optional too, as are `comps` (layer comps, layercomps.js), any node's `uid` and a
 * layer's `offset`.
 */
export function sanitizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const side = n => Math.max(1, Math.min(MAX_SIDE, Math.round(Number(n) || 0))) || 1;
  let count = 0;
  const uids = new Set();  // a uid used twice (a hand-edited file) is given to the first node only
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
      draft: l?.draft === true,  // shown while drawing, left out of exports and of Fill / the wand looking at all layers
    };
    const uid = sanitizeUid(l?.uid);  // how layer comps know the node (layercomps.js); a new one on opening when missing
    if (uid && !uids.has(uid)) { out.uid = uid; uids.add(uid); }
    if (folder) {
      out.open = l.open !== false;
      out.children = (Array.isArray(l.children) ? l.children : []).map(c => node(c, depth + 1));
    } else {
      out.alphaLock = !!l?.alphaLock;
      const offset = sanitizeOffset(l?.offset);  // how far the Move tool moved it in all (a comp's position)
      if (offset) out.offset = offset;
      out.png = isPng(l?.png) ? l.png : null;
      const adjust = sanitizeAdjust(l?.adjust);
      if (adjust) out.adjust = adjust;  // a correction layer (adjust.js): no pixels of its own, png stays empty
      else if (l?.text) out.text = sanitizeText(l.text);  // a text layer (textlayer.js); png holds its last rendering
      else if (l?.vector) out.vector = sanitizeVector(l.vector);  // a vector layer (vector.js); png holds its last rendering
      else if (sanitizeFill(l?.fill)) out.fill = sanitizeFill(l.fill);  // a fill layer (patterns.js); png holds its last rendering
      out.tone = adjust ? null : sanitizeTone(l?.tone);
      out.effects = adjust ? null : sanitizeEffects(l?.effects);  // border and drop shadow (effects.js); null when none
      out.layerColor = !adjust && /^#[0-9a-f]{6}$/i.test(l?.layerColor) ? l.layerColor.toLowerCase() : null;  // all paint shown in this colour
      out.expression = adjust ? null : sanitizeExpression(l?.expression);  // shown as gray or monochrome (expression.js)
    }
    return out;
  };
  const layers = (Array.isArray(d.layers) ? d.layers : []).map(l => node(l, 0));
  const width = side(d.width || 1920), height = side(d.height || 1080);
  const activePath = Array.isArray(d.activePath) ? d.activePath.map(n => Math.max(0, Math.round(Number(n) || 0)))
    : [Math.max(0, Math.min(layers.length - 1, Math.round(Number(d.active) || 0)))];
  return {
    format: 'koe',
    version: FORMAT_VERSION,
    title: String(d.title || 'Untitled').slice(0, 120),
    width,
    height,
    paper: d.paper === null ? null : (/^#[0-9a-f]{6}$/i.test(d.paper) ? d.paper : '#ffffff'),
    dpi: sanitizeDpi(d.dpi),  // resolution for printing (resolution.js); older files: 72
    timelapse: d.timelapse === true,  // record a timelapse frame after each autosave (editor.js); off for older files
    activePath,
    rulers: sanitizeRulers(d.rulers),
    selections: sanitizeSavedSels(d.selections, width, height),  // saved selections (savedsel.js); [] when none
    comps: sanitizeComps(d.comps, b => BLEND_IDS.has(b) || b === PASS_THROUGH[0], uids),  // layer comps (layercomps.js); [] when none
    layers,
  };
}

let nextId = 1;

/** SHA-1 (hex) of a picture's data URL: the key saves that send only changes name it by (app.py pic_key). */
export async function picKey(png) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(png));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  /** SHA-1 (hex) of the cached PNG data URL: how saves that send only changes name it (app.py pic_key). */
  async pngHash() {
    const png = this.png;
    if (!png) return null;
    if (this.hashOf === png) return this.hash;
    const hash = await picKey(png);
    this.hash = hash;  // kept as a pair with the PNG it belongs to (another call may have hashed a newer one meanwhile)
    this.hashOf = png;
    return hash;
  }
  async toPng() {
    if (this.pngVersion !== this.version) {
      const v = this.version;
      const { url, key, text } = await canvasToPng(this.canvas);
      this.png = url;
      if (key) [this.hash, this.hashOf] = [key, url];
      [this.pngText, this.pngTextOf] = [text || null, url];  // the url's bytes, for saveBody
      this.pngVersion = v;
    }
    return this.png;
  }
  /**
   * Draws a saved picture into the raster; false when it cannot be read. A damaged picture leaves the raster empty
   * but is kept as it was, so saving writes it back unchanged until the raster is painted on.
   */
  async loadPng(png) {
    if (!png) return true;
    let ok = true;
    try {
      const img = await loadImage(png);
      await img.decode().catch(() => {});  // decoded off the page, so drawing it does not stall
      this.ctx.drawImage(img, 0, 0);
    } catch {
      ok = false;
    }
    this.png = png;
    this.pngVersion = this.version;
    return ok;
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
    this.uid = props.uid || newUid();  // saved: how layer comps know it (layercomps.js)
    this.offset = props.offset || null;  // {x, y}: how far the Move tool moved it in all, or null (a comp's position)
    this.locked = !!props.locked;        // no pixel changes (Layer panel → Lock)
    this.reference = !!props.reference;  // Fill and the wand can look at reference layers only
    this.draft = !!props.draft;  // a draft (sketch) layer: shown, but not exported nor seen by Fill / the wand
    this.text = props.text || null;  // set on text layers: what to draw (textlayer.js)
    this.vector = props.vector || null;  // set on vector layers: the lines (vector.js); never changed in place
    this.fill = props.fill || null;  // set on fill layers: the colour, gradient or pattern drawn (patterns.js); never changed in place
    this.tone = props.tone || null;  // set on screentone layers: how the dots look (tone.js)
    this.effects = props.effects || null;  // border and drop shadow, drawn under the pixels (effects.js)
    this.layerColor = props.layerColor || null;  // '#rrggbb': all paint shown in this colour (Layer → Layer color)
    this.expression = props.expression || null;  // Expression color: null (Color), {mode: 'gray'} or {mode: 'mono', ...} (expression.js)
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
    this.uid = props.uid || newUid();
    this.locked = !!props.locked;
    this.reference = !!props.reference;
    this.draft = !!props.draft;
  }
}

/** A deep copy of a layer or folder (with masks), for Duplicate. */
export function cloneNode(n, w, h) {
  const props = { name: n.name, visible: n.visible, opacity: n.opacity, blend: n.blend, clip: n.clip, alphaLock: n.alphaLock, open: n.open, label: n.label, locked: n.locked, reference: n.reference, draft: n.draft };
  let c;
  if (isFolder(n)) {
    c = new Folder(props);
    for (const child of n.children) insertNode(c, c.children.length, cloneNode(child, w, h));
  } else {
    c = new Layer(w, h, { ...props, text: n.text ? { ...n.text } : null, vector: n.vector, fill: n.fill, tone: n.tone ? { ...n.tone } : null, effects: n.effects, layerColor: n.layerColor, expression: n.expression, adjust: n.adjust, offset: n.offset });
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

/**
 * A canvas as a PNG data URL. Big ones go through a worker (pngworker.js): toBlob encodes off the main thread but
 * reads the pixels back from the GPU on it, which froze the drawing for 0.1 s per print-size layer on autosave.
 * The worker gets an ImageBitmap (a copy taken now, on the GPU) and does the readback and encoding itself.
 */
export function canvasToDataUrl(canvas) {
  return canvasToPng(canvas).then(r => r.url);
}

/** As canvasToDataUrl, as {url, key, text}: from the worker also the url's key (picKey) and its bytes as a Blob (saveBody). */
function canvasToPng(canvas) {
  if (canvas.width * canvas.height >= WORKER_PIXELS && pngWorker() && typeof createImageBitmap === 'function') {
    return createImageBitmap(canvas).then(bitmap => new Promise((resolve, reject) => {
      const id = ++pngJobs.next;
      pngJobs.waiting.set(id, { resolve, reject });
      pngJobs.worker.postMessage({ id, bitmap }, [bitmap]);
    })).catch(() => { pngJobs.broken = true; return blobDataUrl(canvas).then(url => ({ url })); });  // a browser without OffscreenCanvas
  }
  return blobDataUrl(canvas).then(url => ({ url }));
}

/**
 * The request body of a save: `json` as JSON text, with each placeholder string that toJSON put in for a picture
 * (the keys of `texts`) replaced by that picture's data URL, given as a Blob of its bytes. The page then never turns
 * the big strings into bytes itself (fetch did that on the main thread). Without placeholders it is plain JSON text.
 */
export function saveBody(json, texts) {
  const s = JSON.stringify(json);
  if (!texts?.size) return s;
  const parts = [];
  let at = 0;
  const marks = [...texts.keys()].map(k => [s.indexOf(JSON.stringify(k)), k]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
  for (const [i, k] of marks) {
    parts.push(s.slice(at, i), '"', texts.get(k), '"');  // a data URL holds nothing JSON escapes
    at = i + JSON.stringify(k).length;
  }
  parts.push(s.slice(at));
  return new Blob(parts, { type: 'application/json' });
}

const WORKER_PIXELS = 1 << 20;  // smaller pictures read back in a few ms: not worth the trip
const pngJobs = { worker: null, broken: false, next: 0, waiting: new Map() };

function pngWorker() {
  if (pngJobs.broken || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  if (!pngJobs.worker) {
    try {
      pngJobs.worker = new Worker(new URL('./pngworker.js', import.meta.url));
    } catch {
      pngJobs.broken = true;
      return null;
    }
    pngJobs.worker.onmessage = e => {
      const job = pngJobs.waiting.get(e.data.id);
      pngJobs.waiting.delete(e.data.id);
      if (job) e.data.error ? job.reject(new Error(e.data.error)) : job.resolve(e.data);
    };
    pngJobs.worker.onerror = () => {  // the worker could not start: every waiting job is done the old way
      pngJobs.broken = true;
      for (const job of pngJobs.waiting.values()) job.reject(new Error('PNG worker failed'));
      pngJobs.waiting.clear();
    };
  }
  return pngJobs.worker;
}

/** Fails (instead of never answering, which left every later save waiting) when the browser cannot encode the canvas. */
function blobDataUrl(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(b => {
    if (!b) return reject(new Error('The picture could not be encoded (out of memory?)'));
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('The picture could not be encoded'));
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
    this.timelapse = false;  // record a timelapse (timelapsetools.js)
    this.root = new Folder({ name: 'root' });
    this.active = null;  // the selected layer or folder
    this.rulers = defaultRulers();
    this.savedSels = [];  // saved selections (savedsel.js), never changed in place: undo swaps the list
    this.lostSels = [];   // ones in the file that could not be read: saved back as they were, dropped by a change of canvas
    this.comps = [];  // layer comps (layercomps.js), never changed in place: undo swaps the list
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
    d.timelapse = s.timelapse;
    d.comps = s.comps;
    // the tree is built first and every picture decoded at once (the browser decodes them in parallel, off the page)
    const loads = [];
    d.unreadable = [];  // names of layers (or masks) whose picture could not be read: they open empty
    const load = (r, png, name) => loads.push(r.loadPng(png).then(ok => { if (!ok) d.unreadable.push(name); }));
    const build = (src, parent) => {
      const n = src.type === 'folder' ? new Folder(src) : new Layer(d.width, d.height, src);
      if (src.type === 'folder') for (const c of src.children) build(c, n);
      else load(n, src.png, src.name);
      if (src.fill?.type === 'pattern') loads.push(loadPatternSrc(src.fill.src));  // ready to draw again when the canvas changes
      if (src.mask) {
        n.mask = new Mask(d.width, d.height, src.mask.enabled);
        load(n.mask, src.mask.png, `${src.name} (mask)`);
      }
      insertNode(parent, parent.children.length, n);
    };
    for (const l of s.layers) build(l, d.root);
    loads.push(Promise.all(s.selections.map(savedSelFrom)).then(list => {
      list.forEach((sel, i) => { if (!sel) d.unreadable.push(`saved selection ${s.selections[i].name}`); });
      d.savedSels = list.filter(Boolean);
      d.lostSels = s.selections.filter((_, i) => !list[i]);  // unreadable ones are saved back as they were
    }));
    await Promise.all(loads);
    if (!allLayers(d.root).length) insertNode(d.root, d.root.children.length, new Layer(d.width, d.height, { name: 'Layer 1' }));
    d.active = nodeAt(d.root, s.activePath) || d.root.children[d.root.children.length - 1];
    return d;
  }

  /**
   * The document as saved. With `delta` = {have (Set of picture keys the server holds for this artwork, or null),
   * keys (an empty Set, filled with every picture's key)}, a layer or mask picture the server has is sent as
   * "ref:<key>" (its pngHash; app.py SAVE_CACHE fills it in). With delta.texts (an empty Map) a picture sent whole
   * whose bytes the PNG worker handed back is a placeholder string instead, kept in texts with those bytes (saveBody).
   */
  async toJSON(delta = null) {
    const mark = `\u0001pic:${Math.random().toString(36).slice(2)}:`;
    const pic = async (r, out) => {
      const png = await r.toPng();
      if (!delta || !png) { out.png = png; return; }
      const key = await r.pngHash();
      delta.keys.add(key);
      if (delta.have?.has(key)) out.png = 'ref:' + key;
      else if (delta.texts && r.pngText && r.pngTextOf === png) { out.png = mark + delta.texts.size; delta.texts.set(out.png, r.pngText); }
      else out.png = png;
    };
    const node = async n => {
      const out = { type: n.kind, name: n.name, uid: n.uid, visible: n.visible, opacity: n.opacity, blend: n.blend, clip: n.clip, label: n.label };
      if (n.locked) out.locked = true;
      if (n.reference) out.reference = true;
      if (n.draft) out.draft = true;
      if (isFolder(n)) {
        out.open = n.open;
        out.children = [];
        for (const c of n.children) out.children.push(await node(c));
      } else {
        out.alphaLock = n.alphaLock;
        if (n.offset) out.offset = n.offset;
        await pic(n, out);
        if (n.text) out.text = n.text;
        if (n.vector) out.vector = n.vector;
        if (n.fill) out.fill = n.fill;
        if (n.tone) out.tone = n.tone;
        if (n.effects) out.effects = n.effects;
        if (n.layerColor) out.layerColor = n.layerColor;
        if (n.expression) out.expression = n.expression;
        if (n.adjust) out.adjust = n.adjust;
      }
      if (n.mask) { out.mask = { enabled: n.mask.enabled }; await pic(n.mask, out.mask); }
      return out;
    };
    const layers = [];
    for (const n of this.root.children) layers.push(await node(n));
    const selections = [];
    const selPic = async (s, out) => {  // as pic(), the key kept on the entry (entries never change)
      if (!delta) return out;
      if (s.keyOf !== out.png) [s.key, s.keyOf] = [await picKey(out.png), out.png];
      delta.keys.add(s.key);
      return delta.have?.has(s.key) ? { ...out, png: 'ref:' + s.key } : out;
    };
    for (const s of this.savedSels) selections.push(await selPic(s, await savedSelJSON(s)));
    for (const s of this.lostSels) selections.push(await selPic(s, { name: s.name, x: s.x, y: s.y, w: s.w, h: s.h, png: s.png }));
    return { format: 'koe', version: FORMAT_VERSION, title: this.title, width: this.width, height: this.height, paper: this.paper, dpi: this.dpi,
      activePath: this.active ? pathOf(this.active) : [], rulers: this.rulers, ...(this.timelapse ? { timelapse: true } : {}),
      ...(selections.length ? { selections } : {}), ...(this.comps.length ? { comps: this.comps } : {}), layers };
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

// ---------- blend modes the canvas lacks (blendmodes.js) ----------
// The part of ctx under the source and the source itself are copied into two canvases, both uploaded to WebGL as
// textures (GPU to GPU, nothing read back), and the shader's result is laid on with source-over. Done in tiles of
// at most BLEND_TILE px, in canvases rounded up to 256 px steps so they are rarely resized.
const BLEND_TILE = 2048;
let blendGl = null;  // {canvas, gl, prog, mode, tex: [src, dst]}, or false when WebGL is not available

function blendContext() {
  if (blendGl && !blendGl.gl.isContextLost()) return blendGl;
  if (blendGl === false) return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false });
  if (!gl) { blendGl = false; return null; }
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, `attribute vec2 aPos; uniform vec2 uSize; varying vec2 vUv;
    void main() { vUv = aPos / uSize; gl_Position = vec4(vUv.x * 2.0 - 1.0, 1.0 - vUv.y * 2.0, 0.0, 1.0); }`));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, BLEND_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { blendGl = false; return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  const pos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);  // as the canvas keeps them; the shader unpremultiplies
  const tex = [0, 1].map(unit => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    return t;
  });
  gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uDst'), 1);
  blendGl = { canvas, gl, tex, mode: gl.getUniformLocation(prog, 'uMode'), size: gl.getUniformLocation(prog, 'uSize') };
  return blendGl;
}

// Canvases for one tile: the source, the backdrop (willReadFrequently only for the CPU fallback) and the CPU result.
const blendCanvases = {};
function blendCanvas(key, w, h, cpu) {
  const W = Math.ceil(w / 256) * 256, H = Math.ceil(h / 256) * 256;
  let c = blendCanvases[key];
  if (!c) c = blendCanvases[key] = document.createElement('canvas');
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d', cpu ? { willReadFrequently: true } : undefined);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'copy';  // replaces what an earlier tile left, transparent pixels included
  return [c, ctx];
}

/** Region (sx, sy, r.w, r.h) of src drawn at r in ctx with the given alpha and blend mode, the canvas's own or blendmodes.js's. */
export function drawBlended(ctx, src, sx, sy, r, alpha, blend) {
  if (!isCustomBlend(blend)) {
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(src, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
    return;
  }
  for (let y = 0; y < r.h; y += BLEND_TILE) {
    for (let x = 0; x < r.w; x += BLEND_TILE) {
      const t = { x: r.x + x, y: r.y + y, w: Math.min(BLEND_TILE, r.w - x), h: Math.min(BLEND_TILE, r.h - y) };
      blendTile(ctx, src, sx + x, sy + y, t, alpha, blend);
    }
  }
}

function blendTile(ctx, src, sx, sy, r, alpha, blend) {
  const g = blendContext(), cpu = !g;
  // what ctx holds under r, read where ctx's transform puts it (scaled for thumbnails), as drawAdjust does
  const m = ctx.getTransform();
  const [dc, dctx] = blendCanvas('dst', r.w, r.h, cpu);
  dctx.drawImage(ctx.canvas, m.a * r.x + m.e, m.d * r.y + m.f, m.a * r.w, m.d * r.h, 0, 0, r.w, r.h);
  const [sc, sctx] = blendCanvas('src', r.w, r.h, cpu);
  sctx.drawImage(src, sx, sy, r.w, r.h, 0, 0, r.w, r.h);
  let out;
  if (g) {
    const { gl, canvas } = g;
    if (canvas.width !== sc.width || canvas.height !== sc.height) { canvas.width = sc.width; canvas.height = sc.height; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    for (const [unit, c] of [[0, sc], [1, dc]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, g.tex[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    }
    gl.uniform1i(g.mode, CUSTOM_BLENDS.indexOf(blend));
    gl.uniform2f(g.size, canvas.width, canvas.height);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, r.w, 0, 0, r.h, 0, r.h, r.w, 0, r.w, r.h]), gl.STATIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    out = canvas;
  } else {  // no WebGL: the same formulas on the CPU
    const d = dctx.getImageData(0, 0, r.w, r.h).data, s = sctx.getImageData(0, 0, r.w, r.h).data;
    const [oc, octx] = blendCanvas('out', r.w, r.h, true);
    octx.putImageData(new ImageData(blendPixels(blend, d, s), r.w, r.h), 0, 0);
    out = oc;
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(out, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
}

/**
 * Draws the doc's region r (doc pixels) into ctx at the same coordinates (ctx's transform applies on top).
 * live = { layer, canvas, alpha, mode, texture } is a stroke in progress on a layer or mask, drawn as if already
 * applied (see liveSource). Layers with a tone are drawn as screentone dots, ones with an expression in gray or monochrome.
 * Nodes with clip=true are clipped to the nearest non-clipping sibling below them.
 * keep = {except: raster} (the editor, while a stroke is going on) lets screentone, expression and effect layers other than
 * `except` (or the layer whose mask it is) be drawn from kept tiles (keptLook) instead of being worked out again,
 * with a GPU readback, on every redraw.
 */
export function composite(ctx, doc, r, live = null, keep = null) {
  const kept = keepLooks;
  keepLooks = keep;
  try { compositeInto(ctx, doc, r, live); } finally { keepLooks = kept; }
}

// While true, draft layers and folders are drawn as if hidden (the picture as exported; see withoutDrafts).
let skipDrafts = false;

/** Runs draw() (any composite / renderFolder calls) with draft layers left out, as exports and Fill see the picture. */
export function withoutDrafts(draw) {
  const was = skipDrafts;
  skipDrafts = true;
  try { return draw(); } finally { skipDrafts = was; }
}

const shows = n => n.visible && !(skipDrafts && n.draft);

function compositeInto(ctx, doc, r, live) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  if (doc.paper) {
    ctx.fillStyle = doc.paper;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  drawChildren(ctx, doc.root.children, r, live, 0);
  ctx.restore();
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
    if (!shows(base)) { i = j - 1; continue; }
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
        if (!shows(n)) continue;
        if (n.adjust) {  // a correction clipped to the base changes only the group so far
          drawAdjust(gctx, n, r, live, n.opacity, blendOf(n), depth + 1);
          continue;
        }
        const [cc, cctx] = scratchCanvas(`clip${depth}`, r);
        cctx.translate(-r.x, -r.y);
        drawNode(cctx, n, r, live, 1, 'source-over', depth + 1);
        drawNode(cctx, base, r, live, 1, 'destination-in', depth + 1);
        drawBlended(gctx, cc, 0, 0, r, n.opacity, blendOf(n));
      }
      drawBlended(ctx, gc, 0, 0, r, base.opacity, blendOf(base));
      i = j - 1;
    }
  }
}

/** Draws one node (with its mask and any live stroke) into ctx with the given alpha and blend. */
function drawNode(ctx, node, r, live, alpha, blend, depth) {
  if (node.adjust) return drawAdjust(ctx, node, r, live, alpha, blend, depth);
  let src = node.canvas, sx = r.x, sy = r.y;
  const looked = (node.tone || node.effects || node.expression) && !isFolder(node);
  if (looked && keepLooks && !changing(node, keepLooks.except) && !changing(node, live?.layer)) {
    src = keptLook(node, r, depth); sx = 0; sy = 0;
  } else if (node.effects && !isFolder(node)) {
    [src, sx, sy] = effectsLook(node, r, live, depth);
  } else if (isFolder(node)) {
    const [c, cctx] = scratchCanvas(`folder${depth}`, r);
    cctx.translate(-r.x, -r.y);
    drawChildren(cctx, node.children, r, live, depth + 1);
    if (maskOn(node)) applyMask(cctx, node, r, live, depth);
    src = c; sx = 0; sy = 0;
  } else if ((live && live.layer === node) || maskOn(node) || node.tone || node.layerColor || node.expression) {
    [src] = layerImage(node, r, live, depth, node.tone || node.expression ? `tone${depth}` : `node${depth}`);
    sx = 0; sy = 0;
  }
  drawBlended(ctx, src, sx, sy, r, alpha, blend);
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
  drawBlended(ctx, c, 0, 0, r, alpha, blend === 'source-over' ? 'source-atop' : blend);
}

/**
 * A layer with effects in region r: [canvas, sx, sy, empty]. The effects reach beyond r, so the layer is built for
 * a bigger area R and the effects drawn under it there; empty = nothing at all in R.
 */
function effectsLook(node, r, live, depth) {
  const reach = effectReach(node.effects), W = node.canvas.width, H = node.canvas.height;
  const x0 = Math.max(0, r.x - reach), y0 = Math.max(0, r.y - reach);
  const R = { x: x0, y: y0, w: Math.min(W, r.x + r.w + reach) - x0, h: Math.min(H, r.y + r.h + reach) - y0 };
  const [c, cctx] = layerImage(node, R, live, depth, `fxsrc${depth}`);
  const img = cctx.getImageData(0, 0, R.w, R.h).data, fx = effectsImage(img, R.w, R.h, node.effects);
  let empty = true;
  for (let i = 3; i < img.length && empty; i += 4) if (img[i] || fx[i]) empty = false;
  const [e, ectx] = scratchCanvas(`fx${depth}`, R);
  ectx.putImageData(new ImageData(fx, R.w, R.h), 0, 0);
  ectx.drawImage(c, 0, 0, R.w, R.h, 0, 0, R.w, R.h);
  return [e, r.x - R.x, r.y - R.y, empty];
}

// While a stroke is going on (composite's keep), screentone, expression color and effect layers are drawn from tiles of how they look,
// worked out once per tile instead of on every redraw. A layer's tiles are dropped when its pixels (version), canvas,
// tone, effects, expression, layer colour or mask change; the layer being painted on is never drawn from them.
let keepLooks = null;
const looks = new WeakMap();
const LOOK_TILE = 256;

/** Whether raster is node itself or the mask of it (so node is changing while raster is painted). */
const changing = (node, raster) => !!raster && (raster === node || raster === node.mask);

/** Region r of a screentone, expression or effects layer from its kept tiles, in a scratch canvas whose (0, 0) is r's corner. */
function keptLook(node, r, depth) {
  const m = maskOn(node) ? node.mask : null;
  let k = looks.get(node);
  if (!k || k.canvas !== node.canvas || k.version !== node.version || k.tone !== node.tone || k.effects !== node.effects
    || k.layerColor !== node.layerColor || k.expression !== node.expression || k.mask !== (m && m.canvas) || k.maskVersion !== (m ? m.version : -1)) {
    k = { canvas: node.canvas, version: node.version, tone: node.tone, effects: node.effects, layerColor: node.layerColor,
      expression: node.expression, mask: m && m.canvas, maskVersion: m ? m.version : -1, tiles: new Map() };
    looks.set(node, k);
  }
  // put together in a scratch canvas first: drawing tiles one by one would not do for blends like destination-in
  const [c, cctx] = scratchCanvas(`look${depth}`, r);
  const T = LOOK_TILE, W = node.canvas.width, H = node.canvas.height;
  const x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  for (let ty = Math.max(0, Math.floor(r.y / T) * T); ty < y1; ty += T) {
    for (let tx = Math.max(0, Math.floor(r.x / T) * T); tx < x1; tx += T) {
      const key = ty * W + tx;
      let tile = k.tiles.get(key);
      if (tile === undefined) k.tiles.set(key, tile = lookTile(node, { x: tx, y: ty, w: Math.min(T, W - tx), h: Math.min(T, H - ty) }, depth));
      if (!tile) continue;  // nothing there
      const ax = Math.max(r.x, tx), ay = Math.max(r.y, ty);
      const aw = Math.min(x1, tx + tile.width) - ax, ah = Math.min(y1, ty + tile.height) - ay;
      if (aw > 0 && ah > 0) cctx.drawImage(tile, ax - tx, ay - ty, aw, ah, ax - r.x, ay - r.y, aw, ah);
    }
  }
  return c;
}

/** One kept tile t of a screentone, expression or effects layer: a canvas, or null when nothing shows there. */
function lookTile(node, t, depth) {
  let src, sx = 0, sy = 0;
  if (node.effects) {
    let empty;
    [src, sx, sy, empty] = effectsLook(node, t, null, depth);
    if (empty) return null;
  } else [src] = layerImage(node, t, null, depth, `tone${depth}`);
  const c = document.createElement('canvas');
  c.width = t.w; c.height = t.h;
  c.getContext('2d').drawImage(src, sx, sy, t.w, t.h, 0, 0, t.w, t.h);
  return c;
}

/** A layer's region r as shown (live stroke, screentone, expression color, layer colour, mask), in a scratch canvas whose (0, 0) is r's corner. */
function layerImage(node, r, live, depth, key) {
  const [c, cctx] = scratchCanvas(key, r, node.tone || node.effects || node.expression ? { willReadFrequently: true } : undefined);
  cctx.drawImage(node.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (live && live.layer === node) {
    cctx.globalAlpha = live.alpha;
    cctx.globalCompositeOperation = live.mode;
    cctx.drawImage(...liveSource(live, r), r.w, r.h, 0, 0, r.w, r.h);
    cctx.globalAlpha = 1;
    cctx.globalCompositeOperation = 'source-over';
  }
  if (node.tone) toneRegion(cctx, node.tone, r);
  if (node.expression) expressRegion(cctx, node.expression, r.w, r.h);
  if (node.layerColor) colorPaint(cctx, node.layerColor, r.w, r.h);
  if (maskOn(node)) applyMask(cctx, node, r, live, depth);
  return [c, cctx];
}

/**
 * Pixels of a GPU canvas (a layer, mask or the stroke canvas) as ImageData, read through a canvas of their own:
 * getImageData on the canvas itself makes the browser move it off the GPU for good, and every later redraw then
 * uploads it again.
 */
export function readPixels(canvas, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** A layer's pixels with its effects drawn under them (for merging and rasterizing), as a new canvas. */
export function effectsCanvas(layer, canvas = layer.canvas) {
  const W = canvas.width, H = canvas.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (layer.effects) {
    const src = readPixels(canvas, 0, 0, W, H);
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

/** Shows ctx's (0, 0, w, h) in gray or monochrome (Expression color; read back like screentone). */
function expressRegion(ctx, e, w, h) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  applyExpression(img.data, e);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
}

/** Turns everything painted in ctx's (0, 0, w, h) into one colour, keeping how see-through it is (Layer color). */
export function colorPaint(ctx, color, w, h) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A layer's pixels as they show (screentone dots, expression color, layer colour; for merging and rasterizing), as a new canvas. */
export function tonedCanvas(layer) {
  const c = document.createElement('canvas');
  c.width = layer.canvas.width; c.height = layer.canvas.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(layer.canvas, 0, 0);
  if (layer.tone) toneRegion(ctx, layer.tone, { x: 0, y: 0, w: c.width, h: c.height });
  if (layer.expression) expressRegion(ctx, layer.expression, c.width, c.height);
  if (layer.layerColor) colorPaint(ctx, layer.layerColor, c.width, c.height);
  return c;
}

/**
 * Wet edges (live.wet = {amount k, blur, darken}): region r of the stroke A, already in ctx, becomes A * (1 - k) + 2k * A *
 * (1 - B), B being A blurred: the middle of the stroke (where B is as full as A) gives up k of its paint, and a rim
 * just inside the edge (where B has dropped) gains it, as watercolour does when it dries. The blur reads a margin
 * round r, so a part redrawn on its own matches the whole.
 */
function wetEdges(ctx, live, r) {
  const { amount: k, blur } = live.wet, m = Math.ceil(blur * 3);
  const R = { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
  const [src, sx, sy] = strokeOf(live, R);
  const [bc, bctx] = scratchCanvas('wetBlur', R);
  bctx.filter = `blur(${blur}px)`;
  bctx.drawImage(src, sx, sy, R.w, R.h, 0, 0, R.w, R.h);
  bctx.filter = 'none';
  const [rim, rctx] = scratchCanvas('wetRim', r);
  rctx.drawImage(src, sx + m, sy + m, r.w, r.h, 0, 0, r.w, r.h);
  rctx.globalCompositeOperation = 'destination-out';
  rctx.drawImage(bc, m, m, r.w, r.h, 0, 0, r.w, r.h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = k;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, r.w, r.h);
  ctx.globalCompositeOperation = 'lighter';  // same colours, so adding them only adds paint
  for (let left = 2 * k; left > 0; left -= 1) {
    ctx.globalAlpha = Math.min(1, left);
    ctx.drawImage(rim, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
  }
  if (live.wet.darken > 0) {  // the rim's colour darkened too (CLIP STUDIO's Brightness effect), as far as it gathered
    rctx.globalCompositeOperation = 'source-in';
    rctx.fillStyle = '#000';
    rctx.fillRect(0, 0, r.w, r.h);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = Math.min(1, live.wet.darken);
    ctx.drawImage(rim, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Impasto (live.impasto = {amount k, depth d, canvas}): the paint's height (the canvas the dabs were stamped into
 * faintly, so the hairs' streaks stay; else the stroke's own density) is lit from the top left. Where
 * it is higher than d px towards the light (the top-left rim of the stroke, the near side of each bristle ridge) it
 * takes white, where it is higher than d px away from the light, black (only steps over IMPASTO_STEP, made 8
 * times stronger, so the ridges light up and flat paint keeps its colour), both laid source-atop over the paint (r of
 * the stroke already in ctx), so thick paint shows its edges and streaks. Heights are read with a margin round r, so
 * a part redrawn on its own matches the whole; the grain and the selection cut it afterwards, like the paint.
 */
const IMPASTO_STEP = 0.03;  // the height step (alpha) below which paint stays unlit

function impasto(ctx, live, r) {
  const { amount: k, depth: d } = live.impasto, m = Math.ceil(d);
  const R = { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
  const [src, sx, sy] = live.impasto.canvas ? [live.impasto.canvas, R.x, R.y] : strokeOf(live, R);
  for (const [key, dir, color, a] of [['impLight', 1, '#ffffff', 0.55 * k], ['impShade', -1, '#000000', 0.4 * k]]) {
    // how much higher it is than d px towards (or away from) the light, less IMPASTO_STEP, made 8 times stronger:
    // h - h' - step, done on the GPU as for the grain (xor with an opaque fill turns alpha x into 1 - x, 'lighter'
    // adds, a second xor turns it back). Only the clear steps catch the light, so flat paint keeps its colour.
    const [c, cx] = scratchCanvas(key, r);
    cx.drawImage(src, sx + m, sy + m, r.w, r.h, 0, 0, r.w, r.h);
    cx.globalCompositeOperation = 'xor';
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, r.w, r.h);
    cx.globalCompositeOperation = 'lighter';
    cx.drawImage(src, sx + m - dir * d, sy + m - dir * d, r.w, r.h, 0, 0, r.w, r.h);
    cx.globalAlpha = IMPASTO_STEP;
    cx.fillRect(0, 0, r.w, r.h);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'xor';
    cx.fillRect(0, 0, r.w, r.h);
    cx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) cx.drawImage(c, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, r.w, r.h);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = a;
    ctx.drawImage(c, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Region r of a live stroke with a combined brush's second brush (live.combo = {canvas, op}, its dabs drawn there
 * normally) blended over it: [canvas, sx, sy]. The blend mode is applied here, once per read, and not dab by dab:
 * on a big stroke canvas every Multiply / Screen / ... dab made the GPU copy what was under it, and those copies
 * piled up to gigabytes of GPU memory.
 */
function strokeOf(live, r) {
  if (!live.combo) return [live.canvas, r.x, r.y];
  const [c, ctx] = scratchCanvas('combo', r);
  ctx.drawImage(live.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  ctx.globalCompositeOperation = live.combo.op;
  ctx.drawImage(live.combo.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  ctx.globalCompositeOperation = 'source-over';
  return [c, 0, 0];
}

/**
 * A texture mode other than Multiply (live.texture.cpu, painter.js textureFor): region r of the stroke worked out
 * pixel by pixel (texmodes.js) from the copy of the stroke the Painter keeps in memory, so nothing is read back from
 * the GPU; with Pen → grain the texture density is weighed by the strength canvas (also in memory). A combined
 * brush's second brush dabs into the copy too (painter.js comboCopyFor), or with a combine mode other than Normal
 * into a copy of its own, blended over the first brush's here (in memory as well) before the mode is worked out,
 * as strokeOf does for Multiply.
 */
function textureModeSource(ctx, live, r) {
  const { cpu, strength } = live.texture, v = cpu.values;
  let src = cpu.copy, sx = r.x, sy = r.y;
  if (live.combo && cpu.combo.width) {
    const [c, mctx] = scratchCanvas('comboCopy', r, { willReadFrequently: true });
    mctx.drawImage(cpu.copy, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    mctx.globalCompositeOperation = live.combo.op;
    mctx.drawImage(cpu.combo, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    mctx.globalCompositeOperation = 'source-over';
    src = c; sx = sy = 0;
  }
  const img = src.getContext('2d').getImageData(sx, sy, r.w, r.h);
  const st = strength ? strength.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data : null;
  if (v) applyTextureMode(img.data, cpu.mode, cpu.D, i => textureValueAt(v, r.x + i % r.w, r.y + (i / r.w | 0)), st && (i => st[i * 4 + 3]), cpu.emph);
  ctx.putImageData(img, 0, 0);
}

/**
 * Where to read region r of a live stroke from: [canvas, sx, sy]. A stroke with a brush texture
 * (live.texture = {tile, scale}, tile being a canvas whose alpha is what the grain removes) is copied to a scratch
 * canvas and the grain cut out of it there; the texture is anchored to the doc, so it never shifts between updates.
 * With live.texture.strength (Pressure → grain) the grain is first weighed by that canvas's alpha.
 * A stroke inside a selection (live.sel) is cut down to it the same way, once per read: clipping the stroke canvas
 * itself after every dab would apply a feathered selection's partial alpha again and again. live.dual (a canvas of
 * the dual brush's dabs) and live.inside (where a brush that stays inside reference lines may paint) cut it down the same way.
 * A combined brush's second brush is blended in first (strokeOf). With live.pattern = {tile, place} (the pattern
 * brush) the stroke's colour is replaced by the pattern there (source-in), before wet edges, impasto and the grain.
 */
export function liveSource(live, r) {
  if (!live.texture && !live.sel && !live.dual && !live.inside && !live.wet && !live.impasto && !live.pattern) return strokeOf(live, r);
  const [c, ctx] = scratchCanvas('live', r);
  const cpu = live.texture?.cpu;
  if (cpu) textureModeSource(ctx, live, r);
  else {
    const [src, sx, sy] = strokeOf(live, r);
    ctx.drawImage(src, sx, sy, r.w, r.h, 0, 0, r.w, r.h);
  }
  if (live.pattern) {  // the pattern brush: the stroke shows the pattern (fixed to the canvas) instead of its colour
    ctx.globalCompositeOperation = 'source-in';
    paintPattern(ctx, live.pattern.tile, live.pattern.place, r, r);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (live.wet) wetEdges(ctx, live, r);
  if (live.impasto) impasto(ctx, live, r);
  if (live.texture && !cpu) {
    const { tile, scale, angle, strength } = live.texture;
    if (!tile.pattern) tile.pattern = ctx.createPattern(tile, 'repeat');
    tile.pattern.setTransform(new DOMMatrix().translateSelf(-r.x, -r.y).rotateSelf(angle || 0).scaleSelf(scale));
    ctx.globalCompositeOperation = 'destination-out';
    if (strength) {  // Pressure → grain: the grain weighed by how strongly each dab showed it
      const [g, gctx] = scratchCanvas('grain', r);
      gctx.fillStyle = tile.pattern;
      gctx.fillRect(0, 0, r.w, r.h);
      gctx.globalCompositeOperation = 'destination-in';
      gctx.drawImage(strength, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      gctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(g, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
    } else {
      ctx.fillStyle = tile.pattern;
      ctx.fillRect(0, 0, r.w, r.h);
    }
  }
  if (live.sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(live.sel.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  if (live.dual) {  // the dual brush: the stroke shows only where its second tip landed
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(live.dual, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  if (live.inside) {  // a brush that stays inside the reference layers' lines (editor.js insideLinesClip)
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(live.inside, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  }
  ctx.globalCompositeOperation = 'source-over';
  return [c, 0, 0];
}
