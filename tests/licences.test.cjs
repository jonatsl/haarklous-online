// Licences (issue #59): which licence each vehicle needs, the theory parts, the saved state, the courses and the practical part.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const L = require('../game-licences.js');
const P = require('../game-progress.js');
const B = require('../game-badges.js');

test('every vehicle in the game needs the right licence; bikes, e-scooters, the kayak and passengers need none', () => {
  const want = {car: 'B', motorcycle: 'A', tipper: 'C', excavator: 'M', excavator30: 'M', dozer: 'M', loader: 'M', hauler: 'M', crane: 'G', tower: 'G',
    plane: 'PPLA', jumpplane: 'PPLA', helicopter: 'PPLH', drone: 'A1A3'};
  for (const [kind, id] of Object.entries(want)) assert.equal(L.need({kind}), id, kind);
  assert.equal(L.need({kind: 'bicycle', rental: 'bike'}), null);
  assert.equal(L.need({kind: 'bicycle', rental: 'ebike'}), null);
  assert.equal(L.need({kind: 'scooter', rental: 'scooter'}), null);
  assert.equal(L.need({kind: 'kayak'}), null);
  assert.equal(L.need({kind: 'hovercraft'}), 'B', 'a new kind of vehicle is never left open by mistake');
  for (const id of new Set(Object.values(want))) assert.ok(L.byId[id], id);
});

test('each licence has a place, fees and five real questions; at most one wrong answer passes', () => {
  assert.equal(L.IDS.length, 8);
  for (const l of L.LICENCES) {
    assert.ok(L.PLACES[l.place], `${l.id} place`);
    assert.ok(l.fee.theory >= 0 && l.fee.practical >= 0 && l.name && l.tag && l.icon && l.covers, l.id);
    assert.equal(l.quiz.length, 5, l.id);
    for (const q of l.quiz) assert.ok(q.q.length > 10 && q.a.length === 3 && q.ok >= 0 && q.ok < 3, `${l.id}: ${q.q}`);
    assert.ok(l.theoryOnly || L.COURSES[l.course], `${l.id} course`);
    const right = l.quiz.map(q => q.ok), oneWrong = right.map((a, i) => i === 0 ? (a + 1) % 3 : a), twoWrong = oneWrong.map((a, i) => i === 1 ? (a + 1) % 3 : a);
    assert.equal(L.passed(l, right), true);assert.equal(L.passed(l, oneWrong), true);assert.equal(L.passed(l, twoWrong), false, l.id);
  }
  assert.equal(L.byId.A1A3.fee.theory, 0, 'the drone test is free, as at Luftfartstilsynet');
  assert.deepEqual(L.byId.C.requires, ['B'], 'class C needs class B first');
  assert.equal(L.score(L.byId.B.quiz, [1, 0, 1, 2, 1]).right, 5);
});

test('the saved state: licences, passed theory parts and what is still needed first', () => {
  const s = L.load('{"have": {"B": "2026-11-03", "X": "1"}, "theory": {"C": "2026-11-03"}, "fails": {"C": 2}}');
  assert.deepEqual(s.have, {B: '2026-11-03'}, 'unknown ids are dropped');
  assert.equal(L.has(s, 'B'), true);assert.equal(L.has(s, 'C'), false);
  assert.deepEqual(L.missing(L.load(''), 'C'), ['B']);assert.deepEqual(L.missing(s, 'C'), []);
  L.grant(s, 'PPLH', '2026-11-04');assert.equal(s.have.PPLH, '2026-11-04');assert.equal(s.theory.PPLH, '2026-11-04');
  L.passTheory(s, 'A', '2026-11-05');assert.equal(L.has(s, 'A'), false);assert.equal(s.theory.A, '2026-11-05');
  assert.deepEqual(L.load('not json'), {have: {}, theory: {}, fails: {}});
});

test('licences are saved progress: the server accepts the key, and two copies join without losing a licence', async () => {
  const K = 'haarklous-licences-v1';
  assert.equal(L.KEY, K);assert.ok(P.KEYS.includes(K));
  assert.equal(P.hasProgress({[K]: '{"have": {}, "theory": {}, "fails": {}}'}), false, 'an empty licence list is a fresh start');
  assert.equal(P.hasProgress({[K]: '{"have": {"B": "2026-11-03"}}'}), true);
  const account = {[K]: JSON.stringify({have: {B: '2026-11-04'}, theory: {B: '2026-11-04'}, fails: {A: 1}})};
  const browser = {[K]: JSON.stringify({have: {B: '2026-11-01', PPLA: '2026-11-02'}, theory: {M: '2026-11-02'}, fails: {A: 3}})};
  for (const mode of ['move', 'sync']) {
    const m = JSON.parse(P.merge(account, browser, {}, mode)[K]);
    assert.deepEqual(m.have, {B: '2026-11-01', PPLA: '2026-11-02'}, mode);assert.equal(m.theory.M, '2026-11-02');assert.equal(m.fails.A, 3);
  }
  const rules = await import(pathToFileURL(path.join(__dirname, '../cloud/src/progress-check.js')).href);
  const all = Object.fromEntries(P.KEYS.map(k => [k, '{}']));
  assert.equal(rules.checkSave({set: all, del: []}), null, 'the server accepts every progress key');
  const big = JSON.stringify({have: Object.fromEntries(L.IDS.map(id => [id, '2026-11-03'])), theory: Object.fromEntries(L.IDS.map(id => [id, '2026-11-03'])), fails: Object.fromEntries(L.IDS.map(id => [id, 99]))});
  assert.equal(rules.checkSave({set: {[K]: big}}), null);assert.deepEqual(rules.saveParts({set: {[K]: big}}).set, [[K, big]]);
  assert.ok(rules.checkSave({set: {'Haarklous-Licences': '{}'}}), 'a bad key is still refused');
});

test('badges for the first licence and for all of them', () => {
  const f = have => ({records: {}, gym: {}, kayak: {}, route: {}, got: {}, lic: {have}});
  const first = B.BADGES.find(b => b.id === 'licence'), all = B.BADGES.find(b => b.id === 'licences');
  assert.ok(first && all);
  assert.equal(first.test(f({})), false);assert.equal(first.test(f({A1A3: '2026-11-03'})), true);
  assert.equal(all.test(f({B: 1, A: 1})), false);assert.equal(all.test(f(Object.fromEntries(L.IDS.map(id => [id, 1])))), true);
  assert.equal(B.LICENCE_COUNT, L.IDS.length);
});

// A flat world: local x, s are world x, z; the ground is at 0 (or a slope).
const flat = {toWorld: (x, s) => ({x, z: s}), groundAt: () => 0};

test('courses resolve to world gates in their frames; the road rings follow the real streets', () => {
  const road = L.resolve(L.COURSES.road, flat);
  assert.equal(road.length, 20);assert.equal(road.at(-1).k, 'stop');
  assert.equal(road[0].y, road[0].r + .3, 'a ground ring stands on the road');
  let len = Math.hypot(road[0].x - L.COURSES.road.start[0], road[0].z - L.COURSES.road.start[1]);
  for (let i = 1; i < road.length; i++) {const d = Math.hypot(road[i].x - road[i - 1].x, road[i].z - road[i - 1].z);assert.ok(d > 5 && d < 60, `ring ${i} is ${d.toFixed(0)} m from the one before`);len += d;}
  assert.ok(len > 650 && len < 800, `about 710 m (${len.toFixed(0)})`);
  // The runway frame: along the heading of the origin, to its right, height above the origin's ground.
  const c = L.resolve(L.COURSES.circuit, {toWorld: flat.toWorld, groundAt: (x, z) => z * .01, origin: {x: 10, z: 20, yaw: 0}});
  assert.ok(Math.abs(c[0].x - 10) < 1e-9 && Math.abs(c[0].z - (20 - 450)) < 1e-9, 'yaw 0 heads -z');
  assert.ok(Math.abs(c[0].y - (20 * .01 + 30)) < 1e-9, 'height over the strip, not over the ground below');
  assert.ok(Math.abs(c[1].x - (10 - 250)) < 1e-9, 'right is +x when heading -z, so -250 is to the left');
  const land = c.at(-1);assert.equal(land.k, 'land');assert.ok(L.inside(land, {x: 10, z: 20 - 280}) && !L.inside(land, {x: 10, z: 20 + 10}) && !L.inside(land, {x: 40, z: 20 - 150}));
  const h = L.resolve(L.COURSES.heli, {...flat, origin: {x: 26, z: 14, yaw: .6}});
  assert.equal(h[0].x, 26);assert.equal(h[0].y, 3);assert.equal(h[1].x, 26 - 40);
});

test('the site courses stay inside the site fence, and the crane marks are within the tower crane’s reach', () => {
  const fence = {x0: -158, s0: 371, x1: -18, s1: 461}, tower = [-118, 408];
  for (const name of ['siteM', 'siteC', 'crane']) for (const g of L.COURSES[name].gates) {
    const [x, s] = g.p;assert.ok(x > fence.x0 + 5 && x < fence.x1 - 5 && s > fence.s0 + 5 && s < fence.s1 - 5, `${name} ${x},${s}`);
  }
  for (const g of L.COURSES.crane.gates) {const d = Math.hypot(g.p[0] - tower[0], g.p[1] - tower[1]);assert.ok(d > 3.5 && d < 38.5, `${d}`);}
});

// Drive a point along the gates at a steady speed; each step 0.05 s.
function drive(run, gates, {speed = 8, from, extra = () => ({}), stopAtEnd = true} = {}) {
  let p = {...(from || {x: gates[0].x - 30, y: 0, z: gates[0].z})};
  for (let i = 0; i < 20000 && run.state === 'run'; i++) {
    const g = run.gate, dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz), last = run.i === gates.length - 1;
    let v = speed;if (last && stopAtEnd) v = Math.max(0, Math.min(speed, (d - 1) * 1.5));
    const st = Math.min(d, v * .05);if (d > 1e-6) {p.x += dx / d * st;p.z += dz / d * st;}
    run.step({dt: .05, x: p.x, y: 0, z: p.z, speed: v, agl: 0, grounded: true, inVehicle: true, ...extra(p, i)});
  }
  return run;
}

test('the driving test: rings in order, the speed limit, crashes, the time limit and getting out', () => {
  const gates = L.resolve(L.COURSES.road, flat), start = {x: -639.1, y: 0, z: 37.4};
  const ok = drive(new L.Practical(L.COURSES.road, gates), gates, {from: start});
  assert.equal(ok.state, 'passed');assert.ok(ok.t > 60 && ok.t < 240, `${ok.t.toFixed(0)} s at 29 km/h`);
  const fast = drive(new L.Practical(L.COURSES.road, gates), gates, {from: start, speed: 13});
  assert.equal(fast.state, 'failed');assert.equal(fast.why, 'speed');assert.match(L.failText(fast), /47 km\/h where the limit is 30/);
  // 44 km/h is fine on Vogts gate (40, plus the 5 km/h margin), too fast in the 30 zone: the run fails on the way to ring 1.
  assert.equal(drive(new L.Practical(L.COURSES.road, gates), gates, {from: start, speed: 12.2}).why, 'speed');
  // A short burst over the limit (under 2 s) is let off.
  const burst = drive(new L.Practical(L.COURSES.road, gates), gates, {from: start, extra: (p, i) => i > 40 && i < 70 ? {speed: 11} : {}});
  assert.equal(burst.state, 'passed');
  const crash = new L.Practical(L.COURSES.road, gates);crash.step({dt: .05, speed: 8, inVehicle: true, x: 0, z: 0});crash.step({dt: .05, speed: 0, inVehicle: true, x: 0, z: 0});
  assert.equal(crash.why, 'crash');
  const braking = new L.Practical(L.COURSES.road, gates);let v = 8;while (v > 0) {braking.step({dt: .05, speed: v, inVehicle: true, x: 0, z: 0});v = Math.max(0, v - .5);}
  assert.equal(braking.state, 'run', 'hard braking (10 m/s²) is not a crash');
  const slow = drive(new L.Practical(L.COURSES.road, gates), gates, {from: start, speed: 2.5});
  assert.equal(slow.why, 'time');assert.match(L.failText(slow), /4:00/);
  const out = new L.Practical(L.COURSES.road, gates);out.step({dt: .05, speed: 0, inVehicle: false, x: 0, z: 0});assert.equal(out.why, 'left');
  // The end: only stopping inside the green ring passes.
  const park = new L.Practical(L.COURSES.road, gates);park.i = gates.length - 1;const g = gates.at(-1);
  park.step({dt: .05, speed: 1.2, inVehicle: true, x: g.x, z: g.z});assert.equal(park.state, 'run', 'rolling through');
  park.step({dt: .05, speed: .1, inVehicle: true, x: g.x + 6, z: g.z});assert.equal(park.state, 'run', 'stopped outside');
  park.step({dt: .05, speed: .1, inVehicle: true, x: g.x + 1, z: g.z});assert.equal(park.state, 'passed');
});

test('flying tests: rings in the air, the height limit, landing on the strip or outside it, hovering and crashing', () => {
  const O = {x: 0, z: 0, yaw: 0}, gates = L.resolve(L.COURSES.circuit, {...flat, origin: O});
  const fly = () => new L.Practical(L.COURSES.circuit, gates);
  const air = (run, p, more = {}) => run.step({dt: .05, x: p.x, y: p.y, z: p.z, speed: 35, agl: p.y, grounded: false, inVehicle: true, ...more});
  const r = fly();for (const g of gates.slice(0, -1)) {air(r, {x: g.x, y: g.y + g.r * .9, z: g.z});}
  assert.equal(r.i, gates.length - 1, 'all eight rings');
  const land = gates.at(-1);r.step({dt: .05, x: land.x, y: 0, z: land.z - 60, speed: .5, agl: 0, grounded: true, inVehicle: true});assert.equal(r.state, 'passed');
  const miss = fly();air(miss, {x: gates[0].x, y: gates[0].y + gates[0].r + 1, z: gates[0].z});assert.equal(miss.i, 0, 'just above the ring is a miss');
  const outside = fly();outside.i = gates.length - 1;air(outside, {x: 0, y: 50, z: 0});outside.step({dt: .05, x: 80, y: 0, z: -150, speed: .2, agl: 0, grounded: true, inVehicle: true});
  assert.equal(outside.why, 'outside');
  const high = fly();for (let i = 0; i < 80; i++) air(high, {x: 0, y: 250, z: 0}, {agl: 250});assert.equal(high.why, 'high');
  const crash = fly();crash.step({dt: .05, x: 0, y: 0, z: 0, speed: 0, grounded: true, crashed: true, inVehicle: true});assert.equal(crash.why, 'crash');
  assert.equal(L.failText(crash), 'You crashed.');
  // The helicopter's hover: 5 s inside the ring, slowly; drifting out starts the count again.
  const hg = L.resolve(L.COURSES.heli, {...flat, origin: {x: 0, z: 0, yaw: 0}}), h = new L.Practical(L.COURSES.heli, hg);
  for (let i = 0; i < 60; i++) h.step({dt: .05, x: 0, y: 3, z: 0, speed: .4, agl: 3, inVehicle: true});
  h.step({dt: .05, x: 9, y: 3, z: 0, speed: .4, agl: 3, inVehicle: true});
  for (let i = 0; i < 90; i++) h.step({dt: .05, x: 0, y: 3.5, z: 0, speed: .4, agl: 3.5, inVehicle: true});
  assert.equal(h.i, 0, '3 s, out, 4.5 s: not yet');
  for (let i = 0; i < 12; i++) h.step({dt: .05, x: 0, y: 3.5, z: 0, speed: .4, agl: 3.5, inVehicle: true});
  assert.equal(h.i, 1, 'then 5 s in a row');
});

test('the crane test: hook a load, carry it through the ring, set it down on the mark', () => {
  const gates = L.resolve(L.COURSES.crane, flat), [hook, ring, mark] = gates;
  const run = () => new L.Practical(L.COURSES.crane, gates), s = (p, more = {}) => ({dt: .05, speed: 0, inVehicle: true, x: 0, y: 0, z: 0, point: p, ...more});
  const ok = run();ok.step(s({x: hook.x, y: 2, z: hook.z}, {loaded: true}));ok.step(s({x: ring.x, y: ring.y + 1, z: ring.z}, {loaded: true}));
  assert.equal(ok.i, 2);ok.step(s({x: mark.x, y: 1, z: mark.z}, {dropped: {x: mark.x + 1, z: mark.z}}));assert.equal(ok.state, 'passed');
  const early = run();early.step(s({x: hook.x, y: 2, z: hook.z}, {loaded: true}));early.step(s({x: hook.x, y: 2, z: hook.z}, {dropped: {x: hook.x, z: hook.z}}));
  assert.equal(early.why, 'drop', 'setting it down before the ring');
  const off = run();off.i = 2;off.hooked = true;off.step(s({x: 0, y: 0, z: 0}, {dropped: {x: mark.x + 3, z: mark.z}}));assert.equal(off.why, 'drop');
  assert.match(L.failText(off), /outside the green mark/);
});
