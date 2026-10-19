// Selection and transform maths. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskBounds, outlineSegments, maskOutline, modeFor, compositeFor, rectBetween, selectionBarSpot } from '../web/js/selection.js';
import { newTransform, xfMatrix, boxPoint, toBox, hitTest, dragHandle, dragRotate, dragMove, xfBounds, isIdentity, typedTransform } from '../web/js/transform.js';

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

test('outline of a mask region read at an offset is in doc coordinates', () => {
  // a 3 x 2 region whose top left is doc (10, 20): pixels (1, 0) and (2, 1) touch at a corner, the second at the
  // region's right edge (the doc is empty beyond it)
  const m = new Uint8Array(6);
  m[1] = 255; m[5] = 255;
  const o = maskOutline(m, 3, 2, 10, 20);
  assert.deepEqual(o.bounds, { x: 11, y: 20, w: 2, h: 2 });
  assert.deepEqual(o.segments.sort(), [[11, 20, 12, 20], [11, 21, 13, 21], [12, 22, 13, 22], [11, 20, 11, 21], [12, 20, 12, 22], [13, 21, 13, 22]].sort(),
    'shared row y=21 and column x=12 merge across the corner');
  assert.deepEqual(maskOutline(new Uint8Array(6), 3, 2, 10, 20), { bounds: null, segments: [] });
});

test('a full selection is outlined by the canvas edges (Select all sets them without reading the mask)', () => {
  const o = maskOutline(new Uint8Array(6).fill(255), 3, 2);
  assert.deepEqual(o.bounds, { x: 0, y: 0, w: 3, h: 2 });
  assert.deepEqual(o.segments.sort(), [[0, 0, 3, 0], [0, 2, 3, 2], [0, 0, 0, 2], [3, 0, 3, 2]].sort());
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

test('Alt+dragging a handle scales about the middle', () => {
  const t0 = newTransform({ x: 0, y: 0, w: 100, h: 50 });  // middle (50, 25)
  const t = dragHandle(t0, 'se', { x: 150, y: 75 }, false, true);
  near(t.sx, 2, 'the corner went 100 px right of the middle: half the width is now 100');
  near(t.sy, 2);
  near(t.cx, 50); near(t.cy, 25, 'the middle stays put');
  const nw = boxPoint(t, -1, -1);
  near(nw.x, -50); near(nw.y, -25, 'the opposite corner moves out as far');
  const e = dragHandle(t0, 'e', { x: 75, y: 999 }, false, true);
  near(e.sx, 0.5, 'side handle 25 px from the middle: width 50');
  near(e.sy, 1);
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

test('color range: full within half the fuzziness, fading out to the fuzziness', async () => {
  const { colorRangeMask } = await import('../web/js/maskops.js');
  const px = [[100, 100, 100, 255], [110, 110, 110, 255], [130, 130, 130, 255], [140, 140, 140, 255], [100, 100, 100, 128], [100, 100, 100, 0], [100, 130, 100, 255]];
  const m = colorRangeMask(new Uint8ClampedArray(px.flat()), [100, 100, 100], 40);
  assert.deepEqual([...m], [255, 255, 128, 0, 128, 0, 255],
    'd = 0 and 10 (within 20): full; d = 30: (40 - 30) / 20 = half; d = 40: none; half alpha: half; clear: none; ' +
    'one channel 30 off: d = sqrt(900 / 3) = 17.3, full');
  assert.deepEqual([...colorRangeMask(new Uint8ClampedArray(px.flat()), [100, 100, 100], 0)], [255, 0, 0, 0, 128, 0, 0], 'fuzziness 0: exact colour only');
});

test('stroke selection bands', async () => {
  const { strokeBand } = await import('../web/js/maskops.js');
  // a 9 x 1 strip, selected from x = 2 to 6 (the canvas edge is outside, so it counts as an edge too)
  const w = 9, h = 5, alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 2; x <= 6; x++) alpha[y * w + x] = 255;
  const row = (m, y = 2) => [...m.slice(y * w, y * w + w)].map(v => (v ? 1 : 0)).join('');
  assert.equal(row(strokeBand(alpha, w, h, 1, 'inside')), '001000100', 'the selection\'s own edge pixels');
  assert.equal(row(strokeBand(alpha, w, h, 1, 'outside')), '010000010', 'one pixel outside each side');
  assert.equal(row(strokeBand(alpha, w, h, 2, 'center')), '011000110', 'one out, one in');
});

test('selection bar sits under the selection, above it when there is no room, else at the bottom edge', () => {
  const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  // 200 x 30 bar in a 1000 x 800 view; selection 100..300 x 100..200: centre 200 -> x 100, y 200 + 10
  assert.deepEqual(selectionBarSpot(box(100, 100, 300, 200), 200, 30, 1000, 800), { x: 100, y: 210 });
  // selection reaching the bottom: above it (top 500 - 10 - 30)
  assert.deepEqual(selectionBarSpot(box(100, 500, 300, 790), 200, 30, 1000, 800), { x: 100, y: 460 });
  // the whole view selected: at the bottom edge (800 - 8 - 30)
  assert.deepEqual(selectionBarSpot(box(-50, -50, 1050, 850), 200, 30, 1000, 800), { x: 400, y: 762 });
  // near the left edge: kept 8 px inside
  assert.deepEqual(selectionBarSpot(box(0, 0, 40, 40), 200, 30, 1000, 800), { x: 8, y: 50 });
});

test('numbers typed into the transform bar', () => {
  const t = { ...newTransform({ x: 0, y: 0, w: 100, h: 50 }), sx: -2, sy: 0.5 };
  assert.deepEqual(typedTransform(t, 'w', '150'), { sx: -1.5 }, 'flip kept');
  assert.deepEqual(typedTransform(t, 'h', 200, true), { sy: 2, sx: -8 }, 'keep aspect: width x4 too');
  near(typedTransform(t, 'deg', '90').rot, Math.PI / 2);
  assert.deepEqual(typedTransform(t, 'w', 'abc'), {});
  assert.deepEqual(typedTransform(t, 'w', ''), {});
  assert.deepEqual(typedTransform(t, 'w', '0'), { sx: -0.01 }, 'at least 1%');
});
