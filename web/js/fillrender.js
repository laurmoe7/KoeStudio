// Drawing patterns and gradients, and fill layers (their pixels are always a rendering of `layer.fill`,
// patterns.js). Shared by the Fill tool, the pattern brush (doc.js liveSource), the Gradient tool and fill layers.

import { builtinPattern, patternMatrix, gradientLine } from './patterns.js';
import { gradientReach, repeatStops, reflectStops, diamondQuarters } from './gradient.js';

const builtins = new Map();  // 'id|colour' -> tile canvas, least recently used first
const BUILTINS_MAX = 64;     // one tile per pattern and colour: kept for the colours in use, not every colour ever picked
const decoded = new Map();   // PNG data URL -> tile canvas (null while it decodes, false when it cannot)
const pending = new Map();   // PNG data URL -> promise

/** A built-in pattern's tile in a colour (a canvas, kept), or null for an unknown id. */
export function builtinTile(id, color) {
  const key = id + '|' + color;
  const kept = builtins.get(key);
  if (kept) { builtins.delete(key); builtins.set(key, kept); return kept; }  // now the most recent
  const p = builtinPattern(id);
  if (!p) return null;
  const c = document.createElement('canvas');
  c.width = p.w; c.height = p.h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(p.w, p.h);
  const n = parseInt(color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  for (let i = 0; i < p.values.length; i++) { img.data.set([r, g, b, p.values[i]], i * 4); }
  ctx.putImageData(img, 0, 0);
  builtins.set(key, c);
  if (builtins.size > BUILTINS_MAX) builtins.delete(builtins.keys().next().value);  // not freed: a fill layer may still draw it
  return c;
}

const urls = new WeakMap();  // tile canvas -> its PNG data URL

/** A tile as a PNG data URL (for a fill layer to keep), known at once as decoded. */
export function tileSrc(tile) {
  let src = urls.get(tile);
  if (!src) { src = tile.toDataURL('image/png'); urls.set(tile, src); decoded.set(src, tile); }
  return src;
}

/** The tile of a pattern kept as a PNG data URL, once decoded (loadPatternSrc); null until then. */
export function srcTile(src) { return decoded.get(src) || null; }

/** Decodes a pattern's PNG data URL into a tile canvas (kept), resolving to it, or to null when it cannot be read. */
export function loadPatternSrc(src) {
  if (decoded.get(src)) return Promise.resolve(decoded.get(src));
  if (!pending.has(src)) {
    pending.set(src, (async () => {
      try {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        decoded.set(src, c);
        return c;
      } catch { decoded.set(src, false); return null; } finally { pending.delete(src); }
    })());
  }
  return pending.get(src);
}

const blacks = new WeakMap();  // tile -> its shape in black (for masks)

/** A tile in black with its own alpha: what a pattern hides when used on a mask. */
export function blackTile(tile) {
  let c = blacks.get(tile);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = tile.width; c.height = tile.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(tile, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillRect(0, 0, c.width, c.height);
  blacks.set(tile, c);
  return c;
}

/**
 * Fills `area` (doc px) of ctx with a tile laid at `place` (patterns.js). ctx draws in doc px; `origin` is the doc
 * point ctx's (0, 0) stands for when it is a scratch canvas of part of the doc.
 */
export function paintPattern(ctx, tile, place, area, origin = { x: 0, y: 0 }) {
  const pat = ctx.createPattern(tile, 'repeat');
  pat.setTransform(new DOMMatrix().translateSelf(-origin.x, -origin.y).multiplySelf(new DOMMatrix(patternMatrix(place))));
  ctx.fillStyle = pat;
  ctx.fillRect(area.x - origin.x, area.y - origin.y, area.w, area.h);
}

/**
 * Draws a gradient into `area` of ctx: shape and repeat as the Gradient tool's, colours `stops` [[offset, css]],
 * running from `start` to `end` (doc points; ctx draws in doc px).
 */
export function drawGradient(ctx, { shape: kind, repeat, start, end, stops, area }) {
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  if (len < 0.5) return;
  // Reflected: one straight gradient from the start mirrored behind it to the end, with its stops both ways
  const shape = kind === 'reflected' ? 'linear' : kind;
  const from = kind === 'reflected' ? { x: 2 * start.x - end.x, y: 2 * start.y - end.y } : start;
  if (kind === 'reflected') stops = reflectStops(stops);
  let a = from, b = end, r = len;
  const span = Math.hypot(end.x - from.x, end.y - from.y);
  if ((repeat === 'repeat' || repeat === 'mirror') && shape !== 'conic') {  // stretch the gradient over the area, with copies of the stops
    const { before, after } = gradientReach(shape, from, end, area), dx = end.x - from.x, dy = end.y - from.y;
    const reps = before + 1 + after;
    stops = repeatStops(stops, repeat, reps, before, 1 / (span * reps));
    a = { x: from.x - before * dx, y: from.y - before * dy };
    b = { x: end.x + after * dx, y: end.y + after * dy };
    r = len * (1 + after);
  }
  const fill = grad => {
    for (const [o, c] of stops) grad.addColorStop(o, c);
    ctx.fillStyle = grad;
  };
  if (shape === 'diamond') {  // four straight gradients, one per quarter (diamondQuarters)
    const far = 2 * (Math.hypot(area.w, area.h) + Math.hypot(start.x - area.x, start.y - area.y));
    ctx.save();
    for (const q of diamondQuarters(start, end, r, far)) {
      ctx.beginPath();
      q.poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      fill(ctx.createLinearGradient(q.from.x, q.from.y, q.to.x, q.to.y));
      ctx.fillRect(area.x, area.y, area.w, area.h);
      ctx.restore();
    }
    ctx.restore();
  } else {
    fill(shape === 'radial' ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, r)
      : shape === 'conic' ? ctx.createConicGradient(Math.atan2(end.y - start.y, end.x - start.x), start.x, start.y)
        : ctx.createLinearGradient(a.x, a.y, b.x, b.y));
    ctx.fillRect(area.x, area.y, area.w, area.h);
  }
}

/**
 * Draws a fill layer's pixels from `layer.fill` (or `fill`, to show settings being tried). False, leaving the
 * pixels as they are, when its pattern's picture is not decoded yet (loadPatternSrc).
 */
export function renderFillLayer(layer, fill = layer.fill) {
  if (!fill) return false;
  const W = layer.canvas.width, H = layer.canvas.height, ctx = layer.ctx, all = { x: 0, y: 0, w: W, h: H };
  const tile = fill.type === 'pattern' ? srcTile(fill.src) : null;
  if (fill.type === 'pattern' && !tile) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  if (fill.type === 'color') {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, W, H);
  } else if (fill.type === 'gradient') {
    drawGradient(ctx, { ...fill, ...gradientLine(fill, W, H), area: all });
  } else paintPattern(ctx, tile, fill, all);
  ctx.restore();
  layer.touch();
  return true;
}
