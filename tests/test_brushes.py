"""Brush library storage and the Clip Studio Paint brush (.sut) reader. Builds small .sut-shaped databases in a temp
folder; expected values worked out by hand from the numbers put in."""
import base64
import json
import os
import sqlite3
import struct
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import app  # noqa: E402
import sutbrush  # noqa: E402

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')


def effector(enabled, pressure_min=0, random_min=0, curve=None):
    head = struct.pack('>11i', 44, 0x1f0, enabled, pressure_min, 0, 0, random_min, 0, 60, 0, 100)
    if curve:
        head += struct.pack('>3i', 12, len(curve), 16) + b''.join(struct.pack('>2d', x, y) for x, y in curve)
    return head


def material(*names):
    items = b''
    for i, name in enumerate(names):
        path, n = f'.:{i}:data:material_0.layer'.encode('utf-16-le'), name.encode('utf-16-le')
        body = struct.pack('>I', len(path)) + path + struct.pack('>2I', 2, len(n)) + n + struct.pack('>2I', 1, 0) + b'\0\0\0\0'
        items += struct.pack('>I', len(body) + 4) + body
    return struct.pack('>2I', 8, len(names)) + items


COLS = ('BrushSize BrushSizeUnit Opacity BrushFlow BrushHardness BrushInterval BrushUsePatternImage BrushPatternImageArray '
        'BrushThickness BrushVerticalThicknes BrushRotation BrushRotationEffector BrushRotationRandomScale BrushSizeEffector '
        'BrushFlowEffector BrushOpacityEffector TextureImage TextureDensity TextureScale2 TextureReverseDensity UseDualBrush BrushUseIn').split()


def make_sut(path, node_variant=7, **values):
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE Node (_PW_ID INTEGER PRIMARY KEY, NodeName TEXT, NodeVariantID INTEGER, NodeCustomIcon BLOB)')
    db.execute(f'CREATE TABLE Variant (_PW_ID INTEGER PRIMARY KEY, VariantID INTEGER, {", ".join(COLS)})')
    db.execute('INSERT INTO Node (NodeName, NodeVariantID, NodeCustomIcon) VALUES (?, ?, ?)', ('Nib ® Pencil', node_variant, PNG))
    db.execute(f'INSERT INTO Variant (VariantID, {", ".join(values)}) VALUES (7, {", ".join("?" * len(values))})', list(values.values()))
    db.commit()
    db.close()
    with open(path, 'rb') as f:
        return f.read()


class SutReader(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, 'b.sut')

    def tearDown(self):
        self.tmp.cleanup()

    def test_effector(self):
        e = sutbrush.effector(effector(0x10 | 0x80, 40, 20, [(0, 0), (0.5, 0.25), (1, 1)]))
        self.assertEqual(e, {'pressure': True, 'tilt': False, 'velocity': False, 'random': True, 'pressureMin': 0.4,
                             'randomMin': 0.2, 'curve': [[0, 0], [0.5, 0.25], [1, 1]]})
        self.assertIsNone(sutbrush.effector(b'\0' * 10))
        self.assertIsNone(sutbrush.effector(None))
        self.assertIsNone(sutbrush.effector(effector(0x10))['curve'], 'no curve stored')
        self.assertTrue(sutbrush.straight([[0, 0], [0.5, 0.5], [1, 1]]))
        self.assertFalse(sutbrush.straight([[0, 0], [0.5, 0.3], [1, 1]]))

    def test_material_names(self):
        self.assertEqual(sutbrush.material_names(material('pencilNib01', 'Grainy ® Surface')), ['pencilNib01', 'Grainy ® Surface'])
        self.assertEqual(sutbrush.material_names(b'\0\0\0\x08\0\0\0\x01\0\0'), [], 'cut short')
        self.assertEqual(sutbrush.material_names(None), [])

    def test_brush(self):
        data = make_sut(self.path, BrushSize=2000.0, BrushSizeUnit=0, Opacity=80, BrushFlow=50, BrushHardness=100, BrushInterval=25.0,
                        BrushUsePatternImage=1, BrushPatternImageArray=material('nibA', 'nibB'), BrushThickness=50,
                        BrushVerticalThicknes=0, BrushRotation=30.0, BrushRotationEffector=0x81, BrushRotationRandomScale=20,
                        BrushSizeEffector=effector(0x10 | 0x80, 40, 0, [(0, 0), (0.5, 0.25), (1, 1)]),
                        BrushFlowEffector=effector(0, 10, 0, [(0, 0), (1, 1)]), BrushOpacityEffector=effector(0),
                        TextureImage=material('Paper'), TextureDensity=30, TextureScale2=200.0, TextureReverseDensity=1,
                        UseDualBrush=1, BrushUseIn=0)
        res = sutbrush.brush_from_sut(data)
        self.assertEqual(res['name'], 'Nib ® Pencil')
        self.assertEqual(res['tips'], ['nibA', 'nibB'])
        self.assertEqual(res['texture'], 'Paper')
        self.assertEqual(res['icon'], PNG)
        self.assertEqual(res['settings'], {
            'size': 1000, 'opacity': 0.8, 'flow': 0.5, 'hardness': 1, 'spacing': 0.25,
            'thickness': 0.5, 'tipAngle': 120, 'tipRandom': 0.2, 'tipFollow': True,  # squashed sideways: +90 degrees
            'pressureSize': True, 'minSize': 0.4, 'sizeCurve': [[0, 0], [0.5, 0.25], [1, 1]],
            'pressureOpacity': False, 'minFlow': 0.1, 'flowCurve': None, 'gamma': 1,
            'textureAmount': 0.3, 'textureScale': 2, 'textureInvert': True})
        self.assertEqual(res['notes'], ['It switches between 2 tip images; KoeStudio uses one', 'Size changing with randomness', 'Dual brush'])

    def test_not_a_brush(self):
        with self.assertRaisesRegex(ValueError, 'not a Clip Studio Paint brush'):
            sutbrush.brush_from_sut(b'PK\3\4 not sqlite')
        data = make_sut(self.path, node_variant=99, BrushSize=10.0)
        with self.assertRaisesRegex(ValueError, 'not a brush'):
            sutbrush.brush_from_sut(data)


class Library(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['KOE_APP_DIR'] = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop('KOE_APP_DIR', None)

    def test_images_and_presets(self):
        self.assertEqual(app.load_brushes(), {'images': [], 'presets': []})
        e = app.add_brush_image('tip', '  Nib  ', PNG)
        self.assertEqual((e['name'], e['kind']), ('Nib', 'tip'))
        self.assertEqual(app.brush_image(e['id']), PNG)
        app.save_presets([{'id': 'ab', 'name': 'Pencil', 'settings': {'size': 4}}])
        lib = app.load_brushes()
        self.assertEqual(lib['images'], [e])
        self.assertEqual(lib['presets'][0]['name'], 'Pencil')
        app.delete_brush_image(e['id'])
        self.assertEqual(app.load_brushes()['images'], [])
        self.assertEqual(len(app.load_brushes()['presets']), 1, 'presets stay')
        with self.assertRaises(FileNotFoundError):
            app.brush_image(e['id'])

    def test_simultaneous_adds_keep_every_image(self):
        import threading
        errors = []

        def add(i):
            try:
                app.add_brush_image('tip', f'T{i}', PNG)
            except Exception as e:  # noqa: BLE001 - reported below
                errors.append(e)
        threads = [threading.Thread(target=add, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(sorted(i['name'] for i in app.load_brushes()['images']), [f'T{i}' for i in range(8)])

    def test_unreadable_index_is_not_overwritten(self):
        os.makedirs(app.brushes_dir())
        path = os.path.join(app.brushes_dir(), 'brushes.json')
        with open(path, 'w', encoding='utf-8') as f:
            f.write('{"images": [], "presets": [{"name": "keep"')  # cut short
        with self.assertRaises(OSError):
            app.save_presets([])
        with open(path, encoding='utf-8') as f:
            self.assertIn('keep', f.read())
        self.assertEqual(app.load_brushes(), {'images': [], 'presets': []}, 'reading alone still works')

    def test_refuses_bad_input(self):
        with self.assertRaisesRegex(ValueError, 'PNG'):
            app.add_brush_image('tip', 'x', b'GIF89a')
        with self.assertRaisesRegex(ValueError, 'kind'):
            app.add_brush_image('stamp', 'x', PNG)
        with self.assertRaises(ValueError):
            app.save_presets({'not': 'a list'})
        with self.assertRaises(FileNotFoundError):
            app.brush_image('../brushes')

    def test_import_gives_icon_as_data_url(self):
        data = make_sut(os.path.join(self.tmp.name, 'b.sut'), BrushSize=10.0)
        res = app.import_sut(data)
        self.assertTrue(res['icon'].startswith('data:image/png;base64,'))
        self.assertEqual(json.loads(json.dumps(res))['settings']['size'], 10)


if __name__ == '__main__':
    unittest.main()
