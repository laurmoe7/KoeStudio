// Makes web/icon.ico and web/icon.png (the window, taskbar, shortcut and .koe file icon) from tools/icon.svg,
// rendered by a headless Edge at each icon size (nothing shows on the desktop). The ICO holds PNG images.
// Usage:  node tools/ui_shot.mjs about:blank tools/make_icon.mjs <scratch folder>
// Afterwards rebuild the launcher (KoeStudio.exe carries the icon too), see CLAUDE.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

/** An ICO file holding PNG images: [[size, Buffer], ...]. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e); head.writeUInt8(size % 256, e + 1);  // 256 is written as 0
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(([, png]) => png)]);
}

export default async ({ evaluate }) => {
  const svg = readFileSync(join(ROOT, 'tools', 'icon.svg'), 'utf8');
  const urls = await evaluate(`
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    return ${JSON.stringify(SIZES)}.map(s => {
      // drawn 4x larger and halved twice, so small sizes stay smooth
      let c = document.createElement('canvas');
      c.width = c.height = s * 4;
      c.getContext('2d').drawImage(img, 0, 0, s * 4, s * 4);
      for (let k = 0; k < 2; k++) {
        const h = document.createElement('canvas');
        h.width = h.height = c.width / 2;
        const ctx = h.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(c, 0, 0, h.width, h.height);
        c = h;
      }
      return c.toDataURL('image/png');
    });`);
  const images = SIZES.map((s, i) => [s, Buffer.from(urls[i].split(',')[1], 'base64')]);
  writeFileSync(join(ROOT, 'web', 'icon.ico'), ico(images));
  writeFileSync(join(ROOT, 'web', 'icon.png'), images.find(([s]) => s === 256)[1]);
  console.log('Wrote web/icon.ico and web/icon.png');
};
