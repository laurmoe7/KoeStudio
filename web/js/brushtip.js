// Brush tip and texture images (pure, tested): turning a user's PNG into a tip shape or a paper grain.
//
// A tip image with any transparency is its alpha (the drawn shape, whatever its colour); a fully opaque one is
// read as ink on paper, dark = paint. A texture image is read as paper: light = tooth tops where paint sticks,
// dark = grooves it skips (textureInvert swaps them).

export const TIP_MAX = 512;       // tips are scaled down to this longest side when loaded
export const TEXTURE_MAX = 1024;  // and textures to this

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** The tip shape (paint amount 0-255 per pixel) of RGBA pixels. */
export function tipMask(data) {
  const n = data.length / 4, out = new Uint8ClampedArray(n);
  let clear = false;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 255) { clear = true; break; }
  for (let i = 0; i < n; i++) out[i] = clear ? data[i * 4 + 3] : 255 - Math.round(luma(data, i * 4));
  return out;
}

/** The paper grain (gray 0-255, 255 = paint sticks) of RGBA pixels; see-through counts as tooth top. */
export function textureGray(data) {
  const n = data.length / 4, out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    out[i] = Math.round(luma(data, i * 4) * a + 255 * (1 - a));
  }
  return out;
}

/** Width and height scaled down (never up) so the longer side is at most max. */
export function fitSide(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The setting value naming a library image ('img:<id>'), or null when it is not one. */
export function imageRef(v) {
  const m = /^img:([0-9a-f]{8,32})$/.exec(typeof v === 'string' ? v : '');
  return m ? m[1] : null;
}

/** How far a dab reaches from its centre, as a share of its size: a rotated image tip reaches into its corners. */
export function tipReach(hasImage) {
  return hasImage ? Math.SQRT1_2 : 0.5;
}
