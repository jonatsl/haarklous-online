"""Make akerselva-data.js: the river Akerselva for kayaking (issue #45), from where it enters the old +/-800 m world at
Bjølsen down to Vaterland, where it goes into the culvert under the city.

    python tools/make-akerselva.py            (downloads once into assets/osm/, then works offline)

- Centre line: OpenStreetMap waterway=river "Akerselva" (ways 80915045, 1527986253), resampled every 4 m and smoothed.
- Width: the OSM riverbank multipolygon (relation 2254060, natural=water + water=river), measured to each side of the
  centre line, so the left and right half widths can differ.
- Water level: Kartverket's terrain model (DTM nhm_dtm_topo_25833, 2 m; it is levelled at the water surface over rivers),
  the lowest value across the water at each sample, median-filtered and never rising downstream. Steps of more than 0.8 m
  within 16 m are kept as falls (white water); OSM weirs and waterfalls are listed too.
- Bridges: OSM bridge=yes roads, paths and railways that cross the centre line, with their deck at bank level.
- Start spots: three put-ins (upper, middle, lower river) and the take-out above the culvert at Vaterland.
Coordinates are the game's local metres (x east, s south of the address node, as surroundings-data.js); heights are metres
relative to the stair door (world y = SURROUNDINGS.ground + value), the same reference as the terrain grids.
Map data (c) OpenStreetMap contributors (ODbL 1.0); height data (c) Kartverket (CC BY 4.0).
"""
import gzip
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
OSM_FILE = os.path.join(ROOT, 'assets/osm/akerselva-osm.json.gz')
DTM_FILE = os.path.join(ROOT, 'assets/osm/akerselva-dtm-2m.png')
STEP = 4.0
BOX = (-1460, -1300, -280, 2700)          # local x0 s0 x1 s1 of the downloads
OLD_HALF = 790                            # the old terrain grid reaches +/-800 m; the river data starts just inside it
MAIN_WAYS = [80915045, 1527986253, 1536630885]
RIVERBANK = 2254060

src = open(os.path.join(ROOT, 'surroundings-data.js'), encoding='utf-8').read()
SD = json.loads(src[src.index('{'):src.rindex('}') + 1])
LAT0, LON0 = SD['origin']['lat'], SD['origin']['lon']
DOOR = SD['terrain']['doorHeight']
KX = 111320 * math.cos(math.radians(LAT0))
local = lambda p: ((p['lon'] - LON0) * KX, -(p['lat'] - LAT0) * 111320)
latlon = lambda x, s: (LAT0 - s / 111320, LON0 + x / KX)


def to_utm33(lat, lon):                     # the same formula as generate-surroundings.py
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996; lon0 = math.radians(15)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); phi = math.radians(lat); lam = math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A = math.cos(phi) * (lam - lon0)
    e4 = e2 * e2; e6 = e4 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


def fetch(url, data=None, timeout=240):
    for i in range(6):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': AGENT})
            return urllib.request.urlopen(req, timeout=timeout).read()
        except OSError as e:                   # Overpass and the height service answer 429 / 504 now and then
            print(f'  retry {i + 1}: {e}', file=sys.stderr)
            if i == 5:
                raise
            time.sleep(5 * 2 ** min(i, 3))


# ---------- Downloads (once) ----------
if not os.path.exists(OSM_FILE):
    (la0, lo0), (la1, lo1) = latlon(BOX[0], BOX[3]), latlon(BOX[2], BOX[1])
    query = f'''[out:json][timeout:170][bbox:{la0:.5f},{lo0:.5f},{la1:.5f},{lo1:.5f}];
(way[waterway=river][name=Akerselva];relation({RIVERBANK});way[waterway~"^(weir|dam|waterfall)$"];node[waterway~"^(weir|dam|waterfall)$"];
 way[bridge][highway];way[bridge][railway];node[place~"^(suburb|neighbourhood|quarter|locality)$"][name];);out geom;'''
    keep = {'name', 'bridge', 'bridge:name', 'highway', 'railway', 'layer', 'waterway', 'natural', 'water', 'place', 'tunnel', 'width', 'type'}
    osm = None
    for server in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            osm = json.loads(fetch(server, urllib.parse.urlencode({'data': query}).encode()).decode('utf-8'))
            break
        except OSError:
            continue
    r7 = lambda v: round(v, 7)
    for e in osm['elements']:
        if 'tags' in e:
            e['tags'] = {k: v for k, v in e['tags'].items() if k in keep}
        if 'geometry' in e:
            e['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} for p in e['geometry']]
        for m in e.get('members', []):
            m.pop('ref', None)
            if 'geometry' in m:
                m['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} for p in m['geometry'] if p]
        for k in ('nodes', 'bounds', 'timestamp', 'version', 'changeset', 'user', 'uid'):
            e.pop(k, None)
    osm['note'] = f'OpenStreetMap extract for Akerselva (issue #45), local box {BOX}. Data (c) OpenStreetMap contributors, ODbL 1.0.'
    with gzip.open(OSM_FILE, 'wt', encoding='utf-8') as f:
        json.dump(osm, f, separators=(',', ':'), ensure_ascii=False)
osm = json.load(gzip.open(OSM_FILE, 'rt', encoding='utf-8'))['elements']
ways = {e['id']: e for e in osm if e['type'] == 'way'}

# Centre line, upstream to downstream (OSM draws waterways in the direction of flow).
line = []
for wid in MAIN_WAYS:
    pts = [local(p) for p in ways[wid]['geometry']]
    if line and math.dist(line[-1], pts[0]) < .5:
        pts = pts[1:]
    line += pts
first = next(i for i, p in enumerate(line) if abs(p[0]) <= OLD_HALF and abs(p[1]) <= OLD_HALF)
line = line[max(0, first - 1):]
# Start exactly on the old grid's edge.
(ax, as_), (bx, bs) = line[0], line[1]
if not (abs(ax) <= OLD_HALF and abs(as_) <= OLD_HALF):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        m = (lo + hi) / 2
        x, s = ax + (bx - ax) * m, as_ + (bs - as_) * m
        lo, hi = (lo, m) if abs(x) <= OLD_HALF and abs(s) <= OLD_HALF else (m, hi)
    line[0] = (ax + (bx - ax) * hi, as_ + (bs - as_) * hi)
geom = LineString(line)
n = int(geom.length // STEP) + 1
P = np.array([geom.interpolate(i * STEP).coords[0] for i in range(n)])
# Smooth the corners (OSM nodes are a few metres apart) but keep both ends.
for _ in range(3):
    Q = P.copy()
    Q[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
    P = Q
tan = np.gradient(P, axis=0)
tan /= np.linalg.norm(tan, axis=1)[:, None]
right = np.stack([-tan[:, 1], tan[:, 0]], axis=1)        # local frame: x east, s south -> right of the flow is (-ts, tx)

# ---------- Width from the riverbank multipolygon ----------
rel = next(e for e in osm if e['type'] == 'relation' and e['id'] == RIVERBANK)
rings = {'outer': [], 'inner': []}
for m in rel['members']:
    if m.get('geometry') and len(m['geometry']) > 1:
        rings['inner' if m.get('role') == 'inner' else 'outer'].append(LineString([local(p) for p in m['geometry']]))
water = unary_union(list(polygonize(rings['outer'])))
if rings['inner']:
    water = water.difference(unary_union(list(polygonize(rings['inner']))))
edge = water.boundary
wl, wr = np.zeros(n), np.zeros(n)
for i in range(n):
    c = Point(P[i])
    for side, arr in ((-1, wl), (1, wr)):
        ray = LineString([P[i], P[i] + right[i] * side * 70])
        hit = ray.intersection(edge)
        d = min((c.distance(Point(g)) for g in getattr(hit, 'geoms', [hit]) if not g.is_empty), default=None) if not hit.is_empty else None
        arr[i] = d if d is not None and water.buffer(.5).contains(c) else np.nan
for arr in (wl, wr):
    good = ~np.isnan(arr)
    arr[~good] = np.interp(np.flatnonzero(~good), np.flatnonzero(good), arr[good])
    np.clip(arr, 2.2, 32, out=arr)
    arr[:] = np.convolve(np.pad(arr, 3, mode='edge'), np.ones(7) / 7, mode='valid')

# ---------- Water level from the terrain model ----------
utm = [to_utm33(*latlon(x, s)) for x, s in P]
corners = [to_utm33(*latlon(x, s)) for x in (BOX[0], BOX[2]) for s in (BOX[1], BOX[3])]
ux0, uy0 = math.floor(min(c[0] for c in corners) / 2) * 2, math.floor(min(c[1] for c in corners) / 2) * 2
ux1, uy1 = math.ceil(max(c[0] for c in corners) / 2) * 2, math.ceil(max(c[1] for c in corners) / 2) * 2
if not os.path.exists(DTM_FILE):
    url = ('https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_dtm_topo_25833'
           f'&format=GeoTIFF&crs=EPSG:25833&bbox={ux0},{uy0},{ux1},{uy1}&width={(ux1 - ux0) // 2}&height={(uy1 - uy0) // 2}')
    tmp = DTM_FILE + '.tif'
    with open(tmp, 'wb') as f:
        f.write(fetch(url, timeout=300))
    dtm = np.array(Image.open(tmp), dtype=float)
    os.remove(tmp)
    dtm[~np.isfinite(dtm) | (dtm < -9) | (dtm > 500)] = 0.0
    # Keep only a 90 m corridor round the river (the rest compresses to nothing).
    H, W = dtm.shape
    keepmask = np.zeros_like(dtm, dtype=bool)
    for (ex, ey) in utm[::2]:
        i0, j0 = int((ex - ux0) / 2), int((uy1 - ey) / 2)
        keepmask[max(0, j0 - 45):j0 + 46, max(0, i0 - 45):i0 + 46] = True
    dtm[~keepmask] = -10
    Image.fromarray(np.clip(np.round((dtm + 10) * 100), 0, 65535).astype(np.uint16)).save(DTM_FILE)
dtm = np.array(Image.open(DTM_FILE), dtype=float) / 100 - 10


def dtm_at(ex, ey):
    fi, fj = (ex - ux0) / 2 - .5, (uy1 - ey) / 2 - .5
    i, j = int(math.floor(fi)), int(math.floor(fj))
    u, v = fi - i, fj - j
    return dtm[j, i] * (1 - u) * (1 - v) + dtm[j, i + 1] * u * (1 - v) + dtm[j + 1, i] * (1 - u) * v + dtm[j + 1, i + 1] * u * v


level = np.zeros(n)
for i in range(n):
    vals = []
    for f in np.linspace(-.6, .6, 7):
        half = wr[i] if f > 0 else wl[i]
        x, s = P[i] + right[i] * f * half
        vals.append(dtm_at(*to_utm33(*latlon(x, s))))
    level[i] = min(vals)
med = np.array([np.median(level[max(0, i - 4):i + 5]) for i in range(n)])
level = np.minimum.accumulate(med)                   # water never runs uphill
# Falls: runs of steps that drop (gaps of up to two flat samples allowed) adding up to more than 0.8 m.
falls = []
steps = level[:-1] - level[1:]
i = 0
while i < n - 1:
    if steps[i] <= .03:
        i += 1
        continue
    j, flat = i, 0
    while j + 1 < n - 1 and (steps[j + 1] > .03 or flat < 2):
        flat = 0 if steps[j + 1] > .03 else flat + 1
        j += 1
    j -= flat
    if level[i] - level[j + 1] > .8:
        falls.append({'t': round((i + j + 1) / 2 * STEP, 1), 'drop': round(level[i] - level[j + 1], 2), 'len': round((j + 1 - i) * STEP, 1)})
    i = j + 1
rel_level = level - DOOR
# Bank heights 7 m beyond each water edge: the kayak module draws simple banks there where no map patch has ground yet.
bank = np.zeros((n, 2))
for i in range(n):
    for c, (side, half) in enumerate(((-1, wl[i]), (1, wr[i]))):
        x, s = P[i] + right[i] * side * (half + 7)
        bank[i, c] = max(dtm_at(*to_utm33(*latlon(x, s))), level[i] + .4)
bank = np.array([np.median(bank[max(0, i - 2):i + 3], axis=0) for i in range(n)]) - DOOR

# ---------- Bridges, weirs and names ----------
centre = LineString(P)
bridges = []
for e in osm:
    t = e.get('tags', {})
    if e['type'] != 'way' or not t.get('bridge') or not (t.get('highway') or t.get('railway')) or 'geometry' not in e:
        continue
    wl_ = LineString([local(p) for p in e['geometry']])
    hit = wl_.intersection(centre)
    if hit.is_empty:
        continue
    for g in getattr(hit, 'geoms', [hit]):
        along = centre.project(g)
        k = min(n - 1, int(round(along / STEP)))
        # Deck: at the level of its abutments (the ends of the bridge way are where it meets the ground on the banks).
        ends = [local(e['geometry'][0]), local(e['geometry'][-1])]
        banks = [dtm_at(*to_utm33(*latlon(x, s))) for x, s in ends]
        deck = max(max(banks), level[k] + 2.2)
        kind = 'rail' if t.get('railway') else ('foot' if t.get('highway') in ('footway', 'path', 'cycleway', 'pedestrian', 'steps') else 'road')
        a, b = wl_.coords[0], wl_.coords[-1]
        bridges.append({'t': round(along, 1), 'name': t.get('bridge:name') or t.get('name') or '', 'kind': kind,
                        'deck': round(deck - DOOR, 2), 'w': {'road': 9, 'rail': 7, 'foot': 3.2}[kind],
                        'span': round(wl[k] + wr[k] + 6, 1), 'dir': [round(b[0] - a[0], 2), round(b[1] - a[1], 2)]})
bridges.sort(key=lambda b: b['t'])
merged = []
for b in bridges:                                     # a bridge mapped as two parallel ways (both sidewalks) counts once
    if merged and abs(merged[-1]['t'] - b['t']) < 6 and merged[-1]['kind'] == b['kind']:
        merged[-1]['w'] = round(max(merged[-1]['w'], b['w'] + abs(merged[-1]['t'] - b['t'])), 1)
        merged[-1]['name'] = merged[-1]['name'] or b['name']
        continue
    merged.append(b)
bridges = merged
weirs = []
for e in osm:
    t = e.get('tags', {})
    if t.get('waterway') in ('weir', 'dam', 'waterfall'):
        pts = [local(p) for p in e['geometry']] if 'geometry' in e else [local(e)]
        c = Point(np.mean(pts, axis=0))
        if centre.distance(c) < 25:
            weirs.append({'t': round(centre.project(c), 1), 'kind': t['waterway']})
weirs.sort(key=lambda w: w['t'])

# ---------- Put-ins and the take-out ----------
L = (n - 1) * STEP
named = sorted(bridges, key=lambda b: b['t'])


def near_bridge(t_want, avoid=()):
    cands = [b for b in named if b['name'] and b['name'] not in avoid]
    return min(cands, key=lambda b: abs(b['t'] - t_want)) if cands else None


def put_in(t_want, label):
    # Start a little below a named bridge near the wanted place, on a calm stretch (no fall within 40 m downstream).
    b = near_bridge(t_want)
    t = (b['t'] + 18) if b and abs(b['t'] - t_want) < 260 else t_want
    while any(f['t'] - f['len'] / 2 - 40 <= t <= f['t'] + f['len'] / 2 + 12 for f in falls) and t < L - 200:
        t += 8
    k = int(round(t / STEP))
    side = 1 if wr[k] < wl[k] else -1                 # the rack stands on the bank nearer the centre line
    return {'name': label + (f' (by {b["name"]})' if b and abs(b['t'] - t_want) < 260 else ''), 't': round(t, 1), 'side': side}


starts = [put_in(110, 'Bjølsen'), put_in(2050, 'Sagene'), put_in(3700, 'Grünerløkka')]
finish = {'name': 'Vaterland (before the culvert)', 't': round(L - 30, 1)}
out = {
    'attribution': 'Akerselva: OpenStreetMap (ODbL) ways 80915045, 1527986253, riverbank relation 2254060; water level: Kartverket DTM (CC BY 4.0)',
    'step': STEP, 'length': round(L, 1),
    'pts': [round(v, 2) for p in P for v in p],
    'wl': [round(v, 2) for v in wl], 'wr': [round(v, 2) for v in wr],
    'level': [round(v, 2) for v in rel_level],
    'bl': [round(v, 1) for v in bank[:, 0]], 'br': [round(v, 1) for v in bank[:, 1]],
    'falls': falls, 'weirs': weirs, 'bridges': bridges, 'starts': starts, 'finish': finish,
}
with open(os.path.join(ROOT, 'akerselva-data.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('/* Generated by tools/make-akerselva.py: Akerselva from Bjølsen to Vaterland for kayaking (issue #45). '
            'Map data (c) OpenStreetMap contributors (ODbL); height data (c) Kartverket (CC BY 4.0). */\n')
    f.write('window.AKERSELVA=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'Akerselva: {L:.0f} m, {n} samples, drop {level[0] - level[-1]:.1f} m ({level[0]:.1f} -> {level[-1]:.1f} m a.s.l.), '
      f'{len(falls)} falls, {len(weirs)} weirs, {len(bridges)} bridges; widths {np.min(wl + wr):.1f}..{np.max(wl + wr):.1f} m')
for s in starts:
    print('  start', s)
for f in falls:
    print('  fall', f)
for b in bridges:
    print('  bridge', b['t'], b['kind'], b['name'], 'deck above water', round(b['deck'] + DOOR - level[int(round(b['t'] / STEP))], 1))
