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

test('the police station and the prison wing are cut into their real buildings, floors at the street', () => {
  const d = District.decode(window.DISTRICTS.find(x => x.name === 'gamle-oslo'));
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
