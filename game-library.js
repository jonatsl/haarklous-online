/* Deichman Grünerløkka at Schous plass (issues #44 and #47): the 1914 library hall at its real place (OSM way 129296266),
 * white plaster with small-paned windows, a steep black tiled hip roof and the entrance gable with steps toward the park.
 * Inside: wall shelves and rows of shelves with thousands of plain books, reading tables, the comics corner (Serieteket) and
 * the librarian's desk. Two books are real: "The Inner Game of Tennis" (W. Timothy Gallwey, 1974) on the sports shelf, the
 * only book there with a printed spine (□ takes it out and shows the cover), and Moby-Dick (Herman Melville, 1851) on the
 * reading table (□ opens it at the first page: "Call me Ishmael.").
 * The librarian (issue #47): glasses, curly hair, a scarf. Run in the library, or talk loudly on voice chat in it, and she
 * comes at you and shushes you, then walks back to her desk.
 * Pure (Node-tested): GameLibrary.grid(rect, blocks, cell), GameLibrary.path(grid, from, to), new GameLibrary.Librarian(opts),
 *   GameLibrary.MOBY (the opening of chapter 1, public domain).
 * Browser: GameLibrary.prepare(districts) drops the OSM building (this module draws it);
 *   GameLibrary.create({T, lib, world, audio, root, data}) -> {group, obstacles, floors, hitboxes, inside(x, z, feet), prompt(look),
 *     update(dt, people, camera) -> events, reading, readInput(input), poi(), librarian}
 * Local frame: metres east (x) and south (s) of Haarklous plass 17A; the building is axis-aligned in it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameLibrary = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const OSM_ID = 'w129296266';
  // The OSM outline (way 129296266) in local metres: the hall, the bay on the north side and the entrance gable on the south.
  const RING = [[-911.9, 1737.7], [-899.2, 1737.9], [-899.0, 1734.1], [-896.6, 1734.3], [-896.3, 1727.5], [-898.8, 1727.4], [-898.7, 1723.2], [-910.1, 1723.0], [-910.7, 1722.8], [-912.1, 1722.0], [-913.9, 1721.5], [-917.1, 1721.2], [-918.4, 1721.5], [-919.8, 1722.0], [-921.6, 1723.1], [-932.9, 1722.7], [-933.0, 1726.6], [-934.2, 1726.6], [-934.3, 1733.4], [-933.1, 1733.4], [-933.1, 1737.3], [-920.5, 1737.5], [-920.5, 1739.3], [-916.5, 1739.3], [-912.0, 1739.4], [-911.9, 1737.7]];
  // The hall used for the interior (inside the walls) and the gable porch.
  // (Inner wall faces: the walls are 0.45 m thick inside the OSM outline.)
  const HALL = {x0: -932.5, x1: -899.75, s0: 1723.7, s1: 1736.8}, PORCH = {x0: -920.0, x1: -912.4, s0: 1736.8, s1: 1738.9};
  const DOOR = {x: -916.25, w: 1.9, h: 2.7};
  const MOBY = {
    title: 'MOBY-DICK; or, THE WHALE', author: 'Herman Melville', year: 1851, chapter: 'CHAPTER 1. Loomings.',
    text: ['Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.',
      'Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; and especially whenever my hypos get such an upper hand of me, that it requires a strong moral principle to prevent me from deliberately stepping into the street, and methodically knocking people’s hats off—then, I account it high time to get to sea as soon as I can. This is my substitute for pistol and ball. With a philosophical flourish Cato throws himself upon his sword; I quietly take to the ship. There is nothing surprising in this. If they but knew it, almost all men in their degree, some time or other, cherish very nearly the same feelings towards the ocean with me.']
  };
  const INNER = {title: 'The Inner Game of Tennis', author: 'W. Timothy Gallwey', year: 1974,
    blurb: 'Every game has two parts: the outer game against the opponent across the net, and the inner game in your own head. Gallwey’s classic shows how the critical voice (“Self 1”) gets in the way of the body that already knows how to play (“Self 2”) – and how to quiet it, on the court and off it.'};

  // ---------- Walking grid and paths (pure) ----------
  // grid({x0, x1, s0, s1}, blocks [{x0, x1, s0, s1}], cell) -> {cols, rows, free(i, j), …}; blocks are grown by `pad`.
  function grid(rect, blocks, cell = .5, pad = .35) {
    const cols = Math.ceil((rect.x1 - rect.x0) / cell), rows = Math.ceil((rect.s1 - rect.s0) / cell), open = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = rect.x0 + (i + .5) * cell, s = rect.s0 + (j + .5) * cell;
      open[j * cols + i] = blocks.some(b => x > b.x0 - pad && x < b.x1 + pad && s > b.s0 - pad && s < b.s1 + pad) ? 0 : 1;
    }
    const cellOf = (x, s) => [Math.max(0, Math.min(cols - 1, Math.floor((x - rect.x0) / cell))), Math.max(0, Math.min(rows - 1, Math.floor((s - rect.s0) / cell)))];
    const centre = (i, j) => [rect.x0 + (i + .5) * cell, rect.s0 + (j + .5) * cell];
    return {rect, cell, cols, rows, open, free: (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && open[j * cols + i] === 1, cellOf, centre};
  }
  // Breadth-first search over the 8-neighbour grid, then straightened (a corner is dropped when the line past it is free).
  function path(g, from, to) {
    const [fi, fj] = nearestFree(g, ...g.cellOf(from[0], from[1])), [ti, tj] = nearestFree(g, ...g.cellOf(to[0], to[1]));
    const N = g.cols * g.rows, prev = new Int32Array(N).fill(-1), start = fj * g.cols + fi, goal = tj * g.cols + ti;
    const q = [start];prev[start] = start;
    for (let h = 0; h < q.length && prev[goal] < 0; h++) {
      const c = q[h], i = c % g.cols, j = (c - i) / g.cols;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj, n = nj * g.cols + ni;
        if (!g.free(ni, nj) || prev[n] >= 0) continue;
        if (di && dj && (!g.free(i + di, j) || !g.free(i, j + dj))) continue;// no corner cutting
        prev[n] = c;q.push(n);
      }
    }
    if (prev[goal] < 0) return null;
    const cells = [];for (let c = goal; c !== start; c = prev[c]) cells.push(c);cells.push(start);cells.reverse();
    const pts = cells.map(c => g.centre(c % g.cols, Math.floor(c / g.cols)));pts[pts.length - 1] = [to[0], to[1]];
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) if (k === pts.length - 1 || !clearLine(g, out[out.length - 1], pts[k + 1])) out.push(pts[k]);
    return out;
  }
  function nearestFree(g, i, j) {
    if (g.free(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && g.free(i + di, j + dj)) return [i + di, j + dj];
    return [i, j];
  }
  function clearLine(g, a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(d / (g.cell * .4));
    for (let k = 1; k < n; k++) {const x = a[0] + (b[0] - a[0]) * k / n, s = a[1] + (b[1] - a[1]) * k / n, [i, j] = g.cellOf(x, s);if (!g.free(i, j)) return false;}
    return true;
  }

  // ---------- The librarian's mind (pure) ----------
  // people: [{id, x, s, inside, running, loud}] (local metres). Returns events [{kind: 'alert' | 'shush' | 'back', id, why}].
  class Librarian {
    constructor({grid: g, desk, speeds = {}}) {
      this.g = g;this.desk = desk.slice();this.x = desk[0];this.s = desk[1];this.state = 'desk';this.target = null;this.why = null;this.route = null;this.replan = 0;this.timer = 0;this.cool = 0;this.heading = 0;this.speed = 0;
      this.speeds = {chase: 4.3, brisk: 2.2, walk: 1.25, ...speeds};
    }
    step(dt, people) {
      const ev = [], me = p => people.find(q => q.id === p);
      this.cool = Math.max(0, this.cool - dt);
      const offender = () => people.filter(p => p.inside && (p.running || p.loud)).sort((a, b) => Math.hypot(a.x - this.x, a.s - this.s) - Math.hypot(b.x - this.x, b.s - this.s))[0];
      if ((this.state === 'desk' || this.state === 'return') && this.cool <= 0) {
        const o = offender();
        if (o) {this.state = 'chase';this.target = o.id;this.why = o.running ? 'run' : 'loud';this.route = null;this.replan = 0;ev.push({kind: 'alert', id: o.id, why: this.why});}
      }
      if (this.state === 'chase') {
        const t = me(this.target);
        if (!t || !t.inside) {this.state = 'return';this.route = null;ev.push({kind: 'gone', id: this.target});}
        else {
          if (t.running) this.why = 'run';
          const d = Math.hypot(t.x - this.x, t.s - this.s);
          if (d < 1.15) {this.state = 'shush';this.timer = 2.4;this.speed = 0;this.heading = Math.atan2(t.x - this.x, t.s - this.s);ev.push({kind: 'shush', id: t.id, why: this.why});}
          else {
            this.replan -= dt;if (!this.route || this.replan <= 0) {this.route = path(this.g, [this.x, this.s], [t.x, t.s]);this.replan = .35;}
            this.walk(dt, this.why === 'run' ? this.speeds.chase : this.speeds.brisk, 1.0);
          }
        }
      } else if (this.state === 'shush') {
        const t = me(this.target);if (t) this.heading = Math.atan2(t.x - this.x, t.s - this.s);
        if ((this.timer -= dt) <= 0) {this.state = 'return';this.route = null;this.cool = 1.5;}
      } else if (this.state === 'return') {
        if (!this.route) this.route = path(this.g, [this.x, this.s], this.desk);
        if (this.walk(dt, this.speeds.walk, .15)) {this.state = 'desk';this.route = null;this.speed = 0;this.heading = Math.PI;ev.push({kind: 'back'});}
      } else this.speed = 0;
      return ev;
    }
    // Follow the route; true when within `stop` metres of its end.
    walk(dt, v, stop) {
      if (!this.route || !this.route.length) return true;
      let left = v * dt;
      while (left > 0 && this.route.length) {
        const [x, s] = this.route[0], d = Math.hypot(x - this.x, s - this.s), end = this.route.length === 1;
        if (end && d <= stop) {this.route = [];break;}
        if (d <= left) {this.x = x;this.s = s;left -= d;this.route.shift();continue;}
        this.heading = Math.atan2(x - this.x, s - this.s);this.x += (x - this.x) / d * left;this.s += (s - this.s) / d * left;left = 0;
      }
      this.speed = v;
      return !this.route.length;
    }
  }

  // ---------- Before the world is built: this module draws the building ----------
  // Clear spots: no map tree grows through the library (or on the table-tennis pad at Schous plass).
  const CLEAR = [{x0: -936, x1: -894, s0: 1719, s1: 1744}, {x0: -906, x1: -897, s0: 1768, s1: 1775}];
  function prepare(districts) {
    let n = 0;
    for (const d of districts || []) {
      if (d && Array.isArray(d.buildings)) {const before = d.buildings.length;d.buildings = d.buildings.filter(b => b.id !== OSM_ID);n += before - d.buildings.length;}
      if (d && Array.isArray(d.trees)) d.trees = d.trees.filter(t => !CLEAR.some(c => t.x > c.x0 && t.x < c.x1 && t.s > c.s0 && t.s < c.s1));
    }
    return n;
  }

  // ---------- Browser ----------
  function create({T, lib, world, audio, root}) {
    const group = new T.Group();group.name = 'Deichman Grünerløkka';
    const D = window.SURROUNDINGS, local = new T.Group();local.rotation.y = D.geo.theta;local.position.set(D.geo.x, 0, D.geo.z);group.add(local);
    const W = (x, s) => world.toWorld(x, s), groundL = (x, s) => {const w = W(x, s);return world.heightWorld(w.x, w.z);};
    // Floor: 0.75 m above the highest ground round the hall (the photo shows five steps up to the door).
    const plaza = groundL(DOOR.x, PORCH.s1 + 3.2), FY = Math.max(...RING.map(([x, s]) => groundL(x, s)), plaza) + .75;
    const WALL = 6.6, CEIL = 5.6, RIDGE = 5.2;// eaves above the floor; the ceiling inside; roof rise
    const plasterOut = lib.plaster(0xece8df), plasterIn = lib.plaster(0xf4efe4), plinthM = lib.plaster(0x5d5852), trimM = lib.paint(0xf7f5ef, .5);
    const roofM = new T.MeshStandardMaterial({color: 0x17181a, roughness: .62, metalness: .1, envMapIntensity: .25});// black glazed tiles
    const floorM = lib.woodFloor(), shelfM = lib.wood(0x7a5634, .6), deskM = lib.wood(0x4f3a28, .5), glassM = new T.MeshStandardMaterial({color: 0x1c2730, roughness: .08, metalness: .3, envMapIntensity: 1.2});
    const skyGlass = new T.MeshBasicMaterial({color: 0xdbe8f2});
    const statics = new T.Group();local.add(statics);
    const box = (w, h, d, mat, x, y, s, parent = statics) => {const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);m.position.set(x, y, s);m.castShadow = m.receiveShadow = true;parent.add(m);return m;};
    const obstacles = [], floors = [];
    const rectObs = (x0, x1, s0, s1, minY, maxY) => obstacles.push({points: [[x0, s0], [x1, s0], [x1, s1], [x0, s1]].map(([x, s]) => W(x, s)), minY, maxY, kind: 'library'});

    // Walls from the OSM outline (0.45 m thick, inward), with the door gap in the porch's south wall.
    const ring = RING.slice(0, -1), area = ring.reduce((a, p, i) => {const q = ring[(i + 1) % ring.length];return a + p[0] * q[1] - q[0] * p[1];}, 0);
    const inward = area > 0 ? 1 : -1;
    const winPanes = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], ds = b[1] - a[1], L = Math.hypot(dx, ds);if (L < .3) continue;
      const ux = dx / L, us = ds / L, nx = -us * inward, ns = ux * inward;// unit normal pointing into the building
      const pieces = [];
      const porchFront = Math.abs(a[1] - 1739.35) < .2 && Math.abs(b[1] - 1739.35) < .2;
      const mx0 = (a[0] + b[0]) / 2, ms0 = (a[1] + b[1]) / 2, porchWall = mx0 > PORCH.x0 - .7 && mx0 < PORCH.x1 + .7 && ms0 > HALL.s1 - .1;
      if (porchFront) {// the door gap (it may span two segments of the outline)
        const t0 = ((DOOR.x - DOOR.w / 2) - a[0]) / dx * L, t1 = ((DOOR.x + DOOR.w / 2) - a[0]) / dx * L, lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
        if (hi > lo) {
          pieces.push([0, lo], [hi, L]);
          const mx = a[0] + ux * (lo + hi) / 2, ms = a[1] + us * (lo + hi) / 2;
          const lin = box(hi - lo, WALL + 2.4 - DOOR.h, .45, plasterOut, mx + nx * .225, FY + DOOR.h + (WALL + 2.4 - DOOR.h) / 2, ms + ns * .225);lin.rotation.y = Math.atan2(-us, ux);
        } else pieces.push([0, L]);
      } else pieces.push([0, L]);
      const top = porchWall ? WALL + 2.4 : WALL;
      for (const [t0, t1] of pieces.filter(([u, v]) => v - u > .05)) {
        const len = t1 - t0, cx = a[0] + ux * (t0 + t1) / 2 + nx * .225, cs = a[1] + us * (t0 + t1) / 2 + ns * .225, yaw = Math.atan2(-us, ux);
        const base = Math.min(groundL(a[0], a[1]), groundL(b[0], b[1])) - .4;
        const wall = box(len, top + FY - base, .45, plasterOut, cx, (base + FY + top) / 2, cs);wall.rotation.y = yaw;
        const plinth = box(len + .02, FY + .45 - base, .5, plinthM, cx - nx * .03, (base + FY + .45) / 2, cs - ns * .03);plinth.rotation.y = yaw;
        // Inside face (lighter plaster) up to the ceiling.
        const inner = box(len, CEIL, .02, plasterIn, cx + nx * .235, FY + CEIL / 2, cs + ns * .235);inner.rotation.y = yaw;inner.castShadow = false;
        // Windows on the long walls: big small-paned windows with a sill 1.9 m up (the shelves run under them).
        if (len > 4 && !porchFront) {
          const n = Math.floor(len / 2.6);
          for (let k = 0; k < n; k++) {
            const t = t0 + (k + .5) * len / n, px = a[0] + ux * t, ps = a[1] + us * t;
            for (const [off, mat] of [[-.005, glassM], [.49, skyGlass]]) {
              const pane = new T.Mesh(new T.PlaneGeometry(1.5, 2.7), mat);pane.position.set(px + nx * off - nx * .01, FY + 1.95 + 1.35, ps + ns * off - ns * .01);pane.rotation.y = Math.atan2(-nx, -ns) + (off > 0 ? Math.PI : 0);statics.add(pane);winPanes.push(pane);
            }
            // Mullions and transoms (outside).
            for (const [w, h, dy, dl] of [[.08, 2.7, 1.35, 0], [1.5, .08, 2.0, 0], [1.6, .1, 0, 0], [1.6, .1, 2.7, 0]]) {const m = box(w, h, .06, trimM, px - nx * .04 + ux * dl, FY + 1.95 + dy, ps - ns * .04);m.rotation.y = yaw;m.castShadow = false;}
          }
        }
      }
      // Wall obstacles (the door gap stays open).
      for (const [t0, t1] of pieces.filter(([u, v]) => v - u > .05)) {
        const p0 = [a[0] + ux * t0, a[1] + us * t0], p1 = [a[0] + ux * t1, a[1] + us * t1];
        obstacles.push({points: [p0, p1, [p1[0] + nx * .45, p1[1] + ns * .45], [p0[0] + nx * .45, p0[1] + ns * .45]].map(([x, s]) => W(x, s)), minY: FY - 3, maxY: FY + WALL + 3, kind: 'library'});
      }
    }
    // Roof: a steep hip over the hall and a gable over the porch (both black glazed tiles).
    {
      const r = {x0: HALL.x0 - .9, x1: HALL.x1 + .9, s0: HALL.s0 - .9, s1: HALL.s1 + .9}, y0 = FY + WALL, cs = (r.s0 + r.s1) / 2, inset = (r.s1 - r.s0) / 2;
      const v = [[r.x0, y0, r.s0], [r.x1, y0, r.s0], [r.x1, y0, r.s1], [r.x0, y0, r.s1], [r.x0 + inset, y0 + RIDGE, cs], [r.x1 - inset, y0 + RIDGE, cs]];
      const tri = [[0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [3, 5, 4], [3, 4, 0]].flat(), pos = [];
      for (const i of tri) pos.push(...v[i]);
      const geo = new T.BufferGeometry();geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));geo.computeVertexNormals();
      const roof = new T.Mesh(geo, roofM);roof.castShadow = roof.receiveShadow = true;statics.add(roof);
      const fascia = box(r.x1 - r.x0, .25, r.s1 - r.s0, trimM, (r.x0 + r.x1) / 2, y0 - .12, cs);fascia.castShadow = false;
      // Porch gable: walls up to WALL + 2.4, a ridge along s.
      const g = {x0: PORCH.x0 - .35, x1: PORCH.x1 + .35, s0: HALL.s1 - 1, s1: PORCH.s1 + .6}, gy = FY + WALL + 2.4, gx = (g.x0 + g.x1) / 2;
      const gv = [[g.x0, gy, g.s0], [g.x1, gy, g.s0], [g.x1, gy, g.s1], [g.x0, gy, g.s1], [gx, gy + 3.4, g.s0], [gx, gy + 3.4, g.s1]];
      const gp = [];for (const i of [0, 4, 5, 0, 5, 3, 1, 2, 5, 1, 5, 4]) gp.push(...gv[i]);
      const gg = new T.BufferGeometry();gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3));gg.computeVertexNormals();
      const gr = new T.Mesh(gg, roofM);gr.material = roofM.clone();gr.material.side = T.DoubleSide;gr.castShadow = true;statics.add(gr);
      // The gable's front triangle with an arched window and the ornament over the door.
      const fp = [g.x0 + .35, gy, PORCH.s1 + .45, g.x1 - .35, gy, PORCH.s1 + .45, gx, gy + 3.1, PORCH.s1 + .45], fg = new T.BufferGeometry();fg.setAttribute('position', new T.Float32BufferAttribute(fp, 3));fg.computeVertexNormals();
      const front = new T.Mesh(fg, plasterOut.clone());front.material.side = T.DoubleSide;statics.add(front);
      const arch = new T.Mesh(new T.CircleGeometry(.75, 20, 0, Math.PI), glassM);arch.position.set(gx, FY + DOOR.h + 2.6, PORCH.s1 + .47);statics.add(arch);
      const archLow = new T.Mesh(new T.PlaneGeometry(1.5, 1.6), glassM);archLow.position.set(gx, FY + DOOR.h + 1.8, PORCH.s1 + .47);statics.add(archLow);
      box(1.1, .5, .12, trimM, gx, FY + DOOR.h + .45, PORCH.s1 + .5);
    }
    // Ceiling, floor and the steps up to the door (a ramp floor for walking, steps to look at).
    box(HALL.x1 - HALL.x0, .1, HALL.s1 - HALL.s0, plasterIn, (HALL.x0 + HALL.x1) / 2, FY + CEIL + .05, (HALL.s0 + HALL.s1) / 2).castShadow = false;
    const flGeo = new T.PlaneGeometry(HALL.x1 - HALL.x0, PORCH.s1 - HALL.s0), uvs = flGeo.attributes.uv;for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (HALL.x1 - HALL.x0) / 2.4, uvs.getY(i) * (PORCH.s1 - HALL.s0) / 2.4);
    const fl = new T.Mesh(flGeo, floorM);fl.rotation.x = -Math.PI / 2;fl.position.set((HALL.x0 + HALL.x1) / 2, FY + .005, (HALL.s0 + PORCH.s1) / 2);fl.receiveShadow = true;statics.add(fl);
    floors.push({name: 'Library hall', points: ring.map(([x, s]) => W(x, s)), y: FY, ceilingHeight: CEIL});
    const stepTop = PORCH.s1 + .45, steps = 5, run = .38, stepM = lib.concrete(0xa9a59c), rise = (FY - plaza) / steps;
    for (let k = 0; k < steps; k++) box(DOOR.w + 2.6 + (steps - k) * .5, rise * (k + 1) + .3, run, stepM, DOOR.x, plaza + rise * (k + 1) / 2 - .15, stepTop + run * (steps - k - .5));
    {
      const a = W(DOOR.x - 1.6, stepTop + run * steps), b = W(DOOR.x + 1.6, stepTop + run * steps), c = W(DOOR.x + 1.6, stepTop), d = W(DOOR.x - 1.6, stepTop);
      const o = W(DOOR.x, stepTop + run * steps), f = W(DOOR.x, stepTop), gL = Math.hypot(f.x - o.x, f.z - o.z), k = (FY - plaza) / (run * steps);
      floors.push({name: 'Library steps', points: [a, b, c, d], y: plaza, slope: {x: (f.x - o.x) / gL * k, z: (f.z - o.z) / gL * k, origin: o}, ceilingHeight: 4});
      floors.push({name: 'Library door', points: [W(DOOR.x - 1.2, stepTop + .05), W(DOOR.x + 1.2, stepTop + .05), W(DOOR.x + 1.2, PORCH.s0 - .5), W(DOOR.x - 1.2, PORCH.s0 - .5)], y: FY, ceilingHeight: DOOR.h});
    }
    // Open double doors (dark green, glazed).
    for (const sgn of [-1, 1]) {const leaf = box(DOOR.w / 2, DOOR.h - .1, .06, lib.paint(0x23392e, .5), DOOR.x + sgn * (DOOR.w / 2 + .05), FY + DOOR.h / 2, PORCH.s1 - .2 - DOOR.w / 4);leaf.rotation.y = sgn * Math.PI / 2;}

    // ---------- Interior: shelves, books, desk, tables ----------
    const blocks = [];
    const bookBoxes = [];// [x, y, s, w, h, d, yaw, colour]
    const COLORS = [0x7d2a24, 0x2c4a6e, 0x2f5a3a, 0xc9a227, 0x5a3b6b, 0x8c4b22, 0x1f2a33, 0xa63d40, 0x3d6f73, 0xb9ab8c, 0x6b6f2a, 0x9a5b8a, 0x243b2b, 0x4c4c4c, 0x9c6b3a, 0x34495e];
    let seed = 4411;const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const special = {};
    // A shelf unit along a line (from (x, s), direction u, length L), facing n; rows of books on each board.
    function shelf(x, s, ux, us, L, nx, ns, H, boards, opts = {}) {
      const yaw = Math.atan2(-us, ux), cx = x + ux * L / 2 + nx * .17, cs = s + us * L / 2 + ns * .17;
      const back = box(L, H, .04, shelfM, cx - nx * .15, FY + H / 2, cs - ns * .15);back.rotation.y = yaw;back.castShadow = false;
      for (const e of [0, L]) {const side = box(.04, H, .34, shelfM, x + ux * e + nx * .17, FY + H / 2, s + us * e + ns * .17);side.rotation.y = yaw;side.castShadow = false;}
      for (let b = 0; b <= boards; b++) {const y = .08 + b * (H - .1) / boards, bd = box(L, .025, .32, shelfM, cx, FY + y, cs);bd.rotation.y = yaw;bd.castShadow = false;
        if (b === boards) break;
        let t = .03;
        while (t < L - .05) {
          const w = .018 + rnd() * .045, h = Math.min((H - .1) / boards - .06, .17 + rnd() * .14), dd = .14 + rnd() * .09;
          if (t + w > L - .03) break;
          if (opts.special && b === opts.special.board && t >= opts.special.t && !special[opts.special.key]) {special[opts.special.key] = {x: x + ux * (t + .02) + nx * (.06 + .11), y: FY + y + .0125, s: s + us * (t + .02) + ns * (.06 + .11), yaw, ux, us, nx, ns};t += .05;continue;}
          const lean = rnd() < .04 ? .25 : 0;
          bookBoxes.push([x + ux * (t + w / 2) + nx * (.04 + dd / 2), FY + y + .0125 + h / 2, s + us * (t + w / 2) + ns * (.04 + dd / 2), w, h, dd, yaw, COLORS[Math.floor(rnd() * COLORS.length)], lean]);
          t += w + (rnd() < .06 ? .05 + rnd() * .1 : .002);
        }
      }
      const x0 = Math.min(x, x + ux * L, x + nx * .34), x1 = Math.max(x, x + ux * L, x + nx * .34), s0 = Math.min(s, s + us * L, s + ns * .34), s1 = Math.max(s, s + us * L, s + ns * .34);
      blocks.push({x0, x1, s0, s1});rectObs(x0, x1, s0, s1, FY - .1, FY + H + .1);
    }
    // Wall shelves (1.7 m, under the windows) along the north and south walls, east and west ends.
    const wallH = 1.7;
    shelf(HALL.x0 + .3, HALL.s0 + .05, 1, 0, -921.6 - HALL.x0 - .6, 0, 1, wallH, 5);
    shelf(-910.1 + .3, HALL.s0 + .05, 1, 0, HALL.x1 - (-910.1) - .6, 0, 1, wallH, 5);
    shelf(HALL.x0 + .3, HALL.s1 - .05, 1, 0, PORCH.x0 - HALL.x0 - 1.0, 0, -1, wallH, 5, {special: {key: 'inner', board: 2, t: 3.31}});
    shelf(PORCH.x1 + .7, HALL.s1 - .05, 1, 0, HALL.x1 - PORCH.x1 - 1.0, 0, -1, wallH, 5);
    shelf(HALL.x0 + .05, HALL.s0 + 3.5, 0, 1, 7, 1, 0, 2.2, 6);
    shelf(HALL.x1 - .05, HALL.s0 + 3.5, 0, 1, 7, -1, 0, 2.2, 6);
    // Free-standing double rows in the west and east thirds (aisles 1.4 m), perpendicular to the long walls.
    for (const x of [-930.0, -927.8, -925.6, -905.0, -902.8]) for (const face of [1, -1]) shelf(x, HALL.s0 + 3.2, 0, 1, 6.2, face, 0, 1.8, 5);// back to back
    // Book instances: one draw call for all the plain books (no text on them).
    {
      const geo = new T.BoxGeometry(1, 1, 1), c = document.createElement('canvas');c.width = 16;c.height = 64;const x = c.getContext('2d');
      x.fillStyle = '#fff';x.fillRect(0, 0, 16, 64);x.fillStyle = 'rgba(0,0,0,.18)';x.fillRect(0, 6, 16, 3);x.fillRect(0, 55, 16, 3);x.fillStyle = 'rgba(255,255,255,.25)';x.fillRect(0, 12, 16, 2);
      const tex = new T.CanvasTexture(c);tex.colorSpace = T.SRGBColorSpace;
      const mat = new T.MeshStandardMaterial({map: tex, roughness: .8});
      const inst = new T.InstancedMesh(geo, mat, bookBoxes.length), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), col = new T.Color();
      bookBoxes.forEach(([bx, by, bs, w, h, d, yaw, color, lean], i) => {e.set(0, yaw, lean, 'YXZ');q.setFromEuler(e);m.compose(new T.Vector3(bx, by - (lean ? h * .05 : 0), bs), q, new T.Vector3(w, h, d));inst.setMatrixAt(i, m);inst.setColorAt(i, col.setHex(color).multiplyScalar(.8 + rnd() * .4));});
      inst.receiveShadow = true;local.add(inst);
    }
    // Section signs.
    const label = (text, x, y, s, yaw, w = 1.4, bg = '#2b3a4a') => {
      const c = document.createElement('canvas');c.width = 512;c.height = 128;const g = c.getContext('2d');g.fillStyle = bg;g.fillRect(0, 0, 512, 128);g.fillStyle = '#fff';g.font = 'bold 64px Segoe UI, Arial, sans-serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText(text, 256, 68);
      const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;const m = new T.Mesh(new T.PlaneGeometry(w, w / 4), new T.MeshStandardMaterial({map: t, roughness: .7}));m.position.set(x, y, s);m.rotation.y = yaw;statics.add(m);return m;
    };
    label('SPORT', HALL.x0 + 3.6, FY + wallH + .25, HALL.s1 - .4, Math.PI);
    label('ROMANER', HALL.x0 + .1, FY + 2.5, HALL.s0 + 7, Math.PI / 2);
    label('FAKTA', HALL.x1 - .1, FY + 2.5, HALL.s0 + 7, -Math.PI / 2);
    label('SERIETEKET', -905.5, FY + wallH + .25, HALL.s0 + .4, 0, 2.2, '#b8322a');
    label('DEICHMAN GRÜNERLØKKA', DOOR.x, FY + 3.3, PORCH.s1 + .53, 0, 2.6, '#1d1f22');
    // The librarian's desk (to the east of the door inside), reading tables with chairs, a lamp on each.
    const DESK = {x0: -910.6, x1: -907.4, s0: 1733.2, s1: 1734.1};
    box(DESK.x1 - DESK.x0, 1.05, DESK.s1 - DESK.s0, deskM, (DESK.x0 + DESK.x1) / 2, FY + .525, (DESK.s0 + DESK.s1) / 2);
    box(.5, .35, .05, lib.paint(0x111317, .3), DESK.x0 + .8, FY + 1.25, DESK.s0 + .3);// screen
    blocks.push(DESK);rectObs(DESK.x0, DESK.x1, DESK.s0, DESK.s1, FY - .1, FY + 1.1);
    const tables = [{x: -918.5, s: 1728.6}, {x: -913.8, s: 1728.6}, {x: -916.2, s: 1731.9}];
    for (const tb of tables) {
      box(1.9, .05, .95, deskM, tb.x, FY + .75, tb.s);for (const [dx, ds] of [[-.85, -.4], [.85, -.4], [-.85, .4], [.85, .4]]) box(.05, .73, .05, deskM, tb.x + dx, FY + .365, tb.s + ds);
      for (const [dx, ds] of [[-.5, -.75], [.5, -.75], [-.5, .75], [.5, .75]]) {box(.42, .04, .42, deskM, tb.x + dx, FY + .45, tb.s + ds);box(.42, .5, .04, deskM, tb.x + dx, FY + .72, tb.s + ds + Math.sign(ds) * .2);}
      const lamp = new T.Mesh(new T.ConeGeometry(.16, .18, 16, 1, true), lib.paint(0x2d5a3d, .4));lamp.position.set(tb.x + .55, FY + 1.1, tb.s);statics.add(lamp);
      blocks.push({x0: tb.x - 1.2, x1: tb.x + 1.2, s0: tb.s - 1, s1: tb.s + 1});rectObs(tb.x - .98, tb.x + .98, tb.s - .5, tb.s + .5, FY - .1, FY + .8);
    }
    // Comics corner: low boxes of comics and two bean bags.
    for (const [x, s] of [[-907.5, 1725.6], [-904.6, 1725.6]]) {box(1.6, .55, .8, shelfM, x, FY + .275, s);blocks.push({x0: x - .8, x1: x + .8, s0: s - .4, s1: s + .4});rectObs(x - .8, x + .8, s - .4, s + .4, FY - .1, FY + .6);}
    for (const [x, s, c] of [[-906, 1727.6, 0xc0392b], [-903.8, 1727.9, 0xf0b323]]) {const bag = new T.Mesh(new T.SphereGeometry(.45, 16, 10), lib.fabric(c));bag.scale.set(1, .55, 1);bag.position.set(x, FY + .25, s);bag.castShadow = true;statics.add(bag);}
    lib.mergeStatic(statics, o => winPanes.includes(o));
    // Lights inside (one shadowless point light; off when far, so no shader recompiles).
    const lamp = new T.PointLight(0xfff1d6, 0, 26, 1.4);lamp.position.set(-916, FY + 4.8, 1730.3);local.add(lamp);
    const lamp2 = new T.PointLight(0xfff1d6, 0, 22, 1.4);lamp2.position.set(-904, FY + 4.6, 1730.3);local.add(lamp2);

    // ---------- The two real books ----------
    const hitboxes = [];
    function canvasTex(w, h, draw) {const c = document.createElement('canvas');c.width = w;c.height = h;draw(c.getContext('2d'), w, h);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;t.anisotropy = 4;return {t, c};}
    // The Inner Game of Tennis: a paperback on the sports shelf, the only printed spine in the library. The cover is drawn here
    // (a look-alike, not the publisher's artwork): title, author and a tennis ball.
    const innerCover = canvasTex(512, 800, (g, w, h) => {
      g.fillStyle = '#f3efe2';g.fillRect(0, 0, w, h);g.fillStyle = '#1f6f4a';g.fillRect(0, 0, w, 250);
      g.fillStyle = '#fff';g.textAlign = 'center';g.font = '600 34px Georgia, serif';g.fillText('THE', w / 2, 70);g.font = 'bold 74px Georgia, serif';g.fillText('INNER', w / 2, 145);g.font = '600 34px Georgia, serif';g.fillText('GAME OF TENNIS', w / 2, 205);
      const bx = w / 2, by = 470, r = 120;const grad = g.createRadialGradient(bx - 40, by - 50, 20, bx, by, r);grad.addColorStop(0, '#f6ff7a');grad.addColorStop(1, '#b7cc1f');g.fillStyle = grad;g.beginPath();g.arc(bx, by, r, 0, Math.PI * 2);g.fill();
      g.strokeStyle = '#fbfbf3';g.lineWidth = 9;g.beginPath();g.arc(bx - 175, by, 150, -.62, .62);g.stroke();g.beginPath();g.arc(bx + 175, by, 150, Math.PI - .62, Math.PI + .62);g.stroke();
      g.fillStyle = '#2a2a2a';g.font = 'italic 26px Georgia, serif';g.fillText('The classic guide to the mental side', w / 2, 650);g.fillText('of peak performance', w / 2, 684);
      g.fillStyle = '#1f6f4a';g.font = 'bold 38px Georgia, serif';g.fillText('W. TIMOTHY GALLWEY', w / 2, 755);
    });
    const innerSpine = canvasTex(64, 512, (g, w, h) => {g.fillStyle = '#1f6f4a';g.fillRect(0, 0, w, h);g.save();g.translate(w / 2, h / 2);g.rotate(Math.PI / 2);g.fillStyle = '#fff';g.font = 'bold 26px Georgia, serif';g.textAlign = 'center';g.textBaseline = 'middle';g.fillText('THE INNER GAME OF TENNIS', -20, 0);g.font = '20px Georgia, serif';g.fillStyle = '#f6ff7a';g.fillText('GALLWEY', 205, 0);g.restore();});
    const paper = new T.MeshStandardMaterial({color: 0xf4efdf, roughness: .9});
    let innerBook = null;
    if (special.inner) {
      const p = special.inner, bw = .028, bh = .215, bd = .14, mats = [paper, paper, paper, paper, new T.MeshStandardMaterial({map: innerSpine.t, roughness: .6}), new T.MeshStandardMaterial({map: innerCover.t, roughness: .6})];
      // BoxGeometry faces: +x, -x, +y, -y, +z (spine, toward the room), -z.
      // The spine goes on whichever ±z face looks into the room (local +z turns to (-us, ux)).
      const spineAt = -p.us * p.nx + p.ux * p.ns > 0 ? 4 : 5, faces = [new T.MeshStandardMaterial({map: innerCover.t, roughness: .6}), paper, paper, paper, paper, paper];faces[spineAt] = mats[4];
      innerBook = new T.Mesh(new T.BoxGeometry(bw, bh, bd), faces);
      innerBook.position.set(p.x + p.nx * .025, p.y + bh / 2, p.s + p.ns * .025);innerBook.rotation.y = p.yaw;local.add(innerBook);innerBook.castShadow = true;
      innerBook.userData.libraryBook = 'inner';hitboxes.push(innerBook);
    }
    // Moby-Dick: a green cloth hardcover with the gilt title and whale, lying on the middle reading table. Opening it in the
    // reading view also opens the cover on the table.
    const mobyCover = canvasTex(512, 720, (g, w, h) => {
      g.fillStyle = '#2e4a3a';g.fillRect(0, 0, w, h);for (let i = 0; i < 3000; i++) {g.fillStyle = `rgba(0,0,0,${Math.random() * .08})`;g.fillRect(Math.random() * w, Math.random() * h, 2, 2);}
      g.strokeStyle = '#c9a54a';g.lineWidth = 6;g.strokeRect(26, 26, w - 52, h - 52);g.lineWidth = 2;g.strokeRect(40, 40, w - 80, h - 80);
      g.fillStyle = '#d8b65a';g.textAlign = 'center';g.font = 'bold 70px Georgia, serif';g.fillText('MOBY-DICK', w / 2, 190);g.font = 'italic 30px Georgia, serif';g.fillText('or, The Whale', w / 2, 240);
      g.beginPath();g.ellipse(w / 2, 400, 120, 42, 0, 0, Math.PI * 2);g.fill();g.beginPath();g.moveTo(w / 2 + 110, 395);g.lineTo(w / 2 + 185, 345);g.lineTo(w / 2 + 170, 400);g.lineTo(w / 2 + 190, 445);g.closePath();g.fill();
      g.fillStyle = '#2e4a3a';g.beginPath();g.arc(w / 2 - 75, 392, 7, 0, Math.PI * 2);g.fill();
      g.fillStyle = '#d8b65a';g.font = '34px Georgia, serif';g.fillText('HERMAN MELVILLE', w / 2, 600);
    });
    const mobyClosed = new T.Group(), MOBY_AT = {x: tables[2].x - .3, s: tables[2].s - .05};
    mobyClosed.position.set(MOBY_AT.x, FY + .775, MOBY_AT.s);mobyClosed.rotation.y = .2;local.add(mobyClosed);
    const block = new T.Mesh(new T.BoxGeometry(.165, .045, .235), [paper, paper, paper, paper, paper, paper]);block.position.y = .025;block.castShadow = true;mobyClosed.add(block);
    const coverHinge = new T.Group();coverHinge.position.set(-.085, .05, 0);mobyClosed.add(coverHinge);
    const cover = new T.Mesh(new T.BoxGeometry(.172, .006, .245), [new T.MeshStandardMaterial({color: 0x2e4a3a}), new T.MeshStandardMaterial({color: 0x2e4a3a}), new T.MeshStandardMaterial({map: mobyCover.t, roughness: .75}), paper, new T.MeshStandardMaterial({color: 0x2e4a3a}), new T.MeshStandardMaterial({color: 0x2e4a3a})]);
    cover.position.x = .086;cover.castShadow = true;coverHinge.add(cover);
    const backCover = new T.Mesh(new T.BoxGeometry(.172, .006, .245), new T.MeshStandardMaterial({color: 0x2e4a3a, roughness: .75}));backCover.position.set(0, .002, 0);mobyClosed.add(backCover);
    const mobyHit = new T.Mesh(new T.BoxGeometry(.26, .12, .3), new T.MeshBasicMaterial({visible: false}));mobyHit.position.y = .05;mobyHit.userData.libraryBook = 'moby';mobyClosed.add(mobyHit);hitboxes.push(mobyHit);

    // ---------- Reading view (an overlay) ----------
    const css = document.createElement('style');css.textContent = `
#bookView{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,.62);z-index:30;font-family:Georgia,'Times New Roman',serif}
#bookView[hidden]{display:none}
#bookView .spread{display:flex;gap:0;box-shadow:0 18px 60px rgba(0,0,0,.6);max-width:min(1100px,94vw);max-height:86vh}
#bookView .page{background:#f4ecd8;color:#2a2620;width:min(46vw,500px);padding:42px 46px 30px;box-sizing:border-box;line-height:1.55;font-size:clamp(14px,1.45vw,18px);overflow:auto;background-image:linear-gradient(90deg,rgba(0,0,0,.08),rgba(0,0,0,0) 8%)}
#bookView .page.left{background-image:linear-gradient(270deg,rgba(0,0,0,.1),rgba(0,0,0,0) 8%);text-align:center;display:flex;flex-direction:column;justify-content:center}
#bookView h3{font-size:1.15em;letter-spacing:.08em;margin:0 0 1.1em;text-align:center;font-weight:normal}
#bookView p{margin:0 0 .9em;text-align:justify;hyphens:auto}
#bookView p.first::first-letter{float:left;font-size:3.3em;line-height:.85;padding:4px 6px 0 0}
#bookView .folio{font-size:.8em;color:#7a7060;text-align:center;margin-top:1em}
#bookView .cover{width:min(40vw,380px);aspect-ratio:512/800;box-shadow:0 10px 40px rgba(0,0,0,.6)}
#bookView .back{background:#f3efe2;color:#2a2620;width:min(40vw,380px);padding:34px;box-sizing:border-box;font-size:clamp(13px,1.3vw,16px);line-height:1.5}
#bookView small.help{position:absolute;bottom:4vh;left:0;right:0;text-align:center;color:#e9e4d6;font:600 14px Segoe UI,Arial,sans-serif}`;
    document.head.append(css);
    const view = document.createElement('div');view.id = 'bookView';view.hidden = true;(root || document.body).append(view);
    let reading = null;
    function openBook(which) {
      reading = {which, page: 0};render();if (audio && audio.sfx) audio.sfx('pageTurn');
      if (which === 'moby') coverHinge.rotation.z = Math.PI * .97;
      if (which === 'inner' && innerBook) innerBook.visible = false;
    }
    function closeBook() {
      if (!reading) return;if (reading.which === 'moby') coverHinge.rotation.z = 0;if (reading.which === 'inner' && innerBook) innerBook.visible = true;
      reading = null;view.hidden = true;view.replaceChildren();
    }
    function render() {
      view.hidden = !reading;if (!reading) return;
      if (reading.which === 'moby') {
        const pages = [
          `<div class="page left"><h3>MOBY-DICK;</h3><div>or,</div><h3>THE WHALE.</h3><div style="margin-top:1.6em">BY</div><h3 style="margin-top:.4em">HERMAN MELVILLE.</h3><div style="margin-top:2.5em;font-size:.85em">NEW YORK: HARPER &amp; BROTHERS, PUBLISHERS.<br>LONDON: RICHARD BENTLEY.<br>1851.</div></div>`,
          `<div class="page"><h3>${MOBY.chapter}</h3><p class="first">${MOBY.text[0]}</p><p>${MOBY.text[1]}</p><div class="folio">1</div></div>`];
        view.innerHTML = `<div class="spread">${pages.join('')}</div><small class="help">○ / □ / Esc close the book</small>`;
      } else {
        const img = innerCover.c.toDataURL('image/jpeg', .9);
        view.innerHTML = `<div class="spread"><img class="cover" src="${img}" alt="The Inner Game of Tennis – W. Timothy Gallwey"><div class="back"><h3>${INNER.title}</h3><p style="text-align:center;margin-top:-.6em">${INNER.author} · ${INNER.year}</p><p>${INNER.blurb}</p><p style="font-size:.85em;color:#6a6255">Sport · Deichman Grünerløkka</p></div></div><small class="help">○ / □ / Esc put the book back</small>`;
      }
    }
    // The reading view owns the buttons while it is open.
    function readInput(input) {
      if (!reading) return false;
      if (input.pressed.has('circle') || input.pressed.has('square') || input.pressed.has('options')) {closeBook();['circle', 'square', 'options'].forEach(b => input.pressed.delete(b));}
      input.move.x = input.move.y = 0;['cross', 'triangle', 'up', 'down', 'left', 'right', 'touchpad'].forEach(b => input.pressed.delete(b));
      return true;
    }
    function prompt(look) {
      const k = look && look.userData && look.userData.libraryBook;
      if (k === 'inner') return {text: '□ Take “The Inner Game of Tennis” off the shelf', act: () => openBook('inner')};
      if (k === 'moby') return {text: '□ Open Moby-Dick', act: () => openBook('moby')};
      return null;
    }

    // ---------- The librarian ----------
    const avatars = window.GameAvatars.create({T, lib}), av = avatars.avatar(0, 'Bibliotekaren', 0x6d4c7d);av.group.name = 'Librarian';local.add(av.group);
    {
      const head = av.joints.head, curl = new T.MeshStandardMaterial({color: 0x5b3a22, roughness: .95}), frame = new T.MeshStandardMaterial({color: 0x15120f, roughness: .3, metalness: .4});
      seed = 77;
      for (let i = 0; i < 46; i++) {const a = rnd() * Math.PI * 2, b = rnd() * .9 + .05, r = .12 + rnd() * .025, c = new T.Mesh(new T.SphereGeometry(.03 + rnd() * .018, 8, 6), curl);c.position.set(Math.cos(a) * Math.sin(b * 1.6) * r, .03 + Math.cos(b * 1.6) * r * .95, Math.sin(a) * Math.sin(b * 1.6) * r + .015);if (c.position.z < -.06 && c.position.y < .1) continue;head.add(c);}
      for (const sgn of [-1, 1]) {const rim = new T.Mesh(new T.TorusGeometry(.027, .005, 6, 16), frame);rim.position.set(sgn * .042, .03, -.112);head.add(rim);const arm = new T.Mesh(new T.BoxGeometry(.004, .004, .11), frame);arm.position.set(sgn * .07, .033, -.06);head.add(arm);}
      const bridge = new T.Mesh(new T.BoxGeometry(.03, .004, .004), frame);bridge.position.set(0, .035, -.113);head.add(bridge);
      const scarfM = lib.fabric(0xb53b2e), neck = head.parent, scarf = new T.Mesh(new T.TorusGeometry(.075, .035, 8, 18), scarfM);scarf.rotation.x = Math.PI / 2;scarf.position.y = .0;neck.add(scarf);
      for (const [x, l] of [[-.04, .3], [.03, .24]]) {const tail = new T.Mesh(new T.BoxGeometry(.07, l, .025), scarfM);tail.position.set(x, -l / 2 - .02, -.08);tail.rotation.x = -.15;neck.add(tail);}
    }
    // Her walking grid: the hall inside the walls, less the shelves, desk, tables and comics boxes.
    const walkGrid = grid({x0: HALL.x0 + .3, x1: HALL.x1 - .3, s0: HALL.s0 + .3, s1: PORCH.s1 - .2}, blocks, .5, .3);
    const DESK_SPOT = [(DESK.x0 + DESK.x1) / 2, DESK.s0 - .55];
    const librarian = new Librarian({grid: walkGrid, desk: DESK_SPOT});librarian.heading = Math.PI;
    const SAY = {run: ['Hysj! Ikke løp i biblioteket!', 'Hysj! Her går vi rolig.', 'Shhh! Dette er et bibliotek!'], loud: ['Hysj! Snakk lavt, takk.', 'Shhh! Folk leser her.', 'Hysj! Innestemme, takk!']};
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const insideL = (x, s) => x > HALL.x0 && x < HALL.x1 && s > HALL.s0 && s < PORCH.s1;
    function inside(x, z, feet) {const l = world.toLocal(x, z);return insideL(l.x, l.s) && feet > FY - .4 && feet < FY + CEIL;}
    let shushPose = 0;const centreW = W(-916, 1730.3);
    // people: [{id, x, z, feet, running, loud, me}] in world coordinates. Returns the events for game-main (shush → notice).
    function update(dt, people, camera) {
      const near = camera ? Math.hypot(camera.position.x - centreW.x, camera.position.z - centreW.z) : 0;
      const lit = near < 120 ? 1 : 0;lamp.intensity = lit * 9;lamp2.intensity = lit * 7;
      if (near > 220) {av.group.visible = false;return [];}
      av.group.visible = true;
      const ppl = people.map(p => {const l = world.toLocal(p.x, p.z);return {id: p.id, x: l.x, s: l.s, inside: insideL(l.x, l.s) && p.feet > FY - .4 && p.feet < FY + CEIL, running: !!p.running, loud: !!p.loud};});
      const ev = librarian.step(dt, ppl);
      for (const e of ev) {
        if (e.kind === 'alert') av.say(e.why === 'run' ? 'HYSJ!!' : 'Hysj…');
        if (e.kind === 'shush') {av.say(pick(SAY[e.why] || SAY.run));shushPose = 2.4;if (audio && audio.sfx) audio.sfx('shush', {gain: e.id === 'me' ? 1 : .5});}
        if (e.kind === 'gone') av.say('Og ikke kom løpende tilbake!');
      }
      av.group.position.set(librarian.x, FY, librarian.s);av.group.rotation.y = librarian.heading + Math.PI;
      av.pose({stance: 'stand', speed: librarian.speed, dt});
      shushPose = Math.max(0, shushPose - dt);
      if (shushPose > 0) {const R = av.joints.R;R.sh.rotation.set(1.2, 0, -.38);R.el.rotation.set(2.3, 0, 0);av.joints.head.rotation.x = .12;}
      av.update(dt, camera || {position: new T.Vector3()}, false);
      return ev;
    }
    const centre = W((HALL.x0 + HALL.x1) / 2, (HALL.s0 + HALL.s1) / 2);
    const poi = () => [{x: DOOR.x, s: 1730, color: '#b8322a', label: 'Deichman Grünerløkka', glyph: '📚'}];
    return {group, obstacles, floors, hitboxes, inside, prompt, update, readInput, openBook, closeBook, get reading() {return reading;}, poi, librarian, avatar: av, floorY: FY, centre, door: W(DOOR.x, PORCH.s1 + 2.6), deskSpot: W(...DESK_SPOT), books: bookBoxes.length, innerBook, moby: mobyClosed};
  }

  return {grid, path, Librarian, prepare, create, MOBY, INNER, RING, HALL, OSM_ID};
});
