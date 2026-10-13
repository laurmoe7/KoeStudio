// The gallery: every saved artwork as a card, plus New canvas and Import image.

import { api } from '../api.js';
import { Doc, MAX_SIDE, loadImage } from '../doc.js';
import { icon } from '../icons.js';
import { esc, toast, modal, confirmBox, fileToDataUrl } from '../ui.js';

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
        <button data-act="import">Open image…</button>
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
  await fillGrid(root, onOpen);
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
    grid.innerHTML = `<div class="empty"><p>No artwork yet.</p><p class="muted">Click <b>New canvas</b> to start drawing.</p></div>`;
    return;
  }
  grid.innerHTML = list.map(a => `
    <div class="card" data-id="${esc(a.id)}" tabindex="0" role="button" aria-label="Open ${esc(a.title)}">
      <div class="thumb"><img src="${api.thumbUrl(a.id, a.modified)}" alt="" loading="lazy" onerror="this.remove()"></div>
      <div class="card-info">
        <div class="card-title">${esc(a.title)}</div>
        <div class="muted small">${a.width} × ${a.height} · ${a.layers} layer${a.layers === 1 ? '' : 's'} · ${esc(when(a.modified))}</div>
      </div>
      <button class="icon-btn card-del" title="Delete (it goes to the .deleted folder)">${icon('trash', 16)}</button>
    </div>`).join('');
  grid.querySelectorAll('.card').forEach(card => {
    const open = () => onOpen({ id: card.dataset.id });
    card.onclick = e => { if (!e.target.closest('.card-del')) open(); };
    // only keys pressed on the card itself: Enter on its delete button must not also open it
    card.onkeydown = e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
    card.querySelector('.card-del').onclick = async () => {
      const title = card.querySelector('.card-title').textContent;
      if (!await confirmBox('Delete artwork', `Delete "${title}"? It is moved to the .deleted folder inside the artwork folder, so you can get it back from there.`, 'Delete')) return;
      try {
        await api.remove(card.dataset.id);
        card.remove();
        if (!grid.querySelector('.card')) fillGrid(root, onOpen);
      } catch (e) {
        toast('Could not delete: ' + e.message, { error: true });
      }
    };
  });
}

function when(t) {
  const d = new Date(t * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString();
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
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
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
