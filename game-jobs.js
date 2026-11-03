/* Small jobs that earn kroner (issue #56): food delivery and taxi, started and stopped from a phone-style menu (D-pad → / P)
 * or at the job signs beside Joker and Kiwi.
 * Delivery: pick up a food order at a real café, restaurant or takeaway near Torshov (OpenStreetMap, jobs-data.js) or at
 *   Joker / Kiwi, and bring it to a real street door (an OpenStreetMap address point, the door on its street side) before
 *   the time runs out – on foot, running, on a motorcycle, a bike, a scooter or in a car. The waypoint and the minimap show
 *   where to go. A fast delivery pays more; a late one much less. Orders keep coming until you stop the shift.
 * Taxi: in a car (as the driver) turn on "taxi". A passenger waits on the pavement; stop beside them and they get in the
 *   back seat and ask for a street address in the neighbourhood. Smooth and fast driving gives a tip; crashes, harsh
 *   braking and swerving, wrong turns and drunk driving make them angry and the tip smaller (or none).
 * With friends online: others see your taxi's roof light and your passenger; a friend riding with you (passenger seat,
 *   pillion) sees the job, follows the same waypoint and gets half of each payment as their share.
 * Pure parts (Node-tested): deliveryTerms(m), deliveryPay(terms, s), taxiFare(m), expectedTaxiS(m), Mood, WrongWay, orderFor.
 * GameJobs.create({T, lib, scene, data, toWorld, toLocal, heightAt, avatars, audio, notice, earn, map, root}) -> {group, hitboxes,
 *   addSign(x, z, yaw), phone, shift, startDelivery(p), startTaxi(car, i), stop(why), prompt(player), tick(dt, ctx),
 *   remoteTick(remotes, vehicles), localState(), hud}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameJobs = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const ROAD = 1.3;// streets are about 1.3 x longer than the straight line
  // ---------- Delivery: time and pay from the straight-line distance (metres) ----------
  // Time: walking/running speed along the streets plus 45 s at the door. Pay: 35 kr + 7 kr per 100 m.
  function deliveryTerms(m) {return {dist: m, limit: Math.round(45 + m * ROAD / 3.2), pay: Math.round(35 + m * .07)};}
  // On time: the pay plus up to 50 % for being fast; late: 40 % (the food is cold).
  function deliveryPay(terms, s) {
    if (s > terms.limit) return {kr: Math.round(terms.pay * .4), late: true, bonus: 0};
    const bonus = Math.round(terms.pay * .5 * (1 - s / terms.limit));return {kr: terms.pay + bonus, late: false, bonus};
  }
  // ---------- Taxi: an Oslo-like fare (start + per km along the streets) and the time a decent driver needs ----------
  const taxiFare = m => Math.round(65 + 20 * m * ROAD / 1000);
  const expectedTaxiS = m => Math.round(25 + m * ROAD / 8.5);// about 30 km/h on average through town
  // The passenger's mood, 0–100: crashes, harsh driving, wrong turns and drunk driving lower it; calm driving brings a little back.
  class Mood {
    constructor(start = 80) {this.v = start;this.start = start;this.cool = 0;this.drunkSaid = false;this.events = [];}
    say(text, t = 6) {if (this.cool > 0 && !/^!/.test(text)) return;this.cool = t;this.events.push(text.replace(/^!/, ''));}
    hit(impact) {this.v = Math.max(0, this.v - Math.min(35, 10 + impact * 3));this.say('!Au! Kan du ikke se deg for?! (Ouch! Watch where you are going!)', 4);}
    landing(impact) {if (impact > 3) {this.v = Math.max(0, this.v - Math.min(30, impact * 4));this.say('!Oi! Vi er ikke på tivoli! (Whoa! This is not a fairground ride!)', 4);}}
    wrongWay() {this.v = Math.max(0, this.v - 12);this.say('!Er ikke dette feil vei? (Isn\'t this the wrong way?)', 4);}
    // a: forward acceleration, lat: sideways acceleration (m/s²), drunk 0–1, dt seconds.
    tick(dt, {a = 0, lat = 0, drunk = 0}) {
      this.cool = Math.max(0, this.cool - dt);
      const harsh = Math.max(0, Math.abs(a) - 4.5) + Math.max(0, Math.abs(lat) - 4.5);
      if (harsh > 0) {this.v -= harsh * 6 * dt;if (harsh > 1) this.say(a < -4.5 ? 'Rolig med bremsen! (Easy on the brakes!)' : lat ? 'Ta det rolig i svingene! (Slow down in the corners!)' : 'Rolig! (Easy!)');}
      if (drunk > 0) {if (!this.drunkSaid && drunk > .15) {this.drunkSaid = true;this.v -= 20;this.say('!Har du drukket?! (Have you been drinking?!)', 5);}this.v -= 2 * drunk * dt;}
      else if (!harsh && this.v < this.start) this.v = Math.min(this.start, this.v + .6 * dt);
      this.v = Math.max(0, Math.min(100, this.v));
    }
    // The tip: a share of the fare from the mood, scaled by how fast the trip was compared with a decent driver.
    tip(fare, seconds, expected) {
      const rate = this.v >= 85 ? .25 : this.v >= 65 ? .15 : this.v >= 40 ? .07 : 0, fast = Math.max(.5, Math.min(1.6, expected / Math.max(1, seconds)));
      return Math.round(fare * rate * fast);
    }
    get face() {return this.v >= 85 ? '😄' : this.v >= 65 ? '🙂' : this.v >= 40 ? '😐' : this.v >= 20 ? '😠' : '🤬';}
  }
  // Wrong turns: driving more than 45 m further from the destination than you have been (for 3 s) counts once.
  class WrongWay {
    constructor() {this.best = Infinity;this.t = 0;}
    tick(dt, d) {if (d < this.best) {this.best = d;this.t = 0;return false;}if (d > this.best + 45) {if ((this.t += dt) > 3) {this.best = d;this.t = 0;return true;}} else this.t = Math.max(0, this.t - dt);return false;}
  }
  // A food order that fits the place.
  const ORDERS = [[/pizza/i, ['2 × pizza Margherita', 'pizza Pepperoni', 'family pizza and garlic bread']], [/sushi/i, ['sushi box (16 pieces)', 'maki and nigiri platter']], [/thai/i, ['pad thai', 'green curry with rice']],
    [/kebab/i, ['kebab in pita', 'kebab plate']], [/indian/i, ['butter chicken and naan', 'lamb curry']], [/mexican|tacos/i, ['tacos (3)', 'burrito bowl']], [/chinese|wok/i, ['wok with chicken', 'spring rolls and fried rice']],
    [/italian/i, ['lasagne', 'pasta carbonara']], [/coffee|café|cafe|bakeri|baker|kaffe/i, ['2 × cappuccino and cinnamon buns', 'flat white and a sandwich', 'latte and a croissant']]];
  const SHOP_ORDERS = ['a bag of groceries', 'milk, bread and Kvikk Lunsj', 'Grandiosa and two Solo', 'coffee and bananas'];
  function orderFor(p, rnd = Math.random) {
    if (p.shop) return SHOP_ORDERS[Math.floor(rnd() * SHOP_ORDERS.length)];
    const hay = `${p.name} ${p.cuisine || ''}`;for (const [re, list] of ORDERS) if (re.test(hay)) return list[Math.floor(rnd() * list.length)];
    return p.kind === 'café' ? 'coffee and cake' : 'dinner for two';
  }
  const NPC_NAMES = ['Ingrid', 'Ola', 'Kari', 'Ahmed', 'Mette', 'Lars', 'Sofie', 'Jonas', 'Fatima', 'Erik', 'Nora', 'Henrik', 'Amina', 'Magnus', 'Sara', 'Tor'];
  const NPC_SHIRTS = [0x6d4c41, 0x37474f, 0x8e2430, 0x2e5d4b, 0x4a5a8c, 0xa0703a, 0x5b3e7a, 0x2b2b2b];
  const clock = s => `${s < 0 ? '−' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`;

  function create({T, lib, scene, data, toWorld, toLocal, heightAt, avatars, audio, notice, earn, map, root}) {
    const group = new T.Group(), hitboxes = [], doors = data.doors.map(d => ({...d, w: toWorld(d.x, d.s), b: toWorld(d.bx, d.bs), c: toWorld(d.cx, d.cs)}));
    const pickups = data.pickups.map(p => ({...p, w: toWorld(p.x, p.s), b: toWorld(p.bx, p.bs)}));
    const o0 = toWorld(0, 0), yawOfLocal = f => {const p = toWorld(Math.sin(f), Math.cos(f));return Math.atan2(-(p.x - o0.x), -(p.z - o0.z));};
    let rnd = Math.random;
    // ---------- Markers: a glowing ring on the target, a street door for deliveries, the roof light for taxis ----------
    const ringMat = new T.MeshBasicMaterial({color: 0xffc23d, transparent: true, opacity: .75, depthWrite: false});
    const ring = new T.Mesh(new T.RingGeometry(1.0, 1.25, 40), ringMat);ring.rotation.x = -Math.PI / 2;ring.visible = false;ring.renderOrder = 2;group.add(ring);
    const beam = new T.Mesh(new T.CylinderGeometry(.06, .06, 6, 8, 1, true), new T.MeshBasicMaterial({color: 0xffc23d, transparent: true, opacity: .35, depthWrite: false}));beam.visible = false;group.add(beam);
    // The street door: a dark wooden door with a frame and a house-number plate, set 8 cm out from the wall (no coplanar faces).
    const door = new T.Group();door.visible = false;group.add(door);
    {const wood = lib.paint(0x4a2f22, .6), frame = lib.paint(0xe6e2da, .5), brass = lib.metal(0xb8963e, .3);
      const add = (geo, m, x, y, z) => {const o = new T.Mesh(geo, m);o.position.set(x, y, z);o.castShadow = true;door.add(o);return o;};
      add(new T.BoxGeometry(1.24, 2.34, .1), frame, 0, 1.17, -.02);add(new T.BoxGeometry(1.04, 2.16, .08), wood, 0, 1.1, .03);
      add(new T.BoxGeometry(.04, .2, .05), brass, .38, 1.05, .09);for (const y of [.62, 1.62]) add(new T.BoxGeometry(.8, .5, .02), lib.paint(0x3d271c, .6), 0, y, .075);
      const plateTex = document.createElement('canvas');plateTex.width = 256;plateTex.height = 96;door.userData.plate = plateTex;
      const pt = new T.CanvasTexture(plateTex);pt.colorSpace = T.SRGBColorSpace;door.userData.tex = pt;add(new T.PlaneGeometry(.62, .23), new T.MeshBasicMaterial({map: pt}), 0, 2.48, .03);}
    function showDoor(d) {
      const y = heightAt(d.b.x, d.b.z), yaw = yawOfLocal(d.f) + Math.PI;// the door faces out of the building, toward the street
      door.position.set(d.b.x, y, d.b.z);door.rotation.set(0, yaw, 0);door.visible = true;
      // The wall is at the door's back: 10 cm out from it, so no face lies in the wall's plane.
      door.translateZ(.1);
      const c = door.userData.plate, g = c.getContext('2d');g.fillStyle = '#1d3b6b';g.fillRect(0, 0, 256, 96);g.fillStyle = '#fff';g.font = 'bold 40px system-ui, Arial';g.textAlign = 'center';g.textBaseline = 'middle';
      const num = d.a.split(' ').pop();g.fillText(num, 128, 50);door.userData.tex.needsUpdate = true;
    }
    function showRing(w) {const y = heightAt(w.x, w.z) + .04;ring.position.set(w.x, y, w.z);beam.position.set(w.x, y + 3, w.z);ring.visible = beam.visible = true;}
    function hideMarks() {ring.visible = beam.visible = door.visible = false;}
    // Taxi roof light: one per car that shows it (yours, or another player's taxi).
    const signMat = (() => {const c = document.createElement('canvas');c.width = 256;c.height = 64;const g = c.getContext('2d');g.fillStyle = '#ffd21f';g.fillRect(0, 0, 256, 64);g.fillStyle = '#111';g.font = 'bold 46px system-ui, Arial';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('TAXI', 128, 34);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return t;})();
    const litMat = new T.MeshStandardMaterial({map: signMat, emissive: 0xffe066, emissiveMap: signMat, emissiveIntensity: .9, roughness: .4}), offMat = new T.MeshStandardMaterial({map: signMat, roughness: .5, color: 0x8a8a80});
    const sideMat = new T.MeshStandardMaterial({color: 0x222222, roughness: .5});
    function roofSign(car) {
      if (!car.taxiSign) {const m = new T.Mesh(new T.BoxGeometry(.5, .16, .2), [sideMat, sideMat, sideMat, sideMat, litMat, litMat]);m.position.set(0, 1.53, .55);m.castShadow = true;car.group.add(m);car.taxiSign = m;}
      return car.taxiSign;
    }
    function setSign(car, state) {if (!state && !car.taxiSign) return;const m = roofSign(car);m.visible = !!state;const mat = state === 1 ? litMat : offMat;m.material[4] = m.material[5] = mat;}
    // ---------- Job signs (□ opens the phone) ----------
    function addSign(x, z, yaw) {
      const g = new T.Group(), y = heightAt(x, z);g.position.set(x, y, z);g.rotation.y = yaw;group.add(g);
      const c = document.createElement('canvas');c.width = 256;c.height = 320;const k = c.getContext('2d');
      k.fillStyle = '#0f2a44';k.fillRect(0, 0, 256, 320);k.fillStyle = '#ffc23d';k.fillRect(0, 0, 256, 70);k.fillStyle = '#0f2a44';k.font = 'bold 44px system-ui, Arial';k.textAlign = 'center';k.fillText('JOBB', 128, 52);
      k.fillStyle = '#fff';k.font = 'bold 30px system-ui, Arial';k.fillText('🛵 Matlevering', 128, 130);k.fillText('🚕 Taxi', 128, 180);k.font = '22px system-ui, Arial';k.fillText('Bud & sjåfør søkes', 128, 236);k.fillText('□ for å starte', 128, 280);
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;const face = new T.MeshStandardMaterial({map: t, roughness: .5}), post = lib.metal(0x3a3f45, .45);
      const board = new T.Mesh(new T.BoxGeometry(.8, 1, .05), [post, post, post, post, face, face]);board.position.y = 1.6;board.castShadow = true;g.add(board);
      for (const s of [-1, 1]) {const p = new T.Mesh(new T.CylinderGeometry(.03, .03, 2.1, 8), post);p.position.set(s * .36, 1.05, 0);p.castShadow = true;g.add(p);}
      const hit = new T.Mesh(new T.BoxGeometry(1, 2.2, .5), new T.MeshBasicMaterial({visible: false}));hit.position.y = 1.1;hit.userData.jobSign = true;g.add(hit);hitboxes.push(hit);
      g.updateMatrixWorld(true);return {x, z};
    }
    // ---------- The phone (D-pad → / P, or □ at a job sign) ----------
    const phoneEl = document.createElement('div');phoneEl.id = 'phone';phoneEl.hidden = true;root.append(phoneEl);
    const phone = {open: false, sel: 0, stick: false, items: () => [], title: () => ''};
    phone.show = (items, title) => {phone.items = items;phone.title = title;phone.open = true;phone.sel = 0;phone.render();if (audio) audio.sfx('click');};
    phone.close = () => {phone.open = false;phoneEl.hidden = true;};
    phone.render = () => {
      phoneEl.hidden = !phone.open;if (!phone.open) return;const items = phone.items();phone.sel = Math.max(0, Math.min(phone.sel, items.length - 1));
      const now = new Date(), hh = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      phoneEl.innerHTML = `<div class="ph-bar"><span>${hh}</span><span>▮▮▮ 4G</span></div><b>${phone.title()}</b>` + items.map((it, i) => `<div class="${i === phone.sel ? 'sel' : ''}${it.off ? ' off' : ''}">${it.text}${it.sub ? `<small>${it.sub}</small>` : ''}</div>`).join('') + '<small class="ph-keys">↑↓ choose · ✕ / Space select · ○ / C close</small>';
    };
    phone.input = input => {
      const y = input.move.y, items = phone.items();
      if (input.pressed.has('up') || (y < -.5 && !phone.stick)) phone.sel = Math.max(0, phone.sel - 1);
      if (input.pressed.has('down') || (y > .5 && !phone.stick)) phone.sel = Math.min(items.length - 1, phone.sel + 1);
      phone.stick = Math.abs(y) > .5;
      if (input.pressed.has('cross') && items[phone.sel] && !items[phone.sel].off) {const it = items[phone.sel];if (it.keep) it.act();else {phone.close();it.act();}}
      else if (input.pressed.has('circle') || input.pressed.has('right') || input.pressed.has('phone')) phone.close();
      phone.render();input.move.x = input.move.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle', 'right', 'left', 'phone'].forEach(b => input.pressed.delete(b));
    };

    // ---------- Shifts ----------
    let shift = null;// {kind: 'delivery' | 'taxi', n, total, order | fare, car, carIndex, wait}
    const pickupsAll = () => [...pickups, ...extraPickups];
    const extraPickups = [];// Joker and Kiwi (added by the game: their doors)
    const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    function pick(list, from, lo, hi) {
      const ok = list.filter(d => {const m = near(d.w, from);return m >= lo && m <= hi;});
      if (ok.length) return ok[Math.floor(rnd() * ok.length)];
      return list.slice().sort((a, b) => Math.abs(near(a.w, from) - (lo + hi) / 2) - Math.abs(near(b.w, from) - (lo + hi) / 2))[0];
    }
    const waypointTo = w => {const l = toLocal(w.x, w.z);map.waypoint = {x: l.x, s: l.s};shift.wp = map.waypoint;};
    const clearOurWaypoint = () => {if (shift && shift.wp && map.waypoint === shift.wp) map.waypoint = null;};
    function startDelivery(p) {
      if (shift) stop('switch');
      shift = {kind: 'delivery', n: 0, total: 0, order: null, wait: 0};newOrder(p);
    }
    function newOrder(p) {
      const pu = pick(pickupsAll(), p, 40, 450);
      shift.order = {stage: 'pickup', pickup: pu, item: orderFor(pu, rnd), t: 0};
      waypointTo(pu.w);showRing(pu.w);door.visible = false;audio.sfx('beep');
      notice(`🛵 New order: ${shift.order.item} from ${pu.name}. Pick it up – the waypoint shows the way.`, 6);
    }
    function pickUp() {
      const o = shift.order, d = pick(doors, o.pickup.w, 160, 620), m = near(d.w, o.pickup.w);
      Object.assign(o, {stage: 'deliver', door: d, terms: deliveryTerms(m), t: 0});
      waypointTo(d.w);showRing(d.w);showDoor(d);audio.sfx('click');
      notice(`Order picked up: ${o.item}. Deliver it to ${d.a} within ${clock(o.terms.limit)} (${Math.round(m)} m as the crow flies).`, 6);
    }
    function handOver() {
      const o = shift.order, r = deliveryPay(o.terms, o.t);
      shift.n++;shift.total += r.kr;shift.last = r.kr;earn(r.kr, r.late ? `Delivered to ${o.door.a} – late, the food is cold` : `Delivered to ${o.door.a} in ${clock(o.t)}${r.bonus ? ` (+${r.bonus} kr for speed)` : ''}`);
      shift.order = {stage: 'wait', t: 0};hideMarks();clearOurWaypoint();
    }
    function startTaxi(car, index) {
      if (shift) stop('switch');
      shift = {kind: 'taxi', n: 0, total: 0, car, carIndex: index, fare: {stage: 'wait', t: 2}};setSign(car, 1);
      car.onHit = impact => {const f = shift && shift.kind === 'taxi' && shift.fare;if (f && f.stage === 'ride' && impact > 1.5) f.mood.hit(impact);};
      car.onLand = impact => {const f = shift && shift.kind === 'taxi' && shift.fare;if (f && f.stage === 'ride') f.mood.landing(impact);};
      notice('🚕 Taxi on – the roof light is lit. Wait for a call (the waypoint shows the passenger). Phone (D-pad → / P) to stop.', 6);
    }
    function npc(nameSeed) {
      const name = NPC_NAMES[nameSeed % NPC_NAMES.length], av = avatars.avatar(nameSeed % 12, `🚕 ${name}`, NPC_SHIRTS[nameSeed % NPC_SHIRTS.length]);
      scene.add(av.group);return {name, av, seed: nameSeed};
    }
    const dropNpc = n => {if (n) {scene.remove(n.av.group);n.av.dispose();}};
    function newFare(car) {
      const d = pick(doors, {x: car.x, z: car.z}, 90, 320), seed = Math.floor(rnd() * 1e6), who = npc(seed), stand = kerb(d);
      who.av.group.position.set(stand.x, heightAt(stand.x, stand.z), stand.z);who.av.group.rotation.y = Math.atan2(-(d.c.x - stand.x), -(d.c.z - stand.z));
      shift.fare = {stage: 'waiting', at: d, stand, who, t: 0};waypointTo(d.c);showRing(d.c);audio.sfx('beep');
      notice(`🚕 Taxi call: ${who.name} is waiting outside ${d.a}. Stop beside them.`, 6);
    }
    // Where a passenger waits: on the pavement in front of their door, at most 4.5 m from where the car stops (some
    // buildings stand 20 m back from the street).
    function kerb(d) {const dx = d.w.x - d.c.x, dz = d.w.z - d.c.z, L = Math.hypot(dx, dz) || 1, k = Math.min(L, 4.5) / L;return {x: d.c.x + dx * k, z: d.c.z + dz * k};}
    function stop(why) {
      if (!shift) return;const s = shift;let first = why === 'left' ? 'You left the taxi. ' : '';
      if (s.kind === 'taxi') {
        const f = s.fare;if (f && f.who) {if (f.stage === 'ride' || f.stage === 'boarding') first += `${f.who.name} gets out without paying. `;dropNpc(f.who);}
        setSign(s.car, 0);s.car.onHit = null;s.car.onLand = null;
      }
      clearOurWaypoint();hideMarks();shift = null;
      const what = s.kind === 'taxi' ? `🚕 Taxi off: ${s.n} fare${s.n === 1 ? '' : 's'}` : `🛵 Delivery shift over: ${s.n} deliver${s.n === 1 ? 'y' : 'ies'}`;
      if (why === 'phone' || why === 'left') notice(`${first}${what}, ${Math.round(s.total)} kr.`, 5);
    }
    // □ near the pickup or the door (on foot), and at the job signs.
    function prompt(player, lookObj) {
      if (lookObj && lookObj.userData.jobSign) return {text: '□ Jobs: delivery and taxi', act: () => phone.open || openPhone()};
      if (!shift || shift.kind !== 'delivery' || player.mode !== 'foot') return null;
      const o = shift.order, p = {x: player.x, z: player.z};
      if (o.stage === 'pickup' && near(o.pickup.w, p) < 3.2) return {text: `□ Pick up the order: ${o.item}`, act: () => pickUp()};
      if (o.stage === 'deliver' && near(o.door.w, p) < 2.6) return {text: `□ Hand over the order${o.t > o.terms.limit ? ' (late)' : ''}`, act: () => handOver()};
      return null;
    }
    let openPhone = () => {};
    // ---------- Once a frame ----------
    // ctx: {player, drunk 0–1, camera}
    let last = null;
    // The job's waypoint comes back when you have left it behind (it is removed within 7 m).
    function keepWaypoint(w, player) {if (!map.waypoint && Math.hypot(w.x - player.x, w.z - player.z) > 25) waypointTo(w);}
    function tick(dt, {player, drunk, camera}) {
      if (!shift) return;
      if (shift.kind === 'delivery') {
        const o = shift.order;o.t += dt;
        if (o.stage === 'wait' && o.t > 2.5) newOrder(player);
        if (o.stage === 'deliver' && o.t > o.terms.limit && !o.lateSaid) {o.lateSaid = true;notice('⏰ The time is up – deliver it anyway, but the pay is smaller now.', 4);}
        ringMat.color.setHex(o.stage === 'deliver' && o.t > o.terms.limit ? 0xff6b4a : 0xffc23d);
        if (o.stage === 'pickup') keepWaypoint(o.pickup.w, player);else if (o.stage === 'deliver') keepWaypoint(o.door.w, player);
        return;
      }
      // Taxi: the shift ends when you leave the car's driver seat.
      const car = shift.car, f = shift.fare;
      if (player.mode !== 'vehicle' || player.vehicle !== car) {stop('left');return;}
      f.t += dt;if (f.who) f.who.av.update(dt, camera, true);
      if (f.stage === 'wait') {if (f.t > 3.5) newFare(car);return;}
      const carPos = {x: car.x, z: car.z}, stopped = Math.abs(car.speed) < 1;
      if (f.stage === 'waiting') {
        f.who.av.pose({stance: 'stand', speed: 0, dt});keepWaypoint(f.at.c, player);
        if (near(f.stand, carPos) < 9 && stopped) {f.stage = 'boarding';f.t = 0;f.from = f.who.av.group.position.clone();hideMarks();clearOurWaypoint();f.who.av.say('Hei!');}
        return;
      }
      car.group.updateMatrixWorld(true);
      const seatAt = () => car.group.localToWorld(new T.Vector3(.37, .56, 1.05)), doorAt = () => car.group.localToWorld(new T.Vector3(1.25, 0, 1.0));
      if (f.stage === 'boarding') {
        if (!stopped) {f.t = 0;return;}// they only get in while the car stands still
        const g = f.who.av.group, k = Math.min(1, f.t / 1.8), d = doorAt();g.position.lerpVectors(f.from, d, k);g.position.y = heightAt(g.position.x, g.position.z);
        g.rotation.y = Math.atan2(-(d.x - f.from.x), -(d.z - f.from.z));f.who.av.pose({stance: 'stand', speed: k < 1 ? 1.4 : 0, dt});
        if (f.t > 2.2) {
          const dest = pick(doors, f.at.w, 320, 1000), m = near(dest.w, f.at.w);audio.sfx('carDoor');
          Object.assign(f, {stage: 'ride', t: 0, dest, fare: taxiFare(m), expected: expectedTaxiS(m), mood: new Mood(drunk > .15 ? 70 : 82), wrong: new WrongWay()});
          setSign(car, 2);waypointTo(dest.c);showRing(dest.c);last = null;
          f.who.av.say(`Til ${dest.a}, takk!`);notice(`${f.who.name}: "Til ${dest.a}, takk!" (To ${dest.a}, please.) Fare ${f.fare} kr – smooth and fast driving gives a tip.`, 6);
        }
        return;
      }
      if (f.stage === 'ride') {
        const g = f.who.av.group;g.position.copy(seatAt());g.quaternion.copy(car.group.getWorldQuaternion(new T.Quaternion()));f.who.av.pose({stance: 'sit', dt});
        // Forward and sideways acceleration from the car's speed and turning.
        if (last && dt > 0) {const a = (car.speed - last.v) / dt, yr = Math.atan2(Math.sin(car.yaw - last.yaw), Math.cos(car.yaw - last.yaw)) / dt;f.acc = (f.acc || 0) + (a - (f.acc || 0)) * Math.min(1, dt * 6);f.lat = (f.lat || 0) + (car.speed * yr - (f.lat || 0)) * Math.min(1, dt * 6);}
        last = {v: car.speed, yaw: car.yaw};
        f.mood.tick(dt, {a: f.acc || 0, lat: f.lat || 0, drunk});keepWaypoint(f.dest.c, player);
        if (f.wrong.tick(dt, near(f.dest.c, carPos))) f.mood.wrongWay();
        for (const e of f.mood.events.splice(0)) {f.who.av.say(e.replace(/ \(.*\)$/, ''));notice(`${f.who.name} ${f.mood.face}: ${e}`, 3.5);}
        if (near(f.dest.c, carPos) < 12 && stopped) {
          const tip = f.mood.tip(f.fare, f.t, f.expected), total = f.fare + tip;shift.n++;shift.total += total;shift.last = total;
          earn(total, `Taxi to ${f.dest.a}: ${f.fare} kr${tip ? ` + ${tip} kr tip ${f.mood.face}` : ` – no tip ${f.mood.face}`}`);
          f.who.av.say(tip ? 'Takk for turen!' : 'Hmf.');audio.sfx('carDoor');
          Object.assign(f, {stage: 'alight', t: 0, from: doorAt()});hideMarks();clearOurWaypoint();setSign(car, 1);
        }
        return;
      }
      if (f.stage === 'alight') {
        // They walk to their door at 1.4 m/s and go in (gone after 6 s at most).
        const g = f.who.av.group, to = f.dest.w, L = Math.hypot(to.x - f.from.x, to.z - f.from.z) || 1, k = Math.min(1, f.t * 1.4 / L);g.position.lerpVectors(f.from, new T.Vector3(to.x, 0, to.z), k);g.position.y = heightAt(g.position.x, g.position.z);
        g.quaternion.setFromEuler(new T.Euler(0, Math.atan2(-(to.x - f.from.x), -(to.z - f.from.z)), 0));f.who.av.pose({stance: 'stand', speed: k < 1 ? 1.4 : 0, dt});
        if (k >= 1 || f.t > 6) {dropNpc(f.who);shift.fare = {stage: 'wait', t: 0};}
      }
    }
    // ---------- Other players' taxis: the roof light and their passenger (from their state: tx 1 = free, 2 = passenger) ----------
    const remoteTaxi = new Map();// remote id -> {car, who}
    function remoteTick(remotes, vehicles, dt, camera) {
      for (const [id, rt] of remoteTaxi) {const r = remotes.get(id), st = r && r.st, car = st && st.tx && st.v >= 0 ? vehicles[st.v] : null;if (car === rt.car && st.tx === 2 === !!rt.who) continue;setSign(rt.car, 0);dropNpc(rt.who);remoteTaxi.delete(id);}
      for (const r of remotes.values()) {
        const st = r.st;if (!st || !st.tx || !(st.v >= 0) || st.s !== 'd') continue;const car = vehicles[st.v];if (!car) continue;
        let rt = remoteTaxi.get(r.id);if (!rt) {rt = {car, who: st.tx === 2 ? npc(st.tn || 0) : null};remoteTaxi.set(r.id, rt);}
        setSign(car, st.tx === 2 ? 2 : 1);
        if (rt.who) {car.group.updateMatrixWorld(true);const g = rt.who.av.group;g.position.copy(car.group.localToWorld(new T.Vector3(.37, .56, 1.05)));g.quaternion.copy(car.group.getWorldQuaternion(new T.Quaternion()));rt.who.av.pose({stance: 'sit', dt});rt.who.av.update(dt, camera, true);}
      }
    }
    // What the lobby sees of our job (a friend riding with us follows it and gets a share; tx/tn: the taxi light and passenger).
    function localState() {
      if (!shift) return null;const s = {jb: {k: shift.kind, n: shift.n, kr: Math.round(shift.last || 0), t: hudLine(true)}};
      const w = shift.wp && map.waypoint === shift.wp ? toWorld(shift.wp.x, shift.wp.s) : null;if (w) s.jb.to = [Math.round(w.x * 10) / 10, Math.round(w.z * 10) / 10];
      if (shift.kind === 'taxi') {s.tx = shift.fare && (shift.fare.stage === 'ride' || shift.fare.stage === 'boarding') ? 2 : 1;if (s.tx === 2) s.tn = shift.fare.who.seed;}
      return s;
    }
    // The job card (top left).
    function hudLine(short) {
      if (!shift) return '';
      if (shift.kind === 'delivery') {
        const o = shift.order;if (o.stage === 'pickup') return `Pick up ${o.item} at ${o.pickup.name}`;
        if (o.stage === 'deliver') {const left = o.terms.limit - o.t;return `Deliver to ${o.door.a} · ${left >= 0 ? `${clock(left)} left` : `late ${clock(-left)}`}`;}
        return short ? 'Waiting for the next order' : 'Waiting for the next order…';
      }
      const f = shift.fare;if (!f || f.stage === 'wait') return 'Taxi free – waiting for a call';
      if (f.stage === 'waiting') return `Pick up ${f.who.name} at ${f.at.a}`;if (f.stage === 'boarding') return `${f.who.name} is getting in`;
      if (f.stage === 'ride') return `${f.who.name} ${f.mood.face} to ${f.dest.a} · ${f.fare} kr · ${clock(f.t)}`;return `${f.who.name} is getting out`;
    }
    function hud() {
      if (!shift) return null;const o = shift.kind === 'delivery' ? shift.order : shift.fare;
      const late = shift.kind === 'delivery' && o.stage === 'deliver' && o.t > o.terms.limit;
      return {title: shift.kind === 'taxi' ? `🚕 Taxi · ${shift.n} fare${shift.n === 1 ? '' : 's'} · ${Math.round(shift.total)} kr` : `🛵 Delivery · ${shift.n} delivered · ${Math.round(shift.total)} kr`, line: hudLine(false), late,
        mood: shift.kind === 'taxi' && o.stage === 'ride' ? Math.round(o.mood.v) : null};
    }
    return {group, hitboxes, addSign, phone, set openPhone(f) {openPhone = f;}, get shift() {return shift;}, startDelivery, startTaxi, stop, prompt, tick, remoteTick, localState, hud,
      addPickup: p => extraPickups.push({...p, w: toWorld(p.x, p.s)}), doors, pickups: pickupsAll, set random(f) {rnd = f;}, debug: {pickUp, handOver, newFare: () => shift && shift.kind === 'taxi' && newFare(shift.car)}};
  }
  return {create, deliveryTerms, deliveryPay, taxiFare, expectedTaxiS, Mood, WrongWay, orderFor, ORDERS, ROAD};
});
