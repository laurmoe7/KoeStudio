// Small DOM helpers: escaping, toasts, modal dialogs, dropdown menus.

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
}

/**
 * Shows a modal. body is HTML; buttons are [{label, value, primary}]. Resolves with the clicked button's value
 * (or null on Escape / backdrop). onOpen(root) runs after it is in the page; collect(root) runs before resolving
 * the primary button and its result is returned instead of the value (return undefined to keep the dialog open).
 * live: the dialog previews its effect on the canvas, so it sits at the bottom and does not dim the screen.
 */
export function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], onOpen, collect, wide = false, live = false }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back' + (live ? ' live' : '');
    back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2><div class="modal-body">${body}</div>
      <div class="modal-buttons">${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = v => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const finish = b => {
      if (b.primary && collect) {
        const v = collect(back);
        if (v !== undefined) done(v);
      } else done(b.value);
    };
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {  // a focused button does its own thing
        const b = buttons.find(x => x.primary);
        if (b) { e.preventDefault(); e.stopPropagation(); finish(b); }
      }
    };
    back.addEventListener('pointerdown', e => { if (e.target === back) done(null); });
    back.querySelectorAll('.modal-buttons button').forEach(el => { el.onclick = () => finish(buttons[+el.dataset.i]); });
    document.addEventListener('keydown', key, true);
    document.body.append(back);
    onOpen?.(back);
    (back.querySelector('input, select') || back.querySelector('button.primary'))?.focus();
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

/** A dropdown menu under button. items: [{label, key, run, disabled, checked}] or '-' for a separator.
 * Items with `checked` (true or false) are toggles and get a tick column. */
export function menu(button, items) {
  closeMenus();
  const m = document.createElement('div');
  m.className = 'menu';
  const ticks = items.some(it => it !== '-' && 'checked' in it);
  for (const it of items) {
    if (it === '-') { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    if ('checked' in it) b.setAttribute('aria-checked', !!it.checked);
    b.innerHTML = `${ticks ? `<i class="tick">${it.checked ? '✓' : ''}</i>` : ''}<span>${esc(it.label)}</span><kbd>${esc(it.key || '')}</kbd>`;
    b.disabled = !!it.disabled;
    b.onclick = () => { closeMenus(); it.run(); };
    m.append(b);
  }
  const r = button.getBoundingClientRect();
  m.style.left = r.left + 'px';
  m.style.top = r.bottom + 2 + 'px';
  document.body.append(m);
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function outside(e) {
    if (!m.contains(e.target)) { closeMenus(); document.removeEventListener('pointerdown', outside, true); }
  }
}

export function closeMenus() {
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
