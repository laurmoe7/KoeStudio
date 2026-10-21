// The workspace: where the side panels are (pure, tested). A layout is {left: [ids], right: [ids], float: {id: {x, y,
// w, h}}, folded: {id: true}}: the panels docked on each side top to bottom, those floating over the canvas area
// (px from the editor body's top left) and those folded up. Every panel is in exactly one place. The layout in use
// is kept in `koe.workspace`, named layouts the user saved in `koe.workspaces`, the radial menu's slots in
// `koe.radial`.

/** [id, label] of every side panel. */
export const PANELS = [['tool', 'Tool property'], ['history', 'History'], ['navigator', 'Navigator'], ['color', 'Color'], ['mixing', 'Color mixing'], ['layers', 'Layers']];
const IDS = PANELS.map(p => p[0]);
export const DEFAULT_LAYOUT = Object.freeze({ left: ['tool', 'history', 'navigator'], right: ['color', 'mixing', 'layers'], float: {}, folded: {} });
const HOME = Object.fromEntries(IDS.map(id => [id, DEFAULT_LAYOUT.left.includes(id) ? 'left' : 'right']));
/** Smallest and largest floating panel, px. */
export const FLOAT_MIN = { w: 180, h: 80 }, FLOAT_MAX = { w: 1200, h: 1400 };
/** How many workspaces can be saved. */
export const WORKSPACES_MAX = 20;

const fin = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def);

/**
 * A layout cleaned up: unknown or repeated panels dropped, a missing one put back at the end of its usual side, a
 * floating one with a sensible size. `legacyFolded` (the old `koe.folded`) fills in folded panels when raw has none.
 */
export function sanitizeLayout(raw, legacyFolded = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set(), out = { left: [], right: [], float: {}, folded: {} };
  for (const side of ['left', 'right']) {
    for (const id of Array.isArray(r[side]) ? r[side] : []) if (IDS.includes(id) && !seen.has(id)) { seen.add(id); out[side].push(id); }
  }
  const fl = r.float && typeof r.float === 'object' ? r.float : {};
  for (const id of IDS) {
    const f = fl[id];
    if (seen.has(id) || !f || typeof f !== 'object') continue;
    seen.add(id);
    out.float[id] = { x: fin(f.x, -5000, 20000, 40), y: fin(f.y, -5000, 20000, 40), w: fin(f.w, FLOAT_MIN.w, FLOAT_MAX.w, 260), h: fin(f.h, FLOAT_MIN.h, FLOAT_MAX.h, 320) };
  }
  for (const id of IDS) if (!seen.has(id)) out[HOME[id]].push(id);
  const folded = r.folded && typeof r.folded === 'object' ? r.folded : legacyFolded && typeof legacyFolded === 'object' ? legacyFolded : {};
  for (const id of IDS) if (folded[id] === true) out.folded[id] = true;
  return out;
}

/** Where a panel is: 'left', 'right' or 'float'. */
export function panelPlace(layout, id) {
  return layout.left.includes(id) ? 'left' : layout.right.includes(id) ? 'right' : 'float';
}

/**
 * The layout with panel `id` moved: to = {dock: 'left' | 'right', index} (its place among the panels of that side,
 * counted without it) or {float: {x, y, w, h}}. A new object; folding is kept.
 */
export function movePanel(layout, id, to) {
  const out = { left: layout.left.filter(x => x !== id), right: layout.right.filter(x => x !== id), float: { ...layout.float }, folded: { ...layout.folded } };
  delete out.float[id];
  if (to.float) out.float[id] = { ...to.float };
  else {
    const list = out[to.dock], i = Math.max(0, Math.min(list.length, Math.round(to.index ?? list.length)));
    list.splice(i, 0, id);
  }
  return out;
}

/** The layout with panel id folded (true) or unfolded. */
export function foldPanel(layout, id, folded) {
  const f = { ...layout.folded };
  if (folded) f[id] = true; else delete f[id];
  return { ...layout, folded: f };
}

/** Where a panel dropped at height y goes among panels whose middles are at `mids` (top to bottom): how many are above it. */
export function dockIndex(mids, y) {
  return mids.filter(m => m < y).length;
}

/**
 * A floating panel's box kept reachable inside a W x H area: never bigger than the area allows, and at least
 * `grip` px of its heading inside on every side, so it can always be dragged back.
 */
export function clampFloat(f, W, H, grip = 40) {
  const w = Math.max(FLOAT_MIN.w, Math.min(f.w, FLOAT_MAX.w)), h = Math.max(FLOAT_MIN.h, Math.min(f.h, FLOAT_MAX.h, Math.max(FLOAT_MIN.h, H)));
  const x = Math.max(grip - w, Math.min(W - grip, f.x)), y = Math.max(0, Math.min(Math.max(0, H - grip), f.y));
  return { x, y, w, h };
}

/** Saved workspaces cleaned up: [{name, layout}], names unique (a later one with the same name is dropped). */
export function sanitizeWorkspaces(raw) {
  const out = [], names = new Set();
  for (const w of Array.isArray(raw) ? raw : []) {
    if (out.length >= WORKSPACES_MAX) break;
    const name = String(w?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
    if (!name || names.has(name)) continue;
    names.add(name);
    out.push({ name, layout: sanitizeLayout(w.layout) });
  }
  return out;
}

/** The workspaces with `layout` saved as `name` (replacing one of that name, else added at the end). */
export function saveWorkspace(list, name, layout) {
  const i = list.findIndex(w => w.name === name), entry = { name, layout };
  return i >= 0 ? list.map((w, k) => (k === i ? entry : w)) : [...list, entry].slice(0, WORKSPACES_MAX);
}

// ---------- the radial menu ----------

/** How many slots the radial menu has. */
export const RADIAL_SLOTS = 8;
/** What the radial menu holds at first: tools as 'tool:<id>', other commands by their shortcuts.js id. */
export const DEFAULT_RADIAL = ['tool:pen', 'tool:brush', 'tool:eraser', 'tool:fill', 'tool:picker', 'swapColors', 'undo', 'redo'];

/** The radial menu's slots cleaned up: RADIAL_SLOTS ids, each one of `valid` or '' (an empty slot). */
export function sanitizeRadial(raw, valid) {
  const ok = new Set(valid);
  if (!Array.isArray(raw)) return DEFAULT_RADIAL.map(id => (ok.has(id) ? id : ''));
  return Array.from({ length: RADIAL_SLOTS }, (_, i) => (ok.has(raw[i]) ? raw[i] : ''));
}

/**
 * Which slot of an n-slot ring a pointer dx, dy from the centre points at: slot 0 straight up, then clockwise,
 * each covering 360 / n degrees centred on its direction; -1 inside the `inner` radius (the centre).
 */
export function radialSlot(dx, dy, n, inner) {
  if (Math.hypot(dx, dy) < inner) return -1;
  const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);  // 0 up, clockwise
  return Math.round(a / (2 * Math.PI / n)) % n;
}

/** The middle of slot i of an n-slot ring of radius r, from the centre (slot 0 straight up, clockwise). */
export function radialSpot(i, n, r) {
  const a = (i * 2 * Math.PI) / n;
  return { x: Math.round(r * Math.sin(a) * 100) / 100 + 0, y: Math.round(-r * Math.cos(a) * 100) / 100 + 0 };
}
