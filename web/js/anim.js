// Frame-by-frame animation (pure, tested), as Procreate's Animation Assist: while doc.anim.on, every visible
// top-level layer or folder is one frame, bottom first. Optionally the bottom one is a background and the top one
// a foreground, shown on every frame. The editor shows the current frame (the one holding the selected layer) with
// faint copies of its neighbours (onion skins); exports and thumbnails show the current frame alone.

export const FPS_MIN = 1, FPS_MAX = 60, ONION_MAX = 5;
/** Onion skin colours: frames before the current one, and after it (as Clip Studio Paint: blue, then green). */
export const ONION_COLORS = { before: '#3e8fe0', after: '#46a758' };

export const defaultAnim = () => ({ on: false, fps: 8, loop: true, onion: true, before: 1, after: 1, onionOpacity: 0.3, bg: false, fg: false });

/** Animation settings as saved: every field in range, defaults for the rest. */
export function sanitizeAnim(raw) {
  const d = defaultAnim(), a = raw && typeof raw === 'object' ? raw : {};
  const int = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(+v))) : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  return {
    on: bool(a.on, d.on),
    fps: int(a.fps, FPS_MIN, FPS_MAX, d.fps),
    loop: bool(a.loop, d.loop),
    onion: bool(a.onion, d.onion),
    before: int(a.before, 0, ONION_MAX, d.before),
    after: int(a.after, 0, ONION_MAX, d.after),
    onionOpacity: Number.isFinite(+a.onionOpacity) && a.onionOpacity !== null ? Math.max(0.05, Math.min(1, +a.onionOpacity)) : d.onionOpacity,
    bg: bool(a.bg, d.bg),
    fg: bool(a.fg, d.fg),
  };
}

/**
 * The frames of an animation from the root's children (bottom first): {frames, bg, fg}. Hidden nodes are left
 * out; the background and foreground are taken only when there would still be a frame left.
 */
export function animFrames(children, anim) {
  const shown = children.filter(n => n.visible);
  let lo = 0, hi = shown.length;
  const bg = anim.bg && hi - lo > 1 ? shown[lo++] : null;
  const fg = anim.fg && hi - lo > 1 ? shown[--hi] : null;
  return { frames: shown.slice(lo, hi), bg, fg };
}

/** The top-level node (frame) a node belongs to: itself, or its outermost folder below the root. */
export function frameOf(node) {
  let n = node;
  while (n && n.parent && n.parent.parent) n = n.parent;
  return n;
}

/**
 * The onion skins round frame `index` of `count`: [{index, side: 'before' | 'after', alpha}], nearest first on
 * each side; further frames fade (the k-th of n at (n - k + 1) / n of the opacity). With loop, the skins wrap round
 * the ends, as the playback does, but never show the current frame itself.
 */
export function onionSkins(index, count, anim) {
  const out = [];
  if (!anim.onion || count < 2) return out;
  for (const [side, n, dir] of [['before', anim.before, -1], ['after', anim.after, 1]]) {
    for (let k = 1; k <= n; k++) {
      let i = index + dir * k;
      if (anim.loop) i = ((i % count) + count) % count;
      if (i < 0 || i >= count || i === index) break;
      if (out.some(o => o.index === i)) break;  // a short loop: the other side already shows it
      out.push({ index: i, side, alpha: anim.onionOpacity * (n - k + 1) / n });
    }
  }
  return out;
}

/**
 * How long each of n frames stays up in a GIF, in hundredths of a second: GIF delays are whole numbers, so the
 * rounding is carried from frame to frame and the total stays right (12 fps: 8, 9, 8, 8, 9, 8 ...).
 */
export function frameDelays(fps, n) {
  const out = [], step = 100 / Math.max(FPS_MIN, Math.min(FPS_MAX, fps));
  let t = 0, done = 0;
  for (let i = 0; i < n; i++) {
    t += step;
    const d = Math.max(2, Math.round(t) - done);  // browsers play delays under 2 as 10
    out.push(d);
    done += d;
  }
  return out;
}

/** The next frame when playing: wraps with loop, else stays on the last one (null = the end). */
export function nextFrame(index, count, loop) {
  if (count < 1) return null;
  if (index + 1 < count) return index + 1;
  return loop ? 0 : null;
}
