// Guides, perspective, straight, curve and parallel rulers and stroke snapping. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRulers, sanitizeGrid, gridStep, newPerspective, niceStep, ticks, snapCandidates, pickLine, project, guideAt, MAX_GUIDES } from '../web/js/rulers.js';
import { sanitizeDoc } from '../web/js/doc.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} ≈ ${b}`);

test('sanitizing', () => {
  const r = sanitizeRulers({ guides: [{ axis: 'h', pos: 10.6 }, { axis: 'x', pos: 1 }, { axis: 'v', pos: 'abc' }], perspective: { points: [{ x: 1, y: 2 }, { x: 'no' }] }, snap: false });
  assert.deepEqual(r.guides, [{ axis: 'h', pos: 11 }], 'bad guides dropped, positions rounded');
  assert.deepEqual(r.perspective, { points: [{ x: 1, y: 2 }] });
  assert.equal(r.snap, false);
  assert.equal(r.visible, true);
  assert.equal(sanitizeRulers({ guides: Array.from({ length: 150 }, () => ({ axis: 'h', pos: 1 })) }).guides.length, MAX_GUIDES);
  assert.equal(sanitizeRulers(null).perspective, null);
  assert.deepEqual(sanitizeDoc({}).rulers, { guides: [], perspective: null, visible: true, snap: true,
    grid: { show: false, size: 100, div: 4, snap: false }, symmetry: { kind: 'off', lines: 6, x: null, y: null }, shapes: [] },
    'old files get empty rulers, a hidden grid and no symmetry');
});

test('new perspective rulers', () => {
  assert.deepEqual(newPerspective(1, 1000, 500), { points: [{ x: 500, y: 200 }] }, 'centre, horizon at 40%');
  assert.deepEqual(newPerspective(2, 1000, 500).points, [{ x: -150, y: 200 }, { x: 1150, y: 200 }]);
  assert.equal(newPerspective(3, 1000, 500).points[2].y, 900, 'third point below the canvas: 1.8 x 500');
});

test('ruler ticks', () => {
  assert.equal(niceStep(64), 100);
  assert.equal(niceStep(12), 20);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(0.3), 0.5);
  assert.deepEqual(ticks(-30, 230, 100), [0, 100, 200]);
  assert.deepEqual(ticks(230, -30, 100), [0, 100, 200], 'either order (a mirrored view)');
});

test('snapping to perspective', () => {
  const r = { visible: true, guides: [], perspective: { points: [{ x: 100, y: 0 }] } };
  const start = { x: 0, y: 0 };
  const cands = snapCandidates(r, start, 5);
  assert.equal(cands.length, 3, 'towards the point, plus horizontal and vertical for 1-point perspective');
  const line = pickLine(cands, start, { x: 3, y: 40 });
  assert.deepEqual(line.d, { x: 0, y: 1 }, 'moving mostly down picks the vertical');
  assert.deepEqual(project(line, { x: 7, y: 50 }), { x: 0, y: 50 });
  const r2 = { visible: true, guides: [], perspective: { points: [{ x: 300, y: 400 }] } };
  const toVp = pickLine(snapCandidates(r2, start, 5), start, { x: 30, y: 38 });
  near(toVp.d.x, 0.6); near(toVp.d.y, 0.8, 'unit vector towards (300, 400)');
  const q = project(toVp, { x: 100, y: 50 });
  near(q.x, 0.6 * 100); near(q.y, 0.8 * 100, 'projection length = 100*0.6 + 50*0.8 = 100');
  assert.equal(snapCandidates({ ...r, visible: false }, start, 5).length, 0, 'hidden rulers do not snap');
});

test('snapping to guides', () => {
  const r = { visible: true, perspective: null, guides: [{ axis: 'h', pos: 50 }, { axis: 'v', pos: 300 }] };
  assert.equal(snapCandidates(r, { x: 10, y: 80 }, 5).length, 0, 'too far from both guides');
  const c = snapCandidates(r, { x: 10, y: 53 }, 5);
  assert.deepEqual(c.map(x => x.p), [{ x: 10, y: 50 }], 'the stroke moves onto the guide');
  assert.deepEqual(project(c[0], { x: 90, y: 70 }), { x: 90, y: 50 });
  assert.equal(guideAt(r.guides, { x: 302, y: 0 }, 4), 1);
  assert.equal(guideAt(r.guides, { x: 0, y: 47 }, 4), 0);
  assert.equal(guideAt(r.guides, { x: 0, y: 0 }, 4), -1);
});

test('grid settings', () => {
  assert.deepEqual(sanitizeGrid({ show: true, size: 64.4, div: 0, snap: 'yes' }), { show: true, size: 64, div: 1, snap: false });
  assert.deepEqual(sanitizeGrid({ size: 99999, div: 50 }), { show: false, size: 5000, div: 20, snap: false });
  assert.deepEqual(sanitizeGrid({ size: 'x', div: null }), { show: false, size: 100, div: 4, snap: false });
  assert.equal(gridStep({ size: 100, div: 4 }), 25);
});

test('strokes snap to the nearest grid line only when grid snapping is on', () => {
  const grid = { show: true, size: 100, div: 4, snap: true };  // a line every 25 px
  const r = { guides: [], perspective: null, visible: true, snap: true, grid };
  const c = snapCandidates(r, { x: 48, y: 74 }, 3);  // 2 px from x = 50, 1 px from y = 75
  assert.deepEqual(c.map(x => [x.kind, x.p.x, x.p.y, x.d.x, x.d.y]), [['grid', 48, 75, 1, 0], ['grid', 50, 74, 0, 1]]);
  assert.equal(snapCandidates(r, { x: 40, y: 10 }, 3).length, 0, 'between lines');
  assert.equal(snapCandidates({ ...r, grid: { ...grid, snap: false } }, { x: 48, y: 74 }, 3).length, 0);
  assert.equal(snapCandidates({ ...r, grid: { ...grid, show: false } }, { x: 48, y: 74 }, 3).length, 0, 'a hidden grid does not snap');
  assert.equal(snapCandidates({ ...r, visible: false }, { x: 48, y: 74 }, 3).length, 2, 'hiding guides leaves the grid');
});

test('selection and figure corners snap to the grid', async () => {
  const { snapToGrid } = await import('../web/js/rulers.js');
  const g = { show: true, size: 100, div: 4, snap: true };  // a line every 25 px
  assert.deepEqual(snapToGrid(g, { x: 47, y: 61 }, 4), { x: 50, y: 61 }, 'x is 3 from 50; y is 11 from 50 and 14 from 75');
  assert.deepEqual(snapToGrid(g, { x: 12, y: 99, p: 0.5 }, 4), { x: 12, y: 100, p: 0.5 }, '12 is halfway between lines; pressure kept');
  assert.deepEqual(snapToGrid(g, { x: -2, y: 0 }, 4), { x: 0, y: 0 }, 'the edge is a line too');
});

test('straight-line and concentric rulers are sanitized', async () => {
  const { sanitizeShape, MAX_SHAPES } = await import('../web/js/rulers.js');
  assert.equal(sanitizeShape({ type: 'line', x1: 5, y1: 5, x2: 5, y2: 5 }), null, 'a line needs two different ends');
  assert.equal(sanitizeShape({ type: 'line', x1: 'a', y1: 0, x2: 1, y2: 1 }), null);
  assert.equal(sanitizeShape({ type: 'ellipse', x: 0, y: 0, rx: 0.5, ry: 4 }), null, 'radii of at least 1');
  assert.equal(sanitizeShape({ type: 'star' }), null);
  assert.deepEqual(sanitizeShape({ type: 'line', x1: 1.234, y1: 0, x2: 9, y2: 9, extra: 1 }), { type: 'line', x1: 1.23, y1: 0, x2: 9, y2: 9 });
  const e = sanitizeShape({ type: 'ellipse', x: 1, y: 2, rx: 3, ry: 4, angle: 4 });
  assert.ok(Math.abs(e.angle - (4 - 2 * Math.PI)) < 1e-6, 'turned back into -pi..pi (kept to 6 decimals)');
  assert.equal(sanitizeShape({ type: 'ellipse', x: 1, y: 2, rx: 3, ry: 4 }).angle, 0, 'no angle = level');
  const many = sanitizeRulers({ shapes: [...Array.from({ length: 60 }, () => ({ type: 'line', x1: 0, y1: 0, x2: 1, y2: 0 })), null] });
  assert.equal(many.shapes.length, MAX_SHAPES);
});

test('strokes snap to a straight-line ruler they start near', () => {
  const r = { visible: true, guides: [], perspective: null, shapes: [{ type: 'line', x1: 0, y1: 0, x2: 100, y2: 100 }] };
  const c = snapCandidates(r, { x: 50, y: 60 }, 3, 10);  // the nearest point on the line is (55, 55), 7.07 away
  assert.equal(c.length, 1);
  near(c[0].p.x, 55); near(c[0].p.y, 55);
  near(c[0].d.x, Math.SQRT1_2); near(c[0].d.y, Math.SQRT1_2);
  const q = project(c[0], { x: 0, y: 20 });
  near(q.x, 10); near(q.y, 10, '(0, 20) lands on (10, 10)');
  assert.equal(snapCandidates(r, { x: 50, y: 60 }, 3, 5).length, 0, 'too far away');
  assert.equal(snapCandidates(r, { x: 300, y: 296 }, 3, 5).length, 1, 'the line reaches past its ends');
  assert.equal(snapCandidates({ ...r, visible: false }, { x: 50, y: 60 }, 3, 10).length, 0, 'hidden rulers do not snap');
});

test('strokes follow concentric circles and ellipses', () => {
  const circle = { type: 'ellipse', x: 0, y: 0, rx: 10, ry: 10, angle: 0 };
  const [c] = snapCandidates({ visible: true, guides: [], perspective: null, shapes: [circle] }, { x: 30, y: 40 }, 3);
  assert.equal(c.kind, 'ellipse', 'anywhere on the canvas');
  near(c.d.x, -0.8); near(c.d.y, 0.6, 'the tangent at (30, 40)');
  let q = project(c, { x: 3, y: 4 }); near(q.x, 30); near(q.y, 40, 'radius 50 in the same direction');
  q = project(c, { x: -100, y: 0 }); near(q.x, -50); near(q.y, 0);
  assert.equal(snapCandidates({ visible: true, guides: [], shapes: [circle] }, { x: 0, y: 0 }, 3).length, 0, 'not from the centre');

  const wide = pickLine(snapCandidates({ visible: true, guides: [], shapes: [{ ...circle, rx: 20 }] }, { x: 0, y: 20 }, 3), { x: 0, y: 20 }, { x: -5, y: 20 });
  near(wide.d.x, -1); near(wide.d.y, 0);
  q = project(wide, { x: 100, y: 0 }); near(q.x, 40); near(q.y, 0, 'twice the ruler: 40 wide, 20 high');
  q = project(wide, { x: 0, y: -1 }); near(q.x, 0); near(q.y, -20);

  const upright = snapCandidates({ visible: true, guides: [], shapes: [{ ...circle, rx: 20, angle: Math.PI / 2 }] }, { x: 0, y: 40 }, 3)[0];
  q = project(upright, { x: 5, y: 0 }); near(q.x, 20); near(q.y, 0, 'turned a quarter: the short axis lies across');
});

test('dragging ruler handles', async () => {
  const { shapeHandles, dragShapeHandle, shapeFromDrag, shapeHandleAt } = await import('../web/js/rulers.js');
  const line = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 };
  assert.deepEqual(shapeHandles(line).map(h => [h.h, h.x, h.y]), [['a', 0, 0], ['b', 100, 0], ['mid', 50, 0]]);
  assert.deepEqual(dragShapeHandle(line, 'mid', { x: 60, y: 10 }), { type: 'line', x1: 10, y1: 10, x2: 110, y2: 10 });
  assert.deepEqual(dragShapeHandle(line, 'a', { x: 7, y: 8 }), { ...line, x1: 7, y1: 8 });
  const level = dragShapeHandle(line, 'b', { x: 52, y: 3 }, true);
  near(level.x2, Math.hypot(52, 3)); near(level.y2, 0, 'Shift: 3.3 degrees rounds to level, length kept');
  const ell = { type: 'ellipse', x: 0, y: 0, rx: 20, ry: 10, angle: 0 };
  const turned = dragShapeHandle(ell, 'rx', { x: 0, y: 30 });
  assert.equal(turned.rx, 30); near(turned.angle, Math.PI / 2); assert.equal(turned.ry, 10);
  assert.equal(dragShapeHandle({ ...ell, rx: 30 }, 'ry', { x: 5, y: -12 }).ry, 12, 'only the distance along the second axis counts');
  assert.deepEqual(dragShapeHandle(ell, 'ry', { x: 5, y: -12 }, true), { ...ell, rx: 12, ry: 12 }, 'Shift: a circle');
  assert.deepEqual(dragShapeHandle(ell, 'c', { x: 4, y: 5 }), { ...ell, x: 4, y: 5 });
  assert.deepEqual(shapeFromDrag('ellipse', { x: 10, y: 10 }, { x: 13, y: 14 }), { type: 'ellipse', x: 10, y: 10, rx: 5, ry: 5, angle: 0 });
  assert.deepEqual(shapeFromDrag('line', { x: 1, y: 2 }, { x: 3, y: 4 }), { type: 'line', x1: 1, y1: 2, x2: 3, y2: 4 });
  assert.deepEqual(shapeHandleAt([line], { x: 98, y: 2 }, 5), { index: 0, h: 'b' });
  assert.deepEqual(shapeHandleAt([line], { x: 50, y: 1 }, 5), { index: 0, h: 'mid' });
  assert.equal(shapeHandleAt([line], { x: 30, y: 0 }, 5), null);
});

test('a line the stroke started on wins over a concentric ruler when the stroke heads along it', () => {
  // centre (100, -200), start (0, 100): from the centre (-100, 300), so the circle's tangent is along (3, 1), 18.4° from level
  const r = { visible: true, guides: [{ axis: 'h', pos: 100 }], perspective: null, shapes: [{ type: 'ellipse', x: 100, y: -200, rx: 10, ry: 10, angle: 0 }] };
  const start = { x: 0, y: 100 };
  const cands = snapCandidates(r, start, 5);
  assert.deepEqual(cands.map(c => c.kind), ['guide', 'ellipse']);
  assert.equal(pickLine(cands, start, { x: 10, y: 105 }).kind, 'guide', '26.6° off the guide (8.1° off the circle): still the guide');
  assert.equal(pickLine(cands, start, { x: 10, y: 106.5 }).kind, 'ellipse', '33° off the guide (14.6° off the circle): the circle');
  assert.equal(pickLine(cands, start, { x: -30, y: 80 }).kind, 'ellipse', 'backwards, 33.7° off the guide and 15.3° off the circle');
});

test('rulers follow crops, resizes, turns and flips of the canvas', async () => {
  const { mapRulers } = await import('../web/js/rulers.js');
  const r = sanitizeRulers({
    guides: [{ axis: 'h', pos: 200 }, { axis: 'v', pos: 300 }],
    perspective: { points: [{ x: 500, y: 100 }] },
    shapes: [{ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { type: 'ellipse', x: 100, y: 200, rx: 30, ry: 10, angle: 0 }],
    symmetry: { kind: 'vertical', x: 300, y: null },
  });
  // crop at (100, 50) to 800 x 600: everything moves up-left by (100, 50)
  const c = mapRulers(r, [1, 0, 0, 1, -100, -50], 1000, 800, 800, 600);
  assert.deepEqual(c.guides, [{ axis: 'h', pos: 150 }, { axis: 'v', pos: 200 }]);
  assert.deepEqual(c.perspective.points, [{ x: 400, y: 50 }]);
  assert.deepEqual(c.shapes[0], { type: 'line', x1: -100, y1: -50, x2: -90, y2: -50 });
  assert.deepEqual(c.shapes[1], { type: 'ellipse', x: 0, y: 150, rx: 30, ry: 10, angle: 0 });
  assert.deepEqual([c.symmetry.x, c.symmetry.y], [200, null], 'y stays at the middle');

  // 90° right, 1000 x 800 -> 800 x 1000: (x, y) goes to (800 - y, x)
  const t = mapRulers(r, [0, 1, -1, 0, 800, 0], 1000, 800, 800, 1000);
  assert.deepEqual(t.guides, [{ axis: 'v', pos: 600 }, { axis: 'h', pos: 300 }], 'horizontal guides become vertical');
  const e = t.shapes[1];
  assert.deepEqual([e.x, e.y, e.rx, e.ry], [600, 100, 30, 10]);
  assert.ok(Math.abs(e.angle - Math.PI / 2) < 1e-6, 'the long axis now points down');
  assert.deepEqual([t.symmetry.kind, t.symmetry.x, t.symmetry.y], ['horizontal', null, 300], 'the mirror line x = 300 becomes y = 300');

  const s = mapRulers(r, [0.5, 0, 0, 0.5, 0, 0], 1000, 800, 500, 400);
  assert.deepEqual(s.guides, [{ axis: 'h', pos: 100 }, { axis: 'v', pos: 150 }]);
  assert.deepEqual([s.shapes[1].rx, s.shapes[1].ry], [15, 5], 'half size');

  const f = mapRulers(r, [-1, 0, 0, 1, 1000, 0], 1000, 800, 1000, 800);
  assert.deepEqual(f.guides, [{ axis: 'h', pos: 200 }, { axis: 'v', pos: 700 }], 'mirrored across');
  assert.equal(f.symmetry.x, 700);
  assert.equal(r.guides[0].pos, 200, 'the original is left alone');
});

test('selection and figure corners snap to nearby guides', async () => {
  const { snapToGuides } = await import('../web/js/rulers.js');
  const guides = [{ axis: 'v', pos: 100 }, { axis: 'v', pos: 104 }, { axis: 'h', pos: 50 }];
  assert.deepEqual(snapToGuides(guides, { x: 103, y: 47, p: 1 }, 5), { x: 104, y: 50, p: 1 }, 'the nearer of two guides: 1 px from 104, 3 from 100');
  assert.deepEqual(snapToGuides(guides, { x: 90, y: 60 }, 5), { x: 90, y: 60 }, '10 px away: left alone');
  assert.deepEqual(snapToGuides([], { x: 1, y: 2 }, 5), { x: 1, y: 2 });
});

test('curve rulers', async () => {
  const { sanitizeShape, curveFromStroke, curvePath, nearestOnPath, snapCandidates, project, shapeHandles, dragShapeHandle, mapRulers, defaultRulers, MAX_CURVE_POINTS } = await import('../web/js/rulers.js');
  assert.deepEqual(sanitizeShape({ type: 'curve', pts: [[0, 0], [0, 0], { x: 10.123, y: 5 }, ['x', 1]] }), { type: 'curve', pts: [[0, 0], [10.12, 5]] },
    'repeats and bad points dropped, rounded');
  assert.equal(sanitizeShape({ type: 'curve', pts: [[1, 1]] }), null, 'one point is not a curve');
  // a straight drag with a small wobble keeps only its ends; a corner is kept
  const flat = curveFromStroke(Array.from({ length: 21 }, (_, i) => ({ x: i * 5, y: i % 2 })), 3);
  assert.deepEqual(flat.pts, [[0, 0], [100, 0]]);
  const bend = curveFromStroke([...Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 })), ...Array.from({ length: 10 }, (_, i) => ({ x: 100, y: (i + 1) * 10 }))], 3);
  assert.deepEqual(bend.pts, [[0, 0], [100, 0], [100, 100]]);
  const zig = curveFromStroke(Array.from({ length: 200 }, (_, i) => ({ x: i * 4, y: (i % 2) * 40 })), 1);
  assert.ok(zig.pts.length <= MAX_CURVE_POINTS, 'never more than the most points');
  const q = nearestOnPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], { x: 12, y: 6 });
  assert.deepEqual([q.p, q.d, q.dist], [{ x: 10, y: 6 }, { x: 0, y: 1 }, 2], 'the nearest point on the second leg');
  // a stroke started near the curve gets it as a candidate, and points are pulled onto it
  const r = { ...defaultRulers(), shapes: [bend] };
  const cands = snapCandidates(r, { x: 50, y: -3 }, 4, 6);  // the curve bows up to y = -5.4 here on its way to the corner
  assert.equal(cands.length, 1);
  assert.equal(cands[0].kind, 'curve');
  const on = project(cands[0], { x: 40, y: 7 });
  assert.ok(nearestOnPath(curvePath(bend), on).dist < 1e-9, 'projected onto the curve');
  assert.ok(on.y < 0 && on.y > -6);
  assert.equal(snapCandidates(r, { x: 50, y: 40 }, 4, 6).length, 0, 'too far away: free stroke');
  // a hairpin: arms along y = 0 and y = 20; a stroke on the lower arm stays on it even nearer the upper one
  const pin = sanitizeShape({ type: 'curve', pts: [[0, 0], [1000, 0], [1000, 20], [0, 20]] });
  const pc = snapCandidates({ ...defaultRulers(), shapes: [pin] }, { x: 100, y: 1 }, 4, 6)[0];
  assert.ok(Math.abs(project(pc, { x: 110, y: 2 }).y) < 3);
  assert.ok(Math.abs(project(pc, { x: 120, y: 15 }).y) < 3, 'kept to the lower arm, 5 px from the upper one');
  assert.ok(Math.abs(nearestOnPath(curvePath(pin), { x: 120, y: 15 }).p.y - 20) < 3, 'without a place to start from: the nearest arm');
  // handles: one per point plus the middle; dragging a point or the whole curve
  const hs = shapeHandles(bend);
  assert.deepEqual(hs.map(h => h.h), ['p0', 'p1', 'p2', 'mid']);
  assert.deepEqual(dragShapeHandle(bend, 'p1', { x: 90, y: 10 }).pts[1], [90, 10]);
  const mid = hs[3], moved = dragShapeHandle(bend, 'mid', { x: mid.x + 5, y: mid.y - 2 });
  assert.deepEqual(moved.pts[0], [5, -2], 'the whole curve moves');
  assert.ok(curvePath(bend).length > 10);
  // canvas changes carry the points along (here: everything moves 10 right)
  const m = mapRulers({ ...defaultRulers(), shapes: [bend] }, [1, 0, 0, 1, 10, 0], 200, 200);
  assert.deepEqual(m.shapes[0].pts[2], [110, 100]);
});

test('parallel line ruler', async () => {
  const { sanitizeShape, shapeHandles, dragShapeHandle, shapeFromDrag, mapRulers, rulerDegrees, fromDegrees, parallelEnd } = await import('../web/js/rulers.js');
  const flat = { type: 'parallel', x: 100, y: 50, angle: 0, len: 40 };
  assert.deepEqual(sanitizeShape({ type: 'parallel', x: 100, y: 50 }), { type: 'parallel', x: 100, y: 50, angle: 0, len: 100 }, 'level, 100 px either way by default');
  assert.equal(sanitizeShape({ type: 'parallel', x: 'no', y: 1 }), null);
  near(sanitizeShape({ ...flat, angle: 3 * Math.PI }).angle, Math.round(Math.PI * 1e6) / 1e6, 'kept within -pi..pi');
  assert.equal(sanitizeShape({ ...flat, len: 1 }).len, 4, 'a bar too short to grab is made 4 px');

  // every stroke follows the ruler's direction from where it starts, wherever that is
  const r = { visible: true, guides: [], shapes: [{ ...flat, angle: Math.PI / 2 }] };  // straight down
  const cands = snapCandidates(r, { x: 500, y: 400 }, 5);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].kind, 'parallel');
  const line = pickLine(cands, { x: 500, y: 400 }, { x: 530, y: 410 });  // even a stroke heading right goes down
  const p = project(line, { x: 530, y: 410 });
  near(p.x, 500); near(p.y, 410);
  // at 45° (down-right on the doc): (10, 0) from the start projects to half of it along the diagonal, (5, 5)
  const diag = { visible: true, guides: [], shapes: [{ ...flat, angle: Math.PI / 4 }] };
  const q = project(pickLine(snapCandidates(diag, { x: 0, y: 0 }, 5), { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 10, y: 0 });
  near(q.x, 5); near(q.y, 5);
  // a guide the stroke starts on still wins when the stroke goes along it
  const both = { visible: true, guides: [{ axis: 'h', pos: 400 }], shapes: [{ ...flat, angle: Math.PI / 2 }] };
  assert.equal(pickLine(snapCandidates(both, { x: 500, y: 401 }, 5), { x: 500, y: 401 }, { x: 540, y: 403 }).kind, 'guide');
  assert.equal(pickLine(snapCandidates(both, { x: 500, y: 401 }, 5), { x: 500, y: 401 }, { x: 503, y: 440 }).kind, 'parallel');
  assert.equal(snapCandidates({ ...r, visible: false }, { x: 0, y: 0 }, 5).length, 0, 'hidden rulers do not snap');

  // handles: the middle moves it, the ends turn it about the middle
  assert.deepEqual(shapeHandles(flat), [{ h: 'c', x: 100, y: 50 }, { h: 'a', x: 60, y: 50 }, { h: 'b', x: 140, y: 50 }]);
  assert.deepEqual(dragShapeHandle(flat, 'c', { x: 3, y: 4 }), { ...flat, x: 3, y: 4 });
  const down = dragShapeHandle(flat, 'b', { x: 100, y: 80 });  // b straight below the middle, 30 px: 90°
  near(down.angle, Math.PI / 2); near(down.len, 30);
  const up = dragShapeHandle(flat, 'a', { x: 100, y: 80 });  // a below means b above: -90°
  near(up.angle, -Math.PI / 2); near(up.len, 30);
  const snapped = dragShapeHandle(flat, 'b', { x: 140, y: 52 }, true);  // 2.9° off level: Shift makes it level
  near(snapped.angle, 0); near(snapped.len, Math.hypot(40, 2));
  assert.equal(dragShapeHandle(flat, 'b', { x: 100, y: 50 }), flat, 'an end dropped on the middle changes nothing');
  const made = shapeFromDrag('parallel', { x: 0, y: 0 }, { x: 30, y: 40 });
  near(made.x, 15); near(made.y, 20); near(made.len, 25); near(made.angle, Math.atan2(40, 30));

  // typed angles: degrees anticlockwise on screen (doc y points down)
  assert.equal(rulerDegrees(0), 0);
  assert.equal(rulerDegrees(-Math.PI / 4), 45, 'up and to the right');
  assert.equal(rulerDegrees(Math.PI / 4), 135, 'down and to the right is the same line as up and to the left');
  assert.equal(rulerDegrees(Math.PI), 0, 'a ruler has no front: 180° is level');
  assert.equal(rulerDegrees(Math.PI / 2), 90);
  near(fromDegrees(30), -Math.PI / 6);
  assert.equal(rulerDegrees(fromDegrees(30)), 30);
  assert.equal(rulerDegrees(fromDegrees(359.99)), 0, '179.99 rounds to 180, which is 0');

  // the canvas changing shape: a crop moves it, a quarter turn turns it, a flip mirrors it
  const base = { guides: [], perspective: null, shapes: [{ ...flat, angle: Math.PI / 6 }], symmetry: { kind: 'off', lines: 6, x: null, y: null } };
  const moved = mapRulers(base, [1, 0, 0, 1, -10, -20], 200, 100, 190, 80).shapes[0];
  assert.equal(moved.x, 90); assert.equal(moved.y, 30); near(moved.angle, Math.round(Math.PI / 6 * 1e6) / 1e6);
  const turned = mapRulers(base, [0, 1, -1, 0, 100, 0], 200, 100, 100, 200).shapes[0];  // a quarter turn clockwise: (x, y) → (100 - y, x)
  assert.equal(turned.x, 50); assert.equal(turned.y, 100);
  near(turned.angle, Math.round((Math.PI / 6 + Math.PI / 2) * 1e6) / 1e6, 'turned a quarter too'); near(turned.len, 40);
  const flipped = mapRulers(base, [-1, 0, 0, 1, 200, 0], 200, 100, 200, 100).shapes[0];  // Flip horizontally: (x, y) → (200 - x, y)
  assert.equal(flipped.x, 100);
  near(flipped.angle, Math.round(5 * Math.PI / 6 * 1e6) / 1e6, '30° mirrored is 150°');
  const doubled = mapRulers(base, [2, 0, 0, 2, 0, 0], 200, 100, 400, 200).shapes[0];
  assert.equal(doubled.len, 80, 'Image size scales the bar');

  // the Figure tool's straight shapes
  const rs = { visible: true, snap: true, guides: [], shapes: [{ ...flat, angle: 0 }, { ...flat, angle: Math.PI / 2 }] };
  assert.deepEqual(parallelEnd(rs, { x: 10, y: 10 }, { x: 50, y: 30 }), { x: 50, y: 10 }, 'mostly across: level');
  const up2 = parallelEnd(rs, { x: 10, y: 10 }, { x: 12, y: 40 });  // mostly down: upright
  near(up2.x, 10); near(up2.y, 40);
  assert.deepEqual(parallelEnd({ ...rs, snap: false }, { x: 10, y: 10 }, { x: 50, y: 30 }), { x: 50, y: 30 }, 'Ctrl+2 off: free');
  assert.deepEqual(parallelEnd({ ...rs, shapes: [] }, { x: 10, y: 10 }, { x: 50, y: 30 }), { x: 50, y: 30 }, 'no parallel ruler: free');
  assert.deepEqual(sanitizeRulers({ shapes: [flat, { type: 'parallel' }] }).shapes, [flat], 'saved with the artwork; broken ones dropped');
});
