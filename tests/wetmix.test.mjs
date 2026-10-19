// Wet mixing: brushes whose paint picks up and drags the colour already on the layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { perDistance, averageUnder, WetPaint, mixRgb, rgbHex } from '../web/js/wetmix.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0, cover: 1 }, RED = { r: 255, g: 0, b: 0, cover: 1 }, CLEAR = { r: 0, g: 0, b: 0, cover: 0 };

test('shares are worked out per brush width', () => {
  close(perDistance(0.5, 20, 10), 0.25, 'two brush widths keep a quarter');
  assert.equal(perDistance(0, 5, 10), 0);
  assert.equal(perDistance(1, 99, 1), 1);
});

test('the colour under a dab is averaged by alpha', () => {
  assert.deepEqual(averageUnder(() => [200, 100, 0, 255], 50, 50, 10), { r: 200, g: 100, b: 0, cover: 1 });
  // 5 x 5 points 2 px apart inside a radius of 5: columns at -4 and -2 (3 + 5 points) are opaque red, the 13 at 0, 2
  // and 4 are clear, so 8 of 21 are covered; the clear ones do not turn the red darker
  const half = averageUnder(x => x < 0 ? [255, 0, 0, 255] : [0, 0, 0, 0], 0, 0, 10);
  assert.deepEqual([half.r, half.g, half.b], [255, 0, 0]);
  close(half.cover, 8 / 21, 'cover');
  assert.equal(averageUnder(() => [9, 9, 9, 0], 0, 0, 4).cover, 0);
});

test('without stretch each dab mixes the brush with what is under it', () => {
  const w = new WetPaint(0.5, 0);
  assert.deepEqual(w.next(0, 0, 10, BLACK, WHITE), { r: 127.5, g: 127.5, b: 127.5 });
  assert.deepEqual(w.next(10, 0, 10, CLEAR, WHITE), WHITE, 'clear canvas: the brush colour');
  assert.equal(rgbHex({ r: 127.5, g: 127.5, b: 127.5 }), '#808080');
});

test('stretch drags the picked-up colour along', () => {
  const w = new WetPaint(0.5, 0.5);
  assert.deepEqual(w.next(0, 0, 10, BLACK, WHITE), { r: 127.5, g: 127.5, b: 127.5 });
  // one brush width over clear canvas: half the black is still on the brush, so a quarter of it goes into the paint
  assert.deepEqual(w.next(10, 0, 10, CLEAR, WHITE), { r: 191.25, g: 191.25, b: 191.25 });
  // then over opaque red: the red is picked up at once and covers the trail, mixed in at .5
  assert.deepEqual(w.next(20, 0, 10, RED, WHITE), { r: 255, g: 127.5, b: 127.5 });
});

test('a brush coming from bare paper picks up the colour it meets straight away', () => {
  const w = new WetPaint(0.4, 0.8), BLUE = { r: 0, g: 0, b: 200 };
  assert.deepEqual(w.next(0, 0, 10, CLEAR, BLUE), BLUE);
  // one dab onto opaque red: 40% red in the paint, not a slow build-up over brush widths
  assert.deepEqual(w.next(1, 0, 10, RED, BLUE), { r: 102, g: 0, b: 120 });
});

test('the trail shows through where there is less colour under the dab', () => {
  const w = new WetPaint(0.5, 0.5);
  w.next(0, 0, 10, BLACK, WHITE);
  // one width on, half the black is left (.5) over red at half cover: cover max(.5, .5) = .5; red weighs .5 and the
  // trail .5 x (1 - .5) = .25, so the picked colour is r 255 x .5 / .75 = 170, g = b = 0, mixed in at .5 x .5 = .25
  const c = w.next(10, 0, 10, { ...RED, cover: 0.5 }, WHITE);
  close(c.r, 233.75, 'r'); close(c.g, 191.25, 'g'); close(c.b, 191.25, 'b');
  // the same half-covered red again and again: the cover stays .5 and does not build up
  for (let i = 1; i <= 20; i++) w.next(10 + i, 0, 10, { ...RED, cover: 0.5 }, WHITE);
  close(w.picked.cover, 0.5, 'cover');
});

test('the spacing does not change the look', () => {
  const one = new WetPaint(0.5, 0.5), two = new WetPaint(0.5, 0.5);
  one.next(0, 0, 10, BLACK, WHITE); two.next(0, 0, 10, BLACK, WHITE);
  two.next(5, 0, 10, CLEAR, WHITE);
  close(two.next(10, 0, 10, CLEAR, WHITE).r, one.next(10, 0, 10, CLEAR, WHITE).r, 'two half steps = one step');
  assert.deepEqual(mixRgb({ r: 0, g: 10, b: 20 }, { r: 100, g: 110, b: 120 }, 0.25), { r: 25, g: 35, b: 45 });
});
