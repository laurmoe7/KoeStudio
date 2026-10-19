// Keyboard shortcuts you can change (pure, tested). Every command the editor's keys run has an id here with its
// default keys; tools are 'tool:<id>' with the key from TOOLS. The user's changes are kept as {id: [combo, ...]}
// (koe.shortcuts) and replace that id's defaults. Combos are as keys.js comboOf makes them ('ctrl+shift+n', '[').

/** [id, group, label, default combos]. */
export const COMMANDS = [
  ['sizeDown', 'Painting', 'Smaller brush', ['[']],
  ['sizeUp', 'Painting', 'Bigger brush', [']']],
  ['swapColors', 'Painting', 'Swap main and sub colour', ['x']],
  ['undo', 'Edit', 'Undo', ['ctrl+z']],
  ['redo', 'Edit', 'Redo', ['ctrl+y', 'ctrl+shift+z']],
  ['copy', 'Edit', 'Copy', ['ctrl+c']],
  ['cut', 'Edit', 'Cut', ['ctrl+x']],
  ['transform', 'Edit', 'Transform', ['ctrl+t']],
  ['clear', 'Edit', 'Clear the selection or layer', ['delete', 'backspace']],
  ['fillMain', 'Edit', 'Fill with the main colour', ['alt+delete', 'alt+backspace']],
  ['fillSub', 'Edit', 'Fill with the sub colour', ['alt+shift+delete', 'alt+shift+backspace']],
  ['repeatFilter', 'Edit', 'Repeat the last filter', ['ctrl+f']],
  ['canvasSize', 'Edit', 'Canvas size', ['ctrl+alt+c']],
  ['imageSize', 'Edit', 'Image size', ['ctrl+alt+i']],
  ['selectAll', 'Selection', 'Select all', ['ctrl+a']],
  ['deselect', 'Selection', 'Deselect', ['ctrl+d']],
  ['invertSelection', 'Selection', 'Invert the selection', ['ctrl+shift+i']],
  ['quickMask', 'Selection', 'Quick mask', ['q']],
  ['newLayer', 'Layers', 'New layer', ['ctrl+shift+n']],
  ['groupFolder', 'Layers', 'Put in a new folder', ['ctrl+g']],
  ['mergeDown', 'Layers', 'Merge down (or merge folder)', ['ctrl+e']],
  ['mergeVisible', 'Layers', 'Merge visible to a new layer', ['ctrl+alt+shift+e']],
  ['layerCopy', 'Layers', 'Copy to a new layer', ['ctrl+j']],
  ['layerCut', 'Layers', 'Cut to a new layer', ['ctrl+shift+j']],
  ['renameLayer', 'Layers', 'Rename the layer', ['f2']],
  ['findLayer', 'Layers', 'Find a layer by clicking what is drawn on it', []],
  ['fit', 'View', 'Fit to window', ['ctrl+0']],
  ['actual', 'View', 'Actual size (100%)', ['ctrl+1']],
  ['zoomIn', 'View', 'Zoom in', ['ctrl+=']],
  ['zoomOut', 'View', 'Zoom out', ['ctrl+-']],
  ['zoomSelection', 'View', 'Zoom to the selection', ['ctrl+alt+0']],
  ['rotateLeft', 'View', 'Turn the view left', ['4']],
  ['rotateRight', 'View', 'Turn the view right', ['6']],
  ['rotateReset', 'View', 'Straighten the view', ['5']],
  ['mirrorView', 'View', 'Mirror the view', ['shift+m']],
  ['grid', 'View', 'Show the grid', ["ctrl+'"]],
  ['snap', 'View', 'Snap to rulers', ['ctrl+2']],
  ['guides', 'View', 'Show rulers and guides', ['ctrl+;']],
  ['panels', 'View', 'Hide / show the panels', ['tab']],
  ['save', 'File', 'Save now', ['ctrl+s']],
  ['exportPng', 'File', 'Export a PNG', ['ctrl+shift+s']],
  ['export', 'File', 'Export…', ['ctrl+alt+shift+s']],
];

/** Keys that cannot be given to a command: held keys, dialog keys, the guide, reload and paste. */
export const RESERVED = new Set(['space', 'alt', 'control', 'ctrl', 'shift', 'meta', 'escape', 'enter', 'f1', 'f5', 'ctrl+r', 'ctrl+shift+r', 'ctrl+v',
  'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'shift+arrowleft', 'shift+arrowright', 'shift+arrowup', 'shift+arrowdown']);

/** Whether a combo can be bound: a real key (not only modifiers) that is not reserved. */
export function bindable(combo) {
  if (typeof combo !== 'string' || !combo || combo.length > 40 || RESERVED.has(combo)) return false;
  const key = combo.split('+').pop();
  return !!key && !['control', 'shift', 'alt', 'meta', 'ctrl', 'dead', 'unidentified', 'process'].includes(key);
}

/** Every id that can have keys: the commands, then 'tool:<id>' per tool. */
export function allIds(tools) {
  return [...COMMANDS.map(c => c[0]), ...tools.map(t => 'tool:' + t.id)];
}

/** The user's stored changes, cleaned: known ids only, each a list of bindable combos (an empty list = no key). */
export function sanitizeShortcuts(raw, tools) {
  const out = {}, ids = new Set(allIds(tools));
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, list] of Object.entries(raw)) {
    if (!ids.has(id) || !Array.isArray(list)) continue;
    out[id] = [...new Set(list.filter(bindable))].slice(0, 4);
  }
  return out;
}

/** id -> its keys now: the user's change where there is one, else the default. */
export function bindings(custom, tools) {
  const out = new Map();
  for (const [id, , , def] of COMMANDS) out.set(id, custom[id] ?? def);
  for (const t of tools) out.set('tool:' + t.id, custom['tool:' + t.id] ?? (t.key ? [t.key] : []));
  return out;
}

/** combo -> the ids it runs (several only for tools that take turns on one key). */
export function comboTable(binds) {
  const out = new Map();
  for (const [id, combos] of binds) for (const c of combos) out.set(c, [...(out.get(c) || []), id]);
  return out;
}

/** The tool a key gives: the first tool on it, or the one after the current tool when several share it. */
export function toolForCombo(table, combo, current) {
  const tools = (table.get(combo) || []).filter(id => id.startsWith('tool:')).map(id => id.slice(5));
  if (!tools.length) return null;
  return tools[(tools.indexOf(current) + 1) % tools.length];
}

/**
 * Gives `id` the key `combo` (in place of its keys), taking it away from whatever else had it, except that tools
 * may share a key (they take turns). Returns {custom (new object), took: [ids that lost it]}.
 */
export function assignKey(custom, tools, id, combo) {
  const binds = bindings(custom, tools), next = { ...custom }, took = [];
  for (const [other, combos] of binds) {
    if (other === id || !combos.includes(combo)) continue;
    if (id.startsWith('tool:') && other.startsWith('tool:')) continue;
    next[other] = combos.filter(c => c !== combo);
    took.push(other);
  }
  next[id] = [combo];
  return { custom: next, took };
}

const NAMES = { delete: 'Del', backspace: 'Backspace', tab: 'Tab', insert: 'Ins', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn', space: 'Space' };
const NAME_TO_KEY = Object.fromEntries(Object.entries(NAMES).map(([k, v]) => [v.toLowerCase(), k]));

/** How a combo is shown: 'ctrl+shift+n' -> 'Ctrl+Shift+N', 'alt+delete' -> 'Alt+Del'. */
export function comboLabel(combo) {
  const parts = combo.split('+'), key = parts.pop();  // comboOf never gives '+' as the key (it is '=')
  const k = NAMES[key] || (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  return [...parts.map(m => m[0].toUpperCase() + m.slice(1)), k].join('+');
}

/** A label as written in the menus back to a combo ('Shift+Alt+Del' -> 'alt+shift+delete'), modifiers in comboOf order. */
export function labelCombo(label) {
  const parts = String(label).toLowerCase().split('+'), key = parts.pop();
  const mods = ['ctrl', 'alt', 'shift'].filter(m => parts.includes(m));
  return [...mods, NAME_TO_KEY[key] || key].join('+');
}

/** Who has a combo by default (so a menu's key label can follow the user's change), or null. */
export function defaultOwner(combo) {
  return COMMANDS.find(c => c[3].includes(combo))?.[0] ?? null;
}

/** A menu item's key label as it is now: its command's first key now ('' when it has none). */
export function menuKeyLabel(label, binds) {
  const id = defaultOwner(labelCombo(label));
  if (!id) return label;
  const first = (binds.get(id) || [])[0];
  return first ? comboLabel(first) : '';
}
