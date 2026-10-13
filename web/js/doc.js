// The artwork: size, paper colour and a stack of raster layers, each with its own canvas.
// Saved as JSON (format 'koe'); each layer's pixels are a PNG data URL. See sanitizeDoc for the format.

export const BLEND_MODES = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];
const BLEND_IDS = new Set(BLEND_MODES.map(m => m[0]));
export const MAX_SIDE = 10000;
export const FORMAT_VERSION = 1;

/** Cleans a loaded or new document description (pure, tested). Never throws; fills defaults for missing fields. */
export function sanitizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const side = n => Math.max(1, Math.min(MAX_SIDE, Math.round(Number(n) || 0))) || 1;
  const layers = (Array.isArray(d.layers) ? d.layers : []).map((l, i) => ({
    name: String(l?.name ?? `Layer ${i + 1}`).slice(0, 100),
    visible: l?.visible !== false,
    opacity: Math.max(0, Math.min(1, Number.isFinite(+l?.opacity) ? +l.opacity : 1)),
    blend: BLEND_IDS.has(l?.blend) ? l.blend : 'source-over',
    alphaLock: !!l?.alphaLock,
    clip: !!l?.clip,
    png: typeof l?.png === 'string' && l.png.startsWith('data:image/png') ? l.png : null,
  }));
  return {
    format: 'koe',
    version: FORMAT_VERSION,
    title: String(d.title || 'Untitled').slice(0, 120),
    width: side(d.width || 1920),
    height: side(d.height || 1080),
    paper: d.paper === null ? null : (/^#[0-9a-f]{6}$/i.test(d.paper) ? d.paper : '#ffffff'),
    active: Math.max(0, Math.min(layers.length - 1, Math.round(Number(d.active) || 0))),
    layers,
  };
}

let nextLayerId = 1;

export class Layer {
  constructor(w, h, props = {}) {
    this.id = nextLayerId++;
    this.name = props.name || 'Layer';
    this.visible = props.visible !== false;
    this.opacity = props.opacity ?? 1;
    this.blend = props.blend || 'source-over';
    this.alphaLock = !!props.alphaLock;
    this.clip = !!props.clip;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.version = 0;      // raised on every pixel change
    this.pngVersion = -1;  // version of the cached PNG below
    this.png = null;
  }
  touch() { this.version++; }
  async toPng() {
    if (this.pngVersion !== this.version) {
      const v = this.version;
      this.png = await canvasToDataUrl(this.canvas);
      this.pngVersion = v;
    }
    return this.png;
  }
}

export function canvasToDataUrl(canvas) {
  return new Promise(resolve => canvas.toBlob(b => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(b);
  }, 'image/png'));
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

export class Doc {
  constructor({ width, height, title = 'Untitled', paper = '#ffffff', id = null }) {
    this.id = id;
    this.title = title;
    this.width = width;
    this.height = height;
    this.paper = paper;
    this.layers = [];  // bottom first
    this.active = 0;
    this.version = 0;  // raised on any change worth saving
  }

  static blank(opts) {
    const d = new Doc(opts);
    d.layers.push(new Layer(d.width, d.height, { name: 'Layer 1' }));
    return d;
  }

  static async fromJSON(raw, id = null) {
    const s = sanitizeDoc(raw);
    const d = new Doc({ ...s, id });
    for (const l of s.layers) {
      const layer = new Layer(d.width, d.height, l);
      if (l.png) {
        layer.ctx.drawImage(await loadImage(l.png), 0, 0);
        layer.png = l.png;
        layer.pngVersion = layer.version;
      }
      d.layers.push(layer);
    }
    if (!d.layers.length) d.layers.push(new Layer(d.width, d.height, { name: 'Layer 1' }));
    d.active = Math.min(s.active, d.layers.length - 1);
    return d;
  }

  async toJSON() {
    const layers = [];
    for (const l of this.layers) {
      layers.push({ name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock, clip: l.clip, png: await l.toPng() });
    }
    return { format: 'koe', version: FORMAT_VERSION, title: this.title, width: this.width, height: this.height, paper: this.paper, active: this.active, layers };
  }

  get layer() { return this.layers[this.active]; }

  newLayerName() {
    const used = new Set(this.layers.map(l => l.name));
    let n = this.layers.length + 1;
    while (used.has(`Layer ${n}`)) n++;
    return `Layer ${n}`;
  }

  /** Flattened image (paper included) as a new canvas, optionally scaled to fit maxSide. */
  flatten(maxSide = 0) {
    const scale = maxSide ? Math.min(1, maxSide / Math.max(this.width, this.height)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(this.width * scale));
    c.height = Math.max(1, Math.round(this.height * scale));
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    composite(ctx, this, { x: 0, y: 0, w: this.width, h: this.height });
    return c;
  }
}

// Scratch canvases reused by composite() (one for a layer with its live stroke, one for a clipping group).
const scratch = {};
function scratchCanvas(key, w, h) {
  let c = scratch[key];
  if (!c) c = scratch[key] = document.createElement('canvas');
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  return [c, ctx];
}

/**
 * Draws the doc's region r (doc pixels) into ctx at the same coordinates (ctx's transform applies on top).
 * live = { layer, canvas, alpha, mode } is a stroke in progress, drawn onto that layer as if already applied.
 * Layers with clip=true are clipped to the nearest non-clipping layer below them, as in other painting programs.
 */
export function composite(ctx, doc, r, live = null) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.clearRect(r.x, r.y, r.w, r.h);
  if (doc.paper) {
    ctx.fillStyle = doc.paper;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  const layers = doc.layers;
  for (let i = 0; i < layers.length; i++) {
    const base = layers[i];
    if (base.clip && i > 0) continue;  // drawn with its base below
    // the base layer and any clipping layers right above it
    let j = i + 1;
    while (j < layers.length && layers[j].clip) j++;
    if (!base.visible) { i = j - 1; continue; }
    if (j === i + 1) {
      drawLayer(ctx, base, r, live, base.opacity, base.blend);
    } else {
      // group: base at full strength, each clipping layer cut to the base's pixels and blended onto it,
      // then the whole group at the base's opacity and blend mode
      const [gc, gctx] = scratchCanvas('group', r.w, r.h);
      gctx.translate(-r.x, -r.y);
      drawLayer(gctx, base, r, live, 1, 'source-over');
      for (let k = i + 1; k < j; k++) {
        const l = layers[k];
        if (!l.visible) continue;
        const [cc, cctx] = scratchCanvas('clip', r.w, r.h);
        cctx.translate(-r.x, -r.y);
        drawLayer(cctx, l, r, live, 1, 'source-over');
        drawLayer(cctx, base, r, live, 1, 'destination-in');
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.globalAlpha = l.opacity;
        gctx.globalCompositeOperation = l.blend;
        gctx.drawImage(cc, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
        gctx.translate(-r.x, -r.y);
      }
      ctx.globalAlpha = base.opacity;
      ctx.globalCompositeOperation = base.blend;
      ctx.drawImage(gc, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      i = j - 1;
    }
  }
  ctx.restore();
}

function drawLayer(ctx, layer, r, live, alpha, blend) {
  let src = layer.canvas, sx = r.x, sy = r.y;
  if (live && live.layer === layer) {
    const [c, lctx] = scratchCanvas('live', r.w, r.h);
    lctx.drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    lctx.globalAlpha = live.alpha;
    lctx.globalCompositeOperation = live.mode;
    lctx.drawImage(live.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    src = c; sx = 0; sy = 0;
  }
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  ctx.drawImage(src, sx, sy, r.w, r.h, r.x, r.y, r.w, r.h);
}
