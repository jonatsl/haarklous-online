/* Makes building-looks-data.js (issue #68): what OpenStreetMap says about each building's looks, for the facade textures.
 * Inputs (kept in assets/ so the file can be made again without the network):
 *   assets/osm/torshov-osm.json                       – the old square's OSM extract (all tags and outlines; its buildings are D.buildings)
 *   assets/osm/building-looks-osm-2026-11-03.json.gz  – tags of every building in the game area and the shops / cafés on ground
 *                                                       floors (Overpass; `node tools/make-building-looks.cjs --fetch` gets it again)
 *   surroundings-data.js, gamle-oslo-data.js, myrens-data.js – the game's buildings
 * Run: node tools/make-building-looks.cjs [--fetch]   (then python build.py). Data (c) OpenStreetMap contributors, ODbL 1.0.
 * Output: window.BUILDING_LOOKS = {table: [[kind, roofShape, roofColour, wallColour, material, year, heritage, architect]],
 *   old: one base-36 code pair per D.buildings index ('00' = nothing known), ids: OSM ids of district buildings (base-36 deltas of
 *   the sorted numbers, 'w' ways then 'r' relations), codes: their code pairs, shops: [x, s, …] local metres of ground-floor shops}.
 * Local map coordinates: x east, s south, metres from Haarklous plass (59.936404 N, 10.776657 E).
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const ASSET = path.join(ROOT, 'assets/osm/building-looks-osm-2026-11-03.json.gz');
const AGENT = 'haarklous-online/1.0 (game map build; https://haarklous-online.server-smoke.workers.dev)';
const BBOX = '59.90047,10.74795,59.94359,10.80881';// the old square ±800 m and both district patches
const KEEP = ['building', 'roof:shape', 'roof:colour', 'building:colour', 'building:material', 'roof:material', 'start_date', 'heritage', 'architect'];
const LAT0 = 59.936404, LON0 = 10.776657, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const local = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * 111320];

async function overpass(query) {
  for (let wait = 5; wait < 400; wait *= 2) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {method: 'POST', headers: {'User-Agent': AGENT, 'Content-Type': 'application/x-www-form-urlencoded'}, body: 'data=' + encodeURIComponent(query)});
    const text = await r.text();
    if (r.ok && text.trim().startsWith('{')) return JSON.parse(text).elements;
    console.log(`Overpass busy (${r.status}), retrying in ${wait} s`);await new Promise(res => setTimeout(res, wait * 1000));
  }
  throw new Error('Overpass did not answer');
}
async function fetchAsset() {
  const head = `[out:json][timeout:170][bbox:${BBOX}];`;
  const b = await overpass(head + '(way[building];relation[building];);out tags center;');
  const s = await overpass(head + '(node[shop];node[amenity~"^(cafe|restaurant|fast_food|bar|pub|pharmacy|bank|ice_cream|dentist|doctors|clinic|post_office|bureau_de_change|veterinary)$"];node[craft];);out;');
  const buildings = {};
  for (const e of b) {const t = {};for (const k of KEEP) if (e.tags && e.tags[k] !== undefined) t[k] = e.tags[k];buildings[e.type[0] + e.id] = t;}
  const shops = s.filter(e => e.tags && (e.tags.level === undefined || e.tags.level === '0')).map(e => [+e.lat.toFixed(7), +e.lon.toFixed(7)]);
  fs.writeFileSync(ASSET, zlib.gzipSync(JSON.stringify({source: 'OpenStreetMap contributors (ODbL 1.0), Overpass API ' + new Date().toISOString().slice(0, 10), bbox: BBOX, buildings, shops})));
  console.log(`Wrote ${path.relative(ROOT, ASSET)}: ${Object.keys(buildings).length} buildings, ${shops.length} shops`);
}

function build() {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'surroundings-data.js'));require(path.join(ROOT, 'gamle-oslo-data.js'));require(path.join(ROOT, 'myrens-data.js'));
  const District = require(path.join(ROOT, 'district.js'));
  const D = window.SURROUNDINGS, DISTRICTS = (window.DISTRICTS || []).map(d => District.decode(d));
  const asset = JSON.parse(zlib.gunzipSync(fs.readFileSync(ASSET)).toString('utf-8'));
  const table = [[]], index = new Map([['[]', 0]]);
  const year = v => {const m = /(\d{4})/.exec(v || '');return m ? +m[1] : 0;};
  const codeOf = t => {
    const row = [t.building === 'yes' ? '' : t.building || '', t['roof:shape'] || '', t['roof:colour'] || '', t['building:colour'] || '', t['building:material'] || '', year(t.start_date), t.heritage ? 1 : 0, /Harald Hals/i.test(t.architect || '') ? 'hals' : ''];
    while (row.length && !row[row.length - 1]) row.pop();
    const key = JSON.stringify(row);if (!index.has(key)) {index.set(key, table.length);table.push(row);}return index.get(key);
  };
  const pair = n => {if (n >= 1296) throw new Error('too many looks');return n.toString(36).padStart(2, '0');};
  // Old square: match each game building to the OSM outline that holds its centre (the generator kept the OSM order but dropped some).
  const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/osm/torshov-osm.json'), 'utf-8')).elements.filter(e => e.type === 'way' && e.tags && e.tags.building && e.geometry);
  const rings = osm.map(e => ({ring: e.geometry.map(g => local(g.lat, g.lon)), tags: e.tags}));
  const inside = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
  let oldHits = 0;
  const old = D.buildings.map(b => {
    const o = b.r.o, n = o.length / 2;let cx = 0, cs = 0;for (let i = 0; i < o.length; i += 2) {cx += o[i] / n;cs += o[i + 1] / n;}
    // The centre of an L- or U-shaped block can fall outside it: then use the outline that holds most of its (slightly pulled-in) corners.
    let best = rings.find(r => inside([cx, cs], r.ring));
    if (!best) {let most = 0;for (const r of rings) {let k = 0;for (let i = 0; i < o.length; i += 2) if (inside([o[i] * .96 + cx * .04, o[i + 1] * .96 + cs * .04], r.ring)) k++;if (k > most) {most = k;best = r;}}}
    if (best) oldHits++;
    return pair(best ? codeOf(best.tags) : 0);
  }).join('');
  // District buildings by their OSM id (the default look of their style needs no entry).
  const ways = [], rels = [];
  for (const d of DISTRICTS) for (const b of d.buildings) {
    const t = asset.buildings[b.id];if (!t) continue;const c = codeOf(t);
    if (!c || (b.style === 'brick' && table[c].length === 1 && table[c][0] === 'apartments')) continue;// a plain block of flats is what 'brick' means anyway
    (b.id[0] === 'w' ? ways : rels).push([+b.id.slice(1), c]);
  }
  const deltas = list => {list.sort((a, b) => a[0] - b[0]);let last = 0;return list.filter((e, i) => !i || e[0] !== list[i - 1][0]).map(([id, c]) => {const s = (id - last).toString(36);last = id;return [s, pair(c)];});};
  const w = deltas(ways), r = deltas(rels);
  // Ground-floor shops and cafés (nodes without a level, or level 0) in local metres.
  const shops = asset.shops.flatMap(([lat, lon]) => local(lat, lon).map(v => Math.round(v * 10) / 10));
  const out = {table, old, ids: 'w' + w.map(e => e[0]).join(',') + ';r' + r.map(e => e[0]).join(','), codes: w.map(e => e[1]).join('') + r.map(e => e[1]).join(''), shops};
  const js = `/* Building looks from OpenStreetMap (issue #68), made by tools/make-building-looks.cjs from ${asset.source}. Data (c) OpenStreetMap contributors, ODbL 1.0. */\nwindow.BUILDING_LOOKS = ${JSON.stringify(out)};\n`;
  fs.writeFileSync(path.join(ROOT, 'building-looks-data.js'), js);
  console.log(`Wrote building-looks-data.js (${(js.length / 1024).toFixed(0)} KB): ${table.length} looks, old square ${oldHits}/${D.buildings.length} matched, ${w.length + r.length} district buildings, ${shops.length / 2} shops`);
}
(async () => {if (process.argv.includes('--fetch') || !fs.existsSync(ASSET)) await fetchAsset();build();})();
