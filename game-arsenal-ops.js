/* The missions you start at the board in Arsenalet (issue #179): the bank, the money transport and dealing, each as a robber
 * or as the police; the hostage rescue is the game's old mission (case-game.js), started from the same board.
 *
 * Alone or together. The one who starts a mission LEADS it: that computer runs the people in it (guards, police, robbers,
 * customers) and the transport, and sends them in its own lobby state (st.op, ten times a second). The others in the lobby JOIN
 * at the board: their computers only draw what the leader sends, and send back what they did (st.op too):
 *   leader -> all   {k key, m mission, ph phase, ob/sb texts, tm timer, bg bags, g goal, a people, v transport, bl road blocks,
 *                    x police attention, e events (shots, sounds, notices), dm damage to each player, r the result, d, w, rv}
 *   member -> all   {h the leader's id, k key, j this joining, hit damage to each person, vh damage to each vehicle, n shots
 *                    fired (noise), ac what they did at a prompt, d down, w weapon, rv the friend they helped up}
 * Damage and shots are running totals, so a lost message loses nothing. The people are GameAvatars figures that walk in the
 * walk world, see along clear lines (the walk world's solids) and shoot real shots with an aim error, at whoever of you they see.
 * A player who is shot is down: a friend helps them up (□), or they get up alone after half a minute; all down at once and the
 * mission is lost. Offline, or with nobody joined, it is the one-player mission it was.
 *
 * GameArsenalOps.create(api) -> {start(def), join(id), joinable(), stop(), update(dt, input, foot), prompt(), shot(o, d, w, seed),
 *   solids(), opState(), mate(id), cur, hp, down, sub, crew, gun()}
 * api: {T, W (GameWeapons), group, avatars, data (ARSENAL), ctx (filled in by game-main: player, camera, groundAt, blockDist,
 *   moveActor, clear, place, notice, earn, waypoint, startCase, you, serverNow, mates, stance), bank (the bank's room or null),
 *   home(), loadout(), speed(), tracer(from, dir, len, own), shotSound(w, dist), sfx(name, gain), vault(open), fire(gun)}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameArsenalOps = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MISSIONS = [
    {id: 'heist', side: 'robber', name: 'Bank robbery', where: 'Torshov Sparebank, Sandakerveien', pay: '1 500 kr a bag (3 bags)', text: 'Three armed guards watch the bank. Deal with them, drill the vault (30 seconds, the alarm brings the police), take the bags and get to the garage in Omsens gate. Leave the staff alone: each one hurt costs you 500 kr.'},
    {id: 'heist', side: 'police', name: 'Bank alarm', where: 'Torshov Sparebank, Sandakerveien', pay: '2 500 kr', text: 'Four masked robbers are drilling the vault and hold the staff. When you get there you have two and a half minutes before the vault is open and they are gone. Do not hit the hostages.'},
    {id: 'convoy', side: 'robber', name: 'Money transport', where: 'Haarklous plass → Sandakerveien', pay: '1 200 kr a bag (4 bags)', text: 'An escort car and two armoured trucks drive from Haarklous plass to the bank. Stop them before they get there: stand in their way or shoot a truck until it stops. The guards get out and fight. Blow the back doors, take the bags, get to the garage in Omsens gate.'},
    {id: 'convoy', side: 'police', name: 'Convoy escort', where: 'Kyrre Grepps gate and Hans Nielsen Hauges gate', pay: '3 000 kr', text: 'Robbers have blocked the money transport\'s road in two places. Clear both road blocks. If the transport gets to a block before you, it has to wait there under fire, and the trucks do not hold for ever.'},
    {id: 'deal', side: 'robber', name: 'Dealing', where: 'five street doors round Torshov', pay: '600 kr a customer, 500 kr more if the police never chase you', text: 'Five customers wait at street doors. Hand over the goods (□, stand still for three seconds) when no police officer can see you. Patrols walk the streets: seen dealing, or hanging about near them, and they come running. Out of sight for a while and they give up. If one gets hold of you, you are caught.'},
    {id: 'deal', side: 'police', name: 'Narcotics patrol', where: 'the streets round Torshov', pay: '2 000 kr', text: 'Three dealers walk between their customers. Find them and arrest them (□ when you are right beside one). They run when they see you coming, and one of them carries a pistol. Never shoot a man who is not shooting.'},
    {id: 'hostage', side: 'police', name: 'Hostage rescue', where: 'Haarklous plass 17A, 4th floor', pay: '400 kr', solo: true, text: 'The game\'s first mission: three to five hostiles in the stairwell and the flat, one hostage. It has its own service pistol. This one is for one player.'}
  ];
  const COL = {guard: 0x1f2a44, police: 0x15181c, robber: 0x2a2e35, staff: 0x7fa7d6, customer: 0x6b6f76, dealer: 0x3f5a3a, hostage: 0xc9b27a};
  // What goes over the lobby about a person is numbers: the kind, the weapon, and one of these looks.
  const KINDS = ['guard', 'police', 'robber', 'staff', 'customer', 'dealer', 'hostage'];
  const LOOKS = [{}, {mask: true}, {cap: 0x1f2a44}, {cap: 0x0b0b0b}, {color: 0x6b6f76}, {color: 0x7a5a48}, {color: 0x4a5a78}, {color: 0x80704a}, {color: 0x5a5560}];
  const MASK = 1, NAVY = 2, BLACK = 3, PLAIN = 4;
  const DOWN_S = 30, MAX_PAY = 8000;
  const num = (v, d = 0) => Number.isFinite(+v) ? +v : d;

  function create(api) {
    const {T, W, group, avatars, data, ctx} = api;
    const tw = api.toWorld, P = () => ctx.player, gy = (x, z, y) => ctx.groundAt(x, z, y);
    const S = {cur: null, guns: [], sel: 0, hp: 100, hurtT: 99, result: null, dmgT: 0, dmgFrom: null, hitT: 0, down: false, downT: 0, downAt: 0, rv: null,
      host: 0, out: null, evSeen: null, dmSeen: null, tomb: null, known: new Set(), knownT: 0};
    const norm = v => {const l = Math.hypot(v.x, v.y, v.z) || 1;return {x: v.x / l, y: v.y / l, z: v.z / l};};
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
    const distP = (x, z) => Math.hypot(P().x - x, P().z - z);
    const inCar = () => P().mode !== 'foot', pStance = () => inCar() ? 'sit' : P().stance;
    const me = () => ctx.you ? ctx.you() : 0, now = () => ctx.serverNow ? ctx.serverNow() : Date.now(), mates = () => ctx.mates ? ctx.mates() : [];
    const r10 = v => Math.round(v * 10);

    // ---------- what the leader tells the others: sounds, notices, shots ----------
    function ev(...d) {const o = S.cur;if (!o || o.mirror) return;o.ev.push({q: ++o.evq, t: o.t, d});if (o.ev.length > 32) o.ev.shift();}
    const sfx = (name, gain) => {api.sfx(name, gain);ev('f', name, gain);};
    const say = (text, sec = 4) => {ctx.notice(text, sec);ev('n', text, sec);};

    // ---------- the marker of the place to go ----------
    const marker = new T.Group();marker.visible = false;group.add(marker);
    {const m = new T.MeshBasicMaterial({color: 0xffc23a, transparent: true, opacity: .85, toneMapped: false}), ring = new T.Mesh(new T.TorusGeometry(2.4, .09, 8, 48), m);ring.rotation.x = -Math.PI / 2;ring.position.y = .12;marker.add(ring);
      const beam = new T.Mesh(new T.CylinderGeometry(.18, .18, 40, 8, 1, true), new T.MeshBasicMaterial({color: 0xffc23a, transparent: true, opacity: .22, depthWrite: false, toneMapped: false, side: T.DoubleSide}));beam.position.y = 20;marker.add(beam);}
    function goal(o, x, z, way = true) {o.goal = {x, z, way};o.mark = {x, z};marker.visible = true;marker.position.set(x, gy(x, z), z);if (way) ctx.waypoint(x, z);}
    function noGoal(o) {o.goal = null;o.mark = null;marker.visible = false;ctx.waypoint(null);}
    function markAt(o, x, y, z) {o.mark = {x, z};marker.position.set(x, y, z);}

    // ---------- you and your friends ----------
    // The leader's list of everybody on the mission, itself first, made new every frame from the lobby.
    function muster(o, dt) {
      const p = P(), id = me(), list = [{id, me: true, name: ctx.yourName ? ctx.yourName() : 'You', x: p.x, y: p.feet + (p.jumpY || 0), z: p.z, yaw: p.yaw, stance: pStance(), car: inCar(), down: S.down, speed: api.speed ? api.speed() : 0}];
      for (const r of mates()) if (r.op.h === id && r.op.k === o.key && id) list.push({id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, yaw: r.yaw, stance: r.stance, car: !!r.car, down: !!r.op.d, speed: 0, op: r.op});
      for (const c of list) {
        let m = o.mem.get(c.id);
        if (!m) {m = {name: c.name, trail: [{x: c.x, z: c.z}], hit: {}, veh: [], n: c.op ? num(c.op.n) : 0, act: 0, j: c.op ? c.op.j : 0, dealt: 0, from: null, lx: c.x, lz: c.z, v: 0};o.mem.set(c.id, m);if (!c.me) say(`${c.name} joined the mission.`, 4);}
        if (c.op && m.j !== c.op.j) {m.j = c.op.j;m.hit = {};m.veh = [];m.n = num(c.op.n);m.act = 0;}
        if (!c.me) {if (dt > 0) m.v += (Math.min(12, Math.hypot(c.x - m.lx, c.z - m.lz) / dt) - m.v) * Math.min(1, dt * 6);c.speed = m.v;}
        m.lx = c.x;m.lz = c.z;
        // The way each of you came, for the ones who come after you.
        const last = m.trail[m.trail.length - 1];if (Math.hypot(c.x - last.x, c.z - last.z) > 2) {m.trail.push({x: c.x, z: c.z});if (m.trail.length > 400) {m.trail.shift();for (const a of o.actors) if (a.tgt === c.id && a.ti > 0) a.ti--;}}
        c.m = m;
      }
      for (const [k, m] of o.mem) if (!list.some(c => c.id === k)) {o.mem.delete(k);say(`${m.name} left the mission.`, 4);}
      o.crew = list;
    }
    const others = o => o.mirror ? o.crew : o.crew.slice(1);
    function nearest(o, x, z) {let b = null, bd = 1e9;for (const c of o.crew) {if (c.down) continue;const d = Math.hypot(c.x - x, c.z - z);if (d < bd) {bd = d;b = c;}}return b;}
    const distC = (o, x, z) => {const c = nearest(o, x, z);return c ? Math.hypot(c.x - x, c.z - z) : 1e9;};
    // What the members did since the last look: their hits, their noise, their button presses.
    function intake(o) {
      for (const c of o.crew) {
        if (!c.op) continue;const m = c.m, op = c.op;
        if (op.hit && typeof op.hit === 'object') for (const [k, v] of Object.entries(op.hit)) {const tot = num(v), was = m.hit[k] || 0, a = o.actors[+k];m.hit[k] = tot;if (tot > was && a && a.alive) strike(o, a, Math.min(400, tot - was), c);}
        if (Array.isArray(op.vh)) op.vh.forEach((v, i) => {const tot = num(v), was = m.veh[i] || 0;m.veh[i] = tot;if (tot > was && o.trucks[i] && SCRIPT[o.id].strike) SCRIPT[o.id].strike(o, o.trucks[i], Math.min(600, tot - was));});
        const n = num(op.n);if (n !== m.n) {m.n = n;noise(o, c.x, c.z, Math.max(20, Math.min(200, num(op.nl, 100))));}
        if (Array.isArray(op.ac)) for (const q of op.ac) {if (!Array.isArray(q) || !(num(q[0]) > m.act)) continue;m.act = num(q[0]);const sc = SCRIPT[o.id];if (sc.act && !c.down && !o.over) sc.act(o, String(q[1]), num(q[2]), c);}
      }
    }

    // ---------- people ----------
    function actor(o, p) {
      const a = {team: 'law', kind: 'guard', w: null, yaw: 0, hp: 100, armour: 0, mode: 'post', hostile: false, sight: 45, skill: .45, speed: 3.4, pts: null, pi: 0, alive: true, see: false, seeD: 1e9, seen: 0, think: Math.random() * .25, cool: .6 + Math.random(), burst: 0,
        alert: null, stance: 'stand', stuck: 0, ti: -1, tgt: null, v: 0, wait: 0, look: 0, ...p};
      const lk = LOOKS[a.look] || {};
      a.w = a.w ? W.weapon(a.w) : null;a.y = a.y ?? gy(a.x, a.z);a.i = o.actors.length;
      a.av = avatars.avatar(a.i, '', lk.color ?? COL[a.kind] ?? 0x555555);a.av.group.position.set(a.x, a.y, a.z);a.av.group.rotation.y = a.yaw;group.add(a.av.group);
      if (a.w && a.av.joints) {a.gunModel = W.buildGun(T, a.w.id);a.gunModel.position.set(0, -.28, -.02);a.gunModel.rotation.set(-Math.PI / 2, 0, 0);a.av.joints.R.el.add(a.gunModel);a.gunModel.visible = !a.hidden;}
      if (lk.mask && a.av.joints) {const m = new T.Mesh(new T.SphereGeometry(.125, 14, 10), new T.MeshStandardMaterial({color: 0x111214, roughness: .9}));m.position.set(0, .02, 0);m.scale.set(.95, 1.1, 1.02);a.av.joints.head.add(m);}
      if (lk.cap && a.av.joints) {const m = new T.Mesh(new T.CylinderGeometry(.12, .125, .07, 14), new T.MeshStandardMaterial({color: lk.cap, roughness: .7}));m.position.set(0, .13, 0);a.av.joints.head.add(m);}
      o.actors.push(a);return a;
    }
    function drop(a) {group.remove(a.av.group);a.av.dispose();}
    const armedPose = a => !!a.w && !a.hidden && a.alive;
    function showGun(a) {a.hidden = false;if (a.gunModel) a.gunModel.visible = true;}
    function down(o, a, by = true) {
      if (!a.alive) return;a.alive = false;a.hp = 0;a.stance = 'prone';a.hostile = false;if (a.gunModel) a.gunModel.visible = false;
      const sc = SCRIPT[o.id];if (sc.onDown) sc.onDown(o, a, by);
    }
    // A hit on one of the people, from the player c.
    function strike(o, a, dmg, c) {a.hp -= dmg;a.alert = {x: c.x, z: c.z, t: 10};a.cool = Math.max(a.cool, .35);if (a.hp <= 0) down(o, a);else if (a.mode === 'civil' || a.mode === 'idle') o.scared = true;}
    const eyeOf = a => ({x: a.x, y: a.y + (a.stance === 'crouch' ? 1.0 : 1.55), z: a.z});
    const chest = c => c.stance === 'prone' ? .3 : c.stance === 'crouch' ? .8 : c.stance === 'sit' ? .9 : 1.3;
    // A clear line from the person's eyes to the player c (walls, trunks and the ground block it).
    function sees(a, c) {
      const eye = eyeOf(a), tgt = {x: c.x, y: c.y + chest(c), z: c.z};
      const d = {x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z}, L = Math.hypot(d.x, d.y, d.z);if (L < .5) return true;
      const dir = norm(d);if (ctx.blockDist(eye, dir, L) < L - .45) return false;
      // The transport's own vehicles are in the way too.
      return !(S.cur && S.cur.trucks.some(v => rayBox(v, eye, dir, L - .5) !== null));
    }
    // Four times a second: whom does this person see? The one they already watch first, else the nearest.
    function look(o, a, dt) {
      if ((a.think -= dt) > 0) return;a.think = .25;a.see = false;a.seeD = 1e9;
      if (a.alert && (a.alert.t -= .25) <= 0) a.alert = null;
      const keen = o.dealing ? o.dealing.who : null, cs = o.crew.filter(c => !c.down).map(c => {const d = Math.hypot(c.x - a.x, c.z - a.z);return {c, d, key: d * (c.id === keen ? .3 : c.id === a.tgt ? .6 : 1)};}).sort((p, q) => p.key - q.key);
      for (const {c, d} of cs) {
        if (d > a.sight * (a.alert ? 1.4 : 1)) continue;
        const dx = c.x - a.x, dz = c.z - a.z, facing = d > .1 ? (-Math.sin(a.yaw) * dx - Math.cos(a.yaw) * dz) / d : 1;
        if (d > 6 && facing < (a.alert || a.mode === 'chase' || a.mode === 'assault' ? -1 : .15)) continue;
        if (!sees(a, c)) continue;
        a.see = true;a.seeD = d;if (a.tgt !== c.id) {a.tgt = c.id;a.ti = -1;a.seen = 0;a.burst = 0;}return;
      }
    }
    // The player this person is busy with: the one they saw last, else the nearest who is on their feet.
    function target(o, a) {
      let c = a.tgt === null ? null : o.crew.find(q => q.id === a.tgt && !q.down);
      if (!c) {c = nearest(o, a.x, a.z);if (c) {a.tgt = c.id;a.ti = -1;}}
      return c || null;
    }
    function turn(a, yaw, dt, rate = 6) {let d = yaw - a.yaw;d = Math.atan2(Math.sin(d), Math.cos(d));a.yaw += d * Math.min(1, dt * rate);return Math.abs(d);}
    function walk(a, tx, tz, speed, dt) {
      const dx = tx - a.x, dz = tz - a.z, L = Math.hypot(dx, dz);if (L < .25) {a.v = 0;return true;}
      const st = Math.min(L, speed * dt), bx = a.x, bz = a.z;let p = ctx.moveActor({x: a.x, y: a.y, z: a.z}, dx / L * st, dz / L * st);
      if (Math.hypot(p.x - bx, p.z - bz) < st * .3) {
        // Something is in the way: step round it, to one side for a while, then the other.
        a.stuck += dt;const side = Math.floor(a.stuck / 4) % 2 ? 1 : -1, ang = Math.atan2(dx, dz) + side * (1.35 + Math.min(.45, (a.stuck % 4) * .15));p = ctx.moveActor({x: a.x, y: a.y, z: a.z}, Math.sin(ang) * st, Math.cos(ang) * st);
      } else a.stuck = Math.max(0, a.stuck - dt * .2);
      a.x = p.x;a.z = p.z;a.y = Number.isFinite(p.y) ? p.y : gy(p.x, p.z, a.y);turn(a, Math.atan2(-dx, -dz), dt, 10);a.v = speed;return false;
    }
    // After the player c: straight at them when they are in sight and close, else along the way they came.
    function chase(a, dt, speed, dist, c) {
      const tr = c.m ? c.m.trail : [];if (a.see && dist < 28 || !tr.length) return walk(a, c.x, c.z, speed, dt);
      if (a.ti < 0 || a.ti >= tr.length) {let b = 0, bd = 1e9;tr.forEach((q, i) => {const d = Math.hypot(q.x - a.x, q.z - a.z) - i * .02;if (d < bd) {bd = d;b = i;}});a.ti = b;}
      while (a.ti < tr.length - 1 && Math.hypot(tr[a.ti].x - a.x, tr[a.ti].z - a.z) < 1.8) a.ti++;
      return walk(a, tr[a.ti].x, tr[a.ti].z, speed, dt);
    }
    const reach = a => !a.w ? 0 : a.w.cls === 'shotgun' ? 9 : a.w.cls === 'smg' ? 15 : a.w.cls === 'pistol' ? 13 : 22;
    function shoot(o, a, dt, dist, c) {
      a.seen += dt;if ((a.cool -= dt) > 0 || a.seen < 1.05 - .4 * a.skill || !a.w) return;
      const w = a.w, eye = {x: a.x, y: a.y + (a.stance === 'crouch' ? 1.0 : 1.5), z: a.z}, feet = {x: c.x, y: c.y, z: c.z}, tgt = {x: c.x, y: c.y + chest(c) - .1, z: c.z};
      const dir = norm({x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z}), sig = Math.tan(W.aimError(w, dist, {skill: a.skill, targetSpeed: c.speed || 0, first: a.burst === 0, seen: a.seen}) * 1.9);// they are no marksmen: cover and moving save you
      const side = norm({x: dir.z, y: 0, z: -dir.x}), gx = gauss() * sig, gv = gauss() * sig * .7, d = norm({x: dir.x + side.x * gx, y: dir.y + gv, z: dir.z + side.z * gx}), from = {x: eye.x + d.x * .5, y: eye.y + d.y * .5, z: eye.z + d.z * .5};
      const max = w.r1 * 1.6 + 40;let end = 0;
      for (const pd of W.pelletDirs(w, d, 1 + Math.floor(Math.random() * 1e9))) {
        let blocked = Math.min(max, ctx.blockDist(from, pd, max));for (const v of o.trucks) {const t = rayBox(v, from, pd, blocked);if (t !== null) blocked = Math.min(blocked, t);}
        const h = W.rayFigure(from, pd, blocked, feet, c.stance, c.yaw);end = h ? h.t : blocked;
        if (h) {const dmg = W.damageAt(w, h.t, false) * (c.car ? .18 : .28) * (w.pellets > 1 ? .5 : 1);if (c.me) hurt(dmg, {x: a.x, z: a.z});else if (c.m) {c.m.dealt += dmg;c.m.from = {x: a.x, z: a.z};}}
      }
      api.tracer(from, d, end, false);api.shotSound(w, Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z));ev('s', a.i, Math.round(d.x * 1000), Math.round(d.y * 1000), Math.round(d.z * 1000), r10(Math.min(end, 400)));
      a.burst++;const n = w.auto ? 3 + Math.floor(a.skill * 3) : 1;if (a.burst >= n) {a.burst = 0;a.cool = (w.auto ? .8 : 60 / w.rpm + .45) + Math.random() * .6;} else a.cool = 60 / w.rpm;
    }
    // You are hit. Alone that ends the mission; with friends you are down until one helps you up.
    function hurt(dmg, from) {
      const o = S.cur;if (!o || o.over || S.down) return;S.hp -= dmg;S.hurtT = 0;S.dmgT = 1.2;S.dmgFrom = from;api.sfx('hit', .5);
      if (S.hp > 0) return;S.hp = 0;
      if (!o.mirror && !others(o).length) {finish(o, 'fail', 'You were shot.');return;}
      S.down = true;S.downT = DOWN_S;S.downAt = now();if (ctx.stance && !inCar()) ctx.stance('prone');ctx.notice('You are down. A friend can help you up (□).', 5);
    }
    function getUp(helped) {S.down = false;S.hp = helped ? 60 : 35;S.hurtT = 0;if (ctx.stance && !inCar()) ctx.stance('stand');ctx.notice(helped ? 'You are up again.' : 'You got up by yourself.', 3);}
    function stepActor(o, a, dt) {
      const g = a.av.group;
      if (!a.alive) {if (!a.gone) {a.av.pose({stance: 'prone', speed: 0, dt});a.av.update(dt, ctx.camera, false);}return;}
      look(o, a, dt);const c = target(o, a), see = a.see && !!c;a.v = 0;
      const dx = c ? c.x - a.x : 0, dz = c ? c.z - a.z : -1, dist = c ? Math.hypot(dx, dz) : 1e9, toYou = Math.atan2(-dx, -dz);
      if (a.mode === 'civil') a.stance = o.scared ? 'crouch' : 'stand';
      else if (a.mode === 'post') {
        if (a.hostile && see) {a.stance = dist > 12 && a.seen > 1.5 ? 'crouch' : 'stand';if (turn(a, toYou, dt) < .35) shoot(o, a, dt, dist, c);}
        else {a.seen = 0;a.burst = 0;a.stance = 'stand';if (a.alert) turn(a, Math.atan2(-(a.alert.x - a.x), -(a.alert.z - a.z)), dt, 3);}
      } else if (a.mode === 'assault') {
        if (a.hostile && see) {if (dist > reach(a)) walk(a, c.x, c.z, a.speed, dt);if (turn(a, toYou, dt, 9) < .4) shoot(o, a, dt, dist, c);}
        else {a.seen = 0;a.burst = 0;if (a.path && a.pi < a.path.length) {if (walk(a, a.path[a.pi].x, a.path[a.pi].z, a.speed, dt)) a.pi++;} else if (c) chase(a, dt, a.speed, dist, c);}
      } else if (a.mode === 'patrol') {
        if (a.wait > 0) {a.wait -= dt;turn(a, a.gaze ?? a.yaw, dt, 2);} else if (walk(a, a.pts[a.pi].x, a.pts[a.pi].z, 1.35, dt)) {a.pi = (a.pi + 1) % a.pts.length;a.wait = 2 + Math.random() * 3;a.gaze = a.yaw + (Math.random() - .5) * 2.4;}
      } else if (a.mode === 'chase') {if (c) chase(a, dt, a.speed, dist, c);}
      else if (a.mode === 'flee') {if (c) {const L = dist || 1;walk(a, a.x - dx / L * 8, a.z - dz / L * 8, a.speed, dt);}}
      else if (a.mode === 'walk') {if (a.pts && walk(a, a.pts[a.pi].x, a.pts[a.pi].z, a.speed, dt)) {a.arrived = true;}}
      g.position.set(a.x, a.y, a.z);g.rotation.y = a.yaw;g.visible = !a.gone && Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z) < 220;
      a.mk = armedPose(a) && (a.hostile || a.mode === 'assault');
      if (g.visible) {a.av.pose({stance: a.stance, speed: a.v, dt, marker: a.mk});a.av.update(dt, ctx.camera, false);}
    }
    // Everybody within earshot of a shot looks that way.
    function noise(o, x, z, loud) {for (const a of o.actors) if (a.alive && Math.hypot(a.x - x, a.z - z) < loud) a.alert = {x, z, t: 8};const sc = SCRIPT[o.id];if (sc.onNoise) sc.onNoise(o, x, z, loud);}
    // Police that come after you: from the way one of you came (so they can always reach you), or from a clear spot round you.
    function cops(o, n, {w = 'mp5', skill = .4, from = null} = {}) {
      const up = o.crew.filter(c => !c.down);
      for (let i = 0; i < n; i++) {
        const c = up.length ? up[(o.copsSent || 0) % up.length] : o.crew[0];let at = null;
        if (from) at = from[i % from.length];
        else {const tr = c.m.trail;let k = tr.length - 1, len = 0;while (k > 0 && len < 46 + i * 5) {len += Math.hypot(tr[k].x - tr[k - 1].x, tr[k].z - tr[k - 1].z);k--;}if (len >= 40) at = tr[k];}
        for (let t = 0; !at && t < 30; t++) {const an = Math.random() * 6.283, r = 42 + Math.random() * 16, x = c.x + Math.sin(an) * r, z = c.z + Math.cos(an) * r;if (ctx.clear(x, z)) at = {x, z};}
        if (!at) continue;
        actor(o, {team: 'law', kind: 'police', w: i % 3 === 2 ? 'g17' : w, x: at.x + (i % 2 ? .8 : -.8), z: at.z + i * .4, yaw: 0, armour: .5, mode: 'assault', hostile: true, sight: 60, skill, speed: 4.6, path: at.path || null, look: BLACK, cop: true, tgt: from ? null : c.id});o.copsSent = (o.copsSent || 0) + 1;
      }
    }
    const alive = (o, f) => o.actors.filter(a => a.alive && f(a)).length;

    // ---------- the bank ----------
    const B = api.bank;
    const SCRIPT = {};
    SCRIPT.heist = {
      // What both the leader's and a member's computer need: where the vault is.
      scene(o) {if (!B) return false;o.vaultAt = B.at(B.vault, B.D - 1.3);return true;},
      start(o) {
        if (!this.scene(o)) {finish(o, 'fail', 'The bank is not there.');return;}
        const door = B.at(B.door, -3.5);
        const yawIn = Math.atan2(-(B.at(3, 5).x - B.at(3, 0).x), -(B.at(3, 5).z - B.at(3, 0).z)), yawOut = yawIn + Math.PI, put = (a, b) => ({...B.at(a, b), y: B.y});
        for (const [a, b] of [[3.2, 6], [6.2, 6]]) actor(o, {team: 'civil', kind: 'staff', mode: 'civil', ...put(a, b), yaw: yawOut});
        if (o.side === 'robber') {
          [[5, 2.2, 'g17'], [10.5, 3, 'r870'], [8.5, 6.3, 'g17']].forEach(([a, b, w]) => actor(o, {team: 'law', kind: 'guard', w, ...put(a, b), yaw: yawOut, armour: .5, skill: .4, sight: 30, look: NAVY}));
          o.obj = 'Go to Torshov Sparebank on Sandakerveien.';o.phase = 'go';
        } else {
          [[4, 3, 'ak47'], [9, 2.5, 'r870'], [11, 5.5, 'mp5'], [12.5, 6.2, 'uzi']].forEach(([a, b, w]) => actor(o, {team: 'crook', kind: 'robber', w, ...put(a, b), yaw: yawOut, look: MASK, hostile: true, skill: .42, sight: 34}));
          actor(o, {team: 'civil', kind: 'hostage', mode: 'civil', ...put(7, 2), yaw: yawOut});o.scared = true;
          o.obj = 'Robbers are drilling the vault of Torshov Sparebank. Get there.';o.phase = 'go';
        }
        goal(o, door.x, door.z);
      },
      tick(o, dt) {
        const near = o.goal ? distC(o, o.goal.x, o.goal.z) : 1e9;
        if (o.side === 'police') {
          if (o.phase === 'go' && near < 70) {o.phase = 'storm';o.timer = 150;o.obj = 'Stop the robbers before the vault is open. Do not hit the hostages.';sfx('alarm', .5);noGoal(o);}
          if (o.phase === 'storm') {
            o.sub = `Robbers left: ${alive(o, a => a.kind === 'robber')}`;
            if (!alive(o, a => a.kind === 'robber')) finish(o, 'win', 'The robbers are stopped and the staff are safe.', 2500);
            else if ((o.timer -= dt) <= 0) finish(o, 'fail', 'The vault is open and the robbers are gone with the money.');
          }
          return;
        }
        if (o.phase === 'go' && (o.loud || o.crew.some(c => !c.down && B.inside(c.x, c.z, c.y)))) {o.phase = 'fight';o.scared = true;for (const a of o.actors) if (a.kind === 'guard') a.hostile = true;o.obj = 'Deal with the guards.';sfx('alarm', .5);noGoal(o);}
        if (o.phase === 'fight') {o.sub = `Guards left: ${alive(o, a => a.kind === 'guard')}`;if (!alive(o, a => a.kind === 'guard')) {o.phase = 'vault';o.obj = 'Start the drill at the vault door (□).';o.sub = '';goal(o, o.vaultAt.x, o.vaultAt.z, false);}}
        if (o.phase === 'drill') {
          o.sub = 'The alarm is ringing: the police are on their way.';
          if ((o.copT -= dt) <= 0 && (o.copsSent || 0) < 8 && alive(o, a => a.cop) < 4) {o.copT = 11;const st = B.at(B.door, -16), f = B.at(B.door, -1.5), inn = B.at(B.door, 2.5);cops(o, 2, {from: [{x: st.x - 2, z: st.z, path: [f, inn]}, {x: st.x + 2, z: st.z + 1, path: [f, inn]}]});}
          if ((o.timer -= dt) <= 0) {o.timer = null;o.phase = 'loot';o.obj = 'The vault is open. Take the bags (□).';api.vault(true);sfx('unlock', .8);}
        }
        if (o.phase === 'loot') o.sub = `Bags: ${o.bags} of 3`;
        if (o.phase === 'escape') {
          o.sub = `%D m to the garage · bags: ${o.bags}`;
          if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 13;cops(o, 1);}
          if (near < 6) finish(o, 'win', `You got away with ${o.bags} bags.${o.hurtStaff ? ` ${o.hurtStaff} of the staff were hurt.` : ''}`, Math.max(0, 1500 * o.bags - 500 * (o.hurtStaff || 0)));
        }
      },
      prompt(o) {
        if (o.side !== 'robber' || !o.vaultAt || distP(o.vaultAt.x, o.vaultAt.z) > 2.2) return null;
        if (o.phase === 'vault') return {text: '□ Start the drill (30 s)', act: ['drill']};
        if (o.phase === 'loot') return {text: `□ Take a bag of money (${o.bags + 1} of 3)`, act: ['bag']};
        return null;
      },
      // A button press at a prompt, from any of you.
      act(o, kind) {
        if (kind === 'drill' && o.phase === 'vault') {o.phase = 'drill';o.timer = 30;o.copT = 6;o.obj = 'Hold the bank until the drill is through.';sfx('alarm', .7);noGoal(o);}
        if (kind === 'bag' && o.phase === 'loot' && o.bags < 3) {o.bags++;sfx('coin', .8);if (o.bags >= 3) {o.phase = 'escape';o.copT = 5;const g = tw(...data.getaway.at);o.obj = `Get away: the garage at ${data.getaway.address}. Any way you like.`;goal(o, g.x, g.z);}}
      },
      onDown(o, a) {
        if (a.team === 'civil') {if (o.side === 'police') finish(o, 'fail', 'A hostage was shot.');else {o.hurtStaff = (o.hurtStaff || 0) + 1;say('One of the staff was hit. That costs 500 kr.', 4);}}
      },
      onNoise(o, x, z) {if (Math.hypot(x - o.vaultAt.x, z - o.vaultAt.z) < 45) o.loud = true;}
    };

    // ---------- the money transport ----------
    const ROUTE = (() => {const pts = data.convoy.pts.map(p => tw(...p)), cum = [0];for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));return {pts, cum, len: cum[cum.length - 1]};})();
    function routeAt(s) {
      const c = ROUTE.cum, q = Math.max(0, Math.min(ROUTE.len - .01, s));let i = 1;while (i < c.length - 1 && c[i] < q) i++;
      const a = ROUTE.pts[i - 1], b = ROUTE.pts[i], k = (q - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1]);return {x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z))};
    }
    function truck(kind) {
      const g = new T.Group(), M = (c, r = .6, m = .2) => new T.MeshStandardMaterial({color: c, roughness: r, metalness: m}), box = (w, h, d, x, y, z, m) => {const o = new T.Mesh(new T.BoxGeometry(w, h, d), m);o.position.set(x, y, z);o.castShadow = true;g.add(o);return o;};
      const tyre = M(0x151515, .9, 0), glass = M(0x1a2a36, .15, .5), wheels = (x, zs) => zs.forEach(z => [-1, 1].forEach(s => {const t = new T.Mesh(new T.CylinderGeometry(.46, .46, .3, 14), tyre);t.rotation.z = Math.PI / 2;t.position.set(s * x, .46, z);g.add(t);}));
      if (kind === 'truck') {
        const body = M(0x2f4a3a, .55, .3), dark = M(0x1c2a22, .6, .3);
        box(2.3, 1.9, 4.2, 0, 1.65, 1.0, body);box(2.3, 1.5, 1.7, 0, 1.45, -2.0, body);box(2.1, .6, .06, 0, 1.75, -2.86, glass);box(2.36, .35, 6.0, 0, .62, .1, dark);box(2.2, .08, 4.1, 0, 2.64, 1.0, dark);
        const doors = box(2.0, 1.6, .08, 0, 1.6, 3.12, dark);doors.name = 'doors';box(.5, .22, .05, 0, 2.2, 3.17, M(0xf2c23a, .5, 0));wheels(1.02, [-1.9, 1.9]);
        const c = document.createElement('canvas');c.width = 512;c.height = 96;const x = c.getContext('2d');x.fillStyle = '#2f4a3a';x.fillRect(0, 0, 512, 96);x.fillStyle = '#f2e9c8';x.font = 'bold 54px Arial, sans-serif';x.textAlign = 'center';x.textBaseline = 'middle';x.fillText('VERDITRANSPORT', 256, 50);
        const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;for (const s of [-1, 1]) {const p = new T.Mesh(new T.PlaneGeometry(3.6, .62), new T.MeshStandardMaterial({map: tex, roughness: .6}));p.position.set(s * 1.16, 1.9, 1.0);p.rotation.y = s * Math.PI / 2;g.add(p);}
        return {g, kind, L: 6.2, Wd: 2.4, H: 2.7, hp: 260, max: 260, bags: 2, doors, guards: [['r870', 1.9, .5], ['g17', -1.9, -1.2]]};
      }
      const white = M(0xf3f4f5, .4, .3), yellow = M(0xd8e03a, .5, 0), blue = new T.MeshStandardMaterial({color: 0x2060ff, emissive: 0x2060ff, emissiveIntensity: 1.2});
      box(1.8, .7, 4.3, 0, .75, 0, white);box(1.7, .62, 2.2, 0, 1.4, .2, glass);box(1.82, .22, 4.32, 0, .8, 0, yellow);box(1.1, .12, .3, 0, 1.78, .2, blue);wheels(.82, [-1.4, 1.4]);
      return {g, kind, L: 4.4, Wd: 1.9, H: 1.8, hp: 160, max: 160, bags: 0, guards: [['mp5', 1.6, 0], ['mp5', -1.6, .6]]};
    }
    // A shot against a vehicle's box: the distance along the shot, or null.
    function rayBox(v, o, d, max) {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw), rel = {x: o.x - v.x, y: o.y - v.y, z: o.z - v.z}, lo = [rel.x * c - rel.z * s, rel.y, rel.x * s + rel.z * c], ld = [d.x * c - d.z * s, d.y, d.x * s + d.z * c], mn = [-v.Wd / 2, .2, -v.L / 2], mx = [v.Wd / 2, v.H, v.L / 2];
      let t0 = 0, t1 = max;for (let k = 0; k < 3; k++) {if (Math.abs(ld[k]) < 1e-9) {if (lo[k] < mn[k] || lo[k] > mx[k]) return null;continue;}let a = (mn[k] - lo[k]) / ld[k], b = (mx[k] - lo[k]) / ld[k];if (a > b) [a, b] = [b, a];t0 = Math.max(t0, a);t1 = Math.min(t1, b);if (t0 > t1) return null;}
      return t0;
    }
    function rayTrucks(o, from, d, max) {let best = null;o.trucks.forEach((v, i) => {const t = rayBox(v, from, d, max);if (t !== null && (!best || t < best.t)) best = {t, v, i};});return best;}
    SCRIPT.convoy = {
      // The transport and the road blocks' trucks stand on every computer; where they are comes from the leader.
      scene(o) {
        o.conv = {s: 0, ns: 0, fresh: true, speed: 0, wait: o.side === 'robber' ? 55 : 75, halted: false, alarm: false, out: false};
        o.trucks = [['car', 22], ['truck', 11], ['truck', 0]].map(([k, s0]) => {const v = truck(k);v.s0 = s0;v.y = null;group.add(v.g);return v;});this.place(o, 0);
        if (o.side === 'police') o.blocks = data.convoy.ambush.map(am => {const s = ROUTE.cum[am.i], p = routeAt(s), g = truck('truck').g;g.position.set(p.x, gy(p.x, p.z), p.z);g.rotation.y = p.yaw + Math.PI / 2;group.add(g);return {s, p, g, men: [], clear: false};});
        return true;
      },
      start(o) {
        this.scene(o);
        if (o.side === 'robber') {o.obj = 'The transport leaves Haarklous plass soon. Stop it before it reaches the bank.';o.phase = 'hunt';}
        else {
          o.blocks.forEach((b, k) => {const p = b.p;b.men = ['ak47', 'r870', 'mp5', 'uzi'].map((w, i) => {const an = p.yaw + Math.PI + (i - 1.5) * .7, r = 5 + (i % 2) * 3, x = p.x - Math.sin(an) * r, z = p.z - Math.cos(an) * r;return actor(o, {team: 'crook', kind: 'robber', w, x, z, yaw: p.yaw + Math.PI, look: MASK, hostile: true, skill: .38 + k * .06, sight: 55});});});
          o.obj = 'Clear the two road blocks before the transport gets there.';o.phase = 'clear';goal(o, o.blocks[0].p.x, o.blocks[0].p.z);
        }
      },
      place(o, dt) {
        for (const v of o.trucks) {const p = routeAt(o.conv.s + v.s0), y = gy(p.x, p.z, v.y ?? undefined);v.x = p.x;v.z = p.z;v.yaw = p.yaw;v.y = v.y === null || !dt ? y : v.y + (y - v.y) * Math.min(1, dt * 8);v.g.position.set(v.x, v.y, v.z);v.g.rotation.y = v.yaw;}
      },
      guardsOut(o) {
        const c = o.conv;if (c.out) return;c.out = true;
        for (const v of o.trucks) for (const [w, side, back] of v.guards) {const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw), x = v.x + cs * side + sn * back, z = v.z - sn * side + cs * back;actor(o, {team: 'law', kind: v.kind === 'car' ? 'police' : 'guard', w, x, z, yaw: v.yaw, armour: .5, mode: 'assault', hostile: true, skill: .42, sight: 55, speed: 3.6, look: v.kind === 'car' ? BLACK : NAVY, crew: true});}
        sfx('carDoor', .8);
      },
      tick(o, dt) {
        const c = o.conv, lead = o.trucks[0];
        if (c.wait > 0) {c.wait -= dt;o.sub = `The transport leaves in ${Math.ceil(c.wait)} s.`;if (c.wait <= 0) say('The money transport is on its way.', 4);}
        const dead = o.trucks.some(v => v.hp <= 0), ahead = routeAt(c.s + lead.s0 + 7), blockedByYou = o.side === 'robber' && distC(o, ahead.x, ahead.z) < 4.6;
        let hold = c.wait > 0 || dead || blockedByYou;
        if (o.side === 'police') {
          const blk = o.blocks.find(b => !b.clear);
          for (const b of o.blocks) if (!b.clear && b.men.every(m => !m.alive)) {b.clear = true;b.g.visible = false;sfx('cheer', .4);const n = o.blocks.find(q => !q.clear);if (n) {goal(o, n.p.x, n.p.z);say('Road block cleared. One more.', 4);} else {noGoal(o);say('Both road blocks are cleared.', 4);}}
          if (blk && c.s + lead.s0 > blk.s - 32) {
            hold = true;const n = blk.men.filter(m => m.alive).length, t = o.trucks[1];t.hp -= 1.2 * n * dt;o.sub = `The transport is under fire at the road block: truck ${Math.max(0, Math.round(t.hp / t.max * 100))} %`;
            if (t.hp <= 0) {finish(o, 'fail', 'The robbers broke into the transport.');return;}
          } else if (c.wait <= 0) o.sub = `Road blocks left: ${o.blocks.filter(b => !b.clear).length} · transport ${Math.round(c.s / (ROUTE.len - 24) * 100)} % of the way`;
          if (c.s + lead.s0 >= ROUTE.len - 2) {finish(o, 'win', 'The money is safe in the bank.', 3000);return;}
        } else {
          if (o.phase === 'hunt') {
            if ((o.wpT = (o.wpT || 0) - dt) <= 0) {o.wpT = 2;goal(o, lead.x, lead.z);}markAt(o, lead.x, lead.y, lead.z);
            if (c.wait <= 0) o.sub = `Transport: %D m away · ${Math.max(0, Math.round(ROUTE.len - c.s - lead.s0))} m from the bank`;
            if ((dead || blockedByYou) && c.wait <= 0) {c.halted = true;this.guardsOut(o);o.phase = 'fight';o.obj = 'The transport has stopped. Deal with the guards.';noGoal(o);}
            else if (c.s + lead.s0 >= ROUTE.len - 2) {finish(o, 'fail', 'The transport is in the bank\'s yard. Too late.');return;}
          }
          if (c.halted) hold = true;
          if (o.phase === 'fight') {o.sub = `Guards left: ${alive(o, a => a.crew)}`;if (!alive(o, a => a.crew)) {o.phase = 'breach';o.obj = 'Blow the back doors of the trucks (□) and take the bags.';o.copT = 14;}}
          if (o.phase === 'breach') {
            o.sub = `Bags: ${o.bags} of 4`;
            for (const v of o.trucks) if (v.fuse > 0 && (v.fuse -= dt) <= 0) {v.open = true;v.doors.visible = false;sfx('crash', .9);noise(o, v.x, v.z, 150);}
            if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 12;cops(o, 1);}
            if (o.bags >= 4) {o.phase = 'escape';const g = tw(...data.getaway.at);o.obj = `Get away: the garage at ${data.getaway.address}.`;goal(o, g.x, g.z);}
          }
          if (o.phase === 'escape') {
            const near = distC(o, o.goal.x, o.goal.z);o.sub = `%D m to the garage · bags: ${o.bags}`;
            if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 13;cops(o, 1);}
            if (near < 6) {finish(o, 'win', `You got away with ${o.bags} bags.`, 1200 * o.bags);return;}
          }
        }
        c.speed += ((hold ? 0 : c.alarm ? 8.5 : 7) - c.speed) * Math.min(1, dt * (hold ? 3 : .8));c.s = Math.min(ROUTE.len - 22, c.s + c.speed * dt);this.place(o, dt);
      },
      prompt(o) {
        if (o.side !== 'robber' || o.phase !== 'breach') return null;
        for (let i = 0; i < o.trucks.length; i++) {
          const v = o.trucks[i];if (v.kind !== 'truck') continue;const rx = v.x + Math.sin(v.yaw) * (v.L / 2 + .9), rz = v.z + Math.cos(v.yaw) * (v.L / 2 + .9);if (distP(rx, rz) > 2.4) continue;
          if (!v.open && !(v.fuse > 0)) return {text: '□ Set a charge on the back doors (4 s – step back)', act: ['fuse', i]};
          if (v.open && v.bags > 0) return {text: `□ Take a bag of money (${v.bags} left in this truck)`, act: ['take', i]};
        }
        return null;
      },
      act(o, kind, i) {
        const v = o.trucks[i];if (!v || v.kind !== 'truck' || o.phase !== 'breach') return;
        if (kind === 'fuse' && !v.open && !(v.fuse > 0)) {v.fuse = 4;sfx('beep', .7);}
        if (kind === 'take' && v.open && v.bags > 0) {v.bags--;o.bags++;sfx('coin', .8);}
      },
      // A shot of one of you into a vehicle.
      strike(o, v, dmg) {
        if (o.side !== 'robber') return;v.hp -= dmg;o.conv.alarm = true;
        if (v.hp <= 0 && !v.smoke) {v.smoke = true;sfx('crash', .6);say(v.kind === 'truck' ? 'The truck is stopped.' : 'The escort car is stopped.', 3);}
      },
      onNoise(o, x, z) {if (o.side === 'robber' && o.trucks.some(v => Math.hypot(v.x - x, v.z - z) < 35)) o.conv.alarm = true;}
    };

    // ---------- dealing ----------
    SCRIPT.deal = {
      start(o) {
        const spots = data.deal.spots.map(sp => ({...tw(...sp.at), face: sp.face, address: sp.address})), yawOf = h => {const p = tw(Math.sin(h), Math.cos(h)), q = tw(0, 0);return Math.atan2(-(p.x - q.x), -(p.z - q.z));};
        const order = spots.map((sp, i) => i).sort((a, b) => ((a * 7 + o.seed) % 9) - ((b * 7 + o.seed) % 9));
        if (o.side === 'robber') {
          order.slice(0, 5).forEach(i => actor(o, {team: 'civil', kind: 'customer', mode: 'idle', x: spots[i].x, z: spots[i].z, yaw: yawOf(spots[i].face), address: spots[i].address, look: PLAIN + i % 5, buyer: true}));
          for (const pt of data.deal.patrols) {const a = tw(...pt.a), b = tw(...pt.b);actor(o, {team: 'law', kind: 'police', w: 'g17', hidden: true, x: a.x, z: a.z, mode: 'patrol', pts: [a, b], sight: 38, skill: .45, speed: 5.3, armour: .5, look: BLACK, officer: true});}
          o.left = 5;o.cash = 0;o.heat = 0;o.chased = false;o.lost = 0;o.obj = 'Hand over the goods to the five customers. Do not let the police see it.';this.next(o);
        } else {
          [0, 1, 2].forEach(k => {const a = spots[order[k * 2]], b = spots[order[k * 2 + 1]], c = spots[order[(k * 2 + 2) % order.length]];
            for (const sp of [a, b]) actor(o, {team: 'civil', kind: 'customer', mode: 'idle', x: sp.x + .9, z: sp.z + .5, yaw: yawOf(sp.face)});
            actor(o, {team: 'crook', kind: 'dealer', w: k === 1 ? 'g17' : null, hidden: true, x: a.x, z: a.z, mode: 'walk', pts: [a, b, c], speed: 1.5, sight: 26, skill: .35, dealer: true, wait: 6});});
          o.left = 3;o.obj = 'Find the three dealers and arrest them (□ right beside one).';this.next(o);
        }
      },
      buyers: o => o.actors.filter(a => a.kind === 'customer' && (o.mirror || a.buyer)),
      dealers: o => o.actors.filter(a => a.kind === 'dealer'),
      next(o) {
        const list = (o.side === 'robber' ? this.buyers(o).filter(c => !c.done) : this.dealers(o).filter(d => d.alive && !d.arrested)), p = P();
        if (!list.length) return;list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));o.target = list[0];goal(o, list[0].x, list[0].z);
      },
      tick(o, dt) {
        if (o.side === 'robber') {
          const officers = o.actors.filter(a => a.officer && a.alive), up = o.crew.filter(c => !c.down);let seen = false, nearestD = 1e9;
          for (const a of officers) {nearestD = Math.min(nearestD, distC(o, a.x, a.z));if (a.see) {seen = true;const d = a.seeD;if (!o.chase) o.heat += (o.dealing && a.tgt === o.dealing.who ? 75 : d < 14 ? 10 : d < 25 ? 3 : 0) * dt;}}
          if (!seen && !o.chase) o.heat = Math.max(0, o.heat - 4 * dt);
          if (o.heat >= 100 && !o.chase) {o.chase = true;o.chased = true;o.lost = 0;o.dealing = null;sfx('whistle', .7);say('“Stopp! Politi!” – they have seen you. Run, and get out of sight.', 5);for (const a of officers) if (distC(o, a.x, a.z) < 170) {a.mode = o.hot ? 'assault' : 'chase';a.ti = -1;}}
          if (o.chase) {
            o.heat = 100;o.lost = seen || nearestD < 30 ? 0 : o.lost + dt;
            if (!o.hot && officers.some(a => a.mode === 'chase' && up.some(c => Math.hypot(a.x - c.x, a.z - c.z) < 1.7 && Math.abs(a.y - c.y) < 2))) {finish(o, 'fail', `Caught. The police took the goods${o.cash ? ` and the ${o.cash} kr` : ''}.`);return;}
            if (o.lost > 12 && !o.hot) {o.chase = false;o.heat = 45;say('You lost them. Carry on, carefully.', 4);for (const a of officers) if (a.mode === 'chase') {a.mode = 'patrol';a.wait = 0;}}
          }
          if (o.dealing) {
            const c = o.dealing.c, w = o.crew.find(q => q.id === o.dealing.who), slack = w && !w.me ? .6 : 0;
            if (!w || w.down || Math.hypot(w.x - c.x, w.z - c.z) > 2.6 + slack || w.speed > 1.2 + slack) {o.dealing = null;say('The hand-over stopped: stand still beside the customer.', 2);}
            else if ((o.dealing.t -= dt) <= 0) {c.done = true;c.mode = 'flee';c.speed = 1.6;c.away = 6;o.dealing = null;o.left--;o.cash += 600;sfx('coin', .7);if (o.left <= 0) {finish(o, 'win', o.chased ? 'All five customers served.' : 'All five customers served, and the police never noticed.', o.cash + (o.chased ? 0 : 500));return;}this.next(o);}
          }
          for (const c of this.buyers(o)) if (c.away > 0 && (c.away -= dt) <= 0) {c.mode = 'idle';c.av.group.visible = false;c.alive = false;c.hidden = true;c.gone = true;}
          o.sub = `Customers left: ${o.left} · ${o.cash} kr${o.dealing ? ` · handing over ${Math.ceil(o.dealing.t)} s` : ''}`;
        } else {
          for (const d of this.dealers(o)) {
            if (!d.alive || d.arrested) continue;
            if (d.hostile) {d.mode = 'post';continue;}
            if (d.see && d.seeD < 24) {d.run = 4;}
            if (d.run > 0) {d.run -= dt;d.mode = 'flee';d.speed = 4.9;if (d.w && distC(o, d.x, d.z) < 8) {d.hostile = true;showGun(d);d.mode = 'post';say('He has a pistol!', 3);}}
            else {d.mode = 'walk';d.speed = 1.5;if (d.arrived) {d.arrived = false;d.hold = 8;}if (d.hold > 0) {d.hold -= dt;d.mode = 'idle';if (d.hold <= 0) d.pi = (d.pi + 1) % d.pts.length;}}
          }
          if ((o.wpT = (o.wpT || 0) - dt) <= 0) {o.wpT = 3;this.next(o);}
          o.sub = `Dealers left: ${o.left}${o.target ? ' · nearest %D m' : ''}`;
        }
      },
      prompt(o) {
        if (o.side === 'robber') {
          if (o.chase) return null;const c = this.buyers(o).find(c => c.alive && !c.done && distP(c.x, c.z) < 2.2);
          return c ? {text: '□ Hand over the goods (stand still for 3 s)', act: ['deal', c.i]} : null;
        }
        const d = this.dealers(o).find(d => d.alive && !d.arrested && !d.hostile && distP(d.x, d.z) < 2.3);
        return d ? {text: '□ Arrest', act: ['arrest', d.i]} : null;
      },
      act(o, kind, i, who) {
        const a = o.actors[i];if (!a || !who) return;
        if (kind === 'deal' && o.side === 'robber' && a.buyer && !a.done && !o.dealing && !o.chase) o.dealing = {c: a, t: 3, who: who.id};
        if (kind === 'arrest' && o.side === 'police' && a.dealer && a.alive && !a.arrested && !a.hostile && Math.hypot(a.x - who.x, a.z - who.z) < 5) {
          a.arrested = true;a.mode = 'idle';a.stance = 'crouch';a.run = 0;o.left--;sfx('click', .8);say('“Du er arrestert.” One less.', 3);if (o.left <= 0) finish(o, 'win', 'All three dealers are off the street.', 2000);else this.next(o);
        }
      },
      onDown(o, a) {
        if (o.side === 'police') {if (a.dealer && a.w && a.wasHostile) {o.left--;if (o.left <= 0) finish(o, 'win', 'All three dealers are off the street.', 2000);else this.next(o);} else finish(o, 'fail', a.dealer ? 'A man who was not shooting was shot.' : 'A bystander was shot.');}
        else if (a.team === 'civil') finish(o, 'fail', 'A customer was shot.');
        else if (a.officer) o.hot = true;
      },
      onNoise(o, x, z, loud) {
        if (o.side !== 'robber' || loud < 40) return;
        if (o.actors.some(a => a.officer && a.alive && Math.hypot(a.x - x, a.z - z) < Math.min(110, loud))) {o.hot = true;o.heat = 100;for (const a of o.actors) if (a.officer && a.alive) {a.hostile = true;showGun(a);if (o.chase) a.mode = 'assault';}}
      }
    };

    // ---------- what goes over the lobby ----------
    const wNow = () => {const g = S.guns[S.sel];return g ? W.indexOf(g.w.id) : 0;};
    function pack(o) {
      const dm = {};for (const [id, m] of o.mem) if (m.dealt > 0) dm[id] = [r10(m.dealt), m.from ? Math.round(m.from.x) : 0, m.from ? Math.round(m.from.z) : 0];
      const p = {k: o.key, m: MISSIONS.indexOf(o.def), ph: o.phase, ob: o.obj, sb: o.sub, tm: o.timer > 0 ? r10(o.timer) / 10 : 0, bg: o.bags, g: o.goal ? [r10(o.goal.x), r10(o.goal.z), o.goal.way ? 1 : 0] : 0,
        a: o.actors.map(a => [r10(a.x), r10(a.y), r10(a.z), Math.round(Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw)) * 100), (a.alive ? 1 : 0) | (a.hostile ? 2 : 0) | (a.hidden ? 4 : 0) | (a.stance === 'crouch' ? 8 : 0) | (a.gone ? 16 : 0) | (a.done || a.arrested ? 32 : 0) | (a.mk ? 64 : 0),
          Math.max(0, KINDS.indexOf(a.kind)) + 8 * (a.w ? W.indexOf(a.w.id) + 1 : 0) + 256 * (a.look || 0)]),
        e: o.ev.filter(e => o.t - e.t < 1.5).map(e => [e.q, ...e.d]), dm, d: S.down ? 1 : 0, w: wNow()};
      if (o.conv) p.v = [r10(o.conv.s), ...o.trucks.map(v => [Math.max(0, Math.round(v.hp)), (v.open ? 1 : 0) | (v.fuse > 0 ? 2 : 0) | (v.smoke ? 4 : 0), v.bags])];
      if (o.blocks) p.bl = o.blocks.reduce((s, b, i) => s | (b.clear ? 1 << i : 0), 0);
      if (o.id === 'deal' && o.side === 'robber') p.x = [Math.round(o.heat), o.chase ? 1 : 0];
      if (o.res) p.r = o.res;if (S.rv) p.rv = S.rv;
      return p;
    }
    // Your own lobby state about the mission (game-main sends it as st.op), or null.
    function opState() {
      const o = S.cur;if (!o) return S.tomb ? S.tomb.p : null;
      if (!o.mirror) return me() ? pack(o) : null;
      const u = S.out, p = {h: S.host, k: o.key, j: u.j, d: S.down ? 1 : 0, w: wNow(), n: u.n, nl: u.nl};
      if (Object.keys(u.hit).length) p.hit = {...u.hit};if (u.vh.length) p.vh = u.vh.map(v => v || 0);if (u.ac.length) p.ac = u.ac.map(q => q.slice());if (S.rv) p.rv = S.rv;
      return p;
    }
    // The missions others in your lobby lead, that you can join.
    const joinable = () => mates().filter(r => r.op.k && !r.op.h && !r.op.r && MISSIONS[r.op.m] && !MISSIONS[r.op.m].solo).map(r => ({id: r.id, name: r.name, def: MISSIONS[r.op.m], key: r.op.k}));
    // A mate of yours on this mission (their weapon and whether they are down), for the weapon in their hands.
    function mate(id) {const o = S.cur;if (!o) return null;const c = others(o).find(q => q.id === id);return c && c.op ? {w: Math.max(0, Math.min(W.WEAPONS.length - 1, num(c.op.w) | 0)), camo: 0, alive: !c.down} : null;}

    // ---------- a member's side: draw what the leader sends ----------
    function play(o, e) {
      const k = e[1];
      if (k === 'f') api.sfx(String(e[2]).slice(0, 24), Math.max(0, Math.min(1, num(e[3], .5))));
      else if (k === 'n') ctx.notice(String(e[2]).slice(0, 200), Math.max(1, Math.min(10, num(e[3], 4))));
      else if (k === 's') {const a = o.actors[num(e[2], -1)];if (!a || !a.w) return;const d = norm({x: num(e[3]), y: num(e[4]), z: num(e[5])}), eye = {x: a.x, y: a.y + (a.stance === 'crouch' ? 1.0 : 1.5), z: a.z};
        api.tracer({x: eye.x + d.x * .5, y: eye.y + d.y * .5, z: eye.z + d.z * .5}, d, num(e[6]) / 10, false);api.shotSound(a.w, Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z));}
    }
    function apply(o, op) {
      const ph = String(op.ph || '');if (ph !== o.phase) {o.phase = ph;api.vault(o.id === 'heist' && o.side === 'robber' && (ph === 'loot' || ph === 'escape'));}
      o.obj = String(op.ob || '').slice(0, 240);o.sub = String(op.sb || '').slice(0, 240);o.timer = num(op.tm) > 0 ? num(op.tm) : null;o.bags = num(op.bg);
      if (Array.isArray(op.x)) {o.heat = num(op.x[0]);o.chase = !!op.x[1];}
      const g = Array.isArray(op.g) ? op.g : null, gk = g ? g.join() : '';if (gk !== o.gk) {o.gk = gk;if (g) goal(o, num(g[0]) / 10, num(g[1]) / 10, !!g[2]);else noGoal(o);}
      (Array.isArray(op.a) ? op.a.slice(0, 48) : []).forEach((q, i) => {
        if (!Array.isArray(q)) q = [0, 0, 0, 0, 16, 0];
        const x = num(q[0]) / 10, y = num(q[1]) / 10, z = num(q[2]) / 10, yaw = num(q[3]) / 100, f = num(q[4]) | 0, sp = num(q[5]) | 0;let a = o.actors[i];
        if (!a) {if (i !== o.actors.length) return;const kind = KINDS[sp & 7] || 'guard', wi = ((sp >> 3) & 31) - 1;a = actor(o, {kind, w: wi >= 0 && W.WEAPONS[wi] ? W.WEAPONS[wi].id : null, look: (sp >> 8) & 15, x, y, z, yaw, hidden: !!(f & 4), armour: kind === 'guard' || kind === 'police' ? .5 : 0, dealer: kind === 'dealer'});}
        a.nx = x;a.ny = y;a.nz = z;a.nyaw = yaw;a.alive = !!(f & 1);a.hostile = !!(f & 2);a.hidden = !!(f & 4);a.stance = f & 8 ? 'crouch' : 'stand';a.gone = !!(f & 16);a.done = a.arrested = !!(f & 32);a.mk = !!(f & 64);
      });
      if (o.conv && Array.isArray(op.v)) {
        o.conv.ns = num(op.v[0]) / 10;if (o.conv.fresh) {o.conv.fresh = false;o.conv.s = o.conv.ns;}
        o.trucks.forEach((v, i) => {const q = op.v[i + 1];if (!Array.isArray(q)) return;const f = num(q[1]) | 0;v.hp = num(q[0]);if (f & 1 && !v.open) {v.open = true;if (v.doors) v.doors.visible = false;}v.fuse = f & 2 ? 1 : 0;v.smoke = !!(f & 4);v.bags = num(q[2]);});
      }
      if (o.blocks) {const bl = num(op.bl) | 0;o.blocks.forEach((b, i) => {b.clear = !!(bl >> i & 1);b.g.visible = !b.clear;});}
      // Shots, sounds and notices since the last message (none from before you joined).
      let top = S.evSeen ?? 0;for (const e of Array.isArray(op.e) ? op.e.slice(0, 40) : []) {if (!Array.isArray(e)) continue;const q = num(e[0]);if (S.evSeen !== null && q > S.evSeen) play(o, e);top = Math.max(top, q);}S.evSeen = top;
      // What hit you.
      const mine = op.dm && typeof op.dm === 'object' ? op.dm[me()] : null, tot = Array.isArray(mine) ? num(mine[0]) / 10 : 0;
      if (S.dmSeen === null || tot < S.dmSeen) S.dmSeen = tot;else if (tot > S.dmSeen) {const d = tot - S.dmSeen;S.dmSeen = tot;hurt(Math.min(100, d), {x: num(mine[1]), z: num(mine[2])});}
      if (Array.isArray(op.r)) ended(o, !!op.r[0], String(op.r[1] || '').slice(0, 240), Math.max(0, Math.min(MAX_PAY, num(op.r[2]))));
    }
    function stepMirror(o, a, dt) {
      const k = Math.min(1, dt * 10), px = a.x, pz = a.z, g = a.av.group;
      if (Math.hypot(a.nx - a.x, a.nz - a.z) > 12) {a.x = a.nx;a.y = a.ny;a.z = a.nz;a.yaw = a.nyaw;}
      else {a.x += (a.nx - a.x) * k;a.y += (a.ny - a.y) * k;a.z += (a.nz - a.z) * k;a.yaw += Math.atan2(Math.sin(a.nyaw - a.yaw), Math.cos(a.nyaw - a.yaw)) * k;}
      g.position.set(a.x, a.y, a.z);g.rotation.y = a.yaw;g.visible = !a.gone && Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z) < 220;
      if (a.gunModel) a.gunModel.visible = a.alive && !a.hidden;
      if (g.visible) {const v = dt > 0 ? Math.hypot(a.x - px, a.z - pz) / dt : 0;a.av.pose({stance: a.alive ? a.stance : 'prone', speed: a.alive && v > .3 ? Math.min(6, v) : 0, dt, marker: a.alive && a.mk});a.av.update(dt, ctx.camera, false);}
    }
    const inCrew = (o, r) => o.mirror ? (r.id === S.host ? !r.op.h && r.op.k === o.key : r.op.h === S.host && r.op.k === o.key) : (r.op.h === me() && r.op.k === o.key);
    function follow(o, dt) {
      const all = mates(), h = all.find(r => r.id === S.host), op = h && !h.op.h && h.op.k === o.key ? h.op : null;
      o.crew = all.filter(r => inCrew(o, r)).map(r => ({id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, down: !!r.op.d, op: r.op}));
      if (!op) {if ((o.lost += dt) > 4) {stop();ctx.notice('The mission ended: the one who started it left.', 5);}}
      else {o.lost = 0;if (op !== o.pkt) {o.pkt = op;apply(o, op);}}
      if (S.cur !== o) return;
      for (const a of o.actors) stepMirror(o, a, dt);
      if (o.conv) {const c = o.conv;c.s = Math.abs(c.ns - c.s) > 40 ? c.ns : c.s + (c.ns - c.s) * Math.min(1, dt * 6);SCRIPT.convoy.place(o, dt);if (o.phase === 'hunt' && marker.visible) {const l = o.trucks[0];markAt(o, l.x, l.y, l.z);}}
    }

    // ---------- start, join, end ----------
    function arm() {
      // Twice the spare magazines on a mission: nobody hands you more out there.
      S.guns = api.loadout().map(i => {const g = new W.Gun(W.weapon(i));g.reserve *= 2;return g;});S.sel = 0;S.hp = 100;S.hurtT = 99;S.result = null;S.down = false;S.rv = null;api.vault(false);
    }
    function start(def) {
      if (def.id === 'hostage') {stop();ctx.startCase();return;}
      stop();S.tomb = null;
      const o = S.cur = {def, id: def.id, side: def.side, phase: '', t: 0, actors: [], trucks: [], obj: '', sub: '', timer: null, bags: 0, copT: 0, seed: Math.floor(Math.random() * 97), over: false,
        key: 1 + Math.floor(Math.random() * 1e9), mem: new Map(), crew: [], ev: [], evq: 0, goal: null, mark: null};
      arm();muster(o, 0);
      SCRIPT[def.id].start(o);if (S.cur === o) ctx.notice(`${def.name}. ${o.obj}${me() ? ' Others in your lobby can join at the board.' : ''}`, 7);
    }
    // Join the mission that the player with this id leads.
    function join(hostId) {
      const h = mates().find(r => r.id === hostId), op = h && h.op, def = op && !op.h && !op.r ? MISSIONS[op.m] : null;if (!def || def.solo || !me()) return false;
      stop();
      const o = S.cur = {mirror: true, key: op.k, def, id: def.id, side: def.side, phase: '', t: 0, actors: [], trucks: [], obj: '', sub: '', timer: null, bags: 0, over: false, crew: [], lost: 0, pkt: null, gk: null, heat: 0, chase: false, goal: null, mark: null};
      S.host = hostId;arm();S.out = {j: 1 + Math.floor(Math.random() * 1e9), hit: {}, vh: [], n: 0, nl: 0, ac: [], aq: 0};S.evSeen = null;S.dmSeen = null;
      const sc = SCRIPT[def.id];if (sc.scene && sc.scene(o) === false) {clear(o);S.cur = null;return false;}
      o.pkt = op;apply(o, op);for (const a of o.actors) {a.x = a.nx;a.y = a.ny;a.z = a.nz;a.yaw = a.nyaw;}
      if (S.cur === o) ctx.notice(`${def.name}, with ${h.name}. ${o.obj}`, 7);
      return true;
    }
    function clear(o) {for (const a of o.actors) drop(a);for (const v of o.trucks) group.remove(v.g);for (const b of o.blocks || []) group.remove(b.g);marker.visible = false;ctx.waypoint(null);}
    function stop() {
      const o = S.cur;if (!o) return;
      // The result stays in the leader's state for a few seconds, so that everybody gets it.
      if (!o.mirror && o.res) S.tomb = {p: {k: o.key, m: MISSIONS.indexOf(o.def), r: o.res}, t: 6};
      if (S.down && ctx.stance && !inCar()) ctx.stance('stand');
      clear(o);S.cur = null;S.down = false;S.rv = null;api.vault(false);
    }
    function ended(o, win, text, pay) {
      if (o.over) return;o.over = true;
      S.result = {win, title: win ? `${o.def.name}: done` : `${o.def.name}: failed`, text, pay, t: 8};
      api.sfx(win ? 'cheer' : 'thud', .7);o.endT = win ? 2.5 : 1.2;o.home = !win;
    }
    function finish(o, result, text, pay = 0) {if (o.over) return;o.res = [result === 'win' ? 1 : 0, text, pay];ended(o, result === 'win', text, pay);}

    function update(dt, input, foot) {
      if (S.result && (S.result.t -= dt) <= 0) S.result = null;
      S.dmgT = Math.max(0, S.dmgT - dt);S.hitT = Math.max(0, S.hitT - dt);
      // A friend started a mission: say so, once.
      if ((S.knownT -= dt) <= 0) {S.knownT = .5;for (const j of joinable()) {if (S.known.has(j.key)) continue;if (S.known.size > 200) S.known.clear();S.known.add(j.key);if (!S.cur) ctx.notice(`${j.name} started “${j.def.name}”. Join at the mission board in Arsenalet.`, 7);}}
      const o = S.cur;if (!o) {if (S.tomb && (S.tomb.t -= dt) <= 0) S.tomb = null;return;}
      o.t += dt;
      if (o.over) {
        for (const a of o.actors) {if (o.mirror) stepMirror(o, a, dt);else {a.hostile = false;stepActor(o, a, dt);}}
        if ((o.endT -= dt) <= 0) {const pay = S.result ? S.result.pay : 0, home = o.home, name = o.def.name;stop();if (pay > 0) ctx.earn(pay, name);if (home) {const h = api.home();ctx.place(h.x, h.z, h.yaw);}}
        return;
      }
      if (o.mirror) {follow(o, dt);if (S.cur !== o || o.over) return;}
      else {
        muster(o, dt);intake(o);
        for (const a of o.actors) {if (a.hostile) a.wasHostile = true;stepActor(o, a, dt);}
        SCRIPT[o.id].tick(o, dt);
        if (S.cur !== o || o.over) return;
        if (S.down && others(o).every(c => c.down)) {finish(o, 'fail', others(o).length ? 'Everybody is down.' : 'You were shot.');return;}
      }
      // Down: up again when a friend has helped you, or by yourself after a while.
      if (S.down) {
        S.downT -= dt;const helped = mates().some(r => inCrew(o, r) && Array.isArray(r.op.rv) && r.op.rv[0] === me() && num(r.op.rv[1]) > S.downAt);
        if (helped || S.downT <= 0) getUp(helped);
        return;
      }
      S.hurtT += dt;if (S.hurtT > 5 && S.hp < 100) S.hp = Math.min(100, S.hp + 18 * dt);
      // Your weapon.
      if (input.next) {S.sel = (S.sel + 1) % S.guns.length;api.sfx('click', .4);}
      const g = S.guns[S.sel], r = g.update(dt, input, foot);
      if (r.started) api.sfx('chains', .25);if (r.reloaded) api.sfx('click', .5);if (r.empty) api.sfx('pistolClick', .6);
      if (r.shots) api.fire(g);
    }
    // Your shot (from: the eye, d: where it goes): people, vehicles, walls. Returns where each pellet ended.
    function shot(from, d, w, seed) {
      const o = S.cur;if (!o) return null;const max = w.melee || (w.r1 * 1.6 + 40), ends = [];let any = false;
      for (const pd of W.pelletDirs(w, d, seed)) {
        let end = Math.min(max, ctx.blockDist(from, pd, max)), who = null;
        for (const a of o.actors) {if (!a.alive || a.gone) continue;const h = W.rayFigure(from, pd, end, {x: a.x, y: a.y, z: a.z}, a.stance, a.yaw);if (h) {end = h.t;who = {a, h};}}
        const vh = o.trucks.length && o.side === 'robber' ? rayTrucks(o, from, pd, end) : null;
        if (vh) {end = vh.t;who = null;any = true;const dmg = W.damageAt(w, 20) * (vh.v.kind === 'truck' ? 1 : 1.3);if (o.mirror) S.out.vh[vh.i] = Math.round(((S.out.vh[vh.i] || 0) + dmg) * 10) / 10;else SCRIPT.convoy.strike(o, vh.v, dmg);}
        if (who) {any = true;const a = who.a, dmg = W.damageAt(w, who.h.t, who.h.head, a.armour);if (o.mirror) S.out.hit[a.i] = Math.round(((S.out.hit[a.i] || 0) + dmg) * 10) / 10;else strike(o, a, dmg, o.crew[0]);}
        ends.push(end);
      }
      if (any) S.hitT = .25;
      if (o.mirror) {S.out.n++;S.out.nl = Math.round(w.loud || 0);} else noise(o, P().x, P().z, w.loud);
      return ends;
    }
    function prompt() {
      const o = S.cur;if (!o || o.over || S.down || P().mode !== 'foot') return null;const p = P();
      for (const c of others(o)) if (c.down && Math.hypot(c.x - p.x, c.z - p.z) < 2.2 && Math.abs(c.y - p.feet) < 2.5) return {text: `□ Help ${c.name} up`, act: () => {S.rv = [c.id, now()];api.sfx('click', .7);}};
      const sc = SCRIPT[o.id], pr = sc.prompt ? sc.prompt(o) : null;if (!pr) return null;
      return {text: pr.text, act: () => {
        if (!o.mirror) sc.act(o, pr.act[0], pr.act[1] ?? 0, o.crew[0]);
        else {S.out.ac.push([++S.out.aq, pr.act[0], pr.act[1] ?? 0]);if (S.out.ac.length > 4) S.out.ac.shift();}
      }};
    }
    // The convoy's vehicles are solid for you and your car.
    function solids() {
      const o = S.cur;if (!o || !o.trucks.length) return [];
      return o.trucks.map(v => {const c = Math.cos(v.yaw), s = Math.sin(v.yaw), hw = v.Wd / 2, hl = v.L / 2;return {points: [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([a, b]) => ({x: v.x + c * a + s * b, z: v.z - s * a + c * b})), minY: v.y - .5, maxY: v.y + v.H, kind: 'convoy'};});
    }
    return {start, join, joinable, stop, update, shot, prompt, solids, opState, mate, MISSIONS, get cur() {return S.cur;}, get hp() {return S.hp;}, get result() {return S.result;}, get dmgT() {return S.dmgT;}, get dmgFrom() {return S.dmgFrom;}, get hitT() {return S.hitT;},
      get down() {return S.down;}, get downT() {return S.downT;},
      // The second line of the objective; %D is your own distance to the marker.
      get sub() {const o = S.cur;if (!o) return '';return String(o.sub || '').replace('%D', o.mark ? String(Math.round(distP(o.mark.x, o.mark.z))) : '–');},
      // The others on the mission with you.
      get crew() {const o = S.cur;return o ? others(o).map(c => ({id: c.id, name: c.name, down: !!c.down})) : [];},
      gun: () => S.cur ? S.guns[S.sel] : null, state: S,
      debug: {actors: () => S.cur ? S.cur.actors : [], finish: (r, t, p) => S.cur && !S.cur.mirror && finish(S.cur, r, t, p), down: a => S.cur && down(S.cur, a), hurt, route: ROUTE}};
  }
  return {MISSIONS, create};
});
