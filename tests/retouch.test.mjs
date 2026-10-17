// Retouch dabs, layer effects, colour sliders and the line-colour filters. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mixDab, toneDab, copyRegion, blurRadius, blurredPatch } from '../web/js/retouch.js';
import { sanitizeEffects, effectReach, borderAlpha, shadowAlpha, effectsImage } from '../web/js/effects.js';
import { sliderValues, fromSlider, sliderStops } from '../web/js/color.js';
import { recolor, whiteToAlpha, FILTER_BY_ID } from '../web/js/filters.js';
import { toolForKey, sanitizeSettings } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

/** n pixels of one RGBA colour. */
const fill = (n, c) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) d.set(c, i * 4); return d; };
const px = (d, i) => [...d.slice(i * 4, i * 4 + 4)];

test('mixDab moves towards the source under a hard tip', () => {
  // d = 2: every pixel centre is 0.71 px from the middle, inside the solid core of a hard tip, so t = strength
  const dst = fill(4, [255, 0, 0, 255]);
  mixDab(dst, fill(4, [0, 0, 255, 255]), 2, 0.25, 1);
  assert.deepEqual(px(dst, 0), [191, 0, 64, 255], '255 × 0.75 and 255 × 0.25');
  const clearing = fill(4, [255, 0, 0, 255]);
  mixDab(clearing, fill(4, [0, 0, 0, 0]), 2, 0.5, 1);
  assert.deepEqual(px(clearing, 3), [255, 0, 0, 128], 'a clear source thins the paint without darkening it');
  const locked = fill(4, [255, 0, 0, 255]);
  mixDab(locked, fill(4, [0, 0, 0, 0]), 2, 0.5, 1, true);
  assert.equal(locked[3], 255, 'alpha lock keeps the alpha');
});

test('toneDab lightens or darkens and keeps alpha', () => {
  const burnt = fill(4, [200, 100, 50, 90]);
  toneDab(burnt, 2, 0.5, 1, true);
  assert.deepEqual(px(burnt, 0), [100, 50, 25, 90]);
  const dodged = fill(4, [200, 100, 50, 255]);
  toneDab(dodged, 2, 0.2, 1, false);
  assert.deepEqual(px(dodged, 1), [211, 131, 91, 255], '200 + 55 × 0.2, 100 + 155 × 0.2, 50 + 205 × 0.2');
});

test('copyRegion clears what is outside the image', () => {
  const data = new Uint8ClampedArray(6 * 4);
  for (let i = 0; i < 6; i++) data.set([i, i, i, 255], i * 4);
  const out = copyRegion(data, 3, 2, -1, 1, 3, 2);
  assert.deepEqual(px(out, 0), [0, 0, 0, 0], 'x = -1 is outside');
  assert.deepEqual(px(out, 1), [3, 3, 3, 255], 'image pixel (0, 1)');
  assert.deepEqual(px(out, 2), [4, 4, 4, 255], 'image pixel (1, 1)');
  assert.deepEqual(px(out, 3), [0, 0, 0, 0], 'row 2 is below the image');
});

test('the blur tool leaves an even area as it is', () => {
  assert.equal(blurRadius(16), 2);
  assert.equal(blurRadius(2), 1, 'at least 1 px');
  const W = 20, img = fill(W * W, [100, 100, 100, 255]);
  const out = blurredPatch(img, W, W, 8, 8, 4);
  for (let i = 0; i < 16; i++) assert.deepEqual(px(out, i), [100, 100, 100, 255]);
});

test('sanitizeEffects', () => {
  assert.equal(sanitizeEffects(null), null);
  assert.equal(sanitizeEffects({}), null, 'neither effect: none');
  assert.deepEqual(sanitizeEffects({ border: { size: 500, color: 'red' } }), { border: { size: 100, color: '#ffffff' }, shadow: null });
  assert.deepEqual(sanitizeEffects({ shadow: {} }).shadow, { x: 8, y: 8, blur: 8, color: '#000000', opacity: 0.5 });
  assert.equal(sanitizeEffects({ shadow: { x: -999, opacity: 3 } }).shadow.x, -300);
  assert.equal(sanitizeEffects({ shadow: { opacity: 3 } }).shadow.opacity, 1);
});

test('effectReach', () => {
  assert.equal(effectReach(null), 0);
  assert.equal(effectReach({ border: { size: 4 } }), 5);
  assert.equal(effectReach({ shadow: { x: -10, y: 3, blur: 4 } }), 17, '10 offset + 6 blur + 1');
  assert.equal(effectReach({ border: { size: 4 }, shadow: { x: -10, y: 3, blur: 4 } }), 22, 'the shadow falls from the border too');
});

test('borderAlpha grows the paint with a soft outer pixel', () => {
  const a = new Uint8ClampedArray(7);
  a[3] = 255;
  assert.deepEqual([...borderAlpha(a, 7, 1, 2)], [0, 128, 255, 255, 255, 128, 0], '1 px away full, 2 px away half');
});

test('shadowAlpha moves and fades the alpha', () => {
  const a = new Uint8ClampedArray(5);
  a[1] = 200;
  assert.deepEqual([...shadowAlpha(a, 5, 1, 2, 0, 0, 0.5)], [0, 0, 0, 100, 0]);
});

test('effectsImage draws the border colour under the paint', () => {
  const data = new Uint8ClampedArray(3 * 4);
  data.set([0, 0, 255, 255], 4);
  const out = effectsImage(data, 3, 1, { border: { size: 1, color: '#ff0000' }, shadow: null });
  assert.deepEqual(px(out, 0), [255, 0, 0, 128]);
  assert.deepEqual(px(out, 1), [255, 0, 0, 255]);
});

test('layer effects are saved with layers', () => {
  const d = sanitizeDoc({ layers: [{ effects: { border: { size: 3, color: '#123456' } } }, {}] });
  assert.deepEqual(d.layers[0].effects, { border: { size: 3, color: '#123456' }, shadow: null });
  assert.equal(d.layers[1].effects, null);
});

test('colour sliders', () => {
  assert.deepEqual(sliderValues('hsv', [120, 0.5, 0.25]), { h: 120, s: 50, v: 25 });
  assert.deepEqual(sliderValues('rgb', [0, 1, 1]), { r: 255, g: 0, b: 0 });
  assert.deepEqual(fromSlider('rgb', [0, 1, 1], 'g', 255), [60, 1, 1], 'red + green = yellow');
  assert.deepEqual(fromSlider('rgb', [200, 1, 0], 'r', 0), [200, 0, 0], 'black keeps the hue');
  assert.deepEqual(fromSlider('hsv', [10, 0.2, 0.3], 's', 150), [10, 1, 0.3]);
  assert.deepEqual(sliderStops('rgb', [0, 1, 1], 'g'), ['#ff0000', '#ffff00']);
  const hue = sliderStops('hsv', [0, 0, 0], 'h');
  assert.equal(hue.length, 7);
  assert.equal(hue[2], '#00ff00', '120°');
});

test('recolor and whiteToAlpha', () => {
  assert.deepEqual([...recolor(new Uint8ClampedArray([10, 20, 30, 77]), [1, 2, 3])], [1, 2, 3, 77]);
  const d = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 255, 128, 128, 255, 0, 0, 0, 128]);
  whiteToAlpha(d);
  assert.equal(d[3], 0, 'white goes');
  assert.deepEqual(px(d, 1), [0, 0, 0, 255], 'black stays');
  assert.deepEqual(px(d, 2), [0, 0, 0, 127], 'mid gray is half-clear black');
  assert.deepEqual(px(d, 3), [255, 0, 0, 127], 'pink is half-clear red');
  assert.deepEqual(px(d, 4), [0, 0, 0, 128], 'existing transparency is kept');
  assert.ok(FILTER_BY_ID.recolor.mainColor);
});

test('retouch tools: keys and settings', () => {
  assert.equal(toolForKey('o', 'pen'), 'dodge');
  assert.equal(toolForKey('o', 'dodge'), 'burn');
  assert.equal(toolForKey('j', 'liquify'), 'blur');
  assert.equal(toolForKey('j', 'blur'), 'smudge');
  assert.equal(toolForKey('s', 'pen'), 'clone');
  const s = sanitizeSettings({ clone: { aligned: 0, sample: 'nope' } }).clone;
  assert.equal(s.aligned, false);
  assert.equal(s.sample, 'layer');
});
