// Pressure curves, image tips and textures, and brush settings from saved / imported brushes. Expected values
// worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCurve, curveAt, stampAt, grainAt } from '../web/js/brush.js';
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
  // a light density, so ten overlapping dabs leave a light line grey: at 25% pressure each dab is
  // 0.45 * (0.1 + 0.9 * 0.25) = 0.146, and ten of them 1 - 0.854^10 = 0.79, not the 0.85 a 0.7 density gave
  assert.equal(all.pencil.flow, 0.45);
  assert.equal(all.pencil.minFlow, 0.1);
  // a Pencil saved on the old defaults (density 0.7, no minimum, tip 60%) takes the new ones; changed ones stay
  const old = sanitizeSettings({ pencil: { flow: 0.7, minFlow: 0, hardness: 0.6, size: 12 } }).pencil;
  assert.deepEqual([old.flow, old.minFlow, old.size], [0.45, 0.1, 12]);
  assert.equal(sanitizeSettings({ pencil: { flow: 0.8, minFlow: 0, hardness: 0.6 } }).pencil.flow, 0.8);
  assert.equal(sanitizeSettings({ pencil: { flow: 0.7, minFlow: 0, hardness: 0.9 } }).pencil.flow, 0.7);
  assert.equal(sanitizeSettings({ pencil: { flow: 0.7, minFlow: 0, hardness: 0.6 } }).brush.flow, 0.55, 'only the Pencil');
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
  const { taperDab } = await import('../web/js/brush.js');
  assert.deepEqual(taperDab(1, {}), { k: 1, f: 1 }, 'past the taper');
  near(taperDab(0.1, {}).k, 0.1, 'the very end, as before: 10%');
  near(taperDab(0.1, { taperSize: 0.5 }).k, 0.55, 'half the size taper: 1 - 0.9 x 0.5');
  near(taperDab(0.55, { taperSize: 1 }).k, 0.55, 'half way in: the same as the taper factor');
  near(taperDab(0.1, { taperOpacity: 1 }).f, 0, 'full opacity taper: the very end fades out');
  near(taperDab(0.55, { taperOpacity: 0.4 }).f, 0.8, 'half way in: 1 - 0.5 x 0.4');
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
  // a combined brush whose second brush is 3 times the size: 30 x 3 = 90 has to fit in 45, so both are halved
  assert.equal(previewSettings({ size: 30, comboTip: 'round', comboSize: 3 }, 45).size, 15);
  assert.equal(previewSettings({ size: 30, comboTip: 'none', comboSize: 3 }, 45).size, 30, 'not combined: only its own size');
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
  // imported brushes are grouped by the pack they came from, after your own
  const packs = [{ name: 'A', source: 'Pastels' }, { name: 'Mine' }, { name: 'B', source: 'Inks' }, { name: 'C', source: 'Pastels' }];
  assert.deepEqual(names(brushListGroups('eraser', packs)).slice(1), [['Pastels', ['A', 'C']], ['Your brushes', ['Mine']], ['Inks', ['B']]],
    'groups in the order of the saved list');
  assert.deepEqual(names(brushListGroups('eraser', packs, 'pastels')), [['Pastels', ['A', 'C']]], 'a pack found by its name');
  assert.deepEqual(names(brushListGroups('eraser', packs, '', ['b:Eraser', 's:Pastels', 's:'])), [['Inks', ['B']]], 'hidden groups are left out');
});

test('a brush counts as changed once a setting it keeps differs', async () => {
  const { brushChanged, BUILTIN_BY_ID } = await import('../web/js/builtinbrushes.js');
  const gpen = BUILTIN_BY_ID['b-gpen'];
  const s = applySettings({ ...sanitizeSettings({}).pen }, gpen.settings);
  assert.equal(brushChanged(s, gpen), false, 'just loaded');
  s.size = 9;
  assert.equal(brushChanged(s, gpen), true, 'size 9 is not the G-pen 8');
  s.size = 8;
  assert.equal(brushChanged(s, gpen), false, 'back to 8');
  s.sizeCurve = [[0, 0], [0.5, 0.8], [1, 1]];
  assert.equal(brushChanged(s, gpen), true, 'a curve where the G-pen has none');
  // an older saved brush keeping only a size: the settings it does not keep never count
  assert.equal(brushChanged({ ...s, size: 12 }, { settings: { size: 12 } }), false);
  assert.equal(brushChanged({ ...s, size: 12 }, { settings: { size: 13 } }), true);
  assert.equal(brushChanged(s, undefined), false, 'no brush loaded: Custom');
});

test('a brush saved before newer settings existed loads them at their defaults', async () => {
  const { fullBrush } = await import('../web/js/builtinbrushes.js');
  // after an imported Artemus pencil (two tips, No build-up, thin upright), an older brush keeping only a size
  const s = applySettings({ ...sanitizeSettings({}).brush }, { tips: ['img:aaaaaaaa'], tipOrder: 'last', darkenDabs: true, tiltSizeMin: 0, tiltSize: 3 });
  applySettings(s, fullBrush({ size: 12 }));
  assert.deepEqual([s.size, s.tips, s.tipOrder, s.darkenDabs, s.tiltSizeMin, s.tiltSize], [12, [], 'repeat', false, 1, 0]);
  assert.deepEqual(fullBrush(null).tips, [], 'no settings at all: the defaults');
});

test('wet edges', async () => {
  const { wetFor } = await import('../web/js/painter.js');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const { BUILTIN_BY_ID } = await import('../web/js/builtinbrushes.js');
  assert.equal(wetFor({ wetEdges: 0, size: 50 }), null, 'off by default');
  // the edge is found with a blur of a sixth of the size: 60 px -> 10 px, never under 1 px or over 40
  assert.deepEqual(wetFor({ wetEdges: 0.6, size: 60 }), { amount: 0.6, blur: 10 });
  assert.equal(wetFor({ wetEdges: 1, size: 3 }).blur, 1);
  assert.equal(wetFor({ wetEdges: 1, size: 600 }).blur, 40);
  assert.equal(wetFor({ wetEdges: 0.5, size: 20, pixel: true }), null, 'hard pixels stay hard');
  // every paint tool has it (off), saved settings and vector lines keep it within 0-1
  const all = sanitizeSettings(null);
  assert.equal(all.brush.wetEdges, 0);
  assert.equal(sanitizeSettings({ brush: { wetEdges: 3 } }).brush.wetEdges, 1);
  assert.ok(BRUSH_KEYS.includes('wetEdges'));
  assert.equal(sanitizeBrush({ wetEdges: 0.4 }).wetEdges, 0.4);
  assert.equal(sanitizeBrush({}).wetEdges, 0, 'older lines have none');
  // the Watercolour and Marker use it; the Dry brush streaks with the grain of the whole stroke
  assert.equal(BUILTIN_BY_ID['b-watercolor'].settings.wetEdges, 0.6);
  assert.equal(BUILTIN_BY_ID['b-marker'].settings.wetEdges, 0.2);
  assert.equal(BUILTIN_BY_ID['b-drybrush'].settings.grainPressure, false);
  assert.equal(BUILTIN_BY_ID['b-gouache'].settings.grainPressure, true, 'gouache runs dry at a light touch');
});

test('flat brush hairs', async () => {
  const { flatDots } = await import('../web/js/brushtip.js');
  const all = flatDots(), d = all.slice(0, 40), strays = all.slice(40);
  assert.equal(all.length, 46, '40 hairs in the row and 6 strays');
  assert.deepEqual(flatDots(), all, 'always the same layout');
  for (const { x, r } of all) assert.ok(x - r >= 0 && x + r <= 1, 'inside the tip across');
  for (const { y, a } of d) assert.ok(Math.abs(y - 0.5) <= 0.025 && a >= 0.3 && a <= 1);
  // strays: thin (r 0.008-0.016), within 0.06 of an end, a little off the row (y within 0.06), never full strength
  strays.forEach(({ x, y, r, a }, i) => {
    assert.ok(r >= 0.008 && r <= 0.016 && Math.abs(y - 0.5) <= 0.06 && a >= 0.35 && a <= 0.75);
    assert.ok(i % 2 ? x > 0.94 : x < 0.06, `stray ${i} sticks out at the ${i % 2 ? 'right' : 'left'} end`);
  });
  // hairs touch their neighbours, so a dab has no gaps: centres closer than the two radii together
  for (let i = 1; i < d.length; i++) assert.ok(d[i].x - d[i - 1].x < d[i].r + d[i - 1].r, `hair ${i} touches the one before`);
  // worn ends: the outer hairs are thinner than the middle ones (r = 0.02 + 0.03 * edge + up to 0.012)
  assert.ok(d[0].r < 0.035 && d[39].r < 0.035 && d[20].r > 0.045);
  // a choice for every paint tool, and vector lines keep it
  assert.equal(applySettings({ tip: 'round' }, { tip: 'flat' }).tip, 'flat');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  assert.equal(sanitizeBrush({ tip: 'flat' }).tip, 'flat');
});

test('impasto', async () => {
  const { impastoFor, HEIGHT_SHARE } = await import('../web/js/painter.js');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const { BUILTIN_BY_ID } = await import('../web/js/builtinbrushes.js');
  assert.equal(impastoFor({ impasto: 0, size: 50 }), null, 'off by default');
  // the light looks a twentieth of the size across: 60 px -> 3 px, never under 1 px or over 5
  assert.deepEqual(impastoFor({ impasto: 0.5, size: 60 }), { amount: 0.5, depth: 3, canvas: null });
  assert.equal(impastoFor({ impasto: 1, size: 10 }).depth, 1);
  assert.equal(impastoFor({ impasto: 1, size: 600 }).depth, 5);
  assert.equal(impastoFor({ impasto: 3, size: 30 }).amount, 1);
  assert.equal(impastoFor({ impasto: 0.5, size: 20, pixel: true }), null, 'hard pixels stay flat');
  const c = {};
  assert.equal(impastoFor({ impasto: 0.5, size: 30 }, c).canvas, c, 'the height canvas the dabs go into');
  assert.ok(HEIGHT_SHARE > 0 && HEIGHT_SHARE < 1, 'each dab adds only part of its density to the height');
  // every paint tool has it (off), saved settings and vector lines keep it within 0-1
  assert.equal(sanitizeSettings(null).brush.impasto, 0);
  assert.equal(sanitizeSettings({ brush: { impasto: 2 } }).brush.impasto, 1);
  assert.ok(BRUSH_KEYS.includes('impasto'));
  assert.equal(sanitizeBrush({ impasto: 0.4 }).impasto, 0.4);
  assert.equal(sanitizeBrush({}).impasto, 0, 'older lines have none');
  // Oil paint: a flat brush with impasto, mixing with the colours under it
  const oil = BUILTIN_BY_ID['b-oil'].settings;
  assert.equal(oil.tip, 'flat');
  assert.equal(oil.impasto, 0.5);
  assert.ok(oil.mix > 0 && oil.tipFollow);
});

test('paint load', async () => {
  const { loadShare } = await import('../web/js/wetmix.js');
  const { BUILTIN_BY_ID } = await import('../web/js/builtinbrushes.js');
  assert.equal(loadShare(1, 0), 1, 'a fully loaded brush paints full on bare paper');
  assert.equal(loadShare(0.1, 0), 0.1, 'a blender leaves little on bare paper');
  assert.equal(loadShare(0.1, 1), 1, 'and moves all the colour it picked up');
  near(loadShare(0.1, 0.5), 0.55, 'half cover: 0.1 + 0.9 * 0.5');
  assert.equal(loadShare(undefined, 0), 1, 'older settings: full');
  assert.equal(loadShare(-1, 2), 1, 'clamped: load 0, cover 1');
  assert.equal(sanitizeSettings(null).brush.paintLoad, 1);
  assert.equal(sanitizeSettings({ brush: { paintLoad: 5 } }).brush.paintLoad, 1);
  assert.equal(BUILTIN_BY_ID['b-blender'].settings.paintLoad, 0.1);
});

test('runs dry', async () => {
  const { dryness, dryDab, DRY_LEVELS } = await import('../web/js/brush.js');
  const { dryGrainFor, textureFor } = await import('../web/js/painter.js');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const { BUILTIN_BY_ID } = await import('../web/js/builtinbrushes.js');
  assert.equal(dryness(500, 40, 0), 0, 'off: never dries');
  // dryOut 1: dry after 3 brush widths (120 px at size 40); solid for the first 45% (54 px), then (u^1.5 over the
  // remaining 66 px): at 87 px u = 33 / 66 = 0.5
  assert.equal(dryness(120, 40, 1), 1);
  assert.equal(dryness(54, 40, 1), 0, 'still solid at 45%');
  assert.equal(dryness(20, 40, 1), 0);
  near(dryness(87, 40, 1), Math.SQRT1_2 / 2, 'half way through the drying part: 0.5^1.5');
  // dryOut 0.5: 3 + 37 * 0.25 = 12.25 widths = 490 px at size 40
  near(dryness(490, 40, 0.5), 1, 'dry at 12.25 widths');
  assert.equal(dryness(5000, 40, 0.5), 1, 'stays dry');
  assert.equal(dryness(-5, 40, 0.5), 0);
  // a dab's dry level and density: full at 0, the last level and 80% density when dry
  assert.deepEqual(dryDab(0), { level: 0, flowK: 1 });
  assert.deepEqual(dryDab(1), { level: DRY_LEVELS - 1, flowK: 0.8 });
  assert.equal(dryDab(0.5).level, Math.round(0.5 * (DRY_LEVELS - 1)));
  // with Runs dry the texture shows as it dries (in the dabs), not over the whole stroke
  assert.equal(dryGrainFor({ dryOut: 0, texture: 'paper', textureAmount: 0.5 }), null);
  assert.equal(dryGrainFor({ dryOut: 0.3, texture: 'none', textureAmount: 0.5 }), null, 'no texture: nothing to show');
  assert.equal(dryGrainFor({ dryOut: 0.3, texture: 'paper', textureAmount: 0.5, grainPressure: true }), null, 'Grain by pressure keeps the grain');
  assert.equal(textureFor({ dryOut: 0.3, texture: 'none', textureAmount: 0.5 }), null);
  // settings: off by default, kept in 0-1 by tools and vector lines
  assert.equal(sanitizeSettings(null).brush.dryOut, 0);
  assert.equal(sanitizeSettings({ brush: { dryOut: 4 } }).brush.dryOut, 1);
  assert.ok(BRUSH_KEYS.includes('dryOut'));
  assert.equal(sanitizeBrush({ dryOut: 0.3 }).dryOut, 0.3);
  assert.equal(sanitizeBrush({}).dryOut, 0, 'older lines have none');
  const oil = BUILTIN_BY_ID['b-oil'].settings;
  assert.equal(oil.dryOut, 0.3);
  assert.equal(oil.texture, 'paper');
});

test('scatter across the stroke only (Both ways off)', async () => {
  const { dabJitter } = await import('../web/js/brush.js');
  const s = { scatter: 0.5, scatterBoth: false };
  // random 0.9 -> (0.9 * 2 - 1) * 0.5 * 100 = 40 px; heading right (0): straight down, +y
  let j = dabJitter(s, 100, () => 0.9, 0);
  near(j.dx, 0, 'not along the stroke'); near(j.dy, 40, 'across it');
  // heading down (pi/2): across is to the left, -x
  j = dabJitter(s, 100, () => 0.9, Math.PI / 2);
  near(j.dx, -40, 'across a downward stroke'); near(j.dy, 0, 'none along it');
  j = dabJitter(s, 100, () => 0.1, 0);
  near(j.dy, -40, 'the other side');
  j = dabJitter(s, 100, () => 0.9, null);
  assert.deepEqual([j.dx, j.dy], [0, 0], 'no heading yet (the first dab): stays on the path');
  // Both ways (the default) still scatters over a disc: angle 0.25 turn, radius sqrt(0.25) * 50 = 25 -> straight down
  const r = [0.25, 0.25];
  j = dabJitter({ scatter: 0.5 }, 100, () => r.shift(), 0);
  near(j.dx, 0, 'disc'); near(j.dy, 25, 'disc');
  assert.equal(sanitizeSettings(null).brush.scatterBoth, true, 'on by default');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  assert.equal(sanitizeBrush({}).scatterBoth, true, 'older lines scatter both ways');
  assert.equal(sanitizeBrush({ scatterBoth: false }).scatterBoth, false);
});

test('a tip turning with the stroke follows the stroke, not its scattered dabs', async () => {
  const { Painter } = await import('../web/js/painter.js');
  const turns = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, arc() {}, fill() {}, rotate(r) { turns.push(r - Math.PI / 2); } };
  // turned a quarter, so no dab is drawn unturned (which skips rotate)
  const p = new Painter(ctx, { color: '#000', hardness: 1, thickness: 0.5, angle: 90, follow: true });
  // along y = 0 to the right, the dabs scattered 20 px up and down in turn
  for (let x = 0; x <= 40; x += 10) p.dab(x, x % 20 ? 20 : -20, 10, 1, 0, null, null, { x, y: 0 });
  p.finish();
  assert.equal(turns.length, 5);
  for (const r of turns) near(r, 0, 'every dab turned along the stroke, the first one too');
});

test('count jitter', async () => {
  const { dabCount } = await import('../web/js/brush.js');
  assert.equal(dabCount({ count: 9 }, () => { throw new Error('no random number without jitter'); }), 9);
  // 76% of 9 is 6.84: random 0.99 takes floor(6.77) = 6 off (3 dabs), random 0 none (9)
  assert.equal(dabCount({ count: 9, countJitter: 0.76 }, () => 0.99), 3);
  assert.equal(dabCount({ count: 9, countJitter: 0.76 }, () => 0), 9);
  assert.equal(dabCount({ count: 1, countJitter: 1 }, () => 0.99), 1, 'never fewer than 1');
  assert.equal(dabCount({ count: 4, countJitter: 1 }, () => 0.99), 1, 'at 100%: down to 1');
  assert.equal(sanitizeSettings(null).brush.countJitter, 0);
});

test('Pressure → grain: how strongly the texture shows at each pressure', async () => {
  const { textureFor } = await import('../web/js/painter.js');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  assert.equal(grainAt({}, 0.2), 1, 'off: always all of it');
  assert.equal(grainAt({ texturePressure: 0 }, 0), 1);
  // above 0: a light touch shows 1 - v, a firm one all of it, in a straight line between (gamma 1)
  near(grainAt({ texturePressure: 1 }, 0), 0, 'full: none at the lightest touch');
  near(grainAt({ texturePressure: 1 }, 0.3), 0.3, 'full: as the pressure');
  near(grainAt({ texturePressure: 0.6 }, 0), 0.4, '1 - 0.6');
  near(grainAt({ texturePressure: 0.6 }, 0.5), 0.7, '1 - 0.6 * 0.5');
  near(grainAt({ texturePressure: 0.6 }, 1), 1, 'firm: all');
  // below 0: the other way round
  near(grainAt({ texturePressure: -1 }, 0.25), 0.75, 'pressing harder fills it in');
  near(grainAt({ texturePressure: -0.5 }, 1), 0.5, 'firm: 1 - 0.5');
  near(grainAt({ texturePressure: -0.5 }, 0), 1, 'light: all');
  // through the pressure curve: gamma 2 makes 0.5 count as 0.25
  near(grainAt({ texturePressure: 1, gamma: 2 }, 0.5), 0.25, 'gamma');
  near(grainAt({ texturePressure: 5 }, 0.5), 0.5, 'clamped to 1');
  // settings: off by default, kept in -1..1 by tools and vector lines
  assert.equal(sanitizeSettings(null).brush.texturePressure, 0);
  assert.equal(sanitizeSettings({ brush: { texturePressure: -3 } }).brush.texturePressure, -1);
  assert.ok(BRUSH_KEYS.includes('texturePressure'));
  assert.equal(sanitizeBrush({ texturePressure: -0.4 }).texturePressure, -0.4);
  assert.equal(sanitizeBrush({ texturePressure: 2 }).texturePressure, 1);
  assert.equal(textureFor({ texture: 'none', textureAmount: 0.5, texturePressure: 1 }, {}), null, 'no texture: nothing to weigh');
});

test('combined brush: its second brush gets a copy only with a texture worked out per pixel', async () => {
  const { comboCopyFor } = await import('../web/js/painter.js');
  assert.equal(comboCopyFor(null, 'source-over', 10, 10), null, 'no texture');
  assert.equal(comboCopyFor({ scale: 1 }, 'multiply', 10, 10), null, 'Multiply texture: cut on the GPU from the blended stroke');
});

test('size with pen tilt: from the upright size to the flat one, straight or along a curve', async () => {
  const { tiltSizeAt, dynamicsAt, dynamicsReach } = await import('../web/js/brush.js');
  const { usesDynamics, sanitizeBrush } = await import('../web/js/vector.js');
  near(tiltSizeAt({}, 0.7), 1, 'off');
  near(tiltSizeAt({ tiltSize: 1 }, 0.5), 2, 'as before: 1 upright, 3 flat, 2 half way');
  // Upright size 0 and Tilt → size 1: 0 upright, 3 flat
  near(tiltSizeAt({ tiltSizeMin: 0, tiltSize: 1 }, 0), 0, 'upright');
  near(tiltSizeAt({ tiltSizeMin: 0, tiltSize: 1 }, 0.5), 1.5, 'half way: 0 + 3 x 0.5');
  // a straight two-point curve from 0.1 to 1: at t 0.5 it is 0.55; between 0 and 1 + 2 x 2 = 5 that is 2.75
  near(tiltSizeAt({ tiltSizeMin: 0, tiltSize: 2, tiltSizeCurve: [[0, 0.1], [1, 1]] }, 0.5), 2.75, 'along the curve');
  near(tiltSizeAt({ tiltSizeMin: 0, tiltSize: 2, tiltSizeCurve: [[0, 0.1], [1, 1]] }, 0), 0.5, 'a mouse counts as upright: 5 x 0.1');
  near(dynamicsAt({ tiltSizeMin: 0.5, speedSize: 0.5 }, 0, 1).sizeK, 0.25, 'tilt and speed multiply: 0.5 x 0.5');
  near(dynamicsReach({ tiltSizeMin: 0, tiltSize: 4.5 }), 10, 'the biggest a dab gets: 1 + 2 x 4.5');
  near(dynamicsReach({ tiltSizeMin: 0.3 }), 1, 'shrinking never reaches further than the size');
  assert.ok(usesDynamics({ tiltSizeMin: 0.5 }), 'an upright size below 100% needs the tilt of each point');
  assert.ok(!usesDynamics({ tiltSizeMin: 1 }));
  // kept in range by tools and vector lines
  const s = sanitizeSettings({ brush: { tiltSize: 9, tiltSizeMin: -1, tiltSizeCurve: [[1, 1], [0, 0.2]] } }).brush;
  assert.deepEqual([s.tiltSize, s.tiltSizeMin, s.tiltSizeCurve], [4.5, 0, [[0, 0.2], [1, 1]]]);
  assert.equal(sanitizeSettings(null).brush.tiltSizeMin, 1, 'default: the same size upright');
  const b = sanitizeBrush({ tiltSize: 3, tiltSizeMin: 0.2, tiltSizeCurve: [[0, 0], [0.5, 1]] });
  assert.deepEqual([b.tiltSize, b.tiltSizeMin, b.tiltSizeCurve], [3, 0.2, [[0, 0], [0.5, 1]]]);
  assert.equal(sanitizeBrush({}).tiltSizeMin, 1);
});

test('several tip pictures: which one each dab takes', async () => {
  const { tipIndex } = await import('../web/js/brush.js');
  const run = (count, order, n = 7, rnd) => Array.from({ length: n }, (_, i) => tipIndex(i, count, order, rnd));
  assert.deepEqual(run(3, 'repeat'), [0, 1, 2, 0, 1, 2, 0], 'in turn');
  assert.deepEqual(run(3, 'reverse'), [0, 1, 2, 1, 0, 1, 2], 'back and forth, the ends once each');
  assert.deepEqual(run(2, 'reverse', 4), [0, 1, 0, 1]);
  assert.deepEqual(run(3, 'last'), [0, 1, 2, 2, 2, 2, 2], 'once through, then the last');
  assert.deepEqual(run(4, 'random', 3, () => 0.6), [2, 2, 2], 'random: floor(0.6 x 4)');
  assert.equal(tipIndex(0, 3, 'random', () => 0.999999), 2);
  assert.deepEqual(run(1, 'reverse', 3), [0, 0, 0], 'one picture: always it');
  assert.equal(tipIndex(5, 2, 'nonsense'), 1, 'an unknown order goes in turn');
});

test('several tip pictures: kept by tools, saved brushes and vector lines', async () => {
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const { orphanImages } = await import('../web/js/brushorg.js');
  const s = sanitizeSettings({ brush: { tips: ['img:aaaaaaaa', 'round', 5, 'img:bbbbbbbb'], tipOrder: 'last' } }).brush;
  assert.deepEqual(s.tips, ['img:aaaaaaaa', 'img:bbbbbbbb'], 'tip images only');
  assert.equal(s.tipOrder, 'last');
  assert.equal(sanitizeSettings({ brush: { tipOrder: 'sideways' } }).brush.tipOrder, 'repeat');
  assert.deepEqual(sanitizeSettings({ brush: { tips: 'img:aaaaaaaa' } }).brush.tips, [], 'not a list');
  assert.equal(sanitizeSettings({ brush: { tips: Array(40).fill('img:aaaaaaaa') } }).brush.tips.length, 15, 'up to 16 pictures with the tip');
  assert.ok(BRUSH_KEYS.includes('tips') && BRUSH_KEYS.includes('tipOrder'));
  const b = sanitizeBrush({ tips: ['img:cccccccc', 'bristle', 'img:x'], tipOrder: 'reverse' });
  assert.deepEqual([b.tips, b.tipOrder], [['img:cccccccc'], 'reverse']);
  assert.deepEqual([sanitizeBrush({}).tips, sanitizeBrush({}).tipOrder], [[], 'repeat']);
  // deleting a brush frees its extra tip pictures too, unless a kept brush uses them
  const removed = [{ settings: { tip: 'img:aaaaaaaa', tips: ['img:bbbbbbbb', 'img:cccccccc'] } }];
  const kept = [{ settings: { tip: 'round', tips: ['img:cccccccc'] } }];
  assert.deepEqual(orphanImages(removed, kept).sort(), ['aaaaaaaa', 'bbbbbbbb']);
});

test('No build-up: each pixel keeps the strongest dab, laid with source-over', async () => {
  const { maxDabAlpha } = await import('../web/js/brush.js');
  const { sanitizeBrush } = await import('../web/js/vector.js');
  const tiles = new Map(), dab = (...alphas) => Uint8ClampedArray.from(alphas.flatMap(a => [10, 20, 30, a]));
  const alphas = d => [...d].filter((_, i) => i % 4 === 3);
  // a 2 x 1 dab at (5, 5): nothing laid yet, so the alphas go down as they are
  assert.deepEqual(alphas(maxDabAlpha(dab(100, 0), 2, 5, 5, 100, 100, tiles)), [100, 0]);
  // the same again: no stronger, nothing to lay; the colour stays
  const again = maxDabAlpha(dab(100, 60), 2, 5, 5, 100, 100, tiles);
  assert.deepEqual(alphas(again), [0, 60]);
  assert.deepEqual([...again.slice(0, 3)], [10, 20, 30]);
  // stronger: 200 over 100 lays (200 - 100) / (255 - 100) x 255 = 164.5 → 165, and source-over then gives
  // 100 + 165 x (255 - 100) / 255 = 200.3, the 200 asked for
  assert.deepEqual(alphas(maxDabAlpha(dab(200), 1, 5, 5, 100, 100, tiles)), [165]);
  assert.deepEqual(alphas(maxDabAlpha(dab(150), 1, 5, 5, 100, 100, tiles)), [0], 'weaker than the 200 now kept');
  // full: 255 over 200 lays all of it
  assert.deepEqual(alphas(maxDabAlpha(dab(255), 1, 5, 5, 100, 100, tiles)), [255]);
  // outside the stroke canvas: nothing laid, nothing kept; another 64 px tile keeps its own
  assert.deepEqual(alphas(maxDabAlpha(dab(90, 90, 90), 3, -1, 99, 100, 100, tiles)), [0, 90, 90], 'x -1 is off the canvas, x 0 and 1 on it');
  assert.deepEqual(alphas(maxDabAlpha(dab(90), 1, 3, 100, 100, 100, tiles)), [0], 'row 100 is below it');
  assert.deepEqual(alphas(maxDabAlpha(dab(90), 1, 70, 5, 100, 100, tiles)), [90]);
  assert.equal(tiles.size, 3);
  // kept by tools and vector lines, off by default
  assert.equal(sanitizeSettings(null).brush.darkenDabs, false);
  assert.equal(sanitizeSettings({ brush: { darkenDabs: 1 } }).brush.darkenDabs, true);
  assert.deepEqual([sanitizeBrush({}).darkenDabs, sanitizeBrush({ darkenDabs: true }).darkenDabs], [false, true]);
});
