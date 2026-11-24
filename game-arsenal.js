/* Arsenalet, the arena and the bank (issue #179: "a building with a big arsenal of all different kinds of guns and weapons …
 * several missions … a pvp arena with different vegetation, and possibilities for camouflage clothes … a gun game").
 *
 * - Arsenalet: a low concrete building beside Johan Svendsens gate, below Torshovparken. Inside: every weapon on the wall
 *   (□ at the counter: choose a main weapon and a pistol; the knife is always with you), the camouflage clothes (□ at the
 *   rail) and the mission board (□: the bank, the money transport, dealing – as a robber or as the police – and the hostage
 *   rescue). The weapons are lent to you: they cost nothing.
 * - The arena: 72 × 48 m of the park's south slope inside a fence, in six zones of different plants (pine wood, birch grove,
 *   rocks and heather, tall grass, thicket, reeds). Inside the fence your weapons are live: targets to practise on, and
 *   games from the pad inside the gate (gun game, free for all, team deathmatch; bots; together online). The rules are
 *   GameWeapons.Arena.
 * - Torshov Sparebank: a room cut into the brick building on Sandakerveien (building 758), like the grocery shops.
 * Weapons only come out inside the arena and during a mission; the rest of the world stays peaceful.
 *
 * GameArsenal.prepare(D) (before Surroundings.create: the bank's notch), GameArsenal.holes() (no park trees in the arena or
 * under the building), GameArsenal.create({T, lib, world, data, audio, view, overlay}) -> the module (see the end).
 */
(function (root, factory) {
  root.GameArsenal = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const KEY = 'haarklous-arsenal-v1', DEG = Math.PI / 180;
  let BANK = null;
  function prepare(D, data = window.ARSENAL) {
    if (!data || !window.GameShops || BANK) return BANK;
    const b = D.buildings[data.bank.building];if (!b) return null;
    const ring = [];for (let i = 0; i < b.r.o.length; i += 2) ring.push([b.r.o[i], b.r.o[i + 1]]);
    const nt = window.GameShops.notchFor(ring, data.bank.edge, data.bank.t0, data.bank.t1, data.bank.depth);b.r.o = nt.ring.flat();BANK = {nt, b};return BANK;
  }
  function holes(data = window.ARSENAL) {
    if (!data) return [];const A = data.arena, H = data.house;
    return [{x0: A.x0 - 1.5, s0: A.s0 - 1.5, x1: A.x0 + A.w + 1.5, s1: A.s0 + A.d + 1.5}, {x0: H.x0 - 2.5, s0: H.s0 - 4, x1: H.x0 + H.w + 2.5, s1: H.s0 + H.d + 2.5}];
  }

  function create({T, lib, world, data, audio, view, overlay}) {
    const W = window.GameWeapons, tw = world.toWorld, hw = world.heightWorld, hl = (x, s) => {const p = tw(x, s);return hw(p.x, p.z);};
    const G = new T.Group();G.name = 'Arsenal';
    const geo = new T.Group();geo.rotation.y = world.data.geo.theta;geo.position.set(world.data.geo.x, 0, world.data.geo.z);G.add(geo);
    const floors = [], obstacles = [], ctx = {};
    const std = (color, roughness = .7, metalness = 0, more = {}) => new T.MeshStandardMaterial({color, roughness, metalness, ...more});
    const box = (parent, w, h, d, x, y, z, m, cast = true) => {const o = new T.Mesh(new T.BoxGeometry(w, h, d), m);o.position.set(x, y, z);o.castShadow = cast;o.receiveShadow = true;parent.add(o);return o;};
    const ob = (x0, s0, x1, s1, minY, maxY, kind = 'arsenal') => obstacles.push({points: [[x0, s0], [x1, s0], [x1, s1], [x0, s1]].map(p => tw(...p)), minY, maxY, kind});
    const canvasTex = (w, h, draw) => {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return t;};
    const sign = (w, h, lines, bg, fg, px = 256) => {const tex = canvasTex(Math.round(px * w / h), px, (c, cw, ch) => {c.fillStyle = bg;c.fillRect(0, 0, cw, ch);c.fillStyle = fg;c.textAlign = 'center';c.textBaseline = 'middle';lines.forEach(([t, size, y]) => {c.font = `bold ${Math.round(size * ch)}px Arial, sans-serif`;c.fillText(t, cw / 2, y * ch);});});
      const m = new T.MeshStandardMaterial({map: tex, roughness: .6}), front = new T.Mesh(new T.PlaneGeometry(w, h), m), back = new T.Mesh(new T.PlaneGeometry(w, h), m);back.rotation.y = Math.PI;back.position.z = -.012;front.add(back);return front;};
    function camoTex(c) {return canvasTex(128, 128, (x, w, h) => {const R = W.rng(c.id.length * 97 + c.colors[0].length);x.fillStyle = c.colors[0];x.fillRect(0, 0, w, h);for (let i = 0; i < 70; i++) {x.fillStyle = c.colors[1 + Math.floor(R() * 3)];x.beginPath();x.ellipse(R() * w, R() * h, 6 + R() * 16, 4 + R() * 9, R() * 3, 0, 6.3);x.fill();}});}
    const camoMats = W.CAMO.map(c => c.colors ? new T.MeshStandardMaterial({map: camoTex(c), roughness: .9}) : null);

    // ---------- Arsenalet ----------
    const H = data.house, hx0 = H.x0, hs0 = H.s0, hx1 = hx0 + H.w, hs1 = hs0 + H.d, hcx = hx0 + H.w / 2, hcs = hs0 + H.d / 2, CEIL = 3.3, TH = .5, doorX = H.door[0];
    let F = -1e9;for (let u = 0; u <= 1.001; u += .1) for (let v = 0; v <= 1.001; v += .1) F = Math.max(F, hl(hx0 + H.w * u, hs0 + H.d * v));F += .12;
    const house = new T.Group();geo.add(house);
    {
      const wallM = lib.concrete(0x8f918c), innerM = lib.plaster(0xe9e7e0), floorM = lib.concrete(0x6f7276), roofM = lib.concrete(0x3c3f42), woodM = lib.paint(0x6b4a2c, .6), steelM = lib.metal(0x4a4f55, .45), boardM = lib.paint(0x2c3138, .8);
      const lightM = new T.MeshStandardMaterial({color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.5});
      const wallH = CEIL + 2.0, wy = F - 1.7 + wallH / 2;
      box(house, H.w - .1, .12, H.d - .1, hcx, F - .06, hcs, floorM, false);box(house, H.w + .5, .28, H.d + .5, hcx, F + CEIL + .44, hcs, roofM);box(house, H.w - 1.02, .05, H.d - 1.02, hcx, F + CEIL + .02, hcs, innerM, false);
      box(house, H.w, wallH, TH, hcx, wy, hs1 - TH / 2, wallM);box(house, TH, wallH, H.d - 2 * TH, hx0 + TH / 2, wy, hcs, wallM);box(house, TH, wallH, H.d - 2 * TH, hx1 - TH / 2, wy, hcs, wallM);
      box(house, doorX - 1 - hx0, wallH, TH, (hx0 + doorX - 1) / 2, wy, hs0 + TH / 2, wallM);box(house, hx1 - doorX - 1, wallH, TH, (doorX + 1 + hx1) / 2, wy, hs0 + TH / 2, wallM);
      box(house, 2, CEIL + .3 - 2.3, TH, doorX, F + 2.3 + (CEIL + .3 - 2.3) / 2, hs0 + TH / 2, wallM);box(house, 2, 1.66, TH, doorX, F - .87, hs0 + TH / 2, wallM);
      // Inside linings a little off the concrete, the lamps, a strip of rubber floor down the middle.
      box(house, H.w - 1.04, CEIL, .03, hcx, F + CEIL / 2, hs1 - TH - .02, innerM, false);box(house, .03, CEIL, H.d - 1.04, hx0 + TH + .02, F + CEIL / 2, hcs, innerM, false);box(house, .03, CEIL, H.d - 1.04, hx1 - TH - .02, F + CEIL / 2, hcs, innerM, false);
      for (let i = 0; i < 4; i++) box(house, 2.2, .05, .28, hx0 + 3.5 + i * 5.6, F + CEIL - .03, hcs, lightM, false);
      for (const [x0, s0, x1, s1] of [[hx0, hs1 - TH, hx1, hs1], [hx0, hs0, hx0 + TH, hs1], [hx1 - TH, hs0, hx1, hs1], [hx0, hs0, doorX - 1, hs0 + TH], [doorX + 1, hs0, hx1, hs0 + TH]]) ob(x0, s0, x1, s1, F - 2.5, F + CEIL + .7);
      // The sign over the door, and the name on the wall beside it.
      const sg = sign(5.2, .9, [['ARSENALET', .62, .42], ['våpen · oppdrag · arena', .2, .84]], '#16191d', '#f2c23a');sg.rotation.y = Math.PI;sg.position.set(doorX, F + 2.85, hs0 - .03);house.add(sg);
      // The weapon wall (south wall): every weapon on a board with its name under it, the counter in front.
      box(house, 17.6, 2.3, .06, hx0 + 10.4, F + 1.75, hs1 - TH - .07, boardM, false);
      const racks = new T.Group();house.add(racks);
      W.WEAPONS.forEach((w, i) => {
        const col = i % 9, row = Math.floor(i / 9), g = W.buildGun(T, w.id), x = hx0 + 2.6 + col * 1.95, y = F + (row ? 1.25 : 2.25), sc = w.len > 1.2 ? .9 : 1;
        g.rotation.y = Math.PI / 2;g.scale.setScalar(sc);g.position.set(x + (w.len > .5 ? .25 : 0), y, hs1 - TH - .16);racks.add(g);
        const plate = sign(.9, .16, [[w.name, .62, .52]], '#e9e7e0', '#16191d', 48);plate.rotation.y = Math.PI;plate.position.set(x, y - .3, hs1 - TH - .11);racks.add(plate);
        box(racks, .02, .1, .08, x - .2, y - .06, hs1 - TH - .12, steelM, false);box(racks, .02, .1, .08, x + .25, y - .06, hs1 - TH - .12, steelM, false);
      });
      box(house, 17.6, 1.0, .7, hx0 + 10.4, F + .5, hs1 - TH - 1.5, woodM);box(house, 17.7, .05, .8, hx0 + 10.4, F + 1.02, hs1 - TH - 1.5, steelM, false);ob(hx0 + 1.6, hs1 - TH - 1.9, hx0 + 19.2, hs1 - TH - 1.1, F - .2, F + 1.1);
      for (let i = 0; i < 5; i++) box(house, .5, .3, .34, hx0 + 3 + i * 3.6, F + 1.2, hs1 - TH - 1.5, std(0x4a5236, .8));// ammunition boxes on the counter
      // The camouflage rail (west wall).
      const csg = sign(2.4, .4, [['KAMUFLASJE · CAMOUFLAGE', .5, .52]], '#16191d', '#e9e7e0', 64);csg.rotation.y = Math.PI / 2;csg.position.set(hx0 + TH + .06, F + 2.75, hcs);house.add(csg);
      box(house, .05, .05, 6.4, hx0 + TH + .5, F + 2.1, hcs, steelM, false);
      W.CAMO.forEach((c, i) => {if (!c.colors) return;const m = new T.Mesh(new T.CapsuleGeometry(.2, .55, 4, 10), camoMats[i]);m.scale.set(1, 1, .45);m.rotation.y = Math.PI / 2;m.position.set(hx0 + TH + .5, F + 1.55, hcs - 3.4 + i * .98);m.castShadow = true;house.add(m);});
      // The mission board (east wall) and a table with a map.
      const mb = sign(3.2, 1.7, [['OPPDRAG · MISSIONS', .13, .12], ['Bank  ·  Pengetransport  ·  Deal', .085, .34], ['Gisselredning  ·  Arenaen', .085, .5], ['røver eller politi – ditt valg', .07, .7], ['□ / E', .1, .88]], '#20303a', '#f1ede2');
      mb.rotation.y = -Math.PI / 2;mb.position.set(hx1 - TH - .07, F + 1.85, hcs);house.add(mb);
      box(house, 1.8, .78, 1.0, hcx + 3, F + .39, hcs - 1.2, woodM);ob(hcx + 2.1, hcs - 1.7, hcx + 3.9, hcs - .7, F - .2, F + .8);
      const mp = sign(1.5, .8, [['TORSHOV', .3, .35], ['Sandakerveien · Haarklous plass', .1, .7]], '#d9d2bd', '#3a3f45', 128);mp.rotation.x = -Math.PI / 2;mp.position.set(hcx + 3, F + .79, hcs - 1.2);house.add(mp);
      lib.mergeStatic(house);
      // Floors: the room, and the slab outside the door down to the ground.
      floors.push({name: 'Arsenalet', points: [[hx0 + .05, hs0], [hx1 - .05, hs0], [hx1 - .05, hs1 - .05], [hx0 + .05, hs1 - .05]].map(p => tw(...p)), y: F, ceilingHeight: CEIL, surfaceKind: 'stone'});
      let rl = 1.2, rise = 0;for (let it = 0; it < 3; it++) {rise = F - hl(doorX, hs0 - rl);rl = Math.max(1.2, Math.abs(rise) / .22);}rise = F - hl(doorX, hs0 - rl);
      if (rise > .04) {
        const pos = new Float32Array([doorX - 1.1, F, hs0, doorX + 1.1, F, hs0, doorX + 1.1, F - rise, hs0 - rl, doorX - 1.1, F - rise, hs0 - rl, doorX - 1.1, F - rise - .5, hs0, doorX + 1.1, F - rise - .5, hs0]);
        const rg = new T.BufferGeometry();rg.setAttribute('position', new T.BufferAttribute(pos, 3));rg.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 1, 5, 2]);rg.computeVertexNormals();
        const ramp = new T.Mesh(rg, lib.concrete(0x9c9a94));ramp.material.side = T.DoubleSide;ramp.receiveShadow = true;geo.add(ramp);
      }
      const o = tw(doorX, hs0), i1 = tw(doorX, hs0 + 1), inx = i1.x - o.x, inz = i1.z - o.z, grad = rise / rl;
      floors.push({name: 'Arsenalet entrance', points: [[doorX - 1.1, hs0 + .05], [doorX + 1.1, hs0 + .05], [doorX + 1.1, hs0 - rl], [doorX - 1.1, hs0 - rl]].map(p => tw(...p)), y: F, slope: {x: inx * grad, z: inz * grad, origin: o}, surfaceKind: 'stone', ceilingHeight: Infinity});
    }
    const station = {weapons: tw(hx0 + 10.4, hs1 - TH - 2.5), camo: tw(hx0 + TH + 1.5, hcs), missions: tw(hx1 - TH - 1.4, hcs)};
    const home = () => {const p = tw(doorX, hs0 - 3), q = tw(doorX, hs0);return {x: p.x, z: p.z, yaw: Math.atan2(-(q.x - p.x), -(q.z - p.z))};};
    const inHouse = (x, z, feet) => {const l = world.toLocal(x, z);return l.x > hx0 && l.x < hx1 && l.s > hs0 && l.s < hs1 && Math.abs(feet - F) < 1.5;};

    // ---------- The arena ----------
    const A = data.arena, ax0 = A.x0, as0 = A.s0, ax1 = ax0 + A.w, as1 = as0 + A.d, gateX = A.gate[0];
    const arena = new T.Group();geo.add(arena);
    const targets = [];
    {
      // The fence: posts every 4 m, wire between them following the ground; the gate is a 3 m gap in the south side.
      const postM = lib.metal(0x5c6166, .5), per = [];
      for (let x = ax0; x < ax1 - .01; x += 4) per.push([x, as0, x + 4, as0]);for (let s = as0; s < as1 - .01; s += 4) per.push([ax1, s, ax1, s + 4]);
      for (let x = ax1; x > ax0 + .01; x -= 4) per.push([x, as1, x - 4, as1]);for (let s = as1; s > as0 + .01; s -= 4) per.push([ax0, s, ax0, s - 4]);
      const pos = [], uv = [], FH = 2.6, postGeo = new T.CylinderGeometry(.04, .04, FH + .3, 6), posts = new T.InstancedMesh(postGeo, postM, per.length + 2), m4 = new T.Matrix4();let pn = 0;
      for (const [x0, s0, x1, s1] of per) {
        const gate = s0 === as1 && s1 === as1 && Math.min(x0, x1) >= gateX - 2.01 && Math.max(x0, x1) <= gateX + 2.01, y0 = hl(x0, s0), y1 = hl(x1, s1);
        m4.makeTranslation(x0, y0 + FH / 2 - .1, s0);posts.setMatrixAt(pn++, m4);
        if (gate) continue;
        pos.push(x0, y0, s0, x1, y1, s1, x1, y1 + FH, s1, x0, y0, s0, x1, y1 + FH, s1, x0, y0 + FH, s0);uv.push(0, 0, 8, 0, 8, 5.2, 0, 0, 8, 5.2, 0, 5.2);
        ob(Math.min(x0, x1) - .2, Math.min(s0, s1) - .2, Math.max(x0, x1) + .2, Math.max(s0, s1) + .2, Math.min(y0, y1) - 2, Math.max(y0, y1) + FH, 'fence');
      }
      posts.count = pn;posts.castShadow = true;arena.add(posts);
      const fg = new T.BufferGeometry();fg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));fg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));fg.computeVertexNormals();
      const wire = canvasTex(64, 64, (c, w) => {c.clearRect(0, 0, w, w);c.strokeStyle = 'rgba(150,158,165,.95)';c.lineWidth = 3;c.beginPath();c.moveTo(0, 0);c.lineTo(w, w);c.moveTo(w, 0);c.lineTo(0, w);c.stroke();});wire.wrapS = wire.wrapT = T.RepeatWrapping;
      arena.add(new T.Mesh(fg, new T.MeshStandardMaterial({map: wire, transparent: true, alphaTest: .35, side: T.DoubleSide, roughness: .6, metalness: .4})));
      // Signs at the gate, the pad inside it.
      const gy = hl(gateX, as1), gs = sign(3.4, 1.1, [['ARENAEN', .4, .3], ['skarpe våpen innenfor gjerdet', .15, .66], ['live weapons inside the fence', .13, .86]], '#7a1c14', '#f6efe2');gs.position.set(gateX - 4.2, gy + 2.1, as1 + .12);arena.add(gs);
      const pad = new T.Mesh(new T.RingGeometry(W.AR.PAD - .25, W.AR.PAD, 48), new T.MeshBasicMaterial({color: 0xf2c23a, transparent: true, opacity: .8, side: T.DoubleSide, toneMapped: false, depthWrite: false}));pad.rotation.x = -Math.PI / 2;pad.position.set(gateX, hl(gateX, as1 - 4.5) + .12, as1 - 4.5);arena.add(pad);
      const ps = sign(2.2, .8, [['SPILL · GAMES', .3, .3], ['stå i ringen: velg og start', .15, .7]], '#16191d', '#f2c23a');ps.position.set(gateX + 3.2, gy + 1.5, as1 - 3);ps.rotation.y = -.6;arena.add(ps);
      box(arena, .08, 1.5, .08, gateX + 3.2, gy + .6, as1 - 3, postM);
      // The plants and the cover, one instanced mesh per part.
      const by = {};for (const t of A.things) (by[t[0]] = by[t[0]] || []).push(t);
      const q = new T.Quaternion(), yUp = new T.Vector3(0, 1, 0), eu = new T.Euler();
      const inst = (kind, geom, material, place, cast = true) => {const L = by[kind] || [];if (!L.length) return;const m = new T.InstancedMesh(geom, material, L.length);L.forEach((t, i) => {const y = hl(t[1], t[2]), p = place(t, y);eu.set(p.rx || 0, t[6] + (p.ry || 0), p.rz || 0, 'YXZ');q.setFromEuler(eu);m4.compose(new T.Vector3(t[1] + (p.dx || 0), y + p.y, t[2] + (p.ds || 0)), q, new T.Vector3(p.sx ?? t[5], p.sy ?? t[5], p.sz ?? t[5]));m.setMatrixAt(i, m4);});m.castShadow = cast;m.receiveShadow = true;m.frustumCulled = false;arena.add(m);};
      const barkM = lib.bark(), birchM = std(0xe6e4dc, .8), pineM = lib.leaves(0x2f4a2a), leafM = lib.leaves(0x5f8a3a), bushM = lib.leaves(0x3f6230), rockM = lib.concrete(0x7d7f80), strawM = std(0xc9ab5c, .95), crateM = lib.paint(0x7a5a34, .8), bagM = std(0x9a8f6c, .95);
      inst('pine', new T.CylinderGeometry(.13, .28, 6, 7), barkM, t => ({y: 3 * t[5]}));
      for (const [r, h, y] of [[2.1, 3.6, 5.2], [1.6, 3.2, 7.2], [1.05, 2.8, 9.2]]) inst('pine', new T.ConeGeometry(r, h, 8), pineM, t => ({y: y * t[5]}));
      inst('birch', new T.CylinderGeometry(.1, .2, 6.5, 7), birchM, t => ({y: 3.25 * t[5]}));inst('birch', new T.IcosahedronGeometry(2.1, 1), leafM, t => ({y: 7.2 * t[5], sy: t[5] * 1.25}));
      inst('bush', new T.IcosahedronGeometry(1.0, 1), bushM, t => ({y: .6 * t[5], sy: t[5] * .85}));inst('bush', new T.IcosahedronGeometry(.7, 1), leafM, t => ({y: 1.0 * t[5], dx: .5, ds: .3}));
      inst('rock', new T.DodecahedronGeometry(1.35, 0), rockM, t => ({y: .45 * t[5], sy: t[5] * .8, rx: .3}));
      inst('log', new T.CylinderGeometry(.34, .36, 3.0, 9), barkM, () => ({y: .34, rz: Math.PI / 2, sx: 1, sy: 1, sz: 1}));
      inst('hay', new T.CylinderGeometry(.95, .95, 1.4, 14), strawM, () => ({y: .7, sx: 1, sy: 1, sz: 1}));
      inst('crate', new T.BoxGeometry(1.4, 1.3, 1.4), crateM, () => ({y: .65, sx: 1, sy: 1, sz: 1}));
      inst('sandbag', new T.BoxGeometry(1.9, 1.1, 1.0), bagM, () => ({y: .55, sx: 1, sy: 1, sz: 1}));
      // Soft plants: two crossed cards with blades drawn on them.
      const tuft = (() => {const g = new T.BufferGeometry(), P = [], U = [];for (const a of [0, Math.PI / 2, Math.PI / 4]) {const c = Math.cos(a) * .5, s = Math.sin(a) * .5;P.push(-c, 0, -s, c, 0, s, c, 1, s, -c, 0, -s, c, 1, s, -c, 1, -s);U.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);}g.setAttribute('position', new T.Float32BufferAttribute(P, 3));g.setAttribute('uv', new T.Float32BufferAttribute(U, 2));g.computeVertexNormals();return g;})();
      const blades = (cols, n, lean, heads) => new T.MeshStandardMaterial({map: canvasTex(256, 256, (c, w, h) => {const R = W.rng(n * 31 + cols.length);c.clearRect(0, 0, w, h);for (let i = 0; i < n * 3; i++) {const x = R() * w, top = h * (.05 + R() * .45), bend = (R() - .5) * lean * 2;c.strokeStyle = cols[Math.floor(R() * cols.length)];c.lineWidth = 1.2 + R() * 2;c.beginPath();c.moveTo(x, h);c.quadraticCurveTo(x + bend * .4, (h + top) / 2, x + bend, top);c.stroke();if (heads && i % 2) {c.fillStyle = heads;c.beginPath();c.ellipse(x + bend, top + 6, 2.2, 10, 0, 0, 6.3);c.fill();}}}), alphaTest: .4, side: T.DoubleSide, roughness: .95});
      inst('grass', tuft, blades(['#7f9a3e', '#96aa4c', '#6a8433', '#b0b060'], 46, 40, null), t => ({y: -.05, sx: 2.4 * t[5], sy: 1.25 * t[5], sz: 2.4 * t[5]}), false);
      inst('reed', tuft, blades(['#b8a468', '#cdb878', '#9a8a54', '#8fa05a'], 40, 22, '#6b5632'), t => ({y: -.05, sx: 2.2 * t[5], sy: 1.9 * t[5], sz: 2.2 * t[5]}), false);
      inst('fern', tuft, blades(['#3f6f2f', '#4f8438', '#2f5a26'], 30, 80, null), () => ({y: -.03, sx: 1.5, sy: .7, sz: 1.5}), false);
      inst('heather', tuft, blades(['#7a4f7a', '#8d5f8d', '#4f6a3a', '#6a4a6a'], 60, 30, null), () => ({y: -.03, sx: 1.4, sy: .45, sz: 1.4}), false);
      for (const t of A.things) {if (!(t[3] > 0) || t[0] === 'bush') continue;const y = hl(t[1], t[2]), r = t[3];ob(t[1] - r, t[2] - r, t[1] + r, t[2] + r, y - .6, y + t[4] * (t[0] === 'pine' || t[0] === 'birch' ? t[5] : 1), 'arena');}
      // Practice targets: a steel figure on a post; it falls when hit and stands up again.
      const steel = std(0x2a2d31, .5, .6), white = std(0xe9e7e0, .6);
      for (const [x, s] of A.targets) {const g = new T.Group(), y = hl(x, s);g.position.set(x, y, s);const fig = new T.Group();g.add(fig);box(fig, .5, .75, .03, 0, 1.05, 0, steel);box(fig, .24, .26, .03, 0, 1.56, 0, steel);box(fig, .18, .18, .035, 0, 1.15, 0, white, false);box(fig, .05, .7, .05, 0, .35, 0, steel);
        const c = tw(ax0 + A.w / 2, as1), w = tw(x, s);g.rotation.y = Math.atan2(c.x - w.x, c.z - w.z) - geo.rotation.y;arena.add(g);targets.push({g, fig, x: w.x, z: w.z, y, down: 0, k: 0});}
    }

    // ---------- Torshov Sparebank ----------
    let bank = null, vaultDoor = null, bagsMesh = null;
    if (BANK) {
      const L = BANK.nt, Bd = BANK.b, Wb = L.W, Db = L.depth, w0 = tw(...L.P0), w1 = tw(...L.P1), wn = tw(L.P0[0] + L.n[0], L.P0[1] + L.n[1]);
      let ux = (w1.x - w0.x) / Wb, uz = (w1.z - w0.z) / Wb, origin = w0;if (ux * (wn.z - w0.z) - uz * (wn.x - w0.x) < 0) {origin = w1;ux = -ux;uz = -uz;}
      const vx = -uz, vz = ux, at = (a, b) => ({x: origin.x + ux * a + vx * b, z: origin.z + uz * a + vz * b});
      let maxH = -1e9;for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {const p = at(Wb * i / 10, Db * j / 10);maxH = Math.max(maxH, hw(p.x, p.z));}
      const fy = maxH + .05, HB = 3.3, top = 3.62, uDoor = 3, vaultA = Wb - 3, g = new T.Group();g.position.set(origin.x, fy, origin.z);g.rotation.y = Math.atan2(-uz, ux);G.add(g);
      const rect = (a0, a1, b0, b1, minY, maxY) => obstacles.push({points: [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)], minY: fy + minY, maxY: fy + maxY, kind: 'bank'});
      const stat = new T.Group();g.add(stat);
      const marble = lib.floorTiles(), wallM = lib.plaster(0xeee9dc), oak = lib.paint(0x5a3d24, .5), brass = lib.metal(0xb08d3c, .35), alu = lib.metal(0x3c4046, .4), steelM = lib.metal(0x8d9399, .3), glassM = new T.MeshPhysicalMaterial({color: 0x9fb6c2, transparent: true, opacity: .25, roughness: .05, metalness: .1, side: T.DoubleSide, depthWrite: false});
      const lightM = new T.MeshStandardMaterial({color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.5});
      box(stat, Wb, .04, Db, Wb / 2, -.02, Db / 2, marble, false);box(stat, Wb, .04, Db, Wb / 2, HB + .02, Db / 2, wallM, false);
      box(stat, .02, HB, Db - .08, .04, HB / 2, Db / 2, wallM, false);box(stat, .02, HB, Db - .08, Wb - .04, HB / 2, Db / 2, wallM, false);
      for (let i = 0; i < 3; i++) box(stat, 1.4, .04, .3, Wb * (i + 1) / 4, HB - .01, 3, lightM, false);
      // The wall with the vault door, a metre in front of the back of the notch.
      const vb = Db - 1.2;box(stat, Wb - .1, HB, .4, Wb / 2, HB / 2, vb + .2, lib.concrete(0x6a6e73));rect(0, Wb, vb - .05, Db, -.5, top);
      // The vault stands half a metre out of that wall: a dark steel box, open to the room behind its door.
      box(stat, 1.9, 2.3, .06, vaultA, 1.15, vb - .04, alu, false);for (const sd of [-1, 1]) box(stat, .08, 2.34, .5, vaultA + sd * .95, 1.17, vb - .25, alu);box(stat, 1.98, .08, .5, vaultA, 2.36, vb - .25, alu);box(stat, 1.8, .04, .42, vaultA, .9, vb - .27, alu, false);rect(vaultA - 1, vaultA + 1, vb - .52, vb, -.5, 2.5);
      // Facade above (the building's own brick), the roof over the notch.
      const fillH = Bd.top - fy - top;
      if (fillH > .2) {
        const fgeo = new T.PlaneGeometry(Wb, fillH), fuv = fgeo.attributes.uv, vBase = (Bd.base + world.data.plinth) - fy;for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * Wb, top - vBase + fuv.getY(i) * fillH);
        const f = new T.Mesh(fgeo, lib.facade());f.rotation.y = Math.PI;f.position.set(Wb / 2, top + fillH / 2, 0);f.castShadow = f.receiveShadow = true;stat.add(f);
        if (!Bd.k) box(stat, Wb, .06, Db, Wb / 2, Bd.top - fy + .03, Db / 2, lib.roof());
      }
      // The front: dark frames, glass, the open doorway, the name.
      box(stat, Wb, .12, .16, Wb / 2, .06, 0, alu);box(stat, Wb, .5, .2, Wb / 2, 3.15, 0, alu);
      for (const x of [.06, uDoor - .98, uDoor + .98, 6.5, 10, Wb - .06]) box(stat, .12, 2.9, .16, x, 1.47, 0, alu);
      for (const [a, b] of [[0, uDoor - .95], [uDoor + .95, Wb]]) {const p = new T.Mesh(new T.PlaneGeometry(b - a, 2.75), glassM);p.position.set((a + b) / 2, 1.5, 0);g.add(p);}
      const bs = sign(7.5, .62, [['TORSHOV SPAREBANK', .68, .54]], '#12303a', '#f1e6c4', 96);bs.rotation.y = Math.PI;bs.position.set(Wb / 2, 3.3, -.12);stat.add(bs);
      rect(0, uDoor - .95, -.25, .25, -.5, top);rect(uDoor + .95, Wb, -.25, .25, -.5, top);
      // The counter with a glass screen, a writing desk, the cash machine.
      box(stat, 7, 1.05, .7, 4.7, .525, 4.9, oak);box(stat, 7.1, .05, .8, 4.7, 1.07, 4.9, brass, false);rect(1.2, 8.2, 4.5, 5.3, -.2, 1.25);
      {const p = new T.Mesh(new T.PlaneGeometry(7, .9), glassM);p.position.set(4.7, 1.55, 4.75);g.add(p);}
      box(stat, 1.4, 1.0, .5, 11.5, .5, .9, oak);rect(10.8, 12.2, .6, 1.2, -.2, 1.1);box(stat, .7, 1.9, .5, .5, .95, 2.4, alu);rect(.1, .9, 2.1, 2.7, -.2, 2);
      lib.mergeStatic(stat);
      // The vault door (it swings when the drill is through) and the bags behind it.
      vaultDoor = new T.Group();vaultDoor.position.set(vaultA - .8, 0, vb - .56);g.add(vaultDoor);
      {const d = box(vaultDoor, 1.6, 2.1, .16, .8, 1.1, 0, steelM);d.castShadow = false;const wh = new T.Mesh(new T.TorusGeometry(.26, .035, 8, 20), brass);wh.position.set(.8, 1.15, -.12);vaultDoor.add(wh);box(vaultDoor, .5, .05, .05, .8, 1.15, -.12, brass, false);box(vaultDoor, .05, .5, .05, .8, 1.15, -.12, brass, false);}
      bagsMesh = new T.Group();bagsMesh.visible = false;g.add(bagsMesh);for (let i = 0; i < 3; i++) {const b = new T.Mesh(new T.CapsuleGeometry(.2, .3, 4, 8), std(0x3d4a2c, .9));b.rotation.z = Math.PI / 2;b.position.set(vaultA - .5 + i * .5, i === 1 ? 1.13 : .22, vb - .27);bagsMesh.add(b);}
      // Outside: a slab up to the door where the ground is lower.
      let rl = 1.2, rise = 0;for (let it = 0; it < 3; it++) {const e = at(uDoor, -rl);rise = fy - hw(e.x, e.z);rl = Math.max(1.2, Math.abs(rise) / .22);}{const e = at(uDoor, -rl);rise = fy - hw(e.x, e.z);}
      if (rise > .06) {const pos = new Float32Array([uDoor - 1.1, 0, 0, uDoor + 1.1, 0, 0, uDoor + 1.1, -rise, -rl, uDoor - 1.1, -rise, -rl, uDoor - 1.1, -rise - .4, 0, uDoor + 1.1, -rise - .4, 0]), rg = new T.BufferGeometry();rg.setAttribute('position', new T.BufferAttribute(pos, 3));rg.setIndex([0, 2, 1, 0, 3, 2, 0, 4, 3, 1, 2, 5]);rg.computeVertexNormals();const ramp = new T.Mesh(rg, lib.concrete(0x9c9a94));ramp.material.side = T.DoubleSide;ramp.receiveShadow = true;g.add(ramp);}
      floors.push({name: 'Torshov Sparebank entrance', points: [at(uDoor - 1.1, 0), at(uDoor + 1.1, 0), at(uDoor + 1.1, -rl), at(uDoor - 1.1, -rl)], y: fy, slope: {x: vx * rise / rl, z: vz * rise / rl, origin: at(uDoor, 0)}, surfaceKind: 'stone', ceilingHeight: Infinity});
      floors.push({name: 'Torshov Sparebank', points: [at(0, 0), at(Wb, 0), at(Wb, Db), at(0, Db)], y: fy, ceilingHeight: HB, surfaceKind: 'tile'});
      bank = {at, y: fy, W: Wb, D: vb, door: uDoor, vault: vaultA, group: g, inside: (x, z, feet) => {const dx = x - origin.x, dz = z - origin.z, a = dx * ux + dz * uz, b = dx * vx + dz * vz;return a > 0 && a < Wb && b > 0 && b < Db && Math.abs(feet - fy) < 2;}};
    }
    let vaultOpen = false;

    // ---------- What you carry ----------
    const save = {primary: 'hk416', side: 'g17', camo: 'none'};
    const load = () => {try {const s = JSON.parse(localStorage.getItem(KEY) || 'null');if (s) for (const k of ['primary', 'side', 'camo']) if (typeof s[k] === 'string') save[k] = s[k];} catch {}if (!W.isPrimary(W.weapon(save.primary))) save.primary = 'hk416';if (!W.isSidearm(W.weapon(save.side))) save.side = 'g17';if (!W.CAMO.some(c => c.id === save.camo)) save.camo = 'none';};
    load();const store = () => {try {localStorage.setItem(KEY, JSON.stringify(save));} catch {}};
    const loadout = () => [W.indexOf(save.primary), W.indexOf(save.side), W.indexOf('knife')], camoIndex = () => Math.max(0, W.CAMO.findIndex(c => c.id === save.camo));
    const P = () => ctx.player;let speed = 0, lastPos = null;
    const rules = new W.Arena(A, {toWorld: tw, ground: (x, z) => hw(x, z), serverNow: () => ctx.serverNow ? ctx.serverNow() : Date.now(), you: () => ctx.you ? ctx.you() : 0, yourName: () => ctx.yourName ? ctx.yourName() : 'You', others: () => ctx.others ? ctx.others() : [],
      feet: () => ({x: P().x, y: P().feet + (P().jumpY || 0), z: P().z}), yaw: () => P().yaw, stance: () => P().stance, speed: () => speed, teleport: (x, z, yaw) => {if (P().mode === 'foot') ctx.place(x, z, yaw);},
      cameraPos: () => ({x: ctx.camera.position.x, y: ctx.camera.position.y, z: ctx.camera.position.z}), cameraFwd: () => {const d = ctx.camera.getWorldDirection(new T.Vector3());return aimHelp({x: d.x, y: d.y, z: d.z});},
      blockDist: (o, d, max) => ctx.blockDist(o, d, max), moveBot: (p, dx, dz) => ctx.moveActor(p, dx, dz), loadout, camo: camoIndex, notice: (t, s) => ctx.notice(t, s), sound: (n, g) => audio.sfx(n, {gain: g}), random: Math.random});

    // ---------- Shots you see and hear ----------
    const fxG = new T.Group();G.add(fxG);
    const tracers = Array.from({length: 28}, () => {const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({color: 0xffe2a0, transparent: true, opacity: .9, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false}));m.visible = false;m.frustumCulled = false;fxG.add(m);return {m, t: 0};});
    const puffs = Array.from({length: 14}, () => {const m = new T.Mesh(new T.SphereGeometry(.07, 6, 5), new T.MeshBasicMaterial({color: 0xd9d2c0, transparent: true, opacity: .8, depthWrite: false}));m.visible = false;fxG.add(m);return {m, t: 0};});
    let trI = 0, pfI = 0;const tA = new T.Vector3(), tB = new T.Vector3();
    function tracer(from, d, len, own) {
      if (!(len > .5)) return;const L = Math.min(len, 260), tr = tracers[trI = (trI + 1) % tracers.length];
      tA.set(from.x, from.y, from.z);tB.set(from.x + d.x * L, from.y + d.y * L, from.z + d.z * L);
      if (own) {const c = ctx.camera, r = new T.Vector3(1, 0, 0).applyQuaternion(c.quaternion), u = new T.Vector3(0, 1, 0).applyQuaternion(c.quaternion);tA.addScaledVector(r, .12).addScaledVector(u, -.1).addScaledVector(new T.Vector3(d.x, d.y, d.z), .7);}
      tr.m.position.copy(tA).add(tB).multiplyScalar(.5);tr.m.lookAt(tB);tr.m.scale.set(.02, .02, tA.distanceTo(tB));tr.m.visible = true;tr.t = .07;
      if (len < 250) {const p = puffs[pfI = (pfI + 1) % puffs.length];p.m.position.copy(tB);p.m.scale.setScalar(1);p.m.visible = true;p.t = .22;}
    }
    let noiseBuf = null;
    function shotSound(w, dist) {
      const ac = audio.context;if (!ac) return;
      if (w.melee || w.cls === 'bow') {if (dist < 20) audio.sfx('throw', {gain: .5});return;}
      const out = audio.output || ac.destination, vol = Math.min(1, 12 / Math.max(5, dist)) * Math.min(1.2, w.loud / 120);if (vol < .012) return;
      try {
        if (!noiseBuf) {noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);const dt = noiseBuf.getChannelData(0);for (let i = 0; i < dt.length; i++) dt[i] = Math.random() * 2 - 1;}
        const now = ac.currentTime, big = Math.min(2.6, w.dmg * w.pellets / 55), len = Math.min(.6, .15 + .13 * big + Math.min(.2, dist / 400));
        const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();src.buffer = noiseBuf;f.type = 'lowpass';f.frequency.setValueAtTime(Math.max(700, (5200 - 900 * big) / (1 + dist / 60)), now);f.frequency.exponentialRampToValueAtTime(260, now + len);
        g.gain.setValueAtTime(vol * .85, now);g.gain.exponentialRampToValueAtTime(.001, now + len);src.connect(f).connect(g).connect(out);src.start(now, Math.random() * .3);src.stop(now + len + .02);
        const osc = ac.createOscillator(), og = ac.createGain();osc.frequency.setValueAtTime(175 - 32 * big, now);osc.frequency.exponentialRampToValueAtTime(42, now + .16);og.gain.setValueAtTime(vol * .65, now);og.gain.exponentialRampToValueAtTime(.001, now + .19);osc.connect(og).connect(out);osc.start(now);osc.stop(now + .2);
      } catch {}
    }
    // With a controller a shot that is almost on somebody goes on them (the stick is no mouse).
    let padAim = false;
    function aimHelp(d) {
      if (!padAim) return d;const o = ctx.camera.position;let best = null, bc = Math.cos(2.2 * DEG);
      const figs = ops.cur ? ops.debug.actors().filter(a => a.alive && a.hostile).map(a => ({x: a.x, y: a.y + (a.stance === 'crouch' ? .75 : 1.15), z: a.z})) : rules.figures().filter(f => !f.local).map(f => ({x: f.feet.x, y: f.feet.y + (f.stance === 'crouch' ? .75 : 1.15), z: f.feet.z}));
      for (const f of figs) {const v = {x: f.x - o.x, y: f.y - o.y, z: f.z - o.z}, l = Math.hypot(v.x, v.y, v.z);if (l < 1 || l > 90) continue;const c = (v.x * d.x + v.y * d.y + v.z * d.z) / l;if (c > bc) {bc = c;best = {x: v.x / l, y: v.y / l, z: v.z / l};}}
      return best || d;
    }
    let kickBack = 0, flashT = 0;
    function kick(w, g) {const k = w.kick * DEG * (.34 - .12 * g.aimT);if (ctx.kick) ctx.kick(k, (Math.random() - .5) * k * .5);kickBack += k * .75;flashT = w.melee || w.cls === 'bow' ? 0 : .045;}

    // ---------- The missions ----------
    const avatars = window.GameAvatars.create({T, lib});
    const ops = window.GameArsenalOps.create({T, W, group: G, avatars, data, ctx, bank, toWorld: tw, home, loadout, speed: () => speed, tracer, shotSound, sfx: (n, g) => audio.sfx(n, {gain: g}),
      vault: open => {vaultOpen = !!open;if (bagsMesh) bagsMesh.visible = vaultOpen;},
      fire: g => {
        const c = ctx.camera, o = {x: c.position.x, y: c.position.y, z: c.position.z}, d0 = c.getWorldDirection(new T.Vector3()), w = g.w;
        const sp = W.spreadOf(w, {aim: g.aimT, moving: Math.min(1, speed / 5), stance: P().stance, heat: g.heat}), d = w.pellets > 1 ? aimHelp({x: d0.x, y: d0.y, z: d0.z}) : W.inCone(aimHelp({x: d0.x, y: d0.y, z: d0.z}), sp, Math.random(), Math.random());
        const ends = ops.shot(o, d, w, 1 + Math.floor(Math.random() * 1e9)) || [];
        if (!w.melee) W.pelletDirs(w, d, 1).slice(0, 3).forEach((pd, i) => tracer(o, w.pellets > 1 ? pd : d, ends[i] ?? 60, true));shotSound(w, 0);kick(w, g);
      }});

    // ---------- Others in the arena: the bots, and the other players' weapons and clothes ----------
    const botAv = new Map(), gear = new Map();
    const hang = (parent, obj, pos, rot) => {obj.position.set(...pos);obj.rotation.set(...rot);parent.add(obj);return obj;};
    const vestFor = ci => {const m = new T.Mesh(new T.CapsuleGeometry(.185, .3, 4, 10), camoMats[ci]);m.scale.set(1.02, 1.02, .76);m.position.set(0, .28, 0);return m;};
    const hoodFor = ci => {const m = new T.Mesh(new T.SphereGeometry(.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * .6), camoMats[ci]);m.position.set(0, .04, .01);return m;};
    function dress(av, wid, ci) {
      const J = av.joints, parts = [];if (!J) return parts;
      parts.push(hang(J.R.el, W.buildGun(T, wid), [0, -.28, -.02], [-Math.PI / 2, 0, 0]));
      if (camoMats[ci] && J.L.sh.parent) {const v = vestFor(ci);J.L.sh.parent.add(v);parts.push(v, hang(J.head, hoodFor(ci), [0, .04, .01], [0, 0, 0]));}
      return parts;
    }
    const undress = g => g.parts.forEach(p => p && p.parent && p.parent.remove(p));
    function updateOthers(dt, remotes) {
      const S = rules.ses, seen = new Set(), tdm = S.mode === 'tdm', myTeam = rules.team(rules.you());
      if (S.id && S.state !== 'lobby' && rules.member) for (const b of S.bots) {
        seen.add(b.id);let v = botAv.get(b.id);const ci = tdm ? W.CAMO.findIndex(c => c.id === W.TEAM_CAMO[rules.team(b.id)]) : 1 + (-b.id % 4);
        if (!v) {v = {av: avatars.avatar(-b.id + 3, rules.name(b.id)), x: b.x, y: b.y, z: b.z, yaw: b.yaw, w: -1, ci: -1, parts: []};G.add(v.av.group);botAv.set(b.id, v);}
        if (v.w !== b.w || v.ci !== ci) {undress(v);v.parts = dress(v.av, b.w, ci);v.w = b.w;v.ci = ci;}
        const k = Math.min(1, dt * 12), px = v.x, pz = v.z;v.x += (b.x - v.x) * k;v.y += (b.y - v.y) * k;v.z += (b.z - v.z) * k;let dy = b.yaw - v.yaw;dy = Math.atan2(Math.sin(dy), Math.cos(dy));v.yaw += dy * k;
        v.av.group.position.set(v.x, v.y, v.z);v.av.group.rotation.y = v.yaw;v.av.pose({stance: b.alive ? b.stance : 'prone', speed: b.alive ? Math.hypot(v.x - px, v.z - pz) / Math.max(dt, 1e-3) : 0, dt, marker: b.alive});
        v.parts[0].visible = b.alive;v.av.update(dt, ctx.camera, tdm && rules.team(b.id) === myTeam);
      }
      for (const [id, v] of botAv) if (!seen.has(id)) {G.remove(v.av.group);v.av.dispose();botAv.delete(id);}
      const here = new Set();
      for (const r of remotes || []) {
        const m = rules.all.find(q => q.id === r.id) || ops.mate(r.id);if (!m || !r.av || !r.av.joints) continue;here.add(r.id);
        const ci = tdm && rules.memberPlaying(r.id) ? W.CAMO.findIndex(c => c.id === W.TEAM_CAMO[rules.team(r.id)]) : m.camo;let g = gear.get(r.id);
        if (!g || g.av !== r.av || g.w !== m.w || g.ci !== ci) {if (g) undress(g);g = {av: r.av, w: m.w, ci, parts: dress(r.av, m.w, ci)};gear.set(r.id, g);}
        g.parts[0].visible = m.alive;
      }
      for (const [id, g] of gear) if (!here.has(id)) {undress(g);gear.delete(id);}
    }

    // ---------- The weapon in your hands ----------
    const vm = new T.Group();vm.visible = false;overlay.add(vm);
    const flash = new T.Mesh(new T.ConeGeometry(.035, .12, 8, 1, true), new T.MeshBasicMaterial({color: 0xffc56b, transparent: true, opacity: .9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide}));flash.rotation.x = -Math.PI / 2;flash.visible = false;vm.add(flash);
    let vmId = '', vmModel = null, bob = 0;
    function viewmodel(dt, g, show) {
      vm.visible = show && !!g;if (!vm.visible) return;const w = g.w;
      if (vmId !== w.id) {if (vmModel) vm.remove(vmModel);vmModel = W.buildGun(T, w.id);vm.add(vmModel);vmId = w.id;flash.position.set(0, w.cls === 'pistol' ? .03 : .045, vmModel.userData.muzzle - .06);}
      const a = g.aimT, scoped = w.scope && a > .8, rl = g.reloadT > 0 ? Math.sin(Math.PI * (1 - g.reloadT / (w.reload + .25))) : 0, k = Math.min(1, g.kick), long = w.len > .45;
      bob += dt * (4 + speed * 2.2);const bx = Math.sin(bob) * .004 * Math.min(3, speed) * (1 - a * .85), byy = -Math.abs(Math.cos(bob)) * .004 * Math.min(3, speed) * (1 - a * .85);
      const hipX = long ? .17 : .14, hipY = long ? -.19 : -.15, hipZ = long ? -.62 : -.5, sight = w.cls === 'pistol' ? -.075 : w.scope ? -.14 : w.cls === 'knife' ? -.12 : w.cls === 'bow' ? -.085 : -.118, adsZ = long ? -.58 : -.44;
      vm.position.set(hipX * (1 - a) + bx, hipY + (sight - hipY) * a + byy - rl * .1, hipZ + (adsZ - hipZ) * a + k * .035);
      vm.rotation.set(k * .05 * (w.kick > 2 ? 1.6 : 1) - rl * .5 + (w.melee ? -g.swing * .9 : 0), .09 * (1 - a) + (w.melee ? g.swing * .5 : 0), rl * .5);
      vmModel.visible = !scoped;flash.visible = flashT > 0 && !scoped;flash.rotation.z = Math.random() * 6;
    }

    // ---------- HUD and menus ----------
    const hud = document.createElement('div');hud.id = 'arHud';
    hud.innerHTML = '<div class="ar-obj" hidden></div><div class="ar-score" hidden></div><div class="ar-big" hidden></div><div class="ar-lobby" hidden></div><div class="ar-feed"></div><div class="ar-ammo" hidden></div><div class="ar-hp" hidden><span>HEALTH</span><b></b><i><u></u></i></div>'
      + '<div class="ar-cross" hidden><i></i><i></i><i></i><i></i></div><div class="ar-hit">✕</div><div class="ar-dmg"></div><div class="ar-dir"></div><div class="ar-scope" hidden></div><div class="ar-result" hidden></div>';
    const menuEl = document.createElement('div');menuEl.id = 'arMenu';menuEl.hidden = true;view.append(hud, menuEl);
    const $ = c => hud.querySelector('.' + c), esc = s => String(s).replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'})[c]);
    const clock = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
    const menu = {open: null, sel: 0, stick: false,
      board: [], sig: '',
      // The mission board: leave the mission you are on, join a friend's, or start one.
      fill() {const J = ops.joinable().filter(j => !(ops.cur && ops.cur.key === j.key));this.sig = J.map(j => j.key).join() + (ops.cur ? 'c' : '');this.board = [...(ops.cur ? [{leave: true}] : []), ...J.map(j => ({join: j})), ...window.GameArsenalOps.MISSIONS];},
      items() {return this.open === 'weapons' ? W.WEAPONS : this.open === 'camo' ? W.CAMO : this.board;},
      show(kind) {this.open = kind;if (kind === 'missions') this.fill();this.sel = kind === 'weapons' ? W.indexOf(save.primary) : kind === 'camo' ? camoIndex() : 0;menuEl.hidden = false;this.render();audio.sfx('click', {gain: .4});},
      close() {this.open = null;menuEl.hidden = true;},
      pick() {
        const it = this.items()[this.sel];
        if (this.open === 'weapons') {if (W.isSidearm(it)) save.side = it.id;else if (W.isPrimary(it)) save.primary = it.id;else {ctx.notice('The knife is always with you.', 2);return;}store();audio.sfx('chains', {gain: .3});this.render();ctx.notice(`${it.name}: your ${W.isSidearm(it) ? 'pistol' : 'main weapon'} now.`, 2.5);}
        else if (this.open === 'camo') {save.camo = it.id;store();audio.sfx('click', {gain: .5});this.render();ctx.notice(`You wear: ${it.name}.`, 2.5);}
        else if (it.leave) {this.close();const lead = ops.cur && !ops.cur.mirror;ops.stop();ctx.notice(lead ? 'You ended the mission.' : 'You left the mission.', 3);}
        else if (it.join) {this.close();if (!ops.join(it.join.id)) ctx.notice('That mission is over.', 3);}
        else {this.close();ops.start(it);}
      },
      render() {
        const L = this.items(), it = L[this.sel], bar = (v, max) => `<i><u style="width:${Math.round(Math.min(1, v / max) * 100)}%"></u></i>`;let list = '', card = '', title = '', keys = '↑↓ choose · ✕ / Space / Enter take · ○ / C close';
        if (this.open === 'weapons') {
          title = 'ARSENALET · WEAPONS';let cls = '';
          L.forEach((w, i) => {if (w.cls !== cls) {cls = w.cls;list += `<li class="h">${W.CLASS_NAME[cls]}</li>`;}list += `<li class="${i === this.sel ? 'sel' : ''}">${esc(w.name)}${w.id === save.primary ? ' <em>main</em>' : w.id === save.side ? ' <em>pistol</em>' : w.id === 'knife' ? ' <em>always</em>' : ''}</li>`;});
          card = `<h3>${esc(it.name)}</h3><p>${esc(it.note || '')}</p><dl><dt>Calibre</dt><dd>${esc(it.cal)}</dd><dt>Magazine</dt><dd>${it.melee ? '–' : `${it.mag} · ${it.mags} spare`}</dd><dt>Fire</dt><dd>${it.melee ? 'stab' : it.auto ? `automatic, ${it.rpm} a minute` : it.pump ? 'pump action' : it.cls === 'sniper' && it.rpm < 60 ? 'bolt action' : 'one shot a pull'}</dd><dt>Muzzle speed</dt><dd>${it.v0 ? `${it.v0} m/s` : '–'}</dd><dt>Reload</dt><dd>${it.reload ? `${it.reload} s` : '–'}</dd></dl>`
            + `<div class="bars"><span>Damage</span>${bar(it.dmg * it.pellets, 160)}<span>Range</span>${bar(it.r1, 500)}<span>Rate</span>${bar(it.rpm, 900)}<span>Steady</span>${bar(6.5 - it.kick, 6.5)}</div>`;
        } else if (this.open === 'camo') {
          title = 'ARSENALET · CAMOUFLAGE';L.forEach((c, i) => {list += `<li class="${i === this.sel ? 'sel' : ''}">${esc(c.name)}${c.id === save.camo ? ' <em>on</em>' : ''}</li>`;});
          card = `<h3>${esc(it.name)}</h3>${it.colors ? `<div class="sw">${it.colors.map(c => `<b style="background:${c}"></b>`).join('')}</div>` : ''}<p>${it.colors ? `Hides you best in: ${it.good.map(g => ({woodland: 'the pine wood, birch grove and thicket', grass: 'the tall grass', desert: 'the reeds', urban: 'the rocks', snow: 'snow (none in the arena now)'})[g]).join(', ')}.` : 'No camouflage: the bots see you from far away.'}</p><p>The arena's bots notice you later when your clothes match the plants round you, and later still when you crouch or lie still. Other players see what you wear. In team deathmatch the teams wear green and sand.</p>`;
        } else {
          title = 'ARSENALET · MISSIONS';const side = m => `<small class="${m.side}">${m.side === 'police' ? 'POLICE' : 'ROBBER'}</small>`, take = `You take ${esc(W.weapon(save.primary).name)}, ${esc(W.weapon(save.side).name)} and the knife.`;
          L.forEach((m, i) => {list += `<li class="${i === this.sel ? 'sel' : ''}">${m.leave ? '<small class="leave">LEAVE</small> the mission you are on' : m.join ? `<small class="join">JOIN</small> ${esc(m.join.name)}: ${esc(m.join.def.name)}` : `${side(m)} ${esc(m.name)}`}</li>`;});
          if (it.leave) card = `<h3>Leave the mission</h3><p>${ops.cur && !ops.cur.mirror ? 'You started this mission. If you leave, it ends for everybody on it.' : 'The others carry on without you. You can join again from this board.'}</p>`;
          else if (it.join) {const d = it.join.def;card = `<h3>${esc(d.name)} · with ${esc(it.join.name)}</h3><p>${side(d)} <b>${esc(d.where)}</b></p><p>${esc(d.text)}</p><p>Pay: ${esc(d.pay)}. Everybody on the mission gets it.</p><p class="dim">${take} You play on ${esc(it.join.name)}'s side and see the same people. If you are shot, a friend can help you up (□); if all of you are down at once, the mission is lost.</p>`;}
          else card = `<h3>${esc(it.name)}</h3><p><b>${esc(it.where)}</b></p><p>${esc(it.text)}</p><p>Pay: ${esc(it.pay)}</p><p class="dim">${take} ${it.solo ? '' : 'Others in your lobby can join from this board: you see the same people, and everybody gets the pay.'}${ops.cur ? ' Starting one ends the mission you are on.' : ''}</p>`;
          keys = `↑↓ choose · ✕ / Space / Enter ${it.leave ? 'leave' : it.join ? 'join' : 'start'} · ○ / C close`;
        }
        menuEl.innerHTML = `<div class="ar-m"><header>${title}</header><div class="ar-mb"><ul>${list}</ul><section>${card}</section></div><footer>${keys}</footer></div>`;
        const s = menuEl.querySelector('li.sel');if (s && s.scrollIntoView) s.scrollIntoView({block: 'nearest'});
      },
      input(input) {
        // A friend started or ended a mission while you read the board.
        if (this.open === 'missions') {const J = ops.joinable().filter(j => !(ops.cur && ops.cur.key === j.key)), sig = J.map(j => j.key).join() + (ops.cur ? 'c' : '');if (sig !== this.sig) {const it = this.board[this.sel];this.fill();const k = this.board.findIndex(q => q === it || (it && it.join && q.join && q.join.key === it.join.key));this.sel = k >= 0 ? k : Math.min(this.sel, this.board.length - 1);this.render();}}
        const p = input.pressed, y = input.move.y, n = this.items().length;let step = 0;
        if (p.has('up') || (y < -.5 && !this.stick)) step = -1;if (p.has('down') || (y > .5 && !this.stick)) step = 1;this.stick = Math.abs(y) > .5;if (input.mouse.wheel) step = Math.sign(input.mouse.wheel);
        if (step) {this.sel = (this.sel + step + n) % n;this.render();}
        if (p.has('cross') || p.has('square') || p.has('enter')) this.pick();else if (p.has('circle') || p.has('options')) this.close();
        input.move.x = input.move.y = 0;input.look.x = input.look.y = 0;input.mouse.dx = input.mouse.dy = 0;input.r2 = input.l2 = 0;for (const k of ['cross', 'square', 'circle', 'triangle', 'up', 'down', 'left', 'right', 'reload', 'l3', 'touchpad']) p.delete(k);
      }};
    let hudT = 0;
    function drawHud(g, armed) {
      const o = ops.cur, R = rules, S = R.ses, inGame = R.inGame(), t = R.now();
      const obj = $('ar-obj');obj.hidden = !o;
      if (o) obj.innerHTML = `<small class="${o.side}">${o.side === 'police' ? 'POLICE' : 'ROBBER'} · ${esc(o.def.name)}</small><b>${esc(o.obj)}</b><span>${esc(ops.sub)}</span>${ops.crew.length ? `<em>With ${ops.crew.map(c => esc(c.name) + (c.down ? ' (down)' : '')).join(', ')}</em>` : ''}${o.timer > 0 ? `<big>${clock(o.timer)}</big>` : ''}${o.id === 'deal' && o.side === 'robber' ? `<i class="heat${o.chase ? ' hot' : ''}"><u style="width:${Math.round(Math.min(100, o.heat))}%"></u></i><small>${o.chase ? 'THE POLICE ARE AFTER YOU' : 'police attention'}</small>` : ''}`;
      const am = $('ar-ammo');am.hidden = !(armed && g);
      if (armed && g) am.innerHTML = `<div class="n">${esc(g.w.name)}</div><div class="mag"><b class="${!g.w.melee && g.mag <= Math.ceil(g.w.mag * .2) ? 'low' : ''}">${g.w.melee ? '—' : g.mag}</b><small>${g.w.melee ? '' : `/ ${g.reserve}`}</small></div><div class="k">${g.reloading ? 'RELOADING' : inGame && S.mode === 'gg' ? `weapon ${R.level(R.you()) + 1} of ${W.LADDER.length}` : 'R2 fire · L2 aim · □ / R reload · △ / F next'}</div>`;
      const hpOn = !!o || inGame, hp = o ? ops.hp : R.hp, he = $('ar-hp');he.hidden = !hpOn;if (hpOn) {he.querySelector('b').textContent = Math.max(0, Math.round(hp));he.querySelector('u').style.width = `${Math.max(0, Math.min(100, hp))}%`;he.classList.toggle('low', hp <= 30);}
      const sc = $('ar-score'), showScore = R.member && S.id && S.state !== 'lobby';sc.hidden = !showScore;
      const big = $('ar-big');big.hidden = true;
      if (o && ops.down && !o.over) {big.hidden = false;big.innerHTML = `<b>You are down</b><small>A friend can help you up (□) · up by yourself in ${Math.max(1, Math.ceil(ops.downT))} s</small>`;}
      if (showScore) {
        const left = S.state === 'count' ? (S.t0 - t) / 1000 : S.state === 'play' ? W.AR.DUR_S - (t - S.t0) / 1000 : 0, B = R.board(), mode = W.MODES.find(m => m.id === S.mode);
        const rows = S.mode === 'tdm' ? [0, 1].map(tm => `<b style="color:${W.TEAM_CSS[tm]}">${W.TEAM_NAME[tm]} ${R.teamKills(tm)}</b>`).join('<span>:</span>')
          : B.slice(0, 4).map(p => `<b class="${p.local ? 'me' : ''}">${esc(p.name)} ${S.mode === 'gg' ? Math.min(p.kills + 1, W.LADDER.length) : p.kills}</b>`).join('');
        sc.innerHTML = `<small>${mode.name} · ${clock(left)}</small><div>${rows}</div>`;
        if (S.state === 'count' && inGame) {big.hidden = false;big.innerHTML = `<span class="n">${Math.max(1, Math.ceil(left))}</span>`;}
        else if (S.state === 'end') {big.hidden = false;const w = S.mode === 'tdm' ? `${W.TEAM_NAME[S.win]} team wins` : `${esc(R.name(S.win))} wins`;big.innerHTML = `<b>${w}</b><small>${B.slice(0, 5).map(p => `${esc(p.name)} ${p.kills}`).join(' · ')}</small>`;}
        else if (inGame && !R.alive) {big.hidden = false;big.innerHTML = `<small>back in ${Math.max(0, Math.ceil(R.respawnT))} s</small>`;}
      }
      const lb = $('ar-lobby'), showLobby = R.member && R.onPad && S.state === 'lobby' && !o;lb.hidden = !showLobby;
      if (showLobby) {const mode = W.MODES.find(m => m.id === S.mode), L = R.all.filter(m => m.lobby > 0).sort((a, b) => a.lobby - b.lobby);
        lb.innerHTML = `<b>THE ARENA</b><div>${mode.name} · bots: ${S.nb}</div><small>${mode.text}</small><ul>${L.map(m => `<li class="${m.local ? 'me' : ''}">${esc(m.local ? R.name(m.id) : m.name)}${m.id === R.adminId ? '  (starts the game)' : ''}</li>`).join('')}</ul><small>${R.isAdmin() ? '←→ game · ↑↓ bots · hold ✕ / Space: start' : 'The one who came first starts the game.'}</small>${R.startHold > 0 ? `<i class="meter"><u style="width:${Math.round(Math.min(1, R.startHold) * 100)}%"></u></i>` : ''}`;}
      $('ar-feed').innerHTML = R.member ? R.feed.filter(f => R.clock - f.t < 6).map(f => `<div>${esc(f.text)}</div>`).join('') : '';
      const res = $('ar-result'), r = ops.result;res.hidden = !r;if (r) res.innerHTML = `<b class="${r.win ? 'win' : 'fail'}">${esc(r.title)}</b><span>${esc(r.text)}</span>${r.pay > 0 ? `<small>+ ${r.pay} kr</small>` : ''}`;
    }

    // ---------- Every frame ----------
    let armedNow = false, zoomNow = 1, practice = 0;
    function update(dt, input, env = {}) {
      const pl = P(), foot = pl.mode === 'foot', p = input.pressed;
      {const x = pl.x, z = pl.z;if (lastPos && dt > 0) speed += (Math.min(12, Math.hypot(x - lastPos.x, z - lastPos.z) / dt) - speed) * Math.min(1, dt * 8);lastPos = {x, z};}
      padAim = !!input.gamepad && input.l2 > .3;
      const live = foot && !menu.open && !env.blocked, inp = live ? {r2: input.r2, l2: input.l2, reload: p.has('reload') || (p.has('square') && env.promptFree), next: p.has('triangle') || Math.abs(input.mouse.wheel) > 0,
        left: p.has('left'), right: p.has('right'), up: p.has('up'), down: p.has('down'), crossHeld: !!input.held.cross} : {};
      const inOp = !!ops.cur;
      rules.update(dt, inOp ? {} : inp);ops.update(dt, inOp ? inp : {}, live);
      const g = ops.gun() || (rules.member ? rules.gun : null);
      armedNow = foot && !!g && (inOp ? !ops.cur.over && !ops.down : !(rules.onPad && !rules.inGame()) && rules.alive);
      // What the arena's rules say happened: our shots, the others' shots, kills, the end of a game.
      for (const s of rules.fresh) {
        const w = W.weapon(s.w), own = s.owner === rules.you();if (s.done) continue;s.done = true;
        if (!w.melee) (w.pellets > 1 ? W.pelletDirs(w, s.d, s.seed).slice(0, 3) : [s.d]).forEach((d, i) => tracer(s.o, d, (s.end && s.end[i]) ?? 60, own));
        shotSound(w, own ? 0 : Math.hypot(s.o.x - ctx.camera.position.x, s.o.z - ctx.camera.position.z));
        if (own) {
          if (rules.gun) kick(w, rules.gun);
          // Practice: the steel targets.
          if (!rules.inGame()) for (const tg of targets) {if (tg.down > 0) continue;for (const d of W.pelletDirs(w, s.d, s.seed)) {const max = w.melee || 400, h = W.rayFigure(s.o, d, Math.min(max, (s.end && s.end[0]) ?? max) + .6, {x: tg.x, y: tg.y, z: tg.z});if (h) {tg.down = 4;practice++;rules.hitT = .25;audio.sfx('ding', {gain: Math.min(.9, 14 / Math.max(8, h.t))});break;}}}
        }
      }
      for (const e of rules.events) {
        if (e.over && ctx.earn) {const kr = Math.min(600, (e.won ? 150 : 40) + e.kills * 20);ctx.earn(kr, e.won ? `You won the ${W.MODES.find(m => m.id === e.mode).name.toLowerCase()}` : `Arena: ${e.kills} kills`);}
        if (e.enter) ctx.notice(rules.ses.state === 'lobby' ? 'The arena: your weapons are live in here. Shoot the steel targets, or stand in the yellow ring to start a game.' : 'A game is on in the arena: you are in.', 6);
      }
      for (const tg of targets) {if (tg.down > 0) tg.down -= dt;const want = tg.down > 0 ? 1 : 0;tg.k += (want - tg.k) * Math.min(1, dt * 9);tg.fig.rotation.x = -tg.k * 1.45;}
      // Recoil settles by itself.
      if (kickBack > 0 && ctx.kick) {const r = Math.min(kickBack, dt * (.5 + kickBack * 9));kickBack -= r;ctx.kick(-r, 0);}
      flashT = Math.max(0, flashT - dt);
      for (const tr of tracers) if (tr.t > 0 && (tr.t -= dt) <= 0) tr.m.visible = false;
      for (const pf of puffs) if (pf.t > 0) {pf.t -= dt;pf.m.scale.setScalar(1 + (.22 - pf.t) * 9);pf.m.material.opacity = Math.max(0, pf.t / .22) * .8;if (pf.t <= 0) pf.m.visible = false;}
      if (vaultDoor) vaultDoor.rotation.y += ((vaultOpen ? -1.9 : 0) - vaultDoor.rotation.y) * Math.min(1, dt * 2.5);
      updateOthers(dt, env.remotes);
      // Far away nothing of this is drawn.
      const cl = world.toLocal(ctx.camera.position.x, ctx.camera.position.z);
      arena.visible = Math.hypot(cl.x - (ax0 + A.w / 2), cl.s - (as0 + A.d / 2)) < 330;house.visible = Math.hypot(cl.x - hcx, cl.s - hcs) < 260;if (bank) bank.group.visible = Math.hypot(ctx.camera.position.x - bank.at(bank.W / 2, 4).x, ctx.camera.position.z - bank.at(bank.W / 2, 4).z) < 220;
      // The weapon, the sights, the HUD.
      const scoped = armedNow && g.w.scope && g.aimT > .8;zoomNow = armedNow ? 1 + (g.w.zoom - 1) * g.aimT : 1;
      viewmodel(dt, g, armedNow);
      const cr = $('ar-cross');cr.hidden = !(armedNow && !scoped && g.aimT < .6 || (armedNow && g.w.melee));
      if (!cr.hidden) cr.style.setProperty('--gap', `${Math.round(5 + W.spreadOf(g.w, {aim: g.aimT, moving: Math.min(1, speed / 5), stance: pl.stance, heat: g.heat}) / DEG * 5)}px`);
      $('ar-scope').hidden = !scoped;
      const hitT = Math.max(rules.hitT, ops.hitT);$('ar-hit').style.opacity = hitT > 0 ? '1' : '0';
      const dmgT = inOp ? ops.dmgT : rules.dmgT, from = inOp ? ops.dmgFrom : rules.dmgFrom, hp = inOp ? ops.hp : rules.inGame() ? rules.hp : 100;
      $('ar-dmg').style.opacity = String(Math.min(1, dmgT * .9 + (hp <= 30 ? .3 : 0) + (rules.inGame() && !rules.alive ? .7 : 0)));
      const dir = $('ar-dir');if (from && dmgT > 0) {const f = ctx.camera.getWorldDirection(tA), vx = from.x - pl.x, vz = from.z - pl.z, ang = Math.atan2(vx * -f.z + vz * f.x, vx * f.x + vz * f.z);dir.style.transform = `translate(-50%, -50%) rotate(${ang}rad) translateY(-120px)`;dir.style.opacity = String(Math.min(1, dmgT));} else dir.style.opacity = '0';
      if ((hudT -= dt) <= 0) {hudT = .1;drawHud(g, armedNow);}
    }
    function prompt() {
      const pl = P();if (pl.mode !== 'foot' || menu.open) return null;
      const op = ops.prompt();if (op) return op;
      if (!inHouse(pl.x, pl.z, pl.feet)) return null;
      const near = k => Math.hypot(pl.x - station[k].x, pl.z - station[k].z);
      if (near('missions') < 2.4) return {text: '□ The mission board', act: () => menu.show('missions')};
      if (near('camo') < 2.2) return {text: '□ Camouflage clothes', act: () => menu.show('camo')};
      const l = world.toLocal(pl.x, pl.z);if (l.s > hs1 - TH - 4.2 && l.x > hx0 + 1.5 && l.x < hx0 + 19.5) return {text: '□ Choose your weapons', act: () => menu.show('weapons')};
      return null;
    }
    const poi = () => [{x: hcx, s: hcs, color: '#16191d', label: 'Arsenalet (weapons, missions)', glyph: '⚔'}, {x: ax0 + A.w / 2, s: as0 + A.d / 2, color: '#7a1c14', label: 'The arena', glyph: '✚'},
      ...(BANK ? [{x: data.bank.front[0], s: data.bank.front[1], color: '#12303a', label: 'Torshov Sparebank', glyph: '🏦'}] : [])];
    return {group: G, floors, obstacles, hitboxes: [], poi, ctx, rules, ops, menu, update, prompt, home, bank, solids: () => ops.solids(), localState: () => rules.localState(), opState: () => ops.opState(),
      get armed() {return armedNow;}, get busy() {return armedNow || !!menu.open || (rules.member && rules.onPad && P().mode === 'foot');}, get frozen() {return rules.frozen() || !!menu.open || (rules.inGame() && !rules.alive) || ops.down;},
      get zoom() {return zoomNow;}, get viewVisible() {return vm.visible;}, get music() {return !!ops.cur || rules.inGame();}, get slow() {const g = ops.gun() || rules.gun;return armedNow && g ? g.w.move * (1 - .35 * g.aimT) : 1;},
      holdsGun: id => (rules.member && rules.all.some(m => m.id === id && !m.local)) || !!ops.mate(id), showTag: id => !rules.memberPlaying(id) || !rules.inGame() || (rules.ses.mode === 'tdm' && rules.team(id) === rules.team(rules.you())),
      inHouse, debug: {targets, save, station, get practice() {return practice;}, F, start: (id, side) => ops.start(window.GameArsenalOps.MISSIONS.find(m => m.id === id && m.side === side)), join: id => ops.join(id)}};
  }
  return {prepare, holes, create, KEY};
});
