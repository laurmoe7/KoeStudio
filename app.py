"""KoeStudio, a drawing and painting program - desktop app entry point.

Runs a small local HTTP server (127.0.0.1 only) that serves the UI in web/ and a JSON API for artwork files,
then shows it in a native window via pywebview (WebView2).

    python app.py             # desktop window
    python app.py --browser   # serve only (open http://127.0.0.1:8770 in a browser)
    python app.py --hidden    # desktop window that is never shown (for testing the real window)
    python app.py --muted     # no sound (same as KOE_MUTE=1)

Artwork is stored outside the project, in Pictures\\KoeStudio (KOE_ART_DIR overrides). Window storage and
error.log live in %LOCALAPPDATA%\\KoeStudio (KOE_APP_DIR overrides).
"""
import json
import os
import re
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP_NAME = 'KoeStudio'
BASE = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, 'web')
MAX_BODY = 512 * 1024 * 1024  # a big canvas with many layers is a big JSON file
ID_RE = re.compile(r'^[0-9a-f]{8,32}$')


def pictures_folder():
    """The user's Pictures folder, wherever Windows has put it (it may be redirected to OneDrive)."""
    if sys.platform == 'win32':
        try:
            import ctypes
            from ctypes import wintypes
            buf = ctypes.c_wchar_p()
            # FOLDERID_Pictures {33E28130-4E1E-4676-835A-98395C3BC3BB}
            guid = (ctypes.c_byte * 16)(*uuid.UUID('33E28130-4E1E-4676-835A-98395C3BC3BB').bytes_le)
            if ctypes.windll.shell32.SHGetKnownFolderPath(guid, 0, None, ctypes.byref(buf)) == 0:
                path = buf.value
                ctypes.windll.ole32.CoTaskMemFree(buf)
                if path:
                    return path
        except Exception:
            pass
    return os.path.join(os.path.expanduser('~'), 'Pictures')


def art_dir():
    return os.environ.get('KOE_ART_DIR') or os.path.join(pictures_folder(), APP_NAME)


def app_dir():
    return os.environ.get('KOE_APP_DIR') or os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), APP_NAME)


def muted():
    return '--muted' in sys.argv or os.environ.get('KOE_MUTE', '') not in ('', '0')


def log_error(text):
    """Appends to error.log in the app folder; the windowed app has no console, so this is how problems get reported."""
    try:
        os.makedirs(app_dir(), exist_ok=True)
        with open(os.path.join(app_dir(), 'error.log'), 'a', encoding='utf8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + text.rstrip() + '\n')
    except OSError:
        pass


# ---------- artwork storage ----------
# Each artwork is <id>.koe (JSON: size, paper, layers as PNG data URLs) plus .thumbs/<id>.png.
# Delete moves both into .deleted/ so nothing is lost by a mis-click.

def _check_id(art_id):
    if not ID_RE.match(art_id or ''):
        raise ValueError('Bad artwork id')
    return art_id


def _paths(art_id):
    d = art_dir()
    return os.path.join(d, art_id + '.koe'), os.path.join(d, '.thumbs', art_id + '.png')


def _write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def _decode_data_url(url):
    import base64
    m = re.match(r'^data:image/png;base64,(.*)$', url or '', re.S)
    if not m:
        raise ValueError('Expected a PNG data URL')
    return base64.b64decode(m.group(1))


def list_art():
    d = art_dir()
    out = []
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        if not name.endswith('.koe'):
            continue
        path = os.path.join(d, name)
        try:
            with open(path, encoding='utf-8') as f:
                head = json.load(f)
        except (OSError, ValueError):
            continue
        out.append({
            'id': name[:-4],
            'title': head.get('title') or 'Untitled',
            'width': head.get('width'),
            'height': head.get('height'),
            'layers': _count_layers(head.get('layers')),
            'modified': os.path.getmtime(path),
        })
    out.sort(key=lambda a: -a['modified'])
    return out


def _count_layers(nodes, depth=0):
    """Raster layers in a saved layer tree (folders hold `children`)."""
    if not isinstance(nodes, list) or depth > 20:
        return 0
    return sum(_count_layers(n.get('children'), depth + 1) if isinstance(n, dict) and n.get('type') == 'folder' else 1
               for n in nodes)


def load_art(art_id):
    path, _ = _paths(_check_id(art_id))
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_art(art_id, doc):
    """Writes the artwork; a missing id makes a new one. The thumbnail travels in doc['thumb'] and is stored apart."""
    if not isinstance(doc, dict) or doc.get('format') != 'koe':
        raise ValueError('Not a KoeStudio document')
    art_id = _check_id(art_id) if art_id else uuid.uuid4().hex[:16]
    path, thumb = _paths(art_id)
    thumb_url = doc.pop('thumb', None)
    _write_atomic(path, json.dumps(doc, separators=(',', ':')).encode('utf-8'))
    if thumb_url:
        _write_atomic(thumb, _decode_data_url(thumb_url))
    return {'id': art_id, 'modified': os.path.getmtime(path)}


def delete_art(art_id):
    path, thumb = _paths(_check_id(art_id))
    trash = os.path.join(art_dir(), '.deleted')
    os.makedirs(trash, exist_ok=True)
    stamp = int(time.time())
    if os.path.exists(path):
        os.replace(path, os.path.join(trash, f'{art_id}-{stamp}.koe'))
    if os.path.exists(thumb):
        os.replace(thumb, os.path.join(trash, f'{art_id}-{stamp}.png'))
    return {'ok': True}


def read_thumb(art_id):
    _, thumb = _paths(_check_id(art_id))
    with open(thumb, 'rb') as f:
        return f.read()


def safe_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name or '').strip(' .')
    return name[:80] or 'Untitled'


def export_png(name, data):
    """Saves a flattened PNG to Pictures\\KoeStudio\\Exports, never overwriting an older export."""
    if not data.startswith(b'\x89PNG'):
        raise ValueError('Expected PNG data')
    folder = os.path.join(art_dir(), 'Exports')
    base = safe_filename(name)
    path = os.path.join(folder, base + '.png')
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f'{base} ({n}).png')
        n += 1
    _write_atomic(path, data)
    return {'path': path}


def open_folder(sub=''):
    folder = os.path.join(art_dir(), sub) if sub in ('', 'Exports') else art_dir()
    os.makedirs(folder, exist_ok=True)
    if sys.platform == 'win32':
        os.startfile(folder)
    return {'path': folder}


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        # UI files are revalidated on every load (a saved edit shows up after a reload); API answers are never cached.
        self.send_header('Cache-Control', 'no-store' if getattr(self, 'path', '').startswith('/api/') else 'no-cache')
        super().end_headers()

    def _send(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8', status)

    def _raw(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise ValueError('That is too big to save.')
        return self.rfile.read(n)

    def _route(self, method):
        u = urlparse(self.path)
        if not u.path.startswith('/api/'):
            return False
        p = {k: v[0] for k, v in parse_qs(u.query).items()}
        route = (method, u.path[5:])
        try:
            if route == ('GET', 'config'):
                self._json({'muted': muted(), 'artDir': art_dir()})
            elif route == ('GET', 'art'):
                self._json(list_art())
            elif route == ('GET', 'art/file'):
                self._json(load_art(p.get('id', '')))
            elif route == ('GET', 'art/thumb'):
                self._send(read_thumb(p.get('id', '')), 'image/png')
            elif route == ('POST', 'art/save'):
                self._json(save_art(p.get('id', ''), json.loads(self._raw() or b'null')))
            elif route == ('POST', 'art/delete'):
                self._json(delete_art(p.get('id', '')))
            elif route == ('POST', 'export'):
                self._json(export_png(p.get('name', ''), self._raw()))
            elif route == ('POST', 'open-folder'):
                self._json(open_folder(p.get('sub', '')))
            else:
                self._json({'error': 'not found'}, 404)
        except FileNotFoundError:
            self._json({'error': 'not found'}, 404)
        except Exception as e:  # surface errors to the UI instead of hanging
            self._json({'error': str(e)}, 500)
        return True

    def _allowed(self):
        """Only this app's own page may use the server: any web page open in a browser can send requests to 127.0.0.1,
        so refuse foreign Host names (DNS rebinding), foreign Origins and requests a browser marks as cross-site."""
        if self.headers.get('Host', '') not in self.server.hosts:
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin not in self.server.origins:
            return False
        return self.headers.get('Sec-Fetch-Site') not in ('cross-site', 'same-site')

    def _refuse(self):
        if self.path.startswith('/api/'):
            self._json({'error': 'Only KoeStudio itself may use this server.'}, 403)
        else:
            self.send_error(403)

    def do_GET(self):
        if not self._allowed():
            self._refuse()
        elif not self._route('GET'):
            super().do_GET()

    def do_POST(self):
        if not self._allowed():
            self._refuse()
        elif not self._route('POST'):
            self._json({'error': 'not found'}, 404)


def start_server(port):
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    port = srv.server_address[1]  # the real one when 0 was asked for
    srv.hosts = {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}
    srv.origins = {'http://' + h for h in srv.hosts}
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def _wait_forever():
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


def main():
    port = int(os.environ.get('KOE_PORT') or 8770)
    for p in range(port, port + 20):
        try:
            srv = start_server(p)
            port = p
            break
        except OSError:
            continue
    url = f'http://127.0.0.1:{port}/'
    if '--browser' in sys.argv:
        print('Serving', url, '(muted)' if muted() else '', flush=True)
        _wait_forever()
        return
    import webview
    webview.settings['ALLOW_DOWNLOADS'] = True
    if sys.platform == 'win32':
        try:  # own taskbar identity, so the window shows the KoeStudio icon instead of grouping under Python
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('KoeStudio.App')
        except Exception:
            pass
    storage = os.path.join(app_dir(), 'webview')  # keeps localStorage (tool settings, last artwork) between launches
    try:
        webview.create_window(APP_NAME, url, width=1500, height=950, min_size=(1000, 650),
                              hidden='--hidden' in sys.argv, background_color='#1e1f24')
        webview.start(icon=os.path.join(WEB, 'icon.ico'), private_mode=False, storage_path=storage)
    except Exception:
        # No usable WebView2 runtime: use the default browser instead, so the app still works.
        log_error('Window failed, falling back to the browser:\n' + traceback.format_exc())
        webbrowser.open(url)
        _wait_forever()
    srv.shutdown()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        log_error(traceback.format_exc())
        raise
