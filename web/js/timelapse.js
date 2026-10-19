// Timelapse playback plan (pure, tested): which recorded frames a video shows and how long each is held.

/**
 * `count` recorded frames played at `fps`, at most `maxSeconds` long before the ending (frames are then skipped
 * evenly; the first and last are always shown), and the last frame held `endSeconds` on top.
 * Returns {indices, holds} (holds in frame times, as recordWebm takes them).
 */
export function timelapsePlan(count, fps, maxSeconds, endSeconds = 2) {
  if (count <= 0) return { indices: [], holds: [] };
  const room = Math.max(2, Math.round(fps * maxSeconds));
  let indices;
  if (count <= room) indices = Array.from({ length: count }, (_, i) => i);
  else indices = Array.from({ length: room }, (_, i) => Math.round(i * (count - 1) / (room - 1)));
  const holds = indices.map(() => 1);
  holds[holds.length - 1] += Math.max(0, Math.round(fps * endSeconds));
  return { indices, holds };
}

/** Video size: the picture's w x h fitted within `max` px a side, rounded to even numbers (video encoders want them). */
export function videoSize(w, h, max = 1280) {
  const s = Math.min(1, max / Math.max(w, h));
  const even = v => Math.max(2, 2 * Math.round(v * s / 2));
  return { w: even(w), h: even(h) };
}
