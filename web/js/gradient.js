// Gradient tool maths (pure, tested).

import { hexToRgb } from './color.js';

export const GRADIENT_COLORS = [
  ['main-sub', 'Main → sub'], ['main-clear', 'Main → transparent'],
  ['sub-main', 'Sub → main'], ['clear-main', 'Transparent → main'],
];
export const GRADIENT_SHAPES = [['linear', 'Straight'], ['radial', 'Circle']];

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

/** The end point with the angle from start rounded to 15 degree steps (Shift), same length. */
export function snapEnd(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, len = Math.hypot(dx, dy);
  const step = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
}
