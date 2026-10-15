// Export encoders. Expected bytes are worked out by hand from the TGA, BMP and GIF89a specs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTga, encodeBmp, encodeGif, lzwEncode, quantize, EXPORT_FORMATS } from '../web/js/imageformats.js';

// 2x1 image: opaque red, then half-transparent blue
const px = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 100]);

test('TGA header, BGRA order and footer', () => {
  const t = encodeTga(px, 2, 1);
  assert.deepEqual([...t.slice(0, 18)], [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 32, 0x28]);
  assert.deepEqual([...t.slice(18, 26)], [0, 0, 255, 255, 255, 0, 0, 100]);
  assert.equal(t.length, 18 + 8 + 8 + 18);
  assert.equal(new TextDecoder().decode(t.slice(-18)), 'TRUEVISION-XFILE.\0');
});

test('BMP is bottom-up with a declared alpha channel', () => {
  // 1x2: top pixel red, bottom pixel green
  const b = encodeBmp(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), 1, 2);
  assert.equal(b[0], 0x42); assert.equal(b[1], 0x4d);
  const dv = new DataView(b.buffer);
  assert.equal(dv.getUint32(2, true), 122 + 8);
  assert.equal(dv.getUint32(10, true), 122);
  assert.equal(dv.getInt32(18, true), 1);
  assert.equal(dv.getInt32(22, true), 2, 'positive height = rows stored bottom-up');
  assert.equal(dv.getUint16(28, true), 32);
  assert.equal(dv.getUint32(66, true), 0xff000000, 'alpha mask');
  assert.deepEqual([...b.slice(122, 130)], [0, 255, 0, 255, 0, 0, 255, 255], 'green row first, then red, as BGRA');
});

test('quantize keeps few colours exact and caps at the limit', () => {
  const two = Uint8Array.from([0, 0, 0, 255, 248, 248, 248, 255, 0, 0, 0, 255]);
  const q = quantize(two, 256);
  assert.equal(q.palette.length, 2);
  assert.notEqual(q.index(0, 0, 0), q.index(248, 248, 248));
  const many = new Uint8Array(1000 * 4);
  for (let i = 0; i < 1000; i++) many.set([(i * 37) & 255, (i * 91) & 255, (i * 13) & 255, 255], i * 4);
  assert.ok(quantize(many, 16).palette.length <= 16);
});

// Minimal GIF LZW decoder, independent of the encoder
function lzwDecode(bytes, minBits, count) {
  const clear = 1 << minBits, end = clear + 1;
  let table, size = minBits + 1, bitPos = 0, prev = null;
  const out = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i++) table[i] = [i]; table[clear] = null; table[end] = null; size = minBits + 1; prev = null; };
  reset();
  while (out.length < count) {
    let code = 0;
    for (let i = 0; i < size; i++, bitPos++) code |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === end) break;
    let entry;
    if (code < table.length) entry = table[code];
    else entry = [...prev, prev[0]];
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
    if (table.length === (1 << size) && size < 12) size++;
  }
  return out;
}

test('LZW round-trips, including long runs, table resets and 2-bit alphabets', () => {
  const cases = [
    [0, 1, 2, 3, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3],
    Array.from({ length: 5000 }, () => 1),
    Array.from({ length: 20000 }, (_, i) => (i * i + (i >> 3)) % 4),
  ];
  for (const c of cases) assert.deepEqual(lzwDecode(lzwEncode(c, 2), 2, c.length), c);
  const big = Array.from({ length: 30000 }, (_, i) => (i * 7919 + (i >> 5)) % 256);
  assert.deepEqual(lzwDecode(lzwEncode(big, 8), 8, big.length), big);
});

test('GIF structure, palette and transparency', () => {
  const g = encodeGif(px, 2, 1);
  assert.equal(new TextDecoder().decode(g.slice(0, 6)), 'GIF89a');
  assert.deepEqual([...g.slice(6, 10)], [2, 0, 1, 0]);
  assert.equal(g[g.length - 1], 0x3b);
  // red + transparent = 2 entries -> 1 bit, global table flag set
  assert.equal(g[10], 0x80);
  assert.deepEqual([...g.slice(13, 19)], [255, 0, 0, 0, 0, 0], 'palette: red, then the transparent slot');
  const ext = [...g].findIndex((v, i) => v === 0x21 && g[i + 1] === 0xf9);
  assert.ok(ext > 0, 'graphic control extension present');
  assert.equal(g[ext + 3] & 1, 1, 'transparent flag');
  assert.equal(g[ext + 6], 1, 'transparent index is the slot after the colours');
});

test('opaque GIF has no transparency extension and decodes to its pixels', () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  const g = encodeGif(rgba, 2, 2);
  assert.ok(![...g].some((v, i) => v === 0x21 && g[i + 1] === 0xf9));
  const pal = [[...g.slice(13, 16)], [...g.slice(16, 19)]];
  const img = [...g].lastIndexOf(0x2c, g.length);
  // after the descriptor (10 bytes): min code size, then blocks
  const start = img + 10;
  const minBits = g[start];
  const n = g[start + 1];
  const idx = lzwDecode(g.slice(start + 2, start + 2 + n), minBits, 4);
  const cols = idx.map(i => pal[i].join());
  assert.deepEqual(cols, ['255,0,0', '0,255,0', '0,255,0', '255,0,0'], 'colours stay exact');
  assert.equal(cols[0], cols[3]);
  assert.equal(cols[1], cols[2]);
  assert.notEqual(cols[0], cols[1]);
});

test('export format list', () => {
  const ids = EXPORT_FORMATS.map(f => f.id);
  for (const id of ['png', 'jpg', 'gif', 'tga', 'bmp']) assert.ok(ids.includes(id));
  assert.equal(new Set(EXPORT_FORMATS.map(f => f.ext)).size, EXPORT_FORMATS.length);
});
