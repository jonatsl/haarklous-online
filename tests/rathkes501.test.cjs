// Rathkes gate 1C, flat 501 (issue #72): the wing frame, the cut of the OSM building, the stair you can walk up and the flat's
// rooms you can walk into (with the game's own collision code), the lamps and the data from the user's video.
const test = require('node:test');
const assert = require('node:assert');
const F = require('../game-rathkes-501.js');
const D = require('../rathkes-501-data.js');
const Rathkes = require('../game-rathkes.js');
const WC = require('../walk-collision.js');

const RING = [[-835.6, 1794], [-834.6, 1795.7], [-832.1, 1794.3], [-832.9, 1792.8], [-829.5, 1790.8], [-835.1, 1781.6], [-853.8, 1791.8], [-854.9, 1795.3], [-845.5, 1811.7], [-835.7, 1805.9], [-837.8, 1802.3], [-836.5, 1801.5], [-837.8, 1799.3], [-839.1, 1800.2], [-840.9, 1797.2]];
const inside = (p, r) => {let o = false;for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[i], b = r[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) o = !o;}return o;};
const inRect = (r, a, b) => a >= r[0] && a <= r[2] && b >= r[1] && b <= r[3];
const YARD = -72.6, lv = F.levels(D, YARD);

test('the wing frame runs along the street face of the side wing', () => {
  const fr = F.frame(D);
  assert.deepStrictEqual(fr.toLocal(0, 0), D.frame.origin);
  const end = fr.toWing(...D.frame.toward);assert.ok(Math.abs(end[0] - 18.9) < .05 && Math.abs(end[1]) < 1e-9, `${end}`);
  for (const [a, b] of [[3, 4], [13.65, 7.2], [-2, 20]]) {const [x, s] = fr.toLocal(a, b), back = fr.toWing(x, s);assert.ok(Math.hypot(back[0] - a, back[1] - b) < 1e-9);}
  // b grows toward the backyard: the 1C address node (OSM) is about 3 m along and 10 m in, near the yard face (b 11.3).
  const c = fr.toWing(-838.5, 1804.3);assert.ok(c[0] > 2 && c[0] < 4 && c[1] > 9 && c[1] < 11.3, `${c}`);
  // three.js rotation.y: +x onto A and +z onto B.
  assert.ok(Math.abs(Math.cos(fr.phi) - fr.A[0]) < 1e-12 && Math.abs(-Math.sin(fr.phi) - fr.A[1]) < 1e-12);
  assert.ok(Math.abs(Math.sin(fr.phi) - fr.B[0]) < 1e-12 && Math.abs(Math.cos(fr.phi) - fr.B[1]) < 1e-12);
});

test('the building keeps every piece outside the model, and nothing inside it', () => {
  const fr = F.frame(D), section = D.outline.map(([a, b]) => fr.toLocal(a, b));
  const P = Rathkes.DATA.passage, parts = Rathkes.split(RING, P.from, P.to, P.width).flatMap(r => F.cut(r, D));
  assert.strictEqual(parts.length, 4);
  for (const r of parts) {
    const c = r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]);
    assert.ok(!inside(c, section), 'a piece lies in the model');
    for (const [a, b] of [[2, 2], [6, 5], [9, 10], [12, 3], [11, 6.5]]) assert.ok(!inside(fr.toLocal(a, b), r), `piece covers ${a},${b}`);
  }
  // Total: the building = its pieces + the model's part + the passage and the old stair bay.
  const lost = F.area(RING) - parts.reduce((s, r) => s + F.area(r), 0) - F.area(section);assert.ok(lost > 30 && lost < 45, `${lost}`);
  // The corner and the street wing stay (e.g. stair 1B at a 11, b 10 and the gate's building at a 20, b 10).
  for (const [a, b] of [[11.5, 9], [20, 8], [15, 3]]) assert.ok(parts.some(r => inside(fr.toLocal(a, b), r)), `${a},${b}`);
});

test('prepare cuts the model out and keeps the roof height of the whole building', () => {
  const d = {buildings: [{id: Rathkes.DATA.osm, ring: RING, h: 18.2, style: 'brick', hip: null, tile: 3}]};
  const ground = (dd, x, s) => (x + 840) * .05 + (s - 1800) * .02;// a sloping test ground
  assert.strictEqual(Rathkes.prepare([d], ground), 1);
  const c = r => r.reduce((s, p) => [s[0] + p[0] / r.length, s[1] + p[1] / r.length], [0, 0]), top = ground(null, ...c(RING)) + 18.2;
  for (const b of d.buildings) assert.ok(Math.abs(ground(null, ...c(b.ring)) + b.h - top) < 1e-9);
  assert.strictEqual(Rathkes.mapBuildings().length, 1);
});

test('levels: the 5th floor is about 13 m over the yard, 18 risers a storey', () => {
  assert.ok(Math.abs(lv.FL - (YARD + .05 + .86 + 4 * 3.1)) < 1e-9);assert.ok(lv.FL - YARD > 12.5 && lv.FL - YARD < 14);
  assert.ok(Math.abs(lv.rise - 3.1 / 18) < 1e-12 && lv.rise > .16 && lv.rise < .18);
});

// A collision world in wing coordinates (x = a, z = b) with the yard as flat ground outside the building.
function worldOf({flat = true} = {}) {
  const rect = r => [{x: r[0], z: r[1]}, {x: r[2], z: r[1]}, {x: r[2], z: r[3]}, {x: r[0], z: r[3]}];
  const floors = [...F.stairFloors(D, lv, () => YARD), ...(flat ? F.flatFloors(D, lv) : [])].map(f => ({points: rect(f.rect), ceilingHeight: f.ceiling || 2.6, ...(f.h ? {height: p => f.h(p.x, p.z)} : {y: f.y})}));
  floors.push({points: rect([-5, 11.3, 20, 25]), y: YARD, ceilingHeight: Infinity});// the backyard
  const obstacles = F.obstacles(D, lv, YARD - 1, YARD + 19).map(o => ({points: rect(o.rect), minY: o.minY, maxY: o.maxY}));
  return WC.createWorld({floors, obstacles, radius: .18, clearance: .08});
}
function walk(w, p, path) {
  let pos = {...p};
  for (const [a, b] of path) for (let i = 0; i < 400; i++) {const dx = a - pos.x, dz = b - pos.z, d = Math.hypot(dx, dz);if (d < .05) break;const s = Math.min(.06, d);pos = WC.move(w, pos, {x: dx / d * s, z: dz / d * s}, 1.6, pos.y);}
  return pos;
}

test('from the backyard through door 1C, up the winding stair to the 5th floor and in at 501', () => {
  const w = worldOf();
  let p = {x: 3.75, z: 12.5, y: YARD};
  p = walk(w, p, [[3.75, 10.2], [3.75, 7.9], [3.9, 7.1]]);assert.ok(Math.abs(p.y - lv.L[0]) < .02, `1st floor ${p.y}`);
  for (let n = 1; n < D.floors; n++) {
    p = walk(w, p, [[6.2, 7.3], [6.25, 9.2], [6.1, 10.0], [5.6, 10.35], [5.05, 10.0], [4.95, 9.2], [4.95, 7.6], [5.1, 7.1]]);
    assert.ok(Math.abs(p.y - lv.L[n]) < .02, `landing ${n + 1}: ${p.y} vs ${lv.L[n]}`);
  }
  p = walk(w, p, [[5.05, 6.9], [5.05, 5.7]]);
  assert.ok(Math.abs(p.y - lv.FL) < 1e-6 && p.z < 6.37, `in the hall: ${JSON.stringify(p)}`);
  assert.deepStrictEqual(F.where(D, lv, p.x, p.z, p.y), {place: 'flat', room: 'hall'});
});

test('the stair has no gaps: flights, turns and landings meet at the same height', () => {
  const S = D.stair, fl = S.flights, floors = F.stairFloors(D, lv);
  for (let n = 1; n < D.floors; n++) {
    const y = lv.L[n - 1], up = floors.find(f => f.name === `Stair 1C, flight ${n} up`), turn = floors.find(f => f.name === `Stair 1C, turn ${n}`), on = floors.find(f => f.name === `Stair 1C, flight ${n} on`);
    assert.ok(Math.abs(up.h(6.2, fl.from) - y) < 1e-9);
    assert.ok(Math.abs(up.h(6.2, fl.to) - turn.h(6.2, fl.to + 1e-6)) < 1e-4, 'east flight meets the turn');
    assert.ok(Math.abs(on.h(5.0, fl.to) - turn.h(5.0, fl.to + 1e-6)) < 1e-4, 'turn meets the west flight');
    assert.ok(Math.abs(on.h(5.0, fl.from) - lv.L[n]) < 1e-9, 'west flight reaches the next landing');
    // The turn climbs steadily round the well.
    let last = -Infinity;for (let t = 0; t <= 180; t += 15) {const r = .8, h = turn.h(S.turn.centre[0] + r * Math.cos(t * Math.PI / 180), S.turn.centre[1] + r * Math.sin(t * Math.PI / 180));assert.ok(h >= last - 1e-9);last = h;}
  }
  // The yard door's threshold meets the yard outside and the hall floor inside.
  const door = floors.find(f => f.name === 'Stair 1C, yard door');
  assert.ok(Math.abs(door.h(3.75, D.yard[1]) - lv.yard) < 1e-9 && Math.abs(door.h(3.75, D.yard[0]) - lv.G) < 1e-9);
});

test('every room of the flat can be walked into from the front door (doors open)', () => {
  const w = worldOf(), step = .2, seen = new Set(), key = (x, z) => `${Math.round(x / step)},${Math.round(z / step)}`, queue = [{x: 5.05, z: 5.7, y: lv.FL}];
  seen.add(key(5.05, 5.7));
  while (queue.length) {
    const p = queue.shift();
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const t = {x: p.x + dx, z: p.z + dz};if (seen.has(key(t.x, t.z))) continue;
      const q = WC.move(w, p, {x: dx, z: dz}, 1.6, p.y);
      if (Math.hypot(q.x - t.x, q.z - t.z) > .02 || Math.abs(q.y - lv.FL) > .3) continue;
      seen.add(key(t.x, t.z));queue.push(q);
    }
  }
  const cells = [...seen].map(k => k.split(',').map(v => +v * step));
  for (const r of D.rooms) {const n = cells.filter(([a, b]) => inRect(r.rect, a, b)).length;assert.ok(n > 10, `${r.id}: ${n} cells`);}
  // Nothing outside the flat or through the facades.
  assert.ok(cells.every(([a, b]) => a > .3 && a < 13.4 && b > .45 && b < 10.85 || inRect(D.stair.landing, a, b)), 'walked out of the flat');
});

test('where you are and which lamp lights you', () => {
  for (const r of D.rooms) {
    const a = (r.rect[0] + r.rect[2]) / 2, b = (r.rect[1] + r.rect[3]) / 2;
    assert.deepStrictEqual(F.where(D, lv, a, b, lv.FL), {place: 'flat', room: r.id});
    const l = F.lampAt(D, lv, a, b, lv.FL);assert.ok(l && inRect(r.rect, l.a, l.b) && l.y > lv.FL + 2 && l.y < lv.FL + D.ceiling, r.id);
  }
  assert.strictEqual(F.where(D, lv, 3.7, 10, lv.G).level, 0);
  for (let n = 1; n <= D.floors; n++) {assert.strictEqual(F.where(D, lv, 5.6, 7.1, lv.L[n - 1]).level, n);const l = F.lampAt(D, lv, 5.6, 7.1, lv.L[n - 1]);assert.ok(Math.abs(l.y - lv.L[n - 1] - 2.65) < 1e-9);}
  assert.strictEqual(F.where(D, lv, 6, 3, lv.FL - 3.1), null);// the flat below is not ours
  assert.strictEqual(F.where(D, lv, 8, -3, lv.FL), null);
});

test('the plan from the video holds together', () => {
  const R = D.rooms.map(r => r.rect), overlap = (p, q) => p[0] < q[2] - 1e-9 && q[0] < p[2] - 1e-9 && p[1] < q[3] - 1e-9 && q[1] < p[3] - 1e-9;
  for (let i = 0; i < R.length; i++) {for (let j = i + 1; j < R.length; j++) assert.ok(!overlap(R[i], R[j]), `${D.rooms[i].id}/${D.rooms[j].id}`);assert.ok(!overlap(R[i], D.stair.room), D.rooms[i].id);}
  // Four bedrooms, the kitchen and living room, the hall and the small bathroom (under 7 m²) behind the hall's end door.
  assert.strictEqual(D.rooms.filter(r => /^bed/.test(r.id)).length, 4);
  const area = r => (r[2] - r[0]) * (r[3] - r[1]), bath = D.rooms.find(r => r.id === 'bath');assert.ok(area(bath.rect) > 3.5 && area(bath.rect) < 7);
  const bathDoor = D.walls.find(w => (w.openings || []).some(o => o.door && o.door.id === 'bath'));assert.ok(Math.abs(bathDoor.rect[0] - D.rooms.find(r => r.id === 'hall').rect[2]) < .01, 'at the end of the hall');
  // The ceiling: doors 2.05 m reach about 70 % of the wall in the video.
  assert.ok(D.ceiling > 2.8 && D.ceiling < 3.1);
  // Every piece of furniture stands in a room (or on the landing); doors fit in their walls; windows on the facades.
  for (const f of D.furniture) {const [a, b] = f.at || [(f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2];assert.ok(R.some(r => inRect(r, a, b)) || inRect(D.stair.landing, a, b) || b === D.street[1] || b === D.yard[0], `${f.kind} at ${a},${b}`);}
  for (const w of D.walls) for (const o of w.openings || []) {const alongA = w.rect[2] - w.rect[0] > w.rect[3] - w.rect[1], lo = alongA ? w.rect[0] : w.rect[1], hi = alongA ? w.rect[2] : w.rect[3];assert.ok(o.at[0] >= lo && o.at[1] <= hi && o.at[1] - o.at[0] >= .8, JSON.stringify(o));}
  for (const [c, wd] of [...D.windows.street, ...D.windows.yard]) assert.ok(c - wd / 2 > 0 && c + wd / 2 < D.cut.a2);
  for (const [c, wd] of D.windows.yard) assert.ok(c + wd / 2 < D.stair.walls.west[0] || c - wd / 2 > D.stair.walls.east[1], 'yard windows miss the stair');
  // Obstacles never cover a walkable floor of the flat at standing height (apart from the walls between them).
  const obs = F.obstacles(D, lv, YARD - 1, YARD + 19);
  for (const r of D.rooms) {const a = (r.rect[0] + r.rect[2]) / 2, b = (r.rect[1] + r.rect[3]) / 2;assert.ok(!obs.some(o => inRect(o.rect, a, b) && o.minY < lv.FL + 1.7 && o.maxY > lv.FL + .05) || r.id === 'living', r.id);}
});

// ---------- The living room you can use (issue #116): record player, sofa and TV, chairs, lava lamp ----------
const Liv = require('../game-rathkes-living.js');
require('../game-music.js');const Music = globalThis.GameMusic;
const solids0 = F.furnitureSolids(D);// wing coordinates, heights from the floor
const homes = () => Liv.chairsOf(D).map(c => ({kind: c.kind, a: c.home.a, b: c.home.b, y: c.home.y}));

test('the furniture keeps its collision, the chairs are pieces of their own, the sofa is clear of the wall unit', () => {
  assert.ok(solids0.length > 30 && !solids0.some(s => ['diningChair', 'slingChair', 'foldingChair'].includes(s.kind)));
  const table = solids0.filter(s => s.kind === 'diningTable');assert.strictEqual(table.length, 5, 'the top and four legs');
  assert.ok(Math.abs(Math.min(...table.map(s => s.minY))) < 1e-9 && table.some(s => s.minY > .6), 'chairs tuck in under the top');
  const meet = (k1, k2) => solids0.filter(s => s.kind === k1).some(p => solids0.filter(s => s.kind === k2).some(q => Liv.overlap(p.pts, q.pts)));
  assert.ok(!meet('sofa', 'wallUnit') && !meet('sofa', 'coffeeTable') && !meet('coffeeTable', 'wallUnit'));
  const chairs = Liv.chairsOf(D);assert.strictEqual(chairs.length, 8);
  assert.deepStrictEqual([...new Set(chairs.map(c => c.kind))].sort(), ['diningChair', 'foldingChair', 'slingChair']);
  assert.strictEqual(chairs.filter(c => c.kind === 'diningChair').length, 6);
});

test('every chair stands on the floor and is built in one piece (no loose or floating parts)', () => {
  for (const kind of Object.keys(Liv.CHAIRS)) {
    const parts = Liv.chairParts(kind), B = parts.map(Liv.partBounds), tol = .012;
    assert.ok(Math.abs(Math.min(...B.map(b => b.y0))) < .004, `${kind} stands on the floor`);
    // Joined: every part touches the floor or another part, and all of it is one piece.
    const touch = (p, q) => p.x0 <= q.x1 + tol && q.x0 <= p.x1 + tol && p.y0 <= q.y1 + tol && q.y0 <= p.y1 + tol && p.z0 <= q.z1 + tol && q.z0 <= p.z1 + tol;
    const seen = new Set(B.map((b, i) => b.y0 < .005 ? i : -1).filter(i => i >= 0)), queue = [...seen];
    while (queue.length) {const i = queue.shift();B.forEach((b, j) => {if (!seen.has(j) && touch(B[i], b)) {seen.add(j);queue.push(j);}});}
    assert.strictEqual(seen.size, parts.length, `${kind}: ${parts.length - seen.size} parts float`);
    // Four legs on the floor, the seat at sitting height, a back at the back, and the collision boxes hold the whole chair.
    assert.ok(B.filter(b => b.y0 < .005).length >= 4, kind);
    const seat = Liv.CHAIRS[kind].seat;assert.ok(seat > .3 && seat < .55, kind);
    assert.ok(B.some(b => b.z1 < 0 && b.y1 > .8), `${kind} has a back`);
    const boxes = Liv.chairBoxes(kind), ext = (k, s) => boxes.map(([w, h, d, x = 0, y = h / 2, z = 0]) => [x, y, z][k] + s * [w, h, d][k] / 2);
    assert.ok(Math.min(...B.map(b => b.x0)) >= Math.min(...ext(0, -1)) - .02 && Math.max(...B.map(b => b.x1)) <= Math.max(...ext(0, 1)) + .02, `${kind} boxes (x)`);
    assert.ok(Math.max(...B.map(b => b.y1)) <= Math.max(...ext(1, 1)) + .02, `${kind} boxes (y)`);
    assert.ok(Math.min(...B.map(b => b.z0)) >= Math.min(...ext(2, -1)) - .02 && Math.max(...B.map(b => b.z1)) <= Math.max(...ext(2, 1)) + .02, `${kind} boxes (z)`);
  }
});

test('the chairs start in free places: in a room, clear of walls, doorways, furniture and each other', () => {
  const all = homes();
  all.forEach((c, i) => {const r = Liv.canPlace({data: D, solids: solids0, others: all.filter((_, j) => j !== i)}, c.kind, c.a, c.b, c.y);assert.ok(r.ok, `${c.kind} at ${c.a},${c.b}: ${r.why}`);});
  // The dining chairs face the table, three a side.
  const tab = D.furniture.find(f => f.kind === 'diningTable').at;
  for (const c of all.filter(c => c.kind === 'diningChair')) assert.ok(Math.sin(c.y) * (tab[0] - c.a) > 0, 'faces the table');
});

test('putting a chair down: in front of you, turned the way you face; never through walls, furniture, chairs or doorways', () => {
  const ctx = player => ({data: D, solids: solids0, others: homes().filter(c => c.kind !== 'slingChair'), player});
  const p = Liv.putPose('slingChair', 9.0, 1.6, Math.PI / 2 + .1);
  assert.ok(Math.abs(p.y - Math.PI / 2) < 1e-9, 'snapped to 15°');assert.ok(p.a > 9.5 && Math.abs(p.b - 1.6) < .1, JSON.stringify(p));
  assert.ok(Liv.canPlace(ctx([9.0, 1.6]), 'slingChair', 9.2, 2.0, 0).ok, 'open floor');
  assert.deepStrictEqual(Liv.canPlace(ctx([9.0, 4.4]), 'slingChair', 9.0, 4.85, 0), {ok: false, why: 'wall'}, 'half into the hall wall');
  assert.strictEqual(Liv.canPlace(ctx([7.3, 1.8]), 'slingChair', 7.3, .95, 0).why, 'furniture', 'on the sofa');
  assert.strictEqual(Liv.canPlace(ctx([10.9, 1.2]), 'diningChair', 10.9, 2.7, 0).why, 'furniture', 'on the table');
  assert.strictEqual(Liv.canPlace({data: D, solids: solids0, others: homes(), player: [8.0, 2.6]}, 'diningChair', 8.05, 3.55, 0).why, 'chair', 'on another chair');
  assert.strictEqual(Liv.canPlace(ctx([9.55, 3.8]), 'diningChair', 9.55, 4.4, 0).why, 'door', 'in front of the doorway to the hall');
  assert.strictEqual(Liv.canPlace(ctx([2.2, 5.7]), 'diningChair', 2.2, 5.7, 0).why, 'door', 'in the hall by a bedroom door');
  // Through a wall into the next room: the chair must stay in the room you are in.
  assert.strictEqual(Liv.canPlace(ctx([4.4, 5.4]), 'diningChair', 4.6, 3.9, Math.PI).why, 'wall');
  assert.ok(Liv.canPlace(ctx([4.6, 3.2]), 'diningChair', 4.6, 3.9, Math.PI).ok, 'the same spot from inside the bedroom');
  // Out of the flat: no room there.
  assert.strictEqual(Liv.canPlace(ctx([5.05, 7.0]), 'diningChair', 5.05, 7.0, 0).why, 'wall');
  // Tucked in under the table top is fine (the seat is lower than the top).
  assert.ok(Liv.canPlace({data: D, solids: solids0, others: []}, 'diningChair', 10.4, 2.7, Math.PI / 2).ok);
});

test('the record player, TV, sofa, chairs and lava lamp are in the flat and can be reached on foot', () => {
  const rect = r => [{x: r[0], z: r[1]}, {x: r[2], z: r[1]}, {x: r[2], z: r[3]}, {x: r[0], z: r[3]}];
  const floors = F.flatFloors(D, lv).map(f => ({points: rect(f.rect), ceilingHeight: f.ceiling, y: f.y}));
  const furn = [...solids0, ...homes().flatMap(c => Liv.boxesToWing(Liv.chairBoxes(c.kind), c.a, c.b, c.y))];
  const obstacles = [...F.obstacles(D, lv, YARD - 1, YARD + 19).map(o => ({points: rect(o.rect), minY: o.minY, maxY: o.maxY})),
    ...furn.map(s => ({points: s.pts.map(([x, z]) => ({x, z})), minY: lv.FL + s.minY, maxY: lv.FL + s.maxY}))];
  const w = WC.createWorld({floors, obstacles, radius: .18, clearance: .08}), step = .15, seen = new Map(), key = (x, z) => `${Math.round(x / step)},${Math.round(z / step)}`, start = {x: 5.05, z: 5.7, y: lv.FL}, queue = [start];
  seen.set(key(start.x, start.z), start);
  while (queue.length) {const p = queue.shift();for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {const t = {x: p.x + dx, z: p.z + dz};if (seen.has(key(t.x, t.z))) continue;const q = WC.move(w, p, {x: dx, z: dz}, 1.6, p.y);if (Math.hypot(q.x - t.x, q.z - t.z) > .02) continue;seen.set(key(t.x, t.z), q);queue.push(q);}}
  const cells = [...seen.values()], its = Liv.items(D);
  assert.deepStrictEqual(its.map(i => i.name).slice(0, 4), ['record player', 'lava lamp', 'TV', 'sofa']);
  for (const it of its) {
    assert.ok(D.rooms.some(r => it.a > r.rect[0] && it.a < r.rect[2] && it.b > r.rect[1] && it.b < r.rect[3]), `${it.name} in a room`);
    const reach = Math.max(it.size[0], it.size[2]) / 2 + 1.0, near = cells.filter(c => Math.hypot(c.x - it.a, c.z - it.b) < reach);
    assert.ok(near.length > 2, `${it.name} at ${it.a.toFixed(2)},${it.b.toFixed(2)} can be reached (${near.length})`);
  }
  // The sofa's three seats face the TV, and there is room to stand up in front of each.
  const seats = Liv.seatsOf(D), tv = its[2];assert.strictEqual(seats.length, 3);
  for (const s of seats) {assert.ok(Math.cos(s.yaw - Math.atan2(tv.a - s.a, tv.b - s.b)) > .999);assert.ok(cells.some(c => Math.hypot(c.x - s.stand[0], c.z - s.stand[1]) < .25), `stand up from seat ${s.i}`);}
});

test('the record player and the TV go round their choices, and every player works out the same timing', () => {
  assert.deepStrictEqual([null, 0, 1, 2, 3].map(i => Liv.cycle(i, 4)), [0, 1, 2, 3, -1]);
  let s = null;const seen = [];for (let k = 0; k < 6; k++) {s = Liv.nextRecord(s, 1000 * k);seen.push(s.r);}
  assert.deepStrictEqual(seen, [0, 1, 2, 3, -1, 0]);
  const on = {r: 2, t: 10000};
  assert.ok(Liv.recordPos(on, 10000) < 0 && Math.abs(Liv.recordPos(on, 10000 + Liv.LEAD_S * 1000)) < 1e-9 && Liv.recordPos({r: -1, t: 0}, 5000) === null);
  assert.strictEqual(Liv.armAt(on, 10000), 0);assert.strictEqual(Liv.armAt(on, 10000 + Liv.ARM_S * 1000), 1);
  assert.strictEqual(Liv.armAt({...on, swap: 1}, 10000), 1, 'changing the record keeps the arm on it');
  assert.strictEqual(Liv.armAt({r: -1, t: 0, was: 2}, 0), 1);assert.strictEqual(Liv.armAt({r: -1, t: 0, was: 2}, Liv.ARM_S * 1000), 0, 'stop: back to its rest');
  let c = null;const ch = [];for (let k = 0; k < 5; k++) {c = Liv.nextChannel(c, k);ch.push(c.c);}assert.deepStrictEqual(ch, [0, 1, 2, 3, -1]);
  assert.deepStrictEqual(Liv.CHANNELS.map(x => x.id), ['news', 'football', 'nature', 'weather']);
  let last = -1;for (let t = 0; t <= 9000; t += 500) {const v = Liv.lavaWarm({on: true, t: 0}, t);assert.ok(v >= last && v <= 1);last = v;}assert.strictEqual(last, 1);
  assert.strictEqual(Liv.lavaWarm({on: false, t: 0, from: 1}, 6000), 0);
  // Four records, each a different piece of the game's own synth music, one to one and a half minutes long.
  assert.deepStrictEqual(Music.records, Liv.RECORDS.map(r => r.track));
  const styles = new Set();for (const r of Liv.RECORDS) {const t = Music.tracks[r.track];assert.ok(t.record && t.title === r.title && t.artist === r.artist && t.seconds > 60 && t.seconds < 90, r.track);styles.add(`${t.bpm}/${t.beats}`);}
  assert.strictEqual(styles.size, 4, 'four different tempos and metres');
});

test('the record and the TV are heard in the living room, faintly in the other rooms, not outside the flat', () => {
  const near = Liv.hearing({place: 'flat', room: 'living'}, .5), far = Liv.hearing({place: 'flat', room: 'living'}, 6), hall = Liv.hearing({place: 'flat', room: 'hall'}, 6);
  assert.ok(near.gain === 1 && far.gain < near.gain && far.gain > .15 && !near.muffle);
  assert.ok(hall.gain > 0 && hall.gain < far.gain && hall.muffle > .5);
  assert.strictEqual(Liv.hearing({place: 'stair', level: 5}, 3).gain, 0);assert.strictEqual(Liv.hearing(null, 3).gain, 0);
  assert.strictEqual(Liv.duckFor(0, 0), 1);assert.ok(Liv.duckFor(1, 0) <= .1 + 1e-9 && Liv.duckFor(0, 1) > .5 && Liv.duckFor(0, 1) < 1);
});
