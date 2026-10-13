// Double-tap detection (pure, tested), for places where the browser's own dblclick event never arrives
// (the layer list rebuilds its rows on pointer-up, which removes the element that was pressed).

export const DOUBLE_TAP_MS = 400;

/** True when a tap on `key` at time `now` follows a tap `prev` ({key, time}) on the same thing within `ms`. */
export function isDoubleTap(prev, key, now, ms = DOUBLE_TAP_MS) {
  return !!prev && prev.key === key && now - prev.time >= 0 && now - prev.time <= ms;
}
