/* Rathkes gate 1C, flat 501 (issue #72): the user's real flat on the 5th floor, built from rathkes-501-data.js (from the user's
 * video) like the 17A flat is built from apartment-data.js. The model replaces the south part of the side wing of OSM building
 * way 113875904 (along Herslebs gate): its two facades with real windows, the roof, stair 1C behind the yard door (a stair
 * winding round a narrow well with carpet, iron scrolls and a curved handrail, a landing with two flat doors on every floor) and
 * the flat with its hall, four bedrooms, kitchen and living room and the small bathroom behind the closed door.
 *
 * Pure parts (Node-tested): frame(data) -> wing frame (a along the street face, b into the building) and its conversions;
 *   cut(ring, data) -> the building's pieces outside the model; levels(data, yardY) -> {G, L[], FL, rise};
 *   stairFloors / flatFloors (walkable surfaces in wing coordinates), obstacles(data, lv, bottom, top), where(data, lv, a, b, y),
 *   lampAt(data, lv, a, b, y).
 * Browser: build({T, lib, world, data, top}) -> {group, far, floors, obstacles, doors, hitboxes, inside(x, z, feet),
 *   lampAt(x, z, feet), placeName(x, z, feet), tick(camera), stats, yardDoor, levels}; floors and obstacles in world coordinates.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRathkes501 = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // ---------- Pure geometry ----------
  function frame(data) {
    const O = data.frame.origin, t = data.frame.toward, dx = t[0] - O[0], ds = t[1] - O[1], L = Math.hypot(dx, ds), A = [dx / L, ds / L], B = [-A[1], A[0]];
    const toLocal = (a, b) => [O[0] + a * A[0] + b * B[0], O[1] + a * A[1] + b * B[1]];
    const toWing = (x, s) => {const px = x - O[0], ps = s - O[1];return [px * A[0] + ps * A[1], px * B[0] + ps * B[1]];};
    // three.js rotation.y that turns a group's +x onto A and its +z onto B (in a parent whose x is east and z is south).
    return {O, A, B, toLocal, toWing, phi: Math.atan2(-A[1], A[0])};
  }
  function clipHalf(ring, o, n) {
    const out = [], f = p => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) {const t = fa / (fa - fb);out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);}
    }
    return out;
  }
  const area = r => Math.abs(r.reduce((s, p, i) => {const q = r[(i + 1) % r.length];return s + p[0] * q[1] - q[0] * p[1];}, 0) / 2);
  // The pieces of a building ring outside the model: b >= cut.b, (b <= cut.b and a >= cut.a2), (cut.b2 <= b <= cut.b and cut.a <= a <= cut.a2).
  function cut(ring, data) {
    const F = frame(data), c = data.cut, neg = v => [-v[0], -v[1]];
    const geB = v => r => clipHalf(r, F.toLocal(0, v), F.B), leB = v => r => clipHalf(r, F.toLocal(0, v), neg(F.B));
    const geA = v => r => clipHalf(r, F.toLocal(v, 0), F.A), leA = v => r => clipHalf(r, F.toLocal(v, 0), neg(F.A));
    const pieces = [geB(c.b)(ring), geA(c.a2)(leB(c.b)(ring)), leA(c.a2)(geA(c.a)(leB(c.b)(geB(c.b2)(ring))))];
    return pieces.filter(r => r.length >= 3 && area(r) > 1);
  }
  function levels(data, yardY) {
    const G = yardY + data.ground.step, L1 = G + data.ground.firstRise, L = [];
    for (let n = 1; n <= data.floors; n++) L.push(L1 + (n - 1) * data.storey);
    return {yard: yardY, G, L, FL: L[data.flatFloor - 1], rise: data.storey / data.risers};
  }
  const inRect = (r, a, b, m = 0) => a > r[0] - m && a < r[2] + m && b > r[1] - m && b < r[3] + m;
  // Height on the turn of storey n: 6 risers round the well, from the east flight (angle 0) to the west flight (angle pi).
  function turnHeight(S, y0, rise, a, b) {
    const [cx, cb] = S.turn.centre, th = Math.max(0, Math.min(Math.PI, Math.atan2(Math.max(0, b - cb), a - cx)));
    return y0 + 6 * rise + 6 * rise * th / Math.PI;
  }
  // Walkable surfaces of stair 1C (wing coordinates): {name, rect, y} or {name, rect, h(a, b)}; ceiling = clear height.
  function stairFloors(data, lv, terrain = () => lv.yard) {
    const S = data.stair, f = S.flights, run = f.to - f.from, r6 = 6 * lv.rise, out = [], gs = S.groundSteps, d = S.yardDoor;
    out.push({name: 'Stair 1C, yard door', rect: [d.a[0], data.yard[0], d.a[1], data.yard[1]], h: (a, b) => {const t = Math.max(0, Math.min(1, (data.yard[1] - b) / (data.yard[1] - data.yard[0])));return terrain(a, b) * (1 - t) + lv.G * t;}, ceiling: d.height});
    out.push({name: 'Stair 1C, ground floor', rect: [S.strip[0], gs.from, S.strip[2], S.room[3]], y: lv.G, ceiling: 2.95});
    out.push({name: 'Stair 1C, steps up', rect: [S.strip[0], gs.to, S.strip[2], gs.from], h: (a, b) => lv.G + (lv.L[0] - lv.G) * (gs.from - b) / (gs.from - gs.to), ceiling: 2.2});
    lv.L.forEach((y, i) => {
      const n = i + 1, top = n === data.floors;
      out.push({name: `Stair 1C, landing ${n}`, rect: n === 1 ? [S.room[0], S.landing[1], S.landing[2], S.landing[3]] : S.landing, y, ceiling: top ? data.ceiling : 2.2, landing: n});
      if (top) return;
      out.push({name: `Stair 1C, flight ${n} up`, rect: [f.east[0], f.from, S.room[2], f.to], h: (a, b) => y + r6 * (b - f.from) / run, ceiling: 2.6});
      out.push({name: `Stair 1C, turn ${n}`, rect: S.turn.outer, h: (a, b) => turnHeight(S, y, lv.rise, a, b), ceiling: 2.4});
      out.push({name: `Stair 1C, flight ${n} on`, rect: [S.landing[0], f.from, f.west[1], f.to], h: (a, b) => y + 2 * r6 + r6 * (f.to - b) / run, ceiling: 2.6});
    });
    return out;
  }
  // Rooms of the flat and the floor in each door gap (wing coordinates, all at the 5th floor).
  function flatFloors(data, lv) {
    const out = data.rooms.map(r => ({name: r.name, rect: r.rect, y: lv.FL, ceiling: data.ceiling, room: r.id, kind: r.floor === 'tile' ? 'tile' : 'wood'}));
    for (const w of data.walls) for (const o of w.openings || []) {
      const alongA = w.rect[2] - w.rect[0] > w.rect[3] - w.rect[1];
      out.push({name: 'Doorway', rect: alongA ? [o.at[0], w.rect[1], o.at[1], w.rect[3]] : [w.rect[0], o.at[0], w.rect[2], o.at[1]], y: lv.FL, ceiling: o.top || 2.05, kind: 'wood'});
    }
    const e = data.entrance;out.push({name: 'Front door of flat 501', rect: [e.at[0], data.stair.room[1] - .12, e.at[1], data.stair.room[1]], y: lv.FL, ceiling: 2.05, kind: 'wood'});
    return out;
  }
  // Solid volumes {rect, minY, maxY} (wing coordinates): the building around the flat and stair, their walls, the stair's solids.
  function obstacles(data, lv, bottom, top) {
    const S = data.stair, R = S.room, W = S.walls, FL = lv.FL, C = FL + data.ceiling, list = [], o = (rect, minY, maxY) => list.push({rect, minY, maxY});
    const tw = [W.west[0], R[1] - .12, W.east[1], data.yard[1]];// the stair tower with its walls
    // Below and above the flat: the building's massing (the stair tower stays open).
    for (const r of [[0, 0, tw[0], 11.3], [tw[0], 0, tw[2], tw[1]], [tw[2], 0, data.cut.a, 11.3], [data.cut.a, 0, data.cut.a2, data.cut.b2]]) o(r, bottom, FL - .02);
    for (const r of [[0, 0, data.cut.a, 11.3], [data.cut.a, 0, data.cut.a2, data.cut.b2]]) o(r, C, top + 4);
    // The facades at the flat's level (windows have sills: nobody climbs out).
    o([0, 0, data.cut.a2, data.street[1]], FL - .02, C);o([0, data.yard[0], tw[0], data.yard[1]], FL - .02, C);o([tw[2], data.yard[0], data.cut.a, data.yard[1]], FL - .02, C);
    // Inner walls of the flat, open in their doorways.
    for (const w of data.walls) {
      const r = w.rect, alongA = r[2] - r[0] > r[3] - r[1], ops = (w.openings || []).slice().sort((p, q) => p.at[0] - q.at[0]);
      let from = alongA ? r[0] : r[1];
      for (const op of ops) {
        const seg = (u0, u1) => alongA ? [u0, r[1], u1, r[3]] : [r[0], u0, r[2], u1];
        if (op.at[0] > from) o(seg(from, op.at[0]), FL - .02, C);
        o(seg(op.at[0], op.at[1]), FL + (op.top || 2.05), C);from = op.at[1];
      }
      const end = alongA ? r[2] : r[3];if (end > from) o(alongA ? [from, r[1], end, r[3]] : [r[0], from, r[2], end], FL - .02, C);
    }
    // The stair tower: side walls, the wall to the flat (open at 501's door), the yard wall (open at the yard door).
    o([W.west[0], tw[1], W.west[1], tw[3]], bottom, C);o([W.east[0], tw[1], W.east[1], tw[3]], bottom, C);
    const fd = S.flatDoor.a, yd = S.yardDoor.a;
    o([R[0], tw[1], fd[0], R[1]], bottom, C);o([fd[1], tw[1], R[2], R[1]], bottom, C);o([fd[0], tw[1], fd[1], R[1]], bottom, FL - .02);o([fd[0], tw[1], fd[1], R[1]], FL + S.flatDoor.height, C);
    o([R[0], data.yard[0], yd[0], data.yard[1]], bottom, C);o([yd[1], data.yard[0], R[2], data.yard[1]], bottom, C);o([yd[0], data.yard[0], yd[1], data.yard[1]], lv.G + S.yardDoor.height, C);
    // Inside the tower: the entry strip's wall (storerooms above the ground floor), the solid under the first flights, the well.
    const sw = S.stripWall, L1 = lv.L[0];
    o([sw[0], S.landing[3], sw[1], R[3]], bottom, C);o([sw[0], R[1], sw[1], S.landing[3]], L1 + 2.2, C);o([R[0], R[1], sw[0], R[3]], L1 + 2.2, C);
    o([S.landing[0], S.landing[3], R[2], R[3]], bottom, L1 - .02);
    o([S.flights.west[1], S.flights.from + .1, S.flights.east[0], S.flights.to], bottom, FL + 1);
    const [cx, cb] = S.turn.centre, ri = S.turn.inner;o([cx - ri, cb - ri, cx + ri, cb + ri * .7], bottom, FL + 1);
    o([S.flights.west[1], S.landing[3], R[2], S.landing[3] + .05], FL, FL + 1);// railing round the stairwell on the top landing
    return list;
  }
  // Where a point is: {place: 'flat', room} or {place: 'stair', landing} or null.
  function where(data, lv, a, b, y) {
    const S = data.stair;
    if (inRect(S.room, a, b) && y > lv.G - .6 && y < lv.FL + 2.7) return {place: 'stair', level: Math.max(0, Math.min(data.floors, Math.floor((y - lv.L[0] + .5) / data.storey) + 1))};
    if (y > lv.FL - .6 && y < lv.FL + 2.6) for (const r of data.rooms) if (inRect(r.rect, a, b, .07)) return {place: 'flat', room: r.id};
    return null;
  }
  // The ceiling lamp that lights the player: the nearest lamp of their room, or the stair lamp of their storey.
  function lampAt(data, lv, a, b, y) {
    const w = where(data, lv, a, b, y);if (!w) return null;
    if (w.place === 'stair') {
      const S = data.stair, n = w.level;
      if (n < 1 || (n === 1 && b > S.landing[3] + .3 && a < S.stripWall[0])) return {a: (S.strip[0] + S.strip[2]) / 2, b: 9.9, y: lv.G + 2.9, power: 4, reach: 6};
      return {a: (S.landing[0] + S.landing[2]) / 2, b: (S.landing[1] + S.landing[3]) / 2, y: lv.L[n - 1] + 2.65, power: 5, reach: 7};
    }
    const room = data.rooms.find(r => r.id === w.room), best = room.lamps.slice().sort((p, q) => Math.hypot(p[0] - a, p[1] - b) - Math.hypot(q[0] - a, q[1] - b))[0];
    const big = room.id === 'living';return {a: best[0], b: best[1], y: lv.FL + 2.5, power: big ? 6 : 4.5, reach: big ? 8 : 6};
  }

  // ---------- Browser ----------
  function build({T, lib, world, data, top}) {
    const F = frame(data), S = data.stair, D = window.SURROUNDINGS;
    const yardAt = (a, b) => {const [x, s] = F.toLocal(a, b), w = world.toWorld(x, s);return world.heightWorld(w.x, w.z);};
    const lv = levels(data, yardAt((S.yardDoor.a[0] + S.yardDoor.a[1]) / 2, data.yard[1] + .4));
    const FL = lv.FL, CEIL = data.ceiling, G = lv.G;
    const bottom = Math.min(...data.outline.map(([a, b]) => yardAt(Math.min(a, 13.4), Math.min(b, 11.6)))) - .6;
    const TOP = top || (G + 18.9);
    const group = new T.Group();group.name = 'Rathkes gate 1C (flat 501)';
    const local = new T.Group();local.rotation.y = D.geo.theta;local.position.set(D.geo.x, 0, D.geo.z);group.add(local);
    const wing = new T.Group();wing.position.set(F.O[0], 0, F.O[1]);wing.rotation.y = F.phi;local.add(wing);
    const shell = new T.Group(), inner = new T.Group(), backing = new T.Group();shell.name = '1C facades';inner.name = 'Flat 501 and stair 1C';wing.add(shell, inner, backing);
    const doors = [], hitboxes = [];
    // ---- Materials (shared, so the merged meshes stay few).
    const M = new Map(), mat = (k, make) => {if (!M.has(k)) M.set(k, make());return M.get(k);};
    const tint = (m, c) => {m.color = new T.Color(c);return m;};
    const plaster = mat('plaster', () => lib.plaster(0xf2f0ea)), ceilingM = mat('ceiling', () => {const m = lib.plaster(0xfbfaf6);m.emissive = new T.Color(0x8c887f);return m;}), brick = mat('brick', () => {const m = lib.brick();m.color.setScalar(.8);return m;});
    const plinthM = mat('plinth', () => lib.concrete(0x8e8a82)), roofM = mat('roof', () => lib.roof()), pine = mat('pine', () => tint(lib.woodFloor(), 0xffe2b2));
    const trim = {pal: 0xf4f3ee}, glass = mat('glass', () => lib.glass()), dark = mat('dark', () => new T.MeshStandardMaterial({color: 0x161b20, roughness: .9, metalness: 0}));
    const carpet = mat('carpet', () => lib.fabric(0x5d4636)), tilesW = mat('tilesW', () => lib.wallTiles()), tilesF = mat('tilesF', () => lib.floorTiles()), chrome = mat('chrome', () => lib.chrome());
    const oak = mat('oak', () => lib.wood(0xb98552, .5)), teak = mat('teak', () => lib.wood(0x8d4f27, .42)), birch = {pal: 0xd8b47c}, rail = {pal: 0x4a2014};
    const lino = {pal: 0x6b4434}, sofaM = {pal: 0x3b4249}, ceramic = {pal: 0xf7f7f5};
    const glow = {glow: 0xfff1d8}, glowOrange = {glow: 0xff9a4a}, screen = {glow: 0x2c3c9a}, lavaM = {glow: 0xff4a8a};
    const hidden = new T.MeshBasicMaterial({visible: false});
    // Palette: one texture of colour swatches for every flat-coloured part (furniture, coats, appliances), one draw call.
    const PAL = document.createElement('canvas');PAL.width = PAL.height = 256;const palCtx = PAL.getContext('2d'), palIndex = new Map();
    const palTex = new T.CanvasTexture(PAL);palTex.colorSpace = T.SRGBColorSpace;palTex.magFilter = palTex.minFilter = T.NearestFilter;palTex.generateMipmaps = false;
    const palette = mat('palette', () => new T.MeshStandardMaterial({map: palTex, roughness: .62, metalness: 0}));
    const glowPal = mat('glowPal', () => new T.MeshStandardMaterial({map: palTex, emissiveMap: palTex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: .4}));
    function swatch(hex) {
      if (!palIndex.has(hex)) {const i = palIndex.size, x = (i % 32) * 8, y = Math.floor(i / 32) * 8;palCtx.fillStyle = '#' + hex.toString(16).padStart(6, '0');palCtx.fillRect(x, y, 8, 8);palIndex.set(hex, [(x + 4) / 256, 1 - (y + 4) / 256]);palTex.needsUpdate = true;}
      return palIndex.get(hex);
    }
    const paint = (geo, hex) => {const [u, v] = swatch(hex), uv = geo.attributes.uv;for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);return geo;};
    // Art atlas: pictures, posters, record sleeves and door labels (4 x 4 cells of 256 px; labels in the last two cells).
    const ART = document.createElement('canvas');ART.width = ART.height = 1024;const art = ART.getContext('2d');
    (() => {
      const cell = (i, f) => {const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;art.save();art.translate(x, y);art.beginPath();art.rect(0, 0, 256, 256);art.clip();f(art);art.restore();};
      const rnd = (() => {let s = 72;return () => {s = (s * 16807) % 2147483647;return s / 2147483647;};})();
      cell(0, g => {const gr = g.createLinearGradient(0, 0, 0, 256);gr.addColorStop(0, '#41506e');gr.addColorStop(1, '#a77d64');g.fillStyle = gr;g.fillRect(0, 0, 256, 256);g.fillStyle = '#25304a';for (let i = 0; i < 9; i++) g.fillRect(20 + i * 25, 120 + rnd() * 40, 14, 136);});
      cell(1, g => {g.fillStyle = '#f07a24';g.fillRect(0, 0, 256, 256);g.fillStyle = '#1b1b1b';g.fillRect(118, 120, 20, 110);g.beginPath();g.ellipse(128, 100, 90, 40, 0, 0, 7);g.fill();g.beginPath();g.ellipse(80, 140, 40, 18, 0, 0, 7);g.ellipse(176, 150, 44, 16, 0, 0, 7);g.fill();});
      cell(2, g => {const gr = g.createLinearGradient(0, 0, 0, 256);gr.addColorStop(0, '#8fb6d8');gr.addColorStop(1, '#f4f6f8');g.fillStyle = gr;g.fillRect(0, 0, 256, 256);g.fillStyle = '#3b4f6e';g.beginPath();g.moveTo(0, 200);g.lineTo(90, 90);g.lineTo(160, 170);g.lineTo(256, 80);g.lineTo(256, 256);g.lineTo(0, 256);g.fill();});
      cell(3, g => {g.fillStyle = '#1e2d3a';g.fillRect(0, 0, 256, 256);g.fillStyle = '#d8d0c0';g.beginPath();g.arc(128, 110, 60, 0, 7);g.fill();g.fillStyle = '#6d8aa8';g.fillRect(0, 190, 256, 66);});
      for (let i = 0; i < 9; i++) cell(4 + i, g => {const hue = Math.floor(rnd() * 360);g.fillStyle = `hsl(${hue},45%,${35 + rnd() * 30}%)`;g.fillRect(0, 0, 256, 256);for (let k = 0; k < 5; k++) {g.fillStyle = `hsla(${(hue + 60 + rnd() * 200) % 360},60%,${30 + rnd() * 50}%,.8)`;g.beginPath();g.arc(rnd() * 256, rnd() * 256, 20 + rnd() * 80, 0, 7);g.fill();}g.fillStyle = 'rgba(255,255,255,.85)';g.font = 'bold 26px Georgia';g.fillText(['LP', 'JAZZ', 'SOUL', 'PRINCE', 'BLUE', 'DISCO', 'FOLK', 'NOVA', 'ECHO'][i], 18, 236);});
    })();
    const labels = ['101', '102', '201', '202', '301', '302', '401', '402', '501', '1C', 'RATHKES GATE 1C', ''];
    labels.forEach((t, i) => {const x = (13 + Math.floor(i / 8)) % 4 * 256 + (i % 2) * 128, y = Math.floor((13 + Math.floor(i / 8)) / 4) * 256 + Math.floor((i % 8) / 2) * 64;art.fillStyle = i < 9 ? '#d9b75a' : '#1f3b6e';art.fillRect(x + 2, y + 2, 124, 60);art.fillStyle = i < 9 ? '#2a2112' : '#ffffff';art.font = i === 10 ? 'bold 15px Segoe UI, Arial' : 'bold 40px Georgia';art.textAlign = 'center';art.textBaseline = 'middle';art.fillText(t, x + 64, y + 34);});
    const artTex = new T.CanvasTexture(ART);artTex.colorSpace = T.SRGBColorSpace;artTex.anisotropy = 4;
    const artM = mat('art', () => new T.MeshStandardMaterial({map: artTex, roughness: .55}));
    const cellUV = i => {const x = (i % 4) / 4, y = Math.floor(i / 4) / 4;return [x, 1 - y - .25, x + .25, 1 - y];};
    const labelUV = i => {const c = 13 + Math.floor(i / 8), x = (c % 4) * 256 + (i % 2) * 128, y = Math.floor(c / 4) * 256 + Math.floor((i % 8) / 2) * 64;return [x / 1024, 1 - (y + 64) / 1024, (x + 128) / 1024, 1 - y / 1024];};
    // Canvas textures: landing tiles, wall panelling, the iron scrolls of the balustrade, a striped rug.
    const canvasTex = (w, h, draw, rep, alpha) => {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.wrapS = t.wrapT = T.RepeatWrapping;if (rep) t.repeat.set(rep[0], rep[1]);t.anisotropy = 4;return t;};
    const landingTiles = mat('landing', () => new T.MeshStandardMaterial({roughness: .5, map: canvasTex(256, 256, (g) => {g.fillStyle = '#8f8a84';g.fillRect(0, 0, 256, 256);for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {g.fillStyle = (i + j) % 2 ? '#b0644a' : '#c47a5c';g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);g.fillStyle = '#e1d3bf';g.fillRect(i * 64 + 26, j * 64 + 26, 12, 12);}}, [1 / .8, 1 / .8])}));
    const panelling = mat('panel', () => new T.MeshStandardMaterial({roughness: .55, map: canvasTex(64, 256, (g, w, h) => {g.fillStyle = '#b4bcb1';g.fillRect(0, 0, w, h);for (let y = 0; y < h; y += 32) {g.fillStyle = '#8f978c';g.fillRect(0, y, w, 3);g.fillStyle = '#c9d0c6';g.fillRect(0, y + 3, w, 2);}}, [1, 2])}));
    const ironM = mat('iron', () => new T.MeshStandardMaterial({color: 0x1a1a1c, roughness: .5, metalness: .6, alphaTest: .5, side: T.DoubleSide, map: canvasTex(256, 448, (g, w, h) => {
      g.clearRect(0, 0, w, h);g.strokeStyle = g.fillStyle = '#fff';g.lineWidth = 9;g.lineCap = 'round';
      g.fillRect(0, h - 18, w, 14);g.fillRect(0, 26, w, 12);for (const x of [8, 128]) g.fillRect(x - 5, 26, 10, h - 40);
      for (const [x, y, s] of [[64, 120, 1], [64, 300, -1], [192, 150, -1], [192, 320, 1]]) {g.beginPath();g.arc(x - 20 * s, y, 30, -1.2, 2.4);g.stroke();g.beginPath();g.arc(x + 20 * s, y + 52, 28, 1.9, 5.3);g.stroke();g.beginPath();g.arc(x, y - 36, 12, 0, 7);g.stroke();}
    }, [1 / .5, 1]), transparent: false}));
    // Rug atlas: every rug of the flat in one texture (3 x 2 cells): bordered rugs with a diamond field, and the striped one.
    const rugList = data.furniture.filter(f => f.kind === 'rug' || f.kind === 'stripedRug'), hexS = c => '#' + c.toString(16).padStart(6, '0');
    const rugM = mat('rugs', () => new T.MeshStandardMaterial({roughness: 1, map: canvasTex(768, 1024, (g) => {
      rugList.forEach((f, i) => {
        const x0 = (i % 3) * 256, y0 = Math.floor(i / 3) * 512, W = 256, H = 512;g.save();g.translate(x0, y0);
        if (f.kind === 'stripedRug') {const c = ['#7a2424', '#141416', '#24513a', '#a8843c', '#141416', '#8c3424', '#d2cab8', '#141416'];for (let k = 0; k < 64; k++) {g.fillStyle = c[k % c.length];g.fillRect(0, k * 8, W, 8);}}
        else {const [c0, c1, c2] = f.colors.map(hexS);g.fillStyle = c0;g.fillRect(0, 0, W, H);g.strokeStyle = c1;g.lineWidth = 12;g.strokeRect(14, 14, W - 28, H - 28);g.lineWidth = 4;g.strokeRect(34, 34, W - 68, H - 68);
          for (let a = 0; a < 5; a++) for (let b = 0; b < 10; b++) {g.fillStyle = (a + b) % 2 ? c1 : c2;g.save();g.translate(56 + a * 36, 60 + b * 43);g.rotate(Math.PI / 4);g.fillRect(-9, -9, 18, 18);g.restore();}}
        g.fillStyle = 'rgba(0,0,0,.08)';for (let k = 0; k < 900; k++) g.fillRect(Math.random() * W, Math.random() * H, 2, 2);g.restore();
      });
    })}));
    const rugUV = f => {const i = rugList.indexOf(f), x = (i % 3) / 3, y = Math.floor(i / 3) / 2;return [x, 1 - y - .5, x + 1 / 3, 1 - y];};
    // ---- Geometry helpers (wing coordinates: x = a, z = b, y absolute).
    const mesh = (geo, m, parent) => {if (m && m.pal !== undefined) {paint(geo, m.pal);m = palette;} else if (m && m.glow !== undefined) {paint(geo, m.glow);m = glowPal;}const o = new T.Mesh(geo, m);o.castShadow = o.receiveShadow = true;parent.add(o);return o;};
    function box(parent, a0, b0, a1, b1, y0, y1, m) {
      if (a1 - a0 < 1e-4 || b1 - b0 < 1e-4 || y1 - y0 < 1e-4) return null;
      const o = mesh(new T.BoxGeometry(a1 - a0, y1 - y0, b1 - b0), m, parent);o.position.set((a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2);
      if (!(m.pal !== undefined || m.glow !== undefined) && (!Array.isArray(m) || m.some(x => x.map && x !== palette && x !== artM))) lib.boxUV(o);return o;
    }
    // A coloured box in a piece's own frame (x across, z front); colour from the palette.
    function pbox(parent, w, h, d, x, y, z, hex) {const o = mesh(paint(new T.BoxGeometry(w, h, d), hex), palette, parent);o.position.set(x, y, z);return o;}
    function pcyl(parent, rt, rb, h, x, y, z, hex, seg = 12) {const o = mesh(paint(new T.CylinderGeometry(rt, rb, h, seg), hex), palette, parent);o.position.set(x, y, z);return o;}
    function plane(parent, w, h, m, uv) {const g = new T.PlaneGeometry(w, h);if (uv) {const u = g.attributes.uv;u.setXY(0, uv[0], uv[3]);u.setXY(1, uv[2], uv[3]);u.setXY(2, uv[0], uv[1]);u.setXY(3, uv[2], uv[1]);}const o = mesh(g, m, parent);o.castShadow = false;return o;}
    // Wall with rectangular holes: cut into boxes around the holes. holes [{a0, a1, y0, y1}] along the wall's long axis.
    function holed(parent, a0, b0, a1, b1, y0, y1, holes, m) {
      const alongA = a1 - a0 >= b1 - b0, u0 = alongA ? a0 : b0, u1 = alongA ? a1 : b1;
      const cuts = [...new Set([u0, u1, ...holes.flatMap(h => [h.a0, h.a1]).filter(u => u > u0 && u < u1)])].sort((p, q) => p - q);
      for (let i = 0; i < cuts.length - 1; i++) {
        const p = cuts[i], q = cuts[i + 1], mid = (p + q) / 2, hs = holes.filter(h => h.a0 < mid && h.a1 > mid).sort((x, y) => x.y0 - y.y0);let y = y0;
        const put = (ya, yb) => alongA ? box(parent, p, b0, q, b1, ya, yb, m) : box(parent, a0, p, a1, q, ya, yb, m);
        for (const h of hs) {if (h.y0 > y) put(y, h.y0);y = Math.max(y, h.y1);}if (y1 > y) put(y, y1);
      }
    }
    // Materials per face of a box: [+x, -x, +y, -y, +z, -z].
    const faces = (px, nx, py, ny, pz, nz) => [px, nx, py, ny, pz, nz];

    // ---------- Shell: the two facades with windows on every floor, plinth, roof ----------
    const storeyFloor = n => lv.L[n - 1], W = data.windows;
    const streetFace = faces(plaster, plaster, plaster, plaster, plaster, brick), yardFace = faces(plaster, plaster, plaster, plaster, brick, plaster);
    const winHoles = (list, real) => {const out = [];for (let n = 1; n <= data.floors; n++) for (const [c, w] of list) out.push({a0: c - w / 2, a1: c + w / 2, y0: storeyFloor(n) + W.sill, y1: storeyFloor(n) + W.head, n, real: real(n)});return out;};
    const streetWins = winHoles(W.street, n => n === data.flatFloor), yardWins = winHoles(W.yard, n => n === data.flatFloor);
    const stairWins = lv.L.map((y, i) => i + 1 < data.floors ? {a0: S.window.a[0], a1: S.window.a[1], y0: y + 1.45, y1: y + 2.85, n: i + 1, real: true, stair: true} : {a0: S.window.a[0], a1: S.window.a[1], y0: y + 1.0, y1: y + 2.55, n: i + 1, real: true, stair: true});
    const yardDoorHole = {a0: S.yardDoor.a[0], a1: S.yardDoor.a[1], y0: bottom, y1: G + S.yardDoor.height};
    const transom = {a0: S.yardDoor.a[0], a1: S.yardDoor.a[1], y0: G + S.yardDoor.height + .1, y1: G + S.yardDoor.height + .55, real: true, stair: true};
    holed(shell, 0, data.street[0], data.cut.a2, data.street[1], bottom, TOP - .2, streetWins, streetFace);
    holed(shell, 0, data.yard[0], data.cut.a, data.yard[1], bottom, TOP - .2, [...yardWins, ...stairWins, yardDoorHole, transom], yardFace);
    // Plinth (2 cm proud) along both facades up to 0.8 m over the ground.
    box(shell, 0, data.street[0] - .02, data.cut.a2, data.street[0], bottom, G + .8, plinthM);
    box(shell, 0, data.yard[1], S.yardDoor.a[0], data.yard[1] + .02, bottom, G + .8, plinthM);box(shell, S.yardDoor.a[1], data.yard[1], data.cut.a, data.yard[1] + .02, bottom, G + .8, plinthM);
    // A simple cornice under the roof edge on both facades.
    box(shell, 0, data.street[0] - .12, data.cut.a2, data.street[0], TOP - .55, TOP - .35, plinthM);box(shell, 0, data.yard[1], data.cut.a, data.yard[1] + .12, TOP - .55, TOP - .35, plinthM);
    {const sh = new T.Shape();data.outline.forEach(([a, b], i) => i ? sh.lineTo(a, -b) : sh.moveTo(a, -b));sh.closePath();const g = new T.ExtrudeGeometry(sh, {depth: .2, bevelEnabled: false});g.rotateX(-Math.PI / 2);const r = mesh(g, roofM, shell);r.position.y = TOP - .2;}
    // Window frames: white, two side-hung leaves under a two-pane transom (six panes, as in the video).
    function windowAt(h, outer, inside, face) {
      const parent = h.real ? (h.n === data.flatFloor || h.stair ? inner : shell) : shell, w = h.a1 - h.a0, ht = h.y1 - h.y0, mid = (h.a0 + h.a1) / 2;
      const zf = outer + face * .14, f = .055, d = .07, z0 = zf - d / 2, z1 = zf + d / 2, top = h.stair ? h.y1 - .02 : h.y0 + (W.transom - W.sill);
      box(shell, h.a0, z0, h.a1, z1, h.y1 - f, h.y1, trim);box(shell, h.a0, z0, h.a1, z1, h.y0, h.y0 + f, trim);
      box(shell, h.a0, z0, h.a0 + f, z1, h.y0 + f, h.y1 - f, trim);box(shell, h.a1 - f, z0, h.a1, z1, h.y0 + f, h.y1 - f, trim);
      if (!h.stair) {box(shell, h.a0 + f, z0, h.a1 - f, z1, top - .025, top + .025, trim);box(shell, mid - .03, z0, mid + .03, z1, h.y0 + f, top - .025, trim);const lowMid = (h.y0 + top) / 2;box(shell, h.a0 + f, z0 + .01, h.a1 - f, z1 - .01, lowMid - .018, lowMid + .018, trim);box(shell, mid - .02, z0 + .01, mid + .02, z1 - .01, top + .025, h.y1 - f, trim);}
      else box(shell, mid - .025, z0, mid + .025, z1, h.y0 + f, h.y1 - f, trim);
      const pane = box(shell, h.a0 + f, zf - .004, h.a1 - f, zf + .004, h.y0 + f, h.y1 - f, glass);if (pane) pane.castShadow = false;
      // Outside sill; inside window board on the flat's floor.
      box(shell, h.a0 - .04, Math.min(outer - face * .07, outer + face * .03), h.a1 + .04, Math.max(outer - face * .07, outer + face * .03), h.y0 - .05, h.y0 + .012, plinthM);
      if (h.real && !h.stair) {const z0 = face > 0 ? zf + .04 : inside - .06, z1 = face > 0 ? inside + .06 : zf - .04;box(parent, h.a0 - .05, z0, h.a1 + .05, z1, h.y0 - .03, h.y0 + .005, trim);}
      // Lower floors: a dark room behind the glass. Real windows get one too, shown only while the interior is hidden.
      const back = face > 0 ? [zf + .14, zf + .15] : [zf - .15, zf - .14];
      box(h.real ? backing : shell, h.a0, Math.min(...back), h.a1, Math.max(...back), h.y0, h.y1, dark);
    }
    streetWins.forEach(h => windowAt(h, data.street[0], data.street[1], 1));
    [...yardWins, ...stairWins, transom].forEach(h => windowAt(h, data.yard[1], data.yard[0], -1));
    // The far view: one plain block for the whole part.
    const far = (() => {const sh = new T.Shape();data.outline.forEach(([a, b], i) => i ? sh.lineTo(a, -b) : sh.moveTo(a, -b));const g = new T.ExtrudeGeometry(sh, {depth: TOP - bottom, bevelEnabled: false});g.rotateX(-Math.PI / 2);g.translate(0, bottom, 0);const m = new T.Mesh(g, new T.MeshStandardMaterial({color: 0x8f6a58, roughness: .9}));
      const lg = new T.Group();lg.rotation.y = D.geo.theta;lg.position.set(D.geo.x, 0, D.geo.z);const wg = new T.Group();wg.position.set(F.O[0], 0, F.O[1]);wg.rotation.y = F.phi;wg.add(m);lg.add(wg);return lg;})();

    // ---------- Stair 1C ----------
    const R = S.room, LD = S.landing, fl = S.flights, run = fl.to - fl.from, rise = lv.rise;
    const wallTop = FL + CEIL;
    // Tower walls (plaster inside; the yard wall is the facade). The wall to the flat: one locked flat door per floor, 501 open.
    box(inner, S.walls.west[0], R[1] - .12, S.walls.west[1], R[3], bottom, wallTop, plaster);box(inner, S.walls.east[0], R[1] - .12, S.walls.east[1], R[3], bottom, wallTop, plaster);
    const fd = S.flatDoor.a;
    holed(inner, R[0], R[1] - .12, R[2], R[1], bottom, wallTop, [{a0: fd[0], a1: fd[1], y0: FL, y1: FL + S.flatDoor.height}], plaster);
    // Entry strip: wall to the stair, storerooms above the ground floor (their floor is the hall's ceiling).
    const sw = S.stripWall, L1 = lv.L[0];
    box(inner, sw[0], LD[3], sw[1], R[3], bottom, wallTop, plaster);box(inner, sw[0], R[1], sw[1], LD[3], L1 + 2.2, wallTop, plaster);
    box(inner, R[0], R[1], sw[0], R[3], L1 + 2.2, L1 + 2.45, faces(plaster, plaster, plaster, ceilingM, plaster, plaster));
    box(inner, LD[0], LD[3], R[2], R[3], bottom, L1 - .25, plaster);// the closet under the first flights
    // Floors: the ground hall and its five steps, the landings.
    box(inner, R[0], S.groundSteps.from, sw[0], R[3], G - .12, G, landingTiles);
    box(inner, S.yardDoor.a[0], data.yard[0], S.yardDoor.a[1], data.yard[1], G - .12, G, landingTiles);
    for (let k = 0; k < 5; k++) {const t = (lv.L[0] - G) / 5, gs = S.groundSteps, g = (gs.from - gs.to) / 5;box(inner, R[0], gs.from - (k + 1) * g, sw[0], gs.from - k * g, G, G + (k + 1) * t, faces(plaster, plaster, landingTiles, plaster, landingTiles, plaster));}
    lv.L.forEach((y, i) => {
      const n = i + 1, top = n === data.floors, r = n === 1 ? [R[0], LD[1], LD[2], LD[3]] : LD;
      box(inner, r[0], r[1], r[2], r[3], y - .22, top ? y - .006 : y, faces(plaster, plaster, top ? plaster : landingTiles, ceilingM, plaster, plaster));if (top) box(inner, r[0], r[1], r[2], r[3], y - .006, y, lino);
      // Ceiling lamp over each landing.
      const lamp = mesh(new T.SphereGeometry(.11, 14, 10), glow, inner);lamp.position.set((LD[0] + LD[2]) / 2, y + (top ? CEIL - .2 : 2.72), (LD[1] + LD[3]) / 2);lamp.castShadow = false;
      if (top) return;
      // Flight up the east side (6 risers), the 180° turn with 6 winders round the well, flight back up the west side.
      for (let k = 0; k < 6; k++) {
        const b0 = fl.from + k * run / 6, b1 = b0 + run / 6;box(inner, fl.east[0], b0, R[2] - .01, b1, y + k * rise - .05, y + (k + 1) * rise, faces(plaster, plaster, carpet, plaster, plaster, carpet));
        const c0 = fl.to - (k + 1) * run / 6, c1 = c0 + run / 6;box(inner, LD[0] + .01, c0, fl.west[1], c1, y + (12 + k) * rise - .05, y + (13 + k) * rise, faces(plaster, plaster, carpet, plaster, carpet, plaster));
      }
      for (const [x0, x1, y0, y1, up] of [[fl.east[0], R[2] - .01, y, y + 6 * rise, true], [LD[0] + .01, fl.west[1], y + 12 * rise, y + 18 * rise, false]]) {
        const len = Math.hypot(run, y1 - y0), s = mesh(new T.BoxGeometry(x1 - x0, .14, len), plaster, inner);s.position.set((x0 + x1) / 2, (y0 + y1) / 2 - .24, (fl.from + fl.to) / 2);s.rotation.x = (up ? -1 : 1) * Math.atan2(y1 - y0, run);
      }
      for (let k = 0; k < 6; k++) winder(y + (7 + k) * rise, k * Math.PI / 6, (k + 1) * Math.PI / 6);
    });
    // One winder: the part of the turn's rectangle between two angles from the well's centre, as a carpeted prism.
    function winder(yTop, t0, t1) {
      const [cx, cb] = S.turn.centre, [ra0, rb0, ra1, rb1] = S.turn.outer, ri = S.turn.inner;
      const hit = t => {const dx = Math.cos(t), db = Math.sin(t);let best = 1e9;if (dx > 1e-6) best = Math.min(best, (ra1 - cx) / dx);if (dx < -1e-6) best = Math.min(best, (ra0 - cx) / dx);if (db > 1e-6) best = Math.min(best, (rb1 - cb) / db);return [cx + dx * best, cb + db * best];};
      const corners = [[ra1, rb1], [ra0, rb1]].filter(([a, b]) => {const t = Math.atan2(b - cb, a - cx);return t > t0 && t < t1;});
      const pts = [[cx + ri * Math.cos(t0), cb + ri * Math.sin(t0)], hit(t0), ...corners, hit(t1), [cx + ri * Math.cos(t1), cb + ri * Math.sin(t1)]];
      const sh = new T.Shape();pts.forEach(([a, b], i) => i ? sh.lineTo(a, -b) : sh.moveTo(a, -b));sh.closePath();
      const g = new T.ExtrudeGeometry(sh, {depth: rise + .18, bevelEnabled: false});g.rotateX(-Math.PI / 2);g.translate(0, yTop - rise - .18, 0);
      const uv = g.attributes.uv, p = g.attributes.position;for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) + p.getY(i) * .3, p.getZ(i));
      mesh(g, carpet, inner);
    }
    // Handrail and iron balustrade along the well, from the 1st-floor landing to the railing on the top landing.
    {
      const path = [], [cx, cb] = S.turn.centre, ri = S.turn.inner + .03;
      for (let i = 0; i < data.floors - 1; i++) {
        const y = lv.L[i];
        for (let k = 0; k <= 8; k++) {const t = k / 8;path.push([fl.east[0] - .02, fl.from + run * t, y + 6 * rise * t]);}
        for (let k = 1; k < 12; k++) {const t = k / 12 * Math.PI;path.push([cx + ri * Math.cos(t), cb + ri * Math.sin(t) + .02, y + 6 * rise + 6 * rise * t / Math.PI]);}
        for (let k = 0; k <= 8; k++) {const t = k / 8;path.push([fl.west[1] + .02, fl.to - run * t, y + 12 * rise + 6 * rise * t]);}
      }
      path.push([fl.east[0] - .02, LD[3] + .03, FL], [R[2] - .02, LD[3] + .03, FL]);
      const pos = [], uvs = [], idx = [];let dist = 0;
      path.forEach((p, i) => {if (i) dist += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]);pos.push(p[0], p[2] + .04, p[1], p[0], p[2] + .9, p[1]);uvs.push(dist, 0, dist, 1);if (i) {const k = i * 2;idx.push(k - 2, k - 1, k, k - 1, k + 1, k);}});
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));g.setIndex(idx);g.computeVertexNormals();
      const bal = mesh(g, ironM, inner);bal.castShadow = false;
      const curve = new T.CatmullRomCurve3(path.map(p => new T.Vector3(p[0], p[2] + .93, p[1])), false, 'centripetal');
      mesh(new T.TubeGeometry(curve, path.length * 2, .032, 6, false), rail, inner);
    }
    // Flat doors on the landings: locked ones on floors 1–4 (x01 ahead, x02 on the east wall), 501 on the 5th floor.
    function lockedDoor(n, side) {
      const y = lv.L[n - 1], id = `${n}0${side === 'north' ? 1 : 2}`, name = S.names[id] || '';
      const g = new T.Group();inner.add(g);
      if (side === 'north') {g.position.set((fd[0] + fd[1]) / 2, y, R[1]);} else {g.position.set(R[2], y, (S.sideDoor.b[0] + S.sideDoor.b[1]) / 2);g.rotation.y = -Math.PI / 2;}
      const w = side === 'north' ? fd[1] - fd[0] : S.sideDoor.b[1] - S.sideDoor.b[0], hgt = 2.05;
      for (const x of [-w / 2 - .03, w / 2 + .03]) pbox(g, .07, hgt + .04, .03, x, hgt / 2, .015, 0xf1efe8);pbox(g, w + .13, .07, .03, 0, hgt + .035, .015, 0xf1efe8);
      const leafHex = side === 'north' ? 0xc3c6bd : 0xf0efe9;pbox(g, w - .02, hgt, .045, 0, hgt / 2, .0225, leafHex);
      if (side === 'north') for (const yy of [.55, 1.45]) {pbox(g, w - .26, .7, .012, 0, yy, .051, 0xb6b9b0);}
      else {const gl = box(g, -(w - .3) / 2, .046, (w - .3) / 2, .052, 1.05, 1.85, glass);if (gl) gl.castShadow = false;for (const yy of [1.45]) pbox(g, w - .3, .04, .014, 0, yy, .052, 0xf0efe9);pbox(g, .04, .8, .014, 0, 1.45, .052, 0xf0efe9);pbox(g, w - .26, .7, .012, 0, .5, .051, 0xe2e1da);}
      pbox(g, .12, .022, .05, w / 2 - .12, 1.02, .07, 0xc8a24a);pbox(g, .05, .16, .012, w / 2 - .1, 1.0, .05, 0xc8a24a);
      const lab = plane(g, .14, .07, artM, labelUV(labels.indexOf(id)));lab.position.set(0, 1.6, .052);
      const hit = new T.Mesh(new T.BoxGeometry(w, hgt, .06), hidden);hit.position.set(0, hgt / 2, .03);hit.userData = {lockedDoor: true, partName: `Flat ${id}${name ? ' · ' + name : ''}`, keep: true};g.add(hit);hitboxes.push(hit);
      pbox(g, .6, .012, .4, 0, .006, .3, 0x3c3631);// door mat
    }
    for (let n = 1; n < data.floors; n++) {lockedDoor(n, 'north');lockedDoor(n, 'east');}
    // The top landing: grey-green tongue-and-groove panelling on its side walls (video 3 s), the doorbell, the shoe rack.
    {
      const y = FL, pw = plane(inner, LD[3] - R[1], 2.2, panelling);pw.position.set(sw[1] + .006, y + 1.1, (R[1] + LD[3]) / 2);pw.rotation.y = Math.PI / 2;
      const pe = plane(inner, LD[3] - R[1], 2.2, panelling);pe.position.set(R[2] - .006, y + 1.1, (R[1] + LD[3]) / 2);pe.rotation.y = -Math.PI / 2;
      const bell = mesh(paint(new T.CylinderGeometry(.035, .035, .02, 16), 0xc8a24a), palette, inner);bell.rotation.z = Math.PI / 2;bell.position.set(sw[1] + .016, y + 1.42, R[1] + .1);
    }
    // Mailboxes and the doorbell board in the ground hall and at the yard door.
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {const mb = pbox(inner, .3, .34, .06, R[0] + .03, G + 1.15 + j * .36, 9.35 + i * .32, 0x6f7d74);mb.rotation.y = Math.PI / 2;}
    {
      const g = new T.Group();g.position.set(S.yardDoor.a[1] + .25, G, data.yard[1] + .015);shell.add(g);pbox(g, .16, .3, .02, 0, 1.35, 0, 0xb9b5aa);for (let i = 0; i < 6; i++) pbox(g, .03, .03, .015, -.04, 1.25 + i * .04, .015, 0x2a2a2a);
      const sign = plane(g, .26, .13, artM, labelUV(labels.indexOf('1C')));sign.position.set(-(S.yardDoor.a[1] - S.yardDoor.a[0]) / 2 - .25, S.yardDoor.height + .7, .01);
      const plate = plane(g, .6, .14, artM, labelUV(labels.indexOf('RATHKES GATE 1C')));plate.position.set(.25, 2.5, .01);
      const lamp = mesh(new T.SphereGeometry(.09, 12, 10), glow, g);lamp.position.set(-.3, S.yardDoor.height + .45, .15);lamp.castShadow = false;
    }
    const groundLamp = mesh(new T.SphereGeometry(.1, 12, 10), glow, inner);groundLamp.position.set((R[0] + sw[0]) / 2, L1 + 2.12, 9.9);groundLamp.castShadow = false;
    // Tower ceiling.
    box(inner, R[0], R[1], R[2], R[3], wallTop, wallTop + .1, ceilingM);

    // ---------- Doors that open (game doors, shared online) ----------
    // A door in a wall along a (or along b): hinge = jamb it turns on, into = side it opens toward. The leaf is an invisible box for
    // collision and aiming; its look is one merged mesh that turns with it.
    function gameDoor({id, name, wallRect, at, height, hinge, into, style, label, sound, swing}) {
      const alongA = wallRect[2] - wallRect[0] > wallRect[3] - wallRect[1], fr = new T.Group();inner.add(fr);
      const n0 = alongA ? wallRect[1] : wallRect[0], n1 = alongA ? wallRect[3] : wallRect[2];
      // Door frame: local x along the wall (from at[0]), local z across it (z = 0 the wall's low face, + toward n1).
      if (alongA) fr.position.set(at[0], 0, n0);else {fr.position.set(n1, 0, at[0]);fr.rotation.y = -Math.PI / 2;}
      const w = at[1] - at[0], t = n1 - n0, toPlus = into === '+', endHinge = hinge === 'a1' || hinge === 'b1', dir = endHinge ? -1 : 1;
      // In a wall along b the frame's z runs toward -a, so "+" (toward +a) is the frame's -z.
      const zSide = alongA ? (toPlus ? 1 : -1) : (toPlus ? -1 : 1), yb = style === 'yard' ? G : FL;
      for (const [z0, z1] of [[-.014, .0], [t, t + .014]]) {box(fr, -.06, z0, 0, z1, yb, yb + height + .06, trim);box(fr, w, z0, w + .06, z1, yb, yb + height + .06, trim);box(fr, -.06, z0, w + .06, z1, yb + height, yb + height + .06, trim);}
      const hingeG = new T.Group();hingeG.position.set(endHinge ? w - .02 : .02, yb, zSide > 0 ? t : 0);hingeG.userData.noMerge = true;fr.add(hingeG);
      const lw = w - .04, lh = height - .02, ld = .042, cz = -zSide * ld / 2;
      const leaf = new T.Mesh(new T.BoxGeometry(lw, lh, ld), hidden);leaf.position.set(dir * lw / 2, lh / 2 + .01, cz);hingeG.add(leaf);
      const look = new T.Group();hingeG.add(look);
      const hex = style === 'entrance' ? 0xc6c9c0 : style === 'yard' ? 0x5c3a22 : 0xf3f2ed;
      pbox(look, lw, lh, ld, dir * lw / 2, lh / 2 + .01, cz, hex);
      if (style === 'entrance' || style === 'panelled' || style === 'yard') for (const [yy, hh] of style === 'yard' ? [[.5, .6]] : [[.55, .75], [1.45, .85]]) for (const s of [-1, 1]) pbox(look, lw - .24, hh, .012, dir * lw / 2, yy, cz + s * (ld / 2 + .006), style === 'entrance' ? 0xb4b8ae : style === 'yard' ? 0x4a2e1a : 0xe6e5df);
      if (style === 'yard') {const pane = mesh(new T.BoxGeometry(lw - .28, .9, .012), glass, look);pane.position.set(dir * lw / 2, 1.45, cz);pane.castShadow = false;}
      const hx = dir * (lw - .08), metal = style === 'entrance' || style === 'yard' ? 0xc8a24a : 0xc4c8cb;
      for (const s of [-1, 1]) {pbox(look, .13, .022, .022, hx - dir * .05, 1.02, cz + s * (ld / 2 + .03), metal);pbox(look, .05, .15, .01, hx, 1.0, cz + s * (ld / 2 + .005), metal);}
      if (label !== undefined) {const out = -zSide, lab = plane(look, .14, .07, artM, labelUV(labels.indexOf(label)));lab.position.set(dir * lw / 2, 1.62, cz + out * (ld / 2 + .016));if (out < 0) lab.rotation.y = Math.PI;}
      lib.mergeStatic(look);
      leaf.userData.doorId = id;look.traverse(m => {if (m.isMesh) m.userData.doorId = id;});hitboxes.push(leaf);
      const openAngle = -zSide * dir * (swing ? swing * Math.PI / 180 : Math.PI / 2 * .97);
      doors.push({id, name, hinge: hingeG, leaf, open: false, openAngle, sound: sound || 'room'});
    }
    gameDoor({id: 'rathkes-1c-door', name: 'Door to stair 1C', wallRect: [R[0], data.yard[0], R[2], data.yard[1]], at: S.yardDoor.a, height: S.yardDoor.height - .02, hinge: 'a0', into: '-', style: 'yard', sound: 'street'});
    gameDoor({id: 'r501-entrance', name: 'Door of flat 501', wallRect: [R[0], R[1] - .12, R[2], R[1]], at: data.entrance.at, height: S.flatDoor.height - .02, hinge: data.entrance.hinge, into: data.entrance.into, swing: data.entrance.swing, style: 'entrance', label: '501', sound: 'entrance'});
    for (const w of data.walls) for (const op of w.openings || []) if (op.door) gameDoor({id: 'r501-' + op.door.id, name: op.door.name, wallRect: w.rect, at: op.at, height: 2.05, hinge: op.door.hinge, into: op.door.into, style: op.door.panelled ? 'panelled' : 'flush'});

    // ---------- The flat ----------
    for (const r of data.rooms) {
      const [a0, b0, a1, b1] = r.rect;box(inner, a0, b0, a1, b1, FL - .03, FL, r.floor === 'tile' ? tilesF : pine);
      const c = plane(inner, a1 - a0, b1 - b0, ceilingM);c.rotation.x = Math.PI / 2;c.position.set((a0 + a1) / 2, FL + CEIL, (b0 + b1) / 2);c.receiveShadow = true;
    }
    for (const f of flatFloors(data, lv)) if (f.name !== 'Bathroom' && !data.rooms.some(r => r.rect === f.rect)) box(inner, f.rect[0], f.rect[1], f.rect[2], f.rect[3], FL - .03, FL, pine);
    // Inner walls with their door openings; skirting boards; the bathroom's tiles.
    for (const w of data.walls) {
      const r = w.rect, alongA = r[2] - r[0] > r[3] - r[1];
      holed(inner, r[0], r[1], r[2], r[3], FL, FL + CEIL, (w.openings || []).map(o => ({a0: o.at[0], a1: o.at[1], y0: FL - .01, y1: FL + (o.top || 2.07)})), plaster);
      for (const o of w.openings || []) if (!o.door) {const [p, q] = o.at;for (const z of [alongA ? r[1] - .012 : r[0] - .012, alongA ? r[3] : r[2]]) {if (alongA) {box(inner, p - .06, z, p, z + .012, FL, FL + o.top + .06, trim);box(inner, q, z, q + .06, z + .012, FL, FL + o.top + .06, trim);box(inner, p - .06, z, q + .06, z + .012, FL + o.top, FL + o.top + .06, trim);}}}
    }
    // Skirting boards round the dry rooms, broken at the doorways.
    const gaps = [...data.walls.flatMap(w => (w.openings || []).map(o => ({w: w.rect, at: o.at}))), {w: [R[0], R[1] - .12, R[2], R[1]], at: data.entrance.at}];
    const skirt = (fixed, value, u0, u1, alongA, sign) => {
      let segs = [[u0, u1]];
      for (const g of gaps) {const gAlongA = g.w[2] - g.w[0] > g.w[3] - g.w[1];if (gAlongA !== alongA) continue;const lo = alongA ? g.w[1] : g.w[0], hi = alongA ? g.w[3] : g.w[2];if (value < lo - .02 || value > hi + .02) continue;segs = segs.flatMap(([p, q]) => [[p, Math.min(q, g.at[0])], [Math.max(p, g.at[1]), q]]).filter(([p, q]) => q - p > .02);}
      for (const [p, q] of segs) {const v0 = sign > 0 ? value : value - .012, v1 = v0 + .012;if (alongA) box(inner, p, v0, q, v1, FL, FL + .07, trim);else box(inner, v0, p, v1, q, FL, FL + .07, trim);}
    };
    for (const r of data.rooms) if (r.id !== 'bath') {const [a0, b0, a1, b1] = r.rect;skirt('b', b0, a0, a1, true, 1);skirt('b', b1, a0, a1, true, -1);skirt('a', a0, b0 + .012, b1 - .012, false, 1);skirt('a', a1, b0 + .012, b1 - .012, false, -1);}
    {const [a0, b0, a1, b1] = data.rooms.find(r => r.id === 'bath').rect, t = .012, door = data.walls.find(w => w.openings && w.openings.some(o => o.door && o.door.id === 'bath')).openings[0].at;
      box(inner, a0 + t, b0, a1 - t, b0 + t, FL, FL + CEIL - .01, tilesW);box(inner, a0 + t, b1 - t, a1 - t, b1, FL, FL + CEIL - .01, tilesW);box(inner, a1 - t, b0, a1, b1, FL, FL + CEIL - .01, tilesW);
      holed(inner, a0, b0, a0 + t, b1, FL, FL + CEIL - .01, [{a0: door[0], a1: door[1], y0: FL - .01, y1: FL + 2.07}], tilesW);}
    // The hall's soffit box.
    {const s = data.soffit;box(inner, s[0], s[1], s[2], s[3], FL + s[4], FL + CEIL, plaster);}

    // ---------- Furniture (as in the video) ----------
    const solids = [];// collision boxes in wing coordinates
    function piece(f) {
      const g = new T.Group();g.position.set(f.at[0], FL, f.at[1]);g.rotation.y = (f.rot || 0) * Math.PI / 2;inner.add(g);
      g.userData.solid = (w, h, d, x = 0, y = h / 2, z = 0) => {const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y), pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([px, pz]) => [f.at[0] + (x + px) * c + (z + pz) * s, f.at[1] - (x + px) * s + (z + pz) * c]);solids.push({pts, minY: FL + y - h / 2, maxY: FL + y + h / 2});};
      return g;
    }
    const K = {
      wardrobe(g, f) {
        const {w, d, h} = f, wd = f.wood ? oak : null, body = (ww, hh, dd, x, y, z) => wd ? box(g, x - ww / 2, z - dd / 2, x + ww / 2, z + dd / 2, y - hh / 2, y + hh / 2, wd) : pbox(g, ww, hh, dd, x, y, z, f.color);
        body(w, h, d - .02, 0, h / 2, -.01);for (const s of [-1, 1]) body(w / 2 - .006, h - .02, .018, s * w / 4, h / 2, d / 2 - .002);
        pbox(g, .006, h - .04, .006, 0, h / 2, d / 2 + .008, 0x101010);
        if (f.handles) for (const s of [-1, 1]) pbox(g, .015, .3, .02, s * .04, h * .5, d / 2 + .02, 0xbfc3c6);
        else for (const s of [-1, 1]) pcyl(g, .015, .015, .02, s * .06, h * .52, d / 2 + .012, f.wood ? 0x2a2a2a : 0xe8e2d4, 8).rotation.x = Math.PI / 2;
        if (f.top) f.top.forEach((c, i) => pbox(g, w * .42, .22, d * .7, (i - .5) * w * .45, h + .11, 0, c));
        if (f.shelf) {for (const x of [-w / 2 + .02, w / 2 - .02]) pbox(g, .03, .7, .3, x, h + .35, -.1, 0x2a201b);for (const y of [h + .3, h + .68]) pbox(g, w, .025, .3, 0, y, -.1, 0x5a4a3a);pbox(g, .3, .2, .22, -.2, h + .42, -.1, 0x6aa0a8);pbox(g, .2, .25, .2, .25, h + .43, -.1, 0xd8d0c0);}
        g.userData.solid(w, h, d);
      },
      box(g, f) {pbox(g, f.w, f.h, f.d, 0, f.h / 2, 0, f.color);pbox(g, f.w + .02, .03, f.d + .02, 0, f.h, 0, 0xcbb487);g.userData.solid(f.w, f.h, f.d);},
      dryingRack(g, f) {
        const {w, d, h} = f;for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) pbox(g, .015, h, .015, x, h / 2, z, 0xf2f2f2);
        for (let i = 0; i < 8; i++) pbox(g, w, .01, .01, 0, h, -d / 2 + i * d / 7, 0xf2f2f2);
        const cl = [0x2d3f8a, 0xc0392b, 0x2f8f6a, 0x1d1d1d, 0x3b5fae, 0x22324e];cl.forEach((c, i) => pbox(g, .32, .45, .012, -w / 2 + .2 + i * .19, h - .23, -d / 2 + .06 + (i % 4) * .13, c));
        g.userData.solid(w, h, d);
      },
      extinguisher(g) {pcyl(g, .07, .07, .45, 0, .225, 0, 0xc0281f);pcyl(g, .025, .025, .08, 0, .49, 0, 0x202020);g.userData.solid(.15, .5, .15);},
      coatRail(g, f) {
        pbox(g, f.w, .08, .025, 0, 1.78, .0125, 0x6b4a2e);for (let i = 0; i < 6; i++) pbox(g, .015, .05, .08, -f.w / 2 + .1 + i * (f.w - .2) / 5, 1.75, .06, 0xc0c0c0);
        [[0x2e6fd0, -.45], [0x1d1f24, -.2], [0x23262d, .05], [0x30333a, .3], [0x232020, .5]].forEach(([c, x], i) => {pbox(g, .42, .85, .16, x, 1.28, .12, c);pbox(g, .2, .12, .14, x, 1.68, .12, c);if (i === 1) pbox(g, .2, .1, .2, x + .1, 1.86, .1, 0x2b3a2a);});
        g.userData.solid(f.w, .95, .3, 0, 1.25, .15);
      },
      panel(g, f) {pbox(g, f.w, f.h, .05, 0, f.y + f.h / 2, .025, f.color);pcyl(g, .03, .03, .02, 0, f.y + f.h * .55, .055, 0xdddddd).rotation.x = Math.PI / 2;},
      intercom(g) {pbox(g, .1, .22, .04, 0, 1.45, .02, 0xf2f2f0);pbox(g, .05, .2, .04, -.01, 1.45, .055, 0xe4e4e2);},
      rug(g, f) {const r = box(g, -f.w / 2, -f.d / 2, f.w / 2, f.d / 2, .002, .012, rugM);if (r) {r.castShadow = false;const [u0, v0, u1, v1] = rugUV(f), uv = r.geometry.attributes.uv;for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * Math.min(1, Math.max(0, (uv.getX(i) + f.w / 2) / f.w)), v0 + (v1 - v0) * Math.min(1, Math.max(0, (uv.getY(i) + f.d / 2) / f.d)));}},
      stripedRug(g, f) {K.rug(g, f);},
      bed(g, f) {
        const {w, d} = f;pbox(g, w, .28, d, 0, .18, 0, f.frame);pbox(g, w - .04, .2, d - .06, 0, .42, .01, 0xf4f2ec);
        pbox(g, w - .02, .07, d * .7, 0, .54, d * .14, f.duvet);if (f.check) {for (let i = 1; i < 8; i++) pbox(g, .006, .072, d * .7, -w / 2 + i * w / 8, .545, d * .14, 0x9aa8d8);for (let i = 1; i < 6; i++) pbox(g, w - .03, .072, .006, 0, .545, d * .14 - d * .35 + i * d * .7 / 6, 0x9aa8d8);}
        for (const x of w > 1.3 ? [-w / 4, w / 4] : [0]) pbox(g, w > 1.3 ? w * .42 : w * .8, .12, .4, x, .58, -d / 2 + .28, 0xf6f4f0);
        pbox(g, w + .04, .7, .05, 0, .45, -d / 2 - .02, f.frame);g.userData.solid(w, .6, d + .05);
      },
      daybed(g, f) {
        const {w, d} = f;pbox(g, w, .22, d, 0, .34, 0, 0xf1f0ec);pbox(g, w - .02, .06, d - .1, 0, .48, .02, 0xd8dfcf);pbox(g, .5, .14, .55, -w / 2 + .35, .55, 0, 0xf6f4f0);
        for (const x of [-w / 2, w / 2]) {for (const z of [-d / 2, d / 2]) pbox(g, .03, .95, .03, x, .47, z, 0xf2f2f2);pbox(g, .02, .02, d, x, .95, 0, 0xf2f2f2);for (let i = 0; i < 5; i++) pbox(g, .015, .5, .015, x, .7, -d / 2 + (i + .5) * d / 5, 0xf2f2f2);}
        pbox(g, w, .02, .02, 0, .62, -d / 2, 0xf2f2f2);g.userData.solid(w, .6, d);
      },
      nightstand(g, f) {pbox(g, f.w, f.h, f.d, 0, f.h / 2, 0, f.color);pbox(g, .2, .04, .25, 0, f.h + .02, 0, 0x2f6b8a);g.userData.solid(f.w, f.h, f.d);},
      basket(g) {pcyl(g, .2, .17, .45, 0, .225, 0, 0xeae4d4, 16);g.userData.solid(.4, .45, .4);},
      curtains(g, f) {pbox(g, f.w + .1, .025, .025, 0, 2.7, .1, 0x8a8a8a);for (const s of [-1, 1]) pbox(g, .42, 2.6, .05, s * (f.w / 2 - .18), 1.38, .12, s > 0 && f.tapestry ? f.tapestry : f.color);},
      picture(g, f) {const p = plane(g, f.w, f.h, artM, cellUV(f.art));p.position.set(0, f.y + f.h / 2, .012);pbox(g, f.w + .03, f.h + .03, .012, 0, f.y + f.h / 2, .004, 0x2a2a2a);},
      radiator(g, f) {pbox(g, f.w, .55, .07, 0, .42, .1, 0xf3f3f0);for (let i = 0; i < Math.round(f.w / .08); i++) pbox(g, .012, .5, .008, -f.w / 2 + .04 + i * .08, .42, .138, 0xe4e4e0);},
      desk(g, f) {pbox(g, f.w, .03, f.d, 0, .73, 0, f.color);for (const x of [-f.w / 2 + .04, f.w / 2 - .04]) for (const z of [-f.d / 2 + .04, f.d / 2 - .04]) pbox(g, .035, .72, .035, x, .36, z, 0x5a3a20);pbox(g, .9, .04, .28, 0, .765, .05, 0x1a1a1a);for (let i = 0; i < 14; i++) pbox(g, .05, .012, .14, -.4 + i * .062, .79, .08, 0xf4f4f4);pbox(g, .25, .15, .2, .4, .82, -.15, 0xb8442e);g.userData.solid(f.w, .76, f.d);},
      mirrorWardrobe(g, f) {pbox(g, f.w, f.h, f.d - .03, 0, f.h / 2, -.015, 0xefefea);for (const s of [-1, 1]) {const m = box(g, s > 0 ? .005 : -f.w / 2 + .02, f.d / 2 - .02, s > 0 ? f.w / 2 - .02 : -.005, f.d / 2 - .005, .05, f.h - .05, chrome);if (m) m.castShadow = false;}g.userData.solid(f.w, f.h, f.d);},
      builtIn(g, f) {const h = CEIL;pbox(g, f.w, h, f.d - .02, 0, h / 2, -.01, 0xf1f0eb);for (const s of [-1, 1]) {pbox(g, f.w / 2 - .008, h - .02, .018, s * f.w / 4, h / 2, f.d / 2 - .01, 0xf6f5f1);pbox(g, .015, .3, .02, s * .05, 1.05, f.d / 2 + .01, 0xbfc3c6);}pbox(g, f.w, .006, .02, 0, 2.25, f.d / 2 + .002, 0xdedcd5);g.userData.solid(f.w, h, f.d);},
      floorLamp(g) {pcyl(g, .14, .14, .02, 0, .01, 0, 0x222222);pcyl(g, .012, .012, 1.5, 0, .76, 0, 0x222222);const s = mesh(new T.CylinderGeometry(.13, .18, .24, 16, 1, true), glow, g);s.position.y = 1.55;s.castShadow = false;g.userData.solid(.3, 1.6, .3);},
      trolley(g) {for (const x of [-.22, .22]) for (const z of [-.16, .16]) pbox(g, .015, .8, .015, x, .4, z, 0x1b1b1b);for (const y of [.1, .42, .76]) pbox(g, .45, .02, .35, 0, y, 0, 0x1b1b1b);const bk = [0xd8c27a, 0x8a2f28, 0x2f4d6b, 0xe6e1d6, 0x3d5a3a];bk.forEach((c, i) => pbox(g, .03, .22, .2, -.15 + i * .05, .54, 0, c));pcyl(g, .07, .06, .12, .12, .84, 0, 0x6b4a2e);pbox(g, .18, .2, .18, .12, 1.0, 0, 0x3f7a3a);g.userData.solid(.48, .8, .38);},
      dresser(g, f) {pbox(g, f.w, f.h, f.d, 0, f.h / 2, 0, f.color);for (let i = 1; i < 3; i++) pbox(g, f.w - .04, .006, .01, 0, i * f.h / 3, f.d / 2 + .003, 0x3a3a3a);pbox(g, .3, .35, .02, -.15, f.h + .18, -.12, 0x6d4c8a);pbox(g, .2, .25, .02, .2, f.h + .13, -.1, 0xe7e2d8);pcyl(g, .07, .07, .1, .3, f.h + .05, .05, 0xf3f3f3);g.userData.solid(f.w, f.h, f.d);},
      foldingChair(g) {for (const x of [-.24, .24]) {pbox(g, .03, .9, .03, x, .45, -.2, 0x9a6a3a);pbox(g, .03, .6, .03, x, .3, .25, 0x9a6a3a);}const s = pbox(g, .48, .03, .55, 0, .42, 0, 0x7a5232);s.rotation.x = -.25;pbox(g, .5, .35, .15, 0, .55, .1, 0x2f3c6e);g.userData.solid(.55, .9, .6);},
      kitchen(g, f) {
        const L = f.rect[3] - f.rect[1], D = f.rect[2] - f.rect[0], x0 = -L / 2, z0 = -D / 2;
        pbox(g, L, .1, D - .08, 0, .05, -.04, 0x111111);pbox(g, L, .765, D - .03, 0, .1 + .765 / 2, -.015, 0x1c1c1e);
        box(g, x0, z0, x0 + L, z0 + D + .01, .865, .9, birch);
        let x = x0;for (const [len, kind] of [[.4, 'door'], [.6, 'oven'], [.8, 'drawers'], [.6, 'sink'], [.6, 'door'], [.6, 'dw']]) {
          const c = x + len / 2;
          if (kind === 'oven') {pbox(g, len - .02, .6, .02, c, .48, D / 2 + .001, 0x9fa4a8);pbox(g, len - .1, .38, .01, c, .44, D / 2 + .012, 0x111418);pbox(g, len - .12, .02, .03, c, .72, D / 2 + .03, 0xd0d4d6);pbox(g, len - .04, .006, .52, c, .903, 0, 0x0d0d0f);}
          else if (kind === 'sink') {pbox(g, len - .06, .006, .42, c, .903, 0, 0xb9bec1);pbox(g, len - .16, .006, .32, c, .906, .01, 0x8e9497);pcyl(g, .014, .014, .3, c, 1.05, -.2, 0xc8ccce, 10);pbox(g, .02, .02, .2, c, 1.2, -.12, 0xc8ccce);pbox(g, len - .01, .74, .015, c, .48, D / 2 - .003, 0x232325);}
          else if (kind === 'drawers') for (let i = 0; i < 3; i++) pbox(g, len - .01, .24, .015, c, .23 + i * .25, D / 2 - .003, 0x232325);
          else pbox(g, len - .01, .74, .015, c, .48, D / 2 - .003, 0x232325);
          x += len;
        }
        pbox(g, L - .15, .7, .35, .075, 1.85, z0 + .175, 0x1c1c1e);for (let i = 0; i < 6; i++) pbox(g, .005, .68, .005, -L / 2 + .15 + i * (L - .15) / 6, 1.85, z0 + .353, 0x0a0a0a);
        for (const [cx, c] of [[-1.3, 0xd2b07a], [-.5, 0xc9a56e], [.3, 0xd2b07a], [1.1, 0xc9a56e]]) {pbox(g, .5, .28, .3, cx, 2.34, z0 + .17, c);pbox(g, .46, .02, .26, cx, 2.43, z0 + .17, 0x5a4a32);}
        for (const cx of [-1.0, 1.4]) {pcyl(g, .05, .07, .12, cx, 2.62, z0 + .2, 0x9aa0a4);pcyl(g, .01, .01, .3, cx, 2.45, z0 + .25, 0x9aa0a4);const b = mesh(new T.SphereGeometry(.04, 10, 8), glow, g);b.position.set(cx, 2.55, z0 + .2);b.castShadow = false;}
        pbox(g, 2.2, .015, .015, -.5, 1.42, z0 + .05, 0xc0c4c6);[[-1.4, .1, 0x1e1e1e], [-1.05, .13, 0x8a8f92], [-.7, .11, 0x8a8f92], [-.35, .14, 0x1e1e1e], [0, .12, 0x8a8f92], [.35, .1, 0x9e3b2c]].forEach(([px, r, c]) => {pcyl(g, r, r, .08, px, 1.2, z0 + .1, c, 14).rotation.x = Math.PI / 2;pbox(g, .015, .12, .015, px, 1.34, z0 + .05, 0xc0c4c6);});
        g.userData.solid(L, .9, D);
      },
      pipe(g, f) {pcyl(g, .05, .05, f.h, 0, f.h / 2, 0, 0x9da3a6, 10);g.userData.solid(.12, f.h, .12);},
      sideboard(g, f) {pbox(g, f.w, .03, f.d, 0, f.h, 0, 0x1a1a1a);pbox(g, f.w - .04, f.h - .2, f.d - .04, 0, (f.h - .2) / 2 + .18, 0, 0xc8a26a);for (let i = 0; i < 18; i++) pbox(g, .012, f.h - .22, .006, -f.w / 2 + .05 + i * (f.w - .1) / 17, (f.h - .2) / 2 + .18, f.d / 2 - .015, 0x9a7444);for (const x of [-f.w / 2 + .05, f.w / 2 - .05]) for (const z of [-f.d / 2 + .05, f.d / 2 - .05]) pbox(g, .02, .18, .02, x, .09, z, 0x111111);pbox(g, .3, .36, .4, -.15, f.h + .2, -.02, 0xb9bec1);pbox(g, .18, .2, .2, -.15, f.h + .3, .2, 0x2a2a2a);pcyl(g, .06, .06, .3, .3, f.h + .15, 0, 0x222222);g.userData.solid(f.w, f.h + .4, f.d);},
      records(g, f) {const s = .31;for (let i = 0; i < 9; i++) {const p = plane(g, s, s, artM, cellUV(4 + i));p.position.set(-s - .02 + (i % 3) * (s + .02), f.y + s / 2 + Math.floor(i / 3) * (s + .02), .006);}},
      diningTable(g, f) {
        pbox(g, f.w, .04, f.d, 0, .74, 0, 0x151515);for (const x of [-f.w / 2 + .06, f.w / 2 - .06]) for (const z of [-f.d / 2 + .08, f.d / 2 - .08]) pbox(g, .05, .72, .05, x, .36, z, 0x151515);
        for (const side of [-1, 1]) for (const z of [-.62, 0, .62]) {const c = new T.Group();c.position.set(side * (f.w / 2 + .12), 0, z);c.rotation.y = side * Math.PI / 2;g.add(c);pbox(c, .42, .04, .42, 0, .45, 0, 0x1d1d1f);for (const x of [-.18, .18]) for (const zz of [-.18, .18]) pbox(c, .03, .45, .03, x, .225, zz, 0x1d1d1f);pbox(c, .42, .3, .03, 0, .72, .2, 0x1d1d1f);}
        pcyl(g, .06, .05, .2, 0, .86, -.2, 0x2a6fd0);for (const [x, z, c] of [[0, -.2, 0xe0601f], [.06, -.14, 0xc0281f], [-.05, -.25, 0xf0a020]]) pbox(g, .1, .1, .1, x, 1.0, z, c);
        g.userData.solid(f.w + .5, .9, f.d);
      },
      sofa(g, f) {
        const {w, d} = f, s = (ww, hh, dd, x, y, z) => box(g, x - ww / 2, z - dd / 2, x + ww / 2, z + dd / 2, y - hh / 2, y + hh / 2, sofaM);
        s(w, .2, d, 0, .25, 0);s(w, .5, .2, 0, .6, -d / 2 + .1);for (const x of [-w / 2 + .08, w / 2 - .08]) s(.16, .32, d, x, .48, 0);for (const x of [-.6, 0, .6]) s(.6, .12, d - .25, x, .41, .1);
        for (const x of [-w / 2 + .06, w / 2 - .06]) for (const z of [-d / 2 + .06, d / 2 - .06]) pbox(g, .03, .15, .03, x, .075, z, 0x6b4a2e);pbox(g, .5, .03, .7, .55, .49, .05, 0xb9bcbd);
        g.userData.solid(w, .85, d);
      },
      coffeeTable(g, f) {box(g, -f.w / 2, -f.d / 2, f.w / 2, f.d / 2, f.h - .035, f.h, teak);for (const x of [-f.w / 2 + .05, f.w / 2 - .05]) for (const z of [-f.d / 2 + .05, f.d / 2 - .05]) pbox(g, .04, f.h - .035, .04, x, (f.h - .035) / 2, z, 0x6a3a1e);pbox(g, .3, .02, .22, -.2, f.h + .01, 0, 0xd8d0c0);g.userData.solid(f.w, f.h, f.d);},
      slingChair(g) {for (const x of [-.32, .32]) {pbox(g, .05, .05, .85, x, .05, 0, 0x2a1a12);const a = pbox(g, .05, .05, .7, x, .45, -.05, 0x2a1a12);a.rotation.x = .5;pbox(g, .05, .45, .05, x, .27, .3, 0x2a1a12);}const s = pbox(g, .6, .03, .5, 0, .33, .12, 0x7a3e1e);s.rotation.x = .18;const bk = pbox(g, .6, .03, .5, 0, .58, -.22, 0x7a3e1e);bk.rotation.x = -1.0;g.userData.solid(.75, .8, .8);},
      wallUnit(g, f) {
        const w = f.w, z0 = -.175;for (let i = 0; i <= 4; i++) box(g, -w / 2 + i * w / 4 - .015, z0 - .02, -w / 2 + i * w / 4 + .015, z0 + .02, 0, 2.15, teak);
        const T2 = (x0, x1, y0, y1, d) => box(g, x0, z0, x1, z0 + d, y0, y1, teak);
        T2(-w / 2, -w / 4, .25, .8, .45);T2(-w / 4, 0, .7, .74, .45);T2(0, w / 4, .3, .85, .42);T2(w / 4, w / 2, .3, .85, .42);
        for (const [a0, a1, y] of [[-w / 2, 0, 1.15], [-w / 2, w / 2, 1.5], [0, w / 2, 1.18], [-w / 2, -w / 4, 1.92], [0, w / 2, 1.95]]) T2(a0, a1, y, y + .025, .3);T2(-w / 4, 0, 1.6, 2.0, .35);
        for (let i = 0; i < 3; i++) pbox(g, w / 4 - .04, .005, .01, -w * 3 / 8, .42 + i * .16, z0 + .455, 0x4a2a14);
        const bk = [0x8c2f28, 0x2f4d6b, 0xd8cdb2, 0x3d5a3a, 0x1f1f22, 0xc9a24a, 0x6b4a7a, 0xe6e1d6];for (const [x0, y, n] of [[-w / 2 + .05, 1.175, 22], [.05, 1.205, 18], [-w / 2 + .1, 1.525, 14]]) for (let i = 0; i < n; i++) pbox(g, .028, .2 + (i % 3) * .02, .2, x0 + i * .032, y + .11, z0 + .12, bk[(i * 5) % bk.length]);
        pbox(g, .38, .1, .32, w / 4 + .3, .9, z0 + .2, 0xb9bec1);pcyl(g, .14, .14, .01, w / 4 + .3, .955, z0 + .2, 0x111111, 18);
        const sh = mesh(new T.CylinderGeometry(.09, .12, .14, 14, 1, true), glowOrange, g);sh.position.set(-w / 8, .92, z0 + .25);sh.castShadow = false;pcyl(g, .06, .07, .15, -w / 8, .82, z0 + .25, 0x1a1a1a);
        const lava = mesh(new T.CylinderGeometry(.04, .06, .3, 12), lavaM, g);lava.position.set(w / 4 + .3, 1.36, z0 + .15);lava.castShadow = false;
        const wl = mesh(new T.CylinderGeometry(.1, .13, .16, 14, 1, true), glowOrange, g);wl.position.set(-w / 2 + .5, 2.1, z0 + .2);wl.castShadow = false;
        g.userData.solid(w, .85, .45, 0, .425, z0 + .225);
      },
      tv(g) {pbox(g, .35, .5, .3, 0, .25, 0, 0x1b1b1b);pbox(g, 1.25, .74, .05, 0, .87, 0, 0x0c0c0c);const s = plane(g, 1.2, .68, screen);s.position.set(0, .87, .027);pbox(g, .25, .45, .25, .85, .225, -.05, 0x5a3a24);g.userData.solid(1.3, 1.25, .35);},
      guitar(g) {const b = pcyl(g, .17, .17, .1, 0, .3, 0, 0xc98a4a, 16);b.rotation.x = Math.PI / 2;b.rotation.z = .12;pcyl(g, .13, .13, .1, 0, .58, 0, 0xc98a4a, 16).rotation.x = Math.PI / 2;pbox(g, .05, .55, .03, -.04, .95, 0, 0x3a2414);g.userData.solid(.35, 1.2, .15);},
      plant(g, f) {pcyl(g, .14, .11, .25, 0, .125, 0, 0x2b2b2b, 14);for (let i = 0; i < 7; i++) {const l = pbox(g, .28, .02, .14, Math.cos(i) * .12, .3 + (i / 7) * f.h * .7, Math.sin(i * 2) * .12, i % 2 ? 0x2f6b2f : 0x3f8a3a);l.rotation.y = i * .9;l.rotation.z = .3;}g.userData.solid(.35, f.h, .35);},
      shoeRack(g) {for (const y of [.08, .26, .44]) {pbox(g, .8, .012, .012, 0, y, -.1, 0x1b1b1b);pbox(g, .8, .012, .012, 0, y + .03, .1, 0x1b1b1b);}for (const x of [-.4, .4]) pbox(g, .015, .5, .25, x, .25, 0, 0x1b1b1b);[0xf0a020, 0x6a6a6a, 0xd94a2a, 0x2a2a2a, 0x8a7a6a, 0x3a5a8a].forEach((c, i) => pbox(g, .11, .08, .26, -.3 + (i % 3) * .28, .12 + Math.floor(i / 3) * .2, 0, c));g.userData.solid(.82, .5, .3);}
    };
    for (const f of data.furniture) {
      if (f.kind === 'kitchen') {K.kitchen(piece({at: [(f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2], rot: f.rot}), f);continue;}
      const g = piece(f);if (K[f.kind]) K[f.kind](g, f);
    }
    // Ceiling lamps of the rooms (as in the video: paper globe, dark metal shade, orange drum, round ceiling lamps).
    const lampKinds = {hall: 'flush', bed1: 'globe', bed2: 'cone', bed3: 'flush', bed4: 'drum', living: 'cone', bath: 'flush'};
    for (const r of data.rooms) for (const [a, b, kind] of r.lamps) {
      const k = kind || lampKinds[r.id];if (k === 'none') continue;const g = new T.Group();g.position.set(a, FL + CEIL, b);inner.add(g);
      if (k === 'flush') {const s = mesh(new T.SphereGeometry(.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glow, g);s.rotation.x = Math.PI;s.castShadow = false;}
      else {pcyl(g, .006, .006, .55, 0, -.27, 0, 0x222222, 6);const sh = k === 'globe' ? new T.SphereGeometry(.2, 16, 12) : k === 'drum' ? new T.CylinderGeometry(.22, .22, .24, 18, 1, true) : new T.ConeGeometry(.18, .2, 16, 1, false);const s = mesh(sh, k === 'cone' ? palette : k === 'drum' ? glowOrange : glow, g);s.position.y = k === 'globe' ? -.75 : -.62;s.castShadow = false;if (k === 'cone') {paint(s.geometry, r.id === 'bed2' ? 0x1f3a2a : 0x1a1a1a);const bulb = mesh(new T.SphereGeometry(.05, 10, 8), glow, g);bulb.position.y = -.74;bulb.castShadow = false;} else if (k === 'drum') {const bulb = mesh(new T.SphereGeometry(.06, 10, 8), glow, g);bulb.position.y = -.66;bulb.castShadow = false;}}
    }
    // The bathroom (not in the video): vanity and basin with a mirror cabinet, wall-hung toilet, shower corner, washer, towel radiator.
    {
      const B = data.bathroom, y = FL;
      const v = new T.Group();v.position.set(B.vanity[0], y, B.vanity[1]);inner.add(v);pbox(v, .6, .45, .46, 0, .6, .23, 0xf4f4f2);box(v, -.3, 0, .3, .48, .83, .86, ceramic);pcyl(v, .012, .012, .14, 0, .93, .07, 0xd8dcde, 8);pbox(v, .6, .6, .14, 0, 1.6, .07, 0xf4f4f2);const mr = box(v, -.29, .14, .29, .146, 1.32, 1.88, chrome);if (mr) mr.castShadow = false;const lb = mesh(new T.BoxGeometry(.5, .04, .06), glow, v);lb.position.set(0, 1.95, .1);
      const t = new T.Group();t.position.set(B.toilet[0], y, B.toilet[1]);inner.add(t);pbox(t, .5, 1.1, .2, 0, .55, .1, 0xf1f1ef);box(t, -.18, .2, .18, .72, .3, .42, ceramic);box(t, -.17, .2, .17, .7, .42, .45, ceramic);pbox(t, .2, .14, .01, 0, 1.0, .205, 0xd8dcde);
      const [s0, sb0, s1, sb1] = B.shower;const sc = box(inner, s0 - .005, sb0, s0 + .005, sb1, y, y + 2.0, glass);if (sc) sc.castShadow = false;pcyl(inner, .012, .012, 1.0, s1 - .06, y + 1.4, (sb0 + sb1) / 2, 0xd8dcde, 8);pcyl(inner, .1, .1, .015, s1 - .3, y + 2.05, (sb0 + sb1) / 2, 0xd8dcde, 16);pbox(inner, .12, .004, .12, (s0 + s1) / 2, y + .002, (sb0 + sb1) / 2, 0x2a2a2a);
      const wm = new T.Group();wm.position.set(B.washer[0], y, B.washer[1]);wm.rotation.y = Math.PI;inner.add(wm);pbox(wm, .6, .85, .58, 0, .425, .29, 0xf6f6f4);pcyl(wm, .17, .17, .02, 0, .5, .59, 0x30363a, 20).rotation.x = Math.PI / 2;
      const tr = new T.Group();tr.position.set(B.towels[0], y, B.towels[1]);tr.rotation.y = Math.PI;inner.add(tr);for (let i = 0; i < 9; i++) pbox(tr, .5, .02, .02, 0, .7 + i * .11, .06, 0xd8dcde);for (const x of [-.25, .25]) pbox(tr, .025, 1.0, .025, x, 1.15, .06, 0xd8dcde);pbox(tr, .45, .5, .03, 0, 1.2, .09, 0x6f9ab0);
      pcyl(inner, .07, .07, .02, 12.9, y + CEIL - .01, 6.6, 0xe9e9e6, 14);
      solids.push(...[[B.vanity[0] - .3, B.vanity[1], B.vanity[0] + .3, B.vanity[1] + .48, .9], [B.toilet[0] - .2, B.toilet[1], B.toilet[0] + .2, B.toilet[1] + .72, .5], [B.washer[0] - .3, B.washer[1] - .58, B.washer[0] + .3, B.washer[1], .85], [s0 - .01, sb0, s0 + .01, sb1, 2.0]].map(([a0, b0, a1, b1, h]) => ({pts: [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], minY: y, maxY: y + h})));
    }

    // ---------- Bake: one mesh per material (doors and look targets stay separate) ----------
    const keep = m => m.userData.doorId || m.userData.keep;
    inner.updateMatrixWorld(true);shell.updateMatrixWorld(true);backing.updateMatrixWorld(true);
    lib.mergeStatic(shell, keep);lib.mergeStatic(inner, keep);lib.mergeStatic(backing, keep);
    inner.traverse(o => {if (o.isMesh) o.castShadow = false;});
    backing.visible = false;

    // ---------- Collision and queries (world coordinates) ----------
    const toW = (a, b) => {const [x, s] = F.toLocal(a, b);return world.toWorld(x, s);};
    const wingOf = (x, z) => {const l = world.toLocal(x, z);return F.toWing(l.x, l.s);};
    const pts = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([a, b]) => toW(a, b));
    const terrainAt = (a, b) => yardAt(a, b);
    const floorOut = f => ({name: f.name, points: pts(f.rect), ceilingHeight: f.ceiling || 2.6, surfaceKind: f.kind || (f.landing === data.floors ? 'wood' : 'stone'), ...(f.h ? {height: p => {const [a, b] = wingOf(p.x, p.z);return f.h(a, b);}} : {y: f.y})});
    const floors = [...stairFloors(data, lv, terrainAt), ...flatFloors(data, lv)].map(floorOut);
    const obstaclesW = [...obstacles(data, lv, bottom, TOP).map(o => ({points: pts(o.rect), minY: o.minY, maxY: o.maxY, kind: 'building'})),
      ...solids.map(s => ({points: s.pts.map(([a, b]) => toW(a, b)), minY: s.minY, maxY: s.maxY, kind: 'furniture'}))];
    const whereW = (x, z, feet) => {const [a, b] = wingOf(x, z);return where(data, lv, a, b, feet);};
    function lampW(x, z, feet) {const [a, b] = wingOf(x, z), l = lampAt(data, lv, a, b, feet);if (!l) return null;const p = toW(l.a, l.b);return {x: p.x, y: l.y, z: p.z, power: l.power, reach: l.reach};}
    const roomName = id => (data.rooms.find(r => r.id === id) || {}).name;
    function placeName(x, z, feet) {const w = whereW(x, z, feet);if (!w) return null;return w.place === 'flat' ? `Rathkes gate 1C, flat 501 · ${roomName(w.room)}` : `Stair 1C, Rathkes gate 1 · ${w.level < 1 ? 'ground floor' : w.level + '. floor'}`;}
    // Show the rooms only from close by (from further away the windows are dark).
    const centre = toW(6.8, 5.6);let shown = true;
    function tick(camera) {const p = camera.position, near = Math.hypot(p.x - centre.x, p.z - centre.z) < 70;if (near !== shown) {shown = near;inner.visible = near;backing.visible = !near;}}
    const yd = toW((S.yardDoor.a[0] + S.yardDoor.a[1]) / 2, data.yard[1] + 1.2);
    const stats = {meshes: 0, triangles: 0};group.traverse(o => {if (o.isMesh && o.material !== hidden) {stats.meshes++;const g = o.geometry;stats.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;}});
    return {group, far, floors, obstacles: obstaclesW, doors, hitboxes, inside: (x, z, feet) => whereW(x, z, feet), lampAt: lampW, placeName, tick, stats, levels: lv, yardDoor: {x: yd.x, z: yd.z, y: lv.G}, frame: F, toWorld: toW,
      spawn: {flat: toW(5.05, 5.7), stairTop: toW(5.6, 7.1), FL}};
  }

  return {frame, cut, levels, stairFloors, flatFloors, obstacles, where, lampAt, turnHeight, clipHalf, area, build};
});
