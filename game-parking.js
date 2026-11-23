/* Parked vehicles in every street (issue #113): where they stand and what they are. Pure (the Node tests use it too);
 * game-fleet.js draws them and makes the motor vehicles drivable.
 *
 * GameParking.plan({roads, osm, water, rects, buildings, points, clear, lines, taken, seed, fill}) -> {cars, small}
 *   roads      [{k, w, n, p (flat x, s, …)}]   every road and track of the map
 *   osm        window.PARKING_OSM (parking-data.js): parking and one-way tags of streets, car parks, stops, crossings, …
 *   water      [flat polygon]                   nothing stands in or beside it
 *   rects      [{x0, s0, x1, s1}]               where you can walk; vehicles stay `margin` m inside
 *   buildings  [flat polygon]                   nothing stands in a building
 *   points     [x, s, …]                        trees and street lamps (nothing stands on them)
 *   clear      [{x, s, r}]                      circles to keep free (bike docks, job spots, the helicopter pad, …)
 *   lines      [{p: [x0, s0, x1, s1], r}]       bands to keep free (the driving test's route, the airstrip)
 *   taken      [flat polygon]                   footprints of the vehicles that are there already
 *   fill       {kerb, lot}                      how full the kerbs and car parks are (0–1)
 * cars:  [{x, s, heading, type, colour, where}] the motor vehicles (cars, vans, taxis, lorries, motorcycles), in a fixed order
 * small: [{x, s, heading, type, colour}]        bicycles and mopeds (parked, not ridable)
 * where: 'kerb' (in the road by the kerb), 'lot' (car park), 'rank' (taxi rank).
 *
 * The rules (trafikkreglene §§ 17–19 where they say something): a car parks on the right-hand side facing the traffic (on a
 * one-way street on both sides, facing the one way); not within 5 m of a crossing street's kerb or before a pedestrian
 * crossing, not within 20 m of a bus or tram stop, not in front of a driveway, gate or entrance, never on tram rails or
 * beside a railway. Where OpenStreetMap says a kerb has no parking (parking:<side>=no, no_stopping, loading bays …) nothing
 * parks; where it says nothing, ordinary streets have parking on both sides (narrow ones on one side) and main roads none.
 * Kerbs fill in runs (a filled place is likely to be followed by another), car parks in rows of 2.5 m bays.
 * Everything is seeded: the same map gives the same vehicles on every computer, so a lobby agrees on them.
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A; heading = atan2(east, south) of where the nose points.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameParking = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // Body types: real sizes (m) of common Oslo vehicles; `drive` = drivable (□), kind = what the game calls it (licence rules).
  const TYPES = {
    small: {L: 3.65, W: 1.66, H: 1.52, kind: 'car', name: 'small car', drive: true},
    hatch: {L: 4.26, W: 1.80, H: 1.50, kind: 'car', name: 'electric hatchback', drive: true},
    sedan: {L: 4.70, W: 1.85, H: 1.44, kind: 'car', name: 'electric saloon', drive: true},
    estate: {L: 4.78, W: 1.84, H: 1.50, kind: 'car', name: 'estate car', drive: true},
    suv: {L: 4.70, W: 1.92, H: 1.66, kind: 'car', name: 'SUV', drive: true},
    van: {L: 5.05, W: 1.95, H: 1.98, kind: 'car', name: 'van', drive: true},
    pickup: {L: 5.30, W: 1.86, H: 1.80, kind: 'car', name: 'pickup', drive: true},
    taxi: {L: 4.78, W: 1.84, H: 1.50, kind: 'car', name: 'taxi', drive: true},
    lorry: {L: 8.20, W: 2.50, H: 3.40, kind: 'lorry', name: 'lorry', drive: true},
    motorcycle: {L: 2.10, W: .80, H: 1.25, kind: 'motorcycle', name: 'motorcycle', drive: true},
    moped: {L: 1.85, W: .70, H: 1.15, kind: 'moped', name: 'moped', drive: false},
    bicycle: {L: 1.75, W: .60, H: 1.00, kind: 'bicycle', name: 'bicycle', drive: false},
    // (new types go last: the stored plan keeps a type as its place in this list)
    v70: {L: 4.71, W: 1.80, H: 1.49, kind: 'car', name: 'Volvo V70', drive: true}// the 2000–2007 estate, grey, all over Oslo (issue #149)
  };
  const COLOURS = [['white', 0xe6e8e6], ['black', 0x17191c], ['grey', 0x585d63], ['silver', 0xaab0b6], ['blue', 0x1f3f6e], ['dark blue', 0x1a2536], ['red', 0x9a1d20],
    ['green', 0x2f5a3d], ['beige', 0xb8aa8c], ['brown', 0x4e3b2d], ['light blue', 0x86abc8], ['yellow', 0xd8ae2c], ['orange', 0xc9661f], ['dark grey', 0x3d4146]];
  const CW = {// colour weights (Norwegian new cars and what stands in Oslo's streets: mostly white, black and greys)
    car: [24, 18, 17, 12, 9, 5, 6, 3, 2, 2, 1.5, .5, .5], taxi: [25, 50, 25], van: [55, 6, 12, 15, 6, 0, 3, 0, 0, 0, 0, 3],
    lorry: [70, 0, 12, 0, 10, 0, 8], motorcycle: [15, 30, 10, 0, 15, 0, 20, 5, 0, 0, 0, 0, 5], moped: [25, 20, 5, 0, 0, 0, 15, 10, 0, 0, 15, 10],
    bicycle: [10, 30, 20, 5, 12, 0, 10, 8, 0, 5],
    v70: [0, 0, 45, 25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30]// greys and silver only: mid grey, silver, dark grey metallic
  };
  // How often each body type parks: the city, and the industrial parts (Økern, Ulven, Løren, Ensjø) with more vans and lorries.
  const MIX = {city: {small: 15, hatch: 21, sedan: 11, estate: 17, suv: 22, van: 8, pickup: 1.4, lorry: .6, taxi: 2},
    industry: {small: 9, hatch: 14, sedan: 8, estate: 15, suv: 18, van: 22, pickup: 6, lorry: 6, taxi: 1}};
  // Grey Volvo V70s (issue #149): this share of the estate cars becomes one, after the plan is made (so no other vehicle moves).
  const V70 = {city: .6, industry: .5};
  const industrial = (x, s) => (x > 980 && s < 1700) || (x > 700 && s > 1700 && s < 2700);
  const STREET = {residential: 2, tertiary: 2, unclassified: 1, living_street: 0, secondary: 0, secondary_link: 0, tertiary_link: 0, primary: 0, primary_link: 0};// sides by default
  const DRIVE = ['residential', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'unclassified', 'primary', 'primary_link', 'trunk', 'trunk_link', 'motorway_link', 'living_street', 'service', 'pedestrian'];
  const PATHS = ['footway', 'cycleway', 'path', 'steps', 'track', 'bridleway'];
  const KERB_GAP = .15;// from the car's side to the kerb

  // Seeded random numbers (mulberry32: integer maths only, so every browser gets the same; nearby seeds give unrelated runs).
  const rng = seed => {let a = (seed | 0) ^ 0x2545f491;return () => {a = (a + 0x6d2b79f5) | 0;let t = Math.imul(a ^ (a >>> 15), 1 | a);t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};};
  const pick = (rnd, weights) => {let sum = 0;for (const w of weights) sum += w || 0;let t = rnd() * sum;for (let i = 0; i < weights.length; i++) {t -= weights[i] || 0;if (t < 0) return i;}return weights.length - 1;};
  const segDist = (x, s, a) => {const dx = a[2] - a[0], ds = a[3] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (s - a[1]) * ds) / L));return Math.hypot(x - a[0] - dx * t, s - a[1] - ds * t);};
  function inPoly(x, s, o) {let inside = false;for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > s) !== (o[j + 1] > s) && x < (o[j] - o[i]) * (s - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) inside = !inside;return inside;}
  const edgeDist = (x, s, o) => {let d = Infinity;for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) d = Math.min(d, segDist(x, s, [o[j], o[j + 1], o[i], o[i + 1]]));return d;};
  const bbox = o => {let x0 = Infinity, s0 = Infinity, x1 = -Infinity, s1 = -Infinity;for (let i = 0; i < o.length; i += 2) {x0 = Math.min(x0, o[i]);x1 = Math.max(x1, o[i]);s0 = Math.min(s0, o[i + 1]);s1 = Math.max(s1, o[i + 1]);}return {x0, s0, x1, s1};};
  const area = o => {let a = 0;for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) a += o[j] * o[i + 1] - o[i] * o[j + 1];return Math.abs(a) / 2;};

  // A vehicle's footprint: a rectangle round (x, s), forward (fx, fs) = (sin heading, cos heading).
  function box(x, s, heading, L, W) {
    const fx = Math.sin(heading), fs = Math.cos(heading), hl = L / 2, hw = W / 2;
    return {x, s, fx, fs, hl, hw, corners: [x + fx * hl - fs * hw, s + fs * hl + fx * hw, x + fx * hl + fs * hw, s + fs * hl - fx * hw, x - fx * hl + fs * hw, s - fs * hl - fx * hw, x - fx * hl - fs * hw, s - fs * hl + fx * hw]};
  }
  // Point in the box's own frame (u forward, v to the side).
  const toBox = (b, x, s) => {const dx = x - b.x, ds = s - b.s;return [dx * b.fx + ds * b.fs, -dx * b.fs + ds * b.fx];};
  const pointBox = (b, x, s) => {const [u, v] = toBox(b, x, s);return Math.hypot(Math.max(0, Math.abs(u) - b.hl), Math.max(0, Math.abs(v) - b.hw));};
  // Shortest distance from a segment [x0, s0, x1, s1] to the box (0 if they touch).
  function segBox(a, b) {
    const [u0, v0] = toBox(b, a[0], a[1]), [u1, v1] = toBox(b, a[2], a[3]);
    // Liang–Barsky: does the segment cross the rectangle?
    let t0 = 0, t1 = 1;const du = u1 - u0, dv = v1 - v0;
    const clip = (p, q) => {if (p === 0) return q >= 0;const r = q / p;if (p < 0) {if (r > t1) return false;if (r > t0) t0 = r;} else {if (r < t0) return false;if (r < t1) t1 = r;}return true;};
    if (clip(-du, u0 + b.hl) && clip(du, b.hl - u0) && clip(-dv, v0 + b.hw) && clip(dv, b.hw - v0)) return 0;
    let d = Math.min(pointBox(b, a[0], a[1]), pointBox(b, a[2], a[3]));
    for (let i = 0; i < 8; i += 2) d = Math.min(d, segDist(b.corners[i], b.corners[i + 1], a));
    return d;
  }
  // Do two boxes come closer than `gap`? (separating axes, each box grown by gap / 2)
  function overlap(a, b, gap = 0) {
    const sep = (ax, as) => Math.abs((b.x - a.x) * ax + (b.s - a.s) * as) > a.hl * Math.abs(ax * a.fx + as * a.fs) + a.hw * Math.abs(-ax * a.fs + as * a.fx) + b.hl * Math.abs(ax * b.fx + as * b.fs) + b.hw * Math.abs(-ax * b.fs + as * b.fx) + gap;
    return !(sep(a.fx, a.fs) || sep(-a.fs, a.fx) || sep(b.fx, b.fs) || sep(-b.fs, b.fx));
  }
  // A rectangle given by its four corners in order (either way round) as a box.
  const polyBox = o => {let x = 0, s = 0;for (let i = 0; i < 8; i += 2) {x += o[i] / 4;s += o[i + 1] / 4;}
    const a = Math.hypot(o[2] - o[0], o[3] - o[1]), c = Math.hypot(o[4] - o[2], o[5] - o[3]), h = a >= c ? Math.atan2(o[2] - o[0], o[3] - o[1]) : Math.atan2(o[4] - o[2], o[5] - o[3]);
    return box(x, s, h, Math.max(a, c, .1), Math.max(Math.min(a, c), .1));};

  // A grid of items with boxes, for "what is near this point".
  function grid(G) {
    // near() returns a shared list (an item in several cells comes several times): use it before the next near() on the same grid.
    const m = new Map(), k = (i, j) => i * 100003 + j, out = [];
    return {
      add(item, x0, s0, x1, s1) {for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(s0 / G); j <= Math.floor(s1 / G); j++) {const q = k(i, j);if (!m.has(q)) m.set(q, []);m.get(q).push(item);}},
      near(x, s, r) {
        out.length = 0;
        for (let i = Math.floor((x - r) / G); i <= Math.floor((x + r) / G); i++) for (let j = Math.floor((s - r) / G); j <= Math.floor((s + r) / G); j++) {const c = m.get(k(i, j));if (c) for (let n = 0; n < c.length; n++) out.push(c[n]);}
        return out;
      }
    };
  }

  function plan({roads = [], osm = {}, water = [], rects = [], buildings = [], points = [], clear = [], lines = [], taken = [], seed = 113, fill = {}, margin = 12} = {}) {
    const FILL = {kerb: .3, tagged: .55, lot: .4, bay: .55, rack: .6, ...fill};
    // ---------- What is where ----------
    const segs = grid(24), paths = grid(24);// roads and tracks; footpaths (only car parks and racks look at those)
    roads.forEach((r, ri) => {
      const cls = DRIVE.includes(r.k) ? (r.k === 'service' ? 'service' : 'drive') : r.k === 'tram' ? 'tram' : r.k === 'rail' || r.k === 'light_rail' || r.k === 'subway' ? 'rail' : PATHS.includes(r.k) ? 'path' : null;if (!cls) return;
      for (let i = 0; i + 3 < r.p.length; i += 2) {const a = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];(cls === 'path' ? paths : segs).add({a, ri, cls, w: r.w || 3, n: r.n || '', k: r.k}, Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3]));}
    });
    const pts = name => {const g = grid(32), o = osm[name] || [];for (let i = 0; i + 1 < o.length; i += 2) g.add([o[i], o[i + 1]], o[i], o[i + 1], o[i], o[i + 1]);return g;};
    const stops = pts('stops'), crossings = pts('crossings'), gates = pts('gates'), entrances = pts('entrances');
    // Where a footpath crosses a street's middle line there is a pedestrian crossing too (many have no crossing node).
    roads.forEach(r => {
      if (!PATHS.includes(r.k)) return;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const a = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
        for (const o of segs.near((a[0] + a[2]) / 2, (a[1] + a[3]) / 2, Math.hypot(a[2] - a[0], a[3] - a[1]) / 2 + 1)) {
          if (o.cls !== 'drive') continue;const b = o.a, d1 = [a[2] - a[0], a[3] - a[1]], d2 = [b[2] - b[0], b[3] - b[1]], den = d1[0] * d2[1] - d1[1] * d2[0];if (Math.abs(den) < 1e-9) continue;
          const t = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / den, u = ((b[0] - a[0]) * d1[1] - (b[1] - a[1]) * d1[0]) / den;
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {const x = a[0] + d1[0] * t, s = a[1] + d1[1] * t;crossings.add([x, s], x, s, x, s);}
        }
      }
    });
    const bld = grid(40);for (const o of buildings) {const b = bbox(o);bld.add({o, b}, b.x0, b.s0, b.x1, b.s1);}
    const trees = grid(16);for (let i = 0; i + 1 < points.length; i += 2) trees.add([points[i], points[i + 1]], points[i], points[i + 1], points[i], points[i + 1]);
    const wet = water.map(o => ({o, b: bbox(o)}));
    const clr = grid(32);for (const q of clear) clr.add(q, q.x - q.r, q.s - q.r, q.x + q.r, q.s + q.r);
    const placed = grid(16), addPlaced = b => placed.add(b, b.x - b.hl - b.hw, b.s - b.hl - b.hw, b.x + b.hl + b.hw, b.s + b.hl + b.hw);
    for (const t of taken) addPlaced(polyBox(t));
    // OpenStreetMap's tagged streets, to read a kerb's parking and one-way tags.
    const tagged = grid(24);
    for (const w of osm.ways || []) for (let i = 0; i + 3 < w.p.length; i += 2) {const a = [w.p[i], w.p[i + 1], w.p[i + 2], w.p[i + 3]];tagged.add({a, w}, Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3]));}
    function tagsAt(x, s, ux, us) {
      let best = null, bd = 4;
      for (const o of tagged.near(x, s, 4)) {
        const a = o.a, L = Math.hypot(a[2] - a[0], a[3] - a[1]) || 1, c = ((a[2] - a[0]) * ux + (a[3] - a[1]) * us) / L;if (Math.abs(c) < .85) continue;
        const d = segDist(x, s, a);if (d < bd) {bd = d;best = {w: o.w, same: c > 0};}
      }
      return best;
    }

    // ---------- Is this place free? ----------
    const inside = (x, s) => rects.some(r => x > r.x0 + margin && x < r.x1 - margin && s > r.s0 + margin && s < r.s1 - margin);
    const dry = (x, s) => !wet.some(w => x > w.b.x0 - 5 && x < w.b.x1 + 5 && s > w.b.s0 - 5 && s < w.b.s1 + 5 && (inPoly(x, s, w.o) || edgeDist(x, s, w.o) < 5));
    function free(c) {
      const {x, s, where} = c, b = c.box, R = b.hl + b.hw, L = b.hl * 2;
      // The cheap tests first (a place is often tried several times along a kerb before one is free).
      if (!inside(x, s)) return false;
      for (const q of clr.near(x, s, R)) if (Math.hypot(q.x - x, q.s - s) < q.r + (where === 'rack' ? .5 : b.hl)) return false;
      if (where === 'kerb') {for (const p of stops.near(x, s, 21)) if (Math.hypot(p[0] - x, p[1] - s) < 20) return false;}
      if (where !== 'rack') {
        for (const p of crossings.near(x, s, 8)) if (pointBox(b, p[0], p[1]) < (where === 'lot' ? 2 : 5)) return false;
        for (const p of gates.near(x, s, 6)) if (pointBox(b, p[0], p[1]) < 3) return false;
        for (const p of entrances.near(x, s, 6)) if (pointBox(b, p[0], p[1]) < 2.5) return false;
      }
      for (const q of placed.near(x, s, R + 1)) if (overlap(b, q, where === 'rack' ? .12 : .35)) return false;
      for (const p of trees.near(x, s, R + 1)) if (pointBox(b, p[0], p[1]) < .55) return false;
      if (lines.some(l => segBox(l.p, b) < l.r)) return false;
      // Other roads and tracks.
      for (const o of segs.near(x, s, R + 12)) {
        let need = 0;
        if (o.cls === 'tram') need = 1.7;
        else if (o.cls === 'rail') need = where === 'rack' ? 5 : 8;
        else if (where === 'kerb' || where === 'rank') {
          if (o.ri === c.ri) continue;
          need = o.cls === 'service' ? o.w / 2 + 1 : o.w / 2 + 5;
          // The same street going on (OpenStreetMap splits streets at every junction) is not a crossing street: keep as far from
          // its middle line as from your own (a fork or the other carriageway of a divided street is kept off that way too).
          if (o.n && o.n === c.n && o.cls === 'drive') {const dx = o.a[2] - o.a[0], ds = o.a[3] - o.a[1];if (Math.abs((dx * c.us - ds * c.ux) / (Math.hypot(dx, ds) || 1)) < .34) need = c.inner;}
        } else need = o.w / 2 + (where === 'rack' ? .5 : .4);
        if (need && segDist(x, s, o.a) - R < need && segBox(o.a, b) < need) return false;
      }
      if (where === 'lot') for (const o of paths.near(x, s, R + 2)) if (segDist(x, s, o.a) - R < o.w / 2 + .2 && segBox(o.a, b) < o.w / 2 + .2) return false;
      if (!dry(x, s)) return false;
      // Buildings: no corner, side middle or the centre inside one, and no building corner inside the box.
      const probe = [x, s, ...b.corners];for (let i = 0; i < 8; i += 2) probe.push((b.corners[i] + b.corners[(i + 2) % 8]) / 2, (b.corners[i + 1] + b.corners[(i + 3) % 8]) / 2);
      for (const q of bld.near(x, s, R)) {
        if (q.b.x1 < x - R || q.b.x0 > x + R || q.b.s1 < s - R || q.b.s0 > s + R) continue;
        for (let i = 0; i < probe.length; i += 2) if (inPoly(probe[i], probe[i + 1], q.o)) return false;
        for (let i = 0; i < q.o.length; i += 2) if (pointBox(b, q.o[i], q.o[i + 1]) < .05) return false;
      }
      return L > 0;
    }

    const cars = [], small = [], kerbShift = new Map();
    const put = (list, c) => {list.push({x: Math.round(c.x * 1000) / 1000, s: Math.round(c.s * 1000) / 1000, heading: Math.round(c.heading * 10000) / 10000, type: c.type, colour: c.colour, where: c.where});addPlaced(c.box);};
    const colourOf = (rnd, type) => pick(rnd, CW[type] || CW.car);
    const mixes = {};for (const [k, m] of Object.entries(MIX)) mixes[k] = {names: Object.keys(m), w: Object.values(m)};
    function typeOf(rnd, x, s, big) {
      const mix = mixes[industrial(x, s) ? 'industry' : 'city'];let t = mix.names[pick(rnd, mix.w)];
      if (t === 'lorry' && !big) t = 'van';// a lorry only by a wide street's kerb (it would reach the middle of a narrow one)
      return t;
    }
    // A Markov chain for runs: after a filled place the next is filled with p = .8, after an empty one with b, so the mean is p0.
    const runner = p0 => {const A = .8, B = Math.min(.95, p0 * (1 - A) / Math.max(.05, 1 - p0));let on = false;return rnd => (on = rnd() < (on ? A : B));};

    // ---------- Taxi ranks: two to four taxis queued at the kerb (first: the rank is theirs) ----------
    const taxis = osm.taxis || [];
    for (let i = 0; i + 2 < taxis.length; i += 3) {
      const x0 = taxis[i], s0 = taxis[i + 1], rnd = rng(seed * 4001 + i);let best = null, bd = 25;
      for (const q of segs.near(x0, s0, 25)) {if (q.cls !== 'drive') continue;const d = segDist(x0, s0, q.a);if (d < bd) {bd = d;best = q;}}
      if (!best) continue;
      const a = best.a, L = Math.hypot(a[2] - a[0], a[3] - a[1]) || 1, ux = (a[2] - a[0]) / L, us = (a[3] - a[1]) / L, t0 = (x0 - a[0]) * ux + (s0 - a[1]) * us;
      const side = (x0 - a[0]) * us - (s0 - a[1]) * ux < 0 ? 1 : -1, nx = -us * side, ns = ux * side, off = best.w / 2 - KERB_GAP - TYPES.taxi.W / 2;
      const n = Math.min(4, Math.max(2, taxis[i + 2] || 3));let made = 0;
      for (let k = 0; k < 8 && made < n; k++) {
        const t = t0 - side * k * (TYPES.taxi.L + 1), x = a[0] + ux * t + nx * off, s = a[1] + us * t + ns * off, heading = Math.atan2(ux * side, us * side), b = box(x, s, heading, TYPES.taxi.L, TYPES.taxi.W);
        const c = {x, s, heading, type: 'taxi', colour: colourOf(rnd, 'taxi'), where: 'rank', ri: best.ri, n: '', ux, us, inner: off - TYPES.taxi.W / 2 - .35, box: b};
        if (free(c)) {put(cars, c);made++;}
      }
    }

    // ---------- Kerbs ----------
    roads.forEach((r, ri) => {
      const sides0 = STREET[r.k];if (sides0 === undefined || r.p.length < 4) return;
      const P = r.p, cum = [0];for (let i = 2; i < P.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(P[i] - P[i - 2], P[i + 1] - P[i - 1]));
      const total = cum[cum.length - 1];if (total < 8) return;
      let k = 0;const at = t => {while (k > 0 && cum[k] > t) k--;while (k < cum.length - 2 && cum[k + 1] < t) k++;const L = cum[k + 1] - cum[k] || 1, f = (t - cum[k]) / L, ux = (P[2 * k + 2] - P[2 * k]) / L, us = (P[2 * k + 3] - P[2 * k + 1]) / L;return {x: P[2 * k] + ux * L * f, s: P[2 * k + 1] + us * L * f, ux, us, k};};
      // One-sided streets park on one side for the whole street (the side from its name, so it is the same on every piece).
      const segTag = [];let h = 7;for (const ch of r.n || String(ri)) h = (h * 31 + ch.charCodeAt(0)) % 1000003;const oneSide = h % 2 ? 1 : -1;
      for (const side of [1, -1]) {
        const rnd = rng(seed * 7907 + ri * 131 + (side > 0 ? 1 : 2)), next = runner(FILL.kerb), nextTagged = runner(FILL.tagged);
        let t = 2 + rnd() * 5;k = 0;
        while (t < total - 2) {
          const c0 = at(Math.min(total, t + 2.5)), q = 2 * c0.k;
          if (segTag[c0.k] === undefined) segTag[c0.k] = tagsAt((P[q] + P[q + 2]) / 2, (P[q + 1] + P[q + 3]) / 2, c0.ux, c0.us);// the tags of this piece of the street
          const tg = segTag[c0.k];
          // Parking on this kerb: from the tags (left / right of the OSM way's direction), else from the street's kind.
          let mode = -1, oneway = 0;
          if (tg) {const v = side > 0 === tg.same ? tg.w.r : tg.w.l;mode = v;oneway = tg.same ? tg.w.o : -tg.w.o;}
          const isTagged = mode >= 0;
          if (mode < 0) mode = sides0 === 2 || (oneway && sides0 === 1) ? (r.w >= 6.4 ? 1 : side === oneSide ? 1 : 0) : sides0 === 1 && side === oneSide && r.w >= 5.4 ? 1 : 0;
          if (!mode) {t += 4;continue;}
          const orient = mode & 3, place = mode & 12, filled = (isTagged ? nextTagged : next)(rnd);
          const ty0 = typeOf(rnd, c0.x, c0.s, r.w >= 7.5), col0 = rnd(), gap = .6 + rnd() * .9, two = rnd();
          if (!filled) {t += 5.5;continue;}
          // Now and then a motorcycle or a moped stands at an angle in the row, its back wheel to the kerb.
          let type = ty0;if (orient === 1 && two < .045) type = two < .025 ? 'motorcycle' : 'moped';
          const T = TYPES[type], angled = type === 'motorcycle' || type === 'moped', sc = 1;
          const face = oneway ? oneway : side, ang = orient === 2 ? Math.PI / 4 : orient === 3 ? Math.PI / 2 : angled ? Math.PI / 3 : 0;
          const along = ang ? T.W / Math.sin(ang) + (angled ? .25 : .5) : T.L * sc, depth = ang ? T.L * Math.sin(ang) + T.W * Math.cos(ang) : T.W;
          const c = at(t + along / 2), nx = -c.us * side, ns = c.ux * side;// (nx, ns) points from the middle of the road to this kerb
          const layby = ang && !angled && place === 0 && r.w / 2 - depth < 2.6;// angled bays narrower than the road: in a lay-by
          const offOf = d => layby ? r.w / 2 + d / 2 - .4 : (place === 8 ? r.w / 2 + d : place === 4 ? r.w / 2 + d / 2 : r.w / 2 - KERB_GAP) - d / 2;// (edge: where the vehicle's outer side is)
          const off = offOf(depth);
          const x = c.x + nx * off, s = c.s + ns * off;
          // Parallel: nose along the traffic. Angled cars nose in towards the kerb; motorcycles nose out, leaning toward the traffic.
          let fx = c.ux * face, fs = c.us * face;
          if (angled) {fx = -nx * Math.sin(ang) + c.ux * face * Math.cos(ang);fs = -ns * Math.sin(ang) + c.us * face * Math.cos(ang);}
          else if (ang) {fx = nx * Math.sin(ang) + c.ux * face * Math.cos(ang);fs = ns * Math.sin(ang) + c.us * face * Math.cos(ang);}
          const heading = Math.atan2(fx, fs), b = box(x, s, heading, T.L * sc, T.W * sc);
          const cand = {x, s, heading, type, colour: colourOf(() => col0, type), where: 'kerb', ri, n: r.n || '', ux: c.ux, us: c.us, inner: off - depth / 2 - .35, box: b};
          // On a bend the car must still be by the kerb: no part of it in the other half of the road.
          let onRoad = true;for (let i = 0; i + 3 < P.length; i += 2) if (Math.abs(i / 2 - c.k) <= 2 && segBox([P[i], P[i + 1], P[i + 2], P[i + 3]], b) < off - depth / 2 - .35) onRoad = false;
          if (onRoad && free(cand)) {
            put(type === 'moped' ? small : cars, cand);t += along + gap;
            // An estate that becomes a V70 (below) stands as close to the kerb as its own width gives.
            if (type === 'estate') {const V = TYPES.v70, d = ang ? V.L * Math.sin(ang) + V.W * Math.cos(ang) : V.W, m = offOf(d) - off;kerbShift.set(cars.length - 1, [x + nx * m, s + ns * m]);}
          }
          else t += 1.5;
        }
      }
    });

    // ---------- Car parks ----------
    (osm.lots || []).forEach((lot, li) => {
      const o = lot.p;if (o.length < 6 || area(o) < 40) return;
      const rnd = rng(seed * 6007 + li * 89 + 3), bay = lot.k !== 'surface';
      // The longest side gives the rows' direction.
      let best = 0, ux = 1, us = 0;
      for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {const L = Math.hypot(o[i] - o[j], o[i + 1] - o[j + 1]);if (L > best) {best = L;ux = (o[i] - o[j]) / L;us = (o[i + 1] - o[j + 1]) / L;}}
      const vx = -us, vs = ux;let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < o.length; i += 2) {const u = o[i] * ux + o[i + 1] * us, v = o[i] * vx + o[i + 1] * vs;u0 = Math.min(u0, u);u1 = Math.max(u1, u);v0 = Math.min(v0, v);v1 = Math.max(v1, v);}
      const next = runner(bay ? FILL.bay : FILL.lot), cap = lot.c || Infinity;let n = 0;
      const tryAt = (u, v, heading, type, col, along) => {
        const x = u * ux + v * vx, s = u * us + v * vs, T = TYPES[type], b = box(x, s, heading, T.L, T.W);
        for (let i = 0; i < 8; i += 2) if (!inPoly(b.corners[i], b.corners[i + 1], o) && edgeDist(b.corners[i], b.corners[i + 1], o) > (bay ? .9 : .25)) return false;
        const c = {x, s, heading, type, colour: col, where: 'lot', box: b, along};
        if (!free(c)) return false;put(cars, c);n++;return true;
      };
      if (bay && v1 - v0 < 4) {// a parking lane mapped as an area: parallel, nose along the street's traffic on this side
        const mid = (v0 + v1) / 2, cx = ((u0 + u1) / 2) * ux + mid * vx, cs = ((u0 + u1) / 2) * us + mid * vs;
        let face = 1;{let bd = 30;for (const q of segs.near(cx, cs, 30)) {if (q.cls !== 'drive') continue;const d = segDist(cx, cs, q.a);if (d < bd) {bd = d;const dx = q.a[2] - q.a[0], ds = q.a[3] - q.a[1], right = (cx - q.a[0]) * ds - (cs - q.a[1]) * dx < 0 ? -1 : 1;face = Math.sign(dx * ux + ds * us || 1) * right;}}}
        for (let u = u0 + .5; u < u1 - 2 && n < cap;) {const type = typeOf(rnd, cx, cs, false), col = rnd(), T = TYPES[type];if (!next(rnd)) {u += 5.5;continue;}
          u += tryAt(u + T.L / 2, mid, Math.atan2(ux * face, us * face), type, colourOf(() => col, type)) ? T.L + .7 + rnd() * .8 : 1;}
        return;
      }
      // Rows of 5 m bays 2.5 m wide, nose in, between 6 m aisles: a row along the first side, then two rows back to back, …
      const rows = [];for (let v = v0 + .3, k = 0; v + 4.8 < v1; k++) {if (k === 0) {rows.push([v + 2.5, -1]);v += 5 + 6;} else {rows.push([v + 2.5, 1]);if (v + 10 <= v1) rows.push([v + 7.5, -1]);v += 10 + 6;}}
      for (const [v, dir] of rows) for (let u = u0 + .6; u + 2.2 < u1 && n < cap; u += 2.5) {
        const type0 = typeOf(rnd, u * ux + v * vx, u * us + v * vs, true), col = rnd(), flip = rnd() < .25;if (!next(rnd)) continue;
        const type = type0 === 'lorry' ? 'van' : type0, heading = Math.atan2(vx * dir * (flip ? -1 : 1), vs * dir * (flip ? -1 : 1));
        tryAt(u + 1.25, v, heading, type, colourOf(() => col, type));
      }
    });

    // ---------- Bicycles (and a few mopeds) at the bike racks ----------
    const racks = osm.bikes || [];
    for (let i = 0; i + 2 < racks.length; i += 3) {
      const x0 = racks[i], s0 = racks[i + 1], rnd = rng(seed * 3001 + i * 7);if (rnd() > FILL.rack) continue;
      // Bikes stand side by side across the nearest street or path, in a row along it.
      let ux = 1, us = 0, bd = 30;for (const q of segs.near(x0, s0, 30)) {if (q.cls === 'tram' || q.cls === 'rail') continue;const d = segDist(x0, s0, q.a);if (d < bd) {bd = d;const L = Math.hypot(q.a[2] - q.a[0], q.a[3] - q.a[1]) || 1;ux = (q.a[2] - q.a[0]) / L;us = (q.a[3] - q.a[1]) / L;}}
      const cap = racks[i + 2], n = cap ? Math.max(2, Math.min(8, Math.round(cap * (.2 + rnd() * .3)))) : 2 + Math.floor(rnd() * 4), into = rnd() < .5 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const t = (k - (n - 1) / 2) * .76, type = rnd() < .1 ? 'moped' : 'bicycle', T = TYPES[type], col = rnd(), heading = Math.atan2(-us * into + (rnd() - .5) * .12, ux * into);
        const x = x0 + ux * t * (type === 'moped' ? 1.4 : 1), s = s0 + us * t * (type === 'moped' ? 1.4 : 1), c = {x, s, heading, type, colour: colourOf(() => col, type), where: 'rack', box: box(x, s, heading, T.L, T.W)};
        if (free(c)) put(small, c);
      }
    }
    // ---------- Grey Volvo V70s (issue #149) ----------
    // Chosen from the estates once every place is set, with their own random numbers: the V70 is a little shorter and
    // narrower than the estate whose place it takes (it moves 2 cm to the kerb), so no other vehicle changes. The estate nearest to
    // Haarklous plass 17A is always one (grey).
    {
      const rnd = rng(seed * 149 + 70);let home = -1, hd = Infinity;
      const toV70 = (i, colour) => {const c = cars[i];if (c.type === 'estate') {const m = kerbShift.get(i);if (m) {c.x = Math.round(m[0] * 1000) / 1000;c.s = Math.round(m[1] * 1000) / 1000;}}c.type = 'v70';c.colour = colour;};
      cars.forEach((c, i) => {
        if (c.type !== 'estate') return;
        const v = rnd() < V70[industrial(c.x, c.s) ? 'industry' : 'city'], col = rnd();if (v) toV70(i, colourOf(() => col, 'v70'));
        const d = Math.hypot(c.x, c.s);if (d < hd) {hd = d;home = i;}
      });
      if (home >= 0) toV70(home, 2);
    }
    return {cars, small};
  }
  // The plan is made once by tools/make-parking.cjs and stored in parking-data.js as integers: per vehicle the change of x and s
  // from the one before (decimetres), the heading (milliradians) and (type × 16 + colour) × 4 + where.
  const TYPE_LIST = Object.keys(TYPES), WHERE = ['kerb', 'lot', 'rank', 'rack'];
  function pack(list) {
    const o = [];let x = 0, s = 0;
    for (const c of list) {const X = Math.round(c.x * 10), S = Math.round(c.s * 10);o.push(X - x || 0, S - s || 0, Math.round(c.heading * 1000) || 0, (TYPE_LIST.indexOf(c.type) * 16 + c.colour) * 4 + WHERE.indexOf(c.where));x = X;s = S;}// (|| 0: no -0, as in the stored file)
    return o;
  }
  function unpack(o) {
    const out = [];let x = 0, s = 0;
    for (let i = 0; i + 3 < o.length; i += 4) {x += o[i];s += o[i + 1];const k = o[i + 3];out.push({x: x / 10, s: s / 10, heading: o[i + 2] / 1000, type: TYPE_LIST[k >> 6], colour: (k >> 2) & 15, where: WHERE[k & 3]});}
    return out;
  }
  // What the game itself keeps free at run time: drops the vehicles in a circle {x, s, r} (r plus half the vehicle), within r of a
  // band {p, r}, or on a footprint of a vehicle that is there already (flat corner lists). The same on every computer.
  function keep(list, {clear = [], lines = [], taken = []} = {}) {
    const clr = grid(32), held = grid(16);
    for (const q of clear) clr.add(q, q.x - q.r, q.s - q.r, q.x + q.r, q.s + q.r);
    for (const t of taken) {const b = polyBox(t);held.add(b, b.x - b.hl - b.hw, b.s - b.hl - b.hw, b.x + b.hl + b.hw, b.s + b.hl + b.hw);}
    return list.filter(c => {
      const T = TYPES[c.type], b = box(c.x, c.s, c.heading, T.L, T.W), R = b.hl + b.hw;
      for (const q of clr.near(c.x, c.s, R)) if (Math.hypot(q.x - c.x, q.s - c.s) < q.r + (c.where === 'rack' ? .5 : b.hl)) return false;
      for (const q of held.near(c.x, c.s, R + 1)) if (overlap(b, q, .35)) return false;
      return !lines.some(l => segBox(l.p, b) < l.r);
    });
  }
  return {plan, pack, unpack, keep, TYPES, COLOURS, box, overlap, segBox, inPoly, industrial};
});
