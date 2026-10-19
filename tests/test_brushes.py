"""Brush library storage and the Procreate / Photoshop brush readers. Builds small brush files byte by byte;
expected values worked out by hand from the numbers put in."""
import io
import json
import os
import plistlib
import struct
import sys
import tempfile
import threading
import unittest
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
# the app folder (error.log, brushes) is a temp one for the whole run: never the user's %LOCALAPPDATA%\KoeStudio
_APP_DIR = tempfile.TemporaryDirectory()
os.environ['KOE_APP_DIR'] = _APP_DIR.name
import app  # noqa: E402
import brushimport as bi  # noqa: E402

PNG = bi.png_bytes(1, 1, b'\x80')


def png_pixels(png):
    """(width, height, colour type, raw pixel bytes) of a PNG written by png_bytes (filter 0 on every row)."""
    pos, idat = 8, b''
    while pos < len(png):
        n, kind = struct.unpack('>I4s', png[pos:pos + 8])
        body = png[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, _, ct = struct.unpack('>2I2B', body[:10])
        elif kind == b'IDAT':
            idat += body
        pos += 12 + n
    raw, bpp = zlib.decompress(idat), 2 if ct == 4 else 1
    rows = [raw[y * (w * bpp + 1):(y + 1) * (w * bpp + 1)] for y in range(h)]
    assert all(r[0] == 0 for r in rows)
    return w, h, ct, b''.join(r[1:] for r in rows)


def from_url(url):
    import base64
    return base64.b64decode(url.split(',', 1)[1])


# ---------- Photoshop file pieces ----------

u16 = lambda n: struct.pack('>H', n)  # noqa: E731
u32 = lambda n: struct.pack('>I', n)  # noqa: E731
i32 = lambda n: struct.pack('>i', n)  # noqa: E731


def ustr(s):
    b = (s + '\0').encode('utf-16-be')
    return u32(len(b) // 2) + b


def pstr(s):
    return bytes([len(s)]) + s.encode('latin-1')


def key(k):
    return u32(0) + k.encode('latin-1') if len(k) == 4 else u32(len(k)) + k.encode('latin-1')


def val(v):
    if isinstance(v, bool):
        return b'bool' + bytes([v])
    if isinstance(v, int):
        return b'long' + i32(v)
    if isinstance(v, float):
        return b'doub' + struct.pack('>d', v)
    if isinstance(v, str):
        return b'TEXT' + ustr(v)
    if isinstance(v, tuple):  # (unit, number)
        return b'UntF' + v[0].encode('latin-1') + struct.pack('>d', v[1])
    if isinstance(v, list):
        return b'VlLs' + u32(len(v)) + b''.join(val(x) for x in v)
    return b'Objc' + desc(v)


def desc(d):
    items = [(k, v) for k, v in d.items() if k != '_class']
    return ustr('') + key(d.get('_class', 'null')) + u32(len(items)) + b''.join(key(k) + val(v) for k, v in items)


def section(kind, body):
    return b'8BIM' + kind + u32(len(body)) + body + bytes(-len(body) % 4)


def padded(body):
    return u32(len(body)) + body + bytes(-len(body) % 4)


def sample(sid, w, h, depth, comp, data):
    return padded(pstr(sid) + bytes(264) + i32(0) + i32(0) + i32(h) + i32(w) + u16(depth) + bytes([comp]) + data)


def gray_pattern(pid, name, w, h, gray):
    chan = u32(8) + u32(0) + u32(0) + u32(h) + u32(w) + u16(8) + b'\0' + gray
    vmal = u32(3) + u32(0) + u32(0) + u32(0) + u32(h) + u32(w) + u32(1) + u32(1) + u32(len(chan)) + chan + u32(0) + u32(0)
    return padded(u32(1) + u32(1) + u16(h) + u16(w) + ustr(name) + pstr(pid) + vmal)


def make_abr():
    # sample $a: 3 x 2, PackBits rows: [0, 0, 9] = repeat 0 twice (0xff) + literal 9 (0x00 0x09); [7, 7, 7] = 0xfe 0x07
    rows = [b'\xff\x00\x00\x09', b'\xfe\x07']
    a = sample('$a', 3, 2, 8, 1, u16(len(rows[0])) + u16(len(rows[1])) + b''.join(rows))
    b = sample('$b', 2, 1, 16, 0, b'\xab\x00\x12\x34')  # 16-bit: the high bytes count
    brushes = [
        {'Nm  ': 'Pencil', 'Brsh': {'_class': 'sampledBrush', 'Dmtr': ('#Pxl', 30.0), 'Spcn': ('#Prc', 15.0), 'Intr': True,
                                    'Angl': ('#Ang', 30.0), 'Rndn': ('#Prc', 50.0), 'sampledData': '$a'},
         'useTipDynamics': True, 'szVr': {'bVTy': 2, 'jitter': ('#Prc', 10.0)}, 'minimumDiameter': ('#Prc', 25.0),
         'angleDynamics': {'bVTy': 6, 'jitter': ('#Prc', 40.0)},
         'usePaintDynamics': True, 'prVr': {'bVTy': 2, 'Mnm ': ('#Prc', 20.0)},
         'useTexture': True, 'Txtr': {'_class': 'Ptrn', 'Nm  ': 'Paper', 'Idnt': '$p'}, 'textureDepth': ('#Prc', 60.0),
         'textureScale': ('#Prc', 200.0), 'InvT': True, 'useScatter': True, 'scatterDynamics': {'bVTy': 0, 'jitter': ('#Prc', 150.0)},
         'toolOptions': {'Opct': ('#Prc', 80.0), 'flow': ('#Prc', 50.0)}},
        {'Nm  ': 'Round', 'Brsh': {'_class': 'computedBrush', 'Dmtr': ('#Pxl', 9.0), 'Hrdn': ('#Prc', 50.0), 'Spcn': ('#Prc', 25.0)}},
        {'Nm  ': 'Wide', 'Brsh': {'_class': 'sampledBrush', 'Dmtr': ('#Pxl', 2.0), 'sampledData': '$b'}},
        {'Nm  ': 'Pencil again', 'Brsh': {'_class': 'sampledBrush', 'Dmtr': ('#Pxl', 3.0), 'sampledData': '$a'}},
        {'Nm  ': 'Chalk', 'Brsh': {'_class': 'computedBrush', 'Dmtr': ('#Pxl', 20.0)}, 'useDualBrush': True,
         'dualBrush': {'_class': 'dualBrush', 'Brsh': {'_class': 'sampledBrush', 'Dmtr': ('#Pxl', 10.0), 'Spcn': ('#Prc', 40.0), 'sampledData': '$b'},
                       'useScatter': True, 'scatterDynamics': {'bVTy': 0, 'jitter': ('#Prc', 80.0)}}},
    ]
    return (u16(6) + u16(2) + section(b'samp', a + b) + section(b'patt', gray_pattern('$p', 'Paper', 2, 2, bytes([10, 20, 30, 40])))
            + section(b'desc', u32(16) + desc({'Brsh': brushes})))


# ---------- Procreate file pieces ----------

def keyed_archive(fields):
    """An NSKeyedArchiver plist whose root object has these fields; strings and numbers go in as references."""
    objs, root = ['$null', None], {'$class': plistlib.UID(2)}
    objs.append({'$classname': 'SilicaBrush', '$classes': ['SilicaBrush', 'NSObject']})
    for k, v in fields.items():
        if isinstance(v, str) or (isinstance(v, float) and k == 'shapeScatter'):
            objs.append(v)
            root[k] = plistlib.UID(len(objs) - 1)
        else:
            root[k] = v
    objs[1] = root
    return plistlib.dumps({'$archiver': 'NSKeyedArchiver', '$version': 100000, '$top': {'root': plistlib.UID(1)}, '$objects': objs},
                          fmt=plistlib.FMT_BINARY)


def make_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


class AbrReader(unittest.TestCase):
    def test_packbits(self):
        self.assertEqual(bi.unpackbits(b'\xff\x00\x00\x09', 3), b'\x00\x00\x09')
        self.assertEqual(bi.unpackbits(b'\x80\xfd\x05', 4), b'\x05\x05\x05\x05', '128 does nothing')
        self.assertEqual(bi.unpackbits(b'\x01\x01', 3), b'\x01\x00\x00', 'short data is padded')

    def test_descriptor_values(self):
        r = bi.Reader(desc({'_class': 'Thing', 'a': 5, 'b': True, 'c': ('#Prc', 12.5), 'd': [1, 'x'], 'e': {'f': 2.5}}))
        self.assertEqual(bi.descriptor(r), {'_class': 'Thing', 'a': 5, 'b': True, 'c': {'unit': '#Prc', 'value': 12.5},
                                            'd': [1, 'x'], 'e': {'_class': 'null', 'f': 2.5}})

    def test_brushes(self):
        res = bi.import_brushes('C:\\brushes\\Sketch set.abr', make_abr())
        self.assertEqual(res['name'], 'Sketch set')
        self.assertEqual([b['name'] for b in res['brushes']], ['Pencil', 'Round', 'Wide', 'Pencil again', 'Chalk'])
        chalk = res['brushes'][4]
        self.assertEqual({k: chalk['settings'][k] for k in ('dualSize', 'dualSpacing', 'dualScatter')}, {'dualSize': 0.5, 'dualSpacing': 0.4, 'dualScatter': 0.8},
                         'a dual tip of 10 px under a 20 px brush is half its size')
        self.assertEqual(chalk['dual'], res['brushes'][2]['tip'], "the dual tip shares Wide's image")
        self.assertNotIn('Dual brush', chalk['notes'])
        pencil = res['brushes'][0]
        self.assertEqual(pencil['settings'], {
            'size': 30, 'spacing': 0.15, 'tipAngle': 330, 'thickness': 0.5, 'hardness': 1,  # 30° counter-clockwise
            'pressureSize': True, 'minSize': 0.25, 'sizeJitter': 0.1, 'tipRandom': 0.4, 'tipFollow': True,
            'pressureOpacity': True, 'minFlow': 0.2, 'flowJitter': 0, 'scatter': 1.5,  # scatter 150% of the diameter
            'textureAmount': 0.6, 'textureScale': 2, 'textureInvert': True, 'opacity': 0.8, 'flow': 0.5, 'gamma': 1})
        self.assertEqual(pencil['notes'], [])
        self.assertEqual(res['brushes'][1]['settings']['tip'], 'round')
        self.assertEqual(res['brushes'][1]['settings']['hardness'], 0.5)
        self.assertEqual(res['brushes'][3]['tip'], pencil['tip'], 'the same tip is shared')
        self.assertEqual([(i['kind'], i['name']) for i in res['images']], [('tip', 'Pencil'), ('texture', 'Paper'), ('tip', 'Wide')])
        w, h, ct, px = png_pixels(from_url(res['images'][pencil['tip']]['png']))
        self.assertEqual((w, h, ct), (3, 2, 4))
        self.assertEqual(px[1::2], bytes([0, 0, 9, 7, 7, 7]), 'the tip is the alpha')
        self.assertEqual(px[0::2], bytes(6), 'black')
        self.assertEqual(png_pixels(from_url(res['images'][2]['png']))[3][1::2], b'\xab\x12', '16-bit: high bytes')
        self.assertEqual(png_pixels(from_url(res['images'][1]['png'])), (2, 2, 0, bytes([10, 20, 30, 40])))

    def test_old_version(self):
        computed = u32(0) + u16(25) + u16(12) + u16(80) + struct.pack('>h', 45) + u16(50)
        sampled = u32(0) + u16(30) + ustr('Old') + b'\0' + bytes(8) + i32(0) + i32(0) + i32(1) + i32(2) + u16(8) + b'\0' + b'\x10\x20'
        data = u16(2) + u16(2) + u16(1) + u32(len(computed)) + computed + u16(2) + u32(len(sampled)) + sampled
        res = bi.import_brushes('old.abr', data)
        self.assertEqual(res['brushes'][0]['settings'], {'size': 12, 'spacing': 0.25, 'hardness': 0.5, 'thickness': 0.8, 'tipAngle': 315, 'tip': 'round'})
        self.assertEqual(res['brushes'][1]['name'], 'Old')
        self.assertEqual(res['brushes'][1]['settings'], {'size': 2, 'spacing': 0.3, 'hardness': 1})
        self.assertEqual(png_pixels(from_url(res['images'][0]['png']))[3][1::2], b'\x10\x20')

    def test_damaged(self):
        with self.assertRaisesRegex(ValueError, 'not a brush file'):
            bi.import_brushes('x.abr', b'GIF89a......')
        with self.assertRaisesRegex(ValueError, 'damaged'):
            bi.import_brushes('x.abr', make_abr()[:200])


# ---------- GIMP and Krita file pieces ----------

def make_gbr(name, w, h, px, depth=1, spacing=25, version=2):
    nb = name.encode() + b'\0'
    if version == 1:
        return u32(20 + len(nb)) + u32(1) + u32(w) + u32(h) + u32(depth) + nb + px
    return u32(28 + len(nb)) + u32(2) + u32(w) + u32(h) + u32(depth) + b'GIMP' + u32(spacing) + nb + px


def with_text(png, key, text, kind=b'tEXt'):
    """A PNG with a text chunk put in before IEND."""
    body = key.encode('latin-1') + b'\0' + (text.encode('latin-1') if kind == b'tEXt' else b'\0\0\0\0' + text.encode())
    chunk = u32(len(body)) + kind + body + u32(zlib.crc32(kind + body) & 0xffffffff)
    return png[:-12] + chunk + png[-12:]


def kpp(name, params, engine='paintbrush'):
    xml = f'<Preset paintopid="{engine}" name="{name}">' + ''.join(
        f'<param type="string" name="{k}"><![CDATA[{v}]]></param>' for k, v in params.items()) + '</Preset>'
    return with_text(PNG, 'preset', xml)


class GimpReader(unittest.TestCase):
    def test_gbr(self):
        res = bi.import_brushes('dots.gbr', make_gbr('Dots', 2, 1, b'\xff\x40', spacing=40))
        b = res['brushes'][0]
        self.assertEqual(b['name'], 'Dots')
        self.assertEqual(b['settings'], {'size': 2, 'hardness': 1, 'spacing': 0.4})
        w, h, ct, raw = png_pixels(from_url(res['images'][b['tip']]['png']))
        self.assertEqual((w, h, ct), (2, 1, 4))
        self.assertEqual(raw, b'\0\xff\0\x40', 'black, with the gray as its alpha')

    def test_colour_and_version_1(self):
        res = bi.import_brushes('c.gbr', make_gbr('Leaf', 1, 1, b'\x10\x20\x30\x99', depth=4))
        self.assertEqual(png_pixels(from_url(res['images'][0]['png']))[3], b'\0\x99', 'the alpha of a colour brush')
        self.assertIn('colours', res['brushes'][0]['notes'][0])
        old = bi.import_brushes('old.gbr', make_gbr('Old', 1, 1, b'\x80', version=1))
        self.assertEqual(old['brushes'][0]['name'], 'Old')
        self.assertNotIn('spacing', old['brushes'][0]['settings'], 'version 1 has no spacing')
        with self.assertRaisesRegex(ValueError, 'damaged'):
            good = make_gbr('X', 1, 1, b'\x80')
            bi.import_brushes('x.gbr', good[:20] + b'NOPE' + good[24:])

    def test_gih_uses_the_first_cell(self):
        data = b'Grass\n3 ncells:3 cellwidth:1 cellheight:1 step:1 dim:1 placement:constant rank0:3 sel0:random\n' + \
            make_gbr('a', 1, 1, b'\x11') + make_gbr('b', 1, 1, b'\x22') + make_gbr('c', 1, 1, b'\x33')
        res = bi.import_brushes('grass.gih', data)
        b = res['brushes'][0]
        self.assertEqual(b['name'], 'Grass')
        self.assertEqual(png_pixels(from_url(res['images'][0]['png']))[3], b'\0\x11')
        self.assertIn('first of its 3 tips', b['notes'][0])

    def test_vbr(self):
        res = bi.import_brushes('round.vbr', b'GIMP-VBR\n1.0\nSoft round\n20\n12.5\n0.5\n2\n30\n')
        self.assertEqual(res['brushes'][0]['settings'],
                         {'tip': 'round', 'size': 25.0, 'spacing': 0.2, 'hardness': 0.5, 'thickness': 0.5, 'tipAngle': 330})
        star = bi.import_brushes('s.vbr', b'GIMP-VBR\n1.5\nStar\ndiamond\n5\n10\n3\n1\n1\n0\n')
        self.assertEqual(star['brushes'][0]['notes'], ['Its square or star shape becomes round'])
        self.assertEqual(star['brushes'][0]['settings']['size'], 6.0)


class KritaReader(unittest.TestCase):
    AUTO = ('<Brush type="auto_brush" spacing="0.08" angle="1.5707963" scale="2">'
            '<MaskGenerator type="circle" diameter="20" ratio="0.5" hfade="0.3" vfade="0.6" spikes="2"/></Brush>')

    def test_auto_brush_preset(self):
        res = bi.import_brushes('ink.kpp', kpp('Inker', {'brush_definition': self.AUTO, 'OpacityValue': '0.75',
                                                        'FlowValue': '2', 'PressureSize': 'true', 'PressureOpacity': 'false'}))
        b = res['brushes'][0]
        self.assertEqual(b['name'], 'Inker')
        # 20 px x scale 2; 90° counter-clockwise is 270; the softer fade wins; flow clamped to 1
        self.assertEqual(b['settings'], {'gamma': 1, 'opacity': 0.75, 'flow': 1, 'pressureSize': True, 'pressureOpacity': False,
                                         'spacing': 0.08, 'tipAngle': 270, 'tip': 'round', 'size': 40.0, 'thickness': 0.5, 'hardness': 0.3})
        self.assertEqual(b['notes'], [])
        smear = bi.import_brushes('s.kpp', kpp('Smear', {'brush_definition': self.AUTO, 'SmudgeRateValue': '0.8'}, engine='colorsmudge'))
        self.assertEqual(smear['brushes'][0]['settings']['mix'], 0.8, 'colour smudge mixes as much as it smudges')
        self.assertEqual(smear['brushes'][0]['notes'], [])
        plain = bi.import_brushes('p.kpp', kpp('Smear', {'brush_definition': self.AUTO}, engine='colorsmudge'))
        self.assertEqual(plain['brushes'][0]['settings']['mix'], 0.5, "Krita's default smudge rate")
        other = bi.import_brushes('h.kpp', kpp('Hair', {'brush_definition': self.AUTO}, engine='hairybrush'))
        self.assertIn('bristle', other['brushes'][0]['notes'][0])

    def test_bundle_with_tip_files(self):
        tip = '<Brush type="gbr_brush" filename="chalk.gbr" spacing="0.2" scale="0.5"/>'
        data = make_zip({'mimetype': b'application/x-krita-resourcebundle', 'meta.xml': b'<meta><dc:title>Chalks</dc:title></meta>',
                         'paintoppresets/a.kpp': kpp('Chalk', {'brush_definition': tip}),
                         'paintoppresets/b.kpp': kpp('Lost', {'brush_definition': '<Brush type="png_brush" filename="gone.png"/>'}),
                         'brushes/chalk.gbr': make_gbr('chalk', 4, 2, b'\x80' * 8)})
        res = bi.import_brushes('chalks.bundle', data)
        self.assertEqual(res['name'], 'Chalks')
        chalk, lost = res['brushes']
        self.assertEqual(chalk['settings']['size'], 2.0, '4 px tip at half scale')
        self.assertEqual(png_pixels(from_url(res['images'][chalk['tip']]['png']))[:2], (4, 2))
        self.assertIsNone(lost['tip'])
        self.assertEqual(lost['settings']['tip'], 'round')
        self.assertIn('gone.png', lost['notes'][0])

    def test_refuses_entities_and_plain_pictures(self):
        with self.assertRaisesRegex(ValueError, 'no brush settings'):
            bi.import_brushes('photo.png', PNG)
        bomb = with_text(PNG, 'preset', '<!DOCTYPE x [<!ENTITY a "aaaa">]><Preset name="&a;"/>')
        with self.assertRaisesRegex(ValueError, 'does not read'):
            bi.import_brushes('bomb.kpp', bomb)


class ProcreateReader(unittest.TestCase):
    def test_single_brush(self):
        data = make_zip({'Brush.archive': keyed_archive({'name': 'Charcoal', 'paintSize': 0.5, 'plotSpacing': 0.08, 'shapeScatter': 0.3,
                                                         'dynamicsPressureSize': 0.6, 'shapeInverted': True, 'grainDepth': 0.7,
                                                         'plotJitter': 0.25, 'dynamicsJitterSize': 0.5, 'dynamicsSpeedSize': 0.3}),
                         'Shape.png': PNG, 'Grain.png': PNG, 'QuickLook/Thumbnail.png': PNG})
        res = bi.import_brushes('Charcoal.brush', data)
        b = res['brushes'][0]
        self.assertEqual(b['name'], 'Charcoal')
        # no minimum or maximum size given: 0 to 1, so half of 150 px = 75
        self.assertEqual(b['settings'], {'hardness': 1, 'gamma': 1, 'size': 75, 'spacing': 0.08, 'tipRandom': 0.3,
                                         'pressureSize': True, 'minSize': 0.4, 'textureAmount': 0.7, 'scatter': 0.25, 'sizeJitter': 0.5, 'speedSize': 0.3})
        tip, grain = res['images'][b['tip']], res['images'][b['texture']]
        self.assertEqual((tip['kind'], tip['white'], tip['invert']), ('tip', True, True))
        self.assertEqual((grain['kind'], grain['name']), ('texture', 'Charcoal grain'))
        self.assertEqual(from_url(tip['png']), PNG, 'Procreate pictures are passed on as they are')

    def test_wet_mix(self):
        data = make_zip({'Brush.archive': keyed_archive({'name': 'Oil', 'dynamicsMix': 0.35, 'dynamicsWetEdges': 0.4})})
        b = bi.import_brushes('Oil.brush', data)['brushes'][0]
        self.assertEqual((b['settings']['mix'], b['settings']['wetEdges']), (0.35, 0.4))
        self.assertNotIn('Wet mixing', b['notes'])

    def test_brushset_order_and_plain_archive(self):
        data = make_zip({
            'brushset.plist': plistlib.dumps({'name': 'Inks', 'brushes': ['B', 'A']}, fmt=plistlib.FMT_BINARY),
            'A/Brush.archive': keyed_archive({'name': 'First', 'bundledShapePath': 'builtin'}),
            'B/Brush.archive': plistlib.dumps({'name': 'Second', 'paintOpacity': 0.5}),  # some tools write a plain dictionary
            'B/Shape.png': PNG,
        })
        res = bi.import_brushes('inks.brushset', data)
        self.assertEqual(res['name'], 'Inks')
        self.assertEqual([b['name'] for b in res['brushes']], ['Second', 'First'])
        self.assertEqual(res['brushes'][0]['settings']['opacity'], 0.5)
        first = res['brushes'][1]
        self.assertIsNone(first['tip'])
        self.assertEqual(first['settings']['tip'], 'round')
        self.assertEqual(first['notes'], ["Its tip is one of Procreate's own and is not in the file"])

    def test_reset_copies_combined_brushes_and_blank_names(self):
        # as Procreate lays out a set: each brush with a Reset/ copy, a combined brush's second brush in Sub01/
        data = make_zip({
            'brushset.plist': plistlib.dumps({'name': 'Mini Watercolor', 'brushes': ['U1', 'U2']}, fmt=plistlib.FMT_BINARY),
            'U1/Brush.archive': keyed_archive({'name': 'Grainy Pencil', 'paintSize': 0.5, 'dualBlendMode': 1}),
            'U1/Sub01/Shape.png': PNG,
            'U1/Reset/Brush.archive': keyed_archive({'name': 'Grainy Pencil'}),
            'U1/Sub01/Brush.archive': keyed_archive({'name': 'Jolly 2', 'paintSize': 0.25, 'plotSpacing': 0.2}),
            'U1/Sub01/Reset/Brush.archive': keyed_archive({'name': 'Dry & Bold 1'}),
            'U2/Brush.archive': keyed_archive({'name': '   '}),
            'U2/Reset/Brush.archive': keyed_archive({'name': '      '}),
        })
        res = bi.import_brushes('Mini Watercolor.brushset', data)
        self.assertEqual([b['name'] for b in res['brushes']], ['Grainy Pencil', 'Mini Watercolor 2'], 'a blank name is numbered after the set')
        pencil = res['brushes'][0]
        self.assertEqual(pencil['notes'], [], 'the combined brush comes over whole')
        combo = pencil['combo']
        self.assertEqual((combo['name'], combo['mode'], combo['settings']['spacing']), ('Jolly 2', 'multiply', 0.2))
        self.assertEqual(combo['settings']['size'], 38, '0.25 x 150 = 37.5: its own size, made a share of the main one on import')
        self.assertEqual(res['images'][combo['tip']]['name'], 'Jolly 2')
        self.assertEqual(res['brushes'][1]['notes'], [])

    def test_size_runs_between_minimum_and_maximum(self):
        size = lambda **k: bi._procreate_settings(k)[0]['size']
        # Rough Wash: the slider at 0.063 of a maximum of 16 (1600%): 0.063 x 16 x 150 = 151.2
        self.assertEqual(size(paintSize=0.063, maxSize=16.0, minSize=0.0), 151)
        # a pencil at 0.067 of 100%, minimum 0.005: (0.005 + 0.995 x 0.067) x 150 = 10.75
        self.assertEqual(size(paintSize=0.067, maxSize=1.0, minSize=0.005), 11)
        self.assertEqual(size(paintSize=0.0, maxSize=16.0, minSize=0.0), 1, 'never under 1 px')
        self.assertEqual(size(paintSize=1.0, maxSize=16.0), 1000, 'nor over 1000')

    def test_pressure_taper(self):
        s = bi._procreate_settings({'pencilTaperStartLength': 0.251, 'pencilTaperEndLength': 0.154, 'pencilTaperSize': 0.196,
                                    'pencilTaperOpacity': 0.5, 'taperStartLength': 0.9})[0]
        # lengths x 400 px: 100.4 and 61.6; the Touch taper (taperStartLength, for fingers) is not the pen's
        self.assertEqual((s['taperIn'], s['taperOut'], s['taperSize'], s['taperOpacity']), (100, 62, 0.2, 0.5))
        self.assertNotIn('taperIn', bi._procreate_settings({'pencilTaperStartLength': 0.0, 'pencilTaperSize': 1.0})[0], 'no length: no taper')

    def test_rendering_flow_becomes_density(self):
        self.assertEqual(bi._procreate_settings({'dynamicsGlazedFlow': 0.5})[0]['flow'], 0.5)
        self.assertNotIn('flow', bi._procreate_settings({'dynamicsGlazedFlow': 1.0})[0], 'full flow: the default density')

    def test_title_cards_are_left_out(self):
        big, small = bi.png_bytes(1024, 8, bytes(1024 * 8)), bi.png_bytes(64, 64, bytes(64 * 64))
        data = make_zip({
            'brushset.plist': plistlib.dumps({'name': 'Pack', 'brushes': ['T', 'A', 'U']}, fmt=plistlib.FMT_BINARY),
            'T/Brush.archive': keyed_archive({'name': '   '}), 'T/Shape.png': big,  # the pack's logo
            'A/Brush.archive': keyed_archive({'name': 'Ink'}), 'A/Shape.png': big,  # a named brush with a big tip stays
            'U/Brush.archive': keyed_archive({'name': ''}), 'U/Shape.png': small,  # unnamed, but a tip-sized picture
        })
        res = bi.import_brushes('Pack.brushset', data)
        self.assertEqual([b['name'] for b in res['brushes']], ['Ink', 'Pack 2'])
        self.assertEqual(res['titleCards'], 1)
        only = make_zip({'T/Brush.archive': keyed_archive({'name': ' '}), 'T/Shape.png': big})
        with self.assertRaisesRegex(ValueError, 'only title cards'):
            bi.import_brushes('Logo.brushset', only)

    def test_not_brushes(self):
        with self.assertRaisesRegex(ValueError, 'no Procreate brushes'):
            bi.import_brushes('x.brush', make_zip({'readme.txt': b'hi'}))


class Library(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['KOE_APP_DIR'] = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()
        os.environ['KOE_APP_DIR'] = _APP_DIR.name

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

    def test_import_route_result_is_json(self):
        res = app.import_brushes('set.abr', make_abr())
        self.assertEqual(len(json.loads(json.dumps(res))['brushes']), 5)


if __name__ == '__main__':
    unittest.main()
