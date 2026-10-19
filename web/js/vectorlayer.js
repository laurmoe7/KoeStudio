// Drawing a vector layer's lines into its pixels (see vector.js for the data). Each line is dabbed into a scratch
// canvas with the brush it was drawn with, given its texture grain, and laid onto the layer at its opacity, as a
// pen stroke is committed; so a line looks the same drawn live and redrawn from the data.

import { liveSource } from './doc.js';
import { Painter, textureFor, grainFor } from './painter.js';
import { stampAt } from './brush.js';
import { strokeBounds, strokeStamps, dualStamps, seeded, brushOf } from './vector.js';
import { clip } from './rect.js';

let scratch = null, dualScratch = null;

/** Redraws the layer's lines inside rect (doc px; the whole layer when null), clearing that area first. */
export function renderVector(layer, rect = null) {
  const v = layer.vector, W = layer.canvas.width, H = layer.canvas.height;
  const r = clip(rect || { x: 0, y: 0, w: W, h: H }, W, H);
  if (!v || !r) return;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H; }
  const sctx = scratch.getContext('2d'), ctx = layer.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  for (const s of v.strokes) {
    const b = brushOf(v, s), q = clip(strokeBounds(s, b), W, H);
    const a = q && clip({ x: Math.max(q.x, r.x), y: Math.max(q.y, r.y), w: Math.min(q.x + q.w, r.x + r.w) - Math.max(q.x, r.x), h: Math.min(q.y + q.h, r.y + r.h) - Math.max(q.y, r.y) }, W, H);
    if (!a || a.w <= 0 || a.h <= 0) continue;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(q.x, q.y, q.w, q.h);
    const painter = new Painter(sctx, { color: s.color, hardness: b.hardness, tip: b.tip, thickness: b.thickness, angle: b.tipAngle, pixel: b.pixel,
      random: b.tipRandom, follow: b.tipFollow, rnd: seeded(s.seed + 7), grain: grainFor(b) });
    for (const st of strokeStamps(s, b)) {
      const { size, flow } = stampAt(b, st.p);
      painter.dab(st.x, st.y, size * st.k, flow * st.f, 0, st.c, st.a ?? null);
    }
    let dual = null;
    if (b.dualTip !== 'none') {  // the dual brush: the line shows only where its second tip lands
      dual = dualScratch ||= document.createElement('canvas');
      if (dual.width !== W || dual.height !== H) { dual.width = W; dual.height = H; }
      const dctx = dual.getContext('2d');
      dctx.clearRect(q.x, q.y, q.w, q.h);
      const dp = new Painter(dctx, { color: '#000000', hardness: b.hardness, tip: b.dualTip });
      for (const st of dualStamps(s, b)) dp.dab(st.x, st.y, st.size, 1);
    }
    const [src, sx, sy] = liveSource({ canvas: scratch, texture: textureFor(b), dual }, a);
    ctx.globalAlpha = s.opacity;
    ctx.drawImage(src, sx, sy, a.w, a.h, a.x, a.y, a.w, a.h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  layer.touch();
}
