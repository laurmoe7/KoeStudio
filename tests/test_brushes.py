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
            # 30° counter-clockwise; spacing 15% of the short side: the 3 x 2 tip at 50% roundness is 1/3 as high as wide
            'size': 30, 'spacing': 0.05, 'tipAngle': 330, 'thickness': 0.5, 'hardness': 1,
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

    def test_spacing_is_a_share_of_the_short_side(self):
        # a rake: a 1008 x 23 tip with 6% spacing has its dabs 6% of 23 px apart, which is 0.137% of its length; the
        # smallest KoeStudio spacing is 0.5%
        samples = {'r': (1008, 23, bytes(1008 * 23)), 'b': (200, 100, bytes(200 * 100))}
        brush = lambda sid, sp: {'Nm  ': sid, 'Brsh': {'_class': 'sampledBrush', 'sampledData': sid, 'Dmtr': {'unit': '#Pxl', 'value': 700},
                                                      'Spcn': {'unit': '#Prc', 'value': sp}}}
        res = bi._abr_brushes(samples, {}, {'Brsh': [brush('r', 6), brush('b', 50)]}, 'Rakes.abr')
        self.assertEqual([b['settings']['spacing'] for b in res['brushes']], [0.005, 0.25], '200 x 100 at 50%: a quarter of the long side')

    def test_colour_dynamics_flip_and_roundness(self):
        prc = lambda v: {'unit': '#Prc', 'value': v}
        jit = lambda v, ty=0: {'_class': 'brVr', 'bVTy': ty, 'jitter': prc(v), 'Mnm ': prc(0)}
        # as the Rake pack writes them: percent values, per tip
        b = {'Brsh': {'_class': 'sampledBrush', 'Dmtr': {'unit': '#Pxl', 'value': 400}}, 'useTipDynamics': True,
             'szVr': jit(0), 'angleDynamics': jit(0, 6), 'roundnessDynamics': jit(67), 'minimumRoundness': prc(61),
             'flipX': True, 'flipY': False, 'useColorDynamics': True, 'H   ': prc(9), 'Strt': prc(6), 'Brgh': prc(8),
             'colorDynamicsPerTip': True, 'clVr': jit(0), 'purity': prc(0)}
        s, notes, *_ = bi._abr_settings(b)
        self.assertEqual((s['hueJitter'], s['satJitter'], s['valJitter']), (0.09, 0.06, 0.08))
        self.assertNotIn('colorJitterStroke', s, 'per tip: each dab')
        # roundness jitter 67%, but never below 61% round: at most 39% squashed
        self.assertEqual((s['roundJitter'], s['flipX']), (0.39, True))
        self.assertNotIn('flipY', s)
        self.assertEqual(notes, [])
        self.assertEqual(s['flow'], 1, 'no tool options: full flow, as in Photoshop')
        self.assertNotIn('scatterBoth', s, 'no scatter')
        on = {'useScatter': True, 'scatterDynamics': jit(34)}
        self.assertEqual(bi._abr_settings({**b, **on, 'bothAxes': False})[0]['scatterBoth'], False, 'Fur Rake: only across the stroke')
        self.assertNotIn('scatterBoth', bi._abr_settings({**b, **on, 'bothAxes': True})[0], 'both axes: the default')
        # count 9 with count jitter 76% (A Grainy Textured Rake), and 20 (16 kept)
        s, notes, *_ = bi._abr_settings({**b, **on, 'Cnt ': 9.0, 'countDynamics': jit(76)})
        self.assertEqual((s['count'], s['countJitter']), (9, 0.76))
        self.assertEqual(notes, [])
        self.assertEqual(bi._abr_settings({**b, **on, 'Cnt ': 20.0})[1], ['20 dabs at a time (16 are used)'])
        # controls with no match are noted; an angle by pen tilt turns with the pen's lean
        s, notes, *_ = bi._abr_settings({**b, 'szVr': jit(0, 1), 'angleDynamics': jit(0, 3), 'roundnessDynamics': jit(0, 2),
                                         'usePaintDynamics': True, 'prVr': jit(0, 4), 'opVr': jit(0, 2)})
        self.assertIs(s['tiltAngle'], True)
        self.assertEqual(notes, ['Size changing with a fade over the first dabs', 'Roundness changing with pen pressure',
                                 'Flow changing with the stylus wheel'])
        s, notes, *_ = bi._abr_settings({**b, 'colorDynamicsPerTip': False, 'clVr': jit(50), 'purity': prc(-20)})
        self.assertTrue(s['colorJitterStroke'])
        self.assertEqual(notes, ['Foreground/background jitter', 'Purity'])

    def test_old_version(self):
        computed = u32(0) + u16(25) + u16(12) + u16(80) + struct.pack('>h', 45) + u16(50)
        sampled = u32(0) + u16(30) + ustr('Old') + b'\0' + bytes(8) + i32(0) + i32(0) + i32(1) + i32(2) + u16(8) + b'\0' + b'\x10\x20'
        data = u16(2) + u16(2) + u16(1) + u32(len(computed)) + computed + u16(2) + u32(len(sampled)) + sampled
        res = bi.import_brushes('old.abr', data)
        self.assertEqual(res['brushes'][0]['settings'], {'size': 12, 'spacing': 0.25, 'hardness': 0.5, 'thickness': 0.8, 'tipAngle': 315, 'tip': 'round'})
        self.assertEqual(res['brushes'][1]['name'], 'Old')
        self.assertEqual(res['brushes'][1]['settings'], {'size': 2, 'spacing': 0.15, 'hardness': 1})
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

    def test_colour_jitter_and_tilt(self):
        s, notes = bi._procreate_settings({'dynamicsJitterHue': 0.05, 'dynamicsJitterSaturation': 0.15, 'dynamicsJitterLightness': 0.03,
                                           'dynamicsJitterDarkness': 0.03, 'dynamicsTiltSize': 0.31, 'dynamicsTiltOpacity': 0.5})
        self.assertEqual((s['hueJitter'], s['satJitter'], s['valJitter'], s['tiltSize'], s['tiltFlow']), (0.05, 0.15, 0.03, 0.31, 0.5))
        self.assertNotIn('colorJitterStroke', s)
        self.assertEqual(notes, [], 'lighter and darker alike: Light jitter is exact')
        # only the stroke jitter: once per stroke; darkness alone is noted, since Light jitter also lightens
        s, notes = bi._procreate_settings({'dynamicsJitterStrokeHue': 0.02, 'dynamicsJitterStrokeDarkness': 0.2})
        self.assertEqual((s['hueJitter'], s['valJitter'], s['colorJitterStroke']), (0.02, 0.2, True))
        self.assertNotIn('satJitter', s)
        self.assertEqual(notes, ['Its colour jitter only darkens'])

    def test_shape_flip_and_roundness_jitter(self):
        s = bi._procreate_settings({'shapeFlipXJitter': True, 'shapeFlipYJitter': False, 'jitterShapeRoundness': 0.76})[0]
        self.assertEqual((s['flipX'], s['roundJitter']), (True, 0.76))
        self.assertNotIn('flipY', s)

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


# ---------- Clip Studio Paint file pieces ----------

def sqlite_bytes(build, page_size=1024):
    """The bytes of an SQLite database made by build(db)."""
    import sqlite3
    db = sqlite3.connect(':memory:')
    db.execute(f'PRAGMA page_size = {page_size}')
    build(db)
    db.commit()
    data = db.serialize()
    db.close()
    return data


def csp_name(s):
    b = s.encode('utf-16-be')
    return u32(len(s)) + b


def csp_block(index, raw=None):
    """One BlockData entry: a 256 x 256 block of 2 bytes a pixel, empty or holding raw (alpha plane, gray plane)."""
    body = csp_name('BlockDataBeginChunk') + u32(index) + u32(2 * 65536) + u32(256) + u32(256) + u32(raw is not None)
    if raw is not None:
        z = zlib.compress(raw)
        body += u32(len(z) + 4) + struct.pack('<I', len(z)) + z
    body += csp_name('BlockDataEndChunk')
    return u32(len(body) + 4) + body


def csp_layer(w, h, pixels, page_size=1024):
    """A material's .layer file holding a w x h (at most 256 x 256) picture given as {(x, y): (alpha, gray)}: a C2F
    file whose database has its first 5 KB scrambled (as CLIP STUDIO's are) and the rest plain."""
    alpha, gray = bytearray(65536), bytearray(b'\xff' * 65536)
    for (x, y), (a, g) in pixels.items():
        alpha[y * 256 + x], gray[y * 256 + x] = a, g
    attr = (u32(16) + u32(0x66) + u32(0x2a) + u32(0x100) + csp_name('Parameter') + u32(w) + u32(h) + u32(2) + u32(1)
            + u32(17) + u32(1) + u32(1) + u32(2) + bytes(40))
    # the picture is in the first of two blocks; the checksums after the blocks make the row spill over 4+ pages
    blocks = csp_block(0, bytes(alpha) + bytes(gray)) + csp_block(1) + u32(3008) + csp_name('BlockStatus') + bytes(range(256)) * 11

    def build(db):
        db.execute('CREATE TABLE Filler(x BLOB)')  # the first pages, scrambled in the file
        db.execute('INSERT INTO Filler VALUES (?)', (bytes(7000),))
        db.execute('CREATE TABLE Offscreen(_PW_ID INTEGER PRIMARY KEY, MainId INTEGER, LayerId INTEGER, Attribute BLOB, BlockData BLOB)')
        db.execute('INSERT INTO Offscreen VALUES (NULL, 3, 2, ?, ?)', (attr, blocks))
    data = sqlite_bytes(build, page_size)
    chunk = lambda body: struct.pack('<I', len(body)) + b'dATA' + body + b'hash'
    return (b'\x89C2F\r\n\x1a\n' + bytes(4) + b'HEAD' + b'hash' + chunk(b'\x01\x00' + bytes(range(8)) + bytes(5120))
            + chunk(b'\0\0' + data[5120:]) + bytes(4) + b'TAIL' + b'hash')


def csp_package(layer):
    """A MaterialFile's FileData: a tar holding the material's files."""
    import tarfile
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as t:
        for name, body in (('thumbnail/thumbnail.png', PNG), ('data/material_0.layer', layer)):
            info = tarfile.TarInfo(name)
            info.size = len(body)
            t.addfile(info, io.BytesIO(body))
    return out.getvalue()


def csp_refs(*items):
    """A Variant's list of materials: (path, name) each."""
    body = b''
    for path, name in items:
        p, n = path.encode('utf-16-le'), name.encode('utf-16-le')
        item = u32(len(p)) + p + u32(1) + u32(4) + 'id'.encode('utf-16-le') + u32(2) + u32(len(n)) + n  # tag, length, text
        body += u32(len(item) + 4) + item
    return u32(8) + u32(len(items)) + body


def csp_effector(on, pressure_min=0, random_min=0, curve=None, velocity_min=0):
    head = struct.pack('>11i', 44, 0x1f0, on, pressure_min, 0, velocity_min, random_min, 0, 0, 0, 0)
    if curve:
        head += struct.pack('>3i', 12, len(curve), 16) + b''.join(struct.pack('>2d', x, y) for x, y in curve)
    return head


def csp_taper_list(*ticked, ids=(112, 1001, 1021, 1041, 1051, 1082, 1084, 1093, 1100, 1104, 1106, 1108, 1132, 1134)):
    """A BrushInOutTarget blob: every id in `ids`, those in `ticked` ((id, minimum %) pairs) ticked."""
    on = dict(ticked)
    return struct.pack('>3i', 12, len(ids), 12) + b''.join(struct.pack('>3i', i, i in on, on.get(i, 0)) for i in ids)


def make_sut(variant, materials=()):
    """A .sut file: one brush 'Graphite' with the given Variant columns, and MaterialFile rows (path, FileData)."""
    def build(db):
        db.execute('CREATE TABLE Node(_PW_ID INTEGER PRIMARY KEY, NodeName TEXT, NodeVariantID INTEGER)')
        db.execute("INSERT INTO Node VALUES (1, 'Pencils', 0), (2, 'Graphite', 7)")
        cols = ['VariantID'] + list(variant)
        db.execute(f'CREATE TABLE Variant({", ".join(cols)})')
        db.execute(f'INSERT INTO Variant VALUES ({", ".join("?" * len(cols))})', [7] + list(variant.values()))
        db.execute('CREATE TABLE MaterialFile(_PW_ID INTEGER PRIMARY KEY, OriginalPath TEXT, FileData BLOB)')
        for path, blob in materials:
            db.execute('INSERT INTO MaterialFile VALUES (NULL, ?, ?)', (path, blob))
    return sqlite_bytes(build, 4096)


class ClipStudioReader(unittest.TestCase):
    TIP, TEX = '.:01:02:aa:data:material_0.layer', '.:03:04:bb:data:material_0.layer'

    def test_settings(self):
        res = bi.import_brushes('graphite.sut', make_sut({
            'BrushSize': 30.0, 'Opacity': 80, 'BrushFlow': 50, 'BrushHardness': 40, 'BrushInterval': 12.0, 'FlickerReduction': 25,
            'BrushThickness': 50, 'BrushVerticalThicknes': 0, 'BrushRotation': 30.0, 'BrushRotationEffector': 0xC3,
            'BrushRotationRandomScale': 20, 'BrushPatternReverseHorizontal': 2,
            'BrushSizeEffector': csp_effector(0x90, 30, 60, [(0, 0), (0.5, 0.25), (1, 1)]),
            'BrushFlowEffector': csp_effector(0x10, 10, 0, [(0, 0), (1, 1)]),
            'BrushUseIn': 1, 'BrushInLength': 40.0, 'BrushInLengthUnit': 0, 'BrushUseOut': 1, 'BrushOutLength': 20.0, 'BrushOutLengthUnit': 2,
            'BrushChangeStrokeColor': 1, 'BrushStrokeHueChange': 36, 'BrushStrokeSaturationChange': 0, 'BrushStrokeValueChange': 25,
            'BrushUseWaterColor': 1, 'BrushMixColor': 70, 'BrushMixAlpha': 45, 'BrushMixColorExtension': 15, 'UseDualBrush': 1}))
        self.assertEqual(res['name'], 'Graphite')
        b = res['brushes'][0]
        self.assertEqual(b['name'], 'Graphite')
        # 50% thick and horizontal turns it 90° more; the size curve is kept (not straight), the density one is not;
        # stabilization 25 of 100 is 5 of 20; hue 36° of 180, value 25%; Amount of paint 70% leaves the canvas colour 30%
        # (Gouache: 70, 45, 15)
        self.assertEqual(b['settings'], {
            'gamma': 1, 'size': 30.0, 'opacity': 0.8, 'flow': 0.5, 'hardness': 0.4, 'spacing': 0.12, 'smoothing': 5,
            'thickness': 0.5, 'tipAngle': 120, 'tipRandom': 0.2, 'tipFollow': True, 'flipX': True,
            'pressureSize': True, 'minSize': 0.3, 'sizeCurve': [[0, 0], [0.5, 0.25], [1, 1]], 'sizeJitter': 0.4,
            'pressureOpacity': True, 'minFlow': 0.1, 'hueJitter': 0.2, 'valJitter': 0.25, 'colorJitterStroke': True,
            'mix': 0.3, 'paintLoad': 0.45, 'mixStretch': 0.15})
        # Starting and Ending ticked with nothing in the list to taper (no BrushInOutTarget): no taper
        self.assertEqual(b['notes'], ['Dual brush'])
        self.assertIsNone(b['tip'])
        self.assertEqual(res['images'], [])

    def test_colour_mixing(self):
        # CLIP STUDIO's own Blend tool: no paint of its own at all, so all canvas colour and no load
        s = bi._sut_settings({'BrushSize': 40.0, 'BrushUseWaterColor': 1, 'BrushMixColor': 0, 'BrushMixAlpha': 0, 'BrushMixColorExtension': 10})[0]
        self.assertEqual((s['mix'], s['paintLoad'], s['mixStretch']), (1, 0, 0.1))
        # Oil paint: 61% paint, 81% density, 87% stretch
        s = bi._sut_settings({'BrushSize': 40.0, 'BrushUseWaterColor2': 1, 'BrushMixColor': 61, 'BrushMixAlpha': 81, 'BrushMixColorExtension': 87})[0]
        self.assertEqual((s['mix'], s['paintLoad'], s['mixStretch']), (0.39, 0.81, 0.87))
        # all paint: the least mixing KoeStudio has; full density leaves Paint load as it is
        s = bi._sut_settings({'BrushSize': 40.0, 'BrushUseWaterColor': 1, 'BrushMixColor': 100, 'BrushMixAlpha': 100})[0]
        self.assertEqual(s['mix'], 0.05)
        self.assertNotIn('paintLoad', s)
        self.assertNotIn('mix', bi._sut_settings({'BrushSize': 40.0, 'BrushMixColor': 30})[0], 'off: no mixing')

    def test_direction_spray_thickness_and_speed(self):
        # the Rake pack's Flat rakes (3: no turning) and turning rakes (67 = 0x40 + 3)
        flat = bi._sut_settings({'BrushSize': 150.0, 'BrushRotationEffector': 3})[0]
        self.assertIs(flat['tipFollow'], False)
        self.assertIs(bi._sut_settings({'BrushSize': 150.0, 'BrushRotationEffector': 67})[0]['tipFollow'], True)
        # Fur Rake: a 120 px spray area of particles 352.94% of it (423.5 px), 1 per step, turning with the line at 270°;
        # the area's radius 60 px is 0.14 of a particle
        s, notes, *_ = bi._sut_settings({'BrushSize': 120.0, 'BrushRotationEffector': 67, 'BrushRotation': 0.0, 'BrushUseSpray': 1,
                                         'BrushSpraySize': 352.94, 'BrushSpraySizeSyncBrushSize': 1, 'BrushSprayDensity': 1,
                                         'BrushRotationInSpray': 270.0, 'BrushRotationEffectorInSpray': 65, 'BrushRotationRandomInSpray': 0})
        self.assertEqual((s['size'], s['scatter'], s['count'], s['tipAngle'], s['tipFollow'], s['tipRandom']), (423.5, 0.14, 1, 270, True, 0))
        self.assertEqual(notes, [])
        # a 400 px particle not linked to the size, 20 per step (16 kept), random turns of 2%, gathered in the middle
        s, notes, *_ = bi._sut_settings({'BrushSize': 100.0, 'BrushUseSpray': 1, 'BrushSpraySize': 400.0, 'BrushSprayDensity': 20,
                                         'BrushSprayBias': 50, 'BrushRotationEffectorInSpray': 0x80 | 1, 'BrushRotationRandomInSpray': 2})
        self.assertEqual((s['size'], s['scatter'], s['count'], s['tipFollow'], s['tipRandom']), (400, 0.12, 16, False, 0.02))
        self.assertEqual(notes, ['20 spray particles at a time (16 are used)', 'Spray gathered towards the middle'])
        # thickness at random down to 33% (squashed up to 67%) and with pen pressure (noted); texture on each dab
        s, notes, *_ = bi._sut_settings({'BrushSize': 50.0, 'BrushThicknessEffector': csp_effector(0x90, 61, 33),
                                         'TextureImage': b'', 'TextureDensity': 0, 'TextureForPlot': 1})
        self.assertEqual(s['roundJitter'], 0.67)
        self.assertEqual(notes, ['Tip thickness changing with pen pressure'])
        # speed: size down to 40% and density down to 70% when fast; random spacing has no match
        s, notes, *_ = bi._sut_settings({'BrushSize': 50.0, 'BrushSizeEffector': csp_effector(0x40, velocity_min=40),
                                         'BrushFlowEffector': csp_effector(0x40, velocity_min=70),
                                         'BrushIntervalEffector': csp_effector(0x80, random_min=50)})
        self.assertEqual((s['speedSize'], s['speedFlow']), (0.6, 0.3))
        self.assertEqual(notes, ['Spacing changing at random'])

    def test_tapers(self):
        ends = {'BrushUseIn': 1, 'BrushInLength': 20.0, 'BrushInLengthUnit': 0, 'BrushUseOut': 1, 'BrushOutLength': 20.0,
                'BrushOutLengthUnit': 0, 'BrushInOutType': 0}
        keys = ('taperIn', 'taperOut', 'taperSize', 'taperOpacity')
        # G-pen and every rake in the Rake pack: Starting and Ending ticked at 20, but 'Starting and ending: None'
        s, notes, *_ = bi._sut_settings({'BrushSize': 10.0, **ends, 'BrushInOutTarget': csp_taper_list()})
        self.assertEqual([k for k in keys if k in s], [])
        self.assertEqual(notes, [])
        # Round watercolor brush: Brush Size ticked (minimum 0) but Starting and Ending not: no taper either
        s = bi._sut_settings({'BrushSize': 80.0, **ends, 'BrushUseIn': 0, 'BrushUseOut': 0,
                              'BrushInOutTarget': csp_taper_list((1001, 0))})[0]
        self.assertEqual([k for k in keys if k in s], [])
        # size down to 80% (Real G-Pen's minimum) and density to 40%, 30 px in and 50 px out: KoeStudio's full Taper
        # size goes to 10%, so 20% less is 0.2 / 0.9 = 0.22 of it; density to 40% is Taper opacity 0.6
        s, notes, *_ = bi._sut_settings({'BrushSize': 10.0, **ends, 'BrushInLength': 30.0, 'BrushOutLength': 50.0,
                                         'BrushInOutTarget': csp_taper_list((1001, 80), (1021, 40))})
        self.assertEqual([s.get(k) for k in keys], [30, 50, 0.22, 0.6])
        self.assertEqual(notes, [])
        # size to 0 (Round watercolor brush's minimum) is KoeStudio's smallest, 10%; only the start ticked
        s = bi._sut_settings({'BrushSize': 80.0, **ends, 'BrushUseOut': 0, 'BrushInOutTarget': csp_taper_list((1001, 0))})[0]
        self.assertEqual([s.get(k) for k in keys], [20, None, 1, None])
        # density only, down to 25%, and the gap too (no match): the size stays
        s, notes, *_ = bi._sut_settings({'BrushSize': 10.0, **ends, 'BrushInOutTarget': csp_taper_list((1021, 25), (1041, 0))})
        self.assertEqual([s.get(k) for k in keys], [20, 20, 0, 0.75])
        self.assertEqual(notes, ['Starting and ending on other settings than size and density'])
        # Scattered focus lines: by percentage; Greasil: a fade, its length in another unit
        notes = bi._sut_settings({'BrushSize': 3.0, **ends, 'BrushUseOut': 0, 'BrushInOutType': 1,
                                  'BrushInOutTarget': csp_taper_list((1001, 0))})[1]
        self.assertEqual(notes, ['Start taper as a share of the stroke'])
        # unit 2 is ten px a step (Real G-Pen's 2.0 shows as 20 in CLIP STUDIO and tapers over 20 px)
        s, notes, *_ = bi._sut_settings({'BrushSize': 3.0, **ends, 'BrushOutLength': 1.4, 'BrushOutLengthUnit': 2, 'BrushInOutType': 0,
                                         'BrushInOutTarget': csp_taper_list((1001, 50))})
        self.assertEqual([s.get(k) for k in keys], [20, 14, 0.56, None])
        self.assertEqual(notes, [])
        notes = bi._sut_settings({'BrushSize': 3.0, **ends, 'BrushOutLengthUnit': 9, 'BrushInOutTarget': csp_taper_list((1001, 50))})[1]
        self.assertEqual(notes, ['End taper in an unknown unit (check the length)'])
        # Greasil: a fade with only Starting ticked (density from 16%): CLIP STUDIO greys Starting out, so no taper
        s, notes, *_ = bi._sut_settings({'BrushSize': 3.0, **ends, 'BrushInLength': 0.2, 'BrushInLengthUnit': 2, 'BrushUseOut': 0,
                                         'BrushInOutType': 2, 'BrushInOutTarget': csp_taper_list((1001, 100), (1021, 16))})
        self.assertEqual([s.get(k) for k in keys], [None, None, None, None])
        self.assertEqual(notes, [])
        # a fading Ending (gone a set length after the start, pen down or not) has no match
        notes = bi._sut_settings({'BrushSize': 3.0, **ends, 'BrushInOutType': 2, 'BrushInOutTarget': csp_taper_list((1021, 0))})[1]
        self.assertEqual(notes, ['Ending as a fade from the start of the line'])
        self.assertEqual(bi.csp_taper_targets(b'junk'), {})

    def test_spacing_modes(self):
        sp = lambda kind, gap: bi._sut_settings({'BrushSize': 10.0, 'BrushAutoIntervalType': kind, 'BrushInterval': gap})[0]['spacing']
        # Fixed uses the slider (A Grainy Textured Rake: 6.36%); the automatic ones ignore the greyed-out value left
        # behind (Waved line keeps 100 on Normal, Pencil 10 on Wide, Oil paint 1 on Narrow). Measured in CLIP STUDIO on
        # a 100 px round tip: dabs 7.93 px apart on Normal, 11.89 on Wide, 3.97 on Narrow, so 8%, 12% and 4%
        self.assertEqual(sp(0, 6.357615894039736), 0.064)
        self.assertEqual((sp(2, 100.0), sp(1, 10.0), sp(3, 1.0)), (0.08, 0.12, 0.04))
        self.assertEqual(bi._sut_settings({'BrushSize': 10.0, 'BrushInterval': 12.0})[0]['spacing'], 0.12, 'no mode: fixed')

    def test_tilt(self):
        # G-pen size: 0x30 is Pen pressure and Tilt ticked in CLIP STUDIO's Brush Size Dynamics
        s, notes, *_ = bi._sut_settings({'BrushSize': 10.0, 'BrushSizeEffector': csp_effector(0x30)})
        self.assertIs(s['pressureSize'], True)
        self.assertEqual(notes, ['Size changing with pen tilt'])

    def test_tip_and_texture_pictures(self):
        # a 3 x 2 ink mark (with a half-strength pixel) inside a 6 x 5 material; a 4 x 4 grain
        tip = csp_layer(6, 5, {(2, 1): (255, 0), (3, 1): (255, 0), (4, 1): (128, 0), (2, 2): (255, 0), (3, 2): (255, 0), (4, 2): (255, 0)})
        tex = csp_layer(4, 4, {(x, y): (255, 0) for x in range(4) for y in range(4) if (x + y) % 2}, page_size=2048)
        res = bi.import_brushes('graphite.sut', make_sut({
            'BrushSize': 20.0, 'BrushUsePatternImage': 1, 'BrushPatternImageArray': csp_refs((self.TIP, 'nib')),
            'TextureImage': csp_refs((self.TEX, 'Grain')), 'TextureDensity': 40, 'TextureScale2': 50.0, 'TextureReverseDensity': 0},
            [(self.TIP, csp_package(tip)), (self.TEX, csp_package(tex))]))
        b = res['brushes'][0]
        self.assertEqual(b['notes'], [])
        nib, grain = res['images'][b['tip']], res['images'][b['texture']]
        self.assertEqual((nib['kind'], nib['name'], nib['white'], nib['invert']), ('tip', 'nib', True, True))
        w, h, ct, raw = png_pixels(from_url(nib['png']))
        self.assertEqual((w, h, ct), (3, 2, 4), 'cut down to the ink')
        self.assertEqual(raw[1::2], bytes([255, 255, 128, 255, 255, 255]), 'the alpha')
        self.assertEqual(raw[0::2], bytes(6), 'black ink')
        self.assertEqual(grain['kind'], 'texture')
        self.assertEqual(png_pixels(from_url(grain['png']))[:2], (4, 4), 'a texture keeps its margins')
        # half of a 4 px texture is 2 px: as small as KoeStudio scales it is 1/4 of the picture
        self.assertNotIn('side', grain)
        self.assertEqual(b['settings']['textureScale'], 0.25)
        self.assertEqual(b['settings']['textureAmount'], 0.4)
        self.assertNotIn('textureEachDab', b['settings'])
        self.assertNotIn('textureMode', b['settings'], 'no TextureCompositeMode: Multiply, the default')
        s = bi.import_brushes('g.sut', make_sut({'BrushSize': 20.0, 'TextureImage': csp_refs((self.TEX, 'Grain')), 'TextureDensity': 40,
                                                 'TextureForPlot': 1, 'TextureRotate': 45.0, 'TextureDensityEffector': csp_effector(0x10, 25),
                                                 'TextureCompositeMode': 9},
                                                [(self.TEX, csp_package(tex))]))['brushes'][0]
        self.assertIs(s['settings']['textureEachDab'], True, 'Apply by each plot')
        self.assertNotIn('grainPressure', s['settings'])
        self.assertEqual(s['settings']['textureMode'], 'height', 'mode 9 is Height (Greasil Mk2)')
        for mode, name in ((0, 'normal'), (2, 'subtract'), (3, 'compare'), (4, 'outline'), (7, 'burn')):
            got = bi._sut_settings({'BrushSize': 20.0, 'TextureImage': csp_refs((self.TEX, 'Grain')), 'TextureDensity': 40,
                                    'TextureCompositeMode': mode})[0]
            self.assertEqual(got.get('textureMode'), name, f'mode {mode}')
        got = bi._sut_settings({'BrushSize': 20.0, 'TextureImage': csp_refs((self.TEX, 'Grain')), 'TextureDensity': 40, 'TextureCompositeMode': 1})[0]
        self.assertNotIn('textureMode', got, 'Multiply is the default')
        self.assertEqual(s['settings']['texturePressure'], 0.75, 'texture density by pressure, 25% at the lightest touch')
        self.assertNotIn('texturePressure', b['settings'])
        self.assertEqual(s['notes'], ['Texture turned'])
        self.assertIs(b['settings']['textureInvert'], True, 'CLIP STUDIO paints where the texture is dark')

    def test_texture_tone(self):
        # gray 0, 100, 200, 255 opaque, and gray 0 half see-through (flattened on white: (0 * 128 + 255 * 127) / 255 = 127)
        gray, alpha = bytes([0, 100, 200, 255, 0]), bytes([255, 255, 255, 255, 128])
        g, a = bi.csp_texture_tone(gray, alpha, 0, 0)
        self.assertEqual((list(g), set(a)), ([0, 100, 200, 255, 127], {255}), 'nothing to change: only flattened')
        # brightness -28: every level 14% of 255 = 35.7 darker (CLIP STUDIO moves it by half the value)
        self.assertEqual(list(bi.csp_texture_tone(gray, alpha, -28, 0)[0]), [0, 64, 164, 219, 91])
        # contrast 50: twice as steep round 127.5; -50: half as steep
        self.assertEqual(list(bi.csp_texture_tone(gray, alpha, 0, 50)[0]), [0, 73, 255, 255, 127])
        self.assertEqual(list(bi.csp_texture_tone(gray, alpha, 0, -50)[0]), [64, 114, 164, 191, 127])
        # brightness first, then contrast: -28 then 50 takes 100 to (100 - 35.7 - 127.5) * 2 + 128 = 1.6 (contrast
        # first would give 73 - 35.7 = 37), 200 to 201.6, the flattened 127 to 55.6
        self.assertEqual(list(bi.csp_texture_tone(gray, alpha, -28, 50)[0]), [0, 1, 201, 255, 55])
        # the ends, as CLIP STUDIO paints them: 100 splits between 127 and 128, -100 is flat 128 (paint 127/255)
        steps = bytes([0, 127, 128, 200, 255])
        self.assertEqual(list(bi.csp_texture_tone(steps, bytes([255]) * 5, 0, 100)[0]), [0, 0, 255, 255, 255])
        self.assertEqual(list(bi.csp_texture_tone(steps, bytes([255]) * 5, 0, -100)[0]), [128] * 5)
        # in an import: Greasil's -28 darkens the saved picture (the test material has ink only: half see-through
        # flattens to 127, -28 makes it 91; solid ink stays 0)
        tex = csp_layer(2, 1, {(0, 0): (128, 0), (1, 0): (255, 0)})
        res = bi.import_brushes('g.sut', make_sut({'BrushSize': 20.0, 'TextureImage': csp_refs((self.TEX, 'Grain')), 'TextureDensity': 40,
                                                   'TextureBrightness': -28}, [(self.TEX, csp_package(tex))]))
        self.assertEqual(res['brushes'][0]['notes'], [])
        w, h, ct, raw = png_pixels(from_url(res['images'][0]['png']))
        self.assertEqual((raw[0::2], set(raw[1::2])), (bytes([91, 0]), {255}))

    def test_texture_size(self):
        tex = csp_layer(200, 100, {(0, 0): (255, 0)})
        sut = lambda scale: make_sut({'BrushSize': 20.0, 'TextureImage': csp_refs((self.TEX, 'Paper')), 'TextureDensity': 100,
                                      'TextureScale2': scale}, [(self.TEX, csp_package(tex))])
        half = bi.import_brushes('p.sut', sut(50.0))
        im, s = half['images'][0], half['brushes'][0]['settings']
        self.assertEqual((im['side'], s['textureScale']), (100, 1), '50% of 200 px: the picture is saved 100 px wide')
        same = bi.import_brushes('p.sut', sut(100.0))
        self.assertNotIn('side', same['images'][0])
        self.assertEqual(same['brushes'][0]['settings']['textureScale'], 1)

    def test_missing_and_unreadable_pictures(self):
        res = bi.import_brushes('g.sut', make_sut({'BrushSize': 20.0, 'BrushUsePatternImage': 1,
                                                   'BrushPatternImageArray': csp_refs((self.TIP, 'nib'), ('.:9', 'other')),
                                                   'TextureImage': csp_refs((self.TEX, 'Paper')), 'TextureDensity': 50},
                                                  [(self.TEX, b'not a tar')]))
        b = res['brushes'][0]
        self.assertEqual(b['settings']['tip'], 'round')
        self.assertNotIn('textureAmount', b['settings'])
        self.assertEqual(b['notes'], ['It switches between 2 tip pictures (the first is used)', 'Its tip picture (nib) is not in the file',
                                      'Its texture (Paper) could not be read'])

    def test_not_a_brush(self):
        def tools_only(db):
            db.execute('CREATE TABLE Node(_PW_ID INTEGER PRIMARY KEY, NodeName TEXT, NodeVariantID INTEGER)')
            db.execute("INSERT INTO Node VALUES (1, 'Group', 0)")
        with self.assertRaisesRegex(ValueError, 'no brush'):
            bi.import_brushes('group.sut', sqlite_bytes(tools_only))
        with self.assertRaisesRegex(ValueError, 'could not be read'):
            bi.import_brushes('bad.sut', b'SQLite format 3\0' + bytes(100))


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
