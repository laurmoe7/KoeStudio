// Colour conversions (pure, tested). h in degrees 0-360, s/v 0-1, r/g/b 0-255.

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [(h + 360) % 360, max ? d / max : 0, max];
}

/** A colour moved in HSV: hue turned by h degrees, saturation and brightness shifted by s / v (clamped to 0-1). */
export function shiftColor(hex, { h = 0, s = 0, v = 0 }) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [H, S, V] = rgbToHsv(...rgb);
  const clamp = x => Math.max(0, Math.min(1, x));
  return rgbToHex(...hsvToRgb(H + h, clamp(S + s), clamp(V + v)));
}

export const PALETTE_MAX = 64;

/** A saved palette with a colour added at the end (not twice: an existing one moves to the end), at most PALETTE_MAX. */
export function paletteAdd(list, hex) {
  const c = String(hex).toLowerCase();
  return [...list.filter(x => x !== c), c].slice(-PALETTE_MAX);
}

/** A palette from storage: valid #rrggbb colours only, no repeats, at most PALETTE_MAX. */
export function sanitizePalette(raw) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const h = typeof c === 'string' ? c.toLowerCase() : '';
    if (/^#[0-9a-f]{6}$/.test(h) && !out.includes(h)) out.push(h);
  }
  return out.slice(0, PALETTE_MAX);
}

/**
 * The average colour of RGBA pixels, each counted by its opacity (so see-through pixels count less and fully
 * clear ones not at all): [r, g, b, a] 0-255 (a = mean opacity), or null when every pixel is clear.
 */
export function averageColor(data) {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const w = data[i + 3];
    r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += w; n++;
  }
  if (!a) return null;
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

/** '#abc' or '#aabbcc' (with or without #) to [r, g, b]; null when it is not a colour. */
export function hexToRgb(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}

/** The colour sliders' channels: [key, label, max] per mode. HSV shows s and v in percent. */
export const SLIDER_CHANNELS = {
  hsv: [['h', 'H', 360], ['s', 'S', 100], ['v', 'V', 100]],
  rgb: [['r', 'R', 255], ['g', 'G', 255], ['b', 'B', 255]],
};

/** The slider values for a colour: HSV as degrees and percent (rounded), RGB as 0-255. */
export function sliderValues(mode, hsv) {
  if (mode === 'rgb') { const [r, g, b] = hsvToRgb(...hsv); return { r, g, b }; }
  return { h: Math.round(hsv[0]), s: Math.round(hsv[1] * 100), v: Math.round(hsv[2] * 100) };
}

/** The HSV colour after one slider moves to value (keeping the hue for grays when an RGB slider moves). */
export function fromSlider(mode, hsv, key, value) {
  if (mode === 'hsv') {
    const [h, s, v] = hsv;
    return key === 'h' ? [Math.max(0, Math.min(360, value)) % 360, s, v]
      : key === 's' ? [h, Math.max(0, Math.min(100, value)) / 100, v] : [h, s, Math.max(0, Math.min(100, value)) / 100];
  }
  const rgb = hsvToRgb(...hsv), i = 'rgb'.indexOf(key);
  rgb[i] = Math.max(0, Math.min(255, Math.round(value)));
  const out = rgbToHsv(...rgb);
  if (out[1] === 0 || out[2] === 0) out[0] = hsv[0];
  return out;
}

/** CSS colour stops along one slider's track: the colour at each end; the hue track shows the whole wheel at full strength. */
export function sliderStops(mode, hsv, key) {
  if (key === 'h') return Array.from({ length: 7 }, (_, k) => rgbToHex(...hsvToRgb(k * 60, 1, 1)));
  const max = SLIDER_CHANNELS[mode].find(c => c[0] === key)[2];
  return [0, max].map(x => rgbToHex(...hsvToRgb(...fromSlider(mode, hsv, key, x))));
}
