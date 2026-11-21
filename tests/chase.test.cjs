const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game-chase.js');
const C2 = require('../walk-collision.js');

const open = {ground: () => 0, roof: () => Infinity, solid: () => false};
const run = (chase, target, rig, look, env, frames = 1, dt = 1 / 30) => {let o;for (let i = 0; i < frames; i++) o = chase.update(dt, target, rig, look, env);return o;};

test('the camera is farther back and higher for bigger vehicles', () => {
  const bike = C.rigFor({length: 1.8, height: 1.15}), car = C.rigFor({length: 4.2, height: 1.45}), lorry = C.rigFor({length: 8.2, height: 3.4});
  assert.ok(bike.dist < car.dist && car.dist < lorry.dist);
  assert.ok(bike.up <= car.up && car.up < lorry.up);
  assert.ok(car.dist > 5 && car.dist < 7, `car ${car.dist}`);
  for (const r of [bike, car, lorry]) assert.ok(r.aim < r.up);
});

test('behind and above a vehicle that faces -z (yaw 0), looking at it', () => {
  const rig = C.rigFor({length: 4.2, height: 1.45}), o = run(new C.Chase(), {x: 10, y: 5, z: 20, yaw: 0}, rig, {yaw: 0, pitch: 0}, open);
  assert.ok(Math.abs(o.x - 10) < 1e-6);
  assert.ok(o.z > 20 + rig.dist - .01, `z ${o.z}`);
  assert.ok(Math.abs(o.y - (5 + rig.up)) < 1e-6, `y ${o.y}`);
  assert.ok(o.az < 20 && o.ay > 5 && o.ay < o.y);// the aim point is a little ahead of the vehicle and below the camera
});

test('the heading follows a turn smoothly, not at once', () => {
  const rig = C.rigFor({length: 4.2, height: 1.45}), ch = new C.Chase(), look = {yaw: 0, pitch: 0};
  run(ch, {x: 0, y: 0, z: 0, yaw: 0}, rig, look, open);
  const one = {...run(ch, {x: 0, y: 0, z: 0, yaw: Math.PI / 2}, rig, look, open)};// update() reuses its result object
  assert.ok(ch.h > .05 && ch.h < Math.PI / 2 - .3, `after one frame ${ch.h}`);
  const later = run(ch, {x: 0, y: 0, z: 0, yaw: Math.PI / 2}, rig, look, open, 90);
  assert.ok(Math.abs(ch.h - Math.PI / 2) < .02);
  assert.ok(later.x > rig.dist - .1 && Math.abs(later.z) < .2, 'now behind the vehicle facing -x');
  assert.notDeepEqual([one.x, one.z], [later.x, later.z]);
});

test('turning the camera round the vehicle, and back behind it when you let go', () => {
  const look = {yaw: 0, pitch: 0};
  C.steer(look, Math.PI, 0, 1 / 30);
  assert.ok(Math.abs(Math.abs(look.yaw) - Math.PI) < 1e-9);
  const rig = C.rigFor({length: 4.2, height: 1.45}), o = run(new C.Chase(), {x: 0, y: 0, z: 0, yaw: 0}, rig, look, open);
  assert.ok(o.z < -rig.dist + .1, 'in front of the vehicle, looking back at it');
  for (let i = 0; i < 20; i++) C.steer(look, 0, 0, 1 / 30);// held still for less than 0.8 s: stays
  assert.ok(Math.abs(look.yaw) > 3);
  for (let i = 0; i < 150; i++) C.steer(look, 0, 0, 1 / 30);
  assert.ok(Math.abs(look.yaw) < .05, `eased back ${look.yaw}`);
  C.steer(look, 0, 5, 1 / 30);assert.equal(look.pitch, .9);// pitch has limits
});

test('never under the ground: a hill behind the vehicle brings the camera in', () => {
  const rig = C.rigFor({length: 4.2, height: 1.45}), hill = {...open, ground: (x, z) => z > 2 ? 6 : 0};
  const o = run(new C.Chase(), {x: 0, y: 0, z: 0, yaw: 0}, rig, {yaw: 0, pitch: 0}, hill);
  assert.ok(o.y > (o.z > 2 ? 6 : 0) + C.GAP - 1e-9, `y ${o.y} at z ${o.z}`);
  assert.ok(o.z < 2.1, `pulled in to ${o.z}`);
});

test('not through a wall: it moves closer, then eases back out when there is room', () => {
  const rig = C.rigFor({length: 4.2, height: 1.45}), ch = new C.Chase(), look = {yaw: 0, pitch: 0};
  const wall = {...open, solid: (x, y, z) => z > 3 && z < 3.4};
  const o = run(ch, {x: 0, y: 0, z: 0, yaw: 0}, rig, look, wall);
  assert.ok(o.z < 3, `in front of the wall: ${o.z}`);
  const near = ch.d;
  const back = run(ch, {x: 0, y: 0, z: 0, yaw: 0}, rig, look, open);
  assert.ok(ch.d > near && back.z < rig.dist, 'eases out, not at once');
  run(ch, {x: 0, y: 0, z: 0, yaw: 0}, rig, look, open, 120);
  assert.ok(Math.abs(ch.d - Math.hypot(rig.dist, rig.up - rig.aim)) < .05);
});

test('under a ceiling (a garage storey 3.4 m high) the camera stays below its slab', () => {
  const rig = C.rigFor({length: 4.2, height: 1.45}), garage = {...open, roof: () => 3.4};
  const o = run(new C.Chase(), {x: 0, y: 0, z: 0, yaw: 0}, rig, {yaw: 0, pitch: 0}, garage);
  assert.ok(o.y <= 3.4 - C.ROOF + 1e-9, `y ${o.y}`);
  assert.ok(o.z > 3, `still behind: ${o.z}`);
  // A lorry is taller than the storey: the look point is pulled under the ceiling too.
  const L = run(new C.Chase(), {x: 0, y: 0, z: 0, yaw: 0}, C.rigFor({length: 8.2, height: 3.4}), {yaw: 0, pitch: 0}, garage);
  assert.ok(L.y <= 3.4 - C.ROOF + 1e-9 && L.ay <= 3.4 - C.ROOF + 1e-9);
});

test('roofAt: the next storey above, a room ceiling, nothing in the open', () => {
  const rect = (x, z, w, d) => [{x, z}, {x: x + w, z}, {x: x + w, z: z + d}, {x, z: z + d}];
  const world = C2.createWorld({floors: [{points: rect(0, 0, 10, 10)}, {points: rect(0, 0, 10, 10), y: 3}, {points: rect(20, 0, 5, 5), ceilingHeight: 2.5}]});
  assert.equal(C2.roofAt(world, {x: 5, z: 5}, .5), 3);
  assert.equal(C2.roofAt(world, {x: 5, z: 5}, 3.5), Infinity);
  assert.equal(C2.roofAt(world, {x: 22, z: 2}, 1), 2.5);
  assert.equal(C2.roofAt(world, {x: 40, z: 40}, 0), Infinity);
  assert.equal(C2.floorAt(world, {x: 5, z: 5}, 2), 0);
  assert.equal(C2.floorAt(world, {x: 5, z: 5}, 4), 3);
  assert.equal(C2.floorAt(world, {x: 40, z: 40}, 4), -Infinity);
});
