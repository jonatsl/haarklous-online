/* Oslo S and Jernbanetorget (issue #141): the square in front of the old station, Tigeren, and the people who hang around there.
 * - Tigeren (Elena Engelsen, 2000; OSM node 3578576333 = local (-1468.95, 2811.46)): a 4.5 m bronze tiger striding north along the
 *   front of Østbanehallen, on a low granite plinth. The model is simple (ellipsoids and tubes); sizes from the OSM length tag and photos.
 * - The station front: Oslo Østbanestasjon / Østbanehallen (OSM ways 352083938 and 131419741) were drawn as 9.5 m halls; they become
 *   14 m plastered buildings (prepare), with OSLO S over the projecting middle bay, ØSTBANEHALLEN above glass doors, and the
 *   Trafikanten tower (way 266134986) gets four clock faces that show the real time. The square is paved (a 'paved' area).
 * - Eleven people round the square: on the stone seats with a can or a bottle, sitting against the station wall, standing bent over,
 *   one on the tiger's plinth, one by the Trafikanten tower, and one who asks for a few kroner (□ gives him 10 kr). They only stand,
 *   sit and sway slowly; they are built the first time the camera comes within 230 m and drawn only within 200 m.
 *   They are shown with respect: no names that mock them, nothing to rob, not shooting targets.
 * Places are in the local map frame (x east, s south, metres; OSM / equirectangular like tools/make-district.py).
 * GameOsloS.prepare(districts)      restyles the station buildings and paves the square (before Surroundings.create).
 * GameOsloS.create({T, lib, world, avatars, give, notice}) -> {group, obstacles, floors, hitboxes, tick(dt, camera, player),
 *   prompt(player) -> {text, act} | null, poi(), people, built}
 *   give(kr) -> true when paid (the game's wallet); notice(text, seconds).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameOsloS = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // Tigeren, OSM node 3578576333 (length 4.5 m). It walks north (bearing 20°, along the station front; an estimate from photos).
  const TIGER = {x: -1468.95, s: 2811.46, bearing: 20, length: 4.5, plinth: {w: 1.5, l: 3.5, h: .45}};
  // Jernbanetorget: from the tram tracks on the west to Østbanehallen and Byporten (the buildings and streets are painted over it).
  const SQUARE = [[-1455, 2712], [-1425, 2706], [-1400, 2745], [-1395, 2790], [-1365, 2800], [-1360, 2822], [-1440, 2810], [-1466, 2868],
    [-1480, 2875], [-1497, 2858], [-1497, 2830], [-1482, 2790], [-1465, 2745]];
  // The station buildings on the square: plastered, 14 m (OSM has no height; they were 9.5 m ribbed halls / buff brick).
  const STATION = {w352083938: 14, w131419741: 14};
  // Oslo Østbanestasjon's front to the square (OSM way 352083938): the projecting middle bay and the two wings beside it.
  const FRONT = {bay: [[-1448.5, 2833.2], [-1454.2, 2845.4]], north: [[-1440.8, 2818.6], [-1447.1, 2833.8]], south: [[-1452.6, 2845.9], [-1458.9, 2858.9]]};
  // The Trafikanten tower (OSM way 266134986, 12.3 m).
  const TRAFIKANTEN = {ring: [[-1463.3, 2781.7], [-1463.9, 2779.8], [-1463, 2777.5], [-1461.1, 2777], [-1462.4, 2773.3], [-1466, 2774.7], [-1465.4, 2776.5], [-1466.3, 2778.5], [-1468.3, 2779.2], [-1467, 2782.9]], h: 12.3};
  // The ring of stone seats south-west of the tiger (OSM amenity=bench, material=stone).
  const SEATS = [[-1486.9, 2828.3], [-1482.3, 2830.6], [-1479.2, 2834.2], [-1480.5, 2838.0], [-1480.4, 2842.5], [-1483.4, 2843.6], [-1487.5, 2838.0],
    [-1485.1, 2835.5], [-1489.8, 2835.6], [-1491.6, 2832.7], [-1489.9, 2829.1]];
  const SEAT = {w: .55, h: .45};
  const L = (no, en) => ({no, en});
  const LINES = {
    ask: L('Unnskyld, har du noen kroner?', 'Excuse me, have you got a few kroner?'),
    thanks: L('Tusen takk, du! Ha en fin dag, a.', 'Thanks a lot! Have a nice day.'),
    enough: L('Du er snill, du. Takk skal du ha.', "You're kind, you are. Thank you."),
    day: L('Ha en fin dag, a.', 'Have a nice day.'),
    weather: L('Hei hei. Fint vær i dag, hva?', 'Hi there. Nice weather today, eh?')
  };
  const along = (seg, t, out) => {
    const [a, b] = seg, dx = b[0] - a[0], ds = b[1] - a[1], n = Math.hypot(dx, ds), u = [dx / n, ds / n], o = [-u[1], u[0]];// o: away from the building (west)
    return {x: a[0] + u[0] * t + o[0] * out, s: a[1] + u[1] * t + o[1] * out, face: {x: a[0] + u[0] * t + o[0] * (out + 5), s: a[1] + u[1] * t + o[1] * (out + 5)}};
  };
  // pose: bench (on a seat), ground (on the ground, back to the wall, knees up), nod (standing bent over), ask, stand.
  // hold: can | bottle | cup; sway: they sway slowly (their own merged mesh); say: a line when you walk past.
  const TIGER_SIDE = (() => {const b = TIGER.bearing * Math.PI / 180, fx = Math.sin(b), fs = -Math.cos(b), rx = -fs, rs = fx;// right of the tiger = east side
    return {x: TIGER.x + rx * (TIGER.plinth.w / 2 - .15) - fx * .6, s: TIGER.s + rs * (TIGER.plinth.w / 2 - .15) - fs * .6, face: {x: TIGER.x + rx * 6, s: TIGER.s + rs * 6}};})();// on the plinth's edge
  const PEOPLE = [
    {id: 'asker', pose: 'ask', at: {x: -1462.5, s: 2829.5, face: {x: -1466, s: 2822}}, jacket: 0x2f3e55, hat: 'beanie', hatColor: 0x6b2230, hold: 'cup', sway: true, say: 'ask', thin: true},
    {id: 'seat1', pose: 'bench', at: {x: SEATS[2][0], s: SEATS[2][1], face: {x: -1465, s: 2830}}, jacket: 0x55603a, hat: 'cap', hatColor: 0x2b2b2b, hold: 'can', say: 'day'},
    {id: 'seat2', pose: 'bench', at: {x: SEATS[1][0], s: SEATS[1][1], face: {x: -1468, s: 2826}}, jacket: 0x3a3a3a, beard: 0x9a9a96, hold: 'bottle'},
    {id: 'stand1', pose: 'stand', at: {x: -1481.0, s: 2836.9, face: {x: -1481.2, s: 2832.0}}, jacket: 0x7a5a2a, hat: 'beanie', hatColor: 0x1f1f24, hold: 'can'},
    {id: 'wall1', pose: 'ground', at: along(FRONT.north, 3.5, .5), jacket: 0x3d4a3a, hat: 'beanie', hatColor: 0x77787a, prop: 'backpack'},
    {id: 'wall2', pose: 'nod', at: along(FRONT.north, 7.5, 1.1), jacket: 0x2b2b30, hat: 'hood', sway: true, thin: true},
    {id: 'wall3', pose: 'ground', at: along(FRONT.north, 11.5, .5), jacket: 0x5a4632, hat: 'cap', hatColor: 0x3a3226, prop: 'bedroll', ground: 'bottle'},
    {id: 'wall4', pose: 'ground', at: along(FRONT.south, 4, .5), jacket: 0x6b2a2a, hat: 'beanie', hatColor: 0x1b1b1d, hold: 'bottle', prop: 'bag'},
    {id: 'wall5', pose: 'nod', at: along(FRONT.south, 8.5, 1.2), jacket: 0x4a5058, hat: 'hood', sway: true, thin: true},
    {id: 'tiger1', pose: 'bench', seat: 'plinth', at: TIGER_SIDE, jacket: 0x2d4d5a, hat: 'beanie', hatColor: 0x8a6a2a, hold: 'can'},
    {id: 'traf', pose: 'stand', at: {x: -1461.6, s: 2785.2, face: {x: -1458, s: 2800}}, jacket: 0x3b3b46, beard: 0x6e5a44, hold: 'bottle', say: 'weather'}
  ];
  const CENTRE = {x: -1466, s: 2820};

  function prepare(districts) {
    const d = (districts || []).find(x => x.name === 'gamle-oslo');if (!d) return false;
    for (const b of d.buildings) if (STATION[b.id]) {b.style = 'plaster';b.h = Math.max(b.h, STATION[b.id]);}
    // The paving is painted after the other areas; the small water feature on the square is painted again on top. (Only water is
    // copied: the helipads and the parked cars are planned from the grass, pitch and parking areas, which must not change.)
    const inBox = a => {for (let i = 0; i < a.o.length; i += 2) if (a.o[i] > -1500 && a.o[i] < -1355 && a.o[i + 1] > 2700 && a.o[i + 1] < 2885) return true;return false;};
    const over = d.areas.filter(a => a.k === 'water' && inBox(a));
    d.areas.push({k: 'paved', o: SQUARE.flat(), osloS: true}, ...over.map(a => ({...a, o: a.o.slice()})));
    return true;
  }

  function create({T, lib, world, avatars, give, notice}) {
    const group = new T.Group();group.name = 'Oslo S and Jernbanetorget';
    const W = (x, s) => world.toWorld(x, s), H = (x, z) => world.heightWorld(x, z);
    const yawTo = (p, q) => Math.atan2(-(q.x - p.x), -(q.z - p.z));// a figure at p (world) facing q (-z forward)
    const obstacles = [], floors = [], hitboxes = [];
    const box = (c, yaw, hx, hz, y0, y1, kind = 'oslo-s') => {const cs = Math.cos(yaw), sn = Math.sin(yaw);obstacles.push({points: [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => ({x: c.x + cs * a + sn * b, z: c.z - sn * a + cs * b})), minY: y0, maxY: y1, kind});};
    const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.castShadow = m.receiveShadow = true;parent.add(m);return m;};
    const canvasMat = (w, h, draw, glow = 0) => {const cv = document.createElement('canvas');cv.width = w;cv.height = h;draw(cv.getContext('2d'), w, h);const t = new T.CanvasTexture(cv);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;
      return {mat: new T.MeshStandardMaterial({map: t, roughness: .6, emissive: glow ? 0xffffff : 0x000000, emissiveMap: glow ? t : null, emissiveIntensity: glow}), tex: t, cv};};
    const statics = new T.Group();statics.name = 'Oslo S statics';group.add(statics);

    // ---------- Tigeren ----------
    const tb = TIGER.bearing * Math.PI / 180, t0 = W(TIGER.x, TIGER.s), t1 = W(TIGER.x + Math.sin(tb), TIGER.s - Math.cos(tb));
    const tYaw = Math.atan2(t1.x - t0.x, t1.z - t0.z), tW = (a, c) => ({x: t0.x + a * Math.cos(tYaw) + c * Math.sin(tYaw), z: t0.z - a * Math.sin(tYaw) + c * Math.cos(tYaw)});// model (a, c) -> world, +c = forward
    const P = TIGER.plinth;let hi = -Infinity, lo = Infinity;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {const p = tW(a * P.w / 2, c * P.l / 2), h = H(p.x, p.z);hi = Math.max(hi, h);lo = Math.min(lo, h);}
    const top = hi + P.h, tiger = new T.Group();tiger.position.set(t0.x, top, t0.z);tiger.rotation.y = tYaw;statics.add(tiger);
    const granite = lib.concrete(0x77746f), bronze = lib.metal(0x3d3127, .45);
    mesh(tiger, new T.BoxGeometry(P.w, top - lo + .3, P.l), granite, 0, -(top - lo + .3) / 2, 0);
    {
      const body = new T.Group();
      const blob = (x, y, z, rx, ry, rz, rotX = 0) => {const m = mesh(body, new T.SphereGeometry(1, 22, 14), bronze, x, y, z);m.scale.set(rx, ry, rz);m.rotation.x = rotX;return m;};
      const up = new T.Vector3(0, 1, 0);
      const bone = (a, b, r0, r1) => {const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), m = mesh(body, new T.CylinderGeometry(r1, r0, d.length(), 12), bronze);m.position.copy(A).add(B).multiplyScalar(.5);m.quaternion.setFromUnitVectors(up, d.normalize());mesh(body, new T.SphereGeometry(r1, 12, 8), bronze, ...b);};
      blob(0, .95, .05, .36, .36, .95);blob(0, .8, .05, .3, .26, .75);// trunk and belly
      blob(0, 1.0, .7, .37, .44, .42);blob(.16, 1.27, .6, .14, .12, .22);blob(-.16, 1.25, .66, .14, .12, .22);// chest and the shoulder blades of a prowling cat
      blob(0, 1.0, -.75, .36, .4, .42);blob(.2, .84, -.78, .16, .32, .3);blob(-.2, .84, -.8, .16, .32, .3);// haunches
      blob(0, 1.06, 1.08, .27, .3, .36, -.35);// neck, sloping down to the lowered head
      blob(0, .98, 1.42, .27, .25, .28);blob(.13, .92, 1.42, .14, .14, .16);blob(-.13, .92, 1.42, .14, .14, .16);// head and cheek ruff
      blob(0, .9, 1.66, .15, .13, .16);blob(0, .95, 1.8, .05, .04, .04);blob(0, .8, 1.6, .12, .07, .13);// muzzle, nose, jaw
      for (const sx of [-1, 1]) {const e = blob(sx * .15, 1.2, 1.36, .07, .08, .035);e.rotation.z = -sx * .3;}// ears
      // Legs mid-stride: left fore reaching, right fore under the chest; right hind forward, left hind pushing off.
      bone([-.2, .86, .82], [-.2, .42, .95], .13, .09);bone([-.2, .42, .95], [-.2, .07, 1.08], .09, .075);blob(-.2, .06, 1.12, .11, .06, .14);
      bone([.2, .86, .66], [.2, .42, .62], .13, .09);bone([.2, .42, .62], [.2, .07, .5], .09, .075);blob(.2, .06, .54, .11, .06, .14);
      bone([-.19, .8, -.82], [-.19, .45, -.75], .14, .1);bone([-.19, .45, -.75], [-.19, .27, -1.08], .1, .07);bone([-.19, .27, -1.08], [-.19, .07, -1.0], .07, .065);blob(-.19, .06, -.97, .1, .06, .13);
      bone([.19, .8, -.74], [.19, .45, -.55], .14, .1);bone([.19, .45, -.55], [.19, .26, -.82], .1, .07);bone([.19, .26, -.82], [.19, .07, -.64], .07, .065);blob(.19, .06, -.6, .1, .06, .13);
      const tail = new T.CatmullRomCurve3([[0, 1.05, -1.1], [0, .92, -1.42], [0, .58, -1.7], [0, .32, -1.86], [.02, .24, -2.02], [.06, .34, -2.16]].map(p => new T.Vector3(...p)));
      mesh(body, new T.TubeGeometry(tail, 30, .06, 8), bronze);mesh(body, new T.SphereGeometry(.065, 10, 8), bronze, .06, .34, -2.16);
      // Scale to the real length (4.5 m from the nose to the tip of the tail).
      // (Measured before the body is put on the plinth, so the box is in the tiger's own frame; the paws sink 1 cm into the stone.)
      body.updateMatrixWorld(true);const bb = new T.Box3().setFromObject(body);
      body.scale.setScalar(TIGER.length / (bb.max.z - bb.min.z));body.position.y = -.01;tiger.add(body);
    }
    box(tW(0, 0), tYaw, P.w / 2 + .02, P.l / 2 + .02, lo - .5, top + 1.7, 'sculpture');

    // ---------- The station front: OSLO S, ØSTBANEHALLEN and the doors on the middle bay ----------
    const bayA = W(...FRONT.bay[0]), bayB = W(...FRONT.bay[1]), mid = {x: (bayA.x + bayB.x) / 2, z: (bayA.z + bayB.z) / 2};
    const bayLen = Math.hypot(bayB.x - bayA.x, bayB.z - bayA.z), ux = (bayB.x - bayA.x) / bayLen, uz = (bayB.z - bayA.z) / bayLen;
    const outL = along(FRONT.bay, bayLen / 2, 1), outW = W(outL.x, outL.s), nx = outW.x - mid.x, nz = outW.z - mid.z;// unit normal away from the wall
    const faceYaw = Math.atan2(nx, nz), g0 = H(mid.x + nx * 2, mid.z + nz * 2);
    const plate = (w, h, y, off, mat, back = 0x1c2430) => {
      const side = lib.metal(back, .5), m = mesh(statics, new T.BoxGeometry(w, h, .12), [side, side, side, side, mat, side]);
      m.position.set(mid.x + nx * (off + .06), y, mid.z + nz * (off + .06));m.rotation.y = faceYaw;return m;
    };
    const big = canvasMat(1024, 256, (c, w, h) => {c.fillStyle = '#1c2430';c.fillRect(0, 0, w, h);c.fillStyle = '#ffffff';c.font = 'bold 190px Segoe UI, Arial, sans-serif';c.textAlign = 'center';c.textBaseline = 'middle';c.fillText('OSLO S', w / 2, h / 2 + 8);}, .9);
    plate(7.2, 1.8, g0 + 10.6, .3, big.mat);
    const name = canvasMat(1024, 96, (c, w, h) => {c.fillStyle = '#e9e1cf';c.fillRect(0, 0, w, h);c.fillStyle = '#3a3026';c.font = '600 64px Georgia, Times New Roman, serif';c.textAlign = 'center';c.textBaseline = 'middle';c.fillText('Ø S T B A N E H A L L E N', w / 2, h / 2 + 3);});
    plate(8.5, .8, g0 + 4.7, .25, name.mat, 0xd9d0bc);
    const doors = canvasMat(512, 384, (c, w, h) => {c.fillStyle = '#1d2a30';c.fillRect(0, 0, w, h);c.strokeStyle = '#8c9296';c.lineWidth = 10;for (let k = 0; k < 4; k++) c.strokeRect(10 + k * 123, 10, 115, h - 20);c.fillStyle = 'rgba(255,240,200,.18)';c.fillRect(20, 20, w - 40, h * .35);});
    plate(5.2, 3.3, g0 + 1.65, .1, doors.mat, 0x3b3f42);
    // ---------- The Trafikanten tower: four clock faces near the top, showing the time on this computer ----------
    const tr = TRAFIKANTEN.ring, tc = tr.reduce((a, p) => [a[0] + p[0] / tr.length, a[1] + p[1] / tr.length], [0, 0]);
    const exitDist = (dx, ds) => {let best = 0;for (let i = 0; i < tr.length; i++) {const a = tr[i], b = tr[(i + 1) % tr.length], ex = b[0] - a[0], es = b[1] - a[1], den = dx * es - ds * ex;if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - tc[0]) * es - (a[1] - tc[1]) * ex) / den, u = ((a[0] - tc[0]) * ds - (a[1] - tc[1]) * dx) / den;if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);}return best;};
    const clock = canvasMat(256, 256, () => {}, .35), drawClock = () => {
      const c = clock.cv.getContext('2d'), now = new Date(), hr = now.getHours() % 12 + now.getMinutes() / 60, mn = now.getMinutes();c.clearRect(0, 0, 256, 256);
      c.fillStyle = '#20262b';c.fillRect(0, 0, 256, 256);c.fillStyle = '#f4f1e8';c.beginPath();c.arc(128, 128, 118, 0, 7);c.fill();c.strokeStyle = '#20262b';
      for (let k = 0; k < 12; k++) {const a = k / 12 * Math.PI * 2;c.lineWidth = k % 3 ? 5 : 10;c.beginPath();c.moveTo(128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92);c.lineTo(128 + Math.sin(a) * 110, 128 - Math.cos(a) * 110);c.stroke();}
      const hand = (a, len, w) => {c.lineWidth = w;c.lineCap = 'round';c.beginPath();c.moveTo(128, 128);c.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);c.stroke();};
      hand(hr / 12 * Math.PI * 2, 62, 12);hand(mn / 60 * Math.PI * 2, 96, 7);clock.tex.needsUpdate = true;
    };drawClock();
    {
      const e = tr[5], f = tr[4], a0 = Math.atan2(e[1] - f[1], e[0] - f[0]);
      const tw = W(tc[0], tc[1]), tg = H(tw.x, tw.z);
      for (let k = 0; k < 4; k++) {
        const a = a0 + Math.PI / 2 + k * Math.PI / 2, dx = Math.cos(a), ds = Math.sin(a), r = exitDist(dx, ds);if (!r) continue;
        const p = W(tc[0] + dx * (r + .16), tc[1] + ds * (r + .16)), q = W(tc[0] + dx * (r + 1), tc[1] + ds * (r + 1)), yaw = Math.atan2(q.x - p.x, q.z - p.z);
        const rim = mesh(statics, new T.CylinderGeometry(.95, .95, .1, 32), lib.metal(0x20262b, .5));rim.rotation.set(Math.PI / 2, 0, 0, 'YXZ');rim.rotation.y = yaw;rim.position.set(p.x, tg + TRAFIKANTEN.h - 2.1, p.z);
        const face = mesh(statics, new T.CircleGeometry(.88, 32), clock.mat);face.rotation.y = yaw;
        face.position.set(p.x + (q.x - p.x) / Math.hypot(q.x - p.x, q.z - p.z) * .1, tg + TRAFIKANTEN.h - 2.1, p.z + (q.z - p.z) / Math.hypot(q.x - p.x, q.z - p.z) * .1);
        face.castShadow = false;face.userData.noMerge = true;
      }
    }
    // ---------- The stone seats ----------
    const seatTop = [];
    SEATS.forEach(([x, s], i) => {const p = W(x, s), g = H(p.x, p.z), yaw = i * 1.3;mesh(statics, new T.BoxGeometry(SEAT.w, SEAT.h + .3, SEAT.w), granite, p.x, g + (SEAT.h - .3) / 2, p.z).rotation.y = yaw;seatTop.push(g + SEAT.h);box(p, yaw, SEAT.w / 2, SEAT.w / 2, g - .3, g + SEAT.h);});
    statics.updateMatrixWorld(true);lib.mergeStatic(statics, o => !!o.userData.noMerge);

    // ---------- The people (walk solids now; the figures when the camera first comes near) ----------
    const people = PEOPLE.map(d => {
      const p = W(d.at.x, d.at.s), f = W(d.at.face.x, d.at.face.s), yaw = yawTo(p, f);
      const seatIdx = SEATS.findIndex(([x, s]) => Math.hypot(x - d.at.x, s - d.at.s) < .05);
      const ground = H(p.x, p.z), y = d.seat === 'plinth' ? top : seatIdx >= 0 ? seatTop[seatIdx] : ground;
      if (d.pose === 'ground') {const c = Math.cos(yaw), sn = Math.sin(yaw);box({x: p.x - sn * .3, z: p.z - c * .3}, yaw, .3, .45, ground - .3, ground + 1.0);}
      else if (d.pose !== 'bench') box(p, yaw, .25, .25, ground - .3, ground + 1.8);
      else if (d.seat !== 'plinth') {const c = Math.cos(yaw), sn = Math.sin(yaw);box({x: p.x - sn * .3, z: p.z - c * .3}, yaw, .25, .22, ground - .3, ground + 1.2);}
      return {...d, x: p.x, z: p.z, y, ground, yaw, baseYaw: yaw, av: null, g: null, sayT: 0, phase: (d.x || p.x) * 1.7 % 6.28};
    });
    const crowd = new T.Group();crowd.name = 'Oslo S people';crowd.visible = false;group.add(crowd);
    let built = false, given = 0;
    const centreW = W(CENTRE.x, CENTRE.s), eyeM = new T.MeshStandardMaterial({color: 0x222222});
    const mats = {can: new T.MeshStandardMaterial({color: 0xc8ccd0, roughness: .3, metalness: .7}), canBand: new T.MeshStandardMaterial({color: 0x2f6d3a, roughness: .4, metalness: .4}),
      glass: new T.MeshStandardMaterial({color: 0x2f5a2c, roughness: .15, metalness: .1}), cup: new T.MeshStandardMaterial({color: 0xe8e2d4, roughness: .8}),
      bag: lib.fabric(0x26303a), bed: lib.fabric(0x4f5a3a), plastic: new T.MeshStandardMaterial({color: 0xf1f1ec, roughness: .9}), beard: {}};
    const hatMats = new Map(), hatMat = c => {if (!hatMats.has(c)) hatMats.set(c, lib.fabric(c));return hatMats.get(c);};
    function rig(av) {
      const head = av.joints.head, neck = head.parent, torso = neck.parent, hips = torso.parent;
      const legs = hips.children.filter(c => c.isGroup && c !== torso).map(hip => ({hip, kn: hip.children.find(c => c.isGroup)}));
      const bottle = av.joints.R.el.children.find(c => c.isGroup);return {head, neck, torso, hips, legs, L: av.joints.L, R: av.joints.R, bottle};
    }
    function pose(av, d) {
      const beer = d.hold === 'can' || d.hold === 'bottle';
      av.pose({stance: d.pose === 'bench' ? 'sit' : 'stand', beer});
      const r = rig(av);
      if (d.hold === 'can' && r.bottle) {r.bottle.visible = false;const c = mesh(r.R.el, new T.CylinderGeometry(.033, .033, .12, 12), mats.can, 0, -.31, -.03);c.rotation.x = .2;mesh(c, new T.CylinderGeometry(.0335, .0335, .05, 12), mats.canBand, 0, 0, 0);}
      if (d.pose === 'bench') {r.torso.rotation.x = -.14;r.neck.rotation.x = -.25;}
      else if (d.pose === 'ground') {
        r.hips.position.y = .14;r.torso.rotation.x = .22;r.neck.rotation.x = -.5;
        r.legs.forEach((l, i) => {l.hip.rotation.set(2.0, 0, i ? .14 : -.14);l.kn.rotation.x = -1.2;});
        r.L.sh.rotation.x = .75;r.L.el.rotation.x = .7;if (beer) {r.R.sh.rotation.x = .45;r.R.el.rotation.x = 1.25;} else {r.R.sh.rotation.x = .75;r.R.el.rotation.x = .7;}
      } else if (d.pose === 'nod') {
        r.hips.position.y = .9;r.torso.rotation.x = -.5;r.neck.rotation.x = -.55;r.legs.forEach(l => {l.hip.rotation.x = .25;l.kn.rotation.x = -.45;});
        for (const a of [r.L, r.R]) {a.sh.rotation.x = .6;a.el.rotation.x = .15;}
      } else if (d.pose === 'ask') {
        r.torso.rotation.x = -.12;r.neck.rotation.x = -.15;r.R.sh.rotation.x = .85;r.R.el.rotation.x = .35;r.L.sh.rotation.x = .25;r.L.el.rotation.x = 1.0;
        if (d.hold === 'cup') mesh(r.L.el, new T.CylinderGeometry(.045, .035, .1, 12), mats.cup, 0, -.32, -.03);
      } else r.torso.rotation.x = -.05;
      return r;
    }
    function dress(r, d) {
      const head = r.head, hm = d.hat ? hatMat(d.hatColor ?? d.jacket) : null;
      if (d.hat === 'beanie') {mesh(head, new T.SphereGeometry(.126, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), hm, 0, .045, .01);mesh(head, new T.TorusGeometry(.115, .02, 6, 16), hm, 0, .05, .01).rotation.x = Math.PI / 2;}
      if (d.hat === 'cap') {mesh(head, new T.SphereGeometry(.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * .45), hm, 0, .05, 0);mesh(head, new T.BoxGeometry(.2, .02, .12), hm, 0, .07, -.13);}
      if (d.hat === 'hood') {const h = mesh(head, new T.SphereGeometry(.16, 14, 10, 0, Math.PI * 2, 0, Math.PI * .62), lib.fabric(d.jacket), 0, .02, .035);h.rotation.x = -.35;}
      if (d.beard) {if (!mats.beard[d.beard]) mats.beard[d.beard] = new T.MeshStandardMaterial({color: d.beard, roughness: 1});const b = mesh(head, new T.SphereGeometry(.085, 10, 8), mats.beard[d.beard], 0, -.06, -.07);b.scale.set(1.1, .9, .6);}
    }
    function props(g, d) {
      // Things beside them on the ground, in the figure's frame (it faces -z; +x is on its right).
      if (d.prop === 'backpack') {const b = mesh(g, new T.BoxGeometry(.32, .42, .2), mats.bag, .45, .21, .05);b.rotation.y = .3;}
      if (d.prop === 'bedroll') {const b = mesh(g, new T.CylinderGeometry(.16, .16, .7, 14), mats.bed, -.5, .16, .1);b.rotation.set(0, .2, Math.PI / 2);}
      if (d.prop === 'bag') {const b = mesh(g, new T.BoxGeometry(.28, .32, .14), mats.plastic, .42, .16, -.05);b.rotation.y = -.4;}
      if (d.ground === 'bottle') {const b = mesh(g, new T.CylinderGeometry(.03, .032, .2, 10), mats.glass, -.32, .1, -.35);mesh(b, new T.CylinderGeometry(.012, .02, .08, 8), mats.glass, 0, .13, 0);}
    }
    function build() {
      built = true;
      for (const p of people) {
        const av = avatars.avatar(7, '', p.jacket), g = av.group;g.position.set(p.x, p.y + (p.pose === 'bench' ? .02 : 0), p.z);g.rotation.y = p.yaw;
        const r = pose(av, p);dress(r, p);props(g, p);if (p.thin) g.scale.set(.88, 1, .88);
        g.traverse(o => {if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0x222222 && !o.material.map) o.material = eyeM;if (o.isMesh && o.parent === r.head) o.castShadow = false;});
        for (const c of g.children) if (c.isSprite) c.visible = false;// no name tags
        p.av = av;p.g = g;p.r = r;crowd.add(g);
        if (p.sway) {g.updateMatrixWorld(true);lib.mergeStatic(g);}
      }
      // The others never move: one merged set of meshes for all of them.
      crowd.updateMatrixWorld(true);lib.mergeStatic(crowd, o => {for (let q = o; q && q !== crowd; q = q.parent) if (q.userData.merged || people.some(p => p.sway && p.g === q)) return true;return false;});
    }
    let clockT = 0, time = 0;
    function tick(dt, camera, player) {
      const cam = camera.position, d = Math.hypot(cam.x - centreW.x, cam.z - centreW.z);
      if (d < 500) {clockT -= dt;if (clockT <= 0) {clockT = 20;drawClock();}}
      if (!built && d < 230) build();
      crowd.visible = built && d < 200;if (!crowd.visible) return;
      time += dt;
      for (const p of people) {
        const dx = player.x - p.x, dz = player.z - p.z, pd = Math.hypot(dx, dz);
        if (p.sway) {p.g.rotation.z = Math.sin(time * .55 + p.phase) * .028;p.g.rotation.x = Math.sin(time * .37 + p.phase * 1.3) * .018;}
        // The one asking for money turns a little toward you while you are close.
        if (p.id === 'asker') {let want = p.baseYaw;if (pd < 7) want = Math.atan2(-dx, -dz);let a = want - p.g.rotation.y;a = Math.atan2(Math.sin(a), Math.cos(a));p.g.rotation.y += a * Math.min(1, dt * 1.5);}
        p.sayT = Math.max(0, p.sayT - dt);
        if (p.say && pd < 4.5 && p.sayT <= 0 && player.mode === 'foot') {
          const line = LINES[p.say];p.av.say(line.no);p.sayT = 30;
          if (p.id === 'asker') notice(`«${line.no}» (${line.en}) · □ give 10 kr`, 4);
        }
        p.av.update(dt, camera, false);
      }
    }
    function prompt(player) {
      if (!built || !crowd.visible || player.mode !== 'foot') return null;
      const a = people.find(p => p.id === 'asker');if (Math.hypot(player.x - a.x, player.z - a.z) > 2.4 || Math.abs(player.feet - a.ground) > 1.5) return null;
      return {text: given ? `□ Give him another 10 kr (you have given ${given * 10} kr)` : '□ Give the man asking for change 10 kr', act: () => {
        if (!give(10)) {notice("You don't have 10 kr to give.", 2.5);return;}
        given++;const line = given >= 3 ? LINES.enough : LINES.thanks;a.av.say(line.no);a.sayT = 40;notice(`You gave 10 kr. «${line.no}» (${line.en})`, 4);
      }};
    }
    function poi() {
      const b = along(FRONT.bay, 6.7, 0);
      return [{x: TIGER.x, s: TIGER.s, color: '#6b4a22', label: 'Tigeren', glyph: '◉'}, {x: b.x + 25, s: b.s + 5, color: '#7a1f1f', label: 'Oslo S', glyph: '🚉'}];
    }
    group.updateMatrixWorld(true);
    return {group, obstacles, floors, hitboxes, tick, prompt, poi, people, tiger: {x: t0.x, z: t0.z, top, yaw: tYaw}, get built() {return built;}, get given() {return given;}, build};
  }
  return {TIGER, SQUARE, STATION, FRONT, TRAFIKANTEN, SEATS, PEOPLE, LINES, prepare, create, along};
});
