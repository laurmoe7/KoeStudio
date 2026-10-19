// Timelapse: with File → Record timelapse on (doc.timelapse, saved with the artwork), every successful autosave
// that changed something sends a small JPEG of the picture to the server (app.py keeps .timelapse/<id>/<n>.jpg).
// File → Export timelapse plays them back into a WebM video (recordWebm); the plan comes from timelapse.js.
// Editor methods (mixed into Editor.prototype in editor.js), so `this` is the editor.

import { api } from '../api.js';
import { loadImage } from '../doc.js';
import { timelapsePlan, videoSize } from '../timelapse.js';
import { esc, toast, modal, store, confirmBox } from '../ui.js';
import { browseFile } from './filebrowser.js';
import { recordWebm, webmType, writeExport, showFolder, dirLabel } from './exporttools.js';

const FRAME_MAX = 1280;  // px a side of a recorded frame
const FRAME_GAP = 1500;  // ms: at most one frame this often, however quickly autosaves follow each other

export const timelapseMethods = {
  /** File → Record timelapse. */
  toggleTimelapse() {
    const d = this.doc;
    d.timelapse = !d.timelapse;
    d.version++;  // saved with the artwork
    this.scheduleSave();
    this.root.querySelector('.lapse-chip').hidden = !d.timelapse;
    toast(d.timelapse ? 'Recording a timelapse: a frame is kept each time the artwork saves. File → Export timelapse makes the video.'
      : 'Timelapse recording paused. The frames so far are kept.', { ms: 5000 });
  },

  /** After a save: keeps a frame when the picture changed since the last one (never throws). */
  async captureTimelapse() {
    const d = this.doc;
    if (!d.timelapse || !d.id || this.lapseBusy || this.lapseVersion === d.version) return;
    if (performance.now() - (this.lapseAt || -Infinity) < FRAME_GAP) {
      clearTimeout(this.lapseTimer);
      this.lapseTimer = setTimeout(() => this.captureTimelapse(), FRAME_GAP);
      return;
    }
    this.lapseBusy = true;
    try {
      const version = d.version, src = this.thumbCanvas(FRAME_MAX);
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = d.paper || '#ffffff';  // JPEG has no see-through: a clear canvas records on white
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob || !this.doc) return;
      const res = await api.addTimelapseFrame(d.id, blob);
      this.lapseVersion = version;
      this.lapseAt = performance.now();
      if (res.full && !this.lapseFullSaid) { this.lapseFullSaid = true; toast('The timelapse is full: no more frames are kept.', { ms: 6000 }); }
    } catch (e) {
      if (!this.lapseFailSaid) { this.lapseFailSaid = true; toast('Could not keep a timelapse frame: ' + e.message, { error: true }); }
    } finally {
      this.lapseBusy = false;
    }
  },

  /** File → Export timelapse…: the recorded frames as a WebM video. */
  async exportTimelapse() {
    const d = this.doc;
    await this.flush();
    const count = d.id ? (await api.timelapse(d.id).catch(() => ({ frames: 0 }))).frames : 0;
    if (!count) return toast(d.timelapse ? 'No timelapse frames yet: keep drawing, a frame is kept each time the artwork saves.'
      : 'No timelapse recorded. Turn on File → Record timelapse first.', { ms: 5000 });
    if (!webmType()) return toast('This window cannot record video.', { error: true });
    const saved = store('lapseExport') || {};
    let dir = store('exportDir') ?? '';
    const read = root => {
      const f = n => root.querySelector(`[name="${n}"]`);
      return { fps: [10, 15, 30, 60].includes(+f('fps').value) ? +f('fps').value : 30,
        max: Math.max(5, Math.min(3600, Math.round(+f('max').value) || 60)), name: f('name').value.trim() || `${d.title} timelapse` };
    };
    const res = await modal({
      title: 'Export timelapse',
      body: `
        <label class="field"><span>File name</span><input type="text" name="name" value="${esc(d.title)} timelapse" maxlength="80"></label>
        <div class="field-row">
          <label class="field"><span>Frames per second</span><select name="fps">${[10, 15, 30, 60].map(v =>
            `<option value="${v}"${(saved.fps || 30) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>At most (seconds)</span><input type="number" name="max" min="5" max="3600" step="1" value="${saved.max || 60}"></label>
        </div>
        <p class="small" data-info></p>
        <label class="field"><span>Save in</span>
          <div class="fb-dest"><span class="fb-path" data-dest></span><button type="button" data-browse>Browse…</button></div></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Export', primary: true }],
      onOpen: root => {
        const show = () => {
          const p = read(root), plan = timelapsePlan(count, p.fps, p.max), secs = plan.holds.reduce((a, b) => a + b, 0) / p.fps;
          root.querySelector('[data-info]').textContent = `${count} frames recorded; the video shows ${plan.indices.length} of them`
            + ` and ends on the finished picture: ${secs.toFixed(1)} s. Recording takes as long as the video.`;
        };
        root.querySelectorAll('input, select').forEach(el => el.addEventListener('input', show));
        const dest = root.querySelector('[data-dest]');
        const showDir = () => { dest.textContent = dirLabel(dir); dest.title = dirLabel(dir); };
        root.querySelector('[data-browse]').onclick = async () => {
          const pick = await browseFile({ title: 'Export to', dir, name: read(root).name, ext: 'webm', okLabel: 'Choose' });
          if (pick) { dir = pick.dir; root.querySelector('[name="name"]').value = pick.name; showDir(); }
        };
        root.querySelector('[name="name"]').select();
        showDir();
        show();
      },
      collect: read,
    });
    if (!res) return;
    store('lapseExport', { fps: res.fps, max: res.max });
    store('exportDir', dir);
    const plan = timelapsePlan(count, res.fps, res.max), secs = plan.holds.reduce((a, b) => a + b, 0) / res.fps;
    try {
      // every frame is fitted into the size of the last one (the finished picture), on black
      const last = await loadImage(api.timelapseFrameUrl(d.id, plan.indices[plan.indices.length - 1]));
      const size = videoSize(last.naturalWidth, last.naturalHeight), c = document.createElement('canvas');
      c.width = size.w; c.height = size.h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const frame = async i => {
        const img = i === plan.indices.length - 1 ? last : await loadImage(api.timelapseFrameUrl(d.id, plan.indices[i])).catch(() => null);
        if (img) {
          const s = Math.min(size.w / img.naturalWidth, size.h / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, size.w, size.h);
          ctx.drawImage(img, (size.w - w) / 2, (size.h - h) / 2, w, h);
        }  // a missing frame repeats the one before
        return c;
      };
      toast(`Recording the timelapse (${secs.toFixed(1)} s)…`, { ms: Math.max(3000, secs * 1000) });
      const video = await recordWebm(frame, plan.holds, res.fps);
      const r = await writeExport(res.name, 'webm', video, dir, true);
      if (r) toast(`Exported the timelapse to ${r.path}`, { action: showFolder(r.folder), ms: 6000 });
    } catch (e) {
      toast('Export failed: ' + e.message, { error: true });
    }
  },

  /** File → Discard timelapse…: removes the recorded frames (after asking). */
  async discardTimelapse() {
    const d = this.doc, count = d.id ? (await api.timelapse(d.id).catch(() => ({ frames: 0 }))).frames : 0;
    if (!count) return toast('There is no timelapse to discard.');
    if (!await confirmBox('Discard timelapse', `Throw away the ${count} timelapse frames of “${d.title}”? This cannot be undone.`, 'Discard')) return;
    try {
      await api.clearTimelapse(d.id);
      this.lapseVersion = null;
      toast('Timelapse discarded.' + (d.timelapse ? ' Recording goes on from here.' : ''));
    } catch (e) {
      toast('Could not discard the timelapse: ' + e.message, { error: true });
    }
  },
};
