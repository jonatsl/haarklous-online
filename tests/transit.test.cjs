// Metro, bus and tram on a timetable (issue #111): the data, the clock-driven timetable and the metro stations' plans.
const test = require('node:test'), assert = require('node:assert');
const path = require('path'), root = path.join(__dirname, '..');
global.window = global;
const DATA = require(path.join(root, 'transit-data.js'));
const TT = require(path.join(root, 'transit-timetable.js'));
const TS = require(path.join(root, 'transit-stations.js'));
const TM = require(path.join(root, 'transit-models.js'));
const WC = require(path.join(root, 'walk-collision.js'));
const N = TT.decode(DATA);
const line = (mode, ref) => N.lines.find(l => l.mode === mode && l.ref === ref);
// 2026-11-16 is a Monday; Oslo is UTC+1 in November.
const oslo = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - TT.osloOffset(Date.UTC(y, mo - 1, d, h, mi));

test('the real lines are there, with stops in order inside the world', () => {
  for (const ref of ['11', '12', '13', '17', '18', '19']) assert.ok(line('tram', ref), 'tram ' + ref);
  for (const ref of ['1', '2', '3', '4', '5']) assert.ok(line('metro', ref), 'metro ' + ref);
  for (const ref of ['20', '21', '23', '30', '31', '34', '37', '54', '60']) assert.ok(line('bus', ref), 'bus ' + ref);
  for (const d of N.dirs) {
    assert.ok(d.stops.filter(s => s.place).length >= 2, `${d.line.ref} → ${d.to} has stops in the world`);
    for (let i = 1; i < d.stops.length; i++) assert.ok(d.stops[i].k > d.stops[i - 1].k, `${d.line.ref} → ${d.to}: stops in order`);
    assert.ok(d.run > 60 && d.run < 4 * 3600, `${d.line.ref} run ${d.run}`);
  }
  // Torshov: trams 11, 12 and 18 both ways and bus 20.
  const torshov = N.places.find(p => p.name === 'Torshov');
  for (const ref of ['11', '12', '18', '20']) assert.ok(torshov.lines.some(l => l.ref === ref), 'Torshov has ' + ref);
  // Metro stations near home.
  for (const n of ['Carl Berners plass', 'Sinsen', 'Tøyen', 'Løren', 'Ensjø', 'Grønland', 'Jernbanetorget', 'Økern', 'Hasle', 'Helsfyr']) assert.ok(N.stations.some(s => s.name === n), 'station ' + n);
});

test('the clock: Oslo time and service days', () => {
  assert.strictEqual(TT.osloOffset(Date.UTC(2026, 6, 1, 12)), 7200000);
  assert.strictEqual(TT.osloOffset(Date.UTC(2026, 10, 15, 12)), 3600000);
  assert.strictEqual(TT.osloOffset(Date.UTC(2026, 2, 29, 0, 59)), 3600000);// last Sunday of March, before 01:00 UTC
  assert.strictEqual(TT.osloOffset(Date.UTC(2026, 2, 29, 1, 0)), 7200000);
  const mon = TT.serviceDay(oslo(2026, 11, 16, 12)), early = TT.serviceDay(oslo(2026, 11, 17, 3, 30));
  assert.strictEqual(mon.dow, 1);
  assert.strictEqual(early.day, mon.day, '03:30 belongs to the day before');
  assert.strictEqual(TT.serviceDay(oslo(2026, 11, 17, 4, 30)).day, mon.day + 1);
});

test('headways like the real ones: trams every 10 min by day, 20 in the evening, none at night', () => {
  const d = line('tram', '11').dirs[0], deps = TT.departures(d, TT.serviceDay(oslo(2026, 11, 16, 12)).day);
  const gaps = at => {const i = deps.findIndex(t => t >= at);return (deps[i + 1] - deps[i]) / 60000;};
  assert.strictEqual(gaps(oslo(2026, 11, 16, 12)), 10);
  assert.strictEqual(gaps(oslo(2026, 11, 16, 21)), 20);
  assert.ok(!deps.some(t => t > oslo(2026, 11, 17, 1, 30) && t < oslo(2026, 11, 17, 5)), 'no trams in the night');
  const m = line('metro', '5').dirs[0], md = TT.departures(m, TT.serviceDay(oslo(2026, 11, 16, 12)).day), i = md.findIndex(t => t >= oslo(2026, 11, 16, 12));
  assert.strictEqual((md[i + 1] - md[i]) / 60000, 15);
  const b = line('bus', '20').dirs[0], bd = TT.departures(b, TT.serviceDay(oslo(2026, 11, 16, 12)).day), j = bd.findIndex(t => t >= oslo(2026, 11, 16, 12));
  assert.ok((bd[j + 1] - bd[j]) / 60000 <= 6);
  // Night buses only on Friday and Saturday nights.
  const nb = N.lines.find(l => l.night);
  assert.strictEqual(TT.departures(nb.dirs[0], TT.serviceDay(oslo(2026, 11, 16, 12)).day).length, 0);
  assert.ok(TT.departures(nb.dirs[0], TT.serviceDay(oslo(2026, 11, 20, 12)).day).length > 4);
});

test('a run: accelerate, cruise, brake, about 20 s at each stop with the doors open', () => {
  const d = line('tram', '11').dirs[0];
  let last = -1, maxV = 0;
  for (let tau = 0; tau < d.run - 1; tau += .5) {
    const s = TT.at(d, tau);if (!s) continue;
    assert.ok(s.d >= last - 1e-6, 'it never goes back');last = s.d;maxV = Math.max(maxV, s.v);
    if (s.doors > 0) assert.ok(s.dwelling && s.v === 0, 'doors open only when standing');
  }
  assert.ok(maxV > 10 && maxV <= 12.6, 'cruise speed ' + maxV);
  const st = d.stops.find(s => s.place && s.name === 'Torshov');
  assert.ok(Math.abs(d.TD[st.k] - d.TA[st.k] - 20) < 1e-6);
  const mid = TT.at(d, d.TA[st.k] + 10);
  assert.strictEqual(mid.doors, 1);assert.strictEqual(mid.d, st.k * TT.STEP);
});

test('everybody computes the same vehicles at the same places', () => {
  const N2 = TT.decode(DATA), t = oslo(2026, 11, 16, 8, 17);
  for (let i = 0; i < N.dirs.length; i += 5) {
    const a = TT.runsAt(N.dirs[i], t), b = TT.runsAt(N2.dirs[i], t);
    assert.deepStrictEqual(a.map(r => r.key), b.map(r => r.key));
    for (let k = 0; k < a.length; k++) assert.strictEqual(TT.at(N.dirs[i], a[k].tau).d, TT.at(N2.dirs[i], b[k].tau).d);
  }
  // At 08:17 on a Monday a few trams are out on line 11.
  assert.ok(TT.runsAt(line('tram', '11').dirs[0], t).length >= 1);
});

test('the next departures at a stop come in order and match the vehicles', () => {
  const d = line('tram', '18').dirs[0], si = d.stops.findIndex(s => s.place && s.name === 'Torshov'), t = oslo(2026, 11, 16, 9, 3);
  const next = TT.nextArrivals(d, si, t, 4);
  assert.strictEqual(next.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(next[i] > next[i - 1]);
  // When the first one is due, a tram of this line stands at Torshov.
  const s = TT.runsAt(d, next[0] + 5000).map(r => TT.at(d, r.tau)).find(q => q && q.k === d.stops[si].k);
  assert.ok(s && s.dwelling, 'the tram is at the stop when the board says so');
});

test('lines that share a stop are staggered (two vehicles seldom stand at one pole at once)', () => {
  const t0 = oslo(2026, 11, 16, 10), t1 = oslo(2026, 11, 16, 15);
  let clashes = 0, visits = 0;
  for (const pole of N.poles) {
    const arr = [];
    for (const d of pole.serves) {const si = d.stops.findIndex(s => s.pole === pole);if (si < 0) continue;for (const dep of TT.departures(d, TT.serviceDay(t0).day)) {const a = dep + d.stopTimes[si] * 1000;if (a > t0 && a < t1) arr.push(a);}}
    arr.sort((a, b) => a - b);visits += arr.length;
    for (let i = 1; i < arr.length; i++) if (arr[i] - arr[i - 1] < 20000) clashes++;
  }
  assert.ok(visits > 1000);
  assert.ok(clashes / visits < .12, `clashes ${clashes} of ${visits}`);
});

test('metro stations: from the entrance down the stairs to the platform on foot', () => {
  const ground = () => 0;
  for (const st of N.stations) {
    const stops = [];
    for (const d of N.dirs) if (d.line.mode === 'metro') for (const s of d.stops) if (s.place === st.place) {const p = TT.pointAt(d, s.d);let open = false;for (let k = Math.max(0, s.k - 35); k <= Math.min(d.n - 1, s.k + 35); k++) if (!d.tunnel[k]) open = true;stops.push({x: p.x, s: p.s, hx: p.hx, hs: p.hs, tunnel: !!d.tunnel[s.k], openNear: open});}
    const sp = TS.spec(st, stops, {ground, layer: -1}), L = TS.layout(sp, ground);
    if (!sp.underground) {assert.ok(L.floors.length >= 2);continue;}
    assert.ok(L.kiosk && L.cuts.length === 1, st.name + ' has an entrance');
    const inCut = (x, z) => {let r = false;const c = L.cuts[0];for (let i = 0, j = c.length - 1; i < c.length; j = i++) {const a = c[i], b = c[j];if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
    const floors = L.floors.map(f => {
      const points = f.points.map(([x, s]) => ({x, z: s}));
      if (f.slope) return {points, y: f.slope.y, slope: {x: -f.slope.dir[0] * f.slope.g, z: -f.slope.dir[1] * f.slope.g, origin: {x: f.slope.o[0], z: f.slope.o[1]}}};
      if (f.height === 'threshold') return {points, height: p => {const t = Math.max(0, Math.min(1, ((p.x - f.o[0]) * f.dir[0] + (p.z - f.o[1]) * f.dir[1]) / .8));return f.y * t;}};
      return {points, y: f.y};
    });
    const big = 400, c = sp.c;
    floors.push({points: [{x: c[0] - big, z: c[1] - big}, {x: c[0] + big, z: c[1] - big}, {x: c[0] + big, z: c[1] + big}, {x: c[0] - big, z: c[1] + big}], height: p => inCut(p.x, p.z) ? -1e4 : 0});
    const world = WC.createWorld({floors, obstacles: L.obstacles.map(o => ({points: o.points.map(([x, s]) => ({x, z: s})), minY: o.minY, maxY: o.maxY})), radius: .18, clearance: .08});
    const k = L.kiosk, at = (t, w = 0) => ({x: k.E[0] + k.dir[0] * t - k.dir[1] * w, z: k.E[1] + k.dir[1] * t + k.dir[0] * w});
    let p = {...at(-1.5)}, y = 0;
    const walk = (to, label) => {for (let i = 0; i < 4000; i++) {const dx = to.x - p.x, dz = to.z - p.z, D = Math.hypot(dx, dz);if (D < .15) return;const st2 = Math.min(.5, D), n = WC.move(world, p, {x: dx / D * st2, z: dz / D * st2}, 1.65, y);p = {x: n.x, z: n.z};y = n.y;}assert.fail(`${st.name}: stuck on the way to ${label} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}, y ${y.toFixed(2)}`);};
    walk(at(1.2), 'the door');walk(at(k.tB + 1.8), 'the stair foot');
    assert.ok(Math.abs(y - L.hall.my) < .05, st.name + ' at concourse level');
    for (const leg of L.corridor.legs) walk({x: leg.to[0], z: leg.to[1]}, 'the corridor');
    const s0 = L.stairs[0], P = (u, v) => {const q = TS.P(sp, u, v);return {x: q[0], z: q[1]};};
    walk(P(L.hall.m0 + .5, s0.vc), 'the stair top');walk(P(L.hall.m0 - TS.MEZZ / TS.GRADE - 1.5, s0.vc), 'the platform');
    assert.ok(Math.abs(y - sp.platform) < .05, `${st.name}: on the platform (${y} vs ${sp.platform})`);
  }
});

test('vehicle models: seats and doors in every kind', () => {
  for (const k of ['tram', 'bus', 'artic', 'metro']) {
    assert.ok(TM.seats(k).length >= 6, k + ' seats');assert.ok(TM.doors(k).length >= 2, k + ' doors');
    assert.ok(Math.abs(TM.KINDS[k].length - {tram: 35.4, bus: 12, artic: 18.1, metro: 108.45}[k]) < .2, k + ' length ' + TM.KINDS[k].length);
  }
});

// Walking through the vehicles (issue #142): the sections posed like game-transit's sectionsAt, on a straight line or a curve.
function fakeSections(kind, R) {
  const K = TM.KINDS[kind], P = d => R ? {x: R - R * Math.cos(d / R), z: R * Math.sin(d / R)} : {x: 0, z: d}, out = [];
  let head = K.length / 2;
  for (const S of K.sections) {
    const c = head - S.len / 2, F = P(c + S.len / 2 - .9), B = P(c - S.len / 2 + .9), dx = F.x - B.x, dz = F.z - B.z, L = Math.hypot(dx, dz);
    out.push({x: (F.x + B.x) / 2, y: 0, z: (F.z + B.z) / 2, yaw: Math.atan2(dx, dz), pitch: 0, len: S.len, fx: dx / L, fz: dz / L});
    head -= S.len + K.gap;
  }
  return out;
}
test('walking inside: the whole tram, the articulated bus and each metro set from end to end, not between the metro sets', () => {
  const walk = (kind, from, to) => {const pos = {u: from, x: 0};for (let i = 0; i < 4000 && Math.abs(pos.u - to) > .01; i++) TM.walkMove(kind, pos, Math.sign(to - pos.u) * Math.min(.04, Math.abs(to - pos.u)), 0);return pos.u;};
  for (const kind of ['tram', 'artic', 'bus']) {
    const P = TM.walkPlan(kind);
    assert.ok(Math.abs(walk(kind, P.u0, P.u1) - P.u1) < .02, kind + ' front to back');
    assert.ok(Math.abs(walk(kind, P.u1, P.u0) - P.u0) < .02, kind + ' back to front');
  }
  const M = TM.walkPlan('metro'), setEnd = M.starts[3] - TM.KINDS.metro.gap;// the back of car 3 of 6
  const got = walk('metro', M.u0, M.u1);assert.ok(got < setEnd && got > setEnd - .5, 'metro: stops at the end of the first set ' + got);
  assert.ok(Math.abs(walk('metro', M.u0, setEnd - .4) - (setEnd - .4)) < .02, 'metro: through the first set');
  assert.ok(Math.abs(walk('metro', M.starts[3] + 1, M.u1) - M.u1) < .02, 'metro: through the second set');
  assert.ok(walk('metro', M.starts[3] + 1, M.u0) > M.starts[3], 'metro: not back into the first set');
  // not through the seats, the side walls or a gangway's portal beside the opening
  for (const kind of ['tram', 'metro']) {
    for (const s of TM.seats(kind)) assert.ok(!TM.walkable(kind, TM.seatU(kind, s), s.x), kind + ' seat');
    assert.ok(!TM.walkable(kind, 10, TM.KINDS[kind].width / 2), kind + ' wall');
  }
  const T = TM.walkPlan('tram'), j0 = T.starts[1] - TM.KINDS.tram.gap / 2;
  assert.ok(TM.walkable('tram', j0, 0) && !TM.walkable('tram', j0, 1.0), 'tram joint: the opening only');
  // a little off the middle you are steered into the opening instead of stuck at the portal
  const pos = {u: j0 - .5, x: .7};for (let i = 0; i < 200; i++) TM.walkMove('tram', pos, .03, 0);
  assert.ok(pos.u > j0 + 1, 'steered through the gangway ' + JSON.stringify(pos));
});
test('walking inside: the floor follows the bent tram in a curve, with no jump at the joints', () => {
  for (const R of [0, 25, -18]) {
    const secs = fakeSections('tram', R), P = TM.walkPlan('tram');let last = null;
    for (let u = P.u0; u <= P.u1; u += .05) {
      for (const x of [-.5, 0, .5]) {
        const p = TM.pointAt('tram', secs, u, x, .35, {});
        assert.ok(Number.isFinite(p.x) && Math.abs(p.y - .35) < 1e-9, 'finite, on the floor');
        if (R) {const r = Math.hypot(p.x - R, p.z);assert.ok(Math.abs(r - Math.abs(R)) < 1.2, `R ${R} u ${u.toFixed(2)}: ${r.toFixed(2)} from the curve's centre`);}
        if (x === 0) {if (last) assert.ok(Math.hypot(p.x - last.x, p.z - last.z) < .08, `R ${R} u ${u.toFixed(2)}: a step of ${Math.hypot(p.x - last.x, p.z - last.z).toFixed(3)}`);last = p;}
      }
    }
  }
});
