"""Generates web/icon.ico and web/icon.png: a tapered brush stroke and a paint dot on a blue-violet tile.

Standard library only. Each size is rendered separately and anti-aliased by supersampling.
Usage:  python tools/make_icon.py
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = [16, 24, 32, 48, 64, 128, 256]
TOP, BOTTOM = (92, 120, 255), (120, 52, 196)
STROKE = (255, 255, 255)
DOT = (255, 138, 120)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def bezier(t):
    # S-shaped stroke across the tile, in 0..1 units
    p0, p1, p2, p3 = (0.22, 0.74), (0.38, 0.20), (0.62, 0.86), (0.80, 0.28)
    u = 1 - t
    return (u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1])


CURVE = [bezier(i / 160) for i in range(161)]


def stroke_hit(x, y, size):
    """True when (x, y) lies on the stroke, which is thick in the middle and tapers at both ends."""
    width = 0.085 if size >= 32 else 0.11
    for i, (cx, cy) in enumerate(CURVE):
        t = i / 160
        r = width * (0.25 + 0.75 * math.sin(math.pi * t) ** 0.6)
        if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
            return True
    return False


def in_tile(x, y, radius=0.2):
    # rounded square from 0.04 to 0.96
    lo, hi = 0.04, 0.96
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius and lo <= x <= hi and lo <= y <= hi


def render(size):
    ss = 4
    px = bytearray()
    for j in range(size):
        px.append(0)  # PNG filter byte
        for i in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) / size
                    y = (j + (sj + 0.5) / ss) / size
                    if not in_tile(x, y):
                        continue
                    col = lerp(TOP, BOTTOM, y)
                    if (x - 0.78) ** 2 + (y - 0.74) ** 2 <= 0.075 ** 2:
                        col = DOT
                    elif stroke_hit(x, y, size):
                        col = STROKE
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 1
            n = ss * ss
            if acc[3]:
                px += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(255 * acc[3] / n)])
            else:
                px += b'\0\0\0\0'
    return png(size, size, bytes(px))


def png(w, h, raw):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def ico(images):
    head = struct.pack('<HHH', 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b'', b''
    for size, data in images:
        entries += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return head + entries + blobs


def main():
    images = [(s, render(s)) for s in SIZES]
    web = os.path.join(ROOT, 'web')
    with open(os.path.join(web, 'icon.ico'), 'wb') as f:
        f.write(ico(images))
    with open(os.path.join(web, 'icon.png'), 'wb') as f:
        f.write(dict(images)[128])
    print('Wrote web/icon.ico and web/icon.png')


if __name__ == '__main__':
    main()
