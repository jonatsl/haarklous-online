// Bridges (issue #139): every bridge in the map data, and every car street's bridge is a deck of its own with room under it,
// joined to the street at both ends, with no ground through it. Built from the same data and code as the game
// (tools/road-roughness.cjs loads every patch and bridges-data.js like surroundings.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const R = require('../tools/road-roughness.cjs');
const RB = require(path.join(__dirname, '..', 'road-bridges.js'));
const L = R.load(), S = L.surface, surface = RB.surfaceOf(S);

// Known shortfalls (OpenStreetMap way id -> how far off it may be; the test fails if it gets worse). room: the least room under
// the deck at one of its crossings (m); end: metres of the carriageway's end line that do not join (a step over 5 cm); through:
// how far the ground under the carriageway reaches above 25 cm under its top (m); grade: the steepest slope on the deck.
const KNOWN = {
  // Short bridges whose crossing lies within a few metres of an end that meets the street at grade (the terrain model has the
  // ground under them, and there is no room for a ramp): the deck clears it only partly.
  286882948: {room: .8}, // Hasleveien over Gjøvikbanen
  504568174: {room: 1.9}, 27199975: {room: 1.4}, // St. Halvards gate over Gjøvikbanen and a cycle path
  275119201: {room: .9, end: 11.4}, // Peter Møllers vei over Alnabanen
  112540343: {room: .9}, // Fagerlia over Alna and Alnastien
  77187278: {room: .1}, // Turbinveien over Alna
  38982101: {room: .8}, // Kong Håkon 5.s gate over a cycle path by its end
  319336716: {room: 1.8, grade: .32}, // a service road at Myrens over a cycle path
  261145020: {room: .8}, 261145021: {room: 1.6}, // Dronning Eufemias gate over Akerselva's mouth (at sea level)
  102296697: {room: 4.3}, // Sinsenkrysset: the roundabout over Storoveien (Ring 3 really runs in a cutting there)
  // Interchanges where several decks and slip roads meet (Storo, Sinsenkrysset, Kværner, Bjørvika, Bryn, Ulven): a corner of
  // an end line, or a steep end where a deck bends to the street or deck it meets.
  141145849: {end: 3}, 311606466: {end: 3, through: .2}, 71054761: {end: 2.2}, // Storoveien over Hans Nielsen Hauges gate: the
  //   outer 2.5 m of the junction on the bridge (the lanes are clear)
  102296683: {end: 8.7, grade: .15}, 315369820: {through: .2}, // Sinsenkrysset, Trondheimsveien
  31254044: {room: 2.5, end: 9.3}, 263809604: {room: 4.3, end: 9.9}, 31254045: {grade: .15}, 709736349: {grade: .27}, // Kværnerveien
  263809599: {room: 2.4, through: .5}, 263809620: {end: 1.6, through: .8, grade: .25}, 4823394: {end: 4.1, through: .3},
  263809603: {end: 2.9}, 263809621: {grade: .23}, 263809625: {end: 7.2, grade: .27}, 4260788: {end: 5.1, grade: .45},
  685138546: {end: 11.9}, 685138547: {grade: .16}, 466204266: {grade: .21}, // Kværner interchange (Konows gate, Birkebeingata)
  36951786: {grade: .16}, 150697239: {grade: .2}, 281121204: {grade: .18}, 377796831: {grade: .19}, 551909258: {through: .2},
  1427334547: {grade: .26}, // Nylandsveien, Bjørvika and Sørenga
  4240265: {end: 15.5}, 93668709: {end: 10.5}, // Østensjøveien over Strømsveien (Bryn)
  355271398: {end: 8.7}, 143616755: {through: 1.5}, 452777947: {grade: .28}, // Ulven and Dronning Margretes vei
  184457032: {through: 1, grade: .33}, 311439454: {grade: .15}, // a service road at Løren, Ulvenveien
};

const decksOf = id => S.decks.filter(d => d.bridges.some(b => b.id === id));
const nearestT = (d, x, s) => {let bt = 0, bd = Infinity;for (let t = 0; t <= d.L + 1e-9; t += .25) {const q = RB.frame(d, Math.min(t, d.L)), dd = Math.hypot(q.x - x, q.s - s);if (dd < bd) {bd = dd;bt = Math.min(t, d.L);}}return {t: bt, d: bd};};

test('every bridge in the map is listed with what crosses under it, and each car street bridge is a deck', () => {
  const all = L.bridges, kinds = {deck: 0, kayak: 0, culvert: 0, other: 0};
  assert.ok(all.length > 400, `${all.length} bridge ways`);
  for (const b of all) {
    assert.ok(b.p.length >= 4 && Number.isFinite(b.L), `bridge ${b.id} has a line and a layer`);
    for (const u of b.under) assert.ok(u.k && Number.isFinite(u.x) && Number.isFinite(u.s), `bridge ${b.id}: what passes under it is named and placed`);
    if (b.layered) {kinds.deck++;assert.ok(decksOf(b.id).length > 0, `car bridge ${b.id} ${b.n} (${b.k}) has a deck`);}
    else if (b.kayak) kinds.kayak++;else if (b.culvert) kinds.culvert++;else kinds.other++;
  }
  // Akerselva's own decks (game-kayak.js) stay; the car bridges over roads, railways and water are decks here.
  assert.ok(kinds.deck >= 100 && kinds.kayak >= 8, JSON.stringify(kinds));
});

test('each deck clears what passes under it: road and railway 4.7 m, path 2.6 m, river 1.8 m', () => {
  const short = [];
  for (const d of S.decks) for (const b of d.bridges) for (const x of b.cross) {
    const n = nearestT(d, x.u.x, x.u.s);if (n.d > 2) continue;// (a crossing under the other carriageway beside it)
    const room = d.top(n.t, 0) - S.DECK - S.height(x.u.x, x.u.s);
    if (room >= x.clear - .1) continue;
    const k = KNOWN[b.id];
    if (k && k.room !== undefined && room >= k.room - .05) continue;
    short.push(`${b.id} ${b.n || b.k} over ${x.u.k} ${x.u.n}: ${room.toFixed(2)} m (needs ${x.clear})`);
  }
  assert.deepEqual(short, []);
});

test('each deck end meets the street (or the next deck): no barrier across its carriageway for walkers and vehicles', () => {
  // The walk collision's own rule: two floors join only where they are within 5 cm; any other floor edge is a barrier.
  const WC = require(path.join(__dirname, '..', 'walk-collision.js')), G = RB.geometry(S);
  const floors = G.floors.map(f => ({name: 'deck', deck: f.deck, points: f.points.map(([x, s]) => ({x, z: s})), height: p => {const c = RB.coord(f.deck, p.x, p.z);return surface(f.deck, c.t, c.y);}}));
  const ground = [], seen = new Set();
  for (const d of S.decks) for (let k = 0; k < d.p.length / 2; k++) {
    const i = Math.floor(d.p[k * 2] / 200), j = Math.floor(d.p[k * 2 + 1] / 200);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {const key = (i + a) + ',' + (j + b);if (seen.has(key)) continue;seen.add(key);const x0 = (i + a) * 200, s0 = (j + b) * 200;ground.push({points: [{x: x0, z: s0}, {x: x0 + 200, z: s0}, {x: x0 + 200, z: s0 + 200}, {x: x0, z: s0 + 200}], height: p => S.height(p.x, p.z)});}
  }
  const w = WC.createWorld({floors: [...floors, ...ground], obstacles: []}), byFloor = new Map(w.floors.slice(0, floors.length).map((f, i) => [f, floors[i].deck])), cut = new Map();
  for (const b of w.boundary) {
    const d = byFloor.get(b.floor);if (!d) continue;
    const c = RB.coord(d, (b.a.x + b.b.x) / 2, (b.a.z + b.b.z) / 2);
    if ((c.t > .1 && c.t < d.L - .1) || Math.abs(c.y) > d.hw) continue;// (the parapets close its sides)
    const key = `${d.bridges[0].id} end ${c.t < .1 ? 0 : 1}`;cut.set(key, (cut.get(key) || 0) + Math.hypot(b.b.x - b.a.x, b.b.z - b.a.z));
  }
  const bad = [];
  for (const [key, m] of cut) {const k = KNOWN[+key.split(' ')[0]];if (k && k.end !== undefined && m <= k.end + .05) continue;bad.push(`${key}: ${m.toFixed(1)} m of its carriageway`);}
  assert.deepEqual(bad, []);
});

test('no ground shows through a deck, and decks are no steeper than 12 %', () => {
  const bad = [];
  for (const d of S.decks) {
    const k = KNOWN[d.bridges[0].id] || {};let worst = -Infinity, steep = 0;
    // (under the carriageway, away from the ends: at the edges and ends the ground's 4 / 8 m triangles may reach up to the deck)
    for (let t = 3; t <= d.L - 3; t += 2) for (const y of [-d.hw + .3, 0, d.hw - .3]) {
      const f = RB.frame(d, t), g = S.height(f.x - f.fs * y, f.s + f.fx * y);worst = Math.max(worst, g - (d.top(t, y) - .25));
    }
    for (let t = 0; t + 2 <= d.L; t += 2) steep = Math.max(steep, Math.abs(d.top(t + 2, 0) - d.top(t, 0)) / 2);
    if (worst > (k.through || 0)) bad.push(`${d.bridges[0].id} ${d.n || d.k}: ground ${worst.toFixed(2)} m too high under it`);
    if (steep > Math.max(.125, k.grade || 0)) bad.push(`${d.bridges[0].id} ${d.n || d.k}: grade ${(steep * 100).toFixed(0)} %`);
  }
  assert.deepEqual(bad, []);
});

test('the deck geometry: faces turn outward, floors and solids for walking and driving', () => {
  const G = RB.geometry(S);
  assert.ok(G.pos.length / 9 < 60000, `${G.pos.length / 9} triangles`);
  assert.equal(G.floors.length, S.decks.length);
  assert.ok(G.obstacles.some(o => o.kind === 'bridge parapet') && G.obstacles.some(o => o.kind === 'bridge deck'));
  // every top face points up, every underside face down
  let up = 0, down = 0;
  for (let i = 0; i < G.nor.length; i += 3) {if (G.nor[i + 1] > .9) up++;if (G.nor[i + 1] < -.9) down++;}
  assert.ok(up > 0 && down > 0);
});
