// Texture modes: the formulas worked out by hand, each next to what CLIP STUDIO PAINT measured for it (single dabs on
// its Rough textured paper; the measured value is the average over texture values within 0.05 of s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { textureMode, applyTextureMode, textureValueAt, TEXTURE_MODES, CSP_TEXTURE_MODES } from '../web/js/texmodes.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} is not ${b}`);

test('texture modes at full texture density (t = s)', () => {
  near(textureMode('multiply', 0.5, 0.9, 1), 0.45, 'Multiply: a s (measured 0.442)');
  near(textureMode('subtract', 0.75, 0.5, 1), 0.25, 'Subtract: a - (1 - s) (measured 0.249)');
  near(textureMode('subtract', 0.25, 0.5, 1), 0, 'Subtract: none where the groove is deeper than the paint');
  near(textureMode('compare', 0.5, 0.2, 1), 0.2, 'Compare: min(a, s) (measured 0.218)');
  near(textureMode('compare', 0.5, 0.8, 1), 0.5, 'Compare: the paint where the texture is lighter (0.498)');
  near(textureMode('normal', 0.25, 0.9, 1), 0.35, 'Normal: a (s + 1/2) (measured 0.346)');
  near(textureMode('normal', 1, 0.7, 1), 1, 'Normal: capped (measured 1.000)');
  near(textureMode('overlay', 0.25, 0.9, 1), 0.45, 'Overlay below half: 2 a s (measured 0.444)');
  near(textureMode('overlay', 0.75, 0.2, 1), 0.6, 'Overlay above half: 1 - 2 (1 - a)(1 - s) (measured 0.612)');
  near(textureMode('dodge', 0.25, 0.5, 1), 0.5, 'Color dodge: a / (1 - s) (measured 0.503)');
  near(textureMode('dodge', 0.5, 0.6, 1), 1, 'Color dodge: capped (measured 1.000)');
  near(textureMode('burn', 0.5, 0.9, 1), 1 - 0.5 / 0.9, 'Color burn: 1 - (1 - a) / s (measured 0.438)');
  near(textureMode('burn', 0.25, 0.5, 1), 0, 'Color burn: none (measured 0.000)');
  near(textureMode('hardmix', 0.25, 0.9, 1), 0.4, 'Hard mix: 2a + s - 1 (measured 0.381)');
  near(textureMode('outline', 0.75, 0.2, 1), 0.7, 'Outline: 2a + s - 1 at full density (measured 0.721)');
  near(textureMode('height', 0.25, 0.5, 1), 1, 'Height: 10 a - s, full (measured 1.000)');
});

test('texture density fades the texture towards white (t = 1 - D (1 - s))', () => {
  // D 0.5, s 0.2: t = 0.6; s 0.9: t = 0.95
  near(textureMode('multiply', 0.5, 0.2, 0.5), 0.3, 'Multiply (measured 0.305)');
  near(textureMode('subtract', 0.5, 0.2, 0.5), 0.1, 'Subtract (measured 0.108)');
  near(textureMode('compare', 0.75, 0.2, 0.5), 0.6, 'Compare (measured 0.610)');
  near(textureMode('normal', 0.5, 0.9, 0.5), 0.725, 'Normal: 0.5 x 1.45 (measured 0.723)');
  near(textureMode('overlay', 0.25, 0.2, 0.5), 0.3, 'Overlay: 2 x 0.25 x 0.6 (measured 0.304)');
  near(textureMode('dodge', 0.25, 0.2, 0.5), 0.625, 'Color dodge: 0.25 / 0.4 (measured 0.641)');
  near(textureMode('burn', 0.75, 0.2, 0.5), 1 - 0.25 / 0.6, 'Color burn (measured 0.591)');
  near(textureMode('hardmix', 0.5, 0.2, 0.5), 0.6, 'Hard mix: 1 + 0.6 - 1 (measured 0.609)');
  // Outline: (1 + D) a + t - 1 = 1.5 x 0.5 + 0.75 - 1 at s 0.5
  near(textureMode('outline', 0.5, 0.5, 0.5), 0.5, 'Outline (measured 0.501)');
  near(textureMode('outline', 0.25, 0.9, 0.5), 0.325, 'Outline: 0.375 + 0.95 - 1 (measured 0.320)');
  // Height: 10 a D - s
  near(textureMode('height', 0.25, 0.5, 0.5), 0.75, 'Height: 1.25 - 0.5 (measured 0.751)');
  near(textureMode('height', 0.1, 0.3, 0.4), 0.1, 'Height: 0.4 - 0.3 (measured 0.095)');
  near(textureMode('height', 0.15, 0.6, 0.75), 0.525, 'Height: 1.125 - 0.6 (measured 0.528)');
  near(textureMode('height', 0.1, 0.5, 0.25), 0, 'Height: 0.25 - 0.5, none (measured 0.000)');
});

test('no paint stays no paint, and the lists line up', () => {
  for (const [m] of TEXTURE_MODES) for (const s of [0, 0.5, 1]) assert.equal(textureMode(m, 0, s, 1), 0, `${m} at s ${s}`);
  assert.equal(CSP_TEXTURE_MODES.length, 10);
  assert.deepEqual([...CSP_TEXTURE_MODES].sort(), TEXTURE_MODES.map(m => m[0]).sort(), 'every CLIP STUDIO mode has a KoeStudio mode');
  assert.equal(CSP_TEXTURE_MODES[9], 'height', 'Greasil Mk2 is 9: Height');
});

test('applyTextureMode works on RGBA pixels and keeps the colour', () => {
  // two pixels: red at alpha 128 over texture 51 (0.2), and an empty one
  const data = new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 0, 0]);
  applyTextureMode(data, 'multiply', 1, i => [51, 255][i]);
  assert.deepEqual([...data], [255, 0, 0, Math.round(255 * (128 / 255) * 0.2), 0, 0, 0, 0]);
  // strength 0 turns the texture off (D 0: t = 1), so Multiply leaves the paint as it was
  const d2 = new Uint8ClampedArray([0, 0, 0, 200]);
  applyTextureMode(d2, 'multiply', 1, () => 0, () => 0);
  assert.equal(d2[3], 200);
});

test('the texture turned by Grain angle, round the canvas origin', async () => {
  const { turnOf } = await import('../web/js/painter.js');
  // a 4 x 4 tile whose texel (x, y) holds 4y + x
  const v = { gray: Uint8Array.from({ length: 16 }, (_, i) => i), w: 4, h: 4, scale: 1 };
  assert.equal(textureValueAt(v, 1, 2), 9, 'not turned: texel (1, 2)');
  assert.deepEqual(turnOf(0), {}, 'no angle: nothing to turn');
  assert.deepEqual(turnOf(90), { cos: 0, sin: 1 }, 'right angles exact');
  // turned 90 degrees clockwise (y down): texel (1, 2) moves to (-2, 1), and (2, 1) is the tile one width on
  assert.equal(textureValueAt({ ...v, ...turnOf(90) }, -2, 1), 9);
  assert.equal(textureValueAt({ ...v, ...turnOf(90) }, 2, 1), 9, 'the tile repeats');
  // 180: texel (1, 2) at (-1, -2), which is (3, 2) a tile on
  assert.equal(textureValueAt({ ...v, ...turnOf(180) }, 3, 2), 9);
  assert.equal(textureValueAt({ ...v, ...turnOf(360) }, 1, 2), 9, '360 is not turned');
  // with scale 2 the texel covers 2 x 2 doc pixels: turned 90, texel (1, 2) covers x -6..-4, y 2..4
  assert.equal(textureValueAt({ ...v, scale: 2, ...turnOf(90) }, -4.5, 2.5), 9);
});
