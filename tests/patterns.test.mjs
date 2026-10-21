// Patterns, pattern places and fill layers. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PATTERNS, builtinPattern, sanitizeUserPatterns, isUserPattern, patternExists, patternChoices, patternSize, PATTERN_MAX,
  sanitizePlace, patternMatrix, mapPlace, sanitizeFill, gradientLine, mapFill, newGradientFill } from '../web/js/patterns.js';
import { sanitizeSettings, applySettings, TOOL_BY_ID } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} ≈ ${b}`);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const sum = v => v.reduce((s, x) => s + x, 0);

test('every built-in pattern has a tile; tiles are coverage 0-255', () => {
  for (const [id] of BUILTIN_PATTERNS) {
    const p = builtinPattern(id);
    assert.ok(p && p.w > 0 && p.h > 0 && p.values.length === p.w * p.h, id);
    assert.ok(sum(p.values) > 0 && sum(p.values) < 255 * p.w * p.h, `${id} is neither empty nor solid`);
  }
  assert.equal(builtinPattern('nope'), null);
});

test('built-in tiles: inked where their shape is', () => {
  const ch = builtinPattern('checker');  // 8 px squares, top-left inked
  assert.equal(ch.values[0], 255);
  assert.equal(ch.values[8], 0);
  assert.equal(ch.values[8 * 16 + 8], 255);
  assert.equal(sum(ch.values), 128 * 255);
  const ln = builtinPattern('lines');  // rows 3 and 4 of 8
  assert.equal(ln.values[3 * 8], 255);
  assert.equal(ln.values[2 * 8], 0);
  assert.equal(sum(ln.values), 16 * 255);
  assert.equal(sum(builtinPattern('grid').values), 31 * 255);  // column 0 and row 0 of 16 x 16
  const dots = builtinPattern('dots');
  assert.equal(dots.values[8 * 16 + 8], 255);
  assert.equal(dots.values[0], 0);
  // stripes: pixel (7, 0) has 6 of its 16 samples with x + y < 8 (i + j <= 2)
  const st = builtinPattern('stripes');
  assert.equal(st.values[0], 255);
  assert.equal(st.values[7], 96);
  const br = builtinPattern('bricks');  // 2 px mortar; the second row half a brick on
  assert.equal(br.values[0], 0);
  assert.equal(br.values[5 * 32 + 5], 255);
  assert.equal(br.values[9 * 32 + 16], 0);
  assert.equal(br.values[12 * 32 + 20], 255);
});

test('your patterns: valid ones kept, ids unique, size limited', () => {
  const list = sanitizeUserPatterns([
    { id: 'a1', name: 'Leaves', src: PNG, w: 64, h: 32 },
    { id: 'a1', name: 'Again', src: PNG, w: 8, h: 8 },
    { id: 'b2', src: 'data:image/jpeg;base64,xx', w: 8, h: 8 },
    { id: 'c3', src: PNG, w: PATTERN_MAX + 1, h: 8 },
    { id: 'BAD!', src: PNG, w: 8, h: 8 },
    { id: 'd4', src: PNG, w: 8, h: 8 },
  ]);
  assert.deepEqual(list.map(p => p.id), ['a1', 'd4']);
  assert.equal(list[1].name, 'Pattern');
  assert.deepEqual(sanitizeUserPatterns('junk'), []);
  assert.ok(isUserPattern('user:a1'));
  assert.ok(!isUserPattern('dots'));
  assert.ok(patternExists('dots') && patternExists('user:a1', list) && !patternExists('user:zz', list));
  assert.deepEqual(patternChoices(list).map(c => c[0]), ['none', ...BUILTIN_PATTERNS.map(p => p[0]), 'user:a1', 'user:d4']);
  assert.equal(patternChoices([], null)[0][0], 'dots');
  assert.deepEqual(patternSize(1024, 256), { w: 512, h: 128 });
  assert.deepEqual(patternSize(100, 50), { w: 100, h: 50 });
});

test('a place: tile pixels to doc pixels', () => {
  assert.deepEqual(patternMatrix({ scale: 2, angle: 90, x: 10, y: 5 }), [0, 2, -2, 0, 10, 5]);
  assert.deepEqual(patternMatrix({ scale: 1, angle: 0, x: 0, y: 0, mirror: true }), [-1, 0, 0, 1, 0, 0]);
  const p = sanitizePlace({ scale: 100, angle: -90, x: 'x', y: 3 });
  assert.deepEqual(p, { scale: 20, angle: 270, x: 0, y: 3, mirror: false });
});

test('a place follows the canvas: flips, turns, image size', () => {
  const p = { scale: 1, angle: 0, x: 0, y: 0, mirror: false };
  // flip horizontally on a 200 px wide canvas: mirrored, its corner now at the right edge
  const f = mapPlace(p, [-1, 0, 0, 1, 200, 0]);
  assert.deepEqual(f, { scale: 1, angle: 0, x: 200, y: 0, mirror: true });
  assert.deepEqual(patternMatrix(f), [-1, 0, 0, 1, 200, 0]);
  assert.deepEqual(mapPlace(f, [-1, 0, 0, 1, 200, 0]), p);  // flipped back
  // turned 90° right on a canvas 100 px high: (x, y) -> (100 - y, x)
  assert.deepEqual(mapPlace(p, [0, 1, -1, 0, 100, 0]), { scale: 1, angle: 90, x: 100, y: 0, mirror: false });
  // image size doubled
  assert.deepEqual(mapPlace({ scale: 1.5, angle: 30, x: 3, y: 4, mirror: false }, [2, 0, 0, 2, 0, 0]), { scale: 3, angle: 30, x: 6, y: 8, mirror: false });
  // a turned, mirrored place survives a flip vertically: its matrix is the flip times the old one
  const q = { scale: 2, angle: 30, x: 5, y: 7, mirror: true }, m = [1, 0, 0, -1, 0, 50];
  const [a, b, c, d, e, ff] = patternMatrix(q), want = [a, -b, c, -d, e, 50 - ff];
  patternMatrix(mapPlace(q, m)).forEach((v, i) => near(v, want[i], 1e-5, `entry ${i}`));
});

test('fill layer data: cleaned up, defaults filled in', () => {
  assert.equal(sanitizeFill(null), null);
  assert.equal(sanitizeFill({ type: 'paint' }), null);
  assert.deepEqual(sanitizeFill({ type: 'color', color: '#AABBCC' }), { type: 'color', color: '#aabbcc' });
  assert.deepEqual(sanitizeFill({ type: 'color', color: 'red' }), { type: 'color', color: '#000000' });
  const g = sanitizeFill({ type: 'gradient', stops: [[2, '#ff0000'], [0.5, 'rgba(0, 0, 255, 0.5)'], [0.2, 'url(x)']], shape: 'spiral', angle: 450, scale: 0 });
  assert.deepEqual(g.stops, [[0.5, 'rgba(0, 0, 255, 0.5)'], [1, '#ff0000']]);
  assert.equal(g.shape, 'linear');
  assert.equal(g.repeat, 'none');
  assert.equal(g.angle, 90);
  assert.equal(g.scale, 0.05);
  assert.deepEqual(sanitizeFill({ type: 'gradient', stops: [[0, '#000000']] }).stops, [[0, '#000000'], [1, '#ffffff']]);
  assert.equal(sanitizeFill({ type: 'pattern', src: 'data:text/plain,x', w: 8, h: 8 }), null);
  const p = sanitizeFill({ type: 'pattern', name: 'Dots', src: PNG, w: 16, h: 16, scale: 2, angle: 45, x: 3 });
  assert.deepEqual(p, { type: 'pattern', id: '', name: 'Dots', src: PNG, w: 16, h: 16, scale: 2, angle: 45, x: 3, y: 0, mirror: false });
});

test('a gradient fill runs across the canvas from its middle', () => {
  const g = newGradientFill([[0, '#000000'], [1, '#ffffff']], 'main-sub', 200, 100);
  assert.deepEqual(gradientLine(g, 200, 100), { start: { x: 0, y: 50 }, end: { x: 200, y: 50 } });
  assert.deepEqual(gradientLine({ ...g, angle: 90 }, 200, 100), { start: { x: 100, y: 0 }, end: { x: 100, y: 100 } });
  assert.deepEqual(gradientLine({ ...g, scale: 0.5 }, 200, 100), { start: { x: 50, y: 50 }, end: { x: 150, y: 50 } });
  const radial = gradientLine({ ...g, shape: 'radial' }, 200, 100);  // half the diagonal: sqrt(200² + 100²) / 2
  assert.deepEqual(radial.start, { x: 100, y: 50 });
  near(radial.end.x, 100 + 111.80339887, 1e-6);
  assert.deepEqual(gradientLine({ ...g, shape: 'reflected' }, 200, 100), { start: { x: 100, y: 50 }, end: { x: 200, y: 50 } });
});

test('fills follow the canvas', () => {
  const g = newGradientFill([[0, '#000000'], [1, '#ffffff']], 'main-sub', 200, 100, { angle: 0 });
  const flipped = mapFill(g, [-1, 0, 0, 1, 200, 0]);
  assert.equal(flipped.cx, 100);
  assert.equal(flipped.angle, 180);
  const cropped = mapFill(g, [1, 0, 0, 1, -30, -10]);
  assert.deepEqual([cropped.cx, cropped.cy, cropped.angle], [70, 40, 0]);
  const c = { type: 'color', color: '#123456' };
  assert.equal(mapFill(c, [2, 0, 0, 2, 0, 0]), c);
  const p = sanitizeFill({ type: 'pattern', src: PNG, w: 8, h: 8 });
  assert.deepEqual(mapFill(p, [1, 0, 0, 1, 5, 6]), { ...p, x: 5, y: 6 });
  assert.notEqual(mapFill(p, [1, 0, 0, 1, 0, 0]), p);  // a new object: fills are never changed in place
});

test('pattern settings: Fill and the paint tools, validated', () => {
  const s = sanitizeSettings({ fill: { pattern: 'user:ab12', patScale: 50, patX: -3 }, brush: { pattern: 'bogus' }, pen: { pattern: 'dots', patAngle: 400 } });
  assert.equal(s.fill.pattern, 'user:ab12');
  assert.equal(s.fill.patScale, 10);
  assert.equal(s.fill.patX, -3);
  assert.equal(s.brush.pattern, 'none');
  assert.equal(s.pen.pattern, 'dots');
  assert.equal(s.pen.patAngle, 360);
  assert.equal(TOOL_BY_ID.fill.defaults.pattern, 'none');
  assert.equal(applySettings({ pattern: 'none' }, { pattern: 'user:BAD' }).pattern, 'none');
});

test('fill layers are saved; older files have none', () => {
  const raw = { width: 10, height: 10, layers: [
    { name: 'Sky', fill: { type: 'color', color: '#336699' } },
    { name: 'Plain' },
    { name: 'Broken', fill: { type: 'what' } },
  ] };
  const d = sanitizeDoc(raw);
  assert.deepEqual(d.layers[0].fill, { type: 'color', color: '#336699' });
  assert.ok(!('fill' in d.layers[1]));
  assert.ok(!('fill' in d.layers[2]));
});
