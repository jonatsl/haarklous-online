/* Makes rides-data.js (Oslo city bike docks, issue #57) and jobs-data.js (food pickups and street doors, issue #56).
 * Inputs (kept in assets/ so the files can be made again without the network):
 *   assets/gbfs/oslo-bysykkel-2026-11-03.json – Oslo Bysykkel's GBFS station_information, vehicle types and prices (NLOD 2.0)
 *   assets/osm/jobs-osm-2026-11-03.json      – OpenStreetMap address points and cafés / restaurants / fast food (ODbL)
 *   surroundings-data.js, gamle-oslo-data.js, myrens-data.js – buildings and roads of the game world
 * Run: node tools/make-jobs-rides.cjs   (then python build.py)
 * Local map coordinates: x east, s south, metres from Haarklous plass (59.936404 N, 10.776657 E), as in surroundings-data.js.
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
require(path.join(ROOT, 'surroundings-data.js'));require(path.join(ROOT, 'gamle-oslo-data.js'));require(path.join(ROOT, 'myrens-data.js'));
const District = require(path.join(ROOT, 'district.js'));
const D = window.SURROUNDINGS, DISTRICTS = (window.DISTRICTS || []).map(d => District.decode(d));
const LAT0 = 59.936404, LON0 = 10.776657, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const local = (lat, lon) => ({x: (lon - LON0) * KX, s: -(lat - LAT0) * 111320});
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

// ---------- The world's buildings and roads (local x, s) ----------
const pairs = flat => {const o = [];for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i], flat[i + 1]]);return o;};
const buildings = [...D.buildings.map(b => pairs(b.r.o)), pairs(D.ownLocal)];
for (const d of DISTRICTS) {for (const b of d.buildings) buildings.push(b.ring);for (const l of d.landmarks || []) buildings.push(Array.isArray(l.ring[0]) ? l.ring : pairs(l.ring));}
const boxOf = ring => {let x0 = 1e9, s0 = 1e9, x1 = -1e9, s1 = -1e9;for (const [x, s] of ring) {x0 = Math.min(x0, x);x1 = Math.max(x1, x);s0 = Math.min(s0, s);s1 = Math.max(s1, s);}return {x0, s0, x1, s1};};
const bldg = buildings.filter(r => r.length >= 3).map(ring => ({ring, box: boxOf(ring)}));
const CAR = ['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'trunk', 'trunk_link'];
const roads = [...D.roads, ...DISTRICTS.flatMap(d => d.roads)].filter(r => r.p && r.p.length >= 4);
const segs = [];
for (const r of roads) {const car = CAR.includes(r.k);for (let i = 0; i + 3 < r.p.length; i += 2) segs.push({a: [r.p[i], r.p[i + 1]], b: [r.p[i + 2], r.p[i + 3]], w: r.w || 6, k: r.k, n: r.n || '', car});}
const carSegs = segs.filter(s => s.car);
function inside(p, ring) {let c = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;}return c;}
function segPoint(p, s) {const dx = s.b[0] - s.a[0], ds = s.b[1] - s.a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * ds) / L));return [s.a[0] + dx * t, s.a[1] + ds * t];}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function edgeDist(p, ring) {let m = 1e9;for (let i = 0; i < ring.length; i++) m = Math.min(m, dist(p, segPoint(p, {a: ring[i], b: ring[(i + 1) % ring.length]})));return m;}
const nearBuildings = (p, r) => bldg.filter(b => p[0] > b.box.x0 - r && p[0] < b.box.x1 + r && p[1] > b.box.s0 - r && p[1] < b.box.s1 + r);
const inBuilding = (p, margin = 0) => nearBuildings(p, margin + 1).some(b => inside(p, b.ring) || (margin > 0 && edgeDist(p, b.ring) < margin));
function nearestSeg(p, list) {let best = null, bd = 1e9;for (const s of list) {const q = segPoint(p, s), d = dist(p, q);if (d < bd) {bd = d;best = {seg: s, q, d};}}return best;}
const onCarriageway = (p, slack = 0) => carSegs.some(s => dist(p, segPoint(p, s)) < s.w / 2 - slack);

// ---------- City bike docks (issue #57) ----------
// Torshov (the old square), the Myrens patch and Grünerløkka with Sofienberg, Rodeløkka, Dælenenga and Carl Berner.
const REGIONS = [{name: 'Torshov', x0: -740, s0: -740, x1: 740, s1: 740}, {name: 'Myrens', x0: -1150, s0: -130, x1: -740, s1: 510}, {name: 'Grünerløkka', x0: -1300, s0: 740, x1: 300, s1: 2050}];
const SLOT = .8, MAX_SLOTS = 10;// metres between bikes; slots shown per dock (the real docks have 6–36)
const gbfs = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/gbfs/oslo-bysykkel-2026-11-03.json'), 'utf8'));
function axisOf(points) {
  const n = points.length, cx = points.reduce((t, p) => t + p[0], 0) / n, cs = points.reduce((t, p) => t + p[1], 0) / n;
  let xx = 0, ss = 0, xs = 0;for (const [x, s] of points) {xx += (x - cx) ** 2;ss += (s - cs) ** 2;xs += (x - cx) * (s - cs);}
  const a = .5 * Math.atan2(2 * xs, xx - ss), spread = Math.sqrt(Math.max(xx, ss) / n);return {c: [cx, cs], u: [Math.cos(a), Math.sin(a)], spread};
}
// A dock's footprint: the bikes side by side along u (length k x SLOT), each 1.9 m long along n, posts on the +n side.
function dockRect(c, u, n, k) {
  const h = k * SLOT / 2 + .3, out = [];
  for (let i = 0; i <= 8; i++) for (const j of [-1.05, 0, 1.05]) {const a = -h + 2 * h * i / 8;out.push([c[0] + u[0] * a + n[0] * j, c[1] + u[1] * a + n[1] * j]);}
  return out;
}
const docks = [], skipped = [];
for (const st of gbfs.stations) {
  const p = local(st.lat, st.lon), reg = REGIONS.find(r => p.x >= r.x0 && p.x <= r.x1 && p.s >= r.s0 && p.s <= r.s1);if (!reg) continue;
  const area = st.station_area && st.station_area.coordinates && st.station_area.coordinates[0] && st.station_area.coordinates[0][0];
  const pts = area ? area.map(([lon, lat]) => {const q = local(lat, lon);return [q.x, q.s];}) : null;
  const ax = pts && pts.length >= 4 ? axisOf(pts) : null;
  let c = ax ? ax.c : [p.x, p.s];
  const road = nearestSeg(c, carSegs);
  let u = ax && ax.spread > 1.2 ? ax.u : (() => {const dx = road.seg.b[0] - road.seg.a[0], ds = road.seg.b[1] - road.seg.a[1], L = Math.hypot(dx, ds);return [dx / L, ds / L];})();
  // Posts away from the street: n points from the nearest car road toward the dock.
  let n = [-u[1], u[0]];if ((c[0] - road.q[0]) * n[0] + (c[1] - road.q[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const used = docks.map(d => ({c: [d.x, d.s], r: d.slots * SLOT / 2 + 2}));
  const ok = (cc, k) => dockRect(cc, u, n, k).every(q => !inBuilding(q, .25) && !onCarriageway(q, .2)) && used.every(o => dist(o.c, cc) > o.r + k * SLOT / 2);
  let found = null;
  for (let k = Math.min(MAX_SLOTS, st.capacity); k >= 4 && !found; k -= 2) {
    const shifts = [];for (const dn of [0, .5, -.5, 1, -1, 1.5, 2, -1.5, 2.5, 3, 3.5, 4, 5]) for (const du of [0, 1, -1, 2, -2, 3, -3, 4, -4]) shifts.push([dn, du]);
    shifts.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    for (const [dn, du] of shifts) {const cc = [c[0] + n[0] * dn + u[0] * du, c[1] + n[1] * dn + u[1] * du];if (ok(cc, k)) {found = {c: cc, k, moved: Math.hypot(dn, du)};break;}}
  }
  if (!found) {skipped.push(st.name);continue;}
  docks.push({id: st.station_id, name: st.name, area: reg.name, x: r2(found.c[0]), s: r2(found.c[1]), u: [r3(u[0]), r3(u[1])], n: [r3(n[0]), r3(n[1])], slots: found.k, cap: st.capacity, moved: r2(found.moved)});
}
const plan = id => gbfs.pricing_plans.find(p => p.plan_id === id);
const rides = {source: gbfs.source, fetched: gbfs.fetched, operator: gbfs.system.operator, slot: SLOT,
  plans: {bike: plan('bike'), ebike: plan('ebike')}, docks: docks.map(({moved, ...d}) => d)};
fs.writeFileSync(path.join(ROOT, 'rides-data.js'), `/* Generated by tools/make-jobs-rides.cjs. Oslo city bike docks and prices: ${gbfs.source}, fetched ${gbfs.fetched}. */\nwindow.RIDES=${JSON.stringify(rides)};\n`);
console.log(`rides-data.js: ${docks.length} docks (${REGIONS.map(r => `${r.name} ${docks.filter(d => d.area === r.name).length}`).join(', ')}), moved on average ${(docks.reduce((t, d) => t + d.moved, 0) / docks.length).toFixed(1)} m, max ${Math.max(...docks.map(d => d.moved)).toFixed(1)} m`);
if (skipped.length) console.log('  no room for:', skipped.join(', '));

// ---------- Jobs: food pickups and street doors (issue #56) ----------
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/osm/jobs-osm-2026-11-03.json'), 'utf8'));
const SQUARE = 740;// doors and pickups inside the old square around Haarklous plass (walkable, real buildings)
const inSquare = p => Math.abs(p.x) <= SQUARE && Math.abs(p.s) <= SQUARE;
// The street door of the building at p (an address point or a café): where the line from p to the street leaves the building.
function doorFor(p, street) {
  const own = nearBuildings(p, 2).find(b => inside(p, b.ring) || edgeDist(p, b.ring) < 1.5);if (!own) return null;
  const named = street ? carSegs.filter(s => s.n === street) : [];
  const road = nearestSeg(p, named.length ? named : carSegs);if (!road || road.d > 70) return null;
  const dir = [road.q[0] - p[0], road.q[1] - p[1]], L = Math.hypot(dir[0], dir[1]);if (L < .5) return null;const d = [dir[0] / L, dir[1] / L];
  // March out of the building toward the street.
  let t = 0;while (t < L && inside([p[0] + d[0] * t, p[1] + d[1] * t], own.ring)) t += .1;
  if (t >= L) return null;
  const B = [p[0] + d[0] * t, p[1] + d[1] * t], spot = [B[0] + d[0] * .9, B[1] + d[1] * .9];
  if (inBuilding(spot, .3) || nearBuildings(spot, 4).some(b => b !== own && edgeDist(spot, b.ring) < .5)) return null;
  // The car stops here: on the street, about 1.2 m in from its edge on the door's side.
  const w = road.seg.w, back = [-d[0], -d[1]], curb = [road.q[0] + back[0] * Math.max(0, w / 2 - 1.2), road.q[1] + back[1] * Math.max(0, w / 2 - 1.2)];
  return {B, spot, face: Math.atan2(d[0], d[1]), curb, street: road.seg.n, roadDist: L - t};
}
const doors = [], seenDoor = [];
for (const a of osm.addresses) {
  const p = local(a.lat, a.lon), q = [p.x, p.s];if (!inSquare(p)) continue;
  const d = doorFor(q, a.street);if (!d || d.street !== a.street || d.roadDist > 25 || !inSquare({x: d.spot[0], s: d.spot[1]}) || !inSquare({x: d.curb[0], s: d.curb[1]})) continue;
  if (seenDoor.some(o => dist(o, d.spot) < 4)) continue;seenDoor.push(d.spot);
  doors.push({a: `${a.street} ${a.number}`, x: r2(d.spot[0]), s: r2(d.spot[1]), f: r3(d.face), bx: r2(d.B[0]), bs: r2(d.B[1]), cx: r2(d.curb[0]), cs: r2(d.curb[1])});
}
doors.sort((a, b) => a.a.localeCompare(b.a, 'nb', {numeric: true}));
const FOOD = {cafe: 'café', restaurant: 'restaurant', fast_food: 'takeaway'};
const pickups = [];
for (const f of osm.food) {
  const p = local(f.lat, f.lon), q = [p.x, p.s];if (!inSquare(p)) continue;
  const d = doorFor(q, null);if (!d || d.roadDist > 30 || !inSquare({x: d.spot[0], s: d.spot[1]}) || !inSquare({x: d.curb[0], s: d.curb[1]})) continue;
  if (pickups.some(o => o.name === f.name && Math.hypot(o.x - d.spot[0], o.s - d.spot[1]) < 30)) continue;
  pickups.push({name: f.name, kind: FOOD[f.amenity], cuisine: f.cuisine || '', x: r2(d.spot[0]), s: r2(d.spot[1]), f: r3(d.face), bx: r2(d.B[0]), bs: r2(d.B[1]), cx: r2(d.curb[0]), cs: r2(d.curb[1])});
}
pickups.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
const jobs = {source: osm.source, doors, pickups};
fs.writeFileSync(path.join(ROOT, 'jobs-data.js'), `/* Generated by tools/make-jobs-rides.cjs. Street doors from OpenStreetMap address points and food places (${osm.source}). */\nwindow.JOBS=${JSON.stringify(jobs)};\n`);
console.log(`jobs-data.js: ${doors.length} street doors (of ${osm.addresses.length} address points), ${pickups.length} food pickups (of ${osm.food.length})`);
