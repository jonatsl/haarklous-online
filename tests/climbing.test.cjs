const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
require('../climbing-data.js');
const G = require('../game-climbing.js');
const K = globalThis.KLATREVERKET;

test('Klatreverket Torshov is in its real building at Myrens verksted 3K', () => {
  assert.equal(K.osm, 1031709261);assert.equal(K.name, 'Klatreverket Torshov');
  const inside = (p, ring) => {let r = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;}return r;};
  assert.ok(inside(K.gym, K.ring), 'the OpenStreetMap node of the gym is inside the building');
  assert.ok(Math.hypot(K.gym[0] + 960, K.gym[1] - 172) < 5, 'about 980 m west-south-west of Haarklous plass');
  // Kartverket's surface model: the eaves are 14.5 m above the hall floor, enough for the gym's 14 m walls.
  assert.ok(K.roofY.eaves - K.floorY > 14.3 && K.roofY.eaves - K.floorY < 14.8, `${K.roofY.eaves - K.floorY}`);
  assert.ok(Math.abs(K.frame.length - 60.2) < .3 && Math.abs(K.frame.wing - 19.75) < .5);
  assert.ok(Math.abs(K.floorY - K.ground.entrance) < .1, 'the floor is at street level at the entrance');
});

test('prices, the brattkort test and the opening hours follow the real rules', () => {
  const at = iso => new Date(iso);
  assert.equal(G.priceAt(at('2026-11-02T10:00:00')), 155);// Monday before 16
  assert.equal(G.priceAt(at('2026-11-02T16:00:00')), 175);// after 16
  assert.equal(G.priceAt(at('2026-11-07T10:00:00')), 175);// Saturday
  assert.equal(G.staffedAt(at('2026-11-03T16:59:00')), false);assert.equal(G.staffedAt(at('2026-11-03T17:00:00')), true);
  assert.equal(G.staffedAt(at('2026-11-07T10:59:00')), false);assert.equal(G.staffedAt(at('2026-11-07T11:00:00')), true);
  assert.equal(G.openAt(at('2026-11-05T22:59:00')), true);assert.equal(G.openAt(at('2026-11-05T23:00:00')), false);// Thursday
  assert.equal(G.openAt(at('2026-11-06T21:30:00')), false);assert.equal(G.openAt(at('2026-11-08T09:00:00')), true);// Friday, Sunday
  assert.deepEqual([G.PRICES.shoes, G.PRICES.harness, G.PRICES.chalk, G.PRICES.pack], [50, 50, 20, 100]);
  assert.equal(G.gradeName('boulder', 0), '3');assert.equal(G.gradeName('boulder', 1), '7B');assert.equal(G.gradeName('rope', 0), '3');assert.equal(G.gradeName('lead', 1), '8+');
});

test('the walls have the real heights and fit inside the building', () => {
  const faces = new Map(G.WALLS.map(w => [w.id, G.faceInfo(w)]));
  for (const id of ['h1', 'h2', 'h3', 'h4a', 'h4b', 'h5', 'h6']) assert.ok(Math.abs(faces.get(id).H - 14) < .15, `${id} ${faces.get(id).H}`);
  const comp = faces.get('comp');assert.ok(Math.abs(comp.H - 14) < .1 && Math.abs(comp.out - 7) < .1, 'Konkurranseveggen: 14 m high, 7 m overhanging');
  assert.ok(Math.abs(faces.get('gal').H - 10) < .1 && Math.abs(faces.get('kurs').H - 10) < .1, 'Galleriet and Kursrommet: 10 m');
  assert.ok(Math.abs(faces.get('disco1').H - 3.5) < .05, 'Discorommet: 3.5 m walls');
  assert.equal(faces.get('moon').segs[1][1], 40);
  for (const f of faces.values()) {
    const ceiling = f.lvl < 3 && f.p0[0] < 12.1 ? G.LEVELS[f.lvl + 1] - .25 : 14.3;
    for (const x of [0, f.W]) for (const s of [0, f.L]) {
      const p = G.faceAt(f, x, s).p;
      assert.ok(p.a > .29 && p.a < K.frame.length - .29 && p.b > .29 && p.b < K.frame.wing - .29, `${f.id} at (${p.a.toFixed(2)}, ${p.b.toFixed(2)})`);
      assert.ok(p.y <= ceiling + 1e-6, `${f.id} top ${p.y.toFixed(2)} above the ceiling ${ceiling}`);
    }
  }
});

test('route setting is the same on every computer and has what the real gym has', () => {
  const a = G.makeRoutes(40), b = G.makeRoutes(40);
  assert.deepEqual(a.holds.map(h => [h.x, h.s, h.type]), b.holds.map(h => [h.x, h.s, h.type]));
  const by = k => a.routes.filter(r => r.kind === k);
  const hall = a.routes.filter(r => r.zone === 'Hallen'), tr = hall.filter(r => r.toprope).length / hall.length;
  assert.ok(tr > .4 && tr < .6, `top-ropes on about half the hall's routes (${tr})`);
  assert.ok(a.routes.filter(r => r.zone === 'Galleriet').every(r => r.toprope), 'Galleriet: a top-rope on every route');
  assert.ok(a.routes.filter(r => r.face === 'comp').every(r => r.kind === 'lead'), 'Konkurranseveggen: lead only');
  assert.equal(by('auto').length, 6, 'six autobelay lines');
  assert.equal(a.routes.filter(r => r.zone === 'Teknikkhjørnet').length, 20 - 1 + 1, 'the technique corner has its problems');
  assert.ok(a.routes.filter(r => r.zone === 'Hula').every(r => r.d <= .4), 'Hula: only the easier grades');
  for (const r of a.routes) {
    if (r.moon) {assert.ok(r.holds.length >= 4 && r.startHolds.length === 1 && r.topHold != null);continue;}
    if (r.kind === 'campus') continue;// three columns of rungs, each with a top
    const hs = r.holds.map(i => a.holds[i]);
    assert.ok(hs.some(h => h.start), `${r.name} has a start`);assert.equal(hs.filter(h => h.top).length, 1, `${r.name} has one top`);
    if (r.kind === 'lead' || r.kind === 'rope') {assert.ok(r.bolts.length >= 5 && r.anchor, `${r.name} has bolts and an anchor`);}
  }
});

// A climbing robot using the game's own climber: it lets go with its lower hand and grabs the highest hold of the route it can
// reach (dynos when it must), clips bolts on lead, and must get to the top of every line.
function robot(set, hw, route) {
  const isBlock = p => p.x < 12, floorY = p => {let lvl = 0;for (let i = 3; i >= 0; i--) if (p.y > G.LEVELS[i] - .1 && (i === 0 || isBlock(p))) {lvl = i;break;}return G.LEVELS[lvl] + (lvl > 0 || (isBlock(p) && p.z > 8.6) ? .3 : 0);};
  const f = set.faces.find(x => x.id === route.face), gear = p => {const at = G.faceAt(f, p.x, p.s), n = at.nrm;return {x: at.p.a + n.a * .05, y: at.p.y + n.y * .05, z: at.p.b + n.b * .05};};
  const style = route.kind === 'rope' ? 'rope' : route.kind;
  const c = new G.Climber(hw, floorY);const seq = route.holds.map(i => hw[i]).filter(h => h.hand);
  c.start(route, route.moon ? [hw[route.startHolds[0]]] : seq.filter(h => h.start), {style, anchor: route.anchor ? gear(route.anchor) : null, bolts: route.bolts.map(gear), chalk: true});
  const both = {L: true, R: true}, dt = .05;let dynos = 0;
  c.update(dt, {grip: both, stick: {x: 0, y: 0}});
  for (let step = 0; step < 120 && !c.sent && c.state === 'climb'; step++) {
    const [s, o] = ['L', 'R'].sort((p, q) => c.hands[p].hold.p.y - c.hands[q].hold.p.y);
    c.update(dt, {grip: {[s]: false, [o]: true}, stick: {x: 0, y: 0}});
    for (let k = 0; k < 4; k++) c.update(dt, {grip: {[s]: false, [o]: true}, clip: true, stick: {x: 0, y: 0}});
    if (c.state !== 'climb') break;
    const from = c.hands[o].hold, cand = seq.filter(h => h.p.y >= from.p.y - .02 && (h !== from || c.isTop(h)));
    let target = cand.filter(h => G.classify(c, s, h) === 'reach').sort((p, q) => q.p.y - p.p.y)[0];
    if (!target) {target = cand.filter(h => G.classify(c, s, h) === 'dyno').sort((p, q) => p.p.y - q.p.y)[0];if (!target) break;dynos++;c.hands[s].hold = target;c.solveFeet();continue;}
    c.update(dt, {grip: both, aim: target, stick: {x: 0, y: 0}});
    if (c.hands[s].hold !== target) return {sent: false, why: `could not grab hold ${target.id} (${G.classify(c, s, target)}) ${c.msg}`, dynos};
    if (style === 'lead' && c.isTop(c.hands[s].hold)) {
      c.update(dt, {grip: {[s]: false, [o]: true}, stick: {x: 0, y: -1}});for (let k = 0; k < 3; k++) c.update(dt, {grip: {[s]: false, [o]: true}, clip: true, stick: {x: 0, y: -1}});
      if (c.state === 'climb') c.update(dt, {grip: both, aim: target, stick: {x: 0, y: 0}});
    }
  }
  return {sent: c.sent, dynos, offRoute: c.offRoute, clipped: c.clipped, bolts: c.bolts.length, pump: c.pump, state: c.state, why: c.msg};
}

test('every route and problem can be climbed to the top, the easier ones without a jump', () => {
  const set = G.makeRoutes(40), hw = G.worldHolds(set, (a, b) => ({x: a, z: b}), 0);
  const failed = [], jumpy = [];
  for (const r of set.routes) {
    const res = robot(set, hw, r);
    if (!res.sent) failed.push(`${r.face} ${r.name} ${res.why || ''} state ${res.state || ''}`);
    if (r.d <= .7 && res.dynos) jumpy.push(`${r.face} ${r.name} (${res.dynos})`);
    if (r.kind === 'lead' && res.sent) assert.equal(res.clipped, res.bolts, `${r.name}: all bolts clipped`);
    assert.equal(res.offRoute, null, `${r.name}: stayed on its own holds`);
  }
  assert.deepEqual(failed, []);
  assert.ok(jumpy.length <= 3, `easy lines needing a jump: ${jumpy.join(', ')}`);
});

test('falls: the top-rope holds you at once, lead falls are twice the distance above the last bolt, boulders land on the mat', () => {
  assert.equal(G.leadCatch(15, 10), 10 - 5 - .6 - .06 * (10 + 10.6));
  assert.equal(G.leadCatch(3, null), -Infinity);
  // The same fall in the game's coordinates (the hall floor is at y -41.6): the rope's stretch depends on how much rope is out.
  assert.ok(Math.abs(G.leadCatch(15 - 41.6, 10 - 41.6, .6, -41.6) - (G.leadCatch(15, 10) - 41.6)) < 1e-9);
  assert.ok(G.leadCatch(-32.6, -32.5, .6, -41.6) < -32.6, 'a fall below the last bolt is caught below where it started');
  const set = G.makeRoutes(40), hw = G.worldHolds(set, (a, b) => ({x: a, z: b}), 0), floorY = () => 0;
  const run = (route, style, opts = {}) => {const c = new G.Climber(hw, floorY);c.start(route, route.holds.map(i => hw[i]).filter(h => h.start), {style, ...opts});c.update(.05, {grip: {L: true, R: true}});c.hip.y = opts.hipY ?? c.hip.y;const ev = [];ev.push(...c.update(.05, {grip: {L: false, R: false}}));for (let i = 0; i < 200 && c.state === 'fall'; i++) ev.push(...c.update(.02, {grip: {L: false, R: false}}));return {c, ev};};
  const tr = set.routes.find(r => r.kind === 'rope'), top = {x: 0, y: 13.8, z: 0};
  const a = run(tr, 'rope', {anchor: top, hipY: 9});assert.equal(a.c.state, 'hang');assert.ok(9 - a.c.hip.y < .6, `top-rope fall ${9 - a.c.hip.y}`);
  const ld = set.routes.find(r => r.kind === 'lead');
  const b = run(ld, 'lead', {anchor: top, bolts: [{x: 0, y: 2.3, z: 0}], hipY: 1.6});assert.equal(b.c.state, 'done');// nothing clipped yet, near the floor: you drop to the ground
  const c = run(ld, 'lead', {anchor: top, bolts: [{x: 0, y: 2.3, z: 0}, {x: 0, y: 3.4, z: 0}, {x: 0, y: 4.6, z: 0}], hipY: 4.0});assert.equal(c.c.state, 'done');assert.ok(c.ev.includes('deck'), 'unclipped at 4 m: you hit the ground');
  const ab = set.routes.find(r => r.kind === 'auto'), d = run(ab, 'auto', {anchor: top, hipY: 8});assert.equal(d.c.state, 'lower');
  const bo = set.routes.find(r => r.kind === 'boulder'), e = run(bo, 'boulder', {hipY: 3.2});assert.equal(e.c.state, 'done');assert.ok(Math.abs(e.c.hip.y - .95) < 1e-6);
});

test('the autobelay lowers you and a top-rope climber is lowered on request', () => {
  const set = G.makeRoutes(40), hw = G.worldHolds(set, (a, b) => ({x: a, z: b}), 0), c = new G.Climber(hw, () => 0);
  const r = set.routes.find(x => x.kind === 'rope');c.start(r, r.holds.map(i => hw[i]).filter(h => h.start), {style: 'rope', anchor: {x: 0, y: 13.8, z: 0}});
  c.update(.05, {grip: {L: true, R: true}});c.hip.y = 6;c.update(.05, {grip: {L: true, R: true}, letGo: true});assert.equal(c.state, 'hang');
  c.update(.05, {grip: {}, letGo: true});assert.equal(c.state, 'lower');for (let i = 0; i < 400 && c.state === 'lower'; i++) c.update(.05, {grip: {}});
  assert.equal(c.state, 'done');assert.ok(c.lowered);
});

test('the gym replaces its building in the district patch and lowers the ground under the hall', () => {
  const d = {buildings: [{id: 'w1031709261'}, {id: 'w1031708991'}]}, calls = [];
  G.prepare([d], K, -9.975, (dist, poly, rel) => calls.push({dist, poly, rel}));
  assert.deepEqual(d.buildings.map(b => b.id), ['w1031708991']);
  assert.equal(calls.length, 1);assert.equal(calls[0].poly.length, 4);assert.ok(Math.abs(calls[0].rel - (K.floorY + 9.975 - .05)) < 1e-9);
});

test('belaying for the brattkort: take in, hold the brake on a fall, lower – and what fails', () => {
  const run = (policy, seed = 3) => {const b = new G.Belay(7.8, seed);for (let t = 0; t < 90 && !['passed', 'done', 'failed'].includes(b.state); t += .05) b.update(.05, policy(b));return b;};
  const good = run(b => ({takeIn: b.slack > .5 ? 1 : 0, brake: b.state === 'fall', lower: b.state === 'top' || b.state === 'lower'}));
  assert.equal(good.state, 'passed');assert.deepEqual(good.mistakes, []);
  const lazy = run(() => ({takeIn: 0, brake: false}));
  assert.equal(lazy.state, 'failed', 'never taking in: she hits the ground');
  const noBrake = run(b => ({takeIn: b.slack > .5 ? 1 : 0, brake: false}));
  assert.equal(noBrake.state, 'failed');assert.match(noBrake.msg, /brake/);
  const tight = run(b => ({takeIn: 1, brake: b.state === 'fall', lower: b.state === 'top' || b.state === 'lower'}));
  assert.ok(tight.mistakes.some(m => /tight/.test(m)), 'pulling all the time is a mistake');
  for (const q of G.QUIZ) assert.ok(q.ok >= 0 && q.ok < q.a.length);
});
