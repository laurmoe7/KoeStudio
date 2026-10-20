// Texture modes (pure, tested): how a brush texture combines with the paint, as Clip Studio Paint's Texture mode does.
// Measured in CLIP STUDIO PAINT 1.5 (single dabs of a hard round brush at brush densities 10-75% on its Rough
// textured paper, texture densities 25-100%, exported and lined up with the texture picture: it is anchored at the
// canvas origin): every mode is a function of the paint's density a, the texture value s and the texture density D
// (Grain), all 0-1. s is how much the texture lets paint through: KoeStudio's texture gray / 255 after Invert
// texture, which is CLIP STUDIO's texture darkness after its own Invert (brushimport.py inverts to match). Most modes
// blend with t = 1 - D (1 - s), the texture faded towards white by its density; Outline and Height use D themselves.
// Multiply is what KoeStudio's texture always did (doc.js liveSource cuts it on the GPU); the others are worked out
// per pixel (painter.js modeDab and doc.js liveSource with a texture `cpu`).

/** The modes in the order of the Texture mode choice. */
export const TEXTURE_MODES = [
  ['multiply', 'Multiply'], ['subtract', 'Subtract'], ['compare', 'Compare'], ['normal', 'Normal'],
  ['overlay', 'Overlay'], ['dodge', 'Color dodge'], ['burn', 'Color burn'], ['hardmix', 'Hard mix'],
  ['outline', 'Outline'], ['height', 'Height'],
];

/** CLIP STUDIO's TextureCompositeMode numbers (the order of its Texture mode list) as KoeStudio's modes. */
export const CSP_TEXTURE_MODES = ['normal', 'multiply', 'subtract', 'compare', 'outline', 'overlay', 'dodge', 'burn', 'hardmix', 'height'];

const clamp01 = v => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/**
 * The paint left by `mode` at density a over texture value s with texture density D (all 0-1). Each is the formula
 * that matched the measurements (to about 0.01): Multiply a t, Subtract a - (1 - t), Compare min(a, t), Normal
 * a (t + 1/2), Overlay / Color dodge / Color burn the usual blends with the paint as the base and t on top, Hard mix
 * 2a + t - 1, Outline (1 + D) a + t - 1, Height 10 a D - s (paint keeps to the low parts and fills up quickly).
 * No paint stays no paint in every mode.
 */
export function textureMode(mode, a, s, D, emph = false) {
  if (a <= 0) return 0;
  const t = emph ? emphasized(s, D) : 1 - D * (1 - s);
  switch (mode) {
    case 'subtract': return clamp01(a - (1 - t));
    case 'compare': return Math.min(a, t);
    case 'normal': return clamp01(a * (t + 0.5));
    case 'overlay': return a < 0.5 ? 2 * a * t : 1 - 2 * (1 - a) * (1 - t);
    case 'dodge': return t >= 1 ? 1 : clamp01(a / (1 - t));
    case 'burn': return t <= 0 ? 0 : clamp01(1 - (1 - a) / t);
    case 'hardmix': return clamp01(2 * a + t - 1);
    case 'outline': return clamp01((1 + D) * a + t - 1);
    case 'height': return clamp01(10 * a * D - s);
    default: return a * t;
  }
}

/**
 * CLIP STUDIO's Emphasize density: the texture turned into a steep ramp around its middle grey, the texture density D
 * setting its steepness (it then takes the place of t = 1 - D (1 - s) in every mode): 0.5 + 10 D (s - 0.5), clamped.
 * Measured in CLIP STUDIO PAINT 1.5 (Multiply, texture densities 100% and 50%, brush densities 100% and 50%): the paint
 * went from none to full between s 0.45 and 0.55 at D 1, between 0.4 and 0.6 at D 0.5, through a half at 0.5, and
 * the brush density scaled it as in Multiply.
 */
export function emphasized(s, D) {
  return clamp01(0.5 + 10 * D * (s - 0.5));
}

/**
 * Applies `mode` to RGBA pixels in place: each pixel's alpha is the paint density a, and value(i) gives the texture
 * value 0-255 for pixel i; strength(i), when given, scales D per pixel (0-255, Pen → grain). With `emph` the texture
 * is emphasized (Emphasize density). The colour stays.
 */
export function applyTextureMode(data, mode, D, value, strength = null, emph = false) {
  for (let i = 0, p = 3; p < data.length; i++, p += 4) {
    const a = data[p];
    if (!a) continue;
    const d = strength ? D * strength(i) / 255 : D;
    data[p] = Math.round(255 * textureMode(mode, a / 255, value(i) / 255, d, emph));
  }
  return data;
}

/** The texture value (0-255) at doc pixel (x, y) of values {gray, w, h, scale, cos?, sin?}: the nearest texel of the
 * tile laid from the canvas origin at `scale`, turned round the origin by the angle whose cos and sin are given
 * (clockwise on screen, textureAngle), as the GPU texture is drawn (liveSource) and CLIP STUDIO anchors it. */
export function textureValueAt(v, x, y) {
  if (v.cos !== undefined) [x, y] = [x * v.cos + y * v.sin, y * v.cos - x * v.sin];
  const tx = Math.floor(x / v.scale) % v.w, ty = Math.floor(y / v.scale) % v.h;
  return v.gray[(ty < 0 ? ty + v.h : ty) * v.w + (tx < 0 ? tx + v.w : tx)];
}
