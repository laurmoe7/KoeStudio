// Palette files (palettes.js). The files are built byte by byte; expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePalette, gplText } from '../web/js/palettes.js';

const text = s => new TextEncoder().encode(s);
const u16 = n => [(n >> 8) & 255, n & 255];
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const f32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v); return [...b]; };
const utf16 = s => [...u16(s.length + 1), ...[...s].flatMap(c => u16(c.charCodeAt(0))), 0, 0];

test('GIMP palette', () => {
  const p = parsePalette(text('GIMP Palette\nName: Sunset\nColumns: 4\n# a comment\n255   0   0\tRed\n  0 128 255 Sky\n255 0 0 Red again\n'), 'x.gpl');
  assert.deepEqual(p, { name: 'Sunset', colors: ['#ff0000', '#0080ff'] }, 'named, repeats dropped');
  const back = parsePalette(text(gplText('Mine', ['#102030', '#ffffff'])), 'mine.gpl');
  assert.deepEqual(back, { name: 'Mine', colors: ['#102030', '#ffffff'] }, 'written and read back');
});

test('hex lists (Lospec .hex, Paint.NET .txt)', () => {
  assert.deepEqual(parsePalette(text('ff0044\n00FF00\n'), 'pico.hex'), { name: 'pico', colors: ['#ff0044', '#00ff00'] });
  assert.deepEqual(parsePalette(text('; Paint.NET Palette File\nFF112233\nFFAABBCC\n'), 'pdn.txt').colors, ['#112233', '#aabbcc'], 'AARRGGBB');
  assert.deepEqual(parsePalette(text('; made for a decade of art\nFF010203\n'), 'pdn.txt').colors, ['#010203'], 'comment words are not colours');
  assert.throws(() => parsePalette(text('hello'), 'x.txt'), /no colours/);
});

test('Photoshop .aco', () => {
  const v1 = Uint8Array.from([...u16(1), ...u16(3),
    ...u16(0), ...u16(65535), ...u16(32896), ...u16(0), ...u16(0),   // RGB: 255, 128, 0
    ...u16(8), ...u16(10000), 0, 0, 0, 0, 0, 0,                          // grayscale: full black ink
    ...u16(1), ...u16(32768), ...u16(65535), ...u16(65535), ...u16(0)]); // HSB: 180°, full: cyan
  assert.deepEqual(parsePalette(v1, 'sw.aco').colors, ['#ff8000', '#000000', '#00ffff']);
  const v2 = Uint8Array.from([...u16(2), ...u16(2),
    ...u16(0), ...u16(0), ...u16(0), ...u16(65535), ...u16(0), ...u32(5), ...[...'Blue'].flatMap(c => u16(c.charCodeAt(0))), 0, 0,
    ...u16(0), ...u16(65535), ...u16(65535), ...u16(65535), ...u16(0), ...u32(1), 0, 0]);
  assert.deepEqual(parsePalette(v2, 'named.aco').colors, ['#0000ff', '#ffffff'], 'names skipped');
});

test('Adobe swatch exchange (.ase)', () => {
  const block = (type, body) => [...u16(type), ...u32(body.length), ...body];
  const colour = (name, model, vals) => block(1, [...utf16(name), ...[...model].map(c => c.charCodeAt(0)), ...vals.flatMap(f32), ...u16(2)]);
  const blocks = [block(0xc001, utf16('Brand')), colour('Red', 'RGB ', [1, 0, 0]), colour('Mid', 'Gray', [0.5]),
    colour('Ink', 'CMYK', [0, 0, 0, 1]), colour('Odd', 'LAB ', [50, 0, 0]), block(0xc002, [])];
  const ase = Uint8Array.from([...'ASEF'].map(c => c.charCodeAt(0)).concat(u16(1), u16(0), u32(blocks.length), blocks.flat()));
  assert.deepEqual(parsePalette(ase, 'brand.ase'), { name: 'Brand', colors: ['#ff0000', '#808080', '#000000'] }, 'Lab is left out');
});
