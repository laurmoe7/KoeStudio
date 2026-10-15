// Draws brush dabs onto a stroke canvas. Soft brushes use a pre-rendered round tip (a radial gradient in the
// brush colour) scaled to each dab; fully hard brushes draw anti-aliased circles; a tip image (brushtip.js,
// registered with registerTip) is tinted in the brush colour. Any tip can be squashed (thickness), turned
// (angle), turned at random per dab and turned with the stroke's direction. Also makes the texture tiles that
// give a whole stroke a paper grain (textures.js or a texture image; applied in doc.js liveSource).

import { textureTile, grooveAlpha, TILE } from './textures.js';
import { imageRef } from './brushtip.js';

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

/** Whether a tip setting names an image that is loaded. */
export function hasTipImage(tip) {
  const id = imageRef(tip);
  return !!id && tipImages.has(id);
}

export class Painter {
  /** opts: color, hardness, and optionally tip ('round' or 'img:<id>'), thickness (0-1), angle (degrees),
   * random (0-1: share of a half turn either way), follow (turn with the stroke), rnd (random numbers 0-1; a seeded
   * source makes the random turns repeatable, as vector lines need). */
  constructor(ctx, { color, hardness, tip = 'round', thickness = 1, angle = 0, random = 0, follow = false, rnd = Math.random }) {
    this.ctx = ctx;
    this.color = color;
    const mask = tipImages.get(imageRef(tip));
    this.image = mask ? tinted(mask, color) : null;
    this.hard = !this.image && hardness >= 0.99;
    if (!this.image && !this.hard) this.tip = makeTip(color, hardness);
    this.squash = Math.max(0.05, Math.min(1, thickness));
    this.angle = (angle || 0) * Math.PI / 180;
    this.random = Math.max(0, Math.min(1, random || 0));
    this.follow = !!follow;
    this.rnd = rnd;
    this.last = [];  // per symmetric copy: last dab position and direction
  }

  /** One dab; k numbers the symmetric copy it belongs to, so each copy follows its own direction. */
  dab(x, y, size, alpha, k = 0) {
    const ctx = this.ctx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    const rot = this.rotation(x, y, k);
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

  rotation(x, y, k) {
    let a = this.angle;
    if (this.follow) {
      const l = this.last[k] ||= { x, y, dir: 0 };
      const dx = x - l.x, dy = y - l.y;
      if (dx * dx + dy * dy > 0.25) { l.dir = Math.atan2(dy, dx); l.x = x; l.y = y; }
      a += l.dir;
    }
    if (this.random) a += (this.rnd() * 2 - 1) * Math.PI * this.random;
    return a;
  }
}

/** The tip shape filled with the brush colour. */
function tinted(mask, color) {
  const c = document.createElement('canvas');
  c.width = mask.width; c.height = mask.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}

function makeTip(color, hardness) {
  const c = document.createElement('canvas');
  c.width = c.height = TIP;
  const ctx = c.getContext('2d');
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

/** The live.texture for a paint tool's settings, or null: a tile canvas whose alpha is what the grain removes. */
export function textureFor(s) {
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
