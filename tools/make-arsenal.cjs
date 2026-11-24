/* Makes arsenal-data.js (issue #179: weapons, missions, the arena): the places of the arsenal building, the arena with its
 * vegetation, the bank, the money convoy's route, the dealing spots and the police patrols. Everything is in local metres
 * (x east, s south of Haarklous plass 17A), from surroundings-data.js (OpenStreetMap, Kartverket) and jobs-data.js.
 * Run: node tools/make-arsenal.cjs   (then python build.py)
 */
const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['surroundings-data.js', 'jobs-data.js', 'game-shops.js']) require(path.join(R, f));
const CL = require(path.join(R, 'catacomb-layout.js'));
const D = window.SURROUNDINGS, height = CL.terrainSampler(D), notchFor = window.GameShops.notchFor;
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
function rng(seed) {let a = seed >>> 0;return () => {a = (a + 0x6D2B79F5) | 0;let t = Math.imul(a ^ (a >>> 15), 1 | a);t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};}
const segD = (p, a, b) => {const dx = b[0] - a[0], ds = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / (dx * dx + ds * ds || 1)));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
const inPoly = (x, s, r) => {let c = false;for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > s) !== (r[j][1] > s) && x < (r[j][0] - r[i][0]) * (s - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;return c;};
const rings = D.buildings.map(b => pairs(b.r.o));
const inBuilding = (x, s, m = 0) => rings.some(g => inPoly(x, s, g) || (m > 0 && g.some((p, k) => segD([x, s], p, g[(k + 1) % g.length]) < m)));
const CAR = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk', 'trunk_link', 'service', 'tram'];
const onCarRoad = (x, s, m = 0) => D.roads.some(r => CAR.includes(r.k) && pairs(r.p).some((p, k, a) => k + 1 < a.length && segD([x, s], p, a[k + 1]) < r.w / 2 + m));

// ---------- The places (chosen 24 Nov 2026 with a search over the map: free grass, no building, no car road) ----------
// The arena: the grass slope of Torshovparken south of the music pavilion. The arsenal building: the level corner below it,
// beside Johan Svendsens gate. The bank: 14 m of the brick building's front on Sandakerveien (building 758, wall 9).
const ARENA = {x0: -380, s0: 118, w: 72, d: 48}, HOUSE = {x0: -312, s0: 178, w: 24, d: 12}, BANK = {building: 758, edge: 9, width: 14, depth: 9};

// ---------- The arena: zones of different vegetation, cover, spawn points ----------
function arena() {
  const A = ARENA, rand = rng(179), zones = [
    {id: 'pine', name: 'pine wood', x0: 0, s0: 0, x1: 26, s1: 22, camo: 'woodland'},
    {id: 'birch', name: 'birch grove', x0: 26, s0: 0, x1: 50, s1: 20, camo: 'woodland'},
    {id: 'rocks', name: 'rocks and heather', x0: 50, s0: 0, x1: 72, s1: 24, camo: 'urban'},
    {id: 'meadow', name: 'tall grass', x0: 0, s0: 22, x1: 30, s1: 48, camo: 'grass'},
    {id: 'thicket', name: 'thicket', x0: 30, s0: 20, x1: 52, s1: 48, camo: 'woodland'},
    {id: 'reeds', name: 'reeds and wheat', x0: 52, s0: 24, x1: 72, s1: 48, camo: 'desert'}];
  const things = [], spawns = [], put = (kind, u, v, r, h, sc) => things.push([kind, r1(A.x0 + u), r1(A.s0 + v), r2(r), r2(h), r2(sc), r2(rand() * 6.28)]);
  // Nothing grows on the pad inside the gate (where the games are started) or in the gateway.
  const padU = A.w - 6, padV = A.d - 4.5;
  const free = (u, v, m) => u > 2.5 && v > 2.5 && u < A.w - 2.5 && v < A.d - 2.5 && Math.hypot(u - padU, v - padV) > 6.2 && things.every(t => Math.hypot(t[1] - A.x0 - u, t[2] - A.s0 - v) > t[3] + m) && spawns.every(p => Math.hypot(p[0] - A.x0 - u, p[1] - A.s0 - v) > 2.2);
  // Twelve spawn points round the edge and two in the middle (a metre or more clear of everything).
  for (const [u, v] of [[5, 5], [36, 4], [67, 5], [4, 24], [68, 24], [5, 43], [36, 44], [67, 43], [20, 13], [52, 13], [20, 36], [52, 36], [30, 24], [44, 26]]) spawns.push([r1(A.x0 + u), r1(A.s0 + v)]);
  const fill = (z, kind, n, r, h, m, sc = [1, 1]) => {for (let i = 0, tries = 0; i < n && tries < n * 60; tries++) {const u = z.x0 + rand() * (z.x1 - z.x0), v = z.s0 + rand() * (z.s1 - z.s0);if (!free(u, v, m)) continue;put(kind, u, v, r, h, sc[0] + rand() * (sc[1] - sc[0]));i++;}};
  // kind, count, trunk / body radius (what stops a bullet and a walker), height, spacing.
  fill(zones[0], 'pine', 22, .28, 11, 2.6, [.8, 1.25]);fill(zones[0], 'log', 4, .8, .7, 2);fill(zones[0], 'fern', 30, 0, .7, .6);
  fill(zones[1], 'birch', 20, .2, 9, 2.4, [.8, 1.2]);fill(zones[1], 'bush', 8, .9, 1.5, 1.6);fill(zones[1], 'fern', 14, 0, .7, .6);
  fill(zones[2], 'rock', 12, 1.3, 1.5, 2.2, [.7, 1.4]);fill(zones[2], 'heather', 40, 0, .45, .5);fill(zones[2], 'pine', 4, .28, 9, 3);
  fill(zones[3], 'grass', 150, 0, 1.25, .35, [.8, 1.3]);fill(zones[3], 'hay', 5, 1.0, 1.4, 3);fill(zones[3], 'bush', 4, .9, 1.5, 2);
  fill(zones[4], 'bush', 34, .9, 1.7, 1.5, [.8, 1.4]);fill(zones[4], 'birch', 6, .2, 8, 2.4);fill(zones[4], 'log', 4, .8, .7, 2);fill(zones[4], 'crate', 5, .75, 1.3, 2.4);
  fill(zones[5], 'reed', 150, 0, 1.9, .35, [.8, 1.25]);fill(zones[5], 'sandbag', 6, 1.0, 1.1, 3);fill(zones[5], 'rock', 3, 1.3, 1.4, 3);
  // Pop-up targets for practice when no match is on.
  const targets = [];for (let i = 0, tries = 0; i < 12 && tries < 900; tries++) {const u = 6 + rand() * (A.w - 12), v = 6 + rand() * (A.d - 16);if (!free(u, v, 1.2) || targets.some(t => Math.hypot(t[0] - A.x0 - u, t[1] - A.s0 - v) < 7)) continue;targets.push([r1(A.x0 + u), r1(A.s0 + v)]);i++;}
  return {...A, gate: [A.x0 + A.w - 6, A.s0 + A.d], zones: zones.map(z => ({id: z.id, name: z.name, camo: z.camo, x0: A.x0 + z.x0, s0: A.s0 + z.s0, x1: A.x0 + z.x1, s1: A.s0 + z.s1})), things, spawns, targets};
}

// ---------- The bank ----------
function bank() {
  const ring = rings[BANK.building], a = ring[BANK.edge], b = ring[(BANK.edge + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t0 = (L - BANK.width) / 2 / L, t1 = (L + BANK.width) / 2 / L, nt = notchFor(ring.map(p => [...p]), BANK.edge, t0, t1, BANK.depth);
  if (nt.depth < 8) throw new Error('the bank does not fit');
  const mid = [(nt.P0[0] + nt.P1[0]) / 2, (nt.P0[1] + nt.P1[1]) / 2];
  return {...BANK, t0: +t0.toFixed(4), t1: +t1.toFixed(4), name: 'Torshov Sparebank', street: 'Sandakerveien', front: mid.map(r1), out: [r2(-nt.n[0]), r2(-nt.n[1])], depthFits: nt.depth};
}

// ---------- The street graph: the convoy's route ----------
function route(from, to) {
  const key = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`, nodes = new Map(), cost = {primary: 1, secondary: 1, tertiary: 1.05, residential: 1.25, unclassified: 1.3, trunk: 6, trunk_link: 6};
  const node = p => {const k = key(p);if (!nodes.has(k)) nodes.set(k, {p, e: []});return nodes.get(k);};
  for (const rd of D.roads) {if (!(rd.k in cost)) continue;const p = pairs(rd.p);for (let k = 0; k + 1 < p.length; k++) {const A = node(p[k]), B = node(p[k + 1]), L = Math.hypot(p[k][0] - p[k + 1][0], p[k][1] - p[k + 1][1]);A.e.push({to: B, L, c: L * cost[rd.k], n: rd.n || rd.k, w: rd.w});B.e.push({to: A, L, c: L * cost[rd.k], n: rd.n || rd.k, w: rd.w});}}
  const near = q => [...nodes.values()].sort((u, v) => Math.hypot(u.p[0] - q[0], u.p[1] - q[1]) - Math.hypot(v.p[0] - q[0], v.p[1] - q[1]))[0];
  const A = near(from), B = near(to), dist = new Map([[A, 0]]), prev = new Map(), open = new Set([A]);
  while (open.size) {let u = null;for (const n of open) if (!u || dist.get(n) < dist.get(u)) u = n;open.delete(u);if (u === B) break;for (const e of u.e) {const d = dist.get(u) + e.c;if (d < (dist.get(e.to) ?? Infinity)) {dist.set(e.to, d);prev.set(e.to, [u, e]);open.add(e.to);}}}
  if (!prev.has(B)) throw new Error('no route');
  const pts = [B.p], names = [];for (let n = B; prev.has(n);) {const [u, e] = prev.get(n);pts.push(u.p);if (names[names.length - 1] !== e.n) names.push(e.n);n = u;}
  pts.reverse();names.reverse();
  // Resample every 6 m so the trucks follow the bends smoothly.
  const out = [pts[0]];let len = 0;for (let i = 0; i + 1 < pts.length; i++) {const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n = Math.max(1, Math.round(L / 6));for (let k = 1; k <= n; k++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);len += L;}
  return {pts: out.map(p => p.map(r1)), length: Math.round(len), names};
}

// ---------- Dealing: customers at street doors, police patrols between doors ----------
function dealing() {
  const rand = rng(1790), doors = window.JOBS.doors.filter(d => Math.hypot(d.x + 300, d.s - 184) > 90 && Math.hypot(d.x + 300, d.s - 184) < 520 && Math.abs(d.x) < 700 && Math.abs(d.s) < 700 && !inBuilding(d.x, d.s, .5));
  const spots = [];for (let tries = 0; spots.length < 9 && tries < 4000; tries++) {const d = doors[Math.floor(rand() * doors.length)];if (spots.some(q => Math.hypot(q.x - d.x, q.s - d.s) < 110)) continue;spots.push(d);}
  // A patrol walks between two doors of the same street 40–110 m apart, each near a customer.
  const patrols = [];for (const sp of spots) {
    const street = sp.a.replace(/\s+\d+\w*$/, ''), same = doors.filter(d => d.a.startsWith(street) && d !== sp), a = same.filter(d => Math.hypot(d.x - sp.x, d.s - sp.s) > 25 && Math.hypot(d.x - sp.x, d.s - sp.s) < 70)[0];
    const b = a && same.filter(d => {const L = Math.hypot(d.x - a.x, d.s - a.s);return L > 40 && L < 110;})[0];
    if (a && b && patrols.length < 5) patrols.push({a: [r1(a.cx), r1(a.cs)], b: [r1(b.cx), r1(b.cs)], street});
  }
  return {spots: spots.map(d => ({at: [r1(d.x), r1(d.s)], face: r2(d.f), address: d.a})), patrols};
}

const A = arena(), B = bank(), convoy = route((process.env.START || '0,-60').split(',').map(Number), B.front), deal = dealing();
// Where the heist and the convoy job end: a quiet spot beside a street, far from the bank and off the convoy's route.
const getaway = (() => {const c = window.JOBS.doors.filter(d => Math.hypot(d.x - B.front[0], d.s - B.front[1]) > 380 && Math.hypot(d.x - B.front[0], d.s - B.front[1]) < 520 && d.s > -150 && d.x < -150 && !onCarRoad(d.x, d.s, -1) && convoy.pts.every(p => Math.hypot(p[0] - d.x, p[1] - d.s) > 120));const d = c[Math.floor(c.length / 2)];return {at: [r1(d.cx), r1(d.cs)], address: d.a};})();
const cum = [0];for (let i = 1; i < convoy.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(convoy.pts[i][0] - convoy.pts[i - 1][0], convoy.pts[i][1] - convoy.pts[i - 1][1]));
const at = f => {const i = cum.findIndex(c => c >= f * cum[cum.length - 1]);return {i, at: convoy.pts[i]};};
const data = {made: 'tools/make-arsenal.cjs', arena: A, house: {...HOUSE, door: [HOUSE.x0 + 6, HOUSE.s0], floor: r2(Math.max(...[0, .5, 1].flatMap(u => [0, .5, 1].map(v => height(HOUSE.x0 + HOUSE.w * u, HOUSE.s0 + HOUSE.d * v)))) + .12)},
  bank: B, convoy: {...convoy, ambush: [at(.42), at(.74)]}, deal, getaway};
fs.writeFileSync(path.join(R, 'arsenal-data.js'), `/* Generated by tools/make-arsenal.cjs from surroundings-data.js and jobs-data.js (map data © OpenStreetMap contributors, ODbL; heights © Kartverket). Local metres east (x) / south (s) of Haarklous plass 17A. */\n(function (data) {if (typeof module === 'object' && module.exports) module.exports = data;else window.ARSENAL = data;})(${JSON.stringify(data)});\n`);
console.log(`arena ${A.things.length} things, ${A.spawns.length} spawns, ${A.targets.length} targets`);
console.log(`house floor ${data.house.floor} (ground ${r2(height(HOUSE.x0, HOUSE.s0))} … ${r2(height(HOUSE.x0 + HOUSE.w, HOUSE.s0 + HOUSE.d))})`);
console.log(`bank ${B.name}: front ${B.front}, out ${B.out}, depth ${B.depthFits}`);
console.log(`convoy ${convoy.length} m, ${convoy.pts.length} points: ${convoy.names.join(' → ')}; ambush at ${data.convoy.ambush.map(a => a.at).join(' and ')}`);
console.log(`deal spots: ${deal.spots.map(s => s.address).join('; ')}`);
console.log(`patrols: ${deal.patrols.map(p => p.street).join('; ')}`);
console.log(`getaway: ${getaway.address} ${getaway.at}`);
