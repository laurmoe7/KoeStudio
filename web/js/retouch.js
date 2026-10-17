// Retouch dabs (pure, tested): Blur, Dodge, Burn and Clone stamp change the layer under a round tip, like Smudge.
// Each works on a d × d patch of RGBA bytes (straight alpha, as ImageData); the tip's coverage comes from
// tipCoverage in smudge.js, so hardness feels the same in every tool.

import { tipCoverage } from './smudge.js';
import { gaussianBlur } from './filters.js';

/**
 * Moves dst towards src (both d × d patches) by strength × tip coverage, mixing premultiplied so clear pixels never
 * tint their neighbours. With lockAlpha only the colour changes. dst is changed in place.
 */
export function mixDab(dst, src, d, strength, hardness, lockAlpha = false) {
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const t = strength * tipCoverage(Math.hypot(x + 0.5 - r, y + 0.5 - r), r, hardness);
      if (t <= 0) continue;
      const i = (y * d + x) * 4;
      const da = dst[i + 3] / 255, sa = src[i + 3] / 255;
      const a = da * (1 - t) + sa * t;
      if (a > 0) {
        for (let c = 0; c < 3; c++) dst[i + c] = (dst[i + c] * da * (1 - t) + src[i + c] * sa * t) / a;
      }
      if (!lockAlpha) dst[i + 3] = a * 255;
    }
  }
  return dst;
}

/**
 * Dodge (lighten) or burn (darken) a patch under the tip: each colour channel moves towards white (dodge) or black
 * (burn) by strength × coverage. Transparency is kept, so it only works where there is paint.
 */
export function toneDab(dst, d, strength, hardness, burn) {
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const t = strength * tipCoverage(Math.hypot(x + 0.5 - r, y + 0.5 - r), r, hardness);
      if (t <= 0) continue;
      const i = (y * d + x) * 4;
      for (let c = 0; c < 3; c++) dst[i + c] = burn ? dst[i + c] * (1 - t) : dst[i + c] + (255 - dst[i + c]) * t;
    }
  }
  return dst;
}

/**
 * The patch of an image (data, W × H) whose top-left corner is (x, y), w × h big; pixels outside the image are clear.
 */
export function copyRegion(data, W, H, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= H) continue;
    const x0 = Math.max(0, -x), x1 = Math.min(w, W - x);
    if (x1 <= x0) continue;
    out.set(data.subarray((sy * W + x + x0) * 4, (sy * W + x + x1) * 4), (j * w + x0) * 4);
  }
  return out;
}

/** How far around a dab of diameter d the Blur tool reads (its blur radius). */
export function blurRadius(d) { return Math.max(1, Math.round(d / 8)); }

/**
 * The blurred version of the d × d patch at (x, y) of an image (W × H), read with a margin so the blur sees what is
 * around the tip.
 */
export function blurredPatch(data, W, H, x, y, d) {
  const m = blurRadius(d) * 2, w = d + 2 * m;
  const big = gaussianBlur(copyRegion(data, W, H, x - m, y - m, w, w), w, w, blurRadius(d));
  const out = new Uint8ClampedArray(d * d * 4);
  for (let j = 0; j < d; j++) out.set(big.subarray(((j + m) * w + m) * 4, ((j + m) * w + m + d) * 4), j * d * 4);
  return out;
}
