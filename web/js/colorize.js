// Colorize from hints (pure, tested): flat colours for line art from a few scribbles, in the spirit of Clip Studio
// Paint's Edit → Colorize → Use hint image. The line art (reference layers) splits the canvas into shapes; each
// shape takes the hint colour scribbled in it (a shape with several hint colours, e.g. where a line has a gap, is
// shared between them by distance), closed shapes without a hint take the colour of the shapes round them, and the
// colour runs under the lines so no white seams show. Shapes touching the canvas edge without a hint (the
// background) stay clear.

import { isLinePixel } from './fill.js';
import { hsvToRgb } from './color.js';

/** A hint colour counts in a shape when at least this share of the shape's hint pixels has it (strays are ignored). */
export const HINT_SHARE = 0.2;
/** How far (px) colour runs into the lines from the shapes on either side. */
export const UNDER_LINES = 8;

/**
 * ref: the reference line art, hint: the hint layer (both RGBA, w × h). Returns RGBA with the flat colours
 * (opaque where coloured, clear elsewhere), or null when the hint layer has no colour on open (non-line) pixels.
 * opts.fillUnhinted (default true): closed shapes without hints take their neighbours' colour.
 */
export function colorize(ref, hint, w, h, opts = {}) {
  const N = w * h, fillUnhinted = opts.fillUnhinted !== false, under = opts.under ?? UNDER_LINES;
  const line = new Uint8Array(N);
  for (let i = 0; i < N; i++) line[i] = isLinePixel(ref, i) ? 1 : 0;
  const { label, count, edge } = labelShapes(line, w, h);

  // hint colours per shape: palette indices, tallied
  const palette = [], pIndex = new Map(), tally = new Map();  // tally key: shape * 2^24 + colour index
  const hintCol = new Int32Array(N).fill(-1), perShape = new Uint32Array(count);
  for (let i = 0; i < N; i++) {
    if (line[i] || hint[i * 4 + 3] < 128) continue;
    const rgb = (hint[i * 4] << 16) | (hint[i * 4 + 1] << 8) | hint[i * 4 + 2];
    let c = pIndex.get(rgb);
    if (c === undefined) { c = palette.length; palette.push(rgb); pIndex.set(rgb, c); }
    hintCol[i] = c;
    const k = label[i] * 2 ** 24 + c;
    tally.set(k, (tally.get(k) || 0) + 1);
    perShape[label[i]]++;
  }
  if (!palette.length) return null;
  const counts = new Set();  // shape * 2^24 + colour for the colours that count in their shape
  for (const [k, n] of tally) if (n >= perShape[Math.floor(k / 2 ** 24)] * HINT_SHARE) counts.add(k);

  // 1. each hinted shape: every pixel the colour of the nearest hint that counts there
  const col = new Int32Array(N).fill(-1), dist = new Int32Array(N);
  const src = [];
  for (let i = 0; i < N; i++) if (hintCol[i] >= 0 && counts.has(label[i] * 2 ** 24 + hintCol[i])) { col[i] = hintCol[i]; src.push(i); }
  spread(col, dist, src, w, h, (i, from) => !line[i] && label[i] === label[from], Infinity);
  return finishColors(col, line, label, count, edge, w, h, palette, fillUnhinted, under);
}

/**
 * The common end of colorize and autoColorize: col holds a palette index per coloured pixel (-1 elsewhere). Closed
 * shapes still without colour take it from the shapes round them (when fillUnhinted), the colour runs `under` px
 * into the lines, and the result comes back as RGBA.
 */
function finishColors(col, line, label, count, edge, w, h, palette, fillUnhinted, under) {
  const N = w * h, dist = new Int32Array(N);
  // 2. closed shapes without hints: the colour reaching most of their pixels from the shapes round them
  if (fillUnhinted) {
    const colored = new Uint8Array(count);
    for (let i = 0; i < N; i++) if (col[i] >= 0) colored[label[i]] = 1;
    const open = s => !colored[s] && !edge[s];
    const reach = col.slice(), d2 = new Int32Array(N), src2 = [];
    for (let i = 0; i < N; i++) if (reach[i] >= 0) src2.push(i);
    spread(reach, d2, src2, w, h, i => line[i] || open(label[i]), Infinity);
    const votes = new Map();  // shape * 2^24 + colour → pixels
    for (let i = 0; i < N; i++) {
      if (line[i] || !open(label[i]) || reach[i] < 0) continue;
      const k = label[i] * 2 ** 24 + reach[i];
      votes.set(k, (votes.get(k) || 0) + 1);
    }
    const best = new Map();
    for (const [k, n] of votes) {
      const s = Math.floor(k / 2 ** 24);
      if (!best.has(s) || n > best.get(s)[1]) best.set(s, [k - s * 2 ** 24, n]);
    }
    for (let i = 0; i < N; i++) if (!line[i] && best.has(label[i]) && open(label[i])) col[i] = best.get(label[i])[0];
  }

  // 3. under the lines, from the coloured shapes on either side
  const src3 = [];
  for (let i = 0; i < N; i++) { if (col[i] >= 0) { src3.push(i); dist[i] = 0; } }
  spread(col, dist, src3, w, h, i => line[i] === 1, under);

  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    if (col[i] < 0) continue;
    const rgb = palette[col[i]];
    out[i * 4] = rgb >> 16; out[i * 4 + 1] = (rgb >> 8) & 255; out[i * 4 + 2] = rgb & 255; out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * The connected open (non-line) areas, 4-connected: label (the shape of each pixel; line pixels all get one extra
 * label that is no shape), count (shapes, that extra one included), edge (1 for shapes touching the canvas edge).
 */
export function labelShapes(line, w, h) {
  const N = w * h, label = new Int32Array(N).fill(-1), stack = new Int32Array(N);
  const edges = [];
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (line[s] || label[s] >= 0) continue;
    let top = 0, touches = 0;
    stack[top++] = s; label[s] = count;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = 1;
      if (x > 0 && !line[i - 1] && label[i - 1] < 0) { label[i - 1] = count; stack[top++] = i - 1; }
      if (x < w - 1 && !line[i + 1] && label[i + 1] < 0) { label[i + 1] = count; stack[top++] = i + 1; }
      if (y > 0 && !line[i - w] && label[i - w] < 0) { label[i - w] = count; stack[top++] = i - w; }
      if (y < h - 1 && !line[i + w] && label[i + w] < 0) { label[i + w] = count; stack[top++] = i + w; }
    }
    edges.push(touches);
    count++;
  }
  // line pixels get the label `count` (no shape), so lookups with it stay in range
  for (let i = 0; i < N; i++) if (label[i] < 0) label[i] = count;
  edges.push(0);
  return { label, count: count + 1, edge: Uint8Array.from(edges) };
}

/**
 * Breadth-first spread of col from the source pixels to pixels pass(i, from) allows, up to maxDist steps
 * (4-connected); a pixel takes the colour of the source that reaches it first. dist holds the steps taken.
 */
function spread(col, dist, sources, w, h, pass, maxDist) {
  const N = w * h, queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (const i of sources) { queue[tail++] = i; dist[i] = 0; }
  while (head < tail) {
    const i = queue[head++], x = i % w, d = dist[i] + 1;
    if (d > maxDist) continue;
    const visit = j => {
      if (col[j] >= 0 || !pass(j, i)) return;
      col[j] = col[i]; dist[j] = d; queue[tail++] = j;
    };
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < N - w) visit(i + w);
  }
}

/** Colour schemes for Colorize's "pick colours for me" ([id, label]); 'palette' uses the Color panel's palette. */
export const SCHEMES = [['harmony', 'Harmony (neighbouring hues)'], ['complement', 'Complementary'], ['triad', 'Three hues'], ['pastel', 'Pastel'], ['palette', 'My palette']];
/** Shapes smaller than this share of the canvas (or 4 px) get no colour of their own: they take it from round them. */
export const MIN_SHAPE = 0.0005;

/** A small seeded random generator (mulberry32): the same seed gives the same colours. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The colours a scheme gives for a seed, as 0xrrggbb; 'palette' takes `own` ('#rrggbb' list) and needs two. */
export function schemeColors(scheme, seed, own = []) {
  if (scheme === 'palette') {
    const out = own.filter(c => /^#[0-9a-f]{6}$/i.test(c)).map(c => parseInt(c.slice(1), 16));
    return out.length >= 2 ? out : null;
  }
  const rnd = seeded(seed), base = rnd() * 360;
  const hues = {
    harmony: [0, -18, 18, -36, 36, 9],
    complement: [0, 180, 15, 195, -15, 165],
    triad: [0, 120, 240, 20, 140, 260],
    pastel: [0, 60, 120, 180, 240, 300],
  }[scheme] || [0, -18, 18, -36, 36, 9];
  return hues.map(dh => {
    const pastel = scheme === 'pastel';
    const sat = pastel ? 0.18 + rnd() * 0.15 : 0.32 + rnd() * 0.38, val = pastel ? 0.93 + rnd() * 0.06 : 0.68 + rnd() * 0.28;
    const [r, g, b] = hsvToRgb(base + dh, sat, val);
    return (r << 16) | (g << 8) | b;
  });
}

/**
 * Which shapes touch across a line: the shapes are grown into the lines (at most reach px) and where two meet they
 * are neighbours. Returns an array of Sets, one per shape label.
 */
export function shapeNeighbours(line, label, count, w, h, reach = 12) {
  const N = w * h, grown = new Int32Array(N), dist = new Int32Array(N), src = [];
  for (let i = 0; i < N; i++) {
    grown[i] = line[i] ? -1 : label[i];
    if (!line[i]) src.push(i);
  }
  spread(grown, dist, src, w, h, i => line[i] === 1, reach);
  const out = Array.from({ length: count }, () => new Set());
  const meet = (a, b) => { if (a >= 0 && b >= 0 && a !== b) { out[a].add(b); out[b].add(a); } };
  for (let i = 0; i < N; i++) {
    if (i % w < w - 1) meet(grown[i], grown[i + 1]);
    if (i < N - w) meet(grown[i], grown[i + w]);
  }
  return out;
}

/**
 * Colorize without hints: every closed shape of the line art gets a colour of the scheme, biggest shapes first,
 * each taking the colour its neighbours use least (then the one used least so far), so touching shapes differ.
 * Small shapes and the lines are filled as in colorize; shapes touching the canvas edge (the background) stay clear.
 * opts: {scheme, seed, own (palette for 'palette'), under}. Returns RGBA, or null when there is no closed shape
 * (or too few palette colours).
 */
export function autoColorize(ref, w, h, opts = {}) {
  const N = w * h, under = opts.under ?? UNDER_LINES;
  const colors = schemeColors(opts.scheme || 'harmony', opts.seed ?? 1, opts.own);
  if (!colors) return null;
  const line = new Uint8Array(N);
  for (let i = 0; i < N; i++) line[i] = isLinePixel(ref, i) ? 1 : 0;
  const { label, count, edge } = labelShapes(line, w, h);
  const size = new Uint32Array(count);
  for (let i = 0; i < N; i++) if (!line[i]) size[label[i]]++;
  const min = Math.max(4, N * MIN_SHAPE);
  const big = [];
  for (let s = 0; s < count - 1; s++) if (!edge[s] && size[s] >= min) big.push(s);
  if (!big.length) return null;
  big.sort((a, b) => size[b] - size[a] || a - b);
  const near = shapeNeighbours(line, label, count, w, h);
  const pick = new Int32Array(count).fill(-1), used = new Uint32Array(colors.length);
  for (const s of big) {
    let best = 0, score = Infinity;
    for (let c = 0; c < colors.length; c++) {
      let clash = 0;
      for (const n of near[s]) if (pick[n] === c) clash++;
      const sc = clash * 1e6 + used[c];
      if (sc < score) { score = sc; best = c; }
    }
    pick[s] = best;
    used[best]++;
  }
  const col = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (!line[i] && pick[label[i]] >= 0) col[i] = pick[label[i]];
  return finishColors(col, line, label, count, edge, w, h, colors, true, under);
}
