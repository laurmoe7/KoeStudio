// Edit → Colorize… (colorize.js): flat colours for the line art on the reference layers, either from colour
// scribbles on the selected layer (colorize) or picked from a colour scheme (autoColorize, Shuffle for other
// colours). The result shows on the canvas while the dialog is open, on a layer not yet in the history; OK makes it
// one undo step: from hints above the hint layer (which may be hidden), picked colours under the line art.
// Editor methods (mixed into Editor.prototype in editor.js).

import { Layer, readPixels } from '../doc.js';
import { colorize, autoColorize, SCHEMES } from '../colorize.js';
import { insertNode, removeNode, isFolder } from '../tree.js';
import { esc, modal, toast, store } from '../ui.js';

export const colorizeMethods = {
  async colorizeDialog() {
    const d = this.doc, active = d.active, W = d.width, H = d.height;
    if (!this.hasReferenceLayers()) return toast('Colorize needs your line art: tick Reference on the line art layer in the Layers panel first.', { ms: 6000 });
    this.finishTransform();
    this.finishText();
    const ref = this.referencePixels();
    if (!ref) return;
    const canHint = !isFolder(active) && !active.adjust && !active.reference;
    const hints = canHint ? readPixels(active.canvas, 0, 0, W, H).data : null;
    const saved = store('colorize') || {};
    const mode0 = saved.mode === 'hints' && canHint ? 'hints' : 'auto';
    const scheme0 = SCHEMES.some(s => s[0] === saved.scheme) ? saved.scheme : 'harmony';
    const layer = new Layer(W, H, { name: 'Colorize' });
    const shown = active.visible;
    let placed = null;  // where the preview layer is now: {parent, index}

    // the preview layer's place for a mode: above the hint layer, or under the lowest reference layer (or folder)
    const placeFor = mode => {
      if (mode === 'hints') return { parent: active.parent, index: active.parent.children.indexOf(active) + 1 };
      const outer = n => { let top = null; for (let p = n; p && p !== d.root; p = p.parent) if (p.reference) top = p; return top; };
      const low = d.layers.map(outer).find(Boolean) || active;
      return { parent: low.parent, index: low.parent.children.indexOf(low) };
    };
    const unplace = () => { if (placed) removeNode(layer); placed = null; active.visible = shown; };
    const read = root => {
      const v = n => root.querySelector(`[name="${n}"]`);
      return {
        mode: canHint && root.querySelector('[name="mode"]:checked')?.value === 'hints' ? 'hints' : 'auto',
        fillUnhinted: v('all').checked, hide: v('hide').checked,
        scheme: v('scheme').value, seed: Math.max(1, Math.round(+v('seed').value) || 1),
      };
    };
    const show = root => {
      const o = read(root);
      root.querySelector('[data-hints]').hidden = o.mode !== 'hints';
      root.querySelector('[data-auto]').hidden = o.mode !== 'auto';
      const out = o.mode === 'hints'
        ? colorize(ref, hints, W, H, { fillUnhinted: o.fillUnhinted })
        : autoColorize(ref, W, H, { scheme: o.scheme, seed: o.seed, own: this.colors.palette });
      const msg = root.querySelector('[data-msg]');
      msg.textContent = out ? '' : o.mode === 'hints'
        ? 'No hint colours on this layer outside the lines yet: scribble the colours you want inside the shapes first.'
        : o.scheme === 'palette' ? 'Your palette needs at least two colours (Color panel → +).'
          : 'No closed shapes found in the line art: close the gaps in the lines, or use hints.';
      layer.ctx.clearRect(0, 0, W, H);
      if (out) {
        layer.ctx.putImageData(new ImageData(out, W, H), 0, 0);
        if (this.sel.active) {
          layer.ctx.globalCompositeOperation = 'destination-in';
          layer.ctx.drawImage(this.sel.canvas, 0, 0);
          layer.ctx.globalCompositeOperation = 'source-over';
        }
      }
      layer.touch();
      unplace();
      placed = placeFor(o.mode);
      insertNode(placed.parent, placed.index, layer);
      if (o.mode === 'hints' && o.hide) active.visible = false;
      this.updateComp(null);
      this.requestRender();
      return !!out;
    };

    const res = await modal({
      title: 'Colorize',
      live: true,
      body: `
        <p class="small">Fills every closed shape of the reference layers' line art with flat colour, on a new layer.</p>
        <label class="check"><input type="radio" name="mode" value="auto" ${mode0 === 'auto' ? 'checked' : ''}> Pick colours for me</label>
        <label class="check"><input type="radio" name="mode" value="hints" ${mode0 === 'hints' ? 'checked' : ''}${canHint ? '' : ' disabled'}>
          <span>Use the hint colours scribbled on <b>${canHint ? esc(active.name) : 'the selected layer'}</b>${canHint ? '' : ' (select a layer with hints for this)'}</span></label>
        <div data-auto>
          <div class="field-row">
            <label class="field"><span>Colours</span><select name="scheme">${SCHEMES.map(([id, label]) => `<option value="${id}"${id === scheme0 ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
            <div class="btn-row"><button type="button" data-shuffle title="Other colours of the same kind">Shuffle</button></div>
          </div>
          <input type="hidden" name="seed" value="${Math.max(1, Math.round(+saved.seed) || 1)}">
        </div>
        <div data-hints>
          <label class="check"><input type="checkbox" name="all" ${saved.fillUnhinted !== false ? 'checked' : ''}> Also fill closed shapes without a hint (from the colours round them)</label>
          <label class="check"><input type="checkbox" name="hide" ${saved.hide !== false ? 'checked' : ''}> Hide the hint layer afterwards</label>
        </div>
        <p class="small error" data-msg></p>
        <p class="muted small">Shapes touching the canvas edge (the background) stay clear.${this.sel.active ? ' Only the selected area is coloured.' : ''}</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Colorize', primary: true }],
      onOpen: root => {
        root.querySelectorAll('select, input').forEach(el => {
          el.addEventListener('change', () => show(root));
          el.addEventListener('input', () => show(root));
        });
        root.querySelector('[data-shuffle]').onclick = () => {
          const seed = root.querySelector('[name="seed"]');
          seed.value = 1 + Math.floor(Math.random() * 1e9);
          show(root);
        };
        show(root);
      },
      collect: root => (show(root) ? read(root) : undefined),
    });
    const where = placed;
    unplace();
    if (!res) { this.updateComp(null); this.requestRender(); return; }
    store('colorize', res);
    const hide = res.mode === 'hints' && res.hide;
    this.structural('Colorize',
      () => { insertNode(where.parent, where.index, layer); d.active = layer; if (hide) active.visible = false; },
      () => { removeNode(layer); d.active = active; active.visible = shown; },
      W * H * 4);
  },
};
