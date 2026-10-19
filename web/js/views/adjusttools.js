// Correction layers (adjust.js): Layer → New → Correction layer… picks a correction (Levels, Curves, Hue/Saturation…)
// and shows its sliders while the canvas follows them; the new layer changes everything below it without touching
// any pixels. Its settings change again through Layer → Correction layer settings… or a double-click on its
// thumbnail; a mask limits where it applies (with a selection, the new layer's mask hides everything outside it).
// Editor methods (mixed into Editor.prototype in editor.js).

import { Layer, Mask } from '../doc.js';
import { ADJUSTMENTS, adjustLabel, adjustFields, defaultAdjust, sanitizeAdjust } from '../adjust.js';
import { FILTER_BY_ID, parseStopColor } from '../filters.js';
import { gradientChoices, gradientStops } from '../gradient.js';
import { insertNode, removeNode } from '../tree.js';
import { esc, modal, toast } from '../ui.js';
import { filterDialog, curvesDialog, histogram } from './filtertools.js';

export const adjustMethods = {
  /** Layer → New → Correction layer…: pick one, set it with the canvas showing it, and add it above the current layer. */
  async newAdjustLayer() {
    this.finishTransform();
    this.finishText();
    const type = await modal({
      title: 'New correction layer',
      body: `<p class="muted small">A correction layer changes the colours of everything below it, without changing those layers. Change its settings or opacity, hide it or paint on its mask at any time.</p>
        <div class="adjust-list">${ADJUSTMENTS.map(([id, label]) => `<button type="button" data-type="${id}">${esc(label)}</button>`).join('')}</div>`,
      buttons: [{ label: 'Cancel', value: null }],
      onOpen: (root, close) => root.querySelectorAll('[data-type]').forEach(b => { b.onclick = () => close(b.dataset.type); }),
    });
    if (!type) return;
    const d = this.doc, prev = d.active, parent = prev.parent, index = parent.children.indexOf(prev) + 1;
    const layer = new Layer(d.width, d.height, { name: adjustLabel(type), adjust: defaultAdjust(type) });
    if (type === 'gradmap') layer.adjust = this.gradmapAdjust(this.settings.gradient.colors);
    if (this.sel.active) {  // only inside the selection: the mask hides the rest
      const m = layer.mask = new Mask(d.width, d.height);
      m.ctx.fillRect(0, 0, d.width, d.height);
      m.ctx.globalCompositeOperation = 'destination-out';
      m.ctx.drawImage(this.sel.canvas, 0, 0);
      m.ctx.globalCompositeOperation = 'source-over';
    }
    // shown while its dialog is open, but only recorded once it is OK'd
    insertNode(parent, index, layer);
    this.updateComp(null); this.requestRender();
    const adjust = await this.adjustDialog(layer, layer.adjust);
    removeNode(layer);
    if (!adjust) { this.updateComp(null); this.requestRender(); return; }
    layer.adjust = adjust;
    this.insertNode(layer, 'New correction layer');
  },

  /** Layer → Correction layer settings… (or a double-click on its thumbnail). */
  async adjustSettings(node = this.doc.active) {
    if (!node?.adjust) return toast('Select a correction layer first (Layer → New → Correction layer… makes one).');
    this.finishTransform();
    this.finishText();
    const adjust = await this.adjustDialog(node, node.adjust);
    if (adjust) this.setLayerProp(node, 'adjust', adjust, 'Correction settings');
  },

  /**
   * The sliders of a correction, changing node.adjust live; resolves to the new correction (node.adjust is put
   * back as it was), or null when cancelled. Invert colors has nothing to set.
   */
  async adjustDialog(node, adjust) {
    const old = node.adjust, type = adjust.type;
    if (type === 'invert') return adjust;
    const show = a => { node.adjust = a; this.updateComp(null); this.requestRender(); };
    let raf = 0;
    const live = a => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => show(a)); };
    let res;
    if (type === 'gradmap') res = await this.gradmapDialog(adjust, live);
    else {
      const filter = { ...FILTER_BY_ID[type], label: adjustLabel(type), fields: adjustFields(type) };
      const wrap = p => sanitizeAdjust({ type, params: p });
      let params;
      if (filter.curves) {
        // the kept copy of the picture (compPixels): reading this.comp would move it off the GPU
        params = await curvesDialog(filter, adjust.params, p => live(wrap(p)), histogram({ data: this.compPixels() }, null));
      } else params = await filterDialog(filter, adjust.params, p => live(wrap(p)));
      res = params ? wrap(params) : null;
    }
    cancelAnimationFrame(raf);
    show(old);
    return res;
  },

  /** A gradient map correction with the stops of a gradient (Colors choice), main and sub as they are now. */
  gradmapAdjust(colors) {
    const stops = gradientStops(colors, this.colors.main, this.colors.sub, this.userGrads()).map(([o, c]) => [o, parseStopColor(c)]);
    return sanitizeAdjust({ type: 'gradmap', params: { colors, stops } });
  },

  gradmapDialog(adjust, onChange) {
    const choices = gradientChoices(this.userGrads());
    return modal({
      title: 'Gradient map',
      live: true,
      body: `<label class="slider"><span>Colors</span><select data-colors>${choices.map(([k, l]) =>
        `<option value="${esc(k)}"${k === adjust.params.colors ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <p class="muted small">Dark parts take the gradient's first colour, light parts its last. Main and sub are the colours as they are now. Lower the layer's opacity to mix it with the picture below.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      onOpen: root => { root.querySelector('[data-colors]').onchange = e => onChange(this.gradmapAdjust(e.target.value)); },
      collect: root => this.gradmapAdjust(root.querySelector('[data-colors]').value),
    });
  },
};
