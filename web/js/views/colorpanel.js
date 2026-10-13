// Colour panel: saturation/value square, hue bar, main and sub colour, hex box and recently used colours.

import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from '../color.js';
import { icon } from '../icons.js';
import { store, esc } from '../ui.js';

const SQ = 180, BAR = 14;

export class ColorPanel {
  constructor(root) {
    this.root = root;
    const saved = store('colors') || {};
    this.main = hexToRgb(saved.main) ? saved.main : '#1b1b1f';
    this.sub = hexToRgb(saved.sub) ? saved.sub : '#ffffff';
    this.recent = Array.isArray(saved.recent) ? saved.recent.filter(c => hexToRgb(c)).slice(0, 18) : [];
    this.hsv = rgbToHsv(...hexToRgb(this.main));
    root.innerHTML = `
      <div class="cp-row">
        <canvas class="cp-sv" width="${SQ}" height="${SQ}"></canvas>
        <canvas class="cp-hue" width="${BAR}" height="${SQ}"></canvas>
      </div>
      <div class="cp-row cp-controls">
        <div class="cp-swatches" title="Main and sub color (X swaps them)">
          <button class="cp-sub" aria-label="Sub color"></button>
          <button class="cp-main" aria-label="Main color"></button>
        </div>
        <button class="icon-btn cp-swap" title="Swap main and sub color (X)">${icon('swap', 18)}</button>
        <input class="cp-hex" type="text" maxlength="7" spellcheck="false" aria-label="Hex color">
      </div>
      <div class="cp-recent" aria-label="Recent colors"></div>`;
    this.sv = root.querySelector('.cp-sv');
    this.hue = root.querySelector('.cp-hue');
    this.hex = root.querySelector('.cp-hex');
    this.drawHue();
    this.drag(this.sv, (x, y) => this.setHsv([this.hsv[0], x / SQ, 1 - y / SQ]));
    this.drag(this.hue, (x, y) => this.setHsv([(y / SQ) * 360, this.hsv[1], this.hsv[2]]));
    root.querySelector('.cp-swap').onclick = () => this.swap();
    root.querySelector('.cp-sub').onclick = () => this.swap();
    this.hex.addEventListener('change', () => {
      const rgb = hexToRgb(this.hex.value);
      if (rgb) this.set(rgbToHex(...rgb));
      else this.hex.value = this.main;
    });
    this.refresh();
  }

  drag(canvas, fn) {
    canvas.addEventListener('pointerdown', e => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const move = ev => {
        const r = canvas.getBoundingClientRect();
        fn(Math.max(0, Math.min(SQ, (ev.clientX - r.left) * SQ / r.width)), Math.max(0, Math.min(SQ, (ev.clientY - r.top) * SQ / r.height)));
      };
      move(e);
      canvas.onpointermove = move;
      canvas.onpointerup = () => { canvas.onpointermove = null; this.save(); };
    });
  }

  setHsv(hsv) {
    this.hsv = hsv;
    this.main = rgbToHex(...hsvToRgb(...hsv));
    this.refresh(false);
  }

  /** Sets the main colour from a hex string (eyedropper, hex box, recent swatch). */
  set(hex) {
    this.main = hex;
    const hsv = rgbToHsv(...hexToRgb(hex));
    // keep the hue when the new colour is grey, so the square does not jump to red
    if (hsv[1] === 0 || hsv[2] === 0) hsv[0] = this.hsv[0];
    this.hsv = hsv;
    this.refresh();
    this.save();
  }

  swap() {
    [this.main, this.sub] = [this.sub, this.main];
    this.set(this.main);
  }

  /** Called when a stroke uses the main colour, so it joins the recent list. */
  used() {
    this.recent = [this.main, ...this.recent.filter(c => c !== this.main)].slice(0, 18);
    this.drawRecent();
    this.save();
  }

  save() {
    store('colors', { main: this.main, sub: this.sub, recent: this.recent });
  }

  drawHue() {
    const ctx = this.hue.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, SQ);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BAR, SQ);
  }

  refresh(updateHex = true) {
    const [h, s, v] = this.hsv;
    const ctx = this.sv.getContext('2d');
    ctx.fillStyle = `hsl(${h},100%,50%)`;
    ctx.fillRect(0, 0, SQ, SQ);
    let g = ctx.createLinearGradient(0, 0, SQ, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SQ, SQ);
    g = ctx.createLinearGradient(0, 0, 0, SQ);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SQ, SQ);
    ctx.lineWidth = 2;
    ctx.strokeStyle = v > 0.55 && s < 0.5 ? '#000' : '#fff';
    ctx.beginPath(); ctx.arc(s * SQ, (1 - v) * SQ, 6, 0, Math.PI * 2); ctx.stroke();
    this.drawHue();
    const hc = this.hue.getContext('2d');
    hc.strokeStyle = '#fff'; hc.lineWidth = 2;
    hc.strokeRect(1, (h / 360) * SQ - 2, BAR - 2, 4);
    this.root.querySelector('.cp-main').style.background = this.main;
    this.root.querySelector('.cp-sub').style.background = this.sub;
    if (updateHex || document.activeElement !== this.hex) this.hex.value = this.main;
    this.drawRecent();
  }

  drawRecent() {
    const box = this.root.querySelector('.cp-recent');
    box.innerHTML = this.recent.map(c => `<button style="background:${esc(c)}" title="${esc(c)}" data-c="${esc(c)}"></button>`).join('');
    box.querySelectorAll('button').forEach(b => { b.onclick = () => this.set(b.dataset.c); });
  }
}
