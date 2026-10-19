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

// Primed canvas: thread counts per tile (even, so the over-under parity joins up at the tile edge). Warp and weft
// differ a little, as on real linen, so the bumps never line up into a square grid.
export const WARP = 52, WEFT = 46;

/** Smooth 1D value noise along a thread: t in cells, repeating every `period` cells; `row` picks the thread. */
function threadNoise(t, period, row, seed) {
  const k = Math.floor(t), f = smooth(t - k);
  const a = hash01(mod(k, period), row, seed), b = hash01(mod(k + 1, period), row, seed);
  return a + (b - a) * f;
}

/**
 * Height of primed plain-weave canvas at (x, y), about 0.5-2.4 (stretched to 0-255 by textureTile). Warp threads run
 * down, weft threads across, and at each crossing one is on top (the warp where i + j is even). The threads wander
 * a few px (seamless domain warp), each has its own thickness with slubs along it, and the gesso adds a fine tooth
 * of its own, so a stroke shows tooth rather than a grid; the tile repeats every `size` px both ways.
 */
export function canvasWeave(x, y, size = TILE) {
  const wx = x + 6 * (valueNoise(x, y, 64, size / 64, 81) - 0.5) + 3 * (valueNoise(x, y, 16, size / 16, 82) - 0.5);
  const wy = y + 6 * (valueNoise(x, y, 64, size / 64, 83) - 0.5) + 3 * (valueNoise(x, y, 16, size / 16, 84) - 0.5);
  const u = wx * WARP / size, v = wy * WEFT / size;   // in threads
  const i = Math.floor(u), j = Math.floor(v);
  // each crossing shows the thread on top as a soft oval bump, longer along that thread; the bumps of neighbouring
  // crossings (turned the other way) overlap into the gaps beside it, so the deep pits are only where four
  // crossings meet and no groove runs on as a line
  let h = 0;
  for (let cj = j - 1; cj <= j + 1; cj++) {
    for (let ci = i - 1; ci <= i + 1; ci++) {
      const iw = mod(ci, WARP), jw = mod(cj, WEFT), warpOnTop = !((ci + cj) & 1);
      // thickness: per thread, slubs along it (16 per tile), and a little per crossing
      const t = (warpOnTop
        ? 0.85 + 0.15 * hash01(iw, 1, 85) + 0.3 * (threadNoise(wy * 16 / size, 16, iw, 86) - 0.5)
        : 0.85 + 0.15 * hash01(1, jw, 87) + 0.3 * (threadNoise(wx * 16 / size, 16, jw, 88) - 0.5))
        * (0.92 + 0.16 * hash01(iw, jw, 90));
      const du = u - ci - 0.4 - 0.2 * hash01(iw, jw, 91), dv = v - cj - 0.4 - 0.2 * hash01(iw, jw, 92);
      const [along, across] = warpOnTop ? [dv, du] : [du, dv];
      h += t * Math.exp(-along * along / 0.7 - across * across / 0.16);
    }
  }
  // the gesso's own fine tooth on top
  return h + 0.45 * valueNoise(x, y, 2, size / 2, 89) + 0.35 * valueNoise(x, y, 4, size / 4, 93)
    + 0.2 * valueNoise(x, y, 8, size / 8, 94);
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
        v = 0.15 * hash01(x, y, 71) + 0.4 * valueNoise(x, y, 2, size / 2, 72)
          + 0.25 * valueNoise(x, y, 4, size / 4, 74, 2) + 0.2 * valueNoise(x, y, 16, size / 16, 75, 8);
      } else if (id === 'coldpress') {
        // rounded bumps of a few pixels, grooves between them
        v = fbm(x, y, size, [[8, 0.6], [4, 0.25], [32, 0.15]], 23);
      } else if (id === 'canvas') {
        v = canvasWeave(x, y, size);
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
    canvas: t => smooth(Math.min(1, t * 1.15)),  // primed: the tops are flat, the pits narrow
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
