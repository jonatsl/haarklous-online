/* Magic powers taught by Sopp-Sigvald, the mushroom wizard outside Kiwi Storgata (issue #65). Four powers, learned one by one:
 *   Svev (levitation)  hold R1 / 1: float up to 3 m, let go to sink slowly (also a slow fall after a jump); uses mana while rising
 *   Glimt (blink)      R1 / 2: a short jump through the air, up to 8 m the way you look; it stops in front of walls
 *   Vindkast (gust)    R1 / 3: a gust of wind ahead (14 m, 40°): pushes a parked car, motorcycle or e-scooter and scares pigeons
 *   Lyskule (light orb) R1 / 4: a glowing orb by your shoulder that lights up the dark (the catacombs too); uses a little mana
 * D-pad ← (or ←) chooses the power for R1 (X on the keyboard). Mana (100) refills by itself; each power has a cooldown.
 * Powers work on foot only, and not during the mission, paintball, the timed run or a conversation.
 *
 * Pure (Node-tested):
 *   POWERS, MAX_MANA, REGEN
 *   new Magic(known) -> {mana, known, sel, levitating, orb, cool{}, learn(id), knows(id), list(), select(step), selected,
 *        can(id) -> null | 'unknown' | 'cooldown' | 'mana', cast(id) -> {ok, why, power, on}, release(id), tick(dt) -> [events]}
 *   levitate({y, v}, dt, {hold, max, head}) -> {y, v, floating}   height above the floor you stand on and vertical speed
 *   blinkTarget(from {x, z, y}, dir {x, z}, dist, test(p, y) -> y | null, step = .2) -> {x, z, y, d}
 *   gustTargets(from {x, z}, dir {x, z}, items [{x, z}], range, coneDeg) -> [{item, d, k}] nearest first, k = strength 0..1
 * GameMagic.effects({T, scene}) -> {burst(pos, color, n, speed), wind(from, dir), orb, update(dt, camera)}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameMagic = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const MAX_MANA = 100, REGEN = 12, REGEN_DELAY = 1.2;
  // cost: mana to cast; drain: mana per second while it lasts; cd: seconds before it can be cast again.
  const POWERS = [
    {id: 'levitate', icon: '🪶', no: 'Svev', en: 'Levitation', key: '1', cost: 4, drain: 15, cd: .4, hold: true, color: 0xb8e6ff},
    {id: 'blink', icon: '✨', no: 'Glimt', en: 'Blink', key: '2', cost: 30, cd: 3, dist: 8, color: 0xc38bff},
    {id: 'gust', icon: '🌬️', no: 'Vindkast', en: 'Gust', key: '3', cost: 35, cd: 5, range: 14, cone: 40, color: 0xdff6ea},
    {id: 'orb', icon: '🔮', no: 'Lyskule', en: 'Light orb', key: '4', cost: 10, drain: 1.2, cd: 1, toggle: true, color: 0xffe2a0}
  ];
  const byId = id => POWERS.find(p => p.id === id);

  class Magic {
    constructor(known = []) {this.mana = MAX_MANA;this.cool = {};this.known = new Set();this.sel = null;this.levitating = false;this.orb = false;this.idle = 0;for (const id of known) this.learn(id);}
    learn(id) {if (!byId(id) || this.known.has(id)) return false;this.known.add(id);this.sel = id;return true;}
    knows(id) {return this.known.has(id);}
    list() {return POWERS.filter(p => this.known.has(p.id));}
    get selected() {return this.sel && this.known.has(this.sel) ? this.sel : (this.list()[0] || {}).id || null;}
    select(step = 1) {const l = this.list();if (!l.length) return null;const i = l.findIndex(p => p.id === this.selected);this.sel = l[((i + step) % l.length + l.length) % l.length].id;return this.sel;}
    can(id) {
      const p = byId(id);if (!p || !this.known.has(id)) return 'unknown';
      if (p.toggle && this.orb && id === 'orb') return null;// switching the orb off is always allowed
      if ((this.cool[id] || 0) > 0) return 'cooldown';
      if (this.mana < p.cost) return 'mana';
      return null;
    }
    cast(id) {
      const p = byId(id), why = this.can(id);if (why) return {ok: false, why, power: p};
      if (id === 'orb' && this.orb) {this.orb = false;this.cool[id] = p.cd;return {ok: true, power: p, on: false};}
      this.mana -= p.cost;this.cool[id] = p.cd;this.idle = 0;
      if (id === 'levitate') this.levitating = true;
      if (id === 'orb') this.orb = true;
      return {ok: true, power: p, on: true};
    }
    release(id) {if (id === 'levitate' && this.levitating) {this.levitating = false;return true;}return false;}
    // Mana drains while levitating or while the orb burns, and refills after a short rest.
    tick(dt) {
      const ev = [];
      for (const k of Object.keys(this.cool)) this.cool[k] = Math.max(0, this.cool[k] - dt);
      let drain = 0;if (this.levitating) drain += byId('levitate').drain;if (this.orb) drain += byId('orb').drain;
      if (drain > 0) {this.mana -= drain * dt;if (this.levitating) this.idle = 0;}
      else this.idle += dt;
      if (this.mana <= 0) {
        this.mana = 0;
        if (this.levitating) {this.levitating = false;ev.push({kind: 'empty', id: 'levitate'});}
        if (this.orb) {this.orb = false;ev.push({kind: 'empty', id: 'orb'});}
      }
      // The orb's small drain does not stop the refill (its net effect is a slower refill).
      if (this.idle > REGEN_DELAY || (!this.levitating && this.orb)) this.mana = Math.min(MAX_MANA, this.mana + REGEN * dt);
      return ev;
    }
  }

  // One step of the vertical motion with levitation: y = height above the floor under you, v = vertical speed.
  // hold: rising (1.8 m/s up to max, then hovering with a slight bob); not holding but still up: sinking at most 1.3 m/s.
  // head: headroom (ceiling above the floor minus your eye height), so you never float through a ceiling.
  function levitate(s, dt, {hold, max = 3.2, head = Infinity}) {
    let {y, v} = s;const top = Math.min(max, head);
    if (hold) {const want = y < top - .05 ? 1.8 : (top - y) * 2;v += (want - v) * Math.min(1, dt * 6);}
    else {v -= 9.81 * dt;if (v < -1.3) v = -1.3;}
    y += v * dt;
    if (y > top) {y = top;v = Math.min(0, v);}
    if (y <= 0) return {y: 0, v: 0, floating: false};
    return {y, v, floating: true};
  }

  // Blink: march from `from` along dir (normalised here) in small steps; test(p, y) returns the floor height you would stand on
  // at p coming from height y (null = blocked: a wall, a drop, no floor). Stops at the last good point.
  function blinkTarget(from, dir, dist, test, step = .2) {
    const L = Math.hypot(dir.x, dir.z) || 1, ux = dir.x / L, uz = dir.z / L;
    let best = {x: from.x, z: from.z, y: from.y, d: 0}, y = from.y;
    for (let d = step; d <= dist + 1e-9; d += step) {
      const p = {x: from.x + ux * d, z: from.z + uz * d}, ny = test(p, y);
      if (ny === null || ny === undefined || !Number.isFinite(ny)) break;
      y = ny;best = {x: p.x, z: p.z, y, d};
    }
    return best;
  }

  // Gust: what lies in a cone ahead (range metres, half-angle coneDeg), nearest first, with a strength that falls off with distance
  // and with the angle off the centre line.
  function gustTargets(from, dir, items, range = 14, coneDeg = 40) {
    const L = Math.hypot(dir.x, dir.z) || 1, ux = dir.x / L, uz = dir.z / L, c = Math.cos(coneDeg * Math.PI / 180), out = [];
    for (const item of items) {
      const dx = item.x - from.x, dz = item.z - from.z, d = Math.hypot(dx, dz);if (d > range || d < .01) continue;
      const cos = (dx * ux + dz * uz) / d;if (cos < c) continue;
      out.push({item, d, k: (1 - d / range * .6) * (.5 + .5 * (cos - c) / (1 - c))});
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // ---------- Browser: particles, the wind and the orb ----------
  function effects({T, scene}) {
    const N = 480, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), age = new Float32Array(N), drag = new Float32Array(N);
    const geo = new T.BufferGeometry();geo.setAttribute('position', new T.BufferAttribute(pos, 3));geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const dot = (() => {const c = document.createElement('canvas');c.width = c.height = 64;const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);g.addColorStop(0, 'rgba(255,255,255,1)');g.addColorStop(.35, 'rgba(255,255,255,.55)');g.addColorStop(1, 'rgba(255,255,255,0)');x.fillStyle = g;x.fillRect(0, 0, 64, 64);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return t;})();
    const mat = new T.PointsMaterial({size: .22, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, fog: false});
    const points = new T.Points(geo, mat);points.frustumCulled = false;points.visible = false;points.name = 'Magic particles';scene.add(points);
    let next = 0, alive = 0;const tmp = new T.Color();
    function spawn(p, v, color, t, dr = 1.5) {
      const i = next;next = (next + 1) % N;
      pos[i * 3] = p.x;pos[i * 3 + 1] = p.y;pos[i * 3 + 2] = p.z;vel[i * 3] = v.x;vel[i * 3 + 1] = v.y;vel[i * 3 + 2] = v.z;
      tmp.set(color);col[i * 3] = tmp.r;col[i * 3 + 1] = tmp.g;col[i * 3 + 2] = tmp.b;life[i] = t;age[i] = 0;drag[i] = dr;
    }
    const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
    // A puff of sparks round a point (blink start and end, a learned power, a picked mushroom).
    function burst(p, color = 0xc38bff, n = 60, speed = 2.5) {for (let k = 0; k < n; k++) spawn({x: p.x + rnd(.25), y: p.y + rnd(.6), z: p.z + rnd(.25)}, {x: rnd(speed), y: rnd(speed) + .6, z: rnd(speed)}, color, .6 + Math.random() * .6);points.visible = true;}
    // The gust: streaks flying out along dir in a widening cone.
    function wind(from, dir) {
      const L = Math.hypot(dir.x, dir.z) || 1, ux = dir.x / L, uz = dir.z / L;
      for (let k = 0; k < 150; k++) {const s = 9 + Math.random() * 9, side = rnd(.45), up = Math.random() * .5 - .1;spawn({x: from.x + ux * .6 + rnd(.3), y: from.y + rnd(.4), z: from.z + uz * .6 + rnd(.3)}, {x: (ux - uz * side) * s, y: up * s * .4, z: (uz + ux * side) * s}, Math.random() < .25 ? 0xb9d98a : 0xeaf6f2, .5 + Math.random() * .7, .9);}
      points.visible = true;
    }
    // The light orb: a glowing ball with a soft halo by your right shoulder, and a light that is always in the scene (so no shader
    // is rebuilt when it comes on; intensity 0 when it is off).
    const orbG = new T.Group();orbG.name = 'Light orb';orbG.visible = false;scene.add(orbG);
    const core = new T.Mesh(new T.SphereGeometry(.04, 16, 10), new T.MeshBasicMaterial({color: 0xfff4d0, fog: false}));orbG.add(core);
    const halo = new T.Sprite(new T.SpriteMaterial({map: dot, color: 0xffd98a, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false}));halo.scale.set(.5, .5, 1);halo.material.opacity = .75;orbG.add(halo);
    const light = new T.PointLight(0xffe2b0, 0, 16, 1.6);light.name = 'Light orb light';scene.add(light);
    const orb = {group: orbG, light, level: 0, on: false, pos: new T.Vector3(), t: 0};
    const fwd = new T.Vector3(), right = new T.Vector3(), want = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    function update(dt, camera) {
      // Orb: eases toward a point beside your head, bobbing; the light fades in and out.
      orb.level += ((orb.on ? 1 : 0) - orb.level) * Math.min(1, dt * 6);orb.t += dt;
      const show = orb.level > .02;orbG.visible = show;light.intensity = show ? orb.level * 9 : 0;
      if (show) {
        camera.getWorldDirection(fwd);fwd.y = 0;if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);fwd.normalize();right.crossVectors(fwd, up).normalize();
        want.copy(camera.position).addScaledVector(right, .7).addScaledVector(fwd, 1.05);want.y += .32 + Math.sin(orb.t * 2.1) * .06;
        if (orb.pos.distanceToSquared(want) > 25) orb.pos.copy(want);else orb.pos.lerp(want, Math.min(1, dt * 5));
        orbG.position.copy(orb.pos);light.position.copy(orb.pos);core.scale.setScalar(.6 + .4 * orb.level);halo.scale.setScalar((.16 + Math.sin(orb.t * 5) * .015) * orb.level);
        if (Math.random() < dt * 14) spawn({x: orb.pos.x + rnd(.05), y: orb.pos.y + rnd(.05), z: orb.pos.z + rnd(.05)}, {x: rnd(.15), y: .25 + Math.random() * .2, z: rnd(.15)}, 0xffd98a, .8, .5);
      }
      // Particles.
      if (!points.visible) return;
      alive = 0;
      for (let i = 0; i < N; i++) {
        if (age[i] >= life[i]) {if (pos[i * 3 + 1] > -9e3) {pos[i * 3 + 1] = -1e4;}continue;}
        age[i] += dt;alive++;const k = Math.exp(-drag[i] * dt);
        vel[i * 3] *= k;vel[i * 3 + 1] = vel[i * 3 + 1] * k - .6 * dt;vel[i * 3 + 2] *= k;
        pos[i * 3] += vel[i * 3] * dt;pos[i * 3 + 1] += vel[i * 3 + 1] * dt;pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const f = 1 - age[i] / life[i];if (f < .3) {col[i * 3] *= .9;col[i * 3 + 1] *= .9;col[i * 3 + 2] *= .9;}
      }
      geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
      if (!alive) points.visible = false;
    }
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -1e4;
    return {burst, wind, orb, update, points};
  }

  return {POWERS, MAX_MANA, REGEN, Magic, levitate, blinkTarget, gustTargets, effects, byId};
});
