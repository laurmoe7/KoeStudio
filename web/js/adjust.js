// Correction layers (as in Clip Studio Paint): a layer whose `adjust` = {type, params} changes the colours of
// everything below it instead of having pixels of its own. The colour change runs on the GPU as an SVG filter
// (feColorMatrix / feComponentTransfer) set as the canvas's `filter` while the backdrop is copied through it, so
// it costs no pixel reads. adjustSpec (pure, tested) turns a correction into filter steps; adjustFilter builds the
// SVG element for it once and returns the `url(#id)` to use.

import { FILTER_BY_ID, defaultParams, sanitizeParams, brightnessContrastLut, levelsLut, posterizeLut, balanceLut, curvesLut } from './filters.js';

/** The corrections a correction layer can be, by filter id (filters.js gives their sliders), in menu order. */
export const ADJUSTMENTS = [
  ['brightness', 'Brightness/Contrast'], ['levels', 'Levels'], ['curves', 'Curves'], ['hsl', 'Hue/Saturation/Lightness'],
  ['balance', 'Color balance'], ['posterize', 'Posterize'], ['threshold', 'Threshold'], ['invert', 'Invert colors'],
  ['gradmap', 'Gradient map'],
];
const ADJUST_IDS = new Set(ADJUSTMENTS.map(a => a[0]));
export const adjustLabel = type => ADJUSTMENTS.find(a => a[0] === type)?.[1] || 'Correction';

const DEFAULT_STOPS = [[0, [0, 0, 0, 255]], [1, [255, 255, 255, 255]]];
const MAX_STOPS = 16;

/** The sliders a correction layer shows: the filter's, less the gradient map's Strength (the layer's opacity does that). */
export function adjustFields(type) {
  const f = FILTER_BY_ID[type];
  return f ? f.fields.filter(x => !(type === 'gradmap' && x.key === 'mix')) : [];
}

/** A gradient map's stops cleaned up: [[offset 0-1, [r, g, b, a] 0-255]], sorted, 2 to MAX_STOPS. */
function sanitizeMapStops(raw) {
  if (!Array.isArray(raw)) return DEFAULT_STOPS;
  const out = [];
  for (const s of raw.slice(0, MAX_STOPS)) {
    if (!Array.isArray(s) || !Array.isArray(s[1])) continue;
    const o = Number(s[0]);
    const c = [0, 1, 2, 3].map(i => Math.max(0, Math.min(255, Math.round(Number(s[1][i] ?? 255)))) || 0);
    if (Number.isFinite(o)) out.push([Math.max(0, Math.min(1, o)), c]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.length >= 2 ? out : DEFAULT_STOPS;
}

/** A correction as loaded or edited: {type, params} with every parameter in range, or null when it is not one. */
export function sanitizeAdjust(raw) {
  if (!raw || typeof raw !== 'object' || !ADJUST_IDS.has(raw.type)) return null;
  const type = raw.type, filter = FILTER_BY_ID[type];
  if (type === 'gradmap') {
    const colors = typeof raw.params?.colors === 'string' ? raw.params.colors.slice(0, 40) : 'gray';
    return { type, params: { colors, stops: sanitizeMapStops(raw.params?.stops) } };
  }
  const params = sanitizeParams(filter, raw.params);
  return { type, params };
}

/** A new correction of a type with default settings. */
export function defaultAdjust(type) {
  return sanitizeAdjust({ type, params: type === 'gradmap' ? { colors: 'gray', stops: DEFAULT_STOPS } : defaultParams(FILTER_BY_ID[type]) });
}

// ---------- the filter steps ----------
// A step is {kind: 'matrix', values: [20 numbers]} (feColorMatrix, rows r, g, b, a of [r g b a 1], colours 0-1) or
// {kind: 'table', r, g, b: [values 0-1]} (feComponentTransfer, 'table' type: values spread evenly over 0-1 and
// joined by straight lines, so 256 values reproduce a 256-entry lookup table exactly).

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const LUMA = [0.299, 0.587, 0.114];
/** Every colour channel becomes the pixel's brightness (as luminance() in filters.js); alpha stays. */
const LUMA_MATRIX = [...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 1, 0];

/** The matrix that does b, then a (both 4 x 5 colour matrices). */
export function mulMatrix(a, b) {
  const out = new Array(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? a[r * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = v;
    }
  }
  return out;
}

/**
 * Turns the hue by deg degrees: a rotation of the colour cube round its gray diagonal, so pure red goes exactly to
 * green at 120° and grays stay, close to the HSL hue shift of the filter (the GPU's own hueRotate keeps luminance
 * instead, which makes red turned green much darker than the filter does).
 */
export function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a) / Math.sqrt(3), d = c + (1 - c) / 3, o = (1 - c) / 3;
  return [d, o - s, o + s, 0, 0, o + s, d, o - s, 0, 0, o - s, o + s, d, 0, 0, 0, 0, 0, 1, 0];
}

/** Saturation: every channel k times as far from the pixel's mean (0 = gray, 1 = as it is, more = stronger colours). */
export function saturateMatrix(k) {
  const m = (1 - k) / 3, d = m + k;
  return [d, m, m, 0, 0, m, d, m, 0, 0, m, m, d, 0, 0, 0, 0, 0, 1, 0];
}

const lutValues = lut => Array.from(lut, v => v / 255);
const sameLut = lut => ({ kind: 'table', r: lutValues(lut), g: lutValues(lut), b: lutValues(lut) });

/** The gradient map's 256-entry colour tables (dark = the first stop), as gradientMap in filters.js builds them. */
export function gradientTables(stops) {
  const out = { r: [], g: [], b: [] };
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [o0, c0] = stops[k], [o1, c1] = stops[Math.min(k + 1, stops.length - 1)];
    const f = o1 > o0 ? Math.min(1, Math.max(0, (t - o0) / (o1 - o0))) : 0;
    ['r', 'g', 'b'].forEach((ch, i) => out[ch].push((c0[i] + (c1[i] - c0[i]) * f) / 255));
  }
  return { kind: 'table', ...out };
}

/**
 * The filter steps for a correction, in order. Per-channel corrections are the Filter menu's own lookup tables, so
 * they look exactly like the filter. Hue/Saturation/Lightness uses colour matrices close to the filter's HSL
 * maths but not identical (a matrix cannot do HSL exactly).
 */
export function adjustSpec(adjust) {
  const a = sanitizeAdjust(adjust);
  if (!a) return [];
  const p = a.params;
  switch (a.type) {
    case 'brightness': return [sameLut(brightnessContrastLut(p.brightness, p.contrast))];
    case 'levels': return [sameLut(levelsLut(p))];
    case 'posterize': return [sameLut(posterizeLut(p.levels))];
    case 'invert': return [{ kind: 'table', r: [1, 0], g: [1, 0], b: [1, 0] }];
    case 'balance': return [{ kind: 'table', r: lutValues(balanceLut(p.red)), g: lutValues(balanceLut(p.green)), b: lutValues(balanceLut(p.blue)) }];
    case 'curves': {
      const all = curvesLut(p.rgb);
      const ch = pts => { const own = curvesLut(pts); return Array.from(own, v => all[v] / 255); };
      return [{ kind: 'table', r: ch(p.r), g: ch(p.g), b: ch(p.b) }];
    }
    case 'threshold': {
      const t = Array.from({ length: 256 }, (_, v) => (v >= p.threshold ? 1 : 0));
      return [{ kind: 'matrix', values: LUMA_MATRIX }, { kind: 'table', r: t, g: t, b: t }];
    }
    case 'gradmap': return [{ kind: 'matrix', values: LUMA_MATRIX }, gradientTables(p.stops)];
    case 'hsl': {
      const sat = p.saturation / 100, lig = p.lightness / 100;
      const steps = [];
      const m = mulMatrix(saturateMatrix(1 + sat), hueMatrix(p.hue));
      if (m.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-9)) steps.push({ kind: 'matrix', values: m });
      if (lig) {  // towards black (scaled down) or white (the rest of the way up), as the filter
        const slope = lig < 0 ? 1 + lig : 1 - lig, icpt = lig < 0 ? 0 : lig;
        const t = [icpt, icpt + slope];
        steps.push({ kind: 'table', r: t, g: t, b: t });
      }
      return steps;
    }
    default: return [];
  }
}

// ---------- the SVG filters (browser only) ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
const cache = new Map();  // spec JSON -> 'url(#id)', least recently used first
const CACHE_MAX = 64;  // a slider dragged in a correction's dialog makes a filter per step: only recent ones stay
const byObject = new WeakMap();  // adjust object -> its spec JSON (corrections are never changed in place)
let defs = null, nextId = 1;
const num = v => +v.toFixed(5);

/** The canvas filter for a correction ('none' when it changes nothing). */
export function adjustFilter(adjust) {
  let key = byObject.get(adjust);
  if (key === undefined) {
    key = JSON.stringify(adjustSpec(adjust));
    if (adjust && typeof adjust === 'object') byObject.set(adjust, key);
  }
  let url = cache.get(key);
  if (url) cache.delete(key);  // put back below as the most recent
  else {
    const spec = JSON.parse(key);
    url = spec.length ? buildFilter(spec) : 'none';
  }
  cache.set(key, url);
  if (cache.size > CACHE_MAX) {  // the oldest goes, with its <filter> element; built again if wanted later
    const [old, oldUrl] = cache.entries().next().value;
    cache.delete(old);
    if (oldUrl !== 'none') defs.querySelector(`[id="${oldUrl.slice(5, -1)}"]`)?.remove();
  }
  return url;
}

function buildFilter(spec) {
  if (!defs) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.append(defs);
    document.body.append(svg);
  }
  const id = `koe-adjust-${nextId++}`;
  const f = document.createElementNS(SVG_NS, 'filter');
  f.id = id;
  f.setAttribute('color-interpolation-filters', 'sRGB');
  for (const step of spec) {
    if (step.kind === 'matrix') {
      const m = document.createElementNS(SVG_NS, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', step.values.map(num).join(' '));
      f.append(m);
    } else {
      const t = document.createElementNS(SVG_NS, 'feComponentTransfer');
      for (const ch of ['r', 'g', 'b']) {
        const fn = document.createElementNS(SVG_NS, `feFunc${ch.toUpperCase()}`);
        fn.setAttribute('type', 'table');
        fn.setAttribute('tableValues', step[ch].map(num).join(' '));
        t.append(fn);
      }
      f.append(t);
    }
  }
  defs.append(f);
  return `url(#${id})`;
}
