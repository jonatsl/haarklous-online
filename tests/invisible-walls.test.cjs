// No invisible walls (issue #64): where you can walk joins up, the world's edge is a line you can see (a fence goes on it),
// catacomb walls stay under the lawn, and the Akerselva bridges meet the ground at both ends.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
globalThis.window = globalThis;
for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'akerselva-data.js']) require(path.join(__dirname, '..', f));
require(path.join(__dirname, '..', 'surroundings.js'));
const District = require(path.join(__dirname, '..', 'district.js'));
const CL = require(path.join(__dirname, '..', 'catacomb-layout.js'));
const Kayak = require(path.join(__dirname, '..', 'game-kayak.js'));
const S = window.Surroundings, D = window.SURROUNDINGS, Ds = window.DISTRICTS.map(d => District.decode(d));

test('walkable areas: the Myrens and Gamle Oslo patches are joined by a seam, nothing else is added', () => {
  const rects = S.walkRects(D.terrain.half, S.PLAY_HALF, Ds);
  assert.deepEqual(rects.map(r => r.name), ['Neighbourhood', 'District gamle-oslo', 'District myrens', 'Seam gamle-oslo / myrens']);
  const seam = rects[3];
  assert.deepEqual([seam.x0, seam.s0, seam.x1, seam.s1], [-1160, 520, -728, 600]);
  // Every point of the seam has map data under it (Myrens to s 560, Gamle Oslo from s 560).
  for (let x = seam.x0; x <= seam.x1; x += 8) for (let s = seam.s0; s <= seam.s1; s += 8) assert.ok(Ds.some(d => District.covers(d, x, s)), `${x}, ${s}`);
  // A walk south along Akerselva's west bank from Myrens to Grünerløkka stays inside the walkable areas.
  const inAny = (x, s) => rects.some(r => x >= r.x0 && x <= r.x1 && s >= r.s0 && s <= r.s1);
  for (let s = 400; s <= 700; s += 2) assert.ok(inAny(-1000, s), `s ${s}`);
});

test('open edges: only where the walkable world really ends, each piece once', () => {
  const rects = S.walkRects(D.terrain.half, S.PLAY_HALF, Ds), edges = S.openEdges(rects);
  const inAny = (x, s) => rects.some(r => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && s >= r.s0 - 1e-9 && s <= r.s1 + 1e-9);
  let total = 0;
  for (const e of edges) {
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);total += L;assert.ok(L > 0);
    // Walkable on one side, not on the other, all along the piece.
    const nx = -(e.b[1] - e.a[1]) / L, ns = (e.b[0] - e.a[0]) / L;
    for (let t = .05; t < 1; t += .1) {
      const x = e.a[0] + (e.b[0] - e.a[0]) * t, s = e.a[1] + (e.b[1] - e.a[1]) * t;
      assert.notEqual(inAny(x + nx * .5, s + ns * .5), inAny(x - nx * .5, s - ns * .5), `edge at ${x.toFixed(0)}, ${s.toFixed(0)}`);
    }
  }
  // No piece twice.
  const keys = edges.map(e => [...e.a, ...e.b].map(v => v.toFixed(2)).join());assert.equal(new Set(keys).size, keys.length);
  // The gap between Myrens and Gamle Oslo is gone: no open edge crosses Akerselva's banks there.
  assert.ok(!edges.some(e => e.a[1] === e.b[1] && [520, 600].includes(e.a[1]) && Math.min(e.a[0], e.b[0]) < -800 && Math.max(e.a[0], e.b[0]) > -1150));
  // The outline: the old square's north, east and west sides, the two patches' outer sides (about 16 km).
  assert.ok(total > 15000 && total < 17000, `${total.toFixed(0)} m`);
  // A simple case: two touching squares give one outline of six pieces.
  const two = S.openEdges([{x0: 0, s0: 0, x1: 10, s1: 10}, {x0: 10, s0: 0, x1: 20, s1: 10}]);
  assert.equal(Math.round(two.reduce((a, e) => a + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0)), 60);
});

test('catacomb walls never stand above the open ground (they did on the three stairs, up to 4 m)', () => {
  const heightLocal = CL.terrainSampler(D), L = CL.build({heightLocal}), id = (x, s) => ({x, z: s});
  let walls = 0;
  for (const o of L.obstacles(id)) {
    if (o.kind !== 'catacomb') continue;walls++;
    o.points.forEach((a, i) => {
      const b = o.points[(i + 1) % o.points.length];
      for (let t = 0; t <= 1; t += .25) {const x = a.x + (b.x - a.x) * t, s = a.z + (b.z - a.z) * t;if (!L.cutsGround(x, s)) assert.ok(o.maxY < heightLocal(x, s), `wall top ${o.maxY.toFixed(2)} over ground ${heightLocal(x, s).toFixed(2)} at ${x.toFixed(1)}, ${s.toFixed(1)}`);}
    });
  }
  assert.ok(walls > 300);
});

test('bridge decks meet the ground at both ends and clear the water', () => {
  // A bank that rises to a street at deck height 3 m beyond the bank.
  const street = u => Math.min(4, Math.max(0, (Math.abs(u) - 8) * 1.2));
  let P = Kayak.deckProfile(4, 2, 8, 8, 20, street);
  assert.ok(P[0][0] < -9 && P[3][0] > 9);
  assert.equal(P[0][1], street(P[0][0]));assert.equal(P[3][1], street(P[3][0]));
  assert.ok(P[0][1] >= 3.75 && P[3][1] >= 3.75, 'ends at the street');
  assert.ok(P[1][1] >= 2 && P[2][1] >= 2);
  // A low flat park on both sides (0.3 m over the water): the deck still clears 2 m and its ramps are no steeper than 30 %.
  const park = u => Math.abs(u) < 6 ? -1 : .3;
  P = Kayak.deckProfile(2.5, 2, 6, 6, 30, park);
  assert.equal(P[0][1], .3);assert.equal(P[3][1], .3);
  assert.ok(P[1][1] >= 2 && P[2][1] >= 2);
  for (const [a, b] of [[P[0], P[1]], [P[2], P[3]]]) assert.ok(Math.abs(b[1] - a[1]) / Math.abs(b[0] - a[0]) <= .3 + 1e-9, 'ramp slope');
  // Every Akerselva bridge: real data, a made-up bank sloping up 1 m per metre to its deck.
  const R = Kayak.river(window.AKERSELVA);
  for (const b of window.AKERSELVA.bridges) {
    const c = R.at(b.t), clear = c.level + 1.8, bank = 7, T = u => Math.min(b.deck, c.level + Math.max(0, Math.abs(u) - bank));
    const Q = Kayak.deckProfile(Math.max(clear, b.deck), clear, bank, bank, 30, T);
    assert.ok(Math.abs(Q[0][1] - T(Q[0][0])) < 1e-9 && Math.abs(Q[3][1] - T(Q[3][0])) < 1e-9, `${b.name} ends on the ground`);
    assert.ok(Q[1][1] >= clear && Q[2][1] >= clear, `${b.name} clears the water`);
  }
});

test('box: every face of a bridge box faces out', () => {
  const B = {pos: [], nor: [], idx: []};
  Kayak.box(B, [0, 0, 0], [10, 1, 0], 3, .5, [0, 1]);
  assert.equal(B.idx.length, 36);
  for (let i = 0; i < B.idx.length; i += 3) {
    const [a, b, c] = [B.idx[i], B.idx[i + 1], B.idx[i + 2]].map(k => [B.pos[k * 3], B.pos[k * 3 + 1], B.pos[k * 3 + 2]]), n = [B.nor[B.idx[i] * 3], B.nor[B.idx[i] * 3 + 1], B.nor[B.idx[i] * 3 + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(x[0] * n[0] + x[1] * n[1] + x[2] * n[2] > 0, 'winding matches the normal');
    const centre = [5, .5, 0], m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    assert.ok(m[0] * n[0] + m[1] * n[1] + m[2] * n[2] > 0, 'normal points away from the middle');
  }
});
