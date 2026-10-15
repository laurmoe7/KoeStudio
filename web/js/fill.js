// Paint-bucket flood fill (pure, tested). Works on RGBA bytes as in ImageData.data.

import { chamferDistance } from './maskops.js';

/**
 * Pixels connected to (x, y) whose colour is within tolerance (0-255, per channel incl. alpha) of the start pixel;
 * with contiguous = false every such pixel in the image, connected or not.
 * Returns { mask: Uint8Array(w*h) with 1 = fill, bounds: {x, y, w, h} } or null when (x, y) is outside.
 */
export function floodMask(data, w, h, x, y, tolerance = 0, contiguous = true) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const i0 = (y * w + x) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
  const match = i => {
    // fully transparent pixels count as one colour whatever their RGB
    if (a0 === 0 && data[i + 3] <= tolerance) return true;
    return Math.abs(data[i] - r0) <= tolerance && Math.abs(data[i + 1] - g0) <= tolerance &&
      Math.abs(data[i + 2] - b0) <= tolerance && Math.abs(data[i + 3] - a0) <= tolerance;
  };
  const mask = new Uint8Array(w * h);
  let minX = x, maxX = x, minY = y, maxY = y;
  if (!contiguous) {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (!match((py * w + px) * 4)) continue;
        mask[py * w + px] = 1;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  }
  const stack = [x, y];
  while (stack.length) {
    const sy = stack.pop(), sx0 = stack.pop();
    let sx = sx0;
    const row = sy * w;
    if (mask[row + sx] || !match((row + sx) * 4)) continue;
    let lx = sx;
    while (lx > 0 && !mask[row + lx - 1] && match((row + lx - 1) * 4)) lx--;
    let rx = sx;
    while (rx < w - 1 && !mask[row + rx + 1] && match((row + rx + 1) * 4)) rx++;
    for (let i = lx; i <= rx; i++) mask[row + i] = 1;
    if (lx < minX) minX = lx;
    if (rx > maxX) maxX = rx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const ok = !mask[nrow + i] && match((nrow + i) * 4);
        if (ok && !inRun) stack.push(i, ny);
        inRun = ok;
      }
    }
  }
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Grows a mask by n pixels (square neighbourhood), so a fill tucks under anti-aliased line edges. */
export function growMask(mask, w, h, n, bounds) {
  if (n <= 0) return { mask, bounds };
  let cur = mask;
  for (let k = 0; k < n; k++) {
    const next = cur.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue;
        if ((x > 0 && cur[y * w + x - 1]) || (x < w - 1 && cur[y * w + x + 1]) ||
            (y > 0 && cur[(y - 1) * w + x]) || (y < h - 1 && cur[(y + 1) * w + x])) next[y * w + x] = 1;
      }
    }
    cur = next;
  }
  const x = Math.max(0, bounds.x - n), y = Math.max(0, bounds.y - n);
  return { mask: cur, bounds: { x, y, w: Math.min(w, bounds.x + bounds.w + n) - x, h: Math.min(h, bounds.y + bounds.h + n) - y } };
}

/**
 * Fill that does not leak through small gaps in line art (Fill → Close gaps). The lines (every pixel not of the
 * clicked colour) are thickened by `gap` px, so openings up to about twice that close; the area is flood filled
 * inside the thickened lines and then grown back out to the real lines, within the clicked colour. Clicking too
 * close to a line to start inside falls back to the ordinary fill.
 */
export function closeGapFill(data, w, h, x, y, tolerance = 0, gap = 0) {
  const plain = floodMask(data, w, h, x, y, tolerance, true);
  if (!plain || !(gap > 0)) return plain;
  const same = floodMask(data, w, h, x, y, tolerance, false).mask;
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < wall.length; i++) wall[i] = same[i] ? 0 : 1;
  const toWall = chamferDistance(wall, w, h), limit = Math.round(gap * 3);  // thirds of a pixel
  const sx = Math.floor(x), sy = Math.floor(y);
  if (toWall[sy * w + sx] <= limit) return plain;
  // the core: connected to the click and further than `gap` from every line
  const core = new Uint8Array(w * h), stack = [sy * w + sx];
  core[sy * w + sx] = 1;
  while (stack.length) {
    const i = stack.pop(), px = i % w, py = (i - px) / w;
    for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) {
      if (j >= 0 && !core[j] && toWall[j] > limit) { core[j] = 1; stack.push(j); }
    }
  }
  // grown back by the gap (and a diagonal step, so corners fill), only over the clicked colour
  const toCore = chamferDistance(core, w, h), back = limit + 4, mask = new Uint8Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!(core[i] || (same[i] && toCore[i] <= back))) continue;
    mask[i] = 1;
    const px = i % w, py = (i - px) / w;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}
