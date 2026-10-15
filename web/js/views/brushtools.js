// Saved brushes, tip and texture images, and importing Clip Studio Paint brushes, as Editor methods.
//
// The brush library lives in the app folder (app.py: <app dir>/brushes): images ({id, name, kind: 'tip' |
// 'texture'}) and presets ({id, name, settings, source}). Paint tools name an image as 'img:<id>' in their tip or
// texture setting; images are loaded once (loadBrushLibrary) and registered with painter.js. A preset is a full
// set of paint settings (BRUSH_KEYS) that any paint tool can take on; the tool remembers which one in `preset`.
// A .sut import (app.py → sutbrush.py) brings the settings; its tip and texture images are encrypted inside the
// file, so the import dialog asks for PNGs and remembers them by the material's name for the next brush.

import { api } from '../api.js';
import { curveAt } from '../brush.js';
import { tipMask, textureGray, fitSide, imageRef, TIP_MAX, TEXTURE_MAX } from '../brushtip.js';
import { loadImage } from '../doc.js';
import { registerTip, registerTexture, forgetBrushImage } from '../painter.js';
import { TEXTURES } from '../textures.js';
import { TIPS, TOOL_BY_ID, BRUSH_KEYS, applySettings } from '../tools.js';
import { esc, toast, menu, modal, promptBox, confirmBox, store } from '../ui.js';

const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const IMG_RE = /^image\//;

/** Reads an image file as PNG bytes (other formats are converted), with its name without the extension. */
async function fileAsPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not read that image.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

/** A small picture of a pressure curve (x: pressure, y: result). */
export function curveSvg(pts) {
  const line = Array.from({ length: 25 }, (_, i) => `${(i / 24 * 40).toFixed(1)},${(16 - curveAt(pts, i / 24) * 16).toFixed(1)}`).join(' ');
  return `<svg class="curve" viewBox="-1 -1 42 18" aria-hidden="true"><rect x="0" y="0" width="40" height="16"/><polyline points="${line}"/></svg>`;
}

export const brushMethods = {
  /** Loads the brush library from the app folder and registers its images; settings naming a missing image fall back. */
  async loadBrushLibrary() {
    try {
      this.brushLib = await api.brushes();
    } catch {
      this.brushLib = { images: [], presets: [] };
    }
    await Promise.all(this.brushLib.images.map(i => this.registerBrushImage(i).catch(() => {})));
    if (!this.destroyed) this.renderToolProps();
  },

  async registerBrushImage(entry) {
    const img = await loadImage(api.brushImageUrl(entry.id));
    const { w, h } = fitSide(img.naturalWidth, img.naturalHeight, entry.kind === 'tip' ? TIP_MAX : TEXTURE_MAX);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    if (entry.kind === 'tip') {
      const mask = tipMask(data.data), out = new ImageData(w, h);
      for (let i = 0; i < mask.length; i++) out.data[i * 4 + 3] = mask[i];
      ctx.putImageData(out, 0, 0);
      registerTip(entry.id, c);
    } else registerTexture(entry.id, textureGray(data.data), w, h);
    entry.ready = true;
  },

  brushImages(kind) {
    return (this.brushLib?.images || []).filter(i => i.kind === kind && i.ready);
  },

  /** Options for the Tip and Texture choices: the built-in ones plus the library's images. */
  tipChoices() { return [...TIPS, ...this.brushImages('tip').map(i => [`img:${i.id}`, i.name])]; },
  textureChoices() { return [...TEXTURES, ...this.brushImages('texture').map(i => [`img:${i.id}`, i.name])]; },

  /** The Brush row at the top of a paint tool's panel: the saved brush it came from, and the brush menu. */
  presetRowHtml(s) {
    const presets = this.brushLib?.presets || [];
    const cur = presets.some(p => p.id === s.preset) ? s.preset : '';
    return `<div class="preset-row"><label class="slider" title="Saved brushes: pick one to load its settings"><span>Brush</span>
      <select data-preset><option value="">${presets.length ? '(Not saved)' : '(No saved brushes)'}</option>${presets.map(p =>
        `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <button class="icon-btn" data-brush-menu title="Save, import and manage brushes">⋯</button></div>`;
  },

  bindPresetRow(box) {
    const sel = box.querySelector('[data-preset]');
    if (sel) sel.onchange = () => { if (sel.value) this.applyPreset(sel.value); };
    const btn = box.querySelector('[data-brush-menu]');
    if (btn) btn.onclick = () => this.brushMenu(btn);
    box.querySelectorAll('[data-clear-curve]').forEach(b => {
      b.onclick = e => {
        e.preventDefault();
        this.settings[this.tool][b.dataset.clearCurve] = null;
        store('tools', this.settings);
        this.renderToolProps();
      };
    });
  },

  brushMenu(button) {
    const s = this.settings[this.tool], p = this.brushLib?.presets.find(x => x.id === s.preset);
    menu(button, [
      { label: 'Save as new brush…', run: () => this.saveBrushAs() },
      { label: p ? `Update “${p.name}”` : 'Update brush', disabled: !p, run: () => this.updatePreset(p) },
      { label: 'Rename brush…', disabled: !p, run: () => this.renamePreset(p) },
      { label: 'Delete brush…', disabled: !p, run: () => this.deletePreset(p) },
      '-',
      { label: 'Import Clip Studio Paint brush (.sut)…', run: () => this.importSut() },
      '-',
      { label: 'Add tip image…', run: () => this.addBrushImageFile('tip') },
      { label: 'Add texture image…', run: () => this.addBrushImageFile('texture') },
      { label: 'Tip and texture images…', disabled: !this.brushLib?.images.length, run: () => this.brushImagesDialog() },
    ]);
  },

  async savePresetList() {
    try {
      await api.savePresets(this.brushLib.presets.map(({ id, name, settings, source }) => ({ id, name, settings, source })));
      return true;
    } catch (e) {
      toast('Could not save the brushes: ' + e.message, { error: true });
      return false;
    }
  },

  brushSettingsOf(s) { return Object.fromEntries(BRUSH_KEYS.filter(k => k in s).map(k => [k, s[k]])); },

  applyPreset(id) {
    const p = this.brushLib.presets.find(x => x.id === id), s = this.settings[this.tool];
    if (!p || !('tip' in s)) return;
    applySettings(s, p.settings);
    s.preset = p.id;
    store('tools', this.settings);
    this.renderToolProps();
    this.drawOverlay();
  },

  async saveBrushAs() {
    const s = this.settings[this.tool];
    const name = await promptBox('Save as new brush', 'Name', `${TOOL_BY_ID[this.tool].label} ${this.brushLib.presets.length + 1}`);
    if (!name) return;
    const p = { id: newId(), name, settings: this.brushSettingsOf(s) };
    this.brushLib.presets.push(p);
    if (await this.savePresetList()) { s.preset = p.id; store('tools', this.settings); toast(`Saved the brush “${name}”`); }
    this.renderToolProps();
  },

  async updatePreset(p) {
    p.settings = this.brushSettingsOf(this.settings[this.tool]);
    if (await this.savePresetList()) toast(`Updated “${p.name}”`);
  },

  async renamePreset(p) {
    const name = await promptBox('Rename brush', 'Name', p.name);
    if (!name) return;
    p.name = name;
    await this.savePresetList();
    this.renderToolProps();
  },

  async deletePreset(p) {
    if (!(await confirmBox('Delete brush', `Delete the saved brush “${p.name}”? The tool keeps its current settings.`, 'Delete'))) return;
    this.brushLib.presets = this.brushLib.presets.filter(x => x !== p);
    for (const s of Object.values(this.settings)) if (s.preset === p.id) s.preset = '';
    store('tools', this.settings);
    await this.savePresetList();
    this.renderToolProps();
  },

  /** Asks for an image file and adds it to the library; resolves to its entry, or null. */
  async uploadBrushImage(kind, name = '') {
    const file = await pickFile('image/*');
    if (!file) return null;
    if (!IMG_RE.test(file.type || 'image/')) { toast('Choose a picture file (PNG works best).', { error: true }); return null; }
    try {
      const entry = await api.addBrushImage(kind, name || file.name.replace(/\.[^.]+$/, ''), await fileAsPng(file));
      await this.registerBrushImage(entry);
      this.brushLib.images.push(entry);
      return entry;
    } catch (e) {
      toast('Could not add that image: ' + e.message, { error: true });
      return null;
    }
  },

  /** Brush menu → Add tip/texture image…: adds it and uses it in the current paint tool. */
  async addBrushImageFile(kind) {
    const entry = await this.uploadBrushImage(kind);
    if (!entry) return;
    const s = this.settings[this.tool];
    if (kind === 'tip' && 'tip' in s) s.tip = `img:${entry.id}`;
    if (kind === 'texture' && 'texture' in s) { s.texture = `img:${entry.id}`; if (!(s.textureAmount > 0)) s.textureAmount = 0.5; }
    store('tools', this.settings);
    this.renderToolProps();
    toast(`Added the ${kind} “${entry.name}”`);
  },

  async brushImagesDialog() {
    const rows = () => this.brushLib.images.map(i => `<div class="pick-row"><img src="${api.brushImageUrl(i.id)}" alt="">
      <div class="grow"><b>${esc(i.name)}</b><div class="muted small">${i.kind === 'tip' ? 'Tip' : 'Texture'}</div></div>
      <button data-del="${esc(i.id)}">Delete</button></div>`).join('') || '<p class="muted">No images.</p>';
    await modal({
      title: 'Tip and texture images',
      body: `<div class="pick-list">${rows()}</div><p class="muted small">Brushes that use a deleted image go back to a round tip or no texture.</p>`,
      buttons: [{ label: 'Close', value: null, primary: true }],
      onOpen: root => {
        const bind = () => root.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = async () => {
            const id = b.dataset.del;
            try { await api.deleteBrushImage(id); } catch (e) { toast(e.message, { error: true }); return; }
            this.brushLib.images = this.brushLib.images.filter(i => i.id !== id);
            forgetBrushImage(id);
            for (const s of Object.values(this.settings)) {
              if (imageRef(s.tip) === id) s.tip = 'round';
              if (imageRef(s.texture) === id) s.texture = 'none';
            }
            store('tools', this.settings);
            root.querySelector('.pick-list').innerHTML = rows();
            bind();
            this.renderToolProps();
          };
        });
        bind();
      },
    });
  },

  /** Brush menu → Import Clip Studio Paint brush: reads its settings, asks for its tip and texture images, saves it. */
  async importSut() {
    const file = await pickFile('.sut');
    if (!file) return;
    let res;
    try {
      res = await api.importSut(await file.arrayBuffer());
    } catch (e) {
      toast(e.message, { error: true });
      return;
    }
    const byName = (kind, name) => this.brushImages(kind).find(i => name && i.name === name);
    const tipName = res.tips[0] || '', texName = res.texture || '';
    const choice = { tip: byName('tip', tipName)?.id || '', texture: byName('texture', texName)?.id || '' };
    const picker = (kind, cspName) => {
      const opts = this.brushImages(kind);
      const none = kind === 'tip' ? 'Round tip' : 'No texture';
      return `<label class="field"><span>${kind === 'tip' ? 'Tip image' : 'Texture image'}</span>
        <div class="img-pick"><select data-pick="${kind}"><option value="">${none}</option>${opts.map(i =>
          `<option value="${i.id}" ${i.id === choice[kind] ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
        <button type="button" data-add="${kind}">Choose image…</button></div></label>
        <p class="muted small">In Clip Studio Paint it uses the ${kind} “${esc(cspName)}”. Its image is locked inside the brush file, so choose a picture of it.</p>`;
    };
    const ok = await modal({
      title: 'Import Clip Studio Paint brush',
      body: `<div class="sut-head">${res.icon ? `<img src="${res.icon}" alt="">` : ''}<label class="field grow"><span>Name</span>
          <input type="text" name="name" maxlength="120" value="${esc(res.name)}"></label></div>
        ${tipName ? picker('tip', tipName) : ''}
        ${texName ? picker('texture', texName) : ''}
        ${res.notes.length ? `<p class="muted small">Not carried over: ${esc(res.notes.join(', '))}.</p>` : ''}
        <p class="muted small">Size, density, spacing, tip angle and squash, pen pressure curves and texture strength come from the brush.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Import', primary: true }],
      onOpen: root => {
        root.querySelectorAll('[data-pick]').forEach(sel => { sel.onchange = () => { choice[sel.dataset.pick] = sel.value; }; });
        root.querySelectorAll('[data-add]').forEach(b => {
          b.onclick = async () => {
            const kind = b.dataset.add;
            b.disabled = true;
            const entry = await this.uploadBrushImage(kind, kind === 'tip' ? tipName : texName).finally(() => { b.disabled = false; });
            if (!entry) return;
            const sel = root.querySelector(`[data-pick="${kind}"]`);
            sel.insertAdjacentHTML('beforeend', `<option value="${entry.id}">${esc(entry.name)}</option>`);
            sel.value = choice[kind] = entry.id;
          };
        });
      },
      collect: root => root.querySelector('[name="name"]').value.trim() || res.name,
    });
    if (!ok) return;
    const settings = { ...this.brushSettingsOf(TOOL_BY_ID.brush.defaults), ...res.settings,
      tip: choice.tip ? `img:${choice.tip}` : 'round', texture: choice.texture ? `img:${choice.texture}` : 'none' };
    const p = { id: newId(), name: ok, settings: applySettings(this.brushSettingsOf(TOOL_BY_ID.brush.defaults), settings), source: 'Clip Studio Paint' };
    this.brushLib.presets.push(p);
    if (!(await this.savePresetList())) return;
    if (TOOL_BY_ID[this.tool].kind !== 'paint' || TOOL_BY_ID[this.tool].erase) this.selectTool('pencil');
    this.applyPreset(p.id);
    toast(`Imported “${p.name}”`);
  },
};
