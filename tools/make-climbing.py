"""Make climbing-data.js: Klatreverket Torshov at its real place (issue #40).

    python tools/make-climbing.py

- The building: OpenStreetMap way 1031709261 (building=sports_centre, Kartverket building no. 80554273) at Myrens verksted,
  shared by Klatreverket Torshov (OSM node 1465714083, "Myrens verksted 3K, 0476 Oslo") and Myrens Treningssenter.
- Heights: Kartverket's terrain model (DTM) and surface model (DOM), nhm_dtm_topo_25833 / nhm_dom_topo_25833 at 1 m, so the
  roof heights are the real ones: the climbing hall wing is 14.5-15.1 m high, the strip between the wings 11.5-12 m.
- Coordinates are the game's local metres: x east, s south of the address node; heights use the game's datum
  (y = height above sea level - door height 84.88 m - 9.975 m), the same as surroundings-data.js.
Data (c) OpenStreetMap contributors (ODbL 1.0); height data (c) Kartverket (CC BY 4.0).
"""
import io
import json
import math
import os
import time
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
LAT0, LON0 = 59.936404, 10.776657
KX = 111320 * math.cos(math.radians(LAT0))
DOOR_HEIGHT, GROUND = 84.88, -9.975                     # surroundings-data.js terrain.doorHeight and ground
BUILDING, GYM_NODE, ADDRESS_NODE = 1031709261, 1465714083, 10110553024
BOX = (262950, 6651600, 263250, 6651900)               # UTM 33 box for the height models (1 m cells)


def get(url, tries=5):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=120).read()
        except OSError:                                   # the height service answers 504 now and then
            if i == tries - 1:
                raise
            time.sleep(5 * 2 ** i)


def to_utm33(lat, lon):
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996; lon0 = math.radians(15)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); phi = math.radians(lat); lam = math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A = math.cos(phi) * (lam - lon0)
    e4 = e2 * e2; e6 = e4 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


def local(lat, lon):
    return ((lon - LON0) * KX, -(lat - LAT0) * 111320)


# ---------- OpenStreetMap: the building outline and the gym's node ----------
osm = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/way/{BUILDING}/full'))
nodes = {n.get('id'): (float(n.get('lat')), float(n.get('lon'))) for n in osm.iter('node')}
way = next(osm.iter('way'))
tags = {t.get('k'): t.get('v') for t in way.iter('tag')}
ring = [local(*nodes[nd.get('ref')]) for nd in way.iter('nd')][:-1]
area = sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring))) / 2
if area < 0:
    ring.reverse()
points = {}
for key, nid in (('gym', GYM_NODE), ('address', ADDRESS_NODE)):
    n = ET.fromstring(get(f'https://api.openstreetmap.org/api/0.6/node/{nid}')).find('node')
    points[key] = local(float(n.get('lat')), float(n.get('lon')))
    points[key + 'Tags'] = {t.get('k'): t.get('v') for t in n.iter('tag')}

# ---------- Kartverket: terrain (DTM) and surface (DOM) at 1 m ----------
x0, y0, x1, y1 = BOX


def coverage(kind):
    url = (f'https://wcs.geonorge.no/skwms1/wcs.hoyde-{kind}-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_{kind}_topo_25833'
           f'&format=GeoTIFF&crs=EPSG:25833&bbox={x0},{y0},{x1},{y1}&width={x1 - x0}&height={y1 - y0}')
    return np.array(Image.open(io.BytesIO(get(url))), dtype=float)


dtm, dom = coverage('dtm'), coverage('dom')


def sample(grid, x, s):
    ux, uy = to_utm33(LAT0 - s / 111320, LON0 + x / KX)
    c, r = ux - x0 - .5, y1 - uy - .5
    c0, r0 = int(math.floor(c)), int(math.floor(r)); fc, fr = c - c0, r - r0
    return float(grid[r0, c0] * (1 - fc) * (1 - fr) + grid[r0, c0 + 1] * fc * (1 - fr) + grid[r0 + 1, c0] * (1 - fc) * fr + grid[r0 + 1, c0 + 1] * fc * fr)


game_y = lambda h: round(h - DOOR_HEIGHT + GROUND, 3)

# ---------- The hall frame ----------
# The long south-west wall (shared with the office building next door, way 1031708991) runs from the south corner to the
# west corner; a = metres along it from the south corner, b = metres into the building (north-east). The entrance is on the
# south-east wall (a = 0) next to the south corner, where the address point Myrens verksted 3K and the gym's node are.
south = max(ring, key=lambda p: p[1] - .3 * p[0])                     # the southernmost corner (largest s)
west = min(ring, key=lambda p: p[0] + .2 * p[1])                       # the westernmost corner
L = math.hypot(west[0] - south[0], west[1] - south[1])
u = ((west[0] - south[0]) / L, (west[1] - south[1]) / L)
v = (-u[1], u[0])
mid = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
if (mid[0] - south[0]) * v[0] + (mid[1] - south[1]) * v[1] < 0:
    v = (-v[0], -v[1])
at = lambda a, b: (south[0] + u[0] * a + v[0] * b, south[1] + u[1] * a + v[1] * b)
# Width of the high wing: walk inward along b at several a and find where the roof drops below 13 m above the ground.
ground_min = min(sample(dtm, *p) for p in ring)
widths = []
for a in np.arange(14, L - 6, 4):
    b = 2.0
    while b < 35 and sample(dom, *at(a, b)) - ground_min > 13.0:
        b += .25
    widths.append(b - .5)
wing = float(np.median(widths))
roof = [sample(dom, *at(a, b)) - ground_min for a in np.arange(8, L - 4, 2) for b in np.arange(2, wing - 1, 2)]
eaves = [sample(dom, *at(a, b)) - ground_min for a in np.arange(8, L - 4, 2) for b in (1.0, wing - 1.0)]
strip = [sample(dom, *at(a, wing + 4)) - ground_min for a in np.arange(14, L - 10, 2)]
ground = {k: game_y(sample(dtm, *at(*ab))) for k, ab in {'south': (0, 0), 'west': (L, 0), 'entrance': (-1.5, 3.5), 'far': (L, wing)}.items()}
# The hall floor is at street level at the entrance: the eaves are 14.6 m above it there, which leaves room for the gym's
# 14 m walls. (Under the building the DTM is interpolated and rises up to 0.9 m toward the slope on the north-east side.)
floor_y = round(ground['entrance'] + .05, 3)
inside_max = round(max(game_y(sample(dtm, *at(a, b))) for a in np.arange(0, L, 2) for b in np.arange(0, wing, 2)), 3)

out = {
    'attribution': 'Building: OpenStreetMap way 1031709261 (ODbL); heights: Kartverket DTM and DOM (CC BY 4.0); facts: klatreverket.no (Nov 2026)',
    'osm': BUILDING, 'buildingNo': tags.get('ref:bygningsnr'), 'gymNode': GYM_NODE,
    'ring': [[round(x, 2), round(s, 2)] for x, s in ring],
    'gym': [round(c, 2) for c in points['gym']], 'address': [round(c, 2) for c in points['address']],
    'name': points['gymTags'].get('name'), 'hours': points['gymTags'].get('opening_hours'), 'phone': points['gymTags'].get('phone'),
    'frame': {'origin': [round(c, 3) for c in south], 'u': [round(c, 6) for c in u], 'v': [round(c, 6) for c in v], 'length': round(L, 2), 'wing': round(wing, 2)},
    'roof': {'ridge': round(float(np.percentile(roof, 90)), 2), 'eaves': round(float(np.median(eaves)), 2), 'strip': round(float(np.median(strip)), 2), 'other': round(float(np.percentile([sample(dom, *p) - ground_min for p in ring], 75)), 2)},
    'groundMin': game_y(ground_min), 'ground': ground, 'floorY': floor_y, 'terrainInsideMax': inside_max
}
out['roofY'] = {k: round(out['groundMin'] + h, 3) for k, h in out['roof'].items()}
text = ('/* Generated by tools/make-climbing.py: Klatreverket Torshov at Myrens verksted (issue #40). Building outline (c) OpenStreetMap '
        'contributors (ODbL); heights (c) Kartverket (CC BY 4.0). */\nwindow.KLATREVERKET=' + json.dumps(out, separators=(',', ':'), ensure_ascii=False) + ';\n')
with open(os.path.join(ROOT, 'climbing-data.js'), 'w', encoding='utf-8') as f:
    f.write(text)
print(f"{out['name']}: hall {L:.1f} x {wing:.1f} m, roof {out['roof']} (eaves {out['roofY']['eaves'] - floor_y:.2f} m above the floor), floor y {floor_y}, ground {ground}")
