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
