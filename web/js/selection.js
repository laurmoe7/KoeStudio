// The selection: a doc-sized mask canvas (alpha = how selected a pixel is), its bounds and its outline.
// Painting, filling, clearing, copying and transforming all respect it. Pure helpers at the bottom are tested.

import { expandMask, shrinkMask, featherMask, borderMask } from './maskops.js';
import { clip, union } from './rect.js';

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

  /** A test (x, y) -> whether that doc point is more than half selected, reading the mask once (for vector lines). */
  insideTest() {
    const { w, h } = this, a = this.ctx.getImageData(0, 0, w, h).data;
    return (px, py) => {
      const ix = Math.floor(px), iy = Math.floor(py);
      return ix >= 0 && iy >= 0 && ix < w && iy < h && a[(iy * w + ix) * 4 + 3] > 127;
    };
  }

  /**
   * A copy of the mask for undo (with its bounds and outline, so restoring it reads nothing back): {alpha, bounds,
   * segments}, only the selected part and only its alpha (the mask is black), read from the mask canvas, which lives
   * in memory (willReadFrequently). A canvas copy kept a GPU texture per undo step: 48 MB for Select all on 3000 x 4000.
   */
  snapshot() {
    const b = this.bounds;  // outside them the mask is empty
    return { alpha: b ? alphaOf(this.ctx.getImageData(b.x, b.y, b.w, b.h).data) : null, bounds: b && { ...b }, segments: this.segments };
  }

  restore(snap) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (snap.bounds) this.ctx.putImageData(fromAlpha(snap.alpha, snap.bounds.w, snap.bounds.h), snap.bounds.x, snap.bounds.y);
    if (!snap.segments) return this.refresh(snap.bounds);
    this.bounds = snap.bounds && { ...snap.bounds };
    this.segments = snap.segments;
    this.version = (this.version || 0) + 1;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.bounds = null;
    this.segments = [];
  }

  all() {
    const { w, h } = this;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, w, h);
    // known without reading the mask back: the whole canvas, outlined by its edges
    this.bounds = { x: 0, y: 0, w, h };
    this.segments = [[0, 0, w, 0], [0, h, w, h], [0, 0, 0, h], [w, 0, w, h]];
    this.version = (this.version || 0) + 1;
  }

  invert() {
    const c = this.ctx;
    c.globalCompositeOperation = 'xor';
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'source-over';
    this.refresh();
  }

  /**
   * Combines a shape with the selection. draw(ctx) paints the shape in any opaque colour; area, when given, is a
   * rect the shape stays inside, so only that much of the mask is read back afterwards.
   */
  combine(mode, draw, area = null) {
    const old = this.bounds;
    // the shape is drawn into a canvas only as big as its area (anti-aliased edges included), in doc coordinates
    const pad = area && clip({ x: area.x - 2, y: area.y - 2, w: area.w + 4, h: area.h + 4 }, this.w, this.h);
    const at = pad || { x: 0, y: 0, w: this.w, h: this.h };
    const tmp = document.createElement('canvas');
    tmp.width = at.w; tmp.height = at.h;
    const t = tmp.getContext('2d');
    t.translate(-at.x, -at.y);
    t.fillStyle = '#000';
    draw(t);
    const c = this.ctx;
    if (mode === 'replace') c.clearRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = compositeFor(mode);
    if (mode === 'intersect' && pad) {  // keeps nothing outside the shape's area either
      c.save();
      c.beginPath(); c.rect(0, 0, this.w, this.h); c.rect(pad.x, pad.y, pad.w, pad.h); c.clip('evenodd');
      c.clearRect(0, 0, this.w, this.h);
      c.restore();
    }
    c.drawImage(tmp, at.x, at.y);
    c.globalCompositeOperation = 'source-over';
    if (mode === 'subtract' || mode === 'intersect') this.refresh(old);
    else this.refresh(pad && (mode === 'replace' ? pad : union(old, pad)));
  }

  /** Combines a 0/1 mask (as from fill.js) with the selection. */
  combineMask(mode, mask, b) {
    this.combine(mode, ctx => {
      const img = new ImageData(b.w, b.h);
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) if (mask[(b.y + y) * this.w + b.x + x]) img.data[(y * b.w + x) * 4 + 3] = 255;
      }
      const m = document.createElement('canvas');  // putImageData would ignore combine's translation
      m.width = b.w; m.height = b.h;
      m.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(m, b.x, b.y);
    }, b);
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

  /** Turns the selection into a band n pixels wide along its edge. */
  border(n) {
    if (!this.bounds || !(n > 0)) return;
    this.setAlphaPlane(borderMask(this.alphaPlane(), this.w, this.h, n));
  }

  /** Softens the selection's edges over about r pixels. */
  feather(r) {
    if (!this.bounds || !(r > 0)) return;
    this.setAlphaPlane(featherMask(this.alphaPlane(), this.w, this.h, r));
  }

  /**
   * Recomputes bounds and outline after the mask changed. area: a rect outside which the mask is known to be
   * empty, so only that part is read (a whole 4000 x 6000 mask took a fifth of a second); null reads all of it.
   */
  refresh(area = null) {
    this.version = (this.version || 0) + 1;  // the overlay's cached marching ants are redrawn when this changes
    const r = clip(area || { x: 0, y: 0, w: this.w, h: this.h }, this.w, this.h);
    if (!r) { this.bounds = null; this.segments = []; return; }
    const data = this.ctx.getImageData(r.x, r.y, r.w, r.h).data;
    const alpha = new Uint8Array(r.w * r.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    Object.assign(this, maskOutline(alpha, r.w, r.h, r.x, r.y));
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
 * Bounds and outline segments of a mask region w x h whose top left is at (ox, oy) in the doc; the doc is taken
 * to be empty outside the region.
 */
export function maskOutline(alpha, w, h, ox = 0, oy = 0) {
  const b = maskBounds(alpha, w, h);
  if (!b) return { bounds: null, segments: [] };
  return {
    bounds: { x: b.x + ox, y: b.y + oy, w: b.w, h: b.h },
    segments: outlineSegments(alpha, w, h, b).map(([x1, y1, x2, y2]) => [x1 + ox, y1 + oy, x2 + ox, y2 + oy]),
  };
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

/**
 * Where the selection bar goes (screen px): centred under the selection's screen points `pts`, `gap` below its
 * lowest point; above it when there is no room below; at the bottom edge when neither fits. Kept `margin` inside
 * the vw x vh viewport. Returns {x, y} of the bar's top-left corner.
 */
export function selectionBarSpot(pts, barW, barH, vw, vh, gap = 10, margin = 8) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const top = Math.min(...ys), bottom = Math.max(...ys), mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  let y = bottom + gap;
  if (y + barH > vh - margin) y = top - gap - barH >= margin ? top - gap - barH : vh - margin - barH;
  const x = Math.max(margin, Math.min(vw - margin - barW, mid - barW / 2));
  return { x: Math.round(x), y: Math.round(Math.max(margin, y)) };
}

/** The alpha channel of RGBA pixels. */
export function alphaOf(rgba) {
  const a = new Uint8Array(rgba.length >> 2);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  return a;
}

/** Black pixels with alpha a, as w x h ImageData. */
export function fromAlpha(a, w, h) {
  const img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < a.length; i++) d[i * 4 + 3] = a[i];
  return img;
}

/** Memory a selection snapshot holds. */
export const selBytes = snap => (snap?.alpha ? snap.alpha.length : 0) + (snap?.segments?.length || 0) * 40;
