// Grünerløkka (issues #44, #45, #47): Akerselva kayaking, the library and its librarian, table tennis, Rathkes gate 1.
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
require('../akerselva-data.js');
const A = window.AKERSELVA;
const Kayak = require('../game-kayak.js');
const Library = require('../game-library.js');
const TT = require('../game-tabletennis.js');
const Rathkes = require('../game-rathkes.js');

// ---------- Akerselva ----------
test('Akerselva data: one river from Bjølsen to Vaterland that never runs uphill', () => {
  const n = A.level.length;
  assert.strictEqual(A.pts.length, 2 * n);assert.strictEqual(A.wl.length, n);assert.strictEqual(A.wr.length, n);
  for (let k = 1; k < n; k++) assert.ok(A.level[k] <= A.level[k - 1] + 1e-9, `level rises at ${k}`);
  assert.ok(A.level[0] - A.level[n - 1] > 60, 'about 80 m of drop');
  for (let k = 0; k < n; k++) assert.ok(A.wl[k] >= 2 && A.wr[k] >= 2 && A.wl[k] + A.wr[k] < 70);
  assert.strictEqual(A.starts.length, 3);
  // Put-ins in order downstream, the take-out after the last one.
  for (let i = 1; i < 3; i++) assert.ok(A.starts[i].t > A.starts[i - 1].t);
  assert.ok(A.finish.t > A.starts[2].t + 500);
  // No put-in on a fall.
  for (const s of A.starts) for (const f of A.falls) assert.ok(Math.abs(s.t - f.t) > f.len / 2, `${s.name} sits on a fall`);
});

test('river model: locate() finds the centre line again, and the current is faster in falls', () => {
  const R = Kayak.river(A);
  for (const t of [100, 900, 2200, 3700, 4500]) {
    const c = R.at(t), off = c.wr * .5, x = c.x - c.ds * off, s = c.s + c.dx * off, L = R.locate(x, s, Math.round(t / A.step));
    assert.ok(Math.abs(L.t - t) < 1, `t ${t} -> ${L.t}`);assert.ok(Math.abs(L.n - off) < .3, `n ${off} -> ${L.n}`);
  }
  const calm = R.flow(A.starts[2].t + 40), fall = A.falls.reduce((a, b) => b.drop / b.len > a.drop / a.len ? b : a);
  assert.ok(calm < 1.5, `calm water ${calm}`);assert.ok(R.flow(fall.t) > 3, 'a steep fall runs fast');
});

test('kayak: paddling from each put-in reaches Vaterland, inside the banks the whole way', () => {
  const R = Kayak.river(A);
  for (const st of A.starts) {
    const b = new Kayak.Boat(R).place(st.t, 0);let finished = false, t = 0, worst = 0;
    while (t < 60 * 60 && !finished) {
      const c = R.at(b.t + 6), want = Math.atan2(c.dx, c.ds) - b.n * .08;let d = want - b.h;d = Math.atan2(Math.sin(d), Math.cos(d));
      for (const e of b.step(1 / 30, {fwd: 1, turn: Math.max(-1, Math.min(1, -d * 2))})) if (e.kind === 'finish') finished = true;
      const w = R.at(b.t);worst = Math.max(worst, b.n - (w.wr - Kayak.HULL), -w.wl + Kayak.HULL - b.n);
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.s));t += 1 / 30;
    }
    assert.ok(finished, `${st.name}: reached t ${b.t.toFixed(0)}`);assert.ok(worst < .05, `${st.name}: outside the banks by ${worst}`);
  }
});

test('kayak: back-paddling holds the boat against the calm current, and the boom stops it at the end', () => {
  const R = Kayak.river(A), b = new Kayak.Boat(R).place(A.starts[2].t + 60, 0), t0 = b.t;
  for (let i = 0; i < 30 * 20; i++) b.step(1 / 30, {fwd: -1});
  assert.ok(b.t < t0 + 15, `drifted ${b.t - t0} m in 20 s`);
  const e = new Kayak.Boat(R).place(A.finish.t + 5, 0);for (let i = 0; i < 30 * 60; i++) e.step(1 / 30, {fwd: 1});
  assert.ok(e.t <= A.finish.t + 12.01, 'stops at the boom before the culvert');
});

test('river bed: lowered inside the river only, never raised, never under a building', () => {
  const quads = Kayak.bedQuads(A), q = quads[Math.floor(quads.length / 2)];
  const cx = q.ring.reduce((a, p) => a + p[0], 0) / 4, cs = q.ring.reduce((a, p) => a + p[1], 0) / 4;
  const N = 41, step = 4, x0 = Math.round(cx) - 80, s0 = Math.round(cs) - 80, h = new Float64Array(N * N).fill(q.rel + 5);
  const grid = {x0, s0, step, nx: N, ns: N, get: k => h[k], set: (k, v) => {h[k] = v;}};
  const building = {x0: x0 + 100, x1: x0 + 112, s0: s0 + 100, s1: s0 + 112, ring: [[x0 + 100, s0 + 100], [x0 + 112, s0 + 100], [x0 + 112, s0 + 112], [x0 + 100, s0 + 112]]};
  const changed = Kayak.lowerGrid(grid, quads, [building]);
  assert.ok(changed > 0);
  const ci = Math.round((cx - x0) / step), cj = Math.round((cs - s0) / step);assert.ok(h[cj * N + ci] < q.rel + 5, 'the river centre is lowered');
  const R = Kayak.river(A);let far = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (R.locate(x0 + i * step, s0 + j * step).d > 45) {far++;assert.strictEqual(h[j * N + i], q.rel + 5, 'far from the river nothing changes');}
  assert.ok(far > 50);
  for (let j = 25; j <= 28; j++) for (let i = 25; i <= 28; i++) assert.strictEqual(h[j * N + i], q.rel + 5, 'ground under the building stays');
  const before = h.slice();Kayak.lowerGrid(grid, quads, []);for (let k = 0; k < h.length; k++) assert.ok(h[k] <= before[k]);
});

// ---------- Deichman Grünerløkka ----------
test('library grid: paths go round the shelves', () => {
  const g = Library.grid({x0: 0, x1: 10, s0: 0, s1: 6}, [{x0: 4.8, x1: 5.2, s0: 0, s1: 4.5}], .5, .3);
  const p = Library.path(g, [1, 1], [9, 1]);
  assert.ok(p && p.length >= 3, 'not a straight line through the shelf');
  for (let k = 1; k < p.length; k++) {
    const [a, b] = [p[k - 1], p[k]];
    for (let u = 0; u <= 1; u += .02) {const x = a[0] + (b[0] - a[0]) * u, s = a[1] + (b[1] - a[1]) * u;assert.ok(!(x > 4.6 && x < 5.4 && s < 4.7), `through the shelf at ${x}, ${s}`);}
  }
});

test('librarian: a runner is chased and shushed, then she walks back to her desk', () => {
  const g = Library.grid({x0: 0, x1: 20, s0: 0, s1: 10}, [], .5);
  const L = new Library.Librarian({grid: g, desk: [18, 8]});
  const me = {id: 'me', x: 2, s: 2, inside: true, running: false, loud: false};
  for (let i = 0; i < 60; i++) L.step(1 / 30, [me]);
  assert.strictEqual(L.state, 'desk', 'walking is fine');
  me.running = true;const ev = [];
  for (let i = 0; i < 30 * 8 && !ev.some(e => e.kind === 'shush'); i++) ev.push(...L.step(1 / 30, [me]));
  assert.ok(ev.some(e => e.kind === 'alert' && e.why === 'run'));
  const shush = ev.find(e => e.kind === 'shush');assert.ok(shush && shush.id === 'me' && shush.why === 'run');
  assert.ok(Math.hypot(L.x - me.x, L.s - me.s) < 1.2);
  me.running = false;let back = false;
  for (let i = 0; i < 30 * 30 && !back; i++) back = L.step(1 / 30, [me]).some(e => e.kind === 'back');
  assert.ok(back && Math.hypot(L.x - 18, L.s - 8) < .3, 'back at the desk');
});

test('librarian: a loud voice gets a shush too; leaving the library ends the chase', () => {
  const g = Library.grid({x0: 0, x1: 20, s0: 0, s1: 10}, [], .5);
  const L = new Library.Librarian({grid: g, desk: [18, 8]}), p = {id: 7, x: 3, s: 3, inside: true, running: false, loud: true};
  const ev = [];for (let i = 0; i < 30 * 12 && !ev.some(e => e.kind === 'shush'); i++) ev.push(...L.step(1 / 30, [p]));
  assert.ok(ev.some(e => e.kind === 'shush' && e.id === 7 && e.why === 'loud'));
  const L2 = new Library.Librarian({grid: g, desk: [18, 8]}), q = {id: 8, x: 2, s: 2, inside: true, running: true, loud: false};
  L2.step(1 / 30, [q]);assert.strictEqual(L2.state, 'chase');q.inside = false;
  const e2 = L2.step(1 / 30, [q]);assert.ok(e2.some(e => e.kind === 'gone'));assert.strictEqual(L2.state, 'return');
});

test('Moby-Dick opens on "Call me Ishmael."', () => {
  assert.ok(Library.MOBY.text[0].startsWith('Call me Ishmael.'));
  assert.strictEqual(Library.MOBY.chapter, 'CHAPTER 1. Loomings.');
});

// ---------- Table tennis ----------
test('table tennis: two serves each, one each from 10–10, and a game is won by two', () => {
  const m = new TT.Match('you'), order = [];
  for (let i = 0; i < 20; i++) {order.push(m.server);m.point(i % 2 ? 'you' : 'npc');}
  assert.deepStrictEqual(order.slice(0, 6), ['you', 'you', 'npc', 'npc', 'you', 'you']);
  assert.deepStrictEqual(m.score, {you: 10, npc: 10});
  const deuce = [];for (let i = 0; i < 4; i++) {deuce.push(m.server);m.point(i % 2 ? 'npc' : 'you');}
  assert.notStrictEqual(deuce[0], deuce[1]);assert.notStrictEqual(deuce[1], deuce[2]);
  assert.strictEqual(m.winner, null);m.point('you');assert.strictEqual(m.winner, null);m.point('you');assert.strictEqual(m.winner, 'you');
});

test('table tennis: the serve bounces on your side, then on the other; a ball into the net loses the point', () => {
  const {TABLE, Rally} = TT;
  for (const who of ['you', 'npc']) {
    const dir = who === 'you' ? 1 : -1;
    for (let i = 0; i < 40; i++) {
      const r = new Rally(who), p = {u: -dir * (TABLE.L / 2 + .25), y: TABLE.H + .3, v: (i / 40 - .5)};r.ball = {...p, vu: 0, vy: 0, vv: 0};
      r.hit(who, TT.serveShot(p, {u: -dir * .9, v: p.v * .6}, 0));
      const order = [];for (let t = 0; t < 3 && !r.over; t += 1 / 240) for (const e of r.step(1 / 240)) if (e.kind === 'bounce') order.push(e.side);
      assert.deepStrictEqual(order.slice(0, 2), [who, who === 'you' ? 'npc' : 'you'], `serve ${i}: ${order}`);
    }
  }
  const r = new Rally('you');r.ball = {u: -1, y: TABLE.H + .1, v: 0, vu: 0, vy: 0, vv: 0};r.hit('you', {vu: 6, vy: 0, vv: 0});
  let over = null;for (let t = 0; t < 1 && !over; t += 1 / 240) for (const e of r.step(1 / 240)) if (e.kind === 'over') over = e;
  assert.ok(over && over.loser === 'you' && /net/.test(over.why));
});

// ---------- Rathkes gate 1 ----------
test('Rathkes gate 1: the passage splits the building into two parts and leaves the gap free', () => {
  const ring = [[-835.6, 1794], [-834.6, 1795.7], [-832.1, 1794.3], [-832.9, 1792.8], [-829.5, 1790.8], [-835.1, 1781.6], [-853.8, 1791.8], [-854.9, 1795.3], [-845.5, 1811.7], [-835.7, 1805.9], [-837.8, 1802.3], [-836.5, 1801.5], [-837.8, 1799.3], [-839.1, 1800.2], [-840.9, 1797.2]];
  const area = r => Math.abs(r.reduce((s, p, i) => {const q = r[(i + 1) % r.length];return s + p[0] * q[1] - q[0] * p[1];}, 0) / 2);
  const P = Rathkes.DATA.passage, parts = Rathkes.split(ring, P.from, P.to, P.width);
  assert.strictEqual(parts.length, 2);
  const lost = area(ring) - parts.reduce((s, r) => s + area(r), 0);assert.ok(lost > 20 && lost < 50, `passage area ${lost}`);
  const mid = [(P.from[0] + P.to[0]) / 2, (P.from[1] + P.to[1]) / 2];
  const inside = (p, r) => {let o = false;for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[i], b = r[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) o = !o;}return o;};
  assert.ok(inside(mid, ring) && !parts.some(r => inside(mid, r)), 'the middle of the passage is open');
  const d = {buildings: [{id: Rathkes.DATA.osm, ring, h: 18.2, style: 'brick', hip: null, tile: 3}, {id: 'w1', ring: [[0, 0], [1, 0], [1, 1]], h: 5}]};
  // The passage leaves two parts; the part with the side wing loses the piece that flat 501's model draws itself (issue #72).
  assert.strictEqual(Rathkes.prepare([d]), 1);assert.deepStrictEqual(d.buildings.map(b => b.id), ['w113875904-0', 'w113875904-1', 'w113875904-2', 'w113875904-3', 'w1']);
});

test('the library replaces its OSM building and keeps trees out of the hall and the table-tennis pad', () => {
  const d = {buildings: [{id: Library.OSM_ID, ring: Library.RING}, {id: 'w2', ring: []}], trees: [{x: -916, s: 1730}, {x: -901, s: 1771}, {x: -950, s: 1790}]};
  assert.strictEqual(Library.prepare([d]), 1);
  assert.deepStrictEqual(d.buildings.map(b => b.id), ['w2']);assert.deepStrictEqual(d.trees, [{x: -950, s: 1790}]);
});
