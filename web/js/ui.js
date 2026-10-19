// Small DOM helpers: escaping, toasts, modal dialogs, dropdown menus, the colour theme.

import { THEMES, themeById, themeVars } from './themes.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(text, { error = false, action = null, ms = 3500 } = {}) {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' error' : '');
  t.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.run(); t.remove(); };
    t.append(b);
  }
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
  return t;
}

/**
 * Shows a modal. body is HTML; buttons are [{label, value, primary}]. Resolves with the clicked button's value
 * (or null on Escape / backdrop). onOpen(root, close) runs after it is in the page (close(value) ends the dialog); collect(root) runs before resolving
 * the primary button and its result is returned instead of the value (return undefined to keep the dialog open).
 * live: the dialog previews its effect on the canvas, so it sits at the bottom and does not dim the screen.
 * passClicks (with live): clicks outside the dialog reach the page (to pick a colour on the canvas) instead of cancelling.
 */
/**
 * Auto actions (actiontools.js) watch and fill in dialogs: onClose(back, ok) is told how each dialog closed (ok: by
 * its primary button), while it is still in the page; fill(back) may fill one in as it opens, and returns true to
 * press its primary button after that.
 */
export const modalHooks = { onClose: null, fill: null };

export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, collect, wide = false, live = false, passClicks = false }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back' + (live ? ' live' : '') + (passClicks ? ' pass' : '');
    back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2><div class="modal-body">${body}</div>
      <div class="modal-buttons">${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = (v, ok = false) => {
      if (!back.isConnected) return;
      modalHooks.onClose?.(back, ok);
      back.remove(); document.removeEventListener('keydown', key, true); resolve(v);
    };
    const finish = b => {
      if (b.primary && collect) {
        const v = collect(back);
        if (v !== undefined) done(v, true);
      } else done(b.value, !!b.primary);
    };
    const key = e => {
      if ([...document.querySelectorAll('.modal-back')].at(-1) !== back) return;  // a dialog opened on top of this one has the keys
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      // a focused button, or a field marked data-own-enter, does its own thing with Enter
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !('ownEnter' in e.target.dataset)) {
        const b = buttons.find(x => x.primary);
        if (b) { e.preventDefault(); e.stopPropagation(); finish(b); }
      }
    };
    back.addEventListener('pointerdown', e => { if (e.target === back) done(null); });
    back.querySelectorAll('.modal-buttons button').forEach(el => { el.onclick = () => finish(buttons[+el.dataset.i]); });
    document.addEventListener('keydown', key, true);
    document.body.append(back);
    onOpen?.(back, done);
    (back.querySelector('input, select') || back.querySelector('button.primary'))?.focus();
    if (modalHooks.fill?.(back)) {  // an auto action filled it in: OK once the previews have run
      const b = buttons.find(x => x.primary);
      if (b) requestAnimationFrame(() => requestAnimationFrame(() => { if (back.isConnected) finish(b); }));
    }
  });
}

export async function confirmBox(title, text, okLabel = 'OK') {
  return modal({ title, body: `<p>${esc(text)}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true }] });
}

export async function promptBox(title, label, value = '') {
  return modal({
    title,
    body: `<label class="field"><span>${esc(label)}</span><input type="text" value="${esc(value)}" maxlength="120"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true }],
    onOpen: root => root.querySelector('input').select(),
    collect: root => root.querySelector('input').value.trim() || undefined,
  });
}

let menuState = null;  // the open menu: {owner, cleanup}

/** A dropdown menu under button. items: [{label, key, run, disabled, checked}], {label, sub: [items]} for a
 * submenu (opens to the side on hover, click or →), or '-' for a separator. Items with `checked` (true or false)
 * are toggles and get a tick column. Clicking the button again closes it. Keys: ↑ ↓ move, → opens a submenu,
 * ← / Esc go back, Enter runs; `onSide(dir)` (-1 / 1) is called for ← / → on the first level, so a menu bar
 * can move to the next menu. */
export function menu(button, items, { onSide } = {}) {
  if (menuState?.owner === button) return closeMenus();
  closeMenus();
  button.classList?.add('menu-open');
  const r = button.getBoundingClientRect();
  const root = buildMenu(items, 0);
  place(root, r.left, r.bottom + 2, () => r.right, r.top - 2);
  let timer = 0;

  function buildMenu(list, depth) {
    const m = document.createElement('div');
    m.className = 'menu';
    m.setAttribute('role', 'menu');
    m.dataset.depth = depth;
    const ticks = list.some(it => it !== '-' && 'checked' in it);
    for (const it of list) {
      if (it === '-') { m.append(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      if ('checked' in it) b.setAttribute('aria-checked', !!it.checked);
      const end = it.sub ? '<i class="sub-arrow">›</i>' : `<kbd>${esc(it.key || '')}</kbd>`;
      b.innerHTML = `${ticks ? `<i class="tick">${it.checked ? '✓' : ''}</i>` : ''}<span>${esc(it.label)}</span>${end}`;
      b.disabled = !!it.disabled || (it.sub && !it.sub.some(s => s !== '-' && !s.disabled));
      if (it.sub) {
        b.setAttribute('aria-haspopup', 'menu');
        b.onclick = () => openSub(b, it.sub, depth, true);
      } else {
        b.onclick = () => { closeMenus(); it.run(); };
      }
      // hovering an item opens its submenu (or closes another one) after a moment, so passing over is harmless
      b.onpointerenter = () => {
        b.focus({ preventScroll: true });
        clearTimeout(timer);
        timer = setTimeout(() => (it.sub && !b.disabled ? openSub(b, it.sub, depth) : closeFrom(depth + 1)), 140);
      };
      m.append(b);
    }
    m.onpointerenter = () => clearTimeout(timer);
    return m;
  }
  function closeFrom(depth) {
    for (const m of document.querySelectorAll('.menu')) {
      if (+m.dataset.depth >= depth) { m._from?.classList.remove('sub-open'); m.remove(); }
    }
  }
  function openSub(b, list, depth, focusFirst = false) {
    if (b.classList.contains('sub-open')) { if (focusFirst) step(b.nextSub, 1); return; }
    closeFrom(depth + 1);
    const sub = buildMenu(list, depth + 1);
    sub._from = b;
    b.nextSub = sub;
    b.classList.add('sub-open');
    const br = b.getBoundingClientRect();
    place(sub, br.right + 2, br.top - 5, () => br.left - 2, br.bottom + 5, true);
    if (focusFirst) step(sub, 1);
  }
  // keep a menu on screen: open leftwards / upwards when there is no room
  function place(m, x, y, leftEdge, bottomEdge, side = false) {
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    document.body.append(m);
    const mr = m.getBoundingClientRect();
    if (mr.right > innerWidth - 4) m.style.left = Math.max(4, leftEdge() - mr.width) + 'px';
    if (mr.bottom > innerHeight - 4) {
      const up = side ? innerHeight - 4 - mr.height : Math.min(bottomEdge - mr.height, innerHeight - 4 - mr.height);
      m.style.top = Math.max(4, up) + 'px';
    }
  }
  function step(m, dir) {
    const btns = [...m.querySelectorAll('button:not(:disabled)')];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    btns[i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length].focus();
  }
  function current() {
    const menus = [...document.querySelectorAll('.menu')];
    return menus.find(m => m.contains(document.activeElement)) || menus.at(-1);
  }
  const keys = e => {
    const m = current();
    if (!m) return;
    const depth = +m.dataset.depth, focused = m.contains(document.activeElement) ? document.activeElement : null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') step(m, e.key === 'ArrowDown' ? 1 : -1);
    else if (e.key === 'ArrowRight' && focused?.getAttribute('aria-haspopup') && !focused.disabled) focused.click();
    else if (e.key === 'ArrowLeft' && depth > 0) { const from = m._from; closeFrom(depth); from.focus(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onSide) { closeMenus(); onSide(e.key === 'ArrowLeft' ? -1 : 1); }
    else if (e.key === 'Escape') { if (depth > 0) { const from = m._from; closeFrom(depth); from.focus(); } else closeMenus(); }
    else if (e.key === 'Enter' || e.key === ' ') { if (focused) focused.click(); }
    else if (e.key !== 'Tab') return;  // other keys (shortcuts) close nothing and pass through
    e.preventDefault();
    e.stopPropagation();
  };
  // clicks outside close the menu; a click on its own button is left to toggle it
  const outside = e => { if (!e.target.closest('.menu') && !button.contains?.(e.target)) closeMenus(); };
  const blur = () => closeMenus();
  setTimeout(() => menuState && document.addEventListener('pointerdown', outside, true));
  window.addEventListener('keydown', keys, true);
  window.addEventListener('blur', blur);
  menuState = {
    owner: button,
    cleanup() {
      clearTimeout(timer);
      button.classList?.remove('menu-open');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', blur);
    },
  };
}

/** The button whose menu is open, or null. */
export const openMenuOwner = () => menuState?.owner || null;

export function closeMenus() {
  menuState?.cleanup();
  menuState = null;
  document.querySelectorAll('.menu').forEach(m => m.remove());
}

/** Reads a File as a data URL. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem('koe.' + key));
    localStorage.setItem('koe.' + key, JSON.stringify(value));
  } catch { /* storage can be unavailable; settings are then not remembered */ }
  return null;
}

/** Puts the saved colour theme (or `id`, which is then saved) on the page; a 'koe-theme' event tells canvases to redraw. */
export function applyTheme(id) {
  if (id) store('theme', id);
  const t = themeById(id || store('theme'));
  for (const [k, v] of Object.entries(themeVars(t))) document.documentElement.style.setProperty(k, v);
  document.documentElement.dataset.theme = t.id;
  window.dispatchEvent(new Event('koe-theme'));
  return t;
}

/** Menu items for picking a theme, the current one ticked. */
export function themeMenu() {
  const cur = themeById(store('theme')).id;
  return THEMES.map(t => ({ label: t.name, checked: t.id === cur, run: () => applyTheme(t.id) }));
}

/** A CSS custom property's current value (for canvases drawn in the theme's colours). */
export function cssVar(name, fallback = '') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
