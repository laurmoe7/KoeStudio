// Blend modes the canvas lacks: the formulas worked out by hand (Photoshop / Clip Studio Paint definitions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendChannel, blendColor, blendPixels, isCustomBlend, CUSTOM_BLENDS, BLEND_SHADER } from '../web/js/blendmodes.js';
import { BLEND_MODES } from '../web/js/doc.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} is not ${b}`);

test('separable modes, one channel', () => {
  near(blendChannel('add', 0.25, 0.5), 0.75, 'Add: b + s');
  near(blendChannel('add', 0.75, 0.5), 1, 'Add: capped at white');
  near(blendChannel('subtract', 0.75, 0.25), 0.5, 'Subtract: b - s');
  near(blendChannel('subtract', 0.25, 0.75), 0, 'Subtract: not below black');
  near(blendChannel('linear-burn', 0.75, 0.5), 0.25, 'Linear burn: b + s - 1');
  near(blendChannel('linear-burn', 0.25, 0.5), 0, 'Linear burn: not below black');
  near(blendChannel('linear-light', 0.5, 0.75), 1, 'Linear light: b + 2s - 1 = 0.5 + 1.5 - 1');
  near(blendChannel('linear-light', 0.5, 0.375), 0.25, 'Linear light: 0.5 + 0.75 - 1');
  near(blendChannel('linear-light', 0.2, 0.25), 0, 'Linear light: not below black');
  near(blendChannel('pin-light', 0.75, 0.25), 0.5, 'Pin light, dark source: min(b, 2s)');
  near(blendChannel('pin-light', 0.25, 0.25), 0.25, 'Pin light, dark source: backdrop already darker');
  near(blendChannel('pin-light', 0.25, 0.75), 0.5, 'Pin light, light source: max(b, 2s - 1)');
  near(blendChannel('pin-light', 0.75, 0.75), 0.75, 'Pin light, light source: backdrop already lighter');
  near(blendChannel('divide', 0.25, 0.5), 0.5, 'Divide: b / s');
  near(blendChannel('divide', 0.75, 0.5), 1, 'Divide: capped at white');
  near(blendChannel('divide', 0.5, 0), 1, 'Divide by black: white');
  near(blendChannel('divide', 0, 0), 0, 'Divide black by black: black');
});

test('Vivid light: colour burn by 2s below half, colour dodge by 2s - 1 above', () => {
  // s 0.25: burn(b, 0.5) = 1 - (1 - b) / 0.5; b 0.75 -> 0.5, b 0.25 -> 0 (capped)
  near(blendChannel('vivid-light', 0.75, 0.25), 0.5, 'burn half way');
  near(blendChannel('vivid-light', 0.25, 0.25), 0, 'burn to black');
  // s 0.75: dodge(b, 0.5) = b / 0.5; b 0.25 -> 0.5, b 0.75 -> 1 (capped)
  near(blendChannel('vivid-light', 0.25, 0.75), 0.5, 'dodge to half');
  near(blendChannel('vivid-light', 0.75, 0.75), 1, 'dodge to white');
  near(blendChannel('vivid-light', 0.4, 0.5), 0.4, 's = 0.5 leaves the backdrop (burn by 1)');
  near(blendChannel('vivid-light', 0.4, 0), 0, 'black source: black');
  near(blendChannel('vivid-light', 1, 0), 1, 'black source over white: white stays (burn of white)');
  near(blendChannel('vivid-light', 0.4, 1), 1, 'white source: white');
});

test('Hard mix: white where backdrop and source add up to white, else black', () => {
  near(blendChannel('hard-mix', 0.6, 0.5), 1, '1.1');
  near(blendChannel('hard-mix', 0.4, 0.5), 0, '0.9');
  near(blendChannel('hard-mix', 128 / 255, 127 / 255), 1, '8-bit pair adding to exactly 255');
  near(blendChannel('hard-mix', 127 / 255, 127 / 255), 0, '254 of 255');
});

test('Darker and Lighter color pick a whole colour by luminosity', () => {
  // lum red = 0.3, lum green (0, 0.5, 0) = 0.295: green is darker
  assert.deepEqual(blendColor('darker-color', [1, 0, 0], [0, 0.5, 0]), [0, 0.5, 0]);
  assert.deepEqual(blendColor('lighter-color', [1, 0, 0], [0, 0.5, 0]), [1, 0, 0]);
  // a mix per channel would give (0, 0, 0) / (1, 0.5, 0); the colours are never mixed
  assert.deepEqual(blendColor('darker-color', [0, 0, 1], [1, 1, 0]), [0, 0, 1]);
  assert.deepEqual(blendColor('lighter-color', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5], 'equal: the backdrop');
});

test('blendPixels: opaque backdrop gives B, see-through backdrop shows the source, alpha is the source\'s', () => {
  const dst = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 0, 100, 100, 100, 255]);
  const src = new Uint8ClampedArray([50, 200, 0, 255, 50, 200, 0, 128, 9, 9, 9, 0]);
  const out = blendPixels('add', dst, src);
  assert.deepEqual([...out.slice(0, 4)], [150, 255, 100, 255], 'opaque backdrop: 100 + 50, 100 + 200 capped, 100 + 0');
  assert.deepEqual([...out.slice(4, 8)], [50, 200, 0, 128], 'clear backdrop: the source as it is');
  assert.equal(out[11], 0, 'clear source stays clear');
  // backdrop alpha 153 = 0.6: (1 - 0.6) s + 0.6 B, B = 200 - 50 = 150 -> 0.4 * 50 + 0.6 * 150 = 110
  const part = blendPixels('subtract', new Uint8ClampedArray([200, 0, 0, 153]), new Uint8ClampedArray([50, 0, 0, 255]));
  assert.equal(part[0], 110);
});

test('every custom mode is in the layer blend list, and the shader knows them in order', () => {
  const ids = new Set(BLEND_MODES.map(m => m[0]));
  for (const m of CUSTOM_BLENDS) { assert.ok(ids.has(m), m); assert.ok(isCustomBlend(m)); }
  assert.ok(!isCustomBlend('multiply') && !isCustomBlend('source-over'));
  assert.equal(new Set(BLEND_MODES.map(m => m[1])).size, BLEND_MODES.length, 'labels unique');
  // uMode 0-7 are the separable ones in CUSTOM_BLENDS order, 8 and 9 Darker / Lighter color
  assert.equal(CUSTOM_BLENDS.indexOf('darker-color'), 8);
  assert.equal(CUSTOM_BLENDS.indexOf('lighter-color'), 9);
  for (let i = 0; i < 8; i++) assert.ok(BLEND_SHADER.includes(`uMode == ${i}`), `shader mode ${i}`);
});
