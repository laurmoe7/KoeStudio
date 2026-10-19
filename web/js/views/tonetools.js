// Screentone: new tone layers, a layer's tone settings, and rasterizing a tone into plain dots. A tone layer is an
// ordinary layer with `tone` set (tone.js); its gray levels are shown as dots by composite(). Editor methods
// (mixed into Editor.prototype in editor.js).

import { Layer, tonedCanvas } from '../doc.js';
import { TONE_SHAPES, TONE_CELL, TONE_FADES, LPI_PRESETS, toneFadeLine, defaultTone, sanitizeTone, applyTone, densityGray, toneLpi, cellForLpi } from '../tone.js';
import { isFolder } from '../tree.js';
import { esc, modal, store, toast } from '../ui.js';
import { snapBytes } from '../snapshot.js';

const PREVIEW_W = 360, PREVIEW_H = 56;

export const toneMethods = {
  /** Layer → New screentone: a tone layer filled (inside the selection, if any) with the chosen density. */
  async newToneLayer() {
    this.finishTransform();
    this.finishText();
    const last = store('tone') || {};
    const res = await toneDialog({ title: 'New screentone', tone: sanitizeTone(last) || defaultTone(), density: last.density ?? 0.3,
      fade: last.fade || 'none', fadeTo: last.fadeTo ?? 0, ok: 'Create', dpi: this.doc.dpi });
    if (!res) return;
    store('tone', { ...res.tone, density: res.density, fade: res.fade, fadeTo: res.fadeTo });
    const d = this.doc;
    const used = new Set(d.layers.map(l => l.name));
    let k = 1;
    while (used.has(`Tone ${k}`)) k++;
    const layer = new Layer(d.width, d.height, { name: `Tone ${k}`, tone: res.tone });
    const g = densityGray(res.density);
    // a gradient tone fades from the density to `fadeTo` across the selection (or the canvas)
    const line = toneFadeLine(this.sel.active ? this.sel.bounds : { x: 0, y: 0, w: d.width, h: d.height }, res.fade);
    if (line) {
      const grad = layer.ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1), g2 = densityGray(res.fadeTo);
      grad.addColorStop(0, `rgb(${g},${g},${g})`);
      grad.addColorStop(1, `rgb(${g2},${g2},${g2})`);
      layer.ctx.fillStyle = grad;
    } else layer.ctx.fillStyle = `rgb(${g},${g},${g})`;
    layer.ctx.fillRect(0, 0, d.width, d.height);
    if (this.sel.active) this.sel.clipCanvas(layer.ctx, { x: 0, y: 0, w: d.width, h: d.height });
    this.insertNode(layer, 'New screentone');
    toast('Paint on a tone layer in gray: darker gives denser dots, white or erasing removes them.', { ms: 6000 });
  },

  /** Layer → Screentone settings: turn the selected layer's tone on or off and change its dots. */
  async toneDialog() {
    const n = this.doc.active;
    if (isFolder(n) || n.adjust) return toast('Screentone works on layers with pixels. Select one.');
    const res = await toneDialog({ title: 'Layer screentone', tone: n.tone || sanitizeTone(store('tone')) || defaultTone(), on: !!n.tone, ok: 'OK', dpi: this.doc.dpi });
    if (!res) return;
    this.setLayerProp(n, 'tone', res.on ? res.tone : null, res.on ? 'Screentone' : 'Screentone off');
  },

  /** Replaces a tone layer's gray levels by the dots they show, so it becomes an ordinary layer. */
  rasterizeTone(n) {
    if (!n.tone) return;
    const d = this.doc, W = d.width, H = d.height, tone = n.tone;
    // GPU copies for undo (trimmed when idle), not readbacks of the whole layer
    const full = { x: 0, y: 0, w: W, h: H }, before = this.snapshot(n, full), after = this.snapshot({ canvas: tonedCanvas(n) }, full);
    const put = img => { this.putSnapshot(n, full, img); n.touch(); };
    const tx = this.textsIn([n]);
    this.structural('Rasterize screentone',
      () => { put(after); n.tone = null; tx.drop(); },
      () => { put(before); n.tone = tone; tx.restore(); },
      () => snapBytes(before) + snapBytes(after));
  },
};

/**
 * The tone settings dialog with a preview strip (density 0-100% left to right). Spacing and lines per inch (at the
 * artwork's dpi) are two ways to set the same thing and follow each other. Resolves to {tone, density, on} or null.
 */
function toneDialog({ title, tone, density = null, on = null, ok, dpi = 72, fade = null, fadeTo = 0 }) {
  const lpi = v => Math.round(toneLpi(v, dpi) * 10) / 10;
  const shapes = TONE_SHAPES.map(([v, l]) => `<option value="${v}" ${tone.shape === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return modal({
    title,
    body: `
      ${on === null ? '' : `<label class="check"><input type="checkbox" name="on" ${on ? 'checked' : ''}> Show this layer as screentone</label>`}
      <div class="field-row">
        ${density === null ? '' : `<label class="field" title="How much of the area the dots cover"><span>Density (%)</span><input type="number" name="density" min="1" max="100" value="${Math.round(density * 100)}"></label>`}
        <label class="field" title="Distance between dot centres"><span>Spacing (px)</span><input type="number" name="cell" min="${TONE_CELL[0]}" max="${TONE_CELL[1]}" step="0.5" value="${tone.cell}"></label>
        <label class="field" title="Lines of dots per inch when printed at this artwork's ${dpi} dpi (comics often use 50-70)"><span>Lines per inch</span><input type="number" name="lpi" min="1" step="any" list="tone-lpi" value="${lpi(tone.cell)}"></label>
        <datalist id="tone-lpi">${LPI_PRESETS.map(v => `<option value="${v}">`).join('')}</datalist>
        <label class="field"><span>Angle (°)</span><input type="number" name="angle" min="-90" max="90" value="${tone.angle}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Shape</span><select name="shape">${shapes}</select></label>
        <label class="field"><span>Dot color</span><input type="color" name="color" value="${tone.color}"></label>
        <label class="field" title="Shifts the dots sideways, so they fall between another tone's dots"><span>Shift X (px)</span><input type="number" name="x" step="0.5" min="${-TONE_CELL[1]}" max="${TONE_CELL[1]}" value="${tone.x || 0}"></label>
        <label class="field" title="Shifts the dots up or down"><span>Shift Y (px)</span><input type="number" name="y" step="0.5" min="${-TONE_CELL[1]}" max="${TONE_CELL[1]}" value="${tone.y || 0}"></label>
      </div>
      ${fade === null ? '' : `<div class="field-row">
        <label class="field" title="A gradient tone: the dots fade from the density above to this one"><span>Fade</span><select name="fade">${TONE_FADES.map(([v, l]) => `<option value="${v}" ${fade === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Fade to density (%)</span><input type="number" name="fadeTo" min="0" max="100" value="${Math.round(fadeTo * 100)}"></label>
      </div>`}
      <canvas class="tone-preview" width="${PREVIEW_W}" height="${PREVIEW_H}" aria-label="Preview"></canvas>
      <p class="muted small tone-lpi"></p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true }],
    onOpen: root => {
      const draw = () => drawPreview(root, read(root).tone, dpi);
      const cell = root.querySelector('[name="cell"]'), lines = root.querySelector('[name="lpi"]');
      cell.addEventListener('input', () => { if (+cell.value) lines.value = lpi(sanitizeTone({ cell: cell.value }).cell); });
      lines.addEventListener('input', () => { if (+lines.value > 0) cell.value = cellForLpi(lines.value, dpi); });
      root.querySelectorAll('input, select').forEach(el => el.addEventListener('input', draw));
      draw();
    },
    collect: root => read(root),
  });
}

function read(root) {
  const v = name => root.querySelector(`[name="${name}"]`)?.value;
  const tone = sanitizeTone({ cell: v('cell'), angle: v('angle'), shape: v('shape'), color: v('color'), x: v('x'), y: v('y') });
  const dens = root.querySelector('[name="density"]'), fade = root.querySelector('[name="fade"]');
  return {
    tone,
    fade: fade ? fade.value : 'none',
    fadeTo: Math.max(0, Math.min(1, (+v('fadeTo') || 0) / 100)),
    density: dens ? Math.max(0.01, Math.min(1, (+dens.value || 30) / 100)) : null,
    on: root.querySelector('[name="on"]')?.checked ?? true,
  };
}

function drawPreview(root, tone, dpi) {
  const c = root.querySelector('.tone-preview'), ctx = c.getContext('2d');
  const img = ctx.createImageData(PREVIEW_W, PREVIEW_H);
  for (let y = 0; y < PREVIEW_H; y++) {
    for (let x = 0; x < PREVIEW_W; x++) {
      const i = (y * PREVIEW_W + x) * 4, g = densityGray(x / (PREVIEW_W - 1));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  applyTone(img.data, PREVIEW_W, PREVIEW_H, 0, 0, tone);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  const tmp = document.createElement('canvas');
  tmp.width = PREVIEW_W; tmp.height = PREVIEW_H;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  // print sizes: a 350 dpi page is the usual manga resolution, so say what the spacing gives there too
  root.querySelector('.tone-lpi').textContent = tone.shape === 'noise'
    ? 'Noise: spacing sets the grain size.'
    : `${Math.round(toneLpi(tone.cell, dpi) * 10) / 10} lines per inch at this artwork's ${dpi} dpi`
      + (dpi === 350 ? '.' : ` (${Math.round(toneLpi(tone.cell, 350))} at 350 dpi, the usual for comic pages).`);
}
