"""Reads the settings of a Clip Studio Paint brush (.sut, an exported sub tool) for KoeStudio's brush import.

A .sut file is an SQLite database. The Node table names the brush, and the Variant row it points to holds the
settings as plain columns: sizes and percentages, plus "effector" blobs describing what pen pressure (and tilt,
speed, randomness) does to a setting. Tip shapes and paper textures are embedded as CLIP STUDIO material packages
whose contents are encrypted, so only their names are read here; the user supplies those images as PNGs.

Effector blob (big-endian): 11 int32 (header size 44, available inputs, enabled inputs, then each input's minimum
in percent: pressure, tilt, velocity, random), followed by curves: int32 header size 12, point count, point size 16,
then (x, y) float64 pairs. The first curve is the pen pressure curve. Input bits: 0x10 pressure, 0x20 tilt,
0x40 velocity, 0x80 random.
"""
import os
import sqlite3
import struct
import tempfile

PRESSURE, TILT, VELOCITY, RANDOM = 0x10, 0x20, 0x40, 0x80
MAX_SUT = 64 * 1024 * 1024


def effector(blob):
    """{'pressure', 'tilt', 'velocity', 'random': bools, 'pressureMin', 'randomMin': 0-1, 'curve': [[x, y]] or None}
    for an effector blob, or None when it is missing or not understood."""
    if not isinstance(blob, bytes) or len(blob) < 44:
        return None
    ints = struct.unpack('>11i', blob[:44])
    if ints[0] < 44 or ints[0] > len(blob):
        return None
    on = ints[2]
    out = {'pressure': bool(on & PRESSURE), 'tilt': bool(on & TILT), 'velocity': bool(on & VELOCITY), 'random': bool(on & RANDOM),
           'pressureMin': _pct(ints[3]), 'randomMin': _pct(ints[6]), 'curve': None}
    pos = ints[0]
    if pos + 12 <= len(blob):
        head, n, size = struct.unpack('>3i', blob[pos:pos + 12])
        if head >= 12 and size >= 16 and 2 <= n <= 64 and pos + head + n * size <= len(blob):
            pts = []
            for i in range(n):
                x, y = struct.unpack('>2d', blob[pos + head + i * size:pos + head + i * size + 16])
                pts.append([round(min(1, max(0, x)), 4), round(min(1, max(0, y)), 4)])
            out['curve'] = pts
    return out


def _pct(v):
    return min(1, max(0, v / 100))


def straight(curve):
    """True when a pressure curve is the plain diagonal (or missing), so the default response does the same."""
    return not curve or all(abs(x - y) < 0.005 for x, y in curve)


def material_names(blob):
    """The names of the materials (tip images, a texture) a pattern/texture blob refers to: [u32 header size, u32
    count], then per item u32 size, a length-prefixed UTF-16 path, and tagged fields (tag 2 = the name)."""
    names = []
    if not isinstance(blob, bytes) or len(blob) < 8:
        return names
    head, count = struct.unpack('>2I', blob[:8])
    pos = head
    for _ in range(min(count, 256)):
        if pos + 8 > len(blob):
            break
        size = struct.unpack('>I', blob[pos:pos + 4])[0]
        if size < 8 or pos + size > len(blob):
            break
        item, p, name = blob[pos:pos + size], 4, ''
        n = struct.unpack('>I', item[p:p + 4])[0]
        p += 4 + n  # the path inside the package
        while p + 8 <= len(item):
            tag, n = struct.unpack('>2I', item[p:p + 8])
            if n > len(item) - p - 8:
                break
            text = item[p + 8:p + 8 + n].decode('utf-16-le', 'replace').rstrip('\0')
            if tag == 2:
                name = text
                break
            p += 8 + n
        names.append(name or f'Material {len(names) + 1}')
        pos += size
    return names


def brush_from_sut(data):
    """The brush in a .sut file's bytes: {'name', 'settings' (KoeStudio paint-tool settings), 'tips' (names of the tip
    images it uses), 'texture' (name of its paper texture or None), 'notes' (what could not be carried over),
    'icon' (PNG bytes or None)}."""
    if not isinstance(data, bytes) or not data.startswith(b'SQLite format 3\0'):
        raise ValueError('That is not a Clip Studio Paint brush (.sut) file.')
    if len(data) > MAX_SUT:
        raise ValueError('That brush file is too big.')
    fd, path = tempfile.mkstemp(suffix='.sut')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        try:
            return _read(db)
        finally:
            db.close()
    except sqlite3.DatabaseError:
        raise ValueError('That brush file could not be read.')
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _row(db, sql, args=()):
    cur = db.execute(sql, args)
    r = cur.fetchone()
    return dict(zip([c[0] for c in cur.description], r)) if r else None


def _read(db):
    node = _row(db, 'SELECT * FROM Node WHERE NodeVariantID IS NOT NULL AND NodeVariantID > 0 ORDER BY _PW_ID LIMIT 1')
    if not node:
        raise ValueError('That file has no brush in it (it may be a group of tools).')
    v = _row(db, 'SELECT * FROM Variant WHERE VariantID = ?', (node['NodeVariantID'],))
    if not v or v.get('BrushSize') is None:
        raise ValueError('That file is not a brush (it may be another kind of tool).')
    g = lambda k, d=0: d if v.get(k) is None else v[k]
    s, notes = {}, []

    s['size'] = round(min(1000, max(1, g('BrushSize', 10))), 1)
    if g('BrushSizeUnit'):
        notes.append('Brush size was not in pixels; check the size')
    s['opacity'] = _pct(g('Opacity', 100)) or 1
    s['flow'] = max(0.01, _pct(g('BrushFlow', 100)))
    s['hardness'] = _pct(g('BrushHardness', 100))
    s['spacing'] = round(min(1, max(0.02, g('BrushInterval', 10) / 100)), 3)

    # tip shape
    tips = material_names(v.get('BrushPatternImageArray')) if g('BrushUsePatternImage') else []
    if len(tips) > 1:
        notes.append(f'It switches between {len(tips)} tip images; KoeStudio uses one')
    s['thickness'] = round(max(0.05, _pct(g('BrushThickness', 100))), 2)
    angle = g('BrushRotation', 0.0) + (90 if s['thickness'] < 1 and not g('BrushVerticalThicknes', 1) else 0)
    s['tipAngle'] = round(angle % 360)
    rot = g('BrushRotationEffector', 0)
    s['tipRandom'] = _pct(g('BrushRotationRandomScale', 0)) if rot & RANDOM else 0
    s['tipFollow'] = bool(rot & 1)

    # pen pressure
    size = effector(v.get('BrushSizeEffector'))
    if size:
        s['pressureSize'] = size['pressure']
        s['minSize'] = size['pressureMin']
        s['sizeCurve'] = None if straight(size['curve']) else size['curve']
        _extra_inputs(size, 'size', notes)
    flow = effector(v.get('BrushFlowEffector'))
    if flow:
        s['pressureOpacity'] = flow['pressure']
        s['minFlow'] = flow['pressureMin']
        s['flowCurve'] = None if straight(flow['curve']) else flow['curve']
        _extra_inputs(flow, 'density', notes)
    op = effector(v.get('BrushOpacityEffector'))
    if op and (op['pressure'] or op['tilt'] or op['velocity'] or op['random']):
        notes.append('Opacity changing with pen pressure (density does instead)')
    if s.get('pressureSize') or s.get('pressureOpacity'):
        s['gamma'] = 1

    # paper texture
    texture = None
    if v.get('TextureImage') is not None and g('TextureDensity') > 0:
        names = material_names(v.get('TextureImage'))
        texture = names[0] if names else 'Texture'
        s['textureAmount'] = _pct(g('TextureDensity'))
        s['textureScale'] = round(min(4, max(0.25, g('TextureScale2', 100) / 100)), 2)
        s['textureInvert'] = bool(g('TextureReverseDensity'))
        if g('TextureBrightness') or g('TextureContrast'):
            notes.append('Texture brightness and contrast')
        tex = effector(v.get('TextureDensityEffector'))
        if tex and tex['pressure']:
            notes.append('Texture strength changing with pen pressure')

    for col, label in (('BrushUseWaterColor', 'Color mixing'), ('BrushUseWaterColor2', 'Color mixing'),
                       ('BrushUseSpray', 'Spray'), ('UseDualBrush', 'Dual brush'), ('BrushUseWaterEdge', 'Watercolor edge'),
                       ('BrushRibbon', 'Ribbon'), ('BrushUseIn', 'Starting taper'), ('BrushUseOut', 'Ending taper'),
                       ('BrushChangePatternColor', 'Color jitter'), ('BrushChangeStrokeColor', 'Color jitter per stroke'),
                       ('BrushUseVectorEraser', 'Vector eraser'), ('CompositeMode', 'Blending mode')):
        if g(col) and label not in notes:
            notes.append(label)

    icon = node.get('NodeCustomIcon')
    return {'name': _name(node.get('NodeName')), 'settings': s, 'tips': tips, 'texture': texture, 'notes': notes,
            'icon': icon if isinstance(icon, bytes) and icon.startswith(b'\x89PNG') else None}


def _extra_inputs(e, what, notes):
    for key, label in (('tilt', 'pen tilt'), ('velocity', 'speed'), ('random', 'randomness')):
        if e[key]:
            notes.append(f'{what.capitalize()} changing with {label}')


def _name(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', 'replace')
    return (raw or 'Imported brush').strip()[:120] or 'Imported brush'
