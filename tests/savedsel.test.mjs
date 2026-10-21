// Saved selections: names, the file format and cutting a mask down to its selected part. Expected values by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSelName, nextSelName, uniqueSelName, sanitizeSavedSels, cropAlpha, savedSel, savedSelBytes, SAVED_SEL_MAX } from '../web/js/savedsel.js';
import { sanitizeDoc } from '../web/js/doc.js';

const PNG = 'data:image/png;base64,AAAA';

test('saved selection names', () => {
  assert.equal(cleanSelName('  Face\n '), 'Face', 'trimmed, control characters gone');
  assert.equal(cleanSelName(''), 'Selection');
  assert.equal(cleanSelName(null), 'Selection');
  assert.equal(cleanSelName('x'.repeat(80)).length, 60);
  assert.equal(nextSelName([]), 'Selection 1');
  assert.equal(nextSelName(['Selection 1', 'Selection 3']), 'Selection 2', 'the first free number');
  assert.equal(uniqueSelName(['Hair'], 'Face'), 'Face');
  assert.equal(uniqueSelName(['Hair', 'Hair 2'], 'Hair'), 'Hair 3');
  assert.equal(uniqueSelName(['Selection'], '   '), 'Selection 2', 'an empty name becomes Selection, then numbered');
});

test('saved selections in the file', () => {
  const ok = { name: 'Sky', x: 10, y: 0, w: 90, h: 50, png: PNG };
  assert.deepEqual(sanitizeSavedSels([ok], 100, 50), [ok], 'right up to the canvas edge is fine');
  const bad = [
    { ...ok, png: 'data:image/jpeg;base64,AA' },  // not a PNG
    { ...ok, x: 11 },                              // 11 + 90 goes past 100
    { ...ok, y: -1 },
    { ...ok, w: 0 },
    { ...ok, h: 2.5 },
    { ...ok, x: '10' },
    null, 'Sky',
  ];
  assert.deepEqual(sanitizeSavedSels(bad, 100, 50), []);
  assert.deepEqual(sanitizeSavedSels('nope', 100, 50), []);
  assert.equal(sanitizeSavedSels([{ ...ok, name: '\u0007' }], 100, 50)[0].name, 'Selection');
  assert.equal(sanitizeSavedSels(Array(SAVED_SEL_MAX + 5).fill(ok), 100, 50).length, SAVED_SEL_MAX);
  // in a document: checked against its own size; older files have none
  assert.deepEqual(sanitizeDoc({ width: 100, height: 50, selections: [ok, { ...ok, w: 200 }] }).selections, [ok]);
  assert.deepEqual(sanitizeDoc({}).selections, []);
});

test('a mask cut down to its selected part', () => {
  // 4 x 3 mask with pixels at (1, 0) and (2, 2): the box is x 1-2, y 0-2
  const a = new Uint8Array([
    0, 255, 0, 0,
    0, 0, 0, 0,
    0, 0, 128, 0,
  ]);
  assert.deepEqual(cropAlpha(a, 4, 3), { x: 1, y: 0, w: 2, h: 3, alpha: new Uint8Array([255, 0, 0, 0, 0, 128]) });
  assert.equal(cropAlpha(new Uint8Array(12), 4, 3), null, 'nothing selected');
});

test('memory held by saved selections', () => {
  const a = savedSel('A', { x: 0, y: 0, w: 2, h: 2 }, new Uint8Array(4));
  const b = savedSel('B', { x: 0, y: 0, w: 3, h: 1 }, new Uint8Array(3));
  assert.notEqual(a.id, b.id);
  assert.equal(savedSelBytes([a, b]), 7);
  assert.equal(savedSelBytes([a, b], [a]), 3, 'only what the earlier list did not have');
});
