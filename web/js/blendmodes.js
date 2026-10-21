// Blend modes the browser's canvas does not have (pure, tested): Add, Subtract, Linear burn, Vivid / Linear / Pin
// light, Hard mix, Divide, Darker / Lighter color, with the Photoshop / Clip Studio Paint formulas. B(b, s) is the
// blended colour of backdrop b and source s (0-1, not premultiplied); as for the canvas's own modes (W3C Compositing),
// where the backdrop is see-through the source shows more of itself: the colour laid on with source-over is
// (1 - backdrop alpha) s + backdrop alpha B(b, s), with the source's own alpha. doc.js drawBlended runs this on the
// GPU (BLEND_SHADER, the same formulas in GLSL) and falls back to blendPixels without WebGL.

/** Ids of the modes worked out here, in the order of BLEND_SHADER's uMode. */
export const CUSTOM_BLENDS = ['add', 'subtract', 'linear-burn', 'vivid-light', 'linear-light', 'pin-light',
  'hard-mix', 'divide', 'darker-color', 'lighter-color'];
const CUSTOM_SET = new Set(CUSTOM_BLENDS);

/** Whether blend has to be worked out here instead of by the canvas's globalCompositeOperation. */
export const isCustomBlend = blend => CUSTOM_SET.has(blend);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const burn = (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));

/** One channel of a separable mode: backdrop b, source s (0-1). */
export function blendChannel(mode, b, s) {
  switch (mode) {
    case 'add': return Math.min(1, b + s);
    case 'subtract': return Math.max(0, b - s);
    case 'linear-burn': return Math.max(0, b + s - 1);
    case 'vivid-light': return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1);
    case 'linear-light': return clamp01(b + 2 * s - 1);
    case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    // white where the two add up to at least white; the half step keeps 8-bit pairs such as 128 + 127 exact
    case 'hard-mix': return (b + s) * 255 >= 254.5 ? 1 : 0;
    case 'divide': return s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s);
    default: return s;
  }
}

/** Luminosity as the canvas's own Luminosity mode measures it (W3C Lum). */
export const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

/** B(cb, cs) for colours [r, g, b] (0-1): Darker / Lighter color keep the whole darker / lighter colour (the backdrop when equal). */
export function blendColor(mode, cb, cs) {
  if (mode === 'darker-color') return lum(...cs) < lum(...cb) ? cs.slice() : cb.slice();
  if (mode === 'lighter-color') return lum(...cs) > lum(...cb) ? cs.slice() : cb.slice();
  return [0, 1, 2].map(i => blendChannel(mode, cb[i], cs[i]));
}

/**
 * The source as it is laid on with source-over in blend mode `mode`: RGBA bytes (not premultiplied, as ImageData),
 * src and dst the same size; returns new bytes with the source's alpha.
 */
export function blendPixels(mode, dst, src) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    out[i + 3] = a;
    if (!a) continue;
    const ab = dst[i + 3] / 255;
    const cs = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const B = blendColor(mode, [dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255], cs);
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(((1 - ab) * cs[k] + ab * B[k]) * 255);
  }
  return out;
}

/**
 * Fragment shader (GLSL ES 1.0) doing blendPixels per pixel: uSrc and uDst are premultiplied textures (as the canvas
 * keeps them), the output is premultiplied for a canvas with premultipliedAlpha.
 */
export const BLEND_SHADER = `precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uDst;
uniform int uMode;
varying vec2 vUv;
vec3 unpm(vec4 c) { return c.a > 0.0 ? clamp(c.rgb / c.a, 0.0, 1.0) : vec3(0.0); }
float burn(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float dodge(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float ch(float b, float s) {
  if (uMode == 0) return min(1.0, b + s);
  if (uMode == 1) return max(0.0, b - s);
  if (uMode == 2) return max(0.0, b + s - 1.0);
  if (uMode == 3) return s <= 0.5 ? burn(b, 2.0 * s) : dodge(b, 2.0 * s - 1.0);
  if (uMode == 4) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  if (uMode == 5) return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
  if (uMode == 6) return (b + s) * 255.0 >= 254.5 ? 1.0 : 0.0;
  if (uMode == 7) return s <= 0.0 ? (b <= 0.0 ? 0.0 : 1.0) : min(1.0, b / s);
  return s;
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
void main() {
  vec4 s4 = texture2D(uSrc, vUv);
  vec4 d4 = texture2D(uDst, vUv);
  vec3 cs = unpm(s4), cb = unpm(d4), B;
  if (uMode == 8) B = lum(cs) < lum(cb) ? cs : cb;
  else if (uMode == 9) B = lum(cs) > lum(cb) ? cs : cb;
  else B = vec3(ch(cb.r, cs.r), ch(cb.g, cs.g), ch(cb.b, cs.b));
  gl_FragColor = vec4(mix(cs, B, d4.a) * s4.a, s4.a);
}`;
