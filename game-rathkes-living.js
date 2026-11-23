/* Rathkes gate 1C, flat 501 – the living room you can use (issue #116): the record player, the sofa and the TV, the chairs and
 * the lava lamp. The user: "Make it possible to put on music on the lp player in rathkes gate. also allow to sit in the sofa
 * and watch tv. fix the chair in the living room, allow to move the chairs around. Make it possible to turn on the lava lamp in
 * the living room shelf."
 *
 * - LP player (on the teak wall unit): □ puts a record on – the arm swings in, the needle lands with a crackle, then the music
 *   (game-music.js records lp1–lp4) plays from the player's place in the room; □ again: the next record, after the last: stop.
 * - Sofa: □ sits you down facing the TV (three seats); there □ is the TV's button and ✕ stands you up.
 * - TV: □ on – four channels – off; a moving picture (canvas texture), a quiet sound to match and a glow on the room.
 * - Chairs (the six dining chairs, the leather sling chair, the folding chair in the navy bedroom): tap □ picks one up and you
 *   carry it in front of you, □ puts it down there, turned the way you face (not through walls, furniture, other chairs or a
 *   doorway); hold □ sits on it.
 * - Lava lamp (on the shelf above the record player): □ on / off; it warms up, wax blobs rise and sink, a warm light.
 * Everything is shared online through the lobby's small object store ('obj' messages: id -> value, kept for players who join
 * later while the lobby lives; not saved between sessions).
 *
 * Pure (Node-tested): RECORDS, CHANNELS, cycle, nextRecord, recordPos, armAt, nextChannel, lavaWarm, CHAIRS, chairParts(kind),
 *   chairBoxes(kind), boxesToWing(boxes, a, b, yaw), overlap(p, q), chairsOf(data), doorZones(data), canPlace(...), putPose(...),
 *   seatsOf(data), hearing(at, dist), duckFor(lp, tv), snapYaw(yaw), items(data).
 * Browser: create({T, lib, flat, data}) -> {hitboxes, attach(game), prompt(look, player), tick(dt, input), dynamic(), apply(id, v),
 *   reset(), state, chairs, carrying}
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameRathkesLiving = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const F501 = () => (typeof window !== 'undefined' && window.GameRathkes501) || (typeof module === 'object' && require('./game-rathkes-501.js'));

  // ---------- Records, channels and the timings that every player computes the same way ----------
  const RECORDS = [
    {track: 'lp1', title: 'Søndagsjazz', artist: 'Trio Herslebs', style: 'jazz trio', label: '#d8b04a', sleeve: '#26324a'},
    {track: 'lp2', title: 'Bossa på Løkka', artist: 'Akerselva Kvartett', style: 'bossa nova', label: '#3f8f6a', sleeve: '#e9dcc0'},
    {track: 'lp3', title: 'Lavalampe', artist: 'Disko Herslebs', style: 'soul and disco', label: '#d0405e', sleeve: '#f0a020'},
    {track: 'lp4', title: 'Fjellvise', artist: 'Rathkes Spellemenn', style: 'folk waltz', label: '#3a6aa8', sleeve: '#c8d8c0'}];
  const CHANNELS = [
    {id: 'news', name: 'Løkka-TV Nyheter', light: 0x86a2ff},
    {id: 'football', name: 'Fotball: Løkka – Torshov', light: 0x9fe6a6},
    {id: 'nature', name: 'Naturfilm: Fjellet', light: 0xffd2a0},
    {id: 'weather', name: 'Været i Oslo', light: 0x8fc8ff}];
  // Putting a record on: the arm swings in for ARM_S seconds, the needle lands, the music starts LEAD_S after the press.
  const ARM_S = 1.0, LEAD_S = 2.4, RPM = 100 / 3;
  // off (-1 or nothing) -> 0 -> 1 -> ... -> n - 1 -> off
  const cycle = (i, n) => i == null || i < 0 ? 0 : i + 1 >= n ? -1 : i + 1;
  const nextRecord = (s, now) => ({r: cycle(s && s.r, RECORDS.length), t: now});
  // Seconds into the record's music at `now` (ms, the lobby's clock); negative before it starts; null when nothing plays.
  const recordPos = (s, now) => s && s.r >= 0 ? (now - s.t) / 1000 - LEAD_S : null;
  // Where the tonearm is: 0 on its rest, 1 on the record (it swings over ARM_S seconds both ways).
  // A record changed for the next one keeps the arm on the record (swap); a stop swings it back to its rest.
  function armAt(s, now) {
    if (!s) return 0;
    const k = Math.max(0, Math.min(1, (now - s.t) / 1000 / ARM_S)), e = k * k * (3 - 2 * k);
    return s.r >= 0 ? (s.swap ? 1 : e) : (s.was >= 0 ? 1 - e : 0);
  }
  const nextChannel = (s, now) => ({c: cycle(s && s.c, CHANNELS.length), t: now});
  // How warm the lava lamp is (0..1): it takes about 8 s to get going and 5 s to fade.
  function lavaWarm(s, now) {if (!s) return 0;const k = (now - s.t) / 1000;return s.on ? Math.min(1, k / 8) : Math.max(0, (s.from ?? 1) - k / 5);}

  // ---------- Chairs (local frame: x across, y up, z = the front; a chair stands on y = 0) ----------
  // A straight bar from [z0, y0] to [z1, y1] at x: thickness t (y), width w (x); rx tilts it in the y-z plane.
  const bar = (x, [z0, y0], [z1, y1], t, w, c) => ({w, h: t, d: Math.hypot(z1 - z0, y1 - y0), x, y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: Math.atan2(-(y1 - y0), z1 - z0), c});
  const bx = (w, h, d, x, y, z, c) => ({w, h, d, x, y, z, rx: 0, c});
  const CHAIRS = {
    // The black dining chairs: the back panel sits between two rear posts that run from the floor to the top.
    diningChair: {name: 'chair', seat: .47, colour: 0x1d1d1f, parts(c) {
      const out = [bx(.42, .04, .42, 0, .45, 0, c)];
      for (const s of [-1, 1]) {out.push(bx(.03, .43, .03, s * .18, .215, .18, c), bx(.03, .9, .03, s * .18, .45, -.18, c), bx(.02, .02, .33, s * .18, .14, 0, c));}
      out.push(bx(.33, .24, .022, 0, .75, -.18, c), bx(.33, .03, .022, 0, .56, -.18, c));
      return out;
    }, boxes: [[.44, .5, .44, 0, .25, 0], [.42, .92, .08, 0, .46, -.18]]},
    // The leather sling chair (video 63 s): a dark wooden frame – front legs, rear legs that lean back into the back posts, arms,
    // rails and stretchers – and a cognac leather sling hung from the front rail to the top of the back.
    slingChair: {name: 'leather sling chair', seat: .36, colour: 0x3b2414, parts(c) {
      const L = 0x8a4a22, out = [], rear = y => -.28 - .14 * y / .88;// the rear post's z at height y
      for (const s of [-1, 1]) {
        const x = s * .31;
        out.push(bar(x, [.3, 0], [.3, .6], .045, .045, c), bar(x, [-.28, 0], [-.42, .88], .045, .045, c));
        out.push(bar(x, [.34, .6], [rear(.6) - .015, .6], .05, .06, c), bar(x, [.3, .12], [rear(.12), .12], .03, .03, c));
      }
      for (const [y, z] of [[.4, .3], [.27, rear(.27)], [.84, rear(.84)], [.12, .3]]) out.push(bx(.665, .04, .04, 0, y, z, c));
      const sling = [[.32, .36], [.31, .42], [.05, .33], [-.22, .3], [-.31, .37], [rear(.86), .86]];
      for (let i = 0; i < sling.length - 1; i++) out.push(bar(0, sling[i], sling[i + 1], .014, .56, L));
      for (const s of [-1, 1]) out.push(bar(s * .31, [.3, .615], [-.32, .615], .012, .07, L));// leather on the arms
      return out;
    }, boxes: [[.68, .62, .8, 0, .31, -.04], [.68, .9, .14, 0, .45, -.36]]},
    // The wooden folding chair in the navy bedroom: back posts from the floor to the top rail, front legs up under the seat,
    // stretchers, two back slats and a folded blue throw on the seat.
    foldingChair: {name: 'folding chair', seat: .5, colour: 0x9a6a3a, parts(c) {
      const S = 0x7a5232, post = y => -.24 + .09 * y / .92, out = [];
      for (const s of [-1, 1]) out.push(bar(s * .21, [-.24, 0], [-.15, .92], .03, .03, c), bar(s * .18, [.24, .009], [-.12, .46], .03, .03, c));
      out.push(bx(.44, .025, .42, 0, .465, .02, S), bx(.39, .025, .025, 0, .1, .24 - .36 * .1 / .46, c), bx(.45, .025, .025, 0, .1, post(.1), c));
      for (const y of [.72, .84]) out.push(bx(.42, .07, .02, 0, y, post(y) + .01, c));
      out.push(bx(.36, .04, .26, 0, .4975, .03, 0x2f3c6e));
      return out;
    }, boxes: [[.48, .52, .52, 0, .26, 0], [.48, .95, .1, 0, .475, -.2]]}
  };
  const chairParts = kind => CHAIRS[kind].parts(CHAIRS[kind].colour);
  const chairBoxes = kind => CHAIRS[kind].boxes;
  // The axis-aligned box round a part (rx tilts it about x).
  function partBounds(p) {const c = Math.abs(Math.cos(p.rx)), s = Math.abs(Math.sin(p.rx)), hy = p.h / 2 * c + p.d / 2 * s, hz = p.h / 2 * s + p.d / 2 * c;return {x0: p.x - p.w / 2, x1: p.x + p.w / 2, y0: p.y - hy, y1: p.y + hy, z0: p.z - hz, z1: p.z + hz};}
  // Boxes [w, h, d, x, y, z] in a piece's frame -> {pts, minY, maxY} in wing coordinates at (a, b) turned by yaw (three.js y).
  function boxesToWing(boxes, a, b, yaw, FL = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return boxes.map(([w, h, d, x = 0, y = h / 2, z = 0]) => ({minY: FL + y - h / 2, maxY: FL + y + h / 2,
      pts: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([px, pz]) => [a + (x + px) * c + (z + pz) * s, b - (x + px) * s + (z + pz) * c])}));
  }
  // Two convex polygons ([[a, b]...]) overlap by more than `tol` (separating axes).
  function overlap(p, q, tol = .005) {
    for (const poly of [p, q]) for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx2, bz] = poly[(i + 1) % poly.length], nx = -(bz - az), nz = bx2 - ax, l = Math.hypot(nx, nz) || 1;
      const pa = p.map(([x, z]) => (x * nx + z * nz) / l), qa = q.map(([x, z]) => (x * nx + z * nz) / l);
      if (Math.max(...pa) <= Math.min(...qa) + tol || Math.max(...qa) <= Math.min(...pa) + tol) return false;
    }
    return true;
  }
  const solidsMeet = (A, B) => A.some(p => B.some(q => p.maxY > q.minY + .005 && q.maxY > p.minY + .005 && overlap(p.pts, q.pts)));
  // The flat's chairs: every movable piece of furniture, with its place as the video has it.
  const chairsOf = data => data.furniture.filter(f => f.movable && CHAIRS[f.kind]).map((f, i) => ({i, id: `r501-chair-${i}`, kind: f.kind, home: {a: f.at[0], b: f.at[1], y: (f.rot || 0) * Math.PI / 2}}));
  // Keep clear: the floor on both sides of every doorway (the doors swing there, people walk through), as wide as the door.
  function doorZones(data) {
    const out = [], R = data.stair.room;
    for (const w of data.walls) for (const o of w.openings || []) {
      const r = w.rect, alongA = r[2] - r[0] > r[3] - r[1], d = Math.min(.9, o.at[1] - o.at[0]);
      out.push(alongA ? [o.at[0] - .05, r[1] - d, o.at[1] + .05, r[3] + d] : [r[0] - d, o.at[0] - .05, r[2] + d, o.at[1] + .05]);
    }
    const e = data.entrance;out.push([e.at[0] - .05, R[1] - .12 - .95, e.at[1] + .05, R[1]]);
    return out;
  }
  const rectPoly = r => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  const roomOf = (data, a, b, m = 0) => data.rooms.find(r => a > r.rect[0] + m && a < r.rect[2] - m && b > r.rect[1] + m && b < r.rect[3] - m);
  // May the chair stand at (a, b) turned by yaw? ctx: {data, solids (furniture, wing coordinates, y from the floor),
  // others: [{kind, a, b, y}], player: [a, b] (it must be in the same room)}. -> {ok, why}
  function canPlace(ctx, kind, a, b, yaw) {
    const {data} = ctx, mine = boxesToWing(chairBoxes(kind), a, b, yaw), pts = mine.flatMap(m => m.pts);
    const room = roomOf(data, a, b);
    if (!room || !pts.every(([x, z]) => x > room.rect[0] + .015 && x < room.rect[2] - .015 && z > room.rect[1] + .015 && z < room.rect[3] - .015)) return {ok: false, why: 'wall'};
    if (ctx.player && roomOf(data, ctx.player[0], ctx.player[1], -.05) !== room) return {ok: false, why: 'wall'};
    if (data.walls.some(w => solidsMeet(mine, [{pts: rectPoly(w.rect), minY: -1, maxY: 4}]))) return {ok: false, why: 'wall'};
    if (doorZones(data).some(z => solidsMeet(mine, [{pts: rectPoly(z), minY: -1, maxY: 4}]))) return {ok: false, why: 'door'};
    if (solidsMeet(mine, ctx.solids || [])) return {ok: false, why: 'furniture'};
    for (const o of ctx.others || []) if (solidsMeet(mine, boxesToWing(chairBoxes(o.kind), o.a, o.b, o.y))) return {ok: false, why: 'chair'};
    return {ok: true};
  }
  // Where a chair goes when you put it down: in front of you (its back toward you), turned the way you face, in 15° steps.
  const snapYaw = y => {const s = Math.PI / 12;return Math.round(y / s) * s;};
  function putPose(kind, pa, pb, faceYaw) {
    const back = Math.max(...chairBoxes(kind).map(([, , d, , , z = 0]) => d / 2 - z)), reach = .24 + back, y = snapYaw(faceYaw);
    return {a: pa + Math.sin(faceYaw) * reach, b: pb + Math.cos(faceYaw) * reach, y};
  }
  // The sofa's three seats (wing coordinates, seat height from the floor), each turned to face the TV.
  function seatsOf(data) {
    const F = F501(), sofa = data.furniture.find(f => f.kind === 'sofa'), tv = data.furniture.find(f => f.kind === 'tv');if (!sofa || !tv) return [];
    const [ta, tb] = F.pieceToWing(tv, 0, 0);
    return [-.6, 0, .6].map((x, i) => {const [a, b] = F.pieceToWing(sofa, x * sofa.w / 2.1, .12), [sa, sb] = F.pieceToWing(sofa, x * sofa.w / 2.1, sofa.d / 2 + .3);return {i, id: 100 + i, a, b, seat: .47, yaw: Math.atan2(ta - a, tb - b), stand: [sa, sb]};});
  }
  // How loud the record or the TV is where you are: at full in the living room (less with distance), a little through the
  // doorway in the flat's other rooms (muffled), nothing outside the flat.
  function hearing(at, dist) {
    if (!at || at.place !== 'flat') return {gain: 0, muffle: 1};
    if (at.room === 'living') return {gain: Math.min(1, 1.6 / (1 + dist)), muffle: 0};
    return {gain: .3 * Math.min(1, 2.5 / (1 + dist)), muffle: .85};
  }
  // The soundtrack steps back while a record (much) or the TV (a little) is heard.
  const duckFor = (lp, tv) => Math.max(.1, 1 - .9 * Math.min(1, lp * 1.5)) * (1 - .4 * Math.min(1, tv * 1.5));
  // Every thing you can use in the room, with its place (wing coordinates, height from the floor) for the tests and hit boxes.
  function items(data) {
    const F = F501(), wu = data.furniture.find(f => f.kind === 'wallUnit'), tv = data.furniture.find(f => f.kind === 'tv'), sofa = data.furniture.find(f => f.kind === 'sofa');
    const at = (f, x, z, y, name, size) => {const [a, b] = F.pieceToWing(f, x, z);return {name, a, b, y, size};};
    return [at(wu, wu.record[0], wu.record[1], .95, 'record player', [.5, .3, .45]), at(wu, wu.lava[0], wu.lava[1], 1.37, 'lava lamp', [.24, .44, .24]),
      at(tv, 0, 0, .87, 'TV', [1.3, .8, .3]), at(sofa, 0, 0, .45, 'sofa', [sofa.w, .9, sofa.d]),
      ...chairsOf(data).map(c => ({name: CHAIRS[c.kind].name, a: c.home.a, b: c.home.b, y: .45, size: [.6, .9, .6], chair: c}))];
  }

  // ---------- Browser ----------
  function create({T, lib, flat, data}) {
    const F = F501(), K = flat.kit, FL = K.FL, W = (a, b) => flat.toWorld(a, b), hitboxes = [], disposables = [];
    const hitbox = (parent, w, h, d, x, y, z, ud) => {const m = new T.Mesh(new T.BoxGeometry(w, h, d), K.hidden);m.position.set(x, y, z);m.userData = {...ud, keep: true, noMerge: true};parent.add(m);hitboxes.push(m);return m;};
    const piece = f => {const g = new T.Group(), [a, b] = F.pieceToWing(f, 0, 0);g.position.set(a, FL, b);g.rotation.y = (f.rot || 0) * Math.PI / 2;g.userData.noMerge = true;K.wing.add(g);return g;};
    const noShadow = g => g.traverse(o => {if (o.isMesh) o.castShadow = false;});
    const state = {lp: null, tv: null, lava: null, chairs: {}};
    let game = null;// set by attach(): the game's hooks
    const now = () => game ? game.now() : Date.now();

    // ---- Chairs: one merged mesh each, moved as a whole.
    const chairs = chairsOf(data).map(c => {
      const g = new T.Group();g.userData.noMerge = true;K.wing.add(g);
      for (const p of chairParts(c.kind)) {const m = K.pbox(g, p.w, p.h, p.d, p.x, p.y, p.z, p.c);m.rotation.x = p.rx;}
      lib.mergeStatic(g);noShadow(g);
      const box = chairBoxes(c.kind), hb = hitbox(g, .62, .95, .62, 0, .47, -.04, {r501: 'chair', chair: c.i});hb.userData.partName = CHAIRS[c.kind].name;
      return {...c, g, pose: {...c.home}, box, hb};
    });
    const poseChair = (ch, a, b, yaw, lift = 0) => {ch.g.position.set(a, FL + lift, b);ch.g.rotation.y = yaw;};
    chairs.forEach(ch => poseChair(ch, ch.pose.a, ch.pose.b, ch.pose.y));

    // ---- The record player: platter with the record, spindle, tonearm (on the wall unit's record player plinth).
    const wu = data.furniture.find(f => f.kind === 'wallUnit'), lpG = piece(wu);
    const lpTop = new T.Group();lpTop.position.set(wu.record[0], .95, wu.record[1]);lpG.add(lpTop);
    const platter = new T.Group();platter.position.set(-.03, 0, 0);lpTop.add(platter);
    const matM = new T.MeshStandardMaterial({color: 0x2a2a2e, roughness: .9}), metal = new T.MeshStandardMaterial({color: 0xc9ccd0, roughness: .3, metalness: .8});
    {const m = new T.Mesh(new T.CylinderGeometry(.145, .145, .012, 40), matM);m.position.y = .006;platter.add(m);}
    const labels = RECORDS.map((r, i) => {
      const c = document.createElement('canvas');c.width = c.height = 256;const g = c.getContext('2d');
      g.fillStyle = '#0b0b0d';g.fillRect(0, 0, 256, 256);g.strokeStyle = 'rgba(255,255,255,.06)';for (let k = 60; k < 128; k += 3) {g.beginPath();g.arc(128, 128, k, 0, 7);g.stroke();}
      g.fillStyle = r.label;g.beginPath();g.arc(128, 128, 46, 0, 7);g.fill();g.fillStyle = '#fff';g.font = 'bold 13px Georgia';g.textAlign = 'center';g.fillText(r.title, 128, 116);g.font = '10px Georgia';g.fillText(r.artist, 128, 148);
      g.fillStyle = '#111';g.beginPath();g.arc(128, 128, 4, 0, 7);g.fill();
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;disposables.push(t);return t;
    });
    const vinylSide = new T.MeshStandardMaterial({color: 0x0b0b0d, roughness: .35}), vinylTop = new T.MeshStandardMaterial({map: labels[0], roughness: .28, metalness: .1});
    const disc = new T.Mesh(new T.CylinderGeometry(.15, .15, .004, 48), [vinylSide, vinylTop, vinylSide]);disc.position.y = .014;disc.visible = false;platter.add(disc);
    {const m = new T.Mesh(new T.CylinderGeometry(.004, .004, .03, 8), metal);m.position.y = .02;platter.add(m);}
    const arm = new T.Group();arm.position.set(.14, .012, -.1);lpTop.add(arm);// pivot over the plinth's arm base
    const armLift = new T.Group();arm.add(armLift);
    {
      const post = new T.Mesh(new T.CylinderGeometry(.012, .014, .04, 12), metal);post.position.y = .02;arm.add(post);
      const tube = new T.Mesh(new T.CylinderGeometry(.0045, .0045, .235, 8), metal);tube.rotation.x = Math.PI / 2;tube.position.set(0, .045, .1175);armLift.add(tube);
      const head = new T.Mesh(new T.BoxGeometry(.018, .008, .04), new T.MeshStandardMaterial({color: 0x1a1a1a, roughness: .5}));head.position.set(-.006, .04, .245);head.rotation.y = .35;armLift.add(head);
      const weight = new T.Mesh(new T.CylinderGeometry(.016, .016, .03, 14), metal);weight.rotation.x = Math.PI / 2;weight.position.set(0, .045, -.05);armLift.add(weight);
      lib.mergeStatic(armLift);
      const rest = new T.Mesh(new T.BoxGeometry(.012, .035, .012), matM);rest.position.set(0, .018, .235);lpTop.add(rest);rest.position.add(arm.position);
    }
    noShadow(lpG);
    hitbox(lpTop, .5, .3, .45, 0, .05, 0, {r501: 'lp', partName: 'Record player'});

    // ---- The lava lamp on the shelf above.
    const lavaG = new T.Group();lavaG.position.set(wu.lava[0], 1.205, wu.lava[1]);lpG.add(lavaG);
    const lavaBase = new T.MeshStandardMaterial({color: 0x7a5a2e, roughness: .3, metalness: .75});
    const liquid = new T.MeshStandardMaterial({color: 0xff9440, emissive: 0xff7a20, emissiveIntensity: 0, transparent: true, opacity: .42, roughness: .08, depthWrite: false});
    const wax = new T.MeshStandardMaterial({color: 0xc8143c, emissive: 0xff1e46, emissiveIntensity: 0, roughness: .45});
    {
      const base = new T.Mesh(new T.CylinderGeometry(.04, .068, .13, 24), lavaBase);base.position.y = .065;lavaG.add(base);
      const cap = new T.Mesh(new T.CylinderGeometry(.016, .033, .07, 20), lavaBase);cap.position.y = .13 + .27 + .035;lavaG.add(cap);
    }
    const glass = new T.Mesh(new T.CylinderGeometry(.033, .054, .27, 24, 1, true), liquid);glass.position.y = .13 + .135;glass.renderOrder = 2;lavaG.add(glass);
    const glassR = (y) => .054 - (.054 - .033) * Math.max(0, Math.min(1, (y - .13) / .27));// inside radius at height y
    // The wax: five blobs in one instanced mesh (one draw), moved and stretched every frame.
    const blobMesh = new T.InstancedMesh(new T.SphereGeometry(1, 14, 10), wax, 5);blobMesh.frustumCulled = false;lavaG.add(blobMesh);
    const blobs = [[.03, .0, 31, 0], [.024, 1.7, 37, .008], [.02, 3.1, 26, -.006], [.026, 4.4, 43, .004], [.017, 5.6, 29, -.003]].map(([r, ph, period, off]) => ({r, ph, period, off}));
    const bM = new T.Matrix4(), bP = new T.Vector3(), bS = new T.Vector3(), bQ = new T.Quaternion();
    function moveBlobs(warm, tSec) {
      for (const b of blobs) {
        const k = warm * (.5 - .5 * Math.cos((tSec / b.period + b.ph) * Math.PI * 2)), y = .15 + b.r + k * (.36 - .15 - 2 * b.r), r = glassR(y) - b.r - .004;
        bP.set(Math.max(-r, Math.min(r, b.off + Math.sin(tSec * .3 + b.ph) * .006 * warm)), y, Math.max(-r, Math.min(r, Math.cos(tSec * .27 + b.ph) * .006 * warm)));
        const stretch = 1 + .35 * warm * Math.abs(Math.sin((tSec / b.period + b.ph) * Math.PI * 2));bS.set(b.r / Math.sqrt(stretch), b.r * stretch, b.r / Math.sqrt(stretch));blobMesh.setMatrixAt(blobs.indexOf(b), bM.compose(bP, bQ, bS));
      }
      blobMesh.instanceMatrix.needsUpdate = true;
    }
    moveBlobs(0, 0);
    const pool = new T.Mesh(new T.CylinderGeometry(.045, .05, .018, 20), wax);pool.position.y = .139;lavaG.add(pool);
    noShadow(lavaG);
    hitbox(lavaG, .24, .44, .24, 0, .22, 0, {r501: 'lava', partName: 'Lava lamp'});

    // ---- The TV's screen (a canvas picture) and the sofa.
    const tvF = data.furniture.find(f => f.kind === 'tv'), tvG = piece(tvF), CW = 320, CH = 180;
    const tvCanvas = document.createElement('canvas');tvCanvas.width = CW;tvCanvas.height = CH;const tvc = tvCanvas.getContext('2d');
    const tvTex = new T.CanvasTexture(tvCanvas);tvTex.colorSpace = T.SRGBColorSpace;disposables.push(tvTex);
    const screenM = new T.MeshStandardMaterial({color: 0x07080a, roughness: .2, metalness: .15, emissive: 0xffffff, emissiveMap: tvTex, emissiveIntensity: 0});
    const screen = new T.Mesh(new T.PlaneGeometry(1.2, .68), screenM);screen.position.set(0, .87, .027);screen.castShadow = false;tvG.add(screen);
    hitbox(tvG, 1.3, .8, .3, 0, .87, 0, {r501: 'tv', partName: 'TV'});
    const sofaF = data.furniture.find(f => f.kind === 'sofa'), sofaG = piece(sofaF);
    hitbox(sofaG, sofaF.w, .75, sofaF.d, 0, .42, 0, {r501: 'sofa', partName: 'Sofa'});
    const seats = seatsOf(data);

    // ---- Lights: present from the start (no shaders recompile), intensity 0 while off. In the wing group, which is always shown.
    const lavaLight = new T.PointLight(0xff6a3a, 0, 3.4, 1.6), tvLight = new T.PointLight(0x9fb4ff, 0, 5, 1.6);
    {const [a, b] = F.pieceToWing(wu, wu.lava[0] + 0, wu.lava[1] + .12);lavaLight.position.set(a, FL + 1.42, b);const [ta, tb] = F.pieceToWing(tvF, 0, .7);tvLight.position.set(ta, FL + .95, tb);}
    K.always.add(lavaLight, tvLight);

    // ---------- State changes (local or from the lobby) ----------
    const send = (id, v) => {if (game) game.send(id, v);};
    // Local presses come in as {r, t}; the lobby passes on what was sent ({r, t, swap} or {r: -1, t, was}).
    function setLp(v, fromNet) {
      const before = state.lp, wasOn = before && before.r >= 0;
      if (!v) state.lp = null;
      else if (fromNet) state.lp = v;
      else state.lp = v.r >= 0 ? {r: v.r, t: v.t, ...(wasOn ? {swap: 1} : {})} : {r: -1, t: v.t, was: wasOn ? before.r : -1};
      if (state.lp && state.lp.r >= 0) vinylTop.map = labels[state.lp.r];
      else if (state.lp && state.lp.was >= 0) vinylTop.map = labels[state.lp.was];
      if (!fromNet && game && state.lp) {const r = RECORDS[state.lp.r];game.notice(r ? `♪ ${r.title} – ${r.artist} (${r.style})` : 'The record player stops.', 3);}
    }
    function setTv(v, quiet) {state.tv = v && v.c >= 0 ? v : null;tvDrawT = 0;audioState.tvChannel = null;if (!quiet && game) game.notice(state.tv ? `📺 ${CHANNELS[state.tv.c].name}` : 'The TV is off.', 2.5);}
    function setLava(v, quiet) {const w = lavaWarm(state.lava, now());state.lava = v ? {...v, from: v.on ? 0 : (v.from ?? w)} : null;if (!quiet && game) game.notice(v && v.on ? 'The lava lamp is warming up…' : 'The lava lamp cools down.', 2.5);}
    function setChair(i, v, fromNet) {
      const ch = chairs[i];if (!ch) return;
      const pose = v ? {a: v.a, b: v.b, y: v.y} : {...ch.home};ch.pose = pose;ch.by = v && v.by ? v.by : 0;
      if (fromNet && carrying && carrying.i === i && ch.by !== (game ? game.you() : 0)) {carrying = null;if (game) game.notice('Somebody else took the chair.', 2.5);}
      if (!carrying || carrying.i !== i) poseChair(ch, pose.a, pose.b, pose.y);
      if (game) game.solidsChanged();
    }
    function apply(id, v, fromNet = true) {
      if (id === 'r501-lp') setLp(v, fromNet);
      else if (id === 'r501-tv') setTv(v, fromNet);
      else if (id === 'r501-lava') setLava(v, fromNet);
      else {const m = /^r501-chair-(\d+)$/.exec(id);if (m) setChair(+m[1], v, fromNet);}
    }
    // A new lobby: everything back as in the video, then the lobby's own state.
    function reset() {if (carrying) carrying = null;setLp(null, true);setTv(null, true);setLava(null, true);chairs.forEach(ch => setChair(ch.i, null, false));}
    // Alone in a new, empty lobby: send up what you changed while offline (a carried chair goes back first).
    function publish() {
      if (carrying) dropBack();
      if (state.lp) send('r501-lp', state.lp);if (state.tv) send('r501-tv', state.tv);if (state.lava) send('r501-lava', state.lava);
      for (const ch of chairs) if (Math.hypot(ch.pose.a - ch.home.a, ch.pose.b - ch.home.b) > .01 || Math.abs(ch.pose.y - ch.home.y) > .01) send(ch.id, roundPose(ch.pose));
    }

    // ---------- Using things ----------
    let carrying = null, pending = null;
    const HOLD_S = .4, CARRY_LIFT = .45;// hold □ this long to sit; a carried chair is held this high (you see it in front of you)
    const playerWing = p => K.toWing(p.x, p.z);
    const faceWing = yaw => yaw + Math.PI - K.yaw;// the player's view yaw -> a wing yaw whose +z is where they look
    const solidsFor = () => K.solids.map(s => ({pts: s.pts, minY: s.minY - FL, maxY: s.maxY - FL}));
    const othersOf = i => chairs.filter(c => c.i !== i).map(c => ({kind: c.kind, a: c.pose.a, b: c.pose.b, y: c.pose.y}));
    function placeCheck(p) {
      const [pa, pb] = playerWing(p), pose = putPose(carrying.ch.kind, pa, pb, faceWing(p.yaw));
      if (Math.abs(p.feet - FL) > .4) return {ok: false, why: 'wall', pose};
      return {...canPlace({data, solids: solidsFor(), others: othersOf(carrying.i), player: [pa, pb]}, carrying.ch.kind, pose.a, pose.b, pose.y), pose};
    }
    const WHY = {wall: 'a wall is in the way', door: 'keep the doorway clear', furniture: 'furniture is in the way', chair: 'another chair is there'};
    function pickUp(i) {
      const ch = chairs[i];if (!ch || (ch.by && game.remoteHas(ch.by))) {game.notice('Somebody is carrying that chair.', 2);return;}
      if (game.sitTaken(200 + i)) {game.notice('Somebody is sitting on it.', 2);return;}
      carrying = {i, ch, from: {...ch.pose}};ch.by = game.you() || -1;
      game.audio('scrape', {gain: .35});game.notice(`You carry the ${CHAIRS[ch.kind].name} · □ put it down (in front of you, turned the way you face)`, 3.5);
      send(ch.id, {...roundPose(ch.pose), by: game.you()});game.solidsChanged();
    }
    const roundPose = p => ({a: Math.round(p.a * 100) / 100, b: Math.round(p.b * 100) / 100, y: Math.round(p.y * 1000) / 1000});
    function putDown(p) {
      const c = placeCheck(p);if (!c.ok) {game.notice(`Not here – ${WHY[c.why]}.`, 2);game.audio('locked');return false;}
      const ch = carrying.ch;carrying = null;ch.by = 0;ch.pose = roundPose(c.pose);poseChair(ch, ch.pose.a, ch.pose.b, ch.pose.y);
      game.audio('thud', {gain: .4});send(ch.id, ch.pose);game.solidsChanged();return true;
    }
    function dropBack(why) {if (!carrying) return;const ch = carrying.ch;ch.pose = carrying.from;ch.by = 0;carrying = null;poseChair(ch, ch.pose.a, ch.pose.b, ch.pose.y);send(ch.id, roundPose(ch.pose));game.solidsChanged();if (why) game.notice(why, 3);}
    function sitOnChair(i) {
      const ch = chairs[i], k = CHAIRS[ch.kind];if (game.sitTaken(200 + i)) {game.notice('Somebody is sitting there.', 2);return;}
      // Stand up in front of the chair, or behind or beside it when that is taken (a dining chair faces its table).
      const c = Math.cos(ch.pose.y), s = Math.sin(ch.pose.y), seat = W(ch.pose.a + s * .02, ch.pose.b + c * .02), solids = solidsFor(), others = othersOf(i);
      const free = ([a, b]) => {const me = [{pts: rectPoly([a - .2, b - .2, a + .2, b + .2]), minY: 0, maxY: 1.7}];return !!roomOf(data, a, b, .2) && !solidsMeet(me, solids) && !others.some(o => solidsMeet(me, boxesToWing(chairBoxes(o.kind), o.a, o.b, o.y)));};
      const spots = [[.55, 0], [-.7, 0], [0, .6], [0, -.6]].map(([f, r]) => [ch.pose.a + s * f + c * r, ch.pose.b + c * f - s * r]), st = W(...(spots.find(free) || spots[0]));
      const look = W(ch.pose.a + s, ch.pose.b + c), yaw = Math.atan2(-(look.x - seat.x), -(look.z - seat.z));
      game.sit({x: seat.x, y: FL + k.seat, z: seat.z, yaw, id: 200 + i, stand: {x: st.x, z: st.z, y: FL}, pitch: -.15, note: `On the ${k.name} · □ / ✕ stand up`});
    }
    function sitOnSofa(p) {
      const [pa, pb] = playerWing(p), free = seats.filter(s => !game.sitTaken(s.id)).sort((x, y) => Math.hypot(x.a - pa, x.b - pb) - Math.hypot(y.a - pa, y.b - pb))[0];
      if (!free) {game.notice('The sofa is full.', 2);return;}
      const w = W(free.a, free.b), st = W(...free.stand), look = W(free.a + Math.sin(free.yaw), free.b + Math.cos(free.yaw));
      game.sit({x: w.x, y: FL + free.seat, z: w.z, yaw: Math.atan2(-(look.x - w.x), -(look.z - w.z)), id: free.id, stand: {x: st.x, z: st.z, y: FL}, pitch: -.12,
        note: 'On the sofa · □ / E the TV (on, next channel, off) · ✕ / Space stand up', prompt: () => ({text: `□ ${tvText()} · ✕ stand up`}), square: () => useTv()});
    }
    function useLp() {const v = nextRecord(state.lp, now());setLp(v, false);send('r501-lp', state.lp);game.audio('click');}
    function useTv() {const v = nextChannel(state.tv, now());setTv(v.c >= 0 ? v : null, false);send('r501-tv', state.tv);game.audio('click');}
    function useLava() {const on = !(state.lava && state.lava.on);setLava({on, t: now()}, false);send('r501-lava', state.lava);game.audio('click');}
    const lpText = () => {const n = cycle(state.lp && state.lp.r, RECORDS.length);return n < 0 ? 'Stop the record' : `${state.lp && state.lp.r >= 0 ? 'Next record' : 'Put on a record'}: «${RECORDS[n].title}» – ${RECORDS[n].artist}`;};
    const tvText = () => {const n = cycle(state.tv && state.tv.c, CHANNELS.length);return n < 0 ? 'Turn off the TV' : `${state.tv ? 'TV: next channel' : 'Turn on the TV'} (${CHANNELS[n].name})`;};
    // The prompt for what you look at (on foot), or for the chair in your hands.
    function prompt(look, p) {
      if (!game) return null;
      if (carrying) {const c = placeCheck(p);return {text: c.ok ? `□ Put the ${CHAIRS[carrying.ch.kind].name} down` : `Carrying the ${CHAIRS[carrying.ch.kind].name} · not here: ${WHY[c.why]}`, act: () => putDown(p)};}
      const u = look && look.userData;if (!u || !u.r501) return null;
      if (u.r501 === 'lp') return {text: `□ ${lpText()}`, act: useLp};
      if (u.r501 === 'tv') return {text: `□ ${tvText()}`, act: useTv};
      if (u.r501 === 'lava') return {text: `□ ${state.lava && state.lava.on ? 'Turn off' : 'Turn on'} the lava lamp`, act: useLava};
      if (u.r501 === 'sofa') return {text: `□ Sit on the sofa${state.tv ? '' : ' (□ there turns on the TV)'}`, act: () => sitOnSofa(p)};
      if (u.r501 === 'chair') {const ch = chairs[u.chair];if (ch.by && game.remoteHas(ch.by)) return {text: `${game.nameOf(ch.by)} is carrying the ${CHAIRS[ch.kind].name}`, act: () => {}};return {text: `□ Pick up the ${CHAIRS[ch.kind].name} · hold □ sit on it`, act: () => {pending = {i: u.chair, t: performance.now()};}};}
      return null;
    }

    // ---------- Sound: the record and the TV come from their places in the room ----------
    const audioState = {chain: null, tv: null, lpKey: null, tvChannel: null};
    const lpWorld = W(...F.pieceToWing(wu, wu.record[0], wu.record[1])), tvWorld = W(...F.pieceToWing(tvF, 0, .1));
    function spatial(ctx) {
      const input = ctx.createGain(), lp = ctx.createBiquadFilter(), pan = ctx.createStereoPanner(), gain = ctx.createGain(), comp = ctx.createDynamicsCompressor();
      lp.type = 'lowpass';lp.frequency.value = 18000;gain.gain.value = 0;comp.threshold.value = -14;comp.ratio.value = 4;
      input.connect(lp).connect(pan).connect(gain).connect(comp).connect((game.audioOutput && game.audioOutput()) || ctx.destination);
      return {input, lp, pan, gain, set(g, p, muffle, t) {gain.gain.setTargetAtTime(g, t, .15);pan.pan.setTargetAtTime(p, t, .15);lp.frequency.setTargetAtTime(muffle > .5 ? 700 : 18000, t, .2);}};
    }
    // The TV's sound: a quiet bed made from noise and a few oscillators, shaped per channel.
    function tvSound(ctx, out) {
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = noise.getChannelData(0);for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();src.buffer = noise;src.loop = true;src.start();
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter(), env = ctx.createGain(), bed = ctx.createGain();f1.type = f2.type = 'bandpass';env.gain.value = 0;bed.gain.value = 0;
      src.connect(f1).connect(env);src.connect(f2).connect(env);env.connect(out);
      const pad = [0, 4, 7, 11].map(n => {const o = ctx.createOscillator();o.type = 'triangle';o.frequency.value = 261.6 * Math.pow(2, n / 12);o.connect(bed);o.start();return o;});
      const padLp = ctx.createBiquadFilter();padLp.type = 'lowpass';padLp.frequency.value = 1100;bed.disconnect();bed.connect(padLp).connect(out);
      let ch = -1, next = 0;
      return {
        channel(c) {
          ch = c;const t = ctx.currentTime;
          const set = (p, v) => p.setTargetAtTime(v, t, .05);
          if (c === 0) {set(f1.frequency, 520);f1.Q.value = 2.2;set(f2.frequency, 1700);f2.Q.value = 3;set(bed.gain, 0);}
          else if (c === 1) {set(f1.frequency, 900);f1.Q.value = .6;set(f2.frequency, 2400);f2.Q.value = .8;set(bed.gain, 0);}
          else if (c === 2) {set(f1.frequency, 320);f1.Q.value = .5;set(f2.frequency, 4200);f2.Q.value = 6;set(bed.gain, 0);}
          else if (c === 3) {set(f1.frequency, 520);f1.Q.value = 2.2;set(f2.frequency, 1600);f2.Q.value = 3;set(bed.gain, .016);}
          else {set(env.gain, 0);set(bed.gain, 0);}
        },
        // Called often: the speech, crowd and birds move a little.
        update(tSec) {
          const t = ctx.currentTime;if (t < next) return;next = t + .09;
          if (ch === 0 || ch === 3) {const phrase = Math.sin(tSec * .7) + Math.sin(tSec * 1.9) > -.6, syl = .5 + .5 * Math.sin(tSec * 31 + Math.sin(tSec * 7) * 3);env.gain.setTargetAtTime(phrase ? (ch === 3 ? .1 : .16) * (.35 + .65 * syl) : .01, t, .03);}
          else if (ch === 1) {const roar = .5 + .5 * Math.sin(tSec * .23) * Math.sin(tSec * .11), goal = tvGoal(tSec) ? 1 : 0;env.gain.setTargetAtTime(.05 + .07 * roar + .2 * goal, t, .3);}
          else if (ch === 2) {const chirp = Math.random() < .08;env.gain.setTargetAtTime(chirp ? .09 : .03, t, chirp ? .01 : .2);if (chirp) {f2.frequency.setValueAtTime(3200 + Math.random() * 1800, t);f2.frequency.linearRampToValueAtTime(4800 + Math.random() * 1500, t + .08);}}
        },
        stop() {try {src.stop();pad.forEach(o => o.stop());} catch {}}
      };
    }
    // The football: a goal now and then, the same for everyone (from the lobby's clock).
    const tvGoal = tSec => (Math.floor(tSec / 47) % 3 === 1) && tSec % 47 < 4;

    // ---------- The TV picture ----------
    let tvDrawT = 0;
    const TICKER = 'Akerselva: ny padlerekord fra Bjølsen til Vaterland  ·  Torshov: diskgolfbanen åpen hele helgen  ·  Grünerløkka: biblioteket ber om ro  ·  Fallskjermfly over Ulven hvert åttende minutt  ·  Rathkes gate: plater og lavalampe i 5. etasje  ·  ';
    const NO_WEATHER = {clear: 'klarvær', fair: 'lettskyet', partly: 'delvis skyet', cloudy: 'skyet', fog: 'tåke', rain: 'regn', sleet: 'sludd', snow: 'snø'};
    function drawTv(tSec) {
      const g = tvc, c = state.tv ? state.tv.c : -1;g.save();
      if (c === 0) {
        const bg = g.createLinearGradient(0, 0, 0, CH);bg.addColorStop(0, '#13234a');bg.addColorStop(1, '#2c4a8a');g.fillStyle = bg;g.fillRect(0, 0, CW, CH);
        g.fillStyle = 'rgba(255,255,255,.06)';for (let i = 0; i < 8; i++) g.fillRect(i * 44 + (tSec * 3 % 44), 0, 2, CH);
        // The newsreader: shoulders, head, a mouth that moves while they talk.
        g.fillStyle = '#20232b';g.beginPath();g.ellipse(96, 182, 62, 52, 0, Math.PI, 0);g.fill();g.fillStyle = '#e8e3dc';g.fillRect(90, 132, 12, 18);
        g.fillStyle = '#d9a07a';g.beginPath();g.ellipse(96, 104, 21, 26, 0, 0, 7);g.fill();g.fillStyle = '#3a2618';g.beginPath();g.ellipse(96, 88, 23, 15, 0, Math.PI, 0);g.fill();
        const talk = Math.sin(tSec * .7) + Math.sin(tSec * 1.9) > -.6 ? Math.abs(Math.sin(tSec * 15)) : 0;g.fillStyle = '#7a3a2a';g.fillRect(90, 114, 12, 2 + talk * 4);
        g.fillStyle = '#c9b8a8';g.fillRect(0, 150, 190, 8);
        // The picture beside them changes every 8 s.
        const pic = Math.floor(tSec / 8) % 3;g.fillStyle = '#0d1424';g.fillRect(178, 24, 128, 80);
        if (pic === 0) {g.fillStyle = '#6fa8dc';g.fillRect(180, 26, 124, 76);g.fillStyle = '#2f6b3a';g.fillRect(180, 76, 124, 26);g.fillStyle = '#d33';g.beginPath();g.ellipse(236 + Math.sin(tSec) * 20, 74, 26, 5, 0, 0, 7);g.fill();}
        else if (pic === 1) {g.fillStyle = '#9fb7c9';g.fillRect(180, 26, 124, 76);g.fillStyle = '#7a3a2a';for (let i = 0; i < 6; i++) g.fillRect(184 + i * 20, 50 - (i % 3) * 8, 16, 52 + (i % 3) * 8);g.fillStyle = '#ffd96a';for (let i = 0; i < 12; i++) g.fillRect(188 + (i % 6) * 20, 58 + Math.floor(i / 6) * 18, 5, 6);}
        else {g.fillStyle = '#1e2d3a';g.fillRect(180, 26, 124, 76);g.fillStyle = '#e94';for (let i = 0; i < 5; i++) {g.beginPath();g.arc(200 + i * 22, 64 + Math.sin(tSec * 2 + i) * 8, 6, 0, 7);g.fill();}}
        g.fillStyle = '#c0182c';g.fillRect(0, 128 + 30, CW, 4);g.fillStyle = '#c0182c';g.fillRect(8, 112, 74, 16);g.fillStyle = '#fff';g.font = 'bold 11px Segoe UI, Arial';g.fillText('NYHETER', 14, 124);
        g.fillStyle = 'rgba(8,12,24,.88)';g.fillRect(0, 162, CW, 18);g.fillStyle = '#ffd34a';g.font = '12px Segoe UI, Arial';const w = g.measureText(TICKER).width, x = -((tSec * 46) % w);g.fillText(TICKER + TICKER, x, 175);
        const d = new Date();g.fillStyle = '#fff';g.font = 'bold 12px Segoe UI, Arial';g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 276, 16);g.font = '10px Segoe UI, Arial';g.fillText('LØKKA-TV', 8, 16);
      } else if (c === 1) {
        const pan = Math.sin(tSec * .13) * 60;
        for (let i = 0; i < 10; i++) {g.fillStyle = i % 2 ? '#2f8a3c' : '#36994a';g.fillRect(i * 40 - 40 - (pan % 40), 0, 40, CH);}
        g.strokeStyle = 'rgba(255,255,255,.85)';g.lineWidth = 2;g.strokeRect(-20 - pan, 22, 360, 140);g.beginPath();g.moveTo(160 - pan, 22);g.lineTo(160 - pan, 162);g.stroke();g.beginPath();g.arc(160 - pan, 92, 26, 0, 7);g.stroke();
        g.strokeRect(-20 - pan, 62, 40, 60);g.strokeRect(300 - pan, 62, 40, 60);
        const bxp = 160 + Math.sin(tSec * .41) * 120 + Math.sin(tSec * 1.3) * 20, byp = 92 + Math.sin(tSec * .67) * 50;
        for (let i = 0; i < 14; i++) {const team = i < 7, px = 160 + Math.sin(tSec * (.2 + i * .03) + i * 2) * 140 * (.5 + .5 * Math.sin(i)) + (bxp - 160) * .35, py = 92 + Math.cos(tSec * (.25 + i * .02) + i) * 60;
          g.fillStyle = team ? '#d23a2e' : '#f2f2f2';g.fillRect(px - pan - 3, py - 7, 6, 10);g.fillStyle = team ? '#fff' : '#1d3f8a';g.fillRect(px - pan - 3, py + 3, 6, 4);}
        g.fillStyle = '#fff';g.beginPath();g.arc(bxp - pan, byp, 3, 0, 7);g.fill();
        const goals = Math.floor(tSec / 47 / 3) % 5, min = Math.floor(tSec / 4) % 90 + 1;
        g.fillStyle = 'rgba(10,20,40,.85)';g.fillRect(8, 6, 150, 18);g.fillStyle = '#fff';g.font = 'bold 12px Segoe UI, Arial';g.fillText(`LØK ${goals % 3}–${Math.floor(goals / 2)} TOR   ${min}'`, 14, 19);
        if (tvGoal(tSec)) {g.fillStyle = 'rgba(200,20,40,.85)';g.fillRect(90, 70, 140, 40);g.fillStyle = '#fff';g.font = 'bold 26px Segoe UI, Arial';g.fillText('MÅL!', 128, 100);}
      } else if (c === 2) {
        const sky = g.createLinearGradient(0, 0, 0, CH);sky.addColorStop(0, '#f6b26b');sky.addColorStop(.55, '#f9dca0');sky.addColorStop(1, '#9fc5e8');g.fillStyle = sky;g.fillRect(0, 0, CW, CH);
        g.fillStyle = '#fff2c8';g.beginPath();g.arc(240, 64, 16, 0, 7);g.fill();
        const ridge = (h, amp, col, speed, seed) => {g.fillStyle = col;g.beginPath();g.moveTo(0, CH);for (let x = 0; x <= CW; x += 8) g.lineTo(x, h - amp * (Math.sin((x + tSec * speed) * .021 + seed) * .6 + Math.sin((x + tSec * speed) * .057 + seed * 2) * .4));g.lineTo(CW, CH);g.fill();};
        ridge(96, 30, '#7d7fa6', 2, 1);ridge(118, 22, '#4f5d7a', 5, 3);ridge(140, 14, '#2f4a3a', 9, 5);
        g.fillStyle = '#3d6f99';g.fillRect(0, 150, CW, 30);g.fillStyle = 'rgba(255,255,255,.25)';for (let i = 0; i < 12; i++) g.fillRect((i * 37 + tSec * 6) % CW, 156 + (i % 3) * 7, 14, 1);
        const ex = (tSec * 18) % (CW + 80) - 40, ey = 50 + Math.sin(tSec * .5) * 10, fl = Math.sin(tSec * 3) * 5;g.strokeStyle = '#222';g.lineWidth = 2;g.beginPath();g.moveTo(ex - 14, ey + fl);g.quadraticCurveTo(ex - 6, ey - 4, ex, ey);g.quadraticCurveTo(ex + 6, ey - 4, ex + 14, ey + fl);g.stroke();
        if (tSec % 20 < 6) {g.fillStyle = 'rgba(0,0,0,.55)';g.fillRect(60, 160, 200, 16);g.fillStyle = '#fff';g.font = '11px Segoe UI, Arial';g.fillText('Kongeørnen seiler over fjellet …', 72, 172);}
      } else if (c === 3) {
        const w = game && game.weather ? game.weather() : null;
        const bg = g.createLinearGradient(0, 0, 0, CH);bg.addColorStop(0, '#0f4a86');bg.addColorStop(1, '#2a7cc2');g.fillStyle = bg;g.fillRect(0, 0, CW, CH);
        g.fillStyle = '#fff';g.font = 'bold 16px Segoe UI, Arial';g.fillText('Været i Oslo', 14, 26);g.font = '10px Segoe UI, Arial';g.fillText('Kilde: MET Norway', 236, 172);
        const kind = w ? w.kind : 'partly', temp = w && Number.isFinite(w.temp) ? Math.round(w.temp) : null;
        const icon = (x, y, k, s) => {
          if (k === 'clear' || k === 'fair' || k === 'partly') {g.fillStyle = '#ffd34a';g.beginPath();g.arc(x, y, 18 * s, 0, 7);g.fill();for (let i = 0; i < 8; i++) {const a = i * Math.PI / 4 + tSec * .3;g.fillRect(x + Math.cos(a) * 24 * s - 2, y + Math.sin(a) * 24 * s - 2, 4, 4);}}
          if (k !== 'clear') {g.fillStyle = k === 'fog' ? '#c8d0d8' : '#eef2f6';for (const [dx, dy, r] of [[-10, 6, 13], [6, 0, 16], [20, 8, 11]]) {g.beginPath();g.arc(x + dx * s + (k === 'fair' ? 12 : 0), y + dy * s, r * s, 0, 7);g.fill();}}
          if (k === 'rain' || k === 'sleet') {g.fillStyle = '#7fc4ff';for (let i = 0; i < 5; i++) g.fillRect(x - 14 * s + i * 8 * s, y + 22 * s + ((tSec * 40 + i * 9) % 14), 2, 7);}
          if (k === 'snow' || k === 'sleet') {g.fillStyle = '#fff';for (let i = 0; i < 5; i++) {g.beginPath();g.arc(x - 12 * s + i * 7 * s, y + 24 * s + ((tSec * 18 + i * 7) % 14), 2, 0, 7);g.fill();}}
        };
        icon(70, 86, kind, 1.3);
        g.fillStyle = '#fff';g.font = 'bold 44px Segoe UI, Arial';g.fillText(temp === null ? '–' : `${temp}°`, 130, 104);
        g.font = '13px Segoe UI, Arial';g.fillText(w ? `${NO_WEATHER[w.kind] || 'skyet'} · vind ${Math.round(w.wind || 0)} m/s` : 'ingen melding', 130, 128, 180);
        g.font = '11px Segoe UI, Arial';g.fillText(w && w.time ? `Gjelder fra kl. ${new Date(w.time).getHours()}` : '', 130, 146);
        g.fillStyle = 'rgba(255,255,255,.15)';g.fillRect(0, 34, CW, 1);
      }
      g.restore();tvTex.needsUpdate = true;
    }

    // ---------- Every frame ----------
    const v3 = new T.Vector3();
    function tick(dt, input, p, camera) {
      if (!game) return;
      const nowMs = now(), tSec = nowMs / 1000;
      // Tap or hold □ on a chair.
      if (pending) {
        const held = performance.now() - pending.t;
        if (!(input && input.held && input.held.square)) {const i = pending.i;pending = null;if (held < HOLD_S * 1000) pickUp(i);else sitOnChair(i);}
        else if (held >= HOLD_S * 1000) {const i = pending.i;pending = null;sitOnChair(i);}
      }
      // The chair in your hands, and chairs others carry.
      if (carrying) {
        if (p.mode !== 'foot') dropBack('The chair goes back to where it was.');
        else {const [pa, pb] = playerWing(p), dist = Math.hypot(pa - carrying.from.a, pb - carrying.from.b);if (dist > 25 || Math.abs(p.feet - FL) > 3) dropBack('You cannot take the chair out of the flat – it is back in its place.');else {const pose = putPose(carrying.ch.kind, pa, pb, faceWing(p.yaw));poseChair(carrying.ch, pose.a, pose.b, pose.y, CARRY_LIFT);}}
      }
      for (const ch of chairs) {
        if (carrying && carrying.ch === ch) continue;
        const r = ch.by && game.remote(ch.by);
        if (r && r.seen) {const [ra, rb] = K.toWing(r.pos.x, r.pos.z), pose = putPose(ch.kind, ra, rb, faceWing(r.yaw));poseChair(ch, pose.a, pose.b, pose.y, CARRY_LIFT);ch.ghost = true;}
        else if (ch.ghost) {ch.ghost = false;poseChair(ch, ch.pose.a, ch.pose.b, ch.pose.y);}
      }
      // Record player: the platter turns, the arm swings, the record shows.
      const lp = state.lp, arm01 = armAt(lp, nowMs), playing = lp && lp.r >= 0;
      disc.visible = !!playing || (!!lp && lp.was >= 0 && arm01 > .02);
      const spin = playing ? Math.min(1, Math.max(0, (nowMs - lp.t) / 1000 - .2)) : 0;platter.rotation.y -= dt * spin * RPM / 60 * Math.PI * 2;
      arm.rotation.y = -.44 * arm01;armLift.rotation.x = -(playing ? (arm01 < 1 || (nowMs - lp.t) / 1000 < ARM_S + .25 ? .06 : 0) : (arm01 > 0 ? .06 : 0));
      // Lava lamp: warmth, blobs, light.
      const warm = lavaWarm(state.lava, nowMs);
      liquid.emissiveIntensity = .05 + .4 * warm;wax.emissiveIntensity = .05 + 1.6 * warm;
      moveBlobs(warm, tSec);
      lavaLight.intensity = K.wing.visible ? warm * (1.5 + .12 * Math.sin(tSec * 1.3)) : 0;
      // TV: the picture (12 times a second, only when somebody can see it), the glow.
      const tvOn = !!state.tv, camNear = K.wing.visible && camera.position.distanceTo(tvLight.getWorldPosition(v3)) < 14;
      screenM.emissiveIntensity = tvOn ? 1.25 : 0;screenM.roughness = tvOn ? .95 : .2;// glossy black when off; no glare from its own glow when on
      if (tvOn && camNear && (tvDrawT -= dt) <= 0) {tvDrawT = 1 / 12;drawTv(tSec);}
      if (tvOn) {tvLight.color.setHex(CHANNELS[state.tv.c].light);tvLight.intensity = K.wing.visible ? 1.1 + .25 * Math.sin(tSec * 7.3) * Math.sin(tSec * 2.1) : 0;} else tvLight.intensity = 0;
      sound(p, camera, tSec, nowMs);
    }
    function sound(p, camera, tSec, nowMs) {
      const ctx = game.audioContext();if (!ctx || ctx.state !== 'running') return;
      const music = game.music;if (!music || !music.recordOutput) return;
      if (!audioState.chain) {audioState.chain = spatial(ctx);music.recordOutput.connect(audioState.chain.input);audioState.tvChain = spatial(ctx);}
      const at = flat.inside(p.x, p.z, p.feet), t = ctx.currentTime, yaw = camera.rotation.y, rx = Math.cos(yaw), rz = -Math.sin(yaw);// the camera's right
      const heard = (wx, wz) => {const dx = wx - p.x, dz = wz - p.z, d = Math.hypot(dx, dz), h = hearing(at, d), side = d > .01 ? (dx * rx + dz * rz) / d : 0;return {...h, pan: Math.max(-.8, Math.min(.8, side * (h.muffle ? .3 : .75)))};};
      // The record: playing in the music engine only while you can hear it (back in step from the lobby's clock).
      const hl = heard(lpWorld.x, lpWorld.z), pos = recordPos(state.lp, nowMs), want = pos !== null && hl.gain > 0 ? RECORDS[state.lp.r].track : null;
      const key = want ? `${want}:${state.lp.t}` : null;
      if (key !== audioState.lpKey) {if (key) music.recordPlay(want, pos, Math.max(0, LEAD_S - ARM_S - .1));else music.recordStop(.4);audioState.lpKey = key;}
      audioState.chain.set(want ? hl.gain * .95 : 0, hl.pan, hl.muffle, t);
      // The TV.
      const ht = heard(tvWorld.x, tvWorld.z), c = state.tv && ht.gain > 0 ? state.tv.c : -1;
      if (c >= 0 && !audioState.tv) audioState.tv = tvSound(ctx, audioState.tvChain.input);
      if (audioState.tv && audioState.tvChannel !== c) {audioState.tv.channel(c);audioState.tvChannel = c;}
      if (audioState.tv) audioState.tv.update(tSec);
      audioState.tvChain.set(c >= 0 ? ht.gain * .8 : 0, ht.pan, ht.muffle, t);
      music.duck(duckFor(want ? hl.gain : 0, c >= 0 ? ht.gain : 0));
    }

    // Collision of the chairs that stand (the carried one is in your hands, not in the way): world polygons.
    function dynamic() {
      const out = [];
      for (const ch of chairs) {if (ch.by || (carrying && carrying.ch === ch)) continue;for (const s of boxesToWing(ch.box, ch.pose.a, ch.pose.b, ch.pose.y, FL)) out.push({points: s.pts.map(([a, b]) => W(a, b)), minY: s.minY, maxY: s.maxY, kind: 'furniture'});}
      return out;
    }
    // game: {now(), you(), send(id, v), notice(text, s), audio(name), sit(spot), sitTaken(id), solidsChanged(), remote(id),
    //   remoteHas(id), nameOf(id), audioContext(), music, weather()}
    function attach(g) {game = g;}
    return {hitboxes, attach, prompt, tick, dynamic, apply, reset, publish, state, chairs, seats, records: RECORDS, channels: CHANNELS,
      get carrying() {return carrying ? carrying.i : null;}, get busy() {return !!carrying || !!pending;},
      debug: {placeCheck: p => carrying ? placeCheck(p) : null, pickUp, putDown, sitOnChair, sitOnSofa, useLp, useTv, useLava, drawTv, lavaLight, tvLight, screen, disc, arm, blobs, blobMesh}};
  }

  return {RECORDS, CHANNELS, ARM_S, LEAD_S, cycle, nextRecord, recordPos, armAt, nextChannel, lavaWarm, CHAIRS, chairParts, chairBoxes, partBounds, boxesToWing, overlap,
    chairsOf, doorZones, canPlace, putPose, snapYaw, seatsOf, hearing, duckFor, items, create};
});
