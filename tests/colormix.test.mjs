// The Color panel's mixing strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mixSteps, rgbToOklab, oklabToRgb } from '../web/js/color.js';

test('mixing steps are even to the eye (OKLab)', () => {
  const steps = mixSteps('#000000', '#ffffff', 3);
  assert.equal(steps[0], '#000000');
  assert.equal(steps[2], '#ffffff');
  // OKLab L = 0.5 is linear light 0.125, which sRGB encodes as 1.055 x 0.125^(1/2.4) - 0.055 = 0.3885 -> 99
  assert.equal(steps[1], '#636363');
  assert.deepEqual(oklabToRgb(rgbToOklab([200, 30, 90])), [200, 30, 90], 'there and back');
  assert.equal(mixSteps('#ff0000', '#0000ff', 9).length, 9);
});
