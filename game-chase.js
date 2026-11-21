/* Third person in the vehicles (issue #129): one chase camera for the cars, vans, lorries, motorcycles, bicycles, e-scooters,
 * the excavator, the construction-site machines' outside view, the kayak, the FPV drone and passengers. Pure (Node-tested).
 * GameChase.rigFor({length, height, kind}) -> {dist, up, aim, ahead}: how far behind (m), how high above the vehicle's base,
 *   the height of the point it looks at and how far ahead of the vehicle that point is (from the vehicle's size).
 * GameChase.steer(look, dYaw, dPitch, dt): the right stick / mouse turns the camera round the vehicle (look.yaw, look.pitch);
 *   0.8 s after you let go it eases back behind the vehicle.
 * new GameChase.Chase().update(dt, target {x, y, z, yaw}, rig, look {yaw, pitch}, env) -> {x, y, z, ax, ay, az}
 *   The camera position and the point to look at (no roll: use camera.lookAt). It follows the vehicle's heading smoothly,
 *   never goes under env.ground(x, z), over env.roof(x, z) (a ceiling: the garage storey above), or into env.solid(x, y, z)
 *   (walls, trees): it moves closer instead, at once, and eases back out when there is room again. reset() starts afresh.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameChase = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const GAP = .3;// how close the camera may come to the ground or a wall (m)
  const ROOF = .85;// and how far under a floor above it stays: the slab under that floor (a garage storey's 0.4 m, a road bridge's 0.7 m)
  const MIN = .9;// the closest the camera comes to the point it looks at (m)

  // A car (4.2 m) gets the camera about 6 m behind and 2.7 m up; a lorry (8.2 m) 9.6 m and 4.6 m; a bicycle 4 m and 2.2 m.
  function rigFor({length = 4, height = 1.5} = {}) {
    return {dist: clamp(2.6 + length * .85, 3.6, 14), up: clamp(height + 1.2, 2.2, 6), aim: clamp(height * .8, .6, 3.2), ahead: clamp(length * .25, 0, 2.5)};
  }

  // look: {yaw, pitch, idle}; dYaw / dPitch: this frame's turn from the stick or mouse (radians).
  function steer(look, dYaw, dPitch, dt) {
    if (dYaw || dPitch) {look.idle = 0;look.yaw = wrap((look.yaw || 0) + dYaw);look.pitch = clamp((look.pitch || 0) + dPitch, -.6, .9);return look;}
    look.idle = (look.idle || 0) + dt;
    if (look.idle > .8) {const k = Math.exp(-dt * 2.5);look.yaw = (look.yaw || 0) * k;look.pitch = (look.pitch || 0) * k;}
    return look;
  }

  class Chase {
    constructor() {this.out = {x: 0, y: 0, z: 0, ax: 0, ay: 0, az: 0};this.reset();}
    reset() {this.ok = false;this.h = 0;this.py = 0;this.d = 0;}
    // How far from (px, py, pz) along the unit direction (dx, dy, dz) the camera can go, up to len.
    reach(px, py, pz, dx, dy, dz, len, env) {
      const step = .3;
      for (let s = step; s < len + step / 2; s += step) {
        const t = Math.min(s, len), x = px + dx * t, y = py + dy * t, z = pz + dz * t;
        if (y < env.ground(x, z) + GAP || y > env.roof(x, z) - ROOF || env.solid(x, y, z)) return Math.max(MIN, t - step - GAP);
      }
      return len;
    }
    update(dt, t, rig, look, env) {
      const first = !this.ok;this.ok = true;
      // Heading and height follow smoothly (a bump or a turn does not jerk the camera); left and right it stays with the vehicle.
      if (first) {this.h = t.yaw;this.py = t.y + rig.aim;}
      else {this.h = wrap(this.h + wrap(t.yaw - this.h) * (1 - Math.exp(-dt * (rig.turn || 4))));this.py += (t.y + rig.aim - this.py) * (1 - Math.exp(-dt * 10));}
      const px = t.x, pz = t.z, ground = env.ground(px, pz);let py = Math.max(this.py, ground + GAP);
      const roofHere = env.roof(px, pz);if (py > roofHere - ROOF) py = Math.max(ground + GAP * .5, roofHere - ROOF);
      // Behind and above: the elevation drops as you look up (look.pitch > 0) and rises as you look down.
      const H = this.h + (look.yaw || 0), R = Math.hypot(rig.dist, rig.up - rig.aim), e = clamp(Math.atan2(rig.up - rig.aim, rig.dist) - (look.pitch || 0) * .8, -.12, 1.35);
      let wx = px + Math.sin(H) * R * Math.cos(e), wy = py + R * Math.sin(e), wz = pz + Math.cos(H) * R * Math.cos(e);
      // A ceiling over the wanted place (the next storey of a garage, a bridge deck over the river): lower the camera under it.
      const roof = env.roof(wx, wz);if (wy > roof - ROOF) wy = Math.max(py, roof - ROOF);
      const g = env.ground(wx, wz);if (wy < g + GAP && g + GAP < roof - ROOF) wy = g + GAP;
      let dx = wx - px, dy = wy - py, dz = wz - pz;const len = Math.hypot(dx, dy, dz) || 1;dx /= len;dy /= len;dz /= len;
      const room = this.reach(px, py, pz, dx, dy, dz, len, env);
      this.d = first || room < this.d ? room : this.d + (room - this.d) * (1 - Math.exp(-dt * 2.5));
      const o = this.out;o.x = px + dx * this.d;o.y = py + dy * this.d;o.z = pz + dz * this.d;
      // Looking a little ahead of the vehicle (less when the camera is turned round to its side or front).
      const ahead = rig.ahead * Math.max(0, Math.cos(look.yaw || 0));o.ax = px - Math.sin(this.h) * ahead;o.ay = py;o.az = pz - Math.cos(this.h) * ahead;
      return o;
    }
  }
  return {rigFor, steer, Chase, GAP, ROOF, MIN};
});
