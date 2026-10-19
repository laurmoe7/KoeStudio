// Frame-by-frame animation (anim.js): View → Animation timeline turns every visible top-level layer or folder into
// a frame and shows the timeline under the canvas: frame thumbnails (click one to draw on it), play / stop, frames
// per second, onion skins, and buttons to add, duplicate and delete frames. ',' and '.' step through the frames.
// A frame can be held for several frame times (`node.hold`, animating "on twos"): playback and exports keep it up
// that long, and the timeline draws the held time as a striped strip after its thumbnail.
// Editor methods (mixed into Editor.prototype in editor.js).

import { shrinkInto, thumbContext } from './layerpanel.js';
import { Layer, cloneNode, nodeRasters, renderFolder } from '../doc.js';
import { animFrames, frameOf, nextFrame, sanitizeAnim, sanitizeHold, holdOf, totalTicks, FPS_MIN, FPS_MAX, ONION_MAX, HOLD_MAX } from '../anim.js';
import { isFolder, insertNode, removeNode } from '../tree.js';
import { icon } from '../icons.js';
import { esc, modal, toast } from '../ui.js';

const TW = 64, TH = 48;  // frame thumbnail size, CSS px
const HOLD_STRIP = 10, HOLD_STRIP_MAX = 160;  // CSS px of striped strip per extra frame time a frame is held

export const animMethods = {
  /** What composite() should show while the animation is on: the frame playing or being drawn, with onion skins. */
  compView() {
    const a = this.doc.anim;
    if (!a.on) return null;
    return { frame: this.playing ? this.playing.index : this.drawnFrame(), onion: !this.playing && a.onion };
  },

  /**
   * The frame being drawn: the one holding the selected layer, or (when the background, foreground or a hidden layer
   * is selected) the last frame drawn on, so picking the background does not jump to frame 1.
   */
  drawnFrame() {
    const { frames } = animFrames(this.doc.root.children, this.doc.anim);
    const i = frames.indexOf(frameOf(this.doc.active));
    if (i >= 0) this.lastFrame = i;
    return Math.max(0, Math.min(frames.length - 1, this.lastFrame || 0));
  },

  /** View → Animation timeline: turns the animation on or off (saved with the artwork, not an undo step). */
  toggleAnimation(on = !this.doc.anim.on) {
    this.stopAnimation();
    this.doc.anim = { ...this.doc.anim, on };
    if (on && this.doc.root.children.length < 2) toast('Each layer or folder at the top of the Layers panel is now one frame. Press + Frame in the timeline to add the next one.', { ms: 6000 });
    this.renderTimeline();
    this.changed(null);
  },

  /** After the layer list changes: the timeline follows, and the canvas when another frame is now the one drawn. */
  animLayersChanged() {
    if (!this.doc.anim.on) return;
    const v = this.compView(), key = `${v.frame}`;
    if (this.animShownKey !== key) { this.animShownKey = key; this.updateComp(null); this.requestRender(); }
    this.renderTimeline();
  },

  renderTimeline() {
    const el = this.root.querySelector('.ed-timeline');
    if (!el) return;
    const a = this.doc.anim;
    el.hidden = !a.on;
    if (!a.on) { el.innerHTML = ''; return; }
    const { frames, bg, fg } = animFrames(this.doc.root.children, a);
    const cur = this.playing ? this.playing.index : this.drawnFrame();
    const cell = (node, label, i, extra = '') => {
      const hold = extra ? 1 : holdOf(node);
      return `<button type="button" class="tl-cell${i === cur && !extra ? ' current' : ''}${extra}" data-i="${i}" title="${esc(node.name)}${hold > 1 ? ` (held ${hold} frames)` : ''}">
        <div class="tl-pic"><canvas width="${TW}" height="${TH}"></canvas>${hold > 1 ? `<i class="tl-held" style="width:${Math.min(HOLD_STRIP_MAX, (hold - 1) * HOLD_STRIP)}px"></i>` : ''}</div>
        <span>${esc(label)}${hold > 1 ? ` ×${hold}` : ''}</span></button>`;
    };
    const ticks = totalTicks(frames.map(holdOf)), curNode = frames[cur];
    el.innerHTML = `
      <div class="tl-bar">
        <button type="button" class="icon-btn tl-play" data-tl="play" title="${this.playing ? 'Stop' : 'Play'}">${this.playing ? '■' : '▶'}</button>
        <label class="tl-fps" title="Frames per second">
          <input type="number" data-tl="fps" min="${FPS_MIN}" max="${FPS_MAX}" value="${a.fps}"> fps</label>
        <button type="button" class="tl-toggle${a.onion ? ' on' : ''}" data-tl="onion" title="Onion skin: show the frames before (blue) and after (green) faintly">Onion skin</button>
        <button type="button" class="tl-toggle${a.loop ? ' on' : ''}" data-tl="loop" title="Play round and round">Loop</button>
        <span class="tl-sep"></span>
        <button type="button" class="icon-btn" data-tl="prev" title="Previous frame (,)">‹</button>
        <span class="tl-pos muted small" title="${frames.length ? `Length when played: ${(ticks / a.fps).toFixed(2)} s` : ''}">${frames.length ? `${cur + 1} / ${frames.length}` : 'no frames'}</span>
        <button type="button" class="icon-btn" data-tl="next" title="Next frame (.)">›</button>
        <label class="tl-fps" title="How many frame times this frame stays up: 2 = on twos (Alt+, / Alt+. change it)">Hold
          <input type="number" data-tl="hold" min="1" max="${HOLD_MAX}" value="${holdOf(curNode)}"${curNode ? '' : ' disabled'}></label>
        <span class="tl-sep"></span>
        <button type="button" data-tl="add" title="A new empty frame after this one">${icon('plus', 14)} Frame</button>
        <button type="button" class="icon-btn" data-tl="dup" title="Duplicate: a copy of this frame after it">${icon('copy', 15)}</button>
        <button type="button" class="icon-btn" data-tl="del" title="Delete this frame">${icon('trash', 15)}</button>
        <div class="grow"></div>
        <button type="button" data-tl="settings" title="Speed, onion skin, background and foreground">Settings…</button>
        <button type="button" data-tl="export" title="File → Export animation…">Export…</button>
        <button type="button" class="icon-btn" data-tl="close" title="Turn the animation off (View → Animation timeline)">×</button>
      </div>
      <div class="tl-frames">
        ${bg ? cell(bg, 'Background', -1, ' hold') : ''}
        ${frames.map((n, i) => cell(n, String(i + 1), i)).join('')}
        ${fg ? cell(fg, 'Foreground', -2, ' hold') : ''}
      </div>`;
    const nodeFor = i => (i === -1 ? bg : i === -2 ? fg : frames[i]);
    el.querySelectorAll('.tl-cell').forEach(b => {
      b._node = nodeFor(+b.dataset.i);
      b.onclick = () => { this.stopAnimation(); this.selectNode(b._node); };
    });
    const acts = {
      play: () => (this.playing ? this.stopAnimation() : this.playAnimation()),
      onion: () => this.setAnim({ onion: !a.onion }),
      loop: () => this.setAnim({ loop: !a.loop }),
      prev: () => this.stepFrame(-1),
      next: () => this.stepFrame(1),
      add: () => this.addFrame(),
      dup: () => this.addFrame(true),
      del: () => this.deleteFrame(),
      settings: () => this.animSettingsDialog(),
      export: () => this.exportAnimation(),
      close: () => this.toggleAnimation(false),
    };
    el.querySelectorAll('button[data-tl]').forEach(b => { b.onclick = () => acts[b.dataset.tl](); });
    el.querySelector('[data-tl="fps"]').onchange = e => this.setAnim({ fps: e.target.value });
    el.querySelector('[data-tl="hold"]').onchange = e => this.setFrameHold(e.target.value);
    el.querySelector('.tl-cell.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.timelineThumbs(true);
  },

  /** Redraws the frame thumbnails whose pixels changed (all of them when `all`). */
  timelineThumbs(all = false) {
    const el = this.root.querySelector('.ed-timeline');
    if (!el || el.hidden) return;
    const d = this.doc, r = { x: 0, y: 0, w: d.width, h: d.height }, dpr = window.devicePixelRatio || 1;
    const PW = Math.round(TW * dpr), PH = Math.round(TH * dpr), s = Math.min(PW / d.width, PH / d.height);  // device pixels
    const w = d.width * s, h = d.height * s, x = (PW - w) / 2, y = (PH - h) / 2;
    for (const b of el.querySelectorAll('.tl-cell')) {
      const n = b._node, c = b.querySelector('canvas');
      const key = nodeRasters(n).map(x => x.version).join(',') + `/${d.width}x${d.height}/${dpr}`;
      if (!all && b._key === key) continue;
      b._key = key;
      const ctx = thumbContext(c, TW, TH);
      ctx.fillStyle = d.paper || '#e4e4ea';
      ctx.fillRect(x, y, w, h);
      if (isFolder(n) || n.mask || n.effects || n.tone || n.adjust) {
        ctx.setTransform(s, 0, 0, s, x, y);
        renderFolder(ctx, { children: [n] }, r);
      } else {  // halving step by step, so thin lines still show (layerpanel.js)
        ctx.globalAlpha = n.opacity;
        shrinkInto(ctx, n.canvas, x, y, w, h);
      }
    }
  },

  /** Hold in the timeline (or Alt+, / Alt+. with `delta`): how many frame times the current frame stays up; an undo step. */
  setFrameHold(value, delta = 0) {
    if (!this.doc.anim.on) return;
    const { frames } = animFrames(this.doc.root.children, this.doc.anim);
    const node = frames[this.drawnFrame()];
    if (!node) return;
    const hold = sanitizeHold(delta ? holdOf(node) + delta : value);
    if (hold === holdOf(node)) return this.renderTimeline();
    this.setLayerProp(node, 'hold', hold, 'Frame hold');
  },

  setAnim(change) {
    this.doc.anim = sanitizeAnim({ ...this.doc.anim, ...change });
    this.renderTimeline();
    this.changed(null);
  },

  /** ',' / '.' and the arrows in the timeline: draw on the previous or next frame (wrapping round). */
  stepFrame(dir) {
    if (!this.doc.anim.on) return;
    this.stopAnimation();
    const { frames } = animFrames(this.doc.root.children, this.doc.anim);
    if (!frames.length) return;
    const i = (this.drawnFrame() + dir + frames.length) % frames.length;
    this.selectNode(frames[i]);
  },

  playAnimation() {
    const { frames } = animFrames(this.doc.root.children, this.doc.anim);
    if (frames.length < 2) return toast('Add a second frame first (+ Frame in the timeline).');
    this.finishTransform?.();
    this.finishText?.();
    const p = this.playing = { index: this.drawnFrame(), timer: 0 };
    const wait = i => holdOf(animFrames(this.doc.root.children, this.doc.anim).frames[i]) * 1000 / this.doc.anim.fps;
    const tick = () => {
      if (this.playing !== p) return;
      const { frames: fr } = animFrames(this.doc.root.children, this.doc.anim);
      const next = nextFrame(p.index, fr.length, this.doc.anim.loop);
      if (next === null) return this.stopAnimation();
      p.index = next;
      this.updateComp(null);
      this.requestRender();
      const el = this.root.querySelector('.ed-timeline');
      el?.querySelectorAll('.tl-cell').forEach(b => b.classList.toggle('current', +b.dataset.i === next));
      const pos = el?.querySelector('.tl-pos');
      if (pos) pos.textContent = `${next + 1} / ${fr.length}`;
      p.timer = setTimeout(tick, wait(next));
    };
    p.timer = setTimeout(tick, wait(p.index));
    this.updateComp(null);
    this.requestRender();
    this.renderTimeline();
  },

  stopAnimation() {
    if (!this.playing) return;
    clearTimeout(this.playing.timer);
    this.playing = null;
    this.updateComp(null);
    this.requestRender();
    this.renderTimeline();
  },

  /** + Frame: an empty layer after the current frame; Duplicate: a copy of the frame (layer or folder) there. */
  addFrame(copy = false) {
    this.stopAnimation();
    const d = this.doc, root = d.root, { frames } = animFrames(root.children, d.anim);
    const cur = frames[this.drawnFrame()] || null;
    if (copy && !cur) return toast('There is no frame to duplicate yet.');
    const index = cur ? root.children.indexOf(cur) + 1 : root.children.length - (d.anim.fg && root.children.length > 1 ? 1 : 0);
    const node = copy ? cloneNode(cur, d.width, d.height) : new Layer(d.width, d.height, { name: `Frame ${frames.length + 1}` });
    if (copy) node.name = `${cur.name} copy`;
    const prev = d.active, prevMask = this.maskEdit;
    this.structural(copy ? 'Duplicate frame' : 'New frame',
      () => { insertNode(root, index, node); d.active = node; this.maskEdit = false; },
      () => { removeNode(node); d.active = prev; this.maskEdit = prevMask; },
      nodeRasters(node).length * d.width * d.height * 4);
  },

  deleteFrame() {
    this.stopAnimation();
    const d = this.doc, root = d.root, { frames } = animFrames(root.children, d.anim);
    const i = this.drawnFrame(), cur = frames[i];
    if (!cur) return;
    if (frames.length < 2) return toast('This is the only frame. Turn the animation off instead (× in the timeline).');
    const at = root.children.indexOf(cur), next = frames[i + 1] || frames[i - 1], prev = d.active;
    this.structural('Delete frame',
      () => { removeNode(cur); d.active = next; this.maskEdit = false; },
      () => { insertNode(root, at, cur); d.active = prev; });
  },

  async animSettingsDialog() {
    const a = this.doc.anim;
    const num = (name, label, min, max, value) =>
      `<label class="field"><span>${label}</span><input type="number" name="${name}" min="${min}" max="${max}" value="${value}"></label>`;
    const check = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
    const res = await modal({
      title: 'Animation settings',
      body: `
        <div class="field-row">${num('fps', 'Frames per second', FPS_MIN, FPS_MAX, a.fps)}</div>
        ${check('loop', 'Loop (play round and round)', a.loop)}
        ${check('onion', 'Onion skin', a.onion)}
        <div class="field-row">${num('before', 'Frames before', 0, ONION_MAX, a.before)}${num('after', 'Frames after', 0, ONION_MAX, a.after)}
          ${num('op', 'Opacity (%)', 5, 100, Math.round(a.onionOpacity * 100))}</div>
        ${check('bg', 'Background: the bottom layer or folder shows under every frame', a.bg)}
        ${check('fg', 'Foreground: the top layer or folder shows over every frame', a.fg)}
        <p class="muted small">Every visible layer or folder at the top level of the Layers panel is one frame, from the bottom up.
        Put the parts of one frame (lines, colours) in a folder. Hidden layers are left out.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
      collect: root => {
        const v = n => root.querySelector(`[name="${n}"]`);
        return { fps: v('fps').value, loop: v('loop').checked, onion: v('onion').checked, before: v('before').value, after: v('after').value,
          onionOpacity: (+v('op').value || 30) / 100, bg: v('bg').checked, fg: v('fg').checked };
      },
    });
    if (res) this.setAnim(res);
  },
};
