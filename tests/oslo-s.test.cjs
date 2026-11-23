// Oslo S and Jernbanetorget (issue #141): Tigeren at its OSM place, the station restyled, the square paved, and the people and
// stone seats clear of the buildings, the streets and the tram tracks.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../surroundings-data.js');
const District = require('../district.js');
require('../gamle-oslo-data.js');
const OS = require('../game-oslo-s.js');
const D = window.SURROUNDINGS;
const decoded = () => District.decode(window.DISTRICTS.find(d => d.name === 'gamle-oslo'));
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const inRing = (ring, x, s) => {let c = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const [xi, si] = ring[i], [xj, sj] = ring[j];if ((si > s) !== (sj > s) && x < (xj - xi) * (s - si) / (sj - si) + xi) c = !c;}return c;};
const segDist = ([x, s], [ax, as], [bx, bs]) => {const dx = bx - ax, ds = bs - as, L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / L));return Math.hypot(x - ax - t * dx, s - as - t * ds);};

test('Tigeren stands at OSM node 3578576333 inside the Gamle Oslo patch', () => {
  const lat = 59.9111483, lon = 10.7503161, x = (lon - D.origin.lon) * 111320 * Math.cos(D.origin.lat * Math.PI / 180), s = -(lat - D.origin.lat) * 111320;
  assert.ok(Math.abs(x - OS.TIGER.x) < .1 && Math.abs(s - OS.TIGER.s) < .1, `${x.toFixed(2)}, ${s.toFixed(2)}`);
  const d = decoded();assert.ok(x > d.x0 && x < d.x1 && s > d.s0 && s < d.s1);
});

test('prepare: the station buildings become 14 m plastered buildings and the square is paved', () => {
  const d = decoded(), n = d.areas.length;
  assert.equal(OS.prepare([d]), true);
  for (const id of Object.keys(OS.STATION)) {const b = d.buildings.find(b => b.id === id);assert.ok(b, id);assert.equal(b.style, 'plaster');assert.ok(b.h >= 14);}
  const paved = d.areas.filter(a => a.osloS);assert.equal(paved.length, 1);assert.equal(paved[0].k, 'paved');
  assert.ok(inRing(pairs(paved[0].o), OS.TIGER.x, OS.TIGER.s), 'the tiger is on the paving');
  // The water feature on the square is painted again over the paving; nothing else is added (the helipads and parked cars are
  // planned from the grass, pitch and parking areas), and the paving covers no park.
  const added = d.areas.slice(n);assert.ok(added.some(a => a.k === 'water'));assert.ok(added.every(a => a.k === 'water' || a.osloS));
  const sq = pairs(paved[0].o);
  for (const a of d.areas.slice(0, n).filter(a => ['grass', 'wood', 'pitch', 'parking', 'playground'].includes(a.k))) {
    const r = pairs(a.o);assert.ok(!r.some(([x, s]) => inRing(sq, x, s)) && !sq.some(([x, s]) => inRing(r, x, s)), `the paving overlaps a ${a.k} area`);
  }
});

test('the tiger, the seats and the people are clear of buildings, streets and tram tracks', () => {
  const d = decoded(), rings = d.buildings.map(b => b.ring);
  const b = OS.TIGER.bearing * Math.PI / 180, fx = Math.sin(b), fs = -Math.cos(b), P = OS.TIGER.plinth;
  const plinth = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, c]) => [OS.TIGER.x + -fs * a * P.w / 2 + fx * c * (P.l / 2 + .9), OS.TIGER.s + fx * a * P.w / 2 + fs * c * (P.l / 2 + .9)]);// plus the tail
  const spots = [...plinth.map(p => ['plinth', p]), ...OS.SEATS.map(p => ['seat', p]), ...OS.PEOPLE.map(p => [p.id, [p.at.x, p.at.s]])];
  const cars = ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'living_street', 'trunk', 'tram', 'primary_link', 'secondary_link', 'tertiary_link'];
  const roads = d.roads.filter(r => cars.includes(r.k));
  for (const [name, p] of spots) {
    assert.ok(!rings.some(r => inRing(r, p[0], p[1])), `${name} is inside a building`);
    for (const r of roads) {const q = pairs(r.p);for (let k = 0; k + 1 < q.length; k++) {const gap = segDist(p, q[k], q[k + 1]) - r.w / 2;assert.ok(gap > .4, `${name} is ${gap.toFixed(2)} m from a ${r.k} ${r.n || ''}`);}}
  }
  // People sitting against the station wall are close to it but outside it.
  for (const p of OS.PEOPLE.filter(p => p.pose === 'ground')) assert.ok(rings.some(r => r.some(([x, s]) => Math.hypot(x - p.at.x, s - p.at.s) < 12)), p.id);
});

test('the lines people say are short Norwegian lines with an English translation', () => {
  for (const p of OS.PEOPLE.filter(p => p.say)) {const l = OS.LINES[p.say];assert.ok(l && l.no && l.en && l.no.length < 60, p.id);}
  assert.ok(OS.PEOPLE.some(p => p.say === 'ask'));
  assert.ok(OS.PEOPLE.length >= 8 && OS.PEOPLE.length <= 12);
});
