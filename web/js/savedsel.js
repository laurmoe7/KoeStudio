// Saved selections (Select → Save selection…): named selection masks kept with the artwork, as Clip Studio Paint's
// selection layers or Photoshop's alpha channels. In memory each is {id, name, x, y, w, h, alpha}: the mask's alpha
// over its bounds only (one byte a pixel). In the file each is {name, x, y, w, h, png}, the PNG being that part of
// the mask in black. Entries never change: renaming or a change of canvas size makes new ones, so the undo steps
// just swap lists, and `png` is worked out once per entry.
// The pure helpers at the top are tested; the canvas ones below them need a browser.

import { maskBounds, alphaOf, fromAlpha } from './selection.js';

/** How many selections one artwork keeps. */
export const SAVED_SEL_MAX = 50;
const NAME_MAX = 60;
let nextId = 1;

/** A new saved selection (box: {x, y, w, h} in the doc; alpha: its w x h alpha bytes). */
export const savedSel = (name, box, alpha) => ({ id: nextId++, name: cleanSelName(name), x: box.x, y: box.y, w: box.w, h: box.h, alpha });

/** A name as kept: no control characters, trimmed, at most NAME_MAX characters; 'Selection' when nothing is left. */
export function cleanSelName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX).trim() || 'Selection';
}

/** The name offered for the next saved selection: 'Selection n', n the smallest number not in use. */
export function nextSelName(names) {
  const used = new Set(names);
  let n = 1;
  while (used.has(`Selection ${n}`)) n++;
  return `Selection ${n}`;
}

/** `wanted` (cleaned), or with ' 2', ' 3'... after it when another saved selection has that name already. */
export function uniqueSelName(names, wanted) {
  const used = new Set(names), base = cleanSelName(wanted);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * The saved selections of a file, cleaned (pure, tested): at most SAVED_SEL_MAX, each with a PNG and whole-pixel
 * bounds inside the W x H canvas (others are left out); [] when there are none.
 */
export function sanitizeSavedSels(raw, W, H) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (out.length >= SAVED_SEL_MAX) break;
    if (!s || typeof s !== 'object' || typeof s.png !== 'string' || !s.png.startsWith('data:image/png')) continue;
    const [x, y, w, h] = [s.x, s.y, s.w, s.h];
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > W || y + h > H) continue;
    out.push({ name: cleanSelName(s.name), x, y, w, h, png: s.png });
  }
  return out;
}

/** A w x h alpha plane cut down to its selected part: {x, y, w, h, alpha}, or null when nothing is selected. */
export function cropAlpha(alpha, w, h) {
  const b = maskBounds(alpha, w, h);
  if (!b) return null;
  const out = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) out.set(alpha.subarray((b.y + y) * w + b.x, (b.y + y) * w + b.x + b.w), y * b.w);
  return { ...b, alpha: out };
}

/** Memory a list of saved selections holds that `other` (an earlier list) does not. */
export function savedSelBytes(list, other = []) {
  const old = new Set(other);
  return list.reduce((n, s) => n + (old.has(s) ? 0 : s.alpha.length), 0);
}

// ---------- with a canvas ----------

/** The saved selection as a w x h canvas (black, alpha = how selected). */
export function savedSelCanvas(s) {
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  c.getContext('2d').putImageData(fromAlpha(s.alpha, s.w, s.h), 0, 0);
  return c;
}

/** The entry as saved in the file; its PNG is made once and kept with it. */
export async function savedSelJSON(s) {
  if (!s.png) {
    const c = savedSelCanvas(s);
    s.png = c.toDataURL('image/png');
    c.width = c.height = 0;
  }
  return { name: s.name, x: s.x, y: s.y, w: s.w, h: s.h, png: s.png };
}

/** A saved selection from the file (sanitizeSavedSels); null when its picture cannot be read or has the wrong size. */
export async function savedSelFrom(raw) {
  const img = await new Promise(resolve => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = raw.png;
  });
  if (!img || img.width !== raw.w || img.height !== raw.h) return null;
  const c = document.createElement('canvas');
  c.width = raw.w;
  c.height = raw.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const alpha = alphaOf(ctx.getImageData(0, 0, raw.w, raw.h).data);
  c.width = c.height = 0;
  return { ...savedSel(raw.name, raw, alpha), png: raw.png };
}

/**
 * The saved selection after the canvas changes (m: [a..f], old doc point to new; flips, turns, resizes, crops)
 * to a W x H canvas; null when none of it is left on the canvas.
 */
export function mapSavedSel(s, m, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true }), src = savedSelCanvas(s);
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...m);
  ctx.drawImage(src, s.x, s.y);
  const cut = cropAlpha(alphaOf(ctx.getImageData(0, 0, W, H).data), W, H);
  c.width = c.height = src.width = src.height = 0;
  return cut && savedSel(s.name, cut, cut.alpha);
}
