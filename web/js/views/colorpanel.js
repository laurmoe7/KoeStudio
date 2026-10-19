// Colour panel: saturation/value square, hue bar, main and sub colour, hex box, recently used colours and a saved
// palette (+ adds the main colour, a click picks one, right-click removes it; kept per machine in koe.palette).
// Under the square, HSV or RGB sliders with number boxes (the mode, or hidden, is kept in koe.colorSliders).
// The square and hue bar can be swapped for a colour wheel: a hue ring round the square (koe.colorWheel).
// The palette's ⋯ menu imports palette files (palettes.js: .gpl, .aco, .ase, hex lists) and exports a .gpl.

import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, mixSteps, paletteAdd, sanitizePalette, PALETTE_MAX, SLIDER_CHANNELS, sliderValues, fromSlider, sliderStops, wheelLayout, wheelHit } from '../color.js';
import { icon } from '../icons.js';
import { store, esc, menu, modal, toast, confirmBox } from '../ui.js';
import { api } from '../api.js';
import { parsePalette, gplText } from '../palettes.js';
import { browseFile } from './filebrowser.js';

const SQ = 180, BAR = 14, WHEEL = 200, RING = 18;

export class ColorPanel {
  constructor(root) {
    this.root = root;
    const saved = store('colors') || {};
    this.main = hexToRgb(saved.main) ? saved.main : '#1b1b1f';
    this.sub = hexToRgb(saved.sub) ? saved.sub : '#ffffff';
    this.recent = Array.isArray(saved.recent) ? saved.recent.filter(c => hexToRgb(c)).slice(0, 18) : [];
    this.palette = sanitizePalette(store('palette'));
    this.hsv = rgbToHsv(...hexToRgb(this.main));
    root.innerHTML = `
      <div class="cp-row cp-square">
        <canvas class="cp-sv" width="${SQ}" height="${SQ}"></canvas>
        <canvas class="cp-hue" width="${BAR}" height="${SQ}"></canvas>
      </div>
      <canvas class="cp-wheel" width="${WHEEL}" height="${WHEEL}" hidden></canvas>
      <div class="cp-row cp-controls">
        <div class="cp-swatches" title="Main and sub color (X swaps them)">
          <button class="cp-sub" aria-label="Sub color"></button>
          <button class="cp-main" aria-label="Main color"></button>
        </div>
        <button class="icon-btn cp-swap" title="Swap main and sub color (X)">${icon('swap', 18)}</button>
        <input class="cp-hex" type="text" maxlength="7" spellcheck="false" aria-label="Hex color">
        <button class="icon-btn cp-shape" title="Colour wheel or square">${icon('wheel', 18)}</button>
      </div>
      <div class="cp-mix" title="Colours between the main and sub colour: click one to use it"></div>
      <div class="cp-slider-head"><span>Sliders</span>
        <span class="cp-modes">${['hsv', 'rgb', 'off'].map(m => `<button data-mode="${m}">${m === 'off' ? 'Hide' : m.toUpperCase()}</button>`).join('')}</span></div>
      <div class="cp-sliders"></div>
      <div class="cp-recent" aria-label="Recent colors"></div>
      <div class="cp-palette-head"><span>Palette</span><span><button class="icon-btn cp-add" title="Add the main color to the palette">${icon('plus', 14)}</button><button class="icon-btn cp-pal-more" title="Import, export or clear the palette">${icon('more', 14)}</button></span></div>
      <div class="cp-palette" aria-label="Palette"></div>`;
    this.sv = root.querySelector('.cp-sv');
    this.hue = root.querySelector('.cp-hue');
    this.hex = root.querySelector('.cp-hex');
    this.sliderMode = ['hsv', 'rgb', 'off'].includes(store('colorSliders')) ? store('colorSliders') : 'hsv';
    root.querySelectorAll('.cp-modes button').forEach(b => { b.onclick = () => { this.sliderMode = b.dataset.mode; store('colorSliders', this.sliderMode); this.buildSliders(); }; });
    this.buildSliders();
    this.drawHue();
    this.wheel = root.querySelector('.cp-wheel');
    this.useWheel = store('colorWheel') === true;
    root.querySelector('.cp-shape').onclick = () => { this.useWheel = !this.useWheel; store('colorWheel', this.useWheel); this.refresh(false); };
    this.bindWheel();
    this.drag(this.sv, (x, y) => this.setHsv([this.hsv[0], x / SQ, 1 - y / SQ]));
    this.drag(this.hue, (x, y) => this.setHsv([(y / SQ) * 360, this.hsv[1], this.hsv[2]]));
    root.querySelector('.cp-swap').onclick = () => this.swap();
    root.querySelector('.cp-add').onclick = () => { this.palette = paletteAdd(this.palette, this.main); this.savePalette(); };
    const more = root.querySelector('.cp-pal-more');
    more.onclick = () => menu(more, [
      { label: 'Import palette (.gpl, .aco, .ase, .hex)…', run: () => this.importPalette() },
      { label: 'Export palette (.gpl)…', run: () => this.exportPalette(), disabled: !this.palette.length },
      '-',
      { label: 'Clear palette', run: () => this.clearPalette(), disabled: !this.palette.length },
    ]);
    root.querySelector('.cp-sub').onclick = () => this.swap();
    this.hex.addEventListener('change', () => {
      const rgb = hexToRgb(this.hex.value);
      if (rgb) this.set(rgbToHex(...rgb));
      else this.hex.value = this.main;
    });
    this.refresh();
  }

  /** The three slider rows for the current mode (none when hidden). */
  buildSliders() {
    const box = this.root.querySelector('.cp-sliders'), mode = this.sliderMode;
    this.root.querySelectorAll('.cp-modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    box.hidden = mode === 'off';
    box.innerHTML = mode === 'off' ? '' : SLIDER_CHANNELS[mode].map(([k, label, max]) => `<label class="cp-slider" data-k="${k}">
      <span>${label}</span><input type="range" min="0" max="${max}" step="1"><input type="number" min="0" max="${max}" step="1"></label>`).join('');
    box.querySelectorAll('.cp-slider').forEach(row => {
      const k = row.dataset.k, [range, num] = row.querySelectorAll('input');
      const apply = (v, done) => {
        if (!Number.isFinite(+v) || v === '') return;
        this.setHsv(fromSlider(mode, this.hsv, k, +v));
        if (done) this.save();
      };
      range.oninput = () => apply(range.value);
      range.onchange = () => this.save();
      num.onchange = () => apply(num.value, true);
    });
    this.drawSliders();
  }

  drawSliders() {
    if (this.sliderMode === 'off') return;
    const vals = sliderValues(this.sliderMode, this.hsv);
    this.root.querySelectorAll('.cp-slider').forEach(row => {
      const k = row.dataset.k, [range, num] = row.querySelectorAll('input');
      range.style.background = `linear-gradient(to right, ${sliderStops(this.sliderMode, this.hsv, k).join(', ')})`;
      if (document.activeElement !== range) range.value = vals[k];
      if (document.activeElement !== num) num.value = vals[k];
    });
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

  /** Dragging on the wheel: the part pressed first (ring = hue, square = saturation and value) follows the pen. */
  bindWheel() {
    const c = this.wheel;
    c.addEventListener('pointerdown', e => {
      const at = ev => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) * WHEEL / r.width, (ev.clientY - r.top) * WHEEL / r.height]; };
      const first = wheelHit(...at(e), WHEEL, RING);
      if (!first) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const move = ev => {
        const h = wheelHit(...at(ev), WHEEL, RING, first.part);
        this.setHsv(h.part === 'ring' ? [h.hue, this.hsv[1], this.hsv[2]] : [this.hsv[0], h.s, h.v]);
      };
      move(e);
      c.onpointermove = move;
      c.onpointerup = () => { c.onpointermove = null; this.save(); };
    });
  }

  drawWheel() {
    const ctx = this.wheel.getContext('2d'), L = wheelLayout(WHEEL, RING), [h, s, v] = this.hsv;
    ctx.clearRect(0, 0, WHEEL, WHEEL);
    const g = ctx.createConicGradient(-Math.PI / 2, L.cx, L.cy);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.r1, 0, Math.PI * 2);
    ctx.arc(L.cx, L.cy, L.r0, 0, Math.PI * 2, true);
    ctx.fill();
    const { x, y, w } = L.sq;
    ctx.fillStyle = `hsl(${h},100%,50%)`;
    ctx.fillRect(x, y, w, w);
    let lg = ctx.createLinearGradient(x, 0, x + w, 0);
    lg.addColorStop(0, '#fff'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(x, y, w, w);
    lg = ctx.createLinearGradient(0, y, 0, y + w);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, '#000');
    ctx.fillStyle = lg; ctx.fillRect(x, y, w, w);
    // the hue marker across the ring, and the colour's spot in the square
    const a = (h - 90) * Math.PI / 180, rm = (L.r0 + L.r1) / 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(L.cx + Math.cos(a) * rm, L.cy + Math.sin(a) * rm, RING / 2 - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = v > 0.55 && s < 0.5 ? '#000' : '#fff';
    ctx.beginPath(); ctx.arc(x + s * w, y + (1 - v) * w, 6, 0, Math.PI * 2); ctx.stroke();
  }

  setHsv(hsv) {
    this.hsv = hsv;
    this.mixEnds = null;
    this.main = rgbToHex(...hsvToRgb(...hsv));
    this.refresh(false);
    this.onChange?.();
  }

  /** Sets the main colour from a hex string (eyedropper, hex box, recent swatch). fromMix: picked from the
   *  mixing strip, which then keeps its two ends. */
  set(hex, fromMix = false) {
    if (!fromMix) this.mixEnds = null;
    this.main = hex;
    const hsv = rgbToHsv(...hexToRgb(hex));
    // keep the hue when the new colour is grey, so the square does not jump to red
    if (hsv[1] === 0 || hsv[2] === 0) hsv[0] = this.hsv[0];
    this.hsv = hsv;
    this.refresh();
    this.save();
    this.onChange?.();
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
    this.root.querySelector('.cp-square').hidden = this.useWheel;
    this.wheel.hidden = !this.useWheel;
    this.root.querySelector('.cp-shape').classList.toggle('on', this.useWheel);
    if (this.useWheel) this.drawWheel();
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
    this.drawSliders();
    this.drawRecent();
    this.drawPalette();
    this.drawMix();
  }

  /** The mixing strip: nine steps from the main to the sub colour (kept while you pick from it). */
  drawMix() {
    const box = this.root.querySelector('.cp-mix'), ends = this.mixEnds || [this.main, this.sub];
    const key = ends.join() + this.main;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = mixSteps(ends[0], ends[1], 9).map(c => `<button style="background:${c}" data-c="${c}" title="${c}"${c === this.main ? ' class="on"' : ''}></button>`).join('');
    box.querySelectorAll('button').forEach(b => { b.onclick = () => { this.mixEnds = ends; this.set(b.dataset.c, true); }; });
  }

  /** Reads a palette file and adds its colours to the palette, or puts them in its place. */
  async importPalette() {
    const file = await new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.gpl,.aco,.ase,.hex,.txt';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
    if (!file) return;
    let pal;
    try { pal = parsePalette(new Uint8Array(await file.arrayBuffer()), file.name); } catch (e) { return toast(e.message, { error: true }); }
    const fresh = pal.colors.filter(c => !this.palette.includes(c)).length, room = Math.max(0, PALETTE_MAX - this.palette.length);
    const how = await modal({
      title: 'Import palette',
      body: `<p>${pal.colors.length} colour${pal.colors.length === 1 ? '' : 's'} from <b>${esc(pal.name)}</b>.</p>
        <div class="cp-palette">${pal.colors.slice(0, PALETTE_MAX).map(c => `<i class="cp-sw" style="background:${esc(c)}"></i>`).join('')}</div>
        ${pal.colors.length > PALETTE_MAX ? `<p class="muted small">Only the first ${PALETTE_MAX} fit in the palette.</p>` : ''}
        ${room < Math.min(fresh, PALETTE_MAX) ? `<p class="muted small">Adding keeps only ${room} of the ${fresh} new colours: the palette holds ${PALETTE_MAX}.</p>` : ''}`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Add to my palette', value: 'add' }, { label: 'Replace my palette', value: 'replace', primary: true }],
    });
    if (!how) return;
    this.palette = sanitizePalette(how === 'replace' ? pal.colors : [...this.palette, ...pal.colors]);
    this.savePalette();
  }

  async exportPalette() {
    const pick = await browseFile({ title: 'Export palette', dir: store('exportDir') || '', name: 'KoeStudio palette', ext: 'gpl', okLabel: 'Save' });
    if (!pick) return;
    store('exportDir', pick.dir);
    const blob = new Blob([gplText(pick.name, this.palette)]);
    try {
      let res;
      try { res = await api.exportImage(pick.name, 'gpl', blob, { dir: pick.dir, mode: 'ask' }); } catch (e) {
        if (!e.data?.exists) throw e;
        if (!await confirmBox('Replace file', `${pick.name}.gpl already exists. Replace it?`, 'Replace')) return;
        res = await api.exportImage(pick.name, 'gpl', blob, { dir: pick.dir, mode: 'replace' });
      }
      toast(`Saved the palette to ${res.path}`);
    } catch (e) {
      toast('Could not save the palette: ' + e.message, { error: true });
    }
  }

  async clearPalette() {
    if (!await confirmBox('Clear palette', `Remove all ${this.palette.length} colours from the palette?`, 'Clear')) return;
    this.palette = [];
    this.savePalette();
  }

  savePalette() {
    store('palette', this.palette);
    this.drawPalette();
  }

  drawPalette() {
    const box = this.root.querySelector('.cp-palette');
    box.innerHTML = this.palette.length
      ? this.palette.map(c => `<button style="background:${esc(c)}" title="${esc(c)}: click to use, right-click to remove" data-c="${esc(c)}"></button>`).join('')
      : '<span class="muted small">Press + to keep the main color here.</span>';
    box.querySelectorAll('button').forEach(b => {
      b.onclick = () => this.set(b.dataset.c);
      b.oncontextmenu = e => { e.preventDefault(); this.palette = this.palette.filter(c => c !== b.dataset.c); this.savePalette(); };
    });
  }

  drawRecent() {
    const box = this.root.querySelector('.cp-recent');
    box.innerHTML = this.recent.map(c => `<button style="background:${esc(c)}" title="${esc(c)}" data-c="${esc(c)}"></button>`).join('');
    box.querySelectorAll('button').forEach(b => { b.onclick = () => this.set(b.dataset.c); });
  }
}
