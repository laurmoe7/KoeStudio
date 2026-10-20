// Color mixing panel (Clip Studio Paint's Window → Color Mixing): a small scratch area under the Color panel where
// you dab colours with a little brush, push them into each other with a blender, and click to take a colour as the
// main colour. The pixels are mixpad.js's (RGBA in memory, shown over white paper) and are kept per computer through
// the server (<app dir>/mixing.png), saved a second after the last change. Tool and size are kept in koe.mixPad.
// It never touches the artwork: it only reads and sets the Color panel's main colour.

import { newPad, clearPad, pickColor, PadStroke, PAD_W, PAD_H, PAD_SIZES } from '../mixpad.js';
import { rgbHex } from '../wetmix.js';
import { hexToRgb } from '../color.js';
import { icon } from '../icons.js';
import { store, toast } from '../ui.js';
import { api } from '../api.js';

/** The paints along the bottom: white, black and a small painter's set. */
export const MIX_PAINTS = ['#ffffff', '#1b1b1f', '#d7263d', '#f08a24', '#f4c430', '#2e9b4f', '#1f5fbf', '#6b3fa0', '#8a5a35', '#f2c6a0'];
const MODES = [
  ['brush', 'brush', 'Brush: paints the main colour, mixing it with the paint under it'],
  ['blend', 'smudge', 'Blender: pushes the paint around and blends it'],
  ['pick', 'picker', 'Eyedropper: click to make a colour the main colour (Alt+click with the brush or blender)'],
];
const SAVE_MS = 1000;

export class MixPanel {
  /** colors: the editor's ColorPanel. */
  constructor(root, colors) {
    this.root = root;
    this.colors = colors;
    const saved = store('mixPad') || {};
    this.mode = MODES.some(m => m[0] === saved.mode) ? saved.mode : 'brush';
    this.size = Math.max(PAD_SIZES[0], Math.min(PAD_SIZES[1], Math.round(+saved.size) || 14));
    this.pad = newPad();
    root.innerHTML = `
      <div class="mx-bar">
        ${MODES.map(([m, ic, tip]) => `<button class="icon-btn" data-mode="${m}" title="${tip}">${icon(ic, 16)}</button>`).join('')}
        <input class="mx-size" type="range" min="${PAD_SIZES[0]}" max="${PAD_SIZES[1]}" step="1" title="Brush size" aria-label="Brush size">
        <button class="icon-btn mx-clear" title="Clear the mixing area">${icon('trash', 15)}</button>
      </div>
      <canvas class="mx-pad" width="${PAD_W}" height="${PAD_H}"></canvas>
      <div class="mx-paints" title="Paints: click one to make it the main colour">
        ${MIX_PAINTS.map(c => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')}
      </div>`;
    this.canvas = root.querySelector('.mx-pad');
    this.ctx = this.canvas.getContext('2d');
    root.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { this.mode = b.dataset.mode; this.remember(); this.drawBar(); }; });
    const size = root.querySelector('.mx-size');
    size.value = this.size;
    size.oninput = () => { this.size = +size.value; this.remember(); };
    root.querySelector('.mx-clear').onclick = () => this.clear();
    root.querySelectorAll('.mx-paints button').forEach(b => { b.onclick = () => this.colors.set(b.dataset.c); });
    this.bindPad();
    this.drawBar();
    this.load();
  }

  remember() {
    store('mixPad', { mode: this.mode, size: this.size });
  }

  drawBar() {
    this.root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === this.mode));
    this.canvas.dataset.mode = this.mode;
  }

  /** The kept pixels from the server (none the first time). */
  load() {
    const img = new Image();
    img.onload = () => {
      if (this.dirtySince) return;  // painted on before it arrived: keep that
      const c = document.createElement('canvas');
      c.width = PAD_W; c.height = PAD_H;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      this.pad.data.set(cx.getImageData(0, 0, PAD_W, PAD_H).data);
      c.width = c.height = 0;
      this.show();
    };
    img.src = api.mixPadUrl() + '?t=' + Date.now();
  }

  show() {
    this.ctx.putImageData(new ImageData(this.pad.data, PAD_W, PAD_H), 0, 0);
  }

  /** Redraws once per frame however many pointer moves came in. */
  scheduleShow() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.show(); });
  }

  bindPad() {
    const c = this.canvas;
    const at = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * PAD_W / r.width, (e.clientY - r.top) * PAD_H / r.height]; };
    const pressure = e => (e.pointerType === 'pen' ? e.pressure : 1);
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const picking = this.mode === 'pick' || e.altKey;
      const rgb = hexToRgb(this.colors.main) || [0, 0, 0];
      const stroke = picking ? null : new PadStroke(this.pad, { mode: this.mode, size: this.size, color: { r: rgb[0], g: rgb[1], b: rgb[2] } });
      const move = ev => {
        if (picking) { this.colors.set(rgbHex(pickColor(this.pad, ...at(ev), 3))); return; }
        const all = ev.getCoalescedEvents?.();  // empty for some events
        for (const p of all?.length ? all : [ev]) stroke.add(...at(p), pressure(p));
        this.touched();
      };
      move(e);
      c.onpointermove = move;
      c.onpointerup = c.onpointercancel = () => { c.onpointermove = c.onpointerup = c.onpointercancel = null; };
    });
  }

  /** After a change: show it and save it a moment after the last one. */
  touched() {
    this.dirtySince ||= Date.now();
    this.scheduleShow();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_MS);
  }

  clear() {
    const before = this.pad.data.slice();
    if (!before.some(v => v)) return;
    clearPad(this.pad);
    this.touched();
    toast('Cleared the mixing area', { action: { label: 'Undo', run: () => { this.pad.data.set(before); this.touched(); } } });
  }

  async save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.show();
    const blob = await new Promise(r => this.canvas.toBlob(r, 'image/png'));
    try { if (blob) await api.saveMixPad(blob); } catch (e) { toast('Could not keep the mixing area: ' + e.message, { error: true }); }
  }

  /** Saves at once if a change is waiting (the editor is closing). */
  async flush() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.saveTimer) await this.save();
  }
}
