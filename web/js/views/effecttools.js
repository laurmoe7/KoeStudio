// Layer effects (effects.js): Layer → Layer effects… turns a Border and a Drop shadow on and off and sets them, with
// the canvas showing the result while the dialog is open; OK makes it one undo step. Layer → Rasterize layer
// effects turns them into ordinary pixels. Editor methods (mixed into Editor.prototype in editor.js).

import { effectsCanvas, tonedCanvas } from '../doc.js';
import { sanitizeEffects, BORDER_SIZE, SHADOW_OFFSET, SHADOW_BLUR } from '../effects.js';
import { EXPRESSIONS, MONO_THRESHOLD, sanitizeExpression } from '../expression.js';
import { isFolder } from '../tree.js';
import { modal, toast } from '../ui.js';
import { snapBytes } from '../snapshot.js';

export const effectMethods = {
  async layerEffectsDialog() {
    const n = this.doc.active;
    if (isFolder(n) || n.adjust) return toast('Layer effects work on layers with pixels. Select one.');
    this.finishTransform();
    this.finishText();
    const old = n.effects;
    const b = old?.border || { size: 4, color: '#ffffff' };
    const s = old?.shadow || { x: 8, y: 8, blur: 8, color: '#000000', opacity: 0.5 };
    const show = fx => { n.effects = fx; this.updateComp(null); this.requestRender(); };
    const num = (name, label, min, max, value, step = 1) =>
      `<label class="field"><span>${label}</span><input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    const res = await modal({
      title: `Layer effects: ${n.name}`,
      live: true,
      body: `
        <label class="check"><input type="checkbox" name="border" ${old?.border ? 'checked' : ''}> Border (outline round the paint)</label>
        <div class="field-row">${num('bsize', 'Width (px)', ...BORDER_SIZE, b.size)}
          <label class="field"><span>Color</span><input type="color" name="bcolor" value="${b.color}"></label></div>
        <label class="check"><input type="checkbox" name="shadow" ${old?.shadow ? 'checked' : ''}> Drop shadow</label>
        <div class="field-row">${num('sx', 'Right (px)', -SHADOW_OFFSET, SHADOW_OFFSET, s.x)}${num('sy', 'Down (px)', -SHADOW_OFFSET, SHADOW_OFFSET, s.y)}${num('sblur', 'Blur (px)', ...SHADOW_BLUR, s.blur)}</div>
        <div class="field-row">${num('sop', 'Opacity (%)', 0, 100, Math.round(s.opacity * 100))}
          <label class="field"><span>Color</span><input type="color" name="scolor" value="${s.color}"></label></div>
        <p class="muted small">The effects are drawn under the layer and never change its pixels; Layer → Rasterize → Layer effects makes them pixels.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      onOpen: root => {
        const update = () => show(readEffects(root));
        root.querySelectorAll('input').forEach(el => el.addEventListener('input', update));
      },
      collect: root => ({ fx: readEffects(root) }),
    });
    n.effects = old;
    if (!res) { this.updateComp(null); this.requestRender(); return; }
    this.setLayerProp(n, 'effects', res.fx, res.fx ? 'Layer effects' : 'Layer effects off');
  },

  /**
   * Layer → Layer color…: shows everything on the layer in one colour (Clip Studio Paint's Layer color), without
   * changing its pixels, so a shirt or hair colour can be tried out and changed back. The canvas follows the picker.
   */
  async layerColorDialog() {
    const n = this.doc.active;
    if (isFolder(n) || n.adjust) return toast('Layer color works on layers with pixels. Select one.');
    this.finishTransform();
    this.finishText();
    const old = n.layerColor;
    const show = c => { n.layerColor = c; this.updateComp(null); this.requestRender(); };
    const res = await modal({
      title: `Layer color: ${n.name}`,
      live: true,
      body: `
        <label class="check"><input type="checkbox" name="on" ${old ? 'checked' : ''}> Show this layer in one colour</label>
        <label class="field"><span>Color</span><input type="color" name="color" value="${old || this.colors.main}"></label>
        <div class="btn-row"><button type="button" data-main>Use main colour</button></div>
        <p class="muted small">The pixels stay as they are: untick to get the old colours back. Layer → Rasterize → Layer color makes it for good.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      onOpen: root => {
        const on = root.querySelector('[name="on"]'), color = root.querySelector('[name="color"]');
        const update = () => show(on.checked ? color.value.toLowerCase() : null);
        on.addEventListener('change', update);
        color.addEventListener('input', () => { on.checked = true; update(); });
        root.querySelector('[data-main]').addEventListener('click', () => { color.value = this.colors.main; on.checked = true; update(); });
        if (!old) { on.checked = true; update(); }
      },
      collect: root => ({ color: root.querySelector('[name="on"]').checked ? root.querySelector('[name="color"]').value.toLowerCase() : null }),
    });
    n.layerColor = old;
    if (!res) { this.updateComp(null); this.requestRender(); return; }
    this.setLayerProp(n, 'layerColor', res.color, res.color ? 'Layer color' : 'Layer color off');
  },

  /** Paints the layer's pixels in its layer colour and turns the setting off. */
  rasterizeLayerColor(n) {
    if (!n?.layerColor) return;
    const d = this.doc, W = d.width, H = d.height, color = n.layerColor, tone = n.tone;
    // tonedCanvas draws the layer colour over the pixels as they are (a tone layer keeps its grays: the dots stay live)
    n.tone = null;
    const full = { x: 0, y: 0, w: W, h: H }, before = this.snapshot(n, full), after = this.snapshot({ canvas: tonedCanvas(n) }, full);
    n.tone = tone;
    const put = img => { this.putSnapshot(n, full, img); n.touch(); };
    const tx = this.textsIn([n]);
    this.structural('Rasterize layer color',
      () => { put(after); n.layerColor = null; tx.drop(); },
      () => { put(before); n.layerColor = color; tx.restore(); },
      () => snapBytes(before) + snapBytes(after));
  },

  /**
   * Layer → Expression color…: shows the layer as Color, Gray or Monochrome (Clip Studio Paint's Expression color),
   * without changing its pixels; Monochrome has a threshold and can leave the white see-through. The canvas follows
   * the dialog; OK makes it one undo step.
   */
  async expressionDialog() {
    const n = this.doc.active;
    if (isFolder(n) || n.adjust) return toast('Expression color works on layers with pixels. Select one.');
    this.finishTransform();
    this.finishText();
    const old = n.expression, mono = old?.mode === 'mono' ? old : { threshold: MONO_THRESHOLD, white: true };
    const show = e => { n.expression = e; this.updateComp(null); this.requestRender(); };
    const read = root => {
      const mode = root.querySelector('[name="mode"]:checked').value;
      return sanitizeExpression({ mode, threshold: +root.querySelector('[name="threshold"]').value, white: root.querySelector('[name="white"]').checked });
    };
    const res = await modal({
      title: `Expression color: ${n.name}`,
      live: true,
      body: `
        <div class="field-row">${EXPRESSIONS.map(([v, l]) => `<label class="check"><input type="radio" name="mode" value="${v}" ${(old?.mode || 'color') === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
        <div data-mono>
          <label class="slider"><span>Threshold</span><input type="range" name="threshold" min="1" max="255" value="${mono.threshold}"><output>${mono.threshold}</output></label>
          <label class="check"><input type="checkbox" name="white" ${mono.white ? 'checked' : ''}> Show white (untick: white is see-through)</label>
        </div>
        <p class="muted small">Gray shows the colours as grays, Monochrome as black and white only (darker than the threshold is black). The pixels stay as they are: choose Color to get them back. Layer → Rasterize → Expression color makes it for good.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      onOpen: root => {
        const box = root.querySelector('[data-mono]'), out = root.querySelector('output');
        const update = () => {
          const e = read(root);
          box.hidden = e?.mode !== 'mono';
          out.textContent = root.querySelector('[name="threshold"]').value;
          show(e);
        };
        root.querySelectorAll('input').forEach(i => i.addEventListener('input', update));
        box.hidden = old?.mode !== 'mono';
      },
      collect: root => ({ expression: read(root) }),
    });
    n.expression = old;
    if (!res) { this.updateComp(null); this.requestRender(); return; }
    // an unchanged setting keeps its object, so nothing becomes an undo step
    const same = JSON.stringify(res.expression) === JSON.stringify(old);
    this.setLayerProp(n, 'expression', same ? old : res.expression, 'Expression color');
  },

  /** Turns the layer's pixels gray or black and white for good, as its expression color shows them, and sets it to Color. */
  rasterizeExpression(n) {
    if (!n?.expression) return;
    const d = this.doc, W = d.width, H = d.height, expression = n.expression, tone = n.tone, color = n.layerColor;
    // tonedCanvas would also bake the tone and layer colour: those stay settings of their own
    n.tone = null; n.layerColor = null;
    const full = { x: 0, y: 0, w: W, h: H }, before = this.snapshot(n, full), after = this.snapshot({ canvas: tonedCanvas(n) }, full);
    n.tone = tone; n.layerColor = color;
    const put = img => { this.putSnapshot(n, full, img); n.touch(); };
    const tx = this.textsIn([n]);
    this.structural('Rasterize expression color',
      () => { put(after); n.expression = null; tx.drop(); },
      () => { put(before); n.expression = expression; tx.restore(); },
      () => snapBytes(before) + snapBytes(after));
  },

  /** Draws the layer's effects into its pixels and turns them off. */
  rasterizeEffects(n) {
    if (!n?.effects) return;
    const d = this.doc, W = d.width, H = d.height, fx = n.effects;
    // GPU copies for undo (trimmed when idle), not readbacks of the whole layer
    const full = { x: 0, y: 0, w: W, h: H }, before = this.snapshot(n, full), after = this.snapshot({ canvas: effectsCanvas(n) }, full);
    const put = img => { this.putSnapshot(n, full, img); n.touch(); };
    const tx = this.textsIn([n]);  // a text or vector layer becomes ordinary pixels
    this.structural('Rasterize layer effects',
      () => { put(after); n.effects = null; tx.drop(); },
      () => { put(before); n.effects = fx; tx.restore(); },
      () => snapBytes(before) + snapBytes(after));
  },
};

function readEffects(root) {
  const v = name => root.querySelector(`[name="${name}"]`);
  return sanitizeEffects({
    border: v('border').checked ? { size: v('bsize').value, color: v('bcolor').value } : null,
    shadow: v('shadow').checked ? { x: v('sx').value, y: v('sy').value, blur: v('sblur').value, color: v('scolor').value, opacity: (+v('sop').value || 0) / 100 } : null,
  });
}
