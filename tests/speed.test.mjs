// Downscaled composite levels (mips.js) and the pixel cache of the direct-pixel tools (pixelcache.js).
// Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mipLevel, mipSize, mipRect } from '../web/js/mips.js';
import { PixelCache } from '../web/js/pixelcache.js';

test('mipLevel picks the level whose scale stays at least one half', () => {
  assert.equal(mipLevel(1), 0);
  assert.equal(mipLevel(0.5), 0, 'half size draws straight from the composite');
  assert.equal(mipLevel(0.49), 1, '0.49 × 2 = 0.98');
  assert.equal(mipLevel(0.26), 1);
  assert.equal(mipLevel(0.25), 2, '0.25 × 4 = 1');
  assert.equal(mipLevel(0.1), 3, '0.1 × 8 = 0.8');
  assert.equal(mipLevel(0), 0);
});

test('mipSize and mipRect', () => {
  assert.deepEqual(mipSize(3000, 2000, 1), { w: 1500, h: 1000 });
  assert.deepEqual(mipSize(5, 3, 1), { w: 3, h: 2 }, 'odd sizes round up');
  assert.deepEqual(mipSize(5, 3, 3), { w: 1, h: 1 });
  assert.deepEqual(mipRect({ x: 3, y: 3, w: 4, h: 2 }, 1, 10, 10), { x: 1, y: 1, w: 3, h: 2 }, '1.5..3.5 grows to 1..4');
  assert.deepEqual(mipRect({ x: -5, y: 8, w: 10, h: 10 }, 1, 10, 10), { x: 0, y: 4, w: 3, h: 1 }, 'clipped to the 5 × 5 level');
  assert.equal(mipRect({ x: 20, y: 0, w: 5, h: 5 }, 1, 10, 10), null);
});

test('PixelCache reads each tile once and writes back only changed tiles', () => {
  const W = 5, H = 3;
  let reads = 0;
  const read = (x, y, w, h) => {
    reads++;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.set([x + i, y + j, 0, 255], (j * w + i) * 4);
    return out;
  };
  const c = new PixelCache(W, H, read, 2);
  assert.deepEqual([...c.get(1, 1, 2, 2)], [1, 1, 0, 255, 2, 1, 0, 255, 1, 2, 0, 255, 2, 2, 0, 255]);
  assert.equal(reads, 4, 'the patch touches tiles (0,0), (1,0), (0,1), (1,1)');
  assert.deepEqual([...c.get(-1, 0, 2, 1)], [0, 0, 0, 0, 0, 0, 0, 255], 'outside the image is clear');
  assert.equal(reads, 4, 'tile (0,0) is not read again');
  c.set(4, 2, 2, 1, new Uint8ClampedArray([9, 9, 9, 9, 8, 8, 8, 8]));
  assert.equal(reads, 5, 'writing to tile (2,1) reads it first');
  assert.deepEqual([...c.get(4, 2, 1, 1)], [9, 9, 9, 9]);
  assert.deepEqual([...c.getBefore(4, 2, 1, 1)], [4, 2, 0, 255], 'the pixels as first read are kept');
  const puts = [];
  c.flush((x, y, w, h, data) => puts.push([x, y, w, h, [...data]]));
  assert.deepEqual(puts, [[4, 2, 1, 1, [9, 9, 9, 9]]], 'only the changed tile, clipped to the image');
  c.flush(() => assert.fail('nothing changed since'));
});
