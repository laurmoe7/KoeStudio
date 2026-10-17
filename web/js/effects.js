// Layer effects (pure, tested): a Border round what is on the layer (Clip Studio Paint's "Border effect") and a
// Drop shadow. They are drawn by composite() under the layer's own pixels and never change them; a layer keeps
// them in `effects` = {border: {size, color} | null, shadow: {x, y, blur, color, opacity} | null}.

import { chamferDistance } from './maskops.js';
import { blurPlane } from './filters.js';
import { hexToRgb } from './color.js';

export const BORDER_SIZE = [1, 100];
export const SHADOW_OFFSET = 300;
export const SHADOW_BLUR = [0, 100];

const hex = (v, dflt) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : dflt);
const num = (v, lo, hi, dflt) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : dflt);

/** A layer's effects from a file or a dialog; null when there are none. */
export function sanitizeEffects(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw.border && typeof raw.border === 'object' ? raw.border : null;
  const s = raw.shadow && typeof raw.shadow === 'object' ? raw.shadow : null;
  const out = {
    border: b ? { size: Math.round(num(b.size, ...BORDER_SIZE, 4)), color: hex(b.color, '#ffffff') } : null,
    shadow: s ? {
      x: Math.round(num(s.x, -SHADOW_OFFSET, SHADOW_OFFSET, 8)), y: Math.round(num(s.y, -SHADOW_OFFSET, SHADOW_OFFSET, 8)),
      blur: Math.round(num(s.blur, ...SHADOW_BLUR, 8)), color: hex(s.color, '#000000'), opacity: num(s.opacity, 0, 1, 0.5),
    } : null,
  };
  return out.border || out.shadow ? out : null;
}

/** How far outside a layer's pixels its effects reach (so a change there must redraw this much around it). */
export function effectReach(fx) {
  if (!fx) return 0;
  const b = fx.border ? fx.border.size + 1 : 0;
  const s = fx.shadow ? b + Math.max(Math.abs(fx.shadow.x), Math.abs(fx.shadow.y)) + Math.ceil(fx.shadow.blur * 1.5) + 1 : 0;
  return Math.max(b, s);
}

/**
 * How much border covers each pixel: full within `size` px of the layer's paint (alpha >= 128), fading over the last
 * pixel so the outer edge is smooth; at least the layer's own alpha.
 */
export function borderAlpha(alpha, w, h, size) {
  const set = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) set[i] = alpha[i] >= 128 ? 1 : 0;
  const d = chamferDistance(set, w, h);
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = Math.max(alpha[i], Math.max(0, Math.min(1, size + 0.5 - d[i] / 3)) * 255);
  return out;
}

/** The shadow's alpha: the given alpha moved by (dx, dy) and blurred (radius as for Gaussian blur), times opacity. */
export function shadowAlpha(alpha, w, h, dx, dy, blur, opacity) {
  const p = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < w) p[y * w + x] = alpha[sy * w + sx];
    }
  }
  if (blur > 0) blurPlane(p, w, h, blur);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = p[i] * opacity;
  return out;
}

/**
 * The effects for a patch of a layer (RGBA, w × h, its edges at least effectReach beyond what will be shown): the
 * shadow, with the border over it, as RGBA to draw under the layer's own pixels.
 */
export function effectsImage(data, w, h, fx) {
  const out = new Uint8ClampedArray(w * h * 4);
  if (!fx) return out;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const border = fx.border ? borderAlpha(alpha, w, h, fx.border.size) : null;
  // the shadow falls from the paint and its border together
  const layers = [];
  if (fx.shadow) layers.push([shadowAlpha(border || alpha, w, h, fx.shadow.x, fx.shadow.y, fx.shadow.blur, fx.shadow.opacity), hexToRgb(fx.shadow.color)]);
  if (border) layers.push([border, hexToRgb(fx.border.color)]);
  for (const [a, [r, g, b]] of layers) {  // source-over, straight alpha
    for (let i = 0; i < a.length; i++) {
      const sa = a[i] / 255;
      if (!sa) continue;
      const j = i * 4, da = out[j + 3] / 255, oa = sa + da * (1 - sa);
      out[j] = (r * sa + out[j] * da * (1 - sa)) / oa;
      out[j + 1] = (g * sa + out[j + 1] * da * (1 - sa)) / oa;
      out[j + 2] = (b * sa + out[j + 2] * da * (1 - sa)) / oa;
      out[j + 3] = oa * 255;
    }
  }
  return out;
}
