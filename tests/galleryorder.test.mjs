// Gallery search and sorting. Expected orders worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryOrder } from '../web/js/galleryorder.js';

const list = [
  { id: 'a', title: 'Page 10', width: 100, height: 100, modified: 5 },
  { id: 'b', title: 'page 2', width: 300, height: 200, modified: 9 },
  { id: 'c', title: 'Cat sketch', width: 300, height: 200, modified: 7 },
  { id: 'd', title: 'Dog', width: 50, height: 40, modified: 1 },
];
const ids = l => l.map(a => a.id).join('');

test('gallery sorts by last change, name (numbers in order) and size', () => {
  assert.equal(ids(galleryOrder(list)), 'bcad');
  assert.equal(ids(galleryOrder(list, '', 'title')), 'cdba', 'page 2 before Page 10, case ignored');
  assert.equal(ids(galleryOrder(list, '', 'size')), 'bcad', 'b and c are as big: the newer first');
  assert.equal(ids(galleryOrder(list, '', 'nonsense')), 'bcad');
  assert.equal(ids(list), 'abcd', 'the list itself is left as it was');
});

test('gallery search needs every word in the title', () => {
  assert.equal(ids(galleryOrder(list, 'PAGE')), 'ba');
  assert.equal(ids(galleryOrder(list, ' sketch  cat ')), 'c');
  assert.equal(ids(galleryOrder(list, 'cat dog')), '');
});

test('new canvas presets: sizes match their labels and fit the canvas limit', async () => {
  const { PRESETS } = await import('../web/js/views/gallery.js');
  const { MAX_SIDE } = await import('../web/js/doc.js');
  for (const [label, w, h, dpi, group] of PRESETS) {
    assert.ok(label.includes(`(${w} × ${h})`), `${label} names its size`);
    assert.ok(w <= MAX_SIDE && h <= MAX_SIDE && dpi > 0 && group, label);
  }
  const size = name => PRESETS.find(p => p[0].startsWith(name)).slice(1, 3);
  // paper sizes at 300 dpi: mm / 25.4 * 300, rounded (A3 297 x 420 mm, Letter 8.5 x 11 in)
  assert.deepEqual(size('A3'), [3508, 4961]);
  assert.deepEqual(size('A5'), [1748, 2480]);
  assert.deepEqual(size('US Letter'), [2550, 3300]);
  assert.deepEqual(size('Postcard'), [1181, 1772]);
  assert.deepEqual(PRESETS[0].slice(1, 4), [1920, 1080, 72], 'Full HD stays the first choice');
});
