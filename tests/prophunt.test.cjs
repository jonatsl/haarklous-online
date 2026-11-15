// Prop hunt (issue #124): rules, roles, the clock, shots, points, leaving players, the admin taking over, the arenas.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
const P = require('../game-prophunt.js');
const DATA = require('../prophunt-data.js');
const {PH, KINDS} = P;

// A small world for the rules: local = world coordinates, flat ground, a clock we move by hand.
function world(clock) {
  return {serverNow: () => clock.t, toWorld: (x, s) => ({x, z: s}), toLocal: (x, z) => ({x, s: z}), ground: () => 0, random: (() => {let a = 7;return () => {a = (a * 16807) % 2147483647;return a / 2147483647;};})()};
}
// One player: its rules, where it stands and looks.
function player(id, name, clock, net) {
  const me = {id, name, pos: {x: 0, y: 0, z: 0}, yaw: 0, cam: null, fwd: null, notices: [], st: null};
  const ctx = {...world(clock), you: () => id, yourName: () => name, feet: () => ({...me.pos}), yaw: () => me.yaw,
    teleport: (x, z) => {me.pos = {x, y: 0, z};}, setPos: (x, z) => {me.pos = {x, y: 0, z};}, notice: t => me.notices.push(t),
    cameraPos: () => me.cam || {x: me.pos.x, y: 1.6, z: me.pos.z}, cameraFwd: () => me.fwd || {x: 0, y: 0, z: -1},
    others: () => net.filter(o => o !== me && o.st).map(o => P.memberFromJson(o.st, {id: o.id, name: o.name, local: false, feet: {...o.pos}, yaw: o.yaw}))};
  me.rules = new P.Rules(DATA, ctx);
  return me;
}
// Step every player: update, then publish its state (as the server relays 'st').
function step(net, clock, dt = .1, input = {}) {
  clock.t += dt * 1000;
  for (const p of net) p.rules.update(dt, input[p.id] || {});
  for (const p of net) p.st = p.rules.localState();
}
const run = (net, clock, s, input) => {for (let t = 0; t < s; t += .1) step(net, clock, .1, input);};
const aimAt = (p, x, y, z) => {const o = {x: p.pos.x, y: 1.6, z: p.pos.z}, d = {x: x - o.x, y: y - o.y, z: z - o.z}, L = Math.hypot(d.x, d.y, d.z);p.cam = o;p.fwd = {x: d.x / L, y: d.y / L, z: d.z / L};};

test('three arenas at real places, every thing inside its arena and a kind the game knows', () => {
  assert.equal(DATA.arenas.length, 3);
  for (const A of DATA.arenas) {
    assert.ok(A.props.length >= 25, `${A.id}: ${A.props.length} things`);
    for (const [k, x, s] of A.props) {assert.ok(KINDS[k], k);assert.ok(P.inZones(A.zones, x, s), `${A.id}: ${k} at ${x}, ${s}`);}
    assert.ok(P.inZones(A.zones, A.spawn[0], A.spawn[1]), `${A.id} spawn`);
    assert.ok(P.inZones(A.zones, A.ring[0], A.ring[1]) || A.zones.some(z => z.some(p => Math.hypot(p[0] - A.ring[0], p[1] - A.ring[1]) < 40)), `${A.id} ring`);
    const kinds = new Set(A.props.map(p => p[0]));assert.ok(kinds.size >= 8, `${A.id}: ${kinds.size} kinds`);
  }
});

test('hunters: 1 up to 4 players, 2 for 5–8, 3 for 9–12; everybody hunts before anybody hunts twice', () => {
  assert.deepEqual([1, 2, 4, 5, 8, 9, 12].map(P.hunterCount), [0, 1, 1, 2, 2, 3, 3]);
  for (const n of [2, 3, 5, 7, 12]) {
    const ids = Array.from({length: n}, (_, i) => i + 1), hunts = {}, last = {};
    const rounds = Math.ceil(n / P.hunterCount(n));
    for (let r = 1; r <= rounds; r++) {const H = P.pickHunters(ids, hunts, last, P.hunterCount(n), 99);assert.equal(H.length, P.hunterCount(n));for (const id of H) {hunts[id] = (hunts[id] || 0) + 1;last[id] = r;}}
    assert.ok(ids.every(id => hunts[id] >= 1), `${n} players: ${JSON.stringify(hunts)}`);
    assert.ok(Math.max(...Object.values(hunts)) - Math.min(...ids.map(id => hunts[id] || 0)) <= 1);
  }
});

test('the clock: hiding, hunting, the result; taunts every 30 s, every 12 s in the last 30 s', () => {
  const S = {...P.newSession(), id: 5, state: 'round', t0: 10000, hide: 30, hunt: 210};
  assert.equal(P.phaseOf(S, 10000), 'hide');assert.equal(P.phaseOf(S, 39999), 'hide');assert.equal(P.phaseOf(S, 40000), 'hunt');
  assert.equal(Math.round(P.timeLeft(S, 25000)), 15);assert.equal(Math.round(P.timeLeft(S, 40000)), 210);
  assert.equal(P.tauntDue(0, S, 30000), false);// hiding: never
  assert.equal(P.tauntDue(0, S, 69000), false);assert.equal(P.tauntDue(0, S, 70000), true);// 30 s into the hunt
  assert.equal(P.tauntDue(70000, S, 99000), false);assert.equal(P.tauntDue(70000, S, 100000), true);
  const late = 40000 + 190 * 1000;// 20 s left
  assert.equal(P.tauntDue(late - 11000, S, late), false);assert.equal(P.tauntDue(late - 12000, S, late), true);
  assert.equal(P.phaseOf({...S, state: 'end'}, 0), 'end');assert.equal(P.phaseOf(P.newSession(), 0), 'lobby');
});

test('bounds: inside the arena, and the nearest point inside when outside', () => {
  const Z = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[10, 4], [14, 4], [14, 6], [10, 6]]];
  assert.ok(P.inZones(Z, 5, 5) && P.inZones(Z, 12, 5) && !P.inZones(Z, 12, 8));
  assert.equal(P.clampToZones(Z, 5, 5), null);
  const c = P.clampToZones(Z, -3, 5);assert.ok(P.inZones(Z, c.x, c.s) && Math.abs(c.x) < .5);
  const d = P.clampToZones(Z, 13, 9);assert.ok(P.inZones(Z, d.x, d.s));
});

test('shots: a ray against a turned box standing on the ground', () => {
  const B = {x: 0, y: 0, z: -5, yaw: .4, w: 1.7, d: .6, h: .9};
  assert.ok(Math.abs(P.rayBox({x: 0, y: .5, z: 0}, {x: 0, y: 0, z: -1}, B) - (5 - .3 / Math.cos(.4))) < .2);
  assert.equal(P.rayBox({x: 0, y: 1.5, z: 0}, {x: 0, y: 0, z: -1}, B), Infinity);// over it
  assert.equal(P.rayBox({x: 3, y: .5, z: 0}, {x: 0, y: 0, z: -1}, B), Infinity);// beside it
  const tree = P.hitBox('tree', 0, 0, -5, 0);assert.equal(tree.length, 2);
});

test('points: finds, surviving, taunts (3 at most) and the winning side', () => {
  const pts = P.roundPoints({roles: {1: 'h', 2: 'p', 3: 'p', 4: 'p'}, found: {2: 1, 3: 1}, alive: {4: true}, taunts: {4: 5, 2: 1}, winner: 'p'});
  assert.deepEqual(pts, {1: 4, 2: 2, 3: 1, 4: 7});
  const all = P.roundPoints({roles: {1: 'h', 2: 'p'}, found: {2: 1}, alive: {}, taunts: {}, winner: 'h'});assert.deepEqual(all, {1: 3, 2: 0});
});

test('alone: the game hides four players, you shoot a real thing (−10), find them all and the hunters win', () => {
  const clock = {t: 1e6}, net = [];const me = player(7, 'Kari', clock, net);net.push(me);const R = me.rules, A = R.arenas[0];
  me.pos = {x: A.ring.x, y: 0, z: A.ring.z};
  step(net, clock);step(net, clock);assert.equal(R.ringAt, 0);assert.ok(R.isAdmin());
  run(net, clock, 1.3, {7: {crossHeld: true}});// hold ✕ to start
  assert.equal(R.ses.state, 'round');assert.equal(R.ses.roles[7], 'h');
  const bots = R.bots.filter(b => b.active);assert.equal(bots.length, 4);assert.ok(bots.every(b => b.role === 'p' && b.kind >= 0));
  run(net, clock, 2);assert.ok(R.inGame() && R.hunter() && R.frozen() && R.blind());
  run(net, clock, 30);assert.equal(R.phase(), 'hunt');assert.ok(bots.every(b => b.state === 'hid'));
  // A real thing: costs 10.
  const th = A.things.find(t => Math.hypot(t.x - me.pos.x, t.z - me.pos.z) > 3 && !bots.some(b => Math.hypot(b.x - t.x, b.z - t.z) < 2));
  me.pos = {x: th.x + 4, y: 0, z: th.z};aimAt(me, th.x, KINDS[th.kind].h * th.sc / 2, th.z);
  step(net, clock, .1, {7: {r2: 1}});step(net, clock);assert.equal(R.hp, PH.HUNTER_HP - PH.WRONG);
  // Every hider: walk round it to a side where no real thing is in the way, and shoot until it is found.
  for (const b of bots) {
    const y = KINDS[P.KIND_LIST[b.kind]].h * b.sc / 2;let side = 0;
    for (let a = 0; a < 16; a++) {me.pos = {x: b.x + Math.sin(a * .39) * 3, y: 0, z: b.z + Math.cos(a * .39) * 3};aimAt(me, b.x, y, b.z);const h = R.firstHit(me.cam, me.fwd, 7);if (h.what === 'hider' && h.id === b.id) {side = a;break;}}
    for (let k = 0; k < 8 && b.alive; k++) {
      me.pos = {x: b.x + Math.sin(side * .39) * 3, y: 0, z: b.z + Math.cos(side * .39) * 3};aimAt(me, b.x, y, b.z);
      step(net, clock, .4, {7: {r2: 1}});step(net, clock, .1);
    }
    assert.equal(b.alive, false, `bot ${b.id} (${P.KIND_LIST[b.kind]}) still in`);assert.equal(b.fb, 7);
  }
  step(net, clock);step(net, clock);
  assert.equal(R.ses.state, 'end');assert.equal(R.ses.winner, 'h');assert.equal(R.ses.score[7], 4 * 2 + 1);
  assert.ok(R.hidersLeft() === 0);
});

test('two players online: roles, a disguise, the forced whistle, a hit decided by the hider, and the roles swap in round 2', () => {
  const clock = {t: 5e6}, net = [];const a = player(1, 'Ola', clock, net), b = player(2, 'Kari', clock, net);net.push(a, b);
  const A = a.rules.arenas[1];a.pos = {x: A.ring.x, y: 0, z: A.ring.z};step(net, clock);b.pos = {x: A.ring.x + .5, y: 0, z: A.ring.z};step(net, clock);
  assert.ok(a.rules.isAdmin() && !b.rules.isAdmin());assert.equal(b.rules.adminId, 1);
  run(net, clock, 1.3, {1: {crossHeld: true}});run(net, clock, 1);
  assert.equal(a.rules.ses.arena, 1);
  const hunter = a.rules.ses.roles[1] === 'h' ? a : b, hider = hunter === a ? b : a;
  assert.equal(hider.rules.ses.roles[hider.id], 'p');assert.equal(b.rules.ses.id, a.rules.ses.id);
  // The hider becomes the thing it looks at and walks off.
  const th = A.things.find(t => t.kind === 'bench');hider.pos = {x: th.x + 2, y: 0, z: th.z};aimAt(hider, th.x, .4, th.z);
  step(net, clock, .1, {[hider.id]: {square: true}});assert.equal(P.KIND_LIST[hider.rules.kind], 'bench');
  hider.pos = {x: th.x + 3, y: 0, z: th.z + 1};
  run(net, clock, 2);
  const seen = hunter.rules.disguiseOf(hider.id);assert.equal(seen.kind, 'bench');assert.ok(Math.abs(seen.yaw - th.yaw) < 1e-3);
  assert.ok(hunter.rules.frozen());
  run(net, clock, 29);assert.equal(hunter.rules.phase(), 'hunt');
  // No whistle for 30 s, then the game makes the hider whistle; the hunter hears it.
  run(net, clock, 29);const w0 = hider.rules.w;run(net, clock, 1.5);assert.equal(hider.rules.w, w0 + 1);
  // The hunter shoots the bench-shaped player four times (bench: 100 health).
  for (let k = 0; k < 4; k++) {hunter.pos = {x: hider.pos.x + 4, y: 0, z: hider.pos.z};aimAt(hunter, hider.pos.x, .4, hider.pos.z);step(net, clock, .4, {[hunter.id]: {r2: 1}});step(net, clock, .1);step(net, clock, .1);}
  assert.equal(hider.rules.alive, false);assert.equal(hider.rules.foundBy, hunter.id);assert.equal(hunter.rules.hp, PH.HUNTER_HP);
  run(net, clock, .5);assert.equal(a.rules.ses.state, 'end');assert.equal(a.rules.ses.winner, 'h');assert.equal(b.rules.ses.winner, 'h');
  run(net, clock, PH.END_S + 1);
  assert.equal(a.rules.ses.round, 2);assert.equal(a.rules.ses.roles[hider.id], 'h');assert.equal(a.rules.ses.roles[hunter.id], 'p');
  assert.ok(hider.rules.alive && hider.rules.kind === -1);
});

test('a hunter who leaves ends the round for the hiders; the admin who leaves hands the match on', () => {
  const clock = {t: 9e6}, net = [];const ps = [1, 2, 3].map(i => player(i, 'P' + i, clock, net));net.push(...ps);
  const A = ps[0].rules.arenas[2];ps.forEach((p, i) => {p.pos = {x: A.ring.x + i * .3, y: 0, z: A.ring.z};step(net, clock);});
  run(net, clock, 1.3, {1: {crossHeld: true}});run(net, clock, 2);
  const S = ps[0].rules.ses, hunterId = +Object.keys(S.roles).find(id => S.roles[id] === 'h');assert.ok(hunterId);
  run(net, clock, 30);
  // The admin (1) leaves the lobby: 2 runs the match from its copy of the session.
  const admin = ps[0];net.splice(net.indexOf(admin), 1);run(net, clock, 1);
  const rest = net;assert.ok(rest.every(p => p.rules.adminId === 2));assert.equal(rest[0].rules.ses.id, S.id);
  if (hunterId === 1) {run(net, clock, 1);assert.equal(rest[0].rules.ses.state, 'end');assert.equal(rest[0].rules.ses.winner, 'p');return;}
  // The hunter leaves: the hiders win.
  const h = net.find(p => p.id === hunterId);net.splice(net.indexOf(h), 1);run(net, clock, 1);
  assert.equal(net[0].rules.ses.state, 'end');assert.equal(net[0].rules.ses.winner, 'p');
});

test('a hider cannot leave the arena; a late joiner watches until the next round', () => {
  const clock = {t: 2e6}, net = [];const a = player(1, 'A', clock, net), b = player(2, 'B', clock, net);net.push(a, b);
  const A = a.rules.arenas[0];a.pos = {x: A.ring.x, y: 0, z: A.ring.z};b.pos = {...a.pos};step(net, clock);step(net, clock);
  run(net, clock, 1.3, {1: {crossHeld: true}});run(net, clock, 2);
  const hider = a.rules.ses.roles[1] === 'p' ? a : b;hider.pos = {x: A.ring.x - 200, y: 0, z: A.ring.z};step(net, clock);
  assert.ok(P.inZones(A.zones, hider.pos.x, hider.pos.z), 'pushed back in');
  const c = player(3, 'C', clock, net);net.push(c);c.pos = {x: A.ring.x, y: 0, z: A.ring.z};run(net, clock, 1);
  assert.ok(c.rules.inGame() && !c.rules.role() && c.rules.spectating());assert.equal(a.rules.ses.roles[3], undefined);
  assert.deepEqual(a.rules.disguiseOf(3), {hidden: true});
});

test('the session survives the wire (with the game\'s players and their shots)', () => {
  const S = {...P.newSession(), id: 9, arena: 2, state: 'round', t0: 123, round: 2, rounds: 5, roles: {1: 'h', [-1]: 'p'}, score: {1: 3, [-1]: 2}, hunts: {1: 1}, last: {1: 2}, found: {[-1]: 1}, names: {1: 'Ola', [-1]: 'Kari'},
    bots: [{id: -1, role: 'p', x: 1.5, y: 0, z: 2.25, yaw: .5, kind: 3, pyaw: 1.25, hp: 50, alive: false, w: 2, fb: 1, tn: 1, sc: 1.1, out: [[1, 100, 0, 1.6, 0, 0, 0, -1]]}]};
  const back = P.sesFromJson(JSON.parse(JSON.stringify(P.sesToJson(S))));
  for (const k of ['id', 'arena', 'state', 't0', 'round', 'rounds']) assert.equal(back[k], S[k]);
  assert.deepEqual(back.roles, S.roles);assert.deepEqual(back.score, S.score);assert.deepEqual(back.lastPts, {});assert.deepEqual(back.found, S.found);assert.equal(back.names[-1], 'Kari');
  assert.equal(back.bots.length, 1);const b = back.bots[0];assert.equal(b.kind, 3);assert.equal(b.alive, false);assert.equal(b.fb, 1);assert.deepEqual(b.shots, [[1, 100, 0, 1.6, 0, 0, 0, -1]]);
  assert.equal(P.sesFromJson(null), null);assert.equal(P.memberFromJson({l: 5, h: [[1, 2, 3]]}, {}).shots.length, 0);
});

test('alone as a hider: the game\'s hunter follows the whistles, finds some of the hiders and seldom runs out of health', () => {
  let found = 0, out = 0, results = 0;
  for (let seed = 1; seed <= 8; seed++) {
    let a = seed * 7919;const rnd = () => {a = (a * 16807) % 2147483647;return a / 2147483647;};
    const clock = {t: 1e6}, me = {pos: {x: 0, y: 0, z: 0}};
    const R = new P.Rules(DATA, {serverNow: () => clock.t, toWorld: (x, s) => ({x, z: s}), toLocal: (x, z) => ({x, s: z}), ground: () => 0, random: rnd, you: () => 1, yourName: () => 'Me',
      feet: () => ({...me.pos}), yaw: () => 0, teleport: (x, z) => {me.pos = {x, y: 0, z};}, setPos: (x, z) => {me.pos = {x, y: 0, z};}, notice: () => {}, others: () => []});
    const A = R.arenas[1], step = (input = {}) => {clock.t += 100;R.update(.1, input);};
    me.pos = {x: A.ring.x, y: 0, z: A.ring.z};step();step();step({triangle: true});for (let i = 0; i < 13; i++) step({crossHeld: true});step();
    assert.equal(R.ses.arena, 1);// Olaf Ryes plass: the ring you stand in
    assert.equal(R.role(), 'p');const hunter = R.bots.find(b => b.active && b.role === 'h');assert.ok(hunter);
    const kinds = [...new Set(R.arena.things.map(t => t.kind))], th = R.arena.things.find(t => t.kind === kinds[seed % kinds.length]);
    const s = P.botSpot(R.arena.things, th.kind, [], rnd, () => true);me.pos = {x: s.x, y: 0, z: s.z};R.become(th);
    for (let t = 0; t < 400 && R.ses.state === 'round'; t += .1) step();
    assert.equal(R.ses.state, 'end');results++;
    found += R.bots.filter(b => b.active && b.role === 'p' && !b.alive).length + (R.alive ? 0 : 1);if (hunter.hp <= 0) out++;
  }
  assert.equal(results, 8);assert.ok(found >= 4, `found ${found} of 32 hiders`);assert.ok(out <= 3, `hunter out of health ${out} of 8 rounds`);
});

// ---------- Places: the arenas against the streets, the tram lines and the other games' places ----------
test('the arenas keep off the carriageways, the tram lines, the paintball yard, the minigolf courses and each other', () => {
  const District = require('../district.js');require('../surroundings-data.js');require('../gamle-oslo-data.js');require('../paintball-data.js');
  const MG = require('../minigolf-data.js'), TT = require('../transit-timetable.js'), TR = require('../transit-data.js');
  const D = window.SURROUNDINGS, G = District.decode(window.DISTRICTS.find(d => d.name === 'gamle-oslo')), PB = window.PAINTBALL;
  const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
  const CAR = ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'living_street', 'trunk', 'tram', 'rail'];
  const roads = [...D.roads, ...G.roads].filter(r => CAR.includes(r.k)).map(r => ({k: r.k, w: r.w, p: pairs(r.p)}));
  for (const A of DATA.arenas) {
    const pts = A.zones.flat(), x0 = Math.min(...pts.map(p => p[0])) - 15, x1 = Math.max(...pts.map(p => p[0])) + 15, s0 = Math.min(...pts.map(p => p[1])) - 15, s1 = Math.max(...pts.map(p => p[1])) + 15;
    const near = p => p[0] > x0 && p[0] < x1 && p[1] > s0 && p[1] < s1;
    // A carriageway may touch an arena's edge by half a metre at most (the bounds follow the kerb).
    for (const r of roads) for (let i = 0; i + 1 < r.p.length; i++) {
      const a = r.p[i], b = r.p[i + 1];if (!near(a) && !near(b)) continue;const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / .5)), u = [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)];
      for (let k = 0; k <= n; k++) for (let o = -(r.w / 2 - .5); o <= r.w / 2 - .5 + 1e-9; o += .5) {
        const x = a[0] + (b[0] - a[0]) * k / n - u[1] * o, s = a[1] + (b[1] - a[1]) * k / n + u[0] * o;
        assert.ok(!P.inZones(A.zones, x, s), `${A.id}: the ${r.k} carriageway at ${x.toFixed(1)}, ${s.toFixed(1)}`);
      }
    }
    // Tram and bus lines (issue #111): none runs through an arena.
    for (const d of TT.decode(TR).dirs) for (let i = 0; i < d.X.length; i += 2) assert.ok(!P.inZones(A.zones, d.X[i], d.S[i]), `${A.id}: ${d.line.mode} ${d.line.ref} at ${d.X[i].toFixed(0)}, ${d.S[i].toFixed(0)}`);
    // The paintball yard and its lobby, and the minigolf courses.
    const R = PB.rect, L = PB.lobby, inRect = (r, x, s) => x > r.x0 && x < r.x0 + r.w && s > r.s0 && s < r.s0 + r.d;
    for (const z of A.zones) for (const p of z) {assert.ok(!inRect(R, p[0], p[1]) && !inRect(L, p[0], p[1]), `${A.id}: paintball`);}
    for (const c of MG.courses) if (c.outline) for (const p of c.outline) assert.ok(!P.inZones(A.zones, p[0], p[1]), `${A.id}: minigolf ${c.id}`);
    for (const B of DATA.arenas) if (B !== A) for (const z of B.zones) for (const p of z) assert.ok(!P.inZones(A.zones, p[0], p[1]), `${A.id} and ${B.id}`);
  }
});
