// Organizing saved brushes: groups, moves, renames, deletes and the images left over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { presetGroups, regroup, withoutPresets, moveToGroup, renameGroup, moveGroup, orphanImages, groupLabel, hideKey } from '../web/js/brushorg.js';

const P = (id, source) => (source ? { id, name: id.toUpperCase(), source } : { id, name: id.toUpperCase() });
// mine: a, b; Pastels: c, e (not next to each other, as an old file may have them); Inks: d
const lib = [P('a'), P('c', 'Pastels'), P('b'), P('d', 'Inks'), P('e', 'Pastels')];
const layout = ps => presetGroups(ps).map(g => [g.name, g.presets.map(p => p.id).join('')]);

test('groups come in the order their first brush appears', () => {
  assert.deepEqual(layout(lib), [['', 'ab'], ['Pastels', 'ce'], ['Inks', 'd']]);
  assert.deepEqual(regroup(lib).map(p => p.id).join(''), 'abced', 'brushes of a group are put together');
  assert.equal(groupLabel(''), 'Your brushes');
  assert.equal(groupLabel('Inks'), 'Inks');
  assert.notEqual(hideKey('Ink', true), hideKey('Ink'), 'a pack named like a built-in group is hidden on its own');
});

test('deleting brushes', () => {
  assert.deepEqual(withoutPresets(lib, ['c', 'd']).map(p => p.id), ['a', 'b', 'e']);
});

test('moving brushes to a group, a new group or before a brush', () => {
  assert.deepEqual(layout(moveToGroup(lib, ['a', 'd'], 'Pastels')), [['', 'b'], ['Pastels', 'cead']], 'to the end of the group, in their order');
  assert.deepEqual(layout(moveToGroup(lib, ['e'], 'Pastels', 'c')), [['', 'ab'], ['Pastels', 'ec'], ['Inks', 'd']], 'dragged before c');
  assert.deepEqual(layout(moveToGroup(lib, ['c'], 'Favourites')), [['', 'ab'], ['Pastels', 'e'], ['Inks', 'd'], ['Favourites', 'c']]);
  const back = moveToGroup(lib, ['d'], '');
  assert.deepEqual(layout(back), [['', 'abd'], ['Pastels', 'ce']]);
  assert.ok(!('source' in back.find(p => p.id === 'd')), 'your own brushes have no source');
  assert.equal(lib[3].source, 'Inks', 'the list given is not changed');
  assert.equal(moveToGroup(lib, ['zz'], 'Inks'), lib, 'nothing to move');
});

test('renaming and reordering groups', () => {
  assert.deepEqual(layout(renameGroup(lib, 'Pastels', 'Soft')), [['', 'ab'], ['Soft', 'ce'], ['Inks', 'd']], 'it keeps its place');
  assert.deepEqual(layout(renameGroup(lib, 'Inks', 'Pastels')), [['', 'ab'], ['Pastels', 'cde']], 'renamed into another group: they join it, in list order');
  assert.deepEqual(layout(moveGroup(lib, 'Inks', '')), [['Inks', 'd'], ['', 'ab'], ['Pastels', 'ce']]);
  assert.deepEqual(layout(moveGroup(lib, '', null)), [['Pastels', 'ce'], ['Inks', 'd'], ['', 'ab']], 'to the end');
});

test('images only the deleted brushes used', () => {
  const br = (id, tip, texture) => ({ id, settings: { tip, texture, dualTip: 'none' } });
  const removed = [br('x', 'img:aaaaaaaa', 'img:bbbbbbbb'), br('y', 'img:cccccccc', 'paper')];
  const kept = [br('k', 'img:aaaaaaaa', 'none')];
  const tools = [{ tip: 'round', texture: 'img:cccccccc' }];
  assert.deepEqual(orphanImages(removed, kept, tools), ['bbbbbbbb'], 'a is kept by a brush, c by a tool that uses it');
});
