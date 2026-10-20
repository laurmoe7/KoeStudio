// Calls to the local server in app.py.

async function call(method, path, body, type = 'application/json') {
  const res = await fetch('/api/' + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': type },
    body: body === undefined ? undefined : (type === 'application/json' ? JSON.stringify(body) : body),
  });
  const data = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
  if (!res.ok || data?.error) throw Object.assign(new Error(data?.error || `Server answered ${res.status}`), { status: res.status, data });
  return data;
}

const q = s => encodeURIComponent(s ?? '');

export const api = {
  config: () => call('GET', 'config'),
  list: () => call('GET', 'art'),
  /** edit: the server also remembers its pictures for saves that send only changes. */
  load: (id, edit = false) => call('GET', `art/file?id=${q(id)}${edit ? '&edit=1' : ''}`),
  save: (id, doc) => call('POST', `art/save?id=${q(id)}`, doc),
  remove: id => call('POST', `art/delete?id=${q(id)}`, {}),
  rename: (id, title) => call('POST', `art/rename?id=${q(id)}&title=${q(title)}`, {}),
  duplicate: id => call('POST', `art/duplicate?id=${q(id)}`, {}),
  backups: id => call('GET', `art/backups?id=${q(id)}`),
  loadBackup: (id, name) => call('GET', `art/backup?id=${q(id)}&name=${q(name)}`),
  deleted: () => call('GET', 'deleted'),
  deletedThumbUrl: name => `/api/deleted/thumb?name=${q(name)}`,
  restore: name => call('POST', `deleted/restore?name=${q(name)}`, {}),
  thumbUrl: (id, v) => `/api/art/thumb?id=${q(id)}&v=${q(v)}`,
  /** dir: a folder ('' = the Exports folder); mode: 'number' (add " (2)" when taken), 'ask' (fails with data.exists) or 'replace'. */
  exportImage: (name, format, blob, { dir = '', mode = 'number' } = {}) =>
    call('POST', `export?name=${q(name)}&format=${q(format)}&dir=${q(dir)}&mode=${q(mode)}`, blob, 'application/octet-stream'),
  listDir: path => call('GET', `fs/list?path=${q(path)}`),
  makeDir: (path, name) => call('POST', `fs/mkdir?path=${q(path)}&name=${q(name)}`, {}),
  openFile: () => call('GET', 'open-file'),
  /** Brush tip/texture images and saved brushes ({images, presets}). */
  brushes: () => call('GET', 'brushes'),
  brushImageUrl: id => `/api/brushes/image?id=${q(id)}`,
  addBrushImage: (kind, name, blob) => call('POST', `brushes/image?kind=${q(kind)}&name=${q(name)}`, blob, 'application/octet-stream'),
  deleteBrushImage: id => call('POST', `brushes/image/delete?id=${q(id)}`, {}),
  savePresets: presets => call('POST', 'brushes/presets', presets),
  /** The brushes in a Procreate (.brush, .brushset) or Photoshop (.abr) file: {name, brushes, images}. */
  importBrushes: (name, blob) => call('POST', `brushes/import?name=${q(name)}`, blob, 'application/octet-stream'),
  /** The brushes added to Clip Studio Paint on this PC (downloaded or made there), in the shape importBrushes gives. */
  clipStudioBrushes: () => call('GET', 'brushes/clipstudio'),
  /** Reference pictures (Reference window): [{id, name}], oldest first. */
  refs: () => call('GET', 'refs'),
  refImageUrl: id => `/api/refs/image?id=${q(id)}`,
  addRef: (name, blob) => call('POST', `refs/add?name=${q(name)}`, blob, 'application/octet-stream'),
  deleteRef: id => call('POST', `refs/delete?id=${q(id)}`, {}),
  /** The Color mixing panel's scratch area (a PNG kept per computer; the GET fails with 404 before the first save). */
  mixPadUrl: () => '/api/mixpad',
  saveMixPad: blob => call('POST', 'mixpad', blob, 'application/octet-stream'),
  /** Timelapse frames of an artwork (JPEGs kept by the server): {frames}. */
  timelapse: id => call('GET', `timelapse?id=${q(id)}`),
  timelapseFrameUrl: (id, n) => `/api/timelapse/frame?id=${q(id)}&n=${n}`,
  addTimelapseFrame: (id, blob) => call('POST', `timelapse/add?id=${q(id)}`, blob, 'application/octet-stream'),
  clearTimelapse: id => call('POST', `timelapse/clear?id=${q(id)}`, {}),
  openFolder: (sub = '', path = '') => call('POST', `open-folder?sub=${q(sub)}&path=${q(path)}`, {}),
};
