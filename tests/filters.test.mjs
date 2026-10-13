// Image filters and mask morphology. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTERS, FILTER_BY_ID, defaultParams, sanitizeParams, boxesForGauss, boxLine, blurPlane, gaussianBlur, sharpen, mosaic,
  brightnessContrastLut, levelsLut, posterizeLut, threshold, invert, rgbToHsl, hslToRgb, hueSaturation, mixByMask } from '../web/js/filters.js';
import { chamferDistance, expandMask, shrinkMask, featherMask } from '../web/js/maskops.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);

/** w x h pixels, all of one RGBA colour. */
function pixels(w, h, [r, g, b, a]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
  return d;
}
const px = (d, i) => [...d.slice(i * 4, i * 4 + 4)];

test('filter table', () => {
  const ids = FILTERS.filter(x => x !== '-').map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) {
    const f = FILTER_BY_ID[id];
    for (const x of f.fields) assert.ok(x.value >= x.min && x.value <= x.max, `${id}.${x.key} default in range`);
    assert.equal(typeof f.margin(defaultParams(f)), 'number');
  }
  assert.deepEqual(defaultParams(FILTER_BY_ID.brightness), { brightness: 0, contrast: 0 });
  assert.deepEqual(sanitizeParams(FILTER_BY_ID.blur, { radius: 500 }), { radius: 100 }, 'clamped');
  assert.deepEqual(sanitizeParams(FILTER_BY_ID.blur, { radius: 'x' }), { radius: 5 }, 'default');
  assert.equal(FILTER_BY_ID.blur.margin({ radius: 5 }), 15, 'a blur reaches three radii');
});

test('box blur along a line repeats the ends', () => {
  const dst = new Float32Array(5);
  boxLine(new Float32Array([0, 0, 10, 0, 0]), dst, 0, 1, 5, 1);
  assert.deepEqual([...dst].map(v => Math.round(v * 1000) / 1000), [0, 3.333, 3.333, 3.333, 0]);
  boxLine(new Float32Array([9, 0, 0]), dst, 0, 1, 3, 1);
  assert.deepEqual([...dst.slice(0, 3)], [6, 3, 0], 'at the start the first value counts twice: (9+9+0)/3');
  // step: every other value is a separate line
  const col = new Float32Array([5, 100, 5, 100, 5, 100]);
  boxLine(col, dst, 0, 2, 3, 1);
  assert.deepEqual([...dst.slice(0, 5)].filter((_, i) => i % 2 === 0), [5, 5, 5], 'only the 5s are read');
});

test('box sizes for a Gaussian', () => {
  assert.deepEqual(boxesForGauss(2), [3, 3, 5], 'ideal width sqrt(17) = 4.1 -> 3 and 5, m = 1.5 rounds to 2');
  for (const s of [0.5, 1, 3, 10, 50]) {
    const b = boxesForGauss(s);
    assert.equal(b.length, 3);
    assert.ok(b.every(w => w % 2 === 1), 'odd widths');
    assert.ok(b[0] <= b[1] && b[1] <= b[2], 'small boxes first');
  }
});

test('blurring a plane keeps its total and spreads symmetrically', () => {
  const w = 21, h = 21, plane = new Float32Array(w * h);
  plane[10 * w + 10] = 1000;
  blurPlane(plane, w, h, 3);
  let sum = 0;
  for (const v of plane) sum += v;
  near(sum, 1000, 1e-2, 'nothing is lost away from the edges');
  near(plane[10 * w + 7], plane[10 * w + 13], 1e-4, 'left = right');
  near(plane[7 * w + 10], plane[10 * w + 7], 1e-4, 'up = left');
  assert.ok(plane[10 * w + 10] > plane[10 * w + 11] && plane[10 * w + 11] > plane[10 * w + 12], 'falls off from the centre');
  const flat = new Float32Array(w * h).fill(7);
  blurPlane(flat, w, h, 10);
  assert.ok([...flat].every(v => Math.abs(v - 7) < 1e-4), 'a flat plane stays flat');
});

test('Gaussian blur does not darken edges against transparency', () => {
  const w = 9, h = 9, d = pixels(w, h, [0, 0, 0, 0]);
  d.set([255, 0, 0, 255], (4 * w + 4) * 4);
  gaussianBlur(d, w, h, 3);
  let touched = 0;
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = px(d, i);
    if (!a) continue;
    touched++;
    assert.ok(r >= 254 && g === 0 && b === 0, `pixel ${i} stays red: ${r},${g},${b},${a}`);
  }
  assert.ok(touched > 1 && touched < w * h, 'the red spread but not everywhere');
  const flat = pixels(5, 5, [10, 20, 30, 200]);
  gaussianBlur(flat, 5, 5, 4);
  assert.deepEqual(px(flat, 12), [10, 20, 30, 200], 'a flat image stays flat');
});

test('sharpen pushes an edge apart and leaves flat areas alone', () => {
  const w = 20, d = pixels(w, 1, [0, 0, 0, 255]);
  for (let x = 0; x < w; x++) d[x * 4] = d[x * 4 + 1] = d[x * 4 + 2] = x < 10 ? 50 : 200;
  sharpen(d, w, 1, 1, 2);
  assert.ok(d[10 * 4] > 200, 'light side of the edge gets lighter');
  assert.ok(d[9 * 4] < 50, 'dark side gets darker');
  assert.equal(d[0], 50); assert.equal(d[19 * 4], 200);
  assert.equal(d[9 * 4 + 3], 255, 'alpha is kept');
});

test('mosaic averages each cell, weighting by alpha, anchored to the doc grid', () => {
  // 4x2, cells of 2: left cell = four grays, right cell = two opaque reds and two transparent greens
  const d = new Uint8ClampedArray([
    0, 0, 0, 255, 100, 100, 100, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    200, 200, 200, 255, 100, 100, 100, 255, 0, 255, 0, 0, 0, 255, 0, 0,
  ]);
  mosaic(d, 4, 2, 2);
  assert.deepEqual(px(d, 0), [100, 100, 100, 255], '(0+100+200+100)/4');
  assert.deepEqual(px(d, 5), [100, 100, 100, 255]);
  assert.deepEqual(px(d, 2), [255, 0, 0, 128], 'transparent pixels add no colour; alpha 510/4 = 127.5');
  assert.deepEqual(px(d, 7), [255, 0, 0, 128]);
  const row = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255, 40, 40, 40, 255, 80, 80, 80, 255]);
  mosaic(row, 4, 1, 2, 1, 0);
  assert.deepEqual([0, 1, 2, 3].map(i => row[i * 4]), [10, 30, 30, 80], 'starting at doc x=1, the cells are [0], [1,2], [3]');
});

test('brightness and contrast', () => {
  const id = brightnessContrastLut(0, 0);
  assert.ok([0, 1, 100, 128, 254, 255].every(v => id[v] === v), 'zero is the identity');
  assert.equal(brightnessContrastLut(10, 0)[100], 126, '100 + 25.5');
  assert.equal(brightnessContrastLut(100, 0)[0], 255);
  const flat = brightnessContrastLut(0, -100);
  assert.ok([0, 100, 255].every(v => flat[v] === 128), 'contrast -100 is flat mid gray');
  const hard = brightnessContrastLut(0, 100);
  assert.equal(hard[127], 0); assert.equal(hard[128], 128); assert.equal(hard[129], 255);
});

test('levels', () => {
  const id = levelsLut({});
  assert.ok([0, 7, 128, 255].every(v => id[v] === v));
  const black = levelsLut({ inLow: 50 });
  assert.equal(black[50], 0); assert.equal(black[30], 0); assert.equal(black[255], 255);
  assert.equal(black[152], 127, '102/205 * 255 = 126.9');
  assert.equal(levelsLut({ inHigh: 100, gamma: 2 })[25], 128, 't = .25, sqrt = .5, 127.5 rounds up');
  const out = levelsLut({ outLow: 100, outHigh: 200 });
  assert.equal(out[0], 100); assert.equal(out[255], 200); assert.equal(out[51], 120, '100 + .2 * 100');
});

test('posterize, threshold, invert', () => {
  const two = posterizeLut(2);
  assert.equal(two[127], 0); assert.equal(two[128], 255);
  const four = posterizeLut(4);
  assert.equal(four[63], 0); assert.equal(four[64], 85); assert.equal(four[100], 85); assert.equal(four[255], 255);
  const d = new Uint8ClampedArray([200, 200, 200, 255, 100, 100, 100, 40, 0, 255, 0, 255, 0, 0, 255, 255]);
  threshold(d, 128);
  assert.deepEqual([...d], [255, 255, 255, 255, 0, 0, 0, 40, 255, 255, 255, 255, 0, 0, 0, 255], 'green is bright (150), blue dark (29); alpha kept');
  assert.deepEqual([...invert(new Uint8ClampedArray([0, 100, 255, 7]))], [255, 155, 0, 7]);
});

test('HSL round trip and hue/saturation/lightness', () => {
  assert.deepEqual(rgbToHsl(255, 0, 0), [0, 1, 0.5]);
  assert.deepEqual(rgbToHsl(0, 255, 255), [180, 1, 0.5]);
  assert.deepEqual(hslToRgb(120, 1, 0.5).map(Math.round), [0, 255, 0]);
  for (const c of [[12, 200, 99], [255, 255, 255], [0, 0, 0], [77, 77, 77], [200, 10, 150]]) {
    assert.deepEqual(hslToRgb(...rgbToHsl(...c)).map(Math.round), c);
  }
  const red = () => new Uint8ClampedArray([255, 0, 0, 255]);
  assert.deepEqual([...hueSaturation(red(), 180, 0, 0)], [0, 255, 255, 255], 'red turned half way round is cyan');
  assert.deepEqual([...hueSaturation(red(), 0, -100, 0)], [128, 128, 128, 255], 'no saturation: mid gray');
  assert.deepEqual([...hueSaturation(red(), 0, 0, 100)], [255, 255, 255, 255]);
  assert.deepEqual([...hueSaturation(red(), 0, 0, -100)], [0, 0, 0, 255]);
  const more = hueSaturation(new Uint8ClampedArray([192, 128, 128, 255]), 0, 100, 0);
  near(more[0], 255, 1, 'l = .627: full saturation gives r = (c + m)');
  near(more[1], 65, 1, 'g = m = l - c/2 = .2549');
  assert.equal(more[2], more[1]);
});

test('mixing a filtered copy by a mask', () => {
  const orig = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const filt = new Uint8ClampedArray([100, 200, 50, 255, 100, 200, 50, 255, 100, 200, 50, 255]);
  mixByMask(orig, filt, new Uint8Array([255, 0, 128]));
  assert.deepEqual([...orig], [100, 200, 50, 255, 0, 0, 0, 255, 50, 100, 25, 255], 'all, none, 128/255 of the way');
});

test('chamfer distance: 3 per step, 4 per diagonal', () => {
  const set = new Uint8Array(25);
  set[2 * 5 + 2] = 1;
  const d = chamferDistance(set, 5, 5);
  assert.equal(d[12], 0);
  assert.equal(d[11], 3); assert.equal(d[6], 4); assert.equal(d[10], 6); assert.equal(d[5], 7); assert.equal(d[0], 8);
  const b = chamferDistance(new Uint8Array(9), 3, 3, true);
  assert.deepEqual([...b], [3, 3, 3, 3, 6, 3, 3, 3, 3], 'beyond the canvas counts as the set');
});

test('expand and shrink', () => {
  const one = new Uint8Array(25);
  one[12] = 255;
  const plus = expandMask(one, 5, 5, 1);
  const on = m => [...m].map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  assert.deepEqual(on(plus), [7, 11, 12, 13, 17], 'orthogonal neighbours (3) but not diagonals (4)');
  assert.equal(on(expandMask(one, 5, 5, 2)).length, 13, 'distance <= 6: a diamond with its diagonals');
  const faint = new Uint8Array(25);
  faint[12] = 255; faint[0] = 100;
  assert.equal(expandMask(faint, 5, 5, 1)[0], 100, 'faint pixels outside the reach are left as they are');
  const all = new Uint8Array(25).fill(255);
  assert.deepEqual(on(shrinkMask(all, 5, 5, 1)), [6, 7, 8, 11, 12, 13, 16, 17, 18], 'the canvas edge counts as outside');
  assert.deepEqual(on(shrinkMask(all, 5, 5, 2)), [12]);
  const block = new Uint8Array(36);
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) block[y * 6 + x] = 255;
  assert.deepEqual(on(shrinkMask(block, 6, 6, 1)), [14, 15, 20, 21], 'a 4x4 block shrinks to its middle 2x2');
});

test('feather softens an edge symmetrically', () => {
  const w = 40, m = new Uint8Array(w);
  for (let x = 0; x < 20; x++) m[x] = 255;
  const f = featherMask(m, w, 1, 4);
  assert.equal(f[0], 255); assert.equal(f[39], 0);
  assert.equal(f[19] + f[20], 255, 'the two pixels either side of the edge add up to full');
  for (let x = 1; x < w; x++) assert.ok(f[x] <= f[x - 1], 'never rises again');
  assert.ok(f[19] < 255 && f[20] > 0, 'the edge is soft');
  const flat = featherMask(new Uint8Array(16).fill(255), 4, 4, 3);
  assert.ok([...flat].every(v => v === 255), 'a full mask stays full');
});
