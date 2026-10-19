// Colorize from hints: flat colours from scribbles inside line art.
import test from 'node:test';
import assert from 'node:assert/strict';
import { colorize, labelShapes, autoColorize, schemeColors, shapeNeighbours, seeded } from '../web/js/colorize.js';

// Pictures from rows of characters. Line art: '#' black line. Hints: 'r' red, 'b' blue, '.' nothing.
const RGB = { r: [255, 0, 0], b: [0, 0, 255], '#': [0, 0, 0] };
function rgba(rows) {
  const w = rows[0].length, data = new Uint8ClampedArray(w * rows.length * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!RGB[ch]) return;
    const i = (y * w + x) * 4;
    data.set([...RGB[ch], 255], i);
  }));
  return data;
}
/** The result back as characters: r, b, '.' for clear. */
function chars(out, w, h) {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const i = (y * w + x) * 4;
    if (!out[i + 3]) return '.';
    return Object.keys(RGB).find(k => RGB[k].every((v, c) => out[i + c] === v));
  }).join(''));
}

const LINES = [
  '.........',
  '.###.###.',
  '.#.#.#.#.',
  '.#.#.#.#.',
  '.###.###.',
  '.........',
];

test('shapes are found between the lines, with the outside touching the edge', () => {
  const line = Uint8Array.from(LINES.join('').split('').map(c => (c === '#' ? 1 : 0)));
  const { label, count, edge } = labelShapes(line, 9, 6);
  assert.equal(count, 4, 'outside, two boxes, plus the label for lines');
  assert.equal(edge[label[0]], 1);
  assert.equal(edge[label[2 * 9 + 2]], 0);
  assert.notEqual(label[2 * 9 + 2], label[2 * 9 + 6]);
});

test('each closed shape takes the hint scribbled in it, and the colour runs under its lines', () => {
  const hints = [
    '.........',
    '.........',
    '..r......',
    '......b..',
    '.........',
    '.........',
  ];
  // one step under the lines reaches the sides of a box; its corners are two steps away
  assert.deepEqual(chars(colorize(rgba(LINES), rgba(hints), 9, 6, { under: 1 }), 9, 6)[1], '..r...b..');
  const out = colorize(rgba(LINES), rgba(hints), 9, 6, { under: 2 });
  assert.deepEqual(chars(out, 9, 6), [
    '.........',
    '.rrr.bbb.',
    '.rrr.bbb.',
    '.rrr.bbb.',
    '.rrr.bbb.',
    '.........',
  ]);
});

test('a closed shape without a hint takes its neighbours\' colour; the open outside stays clear', () => {
  const hints = [
    '.........',
    '.........',
    '..r......',
    '.........',
    '.........',
    '.........',
  ];
  const out = colorize(rgba(LINES), rgba(hints), 9, 6, { under: 0 });
  // the right box is reached from the red box only through the outside, which is not passable, so it stays clear
  assert.deepEqual(chars(out, 9, 6).slice(2, 4), ['..r......', '..r......']);
  const touching = [  // two boxes sharing a wall
    '.......',
    '.#####.',
    '.#.#.#.',
    '.#####.',
    '.......',
  ];
  const out2 = colorize(rgba(touching), rgba(['.......', '.......', '..b....', '.......', '.......']), 7, 5, { under: 0 });
  assert.deepEqual(chars(out2, 7, 5)[2], '..b.b..', 'the box next door is filled through the shared line');
  const off = colorize(rgba(touching), rgba(['.......', '.......', '..b....', '.......', '.......']), 7, 5, { under: 0, fillUnhinted: false });
  assert.deepEqual(chars(off, 7, 5)[2], '..b....');
});

test('stray hint pixels are outvoted, and two real hints share a shape by distance', () => {
  const box = [
    '..........',
    '.########.',
    '.#......#.',
    '.########.',
    '..........',
  ];
  // 5 red against 1 blue: blue is under 20% of the shape's hints and is ignored
  const strays = colorize(rgba(box), rgba(['..........', '..........', '..rrrrrb..', '..........', '..........']), 10, 5, { under: 0 });
  assert.equal(chars(strays, 10, 5)[2], '..rrrrrr..');
  // red on the left, blue on the right in one (leaking) shape: each takes its own side
  const two = colorize(rgba(box), rgba(['..........', '..........', '..r....b..', '..........', '..........']), 10, 5, { under: 0 });
  assert.equal(chars(two, 10, 5)[2], '..rrrbbb..');
});

test('no hints on open pixels gives null', () => {
  assert.equal(colorize(rgba(LINES), rgba(['.........', '.#.......', '.........', '.........', '.........', '.........']), 9, 6), null);
});

/** Colour at (x, y) of an RGBA result as 0xrrggbb, or -1 when clear. */
const at = (out, w, x, y) => { const i = (y * w + x) * 4; return out[i + 3] ? (out[i] << 16) | (out[i + 1] << 8) | out[i + 2] : -1; };

// three closed boxes in a row, the middle one touching both others; plus a 1-pixel speck inside the right box
const ROW = [
  '.............',
  '.###########.',
  '.#...#...#..#',
  '.#...#...#.##',
  '.#...#...#..#',
  '.###########.',
  '.............',
];

test('neighbours are shapes that meet across a line', () => {
  const line = Uint8Array.from(ROW.join('').split('').map(c => (c === '#' ? 1 : 0)));
  const { label, count } = labelShapes(line, 13, 7);
  const near = shapeNeighbours(line, label, count, 13, 7, 2);
  const L = label[3 * 13 + 2], M = label[3 * 13 + 6];
  assert.ok(near[L].has(M) && near[M].has(L));
});

test('every closed shape gets a scheme colour, touching shapes differ, the outside stays clear', () => {
  const ref = rgba(ROW), w = 13, h = 7;
  const colors = schemeColors('harmony', 7);
  const out = autoColorize(ref, w, h, { scheme: 'harmony', seed: 7, under: 0 });
  const left = at(out, w, 3, 3), mid = at(out, w, 7, 3), right = at(out, w, 11, 2);
  for (const c of [left, mid, right]) assert.ok(colors.includes(c), 'a colour of the scheme');
  assert.notEqual(left, mid);
  assert.notEqual(mid, right);
  assert.equal(at(out, w, 0, 0), -1, 'background');
  assert.deepEqual(autoColorize(ref, w, h, { seed: 7, under: 0 }), out, 'the same seed gives the same colours');
});

test('My palette needs two colours; a picture without closed shapes gives null', () => {
  assert.equal(schemeColors('palette', 1, ['#ff0000']), null);
  assert.deepEqual(schemeColors('palette', 1, ['#ff0000', '#00ff00', 'nonsense']), [0xff0000, 0x00ff00]);
  const out = autoColorize(rgba(ROW), 13, 7, { scheme: 'palette', own: ['#ff0000', '#00ff00'], under: 0 });
  assert.notEqual(at(out, 13, 3, 3), at(out, 13, 7, 3));
  assert.equal(autoColorize(rgba(['.....', '..#..', '.....']), 5, 3), null);
});

test('the seeded generator repeats and stays between 0 and 1', () => {
  const a = seeded(42), b = seeded(42);
  for (let i = 0; i < 20; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});
