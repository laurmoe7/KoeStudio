// Settings → Pen pressure…: one pressure curve for every tool (brush.js adjustPressure), kept per machine in
// koe.pressureCurve. The dialog has the curve (drag points; click to add one, right-click to remove it), ready-made
// curves, and a pad to try it on: strokes there show the adjusted pressure as their width, and "Fit to my strokes"
// makes a curve from how hard you pressed on the pad. Editor methods (mixed into Editor.prototype in editor.js).

import { PRESSURE_PRESETS, adjustPressure, curveAt, pressureFromStrokes, sanitizeCurve } from '../brush.js';
import { modal, store, toast, cssVar } from '../ui.js';

const CW = 220, PAD_W = 260, PAD_H = 150;

export const pressureMethods = {
  /** The pressure curve in use (null: pressure as the pen gives it). */
  loadPressureCurve() {
    this.pressureCurve = sanitizeCurve(store('pressureCurve'));
  },

  async pressureDialog() {
    let curve = (this.pressureCurve || PRESSURE_PRESETS.normal).map(p => [...p]);
    const samples = [];
    const res = await modal({
      title: 'Pen pressure settings',
      wide: true,
      body: `<div class="pp">
        <div><canvas class="pp-curve" width="${CW * 2}" height="${CW * 2}" title="Drag a point; click to add one, right-click to remove it"></canvas>
          <div class="pp-axis muted small"><span>Light</span><span>How hard you press →</span><span>Firm</span></div>
          <div class="btn-row pp-presets"><button type="button" data-p="soft" title="Light pressure counts more">Soft</button>
            <button type="button" data-p="normal" title="Pressure as the pen gives it">Normal</button>
            <button type="button" data-p="firm" title="You have to press harder">Firm</button></div></div>
        <div><canvas class="pp-pad" width="${PAD_W * 2}" height="${PAD_H * 2}"></canvas>
          <p class="muted small">Try your pen here: the line gets as thick as the pressure tools will see.</p>
          <div class="btn-row"><button type="button" class="pp-fit" title="Draw a few strokes on the pad the way you usually draw, then press this">Fit to my strokes</button>
            <button type="button" class="pp-clear">Clear pad</button></div>
          <p class="pp-read muted small"></p></div>
      </div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      onOpen: root => {
        const cv = root.querySelector('.pp-curve'), pad = root.querySelector('.pp-pad'), read = root.querySelector('.pp-read');
        const S = cv.width, toX = x => x * S, toY = y => (1 - y) * S;
        const draw = () => {
          const ctx = cv.getContext('2d');
          ctx.fillStyle = cssVar('--well', '#1e1f24'); ctx.fillRect(0, 0, S, S);
          ctx.strokeStyle = cssVar('--line', '#3a3b43'); ctx.lineWidth = 2;
          for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(toX(k / 4), 0); ctx.lineTo(toX(k / 4), S); ctx.moveTo(0, toY(k / 4)); ctx.lineTo(S, toY(k / 4)); ctx.stroke(); }
          ctx.strokeStyle = '#55565e'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke(); ctx.setLineDash([]);
          ctx.strokeStyle = '#6ea8ff'; ctx.lineWidth = 4; ctx.beginPath();
          for (let i = 0; i <= 100; i++) { const x = i / 100, y = curveAt(curve, x); i ? ctx.lineTo(toX(x), toY(y)) : ctx.moveTo(toX(x), toY(y)); }
          ctx.stroke();
          for (const [x, y] of curve) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(toX(x), toY(y), 9, 0, 7); ctx.fill(); }
        };
        const at = e => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))]; };
        const near = p => curve.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.06);
        cv.addEventListener('contextmenu', e => {
          e.preventDefault();
          const i = near(at(e));
          if (i > 0 && i < curve.length - 1) { curve.splice(i, 1); draw(); }
        });
        cv.addEventListener('pointerdown', e => {
          if (e.button !== 0) return;
          const p = at(e);
          let i = near(p);
          if (i < 0) { curve = sanitizeCurve([...curve, p]) || curve; i = curve.findIndex(q => q[0] === p[0] && q[1] === p[1]); }
          try { cv.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
          const ends = i === 0 || i === curve.length - 1;
          cv.onpointermove = ev => {
            const [x, y] = at(ev), lo = i > 0 ? curve[i - 1][0] + 0.01 : 0, hi = i < curve.length - 1 ? curve[i + 1][0] - 0.01 : 1;
            curve[i] = [ends ? curve[i][0] : Math.max(lo, Math.min(hi, x)), y];  // the end points slide up and down only
            draw();
          };
          cv.onpointerup = () => { cv.onpointermove = null; };
          draw();
        });
        root.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => { curve = PRESSURE_PRESETS[b.dataset.p].map(p => [...p]); draw(); }; });
        // the try-out pad
        const pctx = pad.getContext('2d');
        const clearPad = () => { pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, pad.width, pad.height); samples.length = 0; read.textContent = ''; };
        let last = null;
        pad.addEventListener('pointerdown', e => {
          try { pad.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
          last = null;
          const move = ev => {
            const r = pad.getBoundingClientRect(), x = (ev.clientX - r.left) * pad.width / r.width, y = (ev.clientY - r.top) * pad.height / r.height;
            const raw = ev.pointerType === 'mouse' ? 1 : ev.pressure || 0.01, p = adjustPressure(curve, raw);
            if (ev.pointerType === 'pen') samples.push(raw);
            pctx.strokeStyle = '#1b1b1f'; pctx.lineCap = 'round'; pctx.lineWidth = 1 + p * 22;
            pctx.beginPath(); pctx.moveTo(last?.x ?? x, last?.y ?? y); pctx.lineTo(x, y); pctx.stroke();
            last = { x, y };
            read.textContent = `Pen ${Math.round(raw * 100)}% → tools get ${Math.round(p * 100)}%`;
          };
          move(e);
          pad.onpointermove = move;
          pad.onpointerup = () => { pad.onpointermove = null; };
        });
        root.querySelector('.pp-clear').onclick = clearPad;
        root.querySelector('.pp-fit').onclick = () => {
          const fit = pressureFromStrokes(samples);
          if (!fit) return toast('Draw a few strokes with your pen on the pad first, the way you usually draw.');
          curve = fit;
          draw();
          toast('The curve now fits how you pressed. Try a few more strokes, then press OK.');
        };
        clearPad();
        draw();
      },
      collect: () => curve,
    });
    if (!res) return;
    const normal = res.length === 2 && res[0][0] === 0 && res[0][1] === 0 && res[1][0] === 1 && res[1][1] === 1;
    this.pressureCurve = normal ? null : sanitizeCurve(res);
    store('pressureCurve', this.pressureCurve);
    toast(this.pressureCurve ? 'Pen pressure curve saved: every tool uses it.' : 'Pen pressure is as the pen gives it.');
  },
};
