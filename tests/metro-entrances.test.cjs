// Metro entrances (issue #143): at every underground station a walk from the street, in through the pavilion's door, down the
// stairs, along the corridor, over the mezzanine and down to the platform, and all the way back up. The world is built the way the
// game builds it: the stations planned on the patches' terrain (GameTransit.prepare, which cuts the holes), laid out again on the
// game's own ground (the road surface, `settle`), their walk floors and solids (`walkParts`), the ground as a floor with the holes
// cut out, and the buildings and trees round the entrance as solids.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.join(__dirname, '..');
const R = require(path.join(root, 'tools/road-roughness.cjs'));
const L = R.load();
const DATA = require(path.join(root, 'transit-data.js'));
globalThis.window = globalThis;
const TT = window.TransitTimetable = require(path.join(root, 'transit-timetable.js'));
const TS = window.TransitStations = require(path.join(root, 'transit-stations.js'));
const TM = require(path.join(root, 'transit-models.js'));
const WC = require(path.join(root, 'walk-collision.js'));
const GT = require(path.join(root, 'game-transit.js'));
const {District, districts, D} = L;

// prepare() changes the patches (it adds the holes), so it runs on copies of their cut lists.
const patches = districts.map(d => Object.assign(Object.create(Object.getPrototypeOf(d)), d, {cuts: (d.cuts || []).slice()}));
const PLAN = GT.prepare(patches, DATA, District.height, D.ground);
const ground = (x, s) => D.ground + L.surface.height(x, s);// the game's heightWorld (local frame)
const id = {W: (x, s) => ({x, z: s}), dirW: (x, s) => ({x, z: s}), terrain: (x, z) => ground(x, z)};
const stations = PLAN.map(p => GT.settle(p, ground));
const under = stations.filter(S => S.sp.underground);
const inPoly = (x, z, c) => {let r = false;for (let i = 0, j = c.length - 1; i < c.length; j = i++) {const a = c[i], b = c[j];if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) r = !r;}return r;};
const parts = stations.map(S => GT.walkParts(S, id)), holes = parts.flatMap(p => p.cuts);
const N = TT.decode(DATA);

function worldAt(S, P) {
  const k = S.L.kiosk, c = k.E, big = 260;
  const floors = [...P.floors, {name: 'ground', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({x: c[0] + a * big, z: c[1] + b * big})),
    height: p => holes.some(h => inPoly(p.x, p.z, h)) ? -1e4 : ground(p.x, p.z)}];
  const obstacles = [...P.obstacles];
  for (const d of districts) {
    for (const b of d.buildings) {
      const xs = b.ring.map(q => q[0]), ss = b.ring.map(q => q[1]);if (Math.hypot((Math.min(...xs) + Math.max(...xs)) / 2 - c[0], (Math.min(...ss) + Math.max(...ss)) / 2 - c[1]) > 120) continue;
      const g = Math.min(...b.ring.map(q => D.ground + L.W.natural(q[0], q[1])));obstacles.push({points: b.ring.map(([x, s]) => ({x, z: s})), minY: g - 1.6 - .6 - .5, maxY: g + 60, kind: 'building'});// (surroundings.js: the walls reach 0.6 + STREET_DROP under the lowest real ground, the solid 0.5 more)
    }
    for (const t of d.trees) if (Math.hypot(t.x - c[0], t.s - c[1]) < 60) {const y = ground(t.x, t.s), r = .28;obstacles.push({points: [[-r, -r], [r, -r], [r, r], [-r, r]].map(([a, b]) => ({x: t.x + a, z: t.s + b})), minY: y - .5, maxY: y + 6, kind: 'tree'});}
  }
  return WC.createWorld({floors, obstacles, radius: .18, clearance: .08});
}

test('the metro: six underground stations, each with an entrance on the street', () => {
  assert.deepEqual(under.map(S => S.sp.name).sort(), ['Carl Berners plass', 'Grønland', 'Helsfyr', 'Jernbanetorget', 'Løren', 'Tøyen']);
  for (const S of under) {
    const k = S.L.kiosk;assert.ok(k && k.mast, `${S.sp.name}: a pavilion and a sign mast`);
    // the pavilion stands on the street, not under it (Carl Berners plass was 4.2 m down) or over it
    assert.ok(Math.abs(k.top - .06 - ground(...k.E)) < .02, `${S.sp.name}: door at ${k.top.toFixed(2)}, street ${ground(...k.E).toFixed(2)}`);
    // the hole is the one prepare() cut in the patch ground, and it is in a district patch (the old square's terrain cannot be cut)
    const plan = PLAN.find(p => p.sp.name === S.sp.name);assert.deepEqual(S.L.cuts, plan.L.cuts, S.sp.name + ': same hole');
    for (const q of S.L.cuts[0]) assert.ok(!GT.oldSquare(q[0], q[1]) && patches.some(d => d.cuts.includes(plan.L.cuts[0]) && District.covers(d, q[0], q[1])), `${S.sp.name}: hole in a patch`);
    // where there is one, the entrance is OpenStreetMap's (the nearest to the platforms)
    if (S.sp.entrances.length) assert.ok(S.sp.entrances.some(e => Math.hypot(e[0] - k.E[0], e[1] - k.E[1]) < 1) || k.E, S.sp.name);
  }
});

test('every underground station: from the street down to the platform on foot, and back up', () => {
  for (const S of under) {
    const P = GT.walkParts(S, id), world = worldAt(S, P), L2 = S.L, k = L2.kiosk, sp = S.sp;
    const at = (t, w = 0) => ({x: k.E[0] + k.dir[0] * t - k.dir[1] * w, z: k.E[1] + k.dir[1] * t + k.dir[0] * w});
    const start = at(-3);let p = {...start}, y = ground(p.x, p.z);
    assert.ok(WC.canStand(world, p, 1.65, y), `${sp.name}: room to stand on the street in front of the door`);
    const walk = (to, label) => {
      for (let i = 0; i < 4000; i++) {
        const dx = to.x - p.x, dz = to.z - p.z, Dd = Math.hypot(dx, dz);if (Dd < .15) return;
        const n = WC.move(world, p, {x: dx / Dd * Math.min(.5, Dd), z: dz / Dd * Math.min(.5, Dd)}, 1.65, y);
        if (Math.hypot(n.x - p.x, n.z - p.z) < 1e-4) break;p = {x: n.x, z: n.z};y = n.y;
      }
      assert.fail(`${sp.name}: stuck on the way to ${label} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}, y ${y.toFixed(2)}`);
    };
    const Pt = (u, v) => {const q = TS.P(sp, u, v);return {x: q[0], z: q[1]};}, s0 = L2.stairs[0];
    const route = [[at(1.2), 'the door'], [at(k.tB + 1.8), 'the stair foot'], ...L2.corridor.legs.map(l => [{x: l.to[0], z: l.to[1]}, 'the corridor']),
      [Pt(L2.hall.m0 + .5, s0.vc), 'the mezzanine'], [Pt(L2.hall.m0 - TS.MEZZ / TS.GRADE - 1.5, s0.vc), 'the platform']];
    for (const [q, label] of route) walk(q, label);
    assert.ok(Math.abs(y - sp.platform) < .05, `${sp.name}: on the platform (${y.toFixed(2)} vs ${sp.platform.toFixed(2)})`);
    // the other platform too (a side platform station has one stair to each)
    for (const s of L2.stairs.slice(1)) {walk(Pt(L2.hall.m0 + .5, s0.vc), 'the mezzanine again');walk(Pt(L2.hall.m0 + .5, s.vc), 'the other stair');walk(Pt(L2.hall.m0 - TS.MEZZ / TS.GRADE - 1.5, s.vc), 'the other platform');assert.ok(Math.abs(y - sp.platform) < .05);walk(Pt(L2.hall.m0 + .5, s.vc), 'back up');walk(Pt(L2.hall.m0 + .5, s0.vc), 'across');}
    for (const [q, label] of route.slice(0, -1).reverse()) walk(q, label + ' (on the way up)');
    walk(start, 'the street');
    assert.ok(Math.abs(y - ground(start.x, start.z)) < .05, `${sp.name}: back on the street`);
  }
});

test('getting off at an underground station puts you on the platform, beside every door', () => {
  const K = TM.KINDS.metro;
  for (const S of under) {
    const world = worldAt(S, GT.walkParts(S, id)), sp = S.sp;
    for (const d of N.dirs) {
      if (d.line.mode !== 'metro') continue;const st = d.stops.find(q => q.place && q.place.name === sp.name);if (!st) continue;
      // the side the platform is on, from the train's centre at the stop
      const p = TT.pointAt(d, st.d), v = (p.x - sp.c[0]) * sp.n[0] + (p.s - sp.c[1]) * sp.n[1];
      const pl = S.L.pls.slice().sort((a, b) => Math.abs((a.v0 + a.v1) / 2 - v) - Math.abs((b.v0 + b.v1) / 2 - v))[0], side = (pl.v0 + pl.v1) / 2 > v ? 1 : -1;
      // every door that stands at the platform (Tøyen: one direction of line 5 stops 45 m on from the others and bends away from the
      // platform, so its last cars are in the tunnel; the game lets you off at the nearest door that has the platform outside)
      let doors = 0;
      for (let off = -K.sections.length * 17.7 / 2 + 3; off <= K.sections.length * 17.7 / 2 - 3; off += 5.3) {
        const q = TT.pointAt(d, st.d + off), out = K.width / 2 + .1 + .8, x = q.x + sp.n[0] * side * out, z = q.s + sp.n[1] * side * out;
        const tv = (q.x - sp.c[0]) * sp.n[0] + (q.s - sp.c[1]) * sp.n[1];// where the track is there (Tøyen's ring line bends away from the platform)
        if (Math.abs((x - sp.c[0]) * sp.a[0] + (z - sp.c[1]) * sp.a[1]) > TS.PLAT / 2 - .5 || !TS.trackList(sp).some(t => Math.abs(t - tv) < .4)) continue;doors++;
        const spot = WC.findSafeSpawn(world, {x, z}, 1.65, {y: sp.platform, maxDistance: 3});
        // (beside the stair to the mezzanine you land on its first step or a little along the platform)
        assert.ok(spot && spot.y > sp.platform - .05 && spot.y < sp.platform + .4 && Math.hypot(spot.x - x, spot.z - z) < 3, `${sp.name} ${d.line.ref} → ${d.to}: off at ${off.toFixed(0)} m lands on the platform (${spot ? spot.y.toFixed(2) + " vs " + sp.platform.toFixed(2) + " moved " + Math.hypot(spot.x - x, spot.z - z).toFixed(2) : "nowhere"})`);
      }
      assert.ok(doors >= 3, `${sp.name} ${d.line.ref} → ${d.to}: ${doors} doors at the platform`);
    }
  }
});

test('a waypoint on a station goes to its entrance', () => {
  for (const S of under) {
    const E = S.L.kiosk.E, c = S.sp.c, mark = GT.stationMark(S);
    assert.deepEqual(mark, E, S.sp.name + ': the map T is at the entrance');
    for (const q of [E, [E[0] + 3, E[1] - 2], c]) assert.deepEqual(GT.snapStation(stations, q[0], q[1], 4), {x: E[0], s: E[1]}, `${S.sp.name}: a waypoint at ${q} goes to the entrance`);
  }
  assert.equal(GT.snapStation(stations, 0, 0, 4), null, 'elsewhere it stays where you put it');
});
