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

// ---------- Issue #113: a lot more parked vehicles (game-parking.js) ----------
const GP = require('../game-parking.js'), TOOL = require('../tools/make-parking.cjs'), OSM = TOOL.osmData(), STORED = require('../parking-data.js');
const boxOf = c => GP.box(c.x, c.s, c.heading, GP.TYPES[c.type].L, GP.TYPES[c.type].W);
const one = (roads, osm = {}, extra = {}) => GP.plan({roads, osm, rects: big, fill: {kerb: .9, tagged: .9, lot: .9, bay: .9, rack: 1}, ...extra});

test('#113: kerb vehicles stand by the kerb facing the traffic; on a one-way street both sides face the one way', () => {
  const street = {k: 'residential', w: 6.5, n: 'Testgata', p: [0, 300, 0, 0]};// drawn northwards (s falls): the right-hand kerb is east
  const two = one([street]).cars;
  assert.ok(two.length >= 40, `${two.length} vehicles`);
  for (const c of two) {
    if (c.type === 'motorcycle') {assert.ok(Math.abs(c.x) < 3.25, `motorcycle at x ${c.x}`);continue;}
    const T = GP.TYPES[c.type], north = Math.abs(Math.abs(c.heading) - Math.PI) < .02, south = Math.abs(c.heading) < .02;
    assert.ok(Math.abs(Math.abs(c.x) - (6.5 / 2 - .15 - T.W / 2)) < 1e-3, `${c.type} at x ${c.x}`);
    assert.ok(c.x > 0 ? north : south, `${c.type} at x ${c.x.toFixed(2)} faces ${c.heading.toFixed(2)}`);
  }
  assert.ok(two.some(c => c.x > 0) && two.some(c => c.x < 0), 'both kerbs');
  // OpenStreetMap says: one way along the drawn direction; or no parking on the right-hand kerb.
  const ow = one([street], {ways: [{p: [.3, 310, .3, -10], l: -1, r: -1, o: 1}]}).cars.filter(c => c.type !== 'motorcycle');
  assert.ok(ow.length >= 30 && ow.every(c => Math.abs(Math.abs(c.heading) - Math.PI) < .02), 'all face north on the one-way street');
  const noRight = one([street], {ways: [{p: [.3, 310, .3, -10], l: -1, r: 0, o: 0}]}).cars;
  assert.ok(noRight.length >= 15 && noRight.every(c => c.x < 0), 'parking:right=no leaves the east kerb empty');
  // The same street drawn the other way round: the tags still mean the right-hand side of the OSM way.
  const flipped = one([{...street, p: [0, 0, 0, 300]}], {ways: [{p: [.3, 310, .3, -10], l: -1, r: 0, o: 0}]}).cars;
  assert.ok(flipped.length >= 15 && flipped.every(c => c.x < 0), 'the tags follow the OSM way\'s direction');
});

test('#113: nothing at a junction, a crossing, a bus stop, a gate, on tram rails, in a building, or on another vehicle', () => {
  const street = {k: 'residential', w: 6.5, n: 'A', p: [0, 400, 0, 0]}, cross = {k: 'tertiary', w: 8, n: 'B', p: [-100, 200, 100, 200]}, drive = {k: 'service', w: 3.6, p: [-3.25, 120, -30, 120]};
  const tram = {k: 'tram', w: 2.6, p: [1.2, 330, 1.2, 270]}, foot = {k: 'footway', w: 2.4, p: [-20, 60, 20, 60]};
  const osm = {stops: [3, 360], crossings: [0, 30], gates: [-5, 90]}, house = [-30, 240, -3.4, 240, -3.4, 255, -30, 255];
  const taken = [[2, 160, 2, 170, 4, 170, 4, 160]];// a vehicle that is there already, on the east kerb
  const cars = one([street, cross, drive, tram, foot], osm, {buildings: [house], taken}).cars;
  assert.ok(cars.length >= 20, `${cars.length} vehicles`);
  for (const c of cars) {
    const b = boxOf(c), at = `${c.type} at ${c.x.toFixed(1)}, ${c.s.toFixed(1)}`;
    if (Math.abs(c.x) < 4) assert.ok(GP.segBox(cross.p, b) >= 8 / 2 + 5 - 1e-6, `${at}: at the junction`);
    assert.ok(GP.segBox(drive.p, b) >= 3.6 / 2 + 1 - 1e-6, `${at}: in front of a driveway`);
    assert.ok(GP.segBox(tram.p, b) >= 1.7 - 1e-6, `${at}: on the tram rails`);
    assert.ok(Math.hypot(c.x - 3, c.s - 360) >= 20, `${at}: at the bus stop`);
    assert.ok(GP.segBox([0, 30, 0, 30], b) >= 5 - 1e-6 && GP.segBox([0, 60, 0, 60], b) >= 5 - 1e-6, `${at}: at a pedestrian crossing`);
    assert.ok(GP.segBox([-5, 90, -5, 90], b) >= 3 - 1e-6, `${at}: at a gate`);
    for (let i = 0; i < 8; i += 2) assert.ok(!GP.inPoly(b.corners[i], b.corners[i + 1], house), `${at}: in the house`);
    assert.ok(!GP.overlap(b, GP.box(3, 165, 0, 10, 2)), `${at}: on the vehicle that was there`);
  }
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) assert.ok(!GP.overlap(boxOf(cars[i]), boxOf(cars[j]), .3), `vehicles ${i} and ${j} overlap`);
  assert.ok(cars.some(c => c.s > 270 && c.s < 330 && c.x < 0), 'the kerb away from the tram keeps its cars');
});

test('#113: a car park is filled in rows of bays inside its outline; a parking lane mapped as an area gets a row along it', () => {
  const lot = [100, 0, 160, 0, 160, 40, 100, 40], lane = [300, 0, 340, 0, 340, 2.4, 300, 2.4], road = {k: 'residential', w: 6.5, n: 'C', p: [290, -4.5, 350, -4.5]};
  const cars = one([road], {lots: [{p: lot, k: 'surface', c: 0}, {p: lane, k: 'lane', c: 0}]}).cars, inLot = cars.filter(c => c.where === 'lot' && c.x < 200), inLane = cars.filter(c => c.where === 'lot' && c.x > 200);
  assert.ok(inLot.length >= 40, `${inLot.length} in the car park`);
  for (const c of inLot) {
    const b = boxOf(c);for (let i = 0; i < 8; i += 2) assert.ok(GP.inPoly(b.corners[i], b.corners[i + 1], lot), `outside the car park: ${c.x}, ${c.s}`);
    assert.ok(Math.abs(Math.sin(c.heading)) < 1e-3, `across the rows (north or south): ${c.heading}`);
  }
  assert.ok(inLane.length >= 5 && inLane.every(c => Math.abs(Math.abs(Math.sin(c.heading)) - 1) < 1e-3 && Math.abs(c.s - 1.2) < .01), 'parallel in the lane');
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) assert.ok(!GP.overlap(boxOf(cars[i]), boxOf(cars[j]), .3));
});

test('#113: taxis queue at a taxi rank; bicycles stand at a bike rack; the body types and colours are known', () => {
  const road = {k: 'tertiary', w: 8, n: 'D', p: [0, 0, 200, 0]};
  const r = one([road], {taxis: [100, 6, 3], bikes: [60, 9, 10]});
  const taxis = r.cars.filter(c => c.where === 'rank'), bikes = r.small.filter(c => c.where === 'rack');
  assert.ok(taxis.length >= 2 && taxis.every(c => c.type === 'taxi' && Math.abs(c.s - (4 - .15 - .92)) < .01), JSON.stringify(taxis));
  assert.ok(bikes.length >= 2 && bikes.every(c => Math.abs(c.s - 9) < 1.5 && Math.abs(Math.abs(Math.cos(c.heading)) - 1) < .1), JSON.stringify(bikes));
  for (const [k, t] of Object.entries(GP.TYPES)) assert.ok(t.L > t.W && t.H > 0 && typeof t.drive === 'boolean' && t.kind, k);
  for (const c of [...r.cars, ...r.small]) assert.ok(GP.TYPES[c.type] && GP.COLOURS[c.colour], JSON.stringify(c));
});

// The real map, with what the game also keeps free (the job stops): what tools/make-parking.cjs plans and stores.
let fleetCache = null;const realFleet = () => fleetCache || (fleetCache = GP.plan(TOOL.planArgs(OSM)));

test('#113: parking-data.js holds the plan the map gives today (else run node tools/make-parking.cjs)', () => {
  const {cars, small} = realFleet();
  assert.deepEqual(GP.unpack(STORED.cars), GP.unpack(GP.pack(cars)), 'the stored plan is out of date: run node tools/make-parking.cjs');
  assert.deepEqual(GP.unpack(STORED.small), GP.unpack(GP.pack(small)));
  // Packing keeps every vehicle within 5 cm and 1 mrad.
  const back = GP.unpack(GP.pack(cars));
  for (let i = 0; i < cars.length; i++) {const a = cars[i], b = back[i];assert.ok(Math.abs(a.x - b.x) < .051 && Math.abs(a.s - b.s) < .051 && Math.abs(a.heading - b.heading) < .0006 && a.type === b.type && a.colour === b.colour && a.where === b.where, i);}
});

test('#113: the game leaves out the vehicles on its kept-free places and on the vehicles that are there already', () => {
  const list = [{x: 0, s: 0, heading: 0, type: 'hatch', colour: 0, where: 'kerb'}, {x: 20, s: 0, heading: 0, type: 'van', colour: 0, where: 'kerb'}, {x: 40, s: 0, heading: 0, type: 'suv', colour: 0, where: 'lot'}, {x: 60, s: 0, heading: 0, type: 'bicycle', colour: 0, where: 'rack'}];
  assert.equal(GP.keep(list).length, 4);
  assert.deepEqual(GP.keep(list, {clear: [{x: 0, s: 5, r: 3}]}).map(c => c.x), [20, 40, 60]);// 5 m away, but a car is 4.3 m long
  assert.deepEqual(GP.keep(list, {lines: [{p: [15, -50, 25, 50], r: 2}]}).map(c => c.x), [0, 40, 60]);
  assert.deepEqual(GP.keep(list, {taken: [[39, 3, 41, 3, 41, 1, 39, 1]]}).map(c => c.x), [0, 20, 60]);
});

test('#113 the real map: thousands of vehicles in every part of town, many kinds, the same every time', () => {
  const {cars, small} = realFleet();
  assert.ok(cars.length >= 4000 && cars.length <= 9000, `${cars.length} vehicles`);
  assert.ok(small.length >= 300, `${small.length} bicycles and mopeds`);
  const parts = {Torshov: [-760, -760, 760, 760, 600], 'Sagene / Myrens': [-1160, -136, -728, 520, 50], 'Grünerløkka': [-1250, 880, -350, 2000, 400], 'Tøyen / Kampen': [-350, 1900, 900, 2900, 250],
    'Grønland and the centre': [-1560, 2500, -200, 3960, 250], 'Ensjø': [700, 1700, 1752, 2700, 150], 'Sinsen / Løren': [760, -360, 1752, 520, 100], 'Økern / Ulven': [1832, -360, 2264, 1608, 150]};
  for (const [name, [x0, s0, x1, s1, min]] of Object.entries(parts)) {const n = cars.filter(c => c.x > x0 && c.x < x1 && c.s > s0 && c.s < s1).length;assert.ok(n >= min, `${name}: ${n} vehicles`);}
  const by = {};for (const c of cars) by[c.type] = (by[c.type] || 0) + 1;
  for (const t of ['small', 'hatch', 'sedan', 'estate', 'suv', 'van', 'pickup', 'taxi', 'lorry', 'motorcycle']) assert.ok(by[t] >= (t === 'lorry' ? 10 : 30), `${t}: ${by[t]}`);
  assert.ok(cars.filter(c => c.where === 'lot').length >= 500, 'car parks are filled too');
  assert.deepEqual(GP.plan(TOOL.planArgs(OSM)), realFleet(), 'the same every time');
});

test('#113 the real map: none on a carriageway, a tram line, in a building or on another vehicle; none at a bus stop or a job stop', () => {
  const {cars, small} = realFleet(), all = [...cars, ...small];
  const drive = roads.filter(r => ['primary', 'trunk', 'trunk_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'motorway_link', 'service', 'pedestrian'].includes(r.k)).flatMap(r => segs(r).map(a => ({a, w: r.w})));
  const trams = roads.filter(r => r.k === 'tram').flatMap(segs), G = 30, key = (x, s) => Math.floor(x / G) * 100003 + Math.floor(s / G);
  const grid = new Map(), put = (k, o) => {if (!grid.has(k)) grid.set(k, new Set());grid.get(k).add(o);};
  for (const o of [...drive, ...trams.map(a => ({a, tram: true}))]) {const n = Math.ceil(Math.hypot(o.a[2] - o.a[0], o.a[3] - o.a[1]) / 10);for (let i = 0; i <= n; i++) put(key(o.a[0] + (o.a[2] - o.a[0]) * i / n, o.a[1] + (o.a[3] - o.a[1]) * i / n), o);}
  const near = (x, s) => {const out = new Set();for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get(key(x + i * G, s + j * G)) || []) out.add(o);return out;};
  const bld = [...D.buildings.map(b => b.r.o), ...DS.flatMap(d => d.buildings.map(b => b.ring.flat()))].map(o => {let x0 = 1e9, s0 = 1e9, x1 = -1e9, s1 = -1e9;for (let i = 0; i < o.length; i += 2) {x0 = Math.min(x0, o[i]);x1 = Math.max(x1, o[i]);s0 = Math.min(s0, o[i + 1]);s1 = Math.max(s1, o[i + 1]);}return {o, x0, s0, x1, s1};});
  const stops = OSM.stops, jobs = [...window.JOBS.doors, ...window.JOBS.pickups];
  for (const c of all) {
    const b = boxOf(c), at = `${c.type} (${c.where}) at ${c.x.toFixed(0)}, ${c.s.toFixed(0)}`;
    // A kerb vehicle stands on its own street only (its body at least half a metre from the middle line of every road, at a
    // bend too); the others keep off every road.
    let across = 0;
    for (const o of near(c.x, c.s)) {
      const d = GP.segBox(o.a, b);
      if (o.tram) assert.ok(d >= 1.7 - 1e-6, `${at} is on a tram line`);
      else if (c.where === 'kerb' || c.where === 'rank') {if (d < .5) across++;}
      else assert.ok(d >= o.w / 2 + (c.where === 'rack' ? .5 : .4) - 1e-6, `${at} is on a road`);
    }
    assert.ok(across === 0, `${at} reaches the middle of a road`);
    for (const q of bld) if (q.x1 > c.x - 6 && q.x0 < c.x + 6 && q.s1 > c.s - 6 && q.s0 < c.s + 6) {assert.ok(!GP.inPoly(c.x, c.s, q.o), `${at} is in a building`);for (let i = 0; i < 8; i += 2) assert.ok(!GP.inPoly(b.corners[i], b.corners[i + 1], q.o), `${at} is in a building`);}
    if (c.where === 'kerb') for (let i = 0; i < stops.length; i += 2) assert.ok(Math.abs(stops[i] - c.x) > 20 || Math.hypot(stops[i] - c.x, stops[i + 1] - c.s) >= 20, `${at} is at a bus stop`);
    for (const d of jobs) assert.ok(Math.abs(d.cx - c.x) > 9 || GP.segBox([d.cx, d.cs, d.cx, d.cs], b) > .1, `${at} is on a job stop`);
  }
  const cells = new Map();for (const c of all) {const k = key(c.x, c.s);if (!cells.has(k)) cells.set(k, []);cells.get(k).push(c);}
  let pairs = 0;for (const c of all) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of cells.get(key(c.x + i * G, c.s + j * G)) || []) if (o !== c && GP.overlap(boxOf(c), boxOf(o), .1)) pairs++;
  assert.equal(pairs, 0, 'vehicles overlapping');
});

test('#113: the vehicles that were there keep their numbers online (the parked fleet comes after all of them)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../game-main.js'), 'utf8');
  const last = Math.max(src.indexOf('cityCars.push(v);vehicles.push(v);'), src.indexOf('cc.driveSpots.forEach'), src.indexOf('vehicles.push(schoolCar, schoolBike)'));
  const fleetAt = src.indexOf('vehicles.push(...fleet.cars)'), spawnAt = src.indexOf('vehicles.forEach(v => {v.spawn = v.netGet();});');
  assert.ok(last > 0 && fleetAt > last && spawnAt > fleetAt, 'the fleet is pushed after every older vehicle and before the spawn places are kept');
});
