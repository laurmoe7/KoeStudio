// Pure-logic tests for the drawing core. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from '../web/js/color.js';
import { pressureCurve, stampFor, Smoother, StampPath, stampBounds } from '../web/js/brush.js';
import { floodMask, growMask } from '../web/js/fill.js';
import { History } from '../web/js/history.js';
import { isReloadKey, comboOf, isTyping, springBack } from '../web/js/keys.js';
import { union, clip, alphaBounds } from '../web/js/rect.js';
import { newView, toDoc, toScreen, zoomAt, rotateAt, flipAt, fitView, fitRectView, resizedView } from '../web/js/view.js';
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

test('growing a fill by two pixels makes a diamond and leaves the mask alone', () => {
  const m = new Uint8Array(25);
  m[12] = 1;  // the middle of 5 x 5
  const g = growMask(m, 5, 5, 2, { x: 2, y: 2, w: 1, h: 1 });
  assert.deepEqual([...g.mask], [
    0, 0, 1, 0, 0,
    0, 1, 1, 1, 0,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0]);
  assert.deepEqual(g.bounds, { x: 0, y: 0, w: 5, h: 5 });
  assert.equal(m.reduce((a, b) => a + b), 1, 'the input mask is unchanged');
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
  // the area grows from 600 x 400 to 900 x 400 (40 px margins): fitted at min(520/1000, 320/500) = .52 it is fitted
  // again at min(820/1000, 320/500) = .64, centred: ((900-640)/2, (400-320)/2)
  const g = resizedView(fitView(1000, 500, 600, 400), 1000, 500, 600, 400, 900, 400);
  near(g.zoom, 0.64, 1e-9); near(g.panX, 130, 1e-9); near(g.panY, 40, 1e-9);
  // zoomed in by the user: the same zoom, the middle of the area stays on the same doc point
  const z = { zoom: 2, rot: 0, flip: false, panX: -300, panY: -100 };
  const mid = toDoc(z, 300, 200), h = resizedView(z, 1000, 500, 600, 400, 500, 300);
  assert.deepEqual([h.zoom, h.panX, h.panY], [2, -350, -150], 'pan shifts by half the change: -100/2 each way');
  const mid2 = toDoc(h, 250, 150);
  near(mid2.x, mid.x, 1e-9); near(mid2.y, mid.y, 1e-9);
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
  const labels = sanitizeDoc({ layers: [{ label: 'blue' }, { label: 'pink' }, { type: 'folder', label: 'red' }, {}] }).layers.map(l => l.label);
  assert.deepEqual(labels, ['blue', null, 'red', null], 'colour labels: only known ones are kept');
  const drafts = sanitizeDoc({ layers: [{ draft: true }, { draft: 'yes' }, { type: 'folder', draft: true }, {}] }).layers.map(l => l.draft);
  assert.deepEqual(drafts, [true, false, true, false], 'draft layers: only true counts; older files have none');
});

test('Smoother.distanceTo shrinks to the pen: a strength-20 stroke catches up in 67 steps, not 12', () => {
  const sm = new Smoother(20);  // k = 1/13: each step closes 1/13 of the gap
  assert.equal(sm.distanceTo({ x: 0, y: 0 }), Infinity);
  sm.add({ x: 0, y: 0, p: 1 });
  sm.add({ x: 100, y: 0, p: 1 });
  near(sm.distanceTo({ x: 100, y: 0 }), 100 * 12 / 13, 1e-9);  // 92.31 px still behind
  let steps = 1;
  while (sm.distanceTo({ x: 100, y: 0 }) > 0.5) { sm.add({ x: 100, y: 0, p: 1 }); steps++; }
  // 100 * (12/13)^n <= 0.5  first holds at n = ceil(ln 200 / ln(13/12)) = 67
  assert.equal(steps, 67);
  near(new Smoother(0).add({ x: 5, y: 5, p: 1 }).x, 5);
});

test('history jumps to any step', () => {
  const h = new History();
  let v = 0, notices = 0;
  const step = n => h.push({ label: 'set ' + n, undo: () => { v = n - 1; }, redo: () => { v = n; } });
  for (let n = 1; n <= 4; n++) { v = n; step(n); }
  h.onChange = () => notices++;
  h.goTo(1);
  assert.equal(v, 1);
  assert.deepEqual(h.steps, { labels: ['set 1', 'set 2', 'set 3', 'set 4'], done: 1 }, 'undone steps stay listed, in order');
  h.goTo(3);
  assert.equal(v, 3);
  assert.equal(notices, 2, 'one notice per jump');
  h.goTo(0);
  assert.equal(v, 0);
  h.goTo(99);
  assert.equal(v, 4, 'past the end stops at the newest step');
});

test('vector layers in the save format', () => {
  const d = sanitizeDoc({ layers: [{ name: 'Lines', vector: { brushes: [{ size: 3 }], strokes: [{ pts: [[1, 2, 0.5], [3, 4, 1]], b: 0, color: '#FF0000', opacity: 0.5, seed: 9 }] } }, { name: 'Plain' }] });
  assert.deepEqual(d.layers[0].vector.strokes, [{ pts: [[1, 2, 0.5], [3, 4, 1]], b: 0, color: '#ff0000', opacity: 0.5, seed: 9 }]);
  assert.equal(d.layers[0].vector.brushes[0].size, 3);
  assert.equal('vector' in d.layers[1], false, 'ordinary layers have none');
});

test('fill closes small gaps in line art', async () => {
  const { closeGapFill } = await import('../web/js/fill.js');
  // a 30x30 clear picture with a black square outline from (5,5) to (24,24), open for 3 px at the top (x 14-16)
  const W = 30, data = new Uint8ClampedArray(W * W * 4);
  const ink = (x, y) => { data[(y * W + x) * 4 + 3] = 255; };
  for (let i = 5; i <= 24; i++) { if (i < 14 || i > 16) ink(i, 5); ink(i, 24); ink(5, i); ink(24, i); }
  const at = (m, x, y) => m.mask[y * W + x];
  const leaky = closeGapFill(data, W, W, 15, 15, 0, 0);
  assert.equal(at(leaky, 0, 0), 1, 'without closing, the fill runs out through the opening');
  const shut = closeGapFill(data, W, W, 15, 15, 0, 2);
  assert.equal(at(shut, 0, 0), 0, 'a 3 px opening closes with a 2 px gap setting');
  assert.equal(at(shut, 15, 15), 1);
  assert.equal(at(shut, 6, 6), 1, 'grown back into the corner up to the lines');
  assert.equal(at(shut, 5, 10), 0, 'the lines themselves stay unfilled');
  assert.ok(shut.bounds.y >= 3 && shut.bounds.x >= 6, 'at most a small bulge past the opening: ' + JSON.stringify(shut.bounds));
  const near = closeGapFill(data, W, W, 6, 6, 0, 2);
  assert.equal(at(near, 0, 0), 1, 'clicking next to a line falls back to the ordinary fill');
  // the same square inside a bigger picture, 40 px right and 25 down, with a closed box elsewhere: it is worked
  // out around the leaky fill only, and lands in the same place
  const BW = 120, BH = 90, big = new Uint8ClampedArray(BW * BH * 4);
  for (let y = 0; y < W; y++) big.set(data.subarray(y * W * 4, (y + 1) * W * 4), ((y + 25) * BW + 40) * 4);
  for (let i = 0; i <= 10; i++) for (const [x, y] of [[90 + i, 60], [90 + i, 70], [90, 60 + i], [100, 60 + i]]) big[(y * BW + x) * 4 + 3] = 255;
  const moved = closeGapFill(big, BW, BH, 55, 40, 0, 2);
  assert.deepEqual(moved.bounds, { ...shut.bounds, x: shut.bounds.x + 40, y: shut.bounds.y + 25 });
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const inSmall = x >= 40 && x < 70 && y >= 25 && y < 55 ? shut.mask[(y - 25) * W + x - 40] : 0;
    if (moved.mask[y * BW + x] !== inSmall) assert.fail(`pixel ${x}, ${y} differs`);
  }
});

test('colour palette', async () => {
  const { paletteAdd, sanitizePalette, PALETTE_MAX } = await import('../web/js/color.js');
  assert.deepEqual(paletteAdd(['#111111', '#222222'], '#111111'), ['#222222', '#111111'], 'an existing colour moves to the end');
  assert.deepEqual(paletteAdd([], '#ABCDEF'), ['#abcdef'], 'stored in lower case');
  assert.equal(paletteAdd(Array.from({ length: PALETTE_MAX }, (_, i) => '#' + String(i).padStart(6, '0')), '#ffffff').length, PALETTE_MAX, 'the oldest drops off');
  assert.deepEqual(sanitizePalette(['#FFFFFF', 'red', '#ffffff', 5, '#000000']), ['#ffffff', '#000000']);
  assert.deepEqual(sanitizePalette(null), []);
});

test('distort: a homography puts the source corners on the quad', async () => {
  const { homography, project, invertHomography, quadHit, quadBounds, warpImage } = await import('../web/js/transform.js');
  const quad = [{ x: 10, y: 20 }, { x: 110, y: 10 }, { x: 130, y: 90 }, { x: 0, y: 120 }];
  const m = homography(50, 40, quad);
  [[0, 0], [50, 0], [50, 40], [0, 40]].forEach(([u, v], i) => {
    const p = project(m, u, v);
    assert.ok(Math.abs(p.x - quad[i].x) < 1e-9 && Math.abs(p.y - quad[i].y) < 1e-9, `corner ${i}`);
  });
  const back = project(invertHomography(m), ...Object.values(project(m, 17, 23)));
  assert.ok(Math.abs(back.x - 17) < 1e-9 && Math.abs(back.y - 23) < 1e-9, 'the inverse takes it back');
  // a plain rectangle twice the size is just a scale
  assert.deepEqual(homography(10, 10, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]), [2, 0, 0, 0, 2, 0, 0, 0]);
  assert.equal(homography(10, 10, [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 15, y: 15 }]), null, 'folded flat');
  assert.equal(quadHit(quad, { x: 108, y: 12 }, 5), 1);
  assert.equal(quadHit(quad, { x: 60, y: 60 }, 5), 'move');
  assert.equal(quadHit(quad, { x: 200, y: 60 }, 5), null);
  assert.deepEqual(quadBounds(quad), { x: 0, y: 10, w: 130, h: 110 });
  // nearest-pixel warp of a 2 x 1 image (red, blue) onto a 4 x 2 rectangle: each source pixel covers 2 x 2
  const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  const out = warpImage(src, 2, 1, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], new Uint8ClampedArray(4 * 2 * 4), 0, 0, 4, 2, false);
  assert.deepEqual([...out.slice(0, 16)], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const smooth = warpImage(src, 2, 1, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }], new Uint8ClampedArray(8), 0, 0, 2, 1, true);
  assert.deepEqual([...smooth], [255, 0, 0, 255, 0, 0, 255, 255], 'unchanged size: the same pixels');
});

test('two-finger pinch: zoom, turn and pan about the fingers', async () => {
  const { pinchView, newView, toScreen, toDoc } = await import('../web/js/view.js');
  const v = { ...newView(), zoom: 2, panX: 10, panY: 20 };
  const a0 = { x: 100, y: 100 }, b0 = { x: 200, y: 100 };
  // fingers spread to twice the distance, centred on the same point: zoom doubles, the middle stays put
  const z = pinchView(v, a0, b0, { x: 50, y: 100 }, { x: 250, y: 100 });
  assert.equal(z.zoom, 4);
  const mid = toDoc(v, 150, 100), s = toScreen(z, mid.x, mid.y);
  assert.ok(Math.abs(s.x - 150) < 1e-9 && Math.abs(s.y - 100) < 1e-9, 'the point between the fingers stays under them');
  // both fingers move 30 px right: a pan only
  const p = pinchView(v, a0, b0, { x: 130, y: 100 }, { x: 230, y: 100 });
  assert.deepEqual([p.zoom, p.rot, p.panX, p.panY], [2, 0, 40, 20]);
  // a quarter turn, with a 0.1 rad dead zone taken off
  const t = pinchView(v, a0, b0, { x: 150, y: 50 }, { x: 150, y: 150 }, 0.1);
  assert.ok(Math.abs(t.rot - (Math.PI / 2 - 0.1)) < 1e-9);
  assert.equal(pinchView(v, a0, b0, { x: 100, y: 100 }, { x: 200, y: 105 }, 0.1).rot, 0, 'a small twist inside the dead zone does not turn');
});

test('the rect round the painted pixels', () => {
  // 4 x 3, alpha at (2, 0) and (1, 2): x 1-2, y 0-2
  const px = new Uint8ClampedArray(4 * 3 * 4);
  px[(0 * 4 + 2) * 4 + 3] = 9;
  px[(2 * 4 + 1) * 4 + 3] = 255;
  px[(1 * 4 + 3) * 4] = 255;  // red with no alpha does not count
  assert.deepEqual(alphaBounds(px, 4, 3), { x: 1, y: 0, w: 2, h: 3 });
  assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
});

test('a held tool key springs back to the tool before', () => {
  assert.equal(springBack(120, false), false, 'a tap switches tools for good');
  assert.equal(springBack(120, true), true, 'drawing while holding it: back on release');
  assert.equal(springBack(800, false), true, 'held a while: back on release');
});

test('fitting a rectangle of the canvas into the view', () => {
  // 100 x 50 at (200, 100) in a 600 x 400 view, margin 50: zoom min(500/100, 300/50) = 5, centre (250, 125) -> (300, 200)
  const v = fitRectView(newView(), { x: 200, y: 100, w: 100, h: 50 }, 600, 400, 50);
  assert.equal(v.zoom, 5);
  const c = toScreen(v, 250, 125);
  assert.ok(Math.abs(c.x - 300) < 1e-9 && Math.abs(c.y - 200) < 1e-9);
  // turned a quarter: the rectangle stands up (50 wide, 100 tall): zoom min(500/50, 300/100) = 3
  const t = fitRectView({ ...newView(), rot: Math.PI / 2 }, { x: 200, y: 100, w: 100, h: 50 }, 600, 400, 50);
  assert.ok(Math.abs(t.zoom - 3) < 1e-9);
  assert.equal(t.rot, Math.PI / 2);
  const d = toScreen(t, 250, 125);
  assert.ok(Math.abs(d.x - 300) < 1e-9 && Math.abs(d.y - 200) < 1e-9);
});
