// File → Export layers: which parts are written. Built from plain objects, no canvases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertNode } from '../web/js/tree.js';
import { layerExportParts } from '../web/js/views/exporttools.js';

// root (bottom first): [A, Ac (clipped to A), H (hidden), Adj (correction), F: [B, Bc (clipped to B)]]
function sample() {
  const L = (name, o = {}) => ({ kind: 'layer', name, visible: true, ...o });
  const root = { kind: 'folder', name: 'root', children: [] }, F = { kind: 'folder', name: 'F', visible: true, children: [] };
  const A = L('A'), Ac = L('Ac', { clip: true }), H = L('H', { visible: false }), Adj = L('Adj', { adjust: { type: 'invert' } });
  const B = L('B'), Bc = L('Bc', { clip: true });
  [A, Ac, H, Adj, F].forEach((n, i) => insertNode(root, i, n));
  insertNode(F, 0, B); insertNode(F, 1, Bc);
  return { root, A, Ac, H, Adj, F, B, Bc };
}

const names = parts => parts.map(p => p.name);

test('top-level parts keep their clipped layers with them', () => {
  const t = sample(), parts = layerExportParts(t.root, 'top', false);
  assert.deepEqual(names(parts), ['A', 'F'], 'hidden and correction layers are left out, Ac goes with A');
  assert.deepEqual(parts[0].draw, [t.A, t.Ac]);
  assert.equal(parts[0].clipTo, null);
  assert.deepEqual(names(layerExportParts(t.root, 'top', true)), ['A', 'H', 'F'], 'hidden ones when asked for');
});

test('every layer on its own: clipped ones are cut to their base', () => {
  const t = sample(), parts = layerExportParts(t.root, 'all', false);
  assert.deepEqual(names(parts), ['A', 'Ac', 'B', 'Bc']);
  assert.equal(parts[1].clipTo, t.A);
  assert.equal(parts[3].clipTo, t.B);
  assert.equal(parts[0].clipTo, null);
  t.F.visible = false;
  assert.deepEqual(names(layerExportParts(t.root, 'all', false)), ['A', 'Ac'], 'layers in a hidden folder are hidden');
});
