// Auto actions (pure, tested): steps recorded once and played back with one click, as Clip Studio Paint's Auto
// actions. A step is what a menu item, a shortcut command or a Layers panel setting did:
//   {kind: 'menu', menu, path: [label or rec id, ...]}   a menu item (Edit, Image, Select, Layer, Filter)
//   {kind: 'cmd', id}                                    a keyboard command from COMMANDS (shortcuts.js)
//   {kind: 'call', name, args}                           an editor method from RECORD_CALLS (the Layers panel buttons)
//   {kind: 'prop', key, value, label}                    a Layers panel setting (blend, opacity, clip, ...)
// with optional `dialogs` (the values typed into each dialog it opened, [[field, value], ...] per dialog, field being
// a name or '#index'), `show` (open the dialogs on playback instead of filling them in and pressing OK) and `color`
// (the colour a fill used). Kept per machine in koe.actions = {sets: [{name, actions: [{name, steps}]}], set}.

import { COMMANDS } from './shortcuts.js';
import { BLEND_MODES, PASS_THROUGH } from './doc.js';

/** The menus whose items are recorded; the others (File, View, Help) only look or save. */
export const RECORD_MENUS = ['edit', 'image', 'select', 'layer', 'filter'];
/** Menu items that are never recorded: they need the canvas (dragging, clicking) or undo the recording itself. */
export const SKIP_ITEMS = new Set(['Undo', 'Redo', 'Find layer on canvas', 'Crop tool', 'Transform…', 'Transform selection…', 'Quick mask (paint the selection)', 'Color range…']);
/** Keyboard commands that change the artwork, and so are recorded. */
export const RECORD_CMDS = new Set(['clear', 'fillMain', 'fillSub', 'repeatFilter', 'selectAll', 'deselect', 'invertSelection', 'newLayer',
  'groupFolder', 'mergeDown', 'mergeVisible', 'layerCopy', 'layerCut', 'swapColors']);
/** Editor methods the Layers panel calls directly, recorded with their arguments. */
export const RECORD_CALLS = { layerAdd: 'New layer', folderAdd: 'New folder', layerDuplicate: 'Duplicate layer', layerDelete: 'Delete layer',
  layerMove: 'Move layer', mergeDown: 'Merge down', addMask: 'Add mask' };
/** Layers panel settings (setPickedProp keys) and what their values may be. */
const PROPS = {
  blend: v => [...BLEND_MODES.map(m => m[0]), PASS_THROUGH[0]].includes(v),
  opacity: v => typeof v === 'number' && v >= 0 && v <= 1,
  clip: v => typeof v === 'boolean', alphaLock: v => typeof v === 'boolean', locked: v => typeof v === 'boolean', reference: v => typeof v === 'boolean',
  draft: v => typeof v === 'boolean',
  label: v => v === null || (typeof v === 'string' && /^[a-z]{1,10}$/.test(v)),
  layerColor: v => v === null || (typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v)),
};
export const PROP_KEYS = Object.keys(PROPS);
const CMD_LABEL = new Map(COMMANDS.map(c => [c[0], c[2]]));
const MAX_STEPS = 200, MAX_ACTIONS = 100, MAX_SETS = 30;

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** One recorded step from storage, or null when it is not one KoeStudio can play. */
export function sanitizeStep(s) {
  if (!s || typeof s !== 'object') return null;
  let out = null;
  if (s.kind === 'menu' && RECORD_MENUS.includes(s.menu) && Array.isArray(s.path) && s.path.length && s.path.length <= 4 && s.path.every(p => typeof p === 'string' && p)) {
    out = { kind: 'menu', menu: s.menu, path: s.path.map(p => p.slice(0, 80)) };
  } else if (s.kind === 'cmd' && RECORD_CMDS.has(s.id)) out = { kind: 'cmd', id: s.id };
  else if (s.kind === 'call' && Object.hasOwn(RECORD_CALLS, s.name)) {
    const args = Array.isArray(s.args) ? s.args.filter(a => typeof a === 'number' || typeof a === 'boolean').slice(0, 2) : [];
    out = { kind: 'call', name: s.name, args };
  } else if (s.kind === 'prop' && Object.hasOwn(PROPS, s.key) && PROPS[s.key](s.value)) {
    out = { kind: 'prop', key: s.key, value: s.value, label: str(s.label, 60) || s.key };
  }
  if (!out) return null;
  if (Array.isArray(s.dialogs) && s.dialogs.length) {
    out.dialogs = s.dialogs.slice(0, 5).map(d => (Array.isArray(d) ? d : []).slice(0, 60)
      .filter(f => Array.isArray(f) && typeof f[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof f[1]))
      .map(([k, v]) => [k.slice(0, 40), typeof v === 'string' ? v.slice(0, 2000) : v]));
    if (s.show === true) out.show = true;
  }
  if (typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) out.color = s.color.toLowerCase();
  return out;
}

/** koe.actions from storage: sets of named actions, the built-in set when nothing is kept. */
export function sanitizeActions(raw) {
  const sets = (Array.isArray(raw?.sets) ? raw.sets : []).slice(0, MAX_SETS).map(set => ({
    name: str(set?.name, 60) || 'Set',
    actions: (Array.isArray(set?.actions) ? set.actions : []).slice(0, MAX_ACTIONS).map(a => ({
      name: str(a?.name, 60) || 'Action',
      steps: (Array.isArray(a?.steps) ? a.steps : []).slice(0, MAX_STEPS).map(sanitizeStep).filter(Boolean),
    })),
  }));
  if (!sets.length) return defaultActions();
  const set = Number.isInteger(raw.set) && raw.set >= 0 && raw.set < sets.length ? raw.set : 0;
  return { sets, set };
}

/** The set KoeStudio starts with (as Clip Studio Paint's default auto actions). */
export function defaultActions() {
  const add = { kind: 'call', name: 'layerAdd', args: [] };
  const prop = (key, value, label) => ({ kind: 'prop', key, value, label });
  return {
    set: 0,
    sets: [{
      name: 'Basic',
      actions: [
        { name: 'Blue sketch layer', steps: [add, prop('layerColor', '#3a78d8', 'Layer color'), prop('opacity', 0.5, 'Opacity')] },
        { name: 'Shading layer (multiply, clipped)', steps: [add, prop('clip', true, 'Clip to layer below'), prop('blend', 'multiply', 'Blending mode')] },
        { name: 'Light layer (screen, clipped)', steps: [add, prop('clip', true, 'Clip to layer below'), prop('blend', 'screen', 'Blending mode')] },
        { name: 'Overlay colour layer', steps: [add, prop('blend', 'overlay', 'Blending mode'), prop('opacity', 0.4, 'Opacity')] },
        { name: 'Merge visible to a new layer', steps: [{ kind: 'menu', menu: 'layer', path: ['Merge visible to new layer'] }] },
      ],
    }],
  };
}

const MENU_NAMES = { edit: 'Edit', image: 'Image', select: 'Select', layer: 'Layer', filter: 'Filter' };
const BLEND_LABEL = new Map([...BLEND_MODES, PASS_THROUGH]);

/** What a step does, in words for the Auto actions window. */
export function stepLabel(s) {
  if (s.kind === 'menu') return [MENU_NAMES[s.menu], ...s.path].join(' › ');
  if (s.kind === 'cmd') return CMD_LABEL.get(s.id) || s.id;
  if (s.kind === 'call') return RECORD_CALLS[s.name] + (s.name === 'layerMove' ? (s.args[0] > 0 ? ' up' : ' down') : '');
  const v = s.key === 'opacity' ? Math.round(s.value * 100) + '%' : s.key === 'blend' ? BLEND_LABEL.get(s.value) : typeof s.value === 'boolean' ? (s.value ? 'on' : 'off') : s.value ?? 'off';
  return `${s.label}: ${v}`;
}

/**
 * Adds a step to a recording, folding it into the one before when it only changes the same setting again
 * (dragging the opacity slider twice keeps one step). Returns the new list.
 */
export function addStep(steps, s) {
  const last = steps.at(-1);
  if (s.kind === 'prop' && last?.kind === 'prop' && last.key === s.key) return [...steps.slice(0, -1), s];
  return [...steps, s];
}

/**
 * The menu item a step names, in items as menuItems gives them: each path part matches an item's `rec` id or its
 * label. Returns {item} or {error} saying which part is missing or not available now.
 */
export function findMenuItem(items, path) {
  let list = items, item = null;
  for (const part of path) {
    item = (list || []).find(it => it !== '-' && (it.rec === part || it.label === part));
    if (!item) return { error: `“${part}” is not in the menu` };
    if (item.disabled) return { error: `“${item.label}” is not available now` };
    list = item.sub;
  }
  if (!item?.run) return { error: `“${path.at(-1)}” is a submenu` };
  return { item };
}

/** Form values of a dialog for recording: [[name or '#index', value]] (checkboxes and radio buttons as true/false). */
export function dialogValues(fields) {
  return fields.map((f, i) => {
    const key = f.name && f.type !== 'radio' && fields.filter(g => g.name === f.name).length === 1 ? f.name : '#' + i;
    return [key, f.type === 'checkbox' || f.type === 'radio' ? !!f.checked : String(f.value)];
  }).filter((_, i) => fields[i].type !== 'file' && fields[i].type !== 'button');
}

/** The field a recorded key names: by name, else by its place in the dialog. */
export function fieldFor(fields, key) {
  if (key.startsWith('#')) return fields[+key.slice(1)] || null;
  return fields.find(f => f.name === key) || null;
}
