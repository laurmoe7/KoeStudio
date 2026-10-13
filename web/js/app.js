// Entry point: mute guard, reload key, and switching between the gallery and the editor.

import { api } from './api.js';
import { applyMute } from './mute.js';
import { isReloadKey } from './keys.js';
import { toast, closeMenus } from './ui.js';
import { showGallery } from './views/gallery.js';
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

window.addEventListener('keydown', e => {
  if (isReloadKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    reload();
  }
}, true);

async function start() {
  try {
    const cfg = await api.config();
    if (cfg.muted) {
      applyMute();
      document.documentElement.dataset.muted = '';
    }
  } catch { /* server not reachable: the screens below will say so */ }
  const s = remembered();
  if (s?.view === 'editor' && s.id) await open({ id: s.id });
  else await gallery();
}

start();
