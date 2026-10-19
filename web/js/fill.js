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

/**
 * Grows a mask by n pixels (a step to each side per pixel, so diagonals grow by n steps), so a fill tucks under
 * anti-aliased line edges. Only the bounds (grown a pixel per step) are visited, and mask itself is left as it is.
 */
export function growMask(mask, w, h, n, bounds) {
  if (n <= 0) return { mask, bounds };
  const cur = mask.slice();
  let x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.w - 1, y1 = bounds.y + bounds.h - 1;
  for (let k = 0; k < n; k++) {
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    for (let y = y0; y <= y1; y++) {  // 2 marks this step's new pixels, so they do not grow again within it
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1] === 1) || (x < w - 1 && cur[i + 1] === 1) || (y > 0 && cur[i - w] === 1) || (y < h - 1 && cur[i + w] === 1)) cur[i] = 2;
      }
    }
    for (let y = y0; y <= y1; y++) for (let i = y * w + x0, e = y * w + x1; i <= e; i++) if (cur[i] === 2) cur[i] = 1;
  }
  return { mask: cur, bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
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
  // Everything happens within the plain fill's bounds plus a margin: the result lies inside the plain fill, and a
  // line or core pixel that decides a distance is never further than the gap (+4/3 px) from where it counts. On a
  // big canvas this is the difference between half a second and a few ms; the result is the same.
  const m = Math.ceil(gap) + 3, b = plain.bounds;
  const rx = Math.max(0, b.x - m), ry = Math.max(0, b.y - m);
  const rw = Math.min(w, b.x + b.w + m) - rx, rh = Math.min(h, b.y + b.h + m) - ry;
  const sub = new Uint8ClampedArray(rw * rh * 4);
  for (let row = 0; row < rh; row++) sub.set(data.subarray(((ry + row) * w + rx) * 4, ((ry + row) * w + rx + rw) * 4), row * rw * 4);
  const local = gapFillIn(sub, rw, rh, Math.floor(x) - rx, Math.floor(y) - ry, tolerance, gap);
  if (!local) return plain;
  const mask = new Uint8Array(w * h);
  for (let row = 0; row < rh; row++) mask.set(local.mask.subarray(row * rw, (row + 1) * rw), (ry + row) * w + rx);
  const lb = local.bounds;
  return { mask, bounds: { x: lb.x + rx, y: lb.y + ry, w: lb.w, h: lb.h } };
}

/** closeGapFill on a picture (or a part of one) with the click at (sx, sy); null when the click is too near a line. */
function gapFillIn(data, w, h, sx, sy, tolerance, gap) {
  const same = floodMask(data, w, h, sx, sy, tolerance, false).mask;
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < wall.length; i++) wall[i] = same[i] ? 0 : 1;
  const toWall = chamferDistance(wall, w, h), limit = Math.round(gap * 3);  // thirds of a pixel
  if (toWall[sy * w + sx] <= limit) return null;
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

/** Whether pixel i (RGBA index / 4) of reference pixels is line art: mostly opaque and not near white. */
export function isLinePixel(data, i) {
  const j = i * 4;
  return data[j + 3] >= 128 && data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114 < 200;
}

/**
 * Where a brush that does not cross reference lines may paint (Clip Studio Paint's anti-overflow): the open area
 * (no line pixels, see isLinePixel) connected to (x, y), grown `grow` px into the lines round it so the paint tucks
 * under their soft edges without reaching past a thin line. A start on a line uses the nearest open pixel within
 * `reach` px. Returns {mask (Uint8Array, 1 = may paint), bounds} or null when there is no open pixel that close.
 */
export function insideLines(data, w, h, x, y, reach = 0, grow = 2) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const line = new Uint8Array(w * h);
  for (let i = 0; i < line.length; i++) line[i] = isLinePixel(data, i) ? 1 : 0;
  if (line[y * w + x]) {  // on a line: the closest open pixel round it
    let best = null, bd = Infinity;
    const r = Math.ceil(reach);
    for (let py = Math.max(0, y - r); py <= Math.min(h - 1, y + r); py++) {
      for (let px = Math.max(0, x - r); px <= Math.min(w - 1, x + r); px++) {
        const dd = (px - x) ** 2 + (py - y) ** 2;
        if (!line[py * w + px] && dd < bd && dd <= reach * reach) { bd = dd; best = [px, py]; }
      }
    }
    if (!best) return null;
    [x, y] = best;
  }
  const open = new Uint8ClampedArray(w * h * 4);  // floodMask wants RGBA: open pixels clear, lines opaque
  for (let i = 0; i < line.length; i++) open[i * 4 + 3] = line[i] ? 255 : 0;
  const res = floodMask(open, w, h, x, y, 0);
  const mask = res.mask;
  let { x: x0, y: y0 } = res.bounds, x1 = x0 + res.bounds.w - 1, y1 = y0 + res.bounds.h - 1;
  for (let k = 0; k < grow; k++) {  // only into line pixels, so a thin line is covered but not crossed
    const add = [];
    for (let py = Math.max(0, y0 - 1); py <= Math.min(h - 1, y1 + 1); py++) {
      for (let px = Math.max(0, x0 - 1); px <= Math.min(w - 1, x1 + 1); px++) {
        const i = py * w + px;
        if (mask[i] || !line[i]) continue;
        if ((px > 0 && mask[i - 1]) || (px < w - 1 && mask[i + 1]) || (py > 0 && mask[i - w]) || (py < h - 1 && mask[i + w])) add.push(i);
      }
    }
    for (const i of add) {
      mask[i] = 1;
      const px = i % w, py = (i - px) / w;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  return { mask, bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
