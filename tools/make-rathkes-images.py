"""Images for Rathkes gate 1C, flat 501 (issue #166): cut from the owner's own photos, never redrawn.

  python tools/make-rathkes-images.py <5-record-wall-cabinet.jpg> <6-picture-above-table.jpg>
      perspective-corrects the ten LP covers on the record wall into one atlas (assets/rathkes/record-covers.jpg, 4 x 3 cells
      of 256 px, cells 10 and 11 empty) and the canvas print above the living-room table into assets/rathkes/canvas-print.jpg
      (its real proportions from the mean of opposite edges, nothing cropped or retouched), then writes the JS file.
  python tools/make-rathkes-images.py
      only rewrites rathkes-501-images.js (window.RATHKES_501_IMAGES = {covers, print} as data URLs) from the two JPEGs, so the
      single-file build (which inlines scripts only) and the Worker get them.
The photos themselves stay outside the repository (the owner's).
"""
import base64, sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'assets' / 'rathkes'

# Corners (top-left, top-right, bottom-right, bottom-left) in the 2016 x 1512 photos, read off zoomed crops.
S = 2016 / 2000  # the cover corners were read on a 2000 px wide view
COVERS = [  # row 1: over column 1, over column 3 (higher); row 2 and row 3: four each, left to right
    [(640, 250), (777, 225), (770, 380), (624, 402)], [(1073, 145), (1250, 128), (1252, 315), (1062, 335)],
    [(623, 455), (757, 440), (749, 600), (605, 615)], [(823, 432), (988, 419), (970, 592), (808, 605)],
    [(1047, 397), (1230, 382), (1228, 567), (1035, 582)], [(1322, 365), (1527, 348), (1525, 550), (1303, 562)],
    [(598, 672), (744, 658), (737, 822), (585, 832)], [(807, 670), (965, 660), (962, 830), (792, 840)],
    [(1043, 650), (1220, 640), (1222, 825), (1030, 838)], [(1300, 640), (1510, 625), (1500, 825), (1290, 838)]]
PRINT = [(36, 129), (2009, 114), (1956, 1505), (21, 1375)]


def coeffs(dst_size, quad):
    """PIL PERSPECTIVE coefficients mapping the output rectangle onto the quad in the source."""
    w, h = dst_size
    rect = [(0, 0), (w, 0), (w, h), (0, h)]
    A, B = [], []
    for (x, y), (u, v) in zip(rect, quad):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()


def warp(img, quad, size):
    return img.transform(size, Image.PERSPECTIVE, coeffs(size, quad), Image.BICUBIC)


def cut(wall_photo, print_photo):
    out.mkdir(parents=True, exist_ok=True)
    wall = Image.open(wall_photo).convert('RGB')
    atlas = Image.new('RGB', (1024, 768), (200, 190, 175))
    for i, q in enumerate(COVERS):
        atlas.paste(warp(wall, [(x * S, y * S) for x, y in q], (256, 256)), ((i % 4) * 256, (i // 4) * 256))
    atlas.save(out / 'record-covers.jpg', quality=80, optimize=True)
    pic = Image.open(print_photo).convert('RGB')
    d = lambda p, q: ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** .5
    tl, tr, br, bl = PRINT
    aspect = (d(tl, tr) + d(bl, br)) / (d(tl, bl) + d(tr, br))
    W = 1024
    warp(pic, PRINT, (W, round(W / aspect))).save(out / 'canvas-print.jpg', quality=85, optimize=True)
    print(f'canvas print aspect {aspect:.3f}')


def js():
    data = {k: 'data:image/jpeg;base64,' + base64.b64encode((out / f).read_bytes()).decode() for k, f in (('covers', 'record-covers.jpg'), ('print', 'canvas-print.jpg'))}
    size = {k: Image.open(out / f).size for k, f in (('covers', 'record-covers.jpg'), ('print', 'canvas-print.jpg'))}
    # The print's sides (the image wraps round the stretcher): the mean colour of its outer 8 px.
    a = np.asarray(Image.open(out / 'canvas-print.jpg').convert('RGB')).astype(float)
    rim = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]).mean(0)
    edge = {'print': ', edge: 0x' + ''.join(f'{int(round(c)):02x}' for c in rim), 'covers': ''}
    body = ',\n'.join(f"  {k}: {{w: {size[k][0]}, h: {size[k][1]}{edge[k]}, src: '{v}'}}" for k, v in data.items())
    (root / 'rathkes-501-images.js').write_text(
        '/* Flat 501 (issue #166): the ten LP covers on the record wall and the canvas print above the living-room table, cut from the\n'
        ' * owner\'s own photos by tools/make-rathkes-images.py (assets/rathkes/). Generated: do not edit. */\n'
        '(function (root) {root.RATHKES_501_IMAGES = {\n' + body + '\n};})(typeof window === \'undefined\' ? globalThis : window);\n', encoding='utf-8')
    for k in data: print(k, size[k], (out / dict(covers='record-covers.jpg', print='canvas-print.jpg')[k]).stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    if len(sys.argv) == 3: cut(sys.argv[1], sys.argv[2])
    js()
