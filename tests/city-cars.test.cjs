// Parked cars all over the city (issue #105): where game-city-cars.js puts them, on made-up streets and on the real map.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
window.DISTRICTS = [];
for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'loren-data.js', 'okern-data.js']) require('../' + f);
require('../surroundings.js');
const District = require('../district.js'), {walkRects} = window.Surroundings, CC = require('../game-city-cars.js');
const D = window.SURROUNDINGS, DS = window.DISTRICTS.map(d => District.decode(d));
const segDist = (x, s, a) => {const dx = a[2] - a[0], ds = a[3] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (s - a[1]) * ds) / L));return Math.hypot(x - a[0] - dx * t, s - a[1] - ds * t);};
const segs = r => {const o = [];for (let i = 0; i + 3 < r.p.length; i += 2) o.push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]]);return o;};
const big = [{x0: -5000, s0: -5000, x1: 5000, s1: 5000}];

test('a street car stands in the road by the kerb, on the right, facing the way the traffic goes', () => {
  // One street going north (s falls): the right-hand side is east (+x).
  const street = {k: 'residential', w: 6.5, p: [0, 200, 0, 0]};
  const cars = CC.plan({roads: [street], rects: big, per: 50, gap: 20, cell: 1000});
  assert.ok(cars.length >= 6, `${cars.length} cars`);
  for (const c of cars) {
    assert.ok(Math.abs(Math.abs(c.x) - (6.5 / 2 - CC.KERB)) < 1e-9, `x ${c.x}`);
    const north = Math.abs(Math.abs(c.heading) - Math.PI) < 1e-9, south = Math.abs(c.heading) < 1e-9;
    assert.ok(c.x > 0 ? north : south, `at x ${c.x.toFixed(2)} the car faces ${c.heading.toFixed(2)}`);
    assert.ok(c.s >= 8 && c.s <= 192);
    assert.ok(c.model >= 0 && c.model < 7 && c.lot === false);
  }
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) assert.ok(Math.hypot(cars[i].x - cars[j].x, cars[i].s - cars[j].s) >= 20);
});

test('no car at a crossing, on tram rails, beside a railway, in water or in a kept-free circle', () => {
  const street = {k: 'residential', w: 6.5, p: [0, 400, 0, 0]}, cross = {k: 'secondary', w: 9, p: [-100, 100, 100, 100]};
  const tram = {k: 'tram', w: 2.6, p: [1.5, 230, 1.5, 170]}, rail = {k: 'rail', w: 3.6, p: [-50, 300, 50, 300]};
  const pond = [-20, 340, 20, 340, 20, 380, -20, 380], clear = [{x: 0, s: 30, r: 25}];
  const cars = CC.plan({roads: [street, cross, tram, rail], water: [pond], clear, rects: big, per: 200, gap: 13, cell: 1000});
  assert.ok(cars.length >= 8, `${cars.length} cars`);
  for (const c of cars) {
    // On the street it keeps clear of the cross street, and on the cross street of the street.
    if (Math.abs(c.x) < 3) assert.ok(Math.abs(c.s - 100) >= 9 / 2 + 3.2 - 1e-9, `at the crossing: s ${c.s}`);
    else assert.ok(Math.abs(c.x) >= 6.5 / 2 + 3.2 - 1e-9, `at the crossing: x ${c.x}`);
    assert.ok(segDist(c.x, c.s, tram.p) >= 3.4, `on the tram rails: ${c.x.toFixed(1)}, ${c.s}`);
    assert.ok(Math.abs(c.s - 300) >= 12, `by the railway: s ${c.s}`);
    assert.ok(!(c.s > 335 && c.s < 385 && Math.abs(c.x) < 25), `in the pond: s ${c.s}`);
    assert.ok(Math.hypot(c.x, c.s - 30) >= 25, `in the kept-free circle: s ${c.s}`);
  }
  // The side of the street away from the tram keeps its cars there.
  assert.ok(cars.some(c => c.s > 175 && c.s < 225 && c.x < 0));
});

test('a car park gets a car inside it, along its longest side; a small one gets none', () => {
  const lot = [300, 0, 360, 0, 360, 24, 300, 24], small = [500, 0, 508, 0, 508, 8, 500, 8];
  const cars = CC.plan({lots: [lot, small], rects: big, per: 3, gap: 6, cell: 1000});
  assert.ok(cars.length >= 1 && cars.length <= 3);
  for (const c of cars) {
    assert.ok(c.lot && c.x > 302.5 && c.x < 357.5 && c.s > 2.5 && c.s < 21.5, `${c.x}, ${c.s}`);
    assert.ok(Math.abs(Math.abs(Math.sin(c.heading)) - 1) < 1e-9, `heading ${c.heading}`);// east or west, along the 60 m side
  }
});

test('each square gets at most `per` cars, the game\'s own check is obeyed, and nothing is outside the walkable boxes', () => {
  const roads = [];for (let k = 0; k < 10; k++) roads.push({k: 'residential', w: 6.5, p: [-600, k * 120, 600, k * 120]});
  const rects = [{x0: -400, s0: 0, x1: 400, s1: 1000}], seen = [];
  const cars = CC.plan({roads, rects, per: 2, cell: 300, ok: c => {seen.push(c);return c.x < 100;}});
  const count = new Map();
  for (const c of cars) {
    assert.ok(c.x < 100 && c.x > -385 && c.s > 15 && c.s < 985, `${c.x}, ${c.s}`);
    const k = `${Math.floor(c.x / 300)},${Math.floor(c.s / 300)}`;count.set(k, (count.get(k) || 0) + 1);
  }
  assert.ok(seen.length > cars.length);
  assert.ok([...count.values()].every(n => n <= 2));
});

// ---------- The real map ----------
const areas = [...D.areas, ...DS.flatMap(d => d.areas)], roads = [...D.roads, ...DS.flatMap(d => d.roads)];
const real = () => CC.plan({roads, lots: areas.filter(a => a.k === 'parking').map(a => a.o), water: [...areas.filter(a => a.k === 'water').map(a => a.o), ...DS.flatMap(d => d.sea)],
  rects: walkRects(D.terrain.half, 760, DS), clear: [{x: 0, s: 0, r: 300}]});

test('the real map: hundreds of cars, in every part of town, the same every time', () => {
  const cars = real();
  assert.ok(cars.length >= 300 && cars.length <= 450, `${cars.length} cars`);
  assert.deepEqual(real(), cars);
  const inBox = (c, x0, s0, x1, s1) => c.x > x0 && c.x < x1 && c.s > s0 && c.s < s1;
  const parts = {Torshov: [-760, -760, 760, 760], 'Sagene / Myrens': [-1160, -136, -728, 520], 'Grünerløkka': [-1250, 880, -350, 2000], 'Tøyen / Kampen': [-350, 1900, 900, 2900],
    'Grønland and the centre': [-1560, 2500, -200, 3960], 'Ensjø': [700, 1700, 1752, 2700], 'Sinsen / Løren': [760, -360, 1752, 520], 'Økern / Ulven': [1832, -360, 2264, 1608]};
  for (const [name, b] of Object.entries(parts)) {const n = cars.filter(c => inBox(c, ...b)).length;assert.ok(n >= 5, `${name}: ${n} cars`);}
  assert.ok(cars.filter(c => c.lot).length >= 30, 'car parks have cars too');
  // The old street cars' part of town (within 300 m of home) is left as it was.
  assert.ok(cars.every(c => Math.hypot(c.x, c.s) >= 300));
});

test('the real map: no two new cars within 45 m, none on a tram line, a railway or another street', () => {
  const cars = real(), tracks = roads.filter(r => r.k === 'tram' || r.k === 'rail').flatMap(r => segs(r).map(a => ({a, keep: r.k === 'tram' ? 3.4 : 12})));
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) assert.ok(Math.hypot(cars[i].x - cars[j].x, cars[i].s - cars[j].s) >= 45);
  for (const c of cars) for (const t of tracks) if (!(c.lot && t.keep < 5)) assert.ok(segDist(c.x, c.s, t.a) >= t.keep - 1e-9, `car at ${c.x.toFixed(0)}, ${c.s.toFixed(0)} is on a track`);
  // A street car is on exactly one street: 2.2–3.5 m from its middle and well clear of every big road.
  const bigRoads = roads.filter(r => ['primary', 'trunk', 'trunk_link', 'motorway_link'].includes(r.k)).flatMap(r => segs(r).map(a => ({a, w: r.w})));
  for (const c of cars.filter(c => !c.lot)) for (const b of bigRoads) assert.ok(segDist(c.x, c.s, b.a) >= b.w / 2 + 3.2 - 1e-9, `car at ${c.x.toFixed(0)}, ${c.s.toFixed(0)} is on a main road`);
});
