// Draws brush dabs onto a stroke canvas. Soft brushes use a pre-rendered round tip (a radial gradient in the
// brush colour) scaled to each dab; fully hard brushes draw anti-aliased circles; a tip image (brushtip.js,
// registered with registerTip) is tinted in the brush colour. Any tip can be squashed (thickness), turned
// (angle), turned at random per dab and turned with the stroke's direction. Also makes the texture tiles that
// give a whole stroke a paper grain (textures.js or a texture image; applied in doc.js liveSource), or, with
// grainPressure, the paper height each dab is cut against (grainFor; see Painter.dab).

import { textureTile, grooveAlpha, TILE } from './textures.js';
import { imageRef, bristleDots, flatDots } from './brushtip.js';
import { pixelSpans, dryness, dryDab, DRY_LEVELS } from './brush.js';
import { applyTextureMode, textureValueAt } from './texmodes.js';

const TIP = 128;
const tipImages = new Map();      // image id -> canvas whose alpha is the tip shape
const textureImages = new Map();  // image id -> { gray, w, h }

/** Makes a tip image (a canvas whose alpha is the shape) available to brushes as 'img:<id>'. */
export function registerTip(id, canvas) { tipImages.set(id, canvas); }

/** Makes a texture image (gray values, 255 = paint sticks) available to brushes as 'img:<id>'. */
export function registerTexture(id, gray, w, h) {
  textureImages.set(id, { gray, w, h });
  for (const k of Object.keys(tiles)) if (k.startsWith(`img:${id}:`)) delete tiles[k];
  for (const k of Object.keys(values)) if (k.startsWith(`img:${id}:`)) delete values[k];
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
   * gets every dab too, in black at k times its density, so the hairs' streaks build up as ridges without saturating),
   * strength ({ctx}: strengthFor, Pressure → grain on a stroke-wide texture: each dab stamps grainK there, which
   * liveSource weighs the texture by), copy ({ctx}: copyFor, a texture mode other than Multiply on the whole stroke:
   * every dab is drawn there too, in memory, for liveSource to work the mode out from), texDab (textureDabFor:
   * Texture each dab, every dab worked out with its texture mode on its own). grainK (grainAt) is set before each
   * dab and scales any texture it carries. */
  constructor(ctx, { color, hardness, tip = 'round', thickness = 1, angle = 0, random = 0, follow = false, rnd = Math.random, pixel = false, grain = null, height = null, strength = null, copy = null, texDab = null, dryOut = 0, dryAt = 1, dryGrain = null, flipX = false, flipY = false, roundJitter = 0 }) {
    this.ctx = ctx;
    this.height = pixel ? null : height;
    this.strength = strength;
    this.copy = copy;
    this.texDab = pixel ? null : texDab;
    this.grainK = 1;
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
   * stroke (the pen's lean). at ({x, y}), when given, is where the dab lay on the stroke before Scatter moved it: a
   * tip turning with the stroke follows those points, as Photoshop does (the scattered dabs zigzag, and a fur tip
   * turned every which way). */
  dab(x, y, size, alpha, k = 0, color = null, dir = null, at = null) {
    if (color) this.setColor(color);
    const hx = at ? at.x : x, hy = at ? at.y : y;
    // a tip that turns with the stroke waits for the stroke's direction: drawn straight away, the first dab lies
    // along the stroke and a flat tip leaves a spike at its start
    if (this.follow && dir === null && !this.pixel && !this.last[k]?.known) {
      const l = this.last[k] ||= { pending: [] }, p0 = l.pending[0];
      if (!p0 || (hx - p0.hx) ** 2 + (hy - p0.hy) ** 2 <= 0.25) { l.pending.push({ x, y, hx, hy, size, alpha, color: this.color, dryT: this.dryT, grainK: this.grainK }); return; }
      this.last[k] = { x: hx, y: hy, dir: Math.atan2(hy - p0.hy, hx - p0.hx), known: true };
      this.drawPending(l.pending, k);
    }
    this.put(x, y, size, alpha, this.pixel ? 0 : this.rotation(hx, hy, k, dir));
  }

  /** Draws the dabs held back until the stroke's direction was known (copy k's direction, or 0 for a tap). */
  drawPending(pending, k) {
    const color = this.color, dryT = this.dryT, grainK = this.grainK;
    for (const p of pending) {
      this.setColor(p.color);
      this.dryT = p.dryT;
      this.grainK = p.grainK;
      // in the direction found (worked out from these dabs, it pointed back from the next one: the first dab drawn back to front)
      this.put(p.x, p.y, p.size, p.alpha, this.rotation(p.hx, p.hy, k, this.last[k]?.known ? this.last[k].dir : 0));
    }
    this.setColor(color);
    this.dryT = dryT;
    this.grainK = grainK;
  }

  /** At pen-up: draws dabs still waiting for a direction (a tap, or a stroke that never moved half a pixel). */
  finish() {
    this.last.forEach((l, k) => { if (l?.pending?.length) { this.drawPending(l.pending, k); l.pending = []; } });
  }

  /** One dab at turn rot (radians), with the paper grain and the impasto height when they are on. */
  put(x, y, size, alpha, rot) {
    if (this.flipX || this.flipY || this.roundJitter) {  // once, so the height canvas gets the same dab
      const sx = this.flipX && this.rnd() < 0.5 ? -1 : 1, sy = this.flipY && this.rnd() < 0.5 ? -1 : 1;
      this.mirror = [sx, sy * (this.roundJitter ? 1 - this.roundJitter * this.rnd() : 1)];
    } else this.mirror = null;
    if (this.grain) this.grainDab(x, y, size, alpha, rot, this.grain, null, this.grainK);
    else if (this.texDab) this.modeDab(x, y, size, alpha, rot);
    // running dry on a texture: a loaded brush covers it, a drying one reaches less deep and the grooves show more.
    // The grain comes in only once the hairs have started to drop out, and never fully, so the dry end is streaks
    // broken by the grain rather than an even speckle
    else if (this.dryGrain && this.dryT > DRY_GRAIN_FROM) this.grainDab(x, y, size, alpha, rot, this.dryGrain, 1 - 0.3 * this.dryT, 0.75 * this.grainK * (this.dryT - DRY_GRAIN_FROM) / (1 - DRY_GRAIN_FROM));
    else this.draw(this.ctx, x, y, size, alpha, rot);
    if (this.height) this.draw(this.height.ctx, x, y, size, alpha * this.height.k, rot);
    if (this.copy) this.draw(this.copy.ctx, x, y, size, alpha, rot);
    if (this.strength) {  // the newest dab's strength replaces what lies under it (round, wide enough for a turned tip)
      // cut out, then added: at an anti-aliased edge of coverage e that is s (1 - e) + k e, an even blend; source-over
      // there gives less than both, and the edges of the overlapping circles showed as a fine mesh in the grain
      const c = this.strength.ctx;
      c.beginPath();
      c.arc(x, y, size * 0.75 + 1, 0, Math.PI * 2);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'destination-out';
      c.fill();
      c.globalAlpha = Math.max(0, Math.min(1, this.grainK));
      c.globalCompositeOperation = 'lighter';
      c.fill();
      c.globalCompositeOperation = 'source-over';
    }
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

  /**
   * Texture each dab (CLIP STUDIO's Apply by each plot): the dab is drawn into a small canvas in memory, its density
   * worked out pixel by pixel with the texture mode (texmodes.js) against the doc-anchored texture, and laid down.
   * Pen → grain scales the texture density per dab (grainK).
   */
  modeDab(x, y, size, alpha, rot) {
    const reach = size * 0.75 + 2;
    const x0 = Math.floor(x - reach), y0 = Math.floor(y - reach), n = Math.ceil(2 * reach) + 1;
    const c = modeScratch ||= memoryCanvas();
    if (c.width < n || c.height < n) c.width = c.height = Math.max(n, 64);
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, n, n);
    this.draw(g, x - x0, y - y0, size, alpha, rot);
    const img = g.getImageData(0, 0, n, n), { mode, D, values: v } = this.texDab;
    applyTextureMode(img.data, mode, D * Math.max(0, Math.min(1, this.grainK)), i => textureValueAt(v, x0 + i % n, y0 + (i / n | 0)));
    g.putImageData(img, 0, 0);
    this.ctx.globalAlpha = 1;
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

  rotation(x, y, k, dir = null) {
    let a = this.angle;
    if (dir !== null) a += dir;
    else if (this.follow) {
      const l = this.last[k];
      if (l?.known) {
        const dx = x - l.x, dy = y - l.y;
        if (dx * dx + dy * dy > 0.25) { l.dir = Math.atan2(dy, dx); l.x = x; l.y = y; }
        a += l.dir;
      }
    }
    if (this.random) a += (this.rnd() * 2 - 1) * Math.PI * this.random;
    return a;
  }
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
const values = {};
let grainScratch = null, modeScratch = null;

/** A canvas kept in memory (read back often, never drawn on the GPU): for the texture modes worked out per pixel. */
function memoryCanvas() {
  const c = document.createElement('canvas');
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/**
 * The live.texture for a paint tool's settings, or null: a tile canvas whose alpha is what the grain removes. With
 * grainPressure or Texture each dab the dabs carry the grain themselves (grainFor, textureDabFor), so the stroke as
 * a whole gets none. `canvases` (an object the caller keeps, e.g. the editor's) holds the canvases it needs: with
 * Pen → grain (texturePressure) `strength` (alpha: how much of the grain shows, stamped by the Painter: give it to the
 * Painter through strengthFor); with a texture mode other than Multiply `cpu` = {mode, D, values, copy}, the mode
 * worked out per pixel by liveSource from `copy`, a copy of the stroke kept in memory (copyFor). Without `canvases`
 * every mode is drawn as Multiply.
 */
export function textureFor(s, canvases = null) {
  if (s.grainPressure || textureDabFor(s) || dryGrainFor(s)) return null;
  const t = grainTile(s);
  if (!t || !canvases) return t;
  const mode = s.textureMode || 'multiply';
  if (mode === 'multiply') return s.texturePressure ? { ...t, strength: canvases.strength ||= document.createElement('canvas') } : t;
  const strength = s.texturePressure ? canvases.cpuStrength ||= memoryCanvas() : null;
  return { ...t, strength, cpu: { mode, D: s.textureAmount, values: grainValues(s), copy: canvases.copy ||= memoryCanvas() } };
}

/** Painter's `copy` for a live.texture worked out per pixel (textureFor's `cpu`), cleared in r (or all of it). */
export function copyFor(texture, w, h, r = null) {
  return texture?.cpu ? { ctx: heightFor(texture.cpu.copy, w, h, r).ctx } : null;
}

/** Painter's `texDab` for settings with Texture each dab: {mode, D, values}, or null. Grain by pressure goes first. */
export function textureDabFor(s) {
  if (!s.textureEachDab || s.grainPressure || s.pixel || !grainTile(s)) return null;
  return { mode: s.textureMode || 'multiply', D: s.textureAmount, values: grainValues(s) };
}

/** The texture of settings s as values 0-255 (how much paint it lets through, after Invert texture) with its size and
 * scale ({gray, w, h, scale}), for the texture modes (texmodes.js textureValueAt). Kept per texture. */
function grainValues(s) {
  const key = `${s.texture}:${s.textureInvert ? 1 : 0}`;
  if (!values[key]) {
    const id = imageRef(s.texture), img = id ? textureImages.get(id) : null;
    const gray = img ? img.gray : textureTile(s.texture);
    if (!gray) return null;
    values[key] = { gray: s.textureInvert ? Uint8Array.from(gray, g => 255 - g) : gray, w: img ? img.w : TILE, h: img ? img.h : TILE };
  }
  return { ...values[key], scale: s.textureScale || 1 };
}

/** Painter's `strength` for a live.texture that has one (textureFor), cleared in r (all of it when r is left out). */
export function strengthFor(texture, w, h, r = null) {
  return texture?.strength ? { ctx: heightFor(texture.strength, w, h, r).ctx } : null;
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
  return s.dryOut > 0 && !s.grainPressure && !s.textureEachDab && !s.pixel ? grainTile(s) : null;
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
