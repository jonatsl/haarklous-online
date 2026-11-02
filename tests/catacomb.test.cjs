const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../surroundings-data.js');
require('../site-data.js');
require('../paintball-data.js');
const CL = require('../catacomb-layout.js');
const collision = require('../walk-collision.js');
const D = window.SURROUNDINGS, SITE = window.SITE, PB = window.PAINTBALL;
const heightLocal = CL.terrainSampler(D);
const L = CL.build({heightLocal});
// The game's frame: the same transform as surroundings.js (toWorld / toLocal).
const cT = Math.cos(D.geo.theta), sT = Math.sin(D.geo.theta);
const toWorld = (x, s) => ({x: x * cT + s * sT + D.geo.x, z: -x * sT + s * cT + D.geo.z});
const toLocal = (x, z) => {const dx = x - D.geo.x, dz = z - D.geo.z;return {x: dx * cT - dz * sT, s: dx * sT + dz * cT};};
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const rectOf = e => ({x0: e.rect[0], s0: e.rect[1], x1: e.rect[2], s1: e.rect[3]});
const inside = (r, [x, s], m = 0) => x > r.x0 - m && x < r.x1 + m && s > r.s0 - m && s < r.s1 + m;
const segNear = (r, a, b, m) => {const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / .5));for (let k = 0; k <= n; k++) if (inside(r, [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], m)) return true;return false;};
const door = e => e.toLocal(0, 0);

test('three entrances about 100 m apart', () => {
  assert.equal(L.entrances.length, 3);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const a = door(L.entrances[i]), b = door(L.entrances[j]), d = Math.hypot(a.x - b.x, a.s - b.s);
    assert.ok(d > 80 && d < 130, `${L.entrances[i].id}–${L.entrances[j].id}: ${d.toFixed(1)} m`);
  }
});

test('the mausoleums stand clear of buildings, roads, paths, trees, lamps and the other places', () => {
  const box = r => ({x0: r.x0, s0: r.s0, x1: r.x0 + r.w, s1: r.s0 + r.d});
  const places = {site: box(SITE.rect), yard: box(PB.rect), lobby: box(PB.lobby), sculpture: {x0: 6.1, s0: 272.5, x1: 19.1, s1: 279.5}, petanque: {x0: D.petanque.x - 9, s0: D.petanque.s - 9, x1: D.petanque.x + 9, s1: D.petanque.s + 9}};
  for (const e of L.entrances) {
    const r = rectOf(e);
    for (const [name, p] of Object.entries(places)) assert.ok(!(r.x0 < p.x1 && p.x0 < r.x1 && r.s0 < p.s1 && p.s0 < r.s1), `${e.id} overlaps the ${name}`);
    D.buildings.forEach((b, i) => {const ring = pairs(b.r.o);assert.ok(!ring.some((p, k) => segNear(r, p, ring[(k + 1) % ring.length], 3)), `${e.id}: building ${i} within 3 m`);});
    D.roads.forEach(rd => {const p = pairs(rd.p), path = ['footway', 'path', 'cycleway', 'steps', 'track'].includes(rd.k);for (let k = 0; k + 1 < p.length; k++) assert.ok(!segNear(r, p[k], p[k + 1], rd.w / 2 + (path ? .8 : 2)), `${e.id}: a ${rd.k} too close`);});
    for (let i = 0; i < D.trees.length; i += 3) assert.ok(!inside(r, [D.trees[i], D.trees[i + 1]], 1.5), `${e.id}: a tree in the way`);
    for (let i = 0; i < D.lamps.length; i += 2) assert.ok(!inside(r, [D.lamps[i], D.lamps[i + 1]], 1), `${e.id}: a lamp post in the way`);
    for (const h of D.discgolf) for (const q of [h.tee, h.basket]) assert.ok(!inside(r, q, 10), `${e.id}: too close to disc golf`);
    // The footprint is on the terrain's 4 m grid, so the ground mesh can be cut out exactly under it.
    assert.ok(e.rect.every(v => v % 4 === 0), `${e.id}: ${e.rect}`);
  }
});

test('the layout is the same on every computer (seeded)', () => {
  const again = CL.build({heightLocal});
  assert.deepEqual(Array.from(again.kind), Array.from(L.kind));
  assert.deepEqual(Array.from(again.style), Array.from(L.style));
  assert.deepEqual(again.torches.map(t => [t.x, t.s]), L.torches.map(t => [t.x, t.s]));
});

test('every gallery and room can be reached from every entrance', () => {
  for (const e of L.entrances) {
    const seen = new Uint8Array(L.NX * L.NS), q = [e.cells[0]];seen[e.cells[0]] = 1;
    while (q.length) {const c = q.pop(), i = c % L.NX, j = Math.floor(c / L.NX);[[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {const ni = i + di, nj = j + dj;if (ni < 0 || nj < 0 || ni >= L.NX || nj >= L.NS) return;const n = L.id(ni, nj);if (!seen[n] && L.walkable(n)) {seen[n] = 1;q.push(n);}});}
    for (let c = 0; c < L.NX * L.NS; c++) if (L.walkable(c)) assert.ok(seen[c], `cell ${c} not reachable from the ${e.id} entrance`);
  }
});

test('a large catacomb: over a kilometre of galleries, lit and dark parts, torches, every room dug', () => {
  let walk = 0, dark = 0;for (let c = 0; c < L.NX * L.NS; c++) if (L.walkable(c)) {walk++;if (L.isDark(c)) dark++;}
  assert.ok(walk * L.CELL > 1000, `${walk * L.CELL} m`);
  assert.ok(dark / walk > .3 && dark / walk < .7, `dark share ${(dark / walk).toFixed(2)}`);
  assert.ok(L.torches.length > 50, `${L.torches.length} torches`);
  assert.ok(L.paths.every(p => p.path), L.paths.filter(p => !p.path).map(p => `${p.a}->${p.b}`).join(', '));
  for (const r of L.rooms) assert.ok(L.walkable(L.id(r.cells[0], r.cells[1])), r.id);
  // Torches hang only in the lit parts.
  for (const t of L.torches) assert.ok(!L.isDark(t.cell));
});

test('rock stays above every gallery: no ceiling comes within 1.5 m of the ground', () => {
  for (let c = 0; c < L.NX * L.NS; c++) {
    if (!L.walkable(c) || L.stairOf[c] >= 0) continue;
    const p = L.centre(c % L.NX, Math.floor(c / L.NX));
    for (const [dx, ds] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {const y = L.ceilAt(c, p.x + dx * .99, p.s + ds * .99) + .25;assert.ok(heightLocal(p.x + dx, p.s + ds) - y > 1.5, `cell ${c}: ${(heightLocal(p.x + dx, p.s + ds) - y).toFixed(2)} m of rock`);}
  }
});

test('the stairs: real stair steepness, from the door landing to the catacomb floor, under the ground once past the mausoleum', () => {
  for (const e of L.entrances) {
    assert.ok(e.slope > .5 && e.slope < .65, `${e.id} slope ${e.slope}`);
    assert.equal(e.floorT(1), e.top);assert.equal(e.floorT(e.t0), e.top);assert.ok(Math.abs(e.floorT(e.tBottom) - L.FLOOR_Y) < 1e-9);
    // Above the stair's ceiling (2.4 m over the step line) at least 0.4 m of ground; the hidden tops of its walls (0.25 m higher) stay under the grass too.
    for (let t = 8; t <= e.tBottom; t += .5) for (const w of [-1, 0, 1]) {
      const p = e.toLocal(t, w), roof = e.floorT(t) + e.headroom, g = heightLocal(p.x, p.s);
      assert.ok(g - roof > .4 && g - roof - .25 > .1, `${e.id} at t=${t}: ${(g - roof).toFixed(2)} m of cover`);
    }
    // The terrain round the door is within a step of the landing, so the threshold ramp is gentle.
    for (const w of [-.8, 0, .8]) {const d = e.toLocal(0, w);assert.ok(e.top - heightLocal(d.x, d.s) < .45, `${e.id} door step ${(e.top - heightLocal(d.x, d.s)).toFixed(2)}`);}
  }
});

test('walking in through each door and down the stair reaches the entrance hall (game collision code)', () => {
  const ground = {name: 'Neighbourhood', points: [[-760, -760], [760, -760], [760, 760], [-760, 760]].map(([x, s]) => toWorld(x, s)), ceilingHeight: Infinity, surfaceKind: 'terrain',
    height: p => {const l = toLocal(p.x, p.z);return L.cutsGround(l.x, l.s) ? -1e4 : heightLocal(l.x, l.s);}};
  const world = collision.createWorld({floors: [...L.floors(toWorld, toLocal), ground], obstacles: L.obstacles(toWorld), radius: .18, clearance: .08});
  for (const e of L.entrances) {
    const start = toWorld(e.toLocal(-3, 0).x, e.toLocal(-3, 0).s), goal = e.toLocal(e.tBottom + 2, 0), gw = toWorld(goal.x, goal.s);
    let p = {x: start.x, z: start.z, y: heightLocal(e.toLocal(-3, 0).x, e.toLocal(-3, 0).s)};
    for (let i = 0; i < 400; i++) {
      const dx = gw.x - p.x, dz = gw.z - p.z, d = Math.hypot(dx, dz);if (d < .2) break;
      const step = Math.min(.12, d), n = collision.move(world, p, {x: dx / d * step, z: dz / d * step}, 1.65, p.y);p = {x: n.x, z: n.z, y: n.y};
    }
    const l = toLocal(p.x, p.z);
    assert.ok(Math.hypot(l.x - goal.x, l.s - goal.s) < .3, `${e.id}: stopped at t=${e.tOf(l.x, l.s).toFixed(2)}`);
    assert.ok(Math.abs(p.y - L.FLOOR_Y) < 1e-6, `${e.id}: feet at ${p.y}`);
    assert.ok(L.deep(l.x, l.s, p.y) && L.depth(l.x, l.s, p.y) === 1);
    // Walls hold: from the hall you cannot walk into the rock beside the stair foot.
    const side = e.toLocal(e.tBottom - 1, 2.5), sw = toWorld(side.x, side.s);assert.ok(!collision.canStand(world, sw, 1.65, e.floorT(e.tBottom - 1)));
  }
});

test('the map shows only what you have seen: line of sight, not through rock; it is saved and loaded', () => {
  const ex = CL.explorer(L, null), hall = L.rooms.find(r => r.id === 'hall-north');
  assert.equal(ex.count, 0);
  ex.reveal(hall.cx, hall.cs, 13);
  assert.ok(ex.count > 9 && ex.count < 60, `${ex.count} cells`);
  for (let c = 0; c < L.NX * L.NS; c++) if (ex.seen[c]) {const p = L.centre(c % L.NX, Math.floor(c / L.NX));assert.ok(L.walkable(c) && Math.hypot(p.x - hall.cx, p.s - hall.cs) <= 13);}
  // A gallery cell beyond rock is not seen even when it is near.
  for (let c = 0; c < L.NX * L.NS; c++) {const p = L.centre(c % L.NX, Math.floor(c / L.NX));if (L.walkable(c) && Math.hypot(p.x - hall.cx, p.s - hall.cs) < 12 && ![[0, 0], [-.7, -.7], [.7, .7], [-.7, .7], [.7, -.7]].some(([a, b]) => L.los(hall.cx, hall.cs, p.x + a, p.s + b))) assert.ok(!ex.seen[c], `cell ${c} seen through rock`);}
  const back = CL.explorer(L, ex.save());assert.equal(back.count, ex.count);assert.deepEqual(Array.from(back.seen), Array.from(ex.seen));
  assert.equal(CL.explorer(L, 'not base64!').count, 0);
});
