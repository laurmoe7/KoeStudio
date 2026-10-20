// Expression color (pure, tested): Clip Studio Paint's per-layer setting that shows a layer as Gray or Monochrome
// without changing its pixels. A layer's `expression` is null (Color, as painted) or one of
//   {mode: 'gray'}                               every colour shown as its gray (luma), see-through as it was
//   {mode: 'mono', threshold, white}             black and white: a pixel shows where it is at least half opaque,
//                                                black where its gray is below threshold (1-255), else white, or
//                                                see-through when white is false
// The objects are never changed in place (a new one is set), so kept looks can compare them by identity.

export const EXPRESSIONS = [['color', 'Color'], ['gray', 'Gray'], ['mono', 'Monochrome']];
export const MONO_THRESHOLD = 128;

export const defaultExpression = mode => (mode === 'gray' ? { mode: 'gray' } : mode === 'mono' ? { mode: 'mono', threshold: MONO_THRESHOLD, white: true } : null);

/** A valid expression from anything, or null for Color. */
export function sanitizeExpression(e) {
  if (!e || typeof e !== 'object') return null;
  if (e.mode === 'gray') return { mode: 'gray' };
  if (e.mode !== 'mono') return null;
  const t = Number.isFinite(+e.threshold) && e.threshold !== null && e.threshold !== '' ? Math.round(+e.threshold) : MONO_THRESHOLD;
  return { mode: 'mono', threshold: Math.max(1, Math.min(255, t)), white: e.white !== false };
}

/** The panel's name for an expression ('Color' for null). */
export const expressionLabel = e => EXPRESSIONS.find(x => x[0] === (e?.mode || 'color'))[1];

/** Gray of a colour (Rec. 601 luma), 0-255. */
export const luma = (r, g, b) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** Changes RGBA pixels (straight alpha) in place to how the expression shows them. */
export function applyExpression(data, e) {
  if (!e) return data;
  if (e.mode === 'gray') {
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      data[i] = data[i + 1] = data[i + 2] = luma(data[i], data[i + 1], data[i + 2]);
    }
    return data;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    const black = luma(data[i], data[i + 1], data[i + 2]) < e.threshold;
    const v = black ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = black || e.white ? 255 : 0;
    if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return data;
}
