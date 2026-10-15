// Liquify (pure, tested): the Liquify tool bends the picture under the brush. Every dab moves the pixels inside a
// circle, most in the middle and fading to nothing at the edge: Push drags them along with the pen, Pinch pulls
// them towards the middle, Bloat pushes them out and Twirl turns them round it. Works on RGBA bytes (straight
// alpha, as ImageData), sampling bilinearly in premultiplied form so clear pixels never tint their neighbours.

export const LIQUIFY_MODES = [['push', 'Push'], ['pinch', 'Pinch'], ['bloat', 'Bloat'], ['twirl', 'Twirl right'], ['twirl-left', 'Twirl left']];

const PINCH = 0.08;  // share of the distance to the middle one full-strength Pinch/Bloat dab moves the middle by
const TWIRL = 0.12;  // radians one full-strength Twirl dab turns the middle by

/** How strongly a dab moves a pixel at distance `dist` from its middle: 1 in the middle, easing to 0 at radius r. */
export function liquifyFalloff(dist, r) {
  if (dist >= r) return 0;
  const t = 1 - (dist * dist) / (r * r);
  return t * t;
}

/**
 * How far outside the circle a dab reads, so the patch handed to liquifyDab must reach that much further:
 * a push reads back along the movement, a pinch reads further out; bloat and twirl stay inside the circle.
 */
export function liquifyReach(mode, r, strength, dx = 0, dy = 0) {
  if (mode === 'push') return Math.ceil(Math.hypot(dx, dy) * strength) + 2;
  if (mode === 'pinch') return Math.ceil(r * PINCH * strength) + 2;
  return 2;
}

/**
 * One dab on a w x h patch (data, changed in place and returned) with its middle at (cx, cy) in patch pixels:
 * each pixel within radius r takes the colour from where the movement came from. Push moves by (dx, dy) x strength
 * (the pen's step), the others by their share of PINCH / TWIRL x strength.
 */
export function liquifyDab(data, w, h, cx, cy, r, mode, strength, dx = 0, dy = 0) {
  const src = new Float32Array(data.length);  // premultiplied copy to read from
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    src[i] = data[i] * a; src[i + 1] = data[i + 1] * a; src[i + 2] = data[i + 2] * a; src[i + 3] = data[i + 3];
  }
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const out = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - cx, py = y + 0.5 - cy, f = liquifyFalloff(Math.hypot(px, py), r) * strength;
      if (f <= 0) continue;
      let sx, sy;  // where this pixel's new colour comes from, relative to the middle
      if (mode === 'push') { sx = px - dx * f; sy = py - dy * f; }
      else if (mode === 'pinch') { sx = px * (1 + PINCH * f); sy = py * (1 + PINCH * f); }
      else if (mode === 'bloat') { sx = px * (1 - PINCH * f); sy = py * (1 - PINCH * f); }
      else {
        const a = (mode === 'twirl-left' ? 1 : -1) * TWIRL * f, c = Math.cos(a), s = Math.sin(a);
        sx = px * c - py * s; sy = px * s + py * c;
      }
      sample(src, w, h, cx + sx - 0.5, cy + sy - 0.5, out);
      const i = (y * w + x) * 4, k = out[3] > 0 ? 255 / out[3] : 0;
      data[i] = out[0] * k; data[i + 1] = out[1] * k; data[i + 2] = out[2] * k; data[i + 3] = out[3];
    }
  }
  return data;
}

/** Bilinear sample of premultiplied src at pixel position (fx, fy), clamped to the patch, into out. */
function sample(src, w, h, fx, fy, out) {
  fx = Math.max(0, Math.min(w - 1, fx));
  fy = Math.max(0, Math.min(h - 1, fy));
  const xa = Math.floor(fx), ya = Math.floor(fy), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1);
  const tx = fx - xa, ty = fy - ya;
  const a = (ya * w + xa) * 4, b = (ya * w + xb) * 4, c = (yb * w + xa) * 4, d = (yb * w + xb) * 4;
  for (let ch = 0; ch < 4; ch++) {
    out[ch] = (src[a + ch] * (1 - tx) + src[b + ch] * tx) * (1 - ty) + (src[c + ch] * (1 - tx) + src[d + ch] * tx) * ty;
  }
}
