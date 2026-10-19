// Organizing saved brushes (pure, tested): the Manage brushes window's groups, moves, renames and deletes. A saved
// brush's group is its `source` ('' = Your brushes; an imported brush starts in a group named after its pack). The
// order of brushes.json's presets is the order everywhere: groups come in the order their first brush appears, and
// every change keeps a group's brushes together (regroup).
import { imageRef } from './brushtip.js';

/** The name shown for a group ('' is your own brushes). */
export const groupLabel = g => g || 'Your brushes';

/** The key a group is hidden under (koe.hiddenBrushGroups): built-in groups and saved groups never clash. */
export const hideKey = (g, builtin = false) => (builtin ? 'b:' : 's:') + g;

/** The presets in groups: [{name, presets}], in the order each group's first brush appears. */
export function presetGroups(presets) {
  const groups = new Map();
  for (const p of presets) {
    const g = p.source || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  return [...groups].map(([name, list]) => ({ name, presets: list }));
}

/** The presets with each group's brushes together, groups in the order they first appear. */
export function regroup(presets) {
  return presetGroups(presets).flatMap(g => g.presets);
}

/** The presets without those whose id is in ids. */
export function withoutPresets(presets, ids) {
  const out = new Set(ids);
  return presets.filter(p => !out.has(p.id));
}

/**
 * Moves the brushes ids (in their current order) into group g: before the brush beforeId when given (it must be in
 * g), else at the end of g; a group that does not exist yet is added at the end.
 */
export function moveToGroup(presets, ids, g, beforeId = null) {
  const set = new Set(ids), moving = presets.filter(p => set.has(p.id)).map(p => withSource(p, g));
  if (!moving.length) return presets;
  const rest = presets.filter(p => !set.has(p.id));
  let at = beforeId ? rest.findIndex(p => p.id === beforeId && (p.source || '') === g) : -1;
  if (at < 0) {
    const last = rest.map(p => p.source || '').lastIndexOf(g);
    at = last < 0 ? rest.length : last + 1;
  }
  // the groups keep their order (a new one comes last), even when a group's first brush moves away
  const order = [...presetGroups(presets).map(x => x.name), g];
  const groups = presetGroups([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
  groups.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));
  return groups.flatMap(x => x.presets);
}

/** Renames group `from` to `to`, keeping its place; renamed into a group that exists, the two become one. */
export function renameGroup(presets, from, to) {
  if (from === to) return presets;
  return regroup(presets.map(p => ((p.source || '') === from ? withSource(p, to) : p)));
}

/** Moves a whole group before group `before` (null: to the end). */
export function moveGroup(presets, g, before = null) {
  const groups = presetGroups(presets), i = groups.findIndex(x => x.name === g);
  if (i < 0 || g === before) return presets;
  const [moved] = groups.splice(i, 1), j = before === null ? -1 : groups.findIndex(x => x.name === before);
  groups.splice(j < 0 ? groups.length : j, 0, moved);
  return groups.flatMap(x => x.presets);
}

/**
 * The tip and texture images the removed brushes used that nothing else uses any more: not a kept brush, and not
 * the current settings of any tool (settings, a list of tool settings). These can be deleted with the brushes.
 */
export function orphanImages(removed, kept, settings = []) {
  const refs = s => [s?.tip, s?.texture, s?.dualTip, s?.comboTip].map(imageRef).filter(Boolean);
  const used = new Set([...kept.flatMap(p => refs(p.settings)), ...settings.flatMap(refs)]);
  return [...new Set(removed.flatMap(p => refs(p.settings)))].filter(id => !used.has(id));
}

function withSource(p, g) {
  const q = { ...p };
  if (g) q.source = g; else delete q.source;
  return q;
}
