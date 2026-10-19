// The shortcut strip's settings, buttons and hold tracking. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRIP_BUTTONS, HoldTracker, sanitizeStrip, stripShown } from '../web/js/strip.js';
import { icon } from '../web/js/icons.js';

test('strip settings', () => {
  assert.deepEqual(sanitizeStrip(undefined), { on: null, side: 'right', collapsed: false }, 'nothing stored: not chosen, on the right');
  assert.deepEqual(sanitizeStrip({ on: false, side: 'left', collapsed: true }), { on: false, side: 'left', collapsed: true });
  assert.deepEqual(sanitizeStrip({ on: 'yes', side: 'top', collapsed: 1 }), { on: null, side: 'right', collapsed: false }, 'odd values fall back');
  assert.deepEqual(sanitizeStrip('junk'), { on: null, side: 'right', collapsed: false });
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
