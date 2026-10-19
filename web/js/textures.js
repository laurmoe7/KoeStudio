// Brush textures (pure, tested): seamless grayscale tiles that give strokes a paper grain. A tile value of 255
// means paint sticks fully, 0 is a groove that paint skips. The texture is fixed to the canvas (not to the brush
// tip), so overlapping strokes share one grain, as with real paper. Applied in doc.js (liveSource).

export const TEXTURES = [
  ['none', 'None'], ['paper', 'Paper'], ['coldpress', 'Watercolor paper'], ['canvas', 'Canvas'],
  ['rough', 'Chalk'], ['noise', 'Noise'],
];
export const TEXTURE_IDS = new Set(TEXTURES.map(t => t[0]));
export const TILE = 256;

/** A 32-bit integer hash of a lattice point, as a number in [0, 1). */
export function hash01(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

/**
 * Smooth value noise in [0, 1) on a lattice of `cell` pixels that repeats every `period` cells, so a tile of
 * cell * period pixels joins up seamlessly with itself. A different `cellY` stretches it (cells cell x cellY,
 * repeating after the same number of pixels down as across).
 */
export function valueNoise(x, y, cell, period, seed = 0, cellY = cell) {
  const u = x / cell, v = y / cellY, periodY = period * cell / cellY;
  const ix = Math.floor(u), iy = Math.floor(v);
  const fx = smooth(u - ix), fy = smooth(v - iy);
  const at = (i, j) => hash01(mod(i, period), mod(j, periodY), seed);
  const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Layered value noise: [cell size, weight] pairs; every cell size must divide `size`. */
function fbm(x, y, size, octaves, seed) {
  let v = 0, w = 0;
  octaves.forEach(([cell, weight], i) => { v += weight * valueNoise(x, y, cell, size / cell, seed + i); w += weight; });
  return v / w;
}

/** Stretches values to fill [0, 1], then applies curve. */
function normalize(vals, curve) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const out = new Uint8ClampedArray(vals.length);
  for (let i = 0; i < vals.length; i++) out[i] = Math.round(255 * Math.max(0, Math.min(1, curve((vals[i] - lo) / span))));
  return out;
}

/** The gray values (size * size, row by row) of a texture, or null for 'none'. Always the same for an id. */
export function textureTile(id, size = TILE) {
  if (!TEXTURE_IDS.has(id) || id === 'none') return null;
  const vals = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v;
      if (id === 'paper') {
        // crisp pits a pixel or two wide in a fine tooth, with faint horizontal fibres: graphite catches the tops
        v = 0.3 * hash01(x, y, 71) + 0.3 * valueNoise(x, y, 2, size / 2, 72)
          + 0.25 * valueNoise(x, y, 4, size / 4, 74, 1) + 0.15 * valueNoise(x, y, 16, size / 16, 75, 4);
      } else if (id === 'coldpress') {
        // rounded bumps of a few pixels, grooves between them
        v = fbm(x, y, size, [[8, 0.6], [4, 0.25], [32, 0.15]], 23);
      } else if (id === 'canvas') {
        // a plain weave: blocks of 8 px alternate between horizontal and vertical threads
        const across = ((x >> 3) + (y >> 3)) & 1;
        const t = ((across ? y : x) % 8 + 0.5) / 8;
        v = 0.75 * Math.sin(Math.PI * t) + 0.25 * valueNoise(x, y, 2, size / 2, 37);
      } else if (id === 'rough') {
        v = fbm(x, y, size, [[16, 0.45], [8, 0.3], [2, 0.25]], 41);
      } else {
        v = 0.7 * hash01(x, y, 53) + 0.3 * valueNoise(x, y, 4, size / 4, 59);
      }
      vals[y * size + x] = v;
    }
  }
  const curve = {
    paper: t => smooth(Math.max(0, Math.min(1, (t - 0.25) * 1.9))),  // mostly tops, sharp-edged pits
    coldpress: t => smooth(Math.min(1, t * 1.15)),
    canvas: t => t,
    rough: t => smooth(Math.max(0, Math.min(1, (t - 0.3) * 2.5))),  // hard-edged chalky patches
    noise: t => t,
  }[id];
  return normalize(vals, curve);
}

/**
 * How much of the paint a texture pixel removes (0-255 alpha for 'destination-out'): a groove (gray 0) removes
 * `amount` of the paint, a tooth top (gray 255) none.
 */
export function grooveAlpha(gray, amount) {
  return Math.round((255 - gray) * Math.max(0, Math.min(1, amount)));
}
