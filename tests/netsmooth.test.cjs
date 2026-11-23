const test = require('node:test');
const assert = require('node:assert/strict');
const NS = require('../game-netsmooth.js');

// A seeded random number generator, so the jitter is the same every run.
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// The driver: a car at `speed` m/s along -z (yaw 0), sending every `every` s (its own frames), with a trip time of
// 40 ms + up to `jitter` s; the receiver draws at 60 fps. Returns the shown poses and the true positions at those moments.
function drive({speed = 20, every = .1, jitter = .06, secs = 6, gapFrom = Infinity, gapTo = -Infinity, path = t => ({x: 0, z: -speed * t, yaw: 0}), seed = 7} = {}) {
  const r = rng(seed), msgs = [];
  for (let t = 0; t < secs; t += every * (.85 + .3 * r())) {
    if (t >= gapFrom && t < gapTo) continue;// lost updates
    const p = path(t);msgs.push({at: t + .04 + jitter * r(), s: [p.x, 1, p.z, p.yaw, 0, 0, speed, 0], stamp: t});
  }
  msgs.sort((a, b) => a.at - b.at);
  const tr = new NS.Track(NS.layout(8, false)), shown = [];let k = 0;
  for (let now = 0; now < secs; now += 1 / 60) {
    while (k < msgs.length && msgs[k].at <= now) {tr.push(msgs[k].s, msgs[k].stamp, msgs[k].at);k++;}
    const o = tr.sample(now);if (o) shown.push({now, x: o[0], z: o[2], yaw: o[3], delay: tr.delay});
  }
  return shown;
}

test('channel layouts: ground vehicles and aircraft', () => {
  assert.equal(NS.layout(8, false), 'lllaaall');
  assert.equal(NS.layout(7, false), 'lllaaal');
  assert.equal(NS.layout(11, true), 'lllqqqqllls');
});

test('a car at 72 km/h with jittery updates moves the same distance every frame', () => {
  const s = drive({speed: 20, jitter: .06}).filter(p => p.now > 1);
  let worst = 0;
  for (let i = 1; i < s.length; i++) {const v = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z) * 60;worst = Math.max(worst, Math.abs(v - 20));}
  assert.ok(worst < 2.5, `speed on screen off by up to ${worst.toFixed(2)} m/s`);// about 10 %: the render clock's nudge
});

test('the car on the screen is at most about a quarter of a second behind', () => {
  const s = drive({speed: 20, jitter: .06}).filter(p => p.now > 1);
  for (const p of s) {const behind = (-p.z) / 20;assert.ok(p.now - behind < .26, `${(p.now - behind).toFixed(3)} s behind at ${p.now.toFixed(2)}`);}
  assert.ok(s.every(p => p.delay <= NS.DEFAULTS.maxDelay + 1e-9));
});

test('the heading takes the short way round through ±180°', () => {
  const tr = new NS.Track(NS.layout(7, false));
  tr.push([0, 0, 0, 3.1, 0, 0, 0], 0, .04);tr.push([0, 0, 0, -3.1, 0, 0, 0], .1, .14);
  const o = tr.evalAt(.05, new Array(7));
  assert.ok(Math.abs(Math.abs(o[3]) - Math.PI) < .02, `yaw ${o[3]}`);
});

const steps = s => {let worst = 0;for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i].z - s[i - 1].z));return worst;};

test('one or two lost updates: the car keeps moving smoothly (no freeze, no jump)', () => {
  const s = drive({speed: 20, jitter: .03, gapFrom: 2, gapTo: 2.15, secs: 4});// 20 m/s: 0.33 m a frame
  const worst = steps(s.filter(p => p.now > 1));
  assert.ok(worst < .33 * 1.25, `largest step ${worst.toFixed(2)} m`);
  assert.ok(!s.some((p, i) => i && p.now > 1 && Math.abs(p.z - s[i - 1].z) < 1e-9), 'it stood still');
});

test('a long gap: extrapolates at most 0.2 s, then holds, and eases back without a snap', () => {
  const s = drive({speed: 10, jitter: .02, gapFrom: 2, gapTo: 2.8, secs: 5});
  // Never ahead of the true car.
  for (const p of s) assert.ok(-p.z <= 10 * p.now + 1e-6, `ahead at ${p.now.toFixed(2)}`);
  // It held still for a while (frames with no motion) during the gap ...
  const still = s.filter((p, i) => i && p.now > 2 && p.now < 3.2 && Math.abs(p.z - s[i - 1].z) < 1e-9).length;
  assert.ok(still > 5, `${still} still frames`);
  // ... and catches up the ~5 m over several frames (at most about 1 m in one frame, not all at once).
  const worst = steps(s);assert.ok(worst < 1, `largest step ${worst.toFixed(2)} m`);
});

test('a smooth turn is followed (position and heading together)', () => {
  const R = 30, w = 12 / R;// 12 m/s round a 30 m circle
  const circ = t => ({x: R * (Math.cos(w * t) - 1), z: -R * Math.sin(w * t), yaw: w * t});
  const s = drive({speed: 12, path: circ, jitter: .05}).filter(p => p.now > 1);
  for (const p of s) assert.ok(Math.abs(Math.hypot(p.x + R, p.z) - R) < .15, `off the circle by ${Math.abs(Math.hypot(p.x + R, p.z) - R).toFixed(3)} m`);
  let worst = 0;for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs((s[i].yaw - s[i - 1].yaw) * 60 - w));
  assert.ok(worst < w * .3, `turn rate off by ${worst.toFixed(3)} rad/s`);
});

test('aircraft: the quaternion is slerped and "on the ground" is a step', () => {
  const tr = new NS.Track(NS.layout(11, true)), h = Math.SQRT1_2;
  tr.push([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1], 0, .05);tr.push([10, 0, 0, 0, h, 0, h, 0, 0, 0, 0], .1, .15);
  const o = tr.evalAt(.05, new Array(11));
  assert.ok(Math.abs(o[0] - 5) < 1e-9);
  assert.ok(Math.abs(Math.hypot(o[3], o[4], o[5], o[6]) - 1) < 1e-9);
  assert.ok(Math.abs(o[4] - Math.sin(Math.PI / 8)) < 1e-6, `half of 90° about y: ${o[4]}`);
  assert.equal(o[10], 1);
});

test('a jump of many metres (respawn, new lobby) snaps instead of sliding', () => {
  const tr = new NS.Track(NS.layout(7, false));
  for (let i = 0; i < 10; i++) {tr.push([0, 0, -i, 0, 0, 0, 10], i / 10, i / 10 + .04);tr.sample(i / 10 + .05);}
  tr.push([500, 0, 500, 0, 0, 0, 0], 1, 1.04);
  const o = tr.sample(1.1);
  assert.equal(o[0], 500);assert.equal(o[2], 500);
});

test('no time stamps (an older game): arrival times stand in, still smooth', () => {
  const tr = new NS.Track(NS.layout(7, false)), r = rng(3), out = [];let next = 0, i = 0;
  for (let now = 0; now < 4; now += 1 / 60) {
    if (now >= next) {tr.push([0, 0, -20 * now, 0, 0, 0, 20], null, now);i++;next = now + .1 * (.9 + .2 * r());}
    const o = tr.sample(now);if (o) out.push(o[2]);
  }
  let worst = 0;for (let k = 61; k < out.length; k++) worst = Math.max(worst, Math.abs((out[k - 1] - out[k]) * 60 - 20));
  assert.ok(worst < 4, `speed off by ${worst.toFixed(2)} m/s`);
});
