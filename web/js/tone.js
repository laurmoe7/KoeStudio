// Screentone (pure, tested): a layer with `tone` set is shown as halftone dots, as with Clip Studio Paint's tone
// layers. How dark and opaque each pixel is gives the tone's density there (black = 100%, a 30% gray = 70%,
// transparent or white = none); the dots are drawn in the tone colour. The dot grid is fixed to the canvas.
//
// Each shape has a "spot function" giving a raw value per position in a cell. Raw values are equalized through a
// lookup table into thresholds T in [0, 1] whose share of the cell below t is t, so a density d covers d of the
// area. Pixels are anti-aliased from how fast T changes there.

export const TONE_SHAPES = [['dot', 'Dots'], ['line', 'Lines'], ['square', 'Squares'], ['diamond', 'Diamonds'], ['noise', 'Noise']];
const SHAPE_IDS = new Set(TONE_SHAPES.map(s => s[0]));
export const TONE_CELL = [2, 100];

export const defaultTone = () => ({ cell: 8, angle: 45, shape: 'dot', color: '#000000' });

/**
 * A valid tone description from anything, or null for none. `x`, `y` (optional, px, kept only when not 0) shift the
 * dot grid, so two tone layers of the same spacing can sit between each other's dots (or line up).
 */
export function sanitizeTone(t) {
  if (!t || typeof t !== 'object') return null;
  const d = defaultTone();
  const num = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, +v)) : def);
  const out = {
    cell: Math.round(num(t.cell, TONE_CELL[0], TONE_CELL[1], d.cell) * 10) / 10,
    angle: Math.round(num(t.angle, -90, 90, d.angle)),
    shape: SHAPE_IDS.has(t.shape) ? t.shape : d.shape,
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toLowerCase() : d.color,
  };
  for (const k of ['x', 'y']) {
    const v = Math.round(num(t[k], -TONE_CELL[1], TONE_CELL[1], 0) * 10) / 10;
    if (v) out[k] = v;
  }
  return out;
}

/** Lines per inch of a tone with this spacing (px) printed at dpi, and the spacing giving lpi lines per inch. */
export const toneLpi = (cell, dpi) => dpi / cell;
export const cellForLpi = (lpi, dpi) => Math.round(Math.max(TONE_CELL[0], Math.min(TONE_CELL[1], dpi / Math.max(1, +lpi || 1))) * 10) / 10;

/** Common screentone rulings (lines per inch) for printed comics. */
export const LPI_PRESETS = [42.5, 50, 55, 60, 65, 70, 75, 80, 85];

/** Tone density of a pixel: how dark it is times how opaque, in [0, 1]. */
export function toneDensity(r, g, b, a) {
  return (a / 255) * (1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255);
}

/** Gray (0-255) that gives density d when painted fully opaque. */
export const densityGray = d => Math.round(255 * (1 - Math.max(0, Math.min(1, d))));

// Spot functions, on cell coordinates fx, fy in [-0.5, 0.5): raw value, its largest value, and |gradient|.
const SPOTS = {
  dot: { max: 0.5, raw: (x, y) => x * x + y * y, grad: (x, y) => 2 * Math.hypot(x, y) },
  line: { max: 0.5, raw: (x, y) => Math.abs(y), grad: () => 1 },
  square: { max: 0.5, raw: (x, y) => Math.max(Math.abs(x), Math.abs(y)), grad: () => 1 },
  diamond: { max: 1, raw: (x, y) => Math.abs(x) + Math.abs(y), grad: () => Math.SQRT2 },
};

const BINS = 2048, SAMPLES = 512, SLOPE_BINS = 24;
const luts = {};

/** Equalizing table for a shape: T[bin] = share of the cell with a raw value at most bin's, and dT/draw. */
function lutFor(shape) {
  if (luts[shape]) return luts[shape];
  const spot = SPOTS[shape];
  const raws = new Float64Array(SAMPLES * SAMPLES);
  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) raws[j * SAMPLES + i] = spot.raw((i + 0.5) / SAMPLES - 0.5, (j + 0.5) / SAMPLES - 0.5);
  }
  raws.sort();
  const T = new Float32Array(BINS), dT = new Float32Array(BINS), step = spot.max / (BINS - 1);
  for (let b = 0, k = 0; b < BINS; b++) {
    const lim = b * step;
    while (k < raws.length && raws[k] <= lim) k++;
    T[b] = k / raws.length;
  }
  for (let b = 0; b < BINS; b++) {
    const lo = Math.max(0, b - SLOPE_BINS), hi = Math.min(BINS - 1, b + SLOPE_BINS);
    dT[b] = (T[hi] - T[lo]) / ((hi - lo) * step);
  }
  return (luts[shape] = { T, dT, scale: (BINS - 1) / spot.max });
}

/**
 * Turns RGBA pixels (w x h, whose top-left is doc pixel ox, oy) into tone dots in place: each pixel's density
 * decides how much of it the dots cover; covered pixels get the tone colour.
 */
export function applyTone(data, w, h, ox, oy, tone) {
  const t = sanitizeTone(tone);
  const n = parseInt(t.color.slice(1), 16), cr = n >> 16 & 255, cg = n >> 8 & 255, cb = n & 255;
  const noise = t.shape === 'noise';
  const grain = Math.max(1, Math.round(t.cell / 6));
  const sx = t.x || 0, sy = t.y || 0;  // the grid's shift
  const spot = SPOTS[t.shape], lut = noise ? null : lutFor(t.shape);
  const a = t.angle * Math.PI / 180, cos = Math.cos(a) / t.cell, sin = Math.sin(a) / t.cell;
  for (let y = 0; y < h; y++) {
    const Y = oy + y + 0.5 - sy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = toneDensity(data[i], data[i + 1], data[i + 2], data[i + 3]);
      let cover;
      if (d <= 0.001) cover = 0;
      else if (d >= 0.999) cover = 1;
      else if (noise) {
        cover = d > hash(Math.floor((ox + x - sx) / grain), Math.floor((oy + y - sy) / grain)) ? 1 : 0;
      } else {
        const X = ox + x + 0.5 - sx;
        const u = X * cos + Y * sin, v = Y * cos - X * sin;
        const fx = u - Math.floor(u) - 0.5, fy = v - Math.floor(v) - 0.5;
        const bin = Math.min(BINS - 1, Math.round(spot.raw(fx, fy) * lut.scale));
        const slope = lut.dT[bin] * spot.grad(fx, fy) / t.cell;  // change of T per pixel
        const diff = d - lut.T[bin];
        cover = slope < 1e-6 ? (diff > 0 ? 1 : 0) : Math.max(0, Math.min(1, diff / slope + 0.5));
      }
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb;
      data[i + 3] = Math.round(cover * 255);
    }
  }
  return data;
}

function hash(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
