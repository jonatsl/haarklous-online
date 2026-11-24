/* Weapons, camouflage and the arena's rules (issue #179: an arsenal of weapons, missions with them, a PvP arena with
 * vegetation and camouflage clothes, and a gun game where every kill gives you the next weapon).
 *
 * The numbers are the real weapons' as far as a game needs them: calibre, magazine, rate of fire, muzzle speed. Easy to
 * control: little recoil that settles by itself, a magazine that reloads itself when empty, damage that falls with the
 * distance but no bullet drop (the shot goes where the sights are).
 *
 * Pure (Node tests): WEAPONS, damageAt, spreadOf, Gun, rayFigure, CAMO, camoFactor, aimError, LADDER, Arena (the rules of the
 * arena: the lobby, gun game / team deathmatch / free for all, bots, who hit whom). buildGun(T, id) makes the 3D model.
 *
 * Online the arena rides in the players' own state messages ('st', field 'ar'), like paintball: each player sends the shots
 * they fired; whoever owns a body (you yours, the admin the bots') decides whether a shot hit it, so lag never kills
 * anybody unseen. The admin is the one who has been in the arena longest.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameWeapons = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), DEG = Math.PI / 180;
  const v3 = (x = 0, y = 0, z = 0) => ({x, y, z});
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z), sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z), mul = (a, k) => v3(a.x * k, a.y * k, a.z * k);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z, len = a => Math.sqrt(dot(a, a)), norm = a => {const l = len(a);return l > 1e-12 ? mul(a, 1 / l) : v3(0, 0, -1);};
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const r3 = v => Math.round(v * 1000) / 1000;
  function rng(seed) {let a = (seed >>> 0) || 1;return () => {a = (a + 0x6D2B79F5) | 0;let t = Math.imul(a ^ (a >>> 15), 1 | a);t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};}

  // ---------- The weapons ----------
  // cls: pistol, smg, shotgun, rifle, lmg, sniper, bow, knife. mag = rounds in the magazine, mags = spare magazines.
  // dmg at the muzzle (a body has 100), full to r0 metres, falling to min at r1. hip / ads = spread in degrees from the hip
  // and aiming. kick = degrees the sights rise per shot. zoom = how much aiming magnifies. v0 = muzzle speed m/s (a fact for
  // the armoury's cards). loud = how far away people hear it (m).
  const W = (id, name, cls, cal, mag, mags, rpm, auto, dmg, r0, r1, min, v0, hip, ads, kick, reload, zoom, more = {}) =>
    ({id, name, cls, cal, mag, mags, rpm, auto, dmg, r0, r1, min, v0, hip, ads, kick, reload, zoom, pellets: 1, move: 1, loud: 120, len: .8, ...more});
  const WEAPONS = [
    W('g17', 'Glock 17', 'pistol', '9 × 19 mm', 17, 3, 400, false, 30, 15, 50, 16, 375, 2.2, .7, 1.2, 1.5, 1.25, {len: .2, loud: 90, note: 'Austria, 1982. The police pistol of half the world.'}),
    W('m1911', 'Colt M1911', 'pistol', '.45 ACP', 7, 4, 300, false, 42, 12, 45, 20, 253, 2.4, .8, 1.8, 1.6, 1.25, {len: .22, loud: 95, note: 'USA, 1911. Heavy, slow bullet.'}),
    W('deagle', 'Desert Eagle', 'pistol', '.50 AE', 7, 3, 180, false, 62, 20, 60, 32, 470, 3, .7, 3.4, 1.9, 1.3, {len: .27, loud: 130, note: 'A hand cannon. Kicks.'}),
    W('m29', 'S&W Model 29', 'pistol', '.44 Magnum', 6, 4, 150, false, 68, 25, 70, 36, 450, 2.6, .6, 3.6, 2.8, 1.3, {len: .3, loud: 130, revolver: true, note: 'Six-shot revolver.'}),
    W('mp5', 'H&K MP5', 'smg', '9 × 19 mm', 30, 4, 800, true, 25, 20, 70, 13, 400, 2.6, .9, .7, 2.1, 1.35, {len: .55, loud: 100, note: 'Germany, 1966. The police submachine gun (Norwegian police too).'}),
    W('uzi', 'Uzi', 'smg', '9 × 19 mm', 32, 4, 600, true, 26, 18, 60, 13, 400, 3.2, 1.2, .9, 2.2, 1.3, {len: .47, loud: 100, note: 'Israel, 1954. Simple and sturdy.'}),
    W('p90', 'FN P90', 'smg', '5.7 × 28 mm', 50, 3, 900, true, 22, 25, 90, 12, 715, 2.4, .8, .6, 2.4, 1.4, {len: .5, loud: 105, note: 'Belgium, 1990. 50 rounds on top.'}),
    W('r870', 'Remington 870', 'shotgun', '12 gauge', 6, 4, 70, false, 13, 8, 35, 3, 400, 3.4, 2.8, 4.5, 3, 1.2, {len: 1, pellets: 8, loud: 130, pump: true, note: 'Pump action. Eight pellets a shell.'}),
    W('m4s', 'Benelli M4', 'shotgun', '12 gauge', 7, 4, 220, false, 12, 8, 35, 3, 400, 3.4, 2.8, 3.8, 3.2, 1.2, {len: 1, pellets: 8, loud: 130, note: 'Italy, 1998. Semi-automatic.'}),
    W('ak47', 'AK-47', 'rifle', '7.62 × 39 mm', 30, 4, 600, true, 36, 30, 150, 20, 715, 3, .9, 1.25, 2.5, 1.45, {len: .87, wood: true, note: 'Soviet Union, 1947. Works anywhere.'}),
    W('m4a1', 'M4A1', 'rifle', '5.56 × 45 mm', 30, 4, 800, true, 30, 40, 200, 18, 880, 2.6, .6, .85, 2.3, 1.5, {len: .84, note: 'USA, 1994. Light and accurate.'}),
    W('hk416', 'HK416', 'rifle', '5.56 × 45 mm', 30, 4, 850, true, 31, 40, 200, 18, 890, 2.5, .55, .8, 2.2, 1.6, {len: .85, tan: true, note: 'Germany, 2004. The Norwegian army\'s rifle.'}),
    W('ag3', 'AG-3', 'rifle', '7.62 × 51 mm', 20, 4, 550, true, 48, 60, 300, 30, 800, 3.4, .5, 1.9, 2.7, 1.6, {len: 1.02, note: 'The Norwegian G3, made at Kongsberg from 1967. Heavy bullet.'}),
    W('minimi', 'FN Minimi', 'lmg', '5.56 × 45 mm', 100, 2, 800, true, 30, 40, 200, 18, 915, 4, 1.1, .75, 5.5, 1.4, {len: 1.04, move: .85, note: 'Belgium, 1974. A belt of 100.'}),
    W('r700', 'Remington 700', 'sniper', '.308 Winchester', 5, 5, 45, false, 95, 150, 500, 70, 800, 5, .08, 4.5, 3.2, 4, {len: 1.1, scope: true, wood: true, loud: 140, note: 'Bolt action with a 4× scope.'}),
    W('m82', 'Barrett M82', 'sniper', '.50 BMG', 10, 2, 90, false, 160, 300, 900, 110, 853, 6, .1, 6, 4, 5, {len: 1.45, scope: true, move: .8, loud: 180, note: 'USA, 1982. Goes through most things.'}),
    W('xbow', 'Crossbow', 'bow', 'Bolt', 1, 14, 30, false, 90, 30, 80, 55, 120, 1.5, .3, .5, 2.4, 2, {len: .8, loud: 8, note: 'Almost silent. One bolt at a time.'}),
    W('knife', 'Combat knife', 'knife', 'Steel', 1, 0, 90, false, 100, 2.2, 2.2, 100, 0, 0, 0, 0, 0, 1, {len: .28, loud: 3, melee: 2.2, note: 'Silent. You have to get close.'})
  ];
  const BY_ID = Object.fromEntries(WEAPONS.map((w, i) => [w.id, {...w, i}])), indexOf = id => BY_ID[id] ? BY_ID[id].i : 0, weapon = k => typeof k === 'number' ? WEAPONS[clamp(k | 0, 0, WEAPONS.length - 1)] : WEAPONS[indexOf(k)];
  const CLASS_NAME = {pistol: 'Pistols', smg: 'Submachine guns', shotgun: 'Shotguns', rifle: 'Rifles', lmg: 'Machine gun', sniper: 'Sniper rifles', bow: 'Crossbow', knife: 'Knife'};
  const SIDEARMS = ['pistol'], isSidearm = w => SIDEARMS.includes(w.cls), isPrimary = w => !isSidearm(w) && w.cls !== 'knife';
  // Gun game: a kill gives you the next one; the last kill is with the knife.
  const LADDER = ['ak47', 'hk416', 'minimi', 'p90', 'mp5', 'm4s', 'r870', 'r700', 'deagle', 'g17', 'xbow', 'knife'];

  // Damage a hit does at this distance (a head shot counts 2.5 times; a vest takes 40 % off a body hit).
  function damageAt(w, dist, head = false, armour = 0) {
    const k = w.r1 > w.r0 ? clamp((dist - w.r0) / (w.r1 - w.r0), 0, 1) : 0;
    return (w.dmg + (w.min - w.dmg) * k) * (head ? 2.5 : 1 - .4 * clamp(armour, 0, 1));
  }
  // The cone (radians) a shot leaves in: aiming is tight, moving and standing up open it, crouching and lying close it.
  function spreadOf(w, {aim = 0, moving = 0, stance = 'stand', heat = 0} = {}) {
    if (w.melee) return 0;
    const base = w.hip + (w.ads - w.hip) * clamp(aim, 0, 1), st = stance === 'prone' ? .6 : stance === 'crouch' ? .8 : 1;
    return (base * st * (1 + .6 * clamp(moving, 0, 1) * (1 - .5 * aim)) + Math.min(2.5, heat * w.kick * .35)) * DEG;
  }
  // A direction inside the cone round d (u, v = two random numbers).
  function inCone(d, angle, u, v) {
    if (!(angle > 0)) return norm(d);
    const D = norm(d), side = norm(cross(D, Math.abs(D.y) > .98 ? v3(1, 0, 0) : v3(0, 1, 0))), up = cross(side, D), a = u * 2 * Math.PI, r = Math.tan(angle) * Math.sqrt(v);
    return norm(add(D, add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))));
  }
  // A shell's pellets, the same on every computer (from the shot's seed).
  function pelletDirs(w, d, seed) {
    if (w.pellets <= 1) return [norm(d)];const R = rng(seed || 1), out = [];
    for (let i = 0; i < w.pellets; i++) out.push(inCone(d, 3.2 * DEG, R(), R()));return out;
  }

  // ---------- A weapon in your hands: magazine, reloading, rate of fire, recoil ----------
  class Gun {
    constructor(w) {this.w = typeof w === 'object' ? w : weapon(w);this.mag = this.w.mag;this.reserve = this.w.mag * this.w.mags;this.reloadT = 0;this.coolT = 0;this.aimT = 0;this.kick = 0;this.heat = 0;this.trigger = false;this.dry = false;this.swing = 0;}
    get reloading() {return this.reloadT > 0;}
    refill() {this.mag = this.w.mag;this.reserve = this.w.mag * this.w.mags;this.reloadT = 0;}
    startReload() {if (this.w.melee || this.reloadT > 0 || this.mag >= this.w.mag || this.reserve <= 0) return false;this.reloadT = this.w.reload;return true;}
    // input: {r2, l2, reload}; returns {shots (0 or 1 this frame), reloaded, started (a reload began), empty (a dry click)}.
    update(dt, input = {}, can = true) {
      const w = this.w, out = {shots: 0, reloaded: false, started: false, empty: false};
      this.coolT -= dt;this.kick = Math.max(0, this.kick - dt * (6 + this.kick * 6));this.heat = Math.max(0, this.heat - dt * 3.5);this.swing = Math.max(0, this.swing - dt * 4);
      if (this.reloadT > 0 && (this.reloadT -= dt) <= 0) {this.reloadT = 0;const take = Math.min(w.mag - this.mag, this.reserve);this.mag += take;this.reserve -= take;out.reloaded = true;}
      if (input.reload && can && this.startReload()) out.started = true;
      this.aimT += ((can && (input.l2 || 0) > .3 && this.reloadT <= 0 && !w.melee ? 1 : 0) - this.aimT) * Math.min(1, dt * 11);
      const pull = (input.r2 || 0) > .55, fresh = pull && !this.trigger;if (pull) this.trigger = true;else if ((input.r2 || 0) < .35) this.trigger = false;
      if (can && this.reloadT <= 0 && this.coolT <= 0 && (fresh || (pull && w.auto))) {
        if (w.melee) {this.coolT = 60 / w.rpm;this.swing = 1;out.shots = 1;}
        else if (this.mag > 0) {this.mag--;this.coolT = 60 / w.rpm;this.kick = Math.min(1.6, this.kick + 1);this.heat = Math.min(6, this.heat + 1);out.shots = 1;if (this.mag === 0 && this.reserve > 0) {this.reloadT = w.reload + .25;out.started = true;}}
        else if (fresh) {out.empty = true;if (this.startReload()) out.started = true;}
      }
      return out;
    }
  }

  // ---------- Bodies ----------
  // Where a shot (from o along the unit vector d, at most max metres) meets a body standing at feet: {t, head} or null.
  function rayFigure(o, d, max, feet, stance = 'stand', yaw = 0) {
    let a, b, head;const R = .27;
    if (stance === 'prone') {const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw)), c = add(feet, v3(0, .2, 0));a = add(c, mul(f, .45));b = sub(c, mul(f, .85));head = add(c, mul(f, .72));}
    else {const top = stance === 'crouch' ? 1.12 : stance === 'sit' ? 1.0 : 1.72;a = add(feet, v3(0, .28, 0));b = add(feet, v3(0, top - .42, 0));head = add(feet, v3(0, top - .14, 0));}
    let best = null;
    {const m = sub(head, o), t = dot(m, d);if (t > 0 && t < max) {const q = sub(m, mul(d, t));if (dot(q, q) < .14 * .14) best = {t: Math.max(0, t - .1), head: true};}}
    // The closest point of the ray to the body's middle line.
    {const u = sub(b, a), w0 = sub(o, a), A = dot(d, d), B = dot(d, u), C = dot(u, u), Dd = dot(d, w0), E = dot(u, w0), den = A * C - B * B;
      // s is the place on the body; t the place on the ray nearest to it.
      let s = den > 1e-9 ? clamp((A * E - B * Dd) / den, 0, 1) : 0, t = (B * s - Dd) / A;if (t < 0) {t = 0;s = clamp(E / C, 0, 1);} else if (t > max) {t = max;s = clamp((B * t + E) / C, 0, 1);}
      const p = add(o, mul(d, t)), q = add(a, mul(u, s)), dist = len(sub(p, q));
      if (dist < R && t > 0 && t <= max && (!best || t < best.t - .2)) best = {t, head: false};}
    return best;
  }

  // ---------- Camouflage ----------
  // What you wear in the arena. good = the vegetation it melts into (the arena's zones name theirs).
  const CAMO = [
    {id: 'none', name: 'Your own jacket', colors: null, good: []},
    {id: 'woodland', name: 'Woodland (M98 style)', colors: ['#3d4a2c', '#5b6b3a', '#2a2f1e', '#6e5a3a'], good: ['woodland']},
    {id: 'grass', name: 'Summer grass', colors: ['#6f8a3a', '#8aa04a', '#4f6a2c', '#a8a85a'], good: ['grass', 'woodland']},
    {id: 'desert', name: 'Desert / straw', colors: ['#b79c63', '#cdb47c', '#8f7748', '#d9c690'], good: ['desert']},
    {id: 'urban', name: 'Urban grey', colors: ['#6c6f70', '#8b8e8c', '#44474a', '#a3a5a2'], good: ['urban']},
    {id: 'snow', name: 'Winter white', colors: ['#e8ebee', '#cfd5da', '#f6f7f8', '#aab3bb'], good: ['snow']},
    {id: 'ghillie', name: 'Ghillie suit', colors: ['#4a5a2a', '#6a6a35', '#33401f', '#7a6a3c'], good: ['woodland', 'grass'], ghillie: true}
  ];
  // How far off a bot notices you: 1 = as anybody, less = you are harder to see. Matching camouflage, lying down, keeping
  // still and tall plants all help; running gives you away.
  function camoFactor({camo = 'none', zone = '', stance = 'stand', moving = 0, cover = false} = {}) {
    const c = CAMO.find(k => k.id === camo) || CAMO[0];let f = 1;
    if (c.good.includes(zone)) f *= c.ghillie ? .5 : .65;else if (c.colors) f *= .92;
    f *= stance === 'prone' ? .55 : stance === 'crouch' ? .78 : 1;
    if (cover) f *= stance === 'stand' ? .85 : .6;
    return clamp(f * (.8 + .5 * clamp(moving, 0, 1)), .18, 1.3);
  }
  // A bot's aim: how far off (radians, one sigma) its shot goes. skill 0..1.
  function aimError(w, dist, {skill = .5, targetSpeed = 0, camo = 1, first = false, seen = 0} = {}) {
    const base = (1.9 - 1.1 * skill) * Math.max(.45, 1 - seen / 6) * DEG, move = Math.min(1, targetSpeed / 6) * 1.4 * DEG, far = Math.min(1.5, dist / 80) * .5 * DEG;
    return (base + move + far) * (first ? 1.6 : 1) * (1.7 - .7 * clamp(camo, .18, 1)) + (w.pellets > 1 ? .5 * DEG : 0);
  }
  const gauss = R => Math.sqrt(-2 * Math.log(Math.max(1e-9, R()))) * Math.cos(2 * Math.PI * R());

  // ---------- The arena ----------
  const AR = {COUNT_S: 5, END_S: 9, RESPAWN_S: 3, DUR_S: 480, FFA_LIM: 15, TDM_LIM: 25, MAX_BOTS: 7, HP: 100, REGEN_AFTER: 5, REGEN: 22, SIGHT: 70, PAD: 5, BOT_DMG: .6, BOT_VS_BOT: .3};
  const MODES = [{id: 'gg', name: 'Gun game', text: 'Every kill gives you the next weapon. The last kill is with the knife.'}, {id: 'ffa', name: 'Free for all', text: `Everybody against everybody. First to ${AR.FFA_LIM}.`}, {id: 'tdm', name: 'Team deathmatch', text: `Green against Sand. First team to ${AR.TDM_LIM}.`}];
  const TEAM_NAME = ['Green', 'Sand'], TEAM_CSS = ['#7fbf5a', '#e0c070'], TEAM_CAMO = ['woodland', 'desert'];
  const BOT_NAMES = ['Kari', 'Ola', 'Nils', 'Ingrid', 'Bjørn', 'Sigrid', 'Leif', 'Astrid'];
  const newSession = () => ({id: 0, mode: 'gg', nb: 3, state: 'lobby', t0: 0, endT: 0, win: 0, team: {}, bots: [], bk: {}});
  const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
  // bots on the wire: [id, x, y, z, yaw, alive, weapon, stance, deaths, killed by]
  const sesToJson = S => ({id: S.id, m: S.mode, nb: S.nb, st: S.state, t0: S.t0, et: S.endT, wi: S.win, tm: {...S.team},
    b: S.bots.map(b => [b.id, r3(b.x), r3(b.y), r3(b.z), r3(b.yaw), b.alive ? 1 : 0, b.w, b.stance === 'crouch' ? 1 : 0, b.deaths, b.by || 0]), bk: S.bk});
  function sesFromJson(O) {
    if (!O || typeof O !== 'object') return null;const S = newSession();
    S.id = num(O.id, 0);if (MODES.some(m => m.id === O.m)) S.mode = O.m;S.nb = clamp(num(O.nb, 3), 0, AR.MAX_BOTS);if (typeof O.st === 'string') S.state = O.st;S.t0 = num(O.t0, 0);S.endT = num(O.et, 0);S.win = num(O.wi, 0);
    for (const [k, v] of Object.entries(O.tm || {})) S.team[+k] = +v ? 1 : 0;
    for (const b of Array.isArray(O.b) ? O.b.slice(0, AR.MAX_BOTS) : []) if (Array.isArray(b) && b.length >= 9) S.bots.push({id: num(b[0], -1), x: num(b[1], 0), y: num(b[2], 0), z: num(b[3], 0), yaw: num(b[4], 0), alive: !!b[5], w: clamp(num(b[6], 0), 0, WEAPONS.length - 1), stance: b[7] ? 'crouch' : 'stand', deaths: num(b[8], 0), by: num(b[9], 0), hp: AR.HP, respawn: 0, base: clamp(num(b[6], 0), 0, WEAPONS.length - 1)});
    for (const [k, m] of Object.entries(O.bk && typeof O.bk === 'object' ? O.bk : {})) {S.bk[+k] = {};for (const [q, n] of Object.entries(m || {})) S.bk[+k][+q] = num(n, 0);}
    return S;
  }
  function memberFromJson(O, extra) {
    if (!O || typeof O !== 'object') return null;const k = {};for (const [q, n] of Object.entries(O.k && typeof O.k === 'object' ? O.k : {})) k[+q] = num(n, 0);
    return {...extra, lobby: num(O.l, 0), ses: num(O.s, 0), alive: num(O.a, 1) !== 0, deaths: num(O.d, 0), by: num(O.by, 0), k, w: clamp(num(O.w, 0), 0, WEAPONS.length - 1), camo: clamp(num(O.c, 0), 0, CAMO.length - 1),
      shots: Array.isArray(O.x) ? O.x.filter(s => Array.isArray(s) && s.length >= 11) : [], sesJson: O.ses && typeof O.ses === 'object' ? O.ses : null};
  }
  const teamOf = (S, id) => S.mode !== 'tdm' ? -1 : (S.team[id] ?? Math.abs(id) % 2);

  class Arena {
    // data: ARSENAL.arena. ctx: {serverNow(), you(), yourName(), others() -> members, feet(), yaw(), stance(), speed(),
    //   teleport(x, z, yaw), ground(x, z), toWorld(x, s) -> {x, z}, blockDist(o, d, max) (walls and trunks; optional),
    //   moveBot(pos {x, y, z}, dx, dz) -> {x, y, z} (optional), loadout() -> [weapon indexes], camo() -> index,
    //   notice(text, s), sound(name, gain), random()}
    constructor(data, ctx) {
      this.data = data;this.ctx = ctx;const tw = (x, s) => ctx.toWorld ? ctx.toWorld(x, s) : {x, z: s};
      const c = [[data.x0, data.s0], [data.x0 + data.w, data.s0], [data.x0 + data.w, data.s0 + data.d], [data.x0, data.s0 + data.d]].map(p => tw(...p));
      this.corners = c;this.o = c[0];this.ux = {x: (c[1].x - c[0].x) / data.w, z: (c[1].z - c[0].z) / data.w};this.vx = {x: (c[3].x - c[0].x) / data.d, z: (c[3].z - c[0].z) / data.d};
      this.spawns = data.spawns.map(p => tw(...p));this.gate = tw(...data.gate);
      // The pad just inside the gate: stand on it to choose the game and start it.
      this.pad = tw(data.gate[0], data.gate[1] - 4.5);
      // Solid things stop a bullet (trunks, rocks, logs, bales, crates, sandbags); soft ones only hide you.
      this.solids = [];this.soft = [];
      for (const t of data.things) {const p = tw(t[1], t[2]), o = {kind: t[0], x: p.x, z: p.z, r: t[3], h: t[4] * (t[5] || 1), sc: t[5] || 1};if (o.r > 0 && !['bush'].includes(o.kind)) this.solids.push(o);else this.soft.push({...o, r: o.kind === 'bush' ? .9 * o.sc : .45});}
      this.zones = data.zones.map(z => ({...z}));
      this.ses = newSession();this.all = [];this.adminId = 0;this.inside = false;this.onPad = false;this.lobbyT = 0;this.mySes = 0;this.clock = 0;
      this.hp = AR.HP;this.alive = true;this.deaths = 0;this.kmap = {};this.respawnT = 0;this.hurtT = 99;this.lastBy = 0;this.sel = 0;this.wNow = -1;this.gun = null;
      this.seq = 0;this.outbox = [];this.seenShot = new Map();this.seenDeaths = new Map();this.feed = [];this.events = [];this.startHold = 0;this.emptyT = 0;this.seenState = '';this.fresh = [];
      this.botAi = new Map();this.hitT = 0;this.dmgFrom = null;this.dmgT = 0;this.levelSeen = 0;
    }
    // ---- places ----
    uv(x, z) {const dx = x - this.o.x, dz = z - this.o.z;return {u: dx * this.ux.x + dz * this.ux.z, v: dx * this.vx.x + dz * this.vx.z};}
    inArena(x, z, m = 0) {const p = this.uv(x, z);return p.u > m && p.v > m && p.u < this.data.w - m && p.v < this.data.d - m;}
    zoneAt(x, z) {const p = this.uv(x, z), X = this.data.x0 + p.u, S = this.data.s0 + p.v;return this.zones.find(q => X >= q.x0 && X < q.x1 && S >= q.s0 && S < q.s1) || null;}
    inSoft(x, z) {return this.soft.some(t => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < (t.r + .5) * (t.r + .5));}
    ground(x, z) {return this.ctx.ground ? this.ctx.ground(x, z) : 0;}
    // How far a shot gets before something solid: the game's walls and trunks when it gives them, else the arena's own things.
    block(o, d, max) {
      if (this.ctx.blockDist) return Math.min(max, this.ctx.blockDist(o, d, max));
      let best = max;
      for (const t of this.solids) {
        const ox = o.x - t.x, oz = o.z - t.z, a = d.x * d.x + d.z * d.z;if (a < 1e-9) continue;const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - t.r * t.r, q = b * b - 4 * a * c;if (q < 0) continue;
        const s = (-b - Math.sqrt(q)) / (2 * a);if (s <= 0 || s >= best) continue;const y = o.y + d.y * s, g = this.ground(t.x, t.z);if (y > g - .5 && y < g + t.h) best = s;
      }
      // The ground (sampled).
      for (let s = 1; s < best; s += 1) {if (o.y + d.y * s < this.ground(o.x + d.x * s, o.z + d.z * s) - .05) {best = s;break;}}
      return best;
    }
    // ---- who is who ----
    you() {return this.ctx.you ? this.ctx.you() : 0;}
    now() {return this.ctx.serverNow ? this.ctx.serverNow() : this.clock * 1000;}
    rand() {return this.ctx.random ? this.ctx.random() : Math.random();}
    sound(n, g) {if (this.ctx.sound) this.ctx.sound(n, g);}
    notice(t, s) {if (this.ctx.notice) this.ctx.notice(t, s);}
    get member() {return this.lobbyT > 0;}
    inGame() {return this.mySes !== 0 && this.ses.id === this.mySes && this.ses.state !== 'lobby';}
    playing() {return this.inGame() && this.ses.state === 'play';}
    frozen() {return this.inGame() && this.ses.state === 'count';}
    isAdmin() {return this.adminId === this.you() && this.member;}
    team(id) {return teamOf(this.ses, id);}
    memberPlaying(id) {if (!this.ses.id || this.ses.state === 'lobby') return false;const m = this.all.find(m => m.id === id);return !!m && m.ses === this.ses.id;}
    name(id) {if (id < 0) return `Bot ${BOT_NAMES[(-id - 1) % BOT_NAMES.length]}`;const m = this.all.find(m => m.id === id);return m ? (m.local ? (this.ctx.yourName ? this.ctx.yourName() : 'You') : m.name) : '?';}
    // Kills: every body keeps count of who killed it; a killer's kills are the sum over everybody.
    kills(id) {let n = 0;for (const m of this.all) if (m.ses === this.ses.id && this.ses.id) n += m.k[id] || 0;for (const k of Object.values(this.ses.bk)) n += k[id] || 0;return n;}
    teamKills(t) {let n = 0;for (const f of this.figures(true)) if (this.team(f.id) === t) n += this.kills(f.id);return n;}
    level(id) {return Math.min(LADDER.length - 1, this.kills(id));}
    // Everybody in the game: the players and the bots. all = also the dead ones.
    figures(all = false) {
      const out = [];
      for (const m of this.all) if (m.ses === this.ses.id && this.ses.id && (all || m.alive)) out.push({id: m.id, local: !!m.local, bot: false, feet: m.feet, yaw: m.yaw, stance: m.stance, alive: m.alive, w: m.w, camo: m.camo, name: m.name});
      for (const b of this.ses.bots) if (all || b.alive) out.push({id: b.id, local: false, bot: true, feet: v3(b.x, b.y, b.z), yaw: b.yaw, stance: b.stance, alive: b.alive, w: b.w, camo: 1, name: this.name(b.id)});
      return out;
    }
    board() {return this.figures(true).map(f => ({id: f.id, name: f.name, kills: this.kills(f.id), team: this.team(f.id), bot: f.bot, local: f.local})).sort((a, b) => b.kills - a.kills || a.id - b.id);}
    addFeed(text) {this.feed.push({text, t: this.clock});if (this.feed.length > 5) this.feed.shift();}
    // The weapon in your hands now (an index into WEAPONS).
    myWeapon() {
      if (this.inGame() && this.ses.mode === 'gg') return indexOf(LADDER[this.level(this.you())]);
      const L = this.ctx.loadout ? this.ctx.loadout() : [indexOf('hk416'), indexOf('g17'), indexOf('knife')];return L[this.sel % L.length];
    }
    readMembers() {
      const c = this.ctx;
      this.all = [{id: this.you(), local: true, name: c.yourName ? c.yourName() : 'You', lobby: this.lobbyT, ses: this.inGame() ? this.mySes : 0, alive: this.alive, deaths: this.deaths, k: this.kmap, w: Math.max(0, this.wNow), camo: c.camo ? c.camo() : 0,
        feet: c.feet ? c.feet() : v3(), yaw: c.yaw ? c.yaw() : 0, stance: c.stance ? c.stance() : 'stand', shots: [], sesJson: null}];
      for (const m of (c.others ? c.others() : [])) if (m && m.lobby > 0) this.all.push(m);
    }
    // input: {r2, l2, reload, next (switch weapon), left, right, up, down, crossHeld}
    update(dt, input = {}) {
      this.clock += dt;this.events = [];this.fresh = [];this.hitT = Math.max(0, this.hitT - dt);this.dmgT = Math.max(0, this.dmgT - dt);
      this.outbox = this.outbox.filter(s => this.now() - s[1] <= 2500);
      this.readMembers();
      this.adminId = 0;let best = 0;
      for (const m of this.all) if (m.lobby > 0 && (best === 0 || m.lobby < best || (m.lobby === best && m.id < this.adminId))) {best = m.lobby;this.adminId = m.id;}
      if (best > 0 && this.adminId !== this.you()) for (const m of this.all) if (m.id === this.adminId && m.sesJson) {const s = sesFromJson(m.sesJson);if (s) this.ses = s;}
      this.local(dt, input);
      if (best > 0 && this.adminId === this.you() && this.member) this.runAdmin(dt, input);
      // The shots the others fired since last time (each once), then ours and our bots': who did they hit?
      for (const m of this.all) {
        if (m.local) continue;let last = this.seenShot.get(m.id) ?? 0;
        for (const s of m.shots) {if (s[0] <= last) continue;last = s[0];if (this.now() - s[1] > 2500 || !m.ses || m.ses !== this.ses.id) continue;this.fresh.push({o: v3(s[2], s[3], s[4]), d: v3(s[5], s[6], s[7]), w: s[8] | 0, owner: s[9], seed: s[10], remote: true});}
        this.seenShot.set(m.id, last);
      }
      for (const s of this.fresh) this.resolve(s);
      // The feed: who killed whom.
      for (const f of this.figures(true)) {
        const seen = this.seenDeaths.get(f.id) || 0, d = f.bot ? (this.ses.bots.find(b => b.id === f.id) || {}).deaths || 0 : (this.all.find(m => m.id === f.id) || {}).deaths || 0;
        if (d > seen && this.ses.id) {const by = this.lastKiller(f.id);this.addFeed(`${this.name(by)}  ›  ${f.name}`);if (by === this.you() && f.id !== this.you()) {this.events.push({kill: f.id});this.notice(`You got ${f.name}.`, 2);}}
        this.seenDeaths.set(f.id, d);
      }
      if (this.inGame() && this.ses.mode === 'gg') {const L = this.level(this.you());if (L > this.levelSeen) {this.sound('learn', .5);this.notice(L >= LADDER.length - 1 ? 'Last weapon: the knife. One more kill wins.' : `Next weapon: ${weapon(LADDER[L]).name} (${L + 1} of ${LADDER.length}).`, 3);}this.levelSeen = L;}
    }
    lastKiller(id) {if (id === this.you()) return this.lastBy;const m = this.all.find(m => m.id === id);if (m) return m.by || 0;const b = this.ses.bots.find(b => b.id === id);return b ? b.by || 0 : 0;}
    local(dt, input) {
      const f = this.ctx.feet ? this.ctx.feet() : v3();this.inside = this.inArena(f.x, f.z);this.onPad = this.inside && Math.hypot(f.x - this.pad.x, f.z - this.pad.z) < AR.PAD;
      if (this.inside && this.lobbyT === 0) {this.lobbyT = Math.max(1, Math.round(this.now()));this.events.push({enter: true});}
      if (!this.inside && this.lobbyT > 0) {if (this.inGame()) this.notice('You left the arena and the game.', 3);this.lobbyT = 0;this.mySes = 0;this.events.push({leave: true});}
      if (this.mySes !== 0 && (this.ses.id !== this.mySes || this.ses.state === 'lobby')) {this.mySes = 0;this.alive = true;this.hp = AR.HP;}
      if (this.ses.id && this.ses.state !== 'lobby' && this.mySes !== this.ses.id && this.lobbyT > 0) {this.mySes = this.ses.id;this.deaths = 0;this.kmap = {};this.levelSeen = 0;this.seenState = '';this.spawn(true);}
      if (this.inGame() && this.seenState !== this.ses.state) {if (this.ses.state === 'play' || this.ses.state === 'end') this.sound('whistle', .8);if (this.ses.state === 'end') this.events.push({over: true, won: this.ses.mode === 'tdm' ? this.ses.win === this.team(this.you()) : this.ses.win === this.you(), mode: this.ses.mode, kills: this.kills(this.you())});this.seenState = this.ses.state;}
      if (this.inGame() && !this.alive && (this.respawnT -= dt) <= 0 && this.ses.state !== 'end') this.spawn(false);
      // Health comes back when nobody has hit you for a while.
      this.hurtT += dt;if (this.alive && this.hurtT > AR.REGEN_AFTER && this.hp < AR.HP) this.hp = Math.min(AR.HP, this.hp + AR.REGEN * dt);
      // The weapon: the ladder's in a gun game, else what you chose in the armoury (△ changes between them).
      if (!this.member) {this.gun = null;this.wNow = -1;return;}
      if (input.next && !(this.inGame() && this.ses.mode === 'gg')) {this.sel++;this.sound('click', .4);}
      const wi = this.myWeapon();if (wi !== this.wNow) {this.wNow = wi;this.gun = new Gun(weapon(wi));}
      const live = !this.onPad || this.inGame(), can = live && this.alive && (!this.inGame() || this.ses.state === 'play');
      const r = this.gun.update(dt, input, can);
      if (r.started) this.sound('chains', .25);if (r.reloaded) this.sound('click', .5);if (r.empty) this.sound('pistolClick', .6);
      if (r.shots) this.fire(this.ctx.cameraPos ? this.ctx.cameraPos() : add(f, v3(0, 1.6, 0)), this.ctx.cameraFwd ? this.ctx.cameraFwd() : v3(0, 0, -1));
    }
    // Our shot: out to the others, and at once against the bodies we own ourselves (our bots).
    fire(o, dir, owner = this.you(), wi = this.wNow, spread = null) {
      const w = weapon(wi), sp = spread ?? spreadOf(w, {aim: this.gun ? this.gun.aimT : 0, moving: Math.min(1, (this.ctx.speed ? this.ctx.speed() : 0) / 5), stance: this.ctx.stance ? this.ctx.stance() : 'stand', heat: this.gun ? this.gun.heat : 0});
      const d = w.pellets > 1 ? norm(dir) : inCone(dir, sp, this.rand(), this.rand()), seed = Math.floor(this.rand() * 1e9) + 1;
      const s = {o: {...o}, d, w: wi, owner, seed, remote: false};
      if (this.inGame() || owner < 0) this.outbox.push([++this.seq, Math.round(this.now()), r3(o.x), r3(o.y), r3(o.z), r3(d.x), r3(d.y), r3(d.z), wi, owner, seed]);
      this.fresh.push(s);if (owner === this.you()) this.events.push({shot: s});
      return s;
    }
    // One shot against the bodies this computer decides for (you; the bots if you are the admin). Also tells the shooter's own
    // screen what it seems to have hit (a hit marker), though the owner of the body has the last word.
    resolve(s) {
      const w = weapon(s.w), max = w.melee || (w.r1 * 1.6 + 40), mine = [], seen = [];
      for (const f of this.figures()) {
        if (f.id === s.owner) continue;const t0 = this.team(f.id);if (t0 >= 0 && t0 === this.team(s.owner)) continue;
        (f.local || (f.bot && this.isAdmin()) ? mine : seen).push(f);
      }
      s.hits = [];s.end = [];
      for (const d of pelletDirs(w, s.d, s.seed)) {
        const blocked = this.block(s.o, d, max);let best = null;
        for (const f of [...mine, ...seen]) {const h = rayFigure(s.o, d, blocked, f.feet, f.stance, f.yaw);if (h && (!best || h.t < best.t)) best = {...h, f};}
        s.end.push(best ? best.t : blocked);
        if (!best) continue;s.hits.push({id: best.f.id, head: best.head, t: best.t});
        if (!this.ses.id || this.ses.state !== 'play') continue;
        // A bot's shot does less (60 % to a player, 30 % to another bot), so a game is yours to win.
        if (mine.includes(best.f)) this.hurt(best.f, damageAt(w, best.t, best.head) * (s.owner < 0 ? (best.f.bot ? AR.BOT_VS_BOT : AR.BOT_DMG) : 1), s.owner, s.o);
      }
      if (s.owner === this.you() && s.hits.length) this.hitT = .25;
    }
    hurt(f, dmg, by, from) {
      if (f.local) {
        if (!this.alive || !this.playing()) return;this.hp -= dmg;this.hurtT = 0;this.dmgFrom = from;this.dmgT = 1.2;this.sound('hit', .5);
        if (this.hp <= 0) {this.hp = 0;this.alive = false;this.deaths++;this.kmap[by] = (this.kmap[by] || 0) + 1;this.lastBy = by;this.respawnT = AR.RESPAWN_S;this.notice(`${this.name(by)} got you. Back in ${AR.RESPAWN_S} s.`, 3);this.events.push({died: by});}
        return;
      }
      const b = this.ses.bots.find(b => b.id === f.id);if (!b || !b.alive) return;
      b.hp -= dmg;const ai = this.botAi.get(b.id);if (ai) {ai.hurt = 0;ai.alert = {x: from.x, z: from.z, t: 3};}
      if (b.hp <= 0) {b.alive = false;b.deaths++;b.by = by;b.respawn = AR.RESPAWN_S;(this.ses.bk[b.id] = this.ses.bk[b.id] || {})[by] = (this.ses.bk[b.id][by] || 0) + 1;}
    }
    // The spawn point farthest from everybody who is against you.
    spawnFor(id) {
      const foes = this.figures().filter(f => f.id !== id && (this.team(id) < 0 || this.team(f.id) !== this.team(id)));let best = this.spawns[0], score = -1;
      this.spawns.forEach((p, i) => {const d = foes.reduce((m, f) => Math.min(m, Math.hypot(f.feet.x - p.x, f.feet.z - p.z)), 60) + this.rand() * 6 + (this.team(id) >= 0 ? (this.team(id) === 0 ? -1 : 1) * (this.uv(p.x, p.z).u - this.data.w / 2) * .5 : 0) + ((i * 7 + Math.abs(id) * 3) % 5);if (d > score) {score = d;best = p;}});
      return best;
    }
    spawn(first) {
      const p = this.spawnFor(this.you()), c = this.pad, yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z));
      if (this.ctx.teleport) this.ctx.teleport(p.x, p.z, yaw);this.alive = true;this.hp = AR.HP;this.respawnT = 0;this.hurtT = 99;if (this.gun) this.gun.refill();
      if (first) {const m = MODES.find(m => m.id === this.ses.mode), t = this.team(this.you());this.notice(`${m.name}. ${m.text}${t >= 0 ? ` You are ${TEAM_NAME[t]}.` : ''}`, 6);}
    }
    // ---- the admin: the game and the bots ----
    runAdmin(dt, input) {
      const S = this.ses, t = this.now();
      if (S.state === 'lobby') {
        if (!this.onPad) {this.startHold = 0;return;}
        if (input.left || input.right) {const i = MODES.findIndex(m => m.id === S.mode);S.mode = MODES[(i + (input.right ? 1 : MODES.length - 1)) % MODES.length].id;this.sound('beep', .4);}
        if (input.up || input.down) {S.nb = clamp(S.nb + (input.up ? 1 : -1), 0, AR.MAX_BOTS);this.sound('beep', .4);}
        this.startHold = input.crossHeld ? this.startHold + dt : 0;
        if (this.startHold > 1) {this.startHold = 0;this.startGame();}
        return;
      }
      const humans = this.all.filter(m => m.ses === S.id);this.emptyT = humans.length ? 0 : this.emptyT + dt;
      if (this.emptyT > 3) {this.emptyT = 0;S.state = 'lobby';S.bots = [];return;}
      if (S.state === 'count') {if (t >= S.t0) S.state = 'play';return;}
      if (S.state === 'end') {if (t >= S.endT + AR.END_S * 1000) {S.state = 'lobby';S.bots = [];}return;}
      this.stepBots(dt);
      // Won?
      const B = this.board();let win = null;
      if (S.mode === 'gg') {const top = B.find(p => p.kills >= LADDER.length);if (top) win = top.id;}
      else if (S.mode === 'ffa') {if (B[0] && B[0].kills >= AR.FFA_LIM) win = B[0].id;}
      else {for (const tm of [0, 1]) if (this.teamKills(tm) >= AR.TDM_LIM) win = tm;}
      if (win === null && t >= S.t0 + AR.DUR_S * 1000) win = S.mode === 'tdm' ? (this.teamKills(0) >= this.teamKills(1) ? 0 : 1) : (B[0] ? B[0].id : 0);
      if (win !== null) {S.state = 'end';S.endT = t;S.win = win;}
    }
    startGame() {
      const S = this.ses, L = this.all.filter(m => m.lobby > 0).sort((a, b) => a.lobby - b.lobby || a.id - b.id);
      S.id = Math.floor((this.now() / 1000) % 1e8) + 1;S.state = 'count';S.t0 = this.now() + AR.COUNT_S * 1000;S.endT = 0;S.win = 0;S.team = {};S.bk = {};S.bots = [];this.botAi.clear();
      const n = [0, 0];for (const m of L) {const tm = n[0] <= n[1] ? 0 : 1;S.team[m.id] = tm;n[tm]++;}
      // Alone you always get somebody to shoot at.
      const nb = Math.max(S.nb, L.length < 2 ? 1 : 0), loadout = ['hk416', 'ak47', 'mp5', 'm4a1', 'r870', 'p90', 'ag3'];
      for (let i = 0; i < nb; i++) {const id = -(i + 1), tm = n[0] <= n[1] ? 0 : 1;S.team[id] = tm;n[tm]++;S.bots.push({id, x: 0, y: 0, z: 0, yaw: 0, alive: true, hp: AR.HP, w: indexOf(S.mode === 'gg' ? LADDER[0] : loadout[i % loadout.length]), base: indexOf(loadout[i % loadout.length]), stance: 'stand', deaths: 0, by: 0, respawn: 0});}
      for (const b of S.bots) this.placeBot(b);
    }
    placeBot(b) {const p = this.spawnFor(b.id);b.x = p.x;b.z = p.z;b.y = this.ground(p.x, p.z);b.alive = true;b.hp = AR.HP;b.stance = 'stand';this.botAi.set(b.id, {goal: null, think: 0, cool: 1 + this.rand(), burst: 0, seen: 0, hurt: 99, alert: null, skill: .3 + ((-b.id * 37) % 10) / 25, stuck: 0});}
    stepBots(dt) {
      const S = this.ses, figs = this.figures();
      for (const b of S.bots) {
        if (!b.alive) {if ((b.respawn -= dt) <= 0) this.placeBot(b);continue;}
        let ai = this.botAi.get(b.id);if (!ai) {this.placeBot(b);ai = this.botAi.get(b.id);}
        if (S.mode === 'gg') b.w = indexOf(LADDER[this.level(b.id)]);else b.w = b.base;
        const w = weapon(b.w), eye = v3(b.x, b.y + (b.stance === 'crouch' ? 1.0 : 1.55), b.z);
        ai.hurt += dt;if (ai.hurt > AR.REGEN_AFTER && b.hp < AR.HP) b.hp = Math.min(AR.HP, b.hp + AR.REGEN * dt);
        // Look for somebody to shoot at (now and then, the nearest one in sight).
        if ((ai.think -= dt) <= 0) {
          ai.think = .25 + this.rand() * .1;ai.foe = null;let bd = 1e9;
          for (const f of figs) {
            if (f.id === b.id || (this.team(b.id) >= 0 && this.team(f.id) === this.team(b.id))) continue;
            const dx = f.feet.x - b.x, dz = f.feet.z - b.z, dist = Math.hypot(dx, dz);if (dist >= bd) continue;
            const z = this.zoneAt(f.feet.x, f.feet.z), cf = f.bot ? 1 : camoFactor({camo: (CAMO[f.camo] || CAMO[0]).id, zone: z ? z.camo : '', stance: f.stance, moving: f.local && this.ctx.speed ? Math.min(1, this.ctx.speed() / 5) : .5, cover: this.inSoft(f.feet.x, f.feet.z)});
            if (dist > AR.SIGHT * cf && !(ai.alert && dist < 45)) continue;
            const tgt = add(f.feet, v3(0, f.stance === 'prone' ? .3 : f.stance === 'crouch' ? .8 : 1.3, 0)), dir = norm(sub(tgt, eye)), L = len(sub(tgt, eye));
            if (this.block(eye, dir, L) < L - .3) continue;
            bd = dist;ai.foe = {f, dist, dir, cf};
          }
          if (ai.alert && (ai.alert.t -= .3) <= 0) ai.alert = null;
        }
        // Where to go: toward the foe until the weapon's good range (the knife: all the way), else to a spot, else a shot we heard.
        let gx = null, gz = null, speed = 2.6;
        if (ai.foe) {
          const want = w.melee ? .8 : w.cls === 'shotgun' ? 9 : w.cls === 'sniper' ? 40 : 18, f = ai.foe.f;
          if (ai.foe.dist > want) {gx = f.feet.x;gz = f.feet.z;speed = w.melee ? 5.2 : 3.4;}
          b.yaw = Math.atan2(-(f.feet.x - b.x), -(f.feet.z - b.z));ai.seen += dt;b.stance = !w.melee && ai.foe.dist <= want * 1.25 && ai.foe.dist > 9 && ai.seen > 1.2 ? 'crouch' : 'stand';
          if ((ai.cool -= dt) <= 0 && ai.seen > .45 - .2 * ai.skill) {
            if (w.melee) {if (ai.foe.dist < w.melee) {this.fire(eye, ai.foe.dir, b.id, b.w, 0);ai.cool = 60 / w.rpm;}}
            else {
              const sig = aimError(w, ai.foe.dist, {skill: ai.skill, targetSpeed: 3, camo: ai.foe.cf, first: ai.burst === 0, seen: ai.seen}), R = () => this.rand();
              const side = norm(cross(ai.foe.dir, v3(0, 1, 0))), up = cross(side, ai.foe.dir), d = norm(add(ai.foe.dir, add(mul(side, Math.tan(sig) * gauss(R)), mul(up, Math.tan(sig) * gauss(R) * .7))));
              this.fire(add(eye, mul(d, .5)), d, b.id, b.w, 0);ai.burst++;
              const n = w.auto ? 3 + Math.floor(ai.skill * 3) : 1;if (ai.burst >= n) {ai.burst = 0;ai.cool = (w.auto ? .7 : 60 / w.rpm + .35) + this.rand() * .5;} else ai.cool = 60 / w.rpm;
            }
          }
        } else {
          ai.seen = 0;ai.burst = 0;b.stance = 'stand';
          if (ai.alert) {gx = ai.alert.x;gz = ai.alert.z;speed = 3.4;}
          else {if (!ai.goal || Math.hypot(ai.goal.x - b.x, ai.goal.z - b.z) < 2.5 || ai.stuck > 1.5) {ai.goal = this.spawns[Math.floor(this.rand() * this.spawns.length)];ai.stuck = 0;}gx = ai.goal.x;gz = ai.goal.z;}
          if (gx !== null) b.yaw = Math.atan2(-(gx - b.x), -(gz - b.z));
        }
        if (gx !== null && b.stance !== 'crouch') {
          const dx = gx - b.x, dz = gz - b.z, L = Math.hypot(dx, dz) || 1, sx = dx / L * speed * dt, sz = dz / L * speed * dt, bx = b.x, bz = b.z;
          if (this.ctx.moveBot) {const p = this.ctx.moveBot({x: b.x, y: b.y, z: b.z}, sx, sz);b.x = p.x;b.z = p.z;b.y = p.y;}
          else {b.x += sx;b.z += sz;for (const t of this.solids) {const ex = b.x - t.x, ez = b.z - t.z, q = Math.hypot(ex, ez), m = t.r + .3;if (q < m && q > 1e-6) {b.x = t.x + ex / q * m;b.z = t.z + ez / q * m;}}b.y = this.ground(b.x, b.z);}
          // Keep them in the arena, and when something is in the way step round it.
          const p = this.uv(b.x, b.z), cu = clamp(p.u, 1.5, this.data.w - 1.5), cv = clamp(p.v, 1.5, this.data.d - 1.5);if (cu !== p.u || cv !== p.v) {b.x = this.o.x + this.ux.x * cu + this.vx.x * cv;b.z = this.o.z + this.ux.z * cu + this.vx.z * cv;}
          if (Math.hypot(b.x - bx, b.z - bz) < speed * dt * .3) {ai.stuck += dt;const a = b.yaw + (Math.floor(this.clock / 2 + b.id) % 2 ? 1.2 : -1.2), ox = -Math.sin(a) * speed * dt, oz = -Math.cos(a) * speed * dt;if (this.ctx.moveBot) {const q = this.ctx.moveBot({x: b.x, y: b.y, z: b.z}, ox, oz);b.x = q.x;b.z = q.z;b.y = q.y;} else {b.x += ox;b.z += oz;}} else ai.stuck = Math.max(0, ai.stuck - dt);
        }
      }
    }
    // 'ar' for our next 'st' (takes the shots fired since the last one); null when we are not in the arena.
    localState() {
      if (this.lobbyT <= 0) {this.outbox = [];return null;}
      const o = {l: Math.round(this.lobbyT), s: this.inGame() ? this.mySes : 0, a: this.alive ? 1 : 0, d: this.deaths, k: this.kmap, by: this.lastBy, w: Math.max(0, this.wNow), c: this.ctx.camo ? this.ctx.camo() : 0};
      if (this.outbox.length) {o.x = this.outbox;this.outbox = [];}
      if (this.isAdmin()) o.ses = sesToJson(this.ses);
      return o;
    }
  }

  // ---------- The models ----------
  // The weapon stands along -z (the muzzle), +y up, the origin at the pistol grip. A few boxes and tubes in its real size.
  const GUN_MATS = new Map();
  function buildGun(T, id) {
    const w = weapon(id), g = new T.Group();g.name = w.name;
    // One material per colour for all the weapons (so a wall of them merges into a few meshes).
    const M = (color, rough = .5, metal = .4) => {const k = `${color}/${rough}/${metal}`;if (!GUN_MATS.has(k)) GUN_MATS.set(k, new T.MeshStandardMaterial({color, roughness: rough, metalness: metal}));return GUN_MATS.get(k);};
    const steel = M(0x1b1d20, .42, .6), poly = M(w.tan ? 0x8a7650 : 0x222427, .7, .1), wood = M(0x6b4423, .6, 0), light = M(0x9aa0a6, .3, .8);
    const box = (sx, sy, sz, x, y, z, m = steel, rx = 0) => {const o = new T.Mesh(new T.BoxGeometry(sx, sy, sz), m);o.position.set(x, y, z);o.rotation.x = rx;o.castShadow = true;g.add(o);return o;};
    const tube = (r, l, x, y, z, m = steel) => {const o = new T.Mesh(new T.CylinderGeometry(r, r, l, 10), m);o.rotation.x = Math.PI / 2;o.position.set(x, y, z);o.castShadow = true;g.add(o);return o;};
    const L = w.len;let muzzle = -L * .7;
    if (w.cls === 'knife') {box(.028, .034, .12, 0, 0, .02, poly);box(.05, .012, .014, 0, 0, -.045, steel);const b = box(.004, .036, .17, 0, .004, -.135, light);b.name = 'blade';muzzle = -.22;}
    else if (w.cls === 'pistol') {
      box(.03, .11, .045, 0, -.045, .012, poly, .22);// grip
      if (w.revolver) {box(.028, .05, .1, 0, .03, -.03, steel);tube(.024, .05, 0, .028, -.03, light);tube(.011, L - .1, 0, .042, -.03 - (L - .1) / 2 - .04, steel);box(.006, .012, .012, 0, .058, -L + .02, steel);muzzle = -L - .0;}
      else {box(.03, .034, L * .92, 0, .03, -L * .36, w.id === 'deagle' ? light : steel);box(.028, .024, L * .5, 0, .004, -L * .22, poly);box(.006, .01, .01, 0, .052, -L * .78, steel);box(.012, .01, .012, 0, .052, .04, steel);muzzle = -L * .84;}
    } else if (w.cls === 'bow') {
      box(.04, .05, .62, 0, 0, -.2, wood);box(.03, .09, .04, 0, -.06, .02, wood, .25);box(.035, .05, .2, 0, 0, .2, wood);
      for (const s of [-1, 1]) {const limb = box(.3, .014, .03, s * .15, .03, -.5, steel);limb.rotation.y = s * .35;}
      const str = box(.56, .004, .004, 0, .03, -.42, light);str.name = 'string';tube(.005, .5, 0, .04, -.2, light).name = 'bolt';box(.02, .03, .06, 0, .06, -.05, steel);muzzle = -.5;
    } else {
      const recv = w.cls === 'smg' ? .26 : .3, bl = Math.max(.12, L - recv - (w.cls === 'smg' ? .12 : .3)), stockM = w.wood ? wood : poly;
      box(.045, .07, recv, 0, .035, -.06, steel);// receiver
      box(.03, .1, .04, 0, -.05, .02, w.wood ? wood : poly, .28);// pistol grip
      if (w.id === 'p90') {box(.05, .11, .3, 0, .0, .16, poly);box(.04, .03, .26, 0, .085, -.04, M(0x3a3d40, .4, .1));}
      else if (w.id !== 'uzi') {box(.036, w.wood ? .09 : .06, .26, 0, .02, .22, stockM);box(.04, .11, .03, 0, .0, .35, stockM);}// stock and butt
      else box(.012, .012, .2, 0, .05, .16, steel);
      const gz = -.06 - recv / 2 - bl * .28;
      box(w.cls === 'shotgun' ? .05 : .048, w.cls === 'shotgun' ? .05 : .055, bl * .56, 0, .03, gz, w.wood ? wood : poly);// handguard
      tube(w.cls === 'shotgun' ? .014 : w.id === 'm82' ? .015 : .0095, bl, 0, .045, -.06 - recv / 2 - bl / 2, steel);// barrel
      if (w.cls === 'shotgun') tube(.013, bl * .8, 0, .016, -.06 - recv / 2 - bl * .4, steel);// magazine tube
      muzzle = -.06 - recv / 2 - bl;
      if (w.id === 'm82') {box(.04, .05, .07, 0, .045, muzzle + .03, steel);for (const s of [-1, 1]) {const leg = box(.01, .26, .01, s * .07, -.09, gz - .1, steel);leg.rotation.z = s * .3;}}
      if (w.cls === 'lmg') {box(.11, .1, .14, 0, -.06, -.1, M(0x4a4f3a, .8, 0));for (const s of [-1, 1]) {const leg = box(.01, .24, .01, s * .06, -.08, gz - .12, steel);leg.rotation.z = s * .3;}}
      else if (w.cls === 'rifle' || w.cls === 'smg') {const curved = w.id === 'ak47', mh = w.cls === 'smg' ? .16 : w.id === 'ag3' ? .13 : .17;if (w.id !== 'p90') box(.024, mh, .05, 0, -.03 - mh / 2 + .03, w.id === 'uzi' ? .02 : -.1, steel, curved ? -.3 : w.id === 'uzi' ? .28 : -.08);}
      else if (w.cls === 'sniper' && w.id === 'm82') box(.03, .11, .1, 0, -.05, -.1, steel);
      if (w.scope) {tube(.022, .3, 0, .115, -.08, steel);tube(.028, .05, 0, .115, -.25, steel);tube(.026, .04, 0, .115, .08, steel);box(.012, .03, .02, 0, .085, -.16, steel);box(.012, .03, .02, 0, .085, 0, steel);}
      else if (w.cls === 'rifle' || w.cls === 'lmg') {box(.012, .035, .012, 0, .085, muzzle + .08, steel);box(.03, .025, .05, 0, .085, -.02, steel);if (w.id === 'm4a1' || w.id === 'hk416') box(.03, .012, .2, 0, .075, -.06, steel);}
      else box(.008, .014, .01, 0, .07, muzzle + .03, steel);
    }
    g.userData.muzzle = muzzle;g.userData.weapon = w.id;
    return g;
  }

  return {WEAPONS, weapon, indexOf, CLASS_NAME, isSidearm, isPrimary, LADDER, damageAt, spreadOf, inCone, pelletDirs, Gun, rayFigure, CAMO, camoFactor, aimError,
    AR, MODES, TEAM_NAME, TEAM_CSS, TEAM_CAMO, BOT_NAMES, Arena, sesToJson, sesFromJson, memberFromJson, teamOf, buildGun, rng};
});
