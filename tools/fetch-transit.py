"""Download the public transport lines that run through the game world (issue #111) into assets/osm/.

    python tools/fetch-transit.py

Asks the Overpass API for every OpenStreetMap route relation (route = tram, bus, subway) with a member inside the game's
box (local x -1600..2304, s -800..4000, plus 100 m), with the full geometry of their ways, the tags of their ways and stop
nodes (names, tunnel / bridge / layer / oneway), their route masters (line colour), and the metro stations, platforms and
entrances in the box. Writes assets/osm/transit-osm.json.gz. Data (c) OpenStreetMap contributors, ODbL 1.0.
Then run `node tools/make-transit.cjs` and `python build.py`.
"""
import gzip
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)'
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
BOX = (-1600, -800, 2304, 4000)

src = open(os.path.join(ROOT, 'surroundings-data.js'), encoding='utf-8').read()
origin = json.loads(src[src.index('{'):src.rindex('}') + 1])['origin']
LAT0, LON0 = origin['lat'], origin['lon']
KX = 111320 * math.cos(math.radians(LAT0))
x0, s0, x1, s1 = BOX
bbox = f'{LAT0 - (s1 + 100) / 111320:.4f},{LON0 + (x0 - 100) / KX:.4f},{LAT0 - (s0 - 100) / 111320:.4f},{LON0 + (x1 + 100) / KX:.4f}'
query = f'''[out:json][timeout:300];
relation[type=route][route~"^(tram|bus|subway|light_rail)$"]({bbox})->.r;
.r out geom;
way(r.r)->.w;
.w out tags;
node(r.r)->.n;
.n out;
rel(br.r)[type=route_master]->.m;
.m out tags;
(
  node[railway=subway_entrance]({bbox});
  nwr[railway=station]({bbox});
  nwr[public_transport=station]({bbox});
  way[railway=platform]({bbox});
  way[public_transport=platform][subway=yes]({bbox});
  way[railway=subway]({bbox});
);
out geom;'''


def fetch():
    last = None
    for url in SERVERS * 2:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(), headers={'User-Agent': AGENT})
            return json.loads(urllib.request.urlopen(req, timeout=400).read().decode('utf-8'))
        except Exception as e:  # overloaded servers answer 429 / 504
            last = e
            print(f'{url}: {e}', file=sys.stderr)
            time.sleep(10)
    raise last


osm = fetch()
r7 = lambda v: round(v, 7)
for e in osm['elements']:
    if 'geometry' in e:
        e['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} if p else None for p in e['geometry']]
    for m in e.get('members', []):
        if 'geometry' in m:
            m['geometry'] = [{'lat': r7(p['lat']), 'lon': r7(p['lon'])} for p in m['geometry'] if p]
    for k in ('bounds', 'timestamp', 'version', 'changeset', 'user', 'uid'):
        e.pop(k, None)
osm['note'] = f'Public transport routes through the game world, local box {BOX} (Overpass, fetched {time.strftime("%Y-%m-%d")}). Data (c) OpenStreetMap contributors, ODbL 1.0.'
out = os.path.join(ROOT, 'assets/osm/transit-osm.json.gz')
with gzip.open(out, 'wt', encoding='utf-8') as f:
    json.dump(osm, f, separators=(',', ':'), ensure_ascii=False)
routes = [e for e in osm['elements'] if e['type'] == 'relation' and e.get('tags', {}).get('type') == 'route']
print(f'{len(osm["elements"])} elements, {len(routes)} routes, {os.path.getsize(out) // 1024} KB')
