// The workspace: panel layouts, saved workspaces and the radial menu. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYOUT, sanitizeLayout, movePanel, foldPanel, dockIndex, clampFloat, panelPlace, sanitizeWorkspaces, saveWorkspace,
  sanitizeRadial, radialSlot, radialSpot, DEFAULT_RADIAL, RADIAL_SLOTS, WORKSPACES_MAX } from '../web/js/workspace.js';
import { radialChoices } from '../web/js/views/workspacetools.js';
import { COMMANDS } from '../web/js/shortcuts.js';

test('layouts are cleaned up', () => {
  assert.deepEqual(sanitizeLayout(null), { left: ['tool', 'history', 'navigator'], right: ['color', 'mixing', 'layers'], float: {}, folded: {} });
  const l = sanitizeLayout({ left: ['layers', 'nope', 'layers'], right: ['tool'], float: { color: { x: 10, y: 20, w: 5, h: 99999 }, tool: { x: 0, y: 0, w: 300, h: 300 } } });
  assert.deepEqual(l.left, ['layers', 'history', 'navigator'], 'unknown and repeated dropped; missing ones back at the end of their usual side');
  assert.deepEqual(l.right, ['tool', 'mixing']);
  assert.deepEqual(l.float, { color: { x: 10, y: 20, w: 180, h: 1400 } }, 'docked wins over floating; sizes kept in range');
  assert.deepEqual(sanitizeLayout({}, { history: true, layers: false, junk: true }).folded, { history: true }, 'the old folded setting is read');
  assert.deepEqual(sanitizeLayout({ folded: { tool: true } }, { history: true }).folded, { tool: true }, 'once a layout has its own, the old one is ignored');
  assert.equal(panelPlace(l, 'color'), 'float');
  assert.equal(panelPlace(l, 'tool'), 'right');
});

test('moving panels', () => {
  const d = sanitizeLayout(DEFAULT_LAYOUT);
  const a = movePanel(d, 'layers', { dock: 'left', index: 1 });
  assert.deepEqual([a.left, a.right], [['tool', 'layers', 'history', 'navigator'], ['color', 'mixing']]);
  const b = movePanel(d, 'tool', { dock: 'left', index: 3 });
  assert.deepEqual(b.left, ['history', 'navigator', 'tool'], 'the index counts the side without the panel moved: to the bottom');
  const c = movePanel(d, 'history', { float: { x: 5, y: 6, w: 200, h: 300 } });
  assert.deepEqual([c.left, c.float], [['tool', 'navigator'], { history: { x: 5, y: 6, w: 200, h: 300 } }]);
  const e = movePanel(c, 'history', { dock: 'right' });
  assert.deepEqual([e.right, e.float], [['color', 'mixing', 'layers', 'history'], {}], 'docked again, at the end without an index');
  assert.deepEqual(d.left, ['tool', 'history', 'navigator'], 'the old layout is unchanged');
  assert.deepEqual(foldPanel(d, 'color', true).folded, { color: true });
  assert.deepEqual(foldPanel(foldPanel(d, 'color', true), 'color', false).folded, {});
  assert.equal(dockIndex([100, 300, 500], 50), 0);
  assert.equal(dockIndex([100, 300, 500], 301), 2, 'below the middle of the second panel: after it');
  assert.equal(dockIndex([], 10), 0);
});

test('floating panels stay reachable', () => {
  assert.deepEqual(clampFloat({ x: 50, y: 60, w: 300, h: 200 }, 1000, 700), { x: 50, y: 60, w: 300, h: 200 });
  assert.deepEqual(clampFloat({ x: 2000, y: 2000, w: 300, h: 200 }, 1000, 700), { x: 960, y: 660, w: 300, h: 200 }, '40 px of it left inside');
  assert.deepEqual(clampFloat({ x: -900, y: -50, w: 300, h: 200 }, 1000, 700), { x: -260, y: 0, w: 300, h: 200 }, 'its heading never above the top');
  assert.deepEqual(clampFloat({ x: 0, y: 0, w: 300, h: 900 }, 1000, 500), { x: 0, y: 0, w: 300, h: 500 }, 'no taller than the area');
});

test('saved workspaces', () => {
  const lay = sanitizeLayout(null);
  const list = sanitizeWorkspaces([{ name: ' Painting ', layout: {} }, { name: 'Painting', layout: {} }, { name: '' }, null, { name: 'Inking\n' }]);
  assert.deepEqual(list.map(w => w.name), ['Painting', 'Inking'], 'trimmed, empty and repeated names dropped');
  assert.deepEqual(list[1].layout, lay, 'a missing layout is the standard one');
  const moved = movePanel(lay, 'layers', { dock: 'left', index: 0 });
  const two = saveWorkspace(list, 'Painting', moved);
  assert.deepEqual([two.length, two[0].layout.left[0]], [2, 'layers'], 'the same name replaces, in its place');
  assert.deepEqual(saveWorkspace(list, 'New', lay).map(w => w.name), ['Painting', 'Inking', 'New']);
  const full = Array.from({ length: WORKSPACES_MAX }, (_, i) => ({ name: 'W' + i, layout: lay }));
  assert.equal(saveWorkspace(full, 'One more', lay).length, WORKSPACES_MAX);
});

test('the radial menu', () => {
  const valid = ['tool:pen', 'undo', 'redo'];
  assert.deepEqual(sanitizeRadial(null, valid), ['tool:pen', '', '', '', '', '', 'undo', 'redo'], 'the standard slots, unknown ones empty');
  assert.deepEqual(sanitizeRadial(['redo', 'x', 7], valid), ['redo', '', '', '', '', '', '', ''], 'always eight');
  // eight slots of 45°: up is 0, right 2, down 4, left 6; the centre (inside 30 px) is -1
  assert.equal(radialSlot(0, -100, 8, 30), 0);
  assert.equal(radialSlot(100, 0, 8, 30), 2);
  assert.equal(radialSlot(0, 100, 8, 30), 4);
  assert.equal(radialSlot(-100, 0, 8, 30), 6);
  assert.equal(radialSlot(70, -70, 8, 30), 1, 'up and right: the first diagonal');
  assert.equal(radialSlot(-38, -92, 8, 30), 0, '22° left of up still rounds to the top slot');
  assert.equal(radialSlot(-42, -90, 8, 30), 7, '25° left of up is the top-left slot');
  assert.equal(radialSlot(10, 10, 8, 30), -1);
  assert.deepEqual(radialSpot(0, 8, 100), { x: 0, y: -100 });
  assert.deepEqual(radialSpot(2, 8, 100), { x: 100, y: 0 });
  assert.deepEqual(radialSpot(1, 8, 100), { x: 70.71, y: -70.71 });
  const ids = radialChoices().map(c => c[0]);
  assert.ok(DEFAULT_RADIAL.every(id => ids.includes(id)) && DEFAULT_RADIAL.length === RADIAL_SLOTS, 'the standard slots are all real tools and commands');
  assert.ok(!ids.includes('radialMenu') && COMMANDS.some(c => c[0] === 'radialMenu'), 'it does not hold itself, but has a shortcut');
});
