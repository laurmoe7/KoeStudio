// The file browser: picks a folder and a file name for exports and project files. Folders come from the server
// (fs/list), so it works the same in the window and in a browser. Places (Exports, Desktop, Pictures, drives…)
// sit on the left; clicking a folder opens it, clicking a file takes its name.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, modal, promptBox, toast } from '../ui.js';

/** Joins a folder path and a name with the folder's own separator. */
export function joinPath(dir, name) {
  const sep = dir.includes('\\') || /^[a-z]:$/i.test(dir) ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

/** A file name without its extension, when that extension is `ext`. */
export function stripExt(name, ext) {
  return name.toLowerCase().endsWith('.' + ext.toLowerCase()) ? name.slice(0, -ext.length - 1) : name;
}

/**
 * Asks where to save: resolves to {dir, name} (name without extension), or null when cancelled.
 * dir '' starts in the Exports folder; a folder that has gone away also falls back to it.
 */
export function browseFile({ title = 'Save to', dir = '', name = '', ext = 'png', okLabel = 'Save here' } = {}) {
  let cur = null;  // the listing being shown
  return modal({
    title,
    wide: true,
    body: `
      <div class="fb-bar">
        <button type="button" class="icon-btn" data-up title="Up one folder">${icon('up', 16)}</button>
        <input type="text" class="fb-path" spellcheck="false" aria-label="Folder" data-own-enter>
        <button type="button" data-mkdir title="Make a new folder here">${icon('folderPlus', 16)} New folder</button>
      </div>
      <div class="fb-main">
        <nav class="fb-places" aria-label="Places"></nav>
        <div class="fb-list" role="listbox" aria-label="Folders and files"><p class="muted">Loading…</p></div>
      </div>
      <label class="field"><span>File name</span>
        <div class="fb-name"><input type="text" name="fname" value="${esc(name)}" maxlength="80"><span class="muted">.${esc(ext)}</span></div></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: okLabel, primary: true }],
    onOpen: root => {
      const $ = s => root.querySelector(s);
      const go = async path => {
        try {
          cur = await api.listDir(path);
        } catch (e) {
          if (cur) return toast(e.status === 404 ? 'That folder does not exist.' : e.message, { error: true });
          cur = await api.listDir('');  // the remembered folder has gone: start in Exports
        }
        $('.fb-path').value = cur.path;
        $('[data-up]').disabled = !cur.parent;
        $('.fb-places').innerHTML = cur.places.map((p, i) =>
          `<button type="button" data-place="${i}" class="${p.path === cur.path ? 'on' : ''}" title="${esc(p.path)}">${esc(p.name)}</button>`).join('');
        $('.fb-places').querySelectorAll('[data-place]').forEach(b => { b.onclick = () => go(cur.places[+b.dataset.place].path); });
        const list = $('.fb-list');
        list.innerHTML = (cur.dirs.length || cur.files.length)
          ? cur.dirs.map((d, i) => `<button type="button" class="fb-item dir" data-dir="${i}">${icon('folder', 16)}<span>${esc(d)}</span></button>`).join('') +
            cur.files.map((f, i) => `<button type="button" class="fb-item file${f.name.toLowerCase().endsWith('.' + ext) ? '' : ' other'}" data-file="${i}">
              <span class="fb-dot"></span><span>${esc(f.name)}</span><small class="muted">${esc(new Date(f.modified * 1000).toLocaleDateString())}</small></button>`).join('')
          : '<p class="muted">This folder is empty.</p>';
        list.scrollTop = 0;
        list.querySelectorAll('[data-dir]').forEach(b => { b.onclick = () => go(joinPath(cur.path, cur.dirs[+b.dataset.dir])); });
        list.querySelectorAll('[data-file]').forEach(b => {
          b.onclick = () => { $('[name="fname"]').value = cur.files[+b.dataset.file].name.replace(/\.[^.]+$/, ''); };
        });
      };
      $('[data-up]').onclick = () => cur?.parent && go(cur.parent);
      $('.fb-path').onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(e.target.value.trim()); }
      };
      $('[data-mkdir]').onclick = async () => {
        if (!cur) return;
        const n = await promptBox('New folder', 'Name', 'New folder');
        if (!n) return;
        try { await go((await api.makeDir(cur.path, n)).path); } catch (e) { toast('Could not make the folder: ' + e.message, { error: true }); }
      };
      go(dir);
      setTimeout(() => $('[name="fname"]').select());  // after the dialog focuses its first field
    },
    collect: root => {
      const n = root.querySelector('[name="fname"]').value.trim();
      if (!cur) return undefined;
      if (!n) { toast('Type a file name.', { error: true }); return undefined; }
      return { dir: cur.path, name: stripExt(n, ext) };
    },
  });
}
