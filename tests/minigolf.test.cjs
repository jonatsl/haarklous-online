// Minigolf (issue #114): ball physics, the cup, walls, slopes, the obstacles, scoring, the bar's serving rules and the courses'
// places (every lane inside its real outline, apart from the others, clear of roads and buildings).
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.atob = globalThis.atob || (s => Buffer.from(s, 'base64').toString('binary'));
const M = require('../game-minigolf.js');
const DATA = require('../minigolf-data.js');
require('../surroundings-data.js');
const District = require('../district.js');
require('../gamle-oslo-data.js');
require('../mollergata-data.js');
const D = window.SURROUNDINGS, patches = window.DISTRICTS.map(r => District.decode(r));
const hole = (kind, L = 5.6, W = 1.25, surface = 'eternit') => M.compile(M.holeDef(kind, L, W), surface);
const aimAt = (b, p) => Math.atan2(p[1] - b.v, p[0] - b.u);
const run = (h, angle, power, t0 = 0) => {const b = M.newBall(h);M.putt(b, angle, power);const r = M.simulate(b, h, {t0});return {b, ...r};};

test('a straight putt at the right speed holes out', () => {
  const h = hole('straight'), b0 = M.newBall(h), a = aimAt(b0, h.cup);
  const powers = [];for (let p = .4; p <= .8; p += .01) powers.push(+p.toFixed(2));
  const holed = powers.filter(p => run(h, a, p).b.holed);
  assert.ok(holed.length >= 4, `holed with ${holed}`);
  const r = run(h, a, holed[Math.floor(holed.length / 2)]);assert.ok(r.events.some(e => e.kind === 'cup'));
});

test('too fast a putt lips out or jumps the cup, a slow one stops short', () => {
  const h = hole('straight'), a = aimAt(M.newBall(h), h.cup), fast = run(h, a, 1);
  assert.equal(fast.b.holed, false);assert.ok(fast.events.some(e => e.kind === 'lip'), 'a lip-out at full speed');
  const slow = run(h, a, .05);assert.equal(slow.b.holed, false);assert.ok(slow.b.u < h.cup[0] - .5, `stopped at u ${slow.b.u.toFixed(2)}`);
  // Speed limit: straight over the middle drops below V_CAP and not well above it.
  const over = (sp) => {const b = {...M.newBall(h), u: h.cup[0] - .3, v: 0, vu: sp, vv: 0, moving: true, lie: [0, 0]};M.simulate(b, h);return b.holed;};
  assert.equal(over(1.0), true);assert.equal(over(2.6), false);
});

test('a wall bounces the ball back at the mirrored angle, with some speed lost', () => {
  const h = hole('straight'), b = {...M.newBall(h), u: 2, v: .3, vu: 1, vv: 1, moving: true, lie: [2, .3]};
  let t = 0;while (b.vv > 0 && t < 2) {M.step(b, h, t, M.SUB);t += M.SUB;}
  assert.ok(b.vv < 0, 'bounced off the side wall');
  const inAngle = Math.PI / 4, outAngle = Math.atan2(-b.vv, b.vu);
  assert.ok(Math.abs(outAngle - Math.atan(.72 / .94)) < .06, `out ${outAngle.toFixed(3)} rad (in ${inAngle.toFixed(3)})`);
  assert.ok(Math.hypot(b.vu, b.vv) < Math.SQRT2 * .95, 'lost speed');
});

test('slopes: a ball left on the tilted lane rolls down; the bowl pulls toward the cup; a ramp needs speed', () => {
  // The slope lane rises toward +v: a ball rolled straight along it curves down toward -v.
  const s = hole('slope'), b = {...M.newBall(s), u: 1, v: .3, vu: 1.6, vv: 0, moving: true};
  for (let i = 0; i < 480; i++) M.step(b, s, i * M.SUB, M.SUB);
  assert.ok(b.v < .3 - .05 && b.vv < 0, `curved downhill to v ${b.v.toFixed(2)}`);
  // A steeper ramp (20 cm over 2 m) starts a ball left on it rolling back down.
  const ramp = hole('uphill'), r = {...M.newBall(ramp), u: ramp.L * .53, v: 0, moving: true};M.simulate(r, ramp);
  assert.ok(r.u < ramp.L * .4, `rolled back down to u ${r.u.toFixed(2)}`);
  const bw = hole('bowl'), c = {...M.newBall(bw), u: bw.cup[0] - .35, v: .1, moving: true};M.simulate(c, bw);
  assert.ok(Math.hypot(c.u - bw.cup[0], c.v - bw.cup[1]) < .35 || c.holed, 'the bowl pulls the ball in');
  const up = hole('uphill'), a = aimAt(M.newBall(up), up.cup), weak = run(up, a, .25);
  assert.ok(!weak.b.holed && weak.b.u < up.L * .5, `rolled back to u ${weak.b.u.toFixed(2)}`);
});

test('the loop needs speed, the windmill blocks part of the time, water costs a stroke', () => {
  const lp = hole('loop'), a = aimAt(M.newBall(lp), [lp.loops[0].u, 0]);
  const slow = run(lp, a, .45), fast = run(lp, a, .95);
  assert.ok(slow.events.some(e => e.kind === 'loopFail') && !slow.events.some(e => e.kind === 'loop'), 'too slow rolls back');
  assert.ok(fast.events.some(e => e.kind === 'loop'), 'fast enough goes round');assert.ok(fast.b.u > lp.loops[0].u);
  const m = hole('windmill').mills[0];let blocked = 0, n = 0;for (let t = 0; t < m.period; t += .01, n++) if (M.millBlocked(m, t)) blocked++;
  const pc = blocked / n * 100;assert.ok(pc > 25 && pc < 50, `blocked ${pc.toFixed(0)} % of the time`);
  const br = hole('bridge'), b = {...M.newBall(br), u: br.L * .45, v: 0, vu: 0, vv: 1, moving: true, lie: [.45, 0]};
  const r = M.simulate(b, br);assert.ok(r.events.some(e => e.kind === 'water'));assert.deepEqual([b.u, b.v], [.45, 0]);
});

test('every hole can be played: a simple player holes each lane within par + 2', () => {
  // Every kind on the outdoor lane; the ones where speed matters most also on the shorter indoor felt lane. (Oslo Camping's
  // themed kinds share their physics with tube, windmill, volcano and bridge.)
  const themed = ['tent', 'caravan', 'campfire', 'canoe'], plain = Object.keys(M.KINDS).filter(k => !themed.includes(k));
  for (const [L, W, surface, kinds] of [[5.6, 1.25, 'eternit', plain], [4.0, .9, 'felt', ['loop', 'volcano', 'windmill', 'bridge', 'uphill', 'lightning']]]) {
    for (const kind of kinds) {
      const h = hole(kind, L, W, surface), b = M.newBall(h);let strokes = 0, t = 0;
      while (!b.holed && strokes < 4) {
        let best = null;
        const base = aimAt(b, h.cup);
        for (let i = -6; i <= 6; i++) for (let k = 1; k <= 10; k++) {
          const tb = {...b, lie: b.lie.slice()};M.putt(tb, base + i * .07, k / 10);M.simulate(tb, h, {t0: t, maxT: 10});
          const d = tb.holed ? -1 : Math.hypot(tb.u - h.cup[0], tb.v - h.cup[1]);
          if (!best || d < best.d) best = {d, a: base + i * .07, p: k / 10};
        }
        M.putt(b, best.a, best.p);t = M.simulate(b, h, {t0: t}).t;strokes++;
      }
      assert.ok(b.holed, `${kind} (${L} m) not holed in ${strokes}`);
    }
  }
});

test('scorecard: at most 7 per hole, totals against par', () => {
  const c = new M.Scorecard([2, 3, 2]);
  assert.equal(c.write(0, 1), 1);assert.equal(c.write(1, 9), 7);assert.equal(c.write(2, 6, false), 7);
  assert.equal(c.total, 15);assert.equal(c.par, 7);assert.equal(c.vsPar, 8);assert.equal(c.complete, true);
  assert.equal(M.Scorecard.over(6, false), true);assert.equal(M.Scorecard.over(5, false), false);assert.equal(M.Scorecard.over(2, true), true);
  const d = new M.Scorecard([2, 2]);d.write(0, 2);assert.equal(d.vsPar, 0);assert.equal(d.played, 1);assert.equal(d.complete, false);
  assert.equal(M.scoreName(1, 2), 'Hole in one!');assert.equal(M.scoreName(3, 2), 'Bogey');
});

test("the bar's serving rules: the law's hours, the bar's hours and no drinks for the obviously drunk", () => {
  const camp = DATA.courses.find(c => c.kind === 'bar'), at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi);
  const beer = M.BAR_MENU.find(i => i.id === 'pils'), shot = M.BAR_MENU.find(i => i.id === 'shot'), soda = M.BAR_MENU.find(i => i.id === 'brus');
  const o = {open: camp.open};
  assert.deepEqual(M.serving(at(2026, 11, 13, 23), beer, o), {ok: true});// Friday night
  assert.deepEqual(M.serving(at(2026, 11, 14, 1, 15), beer, o), {ok: true});// Saturday 01:15 – Friday's night is still open
  assert.equal(M.serving(at(2026, 11, 15, 2), beer, o).why, 'closed');// Sunday 02:00, the bar closed at 01:30
  assert.equal(M.serving(at(2026, 11, 18, 12), beer, o).why, 'closed');// Wednesday noon, opens at 13
  assert.deepEqual(M.serving(at(2026, 11, 14, 12, 30), beer, o), {ok: true});// Saturday 12:30 beer
  assert.equal(M.serving(at(2026, 11, 14, 12, 30), shot, o).why, 'hours');// spirits only from 13:00
  assert.equal(M.serving(at(2026, 11, 14, 4), beer, {}).why, 'hours');// nobody serves 03:00–06:00
  assert.equal(M.serving(at(2026, 11, 13, 20), beer, {...o, drunk: 75}).why, 'drunk');
  assert.deepEqual(M.serving(at(2026, 11, 13, 20), soda, {...o, drunk: 75}), {ok: true});
});

// ---------- The courses' places ----------
const pairs = f => {const o = [];for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]);return o;};
const segDist = (p, a, b) => {const dx = b[0] - a[0], ds = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * ds) / (dx * dx + ds * ds || 1)));return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * ds);};
const polyDist = (P, Q) => {let m = Infinity;for (const p of P) for (let i = 0; i < Q.length; i++) m = Math.min(m, segDist(p, Q[i], Q[(i + 1) % Q.length]));for (const q of Q) for (let i = 0; i < P.length; i++) m = Math.min(m, segDist(q, P[i], P[(i + 1) % P.length]));return m;};
const overlaps = (P, Q) => P.some(p => M.insidePoly(p, Q)) || Q.some(q => M.insidePoly(q, P));

test('the courses are at their real OSM places, every lane inside its outline and apart from the others', () => {
  const lat0 = D.origin.lat, lon0 = D.origin.lon, kx = 111320 * Math.cos(lat0 * Math.PI / 180), loc = (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * 111320];
  const near = (c, lat, lon, r) => {const p = loc(lat, lon), q = c.outline || c.fredshuset;return M.insidePoly(p, q) || Math.min(...q.map(v => Math.hypot(v[0] - p[0], v[1] - p[1]))) < r;};
  const by = id => DATA.courses.find(c => c.id === id);
  assert.ok(near(by('torshov'), 59.9339745, 10.7688149, 1), 'Torshov (way 72563100 centre)');
  assert.ok(near(by('grunerlokka'), 59.9184362, 10.758794, 1), 'Grünerløkka (way 44044598 centre)');
  assert.ok(near(by('jordal'), 59.9085409, 10.7845584, 1), 'Jordal park (way 1297710953 centre)');
  assert.ok(M.insidePoly(loc(59.914558, 10.747328), by('oslo-camping').fredshuset), 'Oslo Camping (node 4958723297) is inside Fredshuset');
  for (const c of DATA.courses.filter(c => c.rows)) {
    const lanes = M.courseLanes(c);
    assert.equal(lanes.length, c.holes);assert.equal(c.order.length, c.holes);assert.equal(c.pars.length, c.holes);
    lanes.forEach(l => {
      assert.ok(M.laneCorners(l, .3).every(p => M.insidePoly(p, c.outline)), `${c.id} lane ${l.n} inside the outline`);
      if (c.kiosk) assert.ok(!overlaps(M.laneCorners(l, .4), c.kiosk), `${c.id} lane ${l.n} clear of the kiosk`);
    });
    for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) assert.ok(polyDist(M.laneCorners(lanes[i]), M.laneCorners(lanes[j])) > .45, `${c.id} lanes ${i + 1} and ${j + 1} apart`);
  }
});

test('no building and no road crosses a course', () => {
  const carRoads = ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'living_street', 'trunk', 'tram', 'rail'];
  const all = [{buildings: D.buildings.map(b => pairs(b.r.o)), roads: D.roads.map(r => ({...r, p: pairs(r.p)}))},
    ...patches.map(d => ({buildings: d.buildings.map(b => b.ring), roads: d.roads.map(r => ({...r, p: Array.isArray(r.p[0]) ? r.p : pairs(r.p)}))}))];
  for (const c of DATA.courses.filter(c => c.outline)) {
    const box = c.outline;
    for (const w of all) {
      // The kiosk at Torshov is a building of its own in the map data (OSM way 801539736), sharing the course's outline.
      for (const ring of w.buildings) {
        const mid = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);if (c.kiosk && M.insidePoly(mid, c.kiosk)) continue;
        assert.ok(!overlaps(ring, box) && polyDist(ring, box) > .3, `a building touches ${c.id}`);
      }
      for (const r of w.roads) {
        // Footways may run along the fence; car roads (with half their width) must stay outside it.
        if (!carRoads.includes(r.k)) continue;
        for (let k = 0; k + 1 < r.p.length; k++) for (const v of box) assert.ok(segDist(v, r.p[k], r.p[k + 1]) > r.w / 2 + .5 || !M.insidePoly(r.p[k], box), `${r.k} ${r.n} crosses ${c.id}`);
        for (const p of r.p) assert.ok(!M.insidePoly(p, box), `${r.k} ${r.n} inside ${c.id}`);
      }
    }
  }
});

test('Oslo Camping: the bar notch fits in Fredshuset and the lanes fit in the two rooms', () => {
  const camp = DATA.courses.find(c => c.kind === 'bar'), d = patches.find(p => p.name === camp.district);
  require('../game-shops.js');
  const b = d.buildings.find(x => x.id === camp.building);assert.ok(b, 'Fredshuset is in the Møllergata patch');
  const r = M.prepare([d], {courses: [camp]});assert.equal(r.notch, true);
  const nt = camp.local, plan = M.barPlan(nt.W, nt.depth);
  assert.ok(nt.W > 14 && nt.depth >= 18, `room ${nt.W.toFixed(1)} x ${nt.depth}`);
  assert.equal(plan.up.length, camp.upstairs);assert.equal(plan.up.length + plan.down.length, camp.holes);
  const rect = (l, m = 0) => {const b0 = l.dir > 0 ? l.b : l.b - plan.L;return {a0: l.a - plan.lw / 2 - .06 - m, a1: l.a + plan.lw / 2 + .06 + m, b0: b0 - m, b1: b0 + plan.L + m};};
  const hit = (p, q) => p.a0 < q.a1 && q.a0 < p.a1 && p.b0 < q.b1 && q.b0 < p.b1;
  for (const [list, keep] of [[plan.up, [plan.counter, plan.stair, {a0: 0, a1: plan.W, b0: 0, b1: 3.6}]], [plan.down, [{...plan.stair, b0: plan.stair.b0 - 1}]]]) {
    list.forEach((l, i) => {
      const p = rect(l);assert.ok(p.a0 > .2 && p.a1 < plan.W - .2 && p.b0 > .2 && p.b1 < plan.D - .2, `lane ${i + 1} inside the room`);
      for (const k of keep) assert.ok(!hit(rect(l, .35), k), `lane ${i + 1} clear of the bar, stair and front`);
      for (let j = 0; j < i; j++) assert.ok(!hit(rect(l, .2), rect(list[j], .2)), `lanes ${j + 1} and ${i + 1} apart`);
    });
  }
});

test('best scores: minigolf rounds per course and holes in one, joined like the disc golf records', () => {
  const B = require('../game-badges.js'), R = {};
  assert.equal(B.record(R, 'minigolf-round', {course: 'Torshov minigolfpark', total: 40, par: 38, holes: 18}).best, true);
  assert.equal(B.record(R, 'minigolf-round', {course: 'Torshov minigolfpark', total: 44, par: 38, holes: 18}).best, false);
  B.record(R, 'minigolf-hole', {strokes: 1});B.record(R, 'minigolf-hole', {strokes: 2});
  assert.deepEqual(R.minigolf['Torshov minigolfpark'], {rounds: 2, par: 38, holes: 18, best: 40});assert.equal(R.golfAces, 1);
  const other = {minigolf: {'Torshov minigolfpark': {rounds: 1, par: 38, holes: 18, best: 36}, 'Oslo Camping': {rounds: 1, par: 40, holes: 18, best: 45}}, golfAces: 2};
  const m = JSON.parse(B.mergeRecords(JSON.stringify(R), JSON.stringify(other), 'sync'));
  assert.equal(m.minigolf['Torshov minigolfpark'].best, 36);assert.equal(m.minigolf['Torshov minigolfpark'].rounds, 2);assert.equal(m.golfAces, 2);assert.ok(m.minigolf['Oslo Camping']);
  const facts = {records: m, gym: {}, kayak: {}, route: {}, got: {}};
  assert.deepEqual(B.BADGES.filter(b => ['minigolf', 'minigolf-ace', 'camping'].includes(b.id) && b.test(facts)).map(b => b.id), ['minigolf', 'minigolf-ace', 'camping']);
});
