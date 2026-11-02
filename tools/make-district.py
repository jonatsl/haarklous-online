"""Build <name>-data.js, one district patch of the world (issue #38, 2 Nov 2026: Gamle Oslo, Ensjø and the way there).

    python tools/make-district.py [name [x0 s0 x1 s1]]      (default: gamle-oslo -1600 560 1792 4000; after tools/fetch-district.py)
    then python build.py (add a <script src="<name>-data.js"> line to index.html for a new patch)

The user's wish: real streets, real ground heights and buildings in their real places (not exact copies), some key
buildings modelled, parks real but light, the area between home and Gamle Oslo / Ensjø lighter but with real topography,
and at least the buildings along Trondheimsveien. The old world (+/-800 m round Haarklous plass, surroundings-data.js) is
not changed: a patch only adds what lies outside it, so vehicle numbers and places online stay the same. Patches may
overlap the old square but not each other; box values are multiples of 16 (the far terrain uses a 16 m grid).

Local frame as surroundings-data.js: metres east (x) and south (s) of the address node 59.936404 N 10.776657 E.
Output: (window.DISTRICTS = window.DISTRICTS || []).push({...}) with
- grid: ground heights on an 8 m grid over the box (decimetres relative to the stair door, the same reference as
  SURROUNDINGS.terrain); points inside the old +/-800 m grid copy its values exactly, so the two meet. Rows are
  delta-coded bytes (escape -128 + int16 for big steps), base64.
- play: the walkable rectangle (the box less 40 m); tiles: 400 m building tiles (int16 streams, see the building loop).
- roads / areas: uint16 streams in decimetres from o16; sea: polygons where the terrain model is at sea level.
- trees (OSM natural=tree), chimneys (man_made=chimney with a height), landmarks (modelled key buildings), places, stations,
  route (gamle-oslo: the Ensjø -> Rathkes gate run asked for in issue #38).
Map data (c) OpenStreetMap contributors (ODbL). Height data (c) Kartverket (CC BY 4.0).
"""
import base64
import gzip
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'gamle-oslo'
BOXES = {'gamle-oslo': (-1600, 560, 1792, 4000)}
GX0, GS0, GX1, GS1 = tuple(int(v) for v in sys.argv[2:6]) if len(sys.argv) >= 6 else BOXES[NAME]
assert all(v % 16 == 0 for v in (GX0, GS0, GX1, GS1)), 'box values must be multiples of 16'
STEP = 8
PLAY = (GX0 + 40, GS0 + 40, GX1 - 40, GS1 - 40)
TILE = 400
OX, OS = GX0 - 48, GS0 - 64                         # origin of the uint16 decimetre coordinates
assert GX1 + 50 - OX < 6500 and GS1 + 60 - OS < 6500, 'box too big for uint16 decimetres'
CLIP = box(OX, OS, GX1 + 50, GS1 + 60)
A_HALF = 800                                        # the old terrain grid (surroundings-data.js)

src = open(os.path.join(ROOT, 'surroundings-data.js'), encoding='utf-8').read()
D = json.loads(src[src.index('{'):src.rindex('}') + 1])
LAT0, LON0 = D['origin']['lat'], D['origin']['lon']
KX = 111320 * math.cos(math.radians(LAT0))
ter = D['terrain']
A = np.frombuffer(base64.b64decode(ter['dm']), dtype='<i2').reshape(ter['n'], ter['n'])
assert ter['half'] == A_HALF and ter['step'] == 4
osm = json.load(gzip.open(os.path.join(ROOT, f'assets/osm/{NAME}-osm.json.gz'), 'rt', encoding='utf-8'))['elements']
local = lambda p: ((p['lon'] - LON0) * KX, -(p['lat'] - LAT0) * 111320)


# ---------------- Terrain ----------------
def to_utm33(lat, lon):                     # the same formula as generate-surroundings.py
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996; lon0 = math.radians(15)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); phi = math.radians(lat); lam = math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A_ = math.cos(phi) * (lam - lon0)
    e4 = e2 * e2; e6 = e4 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A_ + (1 - T + C) * A_ ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A_ ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A_ * A_ / 2 + (5 - T + 9 * C + 4 * C * C) * A_ ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A_ ** 6 / 720))
    return x, y


DTM = json.load(open(os.path.join(ROOT, f'assets/osm/{NAME}-dtm-2m.json'), encoding='utf-8'))
DTM_X0, DTM_Y1, DTM_RES = DTM['x0'], DTM['y1'], DTM['res']
raw = np.array(Image.open(os.path.join(ROOT, f'assets/osm/{NAME}-dtm-2m.png')), dtype=float) / 100 - 10
pad = np.pad(raw, 1, mode='edge')                    # 3 x 3 box (6 m) before sampling on the 8 m grid
smooth = sum(pad[1 + dy:1 + dy + raw.shape[0], 1 + dx:1 + dx + raw.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9


def dtm_at(arr, x, s_):
    ux, uy = to_utm33(LAT0 - s_ / 111320, LON0 + x / KX)
    c, r = (ux - DTM_X0) / DTM_RES - .5, (DTM_Y1 - uy) / DTM_RES - .5
    c = min(max(c, 0), arr.shape[1] - 1.001); r = min(max(r, 0), arr.shape[0] - 1.001)
    c0, r0 = int(c), int(r); fc, fr = c - c0, r - r0
    return arr[r0, c0] * (1 - fc) * (1 - fr) + arr[r0, c0 + 1] * fc * (1 - fr) + arr[r0 + 1, c0] * (1 - fc) * fr + arr[r0 + 1, c0 + 1] * fc * fr


# The stair-door reference the old grid uses: the median of (DTM - stored value) where both exist.
H_DOOR = float(np.median([dtm_at(raw, x, s_) - A[(s_ + A_HALF) // 4, (x + A_HALF) // 4] / 10 for x in range(-800, 801, 40) for s_ in (600, 700, 800)]))
in_a = lambda x, s_: abs(x) <= A_HALF and abs(s_) <= A_HALF
nx, ns = (GX1 - GX0) // STEP + 1, (GS1 - GS0) // STEP + 1
grid = np.zeros((ns, nx), dtype=np.int32)
for j in range(ns):
    for i in range(nx):
        x, s_ = GX0 + i * STEP, GS0 + j * STEP
        grid[j, i] = int(A[(s_ + A_HALF) // 4, (x + A_HALF) // 4]) if in_a(x, s_) else int(round((dtm_at(smooth, x, s_) - H_DOOR) * 10))
code = bytearray()
for j in range(ns):
    prev = None
    for i in range(nx):
        v = int(grid[j, i])
        if prev is not None and -127 <= v - prev <= 127:
            code += struct.pack('<b', v - prev)
        else:
            code += struct.pack('<bh', -128, v)
        prev = v


def rel(x, s_):
    """Ground height (m, relative to the door) as the game samples it."""
    if in_a(x, s_):
        fi, fj = (x + A_HALF) / 4, (s_ + A_HALF) / 4; arr, n_ = A, A.shape[0]
    else:
        fi, fj = (x - GX0) / STEP, (s_ - GS0) / STEP; arr, n_ = None, None
    if arr is None:
        fi = min(max(fi, 0), nx - 1.001); fj = min(max(fj, 0), ns - 1.001); i, j = int(fi), int(fj); u, v = fi - i, fj - j
        return (grid[j, i] * (1 - u) * (1 - v) + grid[j, i + 1] * u * (1 - v) + grid[j + 1, i] * (1 - u) * v + grid[j + 1, i + 1] * u * v) / 10
    i, j = int(fi), int(fj); u, v = fi - i, fj - j; i = min(i, n_ - 2); j = min(j, n_ - 2)
    return (A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v) / 10


SEA_REL = round(-H_DOOR, 2)                          # sea level relative to the door


# ---------------- Geometry helpers ----------------
def rings_of(e):
    """Polygons of an OSM way or multipolygon relation (outer rings with their holes)."""
    if e['type'] == 'way':
        pts = [local(p) for p in e.get('geometry', [])]
        if len(pts) < 4 or pts[0] != pts[-1]:
            return []
        return [Polygon(pts).buffer(0)]
    outer = [LineString([local(p) for p in m['geometry']]) for m in e.get('members', []) if m.get('role') == 'outer' and len(m.get('geometry', [])) > 1]
    inner = [LineString([local(p) for p in m['geometry']]) for m in e.get('members', []) if m.get('role') == 'inner' and len(m.get('geometry', [])) > 1]
    outs = list(polygonize(unary_union(outer))) if outer else []
    ins = list(polygonize(unary_union(inner))) if inner else []
    geom = unary_union(outs)
    if ins:
        geom = geom.difference(unary_union(ins))
    return [g for g in getattr(geom, 'geoms', [geom]) if not g.is_empty]


def lines_of(e):
    pts = [local(p) for p in e.get('geometry', []) if p]
    if len(pts) < 2:
        return []
    g = LineString(pts).intersection(CLIP)
    out = []
    for part in getattr(g, 'geoms', [g]):
        if part.geom_type == 'LineString' and part.length > .5:
            out.append(part.simplify(.4))
    return out


def u16(v, o):
    return int(min(65535, max(0, round((v - o) * 10))))


def flat(coords, digits=1):
    return [round(v, digits) for c in coords for v in c]


tag = lambda e: e.get('tags', {})
num = lambda v: float(str(v).replace(',', '.').split(';')[0].split()[0])

# ---------------- Landmarks (modelled key buildings) ----------------
# Churches: the tower stands at the narrow end of the real footprint (the end with the square tower base).
# Sizes and colours are estimates from photos (+/-20 %), see docs/DECISIONS.md.
LANDMARKS = {} if NAME != 'gamle-oslo' else {
    70483492: ('church', 'Sofienberg kirke', {'top': 52, 'eave': 12, 'wall': '#9b5440', 'spire': '#3f4a48'}),
    113067814: ('church', 'Paulus kirke', {'top': 69, 'eave': 14, 'wall': '#93503d', 'spire': '#5d8a76'}),
    132155227: ('church', 'Kampen kirke', {'top': 62, 'eave': 12, 'wall': '#a3593f', 'spire': '#3f4a48'}),
    111641730: ('church', 'Vålerenga kirke', {'top': 55, 'eave': 12, 'wall': '#a25a45', 'spire': '#5d8a76'}),
    111376996: ('church', 'Grønland kirke', {'top': 56, 'eave': 13, 'wall': '#c9b07c', 'spire': '#3f4a48'}),
    557799193: ('church', 'Gamlebyen kirke', {'top': 42, 'eave': 10, 'wall': '#a8a196', 'spire': '#3f4a48'}),
    111089628: ('church', 'Tøyenkirken', {'top': 38, 'eave': 10, 'wall': '#a3593f', 'spire': '#3f4a48'}),
    545260792: ('munch', 'MUNCH', {'top': 60}),
    810259696: ('opera', 'Operahuset', {'roof': 32, 'fly': 54}),
}
HEIGHT = {} if NAME != 'gamle-oslo' else {1509499373: 117.0, 4390874: 111.0, 760875553: 22.0, 20594400: 24.0}   # Oslo Plaza, Posthuset, Jordal Amfi, Intility Arena


def axis_of(poly):
    rect = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e1 = (rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]); e2 = (rect[2][0] - rect[1][0], rect[2][1] - rect[1][1])
    L1, L2 = math.hypot(*e1), math.hypot(*e2)
    ax, L, W = (e1, L1, L2) if L1 >= L2 else (e2, L2, L1)
    c = Polygon(rect).centroid
    return (ax[0] / L, ax[1] / L), L, W, (c.x, c.y)


def width_at(poly, c, u, t):
    n = (-u[1], u[0])
    ln = LineString([(c[0] + u[0] * t - n[0] * 80, c[1] + u[1] * t - n[1] * 80), (c[0] + u[0] * t + n[0] * 80, c[1] + u[1] * t + n[1] * 80)])
    return poly.intersection(ln).length


landmarks = []
for e in osm:
    if e['id'] not in LANDMARKS or 'building' not in tag(e):
        continue
    kind, name, opts = LANDMARKS[e['id']]
    poly = max(rings_of(e), key=lambda g: g.area).simplify(.2)
    u, L, W, c = axis_of(poly)
    item = {'id': e['id'], 'kind': kind, 'name': name, 'ring': flat(poly.exterior.coords[:-1], 2), 'axis': [round(u[0], 4), round(u[1], 4)],
            'L': round(L, 2), 'W': round(W, 2), 'c': [round(c[0], 2), round(c[1], 2)], 'g': round(min(rel(*p) for p in poly.exterior.coords), 2), **opts}
    if kind == 'church':
        ends = {}
        for sign in (1, -1):
            ws = [width_at(poly, c, u, sign * (L / 2 - d)) for d in (1.5, 3.5, 5.5)]
            ends[sign] = min(ws)
        sign = 1 if ends[1] < ends[-1] else -1
        side = max(6.5, min(11, ends[sign] if ends[sign] > 4 else W * .5, W * .62))
        item['tower'] = {'end': sign, 'side': round(side, 2)}
    landmarks.append(item)
landmark_ids = {l['id'] for l in landmarks}

# ---------------- Buildings ----------------
old_polys = [Polygon([(b['r']['o'][i], b['r']['o'][i + 1]) for i in range(0, len(b['r']['o']), 2)]).buffer(0) for b in D['buildings']]
old_polys.append(Polygon([(D['ownLocal'][i], D['ownLocal'][i + 1]) for i in range(0, len(D['ownLocal']), 2)]).buffer(0))
old_index = STRtree(old_polys)
STYLE = {'brick': 0, 'plaster': 1, 'shed': 2, 'modern': 3, 'industrial': 4}
SKIP = {'roof', 'bunker', 'no', 'ruins', 'demolished', 'collapsed', 'carport', 'disused', 'proposed', 'abandoned'}
SMALL = {'garage', 'garages', 'shed', 'cabin', 'hut', 'greenhouse', 'kiosk', 'service', 'toilets', 'barn', 'allotment_house', 'bicycle_parking', 'old_telephone_booth', 'transformer_tower'}
RESIDENTIAL = {'apartments', 'terrace', 'residential', 'dormitory'}
TALL_OK = {'office', 'commercial', 'hotel', 'apartments', 'dormitory', 'retail', 'university', 'civic', 'yes', 'hospital', 'residential', 'public', 'government'}
DEFAULT_LEVELS = {'apartments': 5, 'residential': 5, 'dormitory': 5, 'terrace': 2, 'house': 2, 'semidetached_house': 2, 'detached': 2, 'office': 4, 'commercial': 3,
                  'retail': 2, 'industrial': 2, 'warehouse': 2, 'school': 3, 'university': 3, 'kindergarten': 1, 'civic': 3, 'public': 3, 'hotel': 6, 'church': 3,
                  'religious': 2, 'mosque': 2, 'chapel': 1, 'train_station': 2, 'transportation': 1, 'hospital': 5, 'prison': 4, 'farm': 2, 'government': 4}


def building_size(t, e_id, area):
    """(height m, style, levels) for an OSM building."""
    kind = t.get('building', 'yes')
    lv = None
    try:
        lv = num(t['building:levels']) if 'building:levels' in t else None
    except ValueError:
        pass
    h = HEIGHT.get(e_id)
    if h is None and 'height' in t:
        try:
            h = num(t['height'])
        except ValueError:
            h = None
    if lv is None:
        if kind in SMALL:
            lv = 1
        elif kind == 'yes':
            lv = 1 if area < 60 else 2 if area < 200 else 4
        elif kind in ('apartments', 'residential') and area < 120:
            lv = 3
        else:
            lv = DEFAULT_LEVELS.get(kind, 2)
    lv = max(lv, 1)
    tall = (lv >= 7 or (h or 0) >= 22) and kind in TALL_OK
    if h is None:
        if kind in SMALL:
            h = 2.8
        elif kind in ('stadium',):
            h = 18
        elif kind in ('sports_centre',):
            h = 11
        elif tall:
            h = lv * 3.5 + 1
        elif kind in RESIDENTIAL and lv >= 3:
            h = D['plinth'] + lv * D['storey'] + .5
        elif kind in ('industrial', 'warehouse', 'train_station', 'transportation'):
            h = lv * 4.5 + .5
        else:
            h = lv * 3.0 + .3
        try:
            h += num(t.get('roof:levels', 0)) * 2.0
        except ValueError:
            pass
    style = ('shed' if kind in SMALL else 'modern' if tall else 'brick' if kind in RESIDENTIAL else
             'industrial' if kind in ('industrial', 'warehouse', 'stadium', 'sports_centre', 'train_station', 'transportation', 'manufacture') else 'plaster')
    return max(2.5, min(h, 140)), style, lv


def hip_rect(poly):
    rect = poly.minimum_rotated_rectangle
    if rect.area <= 0 or poly.area / rect.area < .86:
        return None
    return list(rect.exterior.coords)[:-1]


ntx, nts = math.ceil((GX1 - GX0) / TILE), math.ceil((GS1 - GS0) / TILE)
tiles, tile_ids = [[] for _ in range(ntx * nts)], [[] for _ in range(ntx * nts)]
footprints, counts = [], {'kept': 0, 'old': 0, 'skipped': 0}
heights_seen = []
for e in osm:
    t = tag(e)
    if 'building' not in t or e['type'] not in ('way', 'relation') or e['id'] in landmark_ids:
        continue
    if t['building'] in SKIP or t.get('location') == 'underground' or t.get('tunnel'):
        continue
    try:
        if int(num(t.get('layer', 0))) < 0:
            continue
    except ValueError:
        pass
    if t['building'] == 'construction' and 'building:levels' not in t:
        continue
    for poly in rings_of(e):
        poly = poly.buffer(0)
        for part in getattr(poly, 'geoms', [poly]):
            if part.is_empty or part.area < 6:
                continue
            part = part.simplify(.25)
            if part.geom_type != 'Polygon' or part.is_empty or not part.is_valid or len(part.exterior.coords) < 4:
                continue
            cx, cs_ = part.centroid.x, part.centroid.y
            if not (GX0 <= cx <= GX1 and GS0 <= cs_ <= GS1):
                continue
            overlap = max((part.intersection(old_polys[k]).area / min(part.area, old_polys[k].area) for k in old_index.query(part)), default=0)
            if in_a(cx, cs_) and (max(abs(cx), abs(cs_)) < 700 or overlap > .2) or overlap > .3:
                counts['old'] += 1
                continue
            h, style, lv = building_size(t, e['id'], part.area)
            hip = hip_rect(part) if style == 'brick' and h < 22 else None
            ti, tj = int((cx - GX0) // TILE), int((cs_ - GS0) // TILE)
            ox, os_ = GX0 + ti * TILE, GS0 + tj * TILE
            ring = list(part.exterior.coords)[:-1]
            rec = [len(ring), STYLE[style] | (8 if hip else 0), int(round(h * 10))]
            if hip:
                rec += [int(round((p[k] - (ox, os_)[k]) * 10)) for p in hip for k in (0, 1)]
            rec += [int(round((p[k] - (ox, os_)[k]) * 10)) for p in ring for k in (0, 1)]
            assert all(-32768 <= v <= 32767 for v in rec), (e['id'], rec[:5])
            tiles[tj * ntx + ti].extend(rec)
            tile_ids[tj * ntx + ti].append(e['id'] * 2 + (e['type'] == 'relation'))   # OSM id (x2, +1 for a relation)
            footprints.append(part)
            heights_seen.append(h)
            counts['kept'] += 1
tile_b64 = [base64.b64encode(np.array(tl, dtype='<i2').tobytes()).decode('ascii') if tl else '' for tl in tiles]
ids_b64 = [base64.b64encode(np.array(tl, dtype='<u4').tobytes()).decode('ascii') if tl else '' for tl in tile_ids]
fp_index = STRtree(footprints + old_polys + [Polygon([(l['ring'][i], l['ring'][i + 1]) for i in range(0, len(l['ring']), 2)]) for l in landmarks])
all_fp = footprints + old_polys + [Polygon([(l['ring'][i], l['ring'][i + 1]) for i in range(0, len(l['ring']), 2)]) for l in landmarks]
in_building = lambda p: any(all_fp[k].contains(p) for k in fp_index.query(p))

# ---------------- Roads, railways and paths ----------------
ROAD_WIDTH = {'motorway': 12, 'motorway_link': 7, 'trunk': 12, 'trunk_link': 7, 'primary': 11, 'primary_link': 7, 'secondary': 9, 'secondary_link': 6,
              'tertiary': 8, 'tertiary_link': 6, 'residential': 6.5, 'unclassified': 6, 'living_street': 5, 'service': 3.6, 'pedestrian': 5,
              'footway': 2.4, 'path': 2, 'cycleway': 2.5, 'steps': 2, 'track': 3, 'bridleway': 2}
ROAD_KINDS = list(ROAD_WIDTH) + ['tram', 'rail']
names, name_ix = [], {}
road_stream, road_count = [], 0
area_items = []
for e in osm:
    t = tag(e)
    if e['type'] != 'way':
        continue
    hw, rw = t.get('highway'), t.get('railway')
    if t.get('tunnel') in ('yes', 'culvert') or t.get('covered') == 'yes' and hw in ('footway', 'path'):
        continue
    try:
        if int(num(t.get('layer', 0))) < 0:
            continue
    except ValueError:
        pass
    if hw == 'pedestrian' and t.get('area') == 'yes':
        area_items.append(('paved', e))
        continue
    if hw in ROAD_WIDTH:
        if hw == 'footway' and t.get('footway') in ('sidewalk', 'crossing', 'traffic_island'):
            continue
        kind = hw
    elif rw in ('tram',):
        kind = 'tram'
    elif rw in ('rail', 'light_rail', 'subway', 'narrow_gauge'):
        kind = 'rail'
    else:
        continue
    nm = t.get('name') if kind not in ('tram', 'rail') else None
    if nm and nm not in name_ix:
        name_ix[nm] = len(names); names.append(nm)
    for ln in lines_of(e):
        pts = list(ln.coords)
        road_stream += [ROAD_KINDS.index(kind), name_ix[nm] + 1 if nm else 0, len(pts)] + [u16(p[k], (OX, OS)[k]) for p in pts for k in (0, 1)]
        road_count += 1

# ---------------- Areas (parks, grass, woods, water, pitches, parking, yards ...) ----------------
AREA_KINDS = ['grass', 'wood', 'playground', 'pitch', 'parking', 'yard', 'flowerbed', 'water', 'cemetery', 'rail', 'sand', 'rock', 'paved']
TAGMAP = [('natural', {'water': 'water', 'wood': 'wood', 'scrub': 'grass', 'grassland': 'grass', 'heath': 'grass', 'bare_rock': 'rock', 'sand': 'sand', 'beach': 'sand', 'wetland': 'grass'}),
          ('waterway', {'riverbank': 'water'}),
          ('leisure', {'park': 'grass', 'garden': 'grass', 'playground': 'playground', 'pitch': 'pitch', 'stadium': 'pitch', 'dog_park': 'grass', 'swimming_pool': 'water', 'track': 'pitch'}),
          ('landuse', {'grass': 'grass', 'meadow': 'grass', 'recreation_ground': 'grass', 'village_green': 'grass', 'forest': 'wood', 'cemetery': 'cemetery', 'allotments': 'grass',
                       'flowerbed': 'flowerbed', 'railway': 'rail', 'construction': 'sand', 'brownfield': 'sand', 'orchard': 'grass', 'plant_nursery': 'grass'}),
          ('amenity', {'parking': 'parking', 'school': 'yard', 'kindergarten': 'yard', 'grave_yard': 'cemetery'})]
for e in osm:
    t = tag(e)
    if e['type'] not in ('way', 'relation') or 'building' in t:
        continue
    for key, mp in TAGMAP:
        if t.get(key) in mp:
            if t.get('layer', '0').lstrip('-') != t.get('layer', '0') or (t.get('amenity') == 'parking' and t.get('parking') in ('underground', 'multi-storey')):
                break
            area_items.append((mp[t[key]], e))
            break
areas = []
for kind, e in area_items:
    for poly in rings_of(e):
        g = poly.intersection(CLIP)
        for part in getattr(g, 'geoms', [g]):
            if part.geom_type != 'Polygon' or part.area < 15:
                continue
            part = part.simplify(.6)
            if part.is_empty or part.geom_type != 'Polygon':
                continue
            areas.append((part.area, kind, list(part.exterior.coords)[:-1]))
areas.sort(key=lambda a: -a[0])                      # big areas first, small ones paint on top
area_stream = []
for _, kind, pts in areas:
    area_stream += [AREA_KINDS.index(kind), len(pts)] + [u16(p[k], (OX, OS)[k]) for p in pts for k in (0, 1)]

# ---------------- Sea (the terrain model is at sea level in the fjord) ----------------
cells = []
for j in range(int((GS1 - GS0) / 4)):
    run = None
    s_ = GS0 + j * 4 + 2
    for i in range(int((GX1 - GX0) / 4) + 1):
        x = GX0 + i * 4 + 2
        wet = x < GX1 and dtm_at(raw, x, s_) <= .05
        if wet and run is None:
            run = x - 2
        elif not wet and run is not None:
            cells.append(box(run, s_ - 2, x - 2, s_ + 2)); run = None
sea_geom = unary_union(cells).buffer(1).buffer(-1)
# The terrain model is older than the newest quays in Bjørvika (MUNCH, Sørenga): wherever OpenStreetMap has a building
# (plus 6 m) or a land area, it is land.
land = [fp.buffer(6) for fp in all_fp] + [Polygon(pts).buffer(0) for _, kind, pts in areas if kind != 'water']
sea_geom = sea_geom.difference(unary_union(land)).buffer(-1).buffer(1).simplify(2.5)
sea = [flat(p.exterior.coords[:-1]) for p in getattr(sea_geom, 'geoms', [sea_geom]) if p.geom_type == 'Polygon' and p.area > 4000]

# ---------------- Trees, chimneys, places, stations ----------------
tree_stream = []
for e in osm:
    if e['type'] == 'node' and tag(e).get('natural') == 'tree':
        x, s_ = local(e)
        if in_a(x, s_) or not (GX0 <= x <= GX1 and GS0 <= s_ <= GS1) or in_building(Point(x, s_)):
            continue
        tree_stream += [u16(x, OX), u16(s_, OS)]
chimneys = []
for e in osm:
    t = tag(e)
    if t.get('man_made') != 'chimney' or t.get('building') and e['type'] == 'way' and 'height' not in t:
        continue
    x, s_ = local(e) if e['type'] == 'node' else Polygon([local(p) for p in e['geometry']]).centroid.coords[0]
    try:
        h = num(t['height']) if 'height' in t else (30 if t.get('name') else 0)
    except ValueError:
        h = 0
    if h >= 20 and not in_a(x, s_) and GX0 <= x <= GX1 and GS0 <= s_ <= GS1 and all(math.hypot(x - c[0], s_ - c[1]) > 6 for c in chimneys):
        chimneys.append([round(x, 1), round(s_, 1), round(h, 1)])
places, stations = [], []
for e in osm:
    t = tag(e)
    if e['type'] != 'node' or 'name' not in t:
        continue
    x, s_ = local(e)
    if not (GX0 <= x <= GX1 and GS0 - 300 <= s_ <= GS1):
        continue
    if t.get('place') in ('suburb', 'quarter') and not in_a(x, s_):
        places.append({'name': t['name'], 'x': round(x), 's': round(s_)})
    elif t.get('railway') == 'station' and t.get('station') == 'subway' and GS0 <= s_:
        stations.append({'name': t['name'], 'x': round(x, 1), 's': round(s_, 1)})

# ---------------- The Ensjø -> Rathkes gate run (issue #38: "practice the most effective way from Ensjø to Rathkes") ----------------
car_lines = []
for e in osm:
    t = tag(e)
    if e['type'] == 'way' and t.get('highway') in ('residential', 'tertiary', 'secondary', 'living_street', 'unclassified', 'pedestrian', 'footway') and not t.get('tunnel'):
        car_lines += [(t.get('name'), ln) for ln in lines_of(e)]


def street_spot(target, name=None, side=0.0):
    """A point on the nearest street (by name if given), moved off it by `side` metres, not inside a building."""
    cands = [ln for nm, ln in car_lines if name is None or nm == name]
    ln = min(cands, key=lambda l: l.distance(Point(target)))
    d = ln.project(Point(target))
    for off in (0, 3, -3, 6, -6, 10, -10):
        p = ln.interpolate(max(0, min(ln.length, d + off)))
        q = ln.interpolate(max(0, min(ln.length, d + off + 1)))
        tx, ts = q.x - p.x, q.y - p.y; L_ = math.hypot(tx, ts) or 1
        pt = Point(p.x - ts / L_ * side, p.y + tx / L_ * side)
        if not in_building(pt):
            return [round(pt.x, 2), round(pt.y, 2)]
    return [round(target[0], 2), round(target[1], 2)]


route = None
if NAME == 'gamle-oslo':
    ensjo = next(st for st in stations if st['name'] == 'Ensjø')
    route = {'start': {'name': 'Ensjø T-bane', 'at': street_spot((ensjo['x'], ensjo['s']))},
             'finish': {'name': 'Rathkes gate', 'at': street_spot((-731, 1708), 'Rathkes gate')}}

data = {
    'name': NAME, 'attribution': 'Map data © OpenStreetMap contributors (ODbL). Height data © Kartverket (CC BY 4.0).',
    'grid': {'x0': GX0, 's0': GS0, 'step': STEP, 'nx': nx, 'ns': ns, 'code': base64.b64encode(bytes(code)).decode('ascii')},
    'seaRel': SEA_REL, 'play': dict(zip(('x0', 's0', 'x1', 's1'), PLAY)),
    'tile': TILE, 'tiles': {'nx': ntx, 'ns': nts, 'b': tile_b64, 'ids': ids_b64},
    'o16': [OX, OS], 'roadKinds': ROAD_KINDS, 'roadWidth': ROAD_WIDTH, 'names': names, 'roads': base64.b64encode(np.array(road_stream, dtype='<u2').tobytes()).decode('ascii'),
    'areaKinds': AREA_KINDS, 'areas': base64.b64encode(np.array(area_stream, dtype='<u2').tobytes()).decode('ascii'),
    'sea': sea, 'trees': base64.b64encode(np.array(tree_stream, dtype='<u2').tobytes()).decode('ascii'),
    'chimneys': chimneys, 'landmarks': landmarks, 'places': places, 'stations': stations, 'route': route,
}
out = (f'/* Generated by tools/make-district.py ({NAME}, local box {GX0} {GS0} {GX1} {GS1}). ' + data['attribution'] + ' */\n'
       '(window.DISTRICTS = window.DISTRICTS || []).push(' + json.dumps(data, separators=(',', ':'), ensure_ascii=False) + ');\n')
with open(os.path.join(ROOT, f'{NAME}-data.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(out)
print(f'door {H_DOOR:.3f} m (old data {ter["doorHeight"]}), grid {nx}x{ns}, buildings {counts["kept"]} (left to the old data {counts["old"]}), '
      f'landmarks {[(l["name"], l.get("tower")) for l in landmarks]}, roads {road_count}, areas {len(areas)}, sea {len(sea)}, trees {len(tree_stream) // 2}, '
      f'chimneys {len(chimneys)}, places {len(places)}, stations {[s["name"] for s in stations]}, route {route}; {len(out) // 1024} KB '
      f'(terrain {len(data["grid"]["code"]) // 1024}, buildings {sum(map(len, tile_b64)) // 1024}, roads {len(data["roads"]) // 1024}, areas {len(data["areas"]) // 1024}, trees {len(data["trees"]) // 1024})')
print('tallest', sorted(heights_seen)[-8:])
