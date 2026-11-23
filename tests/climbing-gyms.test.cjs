// Issue #168: the other climbing gyms inside the map (Klatreverket Løkka and Løren, Vulkan klatresenter, Brak Buldring).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
globalThis.window = globalThis;
for (const f of ['gamle-oslo-data.js', 'loren-data.js', 'climbing-gyms-data.js', 'game-shops.js']) require(path.join(__dirname, '..', f));
const G = require('../game-climbing.js');
const District = require('../district.js');
const GYMS = globalThis.CLIMBING_GYMS;
const inside = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};

// The world as game-main builds it before Surroundings.create: the patches decoded, the rooms cut into their buildings.
let built = null;
function world() {
  if (built) return built;
  const ds = window.DISTRICTS.filter(d => d.name === 'gamle-oslo' || d.name === 'loren').map(d => District.decode(d));
  const preps = G.prepareHalls(ds, GYMS, District);
  // Surroundings puts a building's roof at the ground under its outline's centre + its height.
  for (const p of preps) {const b = p.bldg;let cx = 0, cs = 0;for (const q of b.ring) {cx += q[0];cs += q[1];}cx /= b.ring.length;cs /= b.ring.length;b.top = District.height(p.patch, cx, cs) + b.h;}
  built = {ds, preps};return built;
}
function three() {
  const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;
  globalThis.document = {createElement: () => ({getContext: () => new Proxy({}, {get: () => () => {}})})};globalThis.addEventListener = () => {};
  const lib = new Proxy({mergeStatic() {}, boxUV() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
  return {T, lib};
}
const halls = new Map();
function hall(id) {
  if (halls.has(id)) return halls.get(id);
  const {preps} = world(), p = preps.find(q => q.g.id === id), {T, lib} = three();
  const hw = (x, z) => District.height(p.patch, x, z);
  const gym = G.createHall({T, lib, world: {toWorld: (x, s) => ({x, z: s}), toLocal: (x, z) => ({x, s: z}), heightWorld: hw}, prep: p, avatars: null, audio: null});
  const r = {gym, p, hw};halls.set(id, r);return r;
}

test('the gyms found are in their real buildings inside the map, and Bryn (outside it) is not built', () => {
  assert.deepEqual(GYMS.map(g => g.id), ['lokka', 'vulkan', 'loren', 'brak']);
  const want = {lokka: 'Thorvald Meyers gate 9', vulkan: 'Vulkan 13', loren: 'Peter Møllers vei 4', brak: 'Østerdalsgata 7A'};
  for (const g of GYMS) {
    assert.ok(g.address.startsWith(want[g.id]), g.address);
    assert.ok(inside(g.gym, g.ring), `${g.name}: its OpenStreetMap point is inside building ${g.osm}`);
    const d = window.DISTRICTS.find(x => x.name === g.district), dd = {x0: d.grid.x0, s0: d.grid.s0, x1: d.grid.x0 + d.grid.step * (d.grid.nx - 1), s1: d.grid.s0 + d.grid.step * (d.grid.ns - 1)};
    assert.ok(g.gym[0] > dd.x0 && g.gym[0] < dd.x1 && g.gym[1] > dd.s0 && g.gym[1] < dd.s1, `${g.name} is in the ${g.district} patch`);
  }
  // Klatreverket Bryn, Brynsveien 3 (OSM address node 2793878110) is at local (1899.8, 2912.1): east of Gamle Oslo (x ≤ 1792)
  // and south of Økern (s ≤ 1648).
  for (const d of window.DISTRICTS) {const x1 = d.grid.x0 + d.grid.step * (d.grid.nx - 1), s1 = d.grid.s0 + d.grid.step * (d.grid.ns - 1);assert.ok(!(1899.8 >= d.grid.x0 && 1899.8 <= x1 && 2912.1 >= d.grid.s0 && 2912.1 <= s1), d.name);}
  const {preps} = world();assert.equal(preps.length, 4, 'every gym gets its room');
});

test('real prices and opening hours of each gym', () => {
  const at = iso => new Date(iso), F = G.GYM_FACTS;
  const price = id => hall(id).gym.priceAt;
  assert.equal(price('lokka')(at('2026-11-23T10:00:00')), 155);assert.equal(price('lokka')(at('2026-11-23T17:00:00')), 175);
  assert.equal(price('vulkan')(at('2026-11-23T14:59:00')), 130);assert.equal(price('vulkan')(at('2026-11-23T15:00:00')), 155);assert.equal(price('vulkan')(at('2026-11-28T10:00:00')), 155);
  assert.equal(price('brak')(at('2026-11-24T10:00:00')), 160);assert.equal(price('brak')(at('2026-11-29T10:00:00')), 170);
  const open = (id, iso) => hall(id).gym.openAt(at(iso));
  assert.equal(open('lokka', '2026-11-23T09:30:00'), false);assert.equal(open('lokka', '2026-11-24T08:30:00'), true);// Monday from 10, Tuesday from 8
  assert.equal(open('loren', '2026-11-28T18:30:00'), false);assert.equal(open('vulkan', '2026-11-29T17:59:00'), true);assert.equal(open('brak', '2026-11-29T22:59:00'), true);
  assert.equal(F.vulkan.ropes, true);assert.ok(!F.lokka.ropes && !F.loren.ropes && !F.brak.ropes);
});

test('each gym has what its own page says, with the walls inside the room and under its ceiling', () => {
  const routes = id => hall(id).gym.routes;
  assert.ok(routes('lokka').every(r => r.kind === 'boulder' || r.kind === 'moon' || r.kind === 'campus'), 'Løkka: bouldering only');
  for (const z of ['Soppen', 'Grasshopper', 'Moonwall', 'Kilterboard', 'Kaosvegg', 'Campusbrett']) assert.ok(routes('lokka').some(r => r.zone === z), `Løkka has ${z}`);
  assert.ok(routes('loren').filter(r => r.kind === 'auto').length > 10, 'Løren: more than ten autobelay lines');
  for (const z of ['Moonwall', 'Kilter', 'Tension Board 2', 'Buldreøy 1', 'Buldreøy 2']) assert.ok(routes('loren').some(r => r.zone === z), `Løren has ${z}`);
  const v = routes('vulkan');
  assert.ok(v.some(r => r.toprope) && v.some(r => r.kind === 'lead'), 'Vulkan: top rope and lead');
  assert.equal(new Set(v.filter(r => r.kind === 'boulder').map(r => r.zone)).size, 3, 'Vulkan: three bouldering rooms');
  assert.ok(routes('brak').every(r => /^[1-9]$/.test(r.grade)), 'Brak grades 1 to 9');
  assert.ok(routes('brak').some(r => r.zone === 'Quantum Board') && routes('brak').some(r => r.zone === 'Tension Board'));
  for (const id of G.HALLS) {
    const {gym} = hall(id), {spec} = gym;
    for (const f of gym.faces.values()) {
      const ceiling = spec.ceil(f.lvl);
      for (const x of [0, f.W]) for (const s of [0, f.L]) {
        const p = G.faceAt(f, x, s).p;
        assert.ok(p.a > .29 && p.a < gym.W_ - .29 && p.b > .29 && p.b < gym.D_ - .29, `${id} ${f.id} at (${p.a.toFixed(2)}, ${p.b.toFixed(2)})`);
        assert.ok(p.y <= ceiling + 1e-6, `${id} ${f.id} top ${p.y.toFixed(2)} above the ceiling ${ceiling}`);
      }
    }
    if (id === 'vulkan') assert.ok(gym.faces.get('v1').H > 13.5, `Vulkan's high walls ${gym.faces.get('v1').H}`);
    if (id === 'loren') assert.ok(Math.abs(gym.faces.get('ab1').H - 7.5) < .01, 'Løren: 7.5 m autobelays');
    if (id === 'lokka') assert.ok(gym.faces.get('lA1').H > 4.3 && gym.faces.get('lA1').H < 4.6, 'Løkka: 4.5 m bouldering walls');
    // The room fits under the building's roof (Kartverket's roof height over the room).
    assert.ok(gym.H < hall(id).p.bldg.top - gym.floorY, `${id}: room ${gym.H} m under the roof at ${(hall(id).p.bldg.top - gym.floorY).toFixed(2)} m`);
  }
});

test('the routes are the same on every computer, and every one can be climbed', () => {
  for (const id of G.HALLS) {
    const {gym} = hall(id), spec = gym.spec, a = gym.routes.map(r => r.holds.length), b = hall(id).gym.routes.map(r => r.holds.length);
    assert.deepEqual(a, b);
    const set = G.makeRoutes(spec.seed, spec.walls, {levels: spec.levels}), hw = G.worldHolds(set, (x, z) => ({x, z}), 0);
    const lvlY = y => {let best = 0;for (const l of spec.levels) if (l <= y + .05) best = l;return best;};
    const failed = [];
    for (const r of set.routes) {
      const f = set.faces.find(q => q.id === r.face), floor = f.y0 + ((spec.mats || []).some(m => m[0] === f.lvl) ? .3 : 0);
      const c = new G.Climber(hw, () => floor), seq = r.holds.map(i => hw[i]).filter(h => h.hand);
      const gear = q => {const at = G.faceAt(f, q.x, q.s);return {x: at.p.a + at.nrm.a * .05, y: at.p.y + at.nrm.y * .05, z: at.p.b + at.nrm.b * .05};};
      const style = r.kind;
      c.start(r, r.moon ? [hw[r.startHolds[0]]] : seq.filter(h => h.start), {style, anchor: r.anchor ? gear(r.anchor) : null, bolts: r.bolts.map(gear), chalk: true});
      const both = {L: true, R: true}, dt = .05;c.update(dt, {grip: both, stick: {x: 0, y: 0}});
      for (let step = 0; step < 120 && !c.sent && c.state === 'climb'; step++) {
        const [s, o] = ['L', 'R'].sort((p, q) => c.hands[p].hold.p.y - c.hands[q].hold.p.y);
        c.update(dt, {grip: {[s]: false, [o]: true}, stick: {x: 0, y: 0}});for (let k = 0; k < 4; k++) c.update(dt, {grip: {[s]: false, [o]: true}, clip: true, stick: {x: 0, y: 0}});
        if (c.state !== 'climb') break;
        const from = c.hands[o].hold, cand = seq.filter(h => h.p.y >= from.p.y - .02 && (h !== from || c.isTop(h)));
        let target = cand.filter(h => G.classify(c, s, h) === 'reach').sort((p, q) => q.p.y - p.p.y)[0];
        if (!target) {target = cand.filter(h => G.classify(c, s, h) === 'dyno').sort((p, q) => p.p.y - q.p.y)[0];if (!target) break;c.hands[s].hold = target;c.solveFeet();continue;}
        c.update(dt, {grip: both, aim: target, stick: {x: 0, y: 0}});
        if (style === 'lead' && c.isTop(c.hands[s].hold)) {c.update(dt, {grip: {[s]: false, [o]: true}, stick: {x: 0, y: -1}});for (let k = 0; k < 3; k++) c.update(dt, {grip: {[s]: false, [o]: true}, clip: true, stick: {x: 0, y: -1}});if (c.state === 'climb') c.update(dt, {grip: both, aim: target, stick: {x: 0, y: 0}});}
      }
      if (!c.sent) failed.push(`${id} ${r.face} ${r.name} ${c.msg}`);
      lvlY(0);
    }
    assert.deepEqual(failed, []);
  }
});

test('a day ticket is for one gym and one day; the brattkort is for every gym', () => {
  const mem = {};globalThis.localStorage = {getItem: k => mem[k] ?? null, setItem: (k, v) => {mem[k] = String(v);}};G.Store.reset();
  const tor = G.visitOf(G.Store.gym('torshov')), lok = G.visitOf(G.Store.gym('lokka'));
  G.payEntry(tor);G.Store.save();
  assert.equal(G.visitOf(G.Store.gym('torshov')).paid, true);assert.equal(G.visitOf(G.Store.gym('lokka')).paid, false, 'paying at Torshov is not a ticket for Løkka');
  lok.brattkort = '23.11.2026';assert.equal(G.Store.gym('torshov').brattkort, '23.11.2026', 'one brattkort');G.Store.save();
  const saved = JSON.parse(mem['haarklous-klatreverket-v1']);
  assert.equal(saved.brattkort, '23.11.2026');assert.equal(saved.gyms.lokka.brattkort, undefined, 'stored once');assert.equal(saved.paid, true, "Torshov's ticket stays where it was");
  delete globalThis.localStorage;G.Store.reset();
});

// Walk test: a flood fill of the walk world as game-main builds it (the room's floors and solids, the ground with the room's floor
// inside the building, the patch's buildings as solids), from the street in front of the door. Every grid point you can walk to
// in 0.5 m steps is a node; the reception and the foot of every line must be reached, and from each you must get back out.
test('walk from the street through the door to the reception and to every wall, and back out', () => {
  const WC = require('../walk-collision.js');
  for (const id of G.HALLS) {
    const {gym, p, hw} = hall(id), Y0 = gym.floorY;
    const near = p.patch.buildings.filter(b => b.ring.some(q => Math.hypot(q[0] - p.local.o[0], q[1] - p.local.o[1]) < 140));
    const solids = near.map(b => ({points: b.ring.map(([x, s]) => ({x, z: s})), minY: -1e3, maxY: 1e3, kind: 'building'}));
    const ground = {points: [{x: -5e3, z: -5e3}, {x: 5e3, z: -5e3}, {x: 5e3, z: 5e3}, {x: -5e3, z: 5e3}], height: q => gym.ground(q.x, q.z) ?? hw(q.x, q.z), ceilingHeight: Infinity};
    const world = WC.createWorld({floors: [...gym.floors, ground], obstacles: [...gym.obstacles, ...solids], radius: .18, clearance: .08});
    // The entrance slab meets the street.
    const ent = world.floors.find(f => /entrance/.test(f.name)), far = {x: (ent.points[2].x + ent.points[3].x) / 2, z: (ent.points[2].z + ent.points[3].z) / 2};
    assert.ok(Math.abs(ent.surface(far) - hw(far.x, far.z)) < .02, `${id}: the entrance slab meets the street`);
    const S = .5, A0 = -2, B0 = -5, nA = Math.ceil((gym.W_ + 4) / S), nB = Math.ceil((gym.D_ + 5) / S);
    const key = (i, j, y) => `${i},${j},${Math.round(y * 4)}`, nodes = new Map(), edges = new Map(), queue = [];
    const add = (i, j, y, pos) => {const k = key(i, j, y);if (!nodes.has(k)) {nodes.set(k, {i, j, y, pos});queue.push(k);}return k;};
    const start = add(Math.round((gym.aDoor - A0) / S), 0, hw(gym.W(A0 + Math.round((gym.aDoor - A0) / S) * S, B0).x, gym.W(A0 + Math.round((gym.aDoor - A0) / S) * S, B0).z));
    const step = (from, i, j) => {
      const t = gym.W(A0 + i * S, B0 + j * S), q = from.pos ? {...from.pos} : {...gym.W(A0 + from.i * S, B0 + from.j * S), feet: from.y};
      for (let k = 0; k < 12; k++) {const dx = t.x - q.x, dz = t.z - q.z, d = Math.hypot(dx, dz);if (d < .01) break;const s = Math.min(.1, d) / d, n = WC.move(world, q, {x: dx * s, z: dz * s}, 1.65, q.feet);q.x = n.x;q.z = n.z;q.feet = n.y;}
      return Math.hypot(t.x - q.x, t.z - q.z) < .05 ? q : null;
    };
    while (queue.length) {
      const k = queue.shift(), n = nodes.get(k);edges.set(k, []);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = n.i + di, j = n.j + dj;if (i < 0 || j < 0 || i > nA || j > nB) continue;
        const r = step(n, i, j);if (r === null) continue;edges.get(k).push(add(i, j, r.feet, r));
      }
    }
    // Back out: every node that can reach the start (reverse edges).
    const rev = new Map();for (const [k, list] of edges) for (const t of list) {if (!rev.has(t)) rev.set(t, []);rev.get(t).push(k);}
    const back = new Set([start]), q2 = [start];while (q2.length) {const k = q2.shift();for (const f of rev.get(k) || []) if (!back.has(f)) {back.add(f);q2.push(f);}}
    const reach = (pt, y, label, tol = .45) => {
      const f = gym.toFrame(pt.x, pt.z);let best = null;
      for (const [k, n] of nodes) {const d = Math.hypot(A0 + n.i * S - f.a, B0 + n.j * S - f.b);if (d < tol && Math.abs(n.y - y) < .45 && (!best || d < best.d)) best = {k, d};}
      assert.ok(best, `${id}: cannot walk to ${label} (a ${f.a.toFixed(1)}, b ${f.b.toFixed(1)}, ${(y - Y0).toFixed(1)} m up)`);
      assert.ok(back.has(best.k), `${id}: no way back out from ${label}`);
    };
    reach(gym.deskPoint, Y0, 'the reception');
    for (const r of gym.routes) {
      const f = gym.faces.get(r.face), x = r.lane ? (r.lane[0] + r.lane[1]) / 2 : f.W / 2, fr = G.faceAt(f, x, Math.min(f.L, 2.0)), off = (fr.p.a - f.p0[0]) * f.n.a + (fr.p.b - f.p0[1]) * f.n.b;
      const o = Math.max(.9, off + .55), a = f.p0[0] + f.dir.a * x + f.n.a * o, b = f.p0[1] + f.dir.b * x + f.n.b * o, y = Y0 + f.y0 + ((gym.spec.mats || []).some(m => m[0] === f.lvl && a > m[1] && a < m[2] && b > m[3] && b < m[4]) ? .3 : 0);
      reach(gym.W(a, b), y, `${r.zone} (${r.face}, ${r.name})`, .5);
    }
    // You stand on the floor of the right storey, and the gym knows you are inside.
    assert.ok(gym.zoneAt({...gym.deskPoint}, Y0), `${id}: the reception is in the gym`);
  }
});
