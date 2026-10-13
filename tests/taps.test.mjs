import test from 'node:test';
import assert from 'node:assert/strict';
import { isDoubleTap, DOUBLE_TAP_MS } from '../web/js/taps.js';

test('a second tap on the same thing within the limit is a double tap', () => {
  const a = {}, b = {};
  assert.equal(isDoubleTap(null, a, 1000), false);
  assert.equal(isDoubleTap({ key: a, time: 1000 }, a, 1000 + DOUBLE_TAP_MS), true);
  assert.equal(isDoubleTap({ key: a, time: 1000 }, a, 1000 + DOUBLE_TAP_MS + 1), false);
  assert.equal(isDoubleTap({ key: a, time: 1000 }, b, 1100), false);  // another row
  assert.equal(isDoubleTap({ key: a, time: 1000 }, a, 900), false);   // clock went backwards
});
