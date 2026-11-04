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
