// Symmetry ruler, smudge mixing, reference/lock fields and settings migration. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSymmetry, symmetryPoints, symmetryStamps, symmetryRays, symmetryCentre } from '../web/js/symmetry.js';
import { tipCoverage, smudgeDab } from '../web/js/smudge.js';
import { sanitizeSettings } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

const round = pts => pts.map(p => ({ x: Math.round(p.x * 1e6) / 1e6 + 0, y: Math.round(p.y * 1e6) / 1e6 + 0 }));

test('symmetry settings', () => {
  assert.deepEqual(sanitizeSymmetry(null), { kind: 'off', lines: 6, x: null, y: null });
  assert.deepEqual(sanitizeSymmetry({ kind: 'radial', lines: 99, x: '12', y: 'no' }), { kind: 'radial', lines: 32, x: 12, y: null });
  assert.equal(sanitizeSymmetry({ kind: 'spiral', lines: 1 }).kind, 'off');
  assert.equal(sanitizeSymmetry({ lines: 1 }).lines, 2);
  assert.deepEqual(symmetryCentre({ x: null, y: 30 }, 100, 80), { x: 50, y: 30 }, 'no x: the middle of the canvas');
});

test('mirrored copies', () => {
  // 100 x 80 canvas, centre (50, 40); the point is 10 right of and 5 above it
  const at = kind => round(symmetryPoints({ kind, lines: 4, x: null, y: null }, 60, 35, 100, 80));
  assert.deepEqual(at('off'), [{ x: 60, y: 35 }]);
  assert.deepEqual(at('vertical'), [{ x: 60, y: 35 }, { x: 40, y: 35 }]);
  assert.deepEqual(at('horizontal'), [{ x: 60, y: 35 }, { x: 60, y: 45 }]);
  assert.deepEqual(at('quad'), [{ x: 60, y: 35 }, { x: 40, y: 35 }, { x: 60, y: 45 }, { x: 40, y: 45 }]);
});

test('radial and kaleidoscope copies', () => {
  // four lines: quarter turns clockwise (screen y points down): (10, -5) -> (5, 10) -> (-10, 5) -> (-5, -10)
  const radial = round(symmetryPoints({ kind: 'radial', lines: 4, x: 0, y: 0 }, 10, -5, 100, 80));
  assert.deepEqual(radial, [{ x: 10, y: -5 }, { x: 5, y: 10 }, { x: -10, y: 5 }, { x: -5, y: -10 }]);
  // kaleidoscope adds each turn of the mirror image (-10, -5)
  const k = round(symmetryPoints({ kind: 'kaleido', lines: 2, x: 0, y: 0 }, 10, -5, 100, 80));
  assert.deepEqual(k, [{ x: 10, y: -5 }, { x: -10, y: -5 }, { x: -10, y: 5 }, { x: 10, y: 5 }]);
  const stamps = symmetryStamps({ kind: 'vertical', x: 0, y: 0 }, [{ x: 3, y: 1, p: 0.5 }, { x: 4, y: 1, p: 0.7 }], 10, 10);
  assert.deepEqual(stamps, [{ x: 3, y: 1, p: 0.5 }, { x: -3, y: 1, p: 0.5 }, { x: 4, y: 1, p: 0.7 }, { x: -4, y: 1, p: 0.7 }], 'copies follow each stamp, pressure kept');
  // a scattered stamp's place on the stroke is mirrored with it
  assert.deepEqual(symmetryStamps({ kind: 'vertical', x: 0, y: 0 }, [{ x: 3, y: 2, px: 3, py: 1 }], 10, 10),
    [{ x: 3, y: 2, px: 3, py: 1 }, { x: -3, y: 2, px: -3, py: 1 }]);
  assert.equal(symmetryRays({ kind: 'radial', lines: 5 }).length, 5);
  assert.equal(symmetryRays({ kind: 'kaleido', lines: 5 }).length, 10);
  assert.deepEqual(symmetryRays({ kind: 'off' }), []);
});

test('smudge tip and mixing', () => {
  assert.equal(tipCoverage(0, 5, 0.5), 1);
  assert.equal(tipCoverage(2.5, 5, 0.5), 1, 'inside the hard core');
  assert.equal(tipCoverage(3.75, 5, 0.5), 0.5, 'halfway down the soft edge');
  assert.equal(tipCoverage(5, 5, 1), 0);
  // 2 x 2 patch (radius 1): pixel centres are 0.707 from the middle, inside a hard tip
  const dst = Uint8ClampedArray.from([0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0]);
  const buf = Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  smudgeDab(dst, buf, 2, 0.5, 1);
  assert.deepEqual([...dst.slice(0, 4)], [128, 0, 128, 255], 'blue halfway to red');
  assert.deepEqual([...dst.slice(12, 16)], [255, 0, 0, 128], 'a clear pixel takes the colour as it is, half covered');
  assert.deepEqual([...buf], [...dst], 'the result is carried on');
  // alpha lock: the clear pixel stays clear
  const d2 = Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  smudgeDab(d2, Uint8ClampedArray.from(new Array(16).fill(255)), 2, 1, 1, true);
  assert.deepEqual([...d2].filter((_, i) => i % 4 === 3), [0, 0, 0, 0]);
});

test('reference and lock are saved; the old sampleAll tick carries over', () => {
  const s = sanitizeDoc({ layers: [{ name: 'Lines', locked: true, reference: true }, { name: 'Colour', locked: 'yes' }] });
  assert.equal(s.layers[0].locked, true);
  assert.equal(s.layers[0].reference, true);
  assert.equal(s.layers[1].locked, false, 'only true counts');
  assert.equal(sanitizeSettings({ fill: { sampleAll: false } }).fill.sample, 'layer');
  assert.equal(sanitizeSettings({ wand: { sampleAll: true } }).wand.sample, 'all');
  assert.equal(sanitizeSettings({ fill: { sample: 'reference', sampleAll: false } }).fill.sample, 'reference', 'the new setting wins');
  assert.equal(sanitizeSettings({ fill: { sample: 'nonsense' } }).fill.sample, 'all');
  assert.equal(sanitizeSettings(null).smudge.strength, 0.6);
});

test('which symmetric copies are mirrored', async () => {
  const { symmetryFlips, symmetryPoints } = await import('../web/js/symmetry.js');
  const sym = kind => ({ kind, lines: 6, x: null, y: null });
  assert.deepEqual(symmetryFlips(sym('vertical'), 30, 40, 100, 100), [false, true], 'left-right mirror');
  assert.ok(symmetryFlips(sym('radial'), 30, 40, 100, 100).every(f => !f), 'turned copies are not mirrored');
  const k = symmetryFlips(sym('kaleido'), 30, 40, 100, 100);
  assert.equal(k.length, symmetryPoints(sym('kaleido'), 30, 40, 100, 100).length);
  assert.equal(k.filter(Boolean).length, k.length / 2, 'kaleidoscope: half of them mirrored');
  assert.deepEqual(symmetryFlips({ kind: 'off' }, 1, 2, 10, 10), [false]);
});
