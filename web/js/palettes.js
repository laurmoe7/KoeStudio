// Palette files (pure, tested): reading GIMP / Krita / Inkscape .gpl, Photoshop .aco swatches, Adobe .ase swatch
// exchange and plain lists of hex colours (.hex, .txt: Lospec and Paint.NET), and writing .gpl.
// parsePalette(bytes, filename) -> {name, colors: ['#rrggbb', ...]} (no repeats), or throws with a message.

const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const stem = name => String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').trim() || 'Palette';

export function parsePalette(bytes, filename = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = String.fromCharCode(...b.subarray(0, 12));
  let res;
  if (head.startsWith('ASEF')) res = readAse(b);
  else if (head.startsWith('GIMP Palette')) res = readGpl(new TextDecoder().decode(b));
  else if (/\.aco$/i.test(filename) || (b.length >= 4 && b[0] === 0 && (b[1] === 1 || b[1] === 2))) res = readAco(b);
  else res = readHexList(new TextDecoder().decode(b));
  const colors = [...new Set(res.colors)];
  if (!colors.length) throw new Error('There are no colours in that file KoeStudio can read.');
  return { name: res.name || stem(filename), colors };
}

/** GIMP palette: "GIMP Palette", "Name: …", then lines "R G B  name" (0-255); # starts a comment. */
function readGpl(text) {
  let name = '';
  const colors = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^\s*Name:\s*(.*)$/i.exec(line);
    if (m) { name = m[1].trim(); continue; }
    const c = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(line);
    if (c) colors.push(toHex(+c[1], +c[2], +c[3]));
  }
  return { name, colors };
}

/** Plain colour lists: every #rrggbb or bare rrggbb word; an 8-digit one is Paint.NET's AARRGGBB. Lines starting
 * with ; are Paint.NET comments (whose words, like "decade", can look like colours). */
function readHexList(text) {
  const colors = [];
  text = text.split(/\r?\n/).filter(line => !/^\s*;/.test(line)).join('\n');
  for (const m of text.matchAll(/(?:^|[\s,;#])([0-9a-f]{8}|[0-9a-f]{6})(?![0-9a-f])/gi)) {
    const h = m[1].length === 8 ? m[1].slice(2) : m[1];
    colors.push('#' + h.toLowerCase());
  }
  return { name: '', colors };
}

/**
 * Photoshop .aco: big-endian; u16 version, u16 count, then per colour u16 space and 4 x u16 values (version 2 adds
 * a name after each: u32 length in UTF-16 units, then the units). A version 1 list may be followed by a version 2
 * copy, which is not needed. Spaces read: 0 RGB, 1 HSB, 8 grayscale (0-10000 of black ink).
 */
function readAco(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), colors = [];
  if (b.length < 4) throw new Error('That swatch file is damaged.');
  const v2 = dv.getUint16(0) === 2, count = dv.getUint16(2);
  for (let i = 0, o = 4; i < count; i++) {
    if (o + 10 > b.length) break;
    const space = dv.getUint16(o), w = dv.getUint16(o + 2), x = dv.getUint16(o + 4), y = dv.getUint16(o + 6);
    o += 10;
    if (v2) { if (o + 4 > b.length) break; o += 4 + dv.getUint32(o) * 2; }
    if (space === 0) colors.push(toHex(w / 257, x / 257, y / 257));
    else if (space === 1) colors.push(toHex(...hsbToRgb((w / 65536) * 360, x / 65535, y / 65535)));
    else if (space === 8) { const v = 255 - (w / 10000) * 255; colors.push(toHex(v, v, v)); }  // 10000 = black
  }
  return { name: '', colors };
}

function hsbToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Adobe Swatch Exchange: "ASEF", u16 major, u16 minor, u32 blocks; each block u16 type (1 colour, 0xC001 group
 * start, 0xC002 group end), u32 length; a colour has a UTF-16 name (u16 length with the ending 0), a model
 * ("RGB ", "CMYK", "Gray", "LAB "), 32-bit floats and a u16 kind. Lab colours are left out.
 */
function readAse(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), colors = [];
  let name = '', p = 12;
  const blocks = dv.getUint32(8);
  for (let k = 0; k < blocks && p + 6 <= b.length; k++) {
    const type = dv.getUint16(p), len = dv.getUint32(p + 2), body = p + 6;
    p = body + len;
    if (p > b.length) break;
    if (len < 2) continue;  // a group's end has no name
    const nlen = dv.getUint16(body);
    let title = '';
    for (let i = 0; i < nlen - 1; i++) title += String.fromCharCode(dv.getUint16(body + 2 + i * 2));
    if (type === 0xc001 && !name) name = title;
    if (type !== 1) continue;
    const q = body + 2 + nlen * 2, model = String.fromCharCode(...b.subarray(q, q + 4)), f = i => dv.getFloat32(q + 4 + i * 4);
    if (model === 'RGB ') colors.push(toHex(f(0) * 255, f(1) * 255, f(2) * 255));
    else if (model === 'Gray') colors.push(toHex(f(0) * 255, f(0) * 255, f(0) * 255));
    else if (model === 'CMYK') {
      const [c, m, y, kk] = [f(0), f(1), f(2), f(3)];
      colors.push(toHex(255 * (1 - c) * (1 - kk), 255 * (1 - m) * (1 - kk), 255 * (1 - y) * (1 - kk)));
    }
  }
  return { name, colors };
}

/** A palette as a GIMP .gpl file (also read by Krita, Inkscape, Aseprite and Lospec). */
export function gplText(name, colors) {
  const rows = colors.map(c => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`;
  });
  return `GIMP Palette\nName: ${String(name).replace(/[\r\n]/g, ' ')}\nColumns: 8\n#\n${rows.join('\n')}\n`;
}
