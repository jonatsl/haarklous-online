/* Rathkes gate 1 (issues #44, #72): the second place you can go besides Haarklous plass 17A – flat 501 on the 5th floor of
 * stair 1C, reached through the gate and the backyard (bakgården): the wrought-iron gate with the "1" over it at the east end of
 * the façade on Rathkes gate (as on Google Street View), the passage under the building, the backyard, the stair doors 1B and
 * 1C, and behind 1C the stair and the flat from the user's video (game-rathkes-501.js with rathkes-501-data.js).
 * The building is OSM way 113875904 (18.2 m, brick, in the Gamle Oslo patch). prepare(districts) replaces it with its two
 * parts either side of the passage and cuts out the part the flat model draws itself (so the other walls, collision and maps
 * stay the patch's own; every piece keeps the building's roof height), and create() adds the storeys over the passage, the gate
 * (a normal game door: □ opens it, shared online), the doors, the signs and the flat.
 * GameRathkes.split(ring, a, b, width) (pure, Node-tested) cuts a ring with a straight passage from a to b.
 * GameRathkes.prepare(districts, heightOf) -> number of buildings replaced; GameRathkes.create({T, lib, world}) -> {group, doors,
 *   hitboxes, floors, obstacles, prompt(look), poi(), inside(x, z, feet), lampAt(x, z, feet), placeName(x, z, feet), tick(camera),
 *   far, flat, data}; GameRathkes.mapBuildings() -> the flat's part for the map.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRathkes = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // Facts (local metres east / south of Haarklous plass 17A). OSM: building way 113875904, address nodes 2790201253 (1A),
  // 2790201266 (1B), 2790201275 (1C). Street View (Nov 2026): the gate is the iron gate under the "1" at the façade's east end.
  const DATA = {
    osm: 'w113875904', height: 18.2, storeys: 5, flatFloor: 5,
    facade: {east: [-835.1, 1781.6], west: [-853.8, 1791.8]},
    passage: {from: [-838.15, 1783.25], to: [-831.9, 1794.7], width: 2.9, height: 3.6},
    address: {'1A': [-837.1, 1788.2], '1B': [-842.3, 1797.2], '1C': [-838.5, 1804.3]},
    yard: [[-834.6, 1795.7], [-829.5, 1790.8], [-828.6, 1792.4], [-823.5, 1789.2], [-821.4, 1792.9], [-819.5, 1796.9], [-828.9, 1801.9], [-826.4, 1806.4], [-833.7, 1810.4], [-836.1, 1806.3], [-835.7, 1805.9], [-837.8, 1802.3], [-836.5, 1801.5], [-837.8, 1799.3], [-839.1, 1800.2], [-840.9, 1797.2], [-835.6, 1794]]
  };

  // ---------- Pure geometry: cut a ring with a straight passage ----------
  // Sutherland–Hodgman against one half-plane: keep points with (p - o)·n >= 0.
  function clipHalf(ring, o, n) {
    const out = [], f = p => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {const t = fa / (fa - fb);out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);}
    }
    return out;
  }
  // The two parts of `ring` either side of a passage of `width` along the line a -> b (each part may be empty).
  function split(ring, a, b, width) {
    const dx = b[0] - a[0], ds = b[1] - a[1], l = Math.hypot(dx, ds), n = [-ds / l, dx / l], h = width / 2;
    const left = clipHalf(ring, [a[0] + n[0] * h, a[1] + n[1] * h], n), right = clipHalf(ring, [a[0] - n[0] * h, a[1] - n[1] * h], [-n[0], -n[1]]);
    const area = r => Math.abs(r.reduce((s, p, i) => {const q = r[(i + 1) % r.length];return s + p[0] * q[1] - q[0] * p[1];}, 0) / 2);
    return [left, right].filter(r => r.length >= 3 && area(r) > 1);
  }
  const centroid = r => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);
  const flatApi = () => (typeof window !== 'undefined' && window.GameRathkes501) || (typeof module === 'object' && (() => {try {return require('./game-rathkes-501.js');} catch (e) {return null;}})());
  const flatData = () => (typeof window !== 'undefined' && window.RATHKES_501) || (typeof module === 'object' && (() => {try {return require('./rathkes-501-data.js');} catch (e) {return null;}})());
  // heightOf(d, x, s) -> ground height of the patch (District.height); with it every piece keeps the building's own roof height.
  function prepare(districts, heightOf) {
    let n = 0;
    const F = flatApi(), FD = flatData();
    for (const d of districts || []) {
      if (!d || !Array.isArray(d.buildings)) continue;
      const i = d.buildings.findIndex(b => b.id === DATA.osm);if (i < 0) continue;
      const b = d.buildings[i], passage = split(b.ring, DATA.passage.from, DATA.passage.to, DATA.passage.width);
      DATA.height = b.h || DATA.height;
      const parts = F && FD ? passage.flatMap(r => F.cut(r, FD)) : passage, g = heightOf ? (x, s) => heightOf(d, x, s) : null, top = g ? g(...centroid(b.ring)) + b.h : 0;
      DATA.parts = parts.map((ring, k) => ({...b, id: `${DATA.osm}-${k}`, ring, hip: null, h: g ? top - g(...centroid(ring)) : b.h}));
      d.buildings.splice(i, 1, ...DATA.parts);
      n++;
    }
    return n;
  }
  // The flat's part of the building for the map (the patch no longer has it).
  function mapBuildings() {const F = flatApi(), FD = flatData();if (!F || !FD || !DATA.parts) return [];const fr = F.frame(FD);return [{r: {o: FD.outline.flatMap(([a, b]) => fr.toLocal(a, b))}, s: 'brick'}];}

  // ---------- Browser ----------
  function create({T, lib, world}) {
    const group = new T.Group();group.name = 'Rathkes gate 1';
    const W = (x, s) => world.toWorld(x, s), yAt = (x, s) => {const w = W(x, s);return world.heightWorld(w.x, w.z);};
    const P = DATA.passage, dx = P.to[0] - P.from[0], ds = P.to[1] - P.from[1], L = Math.hypot(dx, ds), ux = dx / L, us = ds / L, nx = -us, ns = ux;
    const street = yAt(...P.from);
    // The storeys over the passage (the part the split left open to the sky).
    const plaster = lib.plaster(0x8f9091), brickM = lib.brick(), iron = lib.metal(0x1b1c1e, .5);
    const local = new T.Group(), D = window.SURROUNDINGS;local.rotation.y = D.geo.theta;local.position.set(D.geo.x, 0, D.geo.z);group.add(local);
    {
      const cx = P.from[0] + dx / 2, cs = P.from[1] + ds / 2, top = DATA.height;
      const over = new T.Mesh(new T.BoxGeometry(P.width + .2, top - P.height, L), brickM);lib.boxUV(over);// texture in metres, not stretchedover.position.set(cx, street + P.height + (top - P.height) / 2, cs);over.rotation.y = Math.atan2(ux, us);over.castShadow = over.receiveShadow = true;local.add(over);
      const ceil = new T.Mesh(new T.PlaneGeometry(P.width + .2, L), plaster);ceil.rotation.order = 'YXZ';ceil.rotation.set(Math.PI / 2, Math.atan2(ux, us), 0);ceil.position.set(cx, street + P.height - .01, cs);local.add(ceil);
    }
    // The gate: two wrought-iron leaves in the opening on the street (a game door: □ opens it).
    const doors = [], hitboxes = [];
    const gx = P.from[0] + ux * .25, gs = P.from[1] + us * .25, gw = P.width - .2, gh = 3.0;
    // The gate's frame: local +x across the opening (along the façade), local +z out toward the street.
    const frame = new T.Group();frame.position.set(gx, street, gs);frame.rotation.y = Math.atan2(-ns, nx);local.add(frame);
    const bars = (w, h) => {const g = new T.Group();for (let i = 0; i <= Math.round(w / .12); i++) {const b = new T.Mesh(new T.BoxGeometry(.02, h, .02), iron);b.position.set(i * w / Math.round(w / .12), h / 2, 0);g.add(b);}for (const y of [.1, h * .45, h - .1]) {const r = new T.Mesh(new T.BoxGeometry(w, .04, .03), iron);r.position.set(w / 2, y, 0);g.add(r);}return g;};
    const leafW = gw / 2;
    for (const side of [-1, 1]) {
      const hinge = new T.Group();hinge.position.set(side * gw / 2, 0, 0);frame.add(hinge);
      const leafGroup = bars(leafW, gh);leafGroup.position.x = side < 0 ? 0 : -leafW;hinge.add(leafGroup);
      // An invisible solid board for the door system (collision and the look target).
      const leaf = new T.Mesh(new T.BoxGeometry(leafW, gh, .06), new T.MeshBasicMaterial({visible: false}));leaf.position.set((side < 0 ? 1 : -1) * leafW / 2, gh / 2, 0);hinge.add(leaf);
      // Not a plain door target: one press opens both leaves (prompt() below); each leaf is still a game door (shared online).
      const id = 'rathkes-gate-' + (side < 0 ? 'w' : 'e');leaf.userData.rathkesGate = true;hitboxes.push(leaf);
      doors.push({id, name: 'Gate to the backyard', hinge, leaf, open: false, openAngle: -side * 1.55, motion: 'swing'});// opens inward
    }
    // "1" over the gate, and the street sign on the façade.
    const sign = (text, w, h, bg, fg, font) => {
      const c = document.createElement('canvas');c.width = 256;c.height = Math.round(256 * h / w);const g = c.getContext('2d');g.fillStyle = bg;g.fillRect(0, 0, c.width, c.height);g.fillStyle = fg;g.font = font;g.textAlign = 'center';g.textBaseline = 'middle';g.fillText(text, c.width / 2, c.height / 2 + 4);
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({map: t, roughness: .6}));
    };
    const one = sign('1', .35, .35, '#1f3b6e', '#fff', 'bold 200px Segoe UI, Arial');one.position.set(0, gh + .35, .25);frame.add(one);
    const plate = sign('RATHKES GATE', .9, .22, '#1f3b6e', '#fff', 'bold 40px Segoe UI, Arial');plate.position.set(gw / 2 + .9, 3.2, .3);frame.add(plate);
    // Stair doors in the backyard: 1B (locked: someone lives there) and 1C (the stair to flat 501, built by game-rathkes-501.js).
    const wood = lib.wood(0x5b3a24, .6), glassM = new T.MeshStandardMaterial({color: 0x24323b, roughness: .1, metalness: .3});
    const ring = DATA.yard, F = flatApi(), FD = flatData();
    function doorAt(key) {
      const p = DATA.address[key];let best = null;
      if (F && FD && key === '1B') {
        // 1B is on the corner's face toward the yard (the flat model stands where the nearest yard edge used to be).
        const fr = F.frame(FD), q = fr.toLocal(FD.cut.a - .02, 12.4), e = fr.toLocal(FD.cut.a - .02, 13.4);best = {q, ex: e[0] - q[0], es: e[1] - q[1], l: 1};
      } else for (let i = 0; i < ring.length; i++) {const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], es = b[1] - a[1], l2 = ex * ex + es * es, t = Math.max(.15, Math.min(.85, ((p[0] - a[0]) * ex + (p[1] - a[1]) * es) / l2)), q = [a[0] + ex * t, a[1] + es * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);if (!best || d < best.d) best = {d, q, ex, es, l: Math.sqrt(l2)};}
      // Face the door into the yard (toward its centre), its local +z along that normal.
      const {q, ex, es, l} = best, y = yAt(...q), cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cs = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      let fx = -es / l, fs = ex / l;if (fx * (cx - q[0]) + fs * (cs - q[1]) < 0) {fx = -fx;fs = -fs;}
      const g = new T.Group();g.position.set(q[0], y, q[1]);g.rotation.y = Math.atan2(fx, fs);local.add(g);const face = g;
      const leaf = new T.Mesh(new T.BoxGeometry(1.1, 2.3, .06), wood);leaf.position.set(0, 1.15, .04);leaf.castShadow = true;face.add(leaf);
      const win = new T.Mesh(new T.PlaneGeometry(.6, .8), glassM);win.position.set(0, 1.55, .075);face.add(win);
      const label = sign(key, .3, .3, '#f4f1e8', '#1d1d1d', 'bold 150px Georgia');label.position.set(.85, 1.9, .03);face.add(label);
      if (key === '1C') {const s = sign('5. etg · kommer', .9, .25, '#1f3b6e', '#fff', 'bold 34px Segoe UI, Arial');s.position.set(0, 2.55, .03);face.add(s);}
      leaf.userData.rathkes = key;hitboxes.push(leaf);
      const w = W(q[0], q[1]);return {key, x: w.x, z: w.z, y};
    }
    // Flat 501 and stair 1C (issue #72). Without the model the old 1C door with its "coming" sign stays.
    let flat = null;
    if (F && FD && DATA.parts) {
      const tops = DATA.parts.map(b => b.top).filter(Number.isFinite);
      flat = F.build({T, lib, world, data: FD, top: tops.length ? Math.max(...tops) : null});
      group.add(flat.group);doors.push(...flat.doors);hitboxes.push(...flat.hitboxes);
      if (world.far && flat.far) world.far.add(flat.far);
    }
    const stairDoors = (flat ? ['1B'] : ['1B', '1C']).map(doorAt);
    function prompt(look) {
      if (look && look.userData && look.userData.rathkesGate) {const open = doors.some(d => d.id.startsWith('rathkes-gate') && d.open);return {text: `□ ${open ? 'Close' : 'Open'} the gate to the backyard`, act: () => ({doors: doors.filter(d => d.id.startsWith('rathkes-gate') && d.open === open).map(d => d.id)})};}
      const k = look && look.userData && look.userData.rathkes;
      if (k === '1C') return {text: '□ Rathkes gate 1C', act: () => ({notice: 'Rathkes gate 1C · the stairs to the flat on the 5th floor open when the photos of the backyard and the flat arrive.'})};
      if (k === '1B') return {text: '□ Try the door (1B)', act: () => ({notice: 'Locked. Someone lives here.', sound: 'locked'})};
      return null;
    }
    const at1C = flat ? world.toLocal(flat.yardDoor.x, flat.yardDoor.z) : {x: DATA.address['1C'][0], s: DATA.address['1C'][1]};
    const poi = () => [{x: at1C.x, s: at1C.s, color: '#1f3b6e', label: flat ? 'Rathkes gate 1C · flat 501' : 'Rathkes gate 1C', glyph: '⌂'}];
    const none = () => null;
    return {group, doors, hitboxes, prompt, poi, data: DATA, stairDoors, gate: W(...P.from), flat,
      floors: flat ? flat.floors : [], obstacles: flat ? flat.obstacles : [],
      inside: flat ? flat.inside : none, lampAt: flat ? flat.lampAt : none, placeName: flat ? flat.placeName : none, tick: flat ? flat.tick : () => {}};
  }

  return {DATA, split, clipHalf, prepare, create, mapBuildings};
});
