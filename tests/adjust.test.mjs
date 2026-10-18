// Correction layers (adjust.js): cleaning up corrections and turning them into GPU filter steps.
// Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAdjust, defaultAdjust, adjustSpec, adjustFields, mulMatrix, hueMatrix, saturateMatrix, gradientTables, ADJUSTMENTS } from '../web/js/adjust.js';
import { sanitizeDoc } from '../web/js/doc.js';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≈ ${b}`);
const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

test('corrections are cleaned up', () => {
  assert.equal(sanitizeAdjust(null), null);
  assert.equal(sanitizeAdjust({ type: 'blur' }), null, 'blur is a filter, not a correction');
  assert.deepEqual(sanitizeAdjust({ type: 'brightness', params: { brightness: 500, contrast: 'x' } }),
    { type: 'brightness', params: { brightness: 100, contrast: 0 } }, 'clamped to the slider, bad value = default');
  assert.deepEqual(sanitizeAdjust({ type: 'gradmap', params: { colors: 'sky', stops: [[2, [300, 0, 0]], [-1, [0, 0, 255, 255]], 'bad'] } }),
    { type: 'gradmap', params: { colors: 'sky', stops: [[0, [0, 0, 255, 255]], [1, [255, 0, 0, 255]]] } }, 'stops clamped and sorted');
  assert.deepEqual(sanitizeAdjust({ type: 'gradmap', params: { stops: [[0, [1, 2, 3, 4]]] } }).params.stops,
    [[0, [0, 0, 0, 255]], [1, [255, 255, 255, 255]]], 'one stop is not a gradient: black to white');
  for (const [type] of ADJUSTMENTS) assert.equal(defaultAdjust(type).type, type, `${type} has defaults`);
  assert.ok(!adjustFields('gradmap').some(f => f.key === 'mix'), 'the layer opacity does the strength');
});

test('default corrections change nothing', () => {
  assert.deepEqual(adjustSpec(defaultAdjust('hsl')), [], 'no hue, saturation or lightness change');
  const b = adjustSpec(defaultAdjust('brightness'))[0];
  assert.equal(b.r.length, 256);
  b.r.forEach((v, i) => near(v, i / 255, `brightness table ${i}`));
});

test('per-channel corrections become lookup tables', () => {
  assert.deepEqual(adjustSpec({ type: 'invert' }), [{ kind: 'table', r: [1, 0], g: [1, 0], b: [1, 0] }]);
  const bright = adjustSpec({ type: 'brightness', params: { brightness: 100, contrast: 0 } })[0];
  assert.equal(bright.r[0], 1, 'black + 255 is white');
  const lv = adjustSpec({ type: 'levels', params: { inLow: 0, inHigh: 255, gamma: 1, outLow: 0, outHigh: 127 } })[0];
  near(lv.g[255], 127 / 255, 'white squeezed to 127');
  near(lv.g[0], 0, 'black stays');
  const post = adjustSpec({ type: 'posterize', params: { levels: 2 } })[0];
  assert.equal(post.b[127], 0); assert.equal(post.b[128], 1);
  const bal = adjustSpec({ type: 'balance', params: { red: 100, green: 0, blue: 0 } })[0];
  near(bal.r[0], 0, 'black stays'); near(bal.r[255], 1, 'white stays');
  near(bal.r[128], Math.round(128 + 64 * 4 * (128 / 255) * (127 / 255)) / 255, 'midtones pushed towards red');
  near(bal.g[128], 128 / 255, 'green untouched');
});

test('threshold and gradient map read the brightness first', () => {
  const [m, t] = adjustSpec({ type: 'threshold', params: { threshold: 128 } });
  assert.equal(m.kind, 'matrix');
  assert.deepEqual(m.values.slice(0, 5), [0.299, 0.587, 0.114, 0, 0]);
  assert.deepEqual(m.values.slice(15), [0, 0, 0, 1, 0], 'alpha kept');
  assert.equal(t.r[127], 0); assert.equal(t.r[128], 1);
  const g = gradientTables([[0, [255, 0, 0, 255]], [1, [0, 0, 255, 255]]]);
  assert.equal(g.r[0], 1); assert.equal(g.b[0], 0);
  assert.equal(g.r[255], 0); assert.equal(g.b[255], 1);
  near(g.r[51], 0.8, 'a fifth of the way: 80% red');
});

test('colour matrices', () => {
  hueMatrix(0).forEach((v, i) => near(v, IDENTITY[i], `hue 0 [${i}]`));
  saturateMatrix(1).forEach((v, i) => near(v, IDENTITY[i], `saturate 1 [${i}]`));
  const gray = saturateMatrix(0);
  [0, 1, 2].forEach(i => near(gray[i], 1 / 3, 'saturate 0: every channel the mean'));
  // 120°: red to green, green to blue, blue to red
  const h = hueMatrix(120), apply = c => [0, 1, 2].map(r => h[r * 5] * c[0] + h[r * 5 + 1] * c[1] + h[r * 5 + 2] * c[2]);
  apply([1, 0, 0]).forEach((v, i) => near(v, [0, 1, 0][i], 'red turns green'));
  apply([0, 0, 1]).forEach((v, i) => near(v, [1, 0, 0][i], 'blue turns red'));
  apply([0.5, 0.5, 0.5]).forEach(v => near(v, 0.5, 'gray stays'));
  // a: add 0.1 to red; b: double red; a after b: red = 2r + 0.1
  const a = [...IDENTITY]; a[4] = 0.1;
  const b = [...IDENTITY]; b[0] = 2;
  const ab = mulMatrix(a, b);
  assert.equal(ab[0], 2); near(ab[4], 0.1, 'offset kept');
  const ba = mulMatrix(b, a);
  near(ba[4], 0.2, 'b after a doubles the offset too');
});

test('lightness moves towards black or white', () => {
  assert.deepEqual(adjustSpec({ type: 'hsl', params: { hue: 0, saturation: 0, lightness: 50 } }), [{ kind: 'table', r: [0.5, 1], g: [0.5, 1], b: [0.5, 1] }]);
  assert.deepEqual(adjustSpec({ type: 'hsl', params: { hue: 0, saturation: 0, lightness: -50 } }), [{ kind: 'table', r: [0, 0.5], g: [0, 0.5], b: [0, 0.5] }]);
  const [m] = adjustSpec({ type: 'hsl', params: { hue: 0, saturation: -100, lightness: 0 } });
  near(m.values[0], 1 / 3, 'saturation -100 is gray');
});

test('a correction layer loads without pixels, tone or effects', () => {
  const d = sanitizeDoc({ layers: [{ name: 'Fix', adjust: { type: 'levels', params: { gamma: 2 } }, tone: { cell: 8 }, effects: { border: { size: 3, color: '#000000' } } }] });
  const l = d.layers[0];
  assert.equal(l.adjust.type, 'levels');
  assert.equal(l.adjust.params.gamma, 2);
  assert.equal(l.tone, null);
  assert.equal(l.effects, null);
  assert.equal(sanitizeDoc({ layers: [{ adjust: { type: 'nope' } }] }).layers[0].adjust, undefined, 'an unknown correction is an ordinary layer');
});
