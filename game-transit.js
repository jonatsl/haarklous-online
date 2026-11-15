/* Metro, bus and tram on a timetable (issue #111): the vehicles, the stops, riding, the timetable panel and the metro stations.
 *
 * The user (15 Nov 2026): "implement metro, bus and tram. they should arrive regularly, e.g. similar to their real time tables.
 * doesnt have to be actual real-time. Make a time table at each stop/make it easy to know where they go and when they come."
 *
 * Data: transit-data.js (tools/make-transit.cjs from OpenStreetMap's route relations); timetable: transit-timetable.js (pure);
 * models: transit-models.js; metro stations: transit-stations.js.
 *
 * GameTransit.prepare(districts, data, heightOf, groundY) – before Surroundings.create: plans the metro stations (the ground
 *   where their entrances go down is cut out of the patches, like Construction City's).
 * GameTransit.create({T, lib, world, data, ground(x, z) (the game's run-time ground), clock() -> ms, root, notice, audio, wallet,
 *   kr, rects}) -> {
 *   group, floors, obstacles, poi(), cutsGround(x, z), tick(dt, {camera, player}), prompt(player) -> {text, act} | null,
 *   ride (null or the ride), updateRide(dt, input, camera, dl), leave(), localState(), pose(r, st, g) (other players aboard),
 *   footprints() (the vehicles near you, for the walk and vehicle worlds), panel {open, input(input), close()},
 *   overlay(g, {P, k, d, big}) (map), deep (camera underground in a station or tunnel), keepClear(x, z, halfWidth) -> {x, z} | null,
 *   timetable: the decoded lines (test handle) }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameTransit = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const TICKET = 46, TICKET_MIN = 60;// Ruter's single ticket for zone 1 (adult, 2026), valid 60 minutes
  const KR = v => `${v} kr`;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
  const kindOf = line => line.mode === 'bus' ? (line.artic ? 'artic' : 'bus') : line.mode;
  const MODE_NAME = {tram: 'Tram', bus: 'Bus', metro: 'Metro'};
  const hhmm = (ms, TT) => {const d = new Date(ms + TT.osloOffset(ms));return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;};
  // ---------- Metro stations, planned before the world is built ----------
  let PLAN = null;
  function stationStops(TT, N) {
    // For each station: where each direction of each metro line stops there (local), and whether that is in a tunnel.
    return N.stations.map(st => {
      const stops = [];
      for (const d of N.dirs) if (d.line.mode === 'metro') for (const s of d.stops) if (s.place === st.place) {
        const p = TT.pointAt(d, s.d);let open = false;for (let k = Math.max(0, s.k - 35); k <= Math.min(d.n - 1, s.k + 35); k++) if (!d.tunnel[k]) open = true;
        if (!stops.some(q => Math.hypot(q.x - p.x, q.s - p.s) < .8)) stops.push({x: p.x, s: p.s, hx: p.hx, hs: p.hs, tunnel: !!d.tunnel[s.k], openNear: open});
      }
      return {st, stops};
    });
  }
  // Is a point (local) inside a building of the district patches? (A coarse grid of their outlines.)
  function buildingTest(districts) {
    const grid = new Map(), C = 32;
    for (const d of districts || []) for (const b of d.buildings || []) {
      const xs = b.ring.map(p => p[0]), ss = b.ring.map(p => p[1]), bb = [Math.min(...xs), Math.min(...ss), Math.max(...xs), Math.max(...ss)];
      for (let i = Math.floor(bb[0] / C); i <= Math.floor(bb[2] / C); i++) for (let j = Math.floor(bb[1] / C); j <= Math.floor(bb[3] / C); j++) {const k = i + ',' + j;if (!grid.has(k)) grid.set(k, []);grid.get(k).push({ring: b.ring, bb});}
    }
    const inRing = (x, s, r) => {let o = false;for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[i], b = r[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) o = !o;}return o;};
    return (x, s) => (grid.get(Math.floor(x / C) + ',' + Math.floor(s / C)) || []).some(q => x >= q.bb[0] && x <= q.bb[2] && s >= q.bb[1] && s <= q.bb[3] && inRing(x, s, q.ring));
  }
  function plan(data, ground, built) {
    const TT = window.TransitTimetable, TS = window.TransitStations, N = TT.decode(data);
    return stationStops(TT, N).filter(q => q.stops.length).map(({st, stops}) => {
      const layer = Math.min(0, ...st.platforms.map(p => p.layer || 0));
      const sp = TS.spec(st, stops, {ground, layer});
      return {sp, L: TS.layout(sp, ground, built)};
    });
  }
  function prepare(districts, data, heightOf, groundY) {
    if (!data || !window.TransitStations) return null;
    const patchOf = (x, s) => districts.find(d => x >= d.x0 && x <= d.x1 && s >= d.s0 && s <= d.s1);
    const ground = (x, s) => {const d = patchOf(x, s);return groundY + (d ? heightOf(d, x, s) : 0);};
    PLAN = plan(data, ground, buildingTest(districts));
    for (const {L} of PLAN) for (const c of L.cuts) {
      const xs = c.map(p => p[0]), ss = c.map(p => p[1]);
      for (const d of districts) if (Math.max(...xs) >= d.x0 && Math.min(...xs) <= d.x1 && Math.max(...ss) >= d.s0 && Math.min(...ss) <= d.s1) d.cuts = (d.cuts || []).concat([c]);
    }
    return PLAN;
  }
  function create(ctx) {
    const {T, world, data} = ctx, TT = window.TransitTimetable, TM = window.TransitModels, TS = window.TransitStations;
    const N = TT.decode(data), models = TM.create({T}), group = new T.Group();group.name = 'Transit';
    const o0 = world.toWorld(0, 0), e1 = world.toWorld(1, 0), e2 = world.toWorld(0, 1);
    const EX = {x: e1.x - o0.x, z: e1.z - o0.z}, ES = {x: e2.x - o0.x, z: e2.z - o0.z};
    const W = (x, s) => ({x: o0.x + EX.x * x + ES.x * s, z: o0.z + EX.z * x + ES.z * s});
    const dirW = (hx, hs) => ({x: EX.x * hx + ES.x * hs, z: EX.z * hx + ES.z * hs});
    const toLocal = (x, z) => world.toLocal(x, z);
    const ground = (x, z) => ctx.ground(x, z), terrain = (x, z) => world.heightWorld(x, z);
    const now = () => ctx.clock();
    const rects = ctx.rects || [];
    const inWorld = (x, s, m = 40) => !rects.length || rects.some(r => x >= r.x0 - m && x <= r.x1 + m && s >= r.s0 - m && s <= r.s1 + m);
    // ---------- Metro stations ----------
    if (!PLAN) PLAN = plan(data, (x, s) => {const p = W(x, s);return terrain(p.x, p.z);});
    // Open stations are planned again on the game's own ground (prepare() only knows the district patches' heights, and
    // Sinsen is in the old square); they cut no ground, so this changes nothing that was built before.
    const groundL = (x, s) => {const p = W(x, s);return terrain(p.x, p.z);};
    const SS = stationStops(TT, N);
    const stations = PLAN.map(({sp, L}) => {
      if (!sp.underground) {const q = SS.find(o => o.st.name === sp.name);if (q) {sp = TS.spec(q.st, q.stops, {ground: groundL, layer: 0});L = TS.layout(sp, groundL);}}
      return {sp, L, place: N.places.find(p => p.name === sp.name && p.metro), built: null};
    });
    const floors = [], obstacles = [], cutPolys = [];
    const wPts = pts => pts.map(([x, s]) => W(x, s));
    for (const S of stations) {
      const {sp, L} = S;
      for (const f of L.floors) {
        const points = wPts(f.points), out = {points, name: f.name, surfaceKind: 'stone'};
        if (f.slope) {const o = W(...f.slope.o), d = dirW(...f.slope.dir), g = f.slope.g;out.y = f.slope.y;out.slope = {x: -d.x * g, z: -d.z * g, origin: o};}
        else if (f.height === 'threshold') {const o = W(...f.o), d = dirW(...f.dir), y = f.y;out.height = p => {const t = Math.max(0, Math.min(1, ((p.x - o.x) * d.x + (p.z - o.z) * d.z) / .8));return terrain(p.x, p.z) * (1 - t) + y * t;};}
        else if (f.ramp) {const r = f.ramp, c = W(...sp.c), a = dirW(...sp.a);out.height = p => {const u = (p.x - c.x) * a.x + (p.z - c.z) * a.z, t = Math.max(0, Math.min(1, (u - r.u0) / (r.u1 - r.u0)));return Math.max(r.y0 + (r.y1 - r.y0) * t, terrain(p.x, p.z));};}
        else if (f.raised) {const y = f.y;out.height = p => Math.max(y, terrain(p.x, p.z));}
        else out.y = f.y;
        floors.push(out);
      }
      for (const o of L.obstacles) obstacles.push({points: wPts(o.points), minY: o.minY, maxY: o.maxY, kind: o.kind});
      for (const c of L.cuts) cutPolys.push({pts: wPts(c), b: bounds(wPts(c))});
      // the pavilion's walls and roof posts stop cars too
      if (L.kiosk) {
        const k = L.kiosk, at = (t, w) => W(k.E[0] + k.dir[0] * t - k.dir[1] * w, k.E[1] + k.dir[1] * t + k.dir[0] * w);
        for (const w of [-k.hw - .45, k.hw + .45]) obstacles.push({points: thinW(at(.2, w), at(k.K, w), .12), minY: k.top - 1, maxY: k.top + 3.2, kind: 'station'});
      }
    }
    function bounds(p) {return {x0: Math.min(...p.map(q => q.x)), x1: Math.max(...p.map(q => q.x)), z0: Math.min(...p.map(q => q.z)), z1: Math.max(...p.map(q => q.z))};}
    function thinW(a, b, t) {const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * t, nz = dx / L * t;return [{x: a.x - nx, z: a.z - nz}, {x: b.x - nx, z: b.z - nz}, {x: b.x + nx, z: b.z + nz}, {x: a.x + nx, z: a.z + nz}];}
    const inPoly = (x, z, pts) => {let r = false;for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {const a = pts[i], b = pts[j];if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) r = !r;}return r;};
    const cutsGround = (x, z) => cutPolys.some(c => x >= c.b.x0 && x <= c.b.x1 && z >= c.b.z0 && z <= c.b.z1 && inPoly(x, z, c.pts));
    // ---------- Metro heights along the track (rail level) ----------
    // Open track: the ground, smoothed over ±20 m. A station: its platform level over the platform. Tunnel: a straight
    // line between those, kept at least 7 m under the ground once 80 m away from a portal.
    const railY = new Map();
    function metroY(dir) {
      if (railY.has(dir)) return railY.get(dir);
      const n = dir.n, g = new Float32Array(n), Y = new Float32Array(n), pin = new Uint8Array(n);
      for (let k = 0; k < n; k++) {const p = W(dir.X[k], dir.S[k]);g[k] = terrain(p.x, p.z);}
      const gs = new Float32Array(n);for (let k = 0; k < n; k++) {let a = 0, c = 0;for (let j = Math.max(0, k - 10); j <= Math.min(n - 1, k + 10); j++) {a += g[j];c++;}gs[k] = a / c;}
      for (let k = 0; k < n; k++) if (!dir.tunnel[k]) {Y[k] = gs[k];pin[k] = 1;}
      for (const st of dir.stops) {
        const S = stations.find(q => q.place && q.place === st.place);if (!S) continue;
        const half = TS.PLAT / 2 + 8;for (let k = Math.max(0, st.k - Math.round(half / TT.STEP)); k <= Math.min(n - 1, st.k + Math.round(half / TT.STEP)); k++) {Y[k] = S.sp.rail;pin[k] = 1;}
      }
      // runs of unpinned samples: interpolate between their pinned ends
      for (let k = 0; k < n;) {
        if (pin[k]) {k++;continue;}
        let e = k;while (e < n && !pin[e]) e++;
        const a = k - 1, b = e;// pinned neighbours (may be off the ends)
        const ya = a >= 0 ? Y[a] : (b < n ? Y[b] : gs[k] - 12), yb = b < n ? Y[b] : ya;
        for (let j = k; j < e; j++) {
          const t = (j - a) / (b - a), lin = a < 0 ? yb : b >= n ? ya : ya + (yb - ya) * t;
          const fromPortal = Math.min(a >= 0 && !dir.tunnel[a] ? (j - a) * TT.STEP : 1e9, b < n && !dir.tunnel[b] ? (b - j) * TT.STEP : 1e9);
          const w = Math.min(1, fromPortal / 80), cap = gs[j] - 7;
          Y[j] = lin > cap ? lin - (lin - cap) * w : lin;
        }
        k = e;
      }
      railY.set(dir, Y);return Y;
    }
    const metroAt = (dir, d) => {const Y = metroY(dir), k = Math.max(0, Math.min(dir.n - 2, Math.floor(d / TT.STEP))), t = Math.max(0, Math.min(1, d / TT.STEP - k));return Y[k] + (Y[k + 1] - Y[k]) * t;};
    // ---------- Tunnel mouths ----------
    // Where a metro track goes from the open into a long tunnel (or out of one): a concrete portal with a dark inside, walls along
    // the track in front of it, and a cut-and-cover box over the first stretch, which goes on until the ground covers it. The
    // track goes down inside the box, so a train is seen driving into the mouth, not sinking into the ground. Solid for walkers.
    const portals = [];
    {
      const groups = [];
      for (const d of N.dirs) {
        if (d.line.mode !== 'metro') continue;
        for (let k = 1; k < d.n; k++) {
          if (d.tunnel[k] === d.tunnel[k - 1]) continue;
          const sg = d.tunnel[k] ? 1 : -1, k0 = d.tunnel[k] ? k : k - 1;// sg: the tunnel lies ahead (+1) or behind (-1) along the line
          let run = 0;for (let j = k0; j >= 0 && j < d.n && d.tunnel[j]; j += sg) run += TT.STEP;
          if (run < 160 || !inWorld(d.X[k0], d.S[k0], 0)) continue;// a short tunnel (under a bridge) keeps the train at the ground
          if (stations.some(S => S.sp.underground && Math.hypot(d.X[k0] - S.sp.c[0], d.S[k0] - S.sp.c[1]) < TS.HALL / 2 + 8)) continue;
          let g = groups.find(q => Math.hypot(q.x - d.X[k0], q.s - d.S[k0]) < 18);
          if (!g) {g = {x: d.X[k0], s: d.S[k0], tracks: []};groups.push(g);}
          if (!g.tracks.some(t => Math.hypot(t.d.X[t.k] - d.X[k0], t.d.S[t.k] - d.S[k0]) < 1.5)) g.tracks.push({d, k: k0, sg});
        }
      }
      const pos = [], col = [], dark = [];
      const c3 = hex => {const c = new T.Color(hex);return [c.r, c.g, c.b];};
      const quad = (a, b, c, d, k) => {pos.push(...a, ...b, ...c, ...a, ...c, ...d);for (let i = 0; i < 6; i++) col.push(...k);};
      for (const g of groups) {
        const t0 = g.tracks[0], d0 = t0.d, sg = t0.sg, kk = j => Math.max(0, Math.min(d0.n - 1, j));
        // the frame: u into the tunnel along the first track, v across; the tracks' offsets give the width
        const ux = (d0.X[kk(t0.k + 4 * sg)] - d0.X[t0.k]), us = (d0.S[kk(t0.k + 4 * sg)] - d0.S[t0.k]), ul = Math.hypot(ux, us) || 1;
        const a = [ux / ul, us / ul], n = [-a[1], a[0]];
        const vs = g.tracks.map(t => (t.d.X[t.k] - d0.X[t0.k]) * n[0] + (t.d.S[t.k] - d0.S[t0.k]) * n[1]);
        const v0 = Math.min(...vs) - 2.95, v1 = Math.max(...vs) + 2.95, vm = (v0 + v1) / 2;
        const o = [d0.X[t0.k], d0.S[t0.k]], L = (u, v) => [o[0] + a[0] * u + n[0] * v, o[1] + a[1] * u + n[1] * v];
        const railAt = u => metroY(d0)[kk(t0.k + Math.round(u / TT.STEP) * sg)];
        const P3 = (u, v, y) => {const q = W(...L(u, v));return [q.x, y, q.z];};
        const gr = (u, v) => {const q = W(...L(u, v));return terrain(q.x, q.z);};
        const concrete = c3(0xa7a49c), dim = c3(0x86837c), H = 5.4, rail0 = railAt(0);
        // the cut-and-cover box: its walls (both faces), roof and ceiling, 2 m at a time, until the ground is over its roof
        let end = 0, buried = 0;
        for (let u = 0; u < 70 && buried < 3; u += 2) {
          const ya = railAt(u), yb = railAt(u + 2), topA = ya + H, topB = yb + H;
          for (const [v, sv] of [[v0, -1], [v1, 1]]) {
            quad(P3(u, v, ya - .4), P3(u + 2, v, yb - .4), P3(u + 2, v, topB), P3(u, v, topA), dim);
            quad(P3(u, v + sv * .45, ya - .4), P3(u + 2, v + sv * .45, yb - .4), P3(u + 2, v + sv * .45, topB + .45), P3(u, v + sv * .45, topA + .45), concrete);
          }
          quad(P3(u, v0 - .45, topA + .45), P3(u + 2, v0 - .45, topB + .45), P3(u + 2, v1 + .45, topB + .45), P3(u, v1 + .45, topA + .45), concrete);
          quad(P3(u, v0, topA), P3(u, v1, topA), P3(u + 2, v1, topB), P3(u + 2, v0, topB), c3(0x2a2a2c));// the ceiling inside
          end = u + 2;
          if ([v0 - .45, vm, v1 + .45].every(v => gr(u + 2, v) > topB + .8)) buried++;else buried = 0;
        }
        // the dark inside, 3 m in: the train drives into it
        const yd = railAt(3);dark.push(...P3(3, v0, yd - .4), ...P3(3, v1, yd - .4), ...P3(3, v1, yd + H), ...P3(3, v0, yd - .4), ...P3(3, v1, yd + H), ...P3(3, v0, yd + H));
        // the portal face: pillars and the lintel round the opening, a parapet on top
        for (const [va, vb] of [[v0 - .45, v0], [v1, v1 + .45]]) quad(P3(-.05, va, rail0 - .4), P3(-.05, vb, rail0 - .4), P3(-.05, vb, rail0 + H + 1.1), P3(-.05, va, rail0 + H + 1.1), concrete);
        quad(P3(-.05, v0, rail0 + H), P3(-.05, v1, rail0 + H), P3(-.05, v1, rail0 + H + 1.1), P3(-.05, v0, rail0 + H + 1.1), concrete);
        quad(P3(-.05, v0 - .45, rail0 + H + 1.1), P3(-.05, v1 + .45, rail0 + H + 1.1), P3(1.2, v1 + .45, rail0 + H + 1.1), P3(1.2, v0 - .45, rail0 + H + 1.1), dim);
        // walls along the track in front: from the portal's height down to 1.2 m over the rail, 18 m out
        const wtop = (u, y) => Math.max(rail0 + H * (1 + u / 18 * .78), y + 1.2);
        for (const [v, sv] of [[v0, -1], [v1, 1]]) for (let u = 0; u > -18; u -= 2) {
          const ya = railAt(u), yb = railAt(u - 2), ta = wtop(u, ya), tb = wtop(u - 2, yb);
          quad(P3(u, v, ya - .4), P3(u - 2, v, yb - .4), P3(u - 2, v, tb), P3(u, v, ta), dim);
          quad(P3(u - 2, v + sv * .35, yb - .4), P3(u, v + sv * .35, ya - .4), P3(u, v + sv * .35, ta), P3(u - 2, v + sv * .35, tb), concrete);
          quad(P3(u, v, ta), P3(u - 2, v, tb), P3(u - 2, v + sv * .35, tb), P3(u, v + sv * .35, ta), concrete);
        }
        // solid for walkers (and cars): the box's walls, the wing walls, and the mouth itself
        const gMin = Math.min(gr(0, vm), rail0) - 2;
        const wallL = (ua, ub, v, t) => obstacles.push({points: [L(ua, v - t), L(ub, v - t), L(ub, v + t), L(ua, v + t)].map(q => W(...q)), minY: gMin, maxY: rail0 + H + 1.2, kind: 'portal'});
        wallL(-18, end, v0 - .22, .25);wallL(-18, end, v1 + .22, .25);wallL(.3, 1.2, vm, (v1 - v0) / 2);
        portals.push({x: o[0], s: o[1], tracks: g.tracks.length, length: end, rail: rail0, refs: [...new Set(g.tracks.map(t => t.d.line.ref))], face: W(...L(-14, vm)), look: W(...L(4, vm))});
      }
      if (pos.length) {
        const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));geo.computeVertexNormals();
        const m = new T.Mesh(geo, new T.MeshStandardMaterial({vertexColors: true, roughness: .9, side: T.DoubleSide}));m.name = 'Metro tunnel mouths';m.castShadow = m.receiveShadow = true;group.add(m);
        const dg = new T.BufferGeometry();dg.setAttribute('position', new T.Float32BufferAttribute(dark, 3));
        const dm = new T.Mesh(dg, new T.MeshBasicMaterial({color: 0x050506, side: T.DoubleSide}));dm.name = 'Metro tunnel mouths, the dark inside';group.add(dm);portals.dark = dm;
      }
    }
    // ---------- Vehicle poses (pure apart from the ground) ----------
    function sectionsAt(dir, d) {
      const line = dir.line, K = TM.KINDS[kindOf(line)], out = [], metro = line.mode === 'metro';
      let head = d + K.length / 2;
      for (const S of K.sections) {
        const c = head - S.len / 2, fd = c + S.len / 2 - .9, bd = c - S.len / 2 + .9;
        const f = TT.pointAt(dir, fd), b = TT.pointAt(dir, bd);
        const fx = f.x + (fd - Math.max(0, Math.min(dir.n * TT.STEP - TT.STEP, fd))) * f.hx, fs = f.s + (fd - Math.max(0, Math.min(dir.n * TT.STEP - TT.STEP, fd))) * f.hs;
        const bx = b.x + (bd - Math.max(0, Math.min(dir.n * TT.STEP - TT.STEP, bd))) * b.hx, bs = b.s + (bd - Math.max(0, Math.min(dir.n * TT.STEP - TT.STEP, bd))) * b.hs;
        const Fw = W(fx, fs), Bw = W(bx, bs);
        const fy = metro ? metroAt(dir, fd) : ground(Fw.x, Fw.z), by = metro ? metroAt(dir, bd) : ground(Bw.x, Bw.z);
        const dx = Fw.x - Bw.x, dz = Fw.z - Bw.z, L = Math.hypot(dx, dz) || 1;
        out.push({x: (Fw.x + Bw.x) / 2, y: (fy + by) / 2, z: (Fw.z + Bw.z) / 2, yaw: Math.atan2(dx, dz), pitch: -Math.atan2(fy - by, L), len: S.len, fx: dx / L, fz: dz / L, ls: (fx + bx) / 2, ss: (fs + bs) / 2});
        head -= S.len + K.gap;
      }
      return out;
    }
    const parseKey = key => {const [li, di, dep] = String(key).split('.').map(Number);const line = N.lines[li], dir = line && line.dirs[di];return dir ? {dir, dep: dep * 1000} : null;};
    // ---------- Vehicles near you ----------
    const pools = {tram: [], bus: [], artic: [], metro: []}, active = new Map();// run key -> {veh, dir, dep}
    const CAP = {tram: 8, bus: 10, artic: 8, metro: 6}, RANGE = {tram: 380, bus: 330, artic: 330, metro: 520};
    function grab(kind) {let v = pools[kind].find(q => !q.used);if (!v) {if (pools[kind].length >= CAP[kind]) return null;v = models.make(kind);group.add(v.group);pools[kind].push(v);}v.used = true;v.group.visible = true;return v;}
    let selT = 0, camL = {x: 0, s: 0}, camY = 0, under = false;
    function select(camera, rideKey) {
      const ms = now(), c = toLocal(camera.position.x, camera.position.z), want = [];
      camL = c;camY = camera.position.y;
      for (const dir of N.dirs) {
        const kind = kindOf(dir.line), R = RANGE[kind];
        for (const r of TT.runsAt(dir, ms)) {
          const st = TT.at(dir, r.tau);if (!st || st.gone) continue;
          const p = TT.pointAt(dir, st.d), dist = Math.hypot(p.x - c.x, p.s - c.s);
          if (r.key !== rideKey && (dist > R || !inWorld(p.x, p.s))) continue;
          if (r.key !== rideKey && kind !== 'metro' && dir.tunnel[Math.min(dir.n - 1, Math.round(st.d / TT.STEP))]) continue;// buses and trams in a road tunnel are not drawn
          want.push({key: r.key, dir, dep: r.dep, kind, dist: r.key === rideKey ? -1 : dist});
        }
      }
      want.sort((a, b) => a.dist - b.dist);
      const keep = new Set(), counts = {tram: 0, bus: 0, artic: 0, metro: 0};
      for (const w of want) {if (counts[w.kind] >= CAP[w.kind]) continue;counts[w.kind]++;keep.add(w.key);if (!active.has(w.key)) active.set(w.key, {dir: w.dir, dep: w.dep, kind: w.kind, veh: null});}
      for (const [key, a] of active) if (!keep.has(key)) {if (a.veh) {a.veh.used = false;a.veh.group.visible = false;}active.delete(key);}
    }
    const solids = [];let doorChime = 0;
    function place(camera) {
      const ms = now();solids.length = 0;
      for (const [key, a] of active) {
        const st = TT.at(a.dir, (ms - a.dep) / 1000);
        if (!st || st.gone) {if (a.veh) {a.veh.used = false;a.veh.group.visible = false;a.veh = null;}continue;}
        if (!a.veh) {a.veh = grab(a.kind);if (!a.veh) continue;a.veh.setSign(models.sign(a.dir.line.ref, a.dir.to, a.dir.line.colour, a.dir.line.mode));}
        const secs = sectionsAt(a.dir, st.d), v = a.veh;a.st = st;a.secs = secs;
        secs.forEach((s, i) => {const g = v.sections[i].group;g.position.set(s.x, s.y, s.z);g.rotation.order = 'YXZ';g.rotation.set(s.pitch, s.yaw, 0);});
        if (a.lastDoors !== undefined && a.lastDoors > .5 && st.doors <= .5 && (ride && ride.key === key)) audio('ding');
        a.lastDoors = st.doors;v.setDoors(st.doors, st.dwelling ? stopSide(a.dir, st.stop) : 0);
        const near = Math.hypot(secs[0].x - camera.position.x, secs[0].z - camera.position.z) < 70 || (ride && ride.key === key);v.setInterior(!!near);
        // collision footprints (walkers and cars) for the ones near you
        if (Math.hypot(secs[0].x - camera.position.x, secs[0].z - camera.position.z) < 160) {
          const K = v.K;for (const s of secs) {
            const hw = K.width / 2, hl = s.len / 2, rx = s.fz, rz = -s.fx;
            const c = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([l, w]) => ({x: s.x + s.fx * l + rx * w, z: s.z + s.fz * l + rz * w}));
            solids.push({points: c, minY: s.y - .3, maxY: s.y + K.height, kind: 'transit', transit: key, sec: s, hw});
          }
        }
      }
      for (const k of Object.keys(pools)) for (const v of pools[k]) if (!v.used) v.group.visible = false;
    }
    // ---------- Stops: poles, shelters and the live boards ----------
    // Shelters stand where the building outlines leave room (a coarse grid of the buildings' bounding boxes).
    const bgrid = new Map();
    for (const o of world.obstacles()) {
      if (o.kind !== 'building') continue;const b = bounds(o.points);
      for (let i = Math.floor(b.x0 / 32); i <= Math.floor(b.x1 / 32); i++) for (let j = Math.floor(b.z0 / 32); j <= Math.floor(b.z1 / 32); j++) {const k = i + ',' + j;if (!bgrid.has(k)) bgrid.set(k, []);bgrid.get(k).push({b, pts: o.points});}
    }
    const inBuilding = p => (bgrid.get(Math.floor(p.x / 32) + ',' + Math.floor(p.z / 32)) || []).some(q => p.x >= q.b.x0 && p.x <= q.b.x1 && p.z >= q.b.z0 && p.z <= q.b.z1 && inPoly(p.x, p.z, q.pts));
    // Path samples of every bus and tram line in a 6 m grid (to keep shelters off the road and parked cars out of the lanes).
    const lanes = new Map();
    for (const d of N.dirs) if (d.line.mode !== 'metro') for (let k = d.start; k <= d.end; k++) {
      const key = Math.floor(d.X[k] / 6) + ',' + Math.floor(d.S[k] / 6);let a = lanes.get(key);if (!a) lanes.set(key, a = []);a.push(d, k);
    }
    function nearestLane(x, s, r) {// -> {d, k, off (signed, right of travel +)} within r
      let best = null, bd = r;
      for (let i = Math.floor((x - r) / 6); i <= Math.floor((x + r) / 6); i++) for (let j = Math.floor((s - r) / 6); j <= Math.floor((s + r) / 6); j++) {
        const a = lanes.get(i + ',' + j);if (!a) continue;
        for (let q = 0; q < a.length; q += 2) {const d = a[q], k = a[q + 1], dd = Math.hypot(d.X[k] - x, d.S[k] - s);if (dd < bd) {bd = dd;const p = TT.pointAt(d, k * TT.STEP);best = {d, k, dist: dd, off: (x - p.x) * -p.hs + (s - p.s) * p.hx, hx: p.hx, hs: p.hs, tram: d.line.mode === 'tram'};}}
      }
      return best;
    }
    const poles = N.poles.map(q => {
      const p = W(q.x, q.s), toRoad = (() => {const l = nearestLane(q.x, q.s, 12);if (!l) return {x: Math.sin(q.heading), s: Math.cos(q.heading)};const v = {x: (l.d.X[l.k] - q.x), s: (l.d.S[l.k] - q.s)}, L = Math.hypot(v.x, v.s) || 1;return {x: v.x / L, s: v.s / L};})();
      const rw = dirW(toRoad.x, toRoad.s), yaw = Math.atan2(rw.x, rw.z);// the stop's +z points to the road
      // the shelter: 3.6 × 1.6 m behind the pole (away from the road), clear of buildings and lanes
      const back = (t, w) => ({x: p.x - rw.x * t + rw.z * w, z: p.z - rw.z * t - rw.x * w});
      const corners = [back(.9, .2), back(2.4, .2), back(.9, -4.2), back(2.4, -4.2), back(1.6, -2)];
      const shelter = q.serves.length > 0 && !corners.some(inBuilding) && !corners.some(c => {const l = toLocal(c.x, c.z), n = nearestLane(l.x, l.s, 3.2);return !!n;});
      return {q, p, yaw, shelter, model: null, board: null, boardT: 0, y: 0, name: q.place.name};
    });
    for (const P of poles) {
      // the pole itself and the shelter are solid
      const c = P.p, y = terrain(c.x, c.z), sq = (cx, cz, r) => [{x: cx - r, z: cz - r}, {x: cx + r, z: cz - r}, {x: cx + r, z: cz + r}, {x: cx - r, z: cz + r}];
      obstacles.push({points: sq(c.x, c.z, .08), minY: y - .5, maxY: y + 3, kind: 'stop'});
      if (P.shelter) {const rw = {x: Math.sin(P.yaw), z: Math.cos(P.yaw)}, at = (t, w) => ({x: c.x - rw.x * t + rw.z * w, z: c.z - rw.z * t - rw.x * w});obstacles.push({points: thinW(at(2.25, -.55), at(2.25, -4.05), .06), minY: y - .5, maxY: y + 2.5, kind: 'stop'}, {points: thinW(at(1.1, -4.05), at(2.25, -4.05), .06), minY: y - .5, maxY: y + 2.5, kind: 'stop'});}
    }
    function departuresAt(dirs, place, ms, count) {
      const rows = [];
      for (const d of dirs) {
        const si = d.stops.findIndex(s => s.place === place);if (si < 0) continue;
        if (si === d.stops.length - 1 && !d.edge[1]) continue;// arrivals at the terminus are not departures
        for (const t of TT.nextArrivals(d, si, ms, count)) rows.push({t, d, si});
      }
      return rows.sort((a, b) => a.t - b.t).slice(0, count);
    }
    const whenText = (t, ms) => {const m = (t - ms) / 60000;return m < .6 ? 'nå' : m < 15 ? `${Math.round(m)} min` : hhmm(t, TT);};
    function drawBoard(P, ms) {
      const rows = departuresAt(P.q.serves, P.q.place, ms, 5).map(r => ({ref: r.d.line.ref, colour: r.d.line.colour, to: r.d.to, when: whenText(r.t, ms)}));
      P.board.draw(P.name, rows, P.q.serves.every(d => d.line.night) ? 'Night buses: Friday and Saturday nights' : 'No more departures tonight');
    }
    let stopT = 0;
    function updateStops(dt, camera) {
      stopT -= dt;if (stopT > 0) return;stopT = .5;
      const ms = now();
      for (const P of poles) {
        const d = Math.hypot(P.p.x - camera.position.x, P.p.z - camera.position.z);
        if (d < 170 && !P.model) {
          P.board = models.boardCanvas();P.y = terrain(P.p.x, P.p.z);
          P.model = models.stopModel({name: P.name, tram: P.q.tram, shelter: P.shelter, board: P.board.mat});
          P.model.position.set(P.p.x, P.y, P.p.z);P.model.rotation.y = P.yaw;group.add(P.model);P.boardT = 0;
        } else if (d > 230 && P.model) {group.remove(P.model);P.board.tex.dispose();P.model = null;P.board = null;}
        if (P.model && d < 70 && (P.boardT -= .5) <= 0) {P.boardT = 10;drawBoard(P, ms);}
      }
    }
    // ---------- Tram rails and the contact wire, built near you ----------
    const railMat = new T.MeshStandardMaterial({color: 0x8c8f92, roughness: .35, metalness: .8, side: T.DoubleSide}), wireMat = new T.LineBasicMaterial({color: 0x2a2c2e});
    const railCells = new Map(), RC = 96, railIndex = new Map();
    {
      const seen = new Set();
      for (const d of N.dirs) if (d.line.mode === 'tram') for (let k = 0; k < d.n - 1; k++) {
        const sk = Math.round(d.X[k] * 1.2) + ',' + Math.round(d.S[k] * 1.2);if (seen.has(sk)) continue;seen.add(sk);
        if (!inWorld(d.X[k], d.S[k], 0)) continue;
        const key = Math.floor(d.X[k] / RC) + ',' + Math.floor(d.S[k] / RC);let a = railIndex.get(key);if (!a) railIndex.set(key, a = []);a.push(d, k);
      }
    }
    // A box as raw triangles: centre (x, z), half sizes along (ux, uz) and across, from y0 to y1.
    function box(pos, x, z, hu, hv, ux, uz, y0, y1) {
      const vx = -uz, vz = ux, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * hu * a + vx * hv * b, z + uz * hu * a + vz * hv * b]);
      for (let i = 0; i < 4; i++) {const a = c[i], b = c[(i + 1) % 4];pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);}
      pos.push(c[0][0], y1, c[0][1], c[2][0], y1, c[2][1], c[1][0], y1, c[1][1], c[0][0], y1, c[0][1], c[3][0], y1, c[3][1], c[2][0], y1, c[2][1]);
    }
    function railCell(key) {
      const a = railIndex.get(key);if (!a) return null;
      const pos = [], wire = [];
      for (let q = 0; q < a.length; q += 2) {
        const d = a[q], k = a[q + 1];if (d.tunnel[k]) continue;
        const p0 = W(d.X[k], d.S[k]), p1 = W(d.X[k + 1], d.S[k + 1]), dx = p1.x - p0.x, dz = p1.z - p0.z, L = Math.hypot(dx, dz) || 1, rx = dz / L, rz = -dx / L;
        const y0 = ground(p0.x, p0.z), y1 = ground(p1.x, p1.z);
        for (const g of [-.7175, .7175]) {
          const a0 = {x: p0.x + rx * g, z: p0.z + rz * g}, a1 = {x: p1.x + rx * g, z: p1.z + rz * g}, w = .035;
          // the rail head: a flat strip 2.5 cm over the road, and its two sides
          pos.push(a0.x + rx * w, y0 + .025, a0.z + rz * w, a1.x + rx * w, y1 + .025, a1.z + rz * w, a1.x - rx * w, y1 + .025, a1.z - rz * w, a0.x + rx * w, y0 + .025, a0.z + rz * w, a1.x - rx * w, y1 + .025, a1.z - rz * w, a0.x - rx * w, y0 + .025, a0.z - rz * w);
          for (const sg of [-1, 1]) {const ox = rx * w * sg, oz = rz * w * sg;pos.push(a0.x + ox, y0 - .03, a0.z + oz, a1.x + ox, y1 - .03, a1.z + oz, a1.x + ox, y1 + .025, a1.z + oz, a0.x + ox, y0 - .03, a0.z + oz, a1.x + ox, y1 + .025, a1.z + oz, a0.x + ox, y0 + .025, a0.z + oz);}
        }
        wire.push(p0.x, y0 + 5.7, p0.z, p1.x, y1 + 5.7, p1.z);
        // a mast every 34 m on the right of the track (the outside of a double track), with its arm over the wire
        if (k % 17 === 0 && !d.tunnel[k]) {
          const m = {x: p0.x - rx * 3.4, z: p0.z - rz * 3.4}, gy = ground(m.x, m.z);
          if (Math.abs(gy - y0) < 1.5) {box(pos, m.x, m.z, .08, .08, dx / L, dz / L, gy - .2, y0 + 6.3);const a = {x: p0.x - rx * 1.7, z: p0.z - rz * 1.7};box(pos, a.x, a.z, 1.75, .03, -rx, -rz, y0 + 5.95, y0 + 6.02);}
        }
      }
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.computeVertexNormals();
      const m = new T.Mesh(g, railMat);m.receiveShadow = true;
      const wg = new T.BufferGeometry();wg.setAttribute('position', new T.Float32BufferAttribute(wire, 3));
      const grp = new T.Group();grp.add(m, new T.LineSegments(wg, wireMat));grp.name = 'Tram rails ' + key;return grp;
    }
    let railT = 0;
    function updateRails(dt, camera) {
      railT -= dt;if (railT > 0) return;railT = .7;
      const c = toLocal(camera.position.x, camera.position.z), ci = Math.floor(c.x / RC), cj = Math.floor(c.s / RC), want = new Set();
      for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) if (railIndex.has(i + ',' + j)) want.add(i + ',' + j);
      let built = 0;
      for (const k of want) if (!railCells.has(k) && built < 2) {const g = railCell(k);railCells.set(k, g);if (g) group.add(g);built++;}
      for (const [k, g] of railCells) if (!want.has(k) && Math.abs(+k.split(',')[0] - ci) + Math.abs(+k.split(',')[1] - cj) > 8) {if (g) {group.remove(g);g.traverse(o => o.geometry && o.geometry.dispose());}railCells.delete(k);}
    }
    // ---------- Metro stations' meshes and the tunnels ----------
    const SM = {
      wall: new T.MeshBasicMaterial({vertexColors: true, side: T.DoubleSide}),
      sign: new T.MeshBasicMaterial({color: 0xffffff})
    };
    function stationMesh(S) {
      const {sp, L} = S, pos = [], col = [];
      const c3 = hex => {const c = new T.Color(hex);return [c.r, c.g, c.b];};
      const Pw = (u, v, y) => {const p = W(...TS.P(sp, u, v));return [p.x, y, p.z];};
      const quad = (a, b, c, d, hex, shade = 1) => {const k = c3(hex).map(x => x * shade);pos.push(...a, ...b, ...c, ...a, ...c, ...d);for (let i = 0; i < 6; i++) col.push(...k);};
      const boxUV = (u0, u1, v0, v1, y0, y1, hex, faces = 'all') => {
        const A = Pw(u0, v0, y0), B = Pw(u1, v0, y0), C = Pw(u1, v1, y0), D = Pw(u0, v1, y0), A2 = Pw(u0, v0, y1), B2 = Pw(u1, v0, y1), C2 = Pw(u1, v1, y1), D2 = Pw(u0, v1, y1);
        if (faces === 'all' || faces.includes('t')) quad(A2, B2, C2, D2, hex, 1);
        if (faces === 'all' || faces.includes('s')) {quad(A, B, B2, A2, hex, .82);quad(B, C, C2, B2, hex, .9);quad(C, D, D2, C2, hex, .82);quad(D, A, A2, D2, hex, .9);}
        if (faces.includes('b')) quad(A, B, C, D, hex, .7);
      };
      for (const b of L.boxes) {
        if (b.kind === 'hall') {
          // The track pit, the long walls (dark plinth, light tiled panels, the line colour band, the upper wall), posters,
          // the ceiling with light strips, and the ends with a tunnel mouth round each track.
          const {u0, u1, v0, v1, y0, y1} = b, py = sp.platform, posters = [0xd9472b, 0x2a6fb0, 0x3f9b5a, 0xe2b13c, 0x7b4fa0, 0xe8e2d6];
          quad(Pw(u0, v0, y0), Pw(u1, v0, y0), Pw(u1, v1, y0), Pw(u0, v1, y0), 0x3a3b3c);
          for (const [v, s] of [[v0, 1], [v1, -1]]) {
            for (let u = u0, i = 0; u < u1 - .01; u += 2.4, i++) {
              const ue = Math.min(u1, u + 2.4), k = i % 2 ? .95 : 1;
              quad(Pw(u, v, y0), Pw(ue, v, y0), Pw(ue, v, py + .25), Pw(u, v, py + .25), 0x55595d, .9);
              quad(Pw(u, v, py + .25), Pw(ue, v, py + .25), Pw(ue, v, py + 2.45), Pw(u, v, py + 2.45), 0xdfe2e4, .9 * k);
              quad(Pw(u, v, py + 2.45), Pw(ue, v, py + 2.45), Pw(ue, v, py + 2.6), Pw(u, v, py + 2.6), 0xec700c, 1);
              quad(Pw(u, v, py + 2.6), Pw(ue, v, py + 2.6), Pw(ue, v, y1), Pw(u, v, y1), 0xa9b8c4, .78 * k + .02 * (i % 3));
            }
            for (let u = u0 + 7, i = 0; u < u1 - 5; u += 9.5, i++) {// posters in light frames, 3 cm off the wall
              if (Math.abs(u) < 3) continue;const vv = v + s * .03;
              quad(Pw(u - .7, vv, py + .75), Pw(u + .7, vv, py + .75), Pw(u + .7, vv, py + 2.25), Pw(u - .7, vv, py + 2.25), 0xf4f4f2, 1);
              const vp = v + s * .04;quad(Pw(u - .62, vp, py + .83), Pw(u + .62, vp, py + .83), Pw(u + .62, vp, py + 2.17), Pw(u - .62, vp, py + 2.17), posters[(i + Math.round(sp.c[0])) % posters.length], .95);
              quad(Pw(u - .62, vp + s * .001, py + 1.6), Pw(u + .62, vp + s * .001, py + 1.6), Pw(u + .62, vp + s * .001, py + 2.0), Pw(u - .62, vp + s * .001, py + 2.0), 0xffffff, .9);
            }
          }
          quad(Pw(u0, v0, y1), Pw(u1, v0, y1), Pw(u1, v1, y1), Pw(u0, v1, y1), 0x4a4f55, 1);
          for (const v of [v0 + 2, (v0 + v1) / 2, v1 - 2]) boxUV(u0 + 2, u1 - 2, v - .15, v + .15, y1 - .1, y1 - .05, 0xfff8e6, 'b');
          const open = sp.tracks.map(t => [t - 2.4, t + 2.4]).sort((p, q) => p[0] - q[0]).reduce((a, iv) => {const l = a[a.length - 1];if (l && iv[0] <= l[1]) l[1] = Math.max(l[1], iv[1]);else a.push([...iv]);return a;}, []);
          const top = sp.rail + 4.9;
          for (const u of [u0, u1]) {
            quad(Pw(u, v0, top), Pw(u, v1, top), Pw(u, v1, y1), Pw(u, v0, y1), 0x8d969e, .8);
            let v = v0;for (const [a2, b2] of open) {if (a2 > v) quad(Pw(u, v, y0), Pw(u, a2, y0), Pw(u, a2, top), Pw(u, v, top), 0x8d969e, .75);v = b2;}if (v < v1) quad(Pw(u, v, y0), Pw(u, v1, y0), Pw(u, v1, top), Pw(u, v, top), 0x8d969e, .75);
            for (const [a2, b2] of open) quad(Pw(u, a2, top - .35), Pw(u, b2, top - .35), Pw(u, b2, top), Pw(u, a2, top), 0x2b2e31, 1);
          }
          // benches along each platform
          for (const pl of L.pls) for (let u = -48; u <= 48; u += 16) {
            if (L.hall && u > L.hall.m0 - TS.MEZZ / TS.GRADE - 2 && u < L.hall.m1 + 1) continue;const vc = (pl.v0 + pl.v1) / 2;
            boxUV(u - 1.1, u + 1.1, vc - .22, vc + .22, py + .42, py + .48, 0x8a6a48, 't s');boxUV(u - 1, u - .9, vc - .15, vc + .15, py, py + .42, 0x6f767c, 's');boxUV(u + .9, u + 1, vc - .15, vc + .15, py, py + .42, 0x6f767c, 's');
          }
        } else if (b.kind === 'stair') {
          const n = Math.ceil(b.run / .32), du = (b.u1 - b.u0) / n, dy = (b.y1 - b.y0) / n;
          for (let i = 0; i < n; i++) boxUV(b.u0 + i * du, b.u0 + (i + 1) * du, b.v0, b.v1, b.y0, b.y0 + (i + 1) * dy, i % 2 ? 0xa3a7ab : 0xb5b9bd, 't s');
          boxUV(b.u0, b.u1, b.v1 + .05, b.v1 + .95, b.y0, b.y0 + .1, 0x6b7076, 't');// the escalator beside it (look only)
        } else if (b.kind === 'entrance-stair') {
          const n = Math.ceil(b.len / .3), E = b.E, dir = b.dir, at = (t, w, y) => {const p = W(E[0] + dir[0] * t - dir[1] * w, E[1] + dir[1] * t + dir[0] * w);return [p.x, y, p.z];};
          for (let i = 0; i < n; i++) {const t0 = b.land + i * b.len / n, t1 = b.land + (i + 1) * b.len / n, y = b.top - (i + 1) * (b.top - b.my) / n;quad(at(t0, -b.hw, y), at(t1, -b.hw, y), at(t1, b.hw, y), at(t0, b.hw, y), i % 2 ? 0xa3a7ab : 0xb5b9bd);quad(at(t0, -b.hw, y + (b.top - b.my) / n), at(t0, -b.hw, y), at(t0, b.hw, y), at(t0, b.hw, y + (b.top - b.my) / n), 0x8d9196);}
          quad(at(0, -b.hw, b.top), at(b.land, -b.hw, b.top), at(b.land, b.hw, b.top), at(0, b.hw, b.top), 0x9a9ea2);
          // side walls and the ceiling of the stairwell (from the pavilion's back wall down to the foot)
          const end = b.tB + 3.6;
          for (const w of [-b.hw - .1, b.hw + .1]) for (let i = 0; i < 12; i++) {const t0 = end * i / 12, t1 = end * (i + 1) / 12, f = t => Math.max(b.my, b.top - Math.max(0, t - b.land) * (b.top - b.my) / b.len);quad(at(t0, w, f(t0) - .1), at(t1, w, f(t1) - .1), at(t1, w, f(t1) + 2.9), at(t0, w, f(t0) + 2.9), 0xd2d5d8, .9);}
          for (let i = 0; i < 12; i++) {const t0 = Math.max(b.K, end * i / 12), t1 = Math.max(b.K, end * (i + 1) / 12);if (t1 <= t0) continue;const f = t => Math.max(b.my, b.top - Math.max(0, t - b.land) * (b.top - b.my) / b.len) + 2.75;quad(at(t0, -b.hw - .1, f(t0)), at(t1, -b.hw - .1, f(t1)), at(t1, b.hw + .1, f(t1)), at(t0, b.hw + .1, f(t0)), 0x5a5f65);}
          quad(at(end, -b.hw - .1, b.my - .1), at(end, b.hw + .1, b.my - .1), at(end, b.hw + .1, b.my + 2.9), at(end, -b.hw - .1, b.my + 2.9), 0xd2d5d8, .9);
          quad(at(b.tB, -b.hw - .4, b.my), at(end, -b.hw - .4, b.my), at(end, b.hw + .4, b.my), at(b.tB, b.hw + .4, b.my), 0x9a9ea2);
        } else if (b.kind === 'corridor') {
          const [p0, p1, p2, p3] = b.pts.map(([x, s]) => W(x, s)), Y = b.y, H = b.h;
          const v = (p, y) => [p.x, y, p.z];
          quad(v(p0, Y), v(p1, Y), v(p2, Y), v(p3, Y), 0x9a9ea2);quad(v(p0, Y + H), v(p1, Y + H), v(p2, Y + H), v(p3, Y + H), 0x5a5f65);
          quad(v(p0, Y), v(p1, Y), v(p1, Y + H), v(p0, Y + H), 0xd2d5d8, .9);quad(v(p3, Y), v(p2, Y), v(p2, Y + H), v(p3, Y + H), 0xd2d5d8, .9);
          quad(v(p0, Y), v(p3, Y), v(p3, Y + H), v(p0, Y + H), 0xd2d5d8, .8);
          const m0 = {x: (p0.x + p3.x) / 2, z: (p0.z + p3.z) / 2}, m1 = {x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2}, dx = m1.x - m0.x, dz = m1.z - m0.z, Lc = Math.hypot(dx, dz) || 1;
          for (const w of [0]) {const a = {x: m0.x - dz / Lc * .2, z: m0.z + dx / Lc * .2}, bb = {x: m0.x + dz / Lc * .2, z: m0.z - dx / Lc * .2};quad(v(a, Y + H - .03), v({x: a.x + dx, z: a.z + dz}, Y + H - .03), v({x: bb.x + dx, z: bb.z + dz}, Y + H - .03), v(bb, Y + H - .03), 0xfff8e6);}
        } else if (b.kind === 'canopy') {
          boxUV(b.u0, b.u1, b.v0, b.v1, b.y1 - .15, b.y1, 0x3b4045, 't s b');
          for (let u = b.u0 + 2; u <= b.u1 - 2; u += 7) for (const v of [b.v0 + .3, b.v1 - .3]) boxUV(u - .08, u + .08, v - .08, v + .08, b.y0, b.y1 - .15, 0x6f767c, 's');
        } else if (b.kind === 'ramp') {
          const r = b.ramp, A = Pw(r.u0, b.v0, r.y0), B = Pw(r.u1, b.v0, r.y1), C = Pw(r.u1, b.v1, r.y1), D = Pw(r.u0, b.v1, r.y0);quad(A, B, C, D, 0x8d9093);
          quad(Pw(r.u0, b.v0, r.y0), Pw(r.u1, b.v0, r.y1), Pw(r.u1, b.v0, Math.min(r.y0, r.y1) - .6), Pw(r.u0, b.v0, Math.min(r.y0, r.y1) - .6), 0x7d8083, .85);
          quad(Pw(r.u0, b.v1, r.y0), Pw(r.u1, b.v1, r.y1), Pw(r.u1, b.v1, Math.min(r.y0, r.y1) - .6), Pw(r.u0, b.v1, Math.min(r.y0, r.y1) - .6), 0x7d8083, .85);
        } else if (b.u0 !== undefined) boxUV(b.u0, b.u1, b.v0, b.v1, b.y0, b.y1, b.colour, b.kind === 'platform' || b.kind === 'slab' ? 't s b' : 't s');
      }
      // the mezzanine's balustrades (glass look: light grey bars)
      if (L.hall) {const h = L.hall;boxUV(h.m1 - .05, h.m1 + .05, h.hv0, h.hv1, h.my, h.my + 1.05, 0xaab4bc, 't s');}
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('color', new T.Float32BufferAttribute(col, 3));g.computeBoundingSphere();
      const m = new T.Mesh(g, SM.wall);m.name = `Station ${sp.name}`;m.receiveShadow = !!L.open;
      const grp = new T.Group();grp.add(m);
      // signs: the station's name on the walls and the departure boards over the platforms
      S.boards = [];
      for (const sg of L.signs) {
        const p = W(...TS.P(sp, sg.u, sg.v)), a = dirW(...sp.a), yaw = Math.atan2(a.x, a.z);
        if (sg.kind === 'name') {
          const nW = dirW(...sp.n), yawN = Math.atan2(nW.x, nW.z);
          for (const du of sg.face ? [-40, -14, 14, 40] : [0]) {
            const q = W(...TS.P(sp, sg.u + du, sg.v)), plate = new T.Mesh(new T.PlaneGeometry(sg.face ? 4.2 : 3.2, sg.face ? .63 : .48), nameMat(sp.name, !sg.face));plate.position.set(q.x, sg.y, q.z);
            plate.rotation.y = sg.face ? (sg.face > 0 ? yawN : yawN + Math.PI) : yaw;grp.add(plate);
            if (!sg.face) {const back = plate.clone();back.rotation.y = yaw + Math.PI;grp.add(back);}
          }
        } else {
          const bc = models.boardCanvas(), b = new T.Group();b.position.set(p.x, sg.y, p.z);b.rotation.y = yaw;
          for (const r of [0, Math.PI]) {const s = new T.Mesh(new T.PlaneGeometry(1.6, .6), bc.mat);s.rotation.y = r;s.position.z = r ? -.04 : .04;b.add(s);}
          const frame = new T.Mesh(new T.BoxGeometry(1.7, .7, .06), models.stopMat.dark);b.add(frame);
          grp.add(b);S.boards.push({bc, t: 0, pl: sg.pl});
        }
      }
      // the entrance pavilion (glass box, flat roof, the T sign)
      if (L.kiosk) {
        const k = L.kiosk, at = (t, w) => W(k.E[0] + k.dir[0] * t - k.dir[1] * w, k.E[1] + k.dir[1] * t + k.dir[0] * w), y = k.top;
        const pv = new T.Group(), ctr = at(k.K / 2, 0), d = dirW(...k.dir);pv.position.set(ctr.x, y, ctr.z);pv.rotation.y = Math.atan2(d.x, d.z);
        const part = (geo, mat, sx, sy, sz, x, yy, z) => {const m = new T.Mesh(geo, mat);m.scale.set(sx, sy, sz);m.position.set(x, yy, z);m.castShadow = true;pv.add(m);return m;};
        const bx = new T.BoxGeometry(1, 1, 1), w = k.hw * 2 + 1.0;
        part(bx, models.stopMat.roof, w + .4, .22, k.K + .4, 0, 3.2, 0);
        for (const s of [-1, 1]) {part(bx, models.stopMat.glass, .03, 3.05, k.K, s * w / 2, 1.55, 0);part(bx, models.stopMat.metal, .1, 3.1, .1, s * w / 2, 1.55, k.K / 2);part(bx, models.stopMat.metal, .1, 3.1, .1, s * w / 2, 1.55, -k.K / 2);}
        part(bx, models.stopMat.glass, w, 3.05, .03, 0, 1.55, k.K / 2 - .05);
        // the sign: a white T on Ruter's metro orange, on a post by the door
        part(new T.CylinderGeometry(.05, .05, 1, 8), models.stopMat.metal, 1, 3.6, 1, w / 2 + .5, 1.8, -k.K / 2);
        const tm = tSign();for (const r of [0, Math.PI]) {const s = new T.Mesh(new T.CircleGeometry(.42, 32), tm);s.position.set(w / 2 + .5, 3.55, -k.K / 2 + (r ? -.03 : .03));s.rotation.y = r;pv.add(s);}
        const nm = new T.Mesh(new T.PlaneGeometry(w, .5), nameMat(sp.name, true));nm.position.set(0, 2.78, -k.K / 2 - .02);nm.rotation.y = Math.PI;pv.add(nm);
        grp.add(pv);S.pavilion = pv;
      }
      return grp;
    }
    const nameMats = new Map();
    function nameMat(name, dark) {
      const key = name + (dark ? '|d' : '');if (nameMats.has(key)) return nameMats.get(key);
      const c = document.createElement('canvas');c.width = 1024;c.height = 154;const g = c.getContext('2d');
      g.fillStyle = dark ? '#1b1f24' : '#f4f4f2';g.fillRect(0, 0, 1024, 154);
      g.fillStyle = '#ec700c';g.beginPath();g.arc(80, 77, 56, 0, 7);g.fill();g.fillStyle = '#fff';g.font = 'bold 80px Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('T', 80, 82);
      g.fillStyle = dark ? '#fff' : '#16181a';g.textAlign = 'left';let size = 84;g.font = `bold ${size}px Arial, sans-serif`;while (g.measureText(name).width > 840 && size > 30) {size -= 4;g.font = `bold ${size}px Arial, sans-serif`;}g.fillText(name, 160, 82);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;const m = new T.MeshBasicMaterial({map: tex, side: T.DoubleSide, toneMapped: false});nameMats.set(key, m);return m;
    }
    let tMat = null;
    function tSign() {
      if (tMat) return tMat;const c = document.createElement('canvas');c.width = c.height = 128;const g = c.getContext('2d');
      g.fillStyle = '#ec700c';g.beginPath();g.arc(64, 64, 62, 0, 7);g.fill();g.fillStyle = '#fff';g.font = 'bold 96px Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('T', 64, 70);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;return tMat = new T.MeshBasicMaterial({map: tex, toneMapped: false});
    }
    let stationT = 0;
    function updateStations(dt, camera) {
      stationT -= dt;const ms = now();
      for (const S of stations) {
        const c = W(...S.sp.c), d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
        if (d < 260 && !S.built) {S.built = stationMesh(S);group.add(S.built);}
        else if (d > 340 && S.built) {group.remove(S.built);S.built.traverse(o => {if (o.geometry) o.geometry.dispose();});S.built = null;S.boards = null;}
        if (S.built && S.boards && stationT <= 0 && d < 150) for (const B of S.boards) {
          const dirs = N.dirs.filter(q => q.line.mode === 'metro' && q.stops.some(s => s.place === S.place) && sideOf(S, q) === B.pl);
          const rows = departuresAt(dirs, S.place, ms, 5).map(r => ({ref: r.d.line.ref, colour: r.d.line.colour, to: r.d.to, when: whenText(r.t, ms)}));
          B.bc.draw(S.sp.name, rows);
        }
      }
      if (stationT <= 0) stationT = 10;
    }
    // Which platform a direction's trains stop at (the nearest one to its track).
    function sideOf(S, dir) {
      const st = dir.stops.find(s => s.place === S.place), p = TT.pointAt(dir, st.d), sp = S.sp, v = (p.x - sp.c[0]) * sp.n[0] + (p.s - sp.c[1]) * sp.n[1];
      const pls = S.L.pls;return pls.slice().sort((a, b) => Math.abs((a.v0 + a.v1) / 2 - v) - Math.abs((b.v0 + b.v1) / 2 - v))[0];
    }
    // Tunnels: a horseshoe tube round each metro track in the tunnel, built in 96 m cells near the camera when you are down there.
    const tubeIndex = new Map(), tubeCells = new Map();
    {
      const seen = new Set();
      for (const d of N.dirs) if (d.line.mode === 'metro') for (let k = 0; k < d.n - 1; k++) {
        if (!d.tunnel[k]) continue;const sk = Math.round(d.X[k] / 1.5) + ',' + Math.round(d.S[k] / 1.5);if (seen.has(sk)) continue;seen.add(sk);
        const key = Math.floor(d.X[k] / RC) + ',' + Math.floor(d.S[k] / RC);let a = tubeIndex.get(key);if (!a) tubeIndex.set(key, a = []);a.push(d, k);
      }
    }
    const tubeMat = new T.MeshBasicMaterial({vertexColors: true, side: T.BackSide});
    function tubeCell(key) {
      const a = tubeIndex.get(key);if (!a) return null;
      const pos = [], col = [], prof = [];
      for (let i = 0; i <= 10; i++) {const t = Math.PI * i / 10;prof.push([Math.cos(t) * 2.6, 2.4 + Math.sin(t) * 2.6]);}
      const shape = [[2.6, -.4], ...prof, [-2.6, -.4]];
      for (let q = 0; q < a.length; q += 2) {
        const d = a[q], k = a[q + 1];
        // skip the part inside a station hall
        if (stations.some(S => S.sp.underground && Math.abs((d.X[k] - S.sp.c[0]) * S.sp.a[0] + (d.S[k] - S.sp.c[1]) * S.sp.a[1]) < TS.HALL / 2 - .5 && Math.abs((d.X[k] - S.sp.c[0]) * S.sp.n[0] + (d.S[k] - S.sp.c[1]) * S.sp.n[1]) < 12)) continue;
        const p0 = W(d.X[k], d.S[k]), p1 = W(d.X[k + 1], d.S[k + 1]), y0 = metroY(d)[k], y1 = metroY(d)[k + 1];
        const dx = p1.x - p0.x, dz = p1.z - p0.z, L = Math.hypot(dx, dz) || 1, rx = dz / L, rz = -dx / L;
        for (let i = 0; i + 1 < shape.length; i++) {
          const [w0, h0] = shape[i], [w1, h1] = shape[i + 1];
          const A = [p0.x + rx * w0, y0 + h0, p0.z + rz * w0], B = [p1.x + rx * w0, y1 + h0, p1.z + rz * w0], C = [p1.x + rx * w1, y1 + h1, p1.z + rz * w1], D = [p0.x + rx * w1, y0 + h1, p0.z + rz * w1];
          const lit = (i === 3 || i === 9) && k % 10 === 0, cab = (i === 2 || i === 10) && k % 25 < 2, g0 = .045 + .01 * (i % 2) + .008 * ((k >> 2) % 2), c = lit ? [1.6, 1.5, 1.2] : cab ? [.16, .15, .13] : i === 0 || i === shape.length - 2 ? [.035, .035, .037] : [g0, g0, g0 * 1.04];
          pos.push(...A, ...B, ...C, ...A, ...C, ...D);for (let j = 0; j < 6; j++) col.push(...c);
        }
        {// the track bed: dark ballast between the walls, and the sleepers' grey
          const A = [p0.x + rx * 2.6, y0 - .4, p0.z + rz * 2.6], B = [p1.x + rx * 2.6, y1 - .4, p1.z + rz * 2.6], C = [p1.x - rx * 2.6, y1 - .4, p1.z - rz * 2.6], D = [p0.x - rx * 2.6, y0 - .4, p0.z - rz * 2.6];
          pos.push(...A, ...B, ...C, ...A, ...C, ...D);const q = k % 2 ? .05 : .04;for (let j = 0; j < 6; j++) col.push(q, q * .95, q * .9);
          const E = [p0.x + rx * 1.3, y0 - .05, p0.z + rz * 1.3], F = [p1.x + rx * 1.3, y1 - .05, p1.z + rz * 1.3], G2 = [p1.x - rx * 1.3, y1 - .05, p1.z - rz * 1.3], H = [p0.x - rx * 1.3, y0 - .05, p0.z - rz * 1.3];
          pos.push(...E, ...F, ...G2, ...E, ...G2, ...H);for (let j = 0; j < 6; j++) col.push(.09, .085, .08);
        }
        for (const g of [-.72, .72]) {const A = [p0.x + rx * g, y0 + .02, p0.z + rz * g], B = [p1.x + rx * g, y1 + .02, p1.z + rz * g];pos.push(A[0] - rx * .04, A[1], A[2] - rz * .04, A[0] + rx * .04, A[1], A[2] + rz * .04, B[0] + rx * .04, B[1], B[2] + rz * .04, A[0] - rx * .04, A[1], A[2] - rz * .04, B[0] + rx * .04, B[1], B[2] + rz * .04, B[0] - rx * .04, B[1], B[2] - rz * .04);for (let j = 0; j < 6; j++) col.push(.55, .56, .58);}
      }
      if (!pos.length) return null;
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('color', new T.Float32BufferAttribute(col, 3));g.computeBoundingSphere();
      // the rails' strips face up, so draw them from both sides (the tube itself only from inside)
      const m = new T.Mesh(g, new T.MeshBasicMaterial({vertexColors: true, side: T.DoubleSide}));m.name = 'Metro tunnel ' + key;return m;
    }
    function updateTunnels(camera, wantTunnels) {
      const c = toLocal(camera.position.x, camera.position.z), ci = Math.floor(c.x / RC), cj = Math.floor(c.s / RC), want = new Set();
      if (wantTunnels) for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) if (tubeIndex.has(i + ',' + j)) want.add(i + ',' + j);
      let built = 0;
      for (const k of want) if (!tubeCells.has(k) && built < 3) {const m = tubeCell(k);tubeCells.set(k, m);if (m) group.add(m);built++;}
      for (const [k, m] of tubeCells) {const on = want.has(k);if (m) m.visible = on;if (!on && Math.abs(+k.split(',')[0] - ci) + Math.abs(+k.split(',')[1] - cj) > 7) {if (m) {group.remove(m);m.geometry.dispose();}tubeCells.delete(k);}}
    }
    // Which side a stop's doors open on, in the models' terms (+1 = the vehicle's left, -1 = its right), from the pole or the platform; 0 both.
    function stopSide(dir, si) {
      const st = dir.stops[si];if (!st) return 0;if (st.side !== undefined) return st.side;
      const p = TT.pointAt(dir, st.d);let q = null;
      if (st.pole) q = {x: st.pole.x, s: st.pole.s};
      else if (dir.line.mode === 'metro') {const S = stations.find(x => x.place && x.place === st.place);if (S) {const pl = sideOf(S, dir), c = TS.P(S.sp, 0, (pl.v0 + pl.v1) / 2), k = TS.P(S.sp, 0, 0), a = S.sp.a, along = (p.x - k[0]) * a[0] + (p.s - k[1]) * a[1];q = {x: c[0] + a[0] * along, s: c[1] + a[1] * along};}}
      if (!q) return st.side = 0;
      // cr > 0: the stop is on the right of the way of travel, which is the model's -x side (door side -1)
      const cr = (q.x - p.x) * -p.hs + (q.s - p.s) * p.hx;return st.side = Math.abs(cr) < .5 ? 0 : -Math.sign(cr);
    }
    const openDoors = (a) => {const sd = a.st && a.st.dwelling ? stopSide(a.dir, a.st.stop) : 0;return TM.doors(a.kind).filter(d => !sd || d.side === sd);};
    // ---------- Riding ----------
    let ride = null, ticketUntil = 0, engine = null;
    const audio = n => {try {ctx.audio && ctx.audio.sfx(n);} catch {}};
    const doorWorld = (a, door) => {
      const s = a.secs[door.section], K = TM.KINDS[a.kind], rx = s.fz, rz = -s.fx;
      return {x: s.x + s.fx * door.z + rx * (K.width / 2 + .1) * door.side, z: s.z + s.fz * door.z + rz * (K.width / 2 + .1) * door.side, y: s.y + K.floor, out: {x: rx * door.side, z: rz * door.side}};
    };
    function seatsTaken(key) {const out = new Set();for (const r of (ctx.remotes ? ctx.remotes() : [])) if (r.st && r.st.tr && r.st.tr[0] === key) out.add(r.st.tr[1]);return out;}
    function stopName(dir, si) {const s = dir.stops[si];return s ? s.name : '';}
    function canRideOn(dir, si) {const nx = dir.stops[si + 1];return !!(nx && nx.place);}
    function board(a, key) {
      const ms = now(), dir = a.dir, si = a.st.stop;
      if (!canRideOn(dir, si)) {ctx.notice(`${MODE_NAME[dir.line.mode]} ${dir.line.ref} leaves the game's map after ${stopName(dir, si)} – it does not take passengers here.`, 4);return;}
      if (ms > ticketUntil) {
        if (!ctx.wallet.pay(TICKET)) {ctx.notice(`A Ruter ticket costs ${KR(TICKET)} – you have ${ctx.kr(ctx.wallet.money)}.`, 4);audio('locked');return;}
        ticketUntil = ms + TICKET_MIN * 60000;audio('register');if (ctx.onPaid) ctx.onPaid();
        ctx.notice(`Ticket ${KR(TICKET)} (Ruter, zone 1) – valid for ${TICKET_MIN} minutes on every tram, bus and metro.`, 5);
      }
      const seats = TM.seats(a.kind), taken = seatsTaken(key);
      // the free seat nearest the door you came in by
      const dw = TM.doors(a.kind).map(d => ({d, p: doorWorld(a, d)})).sort((p, q) => Math.hypot(p.p.x - ctx.player.x, p.p.z - ctx.player.z) - Math.hypot(q.p.x - ctx.player.x, q.p.z - ctx.player.z))[0];
      const order = seats.map((s, i) => ({s, i})).filter(o => !taken.has(o.i)).sort((p, q) => Math.abs(p.s.section - dw.d.section) * 20 + Math.abs(p.s.z - dw.d.z) - Math.abs(q.s.section - dw.d.section) * 20 - Math.abs(q.s.z - dw.d.z));
      if (!order.length) {ctx.notice('It is full – wait for the next one.', 3);return;}
      ride = {key, a, dir, dep: a.dep, seat: order[0].i, s: order[0].s, lookYaw: 0, lookPitch: 0, lastStop: si, warned: false};
      engine = ctx.audio && ctx.audio.engine ? ctx.audio.engine('emotor') : null;
      const next = dir.stops[si + 1];
      ctx.notice(`${MODE_NAME[dir.line.mode]} ${dir.line.ref} to ${dir.to} · next stop ${next ? next.name : ''} · □ / E gets you off when the doors open at a stop`, 6);
      if (ctx.onBoard) ctx.onBoard();
    }
    function seatPose(a, seatIdx) {
      const s = TM.seats(a.kind)[seatIdx], sec = a.secs && a.secs[s.section];if (!sec) return null;
      const K = TM.KINDS[a.kind], rx = sec.fz, rz = -sec.fx, cp = Math.cos(sec.pitch);
      const along = s.z, y = sec.y + K.floor + .45 - Math.sin(sec.pitch) * along;
      return {x: sec.x + sec.fx * along * cp + rx * s.x, y, z: sec.z + sec.fz * along * cp + rz * s.x, yaw: sec.yaw + (s.face > 0 ? 0 : Math.PI), sec, seat: s};
    }
    function exitRide(reason) {
      if (!ride) return;
      const a = ride.a, K = TM.KINDS[a.kind];
      // out through the door on the platform side nearest your seat
      let best = null;
      if (a.secs) for (const d of openDoors(a)) {
        const p = doorWorld(a, d), q = {x: p.x + p.out.x * .8, z: p.z + p.out.z * .8}, spot = ctx.safeSpot(q.x, q.z, p.y - K.floor + (a.kind === 'metro' ? TS.PLAT_H : 0));
        if (!spot) continue;
        const sc = Math.hypot(spot.x - q.x, spot.z - q.z) * 3 + Math.abs(spot.y - (p.y - (a.kind === 'metro' ? 0 : K.floor))) * 4 + Math.abs(d.section - ride.s.section) * 2 + Math.abs(d.z - ride.s.z) * .3;
        if (!best || sc < best.sc) best = {sc, spot, yaw: Math.atan2(-p.out.x, -p.out.z)};// facing out, away from the door
      }
      if (engine) {engine.stop();engine = null;}
      const where = ride.dir.stops[ride.a.st ? ride.a.st.stop : 0];
      ride = null;
      if (ctx.onLeave) ctx.onLeave(best ? best.spot : null, best ? best.yaw : 0);
      if (reason) ctx.notice(reason, 5);else if (where) ctx.notice(`${where.name}.`, 2);
    }
    function updateRide(dt, input, camera, dl) {
      if (!ride) return;
      const a = active.get(ride.key);
      if (!a || !a.st || !a.secs) {// the vehicle is gone (should not happen: the ridden one is always kept)
        const pr = parseKey(ride.key);if (!pr || !TT.at(pr.dir, (now() - pr.dep) / 1000)) {exitRide('The ride ended.');return;}
        return;
      }
      ride.a = a;const st = a.st, dir = a.dir;
      ride.lookYaw = Math.max(-2.8, Math.min(2.8, ride.lookYaw - input.mouse.dx * .0024 * (ctx.sens ? ctx.sens().mouse : 1) - input.look.x * 2.2 * dt));
      ride.lookPitch = Math.max(-1.1, Math.min(1, ride.lookPitch - input.mouse.dy * .0024 * (ctx.sens ? ctx.sens().mouse : 1) - input.look.y * 1.6 * dt));
      const p = seatPose(a, ride.seat);if (!p) return;
      camera.position.set(p.x, p.y + .78, p.z);camera.rotation.order = 'YXZ';camera.rotation.set(ride.lookPitch - p.sec.pitch * (ride.s.face > 0 ? 1 : -1), p.yaw + Math.PI + ride.lookYaw, dl ? Math.sin(performance.now() / 1300) * .06 * dl : 0);
      if (engine) engine.set(Math.min(1.3, st.v / 14), st.v > .2 && !st.dwelling ? .5 : 0);
      ctx.player.x = p.x;ctx.player.z = p.z;ctx.player.feet = p.y - .45;
      // the stop you are at, the next one, and the end of the ride in the game's world
      const at = st.dwelling && st.stop < dir.stops.length && dir.stops[st.stop].k === st.k ? st.stop : -1;
      if (at >= 0 && !canRideOn(dir, at) && st.doors > .2 && !ride.warned) {ride.warned = true;ctx.notice(`Last stop in the game: ${dir.stops[at].name}. Please get off (the ${dir.line.mode === 'metro' ? 'train' : dir.line.mode} leaves the map).`, 6);}
      if (at >= 0 && !canRideOn(dir, at) && ride.warned && st.doors < .15 && !st.doors && (now() - a.dep) / 1000 > dir.TD[st.k] - 3) {exitRide(`You got off at ${dir.stops[at].name} – the line leaves the game's map here.`);return;}
      if (st.gone || (now() - a.dep) / 1000 > dir.run - 1) {exitRide('End of the line.');return;}
      if (input.pressed.has('square')) {if (at >= 0 && st.doors > .5) exitRide();else ctx.notice('The doors open at the next stop.', 1.5);input.pressed.delete('square');}
      renderHud(st, dir, at);
    }
    // ---------- HUD and the timetable panel ----------
    const css = document.createElement('style');css.textContent = `
      #transitHud{position:absolute;right:16px;top:64px;min-width:260px;max-width:min(520px,92vw);padding:9px 14px;border-radius:10px;background:rgba(12,14,17,.8);color:#f2f2ee;font:14px/1.35 system-ui,Segoe UI,Arial,sans-serif;pointer-events:none;z-index:5}
      #transitHud b{font-size:15px}
      #transitHud b{display:flex;align-items:center;gap:8px}#transitHud .tl{display:inline-block;min-width:34px;text-align:center;border-radius:4px;color:#fff;font-weight:700;padding:1px 6px}
      #transitHud ol{margin:4px 0 0;padding-left:18px;font-size:13px;opacity:.92}#transitHud small{display:block;margin-top:4px;opacity:.85}
      #transitPanel{position:absolute;inset:6vh 50% auto auto;transform:translateX(50%);width:min(720px,94vw);max-height:84vh;overflow:auto;background:rgba(14,17,20,.94);color:#f1f1ee;border-radius:12px;padding:16px 18px;font:14px/1.35 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 12px 40px #0008;z-index:30}
      #transitPanel h2{margin:0 0 2px;font-size:22px;display:flex;align-items:center;gap:10px}#transitPanel h2 i{font-style:normal;background:#e60000;color:#fff;border-radius:50%;width:30px;height:30px;display:inline-grid;place-items:center;font-size:13px}
      #transitPanel .sub{opacity:.75;margin-bottom:10px}#transitPanel .row{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;padding:7px 8px;border-radius:8px}
      #transitPanel .row.sel{background:#ffffff18;outline:1px solid #ffffff40}#transitPanel .tl{border-radius:5px;color:#fff;font-weight:800;text-align:center;padding:3px 0;font-size:16px}
      #transitPanel .to{font-weight:700}#transitPanel .side{opacity:.6;font-size:12px}#transitPanel .times{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
      #transitPanel .times b{color:#ffb21e}#transitPanel .stops{margin:2px 0 6px 62px;font-size:13px;opacity:.9;column-width:190px}#transitPanel .stops span{display:block;break-inside:avoid}
      #transitPanel .stops em{opacity:.6;font-style:normal}#transitPanel .hint{margin-top:10px;font-size:12px;opacity:.7}`;
    document.head.appendChild(css);
    const hud = document.createElement('div');hud.id = 'transitHud';hud.hidden = true;ctx.root.appendChild(hud);
    const panelEl = document.createElement('div');panelEl.id = 'transitPanel';panelEl.hidden = true;ctx.root.appendChild(panelEl);
    let hudKey = '';
    function renderHud(st, dir, at) {
      const ms = now(), nexts = [];
      for (let i = at >= 0 ? at + 1 : st.stop; i < dir.stops.length && nexts.length < 3; i++) {const s = dir.stops[i];if (!s.place) break;nexts.push(`${esc(s.name)} <span style="opacity:.7">${hhmm(ride.dep + dir.stopTimes[i] * 1000, TT)}</span>`);}
      const line = dir.line, head = `<b><span class="tl" style="background:${line.colour}">${line.ref}</span> ${MODE_NAME[line.mode]} to ${esc(dir.to)}</b>`;
      const now1 = at >= 0 ? `<small>${st.doors > .5 ? `Doors open at <b style="display:inline">${esc(dir.stops[at].name)}</b> · □ / E get off` : `At ${esc(dir.stops[at].name)}`}</small>` : `<small>Next: ${dir.stops[st.stop] ? esc(dir.stops[st.stop].name) : '–'} · ${Math.round(st.v * 3.6)} km/h</small>`;
      const html = head + now1 + (nexts.length ? `<ol>${nexts.map(n => `<li>${n}</li>`).join('')}</ol>` : '') + `<small>Look around with the right stick / mouse · ticket valid until ${hhmm(ticketUntil, TT)}</small>`;
      if (html !== hudKey) {hud.innerHTML = html;hudKey = html;}
      hud.hidden = false;
    }
    const panel = {open: false, sel: 0, rows: [], place: null, pole: null, t: 0, stick: false};
    function openPanel(place, pole, station) {
      panel.open = true;panel.place = place;panel.pole = pole;panel.station = station;panel.sel = 0;renderPanel();
    }
    function panelDirs() {
      const place = panel.place;
      const ds = panel.station ? N.dirs.filter(d => d.line.mode === 'metro' && d.stops.some(s => s.place === place)) : place.poles.flatMap(q => q.serves);
      const uniq = [...new Set(ds)];
      // this side of the street first, then by line
      return uniq.sort((a, b) => (a.line.night ? 1 : 0) - (b.line.night ? 1 : 0) || (panel.pole && panel.pole.serves.includes(b) ? 1 : 0) - (panel.pole && panel.pole.serves.includes(a) ? 1 : 0) || ['metro', 'tram', 'bus'].indexOf(a.line.mode) - ['metro', 'tram', 'bus'].indexOf(b.line.mode) || parseInt(a.line.ref) - parseInt(b.line.ref) || a.line.ref.localeCompare(b.line.ref));
    }
    function renderPanel() {
      const ms = now(), place = panel.place, dirs = panelDirs();
      panel.rows = dirs;panel.sel = Math.max(0, Math.min(dirs.length - 1, panel.sel));
      const rows = dirs.map((d, i) => {
        const si = d.stops.findIndex(s => s.place === place), times = TT.nextArrivals(d, si, ms, 4);
        const term = si === d.stops.length - 1 && !d.edge[1];
        const side = panel.pole && !panel.station ? (panel.pole.serves.includes(d) ? '' : '<span class="side"> · other side of the street</span>') : '';
        const tt = term ? '<span class="side">arrives here (end of the line)</span>' : times.length ? times.map((t, j) => j === 0 ? `<b>${whenText(t, ms)}</b>` : hhmm(t, TT)).join(' · ') : d.line.night ? '<span class="side">Friday and Saturday nights, 01–05</span>' : 'none until tomorrow';
        let stops = '';
        if (i === panel.sel && !term) {
          const list = [];const t0 = d.stopTimes[si];
          for (let j = si + 1; j < d.stops.length; j++) {const s = d.stops[j];list.push(`<span>${esc(s.name)} <em>+${Math.max(1, Math.round((d.stopTimes[j] - t0) / 60))} min${s.place ? '' : ' (off the map)'}</em></span>`);}
          const last = d.stops[d.stops.length - 1], rest = last ? d.names.slice(d.names.lastIndexOf(last.name) + 1) : [];
          for (const n of rest) list.push(`<span>${esc(n)} <em>…</em></span>`);
          stops = `<div class="stops">${list.join('') || '<span>–</span>'}</div>`;
        }
        return `<div class="row${i === panel.sel ? ' sel' : ''}"><span class="tl" style="background:${d.line.colour}">${d.line.ref}</span><span><span class="to">${esc(d.to)}</span><span class="side"> · ${d.line.night ? 'night bus' : MODE_NAME[d.line.mode].toLowerCase()}</span>${side}</span><span class="times">${tt}</span></div>${stops}`;
      }).join('');
      const mode = panel.station ? 'T-bane' : (panel.pole && panel.pole.tram ? 'Trikk' : 'Buss');
      panelEl.innerHTML = `<h2><i style="background:${panel.station ? '#ec700c' : panel.pole && panel.pole.tram ? '#1f5fb4' : '#e60000'}">${panel.station ? 'T' : mode === 'Trikk' ? 'TR' : 'B'}</i>${esc(place.name)}</h2><div class="sub">${mode} · departures from ${hhmm(ms, TT)} (Oslo time) · ticket ${KR(TICKET)}, valid ${TICKET_MIN} min${ms < ticketUntil ? ` – yours until ${hhmm(ticketUntil, TT)}` : ''}</div>${rows || '<div class="row">No lines stop here.</div>'}<div class="hint">↑ ↓ / stick: pick a line to see its stops · ○ / C or □ / E: close · the map (touchpad / M) shows every line and stop</div>`;
      panelEl.hidden = false;
    }
    panel.input = input => {
      if (!panel.open) return;
      const y = input.move.y;
      if (input.pressed.has('down') || (y > .6 && !panel.stick)) {panel.sel++;renderPanel();}
      if (input.pressed.has('up') || (y < -.6 && !panel.stick)) {panel.sel--;renderPanel();}
      panel.stick = Math.abs(y) > .6;
      if (input.pressed.has('circle') || input.pressed.has('square')) panel.close();
      panel.t -= 1 / 60;if (panel.t <= 0) {panel.t = 5;if (panel.open) renderPanel();}
      input.move.x = input.move.y = 0;input.look.x = input.look.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle', 'left', 'right'].forEach(b => input.pressed.delete(b));
    };
    panel.close = () => {panel.open = false;panelEl.hidden = true;};
    // ---------- Prompts on foot ----------
    function prompt(player) {
      if (!ctx.onFoot()) return null;
      const ms = now();
      // a vehicle with its doors open: board it
      for (const [key, a] of active) {
        if (!a.st || !a.secs || a.st.doors < .6 || !a.st.dwelling) continue;
        for (const d of openDoors(a)) {
          const p = doorWorld(a, d);
          if (Math.hypot(player.x - p.x, player.z - p.z) < 1.7 && Math.abs(player.feet - (p.y - (a.kind === 'metro' ? 0 : TM.KINDS[a.kind].floor))) < 1.2) {
            const dir = a.dir, si = a.st.stop;
            if (!canRideOn(dir, si)) return {text: `${MODE_NAME[dir.line.mode]} ${dir.line.ref} to ${dir.to} – not in service from here (it leaves the map)`, act: () => {}};
            const paid = ms < ticketUntil;
            return {text: `□ Get on ${MODE_NAME[dir.line.mode].toLowerCase()} ${dir.line.ref} to ${dir.to}${paid ? ' (your ticket is valid)' : ` (ticket ${KR(TICKET)})`}`, act: () => board(a, key)};
          }
        }
      }
      // at a stop: the timetable
      for (const P of poles) if (P.model && Math.hypot(player.x - P.p.x, player.z - P.p.z) < (P.shelter ? 3.2 : 2.2) && Math.abs(player.feet - P.y) < 2) return {text: `□ Timetable: ${P.name} (${P.q.serves.map(d => d.line.ref).filter((v, i, s) => s.indexOf(v) === i).join(', ')})`, act: () => openPanel(P.q.place, P.q, null)};
      for (const S of stations) {
        if (!S.built || !S.place) continue;
        for (const sp of S.L.spots) {const p = W(...TS.P(S.sp, sp.u, sp.v));if (Math.abs(player.feet - sp.y) < 2 && Math.hypot(player.x - p.x, player.z - p.z) < 30 && Math.abs(((toLocal(player.x, player.z).x - S.sp.c[0]) * S.sp.n[0] + (toLocal(player.x, player.z).s - S.sp.c[1]) * S.sp.n[1]) - sp.v) < 3) return {text: `□ Timetable: ${S.sp.name} T-bane`, act: () => openPanel(S.place, null, S)};}
        if (S.L.kiosk) {const k = S.L.kiosk, e = W(...k.E);if (Math.hypot(player.x - e.x, player.z - e.z) < 3 && Math.abs(player.feet - k.top) < 1.5) return {text: `□ Timetable: ${S.sp.name} T-bane (the stairs lead down to the platforms)`, act: () => openPanel(S.place, null, S)};}
      }
      return null;
    }
    // ---------- Map ----------
    const mapLines = N.dirs.map(d => {
      const pts = [];for (let k = 0; k < d.n; k += 8) if (inWorld(d.X[k], d.S[k], 60)) pts.push([d.X[k], d.S[k]]);else pts.push(null);
      return {d, pts, x0: Math.min(...[...d.X]), x1: Math.max(...[...d.X]), s0: Math.min(...[...d.S]), s1: Math.max(...[...d.S])};
    });
    function overlay(g, {P, k, d, big}) {
      const ord = {bus: 0, tram: 1, metro: 2};
      g.save();g.lineCap = 'round';g.lineJoin = 'round';
      for (const L of mapLines.slice().sort((a, b) => ord[a.d.line.mode] - ord[b.d.line.mode])) {
        const m = L.d.line.mode;if (L.d.line.night && big && k < 1.2 * d) continue;
        g.strokeStyle = L.d.line.colour;g.globalAlpha = m === 'bus' ? .55 : .85;g.lineWidth = (m === 'metro' ? 3.2 : m === 'tram' ? 2.4 : 1.6) * d * (big ? 1 : .8);
        if (m === 'metro') g.setLineDash([6 * d, 3 * d]);else g.setLineDash([]);
        g.beginPath();let pen = false;for (const p of L.pts) {if (!p) {pen = false;continue;}const [u, v] = P(p[0], p[1]);if (pen) g.lineTo(u, v);else g.moveTo(u, v);pen = true;}g.stroke();
      }
      g.setLineDash([]);g.globalAlpha = 1;
      // stops: white dots (tram ringed blue, bus red); metro stations: the orange T
      const showNames = big && k / d > 2.4;
      g.textAlign = 'center';g.textBaseline = 'middle';
      for (const pl of N.places) {
        if (pl.metro) continue;const [u, v] = P(pl.x, pl.s), tram = pl.lines.some(l => l.mode === 'tram'), r = (big ? 3.6 : 2.6) * d;
        g.fillStyle = '#fff';g.strokeStyle = tram ? '#1f5fb4' : '#d5121b';g.lineWidth = 1.6 * d;g.beginPath();g.arc(u, v, r, 0, 7);g.fill();g.stroke();
        if (showNames) {g.font = `600 ${10.5 * d}px system-ui`;g.lineWidth = 3 * d;g.strokeStyle = '#fff';g.strokeText(pl.name, u, v - 10 * d);g.fillStyle = '#123';g.fillText(pl.name, u, v - 10 * d);}
      }
      for (const S of stations) {
        const [u, v] = P(...S.sp.c), r = (big ? 8 : 5.5) * d;g.fillStyle = '#ec700c';g.beginPath();g.arc(u, v, r, 0, 7);g.fill();g.strokeStyle = '#fff';g.lineWidth = 1.5 * d;g.stroke();
        g.fillStyle = '#fff';g.font = `bold ${(big ? 10 : 7.5) * d}px system-ui`;g.fillText('T', u, v + .5 * d);
        if (big) {g.font = `bold ${11 * d}px system-ui`;g.lineWidth = 3 * d;g.strokeStyle = '#fff';g.strokeText(S.sp.name, u, v - r - 7 * d);g.fillStyle = '#7a3a00';g.fillText(S.sp.name, u, v - r - 7 * d);}
        if (S.L.kiosk && big && k / d > 1.6) {const [eu, ev] = P(...S.L.kiosk.E);g.fillStyle = '#ec700c';g.fillRect(eu - 3 * d, ev - 3 * d, 6 * d, 6 * d);}
      }
      g.restore();
    }
    // A line in the big map's legend.
    function legend(root) {
      const box = root.querySelector('.map-legend');if (!box || box.querySelector('.transit-legend')) return;
      const s = document.createElement('span');s.className = 'transit-legend';
      s.innerHTML = '<i class="lg" style="background:linear-gradient(90deg,#82c341 0 33%,#1f5fb4 33% 66%,#e60000 66%);border-radius:2px"></i>Trams, buses and the metro (T): lines and stops – □ at a stop shows its timetable';
      const small = box.querySelector('small');box.insertBefore(s, small);
    }
    // ---------- Parked vehicles out of the lanes ----------
    // A parked vehicle (by its world spot and half width) that stands in a bus or tram lane is moved sideways out of it, or
    // null if it is clear. The caller checks the new spot (and keeps the vehicle's number).
    function keepClear(x, z, half, margin = .35) {
      // -> null (clear) or the spots to try, best first: out to its own side of the lane, then to the other side, then further.
      // Clear = the vehicle's half width + margin away from the bus's (1.28 m) or tram's (1.33 m) swept half width.
      const l = toLocal(x, z), n = nearestLane(l.x, l.s, 8);if (!n) return null;
      const need = (n.tram ? 1.33 : 1.28) + half + margin;
      if (Math.abs(n.off) >= need) return null;
      const sg = n.off >= 0 ? 1 : -1, out = [];
      for (const [side, extra] of [[sg, .1], [sg, 1.2], [-sg, .1], [-sg, 1.2]]) {
        const move = side * (need + extra) - n.off, ls = {x: l.x - n.hs * move, s: l.s + n.hx * move}, again = nearestLane(ls.x, ls.s, 8);
        if (again && Math.abs(again.off) < (again.tram ? 1.33 : 1.28) + half + margin - .05) continue;
        out.push(W(ls.x, ls.s));
      }
      return out.length ? out : [];
    }
    // ---------- Each frame ----------
    let deep = false;
    function tick(dt, {camera, player}) {
      selT -= dt;if (selT <= 0) {selT = .3;select(camera, ride ? ride.key : null);}
      place(camera);
      updateStops(dt, camera);updateRails(dt, camera);updateStations(dt, camera);
      // underground: a station or a tunnel round the camera (the game then hides the world above and lights it for the dark)
      const c = camera.position, g = terrain(c.x, c.z), l = toLocal(c.x, c.z);
      const inSt = stations.some(S => S.L.inside(l.x, l.s, c.y));
      under = c.y < g - 2.6 && (inSt || (ride && ride.dir.line.mode === 'metro'));
      deep = under;
      updateTunnels(camera, under || api.showTunnels || (ride && ride.dir.line.mode === 'metro' && ride.a.st && ride.dir.tunnel[ride.a.st.k]));
      models.M.body.emissive.setHex(under ? 0x3a3d40 : 0x000000);
      if (portals.dark) portals.dark.visible = !(ride && ride.dir.line.mode === 'metro');// riders see the tunnel itself
      if (!ride) hud.hidden = true;
    }
    // Someone (or a car) a tram or bus has come up against goes out to the nearest side.
    function pushOut(x, z, y, r) {
      for (const o of solids) {
        if (y > o.maxY || y + 1.7 < o.minY) continue;
        const s = o.sec, dx = x - s.x, dz = z - s.z, along = dx * s.fx + dz * s.fz, side = dx * s.fz - dz * s.fx, hl = s.len / 2 + r, hw = o.hw + r;
        if (Math.abs(along) >= hl || Math.abs(side) >= hw) continue;
        let a = along, w = side;if (hw - Math.abs(side) < hl - Math.abs(along)) w = (side >= 0 ? 1 : -1) * (hw + .02);else a = (along >= 0 ? 1 : -1) * (hl + .02);
        return {x: s.x + s.fx * a + s.fz * w, z: s.z + s.fz * a - s.fx * w};
      }
      return null;
    }
    function localState() {return ride ? {tr: [ride.key, ride.seat]} : null;}
    // Other players aboard: on their seat in the same vehicle (worked out here from the shared clock).
    function pose(r, st, g) {
      if (!st || !st.tr) return false;
      const pr = parseKey(st.tr[0]);if (!pr) return false;
      const a = active.get(st.tr[0]) || {dir: pr.dir, dep: pr.dep, kind: kindOf(pr.dir.line)};
      if (!a.secs) {const s = TT.at(pr.dir, (now() - pr.dep) / 1000);if (!s) return false;a.secs = sectionsAt(pr.dir, s.d);}
      const p = seatPose(a, st.tr[1] | 0);if (!p) return false;
      g.position.set(p.x, p.y - .45, p.z);g.quaternion.setFromEuler(new T.Euler(0, p.yaw + Math.PI, 0));r.pos.copy(g.position);return true;
    }
    const poi = () => [];
    const api = {showTunnels: false,// test handle: draw the tunnels round the camera wherever it is
      group, floors, obstacles, cutsGround, poi, tick, prompt, panel, updateRide, overlay, legend, keepClear, pushOut, localState, pose, footprints: () => solids,
      get ride() {return ride;}, get deep() {return deep;}, get ticketUntil() {return ticketUntil;}, set ticketUntil(v) {ticketUntil = v;},
      leave: () => exitRide(), timetable: N, stations, portals, poles, active, sectionsAt, metroY, hud, inWorld, TICKET};
    return api;
  }
  return {create, prepare, TICKET, TICKET_MIN, kindOf};
});
