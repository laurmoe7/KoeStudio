"""Imports brushes from Procreate (.brush, .brushset), Photoshop (.abr), Clip Studio Paint (.sut), GIMP (.gbr,
.gih, .vbr) and Krita (.kpp, .bundle) files for KoeStudio's brush library.

import_brushes(filename, data) -> {'name', 'brushes': [{name, settings, tip, texture, dual?, notes}], 'images': [{kind,
name, png, white}]}: settings are KoeStudio paint-tool settings (checked again in the browser), tip / texture index
into images (shared images appear once), png is a data URL. white=True marks a Procreate shape, where white is
paint: the browser turns it into a transparent tip before saving it.

Procreate: a ZIP holding, per brush, Brush.archive (an NSKeyedArchiver property list of the brush's settings),
Shape.png (the tip) and Grain.png (the texture); a .brushset adds brushset.plist with the brushes' order. The
setting names are not documented by Procreate, so each one read here is optional and range-checked.

Photoshop ABR, versions 1-2: a list of brushes (sampled tips stored inline). Versions 6-10: '8BIM' sections:
'samp' (the tip images, 8 or 16 bit, raw or PackBits), 'patt' (texture patterns, as in PSD files) and 'desc' (an
action descriptor with each brush's settings, pointing at its tip by id). All numbers are big-endian.

GIMP .gbr: a header (size, version 1 or 2, width, height, bytes per pixel 1 or 4, and in version 2 'GIMP' and the
spacing in %), the name (UTF-8, ending in 0), then the pixels (gray: 255 = full paint; RGBA: the alpha is used).
.gih (an "image hose"): a name line, a parameter line ("<cells> ncells:.. sel0:random ..."), then the cells as .gbr
brushes; the first one is used. .vbr: text lines GIMP-VBR, version, name, spacing, radius, hardness, aspect, angle.

Krita .kpp: a PNG (the preset's picture) with a text chunk 'preset' holding XML: <Preset paintopid name> with
<param name=..> values; 'brush_definition' is itself XML (<Brush type spacing angle> with an auto brush's
<MaskGenerator diameter ratio hfade vfade>, or a tip file's name). A .bundle is a ZIP with paintoppresets/*.kpp and
the tip files under brushes/. Krita's names are not documented as a format either, so all are optional.

Clip Studio Paint .sut (one exported sub tool): an SQLite database. Node names the brush and points at its Variant
row, whose columns are the settings (sizes, percentages, and "effector" blobs saying what pen pressure, tilt, speed
and randomness do to a setting). MaterialFile holds the tip and texture pictures, each a tar of a CLIP STUDIO material
package; its data/material_0.layer is a "C2F" file of chunks ([u32 little-endian length]['dATA'][body][u32], up to
'TAIL'), each body starting with a flag: 1 = scrambled, 0 = plain. Put together the bodies make another SQLite
database (8 more bytes in front of a scrambled body); only its first pages, SQLite's own header among them, are
scrambled, so the rest is read page by page here (csp_pages). Its Offscreen rows hold the picture as in .clip files:
an Attribute blob (after 'Parameter': width, height, columns and rows of 256 px blocks, then 4 numbers, the last the
bytes per pixel: 1 alpha, 2 alpha + gray, 5 alpha + BGRx) and BlockData: per block [u32 size of the whole block]
['BlockDataBeginChunk' as u32 length + UTF-16BE][u32 index, unpacked size, width, height, has data] and with data
[u32 length][u32 little-endian length] zlib bytes, then ['BlockDataEndChunk']. A block unpacks to its alpha plane
followed by its colour planes.
"""
import base64
import io
import math
import plistlib
import posixpath
import re
import sqlite3
import struct
import tarfile
import xml.etree.ElementTree as ET
import zipfile
import zlib

MAX_FILE = 256 * 1024 * 1024
MAX_UNZIPPED = 512 * 1024 * 1024
MAX_SIDE = 8192
MAX_BRUSHES = 1000


# ---------- shared ----------

def png_bytes(w, h, gray, alpha=None):
    """An 8-bit PNG: grayscale, or grayscale with alpha when alpha is given (bytes of w * h each)."""
    if alpha is None:
        px, row = bytes(gray), w
    else:
        buf = bytearray(2 * w * h)
        buf[0::2], buf[1::2] = gray, alpha
        px, row = bytes(buf), 2 * w
    raw = b''.join(b'\0' + px[y * row:(y + 1) * row] for y in range(h))

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    head = struct.pack('>2I5B', w, h, 8, 0 if alpha is None else 4, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')


def data_url(png):
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def unpackbits(src, size):
    """PackBits (as in PSD and ABR): a header byte n < 128 copies n + 1 bytes, n > 128 repeats the next byte
    257 - n times, 128 does nothing. Returns exactly size bytes (padded with 0 when the data runs short)."""
    out, i = bytearray(), 0
    while len(out) < size and i < len(src):
        n = src[i]
        i += 1
        if n < 128:
            out += src[i:i + n + 1]
            i += n + 1
        elif n > 128:
            if i < len(src):
                out += bytes([src[i]]) * (257 - n)
            i += 1
    return bytes(out[:size]) + bytes(max(0, size - len(out)))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


class Reader:
    def __init__(self, data, pos=0):
        self.d, self.p = data, pos

    def take(self, n):
        if n < 0 or self.p + n > len(self.d):
            raise ValueError('The brush file is damaged (it ends too early).')
        b = self.d[self.p:self.p + n]
        self.p += n
        return b

    def u8(self): return self.take(1)[0]
    def u16(self): return struct.unpack('>H', self.take(2))[0]
    def u32(self): return struct.unpack('>I', self.take(4))[0]
    def i32(self): return struct.unpack('>i', self.take(4))[0]
    def f64(self): return struct.unpack('>d', self.take(8))[0]

    def unicode(self):
        return self.take(2 * self.u32()).decode('utf-16-be', 'replace').rstrip('\0')

    def pascal(self):
        return self.take(self.u8()).decode('latin-1')

    def key(self):  # a descriptor class or key id: a length, or 0 then four characters
        n = self.u32()
        return self.take(n or 4).decode('latin-1')


def _pixels(r, w, h, depth, compression):
    """One 8-bit plane of w x h from 8- or 16-bit, raw or PackBits data (16-bit keeps the high byte)."""
    if w <= 0 or h <= 0 or w > MAX_SIDE or h > MAX_SIDE:
        raise ValueError('A brush image in the file has an impossible size.')
    if depth not in (8, 16):
        raise ValueError(f'{depth}-bit brush images are not supported.')
    bpp = depth // 8
    if compression == 0:
        data = r.take(w * h * bpp)
    elif compression == 1:
        counts = [r.u16() for _ in range(h)]
        data = b''.join(unpackbits(r.take(n), w * bpp) for n in counts)
    else:
        raise ValueError('A brush image uses an unknown compression.')
    return data[0::2] if bpp == 2 else data


# ---------- Photoshop descriptors ----------

def descriptor(r):
    r.unicode()  # display name, unused
    out = {'_class': r.key()}
    for _ in range(r.u32()):
        k = r.key()
        out[k] = _value(r)
    return out


def _value(r):
    t = r.take(4).decode('latin-1')
    if t in ('Objc', 'GlbO'):
        return descriptor(r)
    if t == 'VlLs':
        return [_value(r) for _ in range(r.u32())]
    if t == 'doub':
        return r.f64()
    if t == 'UntF':
        unit = r.take(4).decode('latin-1')
        return {'unit': unit, 'value': r.f64()}
    if t == 'UnFl':
        unit, n = r.take(4).decode('latin-1'), r.u32()
        return {'unit': unit, 'values': [r.f64() for _ in range(n)]}
    if t == 'TEXT':
        return r.unicode()
    if t == 'enum':
        return {'type': r.key(), 'enum': r.key()}
    if t == 'long':
        return r.i32()
    if t == 'comp':
        return struct.unpack('>q', r.take(8))[0]
    if t == 'bool':
        return bool(r.u8())
    if t in ('type', 'GlbC'):
        r.unicode()
        return {'class': r.key()}
    if t in ('alis', 'tdta', 'Pth '):
        return r.take(r.u32())
    if t == 'obj ':
        for _ in range(r.u32()):
            kind = r.take(4).decode('latin-1')
            if kind == 'prop':
                r.unicode(); r.key(); r.key()
            elif kind == 'Clss':
                r.unicode(); r.key()
            elif kind == 'Enmr':
                r.unicode(); r.key(); r.key(); r.key()
            elif kind == 'rele':
                r.unicode(); r.key(); r.u32()
            elif kind in ('Idnt', 'indx'):
                r.u32()
            elif kind == 'name':
                r.unicode(); r.key(); r.unicode()
            else:
                raise ValueError(f'Unknown reference in the brush settings ({kind}).')
        return None
    raise ValueError(f'Unknown value in the brush settings ({t}).')


def _num(v, default=None):
    if isinstance(v, dict):
        v = v.get('value')
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else default


# ---------- Photoshop ABR ----------

MIN_SPACING = 0.005  # KoeStudio's smallest Spacing (a share of the brush size)
DIRECTION, INITIAL_DIRECTION, PEN_PRESSURE = 6, 5, 2  # 'bVTy' controls: off, fade, pressure, tilt, wheel, ...
# the controls KoeStudio has no match for, as notes say them ('the dabs' size changing with ...)
ABR_CONTROLS = {1: 'a fade over the first dabs', 3: 'pen tilt', 4: 'the stylus wheel', 5: 'pen rotation'}


def _control_note(notes, control, what):
    if control in ABR_CONTROLS:
        notes.append(f'{what} changing with {ABR_CONTROLS[control]}')


def read_abr(data, filename):
    r = Reader(data)
    version = r.u16()
    if version in (1, 2):
        return _abr_old(r, version, filename)
    if version not in (6, 7, 9, 10):
        raise ValueError(f'Photoshop brush files of version {version} are not supported.')
    sub = r.u16()
    samples, patterns, desc = {}, {}, None
    while r.p + 12 <= len(data):
        if r.take(4) != b'8BIM':
            raise ValueError('The brush file is damaged.')
        kind, size = r.take(4).decode('latin-1'), r.u32()
        end = r.p + size
        if end > len(data):
            raise ValueError('The brush file is damaged (it ends too early).')
        if kind == 'samp':
            while r.p + 4 <= end:
                n = r.u32()
                after = r.p + (n + 3) // 4 * 4
                sid = r.pascal()
                r.take(10 if sub == 1 else 264)
                top, left, bottom, right = r.i32(), r.i32(), r.i32(), r.i32()
                depth, comp = r.u16(), r.u8()
                w, h = right - left, bottom - top
                samples[sid] = (w, h, _pixels(r, w, h, depth, comp))
                r.p = after
        elif kind == 'patt':
            while r.p + 4 <= end:
                pat = _pattern(r)
                if pat:
                    patterns[pat['id']] = pat
        elif kind == 'desc':
            r.u32()  # descriptor version (16)
            desc = descriptor(r)
        r.p = end + (-size % 4)
    return _abr_brushes(samples, patterns, desc, filename)


def _pattern(r):
    """A texture pattern (PSD layout): {'id', 'name', 'w', 'h', 'gray'}, or None when it cannot be used."""
    n = r.u32()
    end = r.p + (n + 3) // 4 * 4
    try:
        r.u32()  # version
        mode = r.u32()
        r.u16(); r.u16()
        name, pid = r.unicode(), r.pascal()
        palette = None
        if mode == 2:  # indexed: 256 RGB entries
            palette = r.take(768)
            r.take(4)
        r.u32(); r.u32()  # list version, length
        top, left, bottom, right = r.u32(), r.u32(), r.u32(), r.u32()
        w, h = right - left, bottom - top
        planes = []
        for _ in range(r.u32() + 2):
            if not r.u32():
                continue
            length = r.u32()
            cend = r.p + length
            depth = r.u32()
            ct, cl, cb, cr = r.u32(), r.u32(), r.u32(), r.u32()
            r.u16()
            comp = r.u8()
            if (cr - cl, cb - ct) == (w, h) and depth in (8, 16):
                planes.append(_pixels(r, w, h, depth, comp))
            r.p = cend
    finally:
        r.p = end
    if mode == 3 and len(planes) >= 3:  # RGB
        rr, gg, bb = planes[:3]
        gray = bytes((299 * rr[i] + 587 * gg[i] + 114 * bb[i] + 500) // 1000 for i in range(w * h))
    elif mode == 1 and planes:
        gray = planes[0]
    elif mode == 2 and planes and palette:
        lut = [(299 * palette[i * 3] + 587 * palette[i * 3 + 1] + 114 * palette[i * 3 + 2] + 500) // 1000 for i in range(256)]
        gray = bytes(lut[v] for v in planes[0])
    else:
        return None
    return {'id': pid, 'name': name or 'Pattern', 'w': w, 'h': h, 'gray': gray}


def _abr_old(r, version, filename):
    """Versions 1 and 2: computed (round) and sampled brushes one after the other."""
    count, out, images = r.u16(), [], []
    for i in range(min(count, MAX_BRUSHES)):
        kind, size = r.u16(), r.u32()
        after = r.p + size
        if kind == 1:  # computed: a round brush
            r.u32()
            spacing, diameter, roundness, angle, hardness = r.u16(), r.u16(), r.u16(), struct.unpack('>h', r.take(2))[0], r.u16()
            out.append({'name': f'Brush {i + 1}', 'tip': None, 'texture': None, 'notes': [], 'settings': {
                'size': _clamp(diameter, 1, 1000), 'spacing': _clamp(spacing / 100, 0.02, 1), 'hardness': _clamp(hardness / 100, 0, 1),
                'thickness': _clamp(roundness / 100, 0.05, 1), 'tipAngle': round(-angle) % 360, 'tip': 'round'}})
        elif kind == 2:  # sampled
            r.u32()
            spacing = r.u16()
            name = r.unicode() if version == 2 else ''
            r.u8()
            r.take(8)
            top, left, bottom, right = r.i32(), r.i32(), r.i32(), r.i32()
            depth, comp = r.u16(), r.u8()
            w, h = right - left, bottom - top
            alpha = _pixels(r, w, h, depth, comp)
            name = name or f'Brush {i + 1}'
            images.append({'kind': 'tip', 'name': name, 'png': data_url(png_bytes(w, h, bytes(w * h), alpha)), 'white': False})
            out.append({'name': name, 'tip': len(images) - 1, 'texture': None, 'notes': [], 'settings': {
                'size': _clamp(max(w, h), 1, 1000), 'spacing': round(_clamp((spacing or 25) / 100 * min(w, h) / max(w, h, 1), MIN_SPACING, 1), 4), 'hardness': 1}})
        r.p = after
    return {'name': _stem(filename), 'brushes': out, 'images': images}


def _abr_brushes(samples, patterns, desc, filename):
    images, tip_index, tex_index, out = [], {}, {}, []

    def tip_image(sid, name):
        if sid not in tip_index:
            w, h, alpha = samples[sid]
            images.append({'kind': 'tip', 'name': name, 'png': data_url(png_bytes(w, h, bytes(w * h), alpha)), 'white': False})
            tip_index[sid] = len(images) - 1
        return tip_index[sid]

    def texture_image(pid):
        if pid not in tex_index:
            p = patterns[pid]
            images.append({'kind': 'texture', 'name': p['name'], 'png': data_url(png_bytes(p['w'], p['h'], p['gray'])), 'white': False})
            tex_index[pid] = len(images) - 1
        return tex_index[pid]

    entries = (desc or {}).get('Brsh') if isinstance(desc, dict) else None
    if isinstance(entries, list) and entries:
        for i, b in enumerate(entries[:MAX_BRUSHES]):
            if not isinstance(b, dict):
                continue
            name = b.get('Nm  ') if isinstance(b.get('Nm  '), str) else f'Brush {i + 1}'
            settings, notes, sid, tex, dual_sid = _abr_settings(b)
            tip = tip_image(sid, name) if sid in samples else None
            if 'spacing' in settings:  # KoeStudio's spacing is a share of the long side: a rake's dabs must sit as close
                w, h = samples[sid][:2] if tip is not None else (1, 1)
                short = min(w, h) / max(w, h, 1) * settings.get('thickness', 1)
                settings['spacing'] = round(_clamp(settings['spacing'] * short, MIN_SPACING, 1), 4)
            dual = tip_image(dual_sid, f'{name} (dual)') if dual_sid in samples else None
            if dual_sid and dual is None:
                settings['dualTip'] = 'round'
                notes.append('Its dual tip image is missing from the file')
            if sid and tip is None:
                notes.append('Its tip image is missing from the file')
            texture = None
            if tex:
                if tex in patterns:
                    texture = texture_image(tex)
                else:
                    notes.append('Its texture is not in the file')
            if tip is None:
                settings['tip'] = 'round'
            entry = {'name': name.strip() or f'Brush {i + 1}', 'settings': settings, 'tip': tip, 'texture': texture, 'notes': notes}
            if dual is not None:
                entry['dual'] = dual
            out.append(entry)
    else:  # no settings: one brush per tip, with Photoshop's default spacing
        for i, (sid, (w, h, _)) in enumerate(list(samples.items())[:MAX_BRUSHES]):
            name = f'{_stem(filename)} {i + 1}'
            out.append({'name': name, 'tip': tip_image(sid, name), 'texture': None, 'notes': [],
                        'settings': {'size': _clamp(max(w, h), 1, 1000), 'spacing': 0.25, 'hardness': 1}})
    return {'name': _stem(filename), 'brushes': out, 'images': images}


def _dyn(d, key):
    """A dynamics entry: (control index, jitter (1 = 100%; scatter goes past it), minimum 0-1)."""
    v = d.get(key)
    if not isinstance(v, dict):
        return 0, 0, 0
    return _num(v.get('bVTy'), 0), max(0, _num(v.get('jitter'), 0) / 100), _clamp(_num(v.get('Mnm '), 0) / 100, 0, 1)


def _abr_settings(b):
    """KoeStudio settings for one ABR brush descriptor, notes, its sample id and texture pattern id."""
    shape = b.get('Brsh') if isinstance(b.get('Brsh'), dict) else {}
    s, notes = {}, []
    dm = _num(shape.get('Dmtr'))
    if dm:
        s['size'] = round(_clamp(dm, 1, 1000), 1)
    sp = _num(shape.get('Spcn'))
    if sp is not None:
        # a share of the tip's short side, as Photoshop measures it (made a share of the long side in _abr_brushes)
        s['spacing'] = sp / 100 if shape.get('Intr', True) else 0.1
    ang = _num(shape.get('Angl'))
    if ang is not None:
        s['tipAngle'] = round(-ang) % 360  # Photoshop turns counter-clockwise
    rnd = _num(shape.get('Rndn'))
    if rnd is not None:
        s['thickness'] = round(_clamp(rnd / 100, 0.05, 1), 2)
    hard = _num(shape.get('Hrdn'))
    s['hardness'] = round(_clamp(hard / 100, 0, 1), 2) if hard is not None else 1
    sid = shape.get('sampledData') if isinstance(shape.get('sampledData'), str) else None
    if shape.get('_class') not in ('computedBrush', 'sampledBrush'):
        notes.append('Its special tip (bristle or erodible) becomes a round tip')

    if b.get('useTipDynamics'):
        control, jitter, _ = _dyn(b, 'szVr')
        if control == PEN_PRESSURE:
            s['pressureSize'] = True
            s['minSize'] = round(_clamp(_num(b.get('minimumDiameter'), 0) / 100, 0, 1), 2)
        else:
            s['pressureSize'] = False
            _control_note(notes, control, 'Size')
        s['sizeJitter'] = round(_clamp(jitter, 0, 1), 2)
        control, jitter, _ = _dyn(b, 'angleDynamics')
        s['tipRandom'] = round(_clamp(jitter, 0, 1), 2)
        s['tipFollow'] = control in (DIRECTION, INITIAL_DIRECTION)
        if control == 3:  # pen tilt: the tip turns with the way the pen leans
            s['tiltAngle'] = True
        elif control in (1, 2, 4):
            notes.append('Angle changing with ' + ('pen pressure' if control == PEN_PRESSURE else ABR_CONTROLS[control]))
        # Roundness jitter: each dab squashed at random, never below the minimum roundness
        rc, rj, _ = _dyn(b, 'roundnessDynamics')
        if rc:
            notes.append('Roundness changing with ' + ('pen pressure' if rc == PEN_PRESSURE else ABR_CONTROLS.get(rc, 'the pen')))
        if rj:
            low = _clamp(_num(b.get('minimumRoundness'), 0) / 100, 0, 1)
            s['roundJitter'] = round(_clamp(min(rj, 1 - low), 0, 1), 2)
        # Flip X / Flip Y jitter: each dab mirrored at random
        if b.get('flipX') is True:
            s['flipX'] = True
        if b.get('flipY') is True:
            s['flipY'] = True
    else:
        s['pressureSize'] = False
    if b.get('usePaintDynamics'):
        fc, fj, fmin = _dyn(b, 'prVr')
        oc, oj, omin = _dyn(b, 'opVr')
        s['pressureOpacity'] = PEN_PRESSURE in (fc, oc)
        s['minFlow'] = round(fmin if fc == PEN_PRESSURE else omin, 2)
        s['flowJitter'] = round(_clamp(max(fj, oj), 0, 1), 2)
        _control_note(notes, fc, 'Flow')
        _control_note(notes, oc, 'Opacity')
    else:
        s['pressureOpacity'] = False
    if b.get('useScatter'):
        s['scatter'] = round(_clamp(_dyn(b, 'scatterDynamics')[1], 0, 2), 2)  # Photoshop: a share of the diameter
        if b.get('bothAxes') is False:  # only across the stroke
            s['scatterBoth'] = False
        _control_note(notes, _dyn(b, 'scatterDynamics')[0], 'Scatter')
        cnt = _num(b.get('Cnt '), 1) or 1
        if cnt > 1:
            s['count'] = int(_clamp(round(cnt), 1, 16))
            if cnt > 16:
                notes.append(f'{round(cnt)} dabs at a time (16 are used)')
        cc, cj, _ = _dyn(b, 'countDynamics')
        if cj:  # each step lays a random number of dabs, down to (1 - jitter) of the count
            s['countJitter'] = round(_clamp(cj, 0, 1), 2)
        _control_note(notes, cc, 'Count')
    tex = None
    t = b.get('Txtr')
    if b.get('useTexture') and isinstance(t, dict):
        tex = t.get('Idnt') if isinstance(t.get('Idnt'), str) else None
        s['textureAmount'] = round(_clamp(_num(b.get('textureDepth'), 100) / 100, 0, 1), 2)
        s['textureScale'] = round(_clamp(_num(b.get('textureScale'), 100) / 100, 0.25, 4), 2)
        s['textureInvert'] = bool(b.get('InvT'))
    dual_sid = None
    dual = b.get('dualBrush') if isinstance(b.get('dualBrush'), dict) else None
    dshape = dual.get('Brsh') if dual and isinstance(dual.get('Brsh'), dict) else None
    if b.get('useDualBrush') and dshape:  # a second tip the stroke shows through: its own size, spacing and scatter
        dual_sid = dshape.get('sampledData') if isinstance(dshape.get('sampledData'), str) else None
        ddm = _num(dshape.get('Dmtr'))
        if ddm and dm:
            s['dualSize'] = round(_clamp(ddm / dm, 0.05, 3), 2)
        dsp = _num(dshape.get('Spcn'))
        if dsp is not None:
            s['dualSpacing'] = round(_clamp(dsp / 100, 0.02, 2), 3)
        if dual.get('useScatter'):
            s['dualScatter'] = round(_clamp(_dyn(dual, 'scatterDynamics')[1], 0, 3), 2)
        if not dual_sid:
            s['dualTip'] = 'round'
    elif b.get('useDualBrush'):
        notes.append('Dual brush')
    if b.get('Wtdg'):  # Wet edges is a tick in Photoshop
        s['wetEdges'] = 0.5
    if b.get('useColorDynamics'):  # hue, saturation and brightness jitter (percent), per dab or once per stroke
        for key, setting in (('H   ', 'hueJitter'), ('Strt', 'satJitter'), ('Brgh', 'valJitter')):
            v = _num(b.get(key), 0) / 100
            if v > 0:
                s[setting] = round(_clamp(v, 0, 1), 2)
        if b.get('colorDynamicsPerTip') is False:
            s['colorJitterStroke'] = True
        if _dyn(b, 'clVr')[1] or _dyn(b, 'clVr')[0]:
            notes.append('Foreground/background jitter')
        if _num(b.get('purity'), 0):
            notes.append('Purity')
    if b.get('Nose'):
        notes.append('Noise')
    opts = b.get('toolOptions') if isinstance(b.get('toolOptions'), dict) else {}
    op, fl = _num(opts.get('Opct')), _num(opts.get('flow'))
    if op is not None:
        s['opacity'] = round(_clamp(op / 100, 0.01, 1), 2)
    # without tool options, Photoshop paints at full flow (not KoeStudio's Brush tool default of 55%)
    s['flow'] = round(_clamp(fl / 100, 0.01, 1), 2) if fl is not None else 1
    s['gamma'] = 1
    return s, notes, sid, tex, dual_sid


# ---------- Procreate ----------

def _unarchive(pl):
    """The root object of an NSKeyedArchiver property list as a plain dict (references resolved); a plain
    dictionary (some tools write Brush.archive that way) is taken as it is."""
    if not isinstance(pl, dict):
        return {}
    if '$objects' not in pl:
        return pl
    objs = pl['$objects']

    def res(v, depth):
        for _ in range(4):
            if isinstance(v, plistlib.UID):
                v = objs[v.data] if v.data < len(objs) else None
        if v == '$null':
            return None
        if isinstance(v, dict) and depth < 4:
            return {k: res(x, depth + 1) for k, x in v.items() if not k.startswith('$')}
        if isinstance(v, list) and depth < 4:
            return [res(x, depth + 1) for x in v]
        return v
    root = (pl.get('$top') or {}).get('root')
    out = res(root, 0) if root is not None else {}
    return out if isinstance(out, dict) else {}


def _pnum(d, key, lo=0.0, hi=1.0):
    v = d.get(key)
    return _clamp(float(v), lo, hi) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _zip(data, what='brush file'):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError(f'That {what} is damaged.')
    infos = z.infolist()
    if len(infos) > 20000 or sum(i.file_size for i in infos) > MAX_UNZIPPED:
        raise ValueError('That brush file is too big.')
    return z


def read_procreate(data, filename):
    z = _zip(data, 'Procreate brush file')
    names = {i.filename for i in z.infolist()}
    # a brush's folder also holds a Reset/ copy (Procreate's original, for Reset brush) and, for a combined brush, its
    # second brush in Sub01/: neither is a brush of its own
    archives = sorted(n for n in names if posixpath.basename(n) == 'Brush.archive' and not _procreate_extra(n))
    if not archives:
        raise ValueError('There are no Procreate brushes in that file.')
    set_name = _stem(filename)
    if 'brushset.plist' in names:  # the set's own order and name
        try:
            meta = plistlib.loads(z.read('brushset.plist'))
            order = [str(x) for x in meta.get('brushes') or []]
            archives.sort(key=lambda n: order.index(posixpath.dirname(n)) if posixpath.dirname(n) in order else len(order))
            set_name = str(meta.get('name') or set_name)
        except Exception:
            pass
    out, images, cards = [], [], 0
    for n in archives[:MAX_BRUSHES]:
        folder = posixpath.dirname(n)
        try:
            b = _unarchive(plistlib.loads(z.read(n)))
        except Exception:
            continue
        if _is_title_card(z, names, folder, b):
            cards += 1
            continue
        # a brush without a name (or one of spaces) is called after the set, numbered
        name = b.get('name').strip() if isinstance(b.get('name'), str) and b.get('name').strip() else f'{set_name} {len(out) + 1}'
        settings, notes = _procreate_settings(b)
        combo = _procreate_combo(z, names, folder, b, images)
        if combo is False:
            notes.append('The second brush it is combined with')
        elif combo and combo['tip'] is None and combo.pop('bundled', False):
            notes.append("The tip of its second brush is one of Procreate's own and is not in the file")
        tip = texture = None
        shape, grain = posixpath.join(folder, 'Shape.png'), posixpath.join(folder, 'Grain.png')
        if shape in names:
            images.append({'kind': 'tip', 'name': name, 'png': data_url(z.read(shape)), 'white': True,
                           'invert': bool(b.get('shapeInverted'))})
            tip = len(images) - 1
        else:
            settings['tip'] = 'round'
            if b.get('bundledShapePath'):
                notes.append("Its tip is one of Procreate's own and is not in the file")
        if grain in names:
            images.append({'kind': 'texture', 'name': f'{name} grain', 'png': data_url(z.read(grain)), 'white': False})
            texture = len(images) - 1
            settings.setdefault('textureAmount', 1)
        elif b.get('bundledGrainPath'):
            notes.append("Its grain is one of Procreate's own and is not in the file")
        entry = {'name': name.strip()[:120], 'settings': settings, 'tip': tip, 'texture': texture, 'notes': notes}
        if combo:
            combo.pop('bundled', None)
            entry['combo'] = combo
        out.append(entry)
    if not out:
        raise ValueError('That file holds only title cards, no brushes.' if cards else 'The brushes in that file could not be read.')
    return {'name': set_name, 'brushes': out, 'images': images, 'titleCards': cards}


# Procreate blend modes (as numbered in its files) -> the combine modes KoeStudio has; others paint as Normal
PROCREATE_COMBINE = {1: 'multiply', 8: 'multiply', 10: 'multiply', 19: 'darken', 2: 'screen', 3: 'screen', 9: 'screen',
                     4: 'lighten', 11: 'overlay', 12: 'overlay', 17: 'overlay'}


def _procreate_combo(z, names, folder, b, images):
    """A combined brush's second brush (Sub01/): {name, settings, tip (image index or None), mode}; None when the brush
    is not combined, False when its second brush cannot be read."""
    sub = posixpath.join(folder, 'Sub01', 'Brush.archive')
    if sub not in names:
        return None
    try:
        sb = _unarchive(plistlib.loads(z.read(sub)))
    except Exception:
        return False
    settings, _ = _procreate_settings(sb)
    sub_name = sb.get('name').strip() if isinstance(sb.get('name'), str) and sb.get('name').strip() else 'second brush'
    shape, tip = posixpath.join(folder, 'Sub01', 'Shape.png'), None
    if shape in names:
        images.append({'kind': 'tip', 'name': sub_name, 'png': data_url(z.read(shape)), 'white': True, 'invert': bool(sb.get('shapeInverted'))})
        tip = len(images) - 1
    mode = b.get('dualBlendMode')
    return {'name': sub_name, 'settings': settings, 'tip': tip, 'bundled': tip is None and bool(sb.get('bundledShapePath')),
            'mode': PROCREATE_COMBINE.get(mode, 'normal') if isinstance(mode, int) and not isinstance(mode, bool) else 'normal'}


def _procreate_extra(path):
    """Whether a Brush.archive is a brush's Reset copy or the second half of a combined brush (Sub01, Sub02, ...)."""
    return any(part == 'Reset' or re.fullmatch(r'Sub\d+', part) for part in path.split('/')[:-1])


PROCREATE_SIZE = 150  # px of a Procreate brush at a size of 1 (its slider at full with a maximum size of 100%)
PROCREATE_TAPER = 400  # px of a taper with its length slider at full


def _is_title_card(z, names, folder, b):
    """Whether a brush is a pack's title card (a logo or 'free sample' banner as its tip, with no name): those are
    for show in Procreate's brush library, not for painting."""
    if isinstance(b.get('name'), str) and b['name'].strip():
        return False
    shape = posixpath.join(folder, 'Shape.png')
    if shape not in names:
        return False
    head = z.open(shape).read(24)
    if not head.startswith(b'\x89PNG') or head[12:16] != b'IHDR':
        return False
    w, h = int.from_bytes(head[16:20], 'big'), int.from_bytes(head[20:24], 'big')
    return max(w, h) >= TITLE_CARD_SIDE


TITLE_CARD_SIDE = 1024  # a title card's picture is a big banner; tips of unnamed real brushes are smaller


def _procreate_settings(b):
    """Approximate KoeStudio settings from Procreate's: sliders are 0-1 there."""
    s, notes = {'hardness': 1, 'gamma': 1}, []
    size = _pnum(b, 'paintSize')
    if size is not None:
        # the size slider (0-1) runs between the brush's minimum and maximum size (Brush Studio → Properties)
        lo, hi = _pnum(b, 'minSize', 0, 100) or 0, _pnum(b, 'maxSize', 0, 100)
        hi = max(lo, hi if hi is not None else 1)
        s['size'] = round(_clamp((lo + (hi - lo) * size) * PROCREATE_SIZE, 1, 1000))
    op = _pnum(b, 'paintOpacity')
    if op:
        s['opacity'] = round(_clamp(op, 0.01, 1), 2)
    flow = _pnum(b, 'dynamicsGlazedFlow')
    if flow is not None and flow < 1:  # Rendering → Flow: how much paint each stamp lays down, as Density does
        s['flow'] = round(_clamp(flow, 0.01, 1), 2)
    sp = _pnum(b, 'plotSpacing')
    if sp is not None:
        s['spacing'] = round(_clamp(sp, 0.02, 1), 3)
    sm = _pnum(b, 'plotSmoothing')
    if sm is not None:
        s['smoothing'] = round(sm * 20)
    rot = _pnum(b, 'shapeRotation', -1, 1)
    if rot is not None:
        s['tipFollow'] = abs(rot) >= 0.5
    sc = _pnum(b, 'shapeScatter')
    if sc is not None:
        s['tipRandom'] = round(sc, 2)
    rnd = _pnum(b, 'shapeRoundness')
    if rnd:
        s['thickness'] = round(_clamp(rnd, 0.05, 1), 2)
    ps = _pnum(b, 'dynamicsPressureSize')
    if ps is not None:
        s['pressureSize'] = ps > 0
        s['minSize'] = round(1 - ps, 2)
    po = _pnum(b, 'dynamicsPressureOpacity')
    if po is not None:
        s['pressureOpacity'] = po > 0
        s['minFlow'] = round(1 - po, 2)
    depth = _pnum(b, 'grainDepth')
    if depth is not None:
        s['textureAmount'] = round(depth, 2)
    scale = _pnum(b, 'textureScale', 0, 10)
    if scale:
        s['textureScale'] = round(_clamp(scale, 0.25, 4), 2)
    if isinstance(b.get('grainInverted'), bool):
        s['textureInvert'] = b['grainInverted']
    jit = _pnum(b, 'plotJitter', 0, 2)
    if jit is not None:
        s['scatter'] = round(jit, 2)
    for key, setting in (('dynamicsJitterSize', 'sizeJitter'), ('dynamicsJitterOpacity', 'flowJitter')):
        v = _pnum(b, key)
        if v is not None:
            s[setting] = round(v, 2)
    for key, setting in (('dynamicsSpeedSize', 'speedSize'), ('dynamicsSpeedOpacity', 'speedFlow')):
        v = _pnum(b, key, -1, 1)
        if v:  # faster = thinner / lighter, as Procreate does it
            s[setting] = round(v, 2)
    # Color dynamics: stamp colour jitter (each dab), or else stroke colour jitter (once per stroke). Procreate's
    # Lightness and Darkness move one way each; KoeStudio's Light jitter goes both ways, so it takes the larger
    jitter = {}
    for kind in ('', 'Stroke'):
        hue, sat = _pnum(b, f'dynamicsJitter{kind}Hue') or 0, _pnum(b, f'dynamicsJitter{kind}Saturation') or 0
        light, dark = _pnum(b, f'dynamicsJitter{kind}Lightness') or 0, _pnum(b, f'dynamicsJitter{kind}Darkness') or 0
        if hue or sat or light or dark:
            jitter = {'hueJitter': round(hue, 2), 'satJitter': round(sat, 2), 'valJitter': round(max(light, dark), 2)}
            if kind:
                jitter['colorJitterStroke'] = True
            if abs(light - dark) > 0.05:
                notes.append('Its colour jitter only lightens' if light > dark else 'Its colour jitter only darkens')
            break
    s.update({k: v for k, v in jitter.items() if v})
    # Shape: each stamp mirrored at random, and squashed at random (roundness jitter)
    if b.get('shapeFlipXJitter') is True:
        s['flipX'] = True
    if b.get('shapeFlipYJitter') is True:
        s['flipY'] = True
    rj = _pnum(b, 'jitterShapeRoundness')
    if rj:
        s['roundJitter'] = round(rj, 2)
    # Apple Pencil tilt: bigger and lighter as the pen leans
    for key, setting in (('dynamicsTiltSize', 'tiltSize'), ('dynamicsTiltOpacity', 'tiltFlow')):
        v = _pnum(b, key)
        if v:
            s[setting] = round(v, 2)
    # Stroke taper → Pressure taper (the pen's; taper… without 'pencil' is the finger's Touch taper): lengths 0-1
    start, end = _pnum(b, 'pencilTaperStartLength'), _pnum(b, 'pencilTaperEndLength')
    if start or end:
        if start:
            s['taperIn'] = round(start * PROCREATE_TAPER)
        if end:
            s['taperOut'] = round(end * PROCREATE_TAPER)
        tsize, topac = _pnum(b, 'pencilTaperSize'), _pnum(b, 'pencilTaperOpacity')
        if tsize is not None:
            s['taperSize'] = round(tsize, 2)
        if topac:
            s['taperOpacity'] = round(topac, 2)
    mix = _pnum(b, 'dynamicsMix')
    if mix:  # wet mix: the paint picks up the colours on the canvas
        s['mix'] = round(mix, 2)
    # Procreate's Wet edges slider at full is a soft rim; KoeStudio's at full drains the whole middle, so it is halved
    wet = _pnum(b, 'dynamicsWetEdges') or (_pnum(b, 'wetEdgesAmount') or 0) * 0.5
    if wet:
        s['wetEdges'] = round(wet, 2)
    return s, notes


# ---------- GIMP ----------

def _gbr(data, pos=0):
    """One GIMP brush at pos: (name, width, height, alpha bytes, spacing 0-1 or None, coloured, end position)."""
    r = Reader(data, pos)
    header, version = r.u32(), r.u32()
    if version not in (1, 2) or header < (28 if version == 2 else 20) or header > 4096:
        raise ValueError('That GIMP brush file is damaged.')
    w, h, depth = r.u32(), r.u32(), r.u32()
    spacing = None
    if version == 2:
        if r.take(4) != b'GIMP':
            raise ValueError('That GIMP brush file is damaged.')
        spacing = r.u32() / 100
    if not (0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE) or depth not in (1, 4):
        raise ValueError('That GIMP brush has a size or colour depth KoeStudio cannot read.')
    name = data[r.p:pos + header].split(b'\0', 1)[0].decode('utf-8', 'replace').strip()
    r.p = pos + header
    px = r.take(w * h * depth)
    alpha = px if depth == 1 else px[3::4]
    return name, w, h, alpha, spacing, depth == 4, r.p


def _gimp_brush(name, w, h, alpha, spacing, coloured, notes, images):
    images.append({'kind': 'tip', 'name': name, 'png': data_url(png_bytes(w, h, bytes(w * h), alpha)), 'white': False})
    s = {'size': _clamp(max(w, h), 1, 1000), 'hardness': 1}
    if spacing is not None:
        s['spacing'] = round(_clamp(spacing, 0.02, 1), 3)
    if coloured:
        notes = notes + ['Its colours (the tip paints in your colour, keeping its shape)']
    return {'name': name[:120], 'settings': s, 'tip': len(images) - 1, 'texture': None, 'notes': notes}


def read_gbr(data, filename):
    name, w, h, alpha, spacing, coloured, _ = _gbr(data)
    images = []
    return {'name': _stem(filename), 'brushes': [_gimp_brush(name or _stem(filename), w, h, alpha, spacing, coloured, [], images)], 'images': images}


def _gih_cells(data):
    """(name, number of cells, where the first cell starts) of a GIMP image hose."""
    lines = data.split(b'\n', 2)
    if len(lines) < 3:
        raise ValueError('That GIMP image hose is damaged.')
    m = re.match(rb'\s*(\d+)', lines[1])
    return lines[0].decode('utf-8', 'replace').strip(), int(m.group(1)) if m else 1, len(lines[0]) + len(lines[1]) + 2


def read_gih(data, filename):
    """An image hose: several tips picked in turn or at random as you paint; KoeStudio keeps the first one."""
    name, cells, start = _gih_cells(data)
    name = name or _stem(filename)
    _, w, h, alpha, spacing, coloured, _ = _gbr(data, start)
    notes = [f'Only the first of its {cells} tips (an image hose changes tips as you paint)'] if cells > 1 else []
    images = []
    return {'name': name, 'brushes': [_gimp_brush(name, w, h, alpha, spacing, coloured, notes, images)], 'images': images}


def read_vbr(data, filename):
    """A generated (round or square) GIMP brush: no picture, just its shape."""
    lines = [x.strip() for x in data.decode('utf-8', 'replace').splitlines()]
    if len(lines) < 8 or lines[0] != 'GIMP-VBR':
        raise ValueError('That GIMP brush file is damaged.')
    name, rest, notes = lines[2] or _stem(filename), lines[3:], []
    if lines[1] == '1.5':  # 1.5 adds the shape and the number of spikes after the name
        if len(rest) < 7:
            raise ValueError('That GIMP brush file is damaged.')
        shape, spikes, rest = rest[0], rest[1], rest[2:]
        if shape != 'circle' or (spikes.isdigit() and int(spikes) > 2):
            notes.append('Its square or star shape becomes round')
    try:
        spacing, radius, hardness, aspect, angle = (float(x) for x in rest[:5])
    except ValueError:
        raise ValueError('That GIMP brush file is damaged.')
    if not all(math.isfinite(v) for v in (spacing, radius, hardness, aspect, angle)):
        raise ValueError('That GIMP brush file is damaged.')
    s = {'tip': 'round', 'size': round(_clamp(radius * 2, 1, 1000), 1), 'spacing': round(_clamp(spacing / 100, 0.02, 1), 3),
         'hardness': round(_clamp(hardness, 0, 1), 2), 'thickness': round(_clamp(1 / max(1, aspect), 0.05, 1), 2),
         'tipAngle': round(-angle) % 360}  # GIMP turns counter-clockwise
    return {'name': _stem(filename), 'brushes': [{'name': name[:120], 'settings': s, 'tip': None, 'texture': None, 'notes': notes}], 'images': []}


# ---------- Krita ----------

# Krita's brush engines (paintop ids) other than the ordinary pixel brush, by what Krita calls them
KRITA_ENGINES = {'hairybrush': 'bristle', 'sketchbrush': 'sketch', 'deformbrush': 'deform',
                 'particlebrush': 'particle', 'spraybrush': 'spray', 'experimentbrush': 'shape', 'hatchingbrush': 'hatching',
                 'duplicate': 'clone', 'curvebrush': 'curve', 'filter': 'filter', 'roundmarker': 'quick',
                 'tangentnormal': 'tangent normal', 'gridbrush': 'grid', 'chalkbrush': 'chalk', 'dynabrush': 'dyna'}


def _inflate(b):
    d = zlib.decompressobj()
    out = d.decompress(b, MAX_UNZIPPED)
    if d.unconsumed_tail:
        raise ValueError('That brush file is too big.')
    return out


def png_texts(png):
    """The text chunks (tEXt, zTXt, iTXt) of a PNG as {keyword: text}."""
    out, pos = {}, 8
    while pos + 12 <= len(png):
        n, kind = struct.unpack('>I4s', png[pos:pos + 8])
        body = png[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b'IEND':
            break
        if kind not in (b'tEXt', b'zTXt', b'iTXt') or b'\0' not in body:
            continue
        key, rest = body.split(b'\0', 1)
        try:
            if kind == b'tEXt':
                out[key.decode('latin-1')] = rest.decode('latin-1')
            elif kind == b'zTXt':
                out[key.decode('latin-1')] = _inflate(rest[1:]).decode('latin-1')
            else:
                compressed, rest = rest[0], rest[2:]
                _lang, _tkey, text = rest.split(b'\0', 2)
                out[key.decode('latin-1')] = (_inflate(text) if compressed else text).decode('utf-8')
        except (ValueError, IndexError, zlib.error, UnicodeDecodeError):
            continue
    return out


def _xml(text):
    """Parses XML from a brush file, refusing document types (entity tricks can make a small file enormous)."""
    if '<!DOCTYPE' in text or '<!ENTITY' in text:
        raise ValueError('That Krita brush file has XML KoeStudio does not read.')
    return ET.fromstring(text)


def _kfloat(v, default=None):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _kpp_preset(png):
    """(name, paintop id, {param: text}, XML root) of a .kpp file."""
    if not png.startswith(b'\x89PNG'):
        raise ValueError('That is not a Krita brush preset.')
    text = png_texts(png).get('preset')
    if not text:
        raise ValueError('That PNG is not a Krita brush preset (it has no brush settings).')
    try:
        root = _xml(text)
    except ET.ParseError:
        raise ValueError('That Krita brush preset is damaged.')
    params = {p.get('name'): (p.text or '') for p in root.iter('param') if p.get('name')}
    return root.get('name') or '', root.get('paintopid') or 'paintbrush', params, root


def _kbool(params, key):
    return params[key].strip().lower() == 'true' if key in params else None


def _krita_settings(params, engine):
    """KoeStudio settings, notes, the tip file's name (None for a round tip) and its scale, from a preset's params."""
    s, notes, tip_file, scale = {'gamma': 1}, [], None, 1
    if engine in KRITA_ENGINES:
        notes.append(f"Krita's {KRITA_ENGINES[engine]} brush engine works differently: it imports as an ordinary brush")
    if engine == 'colorsmudge':  # its paint mixes with the canvas: Color mixing, as much as it smudges
        s['mix'] = round(_clamp(_kfloat(params.get('SmudgeRateValue'), 0.5), 0.05, 1), 2)
    for key, setting in (('OpacityValue', 'opacity'), ('FlowValue', 'flow')):
        v = _kfloat(params.get(key))
        if v is not None:
            s[setting] = round(_clamp(v, 0.01, 1), 2)
    for key, setting in (('PressureSize', 'pressureSize'), ('PressureOpacity', 'pressureOpacity')):
        v = _kbool(params, key)
        if v is not None:
            s[setting] = v
    if _kbool(params, 'PressureFlow') and not s.get('pressureOpacity'):
        s['pressureOpacity'] = True
    if _kbool(params, 'Texture/Pattern/Enabled'):
        notes.append('Its texture')
    if _kbool(params, 'PressureRotation') or _kbool(params, 'PressureScatter'):
        notes.append('Tilt, speed or other sensors')
    defn = params.get('brush_definition', '').strip()
    b = None
    if defn:
        try:
            b = _xml(defn)
        except ET.ParseError:
            notes.append('Its tip settings could not be read')
    if b is not None and b.tag != 'Brush':
        b = next(b.iter('Brush'), None)
    if b is None:
        return s, notes, None, 1
    sp = _kfloat(b.get('spacing'))
    if sp is not None:
        s['spacing'] = round(_clamp(sp, 0.02, 1), 3)
    ang = _kfloat(b.get('angle'))
    if ang:
        s['tipAngle'] = round(-math.degrees(ang)) % 360  # radians, counter-clockwise
    scale = _kfloat(b.get('scale'), 1) or 1
    mg = b.find('MaskGenerator')
    if b.get('type') == 'auto_brush' and mg is not None:
        s['tip'] = 'round'
        d = _kfloat(mg.get('diameter'))
        if d:
            s['size'] = round(_clamp(d * scale, 1, 1000), 1)
        ratio = _kfloat(mg.get('ratio'))
        if ratio:
            s['thickness'] = round(_clamp(ratio, 0.05, 1), 2)
        # the fade is where the edge starts to soften, as a share of the radius: 1 = a hard edge
        fade = [f for f in (_kfloat(mg.get('hfade')), _kfloat(mg.get('vfade'))) if f is not None]
        s['hardness'] = round(_clamp(min(fade), 0, 1), 2) if fade else 1
        if mg.get('type') == 'rect' or (_kfloat(mg.get('spikes'), 2) or 2) > 2:
            notes.append('Its square or star shape becomes round')
    elif b.get('filename'):
        tip_file = posixpath.basename(b.get('filename').replace('\\', '/'))
        s['hardness'] = 1
    else:
        s['tip'] = 'round'
        notes.append('Its tip (text or generated) becomes round')
    return s, notes, tip_file, scale


def _krita_tip(name, blob, images):
    """A tip file (.gbr, .gih or an image) added to images; its larger side in px, or None when unreadable."""
    try:
        if blob.startswith(b'\x89PNG'):
            w, h = struct.unpack('>2I', blob[16:24])
            images.append({'kind': 'tip', 'name': name, 'png': data_url(blob), 'white': False})
            return max(w, h)
        start = _gih_cells(blob)[2] if name.lower().endswith('.gih') else 0
        _, w, h, alpha, _, _, _ = _gbr(blob, start)
        images.append({'kind': 'tip', 'name': name, 'png': data_url(png_bytes(w, h, bytes(w * h), alpha)), 'white': False})
        return max(w, h)
    except (ValueError, struct.error):
        return None


def _krita_brush(png, files, images, fallback):
    """One .kpp as a brush. files(name) gives a tip file's bytes from the bundle, or None."""
    name, engine, params, root = _kpp_preset(png)
    s, notes, tip_file, scale = _krita_settings(params, engine)
    tip = None
    if tip_file:
        blob = files(tip_file)
        if blob is None:  # Krita 5 can keep the tip inside the preset itself, as base64
            for res in root.iter():
                if res is not root and res.get('filename') and posixpath.basename(res.get('filename')) == tip_file and (res.text or '').strip():
                    try:
                        blob = base64.b64decode(res.text.strip())
                    except ValueError:
                        blob = None
                    break
        size = _krita_tip(tip_file, blob, images) if blob else None
        if size:
            tip = len(images) - 1
            s['size'] = round(_clamp(size * scale, 1, 1000), 1)
        else:
            s['tip'] = 'round'
            notes.append(f'Its tip picture ({tip_file}) is not in the file')
    return {'name': (name or fallback).strip()[:120], 'settings': s, 'tip': tip, 'texture': None, 'notes': notes}


def read_kpp(data, filename):
    images = []
    return {'name': _stem(filename), 'brushes': [_krita_brush(data, lambda n: None, images, _stem(filename))], 'images': images}


def read_krita_bundle(z, filename):
    names = z.namelist()
    tips = {}
    for n in names:
        if n.startswith('brushes/'):
            tips.setdefault(posixpath.basename(n), n)
    out, images, cache = [], [], {}

    def files(base):
        if base not in tips:
            return None
        if base not in cache:
            cache[base] = z.read(tips[base])
        return cache[base]
    for n in sorted(x for x in names if x.lower().endswith('.kpp'))[:MAX_BRUSHES]:
        try:
            out.append(_krita_brush(z.read(n), files, images, _stem(n)))
        except (ValueError, struct.error, zipfile.BadZipFile):
            continue
    if not out:
        raise ValueError('There are no Krita brush presets in that bundle.')
    title = _stem(filename)
    if 'meta.xml' in names:
        m = re.search(rb'<(?:dc:|meta:)?title>([^<]{1,120})<', z.read('meta.xml'))
        if m:
            title = m.group(1).decode('utf-8', 'replace').strip() or title
    return {'name': title, 'brushes': out, 'images': images}


# ---------- Clip Studio Paint ----------

# an effector's inputs, as ticked in CLIP STUDIO's Dynamics popup (G-pen size 0x30: pen pressure and tilt; Pencil
# density 0xb0: pressure, tilt and random). 0x100 is offered on size and density (not opacity or closed shapes) but
# never ticked in any tool seen, and the popup shows no fifth input
CSP_PRESSURE, CSP_TILT, CSP_VELOCITY, CSP_RANDOM = 0x10, 0x20, 0x40, 0x80
# Starting and ending lengths (BrushInLength, ...) in px for each BrushInLengthUnit seen: 0 is px; 2 shows ten times
# its value in CLIP STUDIO (Real G-Pen's 2.0 reads 20) and draws that many px (measured: a 20 px taper on a 72 dpi
# canvas, the same at brush size 10 and 30, so neither mm nor a share of the size). Other units are noted.
CSP_LENGTH_PX = {0: 1, 2: 10}
CSP_BLOCK = 256
# Starting and ending targets (BrushInOutTarget ids), read off CLIP STUDIO's list: Round watercolor brush ticks only
# 1001 and shows Brush Size, Firework ticks 1001 and 1021 and shows Brush Size, Brush density
CSP_TAPER_SIZE, CSP_TAPER_DENSITY = 1001, 1021
# Gap (BrushAutoIntervalType): 0 Fixed (the slider, BrushInterval), 1 Wide, 2 Normal, 3 Narrow (seen on the G-pen,
# Pencil and Mechanical pencil). The automatic ones grey the slider out and leave its last value behind. Measured in
# CLIP STUDIO with a hard round tip at 10% density, from the steps where each dab starts in exported strokes: Narrow
# 4%, Normal 8% and Wide 12% of the brush size, the same at 20, 100 and 300 px (Fixed 10 measured 10 px exactly)
CSP_AUTO_SPACING = {1: 0.12, 2: 0.08, 3: 0.04}
# a tip's direction (BrushRotationEffector, BrushRotationEffectorInSpray: plain ints, not blobs): 0x40 turns it with the
# line, 0x80 at random; the two lowest bits are always set. Found by comparing the Rake pack's .sut and .abr brushes
# (the Flat rakes, which do not turn in Photoshop, have 3; the turning ones 67)
CSP_LINE_DIRECTION = 0x40


def csp_effector(blob):
    """An effector blob (big-endian): 11 int32 (header size 44, available inputs, enabled inputs, then each input's
    minimum in percent: pressure, tilt, velocity, random; the last is tilt's maximum, 150 on the G-pen and 400 on the
    Pencil, as CLIP STUDIO shows them), then curves: int32 header size 12, point count, point size
    16, then (x, y) float64 pairs; the first is the pen pressure curve. {'pressure', 'tilt', 'velocity', 'random':
    bools, 'pressureMin', 'velocityMin', 'randomMin': 0-1, 'curve': [[x, y], ...] or None}, or None when missing or not
    understood."""
    if not isinstance(blob, bytes) or len(blob) < 44:
        return None
    ints = struct.unpack('>11i', blob[:44])
    if ints[0] < 44 or ints[0] > len(blob):
        return None
    on = ints[2]
    out = {'pressure': bool(on & CSP_PRESSURE), 'tilt': bool(on & CSP_TILT), 'velocity': bool(on & CSP_VELOCITY),
           'random': bool(on & CSP_RANDOM), 'pressureMin': _clamp(ints[3] / 100, 0, 1), 'velocityMin': _clamp(ints[5] / 100, 0, 1),
           'randomMin': _clamp(ints[6] / 100, 0, 1), 'curve': None}
    pos = ints[0]
    if pos + 12 <= len(blob):
        head, n, size = struct.unpack('>3i', blob[pos:pos + 12])
        if head >= 12 and size >= 16 and 2 <= n <= 64 and pos + head + n * size <= len(blob):
            pts = []
            for i in range(n):
                x, y = struct.unpack('>2d', blob[pos + head + i * size:pos + head + i * size + 16])
                if math.isfinite(x) and math.isfinite(y):
                    pts.append([round(_clamp(x, 0, 1), 4), round(_clamp(y, 0, 1), 4)])
            out['curve'] = pts if len(pts) >= 2 else None
    return out


def csp_taper_targets(blob):
    """The settings a Starting and ending taper acts on, from BrushInOutTarget (big-endian int32: header size 12,
    count, entry size 12, then per entry the setting id, ticked, and its minimum in percent): {id: minimum 0-1} of the
    ticked ones, {} when missing or not understood."""
    if not isinstance(blob, bytes) or len(blob) < 12:
        return {}
    head, n, size = struct.unpack('>3i', blob[:12])
    if head < 12 or size < 12 or not 0 <= n <= 256 or head + n * size > len(blob):
        return {}
    out = {}
    for i in range(n):
        sid, on, low = struct.unpack('>3i', blob[head + i * size:head + i * size + 12])
        if on:
            out[sid] = _clamp(low / 100, 0, 1)
    return out


def _straight(curve):
    """Whether a pressure curve is the plain diagonal (or missing), which the default response already does."""
    return not curve or all(abs(x - y) < 0.005 for x, y in curve)


def csp_materials(blob):
    """The materials (tip images, a texture) a Variant blob refers to, as [(path in the file, name)]: [u32 header
    size, u32 count], then per item u32 size, u32 byte length + the UTF-16LE path, and tagged fields (tag 2 = name)."""
    out = []
    if not isinstance(blob, bytes) or len(blob) < 8:
        return out
    head, count = struct.unpack('>2I', blob[:8])
    pos = head
    for _ in range(min(count, 256)):
        if pos + 8 > len(blob):
            break
        size = struct.unpack('>I', blob[pos:pos + 4])[0]
        if size < 8 or pos + size > len(blob):
            break
        item = blob[pos:pos + size]
        n = struct.unpack('>I', item[4:8])[0]
        path, p, name = item[8:8 + n].decode('utf-16-le', 'replace').rstrip('\0'), 8 + n, ''
        while p + 8 <= len(item):
            tag, n = struct.unpack('>2I', item[p:p + 8])
            if n > len(item) - p - 8:
                break
            if tag == 2:
                name = item[p + 8:p + 8 + n].decode('utf-16-le', 'replace').rstrip('\0')
                break
            p += 8 + n
        out.append((path, name or f'Material {len(out) + 1}'))
        pos += size
    return out


def _c2f_database(layer):
    """The database inside a material's .layer (C2F) file as [(offset, plain bytes)], or None."""
    if not layer.startswith(b'\x89C2F\r\n\x1a\n') or layer[12:16] != b'HEAD':
        return None
    parts, pos, at = [], 20, 0
    while pos + 8 <= len(layer):
        n, tag = struct.unpack('<I', layer[pos:pos + 4])[0], layer[pos + 4:pos + 8]
        if tag != b'dATA' or n < 2 or pos + 8 + n > len(layer):
            break
        body = layer[pos + 8:pos + 8 + n]
        if body[:2] == b'\0\0':
            parts.append((at, body[2:]))
            at += n - 2
        else:
            at += n - 10  # a scrambled body has 8 bytes of its own in front
        pos += 12 + n
    return parts or None


def _reader(parts):
    def at(off, n):
        for start, b in parts:
            if start <= off and off + n <= start + len(b):
                return b[off - start:off - start + n]
        return None
    return at, max(start + len(b) for start, b in parts)


def csp_page_sizes(parts):
    """The likely page sizes of an SQLite database given as [(offset, bytes)] whose first page (which says the size)
    is missing, most likely first: the biggest sizes at which most pages still look like b-tree pages (every page
    also lines up with the smaller sizes, so those count as many or a few more)."""
    at, end = _reader(parts)
    good = {}
    for size in (512 << i for i in range(8)):
        good[size] = 0
        for k in range(end // size):
            pg = at(k * size, 8)
            if pg and pg[0] in (2, 5, 10, 13) and 0 < int.from_bytes(pg[3:5], 'big') < size // 4:
                good[size] += 1
    top = max(good.values())
    likely = [s for s in sorted(good, reverse=True) if top and good[s] >= 0.75 * top]
    return likely + [s for s in sorted(good, key=good.get, reverse=True) if s not in likely and good[s]]


def csp_pages(parts, size):
    """The rows of every table on the readable pages (of `size` bytes) of an SQLite database given as [(offset,
    bytes)]: [[values], ...]. Rows spilling onto pages that cannot be read are left out."""
    at, end = _reader(parts)
    rows = []
    for k in range(end // size):
        pg = at(k * size, size)
        if not pg or pg[0] != 13:
            continue
        cells = int.from_bytes(pg[3:5], 'big')
        if 8 + 2 * cells > size:
            continue
        for c in range(cells):
            try:
                row = _sqlite_row(pg, int.from_bytes(pg[8 + 2 * c:10 + 2 * c], 'big'), size, at)
            except (IndexError, ValueError, struct.error):
                continue
            if row is not None:
                rows.append(row)
    return rows


def _varint(b, i):
    v = 0
    for k in range(9):
        c = b[i + k]
        if k == 8:
            return (v << 8) | c, i + 9
        v = (v << 7) | (c & 0x7f)
        if c < 0x80:
            return v, i + k + 1


def _sqlite_row(pg, off, size, at):
    """One table-leaf cell as a list of values, following overflow pages; None when part of it cannot be read."""
    total, i = _varint(pg, off)
    _, i = _varint(pg, i)  # rowid
    room = size - 35
    if total <= room:
        payload = pg[i:i + total]
    else:
        least = (size - 12) * 32 // 255 - 23
        local = least + (total - least) % (size - 4)
        local = local if local <= room else least
        payload, nxt, hops = bytearray(pg[i:i + local]), struct.unpack('>I', pg[i + local:i + local + 4])[0], 0
        while len(payload) < total and nxt and hops < 1 << 20:
            op = at((nxt - 1) * size, size)
            if op is None:
                return None
            payload += op[4:]
            nxt, hops = struct.unpack('>I', op[:4])[0], hops + 1
        if len(payload) < total:
            return None
        payload = bytes(payload[:total])
    head, i = _varint(payload, 0)
    types = []
    while i < head:
        t, i = _varint(payload, i)
        types.append(t)
    vals, j = [], head
    for t in types:
        if 1 <= t <= 6:
            n = (0, 1, 2, 3, 4, 6, 8)[t]
            vals.append(int.from_bytes(payload[j:j + n], 'big', signed=True))
            j += n
        elif t == 7:
            vals.append(struct.unpack('>d', payload[j:j + 8])[0])
            j += 8
        elif t >= 12:
            n = (t - 12) // 2
            vals.append(payload[j:j + n] if t % 2 == 0 else payload[j:j + n].decode('utf-8', 'replace'))
            j += n
        else:
            vals.append(None if t == 0 else t - 8)
    return vals


BEGIN = 'BlockDataBeginChunk'.encode('utf-16-be')


def _offscreen(attr, data):
    """The picture of one Offscreen row: (width, height, gray, alpha, blocks with data), or None."""
    if not attr.startswith(b'\0\0\0\x10') or attr[20:38] != 'Parameter'.encode('utf-16-be'):
        return None
    w, h, cols, rows = struct.unpack('>4I', attr[38:54])
    bpp = struct.unpack('>I', attr[66:70])[0]
    if not (0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE) or cols * CSP_BLOCK < w or rows * CSP_BLOCK < h or bpp not in (1, 2, 5):
        return None
    tile = CSP_BLOCK * CSP_BLOCK
    gray, alpha = bytearray(b'\xff' * (w * h)), bytearray(w * h)
    pos, filled = 0, 0
    while pos + 8 <= len(data):
        size = struct.unpack('>I', data[pos:pos + 4])[0]
        n = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        q = pos + 8 + 2 * n
        if data[pos + 8:q] != BEGIN or size < 8 or pos + size > len(data):
            break  # BlockStatus and BlockCheckSum follow the blocks
        idx, unpacked, bw, bh, has = struct.unpack('>5I', data[q:q + 20])
        if has and idx < cols * rows and (bw, bh) == (CSP_BLOCK, CSP_BLOCK) and unpacked == tile * bpp:
            n = struct.unpack('<I', data[q + 24:q + 28])[0]
            z = zlib.decompressobj()
            raw = z.decompress(data[q + 28:q + 28 + n], unpacked)
            if len(raw) == unpacked:
                filled += 1
                _put_block(raw, idx % cols * CSP_BLOCK, idx // cols * CSP_BLOCK, w, h, bpp, gray, alpha)
        pos += size
    return w, h, gray, alpha, filled


def _put_block(raw, bx, by, w, h, bpp, gray, alpha):
    tile, n = CSP_BLOCK * CSP_BLOCK, min(CSP_BLOCK, w - bx)
    for y in range(min(CSP_BLOCK, h - by)):
        row, src = (by + y) * w + bx, y * CSP_BLOCK
        alpha[row:row + n] = raw[src:src + n]
        if bpp == 2:
            gray[row:row + n] = raw[tile + src:tile + src + n]
        elif bpp == 5:  # B, G, R, x
            px = raw[tile + 4 * src:tile + 4 * (src + n)]
            gray[row:row + n] = bytes((114 * px[i] + 587 * px[i + 1] + 299 * px[i + 2] + 500) // 1000 for i in range(0, 4 * n, 4))
        else:
            gray[row:row + n] = bytes(n)


def csp_material(blob):
    """The picture of a CLIP STUDIO material package (MaterialFile.FileData): (width, height, gray, alpha) of the
    layer holding the most, or None. Ink is dark paint: a pixel's strength is alpha x (255 - gray)."""
    try:
        with tarfile.open(fileobj=io.BytesIO(blob)) as t:
            m = next((m for m in t.getmembers() if m.isfile() and m.name.endswith('.layer') and m.size <= MAX_UNZIPPED), None)
            layer = t.extractfile(m).read() if m else None
    except (tarfile.TarError, OSError, EOFError):
        return None
    parts = _c2f_database(layer) if layer else None
    if not parts:
        return None
    for size in csp_page_sizes(parts):
        best = None
        for row in csp_pages(parts, size):
            attr = next((v for v in row if isinstance(v, bytes) and v[20:38] == 'Parameter'.encode('utf-16-be')), None)
            data = next((v for v in row if isinstance(v, bytes) and v[8:8 + len(BEGIN)] == BEGIN), None)
            if attr is None or data is None:
                continue
            try:
                pic = _offscreen(attr, data)
            except (struct.error, zlib.error, IndexError):
                continue
            if pic and pic[4] and (best is None or pic[4] > best[4]):
                best = pic
        if best:
            return best[:4]
    return None


def _trim(w, h, gray, alpha):
    """A picture cut down to where its alpha is not 0 (a tip's empty margin would make it paint smaller)."""
    rows = [y for y in range(h) if alpha[y * w:(y + 1) * w].count(0) != w]
    if not rows:
        return w, h, gray, alpha
    top, bottom = rows[0], rows[-1] + 1
    left = min(len(alpha[y * w:(y + 1) * w]) - len(alpha[y * w:(y + 1) * w].lstrip(b'\0')) for y in rows)
    right = max(len(alpha[y * w:(y + 1) * w].rstrip(b'\0')) for y in rows)
    nw = right - left
    cut = lambda plane: bytes(b''.join(plane[y * w + left:y * w + right] for y in range(top, bottom)))
    return nw, bottom - top, cut(gray), cut(alpha)


def _mirror(w, h, gray, alpha, flip_x, flip_y):
    order = range(h - 1, -1, -1) if flip_y else range(h)
    pick = (lambda r: r[::-1]) if flip_x else (lambda r: r)
    plane = lambda p: b''.join(pick(p[y * w:(y + 1) * w]) for y in order)
    return w, h, plane(gray), plane(alpha)


def read_sut(data, filename):
    try:
        db = sqlite3.connect(':memory:')
        db.deserialize(data)
    except (sqlite3.DatabaseError, OverflowError, ValueError):
        raise ValueError('That Clip Studio Paint brush file could not be read.')
    try:
        node = _sql_row(db, 'SELECT * FROM Node WHERE NodeVariantID IS NOT NULL AND NodeVariantID > 0 ORDER BY _PW_ID LIMIT 1')
        if not node:
            raise ValueError('That file has no brush in it (it may be a group of tools).')
        v = _sql_row(db, 'SELECT * FROM Variant WHERE VariantID = ?', (node['NodeVariantID'],))
        if not v or v.get('BrushSize') is None:
            raise ValueError('That file is not a brush (it may be another kind of tool).')
        try:
            files = {str(p): b for p, b in db.execute('SELECT OriginalPath, FileData FROM MaterialFile') if isinstance(b, bytes)}
        except sqlite3.DatabaseError:
            files = {}
    except sqlite3.DatabaseError:
        raise ValueError('That Clip Studio Paint brush file could not be read.')
    finally:
        db.close()
    name = node.get('NodeName')
    name = (name.decode('utf-8', 'replace') if isinstance(name, bytes) else str(name or '')).strip()[:120] or _stem(filename)
    settings, notes, tip_ref, tex_ref = _sut_settings(v)
    images, tip, texture = [], None, None
    if tip_ref:
        pic = csp_material(files[tip_ref[0]]) if tip_ref[0] in files else None
        if pic:
            pic = _trim(*pic)
            if v.get('BrushPatternReverseHorizontal') == 1 or v.get('BrushPatternReverseVertical') == 1:
                pic = _mirror(*pic, v.get('BrushPatternReverseHorizontal') == 1, v.get('BrushPatternReverseVertical') == 1)
            w, h, gray, alpha = pic
            images.append({'kind': 'tip', 'name': tip_ref[1], 'png': data_url(png_bytes(w, h, gray, alpha)), 'white': True, 'invert': True})
            tip = 0
        else:
            settings['tip'] = 'round'
            notes.append(f'Its tip picture ({tip_ref[1]}) ' + ('could not be read' if tip_ref[0] in files else 'is not in the file'))
    if tex_ref:
        pic = csp_material(files[tex_ref[0]]) if tex_ref[0] in files else None
        if pic:
            w, h, gray, alpha = pic
            if v.get('TextureBrightness') or v.get('TextureContrast'):
                gray, alpha = csp_texture_tone(gray, alpha, _num(v.get('TextureBrightness'), 0), _num(v.get('TextureContrast'), 0))
            # CLIP STUDIO scales the texture by a percentage of its own size; KoeStudio draws it at the picture's size,
            # so the picture is made that size when saved (up to TEXTURE_SIDE, scaled up beyond that)
            want = max(w, h) * (_num(v.get('TextureScale2'), 100) or 100) / 100
            side = round(_clamp(want, 16, TEXTURE_SIDE))
            settings['textureScale'] = round(_clamp(want / side, 0.25, 4), 2)
            im = {'kind': 'texture', 'name': tex_ref[1], 'png': data_url(png_bytes(w, h, gray, alpha)), 'white': False}
            if side < max(w, h):
                im['side'] = side
            images.append(im)
            texture = len(images) - 1
        else:
            for k in ('textureAmount', 'textureScale', 'textureInvert'):
                settings.pop(k, None)
            notes.append(f'Its texture ({tex_ref[1]}) ' + ('could not be read' if tex_ref[0] in files else 'is not in the file'))
    return {'name': name, 'brushes': [{'name': name, 'settings': settings, 'tip': tip, 'texture': texture, 'notes': notes}], 'images': images}


def csp_texture_tone(gray, alpha, brightness, contrast):
    """A texture picture with CLIP STUDIO's texture Brightness and Contrast (-100 to 100) applied, as (gray, alpha):
    flattened onto white first (see-through is paper, as textureGray in brushtip.js reads it), then brightness moves
    every level by brightness% of the range, and contrast stretches round the middle: slope 1 + c/100 below 0 (flat
    gray at -100), 1 / (1 - c/100) above (a hard threshold at 100), as a Brightness/Contrast filter does."""
    b, c = _clamp(brightness, -100, 100) / 100 * 255, _clamp(contrast, -100, 100) / 100
    slope = 1 + c if c <= 0 else 1 / max(1e-3, 1 - c)
    lut = bytes(int(_clamp(math.floor((x + b - 127.5) * slope + 128), 0, 255)) for x in range(256))  # rounded half up
    flat = bytes(lut[(g * a + 255 * (255 - a) + 127) // 255] for g, a in zip(gray, alpha))
    return flat, bytes([255]) * len(flat)


TEXTURE_SIDE = 1024  # the browser loads textures up to this side (TEXTURE_MAX in brushtip.js)


def _sql_row(db, sql, args=()):
    cur = db.execute(sql, args)
    r = cur.fetchone()
    return dict(zip([c[0] for c in cur.description], r)) if r else None


def _sut_settings(v):
    """KoeStudio settings, notes, and the (path, name) of the tip and texture pictures, from a Variant row."""
    g = lambda k, d=0: d if not isinstance(v.get(k), (int, float)) or isinstance(v.get(k), bool) else v[k]
    s, notes = {'gamma': 1}, []
    s['size'] = round(_clamp(g('BrushSize', 10), 1, 1000), 1)
    if g('BrushSizeUnit'):
        notes.append('Its size in mm or points (check the size)')
    s['opacity'] = round(_clamp(g('Opacity', 100) / 100, 0.01, 1), 2)
    s['flow'] = round(_clamp(g('BrushFlow', 100) / 100, 0.01, 1), 2)
    s['hardness'] = round(_clamp(g('BrushHardness', 100) / 100, 0, 1), 2)
    gap = CSP_AUTO_SPACING.get(g('BrushAutoIntervalType'))
    s['spacing'] = gap if gap else round(_clamp(g('BrushInterval', 10) / 100, MIN_SPACING, 1), 3)
    if g('FlickerReduction'):  # stabilization 0-100
        s['smoothing'] = round(_clamp(g('FlickerReduction') / 5, 0, 20))

    # tip: its picture (the first, when it has several), squash, angle and turning
    tips = csp_materials(v.get('BrushPatternImageArray')) if g('BrushUsePatternImage') else []
    if len(tips) > 1:
        notes.append(f'It switches between {len(tips)} tip pictures (the first is used)')
    s['thickness'] = round(_clamp(g('BrushThickness', 100) / 100, 0.05, 1), 2)
    angle = g('BrushRotation', 0.0) + (90 if s['thickness'] < 1 and not g('BrushVerticalThicknes', 1) else 0)
    s['tipAngle'] = round(angle) % 360
    rot = g('BrushRotationEffector')
    s['tipRandom'] = round(_clamp(g('BrushRotationRandomScale') / 100, 0, 1), 2) if rot & CSP_RANDOM else 0
    s['tipFollow'] = bool(rot & CSP_LINE_DIRECTION)
    th = csp_effector(v.get('BrushThicknessEffector'))
    if th and th['random']:  # each dab squashed at random, down to the minimum
        s['roundJitter'] = round(_clamp(1 - th['randomMin'], 0, 1), 2)
    if th:
        for key, label in (('pressure', 'pen pressure'), ('tilt', 'pen tilt'), ('velocity', 'speed')):
            if th[key]:
                notes.append(f'Tip thickness changing with {label}')

    # Spray: the brush size is the area the particles land in, Particle size their size (a percentage of the brush
    # size when linked to it), Particle density how many per step, and the particles have their own direction.
    # Spacing is a share of the particle. Checked against the Rake pack, whose .sut and .abr Fur Rake and Feathers
    # agree once read this way
    if g('BrushUseSpray'):
        area = s['size']
        part = g('BrushSpraySize', 100) * (area / 100 if g('BrushSpraySizeSyncBrushSize') else 1)
        s['size'] = round(_clamp(part, 1, 1000), 1)
        s['scatter'] = round(_clamp(area / 2 / max(part, 1), 0, 2), 2)
        n = round(g('BrushSprayDensity', 1))
        s['count'] = int(_clamp(n, 1, 16))
        if n > 16:
            notes.append(f'{n} spray particles at a time (16 are used)')
        if g('BrushSprayBias'):
            notes.append('Spray gathered towards the middle')
        rot = g('BrushRotationEffectorInSpray')
        angle = g('BrushRotationInSpray', 0.0) + (90 if s['thickness'] < 1 and not g('BrushVerticalThicknes', 1) else 0)
        s['tipAngle'] = round(angle) % 360
        s['tipFollow'] = bool(rot & CSP_LINE_DIRECTION)
        s['tipRandom'] = round(_clamp(g('BrushRotationRandomInSpray') / 100, 0, 1), 2) if rot & CSP_RANDOM else 0
    ie = csp_effector(v.get('BrushIntervalEffector'))
    if ie and (ie['random'] or ie['pressure']):
        notes.append('Spacing changing ' + ('at random' if ie['random'] else 'with pen pressure'))
    if g('BrushPatternReverseHorizontal') == 2:  # 1 mirrors the picture itself, 2 mirrors dabs at random
        s['flipX'] = True
    if g('BrushPatternReverseVertical') == 2:
        s['flipY'] = True

    # pen pressure, randomness and speed on size and density (opacity changes stand in for density when it has none)
    size = csp_effector(v.get('BrushSizeEffector'))
    if size:
        s['pressureSize'] = size['pressure']
        if size['pressure']:
            s['minSize'] = round(size['pressureMin'], 2)
            if not _straight(size['curve']):
                s['sizeCurve'] = size['curve']
        if size['random']:
            s['sizeJitter'] = round(1 - size['randomMin'], 2)
        if size['velocity']:  # fast strokes thinner, down to the minimum
            s['speedSize'] = round(1 - size['velocityMin'], 2)
        _sut_inputs(size, 'Size', notes)
    flow, op = csp_effector(v.get('BrushFlowEffector')), csp_effector(v.get('BrushOpacityEffector'))
    dens = flow if flow and (flow['pressure'] or not (op and op['pressure'])) else op
    if dens:
        s['pressureOpacity'] = dens['pressure']
        if dens['pressure']:
            s['minFlow'] = round(dens['pressureMin'], 2)
            if not _straight(dens['curve']):
                s['flowCurve'] = dens['curve']
    for e, label in ((flow, 'Density'), (op, 'Opacity')):
        if e and e['random']:
            s['flowJitter'] = max(s.get('flowJitter', 0), round(1 - e['randomMin'], 2))
        if e and e['velocity'] and e is dens:  # fast strokes lighter
            s['speedFlow'] = round(1 - e['velocityMin'], 2)
        if e:
            _sut_inputs(e, label, notes, e is dens)
    if flow and op and flow['pressure'] and op['pressure']:
        notes.append('Opacity changing with pen pressure (density does)')

    # texture: CLIP STUDIO paints where the texture is dark, KoeStudio where its grain is light (so invert)
    tex = None
    t = csp_materials(v.get('TextureImage'))
    if t and g('TextureDensity') > 0:
        tex = t[0]
        s['textureAmount'] = round(_clamp(g('TextureDensity') / 100, 0, 1), 2)
        s['textureInvert'] = not g('TextureReverseDensity')
        if g('TextureForPlot'):  # Apply texture to each dab: the grain is cut out of every dab, so overlaps build up on it
            s['grainPressure'] = True
        if g('TextureRotate'):
            notes.append('Texture turned')
        te = csp_effector(v.get('TextureDensityEffector'))
        if te and te['pressure']:  # stronger as the pen presses harder, from its minimum at the lightest touch
            s['texturePressure'] = round(1 - te['pressureMin'], 2)

    # Starting and ending: CLIP STUDIO tapers only the settings ticked in its list, down to each one's minimum, and
    # only at the ends ticked. Starting and Ending are on in nearly every tool (the G-pen, the rakes) with nothing in
    # the list ticked, and then nothing tapers. How to specify (BrushInOutType): 0 by length, 1 by percentage, 2 fade:
    # a fade has no Starting (greyed out in CLIP STUDIO) and fades the line out the Ending length after its start,
    # whether or not the pen is lifted (not in KoeStudio)
    targets = csp_taper_targets(v.get('BrushInOutTarget'))
    size_min, dens_min = targets.get(CSP_TAPER_SIZE), targets.get(CSP_TAPER_DENSITY)
    ends = [(setting, length, unit, label) for use, length, unit, setting, label in (
        ('BrushUseIn', 'BrushInLength', 'BrushInLengthUnit', 'taperIn', 'Start taper'),
        ('BrushUseOut', 'BrushOutLength', 'BrushOutLengthUnit', 'taperOut', 'End taper')) if g(use)]
    if ends and targets:
        if set(targets) - {CSP_TAPER_SIZE, CSP_TAPER_DENSITY}:
            notes.append('Starting and ending on other settings than size and density')
        if size_min is not None or dens_min is not None:
            kind, tapered = g('BrushInOutType'), False
            for setting, length, unit, label in ends:
                if kind == 1:
                    notes.append(f'{label} as a share of the stroke')
                elif kind == 2:  # CLIP STUDIO greys Starting out for a fade (Greasil Mk2 has it ticked)
                    if setting == 'taperOut':
                        notes.append('Ending as a fade from the start of the line')
                elif g(unit) not in CSP_LENGTH_PX:
                    notes.append(f'{label} in an unknown unit (check the length)')
                elif g(length) > 0:
                    s[setting], tapered = round(_clamp(g(length) * CSP_LENGTH_PX[g(unit)], 1, 500)), True
            if tapered:
                # KoeStudio's taper goes down to 10% of the size at full Taper size, and fades by Taper opacity
                s['taperSize'] = round(_clamp((1 - size_min) / 0.9, 0, 1), 2) if size_min is not None else 0
                if dens_min is not None and dens_min < 1:
                    s['taperOpacity'] = round(1 - dens_min, 2)

    # colour jitter per dab (hue in degrees either way, saturation and value in percent) or once per stroke
    for use, keys, stroke in (('BrushChangePatternColor', ('BrushHueChange', 'BrushSaturationChange', 'BrushValueChange'), False),
                              ('BrushChangeStrokeColor', ('BrushStrokeHueChange', 'BrushStrokeSaturationChange', 'BrushStrokeValueChange'), True)):
        if g(use):
            hue, sat, val = (g(k) for k in keys)
            s.update({k: x for k, x in (('hueJitter', round(_clamp(hue / 180, 0, 1), 2)), ('satJitter', round(_clamp(sat / 100, 0, 1), 2)),
                                        ('valJitter', round(_clamp(val / 100, 0, 1), 2))) if x})
            if stroke:
                s['colorJitterStroke'] = True
            break

    if g('BrushUseWaterColor') or g('BrushUseWaterColor2'):
        # Color mixing. BrushMixColor is Amount of paint (the brush colour's share: every blender in CLIP STUDIO's own
        # tools has 0), BrushMixAlpha Density of paint (how much paint of its own it lays: 0 in the blenders),
        # BrushMixColorExtension Color stretch: KoeStudio's mix (the canvas colour's share), paintLoad and mixStretch
        s['mix'] = round(_clamp(1 - g('BrushMixColor', 50) / 100, 0.05, 1), 2)
        if g('BrushMixAlpha', 100) < 100:
            s['paintLoad'] = round(_clamp(g('BrushMixAlpha', 100) / 100, 0, 1), 2)
        if isinstance(v.get('BrushMixColorExtension'), (int, float)):
            s['mixStretch'] = round(_clamp(g('BrushMixColorExtension') / 100, 0, 1), 2)
    if g('BrushUseWaterEdge'):
        s['wetEdges'] = round(_clamp(g('BrushWaterEdgeAlphaPower', 50) / 100, 0.05, 1), 2)
    for col, label in (('UseDualBrush', 'Dual brush'), ('BrushRibbon', 'Ribbon'),
                       ('BrushUseVectorEraser', 'Vector eraser'), ('CompositeMode', 'Blending mode')):
        if g(col):
            notes.append(label)
    return s, notes, tips[0] if tips else None, tex


def _sut_inputs(e, what, notes, speed=True):
    """Notes for an effector's inputs KoeStudio has no match for (speed is matched where `speed`)."""
    for key, label in (('tilt', 'pen tilt'), ('velocity', 'speed')):
        if e[key] and not (key == 'velocity' and speed):
            notes.append(f'{what} changing with {label}')


# ---------- entry point ----------

def _stem(filename):
    base = posixpath.basename((filename or '').replace('\\', '/'))
    return (base.rsplit('.', 1)[0] if '.' in base else base).strip()[:120] or 'Imported brushes'


def import_brushes(filename, data):
    if not isinstance(data, bytes) or not data:
        raise ValueError('That file is empty.')
    if len(data) > MAX_FILE:
        raise ValueError('That brush file is too big.')
    ext = (filename or '').lower().rsplit('.', 1)[-1]
    if data.startswith(b'PK\x03\x04'):
        z = _zip(data)
        if any(n.lower().endswith('.kpp') for n in z.namelist()):
            return read_krita_bundle(z, filename)
        return read_procreate(data, filename)
    if data.startswith(b'SQLite format 3\0'):
        return read_sut(data, filename)
    if data.startswith(b'\x89PNG'):
        return read_kpp(data, filename)
    if data.startswith(b'GIMP-VBR'):
        return read_vbr(data, filename)
    if data[20:24] == b'GIMP' or (ext == 'gbr' and len(data) >= 20):
        return read_gbr(data, filename)
    if ext == 'gih' or re.match(rb'[^\n]{0,256}\n\s*\d+ ncells:', data[:400]):
        return read_gih(data, filename)
    if len(data) >= 4 and struct.unpack('>H', data[:2])[0] in (1, 2, 6, 7, 9, 10):
        return read_abr(data, filename)
    raise ValueError('That is not a brush file KoeStudio can read (Procreate .brush/.brushset, Photoshop .abr, '
                     'Clip Studio Paint .sut, GIMP .gbr/.gih/.vbr, Krita .kpp/.bundle).')
