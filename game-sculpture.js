/* HODET N.N. (Marianne Heske, 2014): the 7 m bronze doll's head at the north end of Torshovdalen (OSM node 2965223021),
 * a giant copy of a doll's head the artist found at a Paris flea market. It stands straight on the grass, faces south down
 * the valley, and has a few stone steps (a small amphitheatre) on its east side. Unreal issue jonatsl/haarklous-ue5#3.
 * GameSculpture.create({T, lib, world, at: {x, s}}) -> {group, obstacles, floors, at}
 *   at: the place in the local map frame (x east, s south); obstacles / floors in world coordinates for walk-collision.js.
 * GameSculpture.headShape(px, py, pz) -> metres to push a point of the unit sphere outward (the face; Node-tested).
 *
 * Oksefontenen with "Torshovoksen" (Asbjørg Borgfelt, 1929; OSM node 331273417) in the middle of Hegermanns plass (issue #20):
 * a bronze bull charging with its head low, on a rock on a two-tier pedestal in a raised basin, inside a larger basin on an
 * octagonal paved island; four stone lizards spout water. The bull faces SSW (bearing 204°) along Mastrups gate. Sizes are
 * estimates from photos (±20 %); the model is deliberately simple (the sculpture is still under copyright).
 * GameSculpture.createFountain({T, lib, world, at: {x, s}, bearing}) -> {group, obstacles, floors, at, base}
 */
(function (root, factory) {
  root.GameSculpture = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const HEIGHT = 7.0;
  // Measured on the photos (7 m in all): the shoulder plate is 2.85 m high and 3.7 m across, reaching further forward
  // than back; a short neck; the head is 4 m high. Half-sizes and centre heights in metres.
  const HEAD = {rx: 1.62, ry: 2.0, rz: 1.75, y: HEIGHT - 2.0}, NECK = {r: 1.05, y0: 2.6, y1: 3.8}, SHOULDER = {rx: 1.85, ry: 2.85, rz: 1.9, back: .8, forward: .3};
  const g2 = (du, dv, su, sv) => Math.exp(-(du / su) * (du / su) - (dv / sv) * (dv / sv));
  // The doll's face on the front (+z) of the unit sphere: u = angle round from the front, v = height (-1 chin … 1 crown).
  // Lowered eyelids, a small nose, full cheeks, a small mouth and a round chin, as in the photos.
  function headShape(px, py, pz) {
    if (pz <= 0) return 0;
    const u = Math.atan2(px, pz), v = py, au = Math.abs(u);
    return .30 * g2(u, v + .30, .09, .10) + .10 * g2(u, v + .12, .06, .16)        // nose and its bridge
      - .16 * g2(au - .36, v + .05, .17, .10) + .10 * g2(au - .36, v + .09, .12, .05) // eye sockets, lowered lids
      + .05 * g2(au - .33, v - .08, .22, .05)                                      // brows
      + .22 * g2(au - .48, v + .42, .24, .22)                                      // cheeks
      + .09 * g2(u, v + .58, .13, .05) - .05 * g2(u, v + .60, .11, .015)          // lips, mouth line
      + .08 * g2(u, v + .76, .16, .07);                                            // chin
  }
  function create({T, lib, world, at}) {
    const group = new T.Group();group.name = 'HODET N.N.';
    const bronze = lib.metal(0x4e463d, .5), stone = lib.concrete(0x8f877c);
    // Facing: the face (+z of the model) points south (+s on the map) whatever the map's rotation is.
    const w0 = world.toWorld(at.x, at.s), w1 = world.toWorld(at.x, at.s + 1), yaw = Math.atan2(w1.x - w0.x, w1.z - w0.z);
    const toW = (a, b) => ({x: w0.x + a * Math.cos(yaw) + b * Math.sin(yaw), z: w0.z - a * Math.sin(yaw) + b * Math.cos(yaw)});// model (a, b) -> world
    // Ground: the lowest point under the shoulder plate, so the plate never floats on the slope.
    let base = Infinity;for (let k = 0; k < 16; k++) {const a = k / 16 * Math.PI * 2, p = toW(Math.cos(a) * SHOULDER.rx, SHOULDER.forward + Math.sin(a) * SHOULDER.rz);base = Math.min(base, world.heightWorld(p.x, p.z));}
    const statue = new T.Group();statue.position.set(w0.x, base - .15, w0.z);statue.rotation.y = yaw;group.add(statue);
    const add = (geo, mat, parent = statue) => {const m = new T.Mesh(geo, mat);m.castShadow = m.receiveShadow = true;parent.add(m);return m;};
    // Head: a deformed sphere (egg shaped: the crown is the widest part, the back of the skull a little rounder).
    const head = new T.SphereGeometry(1, 72, 54), P = head.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), narrow = 1 - .08 * Math.min(1, Math.max(0, (.2 - y) / 1.2)), back = z < 0 ? 1 + .06 * -z : 1;
      const d = headShape(x, y, z);
      P.setXYZ(i, x * HEAD.rx * narrow + x * d, y * HEAD.ry + y * d * .4, z * HEAD.rz * narrow * back + z * d);
    }
    head.computeVertexNormals();add(head, bronze).position.y = HEAD.y + .15;
    add(new T.CylinderGeometry(NECK.r * .95, NECK.r, NECK.y1 - NECK.y0, 40, 1, true), bronze).position.y = (NECK.y0 + NECK.y1) / 2 + .15;
    // Shoulder plate: a bell with flat shoulders (a superellipse turned round the neck), oval, flatter at the back and set
    // a little forward under the chin; its open bottom is under the ground.
    const prof = [];for (let k = 0; k <= 24; k++) {const t = k / 24 * Math.PI / 2;prof.push(new T.Vector2(Math.pow(Math.cos(t), 2 / 3.2), Math.pow(Math.sin(t), 2 / 3.2)));}
    const sh = new T.LatheGeometry(prof, 64), S = sh.attributes.position;// bottom to top, so the faces look outward
    for (let i = 0; i < S.count; i++) {const z = S.getZ(i);S.setXYZ(i, S.getX(i) * SHOULDER.rx, S.getY(i) * SHOULDER.ry, SHOULDER.forward + z * SHOULDER.rz * (z < 0 ? SHOULDER.back : 1));}
    sh.computeVertexNormals();add(sh, bronze);
    // The small amphitheatre: four rows of stone steps on the slope east of the head, facing it. Each step is 0.34 m
    // high (one walking step), so you can climb them and stand on them.
    const floors = [], obstacles = [];
    for (let row = 0; row < 4; row++) {
      const r = 6.2 + row * .95, n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k - (n - 1) / 2) * .13, c = toW(Math.cos(a) * r, Math.sin(a) * r), len = r * .13 - .06, dep = .62;// model +x is east
        const ground = world.heightWorld(c.x, c.z), top = ground + .34, blk = add(new T.BoxGeometry(dep, .54, len), stone, group);
        blk.position.set(c.x, top - .27, c.z);blk.rotation.y = yaw - a;
        const ca = Math.cos(yaw - a), sa = Math.sin(yaw - a), corner = (u, w) => ({x: c.x + u * ca + w * sa, z: c.z - u * sa + w * ca});
        floors.push({name: 'HODET N.N. steps', points: [corner(-dep / 2, -len / 2), corner(dep / 2, -len / 2), corner(dep / 2, len / 2), corner(-dep / 2, len / 2)], y: top, surfaceKind: 'stone'});
      }
    }
    // The bronze is solid: a 12-sided ring round the shoulder plate, up to the crown.
    const ring = [];for (let k = 0; k < 12; k++) {const a = k / 12 * Math.PI * 2, s = Math.sin(a);ring.push(toW(Math.cos(a) * (SHOULDER.rx + .05), SHOULDER.forward + s * (SHOULDER.rz + .05) * (s < 0 ? SHOULDER.back : 1)));}
    obstacles.push({points: ring, minY: base - .5, maxY: base + HEIGHT, kind: 'sculpture'});
    group.updateMatrixWorld(true);
    return {group, obstacles, floors, at, yaw, base};
  }
  // Oksefontenen: sizes in metres; model frame: origin at the island's centre on the ground, +z = where the bull looks.
  function createFountain({T, lib, world, at, bearing = 204}) {
    const group = new T.Group();group.name = 'Oksefontenen (Torshovoksen)';
    const bronze = lib.metal(0x3a4436, .48), stone = lib.concrete(0x5d6064), setts = lib.concrete(0xa9a69f), kerb = lib.concrete(0x8c8b86);
    const water = new T.MeshPhysicalMaterial({color: 0x3f6f80, roughness: .08, metalness: 0, transparent: true, opacity: .78, clearcoat: 1});
    const jet = new T.MeshStandardMaterial({color: 0xdfeef5, transparent: true, opacity: .55, roughness: .2, depthWrite: false});
    const b = bearing * Math.PI / 180, w0 = world.toWorld(at.x, at.s), w1 = world.toWorld(at.x + Math.sin(b), at.s - Math.cos(b));// bearing: 0 = north (-s)
    const yaw = Math.atan2(w1.x - w0.x, w1.z - w0.z), toW = (a, c) => ({x: w0.x + a * Math.cos(yaw) + c * Math.sin(yaw), z: w0.z - a * Math.sin(yaw) + c * Math.cos(yaw)});
    // The island sits on the highest street point round it, so it never sinks into the slope; its sides reach below the lowest.
    const R = 6, ring = [];for (let k = 0; k < 8; k++) {const a = (k + .5) / 8 * Math.PI * 2;ring.push([Math.cos(a) * R, Math.sin(a) * R]);}
    let hi = -Infinity, lo = Infinity;for (const [a, c] of ring) {const p = toW(a, c), h = world.heightWorld(p.x, p.z);hi = Math.max(hi, h);lo = Math.min(lo, h);}
    const base = hi + .15, root = new T.Group();root.position.set(w0.x, base, w0.z);root.rotation.y = yaw;group.add(root);
    const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.castShadow = m.receiveShadow = true;parent.add(m);return m;};
    // An extruded outline (points in model x/z) from y0 to y1.
    const slab = (pts, y0, y1, mat) => {const sh = new T.Shape(pts.map(([a, c]) => new T.Vector2(a, -c)));const g = new T.ExtrudeGeometry(sh, {depth: y1 - y0, bevelEnabled: false});g.rotateX(-Math.PI / 2);g.translate(0, y0, 0);return add(g, mat);};
    const longOct = (w, d, cut) => [[-w / 2 + cut, -d / 2], [w / 2 - cut, -d / 2], [w / 2, -d / 2 + cut], [w / 2, d / 2 - cut], [w / 2 - cut, d / 2], [-w / 2 + cut, d / 2], [-w / 2, d / 2 - cut], [-w / 2, -d / 2 + cut]];
    slab(ring, lo - base - .3, -.02, kerb);slab(ring.map(([a, c]) => [a * .97, c * .97]), -.02, 0, setts);// island: kerb sides, setts on top
    // Outer basin (6 x 5 m, along the bull), rim 1.35 m; water 0.15 m below the rim.
    const ob = longOct(5.0, 6.0, 1.1), obIn = longOct(4.4, 5.4, .95);
    slab(ob, 0, 1.35, stone);slab(obIn, 1.2, 1.21, water);
    slab(ob.map(([a, c]) => [a * 1.03, c * 1.03]), 1.35, 1.45, stone);// coping
    // Upper basin (4.5 x 3.5 m) raised to 2.2 m with an overhanging rim, then the two-tier pedestal and the bull's rock.
    const ub = longOct(3.5, 4.5, .7);slab(ub.map(([a, c]) => [a * .8, c * .8]), 1.2, 2.0, stone);slab(ub, 2.0, 2.2, stone);slab(ub.map(([a, c]) => [a * 1.06, c * 1.06]), 2.2, 2.3, stone);
    slab(ub.map(([a, c]) => [a * .9, c * .9]), 2.3, 2.31, water);
    add(new T.BoxGeometry(1.5, .4, 2.7), stone, 0, 2.5, 0);add(new T.BoxGeometry(1.3, .4, 2.5), stone, 0, 2.9, 0);add(new T.BoxGeometry(1.45, .08, 2.65), stone, 0, 3.14, 0);
    const rock = add(new T.DodecahedronGeometry(.55, 1), bronze, 0, 3.25, .55);rock.scale.set(1.3, .45, 1.6);
    // Four stone lizards on the upper basin's corners spout water into the outer basin.
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const liz = new T.Group();liz.position.set(sx * 1.45, 2.3, sz * 1.95);liz.rotation.y = Math.atan2(sx, sz);root.add(liz);
      add(new T.SphereGeometry(.16, 12, 8), stone, 0, .1, 0, liz).scale.set(1, .6, 1.8);add(new T.SphereGeometry(.08, 10, 8), stone, 0, .14, .3, liz).scale.set(1, .8, 1.3);
      const arc = new T.CatmullRomCurve3([new T.Vector3(0, .14, .38), new T.Vector3(0, .5, .9), new T.Vector3(0, -.2, 1.35), new T.Vector3(0, -1.0, 1.55)]);
      add(new T.TubeGeometry(arc, 16, .03, 6), jet, 0, 0, 0, liz).castShadow = false;
    }
    // The bull: charging, head almost down at its hooves, short horns forward, tail curled up over the rump (estimates).
    const bull = new T.Group();bull.position.set(0, 3.3, -.15);root.add(bull);
    const blob = (r, sx, sy, sz, x, y, z) => {const m = add(new T.SphereGeometry(r, 20, 14), bronze, x, y, z, bull);m.scale.set(sx, sy, sz);return m;};
    blob(1, .45, .44, .82, 0, .98, 0);blob(.42, 1, 1, 1, 0, 1.18, .45);blob(.44, 1, 1, 1.05, 0, .95, -.62);// body, hump, rump
    blob(1, .3, .33, .5, 0, .78, .88).rotation.x = .75;blob(1, .21, .24, .36, 0, .34, 1.3).rotation.x = 1.15;// neck down to the head
    for (const sx of [-1, 1]) add(new T.ConeGeometry(.045, .3, 8), bronze, sx * .17, .44, 1.38, bull).rotation.set(1.35, 0, -sx * .55);
    const leg = (x, z, y0, y1, dz, r) => {const L = Math.hypot(y1 - y0, dz), m = add(new T.CylinderGeometry(r * .8, r, L, 10), bronze, x, (y0 + y1) / 2, z + dz / 2, bull);m.rotation.x = Math.atan2(-dz, y0 - y1);};
    leg(-.24, .55, .62, 0, .25, .11);leg(.24, .55, .62, .38, .35, .11);leg(.24, .9, .38, .2, .12, .09);// braced front leg; the other bent, hoof up on the rock
    leg(-.22, -.7, .62, 0, -.3, .12);leg(.22, -.7, .62, 0, -.22, .12);// hind legs braced
    const tail = new T.CatmullRomCurve3([new T.Vector3(0, 1.1, -1.02), new T.Vector3(0, 1.45, -1.12), new T.Vector3(0, 1.7, -.9), new T.Vector3(0, 1.55, -.62), new T.Vector3(0, 1.62, -.4)]);
    add(new T.TubeGeometry(tail, 20, .035, 6), bronze, 0, 0, 0, bull);
    // Walk: the island is a low step (0.15 m) you can stand on; the basin is solid.
    const floors = [{name: 'Hegermanns plass, fountain island', points: ring.map(([a, c]) => toW(a, c)), y: base, surfaceKind: 'stone'}];
    const obstacles = [{points: ob.map(([a, c]) => toW(a * 1.03, c * 1.03)), minY: base - .5, maxY: base + 4.6, kind: 'sculpture'}];
    group.updateMatrixWorld(true);
    return {group, obstacles, floors, at, base, yaw};
  }
  return {create, createFountain, headShape, HEIGHT};
});
