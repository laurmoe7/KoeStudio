// The shortcut strip's settings, buttons and hold tracking. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRIP_BUTTONS, HoldTracker, sanitizeStrip, stripShown, floatSpot, FLOAT_MARGIN } from '../web/js/strip.js';
import { icon } from '../web/js/icons.js';

test('strip settings', () => {
  const plain = { x: null, y: null, flat: false };
  assert.deepEqual(sanitizeStrip(undefined), { on: null, side: 'right', collapsed: false, ...plain }, 'nothing stored: not chosen, on the right');
  assert.deepEqual(sanitizeStrip({ on: false, side: 'left', collapsed: true }), { on: false, side: 'left', collapsed: true, ...plain });
  assert.deepEqual(sanitizeStrip({ side: 'float', x: 40.6, y: 12, flat: true }), { on: null, side: 'float', collapsed: false, x: 41, y: 12, flat: true }, 'floating, with its spot rounded');
  assert.deepEqual([sanitizeStrip({ x: 'a', y: NaN }).x, sanitizeStrip({ x: 'a', y: NaN }).y], [null, null], 'no usable spot');
  assert.equal(sanitizeStrip({ side: 'bottom' }).side, 'bottom', 'under the canvas');
  assert.deepEqual(sanitizeStrip({ on: 'yes', side: 'top', collapsed: 1, flat: 1 }), { on: null, side: 'right', collapsed: false, ...plain }, 'odd values fall back');
  assert.deepEqual(sanitizeStrip('junk'), { on: null, side: 'right', collapsed: false, ...plain });
});

test('the strip shows as chosen, or once a pen or finger was used', () => {
  assert.equal(stripShown({ on: null }, false), false, 'off by default with only a mouse');
  assert.equal(stripShown({ on: null }, true), true, 'on once a pen or touch screen was used');
  assert.equal(stripShown({ on: false }, true), false, 'turned off stays off');
  assert.equal(stripShown({ on: true }, undefined), true, 'turned on stays on');
});

test('strip buttons', () => {
  const btns = STRIP_BUTTONS.filter(b => b !== '-');
  assert.deepEqual(btns.map(b => b.id), ['undo', 'redo', 'sizeDown', 'sizeUp', 'swap', 'pick', 'pan', 'fit']);
  assert.equal(new Set(btns.map(b => b.id)).size, btns.length, 'ids are unique');
  for (const b of btns) {
    assert.ok(b.label && b.key, `${b.id} has a label and a key`);
    assert.match(icon(b.icon), /<(path|circle|rect)/, `${b.id} has an icon`);
  }
  assert.deepEqual(btns.filter(b => b.hold).map(b => [b.id, b.hold]), [['pick', 'alt'], ['pan', 'space']], 'the hold buttons stand for Alt and Space');
});

test('hold buttons stay down while any finger is on them', () => {
  const h = new HoldTracker();
  assert.equal(h.press('space', 1), true, 'first finger: Space goes down');
  assert.equal(h.press('space', 2), false, 'second finger on it: already down');
  assert.equal(h.press('alt', 3), true, 'Alt is separate');
  assert.equal(h.release(1), null, 'one finger lifted, the other still holds Space');
  assert.equal(h.isHeld('space'), true);
  assert.equal(h.release(2), 'space', 'last finger lifted: Space comes up');
  assert.equal(h.release(2), null, 'a second pointerup for the same finger changes nothing');
  assert.equal(h.release(99), null, 'a finger that was never on a hold button');
  assert.deepEqual(h.clear(), ['alt'], 'letting go of everything reports what was held');
  assert.equal(h.isHeld('alt'), false);
  assert.deepEqual(h.clear(), []);
});

test('a floating strip stays inside the canvas area', () => {
  // a 60 x 480 strip in an 800 x 600 area
  assert.equal(FLOAT_MARGIN, 8);
  assert.deepEqual(floatSpot(null, null, 60, 480, 800, 600), { x: 732, y: 8 }, 'no spot yet: top right, 8 px in (800 - 60 - 8)');
  assert.deepEqual(floatSpot(100, 50, 60, 480, 800, 600), { x: 100, y: 50 }, 'inside: where it was put');
  assert.deepEqual(floatSpot(790, 300, 60, 480, 800, 600), { x: 740, y: 120 }, 'past the right and bottom: against them (800 - 60, 600 - 480)');
  assert.deepEqual(floatSpot(-30, -5, 60, 480, 800, 600), { x: 0, y: 0 }, 'past the left and top');
  assert.deepEqual(floatSpot(200, 100, 60, 480, 800, 400), { x: 200, y: 0 }, 'taller than the area: at the top');
  assert.deepEqual(floatSpot(10.4, 20.6, 60, 480, 800, 600), { x: 10, y: 21 }, 'whole pixels');
});
