// Vector layers: data, geometry and the three erase modes. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBrush, sanitizeVector, emptyVector, resample, addStrokes, translateVector, strokeBounds, changedBounds,
  strokeStamps, segDist, segCross, eraseVector, seeded, smoothPoints, pullStroke, usesDynamics, dualStamps } from '../web/js/vector.js';

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

test('vector lines repeat their colour jitter', () => {
  const line = { pts: [[0, 0, 1], [40, 0, 1]], seed: 7, color: '#ff0000' };
  const b = sanitizeBrush({ size: 10, hueJitter: 1, pressureSize: false });
  const one = strokeStamps(line, b), two = strokeStamps(line, b);
  assert.deepEqual(one, two, 'the same seed gives the same colours');
  assert.ok(one.every(st => /^#[0-9a-f]{6}$/.test(st.c)), 'every dab has a colour');
  assert.ok(new Set(one.map(st => st.c)).size > 1, 'the colours vary');
  const once = strokeStamps(line, sanitizeBrush({ size: 10, hueJitter: 1, colorJitterStroke: true, pressureSize: false }));
  assert.ok(once.every(st => !('c' in st)), 'per stroke: the line colour is already varied');
  assert.ok(strokeStamps(line, sanitizeBrush({ size: 10 })).every(st => !('c' in st)), 'no jitter, no colours');
});

test('editing lines: pick, pull, width, colour, remove', async () => {
  const { nearestStroke, pullStroke, editStroke, removeStroke, brushOf } = await import('../web/js/vector.js');
  const v = vec(line(0, 0, 10, 0, 10), line(0, 10, 10, 10, 10));
  // (5, 3) is 3 from the first path (1 past its 2 px half width) and 7 from the second (5 past it)
  assert.equal(nearestStroke(v, 5, 3, 4), 0);
  assert.equal(nearestStroke(v, 5, 8.5, 4), 1, 'inside the second line counts as distance below zero');
  assert.equal(nearestStroke(v, 5, 50, 4), -1, 'nothing within reach');
  assert.equal(nearestStroke(v, 5, 6.5, 0.4), -1, '4.5 and 1.5 past the edges are both beyond 0.4');

  const s = { pts: line(0, 0, 20, 0, 20), b: 0, color: '#000000', opacity: 1, seed: 1 };
  const p = pullStroke(s, { x: 10, y: 0 }, { x: 10, y: 4 }, 5);
  assert.deepEqual(p.pts[10], [10, 4, 1], 'the grabbed point moves all the way');
  assert.deepEqual(p.pts[13], [13, 1.64, 1], '3 px away: (1 - 9/25)^2 = 0.4096 of the way, rounded to 1/100');
  assert.deepEqual(p.pts[16], [16, 0, 1], 'beyond the radius nothing moves');
  assert.equal(p.pts.length, 21, 'no gap grew past the 2 px step');
  const far = pullStroke(s, { x: 10, y: 0 }, { x: 10, y: 30 }, 3);
  assert.ok(far.pts.length > 21, 'a long pull adds points so the stretched part stays smooth');
  assert.equal(s.pts[10][1], 0, 'the original line is left as it was');

  const wide = editStroke(v, 0, { w: 2, color: '#ff0000' });
  assert.equal(brushOf(wide, wide.strokes[0]).size, 8, 'twice as wide');
  assert.equal(brushOf(wide, wide.strokes[1]).size, 4, 'the other line keeps its brush');
  assert.equal(wide.strokes[0].color, '#ff0000');
  assert.equal(v.strokes[0].w, undefined, 'the old object is unchanged');
  assert.ok(!('w' in editStroke(wide, 0, { w: 1 }).strokes[0]), 'back to 1: not stored');
  assert.deepEqual(removeStroke(v, 0).strokes, [v.strokes[1]]);
  assert.ok(strokeBounds(wide.strokes[0], brushOf(wide, wide.strokes[0])).h > strokeBounds(v.strokes[0], B).h, 'wider bounds');

  const loaded = sanitizeVector({ brushes: [B], strokes: [{ pts: [[0, 0, 1]], w: 9 }, { pts: [[0, 0, 1]], w: 'x' }, { pts: [[0, 0, 1]] }] });
  assert.deepEqual(loaded.strokes.map(x => x.w), [5, undefined, undefined], 'clamped; missing or broken means 1');
});

test('smoothing a shaky line keeps its ends and pressure', async () => {
  const { smoothPoints, smoothStroke } = await import('../web/js/vector.js');
  const zig = [[0, 0, 0.2], [2, 2, 0.4], [4, 0, 0.6], [6, 2, 0.8], [8, 0, 1]];
  // one round: (2,2) -> ((0 + 4 + 4) / 4, (0 + 4 + 0) / 4) = (2, 1); (4,0) -> (4, 1); (6,2) -> (6, 1)
  assert.deepEqual(smoothPoints(zig, 1), [[0, 0, 0.2], [2, 1, 0.4], [4, 1, 0.6], [6, 1, 0.8], [8, 0, 1]]);
  assert.deepEqual(smoothPoints(zig, 0), zig);
  const s = smoothStroke({ pts: zig, color: '#000' }, 20);
  assert.deepEqual(s.pts[0], [0, 0, 0.2]); assert.deepEqual(s.pts.at(-1), [8, 0, 1]);
  assert.ok(s.pts.every(([, y]) => y <= 1.1), 'the zigzag is nearly flat after many rounds');
  assert.equal(s.color, '#000');
});

test('lines keep pen tilt and speed', () => {
  // sanitizing: extras clamped, kept only when there
  const v = sanitizeVector({ brushes: [{}], strokes: [{ pts: [[0, 0, 1], [1, 0, 0.5, 2, -1, 'x'], [2, 0, 1, 0.5, 0.25, 1.23456]] }] });
  assert.deepEqual(v.strokes[0].pts, [[0, 0, 1], [1, 0, 0.5, 1, 0, null], [2, 0, 1, 0.5, 0.25, 1.235]]);
  // resampling blends tilt and speed and takes the later point's direction
  assert.deepEqual(resample([[0, 0, 1, 0, 0, 1], [4, 0, 1, 1, 0.5, 2]], 2), [[0, 0, 1, 0, 0, 1], [2, 0, 1, 0.5, 0.25, 2], [4, 0, 1, 1, 0.5, 2]]);
  // a plain point next to one with extras borrows them (no jump from 0)
  assert.deepEqual(resample([[0, 0, 1], [2, 0, 1, 1, 1, null]], 1)[1], [1, 0, 1, 1, 1, null]);
  assert.deepEqual(translateVector({ brushes: [B], strokes: [{ pts: [[1, 1, 1, 0.5, 0.5, 0]] }] }, 2, 3).strokes[0].pts, [[3, 4, 1, 0.5, 0.5, 0]]);
  assert.deepEqual(smoothPoints([[0, 0, 1, 0, 0, null], [1, 4, 1, 1, 1, 2], [2, 0, 1, 0, 0, null]], 1)[1], [1, 2, 1, 1, 1, 2], 'extras ride along');
  assert.equal(pullStroke({ pts: [[0, 0, 1, 0.3, 0.6, null]] }, { x: 0, y: 0 }, { x: 1, y: 0 }, 5).pts[0][3], 0.3);
  // dabs: tilt to size 1 at full tilt makes them three times as big; no extras = as drawn
  const b = sanitizeBrush({ size: 10, spacing: 1, pressureSize: false, tiltSize: 1 });
  assert.ok(usesDynamics(b) && !usesDynamics(B));
  const tilted = strokeStamps({ pts: [[0, 0, 1, 1, 0, null], [100, 0, 1, 1, 0, null]], seed: 1 }, b);
  assert.ok(tilted.length > 1 && tilted.every(st => Math.abs(st.k - 3) < 1e-9), 'tilt 1: k = 1 + 2 = 3');
  const upright = strokeStamps({ pts: [[0, 0, 1], [100, 0, 1]], seed: 1 }, b);
  assert.ok(upright.every(st => st.k === 1));
  // turn with tilt gives each dab the lean direction
  const turn = strokeStamps({ pts: [[0, 0, 1, 0.5, 0, 0.7], [50, 0, 1, 0.5, 0, 0.7]], seed: 1 }, sanitizeBrush({ size: 10, tiltAngle: true }));
  assert.ok(turn.every(st => st.a === 0.7));
  // bounds grow with the tilt reach (3x the half width)
  assert.ok(strokeBounds({ pts: [[0, 0, 1]] }, b).w > strokeBounds({ pts: [[0, 0, 1]] }, sanitizeBrush({ size: 10, pressureSize: false })).w);
});

test('lines keep the dual brush', () => {
  const b = sanitizeBrush({ size: 10, pressureSize: false, dualTip: 'round', dualSize: 0.5, dualSpacing: 1, dualScatter: 0 });
  assert.equal(b.dualTip, 'round');
  assert.equal(sanitizeBrush({ dualTip: '<x>' }).dualTip, 'none');
  assert.equal(sanitizeBrush({ dualSize: 9 }).dualSize, 3);
  const s = { pts: [[0, 0, 1], [20, 0, 1]], seed: 5 };
  // dual tip 5 px (half of 10), spaced by its size: a dab at 0, 5, 10, 15, 20
  assert.deepEqual(dualStamps(s, b).map(st => [st.x, st.y, st.size]), [[0, 0, 5], [5, 0, 5], [10, 0, 5], [15, 0, 5], [20, 0, 5]]);
  assert.deepEqual(dualStamps(s, B), [], 'off');
  const sc = sanitizeBrush({ ...b, dualScatter: 1 });
  assert.deepEqual(dualStamps(s, sc), dualStamps(s, sc), 'scatter is repeatable from the seed');
  assert.ok(dualStamps(s, sc).some(st => st.y !== 0), 'and scatters');
});
