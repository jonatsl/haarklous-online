// Flat streets with clear edges (issue #112): the car streets are smooth along and flat across, pavements stand a kerb above
// the road, and the drawn ground is the ground you stand on. Measured on real streets in every map patch
// (tools/road-roughness.cjs prints the full before / now table).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../tools/road-roughness.cjs');
const L = R.load(), S = L.surface;

// Limits for the sample streets (the raw height grids gave rms2 1.7–19 mm, cross-fall 0.5–5.4 %, a car at 40 km/h 1.1–6.2 m/s²).
const LIMIT = {rms2: 4.5, cross: 1, wobble: .25, acc40: 1.5, acc60: 2.5};

test('sample streets in every patch: smooth along, flat across, a calm ride (and better than the raw ground)', () => {
  const seen = new Set();
  for (const st of R.STREETS) {
    const c = R.pick(L, st.name, st.where);assert.ok(c, `${st.name} found in ${st.where}`);seen.add(st.where);
    const m = R.measure(S.height, c), b = R.measure(L.natural, c), r4 = R.ride(S.height, c, 40), r6 = R.ride(S.height, c, 60), b4 = R.ride(L.natural, c, 40);
    const what = `${st.name}: rms2 ${m.rms2.toFixed(1)} mm (raw ${b.rms2.toFixed(1)}), cross ${m.cross.toFixed(2)} %, wobble ${m.wobble.toFixed(2)}, car ${r4.acc.toFixed(2)} / ${r6.acc.toFixed(2)} m/s²`;
    assert.ok(m.rms2 <= LIMIT.rms2, what);
    assert.ok(m.cross <= LIMIT.cross, what);
    assert.ok(m.wobble <= LIMIT.wobble, what);
    assert.ok(r4.acc <= LIMIT.acc40 && r6.acc <= LIMIT.acc60, what);
    assert.equal(r4.air, 0, `${what}: no hops at 40 km/h`);
    assert.ok(m.rms2 <= b.rms2 + .1 && r4.acc <= b4.acc + .05, `${what}: not rougher than the raw ground`);
    // The street still follows the real hill: the climb over the stretch is within 1.5 m of the raw ground's.
    assert.ok(Math.abs(m.rise - b.rise) < 1.5, `${what}: rise ${m.rise.toFixed(2)} vs raw ${b.rise.toFixed(2)}`);
  }
  for (const p of ['square', 'gamle-oslo', 'loren', 'okern', 'myrens']) assert.ok(seen.has(p), `a sample street in ${p}`);
});

test('a pavement stands one kerb (12 cm) above the road, on both sides', () => {
  let checked = 0;
  for (const st of R.STREETS) {
    const c = R.pick(L, st.name, st.where);if (!c.sw) continue;
    for (let f = .2; f <= .8; f += .2) {
      const t = c.L * f, p = R.along(c, t);
      for (const side of [1, -1]) {
        const at = y => [p.x - p.fs * y * side, p.s + p.fx * y * side];
        const [ix, is] = at(c.hw - .08), [ox, os] = at(c.hw + .08);
        if (S.classAt(ix, is) !== S.C.ROAD || S.classAt(ox, os) === S.C.ROAD) continue;// a side street or a driveway here
        const step = S.height(ox, os) - S.height(ix, is);
        assert.ok(Math.abs(step - S.KERB_H) < .015, `${st.name} t ${t.toFixed(0)} side ${side}: kerb ${(step * 100).toFixed(1)} cm`);checked++;
      }
    }
  }
  assert.ok(checked > 40, `${checked} kerbs checked`);
});

test('the drawn ground is the ground you stand on (a tile in each grid, random points on every triangle)', () => {
  let worst = 0, n = 0, rnd = 3;const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (const [x0, s0] of [[-620, 60], [-300, 0], [-990, 760], [1060, -130], [2000, 1220]]) {
    const g = L.W.gridFor(x0, s0), i = Math.floor((x0 - g.x0) / g.step), j = Math.floor((s0 - g.s0) / g.step), m = S.tile(g, i - 4, j - 4, i + 4, j + 4);
    for (let q = 0; q < m.index.length; q += 3) {
      const P = k => [m.pos[k * 3], m.pos[k * 3 + 1], m.pos[k * 3 + 2]], A = P(m.index[q]), B = P(m.index[q + 1]), C = P(m.index[q + 2]);
      const up = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);if (up < 1e-4) continue;// faces (kerbs) and slivers
      for (let r = 0; r < 4; r++) {
        let u = rand(), v = rand();if (u + v > 1) {u = 1 - u;v = 1 - v;}
        const x = A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]), s = A[2] + u * (B[2] - A[2]) + v * (C[2] - A[2]), y = A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1]);
        const e = Math.abs(S.height(x, s) - y);n++;
        // within 2 cm of a kerb line a point may land on either side of it
        if (e > .005) {const k = Math.abs(S.height(x + .02, s) - S.height(x - .02, s)) + Math.abs(S.height(x, s + .02) - S.height(x, s - .02));if (k > .05) continue;}
        worst = Math.max(worst, e);
      }
    }
  }
  assert.ok(n > 2000, `${n} points`);
  assert.ok(worst < .005, `mesh and height differ by up to ${(worst * 1000).toFixed(1)} mm`);
});

test('ground that is not street keeps the real terrain a few metres away from streets', () => {
  // A park lawn far from any street (Torshovdalen) and the river bed under a bridge keep the real ground.
  for (const [x, s] of [[60, 160], [-30, 220]]) assert.ok(Math.abs(S.height(x, s) - L.natural(x, s)) < .02, `${x}, ${s}`);
  // No street is lifted into a dam or sunk into a trench: within 1.6 m of the real ground everywhere along every sample street.
  for (const st of R.STREETS) {const c = R.pick(L, st.name, st.where);for (let t = 5; t < c.L - 5; t += 3) {const p = R.along(c, t);assert.ok(Math.abs(S.height(p.x, p.s) - L.natural(p.x, p.s)) < 1.6, `${st.name} t ${t}`);}}
});
