// Construction City (issue #85): the measured building (outline, floors per wing), and its inside walked with the game's own
// collision code: street -> main door -> the hall's stair -> the galleries -> a wing -> its core stair down to the garage ->
// up the car ramp to the street; the lifts, the garage's ground for cars, the ground cut and the new patches' walkable corner.
const test = require('node:test');
const assert = require('node:assert');
const D = require('../construction-city-data.js');
const CC = require('../game-construction-city.js');
const WC = require('../walk-collision.js');
require('../surroundings.js');
const Surroundings = globalThis.Surroundings;

const OFF = -94.855, GROUND = 97.0 + OFF;
const toWorld = (x, s) => ({x, z: s});
const L = CC.layout(D, {toWorld, ground: () => GROUND, offset: OFF});
const H = k => D.H[String(k)] + OFF;
// The street round the building: one terrain floor whose ground is cut where the building draws its own (as in game-main).
const terrain = {points: [{x: 1600, z: 1200}, {x: 2100, z: 1200}, {x: 2100, z: 1650}, {x: 1600, z: 1650}], height: p => L.cutsGround(p.x, p.z) ? -1e4 : GROUND};
const world = WC.createWorld({floors: [...L.floors, terrain], obstacles: L.obstacles, radius: .18, clearance: .08});
const EYE = 1.6;
function walk(from, path, y0) {
  let p = {x: from[0], z: from[1]}, y = y0;
  assert.ok(WC.canStand(world, p, EYE, y), `cannot stand at the start ${from} (${y.toFixed(2)})`);
  for (const [x, z, want] of path) {
    for (let i = 0; i < 4000; i++) {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);if (d < .05) break;
      const st = Math.min(.1, d), r = WC.move(world, p, {x: dx / d * st, z: dz / d * st}, EYE, y);
      if (Math.hypot(r.x - p.x, r.z - p.z) < 1e-4) assert.fail(`stuck at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} (y ${y.toFixed(2)}) on the way to ${x.toFixed(2)}, ${z.toFixed(2)}`);
      p = {x: r.x, z: r.z};y = r.y;
    }
    if (want !== undefined) assert.ok(Math.abs(y - want) < .06, `at ${x.toFixed(1)}, ${z.toFixed(1)} the feet are at ${y.toFixed(2)}, want ${want.toFixed(2)}`);
  }
  return {p, y};
}
const hall = D.hall, hf = (a, b) => [hall.o[0] + hall.u[0] * a - hall.u[1] * b, hall.o[1] + hall.u[1] * a + hall.u[0] * b];
const core = i => {const c = D.cores[i], v = [-c.u[1], c.u[0]];return (a, b) => [c.o[0] + c.u[0] * a + v[0] * b, c.o[1] + c.u[1] * a + v[1] * b];};

test('the outline and the floors per wing are the measured ones', () => {
  assert.strictEqual(D.osm.id, 1333507389);assert.strictEqual(D.ring.length, 29);
  const floors = Object.fromEntries(D.blocks.map(b => [b.name, b.floors]));
  assert.deepStrictEqual(floors, {NW: 9, W: 10, SW: 11, hall: 9, E: 8, S: 9});
  // each block's roof (floor count + parapet) within 0.4 m of Kartverket's surface model
  for (const b of D.blocks) if (b.name !== 'hall') {const roof = D.H[String(b.floors + 1)] + D.levels.parapet;assert.ok(Math.abs(roof - b.roofMeasured) < .4, `${b.name}: ${roof} vs ${b.roofMeasured}`);}
  assert.ok(Math.abs(D.H['10'] - D.levels.L1 - 34.5) < .01, 'the hall is about 35 m high');
  assert.strictEqual(D.H['-1'], 90.5);assert.strictEqual(D.H['0'], 93.9);
});

test('every floor is a simple polygon, and the floors of a level do not overlap', () => {
  const area = p => p.reduce((s, q, i) => {const r = p[(i + 1) % p.length];return s + q[0] * r[1] - r[0] * q[1];}, 0) / 2;
  for (const f of D.floors) assert.ok(f.p.length >= 3 && Math.abs(area(f.p)) > .2, `${f.use} at ${f.k}`);
  // sample points: no point of a level lies in two floors at the same height
  const byK = new Map();for (const f of D.floors) {const key = `${f.k}|${f.h}`;if (!byK.has(key)) byK.set(key, []);byK.get(key).push(f);}
  const inR = (x, s, p) => {let r = false;for (let i = 0, j = p.length - 1; i < p.length; j = i++) {const a = p[i], b = p[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
  for (const list of byK.values()) for (let x = 1775; x < 1960; x += 3.7) for (let s = 1340; s < 1458; s += 3.3) assert.ok(list.filter(f => inR(x, s, f.p)).length <= 1, `two floors at ${x}, ${s}`);
});

test('from the street through the main door, up the hall stair to the 9th floor gallery', () => {
  const main = D.aprons.find(a => a.kind === 'main'), out = [main.a[0] + main.n[0] * 8, main.a[1] + main.n[1] * 8], door = [main.a[0] - main.n[0] * 3, main.a[1] - main.n[1] * 3];
  let r = walk(out, [[...main.a.map((v, i) => v + main.n[i] * .2)], [...door, H(1)]], GROUND);
  const [S0, SL, RUN] = hall.stair;
  r = walk([r.p.x, r.p.z], [[...hf(S0 + 1, 7.6), H(1)]], r.y);
  for (let k = 1; k <= 8; k++) {
    r = walk([r.p.x, r.p.z], [[...hf(S0 + SL + RUN + 1, 7.6)], [...hf(S0 + SL + RUN + 1, 5.5)], [...hf(S0 + 1, 5.5), H(k + 1)], [...hf(S0 + 1, 2.2), H(k + 1)]], r.y);
    if (k < 8) r = walk([r.p.x, r.p.z], [[...hf(S0 + 1, 7.6), H(k + 1)]], r.y);
  }
  assert.ok(Math.abs(r.y - H(9)) < .06);
  // along the gallery into the north-west wing's 9th floor
  r = walk([r.p.x, r.p.z], [[...hf(2, 2.2), H(9)], [...hf(-4, 2.2), H(9)]], r.y);
  assert.match(L.placeName(r.p.x, r.p.z, r.y), /9th floor, north-west wing/);
});

test('a core stair from the 9th floor down to P2, and up to the roof terrace', () => {
  const at = core(0);// the north-west wing's core
  let r = walk(at(-2, 1.25), [[...at(.9, 1.25), H(9)]], H(9));
  for (let k = 9; k > -1; k--) r = walk([r.p.x, r.p.z], [[...at(.9, 3.8)], [...at(6.0, 3.8)], [...at(6.0, 1.3)], [...at(.9, 1.3), H(k - 1)]], r.y);
  assert.ok(Math.abs(r.y - H(-1)) < .06);
  assert.match(L.placeName(...at(-2, 1.25), H(-1)), /garage P2/);
  r = walk([r.p.x, r.p.z], [[...at(-2.5, 1.25), H(-1)]], r.y);
  // and back up to the 10th floor, out onto the terrace
  r = walk([r.p.x, r.p.z], [[...at(.9, 1.25), H(-1)]], r.y);
  for (let k = -1; k < 10; k++) r = walk([r.p.x, r.p.z], [[...at(2.0, 1.3)], [...at(6.0, 1.3)], [...at(6.0, 3.8)], [...at(.9, 3.8), H(k + 1)], [...at(.9, 1.3)]], r.y);
  r = walk([r.p.x, r.p.z], [[...at(-3, 1.25), H(10)]], r.y);
  assert.match(L.placeName(r.p.x, r.p.z, r.y), /roof terrace/);
});

test('on foot from P1 up the car ramp to the street', () => {
  const pr = D.portal, len = Math.hypot(pr.b[0] - pr.a[0], pr.b[1] - pr.a[1]), u = [(pr.b[0] - pr.a[0]) / len, (pr.b[1] - pr.a[1]) / len];
  const start = [pr.b[0] + u[0] * 3, pr.b[1] + u[1] * 3];
  const r = walk(start, [[...pr.b, H(0)], [pr.a[0] + u[0] * 1, pr.a[1] + u[1] * 1], [pr.a[0] - u[0] * 3, pr.a[1] - u[1] * 3, GROUND]], H(0));
  assert.ok(Math.abs(r.y - GROUND) < .06);
});

test('cars: the ramp from the street to P1 and on to P2 has no steps, and the street next to the walls is the street', () => {
  const pr = D.portal, A = pr.a, B = pr.b;
  let y = GROUND, prev = GROUND;
  for (let t = .002; t <= 1.0001; t += .01) {
    const x = A[0] + (B[0] - A[0]) * t, s = A[1] + (B[1] - A[1]) * t, g = L.vehicleGround(x, s, y);
    assert.ok(g !== null, `no ground at t ${t}`);assert.ok(Math.abs(g - prev) < .3, `a step of ${(g - prev).toFixed(2)} m at t ${t.toFixed(2)}`);prev = y = g;
  }
  assert.ok(Math.abs(y - H(0)) < .06, `ends at ${y}`);
  const rampB = D.slopes.find(s => s.kind === 'car');
  for (let t = 0; t <= 1.0001; t += .02) {
    const x = rampB.a[0] + (rampB.b[0] - rampB.a[0]) * t, s = rampB.a[1] + (rampB.b[1] - rampB.a[1]) * t, g = L.vehicleGround(x, s, y);
    assert.ok(g !== null && Math.abs(g - y) < .3, `ramp to P2 at t ${t}`);y = g;
  }
  assert.ok(Math.abs(y - H(-1)) < .02);
  // a car on the street beside the building is not pulled into the garage below
  const n = D.facade[1].n, a = D.ring[1], b = D.ring[2], m = [(a[0] + b[0]) / 2 - n[0] * .3, (a[1] + b[1]) / 2 - n[1] * .3];
  assert.strictEqual(L.vehicleGround(m[0], m[1], GROUND), null);
  assert.strictEqual(L.vehicleGround(1700, 1300, GROUND), null);
});

test('eight cars to drive, and every core has a lift from P2 to its top floor', () => {
  assert.strictEqual(L.driveSpots.length, 8);
  assert.deepStrictEqual(L.driveSpots.map(s => s.k).sort(), [-1, -1, -1, -1, 0, 0, 0, 0]);
  assert.strictEqual(L.lifts.length, 6);
  for (const l of L.lifts) {
    const c = l.cab.reduce((s, p) => ({x: s.x + p.x / l.cab.length, z: s.z + p.z / l.cab.length}), {x: 0, z: 0});
    for (const k of l.levels) {const at = L.liftAt(c.x, c.z, l.y(k));assert.ok(at && at.k === k, `lift ${l.i} at ${k}`);assert.ok(WC.canStand(world, c, EYE, l.y(k)), `stand in lift ${l.i} at ${k}`);}
    assert.strictEqual(l.levels[0], -1);
  }
  assert.strictEqual(CC.liftNote('SW', 10), 'sky bar and boardroom');
});

test('the ground is cut under the building and its aprons, and the patches drop their own block', () => {
  assert.ok(L.cutsGround(1860, 1390));assert.ok(!L.cutsGround(1860, 1320));
  for (const a of D.aprons) assert.ok(L.cutsGround(a.a[0] + a.n[0] * 1, a.a[1] + a.n[1] * 1));
  const d = {x0: 1792, s0: -400, x1: 2304, s1: 1648, buildings: [{id: 'w1333507389'}, {id: 'w1'}]}, far = {x0: 0, s0: 0, x1: 500, s1: 500, buildings: [{id: 'w2'}]};
  CC.prepare([d, far], D);
  assert.deepStrictEqual(d.buildings.map(b => b.id), ['w1']);assert.ok(d.cuts.length >= 7);assert.strictEqual(far.cuts, undefined);
});

test('the three patches round Construction City leave no unwalkable corner', () => {
  const box = (name, x0, s0, x1, s1) => ({name, x0, s0, x1, s1, play: {x0: x0 + 40, s0: s0 + 40, x1: x1 - 40, s1: s1 - 40}});
  const rects = Surroundings.walkRects(800, 760, [box('gamle-oslo', -1600, 560, 1792, 4000), box('loren', 720, -400, 1792, 560), box('okern', 1792, -400, 2304, 1648)]);
  const walkable = (x, s) => rects.some(r => x >= r.x0 && x <= r.x1 && s >= r.s0 && s <= r.s1);
  for (const [x, s] of [[1790, 560], [1760, 530], [1825, 590], [780, 0], [1792, 1000], [1300, 560], [1860, 1500]]) assert.ok(walkable(x, s), `${x}, ${s}`);
  assert.ok(rects.some(r => /^Corner/.test(r.name)));
});
