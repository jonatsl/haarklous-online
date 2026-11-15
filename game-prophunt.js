/* Prop hunt – hide and seek (issue #124, an idea from the user's friend): hiders turn into things that really stand in the
 * arena (a bench, a bin, a bush, a bike, a street lamp ...) and hide as well as they can; one or more hunters with a paint
 * marker look for them. Arenas (prophunt-data.js, made by tools/make-prophunt.cjs): Haarklous plass (the park by the
 * firepit), Olaf Ryes plass and the backyard of Rathkes gate 1, each with a start ring (the lobby) and clear bounds.
 *
 * Lobby: stand in a start ring to join the prop hunt group; the first one in is the admin (earliest join time, then the
 * lowest player id, like paintball), who picks the arena and the number of rounds and starts (hold ✕). Alone, the game's
 * own players (bots) fill the round: you hunt four hiders, or you hide with three of them from a bot hunter.
 * A round: hiding time (30 s; the hunters wait at the spawn with their screens blacked out), then hunting time (2.5–4 min).
 * Hiders win if any of them are left at the end; hunters win when all are found. Hunters are picked fairly (fewest hunts
 * so far, then who hunted longest ago): 1 up to 4 players, 2 for 5–8, 3 for 9–12. A match is N rounds; most points wins.
 * Points: a find 2, surviving a round 3, a taunt 1 (at most 3 a round), every player of the winning side 1.
 * Hiders: □ / E become the thing you look at (any number of times while hiding, CHANGES more while hunting); its health,
 * speed and size come from its class (small things are quick and hard to hit but die from two hits). R1 / X locks or frees
 * the prop's rotation (locked after a change, with the copied thing's heading), D-pad ←/→ turns it, △ / F taunts
 * (a whistle: +1 point). A hider must whistle every 30 s anyway (every 12 s in the last 30 s); the game does it for them.
 * Hunters: R2 / left mouse shoots (hit-scan, 3 shots a second), L2 / right mouse aims. A hit takes 25 from a hider and
 * gives the hunter 5 back; shooting a real thing costs the hunter 10 (a puff shows it was a real one); at 0 the hunter is out.
 * In the last 30 s hunters see "warmer / colder" for the nearest hider. Found hiders and hunters who are out watch others.
 * Online: everything rides in the players' own state ('st', field 'ph') and the admin's session (relayed unchanged by the
 * server). Each hider decides whether a shot hit it (its own view); the admin keeps the clock (mp.net.serverNow()) and the
 * score, and the next earliest member takes over with the same session when the admin leaves.
 *
 * GameProphunt.Rules(data, ctx) is pure logic (Node tests); GameProphunt.create({...}) adds models, visuals, bots' bodies,
 * the HUD and sound.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameProphunt = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const PH = {HIDE_S: 30, END_S: 10, OVER_S: 16, TAUNT_S: 30, TAUNT_LATE_S: 12, LATE_S: 30, TAUNT_COOL_S: 8, HUNTER_HP: 100, DAMAGE: 25, WRONG: 10, HEAL: 5, RATE: 3, RANGE: 60,
    CHANGES: 2, RING_R: 1.8, MAX: 12, BOTS: 4, EMPTY_S: 3, LEAVE_S: 2};
  const POINTS = {find: 2, survive: 3, taunt: 1, tauntMax: 3, win: 1};
  // Size classes: health, walking speed (m/s; walking is 2.5 and running 6), how far behind the camera sits.
  const CLASS = {s: {hp: 50, speed: 3.2, cam: 2.6}, m: {hp: 75, speed: 2.6, cam: 3.2}, l: {hp: 100, speed: 2.1, cam: 4.2}, xl: {hp: 125, speed: 1.7, cam: 6.5}};
  // The things: footprint w (across) x d (front to back) and height h in metres; the front faces -z in the model.
  const KINDS = {
    bench: {name: 'bench', w: 1.7, d: .66, h: .86, cls: 'l'}, bin: {name: 'bin', w: .56, d: .56, h: 1.02, cls: 's'}, bush: {name: 'bush', w: 1.7, d: 1.7, h: 1.3, cls: 'l', kit: 'bush'},
    tree: {name: 'small tree', w: .5, d: .5, h: 5.2, cls: 'xl', kit: 'tree', hitW: 2.4, hitFrom: 1.9}, lamp: {name: 'street lamp', w: .3, d: .3, h: 5.15, cls: 'xl', kit: 'lamp', hitW: .5},
    crate: {name: 'crate', w: .8, d: .8, h: .7, cls: 'm'}, cone: {name: 'traffic cone', w: .38, d: .38, h: .72, cls: 's'}, bike: {name: 'bicycle', w: .6, d: 1.74, h: 1.05, cls: 'm'},
    scooter: {name: 'e-scooter', w: .52, d: 1.12, h: 1.2, cls: 's'}, moped: {name: 'moped', w: .7, d: 1.8, h: 1.2, cls: 'l'}, barrel: {name: 'barrel', w: .6, d: .6, h: .92, cls: 'm'},
    sign: {name: 'sign', w: .62, d: .56, h: 1.0, cls: 's'}, logs: {name: 'pile of logs', w: 1.45, d: .95, h: .62, cls: 'l'}, picnic: {name: 'picnic table', w: 1.8, d: 1.55, h: .76, cls: 'xl'},
    boulder: {name: 'boulder', w: 1.15, d: .95, h: .72, cls: 'l'}, planter: {name: 'planter', w: .8, d: .8, h: 1.05, cls: 'm'}, wheeliebin: {name: 'waste container', w: 1.28, d: .8, h: 1.3, cls: 'l'}
  };
  const KIND_LIST = Object.keys(KINDS), kindIndex = k => KIND_LIST.indexOf(k);
  const hpOf = k => CLASS[KINDS[k].cls].hp, speedOf = k => CLASS[KINDS[k].cls].speed;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---------- Pure helpers ----------
  const hunterCount = n => n <= 1 ? 0 : n <= 4 ? 1 : n <= 8 ? 2 : 3;
  // Fair hunters: fewest hunts so far, then the one who hunted longest ago (never = first), then a shuffle by the match.
  function pickHunters(ids, hunts = {}, last = {}, n = hunterCount(ids.length), seed = 1) {
    const h = id => {let x = (Math.imul(id | 0, 2654435761) ^ seed) >>> 0;x ^= x >>> 15;x = Math.imul(x, 2246822507) >>> 0;return x ^ (x >>> 13);};
    return ids.slice().sort((a, b) => (hunts[a] || 0) - (hunts[b] || 0) || (last[a] ?? -1) - (last[b] ?? -1) || h(a) - h(b) || a - b).slice(0, n);
  }
  // Session phase at server time t: lobby, hide, hunt, end (a round's result), over (the match's result).
  function phaseOf(S, t) {
    if (!S || S.state === 'lobby' || !S.id) return 'lobby';
    if (S.state === 'round') return t < S.t0 + S.hide * 1000 ? 'hide' : 'hunt';
    return S.state;
  }
  const huntEnd = S => S.t0 + (S.hide + S.hunt) * 1000;
  const hideEnd = S => S.t0 + S.hide * 1000;
  function timeLeft(S, t) {const p = phaseOf(S, t);return p === 'hide' ? (hideEnd(S) - t) / 1000 : p === 'hunt' ? (huntEnd(S) - t) / 1000 : 0;}
  // A hider must whistle every TAUNT_S seconds while hunting (TAUNT_LATE_S in the last LATE_S): due from its last whistle.
  function tauntDue(lastT, S, t) {
    if (phaseOf(S, t) !== 'hunt') return false;
    const late = huntEnd(S) - t <= PH.LATE_S * 1000, every = (late ? PH.TAUNT_LATE_S : PH.TAUNT_S) * 1000;
    return t - Math.max(lastT || 0, hideEnd(S)) >= every;
  }
  // Points of polygons: inside any zone; nearest point inside (moved m in from the edge) when outside.
  const inPoly = (x, s, poly) => {let c = false;for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {const a = poly[i], b = poly[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) c = !c;}return c;};
  const inZones = (zones, x, s) => zones.some(z => inPoly(x, s, z));
  function clampToZones(zones, x, s, m = .35) {
    if (inZones(zones, x, s)) return null;
    let best = null, bd = Infinity;
    for (const z of zones) {
      const cx = z.reduce((a, p) => a + p[0], 0) / z.length, cs = z.reduce((a, p) => a + p[1], 0) / z.length;
      for (let i = 0; i < z.length; i++) {
        const a = z[i], b = z[(i + 1) % z.length], dx = b[0] - a[0], ds = b[1] - a[1], L = dx * dx + ds * ds || 1, t = clamp(((x - a[0]) * dx + (s - a[1]) * ds) / L, 0, 1);
        const px = a[0] + dx * t, ps = a[1] + ds * t, d = Math.hypot(x - px, s - ps);
        if (d < bd) {const k = Math.hypot(cx - px, cs - ps) || 1;bd = d;best = {x: px + (cx - px) / k * m, s: ps + (cs - ps) / k * m};}
      }
    }
    return best;
  }
  // Ray (origin o, unit direction d) against a box standing on the ground: {x, y (bottom), z, yaw, w, d, h}. Distance or Infinity.
  function rayBox(o, d, B) {
    const C = Math.cos(B.yaw), S = Math.sin(B.yaw), px = o.x - B.x, pz = o.z - B.z, py = o.y - (B.y + (B.y0 || 0) + B.h / 2);
    const lo = [px * C - pz * S, py, px * S + pz * C], ld = [d.x * C - d.z * S, d.y, d.x * S + d.z * C], H = [B.w / 2, B.h / 2, B.d / 2];
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ld[k]) < 1e-9) {if (Math.abs(lo[k]) > H[k]) return Infinity;continue;}
      let a = (-H[k] - lo[k]) / ld[k], b = (H[k] - lo[k]) / ld[k];if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);t1 = Math.min(t1, b);if (t0 > t1) return Infinity;
    }
    return t0;
  }
  // The box a thing (or a hider) is hit in: a tree in its crown and trunk, a lamp along its pole.
  function hitBox(kind, x, y, z, yaw, sc = 1) {
    const K = KINDS[kind];if (!K) return null;
    if (kind === 'tree') return [{x, y, z, yaw, w: .35, d: .35, h: K.h * sc, y0: 0}, {x, y, z, yaw, w: K.hitW * sc, d: K.hitW * sc, h: (K.h - K.hitFrom) * sc, y0: K.hitFrom * sc}];
    return [{x, y, z, yaw, w: (K.hitW || K.w) * sc, d: (K.hitW || K.d) * sc, h: K.h * sc, y0: 0}];
  }
  const boxHit = (o, d, boxes) => {let t = Infinity;for (const b of boxes || []) t = Math.min(t, rayBox(o, d, b));return t;};
  // Points of a finished round. roles {id: 'h'|'p'}, found {victim: finder}, alive {id: bool} (hiders at the end), taunts {id: n}.
  function roundPoints({roles, found, alive, taunts, winner}) {
    const pts = {};const add = (id, v) => {pts[id] = (pts[id] || 0) + v;};
    for (const [v, f] of Object.entries(found)) if (roles[f] === 'h' && roles[v] === 'p') add(+f, POINTS.find);
    for (const [id, r] of Object.entries(roles)) {
      if (r === 'p') {if (alive[id]) add(+id, POINTS.survive);add(+id, Math.min(POINTS.tauntMax, taunts[id] || 0) * POINTS.taunt);}
      if (winner && r === winner) add(+id, POINTS.win);else if (!(id in pts)) pts[id] = 0;
    }
    return pts;
  }
  const hotness = d => d < 6 ? 'hot' : d < 14 ? 'warm' : d < 26 ? 'cool' : 'cold';
  // Where a bot hider goes: next to a real thing of the same kind (in line with it, or just beside it), clear of others.
  function botSpot(things, kind, taken, rnd, clear) {
    const same = things.filter(t => t.kind === kind), K = KINDS[kind];
    for (let i = 0; i < 60 && same.length; i++) {
      const a = same[Math.floor(rnd() * same.length)], along = kind === 'lamp' || kind === 'tree' ? true : rnd() < .65, side = rnd() < .5 ? -1 : 1;
      const gap = kind === 'lamp' ? 7 + rnd() * 6 : kind === 'tree' ? 4 + rnd() * 3 : (along ? K.w : K.d) * (a.sc || 1) + .35 + rnd() * 1.2;
      const ax = Math.cos(a.yaw), az = -Math.sin(a.yaw), fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      const x = a.x + (along ? ax : fx) * gap * side, z = a.z + (along ? az : fz) * gap * side, yaw = a.yaw + (rnd() < .8 ? 0 : (rnd() - .5) * .5);
      if (taken.some(p => Math.hypot(p.x - x, p.z - z) < 1.2) || things.some(t => t !== a && Math.hypot(t.x - x, t.z - z) < .9)) continue;
      if (clear && !clear(x, z)) continue;
      return {x, z, yaw, near: a};
    }
    return null;
  }

  // ---------- Session (the admin's match) and member states: JSON on the wire, short keys ----------
  const newSession = () => ({id: 0, arena: 0, state: 'lobby', t0: 0, hide: PH.HIDE_S, hunt: 210, round: 0, rounds: 3, roles: {}, score: {}, hunts: {}, last: {}, found: {}, endT: 0, winner: '', names: {}, bots: [], solo: 'hunt'});
  const sesToJson = S => ({id: S.id, ar: S.arena, st: S.state, t0: S.t0, hs: S.hide, us: S.hunt, rn: S.round, rs: S.rounds, ro: {...S.roles}, sc: {...S.score}, hn: {...S.hunts}, lh: {...S.last}, fd: {...S.found},
    et: S.endT, wi: S.winner, nm: {...S.names}, lp: {...(S.lastPts || {})}, bt: S.bots.map(b => [b.id, b.role === 'h' ? 1 : 0, r2(b.x), r2(b.y), r2(b.z), r3(b.yaw), b.kind, r3(b.pyaw), b.hp, b.alive ? 1 : 0, b.w, b.fb, b.tn, b.sc || 1, ...(b.out || []).slice(-6).flat()]), so: S.solo});
  function sesFromJson(O) {
    if (!O || typeof O !== 'object') return null;const S = newSession(), num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d, obj = v => v && typeof v === 'object' ? v : {};
    S.id = num(O.id, 0);S.arena = num(O.ar, 0);if (typeof O.st === 'string') S.state = O.st;S.t0 = num(O.t0, 0);S.hide = num(O.hs, PH.HIDE_S);S.hunt = num(O.us, 210);S.round = num(O.rn, 0);S.rounds = num(O.rs, 3);
    for (const [k, v] of Object.entries(obj(O.ro))) if (v === 'h' || v === 'p') S.roles[+k] = v;
    for (const key of [['sc', 'score'], ['hn', 'hunts'], ['lh', 'last'], ['fd', 'found']]) for (const [k, v] of Object.entries(obj(O[key[0]]))) S[key[1]][+k] = +v;
    for (const [k, v] of Object.entries(obj(O.nm))) S.names[+k] = String(v).slice(0, 32);
    S.lastPts = {};for (const [k, v] of Object.entries(obj(O.lp))) S.lastPts[+k] = +v;
    S.endT = num(O.et, 0);S.winner = O.wi === 'h' || O.wi === 'p' ? O.wi : '';S.solo = O.so === 'hide' ? 'hide' : 'hunt';
    S.bots = (Array.isArray(O.bt) ? O.bt : []).filter(b => Array.isArray(b) && b.length >= 14).slice(0, PH.BOTS + 1).map(b => {
      const shots = [];for (let i = 14; i + 7 < b.length; i += 8) shots.push(b.slice(i, i + 8));
      return {id: b[0], role: b[1] ? 'h' : 'p', x: b[2], y: b[3], z: b[4], yaw: b[5], kind: b[6], pyaw: b[7], hp: b[8], alive: !!b[9], w: b[10], fb: b[11], tn: b[12], sc: b[13], shots};
    });
    return S;
  }
  // A member from its 'ph' state (plus where its avatar is).
  function memberFromJson(O, extra) {
    if (!O || typeof O !== 'object') return null;const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
    return {...extra, lobby: num(O.l, 0), ses: num(O.s, 0), round: num(O.r, 0), alive: num(O.a, 1) !== 0, hp: num(O.hp, 100), kind: num(O.k, -1), pyaw: num(O.y, 0), sc: num(O.c, 1), fb: num(O.f, 0), w: num(O.w, 0), tn: num(O.t, 0),
      shots: Array.isArray(O.h) ? O.h.filter(s => Array.isArray(s) && s.length === 8 && s.every(v => typeof v === 'number' && isFinite(v))) : [], sesJson: O.ses && typeof O.ses === 'object' ? O.ses : null};
  }
  const BOT_NAMES = ['Kari', 'Ola', 'Ingrid', 'Lars', 'Sofie'];
  // Walk-world obstacles of the things themselves (static), with the ground height at the start.
  function obstacles(rules, heightAt) {
    const out = [];
    for (const A of rules.arenas) for (const t of A.things) {
      if (t.world) continue;const K = KINDS[t.kind], y = heightAt(t.x, t.z), sc = t.sc || 1;
      const w = (t.kind === 'tree' || t.kind === 'lamp' ? .3 : K.w * (t.kind === 'bush' ? .55 : 1)) * sc / 2, d = (t.kind === 'tree' || t.kind === 'lamp' ? .3 : K.d * (t.kind === 'bush' ? .55 : 1)) * sc / 2, Cy = Math.cos(t.yaw), Sy = Math.sin(t.yaw);
      out.push({points: [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a, b]) => ({x: t.x + a * Cy + b * Sy, z: t.z - a * Sy + b * Cy})), minY: y - .4, maxY: y + K.h * sc, kind: 'prop'});
    }
    return out;
  }

  // ---------- Rules ----------
  class Rules {
    // ctx: {serverNow(), you(), yourName(), others() -> members, feet() -> {x,y,z}, yaw(), teleport(x, z, yaw), setPos(x, z),
    //   cameraPos(), cameraFwd(), toWorld(x, s) -> {x, z}, toLocal(x, z) -> {x, s}, headingToYaw(h), ground(x, z),
    //   blockDist(o, d, max) -> metres to the first wall / building / tree (Infinity), clear(x, z) -> can a bot stand there,
    //   realThings(arena) -> [{kind, x, z, yaw, sc}] (the world's own bushes and lamps in it), notice(text, s), sound(name, opts), random()}
    constructor(data, ctx = {}) {
      this.ctx = ctx;const tw = ctx.toWorld || ((x, s) => ({x, z: s})), hy = ctx.headingToYaw || (h => Math.atan2(-Math.sin(h), -Math.cos(h))), gr = ctx.ground || (() => 0);
      this.arenas = data.arenas.map((A, i) => {
        const ring = tw(A.ring[0], A.ring[1]), spawn = tw(A.spawn[0], A.spawn[1]);
        const things = A.props.map(([kind, x, s, h, sc]) => {const p = tw(x, s);return {kind, x: p.x, z: p.z, y: gr(p.x, p.z), yaw: hy(h), sc: sc || 1, real: true};}).filter(t => KINDS[t.kind]);
        const pts = A.zones.flat(), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cs = pts.reduce((a, p) => a + p[1], 0) / pts.length, c = tw(cx, cs);
        const reach = Math.max(...pts.map(p => Math.hypot(p[0] - cx, p[1] - cs)));
        return {i, id: A.id, name: A.name, where: A.where, zones: A.zones, ring: {x: ring.x, z: ring.z, y: gr(ring.x, ring.z)}, spawn: {x: spawn.x, z: spawn.z, yaw: hy(A.spawn[2] || 0)}, things, centre: c, reach, hunt: A.hunt || 210};
      });
      for (const A of this.arenas) for (const t of A.things) t.boxes = hitBox(t.kind, t.x, t.y, t.z, t.yaw, t.sc);
      this.realAdded = false;
      // State.
      this.ses = newSession();this.all = [];this.adminId = 0;this.lobbyT = 0;this.ringAt = -1;this.mySes = 0;this.myRound = 0;this.leftSes = 0;this.clock = 0;
      this.alive = true;this.hp = PH.HUNTER_HP;this.kind = -1;this.sc = 1;this.pyaw = 0;this.locked = true;this.changes = PH.CHANGES;this.foundBy = 0;this.w = 0;this.wT = 0;this.tn = 0;this.tauntCool = 0;
      this.seq = 0;this.outbox = [];this.coolT = 0;this.trigger = false;this.aimT = 0;this.recoilT = 0;this.startHold = 0;this.leaveHold = 0;this.emptyT = 0;
      this.seenShot = new Map();this.seenW = new Map();this.seenFound = {};this.feed = [];this.events = [];this.puffs = [];this.whistles = [];this.hitMark = 0;this.hurt = 0;this.look = null;
      this.bots = [];this.botClock = 0;this.lastSes = 0;this.spec = 0;this.seenState = '';this.result = null;this.matchDone = 0;
    }
    // ---- arenas ----
    local(x, z) {return this.ctx.toLocal ? this.ctx.toLocal(x, z) : {x, s: z};}
    arenaAt(x, z) {const l = this.local(x, z);return this.arenas.find(A => inZones(A.zones, l.x, l.s)) || null;}
    ringNear(x, z) {return this.arenas.find(A => Math.hypot(A.ring.x - x, A.ring.z - z) < PH.RING_R) || null;}
    get arena() {return this.arenas[this.ses.arena] || this.arenas[0];}
    addReal() {if (this.realAdded || !this.ctx.realThings) return;this.realAdded = true;for (const A of this.arenas) for (const t of this.ctx.realThings(A)) {const T = {...t, real: true, world: true};T.boxes = hitBox(T.kind, T.x, T.y, T.z, T.yaw, T.sc);A.things.push(T);}}
    // ---- state ----
    you() {return this.ctx.you ? this.ctx.you() : 0;}
    now() {return this.ctx.serverNow ? this.ctx.serverNow() : this.clock * 1000;}
    rand() {return this.ctx.random ? this.ctx.random() : Math.random();}
    sound(n, o) {if (this.ctx.sound) this.ctx.sound(n, o || {});}
    notice(t, s) {if (this.ctx.notice) this.ctx.notice(t, s);}
    phase() {return phaseOf(this.ses, this.now());}
    inGame() {return this.mySes !== 0 && this.ses.id === this.mySes && this.ses.state !== 'lobby';}
    role() {return this.inGame() ? this.ses.roles[this.you()] || '' : '';}
    hider() {return this.role() === 'p';}
    hunter() {return this.role() === 'h';}
    playing() {const p = this.phase();return this.inGame() && (p === 'hide' || p === 'hunt') && !!this.role();}
    spectating() {return this.inGame() && (!this.role() || !this.alive || this.phase() === 'end' || this.phase() === 'over');}
    frozen() {return this.playing() && this.hunter() && this.phase() === 'hide';}
    blind() {return this.frozen();}
    armed() {return this.playing() && this.hunter() && this.alive && this.phase() === 'hunt';}
    disguised() {return this.playing() && this.hider() && this.alive && this.kind >= 0;}
    busy() {return this.inGame() || this.ringAt >= 0;}
    isAdmin() {return this.adminId === this.you();}
    memberOf(id) {return this.all.find(m => m.id === id);}
    nameOf(id) {const m = this.memberOf(id);return m ? (m.local ? 'you' : m.name) : this.ses.names[id] || 'someone';}
    // Is this other player (or bot) a hider in the round now, or out of it (then nobody sees them)?
    disguiseOf(id) {
      if (!this.ses.id || this.ses.state === 'lobby') return null;const m = this.memberOf(id);if (!m || m.ses !== this.ses.id) return null;
      const r = this.ses.roles[id], p = this.phase();if (p !== 'hide' && p !== 'hunt') return null;
      if (!r) return {hidden: true};// a late joiner watching
      if (!m.alive && m.round === this.ses.round) return {hidden: true};
      if (r === 'p' && m.kind >= 0 && m.round === this.ses.round) return {kind: KIND_LIST[m.kind], yaw: m.pyaw, sc: m.sc || 1};
      return r === 'p' && m.round === this.ses.round ? {hiding: true} : null;
    }
    // Drawn as a thing (or not at all) instead of as a person; and kept off the map and the minimap.
    concealed(id) {const g = this.disguiseOf(id);return !!g && !!(g.kind || g.hidden);}
    offMap(id) {return !!this.disguiseOf(id);}
    holdsMarker(id) {const m = this.memberOf(id), p = this.phase();return !!m && !m.local && this.ses.roles[id] === 'h' && m.ses === this.ses.id && m.alive && (p === 'hide' || p === 'hunt');}
    addFeed(text) {this.feed.push({text, t: this.clock});if (this.feed.length > 5) this.feed.shift();}
    readMembers() {
      const c = this.ctx, f = c.feet ? c.feet() : {x: 0, y: 0, z: 0};
      this.all = [{id: this.you(), local: true, name: c.yourName ? c.yourName() : 'You', lobby: this.lobbyT, ses: this.inGame() ? this.mySes : 0, round: this.myRound, alive: this.alive, hp: this.hp, kind: this.kind, pyaw: this.pyaw, sc: this.sc,
        fb: this.foundBy, w: this.w, tn: this.tn, feet: f, yaw: c.yaw ? c.yaw() : 0, shots: [], sesJson: null}];
      for (const m of (c.others ? c.others() : [])) if (m && m.lobby > 0) this.all.push(m);
      // The game's players ride in the session (the admin moves them).
      const src = this.isAdminNow() ? this.bots.filter(b => b.active) : this.ses.bots;
      for (const b of src) this.all.push({id: b.id, bot: true, name: this.ses.names[b.id] || 'Bot', lobby: 1, ses: this.ses.id, round: this.ses.round, alive: b.alive, hp: b.hp, kind: b.kind, pyaw: b.pyaw, sc: b.sc || 1, fb: b.fb, w: b.w, tn: b.tn,
        feet: {x: b.x, y: b.y, z: b.z}, yaw: b.yaw, shots: b.shots || [], ref: b});
    }
    isAdminNow() {return this.adminId === this.you() && this.lobbyT > 0;}
    update(dt, input = {}) {
      this.clock += dt;this.events = [];this.hitMark = Math.max(0, this.hitMark - dt);this.hurt = Math.max(0, this.hurt - dt);this.addReal();
      this.outbox = this.outbox.filter(s => this.now() - s[1] <= 2000);
      this.readMembers();
      // The admin: the earliest member (then the lowest id). Its session is everybody's.
      const prev = this.adminId;this.adminId = 0;let best = 0;
      for (const m of this.all) if (!m.bot && m.lobby > 0 && (best === 0 || m.lobby < best || (m.lobby === best && m.id < this.adminId))) {best = m.lobby;this.adminId = m.id;}
      if (this.adminId !== this.you()) for (const m of this.all) if (m.id === this.adminId && m.sesJson) {const s = sesFromJson(m.sesJson);if (s) this.ses = s;}
      // Taking over as admin: the game's players are the old admin's, so they leave (their bodies were on its computer).
      if (prev && prev !== this.adminId && this.adminId === this.you() && this.ses.bots.length) {this.ses.bots = [];this.bots = [];}
      if (best > 0 && this.adminId === this.you()) this.runAdmin(dt, input);
      this.readMembers();
      this.shotsIn();this.whistlesIn();this.foundIn();
      this.localTick(dt, input);
      if (this.isAdminNow() && this.bots.length) this.botsTick(dt);
    }
    // ---- the admin ----
    members() {return this.all.filter(m => m.lobby > 0 && !m.bot).sort((a, b) => a.lobby - b.lobby || a.id - b.id);}
    runAdmin(dt, input) {
      const S = this.ses, t = this.now();
      if (S.state === 'lobby') {
        if (this.ringAt < 0) return;
        const alone = this.members().length === 1;
        if (input.left || input.right) {S.arena = (S.arena + (input.right ? 1 : this.arenas.length - 1)) % this.arenas.length;this.sound('beep', {gain: .4});}
        if (input.up || input.down) {const R = [3, 5, 8], k = R.indexOf(S.rounds);S.rounds = R[(Math.max(0, k) + (input.up ? 1 : R.length - 1)) % R.length];this.sound('beep', {gain: .4});}
        if (input.triangle && alone) {S.solo = S.solo === 'hunt' ? 'hide' : 'hunt';this.sound('beep', {gain: .4});}
        this.startHold = input.crossHeld ? this.startHold + dt : 0;
        if (this.startHold > 1) {this.startHold = 0;this.startMatch();}
        return;
      }
      const players = this.all.filter(m => S.roles[m.id] && (m.bot || m.ses === S.id));
      if (S.state === 'round') {
        // Nobody left in the match: back to the lobby.
        this.emptyT = players.some(m => !m.bot) ? 0 : this.emptyT + dt;
        if (this.emptyT > PH.EMPTY_S) {this.emptyT = 0;S.state = 'lobby';S.id = 0;return;}
        for (const m of players) if (S.roles[m.id] === 'p' && !m.alive && m.round === S.round && !(m.id in S.found)) S.found[m.id] = m.fb || 0;
        const cur = m => m.round === S.round || m.bot, hiders = players.filter(m => S.roles[m.id] === 'p'), hunters = players.filter(m => S.roles[m.id] === 'h');
        const hidersLeft = hiders.filter(m => !cur(m) || m.alive).length, huntersLeft = hunters.filter(m => !cur(m) || m.alive).length;
        let winner = '';
        if (t < hideEnd(S)) return;// everybody joins during the hiding time; nobody can be found before the hunt
        if (!hiders.length && !hunters.length) winner = 'p';
        else if (!hidersLeft) winner = 'h';
        else if (!huntersLeft) winner = 'p';
        else if (t >= huntEnd(S)) winner = 'p';
        if (winner) this.endRound(winner, hiders);
        return;
      }
      if (S.state === 'end' && t >= S.endT + PH.END_S * 1000) {if (S.round >= S.rounds) {S.state = 'over';S.endT = t;} else this.startRound();return;}
      if (S.state === 'over' && t >= S.endT + PH.OVER_S * 1000) {S.state = 'lobby';S.id = 0;S.bots = [];this.bots = [];}
    }
    startMatch() {
      const S = this.ses, L = this.members().slice(0, PH.MAX);
      S.id = Math.floor((this.now() / 1000) % 1e8) + 1;S.round = 0;S.score = {};S.hunts = {};S.last = {};S.names = {};S.bots = [];this.bots = [];
      for (const m of L) S.names[m.id] = m.local ? (this.ctx.yourName ? this.ctx.yourName() : 'You') : m.name;
      const A = this.arenas[S.arena] || this.arenas[0];S.hunt = A.hunt;
      if (L.length === 1) {
        // Alone: the game's own players. You hunt four hiders, or hide with three of them from a hunter.
        for (let i = 0; i < PH.BOTS; i++) {const id = -(i + 1);S.names[id] = BOT_NAMES[i];this.bots.push(this.newBot(id));}
      }
      this.startRound();
    }
    newBot(id) {return {id, role: 'p', x: 0, y: 0, z: 0, yaw: 0, kind: -1, pyaw: 0, sc: 1, hp: 100, alive: true, w: 0, wT: 0, fb: 0, tn: 0, out: [], shots: [], seq: 0, state: 'go', t: 0, target: null, moveT: 0, cool: 0, heard: null, look: 0, goal: null, path: 0, moved: -1e9};}
    startRound() {
      const S = this.ses, A = this.arenas[S.arena] || this.arenas[0], t = this.now();
      S.round++;S.state = 'round';S.t0 = t + 1500;S.hide = PH.HIDE_S;S.hunt = A.hunt;S.found = {};S.endT = 0;S.winner = '';S.roles = {};
      const real = this.members().slice(0, PH.MAX);
      for (const m of real) if (!(m.id in S.names)) S.names[m.id] = m.local ? (this.ctx.yourName ? this.ctx.yourName() : 'You') : m.name;
      if (this.bots.length) {
        // Alone: your role this round (you choose the first; then it changes every round), the rest are the game's players.
        const youHunt = (S.solo === 'hunt') === (S.round % 2 === 1), me = real[0];
        S.roles[me.id] = youHunt ? 'h' : 'p';
        const hb = youHunt ? null : this.bots[(S.round >> 1) % this.bots.length];
        for (const b of this.bots) {const keep = youHunt || b === hb || this.bots.filter(x => x !== hb).indexOf(b) < PH.BOTS - 1;b.active = keep;b.role = b === hb ? 'h' : 'p';}
        for (const b of this.bots) if (b.active) S.roles[b.id] = b.role;
        for (const id of Object.keys(S.roles)) if (S.roles[id] === 'h') {S.hunts[id] = (S.hunts[id] || 0) + 1;S.last[id] = S.round;}
        this.resetBots();
      } else {
        const ids = real.map(m => m.id), H = pickHunters(ids, S.hunts, S.last, hunterCount(ids.length), S.id);
        for (const id of ids) S.roles[id] = H.includes(id) ? 'h' : 'p';
        for (const id of H) {S.hunts[id] = (S.hunts[id] || 0) + 1;S.last[id] = S.round;}
      }
      for (const id of Object.keys(S.roles)) if (!(id in S.score)) S.score[id] = 0;
      S.bots = this.bots.filter(b => b.active);
    }
    endRound(winner, hiders) {
      const S = this.ses, t = this.now(), alive = {}, taunts = {};
      for (const m of hiders) {alive[m.id] = m.alive || (m.round !== S.round && !m.bot);taunts[m.id] = m.tn || 0;}
      const pts = roundPoints({roles: S.roles, found: S.found, alive, taunts, winner});
      for (const [id, v] of Object.entries(pts)) S.score[id] = (S.score[id] || 0) + v;
      S.state = 'end';S.endT = t;S.winner = winner;S.lastPts = pts;
    }
    // ---- shots, whistles, finds ----
    // The first thing a shot meets: a hider (id), a real thing, a wall, or nothing. skip: the shooter's id.
    firstHit(o, d, skip, A = this.arena) {
      let best = {t: PH.RANGE, what: 'none'};
      if (this.ctx.blockDist) {const w = this.ctx.blockDist(o, d, PH.RANGE);if (w < best.t) best = {t: w, what: 'world'};}
      for (const th of A.things) {if (Math.abs(th.x - o.x) > PH.RANGE + 3 || Math.abs(th.z - o.z) > PH.RANGE + 3) continue;const t = boxHit(o, d, th.boxes);if (t < best.t) best = {t, what: 'thing', thing: th};}
      for (const m of this.all) {
        if (m.id === skip) continue;const g = this.disguiseOf(m.id), mine = m.local && this.disguised();
        if (!(g && g.kind) && !mine) continue;
        const kind = mine ? KIND_LIST[this.kind] : g.kind, yaw = mine ? this.pyaw : g.yaw, sc = mine ? this.sc : g.sc;
        const t = boxHit(o, d, hitBox(kind, m.feet.x, m.feet.y, m.feet.z, yaw, sc));if (t < best.t) best = {t, what: 'hider', id: m.id};
      }
      best.p = {x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t};
      return best;
    }
    // Our shot: the hunter's own view decides what it hit (a real thing costs health); hiders decide hits on themselves.
    fire(o, d, shooter = null) {
      const id = shooter ? shooter.id : this.you(), h = this.firstHit(o, d, id), t = Math.round(this.now());
      const rec = [0, t, r3(o.x), r3(o.y), r3(o.z), r3(d.x), r3(d.y), r3(d.z)];
      if (shooter) {rec[0] = ++shooter.seq;shooter.out.push(rec);if (shooter.out.length > 12) shooter.out.shift();}
      else {rec[0] = ++this.seq;this.outbox.push(rec);this.coolT = 1 / PH.RATE;this.recoilT = .08;}
      this.puffs.push({p: h.p, what: h.what, from: o, kind: h.thing ? h.thing.kind : '', mine: !shooter});
      if (h.what === 'thing') {
        const hp = shooter ? shooter.hp : this.hp, left = Math.max(0, hp - PH.WRONG);
        if (shooter) shooter.hp = left;else {this.hp = left;this.hurt = .6;this.sound('phWrong');this.notice(`That was a real ${KINDS[h.thing.kind].name}. −${PH.WRONG} health.`, 2);}
        if (left <= 0) {if (shooter) shooter.alive = false;else this.outOfHealth();}
      } else if (h.what === 'hider') {
        if (shooter) shooter.hp = Math.min(PH.HUNTER_HP, shooter.hp + PH.HEAL);else {this.hp = Math.min(PH.HUNTER_HP, this.hp + PH.HEAL);this.hitMark = .35;this.sound('phHit');}
        if (h.id < 0 && this.isAdminNow() && h.id !== id) this.hurtBot(h.id, id);// the game's hiders live on this computer
      }
      if (!shooter) this.sound('pbShot', {gain: .6});
      return h;
    }
    outOfHealth() {this.alive = false;this.sound('phFound');this.notice('Out of health – too many wrong shots. You watch the rest of the round.', 4);this.events.push('hunterOut');}
    // Shots by the others (players and the game's players): does one hit us (or one of our bots)?
    shotsIn() {
      const S = this.ses;if (!S.id || S.state !== 'round') return;
      for (const m of this.all) {
        if (m.local) continue;const shots = m.bot && this.isAdminNow() ? [] : m.shots;let last = this.seenShot.get(m.id) ?? 0;
        for (const s of shots) {
          if (s[0] <= last) continue;last = s[0];if (this.now() - s[1] > 1500 || S.roles[m.id] !== 'h') continue;
          const o = {x: s[2], y: s[3], z: s[4]}, d = {x: s[5], y: s[6], z: s[7]};this.takeShot(m.id, o, d);
        }
        this.seenShot.set(m.id, last);
      }
    }
    takeShot(from, o, d) {
      const h = this.firstHit(o, d, from);
      if (!(from < 0 && this.isAdminNow())) this.puffs.push({p: h.p, what: h.what, from: o, kind: h.thing ? h.thing.kind : ''});
      if (h.what !== 'hider') return h;
      if (h.id === this.you() && this.disguised() && this.phase() === 'hunt') {
        this.hp -= PH.DAMAGE;this.hurt = .8;this.sound('phHurt');
        if (this.hp <= 0) {this.hp = 0;this.alive = false;this.foundBy = from;this.sound('phFound');this.events.push('found');this.notice(`Found! ${this.nameOf(from)} got you.`, 4);}
      } else if (h.id < 0 && this.isAdminNow()) this.hurtBot(h.id, from);
      return h;
    }
    hurtBot(id, from) {
      const b = this.bots.find(b => b.id === id);
      if (b && b.alive && b.role === 'p' && this.phase() === 'hunt') {b.hp -= PH.DAMAGE;b.hurtT = this.clock;if (b.hp <= 0) {b.hp = 0;b.alive = false;b.fb = from;}}
    }
    // Whistles: every other hider's whistle is heard from where it stands.
    whistlesIn() {
      for (const m of this.all) {
        const was = this.seenW.get(m.id);this.seenW.set(m.id, m.w);
        if (m.local || was === undefined || m.w <= was) continue;
        if (this.ses.roles[m.id] !== 'p' || this.phase() !== 'hunt' || m.ses !== this.ses.id) continue;
        this.whistles.push({x: m.feet.x, y: m.feet.y + .6, z: m.feet.z, t: this.clock, id: m.id});
        this.events.push({whistle: m.id, at: {x: m.feet.x, y: m.feet.y + .6, z: m.feet.z}, voluntary: m.tn > (this.seenTn?.get(m.id) || 0)});
        (this.seenTn || (this.seenTn = new Map())).set(m.id, m.tn);
      }
      this.whistles = this.whistles.filter(w => this.clock - w.t < 2.5);
    }
    foundIn() {
      const F = this.ses.found;
      for (const [v, f] of Object.entries(F)) if (!(v in this.seenFound) && (this.ses.state === 'round' || this.ses.state === 'end') && this.inGame()) {
        this.addFeed(`${this.nameOf(f) === 'you' ? 'You' : this.nameOf(f)} found ${this.nameOf(+v)}`);
        if (+f === this.you() && +v !== this.you()) {this.notice(`Found ${this.nameOf(+v)}!`, 2.5);this.events.push('youFound');}
      }
      this.seenFound = {...F};
    }
    whistle(voluntary) {
      this.w++;this.wT = this.now();if (voluntary) {this.tn++;this.tauntCool = PH.TAUNT_COOL_S;}
      this.events.push({whistle: this.you(), at: null, voluntary, mine: true});
    }
    // ---- you ----
    teleport(p, yaw) {if (this.ctx.teleport) this.ctx.teleport(p.x, p.z, yaw);}
    spawnPoint(A, k = 0) {
      if (!k) return A.spawn;const ang = k * 2.399, r = 1.2 + (k % 3) * .7;return {x: A.spawn.x + Math.sin(ang) * r, z: A.spawn.z + Math.cos(ang) * r, yaw: A.spawn.yaw};
    }
    newRound() {
      const A = this.arena, role = this.role(), ids = Object.keys(this.ses.roles).map(Number).sort((a, b) => a - b), k = Math.max(0, ids.indexOf(this.you()));
      this.myRound = this.ses.round;this.alive = true;this.kind = -1;this.sc = 1;this.locked = true;this.changes = PH.CHANGES;this.foundBy = 0;this.tn = 0;this.tauntCool = 0;this.wT = 0;this.seenFound = {...this.ses.found};
      this.hp = role === 'h' ? PH.HUNTER_HP : 100;this.coolT = 0;this.spec = 0;this.result = null;
      if (role) {const sp = this.spawnPoint(A, role === 'h' ? 0 : k + 1);this.teleport(sp, sp.yaw);}
      this.notice(role === 'h' ? 'You hunt this round. Wait while they hide – then find them. Shooting a real thing costs you health.'
        : role === 'p' ? 'You hide this round. Look at a thing and press □ to become it, then find a good place before the hunters come.' : 'A round is on – you play from the next one.', 6);
      this.sound('phStart');
    }
    toRing(inside) {const A = this.arena, a = this.rand() * Math.PI * 2, r = inside ? .3 + this.rand() * .9 : 2.6 + this.rand();this.teleport({x: A.ring.x + Math.sin(a) * r, z: A.ring.z + Math.cos(a) * r}, A.spawn.yaw);}
    localTick(dt, input) {
      const f = this.ctx.feet ? this.ctx.feet() : {x: 0, y: 0, z: 0}, ring = this.ringNear(f.x, f.z), S = this.ses, t = this.now(), p = phaseOf(S, t);
      this.ringAt = ring ? ring.i : -1;
      // Out of a finished match (or the round we were in is gone): back to normal, still in the group by the ring.
      if (this.mySes !== 0 && (S.id !== this.mySes || S.state === 'lobby')) {this.mySes = 0;this.kind = -1;this.alive = true;this.hp = PH.HUNTER_HP;this.toRing(true);this.backT = this.clock;this.lobbyT = Math.max(1, this.lobbyT);}
      if (this.lastF && Math.hypot(f.x - this.lastF.x, f.z - this.lastF.z) > .02) this.movedT = this.clock;this.lastF = {x: f.x, z: f.z};
      if (ring && this.lobbyT === 0) {this.lobbyT = Math.max(1, Math.round(t));this.notice(`Prop hunt – hide and seek at ${ring.name}. Wait here for the others; the first one here starts the game.`, 5);if (this.ses.state === 'lobby') this.ses.arena = ring.i;}
      if (!ring && !this.inGame() && this.lobbyT > 0 && this.clock - (this.backT || -9) > 1) this.lobbyT = 0;
      // Into a new match.
      if (S.id && S.state !== 'lobby' && S.state !== 'over' && this.lobbyT > 0 && this.mySes !== S.id && this.leftSes !== S.id && (S.roles[this.you()] || this.ringAt >= 0)) {
        this.mySes = S.id;this.myRound = -1;this.seenState = '';this.result = null;
      }
      if (!this.inGame()) {this.aimT = 0;return;}
      if (S.round !== this.myRound && S.state === 'round') this.newRound();
      if (this.seenState !== p) {
        if (p === 'hunt') {this.sound('phGo');if (this.hider() && this.kind < 0) this.autoProp(f);if (this.hunter()) this.notice('Go! Find them. Listen for the whistles.', 3);}
        if (p === 'end') {this.sound('phEnd');this.result = {round: S.round, winner: S.winner, pts: {...(S.lastPts || {})}};
          if (this.role()) this.events.push({round: true, role: this.role(), won: S.winner === this.role(), survived: this.hider() && this.alive, finds: Object.values(S.found).filter(f => f === this.you()).length, cleared: this.hunter() && S.winner === 'h'});}
        if (p === 'over') {this.sound('phEnd');this.matchOver();}
        this.seenState = p;
      }
      // Leave the match: hold △ for 2 s.
      this.leaveHold = input.triangleHeld ? this.leaveHold + dt : 0;
      if (this.leaveHold > PH.LEAVE_S) {this.leaveHold = 0;if (this.isAdmin() && this.members().length === 1) {S.state = 'lobby';S.id = 0;S.bots = [];this.bots = [];}/* alone: the match ends with you */this.leftSes = this.mySes;this.mySes = 0;this.kind = -1;this.alive = true;this.lobbyT = 0;this.toRing();this.notice('You left the prop hunt.', 3);return;}
      if (!this.playing()) {this.aimT = 0;this.specTick(input);return;}
      // Bounds: nobody leaves the arena during a round.
      {const A = this.arena, l = this.local(f.x, f.z), c = clampToZones(A.zones, l.x, l.s);if (c && this.ctx.setPos) {const w = this.ctx.toWorld ? this.ctx.toWorld(c.x, c.s) : {x: c.x, z: c.s};this.ctx.setPos(w.x, w.z);if (this.clock - (this.edgeT || -9) > 3) {this.edgeT = this.clock;this.notice('That is the edge of the arena.', 2);}}}
      if (!this.alive) {this.specTick(input);return;}
      if (this.hider()) this.hiderTick(dt, input, f, p);else if (this.hunter()) this.hunterTick(dt, input, p);
    }
    // The thing in the middle of the view (within 14 m of the camera), for □.
    lookTarget() {
      const o = this.ctx.cameraPos ? this.ctx.cameraPos() : null, d = this.ctx.cameraFwd ? this.ctx.cameraFwd() : null;if (!o || !d) return null;
      const f = this.ctx.feet ? this.ctx.feet() : o;let best = null, bt = 14;
      for (const th of this.arena.things) {if (Math.hypot(th.x - f.x, th.z - f.z) > 12) continue;const t = boxHit(o, d, th.boxes);if (t < bt) {bt = t;best = th;}}
      return best;
    }
    become(th) {
      const k = kindIndex(th.kind);if (k < 0) return false;
      const hunting = this.phase() === 'hunt';if (hunting && this.changes <= 0) {this.notice('No more changes this round.', 2);return false;}
      if (hunting) this.changes--;
      this.kind = k;this.sc = th.sc || 1;this.pyaw = th.yaw;this.locked = true;this.hp = Math.min(this.hp, hpOf(th.kind));if (!hunting) this.hp = hpOf(th.kind);
      this.sound('phPoof');this.events.push({become: th.kind});
      this.notice(`You are a ${KINDS[th.kind].name} (${CLASS[KINDS[th.kind].cls].hp} health). R1 / X turns with the view, D-pad ←/→ turns it.${hunting ? ` ${this.changes} change${this.changes === 1 ? '' : 's'} left.` : ''}`, 4);
      return true;
    }
    autoProp(f) {
      const near = this.arena.things.slice().sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
      if (near) {const c = this.changes;this.become(near);this.changes = c;this.notice(`Time's up – you were turned into a ${KINDS[near.kind].name}. Hide!`, 4);}
    }
    hiderTick(dt, input, f, p) {
      this.tauntCool = Math.max(0, this.tauntCool - dt);
      this.look = this.lookTarget();
      if (input.square && this.look) this.become(this.look);
      if (this.kind >= 0) {
        if (input.r1) {this.locked = !this.locked;this.notice(this.locked ? 'Locked: the prop keeps its heading while you look round.' : 'Free: the prop turns with the view.', 2);}
        const turn = (input.leftHeld ? 1 : 0) - (input.rightHeld ? 1 : 0);
        if (!this.locked) this.pyaw = (this.ctx.yaw ? this.ctx.yaw() : 0) + (this.yawOff || 0);
        if (turn) {if (this.locked) this.pyaw = wrap(this.pyaw + turn * dt * 1.2);else this.yawOff = wrap((this.yawOff || 0) + turn * dt * 1.2);}
      }
      if (input.triangle && p === 'hunt') {if (this.tauntCool > 0) this.notice(`Taunt again in ${Math.ceil(this.tauntCool)} s.`, 1.5);else this.whistle(true);}
      if (tauntDue(this.wT, this.ses, this.now())) this.whistle(false);
    }
    hunterTick(dt, input, p) {
      this.coolT -= dt;this.recoilT = Math.max(0, this.recoilT - dt);
      const can = p === 'hunt' && this.alive;
      this.aimT += ((input.l2 > .3 && can ? 1 : 0) - this.aimT) * Math.min(1, dt * 10);
      if (input.r2 > .55 && !this.trigger) {
        this.trigger = true;
        if (can && this.coolT <= 0) {const o = this.ctx.cameraPos ? this.ctx.cameraPos() : {x: 0, y: 1.6, z: 0}, d = this.ctx.cameraFwd ? this.ctx.cameraFwd() : {x: 0, y: 0, z: -1};this.fire(o, d);}
      } else if ((input.r2 || 0) < .35) this.trigger = false;
    }
    // Watching: the players still in the round, ← / → to switch.
    watchList() {return this.all.filter(m => !m.local && this.ses.roles[m.id] && (m.alive || m.round !== this.ses.round) && (m.bot || m.ses === this.ses.id));}
    specTick(input) {
      const L = this.watchList();if (!L.length) {this.spec = 0;return;}
      let k = L.findIndex(m => m.id === this.spec);if (k < 0) k = 0;
      if (input.left) k = (k + L.length - 1) % L.length;if (input.right) k = (k + 1) % L.length;
      this.spec = L[k].id;
    }
    watching() {return this.spectating() && this.inGame() && (this.phase() === 'hide' || this.phase() === 'hunt') ? this.memberOf(this.spec) || null : null;}
    matchOver() {
      const S = this.ses, me = this.you(), rows = this.scoreRows(), top = rows.length ? rows[0].pts : 0;
      this.matchDone = S.id;
      this.events.push({over: true, won: rows.length > 1 && (S.score[me] || 0) === top && rows.filter(r => r.pts === top).length === 1, pts: S.score[me] || 0, rounds: S.round, bots: S.bots.length > 0});
    }
    scoreRows() {const S = this.ses;return Object.entries(S.score).map(([id, pts]) => ({id: +id, name: S.names[id] || '?', pts, hunts: S.hunts[id] || 0, me: +id === this.you(), bot: +id < 0})).sort((a, b) => b.pts - a.pts || a.id - b.id);}
    // Hiders left in the round (players and bots).
    hidersLeft() {const S = this.ses;return Object.entries(S.roles).filter(([id, r]) => {if (r !== 'p') return false;const m = this.memberOf(+id);return m && (m.alive || m.round !== S.round);}).length;}
    hidersTotal() {return Object.values(this.ses.roles).filter(r => r === 'p').length;}
    // Warmer / colder in the last 30 s: how near the nearest hider still in is.
    hint() {
      if (!this.armed() || timeLeft(this.ses, this.now()) > PH.LATE_S) return '';const f = this.ctx.feet ? this.ctx.feet() : {x: 0, z: 0};let d = Infinity;
      for (const m of this.all) if (!m.local && this.ses.roles[m.id] === 'p' && m.alive) d = Math.min(d, Math.hypot(m.feet.x - f.x, m.feet.z - f.z));
      return isFinite(d) ? hotness(d) : '';
    }
    // 'ph' for our next 'st'; null when we are not in the group.
    localState() {
      if (this.lobbyT <= 0 && !this.inGame()) {this.outbox = [];return null;}
      const o = {l: Math.round(this.lobbyT), s: this.inGame() ? this.mySes : 0, r: this.myRound, a: this.alive ? 1 : 0, hp: Math.round(this.hp), k: this.kind, y: r3(this.pyaw), f: this.foundBy, w: this.w, t: this.tn};
      if (this.sc !== 1) o.c = r3(this.sc);
      // Recent shots go out in every message (a state that is replaced before it is read loses nothing); others skip by number.
      {const t = this.now(), h = this.outbox.filter(x => t - x[1] < 1200);if (h.length) o.h = h;}
      if (this.isAdmin()) o.ses = sesToJson(this.ses);
      return o;
    }
    // ---- the game's players (alone; the admin's computer moves them) ----
    resetBots() {
      const A = this.arena, kinds = [...new Set(A.things.filter(t => !t.world).map(t => t.kind))], taken = [];
      this.bots.forEach((b, i) => {
        const sp = this.spawnPoint(A, i + 2);Object.assign(b, {x: sp.x, z: sp.z, y: this.ctx.ground ? this.ctx.ground(sp.x, sp.z) : 0, yaw: sp.yaw, alive: true, fb: 0, tn: 0, w: 0, wT: 0, out: [], shots: [], kind: -1, sc: 1, state: b.role === 'h' ? 'wait' : 'go', t: 0, heard: null, look: 0, moved: -1e9, cool: 1, goal: null});
        b.hp = b.role === 'h' ? PH.HUNTER_HP : 100;
        if (b.role === 'p') {
          // Pick a kind that stands here and a believable spot: in line with or beside a real one of the same kind.
          for (let k = 0; k < 8 && !b.goal; k++) {const kind = kinds[Math.floor(this.rand() * kinds.length)], s = botSpot(A.things, kind, taken, () => this.rand(), (x, z) => this.botClear(x, z));if (s) {b.goal = s;b.goalKind = kind;taken.push(s);}}
          if (b.goal) {b.kind = kindIndex(b.goalKind);b.pyaw = b.goal.yaw;b.sc = b.goal.near.sc || 1;b.hp = hpOf(b.goalKind);}
        }
      });
    }
    botClear(x, z) {const l = this.local(x, z);if (!inZones(this.arena.zones, l.x, l.s) || clampToZones(this.arena.zones, l.x, l.s) !== null) return false;return this.ctx.clear ? this.ctx.clear(x, z) : true;}
    botsTick(dt) {
      const S = this.ses, t = this.now(), p = phaseOf(S, t), A = this.arena;if (S.state !== 'round') {this.syncBots();return;}
      const me = this.all.find(m => m.local), meF = me.feet, camF = this.ctx.cameraFwd ? this.ctx.cameraFwd() : {x: 0, z: -1};
      for (const b of this.bots) {
        if (!b.active) continue;b.shots = [];
        if (b.role === 'p') {
          if (!b.alive) continue;
          // Hide: walk to the chosen spot during the hiding time.
          if (b.goal && b.state === 'go') {const dx = b.goal.x - b.x, dz = b.goal.z - b.z, d = Math.hypot(dx, dz), v = speedOf(KIND_LIST[b.kind] || 'crate') * dt;if (d <= v) {b.x = b.goal.x;b.z = b.goal.z;b.state = 'hid';b.pyaw = b.goal.yaw;} else {b.x += dx / d * v;b.z += dz / d * v;b.pyaw = Math.atan2(-dx, -dz);}b.y = this.ctx.ground ? this.ctx.ground(b.x, b.z) : 0;b.moved = this.clock;}
          if (p === 'hide' && b.state === 'go' && hideEnd(S) - t < 1500 && b.goal) {b.x = b.goal.x;b.z = b.goal.z;b.state = 'hid';b.pyaw = b.goal.yaw;b.y = this.ctx.ground ? this.ctx.ground(b.x, b.z) : 0;}
          if (p === 'hunt') {
            // Whistle on the timer (and now and then a cheeky taunt), and sometimes shuffle a little when you are not looking.
            if (tauntDue(b.wT, S, t)) {b.w++;b.wT = t;}
            else if (b.tn < 2 && this.rand() < dt / 90) {b.w++;b.wT = t;b.tn++;}
            const dx = b.x - meF.x, dz = b.z - meF.z, d = Math.hypot(dx, dz), seen = d < 30 && (dx * camF.x + dz * camF.z) / (d || 1) > .45;
            if (b.state === 'hid' && !seen && this.clock - b.moved > 15 && this.rand() < dt / 25) {const s = botSpot(A.things, KIND_LIST[b.kind], this.bots.filter(o => o !== b && o.alive), () => this.rand(), (x, z) => this.botClear(x, z) && Math.hypot(x - b.x, z - b.z) < 7);if (s) {b.goal = s;b.state = 'go';}}
            if (b.state === 'go' && seen && b.goal && Math.hypot(b.goal.x - b.x, b.goal.z - b.z) > .2) {b.state = 'hid';b.goal = null;}// freeze when looked at
          }
        } else this.botHunt(b, dt, p);
      }
      this.syncBots();
    }
    syncBots() {this.ses.bots = this.bots.filter(b => b.active).map(b => ({...b}));}
    // The game's hunter: wanders the arena, runs to a whistle and looks round there, shoots what looks out of place, moved
    // or is near where it heard the whistle, and keeps shooting a thing that turned out to be a player.
    botHunt(b, dt, p) {
      if (p !== 'hunt' || !b.alive) return;const A = this.arena, S = this.ses;b.cool -= dt;
      const hear = (x, z) => {b.lead = {x: x + (this.rand() - .5) * 5, z: z + (this.rand() - .5) * 5, t: this.clock};b.target = {x: b.lead.x, z: b.lead.z};b.mode = 'run';};
      for (const e of this.whistles) if (e.id !== b.id && e.t > (b.heardT || -1)) {b.heardT = e.t;hear(e.x, e.z);}
      if (this.events.some(e => e && e.whistle === this.you() && e.mine)) {const f = this.ctx.feet();b.heardT = this.clock;hear(f.x, f.z);}
      if (S.round !== b.realRound) {b.real = new Set();b.realRound = S.round;b.lock = null;b.lead = null;b.mode = 'roam';}
      if (b.mode === 'look') {b.yaw += dt * 1.3;if ((b.lookT -= dt) <= 0) {b.mode = 'roam';b.lead = null;b.target = null;}}
      else {
        if (!b.target) {const th = A.things[Math.floor(this.rand() * A.things.length)];b.target = th ? {x: th.x + (this.rand() - .5) * 4, z: th.z + (this.rand() - .5) * 4} : {x: A.centre.x, z: A.centre.z};}
        const dx = b.target.x - b.x, dz = b.target.z - b.z, d = Math.hypot(dx, dz), v = (b.mode === 'run' ? 4 : 2.3) * dt;
        if (d < 1.5) {b.mode = 'look';b.lookT = b.lead ? 6 : 2;b.target = null;}
        else {const nx = b.x + dx / d * Math.min(v, d), nz = b.z + dz / d * Math.min(v, d);if (this.botClear(nx, nz)) {b.x = nx;b.z = nz;} else {b.target = null;b.mode = 'roam';}b.yaw = Math.atan2(-dx, -dz);b.y = this.ctx.ground ? this.ctx.ground(b.x, b.z) : 0;}
      }
      if (b.cool > 0) return;
      // Look round for something to shoot: things and hiders within 9 m in front.
      const eye = {x: b.x, y: b.y + 1.6, z: b.z}, opts = [], lead = b.lead && this.clock - b.lead.t < 25 ? b.lead : null;
      const consider = (x, y, z, kind, sc, moved, id) => {
        const ex = x - b.x, ez = z - b.z, dd = Math.hypot(ex, ez);if (dd > 9 || dd < .8 || (-Math.sin(b.yaw) * ex - Math.cos(b.yaw) * ez) / dd < .25) return;
        const same = A.things.some(t => t.kind === kind && Math.hypot(t.x - x, t.z - z) > .5 && Math.hypot(t.x - x, t.z - z) < 6);
        const near = lead && Math.hypot(lead.x - x, lead.z - z) < 5.5, locked = b.lock && b.lock.id === id && id && this.clock < b.lock.until;
        opts.push({x, y: y + KINDS[kind].h * sc * (kind === 'tree' ? .7 : .5), z, s: locked ? 2 : .1 + (moved ? .45 : 0) + (near ? .45 : 0) + (same ? 0 : .1), id});
      };
      for (const th of A.things) if (!b.real || !b.real.has(th)) consider(th.x, th.y, th.z, th.kind, th.sc, false, 0);
      for (const m of this.all) {if (m.id === b.id || S.roles[m.id] !== 'p' || !m.alive || m.kind < 0) continue;const mv = m.local ? (this.movedT || 0) : m.ref ? m.ref.moved : 0;consider(m.feet.x, m.feet.y, m.feet.z, KIND_LIST[m.kind], m.sc || 1, this.clock - mv < 3, m.id);}
      if (!opts.length) {b.cool = .5;return;}
      let o = null, os = -1;for (const c of opts) {const v = c.s + this.rand() * .3;if (v > os) {os = v;o = c;}}b.cool = o.s >= 2 ? .4 : .6 + this.rand() * .6;
      if (this.rand() > Math.max(.015, o.s - .3) * .8) return;
      const ax = o.x - eye.x, ay = o.y - eye.y, az = o.z - eye.z, L = Math.hypot(ax, ay, az), sp = .03;
      const dir = {x: ax / L + (this.rand() - .5) * sp, y: ay / L + (this.rand() - .5) * sp, z: az / L + (this.rand() - .5) * sp}, dl = Math.hypot(dir.x, dir.y, dir.z);
      dir.x /= dl;dir.y /= dl;dir.z /= dl;b.yaw = Math.atan2(-ax, -az);
      const h = this.fire(eye, dir, b);
      if (h.what === 'hider') b.lock = {id: h.id, until: this.clock + 5};// that was one of them: again
      if (h.what === 'thing') (b.real || (b.real = new Set())).add(h.thing);// the puff showed it was a real one
      // Its shot at you is decided by you, like any hunter's.
      if (h.what === 'hider' && h.id === this.you()) this.takeShot(b.id, eye, dir);
    }
  }

  // ---------- In the game: the things, the arenas' bounds, the rings, hiders' disguises, shots, the HUD ----------
  const CSS = `
#phHud{position:absolute;inset:0;pointer-events:none;font:14px/1.3 'Segoe UI',Arial,sans-serif;color:#fff;z-index:6}
#phHud .ph-top{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:16px;align-items:center;background:rgba(14,18,24,.72);border-radius:10px;padding:6px 14px;text-shadow:0 1px 2px #000}
#phHud .ph-top big{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}#phHud .ph-top b{font-size:15px}#phHud .ph-top small{opacity:.8}
#phHud .ph-role{font-weight:800;letter-spacing:.06em}#phHud .ph-role.h{color:#ff7b54}#phHud .ph-role.p{color:#7ee0a1}
#phHud .ph-black{position:absolute;inset:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none}
#phHud .ph-black big{font-size:96px;font-weight:800}#phHud .ph-black span{font-size:20px;opacity:.85}
#phHud .ph-me{position:absolute;left:calc(18px + var(--mm,0px));bottom:18px;background:rgba(14,18,24,.72);border-radius:10px;padding:8px 12px;min-width:220px}
#phHud .ph-bar{height:9px;background:#333;border-radius:5px;overflow:hidden;margin:4px 0}#phHud .ph-bar u{display:block;height:100%;background:#7ee0a1}#phHud .ph-bar.h u{background:#ff7b54}
#phHud .ph-keys{font-size:12px;opacity:.85}#phHud .ph-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid rgba(255,255,255,.85);border-radius:50%}
#phHud .ph-cross.hit{border-color:#ffb02e;transform:scale(1.5)}#phHud .ph-dot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;background:#fff;border-radius:50%;box-shadow:0 0 3px #000}
#phHud .ph-look{position:absolute;left:50%;top:calc(50% + 26px);transform:translateX(-50%);background:rgba(14,18,24,.75);padding:3px 10px;border-radius:8px}
#phHud .ph-lobby{position:absolute;right:18px;top:80px;width:300px;background:rgba(14,18,24,.82);border-radius:12px;padding:12px 14px}
#phHud .ph-lobby ul,#phHud .ph-board ul{list-style:none;margin:6px 0;padding:0}#phHud .ph-lobby li,#phHud .ph-board li{display:flex;justify-content:space-between;padding:2px 0}#phHud li.me{color:#ffd54a}
#phHud .meter{display:block;height:6px;background:#333;border-radius:3px;margin-top:6px}#phHud .meter u{display:block;height:100%;background:#7ee0a1;border-radius:3px}
#phHud .ph-board em{font-style:normal;font-weight:400;color:#7ee0a1;margin-right:14px}
#phHud .ph-board{position:absolute;left:50%;top:41%;max-height:56%;overflow:hidden;transform:translateX(-50%);min-width:380px;z-index:2;background:rgba(14,18,24,.88);border-radius:14px;padding:16px 20px;text-align:center}
#phHud .ph-board h2{margin:0 0 4px;font-size:28px}#phHud .ph-board li span:last-child{font-variant-numeric:tabular-nums;font-weight:700}#phHud .ph-board small{opacity:.8}
#phHud .ph-feed{position:absolute;right:18px;top:66px;text-align:right}#phHud .ph-feed div{background:rgba(14,18,24,.7);margin-bottom:4px;padding:3px 9px;border-radius:7px}
#phHud .ph-hint{position:absolute;left:50%;top:76px;transform:translateX(-50%);font-weight:800;font-size:20px;padding:3px 14px;border-radius:9px;text-shadow:0 1px 2px #000}
#phHud .ph-hint.hot{background:rgba(220,40,20,.75)}#phHud .ph-hint.warm{background:rgba(230,120,30,.7)}#phHud .ph-hint.cool{background:rgba(60,120,200,.6)}#phHud .ph-hint.cold{background:rgba(40,70,140,.6)}
#phHud .ph-note{position:absolute;font-size:30px;color:#ffe680;text-shadow:0 0 6px #000;transform:translate(-50%,-50%)}
#phHud .ph-hurt{position:absolute;inset:0;box-shadow:inset 0 0 120px rgba(255,40,20,.8)}#phHud .ph-spec{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);background:rgba(14,18,24,.75);padding:5px 14px;border-radius:9px}
`;
  function create({T, scene, overlay, lib, kit, rules, view, ground, marker, audio}) {
    if (typeof document !== 'undefined' && !document.getElementById('phCss')) {const s = document.createElement('style');s.id = 'phCss';s.textContent = CSS;document.head.append(s);}
    const group = new T.Group();group.name = 'Prop hunt';scene.add(group);
    // ---- Models: one vertex-coloured geometry per kind (one shared material); bushes, small trees and lamps use the world's own ----
    const vcMat = new T.MeshStandardMaterial({vertexColors: true, roughness: .78, metalness: .04});
    const C = new T.Color(), M4 = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), V = new T.Vector3(), S3 = new T.Vector3();
    function build(parts) {
      const pos = [], nor = [], col = [];
      for (const [geo, color, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] of parts) {
        const g = geo.index ? geo.toNonIndexed() : geo;M4.compose(V.set(px, py, pz), Q.setFromEuler(E.set(rx, ry, rz)), S3.set(sx, sy, sz));g.applyMatrix4(M4);
        C.setHex(color);const P = g.attributes.position, N = g.attributes.normal;
        for (let i = 0; i < P.count; i++) {pos.push(P.getX(i), P.getY(i), P.getZ(i));nor.push(N.getX(i), N.getY(i), N.getZ(i));col.push(C.r, C.g, C.b);}
      }
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));g.setAttribute('color', new T.Float32BufferAttribute(col, 3));g.computeBoundingSphere();return g;
    }
    const box = (w, h, d) => new T.BoxGeometry(w, h, d), cyl = (a, b, h, n = 12) => new T.CylinderGeometry(a, b, h, n), tor = (r, t) => new T.TorusGeometry(r, t, 6, 20);
    const H = Math.PI / 2;
    function wheel(parts, z, r, color, x = 0) {parts.push([tor(r, .028), 0x1b1b1b, x, r, z, 0, H, 0], [cyl(.012, .012, r * 2 - .05, 4), 0x9aa0a6, x, r, z, 0, 0, 0], [cyl(.012, .012, r * 2 - .05, 4), 0x9aa0a6, x, r, z, H, 0, 0], [cyl(.03, .03, .1, 8), color, x, r, z, 0, 0, H]);}
    const MODELS = {
      bench() {const p = [], wood = 0x8a5a32, iron = 0x24302a;for (const z of [-.2, -.06, .08]) p.push([box(1.7, .045, .12), wood, 0, .45, z]);for (const y of [.62, .76]) p.push([box(1.7, .1, .035), wood, 0, y, .25 - (y - .62) * .25, -.18]);
        for (const x of [-.72, .72]) {p.push([box(.06, .45, .56), iron, x, .225, 0], [box(.06, .44, .05), iron, x, .66, .24, -.18], [box(.07, .05, .5), iron, x, .64, -.02]);}return p;},
      bin() {return [[cyl(.25, .23, .86, 14), 0x2f5e3a, 0, .43, 0], [cyl(.275, .275, .1, 14), 0x1c2a22, 0, .91, 0], [cyl(.18, .18, .02, 12), 0x0b0f0c, 0, .965, 0], [box(.3, .1, .04), 0xd8d8d0, 0, .62, -.245]];},
      crate() {const p = [], a = 0xb08250, b = 0x8f6438;p.push([box(.8, .7, .8), a, 0, .35, 0]);for (const y of [.12, .35, .58]) {p.push([box(.82, .05, .82), b, 0, y, 0]);}for (const x of [-.38, .38]) for (const z of [-.38, .38]) p.push([box(.07, .7, .07), b, x, .35, z]);return p;},
      cone() {return [[box(.38, .035, .38), 0x1d1d1d, 0, .018, 0], [cyl(.025, .16, .68, 14), 0xf26b1d, 0, .37, 0], [cyl(.09, .113, .11, 14), 0xf2f2f2, 0, .48, 0], [cyl(.055, .075, .07, 14), 0xf2f2f2, 0, .62, 0]];},
      bike() {const p = [], fr = 0x1f4e8c;wheel(p, -.53, .34, fr);wheel(p, .53, .34, fr);
        p.push([cyl(.017, .017, .62, 6), fr, 0, .56, .1, -1.05], [cyl(.017, .017, .6, 6), fr, 0, .62, -.2, H], [cyl(.017, .017, .52, 6), fr, 0, .48, -.38, .55], [cyl(.015, .015, .5, 6), fr, 0, .5, .34, -.95],
          [cyl(.015, .015, .5, 6), fr, 0, .37, .26, H + .2], [cyl(.016, .016, .42, 6), fr, 0, .72, -.47, .3], [box(.12, .05, .26), 0x111111, 0, .88, .2], [cyl(.014, .014, .56, 6), 0x222222, 0, .94, -.53, 0, 0, H],
          [box(.38, .03, .18), 0x2a2a2a, 0, .62, .6], [box(.1, .18, .03), 0x111111, 0, .5, -.06]);return p;},
      scooter() {const p = [], c = 0xe8584d;wheel(p, -.48, .11, 0x222222);wheel(p, .46, .11, 0x222222);
        p.push([box(.16, .07, .82), c, 0, .14, 0], [cyl(.022, .022, 1.04, 8), 0x2a2a2a, 0, .66, -.5, .12], [cyl(.016, .016, .5, 6), 0x2a2a2a, 0, 1.17, -.56, 0, 0, H], [box(.12, .06, .08), c, 0, 1.1, -.55], [box(.09, .24, .06), c, 0, .26, .46, -.3]);return p;},
      moped() {const p = [], c = 0xb71c1c;wheel(p, -.62, .26, 0x333333);wheel(p, .62, .26, 0x333333);
        p.push([box(.36, .36, .9), c, 0, .45, .18], [box(.32, .1, .62), 0x161616, 0, .7, .22], [box(.5, .5, .1), c, 0, .62, -.44, -.18], [box(.42, .28, .14), c, 0, .56, -.32], [cyl(.025, .025, .5, 6), 0x2a2a2a, 0, .85, -.55, .3],
          [cyl(.016, .016, .64, 6), 0x2a2a2a, 0, 1.08, -.6, 0, 0, H], [box(.16, .12, .1), 0xe0e0d8, 0, .98, -.66], [box(.3, .08, .6), 0x2a2a2a, 0, .28, .05], [box(.3, .22, .3), 0x161616, 0, .9, .62]);return p;},
      barrel() {return [[cyl(.29, .29, .92, 16), 0x1f5fa8, 0, .46, 0], [cyl(.3, .3, .05, 16), 0x174a85, 0, .3, 0], [cyl(.3, .3, .05, 16), 0x174a85, 0, .62, 0], [cyl(.26, .26, .02, 16), 0x174a85, 0, .925, 0]];},
      sign() {const p = [];for (const s of [-1, 1]) p.push([box(.6, .98, .03), 0x222222, 0, .47, s * .15, -s * .3], [box(.52, .7, .01), 0xf4f1e6, 0, .45, s * .175, -s * .3], [box(.5, .12, .012), 0xc62828, 0, .7, s * .184, -s * .3]);p.push([box(.62, .05, .06), 0x222222, 0, .93, 0]);return p;},
      logs() {const p = [], c = [0x6b4a2e, 0x7a5636, 0x5e4128];let k = 0;for (const [n, y] of [[3, .13], [2, .35], [1, .55]]) for (let i = 0; i < n; i++) p.push([cyl(.13, .13, 1.4, 10), c[k++ % 3], 0, y, (i - (n - 1) / 2) * .27, 0, 0, H]);return p;},
      picnic() {const p = [], w = 0x9b6b3d;p.push([box(1.8, .05, .72), w, 0, .74, 0]);for (const z of [-.6, .6]) p.push([box(1.8, .045, .26), w, 0, .45, z]);
        for (const x of [-.65, .65]) for (const s of [-1, 1]) p.push([box(.07, .86, .08), 0x7d552e, x, .38, s * .32, s * .62]);for (const x of [-.65, .65]) p.push([box(.07, .06, 1.45), 0x7d552e, x, .42, 0]);return p;},
      boulder() {const g = new T.IcosahedronGeometry(.55, 1), P = g.attributes.position;for (let i = 0; i < P.count; i++) {const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + .14 * Math.sin(x * 7.3 + z * 3.1) * Math.cos(y * 5.7);P.setXYZ(i, x * k, Math.max(-.08, y * k), z * k);}g.computeVertexNormals();
        return [[g, 0x8c8a84, 0, .14, 0, 0, .4, 0, 1.05, 1.05, .86]];},
      planter() {const g = new T.IcosahedronGeometry(.36, 1);g.computeVertexNormals();return [[box(.8, .6, .8), 0x9d9a92, 0, .3, 0], [box(.7, .04, .7), 0x4a3524, 0, .6, 0], [g, 0x3f6b2c, 0, .78, 0, 0, 0, 0, 1, .8, 1], [g, 0x4d7c34, .12, .86, .08, .5, .3, 0, .6, .6, .6]];},
      wheeliebin() {const p = [], c = 0x2e6b3b;p.push([box(1.2, 1.0, .74), c, 0, .62, 0], [box(1.26, .07, .8), 0x24502e, 0, 1.15, .02, -.05], [box(1.1, .04, .04), 0x1a1a1a, 0, 1.0, .4]);for (const x of [-.48, .48]) for (const z of [-.26, .26]) p.push([cyl(.08, .08, .05, 10), 0x111111, x, .08, z, H]);p.push([box(.5, .16, .02), 0xf0f0e8, 0, .75, -.375]);return p;}
    };
    const geos = {};for (const k of KIND_LIST) if (MODELS[k]) geos[k] = build(MODELS[k]());
    // The world's own leafy things and lamps (surroundings.js propKit): the same geometry and material, so they look the same.
    const lampGeo = (() => {const a = new T.CylinderGeometry(.05, .07, 5, 8).toNonIndexed(), b = new T.CylinderGeometry(.25, .12, .25, 10).toNonIndexed();a.translate(0, 2.5, 0);b.translate(0, 5, 0);
      const g = new T.BufferGeometry();for (const att of ['position', 'normal', 'uv']) {const A1 = a.attributes[att], B1 = b.attributes[att], arr = new Float32Array(A1.array.length + B1.array.length);arr.set(A1.array);arr.set(B1.array, A1.array.length);g.setAttribute(att, new T.BufferAttribute(arr, A1.itemSize));}g.computeBoundingSphere();return g;})();
    const treeShape = sc => {const h = KINDS.tree.h * sc, crown = h * .62, trunkH = h * .42, r = h * .3;return {h, crown, trunkH, r};};
    // One thing as its own object (a hider's disguise).
    function disguise(kind, sc = 1) {
      const g = new T.Group();g.name = 'Disguise ' + kind;
      if (kind === 'bush') {const m = new T.Mesh(kit.bushGeo, kit.bushMat);m.scale.set(sc, sc * .8, sc);m.position.y = -.1;g.add(m);}
      else if (kind === 'tree') {const s = treeShape(sc), t = new T.Mesh(kit.trunkGeo, kit.barkMat), c = new T.Mesh(kit.crownGeo[0], kit.leafMats[0]);t.scale.set(1 + s.h / 25, s.trunkH, 1 + s.h / 25);c.scale.set(s.r * .95, s.crown * .5, s.r * .95);c.position.y = s.trunkH * .95;g.add(t, c);}
      else if (kind === 'lamp') g.add(new T.Mesh(lampGeo, kit.poleMat));
      else g.add(new T.Mesh(geos[kind], vcMat));
      g.traverse(o => {if (o.isMesh) {o.castShadow = true;o.receiveShadow = true;}});return g;
    }
    // ---- Per arena: the things (merged / instanced), the ring with its sign, the bounds (only during a round) ----
    const arenas = rules.arenas.map(A => {
      const g = new T.Group();g.name = 'Prop hunt ' + A.id;g.visible = false;group.add(g);return {A, g, built: false, tape: null, ring: null};
    });
    function buildArena(R) {
      const A = R.A, own = A.things.filter(t => !t.world);R.built = true;
      for (const t of own) t.y = ground(t.x, t.z);for (const t of own) t.boxes = hitBox(t.kind, t.x, t.y, t.z, t.yaw, t.sc);
      const pos = [], nor = [], col = [], tmp = new T.Matrix4();
      for (const t of own) if (geos[t.kind]) {
        const g0 = geos[t.kind], P = g0.attributes.position, N = g0.attributes.normal, Cc = g0.attributes.color;tmp.makeRotationY(t.yaw).setPosition(t.x, t.y, t.z);const nm = new T.Matrix3().getNormalMatrix(tmp);
        for (let i = 0; i < P.count; i++) {V.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(tmp);pos.push(V.x, V.y, V.z);V.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();nor.push(V.x, V.y, V.z);col.push(Cc.getX(i), Cc.getY(i), Cc.getZ(i));}
      }
      if (pos.length) {const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));geo.computeBoundingSphere();const m = new T.Mesh(geo, vcMat);m.castShadow = m.receiveShadow = true;m.name = 'Prop hunt things';R.g.add(m);}
      const lamps = own.filter(t => t.kind === 'lamp');
      if (lamps.length) {const im = new T.InstancedMesh(lampGeo, kit.poleMat, lamps.length);lamps.forEach((t, i) => {tmp.makeRotationY(t.yaw).setPosition(t.x, t.y, t.z);im.setMatrixAt(i, tmp);});im.castShadow = true;im.receiveShadow = true;R.g.add(im);}
      const bushes = own.filter(t => t.kind === 'bush');
      if (bushes.length) {const im = new T.InstancedMesh(kit.bushGeo, kit.bushMat, bushes.length);bushes.forEach((t, i) => {M4.compose(V.set(t.x, t.y - .1, t.z), Q.setFromAxisAngle(V3Y, t.yaw), S3.set(t.sc, t.sc * .8, t.sc));im.setMatrixAt(i, M4);});im.castShadow = im.receiveShadow = true;R.g.add(im);}
      const trees = own.filter(t => t.kind === 'tree');
      if (trees.length) {
        const tr = new T.InstancedMesh(kit.trunkGeo, kit.barkMat, trees.length), cr = new T.InstancedMesh(kit.crownGeo[0], kit.leafMats[0], trees.length);
        trees.forEach((t, i) => {const s = treeShape(t.sc);Q.setFromAxisAngle(V3Y, t.yaw);M4.compose(V.set(t.x, t.y, t.z), Q, S3.set(1 + s.h / 25, s.trunkH, 1 + s.h / 25));tr.setMatrixAt(i, M4);M4.compose(V.set(t.x, t.y + s.trunkH * .95, t.z), Q, S3.set(s.r * .95, s.crown * .5, s.r * .95));cr.setMatrixAt(i, M4);});
        tr.castShadow = cr.castShadow = true;tr.receiveShadow = cr.receiveShadow = true;R.g.add(tr, cr);
      }
      // The start ring and its sign.
      const rg = new T.Group();rg.position.set(A.ring.x, ground(A.ring.x, A.ring.z), A.ring.z);rg.rotation.y = A.spawn.yaw;R.g.add(rg);
      const ring = new T.Mesh(new T.TorusGeometry(PH.RING_R, .05, 8, 56), new T.MeshStandardMaterial({color: 0x7e57c2, emissive: 0x7e57c2, emissiveIntensity: .8}));ring.rotation.x = -H;ring.position.y = .04;rg.add(ring);
      const post = new T.Mesh(new T.CylinderGeometry(.04, .04, 1.3, 10), new T.MeshStandardMaterial({color: 0x5c6166, roughness: .5, metalness: .4}));post.position.set(0, .65, PH.RING_R + .38);// ends under the signpost.castShadow = true;rg.add(post);
      const c = document.createElement('canvas');c.width = 512;c.height = 320;const x = c.getContext('2d');x.fillStyle = '#3b2370';x.fillRect(0, 0, 512, 320);x.strokeStyle = '#fff';x.lineWidth = 10;x.strokeRect(10, 10, 492, 300);
      x.fillStyle = '#fff';x.textAlign = 'center';x.font = 'bold 66px Segoe UI, Arial, sans-serif';x.fillText('PROP HUNT', 256, 96);x.font = '600 34px Segoe UI, Arial, sans-serif';x.fillText('hide and seek', 256, 146);
      x.font = '600 30px Segoe UI, Arial, sans-serif';x.fillText(A.name.length > 26 ? A.name.slice(0, 26) : A.name, 256, 206);x.fillText('stand in the ring to join', 256, 262);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;const sign = new T.Mesh(new T.PlaneGeometry(.96, .6), new T.MeshStandardMaterial({map: tex, side: T.DoubleSide, roughness: .6}));sign.position.set(0, 1.62, PH.RING_R + .35);sign.rotation.y = Math.PI;sign.castShadow = true;rg.add(sign);
      R.ring = ring;
      // The bounds: posts every 3 m with a tape between them, shown while a round is on here.
      const tp = [], tn = [], tc = [], tape = (ax, az, bx, bz, y0, y1, color) => {C.setHex(color);const nx = -(bz - az), nz = bx - ax, nl = Math.hypot(nx, nz) || 1;
        for (const [px, py, pz] of [[ax, y0[0], az], [bx, y0[1], bz], [bx, y1[1], bz], [ax, y0[0], az], [bx, y1[1], bz], [ax, y1[0], az]]) {tp.push(px, py, pz);tn.push(nx / nl, 0, nz / nl);tc.push(C.r, C.g, C.b);}};
      const toW = (x, s) => rules.ctx.toWorld ? rules.ctx.toWorld(x, s) : {x, z: s};
      for (const z of A.zones) {
        if (A.zones.length > 1 && z !== A.zones[0]) continue;// the passage of a backyard is closed by the walls
        for (let i = 0; i < z.length; i++) {
          const a = toW(z[i][0], z[i][1]), b = toW(z[(i + 1) % z.length][0], z[(i + 1) % z.length][1]), L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(L / 3));
          for (let k = 0; k < n; k++) {
            const pa = {x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n}, pb = {x: a.x + (b.x - a.x) * (k + 1) / n, z: a.z + (b.z - a.z) * (k + 1) / n}, ya = ground(pa.x, pa.z), yb = ground(pb.x, pb.z);
            tape(pa.x, pa.z, pb.x, pb.z, [ya + .82, yb + .82], [ya + .92, yb + .92], k % 2 ? 0xf5d020 : 0x1a1a1a);
            tape(pa.x - .05, pa.z, pa.x + .05, pa.z, [ya, ya], [ya + 1.0, ya + 1.0], 0xe8e8e8);tape(pa.x, pa.z - .05, pa.x, pa.z + .05, [ya, ya], [ya + 1.0, ya + 1.0], 0xe8e8e8);
          }
        }
      }
      const tg = new T.BufferGeometry();tg.setAttribute('position', new T.Float32BufferAttribute(tp, 3));tg.setAttribute('normal', new T.Float32BufferAttribute(tn, 3));tg.setAttribute('color', new T.Float32BufferAttribute(tc, 3));tg.computeBoundingSphere();
      R.tape = new T.Mesh(tg, new T.MeshStandardMaterial({vertexColors: true, roughness: .7, side: T.DoubleSide, emissive: 0x222222}));R.tape.visible = false;R.g.add(R.tape);
    }
    const V3Y = new T.Vector3(0, 1, 0);
    // ---- Disguises of hiders (you, other players, the game's players) ----
    const worn = new Map();// id -> {kind, sc, obj}
    function wear(id, kind, sc, x, y, z, yaw) {
      let w = worn.get(id);
      if (!w || w.kind !== kind || w.sc !== sc) {if (w) group.remove(w.obj);w = {kind, sc, obj: disguise(kind, sc)};worn.set(id, w);group.add(w.obj);}
      w.obj.position.set(x, y, z);w.obj.rotation.y = yaw;w.obj.visible = true;w.seen = true;
    }
    // Bodies of the game's players that are not disguised (a hunter, a hider still walking to its spot).
    const avatars = window.GameAvatars ? window.GameAvatars.create({T, lib}) : null, botBodies = new Map();
    // ---- Shots: a short tracer and a puff where each one ended ----
    const MAXP = 48, puffGeo = new T.SphereGeometry(.09, 8, 6), puffMat = new T.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: .8, depthWrite: false});
    const puffs = new T.InstancedMesh(puffGeo, puffMat, MAXP);puffs.count = 0;puffs.frustumCulled = false;puffs.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);group.add(puffs);
    const live = [];
    const tracerGeo = new T.BufferGeometry();tracerGeo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(6 * 8), 3));const tracers = new T.LineSegments(tracerGeo, new T.LineBasicMaterial({color: 0xfff2b0, transparent: true, opacity: .7}));tracers.frustumCulled = false;group.add(tracers);
    let tracerList = [];
    // ---- HUD ----
    const el = document.createElement('div');el.id = 'phHud';el.innerHTML = '<div class="ph-hurt" hidden></div><div class="ph-black" hidden></div><div class="ph-top" hidden></div><div class="ph-hint" hidden></div><div class="ph-feed"></div><div class="ph-me" hidden></div><div class="ph-cross" hidden></div><div class="ph-dot" hidden></div><div class="ph-look" hidden></div><div class="ph-lobby" hidden></div><div class="ph-board" hidden></div><div class="ph-spec" hidden></div><div class="ph-notes"></div>';view.append(el);
    const $ = c => el.querySelector('.' + c), esc = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
    const clock = s => {s = Math.ceil(Math.max(0, s));return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;};
    let hudT = 0, notes = [];
    function setHtml(c, html) {const n = $(c);if (n._h !== html) {n._h = html;n.innerHTML = html;}}
    function hud(camera) {
      const R = rules, S = R.ses, t = R.now(), p = R.phase(), inGame = R.inGame(), A = R.arena, role = R.role();
      const top = $('ph-top');top.hidden = !(inGame && (p === 'hide' || p === 'hunt'));
      if (!top.hidden) setHtml('ph-top', `<span class="ph-role ${role}">${role === 'h' ? 'HUNTER' : role === 'p' ? 'HIDER' : 'WATCHING'}</span><span><big>${clock(timeLeft(S, t))}</big> <small>${p === 'hide' ? 'hiding time' : 'hunting time'}</small></span><span><b>${R.hidersLeft()} of ${R.hidersTotal()}</b> <small>hiders left</small></span><span><small>Round ${S.round} of ${S.rounds} · ${esc(A.name)}</small></span>`);
      const black = $('ph-black');black.hidden = !R.blind();
      if (!black.hidden) setHtml('ph-black', `<span>They are hiding …</span><big>${Math.ceil(timeLeft(S, t))}</big><span>${esc(A.name)} · round ${S.round} of ${S.rounds}</span><span style="font-size:15px;opacity:.7">Shoot with R2 / left mouse · a real thing costs you ${PH.WRONG} health · listen for the whistles</span>`);
      const me = $('ph-me');me.hidden = !(R.playing() && R.alive);
      if (!me.hidden) {
        const K = R.kind >= 0 ? KINDS[KIND_LIST[R.kind]] : null, max = role === 'h' ? PH.HUNTER_HP : K ? CLASS[K.cls].hp : 100;
        setHtml('ph-me', role === 'h' ? `<b>Health ${Math.round(R.hp)}</b><div class="ph-bar h"><u style="width:${Math.round(100 * R.hp / max)}%"></u></div><div class="ph-keys">R2 / left mouse shoot · L2 / right mouse aim · hold △ leave</div>`
          : `<b>${K ? `You are a ${K.name}` : 'Not hidden yet'}</b> · health ${Math.round(R.hp)}<div class="ph-bar"><u style="width:${Math.round(100 * R.hp / max)}%"></u></div>` +
          `<div class="ph-keys">${p === 'hunt' ? `${R.changes} change${R.changes === 1 ? '' : 's'} left · ` : 'change as often as you like while hiding · '}${K ? (R.locked ? 'locked' : 'turns with the view') : ''}</div>` +
          `<div class="ph-keys">□ / E become what you look at · R1 / X lock · D-pad ←/→ turn · △ / F taunt (+1) · hold △ leave</div>`);
      }
      $('ph-cross').hidden = !(R.armed() && R.aimT < .5);$('ph-cross').classList.toggle('hit', R.hitMark > 0);
      $('ph-dot').hidden = !(R.playing() && R.hider() && R.alive);
      const look = $('ph-look');look.hidden = !(R.playing() && R.hider() && R.alive && R.look);if (!look.hidden) setHtml('ph-look', `□ / E  become the ${KINDS[R.look.kind].name}`);
      const hint = R.hint(), hn = $('ph-hint');hn.hidden = !hint;if (hint) {hn.className = 'ph-hint ' + hint;hn.textContent = {hot: 'HOT', warm: 'Warmer', cool: 'Cool', cold: 'Cold'}[hint];}
      const hurt = $('ph-hurt');hurt.hidden = R.hurt <= 0;if (R.hurt > 0) hurt.style.opacity = Math.min(1, R.hurt * 1.5).toFixed(2);
      // The lobby.
      const lb = $('ph-lobby'), showLobby = R.ringAt >= 0 && !inGame;lb.hidden = !showLobby;
      if (showLobby) {
        const L = R.members(), alone = L.length === 1, Ar = R.arenas[S.arena] || A, on = S.state !== 'lobby' && S.id;
        setHtml('ph-lobby', `<b>PROP HUNT · HIDE AND SEEK</b><div>${esc(Ar.name)} · ${S.rounds} rounds</div><small>${on ? `A match is on at ${esc(Ar.name)} – you play from the next round` : alone ? (S.solo === 'hunt' ? 'Alone: you hunt first, 4 of the game\'s players hide (then you swap)' : 'Alone: you hide first with 3 of the game\'s players, one of them hunts (then you swap)') : `${hunterCount(L.length)} hunter${hunterCount(L.length) > 1 ? 's' : ''} a round, taking turns`}</small><ul>` +
          L.map(m => `<li class="${m.local ? 'me' : ''}"><span>${esc(m.local ? (rules.ctx.yourName ? rules.ctx.yourName() : 'You') : m.name)}${m.id === R.adminId ? '  (admin)' : ''}</span><i>${S.hunts[m.id] ? `hunted ${S.hunts[m.id]}×` : ''}</i></li>`).join('') +
          `</ul><small>${R.isAdmin() && !on ? `←→ arena · ↑↓ rounds${alone ? ` · △ ${S.solo === 'hunt' ? 'hide' : 'hunt'} first` : ''} · hold ✕ start` : on ? 'Wait here for the next round' : 'The admin starts the game'}</small>${R.startHold > 0 ? `<i class="meter"><u style="width:${Math.round(Math.min(1, R.startHold) * 100)}%"></u></i>` : ''}`);
      }
      // A round's result, the match's result.
      const bd = $('ph-board'), showBoard = inGame && (p === 'end' || p === 'over');bd.hidden = !showBoard;
      if (showBoard) {
        const rows = R.scoreRows(), last = S.lastPts || {}, mine = role || S.roles[R.you()];
        const head = p === 'over' ? (() => {const w = rows[0];return `<h2>${w ? (w.me ? 'You win the match!' : `${esc(w.name)} wins the match`) : 'Match over'}</h2><small>${S.round} rounds at ${esc(A.name)}</small>`;})()
          : `<h2>${S.winner === 'h' ? 'The hunters win' : 'The hiders win'}</h2><small>Round ${S.round} of ${S.rounds}${mine ? ` · you ${S.winner === mine ? 'won' : 'lost'} this one` : ''} · ${S.round < S.rounds ? 'next round soon' : 'final score next'}</small>`;
        setHtml('ph-board', head + '<ul>' + rows.map(r => `<li class="${r.me ? 'me' : ''}"><span>${esc(r.name)}${r.bot ? ' (game)' : ''}${p === 'end' && S.roles[r.id] ? ` · ${S.roles[r.id] === 'h' ? 'hunter' : S.found[r.id] !== undefined ? 'found' : 'survived'}` : ''}</span><span>${p === 'end' && last[r.id] ? `<em>+${last[r.id]}</em>` : ''}${r.pts}</span></li>`).join('') + '</ul><small>2 a find · 3 for surviving · 1 a taunt (3 at most) · 1 for the winning side</small>');
      }
      const sp = $('ph-spec'), w = R.watching();sp.hidden = !(inGame && (p === 'hide' || p === 'hunt') && (R.spectating()));
      if (!sp.hidden) setHtml('ph-spec', `${R.role() ? (R.hider() ? 'Found – ' : 'Out – ') : ''}watching ${w ? esc(w.bot ? R.ses.names[w.id] || 'a player' : w.name) : 'the arena'} · D-pad ←/→ switch · hold △ leave`);
      setHtml('ph-feed', R.feed.filter(f => R.clock - f.t < 6).map(f => `<div>${esc(f.text)}</div>`).join(''));
      // A note on the screen where a whistle came from (for hunters; the sound comes from there too).
      notes = notes.filter(n => R.clock - n.t < 1.6);
      const nh = notes.map(n => {const v = new T.Vector3(n.x, n.y, n.z).project(camera), behind = v.z > 1, k = behind ? -1 : 1;let x = v.x * k, y = v.y * k;const m = Math.max(Math.abs(x), Math.abs(y));if (behind || m > .9) {x = x / m * .9;y = y / m * .9;}
        return `<div class="ph-note" style="left:${(50 + x * 50).toFixed(1)}%;top:${(50 - y * 50).toFixed(1)}%;opacity:${(1 - (R.clock - n.t) / 1.6).toFixed(2)}">♪</div>`;}).join('');
      setHtml('ph-notes', nh);
    }
    function update(dt, input, {camera, remotes, player}) {
      rules.update(dt, input);
      const R = rules, S = R.ses, p = R.phase(), cam = camera.position;
      // Arenas: built and shown near the camera; the bounds while a round is on there.
      for (const a of arenas) {
        const d = Math.hypot(a.A.centre.x - cam.x, a.A.centre.z - cam.z), near = d < a.A.reach + 220;
        if (near && !a.built) buildArena(a);a.g.visible = near;
        if (a.tape) a.tape.visible = near && S.id && (S.state === 'round' || S.state === 'end') && S.arena === a.A.i;
        if (a.ring) a.ring.material.emissiveIntensity = .55 + .35 * Math.sin(R.clock * 3);
      }
      // Disguises.
      for (const w of worn.values()) w.seen = false;
      if (R.disguised() || (R.inGame() && R.hider() && R.alive && R.kind >= 0 && p === 'hide')) wear(R.you(), KIND_LIST[R.kind], R.sc, player.x, player.feet + (player.jumpY || 0), player.z, R.pyaw);
      for (const m of R.all) {
        if (m.local) continue;const g = R.disguiseOf(m.id);
        if (g && g.kind) wear(m.id, g.kind, g.sc, m.feet.x, m.feet.y, m.feet.z, g.yaw);
      }
      for (const [id, w] of worn) if (!w.seen) {group.remove(w.obj);worn.delete(id);}
      // The game's players' own bodies (the hunter, a hider still on its way).
      const botSeen = new Set();
      if (avatars) for (const m of R.all) {
        if (!m.bot) continue;const g = R.disguiseOf(m.id);if (g && (g.kind || g.hidden)) continue;if (!S.id || S.state === 'lobby' || S.state === 'over') continue;
        let b = botBodies.get(m.id);if (!b) {b = {av: avatars.avatar(Math.abs(m.id) + 3, R.ses.names[m.id] || 'Bot'), last: null};scene.add(b.av.group);botBodies.set(m.id, b);}
        const at = new T.Vector3(m.feet.x, m.feet.y, m.feet.z), spd = b.last ? at.distanceTo(b.last) / Math.max(dt, 1e-3) : 0;b.last = at.clone();
        b.av.group.visible = true;b.av.group.position.copy(at);b.av.group.rotation.set(0, m.yaw, 0);b.av.pose({stance: 'stand', speed: spd, dt, marker: S.roles[m.id] === 'h'});b.av.update(dt, camera, false);botSeen.add(m.id);
      }
      for (const [id, b] of botBodies) if (!botSeen.has(id)) b.av.group.visible = false;
      // Shots: puffs (white on a real thing, orange on a hider, grey dust elsewhere) and tracers.
      for (const pf of R.puffs) {
        live.push({p: pf.p, t: 0, c: pf.what === 'hider' ? 0xff8a20 : pf.what === 'thing' ? 0xf4f4f0 : 0x9a8f80, n: pf.what === 'none' ? 0 : 7});
        tracerList.push({a: pf.mine ? {x: pf.from.x, y: pf.from.y - .12, z: pf.from.z} : pf.from, b: pf.p, t: 0});
        if (!pf.mine && audio) {const d = Math.hypot(pf.from.x - cam.x, pf.from.z - cam.z);if (d < 60) audio.sfx('pbShot', {gain: Math.max(.05, .5 * (1 - d / 60))});}
      }
      R.puffs = [];
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {const L = live[i];L.t += dt;if (L.t > .55 || !L.n) {live.splice(i, 1);continue;}}
      for (const L of live) for (let k = 0; k < L.n && n < MAXP; k++) {
        const a = k * 2.4, r = .08 + L.t * .9, s = (1 - L.t / .55) * (.6 + .5 * (k % 3) / 2);
        M4.compose(V.set(L.p.x + Math.cos(a) * r, L.p.y + L.t * .5 + (k % 3) * .05, L.p.z + Math.sin(a) * r), Q.identity(), S3.set(s, s, s));puffs.setMatrixAt(n, M4);C.setHex(L.c);puffs.setColorAt(n, C);n++;
      }
      puffs.count = n;puffs.instanceMatrix.needsUpdate = true;if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true;
      tracerList = tracerList.filter(x => (x.t += dt) < .07).slice(-8);
      const tp = tracerGeo.attributes.position;tracerList.forEach((x, i) => {tp.setXYZ(i * 2, x.a.x, x.a.y, x.a.z);tp.setXYZ(i * 2 + 1, x.b.x, x.b.y, x.b.z);});tp.needsUpdate = true;tracerGeo.setDrawRange(0, tracerList.length * 2);
      // Sound: whistles from where the hider stands; hits and finds.
      for (const e of R.events) {
        if (!e || typeof e !== 'object') continue;
        if (e.whistle !== undefined && audio) {
          if (e.mine) audio.sfx(e.voluntary ? 'phTaunt' : 'phWhistle', {gain: .45});
          else if (e.at) {
            const dx = e.at.x - cam.x, dz = e.at.z - cam.z, d = Math.hypot(dx, dz), right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), pan = clamp((dx * right.x + dz * right.z) / (d || 1), -1, 1);
            audio.sfx(e.voluntary ? 'phTaunt' : 'phWhistle', {gain: clamp(1.2 / (1 + d / 12), .08, 1), pan: pan * .9});if (R.inGame()) notes.push({...e.at, t: R.clock});
          }
        }
      }
      // The marker in the hunter's hands.
      if (marker) {
        const armed = R.armed() && player.mode === 'foot';marker.visible = armed;
        if (armed) {const A2 = R.aimT, K = R.recoilT / .08;marker.position.set(.2 - .06 * A2, -.25 - .04 * A2, -.66 + .04 * A2 + .03 * K);marker.rotation.set(.035 * K, .07 * (1 - A2), 0);}
      }
      if ((hudT -= dt) <= 0) {hudT = .1;hud(camera);}
    }
    // The camera: behind your prop while you hide, behind the player you watch when you are out.
    const camTmp = new T.Vector3();
    function cameraFor(camera, player, groundY) {
      const R = rules;let at = null, dist = 0, yaw = player.yaw, pitch = player.pitch;
      if (R.inGame() && R.hider() && R.alive && R.kind >= 0 && R.playing()) {const K = KINDS[KIND_LIST[R.kind]];at = {x: player.x, y: player.feet + (player.jumpY || 0) + Math.min(2.2, K.h * R.sc * .7 + .5), z: player.z};dist = CLASS[K.cls].cam * Math.max(1, R.sc * .9);}
      else {const w = R.watching();if (w) {const g = R.disguiseOf(w.id), K = g && g.kind ? KINDS[g.kind] : null;at = {x: w.feet.x, y: w.feet.y + (K ? Math.min(2.2, K.h * .7 + .5) : 1.7), z: w.feet.z};dist = K ? CLASS[K.cls].cam : 3.2;}}
      if (!at) return false;
      pitch = clamp(pitch, -1.1, .9);
      const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
      // Not through a wall: the camera comes in to just in front of the first solid behind the prop (backyards are tight).
      if (R.ctx.blockDist) {const b = R.ctx.blockDist(at, {x: -fx, y: -fy, z: -fz}, dist + .4);if (b < dist + .4) dist = Math.max(.7, b - .4);}
      camTmp.set(at.x - fx * dist, at.y - fy * dist, at.z - fz * dist);
      const gy = groundY(camTmp.x, camTmp.z);if (camTmp.y < gy + .35) camTmp.y = gy + .35;
      camera.position.copy(camTmp);camera.rotation.set(pitch, yaw, 0, 'YXZ');
      return true;
    }
    // Solids for walkers: other hiders' disguises (you bump into a "bench" as into a bench).
    function solids() {
      const out = [];
      for (const m of rules.all) {
        if (m.local) continue;const g = rules.disguiseOf(m.id);if (!g || !g.kind) continue;const K = KINDS[g.kind], sc = g.sc || 1, w = (g.kind === 'tree' || g.kind === 'lamp' ? .35 : K.w * (g.kind === 'bush' ? .55 : 1)) * sc / 2, d = (g.kind === 'tree' || g.kind === 'lamp' ? .35 : K.d * (g.kind === 'bush' ? .55 : 1)) * sc / 2, Cy = Math.cos(g.yaw), Sy = Math.sin(g.yaw);
        out.push({points: [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a, b]) => ({x: m.feet.x + a * Cy + b * Sy, z: m.feet.z - a * Sy + b * Cy})), minY: m.feet.y - .2, maxY: m.feet.y + K.h * sc, kind: 'prop'});
      }
      return out;
    }
    const poi = () => rules.arenas.map(A => ({...(rules.ctx.toLocal ? rules.ctx.toLocal(A.ring.x, A.ring.z) : {x: A.ring.x, s: A.ring.z}), color: '#7e57c2', label: `Prop hunt · ${A.name}`, glyph: '🙈'}));
    const bodyRadius = () => {if (!rules.disguised() && !(rules.inGame() && rules.hider() && rules.kind >= 0)) return 0;const K = KINDS[KIND_LIST[rules.kind]];return K.kit === 'tree' || K.kit === 'lamp' ? .18 : clamp(Math.min(K.w, K.d) * rules.sc / 2, .18, .55);};
    return {rules, group, update, cameraFor, solids, poi, bodyRadius, disguise, geos, marker,
      get busy() {return rules.busy();}, get frozen() {return rules.frozen() || rules.spectating();}, get armed() {return rules.armed();}, get aim() {return rules.aimT;},
      get speed() {return rules.disguised() || (rules.inGame() && rules.hider() && rules.kind >= 0 && rules.alive) ? speedOf(KIND_LIST[rules.kind]) : 0;},
      get ownsSquare() {return rules.playing() && rules.hider();}, get thirdPerson() {return rules.inGame() && ((rules.hider() && rules.alive && rules.kind >= 0 && rules.playing()) || !!rules.watching());},
      get music() {return rules.inGame() && rules.phase() !== 'over';}};
  }
  return {Rules, create, obstacles, PH, POINTS, CLASS, KINDS, KIND_LIST, kindIndex, hpOf, speedOf, hunterCount, pickHunters, phaseOf, timeLeft, tauntDue, inZones, clampToZones, rayBox, hitBox, roundPoints, hotness, botSpot,
    sesToJson, sesFromJson, memberFromJson, newSession};
});
