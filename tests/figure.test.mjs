// Figure tool geometry. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { constrain, figurePoints, figureBounds, linePoints, FIGURE_SHAPES } from '../web/js/figure.js';

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
  assert.equal(FIGURE_SHAPES.length, 3);
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
