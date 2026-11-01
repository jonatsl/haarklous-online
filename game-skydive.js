/* Skydiving (issue #22): jump from the Cessna 208 Caravan jump plane, fall, open the canopy, fly it down and land.
 * Two ways up: a scheduled jump flight that everybody in the lobby can board (no pilot needed; its path is a function of
 * the shared server clock, so it is the same on every screen), or the Caravan at the airstrip flown by one player while
 * the others ride along. Twelve jumper places; in a lobby your place is your player number.
 *
 * Freefall: gravity against air drag, terminal velocity about 54 m/s belly-to-earth relative to the (real) wind.
 *   W tracks forward (about 19 m/s across the air, falling a little slower), S back-slides, A/D turn. ✕ pulls.
 *   An automatic activation device opens the reserve at 300 m if you are still falling faster than 35 m/s.
 * Canopy (a 170 sq ft sport canopy): opens over 3 s; then about 10 m/s forward and 5 m/s down. A/D pull a toggle (turn,
 *   and you sink faster in a turn), W the front risers (faster and steeper), S flares (much slower for about 3 s, then it
 *   stalls). Landing: under 3.5 m/s down is a soft landing, under 6 m/s a hard one, more is a crash (you get up again).
 *
 * GameSkydive.Jumper({x, y, z, vx, vy, vz, yaw}) -> {state 'freefall'|'opening'|'canopy'|'landed', pos, vel, yaw, ...,
 *   update(dt, {fwd, turn, pull}, {ground(x, z), wind: {x, z}, blocked(x, y, z)}) -> event | null, agl}
 * GameSkydive.flight(t, plan) -> {phase, x, y, z, yaw, pitch, roll, speed, green, door, visible}   (pure; t = seconds in
 *   the cycle; plan from GameSkydive.plan({start: {x, z}, yaw, groundY, gearH}))
 * GameSkydive.canopy(T, color) -> Group (a ram-air canopy with lines; origin at the jumper's harness)
 * The game's pilot in the Caravan (pure): pilotGround({t0, from, hold, ground, gearH}) or pilotOrbit({t0, pos, yaw, pitch,
 *   roll, speed, vy, toward, ground}) -> G; pilotFlight(t, G) -> {phase, x, y, z, yaw, pitch, roll, speed, green, left}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameSkydive = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const G = 9.81, VT = 54, VT_TRACK = 46, AAD_ALT = 300, PULL_HINT = 1000, OPEN_S = 3;
  const CANOPY = {fwd: 10, sink: 5, turn: 1.3, riserFwd: 12.5, riserSink: 7.5, flareS: 3};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Jumper {
    constructor({x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, yaw = 0} = {}) {
      this.state = 'freefall';this.pos = {x, y, z};this.vel = {x: vx, y: vy, z: vz};this.yaw = yaw;this.t = 0;this.openT = 0;
      this.flareE = 1;this.reserve = false;this.landing = null;this.agl = 0;this.air = {fwd: 0, sink: 0};
    }
    // inp: fwd -1..1 (W / stick up = +1), turn -1..1 (A = -1, D = +1), pull (bool); env: ground(x, z), wind {x, z}, blocked(x, y, z)
    update(dt, inp = {}, env = {}) {
      if (this.state === 'landed') return null;
      const wind = env.wind || {x: 0, z: 0}, p = this.pos, v = this.vel, fwd = clamp(inp.fwd || 0, -1, 1), turn = clamp(inp.turn || 0, -1, 1);
      const f = {x: -Math.sin(this.yaw), z: -Math.cos(this.yaw)};let event = null;this.t += dt;
      const ground = env.ground ? env.ground(p.x, p.z) : 0;this.agl = p.y - ground;
      if (this.state === 'freefall') {
        this.yaw -= turn * 1.6 * dt;
        // Air drag on the speed through the air: a = -g/VT² |v_rel| v_rel (tracking: less drag down, a push forward).
        const rx = v.x - wind.x, ry = v.y, rz = v.z - wind.z, sp = Math.hypot(rx, ry, rz), vt = fwd > 0 ? VT + (VT_TRACK - VT) * fwd : VT, k = G / (vt * vt);
        v.x -= k * sp * rx * dt;v.y += (-G - k * sp * ry) * dt;v.z -= k * sp * rz * dt;
        const want = fwd > 0 ? 22 * fwd : fwd * 5, along = rx * f.x + rz * f.z;// tracking / back-slide across the air (about 19 m/s against drag)
        v.x += f.x * (want - along) * 1.5 * dt;v.z += f.z * (want - along) * 1.5 * dt;
        if (inp.pull) {this.state = 'opening';this.openT = 0;event = 'pull';}
        else if (this.agl < AAD_ALT && -v.y > 35) {this.state = 'opening';this.openT = 0;this.reserve = true;event = 'reserve';}
      } else if (this.state === 'opening') {
        // The canopy snivels open: the speed through the air falls to canopy flight over about 3 s.
        this.openT += dt;const k = Math.min(1, dt * 1.8);
        const tx = wind.x + f.x * CANOPY.fwd, tz = wind.z + f.z * CANOPY.fwd;
        v.x += (tx - v.x) * k;v.z += (tz - v.z) * k;v.y += (-CANOPY.sink - v.y) * k;
        if (this.openT >= OPEN_S) {this.state = 'canopy';this.air = {fwd: CANOPY.fwd, sink: CANOPY.sink};event = 'open';}
      } else if (this.state === 'canopy') {
        // Toggles turn (and steepen), front risers speed up, a flare trades speed for lift until it runs out.
        const flare = fwd < 0 && this.flareE > 0 ? -fwd : 0, riser = Math.max(0, fwd), tAbs = Math.abs(turn);
        this.flareE = flare > 0 ? Math.max(0, this.flareE - dt / CANOPY.flareS * flare) : Math.min(1, this.flareE + dt / 6);
        const stalled = fwd < -.2 && this.flareE <= 0;
        let F = CANOPY.fwd + (CANOPY.riserFwd - CANOPY.fwd) * riser, S = CANOPY.sink + (CANOPY.riserSink - CANOPY.sink) * riser;
        F *= 1 - .65 * flare - .25 * tAbs;S = S * (1 - .75 * flare) + 2.5 * tAbs;if (stalled) {F = 2;S = 8;}
        this.yaw -= turn * CANOPY.turn * dt;
        const k = Math.min(1, dt / .8);this.air.fwd += (F - this.air.fwd) * k;this.air.sink += (S - this.air.sink) * Math.min(1, dt / (flare ? .35 : .8));
        v.x = wind.x + f.x * this.air.fwd;v.z = wind.z + f.z * this.air.fwd;v.y = -this.air.sink;
      }
      const nx = p.x + v.x * dt, nz = p.z + v.z * dt, ny = p.y + v.y * dt;
      if (env.blocked && env.blocked(nx, ny, nz)) {v.x = 0;v.z = 0;} else {p.x = nx;p.z = nz;}
      p.y = ny;
      const g2 = env.ground ? env.ground(p.x, p.z) : 0;this.agl = p.y - g2;
      if (p.y <= g2) {
        const down = -v.y;p.y = g2;
        this.landing = down < 3.5 && Math.hypot(v.x, v.z) < 9 ? 'soft' : down < 6 ? 'hard' : 'crash';
        this.state = 'landed';v.x = v.y = v.z = 0;event = 'land';
      }
      return event;
    }
  }

  // ---------- The scheduled jump flight: an 8-minute cycle, the same on every screen (server clock) ----------
  const CYCLE = 480, BOARD_FROM = 455, ROLL = [75, 85], CLIMBOUT = [85, 95], SPIRAL = [95, 245], RUN = [245, 305], AWAY = [305, 455];
  const JUMP_AGL = 3000, R = 650, V_SPIRAL = 48, V_RUN = 48, V_AWAY = 50;
  // ground(x, z) (optional): the real ground height, so the wheels stay on a sloping strip during the roll.
  function plan({start, yaw, groundY, gearH = 1.55, ground = null}) {
    const d = {x: -Math.sin(yaw), z: -Math.cos(yaw)}, n = {x: -d.z, z: d.x};
    const E = {x: start.x + d.x * 550, z: start.z + d.z * 550}, C = {x: E.x + n.x * R, z: E.z + n.z * R}, w = V_SPIRAL / R, th = w * (SPIRAL[1] - SPIRAL[0]);
    const e0 = {x: E.x - C.x, z: E.z - C.z}, rot = (a, t) => ({x: a.x * Math.cos(t) - a.z * Math.sin(t), z: a.x * Math.sin(t) + a.z * Math.cos(t)});
    const J0 = (() => {const e = rot(e0, th);return {x: C.x + e.x, z: C.z + e.z};})(), Jd = (() => {const e = rot(e0, th);const L = Math.hypot(e.x, e.z);return {x: -e.z / L, z: e.x / L};})();
    const liftY = (ground ? ground(start.x + d.x * 180, start.z + d.z * 180) : groundY) + gearH;// where the wheels leave the ground
    return {start, yaw, d, n, E, C, w, e0, rot, J0, Jd, groundY, gearH, ground, liftY, top: groundY + JUMP_AGL};
  }
  const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
  function flight(t, P) {
    t = ((t % CYCLE) + CYCLE) % CYCLE;
    const base = {green: false, door: false, visible: true, pitch: 0, roll: 0};
    if (t >= BOARD_FROM || t < ROLL[0]) {
      const left = t >= BOARD_FROM ? CYCLE - t + ROLL[0] : ROLL[0] - t;
      return {...base, phase: 'board', leavesIn: left, x: P.start.x, y: P.groundY + P.gearH, z: P.start.z, yaw: P.yaw, speed: 0, door: true};
    }
    if (t < ROLL[1]) {
      const s = t - ROLL[0], dist = 1.8 * s * s, x = P.start.x + P.d.x * dist, z = P.start.z + P.d.z * dist;
      return {...base, phase: 'roll', x, y: (P.ground ? P.ground(x, z) : P.groundY) + P.gearH, z, yaw: P.yaw, speed: 3.6 * s, pitch: s > 8.5 ? (s - 8.5) * .05 : 0};
    }
    const liftY = P.liftY ?? P.groundY + P.gearH;
    if (t < CLIMBOUT[1]) {const s = t - CLIMBOUT[0], dist = 180 + 37 * s;return {...base, phase: 'climb', x: P.start.x + P.d.x * dist, y: liftY + 6 * s, z: P.start.z + P.d.z * dist, yaw: P.yaw, speed: 37, pitch: Math.atan2(6, 37)};}
    if (t < SPIRAL[1]) {
      const s = t - SPIRAL[0], e = P.rot(P.e0, P.w * s), x = P.C.x + e.x, z = P.C.z + e.z, L = Math.hypot(e.x, e.z), vx = -e.z / L, vz = e.x / L;
      const y0 = liftY + 60, climb = (P.top - y0) / (SPIRAL[1] - SPIRAL[0]), yr = yawOf(vx, vz);// ends exactly at the jump run's height
      // A coordinated turn: bank toward the centre (the yaw keeps changing the same way all round the circle).
      const y2 = yawOf(-P.rot(P.e0, P.w * (s + .1)).z, P.rot(P.e0, P.w * (s + .1)).x), turnRate = Math.atan2(Math.sin(y2 - yr), Math.cos(y2 - yr)) / .1;
      return {...base, phase: 'climb', x, y: y0 + climb * s, z, yaw: yr, speed: V_SPIRAL, pitch: Math.atan2(climb, V_SPIRAL), roll: Math.atan(turnRate * V_SPIRAL / G)};
    }
    if (t < RUN[1]) {const s = t - RUN[0];return {...base, phase: 'run', x: P.J0.x + P.Jd.x * V_RUN * s, y: P.top, z: P.J0.z + P.Jd.z * V_RUN * s, yaw: yawOf(P.Jd.x, P.Jd.z), speed: V_RUN, door: true, green: s >= 5 && s <= 55};}
    const s = t - AWAY[0], dist = V_RUN * (RUN[1] - RUN[0]) + V_AWAY * s;
    return {...base, phase: 'away', x: P.J0.x + P.Jd.x * dist, y: P.top - 18 * s, z: P.J0.z + P.Jd.z * dist, yaw: yawOf(P.Jd.x, P.Jd.z), speed: V_AWAY, pitch: -Math.atan2(18, V_AWAY), visible: s < 140};
  }

  // ---------- The game's pilot in the Caravan (1 Nov 2026, the user: "choose to have the plane flown by a pilot provided by the game") ----------
  // From the ground: 10 s for jumpers to board, a taxi along a smooth curve onto the strip (the hold point, behind the
  // scheduled flight's boarding place), a hold while the scheduled flight is boarding or rolling ahead, then the scheduled
  // flight's own profile from the hold point (roll, climbing spiral to 3000 m, jump run with the green light, away).
  // Both planes fly the same path, so the hold keeps them at least 4 s (about 200 m) apart.
  // In the air (the player flying it hands over, or its pilot is gone): a level circle of 650 m, at least 300 m up.
  const WAIT = 10, TAXI_V = 5, BLOCK = [445, 80], ORBIT_R = 650, ORBIT_CLIMB = 6;
  // The scheduled flight is on the strip ahead from 445 s (it appears at 455) to 80 s of its cycle: wait until it is clear.
  function clearToRoll(t) {const c = ((t % CYCLE) + CYCLE) % CYCLE;return c >= BLOCK[0] ? t + CYCLE - c + BLOCK[1] : c < BLOCK[1] ? t + BLOCK[1] - c : t;}
  // t0 = now (s, the lobby's clock); from / hold = {x, z, yaw}; ground(x, z) = ground height (or a flat groundY).
  function pilotGround({t0, from, hold, ground = null, groundY = 0, gearH = 1.55, wait = WAIT}) {
    const gy = (x, z) => ground ? ground(x, z) : groundY, D = Math.hypot(hold.x - from.x, hold.z - from.z), M = Math.max(8, D * 1.1);
    const fd = {x: -Math.sin(from.yaw), z: -Math.cos(from.yaw)}, hd = {x: -Math.sin(hold.yaw), z: -Math.cos(hold.yaw)};
    const at = u => {const u2 = u * u, u3 = u2 * u, a = 2 * u3 - 3 * u2 + 1, b = u3 - 2 * u2 + u, c = -2 * u3 + 3 * u2, e = u3 - u2;
      return {x: a * from.x + b * M * fd.x + c * hold.x + e * M * hd.x, z: a * from.z + b * M * fd.z + c * hold.z + e * M * hd.z};};
    const cum = [0];let prev = at(0);for (let i = 1; i <= 60; i++) {const p = at(i / 60);cum.push(cum[i - 1] + Math.hypot(p.x - prev.x, p.z - prev.z));prev = p;}
    const L = D < 1 ? 0 : cum[60], taxiT = L / TAXI_V;
    return {kind: 'ground', t0, wait, from, hold, at, cum, L, taxiT, rollAt: clearToRoll(t0 + wait + taxiT), gy, gearH, P: plan({start: hold, yaw: hold.yaw, groundY: gy(hold.x, hold.z), gearH, ground})};
  }
  // pos {x, y, z}, yaw / pitch / roll (three.js YXZ), speed, vy: the plane as the pilot gets it; it circles toward `toward`.
  function pilotOrbit({t0, pos, yaw, pitch = 0, roll = 0, speed, vy = 0, toward = {x: 0, z: 0}, ground = null, groundY = 0, minAGL = 300}) {
    const V = clamp(speed || 0, 35, 55), r = {x: Math.cos(yaw), z: -Math.sin(yaw)};// to the right of the heading
    const right = {x: pos.x + r.x * ORBIT_R, z: pos.z + r.z * ORBIT_R}, left = {x: pos.x - r.x * ORBIT_R, z: pos.z - r.z * ORBIT_R};
    const turnRight = Math.hypot(right.x - toward.x, right.z - toward.z) <= Math.hypot(left.x - toward.x, left.z - toward.z), C = turnRight ? right : left;
    const tau = 3, settle = pos.y + vy * tau, gap = Math.max(0, (ground ? ground(pos.x, pos.z) : groundY) + minAGL - settle);
    return {kind: 'air', t0, C, e0: {x: pos.x - C.x, z: pos.z - C.z}, sgn: turnRight ? 1 : -1, V, y0: pos.y, vy0: vy, tau, gap, pitch0: pitch, roll0: roll};
  }
  function orbitAt(t, O) {
    const s = Math.max(0, t - O.t0), th = O.sgn * O.V * s / ORBIT_R, e = {x: O.e0.x * Math.cos(th) - O.e0.z * Math.sin(th), z: O.e0.x * Math.sin(th) + O.e0.z * Math.cos(th)};
    const k = Math.exp(-s / O.tau), climbing = ORBIT_CLIMB * s < O.gap, vy = O.vy0 * k + (climbing ? ORBIT_CLIMB : 0);
    const y = O.y0 + O.vy0 * O.tau * (1 - k) + Math.min(ORBIT_CLIMB * s, O.gap), bank = -O.sgn * Math.atan(O.V * O.V / (ORBIT_R * G)), blend = Math.exp(-s / 1.5);
    const pitch = Math.atan2(vy, O.V);
    return {phase: 'orbit', x: O.C.x + e.x, y, z: O.C.z + e.z, yaw: yawOf(O.sgn * -e.z, O.sgn * e.x), speed: O.V, pitch: pitch + (O.pitch0 - pitch) * blend, roll: bank + (O.roll0 - bank) * blend,
      green: false, door: true, visible: true};
  }
  // The pilot's plane at time t: phase 'wait' | 'taxi' | 'hold' (left: seconds) | the flight's phases | 'orbit' | 'done'.
  function pilotFlight(t, G) {
    if (G.kind === 'air') return orbitAt(t, G);
    const s = t - G.t0, still = (p, yaw, speed, phase, left) => ({phase, x: p.x, y: G.gy(p.x, p.z) + G.gearH, z: p.z, yaw, speed, pitch: 0, roll: 0, green: false, door: true, visible: true, left});
    if (s < G.wait) return still(G.from, G.from.yaw, 0, 'wait', G.wait - s);
    if (s < G.wait + G.taxiT) {
      const k = (s - G.wait) / G.taxiT, d = k * k * (3 - 2 * k) * G.L;let i = 1;while (i < 60 && G.cum[i] < d) i++;
      const u = (i - 1 + (d - G.cum[i - 1]) / ((G.cum[i] - G.cum[i - 1]) || 1)) / 60, a = G.at(Math.max(0, u - .01)), b = G.at(Math.min(1, u + .01));
      return still(G.at(u), yawOf(b.x - a.x, b.z - a.z), 6 * k * (1 - k) * G.L / G.taxiT, 'taxi', 0);
    }
    if (t < G.rollAt) return still(G.hold, G.hold.yaw, 0, 'hold', G.rollAt - t);
    const tf = ROLL[0] + (t - G.rollAt), f = tf < BOARD_FROM ? flight(tf, G.P) : null;
    return f && f.visible ? f : {phase: 'done', visible: false};
  }

  // A ram-air sport canopy: 9 cells in a gentle arch about 5.3 m wide and 2.4 m deep, 2.6 m above the harness, with lines.
  function canopy(T, color = 0xd23b2f) {
    const g = new T.Group(), top = new T.MeshStandardMaterial({color, roughness: .7, side: T.DoubleSide}), rib = new T.MeshStandardMaterial({color: 0x2b2b2b, roughness: .8, side: T.DoubleSide});
    const span = 5.3, chord = 2.4, cells = 9, lift = 2.9;
    for (let i = 0; i < cells; i++) {
      const a = (i + .5) / cells - .5, x = a * span, y = lift - Math.pow(a * 2, 2) * .55, roll = -a * .9;
      const cell = new T.Mesh(new T.BoxGeometry(span / cells * 1.02, .32, chord), i % 2 ? top : new T.MeshStandardMaterial({color: new T.Color(color).offsetHSL(0, 0, .12), roughness: .7, side: T.DoubleSide}));
      cell.position.set(x, y, 0);cell.rotation.z = roll;cell.castShadow = true;g.add(cell);
    }
    const pts = [];for (const a of [-.45, -.25, 0, .25, .45]) for (const z of [-.9, .9]) {pts.push(0, .4, 0, a * span, lift - Math.pow(a * 2, 2) * .55 - .16, z);}
    const lg = new T.BufferGeometry();lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    g.add(new T.LineSegments(lg, new T.LineBasicMaterial({color: 0xd8d8d8, transparent: true, opacity: .7})));g.userData.rib = rib;
    return g;
  }
  return {Jumper, plan, flight, canopy, pilotGround, pilotOrbit, pilotFlight, clearToRoll, CYCLE, JUMP_AGL, AAD_ALT, PULL_HINT, VT, CANOPY, phases: {BOARD_FROM, ROLL, CLIMBOUT, SPIRAL, RUN, AWAY}};
});
