/* Parked cars all over the city (issue #105): where they stand. Pure (also used by the Node tests); the game builds the cars.
 *
 * GameCityCars.plan({roads, lots, water, rects, clear, cell, per, gap, seed, ok}) -> [{x, s, heading, model, lot}]
 *   roads  [{k, w, p (flat x, s, …)}]   every road of the map (the old square's and the district patches')
 *   lots   [flat polygon]               car parks (OSM amenity=parking areas)
 *   water  [flat polygon]               rivers, ponds and the sea: nothing is parked in or beside them
 *   rects  [{x0, s0, x1, s1}]           where you can walk (Surroundings.walkRects); cars stay 15 m inside
 *   clear  [{x, s, r}]                  circles to keep free (the cars that are there already, the driving test's route)
 *   ok(spot)                            the game's own check (room between buildings and trees, not too steep)
 * The city is cut into squares of `cell` metres and each square gets up to `per` cars at least `gap` metres apart, so they are
 * spread evenly. A street car stands in the road by the kerb, on the right-hand side, facing the way the traffic goes; a car
 * park car stands along the car park's longest side. Nothing stands at a crossing, on tram rails or beside a railway.
 * Everything is seeded: the same map gives the same cars on every computer, so a lobby agrees on them.
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A; heading as atan2(east, south) like the old street cars.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameCityCars = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const STREET = ['residential', 'tertiary', 'secondary', 'unclassified'];// streets with cars parked along them
  const DRIVEN = [...STREET, 'primary', 'trunk', 'trunk_link', 'motorway_link', 'service', 'living_street', 'pedestrian'];
  const RAILS = {tram: 3.4, rail: 12};// metres to keep from the centre of a track
  const KERB = 1.05;// from the car's centre line to the kerb (the car is 1.8 m wide)
  const rng = seed => {let r = (seed % 2147483646 + 2147483646) % 2147483646 + 1;return () => (r = (r * 16807) % 2147483647) / 2147483647;};
  const segDist = (x, s, a) => {const dx = a[2] - a[0], ds = a[3] - a[1], L = dx * dx + ds * ds || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (s - a[1]) * ds) / L));return Math.hypot(x - a[0] - dx * t, s - a[1] - ds * t);};
  const box = o => {let x0 = Infinity, s0 = Infinity, x1 = -Infinity, s1 = -Infinity;for (let i = 0; i < o.length; i += 2) {x0 = Math.min(x0, o[i]);x1 = Math.max(x1, o[i]);s0 = Math.min(s0, o[i + 1]);s1 = Math.max(s1, o[i + 1]);}return {x0, s0, x1, s1};};
  function inPoly(x, s, o) {
    let inside = false;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > s) !== (o[j + 1] > s) && x < (o[j] - o[i]) * (s - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) inside = !inside;
    return inside;
  }
  const edgeDist = (x, s, o) => {let d = Infinity;for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) d = Math.min(d, segDist(x, s, [o[j], o[j + 1], o[i], o[i + 1]]));return d;};
  const area = o => {let a = 0;for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) a += o[j] * o[i + 1] - o[i] * o[j + 1];return Math.abs(a) / 2;};

  function plan({roads = [], lots = [], water = [], rects = [], clear = [], cell = 300, per = 2, gap = 45, seed = 105, ok = () => true} = {}) {
    // Every road and track in a grid, to find what runs near a spot.
    const G = 80, grid = new Map(), key = (i, j) => i * 100003 + j;
    roads.forEach((r, ri) => {
      const keep = DRIVEN.includes(r.k) ? r.w / 2 + 3.2 : RAILS[r.k];if (!keep) return;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const a = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]], seg = {a, ri, keep};
        for (let gi = Math.floor((Math.min(a[0], a[2]) - 16) / G); gi <= Math.floor((Math.max(a[0], a[2]) + 16) / G); gi++) for (let gj = Math.floor((Math.min(a[1], a[3]) - 16) / G); gj <= Math.floor((Math.max(a[1], a[3]) + 16) / G); gj++) {
          const k = key(gi, gj);if (!grid.has(k)) grid.set(k, []);grid.get(k).push(seg);
        }
      }
    });
    const near = (x, s) => grid.get(key(Math.floor(x / G), Math.floor(s / G))) || [];
    const wet = water.map(o => ({o, b: box(o)}));
    const dry = (x, s) => !wet.some(w => x > w.b.x0 - 5 && x < w.b.x1 + 5 && s > w.b.s0 - 5 && s < w.b.s1 + 5 && (inPoly(x, s, w.o) || edgeDist(x, s, w.o) < 5));
    const inside = (x, s) => rects.some(r => x > r.x0 + 15 && x < r.x1 - 15 && s > r.s0 + 15 && s < r.s1 - 15);
    const free = (x, s) => !clear.some(c => Math.hypot(c.x - x, c.s - s) < c.r);

    // A street car keeps clear of every other street and track (crossings, tram rails, railways). A car park car keeps off
    // the streets and tracks too, and 2.6 m from the middle of a service road (the car park's own aisles).
    const roadsClear = c => !near(c.x, c.s).some(o => o.ri !== c.ri && segDist(c.x, c.s, o.a) < (!c.lot ? o.keep : o.keep > 5.01 ? o.keep - 1.2 : 2.6));

    // Candidates: every 13 m along both kerbs of the streets, and a few places in each car park. (The dearer checks wait
    // until a candidate is drawn: most never are.)
    const cells = new Map(), add = c => {const k = key(Math.floor(c.x / cell), Math.floor(c.s / cell));if (!cells.has(k)) cells.set(k, []);cells.get(k).push(c);};
    roads.forEach((r, ri) => {
      if (!STREET.includes(r.k)) return;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const dx = r.p[i + 2] - r.p[i], ds = r.p[i + 3] - r.p[i + 1], L = Math.hypot(dx, ds);if (L < 16) continue;
        const ux = dx / L, us = ds / L, off = r.w / 2 - KERB;
        for (let t = 8; t <= L - 8; t += 13) for (const side of [1, -1]) {
          const x = r.p[i] + ux * t - us * off * side, s = r.p[i + 1] + us * t + ux * off * side;
          if (inside(x, s)) add({x, s, heading: Math.atan2(ux * side, us * side), lot: false, ri});
        }
      }
    });
    lots.forEach((o, li) => {
      if (area(o) < 150) return;
      const b = box(o), rnd = rng(seed * 7919 + li * 31 + 17);
      let best = 0, heading = 0;
      for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {const L = Math.hypot(o[i] - o[j], o[i + 1] - o[j + 1]);if (L > best) {best = L;heading = Math.atan2(o[i] - o[j], o[i + 1] - o[j + 1]);}}
      for (let n = 0, made = 0; n < 12 && made < 3; n++) {
        const x = b.x0 + rnd() * (b.x1 - b.x0), s = b.s0 + rnd() * (b.s1 - b.s0), turn = rnd() < .5 ? Math.PI : 0;
        if (!inPoly(x, s, o) || edgeDist(x, s, o) < 2.6 || !inside(x, s)) continue;
        add({x, s, heading: heading + turn, lot: true, ri: -1});made++;
      }
    });

    // Up to `per` cars in each square, in a seeded order, never closer than `gap` to another new car.
    const out = [], taken = new Map(), tk = (x, s) => key(Math.floor(x / gap), Math.floor(s / gap));
    const apart = (x, s) => {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of taken.get(key(Math.floor(x / gap) + i, Math.floor(s / gap) + j)) || []) if (Math.hypot(q.x - x, q.s - s) < gap) return false;
      return true;
    };
    for (const k of [...cells.keys()].sort((a, b) => a - b)) {
      const list = cells.get(k), rnd = rng(seed * 104729 + k);
      for (let i = list.length - 1; i > 0; i--) {const j = Math.floor(rnd() * (i + 1));[list[i], list[j]] = [list[j], list[i]];}
      // A car park in the square is tried first, so car parks get their share (the streets have far more candidates).
      const lot = list.findIndex(c => c.lot);if (lot > 0) list.unshift(list.splice(lot, 1)[0]);
      let got = 0;
      for (let n = 0; n < list.length && n < 80 && got < per; n++) {
        const c = list[n];if (!apart(c.x, c.s) || !free(c.x, c.s) || !roadsClear(c) || !dry(c.x, c.s)) continue;
        const spot = {x: c.x, s: c.s, heading: c.heading, model: Math.floor(rnd() * 7), lot: c.lot};if (!ok(spot)) continue;
        out.push(spot);got++;const t = tk(c.x, c.s);if (!taken.has(t)) taken.set(t, []);taken.get(t).push(spot);
      }
    }
    return out;
  }
  return {plan, STREET, KERB, inPoly};
});
