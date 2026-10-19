// Wet mixing (pure, tested): a brush whose paint mixes with the colour already on the layer, as wet paint does
// (Clip Studio Paint's colour mixing, Procreate's wet mix, Photoshop's mixer brush, Krita's colour smudge). Each dab
// samples the layer under it (as it was at pen-down). The colour under the dab goes on the brush at once, and the
// colour picked up before is dragged along the stroke where there is less under it:
//   picked = colour under the dab over (picked at the last dab, faded by keep)
//   paint  = lerp(brush colour, picked, mix * how much of it there is)
// mix (Color mixing, 0-1) is the share of the canvas colour in the paint, and stretch (Color stretch, 0-1) how much
// of the picked-up colour is still on the brush one brush width further on, so it smears along the stroke. keep is
// worked out per distance, not per dab, so the spacing does not change the look. Clear pixels give no colour: a
// stroke that leaves the paint behind goes back to the brush colour.

/** The share left after travelling d px with a per-brush-width share `per` (dabs of size px apart). */
export function perDistance(per, d, size) {
  if (per <= 0) return 0;
  if (per >= 1) return 1;
  return Math.pow(per, Math.max(0, d) / Math.max(1, size));
}

/**
 * The average colour under a dab of diameter `size` at (x, y): {r, g, b} (0-255, straight) and `cover` (0-1, the
 * average alpha), from px(x, y) giving [r, g, b, a] of a pixel (straight alpha). Up to 9 x 9 points inside the round
 * dab are sampled, so big brushes cost the same as small ones. Colours are weighted by their alpha.
 */
export function averageUnder(px, x, y, size) {
  const r = Math.max(0.5, size / 2), n = Math.min(9, Math.max(1, Math.round(r))), step = (2 * r) / n;
  let sr = 0, sg = 0, sb = 0, sa = 0, count = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ox = -r + (i + 0.5) * step, oy = -r + (j + 0.5) * step;
      if (ox * ox + oy * oy > r * r) continue;
      const p = px(Math.floor(x + ox), Math.floor(y + oy));
      const a = p[3] / 255;
      sr += p[0] * a; sg += p[1] * a; sb += p[2] * a; sa += a; count++;
    }
  }
  if (!count) { const p = px(Math.floor(x), Math.floor(y)); return { r: p[0], g: p[1], b: p[2], cover: p[3] / 255 }; }
  return sa > 0 ? { r: sr / sa, g: sg / sa, b: sb / sa, cover: sa / count } : { r: 0, g: 0, b: 0, cover: 0 };
}

/** The paint of one stroke (or one symmetric copy of it): mix and stretch 0-1. */
export class WetPaint {
  constructor(mix, stretch) {
    this.mix = Math.max(0, Math.min(1, mix));
    this.stretch = Math.max(0, Math.min(1, stretch));
    this.picked = null;  // {r, g, b, cover}: the canvas colour on the brush after the last dab
    this.at = null;
  }

  /** The colour {r, g, b} of a dab of diameter size at (x, y) in brush colour {r, g, b}, over `under` (averageUnder). */
  next(x, y, size, under, brush) {
    const d = this.at ? Math.hypot(x - this.at.x, y - this.at.y) : 0;
    this.at = { x, y };
    const p = this.picked, wp = p ? p.cover * perDistance(this.stretch, d, size) : 0, wu = under.cover;
    // what is under the dab is picked up at once (wet paint sticks to the brush where it touches); the trail of what
    // was picked up before only shows through where there is less under it. The trail's strength sets the cover,
    // or what is under, whichever is more, so passing over the same colour again and again never builds up.
    const cover = Math.max(wu, wp), w = wu + wp * (1 - wu);
    if (w <= 0) this.picked = { r: 0, g: 0, b: 0, cover: 0 };
    else {  // weighted by how much colour each holds, so clear pixels do not pull towards black
      const tp = wp * (1 - wu);
      this.picked = { r: ((p ? p.r : 0) * tp + under.r * wu) / w, g: ((p ? p.g : 0) * tp + under.g * wu) / w,
        b: ((p ? p.b : 0) * tp + under.b * wu) / w, cover };
    }
    return mixRgb(brush, this.picked, this.mix * this.picked.cover);
  }
}

/**
 * How strong a dab of a mixing brush is, as a share of its density: its own paint (load, Paint load 0-1) plus the
 * picked-up colour where the canvas had some (cover 0-1). At load 1 every dab is full; a blender with a low load
 * moves the colours already there and leaves little on bare paper.
 */
export function loadShare(load, cover) {
  const l = Math.max(0, Math.min(1, load ?? 1)), c = Math.max(0, Math.min(1, cover || 0));
  return l + (1 - l) * c;
}

/** a + (b - a) t for colours {r, g, b}. */
export function mixRgb(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** '#rrggbb' of a colour {r, g, b}. */
export function rgbHex(c) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}
