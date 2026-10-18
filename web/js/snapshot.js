// Undo copies of layer pixels (editor.js snapshot): {canvas} while on the GPU, then {data, box} once read into
// memory and cut down to the painted part (box, within the copied rect; null when it was all clear).

import { alphaBounds } from './rect.js';

/** ImageData as a snapshot kept in memory: only its painted part. */
export function trimmedSnapshot(img) {
  const w = img.width, h = img.height, box = alphaBounds(img.data, w, h);
  if (!box) return { canvas: null, data: null, box: null, w, h };
  if (box.w === w && box.h === h) return { canvas: null, data: img, box, w, h };
  const cut = new ImageData(box.w, box.h), row = box.w * 4;
  for (let y = 0; y < box.h; y++) {
    const at = ((box.y + y) * w + box.x) * 4;
    cut.data.set(img.data.subarray(at, at + row), y * row);
  }
  return { canvas: null, data: cut, box, w, h };
}

/** Draws a snapshot with its top left at (x, y), onto pixels already cleared. */
export function drawSnapshot(ctx, s, x, y) {
  if (s.canvas) ctx.drawImage(s.canvas, x, y);
  else if (s.data) ctx.putImageData(s.data, x + s.box.x, y + s.box.y);
}

/** Memory an undo copy holds: ImageData, or a snapshot (still on the GPU, or as kept in memory). */
export function snapBytes(s) {
  if (!s) return 0;
  if (s instanceof ImageData) return s.data.byteLength;
  return s.canvas ? s.w * s.h * 4 : s.data ? s.data.data.byteLength : 0;
}
