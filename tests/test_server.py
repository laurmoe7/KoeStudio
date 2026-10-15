"""Server tests: artwork storage and HTTP routes. Uses a temp folder; never touches the real Pictures\\KoeStudio."""
import base64
import http.client
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
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
        self.assertEqual(len(os.listdir(os.path.join(self.tmp.name, '.deleted'))), 2, 'file and thumbnail kept in .deleted')
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, '.thumbs', aid + '.json')))

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

    def test_export_project_file(self):
        data = json.dumps(doc('Proj')).encode()
        path = app.export_image('Proj', data, 'koe')['path']
        self.assertEqual(os.path.basename(path), 'Proj.koe')
        with self.assertRaises(ValueError):
            app.export_image('x', b'{"a": 1}', 'koe')

    def test_export_other_formats(self):
        samples = {'gif': b'GIF89a....', 'bmp': b'BM....', 'jpg': b'\xff\xd8\xff....',
                   'webp': b'RIFF\x00\x00\x00\x00WEBPVP8 ', 'tga': b'\x00' * 18 + b'TRUEVISION-XFILE.\x00'}
        for fmt, data in samples.items():
            path = app.export_image('pic', data, fmt)['path']
            self.assertEqual(os.path.basename(path), f'pic.{fmt}')
            with open(path, 'rb') as f:
                self.assertEqual(f.read(), data)
        with self.assertRaises(ValueError):
            app.export_image('x', b'GIF89a', 'bmp')
        with self.assertRaises(ValueError):
            app.export_image('x', b'GIF89a', 'exe')


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
        self.assertEqual(r.getheader('Cache-Control'), 'no-store')

    def test_save_roundtrip(self):
        status, data, _ = self.req('POST', '/api/art/save?id=', json.dumps(doc()), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        aid = json.loads(data)['id']
        status, data, _ = self.req('GET', '/api/art/file?id=' + aid)
        self.assertEqual(json.loads(data)['title'], 'Test')
        status, data, _ = self.req('GET', '/api/art/thumb?id=' + aid)
        self.assertEqual(data, PNG)

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
