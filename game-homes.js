/* Flats you can buy (issue #106). Behind the flat doors of the eight neighbouring stair towers are real flats: a hall, a
 * bathroom, one or two bedrooms and a living room with a kitchen, with windows to the street and to the courtyard. Each flat
 * is its own place (its building, floor, side, size and finishes) and has one owner at most; the server keeps the list of
 * owners (cloud/src/homes.js). Only the owner unlocks the door; a flat that is for sale is open for a look.
 *
 * The flats lie inside the buildings' solid outlines: the walk world hollows them out (`voids`, walk-collision.js), and from
 * inside you look out through the building's outer wall because it is only drawn from the outside.
 *
 * Flat frame: u = metres from the stair tower's side wall into the flat, v = the tower's z (from the back toward the facade).
 * Tower x = wall + side × u, where wall is the tower wall's outer face (-1.45 left, 1.665 right; stairwell.js).
 *
 * Pure (Node-tested):
 *   plan(home) -> {hw, rooms [{id, name, u0, u1, v0, v1, lamp {u, v}}], walls [{u0, u1, v0, v1, axis, gaps [[a0, a1]]}],
 *                  windows [{wall: 'front'|'back', a0, a1}], furniture [{name, u0, u1, v0, v1, y0, y1, mat, solid}], floor {u0, u1, v0, v1}}
 *   pieces(wall) -> the wall's solid parts [{u0, u1, v0, v1}] (between its doorways)
 *   solids(home) -> {floor, voids [..], blocks [{r, y0, y1}]}   rectangles [x0, z0, x1, z1] in tower coordinates, for the walk world
 *   toTower(home, u, v) -> {x, z}      levelY(n)      label(home) / floorName(n)      money(kr)
 *   status(id, reg) -> 'mine' | 'taken' | 'sale'   (reg = {owners {id: name}, mine: id | null})
 *   canBuy({home, reg, money, user, online}) -> '' or why not      refund(home) -> kr you get back when you sell
 * GameHomes.create({T, lib, homes, towers [{stair, matrix, inverse}] (in SURROUNDINGS.enterable order), xf}) ->
 *   {group, hitboxes (the door plates, userData.homePlate = id), floors, obstacles, voids(t) (world coordinates), byId,
 *    inside(x, z, feet) -> {home, room, u, v} | null, lampAt(x, z, feet), tick(player, dt), setRegistry(reg), doorOf(id),
 *    doorWorld(id), hallSpot(id)}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameHomes = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // The stair tower's measures (stairwell.js; a Node test checks they are the same).
  const XL = -1.45, XA = 1.665, STOREY = 2.85, TOP = 4, DOOR = {z0: 5.399, z1: 6.249}, DOOR_H = 2.1;
  const CEIL = 2.6, LIN = .05, TH = .1, HEAD = 2.05, OUTER = .28, SILL = .85, WIN_HEAD = 2.25, SELL_BACK = .8;
  const levelY = n => (n - TOP) * STOREY;
  const toTower = (h, u, v) => ({x: (h.side < 0 ? XL : XA) + h.side * u, z: v});
  const hash = s => {let k = 2166136261;for (let i = 0; i < s.length; i++) {k ^= s.charCodeAt(i);k = Math.imul(k, 16777619);}return k >>> 0;};
  const money = kr => `${String(Math.round(kr)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} kr`;
  const floorName = n => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} floor`;
  const label = h => `${h.rooms}-room flat, ${h.area} m², ${floorName(h.n)}`;
  const address = h => `${h.street}, stair ${h.stair}, ${h.unit}`;

  function plan(h) {
    const W = h.W, vb = h.vb, vf = h.vf, hw = W < 4.6 ? 1.55 : 1.8, three = h.rooms >= 3;
    const um = three ? hw + TH + (W - hw - TH) / 2 - TH / 2 : W;// the wall between the two bedrooms
    const mid = (a, b) => (a + b) / 2;
    const rooms = [
      {id: 'hall', name: 'Hall', u0: LIN, u1: hw, v0: 3.7, v1: 7.0},
      {id: 'bath', name: 'Bathroom', u0: LIN, u1: hw, v0: 1.2, v1: 3.6},
      // The bedroom also has the corner behind the bathroom (the wardrobe stands there).
      {id: 'bed1', name: 'Bedroom', u0: hw + TH, u1: um, v0: vb, v1: 4.9, more: {u0: LIN, u1: hw + TH, v0: vb, v1: 1.1}},
      ...(three ? [{id: 'bed2', name: 'Small bedroom', u0: um + TH, u1: W, v0: vb, v1: 4.9}] : []),
      // The living room: the whole street side, and the kitchen beside the hall.
      {id: 'living', name: 'Living room', u0: LIN, u1: W, v0: 7.1, v1: vf, more: {u0: hw + TH, u1: W, v0: 5.0, v1: 7.1}}
    ];
    for (const r of rooms) r.lamp = {u: mid(r.u0, r.u1), v: mid(r.v0, r.v1)};
    const doorA = hw < 1.7 ? [.4, 1.2] : [.5, 1.3];
    const walls = [
      {name: 'bath / hall', u0: LIN, u1: hw, v0: 3.6, v1: 3.7, axis: 'u', gaps: [doorA]},
      {name: 'bath back', u0: LIN, u1: hw + TH, v0: 1.1, v1: 1.2, axis: 'u', gaps: []},
      {name: 'hall / bedroom', u0: hw, u1: hw + TH, v0: 1.2, v1: 7.0, axis: 'v', gaps: [[3.9, 4.7]]},
      {name: 'bedroom / living', u0: hw + TH, u1: W, v0: 4.9, v1: 5.0, axis: 'u', gaps: three ? [[um + TH + .25, um + TH + 1.05]] : []},
      {name: 'hall / living', u0: LIN, u1: hw + TH, v0: 7.0, v1: 7.1, axis: 'u', gaps: [[.4, hw - .25]]},
      ...(three ? [{name: 'between the bedrooms', u0: um, u1: um + TH, v0: vb, v1: 4.9, axis: 'v', gaps: []}] : [])
    ];
    // Windows: two or three to the street, one in each bedroom to the courtyard.
    const windows = [], nf = W >= 6.4 ? 3 : 2;
    for (let k = 0; k < nf; k++) {const c = LIN + (W - LIN) * (k + .5) / nf;windows.push({wall: 'front', a0: c - .62, a1: c + .62});}
    for (const r of rooms.filter(r => r.id.startsWith('bed'))) {const w = Math.min(1.2, r.u1 - r.u0 - .6) / 2, c = mid(r.u0, r.u1);windows.push({wall: 'back', a0: c - w, a1: c + w});}

    // Furniture: plain boxes. solid = you cannot walk through it.
    const F = [], add = (name, u0, u1, v0, v1, y0, y1, mat, solid = false) => F.push({name, u0, u1, v0, v1, y0, y1, mat, solid});
    // Hall: a shoe shelf and a hat shelf on the bedroom wall.
    add('shoe shelf', hw - .32, hw - .02, 5.5, 6.7, 0, .45, 'wood', true);add('hat shelf', hw - .26, hw - .02, 5.5, 6.7, 1.65, 1.69, 'wood');
    // Bathroom: shower at the far end, then the toilet and the basin along the stair-side wall (the other side stays free to walk).
    add('shower tray', LIN + .02, hw - .02, 1.22, 2.1, 0, .05, 'white');add('shower screen', LIN + .02, LIN + .95, 2.1, 2.112, .05, 1.95, 'glass', true);
    add('cistern', LIN + .02, LIN + .2, 2.28, 2.68, 0, .85, 'white', true);add('toilet', LIN + .2, LIN + .7, 2.3, 2.66, 0, .4, 'white', true);
    add('basin cabinet', LIN + .02, LIN + .47, 2.95, 3.5, .3, .8, 'front', true);add('basin', LIN + .04, LIN + .45, 2.97, 3.48, .8, .86, 'white');add('mirror', LIN + .02, LIN + .035, 3.0, 3.45, 1.15, 1.8, 'mirror');
    // Bedroom: the bed against the far wall with its head to the living-room wall, the wardrobe in the corner behind the bathroom.
    {
      const r = rooms[2], w = r.u1 - r.u0, bw = w >= 3 ? 1.6 : w >= 2.45 ? 1.2 : .9, b1 = r.u1 - .03, b0 = b1 - bw;
      add('bed', b0, b1, 2.8, 4.85, 0, .3, 'wood', true);add('mattress', b0 + .02, b1 - .02, 2.82, 4.83, .3, .5, 'linen');add('duvet', b0 + .01, b1 - .01, 2.81, 4.25, .5, .57, 'accent');
      for (let k = 0; k < (bw > 1.3 ? 2 : 1); k++) {const pw = (bw - .12) / (bw > 1.3 ? 2 : 1);add('pillow', b0 + .06 + k * pw, b0 + .02 + (k + 1) * pw, 4.36, 4.8, .5, .62, 'linen');}
      if (w >= bw + 1.45) add('bedside table', b0 - .5, b0 - .08, 4.4, 4.85, 0, .5, 'wood', true);
      add('wardrobe', LIN + .04, hw + TH - .15, vb + .04, vb + .64, 0, 2.1, 'front', true);
    }
    if (three) {
      const r = rooms[3];
      add('bed', r.u1 - .93, r.u1 - .03, vb + .1, vb + 2.1, 0, .3, 'wood', true);add('mattress', r.u1 - .91, r.u1 - .05, vb + .12, vb + 2.08, .3, .5, 'linen');add('duvet', r.u1 - .92, r.u1 - .04, vb + .6, vb + 2.09, .5, .57, 'accent2');add('pillow', r.u1 - .85, r.u1 - .11, vb + .14, vb + .56, .5, .62, 'linen');
      add('desk', r.u0 + .05, r.u0 + .65, vb + 2.6, vb + 3.8, .7, .74, 'wood');add('desk side', r.u0 + .05, r.u0 + .65, vb + 2.6, vb + 2.64, 0, .7, 'wood');add('desk side', r.u0 + .05, r.u0 + .65, vb + 3.76, vb + 3.8, 0, .7, 'wood');
      add('desk footprint', r.u0 + .05, r.u0 + .65, vb + 2.6, vb + 3.8, 0, .74, null, true);add('chair', r.u0 + .75, r.u0 + 1.17, vb + 3.0, vb + 3.42, 0, .45, 'accent2', true);add('chair back', r.u0 + 1.13, r.u0 + 1.17, vb + 3.0, vb + 3.42, .45, .9, 'accent2');
    }
    // Kitchen along the bedroom wall: cupboards, worktop, sink, hob, wall cupboards and a tall fridge at the far end.
    {
      const k0 = hw + TH + .04, k1 = three ? um + TH + .15 : W - .03, f0 = k1 - .6;
      add('kitchen plinth', k0, f0, 5.08, 5.6, 0, .1, 'dark');add('kitchen cupboards', k0, f0, 5.02, 5.62, .1, .88, 'front', false);add('worktop', k0, f0, 5.02, 5.65, .88, .92, 'worktop');
      add('kitchen footprint', k0, k1, 5.02, 5.65, 0, 1.9, null, true);
      add('wall cupboards', k0, f0, 5.02, 5.37, 1.45, 2.15, 'front');add('fridge', f0, k1, 5.02, 5.64, 0, 1.9, 'steel');
      const kw = f0 - k0;if (kw > 1.5) {add('sink', k0 + .25, k0 + .75, 5.14, 5.54, .92, .928, 'steel');add('hob', f0 - .75, f0 - .17, 5.1, 5.56, .92, .927, 'dark');}
      // Dining table where the kitchen meets the living room.
      const room = W - hw - TH, tw = room >= 2.6 ? 1.2 : .75, c = hw + TH + room / 2 + (three ? -.3 : 0), t0 = c - tw / 2, t1 = c + tw / 2;
      add('table top', t0, t1, 6.55, 7.3, .72, .76, 'wood');add('table footprint', t0, t1, 6.55, 7.3, 0, .76, null, true);
      for (const [a, b] of [[t0 + .04, 6.59], [t1 - .1, 6.59], [t0 + .04, 7.2], [t1 - .1, 7.2]]) add('table leg', a, a + .06, b, b + .06, 0, .72, 'wood');
      if (room >= 2.6) for (const s of [-1, 1]) {const a = s < 0 ? t0 - .5 : t1 + .08;add('chair', a, a + .42, 6.72, 7.14, 0, .45, 'accent2', true);add('chair back', s < 0 ? a : a + .38, s < 0 ? a + .04 : a + .42, 6.72, 7.14, .45, .9, 'accent2');}
    }
    // Living room: the sofa against the far wall facing the TV on the stair-side wall, a coffee table and a rug between.
    {
      const s1 = W - .04, s0 = s1 - .92;
      add('sofa', s0, s1, 7.9, 9.9, 0, .42, 'accent', true);add('sofa back', s1 - .22, s1, 7.9, 9.9, .42, .84, 'accent');add('sofa arm', s0, s1, 7.9, 8.08, .42, .62, 'accent');add('sofa arm', s0, s1, 9.72, 9.9, .42, .62, 'accent');
      add('TV bench', LIN + .02, LIN + .45, 8.1, 9.7, 0, .45, 'wood', true);add('TV', LIN + .16, LIN + .2, 8.3, 9.5, .55, 1.25, 'dark');
      if (W >= 4.4) {add('coffee table', s0 - .85, s0 - .35, 8.4, 9.4, .36, .4, 'wood');add('coffee table footprint', s0 - .85, s0 - .35, 8.4, 9.4, 0, .4, null, true);for (const v of [8.42, 9.34]) add('coffee table leg', s0 - .83, s0 - .37, v, v + .04, 0, .36, 'wood');}
      add('rug', Math.max(LIN + .6, s0 - 1.7), s0 + .1, 8.05, 9.75, 0, .012, 'rug');
    }
    return {hw, three, um, rooms, walls, windows, furniture: F, floor: {u0: 0, u1: W, v0: vb, v1: vf}};
  }
  // A partition wall's solid parts (between its doorways).
  function pieces(w) {
    const out = [], lo = w.axis === 'u' ? w.u0 : w.v0, hi = w.axis === 'u' ? w.u1 : w.v1;let a = lo;
    const part = (p, q) => {if (q - p > 1e-6) out.push(w.axis === 'u' ? {u0: p, u1: q, v0: w.v0, v1: w.v1} : {u0: w.u0, u1: w.u1, v0: p, v1: q});};
    for (const [g0, g1] of [...w.gaps].sort((x, y) => x[0] - y[0])) {part(a, g0);a = g1;}
    part(a, hi);return out;
  }
  // What the walk world needs of a flat, in tower coordinates (y from the flat's floor): the floor, the rooms hollowed out of
  // the building (the flat and its doorway), and the solid things (inner walls, furniture). Rectangles [x0, z0, x1, z1].
  function solids(h, P = plan(h)) {
    const wall = h.side < 0 ? XL : XA, R = (u0, u1, v0, v1) => {const a = wall + h.side * u0, b = wall + h.side * u1;return [Math.min(a, b), v0, Math.max(a, b), v1];};
    const blocks = [];
    for (const w of P.walls) for (const p of pieces(w)) blocks.push({r: R(p.u0, p.u1, p.v0, p.v1), y0: -.1, y1: CEIL});
    for (const f of P.furniture) if (f.solid) blocks.push({r: R(f.u0, f.u1, f.v0, f.v1), y0: f.y0, y1: f.y1});
    // The doorway is hollowed out too: in it you are within arm's reach of the building's outline (the edge of the tower's notch).
    return {floor: R(0, h.W, h.vb, h.vf), voids: [R(-.02, h.W + .02, h.vb - .02, h.vf + .02), R(-.3, .1, DOOR.z0, DOOR.z1)], blocks};
  }
  const roomAt = (P, u, v) => P.rooms.find(r => (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) || (r.more && u >= r.more.u0 && u <= r.more.u1 && v >= r.more.v0 && v <= r.more.v1)) || null;

  // ---------- Who owns what ----------
  const status = (id, reg) => reg && reg.mine === id ? 'mine' : reg && reg.owners && reg.owners[id] !== undefined ? 'taken' : 'sale';
  const refund = h => Math.round(h.price * SELL_BACK / 100) * 100;
  function canBuy({home, reg, money: kr, user, online}) {
    if (!online) return 'Buying a flat needs the online game – it keeps the list of who owns what.';
    if (!user) return 'Log in first (pause menu → Account): a flat belongs to your account.';
    const st = status(home.id, reg);
    if (st === 'mine') return 'This flat is yours already.';
    if (st === 'taken') return `${reg.owners[home.id] || 'Somebody'} owns this flat.`;
    if (reg && reg.mine) return 'You own a flat already – sell it first (at its door).';
    if (!(kr >= home.price)) return `You need ${money(home.price)} – you have ${money(kr || 0)}.`;
    return '';
  }

  // ---------- The game's part ----------
  const WALLS = [0xe6e1d6, 0xdbd2bb, 0xcbd9cf, 0xd9cddb, 0xc8d6e0, 0xe3d2b6], ACCENTS = [0x44617a, 0x7a4b3a, 0x4e6b4f, 0x6b5a7d, 0x8a6a2f, 0x37474f];
  const FRONTS = [0xf4f3ef, 0x8fa58d, 0x2f3e55, 0xb48a5a, 0xd8d2c4], FLOORS = [0xffffff, 0xe2cfae, 0xb79a78];
  function create({T, lib, homes, towers, xf}) {
    const byId = new Map(homes.map(h => [h.id, h])), plans = new Map(homes.map(h => [h.id, plan(h)]));
    const wallX = (h, u) => (h.side < 0 ? XL : XA) + h.side * u;
    const world = (t, [x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => xf(t.matrix, x, z));
    const floors = [], obstacles = [], voidList = towers.map(() => []), doors = new Map();
    for (const h of homes) {
      const t = towers[h.t], dy = t.matrix.elements[13], y = levelY(h.n) + dy, P = plans.get(h.id);
      const S = solids(h, P);
      floors.push({name: `Flat ${h.id}`, points: world(t, S.floor), y, ceilingHeight: CEIL, surfaceKind: 'wood', home: h.id});
      for (const v of S.voids) voidList[h.t].push({points: world(t, v), minY: y - .05, maxY: y + CEIL});
      for (const k of S.blocks) obstacles.push({points: world(t, k.r), minY: y + k.y0, maxY: y + k.y1, kind: 'home'});
    }
    towers.forEach(t => (t.stair.homeDoors || []).forEach(d => doors.set(d.home, {...d, tower: t})));
    const local = (t, x, z) => {const e = t.inverse.elements;return {x: e[0] * x + e[8] * z + e[12], z: e[2] * x + e[10] * z + e[14]};};
    // Which flat is (x, z, feet) in?
    function inside(x, z, feet) {
      for (let i = 0; i < towers.length; i++) {
        const t = towers[i], l = local(t, x, z);if (l.x < -9.2 || l.x > 9.4 || l.z < -3 || l.z > 10.4) continue;
        const dy = t.matrix.elements[13];
        for (const h of homes) {
          if (h.t !== i) continue;const u = (l.x - (h.side < 0 ? XL : XA)) * h.side, y = levelY(h.n) + dy;
          if (u >= -.01 && u <= h.W + .01 && l.z >= h.vb - .01 && l.z <= h.vf + .01 && feet > y - .4 && feet < y + 2.2) return {home: h, u, v: l.z, room: roomAt(plans.get(h.id), u, l.z)};
        }
      }
      return null;
    }
    function lampAt(x, z, feet) {
      const at = inside(x, z, feet);if (!at) return null;
      const r = at.room || plans.get(at.home.id).rooms[0], t = towers[at.home.t], p = toTower(at.home, r.lamp.u, r.lamp.v), w = xf(t.matrix, p.x, p.z);
      return {x: w.x, y: levelY(at.home.n) + t.matrix.elements[13] + 2.3, z: w.z, power: r.id === 'living' ? 5 : 3.2, distance: r.id === 'living' ? 11 : 8};
    }

    // ---- What you see: each flat is built when its door opens (or you are in it) and thrown away when you are gone ----
    const groups = towers.map(t => {const g = new T.Group();g.matrixAutoUpdate = false;g.matrix.copy(t.matrix);g.matrixWorldNeedsUpdate = true;g.name = 'Flats';return g;});
    const root = new T.Group();root.name = 'Flats you can buy';groups.forEach(g => root.add(g));
    // Each door plate can be looked at (□): an unseen box where the plate hangs.
    const hitM = new T.MeshBasicMaterial({visible: false}), hitG = new T.BoxGeometry(.1, .26, .4), hitboxes = [];
    for (const [id, d] of doors) {const m = new T.Mesh(hitG, hitM);m.position.set(d.sign.x, d.sign.y, d.sign.z);m.userData.homePlate = id;m.name = `Door plate (look) ${id}`;groups[towers.indexOf(d.tower)].add(m);hitboxes.push(m);}
    const matCache = new Map(), mat = (key, make) => {if (!matCache.has(key)) matCache.set(key, make());return matCache.get(key);};
    function look(h) {
      const k = hash(h.id), wall = WALLS[k % WALLS.length], accent = ACCENTS[(k >>> 3) % ACCENTS.length], accent2 = ACCENTS[(k >>> 6) % ACCENTS.length], front = FRONTS[(k >>> 9) % FRONTS.length], floor = FLOORS[(k >>> 12) % FLOORS.length];
      const lit = (m, e = .12) => {m.emissive = m.color.clone();m.emissiveIntensity = e;if (m.map) m.emissiveMap = m.map;return m;};
      return {
        wall: mat('wall' + wall, () => lit(lib.plaster(wall), .03)), ceiling: mat('ceiling', () => lit(lib.plaster(0xefede6), .05)), trim: mat('trim', () => lit(lib.paint(0xf3f1ea, .4), .04)),
        bathWall: mat('bathWall', () => lit(lib.wallTiles(), .03)),
        floor: mat('floor' + floor, () => {const m = lib.woodFloor();m.color = new T.Color(floor);return lit(m, .03);}), tile: mat('tile', () => lit(lib.paint(0x596168, .5), .03)),
        glass: mat('glass', () => lib.glass()), white: mat('white', () => lit(lib.ceramic(), .03)), wood: mat('wood', () => lit(lib.wood(0x9a7448, .5), .03)),
        linen: mat('linen', () => lit(lib.fabric(0xeeeae0), .03)), accent: mat('a' + accent, () => lit(lib.fabric(accent), .04)), accent2: mat('a' + accent2, () => lit(lib.fabric(accent2), .04)),
        front: mat('f' + front, () => lit(lib.paint(front, .45), .03)), dark: mat('dark', () => lib.paint(0x1b1c1e, .35)), steel: mat('steel', () => lib.metal(0xc9ccce, .35)),
        worktop: mat('worktop', () => lit(lib.wood(0x5b3d26, .4), .06)), mirror: mat('mirror', () => lib.chrome()), rug: mat('r' + accent2, () => lit(lib.fabric(accent2), .06)),
        lamp: mat('lamp', () => new T.MeshStandardMaterial({color: 0xfff6e6, emissive: 0xfff1d6, emissiveIntensity: 1.3, roughness: .3}))
      };
    }
    function build(h) {
      const P = plans.get(h.id), M = look(h), g = new T.Group();g.position.y = levelY(h.n);g.name = `Flat ${h.id}`;
      const box = (u0, u1, v0, v1, y0, y1, m, shadow = true) => {
        const a = wallX(h, u0), b = wallX(h, u1), w = Math.abs(b - a), d = v1 - v0, hh = y1 - y0;if (w <= 1e-4 || d <= 1e-4 || hh <= 1e-4) return null;
        const o = new T.Mesh(new T.BoxGeometry(w, hh, d), m);o.position.set((a + b) / 2, (y0 + y1) / 2, (v0 + v1) / 2);o.castShadow = false;o.receiveShadow = shadow;lib.boxUV(o);g.add(o);return o;
      };
      const W = h.W, vb = h.vb, vf = h.vf;
      // Floor, ceiling, bathroom tiles.
      box(.004, W, vb, vf, -.06, 0, M.floor);box(.004, W, vb, vf, CEIL, CEIL + .06, M.ceiling);box(LIN, P.hw, 1.2, 3.6, 0, .006, M.tile);
      // The four outer walls' inner linings: the stair side with the entrance, the far (party) wall, the street and the courtyard walls with their windows.
      // (The door leaf is a little larger than the doorway and lies in this lining's plane, so the lining stops 3 cm short of it.)
      box(.004, LIN, vb, DOOR.z0 - .06, 0, CEIL, M.wall);box(.004, LIN, DOOR.z1 + .06, vf, 0, CEIL, M.wall);box(.004, LIN, DOOR.z0 - .06, DOOR.z1 + .06, DOOR_H + .06, CEIL, M.wall);
      box(W, W + LIN, vb - OUTER, vf + OUTER, 0, CEIL, M.wall);
      for (const side of ['front', 'back']) {
        const v0 = side === 'front' ? vf : vb - OUTER, v1 = side === 'front' ? vf + OUTER : vb, wins = P.windows.filter(w => w.wall === side).sort((a, b) => a.a0 - b.a0);let a = .004;
        for (const w of wins) {
          box(a, w.a0, v0, v1, 0, CEIL, M.wall);box(w.a0, w.a1, v0, v1, 0, SILL, M.wall);box(w.a0, w.a1, v0, v1, WIN_HEAD, CEIL, M.wall);a = w.a1;
          // Frame, a centre post, the pane, the sill board and a radiator under it.
          const vm = (v0 + v1) / 2, inn = side === 'front' ? v0 : v1, s = side === 'front' ? -1 : 1;
          for (const [p, q] of [[w.a0, w.a0 + .05], [w.a1 - .05, w.a1], [(w.a0 + w.a1) / 2 - .025, (w.a0 + w.a1) / 2 + .025]]) box(p, q, vm - .03, vm + .03, SILL, WIN_HEAD, M.trim);
          box(w.a0, w.a1, vm - .03, vm + .03, SILL, SILL + .05, M.trim);box(w.a0, w.a1, vm - .03, vm + .03, WIN_HEAD - .05, WIN_HEAD, M.trim);
          const pane = box(w.a0 + .05, w.a1 - .05, vm - .005, vm + .005, SILL + .05, WIN_HEAD - .05, M.glass, false);if (pane) pane.userData.noMerge = true;
          box(w.a0 - .04, w.a1 + .04, Math.min(inn, inn + s * .16), Math.max(inn, inn + s * .16), SILL - .03, SILL, M.trim);
          box(w.a0 + .1, w.a1 - .1, Math.min(inn + s * .03, inn + s * .11), Math.max(inn + s * .03, inn + s * .11), .14, .66, M.white);
        }
        box(a, W, v0, v1, 0, CEIL, M.wall);
      }
      // Inner walls with their doorways (a white frame round each).
      for (const w of P.walls) {
        for (const p of pieces(w)) box(p.u0, p.u1, p.v0, p.v1, 0, CEIL, M.wall);
        for (const [g0, g1] of w.gaps) {
          if (w.axis === 'u') {box(g0, g1, w.v0, w.v1, HEAD, CEIL, M.wall);box(g0 - .03, g0 + .03, w.v0 - .012, w.v1 + .012, 0, HEAD, M.trim);box(g1 - .03, g1 + .03, w.v0 - .012, w.v1 + .012, 0, HEAD, M.trim);box(g0 - .03, g1 + .03, w.v0 - .012, w.v1 + .012, HEAD - .04, HEAD + .03, M.trim);}
          else {box(w.u0, w.u1, g0, g1, HEAD, CEIL, M.wall);box(w.u0 - .012, w.u1 + .012, g0 - .03, g0 + .03, 0, HEAD, M.trim);box(w.u0 - .012, w.u1 + .012, g1 - .03, g1 + .03, 0, HEAD, M.trim);box(w.u0 - .012, w.u1 + .012, g0 - .03, g1 + .03, HEAD - .04, HEAD + .03, M.trim);}
        }
      }
      // Bathroom: white tiles on its four walls (2 cm in front of them; the doorway stays open).
      {const b = P.rooms[1], d = P.walls[0].gaps[0];box(b.u0, b.u0 + .02, b.v0, b.v1, .006, CEIL, M.bathWall);box(b.u1 - .02, b.u1, b.v0, b.v1, .006, CEIL, M.bathWall);box(b.u0 + .02, b.u1 - .02, b.v0, b.v0 + .02, .006, CEIL, M.bathWall);
        box(b.u0 + .02, d[0] - .04, b.v1 - .02, b.v1, .006, CEIL, M.bathWall);box(d[1] + .04, b.u1 - .02, b.v1 - .02, b.v1, .006, CEIL, M.bathWall);box(d[0] - .04, d[1] + .04, b.v1 - .02, b.v1, HEAD + .04, CEIL, M.bathWall);}
      for (const f of P.furniture) if (f.mat) {const o = box(f.u0, f.u1, f.v0, f.v1, f.y0, f.y1, M[f.mat], f.mat !== 'glass');if (o && f.mat === 'glass') o.userData.noMerge = true;}
      // A ceiling lamp in every room.
      for (const r of P.rooms) {const p = toTower(h, r.lamp.u, r.lamp.v), o = new T.Mesh(new T.SphereGeometry(.12, 12, 8), M.lamp);o.position.set(p.x, CEIL - .13, p.z);g.add(o);}
      lib.mergeStatic(g);g.traverse(o => {if (o.isMesh) o.castShadow = false;});
      return g;
    }
    // The plate beside each door: the owner's name, or the for-sale notice.
    let reg = {owners: {}, mine: null}, regVersion = 0;
    function plate(h, d) {
      const st = status(h.id, reg), c = document.createElement('canvas');c.width = 384;c.height = 224;const x = c.getContext('2d');
      x.fillStyle = st === 'sale' ? '#1f6f43' : '#a8873a';x.fillRect(0, 0, 384, 224);x.strokeStyle = st === 'sale' ? '#ffffff' : '#3d300f';x.lineWidth = 8;x.strokeRect(8, 8, 368, 208);
      x.textAlign = 'center';x.fillStyle = st === 'sale' ? '#ffffff' : '#140e03';
      if (st === 'sale') {x.font = 'bold 54px system-ui, Arial';x.fillText('TIL SALGS', 192, 76);x.font = '600 34px system-ui, Arial';x.fillText(`${h.unit} · ${h.rooms} rom · ${h.area} m²`, 192, 128);x.font = 'bold 44px system-ui, Arial';x.fillText(money(h.price), 192, 186);}
      else {const name = (st === 'mine' ? reg.mineName : reg.owners[h.id]) || 'Privat';x.font = '600 32px system-ui, Arial';x.fillText(h.unit, 192, 64);let px = 76;do {x.font = `bold ${px}px Georgia, serif`;px -= 4;} while (x.measureText(name).width > 330 && px > 22);x.fillText(name, 192, 158);}
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
      const m = new T.Mesh(new T.PlaneGeometry(.3, .175), new T.MeshStandardMaterial({map: tex, roughness: .5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: st === 'sale' ? .2 : .06}));
      m.position.set(d.sign.x, d.sign.y, d.sign.z);m.rotation.y = d.sign.face > 0 ? Math.PI / 2 : -Math.PI / 2;m.name = `Door plate ${h.id}`;return m;
    }
    const built = new Map(), plates = new Map();// id -> {group, t (last needed)}, tower index -> {meshes, version}
    const drop = o => o.traverse(m => {if (m.isMesh) {m.geometry.dispose();if (m.material.map && m.name.startsWith('Door plate')) {m.material.map.dispose();m.material.dispose();}}});
    let clock = 0;
    function tick(player, dt = 0) {
      clock += dt;
      const here = inside(player.x, player.z, player.feet);
      towers.forEach((t, i) => {
        const l = local(t, player.x, player.z), dy = t.matrix.elements[13], near = l.x > -10.5 && l.x < 10.7 && l.z > -4 && l.z < 13 && player.feet > dy - 11 && player.feet < dy + 3.5;
        // The door plates of the stair you are in (or the flat you are in).
        const P = plates.get(i);
        if (near && (!P || P.version !== regVersion)) {
          if (P) P.meshes.forEach(m => {groups[i].remove(m);drop(m);});
          const meshes = homes.filter(h => h.t === i && doors.has(h.id)).map(h => {const m = plate(h, doors.get(h.id));groups[i].add(m);return m;});plates.set(i, {meshes, version: regVersion});
        } else if (!near && P) {P.meshes.forEach(m => {groups[i].remove(m);drop(m);});plates.delete(i);}
        if (!near) return;
        for (const h of homes) {
          if (h.t !== i) continue;const d = doors.get(h.id);
          if ((here && here.home === h) || (d && (d.door.open || d.door.anim))) {
            let b = built.get(h.id);if (!b) {b = {group: build(h), tower: i};groups[i].add(b.group);built.set(h.id, b);}
            b.t = clock;
          }
        }
      });
      for (const [id, b] of built) if (clock - b.t > 8) {groups[b.tower].remove(b.group);drop(b.group);built.delete(id);}
    }
    function setRegistry(r) {reg = {owners: r.owners || {}, mine: r.mine || null, mineName: r.mineName || ''};regVersion++;}
    // Where a flat's door is (world), for the map and the waypoint.
    function doorWorld(id) {const h = byId.get(id), t = towers[h.t], p = xf(t.matrix, h.side < 0 ? -1.2 : 1.405, 5.8);return {x: p.x, z: p.z, y: levelY(h.n) + t.matrix.elements[13]};}
    // Stand just inside the door, facing into the hall.
    function hallSpot(id) {const h = byId.get(id), t = towers[h.t], p = toTower(h, .9, 6.3), w = xf(t.matrix, p.x, p.z);return {x: w.x, z: w.z, y: levelY(h.n) + t.matrix.elements[13]};}
    return {group: root, hitboxes, floors, obstacles, voids: i => voidList[i], byId, plans, inside, lampAt, tick, setRegistry, get registry() {return reg;}, doorOf: id => doors.get(id), doorWorld, hallSpot, built};
  }
  return {plan, pieces, solids, toTower, levelY, label, address, floorName, money, status, canBuy, refund, create, XL, XA, STOREY, TOP, DOOR, DOOR_H, CEIL, LIN, SELL_BACK};
});
