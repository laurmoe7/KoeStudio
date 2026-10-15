// Pure image encoders for export: TGA, BMP and GIF from RGBA pixels (straight alpha, as getImageData gives).
// PNG, JPEG and WebP come from the canvas itself (see EXPORT_FORMATS).

/** Formats offered by Export as…. `canvas` ones use canvas.toBlob(mime); the others use `encode`. */
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', note: 'Lossless, keeps transparency.' },
  { id: 'jpg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', note: 'Small files, no transparency (flattened on white).', flatten: true },
  { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', note: 'Small files, keeps transparency.' },
  { id: 'gif', label: 'GIF', ext: 'gif', mime: 'image/gif', note: 'Up to 256 colours, on/off transparency.' },
  { id: 'tga', label: 'TGA (Targa)', ext: 'tga', mime: 'image/x-tga', note: 'Uncompressed, keeps transparency.' },
  { id: 'bmp', label: 'BMP', ext: 'bmp', mime: 'image/bmp', note: 'Uncompressed, keeps transparency.' },
];
export const EXPORT_BY_ID = Object.fromEntries(EXPORT_FORMATS.map(f => [f.id, f]));

const u16 = (a, i, v) => { a[i] = v & 255; a[i + 1] = (v >> 8) & 255; };
const u32 = (a, i, v) => { a[i] = v & 255; a[i + 1] = (v >>> 8) & 255; a[i + 2] = (v >>> 16) & 255; a[i + 3] = (v >>> 24) & 255; };

/** Uncompressed 32-bit true-colour Targa (type 2), top-left origin, 8 alpha bits, with the TGA 2.0 footer. */
export function encodeTga(rgba, w, h) {
  const foot = 'TRUEVISION-XFILE.\0';
  const out = new Uint8Array(18 + w * h * 4 + 8 + foot.length);
  out[2] = 2;
  u16(out, 12, w); u16(out, 14, h);
  out[16] = 32;
  out[17] = 0x28;  // 8 alpha bits, origin top-left
  let o = 18;
  for (let i = 0; i < w * h * 4; i += 4) {
    out[o++] = rgba[i + 2]; out[o++] = rgba[i + 1]; out[o++] = rgba[i]; out[o++] = rgba[i + 3];
  }
  o += 8;  // extension and developer area offsets stay 0
  for (let i = 0; i < foot.length; i++) out[o++] = foot.charCodeAt(i);
  return out;
}

/** 32-bit BMP with a BITMAPV4HEADER so the alpha channel is declared; rows bottom-up. */
export function encodeBmp(rgba, w, h) {
  const head = 14 + 108, size = head + w * h * 4;
  const out = new Uint8Array(size);
  out[0] = 0x42; out[1] = 0x4d;
  u32(out, 2, size); u32(out, 10, head);
  u32(out, 14, 108); u32(out, 18, w); u32(out, 22, h);
  u16(out, 26, 1); u16(out, 28, 32);
  u32(out, 30, 3);  // BI_BITFIELDS
  u32(out, 34, w * h * 4);
  u32(out, 38, 2835); u32(out, 42, 2835);
  u32(out, 54, 0x00ff0000); u32(out, 58, 0x0000ff00); u32(out, 62, 0x000000ff); u32(out, 66, 0xff000000);
  out[70] = 0x20; out[71] = 0x6e; out[72] = 0x69; out[73] = 0x57;  // 'Win ' colour space
  let o = head;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = rgba[i + 2]; out[o++] = rgba[i + 1]; out[o++] = rgba[i]; out[o++] = rgba[i + 3];
    }
  }
  return out;
}

/**
 * Median-cut palette of up to `max` colours over the pixels with alpha >= 128.
 * Colours are first binned to 5 bits per channel so big images stay fast. Returns {palette: [[r,g,b]...], index}
 * where index(r, g, b) gives the nearest palette entry.
 */
export function quantize(rgba, max = 256) {
  const hist = new Uint32Array(32768);
  const sum = [new Float64Array(32768), new Float64Array(32768), new Float64Array(32768)];  // true colour sums, so pure white stays white
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const k = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    hist[k]++;
    sum[0][k] += rgba[i]; sum[1][k] += rgba[i + 1]; sum[2][k] += rgba[i + 2];
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
  const chan = [k => k >> 10, k => (k >> 5) & 31, k => k & 31];
  let boxes = [bins];
  while (boxes.length < max) {
    let bi = -1, best = 0, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const k of b) { const v = chan[c](k); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => chan[bc](p) - chan[bc](q));
    let total = 0;
    for (const k of b) total += hist[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += hist[b[i]]; cut = i + 1; if (acc * 2 >= total) break; }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const palette = boxes.filter(b => b.length).map(b => {
    let n = 0, r = 0, g = 0, bl = 0;
    for (const k of b) { n += hist[k]; r += sum[0][k]; g += sum[1][k]; bl += sum[2][k]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
  const cache = new Int16Array(32768).fill(-1);
  const index = (r, g, b) => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[k] >= 0) return cache[k];
    let best = 0, bd = Infinity;
    palette.forEach((p, i) => {
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return (cache[k] = best);
  };
  return { palette, index };
}

/** GIF-flavoured LZW over palette indices (`minBits` = initial code size - 1 bits per pixel, at least 2). Returns the code bytes. */
export function lzwEncode(indices, minBits) {
  const clear = 1 << minBits, end = clear + 1;
  const bytes = [];
  let buf = 0, nbuf = 0;
  const put = (code, size) => {
    buf |= code << nbuf; nbuf += size;
    while (nbuf >= 8) { bytes.push(buf & 255); buf >>>= 8; nbuf -= 8; }
  };
  const table = new Int32Array(4096 << 8);
  let size = minBits + 1, next = end + 1;
  table.fill(-1);
  put(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = (prefix << 8) | c;
    if (table[key] >= 0) { prefix = table[key]; continue; }
    put(prefix, size);
    if (next < 4096) {
      table[key] = next++;
      if (next > (1 << size) && size < 12) size++;
    } else {
      put(clear, size);
      table.fill(-1);
      size = minBits + 1; next = end + 1;
    }
    prefix = c;
  }
  put(prefix, size);
  put(end, size);
  if (nbuf) bytes.push(buf & 255);
  return bytes;
}

/** Single-frame GIF89a. Pixels under 50% alpha become the transparent colour, the rest are quantized to 255/256 colours. */
export function encodeGif(rgba, w, h) {
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 128) { transparent = true; break; }
  const { palette, index } = quantize(rgba, transparent ? 255 : 256);
  const entries = palette.length + (transparent ? 1 : 0);
  let bits = 1;
  while ((1 << bits) < entries) bits++;
  const transIndex = palette.length;
  const idx = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
    idx[p] = rgba[i + 3] < 128 ? transIndex : index(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0x80 | (bits - 1), 0, 0];
  for (let i = 0; i < 1 << bits; i++) out.push(...(palette[i] || [0, 0, 0]));
  if (transparent) out.push(0x21, 0xf9, 4, 1, 0, 0, transIndex, 0);
  out.push(0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0);
  const minBits = Math.max(2, bits);
  out.push(minBits);
  const data = lzwEncode(idx, minBits);
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(data[i + j]);
  }
  out.push(0, 0x3b);
  return Uint8Array.from(out);
}

/** Encodes RGBA pixels as the given non-canvas format id ('tga', 'bmp', 'gif'). */
export function encodePixels(format, rgba, w, h) {
  if (format === 'tga') return encodeTga(rgba, w, h);
  if (format === 'bmp') return encodeBmp(rgba, w, h);
  if (format === 'gif') return encodeGif(rgba, w, h);
  throw new Error('Unknown format ' + format);
}
