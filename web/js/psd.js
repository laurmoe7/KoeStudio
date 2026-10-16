// Photoshop PSD files (pure, tested): writing a layered picture for other programs (Photoshop, Clip Studio Paint,
// Krita, GIMP, Procreate…) and reading one back in. 8-bit RGB only, which is what those programs write by default.
//
// The model both sides use:
//   { width, height, layers: [node, ...] (bottom first), composite: RGBA bytes of the whole picture (optional) }
//   node = { name, visible, opacity (0-1), blend (a KoeStudio blend id, or 'pass-through' for folders), clip,
//            folder: true, open, children: [node, ...], mask }                                   a folder
//        | { name, visible, opacity, blend, clip, x, y, w, h, rgba (w * h * 4 bytes),
//            mask: { x, y, w, h, data (w * h bytes, 255 = shown), outside (0 or 255), enabled } | null }  a layer
// Folders are stored the Photoshop way: an end marker ("</Layer group>", lsct 3) below the folder's layers and the
// folder's own record (lsct 1 or 2) above them.

const BLEND_KEYS = {
  'source-over': 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite',
  'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff',
  exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', 'pass-through': 'pass',
};
const BLEND_IDS = Object.fromEntries(Object.entries(BLEND_KEYS).map(([id, key]) => [key, id]));
// modes KoeStudio does not have, read as the closest one it does
Object.assign(BLEND_IDS, { lddg: 'screen', lbrn: 'multiply', dkCl: 'darken', lgCl: 'lighten', vLit: 'overlay', lLit: 'overlay', pLit: 'overlay', hMix: 'hard-light', fsub: 'difference', fdiv: 'color-dodge', diss: 'source-over' });

export const MAX_PSD_SIDE = 30000;

// ---------- PackBits (the RLE in PSD files) ----------

/** One row of bytes, PackBits-compressed: runs of 2-128 equal bytes as (1 - n, byte), the rest as (n - 1, bytes). */
export function packBits(row) {
  const out = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) { out.push(257 - run, row[i]); i += run; continue; }  // 257 - run is (1 - run) as a byte
    let lit = 1;
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && row[i + lit] === row[i + lit + 1])) lit++;
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(row[i + k]);
    i += lit;
  }
  return out;
}

/** n bytes unpacked from PackBits data starting at src[pos]; returns [bytes, position after them]. */
export function unpackBits(src, pos, n) {
  const out = new Uint8Array(n);
  let o = 0;
  while (o < n && pos < src.length) {
    const h = src[pos++];
    if (h < 128) { const len = Math.min(h + 1, n - o); out.set(src.subarray(pos, pos + len), o); o += len; pos += h + 1; }
    else if (h > 128) { const len = Math.min(257 - h, n - o); out.fill(src[pos++], o, o + len); o += len; }
    // 128 is a no-op
  }
  return [out, pos];
}

// ---------- writing ----------

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  room(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  u8(v) { this.room(1); this.buf[this.len++] = v & 255; }
  u16(v) { this.u8(v >> 8); this.u8(v); }
  i16(v) { this.u16(v & 0xffff); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  i32(v) { this.u32(v >>> 0); }
  ascii(s) { for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(b) { this.room(b.length); this.buf.set(b, this.len); this.len += b.length; }
  /** Writes a placeholder length (u32) and returns a function that fills it in with the bytes written since. */
  lengthHere() {
    const at = this.len;
    this.u32(0);
    return (pad = 1) => {
      while ((this.len - at - 4) % pad) this.u8(0);
      const n = this.len - at - 4;
      this.buf[at] = n >>> 24; this.buf[at + 1] = (n >>> 16) & 255; this.buf[at + 2] = (n >>> 8) & 255; this.buf[at + 3] = n & 255;
    };
  }
  result() { return this.buf.slice(0, this.len); }
}

/** One channel's rows, RLE-compressed: {counts: [bytes per row], data: [...]}. plane is w * h bytes. */
function rleChannel(plane, w, h) {
  const counts = [], data = [];
  for (let y = 0; y < h; y++) {
    const packed = packBits(plane.subarray(y * w, y * w + w));
    counts.push(packed.length);
    for (const b of packed) data.push(b);
  }
  return { counts, data };
}

/** Channel data of a layer as stored in the file: compression 1 (RLE), the row counts, the rows. */
function channelBytes(plane, w, h) {
  const wr = new Writer();
  if (!w || !h) { wr.u16(0); return wr.result(); }  // empty: raw, nothing
  const { counts, data } = rleChannel(plane, w, h);
  wr.u16(1);
  for (const c of counts) wr.u16(c);
  wr.bytes(Uint8Array.from(data));
  return wr.result();
}

const planeOf = (rgba, n, c) => { const p = new Uint8Array(n); for (let i = 0; i < n; i++) p[i] = rgba[i * 4 + c]; return p; };

/** A Pascal string padded to a multiple of 4 (with its length byte); non-ASCII letters become '?'. */
function pascalName(wr, name) {
  const s = [...name].slice(0, 255).map(c => (c.charCodeAt(0) < 128 ? c : '?')).join('');
  wr.u8(s.length);
  wr.ascii(s);
  for (let k = (1 + s.length) % 4; k && k < 4; k++) wr.u8(0);
}

/** The layers bottom first as flat PSD records: folders become an end marker, their contents, then themselves. */
function flatRecords(nodes, out = []) {
  for (const n of nodes) {
    if (n.folder) {
      out.push({ divider: 3, name: '</Layer group>', visible: true, opacity: 1, blend: 'source-over' });
      flatRecords(n.children, out);
      out.push({ ...n, divider: n.open === false ? 2 : 1 });
    } else out.push(n);
  }
  return out;
}

/** The PSD file (Uint8Array) for the model described at the top. */
export function encodePsd({ width, height, layers, composite }) {
  const wr = new Writer();
  wr.ascii('8BPS'); wr.u16(1); for (let i = 0; i < 6; i++) wr.u8(0);
  wr.u16(3); wr.u32(height); wr.u32(width); wr.u16(8); wr.u16(3);  // RGB channels, 8 bits, RGB mode
  wr.u32(0);  // colour mode data
  wr.u32(0);  // image resources
  const records = flatRecords(layers);
  const endSection = wr.lengthHere();
  const endInfo = wr.lengthHere();
  wr.i16(records.length);
  const channelData = [];
  for (const r of records) {
    const isLayer = !r.divider && r.w > 0 && r.h > 0;
    const x = isLayer ? r.x : 0, y = isLayer ? r.y : 0, w = isLayer ? r.w : 0, h = isLayer ? r.h : 0, n = w * h;
    const chans = [[-1, 3], [0, 0], [1, 1], [2, 2]].map(([id, c]) => [id, channelBytes(isLayer ? planeOf(r.rgba, n, c) : new Uint8Array(0), w, h)]);
    const m = r.divider !== 3 && r.mask && r.mask.w > 0 && r.mask.h > 0 ? r.mask : null;  // layers and folders can have one
    if (m) chans.push([-2, channelBytes(m.data, m.w, m.h)]);
    wr.i32(y); wr.i32(x); wr.i32(y + h); wr.i32(x + w);
    wr.u16(chans.length);
    for (const [id, bytes] of chans) { wr.i16(id); wr.u32(bytes.length); }
    wr.ascii('8BIM');
    wr.ascii(r.divider === 3 ? 'norm' : BLEND_KEYS[r.blend] || 'norm');
    wr.u8(Math.round(Math.max(0, Math.min(1, r.opacity ?? 1)) * 255));
    wr.u8(r.clip && !r.divider ? 1 : 0);
    wr.u8((r.visible === false ? 2 : 0) | 8 | (r.divider ? 16 : 0));  // bit 1: hidden; bit 3: bit 4 counts; bit 4: pixels irrelevant
    wr.u8(0);
    const endExtra = wr.lengthHere();
    if (m) {
      wr.u32(20);
      wr.i32(m.y); wr.i32(m.x); wr.i32(m.y + m.h); wr.i32(m.x + m.w);
      wr.u8(m.outside ?? 255); wr.u8(m.enabled === false ? 2 : 0); wr.u16(0);
    } else wr.u32(0);
    wr.u32(0);  // blending ranges
    pascalName(wr, r.name || '');
    // the name again in Unicode
    const chars = [...(r.name || '')].map(c => c.charCodeAt(0)).slice(0, 255);
    wr.ascii('8BIM'); wr.ascii('luni'); wr.u32(4 + chars.length * 2 + (chars.length % 2 ? 2 : 0));
    wr.u32(chars.length); for (const c of chars) wr.u16(c);
    if (chars.length % 2) wr.u16(0);
    if (r.divider) {
      wr.ascii('8BIM'); wr.ascii('lsct');
      if (r.divider !== 3 && r.blend === 'pass-through') { wr.u32(12); wr.u32(r.divider); wr.ascii('8BIM'); wr.ascii('pass'); }
      else if (r.divider !== 3) { wr.u32(12); wr.u32(r.divider); wr.ascii('8BIM'); wr.ascii(BLEND_KEYS[r.blend] || 'norm'); }
      else { wr.u32(4); wr.u32(3); }
    }
    endExtra();
    channelData.push(chans);
  }
  for (const chans of channelData) for (const [, bytes] of chans) wr.bytes(bytes);
  endInfo(2);
  wr.u32(0);  // global layer mask info
  endSection(2);
  // the merged picture (what programs without layers show): RGB, RLE
  const n = width * height, flat = composite || new Uint8ClampedArray(n * 4);
  const planes = [0, 1, 2].map(c => rleChannel(planeOf(flat, n, c), width, height));
  wr.u16(1);
  for (const p of planes) for (const c of p.counts) wr.u16(c);
  for (const p of planes) wr.bytes(Uint8Array.from(p.data));
  return wr.result();
}

// ---------- reading ----------

class Reader {
  constructor(bytes) { this.b = bytes; this.pos = 0; }
  need(n) { if (this.pos + n > this.b.length) throw new Error('The PSD file ends too early'); }
  u8() { this.need(1); return this.b[this.pos++]; }
  u16() { return (this.u8() << 8) | this.u8(); }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u32() { return (this.u16() * 0x10000) + this.u16(); }
  i32() { const v = this.u32(); return v >= 0x80000000 ? v - 0x100000000 : v; }
  ascii(n) { this.need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.pos++]); return s; }
  skip(n) { this.need(n); this.pos += n; }
}

/** One channel (w x h) from the reader: compression 0 (raw) or 1 (RLE); others are not supported. */
function readChannel(rd, w, h, end) {
  const comp = rd.u16();
  const out = new Uint8Array(w * h);
  if (!w || !h) { rd.pos = end; return out; }
  if (comp === 0) { rd.need(w * h); out.set(rd.b.subarray(rd.pos, rd.pos + w * h)); }
  else if (comp === 1) {
    const counts = [];
    for (let y = 0; y < h; y++) counts.push(rd.u16());
    let pos = rd.pos;
    for (let y = 0; y < h; y++) { out.set(unpackBits(rd.b, pos, w)[0], y * w); pos += counts[y]; }
  } else throw new Error('This PSD uses ZIP-compressed layers, which KoeStudio cannot read yet');
  rd.pos = end;
  return out;
}

/** The model (see the top) of a PSD file's bytes. Throws with a readable message for files it cannot read. */
export function decodePsd(bytes) {
  const rd = new Reader(bytes);
  if (rd.ascii(4) !== '8BPS') throw new Error('Not a Photoshop (PSD) file');
  const version = rd.u16();
  if (version !== 1) throw new Error('Large-document PSB files are not supported');
  rd.skip(6);
  const channels = rd.u16(), height = rd.u32(), width = rd.u32(), depth = rd.u16(), mode = rd.u16();
  if (depth !== 8) throw new Error(`This PSD uses ${depth} bits per channel; KoeStudio reads 8-bit files`);
  if (mode !== 3) throw new Error('KoeStudio reads RGB PSD files (this one is grayscale, CMYK or indexed)');
  if (!(width > 0 && height > 0 && width <= MAX_PSD_SIDE && height <= MAX_PSD_SIDE)) throw new Error('The PSD size is out of range');
  rd.skip(rd.u32());  // colour mode data
  rd.skip(rd.u32());  // image resources
  const sectionLen = rd.u32(), sectionEnd = rd.pos + sectionLen;
  const records = [];
  if (sectionLen) {
    const infoLen = rd.u32(), infoEnd = rd.pos + infoLen;
    if (infoLen) {
      const count = Math.abs(rd.i16());
      for (let i = 0; i < count; i++) {
        const r = { top: rd.i32(), left: rd.i32(), bottom: rd.i32(), right: rd.i32(), channels: [] };
        const nc = rd.u16();
        for (let k = 0; k < nc; k++) r.channels.push({ id: rd.i16(), len: rd.u32() });
        if (rd.ascii(4) !== '8BIM') throw new Error('The PSD layer list is damaged');
        r.blendKey = rd.ascii(4);
        r.opacity = rd.u8() / 255;
        r.clip = rd.u8() === 1;
        const flags = rd.u8();
        r.visible = !(flags & 2);
        rd.u8();
        const extraEnd = rd.pos + 4 + rd.u32();
        const maskLen = rd.u32();
        if (maskLen >= 20) {
          const t = rd.i32(), l = rd.i32(), b = rd.i32(), rt = rd.i32();
          r.mask = { y: t, x: l, h: b - t, w: rt - l, outside: rd.u8(), enabled: !(rd.u8() & 2) };
          rd.skip(maskLen - 18);
        } else rd.skip(maskLen);
        rd.skip(rd.u32());  // blending ranges
        const nl = rd.u8();
        r.name = rd.ascii(nl);
        rd.skip((4 - ((1 + nl) % 4)) % 4);
        while (rd.pos + 12 <= extraEnd) {  // additional info blocks
          const sig = rd.ascii(4), key = rd.ascii(4), len = rd.u32(), end = rd.pos + len;
          if (sig !== '8BIM' && sig !== '8B64') break;
          if (key === 'luni' && len >= 4) {
            const nchars = rd.u32();
            let s = '';
            for (let k = 0; k < nchars && rd.pos + 2 <= end; k++) s += String.fromCharCode(rd.u16());
            r.name = s.replace(/\0+$/, '');
          } else if (key === 'lsct' && len >= 4) {
            r.divider = rd.u32();
            if (len >= 12) { rd.skip(4); r.dividerBlend = rd.ascii(4); }
          }
          rd.pos = end + (len % 2);  // blocks are padded to even lengths
        }
        rd.pos = extraEnd;
        records.push(r);
      }
      for (const r of records) {
        const w = r.right - r.left, h = r.bottom - r.top;
        for (const ch of r.channels) {
          const end = rd.pos + ch.len;
          const cw = ch.id === -2 && r.mask ? r.mask.w : w, chh = ch.id === -2 && r.mask ? r.mask.h : h;
          if (ch.id < -2 || ch.id > 2) { rd.pos = end; continue; }  // extra alpha / real user mask channels
          ch.data = readChannel(rd, Math.max(0, cw), Math.max(0, chh), end);
        }
      }
    }
    rd.pos = Math.max(rd.pos, Math.min(infoEnd, sectionEnd));
  }
  rd.pos = sectionEnd;
  // the layers, bottom first, folded back into folders
  const root = [], stack = [root];
  for (const r of records) {
    if (r.divider === 3) { stack.push([]); continue; }
    const common = { name: r.name, visible: r.visible, opacity: r.opacity, clip: r.clip };
    const md = r.channels.find(c => c.id === -2)?.data;
    const mask = r.mask && md ? { ...r.mask, data: md } : null;
    if (r.divider === 1 || r.divider === 2) {
      const children = stack.length > 1 ? stack.pop() : [];
      const key = r.dividerBlend || r.blendKey;
      stack[stack.length - 1].push({ ...common, folder: true, open: r.divider === 1, blend: key === 'pass' ? 'pass-through' : BLEND_IDS[key] || 'source-over', children, mask });
      continue;
    }
    const w = Math.max(0, r.right - r.left), h = Math.max(0, r.bottom - r.top), n = w * h, rgba = new Uint8ClampedArray(n * 4);
    const by = id => r.channels.find(c => c.id === id)?.data;
    const [R, G, B, A] = [by(0), by(1), by(2), by(-1)];
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = R ? R[i] : 0; rgba[i * 4 + 1] = G ? G[i] : 0; rgba[i * 4 + 2] = B ? B[i] : 0; rgba[i * 4 + 3] = A ? A[i] : 255;
    }
    stack[stack.length - 1].push({ ...common, blend: r.blendKey === 'pass' ? 'source-over' : BLEND_IDS[r.blendKey] || 'source-over', x: r.left, y: r.top, w, h, rgba, mask });
  }
  while (stack.length > 1) { const lost = stack.pop(); stack[stack.length - 1].push(...lost); }  // an unclosed folder
  // the merged picture: used when the file has no layers at all
  let composite = null;
  if (!records.length) {
    const comp = rd.u16(), n = width * height;
    composite = new Uint8ClampedArray(n * 4).fill(255);
    const planes = [];
    if (comp === 0) for (let c = 0; c < channels; c++) { rd.need(n); planes.push(rd.b.subarray(rd.pos, rd.pos + n)); rd.pos += n; }
    else if (comp === 1) {
      const counts = [];
      for (let k = 0; k < channels * height; k++) counts.push(rd.u16());
      let pos = rd.pos;
      for (let c = 0; c < channels; c++) {
        const p = new Uint8Array(n);
        for (let y = 0; y < height; y++) { p.set(unpackBits(rd.b, pos, width)[0], y * width); pos += counts[c * height + y]; }
        planes.push(p);
      }
    } else throw new Error('This PSD picture is ZIP-compressed, which KoeStudio cannot read yet');
    for (let i = 0; i < n; i++) for (let c = 0; c < Math.min(4, planes.length); c++) composite[i * 4 + c] = planes[c][i];
  }
  return { width, height, layers: root, composite };
}
