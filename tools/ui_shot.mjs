// Screenshots of the UI without showing anything on the desktop: drives a headless, muted Microsoft Edge over
// the DevTools protocol. For checking how screens look while testing (see CLAUDE.md, "Testing").
//
// Usage: node tools/ui_shot.mjs <url> <steps.mjs> <out-folder> [width] [height]
//   steps.mjs exports `default async ({ evaluate, shot, wait, navigate }) => { ... }`:
//     evaluate(jsString)  runs in the page (await allowed) and returns its JSON-able value
//     shot(name)          saves <out-folder>/<name>.png
//     wait(ms), navigate(url)
// Point the URL at a test server (KOE_ART_DIR=<scratch> KOE_MUTE=1 python app.py --browser), never real data.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [url, stepsFile, outDir, width = '1400', height = '900'] = process.argv.slice(2);
if (!url || !stepsFile || !outDir) {
  console.error('Usage: node tools/ui_shot.mjs <url> <steps.mjs> <out-folder> [width] [height]');
  process.exit(2);
}
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .find(p => existsSync(p));
if (!EDGE) throw new Error('Microsoft Edge was not found.');

const wait = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'koe-shot-'));
const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio',
  '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });

let closeBrowser = async () => {};
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await wait(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { /* not yet */ }
  }
  if (!port) throw new Error('Edge did not start its DevTools port.');
  closeBrowser = () => fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()).then(v => new Promise(res => {
    const b = new WebSocket(v.webSocketDebuggerUrl);  // Browser.close shuts down every Edge process, not just the launcher
    b.onopen = () => { b.send(JSON.stringify({ id: 1, method: 'Browser.close' })); setTimeout(res, 500); };
    b.onerror = res;
  })).catch(() => {});
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const pending = new Map(), listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else listeners.forEach(fn => fn(m));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const loaded = () => new Promise(res => listeners.push(m => { if (m.method === 'Page.loadEventFired') res(); }));

  await send('Page.enable');
  await send('Runtime.enable');
  listeners.push(m => {
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('console.error:', m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false });
  const navigate = async u => { const l = loaded(); await send('Page.navigate', { url: u }); await l; await wait(300); };
  const evaluate = async js => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  mkdirSync(outDir, { recursive: true });
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(outDir, name + '.png');
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('saved', file);
  };
  await navigate(url);
  const steps = (await import(pathToFileURL(resolve(stepsFile)).href)).default;
  await steps({ evaluate, shot, wait, navigate });
  ws.close();
} finally {
  await closeBrowser();
  // anything still running from this profile (Edge starts several processes)
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
  else edge.kill();
  await wait(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Edge may still hold files */ }
}
