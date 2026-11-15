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
  const C = {OTHER: 0, ROAD: 1};
  const SIGMA = 8, DS = 2, LAMBDA = 3, MASK = 6, PIN = 30;
  const smooth = (a, b, x) => {const t = Math.max(0, Math.min(1, (x - a) / (b - a)));return t * t * (3 - 2 * t);};

  // ---------- Streets: pieces per data set, joined end to end into chains ----------
  function chainsOf(sets, slabsAt) {
    const pieces = [];
    for (const set of sets) for (const r of set.roads) {
      if (!RANK[r.k]) continue;
      let cur = null;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i], as = r.p[i + 1], bx = r.p[i + 2], bs = r.p[i + 3];
        if (Math.hypot(bx - ax, bs - as) < .05) continue;
        if (set.owns((ax + bx) / 2, (as + bs) / 2)) {if (!cur) {cur = {k: r.k, w: r.w, n: r.n || '', p: [ax, as]};pieces.push(cur);}cur.p.push(bx, bs);} else cur = null;
      }
    }
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

  function create({natural, grids = [], gridFor = () => null, sets = [], slabsAt = null, sigma = SIGMA}) {
    const chains = chainsOf(sets, slabsAt), t0 = Date.now();
    // Reach: how far from a street's centre line it still matters at a grid corner (its bands within one cell's diagonal, the
    // ground easing back to the real terrain over two cells).
    const maxStep = Math.max(4, ...grids.map(g => g.step));
    for (const c of chains) c.reach = Math.max(c.hw + c.sw + 2 * maxStep, 1.42 * (c.hw + c.sw) + maxStep * Math.SQRT2) + 1;
    const H = makeHash(chains, 16, c => c.reach), Hin = makeHash(chains, 16, c => c.hw + 1.5);

    // Nearest point of each chain within its reach: {c, d (distance to the centre line), y (signed offset), t (along)}.
    // Ties (a corner on the outside of a bend is as near to both segments) go to the lower segment, so every query agrees.
    const stamp = new Int32Array(chains.length).fill(-1), best = new Float64Array(chains.length), bestK = new Int32Array(chains.length), slot = new Int32Array(chains.length);let call = 0;
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
    // ---------- Profiles: the real ground along the centre line, smoothed ----------
    for (const c of chains) {
      const n = Math.max(2, Math.ceil(c.L / DS) + 1), ds = c.L / (n - 1), ext = Math.ceil(3 * sigma / ds), N = new Float64Array(n + 2 * ext);
      const p = c.p, m = p.length / 2, d0 = [p[0] - p[2], p[1] - p[3]], d1 = [p[m * 2 - 2] - p[m * 2 - 4], p[m * 2 - 1] - p[m * 2 - 3]];
      const l0 = Math.hypot(...d0) || 1, l1 = Math.hypot(...d1) || 1;
      for (let k = 0; k < N.length; k++) {
        const t = (k - ext) * ds;let x, s;
        if (t < 0) {x = p[0] + d0[0] / l0 * -t;s = p[1] + d0[1] / l0 * -t;} else if (t > c.L) {x = p[m * 2 - 2] + d1[0] / l1 * (t - c.L);s = p[m * 2 - 1] + d1[1] / l1 * (t - c.L);} else [x, s] = pointAt(c, t);
        N[k] = natural(x, s);
      }
      // Robust smoothing: samples far off the smooth line (a ravine under a bridge, a pit) get no say, three rounds.
      const sg = sigma / ds, rad = Math.ceil(3 * sg), kern = new Float64Array(2 * rad + 1);for (let k = -rad; k <= rad; k++) kern[k + rad] = Math.exp(-k * k / (2 * sg * sg));
      let wt = new Float64Array(N.length).fill(1), R = new Float64Array(N.length);
      for (let round = 0; round < 3; round++) {
        for (let k = 0; k < N.length; k++) {let a = 0, b = 0;for (let q = -rad; q <= rad; q++) {const i = k + q;if (i < 0 || i >= N.length) continue;const w = kern[q + rad] * wt[i];a += w * N[i];b += w;}R[k] = b > 1e-9 ? a / b : N[k];}
        for (let k = 0; k < N.length; k++) wt[k] = 1 - smooth(.5, 1.2, Math.abs(N[k] - R[k]));
      }
      c.ds = ds;c.nat = N.slice(ext, ext + n);c.prof = R.slice(ext, ext + n);
    }
    const profAt = (c, t, arr = c.prof) => {const f = Math.max(0, Math.min(c.prof.length - 1.000001, t / c.ds)), i = Math.floor(f), u = f - i;return arr[i] * (1 - u) + arr[i + 1] * u;};

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
          for (const o of nearIn(x, s, list)) {const m = chains[o.c];if (m.pri <= c.pri || Math.abs(o.y) > m.hw + .3 || o.t < -m.eC0 || o.t > m.L + m.eC1) continue;if (!top || m.pri > top.m.pri) top = {m, t: o.t};}
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
      // Where the real ground is far below the smooth line (a ravine under a bridge) the street keeps the real ground: bridges
      // have their own decks (game-kayak.js).
      for (const c of chains) {const P = c.prof, Nn = c.nat;for (let k = 0; k < P.length; k++) {const dh = P[k] - Nn[k], a = 1 - smooth(.9, 1.6, Math.abs(dh));P[k] = Nn[k] + dh * a;}}
    }

    const tC = Date.now();
    // ---------- Fields at a grid vertex ----------
    // The street level from the streets at a point: each street's profile, weighted by its rank and by how far the point is outside
    // its carriageway (beside it, or past its end); a street also fades out where the point is inside a major street's carriageway
    // (so the major street keeps its own level through a junction). e: [{c, Y (|offset|), T (along)}].
    const blendW = new Float64Array(64);
    function level(e, fallback) {
      const n = Math.min(64, e.length);let a = 0, w = 0;
      for (let i = 0; i < n; i++) {const {c, Y, T} = e[i], oy = Math.max(0, Y - c.hw), ot = Math.max(0, -T, T - c.L);blendW[i] = (oy * oy + ot * ot) / (LAMBDA * LAMBDA);}
      for (let i = 0; i < n; i++) {
        const c = e[i].c;if (blendW[i] > 60) continue;let k = c.rank * Math.exp(-blendW[i]);
        for (let j = 0; j < n; j++) if (j !== i && e[j].c.pri > c.pri) {const o = Math.sqrt(blendW[j]) * LAMBDA / MASK;if (o < 1) k *= o * o * (3 - 2 * o);}
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
        const inC = Math.max(Y - c.hw, -T - c.eC0, T - c.L - c.eC1);ed = Math.min(ed, inC);
        if (inC < 0) {inside++;if (c.pri > deep) {deep = c.pri;line = c.line ? 1 : 0;}}
        if (c.sw) {const v = Math.max(Y - c.hw - c.sw, -T - c.eP0, T - c.L - c.eP1);if (v < dP) {dP = v;slab = c.slabs ? 1 : 0;}} else dR = Math.min(dR, inC);
      }
      const dS = Math.min(dP, dR), S = R + (dP <= dR ? KERB_H : -VERGE);
      // (the white edge line stops where carriageways overlap: junctions, slip roads)
      return {h: Number.isNaN(R) ? nat : S + (nat - S) * smooth(.5 * g.step, 2 * g.step, dS), ed, pd: Math.min(99, dP), slab, line: inside === 1 ? line : 0};
    }
    const entriesOf = list => list.map(o => ({c: chains[o.c], Y: Math.abs(o.y), T: o.t}));
    function fieldsAt(x, s, nat, g, list = near(x, s, [])) {
      if (!list.length) return {list, R: NaN, out: nat};
      const e = entriesOf(list);
      // Far from every street's carriageway the weights all vanish: the nearest street's level.
      let R = level(e, NaN);
      if (Number.isNaN(R)) {const o = list.reduce((m, q) => q.d - chains[q.c].hw < m.d - chains[m.c].hw ? q : m);R = profAt(chains[o.c], o.t);}
      return {list, R, out: side(e, R, nat, g).h};
    }

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
      if (!touch) return {simple: true, cls: C.OTHER, h: [cn[0].out, cn[1].out, cn[2].out], at: cand.length ? b => cand.map(({c, y, t}) => ({c, Y: Math.abs(b[0] * y[0] + b[1] * y[1] + b[2] * y[2]), T: b[0] * t[0] + b[1] * t[1] + b[2] * t[2]})) : () => []};
      cand.sort((p, q) => p.c.id - q.c.id);
      // The carriageway edges (both sides, value <= 0 inside) and ends, only where they bound the carriageway in this triangle.
      const lines = [];
      const cross = (v, f) => {// where line v crosses the triangle: f (another linear function) at the two crossing points
        const out = [];for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) if ((v[i] < 0 && v[j] > 0) || (v[i] > 0 && v[j] < 0)) {const u = v[i] / (v[i] - v[j]);out.push(f[i] + (f[j] - f[i]) * u);}
        return out;
      };
      const crosses = v => (v[0] > EPS || v[1] > EPS || v[2] > EPS) && (v[0] < -EPS || v[1] < -EPS || v[2] < -EPS);
      for (const {c, y, t} of cand) {
        // (a road with a white edge line is also cut 1 m inside each edge, so the line's distance is exact in its pieces)
        for (const [sg, hw] of c.line ? [[1, c.hw], [-1, c.hw], [1, c.hw - 1], [-1, c.hw - 1]] : [[1, c.hw], [-1, c.hw]]) {
          const v = y.map(q => sg * q - hw);if (!crosses(v)) continue;
          const tt = cross(v, t);if (tt.length < 2 || Math.max(...tt) < -c.eC0 || Math.min(...tt) > c.L + c.eC1) continue;
          lines.push(v);
        }
        for (const v of [t.map(q => -q - c.eC0), t.map(q => q - c.L - c.eC1)]) {
          if (!crosses(v)) continue;const yy = cross(v, y);if (yy.length < 2 || Math.min(...yy) > c.hw || Math.max(...yy) < -c.hw) continue;
          lines.push(v);
        }
      }
      const at = b => cand.map(({c, y, t}) => ({c, Y: Math.abs(b[0] * y[0] + b[1] * y[1] + b[2] * y[2]), T: b[0] * t[0] + b[1] * t[1] + b[2] * t[2]}));
      const classOf = b => {for (const {c, Y, T} of at(b)) if (Y < c.hw && T >= -c.eC0 && T <= c.L + c.eC1) return C.ROAD;return C.OTHER;};
      // The street level at a point from the point's own coordinates, so a road piece is exactly flat across and follows its
      // profile whatever the grid corners around it are near.
      const Rb = b => level(at(b), b[0] * cn[0].R + b[1] * cn[1].R + b[2] * cn[2].R);
      const natB = b => b[0] * cn[0].nat + b[1] * cn[1].nat + b[2] * cn[2].nat;
      if (!lines.length) {
        const cls = classOf([1 / 3, 1 / 3, 1 / 3]);
        return cls === C.ROAD ? {simple: true, cls, h: [Rb([1, 0, 0]), Rb([0, 1, 0]), Rb([0, 0, 1])], at} : {simple: true, cls, h: [cn[0].out, cn[1].out, cn[2].out], at};
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
      for (const pc of out) pc.h = pc.ids.map(vi => pc.cls === C.ROAD ? Rat(vi) : vi < 3 ? cn[vi].out : side(at(verts[vi]), Rat(vi), natB(verts[vi]), g).h);
      return {simple: false, verts, pieces: out, at};
    }

    // ---------- Grids: per-vertex fields, cached ----------
    for (const g of grids) {g.N = new Float32Array(g.nx * g.ns);g.R = new Float32Array(g.nx * g.ns).fill(NaN);g.out = new Float32Array(g.nx * g.ns).fill(NaN);g.done = new Uint8Array(g.nx * g.ns);g.lists = new Map();}
    function vertex(g, i, j, keepList) {
      const k = j * g.nx + i, x = g.x0 + i * g.step, s = g.s0 + j * g.step, given = g.lists.get(k);
      if (g.done[k]) return {x, s, nat: g.N[k], R: g.R[k], out: g.out[k], list: given || near(x, s, [])};
      const nat = g.nat(i, j, x, s), f = fieldsAt(x, s, nat, g, given);g.N[k] = nat;g.R[k] = f.R;g.out[k] = f.out;g.done[k] = 1;if (keepList && !given) g.lists.set(k, f.list);
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
    const stats = {chains: chains.length, ms: Date.now() - t0, ends: tA - t0, profiles: tB - tA, junctions: tC - tB};
    // After the meshes are built the per-vertex street lists are no longer needed (the height query keeps its own cache).
    const release = () => {for (const g of grids) g.lists.clear();};
    return {height, classAt, tile, release, chains, near, profAt, stats, C, KERB_H, KERB_W, LINE_IN, LINE_W};
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
  return {create, world, SIDEWALK, RANK, C, KERB_H, KERB_W, LINE_IN, LINE_W};
});
