/* Table tennis at Schous plass (issue #44): an outdoor concrete table in the park, played against Ola, who waits there.
 * Real rules: games to 11 (win by 2), two serves each (one each from 10–10), the serve bounces on your own half first, every
 * return must bounce once on the other half; the net, out balls and double bounces lose the point.
 * Controls: left stick / A D move along your end (you drift toward the ball); R2 / left mouse swing – timing matters: early
 * pulls the ball cross-court, late pushes it down the line; aim with the camera (right stick / mouse); hold L2 for a smash
 * (faster, riskier); R2 also serves; ○ quits.
 * Pure (Node-tested): GameTableTennis.Match (score, serve order, winner), GameTableTennis.Rally (ball flight, bounces, net,
 *   who lost the point), GameTableTennis.solveShot(from, target, time) (initial velocity with drag), TABLE (sizes).
 * Browser: GameTableTennis.create({T, lib, world, audio, root, at: {x, s}, bearing}) -> minigame
 *   {group, obstacles, near(p), start(p), update(dt, input, camera), stop(), active, music, poi()}.
 * Table frame: u along the table (you at u < 0, Ola at u > 0), v across, y up from the ground under the table.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameTableTennis = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const TABLE = {L: 2.74, W: 1.525, H: .76, net: .1525, netOut: .1525, r: .02};
  const G = 9.81, DRAG = .14, E = .88, FRICTION = .94;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const other = w => w === 'you' ? 'npc' : 'you';
  const half = u => u < 0 ? 'you' : 'npc';

  // ---------- Scoring ----------
  class Match {
    constructor(first = 'you') {this.score = {you: 0, npc: 0};this.first = first;this.winner = null;}
    get server() {const n = this.score.you + this.score.npc, deuce = this.score.you >= 10 && this.score.npc >= 10, k = deuce ? 20 / 2 + (n - 20) : Math.floor(n / 2);return k % 2 === 0 ? this.first : other(this.first);}
    point(to) {
      if (this.winner) return this.winner;this.score[to]++;
      const a = this.score[to], b = this.score[other(to)];if (a >= 11 && a - b >= 2) this.winner = to;
      return this.winner;
    }
  }

  // ---------- The ball ----------
  function stepBall(b, dt) {
    const sp = Math.hypot(b.vu, b.vy, b.vv), k = DRAG * sp;
    b.vu -= b.vu * k * dt;b.vv -= b.vv * k * dt;b.vy -= (G + b.vy * k) * dt;
    b.u += b.vu * dt;b.y += b.vy * dt;b.v += b.vv * dt;
  }
  // Initial velocity from `from` that lands on `target` (y = table top) after about `time` seconds, with drag (shooting method).
  function solveShot(from, target, time) {
    let vu = (target.u - from.u) / time, vv = (target.v - from.v) / time, vy = (TABLE.H + TABLE.r - from.y + .5 * G * time * time) / time;
    for (let it = 0; it < 6; it++) {
      const b = {u: from.u, y: from.y, v: from.v, vu, vy, vv};let t = 0;
      while (t < time * 2 + .5) {stepBall(b, .002);t += .002;if (b.vy < 0 && b.y <= TABLE.H + TABLE.r) break;}
      vu += (target.u - b.u) / time;vv += (target.v - b.v) / time;vy += (TABLE.H + TABLE.r - b.y) / time * .5 + (time - t) * G * .5;
    }
    return {vu, vy, vv};
  }
  // Height of a flight over the net (u = 0), or null if it never gets there.
  function heightAtNet(from, vel) {
    const b = {...from, ...vel};
    for (let t = 0; t < 2; t += .002) {const u0 = b.u;stepBall(b, .002);if ((u0 < 0) !== (b.u < 0)) return b.y;if (b.y < TABLE.H) return null;}
    return null;
  }

  // A serve from `from`: first bounce on the server's half near `bounce`, then over the net onto the other half. Tries
  // flight times until the whole flight (with its bounce) clears the net and lands; returns the velocity.
  function serveShot(from, bounce, aimV = 0) {
    const dir = from.u < 0 ? 1 : -1, who = dir > 0 ? 'you' : 'npc', opp = dir > 0 ? 'npc' : 'you';let best = null;
    for (const du of [0, .15, -.15, .3, -.3]) for (let time = .12; time < .46; time += .03) {
      const target = {u: bounce.u + du * dir, v: bounce.v}, vel = solveShot(from, target, time);vel.vv += (aimV - bounce.v) * .9;
      const r = new Rally(who);r.ball = {...from, vu: 0, vy: 0, vv: 0};r.hit(who, vel);
      for (let t = 0; t < 2.5 && !r.over; t += .004) {r.step(.004);if (r.bounces[opp] === 1) return vel;}
      best = best || vel;
    }
    return best;
  }
  // One rally: the ball in flight, its bounces and who loses the point. hit(by, vel) after a legal hit; step(dt) -> events.
  class Rally {
    constructor(server) {this.server = server;this.ball = null;this.lastHit = null;this.serving = true;this.bounces = {you: 0, npc: 0};this.over = null;this.hits = 0;}
    toss(pos) {this.ball = {...pos, vu: 0, vy: 1.4, vv: 0};this.tossed = true;}
    hit(by, vel) {
      if (this.over) return;
      // Hitting before the ball has bounced on your side (once) is not allowed, except the serve.
      if (!(this.serving && this.hits === 0) && this.bounces[by] !== 1) {this.over = {loser: by, why: 'hit before the bounce'};return;}
      Object.assign(this.ball, vel);this.lastHit = by;this.bounces = {you: 0, npc: 0};this.hits++;
      if (this.hits > 1) this.serving = false;
    }
    step(dt) {
      const ev = [];if (this.over || !this.ball || !this.lastHit) return ev;
      const b = this.ball, u0 = b.u, y0 = b.y;stepBall(b, dt);
      const top = TABLE.H + TABLE.r, onTable = Math.abs(b.u) <= TABLE.L / 2 && Math.abs(b.v) <= TABLE.W / 2;
      // The net: a thin wall at u = 0 up to 15.25 cm above the table, 15.25 cm beyond each side.
      if ((u0 < 0) !== (b.u < 0) && Math.abs(b.v) < TABLE.W / 2 + TABLE.netOut) {
        const y = y0 + (b.y - y0) * Math.abs(u0) / Math.abs(b.u - u0 || 1);
        if (y < top + TABLE.net && y > TABLE.H - .05) {b.u = u0 < 0 ? -.03 : .03;b.vu *= -.15;b.vv *= .3;this.over = {loser: this.lastHit, why: 'into the net'};ev.push({kind: 'net'}, {kind: 'over', ...this.over});return ev;}
      }
      if (b.vy < 0 && b.y <= top && y0 > top - .05 && onTable) {
        b.y = top;b.vy = -b.vy * E;b.vu *= FRICTION;b.vv *= FRICTION;const side = half(b.u);this.bounces[side]++;ev.push({kind: 'bounce', side});
        const hitter = this.lastHit, opp = other(hitter);
        if (this.serving && this.hits === 1) {
          // The serve: first on the server's half, then on the receiver's.
          if (side === hitter && this.bounces[hitter] > 1) this.over = {loser: hitter, why: 'serve bounced twice on your side'};
          else if (side === opp && this.bounces[hitter] === 0) this.over = {loser: hitter, why: 'serve must bounce on your own side first'};
          else if (side === opp && this.bounces[opp] > 1) this.over = {loser: opp, why: 'double bounce'};
        } else {
          if (side === hitter) this.over = {loser: hitter, why: 'bounced on your own side'};
          else if (this.bounces[opp] > 1) this.over = {loser: opp, why: 'double bounce'};
        }
      }
      // The ground: whoever had to play it last loses.
      if (b.y <= .02) {
        const hitter = this.lastHit, opp = other(hitter);
        const reachedOpp = this.serving && this.hits === 1 ? this.bounces[opp] >= 1 : this.bounces[opp] >= 1;
        this.over = reachedOpp ? {loser: opp, why: 'missed it'} : {loser: hitter, why: 'out'};
        ev.push({kind: 'ground'});
      }
      if (this.over) ev.push({kind: 'over', ...this.over});
      return ev;
    }
  }

  // ---------- Browser ----------
  function create({T, lib, world, audio, root, at, bearing = 0, npcName = 'Ola'}) {
    const group = new T.Group();group.name = 'Table tennis, Schous plass';
    const c = world.toWorld(at.x, at.s), y0 = (() => {let m = -Infinity;for (const du of [-1.6, 1.6]) for (const dv of [-.9, .9]) {const p = frameToWorld(du, dv);m = Math.max(m, world.heightWorld(p.x, p.z));}return m;})();
    // Table frame -> world: u along `bearing` (degrees from north, clockwise) in the local map frame.
    function frameToWorld(u, v) {const b = bearing * Math.PI / 180, ex = Math.sin(b), es = -Math.cos(b), lx = at.x + ex * u - es * v, ls = at.s + es * u + ex * v;return world.toWorld(lx, ls);}
    const P0 = frameToWorld(0, 0), PU = frameToWorld(1, 0), ux = PU.x - P0.x, uz = PU.z - P0.z, vx = -uz, vz = ux;
    const W = (u, y, v) => new T.Vector3(c.x + ux * u + vx * v, y0 + y, c.z + uz * u + vz * v);
    const frame = new T.Group();frame.position.set(c.x, y0, c.z);frame.rotation.y = Math.atan2(-uz, ux);group.add(frame);// local x = u, local z = v
    // Concrete table with a steel net, a pad of paving round it.
    const conc = lib.concrete(0x8f9a8e), white = new T.MeshStandardMaterial({color: 0xf2f2ee, roughness: .6}), steel = lib.metal(0x3b4146, .45);
    const add = (geo, mat, x, y, z, parent = frame) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.castShadow = m.receiveShadow = true;parent.add(m);return m;};
    add(new T.BoxGeometry(TABLE.L, .08, TABLE.W), conc, 0, TABLE.H - .04, 0);
    for (const [w, d, x, z] of [[TABLE.L, .02, 0, TABLE.W / 2 - .01], [TABLE.L, .02, 0, -TABLE.W / 2 + .01], [.02, TABLE.W, TABLE.L / 2 - .01, 0], [.02, TABLE.W, -TABLE.L / 2 + .01, 0], [TABLE.L, .003, 0, 0]]) add(new T.BoxGeometry(w, .004, d), white, x, TABLE.H + .002, z).castShadow = false;
    add(new T.BoxGeometry(.5, TABLE.H - .08, 1.1), conc, 0, (TABLE.H - .08) / 2, 0);
    const net = add(new T.BoxGeometry(.012, TABLE.net, TABLE.W + 2 * TABLE.netOut), steel, 0, TABLE.H + TABLE.net / 2, 0);void net;
    const pad = new T.Mesh(new T.PlaneGeometry(TABLE.L + 6, TABLE.W + 4), lib.concrete(0x9c978d));pad.rotation.x = -Math.PI / 2;pad.position.y = .015;pad.receiveShadow = true;frame.add(pad);
    const obstacles = [{points: [[-TABLE.L / 2, -TABLE.W / 2], [TABLE.L / 2, -TABLE.W / 2], [TABLE.L / 2, TABLE.W / 2], [-TABLE.L / 2, TABLE.W / 2]].map(([u, v]) => {const p = W(u, 0, v);return {x: p.x, z: p.z};}), minY: y0 - .3, maxY: y0 + TABLE.H + .2, kind: 'pingpong'}];
    // Paddles: red rubber on a wooden blade.
    function paddleMesh() {const g = new T.Group(), blade = new T.Mesh(new T.CylinderGeometry(.075, .075, .012, 24), new T.MeshStandardMaterial({color: 0xb3221b, roughness: .7}));blade.rotation.x = Math.PI / 2;blade.scale.set(1, 1, 1.12);g.add(blade);const h = new T.Mesh(new T.BoxGeometry(.028, .1, .022), lib.wood(0x9b6b43));h.position.y = -.12;g.add(h);g.traverse(o => {o.castShadow = true;});return g;}
    const myPaddle = paddleMesh();myPaddle.visible = false;group.add(myPaddle);
    const ballMesh = new T.Mesh(new T.SphereGeometry(TABLE.r, 14, 10), new T.MeshStandardMaterial({color: 0xff8a1f, roughness: .4}));ballMesh.castShadow = true;ballMesh.visible = false;group.add(ballMesh);
    // Ola: a player avatar with a paddle in the right hand.
    const av = window.GameAvatars.create({T, lib}).avatar(1, npcName, 0x2a6f97);frame.add(av.group);
    const npcPaddle = paddleMesh();av.joints.R.el.add(npcPaddle);npcPaddle.position.set(0, -.34, -.04);npcPaddle.rotation.set(-1.2, 0, 0);
    const npcHome = {u: TABLE.L / 2 + .75, v: .1};av.group.position.set(npcHome.u, 0, npcHome.v);av.group.rotation.y = Math.PI / 2;// face -u
    // HUD card.
    const hud = document.createElement('div');hud.id = 'pingHud';hud.className = 'game-card';hud.hidden = true;(root || document.body).append(hud);

    const game = {group, obstacles, active: false, music: 'discgolf', name: 'Table tennis'};
    let match = null, rally = null, me = {v: 0, swing: -1, held: false}, npc = {v: npcHome.v, swing: -1, plan: null, react: 0}, pause = 0, msg = '', serveWait = 0, last = null;
    const npcSkill = {miss: .07, error: .06};
    game.near = p => {const l = toFrame(p.x, p.z);return Math.abs(l.u) < TABLE.L / 2 + 2.2 && Math.abs(l.v) < TABLE.W / 2 + 1.8 && Math.abs(p.y - y0) < 1.5 ? `□ Play table tennis against ${npcName} (first to 11)` : null;};
    function toFrame(x, z) {const dx = x - c.x, dz = z - c.z, l = Math.hypot(ux, uz);return {u: (dx * ux + dz * uz) / (l * l), v: (dx * vx + dz * vz) / (l * l)};}
    const myU = -TABLE.L / 2 - .55;
    game.start = () => {
      game.active = true;match = new Match(Math.random() < .5 ? 'you' : 'npc');me = {v: 0, swing: -1, held: false};newRally();msg = `First to 11 · ${match.server === 'you' ? 'your serve' : npcName + ' serves'}`;
      const p = W(myU, 0, 0), look = W(0, 0, 0);
      return {x: p.x, z: p.z, yaw: Math.atan2(-(look.x - p.x), -(look.z - p.z))};
    };
    game.stop = () => {game.active = false;hud.hidden = true;ballMesh.visible = false;myPaddle.visible = false;rally = null;av.group.position.set(npcHome.u, 0, npcHome.v);};
    function newRally() {rally = new Rally(match.server);rally.ball = null;serveWait = match.server === 'npc' ? 1.2 : 0;npc.plan = null;ballMesh.visible = false;}
    // Ball position in the frame for the server's toss.
    const tossPos = who => ({u: who === 'you' ? -TABLE.L / 2 - .25 : TABLE.L / 2 + .25, y: TABLE.H + .3, v: who === 'you' ? me.v + .25 : npc.v - .25});
    function serve(who, aimV = 0, smash = false) {
      const p = tossPos(who), dir = who === 'you' ? 1 : -1;rally.ball = {...p, vu: 0, vy: 0, vv: 0};
      const bounce = {u: -dir * (.85 + Math.random() * .2), v: clamp(p.v * .6 + aimV * .2, -.6, .6)};
      // The serve: onto your own half first; the bounce carries it over the net (a faster flight with L2).
      const vel = serveShot(p, bounce, aimV);if (smash) {vel.vu *= 1.08;vel.vv *= 1.08;}
      rally.lastHit = null;rally.hit(who, vel);audioHit();
    }
    function audioHit() {if (audio && audio.sfx) audio.sfx('pingHit', {gain: .7});}
    // A return from (pos) by `who` to a point on the other half, with errors.
    function shot(who, pos, aim) {
      const dir = who === 'you' ? 1 : -1, smash = aim.smash, depth = smash ? .95 + Math.random() * .25 : .55 + Math.random() * .6;
      let tu = dir * depth, tv = clamp(aim.v, -.7, .7);
      const err = aim.err || 0;tu += (Math.random() - .5) * err * 1.2;tv += (Math.random() - .5) * err * 1.6 + (aim.timing || 0) * .35;
      const time = (smash ? .3 : .52 + Math.random() * .12) * clamp(Math.abs(tu - pos.u) / 2.2, .7, 1.4);
      let vel = solveShot(pos, {u: tu, v: tv}, time);
      // Clear the net (unless the error says otherwise): lift the flight until it passes 6 cm over.
      for (let k = 0; k < 8; k++) {const h = heightAtNet(pos, vel);if (h !== null && h > TABLE.H + TABLE.net + .06 - (err > .5 ? .1 : 0)) break;vel = solveShot(pos, {u: tu, v: tv}, time * (1.08 + k * .06));}
      rally.hit(who, vel);audioHit();
    }
    function endPoint(over) {
      const winner = other(over.loser);match.point(winner);
      msg = `${winner === 'you' ? 'Your point' : npcName + '’s point'} (${over.why}) · ${match.score.you}–${match.score.npc}`;
      if (audio && audio.sfx && winner === 'you') audio.sfx('coin', {gain: .3});
      pause = match.winner ? 3.5 : 1.6;
    }
    // Where the ball will be when it reaches the plane u = target (after any bounce), for moving to it.
    function predict(b, uPlane) {
      const s = {...b}, top = TABLE.H + TABLE.r;
      for (let t = 0; t < 2.5; t += .01) {const y0_ = s.y;stepBall(s, .01);if (s.vy < 0 && s.y <= top && y0_ > top - .05 && Math.abs(s.u) <= TABLE.L / 2 && Math.abs(s.v) <= TABLE.W / 2) {s.y = top;s.vy = -s.vy * E;s.vu *= FRICTION;s.vv *= FRICTION;}if ((s.u - uPlane) * Math.sign(b.vu) >= 0) return {v: s.v, y: s.y, t};if (s.y < 0) break;}
      return null;
    }
    game.update = (dt, input, camera) => {
      if (!game.active) return {};
      if (input.cancel) {const m = `Table tennis stopped at ${match.score.you}–${match.score.npc}.`;game.stop();return {done: m};}
      const out = {};
      // Swing: R2 / left mouse pressed (the charge starts from zero).
      const held = input.charge > 0, pressed = held && !me.held;me.held = held;
      // Move along your end: the stick, plus a pull toward where the ball will cross your hitting plane.
      const b = rally && rally.ball;let assist = 0;
      if (b && rally.lastHit === 'npc' && b.vu < 0) {const p = predict(b, myU + .3);if (p) assist = clamp((p.v - .22 - me.v) * 2.2, -1, 1);}
      me.v = clamp(me.v + (clamp(input.hyzer || 0, -1, 1) * 2.6 + assist * 1.6) * dt, -1.6, 1.6);
      const stand = W(myU, 0, me.v);out.stand = {x: stand.x, z: stand.z, y: y0};
      if (pressed) me.swing = 0;
      if (me.swing >= 0) {me.swing += dt;if (me.swing > .3) me.swing = -1;}
      // Aim: where the camera points across the far half.
      const fwd = camera ? camera.getWorldDirection(new T.Vector3()) : new T.Vector3(ux, 0, uz), fu = fwd.x * ux + fwd.z * uz, fv = fwd.x * vx + fwd.z * vz, aimV = clamp(fv / Math.max(.2, fu) * (TABLE.L / 2 + .7) + me.v * .3, -.75, .75);
      if (pause > 0) {
        pause -= dt;if (pause <= 0) {if (match.winner) {const won = match.winner === 'you', m = `${won ? 'You win' : npcName + ' wins'} ${match.score.you}–${match.score.npc}!`;game.stop();if (won && game.onWin) game.onWin();return {done: m};}newRally();msg = match.server === 'you' ? 'Your serve: R2 / left mouse' : `${npcName} serves`;}
      } else if (rally) {
        if (!rally.ball && match.server === 'you') {msg = 'Your serve: R2 / left mouse (aim with the camera)';if (pressed) serve('you', aimV, input.alt);}
        else if (!rally.ball && match.server === 'npc') {serveWait -= dt;if (serveWait <= 0) serve('npc', (Math.random() - .5) * 1.1);}
        else if (rally.ball && !rally.over) {
          // Your hit: during the swing, the ball near your paddle after it bounced on your side.
          if (rally.lastHit === 'npc' && me.swing >= 0 && me.swing <= .22) {
            const p = rally.ball, paddleV = me.v + .22, dv = p.v - paddleV, du = p.u - myU;
            if (Math.abs(dv) < .55 && du > -.45 && du < .95 && p.y > TABLE.H - .15 && p.y < TABLE.H + .85 && rally.bounces.you === 1) {
              const timing = clamp((me.swing - .1) / .1, -1, 1), err = .12 + Math.abs(timing) * .25 + Math.abs(dv) * .35 + (input.alt ? .3 : 0) + (input.drunk || 0) * .8;
              shot('you', {u: p.u, y: p.y, v: p.v}, {v: aimV, smash: !!input.alt, timing: -timing, err});me.swing = -1;msg = timing < -.5 ? 'Early – it went cross-court' : timing > .5 ? 'Late – down the line' : 'Good timing!';
            }
          }
          // Ola: moves to where the ball will come and returns it (or misses now and then).
          if (rally.lastHit === 'you' && rally.ball.vu > 0) {
            if (!npc.plan) {const p = predict(rally.ball, npcHome.u - .4);npc.plan = p ? {v: p.v, react: .16} : {v: npc.v, react: .16};}
            npc.plan.react -= dt;if (npc.plan.react <= 0) npc.v += clamp(npc.plan.v - .2 - npc.v, -3.2 * dt, 3.2 * dt);
            const p = rally.ball;
            if (rally.bounces.npc === 1 && p.u > TABLE.L / 2 - .2 && p.u < npcHome.u + .3 && p.y > TABLE.H - .1 && Math.abs(p.v - (npc.v + .2)) < .6 && !npc.decided) {
              npc.decided = true;const speed = Math.hypot(p.vu, p.vv), reach = Math.abs(p.v - (npc.v + .2));
              if (Math.random() < clamp(npcSkill.miss + (speed - 6) * .05 + reach * .4, .03, .75)) {npc.whiff = true;}
              else {npc.swing = 0;shot('npc', {u: p.u, y: p.y, v: p.v}, {v: (Math.random() - .5) * 1.2, smash: Math.random() < .12 && p.y > TABLE.H + .35, err: npcSkill.error + Math.random() * .1});}
            }
          } else {npc.plan = null;npc.decided = false;npc.whiff = false;npc.v += clamp(npcHome.v - npc.v, -1.2 * dt, 1.2 * dt);}
          for (const e of rally.step(dt)) {
            if (e.kind === 'bounce' && audio && audio.sfx) audio.sfx('pingBounce', {gain: .6});
            if (e.kind === 'net' && audio && audio.sfx) audio.sfx('thud', {gain: .25});
            if (e.kind === 'over') endPoint(e);
          }
        } else if (rally.over && pause <= 0) {endPoint(rally.over);}
      }
      if (rally && rally.ball) {ballMesh.visible = true;ballMesh.position.copy(W(rally.ball.u, rally.ball.y, rally.ball.v));}
      // Your paddle in front of you (right hand), swinging forward.
      myPaddle.visible = true;const sw = me.swing >= 0 ? Math.sin(Math.min(1, me.swing / .22) * Math.PI) : 0;
      myPaddle.position.copy(W(myU + .25 + sw * .35, TABLE.H + .2 + sw * .1, me.v + .3 - sw * .15));myPaddle.rotation.set(0, Math.atan2(-uz, ux) + Math.PI / 2 - .5 + sw * .9, .3);
      // Ola's body.
      av.group.position.set(npcHome.u, 0, npc.v);npc.swing = npc.swing >= 0 ? (npc.swing + dt > .35 ? -1 : npc.swing + dt) : -1;
      av.pose({stance: 'stand', speed: Math.abs(npc.v - (last ?? npc.v)) / Math.max(dt, .001), dt});last = npc.v;
      const R = av.joints.R;R.sh.rotation.set(.9 + (npc.swing >= 0 ? Math.sin(npc.swing / .35 * Math.PI) * .6 : 0), 0, .5);R.el.rotation.set(.9, 0, 0);
      av.update(dt, camera || {position: new T.Vector3()}, true);
      hud.hidden = false;
      hud.innerHTML = `<b>Table tennis · You ${match.score.you} – ${match.score.npc} ${npcName}</b><span>${match.server === 'you' ? 'Your serve' : npcName + ' serves'} · first to 11</span><small>${msg}</small><small>R2 / left mouse swing (timing!) · aim with the camera · L2 smash · left stick / A D move · ○ quit</small>`;
      return out;
    };
    const atLocal = at;
    game.poi = () => [{x: atLocal.x, s: atLocal.s, color: '#2a6f97', label: 'Table tennis', glyph: '🏓'}];
    game.debug = () => ({match, rally, me, npc, y0, frameToWorld: W, toFrame});
    return game;
  }

  return {TABLE, Match, Rally, solveShot, serveShot, heightAtNet, stepBall, create};
});
