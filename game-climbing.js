/* Klatreverket Torshov (issue #40): the climbing centre at Myrens verksted 3K, 0476 Oslo, in its real building (OSM way
 * 1031709261, shared with Myrens Treningssenter). Heights are Kartverket's: the hall wing is 60.2 × 19.8 m and its eaves are
 * 14.5 m above the floor, so the hall's walls are 14 m like the real ones. Facts from klatreverket.no (Nov 2026):
 * - Hallen: 14 m walls of different steepness, top-ropes on about half of the routes; Konkurranseveggen: 14 m high and 7 m
 *   overhanging, lead only; Galleriet (beginners) and Kursrommet: 10 m walls with top-ropes on every route; the autobelay
 *   tower (2026): six 14 m lines from the ground floor.
 * - Bouldering on three floors: Hula (ground floor, a roof cave with only the easier grades), Discorommet (2nd floor, low
 *   3.5 m walls, easier problems) with the slab corner, the inner room (3rd floor, steeper walls, harder problems); the
 *   training room innerst og øverst (4th floor): Moonwall 40°, Vippevegg 0–50°, system wall, technique corner, campus board.
 * - Rules: everyone may boulder and use the autobelays (after a short autobelay introduction); whoever belays on a rope needs a
 *   brattkort. Prices: entry 155 kr before 16 on weekdays, 175 kr after 16 and at weekends; rent shoes 50, harness 50,
 *   chalk 20, all of it without a rope 100. The brattkort test can be taken when the climbing staff is on duty (after 17 on
 *   weekdays, after 11 at weekends). Opening hours (OpenStreetMap): Mo–Th 07–23, Fr 07–21, Sa–Su 09–20.
 * Routes are set by a seeded generator, so every computer in a lobby has the same holds. Rope grades use the Norwegian scale,
 * boulders the Fontainebleau scale (the scales used in Norway).
 * GameClimbing.prepare(districts)  – before Surroundings.create: this module builds OSM way 1031709261 itself.
 * GameClimbing.create({T, lib, data, toWorld, avatars, audio}) -> gym (see the end of create()).
 * Pure parts for Node tests: priceAt, staffedAt, openAt, gradeName, makeRoutes, faceAt, classify, Climber, leadCatch.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameClimbing = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // ---------- Facts and rules ----------
  const PRICES = {entryDay: 155, entryEvening: 175, shoes: 50, harness: 50, chalk: 20, pack: 100, brattkortDay: 150, brattkortEvening: 100};
  const weekday = d => {const w = d.getDay();return w >= 1 && w <= 5;};
  const hourOf = d => d.getHours() + d.getMinutes() / 60;
  // Entry: the day price before 16 on weekdays, the evening price after 16 and at weekends.
  const priceAt = d => weekday(d) && hourOf(d) < 16 ? PRICES.entryDay : PRICES.entryEvening;
  const brattkortPriceAt = d => weekday(d) && hourOf(d) < 16 ? PRICES.brattkortDay : PRICES.brattkortEvening;
  // The climbing staff (klatrevakt) is on duty after 17 on weekdays and after 11 at weekends; only then can the test be taken.
  const staffedAt = d => hourOf(d) >= (weekday(d) ? 17 : 11);
  const HOURS = 'Mo–Th 07–23 · Fr 07–21 · Sa–Su 09–20';
  const openAt = d => {const w = d.getDay(), h = hourOf(d);return w >= 1 && w <= 4 ? h >= 7 && h < 23 : w === 5 ? h >= 7 && h < 21 : h >= 9 && h < 20;};
  const ROPE_GRADES = ['3', '4-', '4', '4+', '5-', '5', '5+', '6-', '6', '6+', '7-', '7', '7+', '8-', '8', '8+'];
  const BOULDER_GRADES = ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B'];
  const gradeName = (kind, d) => {const g = kind === 'boulder' || kind === 'moon' ? BOULDER_GRADES : ROPE_GRADES;return g[Math.max(0, Math.min(g.length - 1, Math.round(d * (g.length - 1))))];};
  const COLOURS = [['Red', 0xd32f2f], ['Blue', 0x1d5fc4], ['Green', 0x2e9e44], ['Yellow', 0xf2c418], ['Orange', 0xf07a1a], ['Pink', 0xf06fa8], ['Purple', 0x7d3fb0], ['White', 0xf0efea], ['Black', 0x252629], ['Teal', 0x18a7a0]];
  const STYLE = {boulder: 'boulder', rope: 'top rope', lead: 'lead', auto: 'autobelay', moon: 'Moonwall', campus: 'campus board'};
  // Hold shapes: grip difficulty q (0 = a bucket, 1 = unusable for hands) and size (across, up, out) in metres.
  const HOLDS = {jug: {q: .12, s: [.17, .11, .09]}, edge: {q: .38, s: [.16, .05, .045]}, crimp: {q: .66, s: [.11, .032, .03]}, sloper: {q: .56, s: [.17, .15, .06]},
    pinch: {q: .5, s: [.07, .17, .07]}, pocket: {q: .54, s: [.09, .09, .065]}, volume: {q: .3, s: [.42, .3, .2]}, rung: {q: .45, s: [.5, .03, .04]}, foot: {q: 1, s: [.05, .035, .03]}};
  const LEVELS = [0, 3.4, 7.4, 11.0], SLAB = .25, CEILING = 14.3;
  // The walls in the hall frame: a = metres along the south-west wall from the south corner, b = metres into the building,
  // y up from the level's floor. A face rises from its base line p0 -> p1 in segments [length along the surface, degrees of
  // overhang] (+ leans out over the climber, - is a slab); the climbing side is n = (-dir.b, dir.a).
  // d = the range of difficulty (0 = the easiest grade, 1 = the hardest), tr = which lanes have a top-rope hanging.
  const WALLS = [
    {id: 'h1', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [15.5, .32], p1: [21.5, .32], segs: [[14, 0]], lanes: 3, d: [.15, .55], tr: [1, 0, 1]},
    {id: 'h2', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [21.5, 2.29], p1: [27.5, 2.29], segs: [[14.14, -8]], lanes: 3, d: [.05, .45], tr: [0, 1, 0]},
    {id: 'h3', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [27.5, .32], p1: [33.5, .32], segs: [[14.22, 10]], lanes: 3, d: [.35, .75], tr: [1, 0, 1]},
    {id: 'h4a', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [33.5, .32], p1: [36.5, 1.6], segs: [[14, 0]], lanes: 2, d: [.3, .65], tr: [0, 1]},
    {id: 'h4b', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [36.5, 1.6], p1: [39.5, .32], segs: [[14, 0]], lanes: 2, d: [.3, .65], tr: [1, 0]},
    {id: 'h5', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [39.5, .32], p1: [45.5, .32], segs: [[7, 0], [7.4, 20]], lanes: 3, d: [.45, .85], tr: [1, 0, 0]},
    {id: 'h6', zone: 'Hallen', kind: 'rope', lvl: 0, p0: [45.5, .32], p1: [51.5, .32], segs: [[14.05, 5]], lanes: 3, d: [.3, .7], tr: [0, 1, 0]},
    {id: 'comp', zone: 'Konkurranseveggen', kind: 'lead', lvl: 0, p0: [59.89, 2], p1: [59.89, 18], segs: [[15.65, 26.57]], lanes: 7, d: [.55, 1]},
    {id: 'gal', zone: 'Galleriet', kind: 'rope', lvl: 0, p0: [41.5, 19.43], p1: [23.5, 19.43], segs: [[10, 0]], lanes: 8, d: [0, .45], tr: 'all'},
    {id: 'kurs', zone: 'Kursrommet', kind: 'rope', lvl: 0, p0: [50.5, 18.38], p1: [41.5, 18.38], segs: [[10.05, -6]], lanes: 5, d: [0, .5], tr: 'all'},
    {id: 'abA', zone: 'Autobelay', kind: 'auto', lvl: 0, p0: [21.5, 11.5], p1: [16.5, 11.5], segs: [[14, 0]], lanes: 3, d: [.1, .5]},
    {id: 'abB', zone: 'Autobelay', kind: 'auto', lvl: 0, p0: [21.5, 16.5], p1: [21.5, 11.5], segs: [[14.05, 5]], lanes: 3, d: [.2, .6]},
    {id: 'hula1', zone: 'Hula', kind: 'boulder', lvl: 0, p0: [.32, 16.1], p1: [.32, 8.8], segs: [[1, 0], [2.6, 50]], lanes: 4, d: [0, .35]},
    {id: 'hula2', zone: 'Hula', kind: 'boulder', lvl: 0, p0: [11.7, 16.33], p1: [3.2, 16.33], segs: [[1.2, 0], [2.4, 45]], lanes: 4, d: [0, .35]},
    {id: 'disco1', zone: 'Discorommet', kind: 'boulder', lvl: 1, p0: [.32, 16.1], p1: [.32, 4.2], segs: [[3.5, 5]], lanes: 6, d: [.05, .5]},
    {id: 'sva1', zone: 'Svahjørnet', kind: 'boulder', lvl: 1, p0: [1.04, 4.0], p1: [1.04, 1.04], segs: [[3.58, -12]], lanes: 2, d: [.1, .45]},
    {id: 'sva2', zone: 'Svahjørnet', kind: 'boulder', lvl: 1, p0: [1.04, 1.04], p1: [5.0, 1.04], segs: [[3.58, -12]], lanes: 2, d: [.1, .45]},
    {id: 'disco2', zone: 'Discorommet', kind: 'boulder', lvl: 1, p0: [5.2, .32], p1: [11.8, .32], segs: [[3.55, 10]], lanes: 3, d: [.2, .6]},
    {id: 'inner1', zone: 'Det innerste rommet', kind: 'boulder', lvl: 2, p0: [.32, 16.1], p1: [.32, .6], segs: [[.6, 0], [3.1, 30]], lanes: 7, d: [.4, .95]},
    {id: 'inner2', zone: 'Det innerste rommet', kind: 'boulder', lvl: 2, p0: [2.2, .32], p1: [11.8, .32], segs: [[.5, 0], [3.6, 40]], lanes: 5, d: [.5, 1]},
    {id: 'moon', zone: 'Moonwall', kind: 'moon', lvl: 3, p0: [.32, 3.1], p1: [.32, .66], segs: [[.3, 0], [3.15, 40]], lanes: 1, d: [.45, .95]},
    {id: 'vipp', zone: 'Vippevegg', kind: 'boulder', lvl: 3, p0: [.32, 6.6], p1: [.32, 4.0], segs: [[3.0, 30]], lanes: 2, d: [.3, .6], tilt: [0, 50]},
    {id: 'system', zone: 'Systemvegg', kind: 'boulder', lvl: 3, p0: [.32, 11.0], p1: [.32, 7.4], segs: [[.3, 0], [3.0, 45]], lanes: 3, d: [.45, .8]},
    {id: 'tek', zone: 'Teknikkhjørnet', kind: 'boulder', lvl: 3, p0: [2.6, .32], p1: [11.8, .32], segs: [[3.2, 0]], lanes: 10, perLane: 2, d: [.05, .55]},
    {id: 'campus', zone: 'Campusbrett', kind: 'campus', lvl: 3, p0: [8.6, 17.84], p1: [3.4, 17.84], segs: [[2.6, 15]], lanes: 1, d: [.6, .6]}
  ];

  // ---------- Small maths ----------
  const v3 = (x = 0, y = 0, z = 0) => ({x, y, z});
  const add = (a, b, k = 1) => v3(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = a => Math.hypot(a.x, a.y, a.z);
  const norm = a => {const l = len(a) || 1;return v3(a.x / l, a.y / l, a.z / l);};
  const mix = (a, b, t) => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  const dist = (a, b) => len(sub(a, b));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) {let s = seed >>> 0;return () => {s = (s + 0x6D2B79F5) >>> 0;let t = s;t = Math.imul(t ^ (t >>> 15), t | 1);t ^= t + Math.imul(t ^ (t >>> 7), t | 61);return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};}
  const hash = s => {let h = 2166136261;for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);return h >>> 0;};

  // ---------- Faces: a point on a wall in the hall frame (x across from p0, s along the surface from the base) ----------
  function faceInfo(w) {
    const dx = w.p1[0] - w.p0[0], db = w.p1[1] - w.p0[1], W = Math.hypot(dx, db), dir = {a: dx / W, b: db / W}, n = {a: -dir.b, b: dir.a};
    let L = 0, H = 0, out = 0;for (const [l, deg] of w.segs) {const r = deg * Math.PI / 180;L += l;H += l * Math.cos(r);out += l * Math.sin(r);}
    return {...w, W, dir, n, L, H, out, y0: LEVELS[w.lvl]};
  }
  // -> {p: {a, y, b}, up (unit, along the surface), nrm (unit, out of the wall), deg}
  function faceAt(f, x, s) {
    let a = f.p0[0] + f.dir.a * x, b = f.p0[1] + f.dir.b * x, y = f.y0, left = Math.max(0, s), deg = f.segs[0][1];
    for (let i = 0; i < f.segs.length; i++) {
      const [l, d] = f.segs[i], r = d * Math.PI / 180, t = i === f.segs.length - 1 ? left : Math.min(left, l);deg = d;
      a += f.n.a * Math.sin(r) * t;b += f.n.b * Math.sin(r) * t;y += Math.cos(r) * t;left -= t;if (left <= 0 && i < f.segs.length - 1) break;
    }
    const r = deg * Math.PI / 180;
    return {p: {a, y, b}, up: {a: f.n.a * Math.sin(r), y: Math.cos(r), b: f.n.b * Math.sin(r)}, nrm: {a: f.n.a * Math.cos(r), y: -Math.sin(r), b: f.n.b * Math.cos(r)}, deg};
  }
  // How hard the wall angle makes hanging on: slab .15, vertical .35, 20° .8, 40° 1.25, 50° 1.45.
  const steepness = deg => clamp(.35 + deg * .023, .15, 1.6);

  // ---------- Route setting ----------
  // Every face gets `lanes` lines (two interleaved problems per lane on the technique corner). The start hold is taped, the top
  // hold is marked TOP; rope routes get bolts with quickdraws every 1.0–1.3 m and two anchor rings above the top hold.
  function pickType(r, d, deg) {
    const w = {jug: Math.max(.06, 1 - 1.35 * d), edge: .32 + .1 * d, crimp: 1.3 * d * d, sloper: (.12 + .45 * d) * (deg > 25 ? .6 : 1), pinch: .1 + .35 * d, pocket: .05 + .22 * d};
    let t = r() * Object.values(w).reduce((a, b) => a + b, 0);for (const [k, v] of Object.entries(w)) {if ((t -= v) <= 0) return k;}return 'jug';
  }
  function makeRoutes(seed = 40) {
    const faces = WALLS.map(faceInfo), routes = [], holds = [];let ci = 0;
    const put = (route, f, x, s, type, extra = {}) => {const h = {id: holds.length, route: route ? route.id : -1, face: f.id, x, s, type, q: HOLDS[type].q, rot: 0, ...extra};holds.push(h);if (route) route.holds.push(h.id);return h;};
    for (const f of faces) {
      const r = rng(seed * 7919 + hash(f.id)), lanes = f.lanes, per = f.perLane || 1, wLane = f.W / lanes;
      if (f.kind === 'moon') {moonBoard(f, r, routes, holds, put);continue;}
      if (f.kind === 'campus') {campusBoard(f, routes, put);continue;}
      for (let li = 0; li < lanes; li++) for (let k = 0; k < per; k++) {
        const idx = li * per + k, n = lanes * per, d = clamp(lerp(f.d[0], f.d[1], n > 1 ? ((idx * 7) % n) / (n - 1) : .5) + (r() - .5) * .08, 0, 1);
        const colour = COLOURS[ci++ % COLOURS.length], kind = f.kind === 'rope' && Array.isArray(f.tr) && !f.tr[li] ? 'lead' : f.kind;
        const route = {id: routes.length, face: f.id, zone: f.zone, kind, d, grade: gradeName(kind, d), colour: colour[0], hex: colour[1], holds: [], bolts: [], toprope: f.kind === 'rope' && (f.tr === 'all' || (Array.isArray(f.tr) && !!f.tr[li])), lane: [li * wLane, (li + 1) * wLane]};
        route.name = `${route.colour} ${route.grade}`;routes.push(route);
        const x0 = li * wLane + .14, x1 = (li + 1) * wLane - .14, mid = (x0 + x1) / 2 + (per > 1 ? (k ? .2 : -.2) : 0), top = f.L - (kind === 'boulder' ? .32 : .55);
        let s = kind === 'boulder' ? 1.15 + r() * .3 : 1.3 + r() * .3, side = r() < .5 ? -1 : 1;
        // Start: one big start hold for the easier lines, two for the harder ones (both hands, taped).
        if (d < .45) put(route, f, mid, s, 'jug', {start: true});
        else {put(route, f, clamp(mid - .2, x0, x1), s, pickType(r, d * .6, 0), {start: true});put(route, f, clamp(mid + .2, x0, x1), s + (r() - .5) * .15, pickType(r, d * .6, 0), {start: true});}
        put(route, f, clamp(mid + (r() - .5) * .4, x0, x1), Math.max(.25, s - .85), 'foot');
        let sinceRest = 0;
        while (s < top - .25) {
          const step = lerp(.42, .86, d) + (r() - .5) * .16;s = Math.min(top - .2, s + step);side = -side;sinceRest += step;
          const x = clamp(mid + side * (.1 + r() * lerp(.16, .38, d)), x0, x1), info = faceAt(f, x, s), rest = kind !== 'boulder' && sinceRest > 4.5 && d > .35;
          put(route, f, x, s, rest ? 'jug' : info.deg > 45 && r() < .5 ? 'jug' : pickType(r, d, info.deg), {rot: (r() - .5) * 1.2});if (rest) sinceRest = 0;
          if (r() < lerp(.95, .55, d)) put(route, f, clamp(x - side * (.22 + r() * .12), x0, x1), s - .5 - r() * .25, r() < .2 ? 'volume' : 'foot');
        }
        put(route, f, clamp(mid + (r() - .5) * .3, x0, x1), top, d > .7 ? 'edge' : 'jug', {top: true});
        if (kind !== 'boulder') {
          for (let y = 2.3; y < top - .4; y += 1.0 + r() * .3) route.bolts.push({x: clamp(mid + .32, x0 + .05, x1), s: y});
          route.anchor = {x: mid, s: top + .32};
        }
      }
    }
    return {faces, routes, holds};
  }
  // The Moonwall: 11 columns (A–K) × 18 rows of holds on a 40° board above a kicker, and problems lit by LEDs (green start, blue
  // moves, red finish). The problems here are the gym's own set, not the MoonBoard app's.
  function moonBoard(f, r, routes, holds, put) {
    const grid = [];
    for (let row = 0; row < 18; row++) for (let col = 0; col < 11; col++) {
      if (r() < .34) continue;const x = .2 + col * .204, s = .5 + row * .165;
      grid.push(put(null, f, x, s, ['crimp', 'edge', 'pinch', 'pocket', 'sloper', 'jug'][Math.floor(r() * (row < 3 ? 6 : 5.3))], {grid: [col, row], hex: [0xf1efe8, 0x26272a, 0xf2c418][Math.floor(r() * 3)], rot: (r() - .5) * 1.6}));
    }
    for (let i = 0; i < 8; i++) {
      const d = lerp(f.d[0], f.d[1], i / 7), route = {id: routes.length, face: f.id, zone: f.zone, kind: 'moon', d, grade: gradeName('moon', d), colour: 'LED', hex: 0x42a5f5, holds: [], bolts: [], name: `Torshov ${i + 1} · ${gradeName('moon', d)}`, moon: true};
      routes.push(route);let col = 2 + Math.floor(r() * 7), row = 1, last = null;const pick = (c, rw) => grid.filter(h => Math.abs(h.grid[0] - c) <= 2 && Math.abs(h.grid[1] - rw) <= 1).sort((a, b) => Math.abs(a.grid[0] - c) + Math.abs(a.grid[1] - rw) - Math.abs(b.grid[0] - c) - Math.abs(b.grid[1] - rw))[0];
      const seq = [];while (row < 17) {const h = pick(col, row);if (h && h !== last) {seq.push(h);last = h;}row += 2 + Math.round(d * 2 + r());col = clamp(col + Math.round((r() - .5) * 5), 0, 10);}
      const topH = pick(col, 17);if (topH && topH !== last) seq.push(topH);
      seq.forEach((h, k) => {route.holds.push(h.id);h.moon = h.moon || {};h.moon[route.id] = k === 0 ? 'start' : k === seq.length - 1 ? 'top' : 'move';});
      route.startHolds = [seq[0].id];route.topHold = seq[seq.length - 1].id;
    }
  }
  // Campus board: one ladder of wide wooden rungs 22 cm apart; no footholds, so your feet hang and every move is from the arms.
  function campusBoard(f, routes, put) {
    const route = {id: routes.length, face: f.id, zone: f.zone, kind: 'campus', d: .6, grade: '1-9', colour: 'Wood', hex: 0xc69c6d, holds: [], bolts: [], name: 'Campus ladder 1-9'};routes.push(route);
    for (let i = 0; i < 9; i++) put(route, f, f.W / 2, 1.0 + i * .22, 'rung', {start: i === 0, top: i === 8, hex: 0xc69c6d});
  }

  // ---------- The climber ----------
  // World-space logic, no THREE: holds are {p, n (out of the wall), up (along the wall), ax (across), q, hand, route}.
  // Grips: hold a trigger to keep a hand on its hold; let go to free it, aim at the next hold and grip again to reach.
  const REACH = 1.72, DYNO = 2.4, STAND = 2.3, LEAP = 2.95;
  // Can this hand reach that hold from where the climber is?  'reach' | 'dyno' (jump for it with ✕) | 'far' | 'foot' (a foothold)
  function classify(c, side, h) {
    if (!h.hand) return 'foot';
    const other = c.hands[side === 'L' ? 'R' : 'L'].hold;
    if (!other) {const sh = add(c.hip, c.up, .48), d = dist(sh, h.p);return d <= 1.05 ? 'reach' : d <= 1.5 ? 'dyno' : 'far';}
    // On a steep overhang you hang below the holds and cannot stretch as far as on a vertical wall.
    const d = dist(other.p, h.p), rise = h.p.y - c.feetY, boost = c.tall ? .22 : 0, steep = clamp((Math.max(h.deg, other.deg) - 20) / 30, 0, 1);
    if (d <= REACH - .45 * steep + boost && rise <= STAND - .25 * steep + boost && rise > -.6) return 'reach';
    if (d <= DYNO && rise <= LEAP) return 'dyno';
    return 'far';
  }
  // Rope physics for a lead fall: the rope runs from the belayer through the last clipped bolt to the climber.
  // -> how low the harness gets before the rope holds (or -Infinity when nothing is clipped).
  function leadCatch(hipY, lastClipY, slack = .6, floorY = 0) {
    if (lastClipY == null) return -Infinity;
    const above = Math.max(0, hipY - lastClipY), ropeOut = (lastClipY - floorY) + 2 * above + slack;// belayer -> bolt -> climber
    return lastClipY - above - slack - .06 * ropeOut;// the rope stretches about 6 % of its length out
  }
  class Climber {
    // holds: every hold with world data; floorY(p) -> the floor or mat under p; opts: {style, route, anchor, bolts, chalk}
    constructor(holds, floorY) {this.all = holds;this.floorY = floorY;this.state = 'off';}
    start(route, startHolds, opts = {}) {
      this.route = route;this.style = opts.style || route.kind;this.anchor = opts.anchor || null;this.bolts = (opts.bolts || []).slice().sort((a, b) => a.y - b.y);this.clipped = 0;this.anchorClipped = false;
      this.chalk = !!opts.chalk;this.pump = opts.pump || 0;this.offRoute = null;this.sent = false;this.tall = false;this.msg = '';this.t = 0;this.chalkT = 0;this.lowered = false;
      const starts = startHolds.slice().sort((a, b) => dot(sub(a.p, b.p), a.ax));// the start hold(s), left to right
      const L = starts[0], R = starts[starts.length - 1];
      this.hands = {L: {hold: L, pos: {...L.p}}, R: {hold: R, pos: {...R.p}}};this.used = new Set(starts.map(h => h.id));
      // A hand only lets go after its trigger has been held once, so you do not drop off before you grip.
      this.armed = {L: false, R: false};
      this.n = norm(add(L.n, R.n));this.up = norm(add(L.up, R.up));this.ax = L.ax;this.state = 'climb';this.vy = 0;
      this.solveFeet();this.hip = this.targetHip(0, 0);this.lowest = this.hip.y;
      return this;
    }
    gripping() {return ['L', 'R'].filter(s => this.hands[s].hold);}
    // Feet: the highest footholds (any hold, any colour) below the hands, or the floor / mat when it is close enough.
    solveFeet() {
      const g = this.gripping().map(s => this.hands[s].hold);if (!g.length) return;
      const ref = Math.min(...g.map(h => h.p.y)), c = g.reduce((a, h) => add(a, h.p, 1 / g.length), v3()), floor = this.floorY(c);
      const cand = this.all.filter(h => h.p.y < ref - .5 && h.p.y > ref - 1.95 && Math.abs(dot(sub(h.p, c), h.ax)) < .9 && Math.abs(dot(sub(h.p, c), this.n)) < .7 && dist(h.p, c) < 2.2);
      const pick = sign => cand.filter(h => sign * dot(sub(h.p, c), this.ax) > -.12).sort((a, b) => b.p.y - a.p.y)[0];
      let L = pick(-1), R = pick(1);if (!L) L = R;if (!R) R = L;
      if (L && R) {this.feet = [L.p, R.p];this.feetY = Math.max(L.p.y, R.p.y);this.feetOn = 'holds';}// you stand up on the higher foot
      else if (ref - floor < 2.05) {const fp = add(add(c, this.n, .25), this.ax, 0);fp.y = floor;this.feet = [add(fp, this.ax, -.15), add(fp, this.ax, .15)];this.feetY = floor;this.feetOn = 'floor';}
      else {this.feet = null;this.feetY = ref - 1.75;this.feetOn = null;}
      if (this.feetOn === 'holds' && ref - floor < 1.7 && floor > this.feetY) {this.feetY = floor;this.feetOn = 'floor';}
    }
    targetHip(sx, sy) {
      const g = this.gripping().map(s => this.hands[s].hold), hc = g.length ? g.reduce((a, h) => add(a, h.p, 1 / g.length), v3()) : this.hip;
      const low = g.length ? Math.min(...g.map(h => h.p.y)) : this.hip.y + .6;
      let hip = add(hc, this.n, .34);hip.y = clamp(low - .62 + sy * .28, this.feetY + .55, low - .3);
      if (g.length === 1) {hip = add(hip, this.ax, dot(sub(this.hands[g[0] === this.hands.L.hold ? 'R' : 'L'].pos, hc), this.ax) * .25);hip.y -= .08;}
      return add(hip, this.ax, sx * .32);
    }
    // Pump per second: the wall's steepness, how bad the holds are, one hand or two, and where the feet are.
    pumpRate() {
      const g = this.gripping().map(s => this.hands[s].hold);if (!g.length) return 0;
      const k = steepness(Math.max(...g.map(h => h.deg))), q = g.length === 2 ? (g[0].q + g[1].q) / 2 : g[0].q * 2.2;
      const feet = this.feetOn === 'floor' ? .3 : this.feetOn === 'holds' ? 1 : 1.9;
      if (g.length === 2 && q < .26 && k < .6 && this.feetOn) return -.02;// shaking out on two jugs
      return (.004 + .03 * k * q) * feet * (this.tall ? 1.35 : 1);
    }
    // inp: {grip: {L, R}, aim: hold|null, aimPoint, stick: {x, y}, dyno, chalk, clip, letGo, drunk}
    update(dt, inp) {
      this.t += dt;this.chalkT = Math.max(0, this.chalkT - dt);const ev = [];
      if (this.state === 'climb') {
        this.tall = inp.stick && inp.stick.y < -.55;
        for (const side of ['L', 'R']) {
          const hand = this.hands[side];if (inp.grip[side]) this.armed[side] = true;
          if (hand.hold && !inp.grip[side] && this.armed[side]) {hand.hold = null;this.solveFeet();}
          if (!hand.hold && inp.grip[side] && inp.aim) {
            const k = classify(this, side, inp.aim);
            if (k === 'reach') this.grab(side, inp.aim, ev);
            else if (inp.gripEdge && inp.gripEdge[side]) this.msg = k === 'dyno' ? 'Too far to reach – ✕ / Space jumps for it' : k === 'foot' ? 'That is a foothold' : 'Out of reach';
          }
          hand.pos = hand.hold ? {...hand.hold.p} : inp.aimPoint ? this.freeHandPos(side, inp.aimPoint) : add(this.hip, this.up, .35);
        }
        if (!this.armed.L && !this.armed.R && this.t > .5) this.msg = 'Hold L2 + R2 (both mouse buttons, or Q + R) to grip';
        if (!this.gripping().length) return this.fall('You let go.', ev);
        if (inp.dyno && inp.aim && inp.aim.hand) {const k = Math.min(...['L', 'R'].map(s => ['reach', 'dyno', 'far'].indexOf(classify(this, s, inp.aim))).filter(i => i >= 0));if (k <= 1) return this.dyno(inp.aim, ev, inp.drunk || 0);this.msg = 'Too far even for a jump';}
        if (inp.chalk && this.gripping().length === 1) {if (!this.chalk) this.msg = 'No chalk – rent a chalk bag at the reception';else if (!this.chalkT) {this.chalkT = 1.4;this.pump = Math.max(0, this.pump - .07);ev.push('chalk');this.msg = 'You chalk up';}}
        if (inp.clip) this.tryClip(ev);
        this.pump = clamp(this.pump + this.pumpRate() * dt * (1 + (inp.drunk || 0) * .4), 0, 1);
        if (this.pump >= 1) return this.fall('Pumped out – your fingers open.', ev);
        if (this.pump > .82 && Math.random() < (this.pump - .82) * dt * 2) {const s = this.gripping().sort((a, b) => this.hands[b].hold.q - this.hands[a].hold.q)[0];this.hands[s].hold = null;this.msg = 'A hand slips!';ev.push('slip');if (!this.gripping().length) return this.fall('You slip off.', ev);this.solveFeet();}
        if (inp.letGo) {if (this.style === 'boulder' || this.style === 'moon' || this.style === 'campus') return this.fall('You drop off.', ev, true);return this.take(ev);}
        const g = this.gripping().map(s => this.hands[s].hold);
        if (g.length) {this.n = norm(g.reduce((a, h) => add(a, h.n), v3()));this.up = norm(g.reduce((a, h) => add(a, h.up), v3()));this.ax = g[0].ax;}
        const tgt = this.targetHip(inp.stick ? inp.stick.x : 0, inp.stick ? -inp.stick.y : 0);this.hip = mix(this.hip, tgt, 1 - Math.exp(-dt * 7));
        if ((this.style === 'boulder' || this.style === 'moon' || this.style === 'campus') && !this.sent && this.hands.L.hold && this.hands.L.hold === this.hands.R.hold && this.isTop(this.hands.L.hold)) this.send(ev);
        if (this.style === 'auto' && !this.sent && g.some(h => this.isTop(h))) {this.send(ev);this.msg = 'Top! Let go (○ / C) – the autobelay lowers you';}
        if (this.style === 'rope' && !this.sent && g.some(h => this.isTop(h))) {this.send(ev);this.msg += ' ○ / C: Siri lowers you';}
      } else if (this.state === 'fall') {
        this.vy -= 9.81 * dt;this.hip.y += this.vy * dt;
        const floor = this.floorY(this.hip);
        if (this.catchY != null && this.hip.y <= this.catchY) {
          ev.push(this.vy < -6 ? 'catchHard' : 'catch');this.hip.y = this.catchY;this.vy = 0;this.state = this.style === 'auto' ? 'lower' : 'hang';
          this.msg = this.style === 'auto' ? 'The autobelay catches you and lowers you' : this.style === 'lead' ? `Caught – a ${(this.fallTop - this.catchY).toFixed(1)} m lead fall` : 'The rope holds you';
        } else if (this.hip.y - .95 <= floor) {
          const h = this.fallTop - .95 - floor;this.hip.y = floor + .95;this.state = 'done';
          ev.push(this.decked ? 'deck' : h > 2.5 ? 'landHard' : 'land');this.msg = this.decked ? 'You hit the ground – clip the bolts as you go up!' : this.msg;
        }
      } else if (this.state === 'hang' || this.state === 'lower') {
        const a = this.ropeTop();if (this.state === 'lower') {this.hip.y -= (this.style === 'auto' ? 1.3 : 1.2) * dt;if (this.hip.y - .95 <= this.floorY(this.hip) + .02) {this.hip.y = this.floorY(this.hip) + .95;this.state = 'done';this.lowered = true;ev.push('land');}}
        if (a) {const tx = a.x + this.n.x * .45, tz = a.z + this.n.z * .45, k = 1 - Math.exp(-dt * 1.5);this.hip.x += (tx - this.hip.x) * k;this.hip.z += (tz - this.hip.z) * k;}
        this.keepOffWall();this.pump = Math.max(0, this.pump - .05 * dt);
        if (this.state === 'hang') {
          for (const side of ['L', 'R']) this.hands[side].pos = add(this.hip, this.up, .5);
          if (inp.letGo) {this.state = 'lower';this.msg = 'Lowering…';ev.push('lower');}
          else for (const side of ['L', 'R']) if (inp.grip[side] && inp.aim && classify(this, side, inp.aim) === 'reach') {this.grab(side, inp.aim, ev);this.state = 'climb';this.solveFeet();break;}
        }
      } else if (this.state === 'dyno') {
        this.dynoT -= dt;const k = 1 - this.dynoT / .38, D = this.dynoData;this.hip = mix(D.from, D.to, Math.sin(Math.min(1, k) * Math.PI / 2));
        if (this.dynoT <= 0) {
          if (D.ok) {this.grab(D.side, D.hold, ev);this.hands[D.side === 'L' ? 'R' : 'L'].hold = null;this.state = 'climb';this.solveFeet();this.msg = 'Stuck the jump!';ev.push('dynoOk');}
          else {this.state = 'climb';this.hands.L.hold = this.hands.R.hold = null;return this.fall('You miss the hold.', ev);}
        }
      }
      return ev;
    }
    isTop(h) {return !!h && (this.route.moon ? h.id === this.route.topHold : h.route === this.route.id && h.top);}
    grab(side, h, ev) {
      this.hands[side].hold = h;this.used.add(h.id);ev.push('grab');this.msg = '';
      const onRoute = this.route.moon ? this.route.holds.includes(h.id) : h.route === this.route.id;
      if (!onRoute && !this.offRoute) {this.offRoute = h.routeName || 'another route';this.msg = `Off route – that hold is ${this.offRoute}`;}
      this.solveFeet();
      if (this.style === 'lead' && this.isTop(h) && !this.anchorClipped) this.msg = 'Clip the anchor: □ / E';
    }
    freeHandPos(side, aim) {
      const other = this.hands[side === 'L' ? 'R' : 'L'].hold, base = other ? other.p : add(this.hip, this.up, .5), d = sub(aim, base), l = len(d), r = other ? REACH : 1.05;
      return l > r ? add(base, d, r / l) : aim;
    }
    tryClip(ev) {
      if (this.gripping().length !== 1) {this.msg = 'Take one hand off to clip';return;}
      const sh = add(this.hip, this.up, .45);
      const next = this.bolts[this.clipped], nextOk = next && dist(sh, next) < 1.45 && next.y < sh.y + 1.1;
      if (this.style === 'lead' && this.anchor && !this.anchorClipped && !nextOk && dist(sh, this.anchor) < 1.6) {
        this.anchorClipped = true;ev.push('clip');if (this.clipped < this.bolts.length) this.msg = `Anchor clipped – but you skipped ${this.bolts.length - this.clipped} bolt(s)`;else this.send(ev);
        const m = this.msg;this.take(ev, true);this.msg = m + ' · ○ / C: Siri lowers you';return;
      }
      if (this.style !== 'lead') {this.msg = this.style === 'rope' ? 'The top-rope already runs through the anchor' : 'Nothing to clip here';return;}
      const b = this.bolts[this.clipped];
      if (!b) {this.msg = 'All bolts clipped – go for the anchor';return;}
      if (dist(sh, b) < 1.45 && b.y < sh.y + 1.1) {this.clipped++;ev.push('clip');this.msg = `Clipped ${this.clipped}/${this.bolts.length}`;}
      else this.msg = b.y > sh.y ? 'The next bolt is too high – climb higher' : 'The next bolt is out of reach';
    }
    send(ev) {if (this.sent) return;this.sent = true;ev.push(this.offRoute ? 'top' : 'send');this.msg = this.offRoute ? `Top – but off route (${this.offRoute})` : `Sent: ${this.route.name}!`;}
    take(ev, atTop = false) {
      if (this.style === 'auto') {this.state = 'lower';this.hands.L.hold = this.hands.R.hold = null;this.msg = 'The autobelay lowers you';ev.push('lower');return ev;}
      this.state = 'hang';this.hands.L.hold = this.hands.R.hold = null;this.msg = atTop ? 'Siri takes in – ○ / C to be lowered' : 'Take! Hanging on the rope – grip a hold to climb on, ○ / C to be lowered';ev.push('take');return ev;
    }
    ropeTop() {if (this.style === 'lead') return this.anchorClipped ? this.anchor : this.clipped ? this.bolts[this.clipped - 1] : null;return this.anchor;}
    keepOffWall() {
      const near = this.all.filter(h => Math.abs(h.p.y - this.hip.y) < 1.2 && dist(h.p, this.hip) < 2.5).sort((a, b) => dist(a.p, this.hip) - dist(b.p, this.hip))[0];
      if (near) {const off = dot(sub(this.hip, near.p), near.n);if (off < .38) this.hip = add(this.hip, near.n, .38 - off);}
    }
    fall(why, ev, voluntary = false) {
      this.hands.L.hold = this.hands.R.hold = null;this.state = 'fall';this.vy = voluntary ? 0 : -.5;this.fallTop = this.hip.y;this.msg = why;this.decked = false;ev.push('fall');
      const floor = this.floorY(this.hip);
      if (this.style === 'rope') this.catchY = Math.max(floor + .95, Math.min(this.hip.y, this.anchor ? this.anchor.y - .3 : this.hip.y) - .45);
      else if (this.style === 'auto') this.catchY = Math.max(floor + .95, this.hip.y - .25);
      else if (this.style === 'lead') {const c = leadCatch(this.hip.y, this.clipped ? this.bolts[this.clipped - 1].y : null, .6, floor);this.catchY = c - .3 > floor + .95 ? c : null;this.decked = this.catchY == null && this.hip.y - .95 - floor > 1.2;}
      else this.catchY = null;
      return ev;
    }
    dyno(h, ev, drunk) {
      const side = ['L', 'R'].sort((a, b) => dist(this.hands[a].pos, h.p) - dist(this.hands[b].pos, h.p))[0], other = this.hands[side === 'L' ? 'R' : 'L'].hold || this.hands[side].hold;
      const over = Math.max(0, dist(other.p, h.p) - REACH) / (DYNO - REACH), ok = Math.random() < clamp(.95 - over * .55 - h.q * .35 - this.pump * .3 - drunk * .3, .08, .95);
      this.state = 'dyno';this.dynoT = .38;this.dynoData = {side, hold: h, ok, from: {...this.hip}, to: add(add(h.p, h.n, .34), h.up, -.55)};this.msg = '';ev.push('dyno');return ev;
    }
    // The pose other players see: feet position (the avatar's origin) and which way it faces.
    pose() {return {feet: add(this.hip, this.up, -.95), yaw: Math.atan2(this.n.x, this.n.z), hang: this.state === 'hang' || this.state === 'lower'};}
  }

  // World data of every hold for the climber. W maps the hall frame (a, b) to world (x, z); Y0 is the ground floor's height.
  function worldHolds(set, W, Y0) {
    const o = W(0, 0), ea = W(1, 0), eb = W(0, 1), u = {x: ea.x - o.x, z: ea.z - o.z}, v = {x: eb.x - o.x, z: eb.z - o.z};
    const wdir = d => v3(u.x * d.a + v.x * d.b, d.y, u.z * d.a + v.z * d.b), faces = new Map(set.faces.map(f => [f.id, f]));
    return set.holds.map(h => {
      const f = faces.get(h.face), at = faceAt(f, h.x, h.s), route = h.route >= 0 ? set.routes[h.route] : null, info = HOLDS[h.type];
      const n = norm(wdir(at.nrm)), up = norm(wdir(at.up)), ax = norm(wdir({a: f.dir.a, b: f.dir.b, y: 0})), w2 = W(at.p.a, at.p.b);
      return {id: h.id, p: add(v3(w2.x, Y0 + at.p.y, w2.z), n, info.s[2] * .6), n, up, ax, q: h.q + (route ? route.d * .1 : 0), hand: h.type !== 'foot', route: h.route, top: !!h.top, start: !!h.start, deg: at.deg, type: h.type, face: f.id,
        routeName: route ? `${route.colour} (${route.grade})` : 'not in this problem', local: at};
    });
  }

  // ---------- The building, the interior and everything in it (browser only) ----------
  // Before the world is built: this module draws OSM way 1031709261 itself, and the patch's ground under the hall is lowered
  // to just below the hall floor (Kartverket's DTM rises up to 0.9 m through the building toward the slope behind it).
  function hallPolygon(data) {const F = data.frame;return [[0, 0], [F.length, 0], [F.length, F.wing], [0, F.wing]].map(([a, b]) => [F.origin[0] + F.u[0] * a + F.v[0] * b, F.origin[1] + F.u[1] * a + F.v[1] * b]);}
  function prepare(districts, data, groundY, flatten) {
    for (const d of districts || []) {
      if (d && Array.isArray(d.buildings)) d.buildings = d.buildings.filter(b => b.id !== 'w1031709261');
      if (d && flatten && data) flatten(d, hallPolygon(data), data.floorY - groundY - .05);
    }
  }
  function create({T, lib, data, toWorld, avatars, audio}) {
    const F = data.frame, origin = toWorld(F.origin[0], F.origin[1]), ua = toWorld(F.origin[0] + F.u[0], F.origin[1] + F.u[1]), ux = ua.x - origin.x, uz = ua.z - origin.z;
    const vx = -uz, vz = ux, Y0 = data.floorY;
    const W = (a, b) => ({x: origin.x + ux * a + vx * b, z: origin.z + uz * a + vz * b});// hall frame -> world x, z
    const toFrame = (x, z) => {const dx = x - origin.x, dz = z - origin.z;return {a: dx * ux + dz * uz, b: dx * vx + dz * vz};};
    const wv = (p, y = 0) => ({...W(p.a, p.b), y: Y0 + p.y + y});
    const wdir = d => ({x: ux * d.a + vx * d.b, y: d.y, z: uz * d.a + vz * d.b});
    const group = new T.Group();group.name = 'Klatreverket Torshov';group.position.set(origin.x, Y0, origin.z);group.rotation.y = Math.atan2(-uz, ux);
    const inner = new T.Group();group.add(inner);
    const floors = [], obstacles = [], hitboxes = [];
    const LEN = F.length, WING = F.wing, IN = .3, A1 = LEN - IN, B1 = WING - .3, BLOCK = 12;
    const rectW = (a0, a1, b0, b1) => [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)];
    const polyW = pts => pts.map(([a, b]) => W(a, b));
    const solid = (a0, a1, b0, b1, y0, y1, kind = 'gym') => obstacles.push({points: rectW(a0, a1, b0, b1), minY: Y0 + y0, maxY: Y0 + y1, kind});
    // Materials.
    const wallTex = (() => {
      const c = document.createElement('canvas');c.width = c.height = 512;const x = c.getContext('2d');x.fillStyle = '#c8c8c4';x.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2600; i++) {const g = 175 + Math.random() * 50 | 0;x.fillStyle = `rgba(${g},${g},${g - 4},.35)`;x.fillRect(Math.random() * 512, Math.random() * 512, 3 + Math.random() * 9, 2 + Math.random() * 6);}
      x.fillStyle = '#5a5a58';for (let r = 0; r < 12; r++) for (let q = 0; q < 12; q++) {x.beginPath();x.arc(21 + q * 42.7 + (r % 2) * 21, 21 + r * 42.7, 3.2, 0, 7);x.fill();}
      x.strokeStyle = 'rgba(70,70,70,.55)';x.lineWidth = 3;x.strokeRect(1, 1, 510, 510);
      const t = new T.CanvasTexture(c);t.wrapS = t.wrapT = T.RepeatWrapping;t.colorSpace = T.SRGBColorSpace;t.repeat.set(1 / 1.22, 1 / 1.22);t.anisotropy = 4;return t;
    })();
    const wallMat = hex => new T.MeshStandardMaterial({color: hex, map: wallTex, roughness: .9, side: T.DoubleSide});
    const M = {hall: wallMat(0xb3b4ae), boulder: wallMat(0xe6e5df), tower: wallMat(0xf2f1ec), moon: wallMat(0x3a3b3d), wood: lib.wood(0xc69c6d, .6),
      brick: lib.brick(), paintIn: lib.plaster(0xe4e2dc), floor: lib.polymer(0x5d6166), lobby: lib.concrete(0xa9a69e), mat: lib.fabric(0x7f8388), matSide: lib.fabric(0x3c3f44), slab: lib.plaster(0xdcdad4),
      steel: lib.metal(0x3b3f45, .45), rail: lib.metal(0x9aa0a6, .35), orange: new T.MeshStandardMaterial({color: 0xf07a1a, roughness: .6}), yellow: new T.MeshStandardMaterial({color: 0xf4c20d, roughness: .7, side: T.DoubleSide}),
      red: new T.MeshStandardMaterial({color: 0xc62828, roughness: .6}), rope: new T.MeshStandardMaterial({color: 0xc0392b, roughness: .8}), roof: new T.MeshStandardMaterial({color: 0x45484c, roughness: .9, side: T.DoubleSide}),
      lamp: new T.MeshStandardMaterial({color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 1.6}), glass: new T.MeshStandardMaterial({color: 0x9db4c2, roughness: .1, metalness: .2, transparent: true, opacity: .35, side: T.DoubleSide, depthWrite: false}),
      white: new T.MeshStandardMaterial({color: 0xf2f1ec, roughness: .7}), winOut: new T.MeshStandardMaterial({color: 0x2c3944, roughness: .12, metalness: .5}), cheek: new T.MeshStandardMaterial({color: 0xdedcd5, roughness: .85, side: T.DoubleSide}), dark: lib.polymer(0x232528), counter: lib.wood(0x8a6a4a, .5)};
    const box = (parent, w, h, d, x, y, z, mat, uv = true) => {const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);m.position.set(x, y, z);m.castShadow = m.receiveShadow = true;if (uv) lib.boxUV(m);parent.add(m);return m;};
    // A box from frame corners: a0..a1, y0..y1, b0..b1.
    const blk = (parent, a0, a1, y0, y1, b0, b1, mat) => box(parent, a1 - a0, y1 - y0, b1 - b0, (a0 + a1) / 2, (y0 + y1) / 2, (b0 + b1) / 2, mat);
    function textTexture(w, h, draw) {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return t;}
    function sign(parent, w, h, a, y, b, rotY, draw, emissive = .25) {
      const cw = Math.min(2048, Math.round(512 * Math.max(1, w / h))), tex = textTexture(cw, Math.round(cw * h / w), draw);
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: emissive, roughness: .6}));m.position.set(a, y, b);m.rotation.y = rotY;m.userData.noMerge = true;parent.add(m);return m;
    }

    // ---------- The building (exterior) ----------
    const shell = new T.Group();group.add(shell);
    // Wing: walls to the eaves (Kartverket DOM), a low gable along the hall. The rest of the building (Myrens Treningssenter):
    // the 11.7 m strip next to the hall and the 15 m east wing, closed.
    const eaves = data.roofY.eaves - Y0, ridge = data.roofY.ridge - Y0, strip = data.roofY.strip - Y0, base = Math.min(data.groundMin, data.ground.south) - Y0 - .3;
    const ring = data.ring.map(([x, s]) => {const p = toWorld(x, s), f = toFrame(p.x, p.z);return [f.a, f.b];});
    const clipB = (poly, b0, keepAbove) => {const out = [];for (let i = 0; i < poly.length; i++) {const P = poly[i], Q = poly[(i + 1) % poly.length], inP = keepAbove ? P[1] >= b0 : P[1] <= b0, inQ = keepAbove ? Q[1] >= b0 : Q[1] <= b0;if (inP) out.push(P);if (inP !== inQ) {const t = (b0 - P[1]) / (Q[1] - P[1]);out.push([P[0] + (Q[0] - P[0]) * t, b0]);}}return out;};
    const prism = (poly, y0, y1, mat, roofMat) => {
      if (poly.length < 3) return;const shape = new T.Shape(poly.map(([a, b]) => new T.Vector2(a, -b)));
      const geo = new T.ExtrudeGeometry(shape, {depth: y1 - y0, bevelEnabled: false});geo.rotateX(-Math.PI / 2);geo.translate(0, y0, 0);
      const uvs = geo.attributes.uv, pos = geo.attributes.position, nor = geo.attributes.normal;for (let i = 0; i < pos.count; i++) {const ny = Math.abs(nor.getY(i));uvs.setXY(i, ny > .5 ? pos.getX(i) : pos.getX(i) * Math.abs(nor.getZ(i)) + pos.getZ(i) * Math.abs(nor.getX(i)), ny > .5 ? pos.getZ(i) : pos.getY(i));}
      const m = new T.Mesh(geo, [roofMat, mat]);m.castShadow = m.receiveShadow = true;shell.add(m);return m;
    };
    const rest = clipB(ring, WING, true);
    prism(clipB(rest, WING + 8.6, false), base, strip, M.brick, M.roof);
    prism(clipB(rest, WING + 8.6, true), base, ridge - .1, M.brick, M.roof);
    // The wing's walls (0.3 m), left open where the entrance doors are; the gable roof on top.
    const DOOR = [2.3, 4.5];
    // Brick outside, painted inside (BoxGeometry faces: +a, -a, +y, -y, +b, -b).
    const wallIn = (a0, a1, y0, y1, b0, b1, inside) => {const m = blk(shell, a0, a1, y0, y1, b0, b1, M.brick);m.material = [0, 1, 2, 3, 4, 5].map(i => i === inside ? M.paintIn : M.brick);return m;};
    wallIn(0, LEN, base, eaves, -.0, IN, 4);wallIn(0, LEN, base, eaves, WING - .3, WING, 5);wallIn(LEN - IN, LEN, base, eaves, IN, WING - .3, 1);
    wallIn(0, IN, base, eaves, IN, DOOR[0], 0);wallIn(0, IN, base, eaves, DOOR[1], WING - .3, 0);wallIn(0, IN, 2.6, eaves, DOOR[0], DOOR[1], 0);blk(shell, 0, IN, base, 0, DOOR[0], DOOR[1], M.brick);
    for (const sd of [0, 1]) {
      const g = new T.PlaneGeometry(LEN, Math.hypot(WING / 2, ridge - eaves) + .05), m = new T.Mesh(g, M.roof);
      m.rotation.order = 'YXZ';m.rotation.x = -Math.PI / 2 + (sd ? 1 : -1) * Math.atan2(ridge - eaves, WING / 2);m.position.set(LEN / 2, (eaves + ridge) / 2, sd ? WING * .75 : WING * .25);m.receiveShadow = m.castShadow = true;shell.add(m);
    }
    for (const a of [0, LEN]) {const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute([a, eaves, 0, a, eaves, WING, a, ridge, WING / 2], 3));g.computeVertexNormals();const m = new T.Mesh(g, new T.MeshStandardMaterial({color: 0x7a3d2c, roughness: .9, side: T.DoubleSide}));shell.add(m);}
    // High windows along the long walls, and the entrance: glass doors, the sign and the opening hours.
    // Windows: high along the north-east side (above the lower roof next door), a band per storey on the entrance end, and high
    // windows on the far end (the south-west wall is shared with the office building next door).
    const win = (w, h, a, y, b, r) => {const m = new T.Mesh(new T.PlaneGeometry(w, h), M.winOut);m.position.set(a, y, b);m.rotation.y = r;shell.add(m);const f = new T.Mesh(new T.PlaneGeometry(w + .16, h + .16), M.white);f.position.set(a - Math.sin(r) * .005, y, b - Math.cos(r) * .005);f.rotation.y = r;shell.add(f);};
    for (let a = 6; a < LEN - 3; a += 4.2) win(2.6, 2.2, a, eaves - 2.2, WING + .03, 0);
    for (const y of [LEVELS[1] + 1.6, LEVELS[2] + 1.6, LEVELS[3] + 1.6]) for (const b of [7.5, 11, 14.5]) win(2.4, 1.7, -.03, y, b, -Math.PI / 2);
    for (const b of [4, 8, 12, 16]) win(2.4, 3.2, LEN + .03, 9.5, b, Math.PI / 2);
    const doors = [-1, 1].map(sd => {const d = new T.Group();d.position.set(-.02, 0, (DOOR[0] + DOOR[1]) / 2 + sd * .55);shell.add(d);const p = new T.Mesh(new T.PlaneGeometry(1.08, 2.45), M.glass);p.rotation.y = Math.PI / 2;p.position.y = 1.25;d.add(p);box(d, .06, .06, 1.1, 0, 2.47, 0, M.steel, false);d.userData.noMerge = true;return {g: d, sd};});
    sign(shell, 3.6, .9, -.04, 3.3, (DOOR[0] + DOOR[1]) / 2, -Math.PI / 2, (c, w, h) => {c.fillStyle = '#ffffff';c.fillRect(0, 0, w, h);c.fillStyle = '#c4161c';c.font = `bold ${h * .52}px Arial Black, Arial, sans-serif`;c.textAlign = 'center';c.textBaseline = 'middle';c.fillText('KLATREVERKET', w / 2 + h * .2, h / 2 + 4);c.beginPath();c.arc(h * .42, h / 2, h * .3, 0, 7);c.fill();c.fillStyle = '#fff';c.fillRect(h * .36, h * .28, h * .12, h * .44);}, .35);
    sign(shell, 1.6, .5, -.04, 2.85, (DOOR[0] + DOOR[1]) / 2, -Math.PI / 2, (c, w, h) => {c.fillStyle = '#20252b';c.fillRect(0, 0, w, h);c.fillStyle = '#fff';c.font = `bold ${h * .32}px Arial, sans-serif`;c.textAlign = 'center';c.fillText('Myrens verksted 3K', w / 2, h * .42);c.font = `${h * .24}px Arial, sans-serif`;c.fillText('Klatreverket · Myrens Treningssenter', w / 2, h * .8);});
    sign(shell, .55, .42, -.03, 1.45, DOOR[1] + .45, -Math.PI / 2, (c, w, h) => {c.fillStyle = '#ffffff';c.fillRect(0, 0, w, h);c.fillStyle = '#16191d';c.textAlign = 'center';c.font = `bold ${h * .13}px Arial, sans-serif`;c.fillText('Klatreverket Torshov', w / 2, h * .17);c.font = `${h * .1}px Arial, sans-serif`;['Man–tor 07–23', 'Fre 07–21', 'Lør–søn 09–20', '', 'post@klatreverket.no', '22 04 06 80'].forEach((t, i) => c.fillText(t, w / 2, h * (.36 + i * .12)));});
    floors.push({name: 'Klatreverket entrance', points: rectW(-1.8, IN, DOOR[0] - .1, DOOR[1] + .1), y: Y0, ceilingHeight: Infinity, surfaceKind: 'stone'});
    blk(shell, -1.8, 0, -.4, 0, DOOR[0] - .1, DOOR[1] + .1, M.lobby);
    // Outer walls are solid (the doorway between the two door leaves is open).
    solid(-.05, LEN, -.05, IN, -1, eaves);solid(-.05, LEN, WING - .3, WING + .05, -1, eaves);solid(LEN - IN, LEN + .05, 0, WING, -1, eaves);solid(-.05, IN, IN, DOOR[0], -1, eaves);solid(-.05, IN, DOOR[1], WING - .3, -1, eaves);

    // ---------- Floors, the four storeys in the entrance block, the stairs ----------
    blk(inner, BLOCK, A1, -.2, 0, IN, B1, M.floor);blk(inner, IN, BLOCK, -.2, 0, IN, B1, M.lobby);
    floors.push({name: 'Klatreverket hall', points: rectW(BLOCK, A1, IN, B1), y: Y0, ceilingHeight: CEILING, surfaceKind: 'gym'});
    floors.push({name: 'Klatreverket 1st floor', points: polyW([[IN, IN], [BLOCK, IN], [BLOCK, 16.4], [2.9, 16.4], [2.9, B1], [IN, B1]]), y: Y0, ceilingHeight: LEVELS[1] - SLAB, surfaceKind: 'gym'});
    const storeys = [
      [[IN, IN], [BLOCK, IN], [BLOCK, B1], [8.9, B1], [8.9, 16.4], [2.9, 16.4], [2.9, B1], [IN, B1]],
      [[IN, IN], [BLOCK, IN], [BLOCK, 16.4], [2.9, 16.4], [2.9, B1], [IN, B1]],
      [[IN, IN], [BLOCK, IN], [BLOCK, B1], [8.9, B1], [8.9, 17.9], [2.9, 17.9], [2.9, B1], [IN, B1]]];
    storeys.forEach((pts, i) => {
      const y = LEVELS[i + 1], top = i === 2 ? CEILING - y : LEVELS[i + 2] - SLAB - y;
      floors.push({name: `Klatreverket ${i + 2}. etasje`, points: polyW(pts), y: Y0 + y, ceilingHeight: top, surfaceKind: 'gym'});
      const shape = new T.Shape(pts.map(([a, b]) => new T.Vector2(a, -b))), geo = new T.ExtrudeGeometry(shape, {depth: SLAB, bevelEnabled: false});geo.rotateX(-Math.PI / 2);geo.translate(0, y - SLAB, 0);
      const m = new T.Mesh(geo, M.slab);m.castShadow = m.receiveShadow = true;inner.add(m);
      // Railings toward the hall (the upper floors look out over it) and round the stairwell.
      const rail = (a0, b0, a1, b1) => {const l = Math.hypot(a1 - a0, b1 - b0);const r = box(inner, l, .05, .05, (a0 + a1) / 2, y + 1.1, (b0 + b1) / 2, M.rail, false);r.rotation.y = -Math.atan2(b1 - b0, a1 - a0);const gl = new T.Mesh(new T.PlaneGeometry(l, 1.0), M.glass);gl.position.set((a0 + a1) / 2, y + .55, (b0 + b1) / 2);gl.rotation.y = -Math.atan2(b1 - b0, a1 - a0);gl.userData.noMerge = true;inner.add(gl);obstacles.push({points: [W(a0 - .03, b0 - .03), W(a1 + .03, b0 - .03), W(a1 + .03, b1 + .03), W(a0 - .03, b1 + .03)].map((p, k) => p), minY: Y0 + y, maxY: Y0 + y + 1.1, kind: 'rail'});};
      rail(BLOCK - .05, IN, BLOCK - .05, i === 1 ? 16.4 : B1);
      if (i === 0) {rail(2.9, 16.45, 8.85, 16.45);rail(2.95, 16.45, 2.95, B1);}
      if (i === 1) rail(2.95, 16.45, BLOCK, 16.45);
      if (i === 2) rail(2.9, 17.85, 8.85, 17.85);
    });
    // Stair flights: A (17.95–19.35) 1→2 and 3→4 rising toward the hall, B (16.45–17.85) 2→3 rising toward the street.
    const flights = [{b: [17.95, B1 - .05], y0: LEVELS[0], y1: LEVELS[1], up: 1}, {b: [16.45, 17.85], y0: LEVELS[1], y1: LEVELS[2], up: -1}, {b: [17.95, B1 - .05], y0: LEVELS[2], y1: LEVELS[3], up: 1}];
    for (const fl of flights) {
      const aLow = fl.up > 0 ? 2.9 : 8.9, aHigh = fl.up > 0 ? 8.9 : 2.9, rise = fl.y1 - fl.y0, grad = rise / 6 * fl.up, steps = Math.round(rise / .18);
      const o = W(aLow, fl.b[0]), g = wdir({a: grad, b: 0, y: 0});
      floors.push({name: 'Klatreverket stairs', points: rectW(Math.min(aLow, aHigh), Math.max(aLow, aHigh), fl.b[0], fl.b[1]), y: Y0 + fl.y0, slope: {x: g.x, z: g.z, origin: o}, surfaceKind: 'metal', ceilingHeight: 2.6});
      for (let k = 0; k < steps; k++) {const a = aLow + (aHigh - aLow) * (k + .5) / steps, y = fl.y0 + rise * (k + 1) / steps;blk(inner, Math.min(a, a + (aHigh - aLow) / steps) - .02, Math.max(a, a + (aHigh - aLow) / steps) + .02, y - .05, y, fl.b[0], fl.b[1], M.steel).position.x = a;}
      const sl = Math.hypot(6, rise), st = new T.Mesh(new T.BoxGeometry(sl, .25, .06), M.steel);st.position.set(5.9, fl.y0 + rise / 2 - .1, fl.b[0] - .03);st.rotation.z = Math.atan2(rise, 6) * fl.up;inner.add(st);
    }
    blk(inner, 2.9, 8.9, 0, CEILING, 17.86, 17.94, M.slab);solid(2.9, 8.9, 17.86, 17.94, -.5, CEILING);// the stairs' spine wall
    blk(inner, 2.9, BLOCK, 0, LEVELS[1] - SLAB, 16.35, 16.42, M.slab);solid(2.9, BLOCK, 16.35, 16.42, -.5, LEVELS[1] - SLAB);
    // The block's front toward the hall on the ground floor: two wide openings (lobby and Hula).
    for (const [b0, b1] of [[IN, 1.0], [8.0, 9.2], [16.0, B1]]) {blk(inner, BLOCK - .1, BLOCK + .1, 0, LEVELS[1] - SLAB, b0, b1, M.paintIn);solid(BLOCK - .1, BLOCK + .1, b0, b1, -.5, LEVELS[1]);}
    blk(inner, BLOCK - .1, BLOCK + .1, 2.6, LEVELS[1] - SLAB, 1.0, 16.0, M.paintIn);
    // Lobby / Hula partition with an opening.
    for (const [a0, a1] of [[IN, 6.0], [10.5, BLOCK - .1]]) {blk(inner, a0, a1, 0, LEVELS[1] - SLAB, 8.45, 8.55, M.white);solid(a0, a1, 8.45, 8.55, -.5, LEVELS[1]);}
    // Ceiling under the roof, steel trusses and rows of fluorescent lights.
    for (let a = 14; a < LEN - 1; a += 6) {blk(inner, a - .12, a + .12, CEILING - .1, CEILING + .25, IN, B1, M.steel);for (const b of [4, 9.9, 15.8]) blk(inner, a + 1.2, a + 4.6, CEILING - .25, CEILING - .2, b - .08, b + .08, M.lamp);}
    LEVELS.slice(0, 3).forEach((y, i) => {const top = LEVELS[i + 1] - SLAB;for (const b of [3, 7, 11, 15]) for (const a of [3, 8]) blk(inner, a - .7, a + .7, top - .05, top - .02, b - .06, b + .06, M.lamp);});
    for (const b of [3, 7, 11, 15]) for (const a of [3, 8]) blk(inner, a - .7, a + .7, CEILING - .25, CEILING - .2, b - .06, b + .06, M.lamp);
    // Walls of the block's storeys above the ground floor (brick inside the outer walls) are the outer walls themselves.

    // ---------- Climbing walls and holds ----------
    const set = makeRoutes(40), faces = new Map(set.faces.map(f => [f.id, f])), routes = set.routes;
    const faceMat = f => f.zone === 'Autobelay' ? M.tower : f.kind === 'moon' ? M.moon : f.lvl > 0 || f.zone === 'Hula' ? M.boulder : M.hall;
    for (const f of set.faces) {
      // The climbing surface as one strip per segment, UVs in metres; side cheeks and a back fill close it toward the wall.
      const pos = [], uv = [], idx = [];let s0 = 0;
      for (const [l] of f.segs) {const k = pos.length / 3;for (const [x, s] of [[0, s0], [f.W, s0], [f.W, s0 + l], [0, s0 + l]]) {const p = faceAt(f, x, s).p;pos.push(p.a, p.y, p.b);uv.push(x, s);}idx.push(k, k + 1, k + 2, k, k + 2, k + 3);s0 += l;}
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(idx);g.computeVertexNormals();
      const m = new T.Mesh(g, faceMat(f));m.castShadow = m.receiveShadow = true;inner.add(m);
      for (const x of [0, f.W]) {
        const prof = [];let s = 0;prof.push(faceAt(f, x, 0).p);for (const [l] of f.segs) {s += l;prof.push(faceAt(f, x, s).p);}
        const top = prof[prof.length - 1], back = Math.min(0, ...prof.map(p => (p.a - f.p0[0] - f.dir.a * x) * f.n.a + (p.b - f.p0[1] - f.dir.b * x) * f.n.b)) - .05;
        const ba = f.p0[0] + f.dir.a * x + f.n.a * back, bb = f.p0[1] + f.dir.b * x + f.n.b * back, poly = [...prof, {a: ba, b: bb, y: top.y}, {a: ba, b: bb, y: f.y0}];
        const flat = poly.map(p => new T.Vector2((p.a - f.p0[0]) * f.n.a + (p.b - f.p0[1]) * f.n.b, p.y)), tris = T.ShapeUtils.triangulateShape(flat, []);
        const cp = [];poly.forEach(p => cp.push(p.a, p.y, p.b));const cg = new T.BufferGeometry();cg.setAttribute('position', new T.Float32BufferAttribute(cp, 3));cg.setIndex(tris.flat());cg.computeVertexNormals();inner.add(new T.Mesh(cg, M.cheek));
      }
      // Walk obstacles: the face where it is below head height, and everything behind it.
      const fr = faceAt(f, 0, Math.min(f.L, 2.0)), off = (fr.p.a - f.p0[0]) * f.n.a + (fr.p.b - f.p0[1]) * f.n.b, front = Math.max(0, off) + .05;
      const corners = [[0, front], [f.W, front], [f.W, -1.2], [0, -1.2]].map(([x, o]) => W(f.p0[0] + f.dir.a * x + f.n.a * o, f.p0[1] + f.dir.b * x + f.n.b * o));
      obstacles.push({points: corners, minY: Y0 + f.y0 - .2, maxY: Y0 + f.y0 + Math.min(f.H, 3.2), kind: 'wall'});
      // Orange stripes between the autobelay lanes (as on the real tower) and yellow safety gates in front of every line.
      if (f.zone === 'Autobelay') for (let li = 0; li <= f.lanes; li++) {
        const x = li * f.W / f.lanes, at = faceAt(f, x, f.L / 2), st = new T.Mesh(new T.BoxGeometry(.09, f.L, .02), M.orange);
        st.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(f.dir.a, 0, f.dir.b), new T.Vector3(at.up.a, at.up.y, at.up.b), new T.Vector3(at.nrm.a, at.nrm.y, at.nrm.b)));
        st.position.set(at.p.a + at.nrm.a * .012, at.p.y + at.nrm.y * .012, at.p.b + at.nrm.b * .012);inner.add(st);
      }
    }
    // The autobelay tower's core (its two other sides are plain panels).
    blk(inner, 16.6, 21.4, 0, 14.0, 11.6, 16.4, M.tower);solid(16.6, 21.4, 11.6, 16.4, -.5, 14.5);
    // Holds (one instanced mesh of shaped domes, one of volumes) and their world data for the climber.
    const dome = new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);dome.rotateX(Math.PI / 2);
    const tet = new T.ConeGeometry(1, 1, 3);tet.rotateX(Math.PI / 2);tet.translate(0, 0, .5);
    const holdsWorld = worldHolds(set, W, Y0), byId = new Map(holdsWorld.map(h => [h.id, h]));
    const domeList = [], volList = [], taps = [];
    for (const h of set.holds) {
      const f = faces.get(h.face), at = faceAt(f, h.x, h.s), route = h.route >= 0 ? routes[h.route] : null;
      (h.type === 'volume' ? volList : domeList).push({h, at, info: HOLDS[h.type], hex: h.hex ?? (route ? route.hex : 0xdddddd)});
      if (h.start && route && !route.moon) taps.push({at, f, hex: route.hex});
    }
    const placeInst = (mesh, list) => {
      const mtx = new T.Matrix4(), basis = new T.Matrix4(), col = new T.Color(), q = new T.Quaternion();
      list.forEach((e, i) => {
        const f = faces.get(e.h.face), ax = new T.Vector3(f.dir.a, 0, f.dir.b), up = new T.Vector3(e.at.up.a, e.at.up.y, e.at.up.b), n = new T.Vector3(e.at.nrm.a, e.at.nrm.y, e.at.nrm.b);
        basis.makeBasis(ax, up, n);q.setFromRotationMatrix(basis).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), e.h.rot || 0));
        const s = e.info.s;mtx.compose(new T.Vector3(e.at.p.a, e.at.p.y, e.at.p.b), q, new T.Vector3(s[0], s[1], s[2]));mesh.setMatrixAt(i, mtx);col.setHex(e.hex);mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;mesh.castShadow = true;mesh.receiveShadow = true;inner.add(mesh);return mesh;
    };
    const holdMat = new T.MeshStandardMaterial({roughness: .82, metalness: 0});
    const domeMesh = placeInst(new T.InstancedMesh(dome, holdMat, domeList.length), domeList), volMesh = placeInst(new T.InstancedMesh(tet, holdMat, Math.max(1, volList.length)), volList);
    // Start tape under every start hold, and the route's card (colour, grade, style) at the bottom of its line.
    const tapeMesh = new T.InstancedMesh(new T.BoxGeometry(.05, .14, .004), new T.MeshStandardMaterial({roughness: .7}), taps.length);
    {const mtx = new T.Matrix4(), col = new T.Color(), basis = new T.Matrix4(), q = new T.Quaternion();taps.forEach((t, i) => {basis.makeBasis(new T.Vector3(t.f.dir.a, 0, t.f.dir.b), new T.Vector3(t.at.up.a, t.at.up.y, t.at.up.b), new T.Vector3(t.at.nrm.a, t.at.nrm.y, t.at.nrm.b));q.setFromRotationMatrix(basis);mtx.compose(new T.Vector3(t.at.p.a + t.at.nrm.a * .01 - t.at.up.a * .17, t.at.p.y - t.at.up.y * .17 - .01, t.at.p.b + t.at.nrm.b * .01 - t.at.up.b * .17), q, new T.Vector3(1, 1, 1));tapeMesh.setMatrixAt(i, mtx);tapeMesh.setColorAt(i, col.setHex(t.hex));});}
    inner.add(tapeMesh);
    {
      const cards = routes.filter(r => !r.moon && r.kind !== 'campus'), cols = 8, rows = Math.ceil(cards.length / cols), cw = 256, ch = 128;
      const atlas = textTexture(cols * cw, rows * ch, (c) => {
        cards.forEach((r, i) => {const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;c.fillStyle = '#fbfbf8';c.fillRect(x + 2, y + 2, cw - 4, ch - 4);c.fillStyle = '#' + r.hex.toString(16).padStart(6, '0');c.fillRect(x + 2, y + 2, 34, ch - 4);
          c.fillStyle = '#16191d';c.font = 'bold 46px Arial, sans-serif';c.fillText(r.grade, x + 48, y + 52);c.font = '24px Arial, sans-serif';c.fillText(r.colour, x + 48, y + 84);c.fillText(STYLE[r.kind] + (r.toprope && r.kind === 'rope' ? '' : ''), x + 48, y + 112);});
      });
      const pos = [], uv = [], idx = [];
      cards.forEach((r, i) => {
        const f = faces.get(r.face), x = (r.lane[0] + r.lane[1]) / 2, at = faceAt(f, x, .45), u0 = (i % cols) / cols, v0 = 1 - Math.floor(i / cols) / rows, du = 1 / cols, dv = 1 / rows, k = pos.length / 3;
        for (const [ox, oy, uu, vv] of [[-.13, -.065, u0, v0 - dv], [.13, -.065, u0 + du, v0 - dv], [.13, .065, u0 + du, v0], [-.13, .065, u0, v0]]) {pos.push(at.p.a + f.dir.a * ox + at.nrm.a * .012 + at.up.a * oy, at.p.y + at.up.y * oy + at.nrm.y * .012, at.p.b + f.dir.b * ox + at.nrm.b * .012 + at.up.b * oy);uv.push(uu, vv);}
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      });
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(idx);g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshStandardMaterial({map: atlas, roughness: .7, side: T.DoubleSide}));m.userData.noMerge = true;inner.add(m);
    }
    // Rope gear: quickdraws on every bolt, anchors, top-ropes hanging from their anchors, autobelay devices and their gates.
    const routeGear = new Map();
    {
      const qd = [], anchors = [], tops = [];
      for (const r of routes) {
        const f = faces.get(r.face);if (!r.bolts.length && !r.anchor) continue;
        const bolts = r.bolts.map(b => {const at = faceAt(f, b.x, b.s);qd.push(at);return add(wv(at.p), norm(wdir(at.nrm)), .05);});
        let anchor = null;if (r.anchor) {const at = faceAt(f, r.anchor.x, r.anchor.s);anchors.push(at);anchor = add(wv(at.p), norm(wdir(at.nrm)), .08);if (r.toprope) tops.push({at, f});}
        routeGear.set(r.id, {bolts, anchor});
      }
      const qm = new T.InstancedMesh(new T.BoxGeometry(.025, .16, .025), new T.MeshStandardMaterial({color: 0x2b2d31, roughness: .5, metalness: .4}), qd.length + anchors.length * 2), mtx = new T.Matrix4();
      qd.forEach((at, i) => {mtx.makeTranslation(at.p.a + at.nrm.a * .04, at.p.y - .08, at.p.b + at.nrm.b * .04);qm.setMatrixAt(i, mtx);});
      anchors.forEach((at, i) => {for (const k of [0, 1]) {mtx.makeTranslation(at.p.a + at.nrm.a * .05 + (k ? .12 : -.12) * 0, at.p.y - .05 - k * .06, at.p.b + at.nrm.b * .05);qm.setMatrixAt(qd.length + i * 2 + k, mtx);}});
      qm.instanceMatrix.needsUpdate = true;inner.add(qm);
      for (const {at, f} of tops) {
        // The top-rope: both strands from the anchor down to a coiled end on the floor beside the line.
        for (const k of [-.06, .06]) {const top = {a: at.p.a + at.nrm.a * .12 + f.dir.a * k, y: at.p.y, b: at.p.b + at.nrm.b * .12 + f.dir.b * k}, foot = {a: top.a + f.n.a * .45, y: f.y0 + .05, b: top.b + f.n.b * .45}, l = Math.hypot(top.a - foot.a, top.y - foot.y, top.b - foot.b);
          const c = new T.Mesh(new T.CylinderGeometry(.006, .006, l, 5), M.rope);c.position.set((top.a + foot.a) / 2, (top.y + foot.y) / 2, (top.b + foot.b) / 2);c.lookAt(top.a, top.y, top.b);c.rotateX(Math.PI / 2);inner.add(c);}
      }
      for (const r of routes) if (r.kind === 'auto') {
        const f = faces.get(r.face), x = (r.lane[0] + r.lane[1]) / 2, top = faceAt(f, x, f.L - .2);
        const dev = box(inner, .32, .32, .2, top.p.a + top.nrm.a * .12, top.p.y + .1, top.p.b + top.nrm.b * .12, M.red, false);dev.rotation.y = Math.atan2(f.n.a, f.n.b);
        const foot = faceAt(f, x, .2), gate = new T.Mesh(new T.PlaneGeometry(1.3, 1.4), M.yellow), gp = {a: foot.p.a + f.n.a * .9, b: foot.p.b + f.n.b * .9};
        gate.position.set(gp.a, .75, gp.b);gate.rotation.y = Math.atan2(f.n.a, f.n.b);inner.add(gate);
        sign(inner, .5, .45, gp.a + f.n.a * .01, .9, gp.b + f.n.b * .01, Math.atan2(f.n.a, f.n.b), (c, w, h) => {c.fillStyle = '#f4c20d';c.fillRect(0, 0, w, h);c.fillStyle = '#16191d';c.beginPath();c.moveTo(w / 2, h * .08);c.lineTo(w * .9, h * .62);c.lineTo(w * .1, h * .62);c.closePath();c.lineWidth = 14;c.stroke();c.font = `bold ${h * .26}px Arial`;c.textAlign = 'center';c.fillText('!', w / 2, h * .55);c.font = `bold ${h * .12}px Arial`;c.fillText('KLIPP INN', w / 2, h * .85);});
        const step = box(inner, .5, .3, .4, foot.p.a + f.n.a * .45, .15, foot.p.b + f.n.b * .45, M.red, false);step.rotation.y = Math.atan2(f.n.a, f.n.b);
        const strap = new T.Mesh(new T.CylinderGeometry(.012, .012, top.p.y - 1.2, 4), new T.MeshStandardMaterial({color: 0x1d4fa0}));strap.position.set(top.p.a + top.nrm.a * .2, (top.p.y + 1.2) / 2, top.p.b + top.nrm.b * .2);inner.add(strap);
        const gear = routeGear.get(r.id) || {bolts: []};gear.anchor = add(wv(top.p), norm(wdir(top.nrm)), .2);routeGear.set(r.id, gear);
      }
    }
    // Crash mats: 30 cm under every bouldering wall's room and the training room (walkable, soft).
    const MAT = .3;
    const mats = [[0, IN, BLOCK - .1, 8.6, 16.3], [1, IN, BLOCK - .1, IN, 16.4], [2, IN, BLOCK - .1, IN, 16.4], [3, IN, 6.2, IN, 17.8], [3, 6.2, BLOCK - .1, IN, 2.8], [3, 6.2, 8.8, 15.4, 17.8]];
    for (const [lvl, a0, a1, b0, b1] of mats) {
      const y = LEVELS[lvl];blk(inner, a0, a1, y, y + MAT - .02, b0, b1, M.matSide);blk(inner, a0 + .02, a1 - .02, y + MAT - .02, y + MAT, b0 + .02, b1 - .02, M.mat);
      floors.push({name: `Klatreverket mats ${lvl + 1}`, points: rectW(a0, a1, b0, b1), y: Y0 + y + MAT, ceilingHeight: (lvl === 3 ? CEILING : LEVELS[lvl + 1] - SLAB) - y - MAT, surfaceKind: 'mat'});
    }
    const matsAt = (a, b, y) => {for (const [lvl, a0, a1, b0, b1] of mats) if (a > a0 && a < a1 && b > b0 && b < b1 && Math.abs(y - LEVELS[lvl]) < 1.6) return LEVELS[lvl] + MAT;return null;};
    // Floor (or mat) under a world point, for the climber: the storey below the point.
    const floorUnder = p => {const f = toFrame(p.x, p.z), y = p.y - Y0;let lvl = 0;for (let i = 3; i >= 0; i--) if (y > LEVELS[i] - .1 && (i === 0 || f.a < BLOCK)) {lvl = i;break;}const m = matsAt(f.a, f.b, LEVELS[lvl]);return Y0 + (m ?? LEVELS[lvl]);};

    // ---------- Reception, shop, benches, the training room's extras ----------
    const desk = new T.Group();inner.add(desk);
    blk(desk, 2.0, 6.0, 0, 1.05, 6.0, 6.7, M.counter);blk(desk, 1.95, 6.05, 1.05, 1.1, 5.95, 6.75, M.white);
    const screen = box(desk, .5, .32, .03, 3.4, 1.35, 6.45, new T.MeshStandardMaterial({color: 0x0d1a24, emissive: 0x1d5a8a, emissiveIntensity: .8}), false);screen.rotation.x = -.15;
    box(desk, .2, .12, .3, 4.6, 1.16, 6.4, M.dark, false);
    solid(2.0, 6.0, 6.0, 6.7, -.5, 1.1);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) box(inner, .26, .1, .1, 2.2 + i * .75, .4 + j * .42, 8.35, lib.fabric([0x1d4fa0, 0xc62828, 0x2e9e44, 0x222326, 0xf07a1a][(i + j) % 5]), false);
    blk(inner, 1.9, 5.9, 0, 2.2, 8.3, 8.45, M.wood);
    // Klatresjappa: a shoe wall, harnesses and chalk bags on the south-west wall.
    blk(inner, 6.5, 11.5, 0, 2.2, IN, .55, M.wood);for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) box(inner, .24, .09, .12, 6.75 + i * .4, .5 + j * .45, .6, lib.fabric([0x2b2d31, 0xf07a1a, 0x1d5fc4, 0xb71c1c, 0x2e9e44][(i * 3 + j) % 5]), false);
    for (let i = 0; i < 8; i++) {const h = new T.Mesh(new T.TorusGeometry(.12, .02, 5, 12), lib.fabric([0x1d5fc4, 0xf07a1a, 0x222326, 0x7d3fb0][i % 4]));h.position.set(7 + i * .55, 2.0, .62);inner.add(h);}
    sign(inner, 2.0, .5, 9.0, 2.6, .58, 0, (c, w, h) => {c.fillStyle = '#c4161c';c.fillRect(0, 0, w, h);c.fillStyle = '#fff';c.font = `bold ${h * .55}px Arial Black, Arial`;c.textAlign = 'center';c.textBaseline = 'middle';c.fillText('KLATRESJAPPA', w / 2, h / 2);});
    // Price board beside the door (prices from klatreverket.no).
    sign(inner, 1.5, 1.9, IN + .02, 1.6, 6.6, Math.PI / 2, (c, w, h) => {
      c.fillStyle = '#20252b';c.fillRect(0, 0, w, h);c.fillStyle = '#fff';c.textAlign = 'left';c.font = `bold ${w * .1}px Arial`;c.fillText('PRISER', w * .08, h * .09);c.font = `${w * .052}px Arial`;
      ['Enkel inngang voksen', '  før 16 hverdager   155,-', '  etter 16 og helg     175,-', 'Leie: sko 50,-  sele 50,-', '  kalk 20,-  tau 40,-', 'Hele pakka uten tau 100,-', '', 'Buldring: alle kan prøve', 'Tau: den som sikrer må', '  ha Brattkort', 'Brattkorttest når klatre-', '  vakta er på plass', 'Autobelay: kort intro, gratis'].forEach((t, i) => c.fillText(t, w * .06, h * (.17 + i * .064)));
    }, .3);
    for (const a of [7.0, 9.5]) {blk(inner, a, a + 2.0, 0, .45, 6.6, 7.0, M.wood);solid(a, a + 2.0, 6.6, 7.0, -.5, .45);}
    // Hangboards and rings on an orange beam in the training room; its lights.
    const beamY = LEVELS[3] + 2.35;blk(inner, 6.8, 7.3, beamY, beamY + .35, 8.6, 15.2, M.orange);for (const b of [8.8, 15.0]) {blk(inner, 6.95, 7.15, LEVELS[3] + MAT, beamY, b - .1, b + .1, M.orange);solid(6.95, 7.15, b - .1, b + .1, Y0 - 1, Y0 + 15);}
    for (const b of [10, 11.6, 13.2]) {box(inner, .2, .09, .6, 6.95, beamY - .05, b, M.wood, false);}
    for (const b of [14.1, 14.6]) {const r = new T.Mesh(new T.TorusGeometry(.11, .02, 6, 16), M.wood);r.position.set(7.0, beamY - .65, b);r.rotation.y = Math.PI / 2;inner.add(r);blk(inner, 6.99, 7.01, beamY - .54, beamY, b - .01, b + .01, M.dark);}
    const hang = new T.Mesh(new T.BoxGeometry(.6, .5, 2.0), new T.MeshBasicMaterial({visible: false}));hang.position.set(7.05, beamY - .2, 11.6);hang.userData = {gymHang: true, noMerge: true};inner.add(hang);hitboxes.push(hang);
    // The disco ball in Discorommet.
    const ball = new T.Mesh(new T.IcosahedronGeometry(.3, 1), new T.MeshStandardMaterial({color: 0xdfe3e8, metalness: 1, roughness: .15, flatShading: true}));ball.position.set(7, LEVELS[2] - SLAB - .6, 9);ball.userData.noMerge = true;inner.add(ball);
    const discoLights = [];for (let i = 0; i < 6; i++) {const l = box(inner, .5, .03, .5, 3 + (i % 3) * 3.5, LEVELS[2] - SLAB - .03, 4 + Math.floor(i / 3) * 8, new T.MeshStandardMaterial({color: 0x222222, emissive: 0xff00ff, emissiveIntensity: 1.2}), false);l.userData.noMerge = true;discoLights.push(l);}
    // The Moonwall's LEDs (one small light above every grid hold) and the Vippevegg's control box.
    const moonFace = faces.get('moon'), moonHolds = holdsWorld.filter(h => h.face === 'moon'), ledMat = new T.MeshBasicMaterial({color: 0xffffff});
    const leds = new T.InstancedMesh(new T.SphereGeometry(.018, 6, 4), ledMat, moonHolds.length);
    {const mtx = new T.Matrix4(), col = new T.Color(0x202020);moonHolds.forEach((h, i) => {const at = h.local;mtx.makeTranslation(at.p.a + at.nrm.a * .02 + at.up.a * .11, at.p.y + at.up.y * .11 + at.nrm.y * .02, at.p.b + at.nrm.b * .02 + at.up.b * .11);leds.setMatrixAt(i, mtx);leds.setColorAt(i, col);});}
    leds.userData.noMerge = true;inner.add(leds);
    const moonBox = new T.Mesh(new T.BoxGeometry(.3, .4, .5), M.dark);moonBox.position.set(IN + .2, LEVELS[3] + MAT + 1.2, 3.6);moonBox.userData = {gymMoon: true, noMerge: true};inner.add(moonBox);hitboxes.push(moonBox);
    sign(inner, .5, .3, IN + .37, LEVELS[3] + MAT + 1.6, 3.6, Math.PI / 2, (c, w, h) => {c.fillStyle = '#111';c.fillRect(0, 0, w, h);c.fillStyle = '#42a5f5';c.font = `bold ${h * .3}px Arial`;c.textAlign = 'center';c.fillText('MOONWALL 40°', w / 2, h * .42);c.fillStyle = '#ddd';c.font = `${h * .18}px Arial`;c.fillText('□ choose a problem', w / 2, h * .78);});
    // Lights: two over the hall and one in the block (always present, dimmed when you are far away).
    const lights = [[30, 11, 10, 60], [48, 11, 10, 60], [6, 2.8, 6.5, 22]].map(([a, y, b, r]) => {const l = new T.PointLight(0xfff4e6, 0, r, 1.4);l.position.set(a, y, b);inner.add(l);return l;});

    // ---------- People: the receptionist, Siri (your climbing partner, she has a brattkort), and other climbers ----------
    const people = [];
    const mk = (name, shirt, a, b, yaw, y = 0) => {if (!avatars) return null;const av = avatars.avatar(0, name, shirt);av.group.position.set(a, y, b);av.group.rotation.y = yaw;av.group.userData.noMerge = true;inner.add(av.group);av.pose({stance: 'stand'});people.push(av);return av;};
    const staff = mk('Resepsjonen', 0x8e1b23, 4.0, 7.3, 0);// faces the lobby (-b)
    const siriHome = {a: 10.4, b: 4.5, yaw: Math.PI / 2};
    const siri = mk('Siri (klatrepartner)', 0x2e86de, siriHome.a, siriHome.b, siriHome.yaw);
    const siriHit = new T.Mesh(new T.BoxGeometry(.7, 1.8, .7), new T.MeshBasicMaterial({visible: false}));siriHit.userData = {gymPartner: true, noMerge: true};inner.add(siriHit);hitboxes.push(siriHit);
    const deskHit = new T.Mesh(new T.BoxGeometry(4.2, 1.0, 1.4), new T.MeshBasicMaterial({visible: false}));deskHit.position.set(4.0, 1.2, 6.2);deskHit.userData = {gymDesk: true, noMerge: true};inner.add(deskHit);hitboxes.push(deskHit);
    // Two climbers on routes in the hall, each with a belayer, going up slowly and being lowered again.
    const ghosts = [];
    for (const rid of [routes.find(r => r.face === 'gal' && r.toprope)?.id, routes.find(r => r.face === 'abA')?.id].filter(v => v != null)) {
      const r = routes[rid], climber = mk(rid % 2 ? 'Ola' : 'Kari', rid % 2 ? 0x2e9e44 : 0xf07a1a, 0, 0, 0), f = faces.get(r.face), x = (r.lane[0] + r.lane[1]) / 2;
      const belayer = r.kind === 'auto' ? null : mk('Jonas', 0x5d6d7e, f.p0[0] + f.dir.a * x + f.n.a * 1.6, f.p0[1] + f.dir.b * x + f.n.b * 1.6, Math.atan2(-f.n.a, -f.n.b) + Math.PI);
      if (climber) {climber.ghost = true;ghosts.push({r, f, x, climber, belayer, t: rid * 7.3});}
    }
    // Static geometry: one mesh per material for the shell and one per material for the interior (hidden when far away).
    lib.mergeStatic(shell, o => !!o.userData.noMerge);lib.mergeStatic(inner, o => o.isInstancedMesh || !!o.userData.noMerge);

    // ---------- Visit state (ticket, rentals, brattkort, the ticks), kept in the browser ----------
    const KEY = 'haarklous-klatreverket-v1';let st = {};
    try {st = JSON.parse(localStorage.getItem(KEY) || '{}') || {};} catch {st = {};}
    const save = () => {try {localStorage.setItem(KEY, JSON.stringify(st));} catch {}};
    const today = () => {const d = new Date();return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;};
    const visit = () => {if (st.day !== today()) {st.day = today();st.paid = false;st.shoes = st.harness = st.chalk = false;}return st;};
    st.ticks = st.ticks || {};st.tries = st.tries || {};

    // ---------- Climbing: which hold the player looks at, starting a route, the rope and the hands ----------
    const climber = new Climber(holdsWorld, floorUnder);
    const near = (p, r) => holdsWorld.filter(h => Math.abs(h.p.y - p.y) < r && dist(h.p, p) < r);
    // The hold closest to the line of sight (within a few centimetres of it, out to 3.2 m).
    function aimAt(cam, dir, onlyHand = true) {
      let best = null, bd = 1e9;
      for (const h of near(cam, 3.4)) {
        if (onlyHand && !h.hand) continue;const d = sub(h.p, cam), t = dot(d, dir);if (t < .15 || t > 3.3) continue;
        const off = len(add(d, dir, -t)), tol = .09 + t * .035;if (off < tol && off + t * .01 < bd) {bd = off + t * .01;best = h;}
      }
      return best;
    }
    // Where the line of sight meets the wall (for the free hand).
    function aimPoint(cam, dir) {const h = aimAt(cam, dir, false) || near(cam, 2.5).sort((a, b) => dist(a.p, cam) - dist(b.p, cam))[0];if (!h) return null;const t = dot(sub(h.p, cam), h.n) / (dot(dir, h.n) || -1e-6);return t > 0 && t < 4 ? add(cam, dir, t) : h.p;}
    function routeAt(cam, dir, player) {
      const h = aimAt(cam, dir, false);if (!h || h.route < 0) return null;const r = routes[h.route];
      // Only from the floor in front of the line (not from a stair or another storey).
      return Math.abs(player.feet - floorUnder({x: h.p.x, y: h.p.y - 1, z: h.p.z})) < .9 ? r : null;
    }
    function startHoldsOf(r) {const hs = r.moon ? [byId.get(r.startHolds[0])] : r.holds.map(i => byId.get(i)).filter(h => h.start);return hs;}
    // Hands seen in first person: a simple palm and fingers each.
    const handMat = new T.MeshStandardMaterial({color: 0xd9a988, roughness: .7});
    const hands = ['L', 'R'].map(() => {const g = new T.Group();const palm = new T.Mesh(new T.BoxGeometry(.085, .1, .03), handMat);g.add(palm);for (let i = 0; i < 4; i++) {const f = new T.Mesh(new T.BoxGeometry(.017, .075, .022), handMat);f.position.set(-.03 + i * .02, .08, -.012);f.rotation.x = .9;g.add(f);}const th = new T.Mesh(new T.BoxGeometry(.02, .055, .022), handMat);th.position.set(.05, .02, -.01);th.rotation.z = -.8;g.add(th);g.visible = false;g.userData.noMerge = true;return g;});
    const aimRing = new T.Mesh(new T.TorusGeometry(.13, .012, 6, 24), new T.MeshBasicMaterial({color: 0x66ff88, depthTest: false, transparent: true, opacity: .9}));aimRing.renderOrder = 20;aimRing.visible = false;
    // The rope from the belayer through the clipped bolts (or the anchor) to the harness: up to 24 short cylinders.
    const ropeSegs = [];for (let i = 0; i < 24; i++) {const c = new T.Mesh(new T.CylinderGeometry(.007, .007, 1, 5), M.rope);c.visible = false;ropeSegs.push(c);}
    const extras = new T.Group();extras.add(...hands, aimRing, ...ropeSegs);
    function drawRope(points) {
      let k = 0;for (let i = 0; i < points.length - 1 && k < ropeSegs.length; i++) {const a = points[i], b = points[i + 1], l = dist(a, b);if (l < .01) continue;const c = ropeSegs[k++];c.visible = true;c.scale.set(1, l, 1);c.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);c.lookAt(b.x, b.y, b.z);c.rotateX(Math.PI / 2);}
      for (; k < ropeSegs.length; k++) ropeSegs[k].visible = false;
    }
    let session = null;// {route, style, belayer}
    function begin(route, opts = {}) {
      const gear = routeGear.get(route.id) || {bolts: []}, style = opts.style || (route.kind === 'rope' ? (route.toprope ? 'rope' : 'lead') : route.kind);
      climber.start(route, startHoldsOf(route).length ? startHoldsOf(route) : route.holds.map(i => byId.get(i)), {style, anchor: gear.anchor, bolts: gear.bolts, chalk: visit().chalk});
      st.tries[route.id] = (st.tries[route.id] || 0) + 1;save();
      session = {route, style, belay: style === 'rope' || style === 'lead'};
      if (session.belay && siri) {const f = faces.get(route.face), x = (route.lane[0] + route.lane[1]) / 2;siri.group.position.set(f.p0[0] + f.dir.a * x + f.n.a * 1.5, f.y0, f.p0[1] + f.dir.b * x + f.n.b * 1.5);siri.group.rotation.y = Math.atan2(f.n.a, f.n.b);session.siriAt = {...siri.group.position};}
      return climber;
    }
    function end() {
      if (session && siri) {siri.group.position.set(siriHome.a, 0, siriHome.b);siri.group.rotation.y = siriHome.yaw;}
      session = null;climber.state = 'off';hands.forEach(h => {h.visible = false;});aimRing.visible = false;drawRope([]);
    }
    function tick(route, style) {const prev = st.ticks[route.id];const how = style === 'lead' ? (st.tries[route.id] <= 1 ? 'flash (lead)' : 'redpoint') : style === 'rope' ? 'top rope' : style === 'auto' ? 'autobelay' : st.tries[route.id] <= 1 ? 'flash' : 'sent';if (!prev || prev === 'top rope' || prev === 'autobelay') st.ticks[route.id] = how;save();return how;}
    // Per frame while climbing: hands, the target aimRing, the rope.
    function showClimb(cam, dir, aim, cls) {
      for (const [i, s] of [[0, 'L'], [1, 'R']]) {
        const hd = climber.hands[s], g = hands[i];g.visible = climber.state !== 'off';if (!g.visible) continue;
        const p = hd.pos, n = hd.hold ? hd.hold.n : climber.n, up = hd.hold ? hd.hold.up : climber.up, ax = hd.hold ? hd.hold.ax : climber.ax, match = hd.hold && climber.hands.L.hold === climber.hands.R.hold ? (s === 'L' ? -.06 : .06) : 0;
        g.position.set(p.x + n.x * .1 + up.x * .05 + ax.x * match, p.y + n.y * .1 + up.y * .05 + ax.y * match, p.z + n.z * .1 + up.z * .05 + ax.z * match);
        g.lookAt(p.x - n.x, p.y - n.y, p.z - n.z);g.rotateY(Math.PI);g.rotateZ(s === 'L' ? .25 : -.25);g.scale.x = s === 'L' ? -1 : 1;
      }
      aimRing.visible = !!aim && climber.state === 'climb';
      if (aimRing.visible) {aimRing.position.set(aim.p.x + aim.n.x * .04, aim.p.y + aim.n.y * .04, aim.p.z + aim.n.z * .04);aimRing.lookAt(aim.p.x + aim.n.x, aim.p.y + aim.n.y, aim.p.z + aim.n.z);aimRing.material.color.setHex(cls === 'reach' ? 0x66ff88 : cls === 'dyno' ? 0xffb02e : cls === 'foot' ? 0x9aa0a6 : 0xff5252);}
      if (!session) {drawRope([]);return;}
      const harness = add(climber.hip, climber.up, -.05);
      const pts = [];
      if (session.belay && siri) {const sp = siri.group.getWorldPosition(new T.Vector3());pts.push({x: sp.x, y: sp.y + 1.0, z: sp.z});}
      if (climber.style === 'rope' && climber.anchor) pts.push(climber.anchor);
      else if (climber.style === 'lead') {for (let i = 0; i < climber.clipped; i++) pts.push(climber.bolts[i]);if (climber.anchorClipped) pts.push(climber.anchor);}
      else if (climber.style === 'auto' && climber.anchor) pts.push(climber.anchor);
      pts.push(harness);drawRope(pts.length > 1 && climber.style !== 'boulder' && climber.style !== 'moon' && climber.style !== 'campus' ? pts : []);
    }

    // ---------- The Moonwall: choose a problem, its LEDs light up ----------
    const moonRoutes = routes.filter(r => r.moon);let moonSel = -1;
    function lightMoon(i) {
      moonSel = i;const col = new T.Color();
      moonHolds.forEach((h, k) => {const role = i >= 0 ? (set.holds[h.id].moon || {})[moonRoutes[i].id] : null;leds.setColorAt(k, col.setHex(role === 'start' ? 0x22ee55 : role === 'top' ? 0xff3030 : role === 'move' ? 0x3399ff : 0x202020));});
      leds.instanceColor.needsUpdate = true;return i >= 0 ? moonRoutes[i] : null;
    }

    // ---------- Each frame (on foot or climbing) ----------
    let tt = 0;
    function update(dt, player, camera, remotes = []) {
      tt += dt;const pl = toFrame(player.x, player.z), d = Math.hypot(pl.a - LEN / 2, pl.b - WING / 2), inside = pl.a > 0 && pl.a < LEN && pl.b > 0 && pl.b < WING && player.feet > Y0 - 2 && player.feet < Y0 + 16;
      inner.visible = d < 140;
      lights.forEach(l => {l.intensity = d < 80 ? 40 : 0;});
      const want = Math.hypot(pl.a, pl.b - 3.4) < 2.6 && Math.abs(player.feet - Y0) < 1.5 ? 1 : 0;doorOpen += (want - doorOpen) * Math.min(1, dt * 5);for (const dr of doors) dr.g.position.z = (DOOR[0] + DOOR[1]) / 2 + dr.sd * (.55 + doorOpen * .9);
      if (want && !doorWas) audio && audio.sfx('shopDoor');doorWas = want;
      if (!inner.visible) return {inside};
      ball.rotation.y += dt * .6;discoLights.forEach((l, i) => l.material.emissive.setHSL((tt * .15 + i / 6) % 1, 1, .5));
      for (const av of people) {if (!av.ghost) av.pose({stance: av.belaying ? 'belay' : 'stand', dt});av.update(dt, camera, inside);}
      // Staff and Siri turn toward you when you are near.
      // The receptionist and Siri turn toward you when you are near (an avatar faces -z at yaw 0).
      const face = (av, a, b, rest, r) => {const t = Math.hypot(pl.a - a, pl.b - b) < r && Math.abs(player.feet - Y0) < 2 ? Math.atan2(-(pl.a - a), -(pl.b - b)) : rest;let d = t - av.group.rotation.y;d = Math.atan2(Math.sin(d), Math.cos(d));av.group.rotation.y += d * Math.min(1, dt * 2.5);};
      if (staff) face(staff, 4.0, 7.3, 0, 8);
      if (siri) {siri.belaying = !!(session && session.belay);siriHit.position.copy(siri.group.position).add(new T.Vector3(0, .9, 0));if (!session) face(siri, siriHome.a, siriHome.b, siriHome.yaw, 6);}
      for (const g of ghosts) {
        g.t += dt;const T0 = 70, T1 = 12, k = g.t % (T0 + T1), up = k < T0 ? k / T0 : 1 - (k - T0) / T1, at = faceAt(g.f, g.x + Math.sin(g.t * .7) * .15, .4 + up * (g.f.L - 2.2));
        g.climber.group.position.set(at.p.a + at.nrm.a * .4, at.p.y - .9, at.p.b + at.nrm.b * .4);g.climber.group.rotation.y = Math.atan2(g.f.n.a, g.f.n.b);g.climber.pose({stance: k < T0 ? 'climb' : 'hang', speed: k < T0 ? .6 : 0, dt});
        if (g.belayer) g.belayer.belaying = true;
      }
      // Ropes for other players climbing here.
      return {inside};
    }
    let doorOpen = 0, doorWas = 0;

    // Where am I in the gym (for footsteps, ambience and the photo caption).
    function zoneAt(p, feet) {
      const f = toFrame(p.x, p.z), y = feet - Y0;if (f.a < 0 || f.a > LEN || f.b < 0 || f.b > WING || y < -1 || y > 15) return null;
      if (f.a > BLOCK) return 'hall';const lvl = y > LEVELS[3] - .3 ? 3 : y > LEVELS[2] - .3 ? 2 : y > LEVELS[1] - .3 ? 1 : 0;
      return ['ground', 'disco', 'inner', 'training'][lvl] + (lvl === 0 && f.b < 8.5 ? '-lobby' : '');
    }
    const ZONE_NAME = {hall: 'Hallen', 'ground-lobby': 'the reception', ground: 'Hula', disco: 'Discorommet (2nd floor)', inner: 'the inner bouldering room (3rd floor)', training: 'the training room (4th floor)'};
    // The ground under the hall is the hall floor (for groundAt in game-main: the terrain under the building is higher).
    function ground(x, z) {const f = toFrame(x, z);return f.a > -.05 && f.a < LEN + .05 && f.b > -.05 && f.b < WING + .05 ? Y0 : null;}
    const local = {x: data.gym[0], s: data.gym[1]};
    return {group, extras, floors, obstacles, hitboxes, routes, holds: holdsWorld, faces, climber, begin, end, tick, showClimb, aimAt, aimPoint, routeAt, classify: (s, h) => classify(climber, s, h), update, zoneAt, ZONE_NAME, ground, visit, save, get state() {return st;},
      lightMoon, get moonSel() {return moonSel;}, moonRoutes, siri, staff, door: W(-1.2, (DOOR[0] + DOOR[1]) / 2), doorYaw: Math.atan2(ux, uz), local, floorY: Y0, toFrame, W, routeGear, session: () => session, LEVELS, priceAt, brattkortPriceAt, staffedAt, openAt, HOURS, PRICES, STYLE};
  }
  return {PRICES, HOURS, priceAt, brattkortPriceAt, staffedAt, openAt, gradeName, ROPE_GRADES, BOULDER_GRADES, WALLS, LEVELS, HOLDS, COLOURS, STYLE, faceInfo, faceAt, makeRoutes, classify, leadCatch, steepness, Climber, worldHolds, prepare, hallPolygon, create, REACH, DYNO};
});
