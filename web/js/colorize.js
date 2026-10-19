// Colorize from hints (pure, tested): flat colours for line art from a few scribbles, in the spirit of Clip Studio
// Paint's Edit → Colorize → Use hint image. The line art (reference layers) splits the canvas into shapes; each
// shape takes the hint colour scribbled in it (a shape with several hint colours, e.g. where a line has a gap, is
// shared between them by distance), closed shapes without a hint take the colour of the shapes round them, and the
// colour runs under the lines so no white seams show. Shapes touching the canvas edge without a hint (the
// background) stay clear.

import { isLinePixel } from './fill.js';

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
