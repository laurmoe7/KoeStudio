// Vector layers: data, geometry and the three erase modes. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBrush, sanitizeVector, emptyVector, resample, addStrokes, translateVector, strokeBounds, changedBounds,
  strokeStamps, segDist, segCross, eraseVector, seeded } from '../web/js/vector.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≈ ${b}`);
// a brush 4 px wide at any pressure, so half its width is 2
const B = sanitizeBrush({ size: 4, pressureSize: false });
const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1]);
const vec = (...paths) => ({ brushes: [B], strokes: paths.map(pts => ({ pts, b: 0, color: '#000000', opacity: 1, seed: 1 })) });
const xs = s => s.pts.map(p => p[0]);

test('brush and file cleaning', () => {
  const b = sanitizeBrush({ size: 5000, flow: 'x', tip: 'img:0123456789abcdef', texture: '<script>', pressureSize: 0, junk: 1 });
  assert.equal(b.size, 1000, 'clamped');
  assert.equal(b.flow, 1, 'not a number: default');
  assert.equal(b.tip, 'img:0123456789abcdef');
  assert.equal(b.texture, 'none', 'not a name: default');
  assert.equal(b.pressureSize, false);
  assert.ok(!('junk' in b));
  const v = sanitizeVector({ brushes: [{ size: 3 }], strokes: [{ pts: [[1, 2, 5], ['a', 1]], b: 7, color: 'red', opacity: 9 }, { pts: [] }] });
  assert.deepEqual(v.strokes, [{ pts: [[1, 2, 1]], b: 0, color: '#000000', opacity: 1, seed: 1 }],
    'bad points and empty strokes dropped, pressure clamped, unknown brush and colour replaced');
  assert.equal(sanitizeVector(null), null);
  assert.equal(sanitizeVector({}).brushes.length, 1, 'always at least one brush');
});

test('paths, strokes and bounds', () => {
  assert.deepEqual(resample([[0, 0, 1], [10, 0, 0]], 4), [[0, 0, 1], [3.33, 0, 0.67], [6.67, 0, 0.33], [10, 0, 0]],
    '10 px in steps of at most 4: three parts');
  const s = { pts: [[0, 0, 1]], color: '#112233', opacity: 1, seed: 3 };
  let v = addStrokes(emptyVector(), { size: 4, pressureSize: false }, [s]);
  v = addStrokes(v, { size: 4, pressureSize: false }, [s]);
  assert.equal(v.brushes.length, 1, 'the same settings share a brush');
  assert.deepEqual(v.strokes.map(x => x.b), [0, 0]);
  v = addStrokes(v, { size: 9 }, [s]);
  assert.deepEqual(v.strokes.map(x => x.b), [0, 0, 1]);
  assert.deepEqual(translateVector(vec([[1, 2, 0.5]]), 3, -1).strokes[0].pts, [[4, 1, 0.5]]);
  assert.deepEqual(strokeBounds({ pts: [[10, 20, 1], [30, 25, 1]] }, B), { x: 6, y: 16, w: 28, h: 13 },
    'path box grown by half the size (2) plus 2');
  const a = vec([[10, 20, 1], [30, 25, 1]]), b = { brushes: a.brushes, strokes: [] };
  assert.deepEqual(changedBounds(a, b), { x: 6, y: 16, w: 28, h: 13 });
  assert.equal(changedBounds(a, a), null, 'same strokes: nothing changed');
});

test('stamps are repeatable and tapered by distance', () => {
  const b = sanitizeBrush({ size: 10, spacing: 0.5, pressureSize: false, taperOut: 10 });
  const st = strokeStamps({ pts: [[0, 0, 1], [20, 0, 1]], seed: 1 }, b);
  assert.deepEqual(st.map(q => q.x), [0, 5, 10, 15, 20], 'a dab every half size (5 px)');
  const k = st.map(q => q.k);
  near(k[2], 1, '10 px from the end: full size'); near(k[3], 0.775, '5 px: halfway up the curve'); near(k[4], 0.1, 'the end: 10%');
  const j = sanitizeBrush({ size: 10, scatter: 1, pressureSize: false });
  const one = strokeStamps({ pts: [[0, 0, 1], [30, 0, 1]], seed: 42 }, j), two = strokeStamps({ pts: [[0, 0, 1], [30, 0, 1]], seed: 42 }, j);
  assert.deepEqual(one, two, 'the same seed scatters the same way');
  const r = seeded(5);
  assert.ok([r(), r(), r()].every(x => x >= 0 && x < 1));
});

test('geometry', () => {
  assert.equal(segDist(5, 3, 0, 0, 10, 0), 3);
  assert.equal(segDist(13, 4, 0, 0, 10, 0), 5, 'past the end: to the end point');
  assert.deepEqual(segCross([0, 0], [10, 0], [5, -5], [5, 5]), [0.5, 0.5]);
  assert.equal(segCross([0, 0], [10, 0], [0, 1], [10, 1]), null, 'parallel');
  assert.equal(segCross([0, 0], [10, 0], [12, -1], [12, 1]), null, 'would cross past the end');
});

test('erase: touched area', () => {
  const v = vec(line(0, 0, 10, 0, 10));
  const out = eraseVector(v, 'area', [5, 0], [5, 0], 1.5);
  assert.deepEqual(out.strokes.map(xs), [[0, 1, 2, 3], [7, 8, 9, 10]], 'points 4, 5 and 6 are within 1.5: the line splits in two');
  assert.equal(eraseVector(v, 'area', [5, 5], [6, 5], 1.5), v, 'nothing touched: the same object');
  assert.deepEqual(eraseVector(v, 'area', [-1, 0], [11, 0], 1).strokes, [], 'all of it');
});

test('erase: whole line', () => {
  const v = vec(line(0, 0, 10, 0, 10), line(0, 20, 10, 20, 10));
  assert.equal(eraseVector(v, 'line', [5, 4], [5, 4], 1), v, '4 px from the path is 2 px from its edge: not touched with r = 1');
  const out = eraseVector(v, 'line', [5, 3], [5, 3], 1);
  assert.deepEqual(out.strokes.map(s => s.pts[0][1]), [20], '3 px from the path is 1 px from its edge: the first line goes');
});

test('erase: up to intersection', () => {
  const h = line(0, 0, 20, 0, 20), v1 = line(5, -5, 5, 5, 10), v2 = line(15, -5, 15, 5, 10);
  const v = vec(h, v1, v2);
  const mid = eraseVector(v, 'intersection', [10, 0], [10, 0], 1);
  assert.equal(mid.strokes.length, 4, 'the horizontal line splits; the crossing lines stay');
  const pieces = mid.strokes.filter(s => s.pts.every(p => p[1] === 0));
  assert.deepEqual(pieces.map(xs), [[0, 1, 2, 3, 4, 5], [15, 16, 17, 18, 19, 20]], 'cut exactly at the two crossings');
  const end = eraseVector(v, 'intersection', [2, 0], [2, 0], 1);
  assert.deepEqual(end.strokes.filter(s => s.pts.every(p => p[1] === 0)).map(xs), [[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
    'no crossing before the touch: removed from its start to the first crossing');
  const alone = eraseVector(vec(h), 'intersection', [10, 0], [10, 0], 1);
  assert.deepEqual(alone.strokes, [], 'a line crossing nothing goes completely');
  const cut = eraseVector(vec(line(0, 0, 20, 0, 2), line(7, -5, 7, 5, 1)), 'intersection', [15, 0], [15, 0], 1);
  assert.deepEqual(cut.strokes[0].pts, [[0, 0, 1], [7, 0, 1]], 'a crossing inside a long segment: the cut point is made there');
});
