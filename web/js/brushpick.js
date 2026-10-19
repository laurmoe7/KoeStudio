// Picking brushes out of an imported pack (pure, tested): the import dialog's search, Shift+click ranges and the
// summary of what the pack's brushes lose on the way in.

/** Packs up to this many brushes start with every brush ticked; bigger ones start with none, to pick from. */
export const PICK_ALL_UP_TO = 12;

/** The indices of the names that contain every word of the query (any case, in any order). */
export function pickMatches(names, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  names.forEach((n, i) => { const s = String(n).toLowerCase(); if (words.every(w => s.includes(w))) out.push(i); });
  return out;
}

/** The brushes the import window shows: those whose name matches the query and, with completeOnly, that lose nothing. */
export function shownBrushes(brushes, query, completeOnly = false) {
  return pickMatches(brushes.map(b => b.name), query).filter(i => !completeOnly || !brushes[i].notes?.length);
}

/**
 * Shift+click: the indices from the last clicked brush `from` to `to`, both included, in the order they are shown
 * (`shown`, a list of indices). Just [to] when `from` is not shown (or none was clicked yet).
 */
export function rangePick(shown, from, to) {
  const a = shown.indexOf(from), b = shown.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return shown.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** What the brushes of a pack lose, most common first: [[note, how many brushes]]. */
export function noteSummary(brushes) {
  const counts = new Map();
  for (const b of brushes) for (const n of new Set(b.notes || [])) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}
