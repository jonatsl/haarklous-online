// The Gamle Oslo / Ensjø district patch (issue #38): its data meets the old world, covers what the user asked for, and the
// Ensjø -> Rathkes gate run starts and ends on open ground.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
global.window = globalThis;
require(path.join(__dirname, '..', 'surroundings-data.js'));
require(path.join(__dirname, '..', 'gamle-oslo-data.js'));
const District = require(path.join(__dirname, '..', 'district.js'));
const D = window.SURROUNDINGS, raw = window.DISTRICTS.find(d => d.name === 'gamle-oslo'), d = District.decode(raw);
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const inside = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
const segDist = (p, a, b) => {const dx = b[0] - a[0], ds = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / (dx * dx + ds * ds || 1)));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
const oldGrid = (() => {const b = Buffer.from(D.terrain.dm, 'base64');return new Int16Array(b.buffer, b.byteOffset, D.terrain.n * D.terrain.n);})();

test('the old world is unchanged, so vehicle numbers and places online stay the same', () => {
  assert.strictEqual(D.buildings.length, 1040);
  assert.strictEqual(D.roads.length, 1057);
  assert.strictEqual(D.terrain.half, 800);
});

test('the district ground meets the old ±800 m grid exactly and stays continuous', () => {
  const n = D.terrain.n;
  for (let x = -800; x <= 800; x += 8) {
    const old = oldGrid[((800 + 800) / 4) * n + (x + 800) / 4] / 10;
    assert.ok(Math.abs(District.height(d, x, 800) - old) < 1e-3, `seam at x ${x}`);
  }
  // Real ground: Torshov 85 m, Ensjø about 59 m, Rathkes gate about 16 m and the fjord at sea level (relative to the door).
  assert.ok(Math.abs(District.height(d, 620, 2522) + 25.6) < 2, 'Ensjø');
  assert.ok(Math.abs(District.height(d, -738, 1720) + 69.4) < 2, 'Rathkes gate');
  assert.ok(Math.abs(District.height(d, -1450, 3600) - d.seaRel) < .5, 'Bjørvika water');
  let steepest = 0;
  for (let j = 0; j < d.ns; j++) for (let i = 1; i < d.nx; i++) steepest = Math.max(steepest, Math.abs(d.h[j * d.nx + i] - d.h[j * d.nx + i - 1]));
  // Real cliffs (Kampen's rock face above Tøyen, the Akerselva ravine) reach about 17 m per 8 m; a data glitch would be far more.
  assert.ok(steepest < 22, `no step over 22 m between 8 m grid points (got ${steepest.toFixed(1)})`);
});

test('buildings: thousands of real footprints, none doubling an old building, key buildings modelled', () => {
  assert.ok(d.buildings.length > 7000, `${d.buildings.length} buildings`);
  for (const b of d.buildings) {
    const c = b.ring.reduce((a, p) => [a[0] + p[0] / b.ring.length, a[1] + p[1] / b.ring.length], [0, 0]);
    if (Math.abs(c[0]) > 820 || Math.abs(c[1]) > 820) continue;
    assert.ok(!D.buildings.some(o => inside(c, pairs(o.r.o))), `district building ${b.id} inside an old building`);
  }
  const names = d.landmarks.map(l => l.name);
  for (const n of ['Sofienberg kirke', 'Paulus kirke', 'Kampen kirke', 'Vålerenga kirke', 'Grønland kirke', 'Gamlebyen kirke', 'MUNCH', 'Operahuset']) assert.ok(names.includes(n), n);
  for (const l of d.landmarks) assert.ok(!d.buildings.some(b => inside(l.c, b.ring)), `${l.name} is not also a plain building`);
  assert.ok(d.chimneys.some(([x, s, h]) => h >= 50), 'Freiapipa');
});

test('Trondheimsveien has buildings along it all the way from Carl Berner to Schous plass (the user\'s minimum)', () => {
  const lines = d.roads.filter(r => r.n === 'Trondheimsveien').map(r => pairs(r.p));
  assert.ok(lines.length > 0);
  let checked = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < L; t += 100) {
      const p = [a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L];
      if (p[1] < 820 || !District.covers(d, ...p)) continue;// north of here the old world has them
      checked++;
      const near = d.buildings.some(bd => bd.ring.some((q, k) => segDist(p, q, bd.ring[(k + 1) % bd.ring.length]) < 45));
      assert.ok(near, `a building within 45 m of Trondheimsveien at (${p.map(Math.round)})`);
    }
  }
  assert.ok(checked > 10, `${checked} points checked`);
});

test('the Ensjø -> Rathkes gate run starts and ends on open, walkable ground', () => {
  const r = d.route, ensjo = d.stations.find(s => s.name === 'Ensjø');
  assert.ok(r && ensjo);
  assert.ok(Math.hypot(r.start.at[0] - ensjo.x, r.start.at[1] - ensjo.s) < 40, 'start beside Ensjø T-bane');
  assert.ok(d.roads.some(x => x.n === 'Rathkes gate' && pairs(x.p).some((q, k, a) => k && segDist(r.finish.at, a[k - 1], q) < 6)), 'finish on Rathkes gate');
  for (const p of [r.start.at, r.finish.at]) {
    assert.ok(p[0] > d.play.x0 && p[0] < d.play.x1 && p[1] > d.play.s0 && p[1] < d.play.s1, 'inside the walkable rectangle');
    assert.ok(!d.buildings.some(b => Math.hypot(b.ring[0][0] - p[0], b.ring[0][1] - p[1]) < 400 && inside(p, b.ring)), 'not inside a building');
    assert.ok(!d.sea.some(s => inside(p, pairs(s))), 'not in the sea');
  }
  const crow = Math.hypot(r.start.at[0] - r.finish.at[0], r.start.at[1] - r.finish.at[1]);
  assert.ok(crow > 1300 && crow < 1700, `about 1.5 km as the crow flies (${Math.round(crow)} m)`);
});

test('neighbourhood names for the map and photos', () => {
  const names = d.places.map(p => p.name);
  for (const n of ['Ensjø', 'Gamlebyen', 'Kampen', 'Vålerenga', 'Tøyen', 'Grønland', 'Carl Berner']) assert.ok(names.includes(n), n);
});

test('District.flatten lowers the ground under a footprint and nowhere else', () => {
  const copy = District.decode(raw), poly = [[0, 1500], [40, 1500], [40, 1530], [0, 1530]], low = District.height(copy, 20, 1515) - 3;
  const far = District.height(copy, 200, 1515), n = District.flatten(copy, poly, low);
  assert.ok(n > 0);
  assert.ok(District.height(copy, 20, 1515) <= low + 1e-6);
  assert.strictEqual(District.height(copy, 200, 1515), far);
});
