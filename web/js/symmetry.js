// Symmetry ruler (pure, tested): every brush dab is repeated mirrored or turned around a centre, as with Procreate's
// drawing guide and Clip Studio Paint's symmetry ruler.
//
// doc.rulers.symmetry = { kind, lines, x, y }:
//   kind  'off' | 'vertical' (mirror left-right) | 'horizontal' (top-bottom) | 'quad' (both) |
//         'radial' (turned `lines` times round the centre) | 'kaleido' (turned and mirrored: 2 × lines copies)
//   x, y  the centre in doc pixels, or null for the middle of the canvas

export const SYMMETRY_KINDS = [
  ['off', 'Off'], ['vertical', 'Mirror left–right'], ['horizontal', 'Mirror top–bottom'], ['quad', 'Four ways'],
  ['radial', 'Radial'], ['kaleido', 'Kaleidoscope'],
];
const KIND_IDS = new Set(SYMMETRY_KINDS.map(k => k[0]));
export const MAX_LINES = 32;

export const defaultSymmetry = () => ({ kind: 'off', lines: 6, x: null, y: null });

export function sanitizeSymmetry(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const coord = v => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : Math.max(-100000, Math.min(100000, +v)));
  const lines = Math.round(+s.lines);
  return {
    kind: KIND_IDS.has(s.kind) ? s.kind : 'off',
    lines: Number.isFinite(lines) ? Math.max(2, Math.min(MAX_LINES, lines)) : 6,
    x: coord(s.x), y: coord(s.y),
  };
}

/** The centre of symmetry on a w x h canvas. */
export function symmetryCentre(sym, w, h) {
  return { x: sym.x ?? w / 2, y: sym.y ?? h / 2 };
}

/**
 * Every copy of the point (x, y) under the symmetry, the point itself first. Turning goes clockwise; the
 * kaleidoscope's mirror is the vertical line through the centre.
 */
export function symmetryPoints(sym, x, y, w, h) {
  const out = [{ x, y }];
  if (!sym || sym.kind === 'off') return out;
  const c = symmetryCentre(sym, w, h), dx = x - c.x, dy = y - c.y;
  if (sym.kind === 'vertical') out.push({ x: c.x - dx, y });
  else if (sym.kind === 'horizontal') out.push({ x, y: c.y - dy });
  else if (sym.kind === 'quad') out.push({ x: c.x - dx, y }, { x, y: c.y - dy }, { x: c.x - dx, y: c.y - dy });
  else {
    const n = sym.lines;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, cos = Math.cos(a), sin = Math.sin(a);
      if (k) out.push({ x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos });
      if (sym.kind === 'kaleido') out.push({ x: c.x - dx * cos - dy * sin, y: c.y - dx * sin + dy * cos });
    }
  }
  return out;
}

/** Stamps ({x, y, p}) with their symmetric copies added (each copy keeps its stamp's pressure). */
export function symmetryStamps(sym, stamps, w, h) {
  if (!sym || sym.kind === 'off') return stamps;
  const out = [];
  for (const s of stamps) for (const q of symmetryPoints(sym, s.x, s.y, w, h)) out.push({ ...s, x: q.x, y: q.y });
  return out;
}

/** Directions (radians, 0 = right, clockwise) of the guide lines drawn from the centre. */
export function symmetryRays(sym) {
  const up = -Math.PI / 2;
  switch (sym?.kind) {
    case 'vertical': return [up, Math.PI / 2];
    case 'horizontal': return [0, Math.PI];
    case 'quad': return [0, Math.PI / 2, Math.PI, up];
    case 'radial': return Array.from({ length: sym.lines }, (_, k) => up + (2 * Math.PI * k) / sym.lines);
    case 'kaleido': return Array.from({ length: 2 * sym.lines }, (_, k) => up + (Math.PI * k) / sym.lines);
    default: return [];
  }
}
