/* Oslo politihus with its glattceller, Oslo fengsel (Botsen) and police cars you can drive (issue #140).
 * Politihuset i Oslo (Grønlandsleiret 44) is OSM way 31405792 (30 m, the long slab on the slope above Grønland, "Grønland
 * politistasjon" amenity way 557060199). Oslo fengsel (Botsfengselet, Åkebergveien 11, OSM relation 7951550) is right behind it:
 * the 1851 building with its wings (way 105350644) inside the walls (barrier = wall ways, fetched from Overpass on 23 Nov 2026,
 * kept here in local metres to 0.1 m: DATA.walls).
 * prepare(districts, District) cuts a notch into each building's ring behind part of one wall (GameShops.notchFor, like the shops)
 * and lowers the patch's ground there just below the floor; create() fills the notches:
 *   - the police station: a glass front with the POLITI sign, the reception (desk with an officer, a queue-ticket machine, chairs)
 *     and, behind a steel door, the arrest: a corridor and eight glattceller (bare concrete, a thin mattress on the floor, a
 *     drain, a steel door with a hatch that opens and closes);
 *   - the prison: the door from the yard to cell wing A, a guard, a corridor and cells with a bed, table, toilet and barred window;
 *   - the walls round the prison (brick, piers) with two sliding steel gates (outer and inner wall) and the OSLO FENGSEL sign.
 *   The doors and gates are game doors (□, shared online); the hatches are local. Interiors are merged and hidden beyond 90 m.
 * Police cars (create(...).makeCars(VH, places, {notice})): the hatchback in white with the POLITI livery (black and
 * fluorescent-yellow fields) and a blue light bar; L3 / H cycles off -> blue lights -> lights and siren. The state rides in the
 * car's netExtra, so others online see the lights and hear the siren (no Worker change).
 * spots({roads, anchors, keep, ok}) (pure, Node-tested) picks the cars' kerb places near anchors, nearest first, deterministic.
 * GamePolice: {DATA, edgeOf, prepare, wallPlan, spots, create}.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GamePolice = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // game-shops.js sets the global GameShops (also under Node).
  const shopsApi = () => (typeof window !== 'undefined' && window.GameShops) || (typeof module === 'object' ? (require('./game-shops.js'), globalThis.GameShops) : null);
  // Local metres east (x) and south (s) of Haarklous plass 17A.
  const DATA = {
    district: 'gamle-oslo',
    // edge: the wall the notch is cut behind (as two points of the ring); t: the part of that wall; door: where the door is along it.
    station: {osm: 'w31405792', name: 'Oslo politihus', address: 'Grønlandsleiret 44', edge: [[-261.7, 2873.1], [-399.9, 2812.2]], t: [.36, .52], depth: 10, door: 7},
    prison: {osm: 'w105350644', name: 'Oslo fengsel', address: 'Åkebergveien 11', edge: [[-270.9, 2932.2], [-288.8, 2967.7]], t: [.15, .72], depth: 10, door: 1.55},
    // The prison's own buildings are 1850s brick (the patch had them as plaster).
    brick: ['w105350644', 'w557057124', 'w557057120', 'w557057109'],
    centre: [-285, 2985],
    // OSM barrier = wall (and the short fences that close the ring), h = height, th = thickness.
    walls: [
      {id: 262450760, h: 6, th: .5, p: [[-305.1, 2944.5], [-279.2, 2893.5], [-241.6, 2909.8], [-216.3, 2957.9], [-204.0, 2981.3], [-192.2, 2985.9], [-175.2, 2945.6], [-147.6, 2957.6], [-136.7, 2931.8], [-131.0, 2934.3], [-127.7, 2935.7], [-120.5, 2926.2], [-72.2, 2963.1], [-70.1, 2964.7], [12.7, 3027.9], [11.8, 3037.6], [-29.1, 3062.8], [-82.1, 3082.2], [-136.7, 3094.7], [-244.0, 3060.4], [-321.9, 3071.9], [-358.8, 3052.8], [-333.3, 3001.1]]},
      {id: 262450774, h: 5, th: .45, p: [[-241.8, 3056.2], [-155.4, 3084.1], [-146.0, 3086.7], [-142.7, 3085.9], [-133.5, 3088.9], [-100.0, 3081.3], [-87.6, 3078.5], [-65.6, 3072.4], [-31.9, 3060.1], [-12.3, 3048.0], [6.9, 3036.1], [6.9, 3027.6], [3.2, 3024.7], [-47.0, 2985.6]]},
      {id: 262450775, h: 5, th: .45, p: [[-318.8, 2980.7], [-330.0, 3002.9], [-340.6, 3024.0], [-321.3, 3032.9]]},
      {id: 262450779, h: 5, th: .45, p: [[-311.8, 2966.8], [-301.6, 2946.5], [-279.1, 2901.9], [-264.0, 2905.2], [-244.5, 2915.6], [-256.3, 2939.5]]},
      {id: 263307476, h: 5, th: .45, p: [[-350.0, 2935.6], [-355.2, 2945.3]]},
      {id: 263307478, h: 5, th: .45, p: [[-367.7, 2968.7], [-364.7, 2963.1]]},
      {id: 263308043, h: 5, th: .45, p: [[-155.2, 2981.1], [-165.4, 3006.5]]},
      {id: 557057099, h: 5, th: .45, p: [[-315.4, 2965.1], [-305.1, 2944.5]]},
      {id: 557057100, h: 5, th: .45, p: [[-333.3, 3001.1], [-322.3, 2978.9]]},
      {id: 1030902620, h: 5, th: .45, p: [[-327.1, 2971.7], [-328.9, 2975.4], [-322.3, 2978.9], [-318.8, 2980.7], [-311.5, 2984.3]]},
      {id: 1030902621, h: 5, th: .45, p: [[-304.6, 2970.5], [-311.8, 2966.8], [-315.4, 2965.1], [-322.0, 2961.7], [-324.1, 2965.8]]},
      {id: 557057104, h: 3, th: .12, kind: 'fence', p: [[-305.1, 2944.5], [-322.6, 2935.3]]},
      {id: 263307479, h: 3, th: .12, kind: 'fence', p: [[-301.6, 2946.5], [-305.1, 2944.5]]},
      {id: 263307477, h: 3, th: .12, kind: 'fence', p: [[-330.0, 3002.9], [-333.3, 3001.1]]},
      {id: 557057102, h: 3, th: .12, kind: 'fence', p: [[-333.3, 3001.1], [-352.5, 2990.9]]}
    ],
    // The two gates on the way in from the footpath behind the police station: wall (index in walls), segment, place along it, width.
    gates: [
      {id: 'fengsel-port-ytre', name: 'Prison gate (outer wall)', wall: 0, seg: 1, t: .30, w: 3.6},
      {id: 'fengsel-port-indre', name: 'Prison gate (inner wall)', wall: 3, seg: 2, t: .58, w: 3.0}
    ],
    // Police cars round the city (one near each): Grønland T, Tøyen T, Jernbanetorget, Carl Berners plass, Schous plass,
    // Storgata (Kiwi), Torshov. Six more stand outside the police station (its anchor is made in create()).
    anchors: [
      {x: -921, s: 2629, n: 1, reach: 130}, {x: -48, s: 2299, n: 1, reach: 130}, {x: -1392, s: 2694, n: 1, reach: 160}, {x: 165, s: 1183, n: 1, reach: 130},
      {x: -880, s: 1740, n: 1, reach: 130}, {x: -1312, s: 2374, n: 1, reach: 130}, {x: -60, s: 120, n: 1, reach: 160}
    ]
  };

  // ---------- Pure helpers ----------
  const near = (p, q, r) => Math.hypot(p[0] - q[0], p[1] - q[1]) < r;
  // The index of the ring edge from a to b (either way round; flip = the ring runs b -> a).
  function edgeOf(ring, a, b, tol = 1.5) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {const p = ring[i], q = ring[(i + 1) % n];if (near(p, a, tol) && near(q, b, tol)) return {edge: i, flip: false};if (near(p, b, tol) && near(q, a, tol)) return {edge: i, flip: true};}
    return null;
  }
  // Cut the two notches (before Surroundings.create builds the patch). District = the district.js API (height, flatten).
  function prepare(districts, District) {
    const d = (districts || []).find(x => x && x.name === DATA.district);if (!d) return 0;
    const S = shopsApi();if (!S) return 0;let n = 0;
    for (const B of [DATA.station, DATA.prison]) {
      if (B.local) continue;
      const b = d.buildings.find(x => x.id === B.osm);if (!b) continue;
      const e = edgeOf(b.ring, B.edge[0], B.edge[1]);if (!e) continue;
      const [t0, t1] = e.flip ? [1 - B.t[1], 1 - B.t[0]] : B.t;
      const nt = S.notchFor(b.ring, e.edge, t0, t1, B.depth);
      b.ring = nt.ring;b.hip = null;B.local = nt;B.bldg = b;
      // The room frame: a along the front, b into the building; the origin is the end where (a, b) turn like (x, s).
      const left = [-nt.u[1], nt.u[0]], flip = left[0] * nt.n[0] + left[1] * nt.n[1] < 0;
      const u = flip ? [-nt.u[0], -nt.u[1]] : nt.u, o = flip ? nt.P1 : nt.P0;
      B.frame = {o, u, W: nt.W, D: nt.depth};
      B.at = (a, bb) => [o[0] + u[0] * a - u[1] * bb, o[1] + u[1] * a + u[0] * bb];
      if (District) {
        // Floor = the street at the door + 5 cm; the ground under the room (and a cell round it) goes just below it.
        const door = B.at(B.door, -.8);B.patch = d;B.District = District;B.floorRel = District.height(d, door[0], door[1]) + .05;
        District.flatten(d, [B.at(0, 0), B.at(nt.W, 0), B.at(nt.W, nt.depth), B.at(0, nt.depth)], B.floorRel - .25, 9);
      }
      n++;
    }
    for (const b of d.buildings) if (DATA.brick.includes(b.id)) b.style = 'brick';
    return n;
  }
  // The walls in straight pieces (at most maxLen long, the gates left open), piers at the corners and gate edges, and the gates.
  function wallPlan(walls = DATA.walls, gates = DATA.gates, maxLen = 3.5) {
    const pieces = [], piers = [], out = [];
    const pier = (p, w) => {if (w.kind === 'fence') return;const q = piers.find(x => near(x.p, p, .4));if (q) {q.h = Math.max(q.h, w.h);q.th = Math.max(q.th, w.th);} else piers.push({p, h: w.h, th: w.th});};
    walls.forEach((w, wi) => {
      const P = w.p;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], dx = b[0] - a[0], ds = b[1] - a[1], L = Math.hypot(dx, ds);if (L < .05) continue;
        const u = [dx / L, ds / L], at = c => [a[0] + u[0] * c, a[1] + u[1] * c];
        const cuts = gates.filter(g => g.wall === wi && g.seg === i).map(g => {const c = g.t * L;out.push({...g, c: at(c), u, h: w.h, th: w.th});return [c - g.w / 2, c + g.w / 2];}).sort((p, q) => p[0] - q[0]);
        let x = 0;const spans = [];for (const [c0, c1] of cuts) {if (c0 > x) spans.push([x, c0]);x = c1;}if (x < L) spans.push([x, L]);
        for (const [s0, s1] of spans) {
          const k = Math.max(1, Math.ceil((s1 - s0) / maxLen - 1e-9));
          for (let j = 0; j < k; j++) pieces.push({a: at(s0 + (s1 - s0) * j / k), b: at(s0 + (s1 - s0) * (j + 1) / k), u, h: w.h, th: w.th, kind: w.kind || 'wall', id: w.id});
        }
        for (const [c0, c1] of cuts) {pier(at(c0), w);pier(at(c1), w);}
      }
      for (const p of P) pier(p, w);
    });
    return {pieces, piers, gates: out};
  }
  // Kerb places for parked police cars: for each anchor {x, s, n, reach, gap}, candidates every 1.5 m along both sides of the
  // nearby streets (on the kerb lane of wide streets, beside narrow ones), nearest first; `ok(c)` is the game's check.
  const KINDS = new Set(['residential', 'tertiary', 'secondary', 'unclassified', 'service', 'living_street']);
  function segDist(p, ax, as, bx, bs) {const dx = bx - ax, ds = bs - as, L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - as) * ds) / L));return Math.hypot(p[0] - ax - dx * t, p[1] - as - ds * t);}
  function spots({roads, anchors, keep = [], ok}) {
    const out = [];
    for (const A of anchors) {
      const cand = [], P = [A.x, A.s], gap = A.gap || 6.5;
      for (const r of roads) {
        if (!KINDS.has(r.k) || !r.p) continue;
        const p = r.p, offs = r.w >= 6 ? r.w / 2 - 1.05 : r.w / 2 + 1.3;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i], as = p[i + 1], bx = p[i + 2], bs = p[i + 3], L = Math.hypot(bx - ax, bs - as);
          if (L < 2 || segDist(P, ax, as, bx, bs) > A.reach) continue;
          const ux = (bx - ax) / L, us = (bs - as) / L;
          for (let t = 1; t <= L - 1; t += 1.5) for (const side of [1, -1]) {
            const x = ax + ux * t - us * offs * side, s = as + us * t + ux * offs * side, d = Math.hypot(x - A.x, s - A.s);
            if (d <= A.reach) cand.push({x, s, heading: Math.atan2(ux * side, us * side), d});
          }
        }
      }
      cand.sort((p, q) => p.d - q.d || p.x - q.x || p.s - q.s);
      let got = 0;
      for (const c of cand) {
        if (got >= A.n) break;
        if (out.some(o => Math.hypot(o.x - c.x, o.s - c.s) < gap) || keep.some(o => Math.hypot(o.x - c.x, o.s - c.s) < (o.r || gap))) continue;
        if (ok && !ok(c)) continue;
        out.push(c);got++;
      }
    }
    return out;
  }

  // ---------- Browser ----------
  function create({T, lib, world, audio, avatars}) {
    const SD = window.SURROUNDINGS, group = new T.Group();group.name = 'Oslo politihus and Oslo fengsel';
    // Children of `local` are in the map's frame: x = local x, z = local s, y = world height (as game-rathkes.js).
    const local = new T.Group();local.rotation.y = SD.geo.theta;local.position.set(SD.geo.x, 0, SD.geo.z);group.add(local);
    const floors = [], obstacles = [], hitboxes = [], doors = [], hatches = [], talkers = [], sliders = [], frames = [], cars = [];
    const hitM = new T.MeshBasicMaterial({visible: false});
    const W2 = (x, s) => world.toWorld(x, s), gAt = (x, s) => {const w = W2(x, s);return world.heightWorld(w.x, w.z);};
    const lit = (m, e = 0x1c1c1a) => {if (m.emissive) m.emissive.setHex(e);return m;};
    const M = {
      terrazzo: lit(lib.terrazzo()), cellFloor: lit(lib.concrete(0x8f8d88)), stone: lit(lib.concrete(0x9b958b)), ceiling: lit(new T.MeshStandardMaterial({color: 0xf1f1ee, roughness: .9})),
      wall: lit(lib.plaster(0xe8e6e1)), concrete: lit(lib.concrete(0xb3b0a8)), cellWall: lit(lib.plaster(0xe4dccb)), panel: lib.concrete(0x9c9a92),
      brick: lib.brick(), cap: lib.concrete(0x8a877f), fence: lib.metal(0x2f3a33, .6), steel: lib.metal(0x8c9399, .45), cellDoor: lib.paint(0x55614e, .5), wood: lib.wood(0x5a3b26, .6),
      gate: lib.metal(0x3b4046, .5), bars: lib.metal(0x2b2e31, .5), alu: lib.metal(0x5b6066, .35), dark: lib.polymer(0x232528), desk: lib.wood(0x6b4b33, .6), roof: lib.roof(),
      glass: new T.MeshPhysicalMaterial({color: 0xbfd3dc, transparent: true, opacity: .22, roughness: .04, metalness: .1, side: T.DoubleSide, depthWrite: false}),
      light: new T.MeshStandardMaterial({color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.6}),
      mattress: new T.MeshStandardMaterial({color: 0x2f4f7a, roughness: .6}), bed: lib.metal(0x6c7a6a, .5), sheet: lib.fabric(0xd9d4c8), ceramic: lib.ceramic(), chair: lib.polymer(0x2d5d8a),
      drain: new T.MeshStandardMaterial({color: 0x2a2b2c, roughness: .7, metalness: .6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}),
      winGlass: new T.MeshStandardMaterial({color: 0x26313a, roughness: .15, metalness: .3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})
    };
    function box(parent, w, h, d, x, y, z, mat, ry = 0) {const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);m.position.set(x, y, z);if (ry) m.rotation.y = ry;lib.boxUV(m);m.castShadow = m.receiveShadow = true;parent.add(m);return m;}
    function texture(w, h, draw) {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return t;}
    // A flat sign (PlaneGeometry faces +z; ry turns it), lit a little so it reads indoors.
    function sign(parent, w, h, x, y, z, ry, draw, {glow = .3, alpha = false} = {}) {
      const px = 512, t = texture(px, Math.max(32, Math.round(px * h / w)), draw);
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: glow, roughness: .5, alphaTest: alpha ? .5 : 0, transparent: false}));
      m.position.set(x, y, z);m.rotation.y = ry;parent.add(m);return m;
    }
    const text = (bg, lines) => (c, w, h) => {if (bg) {c.fillStyle = bg;c.fillRect(0, 0, w, h);} else c.clearRect(0, 0, w, h);c.textAlign = 'center';c.textBaseline = 'middle';for (const [t, size, col, y] of lines) {c.fillStyle = col;c.font = `bold ${Math.round(size * h)}px Arial, sans-serif`;c.fillText(t, w / 2, y * h);}};

    // ---------- A room frame in a notch: a along the front, b into the building, y up from the floor ----------
    function frameFor(B, H) {
      const F = B.frame, o = F.o, u = F.u, doorL = B.at(B.door, -.8), doorW = W2(...doorL);
      const K = B.patch && B.District ? world.heightWorld(doorW.x, doorW.z) - B.District.height(B.patch, doorL[0], doorL[1]) : null;
      const floorY = K !== null ? K + B.floorRel : world.heightWorld(doorW.x, doorW.z) + .05, rot = Math.atan2(-u[1], u[0]);
      const mk = name => {const g = new T.Group();g.name = name;g.position.set(o[0], floorY, o[1]);g.rotation.y = rot;local.add(g);return g;};
      const toW = (a, b) => W2(...B.at(a, b));
      const ab = (x, z) => {const l = world.toLocal(x, z), dx = l.x - o[0], ds = l.s - o[1];return {a: dx * u[0] + ds * u[1], b: -dx * u[1] + ds * u[0]};};
      const rect = (a0, a1, b0, b1, minY, maxY) => ({points: [toW(a0, b0), toW(a1, b0), toW(a1, b1), toW(a0, b1)], minY: floorY + minY, maxY: floorY + maxY, kind: 'police'});
      const fr = {B, W: F.W, D: F.D, H, floorY, ext: mk(B.name), inn: mk(B.name + ' (inside)'), toW, ab, rect, rooms: []};
      fr.centre = toW(F.W / 2, F.D / 2);frames.push(fr);return fr;
    }
    const wallA = (fr, g, b, a0, a1, t, mat, h = fr.H) => {if (a1 - a0 < .01) return;box(g, a1 - a0, h, t, (a0 + a1) / 2, h / 2, b, mat);obstacles.push(fr.rect(a0, a1, b - t / 2, b + t / 2, -.2, h));};
    const wallB = (fr, g, a, b0, b1, t, mat, h = fr.H) => {if (b1 - b0 < .01) return;box(g, t, h, b1 - b0, a, h / 2, (b0 + b1) / 2, mat);obstacles.push(fr.rect(a - t / 2, a + t / 2, b0, b1, -.2, h));};
    // A wall with doorways ([centre, width] along it) and a lintel over each from `top` up.
    function wallDoors(fr, g, along, at, s0, s1, openings, t, mat, top = 2.12) {
      let x = s0;
      for (const [c, w] of openings.slice().sort((p, q) => p[0] - q[0])) {
        if (along === 'a') wallA(fr, g, at, x, c - w / 2, t, mat);else wallB(fr, g, at, x, c - w / 2, t, mat);
        const h = fr.H - top;if (h > .01) {if (along === 'a') box(g, w, h, t, c, top + h / 2, at, mat);else box(g, t, h, w, at, top + h / 2, c, mat);}
        x = c + w / 2;
      }
      if (along === 'a') wallA(fr, g, at, x, s1, t, mat);else wallB(fr, g, at, x, s1, t, mat);
    }
    // A door in a wall: along = the wall's direction, face = the side it opens to (+1 = +b or +a). kind: plain, hatch (a hatch at
    // chest height that opens outward, the glattceller) or window (a barred opening, the prison cells). A game door (□, online).
    function door(fr, g, {id, name, a, b, along, face, w = .9, h = 2.05, kind = 'plain', mat}) {
      const df = new T.Group();df.position.set(a, 0, b);df.rotation.y = along === 'a' ? (face > 0 ? 0 : Math.PI) : (face > 0 ? Math.PI / 2 : -Math.PI / 2);g.add(df);
      const hinge = new T.Group();hinge.position.set(-w / 2, 0, 0);hinge.userData.noMerge = true;df.add(hinge);
      const lg = new T.Group();lg.position.set(w / 2, 0, .03);hinge.add(lg);
      const piece = (pw, ph, x, y) => {const m = new T.Mesh(new T.BoxGeometry(pw, ph, .06), mat);m.position.set(x, y, 0);m.castShadow = m.receiveShadow = true;lg.add(m);};
      const hole = kind === 'hatch' ? {x: .15, y0: 1.2, y1: 1.42} : kind === 'window' ? {x: .14, y0: 1.35, y1: 1.75} : null;
      if (hole) {
        const side = w / 2 - hole.x;piece(side, h, -(w / 2 + hole.x) / 2, h / 2);piece(side, h, (w / 2 + hole.x) / 2, h / 2);
        piece(hole.x * 2, hole.y0, 0, hole.y0 / 2);piece(hole.x * 2, h - hole.y1, 0, (h + hole.y1) / 2);
        if (kind === 'window') for (const x of [-.07, 0, .07]) {const r = new T.Mesh(new T.BoxGeometry(.018, hole.y1 - hole.y0, .018), M.bars);r.position.set(x, (hole.y0 + hole.y1) / 2, 0);lg.add(r);}
      } else piece(w, h, 0, h / 2);
      for (const z of [.05, -.05]) {const k = new T.Mesh(new T.BoxGeometry(.13, .025, .03), M.bars);k.position.set(w / 2 - .13, 1.0, z);lg.add(k);}
      lib.mergeStatic(lg);
      // The game door's board: invisible, for the collision and the look target.
      const leaf = new T.Mesh(new T.BoxGeometry(w - .02, h, .06), hitM);leaf.position.set(w / 2, h / 2, .03);leaf.userData.doorId = id;hinge.add(leaf);hitboxes.push(leaf);
      const d = {id, name, hinge, leaf, open: false, openAngle: -1.45, motion: 'swing'};doors.push(d);
      if (kind === 'hatch') {
        const pivot = new T.Group();pivot.position.set(w / 2, hole.y0, .065);hinge.add(pivot);
        const flap = new T.Mesh(new T.BoxGeometry(hole.x * 2 + .04, hole.y1 - hole.y0 + .04, .02), mat);flap.position.set(0, (hole.y1 - hole.y0) / 2, .01);flap.castShadow = true;pivot.add(flap);
        const H = {pivot, open: false, t: 0, id};hatches.push(H);
        const hit = new T.Mesh(new T.BoxGeometry(hole.x * 2 + .1, hole.y1 - hole.y0 + .12, .06), hitM);hit.position.set(w / 2, (hole.y0 + hole.y1) / 2, .1);hit.userData.policeHatch = H;hinge.add(hit);hitboxes.push(hit);
      }
      return d;
    }
    // Sliding glass doors that open by themselves (as in the shops), and the slab or ramp from the door down to the street.
    function glassFront(fr, g, a0, a1, aDoor, storeTop) {
      box(g, a1 - a0, .12, .14, (a0 + a1) / 2, .06, 0, M.alu);box(g, a1 - a0, .1, .14, (a0 + a1) / 2, 2.9, 0, M.alu);
      for (const x of [a0 + .05, aDoor - .95, aDoor + .95, a1 - .05]) box(g, .1, 2.95, .14, x, 1.47, 0, M.alu);
      for (const [p, q] of [[a0, aDoor - .95], [aDoor + .95, a1]]) {if (q - p < .2) continue;const m = new T.Mesh(new T.PlaneGeometry(q - p, 2.75), M.glass);m.position.set((p + q) / 2, 1.5, 0);g.add(m);}
      const leaves = [-1, 1].map(sd => {const d = new T.Group();d.position.set(aDoor + sd * .475, 0, .03);d.userData.noMerge = true;g.add(d);const pane = new T.Mesh(new T.PlaneGeometry(.95, 2.35), M.glass);pane.position.y = 1.2;d.add(pane);box(d, .95, .06, .05, 0, 2.37, 0, M.alu);box(d, .05, 2.35, .05, -sd * .45, 1.18, 0, M.alu);return {g: d, sd};});
      obstacles.push(fr.rect(a0, aDoor - .95, -.08, .08, -.5, storeTop), fr.rect(aDoor + .95, a1, -.08, .08, -.5, storeTop));
      sliders.push({fr, aDoor, leaves, open: 0});
    }
    function entrance(fr, g, aDoor, half, name) {
      const floorY = fr.floorY, step = a => {const e = fr.toW(aDoor, -a);return floorY - world.heightWorld(e.x, e.z);};
      let rl = 1.2;for (let it = 0; it < 3; it++) rl = Math.max(1.2, Math.abs(step(rl)) / .22);
      const rise = step(rl);
      if (rise > .06) {
        const pos = new Float32Array([aDoor - half, 0, 0, aDoor + half, 0, 0, aDoor + half, -rise, -rl, aDoor - half, -rise, -rl, aDoor - half, -rise - .4, 0, aDoor + half, -rise - .4, 0]);
        const rg = new T.BufferGeometry();rg.setAttribute('position', new T.BufferAttribute(pos, 3));rg.setIndex([0, 2, 1, 0, 3, 2, 0, 4, 3, 1, 2, 5]);rg.computeVertexNormals();
        const ramp = new T.Mesh(rg, lib.concrete(0x9c9a94));ramp.material.side = T.DoubleSide;ramp.receiveShadow = true;g.add(ramp);
      }
      // The slab falls by `rise` from the door (b = 0) to the street (b = -rl), so its far edge meets the ground (walk floors only
      // join within 5 cm). Issue #158: the slope pointed out of the building, so the far edge was 2 × rise above the street, an
      // invisible wall in front of the door.
      const o = fr.toW(aDoor, 0), q = fr.toW(aDoor, 1), grad = rise / rl;
      floors.push({name: `${name} entrance`, points: [fr.toW(aDoor - half, 0), fr.toW(aDoor + half, 0), fr.toW(aDoor + half, -rl), fr.toW(aDoor - half, -rl)], y: floorY, slope: {x: (q.x - o.x) * grad, z: (q.z - o.z) * grad, origin: o}, surfaceKind: 'stone', ceilingHeight: Infinity});
    }
    // The wall above the notch in the building's own look, and its roof.
    function facadeAndRoof(fr, storeTop) {
      const B = fr.B, L = B.local;
      if (world.facadeFill) world.facadeFill(B.bldg, L.P0, L.P1, fr.floorY + storeTop);
      if (Number.isFinite(B.bldg.top) && B.bldg.top - fr.floorY > storeTop + .3) box(fr.ext, fr.W, .06, fr.D, fr.W / 2, B.bldg.top - fr.floorY - .03, fr.D / 2, M.roof);
    }
    const ceilingLight = (g, a, b, w = 1.2, d = .3, H) => box(g, w, .04, d, a, H - .02, b, M.light);
    const keep = o => o.material === hitM;
    function talker(fr, g, {kind, slot, name, shirt, a, b, rest, lines}) {
      if (!avatars) return null;
      const av = avatars.avatar(slot, name, shirt);av.group.position.set(a, 0, b);av.group.rotation.y = rest;av.group.userData.noMerge = true;g.add(av.group);av.pose({stance: 'stand'});
      const k = {kind, av, fr, g, a, b, rest, lines, i: 0};talkers.push(k);return k;
    }

    // ---------- Oslo politihus: reception and the arrest with the glattceller ----------
    let queueNo = 36;
    if (DATA.station.frame) {
      const fr = frameFor(DATA.station, 3.2), {W, D, H, ext, inn} = fr, aD = DATA.station.door, storeTop = 3.62, aC = 14;
      box(ext, aC, .04, D, aC / 2, -.02, D / 2, M.terrazzo);box(ext, W - aC, .04, D, (aC + W) / 2, -.02, D / 2, M.cellFloor);
      box(ext, W, .04, D, W / 2, H + .02, D / 2, M.ceiling);
      // Linings (2 cm inside the notch's own walls, so nothing is coplanar), the back wall, the partition with the steel door.
      wallB(fr, ext, .07, .06, D - .12, .1, M.wall);wallB(fr, ext, W - .07, .1, D - .12, .1, M.concrete);
      wallA(fr, ext, D - .07, .02, aC - .06, .1, M.wall);wallA(fr, ext, D - .07, aC + .06, W - .02, .1, M.concrete);
      wallDoors(fr, ext, 'b', aC, .12, D - .02, [[4.95, .94]], .12, M.wall);
      // It opens into the reception (issue #158): open into the corridor, it and an open door of cell 1 left 5 cm to pass.
      door(fr, ext, {id: 'politi-arrest', name: 'Steel door to the cells', a: aC, b: 4.95, along: 'b', face: -1, kind: 'plain', mat: M.steel});
      sign(ext, .9, .22, aC - .075, 2.42, 4.95, -Math.PI / 2, text('#1b2a49', [['ARRESTEN', .62, '#ffffff', .55]]), {glow: .5});
      // The front: glass with sliding doors for the reception, a concrete wall for the cells; the POLITI sign over the door.
      glassFront(fr, ext, 0, aC, aD, storeTop);
      box(ext, W - aC, storeTop + .4, .24, (aC + W) / 2, (storeTop - .4) / 2, 0, M.panel);obstacles.push(fr.rect(aC, W, -.12, .12, -.5, storeTop));
      {
        const t = texture(1024, 160, text('#0b1f3a', [['POLITI', .72, '#ffffff', .55]])), dm = M.dark;
        const s = new T.Mesh(new T.BoxGeometry(aC, .62, .12), [dm, dm, dm, dm, dm, new T.MeshStandardMaterial({map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1, roughness: .5})]);
        s.position.set(aC / 2, 3.3, -.06);s.castShadow = true;ext.add(s);// the -z face (index 5) faces the street, as the shops' signs
      }
      sign(ext, 10, 1.1, aD, 6.6, -.09, Math.PI, text(null, [['POLITIHUSET', .8, '#e9edf2', .55]]), {glow: .5, alpha: true});
      // The door is in the lane behind the low front buildings: a lit POLITI pylon on the footway at each of the two gaps that lead
      // down to it (issue #158).
      {
        const t = texture(512, 820, text('#0b1f3a', [['POLITI', .13, '#ffffff', .2], ['Oslo politihus', .06, '#c9d3e0', .42], ['Publikumsmottak', .06, '#c9d3e0', .52], ['↓', .3, '#ffffff', .78]]));
        const face = new T.MeshStandardMaterial({map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .9, roughness: .5}), dm = M.dark;
        for (const [a, b] of [[-9.3, -44], [34.3, -45]]) {
          const y = gAt(...DATA.station.at(a, b)) - fr.floorY;
          box(ext, .16, 1.6, .16, a, y + .55, b, M.alu);
          const s = new T.Mesh(new T.BoxGeometry(1.0, 1.6, .1), [dm, dm, dm, dm, face, face]);s.position.set(a, y + 2.1, b);s.castShadow = true;ext.add(s);
          obstacles.push(fr.rect(a - .5, a + .5, b - .1, b + .1, y - .4, y + 2.9));
        }
      }
      sign(ext, .9, .5, aD - 2.2, 1.55, -.012, Math.PI, text('rgba(255,255,255,.92)', [['Oslo politihus', .2, '#111', .22], ['Grønlandsleiret 44', .14, '#111', .45], ['Publikumsmottak', .14, '#111', .66], ['Åpent 08–15', .14, '#111', .85]]), {glow: .2});
      // Reception: the desk with a glass screen and the officer, partitions behind it, the POLITIET sign, chairs, the ticket machine.
      box(ext, 6, 1.1, .7, 7, .55, 6.55, M.desk);box(ext, 6.1, .05, .8, 7, 1.12, 6.55, M.dark);
      {const s = new T.Mesh(new T.PlaneGeometry(5.6, .7), M.glass);s.position.set(7, 1.5, 6.62);ext.add(s);}
      obstacles.push({...fr.rect(4, 10, 6.2, 6.9, -.2, 1.2), noJump: true});// the glass screen on the desk: no jumping over (issue #144)
      wallB(fr, ext, 4, 6.9, D - .12, .12, M.wall);wallB(fr, ext, 10, 6.9, D - .12, .12, M.wall);
      box(ext, .4, .25, .05, 6.2, 1.28, 6.75, new T.MeshStandardMaterial({color: 0x0b1a10, emissive: 0x1c3a5a, emissiveIntensity: .9}));
      sign(ext, 3.2, .8, 7, 2.45, D - .125, Math.PI, text('#0b1f3a', [['POLITIET', .42, '#ffffff', .4], ['Oslo politidistrikt · Publikumsmottak', .15, '#c9d3e0', .78]]), {glow: .45});
      {const hit = new T.Mesh(new T.BoxGeometry(6, .9, 1.0), hitM);hit.position.set(7, 1.25, 6.4);hit.userData.policeTalk = 'officer';ext.add(hit);hitboxes.push(hit);}
      for (let k = 0; k < 5; k++) {const a = .7 + k * .62;box(ext, .5, .06, .48, a, .45, 8.9, M.chair);box(ext, .5, .45, .06, a, .7, 9.15, M.chair);box(ext, .05, .45, .05, a, .22, 8.9, M.alu);}
      obstacles.push(fr.rect(.4, 3.6, 8.6, 9.3, -.2, .9));
      box(ext, .45, 1.35, .32, 12.6, .675, .9, lib.metal(0xd0d3d6, .4));box(ext, .3, .12, .02, 12.6, 1.2, 1.065, new T.MeshStandardMaterial({color: 0x220606, emissive: 0xff2a1a, emissiveIntensity: 1.2}));
      sign(ext, .4, .14, 12.6, 1.0, 1.07, 0, text('#ffffff', [['TREKK KØLAPP', .55, '#b71c1c', .55]]), {glow: .3});
      obstacles.push(fr.rect(12.35, 12.85, .72, 1.08, -.2, 1.4));
      {const hit = new T.Mesh(new T.BoxGeometry(.6, 1.4, .6), hitM);hit.position.set(12.6, .8, 1.0);hit.userData.policeTalk = 'queue';ext.add(hit);hitboxes.push(hit);}
      for (const [a, b] of [[2.5, 2.5], [7, 2.5], [11.5, 2.5], [2.5, 6], [11.5, 6], [7, 8.4]]) ceilingLight(ext, a, b, 1.2, .3, H);
      fr.rooms.push({a0: 0, a1: aC, b0: 0, b1: D});
      talker(fr, ext, {kind: 'officer', slot: 4, name: 'Politibetjent', shirt: 0x1b2a49, a: 7, b: 7.7, rest: 0, lines: [
        ['Hei! Velkommen til Oslo politihus. Hva kan jeg hjelpe deg med?', 'Hi! Welcome to Oslo police station. How can I help you?'],
        ['Pass eller ID? Trekk kølapp ved døra, så tar vi deg etterpå.', 'Passport or ID? Take a queue ticket by the door and we will call you.'],
        ['Glattcellene er bak ståldøra der borte. Se deg om, men ikke bli for lenge!', 'The holding cells are behind that steel door. Have a look, but do not stay too long!'],
        ['Botsen – Oslo fengsel – ligger rett bak oss. Porten er i muren.', 'Botsen, Oslo prison, is right behind us. The gate is in the wall.'],
        ['Politibilene står ute. Blålys og sirene på L3 / H – bare på øvelse!', 'The police cars are outside. Blue lights and siren on L3 / H – practice only!']]});
      // The arrest: a corridor (b 4.075–5.825) with the glattceller on both sides, each with a steel door and a hatch.
      const aS = aC + .06, span = W - .12 - aS, nC = Math.max(1, Math.floor(span / 2.4)), cw = span / nC, cs = [];
      for (let k = 0; k < nC; k++) cs.push(aS + (k + .5) * cw);
      wallDoors(fr, inn, 'a', 4.0, aS, W - .12, cs.map(c => [c, .94]), .15, M.concrete);wallDoors(fr, inn, 'a', 5.9, aS, W - .12, cs.map(c => [c, .94]), .15, M.concrete);
      for (let k = 1; k < nC; k++) {const a = aS + k * cw;wallB(fr, inn, a, .12, 3.925, .12, M.concrete);wallB(fr, inn, a, 5.975, D - .12, .12, M.concrete);}
      cs.forEach((c, k) => {
        for (const [row, bw, face, b0, b1] of [[0, 4.0, 1, .12, 3.925], [1, 5.9, -1, 5.975, D - .12]]) {
          const no = row * nC + k + 1;
          door(fr, inn, {id: `politi-celle-${no}`, name: `Glattcelle ${no}`, a: c, b: bw, along: 'a', face, kind: 'hatch', mat: M.steel});
          // A thin mattress on the floor against the side wall, a drain in the middle, a light and nothing else.
          const bm = (b0 + b1) / 2;box(inn, .7, .07, 1.95, c - cw / 2 + .5, .035, bm, M.mattress);
          const dr = new T.Mesh(new T.CircleGeometry(.09, 16), M.drain);dr.rotation.x = -Math.PI / 2;dr.position.set(c + .35, .002, bm);inn.add(dr);
          box(inn, .5, .04, .25, c, H - .02, bm, M.light);
          fr.rooms.push({a0: c - cw / 2, a1: c + cw / 2, b0, b1});
        }
      });
      for (let k = 0; k < 3; k++) ceilingLight(inn, aS + span * (k + .5) / 3, 4.95, 1.0, .25, H);
      fr.rooms.push({a0: aC, a1: W, b0: 4.0, b1: 5.9});
      floors.push({name: 'Oslo politihus', points: [fr.toW(0, 0), fr.toW(W, 0), fr.toW(W, D), fr.toW(0, D)], y: fr.floorY, ceilingHeight: H, surfaceKind: 'tile'});
      entrance(fr, ext, aD, 1.1, 'Oslo politihus');
      facadeAndRoof(fr, storeTop);
      lib.mergeStatic(ext, keep);lib.mergeStatic(inn, keep);
      fr.anchor = DATA.station.at(aD + 4, -7);fr.door = DATA.station.at(aD, -1.5);
    }

    // ---------- Oslo fengsel: cell wing A (the yard door, a guard, the corridor and the cells) ----------
    if (DATA.prison.frame) {
      const fr = frameFor(DATA.prison, 3.4), {W, D, H, ext, inn} = fr, aD = DATA.prison.door, storeTop = 4.0, wd = 1.1;
      box(ext, W, .04, D, W / 2, -.02, D / 2, M.stone);box(ext, W, .04, D, W / 2, H + .02, D / 2, M.ceiling);
      wallB(fr, ext, .07, .2, D - .02, .1, M.cellWall);wallB(fr, ext, W - .07, .2, D - .02, .1, M.cellWall);wallA(fr, ext, D - .07, .12, W - .12, .1, M.cellWall);
      // The front wall to the yard (40 cm) with the door, in the colour the building has above it.
      const fh = storeTop + .5, fy = (storeTop - .5) / 2, fm = fr.B.bldg.city && fr.B.bldg.city.tint ? lib.plaster(fr.B.bldg.city.tint.getHex()) : M.brick;
      box(ext, aD - wd / 2, fh, .4, (aD - wd / 2) / 2, fy, 0, fm);box(ext, W - aD - wd / 2, fh, .4, (W + aD + wd / 2) / 2, fy, 0, fm);
      box(ext, wd, storeTop - 2.4, .4, aD, (storeTop + 2.4) / 2, 0, fm);
      obstacles.push(fr.rect(0, aD - wd / 2, -.2, .2, -.5, storeTop), fr.rect(aD + wd / 2, W, -.2, .2, -.5, storeTop));
      door(fr, ext, {id: 'fengsel-dor', name: 'Door to cell wing A', a: aD, b: 0, along: 'a', face: 1, w: 1.0, h: 2.3, kind: 'window', mat: M.wood});
      sign(ext, 1.3, .36, aD, 2.78, -.215, Math.PI, text('#1d2b22', [['OSLO FENGSEL', .38, '#f2efe6', .38], ['Avdeling A', .26, '#d7d2c2', .76]]), {glow: .3});
      // The entry hall, the guard and the sign.
      talker(fr, ext, {kind: 'guard', slot: 6, name: 'Fengselsbetjent', shirt: 0x2c3a2f, a: 2.3, b: 2.7, rest: .5, lines: [
        ['Velkommen til Botsen – Oslo fengsel, bygd i 1851.', 'Welcome to Botsen – Oslo prison, built in 1851.'],
        ['Cellene er åpne for omvisning i dag. Ikke lås deg inne!', 'The cells are open for a tour today. Do not lock yourself in!'],
        ['Luftegården er stengt for i dag.', 'The exercise yard is closed for today.'],
        ['Arresten er på politihuset ved siden av. Hit kommer de etterpå.', 'The holding cells are at the police station next door. People come here afterwards.']]});
      obstacles.push(fr.rect(2.05, 2.55, 2.45, 2.95, 0, 1.8));
      {const hit = new T.Mesh(new T.BoxGeometry(.7, 1.8, .7), hitM);hit.position.set(2.3, .9, 2.7);hit.userData.policeTalk = 'guard';ext.add(hit);hitboxes.push(hit);}
      ceilingLight(ext, 1.6, 2.2, 1.0, .3, H);
      fr.rooms.push({a0: 0, a1: 3.0, b0: 0, b1: 4.0});
      // Corridor b 4.075–5.825; cells in front (toward the yard, with a barred window) and behind.
      const aS = 3.06, span = W - .12 - aS, n1 = Math.max(1, Math.floor(span / 3.0)), w1 = span / n1, span2 = W - .24, n2 = Math.max(1, Math.floor(span2 / 3.0)), w2 = span2 / n2;
      const c1 = [], c2 = [];for (let k = 0; k < n1; k++) c1.push(aS + (k + .5) * w1);for (let k = 0; k < n2; k++) c2.push(.12 + (k + .5) * w2);
      wallB(fr, inn, 3.0, .2, 3.925, .12, M.cellWall);
      sign(inn, .8, .3, 2.925, 2.2, 2.0, -Math.PI / 2, text('#1d2b22', [['AVDELING A', .5, '#f2efe6', .55]]), {glow: .35});
      wallDoors(fr, inn, 'a', 4.0, 2.94, W - .12, c1.map(c => [c, .94]), .15, M.cellWall);wallDoors(fr, inn, 'a', 5.9, .12, W - .12, c2.map(c => [c, .94]), .15, M.cellWall);
      for (let k = 1; k < n1; k++) wallB(fr, inn, aS + k * w1, .2, 3.925, .12, M.cellWall);
      for (let k = 1; k < n2; k++) wallB(fr, inn, .12 + k * w2, 5.975, D - .12, .12, M.cellWall);
      let no = 0;
      const cell = (c, cw, bDoor, bFar, face, window) => {
        no++;door(fr, inn, {id: `fengsel-celle-${no}`, name: `Cell ${no}`, a: c, b: bDoor, along: 'a', face, kind: 'window', mat: M.cellDoor});
        const sg = Math.sign(bFar - bDoor), dep = Math.abs(bFar - bDoor) - .075, at = x => bDoor + sg * (.075 + x), aL = c - cw / 2 + .06, aR = c + cw / 2 - .06;
        // Bed against the left wall at the far end, a table and chair at the far wall, the toilet and sink by the door.
        box(inn, .85, .38, 1.95, aL + .43, .19, at(dep - 1.0), M.bed);box(inn, .8, .1, 1.9, aL + .43, .43, at(dep - 1.0), M.sheet);
        obstacles.push(fr.rect(aL, aL + .86, Math.min(at(dep - 1.98), at(dep - .02)), Math.max(at(dep - 1.98), at(dep - .02)), -.2, .5));
        box(inn, .9, .05, .55, aR - .45, .74, at(dep - .3), M.desk);box(inn, .06, .72, .5, aR - .85, .36, at(dep - .3), M.desk);box(inn, .06, .72, .5, aR - .05, .36, at(dep - .3), M.desk);
        obstacles.push(fr.rect(aR - .9, aR, Math.min(at(dep - .58), at(dep - .02)), Math.max(at(dep - .58), at(dep - .02)), -.2, .8));
        box(inn, .4, .05, .4, aR - .45, .45, at(dep - .9), M.desk);box(inn, .4, .45, .05, aR - .45, .7, at(dep - .9) - sg * .19, M.desk);
        box(inn, .4, .42, .5, aR - .22, .21, at(.45), M.ceramic);box(inn, .42, .14, .34, aR - .22, .85, at(1.0), M.ceramic);
        obstacles.push(fr.rect(aR - .44, aR, Math.min(at(.2), at(.7)), Math.max(at(.2), at(.7)), -.2, .5));
        box(inn, .5, .04, .25, c, H - .02, at(dep / 2), M.light);
        if (window) {
          // A barred window high in the front wall, seen from the cell and from the yard.
          for (const [bz, ry] of [[.2 + .025, 0], [-.2 - .025, Math.PI]]) {const m = new T.Mesh(new T.PlaneGeometry(.8, .9), M.winGlass);m.position.set(c, 2.45, bz);m.rotation.y = ry;(bz > 0 ? inn : ext).add(m);}
          for (let i = 0; i < 5; i++) {box(inn, .02, .9, .02, c - .32 + i * .16, 2.45, .24, M.bars);box(ext, .02, .9, .02, c - .32 + i * .16, 2.45, -.24, M.bars);}
        }
        fr.rooms.push({a0: c - cw / 2, a1: c + cw / 2, b0: Math.min(bDoor, bFar), b1: Math.max(bDoor, bFar)});
      };
      c1.forEach(c => cell(c, w1, 4.0, .2, 1, true));c2.forEach(c => cell(c, w2, 5.9, D - .12, -1, false));
      for (let k = 0; k < 4; k++) ceilingLight(inn, .3 + (W - .6) * (k + .5) / 4, 4.95, 1.0, .25, H);
      fr.rooms.push({a0: 0, a1: W, b0: 4.0, b1: 5.9});
      floors.push({name: 'Oslo fengsel, avdeling A', points: [fr.toW(0, 0), fr.toW(W, 0), fr.toW(W, D), fr.toW(0, D)], y: fr.floorY, ceilingHeight: H, surfaceKind: 'stone'});
      entrance(fr, ext, aD, .9, 'Oslo fengsel');
      facadeAndRoof(fr, storeTop);
      lib.mergeStatic(ext, keep);lib.mergeStatic(inn, keep);
    }

    // ---------- The walls round the prison, the two gates and the sign ----------
    const wallGroup = new T.Group();wallGroup.name = 'Oslo fengsel walls';local.add(wallGroup);
    const plan = wallPlan(), ctr = DATA.centre;
    for (const q of plan.pieces) {
      const m = [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2], gs = [gAt(...q.a), gAt(...m), gAt(...q.b)], base = Math.min(...gs) - .4, top = Math.max(...gs) + q.h, len = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), ry = Math.atan2(-q.u[1], q.u[0]);
      box(wallGroup, len, top - base, q.th, m[0], (top + base) / 2, m[1], q.kind === 'fence' ? M.fence : M.brick, ry);
      if (q.kind !== 'fence') box(wallGroup, len, .14, q.th + .14, m[0], top + .07, m[1], M.cap, ry);
      const nx = -q.u[1] * q.th / 2, ns = q.u[0] * q.th / 2;
      obstacles.push({points: [W2(q.a[0] + nx, q.a[1] + ns), W2(q.b[0] + nx, q.b[1] + ns), W2(q.b[0] - nx, q.b[1] - ns), W2(q.a[0] - nx, q.a[1] - ns)], minY: base - .5, maxY: top + .14, kind: 'wall'});
    }
    for (const p of plan.piers) {
      const g = gAt(...p.p), s = p.th + .3;box(wallGroup, s, p.h + .65, s, p.p[0], g - .4 + (p.h + .65) / 2, p.p[1], M.brick);
      const h = s / 2;obstacles.push({points: [W2(p.p[0] - h, p.p[1] - h), W2(p.p[0] + h, p.p[1] - h), W2(p.p[0] + h, p.p[1] + h), W2(p.p[0] - h, p.p[1] + h)], minY: g - .9, maxY: g + p.h + .25, kind: 'wall'});
    }
    for (const G of plan.gates) {
      // Local x along the wall, local z out of the prison; the steel leaf slides along the inside of the wall.
      let u = G.u;const out = [G.c[0] - ctr[0], G.c[1] - ctr[1]];if (-u[1] * out[0] + u[0] * out[1] < 0) u = [-u[0], -u[1]];
      const gf = new T.Group(), y = gAt(...G.c);gf.position.set(G.c[0], y, G.c[1]);gf.rotation.y = Math.atan2(-u[1], u[0]);wallGroup.add(gf);
      const hinge = new T.Group();hinge.position.set(0, 0, -(G.th / 2 + .32));hinge.userData.noMerge = true;gf.add(hinge);
      const leaf = new T.Mesh(new T.BoxGeometry(G.w + .1, 4.0, .1), M.gate);leaf.position.set(0, 2.0, 0);leaf.castShadow = leaf.receiveShadow = true;leaf.userData.doorId = G.id;hinge.add(leaf);hitboxes.push(leaf);
      for (let i = 0; i < 8; i++) {const r = new T.Mesh(new T.BoxGeometry(.06, 3.8, .04), M.bars);r.position.set(-G.w / 2 + (i + .5) * (G.w + .1) / 8, 2.0, .07);hinge.add(r);}
      doors.push({id: G.id, name: G.name, hinge, leaf, open: false, motion: 'slide', closedX: 0, travel: G.w + .35});
      if (G.wall === 0) {
        sign(gf, 2.4, .62, G.w / 2 + 1.9, 2.7, G.th / 2 + .02, 0, text('#1d2b22', [['OSLO FENGSEL', .42, '#f2efe6', .4], ['Kriminalomsorgen · Åkebergveien 11', .17, '#d7d2c2', .78]]), {glow: .25});
        box(gf, .18, .18, .25, G.w / 2 + .5, 4.4, G.th / 2 + .1, M.bars);
      }
    }
    lib.mergeStatic(wallGroup, keep);
    // The two gates and the wing door are in the walls' and buildings' groups; everything stays put, so the world matrices are set once.
    group.updateMatrixWorld(true);

    // ---------- Prompts, map points, lamps ----------
    function talk(kind) {
      if (kind === 'queue') {queueNo++;return {notice: `Kølapp nr. ${queueNo} · your queue number is ${queueNo}. ${queueNo % 3 ? 'You are next.' : 'Two people are in front of you.'}`, sound: 'ding'};}
      const k = talkers.find(x => x.kind === kind);if (!k) return null;
      const [no, en] = k.lines[k.i++ % k.lines.length];k.av.say(no);return {notice: `${kind === 'officer' ? 'Officer' : 'Prison officer'}: “${no}” (${en})`};
    }
    function prompt(o) {
      const u = o && o.userData;if (!u) return null;
      if (u.policeHatch) {const H = u.policeHatch;return {text: `□ ${H.open ? 'Close' : 'Open'} the hatch`, act: () => {H.open = !H.open;return {sound: 'locked'};}};}
      if (u.policeTalk === 'officer') return {text: '□ Talk to the officer at the desk', act: () => talk('officer')};
      if (u.policeTalk === 'guard') return {text: '□ Talk to the prison officer', act: () => talk('guard')};
      if (u.policeTalk === 'queue') return {text: '□ Take a queue ticket', act: () => talk('queue')};
      return null;
    }
    const poi = () => {
      const out = [];
      if (DATA.station.frame) {const p = DATA.station.at(DATA.station.door, 4);out.push({x: p[0], s: p[1], color: '#0b3d91', label: 'Oslo politihus · Grønlandsleiret 44 (police station, glattceller)', glyph: '🚔'});}
      out.push({x: ctr[0], s: ctr[1], color: '#5d4037', label: 'Oslo fengsel · Botsen, Åkebergveien 11 (prison; the gate is behind the police station)', glyph: '🔒'});
      return out;
    };
    function frameAt(x, z, feet) {for (const fr of frames) {const p = fr.ab(x, z);if (p.a > 0 && p.a < fr.W && p.b > 0 && p.b < fr.D && Math.abs(feet - fr.floorY) < 1.6) return {fr, p};}return null;}
    const inside = (x, z, feet) => !!frameAt(x, z, feet);
    function lampAt(x, z, feet) {
      const f = frameAt(x, z, feet);if (!f) return null;const {fr, p} = f;
      const r = fr.rooms.find(q => p.a >= q.a0 && p.a <= q.a1 && p.b >= q.b0 && p.b <= q.b1) || {a0: p.a - 2, a1: p.a + 2, b0: p.b - 2, b1: p.b + 2};
      const w = fr.toW((r.a0 + r.a1) / 2, (r.b0 + r.b1) / 2);return {x: w.x, y: fr.floorY + fr.H - .35, z: w.z, power: 4.5, reach: Math.max(7, Math.hypot(r.a1 - r.a0, r.b1 - r.b0) + 2)};
    }
    function placeName(x, z, feet) {const f = frameAt(x, z, feet);return f ? f.fr.B.name : null;}

    // ---------- Every frame ----------
    function tick(dt, camera, player) {
      const cp = camera.position;
      for (const fr of frames) fr.inn.visible = Math.hypot(cp.x - fr.centre.x, cp.z - fr.centre.z) < 90;
      for (const s of sliders) {
        const l = s.fr.ab(player.x, player.z), want = Math.hypot(l.a - s.aDoor, l.b) < 2.5 && Math.abs(player.feet - s.fr.floorY) < 1.6 ? 1 : 0;
        if (want && !s.open && audio) audio.sfx('shopDoor');
        s.open += (want - s.open) * Math.min(1, dt * 5);if (s.open < 1e-3) s.open = 0;for (const d of s.leaves) d.g.position.x = s.aDoor + d.sd * (.475 + s.open * .9);
      }
      for (const H of hatches) {const want = H.open ? 1 : 0;if (H.t !== want) {H.t = want > H.t ? Math.min(1, H.t + dt * 4) : Math.max(0, H.t - dt * 4);H.pivot.rotation.x = H.t * 1.5;}}
      for (const k of talkers) {
        const c = k.fr.toW(k.a, k.b);if (Math.hypot(cp.x - c.x, cp.z - c.z) > 40) continue;
        const l = k.fr.ab(player.x, player.z), da = l.a - k.a, db = l.b - k.b, close = Math.hypot(da, db) < 8;
        let d = (close ? Math.atan2(-da, -db) : k.rest) - k.rest;d = Math.atan2(Math.sin(d), Math.cos(d));const yaw = k.rest + Math.max(-1.1, Math.min(1.1, d));
        k.av.group.rotation.y += (yaw - k.av.group.rotation.y) * Math.min(1, dt * 3);k.av.pose({stance: 'stand', speed: 0, dt});k.av.update(dt, camera);
      }
      carsTick(camera, player);
    }

    // ---------- Police cars ----------
    let liv = null;
    function livery() {
      if (liv) return liv;
      // The sides: POLITI over two rows of fluorescent-yellow and black fields, on a strip that follows the body's curve
      // (the hatchback's side profile and its pinch toward the top and the ends, game-vehicles.js carParts), 2 cm out.
      const t = texture(1024, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);const cols = 22, cw = w / cols;
        for (let r = 0; r < 2; r++) for (let i = 0; i < cols; i++) {g.fillStyle = (i + r) % 2 ? '#101214' : '#d9f21b';g.fillRect(Math.floor(i * cw), 150 + r * 53, Math.ceil(cw) + 1, 53);}
        g.fillStyle = '#0f1114';g.font = 'bold 118px Arial Black, Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('POLITI', w / 2, 78);
      });
      const mat = new T.MeshStandardMaterial({map: t, alphaTest: .5, roughness: .45, metalness: .1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
      const z0 = -1.75, z1 = 1.75, y0 = .45, y1 = .9, nz = 24, ny = 6, cy = .625, hy = .405, hz = 2.19;
      const strip = s => {
        const pos = [], uv = [], idx = [];
        for (let j = 0; j <= ny; j++) for (let i = 0; i <= nz; i++) {
          const z = z0 + (z1 - z0) * i / nz, y = y0 + (y1 - y0) * j / ny, ey = Math.pow(Math.min(1, Math.abs(y - cy) / hy), 2.5), ez = Math.pow(Math.min(1, Math.abs(z) / hz), 4);
          pos.push(s * (.89 * (1 - .3 * Math.min(1, ey * .8 + ez * .5)) + .02), y, z);uv.push(s > 0 ? 1 - i / nz : i / nz, j / ny);
        }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nz; i++) {const a = j * (nz + 1) + i, b = a + 1, c = a + nz + 1, d = c + 1;if (s > 0) idx.push(a, c, b, b, c, d);else idx.push(a, b, c, b, d, c);}
        const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));geo.setIndex(idx);geo.computeVertexNormals();return geo;
      };
      liv = {mat, sides: [strip(-1), strip(1)], base: new T.BoxGeometry(1.05, .06, .26), dome: new T.BoxGeometry(.4, .085, .2), baseMat: lib.polymer(0x1b1c1f)};
      return liv;
    }
    let PoliceCar = null;
    function makeCars(VH, places, opts = {}) {
      const L = livery();
      if (!PoliceCar) PoliceCar = class extends VH.Car {
        constructor(x, z, yaw, k) {
          super(x, z, yaw, 3);this.name = 'police car';this.police = true;this.blue = 0;this.phase = (k * .37) % 1;
          for (const geo of L.sides) {const m = new T.Mesh(geo, L.mat);this.group.add(m);}
          const base = new T.Mesh(L.base, L.baseMat);base.position.set(0, 1.5, .28);base.castShadow = true;this.group.add(base);
          this.lampA = new T.MeshStandardMaterial({color: 0x1d3fbf, emissive: 0x2a55ff, emissiveIntensity: 0, roughness: .3, metalness: .1});this.lampB = this.lampA.clone();
          for (const [x, m] of [[-.27, this.lampA], [.27, this.lampB]]) {const d = new T.Mesh(L.dome, m);d.position.set(x, 1.5725, .28);this.group.add(d);}
        }
        enter() {super.enter();if (opts.notice) opts.notice('Police car · L3 / H: blue lights, again for the siren, again to switch off', 4);}
        exit() {if (this.blue === 2) this.blue = 1;return super.exit();}// the siren stops when you get out; the lights stay on
        cycleBlue() {this.blue = (this.blue + 1) % 3;return ['Blue lights and siren off', 'Blue lights on · L3 / H again: siren', 'Blue lights and siren on'][this.blue];}
        hud() {return `${Math.round(Math.abs(this.speed) * 3.6)} km/h · ${['blue lights off', 'blue lights on', 'blue lights + siren'][this.blue]} (L3 / H)`;}
        netExtra() {return [this.steerAngle, this.blue];}
        netApply(a) {super.netApply(a);this.blue = Math.max(0, Math.min(2, Math.round(a[1] || 0)));}
      };
      const list = places.map((p, k) => new PoliceCar(p.x, p.z, p.yaw, cars.length + k));
      cars.push(...list);return list;
    }
    const camRight = new T.Vector3();
    function carsTick(camera, player) {
      if (!cars.length) return;
      const t = performance.now() / 1000, cp = camera.position;let best = 0, pan = 0;
      for (const c of cars) {
        const vis = c.group.visible;let ia = 0, ib = 0;
        if (c.blue && vis) {const ph = (t * 1.7 + c.phase) % 1;ia = ph < .09 || (ph > .18 && ph < .27) ? 8 : .3;ib = (ph > .5 && ph < .59) || (ph > .68 && ph < .77) ? 8 : .3;}
        if (c.lampA.emissiveIntensity !== ia) c.lampA.emissiveIntensity = ia;if (c.lampB.emissiveIntensity !== ib) c.lampB.emissiveIntensity = ib;
        if (c.blue === 2 && vis) {
          const dx = c.x - cp.x, dz = c.z - cp.z, d = Math.hypot(dx, dz), mine = player.vehicle === c, lv = mine ? .5 : 1 / (1 + Math.pow(d / 14, 1.6));
          if (lv > best) {best = lv;camRight.setFromMatrixColumn(camera.matrixWorld, 0);pan = mine || d < .5 ? 0 : (dx * camRight.x + dz * camRight.z) / d * .8;}
        }
      }
      if (audio && audio.siren) audio.siren(best > .01 ? best : 0, pan);
    }

    const mute = () => {if (audio && audio.siren) audio.siren(0, 0);};
    return {group, floors, obstacles, hitboxes, doors, prompt, poi, tick, mute, inside, lampAt, placeName, makeCars, cars, frames, hatches, talkers, data: DATA,
      // Where the police station's cars park (local x, s) and the door they keep clear of.
      stationAnchor: () => {const fr = frames.find(f => f.B === DATA.station);return fr && fr.anchor ? {x: fr.anchor[0], s: fr.anchor[1], n: 6, reach: 70, gap: 6.5, door: {x: fr.door[0], s: fr.door[1], r: 7}} : null;}};
  }

  return {DATA, edgeOf, prepare, wallPlan, spots, create};
});
