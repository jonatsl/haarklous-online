const test = require('node:test');
const assert = require('node:assert/strict');
const GW = require('../game-weapons.js');
const DATA = require('../arsenal-data.js');
const {WEAPONS, weapon, indexOf, LADDER, damageAt, spreadOf, Gun, rayFigure, CAMO, camoFactor, aimError, Arena, AR} = GW;

test('the arsenal: many different weapons with sensible, real numbers', () => {
  assert.ok(WEAPONS.length >= 16);
  assert.equal(new Set(WEAPONS.map(w => w.id)).size, WEAPONS.length);
  for (const cls of ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'bow', 'knife']) assert.ok(WEAPONS.some(w => w.cls === cls), cls);
  for (const w of WEAPONS) {
    assert.ok(w.mag >= 1 && w.rpm > 0 && w.dmg > 0 && w.min <= w.dmg && w.r1 >= w.r0, w.id);
    if (!w.melee) assert.ok(w.ads <= w.hip && w.reload > 0 && w.v0 > 50, w.id);
  }
  assert.equal(weapon('ak47').cal, '7.62 × 39 mm');assert.equal(weapon('g17').mag, 17);assert.equal(weapon('hk416').rpm, 850);
  for (const id of LADDER) assert.ok(WEAPONS.some(w => w.id === id), id);
  assert.equal(LADDER[LADDER.length - 1], 'knife');assert.equal(new Set(LADDER).size, LADDER.length);
});

test('damage falls with the distance, a head shot counts more, a vest less', () => {
  const ak = weapon('ak47');
  assert.equal(damageAt(ak, 5), ak.dmg);assert.equal(damageAt(ak, 1000), ak.min);
  let last = Infinity;for (let d = 0; d < 400; d += 10) {const v = damageAt(ak, d);assert.ok(v <= last + 1e-9);last = v;}
  assert.ok(damageAt(ak, 20, true) > 2 * damageAt(ak, 20));assert.ok(damageAt(ak, 20, false, 1) < damageAt(ak, 20));
  // Easy but real: a rifle needs three body hits close up, the big sniper rifle one, a pistol four.
  assert.equal(Math.ceil(100 / damageAt(ak, 10)), 3);assert.equal(Math.ceil(100 / damageAt(weapon('m82'), 100)), 1);assert.equal(Math.ceil(100 / damageAt(weapon('g17'), 10)), 4);
  assert.ok(spreadOf(ak, {aim: 1}) < spreadOf(ak, {aim: 0}));assert.ok(spreadOf(ak, {aim: 1, stance: 'prone'}) < spreadOf(ak, {aim: 1}));assert.ok(spreadOf(ak, {moving: 1}) > spreadOf(ak, {}));
});

test('a gun: one shot a pull or automatic fire at its rate, reloading by itself when empty', () => {
  const p = new Gun('g17');let n = 0;
  for (let i = 0; i < 120; i++) n += p.update(1 / 60, {r2: 1}).shots;
  assert.equal(n, 1, 'a held trigger fires a pistol once');
  const a = new Gun('mp5');n = 0;for (let i = 0; i < 60; i++) n += a.update(1 / 60, {r2: 1}).shots;
  assert.ok(n >= 12 && n <= 14, `${n} shots a second at 800 a minute`);
  let t = 0;while (a.mag > 0 && t < 10) {a.update(1 / 60, {r2: 1});t += 1 / 60;}
  assert.equal(a.mag, 0);assert.ok(a.reloading, 'reloads by itself');
  for (let i = 0; i < 200; i++) a.update(1 / 60, {});
  assert.equal(a.mag, 30);assert.equal(a.reserve, 30 * 4 - 30);
  const k = new Gun('knife');assert.equal(k.update(1 / 60, {r2: 1}).shots, 1);
  assert.equal(new Gun('ak47').update(1 / 60, {r2: 1}, false).shots, 0, 'not when you may not fire');
});

test('a shot meets a body: the chest, the head, not beside it; lower when crouching', () => {
  const feet = {x: 0, y: 0, z: -20}, o = {x: 0, y: 1.3, z: 0};
  const body = rayFigure(o, {x: 0, y: 0, z: -1}, 100, feet);assert.ok(body && !body.head && Math.abs(body.t - 20) < .4);
  const up = (y, x = 0) => {const d = {x, y: y - 1.3, z: -20}, l = Math.hypot(d.x, d.y, d.z);return {x: d.x / l, y: d.y / l, z: d.z / l};};
  assert.ok(rayFigure(o, up(1.58), 100, feet).head);
  assert.equal(rayFigure(o, up(1.3, .6), 100, feet), null);assert.equal(rayFigure(o, up(2.1), 100, feet), null);
  assert.equal(rayFigure(o, up(1.5), 100, feet, 'crouch'), null);assert.ok(rayFigure(o, up(.6), 100, feet, 'crouch'));
  assert.ok(rayFigure(o, up(.2), 100, feet, 'prone', 0));assert.equal(rayFigure(o, up(1.0), 100, feet, 'prone', 0), null);
  assert.equal(rayFigure(o, {x: 0, y: 0, z: -1}, 10, feet), null, 'out of reach');assert.equal(rayFigure(o, {x: 0, y: 0, z: 1}, 100, feet), null, 'behind you');
});

test('camouflage: the right pattern in the right plants, lying still, hides you from the bots', () => {
  assert.ok(CAMO.length >= 5);
  const base = camoFactor({}), wood = camoFactor({camo: 'woodland', zone: 'woodland'}), wrong = camoFactor({camo: 'snow', zone: 'woodland'});
  assert.ok(wood < wrong && wrong <= base);
  assert.ok(camoFactor({camo: 'ghillie', zone: 'grass', stance: 'prone', cover: true}) < .3);
  assert.ok(camoFactor({camo: 'woodland', zone: 'woodland', moving: 1}) > wood);
  assert.ok(aimError(weapon('ak47'), 30, {camo: .3}) > aimError(weapon('ak47'), 30, {camo: 1}));
  assert.ok(aimError(weapon('ak47'), 30, {skill: .9}) < aimError(weapon('ak47'), 30, {skill: .1}));
});

// ---- the arena: two computers wired to each other, as the lobby does it ----
function world() {
  const A = DATA.arena, P = new Map();let now = 1000;
  const make = (id, at) => {
    const me = {id, feet: {x: at[0], y: 0, z: at[1]}, yaw: 0, stance: 'stand', fwd: {x: 0, y: 0, z: -1}, notes: [], st: null};
    me.rules = new Arena(A, {serverNow: () => now, you: () => id, yourName: () => `P${id}`, feet: () => me.feet, yaw: () => me.yaw, stance: () => me.stance, speed: () => 0,
      teleport: (x, z, yaw) => {me.feet = {x, y: 0, z};me.yaw = yaw;}, ground: () => 0, cameraPos: () => ({x: me.feet.x, y: 1.6, z: me.feet.z}), cameraFwd: () => me.fwd,
      others: () => [...P.values()].filter(o => o !== me && o.st).map(o => GW.memberFromJson(o.st, {id: o.id, name: `P${o.id}`, local: false, feet: o.feet, yaw: o.yaw, stance: o.stance})).filter(Boolean),
      loadout: () => [indexOf('hk416'), indexOf('g17'), indexOf('knife')], camo: () => 1, notice: t => me.notes.push(t), random: GW.rng(id * 77 + 5)});
    P.set(id, me);return me;
  };
  const step = (dt, inputs = {}) => {now += dt * 1000;for (const p of P.values()) p.rules.update(dt, inputs[p.id] || {});for (const p of P.values()) p.st = p.rules.localState();};
  return {A, P, make, step};
}
const aimAt = (a, b, y = 1.2) => {const d = {x: b.feet.x - a.feet.x, y: y - 1.6, z: b.feet.z - a.feet.z}, l = Math.hypot(d.x, d.y, d.z);a.fwd = {x: d.x / l, y: d.y / l, z: d.z / l};};

test('the arena data: zones of different plants, cover, spawn points and targets inside the fence', () => {
  const A = DATA.arena;assert.ok(A.zones.length >= 5);assert.ok(new Set(A.zones.map(z => z.id)).size === A.zones.length);
  const kinds = new Set(A.things.map(t => t[0]));for (const k of ['pine', 'birch', 'bush', 'rock', 'grass', 'reed', 'log']) assert.ok(kinds.has(k), k);
  for (const t of A.things) assert.ok(t[1] > A.x0 + 2 && t[1] < A.x0 + A.w - 2 && t[2] > A.s0 + 2 && t[2] < A.s0 + A.d - 2);
  assert.ok(A.spawns.length >= 12);
  for (const p of A.spawns) for (const t of A.things) if (t[3] > 0) assert.ok(Math.hypot(t[1] - p[0], t[2] - p[1]) > t[3] + .8, 'a spawn point is free');
  // Every zone covers the arena once: a place is in exactly one zone.
  for (let x = A.x0 + 1; x < A.x0 + A.w; x += 3) for (let s = A.s0 + 1; s < A.s0 + A.d; s += 3) assert.equal(A.zones.filter(z => x >= z.x0 && x < z.x1 && s >= z.s0 && s < z.s1).length, 1, `${x}, ${s}`);
});

test('gun game together: the first one in is the admin, a kill gives the next weapon, the victim comes back', () => {
  const W = world(), A = W.A, a = W.make(1, [A.gate[0], A.gate[1] - 4]), b = W.make(2, [A.x0 + 30, A.s0 + 24]);
  W.step(.1);W.step(.1);
  assert.ok(a.rules.member && b.rules.member && a.rules.isAdmin() && !b.rules.isAdmin());
  assert.ok(a.rules.onPad, 'the pad is just inside the gate');
  // No bots, gun game, hold the start button.
  for (let i = 0; i < 3; i++) W.step(.05, {1: {down: true}});
  for (let i = 0; i < 25; i++) W.step(.05, {1: {crossHeld: true}});
  assert.equal(a.rules.ses.state, 'count');assert.equal(a.rules.ses.bots.length, 0);
  W.step(.1);assert.ok(b.rules.inGame(), 'the other one is in the same game');assert.ok(a.rules.frozen());
  for (let i = 0; i < 60; i++) W.step(.1);
  assert.equal(b.rules.ses.state, 'play');
  assert.equal(weapon(a.rules.myWeapon()).id, LADDER[0]);
  // Stand them 12 m apart in the open, a shoots b.
  a.feet = {x: A.x0 + 36, y: 0, z: A.s0 + 46};b.feet = {x: A.x0 + 36, y: 0, z: A.s0 + 34};a.rules.ctx.blockDist = () => Infinity;b.rules.ctx.blockDist = () => Infinity;
  let t = 0;while (b.rules.alive && t < 6) {aimAt(a, b);W.step(1 / 30, {1: {r2: 1, l2: 1}});t += 1 / 30;}
  assert.ok(!b.rules.alive, 'b is down');W.step(.1);W.step(.1);
  assert.equal(a.rules.kills(1), 1);assert.equal(b.rules.kills(1), 1, 'both count the same');
  assert.equal(weapon(a.rules.myWeapon()).id, LADDER[1], 'the next weapon');
  assert.ok(a.rules.feed.some(f => /P1.*P2/.test(f.text)));
  for (let i = 0; i < 40; i++) W.step(.1);
  assert.ok(b.rules.alive && b.rules.hp === AR.HP, 'back in after a few seconds');
});

test('gun game to the end: the last kill is with the knife and wins; then the arena is free again', () => {
  const W = world(), A = W.A, a = W.make(1, [A.gate[0], A.gate[1] - 4]), b = W.make(2, [A.x0 + 30, A.s0 + 24]);
  W.step(.1);W.step(.1);for (let i = 0; i < 3; i++) W.step(.05, {1: {down: true}});for (let i = 0; i < 25; i++) W.step(.05, {1: {crossHeld: true}});for (let i = 0; i < 62; i++) W.step(.1);
  a.rules.ctx.blockDist = () => Infinity;b.rules.ctx.blockDist = () => Infinity;
  let guard = 0;
  while (a.rules.ses.state === 'play' && guard++ < 6000) {
    const knife = weapon(a.rules.myWeapon()).melee;
    if (b.rules.alive) {b.feet = {x: A.x0 + 36, y: 0, z: A.s0 + 30};a.feet = {x: A.x0 + 36, y: 0, z: A.s0 + 30 + (knife ? 1.2 : 8)};aimAt(a, b);}
    W.step(1 / 30, {1: {r2: guard % 2 ? 1 : 0, l2: 1}});
  }
  assert.equal(a.rules.ses.state, 'end');assert.equal(a.rules.ses.win, 1);assert.equal(a.rules.kills(1), LADDER.length);
  W.step(.1);assert.equal(b.rules.ses.win, 1);
  for (let i = 0; i < 100; i++) W.step(.1);
  assert.equal(a.rules.ses.state, 'lobby');assert.ok(!b.rules.inGame());
});

test('alone against bots: they walk, see you, shoot and die; team deathmatch keeps teams apart', () => {
  const W = world(), A = W.A, a = W.make(1, [A.gate[0], A.gate[1] - 4]);
  W.step(.1);W.step(.1);
  W.step(.05, {1: {right: true}});W.step(.05, {1: {right: true}});assert.equal(a.rules.ses.mode, 'tdm');
  for (let i = 0; i < 25; i++) W.step(.05, {1: {crossHeld: true}});
  const S = a.rules.ses;assert.equal(S.bots.length, 3);
  const teams = [0, 0];for (const f of a.rules.figures(true)) teams[a.rules.team(f.id)]++;assert.deepEqual(teams, [2, 2]);
  const start = S.bots.map(b => [b.x, b.z]);
  for (let i = 0; i < 600; i++) W.step(.1, {1: {}});// a minute; you stand still
  assert.ok(S.bots.some((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 3), 'the bots move');
  for (const b of S.bots) {assert.ok(Number.isFinite(b.x + b.y + b.z + b.yaw));assert.ok(a.rules.inArena(b.x, b.z), 'they stay inside');}
  const total = a.rules.board().reduce((n, p) => n + p.kills, 0);assert.ok(total >= 1, `somebody got somebody (${total})`);
  // Nobody was killed by a team-mate.
  for (const [victim, m] of Object.entries(S.bk)) for (const killer of Object.keys(m)) assert.notEqual(a.rules.team(+victim), a.rules.team(+killer));
  for (const killer of Object.keys(a.rules.kmap)) assert.notEqual(a.rules.team(1), a.rules.team(+killer));
  // The game on the wire and back.
  const back = GW.sesFromJson(JSON.parse(JSON.stringify(GW.sesToJson(S))));
  assert.equal(back.mode, 'tdm');assert.equal(back.bots.length, 3);assert.deepEqual(back.team, S.team);assert.deepEqual(back.bk, S.bk);
  // Walking out through the gate leaves the game.
  a.feet = {x: A.gate[0], y: 0, z: A.gate[1] + 3};W.step(.1);assert.ok(!a.rules.member && !a.rules.inGame());
  assert.equal(a.rules.localState(), null);
});
