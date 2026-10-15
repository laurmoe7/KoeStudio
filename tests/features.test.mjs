// Contiguous / global fill areas, rounded rectangles, border selections. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { floodMask } from '../web/js/fill.js';
import { figurePoints } from '../web/js/figure.js';
import { borderMask } from '../web/js/maskops.js';
import { sanitizeSettings } from '../web/js/tools.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b}`);

test('fill areas: connected only, or every pixel of that colour', () => {
  // 4x3 white with a black wall at x = 2: left part 2 wide, right part 1 wide
  const W = 4, H = 3, data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) data.set([0, 0, 0, 255], (y * W + 2) * 4);
  const all = floodMask(data, W, H, 0, 0, 0, false);
  assert.deepEqual([...all.mask], [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1], 'both sides of the wall');
  assert.deepEqual(all.bounds, { x: 0, y: 0, w: 4, h: 3 });
  const wall = floodMask(data, W, H, 2, 1, 0, false);
  assert.deepEqual(wall.bounds, { x: 2, y: 0, w: 1, h: 3 });
  assert.deepEqual([...floodMask(data, W, H, 0, 0, 0, true).mask], [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0], 'contiguous is the default way');
  const s = sanitizeSettings({ fill: { contiguous: false } });
  assert.equal(s.fill.contiguous, false);
  assert.equal(s.wand.contiguous, true, 'on unless changed');
  assert.equal(sanitizeSettings({ figure: { corner: 9999 } }).figure.corner, 500);
});

test('rounded rectangles', () => {
  const sharp = figurePoints('rect', { x: 0, y: 0 }, { x: 20, y: 10 }, 1, 0);
  assert.equal(sharp.points.length, 4, 'no radius: the four corners');
  const r = figurePoints('rect', { x: 0, y: 0 }, { x: 20, y: 10 }, 1, 4);
  assert.ok(r.closed);
  // quarter circle of radius 4 is 2π ≈ 6.28 px: 7 steps of at most 1 px, 8 points per corner
  assert.equal(r.points.length, 32);
  assert.deepEqual(r.points[0], { x: 16, y: 0 }, 'starts where the top edge meets the top-right arc');
  near(r.points[7].x, 20, 1e-9); near(r.points[7].y, 4, 1e-9, 'top-right arc ends on the right edge');
  const centres = [[16, 4], [16, 6], [4, 6], [4, 4]];
  r.points.forEach((p, i) => { const [cx, cy] = centres[Math.floor(i / 8)]; near(Math.hypot(p.x - cx, p.y - cy), 4, 1e-9, `point ${i} on its arc`); });
  // a radius bigger than half the shorter side becomes half of it (a pill shape)
  const pill = figurePoints('rect', { x: 0, y: 0 }, { x: 20, y: 10 }, 1, 100);
  near(Math.min(...pill.points.map(p => p.y)), 0, 1e-9);
  near(pill.points[0].x, 15, 1e-9, 'radius 5');
});

test('border selection: a band half outside, half inside the edge', () => {
  // 9x9, a 3x3 square selected in the middle (x, y = 3..5)
  const W = 9, a = new Uint8Array(W * W);
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) a[y * W + x] = 255;
  const b = borderMask(a, W, W, 2);
  const on = [...b].map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  // grown by 1 (orthogonal steps only: 3x3 + the four sides' neighbours) minus shrunk by 1 (the centre pixel)
  assert.equal(on.length, 9 + 12 - 1);
  assert.equal(b[4 * W + 4], 0, 'the middle is out');
  assert.equal(b[2 * W + 4], 255, 'just outside the top edge is in');
  assert.equal(b[2 * W + 2], 0, 'diagonal corners are farther than 1 px');
  const thin = borderMask(a, W, W, 1);
  assert.equal([...thin].filter(v => v).length, 12, 'width 1: only the outside ring');
});
