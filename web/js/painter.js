// Draws brush dabs onto a stroke canvas. Soft brushes use a pre-rendered round tip (a radial gradient in the
// brush colour) scaled to each dab; fully hard brushes draw anti-aliased circles; a tip image (brushtip.js,
// registered with registerTip) is tinted in the brush colour. Any tip can be squashed (thickness), turned
// (angle), turned at random per dab and turned with the stroke's direction. Also makes the texture tiles that
// give a whole stroke a paper grain (textures.js or a texture image; applied in doc.js liveSource), or, with
// grainPressure, the paper height each dab is cut against (grainFor; see Painter.dab).

import { textureTile, grooveAlpha, TILE } from './textures.js';
import { imageRef, bristleDots, flatDots } from './brushtip.js';
import { pixelSpans, dryness, dryDab, DRY_LEVELS } from './brush.js';

const TIP = 128;
const tipImages = new Map();      // image id -> canvas whose alpha is the tip shape
const textureImages = new Map();  // image id -> { gray, w, h }

/** Makes a tip image (a canvas whose alpha is the shape) available to brushes as 'img:<id>'. */
export function registerTip(id, canvas) { tipImages.set(id, canvas); }

/** Makes a texture image (gray values, 255 = paint sticks) available to brushes as 'img:<id>'. */
export function registerTexture(id, gray, w, h) {
  textureImages.set(id, { gray, w, h });
  for (const k of Object.keys(tiles)) if (k.startsWith(`img:${id}:`)) delete tiles[k];
}

export function forgetBrushImage(id) {
  tipImages.delete(id);
  textureImages.delete(id);
}

/** Whether a tip setting names an image that is loaded, or a built-in tip drawn as one (Bristles). */
export function hasTipImage(tip) {
  const id = imageRef(tip);
  return !!id ? tipImages.has(id) : !!builtinTip(tip);
}

const HAIRS = { bristle: bristleDots, flat: flatDots };  // built-in tips made of hairs (brushtip.js)
const hairTips = {};

/** A built-in tip that is drawn like a tip image (a canvas whose alpha is the shape), or null. */
function builtinTip(tip) {
  if (!HAIRS[tip]) return null;
  let c = hairTips[tip];
  if (!c) {
    c = hairTips[tip] = document.createElement('canvas');
    c.width = c.height = TIP;
    const ctx = c.getContext('2d');
    for (const d of HAIRS[tip]()) {
      const x = d.x * TIP, y = d.y * TIP, r = d.r * TIP;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${d.a})`);
      g.addColorStop(0.6, `rgba(0,0,0,${d.a * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  return c;
}

let outlineCache = null;

/**
 * The brush cursor for a tip image: its shape's edge as a thin light line with a dark one outside, drawn for a tip
 * whose longer side is `long` screen px: {canvas, k} (draw it k times its size, centred), or null when the tip is not
 * an image that is loaded. Big sizes go in 4% steps, so resizing the brush does not redraw it on every move.
 */
export function tipOutline(tip, long) {
  const id = imageRef(tip), mask = id && tipImages.get(id);
  if (!mask) return null;
  let L = Math.max(4, Math.min(1200, Math.round(long)));
  if (L > 64) L = Math.round(1.04 ** Math.round(Math.log(L) / Math.log(1.04)));
  const key = `${id}:${L}`;
  if (outlineCache?.key === key) return { canvas: outlineCache.canvas, k: long / L };
  const m = L / Math.max(mask.width, mask.height), w = Math.max(1, Math.round(mask.width * m)), h = Math.max(1, Math.round(mask.height * m));
  const pad = 3, W = w + 2 * pad, H = h + 2 * pad;
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return [c, c.getContext('2d')]; };
  const [shape, sc] = layer();  // the tip at this size, alpha cut at half so the edge is where the paint is
  sc.drawImage(mask, pad, pad, w, h);
  const img = sc.getImageData(0, 0, W, H);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 64 ? 255 : 0;
  sc.putImageData(img, 0, 0);
  const grown = n => {  // the shape grown by n px (drawn shifted in every direction)
    const [c, ctx] = layer();
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (dx * dx + dy * dy <= n * n + 1) ctx.drawImage(shape, dx, dy);
    return [c, ctx];
  };
  const [out, oc] = grown(2);  // dark band 1-2 px outside the edge
  const [one] = grown(1);
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = 'rgba(0,0,0,0.75)';
  oc.fillRect(0, 0, W, H);
  oc.globalCompositeOperation = 'destination-out';
  oc.drawImage(one, 0, 0);
  const [light, lc] = layer();  // light band: the outermost pixel of the shape
  lc.drawImage(one, 0, 0);
  lc.globalCompositeOperation = 'source-in';
  lc.fillStyle = 'rgba(255,255,255,0.9)';
  lc.fillRect(0, 0, W, H);
  lc.globalCompositeOperation = 'destination-out';
  lc.drawImage(shape, 0, 0);
  oc.globalCompositeOperation = 'source-over';
  oc.drawImage(light, 0, 0);
  outlineCache = { key, canvas: out };
  return { canvas: out, k: long / L };
}

export class Painter {
  /** opts: color, hardness, and optionally tip ('round' or 'img:<id>'), thickness (0-1), angle (degrees),
   * random (0-1: share of a half turn either way), follow (turn with the stroke), rnd (random numbers 0-1; a seeded
   * source makes the random turns repeatable, as vector lines need), height ({ctx, k}: Impasto's height canvas, which
   * gets every dab too, in black at k times its density, so the hairs' streaks build up as ridges without saturating). */
  constructor(ctx, { color, hardness, tip = 'round', thickness = 1, angle = 0, random = 0, follow = false, rnd = Math.random, pixel = false, grain = null, height = null, dryOut = 0, dryAt = 1, dryGrain = null, flipX = false, flipY = false, roundJitter = 0 }) {
    this.ctx = ctx;
    this.height = pixel ? null : height;
    this.grain = pixel ? null : grain;  // grainFor(s): every dab is cut against the paper (pressure fills the grooves)
    this.pixel = !!pixel;  // hard pixels (pixel art): whole-pixel round dabs, no soft edge, tip image or turn
    this.color = color;
    this.hardness = hardness;
    this.mask = this.fullMask = tipImages.get(imageRef(tip)) || builtinTip(tip);
    this.image = this.mask ? tinted(this.mask, color) : null;
    this.dryOut = this.mask && !pixel ? Math.max(0, Math.min(1, dryOut || 0)) : 0;  // Runs dry: tip images only
    this.dryAt = dryAt;  // the brush size dryness is measured in
    this.dryLevel = 0;
    this.dryT = 0;
    this.dryGrain = this.dryOut ? dryGrain : null;  // dryGrainFor(s): the texture, showing more as the brush runs dry
    this.hard = !this.image && hardness >= 0.99;
    if (!this.image && !this.hard) this.tip = makeTip(color, hardness);
    this.squash = Math.max(0.05, Math.min(1, thickness));
    this.angle = (angle || 0) * Math.PI / 180;
    this.random = Math.max(0, Math.min(1, random || 0));
    this.follow = !!follow;
    this.rnd = rnd;
    // each dab mirrored at random (Flip jitter) and squashed at random (Roundness jitter), as Photoshop and Procreate do
    this.flipX = !!flipX && !pixel;
    this.flipY = !!flipY && !pixel;
    this.roundJitter = pixel ? 0 : Math.max(0, Math.min(1, roundJitter || 0));
    this.last = [];  // per symmetric copy: last dab position and direction
  }

  /** Paints the next dabs in another colour (colour jitter); the tip is redrawn into its own canvas. */
  setColor(color) {
    if (color === this.color) return;
    this.color = color;
    if (this.image) {
      this.image = tinted(this.mask, color, this.image);
      if (this.small) { const mips = mipsOf(this.mask); this.small = this.small.map((c, i) => tinted(mips[i], color, c)); }
    } else if (!this.hard) this.tip = makeTip(color, this.hardness, this.tip);
  }

  /**
   * Runs dry: sets the tip for a dab d px along the stroke (its weakest parts cut away as the paint gives out, so the
   * strongest hairs streak on alone) and returns the share of its density the dab keeps. 1 when it is off.
   */
  dry(d) {
    if (!this.dryOut) return 1;
    this.dryT = dryness(d, this.dryAt, this.dryOut);
    const { level, flowK } = dryDab(this.dryT);
    if (level !== this.dryLevel) {
      this.dryLevel = level;
      this.mask = dryMask(this.fullMask, level);
      this.image = tinted(this.mask, this.color, this.image);
      this.small = null;
    }
    return flowK;
  }

  /**
   * The tinted tip image to draw a dab of `size` px from: the tip itself, or for a small dab the smallest halved copy
   * still at least that size (mipsOf). Drawn straight down from 128 px or more to a few px, the browser samples a
   * tip's thin hairs here and there, and small strokes of a hairy tip turned into a chain pattern.
   */
  imageAt(size) {
    const mips = mipsOf(this.mask);
    let i = 0;
    while (i + 1 < mips.length && Math.max(mips[i + 1].width, mips[i + 1].height) >= size) i++;
    if (!i) return this.image;
    const small = this.small ||= [];
    return small[i] ||= tinted(mips[i], this.color);
  }

  /** One dab; k numbers the symmetric copy it belongs to, so each copy follows its own direction. With a colour,
   * this dab (and the next ones) take it. dir (radians), when given, turns the tip that way instead of with the
   * stroke (the pen's lean). */
  dab(x, y, size, alpha, k = 0, color = null, dir = null) {
    if (!this.follow || dir !== null || this.pixel) {
      if (color) this.setColor(color);
      this.put(x, y, size, alpha, this.pixel ? 0 : this.angle + (dir ?? 0) + this.jitter());
      return;
    }
    // A tip that turns with the stroke draws its dabs a little behind the pen (startReach: a 25th of its size, 0.5-12
    // px). The first ones wait for the stroke's direction (drawn straight away, the first dab lay along the stroke
    // and a flat tip left a spike), and at pen-up the last ones keep the direction they had (finish), so the little
    // hook a pen makes as it lands or lifts does not swing a rake round across the line's start or end.
    if (color) this.ink = color;
    const l = this.last[k] ||= { held: [], dir: null, x, y, drawn: null }, r = startReach(size);
    const q = { x, y, size, alpha, color: this.ink || this.color, dryT: this.dryT, jit: this.jitter(), dir: l.dir };
    l.held.push(q);
    if (l.dir === null) {
      const p0 = l.held[0];
      if ((x - p0.x) ** 2 + (y - p0.y) ** 2 <= r * r) return;
      l.dir = Math.atan2(y - p0.y, x - p0.x);
      l.x = x; l.y = y;
      for (const h of l.held) h.dir = l.dir;
    } else if ((x - l.x) ** 2 + (y - l.y) ** 2 > 0.25) {
      // evened out; at a corner (the ends would swing CORNER times as far as the pen moved) it turns at once
      const dx = x - l.x, dy = y - l.y, to = smoothDir(l.dir, dx, dy, size);
      q.dir = l.dir = Math.abs(shortTurn(to - l.dir)) * size / 2 > CORNER * Math.hypot(dx, dy) ? Math.atan2(dy, dx) : to;
      l.x = x; l.y = y;
    }
    while (l.held.length && (l.held[0].x - x) ** 2 + (l.held[0].y - y) ** 2 > r * r) this.drawHeld(l, l.held.shift());
  }

  /** A random turn for one dab (Angle jitter), or 0. */
  jitter() {
    return this.random ? (this.rnd() * 2 - 1) * Math.PI * this.random : 0;
  }

  /**
   * Draws one held dab of a tip turning with the stroke. Where the tip turned (or grew / shrank) since the dab before,
   * its ends would move further than the dabs are apart, so dabs are added in between (turnFill): a rake's outer
   * hairs would otherwise break into dots on a curve.
   */
  drawHeld(l, q) {
    if (q.color !== this.color) this.setColor(q.color);
    this.dryT = q.dryT;
    q.half = q.size / 2;
    if (l.drawn && !this.random) for (const f of turnFill(l.drawn, q)) this.put(f.x, f.y, f.half * 2, q.alpha, this.angle + f.dir);
    this.put(q.x, q.y, q.size, q.alpha, this.angle + q.dir + q.jit);
    l.drawn = q;
  }

  /** At pen-up: draws the dabs still held back, in the direction the first of them had (a tap: from its first dab to
   * its last, or straight). */
  finish() {
    this.last.forEach(l => {
      if (!l?.held.length) return;
      const p0 = l.held[0], p1 = l.held[l.held.length - 1];
      const dir = p0.dir ?? ((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 > 0.25 ? Math.atan2(p1.y - p0.y, p1.x - p0.x) : 0);
      for (const q of l.held) { q.dir = dir; this.drawHeld(l, q); }
      l.held = [];
    });
    if (this.ink && this.ink !== this.color) this.setColor(this.ink);
  }

  /** One dab at turn rot (radians), with the paper grain and the impasto height when they are on. */
  put(x, y, size, alpha, rot) {
    if (this.flipX || this.flipY || this.roundJitter) {  // once, so the height canvas gets the same dab
      const sx = this.flipX && this.rnd() < 0.5 ? -1 : 1, sy = this.flipY && this.rnd() < 0.5 ? -1 : 1;
      this.mirror = [sx, sy * (this.roundJitter ? 1 - this.roundJitter * this.rnd() : 1)];
    } else this.mirror = null;
    if (this.grain) this.grainDab(x, y, size, alpha, rot, this.grain);
    // running dry on a texture: a loaded brush covers it, a drying one reaches less deep and the grooves show more.
    // The grain comes in only once the hairs have started to drop out, and never fully, so the dry end is streaks
    // broken by the grain rather than an even speckle
    else if (this.dryGrain && this.dryT > DRY_GRAIN_FROM) this.grainDab(x, y, size, alpha, rot, this.dryGrain, 1 - 0.3 * this.dryT, 0.75 * (this.dryT - DRY_GRAIN_FROM) / (1 - DRY_GRAIN_FROM));
    else this.draw(this.ctx, x, y, size, alpha, rot);
    if (this.height) this.draw(this.height.ctx, x, y, size, alpha * this.height.k, rot);
  }

  /**
   * A dab cut against the paper: the tip's alpha t times how deep the dab reaches (sqrt of its density a as a share
   * of the brush's full density F, so it follows the pressure and not the Density setting), minus the groove depth
   * d of the doc-anchored texture times the grain amount g, laid down at density a: a * max(0, t * sqrt(a / F) -
   * g * d). A light touch marks only the tops of the tooth, and faintly; a firm one fills the grooves too. A low
   * Density keeps the ~1/spacing dabs over each point from piling a light line up to black on the tooth tops, so
   * it stays grey, as graphite does. Since every dab leaves the same grooves empty, overlapping dabs build up
   * density on the tooth without filling the grain in. The subtraction is done on the GPU:
   * xor with an opaque fill turns alpha x into 1 - x, 'lighter' adds the groove, and a second xor turns it back.
   * Runs dry passes its own `depth` (instead of the pressure's) and `grooveK` (how much of the groove is cut).
   */
  grainDab(x, y, size, alpha, rot, grain, depth = null, grooveK = 1) {
    const reach = size * 0.75 + 2;  // half the diagonal of a turned tip, and a margin
    const x0 = Math.floor(x - reach), y0 = Math.floor(y - reach), n = Math.ceil(2 * reach) + 1;
    const c = grainScratch ||= document.createElement('canvas');
    if (c.width < n || c.height < n) c.width = c.height = Math.max(n, 64);
    const g = c.getContext('2d'), { tile, scale } = grain;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, n, n);
    const a = Math.max(0, Math.min(1, alpha));
    this.draw(g, x - x0, y - y0, size, depth ?? Math.sqrt(Math.min(1, a / (grain.full || 1))), rot);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'xor';
    g.fillRect(0, 0, n, n);
    if (!tile.pattern) tile.pattern = g.createPattern(tile, 'repeat');
    tile.pattern.setTransform(new DOMMatrix().translateSelf(-x0, -y0).scaleSelf(scale));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = grooveK;
    g.fillStyle = tile.pattern;
    g.fillRect(0, 0, n, n);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'xor';
    g.fillStyle = '#000';
    g.fillRect(0, 0, n, n);
    g.globalCompositeOperation = 'source-in';  // the colour was lost on the way: fill it back in
    g.fillStyle = this.color;
    g.fillRect(0, 0, n, n);
    g.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = a;
    this.ctx.drawImage(c, 0, 0, n, n, x0, y0, n, n);
  }

  /** Draws one dab onto ctx at density alpha, turned rot radians. */
  draw(ctx, x, y, size, alpha, rot) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (this.pixel) {
      ctx.fillStyle = this.color;
      for (const [x0, y0, w] of pixelSpans(x, y, size)) ctx.fillRect(x0, y0, w, 1);
      return;
    }
    const m = this.mirror;
    if (!this.image && !rot && this.squash === 1 && !m) {
      if (this.hard) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.35, size / 2), 0, Math.PI * 2);
        ctx.fill();
      } else ctx.drawImage(this.tip, x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (this.squash < 1) ctx.scale(1, this.squash);
    if (m) ctx.scale(m[0], m[1]);
    if (this.image) {  // the longer side of the image is the brush size
      const img = this.imageAt(size), { width: w, height: h } = img, m = size / Math.max(w, h);
      ctx.drawImage(img, -w * m / 2, -h * m / 2, w * m, h * m);
    } else if (this.hard) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.35, size / 2), 0, Math.PI * 2);
      ctx.fill();
    } else ctx.drawImage(this.tip, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

}

/** How far the pen must move before a tip of `size` px that turns with the stroke takes its direction. */
export function startReach(size) {
  return Math.max(0.5, Math.min(12, size / 25));
}

/**
 * The stroke's direction after a move of (dx, dy) from a dab, turned from the last direction `dir` (radians): the
 * move counts fully once it is as long as the stretch the direction is averaged over (a 50th of the tip's size,
 * 0.5-20 px). Taken from each move alone, a pen's pixel steps made a big tip swing a few degrees from dab to dab,
 * and a rake's outer hairs jumped about into dashes.
 */
export function smoothDir(dir, dx, dy, size) {
  const d = Math.hypot(dx, dy);
  if (!d) return dir;
  const w = Math.min(1, d / Math.max(0.5, Math.min(20, size / 50)));
  const vx = Math.cos(dir) * (1 - w) + dx / d * w, vy = Math.sin(dir) * (1 - w) + dy / d * w;
  return vx * vx + vy * vy < 1e-12 ? Math.atan2(dy, dx) : Math.atan2(vy, vx);
}

const CORNER = 20;  // how many times further than the middle a tip's ends may swing before it counts as a corner

/** A turn (radians) taken the short way round: -pi to pi. */
export function shortTurn(a) {
  a %= 2 * Math.PI;
  return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
}

/**
 * Dabs to add between dab `a` and dab `b` ({x, y, dir, half: how far the tip reaches from its middle}) so that the
 * tip's ends never move further between two dabs, by turning or growing / shrinking, than its middle does (and at
 * least 1 px): positions, directions and reaches in between, evenly spaced, the turn taken the short way round. At
 * most 48, so a sharp turn of a huge tip stays quick; none for the turn at a corner.
 */
export function turnFill(a, b) {
  let turn = shortTurn(b.dir - a.dir);
  const step = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  // a corner (the ends swinging more than CORNER times as far as the middle moves): the tip turns at once, as in
  // Photoshop, and its hairs cross over; filled in, it swept a solid bar across the stroke
  if (Math.abs(turn) * Math.max(a.half, b.half) > CORNER * step) turn = 0;
  const n = Math.min(48, Math.ceil((Math.abs(turn) * Math.max(a.half, b.half) + Math.abs(b.half - a.half)) / step));
  const out = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: a.dir + turn * t, half: a.half + (b.half - a.half) * t });
  }
  return out;
}

const dryMasks = new WeakMap();  // tip mask -> its dry levels (dryMask)
const DRY_GRAIN_FROM = 0.2;  // how dry a brush is before the texture shows (Painter.put)

/**
 * A tip mask at dry level `level` (0 = as it is): alpha a becomes (a - t) / (1 - t), t up to 65% at the driest, so
 * the weak hairs and thin parts of the tip drop out first and the strong ones are left to streak on.
 */
function dryMask(mask, level) {
  if (!level) return mask;
  let levels = dryMasks.get(mask);
  if (!levels) dryMasks.set(mask, levels = []);
  if (!levels[level]) {
    const w = mask.width, h = mask.height, t = 0.65 * level / (DRY_LEVELS - 1);
    const src = mask.getContext('2d').getImageData(0, 0, w, h), out = new ImageData(w, h);
    for (let i = 3; i < src.data.length; i += 4) out.data[i] = Math.max(0, Math.round((src.data[i] / 255 - t) / (1 - t) * 255));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(out, 0, 0);
    levels[level] = c;
  }
  return levels[level];
}

const tipMips = new WeakMap();  // tip mask -> [mask, its halves down to 4 px]

/** A tip mask and copies of it halved step by step (each an average of 2 x 2 pixels), down to 4 px on the longer side. */
function mipsOf(mask) {
  let mips = tipMips.get(mask);
  if (!mips) {
    mips = [mask];
    for (let c = mask; Math.max(c.width, c.height) > 8;) {
      const n = document.createElement('canvas');
      n.width = Math.max(1, Math.ceil(c.width / 2)); n.height = Math.max(1, Math.ceil(c.height / 2));
      const g = n.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'low';  // halving exactly: bilinear is the 2 x 2 average
      g.drawImage(c, 0, 0, c.width, c.height, 0, 0, c.width / 2, c.height / 2);
      mips.push(n);
      c = n;
    }
    tipMips.set(mask, mips);
  }
  return mips;
}

/** The tip shape filled with the brush colour (into canvas c when given). */
function tinted(mask, color, c = document.createElement('canvas')) {
  const ctx = c.getContext('2d');
  if (c.width !== mask.width || c.height !== mask.height) { c.width = mask.width; c.height = mask.height; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, c.width, c.height); }  // reused for the next colour
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}

function makeTip(color, hardness, c = document.createElement('canvas')) {
  const ctx = c.getContext('2d');
  if (c.width !== TIP || c.height !== TIP) c.width = c.height = TIP;
  else ctx.clearRect(0, 0, TIP, TIP);
  const g = ctx.createRadialGradient(TIP / 2, TIP / 2, 0, TIP / 2, TIP / 2, TIP / 2);
  const solid = Math.max(0, Math.min(0.98, hardness));
  g.addColorStop(0, color);
  g.addColorStop(solid, color);
  // ease out to transparent (a few stops approximate a smooth falloff)
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const a = Math.pow(1 - t, 2);
    g.addColorStop(solid + (1 - solid) * t, withAlpha(color, a));
  }
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TIP, TIP);
  return c;
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
}

const tiles = {};
let grainScratch = null;

/** The live.texture for a paint tool's settings, or null: a tile canvas whose alpha is what the grain removes. With
 * grainPressure the dabs carry the grain themselves (grainFor), so the stroke as a whole gets none. */
export function textureFor(s) {
  if (s.grainPressure || dryGrainFor(s)) return null;
  return grainTile(s);
}

/** The live.wet for a paint tool's settings, or null: how much of the stroke's middle drains to its edge (0-1), and
 * how far in from the edge the paint gathers (the blur that finds the edge, in px: a sixth of the brush size). */
export function wetFor(s) {
  return s.wetEdges > 0 && !s.pixel ? { amount: Math.min(1, s.wetEdges), blur: Math.max(1, Math.min(40, (s.size || 1) / 6)) } : null;
}

/** How much of each dab's density goes into Impasto's height canvas (Painter `height`). */
export const HEIGHT_SHARE = 0.25;

/**
 * The live.impasto for a paint tool's settings, or null: how strongly the paint's ridges are lit and shaded (0-1),
 * how far the light looks across them (depth, px: a thirtieth of the size, 1-4), and the height canvas the stroke's
 * Painter stamps (null: the stroke's own density is the height).
 */
export function impastoFor(s, canvas = null) {
  return s.impasto > 0 && !s.pixel ? { amount: Math.min(1, s.impasto), depth: Math.max(1, Math.min(5, (s.size || 1) / 20)), canvas } : null;
}

/** Impasto's height canvas c at w x h, cleared in r (all of it when r is left out), as a Painter `height`. */
export function heightFor(c, w, h, r = null) {
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (r) ctx.clearRect(r.x, r.y, r.w, r.h); else ctx.clearRect(0, 0, w, h);
  return { ctx, k: HEIGHT_SHARE };
}

/** Painter's `dryGrain` for settings with Runs dry: their texture then shows as the brush runs dry (in the dabs),
 * not over the whole stroke. */
export function dryGrainFor(s) {
  return s.dryOut > 0 && !s.grainPressure && !s.pixel ? grainTile(s) : null;
}

/** Painter's `grain` for settings with grainPressure: the texture tile (alpha: groove depth times the grain amount),
 * its scale, and the brush's full density (a dab at it reaches the bottom of the grain). */
export function grainFor(s) {
  return s.grainPressure && !s.pixel ? grainTile(s) : null;
}

function grainTile(s) {
  if (!s.texture || s.texture === 'none' || !(s.textureAmount > 0)) return null;
  const key = `${s.texture}:${s.textureAmount}:${s.textureInvert ? 1 : 0}`;
  if (!tiles[key]) {
    const id = imageRef(s.texture), img = id ? textureImages.get(id) : null;
    const gray = img ? img.gray : textureTile(s.texture);
    if (!gray) return null;
    const w = img ? img.w : TILE, h = img ? img.h : TILE;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const data = new ImageData(w, h);
    for (let i = 0; i < gray.length; i++) data.data[i * 4 + 3] = grooveAlpha(s.textureInvert ? 255 - gray[i] : gray[i], s.textureAmount);
    c.getContext('2d').putImageData(data, 0, 0);
    tiles[key] = c;
  }
  return { tile: tiles[key], scale: s.textureScale || 1, full: s.flow > 0 ? s.flow : 1 };
}
