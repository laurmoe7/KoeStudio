// Calls to the local server in app.py.

async function call(method, path, body, type = 'application/json') {
  const res = await fetch('/api/' + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': type },
    body: body === undefined ? undefined : (type === 'application/json' ? JSON.stringify(body) : body),
  });
  const data = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
  if (!res.ok || data?.error) throw new Error(data?.error || `Server answered ${res.status}`);
  return data;
}

const q = s => encodeURIComponent(s ?? '');

export const api = {
  config: () => call('GET', 'config'),
  list: () => call('GET', 'art'),
  load: id => call('GET', `art/file?id=${q(id)}`),
  save: (id, doc) => call('POST', `art/save?id=${q(id)}`, doc),
  remove: id => call('POST', `art/delete?id=${q(id)}`, {}),
  thumbUrl: (id, v) => `/api/art/thumb?id=${q(id)}&v=${q(v)}`,
  exportImage: (name, format, blob) => call('POST', `export?name=${q(name)}&format=${q(format)}`, blob, 'application/octet-stream'),
  openFolder: (sub = '') => call('POST', `open-folder?sub=${q(sub)}`, {}),
};
