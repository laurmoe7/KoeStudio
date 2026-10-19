// Emboss, edges, vignette, oil paint, wave, clouds, desaturate, auto contrast, palette and colour-to-alpha filters.
// Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emboss, findEdges, vignette, oilPaint, wave, clouds, cloudAt, noiseAt, desaturate, autoContrastLut, bayer8,
  reduceToPalette, colorToAlpha, FILTER_BY_ID } from '../web/js/filters.js';

/** w x h gray pixels from a list of values (opaque). */
function grays(w, h, values) {
  const d = new Uint8ClampedArray(w * h * 4);
  values.forEach((v, p) => { d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v; d[p * 4 + 3] = 255; });
  return d;
}
const reds = d => [...d].filter((_, i) => i % 4 === 0);

test('grayscale uses the lightness', () => {
  const d = new Uint8ClampedArray([255, 0, 0, 200]);
  desaturate(d);
  assert.deepEqual([...d], [76, 76, 76, 200], '0.299 x 255 = 76.2, alpha kept');
});

test('colour to transparency takes the colour out', () => {
  const d = new Uint8ClampedArray([128, 128, 128, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  colorToAlpha(d, [255, 255, 255]);
  assert.deepEqual([...d.slice(0, 4)], [0, 0, 0, 127], 'mid gray over white is black at half opacity');
  assert.equal(d[7], 0, 'white goes clear');
  assert.deepEqual([...d.slice(8, 12)], [0, 0, 0, 255], 'black stays solid');
});

test('auto contrast stretches the range', () => {
  const lut = autoContrastLut(grays(2, 1, [50, 150]));
  assert.equal(lut[50], 0);
  assert.equal(lut[150], 255);
  assert.equal(lut[100], 128, '(100 - 50) x 255 / 100 = 127.5');
  assert.equal(autoContrastLut(grays(1, 1, [80]))[80], 80, 'one value: nothing to stretch');
});

test('Bayer matrix and palette reduction', () => {
  assert.deepEqual([0, 1, 2, 3].map(x => bayer8(x, 0)), [0, 32, 8, 40], 'the classic first row');
  assert.equal(bayer8(0, 1), 48);
  assert.equal(bayer8(1, 1), 16);
  const all = new Set();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) all.add(bayer8(x, y));
  assert.equal(all.size, 64, 'each threshold once');
  const pal = [[0, 0, 0], [255, 255, 255]];
  assert.deepEqual(reds(reduceToPalette(grays(2, 1, [100, 200]), 2, 1, pal, 0)), [0, 255], 'nearest colour');
  const g = reduceToPalette(grays(8, 8, new Array(64).fill(128)), 8, 8, pal, 100);
  assert.equal(reds(g).filter(v => v === 255).length, 32, 'mid gray dithers to half white');
});

test('emboss lights the edge facing the light', () => {
  assert.deepEqual(reds(emboss(grays(3, 1, [90, 90, 90]), 3, 1, 0, 1, 100)), [128, 128, 128], 'flat is mid gray');
  // light from the right: the step up towards the right faces away from it
  assert.deepEqual(reds(emboss(grays(3, 1, [0, 255, 255]), 3, 1, 0, 1, 100)), [0, 0, 128]);
});

test('find edges draws dark lines at changes', () => {
  const d = findEdges(grays(3, 3, [0, 255, 255, 0, 255, 255, 0, 255, 255]), 3, 3);
  assert.equal(d[(1 * 3 + 1) * 4], 0, 'black to white beside it: full edge');
  assert.equal(d[(1 * 3 + 2) * 4], 255, 'all white around it: no edge');
});

test('vignette darkens or lightens the corners only', () => {
  const dark = vignette(grays(10, 10, new Array(100).fill(200)), 10, 10, 100, 50, 50);
  assert.equal(dark[(4 * 10 + 4) * 4], 200, 'the middle is untouched');
  assert.equal(dark[0], 0, 'a corner is beyond size + softness');
  const light = vignette(grays(10, 10, new Array(100).fill(200)), 10, 10, -100, 50, 50);
  assert.equal(light[0], 255);
});

test('oil paint keeps edges and evens out', () => {
  assert.deepEqual(reds(oilPaint(grays(6, 1, [0, 0, 0, 255, 255, 255]), 6, 1, 1)), [0, 0, 0, 255, 255, 255], 'a clean edge stays');
  const d = oilPaint(grays(7, 1, [0, 0, 0, 90, 0, 0, 0]), 7, 1, 1);
  assert.equal(d[2 * 4], 0, 'beside the speck the even side wins');
  assert.equal(d[3 * 4], 45, 'the speck itself: both sides equally uneven, the first one averages to 45');
  assert.equal(d[3 * 4 + 3], 255);
});

test('wave shifts rows and columns along sine waves', () => {
  const w = 8, h = 8, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = 10 * x; d[i + 1] = 10 * y; d[i + 3] = 255; }
  wave(d, w, h, 1, 4);
  const at = (x, y) => [d[(y * w + x) * 4], d[(y * w + x) * 4 + 1]];
  assert.deepEqual(at(0, 0), [0, 0], 'sin 0 = 0: no shift');
  assert.deepEqual(at(1, 1), [20, 20], 'a quarter wave: one pixel right and down');
  assert.deepEqual(at(1, 2), [10, 30], 'half a wave across, a quarter down');
});

test('clouds blend the two colours by the noise', () => {
  const d = clouds(new Uint8ClampedArray(4 * 4 * 4), 4, 4, 16, 1, [0, 0, 0], [200, 100, 0]);
  const v = noiseAt(0, 0, 4);
  assert.deepEqual([...d.slice(0, 4)], [Math.round(200 * v), Math.round(100 * v), 0, 255], 'a lattice point is its noise value');
  for (let x = 0; x < 50; x++) { const c = cloudAt(x * 7, x * 3, 20, 5); assert.ok(c >= 0 && c <= 1.9375, 'within the octaves\' total'); }
  assert.ok(FILTER_BY_ID.clouds.twoColors);
});
