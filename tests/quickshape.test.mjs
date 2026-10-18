// QuickShape (quickshape.js): recognising a held stroke as a line or an ellipse. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectShape, shapePoints, adjustShape } from '../web/js/quickshape.js';

const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≈ ${b}`);
const ring = (cx, cy, rx, ry, angle, n = 72) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (i / n) * Math.PI * 2, u = Math.cos(t) * rx, v = Math.sin(t) * ry;
  return { x: cx + u * Math.cos(angle) - v * Math.sin(angle), y: cy + u * Math.sin(angle) + v * Math.cos(angle) };
});

test('a straight-ish stroke becomes a line from end to end', () => {
  const pts = Array.from({ length: 51 }, (_, i) => ({ x: i * 2, y: i % 2 ? 1.5 : -1.5 }));
  assert.deepEqual(detectShape(pts), { shape: 'line', a: { x: 0, y: -1.5 }, b: { x: 100, y: -1.5 } }, 'point 50 is even: below');
  assert.equal(detectShape([{ x: 0, y: 0 }, { x: 10, y: 0 }]), null, 'too short to count');
  const u = [...Array.from({ length: 50 }, (_, i) => ({ x: 0, y: i * 2 })), ...Array.from({ length: 30 }, (_, i) => ({ x: i * 2, y: 100 })),
    ...Array.from({ length: 50 }, (_, i) => ({ x: 60, y: 100 - i * 2 }))];
  assert.equal(detectShape(u), null, 'a U shape is neither a line nor a loop');
});

test('a loop becomes an ellipse along its main direction', () => {
  const c = detectShape(ring(100, 100, 50, 50, 0));
  assert.equal(c.shape, 'ellipse');
  near(c.cx, 100, 'cx', 1e-3); near(c.cy, 100, 'cy', 1e-3);
  near(c.rx, 50, 'rx', 0.2); near(c.ry, 50, 'ry', 0.2);
  const e = detectShape(ring(200, 120, 80, 30, Math.PI / 6));
  const turn = ((e.angle - Math.PI / 6) % Math.PI + Math.PI) % Math.PI;
  assert.ok(turn < 1e-6 || Math.PI - turn < 1e-6, `turned 30° (${e.angle})`);
  near(e.rx, 80, 'long radius', 0.2); near(e.ry, 30, 'short radius', 0.2);
  near(e.cx, 200, 'centre x', 1e-3); near(e.cy, 120, 'centre y', 1e-3);
  const open = ring(0, 0, 40, 40, 0).slice(0, 66);  // nearly closed: the gap is small next to its length
  assert.equal(detectShape(open).shape, 'ellipse');
});

test('points along a shape, and stretching it', () => {
  const line = shapePoints({ shape: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 0.5);
  assert.equal(line.length, 11);
  assert.deepEqual(line[10], { x: 10, y: 0, p: 0.5 });
  const el = shapePoints({ shape: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 10, angle: 0 }, 1);
  near(el[0].x, el[el.length - 1].x, 'closes x'); near(el[0].y, el[el.length - 1].y, 'closes y');
  assert.deepEqual(adjustShape({ shape: 'line', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, { x: 100, y: 0 }, { x: 120, y: 10 }).b, { x: 120, y: 10 },
    'the end follows the pen');
  const big = adjustShape({ shape: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 20, angle: 0 }, { x: 50, y: 0 }, { x: 0, y: 100 });
  assert.deepEqual([big.rx, big.ry], [100, 40], 'twice as far from the centre: twice the size');
});
