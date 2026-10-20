// Color mixing pad (pure, tested): the scratch area of the Color mixing panel (Clip Studio Paint's Window → Color
// Mixing). The pad is RGBA bytes (straight alpha, as ImageData) in memory, shown over white paper, so it is never
// read back from the GPU. Three ways to touch it:
//   brush:  round dabs of the main colour that mix with the paint under them like the wet mixing brush (wetmix.js)
//   blend:  the Smudge tool's dab (smudge.js): pushes and blends the paint already there
//   pick:   the colour under a small spot, over the white paper
// Clear pixels give no colour to the brush, so the first dab on bare paper is the brush colour itself.

import { averageUnder, WetPaint } from './wetmix.js';
import { tipCoverage, smudgeDab } from './smudge.js';

export const PAD_W = 248, PAD_H = 112;
export const PAD_SIZES = [2, 64];        // brush size range, px
export const PAD_MIX = 0.55;             // share of the paint under the brush in its colour
export const PAD_STRETCH = 0.5;          // how far picked-up paint is dragged along
export const PAD_FLOW = 0.5;             // strength of one brush dab
export const PAD_BLEND = 0.55;           // strength of one blender dab
export const PAD_HARDNESS = 0.75;

/** An empty pad (all clear) of w × h. */
export function newPad(w = PAD_W, h = PAD_H) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function clearPad(pad) {
  pad.data.fill(0);
}

/** [r, g, b, a] of the pixel at (x, y); outside the pad it is clear. */
export function padPixel(pad, x, y) {
  if (x < 0 || y < 0 || x >= pad.w || y >= pad.h) return [0, 0, 0, 0];
  const i = (y * pad.w + x) * 4, d = pad.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

/**
 * One round dab of colour c ({r, g, b}) at (x, y), diameter size, laid over what is there (source-over, straight
 * alpha) with strength alpha (0-1) and the tip's soft edge (hardness 0-1).
 */
export function paintDab(pad, x, y, size, c, alpha, hardness = PAD_HARDNESS) {
  const r = size / 2, d = pad.data;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(pad.w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(pad.h - 1, Math.ceil(y + r));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const t = alpha * tipCoverage(Math.hypot(px + 0.5 - x, py + 0.5 - y), r, hardness);
      if (t <= 0) continue;
      const i = (py * pad.w + px) * 4, a = d[i + 3] / 255, out = t + a * (1 - t);
      d[i] = (c.r * t + d[i] * a * (1 - t)) / out;
      d[i + 1] = (c.g * t + d[i + 1] * a * (1 - t)) / out;
      d[i + 2] = (c.b * t + d[i + 2] * a * (1 - t)) / out;
      d[i + 3] = out * 255;
    }
  }
}

/** The colour {r, g, b} seen at (x, y): the paint averaged over a spot of diameter size, over the white paper. */
export function pickColor(pad, x, y, size = 3) {
  const u = averageUnder((px, py) => padPixel(pad, px, py), x, y, size);
  const over = v => v * u.cover + 255 * (1 - u.cover);
  return { r: over(u.r), g: over(u.g), b: over(u.b) };
}

/** The pad's d × d square with its top left corner at (x, y), as RGBA bytes (clear outside the pad). */
function readPatch(pad, x, y, d) {
  const out = new Uint8ClampedArray(d * d * 4);
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < d; i++) out.set(padPixel(pad, x + i, y + j), (j * d + i) * 4);
  }
  return out;
}

function writePatch(pad, patch, x, y, d) {
  for (let j = 0; j < d; j++) {
    const py = y + j;
    if (py < 0 || py >= pad.h) continue;
    for (let i = 0; i < d; i++) {
      const px = x + i;
      if (px < 0 || px >= pad.w) continue;
      const k = (j * d + i) * 4;
      pad.data.set(patch.subarray(k, k + 4), (py * pad.w + px) * 4);
    }
  }
}

/**
 * One stroke on the pad: mode 'brush' (colour {r, g, b}) or 'blend', base diameter size. add(x, y, pressure) lays
 * dabs from the last point to this one, a sixth of the brush apart (the diameter follows the pressure, 30-100 %).
 */
export class PadStroke {
  constructor(pad, { mode = 'brush', color = { r: 0, g: 0, b: 0 }, size = 16 } = {}) {
    this.pad = pad;
    this.mode = mode;
    this.color = color;
    this.size = Math.max(PAD_SIZES[0], Math.min(PAD_SIZES[1], size));
    this.wet = new WetPaint(PAD_MIX, PAD_STRETCH);
    this.buf = null;      // the blender's carried paint, picked up at the first dab
    this.last = null;     // {x, y, s}: the last dab
  }

  sizeAt(pressure) {
    return Math.max(1, this.size * (0.3 + 0.7 * Math.max(0, Math.min(1, pressure))));
  }

  add(x, y, pressure = 1) {
    const s = this.sizeAt(pressure);
    if (!this.last) { this.dab(x, y, s); this.last = { x, y, s }; return; }
    const { x: lx, y: ly, s: ls } = this.last, dist = Math.hypot(x - lx, y - ly);
    let at = 0;
    for (;;) {
      const step = Math.max(1, (ls + (s - ls) * (dist ? at / dist : 1)) / 6);
      if (at + step > dist) break;
      at += step;
      const t = at / dist;
      this.dab(lx + (x - lx) * t, ly + (y - ly) * t, ls + (s - ls) * t);
      this.last = { x: lx + (x - lx) * t, y: ly + (y - ly) * t, s: ls + (s - ls) * t };
    }
  }

  dab(x, y, s) {
    const pad = this.pad;
    if (this.mode === 'blend') {
      const d = Math.max(2, Math.round(s)), px = Math.round(x - d / 2), py = Math.round(y - d / 2);
      const patch = readPatch(pad, px, py, d);
      if (!this.buf || this.buf.length !== patch.length) { this.buf = patch.slice(); return; }  // first touch only picks up
      smudgeDab(patch, this.buf, d, PAD_BLEND, PAD_HARDNESS);
      writePatch(pad, patch, px, py, d);
      return;
    }
    const under = averageUnder((px, py) => padPixel(pad, px, py), x, y, s);
    paintDab(pad, x, y, s, this.wet.next(x, y, s, under, this.color), PAD_FLOW);
  }
}
