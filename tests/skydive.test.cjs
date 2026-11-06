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

test('the game\'s pilot from the ground: waits, taxis onto the strip, holds behind the jump flight, then flies its profile without jumps', () => {
  const yaw = .5236, d = {x: -Math.sin(yaw), z: -Math.cos(yaw)}, n = {x: -d.z, z: d.x}, at = (a, l) => ({x: d.x * a + n.x * l, z: d.z * a + n.z * l});
  const ground = (x, z) => -(x * d.x + z * d.z) * .01;// the strip falls 1 m per 100 m
  const from = {...at(10, 16), yaw}, hold = {...at(26, 0), yaw};
  // Called at 440 s of the scheduled cycle: it is about to board on the strip ahead, so the pilot holds until 80 s.
  const G = S.pilotGround({t0: 440, from, hold, ground, gearH: 1.55});
  assert.equal(S.pilotFlight(445, G).phase, 'wait');
  const tx = S.pilotFlight(440 + 10 + G.taxiT / 2, G);assert.equal(tx.phase, 'taxi');assert.ok(tx.speed > 3 && tx.speed < 8, `taxi ${tx.speed}`);
  assert.ok(G.taxiT > 4 && G.taxiT < 12, `taxi takes ${G.taxiT} s`);
  assert.equal(G.rollAt, 480 + 80);const h = S.pilotFlight(500, G);assert.equal(h.phase, 'hold');assert.ok(Math.abs(h.left - 60) < .01);
  assert.ok(Math.hypot(h.x - hold.x, h.z - hold.z) < 1e-6);
  let prev = S.pilotFlight(440, G), maxJump = 0, top = -1e9, wheels = 0, phases = new Set();
  for (let t = 440.05; t < 1200; t += .05) {
    const f = S.pilotFlight(t, G);phases.add(f.phase);if (f.phase === 'done') break;
    maxJump = Math.max(maxJump, Math.hypot(f.x - prev.x, f.y - prev.y, f.z - prev.z) - Math.max(f.speed, prev.speed) * .05);
    if (['wait', 'taxi', 'hold', 'roll'].includes(f.phase)) wheels = Math.max(wheels, Math.abs(f.y - 1.55 - ground(f.x, f.z)));
    top = Math.max(top, f.y);prev = f;
  }
  assert.deepEqual([...phases], ['wait', 'taxi', 'hold', 'roll', 'climb', 'run', 'away', 'done']);
  assert.ok(maxJump < .6, `position jumps ${maxJump.toFixed(2)} m`);assert.ok(wheels < 1e-6, `wheels off the ground by ${wheels}`);
  assert.ok(Math.abs(top - (ground(hold.x, hold.z) + S.JUMP_AGL)) < .01, `jump height ${top}`);
  // The taxi never passes the scheduled flight's boarding place (45 m along the strip).
  for (let u = 0; u <= 1; u += .01) {const p = G.at(u);assert.ok(p.x * d.x + p.z * d.z <= 26 + 1e-9);}
  // At a quiet moment of the cycle it rolls as soon as it reaches the hold point.
  const Q = S.pilotGround({t0: 200, from, hold, ground});assert.equal(Q.rollAt, 200 + 10 + Q.taxiT);
});

test('the game\'s pilot in the air: takes the plane as it is, circles level toward home, at least 300 m up', () => {
  const O = S.pilotOrbit({t0: 0, pos: {x: 800, y: 1200, z: 0}, yaw: 0, speed: 48, vy: 5, roll: .4, toward: {x: 0, z: 0}, groundY: 0});
  const a = S.pilotFlight(0, O);assert.ok(Math.hypot(a.x - 800, a.y - 1200, a.z) < 1e-6, 'starts where the plane is');
  assert.ok(Math.abs(a.yaw) < 1e-6 && Math.abs(a.roll - .4) < 1e-6, 'and as it is');
  const b = S.pilotFlight(.1, O);assert.ok(Math.abs(b.x - 800) < .2 && b.z < -4.5, 'still flying the same way');
  const C = O.C;assert.ok(Math.hypot(C.x, C.z) < 800, 'circles on the side toward home');
  for (const t of [20, 60, 90]) {const f = S.pilotFlight(t, O);assert.ok(Math.abs(Math.hypot(f.x - C.x, f.z - C.z) - 650) < 1e-6);assert.ok(Math.abs(f.y - (1200 + 15)) < .5, `level at ${f.y}`);}
  const low = S.pilotOrbit({t0: 0, pos: {x: 0, y: 120, z: 0}, yaw: 1, speed: 30, vy: -2, ground: () => 20});
  assert.ok(S.pilotFlight(120, low).y >= 20 + 300 - 1e-6, 'climbs to 300 m above the ground');
});

test('freefall (issue #102): leaning forward tracks about 25 m/s, leaning back slides backwards, and the body leans with it', () => {
  const j = new S.Jumper({y: 3000, yaw: 0});run(j, 15, {fwd: 1});
  assert.ok(Math.abs(-j.vel.z - 25) < 3, `forward ${-j.vel.z}`);assert.ok(j.pose.pitch > .3, 'head down');
  const b = new S.Jumper({y: 3000, yaw: 0});run(b, 15, {fwd: -1});
  assert.ok(b.vel.z > 5, `backwards ${b.vel.z}`);assert.ok(b.pose.pitch < -.2, 'legs down');
  const t = new S.Jumper({y: 3000});run(t, 3, {turn: 1});assert.ok(t.pose.roll > .2, 'banks into the turn');
});

test('tricks in freefall: front loop, back loop and barrel roll, one at a time, not under the canopy', () => {
  const j = new S.Jumper({y: 3000});run(j, 5);
  assert.equal(j.startTrick('front'), true);assert.equal(j.startTrick('back'), false, 'one at a time');
  let minPitch = 0, maxPitch = 0;const ev = run(j, 2, J => {maxPitch = Math.max(maxPitch, J.pose.pitch);return {};});
  assert.deepEqual(ev, ['trick']);assert.equal(j.lastTrick, 'front');assert.ok(maxPitch > 5, 'a whole turn over the head');
  j.startTrick('back');run(j, 2, J => {minPitch = Math.min(minPitch, J.pose.pitch);return {};});assert.ok(minPitch < -5);
  let roll = 0;j.startTrick('roll', -1);run(j, 2, J => {roll = Math.min(roll, J.pose.roll);return {};});assert.ok(roll < -5, 'rolls to the left');
  assert.equal(j.tricks, 3);assert.equal(j.state, 'freefall');
  j.startTrick('front');run(j, .5, {pull: true});assert.equal(j.trick, null, 'pulling ends the trick');assert.equal(j.startTrick('front'), false);
});

test('canopy: the front risers dive (nose down, about 12 m/s down), one riser turns, and a dive then a flare lands softly', () => {
  const j = new S.Jumper({y: 800, yaw: 0});j.state = 'canopy';j.air = {fwd: 10, sink: 5};run(j, 5, {fwd: 1});
  assert.ok(-j.vel.y > 10 && Math.hypot(j.vel.x, j.vel.z) > 13, `dive ${-j.vel.y} down, ${Math.hypot(j.vel.x, j.vel.z)} across`);assert.ok(j.pose.pitch > .4, 'nose down');
  run(j, 8);assert.ok(Math.abs(-j.vel.y - 5) < .5, 'back to normal flight after letting go');
  const r = new S.Jumper({y: 800, yaw: 0});r.state = 'canopy';r.air = {fwd: 10, sink: 5};run(r, 3, {riser: -1});
  assert.ok(r.yaw > 2 && -r.vel.y > 8 && r.pose.roll < -.2, `left riser: turn ${r.yaw}, sink ${-r.vel.y}`);
  const s = new S.Jumper({y: 150});s.state = 'canopy';s.air = {fwd: 10, sink: 5};run(s, 60, J => ({fwd: J.agl > 30 ? 1 : J.agl < 4 ? -1 : 0}));assert.equal(s.landing, 'soft', 'a swoop');
  const c = new S.Jumper({y: 150});c.state = 'canopy';c.air = {fwd: 10, sink: 5};run(c, 60, {fwd: 1});assert.equal(c.landing, 'crash', 'diving into the ground');
});
