// Selection and transform maths. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskBounds, outlineSegments, modeFor, compositeFor, rectBetween } from '../web/js/selection.js';
import { newTransform, xfMatrix, boxPoint, toBox, hitTest, dragHandle, dragRotate, dragMove, xfBounds, isIdentity } from '../web/js/transform.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} ≈ ${b}`);

test('mask bounds', () => {
  // 4x3, selected pixels at (1,1) and (2,1)
  const m = new Uint8Array(12);
  m[5] = 255; m[6] = 255;
  assert.deepEqual(maskBounds(m, 4, 3), { x: 1, y: 1, w: 2, h: 1 });
  assert.equal(maskBounds(new Uint8Array(12), 4, 3), null);
});

test('outline of a 2x1 selection is its four merged edges', () => {
  const m = new Uint8Array(12);
  m[5] = 255; m[6] = 255;
  const segs = outlineSegments(m, 4, 3, { x: 1, y: 1, w: 2, h: 1 });
  assert.deepEqual(segs.sort(), [[1, 1, 3, 1], [1, 1, 1, 2], [1, 2, 3, 2], [3, 1, 3, 2]].sort(),
    'top y=1 from x 1-3, bottom y=2, left x=1, right x=3');
});

test('outline ignores faint pixels (alpha < 128)', () => {
  const m = new Uint8Array(4);
  m[0] = 100; m[1] = 200;
  const segs = outlineSegments(m, 2, 2, { x: 0, y: 0, w: 2, h: 1 });
  assert.deepEqual(segs.sort(), [[1, 0, 2, 0], [1, 1, 2, 1], [1, 0, 1, 1], [2, 0, 2, 1]].sort(), 'only pixel (1,0) counts');
});

test('selection modes from keys', () => {
  assert.equal(modeFor('replace', false, false), 'replace');
  assert.equal(modeFor('subtract', false, false), 'subtract', 'tool setting');
  assert.equal(modeFor('replace', true, false), 'add');
  assert.equal(modeFor('replace', false, true), 'subtract');
  assert.equal(modeFor('replace', true, true), 'intersect');
  assert.equal(compositeFor('subtract'), 'destination-out');
  assert.equal(compositeFor('intersect'), 'destination-in');
  assert.deepEqual(rectBetween({ x: 10.4, y: 8 }, { x: 2, y: 20.6 }), { x: 2, y: 8, w: 8, h: 13 });
});

test('transform maps the source box onto itself before any change', () => {
  const r = { x: 10, y: 20, w: 100, h: 50 };
  const t = newTransform(r);
  assert.deepEqual(xfMatrix(t), [1, 0, -0, 1, 10, 20]);
  assert.deepEqual(boxPoint(t, -1, -1), { x: 10, y: 20 });
  assert.deepEqual(boxPoint(t, 1, 1), { x: 110, y: 70 });
  assert.ok(isIdentity(t, r));
  assert.deepEqual(xfBounds(t), { x: 9, y: 19, w: 102, h: 52 }, 'one pixel of margin each side');
});

test('dragging a corner scales from the opposite corner', () => {
  const t0 = newTransform({ x: 0, y: 0, w: 100, h: 50 });
  const t = dragHandle(t0, 'se', { x: 200, y: 150 });
  near(t.sx, 2, 'width 100 -> 200');
  near(t.sy, 3, 'height 50 -> 150');
  const nw = boxPoint(t, -1, -1);
  near(nw.x, 0); near(nw.y, 0, 'the top-left corner stays put');
  const k = dragHandle(t0, 'se', { x: 200, y: 60 }, true);
  near(k.sx, 2); near(k.sy, 2, 'keep aspect: the larger change (x2) wins');
  const e = dragHandle(t0, 'e', { x: 50, y: 999 });
  near(e.sx, 0.5, 'side handle: width 100 -> 50');
  near(e.sy, 1, 'height unchanged');
  const flip = dragHandle(t0, 'e', { x: -100, y: 0 });
  near(flip.sx, -1, 'dragging past the opposite side mirrors it');
});

test('scaling a rotated box keeps the anchor and uses the box axes', () => {
  const t0 = { ...newTransform({ x: 0, y: 0, w: 100, h: 100 }), rot: Math.PI / 2 };
  const anchor = boxPoint(t0, -1, 0);  // opposite of the 'e' handle
  // the box's x axis points down after a 90 degree turn: dragging 'e' 100 px further down doubles the width
  const eHandle = boxPoint(t0, 1, 0);
  const t = dragHandle(t0, 'e', { x: eHandle.x, y: eHandle.y + 100 });
  near(t.sx, 2);
  const a2 = boxPoint(t, -1, 0);
  near(a2.x, anchor.x); near(a2.y, anchor.y);
});

test('rotate, move, hit test', () => {
  const t0 = newTransform({ x: 0, y: 0, w: 100, h: 100 });  // centre (50, 50)
  const r = dragRotate(t0, { x: 100, y: 50 }, { x: 50, y: 100 });
  near(r.rot, Math.PI / 2, 'from east of centre to south = +90 degrees');
  const snapped = dragRotate(t0, { x: 100, y: 50 }, { x: 100, y: 58 }, true);
  near(snapped.rot, Math.PI / 12, 'atan(8/50) = 9.1 degrees snaps to 15');
  assert.deepEqual(dragMove(t0, { x: 5, y: 5 }, { x: 15, y: 0 }), { ...t0, cx: 60, cy: 45 });
  assert.equal(hitTest(t0, { x: 101, y: 99 }, 5), 'se');
  assert.equal(hitTest(t0, { x: 50, y: 1 }, 5), 'n');
  assert.equal(hitTest(t0, { x: 40, y: 40 }, 5), 'move');
  assert.equal(hitTest(t0, { x: 130, y: 40 }, 5), 'rotate');
  const b = toBox(r, boxPoint(r, 0.5, -0.25));
  near(b.x, 0.5); near(b.y, -0.25, 'toBox undoes boxPoint');
});
