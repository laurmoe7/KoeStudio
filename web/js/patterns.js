// Patterns (pure, tested): the built-in pattern tiles, your own patterns (made from a picture or a selection, kept
// per machine in koe.patterns), where a pattern lies on the canvas, and the data of fill layers.
//
// A pattern lies on the canvas through a "place" {scale, angle (degrees clockwise), x, y (doc px), mirror}: the
// tile's (0, 0) sits at (x, y), turned and scaled about it (patternMatrix). It is fixed to the canvas, so strokes and
// fills that use the same place line up.

import { GRADIENT_SHAPES, GRADIENT_REPEATS } from './gradient.js';

/** Built-in patterns: [id, name]. Their tiles are coverage (0-255) shown in the colour they are used with. */
export const BUILTIN_PATTERNS = [
  ['dots', 'Dots'], ['checker', 'Checker'], ['stripes', 'Stripes'], ['lines', 'Lines'], ['grid', 'Grid'],
  ['hatch', 'Cross-hatch'], ['bricks', 'Bricks'], ['waves', 'Waves'],
];
const BUILTIN_IDS = new Set(BUILTIN_PATTERNS.map(p => p[0]));

const mod = (a, n) => ((a % n) + n) % n;

/** Each built-in tile: its size and whether a point (x, y) of it (0 <= x < w, 0 <= y < h) is inked. */
const SHAPES = {
  dots: { w: 16, h: 16, ink: (x, y) => Math.hypot(x - 8, y - 8) <= 4.5 },
  checker: { w: 16, h: 16, ink: (x, y) => (x < 8) === (y < 8) },
  stripes: { w: 16, h: 16, ink: (x, y) => mod(x + y, 16) < 8 },
  lines: { w: 8, h: 8, ink: (x, y) => y >= 3 && y < 5 },
  grid: { w: 16, h: 16, ink: (x, y) => x < 1 || y < 1 },
  hatch: { w: 12, h: 12, ink: (x, y) => mod(x + y + 1, 12) < 2 || mod(x - y + 1, 12) < 2 },
  // bricks 14 x 6 with 2 px of mortar; every other row half a brick on
  bricks: { w: 32, h: 16, ink: (x, y) => { const row = y < 8 ? 0 : 1, yy = y - row * 8, xx = mod(x - row * 16, 16); return yy >= 2 && xx >= 2; } },
  waves: { w: 32, h: 16, ink: (x, y) => Math.abs(y - 8 - 4 * Math.sin(2 * Math.PI * x / 32)) <= 1.5 },
};

const SUB = 4;  // samples per pixel side: each tile pixel is the share of SUB x SUB points inked

/** A built-in pattern's tile: {w, h, values} (values: coverage 0-255, one per pixel, row by row), or null. */
export function builtinPattern(id) {
  const sh = SHAPES[id];
  if (!sh) return null;
  const values = new Uint8ClampedArray(sh.w * sh.h);
  for (let y = 0; y < sh.h; y++) {
    for (let x = 0; x < sh.w; x++) {
      let n = 0;
      for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) if (sh.ink(x + (i + 0.5) / SUB, y + (j + 0.5) / SUB)) n++;
      values[y * sh.w + x] = Math.round(255 * n / (SUB * SUB));
    }
  }
  return { w: sh.w, h: sh.h, values };
}

// ---------- your own patterns ----------
// Kept per machine (koe.patterns) as [{id, name, src (PNG data URL), w, h}]; settings name one as 'user:<id>'.

export const MAX_USER_PATTERNS = 40;
/** The longest side a pattern of your own is kept at (bigger pictures are scaled down). */
export const PATTERN_MAX = 512;
const USER_ID = /^[0-9a-z]{1,16}$/;
const isPng = s => typeof s === 'string' && s.startsWith('data:image/png;base64,');
const side = v => Number.isInteger(+v) && +v >= 1 && +v <= PATTERN_MAX;

/** Whether a pattern setting names one of your patterns ('user:<id>'). */
export function isUserPattern(id) { return typeof id === 'string' && id.startsWith('user:') && USER_ID.test(id.slice(5)); }

/** Whether a pattern setting names a pattern that exists (built in, or one of `user`). */
export function patternExists(id, user = []) {
  return BUILTIN_IDS.has(id) || (isUserPattern(id) && user.some(p => p.id === id.slice(5)));
}

/** Your patterns from storage: valid ones only, unique ids, at most MAX_USER_PATTERNS. */
export function sanitizeUserPatterns(raw) {
  const out = [], ids = new Set();
  for (const p of Array.isArray(raw) ? raw : []) {
    if (!USER_ID.test(p?.id) || ids.has(p.id) || !isPng(p.src) || !side(p.w) || !side(p.h)) continue;
    ids.add(p.id);
    out.push({ id: p.id, name: String(p.name || 'Pattern').slice(0, 40), src: p.src, w: +p.w, h: +p.h });
    if (out.length >= MAX_USER_PATTERNS) break;
  }
  return out;
}

/** The Pattern choices of a tool: off (paint in the colour), the built-in patterns, then yours. */
export function patternChoices(user = [], off = 'Off') {
  return [...(off ? [['none', off]] : []), ...BUILTIN_PATTERNS, ...user.map(p => [`user:${p.id}`, p.name])];
}

/** The size a picture of w x h is kept at as a pattern: scaled down to PATTERN_MAX on its longer side. */
export function patternSize(w, h) {
  const k = Math.min(1, PATTERN_MAX / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// ---------- where a pattern lies ----------

export const PATTERN_SCALE = [0.05, 20];
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = v => Math.round(v * 1e6) / 1e6 + 0;  // + 0 turns -0 into 0
const degrees = a => round(mod(a, 360));

/** A place cleaned up: scale within PATTERN_SCALE, angle 0-360, offsets finite. */
export function sanitizePlace(p) {
  return { scale: clamp(num(p?.scale, 1), ...PATTERN_SCALE), angle: degrees(num(p?.angle, 0)), x: clamp(num(p?.x, 0), -1e5, 1e5), y: clamp(num(p?.y, 0), -1e5, 1e5), mirror: p?.mirror === true };
}

/** The affine [a, b, c, d, e, f] taking tile pixels to doc pixels: translate(x, y) · rotate(angle) · scale(±scale, scale). */
export function patternMatrix(p) {
  return exactMatrix(p).map(round);
}

function exactMatrix(p) {
  const r = (p.angle || 0) * Math.PI / 180, s = p.scale ?? 1, sx = p.mirror ? -s : s;
  const cos = Math.cos(r), sin = Math.sin(r);
  return [sx * cos, sx * sin, -s * sin, s * cos, p.x || 0, p.y || 0];
}

/**
 * The place after the canvas is changed by m (an affine, old doc point to new: flips, turns, image size, crop): the
 * pattern follows the picture. A stretch that is not even (image size with another aspect) keeps the pattern
 * square, scaled by the mean.
 */
export function mapPlace(p, m) {
  const [a, b, c, d] = exactMatrix(p), [ma, mb, mc, md, me, mf] = m;
  const A = ma * a + mc * b, B = mb * a + md * b, C = ma * c + mc * d, D = mb * c + md * d;
  const det = A * D - B * C, mirror = det < 0;
  const scale = Math.sqrt(Math.abs(det));
  // the tile's x axis is (A, B); mirrored, it points the other way to the turn
  const angle = Math.atan2(mirror ? -B : B, mirror ? -A : A) * 180 / Math.PI;
  const x = ma * (p.x || 0) + mc * (p.y || 0) + me, y = mb * (p.x || 0) + md * (p.y || 0) + mf;
  return sanitizePlace({ scale: round(scale), angle, x: round(x), y: round(y), mirror });
}

// ---------- fill layers ----------
// A layer's `fill` (its pixels are always a rendering of it, fillrender.js):
//   {type: 'color', color: '#rrggbb'}
//   {type: 'gradient', colors (the Colors setting it was made with), stops: [[offset, css colour]], shape, repeat,
//    angle (degrees clockwise), scale (length as a share of the canvas), cx, cy (its middle, doc px)}
//   {type: 'pattern', id (the pattern it was made from), name, src (PNG data URL of the tile as used), w, h, ...a place}
// Fill objects are never changed in place: every edit makes a new one.

export const FILL_TYPES = [['color', 'Color'], ['gradient', 'Gradient'], ['pattern', 'Pattern']];
export const GRADIENT_SCALE = [0.05, 10];
const MAX_FILL_STOPS = 64;
const HEX = /^#[0-9a-f]{6}$/i;
const CSS = /^(#[0-9a-f]{6}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i;
const SHAPE_IDS = new Set(GRADIENT_SHAPES.map(s => s[0]));
const REPEAT_IDS = new Set(GRADIENT_REPEATS.map(s => s[0]));

/** A fill layer's data cleaned up (loading, pasting), or null when it is not one. */
export function sanitizeFill(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'color') return { type: 'color', color: HEX.test(raw.color) ? raw.color.toLowerCase() : '#000000' };
  if (raw.type === 'gradient') {
    const stops = (Array.isArray(raw.stops) ? raw.stops : [])
      .filter(s => Array.isArray(s) && Number.isFinite(+s[0]) && typeof s[1] === 'string' && CSS.test(s[1]))
      .map(([o, c]) => [clamp(+o, 0, 1), c]).sort((p, q) => p[0] - q[0]).slice(0, MAX_FILL_STOPS);
    return {
      type: 'gradient', colors: typeof raw.colors === 'string' ? raw.colors.slice(0, 60) : 'main-sub',
      stops: stops.length >= 2 ? stops : [[0, '#000000'], [1, '#ffffff']],
      shape: SHAPE_IDS.has(raw.shape) ? raw.shape : 'linear', repeat: REPEAT_IDS.has(raw.repeat) ? raw.repeat : 'none',
      angle: degrees(num(raw.angle, 0)), scale: clamp(num(raw.scale, 1), ...GRADIENT_SCALE),
      cx: clamp(num(raw.cx, 0), -1e5, 1e5), cy: clamp(num(raw.cy, 0), -1e5, 1e5),
    };
  }
  if (raw.type === 'pattern') {
    if (!isPng(raw.src) || !side(raw.w) || !side(raw.h)) return null;
    return { type: 'pattern', id: typeof raw.id === 'string' ? raw.id.slice(0, 30) : '', name: String(raw.name || 'Pattern').slice(0, 40), src: raw.src, w: +raw.w, h: +raw.h, ...sanitizePlace(raw) };
  }
  return null;
}

/**
 * Where a gradient fill's colours run on a W x H canvas: {start, end} for the Gradient tool's drawing. Straight
 * (and Reflected) ones run across the canvas through the middle at the angle, `scale` times the canvas's extent
 * that way (Reflected from the middle out); the others go out from the middle, `scale` times half the diagonal.
 */
export function gradientLine(g, W, H) {
  const r = g.angle * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r);
  const half = (W * Math.abs(dx) + H * Math.abs(dy)) / 2 * g.scale;
  const at = k => ({ x: round(g.cx + dx * k), y: round(g.cy + dy * k) });
  if (g.shape === 'linear') return { start: at(-half), end: at(half) };
  return { start: at(0), end: at(g.shape === 'reflected' ? half : Math.hypot(W, H) / 2 * g.scale) };
}

/** A fill after the canvas is changed by m (see mapPlace): a gradient's middle and direction and a pattern follow. */
export function mapFill(f, m) {
  if (f.type === 'pattern') return { ...f, ...mapPlace(f, m) };
  if (f.type !== 'gradient') return f;
  const [a, b, c, d, e, ff] = m, r = f.angle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
  return { ...f, cx: round(a * f.cx + c * f.cy + e), cy: round(b * f.cx + d * f.cy + ff), angle: degrees(Math.atan2(b * ux + d * uy, a * ux + c * uy) * 180 / Math.PI) };
}

/** A new gradient fill for a W x H canvas: across it from the middle. */
export function newGradientFill(stops, colors, W, H, opts = {}) {
  return sanitizeFill({ type: 'gradient', colors, stops, shape: opts.shape, repeat: opts.repeat, angle: opts.angle ?? 0, scale: opts.scale ?? 1, cx: W / 2, cy: H / 2 });
}
