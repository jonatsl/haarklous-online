/* Kayaking down Akerselva (issue #45): three put-ins with a kayak rack (Bjølsen, Sagene, Grünerløkka) and the river's real
 * course, width, falls and bridges down to Vaterland, where it disappears into the culvert under the city.
 * Data: akerselva-data.js (tools/make-akerselva.py): centre line every 4 m (local x east, s south), left / right half widths,
 * water level and bank heights (metres relative to the stair door: world y = SURROUNDINGS.ground + value), falls, weirs,
 * bridges, put-ins and the take-out.
 * Pure (Node-tested):
 *   GameKayak.river(data) -> {length, n, at(t), locate(x, s, hint), flow(t), level(t), fallAt(t)}  (t = metres downstream)
 *   new GameKayak.Boat(river) -> place(t, side), step(dt, {fwd, turn}) -> events [{kind: 'bump' | 'fall' | 'finish', …}]
 * Browser:
 *   GameKayak.prepare(districts, D) lowers the ground along the river bed (before Surroundings.create builds it), then sinks
 *     the grid corners that still hold the drawn ground above the water (sinkGrid, issue #63), in the old 4 m grid and the 8 m
 *     patch grids, and lets the walls of buildings by the river reach down to the lowered ground -> {changed, dry, walls}.
 *   waterStrip(R, k0, k1, opts, toW, yOf) builds a water surface (triangles facing up); waterSamples / sinkGrid are pure too.
 *   GameKayak.create({T, lib, data, world, audio, districts}) -> {group, obstacles, groundAt(x, z), racks, prompt(player),
 *     farWater (the ribbon in the far pass, over its own sunk ground),
 *     start(i), update(dt, input, camera) -> {exit?, notice?}, exitPoint(), hud(), remoteBoat(), riverModel, boat, active}
 * Controls (the user's wish): left stick ↑ / W paddle forward, ↓ / S back-paddle, ←→ / A D turn. R3 / V outside view.
 * □ / E gets out on the nearer bank when slow.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameKayak = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const HULL = .7;// half the kayak's footprint across the river when it hits a bank (beam .62 m plus the bow turning)

  // ---------- The river as a curve with widths and water levels ----------
  function river(data) {
    const n = data.level.length, step = data.step, P = data.pts, L = (n - 1) * step;
    const tx = new Float32Array(n), ts = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), dx = P[2 * b] - P[2 * a], ds = P[2 * b + 1] - P[2 * a + 1], l = Math.hypot(dx, ds) || 1;
      tx[k] = dx / l;ts[k] = ds / l;
    }
    const lerpArr = (arr, k, u) => arr[k] + (arr[Math.min(n - 1, k + 1)] - arr[k]) * u;
    function at(t) {
      const f = clamp(t / step, 0, n - 1.0001), k = Math.floor(f), u = f - k, k1 = Math.min(n - 1, k + 1);
      let dx = tx[k] + (tx[k1] - tx[k]) * u, ds = ts[k] + (ts[k1] - ts[k]) * u;const l = Math.hypot(dx, ds) || 1;dx /= l;ds /= l;
      return {x: P[2 * k] + (P[2 * k1] - P[2 * k]) * u, s: P[2 * k + 1] + (P[2 * k1 + 1] - P[2 * k + 1]) * u, dx, ds, wl: lerpArr(data.wl, k, u), wr: lerpArr(data.wr, k, u), level: lerpArr(data.level, k, u), k};
    }
    const level = t => at(t).level;
    // Nearest point of the centre line: t downstream and n across (positive to the right of the flow, x east / s south).
    function locate(x, s, hint) {
      let best = null;
      const k0 = hint == null ? 0 : Math.max(0, hint - 10), k1 = hint == null ? n - 2 : Math.min(n - 2, hint + 10);
      for (let k = k0; k <= k1; k++) {
        const ax = P[2 * k], as = P[2 * k + 1], bx = P[2 * k + 2] - ax, bs = P[2 * k + 3] - as, l2 = bx * bx + bs * bs || 1;
        const u = clamp(((x - ax) * bx + (s - as) * bs) / l2, 0, 1), d2 = (x - ax - bx * u) ** 2 + (s - as - bs * u) ** 2;
        if (!best || d2 < best.d2) best = {k, u, d2};
      }
      const t = (best.k + best.u) * step, c = at(t);
      return {t, n: (x - c.x) * -c.ds + (s - c.s) * c.dx, k: best.k, d: Math.sqrt(best.d2), c};
    }
    // The current: about 0.8 m/s on the calm stretches, faster where the river drops, up to 5.5 m/s in a fall.
    const flow = t => clamp(.75 + (level(t - 8) - level(t + 8)) / 16 * 45, .6, 5.5);
    const fallAt = t => (data.falls || []).find(f => Math.abs(t - f.t) <= f.len / 2 + 2) || null;
    return {length: L, n, step, at, locate, flow, level, fallAt, data};
  }

  // ---------- The boat: paddling on the moving water (local frame, heading h: direction (sin h, cos h)) ----------
  class Boat {
    constructor(R) {this.R = R;this.x = 0;this.s = 0;this.h = 0;this.u = 0;this.v = 0;this.r = 0;this.k = null;this.t = 0;this.n = 0;this.stroke = 0;this.inFall = null;this.done = false;}
    place(t, side = 0) {
      const c = this.R.at(t), off = clamp(side, -c.wl + HULL + .2, c.wr - HULL - .2);
      this.x = c.x - c.ds * off;this.s = c.s + c.dx * off;this.h = Math.atan2(c.dx, c.ds);this.u = this.v = this.r = 0;this.k = c.k;this.t = t;this.n = off;this.inFall = null;this.done = false;
      return this;
    }
    // Speed over the ground (m/s), the boat's own speed through the water, and the current there.
    get ground() {const c = this.R.at(this.t), w = this.R.flow(this.t), fx = Math.sin(this.h), fs = Math.cos(this.h);return {x: c.dx * w + fx * this.u - fs * this.v, s: c.ds * w + fs * this.u + fx * this.v};}
    step(dt, {fwd = 0, turn = 0} = {}) {
      const ev = [], R = this.R;
      // Paddling: forward up to about 3 m/s through the water (a sprinting touring kayak), backward up to 1.2 m/s.
      if (fwd > .05) this.u += 1.8 * fwd * dt * clamp(1 - this.u / 3.1, 0, 1.4);
      else if (fwd < -.05) this.u += 1.3 * fwd * dt * clamp(1 + this.u / 1.2, 0, 1.6);
      this.u -= (.12 * this.u + .1 * this.u * Math.abs(this.u)) * dt;
      this.v *= Math.exp(-2.6 * dt);
      // Turning: stick right = turn right (clockwise seen from above, so h falls); a sweep stroke turns faster when moving slowly.
      const want = -turn * (1.25 + .25 * clamp(1 - Math.abs(this.u) / 2, 0, 1));
      this.r += (want - this.r) * Math.min(1, dt * 4);
      if (Math.abs(fwd) > .05 || Math.abs(turn) > .05) this.stroke += dt * (2.2 + Math.abs(fwd) * 1.4);
      // The current pushes, and in fast water it slowly swings the bow downstream.
      let c = R.at(this.t);const w = R.flow(this.t), flowH = Math.atan2(c.dx, c.ds);
      let dh = flowH - this.h;dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.r += dh * clamp((w - 1) * .25, 0, .9) * dt;
      this.r = clamp(this.r, -2.4, 2.4);this.h += this.r * dt;
      const g = this.ground;this.x += g.x * dt;this.s += g.s * dt;
      // Banks: keep the hull inside the water, lose the speed into the bank, and glance the bow off it.
      const L = R.locate(this.x, this.s, this.k);this.k = L.k;this.t = L.t;this.n = L.n;c = L.c;
      const lo = -c.wl + HULL, hi = c.wr - HULL;
      if (L.n < lo || L.n > hi) {
        const side = L.n > hi ? 1 : -1, target = side > 0 ? Math.max(hi, (lo + hi) / 2) : Math.min(lo, (lo + hi) / 2), push = L.n - target;
        const nx = -c.ds * side, ns = c.dx * side;// unit vector into the bank
        this.x -= -c.ds * push;this.s -= c.dx * push;this.n = target;// back along the river's right vector
        const fx = Math.sin(this.h), fs = Math.cos(this.h), g2 = this.ground, into = g2.x * nx + g2.s * ns;
        if (into > 0) {
          // Remove the part of the boat's own velocity that goes into the bank (plus a little bounce).
          let bx = fx * this.u - fs * this.v, bs = fs * this.u + fx * this.v;bx -= nx * into * 1.3;bs -= ns * into * 1.3;
          this.u = bx * fx + bs * fs;this.v = -bx * fs + bs * fx;
          const headIn = fx * nx + fs * ns;// the bow points into the bank: turn it away
          this.r += -side * Math.sign(fx * c.ds - fs * c.dx || 1) * headIn * Math.min(1, into) * 8 * dt;
          if (into > .5) ev.push({kind: 'bump', speed: into});
        }
      }
      // Falls: report entering one (splash, shake), and the end of the run.
      const f = R.fallAt(this.t);
      if (f && this.inFall !== f) ev.push({kind: 'fall', drop: f.drop});
      this.inFall = f;
      const finish = R.data.finish ? R.data.finish.t : R.length - 30;
      // The ends: a boom 12 m below the finish (before the culvert), and the upstream end of the data.
      for (const [edge, dir] of [[Math.min(R.length - 2, finish + 12), -1], [2, 1]]) {
        if ((this.t - edge) * dir < 0) {const e = R.at(edge), back = (this.t - edge);this.x -= e.dx * back;this.s -= e.ds * back;this.t = edge;const fx = Math.sin(this.h), fs = Math.cos(this.h), along = (fx * e.dx + fs * e.ds) * this.u;if (along * dir < 0) this.u = 0;}
      }
      if (!this.done && this.t >= finish) {this.done = true;ev.push({kind: 'finish'});}
      return ev;
    }
    // Nose-down pitch from the slope of the water under the boat; a small lean into turns.
    get pitch() {const c = this.R.at(this.t);return Math.atan((this.R.level(this.t - 1.6) - this.R.level(this.t + 1.6)) / 3.2) * Math.cos(this.h - Math.atan2(c.dx, c.ds));}
    get roll() {return clamp(this.r * this.u * .12, -.25, .25);}
  }

  // ---------- Lowering the ground along the river bed (before the world is built) ----------
  const DEPTH = .7;
  function insideRing(x, s, ring) {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;}
  function segDist(x, s, a, b) {const dx = b[0] - a[0], ds = b[1] - a[1], l2 = dx * dx + ds * ds || 1, u = clamp(((x - a[0]) * dx + (s - a[1]) * ds) / l2, 0, 1);return Math.hypot(x - a[0] - dx * u, s - a[1] - ds * u);}
  // Quads along the river (every two samples), each with the water level at its lower end.
  function bedQuads(data, margin = 1.5) {
    const R = river(data), out = [];
    for (let k = 0; k + 2 < R.n; k += 2) {
      const a = R.at(k * R.step), b = R.at((k + 2) * R.step);
      const edge = (c, side, half) => [c.x - c.ds * side * (half + margin), c.s + c.dx * side * (half + margin)];
      const ring = [edge(a, -1, a.wl), edge(b, -1, b.wl), edge(b, 1, b.wr), edge(a, 1, a.wr)];
      out.push({ring, rel: Math.min(a.level, b.level) - DEPTH});
    }
    return out;
  }
  // Lower every grid point inside a quad (or within `margin` of it) to the quad's bed level; never raise anything, and keep
  // away from buildings (their walls stand on the ground there).
  function lowerGrid(grid, quads, buildings, margin = 2) {
    let changed = 0;
    for (const q of quads) {
      const xs = q.ring.map(p => p[0]), ss = q.ring.map(p => p[1]);
      const i0 = Math.max(0, Math.ceil((Math.min(...xs) - margin - grid.x0) / grid.step)), i1 = Math.min(grid.nx - 1, Math.floor((Math.max(...xs) + margin - grid.x0) / grid.step));
      const j0 = Math.max(0, Math.ceil((Math.min(...ss) - margin - grid.s0) / grid.step)), j1 = Math.min(grid.ns - 1, Math.floor((Math.max(...ss) + margin - grid.s0) / grid.step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = grid.x0 + i * grid.step, s = grid.s0 + j * grid.step, k = j * grid.nx + i;
        if (grid.get(k) <= q.rel) continue;
        if (!insideRing(x, s, q.ring) && !q.ring.some((p, m) => segDist(x, s, p, q.ring[(m + 1) % q.ring.length]) <= margin)) continue;
        if (buildings.some(b => x > b.x0 - 3 && x < b.x1 + 3 && s > b.s0 - 3 && s < b.s1 + 3 && (insideRing(x, s, b.ring) || b.ring.some((p, m) => segDist(x, s, p, b.ring[(m + 1) % b.ring.length]) < 3)))) continue;
        grid.set(k, q.rel);changed++;
      }
    }
    return changed;
  }
  const boxOf = ring => {const B = {ring, x0: Infinity, x1: -Infinity, s0: Infinity, s1: -Infinity};for (const p of ring) {if (p[0] < B.x0) B.x0 = p[0];if (p[0] > B.x1) B.x1 = p[0];if (p[1] < B.s0) B.s0 = p[1];if (p[1] > B.s1) B.s1 = p[1];}return B;};

  // ---------- Keeping the drawn ground under the water (issue #63) ----------
  // Points on the water surface, every `along` metres and at nine places across (both banks included, and the banks again half
  // way between): the ground drawn there must stay `margin` below the water (top), and is never lowered deeper than the bed
  // (floor). Heights relative to the stair door.
  function waterSamples(data, {along = 1, margin = .08, drop = 0} = {}) {
    const R = river(data), out = [];
    const add = (c, f) => {const off = f < 0 ? f * c.wl : f * c.wr;out.push({x: c.x - c.ds * off, s: c.s + c.dx * off, top: c.level - drop - margin, floor: c.level - drop - DEPTH});};
    for (let t = 0; t <= R.length; t += along) {
      const c = R.at(t);for (let f = -1; f <= 1.001; f += .25) add(c, f);
      if (t + along / 2 <= R.length) {const h = R.at(t + along / 2);add(h, -1);add(h, 1);}
    }
    return out;
  }
  // A ground grid is drawn as two triangles per cell, split along the diagonal from (i + 1, j) to (i, j + 1) (Surroundings'
  // terrainMesh and patchGround). The three corners and their weights at (x, s), or null outside the grid.
  function cellWeights(grid, x, s) {
    const fi = (x - grid.x0) / grid.step, fj = (s - grid.s0) / grid.step, i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= grid.nx - 1 || j >= grid.ns - 1) return null;
    const u = fi - i, v = fj - j, k = j * grid.nx + i;
    return u + v <= 1 ? [[k, 1 - u - v], [k + 1, u], [k + grid.nx, v]] : [[k + grid.nx + 1, u + v - 1], [k + grid.nx, 1 - u], [k + 1, 1 - v]];
  }
  // Lower grid corners just enough that the drawn (triangulated) ground is under the water at every sample: an excess is shared
  // by the corners of its triangle in proportion to their weight (the smallest change), never below the bed, never raising
  // anything, and never at a corner `keep(k)` protects (ground under a building's walls). Returns {changed, dry} (dry: samples
  // still above the water, only where kept corners hold the ground up).
  function sinkGrid(grid, samples, keep = () => false, passes = 12) {
    // Typed arrays over the corners the samples touch (one grid read per corner), then a few passes over the samples.
    const ids = new Map(), keys = [], n = samples.length, tri = new Int32Array(n * 3), wt = new Float64Array(n * 3), top = new Float64Array(n), floor = new Float64Array(n);
    let m = 0;
    for (const p of samples) {
      const w = cellWeights(grid, p.x, p.s);if (!w) continue;
      for (let c = 0; c < 3; c++) {const k = w[c][0];let id = ids.get(k);if (id === undefined) {id = keys.length;ids.set(k, id);keys.push(k);}tri[m * 3 + c] = id;wt[m * 3 + c] = w[c][1];}
      top[m] = p.top;floor[m] = p.floor;m++;
    }
    const cur = Float64Array.from(keys, k => grid.get(k)), start = cur.slice(), fixed = Uint8Array.from(keys, k => keep(k) ? 1 : 0);
    let dry = 0;
    for (let pass = 0; pass <= passes; pass++) {
      dry = 0;
      for (let q = 0; q < m; q++) {
        const a = tri[q * 3], b = tri[q * 3 + 1], c = tri[q * 3 + 2], wa = wt[q * 3], wb = wt[q * 3 + 1], wc = wt[q * 3 + 2];
        const y = cur[a] * wa + cur[b] * wb + cur[c] * wc, over = y - top[q];
        if (over <= 1e-6) continue;
        dry++;if (pass === passes) continue;// the last pass only counts
        const f = floor[q], ua = wa > 1e-6 && cur[a] > f + 1e-6 && !fixed[a], ub = wb > 1e-6 && cur[b] > f + 1e-6 && !fixed[b], uc = wc > 1e-6 && cur[c] > f + 1e-6 && !fixed[c];
        const S = (ua ? wa * wa : 0) + (ub ? wb * wb : 0) + (uc ? wc * wc : 0);if (!S) continue;
        if (ua) cur[a] = Math.max(f, cur[a] - over * wa / S);if (ub) cur[b] = Math.max(f, cur[b] - over * wb / S);if (uc) cur[c] = Math.max(f, cur[c] - over * wc / S);
      }
      if (!dry) break;
    }
    let changed = 0;for (let i = 0; i < keys.length; i++) if (cur[i] < start[i]) {grid.set(keys[i], cur[i]);changed++;}
    return {changed, dry};
  }

  // Before Surroundings.create builds the world: lower the river bed (lowerGrid, for walking and the kayak), then sink the
  // ground corners that still hold the drawn ground above the water (sinkGrid: the old 4 m grid out to ±760 m, the patch tiles
  // beyond), and let the walls of buildings by the river reach down to the lowered ground (`gm`, their lowest ground).
  // Returns {changed (grid points), dry (water samples still under the ground), walls (buildings reaching lower)}.
  function prepare(districts, D, data) {
    data = data || (typeof window !== 'undefined' && window.AKERSELVA);if (!data) return {changed: 0, dry: 0, walls: 0};
    const quads = bedQuads(data), qx0 = Math.min(...quads.flatMap(q => q.ring.map(p => p[0]))) - 30, qx1 = Math.max(...quads.flatMap(q => q.ring.map(p => p[0]))) + 30;
    const qs0 = Math.min(...quads.flatMap(q => q.ring.map(p => p[1]))) - 30, qs1 = Math.max(...quads.flatMap(q => q.ring.map(p => p[1]))) + 30;
    const nearRiver = b => b.x1 > qx0 && b.x0 < qx1 && b.s1 > qs0 && b.s0 < qs1;
    const samples = waterSamples(data), PLAY = 760;// the old square's own 4 m ground is drawn out to ±760 m, patch tiles beyond
    const inPlay = (x, s) => Math.abs(x) <= PLAY && Math.abs(s) <= PLAY;
    const pairs = flat => {const o = [];for (let i = 0; i < flat.length; i += 2) o.push([flat[i], flat[i + 1]]);return o;};
    let changed = 0, dry = 0, old = null;const grids = [];
    const marks = new Set(), mark = (x, s) => marks.add(`${Math.floor(x / 32)},${Math.floor(s / 32)}`);// where corners were lowered
    // The old 4 m grid (surroundings-data.js): decimetres in base64 int16, re-encoded after the change.
    if (D && D.terrain && D.terrain.dm) {
      const T = D.terrain, bin = atob(T.dm), bytes = new Uint8Array(bin.length);for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dm = new Int16Array(bytes.buffer), half = T.half, N = T.n;
      const blds = (D.buildings || []).map(b => boxOf(pairs(b.r.o))).filter(nearRiver);
      // Rounded down to whole decimetres, so a lowered corner never ends up higher than asked.
      old = {T, bytes, dm, half, N, x0: -half, s0: -half, step: T.step, nx: N, ns: N, get: k => dm[k] / 10, set: (k, v) => {dm[k] = Math.min(dm[k], Math.floor(v * 10 + 1e-6));mark(-half + (k % N) * T.step, -half + Math.floor(k / N) * T.step);}};
      changed += lowerGrid(old, quads, blds);
      const r = sinkGrid(old, samples.filter(p => inPlay(p.x, p.s)));changed += r.changed;dry += r.dry;
    }
    for (const d of districts || []) {
      if (!d || !d.h) continue;
      const blds = (d.buildings || []).map(b => boxOf(b.ring)).filter(nearRiver);
      const at = k => [d.x0 + (k % d.nx) * d.step, d.s0 + Math.floor(k / d.nx) * d.step];
      changed += lowerGrid({x0: d.x0, s0: d.s0, step: d.step, nx: d.nx, ns: d.ns, get: k => d.h[k], set: (k, v) => {d.h[k] = v;mark(...at(k));}}, quads, blds);
      // The patch tiles beyond ±760 m: corners inside the old ±800 m square take their height from the old grid (Surroundings'
      // relLocal), so they are read and lowered there.
      const oldK = k => {
        if (!old) return -1;const [x, s] = at(k);if (Math.abs(x) > old.half || Math.abs(s) > old.half) return -1;
        const i = (x - old.x0) / old.step, j = (s - old.s0) / old.step;return Number.isInteger(i) && Number.isInteger(j) ? j * old.N + i : -1;
      };
      const grid = {d, x0: d.x0, s0: d.s0, step: d.step, nx: d.nx, ns: d.ns, get: k => {const o = oldK(k);return o >= 0 ? old.get(o) : d.h[k];}, set: (k, v) => {const o = oldK(k);if (o >= 0) old.set(o, v);d.h[k] = Math.min(d.h[k], v);mark(...at(k));}};
      grids.push(grid);
      const r = sinkGrid(grid, samples.filter(p => !inPlay(p.x, p.s) && p.x >= d.x0 && p.x <= d.x1 && p.s >= d.s0 && p.s <= d.s1));changed += r.changed;dry += r.dry;
    }
    if (old && changed) {let s = '';for (let i = 0; i < old.bytes.length; i += 8192) s += String.fromCharCode.apply(null, old.bytes.subarray(i, i + 8192));old.T.dm = btoa(s);}
    // The ground as drawn (the triangles of the grid that draws (x, s)), and the walls: a building's lowest ground along its walls.
    const drawn = (x, s) => {
      const g = old && inPlay(x, s) ? old : grids.find(q => x >= q.d.x0 && x <= q.d.x1 && s >= q.d.s0 && s <= q.d.s1);if (!g) return Infinity;
      const w = cellWeights(g, x, s);return w ? w.reduce((a, [k, f]) => a + g.get(k) * f, 0) : Infinity;
    };
    const lowestAlong = ring => {let m = Infinity;ring.forEach((a, i) => {const b = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));for (let k = 0; k < n; k++) m = Math.min(m, drawn(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));});return m;};// every 2 m
    let walls = 0;
    const touched = ring => {const B = boxOf(ring);for (let i = Math.floor((B.x0 - 8) / 32); i <= Math.floor((B.x1 + 8) / 32); i++) for (let j = Math.floor((B.s0 - 8) / 32); j <= Math.floor((B.s1 + 8) / 32); j++) if (marks.has(`${i},${j}`)) return true;return false;};
    const reach = (b, ring, now) => {if (!touched(ring)) return;const m = lowestAlong(ring);if (m < now - .05) {b.gm = Math.floor(m * 10) / 10;walls++;}};
    if (changed) {
      for (const b of (D && D.buildings) || []) reach(b, pairs(b.r.o), b.gm ?? b.g ?? 0);
      for (const g of grids) for (const b of g.d.buildings || []) if (b.ring && b.ring.length >= 3) reach(b, b.ring, b.gm ?? Math.min(...b.ring.map(p => drawn(p[0], p[1]))));
    }
    return {changed, dry, walls};
  }

  // A water surface along the river from sample k0 to k1 (every `every` samples, `cols` vertices across, `widen` metres beyond
  // each bank, `lift` above the water level): positions (toW(x, s) -> {x, z}, yOf(level) -> y), uvs and triangles. The triangles
  // turn counter-clockwise seen from above, so they face up: before issue #63 they faced down and the camera culled every one.
  // On the inside of a sharp bend the rows across would cross each other (a fold: triangles facing down, two layers of water
  // that flicker), so there the strip reaches at most 85 % of the bend's radius from the centre line.
  function waterStrip(R, k0, k1, {lift = 0, widen = 0, cols = 5, every = 1} = {}, toW = (x, s) => ({x, z: s}), yOf = v => v) {
    const pos = [], uv = [], idx = [], ks = [];
    for (let k = k0; k < k1; k += every) ks.push(k);
    ks.push(k1);
    const rows = ks.map(k => R.at(k * R.step)), head = rows.map(c => Math.atan2(c.dx, c.ds));
    const capL = rows.map(() => Infinity), capR = rows.map(() => Infinity);
    for (let r = 0; r + 1 < rows.length; r++) {
      let dh = head[r + 1] - head[r];dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const radius = Math.hypot(rows[r + 1].x - rows[r].x, rows[r + 1].s - rows[r].s) / Math.max(1e-6, Math.abs(dh)) * .85, cap = dh > 0 ? capL : capR;// turning left: the left side is inside
      cap[r] = Math.min(cap[r], radius);cap[r + 1] = Math.min(cap[r + 1], radius);
    }
    rows.forEach((c, r) => {
      for (let j = 0; j < cols; j++) {
        const f = j / (cols - 1) * 2 - 1, off = f < 0 ? -Math.min(-f * (c.wl + widen), capL[r]) : Math.min(f * (c.wr + widen), capR[r]), w = toW(c.x - c.ds * off, c.s + c.dx * off);
        pos.push(w.x, yOf(c.level) + lift, w.z);uv.push(j / (cols - 1) * (c.wl + c.wr) / 8, ks[r] * R.step / 8);
      }
      if (r < rows.length - 1) {const a = r * cols;for (let j = 0; j < cols - 1; j++) idx.push(a + j, a + j + 1, a + j + cols, a + j + 1, a + j + cols + 1, a + j + cols);}
    });
    return {pos, uv, idx};
  }

  // ---------- Bridge decks (pure; issue #64) ----------
  // A bridge's profile along its axis, u = metres from the river's centre line (negative toward the left bank). Each end goes
  // out from the bank (at least 1 m) until the ground T(u) comes up to the deck height D (within 0.25 m), or the ground has
  // levelled out (less than 0.1 m rise over 2 m) where a ramp up to the clearance over the water would be no steeper than 30 %,
  // or `reach` metres. Between its ends the deck is straight, but never lower than `clear` over the water.
  // -> [[-eA, T(-eA)], [-bankA, y], [bankB, y], [eB, T(eB)]]: both ends meet the ground.
  function deckProfile(D, clear, bankA, bankB, reach, T) {
    const end = (bank, sign) => {
      const hist = [];
      for (let u = bank + 1; u <= bank + reach + 1e-6; u += .5) {
        const y = T(sign * u);hist.push(y);
        if (y >= D - .25) return [u, y];
        if (hist.length >= 5 && y - hist[hist.length - 5] < .1 && (clear - y) / (u - bank) <= .3) return [u, y];
      }
      return [bank + reach, T(sign * (bank + reach))];
    };
    const [eA, yA] = end(bankA, -1), [eB, yB] = end(bankB, 1), line = u => yA + (yB - yA) * (u + eA) / (eA + eB);
    return [[-eA, yA], [-bankA, Math.max(clear, line(-bankA))], [bankB, Math.max(clear, line(bankB))], [eB, yB]];
  }
  // A box from p to q ([x, y, z]) with a w x h cross-section, `side` the horizontal direction across it ([x, z]), added to a
  // {pos, nor, idx} buffer with flat faces turned outward.
  function box(B, p, q, w, h, side) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];let sd = [side[0] * w / 2, 0, side[1] * w / 2];
    const cr = () => [sd[1] * d[2] - sd[2] * d[1], sd[2] * d[0] - sd[0] * d[2], sd[0] * d[1] - sd[1] * d[0]];
    let up = cr();if (up[1] < 0) {sd = sd.map(v => -v);up = cr();}// keep "up" upward without mirroring the box
    const ul = Math.hypot(...up) || 1;up = up.map(v => v / ul * h / 2);
    const c = (e, a, b) => [e[0] + sd[0] * a + up[0] * b, e[1] + sd[1] * a + up[1] * b, e[2] + sd[2] * a + up[2] * b];
    const nrm = v => {const n = Math.hypot(...v) || 1;return v.map(x => x / n);}, neg = v => v.map(x => -x), dn = nrm(d);
    const face = (v, n) => {const b0 = B.pos.length / 3;v.forEach(x => B.pos.push(...x));for (let k = 0; k < 4; k++) B.nor.push(...n);B.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);};
    face([c(p, 1, -1), c(q, 1, -1), c(q, 1, 1), c(p, 1, 1)], nrm(sd));face([c(q, -1, -1), c(p, -1, -1), c(p, -1, 1), c(q, -1, 1)], neg(nrm(sd)));
    face([c(p, 1, 1), c(q, 1, 1), c(q, -1, 1), c(p, -1, 1)], nrm(up));face([c(p, -1, -1), c(q, -1, -1), c(q, 1, -1), c(p, 1, -1)], neg(nrm(up)));
    face([c(q, 1, -1), c(q, -1, -1), c(q, -1, 1), c(q, 1, 1)], dn);face([c(p, -1, -1), c(p, 1, -1), c(p, 1, 1), c(p, -1, 1)], neg(dn));
  }

  // ---------- Browser: water, banks, bridges, racks, the kayak and its paddle ----------
  function create({T, lib, data, world, audio, districts = []}) {
    const R = river(data), toW = (x, s) => world.toWorld(x, s), G = window.SURROUNDINGS ? window.SURROUNDINGS.ground : 0;
    const yOf = rel => G + rel;
    const group = new T.Group();group.name = 'Akerselva (kayaking)';
    // Ground exists wherever the old grid or a district patch reaches; elsewhere the module draws simple banks itself.
    const half = window.SURROUNDINGS ? window.SURROUNDINGS.terrain.half : 800;
    const covered = (x, s) => (Math.abs(x) <= half && Math.abs(s) <= half) || districts.some(d => x >= d.x0 && x <= d.x1 && s >= d.s0 && s <= d.s1);

    // Water: one strip per 100 samples (so the camera culls the ones out of view), 1.5 m beyond each bank under the ground.
    const tex = (() => {
      const c = document.createElement('canvas');c.width = 128;c.height = 256;const x = c.getContext('2d');x.fillStyle = '#2f4a47';x.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 900; i++) {const v = Math.random();x.fillStyle = v < .5 ? `rgba(20,40,38,${.15 + v * .2})` : `rgba(170,200,190,${(v - .5) * .22})`;x.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 3, 6 + Math.random() * 22);}
      const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;t.colorSpace = T.SRGBColorSpace;return t;
    })();
    // Ripples: a normal map from a blurred noise height field (wrapping), scrolled with the flow.
    const ripples = (() => {
      const N = 128, h = new Float32Array(N * N);for (let i = 0; i < N * N; i++) h[i] = Math.random();
      for (let pass = 0; pass < 3; pass++) {const o = new Float32Array(N * N);for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {let v = 0;for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) v += h[((y + dy + N) % N) * N + (x + dx + N) % N];o[y * N + x] = v / 25;}h.set(o);}
      const c = document.createElement('canvas');c.width = c.height = N;const g = c.getContext('2d'), img = g.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {const sx = (h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N]) * 18, sy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * 18, l = Math.hypot(sx, sy, 1), k = (y * N + x) * 4;img.data[k] = (-sx / l * .5 + .5) * 255;img.data[k + 1] = (-sy / l * .5 + .5) * 255;img.data[k + 2] = (1 / l * .5 + .5) * 255;img.data[k + 3] = 255;}
      g.putImageData(img, 0, 0);const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;return t;
    })();
    // Dark green-blue river water with soft sky reflections (it looked like pale ice with the old mirror-like settings, issue #63).
    const waterMat = new T.MeshStandardMaterial({color: 0x7d9894, map: tex, normalMap: ripples, normalScale: new T.Vector2(.35, .35), roughness: .18, metalness: 0, envMapIntensity: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    const foamTex = (() => {
      const c = document.createElement('canvas');c.width = 128;c.height = 128;const x = c.getContext('2d');
      for (let i = 0; i < 700; i++) {x.fillStyle = `rgba(255,255,255,${.25 + Math.random() * .6})`;x.beginPath();x.ellipse(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 4, 2 + Math.random() * 8, 0, 0, Math.PI * 2);x.fill();}
      const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;return t;
    })();
    const foamMat = new T.MeshBasicMaterial({map: foamTex, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4});
    function strip(k0, k1, lift, widen, mat, opts = {}) {
      const {pos, uv, idx} = waterStrip(R, k0, k1, {lift, widen, ...opts}, toW, yOf);
      const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));geo.setIndex(idx);geo.computeVertexNormals();
      const m = new T.Mesh(geo, mat);m.receiveShadow = true;return m;
    }
    for (let k = 0; k < R.n - 1; k += 100) group.add(strip(k, Math.min(R.n - 1, k + 100), .03, 1.5, waterMat));
    // Far away (beyond the near pass: 450 m on foot, 1.6–9 km in the air) the far pass draws the river: its own coarse ground
    // (8 m in the old square, 16 m in the patches, drawn .5 m low) is sunk under the water like the near grids, and one plain
    // water ribbon (8 m rows, 3 across, 1 draw call) lies on it .45 m below the real level.
    const farWater = (() => {
      if (!world.far) return null;
      const samples = waterSamples(data, {margin: .2, drop: .5}).map(p => ({x: p.x, s: p.s, top: G + p.top, floor: G + p.floor}));
      const meshes = [];world.far.traverse(o => {if (o.isMesh && o.userData.grid) meshes.push(o);});
      meshes.sort((a, b) => a.userData.grid.step - b.userData.grid.step);// the old square's 8 m ground first, then the 16 m patches
      let left = samples;
      for (const m of meshes) {
        const g = m.userData.grid, pos = m.geometry.attributes.position, mine = [], rest = [];
        for (const p of left) (p.x >= g.x0 && p.x <= g.x0 + (g.nx - 1) * g.step && p.s >= g.s0 && p.s <= g.s0 + (g.ns - 1) * g.step ? mine : rest).push(p);
        left = rest;
        const r = sinkGrid({x0: g.x0, s0: g.s0, step: g.step, nx: g.nx, ns: g.ns, get: k => pos.getY(k), set: (k, v) => pos.setY(k, v)}, mine);
        if (r.changed) {pos.needsUpdate = true;if (!g.ownNormals) m.geometry.computeVertexNormals();m.geometry.computeBoundingSphere();}
      }
      const mat = new T.MeshStandardMaterial({color: 0x3a5a5e, roughness: .25, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
      const m = strip(0, R.n - 1, -.45, 1.5, mat, {cols: 3, every: 2});m.receiveShadow = false;m.name = 'Akerselva (far water)';world.far.add(m);
      return m;
    })();
    // White water on the falls and just below them, and on the weirs.
    const white = [...(data.falls || []).map(f => [f.t - f.len / 2 - 2, f.t + f.len / 2 + 14]), ...(data.weirs || []).map(w => [w.t - 3, w.t + 9])];
    for (const [a, b] of white) {const k0 = Math.max(0, Math.floor(a / R.step)), k1 = Math.min(R.n - 1, Math.ceil(b / R.step));if (k1 > k0) group.add(strip(k0, k1, .08, -.3, foamMat));}

    // Simple banks where no map patch has ground yet: a slope from the water's edge up to the bank height, then 9 m flat.
    {
      const grass = new T.MeshStandardMaterial({color: 0x56683a, roughness: .95, side: T.DoubleSide});
      for (const side of [-1, 1]) {
        let run = null;
        const flush = () => {
          if (!run || run.length < 2) {run = null;return;}
          const pos = [], idx = [];
          run.forEach((k, r) => {
            const c = R.at(k * R.step), half = side < 0 ? c.wl : c.wr, top = yOf(side < 0 ? data.bl[k] : data.br[k]);
            for (const [d, y] of [[half - .5, yOf(c.level) - .4], [half + 7, top], [half + 16, top]]) {const w = toW(c.x - c.ds * side * d, c.s + c.dx * side * d);pos.push(w.x, y, w.z);}
            if (r < run.length - 1) {const b = r * 3;for (let j = 0; j < 2; j++) side > 0 ? idx.push(b + j, b + j + 3, b + j + 1, b + j + 1, b + j + 3, b + j + 4) : idx.push(b + j, b + j + 1, b + j + 3, b + j + 1, b + j + 4, b + j + 3);}
          });
          const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setIndex(idx);geo.computeVertexNormals();
          const m = new T.Mesh(geo, grass);m.receiveShadow = true;group.add(m);run = null;
        };
        for (let k = 0; k < R.n; k++) {
          const c = R.at(k * R.step), half = side < 0 ? c.wl : c.wr, p = [c.x - c.ds * side * (half + 8), c.s + c.dx * side * (half + 8)];
          if (!covered(p[0], p[1])) (run = run || []).push(k);else flush();
        }
        flush();
      }
    }

    // Bridges (issue #64): each deck reaches out until it meets the ground at both ends (`deckProfile`: up to the real bridge's
    // height, the data's `deck`, or the top of the bank), so you walk and drive on and off, and it clears the water by 1.8 m
    // (2.2 m for roads). Before, the deck stopped 3.5 m beyond the banks, where the lowered river bed had pulled the ground down,
    // so 43 of the 46 decks ended in a ledge you could not step onto, and the whole rectangle counted as the ground: along the
    // banks the bridges stood as invisible walls, up to 3.6 m high.
    // Now each deck is its own walk floor (`floor`, the ground stays under it, so you walk on along the bank under a bridge),
    // and its railings and underside are obstacles one 2 m piece at a time. All decks are one mesh, all railings another.
    const bridges = [], obstacles = [];
    const deckMat = lib.concrete(0x8d8a84), railMat = lib.metal(0x2f3437, .5), deckB = {pos: [], nor: [], idx: []}, railB = {pos: [], nor: [], idx: []};
    for (const b of data.bridges || []) {
      const c = R.at(b.t);let dx = b.dir[0], ds = b.dir[1];const l = Math.hypot(dx, ds) || 1;dx /= l;ds /= l;
      const across = Math.max(.35, Math.abs(dx * -c.ds + ds * c.dx)), sgn = Math.sign(dx * -c.ds + ds * c.dx) || 1;
      const at = u => toW(c.x + dx * u * sgn, c.s + ds * u * sgn), T = u => {const w = at(u);return world.heightWorld(w.x, w.z);};// u < 0: the left bank's side
      const bankA = c.wl / across, bankB = c.wr / across, clear = yOf(c.level + (b.kind === 'foot' ? 1.8 : 2.2)), D = Math.max(clear, b.deck === undefined ? -Infinity : yOf(b.deck));
      const thick = b.kind === 'foot' ? .35 : .7, w = Math.min(14, b.w);
      const P = deckProfile(D, clear, bankA, bankB, Math.min(30, Math.max(6, l)), T);
      const wa = at(P[0][0]), wb = at(P[3][0]), len = Math.hypot(wb.x - wa.x, wb.z - wa.z), ux = (wb.x - wa.x) / len, uz = (wb.z - wa.z) / len, vx = -uz, vz = ux;
      const prof = P.map(([u, y]) => [u - P[0][0], y]);// metres from end A, deck height
      const deckAt = p => {const q = Math.max(0, Math.min(len, p));for (let i = 0; i < 3; i++) if (q <= prof[i + 1][0] || i === 2) {const [p0, y0] = prof[i], [p1, y1] = prof[i + 1];return y0 + (y1 - y0) * (p1 > p0 ? Math.min(1, (q - p0) / (p1 - p0)) : 0);}};
      const pt = (p, q, y) => [wa.x + ux * p + vx * q, y, wa.z + uz * p + vz * q];
      for (let i = 0; i < 3; i++) {
        const [p0, y0] = prof[i], [p1, y1] = prof[i + 1];if (p1 - p0 < .01) continue;
        box(deckB, pt(p0, 0, y0 - thick / 2), pt(p1, 0, y1 - thick / 2), w, thick, [vx, vz]);
        for (const s of [-1, 1]) box(railB, pt(p0, s * (w / 2 - .05), y0 + .52), pt(p1, s * (w / 2 - .05), y1 + .52), .06, 1.05, [vx, vz]);
      }
      const corners = [[0, -w / 2], [len, -w / 2], [len, w / 2], [0, w / 2]].map(([p, q]) => ({x: wa.x + ux * p + vx * q, z: wa.z + uz * p + vz * q}));
      // The walkable surface: the deck, which over its last 1.5 m at each end bends to the ground across its whole width, so its
      // end lines join the ground exactly and you step on and off anywhere along them.
      const surface = (x, z) => {
        const p = (x - wa.x) * ux + (z - wa.z) * uz;let y = deckAt(p);
        for (const [d, Te] of [[p, prof[0][1]], [len - p, prof[3][1]]]) if (d < 1.5) y += (world.heightWorld(x, z) - Te) * (1 - Math.max(0, d) / 1.5);
        return y;
      };
      const bridge = {name: b.name, kind: b.kind, wa, ux, uz, vx, vz, len, w, deckAt, surface, deck: D, ends: [prof[0][1], prof[3][1]],
        floor: {name: `Bridge${b.name ? ' ' + b.name : ''}`, points: corners, height: p => surface(p.x, p.z), ceilingHeight: Infinity, surfaceKind: 'stone'}};
      bridges.push(bridge);
      // Pieces of at most 2 m: the railings (from the deck's underside to 1.1 m over it) and, away from the ends where it bends to
      // the ground, the deck itself (its underside up to just under its top, so a head under a low deck stops, while people on
      // the deck are free).
      const n = Math.max(1, Math.ceil(len / 2));
      for (let k = 0; k < n; k++) {
        const p0 = len * k / n, p1 = len * (k + 1) / n, lo = Math.min(deckAt(p0), deckAt(p1)), hi = Math.max(deckAt(p0), deckAt(p1));
        const poly = (q0, q1) => [[p0, q0], [p1, q0], [p1, q1], [p0, q1]].map(([p, q]) => ({x: wa.x + ux * p + vx * q, z: wa.z + uz * p + vz * q}));
        for (const s of [-1, 1]) obstacles.push({points: poly(s * (w / 2 - .08), s * w / 2), minY: lo - thick, maxY: hi + 1.1, kind: 'railing'});
        if (p0 >= 1.5 && p1 <= len - 1.5) obstacles.push({points: poly(-w / 2 + .08, w / 2 - .08), minY: lo - thick, maxY: lo - .05, kind: 'bridge deck'});
      }
    }
    for (const [B, mat, name] of [[deckB, deckMat, 'Akerselva bridges (decks)'], [railB, railMat, 'Akerselva bridges (railings)']]) {
      if (!B.idx.length) continue;
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(B.pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(B.nor, 3));g.setIndex(B.idx);g.computeBoundingSphere();
      const m = new T.Mesh(g, mat);m.castShadow = m.receiveShadow = true;m.name = name;group.add(m);
    }
    // The bridge deck under (x, z), or null: for vehicles and anything placed on the ground (walking uses the decks' floors).
    function groundAt(x, z) {
      for (const b of bridges) {
        const dx = x - b.wa.x, dz = z - b.wa.z, p = dx * b.ux + dz * b.uz, q = dx * b.vx + dz * b.vz;
        if (p >= 0 && p <= b.len && Math.abs(q) <= b.w / 2) return b.surface(x, z);
      }
      return null;
    }

    // ---------- Kayak model (also used for other players' kayaks) ----------
    const hullMat = new T.MeshStandardMaterial({color: 0xd8401f, roughness: .35}), deckM = new T.MeshStandardMaterial({color: 0xf0b323, roughness: .4}), black = new T.MeshStandardMaterial({color: 0x15171a, roughness: .6});
    function boatMesh() {
      const g = new T.Group();
      // Hull: a lathe of the plan shape, squashed to a flat-bottomed section; bow toward -z (like the camera at yaw 0).
      const prof = [];for (let i = 0; i <= 20; i++) {const u = i / 20, z = -1.8 + u * 3.6, r = .31 * Math.pow(Math.sin(Math.PI * clamp(u * 1.02, 0, 1)), .62);prof.push(new T.Vector2(Math.max(.001, r), z));}
      // The lathe's axis (+y) turns to the bow (-z); its z becomes height, flattened to a low section; the top half is the deck.
      const hull = new T.Mesh(new T.LatheGeometry(prof, 18), hullMat);hull.rotation.set(-Math.PI / 2, 0, 0);hull.scale.set(1, 1, .48);hull.castShadow = true;g.add(hull);
      const deckTop = new T.Mesh(new T.LatheGeometry(prof, 18, -Math.PI / 2, Math.PI), deckM);deckTop.rotation.set(-Math.PI / 2, 0, 0);deckTop.scale.set(1.01, 1.01, .5);g.add(deckTop);
      const rim = new T.Mesh(new T.TorusGeometry(.3, .03, 6, 24), black);rim.rotation.x = -Math.PI / 2;rim.scale.set(.85, 1.4, 1);rim.position.set(0, .14, .15);g.add(rim);
      const hole = new T.Mesh(new T.CircleGeometry(.29, 20), black);hole.rotation.x = -Math.PI / 2;hole.scale.set(.85, 1.4, 1);hole.position.set(0, .13, .15);g.add(hole);
      return g;
    }
    function paddleMesh() {
      const g = new T.Group(), shaft = new T.Mesh(new T.CylinderGeometry(.016, .016, 2.15, 8), black);shaft.rotation.z = Math.PI / 2;g.add(shaft);
      for (const s of [-1, 1]) {const blade = new T.Mesh(new T.BoxGeometry(.44, .012, .17), deckM);blade.position.x = s * 1.0;blade.rotation.x = s * .5;g.add(blade);}
      const glove = new T.MeshStandardMaterial({color: 0x2b2f36, roughness: .8});for (const s of [-1, 1]) {const h = new T.Mesh(new T.SphereGeometry(.045, 10, 8), glove);h.scale.set(1.2, .9, 1.4);h.position.x = s * .36;g.add(h);}
      return g;
    }
    const kayak = boatMesh();kayak.visible = false;group.add(kayak);
    const paddle = paddleMesh();kayak.add(paddle);paddle.position.set(0, .5, -.25);

    // ---------- Racks at the put-ins (two kayaks and a sign) and a sign at the take-out ----------
    const wood = lib.wood(0x6b4a2b, .8);
    function sign(lines, bg) {
      const c = document.createElement('canvas');c.width = 512;c.height = 256;const x = c.getContext('2d');x.fillStyle = bg;x.fillRect(0, 0, 512, 256);x.strokeStyle = '#fff';x.lineWidth = 10;x.strokeRect(10, 10, 492, 236);
      x.fillStyle = '#fff';x.textAlign = 'center';lines.forEach(([t, size], i) => {x.font = `bold ${size}px Segoe UI, Arial, sans-serif`;x.fillText(t, 256, 72 + i * 62);});
      const tx = new T.CanvasTexture(c);tx.colorSpace = T.SRGBColorSpace;return new T.Mesh(new T.PlaneGeometry(1.3, .65), new T.MeshStandardMaterial({map: tx, side: T.DoubleSide, roughness: .6}));
    }
    const racks = (data.starts || []).map((st, i) => {
      const c = R.at(st.t), half = st.side < 0 ? c.wl : c.wr, d = half + 3, lx = c.x - c.ds * st.side * d, ls = c.s + c.dx * st.side * d, w = toW(lx, ls), y = world.heightWorld(w.x, w.z);
      const along = toW(lx + c.dx, ls + c.ds), yaw = Math.atan2(-(along.x - w.x), -(along.z - w.z));
      const g = new T.Group();g.position.set(w.x, y, w.z);g.rotation.y = yaw;group.add(g);
      for (const z of [-1.1, 1.1]) {const post = new T.Mesh(new T.BoxGeometry(.1, 1.3, .1), wood);post.position.set(0, .65, z);post.castShadow = true;g.add(post);for (const h of [.45, 1.0]) {const arm = new T.Mesh(new T.BoxGeometry(.8, .06, .08), wood);arm.position.set(0, h, z);g.add(arm);}}
      for (const h of [.55, 1.1]) {const k = boatMesh();k.position.set(0, h, 0);k.scale.setScalar(.95);g.add(k);}
      const total = ((data.finish ? data.finish.t : R.length) - st.t) / 1000;
      const s = sign([['AKERSELVA · KAYAK', 44], [st.name.replace(/ \(.*\)/, ''), 40], [`to Vaterland ${total.toFixed(1)} km · □`, 34]], '#1d5f7a');// The sign stands on the river side of the rack and faces the path (the river is on the rack's +x for a left-bank rack).
      s.position.set(-st.side * .9, 1.5, 0);s.rotation.y = st.side * Math.PI / 2;s.castShadow = true;g.add(s);
      const pole = new T.Mesh(new T.CylinderGeometry(.04, .04, 1.2, 8), railMat);pole.position.set(-st.side * .9, .6, 0);g.add(pole);
      return {i, name: st.name, x: w.x, z: w.z, y, t: st.t, side: st.side, km: total};
    });
    if (data.finish) {
      const c = R.at(data.finish.t), d = c.wr + 2.5, w = toW(c.x - c.ds * d, c.s + c.dx * d), s = sign([['VATERLAND', 52], ['End of the run', 38], ['the river goes under the city', 30]], '#8a2a1d');
      s.position.set(w.x, world.heightWorld(w.x, w.z) + 1.6, w.z);s.lookAt(toW(c.x, c.s).x, s.position.y, toW(c.x, c.s).z);group.add(s);
      // A boom across the river just below the finish, so nobody paddles into the culvert.
      const a = toW(c.x + c.ds * (c.wl + 1) + c.dx * 14, c.s - c.dx * (c.wl + 1) + c.ds * 14), b = toW(c.x - c.ds * (c.wr + 1) + c.dx * 14, c.s + c.dx * (c.wr + 1) + c.ds * 14);
      const dir = new T.Vector3(b.x - a.x, 0, b.z - a.z), boom = new T.Mesh(new T.CylinderGeometry(.12, .12, dir.length(), 10), deckM);
      boom.position.set((a.x + b.x) / 2, yOf(R.level(data.finish.t + 14)) + .1, (a.z + b.z) / 2);boom.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());group.add(boom);
    }

    // ---------- Playing ----------
    const boat = new Boat(R);
    let active = false, run = null, view = 0, shake = 0, splashT = 0, pose = null;
    const KEY = 'haarklous-kayak-v1';let best = {};
    const loadBest = () => {try {best = JSON.parse(localStorage.getItem(KEY) || '{}') || {};} catch {best = {};}};
    loadBest();window.addEventListener('haarklous-progress', loadBest);// an account's saved progress was loaded (issue #54)
    const saveBest = () => {try {localStorage.setItem(KEY, JSON.stringify(best));} catch {}};
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const worldYaw = () => {const a = toW(boat.x, boat.s), b = toW(boat.x + Math.sin(boat.h), boat.s + Math.cos(boat.h));return Math.atan2(-(b.x - a.x), -(b.z - a.z));};
    function prompt(p) {
      for (const r of racks) if (Math.hypot(p.x - r.x, p.z - r.z) < 3.2 && Math.abs(p.feet - r.y) < 2) return {text: `□ Take a kayak at ${r.name.replace(/ \(.*\)/, '')}: paddle Akerselva to Vaterland (${r.km.toFixed(1)} km)`, rack: r};
      return null;
    }
    function start(i) {
      const r = racks[i];boat.place(r.t + 3, r.side * 1.2);active = true;view = 0;run = {from: r.name.replace(/ \(.*\)/, ''), key: String(i), t0: 0, time: 0};kayak.visible = true;
      if (audio && audio.sfx) audio.sfx('splash', {gain: .5});
      return `Kayak: left stick ↑ / W paddle · ↓ / S back-paddle · ←→ / A D turn · R3 / V view · □ get out on a bank when slow. ${r.km.toFixed(1)} km to Vaterland.`;
    }
    function stop() {active = false;kayak.visible = false;run = null;pose = null;if (audio && audio.water) audio.water(0);}
    // Where to stand after getting out: on the nearer bank, 2.5 m beyond the water.
    function exitPoint() {
      const c = R.at(boat.t), side = boat.n >= 0 ? 1 : -1, d = (side > 0 ? c.wr : c.wl) + 2.5, w = toW(c.x - c.ds * side * d, c.s + c.dx * side * d);
      return {x: w.x, z: w.z, yaw: worldYaw()};
    }
    const canExit = () => Math.hypot(boat.ground.x, boat.ground.s) < 1.6 && (boat.n > R.at(boat.t).wr - HULL - 1.8 || boat.n < -R.at(boat.t).wl + HULL + 1.8);
    // look: {yaw, pitch} of the head (right stick / mouse), kept by game-main.
    function update(dt, input, camera, look = {yaw: 0, pitch: 0}) {
      if (!active) return {};
      const out = {};
      run.time += dt;
      const fwd = clamp(-(input.move.y || 0), -1, 1), turn = clamp(input.move.x || 0, -1, 1);
      for (const e of boat.step(dt, {fwd, turn})) {
        if (e.kind === 'bump' && audio && audio.sfx) audio.sfx('thud', {gain: Math.min(1, e.speed / 2)});
        if (e.kind === 'fall') {shake = Math.min(1.2, .3 + e.drop / 8);if (audio && audio.sfx) audio.sfx('splash', {gain: Math.min(1, .4 + e.drop / 10)});out.notice = e.drop > 4 ? `Waterfall! ${e.drop.toFixed(0)} m down` : 'White water!';}
        if (e.kind === 'finish') {
          const prev = best[run.key], isBest = !prev || run.time < prev;if (isBest) {best[run.key] = Math.round(run.time * 10) / 10;saveBest();}
          out.finish = {from: run.from, time: run.time, best: best[run.key], isBest, km: ((data.finish ? data.finish.t : R.length) - racks[+run.key].t) / 1000};
          out.notice = `Vaterland! ${run.from} → Vaterland in ${fmt(run.time)}${isBest ? ' – your best' : ` (best ${fmt(best[run.key])})`}. □ get out on the bank.`;
        }
      }
      if (input.pressed && (input.pressed.has('r3') || input.pressed.has('view'))) view = 1 - view;
      if (input.pressed && input.pressed.has('square')) {if (canExit() || boat.done) out.exit = exitPoint();else out.notice = 'Slow down beside a bank to get out (back-paddle with ↓ / S).';}
      // Pose the kayak on the water.
      const w = toW(boat.x, boat.s), y = yOf(R.level(boat.t)) + .02 + Math.sin(performance.now() / 700) * .02, yaw = worldYaw();
      kayak.position.set(w.x, y, w.z);kayak.rotation.order = 'YXZ';kayak.rotation.set(-boat.pitch, yaw, boat.roll);
      // Paddle: alternate strokes while paddling, held across the deck when resting.
      const ph = boat.stroke * Math.PI, k = Math.abs(fwd) > .05 || Math.abs(turn) > .05 ? 1 : 0;
      paddle.rotation.set(0, Math.sin(ph) * .55 * k * Math.sign(fwd || 1), Math.cos(ph) * .5 * k + (1 - k) * .05);
      paddle.position.set(Math.sin(ph) * .05 * k, .52 - Math.abs(Math.cos(ph)) * .08 * k, -.3);
      kayak.updateMatrixWorld(true);
      // Camera: in the cockpit (first person), or behind and above (R3 / V).
      shake = Math.max(0, shake - dt * .8);const sh = shake ? (Math.random() - .5) * .05 * shake : 0;
      if (view === 0) {
        const eye = new T.Vector3(0, .78, .12).applyMatrix4(kayak.matrixWorld);camera.position.copy(eye);camera.rotation.order = 'YXZ';
        camera.rotation.set(-boat.pitch * .6 + look.pitch + sh, yaw + look.yaw, boat.roll * .5 + sh);
      } else {
        const back = new T.Vector3(Math.sin(yaw + look.yaw), 0, Math.cos(yaw + look.yaw)), at = new T.Vector3(w.x, y + .6, w.z), cam = at.clone().addScaledVector(back, 6.5);cam.y += 2.6;
        camera.position.copy(cam);camera.lookAt(at);
      }
      if (camera.fov !== 72) {camera.fov = 72;camera.updateProjectionMatrix();}
      // Rushing water: louder in falls and fast water.
      if (audio && audio.water) audio.water(clamp((R.flow(boat.t) - .6) / 3, .08, 1));
      splashT -= dt;if (k && splashT <= 0 && audio && audio.sfx) {splashT = .55 / (1 + Math.abs(fwd));audio.sfx('paddle', {gain: .35 + Math.abs(fwd) * .3});}
      out.pos = pose = {x: w.x, y, z: w.z, yaw};
      return out;
    }
    function hud() {
      if (!active) return '';
      const g = boat.ground, left = Math.max(0, (data.finish ? data.finish.t : R.length) - boat.t);
      return `Kayak · ${(Math.hypot(g.x, g.s) * 3.6).toFixed(1)} km/h · ${left > 950 ? (left / 1000).toFixed(1) + ' km' : Math.round(left) + ' m'} to Vaterland · ${fmt(run ? run.time : 0)}${best[run && run.key] ? ` · best ${fmt(best[run.key])}` : ''}${canExit() ? ' · □ get out' : ''}`;
    }
    // A tick for the water's flow animation (always, so the river moves when you walk past).
    function tick(dt) {tex.offset.y -= dt * .1;ripples.offset.y -= dt * .12;foamTex.offset.y -= dt * .6;}
    const poi = () => racks.map(r => {const l = world.toLocal(r.x, r.z);return {x: l.x, s: l.s, color: '#1d5f7a', label: `Kayak: ${r.name.replace(/ \(.*\)/, '')}`, glyph: '🛶'};});
    return {group, obstacles, groundAt, racks, bridges, farWater, prompt, start, stop, update, hud, tick, exitPoint, remoteBoat: () => boatMesh(), poi, riverModel: R, boat, get active() {return active;}, get view() {return view;}, get pose() {return active ? pose : null;}, canExit, get best() {return best;}};
  }

  return {river, Boat, bedQuads, lowerGrid, waterSamples, cellWeights, sinkGrid, waterStrip, deckProfile, box, prepare, create, HULL};
});
