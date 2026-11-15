"""Make minigolf-data.js: the real minigolf courses inside the game world (issue #114, 15 Nov 2026).

    python tools/make-minigolf.py            (uses assets/osm/minigolf-osm-2026-11-15.json)
    python tools/make-minigolf.py --fetch    (downloads the OSM ways again first)

The user: "Create minigolf courses where there actually are minigolf courses. If its in a bar, then create the bar."
OpenStreetMap (Overpass, leisure=miniature_golf in the Oslo box, 15 Nov 2026) has four inside the game world:
- Torshov minigolfpark, way 72563100 (Christiania Minigolf Club, Hegermanns gate 25), kiosk way 801539736: outdoor, 18 holes.
- Grünerløkka Minigolf park, way 44044598 (barrier=fence; Christiania Minigolf Club, Søndre gate 1): outdoor, 18 holes; the hut
  inside it (way 1031362183) is used as its kiosk.
- An unnamed free course in Jordal park, way 1297710953 (fee=no, mapped 2024): outdoor, a small 10 x 10 m area.
- Oslo Camping, node 4958723297 (amenity=pub, indoor=yes; Møllergata 12, inside Fredshuset, way 183822363): a bar with an
  indoor 18-hole course on two floors (reviews: 11 holes upstairs, 7 downstairs). It lies 40-80 m west of the old Gamle Oslo
  patch, so the small 'mollergata' patch (tools/fetch-district.py / make-district.py mollergata -1792 2288 -1600 2576) was added.
Outside the world (not built): Marienlyst minigolfbane (way 183864424), Underground Golf Club Majorstua (node 12966945763),
Søylehuset café og minigolf at Ekeberg (way 546585178), the Lindøya course (way 845593306), way 320141719 at Nydalen.
Lane rows are the game's own layout inside each real outline (the real lane plans are not published); the Node test
tests/minigolf.test.cjs checks every lane lies inside its outline, apart from the others and clear of roads and buildings.
Coordinates: the game's local metres, x east and s south of the address node 59.936404 N 10.776657 E.
Map data (c) OpenStreetMap contributors (ODbL 1.0).
"""
import json
import math
import os
import sys
import time
import urllib.request

from shapely.geometry import Polygon, box
from shapely.affinity import rotate, translate

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
LAT0, LON0 = 59.936404, 10.776657
KX = 111320 * math.cos(math.radians(LAT0))
CACHE = os.path.join(ROOT, 'assets/osm/minigolf-osm-2026-11-15.json')
WAYS = {'torshov': 72563100, 'torshov-kiosk': 801539736, 'grunerlokka': 44044598, 'grunerlokka-kiosk': 1031362183, 'jordal': 1297710953, 'fredshuset': 183822363}
NODES = {'oslo-camping': 4958723297}


def get(url, tries=5):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=120).read()
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(5 * 2 ** i)


def local(lat, lon):
    return (round((lon - LON0) * KX, 2), round(-(lat - LAT0) * 111320, 2))


if '--fetch' in sys.argv or not os.path.exists(CACHE):
    out = {'note': 'OpenStreetMap ways and nodes of the minigolf courses (api.openstreetmap.org, 15 Nov 2026). (c) OpenStreetMap contributors, ODbL 1.0.', 'ways': {}, 'nodes': {}}
    for name, wid in WAYS.items():
        d = json.loads(get(f'https://api.openstreetmap.org/api/0.6/way/{wid}/full.json'))
        nodes = {e['id']: e for e in d['elements'] if e['type'] == 'node'}
        way = next(e for e in d['elements'] if e['type'] == 'way')
        out['ways'][name] = {'id': wid, 'tags': way.get('tags', {}), 'latlon': [[nodes[n]['lat'], nodes[n]['lon']] for n in way['nodes']]}
    for name, nid in NODES.items():
        e = json.loads(get(f'https://api.openstreetmap.org/api/0.6/node/{nid}.json'))['elements'][0]
        out['nodes'][name] = {'id': nid, 'tags': e.get('tags', {}), 'latlon': [e['lat'], e['lon']]}
    with open(CACHE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
osm = json.load(open(CACHE, encoding='utf-8'))
ring = lambda name: [list(local(*p)) for p in osm['ways'][name]['latlon'][:-1]]


def lane_poly(x, s, dx, ds, L, W):
    """The footprint of a lane: tee-end centre (x, s), direction (dx, ds), length L, width W (rails included)."""
    nx, ns = -ds, dx
    return Polygon([(x + nx * W / 2, s + ns * W / 2), (x + dx * L + nx * W / 2, s + ds * L + ns * W / 2),
                    (x + dx * L - nx * W / 2, s + ds * L - ns * W / 2), (x - nx * W / 2, s - ns * W / 2)])


def rows_lanes(rows):
    out = []
    for r in rows:
        for k in range(r['count']):
            out.append((r['x'] + r['step'][0] * k, r['s'] + r['step'][1] * k, r['dir'][0], r['dir'][1]))
    return out


def check(name, outline, rows, L, W, keep=(), margin=.45, gap=.7):
    poly = Polygon(outline).buffer(-margin)
    lanes = [lane_poly(x, s, dx, ds, L + .15, W + .1) for x, s, dx, ds in rows_lanes(rows)]
    for i, p in enumerate(lanes):
        assert poly.contains(p), f'{name}: lane {i + 1} is not inside the outline'
        for q in keep:
            assert not p.intersects(Polygon(q).buffer(.5)), f'{name}: lane {i + 1} hits the kiosk'
        for j in range(i):
            assert p.distance(lanes[j]) >= gap, f'{name}: lanes {j + 1} and {i + 1} are too close'
    return len(lanes)


def unit(a, b):
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]


courses = []
# ---------- Torshov minigolfpark (OSM way 72563100): a 45 x 14 m strip, the kiosk (way 801539736) in its west corner ----------
T = ring('torshov')
D_, E_ = T[3], T[4]                      # the long south edge (along the footway)
e1 = unit(D_, E_)
n1 = [e1[1], -e1[0]]                     # into the strip (toward Hegermanns gate)
at = lambda u, n: [round(D_[0] + e1[0] * u + n1[0] * n, 3), round(D_[1] + e1[1] * u + n1[1] * n, 3)]
L_OUT, W_OUT = 5.6, 1.25
t_rows = [{'x': at(7.2, 7.75)[0], 's': at(7.2, 7.75)[1], 'dir': [round(n1[0], 5), round(n1[1], 5)], 'step': [round(e1[0] * 3.75, 4), round(e1[1] * 3.75, 4)], 'count': 9},
          {'x': at(36.2, 6.25)[0], 's': at(36.2, 6.25)[1], 'dir': [round(-n1[0], 5), round(-n1[1], 5)], 'step': [round(-e1[0] * 3.75, 4), round(-e1[1] * 3.75, 4)], 'count': 9}]
check('torshov', T, t_rows, L_OUT, W_OUT, keep=[ring('torshov-kiosk')])
courses.append({
    'id': 'torshov', 'name': 'Torshov minigolfpark', 'short': 'Torshov', 'osm': 'way 72563100', 'kioskOsm': 'way 801539736',
    'address': 'Hegermanns gate 25, 0476 Oslo', 'operator': 'Christiania Minigolf Club', 'website': 'http://minigolfparken.no/',
    'kind': 'outdoor', 'surface': 'eternit', 'holes': 18, 'price': {'adult': 90, 'child': 60},
    'hours': 'Every day 12–21 in the season (last tee-off 20:00)', 'season': 'Summer half-year (April–October)',
    'outline': T, 'kiosk': ring('torshov-kiosk'), 'gate': at(5.2, 14.6), 'gateDir': [round(-n1[0], 5), round(-n1[1], 5)],
    'rows': t_rows, 'lane': [L_OUT, W_OUT],
    'order': ['straight', 'pyramids', 'angle', 'waves', 'plateau', 'lightning', 'windmill', 'hill', 'loop',
              'bridge', 'volcano', 'tube', 'gates', 'slope', 'bowl', 'bumpers', 'banks', 'uphill'],
    'pars': [2, 2, 2, 2, 2, 3, 2, 2, 2, 3, 3, 2, 2, 2, 2, 3, 2, 2],
    'benches': [at(41.5, 3.0), at(41.5, 6.5), at(2.5, 3.5)]})

# ---------- Grünerløkka Minigolf park (OSM way 44044598, fenced): about 48 x 32 m by Søndre gate / Thorvald Meyers gate ----------
G = ring('grunerlokka')
g_rows = [{'x': -1009.2, 's': 1992.4, 'dir': [0, -1], 'step': [4.0, 0], 'count': 9},
          {'x': -982.6, 's': 1995.0, 'dir': [0, 1], 'step': [-4.0, 0], 'count': 9}]
check('grunerlokka', G, g_rows, L_OUT, W_OUT, keep=[ring('grunerlokka-kiosk')])
courses.append({
    'id': 'grunerlokka', 'name': 'Grünerløkka Minigolfpark', 'short': 'Grünerløkka', 'osm': 'way 44044598',
    'address': 'Søndre gate 1, 0550 Oslo', 'operator': 'Christiania Minigolf Club', 'website': 'http://minigolfparken.no/',
    'kind': 'outdoor', 'surface': 'eternit', 'holes': 18, 'price': {'adult': 90, 'child': 60},
    'hours': 'Every day 12–21 in the season (last tee-off 20:00)', 'season': 'Summer half-year (April–October)',
    'outline': G, 'kiosk': ring('grunerlokka-kiosk'), 'kioskOsm': 'way 1031362183', 'gate': [-971.95, 1993.7], 'gateDir': [-1, 0],
    'rows': g_rows, 'lane': [L_OUT, W_OUT],
    'order': ['straight', 'angle', 'pyramids', 'hill', 'windmill', 'waves', 'lightning', 'loop', 'plateau',
              'gates', 'bridge', 'slope', 'tube', 'volcano', 'bumpers', 'bowl', 'banks', 'uphill'],
    'pars': [2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 3, 2, 2, 3, 3, 2, 2, 2],
    'benches': [[-1000, 2008.5], [-992, 2010.5], [-984, 2011.5]]})

# ---------- Jordal park (OSM way 1297710953, fee=no): a free 10 x 10 m course; three short holes found by a search ----------
J = ring('jordal')
JL, JW = 3.4, .9
best = None
pj = Polygon(J).buffer(-.2)
for ang in range(0, 180, 6):
    a = math.radians(ang)
    d = [math.sin(a), -math.cos(a)]                   # lane direction (bearing ang, x east, s south)
    st = [-d[1], d[0]]
    for ox in [i * .4 for i in range(-12, 13)]:
        for os_ in [i * .4 for i in range(-12, 13)]:
            c = pj.centroid
            x0, s0 = c.x + ox - d[0] * JL / 2 - st[0] * 1.6, c.y + os_ - d[1] * JL / 2 - st[1] * 1.6
            lanes = [lane_poly(x0 + st[0] * 1.6 * k, s0 + st[1] * 1.6 * k, d[0], d[1], JL + .15, JW + .1) for k in range(3)]
            if all(pj.contains(p) for p in lanes):
                m = min(pj.exterior.distance(p) for p in lanes)
                if best is None or m > best[0]:
                    best = (m, x0, s0, d, st)
assert best, 'jordal: no room for three lanes'
_, x0, s0, d, st = best
j_rows = [{'x': round(x0, 3), 's': round(s0, 3), 'dir': [round(d[0], 5), round(d[1], 5)], 'step': [round(st[0] * 1.6, 4), round(st[1] * 1.6, 4)], 'count': 3}]
check('jordal', J, j_rows, JL, JW, margin=.2, gap=.5)
courses.append({
    'id': 'jordal', 'name': 'Jordal park minigolf', 'short': 'Jordal park', 'osm': 'way 1297710953',
    'address': 'Jordal park by Strømsveien, 0657 Oslo', 'operator': 'Oslo kommune (park)', 'website': '',
    'kind': 'outdoor', 'surface': 'concrete', 'holes': 3, 'price': {'adult': 0, 'child': 0},
    'hours': 'Always open, free', 'season': 'All year', 'outline': J, 'kiosk': None, 'gate': None,
    'rows': j_rows, 'lane': [JL, JW], 'order': ['straight', 'hill', 'angle'], 'pars': [2, 2, 2], 'benches': []})

# ---------- Oslo Camping (node 4958723297) in Fredshuset (way 183822363), Møllergata 12: the bar ----------
F = ring('fredshuset')
node = osm['nodes']['oslo-camping']
courses.append({
    'id': 'oslo-camping', 'name': 'Oslo Camping', 'short': 'Oslo Camping', 'osm': 'node 4958723297', 'building': 'w183822363', 'buildingOsm': 'way 183822363',
    'district': 'mollergata', 'address': 'Møllergata 12, 0179 Oslo', 'operator': 'Campingen (Oslo Camping)', 'website': 'https://www.campingen.no/oslo',
    'kind': 'bar', 'surface': 'felt', 'holes': 18, 'price': {'adult': 155, 'student': 130, 'child': 120},
    'hours': 'Mon–Tue 13–22 · Wed–Thu 13–24 · Fri 13–01:30 · Sat 12–01:30 · Sun 12–22', 'season': 'All year (indoor)',
    'ageLimit': '20 years after 19:00 every day', 'node': list(local(*node['latlon'])), 'fredshuset': F,
    # Opening hours as [open, close] per weekday (0 = Sunday), close after midnight as 24 + h.
    'open': [[12, 22], [13, 22], [13, 22], [13, 24], [13, 24], [13, 25.5], [12, 25.5]],
    # The bar sits in a notch of Fredshuset's Møllergata wall (edge 0 of the decoded outline, t .05-.95, 19 m deep).
    'notch': {'edge': 0, 't0': .05, 't1': .95, 'depth': 19}, 'upstairs': 11,
    'order': ['straight', 'tent', 'pyramids', 'caravan', 'angle', 'campfire', 'waves', 'canoe', 'bumpers', 'loop', 'hill',
              'slope', 'tube', 'gates', 'bowl', 'lightning', 'banks', 'uphill'],
    'pars': [2, 2, 2, 3, 2, 3, 2, 3, 3, 2, 2, 2, 2, 2, 2, 3, 2, 2]})

out = {'note': 'Real minigolf courses inside the game world (issue #114), from OpenStreetMap (c) OpenStreetMap contributors, ODbL 1.0 '
       '(Overpass leisure=miniature_golf, 15 Nov 2026), minigolfparken.no and campingen.no/oslo (prices, hours). Made by tools/make-minigolf.py.',
       'courses': courses}
text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(ROOT, 'minigolf-data.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('/* Minigolf courses at their real places (issue #114), made by tools/make-minigolf.py. Map data (c) OpenStreetMap contributors (ODbL). */\n')
    f.write('(function (root) {const data = ' + text + ';if (typeof module === "object" && module.exports) module.exports = data;else root.MINIGOLF = data;})(typeof window === "undefined" ? globalThis : window);\n')
print('minigolf-data.js:', ', '.join(f"{c['short']} {len(rows_lanes(c['rows'])) if 'rows' in c else c['holes']} lanes" for c in courses), f'({len(text) // 1024} KB)')
