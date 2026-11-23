// Cars that crash into each other (issue #145): two cars that overlap can always drive apart, a car that is inside another one
// is pushed out, and walls and other cars still stop you (no driving through them at speed).
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
const collision = require('../walk-collision.js');
require('../game-vehicles.js');

const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;
const lib = new Proxy({mergeStatic() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
const sounds = [];const audio = {sfx(name) {sounds.push(name);}, engine: () => ({set() {}, stop() {}})};
const DT = 1 / 60;

// A flat 200 m square with an optional wall; one world per vehicle radius, as in the game.
function setup(obstacles = []) {
  const worlds = new Map(), floors = [{points: [{x: -100, z: -100}, {x: 100, z: -100}, {x: 100, z: 100}, {x: -100, z: 100}]}];
  const worldFor = r => {const k = r.toFixed(2);if (!worlds.has(k)) worlds.set(k, collision.createWorld({floors, obstacles, radius: r, clearance: .08}));return worlds.get(k);};
  const VH = globalThis.GameVehicles.create({T, lib, audio, heightAt: () => 0, collision, worldFor});
  // Each car sees the others as solids (the game's updateDynamic / transitDynamic); never itself.
  const others = (cars, me) => {cars.forEach(c => worldFor(c.radius));for (const w of worlds.values()) collision.setDynamic(w, cars.filter(c => c !== me).map(c => c.footprint()));};
  const car = (x, z, yaw) => {const c = new VH.Car(x, z, yaw, 0, {lazy: true});c.active = true;return c;};
  return {VH, worldFor, others, car};
}
// Drive `c` at `speed` (m/s, + forward) for `s` seconds, the other cars standing where they are.
function drive(env, cars, c, speed, s) {for (let i = 0; i < s / DT; i++) {env.others(cars, c);c.speed = speed;c.move(DT);}}
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('two cars that overlap can both drive apart', () => {
  const env = setup();
  // A's nose is 1.2 m inside B's tail (yaw 0: forward is -z).
  const A = env.car(0, 0, 0), B = env.car(0, -3, 0), cars = [A, B];
  env.others(cars, A);assert.ok(A.overlap(A.x, A.z) > .5, 'they start inside each other');
  // The old rule: every move had to be free of other vehicles, so A could not back away at all.
  assert.equal(A.clear(A.x, A.z + .05), false, 'the old test says a small step back is blocked');
  drive(env, cars, A, -3, 1);
  assert.ok(A.z > 2.5, `A backs away (z ${A.z.toFixed(2)})`);
  const A2 = env.car(0, 0, 0), B2 = env.car(0, -3, 0), cars2 = [A2, B2];
  drive(env, cars2, B2, 4, 1);
  assert.ok(B2.z < -6, `B drives off forward (z ${B2.z.toFixed(2)})`);
  env.others(cars2, B2);assert.ok(B2.overlap(B2.x, B2.z) < .01, 'and is free of A');
});

test('a car that is inside another one is pushed out gently, never deeper', () => {
  const env = setup();
  const A = env.car(0, 0, 0), B = env.car(1, 0, 0), cars = [A, B];// side by side, 1 m apart (1.8 m wide): deep overlap
  env.others(cars, A);const d0 = A.overlap(A.x, A.z);
  for (let i = 0; i < 30; i++) {env.others(cars, A);A.speed = 0;A.move(DT);}
  env.others(cars, A);const d1 = A.overlap(A.x, A.z);
  assert.ok(d1 < d0, `less deep after half a second (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
  assert.ok(A.x < 0 && A.x > -1.6, `pushed away from B, at up to 3 m/s (x ${A.x.toFixed(2)})`);
  for (let i = 0; i < 120; i++) {env.others(cars, A);A.speed = 0;A.move(DT);}
  env.others(cars, A);assert.ok(A.overlap(A.x, A.z) < .01, 'and out after two more seconds');
  assert.equal(B.x, 1, 'the other car is never moved by you');
});

test('driving into a car you are inside does not take you deeper', () => {
  const env = setup();
  const A = env.car(0, 0, 0), B = env.car(0, -3.5, 0), cars = [A, B];
  env.others(cars, A);A.active = false;// no push-out, to see the move rule alone
  const d0 = A.overlap(A.x, A.z);
  drive(env, cars, A, 5, .5);
  env.others(cars, A);assert.ok(A.overlap(A.x, A.z) <= d0 + 1e-3 && A.z >= -.01, `no deeper (z ${A.z.toFixed(3)})`);
});

test('a car driving into a wall still stops', () => {
  const wall = {points: [{x: -20, z: -10.2}, {x: 20, z: -10.2}, {x: 20, z: -10}, {x: -20, z: -10}], minY: 0, maxY: 3};
  const env = setup([wall]), A = env.car(0, 0, 0);
  for (let i = 0; i < 120; i++) {env.others([A], A);if (i === 0) A.speed = 15;A.move(DT);}
  assert.ok(A.z > -10 + 2.1 - .05, `the nose stays this side of the wall (z ${A.z.toFixed(2)})`);
  assert.equal(A.speed, 0, 'and the car has stopped');
  assert.ok(sounds.includes('hit'), 'with the crash sound');
});

test('a car cannot pass through another car at speed, and bounces off it', () => {
  const env = setup();
  const B = env.car(0, -15, Math.PI / 2), A = env.car(0, 0, 0), cars = [A, B];// B stands across A's path
  let bounced = false, minZ = 0;
  for (let i = 0; i < 90; i++) {env.others(cars, A);if (i === 0) A.speed = 30;A.move(1 / 30);minZ = Math.min(minZ, A.z);if (A.speed < 0) bounced = true;}
  assert.ok(minZ > -15, `A never got past B (closest z ${minZ.toFixed(2)})`);
  assert.ok(bounced, 'A bounced back a little');
  env.others(cars, A);assert.ok(A.overlap(A.x, A.z) < .05, 'and is not left inside B');
});

test('a motorcycle that is inside a car can ride out', () => {
  const env = setup();
  const B = env.car(0, -2, 0), M = new env.VH.Motorcycle(0, 0, 0, 0x56657c, {lazy: true}), cars = [B, M];M.active = true;
  env.others(cars, M);assert.ok(M.overlap(M.x, M.z) > .1, 'starts with its front wheel in the car');
  drive(env, cars, M, -1.5, 1.5);
  env.others(cars, M);assert.ok(M.overlap(M.x, M.z) < .01 && M.z > .5, `rolls back out (z ${M.z.toFixed(2)})`);
});
