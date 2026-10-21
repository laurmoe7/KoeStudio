// Text layout, text settings, gradient maths and tool keys. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, sanitizeText, fontCss, sanitizeTextMatrix, toTextLocal, textTransformStart, textMatrixAfter, textAfterMap, styleRange, editContent, restyleText, styleAt, sanitizeTextPath, pathFromPoints, pathWalker, warpEdges, warpBounds, isWarped, PATH_MAX } from '../web/js/textlayer.js';
import { xfMatrix } from '../web/js/transform.js';
import { gradientStops, snapEnd, gradientReach, repeatStops } from '../web/js/gradient.js';
import { toolForKey, sanitizeSettings } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

const measure = s => s.length * 10;  // every character 10 px wide
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg || `${a} ≈ ${b}`);

test('horizontal layout', () => {
  const t = sanitizeText({ content: 'Hello\nHi', x: 100, y: 50, size: 20, leading: 1.5 });
  const { glyphs, bounds } = layoutText(t, measure);
  assert.deepEqual(bounds, { x: 100, y: 50, w: 50, h: 60 }, 'widest line 5 x 10; two lines of 20 x 1.5');
  assert.deepEqual(glyphs.map(g => [g.str, g.x, g.y]), [['Hello', 100, 55], ['Hi', 100, 85]], 'half the extra line height above each line: (30-20)/2 = 5');
  const c = layoutText({ ...t, align: 'center' }, measure);
  assert.equal(c.bounds.x, 75, 'centred on x: 100 - 50/2');
  assert.equal(c.glyphs[1].x, 90, 'short line centred too: 100 - 20/2');
  const r = layoutText({ ...t, align: 'right' }, measure);
  assert.equal(r.glyphs[1].x, 80, 'right edge at x: 100 - 20');
});

test('vertical layout: columns right to left, characters top to bottom', () => {
  const t = sanitizeText({ content: 'ab\nc', x: 300, y: 10, size: 20, leading: 1.5, vertical: true });
  const { glyphs, bounds } = layoutText(t, measure);
  assert.deepEqual(bounds, { x: 240, y: 10, w: 60, h: 40 }, 'two columns of 30; longest column 2 x 20');
  assert.deepEqual(glyphs.map(g => [g.str, g.x, g.y]), [['a', 285, 10], ['b', 285, 30], ['c', 255, 10]],
    'first column centred at 300 - 15, second at 300 - 30 - 15');
  const mid = layoutText({ ...t, align: 'center' }, measure);
  assert.equal(mid.glyphs[2].y, 20, 'the short column is centred: (40 - 20) / 2 down');
  assert.equal(layoutText({ ...t, content: '😀x' }, measure).glyphs.length, 2, 'an emoji is one character, not two halves');
});

test('text settings', () => {
  const t = sanitizeText({ font: 'Arial"; color: red', size: 5000, align: 'middle', color: 'blue', leading: 'x' });
  assert.equal(t.font, 'Segoe UI', 'odd font names cannot reach the CSS font string');
  assert.equal(t.size, 1000);
  assert.equal(t.align, 'left');
  assert.equal(t.color, '#000000');
  assert.equal(t.leading, 1.2);
  assert.equal(fontCss({ ...t, bold: true, italic: true, size: 12, font: 'Meiryo' }), 'italic bold 12px "Meiryo", "Segoe UI", sans-serif');
  const d = sanitizeDoc({ layers: [{ name: 'T', text: { content: 'Hi', size: 30 } }, { name: 'P' }] });
  assert.equal(d.layers[0].text.content, 'Hi');
  assert.equal(d.layers[0].text.size, 30);
  assert.ok(!('text' in d.layers[1]), 'ordinary layers have no text');
});

test('gradients', () => {
  assert.deepEqual(gradientStops('main-sub', '#ff0000', '#0000ff'), [[0, '#ff0000'], [1, '#0000ff']]);
  assert.deepEqual(gradientStops('main-clear', '#ff8000', '#000000'), [[0, '#ff8000'], [1, 'rgba(255,128,0,0)']], 'fades in its own hue');
  assert.deepEqual(gradientStops('clear-main', '#ff8000', '#000000')[0], [0, 'rgba(255,128,0,0)']);
  const e = snapEnd({ x: 0, y: 0 }, { x: 100, y: 10 });
  near(e.x, 100.49875621120891, 'length kept: hypot(100, 10)');
  near(e.y, 0, '5.7 degrees snaps to 0');
  const d = snapEnd({ x: 0, y: 0 }, { x: 50, y: 52 });
  near(d.x, d.y, '46 degrees snaps to 45');
});

test('repeating and mirrored gradients', () => {
  assert.deepEqual(repeatStops([[0, 'a'], [1, 'b']], 'mirror', 3, 1), [[0, 'b'], [1 / 3, 'a'], [1 / 3, 'a'], [2 / 3, 'b'], [2 / 3, 'b'], [1, 'a']],
    'the copy before the start and the one after the end are turned round');
  assert.deepEqual(repeatStops([[0, 'a'], [1, 'b']], 'repeat', 2), [[0, 'a'], [0.5, 'b'], [0.5, 'a'], [1, 'b']], 'repeat: hard step between copies');
  assert.deepEqual(repeatStops([[0, 'a'], [1, 'b']], 'repeat', 2, 0, 0.01), [[0, 'a'], [0.5, 'b'], [0.51, 'a'], [1, 'b']], 'with edge: the next copy starts a pixel late');
  assert.deepEqual(gradientReach('linear', { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0, w: 35, h: 5 }), { before: 1, after: 2 },
    'corners fall at -1 and 2.5 lengths along the line');
  assert.deepEqual(gradientReach('radial', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0, w: 30, h: 40 }), { before: 0, after: 4 },
    'the far corner is 50 px away: five rings of 10 px');
  const tiny = gradientReach('linear', { x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0, y: 0, w: 100, h: 1 });
  assert.equal(tiny.before + tiny.after + 1, 1000, 'never more than 1000 copies');
});

test('tools sharing a key take turns', () => {
  assert.equal(toolForKey('g', 'pen'), 'fill');
  assert.equal(toolForKey('g', 'fill'), 'gradient');
  assert.equal(toolForKey('g', 'gradient'), 'lassofill');
  assert.equal(toolForKey('g', 'lassofill'), 'gapfill');
  assert.equal(toolForKey('g', 'gapfill'), 'fill', 'and round again');
  assert.equal(toolForKey('t', 'pen'), 'text');
  assert.equal(toolForKey('z', 'pen'), null);
  const s = sanitizeSettings({ text: { font: 'Meiryo', align: 'nowhere', vertical: 1 }, gradient: { shape: 'radial' } });
  assert.equal(s.text.font, 'Meiryo');
  assert.equal(s.text.align, 'left');
  assert.equal(s.text.vertical, true);
  assert.equal(s.gradient.shape, 'radial');
});

test('gradient presets and dithering', async () => {
  const { GRADIENT_COLORS, GRADIENT_PRESETS, ditherData } = await import('../web/js/gradient.js');
  assert.deepEqual(gradientStops('main-sub-main', '#ff0000', '#0000ff'), [[0, '#ff0000'], [0.5, '#0000ff'], [1, '#ff0000']]);
  assert.deepEqual(gradientStops('gray', '#ff0000', '#0000ff'), [[0, '#000000'], [1, '#ffffff']], 'presets ignore main and sub');
  assert.deepEqual(gradientStops('sky', '', '').map(s => s[0]), [0, 1 / 3, 2 / 3, 1], 'evenly spaced');
  for (const [id] of GRADIENT_COLORS) assert.ok(gradientStops(id, '#112233', '#445566').length >= 2, id);
  for (const id of Object.keys(GRADIENT_PRESETS)) assert.ok(GRADIENT_COLORS.some(([c]) => c === id), `${id} is in the menu`);

  const w = 64, h = 64, d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(i < 64 ? [0, 0, 0, 0] : i < 128 ? [100, 100, 100, 128] : [100, 150, 200, 255], i * 4);
  const out = ditherData(d.slice(), w, h, 10, 20), again = ditherData(d.slice(), w, h, 10, 20);
  assert.deepEqual(out, again, 'the same everywhere it is run (anchored to the doc)');
  let sum = 0, moved = 0;
  for (let i = 0; i < d.length; i++) {
    assert.ok(Math.abs(out[i] - d[i]) <= 1, 'at most one level');
    if (i % 4 === 3 && (d[i] === 0 || d[i] === 255)) assert.equal(out[i], d[i], 'empty and solid alpha stay');
    if (i >= 128 * 4 && i % 4 === 0) { sum += out[i] - d[i]; if (out[i] !== d[i]) moved++; }
  }
  assert.ok(moved > 500, 'many pixels change');
  assert.ok(Math.abs(sum / (w * h - 128)) < 0.05, 'on average the colour stays the same');
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 0], 'empty pixels stay empty');
});

test('text outlines are kept in range', async () => {
  const { sanitizeText } = await import('../web/js/textlayer.js');
  assert.deepEqual([sanitizeText({}).outline, sanitizeText({}).outlineColor], [0, '#ffffff'], 'old text layers: no outline');
  assert.deepEqual([sanitizeText({ outline: 300, outlineColor: '#12abEF' }).outline, sanitizeText({ outlineColor: '#12abEF' }).outlineColor], [100, '#12abEF']);
  assert.equal(sanitizeText({ outlineColor: 'red; x' }).outlineColor, '#ffffff', 'only #rrggbb');
});

test('turned and scaled text keeps a matrix', () => {
  assert.equal(sanitizeTextMatrix([1, 0, 0, 1, 0, 0]), null, 'no change is no matrix');
  assert.equal(sanitizeTextMatrix([1, 0, 0.5, 1, 0, 0]), null, 'shear is refused');
  assert.equal(sanitizeTextMatrix([0, 0, 0, 0, 0, 0]), null);
  assert.equal(sanitizeTextMatrix('x'), null);
  assert.deepEqual(sanitizeTextMatrix([0, 2, -2, 0, 10, 5]), [0, 2, -2, 0, 10, 5], 'turned 90° and doubled');
  assert.equal(sanitizeText({}).m, undefined, 'plain text has none');
  assert.deepEqual(sanitizeText({ m: [-1, 0, 0, 1, 100, 0] }).m, [-1, 0, 0, 1, 100, 0], 'mirrored');
  // doc point -> layout point: m turns 90° clockwise and doubles, then moves by (10, 5)
  const t = { m: [0, 2, -2, 0, 10, 5] };
  const q = toTextLocal(t, { x: 10 - 2 * 3, y: 5 + 2 * 1 });  // the doc image of layout point (1, 3)
  near(q.x, 1); near(q.y, 3);
  // the transform box starts on the text's frame: layout box 40 x 20 at (0, 0) under m
  const s = textTransformStart(t, { x: 0, y: 0, w: 40, h: 20 });
  near(s.rot, Math.PI / 2); near(s.sx, 2); near(s.sy, 2);
  near(s.cx, 10 - 2 * 10); near(s.cy, 5 + 2 * 20, 'centre (20, 10) maps to (10 - 20, 5 + 40)');
  // and a transform left as it started gives the same matrix back
  const back = textMatrixAfter(xfMatrix(s), { x: 0, y: 0, w: 40, h: 20 });
  back.forEach((v, i) => near(v, t.m[i], `entry ${i}`));
  // an untouched plain text: identity again
  assert.equal(textMatrixAfter(xfMatrix(textTransformStart({}, { x: 5, y: 7, w: 30, h: 10 })), { x: 5, y: 7, w: 30, h: 10 }), null);
  // a plain text box moved by (3, 4): only the shift
  const moved = { ...textTransformStart({}, { x: 5, y: 7, w: 30, h: 10 }) };
  moved.cx += 3; moved.cy += 4;
  assert.deepEqual(textMatrixAfter(xfMatrix(moved), { x: 5, y: 7, w: 30, h: 10 }), [1, 0, 0, 1, 3, 4]);
});

test('text follows flips, turns and resizes of the canvas', () => {
  const t = { content: 'a', x: 10, y: 20 };
  assert.deepEqual(textAfterMap(t, [1, 0, 0, 1, -5, 3]).m, [1, 0, 0, 1, -5, 3], 'a crop shifts it');
  assert.deepEqual(textAfterMap(t, [-1, 0, 0, 1, 100, 0]).m, [-1, 0, 0, 1, 100, 0], 'flipped across a 100 px canvas');
  assert.equal(textAfterMap({ ...t, m: [-1, 0, 0, 1, 100, 0] }, [-1, 0, 0, 1, 100, 0]).m, undefined, 'flipped twice: back to none');
  assert.deepEqual(textAfterMap(t, [0, 1, -1, 0, 300, 0]).m, [0, 1, -1, 0, 300, 0], 'a quarter turn right');
  assert.deepEqual(textAfterMap(t, [2, 0, 0, 0.5, 0, 0]).m, [2, 0, 0, 0.5, 0, 0], 'an uneven resize of level text is fine');
  const turned = { ...t, m: [0.6, 0.8, -0.8, 0.6, 0, 0] };
  assert.equal(textAfterMap(turned, [2, 0, 0, 0.5, 0, 0]), null, 'but turned text would shear');
  assert.deepEqual(textAfterMap(turned, [2, 0, 0, 2, 0, 0]).m, [1.2, 1.6, -1.6, 1.2, 0, 0], 'an even resize keeps it');
});

test('styling parts of a text', () => {
  const t = sanitizeText({ content: 'Hello world', size: 20, color: '#000000' });
  assert.equal(t.runs, undefined, 'plain text has no runs');
  const b = styleRange(t, 0, 5, { bold: true });
  assert.deepEqual(b.runs, [{ from: 0, to: 5, bold: true }]);
  const c = styleRange(b, 3, 8, { color: '#FF0000' });
  assert.deepEqual(c.runs, [{ from: 0, to: 3, bold: true }, { from: 3, to: 5, bold: true, color: '#ff0000' }, { from: 5, to: 8, color: '#ff0000' }],
    'overlapping changes split into runs that each say all they change');
  assert.deepEqual(styleRange(c, 0, 11, { bold: false, color: '#000000' }).runs, undefined, "back to the text's own look: no runs");
  // from a file: bad values dropped, overlaps resolved, runs past the end cut
  assert.deepEqual(sanitizeText({ content: 'abc', runs: [{ from: 1, to: 9, size: 'x', italic: true }, { from: 0, to: 1, font: '<b>' }, 'junk'] }).runs,
    [{ from: 1, to: 3, italic: true }]);
  // typing: inside or right after a run continues it; before it at the start, the run moves along
  assert.deepEqual(editContent(b, 'HelloX world').runs, [{ from: 0, to: 6, bold: true }], 'typed right after the bold part');
  assert.deepEqual(editContent(b, 'Hello wXorld').runs, [{ from: 0, to: 5, bold: true }], 'typed in the plain part');
  assert.deepEqual(editContent(b, '>Hello world').runs, [{ from: 0, to: 6, bold: true }], "at the very start: takes the first character's look");
  assert.deepEqual(editContent(b, 'Ho world').runs, [{ from: 0, to: 2, bold: true }], 'deleting takes the deleted styles along');
  assert.deepEqual(editContent(c, 'Hello').runs, [{ from: 0, to: 3, bold: true }, { from: 3, to: 5, bold: true, color: '#ff0000' }]);
  assert.equal(styleAt(b, 2).bold, true);
  assert.equal(styleAt(b, 7).bold, false);
  assert.deepEqual(styleAt(b, -1), { font: 'Segoe UI', size: 20, bold: false, italic: false, color: '#000000' }, 'before the start: the text’s own look');
  // changing the whole text's settings drops what now matches
  assert.equal(restyleText(b, { bold: true }).runs, undefined);
});

test('layout with mixed sizes', () => {
  const m = (s, st) => s.length * (st ? st.size / 2 : 10);  // characters half as wide as they are tall
  const t = styleRange(sanitizeText({ content: 'aab\nc', x: 0, y: 0, size: 20, leading: 1 }), 2, 3, { size: 40 });
  const { glyphs, bounds } = layoutText(t, m);
  // line 1: 'aa' (20 px, 2 x 10 wide) then 'b' (40 px, 20 wide); 40 tall. Line 2: 'c', 20 tall.
  assert.deepEqual(bounds, { x: 0, y: 0, w: 40, h: 60 });
  assert.deepEqual(glyphs.map(g => [g.str, g.x, g.y, g.st.size]), [['aa', 0, 16, 20], ['b', 20, 0, 40], ['c', 0, 40, 20]],
    "the small letters are lowered 0.8 x (40 - 20) = 16 onto the big one's baseline");
  const v = layoutText({ ...t, vertical: true, x: 100 }, m);
  // column 1: a, a (20 each) and b (40) down; pitch 40. Column 2: c, pitch 20.
  assert.deepEqual(v.bounds, { x: 40, y: 0, w: 60, h: 80 });
  assert.deepEqual(v.glyphs.map(g => [g.str, g.x, g.y]), [['a', 80, 0], ['a', 80, 20], ['b', 80, 40], ['c', 50, 0]]);
});

test('letter spacing goes between letters', () => {
  const t = sanitizeText({ content: 'abc', x: 0, y: 0, size: 20, leading: 1, tracking: 0.5 });
  const { glyphs, bounds } = layoutText(t, measure);
  // each letter 10 wide, 0.5 x 20 = 10 px between them, none after the last: 3 x 10 + 2 x 10
  assert.deepEqual(glyphs.map(g => [g.str, g.x]), [['a', 0], ['b', 20], ['c', 40]]);
  assert.equal(bounds.w, 50);
  assert.deepEqual(layoutText({ ...t, align: 'center', x: 100 }, measure).glyphs.map(g => g.x), [75, 95, 115], 'centred: 100 - 50/2');
  assert.equal(layoutText({ ...t, content: 'ab', tracking: -0.5 }, measure).bounds.w, 10, 'pulled together: 20 - 10');
  const v = layoutText({ ...t, content: 'ab', vertical: true }, measure);
  assert.deepEqual(v.glyphs.map(g => g.y), [0, 30], 'down a column: 20 x 1.5 apart');
  assert.equal(v.bounds.h, 50, '30 + the last letter 20');
  assert.equal(sanitizeText({ tracking: 9 }).tracking, 2);
  assert.equal(sanitizeText({}).tracking, 0);
});

test('text along a path', () => {
  const t = sanitizeText({ content: 'ab', x: 10, y: 20, size: 20, leading: 1, path: [[0, 0], [100, 0]] });
  const { glyphs, bounds } = layoutText(t, measure);
  // baseline 0.8 x 20 = 16 below the line top sits on the path; each letter centred at its middle along it
  assert.deepEqual(glyphs.map(g => [g.str, g.x, g.y, g.rot, g.ox, g.oy]), [['a', 15, 20, 0, -5, -16], ['b', 25, 20, 0, -5, -16]]);
  assert.deepEqual(bounds, { x: 10, y: 4, w: 20, h: 20 });
  assert.equal(layoutText({ ...t, align: 'center' }, measure).glyphs[0].x, 55, 'centred on the path: (100 - 20) / 2 + 5, from x 10');
  assert.equal(layoutText({ ...t, align: 'right' }, measure).glyphs[1].x, 105, 'ends at the end of the path: 10 + 100 - 5');
  const two = layoutText({ ...t, content: 'a\nb' }, measure).glyphs;
  assert.deepEqual([two[1].x, two[1].oy], [15, 4], 'the second line starts at the path start, one line (20) lower');
  const down = layoutText({ ...t, path: [[0, 0], [0, 100]] }, measure);
  near(down.glyphs[0].rot, Math.PI / 2);
  near(down.glyphs[0].x, 10); near(down.glyphs[0].y, 25);
  // turned a quarter: the letters' tops (16 px above the path) point to +x, their width runs down
  ['x', 'y', 'w', 'h'].forEach((k, i) => near(down.bounds[k], [6, 20, 20, 20][i], k));
  const past = layoutText({ ...t, content: 'abc', path: [[0, 0], [10, 0]] }, measure).glyphs[2];
  assert.deepEqual([past.x, past.y], [35, 20], 'past the end it goes straight on: 10 + 25');
  const bent = layoutText({ ...t, content: 'abc', path: [[0, 0], [10, 0], [10, 10]] }, measure).glyphs;
  assert.deepEqual([bent[1].x, bent[1].y, bent[1].rot], [20, 25, Math.PI / 2], 'b, centred 15 along: 5 down the second piece');
  assert.equal(layoutText({ ...t, vertical: true }, measure).glyphs[0].rot, 0, 'vertical text on a path runs along it');
  assert.deepEqual(layoutText({ ...t, content: '' }, measure).bounds, { x: 10, y: 4, w: 0, h: 20 }, 'empty: a caret-sized box');
});

test('text paths: saved, walked and drawn', () => {
  assert.equal(sanitizeTextPath([[0, 0]]), null, 'one point is no path');
  assert.equal(sanitizeTextPath([[0, 0], [1, 'x']]), null);
  assert.equal(sanitizeTextPath('0,0'), null);
  assert.deepEqual(sanitizeTextPath([[0, 0], [0, 0], [1.234, 2]]), [[0, 0], [1.23, 2]], 'repeats dropped, 1/100 px kept');
  assert.equal(sanitizeText({ path: [[0, 0], [NaN, 1]] }).path, undefined);
  assert.equal(pathWalker({ x: 0, y: 0, path: [[0, 0], [3, 4], [3, 4], [3, 10]] }).length, 11, '5 + 6, the repeated point skipped');
  assert.deepEqual(pathFromPoints([{ x: 5, y: 5 }, { x: 25, y: 5 }], 4), { x: 5, y: 5, path: [[0, 0], [4, 0], [8, 0], [12, 0], [16, 0], [20, 0]] },
    'a straight line: every 4 px, relative to its start, unchanged by smoothing');
  // a corner: (0,0) (4,0) (4,4); three passes of [1 2 1]/4 on the middle point, the ends kept:
  // (3, 1), then (2.5, 1.5), then (2.25, 1.75)
  assert.deepEqual(pathFromPoints([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 4).path, [[0, 0], [2.25, 1.75], [4, 4]]);
  assert.equal(pathFromPoints([{ x: 1, y: 1 }], 4).path, null, 'a click is no path');
  const long = pathFromPoints([{ x: 0, y: 0 }, { x: 2000, y: 0 }], 4).path;
  assert.ok(long.length <= PATH_MAX && long[long.length - 1][0] === 2000, 'a long line keeps at most PATH_MAX points and its end');
});

test('text warps', () => {
  const at = (warp, bend, u) => warpEdges(warp, bend, u, 100, 20);
  assert.deepEqual(at('none', 1, 0.5), [0, 20]);
  assert.deepEqual(at('arch', 1, 0), [0, 20], 'the ends stay');
  assert.deepEqual(at('arch', 1, 0.5), [-25, -5], 'the middle rises a quarter of the width');
  assert.deepEqual(at('arch', -1, 0.5), [25, 45]);
  assert.deepEqual(at('arcTop', 1, 0.5), [-16, 20], 'the top rises 0.8 x 20');
  assert.deepEqual(at('arcBottom', 1, 0.5), [0, 36]);
  assert.deepEqual(at('bulge', 1, 0.5), [-8, 28], '0.4 x 20 out on both sides');
  assert.deepEqual(at('bulge', -1, 0.5), [8, 12], 'pinched to a fifth');
  assert.deepEqual(at('flag', 1, 0.25), [-10, 10], 'a whole wave: up half the height at a quarter');
  assert.deepEqual(at('flag', 1, 0.75), [10, 30]);
  assert.deepEqual(at('rise', 1, 0), [10, 30], 'the left end down half the height');
  assert.deepEqual(at('rise', 1, 1), [-10, 10]);
  const b = { x: 0, y: 0, w: 100, h: 20 };
  assert.deepEqual(warpBounds({ warp: 'arch', bend: 1 }, b), { x: 0, y: -25, w: 100, h: 45 });
  assert.deepEqual(warpBounds({ warp: 'flag', bend: 1 }, b), { x: 0, y: -10, w: 100, h: 40 });
  assert.equal(isWarped({ warp: 'arch', bend: 0 }), false, 'no bend, no warp');
  assert.equal(isWarped(sanitizeText({})), false);
  assert.equal(sanitizeText({ warp: 'twist' }).warp, 'none');
  assert.equal(sanitizeText({ warp: 'flag', bend: -3 }).bend, -1);
});
