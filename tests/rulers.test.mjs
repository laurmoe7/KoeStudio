// Guides, perspective rulers and stroke snapping. Expected values are worked out by hand.
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
    grid: { show: false, size: 100, div: 4, snap: false } }, 'old files get empty rulers and a hidden grid');
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
