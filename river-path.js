/* Akerselva – turvei (issue #147): one path along the river for walking and cycling, from Bjølsen to Vaterland, on the real
 * OpenStreetMap ways (river-path-data.js, made by tools/make-river-path.cjs). Pure (Node-tested, tests/river-path.test.cjs).
 *   RiverPath.pieces(RP, A) -> the band stretches for RoadSurface.create({paths}): [{k: 'riverpath', w, n, p, surf (1 gravel,
 *     2 asphalt), lo(x, s) (the lowest the band may be there: 0.5 m over the water near the river), hi(t) (the highest, t along
 *     the piece: under an Akerselva bridge, room for 2.4 m of headroom), under [[t0, t1]] (where it passes under a bridge: there
 *     the band has the say over the street that goes over the bridge), pins [y0, y1] (the height it meets a bridge deck at, at
 *     its start and end, or null), a0 (where the piece starts along the route)}]
 *   RiverPath.index(RP) -> {dist(x, s) (metres from the route's centre line, bridges left out), along(a) -> [x, s, fx, fs], L}
 *   RiverPath.clear(index, x, s, r) -> false when something of radius r at (x, s) would stand on the path (trees, lamps, bushes)
 * Data: {name, w, pts [x, s, ...] (the centre line), runs [[i0, i1, kind, surf]] (vertex ranges; kind 0 band, 1 on a street,
 *   2 on an Akerselva bridge; a band meeting a deck: + its height at the deck's end at its start and its end), under [[a0, a1, cap]] (along the route), lamps [x, s, ...], benches [x, s, heading, ...], ways}.
 * Local frame: x east, s south (metres); heights relative to the stair door.
 */
(function (root, factory) {
  const m = factory();root.RiverPath = m;if (typeof module !== 'undefined' && module.exports) module.exports = m;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const BAND = 0, STREET = 1, BRIDGE = 2, WATER_GAP = .5;
  // Arc length at every vertex of the centre line.
  function cumOf(p) {const n = p.length / 2, c = new Float64Array(n);for (let k = 1; k < n; k++) c[k] = c[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);return c;}
  // The river's centre line in a 16 m hash: the water level and the half width on that side of the nearest point.
  function riverAt(A) {
    const P = A.pts, n = P.length / 2, cell = 16, map = new Map();
    for (let k = 0; k + 1 < n; k++) {
      const x0 = Math.min(P[k * 2], P[k * 2 + 2]), x1 = Math.max(P[k * 2], P[k * 2 + 2]), s0 = Math.min(P[k * 2 + 1], P[k * 2 + 3]), s1 = Math.max(P[k * 2 + 1], P[k * 2 + 3]);
      for (let i = Math.floor((x0 - 48) / cell); i <= Math.floor((x1 + 48) / cell); i++) for (let j = Math.floor((s0 - 48) / cell); j <= Math.floor((s1 + 48) / cell); j++) {const key = i * 100000 + j;if (!map.has(key)) map.set(key, []);map.get(key).push(k);}
    }
    return (x, s) => {
      const list = map.get(Math.floor(x / cell) * 100000 + Math.floor(s / cell));if (!list) return null;
      let bk = -1, bu = 0, bd = Infinity;
      for (const k of list) {const ax = P[k * 2], as = P[k * 2 + 1], dx = P[k * 2 + 2] - ax, ds = P[k * 2 + 3] - as, u = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1))), d = Math.hypot(x - ax - u * dx, s - as - u * ds);if (d < bd) {bd = d;bk = k;bu = u;}}
      const k = bk, dx = P[k * 2 + 2] - P[k * 2], ds = P[k * 2 + 3] - P[k * 2 + 1], l = Math.hypot(dx, ds) || 1, side = ((x - P[k * 2]) * -ds + (s - P[k * 2 + 1]) * dx) / l;
      const lerp = a => a[k] + (a[k + 1] - a[k]) * bu;
      return {d: bd, side, half: side < 0 ? lerp(A.wl) : lerp(A.wr), level: lerp(A.level), t: (k + bu) * A.step};
    };
  }
  function pieces(RP, A) {
    if (!RP || !RP.pts) return [];
    const cum = cumOf(RP.pts), river = A ? riverAt(A) : null, under = RP.under || [];
    const lo = (x, s) => {const r = river && river(x, s);return r && r.d < r.half + 30 ? r.level + WATER_GAP : -Infinity;};
    const out = [];
    for (const [i0, i1, kind, surf, pin0 = null, pin1 = null] of RP.runs) {
      if (kind !== BAND || i1 <= i0) continue;
      const a0 = cum[i0], a1 = cum[i1];
      // (the caps on this piece: road-surface.js lowers the band to them with ramps of 6 % either side)
      const caps = under.filter(([u0, u1]) => u1 > a0 && u0 < a1);
      const hi = caps.length ? t => {const a = a0 + t;let h = Infinity;for (const [u0, u1, cap] of caps) if (a >= u0 && a <= u1) h = Math.min(h, cap);return h;} : null;
      out.push({k: 'riverpath', w: RP.w || 3, n: RP.name || '', p: RP.pts.slice(i0 * 2, i1 * 2 + 2), surf: surf || 2, lo, hi, a0, under: caps.map(([u0, u1]) => [u0 - a0, u1 - a0]), pins: [pin0, pin1]});
    }
    return out;
  }
  // Distance to the route's centre line (its band and street stretches; not the bridge decks, which have their own railings).
  function index(RP) {
    const p = RP.pts, n = p.length / 2, cum = cumOf(p), cell = 16, map = new Map(), skip = new Uint8Array(n);
    for (const [i0, i1, kind] of RP.runs) if (kind === BRIDGE) for (let k = i0; k < i1; k++) skip[k] = 1;
    for (let k = 0; k + 1 < n; k++) {
      if (skip[k]) continue;
      const x0 = Math.min(p[k * 2], p[k * 2 + 2]), x1 = Math.max(p[k * 2], p[k * 2 + 2]), s0 = Math.min(p[k * 2 + 1], p[k * 2 + 3]), s1 = Math.max(p[k * 2 + 1], p[k * 2 + 3]);
      for (let i = Math.floor((x0 - 8) / cell); i <= Math.floor((x1 + 8) / cell); i++) for (let j = Math.floor((s0 - 8) / cell); j <= Math.floor((s1 + 8) / cell); j++) {const key = i * 100000 + j;if (!map.has(key)) map.set(key, []);map.get(key).push(k);}
    }
    function dist(x, s) {
      const list = map.get(Math.floor(x / cell) * 100000 + Math.floor(s / cell));if (!list) return Infinity;
      let m = Infinity;for (const k of list) {const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, u = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));m = Math.min(m, Math.hypot(x - ax - u * dx, s - as - u * ds));}
      return m;
    }
    function along(a) {
      a = Math.max(0, Math.min(cum[n - 1], a));let lo = 0, hi = n - 1;while (hi - lo > 1) {const m = (lo + hi) >> 1;if (cum[m] <= a) lo = m;else hi = m;}
      const dx = p[hi * 2] - p[lo * 2], ds = p[hi * 2 + 1] - p[lo * 2 + 1], l = Math.hypot(dx, ds) || 1, f = (a - cum[lo]) / l;
      return [p[lo * 2] + dx * f, p[lo * 2 + 1] + ds * f, dx / l, ds / l, lo];
    }
    const kindAt = k => {for (const r of RP.runs) if (k >= r[0] && k < r[1]) return r[2];return STREET;};
    return {dist, along, cum, L: cum[n - 1], kindAt, hw: (RP.w || 3) / 2};
  }
  const clear = (ix, x, s, r) => !ix || ix.dist(x, s) > ix.hw + r + .3;
  return {pieces, index, clear, riverAt, cumOf, BAND, STREET, BRIDGE};
});
