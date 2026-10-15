// Image filters (pure, tested). They work on RGBA bytes as in ImageData.data and change them in place.
// FILTERS lists them for the Filter menu: each has the sliders of its dialog, how far it reaches outside the
// area being filtered (margin, so a blur at a selection's edge sees what is around it), and apply(data, w, h,
// params, x0, y0), x0/y0 being where the data sits in the document (for filters with a grid).

/** A filter dialog's slider: {key, label, min, max, step, value (default), unit}. */
const f = (key, label, min, max, step, value, unit = '') => ({ key, label, min, max, step, value, unit });

export const FILTERS = [
  { id: 'blur', label: 'Gaussian blur…', fields: [f('radius', 'Radius', 0.5, 100, 0.5, 5, ' px')],
    margin: p => Math.ceil(p.radius * 3), apply: (d, w, h, p) => gaussianBlur(d, w, h, p.radius) },
  { id: 'sharpen', label: 'Sharpen…', fields: [f('amount', 'Amount', 1, 500, 1, 100, '%'), f('radius', 'Radius', 0.5, 50, 0.5, 2, ' px')],
    margin: p => Math.ceil(p.radius * 3), apply: (d, w, h, p) => sharpen(d, w, h, p.amount / 100, p.radius) },
  { id: 'mosaic', label: 'Mosaic…', fields: [f('cell', 'Cell size', 2, 200, 1, 8, ' px')],
    margin: () => 0, apply: (d, w, h, p, x0, y0) => mosaic(d, w, h, p.cell, x0, y0) },
  { id: 'motion', label: 'Motion blur…', fields: [f('distance', 'Distance', 1, 200, 1, 20, ' px'), f('angle', 'Angle', 0, 180, 1, 0, '°')],
    margin: p => Math.ceil(p.distance / 2) + 1, apply: (d, w, h, p) => motionBlur(d, w, h, p.distance, p.angle) },
  { id: 'noise', label: 'Add noise…', fields: [f('amount', 'Amount', 1, 100, 1, 20, '%'), f('color', 'Color', 0, 100, 1, 0, '%')],
    margin: () => 0, apply: (d, w, h, p, x0, y0) => addNoise(d, w, h, p.amount, p.color, x0, y0) },
  '-',
  { id: 'balance', label: 'Color balance…', fields: [f('red', 'Cyan – Red', -100, 100, 1, 0), f('green', 'Magenta – Green', -100, 100, 1, 0), f('blue', 'Yellow – Blue', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => colorBalance(d, p.red, p.green, p.blue) },
  { id: 'brightness', label: 'Brightness/Contrast…', fields: [f('brightness', 'Brightness', -100, 100, 1, 0), f('contrast', 'Contrast', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => brightnessContrast(d, p.brightness, p.contrast) },
  { id: 'hsl', label: 'Hue/Saturation/Lightness…', fields: [f('hue', 'Hue', -180, 180, 1, 0, '°'), f('saturation', 'Saturation', -100, 100, 1, 0), f('lightness', 'Lightness', -100, 100, 1, 0)],
    margin: () => 0, apply: (d, w, h, p) => hueSaturation(d, p.hue, p.saturation, p.lightness) },
  { id: 'levels', label: 'Levels…', fields: [f('inLow', 'Input black', 0, 254, 1, 0), f('inHigh', 'Input white', 1, 255, 1, 255), f('gamma', 'Gamma', 0.1, 10, 0.01, 1),
    f('outLow', 'Output black', 0, 255, 1, 0), f('outHigh', 'Output white', 0, 255, 1, 255)],
    margin: () => 0, apply: (d, w, h, p) => levels(d, p) },
  { id: 'posterize', label: 'Posterize…', fields: [f('levels', 'Levels', 2, 32, 1, 4)], margin: () => 0, apply: (d, w, h, p) => posterize(d, p.levels) },
  { id: 'threshold', label: 'Threshold (black and white)…', fields: [f('threshold', 'Threshold', 1, 255, 1, 128)], margin: () => 0, apply: (d, w, h, p) => threshold(d, p.threshold) },
  { id: 'invert', label: 'Invert colors', fields: [], margin: () => 0, apply: d => invert(d) },
];

export const FILTER_BY_ID = Object.fromEntries(FILTERS.filter(x => x !== '-').map(x => [x.id, x]));

/** A filter's default parameters. */
export function defaultParams(filter) {
  return Object.fromEntries(filter.fields.map(x => [x.key, x.value]));
}

/** Keeps each parameter a number within its slider's range (anything else becomes the default). */
export function sanitizeParams(filter, raw) {
  const out = {};
  for (const x of filter.fields) {
    const v = Number(raw?.[x.key]);
    out[x.key] = Number.isFinite(v) ? Math.max(x.min, Math.min(x.max, v)) : x.value;
  }
  return out;
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
    for (let y = 0; y < h; y++) boxLine(plane, tmp, y * w, 1, w, r);
    for (let x = 0; x < w; x++) boxLine(tmp, plane, x, w, h, r);
  }
  return plane;
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
