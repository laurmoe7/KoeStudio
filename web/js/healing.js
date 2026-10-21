// Healing brush dabs (pure, tested). Like Photoshop's Healing Brush, a dab takes the detail of a source patch and
// the colour and brightness of where it lands: the result is source + a smooth correction, where the correction is
// what the destination minus the source is on the dab's rim, spread over the inside as a membrane (the harmonic
// function with those rim values, the solution of the Poisson blend with the source's own gradients). On a disc that
// is the Poisson integral of the rim, so no solver is needed: every point inside is a fixed weighted average of rim
// samples, the weights depend only on the dab size and are kept, and the correction is worked out on a coarse grid
// (it is smooth) and spread bilinearly. Only the rim of the destination counts, so a blemish inside the dab goes.
// Works on d × d patches of RGBA bytes (straight alpha, as ImageData), premultiplied inside so clear pixels carry no
// colour.

/** The rim samples of a dab of diameter d: radius, angles and how many. */
export function rimOf(d) {
  const r = d / 2, R = Math.max(0.5, r - 1.5);
  const n = Math.max(12, Math.min(64, Math.round(2 * Math.PI * R / 4)));
  return { r, R, n };
}

/** The coarse grid the correction is worked out on: every `step` pixels, always taking in the last pixel. */
export function healGrid(d) {
  const step = Math.max(1, Math.round(d / 24)), xs = [];
  for (let x = 0; x < d - 1; x += step) xs.push(x);
  xs.push(d - 1);
  return { step, xs };
}

const weightCache = new Map();

/**
 * The Poisson kernel weights of a dab of diameter d: for each grid point (row-major over healGrid's xs × xs), n
 * weights for the rim samples, adding up to 1. Kept per size (the last 48 sizes).
 */
export function healWeights(d) {
  let w = weightCache.get(d);
  if (w) { weightCache.delete(d); weightCache.set(d, w); return w; }
  const { r, R, n } = rimOf(d), { xs } = healGrid(d), g = xs.length;
  w = new Float32Array(g * g * n);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      const px = xs[i] + 0.5 - r, py = xs[j] + 0.5 - r;
      let rho = Math.hypot(px, py);
      const th = Math.atan2(py, px);
      rho = Math.min(rho, R * 0.98);  // at or past the rim: as just inside it
      const o = (j * g + i) * n, num = R * R - rho * rho;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const v = num / (R * R + rho * rho - 2 * R * rho * Math.cos(th - 2 * Math.PI * k / n));
        w[o + k] = v; sum += v;
      }
      for (let k = 0; k < n; k++) w[o + k] /= sum;
    }
  }
  weightCache.set(d, w);
  if (weightCache.size > 48) weightCache.delete(weightCache.keys().next().value);
  return w;
}

/** Premultiplied RGBA value of pixel (x, y) of a d × d patch, averaged over its 3 × 3 block (edges clamped), into out. */
function block(p, d, x, y, out) {
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = Math.max(0, Math.min(d - 1, y + dy));
    for (let dx = -1; dx <= 1; dx++) {
      const i = (yy * d + Math.max(0, Math.min(d - 1, x + dx))) * 4, a = p[i + 3];
      out[0] += p[i] * a / 255; out[1] += p[i + 1] * a / 255; out[2] += p[i + 2] * a / 255; out[3] += a;
    }
  }
  for (let c = 0; c < 4; c++) out[c] /= 9;
  return out;
}

/** dst − src (premultiplied RGBA, 3 × 3 averaged) at each rim sample: n × 4 numbers. */
export function rimDiff(dst, src, d) {
  const { r, R, n } = rimOf(d), out = new Float32Array(n * 4), a = [0, 0, 0, 0], b = [0, 0, 0, 0];
  for (let k = 0; k < n; k++) {
    const t = 2 * Math.PI * k / n;
    const x = Math.floor(r + R * Math.cos(t)), y = Math.floor(r + R * Math.sin(t));
    block(dst, d, x, y, a); block(src, d, x, y, b);
    for (let c = 0; c < 4; c++) out[k * 4 + c] = a[c] - b[c];
  }
  return out;
}

/**
 * The healed patch: src's detail with dst's colour and brightness from the rim inwards (a new d × d patch, straight
 * alpha). Lay it on with mixDab (retouch.js) so the tip's soft edge and the strength apply.
 */
export function healPatch(dst, src, d) {
  const { n } = rimOf(d), { xs } = healGrid(d), g = xs.length, w = healWeights(d), diff = rimDiff(dst, src, d);
  // the correction at the grid points
  const corr = new Float32Array(g * g * 4);
  for (let p = 0; p < g * g; p++) {
    const o = p * n;
    let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    for (let k = 0; k < n; k++) {
      const wk = w[o + k], q = k * 4;
      c0 += wk * diff[q]; c1 += wk * diff[q + 1]; c2 += wk * diff[q + 2]; c3 += wk * diff[q + 3];
    }
    corr[p * 4] = c0; corr[p * 4 + 1] = c1; corr[p * 4 + 2] = c2; corr[p * 4 + 3] = c3;
  }
  // which grid cell each pixel falls in, and how far along it
  const cell = new Int32Array(d), frac = new Float32Array(d);
  for (let x = 0, i = 0; x < d; x++) {
    while (i < g - 2 && xs[i + 1] <= x) i++;
    cell[x] = i;
    frac[x] = g > 1 ? (x - xs[i]) / (xs[i + 1] - xs[i]) : 0;
  }
  const out = new Uint8ClampedArray(d * d * 4), v = [0, 0, 0, 0];
  for (let y = 0; y < d; y++) {
    const j = cell[y], fy = frac[y], j1 = Math.min(g - 1, j + 1);
    for (let x = 0; x < d; x++) {
      const i = cell[x], fx = frac[x], i1 = Math.min(g - 1, i + 1);
      const p00 = (j * g + i) * 4, p10 = (j * g + i1) * 4, p01 = (j1 * g + i) * 4, p11 = (j1 * g + i1) * 4;
      const q = (y * d + x) * 4, sa = src[q + 3];
      for (let c = 0; c < 4; c++) {
        const cc = (corr[p00 + c] * (1 - fx) + corr[p10 + c] * fx) * (1 - fy) + (corr[p01 + c] * (1 - fx) + corr[p11 + c] * fx) * fy;
        v[c] = (c < 3 ? src[q + c] * sa / 255 : sa) + cc;
      }
      const a = Math.max(0, Math.min(255, v[3]));
      out[q + 3] = a;
      if (a > 0) for (let c = 0; c < 3; c++) out[q + c] = Math.max(0, Math.min(a, v[c])) * 255 / a;
    }
  }
  return out;
}

/**
 * How badly src fits in at dst's rim: the spread (variance) of dst − src round the rim, summed over the channels. A
 * source that differs from the destination by the same amount all round fits perfectly (0), because healing evens
 * that out; what it cannot hide is a seam that changes along the rim.
 */
export function rimMismatch(dst, src, d) {
  const { n } = rimOf(d), diff = rimDiff(dst, src, d);
  let total = 0;
  for (let c = 0; c < 4; c++) {
    let s = 0, s2 = 0;
    for (let k = 0; k < n; k++) { const v = diff[k * 4 + c]; s += v; s2 += v * v; }
    total += s2 / n - (s / n) ** 2;
  }
  return Math.max(0, total);
}

/** Where Spot healing looks for texture round a dab of diameter d: eight patches about a dab and a quarter away. */
export function spotOffsets(d) {
  const dist = Math.round(d * 1.25), diag = Math.round(dist / Math.SQRT2);
  return [[dist, 0], [-dist, 0], [0, dist], [0, -dist], [diag, diag], [-diag, diag], [diag, -diag], [-diag, -diag]];
}
