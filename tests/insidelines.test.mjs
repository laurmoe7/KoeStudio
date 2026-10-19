// The area a brush that does not cross reference lines may paint in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insideLines, isLinePixel } from '../web/js/fill.js';

/** w × h RGBA from rows of characters: '#' black line, 'g' light gray (not a line), '.' clear. */
function picture(rows) {
  const h = rows.length, w = rows[0].length, data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = (y * w + x) * 4;
    if (ch === '#') data[i + 3] = 255;
    if (ch === 'g') { data[i] = data[i + 1] = data[i + 2] = 230; data[i + 3] = 255; }
  }));
  return { data, w, h };
}
const rowsOf = (res, w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (res.mask[y * w + x] ? 'x' : '.')).join(''));

test('dark opaque pixels are lines, light or see-through ones are not', () => {
  const { data } = picture(['#g.']);
  assert.equal(isLinePixel(data, 0), true);
  assert.equal(isLinePixel(data, 1), false);
  assert.equal(isLinePixel(data, 2), false);
});

test('the area stops at a thin line, covering it but not crossing it', () => {
  const { data, w, h } = picture([
    '...#...',
    '...#...',
    '...#...',
  ]);
  const res = insideLines(data, w, h, 1, 1, 0, 2);
  assert.deepEqual(rowsOf(res, w, h), ['xxxx...', 'xxxx...', 'xxxx...']);
  assert.deepEqual(res.bounds, { x: 0, y: 0, w: 4, h: 3 });
});

test('it grows only as far as asked into a thick line', () => {
  const { data, w, h } = picture(['..####..']);
  assert.deepEqual(rowsOf(insideLines(data, w, h, 0, 0, 0, 1), w, 1), ['xxx.....']);
  assert.deepEqual(rowsOf(insideLines(data, w, h, 0, 0, 0, 0), w, 1), ['xx......']);
});

test('a start on a line takes the nearest open pixel within reach', () => {
  const { data, w, h } = picture(['..###...']);
  // from x = 4 the nearest open pixel is x = 5 (right side)
  assert.deepEqual(rowsOf(insideLines(data, w, h, 4, 0, 2, 1), w, 1), ['....xxxx']);
  assert.equal(insideLines(data, w, h, 3, 0, 0.5, 1), null, 'nothing open within half a pixel');
  assert.equal(insideLines(data, w, h, -1, 0, 3, 1), null, 'outside the canvas');
});

test('an enclosed shape keeps the paint in', () => {
  const { data, w, h } = picture([
    '.....',
    '.###.',
    '.#.#.',
    '.###.',
    '.....',
  ]);
  // one step of growing reaches the four lines next to the middle, never the corners or the outside
  assert.deepEqual(rowsOf(insideLines(data, w, h, 2, 2, 0, 1), w, h), ['.....', '..x..', '.xxx.', '..x..', '.....']);
});
