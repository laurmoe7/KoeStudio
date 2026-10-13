// Pure-logic tests for the drawing core. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from '../web/js/color.js';
import { pressureCurve, stampFor, Smoother, StampPath, stampBounds } from '../web/js/brush.js';
import { floodMask, growMask } from '../web/js/fill.js';
import { History } from '../web/js/history.js';
import { isReloadKey, comboOf, isTyping } from '../web/js/keys.js';
import { union, clip } from '../web/js/rect.js';
import { newView, toDoc, toScreen, zoomAt, rotateAt, flipAt, fitView } from '../web/js/view.js';
import { sanitizeSettings, nextSize, TOOLS } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) < eps, msg || `${a} ≈ ${b}`);

test('colour conversions', () => {
  assert.deepEqual(hsvToRgb(0, 1, 1), [255, 0, 0]);
  assert.deepEqual(hsvToRgb(120, 1, 1), [0, 255, 0]);
  assert.deepEqual(hsvToRgb(240, 0.5, 1), [128, 128, 255], 'v=1, s=.5: min channel = 255*(1-.5) = 127.5 -> 128');
  assert.deepEqual(rgbToHsv(255, 0, 0), [0, 1, 1]);
  assert.deepEqual(rgbToHsv(0, 0, 0), [0, 0, 0]);
  assert.equal(rgbToHex(255, 128, 0), '#ff8000');
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('abc'), [170, 187, 204], 'short form doubles each digit');
  assert.equal(hexToRgb('#12345'), null);
  for (const hex of ['#3a7bd5', '#000000', '#ffffff', '#808080']) assert.equal(rgbToHex(...hsvToRgb(...rgbToHsv(...hexToRgb(hex)))), hex);
});

test('pressure and stamp size', () => {
  assert.equal(pressureCurve(0.25, 1), 0.25);
  near(pressureCurve(0.25, 0.5), 0.5, 1e-12, 'sqrt(.25) = .5');
  assert.equal(pressureCurve(2), 1, 'clamped');
  const s = { size: 10, flow: 0.5, minSize: 0.2, pressureSize: true, pressureOpacity: true };
  const st = stampFor(s, 0.5);
  near(st.size, 6, 1e-9, 'size 10*(.2+.8*.5) = 6');
  near(st.flow, 0.25, 1e-12, 'flow .5*.5');
  assert.deepEqual(stampFor({ ...s, pressureSize: false, pressureOpacity: false }, 0.1), { size: 10, flow: 0.5 });
});

test('stamps are evenly spaced along a line', () => {
  const path = new StampPath(() => 10, 0.2);  // a stamp every 2 px
  assert.equal(path.add({ x: 0, y: 0, p: 1 }).length, 1, 'first point stamps');
  const out = path.add({ x: 7, y: 0, p: 1 });
  assert.deepEqual(out.map(s => Math.round(s.x * 1000) / 1000), [2, 4, 6]);
  const more = path.add({ x: 9, y: 0, p: 1 });
  assert.deepEqual(more.map(s => Math.round(s.x * 1000) / 1000), [8], 'carries the 1 px left over from the last segment');
  assert.deepEqual(stampBounds([{ x: 10, y: 10, p: 1 }], () => 4), { x: 6, y: 6, w: 8, h: 8 }, 'radius 2 + 2 px margin');
  assert.equal(stampBounds([], () => 4), null);
});

test('smoothing pulls part of the way', () => {
  const sm = new Smoother(0);
  assert.deepEqual(sm.add({ x: 5, y: 5, p: 1 }), { x: 5, y: 5, p: 1 });
  const s2 = new Smoother(5);  // k = 1/(1+3) = .25
  s2.add({ x: 0, y: 0, p: 0 });
  assert.deepEqual(s2.add({ x: 8, y: 4, p: 1 }), { x: 2, y: 1, p: 0.25 });
});

test('flood fill', () => {
  // 4x3: a vertical wall of black at x=2 splits white into left (2 wide) and right (1 wide)
  const W = 4, H = 3, data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) data.set([0, 0, 0, 255], (y * W + 2) * 4);
  const res = floodMask(data, W, H, 0, 0, 0);
  assert.deepEqual([...res.mask], [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(res.bounds, { x: 0, y: 0, w: 2, h: 3 });
  assert.equal(floodMask(data, W, H, 9, 0, 0), null);
  const grown = growMask(res.mask, W, H, 1, res.bounds);
  assert.deepEqual([...grown.mask], [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0], 'grows one pixel into the wall');
  assert.deepEqual(grown.bounds, { x: 0, y: 0, w: 3, h: 3 });
  const transparent = new Uint8ClampedArray(2 * 4);
  transparent.set([255, 0, 0, 0], 4);  // a different RGB but fully transparent still counts as empty
  assert.deepEqual([...floodMask(transparent, 2, 1, 0, 0, 0).mask], [1, 1]);
});

test('history: undo, redo, limits', () => {
  const log = [];
  const h = new History({ maxSteps: 2 });
  const e = n => ({ label: n, bytes: 10, undo: () => log.push('u' + n), redo: () => log.push('r' + n) });
  h.push(e(1)); h.push(e(2)); h.push(e(3));
  assert.equal(h.done.length, 2, 'oldest dropped');
  h.undo(); h.undo();
  assert.equal(h.undo(), null);
  assert.deepEqual(log, ['u3', 'u2']);
  h.redo();
  h.push(e(4));
  assert.equal(h.canRedo, false, 'a new step clears redo');
  const b = new History({ maxBytes: 25 });
  b.push(e(1)); b.push(e(2)); b.push(e(3));
  assert.equal(b.done.length, 2, '30 bytes > 25, so one is dropped');
});

test('keys', () => {
  assert.ok(isReloadKey({ key: 'F5' }));
  assert.ok(isReloadKey({ key: 'r', ctrlKey: true }));
  assert.ok(isReloadKey({ key: 'R', ctrlKey: true, shiftKey: true }));
  assert.ok(!isReloadKey({ key: 'r' }));
  assert.equal(comboOf({ key: 'Z', ctrlKey: true, shiftKey: true }), 'ctrl+shift+z');
  assert.equal(comboOf({ key: '+', ctrlKey: true, shiftKey: true }), 'ctrl+=');
  assert.equal(comboOf({ key: ' ' }), 'space');
  assert.equal(comboOf({ key: '{', shiftKey: true }), '{');
  assert.ok(isTyping({ tagName: 'INPUT', type: 'text' }));
  assert.ok(!isTyping({ tagName: 'INPUT', type: 'range' }));
});

test('rects', () => {
  assert.deepEqual(union({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 1, w: 1, h: 4 }), { x: 0, y: 0, w: 6, h: 5 });
  assert.deepEqual(union(null, { x: 1, y: 1, w: 1, h: 1 }), { x: 1, y: 1, w: 1, h: 1 });
  assert.deepEqual(clip({ x: -3, y: 2, w: 10, h: 10 }, 5, 8), { x: 0, y: 2, w: 5, h: 6 });
  assert.equal(clip({ x: 10, y: 0, w: 2, h: 2 }, 5, 5), null);
});

test('view transform round-trips and keeps the anchor point still', () => {
  let v = newView();
  v = zoomAt(v, 3, 100, 50);
  v = rotateAt(v, 0.7, 40, 60);
  v = flipAt(v, 10, 20);
  const s = toScreen(v, 123, 45), d = toDoc(v, s.x, s.y);
  near(d.x, 123, 1e-9); near(d.y, 45, 1e-9);
  const before = toDoc(v, 200, 150);
  const after = toDoc(zoomAt(v, 2, 200, 150), 200, 150);
  near(before.x, after.x, 1e-9); near(before.y, after.y, 1e-9);
  const f = fitView(1000, 500, 600, 400, 50);
  assert.equal(f.zoom, 0.5, 'min((600-100)/1000, (400-100)/500) = .5');
  assert.deepEqual([f.panX, f.panY], [50, 75], 'centred: (600-500)/2, (400-250)/2');
});

test('tool settings', () => {
  const s = sanitizeSettings({ pen: { size: 5000, opacity: 'x', pressureSize: 0, bogus: 1 }, fill: { tolerance: -4 } });
  assert.equal(s.pen.size, 1000, 'clamped to max');
  assert.equal(s.pen.opacity, 1, 'invalid keeps default');
  assert.equal(s.pen.pressureSize, false);
  assert.ok(!('bogus' in s.pen));
  assert.equal(s.fill.tolerance, 0);
  assert.deepEqual(Object.keys(s), TOOLS.map(t => t.id));
  assert.ok(TOOLS.every(t => t.key && t.key.length === 1), 'every tool has a one-letter key');
  assert.equal(nextSize(5, 1), 6);
  assert.equal(nextSize(50, -1), 45);
  assert.equal(nextSize(1, -1), 1);
});

test('document format sanitizing', () => {
  const d = sanitizeDoc({ width: 99999, height: '300', paper: 'red', layers: [{ opacity: 3, blend: 'nope' }, { name: 'B', visible: false }], active: 9 });
  assert.equal(d.width, 10000);
  assert.equal(d.height, 300);
  assert.equal(d.paper, '#ffffff');
  assert.equal(d.layers[0].opacity, 1);
  assert.equal(d.layers[0].blend, 'source-over');
  assert.equal(d.layers[0].name, 'Layer 1');
  assert.equal(d.layers[1].visible, false);
  assert.deepEqual(d.activePath, [1], 'a version 1 `active` index becomes a path');
  assert.equal(d.layers[0].type, 'layer');
  assert.equal(sanitizeDoc({ paper: null }).paper, null, 'transparent paper is kept');
  assert.equal(sanitizeDoc(null).format, 'koe');
});
