// Photoshop PSD writing and reading. Expected values are worked out by hand from the PSD file format description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packBits, unpackBits, encodePsd, decodePsd } from '../web/js/psd.js';

test('PackBits: the example from Apple\'s technical note', () => {
  const raw = [0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0xAA, 0xAA, 0xAA, 0xAA, 0x80, 0x00, 0x2A, 0x22, ...Array(10).fill(0xAA)];
  const packed = [0xFE, 0xAA, 0x02, 0x80, 0x00, 0x2A, 0xFD, 0xAA, 0x03, 0x80, 0x00, 0x2A, 0x22, 0xF7, 0xAA];
  assert.deepEqual(packBits(Uint8Array.from(raw)), packed);
  assert.deepEqual([...unpackBits(Uint8Array.from(packed), 0, raw.length)[0]], raw);
  const long = Uint8Array.from({ length: 300 }, (_, i) => (i < 200 ? 7 : i));  // runs longer than 128 split up
  const p = packBits(long);
  assert.deepEqual([...unpackBits(Uint8Array.from(p), 0, 300)[0]], [...long]);
  assert.deepEqual(p.slice(0, 4), [0x81, 7, 0xB9, 7], 'a run of 128 (257 - 128 = 0x81) then of 72 (257 - 72 = 185 = 0xB9)');
});

const rgbaOf = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set(f(i % w, Math.floor(i / w)), i * 4); return d; };

test('a layered picture survives writing and reading', () => {
  const ink = rgbaOf(3, 2, (x, y) => [x * 100, y * 200, 50, x === 2 ? 0 : 255]);
  const model = {
    width: 8, height: 6,
    layers: [
      { name: 'Paper', visible: true, opacity: 1, blend: 'source-over', clip: false, x: 0, y: 0, w: 8, h: 6, rgba: rgbaOf(8, 6, () => [255, 255, 255, 255]), mask: null },
      { name: 'Inks', folder: true, open: false, visible: true, opacity: 0.5, blend: 'pass-through', clip: false, children: [
        { name: 'Line art', visible: true, opacity: 1, blend: 'multiply', clip: false, x: 2, y: 1, w: 3, h: 2, rgba: ink,
          mask: { x: 2, y: 1, w: 2, h: 1, data: Uint8Array.from([0, 255]), outside: 255, enabled: true } },
        { name: 'Shade ☺', visible: false, opacity: 0.25, blend: 'overlay', clip: true, x: 0, y: 0, w: 0, h: 0, rgba: new Uint8ClampedArray(0), mask: null },
      ] },
    ],
    composite: rgbaOf(8, 6, () => [10, 20, 30, 255]),
  };
  const bytes = encodePsd(model);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), '8BPS');
  const back = decodePsd(bytes);
  assert.equal(back.width, 8); assert.equal(back.height, 6);
  assert.deepEqual(back.layers.map(n => n.name), ['Paper', 'Inks']);
  const folder = back.layers[1];
  assert.equal(folder.folder, true); assert.equal(folder.open, false); assert.equal(folder.blend, 'pass-through');
  assert.equal(Math.round(folder.opacity * 255), 128, '0.5 is stored as 128/255');
  const [art, shade] = folder.children;
  assert.deepEqual([art.name, art.blend, art.x, art.y, art.w, art.h], ['Line art', 'multiply', 2, 1, 3, 2]);
  assert.deepEqual([...art.rgba], [...ink]);
  assert.deepEqual([art.mask.x, art.mask.y, art.mask.w, art.mask.h, [...art.mask.data], art.mask.enabled], [2, 1, 2, 1, [0, 255], true]);
  assert.deepEqual([shade.name, shade.visible, shade.clip, shade.blend, shade.w], ['Shade ☺', false, true, 'overlay', 0], 'the Unicode name wins over the ASCII one');
  assert.equal(back.composite, null, 'with layers, the merged picture is not needed');
});

test('reading refuses what it cannot handle, with a reason', () => {
  assert.throws(() => decodePsd(Uint8Array.from([1, 2, 3, 4, 5, 6])), /Not a Photoshop/);
  const bytes = encodePsd({ width: 2, height: 2, layers: [] });
  bytes[25] = 4;  // colour mode CMYK (bytes 24-25 of the header, after signature 4, version 2, reserved 6, channels 2, height 4, width 4, depth 2)
  assert.throws(() => decodePsd(bytes), /RGB/);
});

test('a PSD without layers gives its merged picture', () => {
  const comp = rgbaOf(4, 3, (x, y) => [x * 60, y * 90, 200, 255]);
  const back = decodePsd(encodePsd({ width: 4, height: 3, layers: [], composite: comp }));
  assert.deepEqual(back.layers, []);
  assert.deepEqual([...back.composite], [...comp]);
});
