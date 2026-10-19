// Image filters and mask morphology. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FILTERS, FILTER_BY_ID, defaultParams, sanitizeParams, boxesForGauss, boxLine, blurPlane, gaussianBlur, sharpen, mosaic,
  brightnessContrastLut, levelsLut, posterizeLut, threshold, invert, rgbToHsl, hslToRgb, hueSaturation, mixByMask,
  motionBlur, addNoise, noiseAt, balanceLut, colorBalance, zoomBlur, spinBlur } from '../web/js/filters.js';
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

/** Opaque gray pixels from a list of values. */
const grays = vals => Uint8ClampedArray.from(vals.flatMap(v => [v, v, v, 255]));
const reds = d => [...d].filter((_, i) => i % 4 === 0);

test('motion blur averages along the direction only', () => {
  // horizontal, 3 px long: the 90 spreads over its neighbours (90 / 3 = 30); the ends repeat
  assert.deepEqual(reds(motionBlur(grays([0, 0, 90, 0, 0]), 5, 1, 3, 0)), [0, 30, 30, 30, 0]);
  assert.deepEqual(reds(motionBlur(grays([0, 0, 90, 0, 0]), 5, 1, 3, 90)), [0, 0, 90, 0, 0], 'vertical does not touch a single row');
  assert.deepEqual(reds(motionBlur(grays([0, 0, 90, 0, 0]), 1, 5, 3, 90)), [0, 30, 30, 30, 0], 'but blurs a column');
  assert.deepEqual(reds(motionBlur(grays([0, 0, 90, 0, 0]), 5, 1, 1, 0)), [0, 0, 90, 0, 0], '1 px long changes nothing');
  // 45°: 3 px along the diagonal is one step each way (r = round(1 * cos 45°) = 1); only the diagonal through the centre gets it
  const d = reds(motionBlur(grays([0, 0, 0, 0, 90, 0, 0, 0, 0]), 3, 3, 3, 45));
  assert.deepEqual(d, [30, 0, 0, 0, 30, 0, 0, 0, 30]);
  // transparency does not bleed colour: red next to clear stays pure red, only less opaque
  const t = motionBlur(Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0]), 3, 1, 3, 0);
  assert.deepEqual(px(t, 1), [255, 0, 0, 85]);
});

test('noise is repeatable, anchored to the doc and keeps alpha and clear pixels', () => {
  assert.equal(noiseAt(5, 7, 0), noiseAt(5, 7, 0));
  assert.notEqual(noiseAt(5, 7, 0), noiseAt(6, 7, 0));
  for (let i = 0; i < 50; i++) { const v = noiseAt(i, i * 3, 1); assert.ok(v >= 0 && v < 1); }
  const whole = addNoise(pixels(4, 1, [128, 128, 128, 200]), 4, 1, 50, 100, 10, 20);
  const right = addNoise(pixels(2, 1, [128, 128, 128, 200]), 2, 1, 50, 100, 12, 20);
  assert.deepEqual([...whole.slice(8)], [...right], 'the same doc pixel gets the same grain wherever the area starts');
  const gray = addNoise(pixels(3, 1, [128, 128, 128, 255]), 3, 1, 100, 0);
  for (let p = 0; p < 3; p++) {
    const [r, g, b, a] = px(gray, p);
    assert.ok(r === g && g === b, 'gray grain changes all channels alike');
    assert.equal(a, 255);
  }
  assert.deepEqual(px(addNoise(pixels(1, 1, [9, 9, 9, 0]), 1, 1, 100, 100), 0), [9, 9, 9, 0], 'clear pixels stay as they are');
});

test('colour balance moves the midtones and leaves black and white', () => {
  const up = balanceLut(100), down = balanceLut(-100);
  assert.equal(up[0], 0); assert.equal(up[255], 255);
  assert.equal(up[128], 192, '128 + 64 * 4t(1-t), t ≈ 0.5');
  assert.equal(down[128], 64);
  assert.equal(balanceLut(0)[77], 77);
  assert.deepEqual(px(colorBalance(pixels(1, 1, [128, 128, 128, 255]), 100, 0, -100), 0), [192, 128, 64, 255]);
});

test('curves', async () => {
  const { curvesLut, curves, sanitizeParams, defaultParams, FILTER_BY_ID } = await import('../web/js/filters.js');
  const id = curvesLut([[0, 0], [1, 1]]);
  assert.deepEqual([id[0], id[51], id[200], id[255]], [0, 51, 200, 255], 'the diagonal changes nothing');
  const inv = curvesLut([[0, 1], [1, 0]]);
  assert.deepEqual([inv[0], inv[51], inv[255]], [255, 204, 0], 'inverted: 1 - 0.2 = 0.8 of 255');
  // red inverted first, then everything halved by the RGB curve: 0 -> 255 -> 127.5 (rounds to 128); 128 -> 64; 255 -> 128
  const px = Uint8ClampedArray.from([0, 128, 255, 77]);
  curves(px, { rgb: [[0, 0], [1, 0.5]], r: [[0, 1], [1, 0]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });
  assert.deepEqual([...px], [128, 64, 128, 77], 'alpha untouched');
  const f = FILTER_BY_ID.curves;
  assert.deepEqual(sanitizeParams(f, { r: 'nope', g: [[0, 0.2], [1, 0.9]] }),
    { ...defaultParams(f), g: [[0, 0.2], [1, 0.9]] }, 'a broken curve becomes the diagonal');
});

test('zoom blur smears along the line to the centre', () => {
  const row = () => { const d = new Uint8ClampedArray(5 * 4); for (let i = 0; i < 5; i++) d[i * 4 + 3] = 255; d[3 * 4] = 90; return d; };
  const d = zoomBlur(row(), 5, 1, 1, 0.5, 0.5);  // centre on pixel 0
  assert.equal(d[0], 0, 'the centre pixel keeps itself (one sample)');
  assert.equal(d[2 * 4], 20, 'pixel 2 is 2 px out: 3 parts, samples at 3.17 (2/3 of the way to the 90), 2.5, 1.83 -> 60 / 3');
  assert.equal(d[4 * 4], 22, 'pixel 4: 5 parts, samples at 6.1, 5.3, 4.5 (all 0), 3.7 (72), 2.9 (36) -> 108 / 5 = 21.6');
  assert.equal(d[4 * 4 + 3], 255, 'alpha stays');
  const flat = new Uint8ClampedArray(6 * 6 * 4).fill(200);
  assert.ok(zoomBlur(flat, 6, 6, 0.5, 1, 4).every(v => v === 200), 'a flat image stays flat');
  // a long streak: two passes of 8 parts give 64 evenly spaced samples, so a lone pixel spreads evenly
  const long = new Uint8ClampedArray(200 * 4);
  for (let i = 0; i < 200; i++) long[i * 4 + 3] = 255;
  long[150 * 4] = 255;
  const z = zoomBlur(long, 200, 1, 0.5, 0.5, 0.5);
  const near150 = [];
  for (let x = 140; x <= 160; x++) near150.push(z[x * 4]);
  assert.ok(near150.every(v => v > 0 && v < 20), 'no gaps or spikes near it: ' + near150.join(' '));
});

test('spin blur smears round the centre', () => {
  const img = new Uint8ClampedArray(5 * 5 * 4);
  for (let i = 0; i < 25; i++) img[i * 4 + 3] = 255;
  img[(2 * 5 + 2) * 4] = 255;  // one red pixel two to the right of the centre pixel (0, 2)
  const d = spinBlur(img, 5, 5, 57.29578, 0.5, 2.5);
  const red = (x, y) => d[(y * 5 + x) * 4];
  assert.ok(red(2, 1) > 0 && red(2, 3) > 0, 'it spreads up and down (along the circle)');
  assert.equal(red(2, 1), red(2, 3), 'evenly both ways');
  assert.equal(red(1, 2), 0, 'not towards the centre');
  assert.equal(red(0, 2), 0, 'the centre pixel keeps itself');
  const flat = new Uint8ClampedArray(6 * 6 * 4).fill(120);
  assert.ok(spinBlur(flat, 6, 6, 30, 3, 3).every(v => v === 120), 'a flat image stays flat');
});

test('line extraction', async () => {
  const { extractLines } = await import('../web/js/filters.js');
  const w = 41, h = 41;
  // flat gray (shading) goes clear: the blur of a flat area is the area itself
  const flat = extractLines(pixels(w, h, [128, 128, 128, 255]), w, h, {});
  assert.ok(flat.every((v, i) => i % 4 !== 3 || v === 0), 'flat areas vanish');
  // a 1 px dark red line on white: the line is solid black ink, white paper and empty pixels are clear
  const d = pixels(w, h, [255, 255, 255, 255]);
  for (let y = 0; y < h; y++) d.set([200, 0, 0, 255], (y * w + 20) * 4);
  d.set([0, 0, 0, 0], 0);
  const out = extractLines(d.slice(), w, h, { radius: 3, threshold: 10, softness: 40 });
  assert.deepEqual(px(out, 20 * w + 20), [0, 0, 0, 255], 'the line: luminance 60 against nearly white');
  assert.equal(px(out, 20 * w + 21)[3], 0, 'paper next to it is lighter than its blur');
  assert.equal(px(out, 0)[3], 0, 'transparent counts as white paper');
  const kept = extractLines(d.slice(), w, h, { radius: 3, threshold: 10, softness: 40, color: 100 });
  assert.deepEqual(px(kept, 20 * w + 20), [200, 0, 0, 255], 'Keep color 100%: its own colour');
});

test('max filter and thick lines', async () => {
  const { maxFilter, extractLines } = await import('../web/js/filters.js');
  // 1 x 9: a 9 at index 4 spreads 2 each way; check against the plain definition for every window size
  const row = Float32Array.from([1, 0, 3, 0, 9, 0, 0, 5, 0]);
  assert.deepEqual([...maxFilter(row, 9, 1, 2)], [3, 3, 9, 9, 9, 9, 9, 5, 5]);
  const rnd = Float32Array.from({ length: 37 }, (_, i) => (i * 7919) % 23);
  for (const r of [1, 3, 5, 40]) {
    const want = [...rnd].map((_, i) => Math.max(...rnd.slice(Math.max(0, i - r), i + r + 1)));
    assert.deepEqual([...maxFilter(rnd, 37, 1, r)], want, `r = ${r}`);
  }
  // a 10 px wide black band on white is solid ink in the middle with Line width 12 (it sees white 7 px away)
  const w = 41, h = 9, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(i % w >= 15 && i % w < 25 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  const out = extractLines(d, w, h, { radius: 12 });
  assert.equal(out[(4 * w + 20) * 4 + 3], 255, 'the middle of the band');
  assert.equal(out[(4 * w + 5) * 4 + 3], 0, 'the paper');
});

test('gradient map: lightness picks a colour along the stops', async () => {
  const { gradientMap, parseStopColor } = await import('../web/js/filters.js');
  assert.deepEqual(parseStopColor('#ff8000'), [255, 128, 0, 255]);
  assert.deepEqual(parseStopColor('rgba(10,20,30,0)'), [10, 20, 30, 0]);
  const stops = [[0, [0, 0, 255, 255]], [1, [255, 255, 0, 255]]];  // dark -> blue, light -> yellow
  const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 100]);
  gradientMap(d, stops);
  assert.deepEqual([...d], [0, 0, 255, 255, 255, 255, 0, 255, 128, 128, 127, 100], 'gray 128 lands halfway: 128/255 of the way; alpha kept');
  const half = new Uint8ClampedArray([0, 0, 0, 255]);
  gradientMap(half, stops, 0.5);
  assert.deepEqual([...half], [0, 0, 128, 255], 'Strength 50%: halfway from black to blue');
  const fade = new Uint8ClampedArray([255, 255, 255, 200]);
  gradientMap(fade, [[0, [0, 0, 0, 255]], [1, [0, 0, 0, 0]]]);
  assert.equal(fade[3], 0, 'a transparent stop clears the light parts');
});

test('offset wraps round the edges', async () => {
  const { offsetWrap } = await import('../web/js/filters.js');
  const d = new Uint8ClampedArray([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255]);
  offsetWrap(d, 3, 1, 1, 0);
  assert.deepEqual([d[0], d[4], d[8]], [3, 1, 2], 'one to the right: the last comes round to the front');
  offsetWrap(d, 3, 1, -4, 0);
  assert.deepEqual([d[0], d[4], d[8]], [1, 2, 3], 'four to the left is one to the left');
  const v = new Uint8ClampedArray([5, 0, 0, 255, 6, 0, 0, 255]);
  offsetWrap(v, 1, 2, 0, 1);
  assert.deepEqual([v[0], v[4]], [6, 5], 'down');
  assert.equal(FILTER_BY_ID.offset.margin({}), 1e6, 'reads the whole canvas');
});

test('glow spills light from bright parts only', async () => {
  const { glow } = await import('../web/js/filters.js');
  const w = 9, h = 1, d = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) d.set([0, 0, 0, 255], x * 4);
  d.set([255, 255, 255, 255], 4 * 4);
  glow(d, w, h, 2, 1, 128);
  assert.ok(d[3 * 4] > 0, 'the neighbour of the white pixel lights up');
  assert.ok(d[3 * 4] > d[1 * 4], 'less further away');
  assert.equal(d[4 * 4], 255, 'white stays white');
  const dim = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) dim.set([100, 100, 100, 255], x * 4);
  glow(dim, w, h, 2, 1, 128);
  assert.equal(dim[0], 100, 'nothing brighter than the threshold: no glow');
  const clear = new Uint8ClampedArray(w * 4);
  clear.set([255, 255, 255, 255], 4 * 4);
  glow(clear, w, h, 2, 1, 128);
  assert.ok(clear[3 * 4 + 3] > 0, 'glow reaches onto see-through pixels');
  assert.equal(clear[3 * 4], 255, 'as white light');
});

test('chromatic aberration pushes red out and blue in', async () => {
  const { chromaticAberration } = await import('../web/js/filters.js');
  const w = 5, flat = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) flat.set([10, 20, 30, 255], x * 4);
  chromaticAberration(flat, w, 1, 1, 2.5, 0.5, 2.5);
  assert.deepEqual(px(flat, 4), [10, 20, 30, 255], 'a flat colour stays');
  const d = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) d.set([0, 0, 0, 255], x * 4);
  d.set([255, 0, 0, 255], 3 * 4);
  chromaticAberration(d, w, 1, 1, 2.5, 0.5, 2.5);
  // pixel 4 (centre 4.5) is 2 from the centre: shifted 0.8, red read at 3.7 = 80% of pixel 3
  assert.equal(d[4 * 4], 204);
  assert.equal(d[2 * 4], 0, 'the centre pixel is not shifted');
});

test('dust cleaner removes small specks and keeps big ones', async () => {
  const { removeDust } = await import('../web/js/filters.js');
  // 10 x 10 clear; a 1-px speck at (2,2), a 2x2 blob at (6,6) (4 px), a speck on the edge at (0,5)
  const w = 10, h = 10, d = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, a = 255) => { const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = a; };
  put(2, 2); put(6, 6); put(7, 6); put(6, 7); put(7, 7); put(0, 5);
  put(3, 2, 20);  // faint edge of the speck: cleared with it
  removeDust(d, w, h, 3);
  const a = (x, y) => d[(y * w + x) * 4 + 3];
  assert.equal(a(2, 2), 0, 'speck removed');
  assert.equal(a(3, 2), 0, 'its faint edge too');
  assert.equal(a(6, 6), 255, '4-px blob kept (not smaller than 3)');
  assert.equal(a(0, 5), 255, 'speck on the edge kept');
  // on white paper the speck becomes white
  const p = new Uint8ClampedArray(5 * 5 * 4).fill(255);
  p.set([0, 0, 0, 255], (2 * 5 + 2) * 4);
  removeDust(p, 5, 5, 2);
  assert.deepEqual([...p.slice(48, 52)], [255, 255, 255, 255]);
});

test('median removes a lone pixel and keeps an edge', async () => {
  const { median } = await import('../web/js/filters.js');
  // 5 x 5 opaque gray 100 with one white pixel in the middle: the 3x3 median is 100 everywhere
  const d = new Uint8ClampedArray(100);
  for (let i = 0; i < 25; i++) d.set([100, 100, 100, 255], i * 4);
  d.set([255, 255, 255, 255], 12 * 4);
  median(d, 5, 5, 1);
  assert.deepEqual([...d.slice(48, 52)], [100, 100, 100, 255]);
  // left two columns black, the rest white: a straight edge stays where it is
  const e = new Uint8ClampedArray(100);
  for (let i = 0; i < 25; i++) e.set(i % 5 < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  median(e, 5, 5, 1);
  const row = [0, 1, 2, 3, 4].map(x => e[(2 * 5 + x) * 4]);
  assert.deepEqual(row, [0, 0, 255, 255, 255]);
  // corner pixel (0,0) sees 4 values (2x2): black, black, black, black -> black; (2,0) sees 0,255,255 x2 rows -> 255
  assert.equal(e[0], 0);
});
