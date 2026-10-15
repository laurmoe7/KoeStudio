// The gallery: every saved artwork as a card (with rename, duplicate, earlier versions and delete), New canvas,
// Open image or project, and Deleted artwork (put back what was deleted).

import { api } from '../api.js';
import { Doc, MAX_SIDE, loadImage } from '../doc.js';
import { icon } from '../icons.js';
import { esc, toast, modal, confirmBox, promptBox, fileToDataUrl, menu } from '../ui.js';

export const PRESETS = [
  ['Full HD (1920 × 1080)', 1920, 1080],
  ['Square (2048 × 2048)', 2048, 2048],
  ['Illustration (3000 × 4000)', 3000, 4000],
  ['A4 at 300 dpi (2480 × 3508)', 2480, 3508],
  ['B5 manga page at 600 dpi (4299 × 6071)', 4299, 6071],
  ['Twitter / X post (1600 × 900)', 1600, 900],
  ['Icon (512 × 512)', 512, 512],
];

export async function showGallery(root, { onOpen }) {
  root.innerHTML = `
    <div class="gallery">
      <header class="gal-top">
        <img src="icon.png" alt="" class="logo"><h1>KoeStudio</h1>
        <div class="grow"></div>
        <button class="primary" data-act="new">${icon('plus', 18)} New canvas</button>
        <button data-act="import">Open image or project…</button>
        <button data-act="deleted" title="Put back artwork you deleted">${icon('trash', 16)} Deleted</button>
        <button data-act="folder" title="Open the folder where artwork is saved">Artwork folder</button>
      </header>
      <div class="gal-grid" aria-live="polite"><p class="muted">Loading…</p></div>
    </div>`;
  root.querySelector('[data-act="new"]').onclick = async () => {
    const doc = await newCanvasDialog();
    if (doc) onOpen({ newDoc: doc });
  };
  root.querySelector('[data-act="import"]').onclick = () => importImage(onOpen);
  root.querySelector('[data-act="folder"]').onclick = () => api.openFolder();
  root.querySelector('[data-act="deleted"]').onclick = async () => { if (await deletedDialog()) fillGrid(root, onOpen); };
  await fillGrid(root, onOpen);
}

/** Lists deleted artwork with a Restore button each. Resolves true when something was put back. */
async function deletedDialog() {
  let list;
  try { list = await api.deleted(); } catch (e) { toast('Could not list deleted artwork: ' + e.message, { error: true }); return false; }
  let restored = false;
  await modal({
    title: 'Deleted artwork',
    wide: true,
    body: list.length
      ? `<p class="muted small">Deleted artwork stays in the .deleted folder until you remove it there yourself.</p>
         <div class="pick-list">${list.map(a => `
          <div class="pick-row" data-name="${esc(a.name)}">
            <img src="${api.deletedThumbUrl(a.name)}" alt="" onerror="this.style.visibility='hidden'">
            <div class="grow"><div class="card-title">${esc(a.title)}</div>
              <div class="muted small">${a.width} × ${a.height} · deleted ${esc(when(a.deleted))}</div></div>
            <button data-restore>Restore</button>
          </div>`).join('')}</div>`
      : '<p class="muted">Nothing has been deleted.</p>',
    buttons: [{ label: 'Close', value: null, primary: true }],
    onOpen: root => {
      root.querySelectorAll('[data-restore]').forEach(b => {
        b.onclick = async () => {
          const row = b.closest('.pick-row');
          b.disabled = true;
          try {
            await api.restore(row.dataset.name);
            restored = true;
            row.remove();
            toast(`"${row.querySelector('.card-title').textContent}" is back in the gallery.`);
          } catch (e) {
            b.disabled = false;
            toast('Could not restore: ' + e.message, { error: true });
          }
        };
      });
    },
  });
  return restored;
}

/** Earlier versions of an artwork (kept automatically while saving). Resolves with a Doc to open as a new artwork, or null. */
export async function versionsDialog(id, title) {
  let list;
  try { list = await api.backups(id); } catch (e) { toast('Could not list earlier versions: ' + e.message, { error: true }); return null; }
  const name = await modal({
    title: `Earlier versions of "${title}"`,
    wide: true,
    body: list.length
      ? `<p class="muted small">While you work, KoeStudio keeps a version every 10 minutes (the newest five).
         Opening one makes a copy in the gallery; the artwork itself is not changed.</p>
         <div class="pick-list">${list.map(b => `
          <div class="pick-row" data-name="${esc(b.name)}">
            <div class="grow"><div class="card-title">${esc(when(b.modified, true))}</div>
              <div class="muted small">${esc(sizeText(b.size))}</div></div>
            <button data-pick>Open as copy</button>
          </div>`).join('')}</div>`
      : '<p class="muted">No earlier versions yet. One is kept every 10 minutes while you work on it.</p>',
    buttons: [{ label: 'Close', value: null, primary: true }],
    onOpen: (root, close) => {
      root.querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => close(b.closest('.pick-row').dataset.name); });
    },
  });
  if (!name) return null;
  try {
    const raw = await api.loadBackup(id, name);
    const b = list.find(x => x.name === name);
    const doc = await Doc.fromJSON(raw);
    const stamp = new Date(b.modified * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    doc.title = `${raw.title || title} (version of ${stamp})`.slice(0, 120);
    return doc;
  } catch (e) {
    toast('Could not open that version: ' + e.message, { error: true });
    return null;
  }
}

function sizeText(bytes) {
  return bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}

async function fillGrid(root, onOpen) {
  const grid = root.querySelector('.gal-grid');
  let list;
  try {
    list = await api.list();
  } catch (e) {
    grid.innerHTML = `<p class="error">Could not list artwork: ${esc(e.message)}</p>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><span class="empty-art">${icon('brush', 56)}</span><p>No artwork yet.</p>
      <p class="muted">Start with a new canvas, or open a picture or a .koe project.</p>
      <button class="primary" data-empty-new>${icon('plus', 18)} New canvas</button></div>`;
    grid.querySelector('[data-empty-new]').onclick = () => document.querySelector('[data-act="new"]')?.click();
    return;
  }
  grid.innerHTML = list.map(a => `
    <div class="card" data-id="${esc(a.id)}" tabindex="0" role="button" aria-label="Open ${esc(a.title)}">
      <div class="thumb"><img src="${api.thumbUrl(a.id, a.modified)}" alt="" loading="lazy" onerror="this.remove()"></div>
      <div class="card-info">
        <div class="card-title">${esc(a.title)}</div>
        <div class="muted small">${a.width} × ${a.height} · ${a.layers} layer${a.layers === 1 ? '' : 's'}</div>
        <div class="muted small" title="Last changed">${esc(when(a.modified))}</div>
      </div>
      <button class="icon-btn card-more" title="More: rename, duplicate, earlier versions, delete" aria-label="More">${icon('more', 18)}</button>
    </div>`).join('');
  grid.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    const title = () => card.querySelector('.card-title').textContent;
    const open = () => onOpen({ id });
    card.onclick = e => { if (!e.target.closest('.card-more')) open(); };
    // only keys pressed on the card itself: Enter on its menu button must not also open it
    card.onkeydown = e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
    const del = async () => {
      if (!await confirmBox('Delete artwork', `Delete "${title()}"? You can put it back with Deleted at the top of the gallery.`, 'Delete')) return;
      try {
        await api.remove(id);
        card.remove();
        if (!grid.querySelector('.card')) fillGrid(root, onOpen);
      } catch (e) {
        toast('Could not delete: ' + e.message, { error: true });
      }
    };
    const act = (label, fn) => async () => {
      try { await fn(); } catch (e) { toast(`Could not ${label}: ${e.message}`, { error: true }); }
    };
    card.querySelector('.card-more').onclick = e => {
      e.stopPropagation();
      menu(e.currentTarget, [
        { label: 'Open', run: open },
        { label: 'Rename…', run: act('rename', async () => {
          const t = await promptBox('Rename artwork', 'Title', title());
          if (!t || t === title()) return;
          await api.rename(id, t);
          card.querySelector('.card-title').textContent = t;
          card.setAttribute('aria-label', 'Open ' + t);
        }) },
        { label: 'Duplicate', run: act('duplicate', async () => { await api.duplicate(id); await fillGrid(root, onOpen); }) },
        { label: 'Earlier versions…', run: async () => { const doc = await versionsDialog(id, title()); if (doc) onOpen({ newDoc: doc }); } },
        '-',
        { label: 'Delete…', run: del },
      ]);
    };
  });
}

/** A unix time for people: "today 14:05", or the date (with the time when `withTime`). */
function when(t, withTime = false) {
  const d = new Date(t * 1000), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'today ' + time;
  return d.toLocaleDateString() + (withTime ? ' ' + time : '');
}

export function newCanvasDialog() {
  return modal({
    title: 'New canvas',
    body: `
      <label class="field"><span>Title</span><input type="text" name="title" value="Untitled" maxlength="120"></label>
      <label class="field"><span>Preset</span><select name="preset">${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])}</option>`).join('')}<option value="custom">Custom</option></select></label>
      <div class="field-row">
        <label class="field"><span>Width (px)</span><input type="number" name="w" min="1" max="${MAX_SIDE}" value="${PRESETS[0][1]}"></label>
        <label class="field"><span>Height (px)</span><input type="number" name="h" min="1" max="${MAX_SIDE}" value="${PRESETS[0][2]}"></label>
      </div>
      <label class="field"><span>Paper</span><select name="paper"><option value="#ffffff">White</option><option value="custom">Color…</option><option value="none">Transparent</option></select></label>
      <input type="color" name="paperColor" value="#f4efe4" hidden>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true }],
    onOpen: root => {
      const f = n => root.querySelector(`[name="${n}"]`);
      f('preset').onchange = () => {
        const p = PRESETS[+f('preset').value];
        if (p) { f('w').value = p[1]; f('h').value = p[2]; }
      };
      for (const n of ['w', 'h']) f(n).oninput = () => { f('preset').value = 'custom'; };
      f('paper').onchange = () => { f('paperColor').hidden = f('paper').value !== 'custom'; };
      f('title').select();
    },
    collect: root => {
      const f = n => root.querySelector(`[name="${n}"]`);
      const w = Math.round(+f('w').value), h = Math.round(+f('h').value);
      if (!(w >= 1 && w <= MAX_SIDE && h >= 1 && h <= MAX_SIDE)) {
        toast(`Width and height must be between 1 and ${MAX_SIDE} pixels.`, { error: true });
        return undefined;
      }
      const paper = f('paper').value === 'none' ? null : f('paper').value === 'custom' ? f('paperColor').value : '#ffffff';
      return Doc.blank({ width: w, height: h, title: f('title').value.trim() || 'Untitled', paper });
    },
  });
}

function importImage(onOpen) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*,.koe';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      if (/\.koe$/i.test(f.name)) {  // a project file: becomes a new artwork in the gallery
        const doc = await Doc.fromJSON(JSON.parse(await f.text()));
        if (!doc.title || doc.title === 'Untitled') doc.title = f.name.replace(/\.koe$/i, '');
        onOpen({ newDoc: doc });
        return;
      }
      const img = await loadImage(await fileToDataUrl(f));
      const s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const doc = Doc.blank({ width: w, height: h, title: f.name.replace(/\.[^.]+$/, ''), paper: '#ffffff' });
      const layer = doc.active;
      layer.name = 'Image';
      layer.ctx.drawImage(img, 0, 0, w, h);
      layer.touch();
      onOpen({ newDoc: doc });
    } catch (e) {
      toast(e.message, { error: true });
    }
  };
  inp.click();
}
