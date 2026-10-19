// Combined brushes: a second brush along the same stroke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { comboSettings, comboFrom, comboOp, hasCombo, COMBO_DEFAULTS } from '../web/js/combo.js';
import { TOOL_BY_ID, sanitizeSettings, BRUSH_KEYS } from '../web/js/tools.js';

test('no second brush until it has a tip', () => {
  assert.equal(comboSettings({ size: 20, ...COMBO_DEFAULTS }), null);
  assert.equal(hasCombo(TOOL_BY_ID.brush.defaults), false, 'off for every tool at first');
  assert.ok(BRUSH_KEYS.includes('comboTip') && BRUSH_KEYS.includes('comboMode'), 'saved brushes keep it');
});

test('the second brush as a brush of its own', () => {
  const s = { size: 40, gamma: 1.5, pixel: false, ...COMBO_DEFAULTS, comboTip: 'bristle', comboSize: 0.5, comboFlow: 0.3, comboScatter: 0.4, comboFollow: true, texture: 'paper', taperOut: 30 };
  const c = comboSettings(s);
  assert.equal(c.size, 20, 'half the main size');
  assert.equal(c.tip, 'bristle');
  assert.equal(c.flow, 0.3);
  assert.equal(c.scatter, 0.4);
  assert.equal(c.tipFollow, true);
  assert.equal(c.gamma, 1.5, "the main brush's pressure curve");
  assert.equal(c.texture, 'none', 'the texture stays with the stroke as a whole');
  assert.equal(c.taperOut, 0);
  assert.equal(comboSettings({ ...s, size: 0.4, comboSize: 0.05 }).size, 0.5, 'never smaller than half a pixel');
});

test('copying a brush in as the second brush', () => {
  const b = { size: 10, tip: 'img:abcdef12', flow: 0.6, hardness: 0.4, spacing: 0.2, scatter: 5, pressureSize: false, minSize: 0.5 };
  const c = comboFrom(b, 40);
  assert.equal(c.comboSize, 0.25, '10 px under a 40 px brush');
  assert.equal(c.comboTip, 'img:abcdef12');
  assert.equal(c.comboScatter, 2, 'scatter kept in range');
  assert.equal(c.comboPressureSize, false);
  assert.equal(comboFrom({ size: 500 }, 10).comboSize, 3, 'at most three times as big');
  assert.equal(comboFrom({ size: 5, tip: 'none' }, 10).comboTip, 'round');
});

test('modes and stored settings', () => {
  assert.equal(comboOp('multiply'), 'multiply');
  assert.equal(comboOp('nonsense'), 'source-over');
  const s = sanitizeSettings({ brush: { comboTip: 'img:0123abcd', comboMode: 'darken', comboSize: 9, comboFlow: -1 } }).brush;
  assert.deepEqual([s.comboTip, s.comboMode, s.comboSize, s.comboFlow], ['img:0123abcd', 'darken', 3, 0.01], 'a tip image is allowed; numbers clamped');
  assert.equal(sanitizeSettings({ brush: { comboTip: '<x>', comboMode: 'blur' } }).brush.comboTip, 'none');
});
