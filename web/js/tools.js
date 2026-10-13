// Tool list and per-tool settings (pure, tested). Each tool remembers its own settings, as in other painting programs.

import { SELECT_MODES } from './selection.js';

export const TOOLS = [
  { id: 'pen', label: 'Pen', key: 'p', kind: 'paint', icon: 'pen', group: 'draw',
    defaults: { size: 6, opacity: 1, flow: 1, hardness: 1, spacing: 0.08, pressureSize: true, pressureOpacity: false, minSize: 0.15, smoothing: 4, gamma: 1 } },
  { id: 'pencil', label: 'Pencil', key: 'n', kind: 'paint', icon: 'pencil', group: 'draw',
    defaults: { size: 4, opacity: 0.85, flow: 0.7, hardness: 0.7, spacing: 0.12, pressureSize: true, pressureOpacity: true, minSize: 0.4, smoothing: 1, gamma: 1 } },
  { id: 'brush', label: 'Brush', key: 'b', kind: 'paint', icon: 'brush', group: 'draw',
    defaults: { size: 30, opacity: 1, flow: 0.35, hardness: 0.5, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'airbrush', label: 'Airbrush', key: 'a', kind: 'paint', icon: 'air', group: 'draw',
    defaults: { size: 120, opacity: 1, flow: 0.06, hardness: 0, spacing: 0.06, pressureSize: false, pressureOpacity: true, minSize: 0.5, smoothing: 0, gamma: 1 } },
  { id: 'eraser', label: 'Eraser', key: 'e', kind: 'paint', icon: 'eraser', erase: true, group: 'draw',
    defaults: { size: 30, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.08, pressureSize: false, pressureOpacity: false, minSize: 0.3, smoothing: 0, gamma: 1 } },
  { id: 'fill', label: 'Fill', key: 'g', kind: 'fill', icon: 'fill', group: 'draw',
    defaults: { opacity: 1, tolerance: 12, grow: 1, sampleAll: true } },
  { id: 'picker', label: 'Eyedropper', key: 'i', kind: 'picker', icon: 'picker', group: 'draw', defaults: {} },
  { id: 'select', label: 'Rectangle selection', key: 'm', kind: 'select', icon: 'rectSel', group: 'select', defaults: { mode: 'replace' } },
  { id: 'lasso', label: 'Lasso selection', key: 'l', kind: 'select', icon: 'lasso', group: 'select', defaults: { mode: 'replace' } },
  { id: 'wand', label: 'Magic wand', key: 'w', kind: 'select', icon: 'wand', group: 'select', defaults: { mode: 'replace', tolerance: 12, sampleAll: true } },
  { id: 'move', label: 'Move layer', key: 'v', kind: 'move', icon: 'move', group: 'select', defaults: {} },
  { id: 'crop', label: 'Crop', key: 'c', kind: 'crop', icon: 'crop', group: 'select', defaults: {} },
  { id: 'ruler', label: 'Ruler', key: 'u', kind: 'ruler', icon: 'ruler', group: 'view', defaults: {} },
  { id: 'hand', label: 'Hand', key: 'h', kind: 'hand', icon: 'hand', group: 'view', defaults: {} },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

/** The settings each control in the tool panel edits: [key, label, type, min, max, step], or [key, label, 'choice', options]. */
export const SETTING_FIELDS = [
  ['mode', 'Mode', 'choice', SELECT_MODES],
  ['size', 'Size', 'range', 1, 1000, 1],
  ['opacity', 'Opacity', 'range', 0.01, 1, 0.01],
  ['flow', 'Density', 'range', 0.01, 1, 0.01],
  ['hardness', 'Hardness', 'range', 0, 1, 0.01],
  ['spacing', 'Spacing', 'range', 0.02, 1, 0.01],
  ['minSize', 'Min. size', 'range', 0, 1, 0.01],
  ['smoothing', 'Stabilization', 'range', 0, 20, 1],
  ['gamma', 'Pressure', 'range', 0.3, 3, 0.05],
  ['pressureSize', 'Pressure → size', 'check'],
  ['pressureOpacity', 'Pressure → density', 'check'],
  ['tolerance', 'Margin', 'range', 0, 255, 1],
  ['grow', 'Expand', 'range', 0, 6, 1],
  ['sampleAll', 'Look at all layers', 'check'],
];

/** Tooltips for the tool settings whose short label needs explaining. */
export const SETTING_HINTS = {
  mode: 'What a new selection does with the one you have (or hold Shift / Alt while dragging)',
  flow: 'How much paint each dab lays down; it builds up within one stroke, while Opacity caps the whole stroke',
  hardness: 'Hard edge (100%) or soft, fading edge',
  spacing: 'Distance between dabs, as a share of the brush size',
  minSize: 'Brush size at the lightest pen pressure, as a share of Size',
  smoothing: 'Evens out shaky lines; higher values trail further behind the pen',
  gamma: 'Pressure curve: below 1 light pressure counts more, above 1 you have to press harder',
  tolerance: 'How different a colour may be and still count as the same area',
  grow: 'Grows the filled area by this many pixels, so it tucks under line edges',
  sampleAll: 'Find the area from everything you see (on) or from the current layer only (off)',
};

/** Every tool's settings, starting from its defaults and keeping only valid stored values. */
export function sanitizeSettings(stored) {
  const out = {};
  for (const t of TOOLS) {
    const s = { ...t.defaults };
    const from = stored && typeof stored === 'object' ? stored[t.id] : null;
    if (from && typeof from === 'object') {
      for (const [key, , type, min, max] of SETTING_FIELDS) {
        if (!(key in s) || !(key in from)) continue;
        if (type === 'check') s[key] = !!from[key];
        else if (type === 'choice') { if (min.some(o => o[0] === from[key])) s[key] = from[key]; }
        else if (Number.isFinite(+from[key])) s[key] = Math.max(min, Math.min(max, +from[key]));
      }
    }
    out[t.id] = s;
  }
  return out;
}

/** Brush size steps for the [ and ] keys: finer when small. */
export function nextSize(size, dir) {
  const step = size < 10 ? 1 : size < 40 ? 2 : size < 100 ? 5 : size < 300 ? 10 : 25;
  return Math.max(1, Math.min(1000, Math.round(size + dir * step)));
}
