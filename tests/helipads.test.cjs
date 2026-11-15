// More helicopters around the map (issue #126): where game-helipads.js puts the pads.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
window.DISTRICTS = [];
for (const f of ['surroundings-data.js', 'gamle-oslo-data.js', 'myrens-data.js', 'loren-data.js', 'okern-data.js']) require('../' + f);
const District = require('../district.js'), HP = require('../game-helipads.js');
const D = window.SURROUNDINGS, DS = window.DISTRICTS.map(d => District.decode(d)).filter(d => d.name !== 'mollergata');
const areas = [...D.areas, ...DS.flatMap(d => d.areas)], water = [...areas.filter(a => a.k === 'water').map(a => a.o), ...DS.flatMap(d => d.sea)];

test('ten targets, spread over the city and away from the helicopter by Haarklous plass', () => {
  assert.equal(HP.TARGETS.length, 10);
  for (const t of HP.TARGETS) assert.ok(Math.hypot(t.x, t.s) > 400, `${t.area} is too close to Haarklous plass`);
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const a = HP.TARGETS[i], b = HP.TARGETS[j];assert.ok(Math.hypot(a.x - b.x, a.s - b.s) > 400, `${a.area} and ${b.area} are too close`);
  }
});

test('on the real map every target gets a pad on grass, away from water and the edge of the lawn', () => {
  const pads = HP.plan({areas, water});
  assert.equal(pads.length, 10);
  for (const p of pads) {
    const t = HP.TARGETS.find(q => q.area === p.area);
    assert.ok(Math.hypot(p.x - t.x, p.s - t.s) <= HP.REACH, `${p.area} is ${Math.round(Math.hypot(p.x - t.x, p.s - t.s))} m from its target`);
    assert.ok(areas.some(a => ['grass', 'pitch'].includes(a.k) && HP.inPoly(p.x, p.s, a.o)), `${p.area} is not on grass`);
    assert.ok(!water.some(o => HP.inPoly(p.x, p.s, o)), `${p.area} is in water`);
  }
});

test('the game\'s own check and the kept-free circles move a pad, and the result is the same every time', () => {
  const t = HP.TARGETS[0], blocked = (x, s) => Math.hypot(x - t.x, s - t.s) > 20;
  const a = HP.plan({areas, water, ok: blocked}), b = HP.plan({areas, water, ok: blocked});
  assert.deepEqual(a, b);
  assert.ok(Math.hypot(a[0].x - t.x, a[0].s - t.s) > 20);
  const c = HP.plan({areas, water, clear: [{x: t.x, s: t.s, r: 40}]});
  assert.ok(Math.hypot(c[0].x - t.x, c[0].s - t.s) >= 40);
  assert.equal(HP.plan({areas, water, ok: () => false}).length, 0);
});
