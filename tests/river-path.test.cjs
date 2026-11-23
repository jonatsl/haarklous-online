// Akerselva – turvei (issue #147): follow the whole path at 1 m steps on the game's real ground (the river bed lowered, every
// patch, the streets, the road bridges, Akerselva's bridge decks, the path itself) and check that a bicycle can ride it.
//   RIVER_PATH_REPORT=1 node --test tests/river-path.test.cjs   prints the worst places
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const T = require(path.join(__dirname, '..', 'tools', 'make-river-path.cjs'));
const WC = require(path.join(__dirname, '..', 'walk-collision.js'));
const L = T.load({withPath: true}), {surface, RP, A, RiverPath, D, districts, W} = L, DK = T.decks(L), river = RiverPath.riverAt(A);
const report = !!process.env.RIVER_PATH_REPORT;
// The bike's limits (game-rentals.js CityBike, game-vehicles.js Vehicle): it pedals up about 14 % at walking pace (130 N for
// 95 kg), and the e-bike and the e-scooter more; it rolls over any step under 1.5 m, but a step is a kerb at most here (12 cm
// and a little: where the band meets a pavement). Flat across: on a straight 0 %; in a sloping bend the two sides are at
// different places along it, so up to 6 %.
const MAX_GRADE = .12, MAX_STEP = .2, MAX_CROSS = .06, HEADROOM = 2.2;

// The route at 1 m steps: position, direction, what it is on (0 band, 1 street, 2 bridge).
const ix = RiverPath.index(RP), cum = ix.cum, runAt = new Int8Array(RP.pts.length / 2);
for (const [i0, i1, kind] of RP.runs) for (let k = i0; k < i1; k++) runAt[k] = kind;
const S = [];
for (let a = 0; a <= ix.L; a += 1) {const [x, s, fx, fs, k] = ix.along(a);S.push({a, x, s, fx, fs, kind: runAt[k]});}
// Akerselva's decks: where (x, s) is on one, and its walking surface there (game-kayak.js: the deck bends to the ground over
// its last 1.5 m).
const onDeck = (x, s) => {for (const d of DK) {const p = (x - d.ax) * d.ux + (s - d.as) * d.us, q = (x - d.ax) * -d.us + (s - d.as) * d.ux;if (p >= 0 && p <= d.len && Math.abs(q) <= d.w / 2) return {d, p, q};}return null;};
function deckSurface(h, x, s) {
  const {d, p} = h;let y = d.deckAt(p);
  for (const [e, Te] of [[p, d.prof[0][1]], [d.len - p, d.prof[3][1]]]) if (e < 1.5) y += (surface.height(x, s) - Te) * (1 - Math.max(0, e) / 1.5);
  return y;
}
// The ground a wheel rolls on: an Akerselva deck where the route is on the bridge, a road bridge's deck where it is on one,
// else the ground.
function ground(x, s, kind) {
  if (kind === 2) {const h = onDeck(x, s);if (h) return deckSurface(h, x, s);}
  if (kind === 1) {const o = surface.decksAt(x, s, []).find(q => Math.abs(q.y) < q.d.W);if (o) return surface.deckTop(o.d, o.t, o.y);}
  return surface.height(x, s);
}
for (const q of S) q.h = ground(q.x, q.s, q.kind);

test('the path is one unbroken line from the top of the game\'s river to Vaterland, all of it on drawn, walkable ground', () => {
  assert.ok(RP && RP.pts.length > 400 && RP.runs.length > 0, 'river-path-data.js is loaded');
  const first = river(RP.pts[0], RP.pts[1]), n = RP.pts.length / 2, last = river(RP.pts[n * 2 - 2], RP.pts[n * 2 - 1]);
  assert.ok(first.t < 80, `starts ${first.t.toFixed(0)} m down the river`);assert.ok(last.t > A.length - 200, `ends ${(A.length - last.t).toFixed(0)} m before the culvert`);
  for (let k = 1; k < n; k++) assert.ok(cum[k] - cum[k - 1] < 13, `a gap of ${(cum[k] - cum[k - 1]).toFixed(1)} m at ${cum[k].toFixed(0)} m`);
  // the runs cover the whole line, each starting where the one before ends (a band reaches one point into the next stretch)
  for (let r = 1; r < RP.runs.length; r++) assert.ok(RP.runs[r][0] <= RP.runs[r - 1][1] && RP.runs[r][0] >= RP.runs[r - 1][1] - 2, `runs ${r - 1} and ${r} meet`);
  assert.strictEqual(RP.runs[0][0], 0);assert.strictEqual(RP.runs[RP.runs.length - 1][1], n - 1);
  const rects = [{x0: -760, s0: -760, x1: 760, s1: 760}, ...districts.map(d => d.play)];
  const inWorld = (x, s) => rects.some(r => x >= r.x0 - 1 && x <= r.x1 + 1 && s >= r.s0 - 1 && s <= r.s1 + 1) || W.gridFor(x, s);
  for (const q of S) assert.ok(inWorld(q.x, q.s) && W.gridFor(q.x, q.s), `off the drawn ground at ${q.a} m (${q.x.toFixed(0)}, ${q.s.toFixed(0)})`);
  // most of it is a band of its own, following the real ways
  const band = RP.runs.filter(r => r[2] === 0).reduce((a, r) => a + cum[r[1]] - cum[r[0]], 0);
  assert.ok(band > .65 * ix.L, `band ${band.toFixed(0)} of ${ix.L.toFixed(0)} m`);
  assert.ok(RP.ways.filter(w => typeof w[0] === 'number').length > 30, 'the OSM ways it follows are listed');
});

// Places that are known to be worse than the limits (they all are where the path meets the game's existing streets and
// bridges, whose own ground is that steep there), each with the worst it may be: [x, s, what, limit, why]. The test fails if
// one gets worse, or a new one appears.
const KNOWN = [
  // Bjølsen: the turvei climbs from the falls' footbridge to Sandakerveien (the ground there rises 2 m in 10 m); the route
  // turns back on itself at the footbridge's west end, so the band lies beside itself at two heights.
  [-507, -301, 'grade', .27, 'from the footbridge up to Sandakerveien'], [-567, -374, 'grade', .16, 'turn at the footbridge'],
  [-624, -368, 'grade', .14, 'turn at the footbridge'], [-574, -364, 'grade', .15, 'turn at the footbridge'],
  [-623, -365, 'cross', .15, 'the band beside itself'], [-572, -372, 'cross', .22, 'the band beside itself'], [-567, -368, 'cross', .21, 'the band beside itself'], [-574, -363, 'cross', .1, 'the band beside itself'],
  // The detour east of the river between Bjølsen and Myra (the riverside there is outside the walkable world): a steep sidewalk.
  [-654, -59, 'grade', .17, 'sidewalk on the detour'],
  // Bentsebrugata: down from the bridge's sidewalk to the riverside path (the street's own slope).
  [-842, 14, 'grade', .16, 'Bentsebrugata sidewalk'], [-847, 4, 'grade', .19, 'Bentsebrugata sidewalk'], [-839, -7, 'grade', .21, 'from Bentsebrugata to the path'], [-860, -47, 'grade', .15, 'below Bentsebrugata'],
  // Nedre Foss and Sagene: sidewalks of streets that are that steep themselves.
  [-1018, 507, 'grade', .25, 'Nedre Foss sidewalk'], [-1215, 913, 'grade', .55, 'Sannergata sidewalk ramp'], [-1216, 912, 'step', .21, 'Sannergata sidewalk ramp'],
  [-1214, 925, 'grade', .16, 'Sannergata sidewalk'], [-1216, 933, 'grade', .15, 'Sannergata sidewalk'], [-1168, 896, 'cross', .1, 'bend by Sannergata'],
  // Grünerløkka: where the path joins a steep service road (a ramp) by Grüners gate, and bends by Ankerbrua.
  [-1248, 1399, 'grade', .17, 'Grüners gate sidewalk'], [-1257, 1446, 'grade', .34, 'service road ramp by Grüners gate'], [-1248, 1395, 'cross', .16, 'beside the service road'],
  [-1238, 1692, 'cross', .11, 'bend by Ankerbrua'], [-1233, 1868, 'cross', .09, 'bend by Nybrua'],
  // Hausmanns bru: the crossing of Hausmanns gate east of the bridge (the street dips toward the bridge there).
  [-915, 2360, 'grade', .5, 'crossing Hausmanns gate'], [-930, 2382, 'cross', .11, 'bend south of Hausmanns bru'], [-914, 2359, 'step', .18, 'crossing Hausmanns gate'],
];
const near = (q, k) => Math.hypot(q.x - k[0], q.s - k[1]) < 25;
function judge(issues, what, limit) {
  const bad = issues.filter(q => q.v > limit && !KNOWN.some(k => k[2] === what && near(q, k) && q.v <= k[3]));
  if (report) for (const q of issues.filter(q => q.v > limit)) console.log(`  ${what} ${(q.v * 100).toFixed(1)} at ${q.a} m [${q.x.toFixed(0)}, ${q.s.toFixed(0)}] kind ${q.kind}${KNOWN.some(k => k[2] === what && near(q, k)) ? ' (known)' : ''}`);
  return bad;
}
// The worst value in each stretch where a measure is over its limit (so a long steep stretch is one place).
function places(list, limit) {
  const out = [];
  for (const q of list) {if (q.v <= limit) continue;const r = out[out.length - 1];if (r && q.a - r.a1 <= 4) {r.a1 = q.a;if (q.v > r.v) Object.assign(r, {v: q.v, x: q.x, s: q.s, a: q.a, kind: q.kind});} else out.push({...q, a1: q.a});}
  return out;
}

test('no step a bicycle cannot roll over, and no slope steeper than it climbs', () => {
  const steps = [], grades = [];
  for (let i = 0; i + 1 < S.length; i++) {
    const a = S[i], b = S[i + 1];let m = 0;
    for (let k = 0; k < 10; k++) {
      const f0 = k / 10, f1 = (k + 1) / 10, x0 = a.x + (b.x - a.x) * f0, s0 = a.s + (b.s - a.s) * f0, x1 = a.x + (b.x - a.x) * f1, s1 = a.s + (b.s - a.s) * f1;
      const kind = f1 <= .5 ? a.kind : b.kind;m = Math.max(m, Math.abs(ground(x1, s1, kind) - ground(x0, s0, kind)));
    }
    steps.push({v: m, a: a.a, x: a.x, s: a.s, kind: a.kind});
  }
  for (let i = 3; i + 3 < S.length; i++) grades.push({v: Math.abs(S[i + 3].h - S[i - 3].h) / (S[i + 3].a - S[i - 3].a), a: S[i].a, x: S[i].x, s: S[i].s, kind: S[i].kind});
  const badSteps = judge(places(steps, MAX_STEP), 'step', MAX_STEP), badGrades = judge(places(grades, MAX_GRADE), 'grade', MAX_GRADE);
  assert.strictEqual(badSteps.length, 0, `steps: ${badSteps.map(q => `${(q.v * 100).toFixed(0)} cm at ${q.a} m (${q.x.toFixed(0)}, ${q.s.toFixed(0)})`).join(', ')}`);
  assert.strictEqual(badGrades.length, 0, `grades: ${badGrades.map(q => `${(q.v * 100).toFixed(0)} % at ${q.a} m (${q.x.toFixed(0)}, ${q.s.toFixed(0)})`).join(', ')}`);
  // most of the path is no steeper than 8 % (the rest climbs the falls at Bjølsen and Nedre Foss and joins steep streets)
  const easy = grades.filter(q => q.v <= .08).length / grades.length;
  assert.ok(easy > .8, `${(easy * 100).toFixed(0)} % of it at 8 % or less`);
});

test('the band is flat across, and stays above the water', () => {
  const nearCar = (x, s) => surface.near(x, s, []).some(o => {const c = surface.chains[o.c];return !c.path && Math.abs(o.y) < c.hw + c.sw + 2 && o.t > -2 && o.t < c.L + 2;});
  const cross = [];let wet = {v: -Infinity};
  for (const q of S) {
    if (q.kind !== 0) continue;
    if (!nearCar(q.x, q.s)) {const nx = -q.fs * 1.2, ns = q.fx * 1.2;cross.push({v: Math.abs(surface.height(q.x + nx, q.s + ns) - surface.height(q.x - nx, q.s - ns)) / 2.4, a: q.a, x: q.x, s: q.s, kind: 0});}
    const r = river(q.x, q.s);
    if (r && r.d < r.half + 30) {const under = r.level + .3 - q.h;if (under > wet.v) wet = {v: under, at: q.a, x: q.x, s: q.s};}
  }
  const bad = judge(places(cross, MAX_CROSS), 'cross', MAX_CROSS);
  if (report) console.log('closest to the water', JSON.stringify(wet));
  assert.strictEqual(bad.length, 0, `cross-falls: ${bad.map(q => `${(q.v * 100).toFixed(0)} % at ${q.a} m (${q.x.toFixed(0)}, ${q.s.toFixed(0)})`).join(', ')}`);
  assert.ok(wet.v <= 0, `${(wet.v + .3).toFixed(2)} m over the water at ${wet.at} m`);
  // ... and off the water: the band's edge at least 1 m from the water's edge (except on the bridges)
  for (const q of S) {if (q.kind === 2) continue;const r = river(q.x, q.s);if (r) assert.ok(r.d >= r.half + T.HW + 1 - .05, `${(r.d - r.half - T.HW).toFixed(2)} m from the water at ${q.a} m`);}
});

test('nothing stands on the path (trees, lamps, benches, bushes, buildings, bridge railings), and there is headroom under the bridges', () => {
  // The solids the game makes from the same data (surroundings.js obstacles(), game-kayak.js railings and deck undersides),
  // in the local frame, with the trees, bushes and lamps that surroundings.js keeps off the path left out.
  const clear = (x, s, r) => RiverPath.clear(ix, x, s, r), obstacles = [], sq = (x, s, r, y0, y1, kind) => obstacles.push({points: [[x - r, s - r], [x + r, s - r], [x + r, s + r], [x - r, s + r]].map(([a, b]) => ({x: a, z: b})), minY: y0, maxY: y1, kind});
  const near = (x, s) => ix.dist(x, s) < 12;
  for (let i = 0; i < D.trees.length; i += 3) {const x = D.trees[i], s = D.trees[i + 1];if (near(x, s) && clear(x, s, .4)) {const y = surface.height(x, s);sq(x, s, .28, y - .5, y + 6, 'tree');}}
  for (const d of districts) for (const t of d.trees) if (near(t.x, t.s) && clear(t.x, t.s, .4)) {const y = surface.height(t.x, t.s);sq(t.x, t.s, .28, y - .5, y + 6, 'tree');}
  for (let i = 0; i < D.bushes.length; i += 3) {const x = D.bushes[i], s = D.bushes[i + 1], r = D.bushes[i + 2];if (near(x, s) && clear(x, s, .6 * r)) {const y = surface.height(x, s);sq(x, s, .45 * r, y - .5, y + 1.2, 'bush');}}
  for (let i = 0; i < D.lamps.length; i += 2) {const x = D.lamps[i], s = D.lamps[i + 1];if (near(x, s) && clear(x, s, .2)) {const y = surface.height(x, s);sq(x, s, .1, y - .5, y + 5.2, 'lamp');}}
  for (let i = 0; i < RP.lamps.length; i += 2) {const x = RP.lamps[i], s = RP.lamps[i + 1], y = surface.height(x, s);sq(x, s, .1, y - .5, y + 5, 'path lamp');}
  for (let i = 0; i < RP.benches.length; i += 3) {
    const x = RP.benches[i], s = RP.benches[i + 1], h = RP.benches[i + 2], c = Math.cos(h), sn = Math.sin(h), y = surface.height(x, s);
    obstacles.push({points: [[-.88, -.3], [.88, -.3], [.88, .26], [-.88, .26]].map(([a, d]) => ({x: x + c * a + sn * d, z: s - sn * a + c * d})), minY: y - .3, maxY: y + .9, kind: 'bench'});
  }
  const ring = r => r.map(([x, s]) => ({x, z: s})), nearRing = r => r.some(([x, s]) => ix.dist(x, s) < 40);
  // (a building blocks from under the ground to 4 m over its roof, as surroundings.js has it; one dug into a slope to its roof)
  const building = (r, h) => {
    let cx = 0, cs = 0;for (const [x, s] of r) {cx += x / r.length;cs += s / r.length;}
    const top = surface.natural(cx, cs) + h, g = Math.max(...r.map(([x, s]) => surface.height(x, s)));
    obstacles.push({points: ring(r), minY: Math.min(...r.map(([x, s]) => surface.natural(x, s))) - 2.5, maxY: g > top - 1 ? top - .1 : top + 4, kind: 'building'});
  };
  for (const b of D.buildings) {const r = [];for (let i = 0; i < b.r.o.length; i += 2) r.push([b.r.o[i], b.r.o[i + 1]]);if (nearRing(r)) building(r, b.h);}
  for (const d of districts) for (const b of d.buildings) if (b.ring.length >= 3 && nearRing(b.ring)) building(b.ring, b.h);
  for (const d of DK) {
    const n = Math.max(1, Math.ceil(d.len / 2)), vx = -d.us, vs = d.ux;
    for (let k = 0; k < n; k++) {
      const p0 = d.len * k / n, p1 = d.len * (k + 1) / n, lo = Math.min(d.deckAt(p0), d.deckAt(p1)), hi = Math.max(d.deckAt(p0), d.deckAt(p1));
      const poly = (q0, q1) => [[p0, q0], [p1, q0], [p1, q1], [p0, q1]].map(([p, q]) => ({x: d.ax + d.ux * p + vx * q, z: d.as + d.us * p + vs * q}));
      for (const sg of [-1, 1]) obstacles.push({points: poly(sg * (d.w / 2 - .08), sg * d.w / 2), minY: lo - d.thick, maxY: hi + 1.1, kind: 'railing'});
      if (p0 >= 1.5 && p1 <= d.len - 1.5) obstacles.push({points: poly(-d.w / 2 + .08, d.w / 2 - .08), minY: lo - d.thick, maxY: lo - .05, kind: 'bridge deck'});
    }
  }
  const world = WC.createWorld({obstacles, radius: .3});
  const hits = [];
  for (const q of S) if (WC.hitsSolid(world, {x: q.x, z: q.s}, q.h + .3, q.h + 1.2)) hits.push(q);
  const what = q => obstacles.filter(o => o.maxY > q.h + .3 && o.minY < q.h + 1.2 && WC.hitsSolid(WC.createWorld({obstacles: [o], radius: .3}), {x: q.x, z: q.s}, q.h + .3, q.h + 1.2)).map(o => o.kind).join('+');
  if (report && hits.length) console.log('solids on the path at', hits.map(q => `${q.a} (${q.x.toFixed(1)}, ${q.s.toFixed(1)}) ${q.kind} ${what(q)}`).join(', '));
  assert.strictEqual(hits.length, 0, `${hits.length} places with a solid at handlebar height, first at ${hits[0] && hits[0].a} m (${hits[0] && hits[0].x.toFixed(1)}, ${hits[0] && hits[0].s.toFixed(1)})`);
  // Under Akerselva's bridges (where the band passes under a deck): room to walk and cycle.
  let low = {v: Infinity};
  for (const q of S) {if (q.kind !== 0) continue;const h = onDeck(q.x, q.s);if (!h) continue;const room = h.d.deckAt(h.p) - h.d.thick - q.h;if (room < low.v) low = {v: room, at: q.a, t: h.d.t};}
  if (report) console.log('least headroom under a bridge', JSON.stringify(low));
  assert.ok(low.v >= HEADROOM, `${low.v.toFixed(2)} m of headroom at ${low.at} m (bridge at river ${low.t})`);
});

test('lamps every 30 m or so beside the band and some benches; the map draws the path with its name', () => {
  const band = RP.runs.filter(r => r[2] === 0).reduce((a, r) => a + cum[r[1]] - cum[r[0]], 0);
  assert.ok(RP.lamps.length / 2 > band / 45, `${RP.lamps.length / 2} lamps along ${band.toFixed(0)} m`);
  assert.ok(RP.benches.length / 3 >= 6, `${RP.benches.length / 3} benches`);
  for (let i = 0; i < RP.lamps.length; i += 2) {const d = ix.dist(RP.lamps[i], RP.lamps[i + 1]);assert.ok(d > T.HW + .3 && d < T.HW + 2, `lamp ${i / 2} is ${d.toFixed(2)} m from the centre line`);}
  assert.strictEqual(RP.name, 'Akerselva – turvei');
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'game-map.js'), 'utf8');
  assert.ok(src.includes('data.turvei') && src.includes('Akerselva – turvei'));
});
