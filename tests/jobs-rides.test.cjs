// Jobs (issue #56) and e-scooters / city bikes (issue #57): prices, docks, scooter places, delivery pay, the taxi passenger's
// mood and tip, and the generated data (real docks, doors and food places outside buildings and off the streets).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.window = globalThis;
require('../surroundings-data.js');
require('../gamle-oslo-data.js');
require('../myrens-data.js');
require('../rides-data.js');
require('../jobs-data.js');
const District = require(path.join(__dirname, '..', 'district.js'));
const R = require('../game-rentals.js'), J = require('../game-jobs.js');
const D = window.SURROUNDINGS, RIDES = window.RIDES, JOBS = window.JOBS, DISTRICTS = window.DISTRICTS.map(d => District.decode(d));

const pairs = f => {const o = [];for (let i = 0; i + 1 < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const inside = (p, ring) => {let c = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;}return c;};
const segDist = (p, a, b) => {const dx = b[0] - a[0], ds = b[1] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / L));return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - ds * t);};
const rings = [...D.buildings.map(b => pairs(b.r.o)), ...DISTRICTS.flatMap(d => d.buildings.map(b => b.ring))];
const inBuilding = p => rings.some(r => inside(p, r));
const CAR = ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service', 'trunk'];
const carRoads = [...D.roads, ...DISTRICTS.flatMap(d => d.roads)].filter(r => CAR.includes(r.k));
const onCarriageway = p => carRoads.some(r => {for (let i = 0; i + 3 < r.p.length; i += 2) if (segDist(p, [r.p[i], r.p[i + 1]], [r.p[i + 2], r.p[i + 3]]) < r.w / 2 - .25) return true;return false;});

test('city bike trips cost the real Oslo Bysykkel prices: 8 kr, then 1 kr (e-bike 2 kr) for every started minute after the first', () => {
  assert.equal(R.tripCost('bike', 0), 8);assert.equal(R.tripCost('bike', 59), 8);
  assert.equal(R.tripCost('bike', 60), 9);assert.equal(R.tripCost('bike', 61), 9);assert.equal(R.tripCost('bike', 120), 10);
  assert.equal(R.tripCost('ebike', 200), 14);// 3:20 → minutes 1, 2 and 3 started after the first
  assert.equal(R.tripCost('bike', 180 * 60), 187);assert.equal(R.tripCost('bike', 400 * 60), 187);// the per-minute price stops at 180 minutes
  assert.equal(RIDES.plans.bike.price, 8);assert.equal(RIDES.plans.ebike.per_min_pricing[0].rate, 2);
});

test('an e-scooter costs 10 kr to unlock and 3 kr for every started minute (the first one too)', () => {
  assert.equal(R.tripCost('scooter', 0), 13);assert.equal(R.tripCost('scooter', 59.9), 13);assert.equal(R.tripCost('scooter', 60), 16);
  assert.equal(R.clock(65), '1:05');
});

test('a dock counts the bikes standing in its slots, not the ones in use or beside it', () => {
  const d = {x: 10, s: 20, u: [1, 0], n: [0, 1], slots: 4};
  const slots = R.dockSlots(d);
  assert.deepEqual(slots.map(q => q.x), [8.8, 9.6, 10.4, 11.2]);
  const bikes = [{x: 8.8, s: 20}, {x: 9.62, s: 20.1, electric: true}, {x: 10.4, s: 20, inUse: true}, {x: 13, s: 20}];
  const c = R.dockCount(d, bikes);
  assert.equal(c.bike, 1);assert.equal(c.ebike, 1);assert.deepEqual(c.free, [2, 3]);
});

test('the real docks: 40 of them around Torshov, Myrens and Grünerløkka, each clear of buildings, streets and the others', () => {
  assert.equal(RIDES.docks.length, 40);
  for (const area of ['Torshov', 'Myrens', 'Grünerløkka']) assert.ok(RIDES.docks.some(d => d.area === area), area);
  assert.ok(RIDES.docks.some(d => d.name === 'Torshovparken vest') && RIDES.docks.some(d => d.name === 'Olaf Ryes plass'));
  for (const d of RIDES.docks) {
    assert.ok(d.slots >= 4 && d.slots <= 10 && d.slots <= d.cap, d.name);
    assert.ok(Math.abs(Math.hypot(...d.u) - 1) < .01 && Math.abs(d.u[0] * d.n[0] + d.u[1] * d.n[1]) < .01, `${d.name}: u and n are unit and square`);
    // The whole row: every slot, its bike (1.9 m along n) and the posts.
    for (const q of R.dockSlots(d)) for (const k of [-.95, 0, .95]) {
      const p = [q.x + d.n[0] * k, q.s + d.n[1] * k];
      assert.ok(!inBuilding(p), `${d.name}: slot ${q.i} is in a building`);
      assert.ok(!onCarriageway(p), `${d.name}: slot ${q.i} is on the street`);
    }
    for (const e of RIDES.docks) if (e !== d) assert.ok(Math.hypot(e.x - d.x, e.s - d.s) > (d.slots + e.slots) * .4, `${d.name} overlaps ${e.name}`);
  }
});

test('e-scooter places are seeded: the same every time, apart from each other and inside their regions', () => {
  const roads = D.roads, regions = [{count: 20, inside: (x, s) => Math.hypot(x, s) < 400}];
  const a = R.scooterSpots({roads, regions}), b = R.scooterSpots({roads, regions});
  assert.equal(a.length, 20);assert.deepEqual(a, b);
  for (const p of a) {assert.ok(Math.hypot(p.x, p.s) < 400);for (const q of a) if (q !== p) assert.ok(Math.hypot(q.x - p.x, q.s - p.s) >= 22);}
  // The game's own check (room to stand) can turn places down; it then finds others.
  const c = R.scooterSpots({roads, regions, ok: x => x > 0});assert.ok(c.length > 10 && c.every(p => p.x > 0));
});

test('a delivery pays more the faster it is, and 40 % when it is late', () => {
  const t = J.deliveryTerms(500);
  assert.equal(t.pay, 70);assert.equal(t.limit, Math.round(45 + 500 * 1.3 / 3.2));
  assert.deepEqual(J.deliveryPay(t, 0), {kr: 105, late: false, bonus: 35});
  assert.equal(J.deliveryPay(t, t.limit).kr, 70);
  assert.deepEqual(J.deliveryPay(t, t.limit + 1), {kr: 28, late: true, bonus: 0});
  assert.ok(J.deliveryTerms(200).pay < J.deliveryTerms(600).pay);
});

test('taxi: the fare grows with the distance; crashes, harsh driving and drinking cost the tip', () => {
  assert.equal(J.taxiFare(0), 65);assert.ok(J.taxiFare(1000) > J.taxiFare(500));
  const fare = J.taxiFare(800), exp = J.expectedTaxiS(800);
  // Calm and quick: the best tip.
  const calm = new J.Mood(82);for (let i = 0; i < 100; i++) calm.tick(.1, {a: 1, lat: 1});assert.equal(calm.v, 82);
  assert.ok(calm.tip(fare, exp * .8, exp) > calm.tip(fare, exp * 1.5, exp), 'faster gives more');
  assert.equal(new J.Mood(90).tip(100, 100, 100), 25);
  // A crash: a big drop and a word from the back seat.
  const crash = new J.Mood(82);crash.hit(8);assert.equal(crash.v, 82 - 34);assert.equal(crash.events.length, 1);
  // Harsh braking costs mood every second it lasts.
  const harsh = new J.Mood(82);for (let i = 0; i < 20; i++) harsh.tick(.1, {a: -7});assert.ok(harsh.v < 70);
  // Drunk: noticed once (−20), then a little all the time; never below 0, and no tip when angry.
  const drunk = new J.Mood(82);for (let i = 0; i < 10; i++) drunk.tick(.1, {drunk: .5});assert.ok(drunk.v < 62 && drunk.v > 59);
  assert.equal(drunk.events.filter(e => /drinking/.test(e)).length, 1);
  const angry = new J.Mood(30);assert.equal(angry.tip(200, 10, 100), 0);
  for (let i = 0; i < 10; i++) angry.hit(10);assert.equal(angry.v, 0);
});

test('a wrong turn counts once when you drive 45 m further from the destination for 3 s', () => {
  const w = new J.WrongWay();let d = 500, n = 0;
  for (let i = 0; i < 100; i++) {d -= 5;if (w.tick(.1, d)) n++;}// toward it: never
  for (let i = 0; i < 100; i++) {d += 1;if (w.tick(.1, d)) n++;}// 100 m away from it: once
  assert.equal(n, 1);
});

test('orders fit the place: pizza at a pizzeria, sushi at a sushi bar, groceries at Joker', () => {
  const r = () => 0;
  assert.match(J.orderFor({name: 'Jungel Pizza', kind: 'restaurant', cuisine: 'pizza'}, r), /pizza/i);
  assert.match(J.orderFor({name: 'Sun Sushi', kind: 'restaurant', cuisine: 'sushi'}, r), /sushi/i);
  assert.match(J.orderFor({name: 'Kaffebrenneriet', kind: 'café', cuisine: 'coffee_shop'}, r), /cappuccino|latte|flat white/);
  assert.equal(J.orderFor({name: 'Joker Torshov', shop: true}, r), 'a bag of groceries');
});

test('street doors and food places: real addresses, on the street side of their building, not inside one', () => {
  assert.ok(JOBS.doors.length > 800 && JOBS.pickups.length >= 20);
  assert.ok(JOBS.doors.some(d => d.a === 'Haarklous plass 4') || JOBS.doors.some(d => /^Haarklous plass /.test(d.a)), 'Haarklous plass has doors');
  for (const d of [...JOBS.doors, ...JOBS.pickups]) {
    const name = d.a || d.name;
    assert.ok(Math.abs(d.x) <= 740 && Math.abs(d.s) <= 740 && Math.abs(d.cx) <= 740 && Math.abs(d.cs) <= 740, `${name} is in the old square`);
    assert.ok(!inBuilding([d.x, d.s]), `${name}: the spot is inside a building`);
    // The door is on the building's wall, within 1.5 m of the spot, and the car stops on a street.
    assert.ok(Math.hypot(d.bx - d.x, d.bs - d.s) < 1.5, `${name}: door far from its spot`);
    assert.ok(carRoads.some(r => {for (let i = 0; i + 3 < r.p.length; i += 2) if (segDist([d.cx, d.cs], [r.p[i], r.p[i + 1]], [r.p[i + 2], r.p[i + 3]]) < r.w / 2 + .1) return true;return false;}), `${name}: the taxi stop is not on a street`);
  }
  // An address's door faces a street of its own name.
  for (const d of JOBS.doors.slice(0, 200)) {
    const street = d.a.replace(/ \d+\w*$/, ''), named = carRoads.filter(r => r.n === street);
    assert.ok(named.some(r => {for (let i = 0; i + 3 < r.p.length; i += 2) if (segDist([d.x, d.s], [r.p[i], r.p[i + 1]], [r.p[i + 2], r.p[i + 3]]) < 26) return true;return false;}), `${d.a}: no ${street} nearby`);
  }
});
