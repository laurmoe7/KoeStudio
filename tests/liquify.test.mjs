// Liquify dabs. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liquifyFalloff, liquifyReach, liquifyDab, LIQUIFY_MODES } from '../web/js/liquify.js';

const W = 21, H = 21;
/** A W x H patch: colour(x, y) gives each pixel's RGBA. */
function patch(colour) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set(colour(x, y), (y * W + x) * 4);
  return d;
}
const px = (d, x, y) => [...d.slice((y * W + x) * 4, (y * W + x) * 4 + 4)];
const RED = [255, 0, 0, 255], BLUE = [0, 0, 255, 255];

test('falloff and reach', () => {
  assert.equal(liquifyFalloff(0, 10), 1);
  assert.equal(liquifyFalloff(5, 10), 0.5625, '(1 - 1/4)^2');
  assert.equal(liquifyFalloff(10, 10), 0);
  assert.equal(liquifyReach('push', 10, 0.5, 6, 8), 7, 'a 10 px step at half strength reads 5 px back, plus 2');
  assert.equal(liquifyReach('twirl', 10, 1), 2);
  assert.equal(LIQUIFY_MODES.length, 5);
});

test('push drags colour along', () => {
  const d = patch(x => (x < 10 ? RED : BLUE));
  liquifyDab(d, W, H, 10.5, 10.5, 8, 'push', 1, 4, 0);
  // the middle pixel (10, 10) reads 4 px back, from (6, 10): red
  assert.deepEqual(px(d, 10, 10), RED);
  assert.deepEqual(px(d, 19, 10), BLUE, 'outside the circle nothing changes');
  assert.deepEqual(px(d, 9, 10), RED, 'red stays red');
});

test('pinch, bloat and twirl leave an even colour alone, and clear pixels never tint', () => {
  for (const [mode] of LIQUIFY_MODES) {
    const flat = patch(() => [10, 200, 30, 255]);
    liquifyDab(flat, W, H, 10.5, 10.5, 9, mode, 1, 3, 2);
    for (let i = 0; i < flat.length; i += 4) assert.deepEqual([...flat.slice(i, i + 4)], [10, 200, 30, 255], mode);
  }
  const d = patch(x => (x < 10 ? [0, 0, 0, 0] : RED));
  liquifyDab(d, W, H, 10.5, 10.5, 8, 'push', 1, -3, 0);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]) assert.deepEqual([d[i], d[i + 1], d[i + 2]], [255, 0, 0], 'partly clear pixels keep the pure red');
  }
  assert.ok(px(d, 8, 10)[3] > 0, 'red was pushed into the clear half');
});

test('bloat grows a dot, pinch shrinks it', () => {
  const dot = () => patch((x, y) => (Math.hypot(x - 10, y - 10) <= 2 ? RED : BLUE));
  const reds = d => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
  const before = reds(dot()), big = dot(), small = dot();
  for (let k = 0; k < 10; k++) { liquifyDab(big, W, H, 10.5, 10.5, 9, 'bloat', 1); liquifyDab(small, W, H, 10.5, 10.5, 9, 'pinch', 1); }
  assert.ok(reds(big) > before, `bloat: ${reds(big)} > ${before}`);
  assert.ok(reds(small) < before, `pinch: ${reds(small)} < ${before}`);
});
