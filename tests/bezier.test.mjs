// Bezier control points for vector lines: sampling, splitting, editing and fitting, with values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bezierAt, curvePoints, splitAt, removeAnchor, moveAnchor, moveHandle, toggleCorner, isSmooth, mapCtrl, fitCurve,
  nearestOnCurve, sanitizeCtrl, setPressure, cornerCtrl } from '../web/js/bezier.js';

const near = (a, b, e, msg) => assert.ok(Math.abs(a - b) <= e, `${msg}: ${a} is not ${b}`);

test('bezierAt: ends and the middle of a symmetric arch', () => {
  const q = [[0, 0], [0, 40], [100, 40], [100, 0]];
  assert.deepEqual(bezierAt(q, 0), [0, 0]);
  assert.deepEqual(bezierAt(q, 1), [100, 0]);
  // t = 1/2: (P0 + 3 P1 + 3 P2 + P3) / 8 = (0 + 0 + 300 + 100) / 8, (0 + 120 + 120 + 0) / 8
  assert.deepEqual(bezierAt(q, 0.5), [50, 30]);
});

test('curvePoints: a straight two-point line, pressure blended, ends exact', () => {
  const ctrl = [[0, 0, 0.2, 0, 0, 0, 0], [10, 0, 1, 0, 0, 0, 0]];
  const pts = curvePoints(ctrl, false, 2);
  assert.equal(pts.length, 9, 'length 10, step 2, 1.5 times as many: t = 0, 1/8, ... 7/8 and the end');
  // no handles: x = 10 (3 t^2 (1 - t) + t^3); t = 1/2 -> 5, t = 1/4 -> 10 (3/64 * 3 + 1/64) = 1.5625
  near(pts[4][0], 5, 1e-9, 'x at t 1/2');
  near(pts[2][0], 1.5625, 1e-9, 'x at t 1/4');
  near(pts[2][2], 0.4, 1e-9, 'pressure 0.2 + 0.8 / 4');
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] - pts[i - 1][0] <= 2 + 1e-9, 'no gap over the step');
  assert.deepEqual(pts.at(-1), [10, 0, 1]);
  const closed = curvePoints([[0, 0, 1, 0, 0, 0, 0], [10, 0, 1, 0, 0, 0, 0], [10, 10, 1, 0, 0, 0, 0]], true, 100);
  assert.deepEqual(closed.map(p => p.slice(0, 2)), [[0, 0], [10, 0], [10, 10], [0, 0]], 'closed: back to the first anchor');
});

test('splitAt keeps the curve and puts the new anchor on it', () => {
  const ctrl = [[0, 0, 0, 0, 0, 0, 40], [100, 0, 1, 0, 40, 0, 0]];
  const [out, k] = splitAt(ctrl, false, 0, 0.5);
  assert.equal(k, 1);
  assert.equal(out.length, 3);
  assert.deepEqual(out[1].slice(0, 3), [50, 30, 0.5], 'the arch top, pressure halfway');
  // de Casteljau at 1/2: q0 = (0, 20), r0 = (25, 30), r1 = (75, 30), q2 = (100, 20)
  assert.deepEqual(out[0].slice(5), [0, 20], 'first anchor out handle halved');
  assert.deepEqual(out[1].slice(3), [-25, 0, 25, 0], 'new anchor handles flat (top of the arch)');
  assert.deepEqual(out[2].slice(3, 5), [0, 20], 'last anchor in handle halved');
  const a = curvePoints(ctrl, false, 0.5), b = curvePoints(out, false, 0.5);
  for (const p of b) { const n = nearestOnCurve(ctrl, false, p[0], p[1]); assert.ok(n.d < 0.6, `point ${p} off the curve by ${n.d}`); }
  assert.ok(a.length > 10);
});

test('nearestOnCurve finds the arch top', () => {
  const n = nearestOnCurve([[0, 0, 1, 0, 0, 0, 40], [100, 0, 1, 0, 40, 0, 0]], false, 50, 35);
  near(n.t, 0.5, 0.02, 't');
  near(n.d, 5, 0.05, 'distance 35 - 30');
});

test('moving anchors and handles; smooth points stay smooth when mirrored', () => {
  const ctrl = [[0, 0, 1, 0, 0, 10, 0], [50, 0, 1, -10, 0, 20, 0], [100, 0, 1, 0, 0, 0, 0]];
  assert.ok(isSmooth(ctrl[1]) && !isSmooth(ctrl[0]) && !isSmooth(ctrl[2]));
  const moved = moveAnchor(ctrl, 1, 60, 5);
  assert.deepEqual(moved[1], [60, 5, 1, -10, 0, 20, 0], 'handles go along');
  // drag the in handle to straight above the anchor, 30 px: out turns to straight below, keeping its 20 px
  const h = moveHandle(ctrl, 1, 'in', 50, -30, true);
  [0, -30, 0, 20].forEach((v, i) => near(h[1][3 + i], v, 1e-9, `handle ${i}`));
  assert.ok(isSmooth(h[1]));
  const free = moveHandle(ctrl, 1, 'in', 50, -30, false);
  assert.deepEqual(free[1].slice(3), [0, -30, 20, 0], 'without mirror the other handle stays');
  assert.equal(removeAnchor(ctrl, 1).length, 2);
  assert.equal(removeAnchor(removeAnchor(ctrl, 1), 0).length, 2, 'never fewer than two');
  assert.equal(setPressure(ctrl, 0, 1.5)[0][2], 1);
});

test('toggleCorner: smooth to corner, corner to smooth along its neighbours', () => {
  const ctrl = cornerCtrl([{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 90, y: 30 }]);
  const s = toggleCorner(ctrl, false, 1);
  // direction (0,0) -> (90,30) = (3, 1)/sqrt(10); in = a third of 42.43 back, out = a third of 60 forward
  const d = Math.sqrt(10);
  near(s[1][3], -3 / d * Math.hypot(30, 30) / 3, 1e-9, 'in x');
  near(s[1][6], 1 / d * 20, 1e-9, 'out y');
  assert.ok(isSmooth(s[1]));
  assert.deepEqual(toggleCorner(s, false, 1)[1].slice(3), [0, 0, 0, 0]);
});

test('mapCtrl moves anchors and turns handles with an affine map', () => {
  const ctrl = [[10, 0, 1, 0, 0, 5, 0], [20, 0, 0.5, -5, 0, 0, 0]];
  const turned = mapCtrl(ctrl, (x, y) => [-y, x]);  // a quarter turn
  assert.deepEqual(turned[0].map(v => v + 0), [0, 10, 1, 0, 0, 0, 5]);
  assert.deepEqual(turned[1].map(v => v + 0), [0, 20, 0.5, 0, -5, 0, 0]);
});

test('sanitizeCtrl', () => {
  assert.equal(sanitizeCtrl(null), null);
  assert.equal(sanitizeCtrl([[1, 2, 1, 0, 0, 0, 0]]), null, 'one anchor is not a line');
  assert.equal(sanitizeCtrl([[1, 2], ['x', 0]]), null);
  assert.deepEqual(sanitizeCtrl([[1, 2], [3, 4, 2]]), [[1, 2, 0, 0, 0, 0, 0], [3, 4, 1, 0, 0, 0, 0]], 'missing handles are 0, pressure clamped');
});

test('fitCurve: a straight line is two anchors', () => {
  const pts = Array.from({ length: 51 }, (_, i) => [i * 2, 10, 1]);
  const ctrl = fitCurve(pts, 1);
  assert.equal(ctrl.length, 2);
  assert.deepEqual(ctrl[0].slice(0, 3), [0, 10, 1]);
  assert.deepEqual(ctrl[1].slice(0, 3), [100, 10, 1]);
});

test('fitCurve: an L keeps its corner, a quarter circle needs few anchors and stays within the tolerance', () => {
  const L = [...Array.from({ length: 26 }, (_, i) => [i * 2, 0, 1]), ...Array.from({ length: 25 }, (_, i) => [50, (i + 1) * 2, 1])];
  const c = fitCurve(L, 1);
  assert.equal(c.length, 3, 'start, corner, end');
  assert.deepEqual(c[1].slice(0, 2), [50, 0]);
  assert.ok(!isSmooth(c[1]));
  const arc = Array.from({ length: 80 }, (_, i) => { const a = (i / 79) * Math.PI / 2; return [100 * Math.cos(a), 100 * Math.sin(a), 1]; });
  const ca = fitCurve(arc, 0.5);
  assert.ok(ca.length <= 3, `${ca.length} anchors for a quarter circle`);
  for (const p of arc) assert.ok(nearestOnCurve(ca, false, p[0], p[1]).d <= 0.5 + 0.05, 'within 0.5 px');
});

test('fitCurve keeps pressure within 0.08: a swelling line gets a middle anchor', () => {
  const pts = Array.from({ length: 51 }, (_, i) => [i * 2, 0, i <= 25 ? 0.2 + i * 0.032 : 1 - (i - 25) * 0.032]);
  const c = fitCurve(pts, 1);
  assert.ok(c.length >= 3);
  const mid = c.reduce((m, a) => (a[2] > m[2] ? a : m));
  near(mid[2], 1, 0.1, 'the strongest anchor near the middle has the full pressure');
});
