// Layer effects (effects.js): Layer → Layer effects… turns a Border and a Drop shadow on and off and sets them, with
// the canvas showing the result while the dialog is open; OK makes it one undo step. Layer → Rasterize layer
// effects turns them into ordinary pixels. Editor methods (mixed into Editor.prototype in editor.js).

import { effectsCanvas } from '../doc.js';
import { sanitizeEffects, BORDER_SIZE, SHADOW_OFFSET, SHADOW_BLUR } from '../effects.js';
import { isFolder } from '../tree.js';
import { modal, toast } from '../ui.js';

export const effectMethods = {
  async layerEffectsDialog() {
    const n = this.doc.active;
    if (isFolder(n)) return toast('Layer effects work on layers. Select a layer.');
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
        <p class="muted small">The effects are drawn under the layer and never change its pixels; Layer → Rasterize layer effects makes them pixels.</p>`,
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

  /** Draws the layer's effects into its pixels and turns them off. */
  rasterizeEffects(n) {
    if (!n?.effects) return;
    const d = this.doc, W = d.width, H = d.height, fx = n.effects;
    const before = n.ctx.getImageData(0, 0, W, H);
    const after = effectsCanvas(n).getContext('2d').getImageData(0, 0, W, H);
    const put = img => { n.ctx.putImageData(img, 0, 0); n.touch(); };
    const tx = this.textsIn([n]);  // a text or vector layer becomes ordinary pixels
    this.structural('Rasterize layer effects',
      () => { put(after); n.effects = null; tx.drop(); },
      () => { put(before); n.effects = fx; tx.restore(); },
      W * H * 8);
  },
};

function readEffects(root) {
  const v = name => root.querySelector(`[name="${name}"]`);
  return sanitizeEffects({
    border: v('border').checked ? { size: v('bsize').value, color: v('bcolor').value } : null,
    shadow: v('shadow').checked ? { x: v('sx').value, y: v('sy').value, blur: v('sblur').value, color: v('scolor').value, opacity: (+v('sop').value || 0) / 100 } : null,
  });
}
