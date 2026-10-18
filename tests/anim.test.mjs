// Frame-by-frame animation (anim.js) and the animated GIF encoder. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnim, defaultAnim, animFrames, frameOf, onionSkins, frameDelays, nextFrame } from '../web/js/anim.js';
import { encodeGifAnimation } from '../web/js/imageformats.js';
import { sanitizeDoc } from '../web/js/doc.js';

const node = (name, visible = true) => ({ name, visible });

test('animation settings are cleaned up', () => {
  assert.deepEqual(sanitizeAnim(null), defaultAnim());
  const a = sanitizeAnim({ fps: 100, before: -2, after: 9, onionOpacity: 3, on: 'yes', loop: false });
  assert.deepEqual([a.fps, a.before, a.after, a.onionOpacity, a.on, a.loop], [60, 0, 5, 1, false, false], 'clamped; only true/false count');
  assert.equal(sanitizeAnim({ fps: 12.4 }).fps, 12);
  assert.equal(sanitizeDoc({}).anim.on, false, 'older files have no animation');
  assert.equal(sanitizeDoc({ anim: { on: true, fps: 24 } }).anim.fps, 24);
});

test('frames, background and foreground', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(n => node(n));
  const on = { bg: true, fg: true };
  assert.deepEqual(animFrames([a, b, c, d], on), { frames: [b, c], bg: a, fg: d });
  assert.deepEqual(animFrames([a, b, c, d], {}).frames, [a, b, c, d], 'no holds: every node is a frame');
  const hidden = node('h', false);
  assert.deepEqual(animFrames([a, hidden, c], {}).frames, [a, c], 'hidden nodes are left out');
  assert.deepEqual(animFrames([a, b], on), { frames: [b], bg: a, fg: null }, 'the foreground never takes the last frame');
  assert.deepEqual(animFrames([a], on), { frames: [a], bg: null, fg: null });
  const root = { parent: null }, folder = { parent: root }, layer = { parent: folder };
  assert.equal(frameOf(layer), folder, 'a layer in a folder belongs to the folder frame');
  assert.equal(frameOf(folder), folder);
});

test('onion skins', () => {
  const base = { onion: true, before: 2, after: 1, onionOpacity: 0.4, loop: false };
  assert.deepEqual(onionSkins(0, 5, base), [{ index: 1, side: 'after', alpha: 0.4 }], 'nothing before the first frame');
  assert.deepEqual(onionSkins(0, 5, { ...base, loop: true }), [
    { index: 4, side: 'before', alpha: 0.4 }, { index: 3, side: 'before', alpha: 0.2 }, { index: 1, side: 'after', alpha: 0.4 }],
  'looping wraps round; the second frame back is fainter');
  assert.deepEqual(onionSkins(0, 2, { ...base, before: 1, loop: true }), [{ index: 1, side: 'before', alpha: 0.4 }],
    'two frames: the other one is shown once');
  assert.deepEqual(onionSkins(2, 5, { ...base, onion: false }), [], 'off');
  assert.deepEqual(onionSkins(0, 1, base), [], 'one frame has no neighbours');
});

test('frame timing and playback order', () => {
  assert.deepEqual(frameDelays(12, 6), [8, 9, 8, 8, 9, 8], '100 / 12 = 8.33 hundredths, rounding carried');
  assert.equal(frameDelays(12, 12).reduce((s, x) => s + x, 0), 100, 'a second of frames lasts a second');
  assert.deepEqual(frameDelays(10, 3), [10, 10, 10]);
  assert.deepEqual(frameDelays(60, 3), [2, 2, 2], 'never under 2 (browsers would play those slowly)');
  assert.equal(nextFrame(0, 3, false), 1);
  assert.equal(nextFrame(2, 3, true), 0, 'loops round');
  assert.equal(nextFrame(2, 3, false), null, 'or stops at the end');
  assert.equal(nextFrame(0, 0, true), null);
});

test('animated GIF', () => {
  const red = new Uint8ClampedArray([255, 0, 0, 255]), clear = new Uint8ClampedArray([0, 0, 0, 0]);
  const gif = encodeGifAnimation([red, clear], 1, 1, [10, 25], true);
  const ascii = (i, n) => String.fromCharCode(...gif.subarray(i, i + n));
  assert.equal(ascii(0, 6), 'GIF89a');
  assert.equal(gif[10] & 0x80, 0, 'no global colour table');
  assert.equal(ascii(16, 11), 'NETSCAPE2.0', 'loops');
  assert.deepEqual([...gif.subarray(28, 31)], [1, 0, 0], 'forever');
  const controls = [];
  for (let i = 0; i < gif.length - 7; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) controls.push(gif.subarray(i + 3, i + 7));
  assert.equal(controls.length, 2, 'one graphic control block per frame');
  assert.equal(controls[0][1] | controls[0][2] << 8, 10);
  assert.equal(controls[1][1] | controls[1][2] << 8, 25);
  assert.equal(controls[0][0], 2 << 2, 'opaque frame: cleared after, no transparency');
  assert.equal(controls[1][0], (2 << 2) | 1, 'the see-through frame has a transparent colour');
  assert.equal(gif[gif.length - 1], 0x3b, 'trailer');
  const once = encodeGifAnimation([red], 1, 1, [10], false);
  assert.ok(!String.fromCharCode(...once).includes('NETSCAPE'), 'no loop block when it plays once');
});
