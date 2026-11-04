"""Build construction-city-data.js: Construction City at Ulven, Oslo (issue #85), the measured facts the game builds it from.

    python tools/make-construction-city.py          (needs the network: OpenStreetMap API and Kartverket's height service)
    then python build.py

Sources (read 4 Nov 2026):
- The outline: OpenStreetMap way 1333507389 (building=office, building:levels=11, name=Construction City), ODbL.
- Heights: Kartverket's terrain model (DTM) and surface model (DOM), nhm_dtm_topo_25833 / nhm_dom_topo_25833 at 1 m, CC BY 4.0.
  The roofs are, in metres above sea level: SW wing 140.9, W wing and the west hub 137.1, NW wing, the glass hall, S and SE
  wings about 133.5, E wing 129.8. With the street on the west side at about 97.3 m, a 4.9 m ground floor, 3.7 m upper floors
  and a 1.6 m parapet those are 11, 10, 9 and 8 floors (the sources say "up to 11 floors"); the hall is 36 m high (AF Gruppen:
  "a 35-metre high glass atrium").
- Facts: LINK Arkitektur (architect), AF Gruppen (contractor, with Betonmast), Glass & Fasade (architect interview, Apr 2026),
  Oslo byleksikon: six wings round a central glass hall that everyone passes through; a sloped glass wall in the hall with a
  timber wall opposite; a staircase in the hall with block flooring made from reused handrails; staff restaurants and places
  to eat; an auditorium whose back wall is reused sheet piling; flexible workplaces (Collektivet) on floors 2-3; a sky bar and
  a boardroom on the 10th floor and a roof terrace for 300; a facade of bronze-coloured enamelled glass in six shades with
  timber cladding; a two-level basement of about 25,000 m2 (Byggeindustrien: 504 parking spaces) and 1,300 bike places.
The block split (which part of the outline has how many floors) is ours, drawn along the roof steps of the surface model.

Local frame as surroundings-data.js: metres east (x) and south (s) of the address node 59.936404 N 10.776657 E.
"""
import io
import json
import math
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
LAT0, LON0 = 59.936404, 10.776657
KX = 111320 * math.cos(math.radians(LAT0))
BUILDING = 1333507389
L1, GROUND_STOREY, STOREY, PARAPET = 97.3, 4.9, 3.7, 1.6      # metres above sea level / metres


CACHE = os.path.join(os.environ.get('TEMP', '/tmp'), 'haarklous-construction-city')


def get(url, tries=6):
    import hashlib
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(path):
        return open(path, 'rb').read()
    for i in range(tries):
        try:
            body = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=120).read()
            open(path, 'wb').write(body)
            return body
        except OSError:                                   # the height service answers 504 now and then
            if i == tries - 1:
                raise
            time.sleep(5 * 2 ** i)


def to_utm33(lat, lon):                     # the same formula as generate-surroundings.py
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996; lon0 = math.radians(15)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); phi = math.radians(lat); lam = math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A = math.cos(phi) * (lam - lon0)
    e4 = e2 * e2; e6 = e4 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


local = lambda lat, lon: ((lon - LON0) * KX, -(lat - LAT0) * 111320)
r2 = lambda v: round(float(v), 2)

# ---------- The outline ----------
osm = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/way/{BUILDING}/full'))
nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in osm.iter('node')}
way = next(osm.iter('way'))
tags = {t.get('k'): t.get('v') for t in way.iter('tag')}
ring = [local(*nodes[nd.get('ref')]) for nd in way.iter('nd')][:-1]
# The outline as mapped (counter-clockwise on the map, i.e. with s pointing south it runs clockwise); 29 corners. Drop the
# 0.7 m jog at corners 26-27 (a mapping wiggle on the NW wing's south face).
assert len(ring) == 29, len(ring)
P = [(r2(x), r2(s)) for x, s in ring]


def on(a, b, s):                            # the point on segment a-b at local s
    t = (s - a[1]) / (b[1] - a[1])
    return (r2(a[0] + (b[0] - a[0]) * t), r2(s))


X = on(P[25], P[10], 1385.0)                 # where the north part of the west hub meets the hall's west edge
BLOCKS = [                                   # name, corners (indices into P, or a point), what it is
    ('NW', [0, 1, 2, 3, X, 25, 26, 27, 28], 'north-west wing and the north of the west hub'),
    ('W', [3, 4, 5, 6, 7], 'west wing'),
    ('SW', [3, 7, 8, 9, 10, X], 'south-west wing and the west hub'),
    ('hall', [25, 24, 11, 10, X], 'the glass hall'),
    ('E', [20, 21, 22, 23, 24], 'east wing'),
    ('S', [24, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11], 'south and south-east wings and the east hub'),
]
poly = lambda corners: [P[c] if isinstance(c, int) else c for c in corners]
outline = Polygon(P)
parts = [Polygon(poly(c)) for _, c, _ in BLOCKS]
assert all(p.is_valid for p in parts), [p.is_valid for p in parts]
union = unary_union(parts)
assert abs(union.area - outline.area) < 1 and union.symmetric_difference(outline).area < 1, (union.area, outline.area)
assert sum(p.area for p in parts) - outline.area < 1, 'blocks overlap'

# ---------- Kartverket heights at 1 m ----------
corners = [to_utm33(LAT0 - s / 111320, LON0 + x / KX) for x in (1700, 2040) for s in (1290, 1510)]
ux0, uy0 = int(min(c[0] for c in corners)), int(min(c[1] for c in corners))
ux1, uy1 = int(max(c[0] for c in corners)) + 1, int(max(c[1] for c in corners)) + 1


def coverage(kind):
    url = (f'https://wcs.geonorge.no/skwms1/wcs.hoyde-{kind}-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_{kind}_topo_25833'
           f'&format=GeoTIFF&crs=EPSG:25833&bbox={ux0},{uy0},{ux1},{uy1}&width={ux1 - ux0}&height={uy1 - uy0}')
    return np.array(Image.open(io.BytesIO(get(url))), dtype=float)


dtm, dom = coverage('dtm'), coverage('dom')


def sample(grid, x, s):
    ux, uy = to_utm33(LAT0 - s / 111320, LON0 + x / KX)
    c, r = ux - ux0 - .5, uy1 - uy - .5
    c0, r0 = int(math.floor(c)), int(math.floor(r)); fc, fr = c - c0, r - r0
    return float(grid[r0, c0] * (1 - fc) * (1 - fr) + grid[r0, c0 + 1] * fc * (1 - fr) + grid[r0 + 1, c0] * (1 - fc) * fr + grid[r0 + 1, c0 + 1] * fc * fr)


blocks = []
for (name, c, what), part in zip(BLOCKS, parts):
    inner = part.buffer(-3)
    pts = [(x, s) for x in range(int(part.bounds[0]), int(part.bounds[2]) + 1) for s in range(int(part.bounds[1]), int(part.bounds[3]) + 1)]
    roof = [sample(dom, x, s) for x, s in pts if inner.contains(Point(x, s))]
    top = float(np.percentile(roof, 50))
    floors = int(round((top - PARAPET - L1 - GROUND_STOREY) / STOREY)) + 1
    blocks.append({'name': name, 'what': what, 'poly': poly(c), 'roofMeasured': r2(top), 'floors': floors})
    print(f'{name:5s} roof {top:6.1f} m -> {floors} floors ({what})')

# The ground just outside the walls, every 4 m along each edge (for the plinth, entrance steps and the street edge).
cx, cs = outline.centroid.x, outline.centroid.y
edge_ground = []
for i in range(len(P)):
    a, b = P[i], P[(i + 1) % len(P)]
    L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, round(L / 4))
    nx, ns = (b[1] - a[1]) / L, -(b[0] - a[0]) / L                     # one of the two normals; pick the outward one
    mx, ms = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    if outline.contains(Point(mx + nx * 1.5, ms + ns * 1.5)):
        nx, ns = -nx, -ns
    edge_ground.append([r2(sample(dtm, a[0] + (b[0] - a[0]) * k / n + nx * 2, a[1] + (b[1] - a[1]) * k / n + ns * 2)) for k in range(n + 1)])
# Reference points for matching Kartverket's metres above sea level to the game's heights: the terrain 12-30 m outside.
refs = []
for i in range(0, len(P), 3):
    a = P[i]; dx, ds = a[0] - cx, a[1] - cs; l = math.hypot(dx, ds)
    q = (a[0] + dx / l * 20, a[1] + ds / l * 20)
    if not outline.buffer(8).contains(Point(*q)):
        refs.append([r2(q[0]), r2(q[1]), r2(sample(dtm, *q))])

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from construction_city_design import design as make_design    # the building's inside: floors, stairs, garage, rooms
design = make_design(P, blocks, edge_ground, L1, GROUND_STOREY, STOREY, PARAPET, plan=os.path.join(CACHE, 'plan'))

out = {
    'attribution': 'Construction City: OpenStreetMap way 1333507389 (ODbL); heights: Kartverket DTM and DOM (CC BY 4.0); facts: LINK Arkitektur, AF Gruppen, Glass & Fasade, Oslo byleksikon (Nov 2026)',
    'osm': {'id': BUILDING, 'tags': tags},
    'ring': P,
    'levels': {'L1': L1, 'ground': GROUND_STOREY, 'storey': STOREY, 'parapet': PARAPET, 'slab': .4, 'P1': r2(L1 - 3.4), 'P2': r2(L1 - 6.8)},
    'blocks': blocks,
    'edgeGround': edge_ground,
    'refs': refs,
    **design,
    'facts': {'workplaces': 4500, 'area': 103000, 'parking': 504, 'bikes': 1300, 'hall': 35, 'architect': 'LINK Arkitektur', 'opened': 2025, 'address': 'Standardveien 1, 0665 Oslo'},
}
src = '/* Generated by tools/make-construction-city.py (issue #85). ' + out['attribution'] + ' */\n'
src += "(function (data) {if (typeof module === 'object' && module.exports) module.exports = data;else window.CONSTRUCTION_CITY = data;})("
src += json.dumps(out, separators=(',', ':'), ensure_ascii=False) + ');\n'
open(os.path.join(ROOT, 'construction-city-data.js'), 'w', encoding='utf-8', newline='\n').write(src)
print(f'wrote construction-city-data.js ({len(src) // 1024} KB), outline {outline.area:.0f} m2, refs {len(refs)}')
