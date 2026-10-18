// Syntax-checks every UI module (and the tests) without running them.  Usage: npm run check
import { readdirSync, statSync, readFileSync } from 'node:fs';
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
// A call of a function some module exports, in a module that neither imports nor declares it (a forgotten import
// only fails when that line runs). Crude, by text: calls written as name( with no space.
const exported = new Set();
const ui = files.filter(f => f.startsWith(join(root, 'web', 'js')));
for (const f of ui) for (const m of readFileSync(f, 'utf8').matchAll(/^export (?:async )?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]);
let missing = 0;
for (const f of ui) {
  const src = readFileSync(f, 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const known = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const part of m[1].split(',')) known.add(part.trim().split(/\s+as\s+/).pop());
  for (const name of exported) {
    if (known.has(name) || !new RegExp(`(?<![.\\w$])${name}\\(`).test(code)) continue;
    const declared = new RegExp(`(?:function\\*?|class|const|let|var)\\s+${name}\\b|[{,(]\\s*${name}\\s*[,})=]|\\b${name}\\s*=>|^\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
    if (!declared.test(code)) { missing++; console.error(`✖ ${relative(root, f)}: calls ${name}() without importing it`); }
  }
}
console.log(bad || missing ? `${bad} of ${files.length} files have syntax errors, ${missing} missing imports.` : `✔ ${files.length} files OK`);
process.exit(bad || missing ? 1 : 0);
