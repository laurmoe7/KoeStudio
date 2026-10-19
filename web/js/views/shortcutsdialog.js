// Help → Change shortcuts…: gives any command or tool the key you press. The keys in use come from keyBindings()
// (worked out once from koe.shortcuts and kept until they change; the editor's onKey looks combos up in its table).

import { COMMANDS, bindings, comboTable, sanitizeShortcuts, assignKey, comboLabel, bindable } from '../shortcuts.js';
import { comboOf } from '../keys.js';
import { TOOLS } from '../tools.js';
import { esc, modal, store, toast } from '../ui.js';

let cache = null;

/** {custom, binds (id -> combos), table (combo -> ids)} for the keys in use now. */
export function keyBindings() {
  if (!cache) {
    const custom = sanitizeShortcuts(store('shortcuts'), TOOLS), binds = bindings(custom, TOOLS);
    cache = { custom, binds, table: comboTable(binds) };
  }
  return cache;
}

/** A tool's keys as shown in its tooltip ('P', or '' without one). */
export function toolKeyLabel(id) {
  return (keyBindings().binds.get('tool:' + id) || []).map(comboLabel).join(' / ');
}

function saveShortcuts(custom) {
  store('shortcuts', custom);
  cache = null;
  window.dispatchEvent(new Event('koe-shortcuts'));
}

/** The list of commands and tools with their keys; click Change and press the new key. Resolves when closed. */
export async function shortcutEditor() {
  let custom = { ...keyBindings().custom }, recording = null;
  const groups = [['Tools', TOOLS.map(t => ['tool:' + t.id, t.label])]];
  for (const [id, g, label] of COMMANDS) {
    let grp = groups.find(x => x[0] === g);
    if (!grp) groups.push(grp = [g, []]);
    grp[1].push([id, label]);
  }
  const labelOf = id => groups.flatMap(g => g[1]).find(r => r[0] === id)?.[1] || id;
  let stop = () => {};
  const result = await modal({
    title: 'Keyboard shortcuts',
    body: `<p class="muted small">Click <b>Change</b>, then press the key or key combination to use. A key taken from
      something else is removed there. Tools may share a key: pressing it again switches between them.</p>
      <input type="search" class="sc-search" placeholder="Find a command" aria-label="Find a command" data-own-enter>
      <div class="sc-list"></div>
      <div class="btn-row"><button type="button" data-reset-all>Reset all to the standard keys</button></div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true }],
    wide: true,
    onOpen: root => {
      const list = root.querySelector('.sc-list'), search = root.querySelector('.sc-search');
      const render = () => {
        const binds = bindings(custom, TOOLS), q = search.value.trim().toLowerCase();
        list.innerHTML = groups.map(([g, rows]) => {
          const shown = rows.filter(([, label]) => !q || label.toLowerCase().includes(q) || g.toLowerCase().includes(q));
          if (!shown.length) return '';
          return `<section class="sc-group"><h4>${esc(g)}</h4>${shown.map(([id, label]) => {
            const keys = binds.get(id) || [], changed = id in custom;
            return `<div class="sc-row${recording === id ? ' rec' : ''}" data-id="${esc(id)}"><span class="sc-label">${esc(label)}${changed ? ' <i class="muted small">(changed)</i>' : ''}</span>
              <span class="sc-keys">${recording === id ? '<i>Press a key… (Esc: cancel)</i>' : keys.length ? keys.map(k => `<kbd class="key">${esc(comboLabel(k))}</kbd>`).join(' ') : '<i class="muted">none</i>'}</span>
              <span class="sc-btns"><button type="button" data-change>Change</button><button type="button" data-none title="No key">None</button>${changed ? '<button type="button" data-default title="Back to the standard key">Standard</button>' : ''}</span></div>`;
          }).join('')}</section>`;
        }).join('');
      };
      list.addEventListener('click', e => {
        const row = e.target.closest('.sc-row'), id = row?.dataset.id;
        if (!id) return;
        if (e.target.closest('[data-change]')) recording = recording === id ? null : id;
        else if (e.target.closest('[data-none]')) { custom = { ...custom, [id]: [] }; recording = null; }
        else if (e.target.closest('[data-default]')) { custom = { ...custom }; delete custom[id]; recording = null; }
        render();
      });
      const onKey = e => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;  // wait for the key itself
        if (e.key === 'Escape') { recording = null; render(); return; }
        const combo = comboOf(e);
        if (!bindable(combo)) { toast(`${comboLabel(combo)} is kept for its own job; pick another key.`); return; }
        const r = assignKey(custom, TOOLS, recording, combo);
        custom = r.custom;
        if (r.took.length) toast(`${comboLabel(combo)} was taken from: ${r.took.map(labelOf).join(', ')}.`);
        recording = null;
        render();
      };
      window.addEventListener('keydown', onKey, true);  // before the dialog's own Esc and Enter
      stop = () => window.removeEventListener('keydown', onKey, true);
      search.addEventListener('input', render);
      root.querySelector('[data-reset-all]').onclick = () => { custom = {}; recording = null; render(); };
      render();
    },
    collect: () => custom,
  });
  stop();
  if (result) saveShortcuts(sanitizeShortcuts(result, TOOLS));
}
