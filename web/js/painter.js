// Draws brush dabs onto a stroke canvas. Soft brushes use a pre-rendered round tip (a radial gradient in the
// brush colour) scaled to each dab; fully hard brushes draw anti-aliased circles; a tip image (brushtip.js,
// registered with registerTip) is tinted in the brush colour. Any tip can be squashed (thickness), turned
// (angle), turned at random per dab and turned with the stroke's direction. Also makes the texture tiles that
// give a whole stroke a paper grain (textures.js or a texture image; applied in doc.js liveSource), or, with
// grainPressure, the paper height each dab is cut against (grainFor; see Painter.dab).

import { textureTile, grooveAlpha, TILE } from './textures.js';
import { imageRef, bristleDots } from './brushtip.js';
import { pixelSpans } from './brush.js';

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

let bristleTip = null;

/** A built-in tip that is drawn like a tip image (a canvas whose alpha is the shape), or null. */
function builtinTip(tip) {
  if (tip !== 'bristle') return null;
  if (!bristleTip) {
    bristleTip = document.createElement('canvas');
    bristleTip.width = bristleTip.height = TIP;
    const ctx = bristleTip.getContext('2d');
    for (const d of bristleDots()) {
      const x = d.x * TIP, y = d.y * TIP, r = d.r * TIP;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${d.a})`);
      g.addColorStop(0.6, `rgba(0,0,0,${d.a * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  return bristleTip;
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
   * source makes the random turns repeatable, as vector lines need). */
  constructor(ctx, { color, hardness, tip = 'round', thickness = 1, angle = 0, random = 0, follow = false, rnd = Math.random, pixel = false, grain = null }) {
    this.ctx = ctx;
    this.grain = pixel ? null : grain;  // grainFor(s): every dab is cut against the paper (pressure fills the grooves)
    this.pixel = !!pixel;  // hard pixels (pixel art): whole-pixel round dabs, no soft edge, tip image or turn
    this.color = color;
    this.hardness = hardness;
    this.mask = tipImages.get(imageRef(tip)) || builtinTip(tip);
    this.image = this.mask ? tinted(this.mask, color) : null;
    this.hard = !this.image && hardness >= 0.99;
    if (!this.image && !this.hard) this.tip = makeTip(color, hardness);
    this.squash = Math.max(0.05, Math.min(1, thickness));
    this.angle = (angle || 0) * Math.PI / 180;
    this.random = Math.max(0, Math.min(1, random || 0));
    this.follow = !!follow;
    this.rnd = rnd;
    this.last = [];  // per symmetric copy: last dab position and direction
  }

  /** Paints the next dabs in another colour (colour jitter); the tip is redrawn into its own canvas. */
  setColor(color) {
    if (color === this.color) return;
    this.color = color;
    if (this.image) this.image = tinted(this.mask, color, this.image);
    else if (!this.hard) this.tip = makeTip(color, this.hardness, this.tip);
  }

  /** One dab; k numbers the symmetric copy it belongs to, so each copy follows its own direction. With a colour,
   * this dab (and the next ones) take it. dir (radians), when given, turns the tip that way instead of with the
   * stroke (the pen's lean). */
  dab(x, y, size, alpha, k = 0, color = null, dir = null) {
    if (color) this.setColor(color);
    if (this.grain) return this.grainDab(x, y, size, alpha, k, dir);
    this.draw(this.ctx, x, y, size, alpha, k, dir);
  }

  /**
   * A dab cut against the paper: the tip's alpha t times how deep the dab reaches (sqrt of its density a, which
   * follows the pressure), minus the groove depth d of the doc-anchored texture times the grain amount g, laid down
   * at density a: a * max(0, t * sqrt(a) - g * d). A light touch marks only the tops of the tooth, and faintly; a
   * firm one fills the grooves too. Since every dab leaves the same grooves empty, overlapping dabs build up
   * density on the tooth without filling the grain in. The subtraction is done on the GPU:
   * xor with an opaque fill turns alpha x into 1 - x, 'lighter' adds the groove, and a second xor turns it back.
   */
  grainDab(x, y, size, alpha, k, dir) {
    const reach = size * 0.75 + 2;  // half the diagonal of a turned tip, and a margin
    const x0 = Math.floor(x - reach), y0 = Math.floor(y - reach), n = Math.ceil(2 * reach) + 1;
    const c = grainScratch ||= document.createElement('canvas');
    if (c.width < n || c.height < n) c.width = c.height = Math.max(n, 64);
    const g = c.getContext('2d'), { tile, scale } = this.grain;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, n, n);
    const a = Math.max(0, Math.min(1, alpha));
    this.draw(g, x - x0, y - y0, size, Math.sqrt(a), k, dir);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'xor';
    g.fillRect(0, 0, n, n);
    if (!tile.pattern) tile.pattern = g.createPattern(tile, 'repeat');
    tile.pattern.setTransform(new DOMMatrix().translateSelf(-x0, -y0).scaleSelf(scale));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = tile.pattern;
    g.fillRect(0, 0, n, n);
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

  /** Draws one dab onto ctx at density alpha. */
  draw(ctx, x, y, size, alpha, k, dir) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (this.pixel) {
      ctx.fillStyle = this.color;
      for (const [x0, y0, w] of pixelSpans(x, y, size)) ctx.fillRect(x0, y0, w, 1);
      return;
    }
    const rot = this.rotation(x, y, k, dir);
    if (!this.image && !rot && this.squash === 1) {
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
    if (this.image) {  // the longer side of the image is the brush size
      const { width: w, height: h } = this.image, m = size / Math.max(w, h);
      ctx.drawImage(this.image, -w * m / 2, -h * m / 2, w * m, h * m);
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
      const l = this.last[k] ||= { x, y, dir: 0 };
      const dx = x - l.x, dy = y - l.y;
      if (dx * dx + dy * dy > 0.25) { l.dir = Math.atan2(dy, dx); l.x = x; l.y = y; }
      a += l.dir;
    }
    if (this.random) a += (this.rnd() * 2 - 1) * Math.PI * this.random;
    return a;
  }
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
  if (s.grainPressure) return null;
  return grainTile(s);
}

/** Painter's `grain` for settings with grainPressure: the texture tile (alpha: groove depth times the grain amount). */
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
  return { tile: tiles[key], scale: s.textureScale || 1 };
}
