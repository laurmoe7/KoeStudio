// Entry point: mute guard, reload key, and switching between the gallery and the open artworks.
// Several artworks can be open at once, each in its own editor (its own element under #app), with a tab bar
// above them; only the shown one listens to the keyboard (Editor.suspend / resume). The gallery keeps them open.

import { api } from './api.js';
import { applyMute } from './mute.js';
import { isReloadKey } from './keys.js';
import { toast, closeMenus, applyTheme, esc, confirmBox } from './ui.js';
import { icon } from './icons.js';
import { showGallery } from './views/gallery.js';
import { Doc } from './doc.js';
import { openEditor } from './views/editor.js';
import { guideDialog } from './views/help.js';

applyTheme();
const app = document.getElementById('app');
app.innerHTML = '<nav class="doc-tabs" hidden aria-label="Open artwork"></nav><div class="screens"><div class="screen gallery-screen"></div></div>';
const tabsBar = app.querySelector('.doc-tabs'), screens = app.querySelector('.screens'), galleryRoot = app.querySelector('.gallery-screen');
const MAX_OPEN = 8;  // each open artwork keeps its layers and undo steps in memory

const open = [];  // [{editor, el}], in tab order
let current = null;  // the shown one, or null for the gallery
const editor = () => current?.editor || null;

// Which screen and artworks are open survives a reload (F5 / Ctrl+R) but not a restart of the app.
function remember() {
  const ids = open.map(o => o.editor.doc.id).filter(Boolean);
  const screen = { view: current ? 'editor' : 'gallery', id: current?.editor.doc.id || null, ids };
  try { sessionStorage.setItem('koe.screen', JSON.stringify(screen)); } catch { /* not available */ }
}
function remembered() {
  try { return JSON.parse(sessionStorage.getItem('koe.screen')); } catch { return null; }
}

/** The tab bar: shown when it helps (two artworks open, or one open while the gallery shows). */
function renderTabs() {
  tabsBar.hidden = open.length < (current ? 2 : 1);
  tabsBar.innerHTML = `<button class="doc-tab home${current ? '' : ' on'}" data-home title="The gallery: every artwork (the open ones stay open)">${icon('grid', 14)}<span>Gallery</span></button>` +
    open.map((o, i) => `<div class="doc-tab${o === current ? ' on' : ''}" data-i="${i}" title="${esc(o.editor.doc.title)}" role="button" tabindex="0">
      <span class="doc-tab-name">${esc(o.editor.doc.title)}</span>
      <button class="doc-tab-close" data-close="${i}" title="Close this artwork (it is saved)" aria-label="Close">${icon('close', 12)}</button></div>`).join('');
  tabsBar.querySelector('[data-home]').onclick = () => gallery();
  tabsBar.querySelectorAll('.doc-tab[data-i]').forEach(t => {
    t.onclick = e => { if (!e.target.closest('[data-close]')) show(open[+t.dataset.i]); };
    t.onauxclick = e => { if (e.button === 1) closeArtwork(open[+t.dataset.i]); };  // middle click closes, as in a browser
  });
  tabsBar.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeArtwork(open[+b.dataset.close]); });
}

/** Shows one artwork (or the gallery with null), hiding and pausing the one shown before. */
function show(o) {
  closeMenus();
  if (current && current !== o) { current.editor.suspend(); current.el.hidden = true; }
  current = o;
  galleryRoot.hidden = !!o;
  if (o) { o.el.hidden = false; o.editor.resume(); }
  renderTabs();
  remember();
}

async function gallery() {
  if (current) await current.editor.flush().catch(() => {});
  show(null);
  await showGallery(galleryRoot, { onOpen: openArtwork, isOpen: id => open.some(o => o.editor.doc.id === id), onRenamed, onDeleting });
}

// Openings run one after the other: a second click on a card while it loads must find the first tab instead of
// opening the artwork twice (two editors saving over each other), and two loading at once would both show.
let opening = Promise.resolve();
function openArtwork(what) {
  const next = opening.then(() => openOne(what));
  opening = next.catch(() => {});
  return next;
}

/** Opens an artwork in a tab of its own ({id} of a saved one, or {newDoc}); an open one is just shown. */
async function openOne({ id, newDoc }) {
  closeMenus();
  const there = id && open.find(o => o.editor.doc.id === id);
  if (there) return show(there);
  if (open.length >= MAX_OPEN) { toast(`Up to ${MAX_OPEN} artworks can be open at once. Close one (× on its tab) first.`, { error: true }); return; }
  if (current) { await current.editor.flush().catch(() => {}); current.editor.suspend(); current.el.hidden = true; }
  current = null;
  galleryRoot.hidden = true;
  const el = document.createElement('div');
  el.className = 'screen';
  el.innerHTML = '<div class="loading muted">Opening…</div>';
  screens.append(el);
  try {
    const ed = await openEditor(el, { id, newDoc, onHome: gallery, onOpen: openArtwork });
    const o = { editor: ed, el };
    ed.onTitle = renderTabs;
    ed.onClose = () => closeArtwork(o);  // File → Close artwork
    open.push(o);
    current = o;
    renderTabs();
    remember();
    // a new artwork gets its id from the first save
    if (!ed.doc.id) ed.save().then(() => { remember(); }).catch(() => {});
    return o;
  } catch (e) {
    el.remove();
    toast('Could not open the artwork: ' + e.message, { error: true });
    if (!open.length) gallery(); else show(open[open.length - 1]);
  }
}

/** Closes an artwork's tab: saved first; then the next tab (or the gallery) shows. */
function closeArtwork(o) {
  if (!o) return Promise.resolve();
  return (o.closing ||= closeNow(o));  // a second click on × (or File → Close) while it saves waits for the first
}

async function closeNow(o) {
  await o.editor.flush().catch(() => {});
  const i = open.indexOf(o);
  if (i < 0) return;
  open.splice(i, 1);
  o.editor.destroy();
  o.el.remove();
  if (current === o) {
    current = null;
    if (open.length) show(open[Math.min(i, open.length - 1)]);
    else await gallery();
  } else renderTabs();
  remember();
}

// the gallery renamed an open artwork: the editor takes the new title, so its next save keeps it
function onRenamed(id, title) {
  const o = open.find(x => x.editor.doc.id === id);
  if (!o) return;
  o.editor.doc.title = title;
  o.el.querySelector('.ed-title').textContent = title;
  renderTabs();
}

// the gallery is about to delete an artwork: an open one is closed first (else its next save would bring it back)
async function onDeleting(id) {
  const o = open.find(x => x.editor.doc.id === id);
  if (!o) return true;
  if (!await confirmBox('Close the artwork', `"${o.editor.doc.title}" is open in a tab. Close it and delete it?`, 'Close and delete')) return false;
  await closeArtwork(o);
  return true;
}

/** Reload the screen (F5 / Ctrl+R): save first, then load the page again so edited UI files take effect. */
async function reload() {
  try {
    for (const o of open) await o.editor.flush();
    remember();
  } finally {
    location.reload();
  }
}
window.koeReload = reload;

const flushAll = () => Promise.all(open.map(o => o.editor.flush().catch(() => {})));

/** Called by app.py when the window is closing: save pending work and say when that is done (koeFlushState). */
window.koeFlushStart = () => {
  window.koeFlushState = 'pending';
  flushAll().finally(() => { window.koeFlushState = 'done'; });
  return 1;
};
// leaving the page or hiding the window (the browser flavour, where there is no closing hook) also saves
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });

window.addEventListener('keydown', e => {
  if (isReloadKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    reload();
  } else if (e.key === 'F1') {  // the guide, on every screen (the browser's own help page stays shut)
    e.preventDefault();
    e.stopPropagation();
    guideDialog();
  } else if (e.key === 'Tab' && e.ctrlKey && open.length && !document.querySelector('.modal-back')) {
    // Ctrl+Tab / Ctrl+Shift+Tab: the next / previous artwork tab (the gallery counts as one before the first)
    e.preventDefault();
    e.stopPropagation();
    const list = [null, ...open], i = list.indexOf(current), next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
    if (next) show(next); else gallery();
  }
}, true);

async function start() {
  let opened = null;  // a .koe file the app was started with (double-click in Explorer)
  try {
    const cfg = await api.config();
    if (cfg.muted) {
      applyMute();
      document.documentElement.dataset.muted = '';
    }
    if (cfg.openFile) opened = (await api.openFile()).doc;
  } catch { /* server not reachable: the screens below will say so */ }
  if (opened) {
    try { if (await openArtwork({ newDoc: await Doc.fromJSON(opened) })) return; } catch (e) { toast('Could not open that file: ' + e.message, { error: true }); }
  }
  const s = remembered();
  const ids = Array.isArray(s?.ids) ? s.ids : s?.id ? [s.id] : [];
  for (const id of ids.slice(0, MAX_OPEN)) await openArtwork({ id });
  const back = s?.view === 'editor' && open.find(o => o.editor.doc.id === s.id);
  if (back) show(back);
  else await gallery();
}

start();

// For test scripts driving a scratch server (tools/ui_shot.mjs): the shown editor, if any.
Object.defineProperty(window, 'koeEditor', { get: editor });
