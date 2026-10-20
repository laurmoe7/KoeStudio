"""Server tests: artwork storage and HTTP routes. Uses a temp folder; never touches the real Pictures\\KoeStudio."""
import base64
import http.client
import hashlib
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
# the app folder (error.log, brushes) is a temp one for the whole run: never the user's %LOCALAPPDATA%\KoeStudio
_APP_DIR = tempfile.TemporaryDirectory()
os.environ['KOE_APP_DIR'] = _APP_DIR.name
import app  # noqa: E402

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
PNG_URL = 'data:image/png;base64,' + base64.b64encode(PNG).decode()


def doc(title='Test'):
    return {'format': 'koe', 'version': 1, 'title': title, 'width': 10, 'height': 10, 'paper': '#ffffff', 'active': 0,
            'layers': [{'name': 'Layer 1', 'png': PNG_URL}], 'thumb': PNG_URL}


class Storage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['KOE_ART_DIR'] = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop('KOE_ART_DIR', None)

    def test_save_list_load_delete(self):
        res = app.save_art('', doc('First'))
        aid = res['id']
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, aid + '.koe')))
        self.assertEqual(app.read_thumb(aid), PNG)
        self.assertEqual([a['title'] for a in app.list_art()], ['First'])
        self.assertNotIn('thumb', app.load_art(aid), 'the thumbnail is stored apart from the document')
        app.save_art(aid, doc('Renamed'))
        self.assertEqual(app.load_art(aid)['title'], 'Renamed')
        app.delete_art(aid)
        self.assertEqual(app.list_art(), [])
        self.assertEqual(len(os.listdir(os.path.join(self.tmp.name, '.deleted'))), 3, 'file, thumbnail and details kept in .deleted')
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, '.thumbs', aid + '.json')), 'details moved along')

    def test_timelapse_frames_follow_the_artwork(self):
        aid = app.save_art('', doc('Timelapse'))['id']
        jpeg = b'\xff\xd8\xff\xe0' + b'x' * 20
        self.assertEqual(app.timelapse_count(aid), 0)
        self.assertEqual(app.add_timelapse_frame(aid, jpeg), {'frames': 1})
        self.assertEqual(app.add_timelapse_frame(aid, jpeg + b'2'), {'frames': 2})
        self.assertEqual(app.timelapse_frame(aid, 1), jpeg + b'2')
        with self.assertRaises(ValueError):
            app.add_timelapse_frame(aid, PNG)  # only JPEG
        with self.assertRaises(ValueError):
            app.timelapse_frame(aid, -1)
        with self.assertRaises(ValueError):
            app.timelapse_count('../x')
        # deleted with the artwork, back when it is restored
        app.delete_art(aid)
        self.assertEqual(app.timelapse_count(aid), 0)
        name = app.list_deleted()[0]['name']
        self.assertEqual(app.restore_deleted(name)['id'], aid)
        self.assertEqual(app.timelapse_count(aid), 2)
        self.assertEqual(app.clear_timelapse(aid), {'frames': 0})
        self.assertEqual(app.timelapse_count(aid), 0)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, '.timelapse', aid)))

    def test_saves_may_send_only_changed_layers(self):
        app.SAVE_CACHE.clear()
        a, b = PNG_URL, 'data:image/png;base64,' + 'B' * 8
        ka, kb = app.pic_key(a), app.pic_key(b)
        self.assertEqual(kb, hashlib.sha1(b.encode()).hexdigest())
        first = doc('Delta')
        first['layers'] = [{'name': 'A', 'png': a, 'mask': {'enabled': True, 'png': b}},
                           {'type': 'folder', 'name': 'F', 'children': [{'name': 'B', 'png': b}]}]
        aid = app.save_art('', first)['id']
        self.assertEqual(set(app.SAVE_CACHE[aid]), {ka, kb})
        # the next save sends refs for what did not change and a new picture for B
        def second():
            d = doc('Delta')
            d['layers'] = [{'name': 'A', 'png': 'ref:' + ka, 'mask': {'enabled': True, 'png': 'ref:' + kb}},
                           {'type': 'folder', 'name': 'F', 'children': [{'name': 'B', 'png': a}]}]
            return d
        app.save_art(aid, second())
        saved = app.load_art(aid)
        self.assertEqual(saved['layers'][0]['png'], a, 'refs filled in from the last save')
        self.assertEqual(saved['layers'][0]['mask']['png'], b)
        self.assertEqual(saved['layers'][1]['children'][0]['png'], a)
        self.assertEqual(set(app.SAVE_CACHE[aid]), {ka, kb}, 'what the last save holds')
        # a ref to a picture the server does not have fails without touching the file
        third = doc('Gone')
        third['layers'] = [{'name': 'B', 'png': 'ref:' + app.pic_key('data:image/png;base64,CC')}]
        with self.assertRaises(app.MissingLayers):
            app.save_art(aid, third)
        self.assertEqual(app.load_art(aid)['title'], 'Delta')
        app.SAVE_CACHE.clear()  # the server restarted
        with self.assertRaises(app.MissingLayers):
            app.save_art(aid, second())
        # opening it in the editor remembers its pictures again
        app.load_for_editing(aid)
        app.save_art(aid, second())
        self.assertEqual(app.load_art(aid)['layers'][0]['png'], a)

    def test_listing_uses_saved_metadata_instead_of_parsing_artwork(self):
        aid = app.save_art('', doc('Quick'))['id']
        path = os.path.join(self.tmp.name, aid + '.koe')
        stamp = os.stat(path)
        with open(path, 'w') as f:  # unreadable as JSON, but with the old modification time
            f.write('not json at all')
        os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        self.assertEqual([(a['title'], a['width'], a['layers']) for a in app.list_art()], [('Quick', 10, 1)])

    def test_metadata_is_made_for_old_artwork_and_refreshed_when_the_file_changes(self):
        aid = app.save_art('', doc('Old'))['id']
        meta = os.path.join(self.tmp.name, '.thumbs', aid + '.json')
        os.remove(meta)  # artwork saved by an earlier version has none
        self.assertEqual(app.list_art()[0]['title'], 'Old')
        self.assertTrue(os.path.exists(meta), 'listing made it')
        path = os.path.join(self.tmp.name, aid + '.koe')
        d = doc('Changed'); d.pop('thumb')
        with open(path, 'w') as f:
            json.dump(d, f)
        later = os.path.getmtime(meta) + 5
        os.utime(path, (later, later))  # the artwork is newer than its metadata
        self.assertEqual(app.list_art()[0]['title'], 'Changed')

    def test_backups_are_spaced_and_limited(self):
        aid = app.save_art('', doc('v1'))['id']
        self.assertEqual(app.list_backups(aid), [], 'nothing to back up on the first save')
        app.save_art(aid, doc('v2'))
        self.assertEqual(len(app.list_backups(aid)), 1)
        self.assertEqual(app.load_backup(aid, app.list_backups(aid)[0]['name'])['title'], 'v1', 'the replaced version')
        app.save_art(aid, doc('v3'))
        self.assertEqual(len(app.list_backups(aid)), 1, 'no second backup within BACKUP_EVERY')
        path = os.path.join(self.tmp.name, aid + '.koe')
        start = app.list_backups(aid)[0]['kept']
        for i in range(1, 8):  # each "save" an hour after the last
            app._keep_backup(aid, path, now=start + i * 3600)
        kept = app.list_backups(aid)
        self.assertEqual(len(kept), app.BACKUP_KEEP)
        self.assertEqual(kept[0]['kept'], start + 7 * 3600, 'newest first, oldest dropped')
        self.assertEqual(app.load_art(aid)['title'], 'v3', 'the artwork itself is untouched')
        with self.assertRaises(ValueError):
            app.load_backup(aid, '../' + kept[0]['name'])
        with self.assertRaises(ValueError):
            app.load_backup('abcdef1234', kept[0]['name'])

    def test_restore_deleted(self):
        aid = app.save_art('', doc('Gone'))['id']
        app.delete_art(aid)
        gone = app.list_deleted()
        self.assertEqual([(g['title'], g['layers']) for g in gone], [('Gone', 1)])
        self.assertEqual(app.deleted_thumb(gone[0]['name']), PNG)
        self.assertEqual(app.restore_deleted(gone[0]['name'])['id'], aid)
        self.assertEqual([a['title'] for a in app.list_art()], ['Gone'])
        self.assertEqual(app.read_thumb(aid), PNG)
        self.assertEqual(app.list_deleted(), [])
        # restored again after its id was reused: gets a new one
        app.delete_art(aid)
        name = app.list_deleted()[0]['name']
        app.save_art(aid, doc('Newer'))
        new_id = app.restore_deleted(name)['id']
        self.assertNotEqual(new_id, aid)
        self.assertEqual(sorted(a['title'] for a in app.list_art()), ['Gone', 'Newer'])
        with self.assertRaises(ValueError):
            app.restore_deleted('../x.koe')

    def test_rename_and_duplicate(self):
        aid = app.save_art('', doc('Orig'))['id']
        app.rename_art(aid, '  New name ')
        self.assertEqual(app.load_art(aid)['title'], 'New name')
        self.assertEqual(app.list_art()[0]['title'], 'New name', 'gallery details follow')
        with self.assertRaises(ValueError):
            app.rename_art(aid, '   ')
        copy = app.duplicate_art(aid)['id']
        self.assertEqual(app.load_art(copy)['title'], 'New name copy')
        self.assertEqual(app.read_thumb(copy), PNG)
        self.assertEqual(len(app.list_art()), 2)

    def test_layer_count_includes_folders(self):
        d = doc()
        d['layers'] = [{'type': 'layer'}, {'type': 'folder', 'children': [{'type': 'layer'}, {'type': 'folder', 'children': [{}]}]}]
        app.save_art('', d)
        self.assertEqual(app.list_art()[0]['layers'], 3, 'one at the top, one in the folder, one in the inner folder')

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            app.load_art('../../secret')
        with self.assertRaises(ValueError):
            app.save_art('', {'format': 'other'})

    def test_export_never_overwrites(self):
        a = app.export_png('My: pic?', PNG)['path']
        b = app.export_png('My: pic?', PNG)['path']
        self.assertEqual(os.path.basename(a), 'My pic.png')
        self.assertEqual(os.path.basename(b), 'My pic (2).png')
        with self.assertRaises(ValueError):
            app.export_png('x', b'not a png')

    def test_project_file_from_command_line(self):
        path = os.path.join(self.tmp.name, 'My Picture.koe')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({**doc('Untitled'), 'title': 'Untitled'}, f)
        junk = os.path.join(self.tmp.name, 'junk.koe')
        with open(junk, 'w') as f:
            f.write('not json')
        self.assertEqual(app.project_args(['app.py', '--hidden', path, 'missing.koe', 'x.png']), [path])
        app.PENDING_OPEN[:] = [junk, path]
        got = app.take_open_file()
        self.assertEqual(got['title'], 'My Picture', 'an untitled project takes its file name')
        self.assertIsNone(app.take_open_file(), 'handed out once')

    def test_export_to_a_chosen_folder(self):
        other = os.path.join(self.tmp.name, 'Elsewhere')
        os.mkdir(other)
        res = app.export_image('pic', PNG, 'png', other)
        self.assertEqual(res, {'path': os.path.join(other, 'pic.png'), 'folder': other})
        with self.assertRaises(FileExistsError):
            app.export_image('pic', PNG, 'png', other, 'ask')
        bigger = PNG + b'more'
        self.assertEqual(app.export_image('pic', bigger, 'png', other, 'replace')['path'], os.path.join(other, 'pic.png'))
        with open(os.path.join(other, 'pic.png'), 'rb') as f:
            self.assertEqual(f.read(), bigger, 'replaced')
        self.assertTrue(app.export_image('pic', PNG, 'png', other)['path'].endswith('pic (2).png'), 'numbered by default')
        with self.assertRaises(ValueError):
            app.export_image('pic', PNG, 'png', os.path.join(self.tmp.name, 'missing'))

    def test_folder_listing_and_new_folder(self):
        root = os.path.join(self.tmp.name, 'Browse')
        os.mkdir(root)
        for name in ('b.png', 'A.koe', 'notes.txt', '.hidden.png'):
            with open(os.path.join(root, name), 'wb') as f:
                f.write(b'x')
        os.mkdir(os.path.join(root, 'zeta'))
        os.mkdir(os.path.join(root, '.secret'))
        self.assertEqual(app.make_dir(root, 'Alpha: new?')['path'], os.path.join(root, 'Alpha new'))
        with self.assertRaises(FileExistsError):
            app.make_dir(root, 'zeta')
        got = app.list_dir(root)
        self.assertEqual(got['path'], root)
        self.assertEqual(got['parent'], self.tmp.name)
        self.assertEqual(got['dirs'], ['Alpha new', 'zeta'], 'hidden folders left out, sorted')
        self.assertEqual([f['name'] for f in got['files']], ['A.koe', 'b.png'], 'only pictures and projects')
        self.assertIn('Exports', [p['name'] for p in got['places']])
        self.assertEqual(app.list_dir('')['path'], app.exports_dir(), 'empty path: the Exports folder (made if missing)')
        top = app.list_dir(os.path.splitdrive(root)[0] + os.sep if os.name == 'nt' else '/')
        self.assertIsNone(top['parent'], 'a drive root has no parent')
        with self.assertRaises(FileNotFoundError):
            app.list_dir(os.path.join(root, 'nope'))

    def test_export_project_file(self):
        data = json.dumps(doc('Proj')).encode()
        path = app.export_image('Proj', data, 'koe')['path']
        self.assertEqual(os.path.basename(path), 'Proj.koe')
        with self.assertRaises(ValueError):
            app.export_image('x', b'{"a": 1}', 'koe')

    def test_export_other_formats(self):
        samples = {'gif': b'GIF89a....', 'bmp': b'BM....', 'jpg': b'\xff\xd8\xff....',
                   'webp': b'RIFF\x00\x00\x00\x00WEBPVP8 ', 'tga': b'\x00' * 18 + b'TRUEVISION-XFILE.\x00',
                   'gpl': b'GIMP Palette\nName: x\n', 'webm': b'\x1a\x45\xdf\xa3\x9f'}
        for fmt, data in samples.items():
            path = app.export_image('pic', data, fmt)['path']
            self.assertEqual(os.path.basename(path), f'pic.{fmt}')
            with open(path, 'rb') as f:
                self.assertEqual(f.read(), data)
        with self.assertRaises(ValueError):
            app.export_image('x', b'GIF89a', 'bmp')
        with self.assertRaises(ValueError):
            app.export_image('x', b'GIF89a', 'exe')


class WindowState(unittest.TestCase):
    SCREENS = [(0, 0, 1920, 1080), (1920, 0, 1280, 1024)]  # two monitors side by side

    def test_defaults_without_a_saved_state(self):
        self.assertEqual(app.window_options(None, self.SCREENS), {'width': 1500, 'height': 950, 'maximized': False})
        self.assertEqual(app.window_options({'width': 'big'}, self.SCREENS)['width'], 1500)

    def test_position_and_size_come_back(self):
        got = app.window_options({'x': 2000, 'y': 40, 'width': 1100, 'height': 800, 'maximized': True}, self.SCREENS)
        self.assertEqual(got, {'x': 2000, 'y': 40, 'width': 1100, 'height': 800, 'maximized': True}, 'on the second monitor')

    def test_sizes_kept_within_minimum_and_screen(self):
        got = app.window_options({'width': 300, 'height': 5000}, self.SCREENS)
        self.assertEqual((got['width'], got['height']), (1000, 1080))

    def test_off_screen_window_is_centred(self):
        gone = app.window_options({'x': 3300, 'y': 100, 'width': 1200, 'height': 800}, self.SCREENS)
        self.assertNotIn('x', gone, 'its monitor was unplugged')
        self.assertNotIn('x', app.window_options({'x': 100, 'y': -500, 'width': 1200, 'height': 800}, self.SCREENS),
                         'title bar above every screen')
        self.assertNotIn('x', app.window_options({'x': 1850, 'y': 1050, 'width': 1200, 'height': 800}, self.SCREENS),
                         'only a sliver at the bottom edge')
        edge = app.window_options({'x': -1000, 'y': 10, 'width': 1200, 'height': 800}, self.SCREENS)
        self.assertEqual(edge['x'], -1000, '200 px still showing is enough to grab it')
        self.assertNotIn('x', app.window_options({'x': -1100, 'y': 10, 'width': 1200, 'height': 800}, self.SCREENS))


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ['KOE_ART_DIR'] = cls.tmp.name
        cls.srv = app.start_server(0)
        cls.port = cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()
        os.environ.pop('KOE_ART_DIR', None)

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data, r

    def test_index_and_config(self):
        status, data, r = self.req('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'KoeStudio', data)
        self.assertEqual(r.getheader('Cache-Control'), 'no-cache', 'UI files revalidate, so edits show after a reload')
        status, data, r = self.req('GET', '/api/config')
        self.assertEqual(json.loads(data)['artDir'], self.tmp.name)
        self.assertIn('build', json.loads(data))
        self.assertEqual(r.getheader('Cache-Control'), 'no-store')

    def test_build_info(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(app.build_info(d), {'build': '', 'buildDate': ''}, 'not a git checkout')
            os.makedirs(os.path.join(d, '.git', 'refs', 'heads'))
            with open(os.path.join(d, '.git', 'HEAD'), 'w') as f:
                f.write('ref: refs/heads/main\n')
            with open(os.path.join(d, '.git', 'refs', 'heads', 'main'), 'w') as f:
                f.write('84a27d5f00000000000000000000000000000000\n')
            self.assertEqual(app.build_info(d)['build'], '84a27d5')
            os.remove(os.path.join(d, '.git', 'refs', 'heads', 'main'))
            with open(os.path.join(d, '.git', 'packed-refs'), 'w') as f:
                f.write('# pack-refs with: peeled\nabcdef1234 refs/heads/main\n')
            self.assertEqual(app.build_info(d)['build'], 'abcdef1', 'packed refs')

    def test_save_roundtrip(self):
        status, data, _ = self.req('POST', '/api/art/save?id=', json.dumps(doc()), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        aid = json.loads(data)['id']
        status, data, _ = self.req('GET', '/api/art/file?id=' + aid)
        self.assertEqual(json.loads(data)['title'], 'Test')
        status, data, _ = self.req('GET', '/api/art/thumb?id=' + aid)
        self.assertEqual(data, PNG)

    def test_save_with_a_missing_ref_answers_409(self):
        body = doc()
        body['layers'] = [{'name': 'A', 'png': 'ref:nobody.1.1'}]
        status, data, _ = self.req('POST', '/api/art/save?id=', json.dumps(body), {'Content-Type': 'application/json'})
        self.assertEqual(status, 409)
        self.assertTrue(json.loads(data)['missing'])

    def test_unread_body_does_not_spoil_the_next_request(self):
        aid = app.save_art('', doc('Keep'))['id']
        c = http.client.HTTPConnection('127.0.0.1', self.port)
        try:  # one kept-alive connection, as the browser uses; duplicate gets a body it does not read
            c.request('POST', '/api/art/duplicate?id=' + aid, body=b'{}', headers={'Content-Type': 'application/json'})
            r = c.getresponse()
            r.read()
            self.assertEqual(r.status, 200)
            c.request('GET', '/api/art')
            r = c.getresponse()
            self.assertEqual(r.status, 200)
            self.assertIn('Keep copy', [a['title'] for a in json.loads(r.read())])
        finally:
            c.close()

    def test_export_asks_before_replacing(self):
        url = '/api/export?name=ask&format=png&mode=ask&dir=' + self.tmp.name.replace('\\', '/')
        status, _, _ = self.req('POST', url, PNG)
        self.assertEqual(status, 200)
        status, data, _ = self.req('POST', url, PNG)
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(data), {'error': 'ask.png already exists', 'exists': True})

    def test_refuses_other_sites(self):
        status, _, _ = self.req('GET', '/api/art', headers={'Host': 'evil.example:80'})
        self.assertEqual(status, 403)
        status, _, _ = self.req('POST', '/api/art/delete?id=abcdef12', b'{}', {'Origin': 'http://evil.example'})
        self.assertEqual(status, 403)
        status, _, _ = self.req('GET', '/api/art', headers={'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(status, 403)

    def test_muted_flag(self):
        os.environ['KOE_MUTE'] = '1'
        try:
            _, data, _ = self.req('GET', '/api/config')
            self.assertTrue(json.loads(data)['muted'])
        finally:
            os.environ.pop('KOE_MUTE')


if __name__ == '__main__':
    unittest.main()


class ReferencePictureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = os.environ.get('KOE_APP_DIR')
        os.environ['KOE_APP_DIR'] = self.tmp.name

    def tearDown(self):
        os.environ['KOE_APP_DIR'] = self.old or _APP_DIR.name
        self.tmp.cleanup()

    def test_add_list_read_delete(self):
        png = b'\x89PNG\r\n\x1a\n' + b'rest'
        a = app.add_ref('C:/pics/Pose: front?.png', png)
        self.assertEqual(a['name'], 'Pose_ front_', 'unsafe characters replaced, extension dropped')
        b = app.add_ref('', b'\xff\xd8\xff\xe0jpeg')
        self.assertEqual([r['id'] for r in app.list_refs()], [a['id'], b['id']])
        self.assertEqual(app.ref_image(b['id']), (b'\xff\xd8\xff\xe0jpeg', 'image/jpeg'))
        with self.assertRaises(ValueError):
            app.add_ref('x.txt', b'hello')
        app.delete_ref(a['id'])
        self.assertEqual([r['id'] for r in app.list_refs()], [b['id']])
        with self.assertRaises(FileNotFoundError):
            app.ref_image('../../etc')

    def test_mixing_pad_is_kept_per_computer(self):
        with self.assertRaises(FileNotFoundError):
            app.mix_pad()
        png = b'\x89PNG\r\n\x1a\n' + b'pad'
        app.save_mix_pad(png)
        self.assertEqual(app.mix_pad(), png)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp.name, 'mixing.png')))
        with self.assertRaises(ValueError):
            app.save_mix_pad(b'\xff\xd8\xff\xe0jpeg')
        self.assertEqual(app.mix_pad(), png, 'a refused picture leaves the old one')
