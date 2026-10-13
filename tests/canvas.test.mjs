// Canvas size / image size / crop maths. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorOffset, validSide, keepRatio, rotatedSize, cropRect } from '../web/js/canvasmath.js';

test('anchor offsets when growing the canvas from 100x50 to 300x150', () => {
  assert.deepEqual(anchorOffset(100, 50, 300, 150, 'nw'), { dx: 0, dy: 0 }, 'top-left stays at 0,0');
  assert.deepEqual(anchorOffset(100, 50, 300, 150, 'c'), { dx: 100, dy: 50 }, '(300-100)/2, (150-50)/2');
  assert.deepEqual(anchorOffset(100, 50, 300, 150, 'se'), { dx: 200, dy: 100 }, 'bottom-right: full difference');
  assert.deepEqual(anchorOffset(100, 50, 300, 150, 'e'), { dx: 200, dy: 50 });
  assert.deepEqual(anchorOffset(100, 50, 300, 150, 's'), { dx: 100, dy: 100 });
});

test('anchor offsets when shrinking (negative = cut off)', () => {
  assert.deepEqual(anchorOffset(100, 100, 50, 60, 'c'), { dx: -25, dy: -20 });
  assert.deepEqual(anchorOffset(100, 100, 50, 60, 'se'), { dx: -50, dy: -40 });
  assert.deepEqual(anchorOffset(10, 10, 13, 13, 'c'), { dx: 1, dy: 1 }, 'odd difference 3: floor(1.5) = 1, extra pixel right/bottom');
});

test('side lengths', () => {
  assert.equal(validSide('250'), 250);
  assert.equal(validSide(0), null);
  assert.equal(validSide(10001), null);
  assert.equal(validSide('abc'), null);
  assert.equal(validSide(99.6), 100);
  assert.equal(keepRatio(1920, 1080, 960), 540, '1080 * 960/1920');
  assert.equal(keepRatio(1000, 3, 10), 1, 'never below 1 px');
});

test('rotated size', () => {
  assert.deepEqual(rotatedSize(800, 600, 1), { w: 600, h: 800 });
  assert.deepEqual(rotatedSize(800, 600, -1), { w: 600, h: 800 });
  assert.deepEqual(rotatedSize(800, 600, 2), { w: 800, h: 600 });
});

test('crop rectangle', () => {
  assert.deepEqual(cropRect({ x: 50.4, y: 80 }, { x: 10, y: 20.6 }, 100, 100), { x: 10, y: 21, w: 40, h: 59 }, 'normalised and rounded');
  assert.deepEqual(cropRect({ x: -20, y: -5 }, { x: 150, y: 40 }, 100, 100), { x: 0, y: 0, w: 100, h: 40 }, 'clipped to the canvas');
  assert.equal(cropRect({ x: 5, y: 5 }, { x: 5.2, y: 30 }, 100, 100), null, 'under one pixel wide');
});
