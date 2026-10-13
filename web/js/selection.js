// The selection: a doc-sized mask canvas (alpha = how selected a pixel is), its bounds and its outline.
// Painting, filling, clearing, copying and transforming all respect it. Pure helpers at the bottom are tested.

import { expandMask, shrinkMask, featherMask } from './maskops.js';

export const SELECT_MODES = [['replace', 'New selection'], ['add', 'Add (Shift)'], ['subtract', 'Subtract (Alt)'], ['intersect', 'Intersect (Shift+Alt)']];

export class Selection {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.bounds = null;  // null = nothing selected (everything may be painted)
    this.segments = [];
  }

  get active() { return !!this.bounds; }

  /** A copy of the mask for undo. */
  snapshot() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    if (this.bounds) c.getContext('2d').drawImage(this.canvas, 0, 0);
    return { canvas: c, bounds: this.bounds && { ...this.bounds } };
  }

  restore(snap) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (snap.bounds) this.ctx.drawImage(snap.canvas, 0, 0);
    this.refresh();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.bounds = null;
    this.segments = [];
  }

  all() {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.refresh();
  }

  invert() {
    const c = this.ctx;
    c.globalCompositeOperation = 'xor';
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'source-over';
    this.refresh();
  }

  /** Combines a shape with the selection. draw(ctx) paints the shape in any opaque colour. */
  combine(mode, draw) {
    const tmp = document.createElement('canvas');
    tmp.width = this.w; tmp.height = this.h;
    const t = tmp.getContext('2d');
    t.fillStyle = '#000';
    draw(t);
    const c = this.ctx;
    if (mode === 'replace') c.clearRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = compositeFor(mode);
    c.drawImage(tmp, 0, 0);
    c.globalCompositeOperation = 'source-over';
    this.refresh();
  }

  /** Combines a 0/1 mask (as from fill.js) with the selection. */
  combineMask(mode, mask, b) {
    this.combine(mode, ctx => {
      const img = new ImageData(b.w, b.h);
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) if (mask[(b.y + y) * this.w + b.x + x]) img.data[(y * b.w + x) * 4 + 3] = 255;
      }
      ctx.putImageData(img, b.x, b.y);
    });
  }

  /** The mask as an alpha plane (0-255 per pixel). */
  alphaPlane() {
    const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const alpha = new Uint8Array(this.w * this.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return alpha;
  }

  /** Replaces the mask by an alpha plane. */
  setAlphaPlane(alpha) {
    const img = new ImageData(this.w, this.h);
    for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
    this.ctx.putImageData(img, 0, 0);
    this.refresh();
  }

  /** Grows ('expand') or shrinks ('shrink') the selection by n pixels (maskops.js). */
  morph(kind, n) {
    if (!this.bounds || !(n > 0)) return;
    const fn = kind === 'shrink' ? shrinkMask : expandMask;
    this.setAlphaPlane(fn(this.alphaPlane(), this.w, this.h, n));
  }

  /** Softens the selection's edges over about r pixels. */
  feather(r) {
    if (!this.bounds || !(r > 0)) return;
    this.setAlphaPlane(featherMask(this.alphaPlane(), this.w, this.h, r));
  }

  /** Recomputes bounds and outline after the mask changed. */
  refresh() {
    const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const alpha = new Uint8Array(this.w * this.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    this.bounds = maskBounds(alpha, this.w, this.h);
    this.segments = this.bounds ? outlineSegments(alpha, this.w, this.h, this.bounds) : [];
  }

  /** Cuts ctx's content down to the selection inside rect r (no-op without a selection). */
  clipCanvas(ctx, r) {
    if (!this.bounds || !r) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
}

export function compositeFor(mode) {
  return { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in' }[mode] || 'source-over';
}

/** Selection mode from the tool setting and the keys held when the drag starts. */
export function modeFor(setting, shift, alt) {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return setting || 'replace';
}

/** Bounding box of pixels with alpha >= 1; null when empty. */
export function maskBounds(alpha, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Outline of the selection (pixels with alpha >= 128) as merged horizontal and vertical pixel-edge segments
 * [x1, y1, x2, y2] in doc coordinates, for drawing the "marching ants".
 */
export function outlineSegments(alpha, w, h, b) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= 128;
  const segs = [];
  // horizontal edges: between row y-1 and row y
  for (let y = b.y; y <= b.y + b.h; y++) {
    let start = -1;
    for (let x = b.x; x <= b.x + b.w; x++) {
      const edge = x < b.x + b.w && inside(x, y - 1) !== inside(x, y);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) { segs.push([start, y, x, y]); start = -1; }
    }
  }
  // vertical edges: between column x-1 and column x
  for (let x = b.x; x <= b.x + b.w; x++) {
    let start = -1;
    for (let y = b.y; y <= b.y + b.h; y++) {
      const edge = y < b.y + b.h && inside(x - 1, y) !== inside(x, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) { segs.push([x, start, x, y]); start = -1; }
    }
  }
  return segs;
}

/** Normalised rectangle between two points, snapped to whole pixels. */
export function rectBetween(a, b) {
  const x0 = Math.round(Math.min(a.x, b.x)), y0 = Math.round(Math.min(a.y, b.y));
  const x1 = Math.round(Math.max(a.x, b.x)), y1 = Math.round(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
