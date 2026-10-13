// Layer tree operations and the version 2 save format. Built from plain objects, no canvases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allLayers, panelRows, contains, removeNode, insertNode, pathOf, nodeAt, destination, moveNode, stepTarget } from '../web/js/tree.js';
import { sanitizeDoc } from '../web/js/doc.js';

// root: [A, F(open): [B, G(closed): [C]], D]   (bottom first)
function sample() {
  const L = name => ({ kind: 'layer', name });
  const F = (name, open) => ({ kind: 'folder', name, open, children: [] });
  const root = F('root', true), A = L('A'), f = F('F', true), B = L('B'), g = F('G', false), C = L('C'), D = L('D');
  insertNode(root, 0, A); insertNode(root, 1, f); insertNode(root, 2, D);
  insertNode(f, 0, B); insertNode(f, 1, g); insertNode(g, 0, C);
  return { root, A, f, B, g, C, D };
}
const names = parent => parent.children.map(n => n.name).join(',');

test('listing', () => {
  const { root, f, g, C } = sample();
  assert.deepEqual(allLayers(root).map(n => n.name), ['A', 'B', 'C', 'D']);
  assert.deepEqual(panelRows(root).map(r => `${r.node.name}${r.depth}`), ['D0', 'F0', 'G1', 'B1', 'A0'],
    'top first; the closed folder G hides C');
  assert.ok(contains(f, C) && contains(g, C) && !contains(g, f));
  assert.deepEqual(pathOf(C), [1, 1, 0]);
  assert.equal(nodeAt(root, [1, 1, 0]), C);
  assert.equal(nodeAt(root, [5]), null);
});

test('moving above, below and into', () => {
  const s = sample();
  moveNode(s.A, s.D, 'above');
  assert.equal(names(s.root), 'F,D,A');
  moveNode(s.A, s.f, 'top-of');
  assert.equal(names(s.f), 'B,G,A');
  assert.equal(s.A.parent, s.f);
  const from = moveNode(s.B, s.D, 'below');
  assert.equal(names(s.root), 'F,B,D');
  assert.deepEqual([from.parent.name, from.index], ['F', 0], 'where it came from, for undo');
  assert.equal(destination(s.f, s.g, 'top-of'), null, 'a folder cannot go into its own folder');
  assert.equal(destination(s.f, s.f, 'above'), null);
});

test('destination indexes ignore the moving node itself', () => {
  const s = sample();
  // A is at 0 in root; putting it above F (index 1) means index 1 once A is taken out: [F, A, D]
  assert.deepEqual(destination(s.A, s.f, 'above'), { parent: s.root, index: 1 });
  moveNode(s.A, s.f, 'above');
  assert.equal(names(s.root), 'F,A,D');
});

test('stepping up and down goes into open folders, past closed ones, and out at the ends', () => {
  const s = sample();
  assert.deepEqual(stepTarget(s.A, 1), { target: s.f, where: 'bottom-of' }, 'A up: F is open, so into its bottom');
  assert.deepEqual(stepTarget(s.D, -1), { target: s.f, where: 'top-of' }, 'D down: into the top of F');
  assert.deepEqual(stepTarget(s.B, 1), { target: s.g, where: 'above' }, 'B up: G is closed, so past it');
  assert.deepEqual(stepTarget(s.g, 1), { target: s.f, where: 'above' }, 'G is the top of F: up leaves the folder');
  assert.deepEqual(stepTarget(s.B, -1), { target: s.f, where: 'below' }, 'B is the bottom of F: down leaves the folder');
  assert.equal(stepTarget(s.D, 1), null, 'already at the very top');
  removeNode(s.D);
  assert.equal(s.D.parent, null);
});

test('version 2 format: folders, masks, pass-through', () => {
  const d = sanitizeDoc({
    version: 2, activePath: [1, 0],
    layers: [
      { name: 'Paper', png: 'data:image/png;base64,AA==', mask: { enabled: false, png: 'nope' } },
      { type: 'folder', name: 'Ink', blend: 'pass-through', open: false, children: [{ name: 'Lines', blend: 'pass-through' }] },
    ],
  });
  assert.equal(d.layers[0].mask.enabled, false);
  assert.equal(d.layers[0].mask.png, null, 'a bad PNG is dropped');
  assert.equal(d.layers[1].type, 'folder');
  assert.equal(d.layers[1].blend, 'pass-through');
  assert.equal(d.layers[1].open, false);
  assert.equal(d.layers[1].children[0].blend, 'source-over', 'Through is only for folders');
  assert.deepEqual(d.activePath, [1, 0]);
  let deep = { type: 'folder', children: [] };
  const top = deep;
  for (let i = 0; i < 40; i++) { const c = { type: 'folder', children: [] }; deep.children.push(c); deep = c; }
  let depth = 0;
  for (let n = sanitizeDoc({ layers: [top] }).layers[0]; n.children?.length; n = n.children[0]) depth++;
  assert.ok(depth <= 20, 'nesting is capped');
});
