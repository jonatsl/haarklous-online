// Flats you can buy (issue #106): the list of flats, their layout (every room can be walked to), who may buy, and the server's rules.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
const C = require('../walk-collision.js');
require('../stairwell.js');
require('../surroundings-data.js');
const S = globalThis.Stairwell, D = window.SURROUNDINGS, HOMES = require('../homes-data.js'), GH = require('../game-homes.js');
const rect = ([x0, z0, x1, z1]) => [{x: x0, z: z0}, {x: x1, z: z0}, {x: x1, z: z1}, {x: x0, z: z1}];

test('the list: two flats on each of the four floors of the eight stair towers, each its own', () => {
  assert.equal(HOMES.length, 64);
  assert.equal(new Set(HOMES.map(h => h.id)).size, 64);
  assert.equal(D.enterable.length, 8);
  for (let t = 0; t < 8; t++) for (let n = 1; n <= 4; n++) for (const side of [-1, 1]) {
    const h = HOMES.find(h => h.t === t && h.n === n && h.side === side);assert.ok(h, `tower ${t} floor ${n} side ${side}`);
    assert.equal(h.id, `b${t}-${n}${side < 0 ? 'L' : 'R'}`);assert.equal(h.unit, `H0${n}0${side < 0 ? 1 : 2}`);
    assert.ok(h.W >= 3.6 && h.W <= 7.2 && h.vf - h.vb >= 9 && h.vf - h.vb <= 12.4, `${h.id} ${h.W} × ${h.vf - h.vb}`);
    assert.equal(h.area, Math.round(h.W * (h.vf - h.vb)));assert.equal(h.rooms, h.W >= 6.4 ? 3 : 2);
    assert.ok(h.price >= 4000 && h.price <= 12000 && h.price % 100 === 0, `${h.id} costs ${h.price}`);
    assert.ok(h.street && h.stair === 'ABCDEFGH'[t]);
  }
  // Higher up costs more; a bigger flat on the same floor costs more.
  for (const h of HOMES) {const up = HOMES.find(o => o.t === h.t && o.side === h.side && o.n === h.n + 1);if (up) assert.ok(up.price > h.price, `${up.id} > ${h.id}`);}
  assert.ok(HOMES.find(h => h.id === 'b5-2L').price > HOMES.find(h => h.id === 'b7-2L').price);
});

test('the flat module measures the stair tower as stairwell.js does', () => {
  for (const k of ['XL', 'XA', 'STOREY', 'TOP', 'DOOR_H']) assert.equal(GH[k], S[k], k);
  assert.deepEqual(GH.DOOR, S.DOOR);
  for (let n = 1; n <= 4; n++) assert.equal(GH.levelY(n), S.levelY(n));
});

test('each flat lies inside its building, with the street wall on the building\'s facade', () => {
  const inPoly = (x, z, o) => {let c = false;for (let i = 0, j = o.length - 1; i < o.length; j = i++) if ((o[i][1] > z) !== (o[j][1] > z) && x < (o[j][0] - o[i][0]) * (z - o[i][1]) / (o[j][1] - o[i][1]) + o[i][0]) c = !c;return c;};
  for (const h of HOMES.filter(h => h.n === 1)) {
    const e = D.enterable[h.t], b = D.buildings[e.b], c = Math.cos(e.rot), s = Math.sin(e.rot), outline = [];
    for (let i = 0; i < b.r.o.length; i += 2) {const dx = b.r.o[i] - e.x, dz = b.r.o[i + 1] - e.s;outline.push([dx * c - dz * s, dx * s + dz * c]);}
    const [x0, z0, x1, z1] = GH.solids(h).floor;
    for (let x = x0; x <= x1; x += .25) for (const z of [z0 - .25, z1 + .25]) assert.ok(inPoly(x, z, outline), `${h.id}: ${x.toFixed(2)}, ${z.toFixed(2)} is outside the building`);
    for (let z = z0; z <= z1; z += .25) assert.ok(inPoly(h.side < 0 ? x0 - .2 : x1 + .2, z, outline), `${h.id}: the party wall at z ${z.toFixed(2)}`);
    assert.ok(!inPoly((x0 + x1) / 2, z1 + .5, outline), `${h.id}: the street wall is the facade`);
  }
});

// A walk world for one stair tower with all its flats (tower coordinates): the tower, the flats, and the building as one
// solid block with the flats hollowed out of it, as in the game.
function towerWorld(t) {
  const mine = HOMES.filter(h => h.t === t), floors = [...S.floors(false, mine)], obstacles = [...S.obstacles(false, 3.35, mine)], voids = [];
  for (const h of mine) {
    const y = GH.levelY(h.n), sh = GH.solids(h);
    floors.push({name: `Flat ${h.id}`, points: rect(sh.floor), y, ceilingHeight: GH.CEIL});
    for (const v of sh.voids) voids.push({points: rect(v), minY: y - .05, maxY: y + GH.CEIL});
    for (const k of sh.blocks) obstacles.push({points: rect(k.r), minY: y + k.y0, maxY: y + k.y1});
  }
  // The building: everything round the tower (the tower itself is a notch in it, x -1.45..1.665, z 4.9..11.12).
  obstacles.push({points: [{x: -12, z: -6}, {x: 12, z: -6}, {x: 12, z: 10.32}, {x: 1.665, z: 10.32}, {x: 1.665, z: 4.9}, {x: -1.45, z: 4.9}, {x: -1.45, z: 10.32}, {x: -12, z: 10.32}], minY: -12, maxY: 6, voids});
  return C.createWorld({floors, obstacles, radius: .18});
}
// Every place you can walk to from `start` without leaving the height `y` (a 0.12 m grid).
function reach(world, start, y) {
  const G = .12, key = (i, j) => i * 4096 + j, seen = new Set(), todo = [[Math.round(start.x / G), Math.round(start.z / G)]], out = [];
  while (todo.length) {
    const [i, j] = todo.pop(), k = key(i + 2000, j + 2000);if (seen.has(k)) continue;seen.add(k);
    const p = {x: i * G, z: j * G};if (!C.canStand(world, p, 1.65, y)) continue;
    const s = C.supportAt(world, p, y);if (!s || Math.abs(s.y - y) > .01) continue;
    out.push(p);todo.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return out;
}

test('from the landing you walk through the door into every room of every flat, and nowhere else', () => {
  for (let t = 0; t < 8; t++) {
    const world = towerWorld(t);
    for (const n of [1, 3]) {
      const y = GH.levelY(n), cells = reach(world, {x: .1, z: 5.83}, y);
      for (const h of HOMES.filter(h => h.t === t && h.n === n)) {
        const P = GH.plan(h), wall = h.side < 0 ? GH.XL : GH.XA, uv = p => ({u: (p.x - wall) * h.side, v: p.z});
        const inFlat = cells.map(uv).filter(q => q.u > 0 && q.u < h.W && q.v > h.vb && q.v < h.vf);
        for (const r of P.rooms) {
          const got = inFlat.filter(q => q.u > r.u0 && q.u < r.u1 && q.v > r.v0 && q.v < r.v1).length, all = (r.u1 - r.u0) * (r.v1 - r.v0) / (.12 * .12);
          assert.ok(got > all * .25, `${h.id}: ${r.name} – only ${got} of about ${Math.round(all)} places can be walked to`);
        }
        // Nobody walks out through a wall: every reachable place is on the landing, in the doorway or in a flat of this floor.
      }
      for (const p of cells) {
        const inTower = p.x > -1.45 && p.x < 1.665 && p.z > 4.9 && p.z < 11.12;
        const inAFlat = HOMES.some(h => h.t === t && h.n === n && (() => {const [x0, z0, x1, z1] = GH.solids(h).floor;return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;})());
        assert.ok(inTower || inAFlat, `tower ${t} floor ${n}: reached ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
      }
    }
  }
});

test('the building stays solid outside the flats, and between the storeys', () => {
  const world = towerWorld(0), h = HOMES.find(h => h.id === 'b0-2L'), [x0, z0, x1, z1] = GH.solids(h).floor, mid = {x: (x0 + x1) / 2, z: 8.6};
  assert.ok(C.canStand(world, mid, 1.65, GH.levelY(2)), 'in the living room');
  assert.ok(C.hitsSolid(world, mid, GH.levelY(2) + GH.CEIL + .05, GH.levelY(2) + GH.CEIL + .2), 'the slab above the flat is solid');
  assert.ok(C.hitsSolid(world, {x: x0 - 1, z: 8.6}, GH.levelY(2) + .5, GH.levelY(2) + 1.5), 'the neighbour beyond the party wall is solid');
  assert.ok(!C.hitsSolid(world, mid, GH.levelY(2) + .5, GH.levelY(2) + 1.5), 'the room itself is hollow');
});

test('layout: doorways are wide enough, furniture stays in the flat and out of the doorways', () => {
  for (const h of HOMES.filter(h => h.n === 1)) {
    const P = GH.plan(h);
    assert.equal(P.rooms.length, h.rooms + 2 + 1 - 1, `${h.id}: hall, bathroom, ${h.rooms - 1} bedroom(s), living room`);
    for (const w of P.walls) for (const [a, b] of w.gaps) assert.ok(b - a >= .75, `${h.id} ${w.name}: a ${(b - a).toFixed(2)} m doorway`);
    for (const f of P.furniture) {
      assert.ok(f.u0 >= GH.LIN - 1e-9 && f.u1 <= h.W + 1e-9 && f.v0 >= h.vb - 1e-9 && f.v1 <= h.vf + 1e-9 && f.u1 > f.u0 && f.v1 > f.v0 && f.y1 > f.y0 && f.y1 <= GH.CEIL, `${h.id}: ${f.name} ${JSON.stringify(f)}`);
      // Not across the entrance (u 0–1 m in front of the door).
      if (f.solid) assert.ok(!(f.u0 < 1 && f.v0 < GH.DOOR.z1 && f.v1 > GH.DOOR.z0), `${h.id}: ${f.name} blocks the entrance`);
    }
    assert.ok(P.windows.filter(w => w.wall === 'front').length >= 2 && P.windows.filter(w => w.wall === 'back').length === h.rooms - 1);
    for (const w of P.windows) assert.ok(w.a0 > .1 && w.a1 < h.W - .05 && w.a1 - w.a0 >= .8, `${h.id}: window ${JSON.stringify(w)}`);
  }
});

test('who may buy: an account, enough money, a flat nobody owns, and only one flat each', () => {
  const home = HOMES.find(h => h.id === 'b2-3R'), user = {id: 'u1', name: 'Kari'}, free = {owners: {}, mine: null};
  assert.equal(GH.status(home.id, free), 'sale');
  assert.equal(GH.canBuy({home, reg: free, money: home.price, user, online: true}), '');
  assert.match(GH.canBuy({home, reg: free, money: home.price, user, online: false}), /online/);
  assert.match(GH.canBuy({home, reg: free, money: home.price, user: null, online: true}), /Log in/);
  assert.match(GH.canBuy({home, reg: free, money: home.price - 1, user, online: true}), /You need/);
  const taken = {owners: {[home.id]: 'Ola'}, mine: null};
  assert.equal(GH.status(home.id, taken), 'taken');assert.match(GH.canBuy({home, reg: taken, money: 1e6, user, online: true}), /Ola owns this flat/);
  const mine = {owners: {'b0-1L': 'Kari'}, mine: 'b0-1L'};
  assert.equal(GH.status('b0-1L', mine), 'mine');assert.match(GH.canBuy({home, reg: mine, money: 1e6, user, online: true}), /sell it first/);
  assert.equal(GH.refund(home), Math.round(home.price * .8 / 100) * 100);
  assert.equal(GH.money(12345), '12 345 kr');assert.equal(GH.label(home), `${home.rooms}-room flat, ${home.area} m², 3rd floor`);
});

test('the server: one owner per flat, one flat per account, and selling puts it back on the market', async () => {
  const R = await import('../cloud/src/homes-rules.js');
  assert.equal(R.CATALOG.size, 64);
  let rows = [];
  const put = r => {assert.ok(r.ok, JSON.stringify(r));rows.push({...r.row, at: rows.length});};
  put(R.buy(rows, {id: 'b1-2L', uid: 'u1', name: 'Kari <b>'}));
  assert.equal(rows[0].name, 'Kari b');assert.equal(rows[0].price, HOMES.find(h => h.id === 'b1-2L').price);
  // Somebody else cannot buy the same flat; the owner cannot buy a second one; an unknown flat or no account is refused.
  assert.deepEqual((({ok, error, status}) => ({ok, error, status}))(R.buy(rows, {id: 'b1-2L', uid: 'u2', name: 'Ola'})), {ok: false, error: 'taken', status: 409});
  assert.equal(R.buy(rows, {id: 'b1-2L', uid: 'u1', name: 'Kari'}).error, 'yours');
  assert.equal(R.buy(rows, {id: 'b1-3L', uid: 'u1', name: 'Kari'}).error, 'has-one');
  assert.equal(R.buy(rows, {id: 'nope', uid: 'u2', name: 'Ola'}).status, 404);
  assert.equal(R.buy(rows, {id: 'b1-3L', uid: '', name: ''}).status, 401);
  put(R.buy(rows, {id: 'b1-3L', uid: 'u2', name: 'Ola'}));
  assert.deepEqual(R.listing(rows), {homes: [{id: 'b1-2L', name: 'Kari b'}, {id: 'b1-3L', name: 'Ola'}]});
  assert.equal(R.mine(rows, 'u1'), 'b1-2L');assert.equal(R.mine(rows, 'u3'), null);
  // Selling: 80 % back, and then anybody can buy it.
  const sold = R.sell(rows, {uid: 'u1'});assert.deepEqual(sold, {ok: true, id: 'b1-2L', refund: R.refundOf(rows[0].price)});
  rows = rows.filter(r => r.uid !== 'u1');
  assert.equal(R.sell(rows, {uid: 'u1'}).error, 'none');
  assert.ok(R.buy(rows, {id: 'b1-2L', uid: 'u3', name: 'Per'}).ok);
});

test('a room hollowed out of a solid (walk-collision voids)', () => {
  const sq = (x0, z0, x1, z1) => rect([x0, z0, x1, z1]);
  const world = C.createWorld({floors: [{points: sq(0, 0, 4, 4), y: 5, ceilingHeight: 2.6}, {points: sq(-20, -20, 20, 20), y: 0}],
    obstacles: [{points: sq(-10, -10, 10, 10), minY: -1, maxY: 20, voids: [{points: sq(0, 0, 4, 4), minY: 4.7, maxY: 7.6}]}], radius: .18});
  assert.ok(C.canStand(world, {x: 2, z: 2}, 1.65, 5), 'in the room');
  assert.ok(!C.canStand(world, {x: 2, z: 2}, 1.65, 0), 'under the room, inside the solid');
  assert.ok(!C.canStand(world, {x: -2, z: 2}, 1.65, 0) && C.canStand(world, {x: 15, z: 2}, 1.65, 0));
  const p = C.move(world, {x: 2, z: 2, y: 5}, {x: 5, z: 0}, 1.65, 5);assert.ok(p.x < 4 && p.x > 3.7, `stopped at the room's edge: ${p.x}`);
  assert.ok(!C.hitsSolid(world, {x: 2, z: 2}, 5.2, 6) && C.hitsSolid(world, {x: 2, z: 2}, 8, 9) && C.hitsSolid(world, {x: 6, z: 2}, 5.2, 6));
});
