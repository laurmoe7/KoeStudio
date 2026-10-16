// Figure tool geometry. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { constrain, figurePoints, figureBounds, linePoints, FIGURE_SHAPES, POLY_SHAPES, pointsBounds, polyCorners } from '../web/js/figure.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, `${msg || ''} ${a} ≈ ${b}`);

test('Shift constrains a line to 45° steps and a box to a square', () => {
  const flat = constrain('line', { x: 0, y: 0 }, { x: 10, y: 2 });
  near(flat.x, Math.sqrt(104), 1e-9, '11° snaps to 0°, keeping the length sqrt(10² + 2²)'); near(flat.y, 0);
  const diag = constrain('line', { x: 0, y: 0 }, { x: 10, y: 8 });
  near(diag.x, Math.sqrt(164) * Math.SQRT1_2, 1e-9, '39° snaps to 45°'); near(diag.y, diag.x);
  assert.deepEqual(constrain('rect', { x: 0, y: 0 }, { x: 10, y: -4 }), { x: 10, y: -10 }, 'the longer side wins, signs kept');
  assert.deepEqual(constrain('ellipse', { x: 5, y: 5 }, { x: 2, y: 9 }), { x: 1, y: 9 });
});

test('figure outlines', () => {
  assert.equal(FIGURE_SHAPES.length, 7);
  assert.deepEqual(figurePoints('line', { x: 1, y: 2 }, { x: 3, y: 4 }), { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], closed: false });
  assert.deepEqual(figurePoints('rect', { x: 5, y: 5 }, { x: 1, y: 2 }), { points: [{ x: 1, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 5 }, { x: 1, y: 5 }], closed: true }, 'normalised corners');
  const e = figurePoints('ellipse', { x: 0, y: 0 }, { x: 20, y: 20 }, 1);
  assert.ok(e.closed);
  assert.equal(e.points.length, 63, 'circumference 20π = 62.8 px at 1 px spacing');
  for (const p of e.points) near(Math.hypot(p.x - 10, p.y - 10), 10, 1e-9, 'on the circle');
  assert.equal(figurePoints('ellipse', { x: 0, y: 0 }, { x: 0, y: 0 }, 1).points.length, 16, 'never fewer than 16 points');
});

test('bounds and straight-line points', () => {
  assert.deepEqual(figureBounds({ x: 10, y: 10 }, { x: 20, y: 15 }, 4), { x: 6, y: 6, w: 18, h: 13 }, 'half the size plus 2 px each side');
  const pts = linePoints({ x: 0, y: 0, p: 1 }, { x: 10, y: 0, p: 0 }, 2.5);
  assert.deepEqual(pts.map(q => [q.x, q.p]), [[2.5, 0.75], [5, 0.5], [7.5, 0.25], [10, 0]], 'four steps, pressure blended, end included');
  assert.equal(linePoints({ x: 0, y: 0, p: 1 }, { x: 0, y: 0, p: 1 }, 2).length, 1, 'a zero-length line still gives its end');
});

test('clicked shapes: corners without repeats, and their bounds', () => {
  assert.deepEqual(POLY_SHAPES, { polyline: false, polygon: true, curve: false, closedcurve: true });
  const P = (x, y) => ({ x, y });
  assert.deepEqual(polyCorners([P(0, 0), P(10, 0), P(10.2, 0.1), P(10, 10)], false), [P(0, 0), P(10, 0), P(10, 10)],
    'the second corner of the double click (0.22 px away) is dropped');
  assert.deepEqual(polyCorners([P(0, 0), P(10, 0), P(10, 10), P(0.3, 0)], true), [P(0, 0), P(10, 0), P(10, 10)],
    'a closed shape drops a last corner on its first');
  assert.deepEqual(polyCorners([P(0, 0), P(10, 0), P(0, 0)], false), [P(0, 0), P(10, 0), P(0, 0)], 'an open one keeps it');
  assert.deepEqual(polyCorners([P(0, 0), P(0, 0.4)], true), [P(0, 0)]);
  assert.deepEqual(pointsBounds([P(10, 20), P(30, 5), P(15, 25)], 6), { x: 5, y: 0, w: 30, h: 30 },
    'box 10..30 x 5..25 grown by 3 + 2 px');
});

test('curves through clicked points', async () => {
  const { splinePoints, POLY_SHAPES, SMOOTH_SHAPES } = await import('../web/js/figure.js');
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
  const out = splinePoints(pts, false, 1);
  // segments of length sqrt(200) = 14.14 need 15 steps each: 30 samples plus the last point
  assert.equal(out.length, 31);
  assert.deepEqual(out[0], { x: 0, y: 0 }, 'starts at the first point');
  const mid = out[15];
  assert.ok(Math.abs(mid.x - 10) < 1e-9 && Math.abs(mid.y - 10) < 1e-9, 'passes through the middle point');
  assert.deepEqual(out[30], { x: 20, y: 0 }, 'ends at the last point');
  assert.ok(out.every(p => p.y <= 10 + 1e-9 && p.y >= -1e-9), 'no overshoot above the peak or below the ends');
  assert.ok(out.slice(1, 15).every((p, i) => p.x > out[i].x), 'keeps going right on the way up');
  // points on a straight line give a straight curve
  assert.ok(splinePoints([{ x: 0, y: 5 }, { x: 4, y: 5 }, { x: 9, y: 5 }], false, 1).every(p => Math.abs(p.y - 5) < 1e-9));
  // closed: runs back to the first point without repeating it
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const loop = splinePoints(sq, true, 1);
  assert.equal(loop.length, 40, 'four 10 px sides of 10 steps');
  assert.deepEqual([loop[0], loop[10], loop[20], loop[30]].map(p => [Math.round(p.x * 1e9) / 1e9, Math.round(p.y * 1e9) / 1e9]),
    [[0, 0], [10, 0], [10, 10], [0, 10]], 'through every corner');
  assert.ok(loop.some(p => p.y < -0.5), 'rounded: bulges out past the straight side');
  assert.deepEqual(splinePoints([{ x: 1, y: 2 }, { x: 3, y: 4 }], false), [{ x: 1, y: 2 }, { x: 3, y: 4 }], 'two points: a straight line');
  assert.equal(POLY_SHAPES.closedcurve, true);
  assert.ok(SMOOTH_SHAPES.has('curve') && !SMOOTH_SHAPES.has('polygon'));
});
