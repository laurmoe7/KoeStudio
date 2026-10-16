// KoeStudio documents to and from the PSD model in psd.js (needs canvases, so it runs in the window, not in tests).
// Export keeps the layer tree, names, visibility, opacity, blend modes, clipping and masks; text, vector and
// screentone layers go out as their pixels (screentone as dots). Import builds an ordinary artwork from it.

import { Doc, Layer, Folder, Mask, tonedCanvas } from './doc.js';
import { maskBounds } from './selection.js';
import { insertNode, isFolder } from './tree.js';

/** The pixels of a raster cut to where something is: {x, y, w, h, rgba}; an empty raster gives 0 x 0. */
function cropped(canvas, w, h) {
  const all = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = all[i * 4 + 3];
  const b = maskBounds(alpha, w, h);
  if (!b) return { x: 0, y: 0, w: 0, h: 0, rgba: new Uint8ClampedArray(0), alpha };
  const rgba = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) rgba.set(all.subarray(((b.y + y) * w + b.x) * 4, ((b.y + y) * w + b.x + b.w) * 4), y * b.w * 4);
  return { ...b, rgba, alpha };
}

/** A KoeStudio mask (alpha = how much is hidden) as a PSD mask (255 = shown), cut to what it hides. */
function psdMask(mask, w, h) {
  if (!mask) return null;
  const { x, y, w: mw, h: mh, alpha } = cropped(mask.canvas, w, h);
  if (!mw) return null;  // hides nothing
  const data = new Uint8Array(mw * mh);
  for (let yy = 0; yy < mh; yy++) for (let xx = 0; xx < mw; xx++) data[yy * mw + xx] = 255 - alpha[(y + yy) * w + x + xx];
  return { x, y, w: mw, h: mh, data, outside: 255, enabled: mask.enabled !== false };
}

/** The PSD model of a document. With paper (a colour), a bottom "Paper" layer holds it; composite is the flat picture. */
export function docToPsd(doc, { paper = true, composite } = {}) {
  const W = doc.width, H = doc.height;
  const node = n => {
    const common = { name: n.name, visible: n.visible, opacity: n.opacity, blend: n.blend, clip: !!n.clip, mask: psdMask(n.mask, W, H) };
    if (isFolder(n)) return { ...common, folder: true, open: n.open !== false, children: n.children.map(node) };
    const px = cropped(n.tone ? tonedCanvas(n) : n.canvas, W, H);
    return { ...common, x: px.x, y: px.y, w: px.w, h: px.h, rgba: px.rgba };
  };
  const layers = doc.root.children.map(node);
  if (paper && doc.paper) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = doc.paper;
    ctx.fillRect(0, 0, W, H);
    layers.unshift({ name: 'Paper', visible: true, opacity: 1, blend: 'source-over', clip: false, mask: null, x: 0, y: 0, w: W, h: H, rgba: ctx.getImageData(0, 0, W, H).data });
  }
  return { width: W, height: H, layers, composite };
}

/** Puts w x h RGBA bytes on a canvas at (x, y). */
function putPixels(ctx, rgba, x, y, w, h) {
  if (w > 0 && h > 0) ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), x, y);
}

/** A new artwork (no paper: PSD backgrounds are layers) from a PSD model. */
export function docFromPsd(model, title) {
  const W = model.width, H = model.height;
  const d = new Doc({ width: W, height: H, title, paper: null });
  const maskOf = m => {
    if (!m) return null;
    const mask = new Mask(W, H, m.enabled !== false);
    const ctx = mask.ctx;
    if (m.outside === 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.clearRect(m.x, m.y, m.w, m.h); }  // hidden outside its box
    const rgba = new Uint8ClampedArray(m.w * m.h * 4);
    for (let i = 0; i < m.w * m.h; i++) rgba[i * 4 + 3] = 255 - m.data[i];  // black, as opaque as it hides
    putPixels(ctx, rgba, m.x, m.y, m.w, m.h);
    mask.touch();
    return mask;
  };
  const build = (src, parent) => {
    const props = { name: src.name || (src.folder ? 'Folder' : 'Layer'), visible: src.visible, opacity: src.opacity, blend: src.blend, clip: src.clip, open: src.open };
    let n;
    if (src.folder) {
      n = new Folder(props);
      for (const c of src.children) build(c, n);
    } else {
      n = new Layer(W, H, { ...props, blend: src.blend === 'pass-through' ? 'source-over' : src.blend });
      putPixels(n.ctx, src.rgba, src.x, src.y, src.w, src.h);
      n.touch();
    }
    n.mask = maskOf(src.mask);
    insertNode(parent, parent.children.length, n);
    return n;
  };
  for (const src of model.layers) build(src, d.root);
  if (!model.layers.length) {  // only a flat picture
    const l = new Layer(W, H, { name: 'Background' });
    putPixels(l.ctx, model.composite, 0, 0, W, H);
    l.touch();
    insertNode(d.root, 0, l);
  }
  const kids = d.root.children;
  d.active = [...kids].reverse().find(n => !isFolder(n)) || kids[kids.length - 1] || null;  // the top layer
  if (!d.active) { const l = new Layer(W, H, { name: 'Layer 1' }); insertNode(d.root, 0, l); d.active = l; }
  return d;
}
