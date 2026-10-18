// The artwork's resolution (dots per inch; pure, tested): how big it prints. It never changes the pixels; exports
// carry it in the file (PNG pHYs chunk, JPEG JFIF density, BMP header) so other programs print it at that size.

export const DPI_MIN = 1, DPI_MAX = 2400, DEFAULT_DPI = 72;
const CM_PER_INCH = 2.54;

/** A dpi value as saved: a whole number in range, DEFAULT_DPI for anything else. */
export function sanitizeDpi(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= DPI_MIN ? Math.min(DPI_MAX, n) : DEFAULT_DPI;
}

/** The printed size of w x h px at dpi, in 'cm' or 'in'. */
export function printSize(w, h, dpi, unit = 'cm') {
  const k = (unit === 'in' ? 1 : CM_PER_INCH) / sanitizeDpi(dpi);
  return { w: w * k, h: h * k };
}

/** "21.0 × 29.7 cm (8.27 × 11.69 in)" for w x h px at dpi. */
export function printLabel(w, h, dpi) {
  const cm = printSize(w, h, dpi, 'cm'), inch = printSize(w, h, dpi, 'in');
  return `${cm.w.toFixed(1)} × ${cm.h.toFixed(1)} cm (${inch.w.toFixed(2)} × ${inch.h.toFixed(2)} in)`;
}

/** Pixels per metre for a dpi (as PNG and BMP store it). */
export const dpiToPpm = dpi => Math.round(sanitizeDpi(dpi) / 0.0254);

// ---------- writing the resolution into files ----------

let crcTable = null;
function crc32(bytes, start, end) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be32 = (a, i, v) => { a[i] = (v >>> 24) & 255; a[i + 1] = (v >>> 16) & 255; a[i + 2] = (v >>> 8) & 255; a[i + 3] = v & 255; };
const rd32 = (a, i) => ((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0;

/**
 * A PNG (Uint8Array) with a pHYs chunk for dpi right after IHDR, replacing any pHYs it had. Anything that is not
 * a PNG comes back unchanged.
 */
export function pngWithDpi(png, dpi) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  const parts = [png.subarray(0, 33)];  // signature and IHDR (8 + 25 bytes)
  const phys = new Uint8Array(21);
  be32(phys, 0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4);  // 'pHYs'
  const ppm = dpiToPpm(dpi);
  be32(phys, 8, ppm); be32(phys, 12, ppm);
  phys[16] = 1;  // unit: metre
  be32(phys, 17, crc32(phys, 4, 17));
  parts.push(phys);
  for (let i = 33; i + 12 <= png.length;) {
    const n = rd32(png, i), end = i + 12 + n;
    const kind = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
    if (kind !== 'pHYs') parts.push(png.subarray(i, Math.min(end, png.length)));
    i = end;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * A JPEG (Uint8Array) whose JFIF header says dpi (density unit 1 = dots per inch), changed in place in a copy.
 * A JPEG without a JFIF APP0 segment straight after the start marker comes back unchanged.
 */
export function jpegWithDpi(jpg, dpi) {
  const jfif = jpg.length > 18 && jpg[0] === 0xff && jpg[1] === 0xd8 && jpg[2] === 0xff && jpg[3] === 0xe0 &&
    jpg[6] === 0x4a && jpg[7] === 0x46 && jpg[8] === 0x49 && jpg[9] === 0x46 && jpg[10] === 0;
  if (!jfif) return jpg;
  const out = jpg.slice(), d = sanitizeDpi(dpi);
  out[13] = 1;
  out[14] = d >> 8; out[15] = d & 255;
  out[16] = d >> 8; out[17] = d & 255;
  return out;
}
