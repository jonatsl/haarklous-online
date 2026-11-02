"""Download the source data for a district patch of the world (issue #38: Gamle Oslo, Ensjø and the way there) into assets/osm/.

    python tools/fetch-district.py [name x0 s0 x1 s1]        (default: gamle-oslo -1600 560 1792 4000)

The box is in the game's local metres (x east, s south of Haarklous plass 17A); use multiples of 16. Writes:
- assets/osm/<name>-osm.json.gz: an OpenStreetMap extract (Overpass API) for the box plus 60 m: buildings, roads and paths,
  railways, areas (parks, grass, woods, water, pitches, parking ...), chimneys, trees, place names and railway stations.
  Only the tags the generator reads are kept. Data (c) OpenStreetMap contributors, ODbL 1.0.
- assets/osm/<name>-dtm-2m.png (+ .json with its UTM box): Kartverket's terrain model (DTM, nhm_dtm_topo_25833, 2 m,
  CC BY 4.0) stored as 16-bit grey: value = (height + 10 m) * 100 (centimetres). Missing cells (only far out in the fjord)
  are stored as sea level.
Then run `python tools/make-district.py <name>` and `python build.py`.
"""
import gzip
import json
import math
import os
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
NAME = sys.argv[1] if len(sys.argv) > 1 else 'gamle-oslo'
BOX = tuple(int(v) for v in sys.argv[2:6]) if len(sys.argv) >= 6 else (-1600, 560, 1792, 4000)
KEEP = {'place', 'station', 'subway', 'building', 'building:levels', 'roof:levels', 'height', 'min_height', 'name', 'highway', 'footway', 'service', 'tunnel', 'layer',
        'location', 'railway', 'landuse', 'leisure', 'natural', 'amenity', 'waterway', 'water', 'man_made', 'bridge', 'area', 'covered', 'type', 'parking'}

src = open(os.path.join(ROOT, 'surroundings-data.js'), encoding='utf-8').read()
origin = json.loads(src[src.index('{'):src.rindex('}') + 1])['origin']
LAT0, LON0 = origin['lat'], origin['lon']
KX = 111320 * math.cos(math.radians(LAT0))


def to_utm33(lat, lon):                     # the same formula as generate-surroundings.py
    a = 6378137.0; f = 1 / 298.257222101; k0 = 0.9996; lon0 = math.radians(15)
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); phi = math.radians(lat); lam = math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2); T = math.tan(phi) ** 2; C = ep2 * math.cos(phi) ** 2; A = math.cos(phi) * (lam - lon0)
    e4 = e2 * e2; e6 = e4 * e2
    M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


x0, s0, x1, s1 = BOX
bbox = f'{LAT0 - (s1 + 60) / 111320:.4f},{LON0 + (x0 - 60) / KX:.4f},{LAT0 - (s0 - 60) / 111320:.4f},{LON0 + (x1 + 60) / KX:.4f}'
query = f'''[out:json][timeout:170][bbox:{bbox}];
(way[building];relation[building];way[highway];way[railway];way[landuse];relation[landuse];way[leisure];relation[leisure];
 way[natural];relation[natural];way[amenity~"^(parking|school|kindergarten|grave_yard)$"];way[waterway];
 node[man_made=chimney];way[man_made=chimney];node[natural=tree];
 node[place~"^(suburb|neighbourhood|quarter)$"];node[railway=station];);out geom;'''
req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': AGENT})
osm = json.loads(urllib.request.urlopen(req, timeout=240).read().decode('utf-8'))
r7 = lambda v: round(v, 7)
for e in osm['elements']:
    if 'tags' in e:
        e['tags'] = {k: v for k, v in e['tags'].items() if k in KEEP}
    if 'geometry' in e:
        e['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} for p in e['geometry']]
    for m in e.get('members', []):
        m.pop('ref', None)
        if 'geometry' in m:
            m['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} for p in m['geometry'] if p]
    for k in ('nodes', 'bounds', 'timestamp', 'version', 'changeset', 'user', 'uid'):
        e.pop(k, None)
osm['note'] = f'OpenStreetMap extract for the {NAME} district patch, local box {BOX} (Overpass). Data (c) OpenStreetMap contributors, ODbL 1.0.'
with gzip.open(os.path.join(ROOT, f'assets/osm/{NAME}-osm.json.gz'), 'wt', encoding='utf-8') as f:
    json.dump(osm, f, separators=(',', ':'), ensure_ascii=False)

corners = [to_utm33(LAT0 - s / 111320, LON0 + x / KX) for x in (x0 - 100, x1 + 100) for s in (s0 - 100, s1 + 100)]
ux0, uy0 = math.floor(min(c[0] for c in corners) / 2) * 2, math.floor(min(c[1] for c in corners) / 2) * 2
ux1, uy1 = math.ceil(max(c[0] for c in corners) / 2) * 2, math.ceil(max(c[1] for c in corners) / 2) * 2
url = ('https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_dtm_topo_25833'
       f'&format=GeoTIFF&crs=EPSG:25833&bbox={ux0},{uy0},{ux1},{uy1}&width={(ux1 - ux0) // 2}&height={(uy1 - uy0) // 2}')
tmp = os.path.join(ROOT, f'assets/osm/_{NAME}-dtm.tif')
with open(tmp, 'wb') as f:
    f.write(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=300).read())
dtm = np.array(Image.open(tmp), dtype=float)
os.remove(tmp)
dtm[~np.isfinite(dtm) | (dtm < -9) | (dtm > 500)] = 0.0          # no-data cells (only in the fjord)
Image.fromarray(np.clip(np.round((dtm + 10) * 100), 0, 65535).astype(np.uint16)).save(os.path.join(ROOT, f'assets/osm/{NAME}-dtm-2m.png'))
with open(os.path.join(ROOT, f'assets/osm/{NAME}-dtm-2m.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump({'note': f'Kartverket DTM (nhm_dtm_topo_25833, CC BY 4.0) in {NAME}-dtm-2m.png: value = (height + 10 m) * 100, row 0 = north.',
               'x0': ux0, 'y0': uy0, 'x1': ux1, 'y1': uy1, 'res': 2}, f)
    f.write('\n')
print(f"{NAME}: {len(osm['elements'])} OSM elements, DTM {dtm.shape[1]}x{dtm.shape[0]} cells ({dtm.min():.1f}..{dtm.max():.1f} m)")
