/* The missions you start at the board in Arsenalet (issue #179): the bank, the money transport and dealing, each as a robber
 * or as the police; the hostage rescue is the game's old mission (case-game.js), started from the same board.
 * A mission is played alone: the people in it (guards, police, robbers, customers) are this computer's and are not sent to
 * the lobby. They are GameAvatars figures that walk in the walk world, see along clear lines (the walk world's solids) and
 * shoot real shots with an aim error, so cover, distance and moving all help you.
 *
 * GameArsenalOps.create(api) -> {start(def), stop(), update(dt, input), prompt(), shot(o, d, w, seed), solids(), cur, hp, gun(), hud()}
 * api: {T, W (GameWeapons), group, avatars, data (ARSENAL), ctx (filled in by game-main: player, camera, groundAt, blockDist,
 *   moveActor, clear, place, notice, earn, waypoint, startCase), bank (the bank's room or null), home(), loadout(), tracer(from,
 *   dir, len, own), shotSound(w, dist), sfx(name, gain), vault(open), hurtFx(from)}
 */
(function (root, factory) {
  root.GameArsenalOps = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MISSIONS = [
    {id: 'heist', side: 'robber', name: 'Bank robbery', where: 'Torshov Sparebank, Sandakerveien', pay: '1 500 kr a bag (3 bags)', text: 'Three armed guards watch the bank. Deal with them, drill the vault (30 seconds, the alarm brings the police), take the bags and get to the garage in Omsens gate. Leave the staff alone: each one hurt costs you 500 kr.'},
    {id: 'heist', side: 'police', name: 'Bank alarm', where: 'Torshov Sparebank, Sandakerveien', pay: '2 500 kr', text: 'Four masked robbers are drilling the vault and hold the staff. When you get there you have two and a half minutes before the vault is open and they are gone. Do not hit the hostages.'},
    {id: 'convoy', side: 'robber', name: 'Money transport', where: 'Haarklous plass → Sandakerveien', pay: '1 200 kr a bag (4 bags)', text: 'An escort car and two armoured trucks drive from Haarklous plass to the bank. Stop them before they get there: stand in their way or shoot a truck until it stops. The guards get out and fight. Blow the back doors, take the bags, get to the garage in Omsens gate.'},
    {id: 'convoy', side: 'police', name: 'Convoy escort', where: 'Kyrre Grepps gate and Hans Nielsen Hauges gate', pay: '3 000 kr', text: 'Robbers have blocked the money transport\'s road in two places. Clear both road blocks. If the transport gets to a block before you, it has to wait there under fire, and the trucks do not hold for ever.'},
    {id: 'deal', side: 'robber', name: 'Dealing', where: 'five street doors round Torshov', pay: '600 kr a customer, 500 kr more if the police never chase you', text: 'Five customers wait at street doors. Hand over the goods (□, stand still for three seconds) when no police officer can see you. Patrols walk the streets: seen dealing, or hanging about near them, and they come running. Out of sight for a while and they give up. If one gets hold of you, you are caught.'},
    {id: 'deal', side: 'police', name: 'Narcotics patrol', where: 'the streets round Torshov', pay: '2 000 kr', text: 'Three dealers walk between their customers. Find them and arrest them (□ when you are right beside one). They run when they see you coming, and one of them carries a pistol. Never shoot a man who is not shooting.'},
    {id: 'hostage', side: 'police', name: 'Hostage rescue', where: 'Haarklous plass 17A, 4th floor', pay: '400 kr', text: 'The game\'s first mission: three to five hostiles in the stairwell and the flat, one hostage. It has its own service pistol.'}
  ];
  const COL = {guard: 0x1f2a44, police: 0x15181c, robber: 0x2a2e35, staff: 0x7fa7d6, customer: 0x6b6f76, dealer: 0x3f5a3a, hostage: 0xc9b27a};

  function create(api) {
    const {T, W, group, avatars, data, ctx} = api;
    const tw = api.toWorld, P = () => ctx.player, gy = (x, z, y) => ctx.groundAt(x, z, y);
    const S = {cur: null, guns: [], sel: 0, hp: 100, hurtT: 99, trail: [], result: null, dmgT: 0, dmgFrom: null, hitT: 0};
    const norm = v => {const l = Math.hypot(v.x, v.y, v.z) || 1;return {x: v.x / l, y: v.y / l, z: v.z / l};};
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
    const distP = (x, z) => Math.hypot(P().x - x, P().z - z), pFeet = () => ({x: P().x, y: P().feet + (P().jumpY || 0), z: P().z});
    const inCar = () => P().mode !== 'foot', pStance = () => inCar() ? 'sit' : P().stance;

    // ---------- the marker of the place to go ----------
    const marker = new T.Group();marker.visible = false;group.add(marker);
    {const m = new T.MeshBasicMaterial({color: 0xffc23a, transparent: true, opacity: .85, toneMapped: false}), ring = new T.Mesh(new T.TorusGeometry(2.4, .09, 8, 48), m);ring.rotation.x = -Math.PI / 2;ring.position.y = .12;marker.add(ring);
      const beam = new T.Mesh(new T.CylinderGeometry(.18, .18, 40, 8, 1, true), new T.MeshBasicMaterial({color: 0xffc23a, transparent: true, opacity: .22, depthWrite: false, toneMapped: false, side: T.DoubleSide}));beam.position.y = 20;marker.add(beam);}
    function goal(o, x, z, way = true) {o.goal = {x, z};marker.visible = true;marker.position.set(x, gy(x, z), z);if (way) ctx.waypoint(x, z);}
    function noGoal(o) {o.goal = null;marker.visible = false;ctx.waypoint(null);}

    // ---------- people ----------
    function actor(o, p) {
      const a = {team: 'law', kind: 'guard', w: null, yaw: 0, hp: 100, armour: 0, mode: 'post', hostile: false, sight: 45, skill: .45, speed: 3.4, pts: null, pi: 0, alive: true, see: false, seen: 0, think: Math.random() * .25, cool: .6 + Math.random(), burst: 0,
        alert: null, stance: 'stand', stuck: 0, ti: -1, v: 0, wait: 0, ...p};
      a.w = a.w ? W.weapon(a.w) : null;a.y = a.y ?? gy(a.x, a.z);
      a.av = avatars.avatar(o.actors.length, '', a.color ?? COL[a.kind] ?? 0x555555);a.av.group.position.set(a.x, a.y, a.z);a.av.group.rotation.y = a.yaw;group.add(a.av.group);
      if (a.w && a.av.joints) {a.gunModel = W.buildGun(T, a.w.id);a.gunModel.position.set(0, -.28, -.02);a.gunModel.rotation.set(-Math.PI / 2, 0, 0);a.av.joints.R.el.add(a.gunModel);a.gunModel.visible = !a.hidden;}
      if (a.mask && a.av.joints) {const m = new T.Mesh(new T.SphereGeometry(.125, 14, 10), new T.MeshStandardMaterial({color: 0x111214, roughness: .9}));m.position.set(0, .02, 0);m.scale.set(.95, 1.1, 1.02);a.av.joints.head.add(m);}
      if (a.cap && a.av.joints) {const m = new T.Mesh(new T.CylinderGeometry(.12, .125, .07, 14), new T.MeshStandardMaterial({color: a.cap, roughness: .7}));m.position.set(0, .13, 0);a.av.joints.head.add(m);}
      o.actors.push(a);return a;
    }
    function drop(a) {group.remove(a.av.group);a.av.dispose();}
    const armedPose = a => !!a.w && !a.hidden && a.alive;
    function down(o, a, by = 'you') {
      if (!a.alive) return;a.alive = false;a.hp = 0;a.stance = 'prone';a.hostile = false;if (a.gunModel) a.gunModel.visible = false;
      const sc = SCRIPT[o.id];if (sc.onDown) sc.onDown(o, a, by);
    }
    // A clear line from the person's eyes to you (walls, trunks and the ground block it).
    function sees(a) {
      const p = pFeet(), eye = {x: a.x, y: a.y + (a.stance === 'crouch' ? 1.0 : 1.55), z: a.z}, tgt = {x: p.x, y: p.y + (pStance() === 'prone' ? .3 : pStance() === 'crouch' ? .8 : pStance() === 'sit' ? .9 : 1.3), z: p.z};
      const d = {x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z}, L = Math.hypot(d.x, d.y, d.z);if (L < .5) return true;
      const dir = norm(d);if (ctx.blockDist(eye, dir, L) < L - .45) return false;
      // The transport's own vehicles are in the way too.
      return !(S.cur && S.cur.trucks.some(v => rayBox(v, eye, dir, L - .5) !== null));
    }
    function look(a, dt, dist, dx, dz) {
      if ((a.think -= dt) > 0) return;a.think = .25;a.see = false;
      if (a.alert && (a.alert.t -= .25) <= 0) a.alert = null;
      if (dist > a.sight * (a.alert ? 1.4 : 1)) return;
      const facing = dist > .1 ? (-Math.sin(a.yaw) * dx - Math.cos(a.yaw) * dz) / dist : 1;
      if (dist > 6 && facing < (a.alert || a.mode === 'chase' || a.mode === 'assault' ? -1 : .15)) return;
      a.see = sees(a);
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
    // After you: straight at you when you are in sight and close, else along the way you came.
    function chase(a, dt, speed, dist) {
      const tr = S.trail;if (a.see && dist < 28 || !tr.length) return walk(a, P().x, P().z, speed, dt);
      if (a.ti < 0 || a.ti >= tr.length) {let b = 0, bd = 1e9;tr.forEach((q, i) => {const d = Math.hypot(q.x - a.x, q.z - a.z) - i * .02;if (d < bd) {bd = d;b = i;}});a.ti = b;}
      while (a.ti < tr.length - 1 && Math.hypot(tr[a.ti].x - a.x, tr[a.ti].z - a.z) < 1.8) a.ti++;
      return walk(a, tr[a.ti].x, tr[a.ti].z, speed, dt);
    }
    const reach = a => !a.w ? 0 : a.w.cls === 'shotgun' ? 9 : a.w.cls === 'smg' ? 15 : a.w.cls === 'pistol' ? 13 : 22;
    function shoot(o, a, dt, dist) {
      a.seen += dt;if ((a.cool -= dt) > 0 || a.seen < 1.05 - .4 * a.skill || !a.w) return;
      const w = a.w, eye = {x: a.x, y: a.y + (a.stance === 'crouch' ? 1.0 : 1.5), z: a.z}, p = pFeet(), tgt = {x: p.x, y: p.y + (pStance() === 'prone' ? .3 : pStance() === 'crouch' ? .75 : pStance() === 'sit' ? .9 : 1.2), z: p.z};
      const dir = norm({x: tgt.x - eye.x, y: tgt.y - eye.y, z: tgt.z - eye.z}), sig = Math.tan(W.aimError(w, dist, {skill: a.skill, targetSpeed: ctx.speed ? ctx.speed() : 0, first: a.burst === 0, seen: a.seen}) * 1.9);// they are no marksmen: cover and moving save you
      const side = norm({x: dir.z, y: 0, z: -dir.x}), gx = gauss() * sig, gv = gauss() * sig * .7, d = norm({x: dir.x + side.x * gx, y: dir.y + gv, z: dir.z + side.z * gx}), from = {x: eye.x + d.x * .5, y: eye.y + d.y * .5, z: eye.z + d.z * .5};
      const max = w.r1 * 1.6 + 40;let end = 0;
      for (const pd of W.pelletDirs(w, d, 1 + Math.floor(Math.random() * 1e9))) {
        let blocked = Math.min(max, ctx.blockDist(from, pd, max));for (const v of o.trucks) {const t = rayBox(v, from, pd, blocked);if (t !== null) blocked = Math.min(blocked, t);}
        const h = W.rayFigure(from, pd, blocked, p, pStance(), P().yaw);end = h ? h.t : blocked;
        if (h) hurt(W.damageAt(w, h.t, false) * (inCar() ? .18 : .28) * (w.pellets > 1 ? .5 : 1), {x: a.x, z: a.z});
      }
      api.tracer(from, d, end, false);api.shotSound(w, Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z));
      a.burst++;const n = w.auto ? 3 + Math.floor(a.skill * 3) : 1;if (a.burst >= n) {a.burst = 0;a.cool = (w.auto ? .8 : 60 / w.rpm + .45) + Math.random() * .6;} else a.cool = 60 / w.rpm;
    }
    function hurt(dmg, from) {
      const o = S.cur;if (!o || o.over) return;S.hp -= dmg;S.hurtT = 0;S.dmgT = 1.2;S.dmgFrom = from;api.sfx('hit', .5);
      if (S.hp <= 0) {S.hp = 0;finish(o, 'fail', 'You were shot.');}
    }
    function stepActor(o, a, dt) {
      const g = a.av.group;
      if (!a.alive) {a.av.pose({stance: 'prone', speed: 0, dt});a.av.update(dt, ctx.camera, false);return;}
      const p = P(), dx = p.x - a.x, dz = p.z - a.z, dist = Math.hypot(dx, dz), toYou = Math.atan2(-dx, -dz);
      look(a, dt, dist, dx, dz);a.v = 0;
      if (a.mode === 'civil') a.stance = o.scared ? 'crouch' : 'stand';
      else if (a.mode === 'post') {
        if (a.hostile && a.see) {a.stance = dist > 12 && a.seen > 1.5 ? 'crouch' : 'stand';if (turn(a, toYou, dt) < .35) shoot(o, a, dt, dist);}
        else {a.seen = 0;a.burst = 0;a.stance = 'stand';if (a.alert) turn(a, Math.atan2(-(a.alert.x - a.x), -(a.alert.z - a.z)), dt, 3);}
      } else if (a.mode === 'assault') {
        if (a.hostile && a.see) {if (dist > reach(a)) walk(a, p.x, p.z, a.speed, dt);if (turn(a, toYou, dt, 9) < .4) shoot(o, a, dt, dist);}
        else {a.seen = 0;a.burst = 0;if (a.path && a.pi < a.path.length) {if (walk(a, a.path[a.pi].x, a.path[a.pi].z, a.speed, dt)) a.pi++;} else chase(a, dt, a.speed, dist);}
      } else if (a.mode === 'patrol') {
        if (a.wait > 0) {a.wait -= dt;turn(a, a.gaze ?? a.yaw, dt, 2);} else if (walk(a, a.pts[a.pi].x, a.pts[a.pi].z, 1.35, dt)) {a.pi = (a.pi + 1) % a.pts.length;a.wait = 2 + Math.random() * 3;a.gaze = a.yaw + (Math.random() - .5) * 2.4;}
      } else if (a.mode === 'chase') chase(a, dt, a.speed, dist);
      else if (a.mode === 'flee') {const L = dist || 1;walk(a, a.x - dx / L * 8, a.z - dz / L * 8, a.speed, dt);}
      else if (a.mode === 'walk') {if (a.pts && walk(a, a.pts[a.pi].x, a.pts[a.pi].z, a.speed, dt)) {a.arrived = true;}}
      g.position.set(a.x, a.y, a.z);g.rotation.y = a.yaw;g.visible = Math.hypot(a.x - ctx.camera.position.x, a.z - ctx.camera.position.z) < 220;
      if (g.visible) {a.av.pose({stance: a.stance, speed: a.v, dt, marker: armedPose(a) && (a.hostile || a.mode === 'assault')});a.av.update(dt, ctx.camera, false);}
    }
    // Everybody within earshot of a shot looks that way.
    function noise(o, x, z, loud) {for (const a of o.actors) if (a.alive && Math.hypot(a.x - x, a.z - z) < loud) a.alert = {x, z, t: 8};const sc = SCRIPT[o.id];if (sc.onNoise) sc.onNoise(o, x, z, loud);}
    // Police that come after you: from the way you came (so they can always reach you), or from a clear spot round you.
    function cops(o, n, {w = 'mp5', skill = .4, from = null} = {}) {
      for (let i = 0; i < n; i++) {
        let at = null;
        if (from) at = from[i % from.length];
        else {const tr = S.trail;let k = tr.length - 1, len = 0;while (k > 0 && len < 46 + i * 5) {len += Math.hypot(tr[k].x - tr[k - 1].x, tr[k].z - tr[k - 1].z);k--;}if (len >= 40) at = tr[k];}
        for (let t = 0; !at && t < 30; t++) {const an = Math.random() * 6.283, r = 42 + Math.random() * 16, x = P().x + Math.sin(an) * r, z = P().z + Math.cos(an) * r;if (ctx.clear(x, z)) at = {x, z};}
        if (!at) continue;
        actor(o, {team: 'law', kind: 'police', w: i % 3 === 2 ? 'g17' : w, x: at.x + (i % 2 ? .8 : -.8), z: at.z + i * .4, yaw: 0, armour: .5, mode: 'assault', hostile: true, sight: 60, skill, speed: 4.6, path: at.path || null, cap: 0x0b0b0b, cop: true});o.copsSent = (o.copsSent || 0) + 1;
      }
    }
    const alive = (o, f) => o.actors.filter(a => a.alive && f(a)).length;

    // ---------- the bank ----------
    const B = api.bank;
    const SCRIPT = {};
    SCRIPT.heist = {
      start(o) {
        if (!B) {finish(o, 'fail', 'The bank is not there.');return;}
        const door = B.at(B.door, -3.5);o.vaultAt = B.at(B.vault, B.D - 1.3);o.inside = () => B.inside(P().x, P().z, P().feet);
        const yawIn = Math.atan2(-(B.at(3, 5).x - B.at(3, 0).x), -(B.at(3, 5).z - B.at(3, 0).z)), yawOut = yawIn + Math.PI, put = (a, b) => ({...B.at(a, b), y: B.y});
        for (const [a, b] of [[3.2, 6], [6.2, 6]]) actor(o, {team: 'civil', kind: 'staff', mode: 'civil', ...put(a, b), yaw: yawOut});
        if (o.side === 'robber') {
          [[5, 2.2, 'g17'], [10.5, 3, 'r870'], [8.5, 6.3, 'g17']].forEach(([a, b, w]) => actor(o, {team: 'law', kind: 'guard', w, ...put(a, b), yaw: yawOut, armour: .5, skill: .4, sight: 30, cap: 0x1f2a44}));
          o.obj = 'Go to Torshov Sparebank on Sandakerveien.';o.phase = 'go';
        } else {
          [[4, 3, 'ak47'], [9, 2.5, 'r870'], [11, 5.5, 'mp5'], [12.5, 6.2, 'uzi']].forEach(([a, b, w]) => actor(o, {team: 'crook', kind: 'robber', w, ...put(a, b), yaw: yawOut, mask: true, hostile: true, skill: .42, sight: 34}));
          actor(o, {team: 'civil', kind: 'hostage', mode: 'civil', ...put(7, 2), yaw: yawOut});o.scared = true;
          o.obj = 'Robbers are drilling the vault of Torshov Sparebank. Get there.';o.phase = 'go';
        }
        goal(o, door.x, door.z);
      },
      tick(o, dt) {
        const near = distP(o.goal ? o.goal.x : 0, o.goal ? o.goal.z : 0);
        if (o.side === 'police') {
          if (o.phase === 'go' && near < 70) {o.phase = 'storm';o.timer = 150;o.obj = 'Stop the robbers before the vault is open. Do not hit the hostages.';api.sfx('alarm', .5);noGoal(o);}
          if (o.phase === 'storm') {
            o.sub = `Robbers left: ${alive(o, a => a.kind === 'robber')}`;
            if (!alive(o, a => a.kind === 'robber')) finish(o, 'win', 'The robbers are stopped and the staff are safe.', 2500);
            else if ((o.timer -= dt) <= 0) finish(o, 'fail', 'The vault is open and the robbers are gone with the money.');
          }
          return;
        }
        if (o.phase === 'go' && (o.inside() || o.loud)) {o.phase = 'fight';o.scared = true;for (const a of o.actors) if (a.kind === 'guard') a.hostile = true;o.obj = 'Deal with the guards.';api.sfx('alarm', .5);noGoal(o);}
        if (o.phase === 'fight') {o.sub = `Guards left: ${alive(o, a => a.kind === 'guard')}`;if (!alive(o, a => a.kind === 'guard')) {o.phase = 'vault';o.obj = 'Start the drill at the vault door (□).';o.sub = '';goal(o, o.vaultAt.x, o.vaultAt.z, false);}}
        if (o.phase === 'drill') {
          o.sub = 'The alarm is ringing: the police are on their way.';
          if ((o.copT -= dt) <= 0 && (o.copsSent || 0) < 8 && alive(o, a => a.cop) < 4) {o.copT = 11;const st = B.at(B.door, -16), f = B.at(B.door, -1.5), inn = B.at(B.door, 2.5);cops(o, 2, {from: [{x: st.x - 2, z: st.z, path: [f, inn]}, {x: st.x + 2, z: st.z + 1, path: [f, inn]}]});}
          if ((o.timer -= dt) <= 0) {o.timer = null;o.phase = 'loot';o.obj = 'The vault is open. Take the bags (□).';api.vault(true);api.sfx('unlock', .8);}
        }
        if (o.phase === 'loot') o.sub = `Bags: ${o.bags} of 3`;
        if (o.phase === 'escape') {
          o.sub = `${Math.round(near)} m to the garage · bags: ${o.bags}`;
          if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 13;cops(o, 1);}
          if (near < 6) finish(o, 'win', `You got away with ${o.bags} bags.${o.hurtStaff ? ` ${o.hurtStaff} of the staff were hurt.` : ''}`, Math.max(0, 1500 * o.bags - 500 * (o.hurtStaff || 0)));
        }
      },
      prompt(o) {
        if (o.side !== 'robber' || distP(o.vaultAt.x, o.vaultAt.z) > 2.2) return null;
        if (o.phase === 'vault') return {text: '□ Start the drill (30 s)', act: () => {o.phase = 'drill';o.timer = 30;o.copT = 6;o.obj = 'Hold the bank until the drill is through.';api.sfx('alarm', .7);noGoal(o);}};
        if (o.phase === 'loot') return {text: `□ Take a bag of money (${o.bags + 1} of 3)`, act: () => {o.bags++;api.sfx('coin', .8);if (o.bags >= 3) {o.phase = 'escape';o.copT = 5;const g = tw(...data.getaway.at);o.obj = `Get away: the garage at ${data.getaway.address}. Any way you like.`;goal(o, g.x, g.z);}}};
        return null;
      },
      onDown(o, a, by) {
        if (by !== 'you') return;
        if (a.team === 'civil') {if (o.side === 'police') finish(o, 'fail', 'A hostage was shot.');else {o.hurtStaff = (o.hurtStaff || 0) + 1;ctx.notice('You hit one of the staff. That costs you 500 kr.', 4);}}
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
    SCRIPT.convoy = {
      start(o) {
        o.conv = {s: 0, speed: 0, wait: o.side === 'robber' ? 55 : 75, halted: false, alarm: false, out: false};
        o.trucks = [['car', 22], ['truck', 11], ['truck', 0]].map(([k, s0]) => {const v = truck(k);v.s0 = s0;v.y = null;group.add(v.g);return v;});this.place(o, 0);
        if (o.side === 'robber') {o.obj = 'The transport leaves Haarklous plass soon. Stop it before it reaches the bank.';o.phase = 'hunt';}
        else {
          o.blocks = data.convoy.ambush.map((am, k) => {
            const s = ROUTE.cum[am.i], p = routeAt(s), g = truck('truck').g;g.position.set(p.x, gy(p.x, p.z), p.z);g.rotation.y = p.yaw + Math.PI / 2;group.add(g);
            const men = ['ak47', 'r870', 'mp5', 'uzi'].map((w, i) => {const an = p.yaw + Math.PI + (i - 1.5) * .7, r = 5 + (i % 2) * 3, x = p.x - Math.sin(an) * r, z = p.z - Math.cos(an) * r;return actor(o, {team: 'crook', kind: 'robber', w, x, z, yaw: p.yaw + Math.PI, mask: true, hostile: true, skill: .38 + k * .06, sight: 55});});
            return {s, p, g, men, clear: false};
          });
          o.obj = 'Clear the two road blocks before the transport gets there.';o.phase = 'clear';goal(o, o.blocks[0].p.x, o.blocks[0].p.z);
        }
      },
      place(o, dt) {
        for (const v of o.trucks) {const p = routeAt(o.conv.s + v.s0), y = gy(p.x, p.z, v.y ?? undefined);v.x = p.x;v.z = p.z;v.yaw = p.yaw;v.y = v.y === null || !dt ? y : v.y + (y - v.y) * Math.min(1, dt * 8);v.g.position.set(v.x, v.y, v.z);v.g.rotation.y = v.yaw;}
      },
      guardsOut(o) {
        const c = o.conv;if (c.out) return;c.out = true;
        for (const v of o.trucks) for (const [w, side, back] of v.guards) {const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw), x = v.x + cs * side + sn * back, z = v.z - sn * side + cs * back;actor(o, {team: 'law', kind: v.kind === 'car' ? 'police' : 'guard', w, x, z, yaw: v.yaw, armour: .5, mode: 'assault', hostile: true, skill: .42, sight: 55, speed: 3.6, cap: v.kind === 'car' ? 0x0b0b0b : 0x1f2a44, crew: true});}
        api.sfx('carDoor', .8);
      },
      tick(o, dt) {
        const c = o.conv, lead = o.trucks[0];
        if (c.wait > 0) {c.wait -= dt;o.sub = `The transport leaves in ${Math.ceil(c.wait)} s.`;if (c.wait <= 0) ctx.notice('The money transport is on its way.', 4);}
        const dead = o.trucks.some(v => v.hp <= 0), ahead = routeAt(c.s + lead.s0 + 7), blockedByYou = o.side === 'robber' && distP(ahead.x, ahead.z) < 4.6;
        let hold = c.wait > 0 || dead || blockedByYou;
        if (o.side === 'police') {
          const blk = o.blocks.find(b => !b.clear);
          for (const b of o.blocks) if (!b.clear && b.men.every(m => !m.alive)) {b.clear = true;b.g.visible = false;api.sfx('cheer', .4);const n = o.blocks.find(q => !q.clear);if (n) {goal(o, n.p.x, n.p.z);ctx.notice('Road block cleared. One more.', 4);} else {noGoal(o);ctx.notice('Both road blocks are cleared.', 4);}}
          if (blk && c.s + lead.s0 > blk.s - 32) {
            hold = true;const n = blk.men.filter(m => m.alive).length, t = o.trucks[1];t.hp -= 1.2 * n * dt;o.sub = `The transport is under fire at the road block: truck ${Math.max(0, Math.round(t.hp / t.max * 100))} %`;
            if (t.hp <= 0) {finish(o, 'fail', 'The robbers broke into the transport.');return;}
          } else if (c.wait <= 0) o.sub = `Road blocks left: ${o.blocks.filter(b => !b.clear).length} · transport ${Math.round(c.s / (ROUTE.len - 24) * 100)} % of the way`;
          if (c.s + lead.s0 >= ROUTE.len - 2) {finish(o, 'win', 'The money is safe in the bank.', 3000);return;}
        } else {
          if (o.phase === 'hunt') {
            if ((o.wpT = (o.wpT || 0) - dt) <= 0) {o.wpT = 2;goal(o, lead.x, lead.z);}marker.position.set(lead.x, lead.y, lead.z);
            if (c.wait <= 0) o.sub = `Transport: ${Math.round(distP(lead.x, lead.z))} m away · ${Math.max(0, Math.round(ROUTE.len - c.s - lead.s0))} m from the bank`;
            if ((dead || blockedByYou) && c.wait <= 0) {c.halted = true;this.guardsOut(o);o.phase = 'fight';o.obj = 'The transport has stopped. Deal with the guards.';noGoal(o);}
            else if (c.s + lead.s0 >= ROUTE.len - 2) {finish(o, 'fail', 'The transport is in the bank\'s yard. Too late.');return;}
          }
          if (c.halted) hold = true;
          if (o.phase === 'fight') {o.sub = `Guards left: ${alive(o, a => a.crew)}`;if (!alive(o, a => a.crew)) {o.phase = 'breach';o.obj = 'Blow the back doors of the trucks (□) and take the bags.';o.copT = 14;}}
          if (o.phase === 'breach') {
            o.sub = `Bags: ${o.bags} of 4`;
            for (const v of o.trucks) if (v.fuse > 0 && (v.fuse -= dt) <= 0) {v.open = true;v.doors.visible = false;api.sfx('crash', .9);noise(o, v.x, v.z, 150);}
            if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 12;cops(o, 1);}
            if (o.bags >= 4) {o.phase = 'escape';const g = tw(...data.getaway.at);o.obj = `Get away: the garage at ${data.getaway.address}.`;goal(o, g.x, g.z);}
          }
          if (o.phase === 'escape') {
            const near = distP(o.goal.x, o.goal.z);o.sub = `${Math.round(near)} m to the garage · bags: ${o.bags}`;
            if ((o.copT -= dt) <= 0 && alive(o, a => a.cop) < 3) {o.copT = 13;cops(o, 1);}
            if (near < 6) {finish(o, 'win', `You got away with ${o.bags} bags.`, 1200 * o.bags);return;}
          }
        }
        c.speed += ((hold ? 0 : c.alarm ? 8.5 : 7) - c.speed) * Math.min(1, dt * (hold ? 3 : .8));c.s = Math.min(ROUTE.len - 22, c.s + c.speed * dt);this.place(o, dt);
      },
      prompt(o) {
        if (o.side !== 'robber' || o.phase !== 'breach') return null;
        for (const v of o.trucks) {
          if (v.kind !== 'truck') continue;const rx = v.x + Math.sin(v.yaw) * (v.L / 2 + .9), rz = v.z + Math.cos(v.yaw) * (v.L / 2 + .9);if (distP(rx, rz) > 2.4) continue;
          if (!v.open && !(v.fuse > 0)) return {text: '□ Set a charge on the back doors (4 s – step back)', act: () => {v.fuse = 4;api.sfx('beep', .7);}};
          if (v.open && v.bags > 0) return {text: `□ Take a bag of money (${v.bags} left in this truck)`, act: () => {v.bags--;o.bags++;api.sfx('coin', .8);}};
        }
        return null;
      },
      // Your shot against the vehicles (called for every shot of yours).
      hit(o, from, d, max, dmg) {
        if (o.side !== 'robber') return null;let best = null;
        for (const v of o.trucks) {const t = rayBox(v, from, d, max);if (t !== null && (!best || t < best.t)) best = {t, v};}
        if (best) {best.v.hp -= dmg * (best.v.kind === 'truck' ? 1 : 1.3);o.conv.alarm = true;if (best.v.hp <= 0 && !best.v.smoke) {best.v.smoke = true;api.sfx('crash', .6);ctx.notice(best.v.kind === 'truck' ? 'The truck is stopped.' : 'The escort car is stopped.', 3);}}
        return best ? best.t : null;
      },
      onNoise(o, x, z) {if (o.side === 'robber' && o.trucks.some(v => Math.hypot(v.x - x, v.z - z) < 35)) o.conv.alarm = true;}
    };

    // ---------- dealing ----------
    SCRIPT.deal = {
      start(o) {
        const spots = data.deal.spots.map(sp => ({...tw(...sp.at), face: sp.face, address: sp.address})), yawOf = h => {const p = tw(Math.sin(h), Math.cos(h)), q = tw(0, 0);return Math.atan2(-(p.x - q.x), -(p.z - q.z));};
        const order = spots.map((sp, i) => i).sort((a, b) => ((a * 7 + o.seed) % 9) - ((b * 7 + o.seed) % 9));
        if (o.side === 'robber') {
          o.customers = order.slice(0, 5).map(i => actor(o, {team: 'civil', kind: 'customer', mode: 'idle', x: spots[i].x, z: spots[i].z, yaw: yawOf(spots[i].face), address: spots[i].address, color: [0x6b6f76, 0x7a5a48, 0x4a5a78, 0x80704a, 0x5a5560][i % 5]}));
          for (const pt of data.deal.patrols) {const a = tw(...pt.a), b = tw(...pt.b);actor(o, {team: 'law', kind: 'police', w: 'g17', hidden: true, x: a.x, z: a.z, mode: 'patrol', pts: [a, b], sight: 38, skill: .45, speed: 5.3, armour: .5, cap: 0x0b0b0b, officer: true});}
          o.left = 5;o.cash = 0;o.heat = 0;o.chased = false;o.lost = 0;o.obj = 'Hand over the goods to the five customers. Do not let the police see it.';this.next(o);
        } else {
          o.dealers = [0, 1, 2].map(k => {const a = spots[order[k * 2]], b = spots[order[k * 2 + 1]], c = spots[order[(k * 2 + 2) % order.length]];
            for (const sp of [a, b]) actor(o, {team: 'civil', kind: 'customer', mode: 'idle', x: sp.x + .9, z: sp.z + .5, yaw: yawOf(sp.face)});
            return actor(o, {team: 'crook', kind: 'dealer', w: k === 1 ? 'g17' : null, hidden: true, x: a.x, z: a.z, mode: 'walk', pts: [a, b, c], speed: 1.5, sight: 26, skill: .35, dealer: true, wait: 6});});
          o.left = 3;o.obj = 'Find the three dealers and arrest them (□ right beside one).';this.next(o);
        }
      },
      next(o) {
        const list = (o.side === 'robber' ? o.customers.filter(c => !c.done) : o.dealers.filter(d => d.alive && !d.arrested)), p = P();
        if (!list.length) return;list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));o.target = list[0];goal(o, list[0].x, list[0].z);
      },
      tick(o, dt) {
        if (o.side === 'robber') {
          const officers = o.actors.filter(a => a.officer && a.alive);let seen = false, nearest = 1e9;
          for (const a of officers) {const d = Math.hypot(a.x - P().x, a.z - P().z);nearest = Math.min(nearest, d);if (a.see) {seen = true;if (!o.chase) o.heat += (o.dealing ? 75 : d < 14 ? 10 : d < 25 ? 3 : 0) * dt;}}
          if (!seen && !o.chase) o.heat = Math.max(0, o.heat - 4 * dt);
          if (o.heat >= 100 && !o.chase) {o.chase = true;o.chased = true;o.lost = 0;o.dealing = null;api.sfx('whistle', .7);ctx.notice('“Stopp! Politi!” – they have seen you. Run, and get out of sight.', 5);for (const a of officers) if (Math.hypot(a.x - P().x, a.z - P().z) < 170) {a.mode = o.hot ? 'assault' : 'chase';a.ti = -1;}}
          if (o.chase) {
            o.heat = 100;o.lost = seen || nearest < 30 ? 0 : o.lost + dt;
            if (!o.hot && officers.some(a => a.mode === 'chase' && Math.hypot(a.x - P().x, a.z - P().z) < 1.7 && Math.abs(a.y - P().feet) < 2)) {finish(o, 'fail', `Caught. The police took the goods${o.cash ? ` and the ${o.cash} kr` : ''}.`);return;}
            if (o.lost > 12 && !o.hot) {o.chase = false;o.heat = 45;ctx.notice('You lost them. Carry on, carefully.', 4);for (const a of officers) if (a.mode === 'chase') {a.mode = 'patrol';a.wait = 0;}}
          }
          if (o.dealing) {
            const c = o.dealing.c;if (distP(c.x, c.z) > 2.6 || (ctx.speed && ctx.speed() > 1.2)) {o.dealing = null;ctx.notice('You moved: the hand-over stopped.', 2);}
            else if ((o.dealing.t -= dt) <= 0) {c.done = true;c.mode = 'flee';c.speed = 1.6;c.gone = 6;o.dealing = null;o.left--;o.cash += 600;api.sfx('coin', .7);if (o.left <= 0) {finish(o, 'win', o.chased ? 'All five customers served.' : 'All five customers served, and the police never noticed.', o.cash + (o.chased ? 0 : 500));return;}this.next(o);}
          }
          for (const c of o.customers) if (c.gone > 0 && (c.gone -= dt) <= 0) {c.mode = 'idle';c.av.group.visible = false;c.alive = false;c.hidden = true;}
          o.sub = `Customers left: ${o.left} · ${o.cash} kr${o.dealing ? ` · handing over ${Math.ceil(o.dealing.t)} s` : ''}`;
        } else {
          for (const d of o.dealers) {
            if (!d.alive || d.arrested) continue;const dist = Math.hypot(d.x - P().x, d.z - P().z);
            if (d.hostile) {d.mode = 'post';continue;}
            if (d.see && dist < 24) {d.run = 4;}
            if (d.run > 0) {d.run -= dt;d.mode = 'flee';d.speed = 4.9;if (d.w && dist < 8) {d.hostile = true;d.hidden = false;d.gunModel.visible = true;d.mode = 'post';ctx.notice('He has a pistol!', 3);}}
            else {d.mode = 'walk';d.speed = 1.5;if (d.arrived) {d.arrived = false;d.hold = 8;}if (d.hold > 0) {d.hold -= dt;d.mode = 'idle';if (d.hold <= 0) d.pi = (d.pi + 1) % d.pts.length;}}
          }
          if ((o.wpT = (o.wpT || 0) - dt) <= 0) {o.wpT = 3;this.next(o);}
          o.sub = `Dealers left: ${o.left}${o.target ? ` · nearest ${Math.round(distP(o.target.x, o.target.z))} m` : ''}`;
        }
      },
      prompt(o) {
        if (o.side === 'robber') {
          if (o.dealing || o.chase) return null;const c = o.customers.find(c => !c.done && distP(c.x, c.z) < 2.2);
          return c ? {text: '□ Hand over the goods (stand still for 3 s)', act: () => {o.dealing = {c, t: 3};}} : null;
        }
        const d = o.dealers.find(d => d.alive && !d.arrested && !d.hostile && distP(d.x, d.z) < 2.3);
        return d ? {text: '□ Arrest', act: () => {d.arrested = true;d.mode = 'idle';d.stance = 'crouch';d.run = 0;o.left--;api.sfx('click', .8);ctx.notice('“Du er arrestert.” One less.', 3);if (o.left <= 0) finish(o, 'win', 'All three dealers are off the street.', 2000);else this.next(o);}} : null;
      },
      onDown(o, a, by) {
        if (by !== 'you') return;
        if (o.side === 'police') {if (a.dealer && a.w && a.wasHostile) {o.left--;if (o.left <= 0) finish(o, 'win', 'All three dealers are off the street.', 2000);else this.next(o);} else finish(o, 'fail', a.dealer ? 'You shot a man who was not shooting.' : 'You shot a bystander.');}
        else if (a.team === 'civil') finish(o, 'fail', 'You shot a customer.');
        else if (a.officer) o.hot = true;
      },
      onNoise(o, x, z, loud) {
        if (o.side !== 'robber' || loud < 40) return;
        if (o.actors.some(a => a.officer && a.alive && Math.hypot(a.x - x, a.z - z) < Math.min(110, loud))) {o.hot = true;o.heat = 100;for (const a of o.actors) if (a.officer && a.alive) {a.hostile = true;a.hidden = false;if (a.gunModel) a.gunModel.visible = true;if (o.chase) a.mode = 'assault';}}
      }
    };

    // ---------- start, end ----------
    function start(def) {
      if (def.id === 'hostage') {stop();ctx.startCase();return;}
      stop();
      const o = S.cur = {def, id: def.id, side: def.side, phase: '', t: 0, actors: [], trucks: [], obj: '', sub: '', timer: null, bags: 0, copT: 0, seed: Math.floor(Math.random() * 97), over: false};
      // Twice the spare magazines on a mission: nobody hands you more out there.
      S.guns = api.loadout().map(i => {const g = new W.Gun(W.weapon(i));g.reserve *= 2;return g;});S.sel = 0;S.hp = 100;S.hurtT = 99;S.trail = [{x: P().x, z: P().z}];S.result = null;api.vault(false);
      SCRIPT[def.id].start(o);if (S.cur === o) ctx.notice(`${def.name}. ${o.obj}`, 7);
    }
    function clear(o) {for (const a of o.actors) drop(a);for (const v of o.trucks) group.remove(v.g);for (const b of o.blocks || []) group.remove(b.g);marker.visible = false;ctx.waypoint(null);}
    function stop() {const o = S.cur;if (!o) return;clear(o);S.cur = null;api.vault(false);}
    function finish(o, result, text, pay = 0) {
      if (o.over) return;o.over = true;const win = result === 'win';
      S.result = {win, title: win ? `${o.def.name}: done` : `${o.def.name}: failed`, text, pay, t: 8};
      api.sfx(win ? 'cheer' : 'thud', .7);o.endT = win ? 2.5 : 1.2;o.home = !win;
    }

    function update(dt, input, foot) {
      if (S.result && (S.result.t -= dt) <= 0) S.result = null;
      S.dmgT = Math.max(0, S.dmgT - dt);S.hitT = Math.max(0, S.hitT - dt);
      const o = S.cur;if (!o) return;o.t += dt;
      if (o.over) {
        for (const a of o.actors) {a.hostile = false;stepActor(o, a, dt);}
        if ((o.endT -= dt) <= 0) {const pay = S.result ? S.result.pay : 0, home = o.home, name = o.def.name;stop();if (pay > 0) ctx.earn(pay, name);if (home) {const h = api.home();ctx.place(h.x, h.z, h.yaw);}}
        return;
      }
      // The way you came, for the ones who come after you.
      {const p = P(), last = S.trail[S.trail.length - 1];if (Math.hypot(p.x - last.x, p.z - last.z) > 2) {S.trail.push({x: p.x, z: p.z});if (S.trail.length > 500) {S.trail.shift();for (const a of o.actors) if (a.ti > 0) a.ti--;}}}
      S.hurtT += dt;if (S.hurtT > 5 && S.hp < 100) S.hp = Math.min(100, S.hp + 18 * dt);
      for (const a of o.actors) {if (a.hostile) a.wasHostile = true;stepActor(o, a, dt);}
      SCRIPT[o.id].tick(o, dt);
      if (S.cur !== o || o.over) return;
      // Your weapon.
      if (input.next) {S.sel = (S.sel + 1) % S.guns.length;api.sfx('click', .4);}
      const g = S.guns[S.sel], r = g.update(dt, input, foot);
      if (r.started) api.sfx('chains', .25);if (r.reloaded) api.sfx('click', .5);if (r.empty) api.sfx('pistolClick', .6);
      if (r.shots) api.fire(g);
    }
    // Your shot (o: the eye, d: where it goes): people, vehicles, walls. Returns where it ended and what it hit.
    function shot(from, d, w, seed) {
      const o = S.cur;if (!o) return null;const max = w.melee || (w.r1 * 1.6 + 40), ends = [];let any = false;
      for (const pd of W.pelletDirs(w, d, seed)) {
        let end = Math.min(max, ctx.blockDist(from, pd, max)), who = null;
        for (const a of o.actors) {if (!a.alive || a.hidden === true && a.kind === 'customer') continue;const h = W.rayFigure(from, pd, end, {x: a.x, y: a.y, z: a.z}, a.stance, a.yaw);if (h) {end = h.t;who = {a, h};}}
        const sc = SCRIPT[o.id];if (sc.hit) {const t = sc.hit(o, from, pd, end, W.damageAt(w, 20));if (t !== null) {end = t;who = null;any = true;}}
        if (who) {any = true;const a = who.a;a.hp -= W.damageAt(w, who.h.t, who.h.head, a.armour);a.alert = {x: P().x, z: P().z, t: 10};a.cool = Math.max(a.cool, .35);if (a.hp <= 0) down(o, a);else if (a.mode === 'civil' || a.mode === 'idle') o.scared = true;}
        ends.push(end);
      }
      if (any) S.hitT = .25;noise(o, P().x, P().z, w.loud);
      return ends;
    }
    function prompt() {const o = S.cur;if (!o || o.over || P().mode !== 'foot') return null;const sc = SCRIPT[o.id];return sc.prompt ? sc.prompt(o) : null;}
    // The convoy's vehicles are solid for you and your car.
    function solids() {
      const o = S.cur;if (!o || !o.trucks.length) return [];
      return o.trucks.map(v => {const c = Math.cos(v.yaw), s = Math.sin(v.yaw), hw = v.Wd / 2, hl = v.L / 2;return {points: [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([a, b]) => ({x: v.x + c * a + s * b, z: v.z - s * a + c * b})), minY: v.y - .5, maxY: v.y + v.H, kind: 'convoy'};});
    }
    return {start, stop, update, shot, prompt, solids, MISSIONS, get cur() {return S.cur;}, get hp() {return S.hp;}, get result() {return S.result;}, get dmgT() {return S.dmgT;}, get dmgFrom() {return S.dmgFrom;}, get hitT() {return S.hitT;},
      gun: () => S.cur ? S.guns[S.sel] : null, state: S,
      debug: {actors: () => S.cur ? S.cur.actors : [], finish: (r, t, p) => S.cur && finish(S.cur, r, t, p), down: a => S.cur && down(S.cur, a), route: ROUTE}};
  }
  return {MISSIONS, create};
});
