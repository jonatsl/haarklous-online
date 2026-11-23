// Oslo politihus, Oslo fengsel and the police cars (issue #140): the notches at the real buildings, the walls and gates, the
// cars' kerb places.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '..', 'gamle-oslo-data.js'));
const District = require(path.join(__dirname, '..', 'district.js'));
const Police = require(path.join(__dirname, '..', 'game-police.js'));
const inPoly = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};

let prepared = null;// the district with the notches (prepare() cuts them once)
test('the police station and the prison wing are cut into their real buildings, floors at the street', () => {
  const d = District.decode(window.DISTRICTS.find(x => x.name === 'gamle-oslo'));prepared = d;
  const before = {}, rings = {};for (const B of [Police.DATA.station, Police.DATA.prison]) {const b = d.buildings.find(x => x.id === B.osm);assert.ok(b, B.osm);rings[B.osm] = b.ring.slice();before[B.osm] = b.ring.length;}
  assert.strictEqual(Police.prepare([d], District), 2);
  for (const B of [Police.DATA.station, Police.DATA.prison]) {
    const b = d.buildings.find(x => x.id === B.osm), F = B.frame;
    assert.strictEqual(b.ring.length, before[B.osm] + 4, `${B.name}: the notch adds four corners`);
    assert.ok(Math.abs(F.D - B.depth) < 1e-9, `${B.name}: the full depth fits (${F.D})`);
    assert.ok(F.W > 20 && F.W < 26, `${B.name}: width ${F.W.toFixed(1)} m`);
    // The room lies in the old outline, the street in front of the door does not.
    for (const [a, bb] of [[.3, .3], [F.W - .3, .3], [F.W - .3, F.D - .3], [.3, F.D - .3], [F.W / 2, F.D / 2]]) assert.ok(inPoly(B.at(a, bb), rings[B.osm]), `${B.name}: (${a}, ${bb}) inside`);
    assert.ok(!inPoly(B.at(B.door, -1), rings[B.osm]), `${B.name}: the door opens to the outside`);
    // The ground under the room is now below the floor.
    for (let a = .5; a < F.W; a += 2) for (let bb = .5; bb < F.D; bb += 2) {const p = B.at(a, bb);assert.ok(District.height(d, p[0], p[1]) <= B.floorRel - .1, `${B.name}: ground under the floor at (${a}, ${bb})`);}
  }
  assert.strictEqual(d.buildings.find(x => x.id === 'w105350644').style, 'brick');
});

test('the prison walls stay in the patch, and the gates are open gaps in them', () => {
  const plan = Police.wallPlan();
  for (const w of Police.DATA.walls) for (const p of w.p) assert.ok(p[0] > -1600 && p[0] < 1792 && p[1] > 560 && p[1] < 4000);
  assert.strictEqual(plan.gates.length, 2);
  for (const g of plan.gates) {
    const near = plan.pieces.filter(q => Math.hypot((q.a[0] + q.b[0]) / 2 - g.c[0], (q.a[1] + q.b[1]) / 2 - g.c[1]) < 6);
    assert.ok(near.length >= 2, g.id);
    // No wall piece covers the gate's middle.
    for (const q of near) {const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), t = ((g.c[0] - q.a[0]) * q.u[0] + (g.c[1] - q.a[1]) * q.u[1]);assert.ok(t < -g.w / 2 + .01 || t > L + g.w / 2 - .01 || Math.abs(t) > g.w / 2 - .01 && Math.abs(t - L) > g.w / 2 - .01, g.id);}
    assert.ok(plan.pieces.every(q => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) <= 3.5 + 1e-6));
  }
  // The inner gate is a few metres inside the outer one (the way in from the footpath behind the police station).
  const [o, i] = plan.gates;assert.ok(Math.hypot(o.c[0] - i.c[0], o.c[1] - i.c[1]) < 8);
});

test('police car places: along the street, apart, nearest first, the game can refuse one', () => {
  const roads = [{k: 'residential', w: 8, p: [0, 0, 200, 0]}, {k: 'footway', w: 2.4, p: [0, 5, 200, 5]}];
  const a = Police.spots({roads, anchors: [{x: 100, s: 0, n: 4, reach: 60, gap: 6.5}]});
  assert.strictEqual(a.length, 4);
  for (const c of a) {assert.ok(Math.abs(Math.abs(c.s) - (4 - 1.05)) < 1e-9, 'on the kerb lane');assert.ok(Math.abs(Math.abs(c.heading) - Math.PI / 2) < 1e-9, 'along the street');}
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].s - a[j].s) >= 6.5);
  const b = Police.spots({roads, anchors: [{x: 100, s: 0, n: 2, reach: 60}], keep: [{x: 100, s: 0, r: 10}], ok: c => c.s > 0});
  assert.strictEqual(b.length, 2);assert.ok(b.every(c => c.s > 0 && Math.hypot(c.x - 100, c.s) >= 10));
  // Right-hand traffic: the car on the right of the way's direction points along it.
  assert.ok(b.every(c => Math.abs(c.heading - Math.atan2(-1, 0)) < 1e-9 || Math.abs(c.heading - Math.atan2(1, 0)) < 1e-9));
  assert.deepStrictEqual(Police.spots({roads, anchors: [{x: 100, s: 0, n: 4, reach: 60}]}), a, 'the same every time');
});

test('issue #158: you walk from the street into the police station and its cells, and into the prison wing, and back out', () => {
  // The walk world as game-main builds it here: the ground (the patch's terrain), the buildings as solids, the police floors and
  // solids, and the doors as dynamic solids (closed, or open as □ leaves them).
  const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;
  globalThis.document = {createElement: () => ({getContext: () => new Proxy({}, {get: () => () => {}})})};
  const WC = require('../walk-collision.js');
  const d = prepared || (() => {const x = District.decode(window.DISTRICTS.find(q => q.name === 'gamle-oslo'));Police.prepare([x], District);return x;})();
  window.SURROUNDINGS = {geo: {theta: 0, x: 0, z: 0}};
  const lib = new Proxy({mergeStatic() {}, boxUV() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
  const hw = (x, z) => District.height(d, x, z);
  const police = Police.create({T, lib, world: {toWorld: (x, s) => ({x, z: s}), toLocal: (x, z) => ({x, s: z}), heightWorld: hw}, audio: null, avatars: null});
  const ground = {points: [{x: -600, z: 2600}, {x: 0, z: 2600}, {x: 0, z: 3200}, {x: -600, z: 3200}], height: p => hw(p.x, p.z), ceilingHeight: Infinity};
  const solids = d.buildings.filter(b => Math.hypot(b.ring[0][0] + 300, b.ring[0][1] - 2900) < 250).map(b => ({points: b.ring.map(([x, s]) => ({x, z: s})), minY: -1e3, maxY: 1e3, kind: 'building'}));
  const world = WC.createWorld({floors: [...police.floors, ground], obstacles: [...police.obstacles, ...solids], radius: .18, clearance: .08});
  const leaf = (dr, t) => {
    if (dr.motion === 'slide') dr.hinge.position.x = dr.closedX + dr.travel * t;else dr.hinge.rotation.y = dr.openAngle * t;police.group.updateMatrixWorld(true);
    const m = dr.leaf, g = m.geometry.parameters, c = m.getWorldPosition(new T.Vector3());
    return {points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {const v = m.localToWorld(new T.Vector3(x * g.width / 2, 0, z * g.depth / 2));return {x: v.x, z: v.z};}), minY: c.y - g.height / 2, maxY: c.y + g.height / 2};
  };
  const open = ids => WC.setDynamic(world, police.doors.map(dr => leaf(dr, ids.includes(dr.id) ? 1 : 0)));
  // The entrance slabs end on the street (walk floors join only within 5 cm; issue #158: they ended 0.5 m above it).
  for (const f of world.floors.filter(q => /entrance/.test(q.name))) {const far = {x: (f.points[2].x + f.points[3].x) / 2, z: (f.points[2].z + f.points[3].z) / 2};assert.ok(Math.abs(f.surface(far) - hw(far.x, far.z)) < .02, `${f.name} meets the street`);}
  const S = Police.DATA.station, Pr = Police.DATA.prison, frS = police.frames.find(f => f.B === S), frP = police.frames.find(f => f.B === Pr);
  let p = null;
  const go = (t, label, stuck) => {
    for (let i = 0; i < 4000; i++) {const dx = t[0] - p.x, dz = t[1] - p.z, dd = Math.hypot(dx, dz);if (dd < .01) break;const s = Math.min(.1, dd) / dd, n = WC.move(world, p, {x: dx * s, z: dz * s}, 1.65, p.feet);p.x = n.x;p.z = n.z;p.feet = n.y;}
    const ok = Math.hypot(t[0] - p.x, t[1] - p.z) < .05;assert.ok(stuck ? !ok : ok, `${label}: ${stuck ? 'not stopped' : 'stuck'} at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
  };
  const route = (B, list) => list.forEach(([a, b]) => go(B.at(a, b), `${B.name} (${a}, ${b})`));
  const floorOf = fr => Math.abs(p.feet - fr.floorY) < .03 && police.inside(p.x, p.z, p.feet);
  // The police station: from the footway on Grønlandsleiret, down the gap between the low front buildings, along the service road
  // to the glass doors, into the reception; the steel door stops you until it is open; the corridor and glattcelle 1.
  const street = S.at(-6.5, -50);p = {x: street[0], z: street[1], feet: hw(...street)};
  open([]);
  const inS = [[-6.5, -4], [7, -4], [7, -1], [7, 1.5]];route(S, inS);assert.ok(floorOf(frS), 'in the reception');
  route(S, [[7, 3], [13, 4.95]]);go(S.at(14.5, 5.1), 'the closed steel door', true);
  open(['politi-arrest', 'politi-celle-1']);
  const toCell = [[13, 4.95], [14.5, 5.1], [15.5, 5.3], [15.5, 2]];route(S, toCell);assert.ok(floorOf(frS), 'in glattcelle 1');
  route(S, [...toCell.slice(0, -1).reverse(), [7, 3], ...inS.slice(0, -1).reverse(), [-6.5, -50]]);assert.ok(Math.abs(p.feet - hw(p.x, p.z)) < .02, 'back on the street');
  // The prison: round the west end of the police station to the footway behind it, the outer gate (stops you while closed), the
  // inner gate, across the yard to the door of wing A, the hall, the corridor and cell 1, and the same way back.
  const outside = [[-306.6, 2797.6], [-386.6, 2781.1], [-430.1, 2821.1], [-430.1, 2823.1], [-428.1, 2829.1], [-373.6, 2865.1], [-268.6, 2895.6]];
  p = {x: outside[0][0], z: outside[0][1], feet: hw(...outside[0])};
  outside.forEach((t, i) => go(t, `outside ${i}`));
  go([-268.6, 2898.6], 'the closed outer gate', true);go([-268.6, 2895.6], 'back from the gate');
  open(['fengsel-port-ytre', 'fengsel-port-indre', 'fengsel-dor', 'fengsel-celle-1']);
  go([-268.6, 2898.6], 'the outer gate');go(Pr.at(Pr.door, -1.5), 'across the yard');
  const inP = [[Pr.door, -1], [Pr.door, 1], [1.7, 3.6], [2.5, 4.95], [5.5, 5.4], [4.85, 4.6], [4.85, 2]];route(Pr, inP);assert.ok(floorOf(frP), 'in cell 1 of wing A');
  route(Pr, [...inP.slice(0, -1).reverse(), [Pr.door, -1.5]]);go([-268.6, 2898.6], 'back through the gates');
  outside.slice().reverse().forEach((t, i) => go(t, `back outside ${i}`));assert.ok(Math.abs(p.feet - hw(p.x, p.z)) < .02, 'back on the street');
});
