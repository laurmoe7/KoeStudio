// The Reference window (View → Reference window): pictures to look at while drawing, in a floating window beside
// the canvas, as Clip Studio Paint's Sub View. The pictures are kept in <app dir>\references (app.py), so they are
// there in every artwork. Scroll to zoom, drag to move the picture, click to pick its colour as the main colour,
// double-click to fit. ◀ ▶ step through the pictures; + adds some (or drop picture files on the window).
// Whether it is open, where, its size and the picture are remembered in koe.refWin.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { api } from '../api.js';
import { rgbToHex } from '../color.js';
import { icon } from '../icons.js';
import { confirmBox, store, toast } from '../ui.js';

const ZOOM_MIN = 0.02, ZOOM_MAX = 32;

export const refMethods = {
  refState() {
    const st = store('refWin') || {};
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    return { open: !!st.open, x: num(st.x, window.innerWidth - 640), y: num(st.y, 90), w: num(st.w, 340), h: num(st.h, 300), id: typeof st.id === 'string' ? st.id : '' };
  },

  saveRefState(change) { store('refWin', { ...this.refState(), ...change }); },

  toggleRefWindow(open = !this.refState().open) {
    this.saveRefState({ open });
    this.renderRefWindow();
  },

  /** Opens or closes the window to match the remembered state. */
  async renderRefWindow() {
    const st = this.refState();
    if (!st.open || this.destroyed) { this.refWin?.remove(); this.refWin = null; return; }
    if (this.refWin) return;
    const w = this.refWin = document.createElement('div');
    w.className = 'brush-win ref-win';
    w.setAttribute('role', 'dialog');
    w.innerHTML = `<div class="bw-head"><span class="bw-title">Reference</span>
        <button class="icon-btn" data-ref="prev" title="Previous picture">‹</button>
        <button class="icon-btn" data-ref="next" title="Next picture">›</button>
        <button class="icon-btn" data-ref="add" title="Add pictures (or drop them here)">${icon('plus', 14)}</button>
        <button class="icon-btn" data-ref="del" title="Remove this picture">${icon('trash', 14)}</button>
        <button class="icon-btn" data-ref="close" title="Close">✕</button></div>
      <div class="ref-body"><canvas class="ref-canvas"></canvas><p class="ref-empty muted small" hidden>Add a picture with +, or drop picture files here.</p></div>
      <input type="file" accept="image/*" multiple hidden>`;
    w.style.width = st.w + 'px';
    w.style.height = st.h + 'px';
    this.root.append(w);
    this.placeFloating(w, st.x, st.y);
    const acts = {
      prev: () => this.stepRef(-1), next: () => this.stepRef(1), add: () => w.querySelector('input[type=file]').click(),
      del: () => this.deleteRef(), close: () => this.toggleRefWindow(false),
    };
    w.querySelectorAll('[data-ref]').forEach(b => { b.onclick = () => acts[b.dataset.ref](); });
    w.querySelector('input[type=file]').onchange = e => { this.addRefFiles([...e.target.files]); e.target.value = ''; };
    w.addEventListener('dragover', e => e.preventDefault());
    w.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); this.addRefFiles([...e.dataTransfer.files]); });
    this.bindFloatingHead(w, (x, y) => this.saveRefState({ x, y }));
    this.bindRefCanvas(w.querySelector('.ref-canvas'));
    this.refObs = new ResizeObserver(() => {
      if (!this.refWin) return;
      this.saveRefState({ w: Math.round(w.offsetWidth), h: Math.round(w.offsetHeight) });
      this.drawRef();
    });
    this.refObs.observe(w.querySelector('.ref-body'));
    await this.loadRefs(st.id);
  },

  /** Reads the list of pictures and shows `id` (or the last one). */
  async loadRefs(id) {
    try { this.refs = await api.refs(); } catch (e) { this.refs = []; toast(e.message, { error: true }); }
    const pick = this.refs.find(r => r.id === id) || this.refs[this.refs.length - 1];
    await this.showRef(pick?.id || '');
  },

  async showRef(id) {
    const w = this.refWin;
    if (!w) return;
    this.saveRefState({ id });
    const ref = this.refs.find(r => r.id === id);
    w.querySelector('.ref-empty').hidden = !!ref;
    w.querySelector('.bw-title').textContent = ref ? `Reference · ${ref.name}` : 'Reference';
    w.querySelectorAll('[data-ref="prev"], [data-ref="next"], [data-ref="del"]').forEach(b => { b.disabled = !ref || (b.dataset.ref !== 'del' && this.refs.length < 2); });
    this.refImg = null;
    if (ref) {
      const img = new Image();
      img.src = api.refImageUrl(id);
      try { await img.decode(); } catch { toast('That picture could not be shown.', { error: true }); }
      if (this.refWin !== w) return;
      const c = document.createElement('canvas');  // for picking colours
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
      this.refImg = c;
      this.fitRef();
    }
    this.drawRef();
  },

  stepRef(dir) {
    if (!this.refs?.length) return;
    const i = this.refs.findIndex(r => r.id === this.refState().id);
    this.showRef(this.refs[(i + dir + this.refs.length) % this.refs.length].id);
  },

  async addRefFiles(files) {
    let last = null;
    for (const f of files.filter(f => f.type.startsWith('image/'))) {
      try { last = await api.addRef(f.name, f); } catch (e) { toast(e.message, { error: true }); }
    }
    if (last) await this.loadRefs(last.id);
  },

  async deleteRef() {
    const ref = this.refs?.find(r => r.id === this.refState().id);
    if (!ref || !(await confirmBox('Remove picture', `Remove “${ref.name}” from the Reference window?`, 'Remove'))) return;
    try { await api.deleteRef(ref.id); } catch (e) { return toast(e.message, { error: true }); }
    const i = this.refs.indexOf(ref);
    this.refs.splice(i, 1);
    await this.showRef(this.refs[Math.min(i, this.refs.length - 1)]?.id || '');
  },

  // ---------- the picture view ----------

  fitRef() {
    const body = this.refWin?.querySelector('.ref-body'), img = this.refImg;
    if (!body || !img) return;
    const W = body.clientWidth, H = body.clientHeight, z = Math.min(W / img.width, H / img.height) || 1;
    this.refView = { zoom: z, x: (W - img.width * z) / 2, y: (H - img.height * z) / 2 };
  },

  drawRef() {
    const w = this.refWin;
    if (!w) return;
    const c = w.querySelector('.ref-canvas'), body = w.querySelector('.ref-body'), dpr = window.devicePixelRatio || 1;
    const W = body.clientWidth, H = body.clientHeight;
    c.width = Math.max(1, Math.round(W * dpr));
    c.height = Math.max(1, Math.round(H * dpr));
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.refImg || !this.refView) return;
    const v = this.refView;
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
    ctx.drawImage(this.refImg, 0, 0);
  },

  bindRefCanvas(c) {
    let drag = null;
    const local = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', e => {
      if (!this.refImg || e.button !== 0) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const p = local(e);
      drag = { id: e.pointerId, start: p, view: { ...this.refView }, moved: false };
    });
    c.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const p = local(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      this.refView = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy };
      this.drawRef();
    });
    c.addEventListener('pointerup', e => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved) this.pickRef(drag.start);
      drag = null;
    });
    c.addEventListener('pointercancel', () => { drag = null; });
    c.addEventListener('dblclick', () => { this.fitRef(); this.drawRef(); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this.refView) return;
      const p = local(e), v = this.refView;
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.refView = { zoom: z, x: p.x - ((p.x - v.x) * z) / v.zoom, y: p.y - ((p.y - v.y) * z) / v.zoom };
      this.drawRef();
    }, { passive: false });
  },

  /** A click on the picture: its colour there becomes the main colour. */
  pickRef(p) {
    const v = this.refView, img = this.refImg;
    const x = Math.floor((p.x - v.x) / v.zoom), y = Math.floor((p.y - v.y) / v.zoom);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const [r, g, b, a] = img.getContext('2d').getImageData(x, y, 1, 1).data;
    if (a === 0) return;
    this.colors.set(rgbToHex(r, g, b));
  },

  // ---------- floating windows ----------

  /** Moves a floating window to x, y (screen px), kept on screen with its title bar reachable. */
  placeFloating(w, x, y) {
    const W = w.offsetWidth || 300;
    w.style.left = Math.max(0, Math.min(window.innerWidth - Math.min(W, 120), x)) + 'px';
    w.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
  },

  /** Lets a floating window be dragged by its title bar; onMoved(x, y) when let go. */
  bindFloatingHead(w, onMoved) {
    const head = w.querySelector('.bw-head');
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      try { head.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const move = ev => this.placeFloating(w, ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        const b = w.getBoundingClientRect();
        onMoved(Math.round(b.left), Math.round(b.top));
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
  },
};
