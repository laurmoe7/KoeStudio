// The guide and the shortcut list. Expected values are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE, SHORTCUTS, toolShortcuts, plainText, searchGuide } from '../web/js/guide.js';
import { TOOLS } from '../web/js/tools.js';
import { PICS } from '../web/js/guidepics.js';

test('guide pages', () => {
  const ids = GUIDE.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const [id, title, html] of GUIDE) {
    assert.ok(title && plainText(html).length > 80, `${id} has a title and some text`);
    assert.doesNotMatch(html, /<(script|img|a)\b/i, `${id} uses only plain text tags`);
  }
  assert.equal(plainText('<p>Hold <kbd>Alt</kbd>&nbsp;to pick</p>'), 'Hold Alt to pick');
});

test('searching the guide', () => {
  const mini = [['a', 'Layers', '<p>Blend modes and opacity.</p>'], ['b', 'Colour', '<p>Pick a colour from the layers.</p>'], ['c', 'View', '<p>Zoom.</p>']];
  assert.deepEqual(searchGuide('', mini), ['a', 'b', 'c'], 'empty: everything');
  assert.deepEqual(searchGuide('LAYERS', mini), ['a', 'b'], 'any case; a title match comes first');
  assert.deepEqual(searchGuide('pick layers', mini), ['b'], 'every word must appear');
  assert.deepEqual(searchGuide('mask', mini), []);
  assert.ok(searchGuide('quick mask').includes('selection'), 'the real guide explains quick mask under selections');
});

test('shortcut list', () => {
  const rows = toolShortcuts([{ key: 'g', label: 'Fill' }, { key: 'b', label: 'Brush' }, { key: 'g', label: 'Gradient' }]);
  assert.deepEqual(rows, [['B', 'Brush'], ['G', 'Fill / Gradient (press again to switch)']], 'sorted by key, shared keys together');
  const all = toolShortcuts(TOOLS).map(([, l]) => l).join(' ');
  for (const t of TOOLS) assert.ok(all.includes(t.label), `${t.label} has its key listed`);
  for (const [group, list] of SHORTCUTS) assert.ok(group && list.length && list.every(([k, w]) => k && w));
});

test('guide pictures', () => {
  const used = GUIDE.flatMap(([, , html]) => [...html.matchAll(/data-pic="([^"]+)"/g)].map(m => m[1]));
  for (const name of used) assert.ok(PICS[name], `picture ${name} exists`);
  for (const name of Object.keys(PICS)) {
    assert.ok(used.includes(name), `picture ${name} is used on a page`);
    assert.match(PICS[name], /^<svg class="gp" viewBox="0 0 \d+ \d+" role="img" aria-label="[^"]+">/, `${name} is a labelled svg`);
    assert.doesNotMatch(PICS[name], /<(script|image|foreignObject)\b|\son\w+=/i, `${name} has only shapes and text`);
  }
  const ids = Object.values(PICS).flatMap(p => [...p.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
  assert.equal(new Set(ids).size, ids.length, 'gradient and filter ids are unique across pictures');
});
