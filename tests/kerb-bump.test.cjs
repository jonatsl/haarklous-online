// Cars over a kerb (issue #169): a 12 cm kerb is a small, quick bump at any speed and frame rate, never a jump; a crest or
// a ramp taken fast still lifts the car off the ground as before.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../game-vehicles.js');

const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;
const lib = new Proxy({mergeStatic() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
const sounds = [];const audio = {sfx(name, o) {sounds.push([name, o && o.gain]);}, engine: () => ({set() {}, stop() {}})};

// Forward is -z at yaw 0. The ground is given as a function of z only.
function make(ground) {
  return globalThis.GameVehicles.create({T, lib, audio, heightAt: (x, z) => ground(z), collision: {}, worldFor: () => null});
}
// Drive straight ahead at `kmh` for `s` seconds with time step `dt`; returns the body heights and ground under the centre.
function drive(v, ground, kmh, dt, s) {
  const out = [];v.speed = kmh / 3.6;
  for (let t = 0; t < s; t += dt) {
    v.z -= v.speed * dt;v.settle(dt);
    const L = v.length * .4;out.push({t, y: v.y, g: (ground(v.z - L) + ground(v.z + L)) / 2, air: v.airborne, vy: v.vy, pitch: v.pitch, z: v.z});
  }
  return out;
}
const KERB = -10, kerb = z => z < KERB ? .12 : 0, down = z => z < KERB ? 0 : .12;

for (const [kind, mk] of [['car', VH => new VH.Car(0, 0, 0, 0, {lazy: true})], ['motorcycle', VH => new VH.Motorcycle(0, 0, 0, 0, {lazy: true})]]) {
  for (const fps of [30, 60]) {
    for (const kmh of [20, 50, 90]) {
      test(`${kind} up a 12 cm kerb at ${kmh} km/h, ${fps} fps: a small bump, on the ground, settled within half a second`, () => {
        const VH = make(kerb), v = mk(VH);v.active = true;v.settle(1);
        const dt = 1 / fps, rows = drive(v, kerb, kmh, dt, 3);
        const hop = Math.max(...rows.map(r => r.y - r.g)), top = Math.max(...rows.map(r => r.y));
        assert.ok(rows.every(r => !r.air), `never airborne (${kind} ${kmh} km/h ${fps} fps)`);
        assert.ok(hop < .035, `at most a few cm above the ground (${(hop * 100).toFixed(1)} cm)`);
        assert.ok(top < .12 + .035, `the body never goes far over the pavement (${(top * 100).toFixed(1)} cm)`);
        // The rear sample is the last to climb; half a second later the car rests on the pavement.
        const rearUp = rows.find(r => r.z + v.length * .4 < KERB).t;
        const later = rows.filter(r => r.t > rearUp + .5);
        assert.ok(later.length && later.every(r => Math.abs(r.y - .12) < .01 && Math.abs(r.vy) < .3), `settled half a second after the rear wheel (y ${later[0] && later[0].y.toFixed(3)})`);
        // Nose first: the pitch goes nose up (positive) while only the front is on the kerb.
        const mid = rows.filter(r => r.z - v.length * .4 < KERB - .3 && r.z + v.length * .4 > KERB + .3);
        if (mid.length) assert.ok(Math.max(...mid.map(r => r.pitch)) > .01, 'the nose rises first');
      });
    }
  }
}

test('down a kerb at 50 km/h: a small dip, never airborne', () => {
  for (const fps of [30, 60]) {
    const VH = make(down), v = new VH.Car(0, 0, 0, 0, {lazy: true});v.active = true;v.settle(1);
    const rows = drive(v, down, 50, 1 / fps, 2);
    assert.ok(rows.every(r => !r.air), `never airborne at ${fps} fps`);
    assert.ok(Math.abs(rows[rows.length - 1].y) < .01, 'down on the road');
  }
});

test('a kerb gives a short thump, louder at speed, and a small camera dip', () => {
  const thumps = kmh => {sounds.length = 0;const VH = make(kerb), v = new VH.Car(0, 0, 0, 0, {lazy: true});v.active = true;v.settle(1);let dip = 0;v.speed = kmh / 3.6;
    for (let t = 0; t < 2; t += 1 / 60) {v.z -= v.speed / 60;v.settle(1 / 60);dip = Math.max(dip, v.squash);}
    return {g: sounds.filter(s => s[0] === 'thud').map(s => s[1]), dip};};
  const slow = thumps(20), fast = thumps(90);
  assert.equal(fast.g.length, 2, 'one thump for the front and one for the rear');
  assert.ok(fast.g[0] > slow.g[0], 'louder at speed');
  assert.ok(fast.g[0] <= .6, 'never loud');
  assert.ok(fast.dip > .01 && fast.dip <= .06 && slow.dip < fast.dip, `the view dips a little (${fast.dip.toFixed(3)} m)`);
});

test('a crest or a ramp taken fast still lifts the car', () => {
  // A smooth hump 3 m high and 16 m long at 90 km/h.
  const hill = z => 3 * Math.exp(-((z + 40) ** 2) / (2 * 6 * 6));
  for (const fps of [30, 60]) {
    const VH = make(hill), v = new VH.Car(0, 0, 0, 0, {lazy: true});v.active = true;v.settle(1);
    const rows = drive(v, hill, 90, 1 / fps, 3);
    assert.ok(rows.some(r => r.air), `airborne over the crest at ${fps} fps`);
    assert.ok(Math.max(...rows.map(r => r.y - r.g)) > .3, 'well clear of the ground');
  }
  // A 25 % ramp up to a flat top at 60 km/h: the car flies off its edge.
  const ramp = z => Math.min(2, Math.max(0, (-z - 10) * .25));
  const VH = make(ramp), v = new VH.Car(0, 0, 0, 0, {lazy: true});v.active = true;v.settle(1);
  const rows = drive(v, ramp, 60, 1 / 60, 3);
  assert.ok(rows.some(r => r.air) && Math.max(...rows.map(r => r.y - r.g)) > .3, 'the ramp still launches it');
});

test('flat streets drive as before: no thumps, no movement', () => {
  sounds.length = 0;const flat = () => 0, VH = make(flat), v = new VH.Car(0, 0, 0, 0, {lazy: true});v.active = true;v.settle(1);
  const rows = drive(v, flat, 60, 1 / 60, 2);
  assert.ok(rows.every(r => r.y === 0 && !r.air && r.pitch === 0));assert.equal(sounds.length, 0);
});
