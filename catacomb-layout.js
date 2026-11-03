/* Catacomb layout (issue #43): a large catacomb under Torshovdalen with three entrances about 100 m apart.
 * Pure data, no three.js, so it runs in Node tests. Everything is in the map's local frame: x east, s south (metres), y = world height.
 * The plan is a 2 m grid (88 × 84 cells) from local (X0, S0). Rooms are placed by hand; galleries between them are dug by a
 * seeded A* that keeps a cell of rock between neighbouring galleries; dark side galleries branch off the quarry tunnels.
 * Every entrance is a small stone mausoleum on the surface (its 4 × 8 m footprint is cut out of the ground) with a straight
 * stair under its back wall down to an entrance hall on the catacomb floor (FLOOR_Y).
 * CatacombLayout.build({heightLocal}) -> layout   heightLocal(x, s) -> terrain y
 *   layout: {kind, style, room (per cell), rooms, entrances, torches, cellOf(x, s), centre(i, j), floorAt(idx, x, s), ceilAt(idx, x, s),
 *            walkable(idx), los(x0, s0, x1, s1), floors(), obstacles(), vehicleObstacles(), cutsGround(x, s), inside(x, s, y), depth(x, s, y)}
 * CatacombLayout.explorer(layout, saved) -> {seen, reveal(x, s, radius), count, save()}   (what the map shows)
 * CatacombLayout.ENTRANCES, holes() (terrain cuts for Surroundings.create)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CatacombLayout = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const CELL = 2, X0 = -65, S0 = 99, NX = 88, NS = 84, FLOOR_Y = -28.5;
  // Terrain must be this far above the floor (the ceilings are up to 3.6 m, the rest is rock).
  const COVER = 5.5, ROOM_COVER = 6.6;
  const ROCK = 0, CORRIDOR = 1, ROOM = 2, STAIR = 3;
  const STYLES = ['rock', 'masonry', 'ossuary', 'quarry', 'crypt', 'rotunda', 'well', 'hall', 'stair', 'chapel', 'cavern', 'workroom'];
  const S = Object.fromEntries(STYLES.map((n, i) => [n, i]));
  const DARK = new Set([S.quarry, S.well, S.cavern, S.workroom]);
  // The mausoleums: footprint [x0, s0, x1, s1] on the terrain's 4 m grid, the stair runs along `dir` (the door is on the other side).
  const ENTRANCES = [
    {id: 'north', label: 'North', word: 'NORD', sted: 'PETANQUEBANEN', place: 'the petanque lawn', rect: [64, 132, 68, 140], dir: [0, 1]},
    {id: 'west', label: 'West', word: 'VEST', sted: 'VESTSIDEN AV TORSHOVDALEN', place: 'the west side of Torshovdalen', rect: [-28, 188, -20, 192], dir: [1, 0]},
    {id: 'south', label: 'South', word: 'SØR', sted: 'DEN STORE PLENEN I TORSHOVDALEN', place: 'the big lawn in Torshovdalen', rect: [40, 232, 44, 240], dir: [0, -1]},
  ];
  // Rooms in grid cells [i0, j0, i1, j1] (inclusive). Halls are added at the stair feet.
  const ROOMS = [
    {id: 'rotunda', name: 'Rotunda of bones', style: 'rotunda', cells: [47, 31, 51, 35], ceil: {type: 'dome', base: 2.8, rise: 1.8}},
    {id: 'chapel', name: 'Chapel of bones', style: 'chapel', cells: [16, 18, 19, 23], ceil: {type: 'cloister', base: 2.9, rise: .7}},
    {id: 'crypt', name: 'Crypt', style: 'crypt', cells: [35, 60, 40, 63], ceil: {type: 'cloister', base: 3.0, rise: .9}},
    {id: 'well', name: 'Quarrymen’s well', style: 'well', cells: [79, 54, 81, 56], ceil: {type: 'flat', base: 3.1}},
    {id: 'cavern', name: 'Collapsed quarry', style: 'cavern', cells: [69, 70, 73, 74], ceil: {type: 'flat', base: 3.4}},
    {id: 'workroom', name: 'Quarrymen’s room', style: 'workroom', cells: [77, 8, 80, 11], ceil: {type: 'flat', base: 2.9}},
    {id: 'sacellum', name: 'Sacellum', style: 'chapel', cells: [6, 43, 9, 47], ceil: {type: 'cloister', base: 2.9, rise: .8}},
    {id: 'bonehall', name: 'Hall of skulls', style: 'chapel', cells: [10, 62, 15, 65], ceil: {type: 'cloister', base: 3.0, rise: .8}},
  ];
  // Galleries between rooms: [from, to, style]. Lit: masonry and ossuary. Dark: quarry.
  const LINKS = [
    ['hall-north', 'rotunda', 'ossuary'], ['rotunda', 'hall-south', 'masonry'], ['rotunda', 'chapel', 'ossuary'], ['chapel', 'hall-west', 'masonry'],
    ['hall-west', 'sacellum', 'ossuary'], ['sacellum', 'bonehall', 'ossuary'], ['bonehall', 'crypt', 'masonry'], ['crypt', 'hall-south', 'masonry'],
    ['hall-south', 'well', 'quarry'], ['well', 'hall-north', 'quarry'], ['well', 'cavern', 'quarry'], ['cavern', 'crypt', 'quarry'],
    ['hall-north', 'workroom', 'quarry'], ['workroom', 'chapel', 'quarry'], ['sacellum', 'chapel', 'quarry'], ['bonehall', 'cavern', 'quarry'],
  ];
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const holes = () => ENTRANCES.map(e => ({x0: e.rect[0], s0: e.rect[1], x1: e.rect[2], s1: e.rect[3], cutGround: true}));

  function build({heightLocal, seed = 4301}) {
    const N = NX * NS, kind = new Uint8Array(N), style = new Uint8Array(N), roomOf = new Int16Array(N).fill(-1), blocked = new Uint8Array(N);
    const id = (i, j) => j * NX + i, inGrid = (i, j) => i >= 0 && j >= 0 && i < NX && j < NS;
    const centre = (i, j) => ({x: X0 + (i + .5) * CELL, s: S0 + (j + .5) * CELL});
    const cellOf = (x, s) => {const i = Math.floor((x - X0) / CELL), j = Math.floor((s - S0) / CELL);return inGrid(i, j) ? {i, j, idx: id(i, j)} : null;};
    const walkable = idx => kind[idx] !== ROCK;
    // Rock cover above each cell (the lowest terrain over its corners and centre).
    const cover = new Float32Array(N);
    for (let j = 0; j < NS; j++) for (let i = 0; i < NX; i++) {
      const x = X0 + i * CELL, s = S0 + j * CELL;
      cover[id(i, j)] = Math.min(heightLocal(x, s), heightLocal(x + CELL, s), heightLocal(x, s + CELL), heightLocal(x + CELL, s + CELL), heightLocal(x + 1, s + 1)) - FLOOR_Y;
    }
    // ---------- Entrances: mausoleum, stair, hall ----------
    const entrances = ENTRANCES.map(e => {
      const [x0, s0, x1, s1] = e.rect, alongX = e.dir[0] !== 0, sign = alongX ? e.dir[0] : e.dir[1];
      const door = alongX ? (sign > 0 ? x0 : x1) : (sign > 0 ? s0 : s1), line = alongX ? (s0 + s1) / 2 : (x0 + x1) / 2;
      let top = -Infinity;for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) top = Math.max(top, heightLocal(x0 + (x1 - x0) * a / 4, s0 + (s1 - s0) * b / 4));
      top = Math.round((top + .12) * 100) / 100;
      const depth = top - FLOOR_Y, t0 = 2.2, landing = depth > 12 ? 2 : 0, want = t0 + depth / .6 + landing;
      const tBottom = 2 * Math.ceil((want - 1) / 2) + 1, run = tBottom - t0 - landing, slope = depth / run, tMid = t0 + run / 2;
      // t = metres from the outer face of the door along the stair; the inner face of the 1 m front wall is t = 1.
      const floorT = t => t <= t0 ? top : t <= tMid ? top - slope * (t - t0) : t <= tMid + landing ? top - slope * (tMid - t0) : Math.max(FLOOR_Y, top - slope * (t - t0 - landing));
      const toLocal = (t, c) => alongX ? {x: door + sign * t, s: line + c} : {x: line + c, s: door + sign * t};
      const tOf = (x, s) => ((alongX ? x : s) - door) * sign;
      const lane = alongX ? (line - 1 - S0) / CELL : (line - 1 - X0) / CELL;
      const cells = [];for (let t = 1; t < tBottom; t += CELL) {const p = toLocal(t + 1, 0), c = cellOf(p.x, p.s);cells.push(c.idx);}
      const foot = toLocal(tBottom + 3, 0), fc = cellOf(foot.x, foot.s);
      const hall = {id: 'hall-' + e.id, name: `${e.label} entrance hall`, style: 'hall', ceil: {type: 'cloister', base: 2.9, rise: .6}, entrance: e.id,
        cells: [fc.i - 1, fc.j - 1, fc.i + 1, fc.j + 1]};
      return {...e, alongX, sign, door, line, top, depth, t0, tMid, landing, tBottom, slope, floorT, toLocal, tOf, lane, cells, hall,
        doorWidth: 1.6, pavilionTop: top + 3.0, inner: 7, headroom: 2.4};
    });
    const rooms = [...entrances.map(e => e.hall), ...ROOMS.map(r => ({...r}))];
    rooms.forEach((r, k) => {
      const [i0, j0, i1, j1] = r.cells;r.index = k;r.x0 = X0 + i0 * CELL;r.s0 = S0 + j0 * CELL;r.x1 = X0 + (i1 + 1) * CELL;r.s1 = S0 + (j1 + 1) * CELL;
      r.cx = (r.x0 + r.x1) / 2;r.cs = (r.s0 + r.s1) / 2;r.dark = DARK.has(S[r.style]);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {const c = id(i, j);kind[c] = ROOM;style[c] = S[r.style];roomOf[c] = k;}
    });
    entrances.forEach(e => {
      e.cells.forEach(c => {kind[c] = STAIR;style[c] = S.stair;});
      // Keep other galleries a cell away from the stair tunnel (it climbs through the rock above them).
      e.cells.forEach(c => {const i = c % NX, j = Math.floor(c / NX);for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (inGrid(i + di, j + dj)) blocked[id(i + di, j + dj)] = 1;});
    });
    const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
    // ---------- Galleries (seeded A*) ----------
    const rnd = rng(seed), DI = [0, 1, 0, -1], DJ = [-1, 0, 1, 0];// N E S W (north = -s)
    // Smooth value noise (6-cell lattice) makes the galleries meander instead of running dead straight.
    const lat = Float32Array.from({length: (NX / 6 + 2) * (NS / 6 + 2) | 0}, () => rnd()), LW = NX / 6 + 2 | 0;
    const noise = Float32Array.from({length: N}, (_, c) => {const fi = (c % NX) / 6, fj = Math.floor(c / NX) / 6, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, L = (a, b) => lat[b * LW + a];
      return (L(i, j) * (1 - u) + L(i + 1, j) * u) * (1 - v) + (L(i, j + 1) * (1 - u) + L(i + 1, j + 1) * u) * v;});
    const coverOk = c => cover[c] >= COVER;
    const middle = r => id(Math.floor((r.cells[0] + r.cells[2]) / 2), Math.floor((r.cells[1] + r.cells[3]) / 2));
    function dig(a, b, st) {
      const A = roomById[a], B = roomById[b], s0 = middle(A), g0 = middle(B);
      // One waypoint off to the side of the straight line, where the rock allows it.
      const ai = s0 % NX, aj = Math.floor(s0 / NX), bi = g0 % NX, bj = Math.floor(g0 / NX), len = Math.hypot(bi - ai, bj - aj);
      let via = null;
      for (let tries = 0; tries < 12 && !via; tries++) {
        const off = (rnd() - .5) * len * .5, wi = Math.round((ai + bi) / 2 - (bj - aj) / len * off), wj = Math.round((aj + bj) / 2 + (bi - ai) / len * off);
        if (wi > 2 && wj > 2 && wi < NX - 3 && wj < NS - 3 && kind[id(wi, wj)] === ROCK && coverOk(id(wi, wj)) && !blocked[id(wi, wj)]) via = id(wi, wj);
      }
      const p1 = via !== null ? route(s0, via, A, B, st) : null;
      return p1 ? (route(via, g0, A, B, st) || p1) : route(s0, g0, A, B, st);
    }
    function route(start, goal, A, B, st) {
      const gi = goal % NX, gj = Math.floor(goal / NX), best = new Float32Array(N * 5).fill(Infinity), from = new Int32Array(N * 5).fill(-1), heap = [];
      const push = (f, st2) => {heap.push([f, st2]);let k = heap.length - 1;while (k) {const p = (k - 1) >> 1;if (heap[p][0] <= heap[k][0]) break;[heap[p], heap[k]] = [heap[k], heap[p]];k = p;}};
      const pop = () => {const top = heap[0], last = heap.pop();if (heap.length) {heap[0] = last;let k = 0;for (;;) {const l = 2 * k + 1, r = l + 1;let m = k;if (l < heap.length && heap[l][0] < heap[m][0]) m = l;if (r < heap.length && heap[r][0] < heap[m][0]) m = r;if (m === k) break;[heap[m], heap[k]] = [heap[k], heap[m]];k = m;}}return top;};
      const h = c => Math.abs(c % NX - gi) + Math.abs(Math.floor(c / NX) - gj);
      best[start * 5 + 4] = 0;push(h(start), start * 5 + 4);
      while (heap.length) {
        const [, s5] = pop(), c = Math.floor(s5 / 5), d = s5 % 5, g = best[s5];
        if (c === goal) {
          const path = [];for (let s = s5; s >= 0; s = from[s]) path.push(Math.floor(s / 5));
          path.forEach(p => {if (kind[p] === ROCK) {kind[p] = CORRIDOR;style[p] = S[st];}});return path;
        }
        const ci = c % NX, cj = Math.floor(c / NX);
        for (let nd = 0; nd < 4; nd++) {
          const ni = ci + DI[nd], nj = cj + DJ[nd];if (ni < 1 || nj < 1 || ni > NX - 2 || nj > NS - 2) continue;
          const n = id(ni, nj);let cost;
          if (kind[n] === STAIR || blocked[n] && kind[n] !== ROOM) continue;
          if (kind[n] === ROOM) cost = roomOf[n] === A.index || roomOf[n] === B.index ? .2 : 6;
          else if (kind[n] === CORRIDOR) cost = .7;
          else {
            if (!coverOk(n)) continue;
            cost = 1 + noise[n] * 2.6;
            // Do not run alongside another gallery: a cell of rock stays between them.
            for (let k = 0; k < 4; k++) {const qi = ni + DI[k], qj = nj + DJ[k], q = id(qi, qj);if (q !== c && walkable(q) && roomOf[q] !== A.index && roomOf[q] !== B.index) cost += 7;}
            for (const [qi, qj] of [[ni - 1, nj - 1], [ni + 1, nj - 1], [ni - 1, nj + 1], [ni + 1, nj + 1]]) {const q = id(qi, qj);if (walkable(q) && Math.abs(qi - ci) + Math.abs(qj - cj) > 1) cost += 1.5;}
          }
          if (d < 4 && d !== nd) cost += 1.1;
          const s2 = n * 5 + nd, g2 = g + cost;
          if (g2 < best[s2]) {best[s2] = g2;from[s2] = s5;push(g2 + h(n), s2);}
        }
      }
      return null;
    }
    const paths = LINKS.map(([a, b, st]) => ({a, b, style: st, path: dig(a, b, st)}));
    // Dark side galleries off the quarry tunnels, some meeting other tunnels (loops), most ending blind.
    const quarry = () => {const l = [];for (let c = 0; c < N; c++) if (kind[c] === CORRIDOR && style[c] === S.quarry) l.push(c);return l;};
    const freeAround = (n, prev) => {const ni = n % NX, nj = Math.floor(n / NX);for (let k = 0; k < 4; k++) {const q = id(ni + DI[k], nj + DJ[k]);if (q !== prev && walkable(q)) return false;}return true;};
    for (let k = 0; k < 70; k++) {
      const list = quarry(), c0 = list[Math.floor(rnd() * list.length)];if (c0 === undefined) break;
      let c = c0, d = Math.floor(rnd() * 4), len = 3 + Math.floor(rnd() * 11);
      for (let step = 0; step < len; step++) {
        const ci = c % NX, cj = Math.floor(c / NX), ni = ci + DI[d], nj = cj + DJ[d];
        if (ni < 1 || nj < 1 || ni > NX - 2 || nj > NS - 2) break;
        const n = id(ni, nj);if (walkable(n) || blocked[n] || !coverOk(n)) break;
        if (!freeAround(n, c)) {if (rnd() < .3 && step > 1) {kind[n] = CORRIDOR;style[n] = S.quarry;}break;}
        // Diagonal neighbours other than the way we came would merge two galleries into a wide hall.
        let diag = false;for (const [qi, qj] of [[ni - 1, nj - 1], [ni + 1, nj - 1], [ni - 1, nj + 1], [ni + 1, nj + 1]]) if (walkable(id(qi, qj)) && Math.abs(qi - ci) + Math.abs(qj - cj) > 1) diag = true;
        if (diag) break;
        kind[n] = CORRIDOR;style[n] = S.quarry;c = n;if (rnd() < .28) d = (d + (rnd() < .5 ? 1 : 3)) % 4;
      }
    }
    // Short blind niches off the lit ossuary galleries (more bones).
    for (let c = 0; c < N; c++) if (kind[c] === CORRIDOR && style[c] === S.ossuary && rnd() < .07) {
      const ci = c % NX, cj = Math.floor(c / NX), d = Math.floor(rnd() * 4), n = id(ci + DI[d], cj + DJ[d]);
      if (!walkable(n) && !blocked[n] && coverOk(n) && freeAround(n, c)) {let diag = false;const ni = n % NX, nj = Math.floor(n / NX);for (const [qi, qj] of [[ni - 1, nj - 1], [ni + 1, nj - 1], [ni - 1, nj + 1], [ni + 1, nj + 1]]) if (walkable(id(qi, qj)) && Math.abs(qi - ci) + Math.abs(qj - cj) > 1) diag = true;if (!diag) {kind[n] = CORRIDOR;style[n] = S.ossuary;}}
    }
    // ---------- Heights ----------
    const stairOf = new Int8Array(N).fill(-1);entrances.forEach((e, k) => e.cells.forEach(c => {stairOf[c] = k;}));
    const open = c => {const i = c % NX, j = Math.floor(c / NX);return [0, 1, 2, 3].map(k => inGrid(i + DI[k], j + DJ[k]) && walkable(id(i + DI[k], j + DJ[k])));};
    // Gallery ceilings: a barrel vault (springing 1.9 m, crown 2.75 m) along straight runs, flat 2.75 m at bends and junctions.
    const vault = new Int8Array(N);// 0 flat, 1 along s (north-south), 2 along x
    for (let c = 0; c < N; c++) if (kind[c] === CORRIDOR) {const o = open(c);if (!o[1] && !o[3] && (o[0] || o[2])) vault[c] = 1;else if (!o[0] && !o[2] && (o[1] || o[3])) vault[c] = 2;}
    function floorAt(c, x, s) {const k = stairOf[c];if (k < 0) return FLOOR_Y;const e = entrances[k];return e.floorT(e.tOf(x, s));}
    function ceilAt(c, x, s) {
      const k = stairOf[c];
      if (k >= 0) {const e = entrances[k], t = e.tOf(x, s);return t < e.inner ? e.pavilionTop : e.floorT(t) + e.headroom;}
      if (kind[c] === ROOM) {
        const r = rooms[roomOf[c]], f = r.ceil, u = (x - r.cx) / ((r.x1 - r.x0) / 2), v = (s - r.cs) / ((r.s1 - r.s0) / 2);
        if (f.type === 'dome') {const q = Math.min(1, Math.hypot(u, v) / Math.SQRT2);return FLOOR_Y + f.base + f.rise * Math.sqrt(1 - q * q);}
        if (f.type === 'cloister') {const m = Math.min(1, Math.max(Math.abs(u), Math.abs(v)));return FLOOR_Y + f.base + f.rise * (1 - m * m);}
        return FLOOR_Y + f.base;
      }
      const v = vault[c];if (!v) return FLOOR_Y + 2.75;
      const ctr = centre(c % NX, Math.floor(c / NX)), u = Math.max(-1, Math.min(1, v === 1 ? x - ctr.x : s - ctr.s));
      return FLOOR_Y + 1.9 + .85 * Math.sqrt(1 - u * u);
    }
    // ---------- Line of sight on the grid (Amanatides–Woo) ----------
    function los(xa, sa, xb, sb) {
      let i = Math.floor((xa - X0) / CELL), j = Math.floor((sa - S0) / CELL);const ib = Math.floor((xb - X0) / CELL), jb = Math.floor((sb - S0) / CELL);
      const dx = xb - xa, ds = sb - sa, si = Math.sign(dx), sj = Math.sign(ds);
      const tdx = si ? CELL / Math.abs(dx) : Infinity, tds = sj ? CELL / Math.abs(ds) : Infinity;
      let tx = si ? ((si > 0 ? X0 + (i + 1) * CELL : X0 + i * CELL) - xa) / dx : Infinity, ts = sj ? ((sj > 0 ? S0 + (j + 1) * CELL : S0 + j * CELL) - sa) / ds : Infinity;
      for (let n = 0; n < 400; n++) {
        if (!inGrid(i, j) || !walkable(id(i, j))) return false;
        if (i === ib && j === jb) return true;
        // Passing exactly through a corner needs both side cells open.
        if (Math.abs(tx - ts) < 1e-9) {if (!inGrid(i + si, j) || !walkable(id(i + si, j)) || !inGrid(i, j + sj) || !walkable(id(i, j + sj))) return false;i += si;j += sj;tx += tdx;ts += tds;}
        else if (tx < ts) {i += si;tx += tdx;} else {j += sj;ts += tds;}
      }
      return false;
    }
    // ---------- Torches on the walls of the lit parts ----------
    const torches = [];
    {
      const lit = c => walkable(c) && !DARK.has(style[c]);
      const near = (x, s, r) => torches.some(t => Math.hypot(t.x - x, t.s - s) < r);
      const order = [];for (let c = 0; c < N; c++) if (lit(c)) order.push(c);
      for (const c of order) {
        const i = c % NX, j = Math.floor(c / NX), ctr = centre(i, j), o = open(c), st = style[c];
        const spacing = kind[c] === ROOM ? 5.5 : st === S.stair ? 6 : 6.5;
        for (let k = 0; k < 4; k++) {
          if (o[k]) continue;
          // The wall is on side k; the torch hangs 0.12 m off it at 1.85 m (lower in the vaulted galleries' springing).
          const nx = -DI[k], ns = -DJ[k], x = ctr.x + DI[k] * (CELL / 2 - .12), s = ctr.s + DJ[k] * (CELL / 2 - .12);
          if (st === S.stair) {const e = entrances[stairOf[c]], t = e.tOf(x, s);if (t < 2 || Math.abs(e.alongX ? DI[k] : DJ[k]) > 0) continue;}
          if (kind[c] === CORRIDOR && (k + i + j) % 2) continue;
          if (near(x, s, spacing)) continue;
          const y = floorAt(c, x, s) + (st === S.stair ? 1.75 : 1.8);
          torches.push({x, s, y, nx, ns, cell: c, phase: torches.length % 4});
        }
      }
    }
    // ---------- Collision (world coordinates come from the caller's toWorld) ----------
    function wallRuns() {
      // Every edge between a walkable cell and rock (or the door of a mausoleum), merged into straight runs.
      const runs = [], key = (c, k) => c * 4 + k, used = new Set();
      for (let c = 0; c < N; c++) if (walkable(c)) {
        const o = open(c);
        for (let k = 0; k < 4; k++) {
          if (o[k] || used.has(key(c, k))) continue;
          // Walk back to the start of this straight run, then forward.
          const along = k % 2 === 0 ? 1 : 0, bones = q => style[q] === S.ossuary || style[q] === S.chapel;// N/S walls run along x
          const same = p => walkable(p) && !open(p)[k] && bones(p) === bones(c) && (stairOf[p] < 0) === (stairOf[c] < 0);
          let a = c;for (;;) {const ai = a % NX - along, aj = Math.floor(a / NX) - (1 - along);if (!inGrid(ai, aj) || !same(id(ai, aj))) break;a = id(ai, aj);}
          const cells = [];for (let b = a; ; ) {cells.push(b);used.add(key(b, k));const bi = b % NX + along, bj = Math.floor(b / NX) + (1 - along);if (!inGrid(bi, bj) || !same(id(bi, bj))) break;b = id(bi, bj);}
          runs.push({side: k, cells});
        }
      }
      return runs;
    }
    const runs = wallRuns();
    function obstacles(toWorld) {
      const list = [], W = (x, s) => toWorld(x, s);
      for (const r of runs) {
        const first = centre(r.cells[0] % NX, Math.floor(r.cells[0] / NX)), last = centre(r.cells[r.cells.length - 1] % NX, Math.floor(r.cells[r.cells.length - 1] / NX)), k = r.side;
        const ossuary = r.cells.every(c => style[c] === S.ossuary || style[c] === S.chapel), inset = ossuary ? .22 : 0;
        let lo = Infinity, hi = -Infinity;for (const c of r.cells) {const p = centre(c % NX, Math.floor(c / NX));lo = Math.min(lo, floorAt(c, p.x - 1, p.s - 1), floorAt(c, p.x + 1, p.s + 1));hi = Math.max(hi, ceilAt(c, p.x, p.s));}
        // The wall line (on the cell edge) and the rock behind it; k: 0 N (-s), 1 E (+x), 2 S (+s), 3 W (-x).
        const dx = DI[k], ds = DJ[k], ax = k % 2 === 0 ? [first.x - 1, last.x + 1] : null, as = k % 2 ? [first.s - 1, last.s + 1] : null;
        const wall = k % 2 === 0 ? first.s + ds * 1 : first.x + dx * 1;
        let pts;
        if (k % 2 === 0) pts = [[ax[0], wall - ds * inset], [ax[1], wall - ds * inset], [ax[1], wall + ds * .4], [ax[0], wall + ds * .4]];
        else pts = [[wall - dx * inset, as[0]], [wall - dx * inset, as[1]], [wall + dx * .4, as[1]], [wall + dx * .4, as[0]]];
        // A mausoleum's door is a gap in its front wall.
        const e = entrances.find(en => r.cells.includes(en.cells[0]) && (en.alongX ? k === (en.sign > 0 ? 3 : 1) : k === (en.sign > 0 ? 0 : 2)));
        if (e) {
          const a = e.alongX ? pts.map(p => p[1]) : pts.map(p => p[0]), lo2 = Math.min(...a), hi2 = Math.max(...a), g0 = e.line - e.doorWidth / 2, g1 = e.line + e.doorWidth / 2;
          for (const [u0, u1] of [[lo2, g0], [g1, hi2]]) if (u1 - u0 > .01) {const q = pts.map(p => e.alongX ? [p[0], p[1] === lo2 ? u0 : u1] : [p[0] === lo2 ? u0 : u1, p[1]]);list.push({points: q.map(p => W(p[0], p[1])), minY: lo - .5, maxY: hi + .5, kind: 'catacomb'});}
          continue;
        }
        list.push({points: pts.map(p => W(p[0], p[1])), minY: lo - .5, maxY: hi + .5, kind: 'catacomb'});
      }
      // The mausoleums' outer walls, for people outside (the stair passes under the back wall below minY).
      for (const e of entrances) {
        const [x0, s0, x1, s1] = e.rect, y0 = e.top - .6, y1 = e.top + 5, box = (a, b, c, d) => list.push({points: [W(a, b), W(c, b), W(c, d), W(a, d)], minY: y0, maxY: y1, kind: 'mausoleum'});
        const g0 = e.line - e.doorWidth / 2, g1 = e.line + e.doorWidth / 2;
        if (e.alongX) {box(x0, s0, x1, s0 + 1);box(x0, s1 - 1, x1, s1);const fx = e.sign > 0 ? x0 : x1 - 1, bx = e.sign > 0 ? x1 - 1 : x0;box(bx, s0, bx + 1, s1);box(fx, s0, fx + 1, g0);box(fx, g1, fx + 1, s1);}
        else {box(x0, s0, x0 + 1, s1);box(x1 - 1, s0, x1, s1);const fs = e.sign > 0 ? s0 : s1 - 1, bs = e.sign > 0 ? s1 - 1 : s0;box(x0, bs, x1, bs + 1);box(x0, fs, g0, fs + 1);box(g1, fs, x1, fs + 1);}
      }
      return list;
    }
    function vehicleObstacles(toWorld) {return entrances.map(e => {const [x0, s0, x1, s1] = e.rect;return {points: [toWorld(x0, s0), toWorld(x1, s0), toWorld(x1, s1), toWorld(x0, s1)], minY: e.top - 1, maxY: e.top + 5, kind: 'mausoleum'};});}
    // Walk floors: the catacomb floor (one rectangle under the whole grid; the walls are obstacles), and per entrance the door
    // threshold (it meets the terrain exactly at the door), the top landing, two flights and the half landing.
    function floors(toWorld, toLocal) {
      const list = [{name: 'Catacomb floor', points: [toWorld(X0, S0), toWorld(X0 + NX * CELL, S0), toWorld(X0 + NX * CELL, S0 + NS * CELL), toWorld(X0, S0 + NS * CELL)], y: FLOOR_Y, ceilingHeight: 2.6, surfaceKind: 'stone'}];
      for (const e of entrances) {
        const quad = (t0, t1, w) => [e.toLocal(t0, -w), e.toLocal(t1, -w), e.toLocal(t1, w), e.toLocal(t0, w)].map(p => toWorld(p.x, p.s));
        // The threshold rises from the terrain at the outer face of the door (so the two floors meet exactly) to the landing.
        const threshold = p => {const q = toLocal(p.x, p.z), t = Math.max(0, Math.min(1, e.tOf(q.x, q.s))), d = e.toLocal(0, (e.alongX ? q.s : q.x) - e.line), g = heightLocal(d.x, d.s);return g + (e.top - g) * t;};
        list.push({name: `Catacomb door (${e.id})`, points: quad(0, 1, e.doorWidth / 2), height: threshold, ceilingHeight: 2.3, surfaceKind: 'stone'});
        list.push({name: `Catacomb landing (${e.id})`, points: quad(1, e.t0, 1), y: e.top, ceilingHeight: 2.8, surfaceKind: 'stone'});
        const ramp = (ta, tb) => {const a = e.toLocal(ta, 0), b = e.toLocal(tb, 0), wa = toWorld(a.x, a.s), wb = toWorld(b.x, b.s), L = Math.hypot(wb.x - wa.x, wb.z - wa.z), ya = e.floorT(ta), yb = e.floorT(tb), g = (yb - ya) / L;
          return {name: `Catacomb stair (${e.id})`, points: quad(ta, tb, 1), y: ya, slope: {x: (wb.x - wa.x) / L * g, z: (wb.z - wa.z) / L * g, origin: wa}, ceilingHeight: 2.3, surfaceKind: 'stone'};};
        if (e.landing) {list.push(ramp(e.t0, e.tMid));list.push({name: `Catacomb half landing (${e.id})`, points: quad(e.tMid, e.tMid + e.landing, 1), y: e.floorT(e.tMid), ceilingHeight: 2.4, surfaceKind: 'stone'});list.push(ramp(e.tMid + e.landing, e.tBottom));}
        else list.push(ramp(e.t0, e.tBottom));
      }
      return list;
    }
    // Inside a mausoleum the terrain is not walked on (the door threshold, landing and stair take over).
    const cutsGround = (x, s) => entrances.some(e => x > e.rect[0] && x < e.rect[2] && s > e.rect[1] && s < e.rect[3]);
    // Underground: on the catacomb floor, or on a stair below its door. depth() is 0 at the door and 1 from 4.5 m down.
    function depth(x, s, y) {
      const c = cellOf(x, s);if (!c || !walkable(c.idx)) return 0;
      const k = stairOf[c.idx];if (k >= 0) return Math.max(0, Math.min(1, (entrances[k].top - .3 - y) / 4.2));
      return y < FLOOR_Y + 4 ? 1 : 0;
    }
    const inside = (x, s, y) => {const c = cellOf(x, s);return !!c && walkable(c.idx) && (stairOf[c.idx] < 0 ? y < FLOOR_Y + 4 : y < entrances[stairOf[c.idx]].top - 1.2);};
    const deep = (x, s, y) => {const c = cellOf(x, s);return !!c && walkable(c.idx) && stairOf[c.idx] < 0 && y < FLOOR_Y + 4;};
    return {CELL, X0, S0, NX, NS, FLOOR_Y, STYLES, S, DARK, ROCK, CORRIDOR, ROOM, STAIR, kind, style, roomOf, stairOf, vault, cover, rooms, entrances, torches, paths, runs,
      id, centre, cellOf, walkable, open, floorAt, ceilAt, los, obstacles, vehicleObstacles, floors, cutsGround, depth, inside, deep,
      isDark: c => DARK.has(style[c])};
  }

  // What you have seen down there (the map shows only this). Saved in localStorage by the caller as a base64 bit set.
  function explorer(L, saved) {
    const n = L.NX * L.NS, seen = new Uint8Array(n);
    if (saved) {try {const bin = typeof atob === 'function' ? atob(saved) : Buffer.from(saved, 'base64').toString('binary');for (let i = 0; i < n; i++) seen[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;} catch {}}
    let count = seen.reduce((a, b) => a + b, 0);
    function reveal(x, s, radius) {
      const c = L.cellOf(x, s);if (!c) return 0;let added = 0;const r = Math.ceil(radius / L.CELL);
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = c.i + di, j = c.j + dj;if (i < 0 || j < 0 || i >= L.NX || j >= L.NS) continue;
        const idx = L.id(i, j);if (seen[idx] || !L.walkable(idx)) continue;
        const p = L.centre(i, j);if (Math.hypot(p.x - x, p.s - s) > radius) continue;
        // Seen when the line from you to any point near the cell centre is clear.
        if (L.los(x, s, p.x, p.s) || L.los(x, s, p.x - .7, p.s - .7) || L.los(x, s, p.x + .7, p.s + .7) || L.los(x, s, p.x - .7, p.s + .7) || L.los(x, s, p.x + .7, p.s - .7)) {seen[idx] = 1;added++;}
      }
      count += added;return added;
    }
    function save() {const bytes = new Uint8Array(Math.ceil(n / 8));for (let i = 0; i < n; i++) if (seen[i]) bytes[i >> 3] |= 1 << (i & 7);let bin = '';for (const b of bytes) bin += String.fromCharCode(b);return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');}
    return {seen, reveal, save, get count() {return count;}};
  }

  // Terrain sampler for Node tests and tools: the same bilinear 4 m grid as Surroundings (relative decimetres + ground).
  function terrainSampler(D) {
    const ter = D.terrain, N = ter.n, half = ter.half, step = ter.step;
    const bin = typeof atob === 'function' ? atob(ter.dm) : Buffer.from(ter.dm, 'base64').toString('binary'), bytes = new Uint8Array(bin.length);for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const raw = new Int16Array(bytes.buffer), g = new Float32Array(raw.length);for (let i = 0; i < raw.length; i++) g[i] = raw[i] / 10;
    return (x, s) => {const fi = Math.min(N - 1.001, Math.max(0, (x + half) / step)), fj = Math.min(N - 1.001, Math.max(0, (s + half) / step)), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      return D.ground + g[j * N + i] * (1 - u) * (1 - v) + g[j * N + i + 1] * u * (1 - v) + g[(j + 1) * N + i] * (1 - u) * v + g[(j + 1) * N + i + 1] * u * v;};
  }
  return {build, explorer, terrainSampler, holes, ENTRANCES, ROOMS, LINKS, FLOOR_Y, CELL, X0, S0, NX, NS};
});
