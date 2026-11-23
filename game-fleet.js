/* Parked vehicles in every street (issue #113): draws the vehicles GameParking.plan places and makes the motor vehicles drivable.
 *
 * GameFleet.create({T, lib, VH, scene, collision, plan, toWorld, localHeadingToYaw, heightAt, ok}) ->
 *   {cars, small, tick(dt, camera, inUse), refresh(camera, force), applyLayer(worlds), lockedNear(p), names, stats()}
 *   plan     GameParking.plan(...) result (local x, s, heading)
 *   ok(spot) the game's own check (room between the static solids, not too steep); a car that fails it stays in the list but
 *            is never drawn or used (`void`), so the vehicle numbers online are the same on every computer.
 * cars:  drivable vehicles (Car / Motorcycle subclasses) to append to the game's `vehicles` – each builds its full model
 *        (paint shell, wheels, the hatchback's interior with the steering wheel and hands) only when it is driven, pushed or
 *        moved by another player, and drops it again when it has stood still out of the way for a while (`built`).
 * small: parked bicycles and mopeds (not ridable; □ near one says it is locked).
 * Drawing: every parked vehicle that is not built is an instance in one InstancedMesh per body type and level of detail
 *   (near: the shaped model within NEAR m of the camera; far: two boxes out to FAR m), so the whole fleet is about 20 draw
 *   calls. The instance lists are refilled from a 100 m tile grid when the camera has moved a few metres.
 * Collision: the parked ones are one hashed layer in every collision world (`collision.setParked`), rebuilt only when a
 *   vehicle is built, dropped or moved; built ones are ordinary dynamic solids (game-main's updateDynamic).
 * Paint: one material for everything; the vertex colour times, where the `paint` attribute is 1, the instance colour.
 */
(function (root, factory) {
  root.GameFleet = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const NEAR = 75, FAR = 650, TILE = 100;
  // The shape of each body type (metres; z forward is -z like the game's other vehicles, y up). r wheel radius, c body
  // bottom, belt the window line, nose / tail the bonnet front and boot top, zA / zA2 the windscreen's foot and top, zC2 /
  // zC the roof's end and the rear window's foot, oF / oR the axles from the ends, cw the glasshouse width, zW a van's wall behind the front seats.
  const SHAPES = {
    small: {r: .29, c: .2, belt: .9, nose: .72, tail: .96, zA: -.8, zA2: -.2, zC2: 1.25, zC: 1.68, oF: .62, oR: .52, cw: 1.48},
    hatch: {r: .31, c: .22, belt: .92, nose: .74, tail: .98, zA: -.78, zA2: -.12, zC2: 1.5, zC: 1.98, oF: .8, oR: .7, cw: 1.6},
    sedan: {r: .33, c: .18, belt: .88, nose: .66, tail: .95, zA: -.92, zA2: -.17, zC2: .72, zC: 1.78, oF: .85, oR: .95, cw: 1.62},
    estate: {r: .32, c: .2, belt: .9, nose: .72, tail: .98, zA: -.95, zA2: -.25, zC2: 2.02, zC: 2.3, oF: .85, oR: .9, cw: 1.62},
    suv: {r: .37, c: .28, belt: 1.06, nose: .92, tail: 1.1, zA: -.9, zA2: -.25, zC2: 1.78, zC: 2.2, oF: .85, oR: .85, cw: 1.7},
    pickup: {r: .39, c: .32, belt: 1.12, nose: 1.05, tail: 1.12, zA: -1.0, zA2: -.4, zC2: .98, zC: 1.12, oF: .85, oR: 1.15, cw: 1.66, bed: 1.18},
    van: {r: .34, c: .22, belt: 1.06, nose: .98, tail: 1.06, zA: -1.62, zA2: -.95, zC2: 2.5, zC: 2.52, oF: .85, oR: 1.0, cw: 1.89, box: true, zW: -.07},
    // The grey Volvo V70 (issue #149, the 2000–2007 "P2"): a long flat roof, a nearly upright tailgate, a high shoulder line;
    // carBody adds what makes it one (the tall rear lights up the D pillars, the grille's diagonal bar, the roof rails).
    v70: {r: .32, c: .19, belt: .92, nose: .74, tail: .95, zA: -1.0, zA2: -.3, zC2: 2.08, zC: 2.22, oF: .88, oR: 1.07, cw: 1.6, v70: true},
    lorry: {r: .5, c: .5, belt: 1.55, nose: 1.5, tail: 1.5, zA: -3.98, zA2: -3.72, zC2: -2.08, zC: -2.02, oF: 1.1, oR: 1.5, cw: 2.36, lorry: true}
  };
  SHAPES.taxi = {...SHAPES.estate, sign: true};
  const C = {glass: 0x29323b, trim: 0x1e2124, tyre: 0x17181a, rim: 0xaab0b6, light: 0xe4ebef, red: 0xa3191c, plate: 0xf2f2ee, sign: 0xf6dc6a, cargo: 0xeeeeea, chassis: 0x2a2c2f, seat: 0x222326, chrome: 0xc4c8cc, orange: 0xe08a1e};

  function create({T, lib, VH, scene, collision, plan, toWorld, localHeadingToYaw, heightAt, ok = () => true}) {
    const P = window.GameParking, TYPES = P.TYPES, COLOURS = P.COLOURS;
    // ---------- One material, paint by instance ----------
    const mat = new T.MeshStandardMaterial({vertexColors: true, roughness: .42, metalness: .22});
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float paint;').replace('#include <color_vertex>', [
        '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )', 'vColor = vec3( 1.0 );', '#endif', '#ifdef USE_COLOR', 'vColor *= color;', '#endif',
        '#ifdef USE_INSTANCING_COLOR', 'vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, paint );', '#endif'].join('\n'));
    };
    mat.customProgramCacheKey = () => 'fleet-paint-v1';

    // ---------- Building geometry from parts ----------
    const M4 = new T.Matrix4(), Q = new T.Quaternion(), E = new T.Euler(), V = new T.Vector3(), ONE = new T.Vector3(1, 1, 1), col = new T.Color();
    function parts() {
      const pos = [], nor = [], colr = [], pnt = [];
      const add = (geo, colour, paint = 0, m = null) => {
        const g = geo.index ? geo.toNonIndexed() : geo;if (m) g.applyMatrix4(m);
        if (!g.attributes.normal) g.computeVertexNormals();
        const p = g.attributes.position, n = g.attributes.normal;col.setHex(paint ? 0xffffff : colour);
        for (let i = 0; i < p.count; i++) {pos.push(p.getX(i), p.getY(i), p.getZ(i));nor.push(n.getX(i), n.getY(i), n.getZ(i));colr.push(col.r, col.g, col.b);pnt.push(paint);}
        if (g !== geo) g.dispose();geo.dispose();
      };
      const at = (x, y, z, rx = 0, ry = 0, rz = 0) => new T.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), ONE);
      return {
        add, at,
        box(w, h, d, x, y, z, colour, paint, rx = 0, ry = 0) {add(new T.BoxGeometry(w, h, d), colour, paint, at(x, y, z, rx, ry));},
        // A side profile [[z, y], …] (front = -z) extruded across the width, centred on x = 0.
        prof(points, width, colour, paint, bevel = .035, x = 0) {
          const s = new T.Shape();points.forEach(([z, y], i) => i ? s.lineTo(-z, y) : s.moveTo(-z, y));
          const g = new T.ExtrudeGeometry(s, {depth: Math.max(.01, width - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1});
          g.translate(0, 0, -(width - 2 * bevel) / 2);g.rotateY(Math.PI / 2);g.translate(x, 0, 0);add(g, colour, paint);
        },
        wheel(r, w, x, y, z, seg = 12) {add(new T.CylinderGeometry(r, r, w, seg), C.tyre, 0, at(x, y, z, 0, 0, Math.PI / 2));add(new T.CylinderGeometry(r * .6, r * .6, w + .02, seg - 2), C.rim, 0, at(x, y, z, 0, 0, Math.PI / 2));},
        geometry() {const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));g.setAttribute('paint', new T.Float32BufferAttribute(pnt, 1));g.computeBoundingSphere();return g;}
      };
    }
    // Where a car body type's wheels are: [x, y, z, steers].
    function wheelsOf(type) {
      const t = TYPES[type], s = SHAPES[type], x = t.W / 2 - (s.lorry ? .17 : .1), zf = -t.L / 2 + s.oF, zr = t.L / 2 - s.oR;
      return [[-x, s.r, zf, true], [x, s.r, zf, true], [-x, s.r, zr, false], [x, s.r, zr, false]];
    }
    // The body of a car-like type without its wheels (`shell`), as near and far models. The cabin above the window line is
    // open between the bonnet and the boot, so the shared interior shows from the driver's seat (the outside faces of the
    // glasshouse are not drawn from inside).
    function carBody(type, b, far) {
      const t = TYPES[type], s = SHAPES[type], L = t.L, W = t.W, H = t.H, hl = L / 2 - .04;// (the bevel adds 3.5 cm all round)
      if (far) {
        if (s.lorry) {b.box(2.1, 2.5, W, 0, 1.7, -hl + 1.05, 0, 1);b.box(6.05, 2.45, W, 0, 2.18, 1.04, C.cargo, 0);b.box(W * .9, .9, .05, 0, 2.4, -hl - .02, C.glass, 0);return;}
        b.box(L, s.belt - .12, W, 0, (s.belt + .12) / 2, 0, 0, 1);
        if (s.box) {b.box(hl - s.zA, H - s.belt, s.cw, 0, (H + s.belt) / 2, (s.zA + hl) / 2, 0, 1);b.box(s.cw * .9, (H - s.belt) * .7, .05, 0, s.belt + (H - s.belt) * .45, s.zA - .02, C.glass, 0);}
        else b.box(s.zC - s.zA, H - s.belt, s.cw, 0, (H + s.belt) / 2, (s.zA + s.zC) / 2, C.glass, 0);
        if (s.v70) for (const side of [-1, 1]) b.box(.16, s.belt - .52, .05, side * (W / 2 - .1), (s.belt + .4) / 2, L / 2 + .015, C.red, 0);// the tall rear lights
        return;
      }
      const zR = s.lorry ? s.zC : s.bed ? s.zC : Math.max(s.zA + .9, 1.45 + s.zA + .75);// where the boot starts (behind the rear seat)
      // Bonnet, boot, the doors (thin), the floor.
      b.prof([[-hl, s.c + .12], [-hl + .02, s.nose - .08], [-hl + .16, s.nose], [s.zA, s.belt], [s.zA + .25, s.belt], [s.zA + .25, s.c], [-hl + .22, s.c]], W, 0, 1);
      const boot = s.bed ? s.belt - .38 : s.tail;
      if (!s.lorry) b.prof([[zR, s.c], [zR, s.bed ? boot : s.belt], [hl - .07, boot], [hl, boot - .12], [hl, s.c + .16], [hl - .2, s.c]], W, 0, 1);
      for (const side of [-1, 1]) b.box(.07, s.belt - s.c - .06, zR - s.zA - .25 + .02, side * (W / 2 - .04), (s.belt + s.c + .06) / 2, (zR + s.zA + .25) / 2, 0, 1);
      b.box(W - .16, .05, zR - s.zA - .25, 0, s.c + .04, (zR + s.zA + .25) / 2, C.trim, 0);
      // Glasshouse, roof, pillars.
      const top = s.lorry ? 2.95 : H - .05;
      if (s.box) {// a van (issue #131): a glass cab like the cars' (seen through from the seats), a painted wall right
        // behind the front seats and the painted load space behind it. The glass is one closed solid round the driver's
        // eye, so from inside all its faces are back faces and culled; separate glass panels would show their inside face.
        const zW = s.zW;
        b.prof([[s.zA, s.belt], [s.zA2, top - .03], [zW, top - .03], [zW, s.belt]], s.cw - .03, C.glass, 0, .02);// windscreen, front side windows (ends inside the load space)
        b.prof([[s.zA2 - .04, top - .07], [s.zA2 + .08, top], [zW + .02, top], [zW + .02, top - .07]], s.cw + .05, 0, 1, .02);// cab roof
        b.prof([[zW, s.belt], [zW, top], [hl - .03, top], [hl, s.belt]], s.cw, 0, 1, .03);// load space (its front face is the wall)
        b.box(W - .2, s.belt - s.c - .06, .04, 0, (s.belt + s.c + .06) / 2, zW - .03, 0, 1);// the wall below the window line
        for (const side of [-1, 1]) {const a = Math.atan2(s.zA2 - s.zA, top - s.belt), len = Math.hypot(s.zA2 - s.zA, top - s.belt);b.box(.07, len, .07, side * (s.cw / 2 - .015), (top + s.belt) / 2, (s.zA + s.zA2) / 2, 0, 1, a);}// A pillars
        b.box(.02, .06, hl - zW - .2, -(s.cw / 2 + .012), s.belt + .45, (zW + hl) / 2, C.trim, 0);// the sliding door's rail
      } else {
        b.prof([[s.zA, s.belt], [s.zA2, top - .03], [s.zC2, top - .03], [s.zC, s.belt]], s.cw, C.glass, 0, .02);
        b.prof([[s.zA2 - .04, top - .07], [s.zA2 + .08, top], [s.zC2 - .08, top], [s.zC2 + .04, top - .07]], s.cw + .05, 0, 1, .02);
        const bz = (s.zA2 + s.zC2) / 2 - .05;b.box(s.cw + .03, top - s.belt - .05, .1, 0, (top + s.belt) / 2 - .03, bz, C.trim, 0);// B pillars
        for (const side of [-1, 1]) {
          const a = Math.atan2(s.zA2 - s.zA, top - s.belt), len = Math.hypot(s.zA2 - s.zA, top - s.belt);b.box(.07, len, .07, side * (s.cw / 2 - .015), (top + s.belt) / 2, (s.zA + s.zA2) / 2, 0, 1, a);
          const c = Math.atan2(s.zC2 - s.zC, top - s.belt), cl = Math.hypot(s.zC - s.zC2, top - s.belt);b.box(.07, cl, s.zC - s.zC2 > .6 ? .09 : .2, side * (s.cw / 2 - .015), (top + s.belt) / 2, (s.zC + s.zC2) / 2, 0, 1, c);
        }
      }
      if (s.lorry) {// a box truck: the cab in front, a white box behind, the chassis under it
        b.box(W - .04, 2.45, 6.05, 0, 2.18, 1.04, C.cargo, 0);
        b.box(W - .9, .45, L - 1, 0, s.c + .25, .4, C.chassis, 0);
        b.box(W - .1, .5, .25, 0, 1.0, -hl + .12, C.trim, 0);
      }
      if (s.bed) {// a pickup's load bed: sides and tailgate round a floor
        b.box(W - .12, .06, hl - s.bed, 0, s.belt - .34, (hl + s.bed) / 2, C.trim, 0);
        for (const side of [-1, 1]) b.box(.06, .4, hl - s.bed, side * (W / 2 - .05), s.belt - .14, (hl + s.bed) / 2, 0, 1);
        b.box(W - .1, .4, .06, 0, s.belt - .14, hl - .04, 0, 1);b.box(W - .1, .4, .06, 0, s.belt - .14, s.bed + .02, 0, 1);
      }
      if (s.sign) b.box(.62, .17, .2, 0, H + .07, (s.zA2 + s.zC2) / 2 - .3, C.sign, 0);// TAXI on the roof
      // Bumpers, lights, number plates, mirrors.
      const bf = s.lorry ? .78 : s.c + .2;
      b.box(W - .08, .2, .1, 0, bf, -hl - .01, C.trim, 0);
      if (!s.lorry) b.box(W - .08, .2, .1, 0, s.c + .2, hl + .01, C.trim, 0);
      else b.box(W - .2, .12, .12, 0, .75, hl + .05, C.trim, 0);// the lorry's rear underrun bar
      for (const side of [-1, 1]) {
        b.box(.34, .1, .06, side * (W / 2 - .3), s.lorry ? 1.05 : s.nose - .1, -hl - .03, C.light, 0);
        if (!s.v70) b.box(.3, .12, .06, side * (W / 2 - .26), s.lorry ? .95 : (s.bed ? s.belt - .4 : s.tail) - .14, s.lorry ? hl + .1 : hl + .03, C.red, 0);
        b.box(.12, .1, .18, side * (W / 2 + .07), s.belt + .1, s.zA + .12, 0, 1);
      }
      b.box(.52, .12, .02, 0, bf, -hl - .075, C.plate, 0);b.box(.52, .12, .02, 0, s.lorry ? .75 : s.c + .2, hl + (s.lorry ? .13 : .075), C.plate, 0);
      if (s.v70) {// the Volvo V70's own parts (issue #149)
        const c = Math.atan2(s.zC2 - s.zC, top - s.belt), cl = Math.hypot(s.zC - s.zC2, top - s.belt), n = .12;// the D pillar's tilt and length; n: off its rear face
        for (const side of [-1, 1]) {
          b.box(.16, s.belt - .54, .06, side * (W / 2 - .1), (s.belt + .54) / 2, hl + .035, C.red, 0);// the tall rear light beside the tailgate …
          b.box(.12, cl * .78, .05, side * (s.cw / 2 - .015), (top + s.belt) / 2 - cl * .1 * Math.cos(c) - n * Math.sin(c), (s.zC + s.zC2) / 2 - cl * .1 * Math.sin(c) + n * Math.cos(c), C.red, 0, c);// … running up the D pillar
          b.box(.03, .05, hl * 2 - .55, side * (W / 2 + .005), s.belt - .1, .05, 0, 1);// the shoulder line
          b.box(.04, .04, s.zC2 - s.zA2 - .1, side * (s.cw / 2 - .12), top + .03, (s.zA2 + s.zC2) / 2, C.trim, 0);// roof rails
        }
        b.box(.62, .14, .04, 0, s.nose - .14, -hl - .035, C.trim, 0);// the grille …
        b.add(new T.BoxGeometry(.64, .018, .02), C.chrome, 0, b.at(0, s.nose - .14, -hl - .062, 0, 0, Math.atan2(.12, .6)));// … its diagonal bar
        b.box(.07, .07, .02, 0, s.nose - .14, -hl - .07, C.chrome, 0);// and the badge on it
      }
    }
    function twoWheeler(type, b, far) {
      const t = TYPES[type], hl = t.L / 2;
      if (type === 'bicycle') {
        for (const z of [-hl + .36, hl - .36]) b.add(new T.TorusGeometry(.34, .022, 4, 14), C.tyre, 0, b.at(0, .36, z, 0, Math.PI / 2));
        const tube = (z0, y0, z1, y1, r = .022) => {const len = Math.hypot(z1 - z0, y1 - y0);b.add(new T.CylinderGeometry(r, r, len, 5), 0, 1, b.at(0, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(z1 - z0, y1 - y0)));};
        tube(.16, .4, -.28, .8);tube(.16, .4, .05, .86);tube(.05, .86, -.28, .8);tube(.16, .4, .51, .36, .016);tube(.05, .86, .51, .36, .016);tube(-.28, .8, -.51, .36, .02);tube(-.28, .8, -.3, 1.0);
        b.box(.13, .05, .26, 0, .9, .07, C.seat, 0);b.box(.5, .025, .025, 0, 1.0, -.3, C.trim, 0);
        return;
      }
      if (far) {b.box(.3, .55, t.L * .85, 0, .55, 0, 0, 1);b.box(.2, .6, t.L * .9, 0, .3, 0, C.trim, 0);return;}
      const moped = type === 'moped', r = moped ? .2 : .3;
      b.wheel(r, moped ? .1 : .13, 0, r, -hl + r + .02, 10);b.wheel(r, moped ? .12 : .17, 0, r, hl - r - .02, 10);
      if (moped) {
        b.prof([[-hl + .38, .3], [-hl + .45, 1.0], [-hl + .62, 1.0], [-hl + .56, .3]], .42, 0, 1, .03);// leg shield
        b.box(.34, .06, .55, 0, .32, -.05, C.trim, 0);// floorboard
        b.prof([[.18, .3], [.18, .62], [hl - .1, .7], [hl - .05, .45], [hl - .3, .3]], .4, 0, 1, .04);// body over the engine
        b.box(.3, .1, .52, 0, .74, .38, C.seat, 0);b.box(.6, .03, .03, 0, 1.08, -hl + .5, C.trim, 0);b.box(.14, .1, .06, 0, .98, -hl + .4, C.light, 0);
      } else {
        b.prof([[-.48, .9], [-.42, 1.12], [-.1, 1.16], [.08, 1.02], [.05, .86], [-.4, .82]], .42, 0, 1, .05);// tank
        b.prof([[-.86, .78], [-.84, 1.02], [-.62, 1.22], [-.45, 1.18], [-.45, .86], [-.62, .7]], .58, 0, 1, .04);// half fairing
        b.box(.44, .36, .44, 0, .5, -.12, 0x5f6266, 0);// engine
        b.prof([[.05, .86], [.08, .95], [.38, .93], [.5, .99], [.78, 1.0], [.82, .95], [.6, .86]], .3, C.seat, 0, .04);// seat
        b.prof([[.4, .74], [.42, .9], [.86, .98], [.92, .9], [.7, .74]], .26, 0, 1, .03);// tail
        b.add(new T.CylinderGeometry(.065, .065, .5, 10), C.chrome, 0, b.at(.2, .44, .72, Math.PI / 2 - .2));// silencer
        for (const side of [-1, 1]) b.add(new T.CylinderGeometry(.025, .025, .62, 6), C.chrome, 0, b.at(side * .1, .62, -.62, .45));// forks
        b.box(.7, .025, .025, 0, 1.12, -.42, C.trim, 0);b.box(.18, .1, .06, 0, .92, -.88, C.light, 0);b.box(.2, .04, .06, 0, .9, .94, C.red, 0);
        b.box(.2, .05, .7, 0, .3, .45, 0x8e9398, 0, -.12);// swingarm
      }
    }
    const models = {};// type -> {near, far, shell, wheel}
    function model(type) {
      if (models[type]) return models[type];
      const car = !!SHAPES[type], m = {};
      if (car) {
        const shell = parts();carBody(type, shell, false);m.shell = shell.geometry();
        const nearB = parts();carBody(type, nearB, false);const s = SHAPES[type];
        for (const [x, y, z] of wheelsOf(type)) nearB.wheel(s.r, s.lorry ? .32 : .22, x, y, z);
        if (s.lorry) for (const side of [-1, 1]) nearB.wheel(s.r, .32, side * (TYPES.lorry.W / 2 - .52), s.r, TYPES.lorry.L / 2 - s.oR);// twin rear tyres
        m.near = nearB.geometry();
        const farB = parts();carBody(type, farB, true);for (const [x, y, z] of wheelsOf(type)) farB.box(.24, s.r * 1.6, s.r * 1.6, x, y, z, C.tyre, 0);m.far = farB.geometry();
        const wb = parts();wb.wheel(s.r, s.lorry ? .32 : .22, 0, 0, 0, 14);m.wheel = wb.geometry();
      } else {
        const nearB = parts();twoWheeler(type, nearB, false);m.near = nearB.geometry();
        if (type !== 'bicycle') {const farB = parts();twoWheeler(type, farB, true);m.far = farB.geometry();}
      }
      return (models[type] = m);
    }

    // ---------- The vehicles ----------
    const fleet = {version: 0, built: new Set()};let layer = null;
    const nameOf = (type, colour) => `${COLOURS[colour][0]} ${TYPES[type].name}`;
    const colourOf = c => new T.Color().setHex(COLOURS[c][1]);
    const poseMatrix = (out, x, y, z, yaw, pitch, roll) => {M4.compose(V.set(x, y, z), Q.setFromEuler(E.set(pitch, yaw, roll, 'YXZ')), ONE);M4.toArray(out);return out;};
    // The parked footprint goes back into the collision layer after the vehicle changed (moved, settled, dropped its model).
    const relayer = v => {if (!layer) return;if (v.fp) layer.remove(v.fp);if (!v.built && !v.void) layer.add(v.footprint());};
    // What lazily built vehicles share: no model until needed, the parked footprint kept until it moves.
    const lazy = Base => class extends Base {
      fleetInit(rec) {
        this.lazy = true;this.built = false;this.rec = rec;this.type = rec.type;this.colourHex = COLOURS[rec.colour][1];this.paint = colourOf(rec.colour);this.name = nameOf(rec.type, rec.colour);
        this.item = {v: this, type: rec.type, colour: this.paint, m: new Float32Array(16), key: [NaN, NaN, NaN, NaN, NaN, NaN], tile: null, state: 0};
      }
      build() {
        if (this.built) return;
        if (this.item.state === 0) check(this.item, true);
        if (this.void) {this.void = false;this.item.state = 1;this.settle(1);}// a vehicle somebody drives is never left out
        if (layer && this.fp) layer.remove(this.fp);
        this.buildBody(this.rec);this.group.traverse(o => {if (o.isMesh) {o.castShadow = true;o.receiveShadow = true;}});
        this.built = true;this.idle = 0;fleet.built.add(this);fleet.version++;scene.add(this.group);this.place();
      }
      unbuild() {
        if (!this.built) return;scene.remove(this.group);
        for (const c of [...this.group.children]) this.group.remove(c);// shared geometry and materials stay
        this.taxiSign = null;this.built = false;fleet.built.delete(this);fleet.version++;moved(this.item);relayer(this);
      }
      update(dt, input) {
        if (!this.built) {if (this.void || (!this.active && !this.pushed && Math.abs(this.speed) < .01)) return;this.build();}
        super.update(dt, input);
      }
      enter() {this.build();super.enter();}
      netAnimate(dt) {if (!this.built) this.build();super.netAnimate(dt);}
      netSet(a) {
        // A new lobby puts every vehicle back where it started: one that never moved is left as it is (and is not checked now).
        const same = (p, q) => Math.abs(p - q) < .002;if (!this.built && same(a[0], this.x) && same(a[2], this.z) && same(a[3], this.yaw)) return;
        if (!this.built && this.item.state === 0) check(this.item);
        super.netSet(a);if (!this.built) {this.groundPrev = undefined;moved(this.item);relayer(this);fleet.version++;}
      }
      // The footprint only changes when the vehicle moves (it is asked for every time the collision lists are made).
      footprint() {
        const k = this.fpKey || (this.fpKey = []);
        if (k[0] !== this.x || k[1] !== this.z || k[2] !== this.yaw || k[3] !== this.y) {
          k[0] = this.x;k[1] = this.z;k[2] = this.yaw;k[3] = this.y;const f = super.footprint(), xs = f.points.map(p => p.x), zs = f.points.map(p => p.z);
          f.bounds = {minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs)};this.fp = f;
        }
        return this.fp;
      }
    };
    class FleetCar extends lazy(VH.Car) {
      constructor(rec, p, yaw) {
        const t = TYPES[rec.type], s = SHAPES[rec.type];
        super(p.x, p.z, yaw, 0, {lazy: true, length: t.L});this.fleetInit(rec);
        this.width = t.W;this.height = t.H;this.kind = t.kind;if (rec.type === 'lorry') this.radius = 1.25;
        this.roofY = (s.lorry ? 2.95 : t.H) + (rec.type === 'taxi' ? .26 : .08);this.signZ = (s.zA2 + s.zC2) / 2;// the taxi job's roof sign (game-jobs.js)
        // The shared interior sits behind this body's windscreen and at its window line.
        this.cab = {dy: s.belt - .92, dz: s.zA + .78};const {dy, dz} = this.cab;
        this.hips = {d: {pos: new T.Vector3(-.37, .62 + dy, .28 + dz), stance: 'drive'}, p: {pos: new T.Vector3(.37, .62 + dy, .28 + dz), stance: 'sit'}};this.passengerEye = new T.Vector3(.37, 1.24 + dy, .22 + dz);
      }
      buildBody() {
        const m = model(this.type), shell = new T.InstancedMesh(m.shell, mat, 1);shell.setMatrixAt(0, new T.Matrix4());shell.setColorAt(0, this.paint);shell.name = this.name;this.group.add(shell);
        this.wheels = wheelsOf(this.type).map(([x, y, z, front]) => {const holder = new T.Group(), wheel = new T.Mesh(m.wheel, mat);holder.position.set(x, y, z);holder.add(wheel);this.group.add(holder);return {holder, wheel, front};});
        if (this.type === 'lorry') for (const side of [-1, 1]) {const holder = new T.Group(), wheel = new T.Mesh(m.wheel, mat);holder.position.set(side * (TYPES.lorry.W / 2 - .52), SHAPES.lorry.r, TYPES.lorry.L / 2 - SHAPES.lorry.oR);holder.add(wheel);this.group.add(holder);this.wheels.push({holder, wheel, front: false});}
        const c = VH.cabin();c.body.position.set(0, this.cab.dy, this.cab.dz);this.group.add(c.body);
        Object.assign(this, {body: c.body, wheelPivot: c.wheelPivot, steeringWheel: c.steeringWheel, hands: c.hands, wrists: c.wrists, arms: c.arms, forearms: c.forearms});
        if (this.active) {this.hands.visible = true;this.arms.visible = true;}
      }
      seat() {
        const f = this.forward(), r = {x: -f.z, z: f.x}, back = .22 + this.cab.dz;
        return {x: this.x - r.x * .37 - f.x * back, y: this.y + 1.24 + this.cab.dy - this.squash, z: this.z - r.z * .37 - f.z * back, yaw: this.yaw, pitch: this.pitch, roll: this.roll || 0};
      }
    }
    class FleetBike extends lazy(VH.Motorcycle) {
      constructor(rec, p, yaw) {super(p.x, p.z, yaw, COLOURS[rec.colour][1], {lazy: true});this.fleetInit(rec);this.lean = -.12;this.roll = .12;}// on its side stand
      buildBody() {super.buildBody(this.colourHex);if (this.active) {this.hands.visible = true;this.arms.visible = true;}}
    }

    // ---------- Make them (cheap: each place is checked and settled on the ground when it first comes in sight) ----------
    const tiles = new Map(), tkey = (x, z) => Math.floor(x / TILE) * 100003 + Math.floor(z / TILE);
    function moved(it) {
      const v = it.v, k = tkey(v ? v.x : it.x, v ? v.z : it.z);
      if (it.tile !== k) {if (it.tile !== null) {const l = tiles.get(it.tile);l.splice(l.indexOf(it), 1);}if (!tiles.has(k)) tiles.set(k, []);tiles.get(k).push(it);it.tile = k;}
    }
    const t0 = performance.now(), cars = [], small = [];let voids = 0, okMs = 0, checked = 0;
    for (const rec of plan.cars) {
      const p = toWorld(rec.x, rec.s), yaw = localHeadingToYaw(rec.heading), v = rec.type === 'motorcycle' ? new FleetBike(rec, p, yaw) : new FleetCar(rec, p, yaw);
      moved(v.item);cars.push(v);
    }
    for (const rec of plan.small) {
      const p = toWorld(rec.x, rec.s), yaw = localHeadingToYaw(rec.heading), t = TYPES[rec.type], f = {x: -Math.sin(yaw), z: -Math.cos(yaw)}, r = {x: -f.z, z: f.x}, y = heightAt(p.x, p.z);
      const it = {x: p.x, z: p.z, y, yaw, rec, type: rec.type, colour: colourOf(rec.colour), name: nameOf(rec.type, rec.colour), m: new Float32Array(16), tile: null, state: 0};
      it.foot = {points: [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => ({x: p.x + f.x * a * t.L / 2 + r.x * b * t.W / 2, z: p.z + f.z * a * t.L / 2 + r.z * b * t.W / 2})), minY: y - .2, maxY: y + t.H, kind: 'vehicle'};
      const xs = it.foot.points.map(q => q.x), zs = it.foot.points.map(q => q.z);it.foot.bounds = {minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs)};
      moved(it);small.push(it);
    }
    // Every parked one is solid from the start (a place that fails its check is taken out of the layer again).
    layer = collision.parkedLayer([...cars.map(v => v.footprint()), ...small.map(it => it.foot)]);
    const buildMs = performance.now() - t0;
    // The game's check (ok), the same on every computer: a car that fails it is `void` (keeps its number, never drawn or in
    // the way). One that passes stands level on the ground with all its wheels down (unless somebody has moved it already).
    function check(it, keepIt = false) {
      if (it.state) return;const t = performance.now();checked++;
      if (it.v) {
        const v = it.v, r = v.rec, p = toWorld(r.x, r.s), yaw = localHeadingToYaw(r.heading), atPlace = v.x === p.x && v.z === p.z && v.yaw === yaw;
        if (!ok({x: p.x, z: p.z, yaw, L: v.length, W: v.width, type: v.type}) && !keepIt && !v.built) {it.state = -1;if (v.fp) layer.remove(v.fp);v.void = true;v.y = -1e4;voids++;}
        else {
          it.state = 1;
          if (atPlace && !v.built) {const sp = v.spawn && Math.abs(v.spawn[0] - v.x) < .002 && Math.abs(v.spawn[2] - v.z) < .002;v.settle(1);if (v.kind !== 'motorcycle') v.roll = v.terrainRoll || 0;if (sp) v.spawn = v.netGet();relayer(v);}
        }
      } else {
        const T = TYPES[it.type], f = {x: -Math.sin(it.yaw), z: -Math.cos(it.yaw)};
        if (!ok({x: it.x, z: it.z, yaw: it.yaw, L: T.L, W: T.W, type: it.type, small: true})) {it.state = -1;layer.remove(it.foot);}
        else {
          const hf = heightAt(it.x + f.x * T.L * .35, it.z + f.z * T.L * .35), hb = heightAt(it.x - f.x * T.L * .35, it.z - f.z * T.L * .35);
          it.y = (hf + hb) / 2;poseMatrix(it.m, it.x, it.y, it.z, it.yaw, Math.atan2(hf - hb, T.L * .7), 0);it.state = 1;
        }
      }
      fleet.version++;okMs += performance.now() - t;
    }

    // ---------- Instanced drawing ----------
    const group = new T.Group();group.name = 'Parked vehicles (issue #113)';scene.add(group);
    const lods = {};// type -> {near, far} InstancedMesh
    const count = {};for (const v of cars) count[v.type] = (count[v.type] || 0) + 1;for (const it of small) count[it.type] = (count[it.type] || 0) + 1;
    for (const type of Object.keys(count)) {
      const m = model(type), mk = (geo, shadow) => {
        if (!geo) return null;const im = new T.InstancedMesh(geo, mat, count[type]);im.count = 0;im.frustumCulled = false;im.castShadow = shadow;im.receiveShadow = true;
        im.instanceMatrix.setUsage(T.DynamicDrawUsage);im.setColorAt(0, col.setHex(0xffffff));im.instanceColor.setUsage(T.DynamicDrawUsage);im.name = `${type} (${shadow ? 'near' : 'far'})`;group.add(im);return im;
      };
      lods[type] = {near: mk(m.near, true), far: mk(m.far, false)};
    }
    const last = {x: Infinity, z: Infinity, v: -1};let drawn = {near: 0, far: 0}, pending = [];
    function refresh(camera, force = false) {
      const cx = camera.position.x, cz = camera.position.z, far = Math.min(FAR, (camera.far || FAR) * .97), farTwo = 170;
      if (!force && Math.hypot(cx - last.x, cz - last.z) < 3 && last.v === fleet.version) return;
      last.x = cx;last.z = cz;last.v = fleet.version;drawn = {near: 0, far: 0};pending = [];
      for (const L of Object.values(lods)) {if (L.near) L.near.count = 0;if (L.far) L.far.count = 0;}
      const r = Math.ceil(far / TILE);
      for (let i = Math.floor(cx / TILE) - r; i <= Math.floor(cx / TILE) + r; i++) for (let j = Math.floor(cz / TILE) - r; j <= Math.floor(cz / TILE) + r; j++) {
        const list = tiles.get(i * 100003 + j);if (!list) continue;
        for (const it of list) {
          const v = it.v;if (it.state < 0 || (v && v.built)) continue;
          const x = v ? v.x : it.x, z = v ? v.z : it.z, d = Math.hypot(x - cx, z - cz), L = lods[it.type];
          const two = it.type === 'bicycle' || it.type === 'moped' || it.type === 'motorcycle', im = d < (it.type === 'bicycle' ? 60 : NEAR) ? L.near : d < (two ? farTwo : far) ? L.far : null;if (!im) continue;
          if (!it.state) {pending.push([d, it]);continue;}// drawn once it is checked
          if (v) {const k = it.key;if (k[0] !== v.x || k[1] !== v.y || k[2] !== v.z || k[3] !== v.yaw || k[4] !== v.pitch || k[5] !== v.roll) {k[0] = v.x;k[1] = v.y;k[2] = v.z;k[3] = v.yaw;k[4] = v.pitch;k[5] = v.roll;poseMatrix(it.m, v.x, v.y, v.z, v.yaw, v.pitch, v.roll || 0);}}
          const n = im.count++;im.instanceMatrix.array.set(it.m, n * 16);const c = it.colour;im.instanceColor.array[n * 3] = c.r;im.instanceColor.array[n * 3 + 1] = c.g;im.instanceColor.array[n * 3 + 2] = c.b;
          if (im === L.near) drawn.near++;else drawn.far++;
        }
      }
      pending.sort((a, b) => a[0] - b[0]);
      for (const L of Object.values(lods)) for (const im of [L.near, L.far]) if (im) {im.instanceMatrix.needsUpdate = true;im.instanceColor.needsUpdate = true;}
    }
    // Checks the places that came in sight, nearest first, for at most `budget` ms a frame.
    function checkPending(budget = 3) {
      const t = performance.now();let n = 0;
      while (pending.length && (n < 8 || performance.now() - t < budget)) {check(pending.shift()[1]);n++;}
      return n;
    }

    // ---------- Collision: the parked ones are one layer, shared by every collision world ----------
    function applyLayer(worlds) {for (const w of worlds) if (w.parkedLayer !== layer) {collision.setParked(w, layer);w.parkedLayer = layer;}}

    // Built vehicles that have stood still out of the way for a while go back to being instances.
    let idleT = 0;
    function tick(dt, camera, inUse = () => false, mine = null) {
      idleT += dt;
      if (idleT > 1) {
        for (const v of [...fleet.built]) {
          const busy = v.active || v.pushed || v === mine || Math.abs(v.speed) > .02 || v.airborne || inUse(v.index) || Math.hypot(v.x - camera.position.x, v.z - camera.position.z) < 30;
          v.idle = busy ? 0 : v.idle + idleT;if (v.idle > 4) v.unbuild();
        }
        idleT = 0;
      }
      refresh(camera);if (pending.length) {checkPending();refresh(camera, true);}
    }
    // A parked bicycle or moped within reach (□ says it is locked).
    function lockedNear(p, reach = 1.4) {
      let best = null, bd = reach;
      for (let i = Math.floor(p.x / TILE) - 1; i <= Math.floor(p.x / TILE) + 1; i++) for (let j = Math.floor(p.z / TILE) - 1; j <= Math.floor(p.z / TILE) + 1; j++) for (const it of tiles.get(i * 100003 + j) || []) {
        if (it.v || it.state < 0) continue;const d = Math.hypot(it.x - p.x, it.z - p.z);if (d < bd && Math.abs(it.y - (p.feet ?? it.y)) < 2) {bd = d;best = it;}
      }
      return best;
    }
    const stats = () => ({cars: cars.length, voids, small: small.length, checked, pending: pending.length, built: fleet.built.size, drawn: {...drawn}, buildMs: Math.round(buildMs), okMs: Math.round(okMs), types: count});
    // Every place checked at once (tests and stills): returns how many were left.
    const checkAll = () => {const n = [...cars.map(v => v.item), ...small].filter(it => !it.state);n.forEach(it => check(it));return n.length;};
    return {cars, small, group, lods, tick, refresh, checkPending, checkAll, applyLayer, lockedNear, stats, get layer() {return layer;}, get version() {return fleet.version;}, model, SHAPES};
  }
  return {create, NEAR, FAR};
});
