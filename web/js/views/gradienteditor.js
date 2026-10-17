// Your own gradients (gradient.js keeps the maths): the Gradient tool's "Edit gradient…" opens a dialog with a
// strip of the gradient and a marker under it for every colour stop. Click under the strip to add a stop, drag a
// marker to move it, and set the picked stop's colour (a fixed colour, or the main or sub colour), opacity and
// position. Saved gradients are kept per machine in koe.gradients and listed in the tool's Colors choice as
// 'user:<id>'. Editor methods (mixed into Editor.prototype in editor.js).

import { sanitizeUserGradients, stopsFor, stopCss, addStopAt, isUserGradient, MAX_STOPS, MAX_USER_GRADIENTS } from '../gradient.js';
import { esc, modal, store, toast } from '../ui.js';

const W = 440, H = 30;

export const gradientEditMethods = {
  /** Your saved gradients (read from storage once). */
  userGrads() {
    return (this.userGradients ||= sanitizeUserGradients(store('gradients')));
  },

  saveUserGrads(list) {
    this.userGradients = sanitizeUserGradients(list);
    store('gradients', this.userGradients);
  },

  /** Edit the gradient the tool uses now: one of yours, or a copy of a built-in one saved as a new gradient. */
  async gradientEditor() {
    const s = this.settings.gradient, list = this.userGrads();
    const own = isUserGradient(s.colors) ? list.find(g => g.id === s.colors.slice(5)) : null;
    let stops = stopsFor(s.colors, list), pick = 0;
    const main = () => this.colors.main, sub = () => this.colors.sub;
    const res = await modal({
      title: own ? 'Edit gradient' : 'New gradient',
      wide: true,
      body: `<div class="ge">
        <label class="field"><span>Name</span><input type="text" name="name" maxlength="40" value="${esc(own?.name || 'My gradient')}"></label>
        <div class="ge-strip-wrap"><canvas class="ge-strip" width="${W * 2}" height="${H * 2}"></canvas>
          <div class="ge-track" title="Click to add a colour stop; drag a marker to move it"></div></div>
        <div class="field-row ge-stop">
          <label class="field"><span>Color</span><select name="kind"><option value="hex">This colour</option><option value="main">Main colour</option><option value="sub">Sub colour</option></select></label>
          <label class="field"><span>&nbsp;</span><input type="color" name="hex"></label>
          <label class="field"><span>Opacity (%)</span><input type="number" name="a" min="0" max="100"></label>
          <label class="field"><span>Position (%)</span><input type="number" name="o" min="0" max="100"></label>
          <label class="field"><span>&nbsp;</span><button type="button" class="ge-del" title="Remove this colour stop">Remove stop</button></label>
        </div>
        <p class="muted small">Click under the strip to add a colour stop (up to ${MAX_STOPS}), drag a marker to move it. Main and sub
        colour follow the colour squares, so one gradient works in any colours.</p>
      </div>`,
      buttons: [
        ...(own ? [{ label: 'Delete gradient', value: 'delete' }] : []),
        { label: 'Cancel', value: null },
        ...(own ? [{ label: 'Save as new', value: 'new' }] : []),
        { label: own ? 'Save' : 'Save gradient', primary: true },
      ],
      onOpen: root => {
        const strip = root.querySelector('.ge-strip'), track = root.querySelector('.ge-track');
        const f = name => root.querySelector(`[name="${name}"]`);
        const draw = () => {
          const ctx = strip.getContext('2d'), w = strip.width, h = strip.height, cell = 12;
          for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
            ctx.fillStyle = ((x + y) / cell) % 2 ? '#c8c8c8' : '#ffffff';
            ctx.fillRect(x, y, cell, cell);
          }
          const g = ctx.createLinearGradient(0, 0, w, 0);
          for (const st of stops) g.addColorStop(st.o, stopCss(st, main(), sub()));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
          track.innerHTML = stops.map((st, i) => `<button type="button" class="ge-mark${i === pick ? ' on' : ''}" data-i="${i}"
            style="left:${st.o * 100}%;--c:${stopCss({ ...st, a: 1 }, main(), sub())}" title="${st.c === 'main' ? 'Main colour' : st.c === 'sub' ? 'Sub colour' : st.c}"></button>`).join('');
          const st = stops[pick];
          f('kind').value = st.c === 'main' || st.c === 'sub' ? st.c : 'hex';
          f('hex').value = st.c === 'main' ? main() : st.c === 'sub' ? sub() : st.c;
          f('hex').disabled = f('kind').value !== 'hex';
          f('a').value = Math.round(st.a * 100);
          f('o').value = Math.round(st.o * 100);
          root.querySelector('.ge-del').disabled = stops.length <= 2;
        };
        const sortKeep = () => { const cur = stops[pick]; stops.sort((p, q) => p.o - q.o); pick = stops.indexOf(cur); };
        const offsetAt = e => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
        track.addEventListener('pointerdown', e => {
          const mark = e.target.closest('.ge-mark');
          if (!mark) {  // a new stop where the click was
            if (stops.length >= MAX_STOPS) return toast(`A gradient has at most ${MAX_STOPS} colour stops.`);
            const o = +offsetAt(e).toFixed(4), cur = addStopAt(stops, o, main(), sub());
            pick = cur.findIndex(st => !stops.includes(st));
            stops = cur;
            return draw();
          }
          pick = +mark.dataset.i;
          draw();
          try { track.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
          track.onpointermove = ev => { stops[pick] = { ...stops[pick], o: +offsetAt(ev).toFixed(4) }; sortKeep(); draw(); };
          track.onpointerup = () => { track.onpointermove = null; };
        });
        const edit = change => { stops[pick] = { ...stops[pick], ...change }; sortKeep(); draw(); };
        f('kind').onchange = () => edit({ c: f('kind').value === 'hex' ? f('hex').value : f('kind').value });
        f('hex').oninput = () => edit({ c: f('hex').value.toLowerCase() });
        f('a').onchange = () => edit({ a: Math.max(0, Math.min(100, +f('a').value || 0)) / 100 });
        f('o').onchange = () => edit({ o: Math.max(0, Math.min(100, +f('o').value || 0)) / 100 });
        root.querySelector('.ge-del').onclick = () => { if (stops.length > 2) { stops.splice(pick, 1); pick = Math.max(0, pick - 1); draw(); } };
        draw();
      },
      collect: root => ({ action: 'save', name: root.querySelector('[name="name"]').value.trim() || 'My gradient' }),
    });
    if (!res) return;
    if (res === 'delete') {
      if (!own) return;
      this.saveUserGrads(list.filter(g => g !== own));
      if (s.colors === `user:${own.id}`) s.colors = 'main-sub';
    } else {
      const name = res.name || own?.name || 'My gradient';
      if (own && res.action === 'save') this.saveUserGrads(list.map(g => (g === own ? { ...g, name, stops } : g)));
      else {
        if (list.length >= MAX_USER_GRADIENTS) return toast(`You can keep up to ${MAX_USER_GRADIENTS} gradients. Delete one first.`);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this.saveUserGrads([...list, { id, name: res === 'new' ? `${name} copy` : name, stops }]);
        s.colors = `user:${id}`;
      }
    }
    store('tools', this.settings);
    this.renderToolProps();
  },
};
