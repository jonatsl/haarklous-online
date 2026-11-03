/* E-scooters and Oslo city bikes (issue #57), with e-bikes among the city bikes (the user's comment on #57, 3 Nov 2026).
 * E-scooters stand on the pavements around Torshov and Grünerløkka. □ unlocks one: a start fee and a price per started
 * minute come out of your wallet. You ride standing, alone, at up to 20 km/h (the Norwegian limit for e-scooters). Getting
 * off ends the ride and the scooter stays where you left it – online too, because it is a vehicle like the cars, so the
 * lobby keeps its place for everybody.
 * City bikes stand in the real Oslo Bysykkel docks (rides-data.js, from the operator's open GBFS data): take one from a
 * dock, pedal with R2 (faster than walking, slower than a motorcycle, harder uphill; an e-bike helps you up to 25 km/h)
 * and put it in any dock with a free slot. Prices are the real ones from the same feed: 8 kr a trip, then 1 kr (e-bike
 * 2 kr) for every started minute after the first. Getting off outside a dock locks the bike there and the trip goes on;
 * after 15 minutes it ends and you pay 250 kr for not returning it (the game's own rule). The map shows every dock
 * with how many bikes and e-bikes are free.
 * Pure parts (Node-tested): PLANS, tripCost(kind, seconds), dockSlots(dock, slot), dockCount(dock, bikes, slot),
 *   scooterSpots({roads, regions, count, seed, ok}), clock(seconds).
 * GameRentals.create({T, lib, audio, data, toWorld, heightAt}) -> {group, docks, obstacles, keepOut, SLOT, manager(ctx),
 *   vehicles(VH) -> {Scooter, CityBike, bikes, placeScooters(spots)}} (the docks come first: their posts go into the walk world)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameRentals = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // ---------- Prices (kroner) ----------
  // City bikes: Oslo Bysykkel's system_pricing_plans (GBFS, 3 Nov 2026), copied into rides-data.js. E-scooters: a typical
  // Oslo price (10 kr to unlock, 3 kr every started minute), not one particular company's.
  const SCOOTER_PLAN = {plan_id: 'scooter', name: 'E-scooter', price: 10, per_min_pricing: [{start: 0, rate: 3, interval: 1, end: 1e9}]};
  const FALLBACK = {bike: {price: 8, per_min_pricing: [{start: 1, rate: 1, end: 180, interval: 1}]}, ebike: {price: 8, per_min_pricing: [{start: 1, rate: 2, end: 180, interval: 1}]}};
  function plans(data) {const p = (data && data.plans) || {};return {scooter: SCOOTER_PLAN, bike: p.bike || FALLBACK.bike, ebike: p.ebike || FALLBACK.ebike};}
  const PLANS = plans(typeof window !== 'undefined' ? window.RIDES : null);
  const NOT_RETURNED = {fee: 250, afterS: 15 * 60};
  const NAMES = {scooter: 'E-scooter', bike: 'City bike', ebike: 'City e-bike'};
  // GBFS per_min_pricing: from `start` minutes on, `rate` is charged at the start of every `interval` minutes until `end`.
  function tripCost(kind, seconds, plan = PLANS[kind]) {
    const m = Math.max(0, seconds || 0) / 60;let c = plan.price;
    for (const seg of plan.per_min_pricing || []) {
      if (m < seg.start) continue;
      const n = m >= seg.end ? Math.ceil((seg.end - seg.start) / seg.interval) : Math.floor((m - seg.start) / seg.interval) + 1;
      c += n * seg.rate;
    }
    return Math.round(c * 100) / 100;
  }
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // ---------- Docks ----------
  // A dock's slots in local map coordinates: the bikes stand side by side along u, SLOT apart, their fronts toward n (the posts).
  function dockSlots(d, slot = .8) {const out = [];for (let i = 0; i < d.slots; i++) {const a = (i - (d.slots - 1) / 2) * slot;out.push({i, x: d.x + d.u[0] * a, s: d.s + d.u[1] * a});}return out;}
  // Bikes standing in a dock (within 0.5 m of a slot, nobody on them): how many of each kind, and which slots are free.
  function dockCount(d, bikes, slot = .8) {
    const taken = new Set(), out = {bike: 0, ebike: 0, free: []};
    const slots = dockSlots(d, slot);
    for (const b of bikes) {
      if (b.inUse) continue;
      const k = slots.findIndex(q => !taken.has(q.i) && Math.hypot(q.x - b.x, q.s - b.s) < .5);if (k < 0) continue;
      taken.add(k);out[b.electric ? 'ebike' : 'bike']++;
    }
    for (const q of slots) if (!taken.has(q.i)) out.free.push(q.i);
    return out;
  }
  // E-scooter spots: on the pavement beside streets in the given regions, at least `gap` m apart; ok(x, s, heading) is the
  // game's own check (room to stand, not in a building). Seeded, so every player gets the same scooters in the same places.
  function scooterSpots({roads, regions, seed = 4242, gap = 22, ok = () => true}) {
    let r = seed;const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const kinds = ['residential', 'tertiary', 'secondary', 'unclassified', 'living_street', 'primary'];
    const out = [];
    for (const reg of regions) {
      const segs = [];
      for (const road of roads) {if (!kinds.includes(road.k)) continue;for (let i = 0; i + 3 < road.p.length; i += 2) {const a = [road.p[i], road.p[i + 1]], b = [road.p[i + 2], road.p[i + 3]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);if (L > 8 && reg.inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) segs.push({a, b, L, w: road.w || 6});}}
      let placed = 0, tries = 0;
      while (placed < reg.count && segs.length && tries++ < reg.count * 60) {
        const s = segs[Math.floor(rnd() * segs.length)], t = .1 + rnd() * .8, side = rnd() < .5 ? 1 : -1, ux = (s.b[0] - s.a[0]) / s.L, us = (s.b[1] - s.a[1]) / s.L;
        const off = s.w / 2 + 2.4 + rnd() * .8, x = s.a[0] + (s.b[0] - s.a[0]) * t - us * off * side, z = s.a[1] + (s.b[1] - s.a[1]) * t + ux * off * side;
        if (!reg.inside(x, z) || out.some(o => Math.hypot(o.x - x, o.s - z) < gap)) continue;
        const heading = Math.atan2(ux, us) + (rnd() - .5) * 1.4 + (rnd() < .5 ? Math.PI : 0);
        if (!ok(x, z, heading)) continue;
        out.push({x, s: z, heading, look: Math.floor(rnd() * 3)});placed++;
      }
    }
    return out;
  }

  function create({T, lib, audio, data, toWorld, heightAt}) {
    const V3 = (x, y, z) => new T.Vector3(x, y, z), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const SLOT = data.slot || .8;
    // World direction of a local map direction, and the yaw that faces it (the vehicles' forward is -z at yaw 0).
    const o0 = toWorld(0, 0);const dirW = (dx, ds) => {const p = toWorld(dx, ds);return {x: p.x - o0.x, z: p.z - o0.z};};
    const yawOf = (dx, ds) => {const w = dirW(dx, ds);return Math.atan2(-w.x, -w.z);};
    const black = lib.polymer(0x17181a), rubber = new T.MeshStandardMaterial({color: 0x161616, roughness: .9}), alu = lib.metal(0xb8bdc2, .35), grey = lib.metal(0x55595e, .5);
    const named = (o, name) => {o.name = name;return o;};
    const noShadow = g => g.traverse(o => {if (o.isMesh) o.castShadow = false;});

    // ---------- The docks: posts, a totem with the station's name, bikes in their slots ----------
    const group = new T.Group(), obstacles = [], keepOut = [];
    const postMat = lib.metal(0x2b2f35, .45), totemMat = lib.paint(0x14306b, .5);
    let seed = 9001;const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    function signTexture(name) {
      const c = document.createElement('canvas');c.width = 256;c.height = 512;const g = c.getContext('2d');
      g.fillStyle = '#14306b';g.fillRect(0, 0, 256, 512);g.fillStyle = '#fff';g.textAlign = 'center';
      g.font = 'bold 30px system-ui, Arial';g.fillText('OSLO', 128, 60);g.fillText('BYSYKKEL', 128, 96);
      g.lineWidth = 9;g.strokeStyle = '#fff';for (const cx of [84, 172]) {g.beginPath();g.arc(cx, 190, 34, 0, 7);g.stroke();}g.beginPath();g.moveTo(84, 190);g.lineTo(118, 150);g.lineTo(158, 150);g.lineTo(172, 190);g.moveTo(118, 150);g.lineTo(128, 190);g.lineTo(158, 150);g.stroke();
      const words = name.split(' '), lines = [];let line = '';g.font = 'bold 34px system-ui, Arial';
      for (const w of words) {const t = line ? line + ' ' + w : w;if (g.measureText(t).width > 230 && line) {lines.push(line);line = w;} else line = t;}lines.push(line);
      lines.slice(0, 4).forEach((l, i) => g.fillText(l, 128, 300 + i * 42));
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return t;
    }
    const docks = data.docks.map((d, di) => {
      const slots = dockSlots(d, SLOT).map(q => ({...q, w: toWorld(q.x, q.s)})), n = dirW(d.n[0], d.n[1]), u = dirW(d.u[0], d.u[1]), yaw = yawOf(d.n[0], d.n[1]);
      const centre = toWorld(d.x, d.s), dock = {...d, index: di, slotPos: slots, centre, yaw, count: {bike: 0, ebike: 0, free: []}, meshes: []};
      // Posts in front of each slot (the lock takes the front wheel) and a low rail joining them; one mesh per material a dock.
      const g = new T.Group();group.add(g);dock.meshes.push(g);
      const add = (geo, mat, x, y, z, ry = yaw) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.rotation.y = ry;m.castShadow = m.receiveShadow = true;g.add(m);return m;};
      for (const q of slots) {const p = {x: q.w.x + n.x * .86, z: q.w.z + n.z * .86}, y = heightAt(p.x, p.z);add(new T.CylinderGeometry(.045, .055, .82, 10), postMat, p.x, y + .41, p.z);add(new T.BoxGeometry(.12, .1, .16), postMat, p.x, y + .8, p.z);}
      const half = (d.slots - 1) / 2 * SLOT + .25, a = {x: centre.x + n.x * .86 - u.x * half, z: centre.z + n.z * .86 - u.z * half}, b = {x: centre.x + n.x * .86 + u.x * half, z: centre.z + n.z * .86 + u.z * half};
      add(new T.BoxGeometry(.06, .06, Math.hypot(b.x - a.x, b.z - a.z)), postMat, (a.x + b.x) / 2, heightAt((a.x + b.x) / 2, (a.z + b.z) / 2) + .12, (a.z + b.z) / 2, Math.atan2(b.x - a.x, b.z - a.z));
      // The totem at the end of the row, the station's name on both faces.
      const tp = {x: centre.x + n.x * .86 + u.x * (half + .55), z: centre.z + n.z * .86 + u.z * (half + .55)}, ty = heightAt(tp.x, tp.z);
      const face = new T.MeshStandardMaterial({map: signTexture(d.name), roughness: .5});
      add(new T.BoxGeometry(.5, 1.9, .14), [totemMat, totemMat, totemMat, totemMat, face, face], tp.x, ty + .95, tp.z);
      lib.mergeStatic(g);
      const box = (cx, cz, hx, hz, h, y0) => {const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([i, j]) => ({x: cx + u.x * i + n.x * j, z: cz + u.z * i + n.z * j}));return {points: pts, minY: y0 - .3, maxY: y0 + h, kind: 'dock'};};
      obstacles.push(box(centre.x + n.x * .86, centre.z + n.z * .86, half, .08, .9, heightAt(centre.x, centre.z)), box(tp.x, tp.z, .28, .1, 1.9, ty));
      keepOut.push({x: centre.x, z: centre.z, r: half + 3});
      // Bikes: seeded, so every player gets the same bikes in the same slots (about a third e-bikes).
      const filled = Math.max(2, Math.min(d.slots - 1, Math.round(d.slots * (.35 + rnd() * .4)))), order = slots.map(q => q.i);
      for (let i = order.length - 1; i > 0; i--) {const j = Math.floor(rnd() * (i + 1));[order[i], order[j]] = [order[j], order[i]];}
      dock.initial = order.slice(0, filled).map(i => ({i, electric: rnd() < .33}));
      return dock;
    });
    // ---------- The rental vehicles (made once the game's vehicle classes exist) ----------
    function vehicles(VH) {
      const P = VH.parts;
      // ---------- Models: built once per look, then cloned (the clones share geometry and materials) ----------
      // E-scooter: 10" wheels, 0.9 m wheelbase, a deck 14 cm up, a raked stem with a T-bar, a display and lights.
      const SCOOTER_LOOKS = [{body: 0xef6461, trim: 0x1f2226}, {body: 0x2a9d63, trim: 0x15171a}, {body: 0x1d2024, trim: 0x22b8a6}];
      const WR = .125, WB_S = .9;
      function scooterProto(look) {
        const L = SCOOTER_LOOKS[look % SCOOTER_LOOKS.length], paint = lib.paint(L.body, .4), trim = lib.paint(L.trim, .5);
        const root = new T.Group(), body = named(new T.Group(), 'body');root.add(body);
        P.mesh(body, P.rounded(.17, .06, .8, .025), paint, 0, .14, .02);P.box(body, .15, .006, .7, 0, .173, .03, black);
        P.mesh(body, new T.CylinderGeometry(.15, .15, .07, 14, 1, true, Math.PI * .05, Math.PI * .7), trim, 0, .13, .45).rotation.z = Math.PI / 2;
        P.rod(body, [0, .15, -.36], [0, .3, -.43], .03, paint);P.box(body, .05, .03, .03, 0, .19, .49, trim);
        P.rod(body, [-.07, .12, .08], [-.17, .02, .14], .008, black);// kickstand
        const rw = named(P.wheel(root, WR, .06, grey, rubber, 5), 'rw');rw.position.set(0, WR, .45);
        // Steering: the stem's axis is raked 12° (top toward the rider); `turn` turns about it.
        const steer = named(new T.Group(), 'steer');steer.position.set(0, .3, -.45);steer.rotation.x = .21;root.add(steer);
        const turn = named(new T.Group(), 'turn');steer.add(turn);
        P.cyl(turn, .022, .022, .84, 0, .33, 0, trim);P.cyl(turn, .03, .03, .2, 0, -.06, 0, paint);
        const bar = P.cyl(turn, .014, .014, .5, 0, .76, 0, black);bar.rotation.z = Math.PI / 2;
        for (const s of [-1, 1]) {const g = P.cyl(turn, .019, .019, .1, s * .2, .76, 0, black, 10);g.rotation.z = Math.PI / 2;}
        P.mesh(turn, P.rounded(.09, .02, .06, .008), black, 0, .78, .02).rotation.x = -.4;P.box(turn, .06, .04, .03, 0, .62, -.03, paint);
        const fork = named(new T.Group(), 'fork');fork.position.y = -.18;turn.add(fork);
        P.mesh(turn, new T.CylinderGeometry(.15, .15, .07, 14, 1, true, -Math.PI * .75, Math.PI * .7), trim, 0, -.17, 0).rotation.z = Math.PI / 2;
        named(P.wheel(fork, WR, .06, grey, rubber, 5), 'fw');
        // The rider's gloved hands on the grips (seen when looking down).
        const hands = named(new T.Group(), 'hands');turn.add(hands);hands.visible = false;
        P.hand(hands, -.2, .775, 0, new T.Euler(0, 0, 0), true);P.hand(hands, .2, .775, 0, new T.Euler(0, 0, 0), false);
        for (const s of [-1, 1]) P.forearm(hands, [s * .19, .8, .03], [s * .16, 1.0, .42]);
        for (const g of [rw, steer]) g.userData.noMerge = true;lib.mergeStatic(body);
        for (const g of [fork, hands]) g.userData.noMerge = true;lib.mergeStatic(turn);
        noShadow(rw);noShadow(fork);noShadow(hands);
        return root;
      }
      // Oslo city bike: 26" wheels, step-through frame, swept bars, front carrier, chain guard, mudguards; the e-bike has a
      // battery on the down tube and a rear hub motor.
      const BR = .34, WB_B = 1.1;
      function bikeProto(electric) {
        const frame = lib.paint(0x1f4fa3, .38), white = lib.paint(0xeef1f4, .4), root = new T.Group(), body = named(new T.Group(), 'body');root.add(body);
        const tube = (a, b, r = .024, m = frame) => P.rod(body, a, b, r, m);
        tube([0, .64, -.44], [0, .4, -.2]);tube([0, .4, -.2], [0, .3, .02]);tube([0, .3, .02], [0, .86, .2]);tube([0, .55, -.38], [0, .5, -.12], .018);
        for (const s of [-1, 1]) {tube([0, .3, .02], [s * .06, BR, .55], .014);tube([0, .8, .18], [s * .06, BR, .55], .013);}
        tube([0, .605, -.452], [0, .81, -.381], .03);// head tube (on the steering axis)
        P.rod(body, [0, .86, .2], [0, .96, .24], .014, alu);P.mesh(body, P.rounded(.17, .06, .27, .03), black, 0, .99, .25);
        P.box(body, .02, .1, .5, .075, .34, .29, frame);// chain guard
        P.mesh(body, new T.CylinderGeometry(.38, .38, .07, 18, 1, true, -Math.PI * .1, Math.PI * .8), frame, 0, BR, .55).rotation.z = Math.PI / 2;
        // Front carrier on the head tube, and the dock's lock tab under it.
        P.box(body, .36, .015, .3, 0, .92, -.62, alu);for (const s of [-1, 1]) {P.box(body, .015, .1, .3, s * .17, .97, -.62, alu);P.rod(body, [s * .12, .91, -.5], [0, .74, -.44], .01, alu);}
        P.box(body, .32, .015, .015, 0, 1.02, -.765, alu);P.box(body, .32, .015, .015, 0, 1.02, -.475, alu);
        P.box(body, .05, .03, .04, 0, .75, -.5, black);P.box(body, .05, .03, .02, 0, .82, .82, black);
        if (electric) {P.mesh(body, P.rounded(.1, .1, .36, .03), white, 0, .53, -.25).rotation.x = -1.05;const hub = P.cyl(body, .07, .07, .08, 0, BR, .55, black, 16);hub.rotation.z = Math.PI / 2;}
        const rw = named(P.wheel(root, BR, .05, alu, rubber, 6), 'rw');rw.position.set(0, BR, .55);
        const crank = named(new T.Group(), 'crank');crank.position.set(0, .3, .02);root.add(crank);
        for (const s of [-1, 1]) {P.box(crank, .02, .17, .03, s * .1, s * -.085, 0, alu);P.box(crank, .1, .025, .06, s * .15, s * -.17, 0, alu);}
        P.cyl(crank, .09, .09, .012, .06, 0, 0, alu, 18).rotation.z = Math.PI / 2;
        const steer = named(new T.Group(), 'steer');steer.position.set(0, .7, -.42);steer.rotation.x = .33;root.add(steer);
        const turn = named(new T.Group(), 'turn');steer.add(turn);
        for (const s of [-1, 1]) P.rod(turn, [s * .05, -.1, 0], [s * .05, -.38, 0], .013, frame);P.rod(turn, [0, .1, 0], [0, .38, 0], .016, alu);
        // Swept-back handlebar (Dutch style): grips 0.3 m out, bent back toward the rider.
        for (const s of [-1, 1]) {P.rod(turn, [0, .38, 0], [s * .2, .4, .02], .012, alu);P.rod(turn, [s * .2, .4, .02], [s * .27, .4, .16], .012, alu);const g = P.cyl(turn, .018, .018, .11, s * .28, .4, .2, black, 10);g.rotation.x = Math.PI / 2;}
        P.mesh(turn, new T.CylinderGeometry(.38, .38, .07, 18, 1, true, -Math.PI * .7, Math.PI * .6), frame, 0, -.38, 0).rotation.z = Math.PI / 2;
        const fork = named(new T.Group(), 'fork');fork.position.y = -.38;turn.add(fork);
        named(P.wheel(fork, BR, .05, alu, rubber, 6), 'fw');
        const hands = named(new T.Group(), 'hands');turn.add(hands);hands.visible = false;
        for (const s of [-1, 1]) {P.hand(hands, s * .28, .405, .2, new T.Euler(0, Math.PI / 2, 0), s < 0);P.forearm(hands, [s * .27, .44, .25], [s * .2, .72, .6]);}
        for (const g of [rw, crank, steer]) g.userData.noMerge = true;lib.mergeStatic(body);
        for (const g of [fork, hands]) g.userData.noMerge = true;lib.mergeStatic(turn);
        noShadow(rw);noShadow(fork);noShadow(crank);noShadow(hands);
        return root;
      }
      const protos = new Map();
      const model = key => {if (!protos.has(key)) protos.set(key, key === 'bike' ? bikeProto(false) : key === 'ebike' ? bikeProto(true) : scooterProto(+key.slice(1)));return protos.get(key).clone(true);};
      const partsOf = m => ({rw: m.getObjectByName('rw'), fw: m.getObjectByName('fw'), turn: m.getObjectByName('turn'), hands: m.getObjectByName('hands'), crank: m.getObjectByName('crank')});

      // ---------- Light two-wheelers: shared riding physics ----------
      class Light extends VH.Vehicle {
        constructor(x, z, yaw, radius, length) {super(x, z, yaw, radius, length);this.flies = true;this.lean = 0;this.bar = 0;this.wheelSpin = 0;this.restLean = -.1;this.rested = false;this.motor = null;}
        // Kinematic steering (bicycle model) with the rider leaning into the turn; a little drunk wobble.
        steerRide(dt, input, wb, maxLean) {
          const wob = input.drunk ? Math.sin(performance.now() / 360) * .35 * input.drunk : 0, steer = clamp(input.steer + wob, -1, 1);
          if (!this.airborne) {this.bar += (steer * .6 / (1 + Math.abs(this.speed) * .3) - this.bar) * Math.min(1, dt * 7);this.yaw -= this.speed * Math.tan(this.bar) / wb * dt;}
          const lat = this.speed * this.speed * Math.tan(this.bar) / wb;this.lean += (clamp(Math.atan(lat / 9.81), -maxLean, maxLean) - this.lean) * Math.min(1, dt * 5);
        }
        park(dt) {this.speed *= Math.max(0, 1 - dt * 3);this.bar *= Math.max(0, 1 - dt * 3);this.lean += (this.restLean - this.lean) * Math.min(1, dt * 3);}
        // A parked one does nothing until somebody rides it or the lobby moves it.
        update(dt, input) {
          if (!this.active && this.rested) return;
          if (this.active) this.ride(dt, input);else this.park(dt);
          this.roll = -this.lean;this.move(dt);this.settle(dt);this.animate(dt, input);this.place();
          if (!this.active && Math.abs(this.speed) < .01 && Math.abs(this.lean - this.restLean) < .005) this.rested = true;
        }
        seat() {const f = this.forward(), up = this.eye;return {x: this.x + f.x * this.eyeZ, y: this.y + up * Math.cos(this.lean) - this.squash, z: this.z + f.z * this.eyeZ, lateral: Math.sin(this.lean) * up, yaw: this.yaw, pitch: this.pitch, roll: this.lean};}
        exit() {this.active = false;this.parts.hands.visible = false;if (this.motor) this.motor.stop();this.motor = null;this.speed = 0;return this.exitPoint(-1);}
        netExtra() {return [this.bar, this.lean];}
        netApply(a) {this.bar = a[0] || 0;this.lean = a[1] || 0;this.rested = false;}
        netAnimate(dt) {this.animate(dt, null);}
      }
      // E-scooter: about 400 W, at most 1.8 m/s² with a rider (about 90 kg together), the motor cut off at 20 km/h.
      const SCOOTER_TOP = 20 / 3.6;
      class Scooter extends Light {
        constructor(x, z, yaw, look = 0) {
          super(x, z, yaw, .3, 1.15);this.width = .5;this.height = 1.2;this.kind = 'scooter';this.rental = 'scooter';this.name = 'e-scooter';this.verb = 'Unlock the';
          this.cullDistance = 75;this.eye = 1.74;this.eyeZ = -.02;this.camPitch = -.14;this.look = look;
          this.hips = {d: {pos: V3(0, .17, .06), stance: 'scoot'}};
          const m = model('s' + look);this.group.add(m);this.parts = partsOf(m);
          this.help = 'E-scooter · R2 / W go (20 km/h at most) · L2 / S brake · left stick steer · □ get off: the ride ends and it is paid';
          this.lean = this.restLean;this.roll = -this.lean;this.settle(1);this.place();this.rested = true;
        }
        enter() {this.active = true;this.rested = false;this.parts.hands.visible = true;audio.sfx('unlock');this.motor = audio.engine('emotor');}
        ride(dt, input) {
          const v = this.speed, air = this.airborne, cut = this.powerOff ? 0 : clamp((SCOOTER_TOP - v) / .5, 0, 1);
          const drive = air ? 0 : input.throttle * cut * Math.min(1.8, 400 / 90 / Math.max(.5, v)), brake = air ? 0 : input.brake * (v > .2 ? 5 : 0);
          const resist = Math.abs(v) > .05 ? Math.sign(v) * (.12 + .005 * v * v) : 0, slope = air ? 0 : 9.81 * Math.sin(this.pitch);
          const back = !air && input.brake > .5 && v < .2 && input.throttle < .1;// L2 when stopped walks it backwards
          this.speed = back ? Math.max(-.8, Math.min(0, v) - 1.5 * dt) : clamp(v + (drive - brake - resist - slope) * dt, v > .2 ? 0 : -.8, 12);
          if (!back && Math.abs(this.speed) < .04 && input.throttle < .05 && Math.abs(slope) < .4) this.speed = 0;
          this.steerRide(dt, input, WB_S, .4);
          if (this.motor) this.motor.set(Math.abs(this.speed) / SCOOTER_TOP, input.throttle * cut);
        }
        animate(dt) {const p = this.parts;this.wheelSpin += this.speed * dt / WR;p.fw.rotation.x = p.rw.rotation.x = -this.wheelSpin;p.turn.rotation.y = -this.bar;}
        hud() {return `${Math.round(Math.abs(this.speed) * 3.6)} km/h`;}
      }
      // City bike: the rider gives about 180 W (R2 = pedal), at most 130 N; the 3-speed hub tops out near 26 km/h. The e-bike
      // adds up to 250 W while you pedal, fading out between 23 and 25 km/h (the EU pedelec limit). Bike + rider about 95 kg.
      class CityBike extends Light {
        constructor(x, z, yaw, electric = false) {
          super(x, z, yaw, .3, 1.8);this.width = .56;this.height = 1.15;this.kind = 'bicycle';this.electric = electric;this.rental = electric ? 'ebike' : 'bike';
          this.name = electric ? 'city e-bike' : 'city bike';this.verb = 'Take the';this.cullDistance = 70;this.eye = 1.72;this.eyeZ = -.06;this.camPitch = -.1;
          this.hips = {d: {pos: V3(0, .98, .2), stance: 'cycle'}};this.crankA = 0;this.restLean = 0;this.docked = true;
          const m = model(electric ? 'ebike' : 'bike');this.group.add(m);this.parts = partsOf(m);
          this.help = `${electric ? 'City e-bike' : 'City bike'} · R2 / W pedal${electric ? ' (the motor helps up to 25 km/h)' : ''} · L2 / S brake · left stick steer · □ get off: in a dock the trip ends, elsewhere the bike is locked and the trip goes on`;
          this.settle(1);this.place();this.rested = true;
        }
        enter() {this.active = true;this.rested = false;this.docked = false;this.restLean = -.07;this.parts.hands.visible = true;audio.sfx('unlock');if (this.electric) this.motor = audio.engine('emotor');}
        ride(dt, input) {
          const v = this.speed, air = this.airborne, m = this.electric ? 100 : 95, pedal = air ? 0 : clamp(input.throttle, 0, 1);
          const human = pedal * Math.min(130, 180 / Math.max(.6, v)) * clamp((7.3 - v) / 1.1, 0, 1);
          const assist = this.electric && pedal > .05 && !this.powerOff ? Math.min(60, 250 / Math.max(.6, v)) * clamp((25 / 3.6 - v) / (2 / 3.6), 0, 1) * Math.min(1, pedal * 1.5) : 0;
          const brake = air ? 0 : input.brake * (v > .2 ? 4.5 : 0), resist = Math.abs(v) > .05 ? Math.sign(v) * (.118 + .0041 * v * v) : 0, slope = air ? 0 : 9.81 * Math.sin(this.pitch);
          const back = !air && input.brake > .5 && v < .2 && input.throttle < .1;
          this.speed = back ? Math.max(-1, Math.min(0, v) - 1.5 * dt) : clamp(v + ((human + assist) / m - brake - resist - slope) * dt, v > .2 ? 0 : -1, 16);
          if (!back && Math.abs(this.speed) < .04 && pedal < .05 && Math.abs(slope) < .4) this.speed = 0;
          this.pedalling = pedal > .05;this.steerRide(dt, input, WB_B, .45);
          if (this.motor) this.motor.set(Math.abs(this.speed) / 7, assist / 60 * .6);
        }
        // Wheels turn with the speed; the cranks only while pedalling (a freewheel), about 2.2 wheel turns a crank turn.
        animate(dt, input) {
          const p = this.parts;this.wheelSpin += this.speed * dt / BR;p.fw.rotation.x = p.rw.rotation.x = -this.wheelSpin;p.turn.rotation.y = -this.bar;
          const pedalling = input ? this.pedalling : this.speed > .5;if (pedalling && this.speed > 0) this.crankA += this.speed * dt / BR / 2.2;p.crank.rotation.x = -this.crankA;
        }
        hud() {return `${Math.round(Math.abs(this.speed) * 3.6)} km/h`;}
      }

      const bikes = [];
      for (const d of docks) for (const b of d.initial) {const q = d.slotPos[b.i], bike = new CityBike(q.w.x, q.w.z, d.yaw, b.electric);bike.home = d;bikes.push(bike);}
      const placeScooters = spots => spots.map(sp => {const p = toWorld(sp.x, sp.s), yaw = yawOf(Math.sin(sp.heading), Math.cos(sp.heading));return new Scooter(p.x, p.z, yaw, sp.look);});
      return {Scooter, CityBike, bikes, placeScooters};
    }
    return {group, docks, obstacles, keepOut, vehicles, SLOT, manager: ctx => manager({...ctx, docks, SLOT})};
  }

  // ---------- Trips: unlocking, paying, docking (the game passes in its wallet, notices and the lobby) ----------
  // ctx: {wallet, kr, notice, audio, vehicles, toLocal, docks, SLOT, lockedByOthers() -> Map(index -> name)}
  function manager(ctx) {
    const {wallet, kr, notice, docks, SLOT} = ctx;
    let trip = null;// {v, kind, t, locked, lockedT}
    const priceText = kind => {const p = PLANS[kind], seg = p.per_min_pricing[0];return `${kr(p.price)} + ${kr(seg.rate)}/min${seg.start ? ' after the first minute' : ''}`;};
    const localOf = v => ctx.toLocal(v.x, v.z);
    // The dock you are at (within 9 m of its row), with a free slot or not.
    function dockNear(v) {
      const l = localOf(v);let best = null, bd = 9;
      for (const d of docks) {const dd = Math.hypot(l.x - d.x, l.s - d.s) - (d.slots - 1) / 2 * SLOT;if (dd < bd) {bd = dd;best = d;}}
      return best;
    }
    function bikesNear(d) {return ctx.vehicles.filter(v => v.kind === 'bicycle' && Math.abs(v.x - d.centre.x) < 12 && Math.abs(v.z - d.centre.z) < 12);}
    function recount(d) {
      const list = bikesNear(d).map(v => {const l = localOf(v);return {x: l.x, s: l.s, electric: v.electric, inUse: v.active || ctx.inUse(v)};});
      d.count = dockCount(d, list, SLOT);return d.count;
    }
    let countT = 0, docksT = 0;
    const api = {
      get trip() {return trip;},
      priceText,
      // □ next to a rental: unlock / take it, or ride on with your own locked city bike.
      prompt(v, i) {
        if (trip && trip.v === v && trip.locked) return {text: `□ Unlock your ${NAMES[trip.kind].toLowerCase()} and ride on (trip ${clock(trip.t)}, ${kr(tripCost(trip.kind, trip.t))} so far)`, act: () => ctx.drive(v, false)};
        const other = ctx.lockedByOthers().get(i);if (other) return {text: `${other} has locked this ${v.name} – it is on their trip`, act: () => {}};
        const kind = v.rental, need = tripCost(kind, 0);
        if (wallet.money < need) return {text: `${NAMES[kind]} · ${priceText(kind)} – you have only ${kr(wallet.money)}`, act: () => {audio(ctx, 'locked');notice(`Not enough money: unlocking costs ${kr(need)}. Earn some with a delivery or taxi job (D-pad → / P: phone).`, 4);}};
        const what = kind === 'scooter' ? '□ Unlock the e-scooter' : `□ Take the ${v.name}${v.docked !== false && dockNear(v) ? ' from the dock' : ''}`;
        return {text: `${what} · ${priceText(kind)}`, act: () => ctx.drive(v, true)};
      },
      // Called once the seat is ours: the start fee is paid (a new trip) or the locked trip goes on.
      start(v) {
        if (trip && trip.v === v && trip.locked) {trip.locked = false;return `Your ${NAMES[trip.kind].toLowerCase()} again – the trip goes on (${clock(trip.t)}).`;}
        if (trip) api.end('switch');
        const kind = v.rental, fee = PLANS[kind].price;
        if (!wallet.pay(fee)) {notice(`Not enough money: unlocking costs ${kr(fee)}.`, 3);return null;}
        trip = {v, kind, t: 0, locked: false, lockedT: 0, from: kind === 'scooter' ? null : dockNear(v), rollOut: kind !== 'scooter' && v.docked !== false};ctx.onPaid(fee);
        const seg = PLANS[kind].per_min_pricing[0];
        return `${NAMES[kind]} unlocked: ${kr(fee)} paid, then ${kr(seg.rate)} a started minute${seg.start ? ' after the first' : ''}. ${v.help}`;
      },
      // Once you are on it: a bike taken from a dock rolls back out of its slot (its own footprint no longer blocks it then).
      rollOut(v) {
        if (!trip || trip.v !== v || !trip.rollOut) return;trip.rollOut = false;
        const f = v.forward(), p = {x: v.x - f.x * 1.5, z: v.z - f.z * 1.5};if (v.clear(p.x, p.z)) {v.x = p.x;v.z = p.z;v.settle(1);v.place();}
      },
      // □ while riding: what getting off does here.
      exitText(v) {
        if (!trip || trip.v !== v) return '□ Get off';
        if (trip.kind === 'scooter') return `□ Get off and end the ride (${kr(tripCost('scooter', trip.t))})`;
        const d = dockNear(v);if (d) {recount(d);return d.count.free.length ? `□ Return the bike to ${d.name} (${kr(tripCost(trip.kind, trip.t))})` : `${d.name} is full – □ locks the bike here, find another dock`;}
        return `□ Lock the bike here – the trip goes on (return it to a dock within ${NOT_RETURNED.afterS / 60} min)`;
      },
      // Before the seat is released: a bike at a dock with a free slot goes into the nearest free slot (the slot's place
      // and heading), so the lobby gets it there.
      beforeExit(v) {
        if (!trip || trip.v !== v || trip.kind === 'scooter') return;
        const d = dockNear(v);if (!d) return;const c = recount(d);if (!c.free.length) return;
        let best = null, bd = 1e9;for (const i of c.free) {const q = d.slotPos[i], dd = Math.hypot(q.w.x - v.x, q.w.z - v.z);if (dd < bd) {bd = dd;best = q;}}
        v.x = best.w.x;v.z = best.w.z;v.yaw = d.yaw;v.speed = 0;v.lean = v.restLean = 0;v.bar = 0;v.docked = true;v.settle(1);v.place();trip.dock = d;
      },
      // After getting off: pay for the ride (scooter, docked bike) or lock the bike (the trip goes on).
      afterExit(v) {
        if (!trip || trip.v !== v) return;
        if (trip.kind !== 'scooter' && !trip.dock) {trip.locked = true;trip.lockedT = 0;v.docked = false;v.restLean = -.07;notice(`Bike locked here. The trip goes on – return it to any dock (🚲 on the map) within ${NOT_RETURNED.afterS / 60} minutes, or pay ${kr(NOT_RETURNED.fee)} for not returning it.`, 6);return;}
        api.end(trip.dock ? 'dock' : 'scooter');
      },
      // Ends the trip and takes the money: 'scooter' / 'dock' (normal), 'late' (not returned in time), 'switch' (you took another), 'lobby'.
      end(why) {
        if (!trip) return null;
        const t = trip;trip = null;const total = tripCost(t.kind, t.t), fee = why === 'late' || (why === 'switch' && t.kind !== 'scooter' && t.locked) ? NOT_RETURNED.fee : 0;
        const due = Math.max(0, total - PLANS[t.kind].price) + fee, paid = Math.min(due, Math.max(0, wallet.money));wallet.pay(paid);ctx.onPaid(paid);
        const short = paid + 1e-6 < due ? ` (you had only ${kr(paid)}; the rest is written off)` : '';
        const what = t.kind === 'scooter' ? 'E-scooter ride' : `${NAMES[t.kind]} trip`;
        if (why === 'dock') notice(`Bike returned to ${t.dock.name}. ${what}: ${clock(t.t)}, ${kr(total)}${short}.`, 5);
        else if (why === 'late') notice(`You did not return the city bike within ${NOT_RETURNED.afterS / 60} minutes: ${kr(total)} for the trip + ${kr(NOT_RETURNED.fee)} fee${short}. The bike stays where you left it.`, 7);
        else if (why === 'switch' && fee) notice(`Your locked city bike was not returned: ${kr(total)} + ${kr(NOT_RETURNED.fee)} fee${short}.`, 6);
        else notice(`${what} ended: ${clock(t.t)}, ${kr(total)}${short}.`, 4);
        if (ctx.audio) ctx.audio.sfx('register');
        return {kind: t.kind, seconds: t.t, total, fee, paid};
      },
      // Once a frame: trip time, the locked bike's deadline, the docks' counts (a few a frame) and which totems are drawn.
      tick(dt, player) {
        if (trip) {trip.t += dt;if (trip.locked && (trip.lockedT += dt) >= NOT_RETURNED.afterS) api.end('late');}
        countT -= dt;if (countT <= 0) {countT = 1;for (const d of docks) recount(d);}
        docksT -= dt;if (docksT <= 0) {docksT = .5;for (const d of docks) {const near = Math.hypot(d.centre.x - player.x, d.centre.z - player.z) < 220;for (const m of d.meshes) m.visible = near;}}
      },
      hud(v) {
        if (!trip || trip.v !== v) return v.hud();
        return `${v.hud()} · ${NAMES[trip.kind]} ${clock(trip.t)} · ${kr(tripCost(trip.kind, trip.t))}`;
      },
      // On the map: each dock with the number of free bikes in its dot; zoomed in, its name and the split bike / e-bike.
      poi(toLocal) {void toLocal;return docks.map(d => ({x: d.x, s: d.s, color: '#1f4fa3', glyph: String(d.count.bike + d.count.ebike), label: `${d.name}: ${d.count.bike} bike${d.count.bike === 1 ? '' : 's'}, ${d.count.ebike} e-bike${d.count.ebike === 1 ? '' : 's'}`, zoomLabel: 2.5}));},
      // For the phone: the nearest dock with a free bike, and the nearest free e-scooter.
      nearestDock(p) {let best = null, bd = 1e9;for (const d of docks) {if (!(d.count.bike + d.count.ebike)) continue;const dd = Math.hypot(d.centre.x - p.x, d.centre.z - p.z);if (dd < bd) {bd = dd;best = d;}}return best ? {dock: best, dist: bd} : null;},
      nearestScooter(p) {let best = null, bd = 1e9;for (const v of ctx.vehicles) {if (v.kind !== 'scooter' || v.active || ctx.inUse(v)) continue;const dd = Math.hypot(v.x - p.x, v.z - p.z);if (dd < bd) {bd = dd;best = v;}}return best ? {v: best, dist: bd} : null;},
      // What the lobby sees: the city bike you have locked outside a dock (others cannot take it).
      locked() {return trip && trip.locked ? ctx.vehicles.indexOf(trip.v) : -1;},
      recount
    };
    return api;
  }
  function audio(ctx, n) {if (ctx.audio) ctx.audio.sfx(n);}
  return {PLANS, NOT_RETURNED, NAMES, plans, tripCost, clock, dockSlots, dockCount, scooterSpots, create, manager};
});
