// Free-transform maths (pure, tested). A transform places a w x h source image with its centre at (cx, cy),
// scaled by (sx, sy) (negative = mirrored) and rotated by rot radians:
//   doc = (cx, cy) + R(rot) * (sx * (u - w/2), sy * (v - h/2))   for source pixel (u, v).

export const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export function newTransform(r) {
  return { w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0 };
}

/** Matrix [a, b, c, d, e, f] taking source pixels to doc pixels (for ctx.setTransform). */
export function xfMatrix(t) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const a = cos * t.sx, b = sin * t.sx, c = -sin * t.sy, d = cos * t.sy;
  return [a, b, c, d, t.cx - a * t.w / 2 - c * t.h / 2, t.cy - b * t.w / 2 - d * t.h / 2];
}

/** Doc position of a point given in box units: (hx, hy) in [-1, 1] from the centre. */
export function boxPoint(t, hx, hy) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const lx = hx * t.sx * t.w / 2, ly = hy * t.sy * t.h / 2;
  return { x: t.cx + cos * lx - sin * ly, y: t.cy + sin * lx + cos * ly };
}

export function corners(t) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => boxPoint(t, x, y));
}

/** Point in box units (inverse of boxPoint). */
export function toBox(t, p) {
  const cos = Math.cos(t.rot), sin = Math.sin(t.rot);
  const dx = p.x - t.cx, dy = p.y - t.cy;
  const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
  return { x: lx / (t.sx * t.w / 2), y: ly / (t.sy * t.h / 2) };
}

/**
 * What a pointer at doc point p would grab: a handle name, 'move' (inside the box) or 'rotate' (outside).
 * tol is the grab distance in doc pixels (screen tolerance / zoom).
 */
export function hitTest(t, p, tol) {
  for (const [name, [hx, hy]] of Object.entries(HANDLES)) {
    const q = boxPoint(t, hx, hy);
    if (Math.hypot(p.x - q.x, p.y - q.y) <= tol) return name;
  }
  const b = toBox(t, p);
  return Math.abs(b.x) <= 1 && Math.abs(b.y) <= 1 ? 'move' : 'rotate';
}

/** Dragging handle `name` of start transform t0 to doc point p; the opposite handle stays put. */
export function dragHandle(t0, name, p, keepAspect = false) {
  const [hx, hy] = HANDLES[name];
  const anchor = boxPoint(t0, -hx, -hy);
  const cos = Math.cos(t0.rot), sin = Math.sin(t0.rot);
  const dx = p.x - anchor.x, dy = p.y - anchor.y;
  const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;  // pointer in the box's own axes, from the anchor
  let sx = hx ? lx / (hx * t0.w) : t0.sx;
  let sy = hy ? ly / (hy * t0.h) : t0.sy;
  if (keepAspect) {
    if (hx && hy) {
      const kx = sx / t0.sx, ky = sy / t0.sy;
      const k = Math.abs(kx) > Math.abs(ky) ? kx : ky;
      sx = t0.sx * k; sy = t0.sy * k;
    } else if (hx) {
      sy = t0.sy * Math.abs(sx / t0.sx);
    } else {
      sx = t0.sx * Math.abs(sy / t0.sy);
    }
  }
  sx = clampScale(sx, t0.w);
  sy = clampScale(sy, t0.h);
  const t = { ...t0, sx, sy };
  // put the anchor back where it was
  const a2 = boxPoint(t, -hx, -hy);
  return { ...t, cx: t.cx + anchor.x - a2.x, cy: t.cy + anchor.y - a2.y };
}

function clampScale(s, size) {
  const min = 1 / Math.max(1, size);  // never thinner than one pixel
  return Math.abs(s) < min ? (s < 0 ? -min : min) : s;
}

/** Rotating from start point p0 to p around the centre; snap rounds to 15 degree steps. */
export function dragRotate(t0, p0, p, snap = false) {
  const a0 = Math.atan2(p0.y - t0.cy, p0.x - t0.cx), a1 = Math.atan2(p.y - t0.cy, p.x - t0.cx);
  let rot = t0.rot + a1 - a0;
  if (snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
  return { ...t0, rot };
}

export function dragMove(t0, p0, p) {
  return { ...t0, cx: t0.cx + p.x - p0.x, cy: t0.cy + p.y - p0.y };
}

/** Integer doc rectangle covering the transformed box (plus a pixel for anti-aliasing). */
export function xfBounds(t) {
  const cs = corners(t);
  const x0 = Math.floor(Math.min(...cs.map(c => c.x))) - 1, y0 = Math.floor(Math.min(...cs.map(c => c.y))) - 1;
  const x1 = Math.ceil(Math.max(...cs.map(c => c.x))) + 1, y1 = Math.ceil(Math.max(...cs.map(c => c.y))) + 1;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function isIdentity(t, r) {
  return t.sx === 1 && t.sy === 1 && t.rot % (2 * Math.PI) === 0 && t.cx === r.x + r.w / 2 && t.cy === r.y + r.h / 2;
}

// ---------- distort (free corners) ----------
// In Distort mode the box is a quad: four doc points for the source's corners (0, 0), (w, 0), (w, h), (0, h), in
// that order (as corners() lists them). The source is mapped onto it with a projective transform (homography).

/**
 * The 3 x 3 projective matrix [a, b, c, d, e, f, g, h] (the last entry is 1) taking source pixel (u, v) of a w x h
 * image to x = (a u + b v + c) / (g u + h v + 1), y = (d u + e v + f) / (g u + h v + 1), so that the corners land
 * on quad (Heckbert's square-to-quad, scaled by w and h). null for a quad folded flat.
 */
export function homography(w, h, quad) {
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + k * p3.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + k * p3.y;
  return [a / w, b / h, p0.x, d / w, e / h, p0.y, g / w, k / h];
}

/** Where homography m takes (u, v). */
export function project(m, u, v) {
  const z = m[6] * u + m[7] * v + 1;
  return { x: (m[0] * u + m[1] * v + m[2]) / z, y: (m[3] * u + m[4] * v + m[5]) / z };
}

/** The inverse of homography m, in the same 8-number form; null when it has none. */
export function invertHomography(m) {
  const [a, b, c, d, e, f, g, h] = m;
  const A = e - f * h, B = c * h - b, C = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  if (Math.abs(I) < 1e-12) return null;
  return [A / I, B / I, C / I, D / I, E / I, F / I, G / I, H / I];
}

/** Doc-pixel bounds of a quad, whole pixels: {x, y, w, h}. */
export function quadBounds(quad) {
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
}

/** What a pointer at p grabs on a quad: the nearest corner within tol (0-3), 'move' inside it, else null. */
export function quadHit(quad, p, tol) {
  let best = null, bestDist = tol;
  quad.forEach((q, i) => { const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd <= bestDist) { best = i; bestDist = dd; } });
  if (best !== null) return best;
  let inside = false;  // even-odd ray test
  for (let i = 0, j = 3; i < 4; j = i++) {
    const a = quad[i], b = quad[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? 'move' : null;
}

/**
 * Draws the sw x sh RGBA image src onto quad: fills out (RGBA, ow x oh, whose (0, 0) is doc pixel (ox, oy)) by
 * mapping each pixel centre back into the source through the inverse homography. smooth: bilinear (premultiplied,
 * outside the source counts as clear, so the edges come out anti-aliased); otherwise the nearest pixel.
 */
export function warpImage(src, sw, sh, quad, out, ox, oy, ow, oh, smooth = true) {
  const m = homography(sw, sh, quad), inv = m && invertHomography(m);
  if (!inv) return out;
  const px = (x, y, c) => (x < 0 || y < 0 || x >= sw || y >= sh ? 0 : src[(y * sw + x) * 4 + c]);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const q = project(inv, ox + x + 0.5, oy + y + 0.5), o = (y * ow + x) * 4;
      if (!(q.x > -1 && q.y > -1 && q.x < sw + 1 && q.y < sh + 1)) continue;
      if (!smooth) {
        const u = Math.floor(q.x), v = Math.floor(q.y);
        if (u < 0 || v < 0 || u >= sw || v >= sh) continue;
        const i = (v * sw + u) * 4;
        out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
        continue;
      }
      const fx = q.x - 0.5, fy = q.y - 0.5, u = Math.floor(fx), v = Math.floor(fy), tx = fx - u, ty = fy - v;
      const wts = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty], pts = [[u, v], [u + 1, v], [u, v + 1], [u + 1, v + 1]];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const al = px(pts[k][0], pts[k][1], 3) * wts[k];
        if (!al) continue;
        r += px(pts[k][0], pts[k][1], 0) * al; g += px(pts[k][0], pts[k][1], 1) * al; b += px(pts[k][0], pts[k][1], 2) * al; a += al;
      }
      if (a <= 0) continue;
      out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a;
    }
  }
  return out;
}
