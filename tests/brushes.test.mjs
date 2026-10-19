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

test('grain by pressure', async () => {
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const all = sanitizeSettings(null);
  assert.equal(all.pencil.grainPressure, true, 'the Pencil has it');
  assert.equal(all.pencil.texture, 'paper');
  assert.equal(all.brush.grainPressure, false, 'other brushes keep the grain of the whole stroke');
  assert.ok(BRUSH_KEYS.includes('grainPressure'), 'saved with brushes');
  // a Pencil saved before the setting existed takes it up; one that turned it off keeps it off
  assert.equal(sanitizeSettings({ pencil: { size: 9 } }).pencil.grainPressure, true);
  assert.equal(sanitizeSettings({ pencil: { grainPressure: false } }).pencil.grainPressure, false);
  // vector lines keep it with their brush; older lines have none
  assert.equal(sanitizeBrush({ grainPressure: 1 }).grainPressure, true);
  assert.equal(sanitizeBrush({}).grainPressure, false);
});

test('dab variation and the starting taper', async () => {
  const { dabJitter, taperIn } = await import('../web/js/brush.js');
  const seq = list => () => list.shift();
  // angle 0.25 turn (straight down), radius sqrt(0.25) * 1 * 10 = 5; size 1 - 0.5 * 0.5, density 1 - 0.2 * 0.5
  const j = dabJitter({ scatter: 1, sizeJitter: 0.5, flowJitter: 0.2 }, 10, seq([0.25, 0.25, 0.5, 0.5]));
  near(j.dx, 0, 'dx');
  near(j.dy, 5, 'dy');
  near(j.sizeK, 0.75, 'size');
  near(j.flowK, 0.9, 'density');
  assert.deepEqual(dabJitter({}, 10, () => { throw new Error('no randomness needed'); }), { dx: 0, dy: 0, sizeK: 1, flowK: 1 });
  near(taperIn(0, 100), 0.1, 'starts at 10%');
  near(taperIn(50, 100), 0.775, 'halfway: 0.1 + 0.9 * 0.5 * 1.5');
  near(taperIn(100, 100), 1, 'full size at the end of the taper');
  near(taperIn(10, 0), 1, 'off');
  const { releaseHeld, taperOut } = await import('../web/js/brush.js');
  const held = [{ d: 0 }, { d: 10 }, { d: 20 }, { d: 30 }];
  assert.deepEqual(releaseHeld(held, 35, 20), { ready: [{ d: 0 }, { d: 10 }], held: [{ d: 20 }, { d: 30 }] }, 'stamps 15 px or more from the end are drawn');
  assert.deepEqual(releaseHeld(held, 15, 20).ready, [], 'all still within the last 20 px');
  near(taperOut(0, 40), 0.1, 'the last stamp is 10%');
  near(taperOut(20, 40), 0.775, 'halfway back up');
  near(taperOut(60, 40), 1, 'before the taper: full size');
  const pen = sanitizeSettings({ pen: { scatter: 5, taperIn: -3 } }).pen;
  assert.equal(pen.scatter, 2, 'clamped');
  assert.equal(pen.taperIn, 0);
});

test('colour jitter', async () => {
  const { colorJitter } = await import('../web/js/brush.js');
  const { shiftColor } = await import('../web/js/color.js');
  const seq = list => () => list.shift();
  // hue: (0.75 * 2 - 1) * 0.5 * 180 = 45; no saturation jitter takes no number; brightness (0.25 * 2 - 1) * 0.2 = -0.1
  const j = colorJitter({ hueJitter: 0.5, valJitter: 0.2 }, seq([0.75, 0.25]));
  near(j.h, 45, 'hue'); near(j.s, 0, 'saturation'); near(j.v, -0.1, 'brightness');
  assert.equal(colorJitter({ hueJitter: 0 }, () => { throw new Error('no randomness needed'); }), null);
  assert.equal(shiftColor('#ff0000', { h: 120 }), '#00ff00', 'red turned a third of the way round is green');
  assert.equal(shiftColor('#ff0000', { h: -480 }), '#0000ff', 'turns wrap round');
  assert.equal(shiftColor('#ff0000', { s: -1 }), '#ffffff', 'no saturation left: white at full brightness');
  assert.equal(shiftColor('#ff0000', { v: -0.5 }), '#800000', 'half brightness: 127.5 rounds up');
  assert.equal(shiftColor('#808080', { s: 0.5 }), '#804040', 'gray gains red (hue 0): 128 and 128 - 64');
  assert.equal(shiftColor('#ffffff', { v: 0.5 }), '#ffffff', 'clamped');
  assert.equal(shiftColor('nope', { h: 10 }), 'nope');
  const pen = sanitizeSettings({ pen: { hueJitter: 3, colorJitterStroke: true } }).pen;
  assert.equal(pen.hueJitter, 1, 'clamped');
  assert.equal(pen.colorJitterStroke, true);
  assert.equal(sanitizeSettings(null).brush.satJitter, 0, 'off by default');
  assert.ok(BRUSH_KEYS.includes('valJitter') && BRUSH_KEYS.includes('colorJitterStroke'), 'saved with brushes');
});

test('brush preview stroke', async () => {
  const { previewPath, previewSettings } = await import('../web/js/brush.js');
  const pts = previewPath(200, 60, 10, 18, 4);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], [10, 30, 0.15], 'starts at the left middle, light');
  near(pts[2][0], 100, 'middle x'); near(pts[2][1], 30, 'crosses the middle line'); near(pts[2][2], 1, 'full pressure');
  near(pts[1][1], 18, 'a quarter in: the top of the S, 18 px from the top');
  near(pts[3][1], 42, 'three quarters: the bottom');
  assert.deepEqual(pts[4].map(v => Math.round(v * 1e9) / 1e9), [190, 30, 0.15]);
  const s = previewSettings({ size: 200, taperIn: 100, taperOut: 50, flow: 0.5 }, 40);
  assert.deepEqual(s, { size: 40, taperIn: 20, taperOut: 10, flow: 0.5 }, 'shrunk by 40 / 200');
  assert.equal(previewSettings({ size: 10, taperIn: 30 }, 40).taperIn, 30, 'small brushes stay as they are');
});

test('built-in brushes', async () => {
  const { BUILTIN_BRUSHES, BUILTIN_BY_ID, builtinBrushesFor } = await import('../web/js/builtinbrushes.js');
  const ids = BUILTIN_BRUSHES.map(b => b.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const b of BUILTIN_BRUSHES) {
    assert.match(b.id, /^b-[a-z0-9-]+$/);
    assert.deepEqual(Object.keys(b.settings).sort(), [...BRUSH_KEYS].sort(), `${b.name} has every brush setting`);
    // every value is one the tools accept as it is (no value clamped or refused)
    const s = applySettings({ ...b.settings }, b.settings);
    assert.deepEqual(s, b.settings, `${b.name} settings are valid`);
  }
  assert.equal(BUILTIN_BY_ID['b-gpen'].settings.hardness, 1);
  assert.equal(BUILTIN_BY_ID['b-hard-eraser'].settings.taperOut, 0, "the Brush tool's taper is not passed on");
  assert.ok(builtinBrushesFor('eraser').every(b => b.group === 'Eraser') && builtinBrushesFor('eraser').length === 3);
  assert.ok(builtinBrushesFor('pencil').every(b => b.group !== 'Eraser') && builtinBrushesFor('pencil').some(b => b.id === 'b-charcoal'));
  // a tool remembers a built-in brush (and a saved one); anything else is dropped
  assert.equal(sanitizeSettings({ pen: { preset: 'b-gpen' } }).pen.preset, 'b-gpen');
  assert.equal(sanitizeSettings({ pen: { preset: '0a1b' } }).pen.preset, '0a1b');
  assert.equal(sanitizeSettings({ pen: { preset: 'B-GPEN<' } }).pen.preset, '');
  // the Bristles tip is a choice for every paint tool, and vector lines keep it
  assert.equal(applySettings({ tip: 'round' }, { tip: 'bristle' }).tip, 'bristle');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  assert.equal(sanitizeBrush({ tip: 'bristle' }).tip, 'bristle');
});

test('bristle dots', async () => {
  const { bristleDots } = await import('../web/js/brushtip.js');
  const d = bristleDots();
  assert.equal(d.length, 12);
  assert.deepEqual(bristleDots(), d, 'always the same layout');
  for (const { x, y, r, a } of d) {
    assert.ok(x - r >= 0 && x + r <= 1, 'inside the tip across');
    assert.ok(Math.abs(y - 0.5) <= 0.06 && r >= 0.025 && r <= 0.055 && a >= 0.55 && a <= 1);
  }
  for (let i = 1; i < d.length; i++) assert.ok(d[i].x > d[i - 1].x, 'in a row from left to right');
});

test('the Brushes window lists brushes by group, filtered by the search', async () => {
  const { brushListGroups } = await import('../web/js/builtinbrushes.js');
  const mine = [{ id: 'aa', name: 'My Inky Pen' }, { id: 'bb', name: 'Clouds' }];
  const names = gs => gs.map(g => [g.name, g.brushes.map(b => b.name)]);
  assert.deepEqual(names(brushListGroups('eraser', mine)), [
    ['Eraser', ['Hard eraser', 'Soft eraser', 'Kneaded eraser']], ['Your brushes', ['My Inky Pen', 'Clouds']]]);
  assert.deepEqual(brushListGroups('pen').map(g => g.name), ['Ink', 'Pencil and chalk', 'Paint'], 'no saved brushes: no empty group');
  // "ink" is in the name of one saved brush and is a whole group's name, so the group keeps every brush
  assert.deepEqual(names(brushListGroups('pen', mine, '  INK ')), [['Ink', ['G-pen', 'Fineliner', 'Brush pen']], ['Your brushes', ['My Inky Pen']]]);
  assert.deepEqual(names(brushListGroups('pen', mine, 'soft')), [['Pencil and chalk', ['Soft pencil 6B']], ['Paint', ['Soft blend']]]);
  assert.deepEqual(brushListGroups('pen', mine, 'zzz'), []);
});
