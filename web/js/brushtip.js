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

/**
 * A Procreate shape (white = paint on black) as a see-through tip, in place: black pixels whose alpha is the
 * brightness (times any alpha the picture already has). invert: the brush says the shape is drawn black on white.
 */
export function whiteToAlpha(data, invert = false) {
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data, i);
    data[i + 3] = Math.round((invert ? 255 - v : v) * data[i + 3] / 255);
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return data;
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
/**
 * The Bristles tip: n soft dots in a row across the tip (x, y and radius r in tip widths, 0-1; a = strength), so a
 * tip turned across the stroke (tipFollow, angle 90) drags each dot into its own streak, as a dry brush does. The
 * dots sit close enough to overlap a little, with a few thin or faint ones; the layout is always the same.
 */
export function bristleDots(n = 12) {
  let h = 12345;
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9 | 0; return ((h >>> 0) % 10000) / 10000; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = 0.025 + 0.03 * rnd();
    const x = Math.max(r, Math.min(1 - r, (i + 0.5) / n + (rnd() - 0.5) * 0.5 / n));
    out.push({ x, y: 0.5 + (rnd() - 0.5) * 0.12, r, a: 0.55 + 0.45 * rnd() });
  }
  return out;
}

export function tipReach(hasImage) {
  return hasImage ? Math.SQRT1_2 : 0.5;
}
