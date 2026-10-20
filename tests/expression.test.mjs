// Expression color (expression.js): Gray / Monochrome display of a layer, and how it is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExpression, applyExpression, expressionLabel, defaultExpression, luma } from '../web/js/expression.js';
import { sanitizeDoc } from '../web/js/doc.js';
import { sanitizeStep, stepLabel } from '../web/js/autoactions.js';

const px = (...p) => new Uint8ClampedArray(p.flat());

test('sanitizeExpression keeps gray and mono, clamps the threshold and drops the rest', () => {
  assert.equal(sanitizeExpression(null), null);
  assert.equal(sanitizeExpression({ mode: 'color' }), null);
  assert.equal(sanitizeExpression({ mode: 'sepia' }), null);
  assert.deepEqual(sanitizeExpression({ mode: 'gray', threshold: 9 }), { mode: 'gray' });
  assert.deepEqual(sanitizeExpression({ mode: 'mono' }), { mode: 'mono', threshold: 128, white: true });
  assert.deepEqual(sanitizeExpression({ mode: 'mono', threshold: 400, white: false }), { mode: 'mono', threshold: 255, white: false });
  assert.deepEqual(sanitizeExpression({ mode: 'mono', threshold: 0 }), { mode: 'mono', threshold: 1, white: true });
  assert.deepEqual(sanitizeExpression({ mode: 'mono', threshold: 'x' }), { mode: 'mono', threshold: 128, white: true });
  assert.deepEqual(sanitizeExpression({ mode: 'mono', threshold: 99.6 }), { mode: 'mono', threshold: 100, white: true });
  assert.deepEqual(defaultExpression('mono'), { mode: 'mono', threshold: 128, white: true });
  assert.equal(defaultExpression('color'), null);
  assert.equal(expressionLabel(null), 'Color');
  assert.equal(expressionLabel({ mode: 'mono' }), 'Monochrome');
});

test('gray: luma of each colour, alpha kept', () => {
  // red: 0.299 * 255 = 76.2 -> 76; green: 0.587 * 255 = 149.7 -> 150; (100, 200, 50): 29.9 + 117.4 + 5.7 = 153
  assert.equal(luma(255, 0, 0), 76);
  const d = applyExpression(px([255, 0, 0, 255], [0, 255, 0, 128], [100, 200, 50, 40], [9, 9, 9, 0]), { mode: 'gray' });
  assert.deepEqual([...d], [76, 76, 76, 255, 150, 150, 150, 128, 153, 153, 153, 40, 9, 9, 9, 0]);
});

test('mono: black below the threshold, white above, half-opaque or more shows', () => {
  const src = () => px([255, 0, 0, 255], [200, 200, 200, 255], [0, 0, 0, 128], [0, 0, 0, 127], [127, 127, 127, 255], [128, 128, 128, 255]);
  // red's gray is 76 < 128: black; 200 white; alpha 128 shows (opaque black), 127 goes; 127 < 128 black, 128 is not below: white
  assert.deepEqual([...applyExpression(src(), { mode: 'mono', threshold: 128, white: true })],
    [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255]);
  // white see-through: the white pixels vanish, the black ones stay
  assert.deepEqual([...applyExpression(src(), { mode: 'mono', threshold: 128, white: false })],
    [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]);
  // a threshold of 50 makes red (76) white
  assert.deepEqual([...applyExpression(px([255, 0, 0, 255]), { mode: 'mono', threshold: 50, white: true })], [255, 255, 255, 255]);
  assert.deepEqual([...applyExpression(px([10, 20, 30, 40]), null)], [10, 20, 30, 40], 'Color leaves pixels alone');
});

test('old files load as Color, the expression is kept, and correction layers have none', () => {
  const d = sanitizeDoc({ layers: [
    { name: 'Old' },
    { name: 'Lines', expression: { mode: 'mono', threshold: 90, white: false } },
    { name: 'Sketch', expression: { mode: 'gray' } },
    { name: 'Fix', adjust: { type: 'hsl' }, expression: { mode: 'gray' } },
  ] });
  assert.equal(d.layers[0].expression, null);
  assert.deepEqual(d.layers[1].expression, { mode: 'mono', threshold: 90, white: false });
  assert.deepEqual(d.layers[2].expression, { mode: 'gray' });
  assert.equal(d.layers[3].expression ?? null, null);
});

test('auto actions record the Layers panel expression setting', () => {
  const s = sanitizeStep({ kind: 'prop', key: 'expression', value: { mode: 'gray' }, label: 'Expression color' });
  assert.deepEqual(s.value, { mode: 'gray' });
  assert.equal(stepLabel(s), 'Expression color: Gray');
  assert.equal(stepLabel({ kind: 'prop', key: 'expression', value: null, label: 'Expression color' }), 'Expression color: Color');
  assert.equal(sanitizeStep({ kind: 'prop', key: 'expression', value: { mode: 'mono', threshold: 999 } }), null, 'not a value the panel sets');
});
