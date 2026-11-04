// Akerselva's water is visible (issue #63): the water surface faces up, and the drawn ground stays under it along the whole river.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
global.window = globalThis;
for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'akerselva-data.js']) require(path.join(__dirname, '..', f));
const District = require(path.join(__dirname, '..', 'district.js'));
const Kayak = require(path.join(__dirname, '..', 'game-kayak.js'));
const A = window.AKERSELVA;

// Normal of each triangle in three.js coordinates (x, y up, z): (B - A) x (C - A).
function normalsY(pos, idx) {
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map(k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    out.push(u[2] * v[0] - u[0] * v[2]);
  }
  return out;
}

test('the water surface faces up, so the camera does not cull it (it faced down before issue #63)', () => {
  const R = Kayak.river(A), turn = .37, rot = (x, s) => ({x: x * Math.cos(turn) + s * Math.sin(turn), z: -x * Math.sin(turn) + s * Math.cos(turn)});
  for (const [opts, toW] of [[{widen: 1.5}, undefined], [{widen: -.3, lift: .08}, rot], [{widen: 1.5, cols: 3, every: 2}, rot]]) {
    const {pos, idx} = Kayak.waterStrip(R, 0, R.n - 1, opts, toW);
    assert.ok(idx.length > 1000);
    // (A few empty triangles where the strip narrows at the very end are allowed: they draw nothing.)
    const ys = normalsY(pos, idx), down = ys.filter(y => y < -1e-6).length;
    assert.strictEqual(down, 0, `${down} of ${ys.length} triangles face down`);
    assert.ok(ys.filter(y => y > 0).length > ys.length - 10);
  }
});

test('sinkGrid lowers only what holds the drawn ground above the water, never raises, never below the bed', () => {
  // A 4 m grid 2 m above a straight stretch of water 6 m wide along s = 20 (level 0).
  const N = 21, flat = () => new Float64Array(N * N).fill(2), samples = [];
  for (let x = 10; x <= 70; x += 1) for (const s of [17, 18.5, 20, 21.5, 23]) samples.push({x, s, top: -.08, floor: -.7});
  let h = flat();const grid = {x0: 0, s0: 0, step: 4, nx: N, ns: N, get: k => h[k], set: (k, v) => {h[k] = v;}};
  const r = Kayak.sinkGrid(grid, samples);
  assert.strictEqual(r.dry, 0);assert.ok(r.changed > 0);
  for (const p of samples) {const w = Kayak.cellWeights(grid, p.x, p.s), y = w.reduce((a, [k, f]) => a + h[k] * f, 0);assert.ok(y <= p.top + 1e-6, `ground ${y} at ${p.x}, ${p.s}`);}
  for (let k = 0; k < h.length; k++) assert.ok(h[k] <= 2 && h[k] >= -.7 - 1e-9);
  // Only corners of cells the water touches move (s 16..24, x 8..72).
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (j < 4 || j > 6 || i < 2 || i > 18) assert.strictEqual(h[j * N + i], 2, `corner ${i}, ${j}`);
  // A protected corner on the water line stays, and the samples it holds up are reported dry.
  h = flat();const kept = 5 * N + 10, r2 = Kayak.sinkGrid(grid, samples, k => k === kept);
  assert.strictEqual(h[kept], 2);assert.ok(r2.dry > 0 && r2.dry < 40, `dry ${r2.dry}`);
});

test('with the real map data, the drawn ground is under the water along all of Akerselva, and walls reach down', () => {
  const D = JSON.parse(JSON.stringify(window.SURROUNDINGS)), before = Buffer.from(D.terrain.dm, 'base64');
  const Ds = window.DISTRICTS.map(d => District.decode(d)), hBefore = Ds.map(d => Float64Array.from(d.h));
  const r = Kayak.prepare(Ds, D, A);
  assert.strictEqual(r.dry, 0, `${r.dry} water samples still under the ground`);assert.ok(r.changed > 1000 && r.walls > 0);
  // Rebuild the drawn ground independently: the old 4 m grid out to ±760 m, the 8 m patch grids beyond (old-grid values inside ±800 m).
  const T = D.terrain, b = Buffer.from(T.dm, 'base64'), dm = new Int16Array(b.buffer, b.byteOffset, T.n * T.n), dm0 = new Int16Array(before.buffer, before.byteOffset, T.n * T.n);
  const oldAt = (x, s) => dm[((s + 800) / 4) * T.n + (x + 800) / 4] / 10;
  const rel = (d, x, s) => Math.abs(x) <= 800 && Math.abs(s) <= 800 ? oldAt(x, s) : d.h[((s - d.s0) / d.step) * d.nx + (x - d.x0) / d.step];
  const tri = (x, s, x0, s0, st, f) => {
    const fi = (x - x0) / st, fj = (s - s0) / st, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, X = x0 + i * st, S = s0 + j * st;
    const a = f(X, S), bb = f(X + st, S), c = f(X, S + st), e = f(X + st, S + st);
    return u + v <= 1 ? a + (bb - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (bb - e) * (1 - v);
  };
  const drawn = (x, s) => {
    if (Math.abs(x) <= 760 && Math.abs(s) <= 760) return tri(x, s, -800, -800, 4, oldAt);
    const d = Ds.find(q => District.covers(q, x, s));return d ? tri(x, s, d.x0, d.s0, d.step, (X, S) => rel(d, X, S)) : null;
  };
  const R = Kayak.river(A);let n = 0, dry = 0;
  for (let t = 0; t <= R.length; t += .7) {
    const c = R.at(t);
    for (let f = -1; f <= 1.001; f += .1) {const off = f < 0 ? f * c.wl : f * c.wr, y = drawn(c.x - c.ds * off, c.s + c.dx * off);if (y === null) continue;n++;if (y > c.level + .03) dry++;}
  }
  assert.ok(n > 100000);assert.strictEqual(dry, 0, `${dry} of ${n} points of the water have ground over them`);
  // Only ground near the river changed, and nothing was raised.
  for (let k = 0; k < dm.length; k++) {
    assert.ok(dm[k] <= dm0[k]);
    if (dm[k] < dm0[k]) {const x = -800 + (k % T.n) * 4, s = -800 + Math.floor(k / T.n) * 4, L = R.locate(x, s);assert.ok(L.d < Math.max(L.c.wl, L.c.wr) + 12, `old grid lowered ${L.d.toFixed(0)} m from the river at ${x}, ${s}`);}
  }
  Ds.forEach((d, i) => {for (let k = 0; k < d.h.length; k++) assert.ok(d.h[k] <= hBefore[i][k] + 1e-9);});
  // Buildings whose walls stand on lowered ground reach down to it (their lowest ground, gm).
  for (const d of Ds) for (const bd of d.buildings) if (bd.gm !== undefined) {
    for (const p of bd.ring) {const y = drawn(p[0], p[1]);if (y !== null) assert.ok(bd.gm <= y + 1e-6, `${bd.id} stands above the ground`);}
  }
});
