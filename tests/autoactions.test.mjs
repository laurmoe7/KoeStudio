// Auto actions: stored steps, labels, folding repeated settings, finding menu items and dialog fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStep, sanitizeActions, defaultActions, stepLabel, addStep, findMenuItem, dialogValues, fieldFor, SKIP_ITEMS } from '../web/js/autoactions.js';

test('steps from storage are checked, and unknown ones dropped', () => {
  assert.deepEqual(sanitizeStep({ kind: 'menu', menu: 'filter', path: ['Blur', 'Gaussian blur…'], dialogs: [[['radius', '4']]], show: true }),
    { kind: 'menu', menu: 'filter', path: ['Blur', 'Gaussian blur…'], dialogs: [[['radius', '4']]], show: true });
  assert.equal(sanitizeStep({ kind: 'menu', menu: 'file', path: ['Save now'] }), null, 'File menu items are not played');
  assert.equal(sanitizeStep({ kind: 'cmd', id: 'undo' }), null, 'undo is not a recorded command');
  assert.deepEqual(sanitizeStep({ kind: 'cmd', id: 'fillMain', color: '#AABBCC' }), { kind: 'cmd', id: 'fillMain', color: '#aabbcc' });
  assert.deepEqual(sanitizeStep({ kind: 'call', name: 'layerMove', args: [1, 'x', {}] }), { kind: 'call', name: 'layerMove', args: [1] });
  assert.equal(sanitizeStep({ kind: 'call', name: 'destroy' }), null, 'only the Layers panel methods');
  assert.deepEqual(sanitizeStep({ kind: 'prop', key: 'opacity', value: 0.5, label: 'Opacity' }), { kind: 'prop', key: 'opacity', value: 0.5, label: 'Opacity' });
  assert.equal(sanitizeStep({ kind: 'prop', key: 'opacity', value: 3 }), null);
  assert.equal(sanitizeStep({ kind: 'prop', key: 'blend', value: 'nonsense' }), null);
  assert.equal(sanitizeStep({ kind: 'prop', key: 'name', value: 'x' }), null);
});

test('nothing stored gives the built-in set; a bad set choice falls back to the first', () => {
  assert.deepEqual(sanitizeActions(null), defaultActions());
  const a = sanitizeActions({ sets: [{ name: 'Mine', actions: [{ name: 'A', steps: [{ kind: 'cmd', id: 'newLayer' }, { kind: 'bogus' }] }] }], set: 7 });
  assert.equal(a.set, 0);
  assert.deepEqual(a.sets[0].actions[0].steps, [{ kind: 'cmd', id: 'newLayer' }]);
  for (const s of defaultActions().sets[0].actions.flatMap(x => x.steps)) assert.deepEqual(sanitizeStep(s), s, 'built-in steps are valid');
});

test('steps read as what they do', () => {
  assert.equal(stepLabel({ kind: 'menu', menu: 'layer', path: ['New', 'Folder'] }), 'Layer › New › Folder');
  assert.equal(stepLabel({ kind: 'cmd', id: 'newLayer' }), 'New layer');
  assert.equal(stepLabel({ kind: 'call', name: 'layerMove', args: [-1] }), 'Move layer down');
  assert.equal(stepLabel({ kind: 'prop', key: 'opacity', value: 0.35, label: 'Opacity' }), 'Opacity: 35%');
  assert.equal(stepLabel({ kind: 'prop', key: 'blend', value: 'multiply', label: 'Blending mode' }), 'Blending mode: Multiply');
  assert.equal(stepLabel({ kind: 'prop', key: 'clip', value: true, label: 'Clip to layer below' }), 'Clip to layer below: on');
  assert.equal(stepLabel({ kind: 'prop', key: 'layerColor', value: null, label: 'Layer color' }), 'Layer color: off');
  assert.equal(stepLabel({ kind: 'call', name: 'loadSelectionNamed', args: ['Face', 'replace'] }), 'Load selection “Face”');
  assert.equal(stepLabel({ kind: 'call', name: 'loadSelectionNamed', args: ['Face', 'add'] }), 'Load selection “Face” (add)');
});

test('a saved selection load keeps its name and mode; list windows are not steps', () => {
  const long = 'x'.repeat(100);
  assert.deepEqual(sanitizeStep({ kind: 'call', name: 'loadSelectionNamed', args: ['Face', 'subtract', 'extra'] }),
    { kind: 'call', name: 'loadSelectionNamed', args: ['Face', 'subtract'] });
  assert.equal(sanitizeStep({ kind: 'call', name: 'loadSelectionNamed', args: [long] }).args[0].length, 80);
  assert.deepEqual(sanitizeStep({ kind: 'call', name: 'layerMove', args: [{}, 1] }), { kind: 'call', name: 'layerMove', args: [1] });
  assert.ok(SKIP_ITEMS.has('Saved selections…') && SKIP_ITEMS.has('Patterns…'));
});

test('changing the same setting twice in a row keeps one step', () => {
  const op = v => ({ kind: 'prop', key: 'opacity', value: v, label: 'Opacity' });
  let s = addStep([], { kind: 'cmd', id: 'newLayer' });
  s = addStep(s, op(0.8));
  s = addStep(s, op(0.4));
  assert.deepEqual(s, [{ kind: 'cmd', id: 'newLayer' }, op(0.4)]);
  s = addStep(s, { kind: 'prop', key: 'blend', value: 'screen', label: 'Blend' });
  s = addStep(s, op(0.2));
  assert.equal(s.length, 4, 'not folded across another step');
});

test('menu items are found by label or rec id, and refused when off or missing', () => {
  const run = () => {};
  const items = [
    { label: 'Delete selected pixels', rec: 'clear', run },
    '-',
    { label: 'New', sub: [{ label: 'Folder', run }, { label: 'Vector layer', run, disabled: true }] },
  ];
  assert.equal(findMenuItem(items, ['clear']).item, items[0]);
  assert.equal(findMenuItem(items, ['New', 'Folder']).item, items[2].sub[0]);
  assert.match(findMenuItem(items, ['New', 'Vector layer']).error, /not available now/);
  assert.match(findMenuItem(items, ['Gone']).error, /not in the menu/);
  assert.match(findMenuItem(items, ['New']).error, /submenu/);
});

test('dialog fields are kept by name, or by place when the name is shared or missing', () => {
  const fields = [
    { name: 'radius', type: 'number', value: '4' },
    { name: '', type: 'range', value: '30' },
    { name: 'mode', type: 'radio', checked: false },
    { name: 'mode', type: 'radio', checked: true },
    { name: 'on', type: 'checkbox', checked: true },
    { name: 'pic', type: 'file', value: '' },
  ];
  const vals = dialogValues(fields);
  assert.deepEqual(vals, [['radius', '4'], ['#1', '30'], ['#2', false], ['#3', true], ['on', true]]);
  assert.equal(fieldFor(fields, 'radius'), fields[0]);
  assert.equal(fieldFor(fields, '#3'), fields[3]);
  assert.equal(fieldFor(fields, 'gone'), null);
});
