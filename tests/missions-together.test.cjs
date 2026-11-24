// The Arsenalet missions played together (issue #179): one player leads (runs the people and the transport), the others join
// and get them over the lobby. Several mission instances are wired to each other here the way the lobby wires them: each
// one's own state (opState, what game-main sends as st.op) reaches the others as JSON, five to ten times a second.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../game-weapons.js');
const DATA = require('../arsenal-data.js');
const OPS = require('../game-arsenal-ops.js');

// Three.js and the page are not needed for the rules: anything asked of them answers with itself.
const stub = new Proxy(function () {}, {get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub, set: () => true, apply: () => stub, construct: () => stub});
globalThis.document = stub;
const BANK = {at: (a, b) => ({x: 1000 + a, z: 500 + b}), y: 0, W: 14, D: 7.8, door: 3, vault: 11, inside: (x, z) => x > 1000 && x < 1014 && z > 500 && z < 509};
const HOME = {x: -300, z: 180, yaw: 0};

function lobby(n, {online = true, sight = Infinity} = {}) {
  const L = {players: [], clock: 1e6, frame: 0, sight};
  for (let i = 0; i < n; i++) {
    const p = {id: i + 1, name: `P${i + 1}`, player: {x: i * 2, z: 0, feet: 0, yaw: 0, stance: 'stand', mode: 'foot'}, st: null, notices: [], earned: [], sounds: [], vault: false, tracers: 0, speed: 0, input: {}, heal: true};
    const ctx = {get player() {return p.player;}, camera: {position: {x: 0, y: 1.6, z: 0}}, groundAt: () => 0, blockDist: () => L.sight, moveActor: (q, dx, dz) => ({x: q.x + dx, z: q.z + dz, y: 0}), clear: () => true,
      place: (x, z) => {p.player.x = x;p.player.z = z;}, notice: t => p.notices.push(t), earn: kr => p.earned.push(kr), waypoint: () => {}, startCase: () => {}, you: () => online ? p.id : 0, yourName: () => p.name, serverNow: () => L.clock,
      mates: () => L.players.filter(q => q !== p && q.st).map(q => ({id: q.id, name: q.name, x: q.player.x, y: q.player.feet, z: q.player.z, yaw: q.player.yaw, stance: q.player.stance, car: false, op: q.st})),
      stance: s => {p.player.stance = s;}};
    p.ops = OPS.create({T: stub, W, group: stub, avatars: {avatar: () => ({group: {position: {set() {}}, rotation: {}, visible: true}, joints: null, pose() {}, update() {}, dispose() {}})}, data: DATA, ctx, bank: BANK,
      toWorld: (x, s) => ({x, z: s}), home: () => HOME, loadout: () => [W.indexOf('hk416'), W.indexOf('g17'), W.indexOf('knife')], speed: () => p.speed, tracer: () => {p.tracers++;}, shotSound() {}, sfx: name => p.sounds.push(name), vault: v => {p.vault = !!v;}, fire() {}});
    L.players.push(p);
  }
  // One frame for everybody; every second frame the states go round, as JSON, like in the lobby.
  L.step = (dt = .05) => {
    L.clock += dt * 1000;L.frame++;
    for (const p of L.players) {if (p.heal && !p.ops.down) p.ops.state.hp = 100;p.ops.update(dt, p.input, true);}
    if (L.frame % 2 === 0) for (const p of L.players) {const s = p.ops.opState();p.st = s ? JSON.parse(JSON.stringify(s)) : null;}
  };
  L.run = (sec, dt = .05) => {for (let t = 0; t < sec; t += dt) L.step(dt);};
  L.until = (f, sec = 30, dt = .05) => {for (let t = 0; t < sec; t += dt) {if (f()) return true;L.step(dt);}return !!f();};
  return L;
}
const mission = (id, side) => OPS.MISSIONS.find(m => m.id === id && m.side === side);
const go = (p, x, z) => {p.player.x = x;p.player.z = z;};
// A shot from three metres in front of one of the people, into the chest.
const shootAt = (p, a, w = 'm82') => p.ops.shot({x: a.x, y: a.y + 1.2, z: a.z - 3}, {x: 0, y: 0, z: 1}, W.weapon(w), 7);

test('alone and offline a mission is the one-player mission: nothing is sent, and a shot player has lost', () => {
  const L = lobby(1, {online: false}), [a] = L.players;a.heal = false;
  a.ops.start(mission('heist', 'robber'));L.run(1);
  assert.equal(a.ops.opState(), null);assert.equal(a.ops.cur.actors.length, 5);assert.deepEqual(a.ops.crew, []);
  a.ops.debug.hurt(150, {x: 0, z: 0});
  assert.equal(a.ops.down, false);assert.equal(a.ops.result.win, false);assert.match(a.ops.result.text, /You were shot/);
  L.run(2);assert.equal(a.ops.cur, null);assert.deepEqual([a.player.x, a.player.z], [HOME.x, HOME.z]);
});

test('the bank, two together: the friend joins, sees the same people, fights, drills, carries, and both are paid', () => {
  const L = lobby(2), [a, b] = L.players;
  a.ops.start(mission('heist', 'robber'));L.run(1);
  assert.equal(b.ops.joinable().length, 1);assert.equal(b.ops.joinable()[0].def.name, 'Bank robbery');
  assert.ok(b.notices.some(t => /P1 started .Bank robbery/.test(t)), 'the friend is told a mission started');
  assert.ok(JSON.stringify(a.ops.opState()).length < 4000, 'the state fits well inside a lobby message');
  assert.equal(b.ops.join(a.id), true);L.run(1);
  assert.ok(a.notices.some(t => /P2 joined/.test(t)));assert.deepEqual(a.ops.crew.map(c => c.name), ['P2']);assert.deepEqual(b.ops.crew.map(c => c.name), ['P1']);
  const A = a.ops.cur.actors, Bm = b.ops.cur.actors;
  assert.equal(Bm.length, A.length);
  for (let i = 0; i < A.length; i++) {assert.equal(Bm[i].kind, A[i].kind);assert.ok(Math.hypot(Bm[i].x - A[i].x, Bm[i].z - A[i].z) < .3, `person ${i} stands in the same place`);assert.equal(Bm[i].w ? Bm[i].w.id : null, A[i].w ? A[i].w.id : null);}
  assert.equal(b.ops.cur.phase, 'go');assert.equal(b.ops.cur.obj, a.ops.cur.obj);
  // The friend walks in: the alarm goes on both computers and the guards shoot at the one they see.
  go(b, 1005, 505);
  assert.ok(L.until(() => a.ops.cur.phase === 'fight' && b.ops.cur.phase === 'fight', 3));assert.ok(b.sounds.includes('alarm'));
  b.heal = false;assert.ok(L.until(() => b.ops.hp < 100 || b.ops.down, 30), 'the guards hurt the friend');assert.ok(b.tracers > 0, 'and the friend sees their shots');
  assert.equal(a.ops.hp, 100);b.heal = true;
  // The friend's shots count on the leader's computer.
  const guards = A.filter(g => g.kind === 'guard');
  for (const g of guards) {for (let k = 0; k < 12 && g.alive; k++) {shootAt(b, Bm[g.i]);L.run(.2);}assert.equal(g.alive, false);}
  L.run(.5);assert.ok(guards.every(g => !Bm[g.i].alive));
  assert.equal(a.ops.cur.phase, 'vault');assert.equal(b.ops.cur.phase, 'vault');
  // The friend starts the drill and takes the bags; the vault opens for both.
  const v = a.ops.cur.vaultAt;go(b, v.x, v.z);go(a, v.x - 1, v.z - 1);
  let pr = b.ops.prompt();assert.match(pr.text, /drill/);pr.act();
  assert.ok(L.until(() => a.ops.cur.phase === 'drill', 2));assert.equal(Math.round(a.ops.cur.timer), 30);
  assert.ok(L.until(() => a.ops.cur.phase === 'loot' && b.ops.cur.phase === 'loot', 40, .1));assert.equal(b.vault, true);assert.equal(a.vault, true);
  assert.ok(a.ops.cur.actors.some(q => q.cop), 'the police came');assert.equal(b.ops.cur.actors.length, a.ops.cur.actors.length);
  for (let k = 0; k < 3; k++) {pr = (k % 2 ? a : b).ops.prompt();assert.match(pr.text, /bag/);pr.act();L.run(.4);}
  assert.equal(a.ops.cur.bags, 3);assert.equal(b.ops.cur.bags, 3);assert.equal(b.ops.cur.phase, 'escape');
  assert.match(a.ops.sub, /^\d+ m to the garage/);assert.match(b.ops.sub, /^\d+ m to the garage/);
  // One of them reaches the garage: done for both.
  const g = DATA.getaway.at;go(b, g[0], g[1]);
  assert.ok(L.until(() => a.ops.result && b.ops.result, 3));assert.equal(a.ops.result.win, true);assert.equal(b.ops.result.win, true);
  L.run(4);assert.equal(a.ops.cur, null);assert.equal(b.ops.cur, null);assert.deepEqual(a.earned, [4500]);assert.deepEqual(b.earned, [4500]);
  L.run(8);assert.equal(a.ops.opState(), null);assert.equal(b.ops.joinable().length, 0);
});

test('shot with friends you are down: a friend helps you up, alone you get up after a while, all down is lost', () => {
  const L = lobby(3), [a, b, c] = L.players;for (const p of L.players) p.heal = false;
  a.ops.start(mission('heist', 'police'));L.run(.5);assert.ok(b.ops.join(a.id));assert.ok(c.ops.join(a.id));L.run(.5);
  assert.equal(a.ops.crew.length, 2);assert.equal(c.ops.crew.length, 2);
  b.ops.debug.hurt(150, {x: 0, z: 0});L.run(.5);
  assert.equal(b.ops.down, true);assert.equal(b.player.stance, 'prone');assert.equal(b.ops.result, null);
  assert.equal(a.ops.crew.find(q => q.name === 'P2').down, true);assert.equal(c.ops.crew.find(q => q.name === 'P2').down, true);
  assert.equal(b.ops.prompt(), null);
  // Another member (not the leader) helps.
  go(c, b.player.x + 1, b.player.z);const pr = c.ops.prompt();assert.match(pr.text, /Help P2 up/);pr.act();
  assert.ok(L.until(() => !b.ops.down, 2));assert.equal(b.ops.hp > 50, true);assert.equal(b.player.stance, 'stand');
  // Nobody helps: up alone after half a minute.
  go(c, 50, 50);c.ops.debug.hurt(150, {x: 0, z: 0});assert.equal(c.ops.down, true);L.run(20, .1);assert.equal(c.ops.down, true);
  assert.ok(L.until(() => !c.ops.down, 15, .1));assert.ok(c.ops.hp > 0 && c.ops.hp < 60);
  // Everybody down at once.
  for (const p of L.players) p.ops.debug.hurt(150, {x: 0, z: 0});
  assert.equal(a.ops.down, true);
  assert.ok(L.until(() => L.players.every(p => p.ops.result), 3));
  for (const p of L.players) {assert.equal(p.ops.result.win, false);assert.match(p.ops.result.text, /Everybody is down/);}
  L.run(3);for (const p of L.players) {assert.equal(p.ops.cur, null);assert.deepEqual(p.earned, []);assert.deepEqual([p.player.x, p.player.z], [HOME.x, HOME.z]);assert.equal(p.player.stance, 'stand');}
});

test('the money transport, two together: the same trucks in the same place, the friend\'s shots stop one, both open and empty them', () => {
  const L = lobby(2), [a, b] = L.players;
  a.ops.start(mission('convoy', 'robber'));L.run(.5);assert.ok(b.ops.join(a.id));
  go(a, 3000, 3000);go(b, 3000, 3002);
  L.run(62, .1);
  const TA = a.ops.cur.trucks, TB = b.ops.cur.trucks;assert.equal(TB.length, 3);
  assert.ok(a.ops.cur.conv.s > 20, 'the transport is driving');
  for (let i = 0; i < 3; i++) assert.ok(Math.hypot(TA[i].x - TB[i].x, TA[i].z - TB[i].z) < 3, `vehicle ${i} is where the leader has it`);
  assert.equal(b.ops.solids().length, 3);assert.match(b.ops.sub, /^Transport: \d+ m away/);
  // The friend shoots the escort car until it stops.
  const car = TB[0];
  for (let k = 0; k < 40 && TA[0].hp > 0; k++) {b.ops.shot({x: car.x, y: car.y + 1, z: car.z - 12}, {x: 0, y: 0, z: 1}, W.weapon('m82'), 3);L.run(.2, .1);}
  assert.ok(TA[0].hp <= 0, 'the car is stopped by the friend');
  assert.ok(L.until(() => a.ops.cur.phase === 'fight' && b.ops.cur.phase === 'fight', 3));
  L.run(.5);assert.equal(a.ops.cur.actors.length, 6);assert.equal(b.ops.cur.actors.length, 6);assert.ok(b.sounds.includes('carDoor'));
  for (const g of a.ops.cur.actors) {for (let k = 0; k < 12 && g.alive; k++) {shootAt(b, b.ops.cur.actors[g.i]);L.run(.2, .1);}assert.equal(g.alive, false);}
  assert.ok(L.until(() => b.ops.cur.phase === 'breach', 2));
  // One sets the charges, the other takes the bags.
  const back = v => ({x: v.x + Math.sin(v.yaw) * (v.L / 2 + .9), z: v.z + Math.cos(v.yaw) * (v.L / 2 + .9)});
  for (const i of [1, 2]) {
    const q = back(TB[i]);go(b, q.x, q.z);let pr = b.ops.prompt();assert.match(pr.text, /charge/);pr.act();
    assert.ok(L.until(() => TA[i].open && TB[i].open, 6, .1));
    const qa = back(TA[i]);go(a, qa.x, qa.z);for (let k = 0; k < 2; k++) {pr = a.ops.prompt();assert.match(pr.text, /bag/);pr.act();L.run(.3, .1);}
    assert.equal(TB[i].bags, 0);
  }
  assert.equal(a.ops.cur.bags, 4);assert.ok(L.until(() => b.ops.cur.phase === 'escape' && b.ops.cur.bags === 4, 2));
  const g = DATA.getaway.at;go(a, g[0], g[1]);
  assert.ok(L.until(() => a.ops.result && b.ops.result, 3));L.run(4);assert.deepEqual(a.earned, [4800]);assert.deepEqual(b.earned, [4800]);
});

test('road blocks as the police, two together: the road blocks and their men are the same on both computers', () => {
  const L = lobby(2), [a, b] = L.players;
  a.ops.start(mission('convoy', 'police'));L.run(.5);assert.ok(b.ops.join(a.id));go(a, 3000, 3000);go(b, 3000, 3002);L.run(1);
  assert.equal(b.ops.cur.blocks.length, 2);assert.equal(b.ops.cur.actors.length, 8);
  assert.ok(JSON.stringify(a.ops.opState()).length < 6000);
  for (const m of a.ops.cur.blocks[0].men) {for (let k = 0; k < 12 && m.alive; k++) {shootAt(b, b.ops.cur.actors[m.i]);L.run(.2, .1);}assert.equal(m.alive, false);}
  assert.ok(L.until(() => b.ops.cur.blocks[0].clear, 2));assert.equal(b.ops.cur.blocks[1].clear, false);
  assert.ok(b.notices.some(t => /Road block cleared/.test(t)));
});

test('dealing, two together: the friend hands over; arresting as the police works for a member too', () => {
  // Nobody sees anybody here (every line of sight is blocked), so the police stay calm.
  let L = lobby(2, {sight: 0}), [a, b] = L.players;
  a.ops.start(mission('deal', 'robber'));L.run(.5);assert.ok(b.ops.join(a.id));L.run(.5);
  const buyer = b.ops.cur.actors.find(q => q.kind === 'customer');go(b, buyer.x + 1, buyer.z);L.run(1);
  let pr = b.ops.prompt();assert.match(pr.text, /Hand over/);pr.act();
  assert.ok(L.until(() => a.ops.cur.dealing, 1));assert.equal(a.ops.cur.dealing.who, b.id);
  assert.ok(L.until(() => a.ops.cur.left === 4, 5));assert.equal(a.ops.cur.cash, 600);
  L.run(.5);assert.equal(b.ops.cur.actors[buyer.i].done, true);assert.match(b.ops.sub, /Customers left: 4 · 600 kr/);
  // A hand-over stops when the one doing it walks off.
  const next = b.ops.cur.actors.find(q => q.kind === 'customer' && !q.done);go(b, next.x + 1, next.z);L.run(1);b.ops.prompt().act();assert.ok(L.until(() => a.ops.cur.dealing, 1));
  go(b, next.x + 30, next.z);L.run(1);assert.equal(a.ops.cur.dealing, null);assert.equal(a.ops.cur.left, 4);

  L = lobby(2, {sight: 0});[a, b] = L.players;
  a.ops.start(mission('deal', 'police'));L.run(.5);assert.ok(b.ops.join(a.id));L.run(.5);
  for (let k = 0; k < 3; k++) {
    const d = b.ops.cur.actors.find(q => q.kind === 'dealer' && !q.arrested);go(b, d.x + 1, d.z);pr = b.ops.prompt();assert.match(pr.text, /Arrest/);pr.act();
    assert.ok(L.until(() => a.ops.cur ? a.ops.cur.left === 2 - k : true, 2));L.run(.3);
  }
  assert.ok(L.until(() => a.ops.result && b.ops.result, 2));assert.equal(b.ops.result.win, true);L.run(4);assert.deepEqual(b.earned, [2000]);assert.deepEqual(a.earned, [2000]);
});

test('the leader leaves: the mission ends for the others; a member who leaves is no longer shot at', () => {
  const L = lobby(2), [a, b] = L.players;
  a.ops.start(mission('heist', 'police'));L.run(.5);assert.ok(b.ops.join(a.id));L.run(.5);
  b.ops.stop();L.run(.5);assert.deepEqual(a.ops.crew, []);assert.ok(a.notices.some(t => /P2 left/.test(t)));assert.equal(b.ops.opState(), null);
  assert.ok(b.ops.join(a.id));L.run(.5);assert.equal(a.ops.crew.length, 1);
  a.ops.stop();L.run(6);
  assert.equal(b.ops.cur, null);assert.ok(b.notices.some(t => /mission ended/.test(t)));assert.equal(b.ops.result, null);
  // The old hostage rescue cannot be joined.
  assert.equal(OPS.MISSIONS.find(m => m.id === 'hostage').solo, true);
});
