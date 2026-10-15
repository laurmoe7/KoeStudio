// Smudge (pure, tested): the Smudge tool drags paint along. It carries a patch of colour (`buf`); at every dab the
// patch is blended into the layer under a round, optionally soft tip, and what is there afterwards is picked up
// as the new patch. Works on RGBA bytes (straight alpha, as ImageData), mixing in premultiplied form so clear
// pixels never tint their neighbours.

/** How much of the tip covers a pixel at distance `dist` from its centre: 1 inside radius × hardness, fading to 0 at the radius. */
export function tipCoverage(dist, radius, hardness) {
  if (dist >= radius) return 0;
  const solid = radius * Math.max(0, Math.min(1, hardness));
  if (dist <= solid) return 1;
  return (radius - dist) / (radius - solid);
}

/**
 * One smudge dab on a d × d patch: dst (the layer under the tip) moves towards buf (the carried colour) by
 * strength × tip coverage; then buf takes the result, so the next dab carries it on. With lockAlpha the layer's
 * transparency stays as it was (only colour moves). Both arrays are changed in place.
 */
export function smudgeDab(dst, buf, d, strength, hardness, lockAlpha = false) {
  const r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const t = strength * tipCoverage(Math.hypot(x + 0.5 - r, y + 0.5 - r), r, hardness);
      if (t <= 0) continue;
      const i = (y * d + x) * 4;
      const da = dst[i + 3] / 255, ba = buf[i + 3] / 255;
      const a = da * (1 - t) + ba * t;
      if (a > 0) {
        for (let c = 0; c < 3; c++) dst[i + c] = (dst[i + c] * da * (1 - t) + buf[i + c] * ba * t) / a;
      }
      if (!lockAlpha) dst[i + 3] = a * 255;
    }
  }
  buf.set(dst);
}
