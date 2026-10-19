// Brushes that come with KoeStudio (pure, tested): ready-made settings for the paint tools, listed in the Brush
// choice above the user's own saved brushes. They use only the built-in tip and textures, so they need no files.
// A tool remembers a built-in brush in its `preset` setting as 'b-<name>'; built-in brushes cannot be changed or
// deleted (Save as new brush… keeps a changed copy).

import { TOOL_BY_ID, BRUSH_KEYS, applySettings } from './tools.js';
import { presetGroups, groupLabel, hideKey } from './brushorg.js';

/** Every paint setting a brush keeps, at the Brush tool's defaults without its taper; a built-in brush changes some. */
const BASE = { ...Object.fromEntries(BRUSH_KEYS.map(k => [k, TOOL_BY_ID.brush.defaults[k]])), taperIn: 0, taperOut: 0 };

const B = (id, group, name, settings) => ({ id: `b-${id}`, group, name, builtin: true, settings: { ...BASE, ...settings } });

export const BUILTIN_BRUSHES = [
  // ink: hard edges, size from pressure, tapered ends
  B('gpen', 'Ink', 'G-pen', { size: 8, flow: 1, hardness: 1, spacing: 0.05, minSize: 0.05, gamma: 1.2, smoothing: 5, taperIn: 12, taperOut: 24, speedSize: -0.15 }),
  B('fineliner', 'Ink', 'Fineliner', { size: 4, flow: 1, hardness: 1, spacing: 0.05, pressureSize: false, pressureOpacity: false, smoothing: 4, taperOut: 4 }),
  B('brushpen', 'Ink', 'Brush pen', { size: 22, flow: 1, hardness: 0.95, spacing: 0.04, minSize: 0.02, gamma: 1.6, smoothing: 4, thickness: 0.7, tipAngle: 35, taperIn: 30, taperOut: 70, pressureOpacity: false }),
  // dry media: the grain fills with pressure (grainPressure)
  B('hb', 'Pencil and chalk', 'HB pencil', { size: 4, flow: 0.35, minFlow: 0.1, hardness: 0.7, spacing: 0.1, minSize: 0.5, smoothing: 1, texture: 'paper', textureAmount: 0.55, grainPressure: true }),
  B('6b', 'Pencil and chalk', 'Soft pencil 6B', { size: 10, flow: 0.5, minFlow: 0.1, hardness: 0.5, spacing: 0.1, minSize: 0.4, smoothing: 1, texture: 'paper', textureAmount: 0.6, grainPressure: true, tiltSize: 0.6, tiltFlow: 0.3 }),
  B('charcoal', 'Pencil and chalk', 'Charcoal', { size: 24, flow: 0.6, minFlow: 0.1, hardness: 0.45, spacing: 0.08, minSize: 0.55, smoothing: 2, thickness: 0.6, tipAngle: 40, tipRandom: 0.04, texture: 'paper', textureAmount: 0.7, textureScale: 1.6, grainPressure: true }),
  B('chalk', 'Pencil and chalk', 'Chalk', { size: 30, flow: 0.45, minFlow: 0.1, hardness: 0.7, spacing: 0.08, minSize: 0.7, smoothing: 2, texture: 'coldpress', textureAmount: 0.75, textureScale: 0.75, grainPressure: true }),
  // paint: gouache runs dry at a light touch, watercolour and marker ink gather at the edges (wetEdges), the dry
  // brush's hairs leave streaks broken by the grain; oil paint (a flat brush whose ridges catch the light: impasto) and
// the wet blender mix with the colours already there (mix); the blender carries little paint of its own (paintLoad)
  B('gouache', 'Paint', 'Gouache', { size: 30, flow: 0.9, minFlow: 0.3, hardness: 0.9, spacing: 0.05, minSize: 0.4, texture: 'paper', textureAmount: 0.5, textureScale: 1.5, grainPressure: true }),
  B('watercolor', 'Paint', 'Watercolour', { size: 50, opacity: 0.55, flow: 0.6, hardness: 0.8, spacing: 0.05, minSize: 0.7, texture: 'coldpress', textureAmount: 0.4, textureScale: 1.5, wetEdges: 0.6 }),
  B('drybrush', 'Paint', 'Dry brush', { size: 40, flow: 1, hardness: 0.8, spacing: 0.02, minSize: 0.6, tip: 'bristle', tipFollow: true, tipAngle: 90, texture: 'paper', textureAmount: 0.55, textureScale: 2 }),
  B('marker', 'Paint', 'Marker', { size: 24, opacity: 0.8, wetEdges: 0.2, flow: 1, hardness: 0.95, spacing: 0.04, pressureSize: false, pressureOpacity: false, thickness: 0.35, tipAngle: 45 }),
  B('oil', 'Paint', 'Oil paint', { size: 40, flow: 0.95, minFlow: 0.3, hardness: 1, spacing: 0.03, minSize: 0.65, tip: 'flat', tipFollow: true, tipAngle: 90, impasto: 0.5, mix: 0.35, mixStretch: 0.8 }),
  B('blender', 'Paint', 'Wet blender', { size: 50, flow: 0.6, hardness: 0.5, spacing: 0.04, pressureSize: false, mix: 0.95, mixStretch: 0.8, paintLoad: 0.1 }),
  B('soft', 'Paint', 'Soft blend', { size: 90, flow: 0.07, hardness: 0, spacing: 0.06, pressureSize: false, minSize: 0.5 }),
  B('spatter', 'Paint', 'Spatter', { size: 10, flow: 1, hardness: 0.9, spacing: 0.5, pressureSize: false, scatter: 2, count: 6, sizeJitter: 0.8, flowJitter: 0.5 }),
  // the Eraser's own
  B('hard-eraser', 'Eraser', 'Hard eraser', { size: 20, flow: 1, hardness: 1, spacing: 0.06, pressureSize: false, pressureOpacity: false }),
  B('soft-eraser', 'Eraser', 'Soft eraser', { size: 80, flow: 0.2, hardness: 0, spacing: 0.06, pressureSize: false }),
  B('kneaded', 'Eraser', 'Kneaded eraser', { size: 30, flow: 0.35, hardness: 0.5, spacing: 0.1, minSize: 0.5, texture: 'paper', textureAmount: 0.6, grainPressure: true }),
];

export const BUILTIN_BY_ID = Object.fromEntries(BUILTIN_BRUSHES.map(b => [b.id, b]));

/** The built-in brushes offered for a paint tool: the Eraser gets the erasers, the other tools everything else. */
export function builtinBrushesFor(toolId) {
  const eraser = !!TOOL_BY_ID[toolId]?.erase;
  return BUILTIN_BRUSHES.filter(b => (b.group === 'Eraser') === eraser);
}

/**
 * The Brushes window's list for a paint tool: its built-in brushes in their groups, then the user's saved brushes
 * under 'Your brushes', each group only with the brushes whose name (or group name) holds `query` (any case).
 * [{name, brushes}], empty groups left out.
 */
export function brushListGroups(toolId, presets = [], query = '', hidden = []) {
  const q = String(query).trim().toLowerCase(), hide = new Set(hidden);
  const builtin = builtinBrushesFor(toolId);
  const groups = [...new Set(builtin.map(b => b.group))].filter(name => !hide.has(hideKey(name, true)))
    .map(name => ({ name, brushes: builtin.filter(b => b.group === name) }));
  // the saved brushes' groups (your own, and each imported pack), in the order set in Manage brushes
  for (const g of presetGroups(presets)) if (!hide.has(hideKey(g.name))) groups.push({ name: groupLabel(g.name), brushes: g.presets });
  return groups.map(g => ({ name: g.name, brushes: q && !g.name.toLowerCase().includes(q) ? g.brushes.filter(b => b.name.toLowerCase().includes(q)) : g.brushes }))
    .filter(g => g.brushes.length);
}

/**
 * Whether a tool's settings s have been changed since brush p was loaded: loading p again would change one of the
 * settings it keeps (as Krita's "Basic-1*"). Pressure curves compare by their points.
 */
export function brushChanged(s, p) {
  if (!p) return false;
  const again = applySettings({ ...s }, p.settings);
  return BRUSH_KEYS.some(k => k in s && JSON.stringify(again[k]) !== JSON.stringify(s[k]));
}
