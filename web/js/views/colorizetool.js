// Edit → Colorize from hints… (colorize.js): flat colours for the line art on the reference layers, from colour
// scribbles on the selected layer, put on a new layer above the hints as one undo step. Editor methods (mixed into
// Editor.prototype in editor.js).

import { Layer, readPixels } from '../doc.js';
import { colorize } from '../colorize.js';
import { insertNode, removeNode, isFolder } from '../tree.js';
import { esc, modal, toast, store } from '../ui.js';

export const colorizeMethods = {
  async colorizeDialog() {
    const d = this.doc, hint = d.active;
    if (!this.hasReferenceLayers()) return toast('Colorize needs your line art: tick Reference on the line art layer in the Layers panel first.', { ms: 6000 });
    if (isFolder(hint) || hint.adjust) return toast('Select the layer with your hint colours (scribbles of the colours you want).');
    if (hint.reference) return toast('This layer is a reference layer (line art). Select the layer with your hint colours instead.');
    this.finishTransform();
    this.finishText();
    const saved = store('colorize') || {};
    const res = await modal({
      title: 'Colorize from hints',
      body: `
        <p class="small">Fills every shape of the reference layers' line art with the hint colour scribbled in it, on a new layer above <b>${esc(hint.name)}</b>.</p>
        <label class="check"><input type="checkbox" name="all" ${saved.fillUnhinted !== false ? 'checked' : ''}> Also fill closed shapes without a hint (from the colours round them)</label>
        <label class="check"><input type="checkbox" name="hide" ${saved.hide !== false ? 'checked' : ''}> Hide the hint layer afterwards</label>
        <p class="muted small">Shapes touching the canvas edge without a hint (the background) stay clear.${this.sel.active ? ' Only the selected area is coloured.' : ''}</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Colorize', primary: true }],
      collect: root => ({ fillUnhinted: root.querySelector('[name="all"]').checked, hide: root.querySelector('[name="hide"]').checked }),
    });
    if (!res) return;
    store('colorize', res);
    const ref = this.referencePixels();
    if (!ref) return;
    const W = d.width, H = d.height;
    const out = colorize(ref, readPixels(hint.canvas, 0, 0, W, H).data, W, H, { fillUnhinted: res.fillUnhinted });
    if (!out) return toast('There are no hint colours on this layer outside the lines. Scribble the colours you want inside the shapes first.', { ms: 6000 });
    const layer = new Layer(W, H, { name: 'Colorize' });
    layer.ctx.putImageData(new ImageData(out, W, H), 0, 0);
    if (this.sel.active) {
      layer.ctx.globalCompositeOperation = 'destination-in';
      layer.ctx.drawImage(this.sel.canvas, 0, 0);
      layer.ctx.globalCompositeOperation = 'source-over';
    }
    layer.touch();
    const parent = hint.parent, i = parent.children.indexOf(hint), shown = hint.visible;
    this.structural('Colorize',
      () => { insertNode(parent, i + 1, layer); d.active = layer; if (res.hide) hint.visible = false; },
      () => { removeNode(layer); d.active = hint; hint.visible = shown; },
      W * H * 4);
  },
};
