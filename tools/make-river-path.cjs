// Make river-path-data.js: one continuous path along Akerselva for walking and cycling (issue #147), "Akerselva – turvei",
// from where the game's river starts (Bjølsen) to Vaterland, on the real OpenStreetMap ways.
//   node tools/make-river-path.cjs            (downloads once into assets/osm/akerselva-paths-osm.json.gz, then works offline)
//   require('./tools/make-river-path.cjs')   -> {load, decks, ...} for tests/river-path.test.cjs (the game's ground with the path)
// The route: a shortest path over the OSM ways near the river. Cycleways cost least, footways that allow bikes a little more,
// plain footways and paths more, sidewalks and streets much more, far from the river more again; steps and tunnels are left
// out, so it follows the real riverside paths and leaves them only where they have steps or end. Where a way passes under
// one of Akerselva's bridges there must be room for the path 0.5 m over the water with 2.4 m of headroom (else the route goes
// over the bridge or round its end). Corners are rounded (up to 3 m), points kept 2.5 m from the water's edge.
// Each stretch of the route is one of (runs):
//   0 band    a 3 m band of its own in the ground (road-surface.js path chains: flat across, smoothed along)
//   1 street  along a car street's carriageway or pavement (no band: the street is already flat)
//   2 bridge  on one of Akerselva's bridges (game-kayak.js's decks)
// under: where the band passes under a bridge, the highest it may be. Lamps every 30 m beside the band (away from the water),
// a bench every 200 m or so.
// Map data (c) OpenStreetMap contributors (ODbL 1.0); height data (c) Kartverket (CC BY 4.0).
const fs = require('node:fs'), zlib = require('node:zlib'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
const OSM_FILE = path.join(ROOT, 'assets/osm/akerselva-paths-osm.json.gz'), OUT = path.join(ROOT, 'river-path-data.js');
const W = 3, HW = W / 2, HEADROOM = 2.4, WATER = 2.5, NAME = 'Akerselva – turvei';
const BAND = 0, STREET = 1, BRIDGE = 2;

// ---------- The game's world (as the browser builds it: the river bed lowered, every patch, the bridges, the path) ----------
let cached = null;
function load({withPath = true} = {}) {
  if (cached && cached.withPath === withPath) return cached;
  global.window = globalThis;
  for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'loren-data.js', 'okern-data.js', 'mollergata-data.js', 'bridges-data.js', 'akerselva-data.js']) require(path.join(ROOT, f));
  window.RIVER_PATH = undefined;if (withPath && fs.existsSync(OUT)) {delete require.cache[OUT];require(OUT);}
  const District = require(path.join(ROOT, 'district.js')), RS = require(path.join(ROOT, 'road-surface.js')), CT = require(path.join(ROOT, 'city-textures.js'));
  const Kayak = require(path.join(ROOT, 'game-kayak.js')), RiverPath = require(path.join(ROOT, 'river-path.js'));
  const D = JSON.parse(JSON.stringify(window.SURROUNDINGS)), districts = window.DISTRICTS.map(d => District.decode(d)), A = window.AKERSELVA;
  Kayak.prepare(districts, D, A);
  const b = Buffer.from(D.terrain.dm, 'base64'), raw = new Int16Array(b.buffer, b.byteOffset, b.length / 2), h = new Float32Array(raw.length);for (let i = 0; i < raw.length; i++) h[i] = raw[i] / 10;
  const Wd = RS.world({square: {h, n: D.terrain.n, half: D.terrain.half, step: D.terrain.step, roads: D.roads}, districts, DZ: District});
  const bridges = RS.bridgesOf(window.BRIDGES, {kayak: A}), RP = withPath ? window.RIVER_PATH || null : null;
  const surface = RS.create({...Wd, bridges, paths: RiverPath.pieces(RP, A), slabsAt: (x, s) => ['lokka', 'toyen', 'gronland', 'kampen', 'bjorvika'].includes(CT.zoneAt(x, s))});
  cached = {withPath, D, districts, District, RS, Kayak, RiverPath, A, R: Kayak.river(A), W: Wd, surface, RP};
  return cached;
}
// Akerselva's bridge decks as game-kayak.js lays them out (GameKayak.layout), in the local frame, on this ground.
function decks(L) {
  const {Kayak, A, R, surface} = L;
  return Kayak.layout(A, R, (x, s) => surface.heightBase(x, s));
}

// ---------- Helpers ----------
const segDist = (x, s, ax, as, bx, bs) => {const dx = bx - ax, ds = bs - as, u = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));return [Math.hypot(x - ax - u * dx, s - as - u * ds), u];};
const inRing = (x, s, r) => {let q = false;for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[i], b = r[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) q = !q;}return q;};

// ---------- OSM: the ways near the river (downloaded once, kept trimmed) ----------
async function osm() {
  if (fs.existsSync(OSM_FILE)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(OSM_FILE)));
  global.window = globalThis;require(path.join(ROOT, 'surroundings-data.js'));require(path.join(ROOT, 'akerselva-data.js'));
  const {lat: LAT0, lon: LON0} = window.SURROUNDINGS.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), latlon = (x, s) => [LAT0 - s / 111320, LON0 + x / KX];
  const [la0, lo0] = latlon(-1440, 2740), [la1, lo1] = latlon(-380, -880);
  const q = `[out:json][timeout:170][bbox:${la0.toFixed(5)},${lo0.toFixed(5)},${la1.toFixed(5)},${lo1.toFixed(5)}];way[highway];out body geom;`;
  let r = null;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    r = await fetch(u, {method: 'POST', body: 'data=' + encodeURIComponent(q), headers: {'User-Agent': 'map-build-tool/1.0', 'Content-Type': 'application/x-www-form-urlencoded'}}).catch(() => null);
    if (r && r.ok) break;
  }
  if (!r || !r.ok) throw new Error('Overpass download failed');
  const j = JSON.parse(await r.text()), RiverPath = require(path.join(ROOT, 'river-path.js')), at = RiverPath.riverAt(window.AKERSELVA);
  // Only the ways within 150 m of the river, and only the tags the route needs.
  const KEEP = ['highway', 'name', 'surface', 'bicycle', 'foot', 'footway', 'bridge', 'tunnel', 'layer', 'access', 'area', 'segregated', 'width', 'lit', 'covered'];
  const near = g => {const p = [(g.lon - LON0) * KX, -(g.lat - LAT0) * 111320];for (let d = 0; d <= 150; d += 30) for (const [a, b] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {const v = at(p[0] + a, p[1] + b);if (v && v.d < 150) return true;}return false;};
  const elements = j.elements.filter(e => e.type === 'way' && e.geometry && e.geometry.some(near))
    .map(e => ({type: 'way', id: e.id, nodes: e.nodes, geometry: e.geometry.map(g => ({lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7)})), tags: Object.fromEntries(Object.entries(e.tags || {}).filter(([k]) => KEEP.includes(k)))}));
  fs.writeFileSync(OSM_FILE, zlib.gzipSync(JSON.stringify({note: 'Highway ways within 150 m of Akerselva (Overpass API, trimmed by tools/make-river-path.cjs). (c) OpenStreetMap contributors, ODbL 1.0.', elements})));
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(OSM_FILE)));
}

// ---------- The route ----------
const CAR = new Set(['residential', 'living_street', 'unclassified', 'service', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link']);
const PATHK = new Set(['cycleway', 'footway', 'path', 'pedestrian', 'track', 'bridleway']);
function costFactor(t) {
  const k = t.highway, bike = /^(yes|designated|permissive)$/.test(t.bicycle || '');
  let f = k === 'cycleway' ? 1 : (k === 'footway' || k === 'path' || k === 'pedestrian') ? (bike ? 1.05 : 1.25) : k === 'track' || k === 'bridleway' ? 1.3 : k === 'service' || k === 'living_street' ? 2 : 2.6;
  if (t.footway === 'sidewalk') f = Math.max(f, 1.7);
  if (t.footway === 'crossing') f = 1.2;
  if (/^(ground|grass|dirt|earth|mud|sand|unpaved|wood|metal|woodchips)$/.test(t.surface || '')) f *= 1.4;
  if (t.bicycle === 'no') f *= 1.6;
  return f;
}
function usable(t) {
  const k = t.highway;if (!(PATHK.has(k) || CAR.has(k))) return false;// (steps are never part of the route: no bike takes them)
  if (t.tunnel && t.tunnel !== 'no') return false;if (t.area === 'yes') return false;if (t.covered === 'yes' && k !== 'cycleway') return false;
  if (/^(private|no)$/.test(t.access || '') && !/^(yes|designated)$/.test(t.bicycle || t.foot || '')) return false;
  return true;
}
const GRAVEL = /^(gravel|fine_gravel|compacted|ground|dirt|earth|unpaved|grass|pebblestone|woodchips|sand)$/;
const surfOf = t => t.surface ? (GRAVEL.test(t.surface) ? 1 : 2) : (t.highway === 'cycleway' || CAR.has(t.highway) ? 2 : 1);

async function build({log = console.log, bad = new Set(), depth = 0} = {}) {
  const j = await osm();
  const L = load({withPath: false}), {A, surface, RiverPath, D} = L, river = RiverPath.riverAt(A), DK = decks(L);
  // ... and the road bridges' decks (road-surface.js, issue #139), one straight piece per segment: the route passes under them
  // with the same room, or goes on them as a street.
  const RD = surface.decks.flatMap(d => {const out = [];for (let k = 0; k + 1 < d.p.length / 2; k++) {
    const ax = d.p[k * 2], as = d.p[k * 2 + 1], dx = d.p[k * 2 + 2] - ax, ds = d.p[k * 2 + 3] - as, len = Math.hypot(dx, ds);if (len < .2) continue;
    out.push({t: `road ${d.id}.${k}`, road: true, ax, as, ux: dx / len, us: ds / len, len, w: 2 * (d.W + surface.PARAPET), thick: surface.DECK, deckAt: p => surface.deckTop(d, d.cum[k] + Math.max(0, Math.min(len, p)), 0), ends: [k === 0, k + 2 === d.p.length / 2]});
  }return out;});
  const DKR = [...DK, ...RD];
  const {lat: LAT0, lon: LON0} = window.SURROUNDINGS.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), local = g => [(g.lon - LON0) * KX, -(g.lat - LAT0) * 111320];
  // Inside the walkable world (surroundings.js walkRects), 3 m in from its edge.
  require(path.join(ROOT, 'surroundings.js'));
  const rects = window.Surroundings.walkRects(800, 760, L.districts), inR = (x, s) => rects.some(r => x >= r.x0 && x <= r.x1 && s >= r.s0 && s <= r.s1);
  const inWorld = (x, s) => inR(x - 3, s) && inR(x + 3, s) && inR(x, s - 3) && inR(x, s + 3);
  // Which of Akerselva's decks hold (x, s), and where along / across them.
  const deckHits = (x, s, list = DKR) => {const out = [];for (const d of list) {const p = (x - d.ax) * d.ux + (s - d.as) * d.us, q = (x - d.ax) * -d.us + (s - d.as) * d.ux;if (p >= -.5 && p <= d.len + .5 && Math.abs(q) <= d.w / 2 + .5) out.push({d, p, q});}return out;};
  // (under a deck: the highest the band may be for HEADROOM, and whether that is possible there)
  const capAt = (h, x, s) => h.d.deckAt(h.p) - h.d.thick - HEADROOM - .05;
  const floorAt = (x, s) => {const r = river(x, s);return r && r.d < r.half + 30 ? r.level + .5 : -Infinity;};
  const underOk = (h, x, s) => {const cap = capAt(h, x, s);return (h.p >= 3.5 || !endOk(h, 0)) && (h.p <= h.d.len - 3.5 || !endOk(h, 1)) && cap >= floorAt(x, s) + .05 && surface.natural(x, s) - cap <= 3;};
  // A point inside a deck's outline is on the deck when its way is the bridge itself (it crosses the river), or where the deck
  // has come down to the ground at its end and the way goes along it; else it passes under the deck (and needs the room).
  // (or it crosses the deck's end where the deck has come down to the ground: the route is moved just past the end there)
  // (a road deck's pieces: only the first and the last have ends; a way on a road bridge is one tagged as a bridge going along it)
  const endOk = (h, e) => !h.d.road || h.d.ends[e];
  // (not a road deck's end: the ground there is held under the deck, issue #139)
  const atEnd = (h, x, s) => !h.d.road && ((h.p < 2 && endOk(h, 0)) || (h.p > h.d.len - 2 && endOk(h, 1))) && h.d.deckAt(h.p) - surface.heightBase(x, s) < 1;
  const isBridge = way => {const w = ways.get(way);return !!(w && w.tags.bridge && w.tags.bridge !== 'no');};
  const onIt = (h, x, s, fx, fs, way) => (h.d.road ? isBridge(way) && Math.abs(fx * h.d.ux + fs * h.d.us) > .8 : crossesRiver.has(way)) || (h.d.deckAt(h.p) - surface.heightBase(x, s) < .6 && Math.abs(fx * h.d.ux + fs * h.d.us) > .8 && Math.abs(h.q) < h.d.w / 2 - .5);
  // Buildings (the old square's and the patches'), for the bank lines, lamps and benches.
  const buildings = [...D.buildings.map(b => {const r = [];for (let i = 0; i < b.r.o.length; i += 2) r.push([b.r.o[i], b.r.o[i + 1]]);return r;}), ...L.districts.flatMap(d => d.buildings.map(b => b.ring))]
    .map(r => ({r, x0: Math.min(...r.map(p => p[0])), x1: Math.max(...r.map(p => p[0])), s0: Math.min(...r.map(p => p[1])), s1: Math.max(...r.map(p => p[1]))}));
  const inBuilding = (x, s, m) => buildings.some(b => x > b.x0 - m && x < b.x1 + m && s > b.s0 - m && s < b.s1 + m && (inRing(x, s, b.r) || b.r.some((p, i) => segDist(x, s, ...p, ...b.r[(i + 1) % b.r.length])[0] < m)));
  // Ways that cross the river (bridges): their points may be over the water.
  // (crossesRiver: the route's own ways over the river, one along each of Akerselva's decks; overRiver: OSM's bridge ways over it)
  const node = new Map(), edges = new Map(), ways = new Map(), crossesRiver = new Set(), overRiver = new Set();
  const addEdge = (a, b, e) => {if (!edges.has(a)) edges.set(a, []);edges.get(a).push({to: b, ...e});};
  let blocked = 0;
  // One straight piece a -> b of a way: inside the world, not in the water (unless it is a bridge over the river), and where it
  // passes under one of Akerselva's bridges there must be room (else the piece is not taken).
  function pieceOk(a, b, way, len, fx, fs, solidFree = false) {
    if (!inWorld(...a) || !inWorld(...b)) return false;
    for (let u = 0; u <= len; u += 1) {
      const x = a[0] + fx * u, s = a[1] + fs * u;
      for (const h of deckHits(x, s)) if (!onIt(h, x, s, fx, fs, way) && (bad.has(h.d.t) || (!atEnd(h, x, s) && !underOk(h, x, s)))) return false;
      if (!crossesRiver.has(way)) {const r = river(x, s);if (r && r.d < r.half - 1) return false;}
      if (solidFree && inBuilding(x, s, HW + .5)) return false;
    }
    return true;
  }
  const costOf = (a, b, len, f) => {const m = river((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), d = m ? m.d - m.half : 999, far = d > 80 ? 6 : d > 45 ? 1.8 : d > 25 ? 1.15 : 1;return len * f * far + (f >= 1.7 ? 2 : 0);};
  const usableWays = j.elements.filter(w => usable(w.tags));
  for (const w of usableWays) {
    ways.set(w.id, w);const pts = w.pts = w.geometry.map(local);
    if (w.tags.bridge && w.tags.bridge !== 'no') {const sides = new Set();for (const p of pts) {const r = river(...p);if (r && r.d < r.half + 25) sides.add(Math.sign(r.side));}if (sides.size > 1) overRiver.add(w.id);}
    for (let i = 0; i < w.nodes.length; i++) if (!node.has(w.nodes[i])) node.set(w.nodes[i], pts[i]);
  }
  // A node in the middle of a deck, well above the ground, joins only the bridge's own ways (OSM ways that meet a bridge's way
  // there at another level, under it, are not a way onto it).
  const midDeck = id => {const [x, s] = node.get(id);return deckHits(x, s).find(h => !atEnd(h, x, s) && h.d.deckAt(h.p) - surface.heightBase(x, s) > 1) || null;};
  const bridgeOf = (h, way) => h.d.road ? isBridge(way) : crossesRiver.has(way);
  for (const w of usableWays) {
    // (OSM's bridges over Akerselva are replaced by the game's decks, below: the real bridge may curve where the deck is straight)
    if (overRiver.has(w.id)) continue;
    const f = costFactor(w.tags), pts = w.pts;
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);if (len < 1e-3) continue;
      if ([w.nodes[i], w.nodes[i + 1]].some(id => {const h = midDeck(id);return h && !bridgeOf(h, w.id);})) {blocked++;continue;}
      if (!pieceOk(a, b, w.id, len, (b[0] - a[0]) / len, (b[1] - a[1]) / len)) {blocked++;continue;}
      const cost = costOf(a, b, len, f);addEdge(w.nodes[i], w.nodes[i + 1], {cost, way: w.id});addEdge(w.nodes[i + 1], w.nodes[i], {cost, way: w.id});
    }
  }
  // Akerselva's bridges as the game lays them out: a way along each deck's centre line from one end to the other, joined at
  // each end to the ways within 15 m that are at the ground there.
  {
    const nodeCells = new Map(), cellKey = (x, s) => Math.floor(x / 16) * 100000 + Math.floor(s / 16);
    for (const [id, p] of node) {if (!edges.has(id)) continue;const k = cellKey(...p);if (!nodeCells.has(k)) nodeCells.set(k, []);nodeCells.get(k).push(id);}
    ways.set('link', {id: 'link', tags: {highway: 'path', surface: 'asphalt'}});
    DK.forEach((d, i) => {
      const id = `deck ${d.t}`;ways.set(id, {id, tags: {highway: 'footway', bridge: 'yes', surface: 'asphalt', name: d.b.name || ''}});crossesRiver.add(id);
      // (3 m past each end, so a corner there is rounded off the deck; not a deck that ends in a building)
      const ends = [-3, d.len + 3].map(p => [d.ax + d.ux * p, d.as + d.us * p]), ids = [`${id} A`, `${id} B`];
      if (!ends.every(e => inWorld(...e))) return;
      for (let p = -3; p <= d.len + 3; p += 1) if (inBuilding(d.ax + d.ux * p, d.as + d.us * p, HW)) return;
      // (nor one that ends against a slope instead of on the ground, or is steeper than a bike climbs)
      for (const [p, y] of [[-3, d.prof[0][1]], [d.len + 3, d.prof[3][1]]]) if (Math.abs(surface.heightBase(d.ax + d.ux * p, d.as + d.us * p) - y) > 2) return;
      for (let i = 0; i < 3; i++) {const [p0, y0] = d.prof[i], [p1, y1] = d.prof[i + 1];if (p1 - p0 > .5 && Math.abs(y1 - y0) / (p1 - p0) > .12) return;}
      ends.forEach((e, k) => node.set(ids[k], e));
      const cost = costOf(ends[0], ends[1], d.len + 1.2, 1);addEdge(ids[0], ids[1], {cost, way: id});addEdge(ids[1], ids[0], {cost, way: id});
      ends.forEach((e, k) => {
        const y = surface.heightBase(...e);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of nodeCells.get(cellKey(...e) + a * 100000 + b) || []) {
          const q = node.get(o), len = Math.hypot(q[0] - e[0], q[1] - e[1]);if (len > 15 || midDeck(o) || Math.abs(surface.heightBase(...q) - y) > Math.max(1, len * .12)) continue;
          if (len > .05 && !pieceOk(e, q, 'link', len, (q[0] - e[0]) / len, (q[1] - e[1]) / len)) continue;
          const c = costOf(e, q, Math.max(.05, len), 1.5);addEdge(ids[k], o, {cost: c, way: 'link'});addEdge(o, ids[k], {cost: c, way: 'link'});
        }
      });
    });
  }
  // Where no real way runs along the river (or only one outside the game's world), a line along each bank, 6 m from the water,
  // clear of buildings, joined to the real ways it passes within 12 m of. It costs three times a cycleway, so the route takes it
  // only where the real ways would take it far from the river.
  const BANK = 'bank';ways.set(BANK, {id: BANK, tags: {highway: 'path', surface: 'gravel'}});
  {
    const nodeCells = new Map(), cellKey = (x, s) => Math.floor(x / 16) * 100000 + Math.floor(s / 16);
    for (const [id, p] of node) {if (!edges.has(id)) continue;const k = cellKey(...p);if (!nodeCells.has(k)) nodeCells.set(k, []);nodeCells.get(k).push(id);}
    let next = -10;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let t = 0; t <= A.length; t += 5) {
        const c = L.R.at(t), half = side < 0 ? c.wl : c.wr, x = c.x - c.ds * side * (half + 6), s = c.s + c.dx * side * (half + 6), r = river(x, s);
        if (!inWorld(x, s) || !r || r.d < r.half + 4 || inBuilding(x, s, HW + .5)) {prev = null;continue;}
        const id = next--;node.set(id, [x, s]);
        if (prev !== null) {const a = node.get(prev), len = Math.hypot(x - a[0], s - a[1]);if (pieceOk(a, [x, s], BANK, len, (x - a[0]) / len, (s - a[1]) / len, true)) {const cost = costOf(a, [x, s], len, 3);addEdge(prev, id, {cost, way: BANK});addEdge(id, prev, {cost, way: BANK});}}
        prev = id;
        for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) for (const o of nodeCells.get(cellKey(x, s) + i * 100000 + k) || []) {
          const q = node.get(o), len = Math.hypot(q[0] - x, q[1] - s);if (len > 12 || len < .5 || midDeck(o)) continue;
          if (!pieceOk([x, s], q, BANK, len, (q[0] - x) / len, (q[1] - s) / len, true)) continue;
          const cost = costOf([x, s], q, len, 3);addEdge(id, o, {cost, way: BANK});addEdge(o, id, {cost, way: BANK});
        }
      }
    }
  }
  // Start: near the top of the game's river (inside the walkable world, s > -755); end: by Vaterland's culvert.
  const starts = [], ends = new Set();
  for (const [id, p] of node) {const r = river(p[0], p[1]);if (!r || r.d - r.half > 40) continue;if (r.t < 40 && p[1] > -755) starts.push(id);if (r.t > A.length - 250) ends.add(id);}
  const dist = new Map(), prev = new Map(), heap = [];
  const push = (c, id) => {heap.push([c, id]);let i = heap.length - 1;while (i) {const p = (i - 1) >> 1;if (heap[p][0] <= heap[i][0]) break;[heap[p], heap[i]] = [heap[i], heap[p]];i = p;}};
  const pop = () => {const top = heap[0], last = heap.pop();if (heap.length) {heap[0] = last;let i = 0;for (;;) {const l = i * 2 + 1, r = l + 1;let m = i;if (l < heap.length && heap[l][0] < heap[m][0]) m = l;if (r < heap.length && heap[r][0] < heap[m][0]) m = r;if (m === i) break;[heap[m], heap[i]] = [heap[i], heap[m]];i = m;}}return top;};
  for (const id of starts) {const r = river(...node.get(id)), c = r.t * 3;dist.set(id, c);push(c, id);}
  let goal = null, best = Infinity;
  // (the whole graph: of the ends, the one furthest down the river for its cost)
  while (heap.length) {
    const [c, id] = pop();if (c > dist.get(id)) continue;
    if (ends.has(id)) {const v = c - 3 * river(...node.get(id)).t;if (v < best) {best = v;goal = id;}}
    for (const e of edges.get(id) || []) {const nc = c + e.cost;if (nc < (dist.get(e.to) ?? Infinity)) {dist.set(e.to, nc);prev.set(e.to, {from: id, way: e.way});push(nc, e.to);}}
  }
  if (!goal) {let far = 0, at = null;for (const id of dist.keys()) {const r = river(...node.get(id));if (r && r.d - r.half < 60 && r.t > far) {far = r.t;at = node.get(id);}}throw new Error(`no route along the river: it gets ${far.toFixed(0)} m down the river, to (${at && at.map(v => v.toFixed(0))}), from ${starts.length} starts`);}
  const ids = [goal], via = [];for (let id = goal; prev.has(id);) {const p = prev.get(id);via.unshift(p.way);id = p.from;ids.unshift(id);}

  // ---------- The centre line: off the water's edge, corners rounded, 1 m samples ----------
  let P = ids.map(id => node.get(id).slice()), segWay = via.slice();// segWay[i]: the way from P[i] to P[i + 1]
  const onBridge = i => crossesRiver.has(segWay[Math.min(segWay.length - 1, i)]) || (i > 0 && crossesRiver.has(segWay[i - 1]));
  // Rounded corners: each corner turning more than 8 degrees becomes an arc of up to 3 m (a quadratic curve, 6 points).
  const R2 = [P[0]], W2 = [];
  for (let i = 1; i + 1 < P.length; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1], l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u1 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], u2 = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2], turn = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (turn < .14 || l1 < .3 || l2 < .3) {R2.push(b);W2.push(segWay[i - 1]);continue;}
    const r = Math.min(3, l1 * .45, l2 * .45), p0 = [b[0] - u1[0] * r, b[1] - u1[1] * r], p2 = [b[0] + u2[0] * r, b[1] + u2[1] * r];
    R2.push(p0);W2.push(segWay[i - 1]);
    for (let k = 1; k < 6; k++) {const t = k / 6, m0 = (1 - t) * (1 - t), m1 = 2 * t * (1 - t), m2 = t * t;R2.push([m0 * p0[0] + m1 * b[0] + m2 * p2[0], m0 * p0[1] + m1 * b[1] + m2 * p2[1]]);W2.push(k < 3 ? segWay[i - 1] : segWay[i]);}
    R2.push(p2);W2.push(segWay[i]);
  }
  R2.push(P[P.length - 1]);W2.push(segWay[segWay.length - 1]);
  // 1 m samples, each with its way and direction.
  const S = [];let acc = 0;// (a: metres along the route)
  for (let i = 0; i + 1 < R2.length; i++) {
    const a = R2[i], b = R2[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len));for (let k = 0; k < n; k++) S.push({x: a[0] + (b[0] - a[0]) * k / n, s: a[1] + (b[1] - a[1]) * k / n, fx: (b[0] - a[0]) / len, fs: (b[1] - a[1]) / len, way: W2[i], a: acc + len * k / n});
    acc += len;
  }
  {const b = R2[R2.length - 1], q = S[S.length - 1];S.push({x: b[0], s: b[1], fx: q.fx, fs: q.fs, way: q.way, a: acc});}
  const span = r => S[r.i1].a - S[r.i0].a;
  // Moves of single samples spread to their neighbours (cosine ease over `reach` metres; the biggest move wins).
  const spread = (push, reach) => {
    const moved = S.map(() => [0, 0]);
    for (let i = 0; i < S.length; i++) {
      let best = [0, 0], bm = 0;
      for (let j = i; j >= 0 && S[i].a - S[j].a < reach; j--) if (push[j]) {const f = .5 + .5 * Math.cos(Math.PI * (S[i].a - S[j].a) / reach), m = Math.hypot(...push[j]) * f;if (m > bm) {bm = m;best = [push[j][0] * f, push[j][1] * f];}}
      for (let j = i + 1; j < S.length && S[j].a - S[i].a < reach; j++) if (push[j]) {const f = .5 + .5 * Math.cos(Math.PI * (S[j].a - S[i].a) / reach), m = Math.hypot(...push[j]) * f;if (m > bm) {bm = m;best = [push[j][0] * f, push[j][1] * f];}}
      moved[i] = best;
    }
    S.forEach((q, i) => {q.x += moved[i][0];q.s += moved[i][1];});
  };
  // Off the water's edge: the centre line at least 2.5 m from it, so the band's edge is 1 m from it (not on the bridges).
  for (let pass = 0; pass < 2; pass++) spread(S.map(q => {
    if (crossesRiver.has(q.way)) return null;
    const r = river(q.x, q.s);if (!r || r.d >= r.half + WATER) return null;
    const k = A.pts, i = Math.min(k.length / 2 - 2, Math.floor(r.t / A.step)), tx = k[i * 2 + 2] - k[i * 2], ts = k[i * 2 + 3] - k[i * 2 + 1], l = Math.hypot(tx, ts) || 1, sg = Math.sign(r.side) || 1, need = r.half + WATER + .05 - Math.abs(r.side);
    return [-ts / l * sg * need, tx / l * sg * need];
  }), 10);

  // Past the end of a deck it crosses at the ground (the railings reach the end line), easing over 6 m either side.
  spread(S.map(q => {
    for (const h of deckHits(q.x, q.s)) if (!onIt(h, q.x, q.s, q.fx, q.fs, q.way) && atEnd(h, q.x, q.s)) {const want = h.p < h.d.len / 2 ? -1.1 : h.d.len + 1.1;return [(want - h.p) * h.d.ux, (want - h.p) * h.d.us];}
    return null;
  }), 6);
  // ---------- What each sample is on ----------
  const nearList = [];
  for (const q of S) {
    const w = ways.get(q.way), hits = deckHits(q.x, q.s);
    q.kind = BAND;q.cap = Infinity;
    for (const h of hits) {
      if (onIt(h, q.x, q.s, q.fx, q.fs, q.way)) {q.kind = h.d.road ? STREET : BRIDGE;q.deck = h.d.road ? null : h.d;break;}
      q.cap = Math.min(q.cap, capAt(h, q.x, q.s));q.under = h.d;
    }
    if (q.kind === BRIDGE) continue;
    // along a car street (on its carriageway or pavement, or so close that a band would touch it), or on a road bridge's deck: on
    // the street, no band of its own
    for (const o of surface.near(q.x, q.s, nearList)) {
      const c = surface.chains[o.c];if (c.path || Math.abs(o.y) > c.hw + c.sw + HW + .5 || o.t < -1 || o.t > c.L + 1) continue;
      const k = Math.min(c.p.length / 2 - 2, Math.max(0, c.cum.findIndex(v => v > o.t) - 1)), dx = c.p[k * 2 + 2] - c.p[k * 2], ds = c.p[k * 2 + 3] - c.p[k * 2 + 1], l = Math.hypot(dx, ds) || 1;
      if (Math.abs(q.fx * dx / l + q.fs * ds / l) > .7) {q.kind = STREET;break;}
    }
    if (q.kind === BAND && (w.tags.bridge && w.tags.bridge !== 'no') && surface.decksAt(q.x, q.s).length) q.kind = STREET;
  }
  // Short stretches merge into their neighbours: a street under 8 m is crossed by the band, a band under 6 m between two
  // other stretches is left to them.
  const runsOf = () => {const r = [];for (let i = 0; i < S.length; i++) if (!r.length || r[r.length - 1].kind !== S[i].kind) r.push({kind: S[i].kind, i0: i, i1: i});else r[r.length - 1].i1 = i;return r;};
  for (const r of runsOf()) if (r.kind === STREET && span(r) < 8) for (let i = r.i0; i <= r.i1; i++) S[i].kind = BAND;
  for (const r of runsOf()) if (r.kind === BAND && span(r) < 6 && r.i0 > 0 && r.i1 < S.length - 1) {const k = S[r.i0 - 1].kind === BRIDGE ? S[r.i1 + 1].kind : S[r.i0 - 1].kind;for (let i = r.i0; i <= r.i1; i++) S[i].kind = k;}
  // On a deck the line keeps 0.5 m inside its railings (the OSM line of a sidewalk bridge can lie on the game deck's edge),
  // easing over 8 m before and after.
  spread(S.map(q => {
    if (q.kind !== BRIDGE || !q.deck) return null;
    const d = q.deck, vx = -d.us, vs = d.ux, off = (q.x - d.ax) * vx + (q.s - d.as) * vs, lim = Math.max(0, d.w / 2 - .5), want = Math.max(-lim, Math.min(lim, off));
    return want === off ? null : [(want - off) * vx, (want - off) * vs];
  }), 8);
  // (and off the water's edge again, after those moves)
  spread(S.map(q => {
    if (q.kind === BRIDGE) return null;
    const r = river(q.x, q.s);if (!r || r.d >= r.half + WATER) return null;
    const k = A.pts, i = Math.min(k.length / 2 - 2, Math.floor(r.t / A.step)), tx = k[i * 2 + 2] - k[i * 2], ts = k[i * 2 + 3] - k[i * 2 + 1], l = Math.hypot(tx, ts) || 1, sg = Math.sign(r.side) || 1, need = r.half + WATER + .05 - Math.abs(r.side);
    return [-ts / l * sg * need, tx / l * sg * need];
  }), 6);
  // ---------- Output: vertices (the samples, thinned where straight), runs, caps ----------
  const runs = runsOf(), keep = new Uint8Array(S.length);keep[0] = keep[S.length - 1] = 1;
  for (const r of runs) {keep[r.i0] = 1;keep[r.i1] = 1;}
  for (let i = 1; i + 1 < S.length; i++) {const a = S[i - 1], b = S[i + 1];if (Math.abs(a.fx * b.fs - a.fs * b.fx) > .004 || a.way !== b.way) keep[i] = 1;}
  // (at most 12 m between kept points, so the band follows the line)
  for (let i = 0, last = 0; i < S.length; i++) {if (keep[i]) last = i;else if (S[i].a - S[last].a >= 11) {keep[i] = 1;last = i;}}
  const vIdx = new Int32Array(S.length).fill(-1), pts = [];for (let i = 0; i < S.length; i++) if (keep[i]) {vIdx[i] = pts.length / 2;pts.push(+S[i].x.toFixed(2), +S[i].s.toFixed(2));}
  const cumV = [0];for (let k = 1; k < pts.length / 2; k++) cumV.push(cumV[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]));
  const outRuns = [];
  for (const r of runs) {
    let i0 = vIdx[r.i0], i1 = vIdx[r.i1];
    // (a band reaches one sample on into the stretch after it, so the stretches meet; it is hidden under a deck's end)
    if (r.kind === BAND && r.i1 + 1 < S.length) i1 = vIdx[r.i1 + 1] >= 0 ? vIdx[r.i1 + 1] : i1;
    if (r.kind === BAND && r.i0 > 0 && vIdx[r.i0 - 1] >= 0) i0 = vIdx[r.i0 - 1];
    // the surface: by length, from the OSM ways along it
    const tally = [0, 0, 0];for (let i = r.i0; i <= r.i1; i++) tally[surfOf(ways.get(S[i].way).tags)]++;
    // (a band that meets one of Akerselva's decks ends at the deck's end height: [5], [6] = its height at its start, at its end)
    const deckEnd = i => {const q = S[i];if (!q || q.kind !== BRIDGE || !q.deck) return null;const d = q.deck, p = (q.x - d.ax) * d.ux + (q.s - d.as) * d.us;return +(p < d.len / 2 ? d.prof[0][1] : d.prof[3][1]).toFixed(2);};
    const run = [i0, i1, r.kind, tally[1] > tally[2] ? 1 : 2];
    if (r.kind === BAND) {const a = deckEnd(r.i0 - 1), b = deckEnd(r.i1 + 1);if (a !== null || b !== null) run.push(a, b);}
    outRuns.push(run);
  }
  // (no gap between two stretches: one that ends a point before the next starts reaches on to it)
  for (let r = 1; r < outRuns.length; r++) if (outRuns[r][0] > outRuns[r - 1][1]) outRuns[r - 1][1] = outRuns[r][0];
  // Caps under Akerselva's bridges: [a0, a1, cap] along the route (the samples' arc length is their index, 1 m apart, close
  // enough to the thinned line's: both follow the same points).
  const arcOf = i => {let k = i;while (vIdx[k] < 0) k--;return cumV[vIdx[k]] + Math.hypot(S[i].x - pts[vIdx[k] * 2], S[i].s - pts[vIdx[k] * 2 + 1]);};
  // (the decks are laid out on the ground without the path, in the game too: RoadSurface.heightBase)
  const underList = list => {
    const out = [];
    for (let i = 0; i < S.length; i++) {
      if (S[i].kind !== BAND) continue;
      const hit = deckHits(S[i].x, S[i].s, list).find(h => !onIt(h, S[i].x, S[i].s, S[i].fx, S[i].fs, S[i].way));if (!hit) continue;
      const d = hit.d;let e = i, cap = capAt(hit);
      while (e + 1 < S.length && S[e + 1].kind === BAND) {const h = deckHits(S[e + 1].x, S[e + 1].s, list).find(q => q.d === d);if (!h) break;e++;cap = Math.min(cap, capAt(h));}
      out.push([+(arcOf(i) - 1.5).toFixed(1), +(arcOf(e) + 1.5).toFixed(1), +cap.toFixed(2), d.t]);i = e;
    }
    return out;
  };
  const under = underList(DK);
  // An underpass the route reaches from a car street it crosses close by (the band takes the street's level where it crosses)
  // with more than a 7 % ramp between them cannot be built: route again without passing under that bridge.
  {
    const clash = new Set(), nl = [];
    for (const [u0, u1, cap, t] of under) for (const q of S) {
      const gap = Math.max(u0 - q.a, q.a - u1);if (gap < 0 || gap > 60 || q.kind !== BAND || deckHits(q.x, q.s).length) continue;
      for (const o of surface.near(q.x, q.s, nl)) {const c = surface.chains[o.c];if (c.path || Math.abs(o.y) > c.hw || o.t < 0 || o.t > c.L) continue;if (surface.height(q.x, q.s) - cap > .07 * gap + .3) clash.add(t);}
    }
    if (clash.size && depth < 12) {log(`  underpasses that clash with a street: ${[...clash].join(', ')}; routing again`);return build({log, bad: new Set([...bad, ...clash]), depth: depth + 1});}
  }
  // ---------- Lamps and benches beside the band ----------
  const freeSpot = (x, s, m) => {
    if (inBuilding(x, s, m)) return false;
    const r = river(x, s);if (r && r.d < r.half + 1.5) return false;
    if (deckHits(x, s).length) return false;
    for (const o of surface.near(x, s, nearList)) {const c = surface.chains[o.c];if (Math.abs(o.y) < c.hw + c.sw + m + .3 && o.t > -c.hw - 2 && o.t < c.L + c.hw + 2) return false;}
    // (not on the route itself where it folds back near here)
    for (let i = 0; i < S.length; i += 2) if (Math.abs(S[i].x - x) < 4 && Math.abs(S[i].s - s) < 4 && Math.hypot(S[i].x - x, S[i].s - s) < HW + m + .2) return false;
    return true;
  };
  const lamps = [], benches = [];
  let nextLamp = 15, nextBench = 60;
  for (let i = 0; i < S.length; i++) {
    const q = S[i];if (q.kind !== BAND || Number.isFinite(q.cap)) continue;
    const r = river(q.x, q.s);
    // the right of the direction of travel is (-fs, fx); which side is away from the water?
    const nx = -q.fs, ns = q.fx;
    const sideAway = (() => {if (!r) return 1;const p = river(q.x + nx * 2, q.s + ns * 2);return p && Math.abs(p.side) > Math.abs(r.side) ? 1 : -1;})();
    if (q.a >= nextLamp) {
      for (const sg of [sideAway, -sideAway]) {const x = q.x + nx * sg * (HW + .7), s = q.s + ns * sg * (HW + .7);if (freeSpot(x, s, .3)) {lamps.push(+x.toFixed(2), +s.toFixed(2));nextLamp = q.a + 30;break;}}
      if (nextLamp <= q.a) nextLamp = q.a + 4;
    }
    if (q.a >= nextBench) {
      for (const sg of [-sideAway, sideAway]) {
        const off = HW + 1.1, x = q.x + nx * sg * off, s = q.s + ns * sg * off;
        if (!freeSpot(x, s, 1.1)) continue;
        // facing the path (heading: the direction it faces, h -> (sin h, cos h) in x, s)
        benches.push(+x.toFixed(2), +s.toFixed(2), +Math.atan2(-nx * sg, -ns * sg).toFixed(3));nextBench = q.a + 150;break;
      }
      if (nextBench <= q.a) nextBench = q.a + 10;
    }
  }
  // ---------- Which real ways, where ----------
  const wayRuns = [];for (let i = 0; i < S.length; i++) {const w = S[i].way;if (!wayRuns.length || wayRuns[wayRuns.length - 1][0] !== w) wayRuns.push([w, i, i]);else wayRuns[wayRuns.length - 1][2] = i;}
  const wayList = wayRuns.map(([w, i0, i1]) => {const t = ways.get(w).tags;return [w, t.highway + (t.footway ? '=' + t.footway : ''), t.name || '', Math.round(S[i0].a), Math.round(S[i1].a), t.surface || ''];});
  const data = {attribution: 'Akerselva – turvei: OpenStreetMap ways (ODbL), chosen by tools/make-river-path.cjs; heights: Kartverket DTM (CC BY 4.0)', name: NAME, w: W, length: Math.round(cumV[cumV.length - 1]),
    pts, runs: outRuns, under, lamps, benches, ways: wayList};
  const js = `/* Generated by tools/make-river-path.cjs: Akerselva – turvei, a path along the river for walking and cycling (issue #147). Map data (c) OpenStreetMap contributors (ODbL); height data (c) Kartverket (CC BY 4.0). */\nwindow.RIVER_PATH=${JSON.stringify(data)};\nif (typeof module !== 'undefined' && module.exports) module.exports = window.RIVER_PATH;\n`;
  fs.writeFileSync(OUT, js);
  const len = k => outRuns.filter(r => r[2] === k).reduce((a, r) => a + cumV[r[1]] - cumV[r[0]], 0);
  log(`route ${data.length} m from river t ${river(S[0].x, S[0].s).t.toFixed(0)} to ${river(S[S.length - 1].x, S[S.length - 1].s).t.toFixed(0)}; band ${len(BAND).toFixed(0)} m, street ${len(STREET).toFixed(0)} m, bridge ${len(BRIDGE).toFixed(0)} m; ${under.length} underpasses; ${lamps.length / 2} lamps, ${benches.length / 3} benches; ${blocked} OSM segments left out; ${(js.length / 1024).toFixed(0)} KB`);
  return {data, S, ways, wayRuns};
}

module.exports = {load, decks, build, W, HW, HEADROOM, NAME, BAND, STREET, BRIDGE};
if (require.main === module) build().then(r => {
  for (const [w, k, n, i0, i1, sf] of r.data.ways) if (i1 - i0 >= 15) console.log(`  ${String(i0).padStart(5)}-${String(i1).padEnd(5)} ${k.padEnd(18)} ${String(w).padEnd(11)} ${n} ${sf}`);
});
