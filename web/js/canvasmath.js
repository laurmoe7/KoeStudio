// Canvas size, image size and crop maths (pure, tested).

import { MAX_SIDE } from './doc.js';

/** The nine anchor positions of the Canvas size dialog, as [column, row] from 0 (left/top) to 2 (right/bottom). */
export const ANCHORS = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

/**
 * Where the old image lands on a new canvas of newW x newH, kept at the anchor: e.g. 'c' centres it,
 * 'nw' keeps the top-left corner. Rounded down, so odd differences put the extra pixel right/bottom.
 */
export function anchorOffset(oldW, oldH, newW, newH, anchor = 'c') {
  const i = Math.max(0, ANCHORS.indexOf(anchor));
  const col = i % 3, row = Math.floor(i / 3);
  return { dx: Math.floor((newW - oldW) * col / 2), dy: Math.floor((newH - oldH) * row / 2) };
}

/** A side length the program accepts: a whole number from 1 to MAX_SIDE, or null. */
export function validSide(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= MAX_SIDE ? v : null;
}

/** The other side when one is changed with proportions kept (at least 1 px). */
export function keepRatio(oldA, oldB, newA) {
  return Math.max(1, Math.round(oldB * newA / oldA));
}

/** Canvas size after turning it: a quarter turn swaps width and height. */
export function rotatedSize(w, h, quarterTurns) {
  return ((quarterTurns % 2) + 2) % 2 ? { w: h, h: w } : { w, h };
}

/** Normalised whole-pixel rectangle through two corners, clipped to the canvas; null if under 1 px. */
export function cropRect(a, b, w, h) {
  const x0 = Math.max(0, Math.round(Math.min(a.x, b.x))), y0 = Math.max(0, Math.round(Math.min(a.y, b.y)));
  const x1 = Math.min(w, Math.round(Math.max(a.x, b.x))), y1 = Math.min(h, Math.round(Math.max(a.y, b.y)));
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
