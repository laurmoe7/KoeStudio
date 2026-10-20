// Distort filters: twirl, pinch / bulge, ripple and polar coordinates. Expected values are worked out by hand.
// The test picture's red is 10 x its column and green 10 x its row, so a pixel's colour says where it was sampled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { twirl, pinch, ripple, polar, distortRadius, FILTER_BY_ID, FILTER_MENU } from '../web/js/filters.js';

function ramp(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = 10 * x; d[i + 1] = 10 * y; d[i + 3] = 255; }
  return d;
}
const at = (d, w, x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1]];

test('twirl turns most at the centre and leaves the outside alone', () => {
  const d = twirl(ramp(9, 9), 9, 9, 180, 100, 4, 4);
  // (5, 4) is 1 px right of the centre: t = 0.99, turned 180 x 0.9801 = 176.4 degrees -> sampled at (3.002, 4.063)
  assert.deepEqual(at(d, 9, 5, 4), [30, 41]);
  assert.deepEqual(at(d, 9, 4, 4), [40, 40], 'the centre stays');
  const e = twirl(ramp(9, 9), 9, 9, 180, 3, 4, 4);
  assert.deepEqual(at(e, 9, 0, 0), [0, 0], '5.7 px out, past the 3 px radius: unmoved');
  const z = twirl(ramp(9, 9), 9, 9, 0, 100, 4, 4);
  assert.deepEqual([...z], [...ramp(9, 9)], 'no angle, no change');
});

test('pinch swells or pulls in the middle and keeps the rim', () => {
  // amount 1: e = 2, so 2 px out of a 4 px radius (q = 0.5) shows q^2 = 0.25 of the radius: 1 px out
  assert.deepEqual(at(pinch(ramp(9, 9), 9, 9, 1, 4, 4, 4), 9, 6, 4), [50, 40]);
  // amount -1: e = 0.5, q^0.5 = 0.707 of 4 px = 2.83 px out -> red 68.3
  assert.deepEqual(at(pinch(ramp(9, 9), 9, 9, -1, 4, 4, 4), 9, 6, 4), [68, 40]);
  assert.deepEqual(at(pinch(ramp(9, 9), 9, 9, 1, 4, 4, 4), 9, 8, 4), [80, 40], 'on the rim: unmoved');
  assert.equal(distortRadius(50, 800, 600), 150, '50% of half the shorter side');
});

test('ripple moves pixels in and out along sine rings', () => {
  const d = ripple(ramp(9, 9), 9, 9, 1, 8, 4, 4);
  assert.deepEqual(at(d, 9, 6, 4), [70, 40], '2 px out is a quarter wave: sampled 1 px further, at 3 px');
  assert.deepEqual(at(d, 9, 8, 4), [80, 40], '4 px out is half a wave: sin = 0');
  assert.deepEqual(at(d, 9, 4, 4), [40, 40], 'the centre stays');
});

test('polar coordinates wrap rows into rings and back', () => {
  const r = polar(ramp(8, 8), 8, 8, false, 0, 0, 8, 8);
  // (4, 0) sits at (0.125, -0.875) of the half-size from the middle: angle 0.142 rad from straight up -> column
  // 0.18 (clamped to 0 after the half-pixel shift), distance 0.884 -> row 7.07 - 0.5 = 6.57
  assert.deepEqual(at(r, 8, 4, 0), [0, 66]);
  // (3, 3): up and to the left, angle -45 degrees = 7/8 of the way round -> column 6.5, distance 0.177 -> row 0.91
  assert.deepEqual(at(r, 8, 3, 3), [65, 9]);
  const b = polar(ramp(8, 8), 8, 8, true, 0, 0, 8, 8);
  // (0, 0): angle 0.39 rad, 1/16 of the way out -> canvas (4.096, 3.769) -> pixel (3.596, 3.269)
  assert.deepEqual(at(b, 8, 0, 0), [36, 33]);
});

test('the distort filters are in the Filter menu', () => {
  const distort = FILTER_MENU.find(([name]) => name === 'Distort')[1];
  for (const id of ['wave', 'twirl', 'pinch', 'ripple', 'polar', 'unpolar']) assert.ok(distort.includes(id) && FILTER_BY_ID[id], id);
  assert.ok(FILTER_BY_ID.twirl.centre && FILTER_BY_ID.ripple.centre);
});
