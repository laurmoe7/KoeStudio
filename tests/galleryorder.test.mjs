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
