// Tool list and per-tool settings (pure, tested). Each tool remembers its own settings, as in other painting programs.

import { SELECT_MODES } from './selection.js';
import { GRADIENT_COLORS, GRADIENT_SHAPES, GRADIENT_REPEATS, isUserGradient } from './gradient.js';
import { FONTS, ALIGNS, OUTLINE_COLORS } from './textlayer.js';
import { TEXTURES } from './textures.js';
import { FIGURE_SHAPES } from './figure.js';
import { LIQUIFY_MODES } from './liquify.js';
import { sanitizeCurve } from './brush.js';
import { imageRef } from './brushtip.js';
import { COMBO_DEFAULTS, COMBO_MODES } from './combo.js';

/** Where Fill and the Magic wand find their area. */
export const SAMPLE_FROM = [['all', 'All layers'], ['layer', 'This layer'], ['reference', 'Reference layers']];
/** Where the Eyedropper picks from, and how many pixels round the point it averages. */
export const PICK_FROM = [['all', 'All layers'], ['layer', 'This layer']];
export const PICK_AVERAGE = [['1', '1 pixel'], ['3', '3 × 3 average'], ['5', '5 × 5 average'], ['11', '11 × 11 average']];

/** Brush texture settings (textures.js): which grain, how strongly it shows, and its scale. */
function tex(texture = 'none', textureAmount = 0.5) {
  return { texture, textureAmount, textureScale: 1, textureInvert: false, grainPressure: false, tip: 'round', thickness: 1, tipAngle: 0, tipRandom: 0, tipFollow: false, flipX: false, flipY: false, roundJitter: 0, pixel: false,
    minFlow: 0, sizeCurve: null, flowCurve: null, scatter: 0, scatterBoth: true, sizeJitter: 0, flowJitter: 0, hueJitter: 0, satJitter: 0, valJitter: 0, colorJitterStroke: false, taperIn: 0, taperOut: 0, taperSize: 1, taperOpacity: 0,
    tiltSize: 0, tiltFlow: 0, tiltAngle: false, speedSize: 0, speedFlow: 0, count: 1, countJitter: 0, quickShape: false, refStop: false,
    dualTip: 'none', dualSize: 0.6, dualSpacing: 0.25, dualScatter: 0.5, wetEdges: 0, impasto: 0, dryOut: 0, mix: 0, mixStretch: 0.5, paintLoad: 1,
    ...COMBO_DEFAULTS, preset: '' };
}

/** Tip shapes besides the tip images in the brush library ('img:<id>'). */
export const TIPS = [['round', 'Round'], ['bristle', 'Bristles'], ['flat', 'Flat brush']];
/** The dual brush's tip: off, or a tip shape as for the main tip. Bristles: painter.js builtinTip, brushtip.js bristleDots. */
export const DUAL_TIPS = [['none', 'Off'], ...TIPS];
/** The combined brush's tip: off, or a tip shape as for the main tip. */
export const COMBO_TIPS = [['none', 'Off'], ...TIPS];
/** How the Eraser works on vector layers (vector.js eraseVector). */
export const VECTOR_ERASE = [['area', 'Touched area'], ['intersection', 'Up to intersection'], ['line', 'Whole line']];

export const TOOLS = [
  { id: 'pen', label: 'Pen', key: 'p', kind: 'paint', icon: 'pen', group: 'draw',
    defaults: { size: 6, opacity: 1, flow: 1, hardness: 1, spacing: 0.08, pressureSize: true, pressureOpacity: false, minSize: 0.15, smoothing: 4, gamma: 1, ...tex() } },
  { id: 'pencil', label: 'Pencil', key: 'n', kind: 'paint', icon: 'pencil', group: 'draw',
    defaults: { size: 6, opacity: 1, flow: 0.45, hardness: 0.6, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.5, smoothing: 1, gamma: 1, ...tex('paper', 0.6), minFlow: 0.1, grainPressure: true } },
  { id: 'brush', label: 'Brush', key: 'b', kind: 'paint', icon: 'brush', group: 'draw',
    defaults: { size: 30, opacity: 1, flow: 0.55, hardness: 0.8, spacing: 0.05, pressureSize: true, pressureOpacity: true, minSize: 0.25, smoothing: 2, gamma: 1, ...tex(), taperOut: 20 } },
  { id: 'airbrush', label: 'Airbrush', key: 'a', kind: 'paint', icon: 'air', group: 'draw',
    defaults: { size: 120, opacity: 1, flow: 0.06, hardness: 0, spacing: 0.06, pressureSize: false, pressureOpacity: true, minSize: 0.5, smoothing: 0, gamma: 1, ...tex() } },
  { id: 'eraser', label: 'Eraser', key: 'e', kind: 'paint', icon: 'eraser', erase: true, group: 'draw',
    defaults: { vectorErase: 'area', size: 30, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.08, pressureSize: false, pressureOpacity: false, minSize: 0.3, smoothing: 0, gamma: 1, ...tex() } },
  { id: 'lineedit', label: 'Line edit', key: 'y', kind: 'lineedit', icon: 'lineEdit', group: 'draw', defaults: { reach: 40 } },
  { id: 'smudge', label: 'Smudge', key: 'j', kind: 'smudge', icon: 'smudge', group: 'draw',
    defaults: { size: 40, strength: 0.6, hardness: 0.3, spacing: 0.08, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'liquify', label: 'Liquify', key: 'j', kind: 'liquify', icon: 'liquify', group: 'draw',
    defaults: { liquify: 'push', size: 120, strength: 0.7, spacing: 0.08, pressureSize: false, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'blur', label: 'Blur', key: 'j', kind: 'retouch', icon: 'blurTool', group: 'draw',
    defaults: { size: 50, strength: 0.5, hardness: 0.3, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'dodge', label: 'Dodge (lighten)', key: 'o', kind: 'retouch', icon: 'dodge', group: 'draw',
    defaults: { size: 60, strength: 0.08, hardness: 0.2, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'burn', label: 'Burn (darken)', key: 'o', kind: 'retouch', icon: 'burn', group: 'draw',
    defaults: { size: 60, strength: 0.08, hardness: 0.2, spacing: 0.1, pressureSize: true, pressureOpacity: true, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'clone', label: 'Clone stamp', key: 's', kind: 'retouch', icon: 'clone', group: 'draw',
    defaults: { size: 40, strength: 1, hardness: 0.6, spacing: 0.08, sample: 'layer', aligned: true, pressureSize: true, pressureOpacity: false, minSize: 0.3, smoothing: 2, gamma: 1 } },
  { id: 'fill', label: 'Fill', key: 'g', kind: 'fill', icon: 'fill', group: 'draw',
    defaults: { opacity: 1, tolerance: 12, grow: 1, gap: 0, sample: 'all', contiguous: true } },
  { id: 'gradient', label: 'Gradient', key: 'g', kind: 'gradient', icon: 'gradient', group: 'draw',
    defaults: { colors: 'main-sub', shape: 'linear', repeat: 'none', dither: false, opacity: 1 } },
  { id: 'lassofill', label: 'Lasso fill', key: 'g', kind: 'lassofill', icon: 'lassoFill', group: 'draw', defaults: { opacity: 1, lassoErase: false } },
  { id: 'gapfill', label: 'Fill gaps', key: 'g', kind: 'gapfill', icon: 'gapFill', group: 'draw', defaults: { size: 30, opacity: 1, tolerance: 12, sample: 'all' } },
  { id: 'figure', label: 'Figure', key: 'u', kind: 'figure', icon: 'figure', group: 'draw',
    defaults: { figure: 'line', size: 6, opacity: 1, hardness: 1, corner: 0, sides: 5, depth: 0.5, fill: false } },
  { id: 'text', label: 'Text', key: 't', kind: 'text', icon: 'text', group: 'draw',
    defaults: { font: 'Segoe UI', size: 48, bold: false, italic: false, align: 'left', leading: 1.2, vertical: false, outline: 0, outlineColor: 'white' } },
  { id: 'picker', label: 'Eyedropper', key: 'i', kind: 'picker', icon: 'picker', group: 'draw', defaults: { pickFrom: 'all', average: '1' } },
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
  ['vectorErase', 'Vector', 'choice', VECTOR_ERASE],
  ['figure', 'Shape', 'choice', FIGURE_SHAPES],
  ['colors', 'Colors', 'choice', GRADIENT_COLORS],
  ['shape', 'Shape', 'choice', GRADIENT_SHAPES],
  ['repeat', 'Repeat', 'choice', GRADIENT_REPEATS],
  ['dither', 'Dither', 'check'],
  ['font', 'Font', 'choice', FONTS],
  ['align', 'Align', 'choice', ALIGNS],
  ['size', 'Size', 'range', 1, 1000, 1],
  ['opacity', 'Opacity', 'range', 0.01, 1, 0.01],
  ['flow', 'Density', 'range', 0.01, 1, 0.01],
  ['liquify', 'Mode', 'choice', LIQUIFY_MODES],
  ['reach', 'Pull range', 'range', 2, 400, 1],
  ['strength', 'Strength', 'range', 0.01, 1, 0.01],
  ['hardness', 'Hardness', 'range', 0, 1, 0.01],
  ['spacing', 'Spacing', 'range', 0.005, 1, 0.005],
  ['minSize', 'Min. size', 'range', 0, 1, 0.01],
  ['smoothing', 'Stabilization', 'range', 0, 20, 1],
  ['gamma', 'Pressure', 'range', 0.3, 3, 0.05],
  ['tip', 'Tip', 'choice', TIPS],
  ['thickness', 'Squash', 'range', 0.05, 1, 0.01],
  ['tipAngle', 'Angle', 'range', 0, 360, 1],
  ['tipRandom', 'Random turn', 'range', 0, 1, 0.01],
  ['tipFollow', 'Turn with the stroke', 'check'],
  ['roundJitter', 'Squash jitter', 'range', 0, 1, 0.01],
  ['flipX', 'Random flip ↔', 'check'],
  ['flipY', 'Random flip ↕', 'check'],
  ['pixel', 'Hard pixels', 'check'],
  ['dualTip', 'Dual tip', 'choice', DUAL_TIPS],
  ['dualSize', 'Dual size', 'range', 0.05, 3, 0.01],
  ['dualSpacing', 'Dual spacing', 'range', 0.02, 2, 0.01],
  ['dualScatter', 'Dual scatter', 'range', 0, 3, 0.01],
  ['comboTip', 'Second brush', 'choice', COMBO_TIPS],
  ['comboMode', 'Combine', 'choice', COMBO_MODES],
  ['comboSize', 'Size', 'range', 0.05, 3, 0.01],
  ['comboFlow', 'Density', 'range', 0.01, 1, 0.01],
  ['comboHardness', 'Hardness', 'range', 0, 1, 0.01],
  ['comboSpacing', 'Spacing', 'range', 0.02, 1, 0.01],
  ['comboThickness', 'Squash', 'range', 0.05, 1, 0.01],
  ['comboAngle', 'Angle', 'range', 0, 360, 1],
  ['comboRandom', 'Random turn', 'range', 0, 1, 0.01],
  ['comboFollow', 'Turn with the stroke', 'check'],
  ['comboScatter', 'Scatter', 'range', 0, 2, 0.01],
  ['comboSizeJitter', 'Size jitter', 'range', 0, 1, 0.01],
  ['comboPressureSize', 'Pressure → size', 'check'],
  ['comboMinSize', 'Min. size', 'range', 0, 1, 0.01],
  ['comboPressureFlow', 'Pressure → density', 'check'],
  ['comboMinFlow', 'Min. density', 'range', 0, 1, 0.01],
  ['minFlow', 'Min. density', 'range', 0, 1, 0.01],
  ['scatter', 'Scatter', 'range', 0, 2, 0.01],
  ['scatterBoth', 'Both ways', 'check'],
  ['count', 'Count', 'range', 1, 16, 1],
  ['countJitter', 'Count jitter', 'range', 0, 1, 0.01],
  ['sizeJitter', 'Size jitter', 'range', 0, 1, 0.01],
  ['flowJitter', 'Density jitter', 'range', 0, 1, 0.01],
  ['hueJitter', 'Hue jitter', 'range', 0, 1, 0.01],
  ['satJitter', 'Sat. jitter', 'range', 0, 1, 0.01],
  ['valJitter', 'Light jitter', 'range', 0, 1, 0.01],
  ['colorJitterStroke', 'Once per stroke', 'check'],
  ['taperIn', 'Start taper', 'range', 0, 500, 1],
  ['taperOut', 'End taper', 'range', 0, 500, 1],
  ['taperSize', 'Taper size', 'range', 0, 1, 0.01],
  ['taperOpacity', 'Taper opacity', 'range', 0, 1, 0.01],
  ['quickShape', 'Hold to straighten', 'check'],
  ['refStop', 'Stay inside lines', 'check'],
  ['tiltSize', 'Tilt → size', 'range', 0, 1, 0.01],
  ['tiltFlow', 'Tilt → lighter', 'range', 0, 1, 0.01],
  ['tiltAngle', 'Turn with pen tilt', 'check'],
  ['speedSize', 'Speed → size', 'range', -1, 1, 0.01],
  ['speedFlow', 'Speed → paint', 'range', -1, 1, 0.01],
  ['sizeCurve', 'Size curve', 'curve'],
  ['flowCurve', 'Density curve', 'curve'],
  ['texture', 'Texture', 'choice', TEXTURES],
  ['textureInvert', 'Invert texture', 'check'],
  ['grainPressure', 'Grain by pressure', 'check'],
  ['preset', 'Brush', 'id'],
  ['textureAmount', 'Grain', 'range', 0, 1, 0.01],
  ['textureScale', 'Grain size', 'range', 0.25, 4, 0.05],
  ['wetEdges', 'Wet edges', 'range', 0, 1, 0.01],
  ['impasto', 'Impasto', 'range', 0, 1, 0.01],
  ['dryOut', 'Runs dry', 'range', 0, 1, 0.01],
  ['mix', 'Color mixing', 'range', 0, 1, 0.01],
  ['mixStretch', 'Color stretch', 'range', 0, 1, 0.01],
  ['paintLoad', 'Paint load', 'range', 0, 1, 0.01],
  ['leading', 'Line spacing', 'range', 0.5, 4, 0.05],
  ['outline', 'Outline', 'range', 0, 50, 1],
  ['outlineColor', 'Outline in', 'choice', OUTLINE_COLORS],
  ['corner', 'Rounding', 'range', 0, 500, 1],
  ['sides', 'Corners', 'range', 3, 32, 1],
  ['depth', 'Star depth', 'range', 0.1, 0.95, 0.01],
  ['bold', 'Bold', 'check'],
  ['italic', 'Italic', 'check'],
  ['vertical', 'Vertical', 'check'],
  ['fill', 'Fill the shape', 'check'],
  ['lassoErase', 'Erase', 'check'],
  ['pressureSize', 'Pressure → size', 'check'],
  ['pressureOpacity', 'Pressure → density', 'check'],
  ['tolerance', 'Margin', 'range', 0, 255, 1],
  ['grow', 'Expand', 'range', 0, 6, 1],
  ['gap', 'Close gaps', 'range', 0, 20, 1],
  ['sample', 'Look at', 'choice', SAMPLE_FROM],
  ['pickFrom', 'Pick from', 'choice', PICK_FROM],
  ['average', 'Sample', 'choice', PICK_AVERAGE],
  ['contiguous', 'Connected only', 'check'],
  ['aligned', 'Aligned', 'check'],
];

/** The paint settings the tool panel shows; the rest are in the Brush settings window (as Clip Studio Paint's Sub Tool Detail). */
export const BASIC_PAINT = ['vectorErase', 'size', 'opacity', 'flow', 'hardness', 'smoothing'];

/** The pages of the Brush settings window, and which settings each holds (paint tools only; other tools show one flat list). */
export const SETTING_GROUPS = [
  ['Paint', ['vectorErase', 'size', 'opacity', 'flow', 'hardness', 'wetEdges', 'impasto', 'dryOut', 'mix', 'mixStretch', 'paintLoad', 'refStop']],
  ['Tip', ['tip', 'thickness', 'tipAngle', 'tipRandom', 'tipFollow', 'roundJitter', 'flipX', 'flipY', 'pixel']],
  ['Pen pressure', ['pressureSize', 'pressureOpacity', 'minSize', 'minFlow', 'gamma', 'sizeCurve', 'flowCurve']],
  ['Stroke', ['spacing', 'smoothing', 'taperIn', 'taperOut', 'taperSize', 'taperOpacity', 'quickShape']],
  ['Tilt and speed', ['tiltSize', 'tiltFlow', 'tiltAngle', 'speedSize', 'speedFlow']],
  ['Variation', ['scatter', 'scatterBoth', 'count', 'countJitter', 'sizeJitter', 'flowJitter', 'hueJitter', 'satJitter', 'valJitter', 'colorJitterStroke']],
  ['Texture', ['texture', 'textureAmount', 'textureScale', 'textureInvert', 'grainPressure']],
  ['Dual brush', ['dualTip', 'dualSize', 'dualSpacing', 'dualScatter']],
  ['Combined', ['comboTip', 'comboMode', 'comboSize', 'comboFlow', 'comboHardness', 'comboSpacing', 'comboThickness', 'comboAngle', 'comboRandom', 'comboFollow',
    'comboScatter', 'comboSizeJitter', 'comboPressureSize', 'comboMinSize', 'comboPressureFlow', 'comboMinFlow']],
];

/** Tooltips for the tool settings whose short label needs explaining. */
export const SETTING_HINTS = {
  vectorErase: 'On vector layers: Touched area cuts away what the eraser passes over; Up to intersection removes a line back to where it crosses other lines; Whole line removes every line it touches',
  mode: 'What a new selection does with the one you have (or hold Shift / Alt while dragging)',
  flow: 'How much paint each dab lays down; it builds up within one stroke, while Opacity caps the whole stroke',
  hardness: 'Hard edge (100%) or soft, fading edge',
  spacing: 'Distance between dabs, as a share of the brush size',
  minSize: 'Brush size at the lightest pen pressure, as a share of Size',
  smoothing: 'Evens out shaky lines; higher values trail further behind the pen',
  gamma: 'Pressure curve: below 1 light pressure counts more, above 1 you have to press harder',
  tolerance: 'How different a colour may be and still count as the same area',
  grow: 'Grows the filled area by this many pixels, so it tucks under line edges',
  gap: 'Fills as if openings in the lines up to about twice this many pixels were closed, so the fill does not leak out (0 = off)',
  pickFrom: 'All layers: the colour you see. This layer: the colour of the selected layer alone (also through Alt with other tools)',
  average: 'Takes the average colour of a square round the point, so the grain of a texture or noise does not decide the colour',
  sample: 'Find the area from everything you see, the current layer only, or only layers marked as reference (Layer panel)',
  aligned: 'Keeps the same distance between where it copies from and the brush for every stroke (off: each stroke starts again at the point you Ctrl+clicked)',
  strength: 'How strongly each dab smudges, blurs, lightens, darkens or bends the picture (pen pressure makes it stronger when Pressure → density is on)',
  reach: 'How far along the line (in pixels from where you grab it) the line follows when you drag it',
  liquify: 'Push drags the picture along with the pen; Pinch pulls it in, Bloat swells it, Twirl turns it (these keep working while you hold the pen still)',
  shape: 'Straight: along the line you drag. Circle: outwards from where you start. Angle: round the start, beginning in the direction you drag. Reflected: straight, both ways from the start. Diamond: outwards in a turned square',
  dither: 'Adds a faint, even grain so smooth gradients show no bands (steps between colour levels)',
  colors: 'Main and sub are the two colour squares in the Color panel; the named gradients have colours of their own',
  repeat: 'Once: the end colours fill the rest. Repeat: the gradient starts over and over. Mirror: it goes back and forth',
  align: 'Which side lines line up on (for vertical text: top, middle or bottom of the columns)',
  leading: 'Distance between lines (or columns), as a multiple of the text size',
  vertical: 'Write top to bottom, with columns from right to left, as in manga',
  texture: 'Paper grain for the whole stroke; it stays fixed to the canvas, so strokes share one grain',
  textureAmount: 'How much paint the grooves of the texture leave out',
  wetEdges: 'Like watercolour drying: the paint gathers at the edge of the stroke and the middle stays lighter',
  textureScale: 'Size of the texture (100% = as made)',
  impasto: 'Thick paint: light catches the top-left edges of the stroke and its bristle ridges, and the other side is shaded',
  dryOut: 'The brush gives out its paint along the stroke: the weak hairs drop out first and the end breaks into streaks (with a tip image or the Bristles / Flat tips). Higher runs dry sooner; each stroke starts loaded',
  paintLoad: 'How much paint of its own the brush carries (with Color mixing on): lower, it mostly moves the colours already there and leaves little on bare paper, as a blender does',
  mix: 'Wet paint: the brush picks up the colours already on this layer and mixes them into its own colour (0 = off). Not on vector layers',
  mixStretch: 'How far the picked-up colour is dragged along the stroke before the brush colour comes back (with Color mixing on)',
  figure: 'Drag to draw it; hold Shift for a 45° line, a square or a circle. Polyline and polygon: click each corner; Curve and Closed curve: click points the curve passes through. Double-click or Enter to finish',
  fill: 'Fill the rectangle, ellipse or polygon, not only its outline',
  lassoErase: 'Clear the area you draw round instead of filling it',
  corner: 'Corner radius of rectangles, in pixels (0 = sharp corners)',
  sides: 'How many corners a regular polygon has, or how many points a star has',
  depth: 'How far out the inner corners of a star sit: low gives thin, spiky points, high a fat star',
  outline: 'A border round the letters, in pixels (0 = none)',
  outlineColor: 'Colour of the outline; Sub colour takes the sub colour as it is now',
  contiguous: 'Only the area connected to where you click (on), or every pixel of that colour in the picture (off)',
  tip: 'The shape of each dab: round, or a tip image (Brush ⋯ → Add tip image…)',
  thickness: 'Squashes the tip: 100% keeps its shape, lower makes it flatter',
  tipAngle: 'Turns the tip (most useful with a squashed or image tip)',
  tipRandom: 'Turns each dab by a random amount, up to this share of a half turn either way',
  tipFollow: 'Turns the tip with the direction the stroke is going',
  roundJitter: 'Squashes each dab flatter by a random amount, up to this much (Photoshop and Procreate: roundness jitter)',
  flipX: 'Mirrors each dab left to right at random, so a tip picture does not repeat the same way along the stroke',
  flipY: 'Mirrors each dab top to bottom at random',
  comboTip: 'A second brush painting along the same stroke, as in Procreate combined brushes: pick its tip to turn it on (Off: just one brush). Copy a brush… takes a whole brush',
  comboMode: 'How the paint of the second brush goes over the first within the stroke: Normal on top, Multiply and Darken only darken, Screen and Lighten only lighten, Overlay deepens contrast',
  comboSize: 'Size of the second brush, as a share of the brush size (so both grow and shrink together)',
  comboFlow: 'How much paint each dab of the second brush lays down',
  comboSpacing: 'Distance between the dabs of the second brush, as a share of its size',
  comboScatter: 'Moves each dab of the second brush off the stroke by up to this many times its size',
  dualTip: 'A second tip stamped along the stroke: paint shows only where it lands, so the stroke breaks up like chalk, dry bristles or foliage',
  dualSize: 'Size of the dual tip, as a share of the brush size',
  dualSpacing: 'Distance between the dual tip\'s dabs, as a share of its size',
  dualScatter: 'Throws each dual dab off the stroke by up to this many times its size',
  pixel: 'Pixel art: every dab is whole pixels with no soft edge (1 px draws single pixels). The tip shape, hardness and turning are not used',
  minFlow: 'Density at the lightest pen pressure, as a share of Density',
  sizeCurve: 'How pen pressure maps to size (from an imported brush); it replaces the Pressure setting for size',
  flowCurve: 'How pen pressure maps to density (from an imported brush); it replaces the Pressure setting for density',
  grainPressure: 'Like a real pencil: a light touch marks only the tops of the paper grain, pressing harder fills the grooves too',
  textureInvert: 'Swaps the texture: paint goes into the dark parts instead of the light ones',
  count: 'Dabs at each step: more than 1 lays several at once, each with its own scatter and jitter (spray, foliage, sparkles; turn Scatter up to spread them)',
  scatter: 'Moves each dab a random distance from the stroke, up to this many times the brush size',
  countJitter: 'Lays a random number of dabs at each step instead of always Count: at 100% anywhere from 1 to Count',
  scatterBoth: 'Scatters dabs in every direction; off, only sideways across the stroke, so they stay evenly spaced along it (Both Axes in Photoshop)',
  sizeJitter: 'Makes each dab smaller by a random amount, up to this share of its size',
  flowJitter: 'Makes each dab lighter by a random amount, up to this share of its density',
  hueJitter: 'Turns the colour of each dab round the colour wheel by a random amount, up to this share of a half turn either way',
  satJitter: 'Saturation jitter: makes each dab more or less vivid by a random amount, up to this much either way',
  valJitter: 'Brightness jitter: makes each dab lighter or darker by a random amount, up to this much either way',
  colorJitterStroke: 'Picks one varied colour for the whole stroke instead of a new one for every dab',
  taperIn: 'Starts each stroke thin and grows to full size over this many pixels (0 = off)',
  taperOut: 'Ends each stroke thin over this many pixels (0 = off). The last stretch appears when you lift the pen',
  taperSize: 'How thin the tapered ends get: 100% narrows them to a point, 0% keeps the full size (with Start or End taper)',
  taperOpacity: 'How see-through the tapered ends get: 0% keeps them solid, 100% fades them out (with Start or End taper)',
  refStop: 'Paint only inside the shape you start in: the lines of the layers ticked Reference in the Layers panel (your line art) stop the brush, so colour never goes over them (anti-overflow)',
  quickShape: 'Keep the pen still for a moment at the end of a stroke: a line becomes straight, a loop a clean ellipse. Move the pen before lifting it to stretch the shape (QuickShape)',
  tiltSize: 'Makes the brush bigger the more you tilt the pen, up to three times its size when the pen lies flat (pens that report tilt)',
  tiltFlow: 'Makes the paint lighter the more you tilt the pen, as when shading with the side of a pencil',
  tiltAngle: 'Turns the tip the way the pen leans (best with a squashed or image tip)',
  speedSize: 'Above 0, fast strokes get thinner (like an ink pen); below 0 they get thicker',
  speedFlow: 'Above 0, fast strokes get lighter; below 0 they get stronger',
};

/** Every tool's settings, starting from its defaults and keeping only valid stored values. */
export function sanitizeSettings(stored) {
  const out = {};
  for (const t of TOOLS) {
    const s = { ...t.defaults };
    let from = stored && typeof stored === 'object' ? stored[t.id] : null;
    // before 'sample', Fill and the wand had a "look at all layers" tick
    if (from && typeof from === 'object' && !('sample' in from) && from.sampleAll === false) from = { ...from, sample: 'layer' };
    // a Pencil still on the defaults from before its grain followed pressure takes the lighter density that needs
    if (t.id === 'pencil' && from && typeof from === 'object' && from.flow === 0.7 && !(from.minFlow > 0) && from.hardness === 0.6) from = { ...from, flow: 0.45, minFlow: 0.1 };
    applySettings(s, from);
    out[t.id] = s;
  }
  return out;
}

/** Copies the valid values of `from` into the settings s (only settings s has); tips and textures may name a library image. */
export function applySettings(s, from) {
  if (!from || typeof from !== 'object') return s;
  for (const [key, , type, min, max] of SETTING_FIELDS) {
    if (!(key in s) || !(key in from)) continue;
    const v = from[key];
    if (type === 'check') s[key] = !!v;
    else if (type === 'choice') { if (min.some(o => o[0] === v) || ((key === 'tip' || key === 'texture' || key === 'dualTip' || key === 'comboTip') && imageRef(v)) || (key === 'colors' && isUserGradient(v))) s[key] = v; }
    else if (type === 'curve') s[key] = sanitizeCurve(v);
    else if (type === 'id') s[key] = typeof v === 'string' && /^(?:[0-9a-f]{0,32}|b-[a-z0-9-]{1,30})$/.test(v) ? v : '';  // saved, or built-in (builtinbrushes.js)
    else if (Number.isFinite(+v) && v !== null && v !== '') s[key] = Math.max(min, Math.min(max, +v));
  }
  return s;
}

/** The settings a saved brush keeps: everything a paint tool has, except which saved brush it came from. */
export const BRUSH_KEYS = Object.keys(TOOL_BY_ID.brush.defaults).filter(k => k !== 'preset');

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
