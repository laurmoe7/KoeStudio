// The symmetry ruler (symmetry.js) in the editor: its guide lines on the overlay, the dialog (View → Symmetry…),
// and the centre handle the Ruler tool drags. Settings live in doc.rulers.symmetry, so they are saved with the
// artwork and changes are undo steps (editRulers). Paint tools, Smudge and Lasso fill repeat what they draw.

import { SYMMETRY_KINDS, MAX_LINES, sanitizeSymmetry, symmetryCentre, symmetryRays } from '../symmetry.js';
import { esc, modal } from '../ui.js';
import { matrix, toScreen } from '../view.js';

const SYM_COLOR = 'rgba(255, 150, 60, 0.85)';
const CENTRE_PX = 9;  // grab distance of the centre handle, screen px

const clone = r => JSON.parse(JSON.stringify(r));

export const symmetryMethods = {
  /** The centre handle under a doc point (Ruler tool), when symmetry is on. */
  symAt(dp) {
    const sym = this.doc.rulers.symmetry;
    if (sym.kind === 'off') return false;
    const c = symmetryCentre(sym, this.doc.width, this.doc.height);
    const a = toScreen(this.view, c.x, c.y), b = toScreen(this.view, dp.x, dp.y);
    return Math.hypot(a.x - b.x, a.y - b.y) <= CENTRE_PX;
  },

  drawSymmetryOverlay(ctx) {
    const sym = this.doc.rulers.symmetry;
    if (sym.kind === 'off') return;
    const d = this.doc, dpr = this.dpr || 1;
    const [a, b, c, dd, e, f] = matrix(this.view);
    const sp = (x, y) => [(a * x + c * y + e) * dpr, (b * x + dd * y + f) * dpr];
    const o = symmetryCentre(sym, d.width, d.height), far = 4 * Math.max(d.width, d.height);
    ctx.save();
    ctx.strokeStyle = SYM_COLOR;
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([8 * dpr, 5 * dpr]);
    ctx.beginPath();
    for (const ang of symmetryRays(sym)) {
      ctx.moveTo(...sp(o.x, o.y));
      ctx.lineTo(...sp(o.x + Math.cos(ang) * far, o.y + Math.sin(ang) * far));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const [x, y] = sp(o.x, o.y);
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  },

  /** View → Symmetry…: kind, number of lines and centre, previewed on the overlay while the dialog is open. */
  async symmetryDialog() {
    const r = this.doc.rulers, before = clone(r);
    const read = root => sanitizeSymmetry({
      kind: root.querySelector('[name="kind"]').value, lines: root.querySelector('[name="lines"]').value,
      x: root.querySelector('[name="x"]').value, y: root.querySelector('[name="y"]').value,
    });
    const cur = r.symmetry, c = symmetryCentre(cur, this.doc.width, this.doc.height);
    const res = await modal({
      title: 'Symmetry ruler',
      body: `
        <label class="field"><span>Symmetry</span><select name="kind">${SYMMETRY_KINDS.map(([id, label]) =>
          `<option value="${id}"${id === cur.kind ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
        <label class="field" data-lines><span>Lines (2–${MAX_LINES})</span><input type="number" name="lines" min="2" max="${MAX_LINES}" value="${cur.lines}"></label>
        <div class="field-row">
          <label class="field"><span>Centre X</span><input type="number" name="x" value="${Math.round(c.x)}"></label>
          <label class="field"><span>Centre Y</span><input type="number" name="y" value="${Math.round(c.y)}"></label>
        </div>
        <div class="btn-row"><button type="button" data-centre>Centre on the canvas</button></div>
        <p class="muted small">Pens, brushes, the eraser, Smudge and Lasso fill repeat everything you draw. Drag the round centre with the Ruler tool (U) to move it.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      live: true,
      onOpen: root => {
        const show = () => {
          r.symmetry = read(root);
          root.querySelector('[data-lines]').hidden = !['radial', 'kaleido'].includes(r.symmetry.kind);
          this.drawOverlay();
        };
        root.querySelector('[data-centre]').onclick = () => {
          root.querySelector('[name="x"]').value = Math.round(this.doc.width / 2);
          root.querySelector('[name="y"]').value = Math.round(this.doc.height / 2);
          show();
        };
        root.querySelectorAll('input, select').forEach(el => el.addEventListener('input', show));
        show();
      },
      collect: root => read(root),
    });
    r.symmetry = before.symmetry;
    if (!res) { this.drawOverlay(); return; }
    // the canvas centre stays "the centre" (null) when the canvas is later resized
    if (res.x === this.doc.width / 2 || Math.round(res.x) === Math.round(this.doc.width / 2)) res.x = null;
    if (res.y === this.doc.height / 2 || Math.round(res.y) === Math.round(this.doc.height / 2)) res.y = null;
    this.editRulers(res.kind === 'off' ? 'Symmetry off' : 'Symmetry ruler', () => { r.symmetry = res; }, before);
  },

  /** View → Symmetry on/off: back to the last kind used (vertical the first time). */
  toggleSymmetry() {
    const r = this.doc.rulers, before = clone(r);
    const on = r.symmetry.kind !== 'off';
    if (on) this.lastSymmetry = r.symmetry.kind;
    this.editRulers(on ? 'Symmetry off' : 'Symmetry on', () => { r.symmetry = { ...r.symmetry, kind: on ? 'off' : this.lastSymmetry || 'vertical' }; }, before);
  },
};
