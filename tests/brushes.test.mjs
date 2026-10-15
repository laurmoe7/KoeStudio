// Pressure curves, image tips and textures, and brush settings from saved / imported brushes. Expected values
// worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCurve, curveAt, stampAt } from '../web/js/brush.js';
import { tipMask, textureGray, whiteToAlpha, fitSide, imageRef, tipReach } from '../web/js/brushtip.js';
import { sanitizeSettings, applySettings, BRUSH_KEYS } from '../web/js/tools.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} is not ${b}`);

test('pressure curves are cleaned up', () => {
  assert.deepEqual(sanitizeCurve([[1, 1], [0, -0.5], ['0.5', 2]]), [[0, 0], [0.5, 1], [1, 1]], 'sorted and clamped');
  assert.deepEqual(sanitizeCurve([[0, 0], [0, 1], [1, 1]]), [[0, 0], [1, 1]], 'a repeated x keeps the first point');
  assert.equal(sanitizeCurve([[0, 0]]), null, 'one point is no curve');
  assert.equal(sanitizeCurve('nope'), null);
  assert.equal(sanitizeCurve([[0, 0], ['x', 1]]), null);
});

test('curve values', () => {
  near(curveAt([[0, 0], [1, 1]], 0.3), 0.3, 'the diagonal');
  near(curveAt([[0, 0.2], [1, 0.6]], 0.5), 0.4, 'two points: a straight line');
  near(curveAt([[0, 0], [0.5, 0.5], [1, 1]], 0.25), 0.25, 'points on a line stay on it');
  near(curveAt([[0.2, 0.1], [1, 1]], 0.1), 0.1, 'flat before the first point');
  near(curveAt([[0, 0], [0.5658, 0.5333], [1, 1]], 0.5658), 0.5333, 'passes through its points');
  // a peak: the middle tangent is 0 (slopes 2 and -2 disagree); at x = 0.25, t = 0.5, h = 0.5:
  // h00 * 0 + h10 * h * 2 + h01 * 1 + h11 * h * 0 = 0.125 * 0.5 * 2 + 0.5 = 0.625
  near(curveAt([[0, 0], [0.5, 1], [1, 0]], 0.25), 0.625, 'the peak');
  // monotone points never give a value outside their neighbours
  const pts = [[0, 0], [0.3, 0.05], [0.35, 0.9], [1, 1]];
  for (let p = 0; p <= 1; p += 0.01) {
    const v = curveAt(pts, p);
    assert.ok(v >= 0 && v <= 1, `in range at ${p}`);
  }
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) { const v = curveAt(pts, p); assert.ok(v >= last - 1e-12, `rising at ${p}`); last = v; }
});

test('stamp size and density with minimums and curves', () => {
  const s = { size: 20, flow: 0.5, pressureSize: true, minSize: 0.5, pressureOpacity: true, minFlow: 0.2, gamma: 1 };
  // size 20 * (0.5 + 0.5 * 0.5) = 15; density 0.5 * (0.2 + 0.8 * 0.5) = 0.3
  const a = stampAt(s, 0.5);
  near(a.size, 15, 'size');
  near(a.flow, 0.3, 'density');
  // with a size curve through (1, 0.5): 0.25 at half pressure, so 20 * (0.5 + 0.5 * 0.25) = 12.5
  near(stampAt({ ...s, sizeCurve: [[0, 0], [1, 0.5]] }, 0.5).size, 12.5, 'size curve');
  near(stampAt({ ...s, pressureOpacity: false }, 0.1).flow, 0.5, 'no pressure: full density');
  near(stampAt({ size: 10, flow: 1, pressureOpacity: true }, 0.25).flow, 0.25, 'old settings: no minimum density');
});

test('tip and texture images', () => {
  // opaque: dark is paint (black 255, white 0, mid gray 128 -> 127)
  assert.deepEqual([...tipMask(Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]))], [255, 0, 127]);
  // with any transparency the shape is the alpha, whatever the colour
  assert.deepEqual([...tipMask(Uint8ClampedArray.from([255, 255, 255, 200, 0, 0, 0, 0]))], [200, 0]);
  // texture: gray as it is; see-through counts as white (paint sticks)
  assert.deepEqual([...textureGray(Uint8ClampedArray.from([100, 100, 100, 255, 0, 0, 0, 0, 0, 0, 0, 128]))], [100, 255, 127]);
  // Procreate shapes: white is paint; the result is black with that alpha (times the picture's own alpha)
  assert.deepEqual([...whiteToAlpha(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 100, 100, 100, 128]))],
    [0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 50]);  // 100 * 128 / 255 = 50.2
  assert.deepEqual([...whiteToAlpha(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]), true)], [0, 0, 0, 0, 0, 0, 0, 255], 'inverted');
  assert.deepEqual(fitSide(1024, 512, 512), { w: 512, h: 256 });
  assert.deepEqual(fitSide(100, 50, 512), { w: 100, h: 50 }, 'never enlarged');
  assert.equal(imageRef('img:0123456789abcdef'), '0123456789abcdef');
  assert.equal(imageRef('img:../x'), null);
  assert.equal(imageRef('round'), null);
  assert.equal(tipReach(true), Math.SQRT1_2, 'a turned square reaches its corners');
  assert.equal(tipReach(false), 0.5);
});

test('brush settings: tips, curves and saved brushes', () => {
  const pen = sanitizeSettings(null).pen;
  assert.equal(pen.tip, 'round');
  assert.equal(pen.thickness, 1);
  assert.equal(pen.sizeCurve, null);
  const s = applySettings({ ...pen }, { tip: 'img:00112233aabbccdd', texture: 'img:nothex!', thickness: 0, tipAngle: 400,
    sizeCurve: [[1, 1], [0, 0]], preset: '0a1b', smoothing: null, minFlow: '0.25' });
  assert.equal(s.tip, 'img:00112233aabbccdd');
  assert.equal(s.texture, 'none', 'not an image id');
  assert.equal(s.thickness, 0.05, 'clamped');
  assert.equal(s.tipAngle, 360);
  assert.deepEqual(s.sizeCurve, [[0, 0], [1, 1]]);
  assert.equal(s.preset, '0a1b');
  assert.equal(s.smoothing, pen.smoothing, 'null is not a number');
  assert.equal(s.minFlow, 0.25);
  assert.ok(!('tip' in sanitizeSettings(null).smudge), 'Smudge has no tip');
  assert.ok(BRUSH_KEYS.includes('tip') && BRUSH_KEYS.includes('size') && !BRUSH_KEYS.includes('preset'));
});
