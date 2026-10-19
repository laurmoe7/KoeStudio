// Image filters (pure, tested). They work on RGBA bytes as in ImageData.data and change them in place.
// FILTERS lists them (FILTER_MENU groups them for the Filter menu): each has the sliders of its dialog, how far it reaches outside the
// area being filtered (margin, so a blur at a selection's edge sees what is around it), and apply(data, w, h,
// params, x0, y0, W, H), x0/y0 being where the data sits in the document (for filters with a grid) and W x H the
// document size (for filters with a centre).

import { curveAt, sanitizeCurve } from './brush.js';

/** Filters with `centre: true` have cx / cy sliders (% of the canvas) that a click on the canvas also sets. */

/** A filter dialog's slider: {key, label, min, max, step, value (default), unit}. */
const f = (key, label, min, max, step, value, unit = '') => ({ key, label, min, max, step, value, unit });

export const FILTERS = [
  { id: 'blur', label: 'Gaussian blur…', fields: [f('radius', 'Radius', 0.5, 100, 0.5, 5, ' px')],
    margin: p => Math.ceil(p.radius * 3), apply: (d, w, h, p) => gaussianBlur(d, w, h, p.radius) },
  { id: 'sharpen', label: 'Sharpen…', fields: [f('amount', 'Amount', 1, 500, 1, 100, '%'), f('radius', 'Radius', 0.5, 50, 0.5, 2, ' px')],
    margin: p => Math.ceil(p.radius * 3), apply: (d, w, h, p) => sharpen(d, w, h, p.amount / 100, p.radius) },
  { id: 'median', label: 'Median (reduce noise)…', fields: [f('radius', 'Radius', 1, 10, 1, 1, ' px')],
    note: 'Each pixel takes the middle value of its surroundings: grain and specks go, edges stay sharp.',
    margin: p => p.radius, apply: (d, w, h, p) => median(d, w, h, p.radius) },
  { id: 'mosaic', label: 'Mosaic…', fields: [f('cell', 'Cell size', 2, 200, 1, 8, ' px')],
    margin: () => 0, apply: (d, w, h, p, x0, y0) => mosaic(d, w, h, p.cell, x0, y0) },
  { id: 'motion', label: 'Motion blur…', fields: [f('distance', 'Distance', 1, 200, 1, 20, ' px'), f('angle', 'Angle', 0, 180, 1, 0, '°')],
    margin: p => Math.ceil(p.distance / 2) + 1, apply: (d, w, h, p) => motionBlur(d, w, h, p.distance, p.angle) },
  { id: 'zoom', label: 'Zoom blur…', centre: true, fields: [f('amount', 'Amount', 1, 100, 1, 20, '%'), f('cx', 'Center X', 0, 100, 1, 50, '%'), f('cy', 'Center Y', 0, 100, 1, 50, '%')],
    margin: () => 1e6, apply: (d, w, h, p, x0, y0, W, H) => zoomBlur(d, w, h, p.amount / 100, (p.cx / 100) * (W ?? w) - x0, (p.cy / 100) * (H ?? h) - y0) },
  { id: 'spin', label: 'Spin blur…', centre: true, fields: [f('angle', 'Angle', 1, 90, 1, 10, '°'), f('cx', 'Center X', 0, 100, 1, 50, '%'), f('cy', 'Center Y', 0, 100, 1, 50, '%')],
    margin: () => 1e6, apply: (d, w, h, p, x0, y0, W, H) => spinBlur(d, w, h, p.angle, (p.cx / 100) * (W ?? w) - x0, (p.cy / 100) * (H ?? h) - y0) },
  { id: 'glow', label: 'Glow…', fields: [f('radius', 'Radius', 1, 100, 1, 12, ' px'), f('strength', 'Strength', 1, 200, 1, 80, '%'), f('threshold', 'Brighter than', 0, 254, 1, 160)],
    margin: p => Math.ceil(p.radius * 3), apply: (d, w, h, p) => glow(d, w, h, p.radius, p.strength / 100, p.threshold) },
  { id: 'chroma', label: 'Chromatic aberration…', fields: [f('amount', 'Amount', 1, 50, 1, 6, ' px')],
    margin: p => Math.ceil(p.amount) + 2, apply: (d, w, h, p, x0, y0, W, H) => chromaticAberration(d, w, h, p.amount, (W ?? w) / 2 - x0, (H ?? h) / 2 - y0, Math.hypot(W ?? w, H ?? h) / 2) },
  { id: 'offset', label: 'Offset (wrap around)…', fields: [f('x', 'Right', -100, 100, 1, 50, '%'), f('y', 'Down', -100, 100, 1, 50, '%')],
    note: 'What leaves one edge comes back at the other, so the seams of a pattern move into the middle where you can paint over them.',
    margin: () => 1e6, apply: (d, w, h, p, x0, y0, W, H) => offsetWrap(d, w, h, Math.round((p.x / 100) * (W ?? w)), Math.round((p.y / 100) * (H ?? h))) },
  { id: 'noise', label: 'Add noise…', fields: [f('amount', 'Amount', 1, 100, 1, 20, '%'), f('color', 'Color', 0, 100, 1, 0, '%')],
    margin: () => 0, apply: (d, w, h, p, x0, y0) => addNoise(d, w, h, p.amount, p.color, x0, y0) },
  '-',
  { id: 'balance', label: 'Color balance…', fields: [f('red', 'Cyan – Red', -100, 100, 1, 0), f('green', 'Magenta – Green', -100, 100, 1, 0), f('blue', 'Yellow – Blue', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => colorBalance(d, p.red, p.green, p.blue) },
  { id: 'brightness', label: 'Brightness/Contrast…', fields: [f('brightness', 'Brightness', -100, 100, 1, 0), f('contrast', 'Contrast', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => brightnessContrast(d, p.brightness, p.contrast) },
  { id: 'hsl', label: 'Hue/Saturation/Lightness…', fields: [f('hue', 'Hue', -180, 180, 1, 0, '°'), f('saturation', 'Saturation', -100, 100, 1, 0), f('lightness', 'Lightness', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => hueSaturation(d, p.hue, p.saturation, p.lightness) },
  { id: 'curves', label: 'Curves…', fields: [], curves: true, margin: () => 0, apply: (d, w, h, p) => curves(d, p) },
  { id: 'levels', label: 'Levels…', fields: [f('inLow', 'Input black', 0, 254, 1, 0), f('inHigh', 'Input white', 1, 255, 1, 255), f('gamma', 'Gamma', 0.1, 10, 0.01, 1),
    f('outLow', 'Output black', 0, 255, 1, 0), f('outHigh', 'Output white', 0, 255, 1, 255)],
    margin: () => 0, apply: (d, w, h, p) => levels(d, p) },
  { id: 'posterize', label: 'Posterize…', fields: [f('levels', 'Levels', 2, 32, 1, 4)], margin: () => 0, apply: (d, w, h, p) => posterize(d, p.levels) },
  { id: 'threshold', label: 'Threshold (black and white)…', fields: [f('threshold', 'Threshold', 1, 255, 1, 128)], margin: () => 0, apply: (d, w, h, p) => threshold(d, p.threshold) },
  { id: 'lines', label: 'Extract lines…', fields: [f('radius', 'Line width', 1, 100, 1, 16, ' px'), f('threshold', 'Ignore', 0, 128, 1, 12),
    f('softness', 'Softness', 1, 255, 1, 48), f('color', 'Keep color', 0, 100, 1, 0, '%')],
    margin: p => Math.ceil(p.radius) + 4, apply: (d, w, h, p) => extractLines(d, w, h, p) },
  { id: 'dust', label: 'Dust cleaner…', fields: [f('size', 'Smaller than', 1, 400, 1, 12, ' px')],
    note: 'Removes specks of paint smaller than the size, filling them with what surrounds them (see-through or paper).',
    margin: p => Math.min(p.size, 64) + 2, apply: (d, w, h, p) => removeDust(d, w, h, p.size) },
  { id: 'invert', label: 'Invert colors', fields: [], margin: () => 0, apply: d => invert(d) },
  { id: 'recolor', label: 'Change color to main color', fields: [], mainColor: true, margin: () => 0, apply: (d, w, h, p) => recolor(d, p.color || [0, 0, 0]) },
  { id: 'whitealpha', label: 'Brightness to opacity (white → clear)', fields: [], margin: () => 0, apply: d => whiteToAlpha(d) },
  { id: 'gradmap', label: 'Gradient map…', fields: [f('mix', 'Strength', 0, 100, 1, 100, '%')], gradient: true,
    note: 'Dark parts take the first colour of the Gradient tool’s Colors choice, light parts the last.',
    margin: () => 0, apply: (d, w, h, p) => gradientMap(d, p.stops || [[0, [0, 0, 0, 255]], [1, [255, 255, 255, 255]]], p.mix / 100) },
];

/** The Filter menu: a submenu per group, [name, filter ids]. Every filter is in exactly one group. */
export const FILTER_MENU = [
  ['Blur', ['blur', 'motion', 'zoom', 'spin']],
  ['Sharpen and noise', ['sharpen', 'median', 'noise']],
  ['Color', ['balance', 'brightness', 'hsl', 'curves', 'levels', 'posterize', 'threshold', 'invert', 'recolor', 'gradmap']],
  ['Effects', ['glow', 'chroma', 'mosaic', 'offset']],
  ['Line art', ['lines', 'dust', 'whitealpha']],
];

export const FILTER_BY_ID = Object.fromEntries(FILTERS.filter(x => x !== '-').map(x => [x.id, x]));

/** A filter's default parameters. */
export function defaultParams(filter) {
  if (filter.curves) return Object.fromEntries(CURVE_CHANNELS.map(([k]) => [k, [[0, 0], [1, 1]]]));
  return Object.fromEntries(filter.fields.map(x => [x.key, x.value]));
}

/** Keeps each parameter a number within its slider's range (anything else becomes the default). */
export function sanitizeParams(filter, raw) {
  if (filter.curves) return Object.fromEntries(CURVE_CHANNELS.map(([k]) => [k, sanitizeCurve(raw?.[k]) || [[0, 0], [1, 1]]]));
  const out = {};
  for (const x of filter.fields) {
    const v = Number(raw?.[x.key]);
    out[x.key] = Number.isFinite(v) ? Math.max(x.min, Math.min(x.max, v)) : x.value;
  }
  return out;
}

// ---------- line extraction ----------

/**
 * Keeps only what is darker than its surroundings (lines), as see-through ink: each pixel is compared, over white,
 * with the lightest pixel near it (a square max filter reaching half of `radius` and a bit, so lines up to `radius`
 * px wide still see the paper beside them, then softened slightly). Flat areas, paper and soft shading go clear;
 * a pixel darker by `threshold` starts to show and is solid once `softness` darker still. The ink is black, or
 * the pixel's own colour by `color` %.
 */
export function extractLines(data, w, h, { radius = 6, threshold = 12, softness = 48, color = 0 } = {}) {
  const n = w * h, lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = y * a + 255 * (1 - a);  // as seen over white paper
  }
  const bg = blurPlane(maxFilter(lum, w, h, Math.ceil(radius / 2) + 1), w, h, 2);
  const k = Math.max(0, Math.min(1, color / 100));
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, (bg[i] - lum[i] - threshold) / Math.max(1, softness)));
    for (let c = 0; c < 3; c++) data[i * 4 + c] = data[i * 4 + c] * k;
    data[i * 4 + 3] = Math.round(255 * t);
  }
  return data;
}

/** Square max filter of a w x h plane (each value becomes the largest within r across and down); a new plane. */
export function maxFilter(plane, w, h, r) {
  const tmp = new Float32Array(plane.length), out = new Float32Array(plane.length);
  for (let y = 0; y < h; y++) maxLine(plane, tmp, y * w, 1, w, r);
  for (let x = 0; x < w; x++) maxLine(tmp, out, x, w, h, r);
  return out;
}

/**
 * Running max over a window of i - r .. i + r along one line (van Herk / Gil-Werman: maxima from the left and
 * from the right within blocks of 2r + 1, so it costs the same for any r).
 */
function maxLine(src, dst, start, step, n, r) {
  // padded by r on both sides with -Infinity, so every window is exactly k long and spans at most two blocks
  const k = 2 * r + 1, m = n + 2 * r, left = new Float32Array(m), right = new Float32Array(m);
  const at = j => (j < r || j >= n + r ? -Infinity : src[start + (j - r) * step]);
  for (let j = 0; j < m; j++) left[j] = j % k === 0 ? at(j) : Math.max(left[j - 1], at(j));
  for (let j = m - 1; j >= 0; j--) right[j] = j === m - 1 || (j + 1) % k === 0 ? at(j) : Math.max(right[j + 1], at(j));
  for (let i = 0; i < n; i++) dst[start + i * step] = Math.max(right[i], left[i + 2 * r]);  // window i - r .. i + r, shifted by r
}

// ---------- blur ----------

/**
 * Box sizes (odd) for three successive box blurs that together approximate a Gaussian of the given sigma
 * (Kovesi / Kutskir): pairs of widths wl and wu = wl + 2, m of the first, 3 - m of the second.
 */
export function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
  return out;
}

/**
 * One box blur of radius r along a line of n values: dst[i] = mean of src over i-r..i+r, with the ends of
 * the line repeated past its edges. start is the index of the first value and step the distance between values.
 */
export function boxLine(src, dst, start, step, n, r) {
  const at = i => src[start + Math.min(n - 1, Math.max(0, i)) * step];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += at(i);
  const inv = 1 / (2 * r + 1);
  for (let i = 0; i < n; i++) {
    dst[start + i * step] = sum * inv;
    sum += at(i + r + 1) - at(i - r);
  }
}

/** Blurs one w x h plane of numbers (Float32Array) in place with a Gaussian of the given radius (sigma = radius / 2). */
export function blurPlane(plane, w, h, radius) {
  if (!(radius > 0)) return plane;
  const tmp = new Float32Array(plane.length);
  for (const box of boxesForGauss(radius / 2)) {
    const r = (box - 1) / 2;
    if (r < 1) continue;
    boxRows(plane, tmp, w, h, r);
    boxCols(tmp, plane, w, h, r);
  }
  return plane;
}

/** boxLine along every row (edges repeated), without the per-sample clamping inside the run. */
function boxRows(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1), last = w - 1;
  for (let y = 0, o = 0; y < h; y++, o += w) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[o + (i < 0 ? 0 : i > last ? last : i)];
    for (let x = 0; x < w; x++) {
      dst[o + x] = sum * inv;
      const add = x + r + 1, sub = x - r;
      sum += src[o + (add > last ? last : add)] - src[o + (sub < 0 ? 0 : sub)];
    }
  }
}

/** boxLine down every column (edges repeated), done a whole row at a time with one running sum per column: walking
 *  memory in order is several times faster than stepping down each column. */
function boxCols(src, dst, w, h, r) {
  const inv = 1 / (2 * r + 1), last = h - 1, sum = new Float64Array(w);
  for (let i = -r; i <= r; i++) {
    const o = (i < 0 ? 0 : i > last ? last : i) * w;
    for (let x = 0; x < w; x++) sum[x] += src[o + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w, add = y + r + 1, sub = y - r;
    const ao = (add > last ? last : add) * w, so = (sub < 0 ? 0 : sub) * w;
    for (let x = 0; x < w; x++) {
      dst[o + x] = sum[x] * inv;
      sum[x] += src[ao + x] - src[so + x];
    }
  }
}

/** The four channels as premultiplied float planes, so transparent pixels never bleed their colour into a blur. */
function toPlanes(data) {
  const n = data.length / 4, planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    planes[0][i] = data[i * 4] * a;
    planes[1][i] = data[i * 4 + 1] * a;
    planes[2][i] = data[i * 4 + 2] * a;
    planes[3][i] = data[i * 4 + 3];
  }
  return planes;
}

function fromPlanes(planes, data) {
  const n = data.length / 4;
  for (let i = 0; i < n; i++) {
    const a = planes[3][i];
    const k = a > 0 ? 255 / a : 0;
    data[i * 4] = planes[0][i] * k;
    data[i * 4 + 1] = planes[1][i] * k;
    data[i * 4 + 2] = planes[2][i] * k;
    data[i * 4 + 3] = a;
  }
}

/** Every pixel takes the colour [r, g, b], keeping its alpha (line art in the main colour). */
export function recolor(data, [r, g, b]) {
  for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
  return data;
}

/**
 * White becomes clear and everything else keeps its look over white (GIMP's Color to alpha with white): the alpha
 * is how far the darkest channel is from white, and the colour is what, laid over white with that alpha, gives the
 * pixel back. Scanned pencil lines on paper become lines on a clear layer, shades of gray and colour included.
 */
export function whiteToAlpha(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a0 = data[i + 3] / 255;
    const a = (255 - Math.min(r, g, b)) / 255;
    if (a <= 0) { data[i + 3] = 0; continue; }
    data[i] = 255 - (255 - r) / a; data[i + 1] = 255 - (255 - g) / a; data[i + 2] = 255 - (255 - b) / a;
    data[i + 3] = a * a0 * 255;
  }
  return data;
}

/** Gaussian blur of RGBA pixels (radius in px; sigma = radius / 2). */
export function gaussianBlur(data, w, h, radius) {
  const planes = toPlanes(data);
  for (const p of planes) blurPlane(p, w, h, radius);
  fromPlanes(planes, data);
  return data;
}

/** Unsharp mask: each pixel moves away from its blurred surroundings by amount (1 = 100%). Alpha is kept. */
export function sharpen(data, w, h, amount, radius) {
  const blurred = new Uint8ClampedArray(data);
  gaussianBlur(blurred, w, h, radius);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + amount * (data[i + c] - blurred[i + c]);
  }
  return data;
}

/**
 * Glow: the parts brighter than `threshold` (fading in over the brightness above it) are blurred by radius and laid
 * over the picture in Screen mode at `strength` (1 = as they are), so light spills softly round them, also onto
 * see-through pixels next to them.
 */
export function glow(data, w, h, radius, strength, threshold) {
  const light = new Uint8ClampedArray(data.length), span = Math.max(1, 255 - threshold);
  for (let i = 0; i < data.length; i += 4) {
    const t = Math.max(0, Math.min(1, (luminance(data[i], data[i + 1], data[i + 2]) - threshold) / span));
    light[i] = data[i]; light[i + 1] = data[i + 1]; light[i + 2] = data[i + 2]; light[i + 3] = data[i + 3] * t;
  }
  gaussianBlur(light, w, h, radius);
  for (let i = 0; i < data.length; i += 4) {
    const as = Math.min(1, (light[i + 3] / 255) * strength), ab = data[i + 3] / 255;
    if (!as) continue;
    const ao = as + ab * (1 - as);
    for (let c = 0; c < 3; c++) {
      const cs = light[i + c] / 255, cb = data[i + c] / 255;
      // separable blending: source alone, backdrop alone, and where both are, screen of the two
      const co = cs * as * (1 - ab) + cb * ab * (1 - as) + as * ab * (cs + cb - cs * cb);
      data[i + c] = Math.round((co / ao) * 255);
    }
    data[i + 3] = Math.round(ao * 255);
  }
  return data;
}

/**
 * Chromatic aberration (as a cheap lens): red is pushed outwards from the centre (cx, cy) and blue inwards, by
 * `amount` px at distance `far` from it (the canvas corner) and less nearer the centre; green stays. Each channel
 * comes with its own alpha, so outlines get coloured fringes on both sides.
 */
export function chromaticAberration(data, w, h, amount, cx, cy, far) {
  const src = premultiplied(data), acc = new Float64Array(4), k = amount / Math.max(1, far);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, px = x + 0.5, py = y + 0.5, dx = (px - cx) * k, dy = (py - cy) * k;
      acc.fill(0);
      addSample(src, w, h, px - dx, py - dy, 1, acc);  // red: from nearer the centre, so it lands further out
      const r = acc[0], ar = acc[3];
      acc.fill(0);
      addSample(src, w, h, px + dx, py + dy, 1, acc);
      const b = acc[2], ab = acc[3];
      const g = src[i + 1], ag = src[i + 3];
      const a = Math.max(ar, ag, ab);
      if (!a) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
      data[i] = Math.round(r / a * 255); data[i + 1] = Math.round(g / a * 255); data[i + 2] = Math.round(b / a * 255);
      data[i + 3] = Math.round(a);
    }
  }
  return data;
}

/** Shifts the picture by dx, dy px (right, down), wrapping round: what leaves one edge comes in at the other. */
export function offsetWrap(data, w, h, dx, dy) {
  const src = new Uint32Array(new Uint8ClampedArray(data).buffer), out = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const ox = ((dx % w) + w) % w, oy = ((dy % h) + h) % h;
  for (let y = 0; y < h; y++) {
    const sy = (y - oy + h) % h;
    for (let x = 0; x < w; x++) out[y * w + x] = src[sy * w + ((x - ox + w) % w)];
  }
  return data;
}

/** Averages each cell x cell square (cells are anchored to x0, y0 so they line up with the doc grid). */
export function mosaic(data, w, h, cell, x0 = 0, y0 = 0) {
  cell = Math.max(1, Math.round(cell));
  const startX = -(((x0 % cell) + cell) % cell), startY = -(((y0 % cell) + cell) % cell);
  for (let cy = startY; cy < h; cy += cell) {
    for (let cx = startX; cx < w; cx += cell) {
      const xa = Math.max(0, cx), ya = Math.max(0, cy), xb = Math.min(w, cx + cell), yb = Math.min(h, cy + cell);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * w + x) * 4, al = data[i + 3];
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; n++;
        }
      }
      if (!n) continue;
      const k = a > 0 ? 1 / a : 0;
      const R = r * k, G = g * k, B = b * k, A = a / n;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * w + x) * 4;
          data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = A;
        }
      }
    }
  }
  return data;
}

/**
 * Motion blur: every pixel becomes the mean of a line `distance` px long through it at `angle` degrees
 * (0 = horizontal). The image is walked along parallel pixel lines in that direction (each pixel on exactly one
 * line), and each line gets a running-sum box blur, so the cost does not grow with the distance.
 */
export function motionBlur(data, w, h, distance, angle) {
  const rad = (angle * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const alongX = Math.abs(c) >= Math.abs(s);
  // the line advances one pixel along its main axis per step; a step is 1/|cos| (or 1/|sin|) px long
  const slope = alongX ? s / c : c / s, r = Math.round(((distance - 1) / 2) * Math.abs(alongX ? c : s));
  if (r < 1) return data;
  const planes = toPlanes(data);
  const n = alongX ? w : h, m = alongX ? h : w;  // steps along a line, and the size of the other axis
  const off = new Int32Array(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) { off[i] = Math.round(i * slope); lo = Math.min(lo, off[i]); hi = Math.max(hi, off[i]); }
  const idx = new Int32Array(n), buf = new Float32Array(n), out = new Float32Array(n);
  for (let L = -hi; L < m - lo; L++) {
    let len = 0;
    for (let i = 0; i < n; i++) {
      const j = L + off[i];
      if (j >= 0 && j < m) idx[len++] = alongX ? j * w + i : i * w + j;
    }
    if (len < 2) continue;
    for (const p of planes) {
      for (let k = 0; k < len; k++) buf[k] = p[idx[k]];
      boxLine(buf, out, 0, 1, len, r);
      for (let k = 0; k < len; k++) p[idx[k]] = out[k];
    }
  }
  fromPlanes(planes, data);
  return data;
}

const PASS_SAMPLES = 8;  // samples per pixel per pass of zoom and spin blur

/** RGBA bytes as one interleaved premultiplied float array (4 per pixel). */
function premultiplied(data) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a; out[i + 1] = data[i + 1] * a; out[i + 2] = data[i + 2] * a; out[i + 3] = data[i + 3];
  }
  return out;
}

/** Adds k times the bilinear sample of src at (fx, fy) (pixel-centre coordinates, edges repeated) into acc. */
function addSample(src, w, h, fx, fy, k, acc) {
  fx = fx < 0.5 ? 0 : fx > w - 0.5 ? w - 1 : fx - 0.5;
  fy = fy < 0.5 ? 0 : fy > h - 0.5 ? h - 1 : fy - 0.5;
  const x = Math.floor(fx), y = Math.floor(fy), x1 = x + 1 < w ? x + 1 : x, y1 = y + 1 < h ? y + 1 : y;
  const tx = fx - x, ty = fy - y;
  const w00 = (1 - tx) * (1 - ty) * k, w10 = tx * (1 - ty) * k, w01 = (1 - tx) * ty * k, w11 = tx * ty * k;
  const i00 = (y * w + x) * 4, i10 = (y * w + x1) * 4, i01 = (y1 * w + x) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) acc[c] += src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
}

/**
 * Smears every pixel along a path through it: a straight line towards the centre (cx, cy) over `amount` of its
 * distance from it (zoom), or an arc round it over `amount` radians (spin), centred on the pixel. A pass cuts the
 * streak into m equal parts (one per pixel of length plus one, at most PASS_SAMPLES) and takes a bilinear sample in
 * the middle of each; when m was capped, a further pass 1/m as long fills each part the same way, so 8 x 8 evenly
 * spaced samples cost 16 and long streaks stay smooth. Coordinates are pixel-centre: pixel x is at x + 0.5.
 */
function pathBlur(data, w, h, spin, amount, cx, cy) {
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  let src = premultiplied(data), dst = new Float32Array(src.length);
  const acc = new Float64Array(4);
  for (let pass = 0, a = amount; pass < 4; pass++, a /= PASS_SAMPLES) {
    if (pass > 0 && a * PASS_SAMPLES * far <= PASS_SAMPLES - 1) break;  // no streak of the last pass was capped
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5, py = y + 0.5, dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy) * a, i = (y * w + x) * 4;
        const m = Math.min(PASS_SAMPLES, Math.ceil(len - 1e-9) + 1);
        if (m < 2 || (pass > 0 && len * PASS_SAMPLES <= PASS_SAMPLES - 1)) { for (let c = 0; c < 4; c++) dst[i + c] = src[i + c]; continue; }
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        const k = 1 / m;
        if (spin) {
          const step = a / m, cs = Math.cos(step), sn = Math.sin(step), a0 = (step - a) / 2;
          let ox = dx * Math.cos(a0) - dy * Math.sin(a0), oy = dx * Math.sin(a0) + dy * Math.cos(a0);
          for (let j = 0; j < m; j++) {
            addSample(src, w, h, cx + ox, cy + oy, k, acc);
            const nx = ox * cs - oy * sn; oy = ox * sn + oy * cs; ox = nx;
          }
        } else {
          // from the outer end of the streak inwards, in the middle of each part
          const sx = -dx * a / m, sy = -dy * a / m;
          let qx = px + dx * a / 2 + sx / 2, qy = py + dy * a / 2 + sy / 2;
          for (let j = 0; j < m; j++) { addSample(src, w, h, qx, qy, k, acc); qx += sx; qy += sy; }
        }
        for (let c = 0; c < 4; c++) dst[i + c] = acc[c];
      }
    }
    [src, dst] = [dst, src];
  }
  for (let i = 0; i < data.length; i += 4) {
    const al = src[i + 3], k = al > 0 ? 255 / al : 0;
    data[i] = src[i] * k; data[i + 1] = src[i + 1] * k; data[i + 2] = src[i + 2] * k; data[i + 3] = al;
  }
  return data;
}

/**
 * Zoom blur: every pixel is smeared along the line to the centre (cx, cy, in the data's pixel-centre
 * coordinates), over `amount` (0-1) of its distance from it, half towards and half away from the centre.
 */
export function zoomBlur(data, w, h, amount, cx, cy) {
  return pathBlur(data, w, h, false, amount, cx, cy);
}

/** Spin blur: every pixel is smeared along the circle round (cx, cy) through it, over `angle` degrees. */
export function spinBlur(data, w, h, angle, cx, cy) {
  return pathBlur(data, w, h, true, (angle * Math.PI) / 180, cx, cy);
}

/** A repeatable pseudo-random number 0..1 for a document pixel and channel, so noise stays put while previewing. */
export function noiseAt(x, y, ch) {
  let v = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(ch + 1, 1442695041);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  v ^= v >>> 16;
  return (v >>> 0) / 4294967296;
}

/**
 * Adds grain: amount 0-100 (100 = up to ±128 per channel); colour 0-100 mixes from gray grain (the same change
 * in every channel) to independent grain per channel. Anchored to the doc at x0, y0. Alpha is kept.
 */
export function addNoise(data, w, h, amount, color = 0, x0 = 0, y0 = 0) {
  const k = (Math.max(0, Math.min(100, amount)) / 100) * 256, mix = Math.max(0, Math.min(100, color)) / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!data[i + 3]) continue;
      const dx = x + x0, dy = y + y0, gray = noiseAt(dx, dy, 3) - 0.5;
      for (let c = 0; c < 3; c++) data[i + c] += k * (gray * (1 - mix) + (noiseAt(dx, dy, c) - 0.5) * mix);
    }
  }
  return data;
}

// ---------- tone corrections ----------

/**
 * Colour balance for one channel: shift -100..100 pushes the midtones towards the colour (positive) or its
 * opposite (negative), up to ±64 at mid gray; black and white stay as they are.
 */
export function balanceLut(shift) {
  const lut = new Uint8ClampedArray(256), k = (Math.max(-100, Math.min(100, shift)) / 100) * 64;
  for (let v = 0; v < 256; v++) { const t = v / 255; lut[v] = Math.round(v + k * 4 * t * (1 - t)); }
  return lut;
}

/** Colour balance: cyan–red, magenta–green and yellow–blue, each -100..100. */
export function colorBalance(data, red, green, blue) {
  const luts = [balanceLut(red), balanceLut(green), balanceLut(blue)];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = luts[0][data[i]]; data[i + 1] = luts[1][data[i + 1]]; data[i + 2] = luts[2][data[i + 2]];
  }
  return data;
}

/** The channels Curves can change: the RGB curve applies to all three, after each one's own curve. */
export const CURVE_CHANNELS = [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];

/** A 256-entry table from a curve of [x, y] points in 0-1 (see curveAt: smooth, never overshooting). */
export function curvesLut(points) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(curveAt(points, v / 255) * 255);
  return lut;
}

/** Curves: each channel through its own curve, then all three through the RGB curve. */
export function curves(data, p) {
  const all = curvesLut(p.rgb), luts = [p.r, p.g, p.b].map(c => {
    const own = curvesLut(c), out = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) out[v] = all[own[v]];
    return out;
  });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = luts[0][data[i]]; data[i + 1] = luts[1][data[i + 1]]; data[i + 2] = luts[2][data[i + 2]];
  }
  return data;
}

/** Applies a 256-entry lookup table to the colour channels. */
export function applyLut(data, lut) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]; data[i + 1] = lut[data[i + 1]]; data[i + 2] = lut[data[i + 2]];
  }
  return data;
}

/** Brightness -100..100 (added, 100 = +255), then contrast -100..100 about mid gray (-100 = flat, 100 = near black-and-white). */
export function brightnessContrastLut(brightness, contrast) {
  const c = Math.max(-100, Math.min(100, contrast)) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round((v + brightness * 2.55 - 128) * factor + 128);
  return lut;
}

export function brightnessContrast(data, brightness, contrast) {
  return applyLut(data, brightnessContrastLut(brightness, contrast));
}

/** Levels: input black/white points stretch the range, gamma bends the middle, output black/white squeeze it. */
export function levelsLut({ inLow = 0, inHigh = 255, gamma = 1, outLow = 0, outHigh = 255 }) {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, inHigh - inLow), g = 1 / Math.max(0.01, gamma);
  for (let v = 0; v < 256; v++) {
    const t = Math.pow(Math.max(0, Math.min(1, (v - inLow) / span)), g);
    lut[v] = Math.round(outLow + t * (outHigh - outLow));
  }
  return lut;
}

export function levels(data, params) {
  return applyLut(data, levelsLut(params));
}

/** Posterize: each channel snaps to one of `levels` evenly spaced values (2..256). */
export function posterizeLut(levels) {
  levels = Math.max(2, Math.min(256, Math.round(levels)));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.floor((v * levels) / 256) * (255 / (levels - 1)));
  return lut;
}

export function posterize(data, levels) {
  return applyLut(data, posterizeLut(levels));
}

export function invert(data) {
  for (let i = 0; i < data.length; i += 4) { data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2]; }
  return data;
}

/**
 * Median filter: every channel (premultiplied, so clear pixels add no colour) takes the median of the
 * (2r+1)² square round it, cut off at the edges. A running histogram per row keeps it to O(r) per pixel.
 */
export function median(data, w, h, r) {
  const n = w * h, planes = [0, 1, 2, 3].map(() => new Uint8Array(n));
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = data[o + 3];
    planes[0][i] = Math.round(data[o] * a / 255); planes[1][i] = Math.round(data[o + 1] * a / 255);
    planes[2][i] = Math.round(data[o + 2] * a / 255); planes[3][i] = a;
  }
  const out = planes.map(() => new Uint8Array(n)), hist = new Int32Array(256);
  for (let c = 0; c < 4; c++) {
    const src = planes[c], dst = out[c];
    let flat = true;  // a channel of one value throughout (alpha of an opaque layer) stays as it is
    for (let i = 1; i < n && flat; i++) flat = src[i] === src[0];
    if (flat) { dst.set(src); continue; }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r), rows = y1 - y0 + 1;
      hist.fill(0);
      let count = 0;
      for (let x = 0; x <= Math.min(w - 1, r); x++) { for (let yy = y0; yy <= y1; yy++) hist[src[yy * w + x]]++; count += rows; }
      let med = 0, lt = 0;  // lt = how many values are below med
      for (let x = 0; x < w; x++) {
        if (x > 0) {
          const xo = x - r - 1, xi = x + r;
          if (xo >= 0) {
            for (let k = y0 * w + xo, end = y1 * w + xo; k <= end; k += w) { const v = src[k]; hist[v]--; if (v < med) lt--; }
            count -= rows;
          }
          if (xi < w) {
            for (let k = y0 * w + xi, end = y1 * w + xi; k <= end; k += w) { const v = src[k]; hist[v]++; if (v < med) lt++; }
            count += rows;
          }
        }
        const half = count >> 1;  // the median is the smallest m with more than half the values at most m
        while (lt > half) { med--; lt -= hist[med]; }
        while (lt + hist[med] <= half) { lt += hist[med]; med++; }
        dst[y * w + x] = med;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = out[3][i];
    data[o + 3] = a;
    if (a) { data[o] = Math.min(255, Math.round(out[0][i] * 255 / a)); data[o + 1] = Math.min(255, Math.round(out[1][i] * 255 / a)); data[o + 2] = Math.min(255, Math.round(out[2][i] * 255 / a)); }
  }
  return data;
}

/**
 * Dust cleaner: every 8-connected speck of paint (alpha > 32 and not near white) with fewer than `size` pixels,
 * plus its faint one-pixel edge, takes the average of the pixels round it (premultiplied, so a speck on clear
 * paint becomes clear and one on white paper white). Specks touching the data's edge are kept (they may go on).
 */
export function removeDust(data, w, h, size) {
  const n = w * h, paint = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    paint[i] = data[o + 3] > 32 && luminance(data[o], data[o + 1], data[o + 2]) < 230 ? 1 : 0;
  }
  const seen = new Uint8Array(n), stack = new Int32Array(n), mark = new Int32Array(n).fill(-1);
  let comp = [];
  for (let start = 0; start < n; start++) {
    if (!paint[start] || seen[start]) continue;
    // flood the speck, giving up once it is big enough to keep
    comp.length = 0;
    let sp = 0, edge = false, big = false;
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      if (!big) { comp.push(i); if (comp.length >= size) big = true; }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (paint[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
      }
    }
    if (big || edge) continue;
    // the speck and its faint edge are cleared; the ring of pixels just outside that gives the colour
    const clear = comp.slice(), id = start;
    for (const i of comp) mark[i] = id;
    for (const i of comp) {
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || mark[j] === id) continue;
        if (data[j * 4 + 3] > 0 && !paint[j] && luminance(data[j * 4], data[j * 4 + 1], data[j * 4 + 2]) < 230) { mark[j] = id; clear.push(j); }
      }
    }
    let r = 0, g = 0, b = 0, a = 0, cnt = 0;
    for (const i of clear) {
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || mark[j] === id || mark[j] === -2 - id) continue;
        mark[j] = -2 - id;
        const o = j * 4, al = data[o + 3];
        r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al; a += al; cnt++;
      }
    }
    const A = cnt ? a / cnt : 0, R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0;
    for (const i of clear) { const o = i * 4; data[o] = R; data[o + 1] = G; data[o + 2] = B; data[o + 3] = A; }
  }
  return data;
}

export const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Black and white: pixels at least as bright as t become white, the rest black. Alpha is kept. */
export function threshold(data, t) {
  for (let i = 0; i < data.length; i += 4) {
    const v = luminance(data[i], data[i + 1], data[i + 2]) >= t ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return data;
}

/** r, g, b 0-255 to [h 0-360, s 0-1, l 0-1]. */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Hue shift in degrees; saturation and lightness -100..100: negative scales towards gray / black,
 * positive moves the rest of the way towards full saturation / white.
 */
export function hueSaturation(data, hue, saturation, lightness) {
  const sat = Math.max(-100, Math.min(100, saturation)) / 100, lig = Math.max(-100, Math.min(100, lightness)) / 100;
  for (let i = 0; i < data.length; i += 4) {
    let [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    h += hue;
    s = sat < 0 ? s * (1 + sat) : s + (1 - s) * sat;
    l = lig < 0 ? l * (1 + lig) : l + (1 - l) * lig;
    const [r, g, b] = hslToRgb(h, s, l);
    data[i] = Math.round(r); data[i + 1] = Math.round(g); data[i + 2] = Math.round(b);
  }
  return data;
}

// ---------- combining with a selection ----------

/**
 * Mixes a filtered copy back over the original by a mask (0-255 per pixel, as a selection's alpha): where the
 * mask is 0 the original stays, where it is 255 the filtered pixel wins, between them they blend. In place in orig.
 */
export function mixByMask(orig, filtered, mask) {
  for (let i = 0, p = 0; i < orig.length; i += 4, p++) {
    const m = mask[p];
    if (m === 0) continue;
    if (m === 255) { orig[i] = filtered[i]; orig[i + 1] = filtered[i + 1]; orig[i + 2] = filtered[i + 2]; orig[i + 3] = filtered[i + 3]; continue; }
    const t = m / 255;
    for (let c = 0; c < 4; c++) orig[i + c] = orig[i + c] + (filtered[i + c] - orig[i + c]) * t;
  }
  return orig;
}

/** A CSS colour as used in gradient stops ('#rrggbb' or 'rgba(r,g,b,a)') to [r, g, b, a] (0-255). */
export function parseStopColor(css) {
  const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return [r, g, b, Math.round(a * 255)];
  }
  const hex = css.replace('#', '');
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) || 0).concat(255);
}

/**
 * Gradient map: each pixel's lightness (0-255) picks a colour along stops [[offset 0-1, [r, g, b, a]], ...]
 * (dark = offset 0). A stop's alpha thins the pixel out. mix (0-1) blends the result over the original.
 */
export function gradientMap(data, stops, mix = 1) {
  const lut = new Float32Array(256 * 4);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [o0, c0] = stops[k], [o1, c1] = stops[Math.min(k + 1, stops.length - 1)];
    const f = o1 > o0 ? Math.min(1, Math.max(0, (t - o0) / (o1 - o0))) : 0;
    for (let c = 0; c < 4; c++) lut[v * 4 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(luminance(data[i], data[i + 1], data[i + 2])) * 4;
    for (let c = 0; c < 3; c++) data[i + c] += (lut[v + c] - data[i + c]) * mix;
    data[i + 3] += (data[i + 3] * lut[v + 3] / 255 - data[i + 3]) * mix;
  }
  return data;
}
