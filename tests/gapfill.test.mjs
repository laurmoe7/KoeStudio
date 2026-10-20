// Paint unfilled area (enclosedAreas): areas wholly inside the traced part get filled, the rest is left alone.
// Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enclosedAreas } from '../web/js/fill.js';

// 6 x 6: white, a black line down column 2, grey specks at (4, 1), (4, 3)-(4, 4) and (5, 5)
//   W W B W W W
//   W W B W g W
//   W W B W W W
//   W W B W g W
//   W W B W g W
//   W W B W W g
function picture() {
  const w = 6, h = 6, d = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x, y, v) => { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; };
  for (let y = 0; y < h; y++) set(2, y, 0);
  for (const [x, y] of [[4, 1], [4, 3], [4, 4], [5, 5]]) set(x, y, 128);
  return d;
}
const filled = (out, box) => [...out].map((v, k) => v ? `${box.x + k % box.w},${box.y + Math.floor(k / box.w)}` : null).filter(Boolean);

test('only areas wholly inside the trace are filled', () => {
  const box = { x: 3, y: 0, w: 3, h: 6 }, traced = new Uint8Array(18).fill(1);
  const out = enclosedAreas(picture(), 6, 6, traced, box, 12);
  assert.deepEqual(filled(out, box), ['4,1', '4,3', '4,4'],
    'the specks; not the white round them (it reaches the canvas edge) nor the speck in the corner');
});

test('an area reaching past the trace is left alone', () => {
  // trace only rows 0-3 of column 4: the speck at (4, 1) is inside, the one at (4, 3)-(4, 4) runs on below
  const box = { x: 4, y: 0, w: 1, h: 4 }, traced = new Uint8Array(4).fill(1);
  assert.deepEqual(filled(enclosedAreas(picture(), 6, 6, traced, box, 12), box), ['4,1']);
  // the same box with its middle not traced: the speck at (4, 1) still counts, the white at (4, 2) is cut off
  const holes = new Uint8Array([1, 1, 0, 1]);
  assert.deepEqual(filled(enclosedAreas(picture(), 6, 6, holes, box, 12), box), ['4,1']);
});

test('the line art is not filled when the trace crosses it', () => {
  const box = { x: 1, y: 1, w: 3, h: 2 }, traced = new Uint8Array(6).fill(1);
  assert.deepEqual(filled(enclosedAreas(picture(), 6, 6, traced, box, 12), box), [], 'the line and the white run on outside');
});
