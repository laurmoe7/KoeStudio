// Text layers: a layer whose pixels are drawn from `layer.text` (content, position, font...). Layout is pure and
// tested (with a fake measure function); renderText() draws it onto a canvas.
//
// Horizontal text: (x, y) is the top of the first line at its left edge, centre or right edge (align).
// Vertical text (top to bottom, columns right to left, as in manga): (x, y) is the top-right corner;
// align moves short columns to the top, middle or bottom.
//
// A text may carry `m` = [a, b, c, d, e, f], a turn/scale/mirror (no shear) from its own layout space to the doc,
// set by Transform: the text stays editable and is drawn sharp at any size. Without `m` the layout space is the doc.

export const FONTS = [
  ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'],
  ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Courier New', 'Courier New'],
  ['Comic Sans MS', 'Comic Sans MS'], ['Impact', 'Impact'],
  ['Yu Gothic UI', 'Yu Gothic (Japanese)'], ['Meiryo', 'Meiryo (Japanese)'], ['Yu Mincho', 'Yu Mincho (Japanese)'],
  ['MS Gothic', 'MS Gothic (Japanese)'],
];
export const ALIGNS = [['left', 'Left / top'], ['center', 'Centre'], ['right', 'Right / bottom']];
/** Outline colours the Text tool offers; 'sub' is the sub colour at the time it is chosen. */
export const OUTLINE_COLORS = [['white', 'White'], ['black', 'Black'], ['sub', 'Sub colour']];
const ALIGN_IDS = new Set(ALIGNS.map(a => a[0]));
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** A text's matrix as saved: six finite numbers with no shear and a sensible scale, or null (none). */
export function sanitizeTextMatrix(m) {
  if (!Array.isArray(m) || m.length !== 6 || !m.every(v => Number.isFinite(+v) && v !== null)) return null;
  const [a, b, c, d, e, f] = m.map(Number), sx = Math.hypot(a, b), sy = Math.hypot(c, d);
  if (!(sx > 0.001 && sy > 0.001 && sx < 1000 && sy < 1000)) return null;
  if (Math.abs(a * c + b * d) > 1e-3 * sx * sy || Math.abs(e) > 1e6 || Math.abs(f) > 1e6) return null;  // sheared or far off
  const r = v => Math.round(v * 1e6) / 1e6 + 0, out = [a, b, c, d, e, f].map(r);  // + 0: no -0
  return out.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9) ? null : out;
}

/**
 * The text after the whole doc is mapped by affine `m` ([a..f], old doc point -> new: flips, quarter turns, image
 * size, crops), or null when the result would be sheared (a non-uniform resize of turned text): then it can only
 * become pixels.
 */
export function textAfterMap(t, m) {
  const [a, b, c, d, e, f] = m, [p, q, r, s, u, v] = textMatrix(t);
  const out = [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * u + c * v + e, b * u + d * v + f];
  const sx = Math.hypot(out[0], out[1]), sy = Math.hypot(out[2], out[3]);
  if (!(sx > 0.001 && sy > 0.001) || Math.abs(out[0] * out[2] + out[1] * out[3]) > 1e-3 * sx * sy) return null;
  const next = { ...t }, k = sanitizeTextMatrix(out);
  if (k) next.m = k; else delete next.m;
  return next;
}

/** The matrix taking a text's layout space to the doc. */
export const textMatrix = t => t.m || IDENTITY;

/** A doc point in a text's layout space. */
export function toTextLocal(t, p) {
  const [a, b, c, d, e, f] = textMatrix(t), det = a * d - b * c, x = p.x - e, y = p.y - f;
  return { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
}

/**
 * The free-transform state (transform.js: {w, h, cx, cy, sx, sy, rot}) whose box is the text's layout bounds b,
 * placed where the text's matrix puts them; so transforming a turned text starts from its own frame.
 */
export function textTransformStart(t, b) {
  const [a, bb, c, d, e, f] = textMatrix(t), sx0 = Math.hypot(a, bb), rot = Math.atan2(bb, a);
  const sy = (a * d - bb * c) / sx0;  // negative when mirrored
  const mx = b.x + b.w / 2, my = b.y + b.h / 2;
  return { w: b.w, h: b.h, cx: a * mx + c * my + e, cy: bb * mx + d * my + f, sx: sx0, sy, rot };
}

/** The text matrix after a transform: the box (layout bounds b) mapped by xf matrix xm ([a..f], transform.js xfMatrix). */
export function textMatrixAfter(xm, b) {
  const [a, bb, c, d, e, f] = xm;
  return sanitizeTextMatrix([a, bb, c, d, e - a * b.x - c * b.y, f - bb * b.x - d * b.y]);
}

/** Cleans text properties from a file or the tool panel (pure, tested). */
export function sanitizeText(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : def);
  return {
    content: String(t.content ?? '').slice(0, 5000),
    x: num(t.x, -100000, 100000, 0),
    y: num(t.y, -100000, 100000, 0),
    // any installed font may be named, but only plain names reach the CSS font string
    font: /^[\w .-]{1,60}$/.test(t.font || '') ? t.font : 'Segoe UI',
    size: num(t.size, 1, 1000, 48),
    bold: !!t.bold,
    italic: !!t.italic,
    align: ALIGN_IDS.has(t.align) ? t.align : 'left',
    leading: num(t.leading, 0.5, 4, 1.2),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#000000',
    vertical: !!t.vertical,
    outline: num(t.outline, 0, 100, 0),  // px around the letters (0 = none)
    outlineColor: /^#[0-9a-f]{6}$/i.test(t.outlineColor) ? t.outlineColor : '#ffffff',
    ...(sanitizeTextMatrix(t.m) ? { m: sanitizeTextMatrix(t.m) } : {}),
  };
}

export function fontCss(t) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px "${t.font}", "Segoe UI", sans-serif`;
}

/**
 * Where each piece of text goes: { glyphs: [{str, x, y, center}], bounds: {x, y, w, h} }.
 * measure(str) is the width of str in the text's font. Horizontal lines are drawn left-aligned at their x;
 * vertical text is drawn one character at a time, centred on its column (center: true).
 */
export function layoutText(t, measure) {
  const lines = t.content.split('\n');
  const lh = t.size * t.leading, pad = (lh - t.size) / 2;
  const glyphs = [];
  if (!t.vertical) {
    const widths = lines.map(l => measure(l));
    const w = Math.max(0, ...widths), h = lines.length * lh;
    const left = t.align === 'left' ? t.x : t.align === 'center' ? t.x - w / 2 : t.x - w;
    lines.forEach((str, i) => {
      const x = t.align === 'left' ? t.x : t.align === 'center' ? t.x - widths[i] / 2 : t.x - widths[i];
      if (str) glyphs.push({ str, x, y: t.y + i * lh + pad, center: false });
    });
    return { glyphs, bounds: { x: left, y: t.y, w, h } };
  }
  const cols = lines.map(l => Array.from(l));
  const longest = Math.max(0, ...cols.map(c => c.length));
  const w = lines.length * lh, h = longest * t.size;
  cols.forEach((chars, i) => {
    const cx = t.x - i * lh - lh / 2;
    const free = (longest - chars.length) * t.size;
    const top = t.y + (t.align === 'left' ? 0 : t.align === 'center' ? free / 2 : free);
    chars.forEach((ch, j) => glyphs.push({ str: ch, x: cx, y: top + j * t.size, center: true }));
  });
  return { glyphs, bounds: { x: t.x - w, y: t.y, w, h } };
}

/** Clears the layer's canvas and draws its text. */
export function renderTextLayer(layer) {
  const ctx = layer.ctx, t = layer.text;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  ctx.setTransform(...textMatrix(t));
  drawText(ctx, t);
  ctx.restore();
  layer.touch();
}

/** Draws a text's glyphs (and outline) in its layout space, under ctx's current transform. */
export function drawText(ctx, t) {
  ctx.save();
  ctx.font = fontCss(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  const { glyphs } = layoutText(t, s => ctx.measureText(s).width);
  if (t.outline > 0) {  // under the letters, twice as wide, so `outline` px show around them
    ctx.strokeStyle = t.outlineColor;
    ctx.lineWidth = t.outline * 2;
    ctx.lineJoin = 'round';
    for (const g of glyphs) { ctx.textAlign = g.center ? 'center' : 'left'; ctx.strokeText(g.str, g.x, g.y); }
  }
  for (const g of glyphs) {
    ctx.textAlign = g.center ? 'center' : 'left';
    ctx.fillText(g.str, g.x, g.y);
  }
  ctx.restore();
}

/** Bounds of a text layer's text in its layout space (see textMatrix), for clicking on it and placing the editor. */
export function textBounds(t, ctx) {
  ctx.save();
  ctx.font = fontCss(t);
  const b = layoutText(t, s => ctx.measureText(s).width).bounds;
  ctx.restore();
  const o = t.outline || 0;
  return o ? { x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o } : b;
}
