/* Makes parking-data.js (issue #113): the parked vehicles of the whole game area, planned by game-parking.js from the map and
 * what OpenStreetMap says about parking.
 * Input (kept in assets/ so the file can be made again without the network):
 *   assets/osm/parking-osm-2026-11-15.json.gz – Overpass extract of the whole game area: streets with parking or one-way tags,
 *     car parks, bicycle / motorcycle parking, taxi ranks, charging points, bus and tram stops, crossings, entrances and gates
 *     (`node tools/make-parking.cjs --fetch` gets it again).
 *   the map (surroundings-data.js and the district patches) and the job stops (jobs-data.js).
 * Run: node tools/make-parking.cjs [--fetch]   (then python build.py). Data (c) OpenStreetMap contributors, ODbL 1.0.
 * Run it again after the map data (roads, buildings, trees), jobs-data.js or game-parking.js change: tests/city-cars.test.cjs
 * checks that the stored plan is up to date.
 * Output: parking-data.js, window.PARKING_PLAN = {cars, small} (GameParking.pack; also module.exports).
 * As a module: osmData() -> what the planner reads from the extract, in local metres (x east, s south of Haarklous plass 17A):
 *   ways  [{p: [x, s, …], l, r, o}]   streets with parking or one-way tags: l / r = the left / right kerb in the way's direction:
 *                                      0 none, 1 parallel, 2 diagonal, 3 perpendicular, +4 half on the kerb, +8 on the kerb or in a
 *                                      lay-by; -1 not tagged. o = 1 one-way along p, -1 one-way against p, 0 both ways.
 *   lots  [{p: [ring], k, c}]         public car parks: k 'surface', or 'lane' / 'street_side' (parking bays mapped as areas);
 *                                      c = capacity (0 unknown). Underground, multi-storey and private ones are left out.
 *   stops, crossings, entrances, gates, charging: [x, s, …]  (the first four only within 15 m of a street)
 *   bikes, motos, taxis: [x, s, capacity, …] (way areas by their centre)
 * planArgs(osm) -> the arguments GameParking.plan gets (everything that does not change while the game runs; a job's stopping
 *   place is kept free 0.5 m beyond the vehicle's end).
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const ASSET = path.join(ROOT, 'assets/osm/parking-osm-2026-11-15.json.gz');
const AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)';
const LAT0 = 59.936404, LON0 = 10.776657, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const BOX = {x0: -1660, s0: -860, x1: 2364, s1: 4060};// every walkable box of the game plus 60 m
const BBOX = [LAT0 - BOX.s1 / 111320, LON0 + BOX.x0 / KX, LAT0 - BOX.s0 / 111320, LON0 + BOX.x1 / KX].map(v => v.toFixed(5)).join(',');
const local = (lat, lon) => [Math.round((lon - LON0) * KX * 10) / 10, Math.round(-(lat - LAT0) * 111320 * 10) / 10];

async function overpass(query) {
  for (let wait = 5; wait < 400; wait *= 2) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {method: 'POST', headers: {'User-Agent': AGENT, 'Content-Type': 'application/x-www-form-urlencoded'}, body: 'data=' + encodeURIComponent(query)});
    const text = await r.text();
    if (r.ok && text.trim().startsWith('{')) return JSON.parse(text).elements;
    console.log(`Overpass busy (${r.status}), retrying in ${wait} s`);await new Promise(res => setTimeout(res, wait * 1000));
  }
  throw new Error('Overpass did not answer');
}
const KEEP = /^(highway|oneway|junction|parking(:.*)?|amenity|capacity|access|bus|tram|public_transport|railway|entrance|barrier|footway|crossing|service|name)$/;
async function fetchAsset() {
  const head = `[out:json][timeout:170][bbox:${BBOX}];`, CAR = 'residential|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|unclassified|living_street|trunk|service';
  const ways = await overpass(head + `(way[highway~"^(${CAR})$"][~"^parking"~"."];way[highway~"^(${CAR})$"][oneway];way[highway~"^(${CAR})$"][junction=roundabout];);out tags geom;`);
  const areas = await overpass(head + 'way[amenity~"^(parking|bicycle_parking|motorcycle_parking|taxi)$"];out tags geom;');
  const nodes = await overpass(head + '(node[highway~"^(bus_stop|crossing)$"];node[public_transport=platform];node[railway~"^(tram_stop|crossing|level_crossing|tram_crossing)$"];node[entrance];node[barrier~"^(gate|lift_gate|swing_gate|sliding_gate)$"];node[amenity~"^(taxi|bicycle_parking|motorcycle_parking|charging_station|parking_entrance)$"];);out;');
  const slim = e => {const o = {type: e.type, id: e.id, tags: {}};for (const [k, v] of Object.entries(e.tags || {})) if (KEEP.test(k)) o.tags[k] = v;if (e.geometry) o.geometry = e.geometry.map(g => [+g.lat.toFixed(7), +g.lon.toFixed(7)]);if (e.lat !== undefined) o.at = [+e.lat.toFixed(7), +e.lon.toFixed(7)];return o;};
  const out = {source: 'OpenStreetMap contributors (ODbL 1.0), Overpass API ' + new Date().toISOString().slice(0, 10), bbox: BBOX, ways: ways.map(slim), areas: areas.map(slim), nodes: nodes.map(slim)};
  fs.writeFileSync(ASSET, zlib.gzipSync(JSON.stringify(out)));
  console.log(`Wrote ${path.relative(ROOT, ASSET)}: ${ways.length} ways, ${areas.length} areas, ${nodes.length} nodes`);
}

// One kerb's parking from the tags (new scheme parking:<side>=…, old scheme parking:lane:<side>=…).
function side(t, s) {
  const get = k => t[`parking:${s}${k}`] ?? t[`parking:both${k}`];
  const lane = t[`parking:lane:${s}`] ?? t['parking:lane:both'];
  let v = get(''), orient = get(':orientation'), restr = get(':restriction') || '', access = get(':access') || '';
  if (v === undefined && lane !== undefined) {// old scheme
    if (/^(parallel|diagonal|perpendicular|marked|yes)$/.test(lane)) {orient = lane === 'marked' || lane === 'yes' ? 'parallel' : lane;v = 'lane';
      const pos = t[`parking:lane:${s}:${lane}`] ?? t[`parking:lane:both:${lane}`];if (pos === 'half_on_kerb') v = 'half_on_kerb';else if (pos === 'on_kerb') v = 'on_kerb';else if (pos === 'street_side' || pos === 'lay_by') v = 'street_side';
      const cond = t[`parking:condition:${s}`] ?? t['parking:condition:both'];if (/^(no_parking|no_stopping|loading|disabled|private)$/.test(cond || '')) restr = cond;
    } else v = 'no';
  }
  if (v === undefined) return -1;
  if (!/^(lane|street_side|on_kerb|half_on_kerb|shoulder|yes)$/.test(v)) return 0;
  if (/no_parking|no_stopping|loading|charging|disabled/.test(restr) || /^(no|private)$/.test(access)) return 0;// kept free (a loading bay is not a parking place)
  const o = orient === 'diagonal' ? 2 : orient === 'perpendicular' ? 3 : 1;
  return o + (v === 'half_on_kerb' ? 4 : v === 'on_kerb' || v === 'street_side' ? 8 : 0);
}
// Douglas-Peucker on a flat [x, s, …] line (tolerance m), then integer decimetres with deltas after the first point.
function simplify(p, tol) {
  const n = p.length / 2;if (n <= 2) return p;const keep = new Uint8Array(n);keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();let best = -1, bd = tol;
    const ax = p[2 * a], as = p[2 * a + 1], dx = p[2 * b] - ax, ds = p[2 * b + 1] - as, L = Math.hypot(dx, ds) || 1;
    for (let i = a + 1; i < b; i++) {const d = Math.abs((p[2 * i] - ax) * ds - (p[2 * i + 1] - as) * dx) / L;if (d > bd) {bd = d;best = i;}}
    if (best >= 0) {keep[best] = 1;stack.push([a, best], [best, b]);}
  }
  return p.filter((v, i) => keep[i >> 1]);
}
const STREETS = /^(residential|tertiary|tertiary_link|secondary|secondary_link|unclassified|living_street|primary|primary_link)$/;
function osmData() {
  const asset = JSON.parse(zlib.gunzipSync(fs.readFileSync(ASSET)).toString('utf-8'));
  const flat = g => g.flatMap(([lat, lon]) => local(lat, lon));
  // The game's streets: points (crossings, stops, entrances, gates) further than 15 m from all of them are left out.
  globalThis.window = globalThis;if (!window.DISTRICTS) window.DISTRICTS = [];// (the map may be loaded already, e.g. by a test)
  for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'loren-data.js', 'okern-data.js']) require(path.join(ROOT, f));
  const District = require(path.join(ROOT, 'district.js'));
  const groads = [...window.SURROUNDINGS.roads, ...window.DISTRICTS.map(d => District.decode(d)).flatMap(d => d.roads)].filter(r => STREETS.test(r.k) || r.k === 'service');
  const G = 40, grid = new Map();
  for (const r of groads) for (let i = 0; i + 3 < r.p.length; i += 2) {
    const a = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
    for (let gi = Math.floor((Math.min(a[0], a[2]) - 20) / G); gi <= Math.floor((Math.max(a[0], a[2]) + 20) / G); gi++) for (let gj = Math.floor((Math.min(a[1], a[3]) - 20) / G); gj <= Math.floor((Math.max(a[1], a[3]) + 20) / G); gj++) {const k = gi + ',' + gj;if (!grid.has(k)) grid.set(k, []);grid.get(k).push(a);}
  }
  const segDist = (x, s, a) => {const dx = a[2] - a[0], ds = a[3] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (s - a[1]) * ds) / L));return Math.hypot(x - a[0] - dx * t, s - a[1] - ds * t);};
  const byStreet = (x, s, d = 15) => (grid.get(Math.floor(x / G) + ',' + Math.floor(s / G)) || []).some(a => segDist(x, s, a) < d);
  const ways = [];
  for (const e of asset.ways) {
    if (!e.geometry || e.geometry.length < 2 || !STREETS.test(e.tags.highway)) continue;
    const t = e.tags, o = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0, l = side(t, 'left'), r = side(t, 'right');
    if (l < 0 && r < 0 && !o) continue;
    ways.push({p: simplify(flat(e.geometry), .4), l, r, o});
  }
  const centre = g => {let x = 0, s = 0;for (const [a, b] of g) {const [px, ps] = local(a, b);x += px / g.length;s += ps / g.length;}return [Math.round(x * 10) / 10, Math.round(s * 10) / 10];};
  const cap = t => Math.max(0, Math.min(400, parseInt(t.capacity, 10) || 0));
  const lots = [], bikes = [], motos = [], taxis = [];
  for (const e of asset.areas) {
    if (!e.geometry || e.geometry.length < 4) continue;const t = e.tags, a = t.amenity;
    if (a === 'parking') {const k = t.parking || 'surface';if (/^(surface|lane|street_side)$/.test(k) && !/^(private|no)$/.test(t.access || '')) lots.push({p: simplify(flat(e.geometry.slice(0, -1)), .25), k, c: cap(t)});}
    else (a === 'bicycle_parking' ? bikes : a === 'motorcycle_parking' ? motos : taxis).push(...centre(e.geometry), cap(t));
  }
  const pts = {stops: [], crossings: [], entrances: [], gates: [], charging: []};
  for (const e of asset.nodes) {
    const t = e.tags, p = local(...e.at), a = t.amenity;
    if (!a && !byStreet(...p)) continue;
    if (t.highway === 'bus_stop' || t.public_transport === 'platform' || t.railway === 'tram_stop') pts.stops.push(...p);
    else if (t.highway === 'crossing' || /crossing/.test(t.railway || '')) pts.crossings.push(...p);
    else if (t.entrance) pts.entrances.push(...p);
    else if (t.barrier) pts.gates.push(...p);
    else if (a === 'charging_station') pts.charging.push(...p);
    else if (a === 'bicycle_parking') bikes.push(...p, cap(t));
    else if (a === 'motorcycle_parking') motos.push(...p, cap(t));
    else if (a === 'taxi') taxis.push(...p, cap(t));
  }
  return {source: asset.source, ways, lots, ...pts, bikes, motos, taxis};
}
// The map and the job stops (the plan keeps those free) as GameParking.plan wants them.
function planArgs(osm) {
  require(path.join(ROOT, 'surroundings.js'));require(path.join(ROOT, 'jobs-data.js'));
  const District = require(path.join(ROOT, 'district.js'));
  const D = window.SURROUNDINGS, DS = window.DISTRICTS.map(d => District.decode(d)), areas = [...D.areas, ...DS.flatMap(d => d.areas)];
  const points = [...D.lamps];for (let i = 0; i < D.trees.length; i += 3) points.push(D.trees[i], D.trees[i + 1]);for (const d of DS) for (const t of d.trees) points.push(t.x, t.s);
  return {roads: [...D.roads, ...DS.flatMap(d => d.roads)], osm, water: [...areas.filter(a => a.k === 'water').map(a => a.o), ...DS.flatMap(d => d.sea)],
    rects: window.Surroundings.walkRects(D.terrain.half, 760, DS), buildings: [...D.buildings.map(b => b.r.o), ...DS.flatMap(d => d.buildings.map(b => b.ring.flat()))], points,
    // A job's stopping place (the taxi's ring, game-jobs.js) is never under a vehicle; the taxi stops beside a parked car within reach.
    clear: [...window.JOBS.doors, ...window.JOBS.pickups].map(d => ({x: d.cx, s: d.cs, r: .5}))};
}
function build() {
  const GP = require(path.join(ROOT, 'game-parking.js')), osm = osmData(), t0 = Date.now(), plan = GP.plan(planArgs(osm));
  const out = {source: osm.source, cars: GP.pack(plan.cars), small: GP.pack(plan.small)};
  const js = `/* The parked vehicles of the game area (issue #113): made by tools/make-parking.cjs with game-parking.js from the map and ${osm.source}. Data (c) OpenStreetMap contributors, ODbL 1.0.
 * Per vehicle four integers (GameParking.unpack): x and s change from the one before (dm), heading (mrad), (type × 16 + colour) × 4 + where. */
(function (d) {if (typeof module === 'object' && module.exports) module.exports = d;else window.PARKING_PLAN = d;})(${JSON.stringify(out)});
`;
  fs.writeFileSync(path.join(ROOT, 'parking-data.js'), js);
  const by = {};for (const c of plan.cars) by[c.where] = (by[c.where] || 0) + 1;
  console.log(`Wrote parking-data.js (${(js.length / 1024).toFixed(0)} KB) in ${Date.now() - t0} ms: ${plan.cars.length} motor vehicles (${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ')}), ${plan.small.length} bicycles and mopeds; from ${osm.ways.length} tagged streets, ${osm.lots.length} car parks, ${osm.stops.length / 2} stops, ${osm.crossings.length / 2} crossings, ${osm.bikes.length / 3} bike parkings, ${osm.taxis.length / 3} taxi ranks`);
}
module.exports = {osmData, planArgs};
if (require.main === module) (async () => {if (process.argv.includes('--fetch') || !fs.existsSync(ASSET)) await fetchAsset();build();})();
