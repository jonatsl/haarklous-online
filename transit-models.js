/* Trams, buses and metro trains, and the stops (issue #111): the three.js models in the game's light style.
 * TransitModels.create({T}) -> {
 *   kinds: {tram, bus, artic, metro} each {sections: [{len, gap}], width, floor, height, seats, doorSides, make(sign) -> Vehicle},
 *   sign(line, dir) -> CanvasTexture (line number and destination, LED on black; cached),
 *   pole(...)/shelter(...) builders, board canvas helpers }
 * A Vehicle = {group, sections: [{group, len, doorsOpen(f), interior}], setDoors(f, side), setInterior(on)}; each section's local +z is
 * forward, y up, +x its LEFT side (a model facing +z has its right on -x): door side +1 = left, -1 = right (a bus's doors) from the rail / road; the section's origin is the middle of its floor line at the ground.
 * Geometry is built once per section type with vertex colours (one opaque body mesh, one glass mesh, one interior mesh and
 * one door mesh per section) and shared by every vehicle; only the destination sign differs per line and direction.
 * Real looks: Oslo's SL18 tram (CAF Urbos, 5 sections, 34 m, Ruter blue), Ruter's red city buses (12 m and articulated
 * 18 m), and the MX3000 metro train (6 cars of 18 m, white-grey with the black window band).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransitModels = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // ---------- Kinds (pure numbers, also used by the collision footprints and the seats) ----------
  const KINDS = {
    tram: {width: 2.65, height: 3.55, floor: .35, sections: [{len: 8.4}, {len: 5.2}, {len: 6.8}, {len: 5.2}, {len: 8.4}], gap: .35, doors: [[0, [-1.2]], [1, [0]], [2, [-1.8, 1.8]], [3, [0]], [4, [1.2]]], both: true, cabs: [0, 4]},
    bus: {width: 2.55, height: 3.05, floor: .34, sections: [{len: 12}], gap: 0, doors: [[0, [-4.6, .4, 4.5]]], both: false, cabs: [0]},
    artic: {width: 2.55, height: 3.05, floor: .34, sections: [{len: 11.2}, {len: 6.4}], gap: .5, doors: [[0, [-4.2, 1.2]], [1, [-.6]]], both: false, cabs: [0]},
    metro: {width: 3.16, height: 3.65, floor: 1.1, sections: Array.from({length: 6}, () => ({len: 17.7})), gap: .45, doors: Array.from({length: 6}, (_, i) => [i, [-5.3, 0, 5.3]]), both: true, cabs: [0, 5]}
  };
  for (const k of Object.values(KINDS)) k.length = k.sections.reduce((a, s) => a + s.len, 0) + k.gap * (k.sections.length - 1);
  const DOOR_W = {tram: 1.3, bus: 1.2, artic: 1.2, metro: 1.4};
  // Seats in a section's frame: [x, z, facing (+1 forward, -1 back)] for the riders (the player and others in the lobby).
  function seats(kind) {
    const K = KINDS[kind], out = [];
    K.sections.forEach((s, si) => {
      const doorZ = (K.doors.find(d => d[0] === si) || [0, []])[1], w = K.width / 2 - .55;
      for (let z = -s.len / 2 + 1.2; z <= s.len / 2 - 1.0; z += 1.7) {
        if (doorZ.some(dz => Math.abs(dz - z) < DOOR_W[kind] / 2 + .6)) continue;
        if (K.cabs.includes(si) && (si === 0 ? z > s.len / 2 - 2.6 : z < -s.len / 2 + 2.6)) continue;
        for (const x of [-w, w]) out.push({section: si, x, z, face: z > 0 ? -1 : 1});
      }
    });
    return out;
  }
  // Doors in a section's frame: {section, z, side (+1 right, -1 left)}.
  function doors(kind) {
    const K = KINDS[kind], out = [];
    for (const [si, zs] of K.doors) for (const z of zs) {out.push({section: si, z, side: -1});if (K.both) out.push({section: si, z, side: 1});}
    return out;
  }
  function create({T}) {
    // ---------- A tiny vertex-coloured geometry builder ----------
    function Builder() {
      const pos = [], nor = [], col = [];
      const c3 = hex => {const c = new T.Color(hex);return [c.r, c.g, c.b];};
      function tri(a, b, c, n, k) {pos.push(...a, ...b, ...c);for (let i = 0; i < 3; i++) {nor.push(...n);col.push(...k);}}
      function quad(a, b, c, d, hex) {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];const L = Math.hypot(...n) || 1;n = n.map(x => x / L);
        const k = typeof hex === 'number' ? c3(hex) : hex;tri(a, b, c, n, k);tri(a, c, d, n, k);
      }
      // An axis box; skip = faces to leave out ('px','nx','py','ny','pz','nz').
      function box(x0, y0, z0, x1, y1, z1, hex, skip = '') {
        const k = c3(hex);
        if (!skip.includes('px')) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], k);
        if (!skip.includes('nx')) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], k);
        if (!skip.includes('py')) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], k);
        if (!skip.includes('ny')) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], k);
        if (!skip.includes('pz')) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
        if (!skip.includes('nz')) quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], k);
      }
      // A cylinder along x (a wheel).
      function wheel(x0, x1, y, z, r, hex, hub) {
        const n = 14, k = c3(hex), h = c3(hub);
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2, p = t => [y + Math.cos(t) * r, z + Math.sin(t) * r];
          const [ya, za] = p(a), [yb, zb] = p(b);
          quad([x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za], k);
          for (const [x, s] of [[x0, -1], [x1, 1]]) tri([x, y, z], s > 0 ? [x, ya, za] : [x, yb, zb], s > 0 ? [x, yb, zb] : [x, ya, za], [s, 0, 0], h);
        }
      }
      function geometry() {
        const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        g.computeBoundingSphere();return g;
      }
      return {quad, box, wheel, tri, geometry, get empty() {return !pos.length;}};
    }
    const M = {
      body: new T.MeshStandardMaterial({vertexColors: true, roughness: .45, metalness: .15}),
      glass: new T.MeshStandardMaterial({color: 0x1c2833, roughness: .08, metalness: .3, transparent: true, opacity: .55, depthWrite: false}),
      interior: new T.MeshStandardMaterial({vertexColors: true, roughness: .7, side: T.DoubleSide, emissive: 0x2a2620, emissiveIntensity: .6}),
      door: new T.MeshStandardMaterial({vertexColors: true, roughness: .3, metalness: .2})
    };
    // ---------- Section geometry per kind ----------
    const LOOK = {
      tram: {body: 0x1f5fb4, lower: 0x173f78, roof: 0xc9ced3, skirt: 0x2b2f33, mask: 0x111417, door: 0x3a4a5c, seat: 0x2d5fa8, pole: 0xf2c200, floor: 0x55585b, wall: 0xdfe3e6},
      bus: {body: 0xd5121b, lower: 0xb10f17, roof: 0xd8dadc, skirt: 0x2b2f33, mask: 0x111417, door: 0x3a3f45, seat: 0x7c1c22, pole: 0xf2c200, floor: 0x4c4f52, wall: 0xe6e6e2},
      metro: {body: 0xdfe3e7, lower: 0xb9c0c7, roof: 0xb3b9bf, skirt: 0x30353a, mask: 0x101215, door: 0x9aa3ab, seat: 0x3b5d8c, pole: 0xf2c200, floor: 0x5d6064, wall: 0xeef0f0}
    };
    const lookOf = kind => LOOK[kind === 'artic' ? 'bus' : kind];
    function sectionGeometry(kind, si) {
      const K = KINDS[kind], L = lookOf(kind), S = K.sections[si], hl = S.len / 2, hw = K.width / 2, fl = K.floor;
      const sill = fl + (kind === 'metro' ? .85 : .75), top = K.height - (kind === 'metro' ? .55 : .5), H = K.height;
      const dz = (K.doors.find(d => d[0] === si) || [0, []])[1], dw = DOOR_W[kind] / 2;
      const cabFront = K.cabs.includes(si) && (si === 0), cabBack = K.cabs.includes(si) && si === K.sections.length - 1 && K.cabs.length > 1;
      const body = Builder(), glass = Builder(), inside = Builder(), doorR = Builder(), doorL = Builder(), bottom = kind === 'metro' ? .55 : .18;
      // Side panels with gaps at the doors (both sides; a bus has its doors on the right only).
      const spans = (side) => {
        const cuts = (side < 0 || K.both) ? dz.map(z => [z - dw, z + dw]).sort((a, b) => a[0] - b[0]) : [];
        const out = [];let z0 = -hl;for (const [a, b] of cuts) {out.push([z0, a]);z0 = b;}out.push([z0, hl]);return out.filter(([a, b]) => b - a > .01);
      };
      for (const side of [-1, 1]) {
        const x0 = side > 0 ? hw - .04 : -hw, x1 = side > 0 ? hw : -hw + .04;
        for (const [a, b] of spans(side)) {
          body.box(x0, bottom, a, x1, sill, b, L.body);// below the windows
          body.box(x0, top, a, x1, H - .22, b, L.body);// above the windows
          // window pillars every ~1.7 m
          const n = Math.max(1, Math.round((b - a) / 1.7));for (let i = 0; i <= n; i++) {const z = a + (b - a) * i / n;body.box(x0, sill, Math.max(a, z - .07), x1, top, Math.min(b, z + .07), kind === 'metro' ? 0x15181b : L.body);}
          glass.box(side > 0 ? hw - .07 : -hw + .03, sill, a, side > 0 ? hw - .03 : -hw + .07, top, b, 0, 'pznzpyny');
        }
        body.box(x0 + side * .01, bottom, -hl, x1 + side * .01, bottom + .26, hl, L.lower);// a darker band low down
        // doors: closed leaves (each half 2 cm proud) with their windows
        if (side < 0 || K.both) for (const z of dz) {
          const door = side > 0 ? doorR : doorL;
          const xa = side > 0 ? hw - .02 : -hw - .02, xb = xa + .04;
          door.box(xa, fl, z - dw, xb, top + .05, z - .02, L.door);door.box(xa, fl, z + .02, xb, top + .05, z + dw, L.door);
          door.box(side > 0 ? xb : xa - .005, fl + .9, z - dw + .12, side > 0 ? xb + .005 : xa, top - .1, z - .14, 0x1c2833);door.box(side > 0 ? xb : xa - .005, fl + .9, z + .14, side > 0 ? xb + .005 : xa, top - .1, z + dw - .12, 0x1c2833);
          body.box(x0, top, z - dw, x1, H - .22, z + dw, L.body);// above the door
          inside.box(side > 0 ? hw - .3 : -hw, bottom, z - dw, side > 0 ? hw : -hw + .3, fl, z + dw, L.floor);// the step
        }
      }
      // Roof, ends, underframe.
      body.box(-hw + .06, H - .22, -hl, hw - .06, H, hl, L.roof);
      if (kind === 'tram' && si % 2 === 0) body.box(-.7, H, -hl * .6, .7, H + .32, hl * .6, 0x9aa0a6);// roof equipment
      if (kind !== 'tram' && si === 0) body.box(-.9, H, hl - 5.5, .9, H + .28, hl - 1.5, 0xc4c8cc);// bus: AC unit / metro: roof cover
      if (kind === 'tram' && si === 2) {body.box(-.03, H + .32, -.2, .03, H + 1.25, .2, 0x2b2f33);body.box(-.9, H + 1.2, -.12, .9, H + 1.26, .12, 0x2b2f33);}// pantograph
      const endFace = (z, sgn, cab) => {
        if (cab) {
          // The cab: a sloped dark mask with the windscreen and the destination sign above it.
          body.box(-hw, bottom, z - sgn * .04, hw, sill - .1, z, L.body);
          glass.box(-hw + .1, sill - .1, z - sgn * .06, hw - .1, top + .15, z - sgn * .02, 0, '');
          body.box(-hw, top + .15, z - sgn * .04, hw, H, z, L.mask);
          body.box(-hw, bottom, z - sgn * .02, hw, bottom + .3, z + sgn * .02, L.skirt);
          for (const x of [-hw + .35, hw - .35]) body.box(x - .18, sill - .42, z, x + .18, sill - .3, z + sgn * .015, 0xf6f2dd);// headlights
        } else if (sgn < 0 && si === K.sections.length - 1 && (kind === 'bus' || kind === 'artic')) {
          // a bus's back: red, the rear window, tail lights
          body.box(-hw, bottom, z, hw, H, z + .04, L.body);
          glass.box(-hw + .25, sill + .25, z - .03, hw - .25, top, z + .01, 0, '');
          for (const x of [-hw + .2, hw - .2]) body.box(x - .12, sill - .55, z - .015, x + .12, sill - .2, z, 0xb3121b);
          body.box(-hw, bottom, z - .02, hw, bottom + .3, z + .02, L.skirt);
        } else body.box(-hw + .1, bottom, z - sgn * .02, hw - .1, H - .1, z, 0x2b2f33);// the bellows face
      };
      endFace(hl, 1, cabFront);endFace(-hl, -1, cabBack);
      body.box(-hw + .1, bottom - .02, -hl + .2, hw - .1, bottom + .06, hl - .2, L.skirt);
      if (kind === 'bus' || kind === 'artic') {
        const axles = kind === 'bus' ? [hl - 2.7, -hl + 2.5] : si === 0 ? [hl - 2.7, -hl + 2.2] : [-hl + 2.2];
        for (const z of axles) for (const s of [-1, 1]) body.wheel(s > 0 ? hw - .3 : -hw + .02, s > 0 ? hw - .02 : -hw + .3, .5, z, .5, 0x1a1b1d, 0x4a4f55);
      }
      if (kind === 'metro') for (const z of [-hl + 2.6, hl - 2.6]) body.box(-hw + .3, .2, z - 1.3, hw - .3, .7, z + 1.3, 0x24272a);// bogies
      if (kind === 'tram') body.box(-hw + .02, .05, -hl + .2, hw - .02, bottom + .02, hl - .2, L.skirt);
      // Inside: floor, low walls, ceiling, seats, yellow poles.
      inside.box(-hw + .06, fl - .02, -hl + .05, hw - .06, fl, hl - .05, L.floor, 'nxpxnzpzny');
      inside.quad([-hw + .06, top, -hl], [hw - .06, top, -hl], [hw - .06, top, hl], [-hw + .06, top, hl], L.wall);
      for (const s of [-1, 1]) inside.quad([s * (hw - .06), fl, s > 0 ? hl : -hl], [s * (hw - .06), fl, s > 0 ? -hl : hl], [s * (hw - .06), sill, s > 0 ? -hl : hl], [s * (hw - .06), sill, s > 0 ? hl : -hl], L.wall);
      for (const p of seats(kind).filter(q => q.section === si)) {
        inside.box(p.x - .23, fl + .42, p.z - .22, p.x + .23, fl + .5, p.z + .22, L.seat);
        inside.box(p.x - .23, fl + .5, p.z - p.face * .26, p.x + .23, fl + 1.12, p.z - p.face * .19, L.seat);
        inside.box(p.x - .18, fl, p.z - .15, p.x + .18, fl + .42, p.z + .15, 0x3c3f42);
      }
      for (let z = -hl + 1.5; z < hl - 1; z += 2.8) for (const x of [-.45, .45]) inside.box(x - .02, fl, z - .02, x + .02, top, z + .02, L.pole);
      // light strip in the ceiling
      inside.box(-.25, top - .02, -hl + .5, .25, top, hl - .5, 0xfff6dc, 'py');
      return {body: body.geometry(), glass: glass.geometry(), inside: inside.geometry(), doorR: doorR.geometry(), doorL: doorL.empty ? null : doorL.geometry(), len: S.len};
    }
    const cache = new Map();
    const geoFor = (kind, si) => {const k = kind + si;if (!cache.has(k)) cache.set(k, sectionGeometry(kind, si));return cache.get(k);};
    // ---------- Signs ----------
    const signs = new Map();
    function sign(ref, to, colour, mode) {
      const key = ref + '|' + to;if (signs.has(key)) return signs.get(key);
      const c = document.createElement('canvas');c.width = 512;c.height = 64;const g = c.getContext('2d');
      g.fillStyle = '#0b0c0d';g.fillRect(0, 0, 512, 64);
      const amber = mode === 'metro' ? '#f4f4f0' : '#ffb21e';
      g.fillStyle = mode === 'metro' ? colour : amber;g.fillRect(6, 6, 92, 52);
      g.fillStyle = mode === 'metro' ? '#fff' : '#0b0c0d';g.font = 'bold 44px Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText(ref, 52, 34);
      g.fillStyle = amber;g.textAlign = 'left';let size = 40;g.font = `bold ${size}px Arial, sans-serif`;while (g.measureText(to).width > 395 && size > 18) {size -= 2;g.font = `bold ${size}px Arial, sans-serif`;}
      g.fillText(to, 110, 34);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
      const mat = new T.MeshBasicMaterial({map: tex, toneMapped: false});signs.set(key, mat);return mat;
    }
    const signGeo = new T.PlaneGeometry(1, 1);
    // ---------- One vehicle ----------
    function make(kind) {
      const K = KINDS[kind], group = new T.Group();group.name = `Transit ${kind}`;
      const sections = K.sections.map((S, si) => {
        const G = geoFor(kind, si), g = new T.Group();
        const body = new T.Mesh(G.body, M.body), glass = new T.Mesh(G.glass, M.glass), inside = new T.Mesh(G.inside, M.interior), doorR = new T.Mesh(G.doorR, M.door), doorL = G.doorL ? new T.Mesh(G.doorL, M.door) : null;
        body.castShadow = true;body.receiveShadow = true;glass.renderOrder = 2;inside.visible = false;
        g.add(body, glass, inside, doorR);if (doorL) g.add(doorL);group.add(g);
        const signs = [];
        const hl = S.len / 2, sw = K.width - .5, sh = kind === 'metro' ? .3 : .34, y = K.height - (kind === 'metro' ? .3 : .27);
        if (si === 0) {const m = new T.Mesh(signGeo);m.scale.set(sw, sh, 1);m.position.set(0, y, hl + .012);g.add(m);signs.push(m);}
        if (K.cabs.length > 1 && si === K.sections.length - 1) {const m = new T.Mesh(signGeo);m.scale.set(sw, sh, 1);m.rotation.y = Math.PI;m.position.set(0, y, -hl - .012);g.add(m);signs.push(m);}
        if (si === 0) {const m = new T.Mesh(signGeo);m.scale.set(2.2, .28, 1);m.rotation.y = -Math.PI / 2;m.position.set(-K.width / 2 - .012, K.height - .38, hl - 2.6);g.add(m);signs.push(m);}// the side sign by the front door (on the right: a model faces +z, so its right is -x)
        return {group: g, len: S.len, body, glass, inside, doorR, doorL, signs};
      });
      let doorsNow = null, insideNow = false, signNow = null;
      return {kind, K, group, sections,
        setSign(mat) {if (mat === signNow) return;signNow = mat;for (const s of sections) for (const m of s.signs) m.material = mat;},
        // f 0..1 open; side +1 the right-hand doors, -1 the left-hand ones, 0 both
        setDoors(f, side = 1) {const key = f > .5 ? side : 9;if (key === doorsNow) return;doorsNow = key;for (const s of sections) {s.doorR.visible = !(f > .5 && side >= 0);if (s.doorL) s.doorL.visible = !(f > .5 && side <= 0);}},
        setInterior(on) {if (on === insideNow) return;insideNow = on;for (const s of sections) s.inside.visible = on;}};
    }
    // ---------- Stops ----------
    // The stop's name plate (one per stop place): a white plate with the pictogram and the name, like Ruter's.
    const plates = new Map();
    function plate(name, tram) {
      const key = name + (tram ? '|t' : '|b');if (plates.has(key)) return plates.get(key);
      const c = document.createElement('canvas');c.width = 512;c.height = 160;const g = c.getContext('2d');
      g.fillStyle = '#f4f4f2';g.fillRect(0, 0, 512, 160);g.fillStyle = '#e60000';g.fillRect(0, 0, 512, 10);
      g.fillStyle = tram ? '#1f5fb4' : '#e60000';g.beginPath();g.arc(70, 85, 52, 0, Math.PI * 2);g.fill();
      g.fillStyle = '#fff';g.font = 'bold 34px Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText(tram ? 'TRIKK' : 'BUSS', 70, 87);
      g.fillStyle = '#16181a';g.textAlign = 'left';let size = 50;g.font = `bold ${size}px Arial, sans-serif`;while (g.measureText(name).width > 360 && size > 22) {size -= 2;g.font = `bold ${size}px Arial, sans-serif`;}
      g.fillText(name, 136, 88);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;const m = new T.MeshStandardMaterial({map: tex, roughness: .5, side: T.DoubleSide});plates.set(key, m);return m;
    }
    const stopMat = {
      metal: new T.MeshStandardMaterial({color: 0x6f767c, roughness: .4, metalness: .6}), roof: new T.MeshStandardMaterial({color: 0x3b4045, roughness: .5, metalness: .4}),
      glass: new T.MeshStandardMaterial({color: 0xbfd4dc, roughness: .05, metalness: .1, transparent: true, opacity: .28, depthWrite: false, side: T.DoubleSide}),
      bench: new T.MeshStandardMaterial({color: 0x8a6a48, roughness: .7}), dark: new T.MeshStandardMaterial({color: 0x15171a, roughness: .4})
    };
    const boxGeo = new T.BoxGeometry(1, 1, 1), cyl = new T.CylinderGeometry(.045, .045, 1, 10);
    const part = (geo, mat, sx, sy, sz, x, y, z) => {const m = new T.Mesh(geo, mat);m.scale.set(sx, sy, sz);m.position.set(x, y, z);m.castShadow = true;return m;};
    // A stop: local +z points to the road (the kerb side); the plate and the board face the road and the pavement.
    function stopModel({name, tram, shelter, board}) {
      const g = new T.Group();
      g.add(part(cyl, stopMat.metal, 1, 2.9, 1, 0, 1.45, 0));
      const p = new T.Mesh(signGeo, plate(name, tram));p.scale.set(1.15, .36, 1);p.position.set(0, 2.62, .05);p.rotation.y = Math.PI / 2;g.add(p);
      // The timetable case on the pole.
      g.add(part(boxGeo, stopMat.dark, .05, .55, .4, .06, 1.45, 0));
      if (shelter) {
        const s = new T.Group();s.position.set(0, 0, -1.6);
        s.add(part(boxGeo, stopMat.roof, 3.6, .1, 1.6, -2.3, 2.45, .1));
        for (const x of [-4.05, -.55]) s.add(part(boxGeo, stopMat.metal, .07, 2.45, .07, x, 1.22, -.62));
        s.add(part(boxGeo, stopMat.glass, 3.45, 2.1, .02, -2.3, 1.25, -.64));
        s.add(part(boxGeo, stopMat.glass, .02, 2.1, 1.1, -4.05, 1.25, -.1));
        s.add(part(boxGeo, stopMat.bench, 2.2, .06, .4, -2.3, .46, -.38));
        s.add(part(boxGeo, stopMat.metal, .06, .44, .3, -1.4, .23, -.38));s.add(part(boxGeo, stopMat.metal, .06, .44, .3, -3.2, .23, -.38));
        g.add(s);
      }
      if (board) {// the live departures screen, under the roof (or on its own post)
        const b = new T.Group();b.position.set(shelter ? -2.3 : -.5, shelter ? 2.12 : 2.0, shelter ? -1.2 : 0);
        if (!shelter) b.add(part(cyl, stopMat.metal, 1, 2.0, 1, 0, -1, 0));
        b.add(part(boxGeo, stopMat.dark, 1.32, .5, .08, 0, 0, 0));
        const scr = new T.Mesh(signGeo, board);scr.scale.set(1.24, .44, 1);scr.position.set(0, 0, .045);b.add(scr);
        const back = new T.Mesh(signGeo, board);back.scale.set(1.24, .44, 1);back.position.set(0, 0, -.045);back.rotation.y = Math.PI;b.add(back);
        g.add(b);
      }
      return g;
    }
    // The live board's canvas: the stop's name, then one row per departure (line, destination, minutes).
    function boardCanvas() {
      const c = document.createElement('canvas');c.width = 512;c.height = 192;const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;tex.anisotropy = 4;
      const mat = new T.MeshBasicMaterial({map: tex, toneMapped: false});
      return {canvas: c, tex, mat, draw(title, rows, empty = 'No more departures tonight') {
        const g = c.getContext('2d');g.fillStyle = '#07080a';g.fillRect(0, 0, 512, 192);
        g.fillStyle = '#ffb21e';g.font = 'bold 26px Arial, sans-serif';g.textBaseline = 'middle';g.textAlign = 'left';g.fillText(title, 12, 20);
        g.fillStyle = '#3a2a08';g.fillRect(8, 36, 496, 2);
        rows.slice(0, 5).forEach((r, i) => {
          const y = 56 + i * 31;g.fillStyle = r.colour;g.fillRect(10, y - 13, 58, 26);g.fillStyle = '#fff';g.font = 'bold 21px Arial, sans-serif';g.textAlign = 'center';g.fillText(r.ref, 39, y + 1);
          g.fillStyle = '#ffb21e';g.textAlign = 'left';g.font = 'bold 22px Arial, sans-serif';let t = r.to;while (g.measureText(t).width > 330 && t.length > 3) t = t.slice(0, -2) + '…';g.fillText(t, 78, y + 1);
          g.textAlign = 'right';g.fillText(r.when, 502, y + 1);
        });
        if (!rows.length) {g.fillStyle = '#ffb21e';g.font = '22px Arial, sans-serif';g.textAlign = 'left';g.fillText(empty, 12, 80);}
        tex.needsUpdate = true;
      }};
    }
    return {KINDS, M, make, sign, stopModel, boardCanvas, stopMat, seats, doors};
  }
  return {KINDS, seats, doors, create};
});
