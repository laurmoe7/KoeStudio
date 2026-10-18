// The layer tree (pure, tested). Nodes are layers ({kind: 'layer'}) and folders ({kind: 'folder', children, open});
// every node has .parent. Children are stored bottom first, as they stack; the panel shows them top first.

export const isFolder = n => n?.kind === 'folder';

/** Every node under root (not root itself), depth first, bottom first. */
export function allNodes(root) {
  const out = [];
  const walk = f => { for (const n of f.children) { out.push(n); if (isFolder(n)) walk(n); } };
  walk(root);
  return out;
}

export const allLayers = root => allNodes(root).filter(n => !isFolder(n));

/**
 * The layers that can show, top first (for picking a layer by clicking the canvas): visible, inside visible folders,
 * and not correction layers (they have no pixels of their own). `tops` (a Set of top-level nodes) limits it to
 * those, as when only one animation frame shows.
 */
export function shownLayersTopFirst(root, tops = null) {
  const out = [];
  const walk = f => {
    for (let i = f.children.length - 1; i >= 0; i--) {
      const n = f.children[i];
      if (!n.visible || (f === root && tops && !tops.has(n))) continue;
      if (isFolder(n)) walk(n);
      else if (!n.adjust) out.push(n);
    }
  };
  walk(root);
  return out;
}

/** The layer a clipped layer is clipped to: the nearest unclipped sibling below it (null when there is none). */
export function clipBase(node) {
  if (!node.clip || !node.parent) return null;
  const sib = node.parent.children;
  for (let i = sib.indexOf(node) - 1; i >= 0; i--) if (!sib[i].clip) return sib[i];
  return null;
}

/** Rows for the layer panel, top first: [{node, depth}], skipping the contents of closed folders. */
export function panelRows(root) {
  const rows = [];
  const walk = (f, depth) => {
    for (let i = f.children.length - 1; i >= 0; i--) {
      const n = f.children[i];
      rows.push({ node: n, depth });
      if (isFolder(n) && n.open) walk(n, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/**
 * Alt+click on an eye ("show only this"): which nodes to hide so only `node` shows. Its folders and itself must be
 * shown; what is inside it keeps its own eyes. Returns {show, hide} (arrays); `hide` empty means it already shows alone.
 */
export function soloChange(root, node) {
  const show = [];
  for (let n = node; n && n !== root; n = n.parent) if (!n.visible) show.push(n);
  const hide = allNodes(root).filter(n => n.visible && !contains(n, node) && !contains(node, n));
  return { show, hide };
}

/** True when node is a or inside a. */
export function contains(a, node) {
  for (let n = node; n; n = n.parent) if (n === a) return true;
  return false;
}

export function removeNode(node) {
  const parent = node.parent, index = parent.children.indexOf(node);
  parent.children.splice(index, 1);
  node.parent = null;
  return { parent, index };
}

export function insertNode(parent, index, node) {
  parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, node);
  node.parent = parent;
}

/** Indices from the root down to node, for saving which node is selected. */
export function pathOf(node) {
  const path = [];
  for (let n = node; n.parent; n = n.parent) path.unshift(n.parent.children.indexOf(n));
  return path;
}

export function nodeAt(root, path) {
  let n = root;
  for (const i of path || []) {
    if (!isFolder(n) || !n.children[i]) return null;
    n = n.children[i];
  }
  return n === root ? null : n;
}

/**
 * Where node would go relative to target: 'above' / 'below' it among its siblings, or 'top-of' / 'bottom-of'
 * inside it (a folder). Returns {parent, index} as it will be after node is taken out, or null when impossible
 * (a folder into itself or into one of its own folders).
 */
export function destination(node, target, where) {
  const inside = where === 'top-of' || where === 'bottom-of';
  const parent = inside ? target : target.parent;
  if (!parent || (inside && !isFolder(target)) || contains(node, parent) || target === node) return null;
  const siblings = parent.children.filter(n => n !== node);
  let index;
  if (where === 'top-of') index = siblings.length;
  else if (where === 'bottom-of') index = 0;
  else index = siblings.indexOf(target) + (where === 'above' ? 1 : 0);
  return { parent, index };
}

/** Moves node; returns where it came from (for undo) or null when the move is not possible. */
export function moveNode(node, target, where) {
  const dest = destination(node, target, where);
  if (!dest) return null;
  const from = removeNode(node);
  insertNode(dest.parent, dest.index, node);
  return from;
}

/**
 * One step up (dir 1) or down (dir -1) in the panel, as in other painting programs: past a closed folder or a
 * layer, into an open folder, or out of the folder it is in at its top or bottom. Returns {target, where} or null.
 */
export function stepTarget(node, dir) {
  const p = node.parent, i = p.children.indexOf(node);
  const s = p.children[i + dir];
  if (s) {
    if (isFolder(s) && s.open) return { target: s, where: dir > 0 ? 'bottom-of' : 'top-of' };
    return { target: s, where: dir > 0 ? 'above' : 'below' };
  }
  if (p.parent) return { target: p, where: dir > 0 ? 'above' : 'below' };
  return null;
}

// ---------- several selected nodes ----------

/** The picked nodes that are not inside another picked folder, bottom first (stacking order). */
export function outermost(root, picked) {
  return allNodes(root).filter(n => picked.has(n) && ![...ancestors(n)].some(a => picked.has(a)));
}

function* ancestors(n) { for (let a = n.parent; a; a = a.parent) yield a; }

/** The nodes on the panel rows from a to b (either order), as Shift+click picks them; [b] when a is not shown. */
export function rowRange(root, a, b) {
  const rows = panelRows(root).map(r => r.node), i = rows.indexOf(a), j = rows.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Takes nodes out of the tree; returns what restoreNodes needs to put them back exactly. */
export function removeNodes(nodes) {
  return nodes.map(n => ({ node: n, ...removeNode(n) }));
}

export function restoreNodes(records) {
  for (let k = records.length - 1; k >= 0; k--) insertNode(records[k].parent, records[k].index, records[k].node);
}

/**
 * Moves several nodes (outermost, bottom first) together above/below target or to the top/bottom of a folder,
 * keeping their order. Returns the records to undo it (restoreNodes after taking them out again), or null when
 * target is one of them or inside one.
 */
export function moveNodes(nodes, target, where) {
  const inside = where === 'top-of' || where === 'bottom-of';
  if (inside && !isFolder(target)) return null;
  if (!inside && !target.parent) return null;
  if (nodes.some(n => contains(n, target))) return null;
  const records = removeNodes(nodes);
  const parent = inside ? target : target.parent;
  let index = where === 'top-of' ? parent.children.length : where === 'bottom-of' ? 0
    : parent.children.indexOf(target) + (where === 'above' ? 1 : 0);
  for (const n of nodes) insertNode(parent, index++, n);
  return records;
}
