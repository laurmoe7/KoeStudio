// The artwork's resolution (resolution.js) and writing it into exported files. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { sanitizeDpi, printSize, printLabel, dpiToPpm, pngWithDpi, jpegWithDpi, DEFAULT_DPI } from '../web/js/resolution.js';
import { encodeBmp } from '../web/js/imageformats.js';
import { sanitizeDoc } from '../web/js/doc.js';

const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (kind, body) => {
  const k = [...kind].map(c => c.charCodeAt(0));
  return [...be32(body.length), ...k, ...body, ...be32(crc32(Buffer.from([...k, ...body])))];
};
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR = chunk('IHDR', [...be32(1), ...be32(1), 8, 6, 0, 0, 0]);
const chunks = png => {
  const out = [];
  for (let i = 8; i < png.length;) {
    const n = (png[i] << 24 | png[i + 1] << 16 | png[i + 2] << 8 | png[i + 3]) >>> 0;
    out.push({ kind: String.fromCharCode(...png.subarray(i + 4, i + 8)), body: [...png.subarray(i + 8, i + 8 + n)], crc: [...png.subarray(i + 8 + n, i + 12 + n)] });
    i += 12 + n;
  }
  return out;
};

test('resolution values', () => {
  assert.equal(sanitizeDpi('300'), 300);
  assert.equal(sanitizeDpi(299.6), 300);
  assert.equal(sanitizeDpi(0), DEFAULT_DPI, 'zero is not a resolution');
  assert.equal(sanitizeDpi('x'), 72);
  assert.equal(sanitizeDpi(99999), 2400);
  const a4 = printSize(2480, 3508, 300);
  assert.ok(Math.abs(a4.w - 20.997) < 0.001 && Math.abs(a4.h - 29.701) < 0.001, 'A4 at 300 dpi is 21 x 29.7 cm');
  assert.deepEqual(printSize(300, 150, 300, 'in'), { w: 1, h: 0.5 });
  assert.equal(printLabel(300, 150, 300), '2.5 × 1.3 cm (1.00 × 0.50 in)');
  assert.equal(dpiToPpm(300), 11811, '300 / 0.0254');
  assert.equal(sanitizeDoc({}).dpi, 72, 'older files are 72 dpi');
  assert.equal(sanitizeDoc({ dpi: 350 }).dpi, 350);
});

test('a PNG gets one pHYs chunk right after IHDR', () => {
  const oldPhys = chunk('pHYs', [...be32(1), ...be32(1), 0]);
  const png = Uint8Array.from([...SIG, ...IHDR, ...chunk('IDAT', [1, 2, 3]), ...oldPhys, ...chunk('IEND', [])]);
  const out = pngWithDpi(png, 300);
  const cs = chunks(out);
  assert.deepEqual(cs.map(c => c.kind), ['IHDR', 'pHYs', 'IDAT', 'IEND'], 'the old pHYs is gone, the new one after IHDR');
  assert.deepEqual(cs[1].body, [...be32(11811), ...be32(11811), 1], 'pixels per metre, unit metre');
  assert.deepEqual(cs[1].crc, be32(crc32(Buffer.from([0x70, 0x48, 0x59, 0x73, ...cs[1].body]))), 'a valid checksum');
  assert.deepEqual(cs[2].body, [1, 2, 3], 'the picture data is untouched');
  const notPng = Uint8Array.from([1, 2, 3]);
  assert.equal(pngWithDpi(notPng, 300), notPng);
});

test('a JPEG gets its JFIF density', () => {
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const out = jpegWithDpi(jpg, 350);
  assert.deepEqual([...out.subarray(13, 18)], [1, 1, 94, 1, 94], 'unit dpi, 350 = 0x015e both ways');
  assert.equal(jpg[13], 0, 'the original is not changed');
  const exif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(jpegWithDpi(exif, 300), exif, 'no JFIF header: unchanged');
});

test('BMP records the resolution', () => {
  const bmp = encodeBmp(new Uint8ClampedArray(4), 1, 1, 300);
  const rd = i => bmp[i] | bmp[i + 1] << 8 | bmp[i + 2] << 16 | bmp[i + 3] << 24;
  assert.equal(rd(38), 11811);
  assert.equal(rd(42), 11811);
});
