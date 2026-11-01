const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../game-skydive.js');
const flat = {ground: () => 0, wind: {x: 0, z: 0}};
const run = (j, secs, inp = {}, env = flat, dt = 1 / 60) => {let ev = [];for (let t = 0; t < secs && j.state !== 'landed'; t += dt) {const e = j.update(dt, typeof inp === 'function' ? inp(j) : inp, env);if (e) ev.push(e);}return ev;};

test('freefall: about 54 m/s down after 15 s, tracking is faster across and a little slower down', () => {
  const j = new S.Jumper({y: 3000});run(j, 15);
  assert.ok(Math.abs(-j.vel.y - 54) < 1.5, `${-j.vel.y}`);assert.ok(Math.hypot(j.vel.x, j.vel.z) < .5);
  const k = new S.Jumper({y: 3000});run(k, 15, {fwd: 1});
  assert.ok(Math.hypot(k.vel.x, k.vel.z) > 15, 'tracks across');assert.ok(-k.vel.y < 50 && -k.vel.y > 42, `${-k.vel.y}`);
});

test('the canopy opens in 3 s, then flies about 10 m/s forward and 5 m/s down; the real wind carries it', () => {
  const j = new S.Jumper({y: 1500});run(j, 20);const ev = run(j, 4, {pull: true});
  assert.deepEqual(ev, ['pull', 'open']);assert.equal(j.state, 'canopy');run(j, 5);
  assert.ok(Math.abs(-j.vel.y - 5) < .2 && Math.abs(Math.hypot(j.vel.x, j.vel.z) - 10) < .3);
  const w = new S.Jumper({y: 1500, yaw: 0});w.state = 'canopy';w.air = {fwd: 10, sink: 5};run(w, 3, {}, {ground: () => 0, wind: {x: 4, z: 0}});
  assert.ok(Math.abs(w.vel.x - 4) < .01 && Math.abs(w.vel.z + 10) < .01, 'facing -z at 10 m/s plus 4 m/s of wind toward +x');
});

test('a flare slows the canopy for about 3 s, then it stalls; the right flare gives a soft landing', () => {
  const j = new S.Jumper({y: 500});j.state = 'canopy';j.air = {fwd: 10, sink: 5};
  run(j, 1, {fwd: -1});assert.ok(-j.vel.y < 2.2, `sink ${-j.vel.y}`);run(j, 3, {fwd: -1});assert.ok(-j.vel.y > 6, `stall ${-j.vel.y}`);
  const a = new S.Jumper({y: 60});a.state = 'canopy';a.air = {fwd: 10, sink: 5};run(a, 60);assert.equal(a.landing, 'hard', 'no flare: about 5 m/s');
  const b = new S.Jumper({y: 60});b.state = 'canopy';b.air = {fwd: 10, sink: 5};run(b, 60, j => ({fwd: j.agl < 4 ? -1 : 0}));assert.equal(b.landing, 'soft');
});

test('without a pull the reserve opens at 300 m and you still land under a canopy', () => {
  const j = new S.Jumper({y: 3000});const ev = run(j, 400);
  assert.deepEqual(ev, ['reserve', 'open', 'land']);assert.ok(j.reserve);assert.notEqual(j.landing, 'crash');
});

test('the scheduled flight: boards, rolls, climbs to 3000 m, flies a straight jump run with a green light, all without jumps', () => {
  const P = S.plan({start: {x: 0, z: 0}, yaw: .5236, groundY: -10, gearH: 1.55});
  assert.equal(S.flight(0, P).phase, 'board');assert.equal(S.flight(470, P).phase, 'board');assert.ok(S.flight(0, P).leavesIn > 74);
  let prev = S.flight(75, P), maxJump = 0;
  for (let t = 75.05; t < 455; t += .05) {const f = S.flight(t, P), d = Math.hypot(f.x - prev.x, f.y - prev.y, f.z - prev.z);maxJump = Math.max(maxJump, d - Math.max(f.speed, prev.speed) * .05);prev = f;}
  assert.ok(maxJump < .6, `position jumps ${maxJump.toFixed(2)} m`);
  const run0 = S.flight(250, P), run1 = S.flight(300, P);
  assert.equal(run0.phase, 'run');assert.ok(run0.green && run1.green && !S.flight(246, P).green);assert.equal(run0.y, P.groundY + S.JUMP_AGL);
  assert.ok(Math.abs(Math.hypot(run1.x - run0.x, run1.z - run0.z) - 48 * 50) < .01, 'straight and level at 48 m/s');
  // In the climbing spiral it banks into the turn (about 20°): the bank has the same sign as the turn (yaw rate).
  const sp = S.flight(150, P), sp2 = S.flight(151, P), yawRate = Math.atan2(Math.sin(sp2.yaw - sp.yaw), Math.cos(sp2.yaw - sp.yaw));
  assert.ok(Math.abs(sp.roll) > .2 && Math.abs(sp.roll) < .5 && Math.sign(sp.roll) === Math.sign(yawRate), `bank ${sp.roll}, turn ${yawRate}`);
});
