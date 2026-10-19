// Screentone and brush texture logic. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTone, defaultTone, toneDensity, densityGray, applyTone, TONE_SHAPES, toneLpi, cellForLpi, toneFadeLine } from '../web/js/tone.js';
import { textureTile, valueNoise, hash01, grooveAlpha, canvasWeave, TEXTURES, TILE, WARP, WEFT } from '../web/js/textures.js';
import { sanitizeSettings } from '../web/js/tools.js';
import { sanitizeDoc } from '../web/js/doc.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg || ''} ${a} ≈ ${b}`);

/** w x h opaque pixels of one gray. */
function grayPixels(w, h, g, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g; data[i * 4 + 3] = a; }
  return data;
}
const meanAlpha = data => { let s = 0; for (let i = 3; i < data.length; i += 4) s += data[i]; return s / 255 / (data.length / 4); };

test('tone settings are cleaned', () => {
  assert.equal(sanitizeTone(null), null);
  assert.equal(sanitizeTone('dots'), null);
  assert.deepEqual(sanitizeTone({}), defaultTone());
  assert.deepEqual(sanitizeTone({ cell: 1, angle: 200, shape: 'star', color: '#FF0000' }), { cell: 2, angle: 90, shape: 'dot', color: '#ff0000' });
  assert.deepEqual(sanitizeTone({ cell: '12.34', angle: -30.4, shape: 'line', color: 'red' }), { cell: 12.3, angle: -30, shape: 'line', color: '#000000' });
});

test('tone density comes from darkness and opacity', () => {
  assert.equal(toneDensity(0, 0, 0, 255), 1);
  assert.equal(toneDensity(255, 255, 255, 255), 0);
  assert.equal(toneDensity(0, 0, 0, 0), 0);
  near(toneDensity(0, 0, 0, 51), 0.2, 1e-12, 'black at 20% opacity');
  near(toneDensity(51, 51, 51, 255), 0.8, 1e-12, 'gray 51 is 80% dark');
  assert.equal(densityGray(0), 255);
  assert.equal(densityGray(1), 0);
  assert.equal(densityGray(0.5), 128, '127.5 rounds up');
  assert.equal(densityGray(2), 0, 'clamped');
});

test('black, white and transparent pixels', () => {
  const tone = { cell: 8, angle: 45, shape: 'dot', color: '#102030' };
  const black = applyTone(grayPixels(16, 16, 0), 16, 16, 0, 0, tone);
  assert.equal(meanAlpha(black), 1, 'black is solid');
  assert.deepEqual([...black.slice(0, 4)], [16, 32, 48, 255], 'in the tone colour');
  assert.equal(meanAlpha(applyTone(grayPixels(16, 16, 255), 16, 16, 0, 0, tone)), 0, 'white has no dots');
  assert.equal(meanAlpha(applyTone(grayPixels(16, 16, 0, 0), 16, 16, 0, 0, tone)), 0, 'transparent has no dots');
});

test('dots cover as much of the area as the density says', () => {
  for (const [shape] of TONE_SHAPES) {
    for (const angle of [0, 45, 15]) {
      for (const d of [0.25, 0.5, 0.75]) {
        const n = 160, data = grayPixels(n, n, 255 * (1 - d));
        applyTone(data, n, n, 0, 0, { cell: 8, angle, shape });
        near(meanAlpha(data), d, 0.035, `${shape} at ${angle}°, density ${d}:`);
      }
    }
  }
});

test('round dots sit in the middle of each cell', () => {
  // 50% gray, cell 8, angle 0: pixel (4, 4) is at cell position (0.0625, 0.0625), near the centre: covered.
  // Pixel (0, 0) is at (-0.4375, -0.4375), near the corner, where the cell is lightest: not covered.
  const data = applyTone(grayPixels(8, 8, 127.5), 8, 8, 0, 0, { cell: 8, angle: 0, shape: 'dot' });
  assert.equal(data[(4 * 8 + 4) * 4 + 3], 255);
  assert.equal(data[3], 0);
});

test('lines at 50% fill the middle half of each 8 px band', () => {
  // angle 0: rows 0-7 sit at |fy| = .4375 .3125 .1875 .0625 .0625 .1875 .3125 .4375, thresholds 2|fy|; with a
  // slope of 2/8 per pixel, rows with threshold .125 or .375 are covered and .625 or .875 are not.
  const data = applyTone(grayPixels(4, 16, 127.5), 4, 16, 0, 0, { cell: 8, angle: 0, shape: 'line' });
  const row = y => data[(y * 4) * 4 + 3];
  for (const y of [2, 3, 4, 5, 10, 11, 12, 13]) assert.ok(row(y) >= 250, `row ${y} covered (${row(y)})`);
  for (const y of [0, 1, 6, 7, 8, 9, 14, 15]) assert.ok(row(y) <= 5, `row ${y} empty (${row(y)})`);
});

test('the dot grid is fixed to the canvas, not to the region drawn', () => {
  for (const shape of ['dot', 'noise']) {
    const tone = { cell: 7, angle: 30, shape };
    const whole = applyTone(grayPixels(40, 40, 140), 40, 40, 0, 0, tone);
    const part = applyTone(grayPixels(15, 12, 140), 15, 12, 20, 9, tone);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 15; x++) assert.equal(part[(y * 15 + x) * 4 + 3], whole[((y + 9) * 40 + x + 20) * 4 + 3], `${shape} ${x},${y}`);
    }
  }
});

test('texture tiles', () => {
  assert.equal(textureTile('none'), null);
  assert.equal(textureTile('bogus'), null);
  for (const [id] of TEXTURES.slice(1)) {
    const t = textureTile(id);
    assert.equal(t.length, TILE * TILE, id);
    assert.deepEqual(t, textureTile(id), `${id} is always the same`);
    assert.equal(Math.min(...t), 0, `${id} has grooves`);
    assert.equal(Math.max(...t), 255, `${id} has tops`);
  }
});

test('noise tiles join up seamlessly', () => {
  for (const [x, y] of [[0, 0], [3.3, 7.9], [250.5, 13]]) {
    near(valueNoise(x + 8 * 32, y, 8, 32, 5), valueNoise(x, y, 8, 32, 5), 1e-9, 'repeats every cell * period');
    near(valueNoise(x, y + 8 * 32, 8, 32, 5), valueNoise(x, y, 8, 32, 5), 1e-9);
    // stretched cells (4 x 1 px) still repeat after 4 * 64 = 256 px both ways
    near(valueNoise(x + 256, y, 4, 64, 5, 1), valueNoise(x, y, 4, 64, 5, 1), 1e-9, 'stretched: across');
    near(valueNoise(x, y + 256, 4, 64, 5, 1), valueNoise(x, y, 4, 64, 5, 1), 1e-9, 'stretched: down');
  }
  // on lattice points the stretched noise is the hash of that point: (8, 3) with 4 x 1 cells is lattice (2, 3)
  near(valueNoise(8, 3, 4, 64, 5, 1), hash01(2, 3, 5), 1e-12);
  // across the tile's wrap-around edge the values change no more than between neighbours inside it
  for (const id of ['paper', 'coldpress', 'rough', 'canvas']) {
    const t = textureTile(id);
    let wrap = 0, inside = 0;
    for (let y = 0; y < TILE; y++) {
      wrap += Math.abs(t[y * TILE] - t[y * TILE + TILE - 1]);
      inside += Math.abs(t[y * TILE + 1] - t[y * TILE]);
    }
    assert.ok(wrap < inside * 2, `${id}: wrap ${wrap} vs inside ${inside}`);
  }
  for (let i = 0; i < 50; i++) { const h = hash01(i, -i, 3); assert.ok(h >= 0 && h < 1); }
});

test('canvas texture: a fine weave, not a grid', () => {
  // the weave height repeats every tile both ways (thread counts are whole and even, the wobble is tile noise)
  for (const [x, y] of [[0, 0], [3.3, 7.9], [250.5, 13], [100, 255.5]]) {
    near(canvasWeave(x + TILE, y), canvasWeave(x, y), 1e-9, 'across');
    near(canvasWeave(x, y + TILE), canvasWeave(x, y), 1e-9, 'down');
    near(canvasWeave(x - TILE, y - 2 * TILE), canvasWeave(x, y), 1e-9, 'any whole tile');
  }
  assert.ok(WARP % 2 === 0 && WEFT % 2 === 0 && WARP !== WEFT, 'even counts (over-under joins up), not square');
  const t = textureTile('canvas');
  let mean = 0;
  for (const v of t) mean += v / t.length;
  // primed: more tooth tops than grooves, so a light stroke keeps most of its paint
  assert.ok(mean > 128 && mean < 190, `mean ${mean}`);
  // correlation of the tile with itself shifted by (dx, dy)
  const corr = (dx, dy) => {
    let s = 0, v = 0;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const a = t[y * TILE + x] - mean;
        s += a * (t[((y + dy) % TILE) * TILE + (x + dx) % TILE] - mean); v += a * a;
      }
    }
    return s / v;
  };
  // threads every 256 / 52 = 4.9 px across and 256 / 46 = 5.6 px down: one thread over, the bumps line up again
  // (lag 5 and 6), half a thread over they do not (lag 3)
  assert.ok(corr(5, 0) > 0.3 && corr(5, 0) > corr(3, 0) + 0.15, `across ${corr(5, 0)} vs ${corr(3, 0)}`);
  assert.ok(corr(0, 6) > 0.3 && corr(0, 6) > corr(0, 3) + 0.15, `down ${corr(0, 6)} vs ${corr(0, 3)}`);
  // ten threads on (49 px across, 56 px down) the threads have wandered and thickened differently, so the weave no
  // longer lines up: a regular grid (the old 8 px blocks) correlated 0.95 with itself 16 or 48 px on
  assert.ok(Math.abs(corr(49, 0)) < 0.25, `10 threads across ${corr(49, 0)}`);
  assert.ok(Math.abs(corr(0, 56)) < 0.25, `10 threads down ${corr(0, 56)}`);
  assert.ok(Math.abs(corr(48, 0)) < 0.25 && Math.abs(corr(0, 48)) < 0.25, 'no 48 px repeat');
});

test('groove alpha', () => {
  assert.equal(grooveAlpha(255, 1), 0, 'tooth tops keep all the paint');
  assert.equal(grooveAlpha(0, 0.5), 128, 'a groove at 50% removes half (127.5 rounds up)');
  assert.equal(grooveAlpha(55, 1), 200);
  assert.equal(grooveAlpha(0, 3), 255, 'amount clamped');
});

test('brush texture settings', () => {
  const s = sanitizeSettings({ brush: { texture: 'canvas', textureAmount: 7, textureScale: 0.1 }, pen: { texture: 'lace' } });
  assert.equal(s.brush.texture, 'canvas');
  assert.equal(s.brush.textureAmount, 1, 'clamped');
  assert.equal(s.brush.textureScale, 0.25, 'clamped');
  assert.equal(s.pen.texture, 'none', 'unknown texture falls back');
  assert.equal(s.pencil.texture, 'paper', 'the pencil has a paper grain by default');
  assert.ok(!('texture' in s.fill), 'only brushes have a texture');
});

test('layers keep their tone in the save format', () => {
  const d = sanitizeDoc({ layers: [
    { name: 'A', tone: { cell: 6, angle: 0, shape: 'line', color: '#000000' } },
    { name: 'B' },
    { type: 'folder', tone: { cell: 6 }, children: [] },
  ] });
  assert.deepEqual(d.layers[0].tone, { cell: 6, angle: 0, shape: 'line', color: '#000000' });
  assert.equal(d.layers[1].tone, null, 'old files: no tone');
  assert.ok(!('tone' in d.layers[2]), 'folders have no tone');
});

test('tone grid shift and lines per inch', () => {
  assert.deepEqual(sanitizeTone({ x: 3, y: 0 }), { ...defaultTone(), x: 3 }, 'a shift of 0 is not kept');
  assert.equal(sanitizeTone({ x: 500 }).x, 100);
  assert.equal(sanitizeTone({ y: -2.26 }).y, -2.3);
  // 350 dpi with 5 px spacing: 70 lines per inch; 60 lpi at 300 dpi is 5 px
  assert.equal(toneLpi(5, 350), 70);
  assert.equal(cellForLpi(60, 300), 5);
  assert.equal(cellForLpi(60, 350), 5.8, '5.833 rounded to tenths');
  assert.equal(cellForLpi(1, 72), 72);
  assert.equal(cellForLpi(1000, 72), 2, 'never finer than the smallest spacing');
  // shifting the grid by a whole cell gives the same dots; by half a cell (line tone) moves lines into the gaps
  const gray = () => { const d = new Uint8ClampedArray(8 * 8 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 128; d[i + 3] = 255; } return d; };
  const base = { cell: 4, angle: 0, shape: 'line', color: '#000000' };
  const a = applyTone(gray(), 8, 8, 0, 0, base), b = applyTone(gray(), 8, 8, 0, 0, { ...base, y: 4 });
  assert.deepEqual([...a], [...b], 'a whole cell is no change');
  const c = applyTone(gray(), 8, 8, 0, 0, { ...base, y: 2 });
  const alphaRow = (d, y) => d[(y * 8) * 4 + 3];
  assert.equal(alphaRow(c, 2), alphaRow(a, 0), 'half a cell down: row 2 shows what row 0 showed');
  assert.notEqual(alphaRow(a, 0), alphaRow(a, 2), 'line tone: rows 0 and 2 differ (line and gap)');
});

test('gradient tone direction', () => {
  const r = { x: 10, y: 20, w: 100, h: 50 };
  assert.deepEqual(toneFadeLine(r, 'down'), { x0: 10, y0: 20, x1: 10, y1: 70 });
  assert.deepEqual(toneFadeLine(r, 'up'), { x0: 10, y0: 70, x1: 10, y1: 20 });
  assert.deepEqual(toneFadeLine(r, 'right'), { x0: 10, y0: 20, x1: 110, y1: 20 });
  assert.deepEqual(toneFadeLine(r, 'left'), { x0: 110, y0: 20, x1: 10, y1: 20 });
  assert.equal(toneFadeLine(r, 'none'), null);
  assert.equal(toneFadeLine(r, 'sideways'), null);
});
