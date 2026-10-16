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


KNOWN_FOLDERS = {  # Windows FOLDERIDs, and the usual place elsewhere
    'Pictures': '33E28130-4E1E-4676-835A-98395C3BC3BB',
    'Desktop': 'B4BFCC3A-DB2C-424C-B029-7FE99A87C641',
    'Documents': 'FDD39AD0-238F-46AF-ADB4-6C85480369C7',
    'Downloads': '374DE290-123F-4565-9164-39C4925E467B',
}


def known_folder(name):
    """A user folder (Pictures, Desktop, Documents, Downloads) wherever Windows has put it (it may be redirected to
    OneDrive)."""
    if sys.platform == 'win32':
        try:
            import ctypes
            buf = ctypes.c_wchar_p()
            guid = (ctypes.c_byte * 16)(*uuid.UUID(KNOWN_FOLDERS[name]).bytes_le)
            if ctypes.windll.shell32.SHGetKnownFolderPath(guid, 0, None, ctypes.byref(buf)) == 0:
                path = buf.value
                ctypes.windll.ole32.CoTaskMemFree(buf)
                if path:
                    return path
        except Exception:
            pass
    return os.path.join(os.path.expanduser('~'), name)


def pictures_folder():
    return known_folder('Pictures')


def art_dir():
    return os.environ.get('KOE_ART_DIR') or os.path.join(pictures_folder(), APP_NAME)


def build_info(base=None):
    """Which version of the program this is, for Help -> About: the git commit it runs from and when that was
    checked out, read straight from .git (no git needed). Empty when the folder is not a git checkout."""
    git = os.path.join(base or BASE, '.git')
    try:
        with open(os.path.join(git, 'HEAD'), encoding='utf-8') as f:
            head = f.read().strip()
        if not head.startswith('ref: '):
            return {'build': head[:7], 'buildDate': ''}
        ref = head[5:]
        path = os.path.join(git, *ref.split('/'))
        if os.path.isfile(path):
            with open(path, encoding='utf-8') as f:
                sha = f.read().strip()
            when = time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(path)))
            return {'build': sha[:7], 'buildDate': when}
        with open(os.path.join(git, 'packed-refs'), encoding='utf-8') as f:
            for line in f:
                parts = line.split()
                if len(parts) == 2 and parts[1] == ref:
                    return {'build': parts[0][:7], 'buildDate': ''}
    except OSError:
        pass
    return {'build': '', 'buildDate': ''}


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
# Delete moves both into .deleted/ so nothing is lost by a mis-click, and the gallery can put them back.
# Saving keeps the file it replaces in .backups/ every BACKUP_EVERY seconds, the newest BACKUP_KEEP per artwork.

def _check_id(art_id):
    if not ID_RE.match(art_id or ''):
        raise ValueError('Bad artwork id')
    return art_id


def _paths(art_id):
    d = art_dir()
    return os.path.join(d, art_id + '.koe'), os.path.join(d, '.thumbs', art_id + '.png')


def _write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.{threading.get_ident()}.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    # Windows refuses to replace a file that someone (another request, a virus scanner) has open for a moment
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                os.remove(tmp)
                raise
            time.sleep(0.05)


def _decode_data_url(url):
    import base64
    m = re.match(r'^data:image/png;base64,(.*)$', url or '', re.S)
    if not m:
        raise ValueError('Expected a PNG data URL')
    return base64.b64decode(m.group(1))


def _meta_path(art_id):
    return os.path.join(art_dir(), '.thumbs', art_id + '.json')


def _meta_of(doc):
    return {
        'title': doc.get('title') or 'Untitled',
        'width': doc.get('width'),
        'height': doc.get('height'),
        'layers': _count_layers(doc.get('layers')),
    }


def _read_meta(art_id, path):
    """What the gallery shows about an artwork. It comes from a small file saved beside the thumbnail, so listing
    never has to parse the (possibly huge) .koe files; artwork without one, or changed since, is read once and
    the file written."""
    meta_path = _meta_path(art_id)
    try:
        if os.path.getmtime(meta_path) >= os.path.getmtime(path):
            with open(meta_path, encoding='utf-8') as f:
                return json.load(f)
    except (OSError, ValueError):
        pass
    with open(path, encoding='utf-8') as f:
        meta = _meta_of(json.load(f))
    try:
        _write_atomic(meta_path, json.dumps(meta).encode('utf-8'))
    except OSError:
        pass
    return meta


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
            meta = _read_meta(name[:-4], path)
            modified = os.path.getmtime(path)
        except (OSError, ValueError):
            continue
        out.append({'id': name[:-4], **meta, 'modified': modified})
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


BACKUP_EVERY = 10 * 60  # seconds between kept versions of one artwork
BACKUP_KEEP = 5         # earlier versions kept per artwork
STAMPED_RE = re.compile(r'^([0-9a-f]{8,32})-(\d+)\.koe$')  # <id>-<unix time>.koe in .backups/ and .deleted/


def _backup_dir():
    return os.path.join(art_dir(), '.backups')


def list_backups(art_id):
    """Earlier versions of an artwork, newest first: [{name, kept, modified, size}]. `kept` is when the backup was
    taken (from its name), `modified` when that version was saved."""
    _check_id(art_id)
    d = _backup_dir()
    out = []
    if os.path.isdir(d):
        for name in os.listdir(d):
            m = STAMPED_RE.match(name)
            if m and m.group(1) == art_id:
                st = os.stat(os.path.join(d, name))
                out.append({'name': name, 'kept': int(m.group(2)), 'modified': st.st_mtime, 'size': st.st_size})
    out.sort(key=lambda b: -b['kept'])
    return out


def _keep_backup(art_id, path, now=None):
    """Before an artwork is overwritten, keeps the file being replaced in .backups/ when the newest kept version is
    older than BACKUP_EVERY, and drops versions past BACKUP_KEEP. A hard link costs nothing (the old file is
    replaced, never changed in place); where links are not possible it is copied."""
    if not os.path.exists(path):
        return
    now = time.time() if now is None else now
    old = list_backups(art_id)
    if old and now - old[0]['kept'] < BACKUP_EVERY:
        return
    os.makedirs(_backup_dir(), exist_ok=True)
    target = os.path.join(_backup_dir(), f'{art_id}-{int(now)}.koe')
    if not os.path.exists(target):
        try:
            os.link(path, target)
        except OSError:
            import shutil
            shutil.copy2(path, target)
    for b in list_backups(art_id)[BACKUP_KEEP:]:
        try:
            os.remove(os.path.join(_backup_dir(), b['name']))
        except OSError:
            pass


def load_backup(art_id, name):
    m = STAMPED_RE.match(name or '')
    if not m or m.group(1) != _check_id(art_id):
        raise ValueError('Bad backup name')
    with open(os.path.join(_backup_dir(), name), encoding='utf-8') as f:
        return json.load(f)


def save_art(art_id, doc):
    """Writes the artwork; a missing id makes a new one. The thumbnail travels in doc['thumb'] and is stored apart."""
    if not isinstance(doc, dict) or doc.get('format') != 'koe':
        raise ValueError('Not a KoeStudio document')
    art_id = _check_id(art_id) if art_id else uuid.uuid4().hex[:16]
    path, thumb = _paths(art_id)
    thumb_url = doc.pop('thumb', None)
    _keep_backup(art_id, path)
    _write_atomic(path, json.dumps(doc, separators=(',', ':')).encode('utf-8'))
    _write_atomic(_meta_path(art_id), json.dumps(_meta_of(doc)).encode('utf-8'))
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
    try:  # the gallery details go along, so the Deleted list can show them without reading the artwork
        os.replace(_meta_path(art_id), os.path.join(trash, f'{art_id}-{stamp}.json'))
    except OSError:
        pass
    return {'ok': True}


def _trash():
    return os.path.join(art_dir(), '.deleted')


def list_deleted():
    """Artwork in .deleted/, most recently deleted first: [{name, title, width, height, layers, deleted}]."""
    out = []
    d = _trash()
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        m = STAMPED_RE.match(name)
        if not m:
            continue
        path = os.path.join(d, name)
        try:
            with open(path[:-4] + '.json', encoding='utf-8') as f:
                meta = json.load(f)
        except (OSError, ValueError):
            try:  # deleted by an earlier version, which dropped the details
                with open(path, encoding='utf-8') as f:
                    meta = _meta_of(json.load(f))
            except (OSError, ValueError):
                continue
        out.append({'name': name, **meta, 'deleted': int(m.group(2))})
    out.sort(key=lambda a: -a['deleted'])
    return out


def deleted_thumb(name):
    if not STAMPED_RE.match(name or ''):
        raise ValueError('Bad name')
    with open(os.path.join(_trash(), name[:-4] + '.png'), 'rb') as f:
        return f.read()


def restore_deleted(name):
    """Puts a deleted artwork back in the gallery (under a new id if its old one has been taken since)."""
    m = STAMPED_RE.match(name or '')
    if not m:
        raise ValueError('Bad name')
    src = os.path.join(_trash(), name)
    if not os.path.exists(src):
        raise FileNotFoundError(name)
    art_id = m.group(1)
    if os.path.exists(_paths(art_id)[0]):
        art_id = uuid.uuid4().hex[:16]
    path, thumb = _paths(art_id)
    os.makedirs(os.path.dirname(thumb), exist_ok=True)
    os.replace(src, path)
    os.utime(path)  # comes first in the gallery
    for ext, dest in (('.png', thumb), ('.json', _meta_path(art_id))):
        try:
            os.replace(src[:-4] + ext, dest)
            os.utime(dest)
        except OSError:
            pass
    return {'id': art_id}


def _rewrite(art_id, change):
    """Loads an artwork, lets change(doc) edit it and writes it back (keeping a backup, as saving does)."""
    path, _ = _paths(_check_id(art_id))
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    change(doc)
    _keep_backup(art_id, path)
    _write_atomic(path, json.dumps(doc, separators=(',', ':')).encode('utf-8'))
    _write_atomic(_meta_path(art_id), json.dumps(_meta_of(doc)).encode('utf-8'))
    return doc


def rename_art(art_id, title):
    title = (title or '').strip()[:120]
    if not title:
        raise ValueError('The title is empty')
    _rewrite(art_id, lambda d: d.__setitem__('title', title))
    return {'ok': True}


def duplicate_art(art_id):
    """Copies an artwork (and its thumbnail) to a new id, titled "<title> copy"."""
    path, thumb = _paths(_check_id(art_id))
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    doc['title'] = ((doc.get('title') or 'Untitled') + ' copy')[:120]
    new_id = uuid.uuid4().hex[:16]
    new_path, new_thumb = _paths(new_id)
    _write_atomic(new_path, json.dumps(doc, separators=(',', ':')).encode('utf-8'))
    _write_atomic(_meta_path(new_id), json.dumps(_meta_of(doc)).encode('utf-8'))
    if os.path.exists(thumb):
        with open(thumb, 'rb') as f:
            _write_atomic(new_thumb, f.read())
    return {'id': new_id}


def read_thumb(art_id):
    _, thumb = _paths(_check_id(art_id))
    with open(thumb, 'rb') as f:
        return f.read()


def safe_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name or '').strip(' .')
    return name[:80] or 'Untitled'


EXPORT_TYPES = {
    'png': lambda d: d.startswith(b'\x89PNG'),
    'jpg': lambda d: d.startswith(b'\xff\xd8'),
    'webp': lambda d: d[:4] == b'RIFF' and d[8:12] == b'WEBP',
    'gif': lambda d: d[:4] == b'GIF8',
    'bmp': lambda d: d[:2] == b'BM',
    'koe': lambda d: d.lstrip()[:1] == b'{' and b'"format":"koe"' in d[:2000].replace(b' ', b''),
    'tga': lambda d: d.endswith(b'TRUEVISION-XFILE.\x00'),
}


def exports_dir():
    return os.path.join(art_dir(), 'Exports')


def export_image(name, data, fmt='png', folder='', mode='number'):
    """Saves an exported file into `folder` (an existing folder; empty means Pictures\\KoeStudio\\Exports). When the
    name is taken, mode 'number' adds " (2)", " (3)"…, 'ask' raises FileExistsError and 'replace' overwrites."""
    check = EXPORT_TYPES.get(fmt)
    if check is None:
        raise ValueError('Unknown export format')
    if not check(data):
        raise ValueError(f'Expected {fmt.upper()} data')
    if folder:
        folder = os.path.abspath(folder)
        if not os.path.isdir(folder):
            raise ValueError('That folder does not exist any more: ' + folder)
    else:
        folder = os.path.abspath(exports_dir())
    base = safe_filename(name)
    path = os.path.join(folder, f'{base}.{fmt}')
    if os.path.exists(path):
        if mode == 'ask':
            raise FileExistsError(path)
        if mode != 'replace':
            n = 2
            while os.path.exists(path):
                path = os.path.join(folder, f'{base} ({n}).{fmt}')
                n += 1
    _write_atomic(path, data)
    return {'path': path, 'folder': folder}


# ---------- file browser (choosing where exports go) ----------

LISTED_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga', '.koe')


def places():
    """Folders offered at the side of the file browser: [{name, path}], only those that exist."""
    out = [{'name': 'Exports', 'path': exports_dir()}, {'name': 'Artwork folder', 'path': art_dir()}]
    out += [{'name': n, 'path': known_folder(n)} for n in ('Desktop', 'Pictures', 'Documents', 'Downloads')]
    out = [{**p, 'path': os.path.abspath(p['path'])} for p in out if os.path.isdir(p['path']) or p['name'] == 'Exports']
    if sys.platform == 'win32':
        import string
        out += [{'name': f'Drive {c}:', 'path': f'{c}:\\'} for c in string.ascii_uppercase if os.path.isdir(f'{c}:\\')]
    else:
        out.append({'name': 'Computer', 'path': '/'})
    return out


def list_dir(path=''):
    """A folder for the file browser: its sub-folders and picture/project files (hidden ones left out), its parent
    (None at a drive's root), and the places. An empty path is the Exports folder."""
    path = os.path.abspath(path or exports_dir())
    if path == os.path.abspath(exports_dir()):
        os.makedirs(path, exist_ok=True)
    dirs, files = [], []
    with os.scandir(path) as it:
        for e in it:
            if e.name.startswith(('.', '$')) or e.name in ('desktop.ini', 'Thumbs.db'):
                continue
            try:
                if e.is_dir():
                    dirs.append(e.name)
                elif e.name.lower().endswith(LISTED_EXT):
                    st = e.stat()
                    files.append({'name': e.name, 'size': st.st_size, 'modified': st.st_mtime})
            except OSError:
                continue
    dirs.sort(key=str.lower)
    files.sort(key=lambda f: f['name'].lower())
    parent = os.path.dirname(path)
    return {'path': path, 'parent': parent if parent != path else None, 'dirs': dirs, 'files': files, 'places': places()}


def make_dir(parent, name):
    """A new folder inside parent, for the file browser's New folder button."""
    name = safe_filename(name)
    parent = os.path.abspath(parent)
    if not os.path.isdir(parent):
        raise ValueError('That folder does not exist')
    path = os.path.join(parent, name)
    if os.path.exists(path):
        raise FileExistsError(path)
    os.mkdir(path)
    return {'path': path}


def export_png(name, data):
    return export_image(name, data, 'png')


PENDING_OPEN = []  # .koe files given on the command line (double-click in Explorer), waiting for the page to take them


def project_args(argv):
    """Existing .koe files named in the command line."""
    return [a for a in argv[1:] if a.lower().endswith('.koe') and os.path.isfile(a)]


def take_open_file():
    """The next waiting project file as a document (the page makes a new artwork from it), or None. Handed out once."""
    while PENDING_OPEN:
        path = PENDING_OPEN.pop(0)
        try:
            with open(path, encoding='utf-8') as f:
                doc = json.load(f)
        except (OSError, ValueError):
            log_error('Could not read project file ' + path)
            continue
        if isinstance(doc, dict) and doc.get('format') == 'koe':
            if not doc.get('title') or doc['title'] == 'Untitled':
                doc['title'] = os.path.splitext(os.path.basename(path))[0]
            return doc
    return None


def open_folder(sub='', path=''):
    """Shows a folder in Explorer: the artwork folder, its Exports folder, or an existing folder by path."""
    if path:
        folder = os.path.abspath(path)
        if not os.path.isdir(folder):
            raise FileNotFoundError(folder)
    else:
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
        self._body_read = True
        return self.rfile.read(n)

    def _drop_body(self):
        """A request body nobody read would stay in the kept-alive connection and be taken for the next request
        (which then fails with 501), so read small ones away and close the connection after big ones."""
        if getattr(self, '_body_read', False):
            return
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = -1
        if 0 < n <= 65536:
            self.rfile.read(n)
        elif n:
            self.close_connection = True

    def _route(self, method):
        u = urlparse(self.path)
        if not u.path.startswith('/api/'):
            return False
        p = {k: v[0] for k, v in parse_qs(u.query).items()}
        route = (method, u.path[5:])
        try:
            if route == ('GET', 'config'):
                self._json({'muted': muted(), 'artDir': art_dir(), 'appDir': app_dir(), 'openFile': bool(PENDING_OPEN),
                            'python': sys.version.split()[0], **build_info()})
            elif route == ('GET', 'open-file'):
                self._json({'doc': take_open_file()})
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
            elif route == ('POST', 'art/rename'):
                self._json(rename_art(p.get('id', ''), p.get('title', '')))
            elif route == ('POST', 'art/duplicate'):
                self._json(duplicate_art(p.get('id', '')))
            elif route == ('GET', 'art/backups'):
                self._json(list_backups(p.get('id', '')))
            elif route == ('GET', 'art/backup'):
                self._json(load_backup(p.get('id', ''), p.get('name', '')))
            elif route == ('GET', 'deleted'):
                self._json(list_deleted())
            elif route == ('GET', 'deleted/thumb'):
                self._send(deleted_thumb(p.get('name', '')), 'image/png')
            elif route == ('POST', 'deleted/restore'):
                self._json(restore_deleted(p.get('name', '')))
            elif route == ('POST', 'export'):
                self._json(export_image(p.get('name', ''), self._raw(), p.get('format', 'png'), p.get('dir', ''), p.get('mode', 'number')))
            elif route == ('POST', 'open-folder'):
                self._json(open_folder(p.get('sub', ''), p.get('path', '')))
            elif route == ('GET', 'fs/list'):
                self._json(list_dir(p.get('path', '')))
            elif route == ('POST', 'fs/mkdir'):
                self._json(make_dir(p.get('path', ''), p.get('name', '')))
            elif route == ('GET', 'brushes'):
                self._json(load_brushes())
            elif route == ('GET', 'brushes/image'):
                self._send(brush_image(p.get('id', '')), 'image/png')
            elif route == ('POST', 'brushes/image'):
                self._json(add_brush_image(p.get('kind', ''), p.get('name', ''), self._raw()))
            elif route == ('POST', 'brushes/image/delete'):
                self._json(delete_brush_image(p.get('id', '')))
            elif route == ('POST', 'brushes/presets'):
                self._json(save_presets(json.loads(self._raw() or b'null')))
            elif route == ('GET', 'refs'):
                self._json(list_refs())
            elif route == ('GET', 'refs/image'):
                self._send(*ref_image(p.get('id', '')))
            elif route == ('POST', 'refs/add'):
                self._json(add_ref(p.get('name', ''), self._raw()))
            elif route == ('POST', 'refs/delete'):
                self._json(delete_ref(p.get('id', '')))
            elif route == ('POST', 'brushes/import'):
                self._json(import_brushes(p.get('name', ''), self._raw()))
            else:
                self._json({'error': 'not found'}, 404)
        except FileExistsError as e:
            self._json({'error': f'{os.path.basename(str(e)) or "That"} already exists', 'exists': True}, 409)
        except FileNotFoundError:
            self._json({'error': 'not found'}, 404)
        except PermissionError:
            self._json({'error': 'Windows does not allow that here (no permission).'}, 403)
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
        self._body_read = False
        try:
            if not self._allowed():
                self._refuse()
            elif not self._route('POST'):
                self._json({'error': 'not found'}, 404)
        finally:
            self._drop_body()


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


# ---------- brushes: tip and texture images, saved brushes ----------
# Kept in <app dir>/brushes: <id>.png per image and brushes.json = {images: [{id, name, kind}], presets: [...]}.
# Presets are KoeStudio paint-tool settings (checked again in the browser when used), so only their shape is
# checked here.

BRUSH_KINDS = ('tip', 'texture')
MAX_BRUSH_IMAGE = 32 * 1024 * 1024
MAX_PRESETS = 2000


def brushes_dir():
    return os.path.join(app_dir(), 'brushes')


BRUSH_LOCK = threading.Lock()  # changes to brushes.json are read-modify-write: one at a time


def _brush_index(strict=False):
    """brushes.json, or an empty library when there is none. strict (before a change): an index that exists but
    cannot be read raises, so a change never writes an empty library over it."""
    path = os.path.join(brushes_dir(), 'brushes.json')
    try:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
    except FileNotFoundError:
        raw = {}
    except (OSError, ValueError):
        if strict:
            raise OSError('The brush library could not be read just now; try again.')
        raw = {}
    raw = raw if isinstance(raw, dict) else {}
    images = [i for i in raw.get('images') or [] if isinstance(i, dict) and ID_RE.match(str(i.get('id', '')))
              and i.get('kind') in BRUSH_KINDS and os.path.exists(os.path.join(brushes_dir(), i['id'] + '.png'))]
    presets = [p for p in raw.get('presets') or [] if isinstance(p, dict)]
    return {'images': images, 'presets': presets}


def load_brushes():
    with BRUSH_LOCK:
        return _brush_index()


def _change_brushes(change):
    with BRUSH_LOCK:
        lib = _brush_index(strict=True)
        change(lib)
        _write_atomic(os.path.join(brushes_dir(), 'brushes.json'), json.dumps(lib, ensure_ascii=False).encode('utf-8'))


def add_brush_image(kind, name, data):
    if kind not in BRUSH_KINDS:
        raise ValueError('Unknown kind of brush image.')
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Brush images must be PNG files.')
    if len(data) > MAX_BRUSH_IMAGE:
        raise ValueError('That image is too big for a brush.')
    entry = {'id': uuid.uuid4().hex[:16], 'name': (name or kind.capitalize()).strip()[:120], 'kind': kind}
    _write_atomic(os.path.join(brushes_dir(), entry['id'] + '.png'), data)
    _change_brushes(lambda lib: lib['images'].append(entry))
    return entry


def brush_image(image_id):
    if not ID_RE.match(image_id or ''):
        raise FileNotFoundError(image_id)
    with open(os.path.join(brushes_dir(), image_id + '.png'), 'rb') as f:
        return f.read()


def delete_brush_image(image_id):
    if not ID_RE.match(image_id or ''):
        raise FileNotFoundError(image_id)
    _change_brushes(lambda lib: lib.update(images=[i for i in lib['images'] if i['id'] != image_id]))
    try:
        os.remove(os.path.join(brushes_dir(), image_id + '.png'))
    except FileNotFoundError:
        pass
    return {'ok': True}


def save_presets(presets):
    if not isinstance(presets, list) or len(presets) > MAX_PRESETS or not all(isinstance(p, dict) for p in presets):
        raise ValueError('Brushes must be a list.')
    _change_brushes(lambda lib: lib.update(presets=presets))
    return {'ok': True}


def import_brushes(name, data):
    """The brushes in a Procreate or Photoshop brush file (brushimport.py)."""
    import brushimport
    return brushimport.import_brushes(name, data)


# ---------- reference pictures ----------
# Pictures shown in the Reference window, kept in <app dir>/references as <id>__<name>.<ext>, oldest first.

REF_TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif', 'bmp': 'image/bmp'}
REF_RE = re.compile(r'^([0-9a-f]{16})__(.{0,80})\.(png|jpg|webp|gif|bmp)$')
MAX_REF = 60 * 1024 * 1024


def refs_dir():
    return os.path.join(app_dir(), 'references')


def _ref_kind(data):
    """The picture type from the file's first bytes, or None for anything else."""
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'jpg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:2] == b'BM':
        return 'bmp'
    return None


def _ref_files():
    try:
        names = os.listdir(refs_dir())
    except FileNotFoundError:
        return []
    out = []
    for n in names:
        m = REF_RE.match(n)
        if m:
            out.append((os.path.getmtime(os.path.join(refs_dir(), n)), m.group(1), m.group(2), n))
    return sorted(out)


def list_refs():
    return [{'id': i, 'name': name} for _, i, name, _ in _ref_files()]


_last_ref_us = 0


def _ref_id():
    """A new reference id that sorts after every earlier one (microseconds, then a little randomness): pictures
    added within one file-time tick still list in the order they were added."""
    global _last_ref_us
    us = _last_ref_us = max(time.time_ns() // 1000, _last_ref_us + 1)
    return f'{us:013x}{uuid.uuid4().hex[:3]}'


def add_ref(name, data):
    kind = _ref_kind(data or b'')
    if not kind:
        raise ValueError('That is not a picture KoeStudio can show (PNG, JPEG, WebP, GIF or BMP).')
    if len(data) > MAX_REF:
        raise ValueError('That picture is too big.')
    base = re.split(r'[\\/]', name or '')[-1]  # a file name, never a path
    safe = re.sub(r'[^\w .()-]', '_', os.path.splitext(base)[0]).strip()[:80] or 'Reference'
    entry = {'id': _ref_id(), 'name': safe}
    _write_atomic(os.path.join(refs_dir(), f"{entry['id']}__{safe}.{kind}"), data)
    return entry


def _ref_file(ref_id):
    if not ID_RE.match(ref_id or ''):
        raise FileNotFoundError(ref_id)
    for _, i, _, n in _ref_files():
        if i == ref_id:
            return n
    raise FileNotFoundError(ref_id)


def ref_image(ref_id):
    n = _ref_file(ref_id)
    with open(os.path.join(refs_dir(), n), 'rb') as f:
        return f.read(), REF_TYPES[n.rsplit('.', 1)[1]]


def delete_ref(ref_id):
    os.remove(os.path.join(refs_dir(), _ref_file(ref_id)))
    return {'ok': True}


# ---------- window position and size ----------
# Kept in <app dir>/window.json as {x, y, width, height, maximized}, in logical pixels (as pywebview takes them).
# For a maximized window, x/y/width/height are its normal (restored) placement, so un-maximizing goes back there.

WINDOW_DEFAULT = {'width': 1500, 'height': 950}
WINDOW_MIN = (1000, 650)
VISIBLE_PX = 120  # this much of the window's top edge must be on a screen, or it opens centred instead


def _window_state_path():
    return os.path.join(app_dir(), 'window.json')


def window_options(raw, screens):
    """create_window arguments from a saved state: sizes kept within the minimum and the largest screen, and the
    position dropped (centred) when the window's top edge would not be reachable on any screen now (a monitor that
    has been unplugged, a changed layout). screens: [(x, y, width, height)] in logical pixels."""
    out = {**WINDOW_DEFAULT, 'maximized': False}
    if not isinstance(raw, dict):
        return out
    num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 100000 else None
    max_w = max((s[2] for s in screens), default=10000)
    max_h = max((s[3] for s in screens), default=10000)
    w, h = num(raw.get('width')), num(raw.get('height'))
    if w is not None and h is not None:
        out['width'] = int(min(max(w, WINDOW_MIN[0]), max_w))
        out['height'] = int(min(max(h, WINDOW_MIN[1]), max_h))
    x, y = num(raw.get('x')), num(raw.get('y'))
    if x is not None and y is not None:
        x, y = int(x), int(y)
        for sx, sy, sw, sh in screens:
            overlap = min(x + out['width'], sx + sw) - max(x, sx)
            if overlap >= min(VISIBLE_PX, out['width']) and sy <= y < sy + sh - 40:
                out['x'], out['y'] = x, y
                break
    out['maximized'] = raw.get('maximized') is True
    return out


def load_window_options(screens):
    try:
        with open(_window_state_path(), encoding='utf-8') as f:
            raw = json.load(f)
    except (OSError, ValueError):
        raw = None
    return window_options(raw, screens)


def window_placement(window):
    """The window's normal placement and whether it is maximized, from Windows itself (GetWindowPlacement gives the
    restored rectangle even while maximized or minimized), in logical pixels. None when it cannot be read."""
    if sys.platform != 'win32':
        return None
    import ctypes
    from ctypes import wintypes

    class PLACEMENT(ctypes.Structure):
        _fields_ = [('length', wintypes.UINT), ('flags', wintypes.UINT), ('showCmd', wintypes.UINT),
                    ('ptMin', wintypes.POINT), ('ptMax', wintypes.POINT), ('rcNormal', wintypes.RECT)]
    user32 = ctypes.windll.user32
    hwnd = window.native.Handle.ToInt64()
    p = PLACEMENT()
    p.length = ctypes.sizeof(PLACEMENT)
    if not user32.GetWindowPlacement(wintypes.HWND(hwnd), ctypes.byref(p)):
        return None
    scale = (user32.GetDpiForWindow(wintypes.HWND(hwnd)) or 96) / 96
    maximized = p.showCmd == 3 or (p.showCmd == 2 and p.flags & 2)  # SW_SHOWMAXIMIZED, or minimized from maximized
    r = p.rcNormal
    if p.showCmd == 1:  # normal: the real window rectangle (rcNormal is in work-area coordinates)
        r = wintypes.RECT()
        user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(r))
    else:  # work-area coordinates: add the offset of the work area (a taskbar at the top or left)
        mon = user32.MonitorFromRect(ctypes.byref(r), 2)

        class MONITORINFO(ctypes.Structure):
            _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT), ('rcWork', wintypes.RECT), ('dwFlags', wintypes.DWORD)]
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(mon, ctypes.byref(mi)):
            dx, dy = mi.rcWork.left - mi.rcMonitor.left, mi.rcWork.top - mi.rcMonitor.top
            r = wintypes.RECT(r.left + dx, r.top + dy, r.right + dx, r.bottom + dy)
    return {'x': round(r.left / scale), 'y': round(r.top / scale), 'width': round((r.right - r.left) / scale),
            'height': round((r.bottom - r.top) / scale), 'maximized': bool(maximized)}


def save_window_state(window):
    try:
        state = window_placement(window)
        if state:
            _write_atomic(_window_state_path(), json.dumps(state).encode('utf-8'))
    except Exception:
        log_error('Could not remember the window position:\n' + traceback.format_exc())


def close_after_flush(window, timeout=20):
    """Lets the page save pending work before the window goes (artwork saves 0.8 s after the last change, and a big
    canvas takes seconds to encode). Runs off the GUI thread, since the page can only be asked from there."""
    try:
        window.evaluate_js('window.koeFlushStart ? window.koeFlushStart() : 0')
        end = time.time() + timeout
        while time.time() < end and window.evaluate_js('window.koeFlushState') == 'pending':
            time.sleep(0.1)
    except Exception:
        log_error('Saving before closing failed:\n' + traceback.format_exc())
    finally:
        window.destroy()


def main():
    port = int(os.environ.get('KOE_PORT') or 8770)
    for p in range(port, port + 20):
        try:
            srv = start_server(p)
            port = p
            break
        except OSError:
            continue
    PENDING_OPEN.extend(project_args(sys.argv))
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
    hidden = '--hidden' in sys.argv
    try:
        try:
            screens = [(s.x, s.y, s.width, s.height) for s in webview.screens]
        except Exception:
            screens = []
        # opens where and as big as it was last closed (window.json in the app folder)
        win = webview.create_window(APP_NAME, url, **load_window_options(screens), min_size=WINDOW_MIN,
                                    hidden=hidden, background_color='#1e1f24')
        closing = []

        def on_closing():
            # the first close request waits for the page to save; the one from destroy() goes through
            if closing:
                return None
            closing.append(True)
            if not hidden:  # a test window never moves the user's own
                save_window_state(win)
            threading.Thread(target=close_after_flush, args=(win,), daemon=True).start()
            return False
        win.events.closing += on_closing
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
