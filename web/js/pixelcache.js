// A layer's pixels in memory while a tool changes them dab by dab (pure, tested). Reading pixels back from a
// GPU canvas (getImageData) makes the browser finish all its queued drawing first, so doing it for every dab made
// Smudge, Liquify and the retouch tools stutter. The cache reads the layer once per tile, the first time a dab
// touches it, keeps the dabs' results in memory, and writes the changed tiles back in one go per pointer move.
// It also keeps each tile as it was when first read, so the undo step needs no readback at pen-up.

export const TILE = 256;
const CLEAR = new Uint8ClampedArray(4);

export class PixelCache {
  /**
   * W x H: the image size. read(x, y, w, h) gives those pixels as RGBA bytes (called once per tile).
   */
  constructor(W, H, read, tile = TILE) {
    this.W = W; this.H = H; this.read = read; this.tile = tile;
    this.tiles = new Map();
  }

  /** The tile at tile column tx, row ty (read when first needed). */
  at(tx, ty) {
    const key = ty * 65536 + tx;
    let t = this.tiles.get(key);
    if (!t) {
      const T = this.tile, x = tx * T, y = ty * T, w = Math.min(T, this.W - x), h = Math.min(T, this.H - y);
      const data = new Uint8ClampedArray(this.read(x, y, w, h));
      t = { x, y, w, h, data, before: new Uint8ClampedArray(data), dirty: false };
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Copies between the tiles and a w x h patch at (x, y): into the patch, or (write) from it, marking tiles dirty. */
  each(x, y, w, h, patch, mode) {
    const T = this.tile, x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.W, x + w), y1 = Math.min(this.H, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    for (let ty = Math.floor(y0 / T); ty * T < y1; ty++) {
      for (let tx = Math.floor(x0 / T); tx * T < x1; tx++) {
        const t = this.at(tx, ty), src = mode === 'before' ? t.before : t.data;
        const ax = Math.max(x0, t.x), bx = Math.min(x1, t.x + t.w), n = (bx - ax) * 4;
        for (let yy = Math.max(y0, t.y); yy < Math.min(y1, t.y + t.h); yy++) {
          const ti = ((yy - t.y) * t.w + ax - t.x) * 4, pi = ((yy - y) * w + ax - x) * 4;
          if (mode === 'write') t.data.set(patch.subarray(pi, pi + n), ti);
          else patch.set(src.subarray(ti, ti + n), pi);
        }
        if (mode === 'write') t.dirty = true;
      }
    }
  }

  /** The w x h pixels at (x, y) as they are now; outside the image they are clear (as getImageData gives them). */
  get(x, y, w, h) { const p = new Uint8ClampedArray(w * h * 4); this.each(x, y, w, h, p, 'data'); return p; }

  /** One pixel [r, g, b, a] as it is now (clear outside the image); a view into the cache, not a copy. */
  pixel(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return CLEAR;
    const t = this.at(Math.floor(x / this.tile), Math.floor(y / this.tile)), i = ((y - t.y) * t.w + x - t.x) * 4;
    return t.data.subarray(i, i + 4);
  }

  /** The same pixels as they were before the tool changed them. */
  getBefore(x, y, w, h) { const p = new Uint8ClampedArray(w * h * 4); this.each(x, y, w, h, p, 'before'); return p; }

  /** Stores a changed w x h patch at (x, y) (parts outside the image are dropped). */
  set(x, y, w, h, patch) { this.each(x, y, w, h, patch, 'write'); }

  /** Hands every changed tile to put(x, y, w, h, data) once, e.g. to putImageData it onto the layer. */
  flush(put) {
    for (const t of this.tiles.values()) if (t.dirty) { put(t.x, t.y, t.w, t.h, t.data); t.dirty = false; }
  }
}
