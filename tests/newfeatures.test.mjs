// Custom gradients, star and polygon figures, the mesh transform and the pen pressure curve.
// Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStops, sanitizeUserGradients, gradientStops, stopCss, addStopAt, stopsFor, isUserGradient, gradientChoices, GRADIENT_COLORS } from '../web/js/gradient.js';
import { figurePoints, FIGURE_SHAPES } from '../web/js/figure.js';
import { meshFromQuad, meshSurface, meshHit, meshWarp } from '../web/js/transform.js';
import { adjustPressure, pressureFromStrokes, PRESSURE_PRESETS } from '../web/js/brush.js';
import { sanitizeSettings } from '../web/js/tools.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≈ ${b}`);

test('gradient stops are cleaned up', () => {
  assert.deepEqual(sanitizeStops([{ o: 2, c: '#FF0000' }, { o: -1, c: 'main', a: 5 }, { o: 0.5, c: 'bad' }]),
    [{ o: 0, c: 'main', a: 1 }, { o: 1, c: '#ff0000', a: 1 }], 'clamped, sorted, bad colour dropped');
  assert.equal(sanitizeStops([{ o: 0, c: '#000000' }]), null, 'one stop is not a gradient');
  const list = sanitizeUserGradients([
    { id: 'a1', name: 'One', stops: [{ o: 0, c: 'main' }, { o: 1, c: 'sub' }] },
    { id: 'a1', name: 'Twin', stops: [{ o: 0, c: 'main' }, { o: 1, c: 'sub' }] },
    { id: 'BAD!', name: 'Bad id', stops: [{ o: 0, c: 'main' }, { o: 1, c: 'sub' }] },
    { id: 'b2', stops: [{ o: 0, c: 'main' }] },
  ]);
  assert.deepEqual(list.map(g => g.id), ['a1'], 'repeated ids, bad ids and one-stop gradients are dropped');
});

test('your gradients as colours', () => {
  assert.equal(stopCss({ c: 'main', a: 1 }, '#ff0000', '#000000'), 'rgb(255,0,0)');
  assert.equal(stopCss({ c: '#00ff00', a: 0.5 }, '#ff0000', '#000000'), 'rgba(0,255,0,0.5)');
  const user = [{ id: 'abc', name: 'Mine', stops: [{ o: 0, c: 'sub', a: 1 }, { o: 1, c: '#00ff00', a: 0.25 }] }];
  assert.deepEqual(gradientStops('user:abc', '#ff0000', '#0000ff', user), [[0, 'rgb(0,0,255)'], [1, 'rgba(0,255,0,0.25)']]);
  assert.deepEqual(gradientStops('user:gone', '#ff0000', '#0000ff', user), [[0, '#ff0000'], [1, '#0000ff']], 'deleted: main → sub');
  assert.ok(isUserGradient('user:abc') && !isUserGradient('sunset') && !isUserGradient('user:'));
  assert.deepEqual(gradientChoices(user).at(-1), ['user:abc', 'Mine']);
  assert.equal(gradientChoices(user).length, GRADIENT_COLORS.length + 1);
  assert.equal(sanitizeSettings({ gradient: { colors: 'user:abc' } }).gradient.colors, 'user:abc', 'the tool may name one');
  assert.equal(sanitizeSettings({ gradient: { colors: 'user:<x>' } }).gradient.colors, 'main-sub');
});

test('a new stop takes the colour the gradient shows there', () => {
  const stops = [{ o: 0, c: '#000000', a: 1 }, { o: 1, c: '#ffffff', a: 0 }];
  const out = addStopAt(stops, 0.25, '#ff0000', '#0000ff');
  assert.equal(out.length, 3);
  assert.deepEqual(out[1], { o: 0.25, c: '#404040', a: 0.75 }, '255 × 0.25 = 63.75 → 64 = 0x40; opacity 1 → 0 a quarter of the way');
  assert.deepEqual(addStopAt([{ o: 0.2, c: 'main', a: 1 }, { o: 1, c: 'sub', a: 1 }], 0.1, '#f00', '#00f')[0], { o: 0.1, c: 'main', a: 1 }, 'before the first: a copy of it');
});

test('built-in gradients as editable stops', () => {
  assert.deepEqual(stopsFor('main-clear'), [{ o: 0, c: 'main', a: 1 }, { o: 1, c: 'main', a: 0 }]);
  assert.deepEqual(stopsFor('gray'), [{ o: 0, c: '#000000', a: 1 }, { o: 1, c: '#ffffff', a: 1 }]);
  assert.deepEqual(stopsFor('nonsense'), [{ o: 0, c: 'main', a: 1 }, { o: 1, c: 'sub', a: 1 }]);
});

test('regular polygons and stars', () => {
  assert.ok(FIGURE_SHAPES.some(([id]) => id === 'star') && FIGURE_SHAPES.some(([id]) => id === 'regpoly'));
  const sq = figurePoints('regpoly', { x: 0, y: 0 }, { x: 20, y: 20 }, 1, 0, 4);
  assert.equal(sq.closed, true);
  assert.equal(sq.points.length, 4);
  [[10, 0], [20, 10], [10, 20], [0, 10]].forEach(([x, y], i) => { near(sq.points[i].x, x, `corner ${i} x`); near(sq.points[i].y, y, `corner ${i} y`); });
  const star = figurePoints('star', { x: 0, y: 0 }, { x: 20, y: 20 }, 1, 0, 4, 0.5);
  assert.equal(star.points.length, 8, 'four points and four inner corners');
  near(star.points[1].x, 10 + 5 * Math.SQRT1_2, 'the first inner corner, at -45° and half the radius');
  near(star.points[1].y, 10 - 5 * Math.SQRT1_2, 'the first inner corner y');
});

test('mesh points, surface and grabbing', () => {
  const quad = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  const pts = meshFromQuad(quad, 3);
  assert.equal(pts.length, 16);
  assert.deepEqual(pts[5], { x: 10, y: 10 }, 'row 1, column 1');
  const fine = meshSurface(pts, 3, 2);
  assert.equal(fine.length, 49, '(3 × 2 + 1)²');
  near(fine[1 * 7 + 3].x, 15, 'an even mesh gives an even surface (x)');
  near(fine[1 * 7 + 3].y, 5, 'an even mesh gives an even surface (y)');
  assert.equal(meshHit(pts, 3, { x: 11, y: 9 }, 3), 5, 'near a point: that point');
  assert.equal(meshHit(pts, 3, { x: 15, y: 15 }, 3), 'move', 'inside: move it all');
  assert.equal(meshHit(pts, 3, { x: 50, y: 15 }, 3), null);
});

test('an untouched mesh draws the picture unchanged', () => {
  const quad = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  const fine = meshSurface(meshFromQuad(quad, 3), 3, 4);
  const src = new Uint8ClampedArray(30 * 30 * 4);
  for (let i = 0; i < 900; i++) src.set([40, 120, 200, 255], i * 4);
  const out = meshWarp(src, 30, 30, fine, 12, new Uint8ClampedArray(30 * 30 * 4), 0, 0, 30, 30);
  assert.deepEqual([...out], [...src]);
});

test('pen pressure curve', () => {
  assert.equal(adjustPressure(null, 0.3), 0.3, 'no curve: as it is');
  near(adjustPressure(PRESSURE_PRESETS.normal, 0.3), 0.3, 'the normal curve is the straight line');
  assert.equal(adjustPressure([[0, 0], [1, 0]], 0.7), 0.01, 'never quite 0');
  assert.ok(adjustPressure(PRESSURE_PRESETS.soft, 0.3) > 0.5 && adjustPressure(PRESSURE_PRESETS.firm, 0.6) < 0.4);
  assert.equal(pressureFromStrokes(Array(19).fill(0.5)), null, 'too few samples');
  const samples = Array.from({ length: 100 }, (_, i) => (i + 1) / 100);
  assert.deepEqual(pressureFromStrokes(samples), [[0, 0], [0.5, 0.5], [0.95, 1], [1, 1]], 'median 0.5 → half, 95th percentile 0.95 → full');
});
