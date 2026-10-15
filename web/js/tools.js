// Tool list and per-tool settings (pure, tested). Each tool remembers its own settings, as in other painting programs.

import { SELECT_MODES } from './selection.js';
import { GRADIENT_COLORS, GRADIENT_SHAPES } from './gradient.js';
import { FONTS, ALIGNS } from './textlayer.js';
import { TEXTURES } from './textures.js';
import { FIGURE_SHAPES } from './figure.js';

/** Where Fill and the Magic wand find their area. */
export const SAMPLE_FROM = [['all', 'All layers'], ['layer', 'This layer'], ['reference', 'Reference layers']];

/** Brush texture settings (textures.js): which grain, how strongly it shows, and its scale. */
function tex(texture = 'none', textureAmount = 0.5) { return { texture, textureAmount, textureScale: 1 }; }

export const TOOLS = [
  { id: 'pen', label: 'Pen', key: 'p', kind: 'paint', icon: 'pen', group: 'draw',
    defaults: { size: 6, opacity: 1, flow: 1, hardness: 1, spacing: 0.08, pressureSize: true, pressureOpacity: false, minSize: 0.15, smoothing: 4, gamma: 1, ...tex() } },
  { id: 'pencil', label: 'Pencil', key: 'n', kind: 'paint', icon: 'pencil', group: 'draw',
    defaults: { size: 4, opacity: 0.85, flow: 0.7, hardness: 0.7, spacing: 0.12, pressureSize: true, pressureOpacity: true, minSize: 0.4, smoothing: 1, gamma: 1, ...tex('paper', 0.6) } },
  { id: 'brush', label: 'Brush', key: 'b', kind: 'paint', icon: 'brush', group: 'draw',
    defaults: { size: 30, opacity: 1, flow: 0.35, hardness: 0.5, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1, ...tex() } },
  { id: 'airbrush', label: 'Airbrush', key: 'a', kind: 'paint', icon: 'air', group: 'draw',
    defaults: { size: 120, opacity: 1, flow: 0.06, hardness: 0, spacing: 0.06, pressureSize: false, pressureOpacity: true, minSize: 0.5, smoothing: 0, gamma: 1, ...tex() } },
  { id: 'eraser', label: 'Eraser', key: 'e', kind: 'paint', icon: 'eraser', erase: true, group: 'draw',
    defaults: { size: 30, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.08, pressureSize: false, pressureOpacity: false, minSize: 0.3, smoothing: 0, gamma: 1, ...tex() } },
  { id: 'smudge', label: 'Smudge', key: 'j', kind: 'smudge', icon: 'smudge', group: 'draw',
    defaults: { size: 40, strength: 0.6, hardness: 0.3, spacing: 0.08, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'fill', label: 'Fill', key: 'g', kind: 'fill', icon: 'fill', group: 'draw',
    defaults: { opacity: 1, tolerance: 12, grow: 1, sample: 'all', contiguous: true } },
  { id: 'gradient', label: 'Gradient', key: 'g', kind: 'gradient', icon: 'gradient', group: 'draw',
    defaults: { colors: 'main-sub', shape: 'linear', opacity: 1 } },
  { id: 'lassofill', label: 'Lasso fill', key: 'g', kind: 'lassofill', icon: 'lassoFill', group: 'draw', defaults: { opacity: 1 } },
  { id: 'figure', label: 'Figure', key: 'u', kind: 'figure', icon: 'figure', group: 'draw',
    defaults: { figure: 'line', size: 6, opacity: 1, hardness: 1, corner: 0, fill: false } },
  { id: 'text', label: 'Text', key: 't', kind: 'text', icon: 'text', group: 'draw',
    defaults: { font: 'Segoe UI', size: 48, bold: false, italic: false, align: 'left', leading: 1.2, vertical: false } },
  { id: 'picker', label: 'Eyedropper', key: 'i', kind: 'picker', icon: 'picker', group: 'draw', defaults: {} },
  { id: 'select', label: 'Rectangle selection', key: 'm', kind: 'select', icon: 'rectSel', group: 'select', defaults: { mode: 'replace' } },
  { id: 'ellipse', label: 'Ellipse selection', key: 'm', kind: 'select', icon: 'ellipseSel', group: 'select', defaults: { mode: 'replace' } },
  { id: 'lasso', label: 'Lasso selection', key: 'l', kind: 'select', icon: 'lasso', group: 'select', defaults: { mode: 'replace' } },
  { id: 'polygon', label: 'Polygon selection', key: 'l', kind: 'select', icon: 'polySel', group: 'select', defaults: { mode: 'replace' } },
  { id: 'wand', label: 'Magic wand', key: 'w', kind: 'select', icon: 'wand', group: 'select', defaults: { mode: 'replace', tolerance: 12, sample: 'all', contiguous: true } },
  { id: 'move', label: 'Move layer', key: 'v', kind: 'move', icon: 'move', group: 'select', defaults: {} },
  { id: 'crop', label: 'Crop', key: 'c', kind: 'crop', icon: 'crop', group: 'select', defaults: {} },
  { id: 'ruler', label: 'Ruler', key: 'u', kind: 'ruler', icon: 'ruler', group: 'view', defaults: {} },
  { id: 'hand', label: 'Hand', key: 'h', kind: 'hand', icon: 'hand', group: 'view', defaults: {} },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

/** The settings each control in the tool panel edits: [key, label, type, min, max, step], or [key, label, 'choice', options]. */
export const SETTING_FIELDS = [
  ['mode', 'Mode', 'choice', SELECT_MODES],
  ['figure', 'Shape', 'choice', FIGURE_SHAPES],
  ['colors', 'Colors', 'choice', GRADIENT_COLORS],
  ['shape', 'Shape', 'choice', GRADIENT_SHAPES],
  ['font', 'Font', 'choice', FONTS],
  ['align', 'Align', 'choice', ALIGNS],
  ['size', 'Size', 'range', 1, 1000, 1],
  ['opacity', 'Opacity', 'range', 0.01, 1, 0.01],
  ['flow', 'Density', 'range', 0.01, 1, 0.01],
  ['strength', 'Strength', 'range', 0.01, 1, 0.01],
  ['hardness', 'Hardness', 'range', 0, 1, 0.01],
  ['spacing', 'Spacing', 'range', 0.02, 1, 0.01],
  ['minSize', 'Min. size', 'range', 0, 1, 0.01],
  ['smoothing', 'Stabilization', 'range', 0, 20, 1],
  ['gamma', 'Pressure', 'range', 0.3, 3, 0.05],
  ['texture', 'Texture', 'choice', TEXTURES],
  ['textureAmount', 'Grain', 'range', 0, 1, 0.01],
  ['textureScale', 'Grain size', 'range', 0.25, 4, 0.05],
  ['leading', 'Line spacing', 'range', 0.5, 4, 0.05],
  ['corner', 'Round corners', 'range', 0, 500, 1],
  ['bold', 'Bold', 'check'],
  ['italic', 'Italic', 'check'],
  ['vertical', 'Vertical', 'check'],
  ['fill', 'Fill the shape', 'check'],
  ['pressureSize', 'Pressure → size', 'check'],
  ['pressureOpacity', 'Pressure → density', 'check'],
  ['tolerance', 'Margin', 'range', 0, 255, 1],
  ['grow', 'Expand', 'range', 0, 6, 1],
  ['sample', 'Look at', 'choice', SAMPLE_FROM],
  ['contiguous', 'Connected only', 'check'],
];

/** Which group of the tool panel a paint setting belongs to (paint tools only; other tools show one flat list). */
export const SETTING_GROUPS = [
  ['Brush', ['size', 'opacity', 'flow', 'hardness']],
  ['Pen pressure', ['pressureSize', 'pressureOpacity', 'minSize', 'gamma']],
  ['Stroke', ['spacing', 'smoothing']],
  ['Texture', ['texture', 'textureAmount', 'textureScale']],
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
  sample: 'Find the area from everything you see, the current layer only, or only layers marked as reference (Layer panel)',
  strength: 'How far each dab drags the colour along (pen pressure makes it stronger when Pressure → density is on)',
  colors: 'Main and sub are the two colour squares in the Color panel',
  shape: 'Straight: along the line you drag. Circle: outwards from where you start',
  align: 'Which side lines line up on (for vertical text: top, middle or bottom of the columns)',
  leading: 'Distance between lines (or columns), as a multiple of the text size',
  vertical: 'Write top to bottom, with columns from right to left, as in manga',
  texture: 'Paper grain for the whole stroke; it stays fixed to the canvas, so strokes share one grain',
  textureAmount: 'How much paint the grooves of the texture leave out',
  textureScale: 'Size of the texture (100% = as made)',
  figure: 'Drag to draw it; hold Shift for a 45° line, a square or a circle',
  fill: 'Fill the rectangle or ellipse, not only its outline',
  corner: 'Corner radius of rectangles, in pixels (0 = sharp corners)',
  contiguous: 'Only the area connected to where you click (on), or every pixel of that colour in the picture (off)',
};

/** Every tool's settings, starting from its defaults and keeping only valid stored values. */
export function sanitizeSettings(stored) {
  const out = {};
  for (const t of TOOLS) {
    const s = { ...t.defaults };
    let from = stored && typeof stored === 'object' ? stored[t.id] : null;
    // before 'sample', Fill and the wand had a "look at all layers" tick
    if (from && typeof from === 'object' && !('sample' in from) && from.sampleAll === false) from = { ...from, sample: 'layer' };
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

/** The tool a shortcut key picks: tools sharing a key (G: fill, gradient) take turns on repeated presses. */
export function toolForKey(key, current) {
  const matches = TOOLS.filter(t => t.key === key);
  if (!matches.length) return null;
  const i = matches.findIndex(t => t.id === current);
  return matches[(i + 1) % matches.length].id;
}

/** Brush size steps for the [ and ] keys: finer when small. */
export function nextSize(size, dir) {
  const step = size < 10 ? 1 : size < 40 ? 2 : size < 100 ? 5 : size < 300 ? 10 : 25;
  return Math.max(1, Math.min(1000, Math.round(size + dir * step)));
}
