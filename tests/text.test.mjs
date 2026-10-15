// Text layout, text settings, gradient maths and tool keys. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, sanitizeText, fontCss } from '../web/js/textlayer.js';
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
  assert.equal(toolForKey('g', 'lassofill'), 'fill', 'and round again');
  assert.equal(toolForKey('t', 'pen'), 'text');
  assert.equal(toolForKey('z', 'pen'), null);
  const s = sanitizeSettings({ text: { font: 'Meiryo', align: 'nowhere', vertical: 1 }, gradient: { shape: 'radial' } });
  assert.equal(s.text.font, 'Meiryo');
  assert.equal(s.text.align, 'left');
  assert.equal(s.text.vertical, true);
  assert.equal(s.gradient.shape, 'radial');
});
