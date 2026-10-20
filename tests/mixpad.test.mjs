// Color mixing pad: the scratch area of the Color mixing panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newPad, clearPad, padPixel, paintDab, pickColor, PadStroke } from '../web/js/mixpad.js';

const RED = { r: 255, g: 0, b: 0 }, BLUE = { r: 0, g: 0, b: 255 };
const near = (got, want, msg) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= 1, `${msg}: [${got}] != [${want}]`));
const fill = (pad, [r, g, b, a], x1 = pad.w) => {
  for (let y = 0; y < pad.h; y++) for (let x = 0; x < x1; x++) pad.data.set([r, g, b, a], (y * pad.w + x) * 4);
};

test('a new pad is clear, and clear empties it again', () => {
  const pad = newPad(4, 3);
  assert.equal(pad.data.length, 4 * 3 * 4);
  assert.ok(pad.data.every(v => v === 0));
  fill(pad, [1, 2, 3, 4]);
  clearPad(pad);
  assert.ok(pad.data.every(v => v === 0));
  assert.deepEqual(padPixel(pad, -1, 0), [0, 0, 0, 0], 'outside is clear');
});

test('a full, hard dab covers its circle and nothing else', () => {
  const pad = newPad(12, 12);
  paintDab(pad, 5, 5, 4, RED, 1, 1);
  assert.deepEqual(padPixel(pad, 5, 5), [255, 0, 0, 255]);
  assert.deepEqual(padPixel(pad, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(padPixel(pad, 10, 5), [0, 0, 0, 0]);
});

test('a half-strength dab lies over the paint under it', () => {
  const pad = newPad(10, 10);
  fill(pad, [0, 0, 255, 255]);
  paintDab(pad, 5, 5, 20, RED, 0.5, 1);
  near(padPixel(pad, 5, 5), [127.5, 0, 127.5, 255], 'half red over blue');
});

test('picking sees the paint over white paper', () => {
  const pad = newPad(10, 10);
  assert.deepEqual(pickColor(pad, 5, 5), { r: 255, g: 255, b: 255 }, 'bare paper is white');
  fill(pad, [255, 0, 0, 255]);
  assert.deepEqual(pickColor(pad, 5, 5), { r: 255, g: 0, b: 0 });
  fill(pad, [255, 0, 0, 51]);  // a fifth covered
  const c = pickColor(pad, 5, 5);
  near([c.r, c.g, c.b], [255, 204, 204], 'a fifth of red over white');
});

test('the brush paints its own colour on bare paper', () => {
  const pad = newPad(40, 40);
  new PadStroke(pad, { color: BLUE, size: 16 }).add(20, 20);
  near(padPixel(pad, 20, 20), [0, 0, 255, 127.5], 'blue at the flow');
});

test('the brush mixes with the paint under it', () => {
  const pad = newPad(40, 40);
  fill(pad, [255, 0, 0, 255]);
  new PadStroke(pad, { color: BLUE, size: 16 }).add(20, 20);
  // paint = blue + (red - blue) × 0.55 = (140.25, 0, 114.75), laid at half strength over red
  near(padPixel(pad, 20, 20), [197.625, 0, 57.375, 255], 'blue mixed into red');
});

test('dabs are a sixth of the brush apart', () => {
  const pad = newPad(60, 20), s = new PadStroke(pad, { color: RED, size: 12 });
  let n = 0;
  const dab = s.dab.bind(s);
  s.dab = (...a) => { n++; dab(...a); };
  s.add(10, 10);
  s.add(40, 10);
  assert.equal(n, 1 + 30 / 2);
});

test('pressure makes the brush smaller', () => {
  const s = new PadStroke(newPad(), { size: 20 });
  assert.equal(s.sizeAt(1), 20);
  assert.equal(s.sizeAt(0), 6);
  assert.ok(Math.abs(s.sizeAt(0.5) - 13) < 1e-9);
});

test('the blender picks paint up at first and drags it along', () => {
  const pad = newPad(48, 12);
  fill(pad, [255, 0, 0, 255], 20);  // red on the left, bare paper on the right
  const s = new PadStroke(pad, { mode: 'blend', size: 8 });
  s.add(10, 6);
  assert.deepEqual(padPixel(pad, 24, 6), [0, 0, 0, 0], 'the first touch changes nothing');
  for (let x = 12; x <= 36; x += 2) s.add(x, 6);
  const p = padPixel(pad, 26, 6);
  assert.ok(p[3] > 0 && p[0] === 255 && p[1] === 0, `red dragged onto the paper: ${p}`);
  assert.deepEqual(padPixel(pad, 26, 0), [0, 0, 0, 0], 'beyond the tip nothing moves');
});
