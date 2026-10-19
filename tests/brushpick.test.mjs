// Picking brushes from an imported pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMatches, rangePick, noteSummary } from '../web/js/brushpick.js';

test('search finds names with every word, in any case and order', () => {
  const names = ['Soft Pastel', 'Hard pastel', 'Ink pen', 'Pastel ink blend'];
  assert.deepEqual(pickMatches(names, 'pastel'), [0, 1, 3]);
  assert.deepEqual(pickMatches(names, 'INK pastel'), [3]);
  assert.deepEqual(pickMatches(names, '  '), [0, 1, 2, 3], 'an empty search shows everything');
  assert.deepEqual(pickMatches(names, 'chalk'), []);
});

test('Shift+click picks the brushes shown between the two clicks', () => {
  const shown = [0, 2, 5, 7, 9];
  assert.deepEqual(rangePick(shown, 2, 7), [2, 5, 7]);
  assert.deepEqual(rangePick(shown, 9, 5), [5, 7, 9], 'backwards too');
  assert.deepEqual(rangePick(shown, 3, 7), [7], 'the first click is hidden by the search now');
  assert.deepEqual(rangePick(shown, null, 0), [0]);
});

test('the notes are counted per brush, most common first', () => {
  const brushes = [{ notes: ['Noise', 'Color dynamics'] }, { notes: ['Color dynamics', 'Color dynamics'] }, { notes: [] }, {}];
  assert.deepEqual(noteSummary(brushes), [['Color dynamics', 2], ['Noise', 1]]);
});
