// Integer rectangles {x, y, w, h} (pure, tested). Used for dirty regions and undo patches.

export function union(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Clips r to a width x height canvas; null when nothing is left. */
export function clip(r, width, height) {
  if (!r) return null;
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w)), y1 = Math.min(height, Math.ceil(r.y + r.h));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** The rect round the pixels with any alpha in RGBA bytes of a w x h picture; null when all are clear. */
export function alphaBounds(rgba, w, h) {
  const row = y => { for (let i = y * w * 4 + 3, e = i + w * 4; i < e; i += 4) if (rgba[i]) return true; return false; };
  let y0 = 0, y1 = h - 1;
  while (y0 < h && !row(y0)) y0++;
  if (y0 === h) return null;
  while (!row(y1)) y1--;
  let x0 = w, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const b = y * w * 4 + 3;
    for (let x = 0; x < x0; x++) if (rgba[b + x * 4]) { x0 = x; break; }
    for (let x = w - 1; x > x1; x--) if (rgba[b + x * 4]) { x1 = x; break; }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
