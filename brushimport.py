"""Imports brushes from Procreate (.brush, .brushset) and Photoshop (.abr) files for KoeStudio's brush library.

import_brushes(filename, data) -> {'name', 'brushes': [{name, settings, tip, texture, notes}], 'images': [{kind,
name, png, white}]}: settings are KoeStudio paint-tool settings (checked again in the browser), tip / texture index
into images (shared images appear once), png is a data URL. white=True marks a Procreate shape, where white is
paint: the browser turns it into a transparent tip before saving it.

Procreate: a ZIP holding, per brush, Brush.archive (an NSKeyedArchiver property list of the brush's settings),
Shape.png (the tip) and Grain.png (the texture); a .brushset adds brushset.plist with the brushes' order. The
setting names are not documented by Procreate, so each one read here is optional and range-checked.

Photoshop ABR, versions 1-2: a list of brushes (sampled tips stored inline). Versions 6-10: '8BIM' sections:
'samp' (the tip images, 8 or 16 bit, raw or PackBits), 'patt' (texture patterns, as in PSD files) and 'desc' (an
action descriptor with each brush's settings, pointing at its tip by id). All numbers are big-endian.
"""
import base64
import io
import plistlib
import posixpath
import struct
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

DIRECTION, INITIAL_DIRECTION, PEN_PRESSURE = 6, 5, 2  # 'bVTy' controls: off, fade, pressure, tilt, wheel, ...


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
                'size': _clamp(max(w, h), 1, 1000), 'spacing': _clamp((spacing or 25) / 100, 0.02, 1), 'hardness': 1}})
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
            settings, notes, sid, tex = _abr_settings(b)
            tip = tip_image(sid, name) if sid in samples else None
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
            out.append({'name': name.strip() or f'Brush {i + 1}', 'settings': settings, 'tip': tip, 'texture': texture, 'notes': notes})
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
        s['spacing'] = round(_clamp(sp / 100 if shape.get('Intr', True) else 0.1, 0.02, 1), 3)
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
        s['sizeJitter'] = round(_clamp(jitter, 0, 1), 2)
        control, jitter, _ = _dyn(b, 'angleDynamics')
        s['tipRandom'] = round(_clamp(jitter, 0, 1), 2)
        s['tipFollow'] = control in (DIRECTION, INITIAL_DIRECTION)
        if _dyn(b, 'roundnessDynamics')[1]:
            notes.append('Roundness jitter')
    else:
        s['pressureSize'] = False
    if b.get('usePaintDynamics'):
        fc, fj, fmin = _dyn(b, 'prVr')
        oc, oj, omin = _dyn(b, 'opVr')
        s['pressureOpacity'] = PEN_PRESSURE in (fc, oc)
        s['minFlow'] = round(fmin if fc == PEN_PRESSURE else omin, 2)
        s['flowJitter'] = round(_clamp(max(fj, oj), 0, 1), 2)
    else:
        s['pressureOpacity'] = False
    if b.get('useScatter'):
        s['scatter'] = round(_clamp(_dyn(b, 'scatterDynamics')[1], 0, 2), 2)  # Photoshop: a share of the diameter
        if (_num(b.get('Cnt '), 1) or 1) > 1:
            notes.append('Several dabs per step (count)')
    tex = None
    t = b.get('Txtr')
    if b.get('useTexture') and isinstance(t, dict):
        tex = t.get('Idnt') if isinstance(t.get('Idnt'), str) else None
        s['textureAmount'] = round(_clamp(_num(b.get('textureDepth'), 100) / 100, 0, 1), 2)
        s['textureScale'] = round(_clamp(_num(b.get('textureScale'), 100) / 100, 0.25, 4), 2)
        s['textureInvert'] = bool(b.get('InvT'))
    for key, label in (('useDualBrush', 'Dual brush'), ('useColorDynamics', 'Color dynamics'), ('Wtdg', 'Wet edges'), ('Nose', 'Noise')):
        if b.get(key):
            notes.append(label)
    opts = b.get('toolOptions') if isinstance(b.get('toolOptions'), dict) else {}
    op, fl = _num(opts.get('Opct')), _num(opts.get('flow'))
    if op is not None:
        s['opacity'] = round(_clamp(op / 100, 0.01, 1), 2)
    if fl is not None:
        s['flow'] = round(_clamp(fl / 100, 0.01, 1), 2)
    s['gamma'] = 1
    return s, notes, sid, tex


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


def read_procreate(data, filename):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError('That Procreate brush file is damaged.')
    infos = z.infolist()
    if len(infos) > 20000 or sum(i.file_size for i in infos) > MAX_UNZIPPED:
        raise ValueError('That brush file is too big.')
    names = {i.filename for i in infos}
    archives = sorted(n for n in names if posixpath.basename(n) == 'Brush.archive')
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
    out, images = [], []
    for n in archives[:MAX_BRUSHES]:
        folder = posixpath.dirname(n)
        try:
            b = _unarchive(plistlib.loads(z.read(n)))
        except Exception:
            continue
        name = b.get('name') if isinstance(b.get('name'), str) and b.get('name').strip() else (folder or set_name)
        settings, notes = _procreate_settings(b)
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
        out.append({'name': name.strip()[:120], 'settings': settings, 'tip': tip, 'texture': texture, 'notes': notes})
    if not out:
        raise ValueError('The brushes in that file could not be read.')
    return {'name': set_name, 'brushes': out, 'images': images}


def _procreate_settings(b):
    """Approximate KoeStudio settings from Procreate's: sliders are 0-1 there."""
    s, notes = {'hardness': 1, 'gamma': 1}, []
    size = _pnum(b, 'paintSize')
    if size is not None:
        s['size'] = round(_clamp(3 + 297 * size * size, 1, 1000))  # Procreate's size slider is roughly quadratic
    op = _pnum(b, 'paintOpacity')
    if op:
        s['opacity'] = round(_clamp(op, 0.01, 1), 2)
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
    if b.get('dynamicsSpeedSize') or b.get('dynamicsSpeedOpacity'):
        notes.append('Speed effects')
    if b.get('dynamicsWetEdges') or b.get('dynamicsMix'):
        notes.append('Wet mixing')
    return s, notes


# ---------- entry point ----------

def _stem(filename):
    base = posixpath.basename((filename or '').replace('\\', '/'))
    return (base.rsplit('.', 1)[0] if '.' in base else base).strip()[:120] or 'Imported brushes'


def import_brushes(filename, data):
    if not isinstance(data, bytes) or not data:
        raise ValueError('That file is empty.')
    if len(data) > MAX_FILE:
        raise ValueError('That brush file is too big.')
    if data.startswith(b'PK\x03\x04'):
        return read_procreate(data, filename)
    if len(data) >= 4 and struct.unpack('>H', data[:2])[0] in (1, 2, 6, 7, 9, 10):
        return read_abr(data, filename)
    raise ValueError('That is not a Procreate (.brush, .brushset) or Photoshop (.abr) brush file.')
