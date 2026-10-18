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
  const out = {
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
  const runs = t.runs ? sanitizeRuns(t.runs, out) : [];  // styles of parts of the text (see below)
  if (runs.length) out.runs = runs;
  return out;
}

export function fontCss(t) {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px "${t.font}", "Segoe UI", sans-serif`;
}

// ---------- per-character styles ----------
//
// `runs` (optional) styles parts of the text differently from the text's own settings: [{from, to, font?, size?,
// bold?, italic?, color?}], from/to as string indices into content (to exclusive), sorted, not overlapping, each
// holding only what differs from the text's settings. Typing inside or right after a run continues its style.

/** What a run may change. */
export const RUN_KEYS = ['font', 'size', 'bold', 'italic', 'color'];
const FONT_RE = /^[\w .-]{1,60}$/, HEX_RE = /^#[0-9a-f]{6}$/i;
/** How far below a line's top a letter's top sits per px it is smaller than the line's largest letter, so small
 *  and big letters share a baseline (about the ascent of the em box in common fonts). */
const ASCENT = 0.8;

const baseStyle = t => ({ font: t.font, size: t.size, bold: t.bold, italic: t.italic, color: String(t.color).toLowerCase() });

/** One run property cleaned up, or undefined when it is not valid. */
function runValue(k, v) {
  if (k === 'font') return typeof v === 'string' && FONT_RE.test(v) ? v : undefined;
  if (k === 'size') return Number.isFinite(+v) && v !== null && v !== '' && typeof v !== 'boolean' ? Math.max(1, Math.min(1000, +v)) : undefined;
  if (k === 'color') return typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : undefined;
  return typeof v === 'boolean' ? v : undefined;
}

/** Per string index: what that character changes ({} = nothing), from runs (later runs win where they overlap). */
function expandRuns(runs, len) {
  const out = Array.from({ length: len }, () => ({}));
  for (const r of Array.isArray(runs) ? runs.slice(0, 5000) : []) {
    if (!r || typeof r !== 'object') continue;
    const from = Math.max(0, Math.floor(+r.from || 0)), to = Math.min(len, Math.floor(+r.to || 0));
    for (let i = from; i < to; i++) {
      for (const k of RUN_KEYS) {
        const v = runValue(k, r[k]);
        if (v !== undefined) out[i][k] = v;
      }
    }
  }
  return out;
}

/** Per-character changes back into runs: what equals the base dropped, equal neighbours joined. */
function compressRuns(over, base) {
  const runs = [];
  over.forEach((o, i) => {
    const d = {};
    for (const k of RUN_KEYS) if (o[k] !== undefined && o[k] !== base[k]) d[k] = o[k];
    if (!Object.keys(d).length) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i && RUN_KEYS.every(k => last[k] === d[k])) last.to = i + 1;
    else runs.push({ from: i, to: i + 1, ...d });
  });
  return runs;
}

/** Runs cleaned up for a text (its content and settings); [] when there are none. */
export const sanitizeRuns = (runs, t) => compressRuns(expandRuns(runs, t.content.length), baseStyle(t));

/** The text with characters from..to (string indices) given props (any of RUN_KEYS); a new object. */
export function styleRange(t, from, to, props) {
  const over = expandRuns(t.runs, t.content.length);
  for (let i = Math.max(0, from); i < Math.min(over.length, to); i++) {
    for (const k of RUN_KEYS) {
      if (!(k in props)) continue;
      const v = runValue(k, props[k]);
      if (v !== undefined) over[i][k] = v;
    }
  }
  return withRuns(t, compressRuns(over, baseStyle(t)));
}

/** The text with its own settings changed (props) and its runs kept, minus what now equals the new settings. */
export function restyleText(t, props) {
  const next = { ...t, ...props };
  return t.runs?.length ? withRuns(next, compressRuns(expandRuns(t.runs, t.content.length), baseStyle(next))) : next;
}

/**
 * The text with its content replaced by `content`, the runs following the edit: the part that changed is found
 * by the common start and end, deleted characters take their styles along, and new characters take the style of
 * the one before them (or after, at the very start).
 */
export function editContent(t, content) {
  const old = t.content;
  if (!t.runs?.length || old === content) return { ...t, content };
  let p = 0;
  while (p < old.length && p < content.length && old[p] === content[p]) p++;
  let q = 0;
  while (q < old.length - p && q < content.length - p && old[old.length - 1 - q] === content[content.length - 1 - q]) q++;
  const over = expandRuns(t.runs, old.length);
  const like = over[p - 1] || over[old.length - q] || {};
  const added = Array.from({ length: content.length - p - q }, () => ({ ...like }));
  const next = [...over.slice(0, p), ...added, ...over.slice(old.length - q)];
  return withRuns({ ...t, content }, compressRuns(next, baseStyle(t)));
}

function withRuns(t, runs) {
  const out = { ...t };
  if (runs.length) out.runs = runs; else delete out.runs;
  return out;
}

/** The full style ({font, size, bold, italic, color}) of the character at string index i (the text's own when out of range). */
export function styleAt(t, i) {
  const base = baseStyle(t);
  if (!(i >= 0 && i < t.content.length)) return base;
  return { ...base, ...expandRuns(t.runs, t.content.length)[i] };
}

/** The full style of each string index of the content: base settings with the runs over them (shared objects). */
function charStyles(t) {
  const base = baseStyle(t), cache = new Map();
  return expandRuns(t.runs, t.content.length).map(o => {
    const key = RUN_KEYS.map(k => o[k] ?? '').join('|');
    if (!cache.has(key)) cache.set(key, { ...base, ...o });
    return cache.get(key);
  });
}

/**
 * Where each piece of text goes: { glyphs: [{str, x, y, center, st}], bounds: {x, y, w, h} }.
 * measure(str, st) is the width of str in style st ({font, size, bold, italic}). Horizontal lines are drawn as
 * pieces of one style, left-aligned at their x; each line is as tall as its largest letters (times the line
 * spacing), with smaller letters lowered onto the same baseline. Vertical text is drawn one character at a time,
 * centred on its column (center: true); each character takes its own size down the column. st is the piece's
 * full style (font, size, bold, italic, color).
 */
export function layoutText(t, measure) {
  const styles = charStyles(t), base = baseStyle(t);
  let at = 0;
  const lines = t.content.split('\n').map(str => { const start = at; at += str.length + 1; return { str, start }; });
  const sizeOfEmpty = start => (styles[start] || styles[start - 1] || base).size;
  const glyphs = [];
  if (!t.vertical) {
    let top = t.y;
    const rows = lines.map(({ str, start }) => {
      const segs = [];
      for (let i = 0; i < str.length; i++) {
        const st = styles[start + i], last = segs[segs.length - 1];
        if (last && last.st === st) last.str += str[i]; else segs.push({ str: str[i], st });
      }
      const widths = segs.map(s => measure(s.str, s.st));
      const size = segs.length ? Math.max(...segs.map(s => s.st.size)) : sizeOfEmpty(start);
      const row = { segs, widths, w: widths.reduce((a, b) => a + b, 0), size, lh: size * t.leading, top };
      top += row.lh;
      return row;
    });
    const w = Math.max(0, ...rows.map(r => r.w)), h = top - t.y;
    const left = t.align === 'left' ? t.x : t.align === 'center' ? t.x - w / 2 : t.x - w;
    for (const r of rows) {
      let x = t.align === 'left' ? t.x : t.align === 'center' ? t.x - r.w / 2 : t.x - r.w;
      const y = r.top + (r.lh - r.size) / 2;
      r.segs.forEach((s, k) => {
        glyphs.push({ str: s.str, x, y: y + (r.size - s.st.size) * ASCENT, center: false, st: s.st });
        x += r.widths[k];
      });
    }
    return { glyphs, bounds: { x: left, y: t.y, w, h } };
  }
  const cols = lines.map(({ str, start }) => {
    const chars = [];
    for (let i = 0; i < str.length;) {
      const ch = String.fromCodePoint(str.codePointAt(i));
      chars.push({ ch, st: styles[start + i] });
      i += ch.length;
    }
    const size = chars.length ? Math.max(...chars.map(c => c.st.size)) : sizeOfEmpty(start);
    return { chars, pitch: size * t.leading, len: chars.reduce((a, c) => a + c.st.size, 0) };
  });
  const longest = Math.max(0, ...cols.map(c => c.len));
  let right = t.x;
  for (const c of cols) {
    const cx = right - c.pitch / 2;
    right -= c.pitch;
    const free = longest - c.len;
    let y = t.y + (t.align === 'left' ? 0 : t.align === 'center' ? free / 2 : free);
    for (const { ch, st } of c.chars) {
      glyphs.push({ str: ch, x: cx, y, center: true, st });
      y += st.size;
    }
  }
  return { glyphs, bounds: { x: right, y: t.y, w: t.x - right, h: longest } };
}

/** A layoutText measure function using ctx's text metrics. */
function measureWith(ctx) {
  return (s, st) => { ctx.font = fontCss(st); return ctx.measureText(s).width; };
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
  ctx.textBaseline = 'top';
  const { glyphs } = layoutText(t, measureWith(ctx));
  const look = g => { ctx.font = fontCss(g.st); ctx.textAlign = g.center ? 'center' : 'left'; };
  if (t.outline > 0) {  // under the letters, twice as wide, so `outline` px show around them
    ctx.strokeStyle = t.outlineColor;
    ctx.lineWidth = t.outline * 2;
    ctx.lineJoin = 'round';
    for (const g of glyphs) { look(g); ctx.strokeText(g.str, g.x, g.y); }
  }
  for (const g of glyphs) {
    look(g);
    ctx.fillStyle = g.st.color;
    ctx.fillText(g.str, g.x, g.y);
  }
  ctx.restore();
}

/** Bounds of a text layer's text in its layout space (see textMatrix), for clicking on it and placing the editor. */
export function textBounds(t, ctx) {
  ctx.save();
  const b = layoutText(t, measureWith(ctx)).bounds;
  ctx.restore();
  const o = t.outline || 0;
  return o ? { x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o } : b;
}
