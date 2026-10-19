// Changeable keyboard shortcuts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, bindable, sanitizeShortcuts, bindings, comboTable, toolForCombo, assignKey, comboLabel, labelCombo, defaultOwner, menuKeyLabel } from '../web/js/shortcuts.js';
import { TOOLS } from '../web/js/tools.js';

test('command ids are unique and their default keys are not shared', () => {
  const ids = COMMANDS.map(c => c[0]);
  assert.equal(new Set(ids).size, ids.length);
  const combos = COMMANDS.flatMap(c => c[3]);
  assert.equal(new Set(combos).size, combos.length, 'no key runs two commands');
  for (const c of combos) assert.ok(bindable(c), c);
  const toolKeys = new Set(TOOLS.map(t => t.key));
  for (const c of combos) assert.ok(!toolKeys.has(c), `${c} is not also a tool key`);
});

test('reserved and modifier-only keys cannot be bound', () => {
  assert.equal(bindable('f5'), false);
  assert.equal(bindable('ctrl+v'), false);
  assert.equal(bindable('space'), false);
  assert.equal(bindable('ctrl+shift'), false);
  assert.equal(bindable('ctrl+k'), true);
  assert.equal(bindable(5), false);
});

test('stored changes are cleaned', () => {
  assert.deepEqual(sanitizeShortcuts({ undo: ['ctrl+k', 'f5', 'ctrl+k'], nonsense: ['a'], redo: 'x', 'tool:pen': [] }, TOOLS),
    { undo: ['ctrl+k'], 'tool:pen': [] });
  assert.deepEqual(sanitizeShortcuts(null, TOOLS), {});
});

test('bindings, the combo table and tools taking turns', () => {
  const binds = bindings({ undo: ['ctrl+k'] }, TOOLS);
  assert.deepEqual(binds.get('undo'), ['ctrl+k']);
  assert.deepEqual(binds.get('redo'), ['ctrl+y', 'ctrl+shift+z'], 'unchanged ones keep their default');
  assert.deepEqual(binds.get('tool:pen'), ['p']);
  const table = comboTable(binds);
  assert.deepEqual(table.get('ctrl+k'), ['undo']);
  assert.equal(table.get('ctrl+z'), undefined, 'the old key is free');
  assert.equal(toolForCombo(table, 'g', 'pen'), 'fill');
  assert.equal(toolForCombo(table, 'g', 'fill'), 'gradient');
  assert.equal(toolForCombo(table, 'g', 'lassofill'), 'fill', 'round again');
  assert.equal(toolForCombo(table, 'ctrl+k', 'pen'), null, 'not a tool key');
});

test('assigning a key takes it from its owner, but tools may share', () => {
  let r = assignKey({}, TOOLS, 'undo', 'q');
  assert.deepEqual(r.took, ['quickMask']);
  assert.deepEqual(r.custom, { undo: ['q'], quickMask: [] });
  r = assignKey({}, TOOLS, 'tool:pen', 'b');
  assert.deepEqual(r.took, [], 'the Brush keeps B too: they take turns');
  assert.deepEqual(r.custom, { 'tool:pen': ['b'] });
  r = assignKey({}, TOOLS, 'tool:pen', 'x');
  assert.deepEqual(r.took, ['swapColors']);
});

test('labels', () => {
  assert.equal(comboLabel('ctrl+shift+n'), 'Ctrl+Shift+N');
  assert.equal(comboLabel('alt+delete'), 'Alt+Del');
  assert.equal(comboLabel('['), '[');
  assert.equal(comboLabel('f2'), 'F2');
  assert.equal(labelCombo('Shift+Alt+Del'), 'alt+shift+delete');
  assert.equal(labelCombo('Ctrl+Alt+Shift+S'), 'ctrl+alt+shift+s');
  assert.equal(defaultOwner('ctrl+shift+z'), 'redo');
  const binds = bindings({ save: ['ctrl+k'], exportPng: [] }, TOOLS);
  assert.equal(menuKeyLabel('Ctrl+S', binds), 'Ctrl+K', 'the menu follows the change');
  assert.equal(menuKeyLabel('Ctrl+Shift+S', binds), '', 'no key now');
  assert.equal(menuKeyLabel('Ctrl+Y', binds), 'Ctrl+Y');
  assert.equal(menuKeyLabel('Ctrl+V', binds), 'Ctrl+V', 'not a changeable command: as written');
});
