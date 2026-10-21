// Text layers: a layer whose pixels are drawn from `layer.text` (content, position, font...). Layout is pure and
// tested (with a fake measure function); renderText() draws it onto a canvas.
//
// Horizontal text: (x, y) is the top of the first line at its left edge, centre or right edge (align).
// Vertical text (top to bottom, columns right to left, as in manga): (x, y) is the top-right corner;
// align moves short columns to the top, middle or bottom.
//
// A text may carry `m` = [a, b, c, d, e, f], a turn/scale/mirror (no shear) from its own layout space to the doc,
// set by Transform: the text stays editable and is drawn sharp at any size. Without `m` the layout space is the doc.
//
// A text may also follow a `path` (points relative to (x, y), drawn with the Text tool): its letters then stand on
// the line, turned with it, and align places them at its start, middle or end. `warp` bends the finished text as a
// picture (arch, bulge, flag...) by `bend`; `tracking` adds space between letters (a fraction of their size).

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
/** Warp styles: how the top and bottom edges of the text's box are bent (warpEdges). */
export const WARPS = [['none', 'None'], ['arch', 'Arch'], ['arcTop', 'Arc upper'], ['arcBottom', 'Arc lower'], ['bulge', 'Bulge'], ['flag', 'Flag'], ['rise', 'Rise']];
const ALIGN_IDS = new Set(ALIGNS.map(a => a[0])), WARP_IDS = new Set(WARPS.map(w => w[0]));
/** Most points a text path keeps. */
export const PATH_MAX = 400;
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
    tracking: num(t.tracking, -0.5, 2, 0),  // extra space after each letter, as a fraction of its size
    warp: WARP_IDS.has(t.warp) ? t.warp : 'none',
    bend: num(t.bend, -1, 1, 0.5),
    ...(sanitizeTextPath(t.path) ? { path: sanitizeTextPath(t.path) } : {}),
    ...(sanitizeTextMatrix(t.m) ? { m: sanitizeTextMatrix(t.m) } : {}),
  };
  const runs = t.runs ? sanitizeRuns(t.runs, out) : [];  // styles of parts of the text (see below)
  if (runs.length) out.runs = runs;
  return out;
}

/** A text path as saved: [[dx, dy], ...] relative to the text's (x, y), at least two points apart, or null. */
export function sanitizeTextPath(path) {
  if (!Array.isArray(path)) return null;
  const out = [];
  for (const q of path.slice(0, PATH_MAX)) {
    if (!Array.isArray(q) || q.length !== 2 || !q.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000)) return null;
    const p = q.map(v => Math.round(v * 100) / 100 + 0), last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/**
 * A drawn line ([{x, y}] in layout space) as a text path: resampled every `step` px, smoothed (the ends stay put)
 * so the letters do not wobble with the hand, at most PATH_MAX points, relative to its first point.
 * Returns {x, y, path} (path null when the line is too short).
 */
export function pathFromPoints(pts, step = 4) {
  const o = pts[0] || { x: 0, y: 0 };
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  step = Math.max(step, len / (PATH_MAX - 1));
  const res = resample(pts, step);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = res.length - 2, next = res[res.length - 1]; i > 0; i--) {  // [1 2 1] / 4, from the end so each uses old values
      const cur = res[i], prev = res[i - 1];
      res[i] = { x: (prev.x + 2 * cur.x + next.x) / 4, y: (prev.y + 2 * cur.y + next.y) / 4 };
      next = cur;
    }
  }
  return { x: o.x, y: o.y, path: sanitizeTextPath(res.map(p => [p.x - o.x, p.y - o.y])) };
}

/** Points every `step` along a polyline, the last point included. */
function resample(pts, step) {
  if (!pts.length) return [];
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    let at = step - carry;
    for (; at <= d; at += step) out.push({ x: a.x + (b.x - a.x) * at / d, y: a.y + (b.y - a.y) * at / d });
    carry = d - (at - step);
  }
  const last = pts[pts.length - 1], end = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > step / 4 || out.length < 2) out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Walks a text's path: at(d) gives {x, y, angle} at distance d along it (layout space), going straight on along
 * the first or last piece before the start and past the end; `length` is the path's length.
 */
export function pathWalker(t) {
  const pts = t.path.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })), segs = [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0) { segs.push({ a, b, d, from: length }); length += d; }
  }
  const at = d => {
    let k = 0;
    while (k < segs.length - 1 && d > segs[k].from + segs[k].d) k++;
    const s = segs[k], f = (d - s.from) / s.d;
    return { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f, angle: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) };
  };
  return { length, at };
}

/**
 * Where a warp moves the top and bottom edges of a w x h box at u (0 = left edge, 1 = right edge): [top, bottom]
 * in px from the box's top (unwarped: [0, h]). Every column of the text is stretched between them. bend is -1..1;
 * a negative bend bends the other way. Arch and flag move the whole column; the arcs and bulge change its height
 * (never below a fifth of it); rise slants it.
 */
export function warpEdges(warp, bend, u, w, h) {
  const c = 2 * u - 1, q = 1 - c * c, k = bend, edges = (top, bottom) => [top + 0, bottom + 0];  // + 0: no -0
  switch (warp) {
    case 'arch': { const s = -k * q * w / 4; return edges(s, h + s); }
    case 'arcTop': return edges(-k * q * h * 0.8, h);
    case 'arcBottom': return edges(0, h + k * q * h * 0.8);
    case 'bulge': return edges(-k * q * h * 0.4, h + k * q * h * 0.4);
    case 'flag': { const s = -k * Math.sin(2 * Math.PI * u) * h / 2; return edges(s, h + s); }
    case 'rise': { const s = -k * c * h / 2; return edges(s, h + s); }
    default: return [0, h];
  }
}

/** True when a text is drawn warped. */
export const isWarped = t => !!t.warp && t.warp !== 'none' && !!t.bend;

/** Bounds of box b after the text's warp (every column's edges, sampled finely enough to catch each style's peaks). */
export function warpBounds(t, b) {
  let top = Infinity, bottom = -Infinity;
  for (let i = 0; i <= 64; i++) {
    const [y0, y1] = warpEdges(t.warp, t.bend, i / 64, b.w, b.h);
    top = Math.min(top, y0);
    bottom = Math.max(bottom, y1);
  }
  return { x: b.x, y: b.y + top, w: b.w, h: bottom - top };
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
 * full style (font, size, bold, italic, color). Letter spacing (`tracking`) goes between letters, not after the
 * last; with it, or along a path (pathLayout, which also lays vertical text out as horizontal), every letter is a
 * glyph of its own.
 */
export function layoutText(t, measure) {
  const styles = charStyles(t), base = baseStyle(t), tr = t.tracking || 0;
  let at = 0;
  const lines = t.content.split('\n').map(str => { const start = at; at += str.length + 1; return { str, start }; });
  const sizeOfEmpty = start => (styles[start] || styles[start - 1] || base).size;
  const glyphs = [];
  if (!t.vertical || t.path) {
    // with letter spacing or a path every letter is placed on its own; else pieces of one style are
    const single = !!(tr || t.path);
    let top = t.y;
    const rows = lines.map(({ str, start }) => {
      const segs = [];
      for (let i = 0; i < str.length;) {
        const ch = single ? String.fromCodePoint(str.codePointAt(i)) : str[i];
        const st = styles[start + i], last = segs[segs.length - 1];
        if (!single && last && last.st === st) last.str += ch; else segs.push({ str: ch, st });
        i += ch.length;
      }
      const widths = segs.map(s => measure(s.str, s.st));
      const gaps = segs.map((s, k) => (k < segs.length - 1 ? tr * s.st.size : 0));  // none after the last letter
      const w = Math.max(0, widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0));
      const size = segs.length ? Math.max(...segs.map(s => s.st.size)) : sizeOfEmpty(start);
      const row = { segs, widths, gaps, w, size, lh: size * t.leading, top };
      top += row.lh;
      return row;
    });
    if (t.path) return pathLayout(t, rows);
    const w = Math.max(0, ...rows.map(r => r.w)), h = top - t.y;
    const left = t.align === 'left' ? t.x : t.align === 'center' ? t.x - w / 2 : t.x - w;
    for (const r of rows) {
      let x = t.align === 'left' ? t.x : t.align === 'center' ? t.x - r.w / 2 : t.x - r.w;
      const y = r.top + (r.lh - r.size) / 2;
      r.segs.forEach((s, k) => {
        glyphs.push({ str: s.str, x, y: y + (r.size - s.st.size) * ASCENT, center: false, st: s.st });
        x += r.widths[k] + r.gaps[k];
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
    const len = chars.reduce((a, c, k) => a + c.st.size * (k < chars.length - 1 ? 1 + tr : 1), 0);
    return { chars, pitch: size * t.leading, len: Math.max(0, len) };
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
      y += st.size * (1 + tr);
    }
  }
  return { glyphs, bounds: { x: right, y: t.y, w: t.x - right, h: longest } };
}

/**
 * Rows of single letters (layoutText) placed along the text's path: each letter centred on the path at its
 * distance along it and turned with it, the first line's baseline on the path and later lines below it (to the
 * right of the drawing direction). Glyphs carry {x, y} = the point on the path, `rot` and the offset (ox, oy) to
 * draw at once turned.
 */
function pathLayout(t, rows) {
  const walk = pathWalker(t), glyphs = [], r0 = rows[0];
  const base = (r0.lh - r0.size) / 2 + r0.size * ASCENT;  // the first line's baseline below its top
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const corner = (p, c, s, lx, ly) => {
    const x = p.x + lx * c - ly * s, y = p.y + lx * s + ly * c;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  };
  for (const r of rows) {
    let d = t.align === 'left' ? 0 : t.align === 'center' ? (walk.length - r.w) / 2 : walk.length - r.w;
    const lineTop = r.top - t.y + (r.lh - r.size) / 2 - base;
    r.segs.forEach((g, k) => {
      const w = r.widths[k], p = walk.at(d + w / 2), c = Math.cos(p.angle), s = Math.sin(p.angle);
      const oy = lineTop + (r.size - g.st.size) * ASCENT;
      glyphs.push({ str: g.str, x: p.x, y: p.y, center: false, st: g.st, rot: p.angle, ox: -w / 2, oy });
      for (const [lx, ly] of [[-w / 2, oy], [w / 2, oy], [w / 2, oy + g.st.size], [-w / 2, oy + g.st.size]]) corner(p, c, s, lx, ly);
      d += w + r.gaps[k];
    });
  }
  if (!glyphs.length) return { glyphs, bounds: { x: t.x, y: t.y - base, w: 0, h: r0.size } };
  return { glyphs, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
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

/** Draws a text's glyphs (and outline) in its layout space, under ctx's current transform, warped if it is. */
export function drawText(ctx, t) {
  if (isWarped(t)) return drawWarped(ctx, t);
  ctx.save();
  ctx.textBaseline = 'top';
  const { glyphs } = layoutText(t, measureWith(ctx));
  const look = g => { ctx.font = fontCss(g.st); ctx.textAlign = g.center ? 'center' : 'left'; };
  const put = (g, fn) => {  // a letter on a path is drawn turned about its point on the path
    if (g.rot === undefined) return fn(g.x, g.y);
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    fn(g.ox, g.oy);
    ctx.restore();
  };
  if (t.outline > 0) {  // under the letters, twice as wide, so `outline` px show around them
    ctx.strokeStyle = t.outlineColor;
    ctx.lineWidth = t.outline * 2;
    ctx.lineJoin = 'round';
    for (const g of glyphs) { look(g); put(g, (x, y) => ctx.strokeText(g.str, x, y)); }
  }
  for (const g of glyphs) {
    look(g);
    ctx.fillStyle = g.st.color;
    put(g, (x, y) => ctx.fillText(g.str, x, y));
  }
  ctx.restore();
}

/**
 * A warped text: drawn flat into a scratch canvas (at the scale ctx draws at, so it stays sharp), bent column by
 * column into a second one (each column stretched between the edges warpEdges gives it; whole pixels there, so
 * the columns meet without seams), which is then drawn once under ctx's transform. Both boxes start on whole
 * layout pixels, so straight text lands on the layer's pixels without blurring.
 */
function drawWarped(ctx, t) {
  const flat = { ...t, warp: 'none' }, b = plainBounds(flat, ctx);
  const x0 = Math.floor(b.x), y0 = Math.floor(b.y), W = Math.ceil(b.x + b.w) - x0, H = Math.ceil(b.y + b.h) - y0;
  if (W < 1 || H < 1) return;
  const wb = warpBounds(t, { x: x0, y: y0, w: W, h: H }), Y0 = Math.floor(wb.y), H2 = Math.ceil(wb.y + wb.h) - Y0;
  const m = ctx.getTransform();
  const k = Math.min(Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 0.25), 8, 8192 / W, 8192 / H, 8192 / H2);
  const flatC = document.createElement('canvas'), bent = document.createElement('canvas');
  flatC.width = bent.width = Math.ceil(W * k);
  flatC.height = Math.ceil(H * k);
  bent.height = Math.ceil(H2 * k);
  const fctx = flatC.getContext('2d'), bctx = bent.getContext('2d');
  fctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  drawText(fctx, flat);
  const step = Math.max(1, Math.ceil(flatC.width / 2000));
  for (let i = 0; i < flatC.width; i += step) {
    const sw = Math.min(step, flatC.width - i), [top, bottom] = warpEdges(t.warp, t.bend, (i + sw / 2) / flatC.width, W, H);
    if (bottom - top > 0) bctx.drawImage(flatC, i, 0, sw, flatC.height, i, (y0 + top - Y0) * k, sw, (bottom - top) * k);
  }
  ctx.drawImage(bent, x0, Y0, bent.width / k, bent.height / k);
  flatC.width = flatC.height = bent.width = bent.height = 0;  // free their GPU memory now
}

/** Bounds of a text's letters and outline in its layout space, before any warp. */
function plainBounds(t, ctx) {
  ctx.save();
  const b = layoutText(t, measureWith(ctx)).bounds;
  ctx.restore();
  const o = t.outline || 0;
  return o ? { x: b.x - o, y: b.y - o, w: b.w + 2 * o, h: b.h + 2 * o } : b;
}

/** Bounds of a text layer's text in its layout space (see textMatrix), for clicking on it and placing the editor. */
export function textBounds(t, ctx) {
  const b = plainBounds(t, ctx);
  if (!isWarped(t)) return b;
  const x0 = Math.floor(b.x), y0 = Math.floor(b.y);  // the box drawWarped bends
  return warpBounds(t, { x: x0, y: y0, w: Math.ceil(b.x + b.w) - x0, h: Math.ceil(b.y + b.h) - y0 });
}
