/* Construction City at Ulven (issue #85): the office building for the building and construction trade at Standardveien 1,
 * Oslo (LINK Arkitektur, opened 2025), with its inside and the two-level garage under it. The outline is OpenStreetMap way
 * 1333507389; the roofs are Kartverket's surface model (11, 10, 9 and 8 floors); the facts (six wings round a 35 m glass hall
 * with a sloped glass wall and a timber wall, a stair in the hall, the auditorium, staff restaurants, the sky bar and roof
 * terrace on the 10th floor, bronze enamelled glass with timber, two basement levels with parking) are from the architect,
 * the contractor and the press. The floors, stairs, rooms and garage are drawn by tools/construction_city_design.py into
 * construction-city-data.js (window.CONSTRUCTION_CITY); this module turns them into walk floors, walls and meshes.
 * GameConstructionCity.prepare(districts, data)  – before Surroundings.create: drop the patch's own block, cut the ground.
 * GameConstructionCity.create({T, lib, world, data, ground}) -> cc (see the end of create()).
 * Pure parts for Node tests: layout, offsetFor, cutPolygons, mapBuildings, levelName, FOOT.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameConstructionCity = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const OSM_ID = 'w1333507389';
  const ORD = k => `${k}${k % 10 === 1 && k !== 11 ? 'st' : k % 10 === 2 && k !== 12 ? 'nd' : k % 10 === 3 && k !== 13 ? 'rd' : 'th'}`;
  const levelName = k => k === -1 ? 'garage P2' : k === 0 ? 'garage P1' : k === 1 ? 'ground floor' : `${ORD(k)} floor`;
  const BLOCKS = {NW: 'north-west wing', W: 'west wing', SW: 'south-west wing', S: 'south wing', E: 'east wing', hall: 'glass hall', garage: 'garage'};
  const USES = {office: 'offices', collektivet: 'Collektivet, shared workplaces', cafe: 'café', foyer: 'foyer', canteen: 'staff restaurant', restaurant: 'restaurant',
    bikes: 'bike room', skybar: 'sky bar and boardroom', terrace: 'roof terrace', auditorium: 'auditorium', hall: 'reception', gallery: 'gallery', stair: 'stairs',
    lift: 'lift', garage: 'parking', hallstair: 'stairs', car: 'ramp', portal: 'ramp'};
  // Furniture footprints: size along the item's direction, across it, height (m). Seat rows and the stage carry their own size.
  const FOOT = {desk: [3.2, 1.6, .76], table: [1.4, 1.4, .75], sofa: [2.0, .9, .8], reception: [5, 1.2, 1.1], cafe: [6, 1.0, 1.1], tree: [1.2, 1.2, 3.5], bench: [3, .5, .45],
    bar: [8, 1.0, 1.1], board: [6, 2, .75], counter: [6, 1, 1.0], planter: [1.6, 1.6, .7], bike: [3.6, 1.8, 1.1], car: [4.4, 1.85, 1.45]};
  const Hk = (data, k) => data.H[String(k)];
  // What a lift stop has (the lift menu's second line).
  const liftNote = (b, k) => k <= 0 ? 'parking' : k === 1 ? ({NW: 'café · the glass hall', W: 'auditorium · the garage ramp', SW: 'staff restaurant · the glass hall', S: 'restaurant · gym', E: 'bike room (the street door is on the 2nd floor)'}[b] || 'the glass hall')
    : k === 10 && b === 'NW' ? 'roof terrace' : k === 10 && b === 'SW' ? 'sky bar and boardroom' : k <= 3 && ['NW', 'W', 'SW'].includes(b) ? 'Collektivet, shared workplaces' : 'offices';
  const inRing = (x, s, p) => {let r = false;for (let i = 0, j = p.length - 1; i < p.length; j = i++) {const a = p[i], b = p[j];if ((a[1] > s) !== (b[1] > s) && x < (b[0] - a[0]) * (s - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
  const inPts = (x, z, p) => {let r = false;for (let i = 0, j = p.length - 1; i < p.length; j = i++) {const a = p[i], b = p[j];if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) r = !r;}return r;};
  const boundsOf = pts => {let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;for (const p of pts) {x0 = Math.min(x0, p.x);x1 = Math.max(x1, p.x);z0 = Math.min(z0, p.z);z1 = Math.max(z1, p.z);}return {x0, x1, z0, z1};};
  const inB = (b, x, z, r = 0) => x >= b.x0 - r && x <= b.x1 + r && z >= b.z0 - r && z <= b.z1 + r;

  // ---------- Before the world is built ----------
  // The ground is left out under the building, its entrance aprons and the outer end of the garage ramp (they are drawn here).
  function cutPolygons(data) {return [data.ring, ...data.aprons.map(a => a.p), data.portal.p.slice(0, 4)];}
  function prepare(districts, data) {
    const cuts = cutPolygons(data);
    for (const d of districts || []) {
      if (!d || !Array.isArray(d.buildings)) continue;
      d.buildings = d.buildings.filter(b => b.id !== OSM_ID);
      // The building straddles the Gamle Oslo and Økern patches (x 1792): both lose their ground under it.
      if (data.ring.some(([x, s]) => x >= d.x0 - 10 && x <= d.x1 + 10 && s >= d.s0 - 10 && s <= d.s1 + 10)) d.cuts = (d.cuts || []).concat(cuts);
    }
  }
  const mapBuildings = data => data ? [{r: {o: data.ring.flat()}, s: 'modern'}] : [];
  // Kartverket's metres above sea level -> the game's heights: the median difference at points round the building.
  function offsetFor(data, heightWorld, toWorld) {
    const d = data.refs.map(([x, s, h]) => {const p = toWorld(x, s);return heightWorld(p.x, p.z) - h;}).sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)] : -94.855;
  }

  // ---------- Walk floors, walls, the garage's ground for vehicles (pure) ----------
  // toWorld(x, s) -> {x, z}; ground(x, z) = the terrain's height there (world); offset = game height - metres above sea level.
  function layout(data, {toWorld, ground, offset}) {
    const Y = h => h + offset, W = p => toWorld(p[0], p[1]), H = k => Y(Hk(data, k));
    const floors = [], obstacles = [], vehicleFloors = [], lifts = [], driveSpots = [];
    const line = (a, b) => {const A = W(a), B = W(b), dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);return {A, B, ux: dx / L, uz: dz / L, L};};
    for (const f of data.floors) {
      const fl = {points: f.p.map(W), y: Y(f.h), name: `Construction City ${f.use}`, surfaceKind: f.use, cc: {k: f.k, use: f.use, b: f.b}};
      floors.push(fl);if (f.use === 'garage') vehicleFloors.push(fl);
    }
    for (const s of data.slopes) {
      const l = line(s.a, s.b), ha = Y(s.ha), hb = Y(s.hb);
      const height = q => {const t = Math.max(0, Math.min(1, ((q.x - l.A.x) * l.ux + (q.z - l.A.z) * l.uz) / l.L));return ha + (hb - ha) * t;};
      const fl = {points: s.p.map(W), height, name: `Construction City ${s.kind}`, surfaceKind: s.kind, cc: {k: null, use: s.kind, b: s.kind === 'car' ? 'garage' : null, slope: s}};
      floors.push(fl);if (s.kind === 'car') vehicleFloors.push(fl);
    }
    // The garage ramp from the street: it starts at the street's own height 2 m outside the wall, so it meets the ground
    // exactly, and runs down to P1 22 m inside.
    const pr = data.portal, pl = line(pr.a, pr.b), top = {x: pl.A.x + pl.ux * 2, z: pl.A.z + pl.uz * 2}, h1 = ground(top.x, top.z), hP1 = Y(pr.hb), T1 = 3;
    const portalHeight = q => {
      const t = (q.x - pl.A.x) * pl.ux + (q.z - pl.A.z) * pl.uz;
      if (t <= T1) {const g = ground(q.x, q.z);return g + (h1 - g) * Math.max(0, t) / T1;}
      return h1 + (hP1 - h1) * Math.min(1, (t - T1) / (pl.L - T1));
    };
    {const fl = {points: pr.p.map(W), height: portalHeight, name: 'Construction City garage ramp', surfaceKind: 'portal', cc: {k: 0, use: 'portal', b: 'garage'}};floors.push(fl);vehicleFloors.push(fl);}
    // Entrance aprons: from the door's floor height out to the street's.
    const aprons = data.aprons.map(a => {
      const A = W(a.a), N = W([a.a[0] + a.n[0], a.a[1] + a.n[1]]), nx = N.x - A.x, nz = N.z - A.z, hd = Y(a.h);
      const height = q => {const t = Math.max(0, Math.min(1, ((q.x - A.x) * nx + (q.z - A.z) * nz) / a.depth));return hd + (ground(q.x, q.z) - hd) * t;};
      const fl = {points: a.p.map(W), height, name: `Construction City ${a.kind} entrance`, surfaceKind: 'apron', cc: {k: 1, use: 'apron', b: null}};floors.push(fl);return {...a, height, floor: fl};
    });
    for (const w of data.walls) obstacles.push({points: w.p.map(W), minY: Y(w.y0), maxY: Y(w.y1), kind: `cc-${w.m}`});
    // Furniture and parked cars.
    const rect = (x, s, yaw, a, b) => {const c = Math.cos(yaw), n = Math.sin(yaw);return [[a, b], [-a, b], [-a, -b], [a, -b]].map(([u, v]) => toWorld(x + c * u - n * v, s + n * u + c * v));};
    for (const it of data.items) {
      const [kind, x, s, k, yaw] = it;let f = FOOT[kind], dh = 0;
      if (kind === 'seatrow') {f = [.55, it[5], .5];dh = it[6];}
      else if (kind === 'stage') f = [it[5], 22, it[6]];
      if (!f) continue;
      const y = H(k) + dh;obstacles.push({points: rect(x, s, yaw, f[0] / 2, f[1] / 2), minY: y - .05, maxY: y + f[2], kind: `cc-${kind}`});
    }
    for (const b of data.bays) {
      if (b.car === true) obstacles.push({points: rect(b.x, b.s, b.yaw, FOOT.car[0] / 2, FOOT.car[1] / 2), minY: H(b.k) - .05, maxY: H(b.k) + FOOT.car[2], kind: 'cc-car'});
      if (b.car === 'drive') {
        const p = toWorld(b.x, b.s), q = toWorld(b.x + Math.cos(b.yaw), b.s + Math.sin(b.yaw));
        driveSpots.push({x: p.x, z: p.z, y: H(b.k), k: b.k, yaw: Math.atan2(-(q.x - p.x), -(q.z - p.z)), colour: b.colour});
      }
    }
    data.cores.forEach((c, i) => {
      const cab = c.lift.p.map(W), levels = [];for (let k = -1; k <= c.top; k++) levels.push(k);
      lifts.push({i, block: c.b, cab, bounds: boundsOf(cab), door: W(c.lift.door), levels, y: k => H(k)});
    });
    const ring = data.ring.map(W), ringB = boundsOf(ring), blockPts = data.blocks.map(bl => ({name: bl.name, p: bl.poly.map(W)}));
    const cutPts = cutPolygons(data).map(p => {const q = p.map(W);return {q, b: boundsOf(q)};});
    for (const f of vehicleFloors) f.bounds = boundsOf(f.points);
    for (const f of floors) f.bounds = f.bounds || boundsOf(f.points);
    const surface = (f, x, z) => typeof f.height === 'function' ? f.height({x, z}) : f.y;
    // Vehicles: the garage floor or ramp under them (the highest from 1.6 m below to 1.2 m above them), else null (the terrain).
    function vehicleGround(x, z, y) {
      if (y === undefined || !inB(ringB, x, z, 4)) return null;
      let best = null;
      for (const f of vehicleFloors) {
        if (!inB(f.bounds, x, z) || !inPts(x, z, f.points)) continue;
        const h = surface(f, x, z);if (h >= y - 1.6 && h <= y + 1.2 && (best === null || h > best)) best = h;
      }
      return best;
    }
    const cutsGround = (x, z) => inB(ringB, x, z, 8) && cutPts.some(c => inB(c.b, x, z) && inPts(x, z, c.q));
    const inside = (x, z, y) => inB(ringB, x, z) && inPts(x, z, ring) && y > H(-1) - 1 && y < H(12) + 3;
    // Which floor the feet are on (the highest walkable surface within 0.5 m of them): {k, use, b} or null.
    function where(x, z, y) {
      if (!inB(ringB, x, z, 7)) return null;
      let best = null, bh = -Infinity;
      for (const f of floors) {
        if (!inB(f.bounds, x, z) || !inPts(x, z, f.points)) continue;
        const h = surface(f, x, z);if (Math.abs(h - y) < .5 && h > bh) {bh = h;best = f;}
      }
      if (!best) return null;
      const c = best.cc;let k = c.k;
      if (c.slope || c.use === 'portal' || c.use === 'apron') {k = -1;for (let j = -1; j <= 12; j++) if (H(j) <= bh + .2) k = j;}
      let b = c.b;
      if (!b) b = (blockPts.find(bl => inPts(x, z, bl.p)) || {name: 'hall'}).name;
      return {k, use: c.use, b, y: bh};
    }
    function placeName(x, z, y) {
      const w = where(x, z, y);if (!w || w.use === 'apron') return null;
      if (w.k <= 0 || w.use === 'garage' || w.use === 'portal' || w.use === 'car') return `Construction City · ${w.use === 'portal' ? 'ramp down to the garage' : `garage ${w.k === -1 ? 'P2' : 'P1'}`}`;
      if (w.use === 'terrace') return 'Construction City · roof terrace, 10th floor';
      const use = USES[w.use] || w.use, part = BLOCKS[w.b] || '';
      return `Construction City · ${levelName(w.k)}${w.b === 'hall' ? ', glass hall' : part ? `, ${part}` : ''} · ${use}`;
    }
    function liftAt(x, z, y) {
      for (const l of lifts) {
        if (!inB(l.bounds, x, z) || !inPts(x, z, l.cab)) continue;
        for (const k of l.levels) if (Math.abs(l.y(k) - y) < .4) return {lift: l, k};
      }
      return null;
    }
    const indoor = (x, z, y) => {if (!inside(x, z, y)) return false;const w = where(x, z, y);return !w || w.use !== 'terrace';};
    // Footsteps: concrete in the garage and the bike room, the hall's timber stair and galleries, tiles or carpet elsewhere (tile).
    const surfaceAt = (x, z, y) => {const w = where(x, z, y);if (!w) return 'tile';return ['garage', 'portal', 'car', 'bikes'].includes(w.use) ? 'asphalt' : ['hallstair', 'gallery', 'terrace'].includes(w.use) || (w.use === 'stair' && w.b === 'hall') ? 'wood' : 'tile';};
    return {floors, obstacles, vehicleFloors, aprons, lifts, driveSpots, ring, ringB, vehicleGround, cutsGround, inside, indoor, where, placeName, surfaceAt, liftAt, portalHeight, H, Y};
  }

  // ---------- Drawing (browser) ----------
  function create({T, lib, world, data, ground}) {
    const toWorld = world.toWorld, offset = offsetFor(data, world.heightWorld, toWorld);
    const L = layout(data, {toWorld, ground: ground || world.heightWorld, offset});
    const H = L.H, Y = L.Y, F = Object.fromEntries(data.blocks.map(b => [b.name, b.floors]));F.hall = 9;
    const O = [1865, 1400];
    const g0 = toWorld(O[0], O[1]), g1 = toWorld(O[0] + 1, O[1]), theta = Math.atan2(-(g1.z - g0.z), g1.x - g0.x);
    const group = new T.Group();group.name = 'Construction City';group.position.set(g0.x, 0, g0.z);group.rotation.y = theta;
    const shell = new T.Group(), inner = new T.Group(), garage = new T.Group(), levelsGroup = new T.Group();
    shell.name = 'Construction City (outside)';inner.name = 'Construction City (inside)';garage.name = 'Construction City (garage)';
    group.add(shell, inner, garage, levelsGroup);
    const C = (x, s) => [x - O[0], s - O[1]];
    const rnd = (() => {let a = 85;return () => {a = (a * 1103515245 + 12345) & 0x7fffffff;return a / 0x7fffffff;};})();

    // A geometry builder: triangles with normals, UVs in metres and optional vertex colours, one mesh per material.
    function builder(colours = false) {return {p: [], n: [], uv: [], c: colours ? [] : null};}
    const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    function tri(B, a, b, c, ua, ub, uc, col) {
      const u = sub3(b, a), v = sub3(c, a), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
      for (const [p, t] of [[a, ua], [b, ub], [c, uc]]) {B.p.push(...p);B.n.push(n[0] / l, n[1] / l, n[2] / l);B.uv.push(...t);if (B.c) B.c.push(col.r, col.g, col.b);}
    }
    const quad = (B, a, b, c, d, ua, ub, uc, ud, col) => {tri(B, a, b, c, ua, ub, uc, col);tri(B, a, c, d, ua, uc, ud, col);};
    // A vertical rectangle over the map line p -> q (map x, s) from y0 to y1, with an optional offset along the normal.
    function wallQ(B, p, q, y0, y1, col, u0 = 0) {
      const a = C(...p), b = C(...q), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      quad(B, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [u0, y0], [u0 + L, y0], [u0 + L, y1], [u0, y1], col);
    }
    function flat(B, ring, y, up = true, col) {
      const pts = ring.map(p => C(...p)), v2 = pts.map(([x, z]) => new T.Vector2(x, z)), tris = T.ShapeUtils.triangulateShape(v2, []);
      for (const [i, j, k] of tris) {
        const a = [pts[i][0], y, pts[i][1]], b = [pts[j][0], y, pts[j][1]], c = [pts[k][0], y, pts[k][1]];
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);// > 0: the triangle faces up
        const [p, q, r] = (ny > 0) === up ? [a, b, c] : [a, c, b];
        tri(B, p, q, r, [p[0], p[2]], [q[0], q[2]], [r[0], r[2]], col);
      }
    }
    function prism(B, ring, y0, y1, col, caps = true) {
      for (let i = 0; i < ring.length; i++) wallQ(B, ring[i], ring[(i + 1) % ring.length], y0, y1, col);
      if (caps) {flat(B, ring, y1, true, col);flat(B, ring, y0, false, col);}
    }
    function finish(B, mat, parent, {shadow = false, name = ''} = {}) {
      if (!B.p.length) return null;
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(B.p, 3));g.setAttribute('normal', new T.Float32BufferAttribute(B.n, 3));g.setAttribute('uv', new T.Float32BufferAttribute(B.uv, 2));
      if (B.c) g.setAttribute('color', new T.Float32BufferAttribute(B.c, 3));g.computeBoundingSphere();
      const m = new T.Mesh(g, mat);m.castShadow = shadow;m.receiveShadow = true;m.name = name;m.userData.noMerge = true;parent.add(m);return m;
    }
    // Materials: lit from inside (an emissive copy of their colour), so the floors read as lit offices behind the glass.
    const lit = (m, k = .32) => {m.emissive = (m.color || new T.Color(1, 1, 1)).clone().multiplyScalar(k);if (m.map) m.emissiveMap = m.map;m.side = T.DoubleSide;return m;};
    const std = o => new T.MeshStandardMaterial(o);
    const M = {
      bronze: std({vertexColors: true, roughness: .38, metalness: .35, side: T.DoubleSide}),
      glass: std({color: 0x34424a, roughness: .06, metalness: .55, transparent: true, opacity: .42, depthWrite: false, side: T.DoubleSide}),
      glassIn: std({color: 0xb9d2dc, roughness: .05, metalness: .1, transparent: true, opacity: .18, depthWrite: false, side: T.DoubleSide}),
      timber: lit(lib.wood(0xa87a4f, .6), .1), fin: lib.wood(0x7a5638, .7), concrete: lit(lib.concrete(0xa3a29c), .1), plinth: lib.concrete(0x8e8d88),
      roof: std({color: 0x3c3e41, roughness: .9}), deck: lib.wood(0x8a6646, .8),
      carpet: lit(lib.fabric(0x5a6068), .16), carpetDark: lit(lib.fabric(0x30343c), .16), stone: lit(lib.concrete(0xbdb8ae), .1), plaster: lit(lib.plaster(0xe2e0da), .14),
      garageFloor: lit(lib.concrete(0x8d8c87), .16), garageCeil: lit(lib.concrete(0xb3b2ac), .18), stairs: lit(lib.concrete(0xb9b7b0), .14), blocks: lit(lib.wood(0xa97b50, .55), .12),
      steel: lib.metal(0x8b9096, .35), dark: std({color: 0x2a2c30, roughness: .6}), paint: std({color: 0xf2f0e8, roughness: .6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}),
      yellow: std({color: 0xf2c418, roughness: .55}), piling: lit(std({color: 0x6f6a62, roughness: .5, metalness: .6}), .15),
      lamp: std({color: 0xffffff, emissive: 0xf3f6ff, emissiveIntensity: 1.4}), items: std({vertexColors: true, roughness: .7, emissive: 0x262626}), cars: std({vertexColors: true, roughness: .45, metalness: .3}),
    };
    const SHADES = [0x7a5a3c, 0x8a6844, 0x6e5238, 0x93724e, 0x5f4632, 0xa07c55].map(h => new T.Color(h));
    const W1 = new T.Color(1, 1, 1);

    // ---------- Outside: the facades, the hall's sloped glass and glass roof, roofs, signs ----------
    const B = {bronze: builder(true), glass: builder(), fin: builder(), plinth: builder(), concrete: builder(), roof: builder(), timber: builder(), dark: builder(), deck: builder(), ceil: builder()};
    const P = data.ring, n = P.length, top = b => b === 'hall' ? Hk(data, 10) : Hk(data, F[b] + 1);
    const hallSouth = 10;// the outline edge P10 -> P11 is the hall's sloped glass wall
    for (const fc of data.facade) {
      const i = fc.i, a = P[i], b = P[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]), eg = data.edgeGround[i];
      const at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], gAt = t => {const f = t * (eg.length - 1), j = Math.min(eg.length - 2, Math.floor(f));return eg[j] + (eg[j + 1] - eg[j]) * (f - j);};
      const roofH = top(fc.b), panels = Math.max(1, Math.round(len / 2.7));
      const hall = fc.b === 'hall', storeys = hall ? 1 : F[fc.b];
      for (let j = 0; j < panels; j++) {
        const t0 = j / panels, t1 = (j + 1) / panels, tm = (t0 + t1) / 2, p0 = at(t0), p1 = at(t1);
        const gmin = Math.min(gAt(t0), gAt(t1)), gmax = Math.max(gAt(t0), gAt(t1)), tone = SHADES[Math.floor(rnd() * 6)];
        const band = (y0, y1, kind) => {
          const op = fc.open.find(q => tm > q[0] && tm < q[1] && y0 < q[3] && y1 > q[2]);
          if (op) {if (y1 > op[3]) band(Math.max(y0, op[3]), y1, kind === 'glass' ? 'lintel' : kind);if (y0 < op[2]) band(y0, Math.min(y1, op[2]), kind);return;}
          if (y1 - y0 < .02) return;
          if (kind === 'glass') wallQ(B.glass, p0, p1, Y(y0), Y(y1));
          else if (kind === 'plinth') wallQ(B.plinth, p0, p1, Y(y0), Y(y1), null, t0 * len);
          else if (kind === 'lintel') wallQ(B.dark, p0, p1, Y(y0), Y(y1));
          else wallQ(B.bronze, p0, p1, Y(y0), Y(y1), kind === 'parapet' ? SHADES[2] : tone, t0 * len);
        };
        band(Math.min(gmin, Hk(data, 1)) - .8, Hk(data, 1) - .4, 'plinth');
        if (i === hallSouth) continue;// drawn below
        for (let k = 1; k <= storeys; k++) {
          const y = Hk(data, k), yn = hall ? Hk(data, 10) : Hk(data, k + 1);
          if (k === 1) {
            const solid = gmax > y + .2 ? Math.min(yn - .4, gmax + .3) : y + .2;// below the street on the east side
            band(y - .4, solid, solid > y + .2 ? 'plinth' : 'spandrel');band(solid, yn - .4, 'glass');
          } else {band(y - .4, y + .9, 'spandrel');band(y + .9, yn - .4, 'glass');}
        }
        band(roofH - .4, roofH + data.levels.parapet, 'parapet');
      }
      // Timber fins outside the glass every 1.35 m (none across the doors and the garage portal).
      if (i !== hallSouth) {
        const nf = Math.floor(len / 1.35), nx = fc.n[0], ns = fc.n[1], ux = (b[0] - a[0]) / len, us = (b[1] - a[1]) / len;
        for (let j = 1; j < nf; j++) {
          const t = j / nf;if (fc.open.some(o => t > o[0] - .02 && t < o[1] + .02)) continue;
          const c = at(t), q = [[-.06, .02], [.06, .02], [.06, .37], [-.06, .37]].map(([u, v]) => [c[0] + ux * u + nx * v, c[1] + us * u + ns * v]);
          prism(B.fin, q, Y(Hk(data, 1) + .2), Y(roofH + data.levels.parapet - .1), null, false);
        }
        // Door frames and a canopy over each entrance.
        for (const o of fc.open) {
          const c0 = at(o[0]), c1 = at(o[1]), up = Y(o[3]);
          for (const c of [c0, c1]) prism(B.dark, [[-.08, -.15], [.08, -.15], [.08, .15], [-.08, .15]].map(([u, v]) => [c[0] + ux * u + nx * v, c[1] + us * u + ns * v]), Y(o[2]), up, null);
          if (o[4] !== 'portal') prism(B.dark, [[0, 0], [1, 0], [1, 2.2], [0, 2.2]].map(([u, v]) => [c0[0] + (c1[0] - c0[0]) * u + nx * v, c0[1] + (c1[1] - c0[1]) * u + ns * v]), up + .35, up + .6, null);
          else {// the garage portal: a yellow and black height bar and the P sign
            const y = Y(o[3]) - .45;prism(B.dark, [[0, .2], [1, .2], [1, .45], [0, .45]].map(([u, v]) => [c0[0] + (c1[0] - c0[0]) * u + nx * v, c0[1] + (c1[1] - c0[1]) * u + ns * v]), y, y + .3, null);
          }
        }
      }
    }
    // The hall's sloped glass wall: a 3.2 m glass front with the main doors, then glass leaning 7 m in to the roof at the 10th floor.
    const hd = data.hall, hu = hd.u, hv = [-hu[1], hu[0]], s0 = hd.south[0], s1 = hd.south[1], lean = hd.lean, base = Hk(data, 1) + 3.2, roofY = Hk(data, 10);
    const inset = (p, k) => [p[0] - hv[0] * k, p[1] - hv[1] * k];
    {
      const fc = data.facade.find(f => f.i === hallSouth), o = fc.open[0], len = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
      const at = t => [s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t];
      wallQ(B.glass, s0, at(o[0]), Y(Hk(data, 1)), Y(base));wallQ(B.glass, at(o[1]), s1, Y(Hk(data, 1)), Y(base));wallQ(B.glass, at(o[0]), at(o[1]), Y(o[3]), Y(base));
      const a0 = C(...s0), a1 = C(...s1), b0 = C(...inset(s0, lean)), b1 = C(...inset(s1, lean));
      quad(B.glass, [a0[0], Y(base), a0[1]], [a1[0], Y(base), a1[1]], [b1[0], Y(roofY), b1[1]], [b0[0], Y(roofY), b0[1]], [0, 0], [len, 0], [len, 1], [0, 1]);
      // timber mullions up the slope and transoms across it
      const nm = Math.round(len / 2.7);
      for (let j = 0; j <= nm; j++) {
        const p = at(j / nm), q = inset(p, lean), d = [hu[0] * .09, hu[1] * .09];
        const A = C(p[0] - d[0], p[1] - d[1]), Bq = C(p[0] + d[0], p[1] + d[1]), Cq = C(q[0] + d[0], q[1] + d[1]), D = C(q[0] - d[0], q[1] - d[1]);
        quad(B.timber, [A[0], Y(base), A[1]], [Bq[0], Y(base), Bq[1]], [Cq[0], Y(roofY), Cq[1]], [D[0], Y(roofY), D[1]], [0, 0], [.2, 0], [.2, 30], [0, 30]);
        wallQ(B.dark, [p[0] - d[0], p[1] - d[1]], [p[0] + d[0], p[1] + d[1]], Y(Hk(data, 1)), Y(base));
      }
      for (let j = 1; j < 9; j++) {const f = j / 9, y = base + (roofY - base) * f, p = inset(s0, lean * f), q = inset(s1, lean * f);wallQ(B.timber, p, q, Y(y) - .12, Y(y) + .12);}
      prism(B.dark, [inset(s0, -.15), inset(s1, -.15), inset(s1, .15), inset(s0, .15)], Y(base) - .2, Y(base) + .2, null);
    }
    // The glass roof between the timber wall and the top of the sloped glass, on glulam beams across the hall.
    {
      const n0 = P[25], n1 = P[24], t0 = inset(s0, lean), t1 = inset(s1, lean), ry = Y(roofY) + .9;
      const a = C(...n0), b = C(...n1), c = C(...t1), d = C(...t0);
      quad(B.glass, [a[0], ry, a[1]], [b[0], ry, b[1]], [c[0], Y(roofY) + .3, c[1]], [d[0], Y(roofY) + .3, d[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
      const nb = 11;
      for (let j = 0; j <= nb; j++) {
        const f = j / nb, p = [n0[0] + (n1[0] - n0[0]) * f, n0[1] + (n1[1] - n0[1]) * f], q = [t0[0] + (t1[0] - t0[0]) * f, t0[1] + (t1[1] - t0[1]) * f];
        const e = [hu[0] * .2, hu[1] * .2];
        prism(B.timber, [[p[0] - e[0], p[1] - e[1]], [p[0] + e[0], p[1] + e[1]], [q[0] + e[0], q[1] + e[1]], [q[0] - e[0], q[1] - e[1]]], Y(roofY) - .7, Y(roofY) + .25, null);
      }
      // the timber wall: the hall side of its north wall, floor to roof
      const iw = [hv[0] * .32, hv[1] * .32];wallQ(B.timber, [n0[0] + iw[0], n0[1] + iw[1]], [n1[0] + iw[0], n1[1] + iw[1]], Y(Hk(data, 1)), Y(roofY));
    }
    // Roofs (the north-west wing's is the terrace, drawn with the floors) and the stair houses on top of the cores.
    for (const bl of data.blocks) {
      if (bl.name === 'hall' || bl.name === 'NW') continue;
      const y = Y(top(bl.name));flat(B.roof, bl.poly, y, true);flat(B.ceil, bl.poly, y - .4, false);
    }
    for (const c of data.cores) {
      const f = c.o, u = c.u, v = [-u[1], u[0]], at = (a, b) => [f[0] + u[0] * a + v[0] * b, f[1] + u[1] * a + v[1] * b];
      const r = [at(0, 0), at(7, 0), at(7, 8.2), at(0, 8.2)];flat(B.roof, r, Y(Hk(data, c.top) + 3.2), true);
    }
    // CONSTRUCTION CITY in letters along the top of the hall's north wall, toward Standardveien.
    {
      const cv = document.createElement('canvas');cv.width = 2048;cv.height = 192;const x = cv.getContext('2d');x.clearRect(0, 0, 2048, 192);x.fillStyle = '#f4efe6';x.font = 'bold 150px system-ui, Arial';x.textAlign = 'center';x.textBaseline = 'middle';x.fillText('CONSTRUCTION CITY', 1024, 100);
      const tex = new T.CanvasTexture(cv);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
      const m = new T.Mesh(new T.PlaneGeometry(26, 2.4), new T.MeshStandardMaterial({map: tex, transparent: true, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .35, roughness: .6}));
      const a = P[25], b = P[24], c = [(a[0] + b[0]) / 2 - hv[0] * .45, (a[1] + b[1]) / 2 - hv[1] * .45], cc = C(...c);
      m.position.set(cc[0], Y(roofY) - 1.2, cc[1]);m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);m.rotateY(Math.PI);m.userData.noMerge = true;shell.add(m);
    }
    finish(B.fin, M.fin, shell, {shadow: true, name: 'Construction City timber fins'});finish(B.plinth, M.plinth, shell, {shadow: true});finish(B.roof, M.roof, shell, {shadow: true});
    finish(B.timber, M.timber, shell, {shadow: true, name: 'Construction City hall timber'});finish(B.dark, M.dark, shell, {shadow: true});finish(B.ceil, M.plaster, inner, {name: 'Construction City top ceilings'});

    // ---------- Inside: floors, ceilings, stairs, walls, rails ----------
    const FB = {}, fb = k => FB[k] || (FB[k] = builder());
    const FLOOR_MAT = {office: 'carpet', collektivet: 'carpet', skybar: 'carpetDark', auditorium: 'carpetDark', cafe: 'stone', foyer: 'stone', canteen: 'stone', restaurant: 'stone',
      hall: 'stone', gallery: 'blocks', bikes: 'garageFloor', garage: 'garageFloor', stair: 'stairs', lift: 'steel', terrace: 'deck'};
    for (const f of data.floors) {
      const mk = f.b === 'hall' && f.use === 'stair' ? 'blocks' : FLOOR_MAT[f.use] || 'stone', y = Y(f.h);
      flat(fb(f.k <= 0 ? `g:${mk}` : mk), f.p, y, true);
      if (f.k >= 0 && f.use !== 'lift') flat(fb(f.k <= 0 ? 'g:garageCeil' : 'plaster'), f.p, y - .4, false);// the ceiling of the floor below
    }
    // Flights: one box per step; the hall's in timber blocks (the reused handrails), the cores' in concrete.
    const steps = (s, mk) => {
      const pa = s.p, a = s.a, b = s.b, dx = b[0] - a[0], ds = b[1] - a[1], len = Math.hypot(dx, ds), ux = dx / len, us = ds / len, vx = -us, vs = ux;
      const w = Math.abs((pa[1][0] - pa[0][0]) * vx + (pa[1][1] - pa[0][1]) * vs) || Math.abs((pa[2][0] - pa[1][0]) * vx + (pa[2][1] - pa[1][1]) * vs), rise = s.hb - s.ha;
      const nst = Math.max(2, Math.ceil(Math.abs(rise) / .18)), B2 = fb(mk);
      for (let i = 0; i < nst; i++) {
        const t0 = i / nst * len, t1 = (i + 1) / nst * len, yTop = Y(s.ha + rise * (rise > 0 ? (i + 1) / nst : i / nst));
        const r = [[t0, -w / 2], [t1, -w / 2], [t1, w / 2], [t0, w / 2]].map(([t, v]) => [a[0] + ux * t + vx * v, a[1] + us * t + vs * v]);
        prism(B2, r, Math.min(yTop - .25, Y(Math.min(s.ha, s.hb)) - .02), yTop, null);
      }
    };
    for (const s of data.slopes) {
      if (s.kind === 'car') {const r = s.p, B2 = fb('g:garageFloor'), A = C(...r[0]), B3 = C(...r[1]), C3 = C(...r[2]), D = C(...r[3]), ya = Y(s.ha), yb = Y(s.hb);
        quad(B2, [A[0], ya, A[1]], [D[0], ya, D[1]], [C3[0], yb, C3[1]], [B3[0], yb, B3[1]], [0, 0], [6.5, 0], [6.5, 24], [0, 24]);}
      else steps(s, s.kind === 'hallstair' ? 'blocks' : 'stairs');
    }
    // The street ramp: its surface follows the street at the top (1 m strips), then a straight ramp to P1.
    {
      const r = data.portal.p, A = r[0], Bq = r[1], Cq = r[2], D = r[3], seg = 24;
      for (let j = 0; j < seg; j++) {
        const f0 = j / seg, f1 = (j + 1) / seg, l0 = [A[0] + (Bq[0] - A[0]) * f0, A[1] + (Bq[1] - A[1]) * f0], l1 = [A[0] + (Bq[0] - A[0]) * f1, A[1] + (Bq[1] - A[1]) * f1];
        const r0 = [D[0] + (Cq[0] - D[0]) * f0, D[1] + (Cq[1] - D[1]) * f0], r1 = [D[0] + (Cq[0] - D[0]) * f1, D[1] + (Cq[1] - D[1]) * f1];
        const q = p => {const c = C(...p);return [c[0], L.portalHeight(toWorld(...p)), c[1]];};
        quad(fb('g:garageFloor'), q(l0), q(l1), q(r1), q(r0), [0, f0 * 24], [0, f1 * 24], [6.5, f1 * 24], [6.5, f0 * 24]);
      }
      // short concrete walls beside its top end, outside the building (from 2 m out to the wall)
      const len = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), ux = (Bq[0] - A[0]) / len, us = (Bq[1] - A[1]) / len, ox = (D[0] - A[0]) / Math.hypot(D[0] - A[0], D[1] - A[1]), os = (D[1] - A[1]) / Math.hypot(D[0] - A[0], D[1] - A[1]);
      for (const [p, sgn] of [[A, -1], [D, 1]]) {
        const q2 = [p[0] + ux * 2.1, p[1] + us * 2.1], w = toWorld(...p), gy = (ground || world.heightWorld)(w.x, w.z);
        prism(fb('concreteWall'), [p, q2, [q2[0] + ox * .25 * sgn, q2[1] + os * .25 * sgn], [p[0] + ox * .25 * sgn, p[1] + os * .25 * sgn]], gy - .6, gy + .9, null);
      }
    }
    // Entrance aprons: paving that follows its height function, with kerbs down (or up) to the street on its sides.
    for (const ap of L.aprons) {
      const r = ap.p, A = r[0], Bq = r[1], Cq = r[2], D = r[3], nA = 8, nB = 6, B2 = fb('apron');
      const at = (i, j) => {const f = i / nA, e = j / nB, p0 = [A[0] + (D[0] - A[0]) * f, A[1] + (D[1] - A[1]) * f], p1 = [Bq[0] + (Cq[0] - Bq[0]) * f, Bq[1] + (Cq[1] - Bq[1]) * f], p = [p0[0] + (p1[0] - p0[0]) * e, p0[1] + (p1[1] - p0[1]) * e], w = toWorld(...p), c = C(...p);return {c: [c[0], ap.height(w), c[1]], g: ground(w.x, w.z), p};};
      for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), d = at(i + 1, j);quad(B2, a.c, b.c, c.c, d.c, [a.c[0], a.c[2]], [b.c[0], b.c[2]], [c.c[0], c.c[2]], [d.c[0], d.c[2]]);}
      for (const side of [0, nB]) for (let i = 0; i < nA; i++) {const a = at(i, side), b = at(i + 1, side), lo = q => Math.min(q.c[1], q.g) - .3;quad(B2, a.c, b.c, [b.c[0], lo(b), b.c[2]], [a.c[0], lo(a), a.c[2]], [0, a.c[1]], [1, b.c[1]], [1, lo(b)], [0, lo(a)]);}
    }
    // The garage's outer walls on both levels, on the inside of the outer wall (the plinth is drawn on the line itself).
    for (const fc of data.facade) {
      const a = P[fc.i], b = P[(fc.i + 1) % n], q = [fc.n[0] * -.3, fc.n[1] * -.3];
      wallQ(fb('g:concrete'), [a[0] + q[0], a[1] + q[1]], [b[0] + q[0], b[1] + q[1]], Y(Hk(data, -1)), Y(Hk(data, 1)) - .4);
    }
    // Walls, columns, rails.
    const WALL_MAT = {core: 'plaster', coreBlock: 'plaster', concrete: 'g:concrete', column: 'g:concrete', rail: 'rail', glassRail: 'rail', glassWall: 'glassWall', innerFacade: 'innerFacade', piling: 'piling', auditoriumWall: 'auditorium'};
    for (const w of data.walls) {
      const mk = WALL_MAT[w.m];if (!mk) continue;
      if (mk === 'rail') {prism(fb('glassRail'), w.p, Y(w.y0) + .1, Y(w.y1) - .05, null, false);prism(fb('steelTop'), w.p, Y(w.y1) - .05, Y(w.y1), null);continue;}
      if (mk === 'innerFacade') {// the wall of a taller wing above a lower one's roof: storeys of bronze and glass like its outer walls
        const [p0, p1] = [w.p[0], w.p[1]];let y = w.y0;
        for (let k = 1; k <= 12; k++) {const h = Hk(data, k), h1 = Hk(data, k + 1);if (h1 <= w.y0 + .2 || h >= w.y1) continue;
          const a0 = Math.max(w.y0, h - .4), a1 = Math.min(w.y1, h + .9), b1 = Math.min(w.y1, h1 - .4);if (a1 > a0) wallQ(B.bronze, p0, p1, Y(a0), Y(a1), SHADES[k % 6]);if (b1 > a1) wallQ(B.glass, p0, p1, Y(a1), Y(b1));y = b1;}
        if (w.y1 > y) wallQ(B.bronze, p0, p1, Y(y), Y(w.y1), SHADES[2]);
        continue;
      }
      prism(fb(mk), w.p, Y(w.y0), Y(w.y1), null);
    }
    finish(B.bronze, M.bronze, shell, {shadow: true, name: 'Construction City facades'});finish(B.glass, M.glass, shell, {name: 'Construction City glass'});
    // Rails round the hall's void on the floors above (galleries and the wings' floor edges) and along the stair's sides.
    {
      const at = (a, b) => [hd.o[0] + hu[0] * a + hv[0] * b, hd.o[1] + hu[1] * a + hv[1] * b], [S0, SL, RUN, b0, b1, b2, b3] = hd.stair;
      const rail = (p, q, y) => {const d = [q[0] - p[0], q[1] - p[1]], l = Math.hypot(...d), nn = [-d[1] / l * .05, d[0] / l * .05];prism(fb('glassRail'), [p, q, [q[0] + nn[0], q[1] + nn[1]], [p[0] + nn[0], p[1] + nn[1]]], y, y + 1.05, null, false);prism(fb('steelTop'), [p, q, [q[0] + nn[0], q[1] + nn[1]], [p[0] + nn[0], p[1] + nn[1]]], y + 1.05, y + 1.1, null);};
      for (let k = 2; k <= 9; k++) {
        const y = Y(Hk(data, k));
        rail(at(-3, 4.5), at(S0, 4.5), y);rail(at(S0 + SL, 4.5), at(hd.len + 3, 4.5), y);
        rail(P[10], at(...(() => {const l = [P[10][0] - hd.o[0], P[10][1] - hd.o[1]];return [l[0] * hu[0] + l[1] * hu[1], 4.5];})()), y);
        rail(P[11], at(...(() => {const l = [P[11][0] - hd.o[0], P[11][1] - hd.o[1]];return [l[0] * hu[0] + l[1] * hu[1], 4.5];})()), y);
      }
      for (let k = 1; k <= 8; k++) {const y0 = Y(Hk(data, k)), y1 = Y(Hk(data, k + 1));rail(at(S0 + SL, b3), at(S0 + SL + RUN, b3), (y0 + y1) / 2 - .9);rail(at(S0 + SL, b0 + .02), at(S0 + SL + RUN, b0 + .02), (y0 + y1) / 2 - .9);}
      // gallery fascias in timber
      for (let k = 2; k <= 9; k++) {const y = Y(Hk(data, k));wallQ(fb('blocks'), at(-3, 4.52), at(hd.len + 3, 4.52), y - .45, y);}
    }
    // Lift doors (steel frames, open) and the cabins' back panels.
    for (const c of data.cores) {
      const f = c.o, u = c.u, v = [-u[1], u[0]], at = (a, b) => [f[0] + u[0] * a + v[0] * b, f[1] + u[1] * a + v[1] * b];
      for (let k = -1; k <= c.top; k++) {
        const y = Y(Hk(data, k));
        for (const bb of [5.8, 7.5]) prism(fb('steel'), [at(-.05, bb), at(.3, bb), at(.3, bb + .1), at(-.05, bb + .1)], y, y + 2.3, null);
        prism(fb('steel'), [at(-.05, 5.8), at(.3, 5.8), at(.3, 7.6), at(-.05, 7.6)], y + 2.2, y + 2.35, null);
        wallQ(fb('steel'), at(2.8, 5.45), at(2.8, 7.95), y, y + 2.3);
      }
    }
    // Ceiling lights (rows of panels over each office floor) and the garage's tubes.
    const lampsByLevel = {};
    for (const it of data.items) if (['desk', 'table', 'sofa', 'bike'].includes(it[0])) (lampsByLevel[it[3]] = lampsByLevel[it[3]] || []).push(it);
    const IN_MAT = {carpet: M.carpet, carpetDark: M.carpetDark, stone: M.stone, plaster: M.plaster, stairs: M.stairs, blocks: M.blocks, steel: M.steel, deck: M.deck, apron: M.stone,
      glassRail: M.glassIn, steelTop: M.steel, glassWall: M.glassIn, innerFacade: M.plaster, piling: M.piling, auditorium: M.timber, concreteWall: M.concrete};
    for (const [k, Bk] of Object.entries(FB)) {
      if (k.startsWith('g:')) {const mk = k.slice(2);finish(Bk, mk === 'garageCeil' ? M.garageCeil : mk === 'concrete' ? M.concrete : M.garageFloor, garage, {name: `Construction City garage ${mk}`});continue;}
      const parent = k === 'apron' || k === 'concreteWall' || k === 'deck' ? shell : inner;
      finish(Bk, IN_MAT[k] || M.stone, parent, {shadow: k === 'deck' || k === 'apron', name: `Construction City ${k}`});
    }

    // ---------- Furniture (instanced, per floor) and the garage's cars, lines and lights ----------
    // A kind's model is boxes with vertex colours: [w (along), h, d (across), x, y, z, colour].
    const KIT = {
      desk: [[3.2, .04, 1.6, 0, .74, 0, 0xe9e4da], [.05, .7, 1.5, -1.55, .37, 0, 0x6b6e73], [.05, .7, 1.5, 1.55, .37, 0, 0x6b6e73], [3.1, .42, .03, 0, 1.0, 0, 0x8fa39a],
        [.55, .32, .03, -.8, 1.02, -.35, 0x1d1f22], [.55, .32, .03, .8, 1.02, -.35, 0x1d1f22], [.55, .32, .03, -.8, 1.02, .35, 0x1d1f22], [.55, .32, .03, .8, 1.02, .35, 0x1d1f22],
        [.5, .08, .5, -.8, .46, -1.15, 0x30343a], [.5, .08, .5, .8, .46, -1.15, 0x30343a], [.5, .08, .5, -.8, .46, 1.15, 0x30343a], [.5, .08, .5, .8, .46, 1.15, 0x30343a],
        [.5, .5, .06, -.8, .75, -1.4, 0x30343a], [.5, .5, .06, .8, .75, -1.4, 0x30343a], [.5, .5, .06, -.8, .75, 1.4, 0x30343a], [.5, .5, .06, .8, .75, 1.4, 0x30343a]],
      table: [[1.4, .05, 1.4, 0, .74, 0, 0xc9a47a], [.12, .72, .12, 0, .36, 0, 0x3a3a3a], [.45, .06, .45, 0, .46, -1.0, 0x4f6f5a], [.45, .06, .45, 0, .46, 1.0, 0x4f6f5a], [.45, .06, .45, -1.0, .46, 0, 0x4f6f5a], [.45, .06, .45, 1.0, .46, 0, 0x4f6f5a]],
      sofa: [[2.0, .42, .9, 0, .21, 0, 0x8a4d3a], [2.0, .5, .2, 0, .62, -.35, 0x7a4333], [.8, .45, .8, 0, .23, 1.3, 0xd8cbb0]],
      reception: [[5.0, 1.1, 1.2, 0, .55, 0, 0xb98a5a], [5.2, .05, 1.3, 0, 1.12, 0, 0xefece4]],
      cafe: [[6.0, 1.05, 1.0, 0, .52, 0, 0x3d3a36], [6.1, .05, 1.1, 0, 1.08, 0, 0xc49a68], [.5, .45, .45, -2.0, 1.32, 0, 0xb0b4b8], [.5, .45, .45, 1.8, 1.32, 0, 0xb0b4b8]],
      tree: [[.3, 2.6, .3, 0, 1.3, 0, 0x6b4a32], [2.6, 2.2, 2.6, 0, 3.1, 0, 0x3f6a32, 'ball'], [1.8, 1.6, 1.8, .3, 4.2, -.2, 0x4d7d3c, 'ball'], [1.3, .6, 1.3, 0, .3, 0, 0x5c5953]],
      bench: [[3.0, .1, .5, 0, .42, 0, 0xc08d5c], [.3, .4, .45, -1.2, .2, 0, 0x8f8b85], [.3, .4, .45, 1.2, .2, 0, 0x8f8b85]],
      bar: [[8.0, 1.05, 1.0, 0, .52, 0, 0x2a2622], [8.1, .06, 1.1, 0, 1.08, 0, 0xc49a68], [7.6, 1.6, .3, 0, 2.0, -1.4, 0x3a2f28], [.4, .7, .4, -3, .35, 1.0, 0x8a8f94], [.4, .7, .4, -1, .35, 1.0, 0x8a8f94], [.4, .7, .4, 1, .35, 1.0, 0x8a8f94], [.4, .7, .4, 3, .35, 1.0, 0x8a8f94]],
      board: [[6.0, .06, 2.0, 0, .74, 0, 0x5a3f2c], [5.0, .7, .3, 0, .35, 0, 0x2a2a2a], ...[-2.2, -1.1, 0, 1.1, 2.2].flatMap(x => [[.5, .9, .5, x, .45, -1.4, 0x22252a], [.5, .9, .5, x, .45, 1.4, 0x22252a]])],
      counter: [[6.0, 1.0, 1.0, 0, .5, 0, 0xbfc3c7], [6.0, .05, 1.1, 0, 1.02, 0, 0xe8e6e1], [6.0, .35, .4, 0, 1.45, -.2, 0xd9dee2]],
      planter: [[1.6, .7, 1.6, 0, .35, 0, 0x6a6256], [1.4, .9, 1.4, 0, 1.05, 0, 0x3f6a32, 'ball']],
      bike: [[3.6, .06, .06, 0, .4, -.6, 0x8a8f94], ...[-1.5, -.9, -.3, .3, .9, 1.5].flatMap(b => [[.05, .65, 1.7, b, .45, 0, [0x1b4f8a, 0xb23a2e, 0x2e2e2e, 0x3f7a3a][Math.abs(Math.round(b * 10)) % 4]], [.04, .04, .5, b, 1.0, .5, 0x222222]])],
      seatrow: [[.5, .45, 1, 0, .22, 0, 0x7b2f35], [.08, .5, 1, .24, .65, 0, 0x7b2f35]],
      stage: [[1, 1, 1, 0, .5, 0, 0x2b2b2e]],
      car: [[4.3, .62, 1.8, 0, .55, 0, 0xffffff], [2.3, .5, 1.6, -.2, 1.12, 0, 0x1d2329], [4.32, .16, 1.82, 0, .3, 0, 0x222222], ...[[1.35, .78], [1.35, -.78], [-1.35, .78], [-1.35, -.78]].map(([x, z]) => [.62, .62, .22, x, .31, z, 0x161616])],
    };
    const kitGeo = kind => {
      const P2 = [], N2 = [], C2 = [];
      for (const [w, h, d, x, y, z, col, shape] of KIT[kind]) {
        const g = (shape === 'ball' ? new T.IcosahedronGeometry(.5, 1).scale(w, h, d) : new T.BoxGeometry(w, h, d)).toNonIndexed();g.translate(x, y, z);const c = new T.Color(col);
        P2.push(...g.attributes.position.array);N2.push(...g.attributes.normal.array);for (let i = 0; i < g.attributes.position.count; i++) C2.push(c.r, c.g, c.b);g.dispose();
      }
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(P2, 3));g.setAttribute('normal', new T.Float32BufferAttribute(N2, 3));g.setAttribute('color', new T.Float32BufferAttribute(C2, 3));return g;
    };
    const byLevel = new Map();// level -> [meshes] (shown near the player's floor)
    const m4 = new T.Matrix4(), q4 = new T.Quaternion(), e3 = new T.Euler(), s3 = new T.Vector3(), p3 = new T.Vector3();
    const groups = new Map();
    for (const it of data.items) {const key = `${it[0]}|${it[3]}`;if (!groups.has(key)) groups.set(key, []);groups.get(key).push(it);}
    for (const [key, list] of groups) {
      const [kind, kStr] = key.split('|'), k = +kStr;if (!KIT[kind]) continue;
      const mesh = new T.InstancedMesh(kitGeo(kind), M.items, list.length);
      list.forEach((it, i) => {
        const [, x, s, , yaw] = it, c = C(x, s);let sx = 1, sy = 1, sz = 1, dy = 0;
        if (kind === 'seatrow') {sz = it[5];dy = it[6];}
        if (kind === 'stage') {sx = it[5];sy = it[6];sz = 22;}
        p3.set(c[0], Y(Hk(data, k)) + dy, c[1]);q4.setFromEuler(e3.set(0, -yaw, 0));s3.set(sx, sy, sz);
        m4.compose(p3, q4, s3);mesh.setMatrixAt(i, m4);
      });
      mesh.computeBoundingSphere();mesh.receiveShadow = true;mesh.name = `Construction City ${kind} (${levelName(k)})`;mesh.userData.noMerge = true;
      (k <= 0 ? garage : levelsGroup).add(mesh);if (k > 0) {if (!byLevel.has(k)) byLevel.set(k, []);byLevel.get(k).push(mesh);}
    }
    // Ceiling panels over the furniture rows.
    for (const [kStr, list] of Object.entries(lampsByLevel)) {
      const k = +kStr, y = Y(Hk(data, k + 1)) - .42, mesh = new T.InstancedMesh(new T.BoxGeometry(1.2, .04, .3), M.lamp, list.length);
      list.forEach((it, i) => {const c = C(it[1], it[2]);m4.compose(p3.set(c[0], y, c[1]), q4.setFromEuler(e3.set(0, -it[4], 0)), s3.set(1, 1, 1));mesh.setMatrixAt(i, m4);});
      mesh.computeBoundingSphere();mesh.userData.noMerge = true;mesh.name = `Construction City lights (${levelName(k)})`;levelsGroup.add(mesh);if (!byLevel.has(k)) byLevel.set(k, []);byLevel.get(k).push(mesh);
    }
    // Garage: parked cars in eight colours, painted bay lines, a tube light over each aisle bay, signs.
    {
      const parked = data.bays.filter(b => b.car === true), cars = new T.InstancedMesh(kitGeo('car'), M.cars, parked.length);
      const COL = [0xd8d8d6, 0x1e1f22, 0x7d8288, 0x1c3d6e, 0x8a1f1f, 0x3f4a3c, 0xb7b9bc, 0x2b4f7a].map(h => new T.Color(h));
      parked.forEach((b, i) => {const c = C(b.x, b.s);m4.compose(p3.set(c[0], Y(Hk(data, b.k)), c[1]), q4.setFromEuler(e3.set(0, -b.yaw, 0)), s3.set(1, 1, 1));cars.setMatrixAt(i, m4);cars.setColorAt(i, COL[b.colour]);});
      cars.computeBoundingSphere();cars.castShadow = false;cars.receiveShadow = true;cars.name = 'Construction City parked cars';cars.userData.noMerge = true;garage.add(cars);
      const lines = builder(), tubes = builder();
      for (const b of data.bays) {
        const y = Y(Hk(data, b.k)) + .012, c = Math.cos(b.yaw), s = Math.sin(b.yaw), at = (u, v) => [b.x + c * u - s * v, b.s + s * u + c * v];
        for (const v of [-1.25, 1.25]) {const r = [at(-2.5, v - .05), at(2.5, v - .05), at(2.5, v + .05), at(-2.5, v + .05)];flat(lines, r, y, true);}
        const r = [at(-3.6, -.6), at(-3.6, .6), at(-3.8, .6), at(-3.8, -.6)];prism(tubes, r, Y(Hk(data, b.k + 1)) - .55, Y(Hk(data, b.k + 1)) - .5, null);
      }
      finish(lines, M.paint, garage, {name: 'Construction City bay lines'});finish(tubes, M.lamp, garage, {name: 'Construction City garage lights'});
      const sign = (text, p, yaw, y, w = 3, bg = '#1d4f91') => {
        const cv = document.createElement('canvas');cv.width = 512;cv.height = 128;const x = cv.getContext('2d');x.fillStyle = bg;x.fillRect(0, 0, 512, 128);x.fillStyle = '#ffffff';x.font = 'bold 64px system-ui, Arial';x.textAlign = 'center';x.textBaseline = 'middle';x.fillText(text, 256, 68);
        const tex = new T.CanvasTexture(cv);tex.colorSpace = T.SRGBColorSpace;const m = new T.Mesh(new T.PlaneGeometry(w, w / 4), new T.MeshStandardMaterial({map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .5, side: T.DoubleSide}));
        const c = C(...p);m.position.set(c[0], y, c[1]);m.rotation.y = -yaw;m.userData.noMerge = true;return m;
      };
      const pr = data.portal, d = [pr.b[0] - pr.a[0], pr.b[1] - pr.a[1]], yaw = Math.atan2(d[1], d[0]) + Math.PI / 2, facadeTop = [pr.a[0] + d[0] / Math.hypot(...d) * 1.9, pr.a[1] + d[1] / Math.hypot(...d) * 1.9];
      shell.add(sign('P  ·  2,0 m', facadeTop, yaw, Y(Hk(data, 1)) + 3.5, 3.4));
      const b = data.bays.find(x => x.k === 0);if (b) garage.add(sign('P1 · Construction City', [b.x, b.s], b.yaw + Math.PI / 2, Y(Hk(data, 0)) + 2.6, 4));
      const b2 = data.bays.find(x => x.k === -1);if (b2) garage.add(sign('P2', [b2.x, b2.s], b2.yaw + Math.PI / 2, Y(Hk(data, -1)) + 2.6, 2));
    }

    // ---------- Far away: one block per wing (the glass hall is left open) ----------
    const far = new T.Group();far.name = 'Construction City (far)';
    {
      const FBp = builder(true);
      for (const bl of data.blocks) if (bl.name !== 'hall') prism(FBp, bl.poly, Y(Hk(data, 1)) - 1, Y(top(bl.name) + data.levels.parapet), SHADES[1]);
      const m = finish(FBp, std({vertexColors: true, roughness: .5, metalness: .2}), far, {name: 'Construction City (far)'});
      far.position.copy(group.position);far.rotation.y = theta;
    }

    // ---------- Each frame: what to show ----------
    const centre = toWorld(1865, 1400);
    function tick(camera, player) {
      const cp = camera.position, d = Math.hypot(cp.x - centre.x, cp.z - centre.z), near = d < 170;
      far.visible = d > 420;inner.visible = near;
      const w = player && near ? L.where(player.x, player.z, player.feet) : null, inG = cp.y < Y(Hk(data, 1)) - .6 && L.inside(cp.x, cp.z, cp.y);
      const portal = toWorld(...data.portal.a), nearPortal = Math.hypot(cp.x - portal.x, cp.z - portal.z) < 35;
      garage.visible = inG || nearPortal || (w && w.k <= 0);
      // Furniture and lights: on your floor and the ones next to it inside; the lower three from outside close by.
      const k = w ? w.k : null;
      for (const [lv, meshes] of byLevel) {const on = near && (k !== null && k > 0 ? Math.abs(lv - k) <= 1 : d < 90 && lv <= 3);for (const m of meshes) m.visible = on;}
    }
    tick({position: new T.Vector3(1e5, 0, 1e5)}, null);
    const lifts = L.lifts;
    // A lift ride: the same place in the cabin on another floor.
    const ride = (l, k, x, z) => ({x, z, y: l.y(k)});
    return {group, far, floors: L.floors, obstacles: L.obstacles, vehicleFloors: L.vehicleFloors, groundAt: L.vehicleGround, cutsGround: L.cutsGround,
      inside: L.inside, indoor: L.indoor, where: L.where, placeName: L.placeName, surfaceAt: L.surfaceAt, liftAt: L.liftAt, lifts, ride, driveSpots: L.driveSpots, tick, levelName, centre,
      blockName: b => BLOCKS[b] || b, liftNote,
      offset, H, poi: {x: centre.x, z: centre.z}, layout: L};
  }

  return {prepare, create, layout, offsetFor, cutPolygons, mapBuildings, levelName, liftNote, FOOT, OSM_ID};
});
