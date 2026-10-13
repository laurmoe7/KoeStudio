// Syntax-checks every UI module (and the tests) without running them.  Usage: npm run check
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.m?js$/.test(name)) files.push(p);
  }
};
walk(join(root, 'web', 'js'));
walk(join(root, 'tests'));

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf-8' });
  if (r.status !== 0) {
    bad++;
    console.error(`✖ ${relative(root, f)}\n${r.stderr.trim()}\n`);
  }
}
console.log(bad ? `${bad} of ${files.length} files have syntax errors.` : `✔ ${files.length} files OK`);
process.exit(bad ? 1 : 0);
