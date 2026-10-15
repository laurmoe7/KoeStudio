// Entry point: mute guard, reload key, and switching between the gallery and the editor.

import { api } from './api.js';
import { applyMute } from './mute.js';
import { isReloadKey } from './keys.js';
import { toast, closeMenus } from './ui.js';
import { showGallery } from './views/gallery.js';
import { Doc } from './doc.js';
import { openEditor } from './views/editor.js';

const root = document.getElementById('app');
let editor = null;

// Which screen is open survives a reload (F5 / Ctrl+R) but not a restart of the app.
function remember(screen) {
  try { sessionStorage.setItem('koe.screen', JSON.stringify(screen)); } catch { /* not available */ }
}
function remembered() {
  try { return JSON.parse(sessionStorage.getItem('koe.screen')); } catch { return null; }
}

async function gallery() {
  if (editor) { editor.destroy(); editor = null; }
  closeMenus();
  remember({ view: 'gallery' });
  await showGallery(root, { onOpen: open });
}

async function open({ id, newDoc }) {
  closeMenus();
  root.innerHTML = '<div class="loading muted">Opening…</div>';
  try {
    editor = await openEditor(root, { id, newDoc, onHome: gallery });
    remember({ view: 'editor', id: editor.doc.id });
    // a new artwork gets its id from the first save
    if (!editor.doc.id) editor.save().then(() => editor && remember({ view: 'editor', id: editor.doc.id }));
  } catch (e) {
    toast('Could not open the artwork: ' + e.message, { error: true });
    gallery();
  }
}

/** Reload the screen (F5 / Ctrl+R): save first, then load the page again so edited UI files take effect. */
async function reload() {
  try {
    if (editor) {
      await editor.flush();
      remember({ view: 'editor', id: editor.doc.id });
    }
  } finally {
    location.reload();
  }
}
window.koeReload = reload;

/** Called by app.py when the window is closing: save pending work and say when that is done (koeFlushState). */
window.koeFlushStart = () => {
  window.koeFlushState = 'pending';
  (editor ? editor.flush() : Promise.resolve()).catch(() => {}).finally(() => { window.koeFlushState = 'done'; });
  return 1;
};
// leaving the page or hiding the window (the browser flavour, where there is no closing hook) also saves
document.addEventListener('visibilitychange', () => { if (document.hidden) editor?.flush().catch(() => {}); });

window.addEventListener('keydown', e => {
  if (isReloadKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    reload();
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
    try { await open({ newDoc: await Doc.fromJSON(opened) }); return; } catch (e) { toast('Could not open that file: ' + e.message, { error: true }); }
  }
  const s = remembered();
  if (s?.view === 'editor' && s.id) await open({ id: s.id });
  else await gallery();
}

start();
