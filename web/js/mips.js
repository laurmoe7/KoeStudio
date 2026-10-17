// Downscaled copies of the composite (pure maths, tested), for drawing the picture zoomed out. The browser's own
// high-quality downscaling rebuilds mipmaps of the whole source image whenever it changes, which on a big canvas
// costs the GPU 15+ ms per frame while painting. The editor keeps its own levels instead (level k is the picture at
// 1 / 2^k), refreshes only the part that changed, and draws the nearest level with plain bilinear filtering.

/** How many halvings to draw from at screen scale s (doc px → device px): the level whose scale stays ≥ 0.5. */
export function mipLevel(s) {
  if (!(s > 0) || s >= 0.5) return 0;
  return Math.min(8, Math.floor(Math.log2(1 / s)));
}

/** The size of level k of a W × H picture. */
export function mipSize(W, H, k) {
  const f = 2 ** k;
  return { w: Math.max(1, Math.ceil(W / f)), h: Math.max(1, Math.ceil(H / f)) };
}

/** The pixels of level k that doc rect r touches (whole pixels, clipped to the level), or null. */
export function mipRect(r, k, W, H) {
  const f = 2 ** k, { w, h } = mipSize(W, H, k);
  const x0 = Math.max(0, Math.floor(r.x / f)), y0 = Math.max(0, Math.floor(r.y / f));
  const x1 = Math.min(w, Math.ceil((r.x + r.w) / f)), y1 = Math.min(h, Math.ceil((r.y + r.h) / f));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
