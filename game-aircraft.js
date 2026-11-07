/* Flying machines for the open world: an Airbus H125-style helicopter, a single-seat low-wing sport plane and an FPV drone.
 * Controls are "Mode 2", the Battlefield default on a controller and the usual RC transmitter layout:
 *   left stick  ↑↓ collective (helicopter: centre = hover) / throttle (plane: hold to change, it stays) / thrust (drone);
 *               ←→ yaw (pedals, rudder; nose-wheel steering on the ground)
 *   right stick ↑↓ pitch (pull back = nose up), ←→ roll
 * Bodies are rigid: position, velocity, orientation quaternion and body rates (x pitch up, y yaw left, z roll left).
 * GameAircraft.create({T, lib, audio, heightAt, collision, worldFor}) -> {Helicopter, Plane, JumpPlane, Drone}
 *   JumpPlane: the Cessna 208 Caravan (skydiving, issue #22): the Plane's flight model, 12 jumper places (hips j0..j11,
 *   seatWorld(i)), door (doorWorld())
 * Helicopter/Plane: {group, kind, name, aircraft: true, x, y, z, yaw, speed, grounded, forward(), footprint(), enter(), exit(),
 *   update(dt, {lx, ly, rx, ry, brake, hold}), cameraPose(chase), hud()}  hold: flying by mouse (Battlefield style), keep the
 *   tilt the mouse gave instead of levelling (helicopter; in the drone's angle mode the mouse moves the tilt)
 * Drone: {launch(x, y, z, yaw), update(dt, input, env), cameraPose(), osd(), setMode()}
 */
(function (root, factory) {
  root.GameAircraft = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function create({T, lib, audio, heightAt, collision, worldFor}) {
    const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z), G = 9.81, RHO = 1.225;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.castShadow = true;m.receiveShadow = true;parent.add(m);return m;};
    const box = (p, w, h, d, x, y, z, mat) => mesh(p, new T.BoxGeometry(w, h, d), mat, x, y, z);
    const rod = (parent, a, b, r, mat, seg = 10) => {const A = V3(...a), B = V3(...b), d = B.clone().sub(A), m = mesh(parent, new T.CylinderGeometry(r, r, d.length(), seg), mat);m.position.copy(A).add(B).multiplyScalar(.5);m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());return m;};
    const paintMat = c => new T.MeshPhysicalMaterial({color: c, metalness: .35, roughness: .32, clearcoat: 1, clearcoatRoughness: .08});
    const glassMat = () => new T.MeshPhysicalMaterial({color: 0x9db3c4, transparent: true, opacity: .2, roughness: .03, metalness: .1, side: T.DoubleSide, depthWrite: false});
    const dark = lib.polymer(0x1b1c1e), metal = lib.metal(0x9aa0a6, .35), rubber = new T.MeshStandardMaterial({color: 0x161616, roughness: .9}), glove = lib.glove(), sleeve = lib.sleeve(), seatM = lib.fabric(0x2b2d31);
    const gaugeM = new T.MeshStandardMaterial({color: 0x0d1418, emissive: 0x1f4a35, emissiveIntensity: .8, roughness: .3});
    // Gloved hand gripping a bar along local x (back of the hand +y, wrist +z) – same hand as on the bike and in the car.
    function hand(parent, x, y, z, rot, left) {
      const g = new T.Group();g.position.set(x, y, z);g.rotation.copy(rot);parent.add(g);
      const palm = mesh(g, new T.BoxGeometry(.085, .03, .09), glove, 0, .03, .01);palm.rotation.x = -.3;
      for (let i = 0; i < 4; i++) {const f = mesh(g, new T.TorusGeometry(.024, .0085, 8, 12, Math.PI * 1.25), glove, -.03 + i * .02, 0, 0);f.rotation.y = Math.PI / 2;f.rotation.z = Math.PI * .6;}
      const thumb = mesh(g, new T.CapsuleGeometry(.009, .035, 4, 8), glove, left ? .045 : -.045, .018, -.02);thumb.rotation.z = Math.PI / 2;
      const wrist = new T.Object3D();wrist.position.set(0, .035, .07);g.add(wrist);g.userData.wrist = wrist;return g;
    }
    // Right hand around a vertical stick grip: bar axis down, back of the hand outboard, wrist toward the pilot.
    const stickGrip = new T.Euler().setFromRotationMatrix(new T.Matrix4().makeBasis(V3(0, -1, 0), V3(1, 0, 0), V3(0, 0, 1)));

    // ---------- Shared rigid-body aircraft ----------
    class Craft {
      constructor(x, z, yaw, gearH) {
        this.group = new T.Group();this.gearH = gearH;this.home = {x, z, yaw};this.pos = V3();this.vel = V3();this.q = new T.Quaternion();this.w = V3();
        this.aircraft = true;this.active = false;this.engine = null;this.arms = [];this.rpm = 0;
      }
      reset() {
        const h = this.home;this.pos.set(h.x, heightAt(h.x, h.z) + this.gearH, h.z);this.vel.set(0, 0, 0);this.w.set(0, 0, 0);
        this.q.setFromEuler(new T.Euler(0, h.yaw, 0, 'YXZ'));this.grounded = true;this.broken = false;this.crashT = 0;this.place();
      }
      get x() {return this.pos.x;} get z() {return this.pos.z;} get y() {return this.pos.y - this.gearH;}
      get speed() {return this.vel.length();}
      get yaw() {return new T.Euler().setFromQuaternion(this.q, 'YXZ').y;}
      axes() {return {f: V3(0, 0, -1).applyQuaternion(this.q), u: V3(0, 1, 0).applyQuaternion(this.q), r: V3(1, 0, 0).applyQuaternion(this.q)};}
      forward() {const f = V3(0, 0, -1).applyQuaternion(this.q), l = Math.hypot(f.x, f.z) || 1;return {x: f.x / l, z: f.z / l};}
      // Walkers bump into the parked aircraft: one or more rectangles [along forward, to the right, length, width]. They carry
      // owner: this, so the aircraft's own checks skip them (issue #97: after you got out, the spinning-down rotor hit the
      // helicopter's own footprint, counted as a crash, and 3 s later it was back on the helipad).
      footprint() {
        const f = this.forward(), r = {x: -f.z, z: f.x};
        return this.rects.map(([a0, b0, L, W]) => ({points: [[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]].map(([a, b]) => ({x: this.pos.x + f.x * (a + a0) + r.x * (b + b0), z: this.pos.z + f.z * (a + a0) + r.z * (b + b0)})), minY: this.y - .2, maxY: this.y + this.height, kind: 'vehicle', owner: this}));
      }
      exitPoint() {const f = this.forward(), r = {x: -f.z, z: f.x}, d = this.exitSide;return {x: this.pos.x - r.x * d + f.x * this.exitFwd, z: this.pos.z - r.z * d + f.z * this.exitFwd};}
      place() {this.group.position.copy(this.pos);this.group.quaternion.copy(this.q);}
      rotate(dt) {this.q.multiply(new T.Quaternion().setFromEuler(new T.Euler(this.w.x * dt, this.w.y * dt, this.w.z * dt, 'XYZ'))).normalize();}
      attitude() {const {f, r} = this.axes();return {pitch: Math.asin(clamp(f.y, -1, 1)), bank: -Math.asin(clamp(r.y, -1, 1))};}
      bodyVel() {return this.vel.clone().applyQuaternion(this.q.clone().invert());}
      crash() {this.broken = true;this.crashT = 3;this.vel.set(0, 0, 0);this.w.set(0, 0, 0);audio.sfx('crash');if (this.onCrash) this.onCrash(this);}
      // Buildings, trees and vehicles: slow touches bounce off, faster ones are crashes.
      obstacles(prev, bottom) {
        // Rotor strike (helicopter): something inside the rotor disc at rotor height. The check reaches rotorR (a little inside the
        // 5.2 m blade tips) and only while the rotor turns; under rotorSlow m/s the blades just scrape and you are slowed down,
        // faster it is a crash (issue #97: it crashed too easily close to buildings).
        if (this.rotorR && this.rpm > .3) {
          this.group.position.copy(this.pos);this.group.quaternion.copy(this.q);this.group.updateMatrixWorld(true);const c = this.rotor.getWorldPosition(V3());
          if (collision.hitsSolid(worldFor(this.rotorR), c, c.y - .25, c.y + .25, this)) {
            if (this.speed > this.rotorSlow) {this.crash();return true;}
            this.vel.multiplyScalar(.5);if (!(this.scrapeT > 0)) {audio.sfx('hit', {gain: .35});this.scrapeT = .5;}
          }
        }
        if (!collision.hitsSolid(worldFor(this.radius), this.pos, bottom + .35, this.pos.y + this.top, this)) return false;
        if (this.speed > this.crashSpeed) {this.crash();return true;}
        this.pos.copy(prev);this.vel.multiplyScalar(-.3);audio.sfx('hit', {gain: .5});return false;
      }
      solveArms() {
        if (!this.active) return;this.group.updateMatrixWorld(true);
        for (const a of this.arms) {const W = this.group.worldToLocal(a.wrist.getWorldPosition(V3())), d = W.clone().sub(a.elbow).normalize();a.mesh.position.copy(W).addScaledVector(d, -.15);a.mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), d);}
      }
      addArm(handGroup, elbow) {const m = mesh(this.armGroup, new T.CapsuleGeometry(.038, .26, 6, 12), sleeve);this.arms.push({wrist: handGroup.userData.wrist, elbow: V3(...elbow), mesh: m});}
      // First person from the seat, or a chase camera behind and above.
      cameraPose(chase, prev) {
        if (!chase) {const p = this.seat.clone().applyQuaternion(this.q).add(this.pos), q = this.q.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(this.seatPitch, 0, 0)));return {position: p, quaternion: q};}
        const f = this.forward(), want = V3(this.pos.x - f.x * this.chaseDist, this.pos.y + this.chaseDist * .3, this.pos.z - f.z * this.chaseDist);
        const p = prev ? prev.clone().lerp(want, .12) : want, g = heightAt(p.x, p.z) + 1;if (p.y < g) p.y = g;
        const m = new T.Matrix4().lookAt(p, this.pos.clone().add(V3(0, 1.2, 0)).addScaledVector(V3(f.x, 0, f.z), 6), V3(0, 1, 0));
        return {position: p, quaternion: new T.Quaternion().setFromRotationMatrix(m)};
      }
      // ---- Multiplayer (see game-vehicles.js) ----
      netGet() {return [...this.pos.toArray(), ...this.q.toArray(), this.speed, this.spinValue(), this.throttle || 0, this.grounded ? 1 : 0].map(v => Math.round(v * 10000) / 10000);}
      netSet(a) {this.pos.set(a[0], a[1], a[2]);this.q.set(a[3], a[4], a[5], a[6]).normalize();this.vel.copy(V3(0, 0, -1).applyQuaternion(this.q)).multiplyScalar(a[7]);this.setSpin(a[8]);this.throttle = a[9];this.grounded = !!a[10];this.broken = false;this.place();}
      netAnimate(dt) {this.spin(dt);}
      hipAnchor(seat) {const h = this.hips[seat];return h ? {obj: this.group, pos: h.pos, stance: 'sit'} : null;}
      exit() {this.active = false;if (this.hands) this.hands.forEach(h => {h.visible = false;});this.armGroup.visible = false;if (this.engine) this.engine.stop();this.engine = null;return this.exitPoint();}
      enterCommon() {this.active = true;if (this.hands) this.hands.forEach(h => {h.visible = true;});this.armGroup.visible = true;}
    }

    // ---------- Helicopter (Airbus H125 / AS350 class, about 2 250 kg, 10.7 m rotor) ----------
    class Helicopter extends Craft {
      constructor(x, z, yaw) {
        super(x, z, yaw, 0);this.kind = 'helicopter';this.name = 'Airbus H125 helicopter';this.length = 6;this.width = 2.6;this.height = 3.4;
        this.rects = [[-.2, 0, 4.2, 2.6], [-4.4, 0, 5.6, .7]];this.radius = 1.7;this.rotorR = 4.6;this.rotorSlow = 3;this.scrapeT = 0;this.top = 2.4;this.crashSpeed = 12;this.exitSide = 2.6;this.exitFwd = 0;
        this.seat = V3(.42, 1.86, -.32);this.seatPitch = -.12;this.chaseDist = 15;this.rotorAngle = 0;
        this.hips = {d: {pos: V3(.42, 1.15, .25)}, p: {pos: V3(-.42, 1.15, .25)}};this.passengerEye = V3(-.42, 1.86, -.32);
        const g = this.group, red = paintMat(0xb3121b), white = paintMat(0xf2f2ee), glass = glassMat();
        // Cabin pod: ellipsoid, with the windscreen band of the front half in glass.
        const pod = (phiS, phiL, thS, thL, mat) => {const m = mesh(g, new T.SphereGeometry(1, 36, 22, phiS, phiL, thS, thL), mat, 0, 1.45, .1);m.scale.set(1.05, 1.0, 1.85);return m;};
        pod(0, Math.PI, 0, Math.PI, red);pod(Math.PI, Math.PI, 0, .42, red);pod(Math.PI, Math.PI, 1.95, Math.PI - 1.95, white);pod(Math.PI, Math.PI, .42, 1.53, glass);
        const deck = mesh(g, new T.CapsuleGeometry(.5, 1.6, 6, 16), white, 0, 2.25, .9);deck.rotation.x = Math.PI / 2;deck.scale.set(1.2, 1, .75);
        // Tail boom, fin, stabiliser, tail-rotor guard.
        const boom = mesh(g, new T.CylinderGeometry(.13, .3, 5.4, 16), red, 0, 1.8, 4.3);boom.rotation.x = Math.PI / 2;
        const fin = new T.Shape();fin.moveTo(0, 0);fin.lineTo(.75, 0);fin.lineTo(.95, 1.35);fin.lineTo(.55, 1.4);fin.lineTo(.1, .2);fin.closePath();
        const finG = new T.ExtrudeGeometry(fin, {depth: .07, bevelEnabled: false});finG.translate(0, 0, -.035);finG.rotateY(-Math.PI / 2);mesh(g, finG, white, 0, 1.75, 6.55).scale.set(1, .85, .9);
        const finLow = mesh(g, new T.BoxGeometry(.07, .6, .45), white, 0, 1.45, 6.8);finLow.rotation.x = -.35;
        box(g, 2.1, .06, .42, 0, 1.82, 5.7, white);box(g, .06, .38, .38, 1.05, 1.86, 5.7, red);box(g, .06, .38, .38, -1.05, 1.86, 5.7, red);
        // Skids.
        for (const s of [-1, 1]) {
          rod(g, [s * 1.05, .06, -1.35], [s * 1.05, .06, 1.5], .045, metal);rod(g, [s * 1.05, .06, -1.35], [s * 1.05, .3, -1.7], .045, metal);
          for (const z of [-.6, .95]) rod(g, [s * 1.05, .06, z], [s * .55, .75, z], .05, metal);
        }
        for (const z of [-.6, .95]) rod(g, [-.55, .75, z], [.55, .75, z], .05, metal);
        // Interior: floor, seats, instrument panel, roof, door pillars.
        box(g, 1.7, .05, 2.4, 0, .74, .1, dark);
        for (const sx of [-.42, .42]) {box(g, .5, .1, .5, sx, 1.08, .18, seatM);const b = box(g, .5, .7, .1, sx, 1.45, .47, seatM);b.rotation.x = -.15;}
        const panel = box(g, .95, .24, .16, .05, 1.2, -1.2, dark);panel.rotation.x = -.5;
        for (let i = 0; i < 5; i++) {const gg = mesh(g, new T.CylinderGeometry(.036, .036, .01, 18), gaugeM, -.27 + i * .13, 1.245, -1.12);gg.rotation.x = Math.PI / 2 - .5;}
        box(g, .2, .32, .55, 0, 1.0, -.7, dark);box(g, 1.6, .04, 1.3, 0, 2.28, .05, seatM);
        for (const s of [-1, 1]) {rod(g, [s * 1.0, 1.0, -.15], [s * .78, 2.25, -.1], .035, red);rod(g, [s * .98, 1.25, -.95], [s * .62, 2.3, -.55], .028, dark);}
        rod(g, [0, 1.3, -1.72], [0, 2.32, -.85], .018, dark);
        // Controls with the pilot's hands (right seat): cyclic between the knees, collective lever on the left.
        this.cyclic = new T.Group();this.cyclic.position.set(.42, .78, -.5);g.add(this.cyclic);rod(this.cyclic, [0, 0, 0], [0, .6, .06], .016, dark);
        this.collective = new T.Group();this.collective.position.set(.06, .95, .2);g.add(this.collective);rod(this.collective, [0, 0, 0], [0, .05, -.55], .018, dark);rod(this.collective, [-.06, .05, -.55], [.06, .05, -.55], .02, dark);
        this.armGroup = new T.Group();g.add(this.armGroup);this.armGroup.visible = false;
        this.hands = [hand(this.cyclic, 0, .6, .06, stickGrip, false), hand(this.collective, 0, .05, -.55, new T.Euler(0, 0, 0), true)];
        this.hands.forEach(h => {h.visible = false;});this.addArm(this.hands[0], [.62, 1.2, .1]);this.addArm(this.hands[1], [.05, 1.25, .45]);
        // Main rotor (three blades + disc that appears at speed) and two-blade tail rotor.
        rod(g, [0, 2.3, .4], [0, 2.85, .4], .07, metal);
        this.rotor = new T.Group();this.rotor.position.set(0, 2.88, .4);g.add(this.rotor);mesh(this.rotor, new T.CylinderGeometry(.18, .22, .16, 14), metal);
        this.bladeMat = new T.MeshStandardMaterial({color: 0x1d1e20, roughness: .6, transparent: true, opacity: 1});
        for (let i = 0; i < 3; i++) {const b = box(this.rotor, 5.1, .04, .3, 0, 0, 0, this.bladeMat);b.position.set(Math.cos(i * 2.094) * 2.65, 0, -Math.sin(i * 2.094) * 2.65);b.rotation.y = i * 2.094;}
        this.disc = mesh(this.rotor, new T.CircleGeometry(5.3, 48), new T.MeshBasicMaterial({color: 0x222326, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false}));this.disc.rotation.x = -Math.PI / 2;this.disc.castShadow = false;
        this.tailRotor = new T.Group();this.tailRotor.position.set(-.16, 2.25, 6.95);g.add(this.tailRotor);
        for (const s of [-1, 1]) box(this.tailRotor, .04, .85, .13, 0, s * .43, 0, this.bladeMat);
        g.traverse(o => {if (o.isMesh && o.material === glass) o.castShadow = false;});
        [this.rotor, this.tailRotor, this.cyclic, this.collective, this.armGroup].forEach(o => {o.userData.noMerge = true;});lib.mergeStatic(g);
        this.reset();
      }
      enter() {this.enterCommon();this.engine = audio.engine('heli');audio.sfx('starter');}
      spin(dt) {this.rotorAngle += dt * 2 * Math.PI * 6.4 * this.rpm;this.rotor.rotation.y = this.rotorAngle;this.tailRotor.rotation.x = this.rotorAngle * 5.1;const b = clamp((this.rpm - .3) / .5, 0, 1);this.bladeMat.opacity = 1 - .82 * b;this.disc.material.opacity = .13 * b;}
      spinValue() {return this.rpm;}
      setSpin(v) {this.rpm = v;}
      update(dt, inp = {}) {
        const on = this.active && !this.broken;
        this.rpm += ((on ? 1 : 0) - this.rpm) * Math.min(1, dt * (on ? .35 : .18));
        if (this.rpm > .002 || this.active) this.spin(dt);
        if (this.broken) {this.crashT -= dt;if (this.crashT <= 0) this.reset();if (this.engine) this.engine.set(0, 0);return;}
        if (!this.active && this.grounded && this.rpm < .01) return;
        const lx = inp.lx || 0, ly = on ? inp.ly || 0 : 1, rx = on ? inp.rx || 0 : 0, ry = on ? inp.ry || 0 : 0;
        const prev = this.pos.clone(), {u} = this.axes(), v = this.vel, sp = v.length(), gh = heightAt(this.pos.x, this.pos.z);
        // Collective: centre gives the rotor thrust that holds a level hover; on the ground you lift it a little to get light on the skids.
        // Full collective is 1.4 × the weight (an H125's margin: about 9 m/s climb). The thrust acts along the rotor's axis, so pitch and
        // bank tilt it: cos(tilt) of it holds you up and sin(tilt) pushes you along (issue #73). Tilted 30° at full collective you
        // climb about half as fast, at 45° not at all; at centre collective any tilt sinks you unless you add collective.
        const coll = clamp(-ly - (this.grounded ? .18 : 0), -1, 1), agl = this.pos.y - gh;
        const lift = this.rpm * this.rpm * G * (coll >= 0 ? 1 + coll * .4 : 1 + coll * .8) * (1 + .08 * Math.max(0, 1 - agl / 4));
        // Fuselage drag (top level speed about 285 km/h, the H125's never-exceed speed) and the rotor's heave damping.
        const acc = u.clone().multiplyScalar(lift);acc.y -= G;acc.addScaledVector(v, -(.001 * sp + .04));acc.y -= v.y * .45;
        v.addScaledVector(acc, dt);
        // Cyclic and pedals command rates; with the stick centred it gently levels itself (as in Battlefield). At speed the tail fin
        // weathervanes into the airflow and a bank turns the nose.
        const {pitch, bank} = this.attitude(), vb = this.bodyVel(), fwd = -vb.z;
        const lv = inp.hold ? .15 : 1.2;// flying by mouse: the tilt holds (it levels only slowly)
        const tw = V3(ry * 1.25 - pitch * lv * (1 - Math.min(1, Math.abs(ry) * 2)), -lx * 1.3, -rx * 1.7 + bank * lv * (1 - Math.min(1, Math.abs(rx) * 2)));
        if (fwd > 5) {tw.y += -Math.atan2(vb.x, fwd) * Math.min(1, fwd / 30) * 1.2 - bank * Math.min(1, sp / 25) * .55;}
        const light = lift > G * .95;
        if (this.grounded && !light) tw.set(0, light ? tw.y : 0, 0);
        this.w.lerp(tw, Math.min(1, dt * 5));this.rotate(dt);
        this.pos.addScaledVector(v, dt);
        const g2 = heightAt(this.pos.x, this.pos.z);this.scrapeT -= dt;
        if (this.pos.y - this.gearH <= g2) {
          // Touchdown: a crash only when it is really hard – sinking faster than 10 m/s, sliding faster than 20 m/s or tilted more
          // than about 53° (issue #97: landings were too strict at 7 m/s, 14 m/s and 37°). Hard but survivable gets a loud thud.
          if (!this.grounded && (-v.y > 10 || Math.hypot(v.x, v.z) > 20 || this.axes().u.y < .6)) {this.pos.y = g2 + this.gearH;this.crash();return;}
          if (!this.grounded && -v.y > 1) audio.sfx('thud', {gain: -v.y > 5 ? 1 : .5});
          this.pos.y = g2 + this.gearH;if (v.y < 0) v.y = 0;const k = Math.max(0, 1 - dt * (light ? 1 : 4));v.x *= k;v.z *= k;this.grounded = true;
          if (!light) {const e = new T.Euler().setFromQuaternion(this.q, 'YXZ');this.q.slerp(new T.Quaternion().setFromEuler(new T.Euler(0, e.y, 0, 'YXZ')), Math.min(1, dt * 4));}
        } else if (this.pos.y - this.gearH > g2 + .08) this.grounded = false;
        if (this.obstacles(prev, Math.max(this.pos.y - this.gearH, g2))) return;
        this.place();
        this.cyclic.rotation.set(ry * .22, 0, -rx * .22);this.collective.rotation.x = clamp(-ly, -1, 1) * .2;this.solveArms();
        if (this.engine) this.engine.set(this.rpm, clamp(coll * .5 + .5, 0, 1));
      }
      hud() {const gh = heightAt(this.pos.x, this.pos.z);return `${Math.round(this.speed * 3.6)} km/h · alt ${Math.max(0, this.pos.y - gh).toFixed(0)} m · climb ${this.vel.y >= 0 ? '+' : ''}${this.vel.y.toFixed(1)} m/s · rotor ${Math.round(this.rpm * 100)} %${this.rpm < .95 && this.active ? ' (spooling up)' : ''}`;}
    }

    // ---------- Light sport plane (about 700 kg, 8 m span, 14 m² wing) ----------
    class Plane extends Craft {
      constructor(x, z, yaw) {
        super(x, z, yaw, 1.13);this.kind = 'plane';this.name = 'two-seat sport plane';this.length = 6.4;this.width = 8;this.height = 2.3;
        this.rects = [[0, 0, 6.4, 1.2], [.15, 0, 1.3, 8]];this.radius = 3.6;this.top = 1.4;this.crashSpeed = 9;this.exitSide = 1.6;this.exitFwd = -1.8;
        this.mass = 700;this.S = 14;this.Tmax = 3600;this.throttle = 0;this.prop = 0;
        this.seat = V3(0, .84, .3);this.seatPitch = -.06;this.chaseDist = 14;
        this.hips = {d: {pos: V3(0, -.04, .45)}, p: {pos: V3(0, -.02, 1.32)}};this.passengerEye = V3(0, .9, 1.22);
        this.build();
        this.reset();
      }
      // The sport plane's model (a subclass builds its own with the same moving parts: propG, bladeMat, pdisc, stick, lever,
      // elevator, rudder, ailerons, hands, armGroup).
      build() {
        const g = this.group, white = paintMat(0xf4f5f2), blue = paintMat(0x1d4f9c), glass = glassMat(), shell = paintMat(0xf4f5f2);shell.side = T.DoubleSide;
        // Fuselage (lathe, nose at -z): nose and tail closed, the cockpit section open on top under the canopy so you can see
        // the panel, stick and your hands from the seat. Cowling stripe, canopy bubble.
        const prof = [[0, 0], [.18, .12], [.42, .45], [.52, 1.2], [.56, 1.55], [.56, 2.2], [.54, 2.95], [.5, 3.3], [.34, 4.4], [.16, 5.6], [.08, 6.1], [0, 6.15]].map(([r, y]) => new T.Vector2(r, y));
        const lathe = (pts, mat, phiS = 0, phiL = Math.PI * 2, sc = 1) => {const l = new T.LatheGeometry(pts, 28, phiS, phiL);l.rotateX(Math.PI / 2);l.translate(0, 0, -2.05);const m = mesh(g, l, mat);m.scale.set(sc, 1.1 * sc, 1);return m;};
        lathe(prof.slice(0, 5), white);lathe(prof.slice(4, 8), shell, Math.PI + .95, Math.PI * 2 - 1.9);lathe(prof.slice(7), white);lathe(prof.slice(0, 4), blue, 0, Math.PI * 2, 1.012);
        box(g, .9, .04, 1.6, 0, -.3, .2, seatM);
        const can = mesh(g, new T.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, .42, .5);can.scale.set(.52, .64, 1.3);
        // Wings (low), ailerons, tail with elevator and rudder.
        const planform = new T.Shape();planform.moveTo(-4, -.25);planform.lineTo(4, -.25);planform.lineTo(4, .7);planform.lineTo(-4, .7);planform.closePath();
        const wing = new T.ExtrudeGeometry(planform, {depth: .1, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2});wing.rotateX(Math.PI / 2);
        mesh(g, wing, white, 0, -.32, -.1);
        for (const s of [-1, 1]) {const tip = box(g, .06, .14, 1.0, s * 4.02, -.33, .22, blue);tip.castShadow = true;}
        this.ailerons = [-1, 1].map(s => {const hinge = new T.Group();hinge.position.set(s * 2.9, -.37, .63);g.add(hinge);box(hinge, 1.9, .06, .28, 0, 0, .14, blue);return hinge;});
        box(g, 2.6, .07, .55, 0, .05, 3.72, white);
        this.elevator = new T.Group();this.elevator.position.set(0, .05, 4.0);g.add(this.elevator);box(this.elevator, 2.6, .06, .3, 0, 0, .15, blue);
        const finS = new T.Shape();finS.moveTo(0, 0);finS.lineTo(.8, 0);finS.lineTo(.75, 1.05);finS.lineTo(.4, 1.05);finS.closePath();
        const finG = new T.ExtrudeGeometry(finS, {depth: .07, bevelEnabled: false});finG.translate(0, 0, -.035);finG.rotateY(-Math.PI / 2);mesh(g, finG, white, 0, .1, 3.4);
        this.rudder = new T.Group();this.rudder.position.set(0, .1, 4.2);g.add(this.rudder);box(this.rudder, .06, 1.0, .3, 0, .52, .15, blue);
        // Tricycle gear with wheel spats.
        for (const s of [-1, 1]) {rod(g, [s * .3, -.4, .35], [s * 1.0, -.9, .35], .04, metal);mesh(g, new T.SphereGeometry(.24, 16, 10), white, s * 1.0, -.9, .35).scale.set(.55, .75, 1.6);const w = mesh(g, new T.CylinderGeometry(.22, .22, .12, 18), rubber, s * 1.0, -.91, .35);w.rotation.z = Math.PI / 2;}
        rod(g, [0, -.35, -1.55], [0, -.9, -1.6], .04, metal);const nw = mesh(g, new T.CylinderGeometry(.2, .2, .1, 18), rubber, 0, -.93, -1.6);nw.rotation.z = Math.PI / 2;
        // Propeller and spinner.
        this.propG = new T.Group();this.propG.position.set(0, 0, -2.08);g.add(this.propG);
        const spin = mesh(this.propG, new T.ConeGeometry(.17, .38, 18), blue, 0, 0, -.17);spin.rotation.x = -Math.PI / 2;
        this.bladeMat = new T.MeshStandardMaterial({color: 0x202124, roughness: .5, transparent: true, opacity: 1});
        for (const s of [-1, 1]) {const b = box(this.propG, .12, .82, .04, 0, s * .42, 0, this.bladeMat);b.rotation.y = s * .25;}
        this.pdisc = mesh(this.propG, new T.CircleGeometry(.85, 32), new T.MeshBasicMaterial({color: 0x2a2b2e, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false}));this.pdisc.castShadow = false;
        // Cockpit: seat, panel with gauges, centre stick, throttle quadrant on the left.
        box(g, .5, .1, .5, 0, -.12, .4, seatM);const back = box(g, .5, .65, .1, 0, .2, .7, seatM);back.rotation.x = -.25;
        box(g, .48, .1, .45, 0, -.1, 1.28, seatM);const back2 = box(g, .46, .6, .1, 0, .2, 1.56, seatM);back2.rotation.x = -.25;
        const panel = box(g, .78, .24, .1, 0, .28, -.64, dark);panel.rotation.x = -.35;box(g, .82, .04, .22, 0, .42, -.72, dark);
        for (let i = 0; i < 5; i++) {const gg = mesh(g, new T.CylinderGeometry(.042, .042, .01, 18), gaugeM, -.28 + i * .14, .3, -.585);gg.rotation.x = Math.PI / 2 - .35;}
        this.stick = new T.Group();this.stick.position.set(0, -.25, -.22);g.add(this.stick);rod(this.stick, [0, 0, 0], [0, .55, .05], .015, dark);
        this.lever = new T.Group();this.lever.position.set(-.38, .12, -.18);g.add(this.lever);rod(this.lever, [0, 0, 0], [0, .18, -.08], .012, dark);rod(this.lever, [-.05, .18, -.08], [.05, .18, -.08], .018, dark);
        this.armGroup = new T.Group();g.add(this.armGroup);this.armGroup.visible = false;
        this.hands = [hand(this.stick, 0, .55, .05, stickGrip, false), hand(this.lever, 0, .18, -.08, new T.Euler(0, 0, 0), true)];this.hands.forEach(h => {h.visible = false;});
        this.addArm(this.hands[0], [.2, .2, .32]);this.addArm(this.hands[1], [-.3, .2, .38]);
        g.traverse(o => {if (o.isMesh && o.material === glass) o.castShadow = false;});
        [this.propG, this.elevator, this.rudder, this.stick, this.lever, this.armGroup, ...this.ailerons].forEach(o => {o.userData.noMerge = true;});lib.mergeStatic(g);
      }
      reset() {super.reset();this.throttle = 0;}
      enter() {this.enterCommon();this.engine = audio.engine('plane');audio.sfx('starter');this.prop = 700;}
      spin(dt) {this.propG.rotation.z += this.prop / 60 * 2 * Math.PI * dt * .5;const blur = clamp((this.prop - 500) / 900, 0, 1);this.bladeMat.opacity = 1 - .85 * blur;this.pdisc.material.opacity = .12 * blur;}
      spinValue() {return this.prop;}
      setSpin(v) {this.prop = v;}
      update(dt, inp = {}) {
        const on = this.active && !this.broken;
        // Throttle lever: left stick ↑ adds power, ↓ takes it off, and it stays where you leave it (like an RC transmitter).
        this.throttle = on ? clamp(this.throttle - (inp.ly || 0) * dt * .7, 0, 1) : Math.max(0, this.throttle - dt);
        this.prop += ((on ? 700 + 2050 * this.throttle : 0) - this.prop) * Math.min(1, dt * 2);
        if (this.prop > 5 || this.active) this.spin(dt);
        if (this.broken) {this.crashT -= dt;if (this.crashT <= 0) this.reset();if (this.engine) this.engine.set(0, 0);return;}
        if (!this.active && this.grounded && this.speed < .01 && this.prop < 5) return;
        const lx = on ? inp.lx || 0 : 0, rx = on ? inp.rx || 0 : 0, ry = on ? inp.ry || 0 : 0, brake = on ? inp.brake || 0 : 1;
        const prev = this.pos.clone(), {f, u, r} = this.axes(), v = this.vel, V = v.length(), vb = this.bodyVel();
        const alpha = V > 2 ? Math.atan2(-vb.y, -vb.z) : 0, beta = V > 2 ? Math.atan2(vb.x, -vb.z) : 0, qS = .5 * RHO * V * V * this.S;
        // Lift with a stall above about 15°, induced drag, a side force that stops sideslip, and propeller thrust that fades with speed.
        // Flaps (the Caravan, flapsCl): extra lift below about 50 m/s for take-off and landing, gone by 65 m/s (the sport plane has none).
        const cl0 = .25 + (this.flapsCl || 0) * clamp((65 - V) / 15, 0, 1), a0 = .3, clMax = cl0 + 4.8 * a0;let CL = Math.abs(alpha) < a0 ? cl0 + 4.8 * alpha : Math.sign(alpha) * clMax * Math.max(.45, 1 - (Math.abs(alpha) - a0) * 2.5);
        if (vb.z > 0) CL = 0;
        const vhat = V > .1 ? v.clone().divideScalar(V) : f.clone(), F = V3();
        F.addScaledVector(V3().crossVectors(r, vhat).normalize(), qS * CL);
        F.addScaledVector(vhat, -qS * (.032 + .055 * CL * CL));
        F.addScaledVector(r, -qS * 1.2 * beta);
        F.addScaledVector(f, this.throttle * this.Tmax * Math.max(0, 1 - V / 95));
        const acc = F.divideScalar(this.mass);acc.y -= G;
        if (this.grounded) {
          // Wheels: rolling resistance, brakes (L2), no sliding sideways.
          const hv = V3(v.x, 0, v.z), hs = hv.length(), dec = (.25 + 4.5 * brake) * dt;if (hs > 0) v.addScaledVector(hv, -Math.min(1, dec / hs));
          const side = r.clone().setY(0).normalize();v.addScaledVector(side, -v.dot(side) * Math.min(1, dt * 8));
        }
        v.addScaledVector(acc, dt);
        // Controls command pitch/roll/yaw rates (they get authority with airspeed); the plane weathervanes into the airflow.
        // The stick commands angle of attack (as an elevator does): held back the plane keeps pulling up (climb, loop), centred
        // it settles into gentle level flight; full back is close to the stall.
        const auth = clamp(V / 28, 0, 1), elev = clamp((V - 8) / 18, 0, 1), alphaCmd = .045 + ry * (ry > 0 ? .3 : .2);
        const tw = V3((alphaCmd - alpha) * 3.2 * auth + ry * .3 * elev, (-lx * .5 - beta * 2.5) * auth, -rx * 2.6 * elev);
        if (this.grounded) {const pitch = this.attitude().pitch, want = ry > .05 && V > 18 ? ry * .22 : 0;tw.x = (want - pitch) * 3;tw.y = -lx * clamp(V / 5, 0, 1) * .55 * (V > 1 ? 1 : 0);tw.z = 0;}
        this.w.lerp(tw, Math.min(1, dt * 6));this.rotate(dt);
        this.pos.addScaledVector(v, dt);
        const g2 = heightAt(this.pos.x, this.pos.z);
        if (this.pos.y - this.gearH <= g2) {
          if (!this.grounded && (-v.y > 5 || this.axes().u.y < .85 || V > 55)) {this.pos.y = g2 + this.gearH;this.crash();return;}
          if (!this.grounded) audio.sfx('thud', {gain: .5});
          this.pos.y = g2 + this.gearH;if (v.y < 0) v.y = 0;this.grounded = true;
          const e = new T.Euler().setFromQuaternion(this.q, 'YXZ');e.x = clamp(e.x, 0, .22);e.z = 0;this.q.setFromEuler(e);
        } else if (this.pos.y - this.gearH > g2 + .12) this.grounded = false;
        if (this.obstacles(prev, Math.max(this.pos.y - this.gearH, g2))) return;
        // Leaving the area: a gentle turn back toward the neighbourhood.
        if (Math.hypot(this.pos.x, this.pos.z) > 1700) {const want = Math.atan2(this.pos.x, this.pos.z), d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));this.w.y += d * dt * .5;}
        this.place();
        this.stick.rotation.set(ry * .25, 0, -rx * .25);this.lever.rotation.x = -this.throttle * .6;
        this.elevator.rotation.x = ry * .35;this.rudder.rotation.y = -lx * .4;this.ailerons[0].rotation.x = -rx * .3;this.ailerons[1].rotation.x = rx * .3;this.solveArms();
        if (this.engine) this.engine.set(this.prop, this.throttle);
      }
      hud() {const gh = heightAt(this.pos.x, this.pos.z);return `${Math.round(this.speed * 3.6)} km/h · alt ${Math.max(0, this.pos.y - this.gearH - gh).toFixed(0)} m · throttle ${Math.round(this.throttle * 100)} % · climb ${this.vel.y >= 0 ? '+' : ''}${this.vel.y.toFixed(1)} m/s${this.grounded && this.speed < 26 && this.throttle > .5 ? ' · rotate at 85 km/h' : ''}`;}
    }

    // ---------- FPV drone (5-inch quad, about 650 g) ----------
    // Angle mode: the right stick sets the tilt and it levels itself; thrust holds altitude with the left stick centred.
    // Acro mode: the right stick sets rotation rates (flips and rolls), nothing self-levels – real freestyle FPV.
    // ---------- Cessna 208B Grand Caravan jump plane (issue #22): 12.7 m long, 15.9 m high wing, 26 m², turboprop ----------
    // The sport plane's flight model with the Caravan's numbers (2.6 t lightly loaded, 13 kN of static thrust, automatic
    // take-off flaps: it lifts off at about 30 m/s after some 130 m, so it gets off the 280 m grass strip). Twelve jumper places on two benches in the cabin and a roll-up door
    // on the left behind the wing. Model frame: nose at -z, the origin on the centre line at the cabin floor + 0.6 m.
    class JumpPlane extends Plane {
      constructor(x, z, yaw) {
        super(x, z, yaw);
        Object.assign(this, {kind: 'jumpplane', name: 'Cessna 208 Caravan jump plane', length: 12.7, width: 15.9, height: 4.5, radius: 4.5, top: 3.0, crashSpeed: 9,
          exitSide: 1.9, exitFwd: 3.3, mass: 2600, S: 25.96, Tmax: 13000, flapsCl: .55, chaseDist: 26, seatPitch: -.04, cullDistance: 6000});// seen by jumpers far below
        this.rects = [[0, 0, 12.6, 1.8], [-.6, 0, .5, 4.2]];// fuselage, main gear legs (the high wing and tail are above head height)
        this.seat = V3(-.42, .5, -3.35);
        this.hips = {d: {pos: V3(-.42, -.2, -3.15)}, p: {pos: V3(.42, -.2, -3.15)}};this.passengerEye = V3(.42, .5, -3.35);
        // Jumpers sit on two benches along the cabin, facing the tail; place n = n-th player in the lobby.
        this.jumpSeats = [];for (let k = 0; k < 6; k++) for (const sx of [-1, 1]) this.jumpSeats.push(V3(sx * .42, -.32, -2.3 + k * .82));
        for (let i = 0; i < 12; i++) this.hips['j' + i] = {pos: this.jumpSeats[i], yaw: Math.PI};
        this.door = V3(-1.05, .0, 1.55);// just outside the roll-up door
        this.gearH = 1.55;this.reset();
      }
      hipAnchor(seat) {const h = this.hips[seat];return h ? {obj: this.group, pos: h.pos, stance: 'sit', yaw: h.yaw || 0} : null;}// jumpers face the tail
      doorWorld() {this.group.updateMatrixWorld(true);return this.door.clone().applyMatrix4(this.group.matrixWorld);}
      seatWorld(i) {this.group.updateMatrixWorld(true);return this.jumpSeats[i % 12].clone().applyMatrix4(this.group.matrixWorld);}
      build() {
        const g = this.group, white = paintMat(0xf2f3f1), blue = paintMat(0x1f4f9a), red = paintMat(0xc8322c), glass = glassMat(), shell = paintMat(0xf2f3f1);shell.side = T.DoubleSide;
        const inner = new T.MeshStandardMaterial({color: 0x5a5f66, roughness: .85, side: T.DoubleSide}), floorM = new T.MeshStandardMaterial({color: 0x3a3d42, roughness: .9});
        // Cabin: a squarish tube 1.64 x 1.6 m, open at the door; nose cone with the engine cowling; tail cone rising to the fin.
        const cabin = (z0, z1, sideOpen) => {
          const L = z1 - z0, zc = (z0 + z1) / 2;
          box(g, 1.64, .06, L, 0, -.62, zc, floorM);box(g, 1.64, .06, L, 0, .98, zc, shell);
          box(g, .05, 1.6, L, .82, .18, zc, shell);
          if (!sideOpen) box(g, .05, 1.6, L, -.82, .18, zc, shell);
          else {box(g, .05, 1.6, 1.1, -.82, .18, z0 + .55, shell);box(g, .05, .3, L - 1.1, -.82, .83, (z0 + 1.1 + z1) / 2, shell);}
        };
        cabin(-4.3, .9, false);cabin(.9, 2.25, true);// the door opening: 1.35 m wide, 1.3 m high, left side behind the wing
        box(g, 1.62, 1.56, .04, 0, .18, 2.27, inner);// cabin back wall
        for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) box(g, .02, .32, .38, sx * .845, .45, -2.2 + k * .95, glass);// windows
        const prof = (pts, z, mat, sc = [1, 1]) => {const l = new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), 20);l.rotateX(Math.PI / 2);l.translate(0, 0, z);const m = mesh(g, l, mat);m.scale.set(sc[0], sc[1], 1);return m;};
        prof([[0, 0], [.22, .15], [.5, .7], [.62, 1.5], [.68, 2.0]], -6.3, white, [1.2, 1.2]);// nose and cowling, at -6.3 .. -4.3
        prof([[.95, 0], [.86, 1.4], [.55, 2.8], [.3, 3.9], [.12, 4.15]], 2.25, white, [.86, .9]).position.y = .2;// tail cone
        box(g, 1.7, .08, 9.2, 0, -.5, -1.6, blue);// belly stripe
        box(g, .02, .14, 6.6, .84, .32, -.9, red);box(g, .02, .14, 6.6, -.84, .32, -1.5, red);// cheat lines
        // Windscreen and cockpit.
        const ws = box(g, 1.5, .55, .05, 0, .65, -4.25, glass);ws.rotation.x = -.6;
        box(g, 1.3, .3, .1, 0, .2, -3.95, dark);for (let i = 0; i < 6; i++) {const gg = mesh(g, new T.CylinderGeometry(.04, .04, .01, 16), gaugeM, -.5 + i * .2, .24, -3.89);gg.rotation.x = Math.PI / 2;}
        for (const sx of [-1, 1]) {box(g, .5, .1, .5, sx * .42, -.42, -3.1, seatM);const bk = box(g, .5, .7, .1, sx * .42, -.05, -2.82, seatM);bk.rotation.x = -.2;}
        for (const sx of [-1, 1]) box(g, .32, .34, 4.9, sx * .42, -.45, -.05, seatM);// the two jumper benches
        // High wing with struts, flaps and ailerons.
        const planform = new T.Shape();planform.moveTo(-7.95, -.95);planform.lineTo(7.95, -.95);planform.lineTo(7.95, .95);planform.lineTo(-7.95, .95);planform.closePath();
        const wing = new T.ExtrudeGeometry(planform, {depth: .18, bevelEnabled: true, bevelThickness: .04, bevelSize: .04, bevelSegments: 2});wing.rotateX(Math.PI / 2);
        mesh(g, wing, white, 0, 1.18, -2.2);
        for (const sx of [-1, 1]) {rod(g, [sx * .8, -.45, -2.35], [sx * 3.4, 1.05, -2.35], .045, metal);box(g, .08, .1, 1.9, sx * 7.95, 1.05, -2.2, red);}
        this.ailerons = [-1, 1].map(s => {const hinge = new T.Group();hinge.position.set(s * 5.6, 1.04, -1.25);g.add(hinge);box(hinge, 3.4, .07, .4, 0, 0, .2, white);return hinge;});
        // Tail: stabilizer with elevator, fin with rudder (the fin top is about 4.5 m above the ground).
        box(g, 6.2, .1, .9, 0, .75, 5.65, white);
        this.elevator = new T.Group();this.elevator.position.set(0, .75, 6.1);g.add(this.elevator);box(this.elevator, 6.0, .08, .45, 0, 0, .22, white);
        const finS = new T.Shape();finS.moveTo(0, 0);finS.lineTo(1.9, 0);finS.lineTo(1.5, 2.55);finS.lineTo(.9, 2.55);finS.closePath();
        const finG = new T.ExtrudeGeometry(finS, {depth: .1, bevelEnabled: false});finG.translate(0, 0, -.05);finG.rotateY(-Math.PI / 2);mesh(g, finG, white, 0, .4, 4.6);
        this.rudder = new T.Group();this.rudder.position.set(0, .4, 6.45);g.add(this.rudder);box(this.rudder, .08, 2.4, .45, 0, 1.25, .22, blue);
        // Fixed tricycle gear on spring legs.
        for (const s of [-1, 1]) {rod(g, [s * .7, -.6, -.6], [s * 1.95, -1.17, -.6], .06, metal);const w = mesh(g, new T.CylinderGeometry(.38, .38, .22, 20), rubber, s * 1.95, -1.17, -.6);w.rotation.z = Math.PI / 2;}
        rod(g, [0, -.6, -5.3], [0, -1.25, -5.45], .06, metal);const nw = mesh(g, new T.CylinderGeometry(.3, .3, .16, 18), rubber, 0, -1.25, -5.45);nw.rotation.z = Math.PI / 2;
        // Three-blade propeller.
        this.propG = new T.Group();this.propG.position.set(0, .05, -6.35);g.add(this.propG);
        const spin = mesh(this.propG, new T.ConeGeometry(.22, .5, 18), blue, 0, 0, -.22);spin.rotation.x = -Math.PI / 2;
        this.bladeMat = new T.MeshStandardMaterial({color: 0x202124, roughness: .5, transparent: true, opacity: 1});
        for (let i = 0; i < 3; i++) {const bg = new T.Group();bg.rotation.z = i * Math.PI * 2 / 3;this.propG.add(bg);const b = box(bg, .16, 1.3, .05, 0, .7, 0, this.bladeMat);b.rotation.y = .3;}
        this.pdisc = mesh(this.propG, new T.CircleGeometry(1.35, 32), new T.MeshBasicMaterial({color: 0x2a2b2e, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false}));this.pdisc.castShadow = false;
        // Pilot's control column (works like the stick in the flight model) and the power lever.
        this.stick = new T.Group();this.stick.position.set(-.42, -.05, -3.8);g.add(this.stick);rod(this.stick, [0, 0, 0], [0, .38, .12], .02, dark);rod(this.stick, [-.16, .38, .12], [.16, .38, .12], .022, dark);
        this.lever = new T.Group();this.lever.position.set(0, .05, -3.75);g.add(this.lever);rod(this.lever, [0, 0, 0], [0, .16, -.06], .012, dark);
        this.armGroup = new T.Group();g.add(this.armGroup);this.armGroup.visible = false;
        this.hands = [hand(this.stick, .12, .38, .12, stickGrip, false), hand(this.lever, 0, .16, -.06, new T.Euler(0, 0, 0), true)];this.hands.forEach(h => {h.visible = false;});
        this.addArm(this.hands[0], [-.15, .1, -3.3]);this.addArm(this.hands[1], [-.15, .1, -3.25]);
        g.traverse(o => {if (o.isMesh && o.material === glass) o.castShadow = false;});
        [this.propG, this.elevator, this.rudder, this.stick, this.lever, this.armGroup, ...this.ailerons].forEach(o => {o.userData.noMerge = true;});lib.mergeStatic(g);
      }
    }

    class Drone {
      constructor() {this.pos = V3();this.vel = V3();this.q = new T.Quaternion();this.mode = 'angle';this.battery = 1;this.armed = false;this.crashed = false;this.yawA = 0;this.pitchA = 0;this.rollA = 0;this.time = 0;this.thrust = 0;this.home = V3();this.engine = null;}
      launch(x, y, z, yaw) {this.pos.set(x, y + .06, z);this.home.copy(this.pos);this.vel.set(0, 0, 0);this.yawA = yaw;this.pitchA = this.rollA = 0;this.q.setFromEuler(new T.Euler(0, yaw, 0, 'YXZ'));this.battery = 1;this.armed = true;this.crashed = false;this.time = 0;this.landed = true;audio.sfx('arm');this.engine = audio.engine('drone');}
      stop() {if (this.engine) this.engine.stop();this.engine = null;this.armed = false;}
      setMode(m) {this.mode = m;const e = new T.Euler().setFromQuaternion(this.q, 'YXZ');this.yawA = e.y;this.pitchA = clamp(e.x, -.8, .8);this.rollA = clamp(-e.z, -.8, .8);}
      reset() {this.crashed = false;this.vel.set(0, 0, 0);this.pitchA = this.rollA = 0;this.q.setFromEuler(new T.Euler(0, this.yawA, 0, 'YXZ'));this.armed = this.battery > 0;this.landed = true;audio.sfx('arm');}
      // env: {floor(p, y) -> {y, ceiling}, solid(p, y0, y1) -> bool, listener: {x, y, z}}
      update(dt, inp, env) {
        if (this.crashed) {if (this.engine) this.engine.set(0, 0);return;}
        const lx = inp.lx || 0, ly = inp.ly || 0, rx = inp.rx || 0, ry = inp.ry || 0;this.time += dt;
        let thrust;
        if (this.mode === 'angle') {
          this.yawA -= lx * 3.2 * dt;
          // The stick sets the tilt; flying by mouse, the mouse moves the tilt (up to 0.75 rad) and it stays there.
          if (inp.hold) {this.pitchA = clamp(this.pitchA + ry * 1.6 * dt, -.75, .75);this.rollA = clamp(this.rollA + rx * 1.6 * dt, -.75, .75);}
          else {this.pitchA += (ry * .75 - this.pitchA) * Math.min(1, dt * 9);this.rollA += (rx * .75 - this.rollA) * Math.min(1, dt * 9);}
          this.q.setFromEuler(new T.Euler(this.pitchA, this.yawA, -this.rollA, 'YXZ'));
          // Left stick sets the climb rate (±7 m/s); centred and level it holds altitude. The thrust is not raised for the tilt
          // (issue #73): tilted, only cos(tilt) of it holds the drone up, so it sinks (about 1.6 m/s at full tilt) unless you add thrust.
          thrust = clamp(G + (-ly * 7 - this.vel.y) * 2, 0, 3.4 * G);
        } else {
          this.q.multiply(new T.Quaternion().setFromEuler(new T.Euler(ry * 7 * dt, -lx * 4.5 * dt, -rx * 7 * dt, 'XYZ'))).normalize();
          thrust = G * Math.max(0, 1 + -ly * 2.4);
        }
        if (!this.armed) thrust = 0;
        this.battery = Math.max(0, this.battery - dt / 300 * (.35 + .65 * clamp(thrust / (2.5 * G), 0, 1)));if (this.battery <= 0) this.armed = false;
        if (this.landed && thrust < G * 1.02) thrust = Math.min(thrust, G);
        this.thrust = clamp(thrust / (3.4 * G), 0, 1);
        const u = V3(0, 1, 0).applyQuaternion(this.q), v = this.vel, sp = v.length(), prev = this.pos.clone();
        const acc = u.multiplyScalar(thrust);acc.y -= G;acc.addScaledVector(v, -(.18 + .012 * sp));
        v.addScaledVector(acc, dt);this.pos.addScaledVector(v, dt);
        // Ground, floors and ceilings (works indoors too), then walls, trees, buildings and vehicles.
        const fl = env.floor(this.pos, prev.y + .05);
        if (fl && this.pos.y < fl.y + .05) {
          const hard = -v.y > 4.5 || Math.hypot(v.x, v.z) > 7 || V3(0, 1, 0).applyQuaternion(this.q).y < .5;
          this.pos.y = fl.y + .05;if (hard) return this.crash();if (v.y < 0) v.y = 0;v.x *= .8;v.z *= .8;this.landed = true;
          if (this.mode === 'acro') {const e = new T.Euler().setFromQuaternion(this.q, 'YXZ');this.q.setFromEuler(new T.Euler(0, e.y, 0, 'YXZ'));}
        } else if (!fl || this.pos.y > fl.y + .1) this.landed = false;
        if (fl && fl.ceiling < Infinity && this.pos.y > fl.y + fl.ceiling - .12) {this.pos.y = fl.y + fl.ceiling - .12;if (v.y > 3.5) return this.crash();v.y = Math.min(0, v.y);}
        if (env.solid(this.pos, this.pos.y - .06, this.pos.y + .08)) {if (sp > 3) return this.crash();this.pos.copy(prev);v.multiplyScalar(-.4);}
        if (this.engine) {const d = env.listener ? this.pos.distanceTo(env.listener) : 0;this.engine.set(this.armed ? this.thrust : 0, clamp(14 / (d + 6), .05, 1));}
      }
      crash() {this.crashed = true;this.vel.set(0, 0, 0);audio.sfx('crash', {gain: .45});}
      // FPV camera tilted up (more in acro, where you fly fast and tilted forward).
      cameraPose() {const tilt = this.mode === 'acro' ? .45 : .2, q = this.q.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(tilt, 0, 0)));return {position: this.pos.clone().add(V3(0, .03, 0)), quaternion: q};}
      osd(groundY) {
        const cells = 4, volts = cells * (3.5 + .7 * this.battery);
        return {mode: this.mode === 'angle' ? 'ANGLE' : 'ACRO', battery: Math.round(this.battery * 100), volts: volts.toFixed(1), alt: Math.max(0, this.pos.y - groundY), speed: this.vel.length() * 3.6, time: this.time, dist: Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z), armed: this.armed, crashed: this.crashed, thrust: this.thrust};
      }
    }
    return {Helicopter, Plane, JumpPlane, Drone};
  }
  return {create};
});
