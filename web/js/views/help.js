// The Help menu's dialogs: the Guide (F1; topics from guide.js with a search), Keyboard shortcuts and About.
// Plain functions, so the gallery can open the guide too.

import { api } from '../api.js';
import { GUIDE, SHORTCUTS, toolShortcuts, searchGuide } from '../guide.js';
import { PICS } from '../guidepics.js';
import { TOOLS } from '../tools.js';
import { esc, modal, store, toast } from '../ui.js';

/** The Help menu (editor). */
export function helpMenuItems() {
  return [
    { label: 'Guide', key: 'F1', run: () => guideDialog() },
    { label: 'Keyboard shortcuts', run: () => shortcutsDialog() },
    '-',
    { label: 'About KoeStudio', run: () => aboutDialog() },
  ];
}

let guideOpen = false;

/** The guidebook: topics down the side (filtered by the search box), the page beside them. Remembers the page. */
export async function guideDialog(topic = null) {
  if (guideOpen) return;
  guideOpen = true;
  let current = GUIDE.some(([id]) => id === topic) ? topic : GUIDE.some(([id]) => id === store('guideTopic')) ? store('guideTopic') : GUIDE[0][0];
  try {
    await modal({
      title: 'Guide',
      body: `<div class="guide">
        <aside class="guide-side">
          <input type="search" class="guide-search" placeholder="Search the guide" aria-label="Search the guide" data-own-enter>
          <nav class="guide-nav"></nav>
          <button type="button" class="guide-keys">Keyboard shortcuts</button>
        </aside>
        <article class="guide-page" tabindex="0"></article>
      </div>`,
      buttons: [{ label: 'Close', value: null, primary: true }],
      wide: true,
      onOpen: root => {
        const nav = root.querySelector('.guide-nav'), page = root.querySelector('.guide-page'), search = root.querySelector('.guide-search');
        const show = id => {
          current = id;
          store('guideTopic', id);
          const [, title, html] = GUIDE.find(g => g[0] === id);
          page.innerHTML = `<h3>${esc(title)}</h3>${html}`;
          page.querySelectorAll('figure[data-pic]').forEach(f => f.insertAdjacentHTML('afterbegin', PICS[f.dataset.pic] || ''));
          page.scrollTop = 0;
          nav.querySelectorAll('[data-topic]').forEach(b => b.classList.toggle('on', b.dataset.topic === id));
        };
        const list = () => {
          const ids = searchGuide(search.value);
          nav.innerHTML = ids.length
            ? ids.map(id => `<button type="button" data-topic="${id}">${esc(GUIDE.find(g => g[0] === id)[1])}</button>`).join('')
            : '<p class="muted small">Nothing found. Try another word.</p>';
          nav.querySelectorAll('[data-topic]').forEach(b => { b.onclick = () => show(b.dataset.topic); });
          if (ids.length) show(ids.includes(current) ? current : ids[0]);
        };
        search.oninput = list;
        search.onkeydown = e => { if (e.key === 'Enter') nav.querySelector('[data-topic]')?.click(); };
        root.querySelector('.guide-keys').onclick = () => shortcutsDialog();
        list();
      },
    });
  } finally {
    guideOpen = false;
  }
}

/** Every keyboard shortcut: the tool keys (from the tool list, so they never go stale) and the rest by group. */
export function shortcutsDialog() {
  const table = (title, rows) => `<section class="keys-group"><h4>${esc(title)}</h4><table>${rows.map(([k, w]) =>
    `<tr><td>${k.split(' / ').map(x => `<kbd class="key">${esc(x)}</kbd>`).join(' / ')}</td><td>${esc(w)}</td></tr>`).join('')}</table></section>`;
  return modal({
    title: 'Keyboard shortcuts',
    body: `<div class="keys">${table('Tools', toolShortcuts(TOOLS))}${SHORTCUTS.map(([g, rows]) => table(g, rows)).join('')}</div>`,
    buttons: [{ label: 'Close', value: null, primary: true }],
    wide: true,
  });
}

/** Which version this is and where things are kept. */
export async function aboutDialog() {
  let c = {};
  try { c = await api.config(); } catch { /* shown without the details */ }
  const row = (k, v) => (v ? `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>` : '');
  return modal({
    title: 'About KoeStudio',
    body: `<div class="about"><img src="icon.png" alt="" width="56" height="56">
      <div><p><b>KoeStudio</b><br><span class="muted small">A drawing and painting program in the spirit of Clip Studio Paint.</span></p>
      <table class="about-info">${row('Version', c.build ? `${c.build}${c.buildDate ? ` (${c.buildDate})` : ''}` : '')}
        ${row('Artwork', c.artDir)}${row('Settings', c.appDir)}${row('Python', c.python)}</table></div></div>`,
    buttons: [{ label: 'Open artwork folder', value: 'folder' }, { label: 'Close', value: null, primary: true }],
  }).then(v => { if (v === 'folder') api.openFolder().catch(e => toast(e.message, { error: true })); });
}
