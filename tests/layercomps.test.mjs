// Layer comps: capturing, what applying one changes, names and the file format; filtering the layer list by colour
// label. Expected values worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureComp, updateComp, compChanges, compMatches, sanitizeComps, sanitizeOffset, turnOffset, turnComps, sanitizeUid, newUid, cleanCompName, nextCompName, uniqueCompName, COMP_MAX } from '../web/js/layercomps.js';
import { sanitizeDoc } from '../web/js/doc.js';
import { findRows } from '../web/js/tree.js';

const nodes = () => [
  { uid: 'a', kind: 'layer', visible: true, opacity: 1, blend: 'source-over', offset: null },
  { uid: 'b', kind: 'layer', visible: false, opacity: 0.5, blend: 'multiply', offset: { x: 10, y: -4 } },
  { uid: 'f', kind: 'folder', visible: true, opacity: 0.8, blend: 'pass-through' },
];

test('a comp keeps visibility, and only the parts asked for', () => {
  const c = captureComp('  Day ', nodes());
  assert.equal(c.name, 'Day');
  assert.deepEqual(c.use, { opacity: false, blend: false, position: false });
  assert.deepEqual(c.layers, { a: { visible: true }, b: { visible: false }, f: { visible: true } });
  const all = captureComp('Night', nodes(), { opacity: true, blend: true, position: true });
  assert.deepEqual(all.layers.a, { visible: true, opacity: 1, blend: 'source-over', x: 0, y: 0 });
  assert.deepEqual(all.layers.b, { visible: false, opacity: 0.5, blend: 'multiply', x: 10, y: -4 });
  assert.deepEqual(all.layers.f, { visible: true, opacity: 0.8, blend: 'pass-through' }, 'a folder has no position');
  assert.deepEqual(Object.keys(captureComp('x', [{ kind: 'layer', visible: true }]).layers), [], 'a node without uid is left out');
});

test('applying a comp changes only what differs, and leaves layers it does not know alone', () => {
  const ns = nodes();
  const c = captureComp('Day', ns, { opacity: true, position: true });
  assert.ok(compMatches(c, ns), 'just made: nothing to change');
  ns[0].visible = false;      // a: hidden since
  ns[1].opacity = 0.25;       // b: more transparent
  ns[1].blend = 'screen';     // the comp does not keep blending modes: left as it is
  ns[1].offset = { x: 13, y: -4 };  // moved 3 px right: moves back 3 px left
  ns.push({ uid: 'new', kind: 'layer', visible: false, opacity: 1, blend: 'source-over' });  // added after the comp
  const { props, moves } = compChanges(c, ns);
  assert.deepEqual(props.map(p => [p.node.uid, p.key, p.value]), [['a', 'visible', true], ['b', 'opacity', 0.5]]);
  assert.deepEqual(moves.map(m => [m.node.uid, m.dx, m.dy]), [['b', -3, 0]]);
  assert.equal(compMatches(c, ns), false);
  // a layer that had no offset when kept and was moved (2, 5) since goes back by (-2, -5)
  ns[0].offset = { x: 2, y: 5 };
  assert.deepEqual(compChanges(c, ns).moves.map(m => [m.node.uid, m.dx, m.dy]), [['a', -2, -5], ['b', -3, 0]]);
});

test('updating a comp keeps its name and choices', () => {
  const ns = nodes();
  const c = captureComp('Day', ns, { blend: true });
  ns[1].visible = true;
  ns[1].blend = 'screen';
  const u = updateComp(c, ns);
  assert.equal(u.name, 'Day');
  assert.deepEqual(u.use, { opacity: false, blend: true, position: false });
  assert.deepEqual(u.layers.b, { visible: true, blend: 'screen' });
  assert.ok(compMatches(u, ns));
});

test('comp names', () => {
  assert.equal(cleanCompName('  A\tB  '), 'A B');
  assert.equal(cleanCompName(''), 'Comp');
  assert.equal(cleanCompName('x'.repeat(130)).length, 100);
  assert.equal(nextCompName([]), 'Comp 1');
  assert.equal(nextCompName(['Comp 1', 'Comp 3']), 'Comp 2');
  assert.equal(uniqueCompName(['Day'], 'Night'), 'Night');
  assert.equal(uniqueCompName(['Day', 'Day 2'], ' Day '), 'Day 3');
});

test('saved comps are cleaned', () => {
  assert.deepEqual(sanitizeComps(null), []);
  assert.deepEqual(sanitizeComps({}), []);
  const blendOk = b => ['source-over', 'multiply'].includes(b);
  const [c, d, e] = sanitizeComps([
    { name: 'Day', use: { opacity: true, blend: true, position: 'yes' }, layers: {
      a: { visible: false, opacity: 3, blend: 'nope', x: 5 },  // opacity clamped to 1, unknown blend dropped, x without use dropped
      'bad uid!': { visible: true },
      b: null,
      c: { opacity: -1, blend: 'multiply' },  // visible missing means shown; opacity clamped to 0
    } },
    { name: 'Day', use: { position: true }, layers: { a: { x: 2.6, y: '-3', visible: true }, b: { x: 1 } } },  // same name: "Day 2"
    { layers: [] },  // no name: the first free "Comp n"
    'junk',
  ], blendOk);
  assert.deepEqual(c, { name: 'Day', use: { opacity: true, blend: true, position: false }, layers: {
    a: { visible: false, opacity: 1 }, c: { visible: true, opacity: 0, blend: 'multiply' } } });
  assert.deepEqual(d, { name: 'Day 2', use: { opacity: false, blend: false, position: true }, layers: {
    a: { visible: true, x: 3, y: -3 }, b: { visible: true } } }, 'a position needs both x and y');
  assert.deepEqual(e, { name: 'Comp 1', use: { opacity: false, blend: false, position: false }, layers: {} });
  assert.deepEqual(Object.keys(sanitizeComps([{ layers: { a: {}, z: {} } }], undefined, new Set(['a']))[0].layers), ['a'], 'uids the document lacks are dropped');
  assert.equal(sanitizeComps(Array.from({ length: COMP_MAX + 5 }, () => ({}))).length, COMP_MAX);
});

test('offsets and uids as saved', () => {
  assert.equal(sanitizeOffset(null), null);
  assert.equal(sanitizeOffset({ x: 0, y: 0 }), null, 'not moved: nothing saved');
  assert.deepEqual(sanitizeOffset({ x: 4.4, y: 'z' }), { x: 4, y: 0 });
  assert.deepEqual(sanitizeOffset({ x: -2e7, y: 1 }), { x: -1e6, y: 1 });
  assert.equal(sanitizeUid('ab-9_Z'), 'ab-9_Z');
  assert.equal(sanitizeUid('a b'), null);
  assert.equal(sanitizeUid(5), null);
  assert.match(newUid(), /^[a-z0-9]{8}$/);
});

test('comps, uids and offsets in the file', () => {
  const d = sanitizeDoc({ layers: [
    { uid: 'a', offset: { x: 3, y: 0 } },
    { type: 'folder', uid: 'f', offset: { x: 9, y: 9 }, children: [{ uid: 'a' }, { uid: 'c' }] },  // a folder has no offset; 'a' twice
  ], comps: [{ name: 'One', use: { opacity: true }, layers: { a: { visible: false, opacity: 0.5 }, gone: { visible: true }, f: { blend: 'pass-through' } } }] });
  assert.equal(d.layers[0].uid, 'a');
  assert.deepEqual(d.layers[0].offset, { x: 3, y: 0 });
  assert.equal(d.layers[1].uid, 'f');
  assert.equal(d.layers[1].offset, undefined);
  assert.equal(d.layers[1].children[0].uid, undefined, 'a uid used twice goes to the first node only');
  assert.equal(d.layers[1].children[1].uid, 'c');
  assert.deepEqual(d.comps, [{ name: 'One', use: { opacity: true, blend: false, position: false }, layers: { a: { visible: false, opacity: 0.5 }, f: { visible: true } } }]);
  const old = sanitizeDoc({ layers: [{ name: 'A' }] });
  assert.deepEqual(old.comps, [], 'older files have no comps');
  assert.equal(old.layers[0].uid, undefined);
  assert.equal(old.layers[0].offset, undefined);
});

test('filtering the layer list by colour label, with the name search', () => {
  // top first: Sky (blue), Inks folder (red) holding Line (red) and Shade (blue), Paper
  const mk = (name, label, extra = {}) => ({ name, label, ...extra });
  const line = mk('Line', 'red'), shade = mk('Shade', 'blue');
  const inks = mk('Inks', 'red', { kind: 'folder', type: 'folder', open: false, children: [shade, line] });
  const root = { kind: 'folder', children: [mk('Paper', null), inks, mk('Sky', 'blue')] };
  const rows = (q, label) => findRows(root, q, label).map(r => r.node.name + (r.match ? '*' : '') + r.depth).join(' ');
  assert.equal(rows('', 'blue'), 'Sky*0 Inks0 Shade*1', 'the folder stays around a match, even closed');
  assert.equal(rows('', 'red'), 'Inks*0 Line*1');
  assert.equal(rows('s', 'blue'), 'Sky*0 Inks0 Shade*1', 'both: name and label');
  assert.equal(rows('sh', 'blue'), 'Inks0 Shade*1');
  assert.equal(rows('sky', 'red'), '');
  assert.equal(rows('', 'green'), '');
  assert.equal(rows('i', null), 'Inks*0 Line*1', 'no label: the name search alone');
});

test('moves turn with the canvas: flips, quarter turns and scaling; shifts leave them', () => {
  const flipH = [-1, 0, 0, 1, 200, 0], right = [0, 1, -1, 0, 100, 0], half = [0.5, 0, 0, 0.5, 0, 0], crop = [1, 0, 0, 1, -20, -10];
  assert.deepEqual(turnOffset({ x: 30, y: 5 }, flipH), { x: -30, y: 5 });
  assert.deepEqual(turnOffset({ x: 30, y: 5 }, right), { x: -5, y: 30 }, 'right becomes down, down becomes left');
  assert.deepEqual(turnOffset({ x: 30, y: -8 }, half), { x: 15, y: -4 });
  assert.deepEqual(turnOffset({ x: 30, y: 5 }, crop), { x: 30, y: 5 });
  assert.equal(turnOffset(null, flipH), null);
  assert.equal(turnOffset({ x: 1, y: 0 }, [0.4, 0, 0, 0.4, 0, 0]), null, 'a move scaled to nothing is none');
});

test('comps keep their positions turned with the layers, so applying one after a flip moves the right way', () => {
  const pos = { name: 'P', use: { opacity: false, blend: false, position: true },
    layers: { a: { visible: true, x: 0, y: 0 }, b: { visible: true, x: 12, y: 3 }, f: { visible: true } } };
  const vis = { name: 'V', use: { opacity: false, blend: false, position: false }, layers: { a: { visible: true } } };
  const flipH = [-1, 0, 0, 1, 200, 0];
  const [p2, v2] = turnComps([pos, vis], flipH, new Set(['b', 'f']));
  assert.equal(v2, vis);
  assert.deepEqual(p2.layers, { a: { visible: true, x: 0, y: 0 }, b: { visible: true, x: -12, y: 3 }, f: { visible: true } });
  // layer a was moved 50 right after comp P was kept; the canvas is flipped, which turns its move to 50 left
  const a = { uid: 'a', kind: 'layer', visible: true, offset: turnOffset({ x: 50, y: 0 }, flipH) };
  const [p3] = turnComps([pos], flipH);
  assert.deepEqual(compChanges(p3, [a]).moves, [{ node: a, dx: 50, dy: 0 }], 'back to where P had it, mirrored');
});
