// Undo copies of layer pixels (editor.js snapshot): {canvas} while on the GPU, then {data, box} once read into
// memory and cut down to the painted part (box, within the copied rect; null when it was all clear).

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
