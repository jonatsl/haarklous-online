/* Prop hunt arenas (issue #124): node tools/make-prophunt.cjs  ->  prophunt-data.js (window.PROPHUNT, also module.exports).
 *
 * Each arena is a real place with clear bounds (polygons in the local frame: metres east (x) and south (s) of Haarklous
 * plass 17A), a start ring (the lobby, on the map), a spawn point (where the hunters wait while the others hide) and the
 * extra things standing there (benches, bins, bikes, crates ...) that hiders can become. The things are placed by a seeded
 * search that keeps them off buildings, carriageways, footpaths, tree trunks, water and each other, and puts each kind
 * where such things really stand: benches and bins beside the paths facing them, bikes against walls, containers in a
 * row by a wall, logs and picnic tables near the firepit. The real bushes and street lamps of the old square
 * (surroundings-data.js) inside an arena are hideable too; the game finds those itself.
 * Headings: h in radians, the thing's front faces (sin h, cos h) in (x, s).
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.window = globalThis;
const District = require(path.join(ROOT, 'district.js'));
require(path.join(ROOT, 'surroundings-data.js'));require(path.join(ROOT, 'gamle-oslo-data.js'));
const Rules = require(path.join(ROOT, 'game-prophunt.js'));
const D = window.SURROUNDINGS, G = District.decode(window.DISTRICTS.find(d => d.name === 'gamle-oslo'));
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
function mulberry32(a) {return () => {a |= 0;a = a + 0x6D2B79F5 | 0;let t = Math.imul(a ^ a >>> 15, 1 | a);t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;return ((t ^ t >>> 14) >>> 0) / 4294967296;};}
const CAR = ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'living_street', 'trunk', 'tram', 'rail'];
const FOOT = ['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'track', 'bridleway'];
const segDist = (p, a, b) => {const dx = b[0] - a[0], ds = b[1] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / L));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
const inPoly = (p, poly) => {let c = false;for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {const a = poly[i], b = poly[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;}return c;};
const polyDist = (p, poly) => {let d = Infinity;for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length]));return d;};

// ---------- The arenas ----------
// Rathkes gate 1's backyard and the passage to it: game-rathkes.js DATA (yard ring and passage, OSM way 113875904).
const YARD = [[-834.6, 1795.7], [-829.5, 1790.8], [-828.6, 1792.4], [-823.5, 1789.2], [-821.4, 1792.9], [-819.5, 1796.9], [-828.9, 1801.9], [-826.4, 1806.4], [-833.7, 1810.4], [-836.1, 1806.3], [-835.7, 1805.9], [-837.8, 1802.3], [-836.5, 1801.5], [-837.8, 1799.3], [-839.1, 1800.2], [-840.9, 1797.2], [-835.6, 1794]];
const PASSAGE = (() => {const a = [-838.15, 1783.25], b = [-831.9, 1794.7], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-u[1], u[0]], w = 1.3;
  return [[a[0] + n[0] * w + u[0] * .6, a[1] + n[1] * w + u[1] * .6], [b[0] + n[0] * w, b[1] + n[1] * w], [b[0] - n[0] * w, b[1] - n[1] * w], [a[0] - n[0] * w + u[0] * .6, a[1] - n[1] * w + u[1] * .6]];})();
const ARENAS = [
  {id: 'haarklous', name: 'Haarklous plass', where: 'the park by the firepit, Torshov', seed: 11, old: true, hunt: 210,
    zones: [[[-29.8, -44.8], [-12, -72], [2, -70], [27, -63], [61, -47], [52, -33], [44, -2], [34.7, .3], [5.9, -19.8], [-17.4, -36]]],// 5 m in from the streets' centre lines
    ring: [-4, -33], spawn: [-6, -37, Math.PI * .75], avoid: [[16.05, -17.99, 6.5]],// the firepit, its benches and woodpile
    plan: [['bench', 7, 'path'], ['bin', 5, 'near:bench'], ['bin', 2, 'path'], ['lamp', 5, 'pathAlong'], ['bush', 9, 'cluster'], ['tree', 6, 'free'], ['logs', 3, 'near:avoid'],
      ['picnic', 3, 'free'], ['boulder', 6, 'free'], ['bike', 4, 'pathAlong'], ['scooter', 4, 'free'], ['cone', 2, 'free'], ['sign', 1, 'path']]},
  {id: 'olafryes', name: 'Olaf Ryes plass', where: 'the park square, Grünerløkka', seed: 23, hunt: 240,
    zones: [[[-1067.3, 1550.6], [-981.9, 1551.9], [-983.8, 1460], [-1070, 1458.6]]],
    ring: [-1024.6, 1543.2], spawn: [-1024.6, 1538.5, Math.PI], avoid: [[-1024.9, 1505, 7.5]],// the fountain and its ring path
    plan: [['bench', 12, 'path'], ['bin', 6, 'near:bench'], ['lamp', 8, 'pathAlong'], ['bush', 10, 'cluster'], ['tree', 5, 'free'], ['bike', 6, 'pathAlong'], ['scooter', 5, 'free'],
      ['planter', 5, 'path'], ['sign', 3, 'path'], ['picnic', 3, 'free'], ['boulder', 4, 'free'], ['cone', 3, 'free']]},
  {id: 'rathkes', name: 'Bakgården, Rathkes gate 1', where: 'the backyard and the passage, Grünerløkka', seed: 37, hunt: 150,
    zones: [YARD, PASSAGE], ring: [-835.6, 1789.6], spawn: [-835.2, 1788.6, Math.atan2(.55, 1)], avoid: [[-838.5, 1804.3, 1.6], [-842.3, 1797.2, 1.6], [-837.2, 1785.6, 1.2]],// stair doors 1B, 1C, the gate
    plan: [['wheeliebin', 5, 'row'], ['bike', 7, 'wall'], ['scooter', 2, 'wall'], ['moped', 1, 'wall'], ['planter', 4, 'wall'], ['crate', 3, 'free'], ['barrel', 2, 'free'], ['bench', 1, 'wall'],
      ['tree', 1, 'free'], ['bush', 2, 'wall'], ['cone', 1, 'free'], ['bin', 1, 'wall']]}
];

// ---------- What stands near an arena ----------
function scene(A) {
  const box = A.zones.flat(), x0 = Math.min(...box.map(p => p[0])) - 30, x1 = Math.max(...box.map(p => p[0])) + 30, s0 = Math.min(...box.map(p => p[1])) - 30, s1 = Math.max(...box.map(p => p[1])) + 30;
  const near = p => p[0] > x0 && p[0] < x1 && p[1] > s0 && p[1] < s1;
  const S = {buildings: [], car: [], foot: [], trees: [], bushes: [], lamps: [], water: [], pitch: []};
  const src = A.old ? {buildings: D.buildings.map(b => pairs(b.r.o)), roads: D.roads.map(r => ({k: r.k, w: r.w, p: pairs(r.p)})), areas: D.areas.map(a => ({k: a.k, p: pairs(a.o)})),
    trees: pairs(D.trees.filter((v, i) => i % 3 !== 2))} : {buildings: G.buildings.map(b => b.ring), roads: G.roads.map(r => ({k: r.k, w: r.w, p: pairs(r.p)})), areas: G.areas.map(a => ({k: a.k, p: pairs(a.o)})), trees: G.trees.map(t => [t.x, t.s])};
  for (const b of src.buildings) if (b.some(near)) S.buildings.push(b);
  for (const r of src.roads) if (r.p.some(near)) (CAR.includes(r.k) ? S.car : FOOT.includes(r.k) ? S.foot : S.car).push(r);
  for (const a of src.areas) if (a.k === 'water' && a.p.some(near) && a.p.length < 60) S.water.push(a.p);else if (a.k === 'pitch' && a.p.some(near)) S.pitch.push(a.p);
  S.trees = src.trees.filter(near);
  if (A.old) {for (let i = 0; i < D.bushes.length; i += 3) if (near([D.bushes[i], D.bushes[i + 1]])) S.bushes.push([D.bushes[i], D.bushes[i + 1], D.bushes[i + 2]]);for (let i = 0; i < D.lamps.length; i += 2) if (near([D.lamps[i], D.lamps[i + 1]])) S.lamps.push([D.lamps[i], D.lamps[i + 1]]);}
  return S;
}

// ---------- Placing the things ----------
function build(A) {
  const S = scene(A), rnd = mulberry32(A.seed), placed = [], K = Rules.KINDS;
  // Inside the arena (the union of its zones) and at least m from its edge; a negative m: within -m of it.
  const inUnion = p => A.zones.some(z => inPoly(p, z)), ring8 = (p, m) => Array.from({length: 8}, (_, k) => [p[0] + Math.cos(k * Math.PI / 4) * m, p[1] + Math.sin(k * Math.PI / 4) * m]);
  const inside = (p, m) => m >= 0 ? inUnion(p) && ring8(p, m).every(inUnion) : inUnion(p) || ring8(p, -m).some(inUnion);
  const radius = k => Math.hypot(K[k].w, K[k].d) / 2;
  // The footprint's corners and edge midpoints (front faces (sin h, cos h)).
  const outline = (k, p, h) => {const f = [Math.sin(h), Math.cos(h)], r = [Math.cos(h), -Math.sin(h)], W = K[k].w / 2, Dd = K[k].d / 2, out = [p];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) out.push([p[0] + r[0] * W * a + f[0] * Dd * b, p[1] + r[1] * W * a + f[1] * Dd * b]);return out;};
  function free(k, p, h) {
    const r = radius(k), hr = Math.max(K[k].w, K[k].d) / 2, O = outline(k, p, h);
    if (!O.every(q => inside(q, .3))) return false;
    if (S.buildings.some(b => O.some(q => inPoly(q, b) || polyDist(q, b) < .3))) return false;
    for (const rd of S.car) for (let i = 0; i + 1 < rd.p.length; i++) if (O.some(q => segDist(q, rd.p[i], rd.p[i + 1]) < rd.w / 2 + .8)) return false;
    for (const rd of S.foot) for (let i = 0; i + 1 < rd.p.length; i++) if (O.some(q => segDist(q, rd.p[i], rd.p[i + 1]) < rd.w / 2 + .12)) return false;
    if (S.trees.some(t => Math.hypot(t[0] - p[0], t[1] - p[1]) < hr + .7)) return false;
    if (S.bushes.some(b => Math.hypot(b[0] - p[0], b[1] - p[1]) < hr + b[2] * .6 + .3)) return false;
    if (S.lamps.some(l => Math.hypot(l[0] - p[0], l[1] - p[1]) < hr + .5)) return false;
    if (S.water.some(w => inPoly(p, w) || polyDist(p, w) < hr + .4)) return false;
    if (k !== 'cone' && S.pitch.some(w => O.some(q => inPoly(q, w)))) return false;// nothing but training cones on the football pitch
    if ((A.avoid || []).some(([x, s, rr]) => Math.hypot(x - p[0], s - p[1]) < rr + hr)) return false;
    if (Math.hypot(A.ring[0] - p[0], A.ring[1] - p[1]) < 3 + hr || Math.hypot(A.spawn[0] - p[0], A.spawn[1] - p[1]) < 2.5 + hr) return false;
    if (placed.some(q => Math.hypot(q[1] - p[0], q[2] - p[1]) < r + radius(q[0]) * .9 + .25)) return false;
    return true;
  }
  const footSegs = S.foot.flatMap(rd => rd.p.slice(1).map((b, i) => ({a: rd.p[i], b, w: rd.w}))).filter(sg => inside(sg.a, -2) || inside(sg.b, -2));
  const wallSegs = S.buildings.flatMap(b => b.map((a, i) => ({a, b: b[(i + 1) % b.length], ring: b}))).filter(sg => Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) > 1.2 && (inside(sg.a, -3) || inside(sg.b, -3) || inside([(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2], -3)));
  const box = A.zones.flat(), bx0 = Math.min(...box.map(p => p[0])), bx1 = Math.max(...box.map(p => p[0])), bs0 = Math.min(...box.map(p => p[1])), bs1 = Math.max(...box.map(p => p[1]));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const heading = (dx, ds) => Math.atan2(dx, ds);
  function candidate(k, style) {
    const T = K[k];
    if (style === 'free') return {p: [bx0 + rnd() * (bx1 - bx0), bs0 + rnd() * (bs1 - bs0)], h: rnd() * Math.PI * 2};
    if (style === 'path' || style === 'pathAlong') {
      if (!footSegs.length) return candidate(k, 'free');
      const sg = pick(footSegs), t = .1 + rnd() * .8, L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) || 1, u = [(sg.b[0] - sg.a[0]) / L, (sg.b[1] - sg.a[1]) / L], side = rnd() < .5 ? -1 : 1, n = [-u[1] * side, u[0] * side];
      const off = sg.w / 2 + (style === 'path' ? T.d / 2 : T.w / 2) + .35, p = [sg.a[0] + (sg.b[0] - sg.a[0]) * t + n[0] * off, sg.a[1] + (sg.b[1] - sg.a[1]) * t + n[1] * off];
      return {p, h: style === 'path' ? heading(-n[0], -n[1]) : heading(u[0], u[1]) + (rnd() < .5 ? Math.PI : 0)};// a bench faces the path; a bike stands along it
    }
    if (style === 'wall' || style === 'row') {
      if (!wallSegs.length) return candidate(k, 'free');
      const sg = pick(wallSegs), L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), u = [(sg.b[0] - sg.a[0]) / L, (sg.b[1] - sg.a[1]) / L];
      const mid = [(sg.a[0] + sg.b[0]) / 2, (sg.a[1] + sg.b[1]) / 2];let n = [-u[1], u[0]];if (inPoly([mid[0] + n[0] * .2, mid[1] + n[1] * .2], sg.ring)) n = [-n[0], -n[1]];
      const along = k === 'bike' || k === 'scooter' || k === 'moped' ? T.d : T.d, t = rnd(), off = along / 2 + .32, p = [sg.a[0] + (sg.b[0] - sg.a[0]) * t + n[0] * off, sg.a[1] + (sg.b[1] - sg.a[1]) * t + n[1] * off];
      // Bikes and mopeds stand with the front wheel to the wall; the rest have their back to it.
      return {p, h: k === 'bike' || k === 'scooter' || k === 'moped' ? heading(-n[0], -n[1]) : heading(n[0], n[1]), u, n, sg};
    }
    return candidate(k, 'free');
  }
  const add = (k, p, h) => {const e = [k, Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round((((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) / 1000];if (k === 'bush' || k === 'tree' || k === 'boulder') e.push(Math.round((.8 + rnd() * .45) * 100) / 100);placed.push(e);};
  for (const [k, n, style] of A.plan) {
    let got = 0;
    for (let tries = 0; got < n && tries < 4000; tries++) {
      if (style.startsWith('near:')) {
        const what = style.slice(5), anchors = what === 'avoid' ? (A.avoid || []).slice(0, 1).map(([x, s, r]) => ['_', x, s, 0, r]) : placed.filter(q => q[0] === what);
        if (!anchors.length) break;
        const a = pick(anchors);
        if (what === 'avoid') {const ang = rnd() * Math.PI * 2, rr = a[4] + 1 + rnd() * 2.5, p = [a[1] + Math.sin(ang) * rr, a[2] + Math.cos(ang) * rr], h = ang + Math.PI / 2 + (rnd() - .5) * .4;if (free(k, p, h)) {add(k, p, h);got++;}continue;}
        // A bin at one end of a bench, standing in line with it.
        const side = rnd() < .5 ? -1 : 1, ex = Math.cos(a[3]), es = -Math.sin(a[3]), off = K[a[0]].w / 2 + K[k].w / 2 + .35, p = [a[1] + ex * off * side, a[2] + es * off * side];
        if (free(k, p, a[3])) {add(k, p, a[3]);got++;}
        continue;
      }
      if (style === 'cluster') {
        const c = candidate(k, 'free');if (!inside(c.p, 2)) continue;const m = Math.min(n - got, 2 + Math.floor(rnd() * 3));let put = 0;
        for (let j = 0; j < 40 && put < m; j++) {const ang = rnd() * Math.PI * 2, rr = 1.2 + rnd() * 1.6, p = [c.p[0] + Math.sin(ang) * rr * (put ? 1 : 0), c.p[1] + Math.cos(ang) * rr * (put ? 1 : 0)], h = rnd() * Math.PI * 2;if (free(k, p, h)) {add(k, p, h);put++;got++;}}
        continue;
      }
      if (style === 'row') {
        const c = candidate(k, 'row');if (!c.u) continue;const m = n - got, gap = K[k].w + .12, row = [];
        for (let j = 0; j < m; j++) row.push([c.p[0] + c.u[0] * gap * j, c.p[1] + c.u[1] * gap * j]);
        if (row.every(p => free(k, p, c.h) && polyDist(p, c.sg.ring) < K[k].d / 2 + .6)) {row.forEach(p => add(k, p, c.h));got += row.length;}
        continue;
      }
      const c = candidate(k, style);if (free(k, c.p, c.h)) {add(k, c.p, c.h);got++;}
    }
    if (got < n) console.warn(`${A.id}: only ${got} of ${n} ${k}`);
  }
  const realBushes = S.bushes.filter(b => inside([b[0], b[1]], 0)).length, realLamps = S.lamps.filter(l => inside(l, 0)).length;
  console.log(`${A.id}: ${placed.length} things placed, ${realBushes} real bushes and ${realLamps} real lamps inside, ${S.trees.filter(t => inside(t, 0)).length} trees`);
  return placed;
}

const out = {arenas: ARENAS.map(A => ({id: A.id, name: A.name, where: A.where, zones: A.zones.map(z => z.map(p => p.map(v => Math.round(v * 100) / 100))), ring: A.ring, spawn: A.spawn.map(v => Math.round(v * 1000) / 1000),
  old: !!A.old, hunt: A.hunt, props: build(A)}))};
const text = `/* Prop hunt arenas (issue #124), made by tools/make-prophunt.cjs from OpenStreetMap (surroundings-data.js, gamle-oslo-data.js). Local metres east (x) / south (s) of Haarklous plass 17A. */\n` +
  `(function (data) {if (typeof module === 'object' && module.exports) module.exports = data;else window.PROPHUNT = data;})(${JSON.stringify(out)});\n`;
fs.writeFileSync(path.join(ROOT, 'prophunt-data.js'), text);
console.log(`prophunt-data.js: ${(text.length / 1024).toFixed(1)} KB`);
