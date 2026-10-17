// Gradient tool maths (pure, tested).

import { hexToRgb } from './color.js';
import { noiseAt } from './filters.js';

export const GRADIENT_COLORS = [
  ['main-sub', 'Main → sub'], ['main-clear', 'Main → transparent'],
  ['sub-main', 'Sub → main'], ['clear-main', 'Transparent → main'], ['main-sub-main', 'Main → sub → main'],
  ['rainbow', 'Rainbow'], ['sunset', 'Sunset'], ['sky', 'Sky'], ['fire', 'Fire'], ['night', 'Night'], ['gray', 'Black → white'],
];

/** Ready-made gradients with several colours (they ignore the main and sub colour). */
export const GRADIENT_PRESETS = {
  rainbow: ['#ff2a2a', '#ff9a1f', '#ffe11f', '#3ccf4e', '#2a9dff', '#4b3cff', '#b13cff'],
  sunset: ['#2b1055', '#7b2c8f', '#d53369', '#f2784b', '#ffd36e'],
  sky: ['#0b3d91', '#2f74c8', '#78b4ea', '#cfe8ff'],
  fire: ['#1a0000', '#8b0000', '#ff4500', '#ffa500', '#fff3b0'],
  night: ['#05060f', '#141a3a', '#2e2a6b', '#5b3f8c'],
  gray: ['#000000', '#ffffff'],
};
export const GRADIENT_SHAPES = [['linear', 'Straight'], ['radial', 'Circle']];
export const GRADIENT_REPEATS = [['none', 'Once'], ['repeat', 'Repeat'], ['mirror', 'Mirror']];
const MAX_REPEATS = 1000;

const clear = hex => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},0)`; };

// ---------- your own gradients ----------
// Kept per machine (koe.gradients) as {id, name, stops: [{o, c, a}]}: offset 0-1, colour ('#rrggbb', or 'main' /
// 'sub' for the colour squares as they are when used) and opacity 0-1. The Colors setting names one as 'user:<id>'.

export const MAX_USER_GRADIENTS = 50;
export const MAX_STOPS = 16;
const USER_ID = /^[0-9a-z]{1,16}$/;

/** A stop's colour as written: a hex colour, or 'main' / 'sub'. */
const stopColor = c => (c === 'main' || c === 'sub' ? c : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

/** Stops cleaned up: valid ones only, offsets and opacities clamped, sorted by offset, 2 to MAX_STOPS. */
export function sanitizeStops(raw) {
  const out = [];
  for (const st of Array.isArray(raw) ? raw : []) {
    const c = stopColor(st?.c);
    if (!c || !Number.isFinite(+st.o)) continue;
    out.push({ o: Math.max(0, Math.min(1, +st.o)), c, a: Number.isFinite(+st.a) && st.a !== null && st.a !== '' ? Math.max(0, Math.min(1, +st.a)) : 1 });
  }
  out.sort((p, q) => p.o - q.o);
  if (out.length < 2) return null;
  return out.slice(0, MAX_STOPS);
}

/** Your gradients from storage: valid ones only, unique ids, at most MAX_USER_GRADIENTS. */
export function sanitizeUserGradients(raw) {
  const out = [], ids = new Set();
  for (const g of Array.isArray(raw) ? raw : []) {
    const stops = sanitizeStops(g?.stops);
    if (!stops || !USER_ID.test(g?.id) || ids.has(g.id)) continue;
    ids.add(g.id);
    out.push({ id: g.id, name: String(g.name || 'Gradient').slice(0, 40), stops });
    if (out.length >= MAX_USER_GRADIENTS) break;
  }
  return out;
}

/** Whether a Colors setting names one of your gradients ('user:<id>'). */
export function isUserGradient(kind) { return typeof kind === 'string' && kind.startsWith('user:') && USER_ID.test(kind.slice(5)); }

/** The Colors choices: the built-in ones, then yours. */
export function gradientChoices(user = []) { return [...GRADIENT_COLORS, ...user.map(g => [`user:${g.id}`, g.name])]; }

/** A stop as a CSS colour, its 'main' / 'sub' filled in. */
export function stopCss(st, main, sub) {
  const [r, g, b] = hexToRgb(st.c === 'main' ? main : st.c === 'sub' ? sub : st.c) || [0, 0, 0];
  return st.a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+st.a.toFixed(3)})`;
}

/**
 * The stop to add at offset o: its colour and opacity are what the gradient shows there now (mixed between the
 * stops on either side), so adding one changes nothing until you edit it. Returns the new stop list (sorted).
 */
export function addStopAt(stops, o, main, sub) {
  const rgb = st => hexToRgb(st.c === 'main' ? main : st.c === 'sub' ? sub : st.c);
  let i = stops.findIndex(st => st.o >= o);
  let st;
  if (i <= 0) st = { ...stops[i < 0 ? stops.length - 1 : 0], o };
  else {
    const p = stops[i - 1], q = stops[i], t = q.o > p.o ? (o - p.o) / (q.o - p.o) : 0;
    const a = rgb(p), b = rgb(q), mix = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    st = { o, c: '#' + mix.map(v => v.toString(16).padStart(2, '0')).join(''), a: +(p.a + (q.a - p.a) * t).toFixed(3) };
  }
  return [...stops, st].sort((p, q) => p.o - q.o);
}

/** A Colors setting as editable stops ({o, c, a}), to start a new gradient of your own from. */
export function stopsFor(kind, user = []) {
  if (isUserGradient(kind)) {
    const g = user.find(x => x.id === kind.slice(5));
    if (g) return g.stops.map(st => ({ ...st }));
  }
  const S = (o, c, a = 1) => ({ o, c, a });
  switch (kind) {
    case 'main-clear': return [S(0, 'main'), S(1, 'main', 0)];
    case 'sub-main': return [S(0, 'sub'), S(1, 'main')];
    case 'clear-main': return [S(0, 'main', 0), S(1, 'main')];
    case 'main-sub-main': return [S(0, 'main'), S(0.5, 'sub'), S(1, 'main')];
    default: {
      const preset = GRADIENT_PRESETS[kind];
      if (preset) return preset.map((c, i) => S(+(i / (preset.length - 1)).toFixed(4), c));
      return [S(0, 'main'), S(1, 'sub')];
    }
  }
}

/** Colour stops [[offset, css colour], ...] for a colour setting. Fading to transparent keeps the hue. */
export function gradientStops(kind, main, sub, user = []) {
  if (isUserGradient(kind)) {
    const g = user.find(x => x.id === kind.slice(5));
    if (g) return g.stops.map(st => [st.o, stopCss(st, main, sub)]);
    return [[0, main], [1, sub]];  // deleted since: main → sub
  }
  switch (kind) {
    case 'main-clear': return [[0, main], [1, clear(main)]];
    case 'sub-main': return [[0, sub], [1, main]];
    case 'clear-main': return [[0, clear(main)], [1, main]];
    case 'main-sub-main': return [[0, main], [0.5, sub], [1, main]];
    default: {
      const preset = GRADIENT_PRESETS[kind];
      if (preset) return preset.map((c, i) => [i / (preset.length - 1), c]);
      return [[0, main], [1, sub]];
    }
  }
}

/**
 * How many more lengths of the gradient it takes to cover `area` when it repeats: for a straight gradient the
 * copies `before` its start and `after` its end (from where the area's corners fall along its line); for a
 * circle the copies outwards (`after`), none before. At most MAX_REPEATS copies in all.
 */
export function gradientReach(shape, start, end, area) {
  const dx = end.x - start.x, dy = end.y - start.y, L2 = dx * dx + dy * dy;
  if (!(L2 > 0)) return { before: 0, after: 0 };
  const corners = [[area.x, area.y], [area.x + area.w, area.y], [area.x, area.y + area.h], [area.x + area.w, area.y + area.h]];
  let before = 0, after = 0;
  if (shape === 'radial') {
    const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - start.x, y - start.y)));
    after = Math.max(0, Math.ceil(far / Math.sqrt(L2) - 1e-9) - 1);
  } else {
    const ts = corners.map(([x, y]) => ((x - start.x) * dx + (y - start.y) * dy) / L2);
    before = Math.max(0, Math.ceil(-Math.min(...ts) - 1e-9));
    after = Math.max(0, Math.ceil(Math.max(...ts) - 1 - 1e-9));
  }
  const over = before + after + 1 - MAX_REPEATS;
  if (over > 0) { const cut = Math.ceil(over / 2); before = Math.max(0, before - cut); after = Math.max(0, MAX_REPEATS - 1 - before); }
  return { before, after };
}

/**
 * Colour stops for `reps` copies of `stops` side by side over 0..1. Copy i is the original's copy i - first
 * (first = the copies before the start); mirroring turns every odd one round, so neighbours meet in one colour.
 * edge: how much of 0..1 a pixel is; repeating copies start that much late, so the step between them is smoothed
 * over a pixel instead of drawn as a jagged hard edge.
 */
export function repeatStops(stops, mode, reps, first = 0, edge = 0) {
  const out = [];
  for (let i = 0; i < reps; i++) {
    const j = i - first, rev = mode === 'mirror' && Math.abs(j % 2) === 1;
    (rev ? stops.slice().reverse() : stops).forEach(([o, c], k) => {
      const late = mode === 'repeat' && i > 0 && k === 0 ? Math.min(edge, 0.5 / reps) : 0;
      out.push([Math.min(1, (i + (rev ? 1 - o : o)) / reps + late), c]);
    });
  }
  return out;
}

/**
 * Dithering against banding: every colour channel (and alpha where it is partly see-through) gets a small
 * repeatable random push of under one level either way (triangular noise anchored to the doc at x0, y0), so the
 * steps between neighbouring 8-bit levels break up instead of showing as bands. Empty and solid pixels keep their alpha.
 */
export function ditherData(data, w, h, x0 = 0, y0 = 0) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = data[i + 3];
    if (!a) continue;
    const X = x + x0, Y = y + y0;
    for (let ch = 0; ch < (a < 255 ? 4 : 3); ch++) data[i + ch] = data[i + ch] + noiseAt(X, Y, ch) + noiseAt(X, Y, ch + 4) - 1;
  }
  return data;
}

/** The end point with the angle from start rounded to 15 degree steps (Shift), same length. */
export function snapEnd(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, len = Math.hypot(dx, dy);
  const step = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
}
