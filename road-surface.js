/* Flat streets with clear edges (issue #112). One ground surface for the whole world: what you see is exactly what wheels and
 * feet stand on.
 *  - Car streets are flat across their width and follow a smoothed profile of the real ground along their length (Gaussian,
 *    sigma 8 m, robust: a ravine under a bridge is left out of the smoothing), so they still climb the real hills but the 4 / 8 m
 *    height grid's noise and its decimetre steps are gone. Where streets meet, the minor street's profile is bent (over 30 m) to
 *    meet the major one, and inside a junction the levels blend, so there are no steps.
 *  - Pavements stand a kerb (12 cm) above the road; the kerb is an 18 cm granite strip with a vertical face. A road with no
 *    pavement ends at a 4 cm asphalt edge; a trunk road has a white edge line. The ground beside a street eases back to the real
 *    terrain over a few metres.
 *  - The ground grids (4 m old square, 8 m district patches) keep their triangles. Each triangle a street edge crosses is cut
 *    along the exact edge lines (every street is a set of straight bands in its own coordinates: across y, along t), so kerbs are
 *    sharp and vertical whatever the grid. Both the drawn mesh (tile()) and the height query (height()) come from the same cut
 *    pieces, so they agree to rounding.
 * RoadSurface.create({natural(x, s), grids, gridFor(x, s), sets: [{roads, owns(x, s)}]}) -> {height(x, s), classAt(x, s),
 *   tile(grid, i0, j0, i1, j1, skipCell) -> {pos, nor, cls, index}, chains, stats}
 * Classes (vertex attribute aGround in the terrain shader): 0 other ground (the painting decides), 1 road, 2 kerb top, 3 kerb face,
 *   4 pavement (asphalt), 5 white edge line, 6 asphalt edge face, 7 pavement (granite slabs).
 * Local frame: x east, s south (metres); heights in the caller's units (metres relative to the stair door).
 */
(function (root, factory) {
  const m = factory();root.RoadSurface = m;if (typeof module !== 'undefined' && module.exports) module.exports = m;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  // Pavement widths of the car streets (issue #67, typical Oslo streets); the painting uses the same table.
  const SIDEWALK = {residential: 2.2, living_street: 1.4, unclassified: 1.8, tertiary: 2.8, tertiary_link: 2, secondary: 3, secondary_link: 2, primary: 3.2, primary_link: 2};
  // Weight of a street where streets meet: the major street keeps its line, the minor one bends to meet it.
  const RANK = {motorway: 8, trunk: 7, primary: 6, motorway_link: 5, trunk_link: 5, secondary: 5, primary_link: 4, tertiary: 4, secondary_link: 3.5, tertiary_link: 3,
    unclassified: 2, residential: 2, living_street: 1.5, service: .15};
  const EDGE_LINE = {motorway: 1, trunk: 1, motorway_link: 1, trunk_link: 1};
  const KERB_H = .12, KERB_W = .18, VERGE = 0, LINE_IN = .2, LINE_W = .15;
  // Bridges (issue #139): the deck's depth under the road surface, the parapets' thickness, and the room a bridge leaves over
  // what passes under it.
  const DECK = .9, PARAPET = .35;
  const WATER_UNDER = new Set(['river', 'canal', 'stream', 'ditch', 'drain', 'water']);
  const PATHS = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track', 'bridleway']);
  const clearanceOver = k => k === 'river' ? 1.8 : WATER_UNDER.has(k) ? 1 : PATHS.has(k) ? 2.6 : 4.7;
  const C = {OTHER: 0, ROAD: 1};
  const SIGMA = 8, DS = 2, LAMBDA = 3, MASK = 6, PIN = 30;
  const smooth = (a, b, x) => {const t = Math.max(0, Math.min(1, (x - a) / (b - a)));return t * t * (3 - 2 * t);};

  // ---------- Streets: pieces per data set, joined end to end into chains ----------
  function chainsOf(sets, slabsAt) {
    const pieces = [];
    // Every car-road segment of every data set in a 32 m grid: a segment outside its own set's area is still kept when the set
    // that owns that place has no street there (the old square's data lacks some streets near its edge that a patch has).
    const grid = new Map(), cellOf = (x, s) => `${Math.floor(x / 32)},${Math.floor(s / 32)}`;
    sets.forEach((set, k) => {for (const r of set.roads) if (RANK[r.k]) for (let i = 0; i + 3 < r.p.length; i += 2) {
      const key = cellOf((r.p[i] + r.p[i + 2]) / 2, (r.p[i + 1] + r.p[i + 3]) / 2);if (!grid.has(key)) grid.set(key, []);grid.get(key).push([k, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]]);
    }});
    const covered = (k, x, s) => {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [q, ax, as, bx, bs] of grid.get(`${Math.floor(x / 32) + a},${Math.floor(s / 32) + b}`) || []) {
        if (q === k || !sets[q].owns(x, s)) continue;
        const dx = bx - ax, ds = bs - as, u = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));if (Math.hypot(x - ax - u * dx, s - as - u * ds) < 2) return true;
      }
      return false;
    };
    sets.forEach((set, k) => {for (const r of set.roads) {
      if (!RANK[r.k]) continue;
      let cur = null;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i], as = r.p[i + 1], bx = r.p[i + 2], bs = r.p[i + 3], mx = (ax + bx) / 2, ms = (as + bs) / 2;
        if (Math.hypot(bx - ax, bs - as) < .05) continue;
        const keep = set.owns(mx, ms) || (sets.some(q => q !== set && q.owns(mx, ms)) && !covered(k, mx, ms));
        if (keep) {if (!cur) {cur = {k: r.k, w: r.w, n: r.n || '', p: [ax, as]};pieces.push(cur);}cur.p.push(bx, bs);} else cur = null;
      }
    }});
    // Ends at the same point (within 0.4 m) of two pieces of the same kind and width are joined (OSM splits a street at every
    // junction, and the data sets split it at their borders).
    const ends = new Map(), key = (x, s) => `${Math.round(x)},${Math.round(s)}`;
    const endAt = (pc, e) => e ? [pc.p[pc.p.length - 2], pc.p[pc.p.length - 1]] : [pc.p[0], pc.p[1]];
    pieces.forEach((pc, i) => {for (const e of [0, 1]) {const [x, s] = endAt(pc, e), k = key(x, s);if (!ends.has(k)) ends.set(k, []);ends.get(k).push({i, e, x, s});}});
    const groupAt = (x, s) => {const out = [];for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of ends.get(`${Math.round(x) + a},${Math.round(s) + b}`) || []) if (Math.hypot(q.x - x, q.s - s) < .4) out.push(q);return out;};
    const link = pieces.map(() => [null, null]);
    pieces.forEach((pc, i) => {
      for (const e of [0, 1]) {
        if (link[i][e]) continue;
        const [x, s] = endAt(pc, e), g = groupAt(x, s);
        if (g.length !== 2) continue;
        const o = g.find(q => q.i !== i || q.e !== e);if (!o || o.i === i) continue;
        const po = pieces[o.i];if (po.k !== pc.k || Math.abs(po.w - pc.w) > .01 || (po.n && pc.n && po.n !== pc.n) || link[o.i][o.e]) continue;
        link[i][e] = {i: o.i, e: o.e};link[o.i][o.e] = {i, e};
      }
    });
    const used = new Uint8Array(pieces.length), chains = [];
    const walk = (start, fromEnd) => {
      // From piece `start` entered at end fromEnd (its other end leads on).
      const out = [];let i = start, inEnd = fromEnd;
      while (i !== null && !used[i]) {
        used[i] = 1;const pc = pieces[i], fwd = inEnd === 0, pts = [];
        for (let k = 0; k < pc.p.length; k += 2) pts.push([pc.p[k], pc.p[k + 1]]);
        if (!fwd) pts.reverse();
        out.push(...(out.length ? pts.slice(1) : pts));
        const nx = link[i][fwd ? 1 : 0];i = nx ? nx.i : null;inEnd = nx ? nx.e : 0;
      }
      return out;
    };
    const emit = (pc, pts) => {
      const flat = [];for (const [x, s] of pts) {const n = flat.length;if (n && Math.hypot(x - flat[n - 2], s - flat[n - 1]) < .05) continue;flat.push(x, s);}
      if (flat.length >= 4) chains.push({k: pc.k, w: pc.w, n: pc.n, p: flat});
    };
    pieces.forEach((pc, i) => {if (used[i] || (link[i][0] && link[i][1])) return;emit(pc, link[i][0] ? walk(i, 1) : walk(i, 0));});
    pieces.forEach((pc, i) => {if (!used[i]) emit(pc, walk(i, 0));});// closed loops
    chains.forEach((c, id) => {
      c.id = id;const n = c.p.length / 2;c.cum = new Float64Array(n);
      for (let k = 1; k < n; k++) c.cum[k] = c.cum[k - 1] + Math.hypot(c.p[k * 2] - c.p[k * 2 - 2], c.p[k * 2 + 1] - c.p[k * 2 - 1]);
      c.L = c.cum[n - 1];c.hw = c.w / 2;c.sw = SIDEWALK[c.k] || 0;c.rank = RANK[c.k];c.line = !!EDGE_LINE[c.k];
      c.slabs = c.sw > 0 && slabsAt ? slabsAt(c.p[0], c.p[1]) : false;
    });
    return chains;
  }

  // ---------- Spatial hash of the chains' segments ----------
  function makeHash(chains, cell, pad) {
    const map = new Map(), add = (i, j, v) => {const k = i * 65536 + j;let a = map.get(k);if (!a) map.set(k, a = []);a.push(v);};
    const segs = [];// flat: chain, index
    for (const c of chains) for (let k = 0; k + 1 < c.p.length / 2; k++) {
      const id = segs.length / 2;segs.push(c.id, k);
      const ax = c.p[k * 2], as = c.p[k * 2 + 1], bx = c.p[k * 2 + 2], bs = c.p[k * 2 + 3], r = pad(c);
      for (let i = Math.floor((Math.min(ax, bx) - r) / cell); i <= Math.floor((Math.max(ax, bx) + r) / cell); i++)
        for (let j = Math.floor((Math.min(as, bs) - r) / cell); j <= Math.floor((Math.max(as, bs) + r) / cell); j++) add(i + 32768, j + 32768, id);
    }
    return {segs, get: (x, s) => map.get((Math.floor(x / cell) + 32768) * 65536 + Math.floor(s / cell) + 32768)};
  }

  function create({natural, grids = [], gridFor = () => null, sets = [], slabsAt = null, sigma = SIGMA, bridges = []}) {
    const all = chainsOf(sets, slabsAt), t0 = Date.now();
    let chains = all;
    // Reach: how far from a street's centre line it still matters at a grid corner (its bands within one cell's diagonal, the
    // ground easing back to the real terrain over two cells).
    const maxStep = Math.max(4, ...grids.map(g => g.step));
    for (const c of chains) c.reach = Math.max(c.hw + c.sw + 2 * maxStep, 1.42 * (c.hw + c.sw) + maxStep * Math.SQRT2) + 1;
    let H = makeHash(chains, 16, c => c.reach), Hin = makeHash(chains, 16, c => c.hw + 1.5);

    // Nearest point of each chain within its reach: {c, d (distance to the centre line), y (signed offset), t (along)}.
    // Ties (a corner on the outside of a bend is as near to both segments) go to the lower segment, so every query agrees.
    let stamp = new Int32Array(chains.length).fill(-1), best = new Float64Array(chains.length), bestK = new Int32Array(chains.length), slot = new Int32Array(chains.length);let call = 0;
    const worse = (d2, k, b2, bk) => d2 > b2 + 1e-9 || (d2 >= b2 - 1e-9 && k >= bk);
    function nearBy(hash, x, s, out, reach) {
      out.length = 0;const list = hash.get(x, s);if (!list) return out;call++;
      const segs = hash.segs;
      for (let q = 0; q < list.length; q++) {
        const ci = segs[list[q] * 2], k = segs[list[q] * 2 + 1], c = chains[ci], p = c.p;
        const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, L2 = dx * dx + ds * ds;
        const u = ((x - ax) * dx + (s - as) * ds) / L2, uc = u < 0 ? 0 : u > 1 ? 1 : u, ex = x - ax - uc * dx, es = s - as - uc * ds, d2 = ex * ex + es * es, r = reach(c);
        if (d2 > r * r) continue;
        if (stamp[ci] === call && worse(d2, k, best[ci], bestK[ci])) continue;
        const L = Math.sqrt(L2), y = (dx * (s - as) - ds * (x - ax)) / L, t = c.cum[k] + u * L, d = Math.sqrt(d2);
        if (stamp[ci] !== call) {stamp[ci] = call;best[ci] = d2;bestK[ci] = k;slot[ci] = out.length;out.push({c: ci, d, y, t});}
        else {best[ci] = d2;bestK[ci] = k;const o = out[slot[ci]];o.d = d;o.y = y;o.t = t;}
      }
      return out;
    }
    const near = (x, s, out = []) => nearBy(H, x, s, out, c => c.reach), scratch = [];
    // Streets whose carriageway (plus 1 m) holds the point.
    const nearIn = (x, s, out = []) => nearBy(Hin, x, s, out, c => c.hw + 1);
    // The same coordinates for one chain anywhere (a corner just outside the chain's reach).
    function coordOf(ci, x, s) {
      const c = chains[ci], p = c.p;let bd = Infinity, by = 0, bt = 0;
      for (let k = 0; k + 1 < p.length / 2; k++) {
        const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, L2 = dx * dx + ds * ds, L = Math.sqrt(L2);
        const u = ((x - ax) * dx + (s - as) * ds) / L2, uc = u < 0 ? 0 : u > 1 ? 1 : u, d = Math.hypot(x - ax - uc * dx, s - as - uc * ds);
        if (d < bd) {bd = d;by = (dx * (s - as) - ds * (x - ax)) / L;bt = c.cum[k] + u * L;}
      }
      return {c: ci, d: bd, y: by, t: bt};
    }
    const pointAt = (c, t) => {
      const n = c.p.length / 2;if (t <= 0) return [c.p[0], c.p[1], 0];if (t >= c.L) return [c.p[n * 2 - 2], c.p[n * 2 - 1], n - 2];
      let lo = 0, hi = n - 1;while (hi - lo > 1) {const m = (lo + hi) >> 1;if (c.cum[m] <= t) lo = m;else hi = m;}
      const f = (t - c.cum[lo]) / (c.cum[lo + 1] - c.cum[lo] || 1);return [c.p[lo * 2] + (c.p[lo * 2 + 2] - c.p[lo * 2]) * f, c.p[lo * 2 + 1] + (c.p[lo * 2 + 3] - c.p[lo * 2 + 1]) * f, lo];
    };

    // ---------- Ends: joined to another street's end (J), on another street (T) or a dead end (D) ----------
    for (const c of chains) {
      c.ends = [0, 1].map(e => {
        const n = c.p.length / 2, x = e ? c.p[n * 2 - 2] : c.p[0], s = e ? c.p[n * 2 - 1] : c.p[1];
        let kind = 'D';
        for (const o of nearIn(x, s, scratch)) {
          if (o.c === c.id) continue;const oc = chains[o.c];if (o.d > .6) continue;
          if (o.t > .5 && o.t < oc.L - .5) {kind = 'T';break;}
          kind = 'J';
        }
        return kind;
      });
      const ext = kind => kind === 'J' ? [c.hw, c.hw + KERB_W, c.hw + c.sw] : kind === 'T' ? [0, 0, 0] : [0, KERB_W, c.sw];
      [c.eC0, c.eX0, c.eP0] = ext(c.ends[0]);[c.eC1, c.eX1, c.eP1] = ext(c.ends[1]);
    }

    const tA = Date.now();
    // ---------- Bridges (issue #139): which stretches of which streets are bridge decks, and what passes under them ----------
    // A street segment is on a bridge when both its ends are consecutive points of an OpenStreetMap bridge way of the same kind
    // (bridges-data.js keeps the very points of the map data). The real ground (Kartverket's terrain model) has no bridges: under
    // a bridge it is the ground below (or, where the model filled the gap, a hump across the road or railway under it).
    const BR = bridges.filter(b => b.layered).map((b, i) => ({...b, i, deckOf: []}));
    {
      // (the patches' street lines are simplified: a segment is on a bridge when both its ends lie on the bridge's line and its
      // middle within 1.5 m of it)
      const cells = new Map(), cell = (x, s) => (Math.floor(x / 16) + 32768) * 65536 + Math.floor(s / 16) + 32768;
      BR.forEach(b => {for (let v = 0; v + 1 < b.p.length / 2; v++) {
        const x0 = Math.min(b.p[v * 2], b.p[v * 2 + 2]) - 2, x1 = Math.max(b.p[v * 2], b.p[v * 2 + 2]) + 2, s0 = Math.min(b.p[v * 2 + 1], b.p[v * 2 + 3]) - 2, s1 = Math.max(b.p[v * 2 + 1], b.p[v * 2 + 3]) + 2;
        for (let i = Math.floor(x0 / 16); i <= Math.floor(x1 / 16); i++) for (let j = Math.floor(s0 / 16); j <= Math.floor(s1 / 16); j++) {const k = (i + 32768) * 65536 + j + 32768;if (!cells.has(k)) cells.set(k, new Set());cells.get(k).add(b.i);}
      }});
      const off = (b, x, s) => {let m = Infinity;for (let v = 0; v + 1 < b.p.length / 2; v++) {const ax = b.p[v * 2], as = b.p[v * 2 + 1], dx = b.p[v * 2 + 2] - ax, ds = b.p[v * 2 + 3] - as, f = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));m = Math.min(m, Math.hypot(x - ax - f * dx, s - as - f * ds));}return m;};
      for (const c of chains) {
        const n = c.p.length / 2;c.br = new Int32Array(Math.max(1, n - 1)).fill(-1);
        for (let k = 0; k + 1 < n; k++) {
          const ax = c.p[k * 2], as = c.p[k * 2 + 1], bx = c.p[k * 2 + 2], bs = c.p[k * 2 + 3], set = cells.get(cell(ax, as));if (!set) continue;
          for (const bi of set) {const b = BR[bi];if (b.k === c.k && off(b, ax, as) < .15 && off(b, bx, bs) < .15 && off(b, (ax + bx) / 2, (as + bs) / 2) < 1.5) {c.br[k] = bi;break;}}
        }
        c.bridged = c.br.some(v => v >= 0);
      }
    }
    // The level of what passes under a bridge at the crossing: the real ground there, or lower where the terrain model filled the
    // gap (the line between the ground on either side of the bridge, along the way under it). Roads, paths, railways and streams
    // under a bridge get a trench along their line under the deck down to that level (natC), so they pass under it with room.
    const corridors = [];
    for (const b of BR) {
      const half = b.w / 2 + (SIDEWALK[b.k] || .5) + 1;
      b.cross = [];
      for (const u of b.under) {
        if (u.tun || (!u.dx && !u.ds)) continue;
        // the bridge's direction at the crossing
        let bd = Infinity, bx = 1, bs = 0;
        for (let v = 0; v + 1 < b.p.length / 2; v++) {
          const ax = b.p[v * 2], as = b.p[v * 2 + 1], dx = b.p[v * 2 + 2] - ax, ds = b.p[v * 2 + 3] - as, L2 = dx * dx + ds * ds || 1, f = Math.max(0, Math.min(1, ((u.x - ax) * dx + (u.s - as) * ds) / L2)), d = Math.hypot(u.x - ax - f * dx, u.s - as - f * ds);
          if (d < bd) {bd = d;const l = Math.sqrt(L2);bx = dx / l;bs = ds / l;}
        }
        const sin = Math.max(.3, Math.abs(bx * u.ds - bs * u.dx)), A = Math.min(60, half / sin + 3), water = WATER_UNDER.has(u.k);
        const hA = natural(u.x - u.dx * (A + 3), u.s - u.ds * (A + 3)), hB = natural(u.x + u.dx * (A + 3), u.s + u.ds * (A + 3)), h0 = natural(u.x, u.s);
        let level = Math.min(h0, (hA + hB) / 2);
        if (water) for (let q = -A; q <= A; q += 2) level = Math.min(level, natural(u.x + u.dx * q, u.s + u.ds * q));
        b.cross.push({u, level, clear: clearanceOver(u.k)});
        // (a stream's bed is its lowest ground under the bridge: its trench is flat at that level; the trench's floor is at least a
        // ground cell wide each side of the line, so the ground's triangles take it)
        const g = gridFor(u.x, u.s), hw = Math.max(u.w / 2 + 1, g ? g.step : 4);
        corridors.push(water ? {x: u.x, s: u.s, dx: u.dx, ds: u.ds, A, hA: level, hB: level, hw} : {x: u.x, s: u.s, dx: u.dx, ds: u.ds, A, hA, hB, hw});
      }
    }
    const CC = new Map(), ccell = (i, j) => i * 65536 + j;
    corridors.forEach(q => {const r = q.A + 40;for (let i = Math.floor((q.x - r) / 32); i <= Math.floor((q.x + r) / 32); i++) for (let j = Math.floor((q.s - r) / 32); j <= Math.floor((q.s + r) / 32); j++) {const k = ccell(i + 32768, j + 32768);if (!CC.has(k)) CC.set(k, []);CC.get(k).push(q);}});
    // The ground with the trenches under the bridges.
    function trench(x, s, h) {
      const list = CC.get(ccell(Math.floor(x / 32) + 32768, Math.floor(s / 32) + 32768));if (!list) return h;
      for (const q of list) {
        const ex = x - q.x, es = s - q.s, u = ex * q.dx + es * q.ds;if (Math.abs(u) > q.A) continue;
        const v = Math.abs(es * q.dx - ex * q.ds), lim = q.hA + (q.hB - q.hA) * (u + q.A) / (2 * q.A) + Math.max(0, v - q.hw) + Math.max(0, Math.abs(u) - (q.A - 4)) * 2;
        if (lim < h) h = lim;
      }
      return h;
    }
    const natC = corridors.length ? (x, s) => trench(x, s, natural(x, s)) : natural;

    // ---------- Profiles: the real ground along the centre line, smoothed ----------
    for (const c of chains) {
      const n = Math.max(2, Math.ceil(c.L / DS) + 1), ds = c.L / (n - 1), ext = Math.ceil(3 * sigma / ds), N = new Float64Array(n + 2 * ext);
      const p = c.p, m = p.length / 2, d0 = [p[0] - p[2], p[1] - p[3]], d1 = [p[m * 2 - 2] - p[m * 2 - 4], p[m * 2 - 1] - p[m * 2 - 3]];
      const l0 = Math.hypot(...d0) || 1, l1 = Math.hypot(...d1) || 1;
      c.bs = new Int32Array(n).fill(-1);
      for (let k = 0; k < N.length; k++) {
        const t = (k - ext) * ds;let x, s;
        if (t < 0) {x = p[0] + d0[0] / l0 * -t;s = p[1] + d0[1] / l0 * -t;} else if (t > c.L) {x = p[m * 2 - 2] + d1[0] / l1 * (t - c.L);s = p[m * 2 - 1] + d1[1] / l1 * (t - c.L);} else {const q = pointAt(c, t);x = q[0];s = q[1];if (c.bridged && k >= ext && k < ext + n) c.bs[k - ext] = c.br[Math.min(c.br.length - 1, q[2])];}
        N[k] = natC(x, s);
      }
      // On a bridge the street's ground is the line between the ground at its two ends (the terrain model has the ground under it).
      if (c.bridged) for (let k = 0; k < n;) {
        if (c.bs[k] < 0) {k++;continue;}
        let e = k;while (e < n && c.bs[e] >= 0) e++;
        const a = k + ext - 1, b = e + ext;// the samples just off the bridge (the padding beyond a chain's end continues its line)
        for (let j = k; j < e; j++) N[j + ext] = N[a] + (N[b] - N[a]) * (j + ext - a) / (b - a);
        k = e;
      }
      // Robust smoothing: samples far off the smooth line (a ravine under a bridge, a pit) get no say, three rounds.
      const sg = sigma / ds, rad = Math.ceil(3 * sg), kern = new Float64Array(2 * rad + 1);for (let k = -rad; k <= rad; k++) kern[k + rad] = Math.exp(-k * k / (2 * sg * sg));
      let wt = new Float64Array(N.length).fill(1), R = new Float64Array(N.length);
      for (let round = 0; round < 3; round++) {
        for (let k = 0; k < N.length; k++) {let a = 0, b = 0;for (let q = -rad; q <= rad; q++) {const i = k + q;if (i < 0 || i >= N.length) continue;const w = kern[q + rad] * wt[i];a += w * N[i];b += w;}R[k] = b > 1e-9 ? a / b : N[k];}
        for (let k = 0; k < N.length; k++) wt[k] = 1 - smooth(.5, 1.2, Math.abs(N[k] - R[k]));
      }
      c.ds = ds;c.nat = N.slice(ext, ext + n);c.prof = R.slice(ext, ext + n);c.lift = new Float64Array(n);
    }
    for (const c of chains) if (c.bridged) liftDeck(c);
    // A street that rises to a bridge raises the streets it meets at its ends (a roundabout or a slip road on the bridge's level),
    // and those the streets they meet, as long as the rise reaches them (not the roads the bridge passes over).
    {
      const seen = new Set(), list = [];
      // (the streets that pass under a bridge are never raised this way)
      for (const b of BR) for (const x of b.cross) for (const o of nearIn(x.u.x, x.u.s, list)) {const c = chains[o.c];if (c.k === x.u.k && (c.n || '') === (x.u.n || '') && Math.abs(o.y) < c.hw && !c.bridged) c.passesUnder = true;}
      for (let round = 0; round < 6; round++) {
        const extra = new Map();
        for (const m of chains) {
          if (!m.lifted) continue;const n = m.prof.length;
          for (const e of [0, 1]) {
            const k = e ? n - 1 : 0;if (m.lift[k] < .05 || seen.has(m.id * 2 + e)) continue;seen.add(m.id * 2 + e);
            const [x, s] = pointAt(m, e ? m.L : 0), y = m.prof[k], under = m.under || new Set();
            for (const o of nearIn(x, s, list)) {
              const c = chains[o.c];if (c === m || c.passesUnder || Math.abs(o.y) > c.hw + .3 || o.t < -c.eC0 || o.t > c.L + c.eC1 || under.has(c.k + '|' + c.n)) continue;
              if (!extra.has(c)) extra.set(c, []);extra.get(c).push({t: Math.max(0, Math.min(c.L, o.t)), y, off: 0});
            }
          }
        }
        if (!extra.size) break;
        for (const [c, need] of extra) liftDeck(c, need);
      }
    }
    // A bridge clears what passes under it: road and railway 4.7 m, a path 2.6 m, a river 1.8 m (plus the deck itself under the
    // road surface). Where the line between its ends is too low, the street rises to the deck in a smooth crest at no more than
    // 5 % (up to 12 % if the street is too short for that), which may start before the bridge (an embankment ramp).
    function liftDeck(c, extra = []) {
      const P = c.prof, n = P.length, need = extra.slice();
      // Every crossing under a bridge of the same layer within 40 m of this street's deck counts: its own, the ones under the
      // other carriageway beside it, and the ones just past a junction on the bridge (so streets that meet on a bridge rise alike).
      const ks = [];for (let k = 0; k < n; k++) if (c.bs[k] >= 0) ks.push(k);
      const pts = ks.map(k => pointAt(c, k * c.ds)), layers = new Set(ks.map(k => BR[c.bs[k]].L));
      for (const b of BR) if (layers.has(b.L)) for (const x of b.cross) {
        if (x.u.n && x.u.n === c.n && x.u.k === c.k) continue;// its own street (a slip road of the same name is another kind)
        let bt = 0, bd = Infinity;
        for (let q = 0; q < ks.length; q++) {const d = Math.hypot(pts[q][0] - x.u.x, pts[q][1] - x.u.s);if (d < bd) {bd = d;bt = ks[q] * c.ds;}}
        if (bd > 40) continue;
        for (let t = Math.max(0, bt - c.ds); t <= Math.min(c.L, bt + c.ds); t += .25) {const [px, ps] = pointAt(c, t), d = Math.hypot(px - x.u.x, ps - x.u.s);if (d < bd) {bd = d;bt = t;}}
        need.push({t: bt, y: x.level + x.clear + DECK, off: Math.max(0, bd - c.hw - 2), b});
        if (!c.under) c.under = new Set();c.under.add(x.u.k + '|' + x.u.n);
      }
      if (!need.length) return;
      const RR = 12, cone = (d, G) => d < RR ? G * d * d / (2 * RR) : G * (d - RR / 2);
      let lift = null;
      for (const G of [.05, .07, .09, .12]) {
        lift = new Float64Array(n);
        for (let k = 0; k < n; k++) {let top = -Infinity;for (const q of need) top = Math.max(top, q.y - cone(Math.abs(k * c.ds - q.t) + q.off, G));lift[k] = Math.max(0, top - P[k]);}
        if ((lift[0] < .05 || c.ends[0] !== 'D') && (lift[n - 1] < .05 || c.ends[1] !== 'D')) break;
      }
      // ease the foot of each ramp (a light smoothing that only adds height), keeping the crest exact
      const sg = 3 / c.ds, rad = Math.ceil(3 * sg), Q = new Float64Array(n);
      const near = new Uint8Array(n);for (let k = 0; k < n; k++) if (lift[k] > 0) for (let q = Math.max(0, k - rad); q <= Math.min(n - 1, k + rad); q++) near[q] = 1;
      for (let k = 0; k < n; k++) {if (!near[k]) {Q[k] = P[k];continue;}let a = 0, w = 0;for (let q = -rad; q <= rad; q++) {const i = Math.max(0, Math.min(n - 1, k + q)), g = Math.exp(-q * q / (2 * sg * sg));a += g * (P[i] + lift[i]);w += g;}Q[k] = Math.max(P[k] + lift[k], a / w);}
      for (let k = 0; k < n; k++) {if (Q[k] - P[k] > .005) {c.lift[k] += Q[k] - P[k];c.lifted = true;}P[k] = Q[k];}
      c.need = (c.need || []).concat(need);
    }
    const profAt = (c, t, arr = c.prof) => {const f = Math.max(0, Math.min(arr.length - 1.000001, (t + (c.t0 || 0)) / c.ds)), i = Math.floor(f), u = f - i;return arr[i] * (1 - u) + arr[i + 1] * u;};
    // The layer at a point along a full chain: the bridge's OpenStreetMap layer on a deck, else 0 (the ground).
    const layerAt = (c, t) => {if (!c.bridged) return 0;const k = Math.max(0, Math.min(c.bs.length - 1, Math.round(t / c.ds)));return c.bs[k] >= 0 ? Math.max(1, BR[c.bs[k]].L) : 0;};

    const tB = Date.now();
    // ---------- Junctions: the minor street bends to meet the major one ----------
    {
      // The major street (higher rank, then the longer one) keeps its line through a junction. The minor street, where its centre
      // line runs inside the major one's carriageway, takes the major street's level there, and the change is eased out over
      // PIN metres on either side (or spread across the gap between two junctions). Majors first, so each conforms to final ones.
      for (const c of chains) c.pri = c.rank * 1000 + Math.min(999, c.L);
      const order = chains.slice().sort((a, b) => b.pri - a.pri), list = [];
      for (const c of order) {
        const P = c.prof, n = P.length, d = new Float64Array(n).fill(NaN);let any = false;
        for (let k = 0; k < n; k++) {
          const [x, s] = pointAt(c, k * c.ds);let top = null;
          // (a street meets another only on the same level: not the road under a bridge and the bridge over it, nor a street raised
          // toward a bridge and a road it passes beside or over, issue #139)
          for (const o of nearIn(x, s, list)) {const m = chains[o.c];if (m.pri <= c.pri || Math.abs(o.y) > m.hw + .3 || o.t < -m.eC0 || o.t > m.L + m.eC1 || layerAt(m, o.t) !== layerAt(c, k * c.ds) || (c.lift[k] > .3 && Math.abs(profAt(m, o.t) - P[k]) > 1.5)) continue;if (!top || m.pri > top.m.pri) top = {m, t: o.t};}
          if (top) {d[k] = profAt(top.m, top.t) - P[k];any = true;}
        }
        if (!any) continue;
        // The nearest constrained samples before (prev) and after (next) each sample.
        const prev = new Int32Array(n), next = new Int32Array(n);
        for (let k = 0, last = -1; k < n; k++) {if (!Number.isNaN(d[k])) last = k;prev[k] = last;}
        for (let k = n - 1, last = -1; k >= 0; k--) {if (!Number.isNaN(d[k])) last = k;next[k] = last;}
        // Outside the constrained stretches the street leaves the major one's level with the slope it had there (C1, no kink),
        // turns to its own profile within F1 and the offset fades over F (or spreads across a short gap to the next junction).
        const F = Math.round(PIN / c.ds), F1 = Math.max(2, Math.round(12 / c.ds)), Tc = k => P[k] + d[k];
        const sOut = (k, dir) => {const q = k - dir;return q >= 0 && q < n && !Number.isNaN(d[q]) ? Tc(k) - Tc(q) : 0;};
        const NP = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          if (!Number.isNaN(d[k])) {NP[k] = Tc(k);continue;}
          const lo = prev[k], hi = next[k];
          const sl = lo >= 0 ? sOut(lo, 1) : 0, sh = hi >= 0 ? -sOut(hi, -1) : 0;
          if (lo >= 0 && hi >= 0 && hi - lo <= 2 * F1) {
            // a short gap: a cubic from one junction's level and slope to the other's
            const g = hi - lo, u = (k - lo) / g, h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u, h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
            NP[k] = h00 * Tc(lo) + h10 * sl * g + h01 * Tc(hi) + h11 * sh * g;continue;
          }
          const fade = (from, dist) => d[from] * .5 * (1 + Math.cos(Math.PI * Math.min(1, dist / F)));
          let v = P[k] + (lo >= 0 && hi >= 0 && hi - lo <= 2 * F ? d[lo] + (d[hi] - d[lo]) * smooth(0, 1, (k - lo) / (hi - lo)) : (lo >= 0 ? fade(lo, k - lo) : 0) + (hi >= 0 ? fade(hi, hi - k) : 0));
          if (lo >= 0 && k - lo < F1) {const h = smooth(0, 1, (k - lo) / F1);v = (Tc(lo) + sl * (k - lo)) * (1 - h) + v * h;}
          if (hi >= 0 && hi - k < F1) {const h = smooth(0, 1, (hi - k) / F1);v = (Tc(hi) + sh * (k - hi)) * (1 - h) + v * h;}
          NP[k] = v;
        }
        for (let k = 0; k < n; k++) P[k] = NP[k];
      }
      // Where the real ground is far below the smooth line (a ravine under a bridge) the street keeps the real ground: Akerselva's
      // bridges have their own decks (game-kayak.js), the other bridges are decks of their own here (not on the ground, issue #139).
      for (const c of chains) {const P = c.prof, Nn = c.nat;for (let k = 0; k < P.length; k++) {if (c.lift[k] > 0 || (c.bridged && c.bs[k] >= 0)) continue;const dh = P[k] - Nn[k], a = 1 - smooth(.9, 1.6, Math.abs(dh));P[k] = Nn[k] + dh * a;}}
    }

    // ---------- Split: the streets on the ground, and the bridge decks ----------
    // Each street is cut where it goes onto a bridge and where it comes off: the pieces on the ground make the ground surface
    // (their ends at a bridge are cut square, 'B'), the pieces on a bridge are decks (drawn and walked on by road-bridges.js).
    // Both keep the whole street's profile (t0: where the piece starts along it), so they meet at the same level.
    const decks = [];
    {
      const ground = [];
      const piece = (c, k0, k1, deck) => {// the chain's points k0..k1 (inclusive)
        let p = c.p.slice(k0 * 2, k1 * 2 + 2);
        // A deck's end line is square to its end segment and the street's to its own: where the line bends at the split, the
        // deck starts (ends) with 0.5 m in the street's direction, so the two end lines are the same line (no notch between them).
        if (deck && k1 - k0 >= 1) {
          const N = c.p.length / 2, dir = k => {const dx = c.p[k * 2 + 2] - c.p[k * 2], ds = c.p[k * 2 + 3] - c.p[k * 2 + 1], l = Math.hypot(dx, ds) || 1;return [dx / l, ds / l];};
          const len = c.cum[k1] - c.cum[k0], bend = (a, b) => a[0] * b[1] - a[1] * b[0];
          if (k1 < N - 1 && len > 1.5) {const g = dir(k1), d = dir(k1 - 1);if (Math.abs(bend(g, d)) > 1e-4) p.splice(p.length - 2, 0, p[p.length - 2] - g[0] * .5, p[p.length - 1] - g[1] * .5);}
          if (k0 > 0 && len > 1.5) {const g = dir(k0 - 1), d = dir(k0);if (Math.abs(bend(g, d)) > 1e-4) p.splice(2, 0, p[0] + g[0] * .5, p[1] + g[1] * .5);}
        }
        const n = p.length / 2, cum = new Float64Array(n);
        for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
        const first = k0 === 0, last = k1 === c.p.length / 2 - 1, ends = [first ? c.ends[0] : 'B', last ? c.ends[1] : 'B'];
        const q = {...c, p, cum, L: cum[n - 1], t0: c.cum[k0], ends, parent: c, deck};
        delete q.br;delete q.bs;
        const ext = kind => kind === 'J' ? [c.hw, c.hw + KERB_W, c.hw + c.sw] : kind === 'T' || kind === 'B' ? [0, 0, 0] : [0, KERB_W, c.sw];
        [q.eC0, q.eX0, q.eP0] = ext(ends[0]);[q.eC1, q.eX1, q.eP1] = ext(ends[1]);
        return q;
      };
      for (const c of chains) {
        if (!c.bridged) {ground.push(c);continue;}
        const n = c.p.length / 2;let k = 0;
        while (k < n - 1) {
          const on = c.br[k] >= 0;let e = k;while (e < n - 1 && (c.br[e] >= 0) === on) e++;
          const q = piece(c, k, e, on);
          if (on) {q.bridges = [...new Set(Array.from(c.br.slice(k, e)))].map(i => BR[i]);q.layer = Math.max(1, ...q.bridges.map(b => b.L));q.bridges.forEach(b => b.deckOf.push(q));decks.push(q);} else ground.push(q);
          k = e;
        }
      }
      // Two decks that go on from each other (a street split at a junction on a bridge) share one end line: each ends with 0.3 m
      // square to the line between their directions, so there is no notch between them where the line bends.
      {
        const endsAt = decks.flatMap(d => [0, 1].map(e => {const n = d.p.length / 2, i = e ? n - 1 : 0, j = e ? n - 2 : 1, dx = d.p[i * 2] - d.p[j * 2], ds = d.p[i * 2 + 1] - d.p[j * 2 + 1], l = Math.hypot(dx, ds) || 1;return {d, e, x: d.p[i * 2], s: d.p[i * 2 + 1], ax: dx / l, as: ds / l};}));
        for (const A of endsAt) {
          if (A.done) continue;
          // (at a fork, the two that go on most straight)
          const at = endsAt.filter(B => B !== A && !B.done && B.d !== A.d && Math.hypot(B.x - A.x, B.s - A.s) < .3).sort((P, Q) => (P.ax * A.ax + P.as * A.as) - (Q.ax * A.ax + Q.as * A.as));
          if (!at.length) continue;const B = at[0];
          if (A.ax * B.ax + A.as * B.as > -.85 || A.d.L < 1.5 || B.d.L < 1.5) continue;// (not going on from each other)
          let nx = A.ax - B.ax, ns = A.as - B.as;const l = Math.hypot(nx, ns) || 1;nx /= l;ns /= l;
          for (const [E, sg] of [[A, 1], [B, -1]]) {
            if (Math.abs(E.ax * ns * sg - E.as * nx * sg) < 1e-4) continue;// already square
            const p = E.d.p, n = p.length / 2, ix = sg * nx * .3, is = sg * ns * .3;
            if (E.e) p.splice(n * 2 - 2, 0, p[n * 2 - 2] - ix, p[n * 2 - 1] - is);else p.splice(2, 0, p[0] - ix, p[1] - is);
            const m = p.length / 2, cum = new Float64Array(m);for (let k = 1; k < m; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
            E.d.cum = cum;E.d.L = cum[m - 1];
          }
          A.done = B.done = true;
        }
      }
      ground.forEach((c, id) => {c.id = id;});decks.forEach((c, id) => {c.id = id;});
      chains = ground;
      H = makeHash(chains, 16, c => c.reach);Hin = makeHash(chains, 16, c => c.hw + 1.5);
      stamp = new Int32Array(chains.length).fill(-1);best = new Float64Array(chains.length);bestK = new Int32Array(chains.length);slot = new Int32Array(chains.length);
    }
    // ---------- Decks: where they are, and their top ----------
    // A deck is flat across: the carriageway at the street's level, the pavements a kerb above it (a deck with no pavement has a
    // 0.6 m strip to its parapet). Near each end its top eases (over 8 m) to the ground surface at the end line exactly
    // (corr, set at the end of create()), so the deck and the street meet with no step anywhere across.
    const deckHalf = d => d.hw + (d.sw || .6);
    for (const d of decks) {d.W = deckHalf(d);d.corr = [null, null];}
    const Hd = makeHash(decks, 16, d => d.W + PARAPET + .5);
    const corrAt = (d, e, y) => {const a = d.corr[e];if (!a) return 0;const f = Math.max(0, Math.min(a.length - 1.000001, (Math.max(-d.W, Math.min(d.W, y)) + d.W) / d.corrStep)), i = Math.floor(f);return a[i] + (a[i + 1] - a[i]) * (f - i);};
    function deckTop(d, t, y) {
      const ay = Math.abs(y), F = Math.min(8, d.L / 2);
      let h = profAt(d, Math.max(0, Math.min(d.L, t))) + (d.sw && ay > d.hw ? KERB_H : 0);
      if (t < F) h += corrAt(d, 0, y) * (1 - smooth(0, F, t));
      if (d.L - t < F) h += corrAt(d, 1, y) * (1 - smooth(0, F, d.L - t));
      return h;
    }
    // The decks over (x, s): [{d, y (signed offset), t (along)}] (inside its outline to the parapets' outer faces, not on its
    // end lines).
    function decksAt(x, s, out = []) {
      out.length = 0;const list = Hd.get(x, s);if (!list) return out;
      for (const id of list) {
        const d = decks[Hd.segs[id * 2]], k = Hd.segs[id * 2 + 1], p = d.p;
        const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, L2 = dx * dx + ds * ds, L = Math.sqrt(L2);
        const u = ((x - ax) * dx + (s - as) * ds) / L2, uc = u < 0 ? 0 : u > 1 ? 1 : u, dd = Math.hypot(x - ax - uc * dx, s - as - uc * ds);
        if (dd > d.W + PARAPET) continue;
        const t = d.cum[k] + u * L, o = out.find(q => q.d === d), y = (dx * (s - as) - ds * (x - ax)) / L;
        if (!o) out.push({d, y, t, dd});else if (dd < o.dd) {o.y = y;o.t = t;o.dd = dd;}
      }
      // Not behind its end lines (each square to its end segment, whichever segment is nearest).
      for (let i = out.length - 1; i >= 0; i--) {
        const {d} = out[i], p = d.p, m = p.length / 2;
        const a0 = ((x - p[0]) * (p[2] - p[0]) + (s - p[1]) * (p[3] - p[1])) / (d.cum[1] || 1);
        const a1 = ((x - p[m * 2 - 2]) * (p[m * 2 - 4] - p[m * 2 - 2]) + (s - p[m * 2 - 1]) * (p[m * 2 - 3] - p[m * 2 - 1])) / ((d.cum[m - 1] - d.cum[m - 2]) || 1);
        if (a0 <= .02 || a1 <= .02 || out[i].t <= .02 || out[i].t >= d.L - .02) out.splice(i, 1);
      }
      return out;
    }
    // Under a deck the ground stays at least 0.3 m below its top at the end lines and DECK + 0.5 m below it 1.8 m in: no ground
    // surface is drawn through a deck, nor flush under it (flicker), and the deck's end face meets the ground.
    const dScratch = [], dScratch2 = [];
    function underDeck(x, s, h) {
      if (!decks.length) return h;
      const list = decksAt(x, s, dScratch);
      // (and under a deck, in a trench under the bridge, the ground is the trench, whatever street is near: not eased up to it)
      if (list.length && corridors.length) h = trench(x, s, h);
      for (const {d, y, t} of list) {const lim = deckTop(d, t, y) - Math.min(DECK + .5, .3 + .5 * Math.min(t, d.L - t));if (lim < h) h = lim;}
      return h;
    }

    const tC = Date.now();
    // ---------- Fields at a grid vertex ----------
    // The street level from the streets at a point: each street's profile, weighted by its rank and by how far the point is outside
    // its carriageway (beside it, or past its end); a street also fades out where the point is inside a major street's carriageway
    // (so the major street keeps its own level through a junction). e: [{c, Y (|offset|), T (along)}].
    const blendW = new Float64Array(64);
    // Past the end of a street where it goes onto a bridge, the street has no say in the ground: under the deck the ground is
    // the real ground (issue #139).
    const beyondB = (c, T) => (T < -.01 && c.ends[0] === 'B') || (T > c.L + .01 && c.ends[1] === 'B');
    function level(e, fallback) {
      const n = Math.min(64, e.length);let a = 0, w = 0;
      // On the carriageway or pavement of a street raised toward a bridge (over 0.3 m), only the streets on its level count: a road it passes
      // beside or over keeps its own level (the step between them is a wall), issue #139.
      let up = null;
      if (decks.length) for (let i = 0; i < n; i++) {const {c, Y, T} = e[i];if (c.lifted && Y < c.hw + c.sw + .2 && T >= 0 && T <= c.L && profAt(c, T, c.lift) > .3) {const h = profAt(c, T);if (up === null || h > up) up = h;}}
      for (let i = 0; i < n; i++) {const {c, Y, T} = e[i], oy = Math.max(0, Y - c.hw), ot = Math.max(0, -T, T - c.L);blendW[i] = beyondB(c, T) || (up !== null && Math.abs(profAt(c, T) - up) > 1) ? Infinity : (oy * oy + ot * ot) / (LAMBDA * LAMBDA);}
      for (let i = 0; i < n; i++) {
        const c = e[i].c;if (blendW[i] > 60) continue;let k = c.rank * Math.exp(-blendW[i]);
        for (let j = 0; j < n; j++) if (j !== i && e[j].c.pri > c.pri && blendW[j] !== Infinity) {const o = Math.sqrt(blendW[j]) * LAMBDA / MASK;if (o < 1) k *= o * o * (3 - 2 * o);}
        a += k * profAt(c, e[i].T);w += k;
      }
      return w > 1e-12 ? a / w : fallback;
    }
    // Beside the streets: the level the ground starts at (a pavement's top, or 4 cm below a road with no pavement) easing to the
    // real ground. Distances are to each street's bands as rectangles in its own coordinates (beside it, or past its end).
    // e: [{c, Y (|offset|), T (along)}]. Also the shader's numbers: how far outside the nearest carriageway (ed) and pavement (pd).
    function side(e, R, nat, g) {
      let dP = Infinity, dR = Infinity, ed = 99, slab = 0, line = 0, deep = -Infinity, inside = 0;
      for (const {c, Y, T} of e) {
        if (beyondB(c, T)) continue;
        const inC = Math.max(Y - c.hw, -T - c.eC0, T - c.L - c.eC1);ed = Math.min(ed, inC);
        if (inC < 0) {inside++;if (c.pri > deep) {deep = c.pri;line = c.line ? 1 : 0;}}
        if (c.sw) {const v = Math.max(Y - c.hw - c.sw, -T - c.eP0, T - c.L - c.eP1);if (v < dP) {dP = v;slab = c.slabs ? 1 : 0;}} else dR = Math.min(dR, inC);
      }
      const dS = Math.min(dP, dR), S = R + (dP <= dR ? KERB_H : -VERGE);
      // (the white edge line stops where carriageways overlap: junctions, slip roads)
      return {h: Number.isNaN(R) ? nat : S + (nat - S) * smooth(.5 * g.step, 2 * g.step, dS), ed, pd: Math.min(99, dP), slab, line: inside === 1 ? line : 0, dS};
    }
    const entriesOf = list => list.map(o => ({c: chains[o.c], Y: Math.abs(o.y), T: o.t}));
    function fieldsAt(x, s, nat, g, list = near(x, s, [])) {
      if (!list.length) return {list, R: NaN, out: nat, dS: Infinity};
      const e = entriesOf(list);
      // Far from every street's carriageway the weights all vanish: the nearest street's level.
      let R = level(e, NaN);
      if (Number.isNaN(R)) {const o = list.reduce((m, q) => q.d - chains[q.c].hw < m.d - chains[m.c].hw ? q : m);R = profAt(chains[o.c], o.t);}
      const sd = side(e, R, nat, g);
      return {list, R, out: sd.h, dS: sd.dS};
    }
    // The ground beside the streets (not on a road or a pavement) in a trench under a bridge is the trench: not eased up to a
    // street near it (issue #139).
    const besideTrench = (x, s, q) => corridors.length && !(q.dS < .3) ? trench(x, s, q.h) : q.h;

    // ---------- One triangle, cut along the carriageway edges ----------
    // cn: the corners [{x, s, nat, R, out, list}] in the mesh's order. Returns {simple, cls, h} for a whole triangle, else
    // {verts: [[b0, b1, b2]] (barycentric), pieces: [{cls, ids, h}], at(b) -> street entries}.
    const EPS = 1e-7;
    function pieces(cn, g) {
      // Candidate chains: any chain near one of the corners, with its coordinates at all three.
      // Candidate chains: those near all three corners. A chain missing at one corner is more than its reach away there, so its
      // carriageway cannot touch this triangle and its weight in the levels is nil.
      const cand = [];let touch = false;
      for (const o0 of cn[0].list) {
        let o1 = null, o2 = null;for (const o of cn[1].list) if (o.c === o0.c) {o1 = o;break;}if (!o1) continue;for (const o of cn[2].list) if (o.c === o0.c) {o2 = o;break;}if (!o2) continue;
        const c = chains[o0.c];cand.push({c, y: [o0.y, o1.y, o2.y], t: [o0.t, o1.t, o2.t]});
        // Does its carriageway strip reach the triangle? (not if all three corners are on one side of it, or past one end)
        if (!((o0.y > c.hw && o1.y > c.hw && o2.y > c.hw) || (o0.y < -c.hw && o1.y < -c.hw && o2.y < -c.hw) || (o0.t < -c.eC0 && o1.t < -c.eC0 && o2.t < -c.eC0) || (o0.t > c.L + c.eC1 && o1.t > c.L + c.eC1 && o2.t > c.L + c.eC1))) touch = true;
      }
      const cross = (v, f) => {// where line v crosses the triangle: f (another linear function) at the two crossing points
        const out = [];for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) if ((v[i] < 0 && v[j] > 0) || (v[i] > 0 && v[j] < 0)) {const u = v[i] / (v[i] - v[j]);out.push(f[i] + (f[j] - f[i]) * u);}
        return out;
      };
      const crosses = v => (v[0] > EPS || v[1] > EPS || v[2] > EPS) && (v[0] < -EPS || v[1] < -EPS || v[2] < -EPS);
      // A bridge deck's sides (just inside its parapets' outer faces) cut the ground too: under the deck the ground is held
      // below it, beside it the ground keeps its height, and the step between them is hidden in the parapet (issue #139).
      const dlines = [];
      if (decks.length) {
        const seen = new Set();for (const q of cn) {const l = Hd.get(q.x, q.s);if (l) for (const id of l) seen.add(Hd.segs[id * 2]);}
        const cx = (cn[0].x + cn[1].x + cn[2].x) / 3, cs = (cn[0].s + cn[1].s + cn[2].s) / 3;
        for (const di of seen) {
          const d = decks[di], p = d.p;let bk = 0, bd = Infinity;
          for (let k = 0; k + 1 < p.length / 2; k++) {const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, f = Math.max(0, Math.min(1, ((cx - ax) * dx + (cs - as) * ds) / (dx * dx + ds * ds || 1))), dd = Math.hypot(cx - ax - f * dx, cs - as - f * ds);if (dd < bd) {bd = dd;bk = k;}}
          const ax = p[bk * 2], as = p[bk * 2 + 1], dx = p[bk * 2 + 2] - ax, ds = p[bk * 2 + 3] - as, L = Math.hypot(dx, ds) || 1;
          const y = cn.map(q => (dx * (q.s - as) - ds * (q.x - ax)) / L), t = cn.map(q => d.cum[bk] + ((q.x - ax) * dx + (q.s - as) * ds) / L), E = d.W + PARAPET - .05;
          for (const sg of [1, -1]) {const v = y.map(q => sg * q - E);if (!crosses(v)) continue;const tt = cross(v, t);if (tt.length < 2 || Math.max(...tt) < 0 || Math.min(...tt) > d.L) continue;dlines.push(v);}
        }
      }
      if (!touch && !dlines.length) return {simple: true, cls: C.OTHER, h: [cn[0].out, cn[1].out, cn[2].out], at: cand.length ? b => cand.map(({c, y, t}) => ({c, Y: Math.abs(b[0] * y[0] + b[1] * y[1] + b[2] * y[2]), T: b[0] * t[0] + b[1] * t[1] + b[2] * t[2]})) : () => []};
      cand.sort((p, q) => p.c.id - q.c.id);
      // The carriageway edges (both sides, value <= 0 inside) and ends, only where they bound the carriageway in this triangle.
      const lines = dlines.slice();
      for (const {c, y, t} of cand) {
        // (a road with a white edge line is also cut 1 m inside each edge, so the line's distance is exact in its pieces)
        for (const [sg, hw] of c.line ? [[1, c.hw], [-1, c.hw], [1, c.hw - 1], [-1, c.hw - 1]] : [[1, c.hw], [-1, c.hw]]) {
          const v = y.map(q => sg * q - hw);if (!crosses(v)) continue;
          const tt = cross(v, t);if (tt.length < 2 || Math.max(...tt) < -c.eC0 || Math.min(...tt) > c.L + c.eC1) continue;
          lines.push(v);
        }
        // (an end at a bridge is cut across the pavements too: the deck's end line, issue #139)
        [t.map(q => -q - c.eC0), t.map(q => q - c.L - c.eC1)].forEach((v, e) => {
          const w = c.ends[e] === 'B' ? c.hw + c.sw + PARAPET + 1 : c.hw;
          if (!crosses(v)) return;const yy = cross(v, y);if (yy.length < 2 || Math.min(...yy) > w || Math.max(...yy) < -w) return;
          lines.push(v);
        });
      }
      const at = b => cand.map(({c, y, t}) => ({c, Y: Math.abs(b[0] * y[0] + b[1] * y[1] + b[2] * y[2]), T: b[0] * t[0] + b[1] * t[1] + b[2] * t[2]}));
      const classOf = b => {for (const {c, Y, T} of at(b)) if (Y < c.hw && T >= -c.eC0 && T <= c.L + c.eC1) return C.ROAD;return C.OTHER;};
      // The street level at a point from the point's own coordinates, so a road piece is exactly flat across and follows its
      // profile whatever the grid corners around it are near.
      const Rb = b => level(at(b), b[0] * cn[0].R + b[1] * cn[1].R + b[2] * cn[2].R);
      const natB = b => b[0] * cn[0].nat + b[1] * cn[1].nat + b[2] * cn[2].nat;
      if (!lines.length) {
        const cls = classOf([1 / 3, 1 / 3, 1 / 3]);
        return cls === C.ROAD ? {simple: true, cls, h: [0, 1, 2].map(i => underDeck(cn[i].x, cn[i].s, Rb([+(i === 0), +(i === 1), +(i === 2)]))), at} : {simple: true, cls, h: [cn[0].out, cn[1].out, cn[2].out], at};
      }
      const verts = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];let polys = [[0, 1, 2]];
      for (const L of lines) {
        const next = [], memo = new Map(), val = vi => {const b = verts[vi];const v = b[0] * L[0] + b[1] * L[1] + b[2] * L[2];return Math.abs(v) < 1e-4 ? 0 : v;};// within 0.1 mm of the line: on it (no slivers)
        for (const P of polys) {
          const vals = P.map(val);
          if (vals.every(v => v >= 0) || vals.every(v => v <= 0)) {next.push(P);continue;}
          const A = [], B = [];
          for (let k = 0; k < P.length; k++) {
            const i = P[k], j = P[(k + 1) % P.length], vi = vals[k], vj = vals[(k + 1) % P.length];
            if (vi <= 0) A.push(i);if (vi >= 0) B.push(i);
            if ((vi < 0 && vj > 0) || (vi > 0 && vj < 0)) {
              const key = i < j ? i * 4096 + j : j * 4096 + i;let n = memo.get(key);
              if (n === undefined) {const f = vi / (vi - vj), bi = verts[i], bj = verts[j];n = verts.length;verts.push([bi[0] + (bj[0] - bi[0]) * f, bi[1] + (bj[1] - bi[1]) * f, bi[2] + (bj[2] - bi[2]) * f]);memo.set(key, n);}
              A.push(n);B.push(n);
            }
          }
          if (A.length >= 3) next.push(A);if (B.length >= 3) next.push(B);
        }
        polys = next;
      }
      // Road pieces lie on the street level; the ground beside them starts at the pavement top (or the asphalt edge) on the
      // edge line itself and keeps the grid's corner heights at the corners.
      const Rv = new Map(), Rat = vi => {let h = Rv.get(vi);if (h === undefined) Rv.set(vi, h = Rb(verts[vi]));return h;};
      const out = [];
      for (const P of polys) {
        let cb = [0, 0, 0];for (const vi of P) {const b = verts[vi];cb[0] += b[0] / P.length;cb[1] += b[1] / P.length;cb[2] += b[2] / P.length;}
        let area = 0;for (let k = 0; k < P.length; k++) {const a = verts[P[k]], b = verts[P[(k + 1) % P.length]];area += a[1] * b[2] - b[1] * a[2];}
        if (Math.abs(area) < 1e-8) continue;// a sliver
        out.push({cls: classOf(cb), ids: P});
      }
      const xyB = b => [b[0] * cn[0].x + b[1] * cn[1].x + b[2] * cn[2].x, b[0] * cn[0].s + b[1] * cn[1].s + b[2] * cn[2].s];
      // (a piece beside a deck keeps the ground's height on the deck's side line; a piece under it is held below it)
      const inDeck = pc => {if (!dlines.length) return true;let c = [0, 0, 0];for (const vi of pc.ids) for (let a = 0; a < 3; a++) c[a] += verts[vi][a] / pc.ids.length;const q = xyB(c);return decksAt(q[0], q[1], dScratch2).some(o => Math.abs(o.y) < o.d.W + PARAPET - .05);};
      let clampCut = true;const under = (vi, h) => {if (vi < 3 || !decks.length || !clampCut) return h;const q = xyB(verts[vi]);return underDeck(q[0], q[1], h);};// (the corners' out is already)
      for (const pc of out) clampCut = inDeck(pc), pc.h = pc.ids.map(vi => under(vi, pc.cls === C.ROAD ? (vi < 3 ? underDeck(cn[vi].x, cn[vi].s, Rat(vi)) : Rat(vi)) : vi < 3 ? cn[vi].out : (() => {const q = xyB(verts[vi]);return besideTrench(q[0], q[1], side(at(verts[vi]), Rat(vi), natB(verts[vi]), g));})()));
      return {simple: false, verts, pieces: out, at};
    }

    // ---------- Grids: per-vertex fields, cached ----------
    for (const g of grids) {g.N = new Float32Array(g.nx * g.ns);g.R = new Float32Array(g.nx * g.ns).fill(NaN);g.out = new Float32Array(g.nx * g.ns).fill(NaN);g.done = new Uint8Array(g.nx * g.ns);g.lists = new Map();}
    function vertex(g, i, j, keepList) {
      const k = j * g.nx + i, x = g.x0 + i * g.step, s = g.s0 + j * g.step, given = g.lists.get(k);
      if (g.done[k]) return {x, s, nat: g.N[k], R: g.R[k], out: g.out[k], list: given || near(x, s, [])};
      const nat = corridors.length ? trench(x, s, g.nat(i, j, x, s)) : g.nat(i, j, x, s), f = fieldsAt(x, s, nat, g, given);g.N[k] = nat;g.R[k] = f.R;g.out[k] = underDeck(x, s, besideTrench(x, s, {h: f.out, dS: f.dS}));g.done[k] = 1;if (keepList && !given) g.lists.set(k, f.list);
      return {x, s, nat, R: f.R, out: f.out, list: f.list};
    }
    // The street lists of a block of grid vertices at once (inclusive range): each segment near the block is measured against
    // the corners within its reach (much faster than one query per corner).
    const segSeen = new Int32Array(H.segs.length / 2).fill(-1);let fillCall = 0;
    function fillLists(g, I0, J0, I1, J1) {
      I0 = Math.max(0, I0);J0 = Math.max(0, J0);I1 = Math.min(g.nx - 1, I1);J1 = Math.min(g.ns - 1, J1);fillCall++;
      const X0 = g.x0 + I0 * g.step, S0 = g.s0 + J0 * g.step, X1 = g.x0 + I1 * g.step, S1 = g.s0 + J1 * g.step, st = g.step, W = I1 - I0 + 1;
      const lists = new Array(W * (J1 - J0 + 1));for (let q = 0; q < lists.length; q++) lists[q] = [];
      for (let ci = Math.floor(X0 / 16); ci <= Math.floor(X1 / 16); ci++) for (let cj = Math.floor(S0 / 16); cj <= Math.floor(S1 / 16); cj++) {
        const list = H.get(ci * 16 + 1, cj * 16 + 1);if (!list) continue;
        for (const id of list) {
          if (segSeen[id] === fillCall) continue;segSeen[id] = fillCall;
          const c = chains[H.segs[id * 2]], k = H.segs[id * 2 + 1], p = c.p, r = c.reach;
          const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, L2 = dx * dx + ds * ds, L = Math.sqrt(L2);
          const a0 = Math.max(I0, Math.ceil((Math.min(ax, ax + dx) - r - g.x0) / st)), a1 = Math.min(I1, Math.floor((Math.max(ax, ax + dx) + r - g.x0) / st));
          const b0 = Math.max(J0, Math.ceil((Math.min(as, as + ds) - r - g.s0) / st)), b1 = Math.min(J1, Math.floor((Math.max(as, as + ds) + r - g.s0) / st));
          for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
            const x = g.x0 + a * st, s = g.s0 + b * st, u = ((x - ax) * dx + (s - as) * ds) / L2, uc = u < 0 ? 0 : u > 1 ? 1 : u, ex = x - ax - uc * dx, es = s - as - uc * ds, d2 = ex * ex + es * es;
            if (d2 > r * r) continue;
            const v = lists[(b - J0) * W + a - I0];let o = null;
            for (let q = 0; q < v.length; q++) if (v[q].c === c.id) {o = v[q];break;}
            if (o && worse(d2, k, o.d2, o.k)) continue;
            const y = (dx * (s - as) - ds * (x - ax)) / L, t = c.cum[k] + u * L, d = Math.sqrt(d2);
            if (o) {o.d = d;o.d2 = d2;o.k = k;o.y = y;o.t = t;} else v.push({c: c.id, d, d2, k, y, t});
          }
        }
      }
      // The same order as a single query would give does not matter: candidates are sorted by chain in pieces().
      for (let b = J0; b <= J1; b++) for (let a = I0; a <= I1; a++) g.lists.set(b * g.nx + a, lists[(b - J0) * W + a - I0]);
    }
    // Triangle `tri` of cell (i, j): 0 = (i, j), (i, j + 1), (i + 1, j); 1 = (i + 1, j), (i, j + 1), (i + 1, j + 1) (the mesh's order).
    const triCorners = (i, j, tri) => tri ? [[i + 1, j], [i, j + 1], [i + 1, j + 1]] : [[i, j], [i, j + 1], [i + 1, j]];
    const cache = new Map();
    function triAt(g, i, j, tri) {
      const key = ((g.id * 2097152 + j) * 4096 + i) * 2 + tri;let p = cache.get(key);
      if (!p) {if (cache.size > 60000) cache.clear();p = pieces(triCorners(i, j, tri).map(([a, b]) => vertex(g, a, b, false)), g);cache.set(key, p);}
      return p;
    }
    // Barycentric coordinates of (u, v) in the cell's triangle.
    const baryOf = (u, v, tri) => tri ? [1 - v, 1 - u, u + v - 1] : [1 - u - v, v, u];
    const inPoly = (b, ids, verts) => {
      let sign = 0;
      for (let k = 0; k < ids.length; k++) {const p = verts[ids[k]], q = verts[ids[(k + 1) % ids.length]], cr = (q[1] - p[1]) * (b[2] - p[2]) - (q[2] - p[2]) * (b[1] - p[1]);if (Math.abs(cr) < 1e-12) continue;const sg = cr > 0 ? 1 : -1;if (!sign) sign = sg;else if (sg !== sign) return false;}
      return true;
    };
    function locate(x, s) {
      const g = gridFor(x, s);if (!g) return null;
      const fi = Math.min(g.nx - 1.000001, Math.max(0, (x - g.x0) / g.step)), fj = Math.min(g.ns - 1.000001, Math.max(0, (s - g.s0) / g.step)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, tri = u + v > 1 ? 1 : 0;
      return {g, i, j, tri, b: baryOf(u, v, tri), p: triAt(g, i, j, tri)};
    }
    function height(x, s) {
      const L = locate(x, s);if (!L) return natural(x, s);
      const {b, p} = L;
      if (p.simple) return b[0] * p.h[0] + b[1] * p.h[1] + b[2] * p.h[2];
      for (const pc of p.pieces) {
        if (!inPoly(b, pc.ids, p.verts)) continue;
        // Fan from the first vertex, as drawn.
        const V = p.verts, A = V[pc.ids[0]];
        for (let k = 1; k + 1 < pc.ids.length; k++) {
          const B = V[pc.ids[k]], Cc = V[pc.ids[k + 1]], det = (B[1] - A[1]) * (Cc[2] - A[2]) - (Cc[1] - A[1]) * (B[2] - A[2]);if (Math.abs(det) < 1e-14) continue;
          const l1 = ((b[1] - A[1]) * (Cc[2] - A[2]) - (Cc[1] - A[1]) * (b[2] - A[2])) / det, l2 = ((B[1] - A[1]) * (b[2] - A[2]) - (b[1] - A[1]) * (B[2] - A[2])) / det;
          if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) return pc.h[0] * (1 - l1 - l2) + pc.h[k] * l1 + pc.h[k + 1] * l2;
        }
      }
      // Not reached in practice (a point a hair outside every piece through rounding): the nearest corner's height.
      const k = b.indexOf(Math.max(...b));return p.pieces.find(pc => pc.ids.includes(k))?.h[p.pieces.find(pc => pc.ids.includes(k)).ids.indexOf(k)] ?? natural(x, s);
    }
    function classAt(x, s) {
      const L = locate(x, s);if (!L) return C.OTHER;const {b, p} = L;if (p.simple) return p.cls;
      for (const pc of p.pieces) if (inPoly(b, pc.ids, p.verts)) return pc.cls;return C.OTHER;
    }

    // ---------- Drawing: a block of cells as one mesh's arrays ----------
    // pos (x, y, s), nor, street (4 per vertex: kind 0 ground / 1 kerb face / 2 asphalt edge face / 3 road with a white edge
    // line, how far outside the nearest carriageway, how far outside the nearest pavement (both metres, 99 = far), 1 = granite
    // slabs), index. The terrain shader draws the road, the 18 cm granite kerb top, the pavement and the line from these numbers,
    // which are exact (linear) inside each piece, so the edges are sharp whatever the grid.
    function tile(g, i0, j0, i1, j1, skipCell = () => false) {
      const pos = [], nor = [], str = [], index = [], shared = new Map();
      const st = g.step;
      const outN = (i, j) => {
        const at = (a, b) => {a = Math.max(0, Math.min(g.nx - 1, a));b = Math.max(0, Math.min(g.ns - 1, b));return vertex(g, a, b, true).out;};
        const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * st), gs = (at(i, j + 1) - at(i, j - 1)) / (2 * st), l = Math.hypot(gx, 1, gs);return [-gx / l, 1 / l, -gs / l];
      };
      const emit = (x, y, s, n, a) => {pos.push(x, y, s);nor.push(n[0], n[1], n[2]);str.push(a[0], a[1], a[2], a[3]);return pos.length / 3 - 1;};
      // A road piece is all road (its distance to the edge is only kept for a white edge line: both edges' vertices in one piece
      // would read as "on the edge" everywhere). Slabs or asphalt pavement by the part of town.
      // `line`: the piece is a road with a white edge line (decided once per piece, so the kind is the same at all its corners).
      const attrs = (kind, e, x, s, road, line) => {
        if (!e.length) return [kind, 99, 99, 0];const q = side(e, 0, 0, g);
        return [line ? 3 : kind, road && !line ? -1 : Math.max(-99, q.ed), q.pd, slabsAt ? (slabsAt(x, s) ? 1 : 0) : q.slab];
      };
      const sharedV = (i, j) => {
        const k = j * g.nx + i;let id = shared.get(k);
        if (id === undefined) {const q = vertex(g, i, j, true);id = emit(q.x, q.out, q.s, outN(i, j), attrs(0, entriesOf(q.list), q.x, q.s, false, false));shared.set(k, id);}
        return id;
      };
      // Up-facing order for a list of [x, s] points: the fan (0, k, k + 1) faces +y when the outline turns clockwise.
      const up = P => {let a = 0;for (let k = 0; k < P.length; k++) {const p = P[k], q = P[(k + 1) % P.length];a += p[0] * q[1] - q[0] * p[1];}return a < 0;};
      const newell = (pts, hs) => {
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < pts.length; k++) {const a = pts[k], b = pts[(k + 1) % pts.length], ya = hs[k], yb = hs[(k + 1) % pts.length];nx += (ya - yb) * (a[1] + b[1]);ny += (a[1] - b[1]) * (a[0] + b[0]);nz += (a[0] - b[0]) * (ya + yb);}
        if (ny < 0) {nx = -nx;ny = -ny;nz = -nz;}const l = Math.hypot(nx, ny, nz) || 1;return [nx / l, ny / l, nz / l];
      };
      const BLK = 32;
      for (let bj = j0; bj < j1; bj += BLK) for (let bi = i0; bi < i1; bi += BLK) {
        g.lists.clear();fillLists(g, bi - 1, bj - 1, Math.min(i1, bi + BLK) + 1, Math.min(j1, bj + BLK) + 1);
        for (let j = bj; j < Math.min(j1, bj + BLK); j++) for (let i = bi; i < Math.min(i1, bi + BLK); i++) {
          if (skipCell(i, j)) continue;
          for (const tri of [0, 1]) {
            const cc = triCorners(i, j, tri), cn = cc.map(([a, b]) => vertex(g, a, b, true)), p = pieces(cn, g);
            if (p.simple && p.cls === C.OTHER) {const v = cc.map(([a, b]) => sharedV(a, b));index.push(v[0], v[1], v[2]);continue;}
            const P3 = cn.map(q => [q.x, q.s]), xy = b => [b[0] * P3[0][0] + b[1] * P3[1][0] + b[2] * P3[2][0], b[0] * P3[0][1] + b[1] * P3[1][1] + b[2] * P3[2][1]];
            const cornerN = cc.map(([a, b]) => outN(a, b)), smoothN = b => {const m = [0, 1, 2].map(a => b[0] * cornerN[0][a] + b[1] * cornerN[1][a] + b[2] * cornerN[2][a]), l = Math.hypot(...m);return [m[0] / l, m[1] / l, m[2] / l];};
            const list = p.simple ? [{cls: p.cls, ids: [0, 1, 2], h: p.h}] : p.pieces, V = p.simple ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : p.verts;
            const edges = new Map();
            for (const pc of list) {
              const pts = pc.ids.map(vi => xy(V[vi])), flip = !up(pts), road = pc.cls === C.ROAD, n = road ? newell(pts, pc.h) : null;
              let line = false;if (road) {const cb = [0, 0, 0];for (const vi of pc.ids) for (let a = 0; a < 3; a++) cb[a] += V[vi][a] / pc.ids.length;line = !!side(p.at(cb), 0, 0, g).line;}
              const vid = pc.ids.map((vi, k) => emit(pts[k][0], pc.h[k], pts[k][1], n || smoothN(V[vi]), attrs(0, p.at(V[vi]), pts[k][0], pts[k][1], road, line)));
              for (let k = 1; k + 1 < vid.length; k++) flip ? index.push(vid[0], vid[k + 1], vid[k]) : index.push(vid[0], vid[k], vid[k + 1]);
              for (let k = 0; k < pc.ids.length; k++) {
                const a = pc.ids[k], b = pc.ids[(k + 1) % pc.ids.length], key = a < b ? a * 4096 + b : b * 4096 + a;
                if (!edges.has(key)) edges.set(key, []);edges.get(key).push({pc, a, b, ha: pc.h[k], hb: pc.h[(k + 1) % pc.ids.length]});
              }
            }
            // Vertical faces where a road piece meets the ground beside it at a different height: the kerb, the asphalt edge.
            for (const two of edges.values()) {
              if (two.length !== 2) continue;
              let [A, B] = two;if (B.a !== A.a) B = {...B, a: B.b, b: B.a, ha: B.hb, hb: B.ha};
              const dA = A.ha - B.ha, dB = A.hb - B.hb;if (Math.abs(dA) < 1e-3 && Math.abs(dB) < 1e-3) continue;
              const hi = dA + dB > 0 ? A : B, lo = hi === A ? B : A, pa = xy(V[A.a]), pb = xy(V[A.b]);
              const kind = Math.max(Math.abs(dA), Math.abs(dB)) > KERB_H * .6 ? 1 : 2;
              let cx = 0, cs = 0;for (const vi of lo.pc.ids) {const q = xy(V[vi]);cx += q[0] / lo.pc.ids.length;cs += q[1] / lo.pc.ids.length;}
              let nx = -(pb[1] - pa[1]), ns = pb[0] - pa[0];const l = Math.hypot(nx, ns) || 1;nx /= l;ns /= l;
              if ((cx - pa[0]) * nx + (cs - pa[1]) * ns < 0) {nx = -nx;ns = -ns;}// facing the low side
              const n = [nx, 0, ns], f = [kind, 0, 0, 0], v0 = emit(pa[0], lo.ha, pa[1], n, f), v1 = emit(pb[0], lo.hb, pb[1], n, f), v2 = emit(pb[0], hi.hb, pb[1], n, f), v3 = emit(pa[0], hi.ha, pa[1], n, f);
              // (v1 - v0) x (v2 - v0) points along (-es, 0, ex): keep that order when it faces the low side.
              const ex = pb[0] - pa[0], es = pb[1] - pa[1];
              (-es * nx + ex * ns) > 0 ? index.push(v0, v1, v2, v0, v2, v3) : index.push(v0, v2, v1, v0, v3, v2);
            }
          }
        }
      }
      g.lists.clear();
      return {pos: new Float32Array(pos), nor: new Float32Array(nor), street: new Float32Array(str), index: pos.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index)};
    }
    // Each deck's top at its two end lines: the ground surface just off the deck (the street it continues, its kerbs, a junction
    // there), so walking and driving on and off is seamless. The caches are cleared after, as the ground under the decks depends
    // on their tops.
    // (three rounds: a deck's top also lowers the ground under it, which may be where another deck's end meets the ground)
    for (let round = 0; round < (decks.length ? 3 : 0); round++) {
    for (const d of decks.slice().sort((a, b) => b.pri - a.pri || b.id - a.id)) for (const e of [0, 1]) {
      const n = d.p.length / 2, i = e ? n - 1 : 0, j = e ? n - 2 : 1, x = d.p[i * 2], s = d.p[i * 2 + 1], dx = d.p[j * 2] - x, ds = d.p[j * 2 + 1] - s, l = Math.hypot(dx, ds) || 1;
      const fx = dx / l, fs = ds / l, sg = e ? -1 : 1, a = [], top0 = profAt(d, e ? d.L : 0);// (fx, fs) points into the deck
      const m = Math.ceil(2 * d.W / .4) + 1;d.corrStep = 2 * d.W / (m - 1);
      for (let q = 0; q < m; q++) {
        let y = Math.max(-d.W + .02, Math.min(d.W - .02, -d.W + q * d.corrStep));
        if (d.sw && Math.abs(Math.abs(y) - d.hw) < .06) y = Math.sign(y) * (d.hw + (Math.abs(y) > d.hw ? .06 : -.06));// not on a kerb line
        // (dx, ds) from end 1 points back along the deck: its offsets turn the other way
        const yy = y * sg, px = x - fx * .05 - fs * yy, ps = s - fs * .05 + fx * yy;
        // What it meets there: a more major deck (streets meeting on a bridge), else the ground, if within 1.5 m (else nothing:
        // the end stays as it is).
        const own = top0 + (d.sw && Math.abs(y) > d.hw ? KERB_H : 0);let to = null;
        for (const o of decksAt(px, ps, [])) if (o.d !== d && (o.d.pri > d.pri || (o.d.pri === d.pri && o.d.id > d.id))) {const h = deckTop(o.d, o.t, o.y);if (Math.abs(h - own) < 1.5 && (to === null || Math.abs(h - own) < Math.abs(to - own))) to = h;}
        if (to === null) {const h = height(px, ps);if (Math.abs(h - own) < 1.5) to = h;}
        a.push(to === null ? 0 : to - own);
      }
      d.corr[e] = a;
    }
    cache.clear();for (const g of grids) g.done.fill(0);
    }
    for (const d of decks) d.top = (t, y) => deckTop(d, t, y);
    const stats = {chains: chains.length, decks: decks.length, ms: Date.now() - t0, ends: tA - t0, profiles: tB - tA, junctions: tC - tB};
    // After the meshes are built the per-vertex street lists are no longer needed (the height query keeps its own cache).
    const release = () => {for (const g of grids) g.lists.clear();};
    return {height, classAt, tile, release, chains, near, profAt, stats, decks, decksAt, deckTop, bridges: BR, natural: natC, C, KERB_H, KERB_W, LINE_IN, LINE_W, DECK, PARAPET};
  }
  // The game world's ground as Surroundings uses it: the real ground (the old ±800 m square's 4 m grid, then the district patches'
  // 8 m grids, else the nearest data edge), the grids that are drawn (the old square within ±playHalf, the patches elsewhere) and
  // which data set owns the streets where. square: {h (Float32Array, metres), n, half, step}; districts: District.decode()d.
  function world({square, districts = [], DZ, playHalf = 760}) {
    const {h, n: N, half, step} = square;
    const relSquare = (x, s) => {
      const fi = Math.min(N - 1.001, Math.max(0, (x + half) / step)), fj = Math.min(N - 1.001, Math.max(0, (s + half) / step)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      return h[j * N + i] * (1 - u) * (1 - v) + h[j * N + i + 1] * u * (1 - v) + h[(j + 1) * N + i] * (1 - u) * v + h[(j + 1) * N + i + 1] * u * v;
    };
    const inSquare = (x, s) => Math.abs(x) <= half && Math.abs(s) <= half;
    function natural(x, s) {
      if (!districts.length || inSquare(x, s)) return relSquare(x, s);
      for (const d of districts) if (DZ.covers(d, x, s)) return DZ.height(d, x, s);
      const cl = (v, a, b) => Math.max(a, Math.min(b, v));
      let best = relSquare(x, s), bd = Math.hypot(x - cl(x, -half, half), s - cl(s, -half, half));
      for (const d of districts) {const cx = cl(x, d.x0, d.x1), cs = cl(s, d.s0, d.s1), dd = Math.hypot(x - cx, s - cs);if (dd < bd) {bd = dd;best = DZ.height(d, cx, cs);}}
      return best;
    }
    const old = {id: 0, name: 'square', x0: -half, s0: -half, step, nx: N, ns: N, nat: (i, j) => h[j * N + i]};
    const grids = [old, ...districts.map((d, k) => ({id: k + 1, name: d.name, d, x0: d.x0, s0: d.s0, step: d.step, nx: d.nx, ns: d.ns, nat: (i, j, x, s) => natural(x, s)}))];
    const gridFor = (x, s) => {
      if (Math.abs(x) <= playHalf && Math.abs(s) <= playHalf) return old;
      for (let k = 1; k < grids.length; k++) if (DZ.covers(grids[k].d, x, s)) return grids[k];
      return inSquare(x, s) ? old : null;
    };
    const sets = [{roads: square.roads || [], owns: inSquare}, ...districts.map(d => ({roads: d.roads, owns: (x, s) => DZ.covers(d, x, s) && !inSquare(x, s)}))];
    return {natural, grids, gridFor, sets, old};
  }
  // The bridges of bridges-data.js (tools/make-bridges.py) as objects: {id, k, n (name), L (layer), w, p, under: [{k, n, L, tun,
  // x, s, dx, ds, w}], car, kayak, layered}. A car street's bridge becomes a deck here (layered), except Akerselva's bridges,
  // which game-kayak.js has built since issue #64 (kayak: the river runs under it within 20 m of one of the kayak data's bridges).
  function bridgesOf(raw, {kayak = null} = {}) {
    const ways = ((raw && raw.ways) || []).map(([id, k, n, L, w, p, under]) => ({id, k, n, L, w, p, under: under.map(([k, n, L, tun, x, s, dx, ds, w]) => ({k, n, L, tun: !!tun, x, s, dx, ds, w}))}));
    const kp = kayak && kayak.bridges ? kayak.bridges.map(b => {const i = Math.min(kayak.pts.length / 2 - 1, Math.round(b.t / kayak.step));return [kayak.pts[i * 2], kayak.pts[i * 2 + 1]];}) : [];
    const dist = (p, x, s) => {let m = Infinity;for (let v = 0; v + 1 < p.length / 2; v++) {const ax = p[v * 2], as = p[v * 2 + 1], dx = p[v * 2 + 2] - ax, ds = p[v * 2 + 3] - as, f = Math.max(0, Math.min(1, ((x - ax) * dx + (s - as) * ds) / (dx * dx + ds * ds || 1)));m = Math.min(m, Math.hypot(x - ax - f * dx, s - as - f * ds));}return m;};
    const SMALL = new Set(['stream', 'ditch', 'drain', 'water']);
    for (const b of ways) {
      b.car = !!RANK[b.k];
      b.kayak = b.under.some(u => u.n === 'Akerselva' && !u.tun) && kp.some(([x, s]) => dist(b.p, x, s) < 20);
      // A short bridge over nothing but a brook (Hovinbekken's) stays on the ground: the brook is not drawn, and the street's
      // own line between its ends is the bridge (culvert).
      let len = 0;for (let v = 0; v + 1 < b.p.length / 2; v++) len += Math.hypot(b.p[v * 2 + 2] - b.p[v * 2], b.p[v * 2 + 3] - b.p[v * 2 + 1]);
      b.culvert = len < 15 && b.under.length > 0 && b.under.every(u => SMALL.has(u.k));
      b.layered = b.car && !b.kayak && !b.culvert;
    }
    return ways;
  }
  return {create, world, bridgesOf, SIDEWALK, RANK, C, KERB_H, KERB_W, LINE_IN, LINE_W, DECK, PARAPET, clearanceOver};
});
