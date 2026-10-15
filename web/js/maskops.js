// Growing, shrinking and feathering a mask (pure, tested). Masks are Uint8Array/Uint8ClampedArray alpha planes
// (w*h, 0-255) as the selection keeps them; a pixel counts as inside at alpha >= 128.

import { blurPlane } from './filters.js';

const INSIDE = 128;

/**
 * Distance from every pixel to the nearest pixel of `set` (a w*h 0/1 array), in thirds of a pixel: the 3-4
 * chamfer distance (3 per step along an axis, 4 per diagonal step), which is Euclidean to within a few percent.
 * borderIsSet: treat everything beyond the canvas edge as part of the set.
 */
export function chamferDistance(set, w, h, borderIsSet = false) {
  const INF = 1 << 29;
  const d = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = set[i] ? 0 : INF;
  if (borderIsSet) {
    for (let x = 0; x < w; x++) { d[x] = Math.min(d[x], 3); d[(h - 1) * w + x] = Math.min(d[(h - 1) * w + x], 3); }
    for (let y = 0; y < h; y++) { d[y * w] = Math.min(d[y * w], 3); d[y * w + w - 1] = Math.min(d[y * w + w - 1], 3); }
  }
  // forward pass: from the neighbours above and to the left
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  // backward pass: from the neighbours below and to the right
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  return d;
}

/** The mask grown by n pixels in every direction (round corners): everything within n of it becomes fully selected. */
export function expandMask(alpha, w, h, n) {
  const set = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) set[i] = alpha[i] >= INSIDE ? 1 : 0;
  const d = chamferDistance(set, w, h);
  const out = new Uint8ClampedArray(alpha.length);
  const limit = Math.round(n * 3);
  for (let i = 0; i < alpha.length; i++) out[i] = d[i] <= limit ? 255 : alpha[i];
  return out;
}

/** The mask shrunk by n pixels from its edges, the canvas edges included (so Select all, shrink makes a border). */
export function shrinkMask(alpha, w, h, n) {
  const outside = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) outside[i] = alpha[i] >= INSIDE ? 0 : 1;
  const d = chamferDistance(outside, w, h, true);
  const out = new Uint8ClampedArray(alpha.length);
  const limit = Math.round(n * 3);
  for (let i = 0; i < alpha.length; i++) out[i] = d[i] <= limit ? 0 : alpha[i];
  return out;
}

/**
 * A band n pixels wide along the mask's edge, half outside and half inside it (the outer half gets the odd pixel):
 * the mask grown by ceil(n/2) minus the mask shrunk by floor(n/2).
 */
export function borderMask(alpha, w, h, n) {
  const outer = expandMask(alpha, w, h, Math.ceil(n / 2)), inner = shrinkMask(alpha, w, h, Math.floor(n / 2));
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = outer[i] - inner[i];
  return out;
}

/** Softens the mask's edges over about `radius` pixels each way (a Gaussian blur of the alpha). */
export function featherMask(alpha, w, h, radius) {
  const plane = new Float32Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) plane[i] = alpha[i];
  blurPlane(plane, w, h, radius);
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = Math.round(plane[i]);
  return out;
}
