// Interface colour themes (themes.js). Contrast values worked out by hand from the WCAG formula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_KEYS, DEFAULT_THEME, themeById, themeVars, contrast } from '../web/js/themes.js';

test('contrast ratio', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);  // (1 + .05) / (0 + .05)
  assert.equal(contrast('#ffffff', '#000000'), 21);  // order does not matter
  assert.equal(contrast('#777777', '#777777'), 1);
  // #808080: 128/255 = .50196 -> ((.50196 + .055) / 1.055)^2.4 = .21586; (1.05) / (.26586) = 3.949
  assert.ok(Math.abs(contrast('#808080', '#ffffff') - 3.949) < 0.001);
});

test('every theme has every colour, and ids are unique', () => {
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length);
  for (const t of THEMES) {
    for (const k of THEME_KEYS) assert.match(t.colors[k], /^#[0-9a-f]{6}$/, `${t.id} ${k}`);
    assert.deepEqual(Object.keys(t.colors).sort(), [...THEME_KEYS].sort());
  }
});

test('there is a dusty pink theme', () => {
  assert.equal(themeById('rose').name, 'Dusty rose');
});

test('themes are dark and readable', () => {
  for (const { id, colors: c } of THEMES) {
    assert.ok(contrast(c.bg, '#000000') < 2, `${id}: background is dark`);
    assert.ok(contrast(c.text, c.panel) >= 7, `${id}: text on panels`);
    assert.ok(contrast(c.muted, c.panel) >= 4.5, `${id}: muted text on panels`);
    assert.ok(contrast('#ffffff', c['accent-2']) >= 4.5, `${id}: white text on primary buttons`);
    assert.ok(contrast(c.accent, c.panel) >= 4.5, `${id}: accent on panels`);
  }
});

test('unknown ids fall back to the default', () => {
  assert.equal(themeById('nope').id, DEFAULT_THEME);
  assert.equal(themeById(null).id, DEFAULT_THEME);
});

test('themeVars names the CSS properties', () => {
  const v = themeVars(themeById('midnight'));
  assert.equal(v['--bg'], '#1e1f24');
  assert.equal(v['--accent-2'], '#3d6fd1');
  assert.equal(Object.keys(v).length, THEME_KEYS.length);
});
