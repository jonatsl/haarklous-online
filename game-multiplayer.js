/* Multiplayer glue between the game and the lobby (game-net.js): remote players as avatars (on foot, on the firepit
 * benches, in vehicle seats, flying a drone), vehicles driven by other players (smoothed between their updates), seat
 * claims (one driver and one passenger per vehicle), chat, doors and the shared firepit level.
 * Remote-driven vehicles (issue #135): the driver appends its clock (performance.now() ms) to each 'vs' state; here every such
 * vehicle has a GameNetSmooth.Track and is posed only from it, once a frame (game-main skips its own physics for it).
 * GameMultiplayer.create(ctx) -> {net, voice, update(dt), claim(i, seat) -> Promise<{ok, by}>, release(i, seat, final),
 *   occupant(i, seat), remoteDriven(i), sendChat(text), sendDoor(id, open), sendObj(id, v), addWood(), fireLevel(), remotes, nameOf(id),
 *   sitTaken(spotId), setMic(on)}
 * ctx: {T, lib, scene, camera, vehicles, localState(), drivingIndex(), listener(), applyDoor(id, open, instant), applyObj(id, v), resetObjs(), onChat(line, mine),
 *   onStatus(), notice(text, s), fireDecayS, fireMax}
 */
(function (root, factory) {
  root.GameMultiplayer = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function create(ctx) {
    const {T, lib, scene, vehicles} = ctx, avatars = window.GameAvatars.create({T, lib});
    const remotes = new Map();// id -> {id, slot, name, st, av, pos, yaw, speed, drone}
    let occ = {}, fire = {level: 2, t: Date.now()}, sendT = 0, vehT = 0, lastLocal = null;
    const pending = new Map();// vehicle index -> resolve
    const NS = window.GameNetSmooth, tracks = new Map();// index -> {track, by (the driver's id), len (the state's own length)}
    // A state with one number more than this vehicle's own netGet() carries the driver's clock (ms) at the end.
    const netLen = v => v.netLen || (v.netLen = v.netGet().length);
    const stamped = s => [...s, Math.round(performance.now())];
    const net = window.GameNet.create({onMessage, onStatus: () => ctx.onStatus()});
    const voice = window.GameVoice.create({send: (to, d) => net.send({t: 'rtc', to, d}), you: () => net.you, context: () => ctx.audioContext && ctx.audioContext()});
    function remote(id) {
      let r = remotes.get(id);if (r) return r;const p = net.players.get(id) || {slot: 0, name: 'Player'};
      const av = avatars.avatar(p.slot, p.name);av.group.visible = false;scene.add(av.group);
      r = {id, slot: p.slot, name: p.name, st: null, av, pos: new T.Vector3(), yaw: 0, speed: 0, drone: null, seen: false};remotes.set(id, r);return r;
    }
    function drop(id) {const r = remotes.get(id);if (!r) return;scene.remove(r.av.group);r.av.dispose();if (r.drone) scene.remove(r.drone);remotes.delete(id);voice.peerLeft(id);}
    function onMessage(m) {
      switch (m.t) {
        case 'welcome':
          for (const id of [...remotes.keys()]) drop(id);
          for (const p of m.players) if (p.id !== m.you) {remote(p.id);voice.peerJoined(p.id);}
          for (const [id, s] of Object.entries(m.states || {})) {const r = remote(+id);r.st = s;}
          occ = m.occ || {};fire = m.fire || fire;tracks.clear();
          for (const [i, s] of Object.entries(m.vehicles || {})) {const v = vehicles[+i];if (v && s) v.netSet(s);}
          for (const [id, open] of Object.entries(m.doors || {})) ctx.applyDoor(id, open, true);
          // Small shared things (flat 501's record player, TV, lava lamp, chairs): back to normal, then the lobby's state.
          if (ctx.resetObjs) ctx.resetObjs(m);if (ctx.applyObj) for (const [id, v] of Object.entries(m.objs || {})) ctx.applyObj(id, v);
          for (const line of m.chat || []) ctx.onChat(line, false, true);
          if (voice.mic) net.send({t: 'mic', on: true});
          ctx.notice(m.players.length > 1 ? `Joined lobby ${m.code} · ${m.players.length} players` : `Online · your lobby code is ${m.code}`, 4);
          break;
        case 'join': remote(m.id).av.setName(m.name);voice.peerJoined(m.id);ctx.notice(`${m.name} joined`, 3);ctx.onChat({name: m.name, text: 'joined the lobby', slot: m.slot, sys: true}, false);break;
        case 'leave': {const r = remotes.get(m.id);if (r) ctx.onChat({name: r.name, text: 'left', slot: r.slot, sys: true}, false);drop(m.id);break;}
        case 'name': {const r = remotes.get(m.id);if (r) {r.name = m.name;r.av.setName(m.name);}break;}
        case 'st': {const r = remote(m.id);r.st = m.s;break;}
        case 'vs': {
          const i = +m.v, v = vehicles[i], s = m.s;if (!v || !Array.isArray(s)) break;const o = occ[i];
          if (o && o.d && o.d !== net.you) {
            let t = tracks.get(i);const len = netLen(v);
            if (!t || t.by !== o.d) {t = {track: new NS.Track(NS.layout(len, !!v.aircraft)), by: o.d, len};tracks.set(i, t);}
            t.track.push(s, s.length === len + 1 ? s[len] / 1000 : null, performance.now() / 1000);
          } else if (ctx.drivingIndex() !== i) v.netSet(s);
          break;
        }
        case 'occ': {
          const before = occ;occ = m.occ || {};
          // A driver got off: the vehicle stays where their last update put it (not where the smoothing had got to).
          for (const [i, o] of Object.entries(before)) if (o.d && o.d !== net.you && !(occ[i] && occ[i].d === o.d)) settle(+i);
          break;
        }
        case 'claim': {if (m.ok) (occ[m.v] || (occ[m.v] = {}))[m.seat] = net.you;const res = pending.get(+m.v);if (res) {pending.delete(+m.v);res({ok: m.ok, by: m.by});}break;}// a granted seat is ours at once
        case 'chat': {const mine = m.id === net.you;ctx.onChat(m, mine);if (!mine) {const r = remotes.get(m.id);if (r) r.av.say(m.text);}break;}
        case 'door': ctx.applyDoor(m.id, m.open, false);break;
        case 'obj': if (ctx.applyObj) ctx.applyObj(m.id, m.v);break;
        case 'fire': fire = m.fire;if (m.by && m.by !== net.you) {const r = remotes.get(m.by);if (r && ctx.onRemoteWood) ctx.onRemoteWood(r);}break;
        case 'rtc': voice.onSignal(m.from, m.d);break;
        case 'full': ctx.notice(`Lobby ${m.code || ''} is full (${net.max} players). Back in your own lobby.`, 5);break;
        case 'reset': for (const id of [...remotes.keys()]) drop(id);occ = {};tracks.clear();for (const [, res] of pending) res({ok: true, offline: true});pending.clear();break;
      }
    }
    function settle(i) {const t = tracks.get(i), v = vehicles[i];if (t && v && t.track.count) v.netSet(t.track.newest);tracks.delete(i);}
    // Seats: online the lobby decides who gets a seat; offline every seat is yours.
    function claim(i, seat) {
      if (!net.online) return Promise.resolve({ok: true});
      return new Promise(res => {pending.set(i, res);net.send({t: 'claim', v: i, seat});setTimeout(() => {if (pending.get(i) === res) {pending.delete(i);res({ok: false, timeout: true});}}, 4000);});
    }
    function release(i, seat, final) {if (net.online) net.send({t: 'release', v: i, seat, s: final ? stamped(final) : final});const o = occ[i];if (o && o[seat] === net.you) delete o[seat];}
    const occupant = (i, seat) => {const o = occ[i];return o ? o[seat] || null : null;};
    const remoteDriven = i => {const d = occupant(i, 'd');return !!d && d !== net.you && remotes.has(d);};
    const nameOf = id => id === net.you ? net.name : (remotes.get(id) || {}).name || 'someone';
    function sitTaken(spotId) {for (const r of remotes.values()) if (r.st && r.st.sit === spotId + 1) return true;return false;}
    function fireLevel() {const now = net.online ? net.serverNow() : Date.now();return Math.max(0, fire.level - (now - fire.t) / (ctx.fireDecayS * 1000));}
    function addWood() {
      const now = net.online ? net.serverNow() : Date.now();fire = {level: Math.min(ctx.fireMax, fireLevel() + 1), t: now};
      if (net.online) net.send({t: 'fire'});
    }
    const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
    // Remote-driven vehicle: the one pose it gets this frame, from its snapshot buffer (game-netsmooth.js).
    function smoothVehicle(v, t, now, dt) {const a = t.track.sample(now);if (!a) return;v.netSet(a);v.netAnimate(dt);}
    function update(dt) {
      const now = performance.now(), cam = ctx.camera;
      // Send our own state ~10 Hz (only when somebody else is in the lobby).
      sendT -= dt;vehT -= dt;
      if (net.online && net.others > 0) {
        if (sendT <= 0) {sendT = .1;const s = ctx.localState();lastLocal = s;net.send({t: 'st', s});}
        const di = ctx.drivingIndex();if (di >= 0 && vehT <= 0) {vehT = 1 / 12;net.send({t: 'vs', v: di, s: stamped(vehicles[di].netGet())});}
      }
      // Vehicles driven by others.
      const ns = now / 1000;for (const [i, t] of tracks) {const v = vehicles[i];if (!v || !remoteDriven(i)) {settle(i);continue;}smoothVehicle(v, t, ns, dt);}
      // Avatars.
      for (const r of remotes.values()) {
        const st = r.st;if (!st) {r.av.group.visible = false;continue;}
        const g = r.av.group;g.visible = true;let stance = st.st || 'stand';
        const vi = st.v ?? -1, anchor = vi >= 0 && vehicles[vi] ? vehicles[vi].hipAnchor(st.s) : st.ja != null && ctx.autoAnchor ? ctx.autoAnchor(st.ja) : null;
        if (anchor) {
          anchor.obj.updateWorldMatrix(true, false);g.position.copy(anchor.obj.localToWorld(anchor.pos.clone()));g.quaternion.copy(anchor.obj.getWorldQuaternion(new T.Quaternion()));if (anchor.yaw) g.rotateY(anchor.yaw);stance = anchor.stance;r.pos.copy(g.position);r.speed = stance === 'cycle' ? Math.abs(vehicles[vi].speed || 0) : 0;
        } else {
          const target = new T.Vector3(st.p[0], st.p[1], st.p[2]);
          if (!r.seen || r.pos.distanceTo(target) > 12) r.pos.copy(target);
          const before = r.pos.clone(), k = 1 - Math.exp(-dt * 10);r.pos.lerp(target, k);r.yaw = angLerp(r.yaw, st.y || 0, k);
          r.speed += ((dt > 0 ? before.distanceTo(r.pos) / dt : 0) - r.speed) * Math.min(1, dt * 6);
          g.position.copy(r.pos);g.quaternion.setFromEuler(new T.Euler(0, r.yaw, 0));
          if (ctx.skyPose) ctx.skyPose(r, st, g);// skydiving: belly-down in freefall, a canopy over them (game-main)
          if (st.sit) stance = 'sit';
        }
        r.seen = true;r.av.pose({stance, speed: stance === 'stand' || stance === 'crouch' || stance === 'prone' || stance === 'climb' || stance === 'cycle' ? r.speed : 0, dt, beer: !!st.b, jump: !!st.j && !anchor, marker: ctx.holdsMarker ? ctx.holdsMarker(r.id) : false});r.av.update(dt, cam, ctx.showTag ? ctx.showTag(r.id) : true);
        // Their drone.
        if (st.dr) {if (!r.drone) {r.drone = avatars.drone();scene.add(r.drone);}r.drone.visible = true;r.drone.position.set(st.dr[0], st.dr[1], st.dr[2]);r.drone.quaternion.set(st.dr[3], st.dr[4], st.dr[5], st.dr[6]);}
        else if (r.drone) r.drone.visible = false;
      }
    }
    return {
      net, voice, update, claim, release, occupant, remoteDriven, nameOf, sitTaken, fireLevel, addWood, remotes,
      sendChat(text) {text = String(text || '').trim().slice(0, 200);if (!text) return false;if (net.online) {net.send({t: 'chat', text});return true;}ctx.onChat({name: net.name, text, slot: 0}, true);return false;},
      sendDoor(id, open) {if (net.online) net.send({t: 'door', id, open});},
      // A small shared thing: id -> a small value (null removes it); the lobby keeps it for players who join later.
      sendObj(id, v) {if (net.online) net.send({t: 'obj', id, v: v ?? null});},
      async setMic(on) {const ok = await voice.setMic(on);if (ok && net.online) net.send({t: 'mic', on: voice.mic});return ok;},
      get occ() {return occ;}
    };
  }
  return {create};
});
