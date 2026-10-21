// Healing brush dabs. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rimOf, healGrid, healWeights, healPatch, rimMismatch, spotOffsets } from '../web/js/healing.js';
import { toolForKey, sanitizeSettings } from '../web/js/tools.js';

/** A d × d patch with colour f(x, y). */
const patch = (d, f) => { const p = new Uint8ClampedArray(d * d * 4); for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) p.set(f(x, y), (y * d + x) * 4); return p; };
const at = (p, d, x, y) => [...p.slice((y * d + x) * 4, (y * d + x) * 4 + 4)];

test('rim and grid sizes', () => {
  assert.deepEqual(rimOf(20), { r: 10, R: 8.5, n: 13 }, '2π × 8.5 / 4 = 13.4 samples');
  assert.equal(rimOf(4).n, 12, 'at least 12');
  assert.equal(rimOf(400).n, 64, 'at most 64');
  assert.deepEqual(healGrid(10), { step: 1, xs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  const g = healGrid(60);  // 60 / 24 = 2.5 → every 3rd pixel, 0 … 57, then the last one
  assert.equal(g.step, 3);
  assert.equal(g.xs.length, 21);
  assert.equal(g.xs.at(-2), 57);
  assert.equal(g.xs.at(-1), 59);
});

test('healWeights add up to 1 at every grid point', () => {
  const d = 30, w = healWeights(d), n = rimOf(d).n, g = healGrid(d).xs.length;
  assert.equal(w.length, g * g * n);
  for (let p = 0; p < g * g; p++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += w[p * n + k];
    assert.ok(Math.abs(s - 1) < 1e-5);
  }
  assert.equal(healWeights(d), w, 'kept per size');
});

test('a flat source takes the flat colour of the destination', () => {
  for (const d of [20, 60]) {  // per pixel, and through the coarse grid
    const out = healPatch(patch(d, () => [30, 60, 90, 255]), patch(d, () => [100, 100, 100, 255]), d);
    for (const [x, y] of [[0, 0], [d / 2, d / 2], [d - 1, 3]]) assert.deepEqual(at(out, d, x, y), [30, 60, 90, 255]);
  }
});

test('the detail of the source moves over, on the colour of the destination', () => {
  // source grey 100 with one bright pixel (150) in the middle, destination grey 50: the correction is −50 everywhere
  const d = 20, src = patch(d, (x, y) => x === 10 && y === 10 ? [150, 150, 150, 255] : [100, 100, 100, 255]);
  const out = healPatch(patch(d, () => [50, 50, 50, 255]), src, d);
  assert.deepEqual(at(out, d, 10, 10), [100, 100, 100, 255], '150 − 50');
  assert.deepEqual(at(out, d, 7, 10), [50, 50, 50, 255], '100 − 50');
});

test('only the rim of the destination counts, so a blemish inside it goes', () => {
  const d = 20, dst = patch(d, (x, y) => Math.abs(x - 10) <= 2 && Math.abs(y - 10) <= 2 ? [0, 0, 0, 255] : [50, 50, 50, 255]);
  const out = healPatch(dst, patch(d, () => [50, 50, 50, 255]), d);
  assert.deepEqual(at(out, d, 10, 10), [50, 50, 50, 255]);
});

test('a smooth slope in the destination is kept across the dab', () => {
  // red = 10 + 5x is harmonic, so the membrane gives it back inside (within the rim's pixel snapping: ±0.5 px × 5)
  const d = 20, out = healPatch(patch(d, x => [10 + 5 * x, 0, 0, 255]), patch(d, () => [0, 0, 0, 255]), d);
  for (const x of [4, 10, 15]) assert.ok(Math.abs(at(out, d, x, 10)[0] - (10 + 5 * x)) <= 3, `x = ${x}`);
});

test('a clear destination stays clear', () => {
  const d = 16, out = healPatch(patch(d, () => [0, 0, 0, 0]), patch(d, () => [255, 0, 0, 255]), d);
  assert.deepEqual(at(out, d, 8, 8), [0, 0, 0, 0], 'premultiplied red 255 − 255 = 0 with alpha 255 − 255 = 0');
});

test('rimMismatch: an even difference fits, a changing one does not', () => {
  const d = 20, grey = patch(d, () => [100, 100, 100, 255]);
  assert.equal(rimMismatch(grey, grey, d), 0);
  assert.ok(rimMismatch(grey, patch(d, () => [40, 70, 10, 255]), d) < 1e-6, 'the same difference all round');
  // left half 0, right half 200 against 100: about +100 on one side, −100 on the other → spread near 100² per channel
  const split = patch(d, x => x < 10 ? [0, 0, 0, 255] : [200, 200, 200, 255]);
  assert.ok(rimMismatch(grey, split, d) > 3 * 5000);
});

test('spotOffsets look a dab and a quarter away', () => {
  const o = spotOffsets(20);  // 25 straight, 25 / √2 = 17.7 → 18 diagonally
  assert.equal(o.length, 8);
  assert.deepEqual(o[0], [25, 0]);
  assert.deepEqual(o[4], [18, 18]);
});

test('healing brush: key and settings', () => {
  assert.equal(toolForKey('s', 'pen'), 'clone');
  assert.equal(toolForKey('s', 'clone'), 'heal');
  assert.equal(toolForKey('s', 'heal'), 'clone');
  assert.equal(sanitizeSettings({ heal: { heal: 'spot' } }).heal.heal, 'spot');
  assert.equal(sanitizeSettings({ heal: { heal: 'nope' } }).heal.heal, 'source');
});
