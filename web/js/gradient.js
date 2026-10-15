// Gradient tool maths (pure, tested).

import { hexToRgb } from './color.js';

export const GRADIENT_COLORS = [
  ['main-sub', 'Main → sub'], ['main-clear', 'Main → transparent'],
  ['sub-main', 'Sub → main'], ['clear-main', 'Transparent → main'],
];
export const GRADIENT_SHAPES = [['linear', 'Straight'], ['radial', 'Circle']];
export const GRADIENT_REPEATS = [['none', 'Once'], ['repeat', 'Repeat'], ['mirror', 'Mirror']];
const MAX_REPEATS = 1000;

const clear = hex => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},0)`; };

/** Colour stops [[offset, css colour], ...] for a colour setting. Fading to transparent keeps the hue. */
export function gradientStops(kind, main, sub) {
  switch (kind) {
    case 'main-clear': return [[0, main], [1, clear(main)]];
    case 'sub-main': return [[0, sub], [1, main]];
    case 'clear-main': return [[0, clear(main)], [1, main]];
    default: return [[0, main], [1, sub]];
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

/** The end point with the angle from start rounded to 15 degree steps (Shift), same length. */
export function snapEnd(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, len = Math.hypot(dx, dy);
  const step = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
}
