// Helicopter and drone flight (issue #73): the rotor's thrust tilts with pitch and bank, so tilting costs climb.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../game-aircraft.js');

const warn = console.warn;console.warn = () => {};const T = require('../vendor/three.min.js');console.warn = warn;// its "deprecated build" notice
const lib = new Proxy({mergeStatic() {}}, {get: (o, k) => o[k] || (() => new T.MeshStandardMaterial())});
const audio = {sfx() {}, engine: () => ({set() {}, stop() {}})};
const AC = globalThis.GameAircraft.create({T, lib, audio, heightAt: () => 0, collision: {hitsSolid: () => false}, worldFor: () => null});
const DT = 1 / 60, deg = Math.PI / 180;

// The helicopter 300 m up with the rotor at speed, held at a fixed pitch (nose down > 0) and bank for `s` seconds: its climb rate then.
function heli(ly, pitch, bank = 0, s = 12) {
  const h = new AC.Helicopter(0, 0, 0);h.enter();h.rpm = 1;h.pos.set(0, 300, 0);h.grounded = false;
  const q = new T.Quaternion().setFromEuler(new T.Euler(-pitch, 0, -bank, 'YXZ'));
  for (let i = 0; i < s / DT; i++) {h.q.copy(q);h.w.set(0, 0, 0);h.update(DT, {ly});}
  return {climb: h.vel.y, speed: Math.hypot(h.vel.x, h.vel.z)};
}

test('helicopter: centre collective hovers when level and sinks when tilted', () => {
  assert.ok(Math.abs(heli(0, 0).climb) < .05, 'level hover holds');
  assert.ok(heli(0, 20 * deg).climb < -1, 'nose 20° down sinks');
  assert.ok(heli(0, 0, 20 * deg).climb < -1, 'banked 20° sinks');
});

test('helicopter: at full collective, pitching forward climbs less and speeds you up', () => {
  const up = heli(-1, 0), p15 = heli(-1, 15 * deg), p30 = heli(-1, 30 * deg), p45 = heli(-1, 45 * deg);
  assert.ok(up.climb > 7.5 && up.climb < 10, `about an H125's climb rate (${up.climb.toFixed(1)} m/s)`);
  assert.ok(p15.climb < up.climb - 1 && p30.climb < up.climb / 2 + .5 && p45.climb < 0, [up, p15, p30, p45].map(r => r.climb.toFixed(1)).join(' > '));
  assert.ok(p30.speed > p15.speed && p15.speed > up.speed, 'more tilt, more speed');
  assert.ok(Math.abs(heli(-1, 0, 30 * deg).climb - p30.climb) < .2, 'banking costs the same as pitching');
});

test('helicopter: top speed in level flight is about the H125’s never-exceed speed', () => {
  // Full collective, tilted so the climb is 0 (cos tilt = 1 / 1.4): the fastest it can fly level.
  const r = heli(-1, Math.acos(1 / 1.4), 0, 90);
  assert.ok(Math.abs(r.climb) < .3, `level (${r.climb.toFixed(2)} m/s)`);
  assert.ok(r.speed * 3.6 > 260 && r.speed * 3.6 < 310, `${(r.speed * 3.6).toFixed(0)} km/h`);
});

// The drone in angle mode with the left stick at `ly` and the right stick pushed `ry` (full tilt 0.75 rad) for `s` seconds.
function drone(ly, ry, s = 12) {
  const d = new AC.Drone();d.launch(0, 100, 0, 0);d.landed = false;
  const env = {floor: () => null, solid: () => false};
  for (let i = 0; i < s / DT; i++) d.update(DT, {ly, ry}, env);
  return {climb: d.vel.y, lost: 100.06 - d.pos.y, speed: Math.hypot(d.vel.x, d.vel.z)};
}

test('drone (angle mode): level it holds its height, tilted it sinks unless you add thrust', () => {
  assert.ok(Math.abs(drone(0, 0).climb) < .05, 'level hover holds');
  const tilt = drone(0, 1);
  assert.ok(tilt.climb < -1 && tilt.lost > 10, `full tilt sinks ${tilt.climb.toFixed(1)} m/s, ${tilt.lost.toFixed(0)} m in 12 s`);
  assert.ok(drone(0, .5).climb > tilt.climb, 'less tilt sinks less');
  assert.ok(drone(-1, 1).climb > 0, 'with thrust added it climbs while flying forward');
  assert.ok(tilt.speed > 10, 'and the tilt drives it forward');
});
