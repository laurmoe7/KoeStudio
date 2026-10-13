// Text layers: a layer whose pixels are drawn from `layer.text` (content, position, font...). Layout is pure and
// tested (with a fake measure function); renderText() draws it onto a canvas.
//
// Horizontal text: (x, y) is the top of the first line at its left edge, centre or right edge (align).
// Vertical text (top to bottom, columns right to left, as in manga): (x, y) is the top-right corner;
// align moves short columns to the top, middle or bottom.

export const FONTS = [
  ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'],
  ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Courier New', 'Courier New'],
  ['Comic Sans MS', 'Comic Sans MS'], ['Impact', 'Impact'],
  ['Yu Gothic UI', 'Yu Gothic (Japanese)'], ['Meiryo', 'Meiryo (Japanese)'], ['Yu Mincho', 'Yu Mincho (Japanese)'],
  ['MS Gothic', 'MS Gothic (Japanese)'],
];
export const ALIGNS = [['left', 'Left / top'], ['center', 'Centre'], ['right', 'Right / bottom']];
const ALIGN_IDS = new Set(ALIGNS.map(a => a[0]));

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
  ctx.font = fontCss(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  const { glyphs } = layoutText(t, s => ctx.measureText(s).width);
  for (const g of glyphs) {
    ctx.textAlign = g.center ? 'center' : 'left';
    ctx.fillText(g.str, g.x, g.y);
  }
  ctx.restore();
  layer.touch();
}

/** Bounds of a text layer's text, for clicking on it and placing the editor. */
export function textBounds(t, ctx) {
  ctx.save();
  ctx.font = fontCss(t);
  const b = layoutText(t, s => ctx.measureText(s).width).bounds;
  ctx.restore();
  return b;
}
