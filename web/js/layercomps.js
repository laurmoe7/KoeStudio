// Layer comps (as in Photoshop): named snapshots of how the layers are shown. A comp always keeps each node's
// visibility and, when asked (`use`), its opacity, blending mode and position (a layer's `offset`: how far the Move
// tool has moved it, see recordMove in layerops.js). Nodes are known by their `uid`, which is saved with the file, so a
// comp survives reordering and renaming; nodes it does not know (added later) keep their state when it is applied.
// Pure, tested (tests/layercomps.test.mjs); the window and the undo step are in views/comptools.js.

export const COMP_MAX = 50;
/** What a comp can keep besides visibility: [key, label]. */
export const COMP_PARTS = [['opacity', 'Opacity'], ['blend', 'Blending mode'], ['position', 'Position']];

const UID = /^[A-Za-z0-9_-]{1,32}$/;
const LIMIT = 1e6;

/** A comp name: trimmed, without control characters, at most 100 characters. */
export function cleanCompName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) || 'Comp';
}

/** "Comp 1", "Comp 2"...: the first one no comp has. */
export function nextCompName(names) {
  const used = new Set(names);
  let n = 1;
  while (used.has(`Comp ${n}`)) n++;
  return `Comp ${n}`;
}

/** `wanted` (cleaned), or with ' 2', ' 3'... after it when another comp has that name already. */
export function uniqueCompName(names, wanted) {
  const used = new Set(names), base = cleanCompName(wanted);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

const offsetOf = n => ({ x: n.offset?.x || 0, y: n.offset?.y || 0 });
const isLayer = n => n.kind !== 'folder' && n.type !== 'folder';

/**
 * A new comp named `name` from the nodes (every layer and folder of the document, with uid, visible, opacity,
 * blend, kind and a layer's offset). use: {opacity, blend, position} (missing = false).
 */
export function captureComp(name, nodes, use = {}) {
  const u = { opacity: !!use.opacity, blend: !!use.blend, position: !!use.position };
  const layers = {};
  for (const n of nodes) {
    if (!n.uid) continue;
    const e = { visible: !!n.visible };
    if (u.opacity) e.opacity = n.opacity;
    if (u.blend) e.blend = n.blend;
    if (u.position && isLayer(n)) { const o = offsetOf(n); e.x = o.x; e.y = o.y; }
    layers[n.uid] = e;
  }
  return { name: cleanCompName(name), use: u, layers };
}

/** The comp kept again from the nodes as they are now, with its name and choices. */
export function updateComp(comp, nodes) {
  return captureComp(comp.name, nodes, comp.use);
}

/**
 * What applying the comp changes: {props: [{node, key, value}], moves: [{node, dx, dy}]}, only what differs from
 * now. Nodes the comp does not know are left alone; so are parts the comp does not keep.
 */
export function compChanges(comp, nodes) {
  const props = [], moves = [];
  for (const n of nodes) {
    const e = n.uid && comp.layers[n.uid];
    if (!e) continue;
    if (e.visible !== undefined && e.visible !== n.visible) props.push({ node: n, key: 'visible', value: e.visible });
    if (comp.use.opacity && e.opacity !== undefined && e.opacity !== n.opacity) props.push({ node: n, key: 'opacity', value: e.opacity });
    if (comp.use.blend && e.blend !== undefined && e.blend !== n.blend) props.push({ node: n, key: 'blend', value: e.blend });
    if (comp.use.position && isLayer(n) && e.x !== undefined) {
      const o = offsetOf(n), dx = e.x - o.x, dy = e.y - o.y;
      if (dx || dy) moves.push({ node: n, dx, dy });
    }
  }
  return { props, moves };
}

/** True when applying the comp would change nothing: the layers look as the comp says. */
export function compMatches(comp, nodes) {
  const { props, moves } = compChanges(comp, nodes);
  return !props.length && !moves.length;
}

/**
 * Cleans the saved comps. blendOk(id): whether a blending mode id is known (others are dropped from the entry);
 * known: a Set of the document's uids (entries for other uids are dropped), or null to keep them all.
 */
export function sanitizeComps(raw, blendOk = () => true, known = null) {
  if (!Array.isArray(raw)) return [];
  const out = [], names = [];
  for (const c of raw.slice(0, COMP_MAX)) {
    if (!c || typeof c !== 'object') continue;
    const u = c.use && typeof c.use === 'object' ? c.use : {};
    const use = { opacity: u.opacity === true, blend: u.blend === true, position: u.position === true };
    const layers = {};
    const src = c.layers && typeof c.layers === 'object' && !Array.isArray(c.layers) ? c.layers : {};
    for (const [uid, v] of Object.entries(src)) {
      if (!UID.test(uid) || (known && !known.has(uid)) || !v || typeof v !== 'object') continue;
      const e = { visible: v.visible !== false };
      if (use.opacity && Number.isFinite(+v.opacity) && v.opacity !== null) e.opacity = Math.max(0, Math.min(1, +v.opacity));
      if (use.blend && typeof v.blend === 'string' && blendOk(v.blend)) e.blend = v.blend;
      if (use.position && Number.isFinite(+v.x) && Number.isFinite(+v.y) && v.x !== null && v.y !== null) {
        e.x = Math.max(-LIMIT, Math.min(LIMIT, Math.round(+v.x)));
        e.y = Math.max(-LIMIT, Math.min(LIMIT, Math.round(+v.y)));
      }
      layers[uid] = e;
    }
    const name = uniqueCompName(names, typeof c.name === 'string' && c.name.trim() ? c.name : nextCompName(names));
    names.push(name);
    out.push({ name, use, layers });
  }
  return out;
}

/** A layer's saved offset: {x, y} whole pixels, or null when it has not been moved. */
export function sanitizeOffset(o) {
  if (!o || typeof o !== 'object') return null;
  const v = k => (Number.isFinite(+o[k]) && o[k] !== null ? Math.max(-LIMIT, Math.min(LIMIT, Math.round(+o[k]))) : 0);
  const x = v('x'), y = v('y');
  return x || y ? { x, y } : null;
}

/** A node uid as saved, or null when it is not one (a new one is given when the file is opened). */
export function sanitizeUid(uid) {
  return typeof uid === 'string' && UID.test(uid) ? uid : null;
}

/** A new random uid (8 base-36 characters). */
export function newUid() {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}
