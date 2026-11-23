/* Road bridges (issue #139): the decks of the car streets that cross over another road, a railway, a path or water.
 * road-surface.js decides where the decks are and how high (RoadSurface.create(...).decks: each deck is a street's stretch on an
 * OpenStreetMap bridge, with its top d.top(t, y), t along it, y across); this module draws them and makes them solid:
 *  - the deck: asphalt carriageway, pavements a kerb higher, concrete parapets 1 m high, the sides and the underside 0.9 m under
 *    the road, square end faces; piers (0.9 m square) every ~20 m where the deck is more than 1.2 m above the ground, never on a
 *    road or on a railway's or path's line under it. Where two decks overlap (the two carriageways of one road, a slip road
 *    joining) only one top is drawn there and neither parapet.
 *  - floors (one per deck, its outline through its line's points, so the walk world's edge test stays quick; its ends meet the ground or the
 *    next deck at the same height), obstacles (parapets, the underside as a ceiling, the piers), for walking and for vehicles.
 *  - groundAt(x, z, y): the deck under (x, z) for something at height y (a vehicle gives its own height: on the deck within 1 m
 *    of it or above, else the ground below, as in Construction City's garage); alongAt(x, z, hx, hz): the deck under a vehicle
 *    heading (hx, hz) along it (trams and buses on their lines), else null; over(x, z): true on or under a deck.
 * Pure geometry (Node-tested in tests/bridges.test.cjs): RoadBridges.geometry(streets) -> {pos, nor, col (local x, y, s; heights
 *   relative), floors, obstacles (local polygons [[x, s]], heights relative), piers}.
 * RoadBridges.surfaceOf(streets) -> surface(d, t, y): the top walked and driven on (the deck's top, bent over its last 1.5 m to
 *   exactly what it meets past each end line).
 * Browser: RoadBridges.create({T, streets, ground, toWorld, toLocal}) -> {meshes, floors, obstacles, groundAt, alongAt, over, surface,
 *   decks}.
 */
(function (root, factory) {
  const m = factory();root.RoadBridges = m;if (typeof module !== 'undefined' && module.exports) module.exports = m;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const STEP = 3, RAIL_H = 1.0, PIER = .45, PIER_EVERY = 20;
  const COL = {road: 0x36383b, pave: 0x6f7071, kerb: 0xa9a69e, concrete: 0x9a978f, under: 0x75726c, pier: 0x8e8b83};
  // (vertex colours are linear: the sRGB hex values are converted, as three.js does for material colours)
  const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  const rgb = hex => [lin((hex >> 16 & 255) / 255), lin((hex >> 8 & 255) / 255), lin((hex & 255) / 255)];

  // A deck's frame at t: the point on its line and the unit direction (x, s); offsets y turn to (-ds, dx).
  function frame(d, t) {
    const p = d.p, n = p.length / 2;let k = 0;
    while (k < n - 2 && d.cum[k + 1] < t) k++;
    const dx = p[k * 2 + 2] - p[k * 2], ds = p[k * 2 + 3] - p[k * 2 + 1], l = Math.hypot(dx, ds) || 1, f = (t - d.cum[k]) / l;
    return {x: p[k * 2] + dx * f, s: p[k * 2 + 1] + ds * f, fx: dx / l, fs: ds / l, k};
  }
  // The stations along a deck: every vertex (with a mitred direction) and at most STEP metres apart.
  function stations(d) {
    const out = [], n = d.p.length / 2;
    for (let k = 0; k < n - 1; k++) {
      const a = d.cum[k], b = d.cum[k + 1], m = Math.max(1, Math.ceil((b - a) / STEP));
      for (let q = 0; q < m; q++) out.push(a + (b - a) * q / m);
    }
    out.push(d.L);
    return out.map(t => {
      const f = frame(d, t);
      // at a vertex the direction is the mean of the two segments (so neighbouring pieces share their edge)
      const v = d.cum.findIndex(c => Math.abs(c - t) < 1e-6);
      if (v > 0 && v < n - 1) {
        const a = [d.p[v * 2] - d.p[v * 2 - 2], d.p[v * 2 + 1] - d.p[v * 2 - 1]], b = [d.p[v * 2 + 2] - d.p[v * 2], d.p[v * 2 + 3] - d.p[v * 2 + 1]];
        const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1, mx = a[0] / la + b[0] / lb, ms = a[1] / la + b[1] / lb, lm = Math.hypot(mx, ms) || 1;
        f.fx = mx / lm;f.fs = ms / lm;f.x = d.p[v * 2];f.s = d.p[v * 2 + 1];
      }
      f.t = t;return f;
    });
  }
  const at = (f, y) => [f.x - f.fs * y, f.s + f.fx * y];

  // Is (x, s) on a deck drawn over this one (a more major one, or the same rank and a higher number)?
  function coveredBy(streets, d, x, s, any = false) {
    for (const o of streets.decksAt(x, s, [])) if (o.d !== d && Math.abs(o.y) <= o.d.W && (any || o.d.pri > d.pri || (o.d.pri === d.pri && o.d.id > d.id))) return true;
    return false;
  }

  function geometry(streets) {
    const DECK = streets.DECK, P = streets.PARAPET, KERB = streets.KERB_H;
    const pos = [], nor = [], col = [], floors = [], obstacles = [], piers = [];
    const quad = (a, b, c, e, n, hex) => {const k = rgb(hex);for (const v of [a, b, c, a, c, e]) {pos.push(v[0], v[1], v[2]);nor.push(n[0], n[1], n[2]);col.push(k[0], k[1], k[2]);}};
    // a quad's normal from its corners (facing the side the corners turn counter-clockwise to, seen from outside)
    const normal = (a, b, c) => {const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;return n.map(q => q / l);};
    // A face facing `want` (a rough direction): the corners are flipped when they turn the other way.
    const face = (a, b, c, e, want, hex) => {let n = normal(a, b, c);if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {[b, e] = [e, b];n = n.map(q => -q);}quad(a, b, c, e, n, hex);};
    const P3 = (f, y, h) => {const [x, s] = at(f, y);return [x, h, s];};
    for (const d of streets.decks) {
      const W = d.W, st = stations(d), top = (f, y) => d.top(f.t, y);
      const cuts = d.sw ? [-W, -d.hw, d.hw, W] : [-W, W];
      for (let i = 0; i + 1 < st.length; i++) {
        const A = st[i], B = st[i + 1], [cx, cs] = at(frame(d, (A.t + B.t) / 2), 0);
        const side = (y, sg) => [-A.fs * sg, 0, A.fx * sg];
        // top strips (pavement, road, pavement) and the kerb faces, unless a more major deck is drawn here
        for (let q = 0; q + 1 < cuts.length; q++) {
          const y0 = cuts[q], y1 = cuts[q + 1], ym = (y0 + y1) / 2, [mx, ms] = at(frame(d, (A.t + B.t) / 2), ym);
          if (coveredBy(streets, d, mx, ms)) continue;
          const pave = d.sw && Math.abs(ym) > d.hw, h0 = f => top(f, y0 + 1e-4), h1 = f => top(f, y1 - 1e-4);// (each strip's own side of a kerb)
          face(P3(A, y0, h0(A)), P3(B, y0, h0(B)), P3(B, y1, h1(B)), P3(A, y1, h1(A)), [0, 1, 0], pave ? COL.pave : COL.road);
        }
        if (d.sw) for (const sg of [-1, 1]) {
          const y = sg * d.hw, [mx, ms] = at(frame(d, (A.t + B.t) / 2), y);if (coveredBy(streets, d, mx, ms)) continue;
          face(P3(A, y, top(A, y - sg * .001)), P3(B, y, top(B, y - sg * .001)), P3(B, y, top(B, y + sg * .001)), P3(A, y, top(A, y + sg * .001)), side(y, -sg), COL.kerb);
        }
        // parapets (inner face, cap, outer face down to the underside), left out inside another deck
        const lo = Math.min(top(A, 0), top(B, 0));
        for (const sg of [-1, 1]) {
          const [px, ps] = at(frame(d, (A.t + B.t) / 2), sg * (W + P / 2));if (coveredBy(streets, d, px, ps, true)) continue;
          const yi = sg * W, yo = sg * (W + P), hA = top(A, yi) + RAIL_H, hB = top(B, yi) + RAIL_H;
          face(P3(A, yi, top(A, yi)), P3(B, yi, top(B, yi)), P3(B, yi, hB), P3(A, yi, hA), side(yi, -sg), COL.concrete);
          face(P3(A, yi, hA), P3(B, yi, hB), P3(B, yo, hB), P3(A, yo, hA), [0, 1, 0], COL.concrete);
          face(P3(A, yo, top(A, 0) - DECK), P3(B, yo, top(B, 0) - DECK), P3(B, yo, hB), P3(A, yo, hA), side(yo, sg), COL.concrete);
          // (the parapet as a solid: from the underside to its top)
          const poly = [at(A, yi), at(B, yi), at(B, yo), at(A, yo)];
          obstacles.push({points: poly, minY: lo - DECK, maxY: Math.max(hA, hB), kind: 'bridge parapet'});
        }
        // the underside (skipped under a more major deck)
        if (!coveredBy(streets, d, cx, cs)) face(P3(A, -W - P, top(A, 0) - DECK), P3(B, -W - P, top(B, 0) - DECK), P3(B, W + P, top(B, 0) - DECK), P3(A, W + P, top(A, 0) - DECK), [0, -1, 0], COL.under);
        // the deck as a ceiling for what passes under it (not its last 1.5 m, where it meets the ground)
        if (A.t >= 1.5 && B.t <= d.L - 1.5) obstacles.push({points: [at(A, -W), at(B, -W), at(B, W), at(A, W)], minY: lo - DECK, maxY: lo - .05, kind: 'bridge deck'});
      }
      // the end faces, from the underside to the top
      for (const [f, sg] of [[st[0], -1], [st[st.length - 1], 1]]) {
        const ys = [-W - P, ...cuts, W + P];
        for (let q = 0; q + 1 < ys.length; q++) {
          const y0 = ys[q], y1 = ys[q + 1], h0 = Math.abs(y0) > W ? top(f, Math.sign(y0) * W) : top(f, y0 + (y1 > y0 ? .0001 : 0)), h1 = Math.abs(y1) > W ? top(f, Math.sign(y1) * W) : top(f, y1 - .0001);
          face(P3(f, y0, top(f, 0) - DECK), P3(f, y1, top(f, 0) - DECK), P3(f, y1, h1), P3(f, y0, h0), [f.fx * sg, 0, f.fs * sg], COL.concrete);
        }
      }
      // the floor: the deck's outline through its line's points (few edges, so the walk world's edge test stays quick)
      {const vs = st.filter(f => d.cum.some(c => Math.abs(c - f.t) < 1e-6));floors.push({deck: d, t0: 0, t1: d.L, points: [...vs.map(f => at(f, -W)), ...vs.slice().reverse().map(f => at(f, W))]});}
      // piers: under the deck where it is high enough, not on a road or on a line passing under it
      const lines = d.bridges.flatMap(b => b.cross).map(x => x.u);
      const n = Math.floor((d.L - 8) / PIER_EVERY);
      for (let q = 1; q <= n; q++) {
        const t = 4 + (d.L - 8) * q / (n + 1), f = frame(d, t), under = d.top(t, 0) - DECK;
        for (const y of W > 5 ? [-W * .55, W * .55] : [0]) {
          const [x, s] = at(f, y), g = streets.height(x, s);if (under - g < 1.2) continue;
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (f.fx * a - f.fs * b) * PIER, s + (f.fs * a + f.fx * b) * PIER]);
          if (corners.some(([cx, cs]) => streets.classAt(cx, cs) === 1) || lines.some(u => Math.abs((x - u.x) * u.ds - (s - u.s) * u.dx) < u.w / 2 + 1.5)) continue;
          const g0 = Math.min(...corners.map(([cx, cs]) => streets.height(cx, cs))) - .3;
          piers.push({x, s, fx: f.fx, fs: f.fs, y0: g0, y1: under});
          const c3 = corners.map(([cx, cs]) => [cx, cs]);
          for (let e = 0; e < 4; e++) {const a = c3[e], b = c3[(e + 1) % 4], mid = [(a[0] + b[0]) / 2 - x, 0, (a[1] + b[1]) / 2 - s];face([a[0], g0, a[1]], [b[0], g0, b[1]], [b[0], under, b[1]], [a[0], under, a[1]], mid, COL.pier);}
          obstacles.push({points: c3, minY: g0, maxY: under, kind: 'bridge pier'});
        }
      }
    }
    return {pos, nor, col, floors, obstacles, piers};
  }

  // A deck's coordinates of a point (nearest segment): {t, y}.
  function coord(d, x, s) {
    const p = d.p;let bd = Infinity, t = 0, y = 0;
    for (let k = 0; k + 1 < p.length / 2; k++) {
      const ax = p[k * 2], as = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, ds = p[k * 2 + 3] - as, L2 = dx * dx + ds * ds || 1, L = Math.sqrt(L2);
      const u = ((x - ax) * dx + (s - as) * ds) / L2, uc = Math.max(0, Math.min(1, u)), dd = Math.hypot(x - ax - uc * dx, s - as - uc * ds);
      if (dd < bd) {bd = dd;t = Math.max(0, Math.min(d.L, d.cum[k] + uc * L));y = (dx * (s - as) - ds * (x - ax)) / L;}
    }
    return {t, y};
  }

  // The surface walked and driven on: the deck's top, which over its last 1.5 m bends to exactly what it meets past its end line
  // (a more major deck, else the ground, within 1.5 m), so the floors join with no step (walk-collision joins floors within 5 cm).
  function surfaceOf(streets) {
    const list0 = [];
    function meets(d, e, y) {
      const f = frame(d, e ? d.L : 0), [x, s] = at(f, Math.max(-d.W, Math.min(d.W, y))), o = e ? .002 : -.002, px = x + f.fx * o, ps = s + f.fs * o, own = d.top(e ? d.L : 0, y);
      let to = null;for (const q of streets.decksAt(px, ps, list0)) if (q.d !== d && (q.d.pri > d.pri || (q.d.pri === d.pri && q.d.id > d.id))) {const h = q.d.top(q.t, q.y);if (Math.abs(h - own) < 1.5 && (to === null || Math.abs(h - own) < Math.abs(to - own))) to = h;}
      if (to === null) {const h = streets.height(px, ps);if (Math.abs(h - own) < 1.5) to = h;}
      return to === null ? 0 : to - own;
    }
    const ease = u => {const v = Math.max(0, Math.min(1, u));return v * v * (3 - 2 * v);};
    function surface(d, t, y) {
      let h = d.top(t, y);
      if (t < 1.5) h += meets(d, 0, y) * (1 - ease(t / 1.5));
      if (d.L - t < 1.5) h += meets(d, 1, y) * (1 - ease((d.L - t) / 1.5));
      return h;
    }
    return surface;
  }

  function create({T, streets, ground, toWorld, toLocal}) {
    const G = geometry(streets), meshes = [];
    if (G.pos.length) {
      // one mesh per 400 m square (so the camera leaves out the ones out of view)
      const cells = new Map();
      for (let v = 0; v < G.pos.length; v += 18) {
        const cx = (G.pos[v] + G.pos[v + 6] + G.pos[v + 12]) / 3, cs = (G.pos[v + 2] + G.pos[v + 8] + G.pos[v + 14]) / 3, key = `${Math.floor(cx / 400)},${Math.floor(cs / 400)}`;
        if (!cells.has(key)) cells.set(key, []);cells.get(key).push(v);
      }
      const mat = new T.MeshStandardMaterial({vertexColors: true, roughness: .9, metalness: 0});
      for (const list of cells.values()) {
        const n = list.length * 6, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
        list.forEach((v, i) => {for (let q = 0; q < 18; q++) {pos[i * 18 + q] = G.pos[v + q] + (q % 3 === 1 ? ground : 0);nor[i * 18 + q] = G.nor[v + q];col[i * 18 + q] = G.col[v + q];}});
        const geo = new T.BufferGeometry();geo.setAttribute('position', new T.BufferAttribute(pos, 3));geo.setAttribute('normal', new T.BufferAttribute(nor, 3));geo.setAttribute('color', new T.BufferAttribute(col, 3));geo.computeBoundingSphere();
        const m = new T.Mesh(geo, mat);m.castShadow = m.receiveShadow = true;m.name = 'Road bridges';m.userData.noMerge = true;meshes.push(m);
      }
    }
    const W = ([x, s]) => toWorld(x, s);
    const surface = surfaceOf(streets);
    const floors = G.floors.map(f => ({name: `Bridge${f.deck.n ? ' ' + f.deck.n : ''}`, points: f.points.map(W), ceilingHeight: Infinity, surfaceKind: 'stone',
      height: p => {const l = toLocal(p.x, p.z), c = coord(f.deck, l.x, l.s);return ground + surface(f.deck, Math.max(f.t0, Math.min(f.t1, c.t)), c.y);}}));
    const obstacles = G.obstacles.map(o => ({points: o.points.map(W), minY: o.minY + ground, maxY: o.maxY + ground, kind: o.kind}));
    const list = [];
    // The deck under (x, z) for something at height y: the highest deck top at most 1 m above y (else null: the ground below).
    function groundAt(x, z, y) {
      if (y === undefined) return null;
      const l = toLocal(x, z);let best = null;
      for (const o of streets.decksAt(l.x, l.s, list)) {if (Math.abs(o.y) > o.d.W + streets.PARAPET) continue;const h = ground + surface(o.d, o.t, Math.max(-o.d.W, Math.min(o.d.W, o.y)));if (h <= y + 1 && (best === null || h > best)) best = h;}
      return best;
    }
    // The deck under a vehicle heading along it (within ~30°), for the trams and buses that follow their lines.
    function alongAt(x, z, hx, hz) {
      const l = toLocal(x, z), l2 = toLocal(x + hx, z + hz), lx = l2.x - l.x, ls = l2.s - l.s, ll = Math.hypot(lx, ls) || 1;let best = null;
      for (const o of streets.decksAt(l.x, l.s, list)) {
        if (Math.abs(o.y) > o.d.W) continue;const f = frame(o.d, o.t);
        if (Math.abs(f.fx * lx + f.fs * ls) / ll < .85) continue;
        const h = ground + surface(o.d, o.t, o.y);if (best === null || h > best) best = h;
      }
      return best;
    }
    const over = (x, z) => {const l = toLocal(x, z);return streets.decksAt(l.x, l.s, list).length > 0;};
    return {meshes, floors, obstacles, groundAt, alongAt, over, surface, decks: streets.decks, piers: G.piers.length};
  }
  return {geometry, create, surfaceOf, coord, frame, stations};
});
